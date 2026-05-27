import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { EpisodeDetail as EpisodeDetailData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { formatSec, substackUrlAt, youtubeUrlAt } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

export function EpisodeDetail() {
  const { id } = useParams<{ id: string }>();
  const [ep, setEp] = useState<EpisodeDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setEp(null);
    api.episode(id).then(setEp).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <ErrorBanner message={err} />;
  if (!ep) return <Loading />;

  return (
    <article className="space-y-6">
      <header className="flex items-start gap-4">
        {ep.cover_image_url && (
          <img src={ep.cover_image_url} alt="" className="w-28 h-28 rounded object-cover" />
        )}
        <div>
          <div className="text-xs text-[var(--color-text-muted)] uppercase">
            {ep.publish_date} · {formatSec(ep.duration_sec)} · {ep.type}
          </div>
          <h1 className="text-2xl font-semibold mt-1">{ep.title}</h1>
          <div className="flex gap-3 mt-2 text-sm">
            {ep.youtube_id && (
              <a href={youtubeUrlAt(ep.youtube_id, 0)} target="_blank" rel="noreferrer">
                YouTube ↗
              </a>
            )}
            {ep.substack_slug && (
              <a href={substackUrlAt(ep.substack_slug, null)} target="_blank" rel="noreferrer">
                Substack ↗
              </a>
            )}
            {ep.audio_url && (
              <a href={ep.audio_url} target="_blank" rel="noreferrer">
                MP3 ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {ep.calls.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Calls in this episode ({ep.calls.length})</h2>
          <div className="space-y-2">
            {ep.calls.map((c) => (
              <Link
                key={c.id}
                to={`/calls/${c.id}`}
                className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2 hover:border-[var(--color-border-strong)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ConvictionBadge conviction={c.conviction} showLabel={false} />
                  <span className="font-medium truncate">{c.market_hint}</span>
                  <span className="text-xs text-[var(--color-text-faint)]">{c.side.toUpperCase()}</span>
                </div>
                <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap ml-3">
                  @ {formatSec(c.first_event_ts ?? null)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {ep.substack_body && (
        <section>
          <h2 className="text-lg font-medium mb-2">Substack write-up</h2>
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {ep.substack_body}
          </div>
        </section>
      )}

      {ep.mentions.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Markets mentioned (no position)</h2>
          <ul className="space-y-1 text-sm">
            {ep.mentions.map((m) => (
              <li key={m.id} className="text-[var(--color-text-muted)]">
                <span className="font-mono text-xs">[{formatSec(m.timestamp_sec)}]</span>{" "}
                <span className="text-[var(--color-text)]">{m.market_hint}</span>
                {m.directional && (
                  <span className="ml-2 text-xs uppercase text-[var(--color-text-faint)]">
                    {m.directional}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ep.comments.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Discussion ({ep.comments.length})</h2>
          <div className="space-y-2">
            {ep.comments.map((c) => (
              <div
                key={c.id}
                className={`rounded border p-3 text-sm ${
                  c.is_stu ? "border-[var(--color-tier-play)]" : "border-[var(--color-border)]"
                } bg-[var(--color-bg-elev)]`}
              >
                <div className="text-xs text-[var(--color-text-muted)] mb-1">
                  {c.is_stu && "★ "}
                  {c.author} · {new Date(c.posted_at).toLocaleDateString()}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
