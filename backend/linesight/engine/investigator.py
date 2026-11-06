"""The investigation engine: an inspectable decision graph over persistent case state.

The engine owns every state transition, permission and verification. A model
(when configured) can only structure the ticket, propose one of the engine's own
candidate diagnostics, and draft prose; all of it is validated here.
"""
from __future__ import annotations

from typing import Any, Optional

from ..models import (
    Assertion, CaseState, Diagnostic, DiagnosticState, Disposition, Evidence, EvidenceKind, EvidenceStatus,
    Hypothesis, HypothesisStatus, Intervention, PendingQuestion, Resolution, SymptomView, TraceEntry, Verification,
)
from ..rules.loader import DiagnosticDef, HypothesisDef, Predicate, RuleSet
from ..simulator.world import ProbeUnavailable, World
from . import guard
from .facts import FACT_SOURCES, PARSER_VERSION, Fact, derive_facts, symptom_state
from .options import VERIFY_PROBES, evaluate_check, generate_options

SYMPTOM_KEYS = {
    "discovery_failure": ["discovery"], "control_failure": ["control", "events"], "frame_loss": ["stream.production"],
    "trigger_missing": ["plc"], "dashboard_stale": ["mgmt"], "camera_resets": ["topology"], "image_quality": [],
}
# checks that test the requirement or root cause rather than restored service
ROOT_CAUSE_CHECKS = {"crash_recovery", "line_rate"}
SYMPTOM_WEIGHT = 3  # testing a reported symptom directly resolves ambiguity in the complaint itself
LAYER_ORDER = ["D-MGMT", "D-DISC", "D-CTRL", "D-VER", "D-STREAM-PROD", "D-TOPO", "D-STREAM-LOW", "D-STREAM-SINGLE",
               "D-PLC", "D-HOST", "D-EVENTS", "D-TECH-CHANGES", "D-TECH-IDLE", "D-TECH-VIEWER", "D-TECH-SUBST"]
QUESTIONS = {
    "viewer_single": ("Using the vendor viewer on the edge host, does {device} acquire images when it is the only camera running?",
                      ["acquires_ok", "visible_cannot_connect", "not_listed"]),
    "substitution": ("Swap {device}'s patch cable with a known-good spare (same port), run 5 minutes: does the fault stay with the old cable, follow the camera, or disappear?",
                     ["fault_follows_cable", "fault_follows_camera", "no_change"]),
    "idle_pattern": ("Does the disconnect happen after the line has been idle (breaks, changeovers)? Roughly how long idle?",
                     ["after_idle", "no_pattern"]),
    "recent_changes": ("What changed on the station before this started, and when did it last work normally?", ["see_detail"]),
}


def _eval_pred(p: Predicate, facts: dict[str, Fact]) -> Optional[bool]:
    f = facts.get(p.fact)
    if f is None:
        return None
    v = f.value
    op = p.op
    if op == "is_true":
        return bool(v) is True
    if op == "is_false":
        return bool(v) is False
    if op == "nonempty":
        return bool(v)
    if op == "empty":
        return not v
    if op == "contains":
        return p.value in v
    if op == "eq":
        return v == p.value
    if op == "ne":
        return v != p.value
    if op in ("gt", "gte", "lt", "lte"):
        return {"gt": v > p.value, "gte": v >= p.value, "lt": v < p.value, "lte": v <= p.value}[op]
    raise ValueError(op)


