"""Intervention option generators and verification checks (deterministic code).

Options for transport pacing are predicted by running the simulator on a copy
of the station: a model prediction, not a measurement.
"""
from __future__ import annotations

import copy
import math
from typing import Any

from ..models import InterventionOption, Station
from ..rules.loader import PlaybookDef
from ..simulator.transport import IN_PACKET_OVERHEAD, LINK_BPS, WIRE_OVERHEAD
from ..simulator.world import World
from ..station import COMPATIBILITY_MATRIX, adapter_for_firmware
from .facts import Fact


def _predict(world: World, action: str, params: dict[str, Any]) -> dict[str, Any]:
    w = copy.deepcopy(world)
    w.state["unavailable"], w.state["stale"] = [], []
    w.apply(action, params)
    d, _, _ = w.probe("inspect_acquisition_stats", {"mode": "production"})
    worst = max((p.get("latency_ms_p95", 0.0) for p in d["per_camera"].values()), default=0.0)
    return {
        "usable_frame_pct": d["usable_frame_pct"], "late_frame_pct": d.get("late_frame_pct", 0.0),
        "worst_latency_p95_ms": worst, "deadline_ms": d.get("deadline_ms"),
        "headroom_ms": round(d.get("deadline_ms", 0) - worst, 1), "line_rate_cps": d["line_rate_cps"],
        "avg_uplink_utilisation_pct": d.get("avg_uplink_utilisation_pct"),
        "per_camera_rate_mbps": d.get("budget", {}).get("per_camera_send_rate_mbps"),
    }


def _transport_pacing(pb: PlaybookDef, facts: dict[str, Fact], world: World, station: Station) -> list[InterventionOption]:
    req = station.requirements
    cams = list(world.state["cams"])
    n = len(cams)
    c0 = world.state["cams"][cams[0]]
    fair = math.floor(0.98 * LINK_BPS / 1e6 / n)
    payload = 1440 * 1080
    pkt = c0["packet_size"]
    wire = math.ceil(payload / (pkt - IN_PACKET_OVERHEAD)) * (pkt + WIRE_OVERHEAD)
    tx_full_ms = wire * 8 / LINK_BPS * 1000
    step = round(tx_full_ms + 1.0, 1)
    candidates = [
        ("O-PACE-FAIR", f"Limit each camera to {fair} Mb/s (sum fits the 1 Gb/s uplink)", "set_transport",
         {"throughput_limit_mbps": fair}),
        ("O-STAGGER", f"Full-rate transmission with {step} ms frame-transmission delay per camera", "set_transport",
         {"throughput_limit_mbps": 1000.0, "ftd_step_ms": step}),
        ("O-PACE-LOW", "Limit each camera to 150 Mb/s (maximum inter-packet delay)", "set_transport",
         {"throughput_limit_mbps": 150.0}),
        ("O-SLOW-LINE", "Run the line at 7 cartons/s instead of 10", "set_line_rate", {"rate_cps": 7.0}),
    ]
    out = []
    for oid, title, action, params in candidates:
        p = _predict(world, action, params)
        meets_rate = p["line_rate_cps"] >= req["line_rate_cps"]
        meets = p["usable_frame_pct"] >= req["usable_frame_pct_min"] and meets_rate and p["late_frame_pct"] <= 0.5
        if not meets_rate:
            trade = f"Mitigation only: {p['line_rate_cps']} cartons/s is below the required {req['line_rate_cps']}."
        elif not meets:
            trade = (f"Worst-camera p95 result latency {p['worst_latency_p95_ms']} ms misses the "
                     f"{p['deadline_ms']} ms reject-gate deadline; images complete but late.")
        else:
            trade = (f"Predicted {p['usable_frame_pct']}% usable at {p['line_rate_cps']} cartons/s; "
                     f"{p['headroom_ms']} ms headroom before the {p['deadline_ms']} ms deadline.")
        out.append(InterventionOption(id=oid, title=title, params=params, predicted=p, meets_requirements=meets,
                                      tradeoff=trade, action=action, playbook=pb.id))
    return out


def _adapter_match(pb: PlaybookDef, facts: dict[str, Fact], world: World, station: Station) -> list[InterventionOption]:
    cams = facts["adapter_missing_cams"].value if "adapter_missing_cams" in facts else []
    out = []
    for cam in cams:
        fw = world.state["cams"][cam]["firmware"]
        need = adapter_for_firmware(fw)
        meta = COMPATIBILITY_MATRIX["adapters"].get(need or "", {})
        if need and meta.get("separately_installable"):
            out.append(InterventionOption(
                id=f"O-INSTALL-{need}", title=f"Install {need} alongside existing adapters (camera unchanged)",
                params={"adapter": need}, action="install_adapter", playbook=pb.id, meets_requirements=True,
                tradeoff="No camera change; other cameras keep their current adapter. ~5 min, no line stop.",
                predicted={"control": "expected ok", "basis": "compatibility matrix"}))
        model = world.state["cams"][cam]["model"]
        for target in COMPATIBILITY_MATRIX["approved_firmware_changes"].get(model, {}).get(fw, []):
            out.append(InterventionOption(
                id=f"O-FW-{cam}-{target}", title=f"Change {cam} firmware {fw} → {target} to match installed adapter",
                params={"device": cam, "firmware": target}, action="change_firmware", playbook=pb.id,
                meets_requirements=True, tradeoff="Camera firmware change; needs ~15 min line stop and a power-cycle.",
                predicted={"control": "expected ok", "basis": "approved transition"}))
    return out


