import { useState } from "react";
import type { Evidence, Snapshot } from "../types";
import { EvRef, EvRefs, fmtT } from "./common";

function withRefs(text: string) {
  const parts = text.split(/(\[E-\d{3}\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(E-\d{3})\]$/);
    return m ? <EvRef key={i} id={m[1]} /> : <span key={i}>{p}</span>;
  });
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Outputs({ snap }: { snap: Snapshot }) {
  const [tab, setTab] = useState<"customer" | "handoff">("customer");
  const h = snap.handoff;
  return (
    <section className="panel" aria-labelledby="out-h" data-testid="outputs">
      <h2 id="out-h">Outputs</h2>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "customer"} onClick={() => setTab("customer")}>Customer explanation</button>
        <button role="tab" aria-selected={tab === "handoff"} onClick={() => setTab("handoff")}>Engineering handoff</button>
      </div>
      {tab === "customer" && (
        <div className="stack small" data-testid="customer-text">
          {snap.customer_explanation.text.split("\n").map((l, i) => <p key={i} style={{ margin: 0 }}>{withRefs(l)}</p>)}
          <p className="tiny muted">Source: {snap.customer_explanation.origin === "template" ? "deterministic template" : snap.customer_explanation.origin}
            {snap.customer_explanation.fallback_reason ? ` (${snap.customer_explanation.fallback_reason})` : ""}. Bracketed ids open the evidence.</p>
        </div>
      )}
      {tab === "handoff" && (h ? (
        <div className="stack">
          <div className="row">
            <button className="btn" onClick={() => download(`${snap.case_id}-handoff.md`, h.markdown, "text/markdown")}>Export Markdown</button>
            <button className="btn" onClick={() => download(`${snap.case_id}-handoff.json`, JSON.stringify({ ...h, markdown: undefined }, null, 2), "application/json")}>Export JSON</button>
            <span className="tiny muted">versions · topology · timeline · checks · observations · hypotheses · reproduction · workaround · requested help</span>
          </div>
          {h.requested_help && <div className="change"><b>Requested engineering help:</b> {h.requested_help}</div>}
          {h.reproduction_steps?.length > 0 && (
            <div className="small"><b>Reproduction request</b><ol>{h.reproduction_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>
          )}
          {h.engineering_alternatives?.length > 0 && (
            <div className="small"><b>Plausible alternatives (untested)</b><ul>{h.engineering_alternatives.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
          )}
          <details><summary>Full handoff (Markdown)</summary><pre className="md">{h.markdown}</pre></details>
        </div>
      ) : <p className="small muted">The handoff is assembled once the engine reaches a disposition.</p>)}
    </section>
  );
}

export function Timeline({ snap }: { snap: Snapshot }) {
  const ev = [...snap.evidence].reverse().find((e) => e.key === "events" && e.status === "ok");
  const items = [
    ...snap.incident.timeline.map((t) => ({ t: t.t, what: t.what, src: "customer (assertion)", id: "" })),
    ...(ev ? ev.data.events.map((x: any) => ({ t: x.t, what: x.msg, src: x.untrusted ? "uploaded log (untrusted)" : x.source, id: ev.id })) : []),
  ].sort((a, b) => a.t.localeCompare(b.t));
  return (
    <section className="panel" aria-labelledby="tl-h">
      <h2 id="tl-h">Incident & change timeline</h2>
      {!ev && <p className="tiny muted" style={{ marginTop: 0 }}>Station events not yet correlated; showing the customer's timeline.</p>}
      <ol className="timeline">
        {items.map((x, i) => (
          <li key={i}><span className="t">{fmtT(x.t)}</span><span>{x.what} <span className="src">· {x.src}</span> {x.id && <EvRef id={x.id} />}</span></li>
        ))}
      </ol>
    </section>
  );
}

export function GuardEvents({ events }: { events: Snapshot["guard_events"] }) {
  const flagged = events.filter((g) => g.type !== "request_noted");
  const noted = events.filter((g) => g.type === "request_noted");
  return (
    <>
      {flagged.length > 0 && (
        <div className="guard" data-testid="guard">
          <b>Untrusted input findings</b> — treated as data; no permission changed.
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {flagged.map((g, i) => <li key={i}><span className="mono tiny">{g.type}</span> in {g.origin}: “{g.match}” → {g.action}</li>)}
          </ul>
        </div>
      )}
      {noted.length > 0 && (
        <div className="small muted">Customer requests noted: {noted.map((g) => `${g.match} (${g.action})`).join("; ")}</div>
      )}
    </>
  );
}

export function TraceView({ snap }: { snap: Snapshot }) {
  return (
    <section className="panel">
      <details>
        <summary>Investigation trace ({snap.trace.length} entries) — tool inputs and outputs, no hidden reasoning</summary>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>#</th><th>Actor</th><th>Action</th><th>Tool</th><th>Inputs</th><th>Outputs</th></tr></thead>
            <tbody>
              {snap.trace.map((t) => (
                <tr key={t.seq}>
                  <td className="mono tiny">{t.seq}</td><td className="small">{t.actor}</td><td className="small">{t.action}{t.note && <div className="tiny muted">{t.note}</div>}</td>
                  <td className="mono tiny">{t.tool}</td>
                  <td className="mono tiny" style={{ maxWidth: 240, wordBreak: "break-word" }}>{JSON.stringify(t.inputs).slice(0, 220)}</td>
                  <td className="mono tiny" style={{ maxWidth: 320, wordBreak: "break-word" }}>{JSON.stringify(t.outputs).slice(0, 320)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function EvidenceDrawer({ ev, id, onClose }: { ev?: Evidence; id: string; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Evidence ${id}`} data-testid="evidence-drawer">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Evidence {id}</h2>
          <button className="btn" onClick={onClose} autoFocus>Close</button>
        </div>
        {ev ? (
          <>
            <p className="small">{ev.summary}</p>
            <dl className="kv">
              <dt>Key</dt><dd className="mono">{ev.key}</dd>
              <dt>Kind</dt><dd>{ev.kind.replaceAll("_", " ")}{ev.untrusted_text ? " · untrusted text" : ""}</dd>
              <dt>Status</dt><dd>{ev.status}</dd>
              <dt>Captured</dt><dd className="mono">{ev.captured_at}</dd>
              <dt>Received</dt><dd className="mono">seq {ev.received_seq}</dd>
              <dt>Provenance</dt><dd>{ev.provenance}</dd>
              <dt>Scope</dt><dd className="mono">{Object.entries(ev.scope).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd>
              <dt>Parser</dt><dd className="mono">{ev.parser_version}</dd>
            </dl>
            <h3 style={{ marginTop: 12 }}>Raw data</h3>
            <pre>{JSON.stringify(ev.data, null, 2)}</pre>
          </>
        ) : <p>Not found in this snapshot.</p>}
      </aside>
    </>
  );
}

export { EvRefs };
