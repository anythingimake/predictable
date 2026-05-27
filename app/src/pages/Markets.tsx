import { useEffect, useState } from "react";
import { api } from "../api";
import type { Market } from "../types";
import { ErrorBanner, Loading } from "./Scoreboard";

export function Markets() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>();

  useEffect(() => {
    setMarkets(null);
    api.markets({ source }).then(setMarkets).catch((e) => setErr(String(e)));
  }, [source]);

  if (err) return <ErrorBanner message={err} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Markets</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Markets Stu has covered, with his calls + price history.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {["", "kalshi", "polymarket", "predictit"].map((s) => (
          <button
            key={s || "_all"}
            onClick={() => setSource(s || undefined)}
            className={`tap inline-flex items-center px-3 py-2 sm:py-1 rounded-full text-sm sm:text-xs border transition-colors ${
              (source ?? "") === s
                ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {s ? s : "All"}
          </button>
        ))}
      </div>
      {!markets && <Loading />}
      {markets && markets.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No markets yet — populated by enrich/market_resolver after extraction.</p>
      )}
      {markets && markets.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {markets.map((m) => (
            <div
              key={m.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm"
            >
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="font-medium min-w-0 break-words">{m.question}</div>
                <div className="text-xs text-[var(--color-text-muted)] flex-shrink-0 font-mono">
                  {m.source}:{m.ticker}
                </div>
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1 flex gap-x-3 gap-y-1 flex-wrap">
                {m.category && <span>{m.category}</span>}
                {m.resolution_date && <span>resolves {m.resolution_date}</span>}
                {m.current_price != null && <span>@ {(m.current_price * 100).toFixed(1)}¢</span>}
                {m.resolved === 1 && <span className="text-[var(--color-tier-play)]">RESOLVED {m.resolution}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