def _persistent_ip(pb, facts, world, station):
    out = []
    for cam in facts.get("subnet_mismatch_cams", Fact([])).value:
        ip = f"192.168.10.{10 + int(cam[3:])}"
        out.append(InterventionOption(id=f"O-IP-{cam}", title=f"Write persistent IP {ip} to {cam}", params={"device": cam, "ip": ip},
                                      action="set_persistent_ip", playbook=pb.id, meets_requirements=True,
                                      tradeoff="No production impact; camera re-opens on new address."))
    return out


def _trailer_scope(pb, facts, world, station):
    talon = [d.id for d in station.devices if d.kind == "camera" and d.vendor == "Harrier Optics"]
    return [
        InterventionOption(id="O-TRAILER-SCOPED", title=f"Ignore image trailer on {', '.join(talon)} only", params={"devices": talon},
                           action="set_ignore_trailer", playbook=pb.id, meets_requirements=True,
                           tradeoff="Setting is vendor-specific (S4); other cameras keep standard trailer handling.", recommended=True),
    ]


def _firmware_update(pb, facts, world, station):
    out = []
    for cam in facts.get("acq_start_failed_cams", Fact([])).value:
        c = world.state["cams"][cam]
        for target in COMPATIBILITY_MATRIX["approved_firmware_changes"].get(c["model"], {}).get(c["firmware"], []):
            out.append(InterventionOption(id=f"O-FW-{cam}-{target}", title=f"Update {cam} firmware {c['firmware']} → {target}",
                                          params={"device": cam, "firmware": target}, action="change_firmware", playbook=pb.id,
                                          meets_requirements=True, tradeoff="Line stop ~15 min; approved transition only."))
    return out


def _static(pb, facts, world, station):
    return [InterventionOption(id=o.id, title=o.title, params=o.params, action=o.action, playbook=pb.id,
                               meets_requirements=o.meets_requirements, tradeoff=o.tradeoff) for o in pb.options]


GENERATORS = {
    "transport_pacing": _transport_pacing, "adapter_match": _adapter_match, "persistent_ip": _persistent_ip,
    "trailer_scope": _trailer_scope, "firmware_update": _firmware_update, "static": _static,
}


def generate_options(pb: PlaybookDef, facts: dict[str, Fact], world: World, station: Station) -> list[InterventionOption]:
    opts = GENERATORS[pb.option_generator](pb, facts, world, station)
    meeting = [o for o in opts if o.meets_requirements]
    if meeting:
        best = max(meeting, key=lambda o: (o.predicted.get("headroom_ms", 0), -len(o.params)))
        for o in opts:
            o.recommended = o.id == best.id
    return opts


# --------------------------------------------------------------------------- verification

VERIFY_PROBES = {
    "production_usable": ("inspect_acquisition_stats", {"mode": "production"}, "stream.production"),
    "deadline": ("inspect_acquisition_stats", {"mode": "production"}, "stream.production"),
    "line_rate": ("inspect_acquisition_stats", {"mode": "production"}, "stream.production"),
    "control_all_ok": ("control_probe", {}, "control"),
    "plc_results_ok": ("inspect_plc_link", {}, "plc"),
    "single_ok": ("inspect_acquisition_stats", {"mode": "single"}, "stream.single"),
    "crash_recovery": ("compare_versions", {}, "versions"),
    "dashboard_fresh": ("inspect_management", {}, "mgmt"),
    "no_resets": ("inspect_topology", {}, "topology"),
}


def evaluate_check(check: str, data: dict[str, Any], station: Station, world: World) -> tuple[bool, str]:
    req = station.requirements
    if check == "production_usable":
        v = data.get("usable_frame_pct", 0.0)
        return v >= req["usable_frame_pct_min"], f"{v}% usable (need ≥ {req['usable_frame_pct_min']}%)"
    if check == "deadline":
        v = data.get("late_frame_pct", 100.0)
        return v <= 0.5, f"{v}% of frames late for the {data.get('deadline_ms')} ms deadline (need ≤ 0.5%)"
    if check == "line_rate":
        v = data.get("line_rate_cps", 0.0)
        return v >= req["line_rate_cps"], f"running at {v} cartons/s (need ≥ {req['line_rate_cps']})"
    if check == "control_all_ok":
        bad = {c: r["result"] for c, r in data["results"].items() if r["result"] != "ok"}
        return not bad, "all control channels open" if not bad else f"control failing: {bad}"
    if check == "plc_results_ok":
        bad = [c for c, p in data["per_camera"].items() if p["result_timeouts"]]
        return not bad, "every trigger answered with a result" if not bad else f"result timeouts on {bad}"
    if check == "single_ok":
        bad = [c for c, p in data["per_camera"].items() if p.get("error") or p["usable_frame_pct"] < 99.5]
        return not bad, "each camera acquires alone" if not bad else f"single-camera failures: {bad}"
    if check == "crash_recovery":
        ok = "KI-KESTREL-LOCK-RETAIN" not in data["sdk_known_issues"]
        return ok, "crash-restart test: control released at exit" if ok else "configuration still inside lock-retention scope"
    if check == "dashboard_fresh":
        age = data["last_publish_age_s"]
        return age <= 300, f"last dashboard update {age} s ago"
    if check == "no_resets":
        over = data["switch"]["poe"]["over_budget"]
        return not over, "PoE draw within budget" if not over else "PoE still over budget"
    raise ValueError(check)
