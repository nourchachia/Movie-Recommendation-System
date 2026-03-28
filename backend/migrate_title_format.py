"""
backend/migrate_title_format.py

One-time migration: reformat MovieLens-style inverted titles to natural English.

Examples:
  "Juror, The (1996)"         →  "The Juror (1996)"
  "Mask, The (1994)"          →  "The Mask (1994)"
  "Few Good Men, A (1992)"    →  "A Few Good Men (1992)"
  "Almost an Angel (1990)"    →  "An Almost Angel (1990)"  ← won't match, safe

Articles handled: The, A, An

Run from the project root:
    python -m backend.migrate_title_format

Or from inside the backend dir:
    python migrate_title_format.py
"""

import os
import re
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("DATABASE_URL is not set in .env")

engine = create_engine(DB_URL, pool_pre_ping=True)

# ── The SQL ────────────────────────────────────────────────────────────────────
# PostgreSQL regex: match "Some Title, The (year)" or "Some Title, A (year)"
# and rearrange to "The Some Title (year)" / "A Some Title (year)"
#
# Pattern breakdown:
#   ^(.+),\s+(The|A|An)\s+(\(\d{4}\))$
#   Group 1: main title  ("Juror")
#   Group 2: article     ("The")
#   Group 3: year        ("(1996)")
#
# \1 \2 \3 is not used because PostgreSQL uses \1 not $1 in regexp_replace,
# but we use a Python-side approach for full control + dry-run preview.

ARTICLE_PATTERN = re.compile(
    r"^(.+),\s+(The|A|An)\s+(\(\d{4}\))$",
    re.IGNORECASE,
)


def reformat(title: str) -> str:
    """Return the reformatted title, or the original if it doesn't match."""
    m = ARTICLE_PATTERN.match(title)
    if not m:
        return title
    main, article, year = m.group(1), m.group(2), m.group(3)
    return f"{article.capitalize()} {main} {year}"


def run_migration(dry_run: bool = False):
    with engine.connect() as conn:
        # Fetch all titles that match the pattern
        rows = conn.execute(
            text("""
                SELECT movie_id, title
                FROM movies
                WHERE title ~ '^.+,\\s+(The|A|An)\\s+\\(\\d{4}\\)$'
                ORDER BY movie_id
            """)
        ).fetchall()

        if not rows:
            print("✅ No titles need reformatting.")
            return

        print(f"Found {len(rows)} titles to reformat.\n")
        print(f"{'BEFORE':<50}  {'AFTER':<50}")
        print("─" * 102)

        updates = []
        for row in rows:
            new_title = reformat(row.title)
            print(f"{row.title:<50}  {new_title:<50}")
            updates.append({"mid": row.movie_id, "new_title": new_title})

        if dry_run:
            print(f"\n⚠️  DRY RUN — no changes written to DB.")
            return

        print(f"\n📝 Applying {len(updates)} updates...")
        for u in updates:
            conn.execute(
                text("UPDATE movies SET title = :new_title WHERE movie_id = :mid"),
                u,
            )
        conn.commit()
        print(f"\n✅ Done! {len(updates)} movie titles reformatted successfully.")
        print("   The TMDB id column is untouched — poster/metadata fetching works as before.")


if __name__ == "__main__":
    import sys
    dry = "--dry-run" in sys.argv
    if dry:
        print("🔍 DRY RUN mode — showing changes without writing to DB\n")
    run_migration(dry_run=dry)
