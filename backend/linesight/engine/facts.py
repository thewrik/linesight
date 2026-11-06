"""Deterministic derivation of named facts from evidence.

Rules never look at raw tool output; they look at facts. Each fact records the
evidence ids it was computed from, so every rule outcome is traceable.
A fact derived only from stale or unavailable evidence is reported as unknown.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..models import Evidence, EvidenceStatus, Station

PARSER_VERSION = "facts-1.2"


@dataclass
class Fact:
    value: Any
    evidence: list[str] = field(default_factory=list)


# which evidence key each fact comes from (used to compute "missing evidence")
FACT_SOURCES: dict[str, str] = {}


def _reg(key: str, *facts: str) -> None:
    for f in facts:
        FACT_SOURCES[f] = key


_reg("topology", "crc_cams", "flap_cams", "reboot_cams", "uplink_egress_drops", "poe_over_budget")
_reg("discovery", "discovery_missing", "subnet_mismatch_cams", "discovery_all_found")
_reg("control", "control_fail", "control_adapter_missing_cams", "control_access_denied_cams",
     "control_unreachable_cams", "register_write_cams", "control_all_ok")
_reg("versions", "adapter_missing_cams", "unreleased_fw_cams", "known_issue_ids", "sdk_lock_retention_issue",
     "trailer_ignored_on_non_talon", "talon_trailer_not_ignored")
_reg("stream.production", "prod_usable_pct", "prod_late_pct", "prod_incomplete_pct", "prod_resends_total",
     "prod_errors", "payload_invalid_cams", "app_drop_pct", "no_trigger_cams", "acq_start_failed_cams")
_reg("stream.low", "low_usable_pct", "low_resends_total")
_reg("stream.single", "single_all_clean", "single_bad_cams")
_reg("host", "host_perm_errors", "host_cpu", "host_backpressure_config", "locale_comma", "host_migrated", "linux_host")
_reg("plc", "trigger_missing_cams")
_reg("mgmt", "mgmt_tls_expired", "mgmt_identity_rejected", "dashboard_stale", "local_acq_running")
_reg("events", "crash_then_lock", "heartbeat_denied_after_gap", "reboot_event_cams", "poe_denied_event")
_reg("tech.viewer_single", "viewer_result")
_reg("tech.substitution", "substitution_result")
_reg("tech.idle_pattern", "idle_pattern")
_reg("tech.recent_changes", "changes_described")


def latest_by_key(evidence: list[Evidence]) -> dict[str, Evidence]:
    """Latest *captured* observation wins, regardless of the order it was received."""
    out: dict[str, Evidence] = {}
    for e in evidence:
        if e.kind.value in ("customer_assertion",):
            continue
        cur = out.get(e.key)
        if cur is None or e.captured_at >= cur.captured_at:
            out[e.key] = e
    return out


def derive_facts(evidence: list[Evidence], station: Station) -> dict[str, Fact]:
    by = latest_by_key(evidence)
    facts: dict[str, Fact] = {}
    vendor = {d.id: d.vendor for d in station.devices if d.kind == "camera"}

    def put(name: str, value: Any, e: Evidence) -> None:
        facts[name] = Fact(value, [e.id])

    def usable(key: str) -> Evidence | None:
        e = by.get(key)
        if e is None or e.status != EvidenceStatus.ok:
            return None
        return e

    if e := usable("topology"):
        links = e.data["links"]
        put("crc_cams", sorted(c for c, l in links.items() if l["crc_errors_per_min"] > 5), e)
        put("flap_cams", sorted(c for c, l in links.items() if l["link_flaps_24h"] > 0), e)
        put("reboot_cams", sorted(c for c, l in links.items() if l["reboots_24h"] > 0), e)
        put("uplink_egress_drops", e.data["switch"]["uplink_egress_drops_per_min"], e)
        put("poe_over_budget", e.data["switch"]["poe"]["over_budget"], e)

    if e := usable("discovery"):
        devs = e.data["devices"]
        put("discovery_missing", sorted(d["device"] for d in devs if not d["found"]), e)
        put("subnet_mismatch_cams", sorted(d["device"] for d in devs if d["found"] and not d["subnet_ok"]), e)
        put("discovery_all_found", all(d["found"] for d in devs), e)

    if e := usable("control"):
        res = e.data["results"]
        fail = {c: r["result"] for c, r in res.items() if r["result"] not in ("ok",)}
        put("control_fail", fail, e)
        put("control_adapter_missing_cams", sorted(c for c, r in fail.items() if r == "no_adapter"), e)
        put("control_access_denied_cams", sorted(c for c, r in fail.items() if r == "access_denied"), e)
        put("control_unreachable_cams", sorted(c for c, r in fail.items() if r == "unreachable"), e)
        put("register_write_cams", sorted(c for c, r in fail.items() if r == "ok_with_errors"), e)
        put("control_all_ok", not fail, e)

    if e := usable("versions"):
        comp = e.data["compatibility"]
        put("adapter_missing_cams", sorted(c for c, v in comp.items() if v["required_adapter"] and not v["installed"]), e)
        put("unreleased_fw_cams", sorted(e.data["unreleased_firmware"]), e)
        put("known_issue_ids", sorted({k for v in e.data["known_issues"].values() for k in v} | set(e.data["sdk_known_issues"])), e)
        put("sdk_lock_retention_issue", "KI-KESTREL-LOCK-RETAIN" in e.data["sdk_known_issues"], e)
        ign = e.data["ignore_trailer_on"]
        put("trailer_ignored_on_non_talon", any(vendor.get(c) != "Harrier Optics" for c in ign), e)
        put("talon_trailer_not_ignored", any(v == "Harrier Optics" and c not in ign for c, v in vendor.items()), e)

    if e := usable("stream.production"):
        d = e.data
        per = d.get("per_camera", {})
        put("prod_usable_pct", d.get("usable_frame_pct", 0.0), e)
        put("prod_late_pct", d.get("late_frame_pct", 0.0), e)
        put("prod_incomplete_pct", d.get("incomplete_frame_pct", 0.0), e)
        put("prod_resends_total", d.get("resend_requests_total", 0), e)
        put("prod_errors", d.get("errors", {}), e)
        put("payload_invalid_cams", sorted(c for c, p in per.items() if p.get("error") == "PAYLOAD_INVALID"), e)
        put("acq_start_failed_cams", sorted(c for c, p in per.items() if p.get("error") == "ACQUISITION_START_FAILED"), e)
        put("no_trigger_cams", sorted(c for c, p in per.items() if p.get("error") == "NO_TRIGGER_RECEIVED"), e)
        put("app_drop_pct", d.get("app_drop_pct", 0.0), e)

    if e := usable("stream.low"):
        put("low_usable_pct", e.data.get("usable_frame_pct", 0.0), e)
        put("low_resends_total", e.data.get("resend_requests_total", 0), e)

    if e := usable("stream.single"):
        per = e.data["per_camera"]
        testable = {c: p for c, p in per.items() if not p.get("error")}
        bad = sorted(c for c, p in testable.items() if p["usable_frame_pct"] < 99.5)
        put("single_bad_cams", bad, e)
        put("single_all_clean", bool(testable) and not bad, e)

    if e := usable("host"):
        d = e.data
        put("host_perm_errors", bool(d["permission_errors"]), e)
        put("host_cpu", d["cpu_pct_p95"], e)
        put("host_backpressure_config", d["debug_image_archive"] or d["buffer_pool_frames"] < 16, e)
        put("locale_comma", d["locale_decimal_separator"] == ",", e)
        put("host_migrated", bool(d["migrated_from"]), e)
        put("linux_host", d["linux"], e)

    if e := usable("plc"):
        put("trigger_missing_cams", sorted(c for c, p in e.data["per_camera"].items() if p["frames_started"] == 0), e)

    if e := usable("mgmt"):
        tls = e.data["tls_state"]
        put("mgmt_tls_expired", "expired" in tls, e)
        put("mgmt_identity_rejected", "identity" in tls and "rejected" in tls, e)
        put("dashboard_stale", e.data["last_publish_age_s"] > 300, e)
        put("local_acq_running", e.data["local_acquisition_heartbeat"] == "running", e)

    if e := usable("events"):
        ev = [x for x in e.data["events"] if not x.get("untrusted")]
        crash = any("terminated unexpectedly" in x["msg"] for x in ev)
        locked = any("already controlled" in x["msg"] for x in ev)
        put("crash_then_lock", crash and locked, e)
        put("heartbeat_denied_after_gap", sum(1 for x in ev if "ACCESS_DENIED" in x["msg"]), e)
        put("reboot_event_cams", sorted({x["device"] for x in ev if "Device reset" in x["msg"]}), e)
        put("poe_denied_event", any("PoE budget exceeded" in x["msg"] for x in ev), e)

    for key, fact in (("tech.viewer_single", "viewer_result"), ("tech.substitution", "substitution_result"),
                      ("tech.idle_pattern", "idle_pattern"), ("tech.recent_changes", "changes_described")):
        if e := usable(key):
            if e.data.get("answered"):
                put(fact, e.data.get("answer"), e)

    return facts


# --------------------------------------------------------------------------- symptoms

# Symptom tags. Each is observed or cleared by facts; a reported symptom with no
# observation yet is still "reported" (a customer assertion, not a fact).
def symptom_state(facts: dict[str, Fact]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}

    def obs(tag: str, ev: list[str], why: str) -> None:
        out[tag] = {"state": "observed", "evidence": ev, "why": why}

    def clr(tag: str, ev: list[str], why: str) -> None:
        if tag not in out:
            out[tag] = {"state": "cleared", "evidence": ev, "why": why}

    f = facts.get
    if (x := f("discovery_missing")) and x.value:
        obs("discovery_failure", x.evidence, f"not discovered: {', '.join(x.value)}")
    elif x := f("discovery_all_found"):
        clr("discovery_failure", x.evidence, "all cameras answer discovery")

    cf = f("control_fail")
    hb = f("heartbeat_denied_after_gap")
    ctl = f("crash_then_lock")
    if cf and cf.value:
        obs("control_failure", cf.evidence, f"control path failing: {cf.value}")
    elif hb and hb.value:
        obs("control_failure", hb.evidence, f"{hb.value} heartbeat ACCESS_DENIED events in window")
    elif ctl and ctl.value:
        obs("control_failure", ctl.evidence, "control lock after application crash")
    elif cf and hb is not None:
        clr("control_failure", cf.evidence + hb.evidence, "control opens now and no control-loss events in window")

    if (x := f("prod_usable_pct")) is not None:
        if x.value < 99.5:
            obs("frame_loss", x.evidence, f"only {x.value}% of production frames usable")
        else:
            clr("frame_loss", x.evidence, f"{x.value}% of production frames usable")

    if (x := f("trigger_missing_cams")) is not None:
        if x.value:
            obs("trigger_missing", x.evidence, f"no triggers reaching {', '.join(x.value)}")
        else:
            clr("trigger_missing", x.evidence, "every PLC trigger starts a frame")

    if (x := f("dashboard_stale")) is not None:
        if x.value:
            obs("dashboard_stale", x.evidence, "dashboard has not received station updates")
        else:
            clr("dashboard_stale", x.evidence, "dashboard updates are fresh")

    rb, rbe = f("reboot_cams"), f("reboot_event_cams")
    if (rb and rb.value) or (rbe and rbe.value):
        ev = (rb.evidence if rb else []) + (rbe.evidence if rbe else [])
        obs("camera_resets", ev, "camera uptime counters restarted")
    elif rb is not None:
        clr("camera_resets", rb.evidence, "no camera resets in 24 h")

    return out
