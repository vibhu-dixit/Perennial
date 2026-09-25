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
from gardener import apply_within_budget, hygiene, log_edits, make_gardener, validate
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


def run_once(store: Store, gardener=None, now: datetime | None = None, http=None, observe: bool = True) -> dict:
    """One loop. ``observe=False`` when the stream has already stored this loop's observations."""
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

        # 1–2. Observe. User logs and streamed readings are already stored; a one-off loop pulls Nimble itself.
        observations = store.read("observations")
        fresh = [o for o in observations if o["ts"] > since and o["source"] != "seed"]
        if observe:
            external = nimble_adapter.collect(now, loop, plan, observations, **({"http": http} if http else {}))
            store.append("observations", *external)
            fresh += external

        # 3. Your logs are facts — applied first, so the gardener thinks about the garden as it now is.
        facts, _ = validate(plan, {"edits": log_edits(plan, fresh, today)})
        new_plan, applied, refused = apply_within_budget(plan, facts)

        # 4. Rewrite, through the same gate whichever gardener spoke.
        proposed = gardener.propose(new_plan, fresh, today) if fresh else []
        proposed, errors = validate(new_plan, {"edits": proposed})
        new_plan, suggested, refused_more = apply_within_budget(new_plan, proposed)
        applied += suggested
        refused += refused_more
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


class Feed:
    """One live source, polled on its own cadence. ``poll(now, loop, plan)`` returns only new observations."""

    def __init__(self, name: str, every_s: int, poll):
        self.name, self.every_s, self.poll, self.next_at = name, every_s, poll, 0.0


def feeds(store: Store) -> list[Feed]:
    """The live world around the garden. Dedupe state is rebuilt from the store, so a restart never re-posts."""
    obs = store.read("observations")
    last_cond = next((o["content"].get("obs_time") for o in reversed(obs) if o["kind"] == "conditions"), None)
    alert_ids = {o["content"]["alert_id"] for o in obs if o["content"].get("alert_id")}
    urls = {o["content"]["url"] for o in obs if o["content"].get("url")}
    last_fc = next((o["content"]["text"] for o in reversed(obs) if o["kind"] == "forecast"), None)

    def cond(now, loop, plan):
        nonlocal last_cond
        o = nimble_adapter.conditions(now, loop, last_cond)
        if o:
            last_cond = o["content"]["obs_time"]
        return [o] if o else []

    def forecast(now, loop, plan):
        nonlocal last_fc
        o = nimble_adapter.forecast(now, loop)
        if not o or o["content"]["text"] == last_fc:
            return []
        last_fc = o["content"]["text"]
        return [o]

    env = lambda k, d: int(os.environ.get(k, d))  # noqa: E731
    return [
        Feed("conditions", env("PERENNIAL_CONDITIONS_EVERY_S", 120), cond),
        Feed("alerts", env("PERENNIAL_ALERTS_EVERY_S", 60), lambda now, loop, plan: nimble_adapter.alerts(now, loop, alert_ids)),
        Feed("forecast", env("PERENNIAL_FORECAST_EVERY_S", 1800), forecast),
        Feed("news", env("NIMBLE_NEWS_EVERY_S", 1800), lambda now, loop, plan: nimble_adapter.news(now, loop, plan, urls)),
    ]


def stream(store: Store, gardener, think_every_s: int, tick_s: float = 3) -> None:
    """Always on: poll each feed on its cadence, store what's new the moment it lands, and wake the gardener
    at once for anything significant (a user log, an alert, a pest report, a changed forecast, a frosty
    reading). Routine readings are batched into a think at most every ``think_every_s``."""
    live = feeds(store)
    last_think = time.monotonic()
    alive = store.dir / ".stream.alive"  # the UI checks its mtime to know the stream is on
    while True:
        alive.touch()
        now = nimble_adapter.utcnow()
        last = store.last_loop()
        loop = (last["loop"] if last else 0) + 1
        plan = (store.latest_plan() or {}).get("plan", {})
        for f in live:
            if time.monotonic() < f.next_at:
                continue
            f.next_at = time.monotonic() + f.every_s
            try:
                new = f.poll(now, loop, plan)
            except Exception as err:  # one source down never stops the stream
                print(f"[stream] {f.name} failed: {err}", file=sys.stderr)
                continue
            store.append("observations", *new)
            for o in new:
                print(f"[stream] {o['kind']:<10} {o['content']['text'][:110]}", flush=True)

        since = last["ts"] if last else ""
        pending = [o for o in store.read("observations") if o["ts"] > since and o["source"] != "seed"]
        waited = time.monotonic() - last_think
        if pending and (any(nimble_adapter.significant(o) for o in pending) or waited >= think_every_s):
            try:
                report(run_once(store, gardener, observe=False))
            except Exception as err:
                print(f"[perennial] loop failed: {err!r}", file=sys.stderr)
            last_think = time.monotonic()
        sys.stdout.flush()
        time.sleep(tick_s)


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Perennial's autonomous loop")
    parser.add_argument("--once", action="store_true", help="run one loop and exit")
    parser.add_argument("--every", type=int, default=int(os.environ.get("PERENNIAL_LOOP_EVERY_S", "300")),
                        help="with --poll: seconds between loops; when streaming: max seconds routine readings wait")
    parser.add_argument("--poll", action="store_true", help="old behaviour: a full loop every --every seconds")
    args = parser.parse_args()

    store = Store()
    gardener = make_gardener()
    print(f"[perennial] data={store.dir} gardener={gardener.name} rawtree={'on' if store.rawtree else 'off'}"
          f" mode={'once' if args.once else 'poll' if args.poll else 'stream'}", flush=True)
    if not (args.once or args.poll):
        return stream(store, gardener, args.every)
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
