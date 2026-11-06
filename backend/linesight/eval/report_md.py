"""Render eval.json into docs/evaluation.md (numbers come only from the run file)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

COLS = [("correct_disposition", "disp ✓"), ("correct_resolution", "resol ✓"), ("cause_named", "cause ✓"),
        ("missed_escalation", "missed esc"), ("inappropriate_escalation", "inappr. esc"),
        ("unsupported_confident_diagnosis", "unsupp. conf."), ("verified_recovery", "verified rec."),
        ("forbidden_actions", "forbidden act."), ("mean_diagnostics", "checks"), ("mean_technician_questions", "tech Qs"),
        ("mean_effort_proxy", "effort proxy"), ("median_latency_ms", "p50 ms"), ("total_cost_usd", "cost $")]
LABEL = {"checklist": "Static checklist", "rules": "Rules engine (no model)", "replay": "Rules + replay", "live": "Rules + live model"}


def render(d: dict) -> str:
    L = ["# Evaluation results", "",
         f"_Generated from `eval.json` at {d['generated_at']} (rules {d['rules_version']}, commit {d['git_rev']}). "
         "Regenerate with `python -m linesight.eval.run --out frontend/public/data/eval.json && python -m linesight.eval.report_md`._", "",
         "> Synthetic benchmark. The cases and the rules have the same author, so this is a regression suite for the engine's "
         "behaviour, not an estimate of field accuracy or support-time savings. Effort is a synthetic proxy "
         "(sum of per-check effort + disruption, +2 per simulated change window).", ""]
    for mode, m in d["modes"].items():
        L += [f"## {LABEL.get(mode, mode)}", "", "| split | n | " + " | ".join(c[1] for c in COLS) + " |",
              "|---|---|" + "---|" * len(COLS)]
        for split, a in m["summary"].items():
            if not a:
                continue
            cells = [f"{a[k]}/{a['recovery_expected']}" if k == "verified_recovery" else str(a[k]) for k, _ in COLS]
            L.append(f"| {split} | {a['cases']} | " + " | ".join(cells) + " |")
        L += ["", f"Failures ({len(m['failures'])}):", ""]
        for f in m["failures"][:20]:
            L.append(f"- `{f['scenario']}` ({f['split']}): {', '.join(f['failed'])} — expected {f['expected']['disposition']}/"
                     f"{f['expected']['resolution']} {f['expected']['causes']}, got {f['got']['disposition']}/{f['got']['resolution']} {f['got']['claimed_causes']}")
        if len(m["failures"]) > 20:
            L.append(f"- … {len(m['failures']) - 20} more in `eval.json`")
        L.append("")
    for k, v in d.get("skipped", {}).items():
        L += [f"## {LABEL.get(k, k)}", "", f"Not run: {v}.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/public/data/eval.json")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/evaluation-results.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(json.loads(src.read_text())))
    print("wrote", out)
