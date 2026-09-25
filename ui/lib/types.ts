// Shapes mirror the RawTree tables in PDD §6. "Current" = latest version per entity.

export type Stage =
  | "empty"
  | "seed"
  | "seedling"
  | "vegetative"
  | "flowering"
  | "fruiting"
  | "harvest"
  | "dormant";

export type Level = "low" | "med" | "high";

export interface Bed {
  id: string;
  crop: string;
  stage: Stage;
  planted?: string;
  sun: Level;
  water: Level;
  note?: string;
}

export interface Task {
  id: string;
  title: string;
  due: string;
  priority: "low" | "med" | "high";
  reason: string;
}

export interface Threat {
  id: string;
  kind: "frost" | "pest" | "disease" | "weather" | "soil";
  title: string;
  status: "watching" | "active" | "resolved";
  reason?: string;
}

export interface Plan {
  beds: Bed[];
  tasks: Task[];
  threats: Threat[];
  season_notes: string[];
  learnings: string[];
}

export interface Observation {
  ts: string;
  source: "user" | "nimble" | "seed";
  kind: string;
  content: Record<string, unknown> & { text: string };
  loop: number | null;
}

export interface PlanVersion {
  version: number;
  ts: string;
  loop: number;
  plan: Plan;
}

export type EditOp = "KEEP" | "UPDATE" | "RETIRE" | "ADD";

export interface PlanEdit {
  ts: string;
  loop: number;
  op: EditOp;
  target: string;
  before: unknown;
  after: unknown;
  reason: string;
  /** Text of the observation that caused this edit, for the "why" hover. */
  evidence?: string;
}

export interface QA {
  ts: string;
  question: string;
  answer: string;
  plan_version: number;
}

export interface LoopRun {
  loop: number;
  ts: string;
  duration_s: number;
  obs_count: number;
  edits_count: number;
  plan_words: number;
}

export interface TimelinePoint {
  version: number;
  ts: string;
}

export interface HarvestMarker {
  ts: string;
  text: string;
}

/** Everything the page needs, served by GET /api/state. */
export interface GardenState {
  now: string;
  current: PlanVersion;
  viewing: PlanVersion;
  edits: PlanEdit[];
  timeline: TimelinePoint[];
  harvests: HarvestMarker[];
  recentQA: QA[];
  vitals: {
    moments: number;
    planWords: number;
    wordBudget: number;
    loops: number;
    observations: number;
    lastNimbleTs: string | null;
    lastLoopTs: string | null;
  };
  gardener: "python" | "demo";
  live: LiveState;
  /** Where the forecast, alerts and news searches point (GARDEN_* env). */
  location: { name: string; lat: number; lon: number } | null;
}

/** The streamed side of the garden: the latest conditions reading and the newest events. */
export interface LiveState {
  conditions: Observation | null;
  /** Non-seed observations since just before the oldest loop in `loops`, newest first. */
  events: Observation[];
  /** The gardener's most recent loops, newest first, with the plan edits each one made. */
  loops: LoopRun[];
  edits: PlanEdit[];
  /** True while `python loop/main.py` (stream mode) is running. */
  streaming: boolean;
}
