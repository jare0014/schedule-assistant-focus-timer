"""
scheduler.py - Core schedule generation engine supporting Gemini API & Ollama fallback.
"""

import os
import re
import json
import time
import urllib.request
from datetime import datetime
from typing import List, Dict, Any, Optional

from google import genai
from google.genai import types

from .auth import get_base_dir
from .integrations import get_todoist_projects, get_todoist_sections
from .preferences import load_preferences


def generate_schedule(
    calendar_events: List[Dict[str, Any]],
    todoist_tasks: List[Dict[str, Any]],
    google_tasks: List[Dict[str, Any]],
    daily_tasks: List[str],
    tz,
    feedback: Optional[str] = None,
    previous_schedule: Optional[str] = None,
    user_preferences: Optional[str] = None
) -> str:
    """Generates an optimized, categorized daily schedule using Gemini SDK or Ollama fallback."""
    if user_preferences is None:
        user_preferences = load_preferences()

    # Preprocessing: Strip past times from pending tasks so LLM reschedules them
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

    rules_text = f"""
        Rules:
        1. Respect Google Calendar events. They have fixed times and must be scheduled at those exact times:
           `- [ ] HH:MM - HH:MM Event Name [Calendar]`
           If a Google Calendar event corresponds to an active Todoist or Google Task (e.g. they share the same or similar name/topic), you MUST merge them and append the task's `[src](URL)` link before `[Calendar]`, like:
           `- [ ] HH:MM - HH:MM Event Name [src](URL) [Calendar]`
           Note: Google Tasks (whose links start with `https://tasks.google.com/`) are NOT calendar events. Unless a Google Task is explicitly merged with a Google Calendar event of the same name/topic, do NOT place it under the '### 📅 Calendar Events' subheading and do NOT append '[Calendar]' to it.
        2. Do NOT delete or omit any tasks from the original input list. All tasks, habits, and chores must be included in the schedule (either timed or untimed).
        3. Do NOT invent, hallucinate, or add any new tasks (such as "Lunch", "Breakfast", "Break", "Dinner", "Sleep") that are not explicitly present in the input lists.
        4. Group the schedule items under the following subheadings based on their nature (with an empty line before each subheading):
           
           ### 📅 Calendar Events
           (Include Google Calendar events here. Format them as checklist items: `- [ ] HH:MM - HH:MM Event Name [Calendar]`)
           
           ### ⏱️ Focus Blocks
           (Include complex, high-effort tasks, deep work, learning, projects, and structured Routine/Habit blocks—such as Morning Routine, Midday Routine, and Evening Routine from Todoist or Daily Note—taking 20 minutes or longer.
           IMPORTANT: Both Work sections, all House project items, and all Routine sections (Morning, Midday, Evening) MUST be scheduled as timed Focus Blocks! Create a SEPARATE, dedicated Focus Block for EACH section/project. Do NOT merge or pile separate project sections into a single task!)
           
           ### ☁️ Floating Micro-Tasks (Untimed)
           (Include all fast administrative items, quick emails, and simple 5-10 minute micro-chores taking under 20 minutes. Do NOT include Routine or Habit blocks here—routines must be scheduled as Focus Blocks above.
           You MUST group and sort the tasks in this section by project/source. For each project/source group, list all checklist items under an H5 header showing the project name, formatted exactly as follows:
           
           ##### ProjectName
           
           - [ ] Task Name [src](URL)
           - [ ] Another Task [src](URL)

           Strip any trailing "(Project: ...)" context labels from the task names. Do NOT put bracketed project prefixes in the task names themselves.)
           
        5. Respect scheduled times and completion status:
           a. **Completed Tasks**: Any task from "Existing Tasks from my Daily Note" that starts with `- [x]` or `- [X]` is a completed task. You MUST preserve it in the schedule at its exact time range, unchanged, and keep its status (either `- [x]` or `- [X]`). Do NOT move, change, or remove completed tasks.
           b. **Pending Tasks Scheduling**: All pending/uncompleted tasks that require timing (marked with `- [ ]` from the daily note, or tasks requiring scheduled times) MUST be scheduled to start chronologically after the current time of {current_time}. Under no circumstances should any pending task be scheduled at a time before {current_time}. If {current_time} is earlier than 06:00 AM, you may start scheduling from 06:00 AM. Otherwise, you MUST start scheduling after {current_time}.
           c. **Overdue / Moved Tasks**: If an existing pending task in the daily note had a scheduled time range in the past (before {current_time}), you MUST reschedule it to start after {current_time}.
           d. If a task has an explicit due time (e.g. " (Due: 09:00 AM)"), you MUST schedule it at that time if it is in the future. If it is in the past, reschedule it to start after {current_time}. You can strip the " (Due: HH:MM AM/PM)" substring from the final scheduled task name.
           e. **Postponed Tasks**: If an input task from the daily note contains the tag `#postpone` (e.g. added by the mobile widget), you MUST reschedule it to start after the current time {current_time} (or treat it as a pending task that needs to be scheduled for later in the day), and you MUST strip the `#postpone` tag from the final scheduled task name in your output.
        6. Formatting checklist status:
           a. Completed tasks MUST be formatted starting exactly with "- [x] ".
           b. Pending tasks MUST be formatted starting exactly with "- [ ] ".
           c. Do NOT use "*" or any other bullet character.
           d. For Calendar Events and Focus Blocks, format scheduled times using 24-hour format (e.g., 08:00 - 08:30). 
           e. For Floating Micro-Tasks, do NOT include a time range. Group them under their respective H5 project headers.
        7. Clean up task names by removing any existing `BUTTON[...]` button strings before formatting.
        8. Preserve any `[src](URL)` links in the tasks exactly as they are. Do not modify, remove, or rewrite these URL links. If you merge a task with a calendar event, place the `[src](URL)` link immediately before `[Calendar]`.
        9. Preserve all tags (e.g. #work) in the task content exactly as they are. Do not modify, remove, or strip any tags.
        10. Return ONLY the formatted subheadings and checklist lines. Do not include any main headers or markdown code block fences.
        
        Custom User Preferences to Respect:
        {user_preferences if user_preferences else "(No custom preferences specified)"}
    """

    if feedback and previous_schedule:
        prompt = f"""You are an expert daily scheduler.
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

{rules_text}
"""
    else:
        prompt = f"""You are an expert daily scheduler. Create an optimized, categorized daily schedule by merging these four inputs:

1. Existing Tasks from my Daily Note (includes habits, chores, etc.):
{daily_tasks_str if daily_tasks_str else "(No tasks in daily note)"}

2. Today's Google Calendar Events:
{events_str if events_str else "(No calendar events scheduled today)"}

3. Active Todoist Tasks:
{tasks_str if tasks_str else "(No Todoist tasks due today)"}

4. Active Google Tasks:
{google_tasks_str if google_tasks_str else "(No Google Tasks due today)"}

{rules_text}
"""

    base_dir = get_base_dir()
    llm_provider = 'gemini'
    llm_model = 'gemini-3.5-flash'
    ollama_url = 'http://localhost:11434'
    gemini_api_key = os.environ.get("GEMINI_API_KEY")

    data_path = os.path.join(base_dir, 'data.json')
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
            config_path = os.path.join(base_dir, 'config.json')
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
                        is_quota_error = (
                            "resource_exhausted" in err_msg.lower() or
                            "spending cap" in err_msg.lower() or
                            "quota" in err_msg.lower() or
                            "perday" in err_msg.lower() or
                            "per-day" in err_msg.lower() or
                            "per_day" in err_msg.lower() or
                            "per day" in err_msg.lower() or
                            "daily" in err_msg.lower() or
                            "limit: 0" in err_msg.lower()
                        )
                        is_transient = (
                            ("503" in err_msg or
                             "unavailable" in err_msg.lower() or
                             "demand" in err_msg.lower() or
                             "429" in err_msg or
                             "rate limit" in err_msg.lower() or
                             "retry in" in err_msg.lower()) and not is_quota_error
                        )
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
        payload = {"model": llm_model, "prompt": prompt, "stream": False}
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
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
