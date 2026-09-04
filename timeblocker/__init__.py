"""
timeblocker - Modular scheduling package for Obsidian Day Planner.
"""

from .auth import get_timezone_offset, get_google_creds, get_todoist_token
from .integrations import get_calendar_events, get_todoist_tasks, get_google_tasks
from .parser import extract_daily_note_tasks, get_planner_headers, normalize_existing_task_links
from .preferences import load_preferences, save_preferences
from .scheduler import generate_schedule
from .writer import write_to_daily_note, copy_to_clipboard
from .cli import main

__all__ = [
    "get_timezone_offset",
    "get_google_creds",
    "get_todoist_token",
    "get_calendar_events",
    "get_todoist_tasks",
    "get_google_tasks",
    "extract_daily_note_tasks",
    "get_planner_headers",
    "normalize_existing_task_links",
    "load_preferences",
    "save_preferences",
    "generate_schedule",
    "write_to_daily_note",
    "copy_to_clipboard",
    "main",
]
