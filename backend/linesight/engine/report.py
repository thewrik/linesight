"""Customer explanation and engineering handoff. Every technical line cites evidence ids."""
from __future__ import annotations

from typing import Any

from ..models import CaseState, DiagnosticState, Disposition, EvidenceKind, HypothesisStatus, Resolution
from ..llm.provider import validate_citations
from .sources import load_sources

REPRO = {
    "H-HEARTBEAT-GAP": [
        "Bench: four cameras (same model/firmware) on a PoE switch, host = EH-310 image with {sdk} on {os}.",
        "Run software-trigger acquisition, then stop triggering for 65 minutes while the SDK polls at 3 s.",
        "Capture GVCP (UDP 3956) on the host NIC for the whole idle window; log heartbeat interval per camera.",
        "Repeat with power plan 'High performance' and with NIC energy-efficient Ethernet disabled (one change per run).",
        "Record whether the first ACCESS_DENIED follows a heartbeat gap > heartbeat timeout ({hb} ms).",
    ],
    "H-UNRELEASED-FW": [
        "Bench: one camera with firmware {fw_unreleased} and Meridian Inspect {app}.",
        "Attempt discovery and control open; record the adapter-selection log line.",
    ],
    "H-STALE-LOCK": [
        "Bench: start Meridian Inspect with the production profile, kill the process, restart within 60 s.",
        "Record time until control re-opens; repeat with and without the debug heartbeat extension.",
    ],
    "_unknown": [
        "Collect 200 consecutive raw frames from the affected camera with chunk data enabled.",
        "Collect the same with the camera alone on a direct host port (no switch).",
        "Send both sets with the evidence bundle below.",
    ],
}
ASKS = {
    "H-HEARTBEAT-GAP": "Confirm whether the SDK heartbeat thread can be delayed after long idle on Windows 11 hosts, and whether a supported setting addresses the cause (not only a longer timeout).",
    "H-UNRELEASED-FW": "Confirm whether firmware {fw_unreleased} is supported with any released adapter, or provide a supported firmware for this unit.",
    "H-STALE-LOCK": "Recurring crash + lock: investigate the application crash itself; releasing the lock is only a mitigation.",
    "_unknown": "No rule matches these observations; please review the frame samples and counters for an unlisted fault.",
}


def _ev(case: CaseState) -> dict[str, Any]:
    return {e.id: e for e in case.evidence}


def _cite(ids: list[str]) -> str:
    return " ".join(f"[{i}]" for i in sorted(set(ids))) if ids else ""


def leading_hypotheses(case: CaseState):
    order = {HypothesisStatus.confirmed: 0, HypothesisStatus.supported: 1, HypothesisStatus.refuted_by_verification: 2}
    hs = [h for h in case.hypotheses if h.status in order]
    return sorted(hs, key=lambda h: (order[h.status], -h.severity))


def customer_explanation(case: CaseState) -> dict[str, Any]:
    lead = leading_hypotheses(case)
    lines: list[str] = []
    for a in case.assertions:
        if a.status == "contradicted":
            lines.append(f"About “{a.claim.replace('_', ' ')}”: {a.note} {_cite(a.evidence)}")
    if case.disposition == Disposition.known_playbook and case.resolution in (Resolution.resolved_verified, Resolution.mitigated):
        for h in lead:
            if h.status == HypothesisStatus.confirmed:
                lines.append(f"Cause found: {h.title.lower()}. {_cite(h.supporting)}")
        for iv in case.interventions:
            v = next((v for v in case.verifications if v.intervention_id == iv.id), None)
            if v:
                lines.append(f"Change made (simulated): {iv.title}. Checked afterwards: "
                             + "; ".join(c["detail"] for c in v.checks) + f" {_cite(v.evidence_ids)}")
        if case.resolution == Resolution.mitigated:
            lines.append("This is a temporary measure: the line is not yet back to its required performance.")
    elif case.disposition == Disposition.known_playbook:
        lines.append("A known fix applies; it is waiting for your approval before anything is changed.")
        for h in lead[:1]:
            lines.append(f"Likely cause: {h.title.lower()}. {_cite(h.supporting)}")
    elif case.disposition == Disposition.engineering_escalation:
        lines.append("We have not found a known fix that is safe to apply, so the case has gone to engineering with the evidence collected so far.")
        for h in lead[:1]:
            lines.append(f"What we see: {h.title.lower()}. {_cite(h.supporting)}")
        if case.incident.prior_temporary_recoveries:
            lines.append("Restarting may bring the line back for a while, but it has not fixed the cause.")
    elif case.disposition == Disposition.field_service:
        h = next((h for h in lead if h.disposition_hint == "field_service"), None)
        if h:
            lines.append(f"The test you ran points to a physical fault: {h.title.lower()}. {_cite(h.supporting)}")
        lines.append("A field-service visit or part is being arranged for the item the test identified, not for working parts.")
    elif case.disposition == Disposition.more_evidence:
        if case.resolution == Resolution.no_fault_reproduced:
            lines.append("Everything we can check is healthy right now. Next time it happens, please note the time and press 'Capture' on the station so we can see it.")
        else:
            lines.append("We need one more check from you before recommending anything:")
            if case.pending_question:
                lines.append(case.pending_question.question)
            lines += [r for r in case.disposition_reasons]
    text = "\n".join(lines)
    return {"text": text, "origin": "template"}


