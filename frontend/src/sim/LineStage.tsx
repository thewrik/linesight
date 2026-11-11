import { useEffect, useRef, type ReactNode } from "react";
import { LineSim, type Scene } from "./engine";
import { FULL, draw, fitView, type View } from "./render";
import type { Hud } from "./scene";
import { ANCHOR, H, W } from "./world";
import "./stage.css";

const COMPACT_BELOW = 620;

function targetView(cw: number, ch: number, scene: Scene, hero: boolean): View {
  if (hero && cw >= 900) {
    // fill the height and sit to the right, leaving room for the headline
    const s = Math.min(ch / (H - 30), (cw * 0.7) / W);
    return { s, tx: cw - W * s - 24 - Math.max(0, (cw - 1500) / 2), ty: (ch - H * s) / 2 + 14 };
  }
  if (cw >= COMPACT_BELOW) return fitView(cw, ch, FULL);
  // small screens: move the camera to where the action is
  const rw = scene.focus ? 560 : 720, rh = (rw * ch) / cw;
  const [ax, ay] = scene.focus ? ANCHOR[scene.focus].at : [540, 280];
  const cx = Math.max(rw / 2 - 40, Math.min(W + 40 - rw / 2, ax)), cy = Math.max(rh / 2, Math.min(H - rh / 2 + 20, ay + 30));
  return fitView(cw, ch, [cx - rw / 2, cy - rh / 2, rw, rh]);
}

export default function LineStage({ scene, hud, children, className = "", hero = false }: { scene: Scene; hud?: Hud; children?: ReactNode; className?: string; hero?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<LineSim>();
  const latest = useRef(scene);
  latest.current = scene;

  useEffect(() => {
    const cv = canvas.current!, el = wrap.current!, ctx = cv.getContext("2d")!;
    const s = (sim.current ??= new LineSim(latest.current));
    s.prime();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cw = 0, ch = 0, view: View | null = null, raf = 0, last = 0, visible = true, seen: Scene | null = null;

    const size = () => {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(1, r.width); ch = Math.max(1, r.height);
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view = null;
    };
    const paint = () => {
      const tv = targetView(cw, ch, latest.current, hero);
      view = view ? { s: view.s + (tv.s - view.s) * 0.07, tx: view.tx + (tv.tx - view.tx) * 0.07, ty: view.ty + (tv.ty - view.ty) * 0.07 } : tv;
      if (reduce) view = tv;
      draw(ctx, s, view, cw, ch, { compact: cw < COMPACT_BELOW, t: s.t });
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (seen !== latest.current) { seen = latest.current; s.setScene(seen); if (reduce) { for (let i = 0; i < 300; i++) s.update(1 / 30); paint(); } }
      if (reduce || !visible || document.hidden) { last = now; return; }
      s.update(Math.min(0.05, (now - last) / 1000 || 0.016));
      last = now;
      paint();
    };
    const ro = new ResizeObserver(() => { size(); paint(); });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);
    size();
    document.fonts?.ready.then(paint);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [hero]);

  const speedPct = hud ? Math.min(100, (hud.rate / hud.requiredRate) * 100) : 0;
  return (
    <div className={`stage ${className}`} data-testid="stage" data-mode={scene.mode} data-late={scene.lateShare.toFixed(2)} data-rate={scene.rate}>
      <div ref={wrap} className="stage-view" role="img" aria-label={hud ? `Animated packaging line. ${hud.caption}` : "Animated packaging line"}>
      <canvas ref={canvas} />
      {hud && <div className="hud hud-tl"><span className="live"><i />SIMULATION · SLOW MOTION</span></div>}
      {children}
      </div>
      {hud && (
        <div className={`stage-bar tone-${hud.tone}`}>
          <p className="stage-cap" data-testid="caption" aria-live="polite"><i />{hud.caption}</p>
          <div className="gauges">
            <div className="gauge">
              <span className="g-k">Line speed</span>
              <span className="g-v"><b>{hud.rate}</b><small>of {hud.requiredRate} cartons/s</small></span>
              <span className="g-bar"><i className={hud.rate < hud.requiredRate ? "warn" : ""} style={{ width: `${speedPct}%` }} /></span>
            </div>
            <div className="gauge">
              <span className="g-k">Answers on time</span>
              <span className="g-v">{hud.usable === null ? <em>not measured yet</em> : <><b className={hud.usable < 99.5 ? "bad" : "ok"}>{Math.round(hud.usable * 10) / 10}%</b><small>need 99.5%</small></>}</span>
              <span className="g-bar"><i className={hud.usable !== null && hud.usable < 99.5 ? "bad" : "ok"} style={{ width: `${hud.usable ?? 0}%` }} /></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
