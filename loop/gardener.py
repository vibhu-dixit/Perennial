"""The head gardener: turns (current plan + new observations) into validated plan edits.

* LiquidGardener — the real thing (PDD §7): Liquid AI returns ONLY JSON edits,
  validated against a strict schema; malformed output gets one repair retry,
  then falls back to "no changes this loop". The plan is never corrupted.
* RuleGardener — deterministic stand-in used when no Liquid AI endpoint is set, so
  the loop and the demo still work offline. Same inputs, same outputs.

Both run through the same validator and word-budget gate before anything is applied.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from datetime import date, timedelta
from typing import Any, Callable

from plan import LEVELS, STAGES, WEEKDAY, WORD_BUDGET, apply_edit, find, is_frost_tender, plan_words

OPS = ("KEEP", "UPDATE", "RETIRE", "ADD")
PRIORITIES = ("low", "med", "high")
THREAT_KINDS = ("frost", "pest", "disease", "weather", "soil")
THREAT_STATUS = ("watching", "active", "resolved")
BED_FIELDS = {"crop", "stage", "planted", "sun", "water", "note"}
TASK_FIELDS = {"title", "due", "priority", "reason"}
THREAT_FIELDS = {"kind", "title", "status", "reason"}
TARGET = re.compile(r"^(?:(beds|tasks|threats)/([a-z0-9][a-z0-9_\-]{0,48})|(season_notes|learnings))$")
MAX_EDITS = 20

SCHEMA = """Return ONLY a JSON object, no prose, no code fences:
{"edits": [{"op": "ADD"|"UPDATE"|"RETIRE"|"KEEP",
            "target": "beds/<bed_id>" | "tasks/<task_id>" | "threats/<threat_id>" | "season_notes" | "learnings",
            "after": <object or string, see below>,
            "before": <string — only for UPDATE/RETIRE of season_notes/learnings: the exact existing line>,
            "reason": "<why, under 20 words>",
            "evidence": "<the observation text that caused this edit, if any>"}]}
Rules:
- beds: UPDATE only (6 fixed beds). after ⊆ {crop, stage, planted (YYYY-MM-DD), sun, water, note};
  stage ∈ empty|seed|seedling|vegetative|flowering|fruiting|harvest|dormant; sun/water ∈ low|med|high.
- tasks: ADD needs after={title, due (YYYY-MM-DD), priority (low|med|high), reason}; new ids like "t_cover_peppers".
  RETIRE tasks that are done or stale.
- threats: ADD needs after={kind (frost|pest|disease|weather|soil), title, status (watching|active|resolved), reason}.
  Move status watching → active → resolved with UPDATE.
- season_notes / learnings: ADD after="<one line>". Compress: replace many specific notes with one general one.
  Promote what actually worked into learnings. Retire stale notes.
