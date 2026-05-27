import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Call, Conviction } from "../types";
import { ConvictionBadge } from "../components/ConvictionBadge";
import { useStore } from "../store";
import { formatPct } from "../lib/format";
import { ErrorBanner, Loading } from "./Scoreboard";

const TIERS: Array<{ value: Conviction | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "play", label: "★★★ The Play" },
  { value: "solid", label: "★★ Solid" },
  { value: "flyer", label: "★ Flyer" },
  { value: "watch", label: "◐ Watch" },
  { value: "opinion", label: "◇ Opinion" },
  { value: "pass", label: "— Pass" },
];

const STATUSES: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved (hits/losses)" },
  { value: "closed", label: "Closed (Stu exit)" },
];

const SOURCES: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "kalshi", label: "Kalshi" },
  { value: "polymarket", label: "Polymarket" },
  { value: "predictit", label: "PredictIt" },
];

export function Calls() {
  const filter = useStore((s) => s.callsFilter);
  const setFilter = useStore((s) => s.setCallsFilter);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCalls(null);
    api.calls(filter).then(setCalls).catch((e) => setErr(String(e)));
  }, [filter]);

  const grouped = useMemo(() => {
    if (!calls) return [];
    const map = new Map<string, Call[]>();
    for (const c of calls) {
      const k = c.publish_date.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return Array.from(map.entries());
  }, [calls]);

  if (err) return <ErrorBanner message={err} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Calls</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Every position Stu has taken on the show.</p>
      </div>

      <FilterRow label="Status" options={STATUSES} value={filter.status ?? ""} onChange={(v) => setFilter({ ...filter, status: v || undefined })} />
      <FilterRow label="Source" options={SOURCES} value={(filter as any).market_source ?? ""} onChange={(v) => setFilter({ ...filter, market_source: v || undefined } as any)} />

      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {TIERS.map((t) => (
          <button
            key={t.value || "_all"}
            onClick={() => setFilter({ ...filter, conviction: t.value || undefined })}
            className={`tap inline-flex items-center px-3 py-2 sm:py-1 rounded-full text-sm sm:text-xs border transition-colors ${
              (filter.conviction ?? "") === t.value
                ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!calls && <Loading />}

      {calls && calls.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No calls match these filters.</p>
      )}

      {grouped.map(([date, dayCalls]) => (
        <section key={date}>
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">{date}</h3>
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

function FilterRow({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-faint)] mr-1">{label}:</span>
      {options.map((o) => (
        <button
          key={o.value || "_all"}
          onClick={() => onChange(o.value)}
          className={`tap inline-flex items-center px-3 py-1 rounded-full text-xs border transition-colors ${
            value === o.value
              ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-surface)]"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
