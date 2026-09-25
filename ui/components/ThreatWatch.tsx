"use client";

import type { PlanEdit, Threat } from "@/lib/types";
import { threatIcon } from "./icons";
import { whyFor } from "./why";

const STEPS: Threat["status"][] = ["watching", "active", "resolved"];
const ORDER = { active: 0, watching: 1, resolved: 2 };

export default function ThreatWatch({ threats, edits }: { threats: Threat[]; edits: PlanEdit[] }) {
  const sorted = [...threats].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <section className="panel" aria-labelledby="threat-h">
      <div className="panel-head">
        <h2 id="threat-h">Threat watch</h2>
        <span className="count">{threats.filter((t) => t.status !== "resolved").length} open</span>
      </div>
      <div className="tasks">
        {sorted.length === 0 && <p className="empty">All quiet. Nimble is watching the weather and the neighbours.</p>}
        {sorted.map((t) => {
          const why = whyFor(`threats/${t.id}`, edits);
          return (
            <article key={t.id} className={`threat ${t.status}`} tabIndex={0}>
              <span className="glyph">{threatIcon(t.kind)}</span>
              <div>
                <div className="title">{t.title}</div>
                <div className="lifecycle" aria-label={`Status: ${t.status}`}>
                  {STEPS.map((s, i) => (
                    <span key={s} style={{ display: "contents" }}>
                      {i > 0 && <i />}
                      <span className={s === t.status ? "on" : undefined}>{s}</span>
                    </span>
                  ))}
                </div>
              </div>
              {(t.reason || why) && (
                <div className="why" role="tooltip">
                  {t.reason && <><b>why:</b> {t.reason}</>}
                  {why?.evidence && <span className="ev">↳ saw: “{why.evidence}”</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
