"""Simulator causality, path separation, API contract and evaluation reproducibility."""
import random

from fastapi.testclient import TestClient

from linesight.api import app
from linesight.engine.cases import create_case
from linesight.engine.paths import path_status
from linesight.simulator.transport import CameraStream, TransportConfig, run_stream, static_budget


def cfg(limit, n=4, buf=448, rate=10.0, ftd=0.0):
    cams = [CameraStream(f"cam{i+1}", throughput_limit_mbps=limit, frame_tx_delay_ms=ftd * i) for i in range(n)]
    return TransportConfig(cameras=cams, switch_buffer_kb=buf, line_rate_cps=rate, simultaneous=n > 1)


def test_single_camera_is_clean_and_bursts_lose_frames():
    assert run_stream(cfg(265, n=1), 200, 1).usable_frame_pct == 100.0
    assert run_stream(cfg(265), 600, 1).usable_frame_pct < 99.5


def test_average_bandwidth_is_not_burst_contention():
    b = static_budget(cfg(265))
    assert b["average_uplink_mbps"] < 1000 < b["burst_arrival_mbps"]


def test_pacing_restores_completeness_and_overthrottling_misses_deadline():
    assert run_stream(cfg(245), 600, 2).usable_frame_pct == 100.0
    assert run_stream(cfg(150), 600, 2).late_frame_pct == 100.0


def test_low_speed_hides_the_problem():
    s = run_stream(cfg(265, rate=4.0), 600, 3)
    assert s.usable_frame_pct == 100.0
    assert sum(v["resend_requests"] for v in s.per_camera.values()) > 0  # early warning in counters


def test_seeded_simulation_is_reproducible():
    a, b = run_stream(cfg(265), 300, 7), run_stream(cfg(265), 300, 7)
    assert a.per_camera == b.per_camera


def test_discovery_success_does_not_paint_stream_healthy():
    inv = create_case("dev-subnet")
    d = next(x for x in inv.case.diagnostics if x.id == "D-DISC")
    inv._run_probe(d)
    p = path_status(inv.case)
    assert p["cam1-disc"]["status"] == "ok"
    assert p["cam1-strm"]["status"] == "unknown"
    assert p["cam2-disc"]["status"] == "degraded"


def test_api_flow_and_permissions():
    c = TestClient(app)
    h = c.get("/api/health").json()
    assert "live" not in h["modes"] and h["rules_version"]
    s = c.post("/api/cases", json={"scenario_id": "demo-b-replacement", "mode": "rules"}).json()
    cid = s["case_id"]
    for _ in range(10):
        if s["intervention_options"] or s["finished"]:
            break
        s = c.post(f"/api/cases/{cid}/step").json()
    assert s["intervention_options"]
    assert c.post(f"/api/cases/{cid}/apply", json={"option_id": "O-NOT-OFFERED"}).status_code == 403
    rec = next(o["id"] for o in s["intervention_options"] if o["recommended"])
    s = c.post(f"/api/cases/{cid}/apply", json={"option_id": rec}).json()
    assert s["resolution"] == "resolved_verified"
    md = c.get(f"/api/cases/{cid}/handoff.md").text
    assert "Engineering handoff" in md and "simulator" in md
    assert c.post("/api/cases", json={"scenario_id": "demo-a-line-speed", "mode": "live"}).status_code == 400


def test_api_rejects_oversized_ticket():
    c = TestClient(app)
    r = c.post("/api/cases", json={"scenario_id": "demo-a-line-speed", "ticket_text": "x" * 9001})
    assert r.status_code == 422


def test_evaluation_is_reproducible():
    from linesight.eval.run import run_engine
    a, b = run_engine("dev-burst-plantb", "rules"), run_engine("dev-burst-plantb", "rules")
    for k in ("disposition", "resolution", "claimed_causes", "diagnostics", "effort"):
        assert a[k] == b[k]
