// Loose mirrors of the backend snapshot (backend/linesight/engine/snapshot.py).
export type Status = "ok" | "degraded" | "fail" | "unknown";

export interface Evidence {
  id: string; key: string; kind: string; status: string; summary: string; data: Record<string, any>;
  provenance: string; captured_at: string; received_seq: number; scope: Record<string, string>;
  parser_version: string; untrusted_text: boolean;
}
export interface Hypothesis {
  rule_id: string; title: string; family: string; severity: number; status: string; active: boolean;
  supporting: string[]; contradicting: string[]; corroborating: string[]; missing: string[]; reasons: string[];
  playbook: string | null; disposition_hint: string; sources: string[]; alternatives: string[];
}
export interface Diagnostic {
  id: string; tool: string; args: Record<string, any>; title: string; produces: string[]; effort: number;
  disruption: number; requires_technician: boolean; state: string; reason: string; score: number | null;
  score_detail: Record<string, any>; evidence_ids: string[]; for_hypotheses: string[];
}
export interface Option {
  id: string; title: string; params: Record<string, any>; predicted: Record<string, any>; meets_requirements: boolean;
  tradeoff: string; action: string; playbook: string; recommended: boolean;
}
export interface Verification { intervention_id: string; passed: boolean; checks: { check: string; passed: boolean; detail: string; evidence: string }[]; evidence_ids: string[]; outcome: string }
export interface Intervention { id: string; playbook: string; option_id: string; title: string; params: Record<string, any>; before_evidence: string[] }
export interface Trace { seq: number; actor: string; action: string; tool: string | null; inputs: Record<string, any>; outputs: Record<string, any>; note: string }
export interface PathInfo { status: Status; evidence: string[]; note: string; after_intervention: boolean }
export interface Snapshot {
  case_id: string; scenario_id: string; mode: string; rules_version: string;
  incident: { ticket_text: string; business_impact: string; reporter: string; reported_at: string; prior_temporary_recoveries: number; timeline: { t: string; what: string }[] };
  station: { id: string; site: string; line: string; template: string; devices: any[]; connections: any[]; versions: Record<string, any>; requirements: Record<string, number> };
  evidence: Evidence[]; hypotheses: Hypothesis[]; diagnostics: Diagnostic[]; trace: Trace[];
  interventions: Intervention[]; intervention_options: Option[]; verifications: Verification[];
  assertions: { evidence_id: string; claim: string; device: string | null; status: string; evidence: string[]; note: string }[];
  symptoms: { tag: string; state: string; evidence: string[]; why: string; explained_by: string[] }[];
  reported_groups: string[];
  pending_question: { diagnostic_id: string; question: string; why: string; answer_options: string[] } | null;
  next_check: string | null; disposition: string; resolution: string; disposition_reasons: string[];
  guard_events: { type: string; origin: string; match: string; action: string }[];
  budget: Record<string, number>; finished: boolean; metrics: Record<string, any>;
  paths: Record<string, PathInfo>;
  customer_explanation: { text: string; origin: string; fallback_reason?: string };
  handoff: any | null;
  simulation: { boundary: string; transport_assumptions: string[]; line: Record<string, any>; test_window: boolean };
  step_label: string;
}
export interface Frame { action: { type: string; diagnostic?: string; option_id?: string }; snapshot: Snapshot }
export interface Replay { scenario: Record<string, any>; mode: string; rules_version: string; notice: string; frames: Frame[] }
