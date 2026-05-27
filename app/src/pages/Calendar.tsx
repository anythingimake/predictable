import { useEffect, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { api } from "../api";
import type { CalendarEntry } from "../types";
import { ErrorBanner, Loading } from "./Scoreboard";

export function Calendar() {
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.calendar().then(setEntries).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!entries) return <Loading />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Resolution Calendar</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Active calls by market resolution date.
        </p>
      </div>
      {entries.length === 0 && (
        <p className="text-[var(--color-text-muted)]">No active calls awaiting resolution.</p>
      )}
      <div className="space-y-2">
        {entries.map((e) => {
          const days = differenceInCalendarDays(parseISO(e.resolution_date), new Date());
          return (
            <div
              key={e.market_id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{e.question}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {e.source} · {e.open_call_count} open call{e.open_call_count === 1 ? "" : "s"}
                </div>
              </div>
              <div className="text-right text-sm whitespace-nowrap">
                <div className="font-medium">{format(parseISO(e.resolution_date), "MMM d, yyyy")}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {days > 0 ? `${days}d` : days === 0 ? "today" : `${-days}d ago`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
