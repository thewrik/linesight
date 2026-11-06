// Turns a recorded engine run (replay frames) into a sequence of gates.
import type { Evidence, Option, Replay, Snapshot } from "../types";
import { CHECK_Q, CHECK_SHORT, HYP_PLAIN, lensCost, plainResult } from "./plain";

export type GateKind = "call" | "check" | "ask" | "choose" | "proof" | "verdict";

export interface Ledger { chose: string; over: string; because: string }

export interface Gate {
  kind: GateKind;
  frame: number; // snapshot shown once this gate is open
  label: string; // short name on the trail
  title: string;
  question: string;
  story: string;
  ruledOut: string[];
  pointing: string[];
  evidence: Evidence[];
  diagnostic?: string;
  cost?: string;
  why?: string;
  options?: Option[];
  chosen?: string;
  ledger: Ledger[];
}

const supportedish = (s: string) => s === "supported" || s === "confirmed";

function transitions(prev: Snapshot, cur: Snapshot) {
  const before = new Map(prev.hypotheses.map((h) => [h.rule_id, h.status]));
  const ruledOut: string[] = [], pointing: string[] = [];
  for (const h of cur.hypotheses) {
    const b = before.get(h.rule_id);
    if (b === h.status) continue;
    if (h.status === "contradicted" && (prev.hypotheses.find((x) => x.rule_id === h.rule_id)?.active || h.active)) ruledOut.push(h.rule_id);
    if (supportedish(h.status) && !supportedish(b ?? "")) pointing.push(h.rule_id);
  }
  return { ruledOut, pointing };
}

const names = (ids: string[]) => ids.map((i) => HYP_PLAIN[i] ?? i);

