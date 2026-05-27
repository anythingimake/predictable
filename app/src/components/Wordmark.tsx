import { Link } from "react-router-dom";

export function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-3 group">
      <UnofficialBadge side="left" />
      <img
        src="/predictable-logo.png"
        alt="Predictable"
        className="h-7 w-auto block"
        style={{ filter: "drop-shadow(0 0 6px rgba(34, 197, 94, 0.18))" }}
      />
      <UnofficialBadge side="right" />
    </Link>
  );
}

function UnofficialBadge({ side }: { side: "left" | "right" }) {
  return (
    <span
      className="text-[9.5px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded leading-none"
      style={{
        color: "#fbbf24",
        background: "rgba(251, 191, 36, 0.10)",
        border: "1px solid rgba(251, 191, 36, 0.35)",
        boxShadow: "0 0 8px rgba(251, 191, 36, 0.12)",
      }}
      title={side === "left" ? "Unofficial fan project" : "Not affiliated with the show"}
    >
      Unofficial
    </span>
  );
}
