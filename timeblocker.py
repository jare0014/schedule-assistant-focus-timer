import os
import sys

if sys.platform == 'win32':
    py_dir = os.path.dirname(sys.executable)
    dlls_dir = os.path.join(py_dir, 'DLLs')
    if os.path.exists(dlls_dir):
        try:
            os.add_dll_directory(dlls_dir)
        except Exception:
            pass
    try:
        os.add_dll_directory(py_dir)
    except Exception:
        pass
    os.environ['PATH'] = dlls_dir + os.path.pathsep + py_dir + os.path.pathsep + os.environ.get('PATH', '')

import datetime
import urllib.request
import json
import subprocess
import time
import re
from datetime import datetime, timezone, timedelta

# Google APIs
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Gemini SDK
from google import genai
from google.genai import types

# Tkinter for GUI
try:
    import tkinter as tk
    from tkinter import messagebox, scrolledtext
except ImportError:
    pass

# Scopes required for Google Calendar, Google Tasks, and Google Fit / Health API
SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks'
]

def get_timezone_offset():
    local_now = datetime.now()
    utc_now = datetime.utcnow()
    offset = local_now - utc_now
    offset_hours = int(round(offset.total_seconds() / 3600.0))
    return timezone(timedelta(hours=offset_hours))

def get_google_creds():
    creds = None
    token_path = os.path.join(os.path.dirname(__file__), 'token.json')
    creds_path = os.path.join(os.path.dirname(__file__), 'credentials.json')

    if os.path.exists(token_path):
        try:
            with open(token_path, 'r', encoding='utf-8') as f:
                token_data = json.load(f)
            token_scopes = token_data.get('scopes', [])
            if not all(s in token_scopes for s in SCOPES):
                print("New scopes requested. Re-authenticating...")
                creds = None
            else:
                creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception as e:
            print(f"Error reading token.json: {e}. Re-authenticating...")
            creds = None
        
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                print(f"Error refreshing credentials: {e}. Running full auth flow...")
                creds = None
        
        if not creds or not creds.valid:
            env_creds = os.environ.get("GOOGLE_CREDENTIALS_JSON")
            if env_creds:
                try:
                    client_config = json.loads(env_creds)
                    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
                    creds = flow.run_local_server(port=0)
                except Exception as e:
                    print(f"Error authenticating with GOOGLE_CREDENTIALS_JSON environment variable: {e}")
                    creds = None
            
            if not creds or not creds.valid:
                if not os.path.exists(creds_path):
                    raise FileNotFoundError(f"Google Client credentials not provided via GOOGLE_CREDENTIALS_JSON environment variable or credentials.json file at {creds_path}.")
                flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
                creds = flow.run_local_server(port=0)
            
        with open(token_path, 'w') as token:
            token.write(creds.to_json())
            
    return creds

def get_calendar_events(tz):
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

def get_google_tasks(tz):
    creds = get_google_creds()
    service = build('tasks', 'v1', credentials=creds)

    print("Fetching active task lists from Google Tasks...")
    tasklists_result = service.tasklists().list().execute()
    tasklists = tasklists_result.get('items', [])
    
    today_str = datetime.now(tz).strftime("%Y-%m-%d")
    google_tasks = []
    
    debug_path = os.path.join(os.path.dirname(__file__), 'task_ingestion_debug.log')
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

def get_todoist_token():
    token = os.environ.get("TODOIST_API_TOKEN")
    if token:
        return token
    # Fallback to check plugin data.json (for backward compatibility)
    data_path = os.path.join(os.path.dirname(__file__), 'data.json')
    if os.path.exists(data_path):
        try:
            with open(data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get("todoistToken"):
                return data["todoistToken"]
        except Exception:
            pass
    return ""

def get_todoist_tasks(tz):
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
    
    debug_path = os.path.join(os.path.dirname(__file__), 'task_ingestion_debug.log')
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
        # fallback
        for t in all_items:
            due = t.get("due")
            if due:
                due_date = due.get("date").split('T')[0]
                if due_date <= today_str:
                    today_tasks.append(t)
                
    return today_tasks

def get_todoist_projects():
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

def get_todoist_sections():
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


def extract_daily_note_tasks(note_path):
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

def get_planner_headers(note_path):
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

def get_preferences_path():
    return os.path.join(os.path.dirname(__file__), 'preferences.txt')

def load_preferences():
    path = get_preferences_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except Exception as e:
            print(f"Error loading preferences: {e}")
    return ""

def save_preferences(text):
    path = get_preferences_path()
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.strip())
    except Exception as e:
        print(f"Error saving preferences: {e}")

