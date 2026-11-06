"""The single JSON shape the UI renders, for both the live API and the static replay build."""
from __future__ import annotations

from typing import Any

from ..simulator.transport import ASSUMPTIONS
from .investigator import Investigator
from .paths import path_status
from .report import customer_explanation, engineering_handoff, maybe_model_customer_text

SIMULATION_BOUNDARY = (
    "Simulated station. Telemetry comes from LineSight's causal simulator with seeded faults; interventions change "
    "simulator state only. The transport model is a deliberately small burst-contention model and does not reproduce "
    "all GigE Vision behaviour or prove real hardware performance."
)


def snapshot(inv: Investigator, label: str = "", provider: Any = None) -> dict[str, Any]:
    c = inv.case
    data = c.model_dump(mode="json")
    data["paths"] = path_status(c)
    data["customer_explanation"] = maybe_model_customer_text(c, provider) if provider else customer_explanation(c)
    data["handoff"] = engineering_handoff(c) if c.finished or c.disposition.value != "open" else None
    data["simulation"] = {"boundary": SIMULATION_BOUNDARY, "transport_assumptions": ASSUMPTIONS,
                          "line": inv.world.state["line"], "test_window": inv.world.state["line"]["test_window"]}
    data["step_label"] = label
    return data
