"""A deliberately small GigE Vision stream (GVSP) burst-contention model.

This is NOT a model of real GigE behaviour. It exists so that configuration
changes and interventions change the generated telemetry in a way that follows
one documented mechanism: several cameras triggered together send their frames
at once, the switch egress port toward the host drains at link rate, and when
the instantaneous arrival rate exceeds the drain rate the queue grows; packets
that do not fit in the port buffer are dropped and must be resent.

Every assumption is listed in ASSUMPTIONS and surfaced in the UI.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

ASSUMPTIONS = [
    "Each camera link and the host uplink are 1000 Mb/s full duplex.",
    "Per-packet overhead on the wire: 20 B IP + 8 B UDP + 8 B GVSP header inside the packet, "
    "plus 14 B Ethernet header + 4 B FCS + 8 B preamble + 12 B inter-frame gap outside it.",
    "A camera's throughput limit is enforced by an inter-packet delay; the camera then sends at a "
    "constant rate for the whole frame.",
    "All cameras share one switch egress port toward the host with a fixed buffer; overflow bytes are dropped.",
    "The host requests resends after a packet timeout. Each resend round costs the timeout plus "
    "the time to retransmit the missing bytes; a round recovers a fixed share of what is missing.",
    "A frame is usable only if it completes and the inspection result reaches the PLC before the "
    "reject-gate deadline. The deadline is the gate travel time minus actuator margin.",
    "Trigger-to-transmit start jitter per camera is uniform in +/- jitter_ms.",
    "Other ports share the switch packet memory: at each burst a random share of the egress buffer "
    "(uniform 0..background_occupancy_max) is already occupied. This is a confounder that makes "
    "loss intermittent; it is a stand-in, not a measured property of any switch.",
    "Average bandwidth is reported separately from burst behaviour: a link can be well under "
    "capacity on average and still overflow during synchronous bursts.",
]

LINK_BPS = 1_000_000_000
IN_PACKET_OVERHEAD = 36  # IP + UDP + GVSP
WIRE_OVERHEAD = 38  # Ethernet header + FCS + preamble + IFG


@dataclass
class CameraStream:
    cam_id: str
    width: int = 1440
    height: int = 1080
    bytes_per_pixel: float = 1.0
    packet_size: int = 1500  # bytes, GevSCPSPacketSize-equivalent
    throughput_limit_mbps: float = 1000.0
    frame_tx_delay_ms: float = 0.0  # delay between trigger and start of transmission (FTD-equivalent)
    exposure_ms: float = 1.5

    @property
    def payload_bytes(self) -> int:
        return int(self.width * self.height * self.bytes_per_pixel)

    @property
    def packets(self) -> int:
        return math.ceil(self.payload_bytes / (self.packet_size - IN_PACKET_OVERHEAD))

    @property
    def wire_bytes(self) -> int:
        return self.packets * (self.packet_size + WIRE_OVERHEAD)

    @property
    def send_rate_bps(self) -> float:
        return min(LINK_BPS, self.throughput_limit_mbps * 1e6)

    @property
    def tx_ms(self) -> float:
        return self.wire_bytes * 8 / self.send_rate_bps * 1000


@dataclass
class TransportConfig:
    cameras: list[CameraStream]
    switch_buffer_kb: int = 1536
    line_rate_cps: float = 10.0  # cartons per second; every camera triggers once per carton
    gate_travel_ms: float = 100.0  # at production speed; scales inversely with speed
    production_rate_cps: float = 10.0
    actuator_margin_ms: float = 25.0
    processing_ms: float = 12.0
    resend_timeout_ms: float = 8.0
    resend_recovery_share: float = 0.7
    max_resend_rounds: int = 5
    jitter_ms: float = 0.4
    background_occupancy_max: float = 0.4
    simultaneous: bool = True  # False = only one camera streaming (isolation test)

    @property
    def deadline_ms(self) -> float:
        travel = self.gate_travel_ms * self.production_rate_cps / self.line_rate_cps
        # the result must also be ready before the next trigger of the same camera
        return min(travel - self.actuator_margin_ms, 1000.0 / self.line_rate_cps)


@dataclass
class FrameOutcome:
    complete: bool
    on_time: bool
    dropped_bytes: dict[str, float]
    latency_ms: dict[str, float]
    resend_rounds: dict[str, int]
    peak_queue_kb: float


def simulate_burst(cfg: TransportConfig, rng: random.Random) -> FrameOutcome:
    """Exact piecewise-linear queue integration for one synchronous trigger."""
    cams = cfg.cameras
    starts = {
        c.cam_id: c.exposure_ms + c.frame_tx_delay_ms + rng.uniform(-cfg.jitter_ms, cfg.jitter_ms)
        for c in cams
    }
    ends = {c.cam_id: starts[c.cam_id] + c.tx_ms for c in cams}
    events = sorted(set(list(starts.values()) + list(ends.values())))
    buffer_bits = cfg.switch_buffer_kb * 1024 * 8 * (1 - rng.uniform(0, cfg.background_occupancy_max))
    queue = 0.0
    peak = 0.0
    dropped = {c.cam_id: 0.0 for c in cams}
    for t0, t1 in zip(events, events[1:]):
        dt = (t1 - t0) / 1000.0
        active = [c for c in cams if starts[c.cam_id] <= t0 and ends[c.cam_id] >= t1]
        arrival = sum(c.send_rate_bps for c in active)
        net = arrival - LINK_BPS
        if net > 0:
            room = buffer_bits - queue
            grow = net * dt
            if grow > room:
                over = grow - room
                queue = buffer_bits
                for c in active:  # overflow shared in proportion to arrival rate
                    dropped[c.cam_id] += over * c.send_rate_bps / arrival / 8
            else:
                queue += grow
        else:
            queue = max(0.0, queue + net * dt)
        peak = max(peak, queue)

    latency, rounds = {}, {}
    complete = True
    for c in cams:
        missing = dropped[c.cam_id]
        t = ends[c.cam_id]
        r = 0
        while missing > 1 and r < cfg.max_resend_rounds:
            r += 1
            t += cfg.resend_timeout_ms + missing * 8 / LINK_BPS * 1000
            missing *= 1 - cfg.resend_recovery_share
            if missing < 1500:  # last packet's worth recovered
                missing = 0
        if missing > 0:
            complete = False
        latency[c.cam_id] = t + cfg.processing_ms
        rounds[c.cam_id] = r
    on_time = complete and max(latency.values()) <= cfg.deadline_ms
    return FrameOutcome(complete, on_time, dropped, latency, rounds, peak / 8 / 1024)


@dataclass
class StreamStats:
    triggers: int
    per_camera: dict[str, dict] = field(default_factory=dict)
    usable_frame_pct: float = 100.0
    incomplete_frame_pct: float = 0.0
    late_frame_pct: float = 0.0
    avg_uplink_utilisation_pct: float = 0.0
    peak_queue_kb: float = 0.0
    deadline_ms: float = 0.0
    achieved_rate_cps: float = 0.0


def run_stream(cfg: TransportConfig, triggers: int, seed: int) -> StreamStats:
    rng = random.Random(seed)
    cams = cfg.cameras
    per = {
        c.cam_id: {
            "frames": 0, "incomplete": 0, "late": 0, "packets": 0,
            "resend_requests": 0, "lost_packets": 0, "latency_ms_p95": 0.0,
        }
        for c in cams
    }
    lat_samples = {c.cam_id: [] for c in cams}
    usable = incomplete = late = 0
    peak = 0.0
    for _ in range(triggers):
        out = simulate_burst(cfg, rng)
        peak = max(peak, out.peak_queue_kb)
        for c in cams:
            p = per[c.cam_id]
            p["frames"] += 1
            p["packets"] += c.packets
            dropped_packets = math.ceil(out.dropped_bytes[c.cam_id] / (c.packet_size + WIRE_OVERHEAD))
            p["resend_requests"] += dropped_packets if out.resend_rounds[c.cam_id] else 0
            lat_samples[c.cam_id].append(out.latency_ms[c.cam_id])
        if not out.complete:
            incomplete += 1
            worst = max(out.dropped_bytes, key=out.dropped_bytes.get)
            per[worst]["incomplete"] += 1
            per[worst]["lost_packets"] += 1
        elif not out.on_time:
            late += 1
            worst = max(out.latency_ms, key=out.latency_ms.get)
            per[worst]["late"] += 1
        else:
            usable += 1
    for c in cams:
        s = sorted(lat_samples[c.cam_id])
        per[c.cam_id]["latency_ms_p95"] = round(s[int(0.95 * (len(s) - 1))], 1) if s else 0.0
    avg_bits = sum(c.wire_bytes * 8 for c in cams) * cfg.line_rate_cps
    return StreamStats(
        triggers=triggers,
        per_camera=per,
        usable_frame_pct=round(100 * usable / triggers, 2),
        incomplete_frame_pct=round(100 * incomplete / triggers, 2),
        late_frame_pct=round(100 * late / triggers, 2),
        avg_uplink_utilisation_pct=round(100 * avg_bits / LINK_BPS, 1),
        peak_queue_kb=round(peak, 1),
        deadline_ms=round(cfg.deadline_ms, 1),
        achieved_rate_cps=cfg.line_rate_cps,
    )


def static_budget(cfg: TransportConfig) -> dict:
    """Closed-form numbers shown next to the simulation so the arithmetic is visible."""
    cams = cfg.cameras
    c0 = cams[0]
    burst_rate = sum(c.send_rate_bps for c in cams) if cfg.simultaneous else c0.send_rate_bps
    overlap_ms = min(c.tx_ms for c in cams)
    excess_kb = max(0.0, (burst_rate - LINK_BPS) * overlap_ms / 1000 / 8 / 1024) if cfg.simultaneous else 0.0
    last_start = max(c.exposure_ms + c.frame_tx_delay_ms for c in cams)
    return {
        "payload_bytes_per_frame": c0.payload_bytes,
        "packets_per_frame": c0.packets,
        "wire_bytes_per_frame": c0.wire_bytes,
        "per_camera_send_rate_mbps": round(c0.send_rate_bps / 1e6, 1),
        "frame_tx_ms": round(c0.tx_ms, 2),
        "average_uplink_mbps": round(sum(c.wire_bytes * 8 for c in cams) * cfg.line_rate_cps / 1e6, 1),
        "burst_arrival_mbps": round(burst_rate / 1e6, 1),
        "uplink_mbps": LINK_BPS / 1e6,
        "excess_during_full_overlap_kb": round(excess_kb, 1),
        "switch_buffer_kb": cfg.switch_buffer_kb,
        "best_case_last_result_ms": round(last_start + max(c.tx_ms for c in cams) + cfg.processing_ms, 1),
        "deadline_ms": round(cfg.deadline_ms, 1),
        "max_rate_cps_by_tx_time": round(1000 / (last_start + max(c.tx_ms for c in cams)), 1),
    }
