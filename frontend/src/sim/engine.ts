// The animated line. Outcomes (how many results are late, by how much, at what line rate) come from
// the engine's recorded evidence via Scene; this file only choreographs them in slow motion.
import {
  CAM_IDS, CY, GATE_D, LANE, LANE_SLOTS, LANE_Y, PALLET, SPACING, T_DEADLINE, V_REQ, X_END, X_GATE, X_SPAWN, X_TRIG,
  type CamId, type Part,
} from "./world";

export type PartState = "idle" | "suspect" | "cleared" | "culprit" | "fixed";
export type Probe = "ctrl" | "disc" | "plc" | "mgmt" | "host" | "tech" | null;

export interface Scene {
  rate: number; requiredRate: number; deadlineMs: number;
  lateShare: number; latencyOkMs: number; latencyLateMs: number;
  transport: "burst" | "paced" | "staggered" | "crawl";
  drops: boolean;
  /** Test mode: one camera acquires at a time. */
  single: boolean;
  /** Cameras that are not acquiring. */
  dark: CamId[];
  /** The idle → access-denied → restart cycle from the event log. */
  lockout: boolean;
  reveal: { stream: boolean; switch: boolean; control: boolean; heartbeat: boolean };
  probe: Probe;
  focus: Part | null;
  parts: Record<Part, { state: PartState; open: number }>;
  camTag: Partial<Record<CamId, string>>;
  pcTag: string;
  /** Engineer lens: model names and numbers on labels. */
  detail: boolean;
  mode: string;
}

export interface Carton {
  id: number; x: number; y: number;
  state: "belt" | "chute" | "lane" | "pallet" | "out";
  triggered: boolean;
  result: "none" | "pending" | "ok" | "late";
  t0: number; due: number; // result requested / expected
  u: number; // progress along chute or pallet slide
  slot: number;
  fade: number;
  hand: number; // time a person checked it by hand
}
export type DotKind = "data" | "resend" | "nack" | "result" | "trig" | "ctrl" | "hb" | "mgmt" | "deny";
export interface Dot { path: string; t0: number; dur: number; kind: DotKind; rev: boolean; end?: () => void }
export interface Spark { x: number; y: number; vx: number; vy: number; t0: number }
export interface Ping { t: number; ok: boolean }
export type LockPhase = "run" | "idle" | "denied" | "stopped" | "restart";

const frac = (v: number) => v - Math.floor(v);
const LOCK_DUR: Record<LockPhase, number> = { run: 7.5, idle: 4.2, denied: 1.5, stopped: 3.4, restart: 1.1 };
const LOCK_NEXT: Record<LockPhase, LockPhase> = { run: "idle", idle: "denied", denied: "stopped", stopped: "restart", restart: "run" };
const BENCH_TIME = 5.5;

export class LineSim {
  t = 0;
  v = 0;
  beltPhase = 0;
  cartons: Carton[] = [];
  lane: Carton[] = [];
  dots: Dot[] = [];
  sparks: Spark[] = [];
  backlog = 0;
  buffer = 0;
  bufferLevel = 0;
  overflowAt = -9;
  flash: Record<CamId, number> = { cam1: -9, cam2: -9, cam3: -9, cam4: -9 };
  ping: Partial<Record<CamId, Ping>> = {};
  pcFlash = -9;
  kickAt = -9;
  lateAt = -9;
  discAt = -9;
  benchAt = 0;
  checkedAt = -9;
  phase: LockPhase = "run";
  phaseT = 0;
  locked = false;
  private nextId = 0;
  private spawnAcc = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private probeAt = 0;
  private mgmtAt = 0;
  private hbAt = 0;

  constructor(public s: Scene) {}

  /** Fill the belt so the first frame is not an empty line. */
  prime() {
    for (let x = X_SPAWN + SPACING * 0.6; x < X_TRIG - 20; x += SPACING) this.spawn(x);
    this.v = this.targetV();
    for (let i = 0; i < 260; i++) this.update(1 / 30);
  }

  setScene(s: Scene) {
    const wasLock = this.s.lockout;
    this.s = s;
    if (!s.lockout && wasLock) { this.locked = false; this.phase = "run"; this.phaseT = 0; }
    this.probeAt = 0;
  }

  private at(delay: number, fn: () => void) { this.timers.push({ at: this.t + delay, fn }); }
  private dot(path: string, delay: number, dur: number, kind: DotKind, rev = false, end?: () => void) {
    this.dots.push({ path, t0: this.t + delay, dur, kind, rev, end });
  }
  private running() { return !(this.s.lockout && this.phase !== "run"); }
  private targetV() { return this.running() ? (V_REQ * this.s.rate) / this.s.requiredRate : 0; }
  shooting(id: CamId) { return !this.locked && !this.s.dark.includes(id); }

