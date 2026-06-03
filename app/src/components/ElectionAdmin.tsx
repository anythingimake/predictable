import { useEffect, useMemo, useRef, useState } from "react";
import type { Call } from "../types";

// ─── Election Night admin mode ───────────────────────────────────────────────
// Self-contained admin affordances for the one-off Election Night page. Mirrors
// the idioms in pages/AdminCalls.tsx exactly:
//   • bearer token from the Zustand store (passed in as `token`)
//   • POST /api/admin/calls            → create a manual call
//   • PATCH /api/admin/calls/:id       → sparse field overrides + { hidden }
//   • DELETE /api/admin/calls/:id      → revert/delete (unused here; hide instead)
//   • GET /api/admin/markets/search?q= → live market search (built in parallel)
// Nothing here renders unless a token is present (the parent gates on that).

const SIDES = ["yes", "no"] as const;
const CONVICTIONS = ["play", "solid", "flyer", "watch", "opinion", "pass"] as const;
const STATUSES = ["open", "closed", "resolved"] as const;

// The two source livestreams = the two episodes a tonight-call can hang off.
// Results stream is the default (that's where live calls land once polls close).
const EPISODES = [
  { id: "youtube:eNXSbbpp030", label: "Results stream" },
  { id: "youtube:987HQp26Ymo", label: "Preview stream" },
] as const;

const ELECTION_TAG = "election-night-2026-06-02";

const inputCls =
  "tap mt-0.5 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-sm";

