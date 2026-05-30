"""
Apply admin overrides / hides / manual calls onto the `calls` table.

Admin intent lives in the DB-only `call_admin` side table (the single source of
truth). This step STAMPS that intent onto `calls` and runs LAST in refresh.sh —
after `load` (which wipes+reinserts every call) and `scoring` (which resets
status/realized_pct and recomputes every call) — so the admin always wins.

Entry points:
  - apply_call_admin(conn, call_id, stats): per-call core. The API write path
    mirrors this in TS for instant feedback between refreshes; this Python is
    authoritative and re-asserts every refresh.
  - apply_all(): walk every call_admin row. This is `python -m pipeline.enrich.apply_admin`
    and the run_all / refresh.sh step.

Idempotent: every write is a deterministic function of the call_admin row + the
current `markets` state.

NOTE: keep the hybrid-outcome math here in sync with pipeline/enrich/scoring.py
(we reuse its helpers) AND with the TS port in api/src/routes/admin.ts.
"""
from __future__ import annotations

import json

from pipeline.enrich.scoring import _hard_close_cents, _infer_winner, _realized_pct

_SIDES = {"yes", "no", "over", "under"}
_CONVICTIONS = {"play", "solid", "flyer", "watch", "opinion", "pass"}
_STATUSES = {"open", "closed", "resolved"}

# Override columns that map 1:1 onto `calls` (NULL in call_admin = leave alone).
# market_id is handled separately (it also needs the resolver pin); status and
# realized_pct for MANUAL calls are owned by the outcome logic, not this loop.
_OVERRIDE_COLS = ("market_hint", "side", "conviction", "status", "realized_pct", "tags")


