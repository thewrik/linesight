// Layout of the simulated packaging line, in design units. One oblique projection for everything.
export const W = 960, H = 520;
const OX = 60, OY = 420, KX = 0.22, KY = 0.5;

export type V3 = [number, number, number];
export type V2 = [number, number];
/** x runs along the conveyor, y is depth away from the viewer, z is height. */
export const P = (x: number, y: number, z = 0): V2 => [OX + x + y * KX, OY - z - y * KY];

export type CamId = "cam1" | "cam2" | "cam3" | "cam4";
export const CAM_IDS: CamId[] = ["cam1", "cam2", "cam3", "cam4"];
export type Part = "cams" | "cables" | "switch" | "pc" | "plc" | "dashboard";
export const PARTS: Part[] = ["cams", "cables", "switch", "pc", "plc", "dashboard"];

export const BELT = { x0: -30, x1: 720, y0: 108, y1: 162, z: 44 };
export const CARTON = { w: 54, d: 40, h: 36 };
export const CY = 135; // carton centre depth on the main belt
export const X_SPAWN = -60;
export const X_TRIG = 240;
/** Distance from the cameras to the reject gate. A result must arrive before the carton covers it. */
export const GATE_D = 165;
export const X_GATE = X_TRIG + GATE_D;
export const X_END = 690;
export const SPACING = 220;
/** Belt speed (design units per second) at the required line rate. Roughly 13x slow motion. */
export const V_REQ = 170;
/** Time a carton takes from cameras to gate at the required rate: the result deadline, on screen. */
export const T_DEADLINE = GATE_D / V_REQ;

export const WALL_Y = 300;
export const WALL_D = 26;
export const SWITCH = { x: 270, w: 124, z: 96, h: 44 };
export const PC = { x: 470, w: 84, h: 150 };
export const PLC = { x: 600, w: 62, h: 122 };
export const DASH = { x: 706, w: 104, z: 118, h: 66 };
export const GANTRY = { x0: 190, x1: 290, y0: 98, y1: 172, h: 166 };
export const CHUTE = { x0: 420, x1: 480, y0: -34, y1: 108 };
export const LANE = { x0: 420, x1: 664, y0: -88, y1: -34, z: 44 };
export const LANE_Y = -61;
export const LANE_SLOTS = 3;
export const PALLET = { x: 336, y: -92, w: 66, d: 54 };
export const BENCH = { x0: 664, x1: 740, y0: -92, y1: -30, z: 44 };

export const CAMS: Record<CamId, { pos: V3; n: number }> = {
  cam1: { pos: [240, 56, 70], n: 1 },
  cam2: { pos: [240, 214, 70], n: 2 },
  cam3: { pos: [216, 135, 150], n: 3 },
  cam4: { pos: [264, 135, 150], n: 4 },
};

const wy = WALL_Y - WALL_D; // front face of wall-mounted equipment
const swTop = SWITCH.z + SWITCH.h;
/** Cable runs as 3D polylines. Camera cables end at the switch. */
export const PATHS: Record<string, V3[]> = {
  cam1: [[240, 56, 62], [240, 56, 0], [150, 56, 0], [150, wy, 0], [150, wy, 118], [SWITCH.x, wy, 118]],
  cam2: [[240, 214, 62], [240, wy, 62], [240, wy, 80], [SWITCH.x + 16, wy, 80], [SWITCH.x + 16, wy, SWITCH.z]],
  cam3: [[216, 135, 162], [216, wy, 162], [216, wy, 176], [SWITCH.x + 40, wy, 176], [SWITCH.x + 40, wy, swTop]],
  cam4: [[264, 135, 162], [264, wy, 162], [SWITCH.x + 74, wy, 162], [SWITCH.x + 74, wy, swTop]],
  uplink: [[SWITCH.x + SWITCH.w, wy, 118], [PC.x, wy, 118]],
  result: [[PC.x + PC.w, wy, 96], [PLC.x, wy, 96]],
  gate: [[PLC.x + 44, wy, 0], [PLC.x + 44, 200, 0], [X_GATE + 8, 200, 0], [X_GATE + 8, 166, 0], [X_GATE + 8, 166, 40]],
  trig: [[PLC.x + 18, wy, 0], [PLC.x + 18, 236, 0], [X_TRIG, 236, 0], [X_TRIG, 172, 0], [X_TRIG, 172, 52]],
  mgmt: [[PC.x + 42, wy, PC.h], [PC.x + 42, wy, 200], [DASH.x + 52, wy, 200], [DASH.x + 52, wy, DASH.z + DASH.h]],
};

export interface Path2 { pts: V2[]; len: number[]; total: number }
const cache = new Map<string, Path2>();
export function path2(id: string): Path2 {
  let p = cache.get(id);
  if (!p) {
    const pts = PATHS[id].map(([x, y, z]) => P(x, y, z));
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    p = { pts, len, total: len[len.length - 1] };
    cache.set(id, p);
  }
  return p;
}
export function along(id: string, f: number): V2 {
  const p = path2(id);
  const d = Math.max(0, Math.min(1, f)) * p.total;
  for (let i = 1; i < p.pts.length; i++) {
    if (d <= p.len[i]) {
      const u = (d - p.len[i - 1]) / (p.len[i] - p.len[i - 1] || 1);
      return [p.pts[i - 1][0] + (p.pts[i][0] - p.pts[i - 1][0]) * u, p.pts[i - 1][1] + (p.pts[i][1] - p.pts[i - 1][1]) * u];
    }
  }
  return p.pts[p.pts.length - 1];
}

/** Where each part sits on screen: used for spotlights, labels and the small-screen camera. */
export const ANCHOR: Record<Part, { at: V2; r: number; label: V2 }> = {
  cams: { at: P(X_TRIG, 135, 90), r: 120, label: P(X_TRIG, 172, GANTRY.h + 34) },
  cables: { at: P(170, 180, 60), r: 90, label: P(150, 150, 0) },
  switch: { at: P(SWITCH.x + SWITCH.w / 2, wy, SWITCH.z + 22), r: 96, label: P(SWITCH.x + SWITCH.w / 2 + 20, WALL_Y, swTop + 62) },
  pc: { at: P(PC.x + PC.w / 2, wy, 80), r: 104, label: P(PC.x + PC.w / 2, WALL_Y, PC.h + 22) },
  plc: { at: P(PLC.x + PLC.w / 2, wy, 66), r: 96, label: P(PLC.x + PLC.w / 2, WALL_Y, PLC.h + 58) },
  dashboard: { at: P(DASH.x + DASH.w / 2, wy, DASH.z + 33), r: 92, label: P(DASH.x + DASH.w / 2, WALL_Y, DASH.z + DASH.h + 22) },
};
