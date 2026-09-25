import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSeed } from "./seed";
import type { LoopRun, Observation, PlanEdit, PlanVersion, QA } from "./types";

// Local JSONL fallback for RawTree (PDD §12): one append-only <table>.jsonl per
// table, shared with loop/rawtree_store.py. Nothing is ever rewritten in place.

export interface Tables {
  observations: Observation;
  plan_versions: PlanVersion;
  plan_edits: PlanEdit;
  qa_log: QA;
  loops: LoopRun;
}
export type TableName = keyof Tables;

export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PERENNIAL_DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "data"),
);

const file = (table: TableName) => path.join(DATA_DIR, `${table}.jsonl`);

let seeding: Promise<void> | null = null;

/** Seeds two seasons of demo history the first time the store is empty. */
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    try {
      await fs.access(file("plan_versions"));
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const seed = buildSeed(new Date());
      for (const [table, rows] of Object.entries(seed) as [TableName, unknown[]][]) {
        await fs.writeFile(file(table), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      }
    }
  })();
  return seeding;
}

export async function readTable<T extends TableName>(table: T): Promise<Tables[T][]> {
  await ensureSeeded();
  let raw: string;
  try {
    raw = await fs.readFile(file(table), "utf8");
  } catch {
    return [];
  }
  const rows: Tables[T][] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A torn write from a crashed loop never takes the UI down.
    }
  }
  return rows;
}

export async function append<T extends TableName>(table: T, ...rows: Tables[T][]): Promise<void> {
  if (!rows.length) return;
  await ensureSeeded();
  await fs.appendFile(file(table), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export async function latestPlan(): Promise<PlanVersion> {
  const versions = await readTable("plan_versions");
  return versions.reduce((a, b) => (b.version > a.version ? b : a));
}
