"""Loop tests — failure paths from PDD §12/§13: bad JSON, repair retry, Nimble down, word budget.

    python -m unittest discover -s loop/tests
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402
from gardener import LiquidGardener, RuleGardener, apply_within_budget, hygiene, parse_json, validate  # noqa: E402
from plan import WORD_BUDGET, apply_edit, empty_plan, plan_words  # noqa: E402
from rawtree_store import Store  # noqa: E402

NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)  # a Friday
TODAY = NOW.date()


def garden() -> dict:
    plan = empty_plan()
    plan = apply_edit(plan, {"op": "UPDATE", "target": "beds/bed_6", "after": {"crop": "tomatoes", "stage": "fruiting"}})
    plan = apply_edit(plan, {"op": "ADD", "target": "tasks/t_peppers", "after": {
        "title": "Transplant pepper starts into bed 5", "due": "2026-09-25", "priority": "high", "reason": "starts ready"}})
    return plan


def user_log(text: str, **content) -> dict:
    return {"ts": "2026-09-25T11:00:00.000Z", "source": "user", "kind": content.get("action", "note"),
            "content": {"text": text, **content}, "loop": None}


def cold_forecast() -> dict:
    return {"ts": "2026-09-25T12:00:00.000Z", "source": "nimble", "kind": "forecast",
            "content": {"text": "Thu low 2°C", "provider": "demo", "low": 2, "date": "2026-10-01"}, "loop": 1}


class ApplyEdit(unittest.TestCase):
    def test_add_update_retire(self):
        p = apply_edit(empty_plan(), {"op": "ADD", "target": "threats/aphids", "after": {"kind": "pest", "title": "Aphids", "status": "watching"}})
        p = apply_edit(p, {"op": "UPDATE", "target": "threats/aphids", "after": {"status": "active"}})
        self.assertEqual(p["threats"], [{"kind": "pest", "title": "Aphids", "status": "active", "id": "aphids"}])
        p = apply_edit(p, {"op": "RETIRE", "target": "threats/aphids"})
        self.assertEqual(p["threats"], [])

    def test_lists_and_immutability(self):
        base = empty_plan()
        p = apply_edit(base, {"op": "ADD", "target": "learnings", "after": "Bed 2 waterlogs"})
        p = apply_edit(p, {"op": "UPDATE", "target": "learnings", "before": "Bed 2 waterlogs", "after": "Bed 2 waterlogs — no carrots"})
        self.assertEqual(p["learnings"], ["Bed 2 waterlogs — no carrots"])
        self.assertEqual(base["learnings"], [])


class Validate(unittest.TestCase):
    def test_accepts_good_edits(self):
        edits, errors = validate(garden(), {"edits": [
            {"op": "ADD", "target": "tasks/t_cover", "after": {"title": "Cover peppers", "due": "2026-10-01", "priority": "high", "reason": "frost"}, "reason": "frost risk"},
            {"op": "UPDATE", "target": "beds/bed_5", "after": {"crop": "peppers", "stage": "seedling"}, "reason": "logged"},
            {"op": "KEEP", "target": "tasks/t_peppers", "reason": "still needed"},
        ]})
        self.assertEqual(errors, [])
        self.assertEqual(len(edits), 3)

    def test_rejects_bad_edits_and_keeps_good_ones(self):
        edits, errors = validate(garden(), {"edits": [
            {"op": "DELETE", "target": "tasks/t_peppers", "reason": "x"},
            {"op": "ADD", "target": "beds/bed_7", "after": {}, "reason": "x"},
            {"op": "UPDATE", "target": "beds/bed_1", "after": {"stage": "gigantic"}, "reason": "x"},
            {"op": "ADD", "target": "tasks/t_x", "after": {"title": "No due date"}, "reason": "x"},
            {"op": "RETIRE", "target": "tasks/t_ghost", "reason": "x"},
            {"op": "UPDATE", "target": "tasks/t_peppers", "after": {"priority": "low"}},
            {"op": "RETIRE", "target": "learnings", "before": "not in plan", "reason": "x"},
            {"op": "ADD", "target": "../etc/passwd", "reason": "x"},
            {"op": "RETIRE", "target": "tasks/t_peppers", "reason": "done"},
        ]})
        self.assertEqual(len(errors), 8)
        self.assertEqual([e["target"] for e in edits], ["tasks/t_peppers"])

    def test_rejects_wrong_top_level(self):
        self.assertEqual(validate(garden(), [])[0], [])
        self.assertTrue(validate(garden(), {"changes": []})[1])

    def test_parse_json_tolerates_fences_and_prose(self):
        self.assertEqual(parse_json('```json\n{"edits": []}\n```'), {"edits": []})
        self.assertEqual(parse_json('Sure! {"edits": []} Hope that helps.'), {"edits": []})


class Budget(unittest.TestCase):
    def test_refuses_edits_over_budget(self):
        plan = garden()
        huge = " ".join(["word"] * (WORD_BUDGET + 10))
        plan2, applied, refused = apply_within_budget(plan, [{"op": "ADD", "target": "learnings", "after": huge, "reason": "x"}])
        self.assertEqual(plan2, plan)
        self.assertEqual(applied, [])
        self.assertEqual(len(refused), 1)

    def test_hygiene_trims_oldest_notes_and_stale_items(self):
        plan = garden()
        plan["season_notes"] = [" ".join(["rain"] * 250), " ".join(["sun"] * 250), "newest"]
        plan["tasks"].append({"id": "t_old", "title": "Old", "due": "2026-09-01", "priority": "low", "reason": "x"})
        plan["threats"].append({"id": "gone", "kind": "pest", "title": "Gone", "status": "resolved"})
        edits = hygiene(plan, TODAY)
        targets = [(e["op"], e["target"]) for e in edits]
        self.assertIn(("RETIRE", "tasks/t_old"), targets)
        self.assertIn(("RETIRE", "threats/gone"), targets)
        for e in edits:
            plan = apply_edit(plan, e)
        self.assertLessEqual(plan_words(plan), WORD_BUDGET)
        self.assertIn("newest", plan["season_notes"])


class Liquid(unittest.TestCase):
    GOOD = json.dumps({"edits": [{"op": "UPDATE", "target": "beds/bed_5", "after": {"crop": "peppers", "stage": "seedling"}, "reason": "logged"}]})

    def run_with(self, *replies):
        calls = []

        def chat(messages):
            calls.append(messages)
            r = replies[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r

        return LiquidGardener(chat).propose(garden(), [cold_forecast()], TODAY), calls

    def test_valid_first_try(self):
        edits, calls = self.run_with(self.GOOD)
        self.assertEqual(len(calls), 1)
        self.assertEqual(edits[0]["target"], "beds/bed_5")
        self.assertIn("600 words", calls[0][0]["content"])

    def test_malformed_then_repaired(self):
        edits, calls = self.run_with("sorry, here you go: {edits: [", self.GOOD)
        self.assertEqual(len(calls), 2)
        self.assertIn("failed validation", calls[1][-1]["content"])
        self.assertEqual(len(edits), 1)

    def test_malformed_twice_is_a_noop(self):
        edits, calls = self.run_with("nope", "still nope")
        self.assertEqual((edits, len(calls)), ([], 2))

    def test_api_down_is_a_noop(self):
        edits, _ = self.run_with(OSError("connection refused"))
        self.assertEqual(edits, [])


class Rules(unittest.TestCase):
    def test_planting_peppers_before_a_cold_snap(self):
        log = user_log("Transplanted peppers, bed 5", action="plant", bed="bed_5", crop="peppers")
        edits = RuleGardener().propose(garden(), [log, cold_forecast()], TODAY)
        plan = garden()
        for e in edits:
            plan = apply_edit(plan, e)
        titles = [t["title"] for t in plan["tasks"]]
        self.assertIn("Cover peppers Thu night", titles)
        self.assertIn("Cover tomatoes Thu night", titles)
        self.assertNotIn("Transplant pepper starts into bed 5", titles)  # done — retired
        self.assertEqual(plan["threats"][0]["status"], "active")
        self.assertEqual(validate(garden(), {"edits": edits})[1], [])


    def test_same_crop_in_two_beds_gets_distinct_titles(self):
        plan = apply_edit(garden(), {"op": "UPDATE", "target": "beds/bed_1", "after": {"crop": "tomatoes", "stage": "fruiting"}})
        edits = RuleGardener().propose(plan, [cold_forecast()], TODAY)
        titles = sorted(e["after"]["title"] for e in edits if e["target"].startswith("tasks/"))
        self.assertEqual(titles, ["Cover tomatoes in bed 1 Thu night", "Cover tomatoes in bed 6 Thu night"])


class Loop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name), rawtree=False)
        self.env = mock.patch.dict(os.environ, {"PERENNIAL_DEMO": "1"}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_full_loop_writes_every_table(self):
        self.store.append("plan_versions", {"version": 1, "ts": "2026-09-01T00:00:00.000Z", "loop": 0, "plan": garden()})
        self.store.append("observations", user_log("Transplanted peppers, bed 5", action="plant", bed="bed_5", crop="peppers"))
        result = main.run_once(self.store, RuleGardener(), NOW)
        self.assertEqual(result["version"], 2)
        latest = self.store.latest_plan()
        self.assertEqual(latest["plan"]["beds"][4]["crop"], "peppers")
        self.assertIn("Cover peppers Thu night", [t["title"] for t in latest["plan"]["tasks"]])
        edits = self.store.read("plan_edits")
        self.assertTrue(all(e["reason"] and e["loop"] == 1 for e in edits))
        self.assertEqual(self.store.read("loops")[-1]["edits_count"], len(edits))
        # A second loop sees the same logs as old news and changes nothing.
        again = main.run_once(self.store, RuleGardener(), NOW.replace(minute=5))
        self.assertEqual((again["version"], again["edits_count"]), (2, 0))

    def test_starts_from_an_empty_store(self):
        result = main.run_once(self.store, RuleGardener(), NOW)
        self.assertEqual(result["loop"], 1)
        self.assertEqual(self.store.latest_plan()["plan"]["beds"][0]["id"], "bed_1")

    def test_nimble_down_loop_continues_on_user_logs(self):
        def broken(*_):
            raise OSError("nimble unreachable")

        with mock.patch.dict(os.environ, {"PERENNIAL_DEMO": "0", "GARDEN_LAT": "40", "GARDEN_LON": "-74"}):
            self.store.append("plan_versions", {"version": 1, "ts": "2026-09-01T00:00:00.000Z", "loop": 0, "plan": garden()})
            self.store.append("observations", user_log("Planted kale, bed 1", action="plant", bed="bed_1", crop="kale"))
            result = main.run_once(self.store, RuleGardener(), NOW, http=broken)
        self.assertEqual(result["obs_count"], 1)
        self.assertEqual(self.store.latest_plan()["plan"]["beds"][0]["crop"], "kale")

    def test_bad_liquid_output_never_corrupts_the_plan(self):
        self.store.append("plan_versions", {"version": 1, "ts": "2026-09-01T00:00:00.000Z", "loop": 0, "plan": garden()})
        result = main.run_once(self.store, LiquidGardener(lambda _: "<<garbage>>"), NOW)
        self.assertEqual(result["version"], 1)
        self.assertEqual(self.store.latest_plan()["plan"], garden())
        self.assertEqual(len(self.store.read("loops")), 1)


if __name__ == "__main__":
    unittest.main()
