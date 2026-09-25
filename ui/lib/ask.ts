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

/** Streams the answer from the local Liquid model, token by token. Yields nothing if the model is unreachable. */
async function* streamLiquid(question: string, current: PlanVersion, history: string[], live: string[]): AsyncGenerator<string> {
  const { LIQUID_API_KEY: key, LIQUID_API_BASE: base, LIQUID_MODEL: model } = process.env;
  if (!base) return;
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: model || "LFM2.5-VL-1.6B",
        temperature: 0.2,
        stream: true,
        messages: [
          { role: "system", content: `You are the garden's memory. Answer in 1-3 short sentences using ONLY the current plan, live readings and history below. If they don't say, say you don't know. End with "(plan v${current.version})".` },
          { role: "user", content: `CURRENT PLAN v${current.version}:\n${JSON.stringify(current.plan)}\n\nLIVE NOW:\n${live.join("\n") || "(no live readings)"}\n\nRELEVANT HISTORY:\n${history.join("\n")}\n\nQUESTION: ${question}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const tok = JSON.parse(data).choices?.[0]?.delta?.content;
          if (tok) yield tok;
        } catch {
          // keep-alive or partial frame
        }
      }
    }
  } catch {
    // connection dropped mid-answer — keep what we have
  }
}

export type AskResult = QA & { sources: string[]; engine: "liquid" | "memory" };

/** Answers a question, calling `onToken` as the answer streams in. The QA row is logged once complete. */
export async function askGarden(question: string, onToken: (t: string) => void = () => {}): Promise<AskResult> {
  const [current, edits, observations] = await Promise.all([latestPlan(), readTable("plan_edits"), readTable("observations")]);
  const facts = context(current, edits, question);
  const sources = facts.map((f) => f.t);
  const streamed = observations.filter((o) => o.source === "nimble");
  const live = [
    streamed.findLast((o) => o.kind === "conditions"),
    streamed.findLast((o) => o.kind === "forecast"),
    ...streamed.filter((o) => o.kind === "alert").slice(-3),
  ].flatMap((o) => (o ? [`${o.ts.slice(0, 16).replace("T", " ")} UTC — ${o.content.text}`] : []));

  let answer = "";
  for await (const tok of streamLiquid(question, current, sources, live)) {
    answer += tok;
    onToken(tok);
  }
  answer = answer.trim();
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
    onToken(answer);
  }

  const qa: QA = { ts: new Date().toISOString(), question, answer, plan_version: current.version };
  await append("qa_log", qa);
  return { ...qa, sources, engine };
}
