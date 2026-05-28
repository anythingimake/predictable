import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { CallDetail as CallDetailData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { TagChips } from "../components/TagChips";
import { formatDateSafe, formatPct, formatSec, substackUrlAt, youtubeUrlAt } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

// Recharts is ~120 KB gzipped — defer it past first paint of CallDetail.
const LifecycleChart = lazy(() =>
  import("../components/LifecycleChart").then((m) => ({ default: m.LifecycleChart })),
);

const EVENT_GLYPH: Record<string, string> = {
  entry: "📥",
  add: "➕",
  trim: "✂",
  exit: "🏁",
  resolve: "🏁",
  clarify: "💬",
};

const EVENT_LABEL: Record<string, string> = {
  entry: "Entry",
  add: "Add",
  trim: "Trim",
  exit: "Exit",
  resolve: "Resolved",
  clarify: "Clarification",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed (Stu exit)",
  resolved: "Resolved",
};

export function CallDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CallDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setData(null);
    api.call(id).then(setData).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <ErrorBanner message={err} />;
  if (!data) return <Loading />;

  return (
    <article className="space-y-6">
      <Link
        to="/calls"
        className="tap md:hidden inline-flex items-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] -mt-1"
      >
        ← All calls
      </Link>
      <header>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <ConvictionBadge conviction={data.conviction} />
          <span className="text-xs text-[var(--color-text-faint)]">{data.side.toUpperCase()}</span>
          {data.size_disclosed && (
            <span className="text-xs text-[var(--color-text-muted)]">size: {data.size_disclosed}</span>
          )}
          <span className="text-xs text-[var(--color-text-faint)]">· {data.speaker}</span>
        </div>
        <h1 className="text-xl md:text-2xl font-semibold">{data.market_hint}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          From{" "}
          <Link to={`/episodes/${data.episode_id}`} className="underline">
            {data.episode_title}
          </Link>{" "}
          · {data.publish_date}
          {data.market_source && data.market_ticker && (
            <>
              {" "}· {data.market_source} <code className="text-xs">{data.market_ticker}</code>
            </>
          )}
        </p>
        {data.tags && data.tags.length > 0 && <TagChips tags={data.tags} className="mt-2" />}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Realized" value={data.realized_pct != null ? formatPct(data.realized_pct, 1) : "—"} accent={data.realized_pct != null && data.realized_pct > 0 ? "var(--color-tier-play)" : undefined} />
        <Stat label="Stu claimed" value={data.stu_claimed_pct != null ? formatPct(data.stu_claimed_pct, 1) : "—"} />
        <Stat label="Status" value={STATUS_LABEL[data.status] ?? data.status} />
        <Stat label="Events" value={data.events.length} />
      </section>

      <section>
        <h2 className="text-base md:text-lg font-medium mb-3">Lifecycle</h2>
        <div className="space-y-3">
          {data.events.map((e) => (
            <div
              key={e.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4"
            >
              <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg">{EVENT_GLYPH[e.event_type] ?? "•"}</span>
                  <span className="font-semibold text-sm">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                  {e.price_pct != null && (
                    <span className="text-sm text-[var(--color-text-muted)]">@ {e.price_pct.toFixed(1)}¢</span>
                  )}
                  {e.size_pct_of_pos != null && (
                    <span className="text-xs text-[var(--color-text-faint)]">
                      ({e.size_pct_of_pos}% of position)
                    </span>
                  )}
                </div>
                {data.youtube_id ? (
                  <a
                    href={youtubeUrlAt(data.youtube_id, e.timestamp_sec)}
                    target="_blank"
                    rel="noreferrer"
                    className="tap inline-flex items-center text-xs text-[var(--color-accent)] w-full sm:w-auto"
                  >
                    Jump to {formatSec(e.timestamp_sec)} ↗
                  </a>
                ) : data.substack_slug ? (
                  <a
                    href={substackUrlAt(data.substack_slug, e.timestamp_sec)}
                    target="_blank"
                    rel="noreferrer"
                    className="tap inline-flex items-center text-xs text-[var(--color-accent)] w-full sm:w-auto"
                  >
                    Open at {formatSec(e.timestamp_sec)} ↗
                  </a>
                ) : (
                  <span className="text-xs text-[var(--color-text-faint)]">{formatSec(e.timestamp_sec)}</span>
                )}
              </div>
              {e.quote && (
                <blockquote className="mt-2 pl-3 border-l-2 border-[var(--color-border-strong)] text-base md:text-sm text-[var(--color-text-muted)] italic leading-relaxed">
                  "{e.quote}"
                </blockquote>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base md:text-lg font-medium mb-2">Market price over time</h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 sm:p-4">
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[320px]">
              <Suspense fallback={<ChartSkeleton />}>
                <LifecycleChart priceHistory={data.price_history} events={data.events} />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {data.clarifications.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">Clarifications from comments</h2>
          <div className="space-y-2">
            {data.clarifications.map((c) => (
              <div
                key={c.id}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm"
              >
                <div className="text-[var(--color-text-muted)] text-xs mb-1">
                  {c.author} · {formatDateSafe(c.posted_at)}
                </div>
                <div className="text-[var(--color-text)]">{c.clarification}</div>
                {c.extracted_value && (
                  <div className="text-xs text-[var(--color-tier-play)] mt-1">→ {c.extracted_value}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.media.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">Referenced media</h2>
          <ul className="space-y-1 text-sm">
            {data.media.map((m) => (
              <li key={m.id}>
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer">
                    {m.outlet ? `[${m.outlet}] ` : ""}
                    {m.title || m.url}
                  </a>
                ) : (
                  <span>
                    {m.outlet && `[${m.outlet}] `}
                    {m.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3">
      <div className="text-xs uppercase text-[var(--color-text-muted)]">{label}</div>
      <div className="text-lg font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div
      className="h-[180px] md:h-[240px] rounded border border-dashed border-[var(--color-border)] flex items-center justify-center text-xs text-[var(--color-text-faint)]"
      aria-label="Loading chart"
    >
      Loading chart…
    </div>
  );
}
