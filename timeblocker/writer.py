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


MORNINGS_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "Mornings",',
    '    label: "☀️ Weekly Mornings Habit Tracker",',
    '    sectionAnchor: "Mornings",',
    '    startTime: "05:00",',
    '    endTime: "09:00"',
    '});',
    "```",
    ""
]

WORK_TRACKER_1_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "Work",',
    '    label: "💼 Weekly Work Tasks Tracker",',
    '    sectionAnchor: "Work",',
    '    startTime: "09:00",',
    '    endTime: "13:00"',
    '});',
    "```",
    ""
]

WORK_TRACKER_2_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "Work",',
    '    label: "💼 Weekly Work Tasks Tracker",',
    '    sectionAnchor: "Work",',
    '    startTime: "13:00",',
    '    endTime: "16:00"',
    '});',
    "```",
    ""
]

WORK_TRACKER_SINGLE_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "Work",',
    '    label: "💼 Weekly Work Tasks Tracker",',
    '    sectionAnchor: "Work",',
    '    startTime: "09:00",',
    '    endTime: "16:00"',
    '});',
    "```",
    ""
]

HOUSE_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "House",',
    '    label: "🏡 Weekly House Tasks Tracker",',
    '    sectionAnchor: "🏡 House & Chores",',
    '    startTime: "16:00",',
    '    endTime: "21:00"',
    '});',
    "```",
    ""
]

MIDDAY_TRACKER_LINES = [
    "",
    "```dataviewjs",
    'await dv.view("99_System/Scripts/weeklyTableTracker", {',
    '    section: "Mornings",',
    '    label: "☀️ Habits Matrix (Midday Check)",',
    '    sectionAnchor: "Mornings",',
    '    startTime: "12:00",',
    '    endTime: "13:30"',
    '});',
    "```",
    ""
]


def inject_weekly_table_trackers(lines: List[str]) -> List[str]:
    """Ensures interactive collapsible DataviewJS weekly trackers are attached to Morning, Midday, Work, and House focus blocks."""
    full_text = "\n".join(lines)
    has_mornings_tracker = 'Weekly Mornings Habit Tracker' in full_text or ('section: "Mornings"' in full_text and 'startTime: "05:00"' in full_text)
    has_midday_tracker = 'Habits Matrix (Midday Check)' in full_text or 'startTime: "12:00"' in full_text
    has_work_tracker = 'section: "Work"' in full_text
    has_house_tracker = 'section: "House"' in full_text

    work_indices = []
    in_focus_blocks = False
    for i, line in enumerate(lines):
        if "### ⏱️ Focus Blocks" in line:
            in_focus_blocks = True
            continue
        if in_focus_blocks and line.startswith("### "):
            in_focus_blocks = False
            continue
        if in_focus_blocks and re.match(r"^\s*-\s*\[[ xX/]\]\s+(\d{1,2}:\d{2}\s*[\-–—~]\s*\d{1,2}:\d{2}\s+)?Work(\b|:)", line, re.IGNORECASE):
            work_indices.append(i)

    output: List[str] = []
    in_focus = False
    work_count = 0

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
            # Check for Morning Routine
            if not has_mornings_tracker and re.search(r"-\s*\[[ xX/]\]\s+.*(Morning Routine|Habits:\s*Morning)", line, re.IGNORECASE):
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                output.extend(MORNINGS_TRACKER_LINES)
                has_mornings_tracker = True

            # Check for Midday Routine
            elif not has_midday_tracker and re.search(r"-\s*\[[ xX/]\]\s+.*(Midday Routine|Habits:\s*Midday)", line, re.IGNORECASE):
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                output.extend(MIDDAY_TRACKER_LINES)
                has_midday_tracker = True

            # Check for Work blocks
            elif not has_work_tracker and i in work_indices:
                while i + 1 < len(lines) and re.match(r"^\s{2,}-\s*\[[ xX/]\]", lines[i + 1]):
                    i += 1
                    output.append(lines[i])
                if len(work_indices) >= 2:
                    if work_count == 0:
                        output.extend(WORK_TRACKER_1_LINES)
                    else:
                        output.extend(WORK_TRACKER_2_LINES)
                else:
                    output.extend(WORK_TRACKER_SINGLE_LINES)
                work_count += 1
                if work_count >= len(work_indices):
                    has_work_tracker = True

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
