// Canvas renderer for the line. Painter's order, back to front.
import type { Carton, LineSim, PartState, Scene } from "./engine";
import {
  ANCHOR, BELT, BENCH, CAMS, CAM_IDS, CARTON, CHUTE, CY, DASH, GANTRY, H, LANE, LANE_Y, P, PALLET, PARTS, PATHS, PC, PLC,
  SWITCH, W, WALL_D, WALL_Y, X_GATE, X_TRIG, along, path2, type CamId, type Part, type V2,
} from "./world";

export interface View { s: number; tx: number; ty: number }
export function fitView(cw: number, ch: number, r: [number, number, number, number]): View {
  const s = Math.min(cw / r[2], ch / r[3]);
  return { s, tx: (cw - r[2] * s) / 2 - r[0] * s, ty: (ch - r[3] * s) / 2 - r[1] * s };
}
export const FULL: [number, number, number, number] = [0, 0, W, H];

const C = {
  bg0: "#080b10", bg1: "#0d131b", wall0: "#0f1620", wall1: "#141d2a", grid: "rgba(130,160,200,0.06)",
  metal: { front: "#263244", top: "#34455c", side: "#1a2330" },
  dark: { front: "#1a222e", top: "#242f3f", side: "#121821" },
  belt: "#12161c", rib: "rgba(255,255,255,0.055)",
  carton: { front: "#c8985e", top: "#e2bc8a", side: "#9c7343" },
  accent: "#f2b705", cyan: "#58d3ff", ok: "#3ddc97", bad: "#ff5a4f", warn: "#ffb020", ink: "#e9eef4", dim: "#8b97a6",
  cable: "#2c3848",
};
const STATE_COL: Record<PartState, string> = { idle: C.dim, suspect: C.warn, cleared: C.ok, culprit: C.bad, fixed: C.ok };
const STATE_GLYPH: Record<PartState, string> = { idle: "", suspect: "?", cleared: "✓", culprit: "!", fixed: "✓" };
const FONT = `"Barlow", ui-sans-serif, system-ui, sans-serif`;
const DISPLAY = `"Barlow Condensed", "Barlow", ui-sans-serif, sans-serif`;
const MONO = `"JetBrains Mono Variable", ui-monospace, Menlo, monospace`;

type Ctx = CanvasRenderingContext2D;
type Pal = { front: string; top: string; side: string };

