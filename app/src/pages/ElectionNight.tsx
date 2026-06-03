import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import type { Call } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { TagChips } from "../components/TagChips";
import { formatPct, stuSideCents, formatCents } from "../lib/format";
import { AddElectionCall, ElectionCallAdminControls } from "../components/ElectionAdmin";
import { ErrorBanner, Loading } from "./Scoreboard";

// ─── One-off page: June 2, 2026 primary election night ──────────────────────
// Everything Stu called LIVE on tonight's Predictable streams. Scoped by a
// single cohort tag so it's unambiguously just this election. (When we want
// future election nights, this becomes a parameterized route — not today.)
const ELECTION_TAG = "election-night-2026-06-02";
const ELECTION_TITLE = "June 2, 2026 Primary";

// Source livestreams (what "tonight" refers to).
const STREAMS = [
  { label: "Preview stream", url: "https://www.youtube.com/watch?v=987HQp26Ymo" },
  { label: "Results stream", url: "https://www.youtube.com/watch?v=eNXSbbpp030" },
];

// Race groupings, in display order. A call is placed by its `race:*` tag.
const RACES: Array<{ tag: string; label: string; blurb: string }> = [
  { tag: "race:ca-governor", label: "California Governor", blurb: "Top-2 jungle primary" },
  { tag: "race:la-mayor", label: "Los Angeles Mayor", blurb: "Bass · Pratt · Raman" },
  { tag: "race:nj-senate", label: "New Jersey Senate", blurb: "GOP primary upset watch" },
  { tag: "race:iowa-governor", label: "Iowa Governor", blurb: "Trump-endorsement thesis" },
  { tag: "race:iowa-senate", label: "Iowa Senate", blurb: "" },
  { tag: "race:texas-senate", label: "Texas Senate", blurb: "November value buy" },
];

const EXCHANGE: Record<string, string> = { kalshi: "Kalshi", polymarket: "Polymarket", predictit: "PredictIt" };

// Parse the admin endpoint's JSON-stringified `tags` into a string[] so admin-only
// (hidden) rows can be placed into race groups just like public rows.
function parseAdminTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    /* ignore */
  }
  return [];
}