// Shape returned by GET /api/admin/markets/search?q=<text> (contract fixed in parallel).
interface MarketSearchResult {
  id: string;
  question: string;
  current_price: number | null;
  source: string;
  resolved: number | boolean;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ─── Live market search box ──────────────────────────────────────────────────
// Debounced lookup against /api/admin/markets/search. Clicking a result lifts
// the chosen market id to the parent form via onPick.
function MarketSearch({
  token,
  marketId,
  onPick,
}: {
  token: string;
  marketId: string;
  onPick: (id: string, label: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MarketSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/markets/search?q=${encodeURIComponent(s)}`, { headers: authHeaders(token) })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: MarketSearchResult[]) => {
          if (mine !== seq.current) return; // a newer keystroke won
          setResults(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  return (
    <div className="col-span-2 text-xs">
      <div className="flex items-center justify-between">
        <span>Link a market</span>
        {marketId ? (
          <span className="text-[10px] text-[var(--color-status-resolved-win)]">
            linked: {pickedLabel ? `${pickedLabel} · ` : ""}
            <code className="text-[var(--color-text-muted)]">{marketId}</code>
            <button
              type="button"
              onClick={() => {
                onPick("", "");
                setPickedLabel(null);
              }}
              className="tap ml-2 text-[var(--color-text-faint)] underline"
            >
              clear
            </button>
          </span>
        ) : (
          <span className="text-[10px] text-[var(--color-text-faint)]">none linked (optional)</span>
        )}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search markets by question…"
        className={inputCls}
      />
      {loading && <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Searching…</p>}
      {results && results.length === 0 && !loading && (
        <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">No markets match “{q.trim()}”.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-1">
          {results.slice(0, 20).map((m) => {
            const label = m.question || m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(m.id, label);
                    setPickedLabel(label);
                    setQ("");
                    setResults(null);
                  }}
                  className={`tap block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-[var(--color-bg)] ${
                    marketId === m.id ? "ring-1 ring-[var(--color-accent)]" : ""
                  }`}
                >
                  <span className="block truncate">{label}</span>
                  <span className="block text-[10px] text-[var(--color-text-faint)]">
                    {m.source}
                    {m.current_price != null ? ` · ${Math.round(m.current_price)}¢` : ""}
                    {m.resolved ? " · resolved" : ""} · <code>{m.id}</code>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Add tonight's call ──────────────────────────────────────────────────────
export function AddElectionCall({
  token,
  races,
  onCreated,
}: {
  token: string;
  races: Array<{ tag: string; label: string }>;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    market_hint: "",
    race: races[0]?.tag ?? "",
    side: "yes" as (typeof SIDES)[number],
    conviction: "solid" as (typeof CONVICTIONS)[number],
    entry_price: "",
    episode_id: EPISODES[0].id as string,
    market_id: "",
  });

  function reset() {
    setF({
      market_hint: "",
      race: races[0]?.tag ?? "",
      side: "yes",
      conviction: "solid",
      entry_price: "",
      episode_id: EPISODES[0].id,
      market_id: "",
    });
    setErr(null);
  }

  async function submit() {
    if (!f.market_hint.trim()) {
      setErr("Market hint is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    // `race` is one of the RACES tags ("race:ca-governor"); strip the prefix so
    // we don't double it when assembling the canonical tag set.
    const raceSlug = f.race.startsWith("race:") ? f.race.slice("race:".length) : f.race;
    const tags = ["political", ELECTION_TAG, `race:${raceSlug}`];
    const body: Record<string, unknown> = {
      episode_id: f.episode_id,
      market_hint: f.market_hint.trim(),
      side: f.side,
      conviction: f.conviction,
      status: "open",
      entry_price: f.entry_price === "" ? null : Number(f.entry_price),
      market_id: f.market_id || null,
      tags,
    };
    try {
      const r = await fetch("/api/admin/calls", {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setErr(`POST ${r.status}`);
        return;
      }
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          <span>🛠️ Admin</span>
          <span className="text-[10px] font-normal normal-case text-[var(--color-text-faint)]">
            only you can see this
          </span>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="tap rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)]"
        >
          {open ? "Close" : "+ Add tonight's call"}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-3">
          <label className="col-span-2 text-xs">
            Market hint
            <input
              value={f.market_hint}
              onChange={(e) => setF({ ...f, market_hint: e.target.value })}
              placeholder="e.g. Matt Mahan wins California Governor primary"
              className={inputCls}
            />
          </label>

          <label className="text-xs">
            Race
            <select
              value={f.race}
              onChange={(e) => setF({ ...f, race: e.target.value })}
              className={inputCls}
            >
              {races.map((r) => (
                <option key={r.tag} value={r.tag}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            Episode
            <select
              value={f.episode_id}
              onChange={(e) => setF({ ...f, episode_id: e.target.value })}
              className={inputCls}
            >
              {EPISODES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            Side
            <select
              value={f.side}
              onChange={(e) => setF({ ...f, side: e.target.value as (typeof SIDES)[number] })}
              className={inputCls}
            >
              {SIDES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            Conviction
            <select
              value={f.conviction}
              onChange={(e) =>
                setF({ ...f, conviction: e.target.value as (typeof CONVICTIONS)[number] })
              }
              className={inputCls}
            >
              {CONVICTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="col-span-2 text-xs">
            Entry price (¢, optional)
            <input
              value={f.entry_price}
              onChange={(e) => setF({ ...f, entry_price: e.target.value })}
              inputMode="numeric"
              placeholder="e.g. 42"
              className={inputCls}
            />
          </label>

          <MarketSearch
            token={token}
            marketId={f.market_id}
            onPick={(id) => setF({ ...f, market_id: id })}
          />

          {err && <p className="col-span-2 text-xs text-red-400">{err}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="col-span-2 tap rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add tonight's call"}
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Per-call admin controls (edit / hide) ───────────────────────────────────
// Rendered under each election call card when in admin mode. Edits send a
// sparse PATCH (only changed fields); hide toggles { hidden }.
type EditForm = { side: string; conviction: string; status: string; realized_pct: string };

export function ElectionCallAdminControls({
  token,
  call,
  onChanged,
}: {
  token: string;
  call: Call;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = useMemo<EditForm>(
    () => ({
      side: call.side ?? "",
      conviction: call.conviction ?? "",
      status: call.status ?? "",
      realized_pct: call.realized_pct == null ? "" : String(call.realized_pct),
    }),
    [call],
  );
  const [form, setForm] = useState<EditForm>(base);

  function open() {
    setForm(base);
    setErr(null);
    setEditing(true);
  }

  async function save() {
    const body: Record<string, unknown> = {};
    if (form.side !== base.side) body.side = form.side || null;
    if (form.conviction !== base.conviction) body.conviction = form.conviction || null;
    if (form.status !== base.status) body.status = form.status || null;
    if (form.realized_pct !== base.realized_pct)
      body.realized_pct = form.realized_pct === "" ? null : Number(form.realized_pct);
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/calls/${call.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setErr(`PATCH ${r.status}`);
        return;
      }
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHide() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/calls/${call.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ hidden: !call.hidden }),
      });
      if (!r.ok) {
        setErr(`PATCH ${r.status}`);
        return;
      }
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">admin</span>
        <button
          onClick={() => (editing ? setEditing(false) : open())}
          disabled={busy}
          className="tap text-[var(--color-accent)] disabled:opacity-50"
        >
          {editing ? "cancel" : "edit"}
        </button>
        <button
          onClick={toggleHide}
          disabled={busy}
          className="tap text-[var(--color-text-muted)] disabled:opacity-50"
        >
          {call.hidden ? "unhide" : "hide"}
        </button>
        {call.hidden ? (
          <span className="rounded px-1 text-[10px] font-medium" style={{ background: "#f59e0b22", color: "#f59e0b" }}>
            hidden
          </span>
        ) : null}
      </div>

      {editing && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-2">
          <label>
            Side
            <select
              value={form.side}
              onChange={(e) => setForm({ ...form, side: e.target.value })}
              className={inputCls}
            >
              {SIDES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Conviction
            <select
              value={form.conviction}
              onChange={(e) => setForm({ ...form, conviction: e.target.value })}
              className={inputCls}
            >
              {CONVICTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={inputCls}
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Realized %
            <input
              value={form.realized_pct}
              onChange={(e) => setForm({ ...form, realized_pct: e.target.value })}
              placeholder="(blank = none)"
              className={inputCls}
            />
          </label>
          <button
            onClick={save}
            disabled={busy}
            className="col-span-2 tap rounded bg-[var(--color-accent)] px-3 py-1.5 font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {err && <p className="mt-1 text-red-400">{err}</p>}
    </div>
  );
}
