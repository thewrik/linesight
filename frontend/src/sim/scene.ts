// Turns a recorded engine snapshot into what the simulated line should be doing.
// Every number here is read from evidence or predictions in the replay; nothing is invented.
import type { Evidence, Hypothesis, Option, Replay } from "../types";
import type { PartState, Probe, Scene } from "./engine";
import { CAM_IDS, PARTS, type CamId, type Part } from "./world";

export const PART_OF: Record<string, Part> = {
  "H-BURST": "switch", "H-POE": "switch",
  "H-HOST-BACKPRESSURE": "pc", "H-PERM": "pc", "H-LOCALE": "pc", "H-STALE-LOCK": "pc", "H-ADAPTER": "pc", "H-HEARTBEAT-GAP": "pc",
  "H-CABLE": "cables",
  "H-CAMERA-HW": "cams", "H-UNRELEASED-FW": "cams", "H-FW-DEFECT": "cams", "H-TRAILER": "cams", "H-TRAILER-MISAPPLIED": "cams", "H-SUBNET": "cams",
  "H-PLC-TRIGGER": "plc",
  "H-MGMT-CERT": "dashboard", "H-MGMT-IDENTITY": "dashboard",
};

const FOCUS: Record<string, Part> = {
  "D-TOPO": "switch", "D-CTRL": "cams", "D-DISC": "cams", "D-VER": "pc", "D-HOST": "pc", "D-PLC": "plc", "D-MGMT": "dashboard", "D-EVENTS": "pc",
};
const PROBE: Record<string, Probe> = {
  "D-CTRL": "ctrl", "D-DISC": "disc", "D-PLC": "plc", "D-MGMT": "mgmt", "D-HOST": "host",
  "D-TECH-VIEWER": "tech", "D-TECH-SUBST": "tech", "D-TECH-IDLE": "tech", "D-TECH-CHANGES": "tech",
};

export interface PartInfo { state: PartState; open: number; hyps: Hypothesis[] }
const supported = (h: Hypothesis) => h.status === "supported" || h.status === "confirmed";

export function partsAt(replay: Replay, frame: number): Record<Part, PartInfo> {
  const snap = replay.frames[frame].snapshot;
  const fixed = snap.resolution === "resolved_verified";
  const out = {} as Record<Part, PartInfo>;
  for (const part of PARTS) {
    const hyps = snap.hypotheses.filter((h) => PART_OF[h.rule_id] === part);
    const everInPlay = replay.frames.some((f) => f.snapshot.hypotheses.some((h) => PART_OF[h.rule_id] === part && (h.active || h.status !== "untested")));
    const open = hyps.filter((h) => h.active && h.status === "untested").length;
    const state: PartState = hyps.some(supported) ? (fixed ? "fixed" : "culprit") : open ? "suspect" : everInPlay ? "cleared" : "idle";
    out[part] = { state, open, hyps: hyps.filter((h) => h.active || h.status !== "untested") };
  }
  return out;
}

export interface Hud { rate: number; requiredRate: number; usable: number | null; caption: string; tone: "bad" | "ok" | "test" | "neutral" }
export interface SceneOpts { frame: number; diagnostic?: string; kind?: string; peek?: Option | null; detail?: boolean; focus?: Part | null; lowSpeed?: boolean }

