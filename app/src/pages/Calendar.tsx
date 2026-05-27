import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { api } from "../api";
import type { CalendarEntry } from "../types";
import { ErrorBanner, Loading } from "./Scoreboard";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function sourceColor(source: string): string {
  const s = source.toLowerCase();
  if (s === "polymarket") return "#8b5cf6";
  if (s === "predictit") return "var(--color-mark)";
  // default: kalshi and unknowns
  return "var(--color-accent)";
}

function sourceLabel(source: string): string {
  const s = source.toLowerCase();
  if (s === "kalshi") return "Kalshi";
  if (s === "polymarket") return "Polymarket";
  if (s === "predictit") return "PredictIt";
  return source;
}

export function Calendar() {
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);

  useEffect(() => {
    api.calendar().then(setEntries).catch((e) => setErr(String(e)));
  }, []);

  const today = useMemo(() => new Date(), []);

  // Group entries by ISO yyyy-MM-dd for O(1) cell lookup.
  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    if (!entries) return map;
    for (const e of entries) {
      const key = format(parseISO(e.resolution_date), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [entries]);

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const panelEntries = useMemo(() => {
    if (!entries) return [];
    if (selected) {
      const key = format(selected, "yyyy-MM-dd");
      return entriesByDay.get(key) ?? [];
    }
    // No selection: show everything resolving in the current cursor month.
    return entries
      .filter((e) => isSameMonth(parseISO(e.resolution_date), cursor))
      .slice()
      .sort((a, b) => a.resolution_date.localeCompare(b.resolution_date));
  }, [entries, selected, cursor, entriesByDay]);

  if (err) return <ErrorBanner message={err} />;
  if (!entries) return <Loading />;

  const empty = entries.length === 0;
  const panelHeading = selected
    ? format(selected, "EEEE, MMM d, yyyy")
    : `${format(cursor, "MMMM yyyy")} — all resolutions`;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Resolution Calendar</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            When Stu's tracked markets resolve. Click a day to inspect it.
          </p>
        </div>
        <Legend />
      </div>

      {empty && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6">
          <p className="text-[var(--color-text-muted)]">No active calls awaiting resolution.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5">
        {/* Calendar grid */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
          <header className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">{format(cursor, "MMMM yyyy")}</h2>
            <div className="flex items-center gap-1">
              <NavButton onClick={() => setCursor((d) => subMonths(d, 1))} label="Previous month">
                {"<"}
              </NavButton>
              <NavButton
                onClick={() => {
                  setCursor(startOfMonth(today));
                  setSelected(today);
                }}
                label="Jump to today"
              >
                Today
              </NavButton>
              <NavButton onClick={() => setCursor((d) => addMonths(d, 1))} label="Next month">
                {">"}
              </NavButton>
            </div>
          </header>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_HEADERS.map((d) => (
              <div
                key={d}
                className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] text-center py-1"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEntries = entriesByDay.get(key) ?? [];
              const inMonth = isSameMonth(day, cursor);
              const isToday = isSameDay(day, today);
              const isSelected = selected != null && isSameDay(day, selected);
              return (
                <DayCell
                  key={key}
                  day={day}
                  entries={dayEntries}
                  inMonth={inMonth}
                  isToday={isToday}
                  isSelected={isSelected}
                  onClick={() => setSelected((cur) => (cur && isSameDay(cur, day) ? null : day))}
                />
              );
            })}
          </div>
        </section>

        {/* Side panel: chronological list, secondary to the grid */}
        <aside className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
          <header className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              {panelHeading}
            </h2>
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Clear
              </button>
            )}
          </header>
          <PanelList entries={panelEntries} />
        </aside>
      </div>
    </div>
  );
}

function DayCell({
  day,
  entries,
  inMonth,
  isToday,
  isSelected,
  onClick,
}: {
  day: Date;
  entries: CalendarEntry[];
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const hasEntries = entries.length > 0;
  const visible = entries.slice(0, 3);
  const overflow = entries.length - visible.length;

  // Layered classes — kept readable.
  const base =
    "relative flex flex-col items-stretch justify-between rounded-md border p-1.5 min-h-[64px] sm:min-h-[80px] text-left transition-colors";
  const bg = inMonth ? "bg-[var(--color-bg)]" : "bg-transparent";
  const text = inMonth ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]";
  const border = isToday
    ? "border-[var(--color-mark)]"
    : isSelected
    ? "border-[var(--color-accent)]"
    : "border-[var(--color-border)]";
  const hover = hasEntries
    ? "hover:border-[var(--color-border-strong)] cursor-pointer"
    : "hover:border-[var(--color-border-strong)] cursor-pointer";
  const glow = isToday ? "shadow-[0_0_0_2px_var(--color-mark-glow)]" : "";
  const ring = isSelected && !isToday ? "shadow-[0_0_0_2px_var(--color-accent-glow)]" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${bg} ${text} ${border} ${hover} ${glow} ${ring}`}
      aria-pressed={isSelected}
      aria-label={`${format(day, "EEEE, MMM d")}${hasEntries ? `, ${entries.length} resolving` : ""}`}
    >
      <div className="flex items-start justify-between">
        <span className={`text-xs ${isToday ? "font-semibold text-[var(--color-mark)]" : ""}`}>
          {format(day, "d")}
        </span>
        {hasEntries && (
          <span className="text-[10px] text-[var(--color-text-faint)]">{entries.length}</span>
        )}
      </div>
      {hasEntries && (
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {visible.map((e) => (
            <span
              key={e.market_id}
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: sourceColor(e.source) }}
              title={`${sourceLabel(e.source)}: ${e.question}`}
            />
          ))}
          {overflow > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)] leading-none">
              +{overflow}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function PanelList({ entries }: { entries: CalendarEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Nothing resolves on this date.
      </p>
    );
  }
  const today = new Date();
  return (
    <div className="space-y-2">
      {entries.map((e) => {
        const days = differenceInCalendarDays(parseISO(e.resolution_date), today);
        const dayLabel = days > 0 ? `in ${days}d` : days === 0 ? "today" : `${-days}d ago`;
        return (
          <div
            key={e.market_id}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
          >
            <div className="flex items-start gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
                style={{ background: sourceColor(e.source) }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug break-words">{e.question}</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1 flex flex-wrap gap-x-2">
                  <span>{sourceLabel(e.source)}</span>
                  <span>·</span>
                  <span>
                    {e.open_call_count} open call{e.open_call_count === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>{format(parseISO(e.resolution_date), "MMM d, yyyy")}</span>
                  <span>·</span>
                  <span>{dayLabel}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
      <LegendDot color="var(--color-accent)" label="Kalshi" />
      <LegendDot color="#8b5cf6" label="Polymarket" />
      <LegendDot color="var(--color-mark)" label="PredictIt" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function NavButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] transition-colors"
    >
      {children}
    </button>
  );
}
