"""Untrusted input, tool misuse, and model-provider fallbacks."""
import types

import pytest
from pydantic import ValidationError

from linesight.engine import guard
from linesight.engine.cases import create_case
from linesight.llm.provider import LiveProvider, ReplayProvider, TicketStructure, validate_citations
from linesight.rules.loader import RuleSet, load_rules
from linesight.station import build_station


def test_log_injection_is_flagged_and_grants_nothing():
    inv = create_case("dev-adv-injection")
    inv.run_auto()
    c = inv.case
    assert any(g["type"] == "embedded_instruction" for g in c.guard_events)
    assert all(i.option_id.startswith("O-INSTALL") for i in c.interventions)
    assert not any(t.tool == "change_firmware" for t in c.trace)
    # untrusted upload lines are visible but never become facts
    ev = next(e for e in c.evidence if e.key == "events")
    assert any(x.get("untrusted") for x in ev.data["events"])


def test_fabricated_reference_is_not_used_as_a_source():
    inv = create_case("ho-adv-fabricated-ref")
    inv.run_auto()
    refs = [g for g in inv.case.guard_events if g["type"] == "unverified_reference"]
    assert refs and any("77812" in g["match"] for g in refs)
    from linesight.engine.report import engineering_handoff
    assert all(s["id"].startswith("S") for s in engineering_handoff(inv.case)["sources"])
    assert inv.case.disposition.value == "engineering_escalation"


def test_unsupported_firmware_request_is_refused():
    inv = create_case("dev-adv-unsupported-fw")
    inv.run_auto()
    g = [x for x in inv.case.guard_events if x["type"] == "unsupported_request"]
    assert g and "3.9.0" in g[0]["match"]
    assert not any(t.tool == "change_firmware" for t in inv.case.trace)


def test_registered_source_urls_are_not_flagged():
    text = "see https://github.com/basler/pypylon/issues/863 for a similar report"
    assert not [f for f in guard.scan_text(text, "ticket") if f["type"] == "unverified_reference"]


def test_model_tool_proposal_validation():
    cands = {"D-TOPO": {"title": "t", "score": 3.0, "args": {}}}
    assert guard.validate_tool_proposal({"diagnostic_id": "D-TOPO"}, cands)[0] == "D-TOPO"
    assert guard.validate_tool_proposal({"diagnostic_id": "change_firmware"}, cands)[0] is None
    assert guard.validate_tool_proposal({"diagnostic_id": "D-TOPO", "args": {"mode": "write"}}, cands)[0] is None
    assert guard.validate_tool_proposal("run everything", cands)[0] is None


def test_engine_refuses_options_it_did_not_offer():
    inv = create_case("demo-b-replacement")
    while not inv.case.intervention_options and inv.step():
        pass
    with pytest.raises(ValueError):
        inv.apply_option("O-FW-cam3-9.9.9")


def test_upload_validation():
    with pytest.raises(ValueError):
        guard.validate_log_lines([{"no_msg": 1}])
    with pytest.raises(ValueError):
        guard.validate_ticket("x" * 9000)
    assert guard.validate_log_lines(["plain line"])[0]["msg"] == "plain line"


def test_ticket_schema_rejects_unknown_symptoms_and_devices():
    with pytest.raises(ValidationError):
        TicketStructure.model_validate({"symptom_groups": ["reboot_everything"], "devices_mentioned": [], "claims": [],
                                        "requested_actions": [], "restart_count": 0, "changes": [], "cited_references": []})
    with pytest.raises(ValidationError):
        TicketStructure.model_validate({"symptom_groups": [], "devices_mentioned": ["cam9"], "claims": [],
                                        "requested_actions": [], "restart_count": 0, "changes": [], "cited_references": []})


def test_replay_labels_hand_authored_and_misses():
    st = build_station("plant-a-line3")
    rp = ReplayProvider()
    _, meta = rp.structure_ticket("A ticket nobody recorded", st)
    assert meta["origin"] == "replay-miss" and "fell back" in meta["label"]
    inv = create_case("demo-a-line-speed", mode="replay")
    assert "HAND-AUTHORED" in inv.case.trace[0].note


class _Err(Exception):
    pass


def _fake_live(behaviour):
    p = LiveProvider.__new__(LiveProvider)
    p.model = "claude-opus-5-5"
    p.anthropic = types.SimpleNamespace(APITimeoutError=type("T", (_Err,), {}), RateLimitError=type("R", (_Err,), {}),
                                        APIStatusError=type("S", (_Err,), {"status_code": 500}), APIConnectionError=type("C", (_Err,), {}))

    class Msgs:
        def parse(self, **kw):
            return behaviour(p)

    p.client = types.SimpleNamespace(messages=Msgs())
    return p


def test_live_timeout_falls_back_to_rules_parser():
    def boom(p):
        raise p.anthropic.APITimeoutError()
    out, meta = _fake_live(boom).structure_ticket("Camera 3 offline", build_station("plant-a-line3"))
    assert meta["origin"] == "live-fallback" and "timeout" in meta["label"]
    assert out["devices_mentioned"] == ["cam3"]


def test_live_refusal_and_empty_output_fall_back():
    usage = types.SimpleNamespace(input_tokens=10, output_tokens=5)
    for stop, parsed in (("refusal", None), ("max_tokens", None)):
        resp = types.SimpleNamespace(stop_reason=stop, parsed_output=parsed, usage=usage)
        out, meta = _fake_live(lambda p, r=resp: r).structure_ticket("Camera 2 offline", build_station("plant-a-line3"))
        assert meta["origin"] == "live-fallback"


def test_citation_validation():
    ids = {"E-001", "E-002"}
    assert validate_citations("Cause [E-001].", ids)[0]
    assert not validate_citations("No citations here.", ids)[0]
    assert not validate_citations("Made up [E-999].", ids)[0]


def test_invalid_rules_fail_validation():
    raw = load_rules().model_dump()
    raw["hypotheses"][0]["support"][0]["fact"] = "made_up_fact"
    with pytest.raises(ValidationError):
        RuleSet.model_validate(raw)
    raw = load_rules().model_dump()
    raw["playbooks"][0]["options"] = [{"id": "X", "title": "x", "action": "format_disk"}]
    with pytest.raises(ValidationError):
        RuleSet.model_validate(raw)


def test_engine_never_imports_ground_truth():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "backend" / "linesight"
    for f in list((root / "engine").glob("*.py")) + list((root / "llm").glob("*.py")):
        assert "truth" not in f.read_text(), f