function poly(ctx: Ctx, pts: V2[], fill?: string, stroke?: string, lw = 1) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function box(ctx: Ctx, x: number, y: number, z: number, w: number, d: number, h: number, c: Pal, edge = "rgba(0,0,0,0.35)") {
  poly(ctx, [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], c.side, edge);
  poly(ctx, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], c.top, edge);
  poly(ctx, [P(x, y, z), P(x + w, y, z), P(x + w, y, z + h), P(x, y, z + h)], c.front, edge);
}
function line3(ctx: Ctx, pts: [number, number, number][], col: string, lw: number) {
  ctx.beginPath();
  pts.forEach((p, i) => { const q = P(p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
}
function glow(ctx: Ctx, x: number, y: number, r: number, col: string, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, "transparent");
  ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
const ease = (u: number) => u * u * (3 - 2 * u);

export interface DrawOpts { compact: boolean; t: number }

export function draw(ctx: Ctx, sim: LineSim, view: View, cw: number, ch: number, o: DrawOpts) {
  const s = sim.s, t = sim.t;
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, C.bg0); bg.addColorStop(1, C.bg1);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(view.tx, view.ty); ctx.scale(view.s, view.s);
  const ui = Math.max(0.85, Math.min(2.4, 1 / view.s)); // keeps text a constant size on screen

  floorAndWall(ctx);
  wires(ctx, s, sim);
  wallGear(ctx, sim, ui);
  camera(ctx, sim, "cam2");
  if (s.dark.length && !s.lockout) person(ctx, X_TRIG + 84, 190, t, "check");
  if (s.lockout && (sim.phase === "stopped" || sim.phase === "restart")) person(ctx, PC.x + 40, 248, t, "walk");
  gantryBack(ctx);
  conveyor(ctx, sim);
  diverter(ctx, sim);
  for (const c of sim.cartons) if (c.state === "belt") carton(ctx, sim, c);
  gantryFront(ctx, sim);
  machine(ctx, -64, "LABEL");
  machine(ctx, BELT.x1 - 40, "SEAL");
  bench(ctx, sim);
  lane(ctx);
  for (const c of sim.cartons) if (c.state !== "belt") carton(ctx, sim, c);
  pallet(ctx, sim, ui);
  camera(ctx, sim, "cam1");
  if (s.probe === "tech") { person(ctx, 110, 0, t, "talk"); bubble(ctx, P(110, 0, 78), "?", ui); }

  flashes(ctx, sim);
  dots(ctx, sim);
  fx(ctx, sim, ui);
  spotlight(ctx, sim, view, cw, ch);
  labels(ctx, sim, ui, o.compact);
  banner(ctx, sim, ui);
  ctx.restore();
}

function floorAndWall(ctx: Ctx) {
  poly(ctx, [P(-900, -400), P(2200, -400), P(2200, WALL_Y), P(-900, WALL_Y)], "#0c1219");
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -900; x <= 2200; x += 60) { const a = P(x, -400), b = P(x, WALL_Y); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  for (let y = -360; y <= WALL_Y; y += 60) { const a = P(-900, y), b = P(2200, y); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  // safety markings on the floor
  ctx.setLineDash([10, 8]);
  poly(ctx, [P(GANTRY.x0 - 34, 30), P(GANTRY.x1 + 34, 30), P(GANTRY.x1 + 34, 240), P(GANTRY.x0 - 34, 240)], undefined, "rgba(242,183,5,0.22)", 2);
  poly(ctx, [P(PALLET.x - 18, -108), P(BENCH.x1 + 18, -108), P(BENCH.x1 + 18, -14), P(PALLET.x - 18, -14)], undefined, "rgba(242,183,5,0.16)", 2);
  ctx.setLineDash([]);
  // wall
  const [, wy0] = P(0, WALL_Y, 0), [, wy1] = P(0, WALL_Y, 520);
  const g = ctx.createLinearGradient(0, wy1, 0, wy0);
  g.addColorStop(0, C.wall0); g.addColorStop(1, C.wall1);
  ctx.fillStyle = g; ctx.fillRect(-1200, wy1, 3600, wy0 - wy1);
  ctx.fillStyle = "rgba(242,183,5,0.5)"; ctx.fillRect(-1200, wy0 - 3, 3600, 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-1200, wy0 - 1, 3600, 5);
  ctx.font = `700 78px ${DISPLAY}`; ctx.fillStyle = "rgba(255,255,255,0.035)"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const lp = P(-40, WALL_Y, 96); ctx.fillText("LINE 3", lp[0], lp[1]);
}

function wires(ctx: Ctx, s: Scene, sim: LineSim) {
  for (const id of Object.keys(PATHS)) {
    const big = id === "uplink";
    line3(ctx, PATHS[id], "rgba(0,0,0,0.5)", big ? 9 : 4.5);
    let col = C.cable;
    if (id === "uplink" && s.reveal.switch && sim.t - sim.overflowAt < 0.5) col = "#6b2a2a";
    line3(ctx, PATHS[id], col, big ? 6 : 2.4);
  }
}

function wallGear(ctx: Ctx, sim: LineSim, ui: number) {
  const s = sim.s, t = sim.t, y = WALL_Y - WALL_D;
  // network switch
  box(ctx, SWITCH.x, y, SWITCH.z, SWITCH.w, WALL_D, SWITCH.h, C.metal);
  for (let i = 0; i < 8; i++) {
    const [px, py] = P(SWITCH.x + 12 + i * 14, y, SWITCH.z + SWITCH.h - 11);
    const cam = CAM_IDS[i];
    const on = cam ? sim.shooting(cam) && t - sim.flash[cam] < 0.5 && Math.sin(t * 60 + i) > 0 : i === 7 && sim.bufferLevel > 0.2;
    ctx.fillStyle = on ? C.ok : "#0c1118"; ctx.fillRect(px, py, 8, 5);
  }
  if (s.reveal.switch) {
    const [gx, gy] = P(SWITCH.x + 12, y, SWITCH.z + 8), gw = SWITCH.w - 24, lvl = Math.min(1, sim.bufferLevel / 9);
    const over = t - sim.overflowAt < 0.35;
    ctx.fillStyle = "#0a0e14"; ctx.fillRect(gx, gy - 12, gw, 12);
    ctx.fillStyle = lvl > 0.85 || over ? C.bad : lvl > 0.5 ? C.warn : C.cyan; ctx.fillRect(gx, gy - 12, gw * lvl, 12);
    ctx.strokeStyle = over ? C.bad : "rgba(255,255,255,0.25)"; ctx.lineWidth = over ? 2 : 1; ctx.strokeRect(gx, gy - 12, gw, 12);
  } else {
    const [gx, gy] = P(SWITCH.x + 12, y, SWITCH.z + 8);
    ctx.fillStyle = "#101720"; ctx.fillRect(gx, gy - 12, SWITCH.w - 24, 12);
  }
  // inspection PC
  box(ctx, PC.x, y, 0, PC.w, WALL_D, PC.h, C.metal);
  const [sx, sy] = P(PC.x + 10, y, PC.h - 12), sw = PC.w - 20, sh = 50;
  const stopped = s.lockout && sim.locked, restarting = s.lockout && sim.phase === "restart";
  const flash = Math.max(0, 1 - (t - sim.pcFlash) / 0.35);
  ctx.fillStyle = stopped ? "#3a1512" : "#0a1a22"; ctx.fillRect(sx, sy, sw, sh);
  if (stopped && !restarting) {
    ctx.fillStyle = C.bad; ctx.font = `700 ${11}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (Math.sin(t * 8) > -0.3) ctx.fillText("NO CAMERA", sx + sw / 2, sy + sh / 2);
  } else if (restarting) {
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx + sw / 2, sy + sh / 2, 11, t * 7, t * 7 + 4.2); ctx.stroke();
  } else {
    for (let i = 0; i < 4; i++) {
      const cam = CAM_IDS[i], live = sim.shooting(cam);
      ctx.fillStyle = live ? `rgba(88,211,255,${0.18 + 0.5 * Math.max(0, 1 - (t - sim.flash[cam]) / 0.5)})` : "rgba(255,90,79,0.5)";
      ctx.fillRect(sx + 5 + (i % 2) * (sw / 2 - 2), sy + 5 + Math.floor(i / 2) * (sh / 2 - 2), sw / 2 - 8, sh / 2 - 8);
    }
    if (flash > 0) { ctx.fillStyle = `rgba(61,220,151,${flash * 0.55})`; ctx.fillRect(sx, sy, sw, sh); }
    if (s.probe === "host") {
      ctx.fillStyle = "rgba(8,11,16,0.85)"; ctx.fillRect(sx, sy, sw, sh);
      for (let i = 0; i < 6; i++) { const hgt = 8 + 10 * (0.5 + 0.5 * Math.sin(t * 3 + i * 1.7)); ctx.fillStyle = C.ok; ctx.fillRect(sx + 7 + i * 10, sy + sh - 6 - hgt, 6, hgt); }
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, sw, sh);
  const [vx, vy] = P(PC.x + 12, y, 44);
  ctx.fillStyle = "rgba(0,0,0,0.3)"; for (let i = 0; i < 5; i++) ctx.fillRect(vx, vy + i * 6, PC.w - 24, 2.5);
  // line controller with a stack light
  box(ctx, PLC.x, y, 0, PLC.w, WALL_D, PLC.h, C.dark);
  const [lx, ly] = P(PLC.x + 12, y, PLC.h - 14);
  ctx.fillStyle = "#0b1016"; ctx.fillRect(lx, ly, PLC.w - 24, 28);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = (Math.floor(t * 5 + i * 1.3) % 3 === 0 && sim.v > 5) ? C.ok : "#1d2836"; ctx.fillRect(lx + 4 + (i % 3) * 11, ly + 5 + Math.floor(i / 3) * 11, 7, 6); }
  const kicked = t - sim.kickAt < 0.9, down = s.lockout && sim.locked;
  const tower: [string, boolean][] = [[C.bad, down], [C.warn, kicked && !down], [C.ok, !down && !kicked && sim.v > 5]];
  tower.forEach(([col, on], i) => {
    const [tx, ty] = P(PLC.x + PLC.w / 2 + 4, WALL_Y - WALL_D / 2, PLC.h + 30 - i * 10);
    if (on) glow(ctx, tx, ty + 4, 22, col, 0.55);
    ctx.fillStyle = on ? col : "#1e2835"; rr(ctx, tx - 6, ty, 12, 9, 2); ctx.fill();
  });
  // plant dashboard
  box(ctx, DASH.x, y + 14, DASH.z, DASH.w, 8, DASH.h, C.dark);
  const [dx, dy] = P(DASH.x + 6, y + 14, DASH.z + DASH.h - 6), dw = DASH.w - 12, dh = DASH.h - 12;
  ctx.fillStyle = "#0b1a26"; ctx.fillRect(dx, dy, dw, dh);
  ctx.strokeStyle = "rgba(88,211,255,0.75)"; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= 14; i++) { const yy = dy + dh - 10 - 16 * (0.5 + 0.5 * Math.sin(i * 0.9 + Math.floor(t * 1.2) * 0.7)) - (i > 10 ? 6 : 0); if (i) ctx.lineTo(dx + 6 + (i * (dw - 12)) / 14, yy); else ctx.moveTo(dx + 6, yy); }
  ctx.stroke();
  ctx.fillStyle = C.ok; ctx.beginPath(); ctx.arc(dx + dw - 8, dy + 8, 3, 0, 7); ctx.fill();
  void ui;
}

function gantryBack(ctx: Ctx) {
  const g = GANTRY;
  box(ctx, g.x0 - 4, g.y1, 0, 8, 8, g.h, C.dark);
  box(ctx, g.x1 - 4, g.y1, 0, 8, 8, g.h, C.dark);
  box(ctx, g.x0 - 4, g.y1, g.h, g.x1 - g.x0 + 8, 8, 8, C.metal);
  // photo-eye
  box(ctx, X_TRIG - 4, BELT.y1 + 4, 0, 8, 6, 60, C.dark);
}

function conveyor(ctx: Ctx, sim: LineSim) {
  const b = BELT;
  for (let x = b.x0 + 60; x < b.x1; x += 150) box(ctx, x, b.y0 + 6, 0, 10, b.y1 - b.y0 - 12, b.z - 12, C.dark);
  box(ctx, b.x0, b.y0, b.z - 12, b.x1 - b.x0, b.y1 - b.y0, 12, { front: "#222c3b", top: C.belt, side: "#161d27" });
  const a = P(b.x0, b.y0, b.z - 3), z = P(b.x1, b.y0, b.z - 3);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(z[0], z[1]); ctx.stroke();
  ctx.strokeStyle = C.rib; ctx.lineWidth = 2; ctx.beginPath();
  const off = sim.beltPhase % 26;
  for (let x = b.x0 + off; x < b.x1; x += 26) { const p = P(x, b.y0 + 2, b.z), q = P(x, b.y1 - 2, b.z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
  ctx.stroke();
  // sensor beam and the deadline stretch
  const s1 = P(X_TRIG, b.y0, b.z + 14), s2 = P(X_TRIG, b.y1 + 4, b.z + 14);
  ctx.strokeStyle = "rgba(255,90,79,0.7)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
  const d1 = P(X_TRIG, b.y0, b.z - 20), d2 = P(X_GATE, b.y0, b.z - 20);
  ctx.strokeStyle = "rgba(242,183,5,0.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(d1[0], d1[1] - 5); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.lineTo(d2[0], d2[1] - 5); ctx.stroke(); ctx.setLineDash([]);
}

function carton(ctx: Ctx, sim: LineSim, c: Carton) {
  const { w, d, h } = CARTON, x = c.x - w / 2, y = c.y - d / 2, z = BELT.z;
  ctx.globalAlpha = Math.max(0, c.fade);
  box(ctx, x, y, z, w, d, h, C.carton, "rgba(60,40,15,0.5)");
  const [tx, ty] = P(x, y, z + h);
  ctx.fillStyle = "rgba(120,85,40,0.55)"; ctx.fillRect(tx, ty + h * 0.44, w, 3);
  ctx.fillStyle = "#f3eee4"; ctx.fillRect(tx + 6, ty + 7, 24, 15);
  ctx.fillStyle = "#2a2f36"; for (let i = 0; i < 6; i++) ctx.fillRect(tx + 9 + i * 3.2, ty + 10, i % 2 ? 1 : 2, 9);
  // result lamp: fills while the PC is still deciding
  const lx = tx + w - 11, ly = ty + 13;
  if (c.result !== "none") {
    const col = c.result === "ok" ? C.ok : c.result === "late" ? C.bad : C.warn;
    if (c.result !== "pending") glow(ctx, lx, ly, 15, col, 0.5 * c.fade);
    ctx.fillStyle = "#1b1410"; ctx.beginPath(); ctx.arc(lx, ly, 7, 0, 7); ctx.fill();
    if (c.result === "pending") {
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(lx, ly, 5, -1.57, -1.57 + 6.283 * sim.progress(c)); ctx.stroke();
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 5.5, 0, 7); ctx.fill();
      ctx.strokeStyle = "#0b0e12"; ctx.lineWidth = 1.8; ctx.beginPath();
      if (c.result === "ok") { ctx.moveTo(lx - 2.8, ly); ctx.lineTo(lx - 0.8, ly + 2.2); ctx.lineTo(lx + 3, ly - 2.2); }
      else { ctx.moveTo(lx - 2.3, ly - 2.3); ctx.lineTo(lx + 2.3, ly + 2.3); ctx.moveTo(lx + 2.3, ly - 2.3); ctx.lineTo(lx - 2.3, ly + 2.3); }
      ctx.stroke();
    }
  }
  const hk = sim.t - c.hand;
  if (hk >= 0 && hk < 0.9) {
    const [hx, hy] = P(c.x, c.y, z + h + 10 + hk * 14);
    ctx.globalAlpha = 1 - hk / 0.9; ctx.fillStyle = C.accent; ctx.font = `700 13px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("✓ by hand", hx, hy);
  }
  ctx.globalAlpha = 1;
}

function gantryFront(ctx: Ctx, sim: LineSim) {
  const g = GANTRY;
  box(ctx, g.x0 - 4, g.y0 - 8, 0, 8, 8, g.h, C.metal);
  box(ctx, g.x1 - 4, g.y0 - 8, 0, 8, 8, g.h, C.metal);
  box(ctx, g.x0 - 4, g.y0 - 8, g.h, 8, g.y1 - g.y0 + 16, 8, C.metal);
  box(ctx, g.x1 - 4, g.y0 - 8, g.h, 8, g.y1 - g.y0 + 16, 8, C.metal);
  box(ctx, g.x0, CY - 4, g.h - 2, g.x1 - g.x0, 8, 6, C.dark);
  box(ctx, g.x0 - 4, g.y0 - 8, g.h, g.x1 - g.x0 + 8, 8, 8, C.metal);
  camera(ctx, sim, "cam3");
  camera(ctx, sim, "cam4");
}

function camera(ctx: Ctx, sim: LineSim, id: CamId) {
  const [x, y, z] = CAMS[id].pos, t = sim.t, s = sim.s;
  const live = sim.shooting(id), fl = Math.max(0, 1 - (t - sim.flash[id]) / 0.25);
  if (id === "cam1" || id === "cam2") box(ctx, x - 3, y - 3, 0, 6, 6, z - 8, C.dark);
  box(ctx, x - 12, y - 8, z - 8, 24, 16, 16, { front: "#0f141b", top: "#2a3647", side: "#090c11" }, "rgba(255,255,255,0.14)");
  const lens = id === "cam1" ? P(x, y + 8, z) : id === "cam2" ? P(x, y - 8, z) : P(x, y - 8, z - 9);
  const col = !live ? C.bad : fl > 0 ? "#ffffff" : C.cyan;
  if (fl > 0 && live) glow(ctx, lens[0], lens[1], 26, "#ffffff", fl * 0.9);
  if (!live) glow(ctx, lens[0], lens[1], 16, C.bad, 0.35 + 0.2 * Math.sin(t * 6));
  ctx.fillStyle = "#05070a"; ctx.beginPath(); ctx.arc(lens[0], lens[1], 5.5, 0, 7); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(lens[0], lens[1], 4, 0, 7); ctx.stroke();
  if (!live) {
    ctx.strokeStyle = C.bad; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(lens[0] - 3, lens[1] - 3); ctx.lineTo(lens[0] + 3, lens[1] + 3); ctx.moveTo(lens[0] + 3, lens[1] - 3); ctx.lineTo(lens[0] - 3, lens[1] + 3); ctx.stroke();
  }
  const [nx, ny] = P(x - 12, y - 8, z + 8);
  ctx.fillStyle = live ? "rgba(233,238,244,0.9)" : C.bad; ctx.font = `700 10px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (id === "cam3" || id === "cam4") ctx.fillText(String(CAMS[id].n), nx + 12, ny - 9);
  else ctx.fillText(String(CAMS[id].n), nx + (id === "cam1" ? 12 : 30), ny - (id === "cam1" ? 20 : 8));
  void s;
}

function machine(ctx: Ctx, x: number, name: string) {
  box(ctx, x, 90, 0, 94, 90, 118, C.metal);
  const [fx, fy] = P(x, 90, 118);
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(fx + 10, fy + 12, 74, 34);
  ctx.fillStyle = "rgba(242,183,5,0.85)"; ctx.font = `700 15px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(name, fx + 47, fy + 30);
  ctx.fillStyle = "#0b0f15"; ctx.fillRect(fx + 8, fy + 60, 78, 16);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? "#0b0f15" : "rgba(242,183,5,0.6)"; ctx.fillRect(fx + 8 + i * 13, fy + 104, 13, 6); }
}

function diverter(ctx: Ctx, sim: LineSim) {
  const k = ease(Math.max(0, 1 - Math.abs((sim.t - sim.kickAt) / 0.3 - 1)));
  const piv = P(X_GATE + 34, BELT.y1, BELT.z + 10);
  const tip = P(X_GATE - 24 + 44 * k, BELT.y1 - 54 * k, BELT.z + 10);
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 9; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(piv[0], piv[1] + 3); ctx.lineTo(tip[0], tip[1] + 3); ctx.stroke();
  ctx.strokeStyle = C.accent; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(piv[0], piv[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
  ctx.fillStyle = "#1a222e"; ctx.beginPath(); ctx.arc(piv[0], piv[1], 6, 0, 7); ctx.fill();
}

function lane(ctx: Ctx) {
  const roll = (x0: number, x1: number, y0: number, y1: number, alongX: boolean) => {
    box(ctx, x0, y0, BELT.z - 10, x1 - x0, y1 - y0, 10, { front: "#222c3b", top: "#171d26", side: "#161d27" });
    ctx.strokeStyle = "rgba(255,255,255,0.09)"; ctx.lineWidth = 2; ctx.beginPath();
    if (alongX) for (let x = x0 + 8; x < x1; x += 12) { const p = P(x, y0 + 2, BELT.z), q = P(x, y1 - 2, BELT.z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    else for (let y = y0 + 8; y < y1; y += 14) { const p = P(x0 + 2, y, BELT.z), q = P(x1 - 2, y, BELT.z); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  };
  roll(CHUTE.x0, CHUTE.x1, CHUTE.y0, CHUTE.y1, false);
  for (let x = LANE.x0 + 30; x < LANE.x1; x += 120) box(ctx, x, LANE.y0 + 6, 0, 8, LANE.y1 - LANE.y0 - 12, BELT.z - 10, C.dark);
  roll(LANE.x0, LANE.x1, LANE.y0, LANE.y1, true);
}

function bench(ctx: Ctx, sim: LineSim) {
  person(ctx, BENCH.x0 + 36, -8, sim.t, sim.lane.length ? "work" : "idle");
  box(ctx, BENCH.x0, BENCH.y0, 0, BENCH.x1 - BENCH.x0, BENCH.y1 - BENCH.y0, BENCH.z, C.metal);
  const k = sim.t - sim.checkedAt;
  if (k >= 0 && k < 0.8) { const [x, y] = P(BENCH.x0 + 36, LANE_Y, BENCH.z + 30 + k * 16); ctx.globalAlpha = 1 - k / 0.8; ctx.fillStyle = C.ok; ctx.font = `700 15px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("✓", x, y); ctx.globalAlpha = 1; }
}

function pallet(ctx: Ctx, sim: LineSim, ui: number) {
  const p = PALLET;
  box(ctx, p.x - 4, p.y - 4, 0, p.w + 8, p.d + 8, 7, { front: "#5a4630", top: "#6f573b", side: "#463625" });
  const n = Math.min(sim.backlog, 9);
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 3), col = i % 3;
    const w = 30, d = 24, h = 20;
    box(ctx, p.x + 2 + (col % 2) * 33, p.y + 2 + (col === 2 ? 27 : 0), 7 + layer * h, w, d, h, C.carton, "rgba(60,40,15,0.5)");
  }
  if (sim.backlog > 0) {
    const [x, y] = P(p.x + p.w / 2, p.y, 7 + Math.ceil(n / 3) * 20 + 18);
    const txt = `${sim.backlog} waiting`;
    ctx.font = `700 ${11 * ui}px ${FONT}`; const tw = ctx.measureText(txt).width + 14 * ui;
    ctx.fillStyle = C.bad; rr(ctx, x - tw / 2, y - 9 * ui, tw, 18 * ui, 9 * ui); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, x, y + 0.5);
  }
}

function person(ctx: Ctx, x: number, y: number, t: number, pose: "work" | "idle" | "check" | "talk" | "walk") {
  const [fx, fy] = P(x, y, 0);
  const bob = pose === "work" || pose === "check" ? Math.sin(t * 7) * 1.5 : pose === "walk" ? Math.sin(t * 10) * 1.2 : 0;
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(fx + 3, fy, 13, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#1c2430"; rr(ctx, fx - 7, fy - 30, 6, 30, 2); ctx.fill(); rr(ctx, fx + 1, fy - 30, 6, 30, 2); ctx.fill();
  ctx.fillStyle = "#ff7a1a"; rr(ctx, fx - 10, fy - 58 + bob, 20, 30, 5); ctx.fill();
  ctx.fillStyle = "#e9f15a"; ctx.fillRect(fx - 10, fy - 46 + bob, 20, 3.5);
  ctx.strokeStyle = "#ff7a1a"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath();
  const reach = pose === "work" || pose === "check" ? 8 + bob * 2 : 0;
  ctx.moveTo(fx - 9, fy - 53 + bob); ctx.lineTo(fx - 13 - reach * 0.3, fy - 38 + bob - reach);
  ctx.moveTo(fx + 9, fy - 53 + bob); ctx.lineTo(fx + 13 + reach * 0.3, fy - 38 + bob - reach); ctx.stroke();
  ctx.fillStyle = "#e3b48f"; ctx.beginPath(); ctx.arc(fx, fy - 66 + bob, 7, 0, 7); ctx.fill();
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(fx, fy - 68 + bob, 7.6, Math.PI, 0); ctx.fill(); ctx.fillRect(fx - 9, fy - 69 + bob, 18, 2.4);
}

function bubble(ctx: Ctx, p: V2, txt: string, ui: number) {
  const r = 11 * ui;
  ctx.fillStyle = "#f4f6f8"; ctx.beginPath(); ctx.arc(p[0] + r, p[1] - r, r, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(p[0] + r * 0.4, p[1] - r * 0.4); ctx.lineTo(p[0] - 2, p[1] + 4); ctx.lineTo(p[0] + r, p[1] - r * 0.2); ctx.fill();
  ctx.fillStyle = "#11161d"; ctx.font = `700 ${14 * ui}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, p[0] + r, p[1] - r + 1);
}

function flashes(ctx: Ctx, sim: LineSim) {
  const tgt = P(X_TRIG + 10, CY, BELT.z + CARTON.h / 2);
  for (const id of CAM_IDS) {
    const a = 1 - (sim.t - sim.flash[id]) / 0.22;
    if (a <= 0 || !sim.shooting(id)) continue;
    const [x, y, z] = CAMS[id].pos, from = P(x, y, z - (id === "cam3" || id === "cam4" ? 9 : 0));
    const dx = tgt[0] - from[0], dy = tgt[1] - from[1], n = Math.hypot(dx, dy), px = (-dy / n) * 22, py = (dx / n) * 22;
    const g = ctx.createLinearGradient(from[0], from[1], tgt[0], tgt[1]);
    g.addColorStop(0, `rgba(255,255,255,${0.55 * a})`); g.addColorStop(1, `rgba(255,255,255,${0.06 * a})`);
    poly(ctx, [from, [tgt[0] + px, tgt[1] + py], [tgt[0] - px, tgt[1] - py]], g as unknown as string);
  }
}

const DOT_COL: Record<string, string> = { data: C.cyan, resend: "#ff9d3c", nack: C.bad, result: C.ok, trig: C.accent, ctrl: "#c7a6ff", hb: "#c7a6ff", mgmt: "#7fb2ef", deny: C.bad };
function dots(ctx: Ctx, sim: LineSim) {
  const s = sim.s;
  ctx.globalCompositeOperation = "lighter";
  for (const d of sim.dots) {
    if (sim.t < d.t0) continue;
    if ((d.kind === "resend" || d.kind === "nack") && !s.reveal.switch) { if (d.kind === "nack") continue; }
    const kind = d.kind === "resend" && !s.reveal.switch ? "data" : d.kind;
    const f = (sim.t - d.t0) / d.dur, [x, y] = along(d.path, d.rev ? 1 - f : f);
    const big = kind === "result" || kind === "ctrl" || kind === "hb" || kind === "deny";
    const faint = (kind === "trig" && s.probe !== "plc") || (kind === "mgmt" && s.probe !== "mgmt");
    glow(ctx, x, y, big ? 11 : 8, DOT_COL[kind], faint ? 0.35 : 0.9);
    ctx.fillStyle = faint ? DOT_COL[kind] : "#ffffff"; ctx.globalAlpha = faint ? 0.5 : 0.95;
    ctx.beginPath(); ctx.arc(x, y, big ? 2.6 : 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
}

function fx(ctx: Ctx, sim: LineSim, ui: number) {
  const s = sim.s, t = sim.t;
  if (s.reveal.switch) {
    const o = path2("uplink").pts[0];
    for (const p of sim.sparks) {
      const a = 1 - (t - p.t0) / 0.7;
      ctx.fillStyle = `rgba(255,90,79,${a})`; ctx.fillRect(o[0] + p.x - 2, o[1] + p.y - 2, 4, 4);
    }
    const k = t - sim.overflowAt;
    if (k >= 0 && k < 0.5) glow(ctx, o[0], o[1], 34, C.bad, 0.5 * (1 - k / 0.5));
  }
  const dk = t - sim.discAt;
  if (s.probe === "disc" && dk >= 0 && dk < 1.1) {
    const [x, y] = ANCHOR.pc.at;
    ctx.strokeStyle = `rgba(199,166,255,${0.8 * (1 - dk / 1.1)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 30 + dk * 340, 0, 7); ctx.stroke();
  }
  for (const id of CAM_IDS) {
    const pg = sim.ping[id];
    if (!pg || t - pg.t > 1.3) continue;
    const k = (t - pg.t) / 1.3, [x, y, z] = CAMS[id].pos, [px, py] = P(x + 20, y, z + 12 + k * 10);
    ctx.globalAlpha = 1 - k * k;
    ctx.fillStyle = pg.ok ? C.ok : C.bad; ctx.beginPath(); ctx.arc(px, py, 8 * ui, 0, 7); ctx.fill();
    ctx.fillStyle = "#06090d"; ctx.font = `800 ${11 * ui}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(pg.ok ? "✓" : "✕", px, py + 0.5);
    ctx.globalAlpha = 1;
  }
  const lk = t - sim.lateAt;
  if (s.reveal.stream && lk >= 0 && lk < 1.1) {
    const [x, y] = P(X_GATE + 20, BELT.y0, BELT.z - 30 - lk * 6);
    const ms = Math.round((s.latencyLateMs - s.deadlineMs) * 10) / 10;
    ctx.globalAlpha = 1 - lk / 1.1; ctx.fillStyle = C.bad; ctx.font = `700 ${12 * ui}px ${s.detail ? MONO : FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(s.detail && ms > 0 ? `result +${ms} ms late` : "answer came too late", x, y); ctx.globalAlpha = 1;
  }
}

function spotlight(ctx: Ctx, sim: LineSim, view: View, cw: number, ch: number) {
  const s = sim.s, t = sim.t;
  if (s.focus) {
    const a = ANCHOR[s.focus];
    const g = ctx.createRadialGradient(a.at[0], a.at[1], a.r * 0.7, a.at[0], a.at[1], a.r * 2.6);
    g.addColorStop(0, "rgba(5,8,12,0)"); g.addColorStop(1, "rgba(5,8,12,0.42)");
    ctx.fillStyle = g; ctx.fillRect(-view.tx / view.s, -view.ty / view.s, cw / view.s, ch / view.s);
  }
  for (const part of PARTS) {
    const st = s.parts[part].state, a = ANCHOR[part];
    const hot = st === "culprit" || s.focus === part;
    if (!hot) continue;
    const col = st === "culprit" ? C.bad : st === "fixed" ? C.ok : C.accent;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 4);
    ctx.setLineDash([6, 8]); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.ellipse(a.at[0], a.at[1], a.r * 0.92, a.r * 0.72, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
}

function pill(ctx: Ctx, x: number, y: number, text: string, ui: number, col: string, glyph: string, strong: boolean, mono = false) {
  ctx.font = `${strong ? 700 : 600} ${11.5 * ui}px ${mono ? MONO : FONT}`;
  const pad = 8 * ui, gw = glyph ? 17 * ui : 0, tw = text ? ctx.measureText(text).width : 0, w = tw + gw + pad * (text ? 2 : 0.6) - (glyph && text ? 3 * ui : 0), h = 21 * ui;
  const x0 = x - w / 2, y0 = y - h / 2;
  ctx.fillStyle = "rgba(9,13,19,0.86)"; rr(ctx, x0, y0, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = strong ? col : "rgba(255,255,255,0.16)"; ctx.lineWidth = strong ? 1.6 * ui : 1; rr(ctx, x0, y0, w, h, h / 2); ctx.stroke();
  ctx.textBaseline = "middle";
  if (glyph) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x0 + h / 2, y, 7 * ui, 0, 7); ctx.fill();
    ctx.fillStyle = "#06090d"; ctx.font = `800 ${10.5 * ui}px ${FONT}`; ctx.textAlign = "center"; ctx.fillText(glyph, x0 + h / 2, y + 0.5 * ui);
    ctx.font = `${strong ? 700 : 600} ${11.5 * ui}px ${mono ? MONO : FONT}`;
  }
  if (text) { ctx.fillStyle = strong ? "#ffffff" : C.ink; ctx.textAlign = "left"; ctx.fillText(text, x0 + (glyph ? gw + pad * 0.55 : pad), y + 0.5 * ui); }
}

export const PART_LABEL: Record<Part, string> = { cams: "Cameras", cables: "Cables", switch: "Network switch", pc: "Inspection PC", plc: "Line controller", dashboard: "Plant dashboard" };

function labels(ctx: Ctx, sim: LineSim, ui: number, compact: boolean) {
  const s = sim.s;
  for (const part of PARTS) {
    const st = s.parts[part], a = ANCHOR[part];
    const strong = st.state === "culprit" || st.state === "fixed" || s.focus === part;
    if (part === "cables" && st.state === "idle") continue;
    const text = compact && !strong ? "" : PART_LABEL[part];
    pill(ctx, a.label[0], a.label[1], text, ui, STATE_COL[st.state], STATE_GLYPH[st.state], strong);
  }
  if (!compact) {
    for (const id of CAM_IDS) {
      const tag = s.camTag[id];
      if (!tag) continue;
      const [x, y, z] = CAMS[id].pos;
      const [px, py] = id === "cam1" ? P(x - 62, y, z + 2) : id === "cam2" ? P(x - 66, y, z + 2) : P(x + (id === "cam3" ? -44 : 44), y, z + 30);
      pill(ctx, px, py, tag, ui * 0.84, C.dim, "", false, true);
    }
    if (s.pcTag) { const [x, y] = P(PC.x - 40, WALL_Y - WALL_D, 62); pill(ctx, x, y, s.pcTag, ui * 0.84, C.dim, "", false, true); }
    ctx.font = `600 ${10 * ui}px ${FONT}`; ctx.fillStyle = "rgba(233,238,244,0.5)"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    const g = P(X_GATE + 6, BELT.y0, BELT.z - 26); ctx.fillText("REJECT GATE", g[0], g[1] + 2 * ui);
    const m = P((LANE.x0 + LANE.x1) / 2 + 30, LANE.y0, 0); ctx.fillText("MANUAL INSPECTION", m[0], m[1] + 6 * ui);
  }
}

function banner(ctx: Ctx, sim: LineSim, ui: number) {
  const s = sim.s;
  let txt = "", col = C.ink;
  if (s.lockout) {
    if (sim.phase === "idle") { txt = `Line idle · time-lapse ${Math.round(4 + (sim.phaseT / 4.2) * 57)} min`; col = C.dim; }
    else if (sim.phase === "denied") { txt = sim.locked ? "All four cameras refuse the PC" : "Idle for about an hour…"; col = C.bad; }
    else if (sim.phase === "stopped") { txt = "Line stopped · operator on the way"; col = C.bad; }
    else if (sim.phase === "restart") { txt = "App restarted · cameras come back"; col = C.ok; }
  }
  if (!txt) return;
  const [x, y] = P(560, CY, 112);
  ctx.font = `700 ${12.5 * ui}px ${FONT}`; const w = ctx.measureText(txt).width + 22 * ui, h = 26 * ui;
  ctx.fillStyle = "rgba(9,13,19,0.9)"; rr(ctx, x - w / 2, y - h / 2, w, h, 6 * ui); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.4 * ui; rr(ctx, x - w / 2, y - h / 2, w, h, 6 * ui); ctx.stroke();
  ctx.fillStyle = col === C.dim ? C.ink : col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, x, y + 0.5 * ui);
}
