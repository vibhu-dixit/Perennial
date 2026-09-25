"""Pure plan helpers — a line-for-line port of ui/lib/plan.ts so both sides agree."""

from __future__ import annotations

import copy
from datetime import date, datetime, timedelta, timezone
from typing import Any

WORD_BUDGET = 600
STAGES = ("empty", "seed", "seedling", "vegetative", "flowering", "fruiting", "harvest", "dormant")
LEVELS = ("low", "med", "high")
FROST_TENDER = ("pepper", "tomato", "basil", "squash", "cucumber", "bean", "eggplant", "zucchini")
WEEKDAY = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")  # date.weekday() order
COLLECTIONS = ("beds", "tasks", "threats")
LISTS = ("season_notes", "learnings")


def is_frost_tender(crop: str) -> bool:
    c = crop.lower()
    return any(t in c for t in FROST_TENDER)


def plan_words(plan: Any) -> int:
    """The leanness metric: words across every string in the plan."""
    if isinstance(plan, str):
        return len(plan.split())
    if isinstance(plan, list):
        return sum(plan_words(v) for v in plan)
    if isinstance(plan, dict):
        return sum(plan_words(v) for v in plan.values())
    return 0


def apply_edit(plan: dict, edit: dict) -> dict:
    """Applies one edit (never mutates). Targets: beds/<id>, tasks/<id>, threats/<id>, season_notes, learnings."""
    nxt = copy.deepcopy(plan)
    op = edit["op"]
    if op == "KEEP":
        return nxt
    coll, _, ident = edit["target"].partition("/")

    if coll in COLLECTIONS and ident:
        items = nxt[coll]
        i = next((k for k, x in enumerate(items) if x.get("id") == ident), -1)
        after = edit.get("after") or {}
        if op == "ADD":
            row = {**after, "id": ident}
            if i >= 0:
                items[i] = row
            else:
                items.append(row)
        elif op == "UPDATE" and i >= 0:
            items[i] = {**items[i], **after}
        elif op == "RETIRE" and i >= 0:
            items.pop(i)
        return nxt

    if coll in LISTS:
        items = nxt[coll]
        before, after = edit.get("before"), edit.get("after")
        at = items.index(before) if isinstance(before, str) and before in items else -1
        if op == "ADD" and isinstance(after, str):
            items.append(after)
        elif op == "UPDATE" and at >= 0 and isinstance(after, str):
            items[at] = after
        elif op == "RETIRE" and at >= 0:
            items.pop(at)
    return nxt


def find(plan: dict, target: str) -> Any:
    coll, _, ident = target.partition("/")
    if coll in COLLECTIONS and ident:
        return next((x for x in plan.get(coll, []) if x.get("id") == ident), None)
    return None


def next_weekday(start: date, weekday: int, min_ahead: int = 1) -> date:
    """Next occurrence of weekday (Mon=0 … Thu=3), at least ``min_ahead`` days out."""
    d = start + timedelta(days=min_ahead)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def iso(dt: datetime) -> str:
    """UTC timestamp in the same format as JavaScript's toISOString() — rows compare as strings."""
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def empty_plan() -> dict:
    beds = [
        ("bed_1", "high", "med", "Full sun, loamy"),
        ("bed_2", "med", "low", "Heavy clay, low corner"),
        ("bed_3", "high", "med", "Trellis on north edge"),
        ("bed_4", "high", "med", "Sandy, drains fast"),
        ("bed_5", "high", "high", "Warmest bed, south wall"),
        ("bed_6", "med", "med", "Afternoon shade"),
    ]
    return {
        "beds": [{"id": i, "crop": "", "stage": "empty", "sun": s, "water": w, "note": n} for i, s, w, n in beds],
        "tasks": [],
        "threats": [],
        "season_notes": [],
        "learnings": [],
    }