def maybe_model_customer_text(case: CaseState, provider: Any) -> dict[str, Any]:
    base = customer_explanation(case)
    if getattr(provider, "mode", "rules") != "live":
        return base
    ctx = {"draft": base["text"], "evidence": {e.id: e.summary for e in case.evidence}}
    text, meta = provider.draft("customer", ctx)
    if text:
        ok, why = validate_citations(text, {e.id for e in case.evidence})
        if ok:
            return {"text": text, "origin": meta.get("origin"), "validated": True}
        return {**base, "fallback_reason": f"model draft rejected: {why}"}
    return {**base, "fallback_reason": f"model unavailable: {meta.get('error')}"}


def engineering_handoff(case: CaseState) -> dict[str, Any]:
    ev = _ev(case)
    st = case.station
    v = st.versions
    vers_ev = [e for e in case.evidence if e.key == "versions"]
    host_ev = [e for e in case.evidence if e.key == "host"]
    fw = vers_ev[-1].data["versions"]["camera_firmware"] if vers_ev else v.camera_firmware
    sdk = vers_ev[-1].data["versions"]["acquisition_sdk"] if vers_ev else v.acquisition_sdk
    lead = leading_hypotheses(case)
    primary = lead[0].rule_id if lead else "_unknown"
    fmt = {"sdk": sdk, "os": host_ev[-1].data["os"] if host_ev else v.host_os, "hb": 3000, "app": v.inspection_app,
           "fw_unreleased": next((f for f in fw.values() if "rc" in f), "?")}
    events = next((e for e in reversed(case.evidence) if e.key == "events"), None)
    timeline = [{"t": t["t"], "what": t["what"], "source": "customer timeline (assertion)"} for t in case.incident.timeline]
    if events:
        timeline += [{"t": x["t"], "what": x["msg"], "source": f"{x['source']} [{events.id}]" + (" (untrusted upload)" if x.get("untrusted") else "")}
                     for x in events.data["events"]]
    timeline.sort(key=lambda x: x["t"])
    checks = [{"id": d.id, "title": d.title, "state": d.state.value, "reason": d.reason, "evidence": d.evidence_ids}
              for d in case.diagnostics if d.state in (DiagnosticState.evaluated, DiagnosticState.blocked)]
    obs = [{"id": e.id, "key": e.key, "kind": e.kind.value, "status": e.status.value, "summary": e.summary,
            "captured_at": e.captured_at, "provenance": e.provenance} for e in case.evidence]
    outstanding = [{"rule": h.rule_id, "title": h.title, "status": h.status.value, "missing": h.missing}
                   for h in case.hypotheses if h.active and h.status == HypothesisStatus.untested]
    alternatives = [a for h in lead for a in h.alternatives]
    workaround = "none applied"
    if case.interventions:
        last = case.interventions[-1]
        ver = next((x for x in case.verifications if x.intervention_id == last.id), None)
        workaround = f"{last.title} → {ver.outcome.value if ver else 'unverified'}"
    elif case.incident.prior_temporary_recoveries:
        workaround = f"Operator restarts recover temporarily ({case.incident.prior_temporary_recoveries} so far); not a fix."
    srcs = {s["id"]: s for s in load_sources()}
    cited_sources = sorted({s for h in lead for s in h.sources})
    hand = {
        "case_id": case.case_id, "rules_version": case.rules_version, "mode": case.mode,
        "disposition": case.disposition.value, "resolution": case.resolution.value, "reasons": case.disposition_reasons,
        "simulation_notice": "All observations come from LineSight's simulator; no real hardware was touched.",
        "station": {"site": st.site, "line": st.line, "template": st.template},
        "versions": {"host_os": fmt["os"], "acquisition_sdk": sdk, "inspection_app": v.inspection_app,
                     "adapters": vers_ev[-1].data["versions"]["adapters_installed"] if vers_ev else v.adapters_installed,
                     "nic_driver": v.nic_driver, "camera_firmware": fw, "plc_program": v.plc_program, "mgmt_agent": v.mgmt_agent,
                     "evidence": [e.id for e in vers_ev]},
        "topology": [{"device": d.id, "kind": d.kind, "model": f"{d.vendor} {d.model}", "role": d.role} for d in st.devices],
        "timeline": timeline,
        "checks_performed": checks,
        "observations": obs,
        "customer_assertions": [a.model_dump() for a in case.assertions],
        "leading_hypotheses": [{"rule": h.rule_id, "title": h.title, "status": h.status.value, "supporting": h.supporting,
                                "contradicting": h.contradicting, "corroborating": h.corroborating, "reasons": h.reasons}
                               for h in lead],
        "outstanding_hypotheses": outstanding,
        "engineering_alternatives": alternatives,
        "reproduction_steps": [s.format(**fmt) for s in REPRO.get(primary, REPRO["_unknown"] if case.disposition == Disposition.engineering_escalation else [])],
        "workaround_status": workaround,
        "requested_help": ASKS.get(primary, ASKS["_unknown"]).format(**fmt) if case.disposition == Disposition.engineering_escalation else None,
        "guard_events": case.guard_events,
        "sources": [{"id": s, "title": srcs[s]["title"], "url": srcs[s]["url"], "evidence_type": srcs[s]["evidence_type"],
                     "applicability": srcs[s]["applicability"]} for s in cited_sources if s in srcs],
    }
    hand["markdown"] = _markdown(hand)
    return hand


