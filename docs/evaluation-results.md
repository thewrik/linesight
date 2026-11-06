# Evaluation results

_Generated from `eval.json` at 2026-11-06T19:39:36+00:00 (rules 2026.11.3, commit c2a2341). Regenerate with `python -m linesight.eval.run --out frontend/public/data/eval.json && python -m linesight.eval.report_md`._

> Synthetic benchmark. The cases and the rules have the same author, so this is a regression suite for the engine's behaviour, not an estimate of field accuracy or support-time savings. Effort is a synthetic proxy (sum of per-check effort + disruption, +2 per simulated change window).

## Static checklist

| split | n | disp ✓ | resol ✓ | cause ✓ | missed esc | inappr. esc | unsupp. conf. | verified rec. | forbidden act. | checks | tech Qs | effort proxy | p50 ms | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev | 17 | 14 | 2 | 2 | 3 | 0 | 15 | 1/13 | 0 | 9 | 0 | 1.65 | 10.4 | 0.0 |
| heldout | 14 | 7 | 1 | 0 | 5 | 0 | 12 | 1/7 | 0 | 9 | 0 | 1.57 | 10.4 | 0.0 |
| demo | 3 | 2 | 0 | 0 | 1 | 0 | 2 | 0/2 | 0 | 9 | 0 | 1.33 | 10.7 | 0.0 |
| paraphrase | 10 | 6 | 0 | 0 | 4 | 0 | 8 | 0/6 | 0 | 9 | 0 | 1.2 | 10.0 | 0.0 |
| all | 44 | 29 | 3 | 2 | 13 | 0 | 37 | 2/28 | 0 | 9 | 0 | 1.5 | 10.3 | 0.0 |

Failures (43):

- `demo-a-line-speed` (demo): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-BURST'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `demo-b-replacement` (demo): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-ADAPTER'], got known_playbook/unresolved ['checklist:power-cycle']
- `demo-c-heartbeat` (demo): correct_disposition, correct_resolution, cause_named, missed_escalation — expected engineering_escalation/handed_off ['H-HEARTBEAT-GAP'], got more_evidence/no_fault_reproduced []
- `dev-burst-plantb` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-BURST'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-subnet` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-SUBNET'], got known_playbook/unresolved ['checklist:power-cycle']
- `dev-stale-lock` (dev): cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-STALE-LOCK'], got known_playbook/resolved_verified ['checklist:power-cycle']
- `dev-stale-lock-recurrent` (dev): correct_disposition, correct_resolution, cause_named, missed_escalation, unsupported_confident_diagnosis — expected engineering_escalation/handed_off ['H-STALE-LOCK'], got known_playbook/resolved_verified ['checklist:power-cycle']
- `dev-trailer` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-TRAILER'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-fw-defect` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-FW-DEFECT'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-backpressure` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-HOST-BACKPRESSURE'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-perm-linux` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-PERM'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-plc-trigger` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-PLC-TRIGGER'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-cert` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-MGMT-CERT'], got known_playbook/unresolved ['checklist:restart-agent']
- `dev-cable` (dev): correct_disposition, correct_resolution, cause_named, missed_escalation, unsupported_confident_diagnosis — expected field_service/handed_off ['H-CABLE'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `dev-poe` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-POE'], got known_playbook/unresolved ['checklist:power-cycle']
- `dev-unknown-corruption` (dev): correct_disposition, correct_resolution, missed_escalation — expected engineering_escalation/handed_off [], got more_evidence/no_fault_reproduced []
- `dev-adv-injection` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis, guard_ok — expected known_playbook/resolved_verified ['H-ADAPTER'], got known_playbook/unresolved ['checklist:power-cycle']
- `dev-adv-unsupported-fw` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis, guard_ok — expected known_playbook/resolved_verified ['H-ADAPTER'], got known_playbook/unresolved ['checklist:power-cycle']
- `dev-multi-burst-cert` (dev): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-BURST', 'H-MGMT-CERT'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- `ho-burst-plantc-ordinal` (heldout): correct_resolution, cause_named, unsupported_confident_diagnosis — expected known_playbook/resolved_verified ['H-BURST'], got known_playbook/unresolved ['checklist:max-inter-packet-delay']
- … 23 more in `eval.json`

## Rules engine (no model)

| split | n | disp ✓ | resol ✓ | cause ✓ | missed esc | inappr. esc | unsupp. conf. | verified rec. | forbidden act. | checks | tech Qs | effort proxy | p50 ms | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev | 17 | 17 | 17 | 17 | 0 | 0 | 0 | 13/13 | 0 | 4.82 | 0.06 | 2.59 | 11.0 | 0.0 |
| heldout | 14 | 14 | 14 | 12 | 0 | 0 | 0 | 7/7 | 0 | 5.43 | 0.29 | 3 | 7.6 | 0.0 |
| demo | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 2/2 | 0 | 5.67 | 0.33 | 2.67 | 9.9 | 0.0 |
| paraphrase | 10 | 10 | 10 | 10 | 0 | 0 | 0 | 6/6 | 0 | 5.5 | 0.3 | 2.7 | 6.7 | 0.0 |
| all | 44 | 44 | 44 | 42 | 0 | 0 | 0 | 28/28 | 0 | 5.23 | 0.2 | 2.75 | 10.1 | 0.0 |

Failures (2):

- `ho-multi-cert-trigger` (heldout): cause_named — expected known_playbook/resolved_verified ['H-PLC-TRIGGER', 'H-MGMT-CERT'], got known_playbook/resolved_verified ['H-MGMT-CERT']
- `ho-multi-burst-cable` (heldout): cause_named — expected field_service/handed_off ['H-CABLE', 'H-BURST'], got field_service/handed_off ['H-CABLE']

## Rules + replay

| split | n | disp ✓ | resol ✓ | cause ✓ | missed esc | inappr. esc | unsupp. conf. | verified rec. | forbidden act. | checks | tech Qs | effort proxy | p50 ms | cost $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev | 17 | 17 | 17 | 17 | 0 | 0 | 0 | 13/13 | 0 | 4.82 | 0.06 | 2.59 | 10.2 | 0.0 |
| heldout | 14 | 14 | 14 | 12 | 0 | 0 | 0 | 7/7 | 0 | 5.43 | 0.29 | 3 | 9.4 | 0.0 |
| demo | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 2/2 | 0 | 5.67 | 0.33 | 2.67 | 10.0 | 0.0 |
| paraphrase | 10 | 10 | 10 | 10 | 0 | 0 | 0 | 6/6 | 0 | 5.5 | 0.3 | 2.7 | 7.0 | 0.0 |
| all | 44 | 44 | 44 | 42 | 0 | 0 | 0 | 28/28 | 0 | 5.23 | 0.2 | 2.75 | 10.0 | 0.0 |

Failures (2):

- `ho-multi-cert-trigger` (heldout): cause_named — expected known_playbook/resolved_verified ['H-PLC-TRIGGER', 'H-MGMT-CERT'], got known_playbook/resolved_verified ['H-MGMT-CERT']
- `ho-multi-burst-cable` (heldout): cause_named — expected field_service/handed_off ['H-CABLE', 'H-BURST'], got field_service/handed_off ['H-CABLE']

## Rules + live model

Not run: no provider credentials in environment; live model was not evaluated.
