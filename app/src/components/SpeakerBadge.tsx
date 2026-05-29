import { parseSpeaker } from "../lib/speaker";

// Small pill identifying who made a call. By default it renders ONLY for guests
// (Stu is the implicit author of his own tracker, so badging all 50+ of his calls
// would be noise) — pass `showStu` to force it on detail views where the author
// should always be explicit.
export function SpeakerBadge({
  speaker,
  showStu = false,
}: {
  speaker: string | null | undefined;
  showStu?: boolean;
}) {
  const { type, label } = parseSpeaker(speaker);
  if (type === "stu" && !showStu) return null;

  const isStu = type === "stu";
  const color = isStu ? "var(--color-text-muted)" : "#f59e0b"; // amber = guest
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, borderColor: color, borderWidth: 1, borderStyle: "solid", background: "rgba(255,255,255,0.02)" }}
      title={isStu ? "Stu" : `Guest: ${label}`}
    >
      <span aria-hidden>{isStu ? "★" : "👤"}</span>
      <span>{label}</span>
    </span>
  );
}