def _ensure_calls_columns(conn) -> None:
    """Self-migrate the admin `calls.hidden` column (apply_admin can run
    standalone against a pre-existing DB)."""
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(calls)")}
    if "hidden" not in existing:
        conn.execute("ALTER TABLE calls ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    if "won" not in existing:
        conn.execute("ALTER TABLE calls ADD COLUMN won INTEGER")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_hidden ON calls(hidden)")


def _market_resolution(conn, market_id: str) -> str | None:
    """'yes'/'no' for a market using scoring's precedence (resolution ->
    effective_resolution -> infer from current_price only when resolved), else None."""
    m = conn.execute(
        "SELECT resolved, resolution, current_price, effective_resolution "
        "FROM markets WHERE id = ?",
        (market_id,),
    ).fetchone()
    if not m:
        return None
    res = (m["resolution"] or "").strip().lower()
    if res in ("yes", "no"):
        return res
    eff = (m["effective_resolution"] or "").strip().lower()
    if eff in ("yes", "no"):
        return eff
    if m["resolved"] == 1:
        return _infer_winner(m["current_price"])
    return None


def _market_is_settled(conn, market_id: str) -> bool:
    m = conn.execute("SELECT resolved FROM markets WHERE id = ?", (market_id,)).fetchone()
    return bool(m and m["resolved"] == 1)


def apply_call_admin(conn, call_id: int, stats: dict | None = None) -> None:
    """Stamp one call_admin row onto `calls` (+ a synthesized entry event for a
    hybrid manual call)."""
    row = conn.execute("SELECT * FROM call_admin WHERE call_id = ?", (call_id,)).fetchone()
    if not row:
        return
    s = stats if stats is not None else {}
    is_manual = bool(row["is_manual"])

    if is_manual:
        # --- A. Manual call needs a real episode (scoreboard wins/losses +
        # CallDetail INNER JOIN episodes) and valid enums. ---
        episode_id = row["episode_id"]
        if not episode_id or not conn.execute(
            "SELECT 1 FROM episodes WHERE id = ?", (episode_id,)
        ).fetchone():
            s["skipped_no_episode"] = s.get("skipped_no_episode", 0) + 1
            return
        side = (row["side"] or "yes").strip().lower()
        conviction = (row["conviction"] or "opinion").strip().lower()
        if side not in _SIDES or conviction not in _CONVICTIONS:
            s["skipped_bad_enum"] = s.get("skipped_bad_enum", 0) + 1
            return

        # Upsert the base row by explicit id (insert_call is a plain INSERT).
        conn.execute(
            """INSERT INTO calls
                 (id, market_id, market_hint, episode_id, first_event_ts, side,
                  conviction, size_disclosed, speaker, status, notes, tags, hidden)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'stu', 'open', NULL, ?, 0)
               ON CONFLICT(id) DO UPDATE SET
                 market_id=excluded.market_id, market_hint=excluded.market_hint,
                 episode_id=excluded.episode_id, first_event_ts=excluded.first_event_ts,
                 side=excluded.side, conviction=excluded.conviction, tags=excluded.tags""",
            (
                call_id, row["market_id"], (row["market_hint"] or "(manual call)"),
                episode_id, (row["first_event_ts"] or 0), side, conviction,
                (row["tags"] or "[]"),
            ),
        )
        s["manual_created"] = s.get("manual_created", 0) + 1

        # --- B. Outcome: admin-set by default; HYBRID computes when entry_price
        # + a resolved linked market are present (decision 3). ---
        status = (row["status"] or "open").strip().lower()
        if status not in _STATUSES:
            status = "open"
        realized = row["realized_pct"]
        entry = row["entry_price"]
        mid = row["market_id"]
        # Synthesized entry event (manual calls only own 'entry' events) so
        # CallDetail/chart have data + a future scoring run computes the same number.
        conn.execute("DELETE FROM call_events WHERE call_id = ? AND event_type = 'entry'", (call_id,))
        if entry is not None:
            conn.execute(
                """INSERT INTO call_events
                     (call_id, episode_id, timestamp_sec, event_type, price_pct,
                      size_pct_of_pos, quote, raw_quote)
                   VALUES (?, ?, ?, 'entry', ?, NULL, NULL, NULL)""",
                (call_id, episode_id, (row["first_event_ts"] or 0), float(entry)),
            )
            if mid:
                res = _market_resolution(conn, mid)
                if res in ("yes", "no"):
                    close = _hard_close_cents(side, res)
                    realized = _realized_pct(side, float(entry), close)
                    status = "resolved" if _market_is_settled(conn, mid) else "closed"
        conn.execute(
            "UPDATE calls SET status = ?, realized_pct = ? WHERE id = ?",
            (status, realized, call_id),
        )
    else:
        # --- C. Pipeline-call field overrides: admin beats pipeline. ---
        for col in _OVERRIDE_COLS:
            val = row[col]
            if val is None:
                continue
            v = str(val).strip().lower()
            if col == "side" and v not in _SIDES:
                continue
            if col == "conviction" and v not in _CONVICTIONS:
                continue
            if col == "status" and v not in _STATUSES:
                continue
            conn.execute(f"UPDATE calls SET {col} = ? WHERE id = ?", (val, call_id))
            s["overrides_applied"] = s.get("overrides_applied", 0) + 1

    # --- C2. Forced market link (manual + pipeline): stamp + pin so the
    # resolver's repair pass won't re-unlink it. Validate the market exists. ---
    if row["market_id"] and conn.execute(
        "SELECT 1 FROM markets WHERE id = ?", (row["market_id"],)
    ).fetchone():
        conn.execute(
            "UPDATE calls SET market_id = ?, notes = ? WHERE id = ?",
            (row["market_id"], f"pin:no-auto-link (admin-forced {row['market_id']})", call_id),
        )

    # --- C3. Keep `won` consistent with the FINAL realized_pct (a manual call or
    # an admin realized_pct override may have changed it). A resolved-without-a-
    # return call keeps realized_pct NULL → leave scoring's outcome-derived `won`.
    conn.execute(
        "UPDATE calls SET won = CASE "
        "WHEN realized_pct IS NULL THEN won "
        "WHEN realized_pct > 0 THEN 1 ELSE 0 END WHERE id = ?",
        (call_id,),
    )

    # --- D. Hidden ---
    conn.execute("UPDATE calls SET hidden = ? WHERE id = ?", (1 if row["hidden"] else 0, call_id))
    if row["hidden"]:
        s["hidden"] = s.get("hidden", 0) + 1


def apply_all() -> dict:
    from pipeline.db import connect

    stats = {
        "manual_created": 0, "overrides_applied": 0, "hidden": 0,
        "skipped_no_episode": 0, "skipped_bad_enum": 0, "errors": [],
    }
    with connect() as conn:
        _ensure_calls_columns(conn)
        try:
            rows = conn.execute("SELECT call_id FROM call_admin").fetchall()
        except Exception:
            return stats  # call_admin not present yet (fresh/old DB) — nothing to apply
        for r in rows:
            try:
                apply_call_admin(conn, r["call_id"], stats)
            except Exception as e:  # noqa: BLE001 — isolate per-call failures
                stats["errors"].append(f"{r['call_id']}: {type(e).__name__}: {e}")
        # Reconcile: hidden must reflect call_admin exactly. load resets
        # JSON-sourced calls to hidden=0 each refresh, but this also clears a
        # reverted hide whose call_admin row was deleted (and any orphan).
        conn.execute(
            "UPDATE calls SET hidden = 0 WHERE hidden = 1 "
            "AND id NOT IN (SELECT call_id FROM call_admin WHERE hidden = 1)"
        )
    return stats


if __name__ == "__main__":
    print(json.dumps(apply_all(), indent=2))
