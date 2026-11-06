"""Causal station simulator with seeded fault injection.

The world holds hidden state (injected faults). The investigation engine can
only reach it through read-only probes, technician questions, and the
interventions a playbook allows. Probes derive observations from state, so a
configuration change or intervention changes what later probes return.
"""
from __future__ import annotations

import copy
import random
from datetime import datetime, timedelta
from typing import Any

from ..models import Station
from ..station import (
    COMPATIBILITY_MATRIX, adapter_for_firmware, known_issues_for, version_tuple,
)
from .transport import ASSUMPTIONS, CameraStream, TransportConfig, run_stream, static_budget

SIM_VERSION = "sim-1.3"


class ProbeUnavailable(Exception):
    pass


def _ts(base: datetime, minutes_ago: float) -> str:
    return (base - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds")


class World:
    def __init__(self, station: Station, hidden: dict[str, Any], seed: int, now: str):
        self.station = station
        self.seed = seed
        self.now = datetime.fromisoformat(now)
        self.rng = random.Random(seed)
        self._probe_count = 0
        self.hidden = copy.deepcopy(hidden)
        cams = [d for d in station.devices if d.kind == "camera"]
        self.state: dict[str, Any] = {
            "cams": {
                d.id: {
                    "vendor": d.vendor, "model": d.model, "firmware": d.firmware, "ip": d.attrs["ip"], "ip_ok": True,
                    "crc_per_min": 0.0, "flaps_24h": 0, "reboots_24h": 0, "uptime_h": 52.0, "control_holder": None,
                    "trailer_nonstandard": d.model == "Talon TX-12C", "chunk_mode": d.model == "Vireo GV-16M",
                    "throughput_limit_mbps": 245.0, "ftd_ms": 0.0, "packet_size": 1500, "poe_w": 4.8,
                    "triggered": True, "hw_fault": False, "corruption": 0.0, "fw_defect": False,
                }
                for d in cams
            },
            "host": {
                "sdk": station.versions.acquisition_sdk, "adapters": list(station.versions.adapters_installed),
                "os": station.versions.host_os, "locale_decimal": ".", "processing_ms": 12.0, "app_capacity_fps": 160.0, "buffer_pool": 64,
                "debug_image_archive": False, "filter_driver_perm_ok": True, "debug_heartbeat": False,
                "crashes_48h": 0, "heartbeat_gap_after_idle": False, "ignore_trailer_on": [],
                "nic_jumbo": False, "nic_rx_descriptors": 512, "migrated_from": None, "heartbeat_timeout_ms": 3000,
                "power_plan": "Balanced",
            },
            "switch": {
                "buffer_kb": next(d for d in station.devices if d.id == "sw1").attrs["buffer_kb"],
                "poe_budget_w": next(d for d in station.devices if d.id == "sw1").attrs["poe_budget_w"],
                "poe_priority_mode": "off", "heaters_w": 0.0,
            },
            "plc": {"result_link_ok": True},
            "mgmt": {"cert": "valid", "identity": "ok", "broker_reachable": True},
            "line": {
                "rate_cps": station.requirements["line_rate_cps"], "production_running": True,
                "test_window": True, "low_speed_cps": station.requirements["low_speed_cps"],
            },
            "background_occupancy_max": 0.4,
            "unavailable": [], "stale": [],
        }
        # installed baseline: the vendor-specific trailer setting is scoped to the Talon device(s) only (S4)
        self.state["host"]["ignore_trailer_on"] = [c for c, v in self.state["cams"].items() if v["trailer_nonstandard"]]
        self.log_lines: list[dict[str, Any]] = []
        for f in self.hidden.get("faults", []):
            self._inject(f)
        for path, value in self.hidden.get("state", {}).items():
            self._set(path, value)
        self.log_lines += self.hidden.get("extra_log_lines", [])

    # ------------------------------------------------------------------ fault injection

    def _set(self, dotted: str, value: Any) -> None:
        node = self.state
        parts = dotted.split(".")
        for p in parts[:-1]:
            node = node[p]
        node[parts[-1]] = value

    def _inject(self, f: dict[str, Any]) -> None:
        t, cam = f["type"], f.get("device")
        s = self.state
        if t == "burst_contention":
            for c in s["cams"].values():
                c["throughput_limit_mbps"] = f.get("throughput_limit_mbps", 265.0)
            s["switch"]["buffer_kb"] = f.get("switch_buffer_kb", s["switch"]["buffer_kb"])
        elif t == "adapter_mismatch":
            s["cams"][cam]["firmware"] = f.get("firmware", "5.0.2")
        elif t == "unreleased_firmware":
            s["cams"][cam]["firmware"] = f.get("firmware", "5.1.0-rc2")
        elif t == "subnet_mismatch":
            s["cams"][cam]["ip"], s["cams"][cam]["ip_ok"] = "169.254.33.7", False
        elif t == "stale_control_lock":
            s["host"]["sdk"] = f.get("sdk", "Kestrel Acquisition SDK 2.8.3")
            s["host"]["debug_heartbeat"] = True
            s["host"]["crashes_48h"] = f.get("crashes", 1)
            for c in f.get("devices", [cam]):
                s["cams"][c]["control_holder"] = "previous Meridian Inspect instance (pid 4412), heartbeat 300 s"
        elif t == "heartbeat_lockout_unresolved":
            s["host"]["heartbeat_gap_after_idle"] = True
            s["host"]["migrated_from"] = f.get("migrated_from", "EH-200 / Windows 10 IoT")
        elif t == "trailer_not_ignored":
            s["host"]["ignore_trailer_on"] = []
        elif t == "trailer_misapplied":
            s["host"]["ignore_trailer_on"] = list(s["cams"].keys())
        elif t == "firmware_defect":
            s["cams"][cam]["firmware"] = f.get("firmware", "2.7.1")
            s["cams"][cam]["fw_defect"] = True
        elif t == "locale_register_write":
            s["host"]["locale_decimal"] = ","
        elif t == "host_backpressure":
            s["host"]["app_capacity_fps"] = f.get("app_capacity_fps", 34.0)
            s["host"]["buffer_pool"] = 8
            s["host"]["debug_image_archive"] = True
        elif t == "device_permission":
            s["host"]["filter_driver_perm_ok"] = False
        elif t == "plc_trigger_missing":
            s["cams"][cam]["triggered"] = False
        elif t == "mgmt_cert_expired":
            s["mgmt"]["cert"] = "expired"
        elif t == "mgmt_identity_rejected":
            s["mgmt"]["identity"] = "rejected"
        elif t == "cable_fault":
            s["cams"][cam]["crc_per_min"] = f.get("crc_per_min", 55.0)
            s["cams"][cam]["flaps_24h"] = f.get("flaps", 6)
        elif t == "camera_hw_fault":
            s["cams"][cam]["hw_fault"] = True
            s["cams"][cam]["reboots_24h"] = 5
            s["cams"][cam]["uptime_h"] = 0.6
        elif t == "poe_budget":
            s["switch"]["heaters_w"] = f.get("heater_w", 12.0)
        elif t == "image_corruption_unknown":
            s["cams"][cam]["corruption"] = f.get("rate", 0.03)
        elif t == "none":
            pass
        else:
            raise ValueError(f"unknown fault type {t}")

    # ------------------------------------------------------------------ helpers

    def _check_available(self, tool: str) -> str:
        if tool in self.state["unavailable"]:
            raise ProbeUnavailable(f"{tool}: telemetry source did not respond")
        return "stale" if tool in self.state["stale"] else "ok"

    def _seed(self) -> int:
        self._probe_count += 1
        return self.seed * 1000 + self._probe_count

    def _poe(self) -> dict[str, Any]:
        sw = self.state["switch"]
        draw = sum(c["poe_w"] + sw["heaters_w"] for c in self.state["cams"].values())
        denied = draw > sw["poe_budget_w"] and sw["poe_priority_mode"] == "off"
        return {"draw_w": round(draw, 1), "budget_w": sw["poe_budget_w"], "over_budget": denied}

    def _control(self, cam_id: str) -> tuple[str, str]:
        c, h = self.state["cams"][cam_id], self.state["host"]
        if c["hw_fault"] and self.rng.random() < 0.3:
            return "unreachable", "no GVCP reply (camera rebooting?)"
        if self._poe()["over_budget"] and cam_id == max(self.state["cams"]):
            return "unreachable", "no GVCP reply; port power was denied at last heater cycle"
        if not c["ip_ok"]:
            return "unreachable", f"camera {c['ip']} not in host subnet 192.168.10.0/24"
        if c["vendor"] == "Corvid Imaging":
            needed = adapter_for_firmware(c["firmware"])
            if needed is None:
                return "no_adapter", f"no released adapter for firmware {c['firmware']}"
            if needed not in h["adapters"]:
                return "no_adapter", f"firmware {c['firmware']} requires {needed}; installed: {', '.join(h['adapters'])}"
        if c["control_holder"]:
            return "access_denied", f"control privilege held by {c['control_holder']}"
        if h["locale_decimal"] == "," and c["vendor"] == "Corvid Imaging":
            return "ok_with_errors", "control opened; float register writes rejected (Register write error)"
        return "ok", "control channel opened, heartbeat 3000 ms"

    def _transport_cfg(self, rate: float, cams: list[str], simultaneous: bool) -> TransportConfig:
        streams = [
            CameraStream(
                cam_id=cid, packet_size=self.state["cams"][cid]["packet_size"],
                throughput_limit_mbps=self.state["cams"][cid]["throughput_limit_mbps"],
                frame_tx_delay_ms=self.state["cams"][cid]["ftd_ms"],
            )
            for cid in cams
        ]
        h = self.state["host"]
        req = self.station.requirements
        return TransportConfig(
            cameras=streams, switch_buffer_kb=self.state["switch"]["buffer_kb"], line_rate_cps=rate,
            production_rate_cps=req["line_rate_cps"], simultaneous=simultaneous,
            gate_travel_ms=req["result_deadline_ms"] + 25.0, processing_ms=h["processing_ms"],
            background_occupancy_max=self.state["background_occupancy_max"],
        )

    def _cam_stream_blockers(self, cam_id: str) -> str | None:
        c, h = self.state["cams"][cam_id], self.state["host"]
        res, _ = self._control(cam_id)
        if res in ("unreachable", "no_adapter", "access_denied"):
            return f"CONTROL_{res.upper()}"
        if res == "ok_with_errors":
            return "REGISTER_WRITE_ERROR"
        if c["fw_defect"]:
            return "ACQUISITION_START_FAILED"
        if c["trailer_nonstandard"] and cam_id not in h["ignore_trailer_on"]:
            return "PAYLOAD_INVALID"
        if c["chunk_mode"] and cam_id in h["ignore_trailer_on"]:
            return "PAYLOAD_INVALID"
        return None

    # ------------------------------------------------------------------ read-only probes

    def probe(self, tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        """Returns (data, status, captured_at)."""
        status = self._check_available(tool)
        fn = getattr(self, f"_probe_{tool}")
        data = fn(**args)
        age = 180 if status == "stale" else round(self.rng.uniform(0.2, 2.0), 1)
        return data, status, _ts(self.now, age)

    def _probe_inspect_topology(self) -> dict[str, Any]:
        links = {}
        for cid, c in self.state["cams"].items():
            links[cid] = {
                "switch_port": int(cid[3:]), "speed_mbps": 1000, "crc_errors_per_min": c["crc_per_min"],
                "link_flaps_24h": c["flaps_24h"], "poe_w": c["poe_w"], "uptime_h": c["uptime_h"],
                "reboots_24h": c["reboots_24h"],
            }
        streaming = [c for c in self.state["cams"] if self._cam_stream_blockers(c) is None and self.state["cams"][c]["triggered"]]
        rate = self.state["line"]["rate_cps"]
        drops = 0.0
        if streaming:
            stats = run_stream(self._transport_cfg(rate, streaming, True), 120, self._seed())
            # resend requests over 120 triggers, scaled to one minute at the current line rate
            drops = sum(v["resend_requests"] for v in stats.per_camera.values()) * 60 / (120 / rate)
        poe = self._poe()
        return {
            "links": links,
            "switch": {
                "model": next(d.model for d in self.station.devices if d.id == "sw1"),
                "buffer_kb": self.state["switch"]["buffer_kb"],
                "uplink_port": 8, "uplink_egress_drops_per_min": round(drops),
                "poe": poe, "poe_denied_events_24h": 7 if poe["over_budget"] else 0,
            },
            "host_nic": {"jumbo_frames": self.state["host"]["nic_jumbo"], "rx_descriptors": self.state["host"]["nic_rx_descriptors"]},
        }

    def _probe_discovery_scan(self) -> dict[str, Any]:
        out = []
        for cid, c in self.state["cams"].items():
            found = not (c["hw_fault"] and self.rng.random() < 0.15)
            out.append({"device": cid, "found": found, "ip": c["ip"], "subnet_ok": c["ip_ok"],
                        "vendor": c["vendor"], "model": c["model"], "firmware": c["firmware"]})
        return {"devices": out, "protocol": "GVCP discovery broadcast"}

    def _probe_control_probe(self) -> dict[str, Any]:
        res = {}
        for cid in self.state["cams"]:
            r, detail = self._control(cid)
            res[cid] = {"result": r, "detail": detail}
        return {"results": res, "note": "Opens and immediately releases a control channel; read-only."}

    def _probe_compare_versions(self) -> dict[str, Any]:
        h = self.state["host"]
        compat, kis, unreleased = {}, {}, []
        for d in self.station.devices:
            if d.kind != "camera":
                continue
            c = self.state["cams"][d.id]
            dev = d.model_copy(update={"firmware": c["firmware"]})
            if c["vendor"] == "Corvid Imaging":
                need = adapter_for_firmware(c["firmware"])
                compat[d.id] = {"firmware": c["firmware"], "required_adapter": need, "installed": need in h["adapters"] if need else False}
                if c["firmware"] not in COMPATIBILITY_MATRIX["released_firmware"]["Vireo GV-16M"]:
                    unreleased.append(d.id)
            else:
                compat[d.id] = {"firmware": c["firmware"], "required_adapter": "generic GenTL", "installed": True}
            kis[d.id] = [k["id"] for k in known_issues_for(dev, h["sdk"])]
        sdk_v = h["sdk"].split()[-1]
        sdk_issues = []
        if version_tuple(sdk_v) < (3, 0) and h["debug_heartbeat"]:
            sdk_issues.append("KI-KESTREL-LOCK-RETAIN")
        return {
            "versions": {"host_os": h["os"], "acquisition_sdk": h["sdk"], "adapters_installed": h["adapters"],
                         "inspection_app": self.station.versions.inspection_app,
                         "camera_firmware": {k: v["firmware"] for k, v in self.state["cams"].items()}},
            "compatibility": compat, "known_issues": kis, "sdk_known_issues": sdk_issues,
            "unreleased_firmware": unreleased, "matrix": COMPATIBILITY_MATRIX["kind"],
            "ignore_trailer_on": h["ignore_trailer_on"],
        }

    def _probe_inspect_acquisition_stats(self, mode: str = "production") -> dict[str, Any]:
        line = self.state["line"]
        rate = line["low_speed_cps"] if mode == "low" else line["rate_cps"]
        cams = list(self.state["cams"])
        blockers = {c: self._cam_stream_blockers(c) for c in cams}
        streaming = [c for c in cams if blockers[c] is None]
        out: dict[str, Any] = {"mode": mode, "line_rate_cps": rate, "required_rate_cps": self.station.requirements["line_rate_cps"],
                               "assumptions": ASSUMPTIONS}
        if mode == "single":
            per = {}
            for c in cams:
                if blockers[c]:
                    per[c] = {"usable_frame_pct": 0.0, "error": blockers[c]}
                    continue
                st = run_stream(self._transport_cfg(rate, [c], False), 200, self._seed())
                usable = st.usable_frame_pct
                usable = self._apply_cam_impairments(c, usable, 200, alone=True)
                per[c] = {"usable_frame_pct": usable, "latency_ms_p95": st.per_camera[c]["latency_ms_p95"],
                          "resend_requests": st.per_camera[c]["resend_requests"], "error": None}
            out["per_camera"] = per
            out["note"] = "Each camera acquired alone at production trigger rate during a test window."
            return out
        if not streaming:
            out.update({"usable_frame_pct": 0.0, "per_camera": {c: {"error": blockers[c]} for c in cams}, "errors": {}})
            return out
        cfg = self._transport_cfg(rate, streaming, True)
        st = run_stream(cfg, 600, self._seed())
        errors: dict[str, int] = {}
        per = {}
        h = self.state["host"]
        demand = len(streaming) * rate
        capacity = h["app_capacity_fps"]  # frames/s the inspection workers can accept (assumption)
        if not h["filter_driver_perm_ok"]:
            capacity *= 0.2  # socket-driver fallback costs CPU per packet (assumption)
        pool_drop = max(0.0, 1 - capacity / demand) if demand else 0.0
        if h["buffer_pool"] < 16 and pool_drop > 0:
            pool_drop = min(1.0, pool_drop * 1.6)
        for c in cams:
            if blockers[c]:
                per[c] = {"error": blockers[c], "usable_frame_pct": 0.0}
                errors[blockers[c]] = errors.get(blockers[c], 0) + 600
                continue
            p = dict(st.per_camera[c])
            p["error"] = None
            per[c] = p
        usable = st.usable_frame_pct
        if st.late_frame_pct > 0:
            errors["TOO_MANY_CONSECUTIVE_RESENDS"] = int(sum(v["late"] for v in st.per_camera.values()) * 0.6)
            errors["AUTO_ABORTED"] = int(sum(v["late"] for v in st.per_camera.values()) * 0.4)
        if pool_drop > 0:
            errors["IMAGE_POOL_FULL"] = int(600 * pool_drop)
            usable = round(usable * (1 - pool_drop), 2)
        for c in streaming:
            u = self._apply_cam_impairments(c, 100.0, 600, alone=False)
            if u < 100:
                usable = round(usable * u / 100, 2)
                per[c]["usable_frame_pct"] = u
                if self.state["cams"][c]["crc_per_min"] > 0:
                    errors["BUFFER_INCOMPLETE"] = errors.get("BUFFER_INCOMPLETE", 0) + int(600 * (100 - u) / 100)
        missing_trigger = [c for c in cams if not self.state["cams"][c]["triggered"]]
        for c in missing_trigger:
            per[c] = {"error": "NO_TRIGGER_RECEIVED", "frames": 0, "usable_frame_pct": 0.0}
            errors["RESULT_TIMEOUT"] = errors.get("RESULT_TIMEOUT", 0) + 600
            usable = 0.0 if len(missing_trigger) == len(cams) else round(usable * 0.75, 2)
        if any(blockers.values()):
            usable = round(usable * len(streaming) / len(cams), 2)
        out.update({
            "usable_frame_pct": usable, "incomplete_frame_pct": st.incomplete_frame_pct, "late_frame_pct": st.late_frame_pct,
            "avg_uplink_utilisation_pct": st.avg_uplink_utilisation_pct, "deadline_ms": st.deadline_ms,
            "per_camera": per, "errors": errors, "budget": static_budget(cfg),
            "resend_requests_total": sum(v.get("resend_requests", 0) for v in per.values()),
            "app_drop_pct": round(100 * pool_drop, 1), "achieved_rate_cps": rate,
            "triggers": 600,
        })
        return out

    def _apply_cam_impairments(self, cam: str, usable: float, n: int, alone: bool) -> float:
        c = self.state["cams"][cam]
        rng = random.Random(self._seed())
        bad = 0
        for _ in range(n):
            if c["crc_per_min"] > 0 and rng.random() < min(0.5, c["crc_per_min"] / 600):
                bad += 1
            elif c["corruption"] > 0 and rng.random() < c["corruption"]:
                pass  # corruption is NOT visible in transport counters
            elif c["hw_fault"] and rng.random() < 0.02:
                bad += 1
        return round(usable * (1 - bad / n), 2)

    def _probe_inspect_host(self) -> dict[str, Any]:
        h = self.state["host"]
        perm = [] if h["filter_driver_perm_ok"] else ["open('/dev/ksgev0'): Permission denied — falling back to socket driver"]
        cpu = 34 + (25 if not h["filter_driver_perm_ok"] else 0) + (30 if h["debug_image_archive"] else 0)
        return {
            "os": h["os"], "sdk": h["sdk"], "cpu_pct_p95": min(99, cpu), "buffer_pool_frames": h["buffer_pool"],
            "debug_image_archive": h["debug_image_archive"], "debug_heartbeat_extension": h["debug_heartbeat"],
            "processing_ms_p95": h["processing_ms"], "permission_errors": perm,
            "locale_decimal_separator": h["locale_decimal"], "migrated_from": h["migrated_from"],
            "nic": {"jumbo_frames": h["nic_jumbo"], "rx_descriptors": h["nic_rx_descriptors"]},
            "power_plan": h["power_plan"], "linux": "Ubuntu" in h["os"],
        }

    def _probe_inspect_plc_link(self) -> dict[str, Any]:
        per = {}
        for cid, c in self.state["cams"].items():
            sent = 600
            per[cid] = {"triggers_sent": sent, "frames_started": sent if c["triggered"] else 0,
                        "result_timeouts": 0 if c["triggered"] else sent}
        return {"per_camera": per, "result_link": "ok" if self.state["plc"]["result_link_ok"] else "down",
                "window": "last 60 s of production"}

    def _probe_inspect_management(self) -> dict[str, Any]:
        m = self.state["mgmt"]
        if m["cert"] == "expired":
            tls, age = "rejected: client certificate expired 2 days ago", 51 * 3600
        elif m["identity"] == "rejected":
            tls, age = "rejected: client identity 'eh-310-a3' not enrolled (expected 'eh-200-a3')", 40 * 3600
        else:
            tls, age = "connected", 4
        healthy = tls == "connected"
        return {
            "transport": "MQTT over TLS :8883", "tls_state": tls, "last_publish_age_s": age,
            "dashboard_camera_status": {c: ("online" if healthy else "offline (stale)") for c in self.state["cams"]},
            "local_acquisition_heartbeat": "running",
        }

    def _probe_correlate_events(self, window_h: int = 48) -> dict[str, Any]:
        h = self.state["host"]
        ev: list[dict[str, Any]] = []
        base = self.now
        if h["crashes_48h"]:
            for i in range(h["crashes_48h"]):
                t = _ts(base, 300 + 600 * i)
                ev.append({"t": t, "source": "host", "device": "host", "msg": "Meridian Inspect terminated unexpectedly (exit 0xC0000005)"})
                ev.append({"t": _ts(base, 299 + 600 * i), "source": "app", "device": "cam*", "msg": "Open device failed: device is already controlled by another application"})
        if h["heartbeat_gap_after_idle"]:
            for i, mins in enumerate([2350, 1260, 70]):
                ev.append({"t": _ts(base, mins + 61), "source": "app", "device": "host", "msg": "Line idle (no software triggers) — polling at 3 s interval"})
                ev.append({"t": _ts(base, mins), "source": "pcap", "device": "cam*",
                           "msg": "GVCP heartbeat WRITEREG after 3.2 s gap; ACK status ACCESS_DENIED from all 4 cameras"})
                ev.append({"t": _ts(base, mins - 1), "source": "app", "device": "cam*", "msg": "Software trigger failed: device not accessible"})
                ev.append({"t": _ts(base, mins - 9), "source": "operator", "device": "host", "msg": "Application restarted by operator; cameras reconnect"})
        for cid, c in self.state["cams"].items():
            if c["reboots_24h"]:
                for i in range(min(3, c["reboots_24h"])):
                    ev.append({"t": _ts(base, 40 + 230 * i), "source": "camera", "device": cid, "msg": "Device reset detected (uptime counter restarted)"})
            if c["flaps_24h"]:
                ev.append({"t": _ts(base, 95), "source": "switch", "device": cid, "msg": f"Port {cid[3:]} link down/up ({c['flaps_24h']}x in 24 h)"})
        if self._poe()["over_budget"]:
            ev.append({"t": _ts(base, 120), "source": "switch", "device": "sw1", "msg": "PoE budget exceeded at heater cycle; power denied on lowest-priority port"})
        m = self.state["mgmt"]
        if m["cert"] == "expired":
            ev.append({"t": _ts(base, 3060), "source": "agent", "device": "mgmt", "msg": "TLS handshake failed: certificate has expired"})
        if m["identity"] == "rejected":
            ev.append({"t": _ts(base, 2400), "source": "agent", "device": "mgmt", "msg": "Broker rejected client identity"})
        if not h["filter_driver_perm_ok"]:
            ev.append({"t": _ts(base, 2500), "source": "host", "device": "host", "msg": "ksgev filter driver: permission denied for service user 'meridian'"})
        for line in self.log_lines:
            ev.append({**line, "t": line.get("t") or _ts(base, line.get("minutes_ago", 30)), "untrusted": True})
        ev.sort(key=lambda e: e["t"])
        return {"window_h": window_h, "events": ev}

    # ------------------------------------------------------------------ technician

    def technician(self, question: str, args: dict[str, Any]) -> dict[str, Any]:
        tech = self.hidden.get("technician", {})
        if question in tech.get("unavailable", []):
            return {"answered": False, "answer": "Technician cannot perform this check now", "reason": tech.get("reason", "no maintenance window")}
        if question in tech.get("answers", {}):
            return {"answered": True, **tech["answers"][question]}
        cams = self.state["cams"]
        if question == "viewer_single":
            cam = args.get("device", "cam3")
            r, _ = self._control(cam)
            if r in ("no_adapter", "access_denied", "unreachable"):
                return {"answered": True, "answer": "visible_cannot_connect", "detail": f"Viewer lists {cam} but cannot open it"}
            return {"answered": True, "answer": "acquires_ok", "detail": f"Viewer acquires {cam} alone without errors"}
        if question == "substitution":
            cam = args.get("device")
            c = cams[cam]
            if c["crc_per_min"] > 0:
                return {"answered": True, "answer": "fault_follows_cable", "detail": f"Swapped {cam}'s patch cable with a known-good one: CRC errors moved with the old cable"}
            if c["hw_fault"]:
                return {"answered": True, "answer": "fault_follows_camera", "detail": f"Moved {cam} to a spare port with a known-good cable: resets continue on that camera"}
            return {"answered": True, "answer": "no_change", "detail": "Swap made no difference"}
        if question == "idle_pattern":
            if self.state["host"]["heartbeat_gap_after_idle"]:
                return {"answered": True, "answer": "after_idle", "detail": "Happens after breaks / changeovers, roughly an hour without triggers. Not every time."}
            return {"answered": True, "answer": "no_pattern", "detail": "No link to idle periods noticed"}
        if question == "recent_changes":
            return {"answered": True, "answer": "see_detail", "detail": self.hidden.get("changes_detail", "Nothing changed that I know of")}
        return {"answered": False, "answer": "unknown question"}

    # ------------------------------------------------------------------ interventions (simulated)

    def apply(self, action: str, params: dict[str, Any]) -> str:
        s = self.state
        if action == "set_transport":
            for cid in params.get("devices", list(s["cams"])):
                if "throughput_limit_mbps" in params:
                    s["cams"][cid]["throughput_limit_mbps"] = params["throughput_limit_mbps"]
                if "ftd_step_ms" in params:
                    s["cams"][cid]["ftd_ms"] = params["ftd_step_ms"] * (int(cid[3:]) - 1)
            return "transport parameters written to camera profiles"
        if action == "set_line_rate":
            s["line"]["rate_cps"] = params["rate_cps"]
            return f"line rate set to {params['rate_cps']} cartons/s"
        if action == "install_adapter":
            if params["adapter"] not in s["host"]["adapters"]:
                s["host"]["adapters"].append(params["adapter"])
            return f"installed {params['adapter']}"
        if action == "change_firmware":
            s["cams"][params["device"]]["firmware"] = params["firmware"]
            if s["cams"][params["device"]]["model"] == "Talon TX-12C" and params["firmware"] != "2.7.1":
                s["cams"][params["device"]]["fw_defect"] = False
            return f"{params['device']} firmware -> {params['firmware']}"
        if action == "set_persistent_ip":
            c = s["cams"][params["device"]]
            c["ip"], c["ip_ok"] = params["ip"], True
            return f"persistent IP {params['ip']} written"
        if action == "release_control":
            for c in s["cams"].values():
                c["control_holder"] = None
            return "camera ports power-cycled; stale control released"
        if action == "disable_debug_heartbeat":
            s["host"]["debug_heartbeat"] = False
            for c in s["cams"].values():
                c["control_holder"] = None
            return "debug heartbeat extension removed from production profile"
        if action == "set_ignore_trailer":
            s["host"]["ignore_trailer_on"] = list(params["devices"])
            return f"ignore-trailer set on {params['devices']} only"
        if action == "set_locale":
            s["host"]["locale_decimal"] = "."
            return "service locale set to en-US number format"
        if action == "host_buffers":
            s["host"]["buffer_pool"], s["host"]["debug_image_archive"], s["host"]["app_capacity_fps"] = 64, False, 160.0
            return "image pool raised to 64; debug image archive disabled"
        if action == "fix_permission":
            s["host"]["filter_driver_perm_ok"] = True
            return "udev rule installed; service user added to group"
        if action == "restore_trigger_map":
            for c in s["cams"].values():
                c["triggered"] = True
            return "I/O trigger mapping restored from Line 3 profile"
        if action == "renew_cert":
            s["mgmt"]["cert"] = "valid"
            return "client certificate renewed via enrollment service"
        if action == "reenroll":
            s["mgmt"]["identity"] = "ok"
            return "edge host re-enrolled with plant broker"
        if action == "poe_priority":
            s["switch"]["poe_priority_mode"] = "on"
            return "PoE priority/power-mode configured"
        raise ValueError(f"action {action} not implemented by simulator")


def world_to_dict(w: World) -> dict[str, Any]:
    st = w.rng.getstate()
    return {"station": w.station.model_dump(), "hidden": w.hidden, "seed": w.seed, "now": w.now.isoformat(),
            "state": w.state, "probe_count": w._probe_count, "log_lines": w.log_lines,
            "rng": [st[0], list(st[1]), st[2]]}


def world_from_dict(d: dict[str, Any]) -> World:
    w = World.__new__(World)
    w.station = Station.model_validate(d["station"])
    w.hidden, w.seed, w.now = d["hidden"], d["seed"], datetime.fromisoformat(d["now"])
    w.state, w._probe_count, w.log_lines = d["state"], d["probe_count"], d["log_lines"]
    w.rng = random.Random()
    w.rng.setstate((d["rng"][0], tuple(d["rng"][1]), d["rng"][2]))
    return w
