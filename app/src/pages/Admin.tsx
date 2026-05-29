import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { formatDateTimeSafe } from "../lib/format";
import { AdminCalls } from "./AdminCalls";

interface Note {
  id: number;
  scope_type: string;
  scope_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

interface UnresolvedMarket {
  call_id: number | null;
  episode_id: string | null;
  market_hint: string;
  reason: string;
  logged_on: string;
}

export function Admin() {
  const token = useStore((s) => s.adminToken);
  const setToken = useStore((s) => s.setAdminToken);
  const clearToken = useStore((s) => s.clearAdminToken);

  const [tokenInput, setTokenInput] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedMarket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [scopeType, setScopeType] = useState("general");
  const [scopeId, setScopeId] = useState("");
  // "checking" until we know if this visitor is authorized — by the Google SSO
  // gate (cookie, no token needed) OR a pasted bearer token. Only "denied"
  // (neither) shows the token form.
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    // Probe authorization: the SSO gate's cookie authorizes us with NO token; a
    // pasted bearer token also works. 401 = neither → show the token form.
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    fetch("/api/admin/notes", { headers })
      .then((r) => {
        if (r.status === 401) { setAccess("denied"); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { if (data) { setNotes(data); setAccess("ok"); } })
      .catch((e) => setErr(String(e)));
    // Unresolved markets — non-fatal if it 404s on older deploys.
    fetch("/api/admin/unresolved-markets", { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then(setUnresolved)
      .catch(() => setUnresolved([]));
  }, [token]);

  async function saveNote() {
    if (!body.trim()) return;
    const r = await fetch("/api/admin/notes", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ scope_type: scopeType, scope_id: scopeId || undefined, body }),
    });
    if (!r.ok) {
      setErr(`HTTP ${r.status}`);
      return;
    }
    setBody("");
    setScopeId("");
    // Refresh
    fetch("/api/admin/notes", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setNotes);
  }

  async function deleteNote(id: number) {
    await fetch(`/api/admin/notes/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    setNotes((cur) => cur?.filter((n) => n.id !== id) ?? null);
  }

  if (access === "checking") {
    return <div className="max-w-md mx-auto mt-12 text-sm text-[var(--color-text-muted)]">Checking access…</div>;
  }
  if (access === "denied") {
    return (
      <div className="max-w-md mx-auto space-y-4 mt-12">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Sign in with Google at the gate — or paste a bearer token (break-glass; stays in browser storage only).
        </p>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Bearer token"
          className="w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-3 py-2"
        />
        <button
          onClick={() => setToken(tokenInput)}
          className="px-4 py-2 rounded bg-[var(--color-accent)] text-[var(--color-bg)] font-medium"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin notes</h1>
        <button onClick={clearToken} className="text-xs text-[var(--color-text-muted)]">
          Sign out
        </button>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <AdminCalls token={token} />

      <h2 className="text-base font-medium pt-2">Notes</h2>
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value)}
            className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-3 py-2 text-sm"
          >
            <option value="general">General</option>
            <option value="call">Call</option>
            <option value="episode">Episode</option>
            <option value="market">Market</option>
            <option value="saga">Saga</option>
          </select>
          <input
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            placeholder="scope id (optional)"
            className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-3 py-2 text-sm"
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Note…"
          className="w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-3 py-2 text-sm"
        />
        <button
          onClick={saveNote}
          disabled={!body.trim()}
          className="px-4 py-2 rounded bg-[var(--color-accent)] text-[var(--color-bg)] font-medium disabled:opacity-50"
        >
          Save note
        </button>
      </div>

      {unresolved && unresolved.length > 0 && (
        <section className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">
              Unresolved markets <span className="text-xs text-[var(--color-text-muted)] ml-2">({unresolved.length})</span>
            </h2>
            <span className="text-[11px] text-[var(--color-text-faint)]">
              Calls whose market_hint didn't match any candidate above the conservative-match threshold.
              Re-run `python -m pipeline.enrich.market_resolver` after editing the hint.
            </span>
          </div>
          <ul className="space-y-1 text-sm">
            {unresolved.slice(0, 50).map((u) => (
              <li key={`${u.call_id ?? "?"}-${u.market_hint}`} className="flex items-start justify-between gap-3 py-1 border-b border-[var(--color-border)] last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {u.call_id ? (
                      <Link to={`/calls/${u.call_id}`} className="text-[var(--color-text)] hover:underline">
                        {u.market_hint || "(empty hint)"}
                      </Link>
                    ) : (
                      <span>{u.market_hint || "(empty hint)"}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-faint)] truncate">
                    {u.reason} · logged {u.logged_on}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-2">
        {(notes ?? []).map((n) => (
          <div
            key={n.id}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm"
          >
            <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1">
              <span>
                {n.scope_type}
                {n.scope_id ? ` · ${n.scope_id}` : ""} · {formatDateTimeSafe(n.created_at)}
              </span>
              <button onClick={() => deleteNote(n.id)} className="text-[var(--color-text-faint)]">
                delete
              </button>
            </div>
            <div className="whitespace-pre-wrap">{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
