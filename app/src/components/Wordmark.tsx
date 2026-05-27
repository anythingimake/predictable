import { Link } from "react-router-dom";

export function Wordmark() {
  return (
    <Link to="/" className="tap flex items-center gap-2 sm:gap-3 group py-2 -my-2">
      <img
        src="/predictable-logo.png"
        alt="Predictable"
        className="h-6 sm:h-7 w-auto block"
        style={{ filter: "drop-shadow(0 0 6px rgba(34, 197, 94, 0.18))" }}
      />
      <UnofficialBadge />
    </Link>
  );
}

function UnofficialBadge() {
  return (
    <span
      className="inline-flex flex-col items-center text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded leading-[1.1]"
      style={{
        color: "#fbbf24",
        background: "rgba(251, 191, 36, 0.10)",
        border: "1px solid rgba(251, 191, 36, 0.35)",
        boxShadow: "0 0 8px rgba(251, 191, 36, 0.12)",
      }}
      title="Completely unauthorized fan project — not affiliated with the show"
    >
      <span>Completely</span>
      <span>Unauthorized!</span>
    </span>
  );
}
