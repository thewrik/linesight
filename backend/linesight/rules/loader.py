"""Load and validate the rule set. Invalid rules fail at start-up, not mid-case."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

import yaml
from pydantic import BaseModel, Field, model_validator

from ..engine.facts import FACT_SOURCES

RULES_PATH = Path(__file__).with_name("rules.yaml")

Op = Literal["is_true", "is_false", "gt", "gte", "lt", "lte", "eq", "ne", "nonempty", "empty", "contains"]
SYMPTOMS = {"discovery_failure", "control_failure", "frame_loss", "trigger_missing", "dashboard_stale",
            "camera_resets", "image_quality"}
TOOLS = {"discovery_scan", "control_probe", "compare_versions", "inspect_acquisition_stats", "inspect_topology",
         "inspect_host", "inspect_plc_link", "inspect_management", "correlate_events", "request_observation"}
VERIFY_CHECKS = {"production_usable", "deadline", "line_rate", "control_all_ok", "plc_results_ok", "single_ok",
                 "crash_recovery", "dashboard_fresh", "no_resets"}
FAMILIES = {"network_and_configuration", "interoperability_version", "identity_permissions", "application_defect",
            "firmware_defect", "physical"}


class Predicate(BaseModel):
    fact: str
    op: Op
    value: Any = None
    why: str = ""

    @model_validator(mode="after")
    def _known_fact(self) -> "Predicate":
        if self.fact not in FACT_SOURCES:
            raise ValueError(f"unknown fact '{self.fact}'")
        return self


class DiagnosticDef(BaseModel):
    id: str
    tool: str
    title: str
    produces: list[str]
    effort: int
    disruption: int
    args: dict[str, Any] = Field(default_factory=dict)
    requires: list[str] = Field(default_factory=list)
    requires_technician: bool = False
    needs_test_window: bool = False
    device_from: Optional[str] = None

    @model_validator(mode="after")
    def _tool(self) -> "DiagnosticDef":
        if self.tool not in TOOLS:
            raise ValueError(f"{self.id}: tool {self.tool} not allowed")
        return self


class HypothesisDef(BaseModel):
    id: str
    title: str
    family: str
    severity: int = Field(ge=1, le=5)
    triggers: list[str]
    explains: list[str]
    support: list[Predicate]
    contradict: list[Predicate] = Field(default_factory=list)
    corroborate: list[Predicate] = Field(default_factory=list)
    playbook: Optional[str] = None
    disposition: Literal["known_playbook", "engineering_escalation", "field_service"]
    handoff_requires: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "HypothesisDef":
        if self.family not in FAMILIES:
            raise ValueError(f"{self.id}: unknown family {self.family}")
        for t in self.triggers + self.explains:
            if t not in SYMPTOMS:
                raise ValueError(f"{self.id}: unknown symptom {t}")
        if self.disposition == "known_playbook" and not self.playbook:
            raise ValueError(f"{self.id}: known_playbook disposition needs a playbook")
        return self

    @property
    def required_keys(self) -> list[str]:
        return sorted({FACT_SOURCES[p.fact] for p in self.support + self.contradict})


class OptionDef(BaseModel):
    id: str
    title: str
    action: str
    params: dict[str, Any] = Field(default_factory=dict)
    tradeoff: str = ""
    meets_requirements: bool = True


class PlaybookDef(BaseModel):
    id: str
    title: str
    scope: str
    allowed_actions: list[str]
    option_generator: str
    options: list[OptionDef] = Field(default_factory=list)
    verify: list[str]
    rollback: str
    sources: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "PlaybookDef":
        for v in self.verify:
            if v not in VERIFY_CHECKS:
                raise ValueError(f"{self.id}: unknown verification {v}")
        for o in self.options:
            if o.action not in self.allowed_actions:
                raise ValueError(f"{self.id}: option {o.id} uses action outside allowed_actions")
        return self


class SymptomGroupDef(BaseModel):
    label: str
    alternatives: list[str]


class RuleSet(BaseModel):
    version: str
    symptom_groups: dict[str, SymptomGroupDef]
    diagnostics: list[DiagnosticDef]
    hypotheses: list[HypothesisDef]
    playbooks: list[PlaybookDef]
    limits: dict[str, int]

    @model_validator(mode="after")
    def _xref(self) -> "RuleSet":
        pbs = {p.id for p in self.playbooks}
        diags = {d.id for d in self.diagnostics}
        produced = {k for d in self.diagnostics for k in d.produces}
        for h in self.hypotheses:
            if h.playbook and h.playbook not in pbs:
                raise ValueError(f"{h.id}: playbook {h.playbook} missing")
            for k in h.required_keys + h.handoff_requires:
                if k not in produced:
                    raise ValueError(f"{h.id}: no diagnostic produces evidence '{k}'")
        for d in self.diagnostics:
            for r in d.requires:
                if r not in diags:
                    raise ValueError(f"{d.id}: requires unknown {r}")
        return self

    def hypothesis(self, hid: str) -> HypothesisDef:
        return next(h for h in self.hypotheses if h.id == hid)

    def playbook(self, pid: str) -> PlaybookDef:
        return next(p for p in self.playbooks if p.id == pid)

    def diagnostic(self, did: str) -> DiagnosticDef:
        return next(d for d in self.diagnostics if d.id == did)


def load_rules(path: Path | None = None) -> RuleSet:
    with open(path or RULES_PATH) as fh:
        raw = yaml.safe_load(fh)
    return RuleSet.model_validate(raw)


@lru_cache(maxsize=1)
def default_rules() -> RuleSet:
    return load_rules()
