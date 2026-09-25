"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanEdit, Task } from "@/lib/types";
import { relDay, whyFor } from "./why";

const ORDER = { high: 0, med: 1, low: 2 };

/** Keeps removed tasks around briefly so they can slide out. */
function useLeaving(tasks: Task[]) {
  const [shown, setShown] = useState<(Task & { leaving?: boolean })[]>(tasks);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(tasks);
  latest.current = tasks;
  const sig = JSON.stringify(tasks);
  useEffect(() => {
    const tasks = latest.current;
    const ids = new Set(tasks.map((t) => t.id));
    setShown((prev) => {
      const leaving = prev.filter((t) => !ids.has(t.id)).map((t) => ({ ...t, leaving: true }));
      return [...tasks, ...leaving];
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(tasks), 600);
    return () => clearTimeout(timer.current);
  }, [sig]);
  return shown;
}

export default function ThisWeek({ tasks, edits, now, fresh }: { tasks: Task[]; edits: PlanEdit[]; now: string; fresh: Set<string> }) {
  const sorted = [...tasks].sort((a, b) => a.due.localeCompare(b.due) || ORDER[a.priority] - ORDER[b.priority]);
  const shown = useLeaving(sorted);
  return (
    <section className="panel" aria-labelledby="week-h">
      <div className="panel-head">
        <h2 id="week-h">This week</h2>
        <span className="count">{tasks.length} tasks</span>
        <span className="aside">hover for why</span>
      </div>
      <div className="tasks">
        {shown.length === 0 && <p className="empty">Nothing to do. Go admire the garden.</p>}
        {shown.map((t) => {
          const why = whyFor(`tasks/${t.id}`, edits);
          return (
            <article key={t.id} className={`task${t.leaving ? " leaving" : ""}${fresh.has(t.id) ? " fresh" : ""}`} tabIndex={0}>
              <span className="check" aria-hidden />
              <div>
                <div className="title">{t.title}</div>
                <div className="due">{relDay(t.due, now)}</div>
              </div>
              <span className={`prio ${t.priority}`}>{t.priority}</span>
              <div className="why" role="tooltip">
                <b>why:</b> {t.reason}
                {why?.evidence && <span className="ev">↳ saw: “{why.evidence}”</span>}
                {why && <span className="ev">loop {why.loop} · {why.op} · {why.reason}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
