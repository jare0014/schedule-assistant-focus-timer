"""
integrations.py - External service integrations for Google Calendar, Google Tasks, and Todoist.
"""

import os
import json
import urllib.request
from datetime import datetime
from typing import List, Dict, Any
from googleapiclient.discovery import build

from .auth import get_google_creds, get_todoist_token, get_base_dir


def get_calendar_events(tz) -> List[Dict[str, Any]]:
    """Fetches today's non-task events from Google Calendar."""
    creds = get_google_creds()
    service = build('calendar', 'v3', credentials=creds)

    today = datetime.now(tz).date()
    start_dt = datetime.combine(today, datetime.min.time()).replace(tzinfo=tz)
    end_dt = datetime.combine(today, datetime.max.time()).replace(tzinfo=tz)

    time_min = start_dt.isoformat()
    time_max = end_dt.isoformat()

    print(f"Fetching Google Calendar events between {time_min} and {time_max}...")

    events_result = service.events().list(
        calendarId='primary',
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    events = events_result.get('items', [])
    filtered_events = []
    for event in events:
        description = event.get('description', '')
        if 'tasks.google.com' in description:
            continue
        filtered_events.append(event)
    return filtered_events


def get_google_tasks(tz) -> List[Dict[str, Any]]:
    """Fetches active tasks due today or earlier from Google Tasks."""
    creds = get_google_creds()
    service = build('tasks', 'v1', credentials=creds)

    print("Fetching active task lists from Google Tasks...")
    tasklists_result = service.tasklists().list().execute()
    tasklists = tasklists_result.get('items', [])

    today_str = datetime.now(tz).strftime("%Y-%m-%d")
    google_tasks = []

    debug_path = os.path.join(get_base_dir(), 'task_ingestion_debug.log')
    for tl in tasklists:
        list_id = tl['id']
        list_title = tl['title']
        print(f"Fetching active tasks from Google Tasks list '{list_title}'...")
        tasks_result = service.tasks().list(tasklist=list_id, showCompleted=False).execute()
        items = tasks_result.get('items', [])

        try:
            with open(debug_path, 'a', encoding='utf-8') as f:
                f.write(f"\n--- Google Tasks Fetch Diagnostics for list '{list_title}' ({len(items)} items) ---\n")
                for task in items:
                    title = task.get('title', 'No Title')
                    due = task.get('due')
                    if not due:
                        f.write(f"[EXCLUDED] '{title}' (ID: {task.get('id')}): No due date set.\n")
                        continue
                    due_date = due.split('T')[0]
                    if due_date <= today_str:
                        f.write(f"[INCLUDED] '{title}' (ID: {task.get('id')}): Due date {due_date} <= today {today_str}.\n")
                        task['list_title'] = list_title
                        task['list_id'] = list_id
                        google_tasks.append(task)
                    else:
                        f.write(f"[EXCLUDED] '{title}' (ID: {task.get('id')}): Due date {due_date} is in the future.\n")
        except Exception as e:
            print(f"Google Tasks logging error: {e}")
            for task in items:
                due = task.get('due')
                if due:
                    due_date = due.split('T')[0]
                    if due_date <= today_str:
                        task['list_title'] = list_title
                        task['list_id'] = list_id
                        google_tasks.append(task)

    return google_tasks


def get_todoist_tasks(tz) -> List[Dict[str, Any]]:
    """Fetches active tasks due today or earlier from Todoist."""
    token = get_todoist_token()
    url = "https://api.todoist.com/api/v1/tasks"
    all_items = []

    print("Fetching active tasks from Todoist...")
    while True:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}"
        })
        try:
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                if isinstance(res_data, list):
                    all_items.extend(res_data)
                    break
                elif isinstance(res_data, dict):
                    items = res_data.get("results", [])
                    all_items.extend(items)
                    cursor = res_data.get("next_cursor")
                    if cursor:
                        url = f"https://api.todoist.com/api/v1/tasks?cursor={cursor}"
                    else:
                        break
                else:
                    break
        except Exception as e:
            print("Todoist API Error:", e)
            break

    today_str = datetime.now(tz).strftime("%Y-%m-%d")
    today_tasks = []

    debug_path = os.path.join(get_base_dir(), 'task_ingestion_debug.log')
    try:
        with open(debug_path, 'a', encoding='utf-8') as f:
            f.write(f"\n--- Todoist Fetch Diagnostics ({len(all_items)} total tasks returned from API) ---\n")
            for t in all_items:
                content = t.get("content", "No content")
                due = t.get("due")
                if not due:
                    f.write(f"[EXCLUDED] '{content}' (ID: {t.get('id')}): No due date set.\n")
                    continue
                due_date = due.get("date").split('T')[0]
                if due_date <= today_str:
                    f.write(f"[INCLUDED] '{content}' (ID: {t.get('id')}): Due date {due_date} <= today {today_str}.\n")
                    today_tasks.append(t)
                else:
                    f.write(f"[EXCLUDED] '{content}' (ID: {t.get('id')}): Due date {due_date} is in the future.\n")
    except Exception as e:
        print(f"Todoist logging error: {e}")
        for t in all_items:
            due = t.get("due")
            if due:
                due_date = due.get("date").split('T')[0]
                if due_date <= today_str:
                    today_tasks.append(t)

    return today_tasks


def get_todoist_projects() -> Dict[str, str]:
    """Fetches Todoist project ID to project name map."""
    token = get_todoist_token()
    url = "https://api.todoist.com/api/v1/projects"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}"
    })
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            projects = res_data.get("results", []) if isinstance(res_data, dict) else res_data
            return {p['id']: p['name'] for p in projects if 'id' in p and 'name' in p}
    except Exception as e:
        print("Error fetching Todoist projects:", e)
        return {}


def get_todoist_sections() -> Dict[str, str]:
    """Fetches Todoist section ID to section name map."""
    token = get_todoist_token()
    if not token:
        return {}
    url = "https://api.todoist.com/api/v1/sections"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}"
    })
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            sections = res_data.get("results", []) if isinstance(res_data, dict) else res_data
            return {s['id']: s['name'] for s in sections if 'id' in s and 'name' in s}
    except Exception as e:
        print("Error fetching Todoist sections:", e)
        return {}
