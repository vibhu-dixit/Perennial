import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, type TableName } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES: TableName[] = ["observations", "plan_versions", "plan_edits", "qa_log", "loops"];

// Server-sent events: every row appended to a table (by the Python stream or the UI) is pushed the
// moment it lands. Tables are append-only JSONL, so we only ever read the bytes past the last offset.
export async function GET(req: Request) {
  const offsets = new Map<TableName, number>();
  for (const t of TABLES) offsets.set(t, await stat(path.join(DATA_DIR, `${t}.jsonl`)).then((s) => s.size, () => 0));

  const enc = new TextEncoder();
  let watcher: FSWatcher | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const reading = new Set<TableName>();
  const again = new Set<TableName>();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          // client already gone
        }
      };

      const drain = async (table: TableName) => {
        if (reading.has(table)) {
          again.add(table);
          return;
        }
        reading.add(table);
        try {
          const file = path.join(DATA_DIR, `${table}.jsonl`);
          const from = offsets.get(table) ?? 0;
          const size = await stat(file).then((s) => s.size, () => 0);
          if (size < from) offsets.set(table, 0); // file replaced (re-seed) — start over quietly
          if (size <= from) return;
          const fh = await open(file, "r");
          const buf = Buffer.alloc(size - from);
          await fh.read(buf, 0, buf.length, from);
          await fh.close();
          const text = buf.toString("utf8");
          const end = text.lastIndexOf("\n") + 1; // only whole lines; a torn write is picked up next time
          offsets.set(table, from + Buffer.byteLength(text.slice(0, end)));
          for (const line of text.slice(0, end).split("\n")) {
            if (!line.trim()) continue;
            try {
              send(`event: row\ndata: ${JSON.stringify({ table, row: JSON.parse(line) })}\n\n`);
            } catch {
              // skip a malformed line
            }
          }
        } finally {
          reading.delete(table);
          if (again.delete(table)) void drain(table);
        }
      };

      send(`retry: 3000\nevent: hello\ndata: {}\n\n`);
      watcher = watch(DATA_DIR, (_evt, name) => {
        const table = String(name ?? "").replace(/\.jsonl$/, "") as TableName;
        if (TABLES.includes(table)) void drain(table);
      });
      beat = setInterval(() => send(`: beat\n\n`), 15_000);
      req.signal.addEventListener("abort", () => {
        watcher?.close();
        if (beat) clearInterval(beat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      watcher?.close();
      if (beat) clearInterval(beat);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
