import os
import sys
import datetime
import urllib.request
import json
import subprocess
import time
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

# Scopes required for Google Calendar and Google Tasks
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
    creds_path = 'C:\\Users\\aljar\\Documents\\antigravity\\bold-archimedes\\credentials.json'

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
            if not os.path.exists(creds_path):
                raise FileNotFoundError(f"credentials.json not found at {creds_path}. Please place it there.")
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
    
    for tl in tasklists:
        list_id = tl['id']
        list_title = tl['title']
        print(f"Fetching active tasks from Google Tasks list '{list_title}'...")
        tasks_result = service.tasks().list(tasklist=list_id, showCompleted=False).execute()
        items = tasks_result.get('items', [])
        
        for task in items:
            due = task.get('due')
            if due:
                due_date = due.split('T')[0]
                if due_date <= today_str:
                    task['list_title'] = list_title
                    task['list_id'] = list_id
                    google_tasks.append(task)
                
    return google_tasks

def get_todoist_tasks(tz):
    token = ""
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
    
    for t in all_items:
        due = t.get("due")
        if due:
            due_date = due.get("date").split('T')[0]
            # Include items due today or overdue
            if due_date <= today_str:
                today_tasks.append(t)
                
    return today_tasks

def extract_daily_note_tasks(note_path):
    if not os.path.exists(note_path):
        return []
    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
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
            if stripped.startswith('- [ ]') or stripped.startswith('- [x]'):
                # Strip out any existing inline timer buttons to let Gemini regenerate clean ones
                clean_task = stripped.replace('`BUTTON[timer-', '').replace('BUTTON[timer-', '')
                clean_task = clean_task.replace(']`', '').replace(']', '')
                tasks.append(stripped)
    return tasks

