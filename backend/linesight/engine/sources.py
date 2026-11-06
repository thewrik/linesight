"""Source register and a small indexed retrieval over playbooks + sources.

Retrieval is keyword/BM25-lite over a bounded corpus; no vector database.
Retrieved text is untrusted data and is never executed as instructions.
"""
from __future__ import annotations

import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

SOURCES_PATH = Path(__file__).parent.parent / "rules" / "sources.yaml"


@lru_cache(maxsize=1)
def load_sources() -> list[dict[str, Any]]:
    with open(SOURCES_PATH) as fh:
        return yaml.safe_load(fh)


def source_ids() -> set[str]:
    return {s["id"] for s in load_sources()}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


@lru_cache(maxsize=1)
def _corpus() -> list[dict[str, Any]]:
    from ..rules.loader import default_rules

    docs = []
    for s in load_sources():
        docs.append({"id": s["id"], "kind": "source", "title": s["title"], "text": f"{s['title']} {s['paraphrase']} {s['applicability']}"})
    for p in default_rules().playbooks:
        docs.append({"id": p.id, "kind": "playbook", "title": p.title, "text": f"{p.title} {p.scope}"})
    for d in docs:
        d["tok"] = _tokens(d["text"])
    return docs


def retrieve(query: str, k: int = 3) -> list[dict[str, Any]]:
    docs = _corpus()
    q = set(_tokens(query))
    n = len(docs)
    df = {t: sum(1 for d in docs if t in d["tok"]) for t in q}
    scored = []
    for d in docs:
        score = 0.0
        for t in q:
            tf = d["tok"].count(t)
            if tf:
                score += (tf / (tf + 1.2)) * math.log(1 + n / df[t])
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [{"id": d["id"], "kind": d["kind"], "title": d["title"], "score": round(s, 3)} for s, d in scored[:k]]
