"""
preferences.py - Persistence and retrieval for user scheduling preferences.
"""

import os
from .auth import get_base_dir


def get_preferences_path() -> str:
    """Returns absolute path to preferences.txt."""
    return os.path.join(get_base_dir(), 'preferences.txt')


def load_preferences() -> str:
    """Reads saved scheduling preferences."""
    path = get_preferences_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except Exception as e:
            print(f"Error loading preferences: {e}")
    return ""


def save_preferences(text: str) -> None:
    """Writes scheduling preferences to file."""
    path = get_preferences_path()
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.strip())
    except Exception as e:
        print(f"Error saving preferences: {e}")
