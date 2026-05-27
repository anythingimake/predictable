import { useEffect, useState } from "react";
import { api } from "../api";
import type { Principle } from "../types";
import { ErrorBanner, Loading } from "./Scoreboard";

export function Principles() {
  const [ps, setPs] = useState<Principle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.principles().then(setPs).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!ps) return <Loading />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Stu's Principles</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Heuristics Stu repeats — auto-mined from transcripts.
        </p>
      </div>
      {ps.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No principles extracted yet.</p>
      )}
      <div className="space-y-3">
        {ps.map((p) => (
          <div key={p.id} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium text-base md:text-lg">{p.rule}</h3>
              <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap flex-shrink-0">
                {p.citation_count ?? 0} citation{p.citation_count === 1 ? "" : "s"}
              </span>
            </div>
            {p.rationale && (
              <p className="text-base md:text-sm text-[var(--color-text-muted)] mt-2 leading-relaxed">{p.rationale}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
