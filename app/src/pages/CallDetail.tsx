import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { CallDetail as CallDetailData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { BackLink } from "../components/BackLink";
import { TagChips } from "../components/TagChips";
import { formatCents, formatDateSafe, formatPct, marketUrl, stuSideCents, unrealizedPct } from "../lib/format";
import { parseSpeaker } from "../lib/speaker";
import { ErrorBanner, Loading } from "./Scoreboard";

// Recharts is ~120 KB gzipped — defer it past first paint of CallDetail.
const LifecycleChart = lazy(() =>
  import("../components/LifecycleChart").then((m) => ({ default: m.LifecycleChart })),
);

const exLabel = (s: string | null | undefined): string =>
  s === "polymarket" ? "Polymarket" : s === "kalshi" ? "Kalshi" : s === "predictit" ? "PredictIt" : s ?? "";

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
  // 'closed' covers both a Stu exit AND a Stu-noted resolution, so don't
  // hard-code "(Stu exit)" — the STU EXIT card disambiguates ("sold here" vs
  // "held to settlement").
  closed: "Closed",
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
      {data.tags?.some((t) => t.startsWith("election-night-")) ? (
        <BackLink to="/election-night" label="Election Night" />
      ) : (
        <BackLink to="/calls" label="All calls" />
      )}
      <header>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <ConvictionBadge conviction={data.conviction} />
          <span className="text-xs text-[var(--color-text-faint)]">{data.side.toUpperCase()}</span>
          {data.size_disclosed && (
            <span className="text-xs text-[var(--color-text-muted)]">size: {data.size_disclosed}</span>
          )}
          <span className="text-xs text-[var(--color-text-faint)]">
            · {parseSpeaker(data.speaker).label}
            {parseSpeaker(data.speaker).type === "guest" && " (guest)"}
          </span>
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
              {" "}·{" "}
              {data.market_id ? (
                <Link to={`/markets/${encodeURIComponent(data.market_id)}`} className="underline">
                  {data.market_source} <code className="text-xs">{data.market_ticker}</code>
                </Link>
              ) : (
                <>
                  {data.market_source} <code className="text-xs">{data.market_ticker}</code>
                </>
              )}
            </>
          )}
        </p>
        {(marketUrl(data.market_source, data.market_ticker, data.market_event_slug) ||
          (data.sibling_source && marketUrl(data.sibling_source, data.sibling_ticker))) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {marketUrl(data.market_source, data.market_ticker, data.market_event_slug) && (
              <a
                href={marketUrl(data.market_source, data.market_ticker, data.market_event_slug)!}
                target="_blank"
                rel="noreferrer"
                className="tap inline-flex items-center gap-1 text-[var(--color-accent)]"
              >
                View on {exLabel(data.market_source)} ↗
              </a>
            )}
            {data.sibling_source && marketUrl(data.sibling_source, data.sibling_ticker) && (
              <a
                href={marketUrl(data.sibling_source, data.sibling_ticker)!}
                target="_blank"
                rel="noreferrer"
                className="tap inline-flex items-center gap-1 text-[var(--color-accent)]"
              >
                View on {exLabel(data.sibling_source)} ↗
              </a>
            )}
          </div>
        )}
        {data.sibling_price != null && (() => {
          const pm = stuSideCents(data.side, data.market_current_price ?? null);
          const sib = stuSideCents(data.side, data.sibling_price);
          if (pm == null && sib == null) return null;
          return (
            <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
              <span className="text-[var(--color-text-faint)]">His side · </span>
              {pm != null && <>{exLabel(data.market_source)} <span className="font-semibold tabular-nums">{formatCents(pm)}</span></>}
              {pm != null && sib != null && <span className="text-[var(--color-text-faint)]"> · </span>}
              {sib != null && <>{exLabel(data.sibling_source)} <span className="font-semibold tabular-nums">{formatCents(sib)}</span></>}
            </p>
          );
        })()}
        {data.tags && data.tags.length > 0 && <TagChips tags={data.tags} className="mt-2" />}
      </header>

      {data.admin_note && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-[var(--color-text-faint)] mr-2">Editor's note</span>
          <span className="text-[var(--color-text-muted)] whitespace-pre-wrap">{data.admin_note}</span>
        </div>
      )}

      {(() => {
        // Stu's exit cents = latest full `exit` event's price on his side.
        // `trim` is excluded — a partial trim isn't leaving the position (the
        // trim still shows in the Lifecycle list below).
        const exitEvent = [...data.events]
          .reverse()
          .find((e) => e.event_type === "exit" && e.price_pct != null);
        const stuExitCents = exitEvent?.price_pct ?? null;

        // Current mark on Stu's side. The market table holds YES-side cents;
        // for a NO position we flip to 100 - mark.
        const currentStuCents = stuSideCents(data.side, data.market_current_price);
        const entryEvent = data.events.find((e) => e.event_type === "entry");
        const entryCents = entryEvent?.price_pct ?? null;
        const currentReturn = unrealizedPct(entryCents, currentStuCents);

        const realized = data.realized_pct;
        const stuClaimed = data.stu_claimed_pct;

        // Did Stu actually put money in? play/solid/flyer are his "I'm in"
        // vocabulary; watch/opinion/pass are directional reads where he never
        // placed an order — so position framing ("held to settlement", "cost")
        // is wrong for those. Show N/A instead.
        const placedOrder = ["play", "solid", "flyer"].includes(data.conviction);

        return (
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              label="Entry"
              value={entryCents != null ? formatCents(entryCents) : "—"}
              sublabel={
                entryCents != null
                  ? placedOrder
                    ? `Stu's ${data.side.toUpperCase()} cost`
                    : `flagged ${data.side.toUpperCase()} here`
                  : undefined
              }
            />
            <Stat
              label="Stu Exit"
              value={!placedOrder ? "N/A" : stuExitCents != null ? formatCents(stuExitCents) : "—"}
              sublabel={
                !placedOrder
                  ? "no position taken"
                  : stuExitCents != null
                  ? "sold here"
                  : data.status === "open"
                  ? "still holding"
                  : "held to settlement"
              }
            />
            <Stat
              label="Current"
              value={currentStuCents != null ? formatCents(currentStuCents) : "—"}
              sublabel={
                // "live" only makes sense for an open position; a settled
                // market's "current" is just its terminal 0/100.
                data.status === "resolved"
                  ? "settled"
                  : currentReturn != null
                  ? `${currentReturn >= 0 ? "+" : ""}${currentReturn.toFixed(1)}% ${data.status === "open" ? "live" : "vs entry"}`
                  : undefined
              }
              accent={
                data.status !== "resolved" && currentReturn != null
                  ? currentReturn > 0
                    ? "var(--color-tier-play)"
                    : currentReturn < 0
                    ? "var(--color-tier-pass)"
                    : undefined
                  : undefined
              }
            />
            <Stat
              label="Realized"
              value={
                realized != null
                  ? formatPct(realized, 1)
                  : data.won != null
                  ? data.won
                    ? "Won"
                    : "Lost"
                  : "—"
              }
              accent={
                realized != null
                  ? realized > 0
                    ? "var(--color-tier-play)"
                    : realized < 0
                    ? "var(--color-tier-pass)"
                    : undefined
                  : data.won != null
                  ? data.won
                    ? "var(--color-tier-play)"
                    : "var(--color-tier-pass)"
                  : undefined
              }
              sublabel={
                realized == null && data.won != null
                  ? "no entry price stated"
                  : stuClaimed != null
                  ? `Stu: ${formatPct(stuClaimed, 0)}`
                  : undefined
              }
            />
            <Stat label="Status" value={STATUS_LABEL[data.status] ?? data.status} />
          </section>
        );
      })()}

      <section>
        <h2 className="text-base md:text-lg font-medium mb-3">
          Lifecycle
          <span className="ml-2 text-xs font-normal text-[var(--color-text-faint)]">
            · {data.events.length} {data.events.length === 1 ? "event" : "events"}
          </span>
        </h2>
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
                <div className="flex items-center gap-3 text-xs w-full sm:w-auto">
                  {data.youtube_id ? (
                    <a
                      href={`https://www.youtube.com/watch?v=${data.youtube_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="tap inline-flex items-center text-[var(--color-accent)]"
                    >
                      YouTube ↗
                    </a>
                  ) : data.substack_slug ? (
                    <a
                      href={`https://predictable.substack.com/p/${data.substack_slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="tap inline-flex items-center text-[var(--color-accent)]"
                    >
                      Substack ↗
                    </a>
                  ) : null}
                </div>
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

function Stat({
  label,
  value,
  accent,
  sublabel,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3">
      <div className="text-xs uppercase text-[var(--color-text-muted)]">{label}</div>
      <div className="text-lg font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
      {sublabel && (
        <div className="text-xs text-[var(--color-text-faint)] mt-0.5">{sublabel}</div>
      )}
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
