import { useEffect, useMemo, useState } from "react";
import { dataUrl, fetchJson } from "../data";
import LineStage from "../sim/LineStage";
import { sceneFor } from "../sim/scene";
import { PARTS } from "../sim/world";
import type { Replay } from "../types";
import "./landing.css";

const DEMOS = [
  {
    id: "demo-a-line-speed", letter: "A", tag: "Documented mechanism replay",
    title: "“It only fails at full line speed.”",
    body: "Four cameras that each work alone lose pictures when they all send at once, after a switch swap. Four fixes are tried on the line. Two of them only look like fixes.",
    outcome: "Known fix, verified at full speed", tone: "ok",
  },
  {
    id: "demo-b-replacement", letter: "B", tag: "Documented mechanism replay",
    title: "“The replacement camera is visible but cannot connect.”",
    body: "The new camera shows up on the network and still refuses the PC. The answer is not on the network at all, and it takes four checks to find.",
    outcome: "Known fix, verified", tone: "ok",
  },
  {
    id: "demo-c-heartbeat", letter: "C", tag: "Adaptation of an unresolved public report",
    title: "“It disconnects after an hour, but not reliably.”",
    body: "After the line sits idle, every camera locks the PC out. Restarts only buy time. No known fix is safe, so the right move is a clean handoff to engineering.",
    outcome: "Handed to engineering, with a way to reproduce it", tone: "warn",
  },
];

const MEANINGS: [string, string][] = [
  ["Can't be seen", "The PC calls out on the network and the camera does not answer."],
  ["Can't be controlled", "The camera is visible but refuses the PC's connection."],
  ["Pictures lost or late", "Images arrive broken, or after the carton has already passed the gate."],
  ["Never told to shoot", "The line controller's signal does not reach the camera."],
  ["Only the dashboard is stale", "Inspection is fine. The plant's status screen has stopped updating."],
];

export default function Landing() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => { fetchJson<Replay>(dataUrl("replays/demo-a-line-speed.json")).then(setReplay).catch(() => setReplay(null)); }, []);
  const view = useMemo(() => {
    if (!replay) return null;
    const v = sceneFor(replay, { frame: 0, lowSpeed: slow, focus: null });
    // the hero shows the plant before anyone has investigated: no verdicts on the labels
    v.scene.parts = Object.fromEntries(PARTS.map((p) => [p, { state: "idle", open: 0 }])) as typeof v.scene.parts;
    return v;
  }, [replay, slow]);
  const req = replay?.frames[0].snapshot.station.requirements;

  return (
    <div className="home">
      <section className="hero">
        {view && <LineStage scene={view.scene} hero className="hero-line" />}
        <div className="hero-copy">
          <div className="eyebrow">Monday · 06:40 · Line 3 · carton labelling</div>
          <h1>“Camera 3 keeps going offline.”</h1>
          <p className="lede">
            That is the whole ticket. Now watch the line. The cameras fire, the cartons are fine, and still about one in three gets
            pushed off to be checked by hand.
          </p>
          <p className="lede dim">
            LineSight is a support engineer's tool for finding out why, one cheap check at a time, and for proving the fix before
            the case is closed.
          </p>
          <div className="hero-cta">
            <a className="btn primary lg" href="#/journey/demo-a-line-speed" data-testid="hero-start">Investigate this line →</a>
            {req && (
              <div className="speed" role="group" aria-label="Line speed">
                <span>Line speed</span>
                <button aria-pressed={slow} onClick={() => setSlow(true)} data-testid="speed-low">{req.low_speed_cps}/s</button>
                <button aria-pressed={!slow} onClick={() => setSlow(false)} data-testid="speed-full">{req.line_rate_cps}/s</button>
              </div>
            )}
          </div>
          <p className="hero-hint" data-testid="hero-caption">{view ? view.hud.caption : "Starting the line…"} {slow ? "That is why Saturday's test run passed." : "Try slowing it down."}</p>
        </div>
        <div className="hero-foot">Fictional plant, simulated telemetry, slow motion. Timings and failure shares come from the recorded engine run.</div>
      </section>

      <div className="wrap home-body">
        <section className="meanings-sec">
          <div className="sec-head">
            <span className="eyebrow">The problem</span>
            <h2>“Offline” could mean five different things.</h2>
            <p>Each has a different cause and a different fix. Shipping a replacement camera fixes none of the ones on this line.</p>
          </div>
          <ol className="meanings">
            {MEANINGS.map(([t, d], i) => <li key={t}><i>{i + 1}</i><b>{t}</b><span>{d}</span></li>)}
          </ol>
        </section>

        <section>
          <div className="sec-head">
            <span className="eyebrow">Three cases</span>
            <h2>Walk an investigation on the live line.</h2>
            <p>Hold to run each check. The line reacts, suspects are cleared one part at a time, and the fix is tried before it is trusted.</p>
          </div>
          <div className="demos" aria-label="Flagship demos">
            {DEMOS.map((d) => (
              <article key={d.id} className={`demo-card t-${d.tone}`}>
                <span className="letter" aria-hidden>{d.letter}</span>
                <span className="tag">{d.tag}</span>
                <h3>{d.title}</h3>
                <p>{d.body}</p>
                <span className={`outcome t-${d.tone}`}>{d.outcome}</span>
                <span className="row">
                  <a className="btn primary" href={`#/journey/${d.id}`} data-testid={`journey-${d.id}`}>Walk the case →</a>
                  <a className="btn ghost" href={`#/case/${d.id}`}>Engineering console</a>
                </span>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="eyebrow">Three lenses</span>
            <h2>The same case, read three ways.</h2>
          </div>
          <div className="lens-grid">
            <div><b>Story</b><p>Plain words. What was asked, what was found, and which part of the line was cleared. No jargon needed.</p></div>
            <div><b>Engineer</b><p>Rule ids, why each check was chosen and its score, evidence with provenance and raw data, and a link into the full console at the same step.</p></div>
            <div><b>Lead</b><p>Diverted cartons an hour, technician minutes, line stops, and a ledger of each call and what it was chosen over.</p></div>
          </div>
        </section>

        <section className="facts">
          <div>
            <h3>Rules decide. A model only helps with words.</h3>
            <p>Compatibility checks, counters, permissions, the choice of next check and verification are deterministic code. A model may structure a messy ticket or draft text that cites existing evidence. This build runs with no API key.</p>
            <a href="#/about">How it works →</a>
          </div>
          <div>
            <h3>Measured, not claimed.</h3>
            <p>The evaluation page shows real runs of a static checklist and the rules engine on a labelled synthetic casebook, failures included. It is a regression suite, not an estimate of field performance.</p>
            <a href="#/eval">See the evaluation →</a>
          </div>
          <div>
            <h3>Fictional plant, public mechanisms.</h3>
            <p>The plant, products and telemetry are invented and simulated. Six public sources inform the individual failure mechanisms. No vendor relationship is implied.</p>
            <a href="#/sources">Read the sources →</a>
          </div>
        </section>
      </div>
    </div>
  );
}
