import { Link } from "react-router-dom";

/**
 * Prominent "back to list" pill used at the top of every detail page
 * (calls / episodes / markets / sagas). Bordered, accent on hover, real
 * tap target — not a tiny muted text link.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="tap inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3.5 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)] transition-colors"
    >
      <span aria-hidden className="text-[var(--color-accent)] text-base leading-none">←</span>
      {label}
    </Link>
  );
}
