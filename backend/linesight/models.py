"""Typed entities shared by the simulator, the investigation engine and the API.

Everything a case knows is one of these records. Evidence is the only way facts
enter a case; hypotheses and findings point back at evidence ids.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- station


class PathKind(str, Enum):
    """Separate functional paths. Health of one never implies health of another."""

    discovery = "discovery"  # GVCP broadcast discovery
    control = "control"  # GVCP control channel (exclusive/control privilege + heartbeat)
    stream = "stream"  # GVSP image transport
    trigger = "trigger"  # PLC trigger / result handshake
    management = "management"  # station -> plant dashboard (MQTT over TLS / HTTPS)
    power = "power"  # PoE


class Device(BaseModel):
    id: str
    kind: Literal["camera", "switch", "edge_host", "plc", "mgmt_service"]
    label: str
    vendor: str
    model: str
    firmware: Optional[str] = None
    role: Optional[str] = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class Connection(BaseModel):
    id: str
    a: str
    b: str
    path: PathKind
    protocol: str
    notes: str = ""


class VersionSet(BaseModel):
    host_os: str
    acquisition_sdk: str
    inspection_app: str
    adapters_installed: list[str]
    nic_driver: str
    camera_firmware: dict[str, str]
    plc_program: str
    mgmt_agent: str


class Station(BaseModel):
    id: str
    site: str
    line: str
    template: str
    devices: list[Device]
    connections: list[Connection]
    versions: VersionSet
    requirements: dict[str, float]  # e.g. line_rate_cps, result_deadline_ms


# --------------------------------------------------------------------------- evidence


class EvidenceKind(str, Enum):
    observed = "observed"  # produced by a read-only probe or parser
    customer_assertion = "customer_assertion"  # said by the operator/technician, unverified
    technician_observation = "technician_observation"  # technician performed a requested check
    derived = "derived"  # deterministic computation over other evidence
    verification = "verification"  # post-intervention check


class EvidenceStatus(str, Enum):
    ok = "ok"
    unavailable = "unavailable"
    stale = "stale"
    conflicting = "conflicting"


class Evidence(BaseModel):
    id: str  # stable reference, e.g. E-007
    key: str  # what it measures, e.g. stream.all.production
    kind: EvidenceKind
    status: EvidenceStatus = EvidenceStatus.ok
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    provenance: str  # tool or person that produced it
    captured_at: str  # ISO timestamp of the observation itself (sim clock)
    received_seq: int  # order in which the case received it (may differ from captured_at)
    scope: dict[str, str] = Field(default_factory=dict)  # site / station / device
    parser_version: str = "n/a"
    untrusted_text: bool = False  # came from customer-supplied text


# --------------------------------------------------------------------------- reasoning


class HypothesisStatus(str, Enum):
    untested = "untested"
    supported = "supported"
    contradicted = "contradicted"
    confirmed = "confirmed"  # supported AND a verified intervention restored service
    refuted_by_verification = "refuted_by_verification"


class Hypothesis(BaseModel):
    rule_id: str
    title: str
    family: str
    severity: int
    status: HypothesisStatus = HypothesisStatus.untested
    active: bool = True  # a current symptom points here
    corroborating: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    supporting: list[str] = Field(default_factory=list)  # evidence ids
    contradicting: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)  # evidence keys still needed
    reasons: list[str] = Field(default_factory=list)  # human-readable predicate results
    playbook: Optional[str] = None
    disposition_hint: str = "known_playbook"
    sources: list[str] = Field(default_factory=list)


class DiagnosticState(str, Enum):
    evaluated = "evaluated"
    candidate = "candidate"
    skipped = "skipped"
    blocked = "blocked"


class Diagnostic(BaseModel):
    id: str
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    title: str
    produces: list[str]
    effort: int  # synthetic operator-effort proxy, 0 = automated read-only
    disruption: int  # synthetic production-disruption proxy
    requires_technician: bool = False
    state: DiagnosticState = DiagnosticState.candidate
    reason: str = ""
    score: Optional[float] = None
    score_detail: dict[str, Any] = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list)
    for_hypotheses: list[str] = Field(default_factory=list)


class Disposition(str, Enum):
    open = "open"
    known_playbook = "known_playbook"
    more_evidence = "more_evidence"
    engineering_escalation = "engineering_escalation"
    field_service = "field_service"


class Resolution(str, Enum):
    unresolved = "unresolved"
    resolved_verified = "resolved_verified"
    mitigated = "mitigated"  # works, but below customer requirement or temporary
    verification_failed = "verification_failed"
    handed_off = "handed_off"
    awaiting_customer = "awaiting_customer"
    no_fault_reproduced = "no_fault_reproduced"


class InterventionOption(BaseModel):
    id: str
    title: str
    params: dict[str, Any]
    predicted: dict[str, Any] = Field(default_factory=dict)
    meets_requirements: bool = False
    tradeoff: str = ""
    action: str = ""
    playbook: str = ""
    recommended: bool = False


class Intervention(BaseModel):
    id: str
    playbook: str
    option_id: str
    title: str
    params: dict[str, Any]
    simulated: bool = True
    applied_at_seq: int
    before_evidence: list[str] = Field(default_factory=list)


class Verification(BaseModel):
    intervention_id: str
    passed: bool
    checks: list[dict[str, Any]]
    evidence_ids: list[str]
    outcome: Resolution


class TraceEntry(BaseModel):
    seq: int
    actor: Literal["engine", "model", "technician", "guard", "simulator"]
    action: str
    tool: Optional[str] = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    note: str = ""


class PendingQuestion(BaseModel):
    diagnostic_id: str
    question: str
    why: str
    answer_options: list[str] = Field(default_factory=list)


class Incident(BaseModel):
    id: str
    station_id: str
    reported_at: str
    reporter: str
    ticket_text: str
    business_impact: str
    prior_temporary_recoveries: int = 0
    changes_reported: list[str] = Field(default_factory=list)
    timeline: list[dict[str, Any]] = Field(default_factory=list)


class Assertion(BaseModel):
    evidence_id: str
    claim: str
    device: Optional[str] = None
    status: Literal["unverified", "consistent", "contradicted"] = "unverified"
    evidence: list[str] = Field(default_factory=list)
    note: str = ""


class SymptomView(BaseModel):
    tag: str
    state: Literal["reported", "observed", "cleared", "explained"]
    evidence: list[str] = Field(default_factory=list)
    why: str = ""
    explained_by: list[str] = Field(default_factory=list)


class CaseState(BaseModel):
    case_id: str
    scenario_id: str
    mode: Literal["rules", "replay", "live"]
    rules_version: str
    incident: Incident
    station: Station
    evidence: list[Evidence] = Field(default_factory=list)
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    trace: list[TraceEntry] = Field(default_factory=list)
    interventions: list[Intervention] = Field(default_factory=list)
    intervention_options: list[InterventionOption] = Field(default_factory=list)
    verifications: list[Verification] = Field(default_factory=list)
    assertions: list[Assertion] = Field(default_factory=list)
    symptoms: list[SymptomView] = Field(default_factory=list)
    reported_groups: list[str] = Field(default_factory=list)
    pending_question: Optional[PendingQuestion] = None
    next_check: Optional[str] = None  # diagnostic id
    disposition: Disposition = Disposition.open
    resolution: Resolution = Resolution.unresolved
    disposition_reasons: list[str] = Field(default_factory=list)
    guard_events: list[dict[str, Any]] = Field(default_factory=list)
    budget: dict[str, int] = Field(default_factory=dict)
    seq: int = 0
    finished: bool = False
    metrics: dict[str, Any] = Field(default_factory=dict)
