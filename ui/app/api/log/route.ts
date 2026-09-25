import { append } from "@/lib/store";

export const dynamic = "force-dynamic";

const ACTIONS = ["plant", "harvest", "note"] as const;

/** A user log is a raw observation; the next loop folds it into the plan. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; bed?: string; crop?: string; text?: string };
  const action = ACTIONS.find((a) => a === body.action);
  const bed = /^bed_[1-6]$/.test(body.bed ?? "") ? body.bed : undefined;
  const crop = body.crop?.trim().toLowerCase().slice(0, 40) || undefined;
  if (!action || (action !== "note" && !bed)) return Response.json({ error: "action and bed required" }, { status: 400 });
  if (action === "plant" && !crop) return Response.json({ error: "crop required" }, { status: 400 });

  const verb = { plant: "Planted", harvest: "Harvested", note: "Note" }[action];
  const text =
    body.text?.trim().slice(0, 280) ||
    `${verb}${crop ? ` ${crop}` : ""}${bed ? `, bed ${bed.slice(4)}` : ""}`;
  await append("observations", {
    ts: new Date().toISOString(),
    source: "user",
    kind: action,
    content: { text, action, bed, crop },
    loop: null,
  });
  return Response.json({ ok: true, text });
}
