import { useState } from "react";
import type { Snapshot } from "../types";
import { EvRefs, HypChip, HSTATUS, StatusChip, SYMPTOM } from "./common";

const ORDER: Record<string, number> = { confirmed: 0, supported: 1, refuted_by_verification: 2, untested: 3, contradicted: 4 };

export function Hypotheses({ snap }: { snap: Snapshot }) {
  const [all, setAll] = useState(false);
  const ruledOut = snap.hypotheses.filter((h) => h.status === "contradicted");
  const hs = snap.hypotheses
    .filter((h) => all || (h.status !== "contradicted" && (h.active || h.status !== "untested")))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.severity - a.severity);
  return (
    <section className="panel" aria-labelledby="hyp-h">
      <h2 id="hyp-h">Candidate explanations <span className="sub">statuses, not invented probabilities</span></h2>
      {hs.map((h) => (
        <div className="hyp" key={h.rule_id} data-testid={`hyp-${h.rule_id}`}>
          <div className="ht">
            <span><b className="mono small">{h.rule_id}</b> {h.title}</span>
            <HypChip status={h.status} />
          </div>
          <div className="tiny muted">{h.family.replaceAll("_", " ")} · severity {h.severity} · {h.playbook ? `playbook ${h.playbook}` : h.disposition_hint.replaceAll("_", " ")}{h.sources.length ? ` · sources ${h.sources.join(", ")}` : ""}</div>
          <div className="row small" style={{ marginTop: 4, gap: 14 }}>
            {h.supporting.length > 0 && <span>Supports: <EvRefs ids={h.supporting} /></span>}
            {h.contradicting.length > 0 && <span>Contradicts: <EvRefs ids={h.contradicting} /></span>}
            {h.corroborating.length > 0 && <span>Corroborates: <EvRefs ids={h.corroborating} /></span>}
            {h.missing.length > 0 && <span className="muted">Needs: {h.missing.join(", ")}</span>}
          </div>
          <details style={{ marginTop: 4 }}>
            <summary className="tiny">rule conditions</summary>
            <ul>{h.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        </div>
      ))}
      {hs.length === 0 && <p className="small muted">No rule is supported or pending yet.</p>}
      {!all && ruledOut.length > 0 && (
        <p className="small" style={{ marginBottom: 0 }}><span className="chip fail">✕ Ruled out</span>{" "}
          {ruledOut.map((h) => <span key={h.rule_id} className="mono tiny" title={h.title} style={{ marginRight: 6 }}>{h.rule_id}</span>)}</p>
      )}
      <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
        {all ? "Show only live explanations" : `Show all ${snap.hypotheses.length} rules (ruled out and dormant too)`}
      </button>
    </section>
  );
}

export function NextCheck({ snap }: { snap: Snapshot }) {
  const d = snap.diagnostics.find((x) => x.id === snap.next_check);
  return (
    <section className="panel" aria-labelledby="next-h" data-testid="next-check">
      <h2 id="next-h">Prioritised next check</h2>
      {d ? (
        <>
          <div><b className="mono">{d.id}</b> {d.title}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Score {d.score} = discrimination {Number(d.score_detail.severity_weight ?? 0) + 3 * Number(d.score_detail.open_symptoms ?? 0) + (d.score_detail.handoff ? 2 : 0)} (severity {d.score_detail.severity_weight ?? 0} + 3×{d.score_detail.open_symptoms ?? 0} open symptoms{d.score_detail.handoff ? " + 2 handoff" : ""}) ÷ cost {d.score_detail.cost}
            {" "}(1 + effort {d.effort} + 2×disruption {d.disruption}). {d.reason}.
          </div>
          {d.for_hypotheses.length > 0 && <div className="tiny" style={{ marginTop: 4 }}>Tests: {d.for_hypotheses.join(", ")}</div>}
          <div className="tiny muted" style={{ marginTop: 4 }}>{d.requires_technician ? "Needs the technician." : "Automated, read-only, simulated."}</div>
        </>
      ) : snap.pending_question ? (
        <div className="small">Waiting for the technician's observation.</div>
      ) : snap.intervention_options.length ? (
        <div className="small">Investigation complete for now: choose a simulated intervention.</div>
      ) : (
        <div className="small muted">No further check: {snap.finished ? "case dispositioned." : "—"}</div>
      )}
      <div className="tiny muted" style={{ marginTop: 8 }}>
        Budget: automated {snap.budget.automated_used}/{snap.budget.max_automated_checks} · technician {snap.budget.technician_used}/{snap.budget.max_technician_questions} · interventions {snap.budget.interventions_used}/{snap.budget.max_interventions}
      </div>
    </section>
  );
}

