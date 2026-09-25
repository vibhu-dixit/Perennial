import { runLoop } from "@/lib/gardener";

export const dynamic = "force-dynamic";

/** `?wait=0` (after a user log): when the stream is running it handles the log itself. */
export async function POST(req: Request) {
  try {
    return Response.json(await runLoop({ wait: new URL(req.url).searchParams.get("wait") !== "0" }));
  } catch (err) {
    // A failed loop never corrupts the plan — history is append-only.
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
