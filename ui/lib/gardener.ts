import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { WEEKDAY, addDays, applyEdit, isFrostTender, isoDay, nextWeekday, planWords, WORD_BUDGET } from "./plan";
import { append, latestPlan, readTable } from "./store";
import type { Observation, Plan, PlanEdit } from "./types";

// One on-demand loop (PDD §5). The Python loop does the real work (Nimble →
// Liquid AI → RawTree). If it's missing or fails (no python3, a crash), a
// rule-based demo gardener stands in with the same inputs and outputs so the
// demo never stalls.

const LOOP_PY = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "loop", "main.py");

export function gardenerKind(): "python" | "demo" {
  return existsSync(LOOP_PY) ? "python" : "demo";
}

export async function runLoop(): Promise<{ edits: number; kind: "python" | "demo"; error?: string }> {
  if (gardenerKind() === "python") {
    try {
      const { stdout } = await promisify(execFile)(process.env.PERENNIAL_PYTHON || "python3", [LOOP_PY, "--once"], {
        cwd: path.dirname(LOOP_PY),
        timeout: 240_000, // local Liquid model + one repair retry
      });
      const edits = Number(stdout.match(/→ (\d+) edits/)?.[1] ?? -1);
      return { edits, kind: "python" };
    } catch (err) {
      console.error("[loop] python loop failed, using demo gardener:", err);
      return { edits: await demoLoop(), kind: "demo", error: String(err) };
    }
  }
  return { edits: await demoLoop(), kind: "demo" };
}

/** Scripted Nimble pull; in demo mode it injects "cold snap Thursday" (PDD §7). */
function nimbleForecast(now: Date, loop: number): Observation {
  const thu = nextWeekday(now, 4);
  const demo = process.env.PERENNIAL_DEMO !== "0";
  const low = demo ? 2 : 9;
  return {
    ts: now.toISOString(),
    source: "nimble",
    kind: "forecast",
    content: { text: `7-day forecast: ${WEEKDAY[4]} ${isoDay(thu)} low ${low}°C${demo ? " — cold snap" : ""}`, low, date: isoDay(thu) },
    loop,
  };
}

async function demoLoop(): Promise<number> {
  const started = Date.now();
  const now = new Date();
  const [loops, observations, current] = await Promise.all([readTable("loops"), readTable("observations"), latestPlan()]);
  const loop = Math.max(0, ...loops.map((l) => l.loop)) + 1;
  const lastTs = loops.at(-1)?.ts ?? "";

  const userLogs = observations.filter((o) => o.source === "user" && o.ts > lastTs);
  const forecast = nimbleForecast(now, loop);
  await append("observations", forecast);
  const fresh = [...userLogs, forecast];

  const edits: PlanEdit[] = [];
  let plan: Plan = current.plan;
  const edit = (e: Omit<PlanEdit, "ts" | "loop" | "before" | "after"> & { before?: unknown; after?: unknown }) => {
    const [coll, id] = e.target.split("/");
    const list = (plan as unknown as Record<string, { id: string }[]>)[coll];
    const before = e.before ?? (id ? (list?.find((x) => x.id === id) ?? null) : null);
    const full: PlanEdit = { ts: now.toISOString(), loop, after: null, ...e, before };
    plan = applyEdit(plan, full);
    edits.push(full);
  };

  // 1. User logs → bed updates.
  for (const o of userLogs) {
    const { bed, crop, action } = o.content as { bed?: string; crop?: string; action?: string };
    if (!bed || !plan.beds.some((b) => b.id === bed)) continue;
    if (action === "plant" && crop) {
      edit({ op: "UPDATE", target: `beds/${bed}`, after: { crop, stage: "seedling", planted: isoDay(now) }, reason: "Logged planting", evidence: o.content.text });
      const done = plan.tasks.find((t) => t.title.toLowerCase().includes(crop.toLowerCase().replace(/s$/, "")) && /transplant|sow|plant/i.test(t.title));
      if (done) edit({ op: "RETIRE", target: `tasks/${done.id}`, reason: "Done — logged by you", evidence: o.content.text });
    } else if (action === "harvest") {
      edit({ op: "UPDATE", target: `beds/${bed}`, after: { crop: "", stage: "empty" }, reason: "Logged harvest", evidence: o.content.text });
    }
  }

  // 2. Frost risk → protect every frost-tender crop that isn't already covered.
  const low = forecast.content.low as number;
  const day = new Date(`${forecast.content.date}T00:00:00Z`);
  if (low <= 3) {
    const threatId = `frost_${forecast.content.date}`;
    if (!plan.threats.some((t) => t.id === threatId))
      edit({ op: "ADD", target: `threats/${threatId}`, after: { kind: "frost", title: `Cold snap ${WEEKDAY[day.getUTCDay()]} night (${low}°C)`, status: "active", reason: `forecast low ${low}°C` }, reason: "Forecast near freezing", evidence: forecast.content.text });
    for (const bed of plan.beds) {
      if (!bed.crop || !isFrostTender(bed.crop)) continue;
      const id = `t_cover_${bed.id}_${forecast.content.date}`;
      if (plan.tasks.some((t) => t.id === id)) continue;
      const where = plan.beds.filter((b) => b.crop === bed.crop).length > 1 ? ` in bed ${bed.id.slice(4)}` : "";
      edit({
        op: "ADD",
        target: `tasks/${id}`,
        after: { title: `Cover ${bed.crop}${where} ${WEEKDAY[day.getUTCDay()]} night`, due: isoDay(day), priority: "high", reason: `frost risk ${low}°C ${WEEKDAY[day.getUTCDay()]}` },
        reason: `${bed.crop} in bed ${bed.id.slice(4)} are frost-tender`,
        evidence: forecast.content.text,
      });
    }
  }

  // 3. Discard boundary: retire overdue tasks, resolved threats; cap note lists.
  for (const t of plan.tasks) if (t.due < isoDay(addDays(now, -2))) edit({ op: "RETIRE", target: `tasks/${t.id}`, reason: "Stale — past due" });
  for (const t of plan.threats) if (t.status === "resolved") edit({ op: "RETIRE", target: `threats/${t.id}`, reason: "Resolved — archived" });
  while (planWords(plan) > WORD_BUDGET && plan.season_notes.length)
    edit({ op: "RETIRE", target: "season_notes", before: plan.season_notes[0], reason: "Over word budget — oldest note archived" });

  if (edits.length) {
    const versions = await readTable("plan_versions");
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    await append("plan_versions", { version, ts: now.toISOString(), loop, plan });
    await append("plan_edits", ...edits);
  }
  await append("loops", {
    loop,
    ts: now.toISOString(),
    duration_s: Math.round((Date.now() - started) / 100) / 10,
    obs_count: fresh.length,
    edits_count: edits.length,
    plan_words: planWords(plan),
  });
  return edits.length;
}
