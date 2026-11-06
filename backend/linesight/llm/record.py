"""Record live model intake outputs for replay mode (requires credentials).

    ANTHROPIC_API_KEY=... python -m linesight.llm.record demo-a-line-speed demo-b-replacement

Each record is labelled `recorded:<model>@<date>` so replay never presents it as
a live call, and hand-authored fixtures stay distinguishable.
"""
from __future__ import annotations

import json
import sys
from datetime import date

from ..casebook.loader import load_visible, scenario_ids
from .provider import RECORDINGS, LiveProvider, ticket_key


def main(ids: list[str]) -> None:
    p = LiveProvider()
    existing = {}
    if RECORDINGS.exists():
        for line in RECORDINGS.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                existing[r["ticket_key"]] = r
    for sid in ids or scenario_ids():
        station, inc, _, _ = load_visible(sid)
        out, meta = p.structure_ticket(inc.ticket_text, station)
        if not meta["origin"].startswith("live:"):
            print(f"{sid}: not recorded ({meta['label']})")
            continue
        existing[ticket_key(inc.ticket_text)] = {"ticket_key": ticket_key(inc.ticket_text), "scenario": sid,
                                                 "origin": f"recorded:{p.model}@{date.today()}", "schema": "TicketStructure-v1",
                                                 "structured": out, "cost_usd": meta.get("cost_usd")}
        print(f"{sid}: recorded")
    RECORDINGS.write_text("".join(json.dumps(r) + "\n" for r in existing.values()))


if __name__ == "__main__":
    main(sys.argv[1:])
