import type { Bed, Plan, PlanEdit, Stage } from "./types";

// Pure plan helpers — shared by the server (loop, seed) and the client (UI).

export const WORD_BUDGET = 600;

export const STAGES: Stage[] = [
  "empty",
  "seed",
  "seedling",
  "vegetative",
  "flowering",
  "fruiting",
  "harvest",
  "dormant",
];

/** Frost-tender crops the gardener protects when the forecast drops near freezing. */
export const FROST_TENDER = ["pepper", "tomato", "basil", "squash", "cucumber", "bean", "eggplant", "zucchini"];

export function isFrostTender(crop: string): boolean {
  const c = crop.toLowerCase();
  return FROST_TENDER.some((t) => c.includes(t));
}

/** The leanness metric: words across every string in the plan. */
export function planWords(plan: Plan): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") n += v.split(/\s+/).filter(Boolean).length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(plan);
  return n;
}

export function emptyPlan(): Plan {
  return {
    beds: [
      { id: "bed_1", crop: "", stage: "empty", sun: "high", water: "med", note: "Full sun, loamy" },
      { id: "bed_2", crop: "", stage: "empty", sun: "med", water: "low", note: "Heavy clay, low corner" },
      { id: "bed_3", crop: "", stage: "empty", sun: "high", water: "med", note: "Trellis on north edge" },
      { id: "bed_4", crop: "", stage: "empty", sun: "high", water: "med", note: "Sandy, drains fast" },
      { id: "bed_5", crop: "", stage: "empty", sun: "high", water: "high", note: "Warmest bed, south wall" },
      { id: "bed_6", crop: "", stage: "empty", sun: "med", water: "med", note: "Afternoon shade" },
    ],
    tasks: [],
    threats: [],
    season_notes: [],
    learnings: [],
  };
}

type Collection = "beds" | "tasks" | "threats";
const COLLECTIONS: Collection[] = ["beds", "tasks", "threats"];
type ListKey = "season_notes" | "learnings";

/**
 * Applies one edit to a plan (returns a new plan, never mutates).
 * Targets: "beds/<id>", "tasks/<id>", "threats/<id>", "season_notes", "learnings".
 */
export function applyEdit(plan: Plan, edit: Pick<PlanEdit, "op" | "target" | "before" | "after">): Plan {
  const next: Plan = structuredClone(plan);
  if (edit.op === "KEEP") return next;
  const [coll, id] = edit.target.split("/") as [string, string | undefined];

  if ((COLLECTIONS as string[]).includes(coll) && id) {
    const list = next[coll as Collection] as { id: string }[];
    const i = list.findIndex((x) => x.id === id);
    if (edit.op === "ADD") {
      if (i >= 0) list[i] = { ...(edit.after as object), id } as { id: string };
      else list.push({ ...(edit.after as object), id } as { id: string });
    } else if (edit.op === "UPDATE" && i >= 0) {
      list[i] = { ...list[i], ...(edit.after as object) };
    } else if (edit.op === "RETIRE" && i >= 0) {
      list.splice(i, 1);
    }
    return next;
  }

  if (coll === "season_notes" || coll === "learnings") {
    const list = next[coll as ListKey];
    const at = typeof edit.before === "string" ? list.indexOf(edit.before) : -1;
    if (edit.op === "ADD" && typeof edit.after === "string") list.push(edit.after);
    else if (edit.op === "UPDATE" && at >= 0 && typeof edit.after === "string") list[at] = edit.after;
    else if (edit.op === "RETIRE" && at >= 0) list.splice(at, 1);
  }
  return next;
}

export function bedNumber(id: string): string {
  return id.replace("bed_", "");
}

export function bedLabel(bed: Bed): string {
  return bed.crop ? capitalize(bed.crop) : "Resting";
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Next occurrence of weekday (0=Sun … 4=Thu), at least `minAhead` days out. */
export function nextWeekday(from: Date, weekday: number, minAhead = 1): Date {
  let d = addDays(from, minAhead);
  while (d.getUTCDay() !== weekday) d = addDays(d, 1);
  return d;
}

export const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