export function WhatChanged({ snap, prev }: { snap: Snapshot; prev?: Snapshot }) {
  if (!prev) return (
    <section className="panel small"><h2>What the last step changed</h2><span className="muted">Intake only. Run a check to see how one observation moves the investigation.</span></section>
  );
  const newEv = snap.evidence.filter((e) => !prev.evidence.some((p) => p.id === e.id));
  const changes = snap.hypotheses
    .map((h) => ({ h, before: prev.hypotheses.find((p) => p.rule_id === h.rule_id)?.status }))
    .filter((x) => x.before && x.before !== x.h.status);
  const actv = snap.hypotheses.filter((h) => h.active && !prev.hypotheses.find((p) => p.rule_id === h.rule_id)?.active);
  return (
    <section className="panel" aria-labelledby="chg-h" data-testid="what-changed">
      <h2 id="chg-h">What the last step changed <span className="sub">{snap.step_label}</span></h2>
      <div className="stack small">
        {newEv.map((e) => <div key={e.id} className="change fadein"><EvRefs ids={[e.id]} /> <span className="mono tiny">{e.key}</span> — {e.summary}</div>)}
        {changes.map(({ h, before }) => (
          <div key={h.rule_id}><b className="mono">{h.rule_id}</b>: {HSTATUS[before!]?.word ?? before} → <HypChip status={h.status} /></div>
        ))}
        {actv.length > 0 && <div className="muted">Newly relevant: {actv.map((h) => h.rule_id).join(", ")}</div>}
        <div>Next check: <span className="mono">{prev.next_check ?? "—"}</span> → <span className="mono">{snap.next_check ?? (snap.finished ? "none (dispositioned)" : snap.intervention_options.length ? "intervention" : "—")}</span></div>
      </div>
    </section>
  );
}

export function Symptoms({ snap }: { snap: Snapshot }) {
  const map: Record<string, string> = { observed: "fail", explained: "degraded", cleared: "ok", reported: "unknown" };
  const word: Record<string, string> = { observed: "Observed, unexplained", explained: "Observed, explained", cleared: "Checked: healthy", reported: "Reported only" };
  return (
    <section className="panel" aria-labelledby="sym-h">
      <h2 id="sym-h">Symptoms <span className="sub">reported vs observed</span></h2>
      <table><tbody>
        {snap.symptoms.map((s) => (
          <tr key={s.tag}><td>{SYMPTOM[s.tag] ?? s.tag}</td><td><StatusChip s={map[s.state]} text={word[s.state]} /></td>
            <td className="small">{s.why} {s.explained_by.length ? <span className="muted">by {s.explained_by.join(", ")}</span> : null} <EvRefs ids={s.evidence} /></td></tr>
        ))}
      </tbody></table>
    </section>
  );
}

export function Assertions({ snap }: { snap: Snapshot }) {
  if (!snap.assertions.length) return null;
  const cls: Record<string, string> = { consistent: "ok", contradicted: "fail", unverified: "unknown" };
  return (
    <section className="panel" aria-labelledby="as-h">
      <h2 id="as-h">Customer assertions <span className="sub">kept separate from observations</span></h2>
      {snap.assertions.map((a) => (
        <div key={a.evidence_id} className="small" style={{ marginBottom: 6 }}>
          <StatusChip s={cls[a.status]} text={a.status} /> “{a.claim.replaceAll("_", " ")}”{a.device ? ` (${a.device})` : ""} <EvRefs ids={[a.evidence_id]} />
          {a.note && <div className="muted">{a.note} <EvRefs ids={a.evidence} /></div>}
        </div>
      ))}
    </section>
  );
}

