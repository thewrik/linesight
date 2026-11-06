# Engineering handoff — CASE-demo-a-line-speed-1101

> All observations come from LineSight's simulator; no real hardware was touched.

**Disposition:** known_playbook · **Resolution:** resolved_verified · **Rules:** 2026.11.3 · **Mode:** replay

## Why
- All applied interventions passed verification.

## Station
Fictional contract packager, Plant A — Line 3 — carton labelling (LS-4 label & batch-code inspection)

## Versions 
- host_os: Windows 11 IoT LTSC 24H2
- acquisition_sdk: Kestrel Acquisition SDK 3.2.0
- inspection_app: Meridian Inspect 6.4.1
- adapters: ['vireo-adapter-4.3']
- nic_driver: igb 13.0
- camera_firmware: {'cam1': '4.3.2', 'cam2': '4.3.2', 'cam3': '4.3.2', 'cam4': '4.3.2'}
- plc_program: L3-PKG r27
- mgmt_agent: station-agent 2.1

## Topology
- cam1: Corvid Imaging Vireo GV-16M (camera, Front label)
- cam2: Corvid Imaging Vireo GV-16M (camera, Back label)
- cam3: Corvid Imaging Vireo GV-16M (camera, Batch code (top))
- cam4: Corvid Imaging Vireo GV-16M (camera, Batch code (side))
- sw1: NetPier NP-8L managed PoE (switch)
- host: Meridian EH-310 (edge_host)
- plc: Generic Line controller (plc)
- mgmt: Plant IT Station management broker (mgmt_service)

## Timeline
- 2026-11-07T09:10:00 — Maintenance replaced edge PC (EH-200 → EH-310); inspection profile imported from installer defaults _(customer timeline (assertion))_
- 2026-11-07T13:40:00 — Maintenance replaced PoE switch (NP-8G → NP-8L) _(customer timeline (assertion))_
- 2026-11-07T16:00:00 — Low-speed test run (4 cartons/s): no diversions _(customer timeline (assertion))_
- 2026-11-09T06:05:00 — Production start at 10 cartons/s _(customer timeline (assertion))_
- 2026-11-09T06:12:00 — First diversions for missing images _(customer timeline (assertion))_
- 2026-11-09T06:20:00 — Operator restarted Camera 3 (no change) _(customer timeline (assertion))_
- 2026-11-09T06:31:00 — Operator restarted Camera 3 again (no change) _(customer timeline (assertion))_

## Leading hypotheses
- **H-BURST** Synchronous camera bursts overflow the switch uplink buffer — confirmed; supporting ['E-005', 'E-006', 'E-008', 'E-011'], contradicting []

## Checks performed
- D-CTRL Open/release each control channel — evaluated: discriminates 2 hypotheses [E-007]
- D-STREAM-PROD Production acquisition statistics (all cameras, last 60 s) — evaluated: discriminates 5 hypotheses, tests 2 open symptom(s) [E-005]
- D-STREAM-LOW Low-speed acquisition statistics (weekend run history) — evaluated: discriminates 1 hypotheses [E-008]
- D-STREAM-SINGLE Acquire each camera alone at production trigger rate — evaluated: discriminates 1 hypotheses [E-011]
- D-TOPO Switch port, PoE and uplink counters — evaluated: discriminates 2 hypotheses [E-006]
- D-HOST Edge host resources, drivers and settings — evaluated: discriminates 1 hypotheses [E-010]
- D-PLC PLC trigger / result handshake counters — evaluated: discriminates 1 hypotheses [E-009]

## Observations
- [E-001] (customer_assertion, ok, 2026-11-09T06:40:00) Reported: Camera 'offline' (ambiguous)
- [E-002] (customer_assertion, ok, 2026-11-09T06:40:00) Reported: Images missing / cartons diverted
- [E-003] (customer_assertion, ok, 2026-11-09T06:40:00) Customer says: send a replacement for Camera 3
- [E-004] (customer_assertion, ok, 2026-11-09T06:40:00) Customer says: line looks fine at low speed
- [E-005] (observed, ok, 2026-11-09T06:39:12) 64.33% usable at 10.0 cartons/s; late 35.67%, incomplete 0.0%, resend requests 9012; errors {'TOO_MANY_CONSECUTIVE_RESENDS': 128, 'AUTO_ABORTED': 85}
- [E-006] (observed, ok, 2026-11-09T06:38:00) uplink egress drops 9560/min; buffer 448 KB; CRC none; PoE 19.2/65 W
- [E-007] (observed, ok, 2026-11-09T06:39:06) cam1: ok; cam2: ok; cam3: ok; cam4: ok
- [E-008] (observed, ok, 2026-11-09T06:39:30) 100.0% usable at 4.0 cartons/s; late 0.0%, incomplete 0.0%, resend requests 10160
- [E-009] (observed, ok, 2026-11-09T06:38:06) triggers reach all cameras
- [E-010] (observed, ok, 2026-11-09T06:38:42) Windows 11 IoT LTSC 24H2, Kestrel Acquisition SDK 3.2.0, CPU p95 34%, image pool 64
- [E-011] (observed, ok, 2026-11-09T06:39:30) alone: cam1 100.0%, cam2 100.0%, cam3 100.0%, cam4 100.0%
- [E-012] (verification, ok, 2026-11-09T06:38:06) after I-1: 100.0% usable at 10.0 cartons/s; late 0.0%, incomplete 0.0%, resend requests 0
- [E-013] (verification, ok, 2026-11-09T06:38:30) after I-1: cam1: ok; cam2: ok; cam3: ok; cam4: ok
- [E-014] (verification, ok, 2026-11-09T06:38:18) after I-1: triggers reach all cameras

## Workaround status
Limit each camera to 245 Mb/s (sum fits the 1 Gb/s uplink) → resolved_verified

## Untrusted-input findings
- request_noted in ticket: “replacement of cam3” → evaluated as a customer assertion, not executed

## Sources (mechanism references, not proof for this site)
- S1: [How to: Troubleshoot Lost Packets or Frames While Using GigE Cameras (Basler)](https://docs.baslerweb.com/knowledge/how-to-troubleshoot-lost-packets-or-frames-while-using-gige-cameras) — vendor_kb; GigE Vision cameras in general; NIC steps written for Windows; parameter names vary by model.
- S5: ['The acquisition failed abnormally' with 'Buffer retrieve failed' errors (Cognex)](https://support.cognex.com/en/help-articles/the-acquisition-failed-abnormally-with-buffer-retrieve-failed-errors-on-acquisition) — vendor_kb; Cognex software with the Pleora driver (article dated 2025-03-12). LineSight uses the distinction, not the product.
