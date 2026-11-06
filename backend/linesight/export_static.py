"""Export deterministic replays of the flagship demos (and data files) for the static site.

    python -m linesight.export_static ../frontend/public/data

Each replay is the sequence of engine snapshots produced by the rules engine
stepping through a case. It is a recording of deterministic code, not of a model.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .casebook.loader import scenario_ids, scenario_meta
from .engine.cases import create_case
from .engine.snapshot import snapshot
from .engine.sources import load_sources
from .rules.loader import default_rules

DEMOS = ["demo-a-line-speed", "demo-b-replacement", "demo-c-heartbeat"]


def record(sid: str, mode: str = "replay") -> dict:
    inv = create_case(sid, mode=mode)
    frames = [{"action": {"type": "intake"}, "snapshot": snapshot(inv, "intake")}]
    for _ in range(40):
        c = inv.case
        if c.finished:
            break
        if c.pending_question:
            inv.answer(simulated=True)
            frames.append({"action": {"type": "answer"}, "snapshot": snapshot(inv, "technician answered (simulated)")})
        elif c.intervention_options:
            rec = next((o for o in c.intervention_options if o.recommended), c.intervention_options[0])
            inv.apply_option(rec.id)
            frames.append({"action": {"type": "apply", "option_id": rec.id}, "snapshot": snapshot(inv, f"applied {rec.id}")})
        else:
            nxt = c.next_check
            inv.step()
            frames.append({"action": {"type": "step", "diagnostic": nxt}, "snapshot": snapshot(inv, f"ran {nxt}")})
    return {"scenario": scenario_meta(sid), "mode": mode, "rules_version": default_rules().version,
            "notice": "Static replay: recorded output of LineSight's deterministic engine. Intake uses a hand-authored structured fixture "
                      "(labelled in the trace); no language model was called.", "frames": frames}


def main(out_dir: str) -> None:
    out = Path(out_dir)
    (out / "replays").mkdir(parents=True, exist_ok=True)
    for sid in DEMOS:
        (out / "replays" / f"{sid}.json").write_text(json.dumps(record(sid), default=str))
        print("wrote", sid)
    (out / "sources.json").write_text(json.dumps(load_sources(), default=str, indent=1))
    (out / "rules.json").write_text(json.dumps(default_rules().model_dump(), default=str))
    (out / "scenarios.json").write_text(json.dumps([scenario_meta(s) for s in scenario_ids()], default=str))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/data")
