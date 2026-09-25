"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GardenState, PlanEdit } from "@/lib/types";
import AskGarden from "./AskGarden";
import BedMap from "./BedMap";
import LogDialog from "./LogDialog";
import ThisWeek from "./ThisWeek";
import ThreatWatch from "./ThreatWatch";
import Timeline from "./Timeline";
import Vitals from "./Vitals";
import { Logo, Plus } from "./icons";

const POLL_MS = 5000;

function seasonChip(iso: string) {
  const d = new Date(iso);
  const m = d.getUTCMonth();
  const season = m < 2 || m === 11 ? "Winter" : m < 5 ? "Spring" : m < 8 ? "Summer" : "Autumn";
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((+d - jan1) / 864e5 + new Date(jan1).getUTCDay() + 1) / 7);
  return `${season} ${d.getUTCFullYear()} · Week ${week}`;
}

interface Toast { title: string; edits: PlanEdit[] }

export default function Garden({ initial }: { initial: GardenState }) {
  const [state, setState] = useState(initial);
  const [version, setVersion] = useState<number | null>(null);
  const [logging, setLogging] = useState(false);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(() => Date.now());
  const prev = useRef(initial);

  const refresh = useCallback(async (v: number | null = version) => {
    const res = await fetch(`/api/state${v ? `?version=${v}` : ""}`, { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }, [version]);

  // Live polling — the Python loop may rewrite the plan at any time.
  useEffect(() => {
    const id = setInterval(() => { refresh(); setClock(Date.now()); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Diff plan versions → which beds and tasks just changed (they pulse / glow).
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    // Only live rewrites pulse — scrubbing the timeline is just looking back.
    const live = (s: GardenState) => s.viewing.version === s.current.version;
    if (!live(was) || !live(state)) return;
    const before = was.viewing.plan;
    const after = state.viewing.plan;
    const ids = new Set<string>();
    for (const b of after.beds) {
      const old = before.beds.find((x) => x.id === b.id);
      if (!old || old.crop !== b.crop || old.stage !== b.stage) ids.add(b.id);
    }
    for (const t of after.tasks) if (!before.tasks.some((x) => x.id === t.id)) ids.add(t.id);
    if (!ids.size) return;
    setChanged(ids);
    const t = setTimeout(() => setChanged(new Set()), 4000);
    return () => clearTimeout(t);
  }, [state]);

  const scrub = (v: number | null) => {
    setVersion(v);
    refresh(v);
  };

  async function runLoop(title = "The gardener ran a loop") {
    setRunning(true);
    try {
      const before = state.current.version;
      await fetch("/api/loop", { method: "POST" });
      setVersion(null);
      const res = await fetch("/api/state", { cache: "no-store" });
      const next: GardenState = await res.json();
      setState(next);
      const fresh = next.edits.filter((e) => e.loop === Math.max(...next.edits.map((x) => x.loop)) && next.current.version > before);
      setToast({ title: fresh.length ? `${title} — plan rewrote itself` : `${title} — no changes needed`, edits: fresh });
      setTimeout(() => setToast(null), 7000);
    } finally {
      setRunning(false);
    }
  }

  const { viewing, current } = state;
  const isLive = viewing.version === current.version;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <Logo />
          <div>
            <h1>Perennial</h1>
            <small>the garden that remembers</small>
          </div>
        </div>
        <span className="chip">{seasonChip(state.now)}</span>
        <span className={`chip live${isLive ? "" : " past"}`}>
          <span className="dot" />
          {isLive ? "LIVE" : `PAST · v${viewing.version}`}
        </span>
        <button className="btn terra" onClick={() => setLogging(true)} disabled={running}>
          <Plus size={14} /> Log planting
        </button>
      </header>

      {!isLive && (
        <div className="past-banner" role="status">
          You&apos;re looking at the plan as it was on{" "}
          {new Date(viewing.ts).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} (v{viewing.version}).
          <button className="btn" onClick={() => scrub(null)}>Back to today</button>
        </div>
      )}

      <main className="grid">
        <section className="panel bedmap" aria-labelledby="map-h">
          <div className="panel-head">
            <h2 id="map-h">The garden</h2>
            <span className="count">6 raised beds</span>
            <span className="aside">plan v{viewing.version}</span>
          </div>
          <BedMap beds={viewing.plan.beds} changed={changed} />
          {(viewing.plan.learnings.length > 0 || viewing.plan.season_notes.length > 0) && (
            <div style={{ marginTop: 16, display: "grid", gap: 6 }}>
              <div className="eyebrow">What the garden has learned</div>
              {[...viewing.plan.season_notes, ...viewing.plan.learnings].map((l) => (
                <div key={l} className="serif" style={{ fontSize: "0.98rem", color: "var(--ink-2)" }}>— {l}</div>
              ))}
            </div>
          )}
        </section>

        <div className="stack">
          <ThisWeek tasks={viewing.plan.tasks} edits={state.edits} now={isLive ? state.now : viewing.ts} fresh={changed} />
          <ThreatWatch threats={viewing.plan.threats} edits={state.edits} />
        </div>

        <div className="full">
          <Timeline timeline={state.timeline} harvests={state.harvests} viewing={viewing} live={current.version} onPick={scrub} />
        </div>

        <div className="full">
          <AskGarden recent={state.recentQA} />
        </div>

        <div className="full">
          <Vitals vitals={state.vitals} gardener={state.gardener} clock={clock} onRunLoop={() => runLoop()} running={running} />
        </div>
      </main>

      <p className="footer">Explicit state, ruthless discard, total recall.</p>

      {logging && (
        <LogDialog
          beds={current.plan.beds}
          onClose={() => setLogging(false)}
          onLogged={(text) => {
            setLogging(false);
            runLoop(`Logged “${text}”`);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <b>{toast.title}</b>
          {toast.edits.length > 0 && (
            <ul>
              {toast.edits.slice(0, 6).map((e, i) => (
                <li key={i}>
                  <span className="op">{e.op}</span>
                  {describe(e)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function describe(e: PlanEdit): string {
  const after = e.after as { title?: string; crop?: string } | string | null;
  const label = typeof after === "string" ? after : after?.title ?? (after?.crop ? `${e.target.split("/")[1]} → ${after.crop}` : e.target);
  return `${label} — ${e.reason}`;
}
