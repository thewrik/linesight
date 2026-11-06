import { useEffect, useMemo, useRef, useState } from "react";
import { dataUrl, fetchJson } from "../data";
import type { Evidence, Option, Replay, Snapshot } from "../types";
import { buildGates, impact, type Gate } from "./model";
import { DISP_PLAIN, HYP_PLAIN } from "./plain";
import Tree from "./Tree";
import "./journey.css";

type Lens = "story" | "engineer" | "lead";
const LENSES: { id: Lens; label: string; who: string }[] = [
  { id: "story", label: "Story", who: "What happened, in plain words" },
  { id: "engineer", label: "Engineer", who: "Rules, evidence ids, raw data" },
  { id: "lead", label: "Lead", who: "Cost, risk and the calls made" },
];
const KIND_ICON: Record<string, string> = { call: "☎", check: "◎", ask: "✋", choose: "⑂", proof: "✓", verdict: "★" };
const HOLD_MS = 650;

function readLens(): Lens {
  try { return (localStorage.getItem("ls-lens") as Lens) || "story"; } catch { return "story"; }
}

export default function Journey({ scenarioId }: { scenarioId: string }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [triggers, setTriggers] = useState<Record<string, string[]>>({});
  const [opened, setOpened] = useState(1); // gates [0, opened) are open
  const [lens, setLensState] = useState<Lens>(readLens);
  const [err, setErr] = useState("");
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    fetchJson<Replay>(dataUrl(`replays/${scenarioId}.json`)).then(setReplay).catch((e) => setErr(String(e)));
    fetchJson<any>(dataUrl("rules.json")).then((r) => setTriggers(Object.fromEntries(r.hypotheses.map((h: any) => [h.id, h.triggers]))));
  }, [scenarioId]);
  const gates = useMemo(() => (replay ? buildGates(replay) : []), [replay]);
  const setLens = (l: Lens) => { setLensState(l); try { localStorage.setItem("ls-lens", l); } catch { /* storage unavailable */ } };

  const open = (i: number) => {
    if (i !== opened) return;
    setOpened(i + 1);
    setTimeout(() => refs.current[i + 1]?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 380);
  };

  if (err) return <div className="panel">Could not load this journey: <code>{err}</code></div>;
  if (!replay || !gates.length) return <div className="panel">Loading the line…</div>;

  const current = gates[Math.min(opened, gates.length) - 1];
  const snap = replay.frames[current.frame].snapshot;
  const meta = replay.scenario;
  const done = opened >= gates.length;

  return (
    <div className="journey" data-lens={lens}>
      <header className="j-head">
        <div>
          <div className="tiny mono muted">{snap.station.site} · {snap.station.line}</div>
          <h1>{meta.title}</h1>
        </div>
        <div className="lenses" role="radiogroup" aria-label="Choose a lens">
          {LENSES.map((l) => (
            <button key={l.id} role="radio" aria-checked={lens === l.id} className={`lens ${lens === l.id ? "on" : ""}`} onClick={() => setLens(l.id)} data-testid={`lens-${l.id}`}>
              <b>{l.label}</b><span>{l.who}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="j-mobilebar" aria-hidden>
        <span className="mono">gate {Math.min(opened, gates.length)} / {gates.length}</span>
        <span className="j-mb-lead">{(() => { const l = snap.hypotheses.find((h) => h.status === "supported" || h.status === "confirmed"); return l ? `→ ${HYP_PLAIN[l.rule_id] ?? l.rule_id}` : `${snap.hypotheses.filter((h) => h.status === "contradicted").length} ruled out`; })()}</span>
        <span className={`j-disp d-${snap.disposition}`}>{DISP_PLAIN[snap.disposition]?.word}</span>
      </div>
      <div className="j-grid">
        <aside className="j-map" aria-label="Decision tree">
          <div className="j-map-inner">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="j-step mono">gate {Math.min(opened, gates.length)} / {gates.length}</span>
              <span className={`j-disp d-${snap.disposition}`}>{DISP_PLAIN[snap.disposition]?.word}</span>
            </div>
            <Tree replay={replay} snap={snap} prunedNow={current.ruledOut} litNow={current.pointing} lens={lens} triggers={triggers} />
            <ol className="j-trailmini" aria-label="Trail">
              {gates.map((g, i) => (
                <li key={i} className={i < opened ? "passed" : i === opened ? "next" : ""}>
                  <button onClick={() => refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" })} disabled={i > opened}
                    aria-label={`${g.label}${i < opened ? " (open)" : " (locked)"}`}>{KIND_ICON[g.kind]}</button>
                </li>
              ))}
            </ol>
            <p className="tiny muted j-legend">
              <span className="lg lit" /> pointing here <span className="lg open" /> still possible <span className="lg closed" /> ruled out by evidence
            </p>
            {lens === "lead" && <LeadMeter snap={snap} />}
          </div>
        </aside>

        <ol className="trail">
          {gates.map((g, i) => {
            const state = i < opened ? "open" : i === opened ? "ready" : "locked";
            return (
              <li key={i} ref={(el) => { refs.current[i] = el; }} className={`gate ${state} k-${g.kind}`} data-testid={`gate-${i}`}>
                <div className="portal" aria-hidden><span>{state === "locked" ? "🔒" : KIND_ICON[g.kind]}</span></div>
                <div className="gate-card">
                  <div className="gate-top">
                    <span className="gate-label mono">{String(i + 1).padStart(2, "0")} · {g.label}</span>
                    {g.diagnostic && lens === "engineer" && <span className="chip plain mono">{g.diagnostic}</span>}
                  </div>
                  <h2 className="gate-q">{state === "locked" ? lockedTeaser(g) : g.question}</h2>
                  {state === "ready" && <HoldButton onOpen={() => open(i)} label={g.kind === "choose" ? "Hold to test the fixes" : g.kind === "verdict" ? "Hold to reach the verdict" : g.kind === "ask" ? "Hold to ask the technician" : "Hold to run this check"} />}
                  {state === "open" && <GateBody gate={g} lens={lens} replay={replay} scenarioId={scenarioId} />}
                  <div className="doors" aria-hidden><i /><i /></div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="j-foot">
        {done ? <span>Journey complete.</span> : <span className="muted">Hold each gate to pass it — or press <kbd>Enter</kbd> on the focused button.</span>}
        <span className="row">
          <button className="btn ghost" onClick={() => { setOpened(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Start over</button>
          <button className="btn ghost" onClick={() => setOpened(gates.length)} data-testid="open-all">Open every gate</button>
          <a className="btn" href={`#/case/${scenarioId}/${current.frame}`}>Open the engineering console at this point →</a>
        </span>
      </footer>
      <p className="tiny muted" style={{ marginTop: 10 }}>{snap.simulation.boundary} {replay.notice}</p>
    </div>
  );
}

function lockedTeaser(g: Gate) {
  return g.kind === "verdict" ? "The verdict waits at the end of the trail." : g.kind === "choose" ? "A fork in the road." : g.kind === "proof" ? "A final test." : `Gate: ${g.label}`;
}

function HoldButton({ onOpen, label }: { onOpen: () => void; label: string }) {
  const [p, setP] = useState(0);
  const raf = useRef<number>(0);
  const t0 = useRef(0);
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stop = () => { cancelAnimationFrame(raf.current); setP(0); };
  const start = () => {
    if (reduce) { onOpen(); return; }
    t0.current = performance.now();
    const tick = (t: number) => {
      const v = Math.min(1, (t - t0.current) / HOLD_MS);
      setP(v);
      if (v >= 1) { navigator.vibrate?.(12); onOpen(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const C = 2 * Math.PI * 16;
  return (
    <button className="hold" data-testid="hold" onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} onContextMenu={(e) => e.preventDefault()}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
        <circle cx="19" cy="19" r="16" className="ring-bg" />
        <circle cx="19" cy="19" r="16" className="ring" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - p) }} />
      </svg>
      <span>{label}</span>
    </button>
  );
}

const name = (id: string) => HYP_PLAIN[id] ?? id;

function GateBody({ gate: g, lens, replay, scenarioId }: { gate: Gate; lens: Lens; replay: Replay; scenarioId: string }) {
  const snap = replay.frames[g.frame].snapshot;
  return (
    <div className="gate-body">
      {g.kind === "call" && <CallBody snap={snap} lens={lens} />}
      {g.kind === "choose" && <ForkBody options={g.options!} chosen={g.chosen!} lens={lens} snap={snap} />}
      {g.kind === "proof" && <ProofBody snap={snap} lens={lens} before={replay.frames[Math.max(0, g.frame - 1)].snapshot} />}
      {g.kind === "verdict" && <VerdictBody snap={snap} gate={g} lens={lens} scenarioId={scenarioId} />}
      {(g.kind === "check" || g.kind === "ask") && <p className="answer">{g.story}</p>}
      {g.kind !== "verdict" && (g.ruledOut.length > 0 || g.pointing.length > 0) && (
        <div className="moves">
          {g.ruledOut.length > 0 && <div><span className="move-k closed">Ruled out</span>{g.ruledOut.map((h) => <span key={h} className="pill x">{lens === "engineer" ? h : name(h)}</span>)}</div>}
          {g.pointing.length > 0 && <div><span className="move-k lit">Now pointing to</span>{g.pointing.map((h) => <span key={h} className="pill lit">{lens === "engineer" ? `${h} · ${name(h)}` : name(h)}</span>)}</div>}
        </div>
      )}
      {lens === "lead" && g.cost && <p className="lead-note">⏱ {g.cost}</p>}
      {lens === "lead" && g.ledger.length > 0 && g.kind !== "verdict" && <LedgerList items={g.ledger} />}
      {lens === "engineer" && (g.kind === "check" || g.kind === "ask" || g.kind === "call") && <EngineerDetail g={g} snap={snap} />}
    </div>
  );
}

function CallBody({ snap, lens }: { snap: Snapshot; lens: Lens }) {
  return (
    <>
      <blockquote className="j-ticket">{snap.incident.ticket_text}</blockquote>
      {lens === "story" && <p className="answer">“Offline” could mean the camera can't be seen, can't be controlled, sends images too late, is never told to shoot, or that only the dashboard is stale. The tree on the left starts with every possibility open.</p>}
      {lens === "lead" && (
        <div className="lead-grid">
          <div><b>Business impact</b>{snap.incident.business_impact}</div>
          <div><b>Customer asks for</b>{snap.guard_events.filter((g) => g.type === "request_noted").map((g) => g.match).join("; ") || "a diagnosis"}</div>
          <div><b>Risk if we just comply</b>{snap.assertions.some((a) => a.claim === "replacement_needed") ? "Ship a camera, lose a day, and the line fails the same way." : "Repeat restarts that only buy time."}</div>
        </div>
      )}
      {snap.guard_events.some((g) => g.type !== "request_noted") && (
        <div className="guard small">Untrusted text flagged: {snap.guard_events.filter((g) => g.type !== "request_noted").map((g) => `“${g.match}”`).join(", ")} — treated as data only.</div>
      )}
    </>
  );
}

function EngineerDetail({ g, snap }: { g: Gate; snap: Snapshot }) {
  const d = snap.diagnostics.find((x) => x.id === g.diagnostic);
  return (
    <div className="eng">
      {g.why && <p className="small"><b>Why this check now:</b> {g.why}</p>}
      {d && <p className="small mono">tool {d.tool}({JSON.stringify(d.args)}) · effort {d.effort} · disruption {d.disruption}</p>}
      {g.evidence.map((e: Evidence) => (
        <details key={e.id} className="ev">
          <summary><span className="evref">{e.id}</span> <span className="mono tiny">{e.key}</span> · {e.kind.replaceAll("_", " ")} · {e.status} — {e.summary}</summary>
          <dl className="kv">
            <dt>Provenance</dt><dd>{e.provenance}</dd><dt>Captured</dt><dd className="mono">{e.captured_at}</dd>
            <dt>Scope</dt><dd className="mono">{Object.entries(e.scope).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd><dt>Parser</dt><dd className="mono">{e.parser_version}</dd>
          </dl>
          <pre>{JSON.stringify(e.data, null, 1).slice(0, 2400)}</pre>
        </details>
      ))}
      {g.kind !== "call" && (
        <details className="ev">
          <summary>Rule conditions after this gate</summary>
          <ul className="tiny">
            {snap.hypotheses.filter((h) => g.ruledOut.includes(h.rule_id) || g.pointing.includes(h.rule_id)).map((h) => (
              <li key={h.rule_id}><b className="mono">{h.rule_id}</b> {h.status}: {h.reasons.join(" · ")}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ForkBody({ options, chosen, lens, snap }: { options: Option[]; chosen: string; lens: Lens; snap: Snapshot }) {
  const [peek, setPeek] = useState<string | null>(chosen);
  const n = options.length, W = 560, H = 120;
  const xs = options.map((_, i) => (W * (i + 0.5)) / n);
  const req = snap.station.requirements;
  return (
    <div className="fork">
      <svg viewBox={`0 0 ${W} ${H}`} className="fork-svg" aria-hidden>
        {options.map((o, i) => (
          <path key={o.id} d={`M${W / 2} 8 C ${W / 2} 60, ${xs[i]} 50, ${xs[i]} ${H - 8}`}
            className={`fork-path ${o.id === chosen ? "chosen" : o.meets_requirements ? "ok" : "no"}`} />
        ))}
        <circle cx={W / 2} cy={8} r={6} className="fork-root" />
      </svg>
      <div className="fork-cards" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button key={o.id} className={`fork-card ${o.id === chosen ? "chosen" : ""} ${o.meets_requirements ? "" : "mitig"} ${peek === o.id ? "peek" : ""}`}
            onClick={() => setPeek(o.id)} aria-pressed={peek === o.id}>
            <span className="fc-tag">{o.id === chosen ? "chosen" : o.meets_requirements ? "also works" : "mitigation only"}</span>
            <b>{lens === "engineer" ? o.id : o.title}</b>
            {o.predicted.usable_frame_pct !== undefined && (
              <span className="fc-meters">
                <Meter label="usable" v={o.predicted.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
                <Meter label="speed" v={o.predicted.line_rate_cps} max={12} target={req.line_rate_cps} unit="/s" />
              </span>
            )}
          </button>
        ))}
      </div>
      {peek && (() => {
        const o = options.find((x) => x.id === peek)!;
        return (
          <div className="fork-peek fadein">
            <b>{o.title}</b> — {o.tradeoff}
            {lens === "engineer" && <pre className="tiny">{JSON.stringify({ action: o.action, params: o.params, predicted: o.predicted }, null, 1)}</pre>}
            {lens === "lead" && <p className="lead-note">{o.meets_requirements ? "Keeps the customer's required speed and timing." : "Would look like a fix on the day and quietly cost throughput every hour after."}</p>}
          </div>
        );
      })()}
      <p className="tiny muted">Predicted on a copy of the simulated line. Tap a path to compare.</p>
    </div>
  );
}

function Meter({ label, v, max, target, unit = "%" }: { label: string; v: number; max: number; target?: number; unit?: string }) {
  const ok = target === undefined || v >= target;
  return (
    <span className="meter">
      <span className="m-l">{label}</span>
      <span className="m-t"><span className={`m-f ${ok ? "ok" : "bad"}`} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />{target !== undefined && <span className="m-g" style={{ left: `${(target / max) * 100}%` }} />}</span>
      <span className="m-v mono">{Math.round(v * 10) / 10}{unit}</span>
    </span>
  );
}

function ProofBody({ snap, before, lens }: { snap: Snapshot; before: Snapshot; lens: Lens }) {
  const v = snap.verifications[snap.verifications.length - 1];
  const b = [...before.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "observed");
  const a = [...snap.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "verification");
  const [anim, setAnim] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnim(true), 120); return () => clearTimeout(t); }, []);
  const req = snap.station.requirements;
  const im = impact(snap);
  return (
    <div className="proof">
      <div className={`stamp ${v.passed ? "pass" : "fail"}`}>{v.passed ? "VERIFIED" : "NOT YET"}</div>
      {b && a && (
        <div className="proof-meters">
          <Meter label="usable before" v={b.data.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
          <Meter label="usable after" v={anim ? a.data.usable_frame_pct : b.data.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
          <Meter label="line speed" v={a.data.line_rate_cps} max={12} target={req.line_rate_cps} unit="/s" />
        </div>
      )}
      <ul className="checks">
        {v.checks.map((c) => <li key={c.check} className={c.passed ? "ok" : "bad"}>{c.passed ? "✓" : "✕"} {lens === "engineer" ? <><b className="mono">{c.check}</b> {c.detail} <span className="evref">{c.evidence}</span></> : c.detail}</li>)}
      </ul>
      {lens === "lead" && im.divertedBefore !== undefined && (
        <p className="lead-note">Diverted cartons: ~{im.divertedBefore.toLocaleString()}/h before → ~{(im.divertedAfter ?? 0).toLocaleString()}/h after (simulated usable-frame rate × {im.rate} cartons/s).</p>
      )}
    </div>
  );
}

function VerdictBody({ snap, gate, lens, scenarioId }: { snap: Snapshot; gate: Gate; lens: Lens; scenarioId: string }) {
  const d = DISP_PLAIN[snap.disposition];
  const im = impact(snap);
  const h = snap.handoff;
  return (
    <div className="verdict">
      <div className={`verdict-stamp d-${snap.disposition}`}><span>{d.word}</span></div>
      <p className="answer big">{gate.story} {d.line}</p>
      {lens === "story" && (
        <p className="answer">{storyEnding(snap)}</p>
      )}
      {lens === "lead" && (
        <>
          <div className="scorecard">
            {im.divertedBefore !== undefined && <div><b>{im.divertedBefore.toLocaleString()} → {(im.divertedAfter ?? im.divertedBefore).toLocaleString()}</b><span>diverted cartons / hour</span></div>}
            <div><b>{im.checks}</b><span>checks to a decision</span></div>
            <div><b>{im.techMinutes} min</b><span>technician time</span></div>
            <div><b>{im.lineStopMinutes} min</b><span>line stop / change window</span></div>
            <div><b>{im.replacementAvoided ? "1 avoided" : "—"}</b><span>needless camera shipment</span></div>
          </div>
          <h3 className="ledger-h">Decision ledger</h3>
          <LedgerList items={collectLedger(snap, gate)} />
          <p className="tiny muted">Cartons/hour = simulated unusable-frame share × required rate. Minutes use 5 min per synthetic effort/disruption unit and 10 min per change window. Illustrative, not measured.</p>
        </>
      )}
      {lens === "engineer" && (
        <div className="eng">
          <p className="small mono">rules {snap.rules_version} · mode {snap.mode} · {snap.evidence.length} evidence records · {snap.diagnostics.filter((x) => x.state === "evaluated").length} evaluated / {snap.diagnostics.filter((x) => x.state === "skipped").length} skipped / {snap.diagnostics.filter((x) => x.state === "blocked").length} blocked checks</p>
          <ul className="small">{snap.disposition_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {h?.reproduction_steps?.length > 0 && <><b className="small">Reproduction request</b><ol className="small">{h.reproduction_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>}
          {h?.engineering_alternatives?.length > 0 && <><b className="small">Untested alternatives</b><ul className="small">{h.engineering_alternatives.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></>}
          <a className="btn" href={`#/case/${scenarioId}/${0}`}>Inspect every step in the console</a>
        </div>
      )}
    </div>
  );
}

function storyEnding(s: Snapshot) {
  if (s.disposition === "known_playbook" && s.resolution === "resolved_verified") {
    const swap = s.assertions.some((a) => a.claim === "replacement_needed" && a.status === "contradicted");
    return `${swap ? "Nobody shipped a camera: the cameras were never broken. " : ""}One targeted change, proven on fresh measurements before the case was closed.`;
  }
  if (s.disposition === "engineering_escalation") return "There is no known safe fix — so instead of guessing, engineers receive the timeline, versions, what was ruled out, and exactly how to reproduce it. A good handoff is a win.";
  if (s.disposition === "field_service") return "A controlled swap test pointed at a physical part, so a technician visit is booked for that part only.";
  return "The honest answer is ‘not yet’ — one more observation is needed.";
}

function collectLedger(s: Snapshot, g: Gate) {
  const optRows = ((s.metrics?.options_considered ?? []) as any[]).flatMap((oc) => {
    const c = oc.options.find((o: Option) => o.id === oc.chosen);
    return oc.options.filter((o: Option) => o.id !== oc.chosen && !o.meets_requirements).map((o: Option) => ({ chose: c.title, over: o.title, because: o.tradeoff }));
  });
  return [...g.ledger, ...optRows];
}

function LedgerList({ items }: { items: { chose: string; over: string; because: string }[] }) {
  return (
    <ul className="ledger">
      {items.map((l, i) => <li key={i}><span className="lg-chose">{l.chose}</span><span className="lg-over">over {l.over}</span><span className="lg-why">{l.because}</span></li>)}
    </ul>
  );
}

function LeadMeter({ snap }: { snap: Snapshot }) {
  const im = impact(snap);
  return (
    <div className="lead-meter">
      <div><b>{im.divertedAfter !== undefined ? im.divertedAfter.toLocaleString() : im.divertedBefore !== undefined ? im.divertedBefore.toLocaleString() : "—"}</b><span>diverted cartons/h now</span></div>
      <div><b>{im.checks}</b><span>checks so far</span></div>
      <div><b>{im.techMinutes}m</b><span>technician</span></div>
    </div>
  );
}
