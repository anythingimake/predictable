import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Call, Conviction } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { MultiSelect } from "../components/MultiSelect";
import { TagChips } from "../components/TagChips";
import { useStore } from "../store";
import { formatPct } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

const TIERS: Array<{ value: Conviction; label: string }> = [
  { value: "play", label: "★★★ The Play" },
  { value: "solid", label: "★★ Solid" },
  { value: "flyer", label: "★ Flyer" },
  { value: "watch", label: "◐ Watch" },
  { value: "opinion", label: "◇ Opinion" },
  { value: "pass", label: "— Pass" },
];

// Two distinct end-of-life events worth distinguishing:
//   Exit  = Stu sold/trimmed and noted his exit price on the show (status='closed' in DB)
//   Settled = the market itself paid out (status='resolved' in DB)
const STATUSES = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Stu exited" },
  { value: "resolved", label: "Market settled" },
];

const SOURCES = [
  { value: "kalshi", label: "Kalshi" },
  { value: "polymarket", label: "Polymarket" },
  { value: "predictit", label: "PredictIt" },
];

const SIDES = [
  { value: "yes", label: "YES" },
  { value: "no", label: "NO" },
  { value: "over", label: "Over" },
  { value: "under", label: "Under" },
];

// Broad tags appear at the top of the Tag dropdown in this exact order
// (matches BROAD_TAGS in pipeline/extract/tag_taxonomy.py). Specific tags
// follow, alphabetized, separated by an em-dash hairline.
const BROAD_TAG_ORDER = ["political", "event", "sports", "social", "fun"] as const;
const BROAD_TAG_LABEL: Record<string, string> = {
  political: "Political",
  event: "Event",
  sports: "Sports",
  social: "Social",
  fun: "Fun",
};
const BROAD_TAG_SET = new Set<string>(BROAD_TAG_ORDER);

