import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Scoreboard as ScoreboardData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { formatPct } from "../lib/format";
import { CONVICTION_LABELS } from "../lib/format";

export function Scoreboard() {
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.scoreboard().then(setData).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!data) return <Loading />;

  const empty = data.total_calls === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Scoreboard</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Stu's tracked calls across Kalshi · Polymarket · PredictIt
        </p>
      </div>

      {empty && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6">
          <p className="text-[var(--color-text-muted)]">
            No calls extracted yet. Run the pipeline (
            <code className="text-[var(--color-text)]">python -m pipeline.backfill</code>) and load (
            <code className="text-[var(--color-text)]">python -m pipeline.load</code>) to populate the scoreboard.
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total calls" value={data.total_calls} />
        <StatCard label="Resolved" value={data.resolved_calls ?? 0} />
        <StatCard label="Hits" value={data.hit_count ?? 0} accent="var(--color-tier-play)" />
        <StatCard label="Hit rate" value={formatPct(data.hit_rate * 100)} accent="var(--color-accent)" />
      </section>

      {data.by_tier.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">By conviction tier</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.by_tier.map((t) => (
              <div
                key={t.conviction}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4"
              >
                <ConvictionBadge conviction={t.conviction} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <Cell label="Total" value={t.n} />
                  <Cell label="Resolved" value={t.resolved} />
                  <Cell label="Hits" value={t.hits} />
                </div>
                <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Hit rate: {t.resolved > 0 ? formatPct((t.hits / t.resolved) * 100) : "—"} ·
                  Avg return: {t.avg_return_pct != null ? formatPct(t.avg_return_pct) : "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.recent_wins.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">Top winners</h2>
          <div className="space-y-2">
            {data.recent_wins.map((w) => (
              <Link
                key={w.id}
                to={`/calls/${w.id}`}
                className="tap flex items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 hover:border-[var(--color-border-strong)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{w.market_hint}</div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate">
                    {w.publish_date} · {w.episode_title} · {CONVICTION_LABELS[w.conviction]}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-lg font-semibold text-[var(--color-tier-play)]">
                    +{formatPct(w.realized_pct, 0)}
                  </div>
                  {w.stu_claimed_pct != null && Math.abs(w.stu_claimed_pct - w.realized_pct) > 0.5 && (
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Stu claimed: {formatPct(w.stu_claimed_pct, 0)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

export function Loading() {
  return <div className="text-[var(--color-text-muted)]">Loading…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
      Error: {message}
    </div>
  );
}
