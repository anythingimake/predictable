import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Episode } from "../types";

const SIDES = ["yes", "no", "over", "under"];
const CONVICTIONS = ["play", "solid", "flyer", "watch", "opinion", "pass"];
const STATUSES = ["open", "closed", "resolved"];

interface AdminCall {
  id: number;
  market_id: string | null;
  market_hint: string;
  episode_id: string;
  side: string;
  conviction: string;
  status: string;
  realized_pct: number | null;
  tags: string | null;
  hidden: number;
  episode_title: string;
  publish_date: string;
  is_manual: number | null;
  ov_market_hint: string | null;
  ov_side: string | null;
  ov_conviction: string | null;
  ov_status: string | null;
  ov_realized_pct: number | null;
  ov_market_id: string | null;
  ov_tags: string | null;
}

const OVERRIDE_KEYS = [
  "ov_market_hint", "ov_side", "ov_conviction", "ov_status", "ov_realized_pct", "ov_market_id", "ov_tags",
] as const;

function isOverridden(c: AdminCall): boolean {
  return OVERRIDE_KEYS.some((k) => c[k] !== null && c[k] !== undefined);
}

// One editable field's value, as a string in the form (parsed on save).
type EditForm = {
  market_hint: string; side: string; conviction: string; status: string;
  realized_pct: string; market_id: string; tags: string;
};

