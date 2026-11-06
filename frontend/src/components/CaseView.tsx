import { useCallback, useEffect, useMemo, useState } from "react";
import { apiCreate, apiPost, dataUrl, fetchJson, StaticDriver } from "../data";
import type { Replay, Snapshot } from "../types";
import { DISP, EvidenceCtx, RES } from "./common";
import Topology from "./Topology";
import { Hypotheses, NextCheck, DecisionGraph, WhatChanged, Symptoms, Assertions } from "./Reasoning";
import Interventions from "./Interventions";
import { Outputs, EvidenceDrawer, TraceView, Timeline, GuardEvents } from "./Outputs";

type Api = { modes: string[]; live_model: string | null } | null;

export default function CaseView({ scenarioId, api, initialStep }: { scenarioId: string; api: Api; initialStep?: number }) {
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [driver, setDriver] = useState<StaticDriver | null>(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>("replay");
  const [openEv, setOpenEv] = useState<string | null>(null);
  const useApi = !!api;

  const start = useCallback(async (m: string) => {
    setErr(""); setBusy(true);
    try {
      if (useApi) {
        const s = await apiCreate(scenarioId, m);
        setHistory([s]);
        setNotice(m === "live" ? `Live: intake and drafts may call ${api!.live_model}; every output is validated by the engine.`
          : m === "replay" ? "Replay: intake uses a stored structured fixture where one exists (labelled in the trace); everything else is the deterministic engine."
          : "Rules: deterministic lexicon parser and templates only; no model.");
      } else {
        const r = await fetchJson<Replay>(dataUrl(`replays/${scenarioId}.json`));
        const d = new StaticDriver(r);
        if (initialStep !== undefined) d.i = Math.max(0, Math.min(initialStep, r.frames.length - 1));
        setDriver(d); setHistory(d.history); setNotice(r.notice);
      }
    } catch (e: any) { setErr(String(e.message ?? e)); }
    setBusy(false);
  }, [scenarioId, useApi, api, initialStep]);

  useEffect(() => { start(mode); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : undefined;
  const evIndex = useMemo(() => new Map((snap?.evidence ?? []).map((e) => [e.id, e])), [snap]);

  async function act(kind: "step" | "answer" | "apply", optionId?: string) {
    if (!snap) return;
    setErr(""); setBusy(true);
    try {
      if (driver) {
        const next = driver.nextAction;
        if (kind === "apply" && next?.option_id !== optionId) {
          setErr("Static replay contains only the recorded (recommended) option. Run the API locally to try other options; their predicted outcomes are shown in the table.");
        } else { driver.step(); setHistory(driver.history); }
      } else {
        const s = kind === "step" ? await apiPost(snap.case_id, "step")
          : kind === "answer" ? await apiPost(snap.case_id, "answer", { simulated: true })
          : await apiPost(snap.case_id, "apply", { option_id: optionId });
        setHistory((h) => [...h, s]);
      }
    } catch (e: any) { setErr(String(e.message ?? e)); }
    setBusy(false);
  }
  function back() { if (driver) { driver.back(); setHistory(driver.history); } else setHistory((h) => h.slice(0, -1)); }
  async function runToEnd() {
    if (!driver) return;
    while (driver.nextAction) driver.step();
    setHistory(driver.history);
  }

  if (err && !snap) return <div className="panel">Could not load case: <code>{err}</code></div>;
  if (!snap) return <div className="panel">Loading investigation…</div>;

  const d = DISP[snap.disposition];
  const canStep = !snap.finished && !snap.pending_question && !snap.intervention_options.length && !!snap.next_check;
  const nextDiag = snap.diagnostics.find((x) => x.id === snap.next_check);
  const meta = snap.metrics?.scenario ?? {};

  return (
    <EvidenceCtx.Provider value={setOpenEv}>
      <div className="stack">
        <div className="banner-sim">
          <b>Simulation boundary.</b> {snap.simulation.boundary} <span className="tiny">Fixture: {String(meta.fixture ?? "").replaceAll("_", " ")}{meta.sources?.length ? ` · sources ${meta.sources.join(", ")}` : ""}.</span>
        </div>
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: "1 1 420px" }}>
              <div className="tiny muted mono">{snap.station.site} · {snap.station.line} · {snap.case_id}</div>
              <h1 style={{ fontSize: "1.35rem", margin: "4px 0 8px" }}>{meta.title ?? snap.scenario_id}</h1>
              <div className="ticket" style={{ fontSize: "0.95rem", whiteSpace: "pre-wrap" }}>
                {snap.incident.ticket_text}
                <div className="from">— {snap.incident.reporter}</div>
              </div>
              <p className="small" style={{ marginBottom: 0 }}><b>Business impact:</b> {snap.incident.business_impact}</p>
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <div className={`disp ${snap.disposition}`} data-testid="disposition">
                <span className="label">{d?.word}</span>
                <span className="small">{RES[snap.resolution] ?? snap.resolution}<br /><span className="muted tiny">{d?.blurb}</span></span>
              </div>
              <ul className="small" style={{ paddingLeft: 18, margin: "8px 0" }}>
                {snap.disposition_reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <div className="controls">
                {useApi && history.length === 1 && (
                  <label className="small">Mode&nbsp;
                    <select value={mode} onChange={(e) => { setMode(e.target.value); start(e.target.value); }}>
                      {api!.modes.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                )}
                <button className="btn primary" onClick={() => act("step")} disabled={busy || !canStep} data-testid="run-next">
                  ▶ Run next check{nextDiag ? `: ${nextDiag.id}` : ""}
                </button>
                <button className="btn" onClick={back} disabled={busy || history.length < 2}>◀ Back</button>
                {driver && <button className="btn ghost" onClick={runToEnd} disabled={!driver.nextAction}>⏭ Jump to end</button>}
                <span className="stepper">step {history.length}{driver ? ` / ${driver.frames.length}` : ""}</span>
              </div>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>{notice}</p>
              {err && <p className="small" style={{ color: "var(--fail)" }} role="alert">{err}</p>}
            </div>
          </div>
        </div>

        {snap.pending_question && (
          <div className="question fadein" data-testid="question">
            <b>Ask the technician (one discriminating observation):</b>
            <p style={{ margin: "4px 0" }}>{snap.pending_question.question}</p>
            <p className="tiny muted" style={{ margin: "0 0 6px" }}>Why this question: {snap.pending_question.why}</p>
            <button className="btn primary" onClick={() => act("answer")} disabled={busy}>Record the technician's answer (simulated)</button>
          </div>
        )}

        <GuardEvents events={snap.guard_events} />

        <div className="case-grid">
          <div className="stack" style={{ minWidth: 0 }}>
            <Topology snap={snap} />
            {snap.intervention_options.length > 0 || snap.interventions.length > 0
              ? <Interventions snap={snap} onApply={(id) => act("apply", id)} busy={busy} recorded={driver?.recordedOption} />
              : null}
            <Hypotheses snap={snap} />
            <DecisionGraph snap={snap} />
          </div>
          <div className="stack" style={{ minWidth: 0 }}>
            <NextCheck snap={snap} />
            <WhatChanged snap={snap} prev={prev} />
            <Symptoms snap={snap} />
            <Assertions snap={snap} />
            <Timeline snap={snap} />
          </div>
        </div>
        <Outputs snap={snap} />
        <TraceView snap={snap} />
      </div>
      {openEv && <EvidenceDrawer ev={evIndex.get(openEv)} id={openEv} onClose={() => setOpenEv(null)} />}
    </EvidenceCtx.Provider>
  );
}
