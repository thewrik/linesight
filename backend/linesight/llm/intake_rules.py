"""Deterministic ticket parser (no model). Lexicon + regex.

This is the 'rules' baseline for intake. It is intentionally simple so the
evaluation can show where messy wording defeats it.
"""
from __future__ import annotations

import re
from typing import Any

PARSER_VERSION = "lexicon-1.4"

GROUP_PATTERNS = {
    "offline": r"\boffline\b|went down|\bdead\b|not working|keeps? dropping|drops? out",
    "missing_images": r"missing images?|no images?|images? (keep )?(disappear|go missing|missing)|divert|reject(ed|s)? cartons?|cartons? (are |get )?(being )?(kicked|diverted|rejected)|manual inspection",
    "cannot_connect": r"can'?no?t connect|cannot connect|won'?t connect|visible but|shows up but|listed but|unable to (open|connect)",
    "intermittent_disconnect": r"disconnect|after (an|about an|one|1) hour|not reliabl|intermittent|randomly|locks? out|lockout",
    "dashboard": r"dashboard|plant screen|\bmes\b|\bscada\b",
    "image_quality": r"streak|stripe|corrupt|garbled|smear|bad images?|lines across",
}
ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4}


def parse_ticket(text: str) -> dict[str, Any]:
    low = text.lower()
    groups = [g for g, pat in GROUP_PATTERNS.items() if re.search(pat, low)]
    devices = []
    for m in re.finditer(r"\bcam(?:era)?\s*#?\s*(\d)\b", low):
        devices.append(f"cam{m.group(1)}")
    for word, n in ORDINALS.items():
        if re.search(rf"\b{word} cam(era)?\b", low):
            devices.append(f"cam{n}")
    devices = list(dict.fromkeys(d for d in devices if d in {"cam1", "cam2", "cam3", "cam4"}))
    dev = devices[0] if devices else None

    claims = []
    if re.search(r"replace(ment)?|send (us )?(a |another )?(new|spare)|swap it out|\brma\b", low):
        claims.append({"claim": "replacement_needed", "device": dev, "text": "the camera needs replacing"})
    if re.search(r"(low|slow|reduced) speed.{0,40}(fine|ok|healthy|works|good)|fine at (low|slow)", low):
        claims.append({"claim": "works_at_low_speed", "text": "works at low speed"})
    if re.search(r"restart(ed|ing)?.{0,60}(fix|help|works again|comes back|recover)", low):
        claims.append({"claim": "restart_helped", "text": "restarting recovers it"})
    if re.search(r"nothing (has )?changed", low):
        claims.append({"claim": "nothing_changed", "text": "nothing changed"})

    requested = []
    m = re.search(r"(downgrade|upgrade|flash|update|roll ?back|install)\b.{0,40}firmware.{0,30}?(\d+\.\d+(?:\.\d+)?)", low) or \
        re.search(r"firmware.{0,20}(to|version)\s*(\d+\.\d+(?:\.\d+)?)", low)
    if m:
        requested.append({"action": "firmware_change", "device": dev, "target": m.group(2)})
    if any(c["claim"] == "replacement_needed" for c in claims):
        requested.append({"action": "replacement", "device": dev})

    restarts = 0
    m = re.search(r"restarted (it |them |the [a-z ]+)?(twice|two times|three times|(\d+) times)", low)
    if m:
        restarts = {"twice": 2, "two times": 2, "three times": 3}.get(m.group(2)) or int(m.group(3) or 0)

    changes = [m.group(0) for m in re.finditer(r"(replaced|swapped|new|changed) (the )?(edge pc|pc|switch|camera|host|computer)", low)]
    refs = re.findall(r"\b(?:kb|article|issue|bulletin)[\s#-]*[a-z0-9-]{3,}\b|https?://\S+", low)
    return {
        "symptom_groups": groups, "devices_mentioned": devices, "claims": claims, "requested_actions": requested,
        "restart_count": restarts, "changes": changes, "cited_references": refs,
    }