export function AdminCalls({ token }: { token: string }) {
  const [calls, setCalls] = useState<AdminCall[] | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  async function load() {
    const r = await fetch("/api/admin/calls", { headers });
    if (!r.ok) { setErr(r.status === 401 ? "Bad token" : `HTTP ${r.status}`); return; }
    setCalls(await r.json());
  }
  useEffect(() => {
    load();
    fetch("/api/episodes").then((r) => (r.ok ? r.json() : [])).then(setEpisodes).catch(() => setEpisodes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function effective(c: AdminCall): EditForm {
    return {
      market_hint: c.market_hint ?? "",
      side: c.side ?? "",
      conviction: c.conviction ?? "",
      status: c.status ?? "",
      realized_pct: c.realized_pct == null ? "" : String(c.realized_pct),
      market_id: c.market_id ?? "",
      tags: c.tags ?? "",
    };
  }

  function openEdit(c: AdminCall) {
    setEditing(c.id);
    setForm(effective(c));
  }

  async function saveEdit(c: AdminCall) {
    if (!form) return;
    const base = effective(c);
    const body: Record<string, unknown> = {};
    // Only send changed fields (sparse overrides). Empty string clears -> null.
    if (form.market_hint !== base.market_hint) body.market_hint = form.market_hint || null;
    if (form.side !== base.side) body.side = form.side || null;
    if (form.conviction !== base.conviction) body.conviction = form.conviction || null;
    if (form.status !== base.status) body.status = form.status || null;
    if (form.realized_pct !== base.realized_pct) body.realized_pct = form.realized_pct === "" ? null : Number(form.realized_pct);
    if (form.market_id !== base.market_id) body.market_id = form.market_id || null;
    if (form.tags !== base.tags) body.tags = form.tags || null;
    if (Object.keys(body).length === 0) { setEditing(null); return; }
    const r = await fetch(`/api/admin/calls/${c.id}`, {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { setErr(`PATCH ${r.status}`); return; }
    setEditing(null); setForm(null); await load();
  }

  async function toggleHide(c: AdminCall) {
    const r = await fetch(`/api/admin/calls/${c.id}`, {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ hidden: !c.hidden }),
    });
    if (!r.ok) { setErr(`PATCH ${r.status}`); return; }
    await load();
  }

  async function revert(c: AdminCall) {
    const msg = c.is_manual
      ? "Delete this manual call entirely?"
      : "Remove admin overrides? Field values restore on the next data refresh; hide/forced-market revert immediately.";
    if (!confirm(msg)) return;
    const r = await fetch(`/api/admin/calls/${c.id}`, { method: "DELETE", headers });
    if (!r.ok) { setErr(`DELETE ${r.status}`); return; }
    if (editing === c.id) setEditing(null);
    await load();
  }

  const filtered = useMemo(() => {
    if (!calls) return null;
    const s = q.trim().toLowerCase();
    if (!s) return calls;
    return calls.filter((c) =>
      (c.market_hint || "").toLowerCase().includes(s) || (c.episode_title || "").toLowerCase().includes(s));
  }, [calls, q]);

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">Calls {calls && <span className="text-xs text-[var(--color-text-muted)]">({calls.length})</span>}</h2>
        <button onClick={() => setShowCreate((v) => !v)} className="tap text-sm rounded bg-[var(--color-accent)] text-[var(--color-bg)] px-3 py-1.5 font-medium">
          {showCreate ? "Close" : "+ Manual call"}
        </button>
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)]">
        Edit overrides the pipeline. Hidden calls drop from the scoreboard + all public views. Field reverts apply on the next data refresh; hide + forced-market reverts are immediate. Add a fan-facing "Editor's note" via the Notes section (scope = call, id = the call id).
      </p>

      {showCreate && <ManualCreate token={token} episodes={episodes} onCreated={() => { setShowCreate(false); load(); }} setErr={setErr} />}

      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search market or episode…"
        className="tap w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm"
      />

      {!filtered && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      <div className="space-y-1.5">
        {filtered?.slice(0, 200).map((c) => (
          <div key={c.id} className={`rounded border border-[var(--color-border)] p-2.5 text-sm ${c.hidden ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase rounded px-1 bg-[var(--color-bg)] text-[var(--color-text-muted)]">{c.conviction}/{c.side}</span>
                  <Link to={`/calls/${c.id}`} className="font-medium truncate hover:underline">{c.market_hint || "(no hint)"}</Link>
                  {c.is_manual ? <Badge color="#8b5cf6">manual</Badge> : null}
                  {isOverridden(c) ? <Badge color="#2dd4bf">edited</Badge> : null}
                  {c.hidden ? <Badge color="#f59e0b">hidden</Badge> : null}
                </div>
                <div className="text-[11px] text-[var(--color-text-faint)] truncate">{c.episode_title} · {c.publish_date} · {c.status}{c.realized_pct != null ? ` · ${c.realized_pct > 0 ? "+" : ""}${Math.round(c.realized_pct)}%` : ""}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs">
                <button onClick={() => (editing === c.id ? setEditing(null) : openEdit(c))} className="tap text-[var(--color-accent)]">{editing === c.id ? "cancel" : "edit"}</button>
                <button onClick={() => toggleHide(c)} className="tap text-[var(--color-text-muted)]">{c.hidden ? "unhide" : "hide"}</button>
                <button onClick={() => revert(c)} className="tap text-[var(--color-text-faint)]">{c.is_manual ? "delete" : "revert"}</button>
              </div>
            </div>

            {editing === c.id && form && (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-2">
                <label className="col-span-2 text-xs">Market hint
                  <input value={form.market_hint} onChange={(e) => setForm({ ...form, market_hint: e.target.value })} className={inputCls} />
                </label>
                <label className="text-xs">Side
                  <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} className={inputCls}>{SIDES.map((s) => <option key={s}>{s}</option>)}</select>
                </label>
                <label className="text-xs">Conviction
                  <select value={form.conviction} onChange={(e) => setForm({ ...form, conviction: e.target.value })} className={inputCls}>{CONVICTIONS.map((s) => <option key={s}>{s}</option>)}</select>
                </label>
                <label className="text-xs">Status
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                </label>
                <label className="text-xs">Realized %
                  <input value={form.realized_pct} onChange={(e) => setForm({ ...form, realized_pct: e.target.value })} placeholder="(blank = none)" className={inputCls} />
                </label>
                <label className="col-span-2 text-xs">Market id (forced link)
                  <input value={form.market_id} onChange={(e) => setForm({ ...form, market_id: e.target.value })} placeholder="kalshi:… or polymarket:…" className={inputCls} />
                </label>
                <label className="col-span-2 text-xs">Tags (JSON array)
                  <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder='["political"]' className={inputCls} />
                </label>
                <button onClick={() => saveEdit(c)} className="col-span-2 tap rounded bg-[var(--color-accent)] text-[var(--color-bg)] px-3 py-1.5 text-sm font-medium">Save overrides</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
    </section>
  );
}

const inputCls = "tap mt-0.5 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-sm";

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className="text-[10px] uppercase rounded px-1 font-medium" style={{ background: `${color}22`, color }}>{children}</span>;
}

function ManualCreate({ token, episodes, onCreated, setErr }: {
  token: string; episodes: Episode[]; onCreated: () => void; setErr: (s: string) => void;
}) {
  const [f, setF] = useState({ episode_id: "", market_hint: "", side: "yes", conviction: "solid", status: "open", realized_pct: "", market_id: "", entry_price: "", tags: "" });
  async function submit() {
    if (!f.episode_id || !f.market_hint) { setErr("episode + market hint required"); return; }
    const body: Record<string, unknown> = {
      episode_id: f.episode_id, market_hint: f.market_hint, side: f.side, conviction: f.conviction,
    };
    if (f.status) body.status = f.status;
    if (f.realized_pct !== "") body.realized_pct = Number(f.realized_pct);
    if (f.market_id) body.market_id = f.market_id;
    if (f.entry_price !== "") body.entry_price = Number(f.entry_price);
    if (f.tags) body.tags = f.tags;
    const r = await fetch("/api/admin/calls", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { setErr(`POST ${r.status}`); return; }
    onCreated();
  }
  const sorted = [...episodes].sort((a, b) => (b.publish_date || "").localeCompare(a.publish_date || ""));
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3 grid grid-cols-2 gap-2">
      <label className="col-span-2 text-xs">Episode
        <select value={f.episode_id} onChange={(e) => setF({ ...f, episode_id: e.target.value })} className={inputCls}>
          <option value="">— pick episode —</option>
          {sorted.map((e) => <option key={e.id} value={e.id}>{e.publish_date} · {(e.substack_title || e.megaphone_title || e.id).slice(0, 50)}</option>)}
        </select>
      </label>
      <label className="col-span-2 text-xs">Market hint
        <input value={f.market_hint} onChange={(e) => setF({ ...f, market_hint: e.target.value })} className={inputCls} placeholder="e.g. Trump wins Iowa caucus" />
      </label>
      <label className="text-xs">Side<select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })} className={inputCls}>{SIDES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs">Conviction<select value={f.conviction} onChange={(e) => setF({ ...f, conviction: e.target.value })} className={inputCls}>{CONVICTIONS.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inputCls}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs">Realized %<input value={f.realized_pct} onChange={(e) => setF({ ...f, realized_pct: e.target.value })} placeholder="(admin-set)" className={inputCls} /></label>
      <label className="text-xs">Market id (optional)<input value={f.market_id} onChange={(e) => setF({ ...f, market_id: e.target.value })} className={inputCls} placeholder="kalshi:…" /></label>
      <label className="text-xs">Entry ¢ (hybrid)<input value={f.entry_price} onChange={(e) => setF({ ...f, entry_price: e.target.value })} className={inputCls} placeholder="e.g. 40" /></label>
      <p className="col-span-2 text-[11px] text-[var(--color-text-faint)]">Hybrid: set a resolved market id + entry ¢ to auto-compute the return; otherwise the return is whatever you put in Realized %.</p>
      <button onClick={submit} className="col-span-2 tap rounded bg-[var(--color-accent)] text-[var(--color-bg)] px-3 py-1.5 text-sm font-medium">Create manual call</button>
    </div>
  );
}
