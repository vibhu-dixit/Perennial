"use client";

import type { LiveState, Observation } from "@/lib/types";
import { ago } from "./why";

/** A streamed row as the feed shows it: observations as-is, gardener loops as a synthetic event. */
export type FeedEvent = Omit<Observation, "source"> & { source: Observation["source"] | "gardener"; key: string };

const SOURCE: Record<string, { label: string; cls: string }> = {
  "open-meteo": { label: "weather", cls: "sage" },
  nws: { label: "NWS alert", cls: "terra" },
  nimble: { label: "Nimble", cls: "gold" },
  demo: { label: "demo", cls: "" },
  user: { label: "you", cls: "ink" },
  gardener: { label: "gardener", cls: "ink" },
};

function badge(o: FeedEvent) {
  const provider = o.source === "user" ? "user" : o.source === "gardener" ? "gardener" : String(o.content.provider ?? o.source);
  return SOURCE[provider] ?? { label: provider, cls: "" };
}

export default function LiveFeed({ live, events, clock }: { live: LiveState; events: FeedEvent[]; clock: number }) {
  const c = live.conditions?.content as Record<string, number> | undefined;
  const tiles: [string, string][] = c
    ? [
        ["Air", `${c.air_c}°C`],
        ["Soil", `${c.soil_c}°C`],
        ["Soil moisture", `${Math.round(c.soil_moisture * 100)}%`],
        ["Humidity", `${c.humidity}%`],
        ["Wind", `${Math.round(c.wind_kmh)} km/h`],
        ["Rain", `${c.rain_mm} mm`],
      ]
    : [];

  return (
    <section className="panel livefeed" aria-labelledby="live-h">
      <div className="panel-head">
        <h2 id="live-h">Live from the garden</h2>
        <span className={`chip live${live.streaming ? "" : " past"}`}>
          <span className="dot" />
          {live.streaming ? "streaming" : "stream off"}
        </span>
        <span className="aside">
          {live.conditions ? `reading ${ago(live.conditions.ts, clock)}` : "no reading yet"}
        </span>
      </div>

      {tiles.length > 0 ? (
        <div className="tiles">
          {tiles.map(([l, v]) => (
            <div key={l} className="tile">
              <div className="v">{v}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Start the stream with <code>python loop/main.py</code> — readings land here as they arrive.</p>
      )}

      <div className="eyebrow" style={{ margin: "16px 0 8px" }}>As it happens</div>
      <ol className="ticker" aria-live="polite">
        {events.length === 0 && <li className="muted">Nothing yet.</li>}
        {events.slice(0, 12).map((o) => {
          const b = badge(o);
          return (
            <li key={o.key}>
              <span className={`src ${b.cls}`}>{b.label}</span>
              <span className="txt">{o.content.text}</span>
              <time dateTime={o.ts}>{ago(o.ts, clock)}</time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
