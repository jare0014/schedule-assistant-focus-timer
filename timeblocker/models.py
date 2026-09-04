"""
models.py - Data structures and schemas for Schedule Assistant timeblocker.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class CalendarEvent:
    id: str
    summary: str
    start_time: str
    end_time: str
    is_all_day: bool = False
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TodoistTask:
    id: str
    content: str
    description: str = ""
    project_id: Optional[str] = None
    project_name: str = "Inbox"
    section_id: Optional[str] = None
    section_name: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    src_url: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GoogleTask:
    id: str
    title: str
    notes: str = ""
    list_id: str = ""
    list_title: str = ""
    due_date: Optional[str] = None
    src_url: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DailyTaskItem:
    raw_line: str
    is_completed: bool
    description: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    is_timed: bool = False
