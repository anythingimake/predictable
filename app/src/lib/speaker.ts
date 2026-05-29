// Speaker normalization. The pipeline stores `calls.speaker` as either "stu" or
// "guest:<Name>" (e.g. "guest:Dan Andros"). The UI needs a clean display label
// and a type so it can badge/filter guests distinctly from Stu's own calls.

export type SpeakerType = "stu" | "guest" | "other";

export interface ParsedSpeaker {
  type: SpeakerType;
  /** Display name: "Stu", "Dan Andros", etc. */
  label: string;
  /** The raw stored value, for use as a stable filter key. */
  raw: string;
}

export function parseSpeaker(raw: string | null | undefined): ParsedSpeaker {
  const s = (raw ?? "").trim();
  if (!s) return { type: "other", label: "Unknown", raw: "" };
  if (s.toLowerCase() === "stu") return { type: "stu", label: "Stu", raw: s };
  // "guest:Dan Andros" → "Dan Andros"
  const m = /^guest\s*:\s*(.+)$/i.exec(s);
  if (m) return { type: "guest", label: m[1].trim(), raw: s };
  // Unknown shape — show as-is rather than dropping information.
  return { type: "other", label: s, raw: s };
}

export const isGuestSpeaker = (raw: string | null | undefined): boolean =>
  parseSpeaker(raw).type !== "stu";
