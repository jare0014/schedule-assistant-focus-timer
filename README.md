# Schedule Assistant & Focus Timer Plugin

An interactive dashboard that aggregates schedules and tasks from Google Calendar, Google Tasks, and Todoist, providing focused study block timers and health alarms.

## 🚀 Key Features

* **Multi-Service Aggregation:** Merges tasks and schedules, utilizing Gemini AI to structure study blocks.
* **Promise-Race Flow Control:** Prevents Electron renderer thread lockups by racing API calls against strict 2500ms connection timeout wrappers.
* **Interactive Child-Process Progress Modal:** Spawns background Python schedulers, piping stdout/stderr into an Obsidian modal and exposing an OS-level kill signal wrapper to abort hung processes.