export function Calls() {
  const filter = useStore((s) => s.callsFilter);
  const setFilter = useStore((s) => s.setCallsFilter);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Pull every call once. All filtering happens client-side so multi-select
  // checkboxes don't have to round-trip the API per click.
  useEffect(() => {
    setCalls(null);
    api.calls().then(setCalls).catch((e) => setErr(String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!calls) return null;
    const q = query.trim().toLowerCase();
    const fromTs = filter.date_from ? Date.parse(`${filter.date_from}T00:00:00Z`) : null;
    const toTs = filter.date_to ? Date.parse(`${filter.date_to}T23:59:59Z`) : null;
    const statuses = filter.status ?? [];
    const sources = filter.market_source ?? [];
    const sides = filter.side ?? [];
    const tiers = filter.conviction ?? [];
    const tagsFilter = filter.tags ?? [];

    return calls.filter((c) => {
      if (statuses.length > 0 && !statuses.includes(c.status)) return false;
      if (sources.length > 0 && !sources.includes(c.market_source ?? "")) return false;
      if (sides.length > 0 && !sides.includes(c.side)) return false;
      if (tiers.length > 0 && !tiers.includes(c.conviction)) return false;
      // Tag filter is match-any: a call passes if at least one of its tags
      // is in the selected set. Matches the existing multi-select semantics
      // for status/source/side/tier.
      if (tagsFilter.length > 0) {
        const ct = c.tags ?? [];
        if (!ct.some((t) => tagsFilter.includes(t))) return false;
      }
      if (q) {
        const blob = `${c.market_hint ?? ""} ${c.episode_title ?? ""} ${c.market_ticker ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (fromTs != null || toTs != null) {
        const t = Date.parse(`${c.publish_date.slice(0, 10)}T12:00:00Z`);
        if (!Number.isNaN(t)) {
          if (fromTs != null && t < fromTs) return false;
          if (toTs != null && t > toTs) return false;
        }
      }
      return true;
    });
  }, [calls, query, filter]);

  // Build the tag-dropdown option list from the union of tags on currently
  // loaded calls — this way new specific tags surface automatically as the
  // pipeline writes them. Broad tags first (fixed order), then alphabetized
  // specific tags. A "separator" sentinel splits them so the dropdown can
  // render a visual divider.
  const tagOptions = useMemo(() => {
    const present = new Set<string>();
    for (const c of calls ?? []) {
      for (const t of c.tags ?? []) present.add(t);
    }
    const broad = BROAD_TAG_ORDER.filter((t) => present.has(t)).map((t) => ({
      value: t,
      label: BROAD_TAG_LABEL[t] ?? t,
    }));
    const specific = Array.from(present)
      .filter((t) => !BROAD_TAG_SET.has(t))
      .sort((a, b) => a.localeCompare(b))
      .map((t) => ({ value: t, label: t }));
    return [...broad, ...specific];
  }, [calls]);

  const grouped = useMemo(() => {
    if (!filtered) return [];
    const map = new Map<string, Call[]>();
    for (const c of filtered) {
      const k = c.publish_date.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const activeFilterCount =
    (filter.status?.length ?? 0) +
    (filter.market_source?.length ?? 0) +
    (filter.side?.length ?? 0) +
    (filter.conviction?.length ?? 0) +
    (filter.tags?.length ?? 0) +
    (filter.date_from ? 1 : 0) +
    (filter.date_to ? 1 : 0) +
    (query.trim() ? 1 : 0);

  if (err) return <ErrorBanner message={err} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Calls</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Every position Stu has taken on the show.
          {calls && filtered && filtered.length !== calls.length && (
            <span className="ml-1">Showing {filtered.length} of {calls.length}.</span>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search market or episode…"
            className="tap flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilter({}); setQuery(""); }}
              className="tap inline-flex items-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-2"
            >
              Clear {activeFilterCount}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <MultiSelect
            label="Status"
            options={STATUSES}
            selected={filter.status ?? []}
            onChange={(v) => setFilter({ ...filter, status: v.length ? v : undefined })}
          />
          <MultiSelect
            label="Source"
            options={SOURCES}
            selected={filter.market_source ?? []}
            onChange={(v) => setFilter({ ...filter, market_source: v.length ? v : undefined })}
          />
          <MultiSelect
            label="Side"
            options={SIDES}
            selected={filter.side ?? []}
            onChange={(v) => setFilter({ ...filter, side: v.length ? v : undefined })}
            emptyLabel="Any"
          />
          <MultiSelect
            label="Tier"
            options={TIERS}
            selected={filter.conviction ?? []}
            onChange={(v) => setFilter({ ...filter, conviction: v.length ? v : undefined })}
          />
          <MultiSelect
            label="Tag"
            options={tagOptions}
            selected={filter.tags ?? []}
            onChange={(v) => setFilter({ ...filter, tags: v.length ? v : undefined })}
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-wide text-[var(--color-text-faint)] mr-1">Date:</span>
          <DateInput
            value={filter.date_from ?? ""}
            onChange={(v) => setFilter({ ...filter, date_from: v || undefined })}
            placeholder="From"
          />
          <span className="text-xs text-[var(--color-text-faint)]">→</span>
          <DateInput
            value={filter.date_to ?? ""}
            onChange={(v) => setFilter({ ...filter, date_to: v || undefined })}
            placeholder="To"
          />
        </div>
      </div>

      {!filtered && <Loading />}

      {filtered && filtered.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No calls match these filters.</p>
      )}

      {grouped.map(([date, dayCalls]) => (
        <section key={date}>
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">{formatGroupDate(date)}</h3>
          <div className="space-y-2">
            {dayCalls.map((c) => (
              <Link
                key={c.id}
                to={`/calls/${c.id}`}
                className="tap flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-3 sm:px-4 hover:border-[var(--color-border-strong)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ConvictionBadge conviction={c.conviction} showLabel={false} />
                    <span className="font-medium truncate">{c.market_hint}</span>
                    <span className="text-xs text-[var(--color-text-faint)]">{c.side.toUpperCase()}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                    {c.episode_title}
                    {c.market_source && <span className="hidden sm:inline"> · {c.market_source}</span>}
                    {c.market_ticker && <span className="hidden sm:inline"> · {c.market_ticker}</span>}
                  </div>
                  {c.tags && c.tags.length > 0 && (
                    <TagChips tags={c.tags} className="mt-1.5" />
                  )}
                </div>
                <div className="text-right text-sm whitespace-nowrap ml-3 flex-shrink-0">
                  {c.realized_pct != null ? (
                    <span
                      className="font-semibold"
                      style={{
                        color:
                          c.realized_pct > 0
                            ? "var(--color-status-resolved-win)"
                            : "var(--color-status-resolved-loss)",
                      }}
                    >
                      {c.realized_pct > 0 ? "+" : ""}
                      {formatPct(c.realized_pct, 0)}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-faint)]">{c.status}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// "2026-05-27" → "Wed, May 27, 2026". Group keys are ISO dates from the API.
function formatGroupDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className="tap inline-flex items-center bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
    />
  );
}
