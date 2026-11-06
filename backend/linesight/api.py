"""FastAPI application. Credentials stay server-side; the browser never sees a key."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from . import store
from .casebook.loader import scenario_ids, scenario_meta
from .engine.cases import create_case
from .engine.investigator import Investigator
from .engine.report import engineering_handoff
from .engine.snapshot import snapshot
from .engine.sources import load_sources
from .llm.provider import make_provider
from .rules.loader import default_rules

app = FastAPI(title="LineSight API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("LINESIGHT_CORS", "http://localhost:5173").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["content-type"])
EVAL_PATH = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "eval.json"


def live_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


class NewCase(BaseModel):
    scenario_id: str
    mode: str = "rules"
    ticket_text: Optional[str] = Field(default=None, max_length=8000)
    logs: list[Any] = Field(default_factory=list, max_length=2000)


class Answer(BaseModel):
    simulated: bool = True
    answer: Optional[str] = None
    detail: str = Field(default="", max_length=500)


class Apply(BaseModel):
    option_id: str


def _load(case_id: str) -> Investigator:
    got = store.load(case_id)
    if not got:
        raise HTTPException(404, "case not found")
    case, world = got
    return Investigator(case, world, default_rules(), make_provider(case.mode))


def _save(inv: Investigator, label: str) -> dict[str, Any]:
    store.save(inv.case, inv.world)
    return snapshot(inv, label, inv.provider)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "rules_version": default_rules().version,
            "modes": ["rules", "replay"] + (["live"] if live_available() else []),
            "live_model": os.environ.get("LINESIGHT_MODEL", "claude-opus-5-5") if live_available() else None}


@app.get("/api/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return [scenario_meta(s) for s in scenario_ids()]


@app.post("/api/cases")
def new_case(body: NewCase) -> dict[str, Any]:
    if body.scenario_id not in scenario_ids():
        raise HTTPException(404, "unknown scenario")
    if body.mode not in health()["modes"]:
        raise HTTPException(400, f"mode {body.mode} not available on this server")
    try:
        inv = create_case(body.scenario_id, mode=body.mode, ticket_override=body.ticket_text, extra_logs=body.logs)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    inv.case.case_id += f"-{os.urandom(3).hex()}"
    return _save(inv, "intake")


@app.get("/api/cases/{case_id}")
def get_case(case_id: str) -> dict[str, Any]:
    inv = _load(case_id)
    return snapshot(inv, "loaded", inv.provider)


@app.post("/api/cases/{case_id}/step")
def step(case_id: str) -> dict[str, Any]:
    inv = _load(case_id)
    nxt = inv.case.next_check
    if not inv.step():
        raise HTTPException(409, "nothing to run (finished, awaiting answer, or awaiting intervention)")
    return _save(inv, f"ran {nxt}")


@app.post("/api/cases/{case_id}/answer")
def answer(case_id: str, body: Answer) -> dict[str, Any]:
    inv = _load(case_id)
    try:
        inv.answer(answer=body.answer, detail=body.detail, simulated=body.simulated)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return _save(inv, "technician answered")


@app.post("/api/cases/{case_id}/apply")
def apply(case_id: str, body: Apply) -> dict[str, Any]:
    inv = _load(case_id)
    try:
        inv.apply_option(body.option_id)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc))
    return _save(inv, f"applied {body.option_id}")


@app.get("/api/cases/{case_id}/handoff.md", response_class=PlainTextResponse)
def handoff_md(case_id: str) -> str:
    return engineering_handoff(_load(case_id).case)["markdown"]


@app.get("/api/sources")
def sources() -> list[dict[str, Any]]:
    return load_sources()


@app.get("/api/rules")
def rules() -> dict[str, Any]:
    return default_rules().model_dump()


@app.get("/api/eval")
def eval_results() -> dict[str, Any]:
    if not EVAL_PATH.exists():
        raise HTTPException(404, "run `python -m linesight.eval.run --out frontend/public/data/eval.json` first")
    return json.loads(EVAL_PATH.read_text())


# Serve the built frontend when present (Docker image). In development Vite serves it instead.
_static = os.environ.get("LINESIGHT_STATIC_DIR")
if _static and Path(_static).is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_static, html=True), name="web")
