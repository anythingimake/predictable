import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Episode } from "../types";
import { formatSec } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

export function Episodes() {
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.episodes().then(setEps).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!eps) return <Loading />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Episodes</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {eps.length} episodes since Predictable launched.
        </p>
      </div>
      <div className="space-y-2">
        {eps.map((e) => (
          <Link
            key={e.id}
            to={`/episodes/${e.id}`}
            className="flex items-start gap-4 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 hover:border-[var(--color-border-strong)]"
          >
            {e.cover_image_url && (
              <img
                src={e.cover_image_url}
                alt=""
                className="w-20 h-20 rounded object-cover flex-shrink-0"
                loading="lazy"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span>{e.publish_date}</span>
                <span>·</span>
                <span>{formatSec(e.duration_sec)}</span>
                <span>·</span>
                <span className="uppercase">{e.type}</span>
              </div>
              <h3 className="font-medium mt-1 text-[var(--color-text)]">{e.title}</h3>
              {e.megaphone_title && e.megaphone_title !== e.title && (
                <div className="text-xs text-[var(--color-text-faint)] mt-0.5">Pod: {e.megaphone_title}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