export function buildGates(r: Replay): Gate[] {
  const F = r.frames;
  const s0 = F[0].snapshot;
  const gates: Gate[] = [];
  const claims = s0.assertions.map((a) => a.claim.replaceAll("_", " "));
  gates.push({
    kind: "call", frame: 0, label: "The call", title: "A ticket arrives",
    question: "What is the customer actually telling us?",
    story: `${s0.incident.reporter} writes in. Read literally, it asks for ${claims.includes("replacement needed") ? "a new camera" : "help"}. LineSight treats every sentence as a claim to test, not an instruction.`,
    ruledOut: [], pointing: [], evidence: s0.evidence.filter((e) => e.kind === "customer_assertion"), ledger: [],
  });

  for (let i = 1; i < F.length; i++) {
    const f = F[i], s = f.snapshot, prev = F[i - 1].snapshot;
    if (f.action.type === "step") {
      const d = prev.diagnostics.find((x) => x.id === f.action.diagnostic)!;
      if (s.pending_question && F[i + 1]?.action.type === "answer") {
        const a = F[i + 1].snapshot;
        const newEv = a.evidence.filter((e) => !prev.evidence.some((p) => p.id === e.id));
        const t = transitions(prev, a);
        gates.push({
          kind: "ask", frame: i + 1, label: CHECK_SHORT[d.id] ?? d.id, title: CHECK_SHORT[d.id] ?? d.title, diagnostic: d.id,
          question: s.pending_question.question, story: newEv.map((e) => e.summary.replace(/^Technician:\s*/, "")).join(" "),
          ...t, evidence: newEv, cost: lensCost(d.effort, d.disruption, true), why: `${d.reason}. Score ${d.score}.`, ledger: [],
        });
        i++;
        continue;
      }
      const newEv = s.evidence.filter((e) => !prev.evidence.some((p) => p.id === e.id));
      const t = transitions(prev, s);
      gates.push({
        kind: "check", frame: i, label: CHECK_SHORT[d.id] ?? d.id, title: CHECK_SHORT[d.id] ?? d.title, diagnostic: d.id,
        question: CHECK_Q[d.id] ?? d.title, story: newEv.map(plainResult).join(" "),
        ...t, evidence: newEv, cost: lensCost(d.effort, d.disruption, d.requires_technician),
        why: `${d.reason}; score ${d.score} (cost ${d.score_detail.cost}).`, ledger: [],
      });
    } else if (f.action.type === "apply") {
      const opts = prev.intervention_options;
      const chosen = f.action.option_id!;
      const c = opts.find((o) => o.id === chosen)!;
      const ledger: Ledger[] = opts.filter((o) => o.id !== chosen).map((o) => ({
        chose: c.title, over: o.title,
        because: o.meets_requirements
          ? `Both meet the requirement; the chosen one leaves ${c.predicted.headroom_ms ?? "more"} ms of timing headroom vs ${o.predicted.headroom_ms ?? "less"} ms${Object.keys(c.params).length < Object.keys(o.params).length ? " and changes fewer settings" : ""}.`
          : o.tradeoff,
      }));
      gates.push({
        kind: "choose", frame: i - 1, label: "Choose a fix", title: "Several fixes — which one?",
        question: "Which change restores the line without trading away what the customer needs?",
        story: `${opts.length} options were tested in a copy of the simulated line before touching anything. ${opts.filter((o) => !o.meets_requirements).length} of them would “work” only by giving up speed or timing — those are mitigations, not fixes.`,
        ruledOut: [], pointing: [], evidence: [], options: opts, chosen, ledger,
      });
      const v = s.verifications[s.verifications.length - 1];
      gates.push({
        kind: "proof", frame: i, label: "Prove it", title: "Did it actually work?",
        question: "Before closing: does the line meet its requirements now?",
        story: v.passed ? "Fresh measurements after the change: every requirement is met. Only now is the case closed." : "The change did not meet the requirements, so the case stays open.",
        ruledOut: [], pointing: [], evidence: s.evidence.filter((e) => v.evidence_ids.includes(e.id)), ledger: [],
      });
    }
  }

  const last = F[F.length - 1].snapshot;
  const ledger: Ledger[] = [];
  for (const a of last.assertions.filter((x) => x.status === "contradicted")) {
    ledger.push({ chose: "Investigate first", over: `act on “${a.claim.replaceAll("_", " ")}”`, because: a.note });
  }
  const lead = last.hypotheses.filter((h) => supportedish(h.status) || h.status === "refuted_by_verification");
  if (last.disposition === "engineering_escalation") {
    ledger.push({ chose: "Hand to engineering with evidence", over: "another restart or a longer timeout",
      because: `${last.incident.prior_temporary_recoveries} restarts already brought it back only temporarily; a timeout change would hide the symptom, not explain it.` });
  }
  if (last.disposition === "known_playbook" && last.diagnostics.some((d) => d.state === "skipped")) {
    const skipped = last.diagnostics.filter((d) => d.state === "skipped" && d.reason.startsWith("would not")).length;
    if (skipped) ledger.push({ chose: "Stop when the evidence is sufficient", over: `running ${skipped} more checks`, because: "every observed symptom was already explained; extra checks would cost technician time without changing the decision." });
  }
  gates.push({
    kind: "verdict", frame: F.length - 1, label: "Verdict", title: "The decision",
    question: "So what was it — and what happens next?",
    story: lead.length ? `${names(lead.map((h) => h.rule_id)).join(" + ")}.` : "No rule explains it — which is itself a finding.",
    ruledOut: [], pointing: lead.map((h) => h.rule_id), evidence: [], ledger,
  });
  return gates;
}

/** Business context derived from simulator outputs plus clearly stated conversions. */
export function impact(s: Snapshot) {
  const rate = s.station.requirements.line_rate_cps;
  const prodObs = [...s.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "observed" && e.status === "ok");
  const prodVer = [...s.evidence].reverse().find((e) => e.key === "stream.production" && e.kind === "verification");
  const diverted = (e?: Evidence) => (e ? Math.round(rate * 3600 * (1 - e.data.usable_frame_pct / 100)) : undefined);
  const checks = s.diagnostics.filter((d) => d.state === "evaluated");
  const tech = checks.filter((d) => d.requires_technician);
  return {
    rate,
    divertedBefore: diverted(prodObs),
    divertedAfter: diverted(prodVer),
    checks: checks.length,
    techMinutes: tech.reduce((n, d) => n + d.effort * 5, 0),
    lineStopMinutes: checks.reduce((n, d) => n + d.disruption * 5, 0) + s.interventions.length * 10,
    replacementAvoided: s.assertions.some((a) => a.claim === "replacement_needed" && a.status === "contradicted"),
    restarts: s.incident.prior_temporary_recoveries,
  };
}
