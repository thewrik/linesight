const DEMOS = [
  {
    id: "demo-a-line-speed", tag: "Demo A · documented mechanism replay",
    title: "“It only fails at full line speed.”",
    body: "Four cameras that each work alone lose images in synchronous bursts after a switch swap. LineSight separates average bandwidth from burst contention, compares pacing options against the line-rate requirement, then verifies completeness and rate.",
    outcome: "Known playbook → verified recovery",
  },
  {
    id: "demo-b-replacement", tag: "Demo B · documented mechanism replay",
    title: "“The replacement camera is visible but cannot connect.”",
    body: "Discovery succeeds, control is refused. A version comparison against the station's compatibility matrix finds the adapter/firmware mismatch — no network troubleshooting loop.",
    outcome: "Known playbook → verified recovery",
  },
  {
    id: "demo-c-heartbeat", tag: "Demo C · adaptation of an unresolved public report",
    title: "“It disconnects after an hour, but not reliably.”",
    body: "Heartbeat access-denied after idle, a recent host migration, and restarts that only help temporarily. No validated fix exists, so the useful outcome is a focused engineering handoff.",
    outcome: "Engineering escalation with reproduction request",
  },
];

export default function Landing() {
  return (
    <div className="stack">
      <div className="banner-sim">
        Fictional plant, fictional products, simulated telemetry. Public sources inform individual failure mechanisms only — see <a href="#/sources">Sources</a>.
      </div>
      <section className="hero">
        <div>
          <div className="time">MONDAY · 06:40 · LINE 3 · CARTON LABELLING</div>
          <h1>“Camera offline” could mean five different things.</h1>
          <p>
            A packaging line inspects printed labels and batch codes before cartons are sealed. Four GigE cameras feed an edge PC
            through a managed PoE switch; the PLC triggers each camera and waits for a pass/fail result; a management service
            reports to the plant dashboard. Over the weekend maintenance replaced the edge PC and the switch. At low speed
            everything looks fine. At production speed, images go missing and cartons are diverted.
          </p>
          <div className="ticket" role="note">
            Camera 3 keeps going offline. We restarted it twice. Can you send a replacement?
            <div className="from">— operator ticket, 06:38</div>
          </div>
        </div>
        <div className="panel">
          <h2>What LineSight checks separately</h2>
          <div className="meanings">
            <div><b>Discovery</b>GVCP broadcast: is the camera visible?</div>
            <div><b>Control</b>Can the host open the control channel and keep its heartbeat?</div>
            <div><b>Image transport</b>Do complete frames arrive before the reject gate?</div>
            <div><b>Trigger / result</b>Does each PLC trigger start a frame and get a result?</div>
            <div><b>Management</b>Is the dashboard stale while acquisition is fine?</div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Success on one path never paints another healthy. The engine runs cheap read-only checks that discriminate between
            explanations, asks the technician for one observation at a time, applies only playbook-permitted simulated changes,
            and verifies before closing.
          </p>
        </div>
      </section>

      <section className="demos" aria-label="Flagship demos">
        {DEMOS.map((d) => (
          <a key={d.id} className="demo-card" href={`#/case/${d.id}`}>
            <span className="tag">{d.tag}</span>
            <h3>{d.title}</h3>
            <span className="small muted">{d.body}</span>
            <span className="outcome"><span className="chip plain">{d.outcome}</span></span>
            <span className="btn primary" style={{ alignSelf: "flex-start" }}>Open investigation →</span>
          </a>
        ))}
      </section>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 8 }}>
        <div className="panel small">
          <h3>Four dispositions</h3>
          Known playbook · More evidence needed · Engineering escalation · Field service. Technical fault family and support
          disposition are independent: a rare fault can have a playbook; a common symptom can still be ambiguous.
        </div>
        <div className="panel small">
          <h3>Where a model fits</h3>
          Structuring a messy ticket, proposing one of the engine's own candidate checks, drafting cited explanations. Compatibility
          checks, counters, permissions, state transitions and verification are deterministic code. This build runs without any API key.
        </div>
        <div className="panel small">
          <h3>Measured, not claimed</h3>
          The <a href="#/eval">evaluation page</a> shows actual runs of a static checklist, the rules engine and replay on a synthetic,
          labelled casebook — including failures. It is not an estimate of field performance.
        </div>
      </section>
    </div>
  );
}
