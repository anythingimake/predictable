import { NavLink, Route, Routes } from "react-router-dom";
import { Scoreboard } from "./pages/Scoreboard";
import { Calls } from "./pages/Calls";
import { CallDetail } from "./pages/CallDetail";
import { Episodes } from "./pages/Episodes";
import { EpisodeDetail } from "./pages/EpisodeDetail";
import { Markets } from "./pages/Markets";
import { Principles } from "./pages/Principles";
import { Calendar } from "./pages/Calendar";
import { Calculator } from "./pages/Calculator";
import { Guide } from "./pages/Guide";
import { Admin } from "./pages/Admin";
import { About } from "./pages/About";
import { Wordmark } from "./components/Wordmark";

const NAV = [
  { to: "/", label: "Scoreboard", end: true },
  { to: "/calls", label: "Calls" },
  { to: "/episodes", label: "Episodes" },
  { to: "/markets", label: "Markets" },
  { to: "/principles", label: "Principles" },
  { to: "/calendar", label: "Calendar" },
  { to: "/calculator", label: "Calculator" },
  { to: "/guide", label: "Guide" },
  { to: "/about", label: "About" },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top ribbon — prominent link to the official show */}
      <a
        href="https://predictable.substack.com"
        target="_blank"
        rel="noreferrer"
        className="block text-center text-xs sm:text-sm font-medium px-3 py-2 transition-all hover:brightness-110"
        style={{
          background: "linear-gradient(90deg, #0a1a0e 0%, #0f2b1c 50%, #0a1a0e 100%)",
          borderBottom: "1px solid rgba(34, 197, 94, 0.25)",
          color: "#eef1ff",
        }}
      >
        <span className="opacity-80">📺 Watch the official show:</span>{" "}
        <span className="font-bold text-[#22c55e]">predictable.substack.com</span>
        <span className="opacity-80 ml-1">— by Stu Burguiere</span>
        <span className="ml-2 opacity-60">↗</span>
      </a>

      <header
        className="sticky top-0 z-10 backdrop-blur-md"
        style={{
          background: "rgba(7, 9, 26, 0.85)",
          borderBottom: "1px solid var(--color-border)",
          boxShadow: "0 1px 0 rgba(91, 141, 246, 0.06), 0 4px 24px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-6">
          <Wordmark />
          <nav
            className="flex items-stretch text-sm overflow-x-auto no-scrollbar h-10 rounded-md"
            style={{
              border: "1px solid var(--color-border)",
              background: "rgba(13, 17, 38, 0.4)",
            }}
          >
            {NAV.map((n, i) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `relative flex items-center px-3.5 font-medium tracking-[0.01em] transition-all duration-150 whitespace-nowrap ${
                    i > 0 ? "border-l border-[var(--color-border)]" : ""
                  } ${
                    isActive
                      ? "text-[var(--color-text)] bg-[rgba(91,141,246,0.08)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.02)]"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span>{n.label}</span>
                    {isActive && (
                      <span
                        className="absolute left-2 right-2 -bottom-[1px] h-[2px] rounded-full"
                        style={{
                          background: "linear-gradient(90deg, var(--color-accent), var(--color-mark))",
                          boxShadow: "0 0 8px var(--color-accent-glow)",
                        }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Scoreboard />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/calls/:id" element={<CallDetail />} />
          <Route path="/episodes" element={<Episodes />} />
          <Route path="/episodes/:id" element={<EpisodeDetail />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/principles" element={<Principles />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>

      <footer className="mt-12 border-t border-[var(--color-border)] py-8 text-xs text-[var(--color-text-faint)]">
        <div className="max-w-6xl mx-auto px-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-1.5 max-w-lg">
            <p className="font-medium text-[var(--color-text-muted)]">
              Unofficial fan project · not affiliated with Stu Burguiere or Predictable
            </p>
            <p>Nothing here is investment advice. Prediction markets carry real financial risk.</p>
          </div>
          <div className="flex gap-5 text-xs">
            <a href="https://predictable.substack.com" target="_blank" rel="noreferrer" className="hover:text-[var(--color-text)]">
              The Show ↗
            </a>
            <a href="https://github.com/anythingimake/predictable" target="_blank" rel="noreferrer" className="hover:text-[var(--color-text)]">
              Source ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