def _markdown(h: dict[str, Any]) -> str:
    L = [f"# Engineering handoff — {h['case_id']}", "",
         f"> {h['simulation_notice']}", "",
         f"**Disposition:** {h['disposition']} · **Resolution:** {h['resolution']} · **Rules:** {h['rules_version']} · **Mode:** {h['mode']}", ""]
    L += ["## Why"] + [f"- {r}" for r in h["reasons"]] + [""]
    L += ["## Station", f"{h['station']['site']} — {h['station']['line']} ({h['station']['template']})", ""]
    L += ["## Versions " + " ".join(f"[{e}]" for e in h["versions"]["evidence"])]
    for k, val in h["versions"].items():
        if k != "evidence":
            L.append(f"- {k}: {val}")
    L += ["", "## Topology"] + [f"- {d['device']}: {d['model']} ({d['kind']}{', ' + d['role'] if d['role'] else ''})" for d in h["topology"]]
    L += ["", "## Timeline"] + [f"- {t['t']} — {t['what']} _({t['source']})_" for t in h["timeline"]]
    L += ["", "## Leading hypotheses"]
    for x in h["leading_hypotheses"]:
        L.append(f"- **{x['rule']}** {x['title']} — {x['status']}; supporting {x['supporting']}, contradicting {x['contradicting']}")
    if h["outstanding_hypotheses"]:
        L += ["", "## Outstanding (untested)"] + [f"- {x['rule']} {x['title']} — needs {', '.join(x['missing'])}" for x in h["outstanding_hypotheses"]]
    if h["engineering_alternatives"]:
        L += ["", "## Alternatives for engineering"] + [f"- {a}" for a in h["engineering_alternatives"]]
    L += ["", "## Checks performed"] + [f"- {c['id']} {c['title']} — {c['state']}{': ' + c['reason'] if c['reason'] else ''} {' '.join('[' + e + ']' for e in c['evidence'])}" for c in h["checks_performed"]]
    L += ["", "## Observations"] + [f"- [{o['id']}] ({o['kind']}, {o['status']}, {o['captured_at']}) {o['summary']}" for o in h["observations"]]
    if h["reproduction_steps"]:
        L += ["", "## Reproduction request"] + [f"{i + 1}. {s}" for i, s in enumerate(h["reproduction_steps"])]
    L += ["", "## Workaround status", h["workaround_status"]]
    if h["requested_help"]:
        L += ["", "## Requested engineering help", h["requested_help"]]
    if h["guard_events"]:
        L += ["", "## Untrusted-input findings"] + [f"- {g['type']} in {g['origin']}: “{g['match']}” → {g['action']}" for g in h["guard_events"]]
    if h["sources"]:
        L += ["", "## Sources (mechanism references, not proof for this site)"] + [f"- {s['id']}: [{s['title']}]({s['url']}) — {s['evidence_type']}; {s['applicability']}" for s in h["sources"]]
    return "\n".join(L) + "\n"


def traceability_gaps(case: CaseState) -> list[str]:
    """Technical lines in the customer text that carry no citation (used by tests)."""
    gaps = []
    for line in customer_explanation(case)["text"].splitlines():
        if line.startswith(("Cause found", "Change made", "What we see", "The test you ran", "Likely cause", "About")) and "[E-" not in line:
            gaps.append(line)
    return gaps
