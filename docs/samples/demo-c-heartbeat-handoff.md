# Engineering handoff — CASE-demo-c-heartbeat-1303

> All observations come from LineSight's simulator; no real hardware was touched.

**Disposition:** engineering_escalation · **Resolution:** handed_off · **Rules:** 2026.11.3 · **Mode:** replay

## Why
- H-HEARTBEAT-GAP: Heartbeat gap after idle causes cameras to refuse control (no confirmed root cause). No validated playbook; prepared engineering handoff.

## Station
Fictional contract packager, Plant A — Line 3 — carton labelling (LS-4 label & batch-code inspection)

## Versions [E-004]
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
- 2026-11-07T09:10:00 — Edge PC migrated (EH-200 / Windows 10 → EH-310 / Windows 11) _(customer timeline (assertion))_
- 2026-11-07T14:29:00 — Line idle (no software triggers) — polling at 3 s interval _(app [E-005])_
- 2026-11-07T15:30:00 — GVCP heartbeat WRITEREG after 3.2 s gap; ACK status ACCESS_DENIED from all 4 cameras _(pcap [E-005])_
- 2026-11-07T15:31:00 — Software trigger failed: device not accessible _(app [E-005])_
- 2026-11-07T15:35:00 — Lockout after idle; operator restarted app _(customer timeline (assertion))_
- 2026-11-07T15:39:00 — Application restarted by operator; cameras reconnect _(operator [E-005])_
- 2026-11-08T08:39:00 — Line idle (no software triggers) — polling at 3 s interval _(app [E-005])_
- 2026-11-08T09:40:00 — GVCP heartbeat WRITEREG after 3.2 s gap; ACK status ACCESS_DENIED from all 4 cameras _(pcap [E-005])_
- 2026-11-08T09:41:00 — Software trigger failed: device not accessible _(app [E-005])_
- 2026-11-08T09:45:00 — Lockout after idle; operator restarted app _(customer timeline (assertion))_
- 2026-11-08T09:49:00 — Application restarted by operator; cameras reconnect _(operator [E-005])_
- 2026-11-09T04:29:00 — Line idle (no software triggers) — polling at 3 s interval _(app [E-005])_
- 2026-11-09T05:30:00 — Lockout after idle; operator restarted app _(customer timeline (assertion))_
- 2026-11-09T05:30:00 — GVCP heartbeat WRITEREG after 3.2 s gap; ACK status ACCESS_DENIED from all 4 cameras _(pcap [E-005])_
- 2026-11-09T05:31:00 — Software trigger failed: device not accessible _(app [E-005])_
- 2026-11-09T05:39:00 — Application restarted by operator; cameras reconnect _(operator [E-005])_

## Leading hypotheses
- **H-HEARTBEAT-GAP** Heartbeat gap after idle causes cameras to refuse control (no confirmed root cause) — supported; supporting ['E-005'], contradicting []

## Alternatives for engineering
- Heartbeat thread starvation on the new host (timer resolution / power plan)
- NIC power-saving or energy-efficient Ethernet delaying GVCP packets after idle
- SDK polling interval interacting with the 3 s heartbeat timeout
- Switch or firewall behaviour after idle (less likely: affects all four cameras at once)

## Checks performed
- D-DISC Discovery scan (GVCP broadcast) — evaluated: discriminates 1 hypotheses [E-007]
- D-VER Compare versions against compatibility matrix and known issues — evaluated: discriminates 3 hypotheses [E-004]
- D-TOPO Switch port, PoE and uplink counters — evaluated: discriminates 3 hypotheses, tests 1 open symptom(s) [E-003]
- D-HOST Edge host resources, drivers and settings — evaluated: discriminates 1 hypotheses [E-006]
- D-EVENTS Correlate host, camera, switch and agent events (48 h) — evaluated: discriminates 1 hypotheses, tests 1 open symptom(s) [E-005]
- D-TECH-IDLE Ask technician: does it follow idle periods? — evaluated: discriminates 0 hypotheses [E-008]

## Observations
- [E-001] (customer_assertion, ok, 2026-11-09T06:40:00) Reported: Disconnects intermittently
- [E-002] (customer_assertion, ok, 2026-11-09T06:40:00) Customer says: restarting the inspection app brings them back
- [E-003] (observed, ok, 2026-11-09T06:39:06) uplink egress drops 0/min; buffer 448 KB; CRC none; PoE 19.2/65 W
- [E-004] (observed, ok, 2026-11-09T06:38:12) SDK Kestrel Acquisition SDK 3.2.0; adapters ['vireo-adapter-4.3']; firmware {'cam1': '4.3.2', 'cam2': '4.3.2', 'cam3': '4.3.2', 'cam4': '4.3.2'}; missing adapter: none; known issues: none
- [E-005] (observed, ok, 2026-11-09T06:38:42) 12 events in 48 h
- [E-006] (observed, ok, 2026-11-09T06:38:24) Windows 11 IoT LTSC 24H2, Kestrel Acquisition SDK 3.2.0, CPU p95 34%, image pool 64, migrated from EH-200 / Windows 10 IoT
- [E-007] (observed, ok, 2026-11-09T06:38:12) cam1 found 192.168.10.11; cam2 found 192.168.10.12; cam3 found 192.168.10.13; cam4 found 192.168.10.14
- [E-008] (technician_observation, ok, 2026-11-09T06:40:00) Technician: Happens after breaks / changeovers, roughly an hour without triggers. Not every time.

## Reproduction request
1. Bench: four cameras (same model/firmware) on a PoE switch, host = EH-310 image with Kestrel Acquisition SDK 3.2.0 on Windows 11 IoT LTSC 24H2.
2. Run software-trigger acquisition, then stop triggering for 65 minutes while the SDK polls at 3 s.
3. Capture GVCP (UDP 3956) on the host NIC for the whole idle window; log heartbeat interval per camera.
4. Repeat with power plan 'High performance' and with NIC energy-efficient Ethernet disabled (one change per run).
5. Record whether the first ACCESS_DENIED follows a heartbeat gap > heartbeat timeout (3000 ms).

## Workaround status
Operator restarts recover temporarily (3 so far); not a fix.

## Requested engineering help
Confirm whether the SDK heartbeat thread can be delayed after long idle on Windows 11 hosts, and whether a supported setting addresses the cause (not only a longer timeout).

## Sources (mechanism references, not proof for this site)
- S3: [Troubleshooting (Basler pylon documentation) — entry on 'device is already connected' after a crash](https://docs.baslerweb.com/troubleshooting) — vendor_docs; Scoped to pylon <= 7.0 under a debugger. LineSight's fictional SDK models an analogous scope (SDK < 3.0 with debug heartbeat).
- S6: [GigE Cameras experience Heartbeat timeout after periods of inactivity (basler/pypylon #863)](https://github.com/basler/pypylon/issues/863) — public_issue; One user's setup (pypylon 4.2.0, pylon 10.2.1, Windows 11 24H2). An observation, not a confirmed root cause.
