"""
cli.py - Main entrypoint and command-line execution coordinator for timeblocker.
"""

import os
import sys
import json
from datetime import datetime

from .auth import get_timezone_offset, get_base_dir
from .integrations import get_calendar_events, get_todoist_tasks, get_google_tasks
from .parser import extract_daily_note_tasks, get_planner_headers, normalize_existing_task_links
from .scheduler import generate_schedule
from .writer import write_to_daily_note, copy_to_clipboard
from .gui import ScheduleApp


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    if '--help' in sys.argv or '-h' in sys.argv:
        print("Usage: python timeblocker.py [--yes]")
        print("  --yes: Run in headless mode and automatically write generated schedule to daily note")
        print("  (omitted): Fetch tasks and open interactive Tkinter schedule preview UI")
        return

    tz = get_timezone_offset()
    base_dir = get_base_dir()

    note_path = os.environ.get("DAILY_NOTE_PATH")
    if not note_path:
        today_str = datetime.now(tz).strftime("%Y-%m-%d")
        vault_root = os.path.dirname(os.path.dirname(os.path.dirname(base_dir)))
        note_path = os.path.join(vault_root, "02_Journal", "01_Daily", f"{today_str}.md")

    # Initialize task ingestion diagnostic log
    debug_log_path = os.path.join(base_dir, 'task_ingestion_debug.log')
    try:
        with open(debug_log_path, 'w', encoding='utf-8') as f:
            f.write(f"=== TASK INGESTION DIAGNOSTIC LOG - {datetime.now(tz).isoformat()} ===\n")
            f.write(f"Target Daily Note: {note_path}\n")
    except Exception as e:
        print(f"Log initialization failed: {e}")

    daily_tasks = extract_daily_note_tasks(note_path)
    headers = get_planner_headers(note_path)

    try:
        events = get_calendar_events(tz)
    except Exception as e:
        print(f"Error reading calendar: {e}")
        events = []

    try:
        tasks = get_todoist_tasks(tz)
    except Exception as e:
        print(f"Error reading Todoist: {e}")
        tasks = []

    try:
        google_tasks = get_google_tasks(tz)
    except Exception as e:
        print(f"Error reading Google Tasks: {e}")
        google_tasks = []

    # Filter daily note tasks to remove any generic hallucinated tasks from prior runs
    filtered_daily_tasks = []
    prohibited_terms = {'lunch', 'breakfast', 'dinner', 'break', 'sleep', 'leisure time', 'rest'}
    for dt in daily_tasks:
        dt_lower = dt.lower()
        has_prohibited = any(term in dt_lower for term in prohibited_terms)
        if has_prohibited:
            in_todoist = any(any(term in t.get('content', '').lower() for term in prohibited_terms if term in dt_lower) for t in tasks)
            in_calendar = any(any(term in ev.get('summary', '').lower() for term in prohibited_terms if term in dt_lower) for ev in events)
            in_google = any(any(term in gt.get('title', '').lower() or term in gt.get('notes', '').lower() for term in prohibited_terms if term in dt_lower) for gt in google_tasks)
            if not in_todoist and not in_calendar and not in_google:
                log_msg = f"[FILTERED OUT] Likely hallucinated task from daily note: {dt}"
                print(log_msg)
                try:
                    with open(debug_log_path, 'a', encoding='utf-8') as f:
                        f.write(f"\n{log_msg}\n")
                except Exception:
                    pass
                continue
        filtered_daily_tasks.append(dt)
    daily_tasks = filtered_daily_tasks
    daily_tasks = normalize_existing_task_links(daily_tasks, tasks)

    if not events and not tasks and not google_tasks and not daily_tasks:
        print("No tasks or calendar events found for today.")
        return

    schedule_items = generate_schedule(events, tasks, google_tasks, daily_tasks, tz)

    print("\n--- Proposed Schedule Items ---")
    print(schedule_items)
    print("-------------------------\n")

    # Check if run with -y or --yes flag for automation
    auto_apply = ('--yes' in sys.argv or '-y' in sys.argv)
    if not auto_apply:
        try:
            plugin_data_path = os.path.join(base_dir, 'data.json')
            if os.path.exists(plugin_data_path):
                with open(plugin_data_path, 'r', encoding='utf-8') as f:
                    plugin_settings = json.load(f)
                if plugin_settings.get("autoApply") is True:
                    auto_apply = True
        except Exception as e:
            print(f"Error checking plugin settings: {e}")

    if auto_apply:
        if write_to_daily_note(note_path, schedule_items, headers):
            print("Daily Note successfully updated automatically!")
        else:
            copy_to_clipboard(schedule_items)
    else:
        # Launch Tkinter GUI
        try:
            app = ScheduleApp(events, tasks, google_tasks, daily_tasks, tz, note_path, headers, schedule_items)
            app.run()
        except Exception as e:
            # Fallback in case GUI cannot start (e.g. no DISPLAY)
            print(f"Failed to launch GUI: {e}")
            if not sys.stdin.isatty():
                print("Non-interactive environment detected. Automatically writing to Daily Note...")
                if write_to_daily_note(note_path, schedule_items, headers):
                    print("Daily Note successfully updated!")
                else:
                    print("Could not update Daily Note file. Copying to clipboard instead...")
                    copy_to_clipboard(schedule_items)
                return

            print("Falling back to console interface.")
            sys.stdout.write("Would you like to write this directly to your Daily Note? (y/n): ")
            sys.stdout.flush()
            ans = sys.stdin.readline().strip().lower()

            if ans == 'y':
                if write_to_daily_note(note_path, schedule_items, headers):
                    print("Daily Note successfully updated!")
                else:
                    print("Could not update Daily Note file. Copying to clipboard instead...")
                    copy_to_clipboard(schedule_items)
            else:
                print("Copying schedule to clipboard so you can paste it manually...")
                copy_to_clipboard(schedule_items)


if __name__ == '__main__':
    main()
