"""One station template (LS-4 label & batch-code inspection) and its customer configurations.

All companies, products and version numbers here are FICTIONAL. The compatibility
matrix and known-issue catalogue are authored for the simulator; they mirror the
*mechanisms* documented in the source register, not any real vendor's matrix.
"""
from __future__ import annotations

import copy
from typing import Any

from .models import Connection, Device, PathKind, Station, VersionSet

# Fictional vendors / products
CAMERA_A = {"vendor": "Corvid Imaging", "model": "Vireo GV-16M"}  # 1440x1080 Mono8 GigE Vision
CAMERA_B = {"vendor": "Harrier Optics", "model": "Talon TX-12C"}  # second vendor, non-standard trailer
SDK_NAME = "Kestrel Acquisition SDK"
APP_NAME = "Meridian Inspect"

# Adapter packages ship with the inspection app but are versioned by camera firmware line.
# Mirrors source S2: the adapter must match the device firmware, and app/firmware numbers differ.
COMPATIBILITY_MATRIX: dict[str, Any] = {
    "kind": "fictional, authored for the simulator",
    "rule": "A Vireo camera can be controlled only if an adapter with the same firmware major.minor is installed.",
    "adapters": {
        "vireo-adapter-4.2": {"firmware_line": "4.2", "ships_with": ["Meridian Inspect 6.2", "Meridian Inspect 6.3"]},
        "vireo-adapter-4.3": {"firmware_line": "4.3", "ships_with": ["Meridian Inspect 6.4"]},
        "vireo-adapter-5.0": {"firmware_line": "5.0", "ships_with": ["Meridian Inspect 6.5"], "separately_installable": True},
    },
    "released_firmware": {"Vireo GV-16M": ["4.2.1", "4.3.0", "4.3.2", "5.0.2"]},
    "approved_firmware_changes": {
        # firmware transitions support is allowed to perform remotely via a playbook
        "Vireo GV-16M": {"5.0.2": ["4.3.2"], "4.2.1": ["4.3.2"]},
        "Talon TX-12C": {"2.7.1": ["2.7.3"]},
    },
}

# Known issues: narrowly scoped by vendor / model / firmware (mirrors source S4's scoping).
KNOWN_ISSUES: list[dict[str, Any]] = [
    {
        "id": "KI-TALON-TRAILER",
        "title": "Talon cameras send a non-standard GVSP image trailer",
        "scope": {"vendor": "Harrier Optics", "model": "Talon TX-12C", "firmware": "*"},
        "symptom": "frames rejected as invalid payload; preview empty",
        "workaround": "Enable 'ignore image trailer' for the affected Talon device only. Do not apply to other devices.",
        "sources": ["S4"],
        "mechanism": "documented_mechanism_replay",
    },
    {
        "id": "KI-TALON-FW-271",
        "title": "Talon TX-12C firmware 2.7.1 fails GigE Vision acquisition",
        "scope": {"vendor": "Harrier Optics", "model": "Talon TX-12C", "firmware": "2.7.1"},
        "symptom": "acquisition fails regardless of transport settings",
        "workaround": "Update to firmware 2.7.3 (approved transition).",
        "sources": ["S4"],
        "mechanism": "documented_mechanism_replay",
    },
    {
        "id": "KI-KESTREL-LOCK-RETAIN",
        "title": "Kestrel SDK < 3.0 does not release control after a crash while a debug heartbeat is configured",
        "scope": {"sdk_lt": "3.0", "condition": "debug heartbeat extension enabled"},
        "symptom": "'device is already controlled' after the application restarts",
        "workaround": "Wait for heartbeat expiry or power-cycle the camera port; remove debug heartbeat setting.",
        "sources": ["S3"],
        "mechanism": "documented_mechanism_replay",
    },
]