const maxLatency = (e: Evidence) => Math.max(...Object.values<any>(e.data.per_camera ?? {}).map((p) => p.latency_ms_p95 ?? 0));
const late = (e: Evidence) => Math.max(0, Math.min(1, 1 - e.data.usable_frame_pct / 100));
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function sceneFor(replay: Replay, o: SceneOpts): { scene: Scene; hud: Hud; parts: Record<Part, PartInfo> } {
  const snap = replay.frames[o.frame].snapshot;
  const all = replay.frames[replay.frames.length - 1].snapshot.evidence;
  const have = (key: string) => [...snap.evidence].reverse().find((e) => e.key === key && e.status === "ok");
  const req = snap.station.requirements;
  const deadlineMs = req.result_deadline_ms;

  // what is physically true on the line, measured or not
  const prod0 = all.find((e) => e.key === "stream.production" && e.kind === "observed" && e.status === "ok");
  const ctrl0 = all.find((e) => e.key === "control" && e.kind === "observed" && e.status === "ok");
  const lockout = all.some((e) => e.key === "events" && (e.data.events ?? []).some((x: any) => /ACCESS_DENIED/.test(x.msg)));
  const ver = snap.verifications[snap.verifications.length - 1];
  const fixed = !!ver?.passed;
  const prodV = fixed ? [...snap.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "verification") : undefined;
  const ctrlV = fixed ? [...snap.evidence].reverse().find((e) => e.key === "control" && e.kind === "verification") : undefined;
  const applied = fixed ? snap.interventions[snap.interventions.length - 1]?.params ?? {} : {};

  const prod = prodV ?? prod0;
  const ctrl = ctrlV ?? ctrl0;
  let rate = req.line_rate_cps;
  let lateShare = prod ? late(prod) : 0;
  let latencyLateMs = prod ? maxLatency(prod) : deadlineMs * 1.16;
  let latencyOkMs = prod ? (lateShare > 0 ? Math.min(prod.data.budget?.best_case_last_result_ms ?? deadlineMs * 0.84, deadlineMs * 0.94) : maxLatency(prod)) : deadlineMs * 0.84;
  let drops = prod ? prod.data.resend_requests_total > 0 : false;
  let transport: Scene["transport"] = applied.ftd_step_ms ? "staggered" : applied.throughput_limit_mbps ? "paced" : "burst";
  let dark = ctrl ? CAM_IDS.filter((c) => ctrl.data.results?.[c] && ctrl.data.results[c].result !== "ok") : [];
  let single = false;
  let mode = fixed ? "fixed" : "production";
  let usable: number | null = prod && (fixed || have("stream.production")) ? prod.data.usable_frame_pct : null;
  let caption = "", tone: Hud["tone"] = "neutral";

  const wasDark = !!ctrl0 && CAM_IDS.some((c) => ctrl0.data.results?.[c] && ctrl0.data.results[c].result !== "ok");
  if (fixed) { caption = wasDark ? "After the fix: all four cameras are inspecting again, at full speed." : "After the fix: every answer beats the carton to the gate, at full speed."; tone = "ok"; }
  else if (lockout) { caption = "The line runs, sits idle for about an hour, then every camera locks the PC out."; tone = "bad"; }
  else if (dark.length) { caption = `Camera ${dark.map((c) => c.slice(3)).join(", ")} is dark. Someone is checking those cartons by hand.`; tone = "bad"; }
  else if (lateShare > 0) {
    caption = usable !== null ? `${pct(lateShare)} of answers reach the gate after the carton has passed. Those cartons are pushed off.` : "Cartons keep getting pushed off the line to manual inspection.";
    tone = "bad";
  } else caption = "The line is running.";

  const low = o.diagnostic === "D-STREAM-LOW" ? have("stream.low") : o.lowSpeed ? all.find((e) => e.key === "stream.low" && e.status === "ok") : undefined;
  const one = o.diagnostic === "D-STREAM-SINGLE" ? have("stream.single") : undefined;
  if (low) {
    rate = low.data.line_rate_cps; lateShare = late(low); latencyOkMs = latencyLateMs = maxLatency(low); drops = low.data.resend_requests_total > 0;
    mode = "low-speed"; usable = o.lowSpeed ? null : low.data.usable_frame_pct; tone = "test";
    caption = o.lowSpeed ? `At ${rate} cartons a second nothing is pushed off. It looks healthy.` : `Test at ${rate} cartons a second: the answer is just as slow, but the carton is slower, so nothing is pushed off.`;
  } else if (one) {
    single = true; lateShare = 0; drops = false; latencyOkMs = maxLatency(one); mode = "single"; usable = 100; tone = "test";
    caption = "Test: one camera at a time. Every picture arrives on time, so no camera is broken.";
  }
  if (o.peek) {
    const p = o.peek.predicted, prm = o.peek.params;
    mode = `preview:${o.peek.id}`; tone = o.peek.meets_requirements ? "ok" : "bad";
    if (p.usable_frame_pct !== undefined) {
      rate = p.line_rate_cps; lateShare = Math.max(0, 1 - p.usable_frame_pct / 100); latencyOkMs = latencyLateMs = p.worst_latency_p95_ms;
      transport = prm.ftd_step_ms ? "staggered" : prm.throughput_limit_mbps ? (p.per_camera_rate_mbps < 200 ? "crawl" : "paced") : "burst";
      drops = transport === "burst"; usable = p.usable_frame_pct;
      caption = lateShare > 0 ? "Predicted: pictures now arrive whole but too slowly. Every carton misses the gate." : rate < req.line_rate_cps ? `Predicted: nothing is pushed off, but only at ${rate} cartons a second, not the ${req.line_rate_cps} the plant needs.` : "Predicted: every answer beats the carton to the gate, at full speed.";
    } else {
      dark = []; caption = `Predicted: ${o.peek.tradeoff}`;
    }
  }

  const parts = partsAt(replay, o.frame);
  const culprit = PARTS.find((p) => parts[p].state === "culprit" || parts[p].state === "fixed") ?? null;
  const active = o.kind === "check" || o.kind === "ask";
  const fw = (have("versions")?.data.versions?.camera_firmware ?? Object.fromEntries((have("discovery")?.data.devices ?? []).map((d: any) => [d.device, d.firmware]))) as Record<string, string>;
  const showTags = !!o.detail || o.diagnostic === "D-VER";
  const adapters: string[] = [...(have("versions")?.data.versions?.adapters_installed ?? []), ...(applied.adapter ? [applied.adapter] : [])];

  const scene: Scene = {
    rate, requiredRate: req.line_rate_cps, deadlineMs, lateShare, latencyOkMs, latencyLateMs, transport, drops, single, dark, lockout: lockout && !fixed,
    reveal: {
      stream: snap.evidence.some((e) => e.key.startsWith("stream.")) || !!o.peek,
      switch: !!have("topology"), control: !!have("control"), heartbeat: !!have("events"),
    },
    probe: active && o.diagnostic ? PROBE[o.diagnostic] ?? null : null,
    focus: o.focus !== undefined ? o.focus : active && o.diagnostic ? FOCUS[o.diagnostic] ?? null : o.kind === "choose" || o.kind === "verdict" ? culprit : null,
    parts: Object.fromEntries(PARTS.map((p) => [p, { state: parts[p].state, open: parts[p].open }])) as Scene["parts"],
    camTag: showTags ? Object.fromEntries(CAM_IDS.filter((c) => fw[c]).map((c) => [c, `fw ${fw[c]}`])) as Partial<Record<CamId, string>> : {},
    pcTag: showTags && adapters.length ? adapters.map((a) => a.replace("vireo-", "")).join(" + ") : "",
    detail: !!o.detail,
    mode,
  };
  return { scene, hud: { rate, requiredRate: req.line_rate_cps, usable, caption, tone }, parts };
}
