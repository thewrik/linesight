export default function AboutView() {
  return (
    <div className="stack">
      <section className="panel">
        <h2>How LineSight works</h2>
        <ol className="small">
          <li><b>Intake.</b> The ticket is untrusted text. A parser (lexicon, or optionally a model with a fixed schema) turns it into reported symptom groups, devices, customer claims and requested actions. Claims stay <i>assertions</i> until evidence agrees or disagrees.</li>
          <li><b>Facts.</b> Read-only probes return evidence records (provenance, capture time, scope, parser version, stable id). Deterministic code derives named facts; stale or unavailable evidence yields no fact.</li>
          <li><b>Rules.</b> Each hypothesis in <code>rules.yaml</code> has trigger symptoms, support and contradiction predicates over facts, a playbook or disposition, and sources. Status is supported / contradicted / untested — no invented probabilities.</li>
          <li><b>Next check.</b> Among checks that would change an active hypothesis or test an open symptom: score = (severity-weighted hypotheses + open symptoms) ÷ (1 + operator effort + 2 × production disruption). Prerequisites, test windows and budgets can block a check; irrelevant checks are skipped with a reason.</li>
          <li><b>Disposition.</b> Stop when every observed symptom is explained and every reported symptom group is either reproduced or cleared. Escalate on unvalidated mechanisms, recurrence after temporary recoveries, failed verification, or no matching rule. “No fault reproduced” is distinct from “no matching playbook”.</li>
          <li><b>Intervention.</b> Only actions the playbook allows; options are predicted on a copy of the simulator; the engineer approves one; the simulator applies it.</li>
          <li><b>Verification.</b> Fresh probes must meet the customer's requirements (usable frames, deadline, line rate, control, PLC results). A change that works below the required line rate is recorded as a mitigation.</li>
        </ol>
      </section>
      <section className="panel small">
        <h2>Simulation boundaries</h2>
        <ul>
          <li>Companies, products, versions, the compatibility matrix and the plant are fictional.</li>
          <li>The image-transport model is a small piecewise burst-queue model with resend rounds and a deadline. Its assumptions are listed with every transport result. It is not a model of real GigE Vision devices.</li>
          <li>Technician answers are simulated from the hidden station state, or scripted as unavailable.</li>
        </ul>
      </section>
      <section className="panel small">
        <h2>Tradeoffs</h2>
        <ul>
          <li><b>Bounded context:</b> one station template for packaging-line machine vision, not a general device chatbot.</li>
          <li><b>Decision graph over free-form diagnosis:</b> every step is inspectable and reproducible; novel faults go to an engineer rather than to a guess.</li>
          <li><b>Deterministic enforcement:</b> compatibility, counters, permissions, transitions and verification are code. A model cannot add tools or widen permissions.</li>
          <li><b>Useful abstention:</b> a cited engineering handoff counts as a good outcome.</li>
          <li><b>Verification before closure:</b> no case closes on a predicted fix.</li>
        </ul>
      </section>
    </div>
  );
}
