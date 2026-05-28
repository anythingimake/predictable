interface Props {
  tags: string[];
  className?: string;
}

/**
 * Compact, secondary-styled chips for the broad + specific tags on a call.
 * Uses the existing CSS-var tokens (muted text on surface fill) so the
 * chips read as metadata rather than primary content.
 *
 * Broad tags get a slight emphasis (bolder weight) since they're the
 * fixed-set high-signal taxonomy.
 */
export function TagChips({ tags, className = "" }: Props) {
  if (tags.length === 0) return null;
  const broadSet = new Set(["political", "event", "sports", "entertainment", "social", "fun"]);
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((t) => {
        const isBroad = broadSet.has(t);
        return (
          <span
            key={t}
            className={[
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
              "bg-[var(--color-surface)] text-[var(--color-text-muted)]",
              isBroad ? "font-semibold" : "font-normal",
            ].join(" ")}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
}