export function ElectionNight() {
  const adminToken = useStore((s) => s.adminToken);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Loads tonight's calls. Public path = /api/calls (hides hidden calls, carries
  // live prices). In admin mode we ALSO pull /api/admin/calls for this cohort so
  // hidden calls stay visible (greyed, with an "unhide" control) and every card
  // gets its `hidden` flag — merging admin-only rows on top of the public set.
  const load = useCallback(async () => {
    try {
      const pub = await api.calls({ tag: ELECTION_TAG });
      if (!adminToken) {
        setCalls(pub);
        return;
      }
      const r = await fetch("/api/admin/calls", { headers: { authorization: `Bearer ${adminToken}` } });
      if (!r.ok) {
        // Token rejected / endpoint down: fall back to the public view.
        setCalls(pub);
        return;
      }
      const adminRows: Array<Record<string, unknown>> = await r.json();
      const byId = new Map<number, Call>();
      for (const c of pub) byId.set(c.id, c);
      for (const a of adminRows) {
        const tags = parseAdminTags(a.tags);
        if (!tags.includes(ELECTION_TAG)) continue; // only tonight's cohort
        const id = a.id as number;
        const existing = byId.get(id);
        if (existing) {
          // Keep the rich public row (live price etc.), just stamp the hidden flag.
          byId.set(id, { ...existing, hidden: a.hidden ? 1 : 0, tags });
        } else {
          // Admin-only (typically hidden) row: synthesize a minimal Call so it renders.
          byId.set(id, {
            id,
            market_id: (a.market_id as string | null) ?? null,
            market_hint: (a.market_hint as string) ?? "",
            episode_id: (a.episode_id as string) ?? "",
            first_event_ts: null,
            side: ((a.side as string) ?? "yes") as Call["side"],
            conviction: ((a.conviction as string) ?? "solid") as Call["conviction"],
            size_disclosed: null,
            speaker: "",
            status: ((a.status as string) ?? "open") as Call["status"],
            realized_pct: (a.realized_pct as number | null) ?? null,
            stu_claimed_pct: null,
            publish_date: (a.publish_date as string) ?? "",
            episode_title: (a.episode_title as string) ?? "",
            tags,
            hidden: a.hidden ? 1 : 0,
          });
        }
      }
      setCalls(Array.from(byId.values()));
    } catch (e) {
      setErr(String(e));
    }
  }, [adminToken]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    if (!calls) return [];
    const placed = new Set<number>();
    const out: Array<{ label: string; blurb: string; items: Call[] }> = [];
    for (const r of RACES) {
      const items = calls.filter((c) => (c.tags ?? []).includes(r.tag));
      items.forEach((c) => placed.add(c.id));
      if (items.length) out.push({ label: r.label, blurb: r.blurb, items });
    }
    // Anything without a known race tag falls into "Other".
    const rest = calls.filter((c) => !placed.has(c.id));
    if (rest.length) out.push({ label: "Other races", blurb: "", items: rest });
    return out;
  }, [calls]);

  if (err) return <ErrorBanner message={err} />;

  return (
    <div className="space-y-6">
      {/* Unmistakable election-night banner */}
      <header
        className="rounded-xl border px-5 py-5 sm:px-6 sm:py-6"
        style={{
          borderColor: "rgba(91,141,246,0.35)",
          background:
            "linear-gradient(135deg, rgba(91,141,246,0.12) 0%, rgba(13,17,38,0.6) 45%, rgba(245,158,11,0.10) 100%)",
        }}
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          <span>🗳️ Election Night</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(239,68,68,0.15)] px-2 py-0.5 text-[10px] text-[#f87171]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#f87171]" />
            LIVE
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{ELECTION_TITLE}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Every position Stu called <strong className="text-[var(--color-text)]">live on tonight's stream</strong> —
          and nothing else. Prices refresh every 2 minutes as the returns come in.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-[var(--color-text-faint)]">Tonight's livestreams:</span>
          {STREAMS.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="tap inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
            >
              ▶ {s.label} ↗
            </a>
          ))}
        </div>
      </header>

      {/* Admin-only: add tonight's calls inline. Hidden for normal visitors. */}
      {adminToken && (
        <AddElectionCall
          token={adminToken}
          races={RACES.map((r) => ({ tag: r.tag, label: r.label }))}
          onCreated={load}
        />
      )}

      {!calls && <Loading />}

      {calls && calls.length === 0 && (
        <p className="text-[var(--color-text-muted)]">
          Tonight's calls are being loaded in — check back in a moment.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.label}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-base font-semibold md:text-lg">{g.label}</h2>
            {g.blurb && <span className="text-xs text-[var(--color-text-faint)]">· {g.blurb}</span>}
            <span className="text-xs text-[var(--color-text-faint)]">
              · {g.items.length} {g.items.length === 1 ? "call" : "calls"}
            </span>
          </div>
          <div className="space-y-2">
            {g.items.map((c) => (
              <div key={c.id} className={c.hidden ? "opacity-60" : undefined}>
                <ElectionCallCard call={c} />
                {adminToken && (
                  <ElectionCallAdminControls token={adminToken} call={c} onChanged={load} />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {calls && calls.length > 0 && (
        <p className="pt-2 text-center text-xs text-[var(--color-text-faint)]">
          {calls.length} calls from tonight's primary · unofficial fan tracker · not investment advice
        </p>
      )}
    </div>
  );
}

// The side Stu took, as a loud color-coded pill so you can tell at a glance which
// way he's betting. YES/OVER = green, NO/UNDER = red. This is meant to dominate
// the row (after the candidate name) — no more easy-to-miss faint grey text.
function SideBadge({ side }: { side: string }) {
  const s = side.toLowerCase();
  const positive = s === "yes" || s === "over";
  // #22c55e (win/play green) vs #ef4444 (loss red) — matches the site's status colors.
  const color = positive ? "var(--color-status-resolved-win)" : "var(--color-status-resolved-loss)";
  const bg = positive ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)";
  const border = positive ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold uppercase leading-none tracking-wide"
      style={{ backgroundColor: bg, color, border: `1px solid ${border}` }}
    >
      <span className="text-[9px] font-semibold tracking-wider opacity-60">STU</span>
      {side.toUpperCase()}
    </span>
  );
}

// Compact call card with the live market price on Stu's side. Mirrors the Calls
// page card so it feels native, but trimmed for the election context.
function ElectionCallCard({ call: c }: { call: Call }) {
  const liveCents = stuSideCents(c.side, c.market_current_price ?? null);
  const resolved = c.status === "resolved" || c.status === "closed";
  return (
    <Link
      to={`/calls/${c.id}`}
      className="tap flex items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-3 hover:border-[var(--color-border-strong)] sm:px-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ConvictionBadge conviction={c.conviction} showLabel={false} />
          <span className="truncate font-medium">{c.market_hint}</span>
          <SideBadge side={c.side} />
        </div>
        {c.tags && c.tags.length > 0 && (
          <TagChips tags={c.tags.filter((t) => t !== ELECTION_TAG && !t.startsWith("race:"))} className="mt-1.5" />
        )}
        {c.quote && (
          <p className="mt-1.5 text-xs italic leading-snug text-[var(--color-text-muted)]">“{c.quote}”</p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5 text-right">
        {/* Outcome if settled, else the live price on Stu's side */}
        {c.realized_pct != null ? (
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: c.realized_pct > 0 ? "var(--color-status-resolved-win)" : "var(--color-status-resolved-loss)" }}
          >
            {c.realized_pct > 0 ? "+" : ""}
            {formatPct(c.realized_pct, 0)}
          </span>
        ) : c.won != null ? (
          <span
            className="text-sm font-semibold"
            style={{ color: c.won ? "var(--color-status-resolved-win)" : "var(--color-status-resolved-loss)" }}
          >
            {c.won ? "Won" : "Lost"}
          </span>
        ) : liveCents != null ? (
          <>
            <span className="text-sm font-semibold tabular-nums">{formatCents(liveCents)}</span>
            <span className="text-[10px] uppercase text-[var(--color-text-faint)]">
              {EXCHANGE[c.market_source ?? ""] ?? "live"} · his side
            </span>
            {(() => {
              const sib = c.sibling_price != null ? stuSideCents(c.side, c.sibling_price) : null;
              return sib != null ? (
                <span className="text-[10px] text-[var(--color-text-faint)]">
                  {EXCHANGE[c.sibling_source ?? ""] ?? "alt"} {formatCents(sib)}
                </span>
              ) : null;
            })()}
          </>
        ) : (
          <span className="text-xs text-[var(--color-text-faint)]">{c.status}</span>
        )}
        {resolved && c.realized_pct == null && c.won == null && (
          <span className="text-[10px] text-[var(--color-text-faint)]">settled</span>
        )}
      </div>
    </Link>
  );
}
