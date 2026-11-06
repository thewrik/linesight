"""Case construction: joins a scenario's visible input, its simulated world, the rules and a provider."""
from __future__ import annotations

from typing import Any, Optional

from ..casebook.loader import build_world, load_visible
from ..llm.provider import RulesProvider, make_provider
from ..models import CaseState
from ..rules.loader import RuleSet, default_rules
from .investigator import Investigator


def create_case(scenario_id: str, mode: str = "rules", provider: Optional[RulesProvider] = None,
                rules: Optional[RuleSet] = None, seed: Optional[int] = None, ticket_override: Optional[str] = None,
                extra_logs: Optional[list[dict[str, Any]]] = None) -> Investigator:
    rules = rules or default_rules()
    station, incident, uploaded, meta = load_visible(scenario_id)
    if ticket_override:
        incident.ticket_text = ticket_override
    world = build_world(scenario_id, station, seed)
    provider = provider or make_provider(mode)
    case = CaseState(case_id=f"CASE-{scenario_id}-{seed or meta['seed']}", scenario_id=scenario_id, mode=provider.mode,
                     rules_version=rules.version, incident=incident, station=station)
    case.metrics["scenario"] = {k: meta[k] for k in ("split", "fixture", "sources", "title", "adversarial")}
    inv = Investigator(case, world, rules, provider)
    inv.intake(extra_log_lines=(uploaded or []) + (extra_logs or []))
    return inv