  private spawn(x = X_SPAWN) {
    this.cartons.push({ id: this.nextId++, x, y: CY, state: "belt", triggered: false, result: "none", t0: 0, due: 0, u: 0, slot: 0, fade: 1, hand: -9 });
  }

  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 0.05);
    this.t += dt;
    const s = this.s;

    if (s.lockout) this.tickLock(dt);
    this.v += (this.targetV() - this.v) * Math.min(1, dt * 4);
    this.beltPhase += this.v * dt;
    this.spawnAcc += this.v * dt;
    if (this.spawnAcc >= SPACING) { this.spawnAcc -= SPACING; this.spawn(); }

    for (const c of this.cartons) this.moveCarton(c, dt);
    this.cartons = this.cartons.filter((c) => c.state !== "out");
    this.tickBench();

    for (let i = 0; i < this.timers.length; i++) {
      if (this.timers[i].at <= this.t) { const f = this.timers[i].fn; this.timers.splice(i--, 1); f(); }
    }
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (this.t >= d.t0 + d.dur) { this.dots.splice(i--, 1); d.end?.(); }
    }
    this.sparks = this.sparks.filter((p) => this.t - p.t0 < 0.7);
    for (const p of this.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; }
    this.bufferLevel += (this.buffer - this.bufferLevel) * Math.min(1, dt * 12);

    this.tickProbe();
    if (this.t - this.mgmtAt > 2.6) { this.mgmtAt = this.t; this.dot("mgmt", 0, 0.9, "mgmt"); }
  }

  private moveCarton(c: Carton, dt: number) {
    if (c.state === "belt") {
      const before = c.x;
      c.x += this.v * dt;
      if (before < X_TRIG && c.x >= X_TRIG) this.trigger(c);
      if (before < X_TRIG + 84 && c.x >= X_TRIG + 84 && this.s.dark.length && !this.s.lockout) c.hand = this.t;
      if (before < X_GATE && c.x >= X_GATE && c.result === "pending") {
        c.result = "late";
        c.state = "chute";
        this.kickAt = this.t;
      }
      if (c.x > X_END) c.state = "out";
    } else if (c.state === "chute") {
      c.u += dt / 0.6;
      const u = Math.min(1, c.u), e = u * u * (3 - 2 * u);
      c.x = X_GATE + 12 + 33 * e;
      c.y = CY + (LANE_Y - CY) * e;
      if (u >= 1) {
        if (this.lane.length < LANE_SLOTS) { c.state = "lane"; this.lane.push(c); }
        else { c.state = "pallet"; c.u = 0; }
      }
    } else if (c.state === "lane") {
      const k = this.lane.indexOf(c);
      const target = LANE.x1 - 34 - k * 62;
      c.x = Math.min(target, c.x + 150 * dt);
      if (k < 0) { c.fade -= dt * 3; if (c.fade <= 0) c.state = "out"; }
    } else if (c.state === "pallet") {
      c.u += dt / 0.45;
      c.x = X_GATE + 45 + (PALLET.x + PALLET.w / 2 - X_GATE - 45) * Math.min(1, c.u);
      if (c.u >= 1) { this.backlog++; c.state = "out"; }
    }
  }

  private tickBench() {
    if (this.t - this.benchAt < BENCH_TIME) return;
    const head = this.lane[0];
    if (head && head.x >= LANE.x1 - 40) {
      this.lane.shift();
      this.benchAt = this.t;
      this.checkedAt = this.t;
      if (this.backlog > 0 && this.lane.length < LANE_SLOTS) {
        this.backlog--;
        const c: Carton = { id: this.nextId++, x: PALLET.x + PALLET.w + 30, y: LANE_Y, state: "lane", triggered: true, result: "late", t0: 0, due: 0, u: 1, slot: 0, fade: 1, hand: -9 };
        this.cartons.push(c);
        this.lane.push(c);
      }
    }
  }

  private trigger(c: Carton) {
    const s = this.s;
    let active = CAM_IDS.filter((id) => this.shooting(id));
    if (!active.length) return;
    if (s.single) active = [active[c.id % active.length]];
    c.triggered = true;
    c.result = "pending";
    for (const id of active) this.flash[id] = this.t;
    this.dot("trig", 0, 0.14, "trig");

    const late = s.lateShare > 0 && frac(c.id * 0.618034 + 0.31) < s.lateShare;
    const L = ((late ? s.latencyLateMs : s.latencyOkMs) / s.deadlineMs) * T_DEADLINE;
    c.t0 = this.t;
    c.due = this.t + L;
    const n = 4, tau1 = 0.2, tau2 = 0.13, done = L * 0.86;
    type A = { id: CamId; depart: number; arrive: number; drop: boolean; resend: boolean; dep: number };
    const first: A[] = [];
    const dropPerCam = s.drops ? (late ? 2 : s.lateShare === 0 ? 1 : 0) : 0;
    active.forEach((id, k) => {
      for (let i = 0; i < n; i++) {
        let off = 0, gap = 0.03;
        if (s.transport === "paced") gap = (L * 0.4) / n;
        else if (s.transport === "staggered") { off = k * L * 0.13; gap = 0.028; }
        else if (s.transport === "crawl") gap = (L * 0.62) / n;
        const depart = 0.03 + off + i * gap;
        const drop = dropPerCam === 2 ? i >= n - 2 : dropPerCam === 1 ? i === n - 1 && k === c.id % active.length : false;
        first.push({ id, depart, arrive: depart + tau1, drop, resend: false, dep: 0 });
      }
    });
    const resends: A[] = first.filter((a) => a.drop).map((a) => ({ ...a, drop: false, resend: true, depart: a.arrive + 0.12, arrive: a.arrive + 0.12 + tau1 }));
    const queue = [...first.filter((a) => !a.drop), ...resends].sort((a, b) => a.arrive - b.arrive);
    const t1 = queue[0].arrive, t2 = Math.max(t1 + 0.05, done - tau2);
    queue.forEach((a, j) => { a.dep = Math.max(a.arrive + 0.015, t1 + ((t2 - t1) * (j + 1)) / queue.length); });

    for (const a of first) {
      this.dot(a.id, a.depart, tau1, "data", false, a.drop ? () => this.overflow(a.id) : () => { this.buffer++; });
    }
    for (const a of queue) {
      if (a.resend) this.dot(a.id, a.depart, tau1, "resend", false, () => { this.buffer++; });
      this.at(a.dep, () => { this.buffer = Math.max(0, this.buffer - 1); this.dot("uplink", 0, tau2, a.resend ? "resend" : "data"); });
    }
    const lastIn = Math.max(done, queue[queue.length - 1].dep + tau2);
    this.at(lastIn, () => { this.pcFlash = this.t; this.dot("result", 0, Math.max(0.05, L - lastIn), "result"); });
    this.at(L, () => {
      if (c.state === "belt" && c.x < X_GATE) { c.result = "ok"; this.dot("gate", 0, 0.16, "result"); }
      else this.lateAt = this.t;
    });
  }

  private overflow(id: CamId) {
    this.overflowAt = this.t;
    for (let i = 0; i < 3; i++) this.sparks.push({ x: 0, y: 0, vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 70, t0: this.t });
    this.dot(id, 0.02, 0.1, "nack", true);
  }

  private tickLock(dt: number) {
    this.phaseT += dt;
    if (this.s.reveal.heartbeat && (this.phase === "run" || this.phase === "idle") && this.t - this.hbAt > 1.15) {
      this.hbAt = this.t;
      this.heartbeat(true);
    }
    if (this.phaseT < LOCK_DUR[this.phase]) return;
    this.phase = LOCK_NEXT[this.phase];
    this.phaseT = 0;
    if (this.phase === "denied") {
      if (this.s.reveal.heartbeat) this.heartbeat(false);
      this.at(this.s.reveal.heartbeat ? 0.55 : 0.2, () => { this.locked = true; });
    }
    if (this.phase === "restart") this.pcFlash = this.t;
    if (this.phase === "run") { this.locked = false; for (const id of CAM_IDS) this.ping[id] = { t: this.t, ok: true }; }
  }

  private heartbeat(ok: boolean) {
    this.dot("uplink", 0, 0.12, "hb", true);
    for (const id of CAM_IDS) {
      this.dot(id, 0.12, 0.22, "hb", true, () => {
        this.ping[id] = { t: this.t, ok };
        this.dot(id, 0, 0.2, ok ? "hb" : "deny");
      });
    }
  }

  private tickProbe() {
    const p = this.s.probe;
    if (!p || this.t < this.probeAt) return;
    if (p === "ctrl") {
      this.probeAt = this.t + 1.7;
      this.dot("uplink", 0, 0.14, "ctrl", true);
      for (const id of CAM_IDS) {
        const ok = !this.s.dark.includes(id) && !this.locked;
        this.dot(id, 0.14, 0.28, "ctrl", true, () => { this.ping[id] = { t: this.t, ok }; if (ok) this.dot(id, 0, 0.24, "ctrl"); });
      }
    } else if (p === "disc") {
      this.probeAt = this.t + 2.2;
      this.discAt = this.t;
      CAM_IDS.forEach((id, i) => this.at(0.35 + i * 0.12, () => { this.ping[id] = { t: this.t, ok: true }; }));
    } else {
      this.probeAt = this.t + 1.2;
    }
  }

  /** Share of the deadline already used by a pending result, for the ring on each carton. */
  progress(c: Carton) { return c.due > c.t0 ? Math.min(1, (this.t - c.t0) / (c.due - c.t0)) : 0; }
}

export const GATE_SHARE = GATE_D / SPACING;