- Every edit needs a reason. Keep the whole plan under 600 words. If nothing needs to change, return {"edits": []}."""

SYSTEM = (
    "You are the head gardener of a home vegetable garden with 6 raised beds. Given the current plan and new "
    "observations, return ONLY JSON edits per the schema; keep the plan under 600 words; every edit needs a reason. "
    "Retire what is stale, promote what worked, protect crops from threats."
)


# ── validation ────────────────────────────────────────────────────────────
def _is_date(v: Any) -> bool:
    try:
        date.fromisoformat(v)
        return True
    except (TypeError, ValueError):
        return False


def _check_fields(after: Any, allowed: set[str], required: set[str] = frozenset()) -> str | None:
    if not isinstance(after, dict):
        return "after must be an object"
    extra = set(after) - allowed
    if extra:
        return f"unknown fields {sorted(extra)}"
    missing = required - set(after)
    if missing:
        return f"missing fields {sorted(missing)}"
    if any(not isinstance(v, str) for v in after.values()):
        return "all fields must be strings"
    return None


def validate(plan: dict, payload: Any) -> tuple[list[dict], list[str]]:
    """Checks model output against the schema. Returns (valid edits, errors). Invalid edits are dropped."""
    if not isinstance(payload, dict) or not isinstance(payload.get("edits"), list):
        return [], ['top level must be {"edits": [...]}']
    edits, errors = [], []
    seen: set[str] = set()
    for n, e in enumerate(payload["edits"][:MAX_EDITS]):
        err = _validate_one(plan, e)
        if not err and _is_noop(plan, e):
            continue  # an UPDATE that changes nothing — small models echo the plan back
        if not err and e["op"] != "KEEP" and e["target"] not in ("season_notes", "learnings"):
            err = f"duplicate edit to {e['target']}" if e["target"] in seen else None
            seen.add(e["target"])
        if err:
            errors.append(f"edit {n}: {err}")
        else:
            edits.append({k: e[k] for k in ("op", "target", "after", "before", "reason", "evidence") if k in e})
    if len(payload["edits"]) > MAX_EDITS:
        errors.append(f"too many edits (max {MAX_EDITS})")
    return edits, errors


def _is_noop(plan: dict, e: dict) -> bool:
    current = find(plan, e["target"]) if e["op"] == "UPDATE" else None
    return isinstance(current, dict) and isinstance(e.get("after"), dict) and all(
        current.get(k) == v for k, v in e["after"].items())


def _validate_one(plan: dict, e: Any) -> str | None:
    if not isinstance(e, dict):
        return "edit must be an object"
    op, target, after = e.get("op"), e.get("target"), e.get("after")
    if op not in OPS:
        return f"op must be one of {OPS}"
    if not isinstance(target, str) or not TARGET.match(target):
        return f"bad target {target!r}"
    if not isinstance(e.get("reason"), str) or not e["reason"].strip() or len(e["reason"]) > 240:
        return "reason required (≤240 chars)"
    if "evidence" in e and not isinstance(e["evidence"], str):
        return "evidence must be a string"
    if op == "KEEP":
        return None
    m = TARGET.match(target)
    coll, ident, lst = m.group(1), m.group(2), m.group(3)
    exists = find(plan, target) is not None

    if coll == "beds":
        if op != "UPDATE":
            return "beds are fixed — UPDATE only"
        if not exists:
            return f"no bed {ident}"
        err = _check_fields(after, BED_FIELDS)
        if err:
            return err
        if "stage" in after and after["stage"] not in STAGES:
            return f"stage must be one of {STAGES}"
        for k in ("sun", "water"):
            if k in after and after[k] not in LEVELS:
                return f"{k} must be one of {LEVELS}"
        if after.get("planted") and not _is_date(after["planted"]):
            return "planted must be YYYY-MM-DD"
        return None

    if coll in ("tasks", "threats"):
        fields, required = (TASK_FIELDS, TASK_FIELDS) if coll == "tasks" else (THREAT_FIELDS, {"kind", "title", "status"})
        if op in ("UPDATE", "RETIRE") and not exists:
            return f"no {coll[:-1]} {ident}"
        if op == "ADD" and exists:
            return f"{coll[:-1]} {ident} already exists — UPDATE it instead"
        if op == "ADD" and any(x.get("title", "").lower() == str(after.get("title", "") if isinstance(after, dict) else "").lower()
                               for x in plan.get(coll, [])):
            return f"a {coll[:-1]} with that title already exists"
        if op == "RETIRE":
            return None
        if op == "UPDATE" and isinstance(after, dict) and after.get("title") and any(
                x.get("id") != ident and x.get("title", "").lower() == str(after["title"]).lower() for x in plan.get(coll, [])):
            return f"another {coll[:-1]} already has that title"
        err = _check_fields(after, fields, required if op == "ADD" else frozenset())
        if err:
            return err
        if coll == "tasks":
            if "due" in after and not _is_date(after["due"]):
                return "due must be YYYY-MM-DD"
            if "priority" in after and after["priority"] not in PRIORITIES:
                return f"priority must be one of {PRIORITIES}"
        else:
            if "kind" in after and after["kind"] not in THREAT_KINDS:
                return f"kind must be one of {THREAT_KINDS}"
            if "status" in after and after["status"] not in THREAT_STATUS:
                return f"status must be one of {THREAT_STATUS}"
        return None

    # season_notes / learnings
    items = plan.get(lst, [])
    if op in ("UPDATE", "RETIRE") and e.get("before") not in items:
        return "before must be an exact existing line"
    if op in ("ADD", "UPDATE") and (not isinstance(after, str) or not after.strip() or len(after) > 240):
        return "after must be one line (≤240 chars)"
    return None


def apply_within_budget(plan: dict, edits: list[dict]) -> tuple[dict, list[dict], list[str]]:
    """Applies edits in order; any edit that would push the plan over budget is refused."""
    applied, refused = [], []
    for e in edits:
        nxt = apply_edit(plan, e)
        if plan_words(nxt) > WORD_BUDGET and plan_words(nxt) > plan_words(plan):
            refused.append(f"{e['op']} {e['target']}: over {WORD_BUDGET}-word budget")
            continue
        if e["op"] != "KEEP":
            e = {**e, "before": e.get("before", find(plan, e["target"]))}
        plan = nxt
        applied.append(e)
    return plan, applied, refused


def hygiene(plan: dict, today: date) -> list[dict]:
    """The discard boundary, enforced every loop whatever the gardener said."""
    edits = []
    stale = (today - timedelta(days=2)).isoformat()
    titles: set[str] = set()
    for t in plan.get("tasks", []):
        if t.get("due", "9999") < stale:
            edits.append({"op": "RETIRE", "target": f"tasks/{t['id']}", "reason": "Stale — past due"})
        elif t.get("title", "").lower() in titles:
            edits.append({"op": "RETIRE", "target": f"tasks/{t['id']}", "reason": "Duplicate of another task"})
        titles.add(t.get("title", "").lower())
    for t in plan.get("threats", []):
        if t.get("status") == "resolved":
            edits.append({"op": "RETIRE", "target": f"threats/{t['id']}", "reason": "Resolved — archived"})
    words, notes = plan_words(plan), list(plan.get("season_notes", []))
    while words > WORD_BUDGET and notes:
        oldest = notes.pop(0)
        edits.append({"op": "RETIRE", "target": "season_notes", "before": oldest, "reason": "Over word budget — oldest note archived"})
        words -= len(oldest.split())
    return edits


# ── gardeners ───────────────────────────────────────────────────────────
Chat = Callable[[list[dict]], str]


def edit_schema(plan: dict) -> dict:
    """JSON schema for the edits, tight enough for a small local model: llama.cpp turns it into a grammar,
    so the model can only emit targets and fields the validator accepts (ids of existing items are enums)."""
    text = {"type": "string", "minLength": 1, "maxLength": 200}
    new_id = "^[a-z][a-z0-9_]{2,40}$"
    date_ = {"type": "string", "pattern": r"^20[0-9]{2}-[01][0-9]-[0-3][0-9]$"}

    def obj(props: dict, required: list[str]) -> dict:
        return {"type": "object", "properties": props, "required": required, "additionalProperties": False}

    def edit(op: str, target: dict, **extra: dict) -> dict:
        props = {"op": {"const": op}, "target": target, **extra, "reason": text, "evidence": text}
        return obj(props, ["op", "target", *extra, "reason"])

    def existing(coll: str) -> dict:
        ids = [f"{coll}/{x['id']}" for x in plan.get(coll, [])]
        return {"enum": ids} if ids else {"const": f"{coll}/none"}

    task = {"title": text, "due": date_, "priority": {"enum": list(PRIORITIES)}, "reason": text}
    threat = {"kind": {"enum": list(THREAT_KINDS)}, "title": text, "status": {"enum": list(THREAT_STATUS)}, "reason": text}
    bed = {"crop": text, "stage": {"enum": list(STAGES)}, "planted": date_, "sun": {"enum": list(LEVELS)},
           "water": {"enum": list(LEVELS)}, "note": text}
    lines = {"enum": list(plan.get("season_notes", [])) + list(plan.get("learnings", []))} if (
        plan.get("season_notes") or plan.get("learnings")) else text
    options = [
        edit("ADD", {"type": "string", "pattern": new_id.replace("^", "^tasks/t_")}, after=obj(task, list(task))),
        edit("ADD", {"type": "string", "pattern": new_id.replace("^", "^threats/")}, after=obj(threat, ["kind", "title", "status"])),
        edit("ADD", {"enum": ["season_notes", "learnings"]}, after=text),
        edit("UPDATE", existing("beds"), after=obj(bed, [])),
        edit("UPDATE", existing("tasks"), after=obj(task, [])),
        edit("UPDATE", existing("threats"), after=obj(threat, [])),
        edit("UPDATE", {"enum": ["season_notes", "learnings"]}, before=lines, after=text),
        edit("RETIRE", {"anyOf": [existing("tasks"), existing("threats")]}),
        edit("RETIRE", {"enum": ["season_notes", "learnings"]}, before=lines),
    ]
    return obj({"edits": {"type": "array", "maxItems": 8, "items": {"anyOf": options}}}, ["edits"])


def liquid_chat(messages: list[dict], schema: dict | None = None) -> str:
    """One OpenAI-compatible chat completion against Liquid AI (a local llama-server by default; key optional)."""
    base, key = os.environ["LIQUID_API_BASE"].rstrip("/"), os.environ.get("LIQUID_API_KEY")
    body = json.dumps({
        "model": os.environ.get("LIQUID_MODEL") or "LFM2.5-VL-1.6B",
        "temperature": 0.1,
        "max_tokens": 1500,
        "response_format": {"type": "json_schema", "json_schema": {"name": "edits", "schema": schema}} if schema
        else {"type": "json_object"},
        "messages": messages,
    }).encode()
    headers = {"content-type": "application/json"}
    if key:
        headers["authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{base}/chat/completions", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())["choices"][0]["message"]["content"]


def parse_json(text: str) -> Any:
    """Parses model output, tolerating code fences or prose around one JSON object."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


