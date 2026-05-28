import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Saga } from "../types";
import { ErrorBanner, Loading } from "./Scoreboard";

/**
 * Multi-episode market arcs. Each saga groups the episodes where Stu kept
 * coming back to the same call (entries, trims, adds, exits) so the journey
 * is legible at a glance.
 */
export function Sagas() {
  const [sagas, setSagas] = useState<Saga[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.sagas().then(setSagas).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!sagas) return <Loading />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Sagas</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Multi-episode market arcs — every time Stu kept coming back to the same call.
        </p>
      </div>
      {sagas.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No sagas extracted yet.</p>
      )}
      <div className="space-y-3">
        {sagas.map((s) => (
          <Link
            key={s.id}
            to={`/sagas/${s.id}`}
            className="tap block rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 hover:border-[var(--color-border-strong)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-base md:text-lg truncate">{s.name}</h3>
                {s.market_question && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                    {s.market_source && (
                      <span className="uppercase text-[10px] mr-2 opacity-70">{s.market_source}</span>
                    )}
                    {s.market_question}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  {s.episode_count} episode{s.episode_count === 1 ? "" : "s"}
                </div>
                <div className="text-[11px] text-[var(--color-text-faint)] mt-0.5">
                  {s.status}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
