import type {
  Call,
  CallDetail,
  CalendarEntry,
  Episode,
  EpisodeDetail,
  Market,
  Principle,
  PrincipleDetail,
  Scoreboard,
} from "./types";

const BASE = "/api";

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const qs = params
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined)) as Record<string, string>
      ).toString()
    : "";
  const r = await fetch(`${BASE}${path}${qs}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

export const api = {
  episodes: () => get<Episode[]>("/episodes"),
  episode: (id: string) => get<EpisodeDetail>(`/episodes/${id}`),

  calls: (filters?: { conviction?: string; status?: string; market?: string; category?: string }) =>
    get<Call[]>("/calls", filters),
  call: (id: number | string) => get<CallDetail>(`/calls/${id}`),

  markets: (filters?: { source?: string; category?: string; resolved?: string }) =>
    get<Market[]>("/markets", filters),
  market: (id: string) => get<Market & { calls: Call[]; price_history: { snapshot_date: string; price: number }[] }>(`/markets/${encodeURIComponent(id)}`),

  scoreboard: () => get<Scoreboard>("/scoreboard"),
  scoreboardHistory: () => get<Array<{ snapshot_date: string; hit_rate: number; bankroll_pct: number }>>("/scoreboard/history"),

  principles: () => get<Principle[]>("/principles"),
  principle: (id: number) => get<PrincipleDetail>(`/principles/${id}`),

  strategies: () => get<any[]>("/strategies"),
  sagas: () => get<any[]>("/sagas"),
  calendar: () => get<CalendarEntry[]>("/calendar"),
  mediaVsMarkets: () => get<any[]>("/media-vs-markets"),
  glossary: () => get<Array<{ term: string; definition: string }>>("/glossary"),
  search: (q: string) => get<{ episodes: any[]; calls: any[] }>("/search", { q }),
};
