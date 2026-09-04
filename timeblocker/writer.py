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

    # Combine headers (preserving taskloader and meditation links) and the schedule items
    new_schedule_lines = headers + [normalize_time_range_spaces(item) for item in new_schedule_items.strip().split('\n') if item.strip()]
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
