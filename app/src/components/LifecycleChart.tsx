import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CallEvent } from "../types";

interface Props {
  priceHistory: Array<{ snapshot_date: string; price: number }>;
  events: CallEvent[];
  height?: number;
}

// Track viewport breakpoint to drop chart height on mobile (≥ above-fold real estate for events list).
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

const EVENT_COLOR: Record<CallEvent["event_type"], string> = {
  entry: "var(--color-tier-play)",
  add: "var(--color-tier-solid)",
  trim: "var(--color-tier-flyer)",
  exit: "var(--color-accent)",
  resolve: "var(--color-text-muted)",
  clarify: "var(--color-text-faint)",
};

export function LifecycleChart({ priceHistory, events, height }: Props) {
  const isMobile = useIsMobile();
  const chartHeight = height ?? (isMobile ? 180 : 240);
  // Snapshots are stored in cents (0..100). Some legacy rows may still be in
  // dollars (0..1); normalize defensively so the Y-axis can't blow up to 9999¢.
  const series = priceHistory.map((p) => ({
    date: p.snapshot_date,
    ts: new Date(p.snapshot_date).getTime(),
    cents: p.price <= 1.5 ? p.price * 100 : p.price,
  }));

  // Events carry no wall-clock date (timestamp_sec is seconds-into-episode),
  // so place markers by type across the price domain rather than guessing an
  // index: entry at the left edge, exit/resolve at the right, add/trim mid.
  // (The old index projection floated orphan dots when history was sparse.)
  const xMin = series.length ? series[0].ts : 0;
  const xMax = series.length ? series[series.length - 1].ts : 0;
  const xSpan = xMax - xMin || 1;
  const eventX = (type: CallEvent["event_type"]): number => {
    if (type === "entry") return xMin;
    if (type === "exit" || type === "resolve") return xMax;
    return xMin + xSpan * 0.5;
  };
  const eventDots = events
    .filter((e) => e.price_pct != null)
    .map((e) => ({ type: e.event_type, cents: e.price_pct!, ts: eventX(e.event_type) }));

  // Fewer than 4 snapshots can't draw a meaningful line (a resolved market
  // often only has its last couple of days backfilled). Show a clean
  // price-journey strip from the events instead of a flat stub + orphan dots.
  if (series.length < 4) {
    return <PriceJourney events={events} />;
  }

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <LineChart data={series} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          tick={{ fill: "var(--color-text-muted)", fontSize: isMobile ? 10 : 11 }}
          stroke="var(--color-border)"
          interval={isMobile ? "preserveStartEnd" : "preserveStartEnd"}
          minTickGap={isMobile ? 32 : 16}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}¢`}
          tick={{ fill: "var(--color-text-muted)", fontSize: isMobile ? 10 : 11 }}
          stroke="var(--color-border)"
          width={isMobile ? 32 : 40}
        />
        <Tooltip
          contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          formatter={(value: number) => [`${value.toFixed(1)}¢`, "Price"]}
          labelFormatter={(ts: number) => new Date(ts).toLocaleDateString()}
        />
        <Line
          type="monotone"
          dataKey="cents"
          stroke="var(--color-accent)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {eventDots.map((e, i) => (
          <ReferenceDot
            key={i}
            x={e.ts}
            y={e.cents}
            r={6}
            fill={EVENT_COLOR[e.type]}
            stroke="var(--color-bg)"
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

const EVENT_LABEL: Record<CallEvent["event_type"], string> = {
  entry: "Entry",
  add: "Add",
  trim: "Trim",
  exit: "Exit",
  resolve: "Resolved",
  clarify: "Clarify",
};

// Compact fallback when there isn't enough price history to draw a real line.
// Renders Stu's priced events as a left-to-right journey (Entry 9¢ → Resolved
// 0¢) so a thinly-backfilled market reads as intentional, not broken.
function PriceJourney({ events }: { events: CallEvent[] }) {
  const priced = events.filter((e) => e.price_pct != null);
  if (priced.length === 0) {
    return (
      <div className="h-[100px] flex items-center justify-center text-sm text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded">
        Daily price history will fill in after the next market snapshot.
      </div>
    );
  }
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
      <div className="flex items-center gap-2 flex-wrap">
        {priced.map((e, i) => (
          <div key={e.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--color-text-faint)]">→</span>}
            <div className="flex flex-col items-center">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: EVENT_COLOR[e.event_type] }}
              />
              <span className="text-xs text-[var(--color-text-muted)] mt-1 uppercase tracking-wide">
                {EVENT_LABEL[e.event_type] ?? e.event_type}
              </span>
              <span className="text-sm font-semibold tabular-nums">{e.price_pct!.toFixed(0)}¢</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)] mt-3">
        Full daily chart appears once the market has several days of snapshots.
      </p>
    </div>
  );
}
