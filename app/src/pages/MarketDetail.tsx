import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Call, Market } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { formatCents, formatPct, marketUrl, stuSideCents } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

type MarketDetailData = Market & {
  calls: Call[];
  price_history: { snapshot_date: string; price: number }[];
};

export function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MarketDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setData(null);
    api.market(id).then(setData).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <ErrorBanner message={err} />;
  if (!data) return <Loading />;

  const currentCents = stuSideCents("yes", data.current_price);
  const isResolved = data.resolved === 1;

  return (
    <article className="space-y-5">
      <Link
        to="/markets"
        className="tap inline-flex items-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] -mt-1"
      >
        ← All markets
      </Link>

      <header>
        <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">
          {data.source} · <code className="font-mono">{data.ticker}</code>
        </div>
        <h1 className="text-xl md:text-2xl font-semibold mt-1">{data.question}</h1>
        {marketUrl(data.source, data.ticker) && (
          <a
            href={marketUrl(data.source, data.ticker)!}
            target="_blank"
            rel="noreferrer"
            className="tap mt-2 inline-flex items-center gap-1 text-sm text-[var(--color-accent)]"
          >
            View on {data.source === "polymarket" ? "Polymarket" : data.source === "kalshi" ? "Kalshi" : data.source} ↗
          </a>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-[var(--color-text-muted)]">
          {data.category && <span>{data.category}</span>}
          {data.resolution_date && <span>resolves {data.resolution_date}</span>}
          {currentCents != null && (
            <span>
              Current: <span className="text-[var(--color-text)] font-semibold">{formatCents(currentCents)}</span>
            </span>
          )}
          {isResolved && (
            <span className="text-[var(--color-tier-play)] font-semibold uppercase">
              {data.resolution === "yes" || data.resolution === "no" ? `Settled ${data.resolution}` : "Settled"}
            </span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-base md:text-lg font-medium mb-2">
          Stu's calls on this market
          <span className="ml-2 text-xs font-normal text-[var(--color-text-faint)]">
            · {data.calls.length} {data.calls.length === 1 ? "call" : "calls"}
          </span>
        </h2>
        {data.calls.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No calls linked to this market yet.
          </p>
        ) : (
          <div className="space-y-2">
            {data.calls.map((c) => (
              <Link
                key={c.id}
                to={`/calls/${c.id}`}
                className="tap block rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm hover:border-[var(--color-accent)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <ConvictionBadge conviction={c.conviction} />
                    <span className="text-xs uppercase text-[var(--color-text-muted)]">
                      {c.side}
                    </span>
                    <span className="text-xs text-[var(--color-text-faint)]">· {c.publish_date}</span>
                  </div>
                  {c.realized_pct != null && (
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{
                        color:
                          c.realized_pct > 0
                            ? "var(--color-tier-play)"
                            : "var(--color-tier-pass)",
                      }}
                    >
                      {c.realized_pct > 0 ? "+" : ""}
                      {formatPct(c.realized_pct, 1)}
                    </span>
                  )}
                </div>
                <div className="text-[var(--color-text-muted)] mt-1 truncate">
                  {c.episode_title}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-base md:text-lg font-medium mb-2">Price history</h2>
        {data.price_history.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No snapshots yet — the daily cron populates these.
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            {data.price_history.length} daily snapshots from{" "}
            {data.price_history[0].snapshot_date} to{" "}
            {data.price_history[data.price_history.length - 1].snapshot_date}.
            See individual call pages for the lifecycle chart with event markers.
          </p>
        )}
      </section>
    </article>
  );
}
