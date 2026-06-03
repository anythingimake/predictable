import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Scoreboard", end: true },
  { to: "/election-night", label: "Tonight" },
  { to: "/calls", label: "Calls" },
  { to: "/episodes", label: "Episodes" },
];

const MORE: NavItem[] = [
  { to: "/calendar", label: "Calendar" },
  { to: "/sagas", label: "Sagas" },
  { to: "/calculator", label: "Calculator" },
  { to: "/guide", label: "Guide" },
  { to: "/about", label: "About" },
  { to: "/admin", label: "Admin" },
];

// Icons — tiny inline SVGs to avoid the lucide-react bundle cost on mobile-first paint.
function Icon({ name, className }: { name: string; className?: string }) {
  const common = {
    className,
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "Scoreboard":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 14l3-3 3 3 4-5" />
        </svg>
      );
    case "Tonight":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      );
    case "Calls":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
        </svg>
      );
    case "Episodes":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9l5 3-5 3z" fill="currentColor" />
        </svg>
      );
    case "Calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case "More":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

export function BottomTabBar() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [drawerOpen]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-20 backdrop-blur-md"
        style={{
          background: "rgba(7, 9, 26, 0.92)",
          borderTop: "1px solid var(--color-border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxShadow: "0 -4px 18px rgba(0, 0, 0, 0.35)",
        }}
        aria-label="Primary"
      >
        <ul className="flex items-stretch justify-around">
          {PRIMARY.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `tap flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium tracking-wide transition-colors ${
                    isActive
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`
                }
              >
                <Icon name={n.label} />
                <span>{n.label}</span>
              </NavLink>
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className={`tap w-full flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium tracking-wide transition-colors ${
                drawerOpen
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon name="More" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex items-end" role="dialog" aria-modal="true" aria-label="More navigation">
          <button
            type="button"
            aria-label="Close menu"
            className="drawer-backdrop absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="drawer-sheet relative w-full rounded-t-2xl border-t"
            style={{
              background: "var(--color-bg-elev)",
              borderColor: "var(--color-border)",
              maxHeight: "70vh",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <div className="flex justify-center pt-2 pb-1">
              <span
                className="block h-1 w-12 rounded-full"
                style={{ background: "var(--color-border-strong)" }}
                aria-hidden
              />
            </div>
            <div className="px-3 pb-4 pt-2 overflow-y-auto" style={{ maxHeight: "calc(70vh - 28px)" }}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] px-2 pb-2">
                More
              </div>
              <ul className="grid grid-cols-1 gap-1">
                {MORE.map((n) => (
                  <li key={n.to}>
                    <NavLink
                      to={n.to}
                      onClick={() => setDrawerOpen(false)}
                      className={({ isActive }) =>
                        `tap flex items-center px-3 rounded-md text-sm font-medium transition-colors ${
                          isActive
                            ? "text-[var(--color-text)] bg-[rgba(91,141,246,0.10)]"
                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.03)]"
                        }`
                      }
                    >
                      {n.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
