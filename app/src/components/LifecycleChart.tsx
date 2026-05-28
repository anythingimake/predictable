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

  // Build event markers — match to the closest snapshot by date
  const eventDots = events
    .filter((e) => e.price_pct != null)
    .map((e) => ({
      type: e.event_type,
      cents: e.price_pct!,
      // Project event onto the price-history timeline by index proportion;
      // when price_history exists we just put it at its (sec → date) projection
      ts: series.length ? series[Math.min(events.indexOf(e), series.length - 1)].ts : 0,
    }));

  if (series.length === 0) {
    return (
      <div className="h-[120px] flex items-center justify-center text-sm text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded">
        No price history yet — market snapshots will populate after the daily cron run.
      </div>
    );
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