class LiquidGardener:
    name = "liquid"

    def __init__(self, chat: Chat | None = None):
        self.chat = chat

    def propose(self, plan: dict, observations: list[dict], today: date) -> list[dict]:
        obs = "\n".join(f"- [{o['source']}/{o['kind']}] {o['content']['text']}" for o in observations) or "- (none)"
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"TODAY: {today.isoformat()} ({WEEKDAY[today.weekday()]})\n\n"
                                        f"CURRENT PLAN ({plan_words(plan)} words):\n{json.dumps(plan, ensure_ascii=False)}\n\n"
                                        f"NEW OBSERVATIONS:\n{obs}\n\n{SCHEMA}"},
        ]
        chat = self.chat or (lambda m: liquid_chat(m, edit_schema(plan)))
        for attempt in (1, 2):  # one repair retry, then no-op
            try:
                reply = chat(messages)
            except Exception as err:
                print(f"[gardener] Liquid AI call failed: {err}", file=sys.stderr)
                return []
            try:
                edits, errors = validate(plan, parse_json(reply))
            except (json.JSONDecodeError, ValueError) as err:
                edits, errors = [], [f"not valid JSON: {err}"]
            if not errors:
                return edits
            print(f"[gardener] attempt {attempt}: {len(errors)} schema error(s): {errors[:3]}", file=sys.stderr)
            if attempt == 1:
                messages += [
                    {"role": "assistant", "content": reply},
                    {"role": "user", "content": "Your reply failed validation:\n- " + "\n- ".join(errors[:8]) +
                                                "\nReturn the corrected JSON object only."},
                ]
        # Keep the edits that were valid on the repair attempt; drop the rest.
        return edits


