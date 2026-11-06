// Plain-language layer for the journey. Engineering detail stays one lens away.
import type { Evidence } from "../types";

export const CHECK_Q: Record<string, string> = {
  "D-DISC": "Can the PC still see each camera on the network?",
  "D-CTRL": "Can the PC take control of each camera?",
  "D-VER": "Do the software and camera firmware versions belong together?",
  "D-STREAM-PROD": "At full speed, do complete images arrive in time?",
  "D-STREAM-LOW": "Did the same setup really work at low speed?",
  "D-STREAM-SINGLE": "Does each camera work when it runs alone?",
  "D-TOPO": "What do the network switch's own counters say?",
  "D-HOST": "Is the PC itself struggling or misconfigured?",
  "D-PLC": "Does the line controller's 'take a picture' signal arrive?",
  "D-MGMT": "Is the plant dashboard actually getting updates?",
  "D-EVENTS": "What happened, and in what order?",
  "D-TECH-VIEWER": "Ask the technician: does the camera work in the vendor's own viewer?",
  "D-TECH-SUBST": "Ask the technician: swap the cable — does the fault move with it?",
  "D-TECH-IDLE": "Ask the technician: does it follow idle periods on the line?",
  "D-TECH-CHANGES": "Ask the technician: what changed, and when did it last work?",
};

export const CHECK_SHORT: Record<string, string> = {
  "D-DISC": "Visibility", "D-CTRL": "Control", "D-VER": "Versions", "D-STREAM-PROD": "Full speed",
  "D-STREAM-LOW": "Low speed", "D-STREAM-SINGLE": "One at a time", "D-TOPO": "Switch", "D-HOST": "PC health",
  "D-PLC": "Trigger signal", "D-MGMT": "Dashboard", "D-EVENTS": "Timeline", "D-TECH-VIEWER": "Vendor viewer",
  "D-TECH-SUBST": "Swap test", "D-TECH-IDLE": "Idle pattern", "D-TECH-CHANGES": "What changed",
};

export const HYP_PLAIN: Record<string, string> = {
  "H-BURST": "Cameras talk over each other in bursts",
  "H-HOST-BACKPRESSURE": "The PC can't keep up",
  "H-PERM": "A missing permission on the PC",
  "H-CABLE": "A damaged cable",
  "H-CAMERA-HW": "A faulty camera",
  "H-POE": "Not enough power from the switch",
  "H-ADAPTER": "Software and firmware don't match",
  "H-UNRELEASED-FW": "Unreleased camera firmware",
  "H-SUBNET": "Camera on the wrong network address",
  "H-STALE-LOCK": "A crashed app still holds the camera",
  "H-HEARTBEAT-GAP": "Cameras drop the PC after idle — cause unknown",
  "H-TRAILER": "A vendor quirk needs its setting",
  "H-TRAILER-MISAPPLIED": "A vendor setting applied too widely",
  "H-FW-DEFECT": "A known firmware bug",
  "H-LOCALE": "Regional number format breaks settings",
  "H-PLC-TRIGGER": "The 'take a picture' signal isn't wired through",
  "H-MGMT-CERT": "Dashboard certificate expired",
  "H-MGMT-IDENTITY": "New PC not registered with the dashboard",
};

export const SYM_PLAIN: Record<string, string> = {
  discovery_failure: "Can't be seen", control_failure: "Can't be controlled", frame_loss: "Images lost or late",
  trigger_missing: "Never told to shoot", dashboard_stale: "Dashboard out of date", camera_resets: "Keeps restarting",
  image_quality: "Images look wrong",
};
export const SYM_ORDER = ["discovery_failure", "control_failure", "frame_loss", "trigger_missing", "camera_resets", "dashboard_stale", "image_quality"];

