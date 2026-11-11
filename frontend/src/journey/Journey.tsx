import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataUrl, fetchJson } from "../data";
import LineStage from "../sim/LineStage";
import { PART_LABEL } from "../sim/render";
import { sceneFor, type PartInfo } from "../sim/scene";
import { PARTS, type Part } from "../sim/world";
import type { Evidence, Option, Replay, Snapshot } from "../types";
import { buildGates, impact, type Gate } from "./model";
import { DISP_PLAIN, HYP_PLAIN, STATUS_PLAIN, optionPlain } from "./plain";
import "./journey.css";

type Lens = "story" | "engineer" | "lead";
const LENSES: { id: Lens; label: string; who: string }[] = [
  { id: "story", label: "Story", who: "Plain words" },
  { id: "engineer", label: "Engineer", who: "Rules and evidence" },
  { id: "lead", label: "Lead", who: "Cost and calls" },
];
const KIND_LABEL: Record<string, string> = { call: "The ticket", check: "Remote check", ask: "Ask the technician", choose: "Choose a fix", proof: "Prove it", verdict: "Verdict" };
const HOLD_MS = 650;
const AUTO_MS = 4200;

function readLens(): Lens {
  try { return (localStorage.getItem("ls-lens") as Lens) || "story"; } catch { return "story"; }
}

