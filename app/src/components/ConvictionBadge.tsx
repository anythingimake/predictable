import type { Conviction } from "../types";
import { CONVICTION_COLORS, CONVICTION_LABELS, CONVICTION_STARS } from "../lib/format";

export function ConvictionBadge({ conviction, showLabel = true }: { conviction: Conviction; showLabel?: boolean }) {
  const color = CONVICTION_COLORS[conviction];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, borderColor: color, borderWidth: 1, borderStyle: "solid", background: "rgba(255,255,255,0.02)" }}
    >
      <span>{CONVICTION_STARS[conviction]}</span>
      {showLabel && <span>{CONVICTION_LABELS[conviction]}</span>}
    </span>
  );
}
