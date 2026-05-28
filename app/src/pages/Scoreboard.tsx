import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Scoreboard as ScoreboardData, ScoreboardHistoryPoint } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { useStore } from "../store";
import { formatPct } from "../lib/format";
import { CONVICTION_LABELS } from "../lib/format";

// The scoreboard counts only actionable tiers — keep this in sync with the
// API's ACTIONABLE filter so click-through lands on the same set.
const ACTIONABLE = ["play", "solid", "flyer"];
const RESOLVED_STATUSES = ["resolved", "closed"];

export function Scoreboard() {
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [history, setHistory] = useState<ScoreboardHistoryPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  const setCallsFilter = useStore((s) => s.setCallsFilter);

  // Set the shared Calls filter, then navigate there. The Calls page reads
  // this from the store on render, so the list lands pre-filtered.
  const goToCalls = (f: Parameters<typeof setCallsFilter>[0]) => {
    setCallsFilter(f);
    navigate("/calls");
  };

  useEffect(() => {
    api.scoreboard().then(setData).catch((e) => setErr(String(e)));
    // History is optional — a fresh DB has only 1 row so the sparkline just
    // renders nothing. Catch + swallow so a broken history endpoint doesn't
    // blank the scoreboard.
    api.scoreboardHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!data) return <Loading />;

  const empty = data.total_calls === 0;
  const misses = Math.max(0, (data.resolved_calls ?? 0) - (data.hit_count ?? 0));

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

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Actionable calls"
          value={data.total_calls}
          hint="play · solid · flyer"
          onClick={() => goToCalls({ conviction: ACTIONABLE })}
        />
        <StatCard
          label="Resolved"
          value={data.resolved_calls ?? 0}
          onClick={() => goToCalls({ conviction: ACTIONABLE, status: RESOLVED_STATUSES })}
        />
        <StatCard
          label="Hits"
          value={data.hit_count ?? 0}
          accent="var(--color-tier-play)"
          onClick={() => goToCalls({ conviction: ACTIONABLE, status: RESOLVED_STATUSES, result: ["win"] })}
        />
        <StatCard
          label="Misses"
          value={misses}
          accent={misses > 0 ? "var(--color-tier-pass)" : undefined}
          onClick={() => goToCalls({ conviction: ACTIONABLE, status: RESOLVED_STATUSES, result: ["loss"] })}
        />
        <StatCard
          label="Hit rate"
          value={formatPct(data.hit_rate * 100)}
          hint={(data.resolved_calls ?? 0) > 0 ? `${data.hit_count ?? 0}-${misses} record` : undefined}
          accent="var(--color-accent)"
          sparkline={history && history.length > 1 ? history.map((h) => h.hit_rate) : undefined}
          onClick={() => goToCalls({ conviction: ACTIONABLE, status: RESOLVED_STATUSES })}
        />
      </section>

      {data.by_tier.some((t) => t.is_actionable) && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-1">By conviction tier</h2>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Actionable positions only. Watch / opinion / pass are commentary, not bets — filter for them on the Calls page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.by_tier.filter((t) => t.is_actionable).map((t) => (
              <button
                key={t.conviction}
                onClick={() => goToCalls({ conviction: [t.conviction] })}
                className="tap text-left rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 hover:border-[var(--color-accent)] transition-colors"
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
              </button>
            ))}
          </div>
        </section>
      )}

      {data.recent_wins.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-1">Top wins</h2>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Resolved positions and exits Stu took at a profit, sorted by return.
          </p>
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
                    {formatShortDate(w.publish_date)} · {w.episode_title} · {CONVICTION_LABELS[w.conviction]}
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

      {data.recent_losses.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">Losses</h2>
          <div className="space-y-2">
            {data.recent_losses.map((l) => (
              <Link
                key={l.id}
                to={`/calls/${l.id}`}
                className="tap flex items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 hover:border-[var(--color-border-strong)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{l.market_hint}</div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate">
                    {formatShortDate(l.publish_date)} · {l.episode_title} · {CONVICTION_LABELS[l.conviction]}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-lg font-semibold text-[var(--color-status-resolved-loss)]">
                    {formatPct(l.realized_pct, 0)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, hint, sparkline, onClick }: { label: string; value: number | string; accent?: string; hint?: string; sparkline?: number[]; onClick?: () => void }) {
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-[var(--color-text-faint)] mt-1">{hint}</div>
      )}
      {sparkline && sparkline.length > 1 && (
        <Sparkline values={sparkline} color={accent ?? "var(--color-accent)"} />
      )}
    </>
  );
  const base = "rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4";
  if (onClick) {
    return (
      <button onClick={onClick} className={`tap text-left ${base} hover:border-[var(--color-accent)] transition-colors`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/**
 * Tiny inline-SVG sparkline. Zero deps — we already lazy-load Recharts for
 * the detail pages, but for a 4-card stat strip a hand-rolled SVG is faster
 * and uses no extra bundle.
 *
 * `values` are 0..1 hit-rates (latest = rightmost). Auto-scales to the
 * window's min/max with a tiny pad so a flat line is still visible.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 80;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.01);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 opacity-80"
      aria-label="Hit-rate trend"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

// "2026-05-27" → "May 27" (no year — we're showing recent activity, year is implied by context).
function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
      Error: {message}
    </div>
  );
}
