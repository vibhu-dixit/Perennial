"use client";

import { useEffect, useRef, useState } from "react";
import { bedLabel, bedNumber } from "@/lib/plan";
import type { Bed } from "@/lib/types";

type Action = "plant" | "harvest" | "note";
const CROPS = ["peppers", "tomatoes", "carrots", "spinach", "kale", "lettuce", "garlic", "beans", "peas", "basil", "squash", "clover"];

export default function LogDialog({ beds, onClose, onLogged }: { beds: Bed[]; onClose: () => void; onLogged: (text: string) => void }) {
  const [action, setAction] = useState<Action>("plant");
  const [bed, setBed] = useState(beds.find((b) => !b.crop)?.id ?? "bed_1");
  const [crop, setCrop] = useState("peppers");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, bed, crop: action === "plant" ? crop : undefined, text }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not log that.");
    onLogged(data.text);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="log-h" onSubmit={submit}>
        <h2 id="log-h">Log a moment</h2>
        <div className="field">
          <span>What happened</span>
          <div className="seg">
            {(["plant", "harvest", "note"] as Action[]).map((a, i) => (
              <button key={a} ref={i === 0 ? first : undefined} type="button" aria-pressed={action === a} onClick={() => setAction(a)}>
                {{ plant: "🌱 Planted", harvest: "🧺 Harvested", note: "✎ Note" }[a]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Bed</span>
          <div className="seg">
            {beds.map((b) => (
              <button key={b.id} type="button" aria-pressed={bed === b.id} onClick={() => setBed(b.id)} title={bedLabel(b)}>
                {bedNumber(b.id)}
              </button>
            ))}
          </div>
        </div>
        {action === "plant" && (
          <label className="field">
            <span>Crop</span>
            <input value={crop} onChange={(e) => setCrop(e.target.value)} list="crops" required maxLength={40} />
            <datalist id="crops">{CROPS.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        <label className="field">
          <span>Note (optional)</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={action === "plant" ? `Transplanted ${crop}, bed ${bedNumber(bed)}` : "Anything worth remembering"} maxLength={280} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn terra" disabled={busy}>{busy ? "Logging…" : "Log it"}</button>
        </div>
      </form>
    </div>
  );
}
