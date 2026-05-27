import { useEffect, useState } from "react";
import { useStore } from "../store";

interface Note {
  id: number;
  scope_type: string;
  scope_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export function Admin() {
  const token = useStore((s) => s.adminToken);
  const setToken = useStore((s) => s.setAdminToken);
  const clearToken = useStore((s) => s.clearAdminToken);

  const [tokenInput, setTokenInput] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [scopeType, setScopeType] = useState("general");
  const [scopeId, setScopeId] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch("/api/admin/notes", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Bad token" : `HTTP ${r.status}`);
        return r.json();
      })
      .then(setNotes)
      .catch((e) => {
        setErr(String(e));
        if (String(e).includes("Bad token")) clearToken();
      });
  }, [token, clearToken]);

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

  if (!token) {
    return (
      <div className="max-w-md mx-auto space-y-4 mt-12">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Paste your bearer token. It stays in browser storage only.
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

      <div className="space-y-2">
        {(notes ?? []).map((n) => (
          <div
            key={n.id}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-sm"
          >
            <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1">
              <span>
                {n.scope_type}
                {n.scope_id ? ` · ${n.scope_id}` : ""} · {new Date(n.created_at).toLocaleString()}
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
