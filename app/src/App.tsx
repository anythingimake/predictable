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

const NAV = [
  { to: "/", label: "Scoreboard", end: true },
  { to: "/calls", label: "Calls" },
  { to: "/episodes", label: "Episodes" },
  { to: "/markets", label: "Markets" },
  { to: "/principles", label: "Principles" },
  { to: "/calendar", label: "Calendar" },
  { to: "/calculator", label: "Calculator" },
  { to: "/guide", label: "Guide" },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elev)] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6 flex-wrap">
          <NavLink to="/" className="font-semibold text-lg text-[var(--color-text)]">
            Predictable<span className="text-[var(--color-text-faint)] font-normal text-sm ml-2">unofficial tracker</span>
          </NavLink>
          <nav className="flex gap-3 flex-wrap text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-2 py-1 rounded transition-colors ${
                    isActive
                      ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`
                }
              >
                {n.label}
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
        </Routes>
      </main>

      <footer className="border-t border-[var(--color-border)] py-6 text-xs text-[var(--color-text-faint)]">
        <div className="max-w-6xl mx-auto px-4 space-y-1">
          <p>
            Unofficial fan project. Not affiliated with Stu Burguiere or Predictable. Nothing here is investment advice.
          </p>
          <p>
            Source:{" "}
            <a href="https://github.com/anythingimake/predictable">github.com/anythingimake/predictable</a> ·
            Show: <a href="https://predictable.substack.com">predictable.substack.com</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
