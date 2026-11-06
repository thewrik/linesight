"""Per-path health for the topology view.

Each functional path is judged only by evidence about that path. Discovery
success says nothing about image transport; an unchecked path is 'unknown'.
"""
from __future__ import annotations

from typing import Any

from ..models import CaseState, Evidence


def _latest(case: CaseState) -> dict[str, Evidence]:
    out: dict[str, Evidence] = {}
    for e in case.evidence:
        if e.kind.value == "customer_assertion" or e.status.value != "ok":
            continue
        if e.key not in out or e.received_seq > out[e.key].received_seq:
            out[e.key] = e
    return out


def path_status(case: CaseState) -> dict[str, dict[str, Any]]:
    L = _latest(case)
    cams = [d.id for d in case.station.devices if d.kind == "camera"]
    out: dict[str, dict[str, Any]] = {}

    def put(cid: str, status: str, ev: Evidence | None, note: str) -> None:
        out[cid] = {"status": status, "evidence": [ev.id] if ev else [], "note": note,
                    "after_intervention": bool(ev and ev.kind.value == "verification")}

    for c in cams:
        if e := L.get("discovery"):
            d = next(x for x in e.data["devices"] if x["device"] == c)
            put(f"{c}-disc", "ok" if d["found"] and d["subnet_ok"] else ("degraded" if d["found"] else "fail"), e,
                f"{'answers' if d['found'] else 'no answer to'} discovery at {d['ip']}" + ("" if d["subnet_ok"] else " (outside host subnet)"))
        else:
            put(f"{c}-disc", "unknown", None, "not checked")
        if e := L.get("control"):
            r = e.data["results"][c]
            put(f"{c}-ctrl", "ok" if r["result"] == "ok" else ("degraded" if r["result"] == "ok_with_errors" else "fail"), e, r["detail"])
        else:
            put(f"{c}-ctrl", "unknown", None, "not checked")
        e = L.get("stream.production")
        if e and c in e.data.get("per_camera", {}):
            p = e.data["per_camera"][c]
            if p.get("error"):
                put(f"{c}-strm", "fail", e, f"no usable images ({p['error']})")
            else:
                bad = p.get("late", 0) + p.get("incomplete", 0)
                status = "ok" if e.data["usable_frame_pct"] >= 99.5 else "degraded"
                put(f"{c}-strm", status, e, f"station {e.data['usable_frame_pct']}% usable; this camera worst in {bad} triggers; "
                                            f"{p.get('resend_requests', 0)} resend requests; p95 {p.get('latency_ms_p95', '?')} ms")
        else:
            put(f"{c}-strm", "unknown", None, "not checked")
        if e := L.get("plc"):
            p = e.data["per_camera"][c]
            put(f"{c}-trig", "ok" if p["frames_started"] else "fail", e, f"{p['frames_started']}/{p['triggers_sent']} triggers started a frame")
        else:
            put(f"{c}-trig", "unknown", None, "not checked")
        if e := L.get("topology"):
            link = e.data["links"][c]
            over = e.data["switch"]["poe"]["over_budget"]
            st = "fail" if link["reboots_24h"] or over else ("degraded" if link["crc_errors_per_min"] > 5 else "ok")
            put(f"{c}-poe", st, e, f"{link['poe_w']} W; CRC {link['crc_errors_per_min']}/min; resets 24 h: {link['reboots_24h']}"
                                   + ("; switch PoE over budget" if over else ""))
        else:
            put(f"{c}-poe", "unknown", None, "not checked")
    if e := L.get("plc"):
        put("host-plc", "ok" if e.data["result_link"] == "ok" else "fail", e, f"result link {e.data['result_link']}")
    else:
        put("host-plc", "unknown", None, "not checked")
    if e := L.get("mgmt"):
        put("host-mgmt", "ok" if e.data["tls_state"] == "connected" else "fail", e,
            f"{e.data['tls_state']}; dashboard update {e.data['last_publish_age_s']} s ago")
    else:
        put("host-mgmt", "unknown", None, "not checked")
    return out
