import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Episode } from "../types";
import { formatSec } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

function formatPubDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type EpisodeFilter = "all" | "episodes" | "posts";

export function Episodes() {
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<EpisodeFilter>("all");

  useEffect(() => {
    api.episodes().then(setEps).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!eps) return <Loading />;

  const counts = {
    all: eps.length,
    episodes: eps.filter((e) => e.type !== "article").length,
    posts: eps.filter((e) => e.type === "article").length,
  };
  const shown = eps.filter((e) =>
    filter === "all" ? true : filter === "posts" ? e.type === "article" : e.type !== "article",
  );

  const TABS: { key: EpisodeFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "episodes", label: "Episodes" },
    { key: "posts", label: "Posts" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Episodes</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {counts.episodes} podcast episodes · {counts.posts} written posts since Predictable launched.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`tap inline-flex items-center px-3 py-2 sm:py-1 rounded-full text-sm sm:text-xs border transition-colors ${
              filter === t.key
                ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label} <span className="ml-1 opacity-60">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No {filter === "posts" ? "posts" : "episodes"} yet.</p>
      ) : (
      <div className="grid grid-cols-1 gap-2">
        {shown.map((e) => (
          <Link
            key={e.id}
            to={`/episodes/${e.id}`}
            className="tap flex items-start gap-3 sm:gap-4 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 sm:p-4 hover:border-[var(--color-border-strong)]"
          >
            {e.cover_image_url && (
              <img
                src={e.cover_image_url}
                alt=""
                className="w-14 h-14 sm:w-20 sm:h-20 rounded object-cover flex-shrink-0"
                loading="lazy"
                decoding="async"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] flex-wrap">
                <span>{formatPubDate(e.publish_date)}</span>
                {/* Articles are text-only — no audio duration to show. */}
                {e.type !== "article" && (
                  <>
                    <span>·</span>
                    <span>{formatSec(e.duration_sec)}</span>
                  </>
                )}
                <span>·</span>
                {e.type === "article" ? (
                  <span className="inline-flex items-center rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 font-medium uppercase tracking-wide text-[var(--color-accent)]">
                    Article
                  </span>
                ) : (
                  <span className="uppercase">{e.type}</span>
                )}
              </div>
              <h3 className="font-medium mt-1 text-[var(--color-text)] text-sm md:text-base">{e.title}</h3>
              {e.megaphone_title && e.megaphone_title !== e.title && (
                <div className="text-xs text-[var(--color-text-faint)] mt-0.5 truncate">Pod: {e.megaphone_title}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
