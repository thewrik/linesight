import { useMemo } from "react";
import type { Replay, Snapshot } from "../types";
import { HYP_PLAIN, SYM_ORDER, SYM_PLAIN } from "./plain";

type NodeState = "lit" | "open" | "closed" | "faint";

/**
 * Left-to-right decision tree: the complaint → what it could mean → candidate explanations.
 * Branches close as evidence rules them out; the traveller rests on the deepest lit node.
 */
export default function Tree({ replay, snap, prunedNow, litNow, lens, triggers }: {
  replay: Replay; snap: Snapshot; prunedNow: string[]; litNow: string[]; lens: string; triggers: Record<string, string[]>;
}) {
  const layout = useMemo(() => {
    const ever = new Set<string>();
    for (const f of replay.frames)
      for (const h of f.snapshot.hypotheses) if (h.active || h.status === "supported" || h.status === "confirmed") ever.add(h.rule_id);
    const hyps = replay.frames[0].snapshot.hypotheses.filter((h) => ever.has(h.rule_id));
    const groups = new Map<string, string[]>();
    for (const h of hyps) {
      const t = (triggers[h.rule_id] ?? []).find((x) => SYM_ORDER.includes(x)) ?? "frame_loss";
      groups.set(t, [...(groups.get(t) ?? []), h.rule_id]);
    }
    const seenSym = new Set<string>();
    for (const f of replay.frames) for (const s of f.snapshot.symptoms) seenSym.add(s.tag);
    const level1 = SYM_ORDER.filter((t) => groups.has(t) || seenSym.has(t));
    const rows: { sym: string; leaves: string[] }[] = level1.map((t) => ({ sym: t, leaves: groups.get(t) ?? [] }));
    let y = 24;
    const RH = 24, GAP = 10;
    const pos: Record<string, { x: number; y: number }> = {};
    for (const r of rows) {
      const n = Math.max(1, r.leaves.length);
      r.leaves.forEach((l, i) => (pos[l] = { x: 252, y: y + i * RH }));
      pos[`s:${r.sym}`] = { x: 118, y: y + ((n - 1) * RH) / 2 };
      y += n * RH + GAP;
    }
    const H = y + 4;
    pos.root = { x: 22, y: H / 2 };
    return { rows, pos, H };
  }, [replay, triggers]);

  const symState = (tag: string): NodeState => {
    // a reading that a supported explanation hangs from stays lit, even once the fix has cleared the symptom
    if (layout.rows.find((r) => r.sym === tag)?.leaves.some((l) => hypState(l) === "lit")) return "lit";
    const s = snap.symptoms.find((x) => x.tag === tag);
    if (!s) return "faint";
    if (s.state === "observed" || s.state === "explained") return "lit";
    if (s.state === "cleared") return "closed";
    return "open";
  };
  const hypState = (id: string): NodeState => {
    const h = snap.hypotheses.find((x) => x.rule_id === id)!;
    if (h.status === "supported" || h.status === "confirmed") return "lit";
    if (h.status === "contradicted" || h.status === "refuted_by_verification") return "closed";
    return h.active ? "open" : "faint";
  };

  const { rows, pos, H } = layout;
  // traveller: deepest lit node
  const litLeaf = rows.flatMap((r) => r.leaves).find((l) => hypState(l) === "lit");
  const litSym = rows.find((r) => symState(r.sym) === "lit")?.sym;
  const at = litLeaf ? pos[litLeaf] : litSym ? pos[`s:${litSym}`] : pos.root;

  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, st: NodeState, key: string) => (
    <path key={key} className={`t-edge ${st}`} d={`M${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`} />
  );

  return (
    <svg className="tree" viewBox={`0 0 520 ${H}`} role="img" aria-label="Decision tree: what 'offline' could mean and which explanations remain">
      {rows.map((r) => edge(pos.root, pos[`s:${r.sym}`], symState(r.sym), `e-${r.sym}`))}
      {rows.flatMap((r) => r.leaves.map((l) => {
        const hs = hypState(l), ss = symState(r.sym);
        return edge(pos[`s:${r.sym}`], pos[l], hs === "lit" ? "lit" : hs === "closed" ? "closed" : ss === "closed" ? "closed" : hs, `e-${l}`);
      }))}
      <g className="t-node lit" transform={`translate(${pos.root.x},${pos.root.y})`}>
        <circle r={9} /><text x={0} y={-14} textAnchor="middle" className="t-root">“offline”</text>
      </g>
      {rows.map((r) => {
        const p = pos[`s:${r.sym}`], st = symState(r.sym);
        return (
          <g key={r.sym} className={`t-node ${st}`} transform={`translate(${p.x},${p.y})`}>
            <title>{`${SYM_PLAIN[r.sym]} — ${st}`}</title>
            <rect x={-6} y={-6} width={12} height={12} rx={3} />
            <text x={0} y={-10} textAnchor="middle" className="t-l1">{SYM_PLAIN[r.sym]}</text>
          </g>
        );
      })}
      {rows.flatMap((r) => r.leaves.map((l) => {
        const p = pos[l], st = hypState(l);
        const cls = `t-node leaf ${st} ${prunedNow.includes(l) ? "prune" : ""} ${litNow.includes(l) ? "pulse" : ""}`;
        return (
          <g key={l} className={cls} transform={`translate(${p.x},${p.y})`}>
            <title>{`${l}: ${snap.hypotheses.find((h) => h.rule_id === l)?.title}`}</title>
            <circle r={6} />
            {st === "closed" && <path d="M-3 -3 L3 3 M3 -3 L-3 3" className="t-x" />}
            <text x={12} y={4} className="t-leaf">{lens === "engineer" ? l : HYP_PLAIN[l] ?? l}</text>
          </g>
        );
      }))}
      <g className="traveller" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
        <circle r={13} className="halo" /><circle r={4.5} />
      </g>
    </svg>
  );
}

