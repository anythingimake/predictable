import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { CallDetail as CallDetailData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { LifecycleChart } from "../components/LifecycleChart";
import { formatPct, formatSec, substackUrlAt, youtubeUrlAt } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

const EVENT_GLYPH: Record<string, string> = {
  entry: "📥",
  add: "➕",
  trim: "✂",
  exit: "🏁",
  resolve: "🏁",
  clarify: "💬",
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
      <header>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <ConvictionBadge conviction={data.conviction} />
          <span className="text-xs text-[var(--color-text-faint)]">{data.side.toUpperCase()}</span>
          {data.size_disclosed && (
            <span className="text-xs text-[var(--color-text-muted)]">size: {data.size_disclosed}</span>
          )}
          <span className="text-xs text-[var(--color-text-faint)]">· {data.speaker}</span>
        </div>
        <h1 className="text-2xl font-semibold">{data.market_hint}</h1>
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
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Realized" value={data.realized_pct != null ? formatPct(data.realized_pct, 1) : "—"} accent={data.realized_pct != null && data.realized_pct > 0 ? "var(--color-tier-play)" : undefined} />
        <Stat label="Stu claimed" value={data.stu_claimed_pct != null ? formatPct(data.stu_claimed_pct, 1) : "—"} />
        <Stat label="Status" value={data.status} />
        <Stat label="Events" value={data.events.length} />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Price + events</h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
          <LifecycleChart priceHistory={data.price_history} events={data.events} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Lifecycle</h2>
        <div className="space-y-3">
          {data.events.map((e) => (
            <div
              key={e.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{EVENT_GLYPH[e.event_type] ?? "•"}</span>
                  <span className="font-medium uppercase text-sm">{e.event_type}</span>
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
                    className="text-xs text-[var(--color-accent)]"
                  >
                    Jump to {formatSec(e.timestamp_sec)} ↗
                  </a>
                ) : data.substack_slug ? (
                  <a
                    href={substackUrlAt(data.substack_slug, e.timestamp_sec)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--color-accent)]"
                  >
                    Open at {formatSec(e.timestamp_sec)} ↗
                  </a>
                ) : (
                  <span className="text-xs text-[var(--color-text-faint)]">{formatSec(e.timestamp_sec)}</span>
                )}
              </div>
              {e.quote && (
                <blockquote className="mt-2 pl-3 border-l-2 border-[var(--color-border-strong)] text-sm text-[var(--color-text-muted)] italic">
                  "{e.quote}"
                </blockquote>
              )}
            </div>
          ))}
        </div>
      </section>

      {data.clarifications.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Clarifications from comments</h2>
          <div className="space-y-2">
            {data.clarifications.map((c) => (
              <div
                key={c.id}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm"
              >
                <div className="text-[var(--color-text-muted)] text-xs mb-1">
                  {c.author} · {new Date(c.posted_at).toLocaleDateString()}
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
          <h2 className="text-lg font-medium mb-3">Referenced media</h2>
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
