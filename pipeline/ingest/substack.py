"""
Substack ingest — post archive + post bodies + comments.

The RSS feed is capped at 20; we use the JSON archive API which paginates
with limit=12 (capped) to get all 28+ posts. Post bodies and comments are
pulled per-slug.

Usage:
    from pipeline.ingest.substack import pull_archive, pull_post, pull_comments
    posts = pull_archive()
    body = pull_post("1000-in-one-day")
    comments = pull_comments("1000-in-one-day")
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from pipeline.paths import ingest_dir

# Polite delay between per-slug fetches so Substack doesn't flag us.
RATE_LIMIT_SEC = 0.5

# Names treated as Stu in comment threads (case-insensitive substring match).
STU_NAME_PATTERNS = ("stu burguiere", "predictable", "stu")

PUB = "https://predictable.substack.com"
ARCHIVE_URL = f"{PUB}/api/v1/archive"
POST_URL = f"{PUB}/api/v1/posts"  # /{slug} — returns JSON with body_html
COMMENTS_URL = f"{PUB}/api/v1/post"  # /{post_id}/comments — numeric id required
ARCHIVE_LIMIT = 12  # Substack hard-caps the limit param at 12

UA = {"User-Agent": "predictable-pipeline/1.0"}


def pull_archive() -> list[dict]:
    """Paginate the archive API. Returns every post (compact metadata)."""
    all_posts: list[dict] = []
    seen_ids = set()
    for offset in range(0, 200, ARCHIVE_LIMIT):
        r = requests.get(
            ARCHIVE_URL,
            params={"sort": "new", "offset": offset, "limit": ARCHIVE_LIMIT},
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        page = r.json()
        if not isinstance(page, list) or not page:
            break
        new_in_page = 0
        for p in page:
            pid = p.get("id")
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            all_posts.append(p)
            new_in_page += 1
        if new_in_page == 0:
            break
    all_posts.sort(key=lambda p: p.get("post_date", ""), reverse=True)
    return all_posts


def pull_post_body(slug: str) -> dict:
    """Fetch a single post (with body HTML + reactions). Returns the raw JSON."""
    r = requests.get(f"{POST_URL}/{slug}", headers=UA, timeout=15)
    r.raise_for_status()
    return r.json()


def html_to_text(html: str) -> str:
    """Cleanup HTML to plain text — preserves paragraph breaks."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    # Drop script/style/embeds we don't want in plain text
    for t in soup(["script", "style", "noscript", "iframe"]):
        t.decompose()
    # Insert blank lines between block elements
    for br in soup.find_all("br"):
        br.replace_with("\n")
    text = soup.get_text(separator="\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def pull_comments(slug_or_id: str | int) -> list[dict]:
    """Fetch all comments for a post. Accepts slug OR numeric post id.

    Substack's working comments endpoint is /api/v1/post/{post_id}/comments (numeric).
    If given a slug, we first resolve it to its post id via pull_post_body.
    """
    pid: str | int | None = None
    if isinstance(slug_or_id, int) or str(slug_or_id).isdigit():
        pid = slug_or_id
    else:
        try:
            post = pull_post_body(str(slug_or_id))
            pid = post.get("id")
        except (requests.RequestException, ValueError):
            pid = None
    if pid is None:
        return []
    try:
        r = requests.get(f"{COMMENTS_URL}/{pid}/comments", headers=UA, timeout=15)
        if not r.ok:
            return []
        data = r.json()
    except (requests.RequestException, ValueError):
        return []
    if isinstance(data, dict):
        return data.get("comments") or data.get("items") or []
    if isinstance(data, list):
        return data
    return []


def write_snapshot(posts: list[dict], today: str | None = None) -> Path:
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = ingest_dir("substack") / f"archive-{today}.json"
    # Compact metadata only — bodies are pulled separately per-slug
    compact = [
        {
            k: p.get(k)
            for k in (
                "id",
                "post_date",
                "title",
                "subtitle",
                "slug",
                "canonical_url",
                "type",
                "audience",
                "podcast_duration",
                "video_upload_id",
                "podcast_upload_id",
                "reactions",
                "cover_image",
            )
        }
        for p in posts
    ]
    out.write_text(json.dumps(compact, indent=2), encoding="utf-8")
    return out


def _is_stu_author(author: str | None) -> bool:
    if not author:
        return False
    a = author.strip().lower()
    if not a:
        return False
    for pat in STU_NAME_PATTERNS:
        # "stu" matches as exact token (don't match "Stuart" or "stub").
        if pat == "stu":
            if a == "stu" or a.startswith("stu "):
                return True
            continue
        if pat in a:
            return True
    return False


def _comment_author(c: dict) -> str:
    # Substack nests author info under "name" at top level, or under "user".
    name = c.get("name")
    if not name:
        u = c.get("user") or {}
        name = u.get("name") or u.get("handle")
    return name or ""


def _comment_posted_at(c: dict) -> str | None:
    return c.get("date") or c.get("created_at") or c.get("posted_at")


def _flatten_comments(items: list[dict], parent_id: str | None = None) -> list[dict]:
    """Recursively flatten nested Substack comment trees into a flat list with parent_id."""
    out: list[dict] = []
    for c in items or []:
        cid = c.get("id")
        if cid is None:
            continue
        author = _comment_author(c)
        out.append(
            {
                "id": str(cid),
                "author": author,
                "body": c.get("body") or c.get("body_text") or "",
                "posted_at": _comment_posted_at(c),
                "parent_id": str(parent_id) if parent_id is not None else None,
                "is_stu": _is_stu_author(author),
            }
        )
        children = c.get("children") or c.get("replies") or []
        if children:
            out.extend(_flatten_comments(children, parent_id=cid))
    return out


def snapshot_bodies(slugs: list[str], force: bool = False) -> Path:
    """For each slug, fetch the post body and persist to data/ingest/substack/bodies/{slug}.json.

    Skips slugs whose body file already exists unless force=True.
    Returns the bodies directory path.
    """
    out_dir = ingest_dir("substack") / "bodies"
    out_dir.mkdir(parents=True, exist_ok=True)
    for slug in slugs:
        if not slug:
            continue
        fp = out_dir / f"{slug}.json"
        if fp.exists() and not force:
            continue
        try:
            post = pull_post_body(slug)
        except (requests.RequestException, ValueError) as e:
            print(f"[substack.snapshot_bodies] {slug}: fetch failed ({e})")
            time.sleep(RATE_LIMIT_SEC)
            continue
        record = {
            "slug": slug,
            "body": html_to_text(post.get("body_html") or ""),
            "reactions": post.get("reactions") or {},
            "comment_count": post.get("comment_count") or 0,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        fp.write_text(json.dumps(record, indent=2), encoding="utf-8")
        time.sleep(RATE_LIMIT_SEC)
    return out_dir


def snapshot_comments(slugs: list[str], force: bool = False) -> Path:
    """For each slug, fetch the comments list and persist to data/ingest/substack/comments/{slug}.json.

    Each comment is shaped: {id, author, body, posted_at, parent_id, is_stu}.
    Skips slugs whose comment file already exists unless force=True.
    Returns the comments directory path.
    """
    out_dir = ingest_dir("substack") / "comments"
    out_dir.mkdir(parents=True, exist_ok=True)
    for slug in slugs:
        if not slug:
            continue
        fp = out_dir / f"{slug}.json"
        if fp.exists() and not force:
            continue
        try:
            raw = pull_comments(slug)
        except (requests.RequestException, ValueError) as e:
            print(f"[substack.snapshot_comments] {slug}: fetch failed ({e})")
            time.sleep(RATE_LIMIT_SEC)
            continue
        comments = _flatten_comments(raw)
        fp.write_text(json.dumps(comments, indent=2), encoding="utf-8")
        time.sleep(RATE_LIMIT_SEC)
    return out_dir


if __name__ == "__main__":
    posts = pull_archive()
    write_snapshot(posts)
    print(f"Pulled {len(posts)} Substack posts")
    for p in posts[:5]:
        print(f"  {p.get('post_date','?')[:10]}  [{p.get('type','?'):>10}]  {p.get('title','')[:65]}")
