import "server-only";
import { append, latestPlan, readTable } from "./store";
import type { PlanEdit, PlanVersion, QA } from "./types";

// "Ask the garden" (PDD §7, answer call): answer from the current plan plus
// relevant history only, and cite the plan version.

const STOP = new Set("a an and are at be did do does for from how i in is it last my of on or the this to was what when where which why will with year you".split(" "));

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ies|es|s)$/, ""));

function score(q: string[], text: string): number {
  const t = new Set(tokens(text));
  return q.reduce((n, w) => n + (t.has(w) ? 1 : 0), 0);
}

function context(current: PlanVersion, edits: PlanEdit[], question: string) {
  const q = tokens(question);
  const facts = [
    ...current.plan.learnings.map((t) => ({ t, w: 3 })),
    ...current.plan.season_notes.map((t) => ({ t, w: 2 })),
    ...current.plan.beds.map((b) => ({ t: `Bed ${b.id.slice(4)}: ${b.crop || "resting"} (${b.stage}). ${b.note ?? ""}`, w: 1 })),
    ...current.plan.threats.map((x) => ({ t: `${x.title} — ${x.status}`, w: 1 })),
    ...edits.filter((e) => e.evidence).map((e) => ({ t: `${e.ts.slice(0, 10)}: ${e.evidence} (${e.reason})`, w: 1 })),
  ];
  return facts
    .map((f) => ({ ...f, s: score(q, f.t) * f.w }))
    .filter((f) => f.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
}

async function askLiquid(question: string, current: PlanVersion, history: string[]): Promise<string | null> {
  const { LIQUID_API_KEY: key, LIQUID_API_BASE: base, LIQUID_MODEL: model } = process.env;
  if (!key || !base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: model || "lfm-40b",
        temperature: 0.2,
        messages: [
          { role: "system", content: `You are the garden's memory. Answer in 1-3 short sentences using ONLY the current plan and history below. If they don't say, say you don't know. End with "(plan v${current.version})".` },
          { role: "user", content: `CURRENT PLAN v${current.version}:\n${JSON.stringify(current.plan)}\n\nRELEVANT HISTORY:\n${history.join("\n")}\n\nQUESTION: ${question}` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function askGarden(question: string): Promise<QA & { sources: string[]; engine: "liquid" | "memory" }> {
  const [current, edits] = await Promise.all([latestPlan(), readTable("plan_edits")]);
  const facts = context(current, edits, question);
  const sources = facts.map((f) => f.t);

  let answer = await askLiquid(question, current, sources);
  const engine = answer ? "liquid" : "memory";
  if (!answer) {
    answer = facts.length
      ? facts
          .filter((f) => f.w > 1)
          .concat(facts.filter((f) => f.w === 1))
          .slice(0, 2)
          .map((f) => f.t)
          .join(" ")
      : "Nothing in the garden's memory about that yet — log it and I'll remember.";
  }

  const qa: QA = { ts: new Date().toISOString(), question, answer, plan_version: current.version };
  await append("qa_log", qa);
  return { ...qa, sources, engine };
}