class RuleGardener:
    """Deterministic stand-in for offline runs (mirrors the UI's demo gardener)."""

    name = "rules"

    def propose(self, plan: dict, observations: list[dict], today: date) -> list[dict]:
        edits: list[dict] = []
        work = plan

        def add(e: dict) -> None:
            nonlocal work
            edits.append(e)
            work = apply_edit(work, e)

        for o in observations:
            if o["source"] != "user":
                continue
            c = o["content"]
            bed, crop, action = c.get("bed"), c.get("crop"), c.get("action")
            if not bed or find(work, f"beds/{bed}") is None:
                continue
            if action == "plant" and crop:
                add({"op": "UPDATE", "target": f"beds/{bed}", "after": {"crop": crop, "stage": "seedling", "planted": today.isoformat()},
                     "reason": "Logged planting", "evidence": c["text"]})
                stem = crop.lower().rstrip("s")
                done = next((t for t in work["tasks"] if stem in t["title"].lower()
                             and re.search(r"transplant|sow|plant", t["title"], re.I)), None)
                if done:
                    add({"op": "RETIRE", "target": f"tasks/{done['id']}", "reason": "Done — logged by you", "evidence": c["text"]})
            elif action == "harvest":
                add({"op": "UPDATE", "target": f"beds/{bed}", "after": {"crop": "", "stage": "empty"},
                     "reason": "Logged harvest", "evidence": c["text"]})

        for o in observations:
            c = o["content"]
            if o["kind"] != "forecast" or not isinstance(c.get("low"), (int, float)) or c["low"] > 3 or not c.get("date"):
                continue
            day = date.fromisoformat(c["date"])
            wd = WEEKDAY[day.weekday()]
            threat = f"frost_{c['date']}"
            if find(work, f"threats/{threat}") is None:
                add({"op": "ADD", "target": f"threats/{threat}", "reason": "Forecast near freezing", "evidence": c["text"],
                     "after": {"kind": "frost", "title": f"Cold snap {wd} night ({c['low']}°C)", "status": "active",
                               "reason": f"forecast low {c['low']}°C"}})
            for bed in work["beds"]:
                if not bed.get("crop") or not is_frost_tender(bed["crop"]):
                    continue
                tid = f"t_cover_{bed['id']}_{c['date']}"
                twins = sum(b.get("crop") == bed["crop"] for b in work["beds"]) > 1
                where = f" in bed {bed['id'][4:]}" if twins else ""
                if find(work, f"tasks/{tid}") is None:
                    add({"op": "ADD", "target": f"tasks/{tid}", "evidence": c["text"],
                         "reason": f"{bed['crop']} in bed {bed['id'][4:]} are frost-tender",
                         "after": {"title": f"Cover {bed['crop']}{where} {wd} night", "due": c["date"], "priority": "high",
                                   "reason": f"frost risk {c['low']}°C {wd}"}})
        return edits


def make_gardener() -> LiquidGardener | RuleGardener:
    if os.environ.get("LIQUID_API_BASE"):
        return LiquidGardener()
    return RuleGardener()
