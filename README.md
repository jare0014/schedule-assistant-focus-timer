# Schedule Assistant & Focus Timer Plugin

An interactive dashboard that aggregates schedules and tasks from Google Calendar, Google Tasks, and Todoist, providing focused study block timers, health alarms, and cross-platform access.

---

## 🚀 Key Features

* **Multi-Service Aggregation:** Merges tasks and schedules, utilizing Gemini AI to structure study blocks.
* **Promise-Race Flow Control:** Prevents Electron renderer thread lockups by racing API calls against strict 2500ms connection timeout wrappers.
* **Interactive Child-Process Progress Modal:** Spawns background Python schedulers, piping stdout/stderr into an Obsidian modal and exposing an OS-level kill signal wrapper to abort hung processes.

---

## 📱 Cross-Platform Companions

The system includes native Android and Wear OS companion apps located in the `/AndroidWidget` directory, offering seamless wrist and home screen access.

### 1. Android Companion App
* **Offline-First Room Cache:** Synchronizes daily note tasks and focus timers locally so your schedule remains accessible offline.
* **Bidirectional REST Sync:** Updates completion status and starts/stops timers locally while instantly reconciling changes back to the Obsidian PC server.
* **Interactive Drag-and-Drop:** Built in Jetpack Compose, featuring coordinate-based drag gesture detection to graduate/demote tasks between categories.
* **Dynamic Home Screen Widget:** Centered Focus Timer card with real-time ticking countdowns and direct pause/resume/cancel button shortcuts.

### 2. Wear OS Watch Companion
* **Lightweight Compose UI:** Displays the active task name and timer countdown with optimized touch targets for Play, Pause, and Cancel controls.
* **Wearable Data Layer API:** Integrates Play Services `PutDataMapRequest` to push timer ticks and state changes from the phone to the watch instantly.

### 3. Watch Face Tile
* At-a-Glance Progress: A native Wear OS watch face Tile built with `androidx.wear.protolayout` displaying your active task and remaining Pomodoro duration.
* Frictionless Activity Launcher: Supports a native launch action to jump directly from the watch face Tile into the watch app.

---

## ⚙️ Customizing the Scheduler (Persistent Instructions)

You can customize the daily scheduling rules and LLM behavior by editing **`preferences.txt`** in the plugin directory. 

Supported constraints and preferences include:
* **Bedtime Constraint:** Limit tasks from being scheduled past a certain hour (e.g., `22:00` bedtime) and demote overflow tasks to untimed/floating lists.
* **Focus Blocks Generation:** Define how to generate timed focus blocks based on project/source names (e.g. Habits, Admin, Work, Curriculum, House) and how to group checklist subtasks.
* **Floating Micro-Tasks:** Configure grouping, sorting, and header formatting rules for untimed administrative, chore, or minor tasks.
