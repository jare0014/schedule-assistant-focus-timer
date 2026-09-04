"""
auth.py - Authentication and credentials management for Google APIs and Todoist.
"""

import os
import sys
import json
from datetime import datetime, timezone, timedelta

# Fix Windows Python DLL directory search if running on Windows
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

# Google Auth imports
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks'
]


def get_base_dir() -> str:
    """Returns the root directory of the plugin."""
    # When in timeblocker/ package, the base directory is parent directory
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_timezone_offset() -> timezone:
    """Calculates local timezone offset."""
    local_now = datetime.now()
    utc_now = datetime.utcnow()
    offset = local_now - utc_now
    offset_hours = int(round(offset.total_seconds() / 3600.0))
    return timezone(timedelta(hours=offset_hours))


def get_google_creds() -> Credentials:
    """Loads or retrieves Google OAuth credentials."""
    creds = None
    base_dir = get_base_dir()
    token_path = os.path.join(base_dir, 'token.json')
    creds_path = os.path.join(base_dir, 'credentials.json')

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
                    raise FileNotFoundError(
                        f"Google Client credentials not provided via GOOGLE_CREDENTIALS_JSON environment variable or credentials.json file at {creds_path}."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
                creds = flow.run_local_server(port=0)

        with open(token_path, 'w', encoding='utf-8') as token:
            token.write(creds.to_json())

    return creds


def get_todoist_token() -> str:
    """Retrieves Todoist token from environment or data.json fallback."""
    token = os.environ.get("TODOIST_API_TOKEN")
    if token:
        return token
    data_path = os.path.join(get_base_dir(), 'data.json')
    if os.path.exists(data_path):
        try:
            with open(data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get("todoistToken"):
                return data["todoistToken"]
        except Exception:
            pass
    return ""
