"""Scenario loading. Returns the agent-visible part and a World built from the hidden part.

Ground truth is loaded by a separate function used only by the evaluation harness.
"""
from __future__ import annotations

import copy
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..models import Incident, Station
from ..simulator.world import World
from ..station import build_station

HERE = Path(__file__).parent


@lru_cache(maxsize=1)
def _doc() -> dict[str, Any]:
    with open(HERE / "scenarios.yaml") as fh:
        return yaml.safe_load(fh)


def _raw() -> list[dict[str, Any]]:
    """Base scenarios plus paraphrase variants (id 'base~pN', split 'paraphrase')."""
    base = _doc()["scenarios"]
    out = list(base)
    for bid, texts in (_doc().get("paraphrases") or {}).items():
        b = next(x for x in base if x["id"] == bid)
        for i, text in enumerate(texts, start=1):
            v = copy.deepcopy(b)
            v["id"], v["split"] = f"{bid}~p{i}", "paraphrase"
            v["visible"]["ticket"] = text
            out.append(v)
    return out


def base_id(sid: str) -> str:
    return sid.split("~")[0]


def scenario_ids(split: str | None = None) -> list[str]:
    return [s["id"] for s in _raw() if split is None or s["split"] == split]


def scenario_meta(sid: str) -> dict[str, Any]:
    s = next(x for x in _raw() if x["id"] == sid)
    return {k: s.get(k) for k in ("id", "split", "title", "fixture", "sources", "station", "seed", "adversarial")}


def load_visible(sid: str) -> tuple[Station, Incident, list[dict[str, Any]], dict[str, Any]]:
    s = copy.deepcopy(next(x for x in _raw() if x["id"] == sid))
    station = build_station(s["station"], s.get("overrides"))
    v = s["visible"]
    inc = Incident(
        id=f"INC-{sid}", station_id=station.id, reported_at=s["now"], reporter=v["reporter"], ticket_text=v["ticket"].strip(),
        business_impact=v["business_impact"], prior_temporary_recoveries=v.get("prior_temporary_recoveries", 0),
        timeline=v.get("timeline", []),
    )
    return station, inc, v.get("uploaded_logs", []), scenario_meta(sid)


def build_world(sid: str, station: Station, seed: int | None = None) -> World:
    s = next(x for x in _raw() if x["id"] == sid)
    return World(station, s.get("hidden", {}), seed if seed is not None else s["seed"], s["now"])


def load_truth() -> dict[str, dict[str, Any]]:
    with open(HERE / "truth.yaml") as fh:
        t = yaml.safe_load(fh)
    for sid in scenario_ids("paraphrase"):
        t[sid] = t[base_id(sid)]
    return t
