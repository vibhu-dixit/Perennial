"use client";

import type { GardenState } from "@/lib/types";
import { ago } from "./why";

export default function Vitals({ vitals, gardener, clock, onRunLoop, running }: {
  vitals: GardenState["vitals"];
  gardener: GardenState["gardener"];
  clock: number;
  onRunLoop: () => void;
  running: boolean;
}) {
  const pct = Math.min(100, (vitals.planWords / vitals.wordBudget) * 100);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <section className="vitals" aria-label="Vitals">
      <div className="vital">
        <div className="n">{fmt(vitals.moments)}</div>
        <div className="l">moments kept</div>
      </div>
      <div className="vital">
        <div className="n">{vitals.planWords}<small> / {vitals.wordBudget}</small></div>
        <div className="l">plan words — still one page</div>
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="vital">
        <div className="n">{fmt(vitals.loops)}</div>
        <div className="l">loops run · last {ago(vitals.lastLoopTs, clock)}</div>
      </div>
      <div className="vital">
        <div className="n">{fmt(vitals.observations)}</div>
        <div className="l">observations · Nimble {ago(vitals.lastNimbleTs, clock)}</div>
      </div>
      <div className="vital">
        <button className="btn ghost" onClick={onRunLoop} disabled={running} style={{ width: "100%" }}>
          {running ? "Thinking…" : "↻ Run loop now"}
        </button>
        <div className="l" style={{ marginTop: 6 }}>{gardener === "python" ? "loop/main.py" : "demo gardener"}</div>
      </div>
    </section>
  );
}
