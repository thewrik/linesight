import { createContext, useContext } from "react";
import type { Status } from "../types";

export const EvidenceCtx = createContext<(id: string) => void>(() => {});

export function EvRef({ id }: { id: string }) {
  const open = useContext(EvidenceCtx);
  return <button className="evref" onClick={() => open(id)} aria-label={`Open evidence ${id}`}>{id}</button>;
}
export function EvRefs({ ids }: { ids: string[] }) {
  if (!ids?.length) return null;
  return <span className="row" style={{ gap: 4, display: "inline-flex" }}>{ids.map((i) => <EvRef key={i} id={i} />)}</span>;
}

const ICON: Record<string, string> = { ok: "✓", degraded: "!", fail: "✕", unknown: "?" };
const WORD: Record<string, string> = { ok: "OK", degraded: "Degraded", fail: "Failing", unknown: "Not checked" };
export function StatusChip({ s, text }: { s: Status | string; text?: string }) {
  return <span className={`chip ${s}`}><span aria-hidden>{ICON[s] ?? "•"}</span>{text ?? WORD[s] ?? s}</span>;
}

export const HSTATUS: Record<string, { cls: string; word: string; icon: string }> = {
  supported: { cls: "ok", word: "Supported", icon: "✓" },
  confirmed: { cls: "ok", word: "Confirmed by verification", icon: "✓✓" },
  contradicted: { cls: "fail", word: "Contradicted", icon: "✕" },
  refuted_by_verification: { cls: "fail", word: "Refuted by verification", icon: "✕" },
  untested: { cls: "unknown", word: "Untested", icon: "?" },
};
export function HypChip({ status }: { status: string }) {
  const m = HSTATUS[status] ?? { cls: "plain", word: status, icon: "•" };
  return <span className={`chip ${m.cls}`}><span aria-hidden>{m.icon}</span>{m.word}</span>;
}

export const DISP: Record<string, { word: string; blurb: string }> = {
  open: { word: "Investigating", blurb: "Running read-only checks." },
  known_playbook: { word: "Known playbook", blurb: "Evidence matches a playbook's conditions." },
  more_evidence: { word: "More evidence needed", blurb: "One discriminating observation is needed before recommending anything." },
  engineering_escalation: { word: "Engineering escalation", blurb: "Novel, contradictory, recurrent or version-specific: hand off with evidence." },
  field_service: { word: "Field service", blurb: "Controlled substitution supports a physical fault." },
};
export const RES: Record<string, string> = {
  unresolved: "unresolved", resolved_verified: "resolved — verified", mitigated: "mitigated (not resolved)",
  verification_failed: "verification failed", handed_off: "handed off", awaiting_customer: "awaiting customer",
  no_fault_reproduced: "no fault reproduced",
};
export const SYMPTOM: Record<string, string> = {
  discovery_failure: "Discovery fails", control_failure: "Control path fails", frame_loss: "Images lost or late",
  trigger_missing: "Triggers missing", dashboard_stale: "Dashboard stale", camera_resets: "Camera resets", image_quality: "Image quality",
};
export const fmtT = (t: string) => t.replace("T", " ").slice(5, 16);
