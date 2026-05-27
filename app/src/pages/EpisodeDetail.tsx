import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Comment, EpisodeDetail as EpisodeDetailData } from "../types";
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
      <header className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
        {ep.cover_image_url && (
          <img
            src={ep.cover_image_url}
            alt=""
            className="w-20 h-20 sm:w-28 sm:h-28 rounded object-cover flex-shrink-0"
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="min-w-0">
          <div className="text-xs text-[var(--color-text-muted)] uppercase">
            {ep.publish_date} · {formatSec(ep.duration_sec)} · {ep.type}
          </div>
          <h1 className="text-xl md:text-2xl font-semibold mt-1">{ep.title}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 text-sm">
            {ep.youtube_id && (
              <a href={youtubeUrlAt(ep.youtube_id, 0)} target="_blank" rel="noreferrer" className="tap inline-flex items-center">
                YouTube ↗
              </a>
            )}
            {ep.substack_slug && (
              <a href={substackUrlAt(ep.substack_slug, null)} target="_blank" rel="noreferrer" className="tap inline-flex items-center">
                Substack ↗
              </a>
            )}
            {ep.audio_url && (
              <a href={ep.audio_url} target="_blank" rel="noreferrer" className="tap inline-flex items-center">
                MP3 ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {ep.calls.length > 0 && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-3">Calls in this episode ({ep.calls.length})</h2>
          <div className="space-y-2">
            {ep.calls.map((c) => (
              <Link
                key={c.id}
                to={`/calls/${c.id}`}
                className="tap flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-3 sm:px-4 sm:py-2 hover:border-[var(--color-border-strong)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ConvictionBadge conviction={c.conviction} showLabel={false} />
                  <span className="font-medium truncate">{c.market_hint}</span>
                  <span className="text-xs text-[var(--color-text-faint)]">{c.side.toUpperCase()}</span>
                </div>
                {c.first_event_ts != null && (
                  <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap ml-3 flex-shrink-0">
                    @ {formatSec(c.first_event_ts)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {ep.substack_body && (
        <section>
          <h2 className="text-base md:text-lg font-medium mb-2">Substack write-up</h2>
          {/* On mobile: collapsed by default to keep first-paint short. On md+: always open. */}
          <details className="md:hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] group">
            <summary className="tap flex items-center justify-between cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <span>Read full write-up</span>
              <span className="text-xs opacity-60 group-open:rotate-180 transition-transform" aria-hidden>▼</span>
            </summary>
            <div className="px-4 pb-4 text-base whitespace-pre-wrap leading-relaxed border-t border-[var(--color-border)] pt-3">
              {ep.substack_body}
            </div>
          </details>
          <div className="hidden md:block rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 text-sm whitespace-pre-wrap leading-relaxed">
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

      {ep.comments.length > 0 && <CommentThread comments={ep.comments} />}
    </article>
  );
}

function CommentThread({ comments }: { comments: Comment[] }) {
  // Group replies under their parents. Substack threads we've seen are shallow (1–2 deep),
  // so we render a single indented tier — anything orphaned (parent off this page) becomes top-level.
  const { roots, childrenByParent } = useMemo(() => {
    const byId = new Map(comments.map((c) => [c.id, c]));
    const children = new Map<string, Comment[]>();
    const top: Comment[] = [];
    for (const c of comments) {
      if (c.parent_id && byId.has(c.parent_id)) {
        const arr = children.get(c.parent_id) ?? [];
        arr.push(c);
        children.set(c.parent_id, arr);
      } else {
        top.push(c);
      }
    }
    return { roots: top, childrenByParent: children };
  }, [comments]);

  return (
    <section>
      <h2 className="text-lg font-medium mb-3">Discussion ({comments.length})</h2>
      <div className="space-y-2">
        {roots.map((c) => (
          <CommentNode key={c.id} comment={c} replies={childrenByParent.get(c.id) ?? []} />
        ))}
      </div>
    </section>
  );
}

function CommentNode({ comment: c, replies }: { comment: Comment; replies: Comment[] }) {
  return (
    <div className="space-y-2">
      <CommentBubble comment={c} />
      {replies.length > 0 && (
        <div className="ml-4 sm:ml-6 pl-3 border-l border-[var(--color-border)] space-y-2">
          {replies.map((r) => (
            <CommentBubble key={r.id} comment={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentBubble({ comment: c }: { comment: Comment }) {
  return (
    <div
      className={`rounded border p-3 text-sm ${
        c.is_stu ? "border-[var(--color-tier-play)]" : "border-[var(--color-border)]"
      } bg-[var(--color-bg-elev)]`}
    >
      <div className="text-xs text-[var(--color-text-muted)] mb-1">
        {c.is_stu ? "★ " : ""}
        {c.author} · {new Date(c.posted_at).toLocaleDateString()}
      </div>
      <div className="whitespace-pre-wrap break-words">{c.body}</div>
    </div>
  );
}
