"use client";

import { useState } from "react";
import type { QA } from "@/lib/types";

const SUGGESTIONS = ["Why did my carrots fail last year?", "Which bed is best for tomatoes?", "When should I sow spinach?"];

type Answer = QA & { sources?: string[]; engine?: "liquid" | "memory" };

export default function AskGarden({ recent }: { recent: QA[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(recent[0] ?? null);
  const [partial, setPartial] = useState("");

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setQ(question);
    setBusy(true);
    setPartial("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok || !res.body) return;
      // Server-sent events: `token` frames while the model types, then `done` with the logged record.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let end: number;
        while ((end = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, end);
          buf = buf.slice(end + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!data) continue;
          if (event === "token") setPartial((p) => p + JSON.parse(data));
          if (event === "done") setAnswer(JSON.parse(data));
        }
      }
    } finally {
      setBusy(false);
      setPartial("");
    }
  }

  return (
    <section className="panel" aria-labelledby="ask-h">
      <div className="panel-head">
        <h2 id="ask-h">Ask the garden…</h2>
        <span className="aside">answers from your own history</span>
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="why did my carrots fail last year?" aria-label="Ask the garden" maxLength={500} />
        <button className="btn" disabled={busy || !q.trim()}>Ask</button>
      </form>
      <div className="suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      {busy && (
        <div className="answer" aria-live="polite">
          <div className="q">“{q}”</div>
          {partial ? <p className="a">{partial}<span className="caret" /></p> : <span className="thinking"><i /><i /><i /></span>}
        </div>
      )}
      {!busy && answer && (
        <div className="answer" aria-live="polite">
          <div className="q">“{answer.question}”</div>
          <p className="a">{answer.answer}</p>
          <div className="cite">
            cited plan v{answer.plan_version}
            {answer.engine && ` · ${answer.engine === "liquid" ? "Liquid AI" : "from memory"}`}
          </div>
          {answer.sources && answer.sources.length > 0 && (
            <details>
              <summary>What the garden looked at ({answer.sources.length})</summary>
              <ul>{answer.sources.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
