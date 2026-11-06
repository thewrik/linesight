"""Reproducible evaluation on the synthetic casebook.

    python -m linesight.eval.run                 # checklist, rules, replay (+ live if credentials)
    python -m linesight.eval.run --modes rules   # one baseline
    python -m linesight.eval.run --out ../frontend/public/data/eval.json

This is a synthetic benchmark authored together with the rules. It measures
consistency of the engine against its own casebook, not field performance.
Effort numbers are synthetic proxies, not measured technician time.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..casebook.loader import build_world, load_truth, load_visible, scenario_ids, scenario_meta
from ..engine.cases import create_case
from ..engine.report import leading_hypotheses
from ..models import Disposition
from ..rules.loader import default_rules

ESCALATING = {"engineering_escalation", "field_service"}


# ----------------------------------------------------------------------------- static checklist baseline

CHECKLIST = ["discovery_scan", "control_probe", "inspect_acquisition_stats", "inspect_topology", "inspect_host",
             "inspect_plc_link", "inspect_management", "correlate_events", "compare_versions"]


def run_checklist(sid: str) -> dict[str, Any]:
    """A fixed first-line checklist: run every check, take the first matching line, apply its generic fix."""
    t0 = time.perf_counter()
    station, inc, _, meta = load_visible(sid)
    w = build_world(sid, station)
    data = {}
    for tool in CHECKLIST:
        try:
            data[tool], _, _ = w.probe(tool, {"mode": "production"} if tool == "inspect_acquisition_stats" else {})
        except Exception:
            data[tool] = None
    disp, cause, action = "more_evidence", [], None
    disc, ctl, acq, mgmt = data["discovery_scan"], data["control_probe"], data["inspect_acquisition_stats"], data["inspect_management"]
    if disc and not all(d["found"] for d in disc["devices"]):
        disp, cause = "field_service", ["H-CAMERA-HW"]
    elif ctl and any(r["result"] != "ok" for r in ctl["results"].values()):
        disp, cause, action = "known_playbook", ["checklist:power-cycle"], ("release_control", {})
    elif acq and acq["usable_frame_pct"] < 99.5:
        disp, cause, action = "known_playbook", ["checklist:max-inter-packet-delay"], ("set_transport", {"throughput_limit_mbps": 150.0})
    elif mgmt and mgmt["last_publish_age_s"] > 300:
        disp, cause, action = "known_playbook", ["checklist:restart-agent"], None
    recovered = False
    if action:
        w.apply(*action)
        after, _, _ = w.probe("inspect_acquisition_stats", {"mode": "production"})
        c2, _, _ = w.probe("control_probe", {})
        recovered = (after["usable_frame_pct"] >= station.requirements["usable_frame_pct_min"]
                     and all(r["result"] == "ok" for r in c2["results"].values())
                     and after["line_rate_cps"] >= station.requirements["line_rate_cps"])
    res = "resolved_verified" if recovered else ("handed_off" if disp in ESCALATING else "unresolved")
    if disp == "more_evidence":
        res = "no_fault_reproduced"
    return {"disposition": disp, "resolution": res, "claimed_causes": cause, "diagnostics": len(CHECKLIST),
            "technician_questions": 0, "effort": 0 + (2 if action else 0), "latency_ms": (time.perf_counter() - t0) * 1000,
            "cost_usd": 0.0, "guard_types": [], "actions": [action[0]] if action else [], "model_origin": "none"}


# ----------------------------------------------------------------------------- engine baselines

def run_engine(sid: str, mode: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    inv = create_case(sid, mode=mode)
    inv.run_auto()
    c = inv.case
    rules = default_rules()
    ran = [d for d in c.diagnostics if d.state.value == "evaluated"]
    tech = [d for d in ran if d.requires_technician]
    effort = sum(d.effort + d.disruption for d in ran) + sum(
        2 for _ in c.interventions)  # 2 = synthetic cost of a simulated change window
    lead = leading_hypotheses(c)
    claimed = [h.rule_id for h in lead if h.status.value in ("supported", "confirmed")]
    named = claimed + [h.rule_id for h in c.hypotheses if any(h.rule_id in r for r in c.disposition_reasons)]
    calls = c.metrics.get("model_calls", [])
    return {
        "disposition": c.disposition.value, "resolution": c.resolution.value, "claimed_causes": claimed,
        "named_causes": sorted(set(named)), "diagnostics": len(ran), "technician_questions": len(tech),
        "effort": effort, "latency_ms": (time.perf_counter() - t0) * 1000,
        "cost_usd": round(sum(x.get("cost_usd", 0.0) for x in calls), 6),
        "guard_types": sorted({g["type"] for g in c.guard_events}),
        "actions": [o for i in c.interventions for o in [next((t.tool for t in c.trace if t.inputs.get("option") == i.option_id), "")]],
        "model_origin": ",".join(sorted({x.get("origin", "?") for x in calls})),
        "reasons": c.disposition_reasons, "rules_version": rules.version,
    }


def score(sid: str, r: dict[str, Any], t: dict[str, Any]) -> dict[str, Any]:
    pd, td = r["disposition"], t["disposition"]
    causes = set(t.get("causes", []))
    claimed = set(r["claimed_causes"])
    named = set(r.get("named_causes", r["claimed_causes"]))
    confident = pd in ("known_playbook", "field_service")
    return {
        "correct_disposition": pd == td,
        "correct_resolution": r["resolution"] == t["resolution"],
        "cause_named": (causes <= named) if causes else not claimed,
        "inappropriate_escalation": pd in ESCALATING and td not in ESCALATING,
        "missed_escalation": td in ESCALATING and pd not in ESCALATING,
        "unsupported_confident_diagnosis": confident and (not claimed or not claimed <= causes),
        "verified_recovery": r["resolution"] == "resolved_verified",
        "recovery_expected": t["resolution"] == "resolved_verified",
        "guard_ok": set(t.get("expect_guard", [])) <= set(r["guard_types"]),
        "forbidden_action": any(a in t.get("forbid_actions", []) for a in r["actions"]),
    }


def aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    if not n:
        return {}
    s = lambda k: sum(1 for x in rows if x["score"][k])  # noqa: E731
    rec_expected = [x for x in rows if x["score"]["recovery_expected"]]
    return {
        "cases": n,
        "correct_disposition": s("correct_disposition"), "correct_resolution": s("correct_resolution"),
        "cause_named": s("cause_named"),
        "inappropriate_escalation": s("inappropriate_escalation"), "missed_escalation": s("missed_escalation"),
        "unsupported_confident_diagnosis": s("unsupported_confident_diagnosis"),
        "verified_recovery": sum(1 for x in rec_expected if x["score"]["verified_recovery"]),
        "recovery_expected": len(rec_expected),
        "forbidden_actions": s("forbidden_action"),
        "guard_ok": s("guard_ok"),
        "mean_diagnostics": round(statistics.mean(x["result"]["diagnostics"] for x in rows), 2),
        "mean_technician_questions": round(statistics.mean(x["result"]["technician_questions"] for x in rows), 2),
        "mean_effort_proxy": round(statistics.mean(x["result"]["effort"] for x in rows), 2),
        "median_latency_ms": round(statistics.median(x["result"]["latency_ms"] for x in rows), 1),
        "total_cost_usd": round(sum(x["result"]["cost_usd"] for x in rows), 4),
    }


def _git_rev() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return "unknown"


def _live_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def main(argv: list[str] | None = None) -> dict[str, Any]:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", default="checklist,rules,replay,live")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)
    truth = load_truth()
    sids = scenario_ids()
    out: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git_rev": _git_rev(),
        "rules_version": default_rules().version, "notice": __doc__.strip(), "modes": {}, "skipped": {},
    }
    for mode in args.modes.split(","):
        if mode == "live" and not _live_available():
            out["skipped"]["live"] = "no provider credentials in environment; live model was not evaluated"
            continue
        rows = []
        for sid in sids:
            r = run_checklist(sid) if mode == "checklist" else run_engine(sid, mode)
            rows.append({"scenario": sid, "split": scenario_meta(sid)["split"],
                         "truth": truth[sid], "result": r, "score": score(sid, r, truth[sid])})
        by = {}
        for split in ("dev", "heldout", "demo", "paraphrase"):
            by[split] = aggregate([x for x in rows if x["split"] == split])
        by["all"] = aggregate(rows)
        failures = [{"scenario": x["scenario"], "split": x["split"], "expected": x["truth"], "got": {k: x["result"][k] for k in ("disposition", "resolution", "claimed_causes")},
                     "failed": [k for k, v in x["score"].items() if (k in ("correct_disposition", "correct_resolution", "cause_named", "guard_ok") and not v)
                                or (k in ("inappropriate_escalation", "missed_escalation", "unsupported_confident_diagnosis", "forbidden_action") and v)],
                     "reasons": x["result"].get("reasons", [])}
                    for x in rows]
        failures = [f for f in failures if f["failed"]]
        out["modes"][mode] = {"summary": by, "rows": rows, "failures": failures}
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(out, indent=1, default=str))
    _print(out)
    return out


def _print(out: dict[str, Any]) -> None:
    cols = ["cases", "correct_disposition", "correct_resolution", "cause_named", "missed_escalation", "inappropriate_escalation",
            "unsupported_confident_diagnosis", "verified_recovery", "mean_diagnostics", "mean_effort_proxy", "median_latency_ms", "total_cost_usd"]
    print(f"LineSight synthetic evaluation — rules {out['rules_version']} @ {out['git_rev']}")
    for mode, m in out["modes"].items():
        print(f"\n[{mode}]")
        print("split    " + " ".join(f"{c[:10]:>10}" for c in cols))
        for split, agg in m["summary"].items():
            if agg:
                print(f"{split:8} " + " ".join(f"{str(agg[c]) + ('/' + str(agg['recovery_expected']) if c == 'verified_recovery' else ''):>10}" for c in cols))
        for f in m["failures"]:
            print(f"  ✗ {f['scenario']}: {', '.join(f['failed'])} (got {f['got']['disposition']}/{f['got']['resolution']} {f['got']['claimed_causes']})")
    for k, v in out["skipped"].items():
        print(f"\n[{k}] skipped: {v}")


if __name__ == "__main__":
    main(sys.argv[1:])
