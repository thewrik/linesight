# Architecture

```
ticket / logs (untrusted)
        │
        ▼
  guard.py ──────────────► guard events (embedded instructions, unverified references, unsupported requests)
        │
        ▼
  provider.structure_ticket      rules: lexicon parser · replay: stored fixture · live: Anthropic API, fixed schema
        │  (validated TicketStructure; falls back to lexicon on timeout / refusal / schema error)
        ▼
  CaseState ── evidence (customer_assertion) + reported symptom groups
        │
        ▼
┌──────────── Investigator.evaluate() ─────────────┐
│ facts.py     evidence → named facts (+ evidence ids) │
│ symptom_state  observed / cleared per symptom tag    │
│ rules.yaml   hypotheses: support / contradict /      │
│              corroborate predicates over facts       │
│ diagnostics  candidate / blocked / skipped + score   │
│ disposition  stop rule, escalation criteria, budget  │
└──────────────────────────────────────────────────────┘
        │ next_check                    │ intervention options (playbook generator, simulator what-if)
        ▼                               ▼
  World.probe (read-only)         World.apply (only playbook-allowed actions)
  World.technician (simulated)    → verification probes → Verification → confirm / mitigate / refute
        │
        ▼
  snapshot.py → API (FastAPI + SQLite) or static replay JSON → React UI
  report.py   → customer explanation (cited) + engineering handoff (Markdown / JSON)
```

## Boundaries

| Concern | Where | Deterministic? |
|---|---|---|
| Ticket → structured observations | `llm/provider.py`, `llm/intake_rules.py` | lexicon: yes · model: validated against a fixed schema |
| Choosing among the engine's candidate checks | `Investigator._maybe_model_choice` | engine ranks; a model may pick among ties, validated by `guard.validate_tool_proposal` |
| Drafting prose | `report.maybe_model_customer_text` | template by default; model drafts must cite existing evidence ids or are discarded |
| Compatibility, counters, facts | `engine/facts.py`, `station.py` | yes |
| Hypothesis status, next check, disposition | `engine/investigator.py`, `rules/rules.yaml` | yes |
| Permissions | `PlaybookDef.allowed_actions` (validated at load) | yes |
| Interventions and verification | `engine/options.py`, `simulator/world.py` | yes (seeded) |

The model can never add a tool, change tool arguments, apply an action, or change state.

## Entities

`models.py` defines Station, Device, Connection (per functional path), VersionSet, Incident, Evidence,
Hypothesis, Diagnostic, InterventionOption, Intervention, Verification, TraceEntry and CaseState.
Evidence carries provenance, capture time, receive order, scope, parser version and a stable id;
its kind separates observed facts, customer assertions, technician observations and verification.
Facts use the latest *captured* observation per key, so late-arriving older data cannot overwrite newer data.

## Decision procedure

1. **Active hypotheses**: a rule is active when one of its trigger symptoms is observed, or is a possible
   reading of a reported symptom group that has not been cleared.
2. **Status**: supported if every support predicate holds; contradicted if any support predicate is false
   or any contradict predicate holds; otherwise untested (with the missing evidence keys).
3. **Candidates**: checks that would provide missing evidence for an active untested rule, test an open
   symptom, or complete an escalation handoff. Blocked when a prerequisite, test window, technician or
   budget is missing; skipped when irrelevant.
4. **Score**: `(Σ severity of rules tested + 3 × open symptom readings tested + 2 if handoff) / (1 + effort + 2 × disruption)`.
   A transparent heuristic, not a probability.
5. **Stop rule**: at least one rule supported, every observed symptom explained, every reported group
   reproduced or cleared, and escalation handoff evidence collected.
6. **Disposition** (in order): failed verification without an alternative → escalate · two mitigations →
   escalate · supported rule with escalation disposition → escalate · restart-type rule after ≥2
   temporary recoveries → escalate · physical rule with substitution evidence → field service ·
   otherwise the playbook with the highest severity. With nothing left to test: physical rule missing
   only a substitution, or a rule missing only unavailable telemetry → more evidence; unexplained
   symptoms → escalate (“no matching playbook”); every symptom cleared → “no fault reproduced”.

## Simulator

`simulator/world.py` holds hidden state built from injected faults. Probes derive observations from that
state; interventions change it. `simulator/transport.py` is a piecewise-linear burst-queue model (per-camera
send rate set by a throughput limit, shared egress buffer with random background occupancy, resend rounds,
reject-gate deadline). Its assumptions are returned with every stream result and shown in the UI.

## Static build vs API

The GitHub Pages build contains recorded engine snapshots (`frontend/public/data/replays/*.json`) and runs
without a backend. Only the recorded (recommended) intervention can be applied there; other options show their
predicted outcomes. With the API (`uvicorn` or Docker) every step runs live against the simulator, any offered
option can be applied, and the live model mode is available when a key is configured on the server.

## The line simulation in the UI

`frontend/src/sim` draws the packaging line on a canvas and is separate from the Python simulator.

* `scene.ts` reads one recorded snapshot and produces a `Scene`: the line rate, the share of late answers,
  result latency against the reject-gate deadline, which cameras are acquiring, which layers have been
  revealed by evidence so far, and the status of each physical part (derived from rule statuses). A test
  step (low speed, one camera at a time) or a previewed fix overrides those values from that step's
  evidence or the option's prediction. No value is invented in the UI.
* `engine.ts` choreographs the scene in slow motion. For each carton it schedules the camera flashes,
  the packets through the switch, and the answer that races the carton to the gate. Whether a carton is
  late is fixed by the recorded late share; the dots only illustrate it.
* `render.ts` paints back to front in one oblique projection. On small screens the camera moves to the
  part in focus.

The animation is therefore an illustration of the engine's recorded numbers, not a second model.
