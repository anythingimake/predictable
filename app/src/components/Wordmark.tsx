import { Link } from "react-router-dom";

export function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5 group">
      <Logo />
      <div className="flex items-baseline gap-2">
        <span
          className="text-xl font-bold tracking-tight bg-clip-text text-transparent"
          style={{
            fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
            backgroundImage: "linear-gradient(135deg, var(--color-text) 0%, #b8c1e8 100%)",
            letterSpacing: "-0.02em",
          }}
        >
          Predictable
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-faint)] hidden sm:inline"
        >
          unofficial tracker
        </span>
      </div>
    </Link>
  );
}

function Logo() {
  return (
    <div className="relative w-7 h-7 rounded-md overflow-hidden flex-shrink-0"
         style={{
           background: "linear-gradient(135deg, #0d1126 0%, #1a2046 100%)",
           border: "1px solid var(--color-border)",
           boxShadow: "0 0 12px var(--color-mark-glow)",
         }}>
      <svg viewBox="0 0 28 28" className="w-full h-full">
        <defs>
          <linearGradient id="line-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#5b8df6" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <polyline
          points="4,22 9,15 13,17 18,8 24,12"
          fill="none"
          stroke="url(#line-grad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="8" r="2" fill="#22c55e" className="pulse-dot" />
      </svg>
    </div>
  );
}
