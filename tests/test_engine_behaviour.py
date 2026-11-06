"""Behavioural tests of the investigation engine on synthetic scenarios."""
import pytest

from linesight.engine.cases import create_case
from linesight.engine.facts import derive_facts
from linesight.engine.report import engineering_handoff, traceability_gaps
from linesight.models import Evidence, EvidenceKind, HypothesisStatus
from linesight.station import build_station


def run(sid, **kw):
    inv = create_case(sid, **kw)
    inv.run_auto()
    return inv


def status(inv, rule):
    return next(h for h in inv.case.hypotheses if h.rule_id == rule).status


def supported(inv):
    return {h.rule_id for h in inv.case.hypotheses if h.status in (HypothesisStatus.supported, HypothesisStatus.confirmed)}


# --- same symptom, different cause ------------------------------------------------------------

def test_visible_but_cannot_connect_has_two_different_causes():
    adapter, subnet = run("demo-b-replacement"), run("dev-subnet")
    assert supported(adapter) == {"H-ADAPTER"}
    assert supported(subnet) == {"H-SUBNET"}
    assert adapter.case.interventions[0].playbook == "PB-ADAPTER"
    assert subnet.case.interventions[0].playbook == "PB-IP"


def test_acquisition_failed_errors_are_not_decided_by_the_error_string():
    burst, backpressure = run("dev-burst-plantb"), run("dev-backpressure")
    assert supported(burst) == {"H-BURST"}
    assert supported(backpressure) == {"H-HOST-BACKPRESSURE"}
    # both show "acquisition failed"-family error counters; discriminating evidence differs
    diag = lambda c: [e for e in c.evidence if e.kind != EvidenceKind.verification]  # noqa: E731
    f_b = derive_facts(diag(burst.case), burst.case.station)
    f_h = derive_facts(diag(backpressure.case), backpressure.case.station)
    assert f_b["uplink_egress_drops"].value > 0 and f_h["uplink_egress_drops"].value == 0
    assert f_h["app_drop_pct"].value > 1


def test_compatibility_case_does_not_run_network_troubleshooting():
    inv = run("demo-b-replacement")
    ran = [d.id for d in inv.case.diagnostics if d.state.value == "evaluated"]
    assert not {"D-TOPO", "D-STREAM-SINGLE", "D-STREAM-LOW"} & set(ran)
    assert len(ran) <= 4
    demo_a = run("demo-a-line-speed")
    assert len(ran) < len([d for d in demo_a.case.diagnostics if d.state.value == "evaluated"])


# --- missing evidence / unsupported versions / contradictions --------------------------------

def test_missing_switch_counters_block_the_burst_diagnosis():
    inv = run("ho-missing-telemetry")
    c = inv.case
    assert c.disposition.value == "more_evidence" and c.resolution.value == "awaiting_customer"
    assert status(inv, "H-BURST") == HypothesisStatus.untested
    assert not c.interventions


def test_unreleased_firmware_escalates_without_a_fix():
    inv = run("ho-unreleased-fw")
    assert inv.case.disposition.value == "engineering_escalation"
    assert not inv.case.interventions
    assert "H-UNRELEASED-FW" in supported(inv)


def test_customer_replacement_claim_is_contradicted_by_evidence():
    inv = run("demo-a-line-speed")
    a = next(a for a in inv.case.assertions if a.claim == "replacement_needed")
    assert a.status == "contradicted" and a.evidence


def test_latest_capture_wins_over_arrival_order():
    st = build_station("plant-a-line3")
    base = dict(key="plc", kind=EvidenceKind.observed, summary="", provenance="t", scope={})
    ok = {"per_camera": {f"cam{i}": {"frames_started": 600, "triggers_sent": 600, "result_timeouts": 0} for i in range(1, 5)}, "result_link": "ok"}
    bad = {"per_camera": {**ok["per_camera"], "cam2": {"frames_started": 0, "triggers_sent": 600, "result_timeouts": 600}}, "result_link": "ok"}
    newer = Evidence(id="E-001", data=ok, captured_at="2026-11-09T06:40:00", received_seq=1, **base)
    older_late = Evidence(id="E-002", data=bad, captured_at="2026-11-09T05:00:00", received_seq=2, **base)
    facts = derive_facts([newer, older_late], st)
    assert facts["trigger_missing_cams"].value == [] and facts["trigger_missing_cams"].evidence == ["E-001"]


def test_customer_text_claims_are_traceable():
    for sid in ("demo-a-line-speed", "demo-b-replacement", "demo-c-heartbeat"):
        assert traceability_gaps(run(sid).case) == []


# --- source scope ------------------------------------------------------------------------------

