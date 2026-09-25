"use client";

import { useRef } from "react";
import type { HarvestMarker, TimelinePoint } from "@/lib/types";
import { Sprout } from "./icons";

// Season timeline: scrub Mar → Oct; past harvests are sprout markers; scrubbing
// shows the plan as it was (from plan_versions).

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];

function frac(ts: string) {
  const y = Number(ts.slice(0, 4));
  const start = Date.UTC(y, 2, 1);
  const end = Date.UTC(y, 10, 1);
  return Math.min(1, Math.max(0, (Date.parse(ts) - start) / (end - start)));
}

function Season({ year, points, harvests, viewing, isLiveYear, onPick }: {
  year: number;
  points: TimelinePoint[];
  harvests: HarvestMarker[];
  viewing: number;
  isLiveYear: boolean;
  onPick: (version: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const here = points.find((p) => p.version === viewing);

  const pickAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = (clientX - r.left) / r.width;
    let best = points[0];
    for (const p of points) if (Math.abs(frac(p.ts) - f) < Math.abs(frac(best.ts) - f)) best = p;
    if (best && best.version !== viewing) onPick(best.version);
  };

  const step = (d: number) => {
    const i = points.findIndex((p) => p.version === viewing);
    const next = points[i < 0 ? (d > 0 ? 0 : points.length - 1) : Math.min(points.length - 1, Math.max(0, i + d))];
    if (next) onPick(next.version);
  };

  return (
    <div
      ref={track}
      className="tl-track"
      role="slider"
      tabIndex={0}
      aria-label={`${year} season plan versions`}
      aria-valuemin={points[0]?.version}
      aria-valuemax={points.at(-1)?.version}
      aria-valuenow={here?.version}
      aria-valuetext={here ? `plan v${here.version}, ${here.ts.slice(0, 10)}` : "not in this season"}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && pickAt(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <span className="tl-season">{year}{isLiveYear ? " · this season" : ""}</span>
      <div className="tl-rail" />
      {here && <div className="tl-fill" style={{ width: `${frac(here.ts) * 100}%` }} />}
      {points.map((p) => (
        <span key={p.version} className="tl-ver" style={{ left: `${frac(p.ts) * 100}%` }} />
      ))}
      {harvests.map((h) => (
        <span key={h.ts} className="tl-sprout" style={{ left: `${frac(h.ts) * 100}%` }} title={`${h.ts.slice(0, 10)} — ${h.text}`}>
          <Sprout size={15} />
        </span>
      ))}
      {MONTHS.map((m, i) => (
        <span key={m} className="tl-tick" style={{ left: `${((i + 0.5) / MONTHS.length) * 100}%` }}>{m}</span>
      ))}
      {here && <span className="tl-thumb" style={{ left: `${frac(here.ts) * 100}%` }} />}
    </div>
  );
}

export default function Timeline({ timeline, harvests, viewing, live, onPick }: {
  timeline: TimelinePoint[];
  harvests: HarvestMarker[];
  viewing: TimelinePoint;
  live: number;
  onPick: (version: number | null) => void;
}) {
  const years = [...new Set(timeline.map((p) => Number(p.ts.slice(0, 4))))].sort();
  const liveYear = Number(timeline.find((p) => p.version === live)?.ts.slice(0, 4));
  const isLive = viewing.version === live;

  return (
    <section className="panel timeline" aria-labelledby="tl-h">
      <div className="panel-head">
        <h2 id="tl-h">Season timeline</h2>
        <span className="count">{timeline.length} plan versions</span>
        <span className="aside">drag to see the plan as it was</span>
      </div>
      <div className="tl-seasons">
        {years.map((y) => (
          <Season
            key={y}
            year={y}
            points={timeline.filter((p) => p.ts.startsWith(String(y)))}
            harvests={harvests.filter((h) => h.ts.startsWith(String(y)))}
            viewing={viewing.version}
            isLiveYear={y === liveYear}
            onPick={(v) => onPick(v === live ? null : v)}
          />
        ))}
      </div>
      <div className="tl-meta">
        <span>
          Showing <b>plan v{viewing.version}</b> ·{" "}
          {new Date(viewing.ts).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
        </span>
        {!isLive && <button className="btn ghost" onClick={() => onPick(null)}>Back to live</button>}
      </div>
    </section>
  );
}