/** Compact decision graph: diagnostics (left) linked to the hypotheses they test (right). */
export function DecisionGraph({ snap }: { snap: Snapshot }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const hyps = snap.hypotheses.filter((h) => h.active || h.status !== "untested");
  const hypIds = new Set(hyps.map((h) => h.rule_id));
  const evalOrder = snap.trace.filter((t) => t.action === "ran diagnostic" || t.action.startsWith("requested observation")).map((t) => t.inputs.diagnostic);
  const diags = snap.diagnostics
    .filter((d) => showSkipped || d.state !== "skipped")
    .sort((a, b) => {
      const ia = evalOrder.indexOf(a.id), ib = evalOrder.indexOf(b.id);
      const sa = { evaluated: 0, candidate: 1, blocked: 2, skipped: 3 }[a.state] ?? 4;
      const sb = { evaluated: 0, candidate: 1, blocked: 2, skipped: 3 }[b.state] ?? 4;
      return sa - sb || (ia - ib) || ((b.score ?? 0) - (a.score ?? 0));
    });
  const ev = new Map(snap.evidence.map((e) => [e.id, e]));
  const links: [string, string][] = [];
  for (const d of diags) {
    const tested = d.state === "evaluated"
      ? hyps.filter((h) => d.evidence_ids.some((e) => h.supporting.includes(e) || h.contradicting.includes(e) || h.corroborating.includes(e))).map((h) => h.rule_id)
      : d.for_hypotheses.filter((h) => hypIds.has(h));
    for (const h of tested) links.push([d.id, h]);
  }
  const RH = 30, W = 760, LX = 8, LW = 270, RX = 368, RW = 384;
  const H = Math.max(diags.length, hyps.length) * RH + 24;
  const dy = (i: number) => 20 + i * RH;
  const col: Record<string, string> = { evaluated: "var(--ink)", candidate: "var(--info)", blocked: "var(--warn)", skipped: "var(--unk)" };
  const hcol: Record<string, string> = { supported: "var(--ok)", confirmed: "var(--ok)", contradicted: "var(--fail)", refuted_by_verification: "var(--fail)", untested: "var(--unk)" };
  return (
    <section className="panel graph" aria-labelledby="dg-h">
      <h2 id="dg-h">Diagnostic graph <span className="sub">evaluated · candidate · blocked · skipped, with reasons</span></h2>
      <div className="graph-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }} role="img" aria-label="Diagnostics linked to the hypotheses they test">
          {links.map(([d, h], i) => {
            const y1 = dy(diags.findIndex((x) => x.id === d)), y2 = dy(hyps.findIndex((x) => x.rule_id === h));
            const st = diags.find((x) => x.id === d)!.state;
            return <path key={i} d={`M${LX + LW} ${y1} C ${LX + LW + 50} ${y1}, ${RX - 50} ${y2}, ${RX} ${y2}`} fill="none"
              stroke={st === "evaluated" ? "var(--ink-3)" : "var(--info)"} strokeDasharray={st === "evaluated" ? "" : "4 3"} strokeWidth={1.2} opacity={0.7} />;
          })}
          {diags.map((d, i) => {
            const n = evalOrder.indexOf(d.id);
            const e = d.evidence_ids[0] ? ev.get(d.evidence_ids[0]) : undefined;
            return (
              <g key={d.id} transform={`translate(${LX},${dy(i) - 11})`}>
                <title>{`${d.title} — ${d.state}${d.reason ? ": " + d.reason : ""}`}</title>
                <rect width={LW} height={22} rx={4} fill="var(--panel-2)" stroke={col[d.state]} strokeWidth={d.state === "candidate" && d.id === snap.next_check ? 2.5 : 1}
                  strokeDasharray={d.state === "skipped" ? "3 3" : ""} />
                <text x={6} y={15} fontSize={11} fontWeight={700}>{n >= 0 ? `${n + 1}. ` : ""}{d.id}</text>
                <text x={104} y={15} fontSize={10} className="gmeta">
                  {d.state === "evaluated" ? (e ? `${e.id} · ${e.status}` : "evaluated") : d.state === "candidate" ? `candidate · score ${d.score}` : `${d.state}: ${d.reason}`.slice(0, 30)}
                </text>
              </g>
            );
          })}
          {hyps.map((h, i) => (
            <g key={h.rule_id} transform={`translate(${RX},${dy(i) - 11})`}>
              <title>{h.title}</title>
              <rect width={RW} height={22} rx={4} fill="var(--panel-2)" stroke={hcol[h.status]} strokeWidth={1.5} />
              <text x={6} y={15} fontSize={11} fontWeight={700} fill={hcol[h.status]}>{HSTATUS[h.status]?.icon}</text>
              <text x={26} y={15} fontSize={11} fontWeight={700}>{h.rule_id}</text>
              <text x={206} y={15} fontSize={10} className="gmeta">{HSTATUS[h.status]?.word}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="row small" style={{ marginTop: 6 }}>
        <span className="muted">Solid link: evaluated evidence bears on the rule. Dashed: candidate check would test it.</span>
        <button className="btn ghost small" onClick={() => setShowSkipped(!showSkipped)}>{showSkipped ? "Hide skipped" : "Show skipped checks"}</button>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary>Blocked and skipped checks with reasons</summary>
        <table><tbody>
          {snap.diagnostics.filter((d) => d.state === "blocked" || d.state === "skipped").map((d) => (
            <tr key={d.id}><td className="mono">{d.id}</td><td><StatusChip s={d.state === "blocked" ? "degraded" : "unknown"} text={d.state} /></td><td className="small">{d.reason}</td></tr>
          ))}
        </tbody></table>
      </details>
    </section>
  );
}
