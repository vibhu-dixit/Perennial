import { askGarden } from "@/lib/ask";

export const dynamic = "force-dynamic";

/** Streams the answer as server-sent events (`token`, then `done` with the full record) when asked to;
 *  otherwise returns the finished answer as JSON. */
export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question?.trim()) return Response.json({ error: "question required" }, { status: 400 });
  const q = question.trim().slice(0, 500);
  if (!req.headers.get("accept")?.includes("text/event-stream")) return Response.json(await askGarden(q));

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await askGarden(q, (t) => send("token", t));
        send("done", result);
      } catch (err) {
        send("error", String(err));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
}