def get_planner_headers(note_path):
    if not os.path.exists(note_path):
        return ["## 📅Day Planner `BUTTON[taskloader]`"]
    with open(note_path, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    headers = []
    found_planner = False
    for line in lines:
        if "## 📅Day Planner" in line:
            found_planner = True
            headers.append(line)
            continue
        if found_planner:
            # Stop when we hit the first subheading or checklist item
            if line.startswith('###') or line.strip().startswith('- ['):
                break
            headers.append(line)
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
        
    tasks_str = ""
    for t in todoist_tasks:
        content = t.get('content', '')
        desc = t.get('description', '')
        desc_str = f" (Description: {desc})" if desc else ""
        project_id = t.get('project_id')
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
                    due_time_str = f" (Due: {local_dt.strftime('%I:%M %p')})"
                except Exception as e:
                    print("Error parsing due date time:", e)
                    
        tasks_str += f"- {content}{due_time_str} [src]({src_url}){desc_str}\n"

    google_tasks_str = ""
    for gt in google_tasks:
        title = gt.get('title', '')
        notes = gt.get('notes', '')
        notes_str = f" (Notes: {notes})" if notes else ""
        g_url = f"https://tasks.google.com/#listId={gt['list_id']}&taskId={gt['id']}"
        google_tasks_str += f"- {title}{notes_str} [src]({g_url})\n"

    daily_tasks_str = "\n".join(daily_tasks)

    print("Sending events and tasks to Gemini for scheduling...")
    
    api_key = "<API_KEY_SCRUBBED>"
    client = genai.Client(api_key=api_key)
    
    current_time = datetime.now(tz).strftime("%I:%M %p")
    
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
        2. Do NOT delete or omit any tasks from the original input list. All habits, work tasks, house chores, and admin tasks must be scheduled.
        3. Do NOT invent new tasks (such as "Lunch", "Breakfast", "Break", "Dinner", "Sleep") that are not explicitly present in the input lists.
        4. Group the schedule items under the following four subheadings based on their nature (with an empty line before each subheading):
           
           ### 📅 Calendar Events
           (Include Google Calendar events here. Format them as checklist items: `- [ ] HH:MM - HH:MM Event Name [Calendar]`)
           
           ### 💻 Work Tasks
           (Include all work-related tasks, such as those with #work tag, Todoist work projects, or digital tasks for work)
           
           ### 🏠 House Chores & Personal
           (Include all home/life chores like treadmill maintenance, mowing the lawn, shopping, sanctuary visits, neck rest, exercises, etc.)
           
           ### ⚙️ Admin & Digital Chores
           (Include all inbox reviews, sync fixes, cancellation tasks, dentist calls, checklist cleanups, digital maintenance, etc.)
           
        5. Respect scheduled times:
           a. If a Todoist task has an explicit due time (e.g. " (Due: 09:00 AM)"), you MUST schedule it at that time. You can strip the " (Due: HH:MM AM/PM)" substring from the final scheduled task name.
           b. If an "Existing Task" from the daily note already has a scheduled time range (e.g., "06:30 - 06:45"), you MUST preserve that exact time range.
           c. For all other tasks (without an explicit due time or existing time range), distribute them chronologically starting from {current_time} (or from 06:00 AM if {current_time} is earlier in the day).
        6. EVERY single schedule item (whether a calendar event, work task, house chore, or admin task) MUST be formatted as an Obsidian checklist item starting exactly with "- [ ] ". Do NOT use "*" or any other bullet character.
        7. For all timed tasks (excluding calendar events), format them exactly like this example (with backticks ONLY around the BUTTON part):
           - [ ] HH:MM - HH:MM Task Name `BUTTON[timer-D]` [src](URL)
           Ensure that backticks (`) are explicitly on both sides of the `BUTTON[...]` syntax, like `BUTTON[timer-30]`. Do NOT wrap the rest of the task description, the time, or the links in backticks.
           Every timed task MUST have a timer button. If a task from the input does not have a duration button (e.g., `BUTTON[timer-D]`) in its name, assign it a default duration of 20 minutes, calculate the end time accordingly, and add the corresponding button (e.g., `BUTTON[timer-20]`) to the line. Use standard durations: 5, 10, 15, 20, 25, 30, 45, 60, 90, 120.
        8. Clean up task names by removing any existing `BUTTON[...]` or `BUTTON[...]` button strings before formatting.
        9. Preserve any `[src](URL)` links in the tasks exactly as they are. Do not modify, remove, or rewrite these URL links. If you merge a task with a calendar event, place the `[src](URL)` link immediately before `[Calendar]`.
        10. Preserve all tags (e.g. #work) in the task content exactly as they are. Do not modify, remove, or strip any tags.
        11. Return ONLY the formatted subheadings and checklist lines. Do not include any main headers or markdown code block fences.
        
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
        2. Do NOT delete or omit any tasks from the "Existing Tasks", "Active Todoist Tasks", or "Active Google Tasks" list. All habits, work tasks, house chores (e.g. treadmill maintenance), and admin tasks must be scheduled.
        3. Do NOT invent, hallucinate, or add any new tasks (such as "Lunch", "Breakfast", "Break", "Dinner", "Sleep") that are not explicitly present in the input lists.
        4. Group the schedule items under the following four subheadings based on their nature (with an empty line before each subheading):
           
           ### 📅 Calendar Events
           (Include Google Calendar events here. Format them as checklist items: `- [ ] HH:MM - HH:MM Event Name [Calendar]`)
           
           ### 💻 Work Tasks
           (Include all work-related tasks, such as those with #work tag, Todoist work projects, or digital tasks for work)
           
           ### 🏠 House Chores & Personal
           (Include all home/life chores like treadmill maintenance, mowing the lawn, shopping, sanctuary visits, neck rest, exercises, etc.)
           
           ### ⚙️ Admin & Digital Chores
           (Include all inbox reviews, sync fixes, cancellation tasks, dentist calls, checklist cleanups, digital maintenance, etc.)
           
        5. Respect scheduled times:
           a. If a Todoist task has an explicit due time (e.g. " (Due: 09:00 AM)"), you MUST schedule it at that time. You can strip the " (Due: HH:MM AM/PM)" substring from the final scheduled task name.
           b. If an "Existing Task" from the daily note already has a scheduled time range (e.g., "06:30 - 06:45"), you MUST preserve that exact time range.
           c. For all other tasks (without an explicit due time or existing time range), distribute them chronologically starting from {current_time} (or from 06:00 AM if {current_time} is earlier in the day).
        6. EVERY single schedule item (whether a calendar event, work task, house chore, or admin task) MUST be formatted as a checklist item starting exactly with "- [ ] ". Do NOT use "*" or any other bullet character.
        7. For all timed tasks (excluding calendar events), format them exactly like this example (with backticks ONLY around the BUTTON part):
           - [ ] HH:MM - HH:MM Task Name `BUTTON[timer-D]` [src](URL)
           Ensure that backticks (`) are explicitly on both sides of the `BUTTON[...]` syntax, like `BUTTON[timer-30]`. Do NOT wrap the rest of the task description, the time, or the links in backticks.
           Every timed task MUST have a timer button. If a task from the input does not have a duration button (e.g., `BUTTON[timer-D]`) in its name, assign it a default duration of 20 minutes, calculate the end time accordingly, and add the corresponding button (e.g., `BUTTON[timer-20]`) to the line. Use standard durations: 5, 10, 15, 20, 25, 30, 45, 60, 90, 120.
        8. Clean up task names by removing any existing `BUTTON[...]` or `BUTTON[...]` button strings before formatting.
        9. Preserve any `[src](URL)` links in the tasks exactly as they are. Do not modify, remove, or rewrite these URL links. If you merge a task with a calendar event, place the `[src](URL)` link immediately before `[Calendar]`.
        10. Preserve all tags (e.g. #work) in the task content exactly as they are. Do not modify, remove, or strip any tags.
        11. Return ONLY the formatted subheadings and checklist lines. Do not include any main headers or markdown code block fences.
        
        Custom User Preferences to Respect:
        {user_preferences if user_preferences else "(No custom preferences specified)"}
        """
    
    model_names = ['gemini-2.5-flash', 'gemini-flash-latest']
    response = None
    last_err = None
    for model_name in model_names:
        print(f"Trying Gemini model: {model_name}...")
        for attempt in range(4):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt
                )
                break
            except Exception as e:
                err_msg = str(e)
                last_err = e
                if "503" in err_msg or "unavailable" in err_msg.lower() or "demand" in err_msg.lower() or "limit" in err_msg.lower():
                    backoff = 2 ** attempt
                    print(f"Gemini model {model_name} call failed (transient error / demand limit). Retrying in {backoff} seconds...")
                    time.sleep(backoff)
                else:
                    break
        if response:
            break
            
    if not response:
        raise last_err
    
    schedule_lines = response.text.strip().split('\n')
    filtered_lines = []
    prohibited_terms = {'lunch', 'breakfast', 'dinner', 'break', 'sleep', 'leisure time', 'morning routine', 'evening routine', 'rest'}
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
    new_schedule_lines = headers + [item for item in new_schedule_items.strip().split('\n') if item.strip()]
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
        self.root.title("Daily Task Scheduler & Timeblocker")
        self.root.geometry("700x820")
        self.root.configure(bg="#1e1e1e")
        
        # Center the window
        self.root.eval('tk::PlaceWindow . center')
        
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
    today_str = datetime.now(tz).strftime("%Y-%m-%d")
    note_path = f"C:\\Users\\aljar\\Documents\\Obsidian\\02_Journal\\01_Daily\\{today_str}.md"
    
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
    prohibited_terms = {'lunch', 'breakfast', 'dinner', 'break', 'sleep', 'leisure time', 'morning routine', 'evening routine', 'rest'}
    for dt in daily_tasks:
        dt_lower = dt.lower()
        has_prohibited = any(term in dt_lower for term in prohibited_terms)
        if has_prohibited:
            in_todoist = any(any(term in t.get('content', '').lower() for term in prohibited_terms if term in dt_lower) for t in tasks)
            in_calendar = any(any(term in ev.get('summary', '').lower() for term in prohibited_terms if term in dt_lower) for ev in events)
            in_google = any(any(term in gt.get('title', '').lower() or term in gt.get('notes', '').lower() for term in prohibited_terms if term in dt_lower) for gt in google_tasks)
            if not in_todoist and not in_calendar and not in_google:
                print(f"Filtering out likely hallucinated task from daily note: {dt}")
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
            # Fallback to CLI in case GUI cannot start (e.g. no DISPLAY)
            print(f"Failed to launch GUI: {e}")
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
