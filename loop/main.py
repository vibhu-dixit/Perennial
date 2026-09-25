"""The autonomous loop (PDD §5): observe → rewrite the plan → log, every N minutes or on demand.

    python loop/main.py            # run forever, every PERENNIAL_LOOP_EVERY_S seconds (default 300)
    python loop/main.py --once     # one loop, then exit (the UI calls this on demand)

Each loop:
1. Collect user logs since the last loop + fresh Nimble observations.
2. Append the raw observations to ``observations``.
3. Ask the gardener (Liquid AI, or the offline rule gardener) for plan edits.
4. Validate (schema + 600-word budget), apply → new ``plan_versions`` row; every edit
   logged with its reason in ``plan_edits``.
5. Record vitals in ``loops``. The UI re-renders from the latest plan version.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import nimble_adapter
from gardener import apply_within_budget, hygiene, make_gardener, validate
from plan import empty_plan, iso, plan_words
from rawtree_store import Store, load_env


@contextmanager
def loop_lock(store: Store):
    """One loop at a time — the scheduled loop and an on-demand UI loop never interleave."""
    with (store.dir / ".loop.lock").open("w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def run_once(store: Store, gardener=None, now: datetime | None = None, http=None) -> dict:
    gardener = gardener or make_gardener()
    with loop_lock(store):
        started = time.monotonic()
        now = now or datetime.now(timezone.utc)
        today = now.date()

        current = store.latest_plan()
        if current is None:
            current = {"version": 1, "ts": iso(now), "loop": 0, "plan": empty_plan()}
            store.append("plan_versions", current)
        plan = current["plan"]

        last = store.last_loop()
        loop = (last["loop"] if last else 0) + 1
        since = last["ts"] if last else ""

        # 1–2. Observe. User logs are already stored (the UI appends them); Nimble's are new.
        observations = store.read("observations")
        user_logs = [o for o in observations if o["source"] == "user" and o["ts"] > since]
        external = nimble_adapter.collect(now, loop, plan, observations, **({"http": http} if http else {}))
        store.append("observations", *external)
        fresh = user_logs + external

        # 3–4. Rewrite, through the same gate whichever gardener spoke.
        proposed = gardener.propose(plan, fresh, today) if fresh else []
        proposed, errors = validate(plan, {"edits": proposed})
        new_plan, applied, refused = apply_within_budget(plan, proposed)
        new_plan, cleanup, _ = apply_within_budget(new_plan, hygiene(new_plan, today))
        applied += cleanup

        ts = iso(now)
        rows = [{"ts": ts, "loop": loop, "before": None, "after": None, **e} for e in applied]
        changed = any(e["op"] != "KEEP" for e in applied)
        version = current["version"]
        if changed:
            version = max(v["version"] for v in store.read("plan_versions")) + 1
            store.append("plan_versions", {"version": version, "ts": ts, "loop": loop, "plan": new_plan})
        store.append("plan_edits", *rows)

        vitals = {
            "loop": loop,
            "ts": ts,
            "duration_s": round(time.monotonic() - started, 1),
            "obs_count": len(fresh),
            "edits_count": len(applied),
            "plan_words": plan_words(new_plan),
        }
        store.append("loops", vitals)

    return {**vitals, "version": version, "gardener": gardener.name, "edits": applied,
            "rejected": errors + refused}


def report(result: dict) -> None:
    print(f"loop {result['loop']} · {result['gardener']} · {result['obs_count']} obs → {result['edits_count']} edits "
          f"· plan v{result['version']} · {result['plan_words']} words · {result['duration_s']}s")
    for e in result["edits"]:
        after = e.get("after")
        label = after if isinstance(after, str) else (after or {}).get("title") or e["target"]
        print(f"  {e['op']:<7}{label} — {e['reason']}")
    for r in result["rejected"]:
        print(f"  rejected: {r}", file=sys.stderr)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Perennial's autonomous loop")
    parser.add_argument("--once", action="store_true", help="run one loop and exit")
    parser.add_argument("--every", type=int, default=int(os.environ.get("PERENNIAL_LOOP_EVERY_S", "300")),
                        help="seconds between loops (default 300)")
    args = parser.parse_args()

    store = Store()
    gardener = make_gardener()
    print(f"[perennial] data={store.dir} gardener={gardener.name} rawtree={'on' if store.rawtree else 'off'}")
    while True:
        try:
            report(run_once(store, gardener))
        except Exception as err:  # a bad loop never destroys history — log it and try next time
            print(f"[perennial] loop failed: {err!r}", file=sys.stderr)
            if args.once:
                sys.exit(1)
        if args.once:
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