export const DISP_PLAIN: Record<string, { word: string; line: string }> = {
  known_playbook: { word: "Known fix", line: "The evidence matches a fix we know is safe." },
  more_evidence: { word: "One more look", line: "One more observation is needed before recommending anything." },
  engineering_escalation: { word: "Hand to engineering", line: "No known fix is safe to apply, so engineers get a complete, cited case file." },
  field_service: { word: "Send a technician", line: "A controlled test points at a physical part." },
  open: { word: "Investigating", line: "Still checking." },
};

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/** One plain sentence for an observation. */
export function plainResult(e: Evidence): string {
  const d = e.data ?? {};
  if (e.status !== "ok") return "That data source didn't answer — so nothing is concluded from it.";
  switch (e.key) {
    case "stream.production": {
      const bad = Object.entries<any>(d.per_camera ?? {}).filter(([, p]) => p.error).map(([c]) => c);
      if (bad.length) return `${bad.join(", ")} delivers no usable images at all; overall ${pct(d.usable_frame_pct)} of images are usable.`;
      return d.usable_frame_pct >= 99.5
        ? `${pct(d.usable_frame_pct)} of images arrive complete and on time at full speed.`
        : `Only ${pct(d.usable_frame_pct)} of images are usable at full speed — the rest arrive too late for the reject gate.`;
    }
    case "stream.low":
      return d.resend_requests_total > 0
        ? `At low speed ${pct(d.usable_frame_pct)} of images were fine — but the cameras were already re-sending ${d.resend_requests_total.toLocaleString()} lost pieces. An early warning nobody saw.`
        : `At low speed ${pct(d.usable_frame_pct)} of images were usable.`;
    case "stream.single": {
      const bad = Object.entries<any>(d.per_camera ?? {}).filter(([, p]) => p.error || p.usable_frame_pct < 99.5).map(([c]) => c);
      return bad.length ? `Running alone, ${bad.join(", ")} still loses images.` : "Every camera works perfectly when it runs alone. So no camera is broken.";
    }
    case "topology": {
      const crc = Object.entries<any>(d.links ?? {}).filter(([, l]) => l.crc_errors_per_min > 5).map(([c]) => c);
      if (crc.length) return `The switch sees damaged data on ${crc.join(", ")}'s link.`;
      if (d.switch?.poe?.over_budget) return "The switch can't supply enough power when the camera heaters switch on.";
      return d.switch?.uplink_egress_drops_per_min > 0
        ? `The switch is throwing away about ${d.switch.uplink_egress_drops_per_min.toLocaleString()} packets a minute on its single link to the PC.`
        : "Switch links, power and counters look healthy.";
    }
    case "discovery":
      return d.devices?.every((x: any) => x.found && x.subnet_ok) ? "All four cameras are visible on the network."
        : `Visible, but ${d.devices.filter((x: any) => !x.subnet_ok).map((x: any) => x.device).join(", ")} sits on the wrong network address.`;
    case "control": {
      const bad = Object.entries<any>(d.results ?? {}).filter(([, r]) => r.result !== "ok");
      return bad.length ? `${bad.map(([c, r]) => `${c} refuses: ${r.detail}`).join("; ")}.` : "The PC can take control of every camera right now.";
    }
    case "versions": {
      const miss = Object.entries<any>(d.compatibility ?? {}).filter(([, v]) => !v.installed);
      if (miss.length) return miss.map(([c, v]) => `${c} runs firmware ${v.firmware}; the PC has no matching adapter (${v.required_adapter ?? "none released"}).`).join(" ");
      return "Software, adapters and firmware are a known-good combination.";
    }
    case "host":
      return d.permission_errors?.length ? "The PC's acquisition service is being denied access to its fast network driver."
        : d.debug_image_archive ? "The PC is busy archiving debug images and its image buffer is too small."
        : d.migrated_from ? `The PC is healthy, but it was recently migrated from ${d.migrated_from}.` : "The PC has headroom and no permission errors.";
    case "plc": {
      const miss = Object.entries<any>(d.per_camera ?? {}).filter(([, p]) => p.frames_started === 0).map(([c]) => c);
      return miss.length ? `The controller fires, but ${miss.join(", ")} never receives the signal.` : "Every 'take a picture' signal arrives and gets an answer.";
    }
    case "mgmt":
      return d.tls_state === "connected" ? "The dashboard is receiving fresh updates." : `The dashboard is stale: ${d.tls_state}. Inspection itself keeps running.`;
    case "events": {
      const denied = (d.events ?? []).filter((x: any) => /ACCESS_DENIED/.test(x.msg)).length;
      const crash = (d.events ?? []).some((x: any) => /terminated unexpectedly/.test(x.msg));
      if (denied) return `${denied} times in two days, after the line sat idle, all four cameras answered the PC's heartbeat with 'access denied'. No app crash came first.`;
      if (crash) return "The inspection app crashed, and the cameras still thought the old app owned them.";
      return "Nothing unusual in the event timeline.";
    }
    default:
      return e.summary.replace(/^Technician:\s*/, "Technician: ");
  }
}

export function lensCost(effort: number, disruption: number, tech: boolean): string {
  if (tech) return `Needs about ${effort * 5} minutes of the technician's time${disruption ? " and a short pause on the line" : ""} (illustrative: 5 min per effort unit).`;
  if (disruption) return `Needs a test window of roughly ${disruption * 5} minutes on the line (illustrative).`;
  return "Remote and read-only: no line stop, no technician time.";
}
