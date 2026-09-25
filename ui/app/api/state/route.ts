import { gardenState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const v = Number(new URL(req.url).searchParams.get("version")) || undefined;
  return Response.json(await gardenState(v));
}