export default function Journey({ scenarioId }: { scenarioId: string }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [opened, setOpened] = useState(1); // steps [0, opened) have been run
  const [cur, setCur] = useState(0);
  const [lens, setLensState] = useState<Lens>(readLens);
  const [peek, setPeek] = useState<string | null>(null);
  const [pick, setPick] = useState<Part | null | undefined>(undefined); // part the visitor is inspecting
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchJson<Replay>(dataUrl(`replays/${scenarioId}.json`)).then(setReplay).catch((e) => setErr(String(e)));
  }, [scenarioId]);
  const gates = useMemo(() => (replay ? buildGates(replay) : []), [replay]);
  const setLens = (l: Lens) => { setLensState(l); try { localStorage.setItem("ls-lens", l); } catch { /* storage unavailable */ } };

  const go = useCallback((i: number) => { setCur(i); setPeek(null); setPick(undefined); }, []);
  const advance = useCallback(() => {
    if (cur < opened - 1) go(cur + 1);
    else if (opened < gates.length) { setOpened(opened + 1); go(opened); }
  }, [cur, opened, gates.length, go]);

  useEffect(() => {
    if (!auto) return;
    if (cur >= gates.length - 1) { setAuto(false); return; }
    const g = gates[cur];
    if (g.kind === "choose" && !peek) { const t = setTimeout(() => setPeek(g.chosen!), 900); return () => clearTimeout(t); }
    const t = setTimeout(advance, AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, cur, gates, peek, advance]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft" && cur > 0) go(cur - 1);
      if (e.key === "ArrowRight" && cur < opened - 1) go(cur + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [cur, opened, go]);

  const gate = gates[cur];
  const view = useMemo(() => {
    if (!replay || !gate) return null;
    const opt = gate.kind === "choose" && peek ? gate.options!.find((o) => o.id === peek) ?? null : null;
    return sceneFor(replay, { frame: gate.frame, diagnostic: gate.diagnostic, kind: gate.kind, peek: opt, detail: lens === "engineer", focus: pick });
  }, [replay, gate, peek, lens, pick]);

  if (err) return <div className="panel">Could not load this case: <code>{err}</code></div>;
  if (!replay || !gate || !view) return <div className="panel">Starting the line…</div>;

  const snap = replay.frames[gate.frame].snapshot;
  const next = gates[cur + 1];
  const last = cur === gates.length - 1;

  return (
    <div className="journey" data-lens={lens}>
      <header className="j-head">
        <div>
          <a className="j-back" href="#/">← All cases</a>
          <div className="eyebrow">{snap.station.site} · {snap.station.line}</div>
          <h1>“{replay.scenario.title}.”</h1>
        </div>
        <div className="lenses" role="radiogroup" aria-label="Choose a lens">
          {LENSES.map((l) => (
            <button key={l.id} role="radio" aria-checked={lens === l.id} className={`lens ${lens === l.id ? "on" : ""}`} onClick={() => setLens(l.id)} data-testid={`lens-${l.id}`}>
              <b>{l.label}</b><span>{l.who}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="j-grid">
        <section className="j-stage" aria-label="The line">
          <LineStage scene={view.scene} hud={view.hud} />
          <ol className="rail" aria-label="Steps">
            {gates.map((g, i) => {
              const st = i === cur ? "current" : i < opened ? "done" : "locked";
              return (
                <li key={i} className={`pip ${st} k-${g.kind}`} data-testid={`pip-${i}`}>
                  <button disabled={i >= opened} onClick={() => { setAuto(false); go(i); }} aria-current={i === cur ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${g.label}${i >= opened ? " (not run yet)" : ""}`}>
                    <i>{i < opened ? i + 1 : ""}</i><span>{g.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="j-controls">
            <button className="btn sm" onClick={() => setAuto(!auto)} disabled={last} data-testid="autoplay">{auto ? "❚❚ Pause" : "▶ Play the case"}</button>
            <button className="btn sm ghost" onClick={() => { setAuto(false); setOpened(gates.length); go(gates.length - 1); }} data-testid="open-all">Skip to the verdict</button>
            <button className="btn sm ghost" onClick={() => { setAuto(false); setOpened(1); go(0); }}>Start over</button>
            <a className="btn sm ghost" href={`#/case/${scenarioId}/${gate.frame}`}>Engineering console at this point →</a>
          </div>
        </section>

        <aside className="j-side">
          {lens === "lead" && <LeadMeter snap={snap} />}
          <article className={`card k-${gate.kind}`} key={cur} data-testid="card" data-kind={gate.kind} data-step={cur}>
            <div className="card-top">
              <span className="mono">STEP {cur + 1} / {gates.length}</span>
              <span className="kind">{KIND_LABEL[gate.kind]}</span>
              {gate.diagnostic && lens === "engineer" && <span className="chip plain mono">{gate.diagnostic}</span>}
            </div>
            <h2>{gate.question}</h2>
            <GateBody gate={gate} lens={lens} replay={replay} peek={peek} setPeek={(id) => { setAuto(false); setPeek(id); }} />
            <div className="card-next">
              {cur < opened - 1 && <button className="btn primary" onClick={() => go(cur + 1)}>Next: {next.label} →</button>}
              {cur === opened - 1 && next && (
                <HoldButton onOpen={() => { setAuto(false); advance(); }} label={holdLabel(next)} sub={next.kind === "check" || next.kind === "ask" ? next.question : undefined} />
              )}
              {last && (
                <div className="row">
                  <a className="btn primary" href="#/">Try another case</a>
                  <a className="btn" href={`#/case/${scenarioId}`}>Open the engineering console</a>
                </div>
              )}
            </div>
          </article>
          <Suspects parts={view.parts} gate={gate} lens={lens} pick={pick ?? null} setPick={(p) => setPick(p === pick ? undefined : p)} />
        </aside>
      </div>
      <p className="tiny muted j-note">{snap.simulation.boundary} {replay.notice} The animation is slow motion: timings and failure shares come from the recorded engine run.</p>
    </div>
  );
}

function holdLabel(g: Gate) {
  return g.kind === "choose" ? "Hold to test the fixes" : g.kind === "proof" ? "Hold to apply it and measure again" : g.kind === "verdict" ? "Hold to reach the verdict"
    : g.kind === "ask" ? "Hold to ask the technician" : `Hold to run the next check: ${g.label}`;
}

function HoldButton({ onOpen, label, sub }: { onOpen: () => void; label: string; sub?: string }) {
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
  const C = 2 * Math.PI * 17;
  return (
    <button className="hold" data-testid="hold" style={{ ["--p" as any]: p }} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} onContextMenu={(e) => e.preventDefault()}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r="17" className="ring-bg" />
        <circle cx="22" cy="22" r="17" className="ring" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - p) }} />
        <path d="M18 14l10 8-10 8z" className="play" />
      </svg>
      <span><b>{label}</b>{sub && <small>{sub}</small>}</span>
    </button>
  );
}

const name = (id: string) => HYP_PLAIN[id] ?? id;

function Suspects({ parts, gate, lens, pick, setPick }: { parts: Record<Part, PartInfo>; gate: Gate; lens: Lens; pick: Part | null; setPick: (p: Part) => void }) {
  const shown = PARTS.filter((p) => parts[p].state !== "idle");
  const open = shown.filter((p) => parts[p].state === "suspect").length;
  const text = (i: PartInfo) => i.state === "suspect" ? `${i.open} ${i.open === 1 ? "possibility" : "possibilities"} open` : i.state === "cleared" ? "ruled out"
    : i.state === "culprit" ? "the evidence points here" : "fixed and verified";
  return (
    <section className="suspects" aria-label="Suspects">
      <h3>Where could the fault be? <span className="muted">{open ? `${open} of ${shown.length} parts still suspect` : "narrowed down"}</span></h3>
      <ul>
        {shown.map((p) => {
          const i = parts[p];
          const moved = i.hyps.some((h) => gate.ruledOut.includes(h.rule_id) || gate.pointing.includes(h.rule_id));
          return (
            <li key={p} className={`sus s-${i.state} ${moved ? "moved" : ""} ${pick === p ? "on" : ""}`} data-testid={`part-${p}`} data-state={i.state}>
              <button onClick={() => setPick(p)} aria-expanded={pick === p}>
                <span className="badge" aria-hidden>{i.state === "suspect" ? "?" : i.state === "culprit" ? "!" : "✓"}</span>
                <b>{PART_LABEL[p]}</b>
                <span className="sus-state">{text(i)}</span>
              </button>
              {pick === p && (
                <ul className="hyps">
                  {i.hyps.map((h) => (
                    <li key={h.rule_id} className={`h-${h.status}`}>
                      <span>{name(h.rule_id)}{lens === "engineer" && <code> {h.rule_id}</code>}</span>
                      <em>{h.status === "untested" && !h.active ? "not in play" : STATUS_PLAIN[h.status] ?? h.status}</em>
                      {lens === "engineer" && h.reasons.length > 0 && <small>{h.reasons.join(" · ")}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="tiny muted">Tap a part to light it up on the line and see what was considered.</p>
    </section>
  );
}

function GateBody({ gate: g, lens, replay, peek, setPeek }: { gate: Gate; lens: Lens; replay: Replay; peek: string | null; setPeek: (id: string | null) => void }) {
  const snap = replay.frames[g.frame].snapshot;
  return (
    <div className="gate-body">
      {g.kind === "call" && <CallBody snap={snap} lens={lens} />}
      {g.kind === "choose" && <ForkBody options={g.options!} chosen={g.chosen!} lens={lens} snap={snap} peek={peek} setPeek={setPeek} />}
      {g.kind === "proof" && <ProofBody snap={snap} lens={lens} before={replay.frames[Math.max(0, g.frame - 1)].snapshot} />}
      {g.kind === "verdict" && <VerdictBody snap={snap} gate={g} lens={lens} />}
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
      {lens === "story" && <p className="answer">Watch the line for a moment. Every part of it starts as a suspect. Each check below is cheap and remote, and each one clears parts of the line until one is left.</p>}
      {lens === "lead" && (
        <div className="lead-grid">
          <div><b>Business impact</b>{snap.incident.business_impact}</div>
          <div><b>Customer asks for</b>{snap.guard_events.filter((g) => g.type === "request_noted").map((g) => g.match).join("; ") || "a diagnosis"}</div>
          <div><b>Risk if we just comply</b>{snap.assertions.some((a) => a.claim === "replacement_needed") ? "Ship a camera, lose a day, and the line fails the same way." : "Repeat restarts that only buy time."}</div>
        </div>
      )}
      {snap.guard_events.some((g) => g.type !== "request_noted") && (
        <div className="guard small">Untrusted text flagged: {snap.guard_events.filter((g) => g.type !== "request_noted").map((g) => `“${g.match}”`).join(", ")}. It is treated as data only.</div>
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
          <summary><span className="evref">{e.id}</span> <span className="mono tiny">{e.key}</span> · {e.kind.replaceAll("_", " ")} · {e.status}: {e.summary}</summary>
          <dl className="kv">
            <dt>Provenance</dt><dd>{e.provenance}</dd><dt>Captured</dt><dd className="mono">{e.captured_at}</dd>
            <dt>Scope</dt><dd className="mono">{Object.entries(e.scope).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd><dt>Parser</dt><dd className="mono">{e.parser_version}</dd>
          </dl>
          <pre>{JSON.stringify(e.data, null, 1).slice(0, 2400)}</pre>
        </details>
      ))}
      {g.kind !== "call" && (
        <details className="ev">
          <summary>Rule conditions after this step</summary>
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

function ForkBody({ options, chosen, lens, snap, peek, setPeek }: { options: Option[]; chosen: string; lens: Lens; snap: Snapshot; peek: string | null; setPeek: (id: string | null) => void }) {
  const req = snap.station.requirements;
  return (
    <div className="fork">
      <p className="answer">{options.length} candidate fixes, each predicted on a copy of the line before anything is touched. <b>Tap one to try it on the line.</b></p>
      <div className="fork-cards">
        {options.map((o) => (
          <button key={o.id} className={`fork-card ${o.id === chosen ? "chosen" : ""} ${o.meets_requirements ? "" : "mitig"} ${peek === o.id ? "peek" : ""}`}
            onClick={() => setPeek(peek === o.id ? null : o.id)} aria-pressed={peek === o.id} data-testid={`opt-${o.id}`}>
            <span className="fc-tag">{o.id === chosen ? "the engine's pick" : o.meets_requirements ? "also works" : "not a real fix"}</span>
            <b>{lens === "engineer" ? `${o.id} · ${o.title}` : optionPlain(o.id, o.title)}</b>
            {o.predicted.usable_frame_pct !== undefined && (
              <span className="fc-meters">
                <Meter label="on time" v={o.predicted.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
                <Meter label="speed" v={o.predicted.line_rate_cps} max={12} target={req.line_rate_cps} unit="/s" />
              </span>
            )}
            {peek === o.id && (
              <span className="fc-more fadein">
                {o.tradeoff}
                {lens === "engineer" && <code>{JSON.stringify({ action: o.action, params: o.params, predicted: o.predicted })}</code>}
                {lens === "lead" && <em>{o.meets_requirements ? "Keeps the speed and timing the customer needs." : "Would look like a fix on the day and quietly cost throughput every hour after."}</em>}
              </span>
            )}
          </button>
        ))}
      </div>
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
      <p className="answer">{v.passed ? "The change is applied and the line is measured again. Only fresh measurements close a case." : "The change did not meet the requirements, so the case stays open."}</p>
      {b && a && (
        <div className="proof-meters">
          <Meter label="on time before" v={b.data.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
          <Meter label="on time after" v={anim ? a.data.usable_frame_pct : b.data.usable_frame_pct} max={100} target={req.usable_frame_pct_min} />
          <Meter label="line speed" v={a.data.line_rate_cps} max={12} target={req.line_rate_cps} unit="/s" />
        </div>
      )}
      <ul className="checks">
        {v.checks.map((c) => <li key={c.check} className={c.passed ? "ok" : "bad"}>{c.passed ? "✓" : "✕"} {lens === "engineer" ? <><b className="mono">{c.check}</b> {c.detail} <span className="evref">{c.evidence}</span></> : c.detail}</li>)}
      </ul>
      {lens === "lead" && im.divertedBefore !== undefined && (
        <p className="lead-note">Diverted cartons: about {im.divertedBefore.toLocaleString()} an hour before, {(im.divertedAfter ?? 0).toLocaleString()} after (simulated late share × {im.rate} cartons/s).</p>
      )}
    </div>
  );
}

function VerdictBody({ snap, gate, lens }: { snap: Snapshot; gate: Gate; lens: Lens }) {
  const d = DISP_PLAIN[snap.disposition];
  const im = impact(snap);
  const h = snap.handoff;
  return (
    <div className="verdict">
      <div className={`verdict-stamp d-${snap.disposition}`}><span>{d.word}</span></div>
      <p className="answer big">{gate.story} {d.line}</p>
      {lens === "story" && <p className="answer">{storyEnding(snap)}</p>}
      {lens === "lead" && (
        <>
          <div className="scorecard">
            {im.divertedBefore !== undefined && <div><b>{im.divertedBefore.toLocaleString()} → {(im.divertedAfter ?? im.divertedBefore).toLocaleString()}</b><span>diverted cartons / hour</span></div>}
            <div><b>{im.checks}</b><span>checks to a decision</span></div>
            <div><b>{im.techMinutes} min</b><span>technician time</span></div>
            <div><b>{im.lineStopMinutes} min</b><span>line stop / change window</span></div>
            <div><b>{im.replacementAvoided ? "1 avoided" : "none"}</b><span>needless camera shipment</span></div>
          </div>
          <h3 className="ledger-h">Decision ledger</h3>
          <LedgerList items={collectLedger(snap, gate)} />
          <p className="tiny muted">Cartons/hour = simulated late share × required rate. Minutes use 5 min per synthetic effort or disruption unit and 10 min per change window. Illustrative, not measured.</p>
        </>
      )}
      {lens === "engineer" && (
        <div className="eng">
          <p className="small mono">rules {snap.rules_version} · mode {snap.mode} · {snap.evidence.length} evidence records · {snap.diagnostics.filter((x) => x.state === "evaluated").length} evaluated / {snap.diagnostics.filter((x) => x.state === "skipped").length} skipped / {snap.diagnostics.filter((x) => x.state === "blocked").length} blocked checks</p>
          <ul className="small">{snap.disposition_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {h?.reproduction_steps?.length > 0 && <><b className="small">Reproduction request</b><ol className="small">{h.reproduction_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>}
          {h?.engineering_alternatives?.length > 0 && <><b className="small">Untested alternatives</b><ul className="small">{h.engineering_alternatives.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></>}
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
  if (s.disposition === "engineering_escalation") return "There is no known safe fix. So instead of guessing, engineers receive the timeline, the versions, what was ruled out, and exactly how to reproduce it. A good handoff is a win.";
  if (s.disposition === "field_service") return "A controlled swap test pointed at a physical part, so a technician visit is booked for that part only.";
  return "The honest answer is ‘not yet’: one more observation is needed.";
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
  const div = im.divertedAfter ?? im.divertedBefore;
  return (
    <div className="lead-meter" data-testid="lead-meter">
      <div><b>{div !== undefined ? div.toLocaleString() : "not measured"}</b><span>diverted cartons / hour</span></div>
      <div><b>{im.checks}</b><span>checks so far</span></div>
      <div><b>{im.techMinutes} min</b><span>technician time</span></div>
    </div>
  );
}
