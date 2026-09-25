import "server-only";
import { gardenerKind, streamAlive } from "./gardener";
import { planWords, WORD_BUDGET } from "./plan";
import { readTable } from "./store";
import type { GardenState } from "./types";

/** Everything the page renders. `version` picks a past plan for the timeline scrubber. */
export async function gardenState(version?: number): Promise<GardenState> {
  const [versions, edits, observations, qa, loops] = await Promise.all([
    readTable("plan_versions"),
    readTable("plan_edits"),
    readTable("observations"),
    readTable("qa_log"),
    readTable("loops"),
  ]);
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const current = sorted[sorted.length - 1];
  const viewing = (version && sorted.find((v) => v.version === version)) || current;
  const lastNimble = observations.findLast((o) => o.source === "nimble");
  const liveObs = observations.filter((o) => o.source !== "seed");
  const recentLoops = loops.slice(-6).reverse();
  const since = loops.at(-7)?.ts ?? "";
  const [lat, lon] = [Number(process.env.GARDEN_LAT), Number(process.env.GARDEN_LON)];

  return {
    now: new Date().toISOString(),
    current,
    viewing,
    // Edits up to the viewed version — the "why" behind each task and threat.
    edits: edits.filter((e) => e.loop <= viewing.loop).slice(-120),
    timeline: sorted.map((v) => ({ version: v.version, ts: v.ts })),
    harvests: observations.filter((o) => o.kind === "harvest").map((o) => ({ ts: o.ts, text: o.content.text })),
    recentQA: qa.slice(-5).reverse(),
    vitals: {
      moments: observations.length + edits.length + qa.length,
      planWords: planWords(current.plan),
      wordBudget: WORD_BUDGET,
      loops: loops.length,
      observations: observations.length,
      lastNimbleTs: lastNimble?.ts ?? null,
      lastLoopTs: loops.at(-1)?.ts ?? null,
    },
    gardener: gardenerKind(),
    live: {
      conditions: liveObs.findLast((o) => o.kind === "conditions") ?? null,
      events: liveObs.filter((o) => o.ts > since).slice(-80).reverse(),
      loops: recentLoops,
      edits: edits.filter((e) => recentLoops.some((l) => l.loop === e.loop) && e.op !== "KEEP"),
      streaming: await streamAlive(),
    },
    location: process.env.GARDEN_LAT && process.env.GARDEN_LON && !Number.isNaN(lat) && !Number.isNaN(lon)
      ? { name: process.env.GARDEN_REGION || "Garden", lat, lon }
      : null,
  };
}
