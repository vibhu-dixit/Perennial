import { runLoop } from "@/lib/gardener";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json(await runLoop());
  } catch (err) {
    // A failed loop never corrupts the plan — history is append-only.
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