def test_lock_retention_rule_respects_sdk_scope(monkeypatch):
    from linesight.casebook import loader
    raw = loader._raw()
    s = next(x for x in raw if x["id"] == "dev-stale-lock")
    orig = s["hidden"]["faults"][0].get("sdk")
    s["hidden"]["faults"][0]["sdk"] = "Kestrel Acquisition SDK 3.2.0"
    monkeypatch.setattr(loader, "_raw", lambda: raw)
    try:
        inv = run("dev-stale-lock")
        assert status(inv, "H-STALE-LOCK") == HypothesisStatus.contradicted
        assert not any(i.playbook == "PB-RELEASE-LOCK" for i in inv.case.interventions)
    finally:
        if orig is None:
            s["hidden"]["faults"][0].pop("sdk")


def test_trailer_setting_is_applied_only_to_the_scoped_vendor():
    inv = run("ho-trailer-misapplied")
    iv = inv.case.interventions[0]
    assert iv.playbook == "PB-TRAILER" and iv.params["devices"] == ["cam4"]
    assert inv.case.resolution.value == "resolved_verified"


# --- verification, mitigation and recurrence --------------------------------------------------

def test_failed_verification_prevents_closure():
    inv = create_case("demo-a-line-speed")
    while not inv.case.intervention_options and inv.step():
        pass
    if inv.case.pending_question:
        inv.answer()
    ver = inv.apply_option("O-PACE-LOW")
    assert not ver.passed
    assert inv.case.resolution.value != "resolved_verified"
    assert inv.case.disposition.value == "engineering_escalation"


def test_line_speed_reduction_is_a_mitigation_not_a_resolution():
    inv = create_case("demo-a-line-speed")
    while not inv.case.intervention_options and inv.step():
        pass
    opt = next(o for o in inv.case.intervention_options if o.id == "O-SLOW-LINE")
    assert not opt.meets_requirements
    ver = inv.apply_option("O-SLOW-LINE")
    assert ver.outcome.value != "resolved_verified"


def test_recurrent_temporary_recoveries_escalate():
    inv = run("dev-stale-lock-recurrent")
    assert inv.case.disposition.value == "engineering_escalation"
    assert not inv.case.interventions


def test_repeated_mitigations_escalate():
    inv = create_case("dev-stale-lock")
    while not inv.case.intervention_options and inv.step():
        pass
    inv.apply_option("O-POWER-CYCLE")
    assert inv.case.resolution.value != "resolved_verified"
    inv.apply_option("O-POWER-CYCLE")
    assert inv.case.disposition.value == "engineering_escalation"


def test_no_fault_found_is_distinct_from_no_matching_playbook():
    nf, unknown = run("dev-no-fault"), run("dev-unknown-corruption")
    assert (nf.case.disposition.value, nf.case.resolution.value) == ("more_evidence", "no_fault_reproduced")
    assert unknown.case.disposition.value == "engineering_escalation"
    assert any("No matching playbook" in r for r in unknown.case.disposition_reasons)


def test_physical_fault_needs_controlled_substitution():
    with_sub, without = run("dev-cable"), run("ho-cable-no-subst")
    assert with_sub.case.disposition.value == "field_service"
    assert without.case.disposition.value == "more_evidence"
    assert status(without, "H-CABLE") == HypothesisStatus.untested


def test_diagnostic_budget_is_respected():
    for sid in ("dev-no-fault", "dev-cable", "demo-c-heartbeat"):
        b = run(sid).case.budget
        assert b["automated_used"] <= b["max_automated_checks"]
        assert b["technician_used"] <= b["max_technician_questions"]


def test_escalation_handoff_contains_required_sections():
    h = engineering_handoff(run("demo-c-heartbeat").case)
    for k in ("versions", "topology", "timeline", "reproduction_steps", "checks_performed", "observations",
              "workaround_status", "requested_help"):
        assert h[k], k
    assert h["outstanding_hypotheses"] or h["engineering_alternatives"]
    assert "not a fix" in h["workaround_status"]
    assert any(s["id"] == "S6" for s in h["sources"])


# --- determinism ------------------------------------------------------------------------------

@pytest.mark.parametrize("sid", ["demo-a-line-speed", "demo-c-heartbeat", "ho-multi-burst-cable"])
def test_replay_is_deterministic(sid):
    a, b = run(sid, mode="replay").case, run(sid, mode="replay").case
    strip = lambda c: [(e.id, e.key, e.summary, e.captured_at) for e in c.evidence]  # noqa: E731
    assert strip(a) == strip(b)
    assert (a.disposition, a.resolution) == (b.disposition, b.resolution)


def test_rules_version_recorded_on_case():
    from linesight.rules.loader import default_rules
    assert run("demo-b-replacement").case.rules_version == default_rules().version