class Investigator:
    def __init__(self, case: CaseState, world: World, rules: RuleSet, provider: Any):
        self.case, self.world, self.rules, self.provider = case, world, rules, provider

    # ------------------------------------------------------------------ bookkeeping

    def _next_seq(self) -> int:
        self.case.seq += 1
        return self.case.seq

    def _trace(self, actor: str, action: str, **kw: Any) -> None:
        self.case.trace.append(TraceEntry(seq=self._next_seq(), actor=actor, action=action, **kw))

    def _add_evidence(self, **kw: Any) -> Evidence:
        eid = f"E-{len(self.case.evidence) + 1:03d}"
        e = Evidence(id=eid, received_seq=self._next_seq(), **kw)
        self.case.evidence.append(e)
        return e

    def _scope(self, device: str | None = None) -> dict[str, str]:
        s = {"site": self.case.station.site, "station": self.case.station.id}
        if device:
            s["device"] = device
        return s

    # ------------------------------------------------------------------ intake

    def intake(self, extra_log_lines: list[dict[str, Any]] | None = None) -> None:
        inc = self.case.incident
        text = guard.validate_ticket(inc.ticket_text)
        for f in guard.scan_text(text, "ticket"):
            self.case.guard_events.append(f)
            self._trace("guard", "flagged ticket content", outputs=f)
        structured, meta = self.provider.structure_ticket(text, self.case.station)
        self._trace("model" if meta.get("origin", "").startswith(("live", "recorded")) else "engine",
                    "structure ticket", tool="structure_ticket", inputs={"chars": len(text)},
                    outputs={"structured": structured, "meta": meta},
                    note=meta.get("label", ""))
        self.case.metrics.setdefault("model_calls", []).append({"step": "intake", **meta})
        groups = [g for g in structured.get("symptom_groups", []) if g in self.rules.symptom_groups]
        if not groups:
            groups = ["offline"]
        self.case.reported_groups = groups
        models = {d.id: d.model for d in self.case.station.devices}
        for req in structured.get("requested_actions", []):
            g = guard.check_requested_action(req, models)
            self.case.guard_events.append(g)
            self._trace("guard", "evaluated customer-requested action", outputs=g)
        for g in groups:
            self._add_evidence(key=f"ticket.symptom.{g}", kind=EvidenceKind.customer_assertion,
                               summary=f"Reported: {self.rules.symptom_groups[g].label}", data={"group": g},
                               provenance=f"ticket ({inc.reporter}) via {meta.get('label', 'parser')}",
                               captured_at=inc.reported_at, scope=self._scope(), parser_version=meta.get("parser_version", "n/a"),
                               untrusted_text=True)
        for claim in structured.get("claims", []):
            e = self._add_evidence(key=f"ticket.claim.{claim['claim']}", kind=EvidenceKind.customer_assertion,
                                   summary=f"Customer says: {claim.get('text', claim['claim'])}", data=claim,
                                   provenance=f"ticket ({inc.reporter})", captured_at=inc.reported_at,
                                   scope=self._scope(claim.get("device")), parser_version=meta.get("parser_version", "n/a"),
                                   untrusted_text=True)
            self.case.assertions.append(Assertion(evidence_id=e.id, claim=claim["claim"], device=claim.get("device")))
        self.case.metrics["devices_mentioned"] = structured.get("devices_mentioned", [])
        for c in structured.get("changes", []):
            if c not in inc.changes_reported:
                inc.changes_reported.append(c)
        if extra_log_lines:
            lines = guard.validate_log_lines(extra_log_lines)
            for ln in lines:
                for f in guard.scan_text(ln["msg"], "uploaded log"):
                    self.case.guard_events.append(f)
                    self._trace("guard", "flagged uploaded log line", outputs=f)
            self.world.log_lines += lines
        for ln in self.world.log_lines:
            for f in guard.scan_text(ln["msg"], "station log"):
                if f not in self.case.guard_events:
                    self.case.guard_events.append(f)
        self.case.budget = {"automated_used": 0, "technician_used": 0, "interventions_used": 0, **self.rules.limits}
        self.evaluate()

    # ------------------------------------------------------------------ evaluation

    def _facts(self) -> dict[str, Fact]:
        diag_ev = [e for e in self.case.evidence if e.kind != EvidenceKind.verification]
        return derive_facts(diag_ev, self.case.station)

    def _symptoms(self, facts: dict[str, Fact]) -> dict[str, dict[str, Any]]:
        sym = symptom_state(facts)
        # after an intervention, verification evidence describes the current state
        ver = [e for e in self.case.evidence if e.kind == EvidenceKind.verification]
        if ver:
            vf = derive_facts([e.model_copy(update={"kind": EvidenceKind.observed}) for e in ver], self.case.station)
            for tag, st in symptom_state(vf).items():
                if tag in sym and sym[tag]["state"] == "observed" and st["state"] == "cleared":
                    sym[tag] = {**st, "why": "after intervention: " + st["why"]}
                elif st["state"] == "observed":
                    sym[tag] = {**st, "why": "after intervention: " + st["why"]}
        return sym

    def _group_status(self, sym: dict[str, dict[str, Any]]) -> dict[str, str]:
        out = {}
        for g in self.case.reported_groups:
            alts = self.rules.symptom_groups[g].alternatives
            if any(sym.get(a, {}).get("state") == "observed" for a in alts):
                out[g] = "satisfied"
            elif all(sym.get(a, {}).get("state") == "cleared" for a in alts):
                out[g] = "not_reproduced"
            else:
                out[g] = "open"
        return out

    def _evaluate_hypothesis(self, hd: HypothesisDef, facts: dict[str, Fact], active: bool) -> Hypothesis:
        prev = next((h for h in self.case.hypotheses if h.rule_id == hd.id), None)
        h = Hypothesis(rule_id=hd.id, title=hd.title, family=hd.family, severity=hd.severity, playbook=hd.playbook,
                       disposition_hint=hd.disposition, sources=hd.sources, active=active, alternatives=hd.alternatives)
        unknown = False
        failed = False
        for p in hd.support:
            r = _eval_pred(p, facts)
            ev = facts[p.fact].evidence if p.fact in facts else []
            if r is None:
                unknown = True
                h.missing.append(FACT_SOURCES[p.fact])
                h.reasons.append(f"untested: {p.why}")
            elif r:
                h.supporting += ev
                h.reasons.append(f"✓ {p.why}")
            else:
                failed = True
                h.contradicting += ev
                h.reasons.append(f"✗ not observed: {p.why}")
        contradicted = failed
        for p in hd.contradict:
            r = _eval_pred(p, facts)
            if r:
                contradicted = True
                h.contradicting += facts[p.fact].evidence
                h.reasons.append(f"✗ {p.why}")
        for p in hd.corroborate:
            r = _eval_pred(p, facts)
            if r:
                h.corroborating += facts[p.fact].evidence
                h.reasons.append(f"+ corroborates: {p.why}")
        h.supporting = sorted(set(h.supporting))
        h.contradicting = sorted(set(h.contradicting))
        h.corroborating = sorted(set(h.corroborating))
        h.missing = sorted(set(h.missing))
        if contradicted:
            h.status = HypothesisStatus.contradicted
        elif not unknown:
            h.status = HypothesisStatus.supported
        if prev and prev.status in (HypothesisStatus.confirmed, HypothesisStatus.refuted_by_verification):
            h.status = prev.status
        return h

    def _resolve_device(self, d: DiagnosticDef, facts: dict[str, Fact]) -> Optional[str]:
        if d.device_from == "mentioned_device":
            m = self.case.metrics.get("devices_mentioned") or []
            if m:
                return m[0]
            cf = facts.get("control_fail")
            return sorted(cf.value)[0] if cf and cf.value else None
        if d.device_from == "suspect_physical_device":
            for name in ("crc_cams", "reboot_cams", "single_bad_cams"):
                f = facts.get(name)
                if f and f.value:
                    return f.value[0]
            return None
        return None

    def evaluate(self) -> None:
        case = self.case
        facts = self._facts()
        sym = self._symptoms(facts)
        # reported groups are judged on diagnostic evidence; verification evidence only updates current state
        groups = self._group_status(symptom_state(facts))
        open_alts = {a for g, st in groups.items() if st == "open" for a in self.rules.symptom_groups[g].alternatives
                     if sym.get(a, {}).get("state") != "cleared"}
        observed = {t for t, s in sym.items() if s["state"] == "observed"}
        active_tags = observed | open_alts

        hyps = []
        for hd in self.rules.hypotheses:
            active = bool(set(hd.triggers) & active_tags)
            h = self._evaluate_hypothesis(hd, facts, active)
            if h.status in (HypothesisStatus.supported, HypothesisStatus.confirmed):
                h.active = True
            hyps.append(h)
        case.hypotheses = hyps
        supported = [h for h in hyps if h.status in (HypothesisStatus.supported, HypothesisStatus.confirmed)]
        explained: dict[str, list[str]] = {}
        for h in supported:
            for t in self.rules.hypothesis(h.rule_id).explains:
                explained.setdefault(t, []).append(h.rule_id)

        # symptom view
        views = []
        for tag in sorted(set(sym) | open_alts):
            s = sym.get(tag)
            if s is None:
                views.append(SymptomView(tag=tag, state="reported", why="reported or implied by the ticket; not yet checked"))
            elif s["state"] == "observed" and tag in explained:
                views.append(SymptomView(tag=tag, state="explained", evidence=s["evidence"], why=s["why"], explained_by=explained[tag]))
            else:
                views.append(SymptomView(tag=tag, state=s["state"], evidence=s["evidence"], why=s["why"]))
        case.symptoms = views
        self._evaluate_assertions(facts)

        unexplained = observed - set(explained)
        handoff_needs = set()
        for h in supported:
            hd = self.rules.hypothesis(h.rule_id)
            if hd.disposition == "engineering_escalation":
                have = {e.key for e in case.evidence}
                handoff_needs |= {k for k in hd.handoff_requires if k not in have}

        # ---- diagnostics: evaluated / candidate / skipped / blocked
        have_keys = {e.key: e for e in case.evidence if e.kind != EvidenceKind.verification}
        evaluated_ids = {d.id for d in case.diagnostics if d.state == DiagnosticState.evaluated}
        blocked_once = {d.id: d for d in case.diagnostics if d.state == DiagnosticState.blocked and d.reason.startswith("technician")}
        need_keys: dict[str, list[str]] = {}
        for h in hyps:
            if h.active and h.status == HypothesisStatus.untested:
                for k in h.missing:
                    need_keys.setdefault(k, []).append(h.rule_id)
        for g, st in groups.items():
            if st != "open":
                continue
            for tag in self.rules.symptom_groups[g].alternatives:
                if tag in open_alts:
                    for k in SYMPTOM_KEYS.get(tag, []):
                        # one entry per reported group the tag could explain
                        need_keys.setdefault(k, []).append(f"symptom:{tag}:{g}")
        for k in handoff_needs:
            need_keys.setdefault(k, []).append("handoff")
        b = case.budget
        diags: list[Diagnostic] = []
        prev = {d.id: d for d in case.diagnostics}
        for dd in self.rules.diagnostics:
            p = prev.get(dd.id)
            if p and p.state == DiagnosticState.evaluated:
                diags.append(p)
                continue
            d = Diagnostic(id=dd.id, tool=dd.tool, args=dict(dd.args), title=dd.title, produces=dd.produces, effort=dd.effort,
                           disruption=dd.disruption, requires_technician=dd.requires_technician)
            relevant = [x for k in dd.produces for x in need_keys.get(k, [])]
            stale = any(have_keys.get(k) and have_keys[k].status != EvidenceStatus.ok for k in dd.produces)
            if all(k in have_keys for k in dd.produces) and not stale:
                d.state, d.reason = DiagnosticState.skipped, "evidence already collected"
            elif dd.id in blocked_once:
                d.state, d.reason = DiagnosticState.blocked, blocked_once[dd.id].reason
                d.evidence_ids = blocked_once[dd.id].evidence_ids
            elif not relevant:
                d.state, d.reason = DiagnosticState.skipped, "would not change any active hypothesis or open symptom"
            elif any(r not in evaluated_ids for r in dd.requires):
                d.state = DiagnosticState.blocked
                d.reason = "waiting for " + ", ".join(r for r in dd.requires if r not in evaluated_ids)
            elif dd.needs_test_window and not self.world.state["line"]["test_window"]:
                d.state, d.reason = DiagnosticState.blocked, "needs a test window; customer has not approved one"
            elif dd.requires_technician and b["technician_used"] >= b["max_technician_questions"]:
                d.state, d.reason = DiagnosticState.blocked, "technician-question budget used"
            elif not dd.requires_technician and b["automated_used"] >= b["max_automated_checks"]:
                d.state, d.reason = DiagnosticState.blocked, "automated-check budget used"
            else:
                if dd.device_from:
                    dev = self._resolve_device(dd, facts)
                    if dev is None:
                        d.state, d.reason = DiagnosticState.blocked, "no suspect device identified yet"
                        diags.append(d)
                        continue
                    d.args["device"] = dev
                hyp_ids = sorted({x for x in relevant if x.startswith("H-")})
                sev = sum(self.rules.hypothesis(x).severity for x in hyp_ids)
                sym_n = len({x for x in relevant if x.startswith("symptom:")})
                hand = 2 if "handoff" in relevant else 0
                disc = sev + SYMPTOM_WEIGHT * sym_n + hand
                cost = 1 + dd.effort + 2 * dd.disruption
                d.score = round(disc / cost, 2)
                d.score_detail = {"hypotheses": hyp_ids, "severity_weight": sev, "open_symptoms": sym_n,
                                  "handoff": bool(hand), "effort": dd.effort, "disruption": dd.disruption, "cost": cost}
                d.for_hypotheses = hyp_ids
                d.reason = f"discriminates {len(hyp_ids)} hypotheses" + (f", tests {sym_n} open symptom(s)" if sym_n else "")
            diags.append(d)
        case.diagnostics = diags
        candidates = sorted([d for d in diags if d.state == DiagnosticState.candidate],
                            key=lambda d: (-(d.score or 0), LAYER_ORDER.index(d.id)))

        # ---- disposition
        open_groups = [g for g, st in groups.items() if st == "open"]
        done = bool(supported) and not unexplained and not open_groups and not handoff_needs
        reasons: list[str] = []
        case.next_check = None
        refuted = [h for h in hyps if h.status == HypothesisStatus.refuted_by_verification]
        failed_ver = [v for v in case.verifications if not v.passed]
        mitig = sum(1 for v in case.verifications if v.outcome == Resolution.mitigated)

        if failed_ver and not [h for h in supported if h.status == HypothesisStatus.supported]:
            self._finish(Disposition.engineering_escalation, Resolution.handed_off,
                         [f"Verification failed after {failed_ver[-1].intervention_id}; the fault persists, so the case is not closed.",
                          "No other playbook explains the remaining symptoms."])
            return
        if mitig >= 2:
            self._finish(Disposition.engineering_escalation, Resolution.handed_off,
                         ["Two mitigations restored service only temporarily or below requirement; escalating instead of repeating."])
            return
        if done:
            esc = [h for h in supported if h.disposition_hint == "engineering_escalation"]
            restart = [h for h in supported if "restart_mitigation" in self.rules.hypothesis(h.rule_id).tags]
            phys = [h for h in supported if h.disposition_hint == "field_service"]
            if esc:
                self._finish(Disposition.engineering_escalation, Resolution.handed_off,
                             [f"{h.rule_id}: {h.title}. No validated playbook; prepared engineering handoff." for h in esc])
                return
            if restart and case.incident.prior_temporary_recoveries >= 2:
                self._finish(Disposition.engineering_escalation, Resolution.handed_off,
                             [f"{case.incident.prior_temporary_recoveries} earlier restarts recovered only temporarily; "
                              f"a playbook that releases the lock again would repeat a mitigation ({', '.join(h.rule_id for h in restart)})."])
                return
            if phys:
                self._finish(Disposition.field_service, Resolution.handed_off,
                             [f"{h.rule_id}: controlled substitution supports a physical fault on "
                              f"{self._resolve_device(self.rules.diagnostic('D-TECH-SUBST'), facts) or 'the suspect device'}." for h in phys])
                return
            pending = [h for h in supported if h.status == HypothesisStatus.supported and h.playbook
                       and not any(i.playbook == h.playbook for i in case.interventions if self._resolved(i.id))]
            if pending:
                h = max(pending, key=lambda x: x.severity)
                pb = self.rules.playbook(h.playbook)
                if not case.intervention_options or case.intervention_options[0].playbook != pb.id:
                    case.intervention_options = generate_options(pb, facts, self.world, case.station)
                    self._trace("engine", f"generated options for {pb.id}", tool="retrieve_playbook",
                                inputs={"playbook": pb.id, "hypothesis": h.rule_id},
                                outputs={"options": [o.id for o in case.intervention_options],
                                         "recommended": next((o.id for o in case.intervention_options if o.recommended), None)})
                case.disposition = Disposition.known_playbook
                case.resolution = Resolution.unresolved
                case.disposition_reasons = [f"{h.rule_id} supported by {', '.join(h.supporting)}; no contradicting evidence.",
                                            f"Playbook {pb.id}: {pb.title}. Awaiting approval of a simulated intervention."]
                return
            # all supported playbooks applied and verified
            if all(self._resolution_ok(h) for h in supported):
                res = Resolution.mitigated if mitig else Resolution.resolved_verified
                self._finish(Disposition.known_playbook, res,
                             ["All applied interventions passed verification."
                              + (" One option was a mitigation only." if mitig else "")])
                return

        if candidates:
            nxt = candidates[0]
            nxt = self._maybe_model_choice(candidates) or nxt
            case.next_check = nxt.id
            case.disposition = Disposition.more_evidence if nxt.requires_technician else Disposition.open
            case.disposition_reasons = [f"Next: {nxt.title} (score {nxt.score}; {nxt.reason})."]
            if supported:
                case.disposition_reasons.append("Supported so far: " + ", ".join(h.rule_id for h in supported))
            if unexplained:
                case.disposition_reasons.append("Unexplained observations: " + ", ".join(sorted(unexplained)))
            return

        # nothing left to test
        phys_partial = [h for h in hyps if h.active and h.disposition_hint == "field_service" and h.status == HypothesisStatus.untested
                        and h.missing == ["tech.substitution"]]
        if phys_partial:
            self._finish(Disposition.more_evidence, Resolution.awaiting_customer,
                         [f"{h.rule_id} fits the counters but needs a controlled substitution before any replacement is sent." for h in phys_partial])
            return
        unavailable_keys = {e.key for e in case.evidence if e.status == EvidenceStatus.unavailable}
        blocked_by_missing = [h for h in hyps if h.active and h.status == HypothesisStatus.untested and h.missing
                              and set(h.missing) <= unavailable_keys]
        if blocked_by_missing:
            self._finish(Disposition.more_evidence, Resolution.awaiting_customer,
                         [f"{h.rule_id} fits the available evidence but needs {', '.join(h.missing)}, which is unavailable; "
                          "no diagnosis is made without it. Requested access to that telemetry." for h in blocked_by_missing])
            return
        budget_out = any("budget" in d.reason for d in diags if d.state == DiagnosticState.blocked)
        if unexplained or [g for g in open_groups]:
            why = ["No matching playbook: " + (", ".join(sorted(unexplained)) if unexplained else
                                               ", ".join(self.rules.symptom_groups[g].label for g in open_groups))
                   + " remain unexplained after the applicable checks."]
            if budget_out:
                why.append("Diagnostic budget exhausted.")
            if refuted:
                why.append("Refuted after verification: " + ", ".join(h.rule_id for h in refuted))
            self._finish(Disposition.engineering_escalation, Resolution.handed_off, why)
            return
        if all(st == "not_reproduced" for st in groups.values()) and not observed:
            self._finish(Disposition.more_evidence, Resolution.no_fault_reproduced,
                         ["Every reported symptom was checked and is currently healthy: no fault reproduced.",
                          "This is not the same as 'no matching playbook'. Requested an event capture at the next occurrence."])
            return
        self._finish(Disposition.engineering_escalation, Resolution.handed_off,
                     ["Evidence is incomplete or contradictory and no further permitted check would discriminate."])

    def _verified(self, intervention_id: str) -> bool:
        return any(v.intervention_id == intervention_id and v.passed for v in self.case.verifications)

    def _resolved(self, intervention_id: str) -> bool:
        return any(v.intervention_id == intervention_id and v.outcome == Resolution.resolved_verified for v in self.case.verifications)

    def _resolution_ok(self, h: Hypothesis) -> bool:
        if h.status == HypothesisStatus.confirmed:
            return True
        return False

    def _finish(self, disp: Disposition, res: Resolution, reasons: list[str]) -> None:
        c = self.case
        changed = not c.finished or c.disposition != disp
        c.disposition, c.resolution, c.disposition_reasons = disp, res, reasons
        c.finished, c.next_check, c.pending_question = True, None, None
        if changed:
            self._trace("engine", f"disposition: {disp.value}", outputs={"resolution": res.value, "reasons": reasons})

    def _maybe_model_choice(self, candidates: list[Diagnostic]) -> Optional[Diagnostic]:
        if not hasattr(self.provider, "propose_diagnostic"):
            return None
        ctx = {d.id: {"title": d.title, "score": d.score, "args": d.args} for d in candidates[:5]}
        proposal, meta = self.provider.propose_diagnostic(self.case, ctx)
        if proposal is None:
            return None
        did, verdict = guard.validate_tool_proposal(proposal, ctx)
        self._trace("guard", "validated model tool proposal", inputs={"proposal": proposal}, outputs={"verdict": verdict})
        if did:
            return next(d for d in candidates if d.id == did)
        return None

    # ------------------------------------------------------------------ assertions

    def _evaluate_assertions(self, facts: dict[str, Fact]) -> None:
        for a in self.case.assertions:
            dev = a.device
            if a.claim in ("replacement_needed", "device_dead"):
                disc = facts.get("discovery_missing")
                ctl = facts.get("control_fail")
                single = facts.get("single_bad_cams")
                subst = facts.get("substitution_result")
                if subst and subst.value == "fault_follows_camera":
                    a.status, a.evidence, a.note = "consistent", subst.evidence, "substitution points at the camera"
                elif dev and ((single and dev not in single.value) or (ctl and dev not in ctl.value and disc and dev not in disc.value)):
                    parts, ev = [], []
                    if disc and ctl and dev not in disc.value and dev not in ctl.value:
                        parts.append("answers discovery and opens control")
                        ev += disc.evidence + ctl.evidence
                    if single and dev not in single.value:
                        parts.append("acquires cleanly when run alone")
                        ev += single.evidence
                    a.status, a.evidence = "contradicted", ev
                    a.note = f"{dev} {' and '.join(parts)}; a replacement camera would not address this evidence."
            elif a.claim == "works_at_low_speed":
                low = facts.get("low_usable_pct")
                if low:
                    a.status = "consistent" if low.value >= 99.5 else "contradicted"
                    a.evidence, a.note = low.evidence, f"low-speed history: {low.value}% usable"
            elif a.claim == "restart_helped":
                hb = facts.get("heartbeat_denied_after_gap")
                if hb and hb.value:
                    a.status, a.evidence, a.note = "consistent", hb.evidence, "restarts recover until the next idle-period lockout"
            elif a.claim == "nothing_changed":
                mig = facts.get("host_migrated")
                if mig and mig.value:
                    a.status, a.evidence, a.note = "contradicted", mig.evidence, "host records show a migration"

    # ------------------------------------------------------------------ actions

    def step(self) -> bool:
        """Run the engine's next check. Returns False when nothing ran."""
        case = self.case
        if case.finished or case.pending_question or not case.next_check:
            return False
        d = next(x for x in case.diagnostics if x.id == case.next_check)
        dd = self.rules.diagnostic(d.id)
        if dd.requires_technician:
            q = d.args["question"]
            text, opts = QUESTIONS[q]
            case.pending_question = PendingQuestion(diagnostic_id=d.id, question=text.format(device=d.args.get("device", "the camera")),
                                                    why=d.reason, answer_options=opts)
            case.disposition = Disposition.more_evidence
            self._trace("engine", "requested observation from technician", tool="request_observation",
                        inputs={"diagnostic": d.id, **d.args}, outputs={"question": case.pending_question.question})
            return True
        self._run_probe(d)
        self.evaluate()
        return True

    def _run_probe(self, d: Diagnostic) -> None:
        case = self.case
        case.budget["automated_used"] += 1
        key = d.produces[0]
        try:
            data, status, captured = self.world.probe(d.tool, d.args)
        except ProbeUnavailable as exc:
            e = self._add_evidence(key=key, kind=EvidenceKind.observed, status=EvidenceStatus.unavailable,
                                   summary=str(exc), data={}, provenance=f"tool:{d.tool}", captured_at=self.world.now.isoformat(),
                                   scope=self._scope(), parser_version=PARSER_VERSION)
            d.state, d.reason, d.evidence_ids = DiagnosticState.evaluated, "telemetry unavailable", [e.id]
            self._trace("engine", "ran diagnostic", tool=d.tool, inputs={"diagnostic": d.id, **d.args}, outputs={"status": "unavailable"})
            return
        e = self._add_evidence(key=key, kind=EvidenceKind.observed, status=EvidenceStatus(status), summary=summarize(key, data),
                               data=data, provenance=f"tool:{d.tool} on {self.world.station.id} (simulator {SIM})",
                               captured_at=captured, scope=self._scope(d.args.get("device")), parser_version=PARSER_VERSION)
        d.state, d.evidence_ids = DiagnosticState.evaluated, [e.id]
        if status == "stale":
            d.reason = "returned stale data (captured long before request)"
            if not case.metrics.get(f"refreshed_{d.id}"):
                case.metrics[f"refreshed_{d.id}"] = True
                d.state = DiagnosticState.candidate  # allow one refresh
        self._trace("engine", "ran diagnostic", tool=d.tool, inputs={"diagnostic": d.id, **d.args},
                    outputs={"evidence": e.id, "status": status, "summary": e.summary})

    def answer(self, answer: Optional[str] = None, detail: str = "", simulated: bool = True) -> None:
        case = self.case
        q = case.pending_question
        if q is None:
            raise ValueError("no pending question")
        d = next(x for x in case.diagnostics if x.id == q.diagnostic_id)
        case.budget["technician_used"] += 1
        if simulated or answer is None:
            resp = self.world.technician(d.args["question"], d.args)
        else:
            if answer not in q.answer_options:
                raise ValueError("answer not one of the offered options")
            resp = {"answered": True, "answer": answer, "detail": detail[:500]}
        ok = resp.get("answered", False)
        e = self._add_evidence(key=d.produces[0], kind=EvidenceKind.technician_observation,
                               status=EvidenceStatus.ok if ok else EvidenceStatus.unavailable,
                               summary=f"Technician: {resp.get('detail') or resp.get('answer')}", data=resp,
                               provenance="plant maintenance technician" + (" (simulated)" if simulated else ""),
                               captured_at=self.world.now.isoformat(), scope=self._scope(d.args.get("device")),
                               untrusted_text=not simulated)
        if ok:
            d.state, d.evidence_ids = DiagnosticState.evaluated, [e.id]
        else:
            d.state, d.reason, d.evidence_ids = DiagnosticState.blocked, f"technician unavailable: {resp.get('reason', '')}", [e.id]
        self._trace("technician", "answered observation request", tool="request_observation", inputs={"diagnostic": d.id},
                    outputs={"evidence": e.id, "answer": resp.get("answer")})
        case.pending_question = None
        self.evaluate()

    def apply_option(self, option_id: str, approved_by: str = "support engineer (simulated approval)") -> Verification:
        case = self.case
        opt = next((o for o in case.intervention_options if o.id == option_id), None)
        if opt is None:
            raise ValueError("option not offered by the engine")
        pb = self.rules.playbook(opt.playbook)
        if opt.action not in pb.allowed_actions:
            raise PermissionError(f"{opt.action} not allowed by {pb.id}")
        if case.budget["interventions_used"] >= case.budget["max_interventions"]:
            raise PermissionError("intervention budget used")
        case.budget["interventions_used"] += 1
        case.metrics.setdefault("options_considered", []).append(
            {"playbook": pb.id, "chosen": opt.id, "options": [o.model_dump() for o in case.intervention_options]})
        before = [e.id for e in case.evidence if e.key in ("stream.production", "control", "plc", "mgmt") and e.kind != EvidenceKind.verification]
        note = self.world.apply(opt.action, opt.params)
        iv = Intervention(id=f"I-{len(case.interventions) + 1}", playbook=pb.id, option_id=opt.id, title=opt.title,
                          params=opt.params, applied_at_seq=self._next_seq(), before_evidence=before[-4:])
        case.interventions.append(iv)
        self._trace("simulator", "applied simulated intervention", tool=opt.action,
                    inputs={"option": opt.id, "params": opt.params, "approved_by": approved_by}, outputs={"result": note})
        checks, ev_ids, seen = [], [], {}
        for chk in pb.verify:
            tool, args, key = VERIFY_PROBES[chk]
            sig = (tool, tuple(sorted(args.items())))
            if sig not in seen:
                data, _, captured = self.world.probe(tool, args)
                e = self._add_evidence(key=key, kind=EvidenceKind.verification, summary="after " + iv.id + ": " + summarize(key, data),
                                       data=data, provenance=f"verification:{tool}", captured_at=captured, scope=self._scope(),
                                       parser_version=PARSER_VERSION)
                seen[sig] = (data, e.id)
                ev_ids.append(e.id)
            data, eid = seen[sig]
            ok, detail = evaluate_check(chk, data, case.station, self.world)
            checks.append({"check": chk, "passed": ok, "detail": detail, "evidence": eid})
        passed = all(c["passed"] for c in checks)
        service_ok = all(c["passed"] for c in checks if c["check"] not in ROOT_CAUSE_CHECKS)
        if passed and opt.meets_requirements:
            outcome = Resolution.resolved_verified
        elif service_ok and not opt.meets_requirements:
            # a known mitigation restored service but not the requirement / root cause
            outcome = Resolution.mitigated
        else:
            outcome = Resolution.verification_failed
        ver = Verification(intervention_id=iv.id, passed=passed, checks=checks, evidence_ids=ev_ids, outcome=outcome)
        case.verifications.append(ver)
        self._trace("engine", "verified intervention", tool="verify", inputs={"intervention": iv.id, "checks": pb.verify},
                    outputs={"passed": passed, "outcome": outcome.value})
        for h in case.hypotheses:
            if h.playbook == pb.id and h.status == HypothesisStatus.supported:
                if outcome == Resolution.resolved_verified:
                    h.status = HypothesisStatus.confirmed
                elif outcome == Resolution.verification_failed:
                    h.status = HypothesisStatus.refuted_by_verification
        case.intervention_options = []
        self.evaluate()
        return ver

    # ------------------------------------------------------------------ auto-run (evaluation & replay)

    def run_auto(self, max_steps: int = 40, choose: str = "recommended") -> None:
        for _ in range(max_steps):
            c = self.case
            if c.finished:
                return
            if c.pending_question:
                self.answer(simulated=True)
                continue
            if c.intervention_options:
                rec = next((o for o in c.intervention_options if o.recommended), None) or c.intervention_options[0]
                self.apply_option(rec.id)
                continue
            if not self.step():
                return


