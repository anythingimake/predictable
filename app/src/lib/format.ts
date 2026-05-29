import type { Conviction } from "../types";

export const CONVICTION_LABELS: Record<Conviction, string> = {
  play: "The Play",
  solid: "Solid",
  flyer: "Flyer",
  watch: "Watch",
  opinion: "Opinion",
  pass: "Pass",
};

export const CONVICTION_COLORS: Record<Conviction, string> = {
  play: "var(--color-tier-play)",
  solid: "var(--color-tier-solid)",
  flyer: "var(--color-tier-flyer)",
  watch: "var(--color-tier-watch)",
  opinion: "var(--color-tier-opinion)",
  pass: "var(--color-tier-pass)",
};

export const CONVICTION_STARS: Record<Conviction, string> = {
  play: "★★★",
  solid: "★★",
  flyer: "★",
  watch: "◐",
  opinion: "◇",
  pass: "—",
};

export function formatSec(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatCents(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}¢`;
}

/**
 * Public URL for a market on its source exchange so users can go place/inspect
 * the bet themselves.
 *   - Polymarket: link to the EVENT page → polymarket.com/event/{event_slug}.
 *     The market `ticker` is the per-candidate MARKET slug, which 404s for
 *     multi-candidate events (e.g. a primary with one market per candidate), so
 *     we must use the event slug from meta_json. Fall back to ticker only if
 *     no event slug was captured (single-market events, where they're equal).
 *   - Kalshi: deep per-market URLs are unstable; link to the series page
 *     (first dash-delimited segment of the ticker, e.g. KXTXRSENRUNOFFMOV).
 *   - PredictIt: no clean per-market slug we capture → null.
 */
export function marketUrl(
  source: string | null | undefined,
  ticker: string | null | undefined,
  eventSlug?: string | null,
): string | null {
  if (!source || !ticker) return null;
  const s = source.trim().toLowerCase();
  if (s === "polymarket") return `https://polymarket.com/event/${eventSlug || ticker}`;
  if (s === "kalshi") {
    const series = ticker.split("-")[0].toLowerCase();
    return series ? `https://kalshi.com/markets/${series}` : null;
  }
  return null;
}

/**
 * Markets return a YES-side price in cents. For a NO/UNDER position, Stu's
 * contract price is the inverse: 100 - yesCents. For YES/OVER it's the YES
 * price unchanged. Use this to render "current mark" on the contract Stu
 * actually held, not the YES-side number from the order book.
 */
export function stuSideCents(
  side: string | null | undefined,
  yesCents: number | null | undefined,
): number | null {
  if (yesCents == null) return null;
  // Defensive: some data is stored as dollars (0..1) instead of cents (0..100).
  // Normalize to cents so the rest of the math is consistent.
  const cents = yesCents <= 1.5 ? yesCents * 100 : yesCents;
  const s = (side ?? "").toLowerCase();
  if (s === "no" || s === "under") return 100 - cents;
  return cents;
}

/** Unrealized return % from entry to current market mark, both on Stu's side. */
export function unrealizedPct(
  entryStuCents: number | null | undefined,
  currentStuCents: number | null | undefined,
): number | null {
  if (entryStuCents == null || currentStuCents == null || entryStuCents <= 0) return null;
  return ((currentStuCents - entryStuCents) / entryStuCents) * 100;
}

export function youtubeUrlAt(videoId: string, sec: number | null | undefined): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  if (sec == null) return base;
  return `${base}&t=${Math.floor(sec)}s`;
}

export function substackUrlAt(slug: string, sec: number | null | undefined): string {
  const base = `https://predictable.substack.com/p/${slug}`;
  if (sec == null) return base;
  return `${base}?t=${Math.floor(sec)}`;
}

/**
 * Formats an ISO date string safely.
 *
 * `new Date(null).toLocaleDateString()` returns "Invalid Date" which renders
 * ugly in comment bubbles / clarifications. Use this anywhere the source
 * field is nullable (Substack comments occasionally arrive with missing posted_at).
 */
export function formatDateSafe(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
  fallback = "—",
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString(undefined, opts);
}

export function formatDateTimeSafe(
  iso: string | null | undefined,
  fallback = "—",
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString();
}
