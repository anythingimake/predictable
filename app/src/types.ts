// Mirrors api/src/schema.sql. Keep in sync.

export type Conviction = "play" | "solid" | "flyer" | "watch" | "opinion" | "pass";
export type CallStatus = "open" | "closed" | "resolved";
export type Side = "yes" | "no" | "over" | "under";
export type EventType = "entry" | "add" | "trim" | "exit" | "resolve" | "clarify";

export interface Episode {
  id: string;
  publish_date: string;
  type: "episode" | "livestream" | "short" | "guest" | "article";
  title: string;
  megaphone_title?: string | null;
  youtube_title?: string | null;
  substack_title?: string | null;
  youtube_id?: string | null;
  substack_slug?: string | null;
  audio_url?: string | null;
  duration_sec?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  cover_image_url?: string | null;
}

export interface Call {
  id: number;
  market_id: string | null;
  market_hint: string;
  episode_id: string;
  first_event_ts: number | null;
  side: Side;
  conviction: Conviction;
  size_disclosed: string | null;
  speaker: string;
  status: CallStatus;
  realized_pct: number | null;
  /** Outcome: 1=win, 0=loss, null=undetermined/open. Set even when realized_pct
   *  is null (a settled market gives win/loss without an entry price). */
  won?: number | null;
  stu_claimed_pct: number | null;
  publish_date: string;
  episode_title: string;
  /** Parsed from the API's `tags` field (JSON-stringified array). */
  tags?: string[];
  market_source?: string | null;
  market_ticker?: string | null;
  /** Polymarket EVENT slug (from meta_json) — the correct slug for the public event URL. */
  market_event_slug?: string | null;
  market_question?: string | null;
  /** YES-side market price in cents (0-100) from latest price snapshot. */
  market_current_price?: number | null;
  /** First spoken quote for this call (earliest call_event with a quote). */
  quote?: string | null;
  /** Cross-exchange sibling market's current price (other exchange, via meta_json.sibling_market_id). */
  sibling_price?: number | null;
  /** Cross-exchange sibling market's source (e.g. "kalshi" / "polymarket"). */
  sibling_source?: string | null;
  /** Cross-exchange sibling market's ticker. */
  sibling_ticker?: string | null;
  /** Admin-hidden from public views (only ever set on admin endpoints). */
  hidden?: number;
}

export interface CallEvent {
  id: number;
  timestamp_sec: number;
  event_type: EventType;
  price_pct: number | null;
  size_pct_of_pos: number | null;
  quote: string | null;
  raw_quote: string | null;
}

export interface Mention {
  id: number;
  market_hint: string;
  timestamp_sec: number;
  directional: "bullish" | "bearish" | "neutral" | "explainer" | null;
  quote: string | null;
}

export interface SourceMedia {
  id: number;
  url: string | null;
  source_type: string | null;
  outlet: string | null;
  title: string | null;
}

export interface CallDetail extends Call {
  events: CallEvent[];
  media: SourceMedia[];
  clarifications: Array<{
    id: number;
    clarification: string;
    extracted_value: string | null;
    author: string;
    comment_body: string;
    posted_at: string;
  }>;
  price_history: Array<{ snapshot_date: string; price: number; volume: number | null }>;
  youtube_id?: string | null;
  substack_slug?: string | null;
  audio_url?: string | null;
  duration_sec?: number | null;
  /** Inherited from Call.tags but the detail endpoint also includes it. */
  tags?: string[];
  /** Latest admin note for this call (scope_type='call'), surfaced publicly. */
  admin_note?: string | null;
}

export interface Market {
  id: string;
  source: string;
  ticker: string;
  question: string;
  category: string | null;
  resolution_date: string | null;
  resolved: 0 | 1;
  resolution: string | null;
  current_price: number | null;
  /** Polymarket EVENT slug (from meta_json) for the public event URL. */
  event_slug?: string | null;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  posted_at: string;
  is_stu: 0 | 1;
  parent_id: string | null;
}

export interface EpisodeDetail extends Episode {
  /** True if the episode has a stitched transcript (text itself isn't sent). */
  has_transcript?: boolean;
  substack_body?: string | null;
  chapter_json?: string | null;
  /** Same-date podcast episode this article writes up (set when type==='article'). */
  related_episode_id?: string | null;
  /** Same-date newsletter article about this episode (set when type!=='article'). */
  related_article_id?: string | null;
  calls: Array<Pick<Call, "id" | "market_hint" | "side" | "conviction" | "speaker" | "status" | "realized_pct" | "first_event_ts">>;
  mentions: Mention[];
  comments: Comment[];
}

export interface Scoreboard {
  total_calls: number;
  resolved_calls: number;
  hit_count: number;
  hit_rate: number;
  by_tier: Array<{
    conviction: Conviction;
    n: number;
    resolved: number;
    hits: number;
    avg_return_pct: number | null;
    is_actionable: boolean;
  }>;
  by_category: Array<{ category: string; n: number; resolved: number; hits: number }>;
  recent_wins: Array<{
    id: number;
    market_hint: string;
    realized_pct: number;
    stu_claimed_pct: number | null;
    conviction: Conviction;
    publish_date: string;
    episode_title: string;
  }>;
  recent_losses: Array<{
    id: number;
    market_hint: string;
    realized_pct: number;
    conviction: Conviction;
    publish_date: string;
    episode_title: string;
  }>;
}

export interface Principle {
  id: number;
  rule: string;
  rationale: string | null;
  first_episode_id: string | null;
  citation_count?: number;
}

export interface PrincipleDetail extends Principle {
  citations: Array<{
    episode_id: string;
    timestamp_sec: number | null;
    quote: string | null;
    episode_title: string;
    publish_date: string;
  }>;
}

export interface CalendarEntry {
  market_id: string;
  question: string;
  resolution_date: string;
  source: string;
  open_call_count: number;
  call_count?: number;
  call_id?: number | null;
  resolved?: number;
  resolution?: string | null;
  status?: "upcoming" | "awaiting" | "effective" | "resolved";
  effective_confidence?: string | null;
  effective_source?: string | null;
}

export interface Saga {
  id: number;
  name: string;
  market_id: string | null;
  market_question: string | null;
  market_source: string | null;
  status: string;
  episode_count: number;
}

export interface SagaDetail extends Saga {
  current_price: number | null;
  resolved: 0 | 1 | null;
  resolution: string | null;
  episodes: Array<{
    id: string;
    publish_date: string;
    episode_title: string;
    youtube_id: string | null;
    substack_slug: string | null;
  }>;
}

export interface ScoreboardHistoryPoint {
  snapshot_date: string;
  total_calls: number;
  resolved_calls: number;
  hit_count: number;
  hit_rate: number;
  bankroll_pct: number;
}
