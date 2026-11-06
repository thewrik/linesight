import { useEffect, useState } from "react";
import { dataUrl, fetchJson } from "../data";

const COLS: [string, string][] = [
  ["correct_disposition", "Correct disposition"], ["correct_resolution", "Correct resolution"], ["cause_named", "Cause named"],
  ["missed_escalation", "Missed escalation ↓"], ["inappropriate_escalation", "Inappropriate escalation ↓"],
  ["unsupported_confident_diagnosis", "Unsupported confident diagnosis ↓"], ["verified_recovery", "Verified recovery"],
  ["forbidden_actions", "Forbidden actions ↓"], ["mean_diagnostics", "Mean checks"], ["mean_technician_questions", "Mean tech. questions"],
  ["mean_effort_proxy", "Effort proxy"], ["median_latency_ms", "Median latency (ms)"], ["total_cost_usd", "Model cost (USD)"],
];
const MODE_LABEL: Record<string, string> = {
  checklist: "Static checklist (fixed order, generic fixes)", rules: "Rules engine (lexicon intake, no model)",
  replay: "Rules + replay (stored structured intake; see note)", live: "Rules + live model",
};

export default function EvalView() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetchJson(dataUrl("eval.json")).then(setD).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="panel">No evaluation results found. Run <code>python -m linesight.eval.run --out frontend/public/data/eval.json</code>. ({err})</div>;
  if (!d) return <div className="panel">Loading…</div>;
  return (
    <div className="stack">
      <div className="banner-sim">
        Synthetic benchmark: {Object.values<any>(d.modes)[0]?.rows.length} labelled cases written by the same author as the rules.
        It checks the engine's behaviour on its own casebook; it is <b>not</b> an estimate of field performance or support-time savings.
        Effort is a synthetic proxy. Generated {d.generated_at} · rules {d.rules_version} · commit {d.git_rev}.
      </div>
      {Object.entries<any>(d.skipped ?? {}).map(([k, v]) => <div key={k} className="panel small"><b>{MODE_LABEL[k] ?? k}:</b> not run — {v}</div>)}
      {Object.entries<any>(d.modes).map(([mode, m]) => (
        <section key={mode} className="panel" data-testid={`eval-${mode}`}>
          <h2>{MODE_LABEL[mode] ?? mode}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Split</th><th>Cases</th>{COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
              <tbody>
                {Object.entries<any>(m.summary).filter(([, a]) => a && a.cases).map(([split, a]) => (
                  <tr key={split}><td><b>{split}</b></td><td>{a.cases}</td>
                    {COLS.map(([k]) => <td key={k} className="mono small">{k === "verified_recovery" ? `${a[k]}/${a.recovery_expected}` : a[k]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <details style={{ marginTop: 8 }} open={mode !== "checklist"}>
            <summary>Failure examples ({m.failures.length})</summary>
            {m.failures.length === 0 && <p className="small muted">No failures on these metrics.</p>}
            <ul className="small">
              {m.failures.map((f: any) => (
                <li key={f.scenario}><b className="mono">{f.scenario}</b> ({f.split}) — {f.failed.join(", ")}. Expected {f.expected.disposition}/{f.expected.resolution} {JSON.stringify(f.expected.causes)};
                  got {f.got.disposition}/{f.got.resolution} {JSON.stringify(f.got.claimed_causes)}.{f.expected.note ? <span className="muted"> Note: {f.expected.note}.</span> : null}</li>
              ))}
            </ul>
          </details>
        </section>
      ))}
      <section className="panel small">
        <h2>How to read this</h2>
        <ul>
          <li><b>Splits.</b> <i>dev</i> cases were used while writing the rules. <i>heldout</i> cases use other station configurations, seeds and fault combinations. <i>paraphrase</i> re-words tickets for the same hidden faults, written after the lexicon parser was frozen.</li>
          <li><b>Why the rules engine scores well:</b> the casebook and rules share an author, and most discrimination comes from read-only checks rather than ticket wording. Treat it as a regression suite, not as evidence that this approach generalises.</li>
          <li><b>Does the model earn its place?</b> On these metrics, replay equals rules: the stored fixtures only cover the three demo tickets. Live-model runs need credentials and were not run for this build. The model's job here (intake, wording, drafts) is the part these synthetic metrics measure least.</li>
          <li><b>Checklist baseline</b> runs every read-only check in a fixed order, takes the first matching line and applies its generic fix (power-cycle, maximum inter-packet delay). It never escalates.</li>
        </ul>
      </section>
    </div>
  );
}