def _devices(camera_specs: list[dict[str, Any]], host: dict[str, Any], switch: dict[str, Any]) -> list[Device]:
    devs = []
    for i, spec in enumerate(camera_specs, start=1):
        devs.append(
            Device(
                id=f"cam{i}", kind="camera", label=f"Camera {i}", vendor=spec["vendor"], model=spec["model"],
                firmware=spec["firmware"], role=spec["role"],
                attrs={"ip": f"192.168.10.{10 + i}", "switch_port": i, "poe_class": 3},
            )
        )
    devs += [
        Device(id="sw1", kind="switch", label="PoE switch", vendor="NetPier", model=switch["model"],
               firmware=switch["firmware"], attrs={"ports": 8, "buffer_kb": switch["buffer_kb"], "poe_budget_w": switch["poe_budget_w"]}),
        Device(id="host", kind="edge_host", label="Edge host", vendor="Meridian", model=host["model"],
               attrs={"os": host["os"], "nic": host["nic"]}),
        Device(id="plc", kind="plc", label="Line PLC", vendor="Generic", model="Line controller",
               attrs={"trigger": "24 V hardware trigger per camera", "result_link": "Modbus/TCP result registers (simplified)"}),
        Device(id="mgmt", kind="mgmt_service", label="Plant dashboard", vendor="Plant IT", model="Station management broker",
               attrs={"protocol": "MQTT over TLS :8883"}),
    ]
    return devs


def _connections(n_cams: int) -> list[Connection]:
    conns = []
    for i in range(1, n_cams + 1):
        c = f"cam{i}"
        conns += [
            Connection(id=f"{c}-disc", a="host", b=c, path=PathKind.discovery, protocol="GVCP discovery (UDP 3956 broadcast)"),
            Connection(id=f"{c}-ctrl", a="host", b=c, path=PathKind.control, protocol="GVCP control channel + heartbeat"),
            Connection(id=f"{c}-strm", a=c, b="host", path=PathKind.stream, protocol="GVSP image stream (UDP)"),
            Connection(id=f"{c}-trig", a="plc", b=c, path=PathKind.trigger, protocol="24 V hardware trigger"),
            Connection(id=f"{c}-poe", a="sw1", b=c, path=PathKind.power, protocol="PoE 802.3af"),
        ]
    conns += [
        Connection(id="host-plc", a="host", b="plc", path=PathKind.trigger, protocol="Result handshake (Modbus/TCP, simplified)"),
        Connection(id="host-mgmt", a="host", b="mgmt", path=PathKind.management, protocol="MQTT over TLS (client certificate)"),
    ]
    return conns


VIREO = lambda fw, role: {**CAMERA_A, "firmware": fw, "role": role}  # noqa: E731
TALON = lambda fw, role: {**CAMERA_B, "firmware": fw, "role": role}  # noqa: E731
ROLES = ["Front label", "Back label", "Batch code (top)", "Batch code (side)"]

