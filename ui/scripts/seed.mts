// Rewrites ../data with fresh demo history: `npm run seed`.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSeed } from "../lib/seed.ts";

const dir = path.resolve(process.env.PERENNIAL_DATA_DIR ?? path.join(process.cwd(), "..", "data"));
await mkdir(dir, { recursive: true });
const seed = buildSeed(new Date());
for (const [table, rows] of Object.entries(seed)) {
  await writeFile(path.join(dir, `${table}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${table.padEnd(14)} ${rows.length} rows`);
}
console.log(`seeded ${dir}`);