SIM = "sim-1.3"


def summarize(key: str, d: dict[str, Any]) -> str:
    try:
        if key == "stream.production" or key == "stream.low":
            return (f"{d['usable_frame_pct']}% usable at {d['line_rate_cps']} cartons/s; late {d.get('late_frame_pct', 0)}%, "
                    f"incomplete {d.get('incomplete_frame_pct', 0)}%, resend requests {d.get('resend_requests_total', 0)}"
                    + (f"; errors {d['errors']}" if d.get("errors") else ""))
        if key == "stream.single":
            return "alone: " + ", ".join(f"{c} {p['usable_frame_pct']}%" + (f" ({p['error']})" if p.get("error") else "")
                                         for c, p in d["per_camera"].items())
        if key == "topology":
            crc = {c: l["crc_errors_per_min"] for c, l in d["links"].items() if l["crc_errors_per_min"]}
            return (f"uplink egress drops {d['switch']['uplink_egress_drops_per_min']}/min; buffer {d['switch']['buffer_kb']} KB; "
                    f"CRC {crc or 'none'}; PoE {d['switch']['poe']['draw_w']}/{d['switch']['poe']['budget_w']} W")
        if key == "discovery":
            return "; ".join(f"{x['device']} {'found' if x['found'] else 'MISSING'} {x['ip']}" + ("" if x["subnet_ok"] else " (wrong subnet)")
                             for x in d["devices"])
        if key == "control":
            return "; ".join(f"{c}: {r['result']}" for c, r in d["results"].items())
        if key == "versions":
            miss = [c for c, v in d["compatibility"].items() if not v["installed"]]
            return (f"SDK {d['versions']['acquisition_sdk']}; adapters {d['versions']['adapters_installed']}; "
                    f"firmware {d['versions']['camera_firmware']}; missing adapter: {miss or 'none'}; "
                    f"known issues: {sorted({k for v in d['known_issues'].values() for k in v} | set(d['sdk_known_issues'])) or 'none'}")
        if key == "host":
            return (f"{d['os']}, {d['sdk']}, CPU p95 {d['cpu_pct_p95']}%, image pool {d['buffer_pool_frames']}"
                    + (f", permission errors: {len(d['permission_errors'])}" if d["permission_errors"] else "")
                    + (", migrated from " + d["migrated_from"] if d["migrated_from"] else ""))
        if key == "plc":
            miss = [c for c, p in d["per_camera"].items() if p["frames_started"] == 0]
            return f"triggers reach all cameras" if not miss else f"no frames started on {miss}"
        if key == "mgmt":
            return f"{d['tls_state']}; last dashboard update {d['last_publish_age_s']} s ago; local acquisition {d['local_acquisition_heartbeat']}"
        if key == "events":
            return f"{len(d['events'])} events in {d['window_h']} h" + (
                f" ({sum(1 for e in d['events'] if e.get('untrusted'))} from untrusted logs)" if any(e.get("untrusted") for e in d["events"]) else "")
    except (KeyError, TypeError):
        pass
    return key
