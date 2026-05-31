# Timeblocker and Task Timer Obsidian Plugin

A powerful, integrated timeblocking, active task tracking, and biometric sync plugin. It retrieves your Google Calendar events, Google Tasks, Todoist tasks, and Fitbit health data, parses your local Daily Note checklist, and uses generative AI (Gemini or Ollama) to build an optimized daily schedule.

All credentials and API tokens are securely stored in your operating system's keychain wrapper (`SecretStorage`), ensuring there are no plain text secrets left in your vault.

---

## 🛠️ Features

1. **Daily Schedule Generator**:
   * Pulls calendar events and tasks from multiple sources.
   * Leverages Gemini or Ollama to structure them into chronological blocks.
   * Categorizes them into: `Calendar Events`, `Work Tasks`, `House Chores & Personal`, and `Admin & Digital Chores`.
2. **Interactive Schedule Adjustments (Tkinter UI)**:
   * When scheduling, opens a desktop-native dark-themed Tkinter app to review the proposed day.
   * Lets you type natural language feedback (e.g. "push my neck rest to 3 PM", "make mowing the lawn 45 mins") and re-generate using AI.
   * Manually edit the textbox before writing directly to your Daily Note.
3. **Obsidian Task Timer (Right Sidebar)**:
   * View current task countdowns.
   * Synthesizes audio alarms when task timers expire.
   * Automatically logs duration, pauses, and completions directly to your daily log section (`## 🪵 Log`).
4. **Task Server Sync**:
   * Toggle checkboxes directly in Obsidian to complete tasks on Google Tasks and Todoist.
5. **Biometric Fitbit Sync**:
   * Syncs sleep score, readiness, wake-up times, heart rate variability, and counts directly to daily note frontmatter.
   * Fully runs from the plugin using environment variable overrides (completely plaintext file-free!).

---

## 🔒 Configuration & Secure API Setup

Go to **Settings** > **Timeblocker and Task Timer**:

### 1. AI Provider Setup
Choose between:
* **Gemini (Recommended)**: Set provider to `Gemini`. Key is stored securely in your keychain as `timeblocker-gemini-api-key`. Select `Gemini 2.5 Pro` or `Gemini 2.5 Flash`.
* **Ollama (Local)**: Set provider to `Ollama`. Enter your local URL (default: `http://localhost:11434`) and model name (default: `qwen2.5:7b`).

### 2. Todoist Setup
1. Retrieve your Developer API Token from **Todoist Settings** > **Integrations** (at the bottom).
2. Enter the token in the secure password-masked **Todoist API Token** field. It is written directly to your system keychain.

### 3. Google Calendar & Google Tasks Setup
This plugin uses Google's OAuth2 flow to access your calendar and tasks.
1. Create a project on the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API** and **Google Tasks API**.
3. Configure the OAuth Consent Screen (External/Testing mode) and add your email as a test user.
4. Go to **Credentials** > **Create Credentials** > **OAuth Client ID** (Application type: **Desktop App**).
5. Download the credentials JSON and paste the JSON content into the secure **Google Credentials JSON** setting in Obsidian.
6. The first time you run the scheduler, a browser window will open asking you to authenticate. The session is cached securely in your system keychain.
7. *Note*: Old `credentials.json` and `token.json` files on disk are automatically migrated to your keychain on startup and backed up as `.bak` files.

### 4. Fitbit Setup
This plugin runs your local `fitbit_pull.py` script securely by injecting credentials via environment variables.
1. Retrieve your Client ID and Client Secret from your [Fitbit Developer Portal](https://dev.fitbit.com/).
2. Enter them into the secure password-masked **Fitbit Client ID** and **Fitbit Client Secret** settings.
3. *Note*: If you have an existing `fitbit_credentials.json` file in `99_System/Scripts/`, the plugin automatically migrates it to the system keychain on startup and renames it to `.bak`.

---

## 🚀 Usage Flow

### A. Generating Your Schedule
1. In Obsidian, open the Command Palette (`Ctrl + P` / `Cmd + P`).
2. Run: `Timeblocker and Task Timer: Generate Daily Schedule (Timeblocker)`.
3. Review, modify, or adjust the schedule in the popup window.
4. Click **Write to Daily Note** to insert the structured checkboxes under `## 📅Day Planner`.

### B. Operating Task Timers
1. Hover or place your cursor on a timed checkbox item in your daily note (e.g. `- [ ] 10:00 - 10:20 Neck Rest `BUTTON[timer-20]``).
2. Open the Command Palette and run: `Timeblocker and Task Timer: Start [X] Minute Timer` (or use the open sidebar clock ribbon icon).
3. The sidebar timer will track your progress and log pauses, resumes, and completions directly to today's log under `## 🪵 Log`.

### C. Syncing Fitbit Data
1. Open your Daily Note.
2. Click the **🧠 Check In** button (or run command `Timeblocker and Task Timer: Sync Fitbit Data` in the Command Palette).
3. The check-in window will load your Fitbit details and sync them directly to your frontmatter.