CONFIGS: dict[str, dict[str, Any]] = {
    "plant-a-line3": {
        "site": "Fictional contract packager, Plant A",
        "line": "Line 3 — carton labelling",
        "cameras": [VIREO("4.3.2", r) for r in ROLES],
        "host": {"model": "EH-310", "os": "Windows 11 IoT LTSC", "nic": "4-port PCIe GigE"},
        "switch": {"model": "NP-8L managed PoE", "firmware": "1.4.0", "buffer_kb": 448, "poe_budget_w": 65},
        "versions": {
            "host_os": "Windows 11 IoT LTSC 24H2", "acquisition_sdk": f"{SDK_NAME} 3.2.0", "inspection_app": f"{APP_NAME} 6.4.1",
            "adapters_installed": ["vireo-adapter-4.3"], "nic_driver": "igb 13.0", "plc_program": "L3-PKG r27", "mgmt_agent": "station-agent 2.1",
        },
        "requirements": {"line_rate_cps": 10.0, "low_speed_cps": 4.0, "result_deadline_ms": 75.0, "usable_frame_pct_min": 99.5},
    },
    "plant-b-line1": {
        "site": "Fictional contract packager, Plant B",
        "line": "Line 1 — pharma secondary packaging",
        "cameras": [VIREO("4.3.2", ROLES[0]), VIREO("4.3.2", ROLES[1]), VIREO("4.3.2", ROLES[2]), TALON("2.7.3", ROLES[3])],
        "host": {"model": "EH-200", "os": "Windows 10 IoT LTSC", "nic": "2-port PCIe GigE"},
        "switch": {"model": "NP-8G managed PoE", "firmware": "1.2.7", "buffer_kb": 1536, "poe_budget_w": 120},
        "versions": {
            "host_os": "Windows 10 IoT LTSC 21H2", "acquisition_sdk": f"{SDK_NAME} 3.1.4", "inspection_app": f"{APP_NAME} 6.4.0",
            "adapters_installed": ["vireo-adapter-4.3"], "nic_driver": "igb 12.18", "plc_program": "B1-PH r9", "mgmt_agent": "station-agent 2.0",
        },
        "requirements": {"line_rate_cps": 8.0, "low_speed_cps": 3.0, "result_deadline_ms": 90.0, "usable_frame_pct_min": 99.5},
    },
    "plant-c-line2": {
        "site": "Fictional contract packager, Plant C",
        "line": "Line 2 — food cartons",
        "cameras": [VIREO("4.3.2", r) for r in ROLES],
        "host": {"model": "EH-310L", "os": "Ubuntu 22.04 LTS", "nic": "4-port PCIe GigE"},
        "switch": {"model": "NP-8G managed PoE", "firmware": "1.2.7", "buffer_kb": 1536, "poe_budget_w": 120},
        "versions": {
            "host_os": "Ubuntu 22.04.4 LTS", "acquisition_sdk": f"{SDK_NAME} 3.2.0", "inspection_app": f"{APP_NAME} 6.4.1",
            "adapters_installed": ["vireo-adapter-4.3"], "nic_driver": "igb 5.15-kernel", "plc_program": "C2-FD r4", "mgmt_agent": "station-agent 2.1",
        },
        "requirements": {"line_rate_cps": 10.0, "low_speed_cps": 4.0, "result_deadline_ms": 75.0, "usable_frame_pct_min": 99.5},
    },
}


def build_station(config_id: str, overrides: dict[str, Any] | None = None) -> Station:
    cfg = copy.deepcopy(CONFIGS[config_id])
    overrides = overrides or {}
    for k, v in overrides.get("versions", {}).items():
        cfg["versions"][k] = v
    for k, v in overrides.get("switch", {}).items():
        cfg["switch"][k] = v
    for k, v in overrides.get("host", {}).items():
        cfg["host"][k] = v
    for cam_id, fw in overrides.get("camera_firmware", {}).items():
        cfg["cameras"][int(cam_id[3:]) - 1]["firmware"] = fw
    for cam_id, spec in overrides.get("camera_model", {}).items():
        cfg["cameras"][int(cam_id[3:]) - 1].update(spec)
    devices = _devices(cfg["cameras"], cfg["host"], cfg["switch"])
    versions = VersionSet(
        camera_firmware={d.id: d.firmware for d in devices if d.kind == "camera"}, **cfg["versions"]
    )
    return Station(
        id=config_id, site=cfg["site"], line=cfg["line"], template="LS-4 label & batch-code inspection",
        devices=devices, connections=_connections(len(cfg["cameras"])), versions=versions,
        requirements=cfg["requirements"],
    )


def adapter_for_firmware(firmware: str) -> str | None:
    line = ".".join(firmware.split(".")[:2])
    for name, a in COMPATIBILITY_MATRIX["adapters"].items():
        if a["firmware_line"] == line:
            return name
    return None


def known_issues_for(device: Device, sdk_version: str) -> list[dict[str, Any]]:
    out = []
    for ki in KNOWN_ISSUES:
        s = ki["scope"]
        if "vendor" in s:
            if s["vendor"] == device.vendor and s["model"] == device.model and s["firmware"] in ("*", device.firmware):
                out.append(ki)
    return out


def version_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split(".") if x.isdigit())
