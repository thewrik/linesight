"""SQLite persistence for case state and simulator state."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from .models import CaseState
from .simulator.world import World, world_from_dict, world_to_dict

DB_PATH = Path(os.environ.get("LINESIGHT_DB", Path(__file__).resolve().parents[2] / "var" / "linesight.sqlite"))
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("CREATE TABLE IF NOT EXISTS cases (case_id TEXT PRIMARY KEY, scenario_id TEXT, mode TEXT, rules_version TEXT,"
              " state TEXT NOT NULL, world TEXT NOT NULL, updated TEXT DEFAULT CURRENT_TIMESTAMP)")
    return c


def save(case: CaseState, world: World) -> None:
    with _lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO cases (case_id, scenario_id, mode, rules_version, state, world) VALUES (?,?,?,?,?,?)",
                  (case.case_id, case.scenario_id, case.mode, case.rules_version, case.model_dump_json(), json.dumps(world_to_dict(world))))


def load(case_id: str) -> Optional[tuple[CaseState, World]]:
    with _lock, _conn() as c:
        row = c.execute("SELECT state, world FROM cases WHERE case_id = ?", (case_id,)).fetchone()
    if not row:
        return None
    return CaseState.model_validate_json(row[0]), world_from_dict(json.loads(row[1]))
