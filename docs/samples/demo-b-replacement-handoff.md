# Engineering handoff — CASE-demo-b-replacement-1202

> All observations come from LineSight's simulator; no real hardware was touched.

**Disposition:** known_playbook · **Resolution:** resolved_verified · **Rules:** 2026.11.3 · **Mode:** replay

## Why
- All applied interventions passed verification.

## Station
Fictional contract packager, Plant A — Line 3 — carton labelling (LS-4 label & batch-code inspection)

## Versions [E-005]
- host_os: Windows 11 IoT LTSC 24H2
- acquisition_sdk: Kestrel Acquisition SDK 3.2.0
- inspection_app: Meridian Inspect 6.4.1
- adapters: ['vireo-adapter-4.3', 'vireo-adapter-5.0']
- nic_driver: igb 13.0
- camera_firmware: {'cam1': '4.3.2', 'cam2': '4.3.2', 'cam3': '5.0.2', 'cam4': '4.3.2'}
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
- 2026-11-06T15:30:00 — Replacement Vireo GV-16M shipped from spares stock _(customer timeline (assertion))_
- 2026-11-09T06:00:00 — Technician fitted replacement as Camera 3 _(customer timeline (assertion))_
- 2026-11-09T06:15:00 — Camera 3 visible in camera list; connection refused _(customer timeline (assertion))_

## Leading hypotheses
- **H-ADAPTER** Installed camera adapter does not match camera firmware — confirmed; supporting ['E-003', 'E-004', 'E-005'], contradicting []

## Checks performed
- D-DISC Discovery scan (GVCP broadcast) — evaluated: discriminates 2 hypotheses, tests 1 open symptom(s) [E-003]
- D-CTRL Open/release each control channel — evaluated: discriminates 2 hypotheses, tests 1 open symptom(s) [E-004]
- D-VER Compare versions against compatibility matrix and known issues — evaluated: discriminates 2 hypotheses [E-005]
- D-EVENTS Correlate host, camera, switch and agent events (48 h) — evaluated: discriminates 3 hypotheses, tests 1 open symptom(s) [E-002]

## Observations
- [E-001] (customer_assertion, ok, 2026-11-09T06:40:00) Reported: Visible but cannot connect
- [E-002] (observed, ok, 2026-11-09T06:39:12) 0 events in 48 h
- [E-003] (observed, ok, 2026-11-09T06:39:00) cam1 found 192.168.10.11; cam2 found 192.168.10.12; cam3 found 192.168.10.13; cam4 found 192.168.10.14
- [E-004] (observed, ok, 2026-11-09T06:38:12) cam1: ok; cam2: ok; cam3: no_adapter; cam4: ok
- [E-005] (observed, ok, 2026-11-09T06:38:12) SDK Kestrel Acquisition SDK 3.2.0; adapters ['vireo-adapter-4.3']; firmware {'cam1': '4.3.2', 'cam2': '4.3.2', 'cam3': '5.0.2', 'cam4': '4.3.2'}; missing adapter: ['cam3']; known issues: none
- [E-006] (verification, ok, 2026-11-09T06:38:12) after I-1: cam1: ok; cam2: ok; cam3: ok; cam4: ok
- [E-007] (verification, ok, 2026-11-09T06:39:42) after I-1: alone: cam1 100.0%, cam2 100.0%, cam3 100.0%, cam4 100.0%
- [E-008] (verification, ok, 2026-11-09T06:39:12) after I-1: 100.0% usable at 10.0 cartons/s; late 0.0%, incomplete 0.0%, resend requests 0
- [E-009] (verification, ok, 2026-11-09T06:38:06) after I-1: triggers reach all cameras

## Workaround status
Install vireo-adapter-5.0 alongside existing adapters (camera unchanged) → resolved_verified

## Sources (mechanism references, not proof for this site)
- S2: [In-Sight Vision Suite Needs the Correct Adapter Installed for Connecting a Device (Cognex)](https://support.cognex.com/en/help-articles/in-sight-vision-suite-needs-the-correct-adapter-installed-for-connecting-a-device) — vendor_kb; In-Sight Vision Suite devices (article dated 2024-09-15). LineSight models the mechanism with a fictional, authored matrix.
