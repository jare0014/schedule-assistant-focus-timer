const obsidian = require('obsidian');

const VIEW_TYPE_TASK_TIMER = 'task-timer-view';

class TaskTimerView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentTimer = null;
        this.timerInterval = null;
        this.isAlarming = false;
        
        // Audio synthesis state
        this.audioCtx = null;
        this.alarmInterval = null;
        this.titleInterval = null;
        this.originalTitle = "";
        this.hasObserver = false;
    }

    getViewType() {
        return VIEW_TYPE_TASK_TIMER;
    }

    getDisplayText() {
        return "Timeblocker and Task Timer";
    }

    getIcon() {
        return "alarm-clock";
    }

    async onOpen() {
        this.originalTitle = document.title;
        this.renderSchedule();
    }

    async onClose() {
        if (this.currentTimer) {
            await this.plugin.logUpdate(false);
            this.currentTimer = null;
        }
        this.clearTimer();
        this.stopAlarm();
    }

    getDailyNoteFile() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const path = `02_Journal/01_Daily/${year}-${month}-${day}.md`;
        return this.app.vault.getAbstractFileByPath(path);
    }

    parseAllTasks(content) {
        const lines = content.split('\n');
        const tasks = [];
        const taskRegex = /^\s*-\s+\[( |x)\]\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s+(.*)$/;
        let currentSubheading = "";
        let inPlanner = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes("## 📅Day Planner")) {
                inPlanner = true;
                continue;
            }
            if (inPlanner && line.startsWith('## ') && !line.includes("## 📅Day Planner")) {
                break;
            }
            if (inPlanner) {
                if (line.startsWith('### ')) {
                    currentSubheading = line.trim();
                    continue;
                }
                const match = line.match(taskRegex);
                if (match) {
                    const status = match[1] === 'x' ? 'completed' : 'pending';
                    const startH = parseInt(match[2]);
                    const startM = parseInt(match[3]);
                    const endH = parseInt(match[4]);
                    const endM = parseInt(match[5]);
                    const rawDesc = match[6];
                    
                    // Clean description
                    let description = rawDesc.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                    description = description.replace(/#\w+/g, '').trim();
                    description = description.replace(/\s+/g, ' ').trim();
                    
                    const isCalendar = rawDesc.includes('[Calendar]');
                    const startMinutes = startH * 60 + startM;
                    const endMinutes = endH * 60 + endM;
                    const duration = endMinutes - startMinutes;
                    
                    tasks.push({
                        lineIndex: i,
                        originalLine: line,
                        status: status,
                        startHour: startH,
                        startMin: startM,
                        endHour: endH,
                        endMin: endM,
                        startMinutes: startMinutes,
                        endMinutes: endMinutes,
                        duration: duration,
                        description: description,
                        isCalendar: isCalendar,
                        subheading: currentSubheading,
                        rawDesc: rawDesc
                    });
                }
            }
        }
        return tasks;
    }

    async renderSchedule() {
        const container = this.contentEl;
        container.empty();

        const viewContainer = container.createDiv({ cls: 'task-timer-view-container' });
        
        // Register modify observer if not already done
        if (!this.hasObserver) {
            this.hasObserver = true;
            this.registerEvent(this.app.vault.on('modify', (file) => {
                const dailyFile = this.getDailyNoteFile();
                if (dailyFile && file.path === dailyFile.path) {
                    this.renderSchedule();
                }
            }));
        }

        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) {
            this.renderIdleView(viewContainer);
            return;
        }

        let content = "";
        try {
            content = await this.app.vault.read(dailyFile);
        } catch (e) {
            this.renderIdleView(viewContainer);
            return;
        }

        const tasks = this.parseAllTasks(content);
        const remainingTasks = tasks.filter(t => t.status === 'pending');

        if (remainingTasks.length === 0) {
            const idleContainer = viewContainer.createDiv({ cls: 'timer-idle-container' });
            const iconDiv = idleContainer.createDiv({ cls: 'timer-idle-icon' });
            iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
            idleContainer.createDiv({ cls: 'timer-idle-title', text: "All Done!" });
            idleContainer.createDiv({ cls: 'timer-idle-desc', text: "No remaining tasks scheduled for today." });
            return;
        }

        const header = viewContainer.createDiv({ cls: 'task-timer-header' });
        header.createEl('h3', { text: "Today's Schedule" });

        const list = viewContainer.createDiv({ cls: 'schedule-list' });

        remainingTasks.forEach(task => {
            const card = list.createDiv({ cls: 'task-card' });
            const left = card.createDiv({ cls: 'task-card-left' });
            
            const startStr = `${String(task.startHour).padStart(2, '0')}:${String(task.startMin).padStart(2, '0')}`;
            const endStr = `${String(task.endHour).padStart(2, '0')}:${String(task.endMin).padStart(2, '0')}`;
            
            left.createDiv({ cls: 'task-card-time', text: `${startStr} - ${endStr}` });
            left.createDiv({ cls: 'task-card-name', text: task.description });

            if (!task.isCalendar) {
                const controls = card.createDiv({ cls: 'task-card-controls' });

                // Play Button
                const playBtn = controls.createEl('button', { cls: 'task-card-play-btn', title: 'Start Focus' });
                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                playBtn.onclick = () => {
                    this.startTimer(task.description, task.duration);
                };

                // Postpone Button
                const postponeBtn = controls.createEl('button', { cls: 'task-card-postpone-btn', title: 'Postpone Task' });
                postponeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                postponeBtn.onclick = () => {
                    this.postponeTask(task);
                };
            }
        });
    }

    renderIdleView(viewContainer) {
        const idleContainer = viewContainer.createDiv({ cls: 'timer-idle-container' });
        const iconDiv = idleContainer.createDiv({ cls: 'timer-idle-icon' });
        iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        idleContainer.createDiv({ cls: 'timer-idle-title', text: "Ready to Focus" });
        idleContainer.createDiv({ cls: 'timer-idle-desc', text: "Create or open today's daily note to load your schedule." });
    }

    async postponeTask(task) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) {
            new obsidian.Notice("Daily note not found!");
            return;
        }

        let content = "";
        try {
            content = await this.app.vault.read(dailyFile);
        } catch (e) {
            new obsidian.Notice("Could not read daily note!");
            return;
        }

        const lines = content.split('\n');
        const allTasks = this.parseAllTasks(content);
        
        // Find current time in minutes
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // 1. Gather all busy intervals that end after currentMinutes.
        const busyIntervals = allTasks
            .filter(t => t.endMinutes > currentMinutes && t.lineIndex !== task.lineIndex)
            .map(t => ({
                start: t.startMinutes,
                end: t.endMinutes
            }));
            
        // Sort busy intervals by start time
        busyIntervals.sort((a, b) => a.start - b.start);

        // Find the first slot
        let newStart = currentMinutes;
        const duration = task.duration;

        for (const interval of busyIntervals) {
            if (interval.start - newStart >= duration) {
                break;
            }
            newStart = Math.max(newStart, interval.end);
        }

        const newEnd = newStart + duration;
        if (newEnd > 1440) {
            new obsidian.Notice("Cannot postpone: task would go past midnight!");
            return;
        }

        // Format times
        const startH = String(Math.floor(newStart / 60)).padStart(2, '0');
        const startM = String(newStart % 60).padStart(2, '0');
        const endH = String(Math.floor(newEnd / 60)).padStart(2, '0');
        const endM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${startH}:${startM} - ${endH}:${endM}`;

        // Update the line in lines array
        const originalLine = lines[task.lineIndex];
        const oldTimeRangeRegex = /\b\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[task.lineIndex] = newLine;

        // Re-sort within the same subheading
        let inSubheading = false;
        const subheadingIndices = [];
        const taskRegex = /^\s*-\s+\[( |x)\]\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s+(.*)$/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## ') || (line.startsWith('### ') && line.trim() !== task.subheading)) {
                if (inSubheading) break;
            }
            if (line.trim() === task.subheading) {
                inSubheading = true;
                continue;
            }
            if (inSubheading) {
                if (taskRegex.test(line)) {
                    subheadingIndices.push(i);
                }
            }
        }

        if (subheadingIndices.length > 1) {
            const subheadingTasks = subheadingIndices.map(idx => {
                const line = lines[idx];
                const match = line.match(taskRegex);
                const sh = parseInt(match[2]);
                const sm = parseInt(match[3]);
                return {
                    line: line,
                    startMinutes: sh * 60 + sm
                };
            });

            subheadingTasks.sort((a, b) => a.startMinutes - b.startMinutes);

            for (let i = 0; i < subheadingIndices.length; i++) {
                lines[subheadingIndices[i]] = subheadingTasks[i].line;
            }
        }

        try {
            await this.app.vault.modify(dailyFile, lines.join('\n'));
            new obsidian.Notice(`Postponed "${task.description}" to ${newTimeRange}`);
        } catch (e) {
            new obsidian.Notice("Failed to update daily note!");
        }
    }

    async startTimer(taskName, durationMinutes) {
        this.clearTimer();
        
        // Log the timer start in the daily note
        await this.plugin.logStart(taskName, durationMinutes);
        
        const totalSeconds = durationMinutes * 60;
        this.currentTimer = {
            taskName: taskName,
            remainingSeconds: totalSeconds,
            totalSeconds: totalSeconds,
            isPaused: false
        };

        this.renderTimer();
        
        this.timerInterval = setInterval(async () => {
            if (this.currentTimer && !this.currentTimer.isPaused) {
                this.currentTimer.remainingSeconds--;
                this.updateTimerDisplay();

                if (this.currentTimer.remainingSeconds <= 0) {
                    this.clearTimer();
                    this.currentTimer = null;
                    await this.plugin.logUpdate(true); // Log completed
                    this.triggerAlarm(taskName);
                }
            }
        }, 1000);
    }

    clearTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    async completeTimer() {
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";
        this.clearTimer();
        this.currentTimer = null;
        await this.plugin.logUpdate(true); // Log completed
        
        // Detach leaf to close the panel
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
        
        new obsidian.Notice(`Completed session for "${taskName}"!`, 3000);
    }

    async cancelTimer() {
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";
        this.clearTimer();
        this.currentTimer = null;
        await this.plugin.logUpdate(false); // Log incomplete
        
        // Detach leaf to close the panel
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
        
        new obsidian.Notice(`Cancelled session for "${taskName}".`, 3000);
    }

    renderTimer() {
        const container = this.contentEl;
        container.empty();

        const viewContainer = container.createDiv({ cls: 'task-timer-view-container' });
        const timerContainer = viewContainer.createDiv({ cls: 'timer-view-container' });

        timerContainer.createDiv({ cls: 'timer-task-title', text: this.currentTimer.taskName });

        const circle = timerContainer.createDiv({ cls: 'timer-circle-container pulsing' });
        this.timeTextEl = circle.createDiv({ cls: 'timer-countdown-text' });

        this.updateTimerDisplay();

        const controls = timerContainer.createDiv({ cls: 'timer-controls' });

        this.pauseBtn = controls.createEl('button', { cls: 'timer-btn', text: 'Pause' });
        this.pauseBtn.onclick = () => this.togglePause();

        const completeBtn = controls.createEl('button', { cls: 'timer-btn primary', text: 'Complete' });
        completeBtn.onclick = () => this.completeTimer();

        const cancelBtn = controls.createEl('button', { cls: 'timer-btn warning', text: 'Cancel' });
        cancelBtn.onclick = () => this.cancelTimer();
    }

    updateTimerDisplay() {
        if (!this.currentTimer || !this.timeTextEl) return;
        
        const mins = Math.floor(this.currentTimer.remainingSeconds / 60);
        const secs = this.currentTimer.remainingSeconds % 60;
        const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        this.timeTextEl.setText(timeStr);
        document.title = `(${timeStr}) ${this.currentTimer.taskName} - Obsidian`;
    }

    async togglePause() {
        if (!this.currentTimer) return;
        this.currentTimer.isPaused = !this.currentTimer.isPaused;
        
        if (this.currentTimer.isPaused) {
            this.pauseBtn.setText('Resume');
            const circle = this.contentEl.querySelector('.timer-circle-container');
            if (circle) circle.removeClass('pulsing');
            await this.plugin.logPause();
        } else {
            this.pauseBtn.setText('Pause');
            const circle = this.contentEl.querySelector('.timer-circle-container');
            if (circle) circle.addClass('pulsing');
            await this.plugin.logResume();
        }
    }

    triggerAlarm(taskName) {
        this.isAlarming = true;
        this.stopAlarm();
        
        this.playSiren();
        this.flashWindow();

        let showingAlert = false;
        this.titleInterval = setInterval(() => {
            document.title = showingAlert ? `🔴 ALARM: ${taskName} 🔴` : `✨ TIME UP: ${taskName} ✨`;
            showingAlert = !showingAlert;
        }, 500);

        const container = this.contentEl;
        container.empty();
        
        const overlay = container.createDiv({ cls: 'alarm-overlay' });
        overlay.createDiv({ cls: 'alarm-task-name', text: taskName });
        overlay.createDiv({ cls: 'alarm-alert-text', text: "Time has expired for this task!" });
        
        const dismissBtn = overlay.createEl('button', { 
            cls: 'alarm-dismiss-btn', 
            text: 'DISMISS ALARM' 
        });
        
        dismissBtn.onclick = () => {
            this.stopAlarm();
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
        };
    }

    playSiren() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            let isHigh = false;
            let secondsElapsed = 0;

            this.alarmInterval = setInterval(() => {
                if (secondsElapsed >= 30) {
                    this.stopAlarm();
                    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    return;
                }

                const osc = this.audioCtx.createOscillator();
                const gainNode = this.audioCtx.createGain();
                
                osc.connect(gainNode);
                gainNode.connect(this.audioCtx.destination);
                
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(isHigh ? 980 : 660, this.audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.08, this.audioCtx.currentTime);

                osc.start();
                osc.stop(this.audioCtx.currentTime + 0.35);

                isHigh = !isHigh;
                secondsElapsed += 0.5;
            }, 500);
        } catch (e) {
            console.error("Failed to play synthesized audio alarm:", e);
        }
    }

    flashWindow() {
        try {
            const electron = window.require('electron');
            const win = electron.remote ? electron.remote.getCurrentWindow() : electron.BrowserWindow.getFocusedWindow();
            if (win) {
                win.flashFrame(true);
                setTimeout(() => {
                    win.flashFrame(false);
                }, 30000);
            }
        } catch (e) {
            console.log("Electron flashFrame not available.");
        }
        window.focus();
    }

    stopAlarm() {
        this.isAlarming = false;
        
        if (this.alarmInterval) {
            clearInterval(this.alarmInterval);
            this.alarmInterval = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
        }

        if (this.titleInterval) {
            clearInterval(this.titleInterval);
            this.titleInterval = null;
        }
        document.title = this.originalTitle || "Obsidian";

        try {
            const electron = window.require('electron');
            const win = electron.remote ? electron.remote.getCurrentWindow() : electron.BrowserWindow.getFocusedWindow();
            if (win) {
                win.flashFrame(false);
            }
        } catch (e) {}
    }
}

class TaskTimerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Timeblocker and Task Timer Settings' });

        new obsidian.Setting(containerEl)
            .setName('Default Timer Duration')
            .setDesc('Duration (in minutes) assigned to timers if not specified.')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(this.plugin.settings.defaultDuration)
                .onChange(async (value) => {
                    this.plugin.settings.defaultDuration = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Auto-Apply Schedule')
            .setDesc('Skip the review GUI popup and immediately apply the generated schedule to the daily note.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoApply || false)
                .onChange(async (value) => {
                    this.plugin.settings.autoApply = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Todoist API Token')
            .setDesc('API token used to check off Todoist tasks.')
            .addText(text => text
                .setPlaceholder('Enter Todoist API Token')
                .setValue(this.plugin.settings.todoistToken || '')
                .onChange(async (value) => {
                    this.plugin.settings.todoistToken = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('API key used to query the Gemini models for schedule generation.')
            .addText(text => text
                .setPlaceholder('Enter your API Key...')
                .setValue(this.plugin.settings.geminiApiKey || '')
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value.trim();
                    await this.plugin.saveSettings();
                }));

        const fs = require('fs');
        const vaultPath = this.app.vault.adapter.getBasePath();
        const sep = vaultPath.includes('/') ? '/' : '\\';
        const prefsPath = `${vaultPath}${sep}.obsidian${sep}plugins${sep}timeblocker-and-task-timer${sep}preferences.txt`;

        let prefsContent = "";
        try {
            if (fs.existsSync(prefsPath)) {
                prefsContent = fs.readFileSync(prefsPath, 'utf8');
            }
        } catch (e) {
            console.error("Failed to read preferences.txt:", e);
        }

        new obsidian.Setting(containerEl)
            .setName('Persistent Instructions')
            .setDesc('Saved instructions and preferences used by Gemini when generating your schedule.')
            .addTextArea(text => {
                text.setValue(prefsContent)
                    .setPlaceholder('Enter your persistent scheduling instructions here...')
                    .onChange(async (value) => {
                        try {
                            fs.writeFileSync(prefsPath, value, 'utf8');
                        } catch (e) {
                            new obsidian.Notice("Failed to save instructions: " + e.message);
                        }
                    });
                text.inputEl.rows = 8;
                text.inputEl.style.width = '100%';
            });
    }
}

const DEFAULT_SETTINGS = {
    defaultDuration: '20',
    autoApply: false,
    todoistToken: '',
    geminiApiKey: ''
};

module.exports = class TaskTimerPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.activeLog = null;
        this.lastClickedEl = null;

        // Register global click tracker to see which element was clicked
        this.clickTracker = (evt) => {
            this.lastClickedEl = evt.target;
        };
        window.addEventListener('click', this.clickTracker, true);

        // Register custom view
        this.registerView(
            VIEW_TYPE_TASK_TIMER,
            (leaf) => new TaskTimerView(leaf, this)
        );

        // Add ribbon icon to open view
        this.addRibbonIcon('alarm-clock', 'Open Task Timer', () => {
            this.activateView();
        });

        // Add command to open view
        this.addCommand({
            id: 'open-task-timer',
            name: 'Open Task Timer View',
            callback: () => this.activateView(),
        });

        // Register duration-specific timer commands
        const durations = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
        durations.forEach(m => {
            this.addCommand({
                id: `start-${m}m`,
                name: `Start ${m} Minute Timer`,
                callback: () => {
                    this.startTimerForActiveOrCurrent(m);
                }
            });
        });

        // Add settings tab
        this.addSettingTab(new TaskTimerSettingTab(this.app, this));

        // Add unified task toggle command
        this.addCommand({
            id: 'toggle-task-server',
            name: 'Toggle task on server (Todoist / Google Tasks)',
            editorCallback: async (editor, view) => {
                const lineNo = editor.getCursor().line;
                const lineText = editor.getLine(lineNo);
                const hasLink = lineText.includes('todoist.com') || lineText.includes('tasks.google.com');
                
                if (hasLink) {
                    try {
                        const success = await this.toggleActiveTaskStatus(editor);
                        if (success) {
                            this.app.commands.executeCommandById("editor:toggle-checklist-status");
                        }
                    } catch (e) {
                        console.error("Task server toggle failed:", e);
                        new obsidian.Notice(`Failed to update task on server: ${e.message}`);
                    }
                } else {
                    this.app.commands.executeCommandById("editor:toggle-checklist-status");
                }
            }
        });
    }

    async onunload() {
        window.removeEventListener('click', this.clickTracker, true);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
        
        // Add leaf to right sidebar
        await this.app.workspace.getRightLeaf(false).setViewState({
            type: VIEW_TYPE_TASK_TIMER,
            active: true,
        });

        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    getClickedLineContent(activeView) {
        if (this.lastClickedEl) {
            let el = this.lastClickedEl;
            while (el && el !== document.body) {
                if (el.classList.contains('cm-line')) {
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('.meta-bind-button-wrapper, .meta-bind-button, button, [class*="meta-bind"]').forEach(btn => btn.remove());
                    return clone.textContent;
                }
                if (el.tagName === 'LI') {
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('.meta-bind-button-wrapper, .meta-bind-button, button, [class*="meta-bind"]').forEach(btn => btn.remove());
                    return clone.textContent;
                }
                if (el.classList.contains('markdown-preview-view') || el.classList.contains('markdown-rendered')) {
                    break;
                }
                el = el.parentElement;
            }
        }
        
        if (activeView) {
            const editor = activeView.editor;
            const lineNo = editor.getCursor().line;
            return editor.getLine(lineNo);
        }
        return "";
    }

    async startTimerForActiveOrCurrent(durationMinutes) {
        const activeView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        let taskName = "";
        
        const lineContent = this.getClickedLineContent(activeView);
        
        if (lineContent) {
            // Check for checklist item first
            const taskRegex = /^\s*[-*+]\s+\[.\]\s+(.*)$/;
            const taskMatch = lineContent.match(taskRegex);
            let taskText = "";
            if (taskMatch) {
                taskText = taskMatch[1].trim();
            } else {
                // Check for regular bullet point
                const bulletRegex = /^\s*[-*+]\s+(.*)$/;
                const bulletMatch = lineContent.match(bulletRegex);
                if (bulletMatch) {
                    taskText = bulletMatch[1].trim();
                } else {
                    taskText = lineContent.trim();
                }
            }

            if (taskText) {
                taskText = taskText.replace(/\s*--\s*p\d+\s*--\s*\[src\].*$/, '');
                taskText = taskText.replace(/\s*--\s*p\d+$/, '');
                
                // Strip inline Meta Bind button syntaxes
                taskText = taskText.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                
                // Strip tags from the task name
                taskText = taskText.replace(/#\w+/g, '').trim();
                
                // Clean up any double spaces left from tag removal
                taskText = taskText.replace(/\s+/g, ' ').trim();
                
                const timeRegex = /^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?\s*(.*)$/;
                const timeMatch = taskText.match(timeRegex);
                taskName = timeMatch ? timeMatch[5].trim() : taskText.trim();
            }
        }
        
        // Ensure default name is clean
        taskName = taskName || `Focus Block (${durationMinutes}m)`;
        
        await this.activateView();
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (leaves.length > 0) {
            const view = leaves[0].view;
            await view.startTimer(taskName, durationMinutes);
        }
    }

    async logStart(taskName, durationMinutes) {
        if (this.activeLog) {
            await this.logUpdate(false);
        }
        
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        
        const now = new Date();
        const sh = String(now.getHours()).padStart(2, '0');
        const sm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const startTimeStr = `${sh}:${sm}:${ss}`;
        
        const logLine = `- [focus:: ${taskName}] [start-time:: ${startTimeStr}] [pause-start:: ] [pause-end:: ] [completed-time:: ]`;
        
        try {
            const content = await this.app.vault.read(activeFile);
            const lines = content.split('\n');
            
            let logHeaderIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('## 🪵 Log')) {
                    logHeaderIndex = i;
                    break;
                }
            }
            
            if (logHeaderIndex !== -1) {
                let insertIndex = logHeaderIndex + 1;
                while (insertIndex < lines.length) {
                    if (lines[insertIndex].startsWith('##') || lines[insertIndex].startsWith('# ')) {
                        break;
                    }
                    insertIndex++;
                }
                lines.splice(insertIndex, 0, logLine);
            } else {
                lines.push('', '## 🪵 Log', logLine);
            }
            
            await this.app.vault.modify(activeFile, lines.join('\n'));
            
            this.activeLog = {
                startTimeStr: startTimeStr,
                taskName: taskName,
                logLine: logLine,
                pauses: [],
                resumes: []
            };
        } catch (e) {
            console.error("Error logging start:", e);
        }
    }

    async logPause() {
        if (!this.activeLog) return;
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const pauseTimeStr = `${h}:${m}:${s}`;

        this.activeLog.pauses.push(pauseTimeStr);
        const pauseStartVal = this.activeLog.pauses.join(', ');

        try {
            const content = await this.app.vault.read(activeFile);
            const lines = content.split('\n');
            let replaced = false;
            
            const oldLine = this.activeLog.logLine;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === oldLine.trim()) {
                    lines[i] = lines[i].replace(/\[pause-start:: [^\]]*\]/, `[pause-start:: ${pauseStartVal}]`);
                    this.activeLog.logLine = lines[i];
                    replaced = true;
                    break;
                }
            }

            if (!replaced) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`[start-time:: ${this.activeLog.startTimeStr}]`) && lines[i].includes(`[focus:: ${this.activeLog.taskName}]`)) {
                        lines[i] = lines[i].replace(/\[pause-start:: [^\]]*\]/, `[pause-start:: ${pauseStartVal}]`);
                        this.activeLog.logLine = lines[i];
                        break;
                    }
                }
            }

            await this.app.vault.modify(activeFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging pause:", e);
        }
    }

    async logResume() {
        if (!this.activeLog) return;
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const resumeTimeStr = `${h}:${m}:${s}`;

        this.activeLog.resumes.push(resumeTimeStr);
        const pauseEndVal = this.activeLog.resumes.join(', ');

        try {
            const content = await this.app.vault.read(activeFile);
            const lines = content.split('\n');
            let replaced = false;
            
            const oldLine = this.activeLog.logLine;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === oldLine.trim()) {
                    lines[i] = lines[i].replace(/\[pause-end:: [^\]]*\]/, `[pause-end:: ${pauseEndVal}]`);
                    this.activeLog.logLine = lines[i];
                    replaced = true;
                    break;
                }
            }

            if (!replaced) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`[start-time:: ${this.activeLog.startTimeStr}]`) && lines[i].includes(`[focus:: ${this.activeLog.taskName}]`)) {
                        lines[i] = lines[i].replace(/\[pause-end:: [^\]]*\]/, `[pause-end:: ${pauseEndVal}]`);
                        this.activeLog.logLine = lines[i];
                        break;
                    }
                }
            }

            await this.app.vault.modify(activeFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging resume:", e);
        }
    }

    async logUpdate(isCompleted) {
        if (!this.activeLog) return;
        
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        
        const logInfo = this.activeLog;
        this.activeLog = null;
        
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const actualEndTimeStr = `${h}:${m}:${s}`;
        
        try {
            const content = await this.app.vault.read(activeFile);
            const lines = content.split('\n');
            
            let replaced = false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === logInfo.logLine.trim()) {
                    lines[i] = lines[i].replace(/\[completed-time:: [^\]]*\]/, `[completed-time:: ${actualEndTimeStr}]`);
                    replaced = true;
                    break;
                }
            }
            
            if (!replaced) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`[start-time:: ${logInfo.startTimeStr}]`) && lines[i].includes(`[focus:: ${logInfo.taskName}]`)) {
                        lines[i] = lines[i].replace(/\[completed-time:: [^\]]*\]/, `[completed-time:: ${actualEndTimeStr}]`);
                        break;
                    }
                }
            }
            
            await this.app.vault.modify(activeFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging update:", e);
        }
    }

    async getGoogleAccessToken() {
        const fs = require('fs');
        const vaultPath = this.app.vault.adapter.getBasePath();
        const sep = vaultPath.includes('/') ? '/' : '\\';
        const tokenPath = `${vaultPath}${sep}.obsidian${sep}plugins${sep}timeblocker-and-task-timer${sep}token.json`;
        
        if (!fs.existsSync(tokenPath)) {
            throw new Error("Google authentication token.json not found in timeblocker-and-task-timer.");
        }
        
        let tokenData;
        try {
            tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        } catch (e) {
            throw new Error(`Failed to parse token.json: ${e.message}`);
        }
        
        const expiry = new Date(tokenData.expiry);
        const now = new Date();
        
        if (expiry.getTime() - now.getTime() > 60000) {
            return tokenData.token;
        }
        
        console.log("Google access token expired. Refreshing...");
        const url = tokenData.token_uri || 'https://oauth2.googleapis.com/token';
        
        const bodyDetails = {
            grant_type: 'refresh_token',
            client_id: tokenData.client_id,
            client_secret: tokenData.client_secret,
            refresh_token: tokenData.refresh_token
        };
        const body = Object.keys(bodyDetails)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(bodyDetails[key]))
            .join('&');
            
        const response = await obsidian.requestUrl({
            url: url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body
        });
        
        if (response.status !== 200) {
            throw new Error(`Failed to refresh Google API access token. HTTP Status ${response.status}`);
        }
        
        const data = response.json;
        tokenData.token = data.access_token;
        if (data.expires_in) {
            const newExpiry = new Date();
            newExpiry.setSeconds(newExpiry.getSeconds() + data.expires_in);
            tokenData.expiry = newExpiry.toISOString();
        }
        
        try {
            fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), 'utf8');
        } catch (e) {
            console.error("Warning: could not write refreshed token back to token.json:", e);
        }
        
        return tokenData.token;
    }

    async toggleGoogleTaskStatus(listId, taskId, complete) {
        const token = await this.getGoogleAccessToken();
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`;
        const body = {
            id: taskId,
            status: complete ? "completed" : "needsAction"
        };
        
        const response = await obsidian.requestUrl({
            url: url,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        if (response.status !== 200) {
            throw new Error(`Google Tasks API returned status ${response.status}: ${response.text}`);
        }
    }

    async toggleTodoistTaskStatus(taskId, complete, token) {
        const url = `https://api.todoist.com/api/v1/tasks/${taskId}/${complete ? 'close' : 'reopen'}`;
        const response = await obsidian.requestUrl({
            url: url,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.status !== 204 && response.status !== 200) {
            throw new Error(`Todoist API returned status ${response.status}: ${response.text}`);
        }
    }

    async toggleActiveTaskStatus(editor) {
        const lineNo = editor.getCursor().line;
        const lineText = editor.getLine(lineNo);
        
        const tryingToCloseRegex = /^\s*[-*+]\s+\[\s\]/;
        const tryingToReOpenRegex = /^\s*[-*+]\s+\[[^ ]\]/;
        
        const tryingToClose = tryingToCloseRegex.test(lineText);
        const tryingToReOpen = tryingToReOpenRegex.test(lineText);
        
        if (!tryingToClose && !tryingToReOpen) {
            new obsidian.Notice("Active line is not a checkbox item!");
            return;
        }
        
        const complete = tryingToClose;
        
        let listId = "";
        let taskId = "";
        
        const googleMatch = lineText.match(/tasks\.google\.com\/(?:#)?task\/([^\/]+)\/([^\s\)]+)/);
        const googleQueryMatch = lineText.match(/tasks\.google\.com\/[?#](?:listId|list)=([^&]+)&(?:taskId|task)=([^\s\)]+)/);
        
        if (googleMatch) {
            listId = googleMatch[1];
            taskId = googleMatch[2];
        } else if (googleQueryMatch) {
            listId = googleQueryMatch[1];
            taskId = googleQueryMatch[2];
        }
        
        if (listId && taskId) {
            new obsidian.Notice(`Updating task status on Google Tasks...`);
            await this.toggleGoogleTaskStatus(listId, taskId, complete);
            new obsidian.Notice(`Google Task successfully ${complete ? 'completed' : 'reopened'}!`);
            return true;
        }
        
        // 2. Todoist matching
        const todoistMatch = lineText.match(/todoist\.com\/(?:showTask\?id=|app\/task\/|app\/project\/[^\/]+\/task\/)([A-Za-z0-9_-]+)/);
        if (todoistMatch) {
            const taskId = todoistMatch[1];
            
            const todoistPlugin = this.app.plugins.plugins['todoist-text'];
            const token = todoistPlugin ? todoistPlugin.settings.authToken : (this.settings.todoistToken || "");
            
            new obsidian.Notice(`Updating task status on Todoist...`);
            await this.toggleTodoistTaskStatus(taskId, complete, token);
            new obsidian.Notice(`Todoist Task successfully ${complete ? 'completed' : 'reopened'}!`);
            return true;
        }
        
        new obsidian.Notice("No active Todoist or Google Tasks link found on this line.");
        return false;
    }
};
