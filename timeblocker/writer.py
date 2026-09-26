"""
writer.py - Daily note markdown writer and system clipboard helper.
"""

import os
import re
import subprocess
from typing import List


def normalize_time_range_spaces(line: str) -> str:
    """Normalizes spacing around time ranges in task checklist lines."""
    if not line:
        return line
    regex = r"^((\s*-\s+\[[ xX/]\]\s+)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[\-–—~]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*)(.*)$"
    match = re.match(regex, line, re.IGNORECASE)
    if match:
        time_prefix = match.group(1)
        task_desc = match.group(3)
        trimmed_prefix = time_prefix.strip()
        trimmed_desc = task_desc.strip()
        if trimmed_desc:
            return f"{trimmed_prefix} {trimmed_desc}"
        else:
            return trimmed_prefix
    return line


HABIT_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/habitTracker");',
    "```",
    ""
]

WORK_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/workTracker");',
    "```",
    ""
]

HOUSE_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/houseTracker");',
    "```",
    ""
]


def inject_weekly_table_trackers(lines: List[str]) -> List[str]:
    """Ensures interactive DataviewJS weekly trackers are attached to Morning, Midday, Work, House, and Evening focus blocks."""
    full_text = "\n".join(lines)
    full_lower = full_text.lower()

    # Detect both legacy weeklyTableTracker blocks and new modular tracker calls
    has_habit_tracker = 'habittracker' in full_lower or ('section: "mornings"' in full_lower and 'weeklytabletracker' in full_lower)
    has_work_tracker = 'worktracker' in full_lower or ('section: "work"' in full_lower and 'weeklytabletracker' in full_lower)
    has_house_tracker = 'housetracker' in full_lower or ('section: "house"' in full_lower and 'weeklytabletracker' in full_lower)

    # Count how many habit/work tracker blocks are already present to
    # avoid duplicates per-block (morning, midday, evening each get one)
    habit_tracker_count = full_lower.count('habittracker') + full_lower.count('section: "mornings"')
    work_tracker_count = full_lower.count('worktracker') + full_lower.count('section: "work"')

    work_indices = []
    habit_indices = []
    in_focus_blocks = False
    for i, line in enumerate(lines):
        if "### ⏱️ Focus Blocks" in line:
            in_focus_blocks = True
            continue
        if in_focus_blocks and line.startswith("### "):
            in_focus_blocks = False
            continue
        if in_focus_blocks:
            if re.match(r"^\s*-\s*\[[ xX/]\]\s+(\d{1,2}:\d{2}\s*[\-–—~]\s*\d{1,2}:\d{2}\s+)?Work(\b|:)", line, re.IGNORECASE):
                work_indices.append(i)
            elif re.search(r"-\s*\[[ xX/]\]\s+.*(Morning Routine|Midday Routine|Evening Routine|Habits:\s*Morning|Habits:\s*Midday|Habits:\s*Evening)", line, re.IGNORECASE):
                habit_indices.append(i)
            elif re.search(r"-\s*\[[ xX/]\]\s+.*House\s*:", line, re.IGNORECASE):
                pass  # handled below

    output: List[str] = []
    in_focus = False
    injected_work = 0
    injected_habit = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        output.append(line)

        if "### ⏱️ Focus Blocks" in line:
            in_focus = True
            i += 1
            continue
        if in_focus and line.startswith("### "):
            in_focus = False
            i += 1
            continue

        if in_focus:
            # Check for any Habit Routine block (Morning, Midday, Evening)
            if i in habit_indices and injected_habit < len(habit_indices):
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                # Only inject if this specific block doesn't already have a tracker after it
                next_non_blank = i + 1
                while next_non_blank < len(lines) and not lines[next_non_blank].strip():
                    next_non_blank += 1
                already_has = (next_non_blank < len(lines) and
                               lines[next_non_blank].strip().startswith('```dataviewjs') and
                               next_non_blank + 1 < len(lines) and
                               ('habittracker' in lines[next_non_blank + 1].lower() or
                                'weeklytabletracker' in lines[next_non_blank + 1].lower()))
                if not already_has:
                    output.extend(HABIT_TRACKER_LINES)
                injected_habit += 1

            # Check for Work blocks
            elif i in work_indices:
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                next_non_blank = i + 1
                while next_non_blank < len(lines) and not lines[next_non_blank].strip():
                    next_non_blank += 1
                already_has = (next_non_blank < len(lines) and
                               lines[next_non_blank].strip().startswith('```dataviewjs') and
                               next_non_blank + 1 < len(lines) and
                               ('worktracker' in lines[next_non_blank + 1].lower() or
                                'weeklytabletracker' in lines[next_non_blank + 1].lower()))
                if not already_has:
                    output.extend(WORK_TRACKER_LINES)
                injected_work += 1

            # Check for House block
            elif not has_house_tracker and re.search(r"-\s*\[[ xX/]\]\s+.*House\s*:", line, re.IGNORECASE):
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                output.extend(HOUSE_TRACKER_LINES)
                has_house_tracker = True

        i += 1

    return output


def write_to_daily_note(note_path: str, new_schedule_items: str, headers: List[str]) -> bool:
    """Inserts or replaces schedule items under ## 📅Day Planner in the target daily note."""
    if not os.path.exists(note_path):
        print(f"Daily note not found at {note_path}.")
        return False

    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')
    start_idx = -1
    end_idx = -1

    for i, line in enumerate(lines):
        if "## 📅Day Planner" in line:
            start_idx = i
            break

    if start_idx == -1:
        for i, line in enumerate(lines):
            if "## ⚙️ Admin" in line or "## 🪵 Log" in line:
                start_idx = i
                end_idx = i
                break
        if start_idx == -1:
            start_idx = len(lines)
            end_idx = len(lines)
    else:
        for i in range(start_idx + 1, len(lines)):
            if lines[i].startswith('## '):
                end_idx = i
                break
        if end_idx == -1:
            end_idx = len(lines)

    # Combine headers (preserving taskloader and meditation links) and the schedule items,
    # injecting interactive weekly trackers for habits, work, and house.
    raw_schedule_lines = [normalize_time_range_spaces(item) for item in new_schedule_items.strip().split('\n') if item.strip()]
    tracked_schedule_lines = inject_weekly_table_trackers(raw_schedule_lines)
    new_schedule_lines = headers + tracked_schedule_lines
    updated_lines = lines[:start_idx] + new_schedule_lines + lines[end_idx:]

    with open(note_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(updated_lines))

    return True


def copy_to_clipboard(text: str) -> None:
    """Copies schedule text to Windows clipboard via PowerShell."""
    try:
        process = subprocess.Popen(['powershell', '-NoProfile', '-Command', '$input | Set-Clipboard'], stdin=subprocess.PIPE)
        process.communicate(input=text.encode('utf-8'))
        print("Schedule copied to clipboard!")
    except Exception as e:
        print("Failed to copy to clipboard:", e)
