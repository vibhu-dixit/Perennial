import { askGarden } from "@/lib/ask";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question?.trim()) return Response.json({ error: "question required" }, { status: 400 });
  return Response.json(await askGarden(question.trim().slice(0, 500)));
}
