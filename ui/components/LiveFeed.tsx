"use client";

import type { LiveState, LoopRun, Observation, PlanEdit } from "@/lib/types";
import { ago } from "./why";

type C = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

interface Line { label: string; cls: string; title: string; detail?: string; href?: string }

/** One observation, in words a gardener would use. */
function describeObs(o: Observation): Line {
  const c = o.content as C & { text: string };
  const provider = String(c.provider ?? o.source);
  if (o.kind === "conditions") {
    return {
      label: "Weather", cls: "sage", title: `${c.air_c}°C air, ${c.soil_c}°C soil`,
      detail: `${Math.round(num(c.soil_moisture) * 100)}% soil moisture · ${c.humidity}% humidity · ${Math.round(num(c.wind_kmh))} km/h wind · ${c.rain_mm} mm rain`,
    };
  }
  if (o.kind === "forecast") {
    const high = c.high ?? /high (-?\d+)°C/.exec(c.text)?.[1];
    const rain = c.rain_mm ?? /(\d+) mm rain/.exec(c.text)?.[1];
    return {
      label: provider === "demo" ? "Demo forecast" : "Forecast", cls: provider === "demo" ? "" : "sage",
      title: `Coldest night ${c.date ? day(String(c.date)) : ""}: ${c.low}°C`,
      detail: [high !== undefined && `high ${high}°C`, rain !== undefined && `${rain} mm rain expected this week`].filter(Boolean).join(" · ") || undefined,
    };
  }
  if (o.kind === "alert") return { label: "NWS alert", cls: "terra", title: String(c.event ?? "Weather alert"), detail: String(c.headline ?? c.text) };
  if (o.source === "user") {
    const verb = { plant: "You planted", harvest: "You harvested", note: "Your note" }[o.kind] ?? "You logged";
    return { label: "You", cls: "ink", title: verb, detail: c.text };
  }
  if (provider === "nimble") {
    const [title, ...rest] = c.text.split(" — ");
    return { label: o.kind === "variety" ? "Growing tip" : "Pest news", cls: "gold", title, detail: rest.join(" — ") || undefined, href: typeof c.url === "string" ? c.url : undefined };
  }
  return { label: provider, cls: "", title: c.text };
}

function ObsRow({ o, clock }: { o: Observation; clock: number }) {
  const d = describeObs(o);
  return (
    <li className="obs-row">
      <span className={`src ${d.cls}`}>{d.label}</span>
      <div className="obs-body">
        <div className="obs-title">{d.href ? <a href={d.href} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</div>
        {d.detail && <div className="obs-detail">{d.detail}</div>}
      </div>
      <time dateTime={o.ts} title={new Date(o.ts).toLocaleString()}>{ago(o.ts, clock)}</time>
    </li>
  );
}

function editLabel(e: PlanEdit): string {
  const after = e.after as { title?: string; crop?: string; stage?: string } | string | null;
  if (typeof after === "string") return after;
  if (after?.title) return after.title;
  if (after?.crop || after?.stage) return `Bed ${e.target.split("_")[1]}: ${[after.crop, after.stage].filter(Boolean).join(", ")}`;
  const before = e.before as { title?: string } | string | null;
  return (typeof before === "string" ? before : before?.title) ?? e.target;
}

function Obs({ list, clock, limit = 4 }: { list: Observation[]; clock: number; limit?: number }) {
  if (!list.length) return <p className="muted">Nothing new — a scheduled check-in.</p>;
  return (
    <>
      <ul className="obs">{list.slice(0, limit).map((o, i) => <ObsRow key={`${o.ts}-${i}`} o={o} clock={clock} />)}</ul>
      {list.length > limit && (
        <details className="more">
          <summary>{list.length - limit} more</summary>
          <ul className="obs">{list.slice(limit).map((o, i) => <ObsRow key={`${o.ts}-m${i}`} o={o} clock={clock} />)}</ul>
        </details>
      )}
    </>
  );
}

function Think({ l, read, edits, clock }: { l: LoopRun; read: Observation[]; edits: PlanEdit[]; clock: number }) {
  return (
    <article className="think">
      <header className="think-head">
        <b>Loop {l.loop}</b>
        <span className="muted">{ago(l.ts, clock)} · thought for {l.duration_s}s</span>
        <span className={`verdict${edits.length ? " changed" : ""}`}>
          {edits.length ? `${edits.length} plan change${edits.length === 1 ? "" : "s"}` : "no changes"}
        </span>
      </header>
      <div className="think-body">
        <div>
          <div className="eyebrow">Read</div>
          <Obs list={read} clock={clock} />
        </div>
        <div>
          <div className="eyebrow">Decided</div>
          {edits.length ? (
            <ul className="edits">
              {edits.map((e, i) => (
                <li key={i}>
                  <span className={`op ${e.op.toLowerCase()}`}>{e.op}</span>
                  <div>
                    <div className="obs-title">{editLabel(e)}</div>
                    <div className="obs-detail">{e.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">The plan already covers it — nothing to change.</p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function LiveFeed({ live, clock }: { live: LiveState; clock: number }) {
  const c = live.conditions?.content as C | undefined;
  const tiles: [string, string][] = c
    ? [
        ["Air", `${c.air_c}°C`],
        ["Soil", `${c.soil_c}°C`],
        ["Soil moisture", `${Math.round(num(c.soil_moisture) * 100)}%`],
        ["Humidity", `${c.humidity}%`],
        ["Wind", `${Math.round(num(c.wind_kmh))} km/h`],
        ["Rain", `${c.rain_mm} mm`],
      ]
    : [];

  // Bucket readings by the loop that read them: a loop reads everything after the previous loop, up to its own start.
  const loops = live.loops;
  const waiting = loops.length ? live.events.filter((o) => o.ts > loops[0].ts) : live.events;
  const readBy = (i: number) => live.events.filter((o) => o.ts <= loops[i].ts && (i + 1 >= loops.length || o.ts > loops[i + 1].ts));

  return (
    <section className="panel livefeed" aria-labelledby="live-h">
      <div className="panel-head">
        <h2 id="live-h">Live from the garden</h2>
        <span className={`chip live${live.streaming ? "" : " past"}`}>
          <span className="dot" />
          {live.streaming ? "streaming" : "stream off"}
        </span>
        <span className="aside">{live.conditions ? `last reading ${ago(live.conditions.ts, clock)}` : "no reading yet"}</span>
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
        <p className="muted">Start the stream with <code>python loop/main.py</code>. Readings land here as they arrive.</p>
      )}

      <div className="feed-intro">
        <h3>What the gardener saw, and what it did</h3>
        <p className="muted">
          Readings arrive as they happen. Each loop, the gardener (the local Liquid model) reads everything new and
          decides what to change in the plan.
        </p>
      </div>

      {waiting.length > 0 && (
        <article className="think waiting">
          <header className="think-head">
            <b>Up next</b>
            <span className="muted">arrived since the last loop — the gardener reads these next</span>
          </header>
          <Obs list={waiting} clock={clock} />
        </article>
      )}
      {loops.map((l, i) => (
        <Think key={l.loop} l={l} read={readBy(i)} edits={live.edits.filter((e) => e.loop === l.loop)} clock={clock} />
      ))}
    </section>
  );
}
