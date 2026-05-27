import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Comment, EpisodeDetail as EpisodeDetailData } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { formatDateSafe, formatSec, substackUrlAt, youtubeUrlAt } from "../lib/format";
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
            {/* Prefer YouTube; fall back to Substack; never link raw MP3. */}
            {ep.youtube_id ? (
              <a href={youtubeUrlAt(ep.youtube_id, 0)} target="_blank" rel="noreferrer" className="tap inline-flex items-center">
                Watch on YouTube ↗
              </a>
            ) : ep.substack_slug ? (
              <a href={substackUrlAt(ep.substack_slug, null)} target="_blank" rel="noreferrer" className="tap inline-flex items-center">
                Read on Substack ↗
              </a>
            ) : null}
            {ep.youtube_id && ep.substack_slug && (
              <a href={substackUrlAt(ep.substack_slug, null)} target="_blank" rel="noreferrer" className="tap inline-flex items-center text-[var(--color-text-muted)]">
                Substack write-up ↗
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
          <details className="md:hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] group">
            <summary className="tap flex items-center justify-between cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <span>Read full write-up</span>
              <span className="text-xs opacity-60 group-open:rotate-180 transition-transform" aria-hidden>▼</span>
            </summary>
            <div className="px-4 pb-5 border-t border-[var(--color-border)] pt-4">
              <SubstackBody text={ep.substack_body} />
            </div>
          </details>
          <div className="hidden md:block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6">
            <SubstackBody text={ep.substack_body} />
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

      <CommentThread comments={ep.comments} />
    </article>
  );
}

// Render a Substack body as proper paragraphs + section headings.
// Body is plain text from html_to_text — split on blank lines, detect short
// title-case lines as headings, render the rest as paragraphs with spacing.
function SubstackBody({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      const looksLikeHeading =
        line.length <= 60 &&
        !/[.?!]$/.test(line) &&
        /^[A-Z0-9]/.test(line) &&
        line.split(" ").length <= 8;
      return { text: line, heading: looksLikeHeading };
    });
  }, [text]);

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[var(--color-text)]">
      {blocks.map((b, i) =>
        b.heading ? (
          <h3
            key={i}
            className="text-sm uppercase tracking-wide font-semibold text-[var(--color-accent)] pt-2 first:pt-0"
          >
            {b.text}
          </h3>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}

function isUsefulComment(c: Comment): boolean {
  // Always include Stu's replies — they're the high-value clarifications.
  if (c.is_stu === 1) return true;
  const body = (c.body ?? "").trim();
  // Filter out the noise: short reactions, "+1", "thanks", missed-the-stream chatter.
  if (body.length < 100) return false;
  // Require some real content signal — a question, a number, a market reference.
  return /[?]|\d|kalshi|polymarket|paxton|cornyn|primary|senate|margin|entry|exit|price|hit|miss/i.test(body);
}

function CommentThread({ comments }: { comments: Comment[] }) {
  // First pass: filter to useful + always-keep Stu replies.
  const useful = useMemo(() => {
    const byId = new Map(comments.map((c) => [c.id, c]));
    const kept = new Set<string>();
    for (const c of comments) {
      if (isUsefulComment(c)) kept.add(c.id);
    }
    // Also keep the parent of any kept Stu reply so the thread context survives.
    for (const c of comments) {
      if (kept.has(c.id) && c.parent_id && byId.has(c.parent_id)) kept.add(c.parent_id);
    }
    return comments.filter((c) => kept.has(c.id));
  }, [comments]);

  const { roots, childrenByParent } = useMemo(() => {
    const byId = new Map(useful.map((c) => [c.id, c]));
    const children = new Map<string, Comment[]>();
    const top: Comment[] = [];
    for (const c of useful) {
      if (c.parent_id && byId.has(c.parent_id)) {
        const arr = children.get(c.parent_id) ?? [];
        arr.push(c);
        children.set(c.parent_id, arr);
      } else {
        top.push(c);
      }
    }
    return { roots: top, childrenByParent: children };
  }, [useful]);

  if (useful.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-medium mb-1">Discussion highlights</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Only substantive Q&amp;A and Stu's replies. Full thread on{" "}
        <a href="https://predictable.substack.com" target="_blank" rel="noreferrer">Substack</a>.
      </p>
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
  const isStu = c.is_stu === 1;
  return (
    <div
      className={`rounded border p-3 text-sm ${
        isStu ? "border-[var(--color-tier-play)]" : "border-[var(--color-border)]"
      } bg-[var(--color-bg-elev)]`}
    >
      <div className="text-xs text-[var(--color-text-muted)] mb-1">
        {isStu ? (
          <span className="text-[var(--color-tier-play)] font-semibold">★ Stu's reply</span>
        ) : (
          <span>Listener</span>
        )}
        {c.posted_at && <> · {formatDateSafe(c.posted_at)}</>}
      </div>
      <div className="whitespace-pre-wrap break-words">{c.body}</div>
    </div>
  );
}