def generate_schedule(calendar_events, todoist_tasks, google_tasks, daily_tasks, tz, feedback=None, previous_schedule=None, user_preferences=None):
    if user_preferences is None:
        user_preferences = load_preferences()

    # Preprocessing: Strip past times from pending tasks so the LLM is forced to reschedule them
    processed_daily_tasks = []
    now = datetime.now(tz)
    current_minutes = now.hour * 60 + now.minute
    if now.hour < 5:
        current_minutes += 1440
        
    for task in daily_tasks:
        match = re.match(r'- \[ \]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(.*)', task)
        if match:
            start_time, end_time, details = match.groups()
            try:
                start_h, start_m = map(int, start_time.split(':'))
                start_minutes = start_h * 60 + start_m
                if start_h < 5:
                    start_minutes += 1440
                if start_minutes < current_minutes:
                    task = f"- [ ] {details}"
            except Exception:
                pass
        processed_daily_tasks.append(task)
    daily_tasks = processed_daily_tasks

    events_str = ""
    for ev in calendar_events:
        start_raw = ev.get('start', {}).get('dateTime', ev.get('start', {}).get('date', ''))
        end_raw = ev.get('end', {}).get('dateTime', ev.get('end', {}).get('date', ''))
        
        try:
            if 'T' in start_raw:
                s_dt = datetime.fromisoformat(start_raw.replace('Z', '+00:00'))
                e_dt = datetime.fromisoformat(end_raw.replace('Z', '+00:00'))
                start_time = s_dt.astimezone(tz).strftime("%H:%M")
                end_time = e_dt.astimezone(tz).strftime("%H:%M")
            else:
                start_time = "All Day"
                end_time = ""
        except Exception:
            start_time = start_raw
            end_time = end_raw
            
        time_display = f"{start_time} - {end_time}" if end_time else start_time
        summary = ev.get('summary', 'No Title')
        events_str += f"- {summary} ({time_display})\n"
        
    project_map = get_todoist_projects()
    section_map = get_todoist_sections()
    tasks_str = ""
    for t in todoist_tasks:
        content = t.get('content', '')
        desc = t.get('description', '')
        desc_str = f" (Description: {desc})" if desc else ""
        project_id = t.get('project_id')
        project_name = project_map.get(project_id, 'Inbox') if project_id else 'Inbox'
        section_id = t.get('section_id')
        section_name = section_map.get(section_id) if section_id else None

        if section_name:
            context_str = f" (Project: {project_name}, Section: {section_name})"
        else:
            context_str = f" (Project: {project_name})"

        if project_id:
            src_url = f"https://todoist.com/app/project/{project_id}/task/{t['id']}"
        else:
            src_url = f"https://todoist.com/app/task/{t['id']}"
            
        due = t.get('due')
        due_time_str = ""
        if due:
            date_str = due.get('date', '')
            if 'T' in date_str:
                try:
                    if date_str.endswith('Z') or '+' in date_str[10:] or '-' in date_str[10:]:
                        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                        local_dt = dt.astimezone(tz)
                    else:
                        naive_dt = datetime.fromisoformat(date_str)
                        local_dt = naive_dt.replace(tzinfo=tz)
                    due_time_str = f" (Due: {local_dt.strftime('%H:%M')})"
                except Exception as e:
                    print("Error parsing due date time:", e)
                    
        tasks_str += f"- {content}{due_time_str} [src]({src_url}){desc_str}{context_str}\n"


    google_tasks_str = ""
    for gt in google_tasks:
        title = gt.get('title', '')
        notes = gt.get('notes', '')
        notes_str = f" (Notes: {notes})" if notes else ""
        g_url = f"https://tasks.google.com/#listId={gt['list_id']}&taskId={gt['id']}"
        google_tasks_str += f"- {title}{notes_str} [src]({g_url})\n"

    daily_tasks_str = "\n".join(daily_tasks)

    print("Preparing schedule generation...")
    
    current_time = datetime.now(tz).strftime("%H:%M")
    
    if feedback and previous_schedule:
        prompt = f"""
        You are an expert daily scheduler.
        I previously generated this proposed schedule:
        
        {previous_schedule}
        
        The user gave this feedback to modify the schedule:
        "{feedback}"
        
        Please adjust the schedule according to the feedback while respecting these inputs, categorization subheadings, and rules:
        
        Original Raw Inputs:
        1. Existing Tasks from my Daily Note (includes habits, chores, etc.):
        {daily_tasks_str if daily_tasks_str else "(No tasks in daily note)"}
        
        2. Today's Google Calendar Events:
        {events_str if events_str else "(No calendar events scheduled today)"}
        
        3. Active Todoist Tasks:
        {tasks_str if tasks_str else "(No Todoist tasks due today)"}
        
        4. Active Google Tasks:
        {google_tasks_str if google_tasks_str else "(No Google Tasks due today)"}
        
        Rules:
        1. Respect Google Calendar events. They have fixed times and must be scheduled at those exact times:
           `- [ ] HH:MM - HH:MM Event Name [Calendar]`
           If a Google Calendar event corresponds to an active Todoist or Google Task (e.g. they share the same or similar name/topic), you MUST merge them and append the task's `[src](URL)` link before `[Calendar]`, like:
           `- [ ] HH:MM - HH:MM Event Name [src](URL) [Calendar]`
           Note: Google Tasks (whose links start with `https://tasks.google.com/`) are NOT calendar events. Unless a Google Task is explicitly merged with a Google Calendar event of the same name/topic, do NOT place it under the '### 📅 Calendar Events' subheading and do NOT append '[Calendar]' to it.
        2. Do NOT delete or omit any tasks from the original input list. All tasks, habits, and chores must be included in the schedule (either timed or untimed).
        3. Do NOT invent new tasks (such as "Lunch", "Breakfast", "Break", "Dinner", "Sleep") that are not explicitly present in the input lists.
        4. Group the schedule items under the following subheadings based on their nature (with an empty line before each subheading):
           
           ### 📅 Calendar Events
           (Include Google Calendar events here. Format them as checklist items: `- [ ] HH:MM - HH:MM Event Name [Calendar]`)
           
           ### ⏱️ Focus Blocks
           (Include complex, high-effort tasks, deep work, learning, projects, and structured Routine/Habit blocks—such as Morning Routine, Midday Routine, and Evening Routine from Todoist or Daily Note—taking 20 minutes or longer.
           IMPORTANT FOR TODOIST SECTIONS: If tasks belong to separate Todoist sections (e.g. Section: Morning Routine, Section: Midday Routine, Section: Evening Routine), you MUST create a SEPARATE, dedicated Focus Block for EACH section (e.g. `07:00 - 08:00 Habits: Morning Routine`, `12:00 - 12:30 Habits: Midday Routine`, `18:00 - 19:00 Habits: Evening Routine`). Do NOT merge or pile separate project sections into a single task!)
           
           ### ☁️ Floating Micro-Tasks (Untimed)
           (Include all fast administrative items, quick emails, and simple 5-10 minute micro-chores taking under 20 minutes. Do NOT include Routine or Habit blocks here—routines must be scheduled as Focus Blocks above.
           You MUST group and sort the tasks in this section by project/source. For each project/source group, list all checklist items under an H5 header showing the project name, formatted exactly as follows:
           
           ##### ProjectName
           
           - [ ] Task Name [src](URL)
           - [ ] Another Task [src](URL)

           Strip any trailing "(Project: ...)" context labels from the task names. Do NOT put bracketed project prefixes in the task names themselves.)
           
        5. Respect scheduled times and completion status:
           a. **Completed Tasks**: Any task from "Existing Tasks from my Daily Note" that starts with `- [x]` or `- [X]` is a completed task. You MUST preserve it in the schedule at its exact time range, unchanged, and keep its status (either `- [x]` or `- [X]`). Do NOT move, change, or remove completed tasks.
           b. **Pending Tasks Scheduling**: All pending/uncompleted tasks that require timing (marked with `- [ ]` from the daily note, or tasks requiring scheduled times) MUST be scheduled to start chronologically after the current time of {current_time}. Under no circumstances should any pending task be scheduled at a time before {current_time}. (For example, if {current_time} is 14:33, do not schedule any tasks at 08:00, 09:00, etc.) If {current_time} is earlier than 06:00 AM, you may start scheduling from 06:00 AM. Otherwise, you MUST start scheduling after {current_time}.
           c. **Overdue / Moved Tasks**: If an existing pending task in the daily note had a scheduled time range in the past (before {current_time}), you MUST reschedule it to start after {current_time}.
           d. If a task has an explicit due time (e.g. " (Due: 09:00 AM)"), you MUST schedule it at that time if it is in the future. If it is in the past, reschedule it to start after {current_time}. You can strip the " (Due: HH:MM AM/PM)" substring from the final scheduled task name.
           e. **Postponed Tasks**: If an input task from the daily note contains the tag `#postpone` (e.g. added by the mobile widget), you MUST reschedule it to start after the current time {current_time} (or treat it as a pending task that needs to be scheduled for later in the day), and you MUST strip the `#postpone` tag from the final scheduled task name in your output.
        6. Formatting checklist status:
           a. Completed tasks MUST be formatted starting exactly with "- [x] ".
           b. Pending tasks MUST be formatted starting exactly with "- [ ] ".
           c. Do NOT use "*" or any other bullet character.
           d. For Calendar Events and Focus Blocks, format scheduled times using 24-hour format (e.g., 08:00 - 08:30). 
           e. For Floating Micro-Tasks, do NOT include a time range. Group them under their respective H5 project headers.
        7. Clean up task names by removing any existing `BUTTON[...]` or `BUTTON[...]` button strings before formatting.
        8. Preserve any `[src](URL)` links in the tasks exactly as they are. Do not modify, remove, or rewrite these URL links. If you merge a task with a calendar event, place the `[src](URL)` link immediately before `[Calendar]`.
        9. Preserve all tags (e.g. #work) in the task content exactly as they are. Do not modify, remove, or strip any tags.
        10. Return ONLY the formatted subheadings and checklist lines. Do not include any main headers or markdown code block fences.
        
        Custom User Preferences to Respect:
        {user_preferences if user_preferences else "(No custom preferences specified)"}
        """
    else:
        prompt = f"""
        You are an expert daily scheduler. Create an optimized, categorized daily schedule by merging these four inputs:
        
        1. Existing Tasks from my Daily Note (includes habits, chores, etc.):
        {daily_tasks_str if daily_tasks_str else "(No tasks in daily note)"}
        
        2. Today's Google Calendar Events:
        {events_str if events_str else "(No calendar events scheduled today)"}
        
        3. Active Todoist Tasks:
        {tasks_str if tasks_str else "(No Todoist tasks due today)"}
        
        4. Active Google Tasks:
        {google_tasks_str if google_tasks_str else "(No Google Tasks due today)"}
        
        Rules:
        1. Respect Google Calendar events. They have fixed times and must be scheduled at those exact times:
           `- [ ] HH:MM - HH:MM Event Name [Calendar]`
           If a Google Calendar event corresponds to an active Todoist or Google Task (e.g. they share the same or similar name/topic), you MUST merge them and append the task's `[src](URL)` link before `[Calendar]`, like:
           `- [ ] HH:MM - HH:MM Event Name [src](URL) [Calendar]`
           Note: Google Tasks (whose links start with `https://tasks.google.com/`) are NOT calendar events. Unless a Google Task is explicitly merged with a Google Calendar event of the same name/topic, do NOT place it under the '### 📅 Calendar Events' subheading and do NOT append '[Calendar]' to it.
        2. Do NOT delete or omit any tasks from the "Existing Tasks", "Active Todoist Tasks", or "Active Google Tasks" list. All tasks, habits, and chores must be included in the schedule (either timed or untimed).
        3. Do NOT invent, hallucinate, or add any new tasks (such as "Lunch", "Breakfast", "Break", "Dinner", "Sleep") that are not explicitly present in the input lists.
        4. Group the schedule items under the following subheadings based on their nature (with an empty line before each subheading):
           
           ### 📅 Calendar Events
           (Include Google Calendar events here. Format them as checklist items: `- [ ] HH:MM - HH:MM Event Name [Calendar]`)
           
           ### ⏱️ Focus Blocks
           (Include complex, high-effort tasks, deep work, learning, projects, and structured Routine/Habit blocks—such as Morning Routine, Midday Routine, and Evening Routine from Todoist or Daily Note—taking 20 minutes or longer.
           IMPORTANT FOR TODOIST SECTIONS: If tasks belong to separate Todoist sections (e.g. Section: Morning Routine, Section: Midday Routine, Section: Evening Routine), you MUST create a SEPARATE, dedicated Focus Block for EACH section (e.g. `07:00 - 08:00 Habits: Morning Routine`, `12:00 - 12:30 Habits: Midday Routine`, `18:00 - 19:00 Habits: Evening Routine`). Do NOT merge or pile separate project sections into a single task!)
           
           ### ☁️ Floating Micro-Tasks (Untimed)
           (Include all fast administrative items, quick emails, and simple 5-10 minute micro-chores taking under 20 minutes. Do NOT include Routine or Habit blocks here—routines must be scheduled as Focus Blocks above.
           You MUST group and sort the tasks in this section by project/source. For each project/source group, list all checklist items under an H5 header showing the project name, formatted exactly as follows:
           
           ##### ProjectName
           
           - [ ] Task Name [src](URL)
           - [ ] Another Task [src](URL)

           Strip any trailing "(Project: ...)" context labels from the task names. Do NOT put bracketed project prefixes in the task names themselves.)
           
        5. Respect scheduled times and completion status:
           a. **Completed Tasks**: Any task from "Existing Tasks from my Daily Note" that starts with `- [x]` or `- [X]` is a completed task. You MUST preserve it in the schedule at its exact time range, unchanged, and keep its status (either `- [x]` or `- [X]`). Do NOT move, change, or remove completed tasks.
           b. **Pending Tasks Scheduling**: All pending/uncompleted tasks that require timing (marked with `- [ ]` from the daily note, or new tasks requiring scheduled times) MUST be scheduled to start chronologically after the current time of {current_time}. Under no circumstances should any pending task be scheduled at a time before {current_time}. (For example, if {current_time} is 14:33, do not schedule any tasks at 08:00, 09:00, etc.) If {current_time} is earlier than 06:00 AM, you may start scheduling from 06:00 AM. Otherwise, you MUST start scheduling after {current_time}.
           c. **Overdue / Moved Tasks**: If an existing pending task in the daily note had a scheduled time range in the past (before {current_time}), you MUST reschedule it to start after {current_time}.
           d. If a task has an explicit due time (e.g. " (Due: 09:00 AM)"), you MUST schedule it at that time if it is in the future. If it is in the past, reschedule it to start after {current_time}. You can strip the " (Due: HH:MM AM/PM)" substring from the final scheduled task name.
           e. **Postponed Tasks**: If an input task from the daily note contains the tag `#postpone` (e.g. added by the mobile widget), you MUST reschedule it to start after the current time {current_time} (or treat it as a pending task that needs to be scheduled for later in the day), and you MUST strip the `#postpone` tag from the final scheduled task name in your output.
        6. Formatting checklist status:
           a. Completed tasks MUST be formatted starting exactly with "- [x] ".
           b. Pending tasks MUST be formatted starting exactly with "- [ ] ".
           c. Do NOT use "*" or any other bullet character.
           d. For Calendar Events and Focus Blocks, format scheduled times using 24-hour format (e.g., 08:00 - 08:30). 
           e. For Floating Micro-Tasks, do NOT include a time range. Group them under their respective H5 project headers.
        7. Clean up task names by removing any existing `BUTTON[...]` or `BUTTON[...]` button strings before formatting.
        8. Preserve any `[src](URL)` links in the tasks exactly as they are. Do not modify, remove, or rewrite these URL links. If you merge a task with a calendar event, place the `[src](URL)` link immediately before `[Calendar]`.
        9. Preserve all tags (e.g. #work) in the task content exactly as they are. Do not modify, remove, or strip any tags.
        10. Return ONLY the formatted subheadings and checklist lines. Do not include any main headers or markdown code block fences.
        
        Custom User Preferences to Respect:
        {user_preferences if user_preferences else "(No custom preferences specified)"}
        """
    
    # Load LLM configurations from data.json
    llm_provider = 'gemini'
    llm_model = 'gemini-3.5-flash'
    ollama_url = 'http://localhost:11434'
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    
    data_path = os.path.join(os.path.dirname(__file__), 'data.json')
    if os.path.exists(data_path):
        try:
            with open(data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            llm_provider = data.get("llmProvider", llm_provider)
            llm_model = data.get("llmModel", llm_model)
            ollama_url = data.get("ollamaUrl", ollama_url)
            
            if not gemini_api_key and data.get("geminiApiKey"):
                gemini_api_key = data["geminiApiKey"]
        except Exception:
            pass

    response_text = None
    if llm_provider == 'gemini':
        if not gemini_api_key:
            config_path = os.path.join(os.path.dirname(__file__), 'config.json')
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r', encoding='utf-8') as f:
                        cfg = json.load(f)
                    if cfg.get("gemini_api_key"):
                        gemini_api_key = cfg["gemini_api_key"]
                except Exception:
                    pass
        client = None
        last_err = None
        if gemini_api_key:
            try:
                client = genai.Client(api_key=gemini_api_key)
            except Exception as e:
                last_err = e
                print(f"Failed to initialize Gemini Client: {e}")
        else:
            last_err = ValueError("No Gemini API key provided.")
            print("No Gemini API key provided.")
            
        if client:
            model_names = [llm_model]
            for fallback in ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']:
                if fallback not in model_names:
                    model_names.append(fallback)
                    
            for model_name in model_names:
                print(f"Trying Gemini model: {model_name}...")
                for attempt in range(4):
                    try:
                        response = client.models.generate_content(
                            model=model_name,
                            contents=prompt
                        )
                        if response and response.text:
                            response_text = response.text
                            break
                    except Exception as e:
                        err_msg = str(e)
                        last_err = e
                        is_quota_error = ("resource_exhausted" in err_msg.lower() or 
                                          "spending cap" in err_msg.lower() or 
                                          "quota" in err_msg.lower() or
                                          "perday" in err_msg.lower() or 
                                          "per-day" in err_msg.lower() or 
                                          "per_day" in err_msg.lower() or
                                          "per day" in err_msg.lower() or
                                          "daily" in err_msg.lower() or
                                          "limit: 0" in err_msg.lower())
                        is_transient = (("503" in err_msg or 
                                        "unavailable" in err_msg.lower() or 
                                        "demand" in err_msg.lower() or 
                                        "429" in err_msg or 
                                        "rate limit" in err_msg.lower() or 
                                        "retry in" in err_msg.lower()) and not is_quota_error)
                        if is_transient:
                            backoff = 2 ** attempt
                            if "retry in" in err_msg.lower():
                                try:
                                    delay_match = re.search(r"retry in ([\d\.]+)", err_msg.lower())
                                    if delay_match:
                                        backoff = int(float(delay_match.group(1))) + 1
                                except Exception:
                                    backoff = 20
                            print(f"Gemini model {model_name} call failed (transient rate-limit) with error: {err_msg}. Retrying in {backoff} seconds...")
                            time.sleep(backoff)
                        else:
                            print(f"Gemini model {model_name} call failed (permanent/quota) with error: {err_msg}")
                            if is_quota_error:
                                print("Gemini API quota/spend limit reached across project. Aborting remaining Gemini models.")
                                break
                if response_text:
                    break
        if not response_text:
            print(f"Gemini API failed ({last_err}). Attempting automatic fallback to local Ollama...")
            ollama_urls_to_try = [ollama_url, "http://100.93.91.76:11434", "http://localhost:11434", "http://127.0.0.1:11434"]
            unique_ollama_urls = []
            for u in ollama_urls_to_try:
                if u and u not in unique_ollama_urls:
                    unique_ollama_urls.append(u)
            
            ollama_models = ["qwen2.5:7b", "qwen2.5-coder:7b", "llama3.1", "llama3.2"]
            ollama_success = False
            for o_url in unique_ollama_urls:
                for o_model in ollama_models:
                    try:
                        url = f"{o_url.rstrip('/')}/api/generate"
                        payload = {"model": o_model, "prompt": prompt, "stream": False}
                        data_bytes = json.dumps(payload).encode("utf-8")
                        req = urllib.request.Request(url, data=data_bytes, headers={"Content-Type": "application/json"})
                        print(f"Trying Ollama fallback model '{o_model}' at {url}...")
                        with urllib.request.urlopen(req, timeout=120) as resp:
                            res_data = json.loads(resp.read().decode("utf-8"))
                            text = res_data.get("response", "")
                            if text:
                                response_text = text
                                ollama_success = True
                                print(f"Successfully generated schedule using Ollama fallback ({o_model})!")
                                break
                    except Exception as o_err:
                        print(f"Ollama fallback attempt failed ({o_model} at {o_url}): {o_err}")
                if ollama_success:
                    break

        if not response_text:
            raise last_err
            
    elif llm_provider == 'ollama':
        url = f"{ollama_url.rstrip('/')}/api/generate"
        payload = {
            "model": llm_model,
            "prompt": prompt,
            "stream": False
        }
        
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Trying Ollama model: {llm_model} at {url}...")
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                response_text = res_data.get("response", "")
                if not response_text:
                    raise ValueError(f"Ollama returned empty response: {res_data}")
        except Exception as e:
            print(f"Ollama API query failed: {e}")
            raise e
    else:
        raise ValueError(f"Unknown LLM Provider: {llm_provider}")
    
    schedule_lines = response_text.strip().splitlines()
    filtered_lines = []
    prohibited_terms = {'lunch', 'breakfast', 'dinner', 'break', 'sleep', 'leisure time', 'rest'}
    for line in schedule_lines:
        lower_line = line.lower()
        should_keep = True
        for term in prohibited_terms:
            if term in lower_line:
                in_daily = any(term in t.lower() for t in daily_tasks)
                in_todoist = any(term in t.get('content', '').lower() for t in todoist_tasks)
                in_calendar = any(term in ev.get('summary', '').lower() for ev in calendar_events)
                in_google_tasks = any(term in gt.get('title', '').lower() or term in gt.get('notes', '').lower() for gt in google_tasks)
                if not in_daily and not in_todoist and not in_calendar and not in_google_tasks:
                    should_keep = False
                    break
        if should_keep:
            filtered_lines.append(line)
        
    return '\n'.join(filtered_lines)

def normalize_time_range_spaces(line):
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

def write_to_daily_note(note_path, new_schedule_items, headers):
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

def copy_to_clipboard(text):
    try:
        process = subprocess.Popen(['powershell', '-NoProfile', '-Command', '$input | Set-Clipboard'], stdin=subprocess.PIPE)
        process.communicate(input=text.encode('utf-8'))
        print("Schedule copied to clipboard!")
    except Exception as e:
        print("Failed to copy to clipboard:", e)

# Tkinter GUI class definition
class ScheduleApp:
    def __init__(self, events, tasks, google_tasks, daily_tasks, tz, note_path, headers, initial_schedule):
        self.events = events
        self.tasks = tasks
        self.google_tasks = google_tasks
        self.daily_tasks = daily_tasks
        self.tz = tz
        self.note_path = note_path
        self.headers = headers
        self.current_schedule = initial_schedule
        
        self.root = tk.Tk()
        self.root.title("Schedule Assistant with Focus Timer")
        self.root.geometry("700x820")
        self.root.configure(bg="#1e1e1e")
        
        # Center the window and bring to front
        self.root.eval('tk::PlaceWindow . center')
        self.root.lift()
        self.root.attributes('-topmost', True)
        self.root.after_idle(self.root.attributes, '-topmost', False)
        
        # UI Styling
        self.title_font = ("Segoe UI", 12, "bold")
        self.body_font = ("Segoe UI", 10)
        self.code_font = ("Consolas", 11)
        
        # Title Header
        lbl_title = tk.Label(
            self.root, 
            text="Proposed Categorized Daily Schedule", 
            fg="#ffffff", 
            bg="#1e1e1e", 
            font=self.title_font
        )
        lbl_title.pack(pady=(12, 2))
        
        lbl_instructions = tk.Label(
            self.root,
            text="Feel free to edit the text box manually or type feedback below to adjust it via Gemini.",
            fg="#bbbbbb",
            bg="#1e1e1e",
            font=("Segoe UI", 9)
        )
        lbl_instructions.pack(pady=(0, 10))

        # Text Area for Schedule Preview
        self.preview_area = scrolledtext.ScrolledText(
            self.root, 
            width=80, 
            height=18, 
            bg="#252526", 
            fg="#d4d4d4", 
            insertbackground="white", 
            font=self.code_font,
            relief=tk.FLAT
        )
        self.preview_area.pack(pady=5, padx=20, fill=tk.BOTH, expand=True)
        self.update_preview_display()
        
        # Feedback Section
        lbl_feedback = tk.Label(
            self.root, 
            text="Adjustments / Instructions for this run:", 
            fg="#ffffff", 
            bg="#1e1e1e", 
            font=("Segoe UI", 10, "bold")
        )
        lbl_feedback.pack(anchor="w", padx=20, pady=(12, 2))
        
        self.feedback_entry = tk.Entry(
            self.root, 
            bg="#252526", 
            fg="#ffffff", 
            insertbackground="white", 
            font=self.body_font,
            relief=tk.FLAT,
            borderwidth=8
        )
        self.feedback_entry.pack(pady=5, padx=20, fill=tk.X)
        self.feedback_entry.focus_set()
        
        # Bind enter key to update schedule
        self.feedback_entry.bind("<Return>", lambda event: self.regenerate())
        
        # Persistent Preferences Section
        lbl_prefs = tk.Label(
            self.root, 
            text="Persistent Preferences & Custom Instructions (Autosaved):", 
            fg="#ffffff", 
            bg="#1e1e1e", 
            font=("Segoe UI", 10, "bold")
        )
        lbl_prefs.pack(anchor="w", padx=20, pady=(12, 2))
        
        self.prefs_area = scrolledtext.ScrolledText(
            self.root, 
            width=80, 
            height=4, 
            bg="#252526", 
            fg="#cccccc", 
            insertbackground="white", 
            font=self.body_font,
            relief=tk.FLAT
        )
        self.prefs_area.pack(pady=5, padx=20, fill=tk.X)
        self.load_preferences_to_ui()
        
        # Status Bar
        self.status_var = tk.StringVar(value="Status: Ready")
        self.lbl_status = tk.Label(
            self.root, 
            textvariable=self.status_var, 
            fg="#00ffd0", 
            bg="#1e1e1e", 
            font=("Segoe UI", 9, "italic")
        )
        self.lbl_status.pack(pady=5)
        
        # Button bar
        btn_frame = tk.Frame(self.root, bg="#1e1e1e")
        btn_frame.pack(pady=(10, 20))
        
        # Customize buttons
        btn_update = tk.Button(
            btn_frame, 
            text="Regenerate / Adjust", 
            command=self.regenerate, 
            bg="#0d6efd", 
            fg="white", 
            activebackground="#0b5ed7", 
            activeforeground="white", 
            font=self.body_font, 
            padx=12, 
            pady=6, 
            relief=tk.FLAT
        )
        btn_update.pack(side=tk.LEFT, padx=8)
        
        btn_apply = tk.Button(
            btn_frame, 
            text="Write to Daily Note", 
            command=self.apply, 
            bg="#198754", 
            fg="white", 
            activebackground="#157347", 
            activeforeground="white", 
            font=self.body_font, 
            padx=12, 
            pady=6, 
            relief=tk.FLAT
        )
        btn_apply.pack(side=tk.LEFT, padx=8)
        
        btn_cancel = tk.Button(
            btn_frame, 
            text="Cancel", 
            command=self.cancel, 
            bg="#6c757d", 
            fg="white", 
            activebackground="#5c636a", 
            activeforeground="white", 
            font=self.body_font, 
            padx=12, 
            pady=6, 
            relief=tk.FLAT
        )
        btn_cancel.pack(side=tk.LEFT, padx=8)

    def update_preview_display(self):
        self.preview_area.delete("1.0", tk.END)
        self.preview_area.insert(tk.END, self.current_schedule)
        
    def load_preferences_to_ui(self):
        prefs = load_preferences()
        self.prefs_area.delete("1.0", tk.END)
        self.prefs_area.insert(tk.END, prefs)
        
    def save_preferences_from_ui(self):
        prefs = self.prefs_area.get("1.0", tk.END).strip()
        save_preferences(prefs)
        return prefs
        
    def regenerate(self):
        feedback = self.feedback_entry.get().strip()
        if not feedback:
            # If no text in feedback box but we click regenerate, we will re-generate using updated preferences
            feedback = "Apply updated custom preferences."
            
        self.status_var.set("Status: Generating schedule adjustments...")
        self.root.update_idletasks()
        
        # Save current preferences
        prefs = self.save_preferences_from_ui()
        
        # Read the latest preview content (in case user manually edited something first)
        edited_schedule = self.preview_area.get("1.0", tk.END).strip()
        
        try:
            new_schedule = generate_schedule(
                self.events, self.tasks, self.google_tasks, self.daily_tasks, self.tz,
                feedback=feedback, previous_schedule=edited_schedule, user_preferences=prefs
            )
            if new_schedule:
                self.current_schedule = new_schedule
                self.update_preview_display()
                self.feedback_entry.delete(0, tk.END)
                self.status_var.set("Status: Schedule updated successfully!")
            else:
                self.status_var.set("Status: Failed to update schedule (empty response).")
        except Exception as e:
            self.status_var.set("Status: Error during generation.")
            messagebox.showerror("Error", f"Failed to regenerate schedule:\n{e}")
            
    def apply(self):
        # Save latest preferences changes
        self.save_preferences_from_ui()
        
        # Read final content from preview area to support manual edits
        final_schedule = self.preview_area.get("1.0", tk.END).strip()
        
        if write_to_daily_note(self.note_path, final_schedule, self.headers):
            messagebox.showinfo("Success", "Daily Note successfully updated!")
            self.root.destroy()
        else:
            messagebox.showwarning("Warning", "Could not update Daily Note file. Copying to clipboard instead...")
            copy_to_clipboard(final_schedule)
            self.root.destroy()
            
    def cancel(self):
        self.root.destroy()
        
    def run(self):
        self.root.mainloop()

def normalize_existing_task_links(daily_tasks, todoist_tasks):
    import re
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

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
        
    tz = get_timezone_offset()
    note_path = os.environ.get("DAILY_NOTE_PATH")
    if not note_path:
        today_str = datetime.now(tz).strftime("%Y-%m-%d")
        vault_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        note_path = os.path.join(vault_root, "02_Journal", "01_Daily", f"{today_str}.md")
    
    # Initialize task ingestion debug log
    debug_log_path = os.path.join(os.path.dirname(__file__), 'task_ingestion_debug.log')
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
        # Check custom plugin settings in the same directory (when bundled)
        try:
            plugin_data_path = os.path.join(os.path.dirname(__file__), 'data.json')
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
