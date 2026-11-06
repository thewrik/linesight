import type { Evidence, Option, Snapshot } from "../types";
import { EvRefs, StatusChip, RES } from "./common";

function Bar({ label, before, after, max, target, unit = "%", goodHigh = true }: { label: string; before?: number; after?: number; max: number; target?: number; unit?: string; goodHigh?: boolean }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const ok = (v: number) => (target === undefined ? true : goodHigh ? v >= target : v <= target);
  return (
    <div className="stack" style={{ marginTop: 6 }}>
      <div className="small"><b>{label}</b>{target !== undefined && <span className="muted"> · requirement {goodHigh ? "≥" : "≤"} {target}{unit}</span>}</div>
      {before !== undefined && (
        <div className="bar"><span className="muted">before</span><span className="track"><span className={`fill ${ok(before) ? "" : "bad"}`} style={{ width: pct(before) }} />{target !== undefined && <span className="mark" style={{ left: pct(target) }} />}</span><span className="mono">{before}{unit}</span></div>
      )}
      {after !== undefined && (
        <div className="bar"><span className="muted">after</span><span className="track"><span className={`fill ${ok(after) ? "after" : "bad"}`} style={{ width: pct(after) }} />{target !== undefined && <span className="mark" style={{ left: pct(target) }} />}</span><span className="mono">{after}{unit}</span></div>
      )}
    </div>
  );
}

const worst = (e?: Evidence) => e ? Math.max(0, ...Object.values<any>(e.data.per_camera ?? {}).map((p) => p.latency_ms_p95 ?? 0)) : undefined;

export default function Interventions({ snap, onApply, busy, recorded }: { snap: Snapshot; onApply: (id: string) => void; busy: boolean; recorded?: string }) {
  const history: any[] = snap.metrics?.options_considered ?? [];
  const live = snap.intervention_options;
  const opts: Option[] = live.length ? live : (history[history.length - 1]?.options ?? []);
  const chosen = live.length ? undefined : history[history.length - 1]?.chosen;
  const req = snap.station.requirements;
  const before = [...snap.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "observed");
  const after = [...snap.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "verification");
  const isTransport = opts.some((o) => o.playbook === "PB-PACING") || snap.interventions.some((i) => i.playbook === "PB-PACING");
  return (
    <section className="panel" aria-labelledby="iv-h" data-testid="interventions">
      <h2 id="iv-h">Simulated intervention & verification <span className="sub">nothing is written to real equipment</span></h2>
      {opts.length > 0 && (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            {chosen ? "Options that were considered from" : "Options from"} playbook <b className="mono">{opts[0].playbook}</b>. Predictions come from running the simulator on a copy of the station
            — a model prediction, not a measurement. Options that miss the customer's requirement are mitigations, not resolutions.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Option</th><th>Predicted</th><th>Meets requirement?</th><th></th></tr></thead>
              <tbody>
                {opts.map((o: any) => (
                  <tr key={o.id} className={o.recommended ? "rec" : ""}>
                    <td><b className="mono small">{o.id}</b>{o.recommended && <span className="chip ok" style={{ marginLeft: 6 }}>recommended</span>}{chosen === o.id && <span className="chip info" style={{ marginLeft: 6 }}>applied</span>}<div className="small">{o.title}</div><div className="tiny muted">{o.tradeoff}</div></td>
                    <td className="small mono">
                      {o.predicted.usable_frame_pct !== undefined ? <>
                        {o.predicted.usable_frame_pct}% usable<br />{o.predicted.line_rate_cps} cartons/s<br />p95 {o.predicted.worst_latency_p95_ms} / {o.predicted.deadline_ms} ms<br />{o.predicted.per_camera_rate_mbps} Mb/s per camera
                      </> : <span className="muted">{o.predicted.basis ?? "—"}</span>}
                    </td>
                    <td>{o.meets_requirements ? <StatusChip s="ok" text="yes" /> : <StatusChip s="fail" text="no — mitigation" />}</td>
                    <td>{!chosen && <button className="btn small" onClick={() => onApply(o.id)} disabled={busy || (recorded !== undefined && recorded !== o.id)}
                      data-testid={`apply-${o.id}`} title={recorded !== undefined && recorded !== o.id ? "Static replay recorded only the recommended option" : "Approve and apply in the simulator"}>Apply (simulated)</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {snap.interventions.map((iv) => {
        const v = snap.verifications.find((x) => x.intervention_id === iv.id);
        return (
          <div key={iv.id} className="stack" style={{ marginTop: 10 }}>
            <div className="row"><b className="mono">{iv.id}</b> {iv.title} <span className="chip plain">simulated</span></div>
            {v && (
              <div data-testid="verification">
                <div className="row"><StatusChip s={v.passed ? "ok" : "fail"} text={v.passed ? "Verification passed" : "Verification failed"} /> <span className="small">outcome: {RES[v.outcome] ?? v.outcome}</span></div>
                <ul className="small" style={{ paddingLeft: 18 }}>
                  {v.checks.map((c) => <li key={c.check}>{c.passed ? "✓" : "✕"} <b>{c.check}</b>: {c.detail} <EvRefs ids={[c.evidence]} /></li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {isTransport && (before || after) && (
        <div style={{ marginTop: 10 }}>
          <h3>Before / after telemetry</h3>
          <Bar label="Usable frames at production" before={before?.data.usable_frame_pct} after={after?.data.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
          <Bar label="Worst-camera p95 result latency" before={worst(before)} after={worst(after)} max={120} target={req.result_deadline_ms} unit=" ms" goodHigh={false} />
          <Bar label="Line rate" before={before?.data.line_rate_cps} after={after?.data.line_rate_cps} max={12} target={req.line_rate_cps} unit=" c/s" />
          {before?.data.budget && (
            <details style={{ marginTop: 8 }}>
              <summary>Traffic arithmetic and model assumptions</summary>
              <dl className="kv" style={{ marginTop: 6 }}>
                {Object.entries(before.data.budget).flatMap(([k, v]) => [<dt key={k}>{k.replaceAll("_", " ")}</dt>, <dd key={`${k}-v`} className="mono">{String(v)}</dd>])}
              </dl>
              <p className="small">Average uplink use is well under 1 Gb/s; the problem is the burst: four cameras starting together arrive faster than the uplink drains.</p>
              <ul className="tiny">{snap.simulation.transport_assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
