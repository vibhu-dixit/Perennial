import type { PlanEdit } from "@/lib/types";

/** The edit that put an item in its current shape — its "why". */
export function whyFor(target: string, edits: PlanEdit[]): PlanEdit | undefined {
  return edits.findLast((e) => e.target === target && e.op !== "RETIRE");
}

export function relDay(iso: string, now: string): string {
  const days = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(now.slice(0, 10))) / 864e5);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  if (days < 7) return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
