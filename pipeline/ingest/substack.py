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
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from pipeline.paths import ingest_dir

PUB = "https://predictable.substack.com"
ARCHIVE_URL = f"{PUB}/api/v1/archive"
POST_URL = f"{PUB}/api/v1/posts/by-slug"  # /{slug}
COMMENTS_URL = f"{PUB}/api/v1/posts"  # /{slug}/comments — but Substack also has a post-id endpoint
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
    """Fetch all comments for a post. Accepts slug OR post id."""
    # Try the post-id route first if numeric; fall back to slug route
    candidates = []
    if str(slug_or_id).isdigit():
        candidates.append(f"{PUB}/api/v1/post/{slug_or_id}/comments")
    candidates.append(f"{PUB}/api/v1/posts/{slug_or_id}/comments")
    for url in candidates:
        try:
            r = requests.get(url, headers=UA, timeout=15)
            if r.ok:
                data = r.json()
                # Substack wraps comments under "comments" or returns the list directly
                if isinstance(data, dict):
                    return data.get("comments") or data.get("items") or []
                if isinstance(data, list):
                    return data
        except requests.RequestException:
            continue
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


if __name__ == "__main__":
    posts = pull_archive()
    write_snapshot(posts)
    print(f"Pulled {len(posts)} Substack posts")
    for p in posts[:5]:
        print(f"  {p.get('post_date','?')[:10]}  [{p.get('type','?'):>10}]  {p.get('title','')[:65]}")
