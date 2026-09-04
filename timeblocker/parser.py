"""
parser.py - Markdown parser and link normalizer for Obsidian daily notes.
"""

import os
import re
from typing import List, Dict, Any


def extract_daily_note_tasks(note_path: str) -> List[str]:
    """Extracts checklist items under the ## 📅Day Planner header in a daily note."""
    if not os.path.exists(note_path):
        return []
    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.splitlines()
    tasks = []
    in_planner = False

    for line in lines:
        if "## 📅Day Planner" in line:
            in_planner = True
            continue
        if in_planner and line.startswith('## '):
            break
        if in_planner:
            stripped = line.strip()
            # Extract checklist items (both open and completed)
            if stripped.startswith('- [ ]') or stripped.startswith('- [x]') or stripped.startswith('- [X]'):
                # Strip out any existing inline timer buttons to let Gemini regenerate clean ones
                clean_task = stripped.replace('`BUTTON[timer-', '').replace('BUTTON[timer-', '')
                clean_task = clean_task.replace(']`', '').replace(']', '')
                tasks.append(stripped)
    return tasks


def get_planner_headers(note_path: str) -> List[str]:
    """Extracts the header lines between ## 📅Day Planner and the first task or subheading."""
    if not os.path.exists(note_path):
        return ["## 📅Day Planner", "`BUTTON[taskloader]`"]
    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.splitlines()
    headers = []
    found_planner = False
    for line in lines:
        if "## 📅Day Planner" in line:
            found_planner = True
            headers.append("## 📅Day Planner")
            continue
        if found_planner:
            # Stop when we hit the first subheading, main heading, or checklist item
            if line.startswith('##') or line.strip().startswith('- ['):
                break
            headers.append(line)

    # Ensure taskloader button is present in the headers, on the line below the main heading
    has_button = any("BUTTON[taskloader]" in h for h in headers)
    if not has_button:
        headers.insert(1, "`BUTTON[taskloader]`")

    return headers


def normalize_existing_task_links(daily_tasks: List[str], todoist_tasks: List[Dict[str, Any]]) -> List[str]:
    """Normalizes Todoist and Google Tasks links to modern hash/app URLs."""
    # Map todoist task_id to its project_id
    todoist_project_map = {}
    for t in todoist_tasks:
        if 'id' in t and 'project_id' in t:
            todoist_project_map[t['id']] = t['project_id']

    normalized_tasks = []
    for dt in daily_tasks:
        # 1. Normalize Google Tasks: tasks.google.com/?listId=...&taskId=... -> tasks.google.com/#listId=...&taskId=...
        dt = re.sub(
            r'tasks\.google\.com/\?(listId|list)=([^&]+)&(taskId|task)=([^\s\)]+)',
            r'tasks.google.com/#listId=\2&taskId=\4',
            dt
        )
        dt = re.sub(
            r'tasks\.google\.com/task/([^/]+)/([^\s\)]+)',
            r'tasks.google.com/#listId=\1&taskId=\2',
            dt
        )

        # 2. Normalize Todoist tasks:
        todoist_match = re.search(
            r'https?://(?:app\.)?todoist\.com/(?:showTask\?id=|app/task/|app/project/[^/]+/task/)([A-Za-z0-9_-]+)',
            dt
        )
        if todoist_match:
            task_id = todoist_match.group(1)
            project_id = todoist_project_map.get(task_id)
            if project_id:
                new_url = f"https://todoist.com/app/project/{project_id}/task/{task_id}"
            else:
                new_url = f"https://todoist.com/app/task/{task_id}"
            dt = dt.replace(todoist_match.group(0), new_url)

        normalized_tasks.append(dt)

    return normalized_tasks
