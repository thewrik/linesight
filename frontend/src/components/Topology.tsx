import { useState } from "react";
import type { PathInfo, Snapshot, Status } from "../types";
import { EvRefs, StatusChip } from "./common";

const PATHS: [string, string, string][] = [
  ["disc", "Discovery", "D"], ["ctrl", "Control", "C"], ["strm", "Image stream", "S"], ["trig", "Trigger", "T"], ["poe", "PoE power", "P"],
];
const ICON: Record<string, string> = { ok: "✓", degraded: "!", fail: "✕", unknown: "?" };

function latest(snap: Snapshot, key: string) {
  const evs = snap.evidence.filter((e) => e.key === key && e.status === "ok");
  return evs[evs.length - 1];
}

export default function Topology({ snap }: { snap: Snapshot }) {
  const [sel, setSel] = useState<string | null>(null);
  const cams = snap.station.devices.filter((d: any) => d.kind === "camera");
  const dev = (id: string) => snap.station.devices.find((d: any) => d.id === id);
  const topo = latest(snap, "topology");
  const uplink: PathInfo = topo
    ? { status: topo.data.switch.uplink_egress_drops_per_min > 0 ? "degraded" : "ok", evidence: [topo.id], after_intervention: topo.kind === "verification",
        note: `uplink egress drops ${topo.data.switch.uplink_egress_drops_per_min}/min; port buffer ${topo.data.switch.buffer_kb} KB; PoE ${topo.data.switch.poe.draw_w}/${topo.data.switch.poe.budget_w} W` }
    : { status: "unknown", evidence: [], note: "switch counters not checked", after_intervention: false };
  const paths: Record<string, PathInfo> = { ...snap.paths, "sw-uplink": uplink };
  const conn = (id: string) => snap.station.connections.find((c: any) => c.id === id);
  const selInfo = sel ? paths[sel] : null;
  const selConn = sel ? conn(sel) : null;

  const PB = ({ id, label, short }: { id: string; label: string; short: string }) => {
    const p = paths[id] ?? { status: "unknown" as Status };
    return (
      <button className={`pathbtn ${p.status}`} aria-pressed={sel === id} onClick={() => setSel(sel === id ? null : id)}
        aria-label={`${label}: ${p.status}`} data-testid={`path-${id}`} title={`${label}: ${p.status}`}>
        <span className="dot" aria-hidden>{ICON[p.status]}</span>{short}<span className="sr-only" style={{ display: "none" }}>{label}</span>
        <span className="tiny">{label}</span>
      </button>
    );
  };

  return (
    <section className="panel" aria-labelledby="topo-h">
      <h2 id="topo-h">Station topology <span className="sub">click a path · each path judged only by its own evidence</span></h2>
      <div className="topo">
        <div className="cams">
          {cams.map((c: any) => (
            <div className="node" key={c.id}>
              <div className="nt"><span>{c.label}</span><span className="nm mono">{c.model} · fw {snap.evidence.length && latest(snap, "versions") ? latest(snap, "versions")!.data.versions.camera_firmware[c.id] : c.firmware}</span></div>
              <div className="nm">{c.role} · {c.vendor}</div>
              <div className="pathbtns">{PATHS.map(([k, label, s]) => <PB key={k} id={`${c.id}-${k}`} label={label} short={s} />)}</div>
            </div>
          ))}
        </div>
        <div className="stack">
          <div className="node">
            <div className="nt"><span>PoE switch</span><span className="nm mono">{dev("sw1")?.model}</span></div>
            <div className="nm">8 ports · uplink to edge host on port 8</div>
            <div className="pathbtns"><PB id="sw-uplink" label="Uplink to host" short="U" /></div>
          </div>
          <div className="node">
            <div className="nt"><span>Line PLC</span></div>
            <div className="nm">24 V trigger per camera · result handshake</div>
            <div className="pathbtns"><PB id="host-plc" label="Result link" short="R" /></div>
          </div>
        </div>
        <div className="stack">
          <div className="node">
            <div className="nt"><span>Edge host</span><span className="nm mono">{dev("host")?.model}</span></div>
            <div className="nm">{snap.station.versions.host_os}<br />{snap.station.versions.acquisition_sdk} · {snap.station.versions.inspection_app}</div>
          </div>
          <div className="node">
            <div className="nt"><span>Plant dashboard</span></div>
            <div className="nm">MQTT over TLS · client certificate</div>
            <div className="pathbtns"><PB id="host-mgmt" label="Management link" short="M" /></div>
          </div>
        </div>
      </div>
      <div className="legend" aria-hidden>
        <span>✓ OK</span><span>! degraded</span><span>✕ failing</span><span>? not checked</span>
        <span>D discovery · C control · S image stream · T trigger · P PoE · U uplink · R result · M management</span>
      </div>
      {sel && selInfo && (
        <div className="pathdetail fadein" data-testid="path-detail">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{sel}</b><StatusChip s={selInfo.status} />
          </div>
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>Protocol</dt><dd>{selConn?.protocol ?? (sel === "sw-uplink" ? "GVSP aggregate (all cameras) → host NIC" : "—")}</dd>
            <dt>Observation</dt><dd>{selInfo.note}{selInfo.after_intervention ? " (after intervention)" : ""}</dd>
            <dt>Evidence</dt><dd>{selInfo.evidence.length ? <EvRefs ids={selInfo.evidence} /> : <span className="muted">none yet — this path has not been checked</span>}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}
