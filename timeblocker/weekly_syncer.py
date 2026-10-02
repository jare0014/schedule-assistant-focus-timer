"""
weekly_syncer.py - Synchronizes imported external tasks (Todoist and Google Tasks)
into Obsidian Weekly Notes under the appropriate day header.
"""

import os
import re
from datetime import datetime
from typing import List, Dict, Any, Optional


def find_vault_root(start_path: Optional[str] = None) -> str:
    """Finds the Obsidian vault root directory by searching for .obsidian upwards."""
    if not start_path:
        start_path = os.getcwd()

    curr = os.path.abspath(start_path)
    if os.path.isfile(curr):
        curr = os.path.dirname(curr)

    while curr and os.path.dirname(curr) != curr:
        if os.path.exists(os.path.join(curr, ".obsidian")):
            return curr
        curr = os.path.dirname(curr)

    # Fallback relative to timeblocker plugin directory
    fallback = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    return fallback


def sync_external_tasks_to_weekly_note(
    vault_root: str,
    tasks: List[Dict[str, Any]],
    google_tasks: List[Dict[str, Any]],
    default_date_str: Optional[str] = None
) -> List[Dict[str, str]]:
    """
    Syncs imported Todoist and Google Tasks into the appropriate Weekly Note.
    Appends open tasks under '#### <DayName>:' in 02_Journal/02_Weekly/<YYYY-Www>.md.
    Avoids duplicate additions and respects cancelled items.
    """
    if not default_date_str:
        default_date_str = datetime.now().strftime("%Y-%m-%d")

    synced_items: List[Dict[str, str]] = []

    all_external: List[Dict[str, Any]] = []
    for t in tasks:
        all_external.append({
            "source": "Todoist",
            "title": t.get("content", "").strip(),
            "due": t.get("due", {}).get("date") if isinstance(t.get("due"), dict) else None,
            "raw": t
        })

    for gt in google_tasks:
        all_external.append({
            "source": "Google Tasks",
            "title": gt.get("title", "").strip(),
            "due": gt.get("due"),
            "raw": gt
        })

    for item in all_external:
        title = item["title"]
        if not title:
            continue

        # Determine target due date
        due_str = item["due"]
        if due_str:
            due_date_clean = due_str.split("T")[0]
        else:
            due_date_clean = default_date_str

        try:
            target_dt = datetime.strptime(due_date_clean, "%Y-%m-%d")
        except Exception:
            target_dt = datetime.strptime(default_date_str, "%Y-%m-%d")

        iso_year, iso_week, _ = target_dt.isocalendar()
        week_str = f"{iso_year}-W{iso_week:02d}"
        day_name = target_dt.strftime("%A")

        weekly_dir = os.path.join(vault_root, "02_Journal", "02_Weekly")
        weekly_file = os.path.join(weekly_dir, f"{week_str}.md")

        if not os.path.exists(weekly_file):
            os.makedirs(weekly_dir, exist_ok=True)
            initial_content = (
                "---\n"
                "journal: Weekly Notes\n"
                f"journal-date: {due_date_clean}\n"
                "---\n\n"
                "### Evenings and Weekend\n"
                "#### Monday: \n"
                "#### Tuesday: \n"
                "#### Wednesday: \n"
                "#### Thursday: \n"
                "#### Friday: \n"
                "#### Saturday: \n"
                "#### Sunday \n"
            )
            with open(weekly_file, "w", encoding="utf-8") as f:
                f.write(initial_content)

        with open(weekly_file, "r", encoding="utf-8") as f:
            weekly_content = f.read()

        # Check if task title already exists anywhere in the weekly note (completed, cancelled, or open)
        escaped_title = re.escape(title)
        if re.search(rf"-\s*\[[ xX\-/~cC]\]\s+.*{escaped_title}", weekly_content, re.IGNORECASE) or title.lower() in weekly_content.lower():
            continue

        task_line = f"- [ ] {title}"

        # Target day header: e.g. "#### Friday:" or "#### Friday"
        day_pattern = re.compile(rf"(#{1,6}\s+{re.escape(day_name)}:?[^\r\n]*)([\r\n]+)", re.IGNORECASE)
        match = day_pattern.search(weekly_content)

        if match:
            insert_pos = match.end()
            new_content = weekly_content[:insert_pos] + task_line + "\n" + weekly_content[insert_pos:]
        elif "### Evenings and Weekend" in weekly_content:
            ew_idx = weekly_content.index("### Evenings and Weekend") + len("### Evenings and Weekend")
            new_content = (
                weekly_content[:ew_idx]
                + f"\n#### {day_name}:\n{task_line}\n"
                + weekly_content[ew_idx:]
            )
        else:
            new_content = (
                weekly_content.rstrip()
                + f"\n\n### Evenings and Weekend\n#### {day_name}:\n{task_line}\n"
            )

        with open(weekly_file, "w", encoding="utf-8") as f:
            f.write(new_content)

        synced_items.append({
            "title": title,
            "day": day_name,
            "week": week_str,
            "source": item["source"]
        })

    return synced_items
