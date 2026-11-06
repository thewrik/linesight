import type { Replay, Snapshot } from "./types";

const BASE = import.meta.env.BASE_URL;
export const dataUrl = (p: string) => `${BASE}data/${p}`;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-cache", ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

/** Is a LineSight API reachable? The static (GitHub Pages) build has none. */
export async function probeApi(): Promise<{ modes: string[]; live_model: string | null } | null> {
  if (import.meta.env.VITE_STATIC === "1") return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch("/api/health", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export interface Driver {
  kind: "static" | "api";
  label: string;
  snapshot: Snapshot;
  history: Snapshot[];
  canAdvance: boolean;
  advance(): Promise<void>;
  answer(): Promise<void>;
  apply(optionId: string): Promise<void>;
  reset(): Promise<void>;
  /** In static replay only the recorded option can be applied. */
  recordedOption?: string;
}

export class StaticDriver {
  i = 0;
  constructor(public replay: Replay) {}
  get frames() { return this.replay.frames; }
  get snapshot() { return this.frames[this.i].snapshot; }
  get history() { return this.frames.slice(0, this.i + 1).map((f) => f.snapshot); }
  get nextAction() { return this.frames[this.i + 1]?.action; }
  get recordedOption() {
    return this.frames.find((f, idx) => idx > this.i && f.action.type === "apply")?.action.option_id;
  }
  step() { if (this.i < this.frames.length - 1) this.i++; }
  back() { if (this.i > 0) this.i--; }
}

export async function apiCreate(scenario_id: string, mode: string): Promise<Snapshot> {
  return fetchJson("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario_id, mode }) });
}
export async function apiPost(caseId: string, path: string, body: unknown = {}): Promise<Snapshot> {
  return fetchJson(`/api/cases/${encodeURIComponent(caseId)}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
