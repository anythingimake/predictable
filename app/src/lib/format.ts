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
  const s = (side ?? "").toLowerCase();
  if (s === "no" || s === "under") return 100 - yesCents;
  return yesCents;
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
