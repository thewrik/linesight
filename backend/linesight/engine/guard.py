"""Untrusted-input handling.

Tickets, uploaded logs and retrieved text are data. The guard never grants
permissions; it only records what it found, strips nothing silently, and lets
the engine refuse. Permissions come exclusively from playbook definitions.
"""
from __future__ import annotations

import re
from typing import Any

from ..station import COMPATIBILITY_MATRIX

MAX_TICKET_CHARS = 8000
MAX_LOG_LINES = 2000
MAX_LOG_LINE_CHARS = 500

INSTRUCTION_PATTERNS = [
    r"ignore (all |any )?(previous|prior|above) (instructions|rules)",
    r"\b(system|assistant)\s*:",
    r"you are now",
    r"\b(disregard|override) (the )?(rules|playbook|guard|policy)",
    r"\b(run|execute|call)\b.{0,40}\b(tool|command|firmware|update|flash|script)\b",
    r"\b(on|to) all cameras\b",
    r"approved by (engineering|support|admin)",
    r"<\s*/?\s*(tool|function|instructions?)\s*>",
]
REFERENCE_PATTERNS = [
    r"\b(KB|kb|article|issue|ticket|bulletin)[\s#-]*[A-Z0-9-]{3,}\b",
    r"https?://\S+",
]


def _registered_urls() -> set[str]:
    from .sources import load_sources  # local import: avoid cycle

    return {s["url"].rstrip("/") for s in load_sources()}


def validate_ticket(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("ticket text is empty")
    if len(text) > MAX_TICKET_CHARS:
        raise ValueError(f"ticket longer than {MAX_TICKET_CHARS} characters")
    return text.replace("\x00", "")


def validate_log_lines(lines: list[Any]) -> list[dict[str, Any]]:
    if not isinstance(lines, list) or len(lines) > MAX_LOG_LINES:
        raise ValueError("log upload must be a list of at most %d lines" % MAX_LOG_LINES)
    out = []
    for i, line in enumerate(lines):
        if isinstance(line, str):
            line = {"msg": line}
        if not isinstance(line, dict) or not isinstance(line.get("msg"), str):
            raise ValueError(f"log line {i} malformed")
        out.append({"msg": line["msg"][:MAX_LOG_LINE_CHARS], "source": str(line.get("source", "upload"))[:40],
                    "device": str(line.get("device", "unknown"))[:20], "minutes_ago": float(line.get("minutes_ago", 30))})
    return out


def scan_text(text: str, origin: str) -> list[dict[str, Any]]:
    findings = []
    low = text.lower()
    for pat in INSTRUCTION_PATTERNS:
        m = re.search(pat, low)
        if m:
            findings.append({"type": "embedded_instruction", "origin": origin, "match": text[m.start():m.end()][:80],
                             "action": "treated as data; no permission change"})
    registered = _registered_urls()
    for pat in REFERENCE_PATTERNS:
        for m in re.finditer(pat, text):
            ref = m.group(0).rstrip(".,)")
            if ref.startswith("http") and ref.rstrip("/") in registered:
                continue
            findings.append({"type": "unverified_reference", "origin": origin, "match": ref[:120],
                             "action": "not in source register; not used as evidence or citation"})
    return findings


def check_requested_action(req: dict[str, Any], station_models: dict[str, str]) -> dict[str, Any]:
    """Customer-requested actions are evaluated against the approved catalogue only."""
    if req.get("action") == "firmware_change":
        dev, target = req.get("device"), req.get("target")
        model = station_models.get(dev or "", "")
        allowed = COMPATIBILITY_MATRIX["approved_firmware_changes"].get(model, {})
        ok_targets = {t for ts in allowed.values() for t in ts}
        if target not in ok_targets:
            return {"type": "unsupported_request", "origin": "ticket", "match": f"firmware {target or '?'} on {dev or '?'}",
                    "action": "refused: not an approved firmware transition; requires engineering review"}
        return {"type": "request_noted", "origin": "ticket", "match": f"firmware {target} on {dev}",
                "action": "noted; only applied if a matching playbook is selected by the engine"}
    if req.get("action") == "replacement":
        return {"type": "request_noted", "origin": "ticket", "match": f"replacement of {req.get('device', '?')}",
                "action": "evaluated as a customer assertion, not executed"}
    return {"type": "unsupported_request", "origin": "ticket", "match": str(req)[:80], "action": "refused"}


def validate_tool_proposal(proposal: Any, candidates: dict[str, Any]) -> tuple[str | None, str]:
    """A model may propose a diagnostic; only an unblocked candidate id is accepted."""
    if not isinstance(proposal, dict):
        return None, "proposal not an object"
    did = proposal.get("diagnostic_id")
    if did not in candidates:
        return None, f"proposed '{str(did)[:40]}' is not an allowed candidate"
    if proposal.get("args") not in (None, {}, candidates[did].get("args", {})):
        return None, "proposal tried to change tool arguments"
    return did, "accepted"
