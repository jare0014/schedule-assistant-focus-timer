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
        return "Schedule Assistant with Focus Timer";
    }

    getIcon() {
        return "alarm-clock";
    }

    async onOpen() {
        this.originalTitle = document.title;
        this.renderSchedule();
        
        // Register vault modify event to refresh schedule view in real-time
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                const dailyFile = this.getDailyNoteFile();
                if (dailyFile && file.path === dailyFile.path) {
                    if (!this.currentTimer && !this.isAlarming) {
                        this.renderSchedule();
                    }
                }
            })
        );
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
        return this.plugin.getDailyNoteFile();
    }

    async renderSchedule() {
        const container = this.contentEl;
        container.empty();

        const viewContainer = container.createDiv({ cls: 'task-timer-view-container' });
        
        if (this.currentTimer) {
            this.renderTimer();
            return;
        }

        await this.renderScheduleTimeline(viewContainer);
    }

    renderIdleView(viewContainer) {
        const idleContainer = viewContainer.createDiv({ cls: 'timer-idle-container' });
        const iconDiv = idleContainer.createDiv({ cls: 'timer-idle-icon' });
        iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        idleContainer.createDiv({ cls: 'timer-idle-title', text: "No Active Task" });
        idleContainer.createDiv({ cls: 'timer-idle-desc', text: "Select a task from your Day Planner inside today's daily note to start a focus timer." });
    }

    async renderScheduleTimeline(viewContainer) {
        // 1. Header with date and Generate Schedule button
        const header = viewContainer.createDiv({ cls: 'task-timer-header' });
        
        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        header.createEl('h3', { text: dateStr });
        
        const genBtn = header.createEl('button', { cls: 'auto-block-btn', text: 'Generate Schedule' });
        genBtn.onclick = () => {
            this.plugin.runTaskLoader();
        };

        // 2. Load daily note file
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) {
            this.renderIdleView(viewContainer);
            return;
        }

        let content = "";
        try {
            content = await this.app.vault.read(dailyFile);
        } catch(e) {
            this.renderIdleView(viewContainer);
            return;
        }

        // 3. Parse tasks (filter out completed tasks)
        const tasks = this.plugin.parseAllTasks(content).filter(t => t.status !== 'completed');
        if (tasks.length === 0) {
            this.renderIdleView(viewContainer);
            return;
        }

        // 4. Group tasks by subheading
        const groupedTasks = {};
        tasks.forEach(t => {
            const subheading = t.subheading || "Agenda";
            if (!groupedTasks[subheading]) {
                groupedTasks[subheading] = [];
            }
            groupedTasks[subheading].push(t);
        });

        // 5. Render list grouped by category
        const listContainer = viewContainer.createDiv({ cls: 'schedule-list' });
        
        for (const subheading in groupedTasks) {
            const cleanSubheading = subheading.replace(/^###\s+/, '');
            listContainer.createDiv({ cls: 'schedule-subheading', text: cleanSubheading });
            
            groupedTasks[subheading].forEach(task => {
                const card = listContainer.createDiv({ 
                    cls: `task-card${task.status === 'completed' ? ' completed' : ''}` 
                });
                
                const left = card.createDiv({ cls: 'task-card-left' });
                const timeRangeStr = `${String(task.startHour).padStart(2, '0')}:${String(task.startMin).padStart(2, '0')} - ${String(task.endHour).padStart(2, '0')}:${String(task.endMin).padStart(2, '0')}`;
                left.createDiv({ cls: 'task-card-time', text: timeRangeStr });
                left.createDiv({ cls: 'task-card-name', text: task.description });
                
                const right = card.createDiv({ cls: 'task-card-controls' });

                // Checkbox
                const cb = right.createEl('input', { type: 'checkbox' });
                cb.checked = task.status === 'completed';
                cb.onclick = async (e) => {
                    e.stopPropagation();
                    const complete = cb.checked;
                    await this.toggleTaskCompletion(task, complete);
                };

                if (task.status !== 'completed') {
                    // Play Button
                    const playBtn = right.createEl('button', { cls: 'task-card-play-btn', title: 'Start Timer' });
                    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                    playBtn.onclick = () => {
                        this.startTimer(task, task.duration || parseInt(this.plugin.settings.defaultDuration));
                    };

                    // Postpone Button
                    const postBtn = right.createEl('button', { cls: 'task-card-postpone-btn', title: 'Postpone' });
                    postBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                    postBtn.onclick = async () => {
                        await this.plugin.postponeTask(task);
                        this.renderSchedule();
                    };
                }

                // Delete Button (Not Today)
                const delBtn = right.createEl('button', { cls: 'task-card-delete-btn', title: 'Not Today' });
                delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                delBtn.onclick = async () => {
                    await this.plugin.removeTask(task);
                    this.renderSchedule();
                };
            });
        }
    }

    async toggleTaskCompletion(task, complete) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            const originalLine = lines[task.lineIndex];
            
            if (complete) {
                lines[task.lineIndex] = originalLine.replace('- [ ]', '- [x]');
            } else {
                lines[task.lineIndex] = originalLine.replace('- [x]', '- [ ]');
            }

            // Sync API
            await this.plugin.toggleTaskStatusByLineText(originalLine, complete);
            
            // Save daily note
            await this.app.vault.modify(dailyFile, lines.join('\n'));
            this.renderSchedule();
        } catch(e) {
            console.error("Failed to toggle task completion:", e);
        }
    }

    async endActiveTask(task) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);

            let lineIndex = task.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].includes(task.description)) {
                lineIndex = lines.findIndex(l => l.includes(task.description) && l.includes('- [ ]'));
            }

            if (lineIndex !== -1) {
                const originalLine = lines[lineIndex];
                lines[lineIndex] = originalLine.replace('- [ ]', '- [x]');
                await this.plugin.toggleTaskStatusByLineText(originalLine, true);
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));
        } catch (e) {
            console.error("Failed to complete task:", e);
        }
    }

    async startTimer(task, durationMinutes) {
        this.clearTimer();
        
        const taskName = typeof task === 'object' ? task.description : task;
        
        // Log the timer start in the daily note
        await this.plugin.logStart(taskName, durationMinutes);
        
        const totalSeconds = durationMinutes * 60;
        this.currentTimer = {
            task: typeof task === 'object' ? task : { description: taskName, duration: durationMinutes },
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
                    const expiredTask = this.currentTimer.task;
                    const expiredTaskName = this.currentTimer.taskName;
                    this.currentTimer = null;
                    await this.plugin.logUpdate(true); // Log completed
                    this.triggerAlarm(expiredTask || expiredTaskName);
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
        const taskObj = this.currentTimer ? this.currentTimer.task : null;
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";
        
        this.clearTimer();
        this.currentTimer = null;
        await this.plugin.logUpdate(true); // Log completed
        
        if (taskObj) {
            await this.endActiveTask(taskObj);
        }
        
        this.renderSchedule();
        new obsidian.Notice(`Completed session for "${taskName}"!`, 3000);
    }

    async cancelTimer() {
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";
        this.clearTimer();
        this.currentTimer = null;
        await this.plugin.logUpdate(false); // Log incomplete
        
        this.renderSchedule();
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

    triggerAlarm(task) {
        this.isAlarming = true;
        this.stopAlarm();
        
        const taskName = typeof task === 'object' ? task.description : task;
        
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
        overlay.createDiv({ cls: 'alarm-alert-text', text: "Focus session finished!" });
        
        const controls = overlay.createDiv({ cls: 'alarm-controls' });

        // End Button
        const endBtn = controls.createEl('button', { cls: 'alarm-btn primary', text: 'End & Complete' });
        endBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await this.endActiveTask(task);
            } else if (typeof task === 'string') {
                await this.endActiveTask({ description: task });
            }
            this.renderSchedule();
        };

        // Continue Button
        const continueBtn = controls.createEl('button', { cls: 'alarm-btn success', text: 'Continue Focus' });
        continueBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object') {
                await this.startTimer(task, task.duration || parseInt(this.plugin.settings.defaultDuration));
            } else {
                await this.startTimer(taskName, parseInt(this.plugin.settings.defaultDuration));
            }
        };

        // Reschedule Button
        const rescheduleBtn = controls.createEl('button', { cls: 'alarm-btn warning', text: 'Reschedule' });
        rescheduleBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await this.plugin.postponeTask(task);
            } else if (typeof task === 'string') {
                await this.plugin.postponeTask({ description: task });
            }
            this.renderSchedule();
        };

        // Not Today Button
        const notTodayBtn = controls.createEl('button', { cls: 'alarm-btn danger', text: 'Not Today' });
        notTodayBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await this.plugin.removeTask(task);
            } else if (typeof task === 'string') {
                await this.plugin.removeTask({ description: task });
            }
            this.renderSchedule();
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
                    this.renderSchedule();
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
        try {
            const { containerEl } = this;
            containerEl.empty();
            containerEl.createEl('h2', { text: 'Schedule Assistant with Focus Timer Settings' });

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

            containerEl.createEl('h3', { text: 'API Credentials (Keychain)' });

            // Gemini API Key (TextComponent as password)
            new obsidian.Setting(containerEl)
                .setName('Gemini API Key')
                .setDesc('Secure API key stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Gemini API Key');
                    let secretId = this.plugin.settings.geminiApiKeyId;
                    if (!secretId) {
                        secretId = 'timeblocker-gemini-api-key';
                        this.plugin.settings.geminiApiKeyId = secretId;
                        this.plugin.saveSettings();
                    }
                    this.plugin.getSecret(secretId, 'geminiApiKey').then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(secretId, value.trim(), 'geminiApiKey');
                    });
                });

            // Todoist API Token (TextComponent as password)
            new obsidian.Setting(containerEl)
                .setName('Todoist API Token')
                .setDesc('Secure Todoist API token stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Todoist API Token');
                    let secretId = this.plugin.settings.todoistTokenId;
                    if (!secretId) {
                        secretId = 'timeblocker-todoist-token';
                        this.plugin.settings.todoistTokenId = secretId;
                        this.plugin.saveSettings();
                    }
                    this.plugin.getSecret(secretId, 'todoistToken').then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(secretId, value.trim(), 'todoistToken');
                    });
                });

            // Google Credentials JSON (TextComponent as password)
            new obsidian.Setting(containerEl)
                .setName('Google Credentials JSON')
                .setDesc('Secure client credentials JSON string (from credentials.json) stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Google Credentials JSON');
                    let secretId = this.plugin.settings.googleCredentialsId;
                    if (!secretId) {
                        secretId = 'timeblocker-google-credentials';
                        this.plugin.settings.googleCredentialsId = secretId;
                        this.plugin.saveSettings();
                    }
                    this.plugin.getSecret(secretId, 'googleCredentials').then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(secretId, value.trim(), 'googleCredentials');
                    });
                });

            containerEl.createEl('h3', { text: 'AI Model Settings' });

            // LLM Provider (Dropdown)
            new obsidian.Setting(containerEl)
                .setName('LLM Provider')
                .setDesc('Select the AI backend to use for daily schedule generation.')
                .addDropdown(dropdown => dropdown
                    .addOption('gemini', 'Gemini (Google Cloud)')
                    .addOption('ollama', 'Ollama (Local)')
                    .setValue(this.plugin.settings.llmProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.llmProvider = value;
                        if (value === 'gemini') {
                            this.plugin.settings.llmModel = 'gemini-2.5-pro';
                        } else {
                            this.plugin.settings.llmModel = 'qwen2.5:7b';
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            // LLM Model (Dropdown with Custom option)
            const provider = this.plugin.settings.llmProvider;
            const geminiOptions = ['gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
            const ollamaOptions = ['qwen2.5:7b', 'gemma3:4b', 'llama3', 'mistral'];
            
            let modelDropdownValue = this.plugin.settings.llmModel;
            const currentOptions = provider === 'gemini' ? geminiOptions : ollamaOptions;
            
            if (!currentOptions.includes(modelDropdownValue) && modelDropdownValue !== 'custom') {
                modelDropdownValue = 'custom';
            }

            new obsidian.Setting(containerEl)
                .setName('LLM Model')
                .setDesc('Select the model to use for schedule generation.')
                .addDropdown(dropdown => {
                    if (provider === 'gemini') {
                        dropdown
                            .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
                            .addOption('gemini-1.5-pro', 'Gemini 1.5 Pro')
                            .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
                            .addOption('gemini-2.0-flash', 'Gemini 2.0 Flash')
                            .addOption('custom', 'Custom...');
                    } else {
                        dropdown
                            .addOption('qwen2.5:7b', 'Qwen 2.5 7B')
                            .addOption('gemma3:4b', 'Gemma 3 4B')
                            .addOption('llama3', 'Llama 3')
                            .addOption('mistral', 'Mistral')
                            .addOption('custom', 'Custom...');
                    }
                    
                    dropdown.setValue(modelDropdownValue)
                        .onChange(async (value) => {
                            if (value === 'custom') {
                                this.plugin.settings.llmModel = this.plugin.settings.customModel || '';
                            } else {
                                this.plugin.settings.llmModel = value;
                            }
                            await this.plugin.saveSettings();
                            this.display();
                        });
                });

            // Custom Model text box (only visible if selected model is custom)
            if (modelDropdownValue === 'custom') {
                new obsidian.Setting(containerEl)
                    .setName('Custom Model Name')
                    .setDesc('Type the exact identifier of the model (e.g. qwen2.5:14b).')
                    .addText(text => text
                        .setPlaceholder('Enter model name')
                        .setValue(this.plugin.settings.customModel || '')
                        .onChange(async (value) => {
                            this.plugin.settings.customModel = value.trim();
                            this.plugin.settings.llmModel = value.trim();
                            await this.plugin.saveSettings();
                        }));
            }

            // Ollama URL (only visible if provider is Ollama)
            if (provider === 'ollama') {
                new obsidian.Setting(containerEl)
                    .setName('Ollama Endpoint')
                    .setDesc('The base URL of your local Ollama server.')
                    .addText(text => text
                        .setPlaceholder('http://localhost:11434')
                        .setValue(this.plugin.settings.ollamaUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.ollamaUrl = value.trim();
                            await this.plugin.saveSettings();
                        }));
            }

            const fs = require('fs');
            const vaultPath = this.app.vault.adapter.getBasePath();
            const sep = vaultPath.includes('/') ? '/' : '\\';
            const prefsPath = `${vaultPath}${sep}.obsidian${sep}plugins${sep}schedule-assistant-focus-timer${sep}preferences.txt`;

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
        } catch (err) {
            console.error("Task Timer settings tab error:", err);
            containerEl.createEl('p', { text: 'Failed to display settings: ' + err.message, cls: 'theme-warning' });
        }
    }
}

const DEFAULT_SETTINGS = {
    defaultDuration: '20',
    autoApply: false,
    todoistToken: '',
    geminiApiKey: '',
    geminiApiKeyId: '',
    todoistTokenId: '',
    googleCredentialsId: '',
    googleCredentials: '',
    llmProvider: 'gemini',
    llmModel: 'gemini-2.5-pro',
    customModel: '',
    ollamaUrl: 'http://localhost:11434'
};

module.exports = class TaskTimerPlugin extends obsidian.Plugin {
    async getSecret(secretId, fallbackSettingKey) {
        if (this.app.secretStorage) {
            try {
                return await this.app.secretStorage.getSecret(secretId) || "";
            } catch (e) {
                console.error(`Failed to get secret ${secretId} from secretStorage:`, e);
            }
        }
        return this.settings[fallbackSettingKey] || "";
    }

    async setSecret(secretId, value, fallbackSettingKey) {
        if (this.app.secretStorage) {
            try {
                await this.app.secretStorage.setSecret(secretId, value);
                return;
            } catch (e) {
                console.error(`Failed to set secret ${secretId} in secretStorage:`, e);
            }
        }
        this.settings[fallbackSettingKey] = value;
        await this.saveSettings();
    }

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
        this.addRibbonIcon('alarm-clock', 'Open Schedule Assistant', () => {
            this.activateView();
        });

        // Add command to open view
        this.addCommand({
            id: 'open-task-timer',
            name: 'Open Schedule Assistant View',
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

        // Add generate schedule command
        this.addCommand({
            id: 'load-tasks',
            name: 'Generate Daily Schedule (Schedule Assistant)',
            callback: () => this.runTaskLoader()
        });

        // Add postpone clicked task command
        this.addCommand({
            id: 'postpone-clicked-task',
            name: 'Postpone clicked task to next open slot',
            callback: () => this.postponeClickedTask()
        });

        // Add sync Fitbit command
        this.addCommand({
            id: 'sync-fitbit',
            name: 'Sync Fitbit Data (Check In)',
            callback: () => this.runFitbitSync()
        });

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

    async runTaskLoader() {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
        const scriptPath = path.join(pluginDir, 'timeblocker.py');
        
        if (!fs.existsSync(scriptPath)) {
            new obsidian.Notice(`Python scheduler not found at ${scriptPath}`);
            return;
        }
        
        new obsidian.Notice("Running scheduler... please wait.");
        
        // Retrieve secrets securely from Obsidian SecretStorage
        const geminiApiKey = await this.app.secretStorage.getSecret('timeblocker-gemini-api-key') || '';
        const todoistToken = await this.app.secretStorage.getSecret('timeblocker-todoist-token') || '';
        const googleCredentials = await this.app.secretStorage.getSecret('timeblocker-google-credentials') || '';
        
        const env = Object.assign({}, process.env, {
            GEMINI_API_KEY: geminiApiKey,
            TODOIST_API_TOKEN: todoistToken,
            GOOGLE_CREDENTIALS_JSON: googleCredentials
        });

        const dailyFile = this.getDailyNoteFile();
        if (dailyFile) {
            env.DAILY_NOTE_PATH = path.join(vaultPath, dailyFile.path);
        }
        
        const child = spawn('python', [scriptPath], { 
            cwd: pluginDir,
            env: env
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                new obsidian.Notice("Schedule generated and applied successfully!");
                console.log("Scheduler output:\n", stdout);
            } else {
                new obsidian.Notice(`Scheduler failed with exit code ${code}. Check console.`);
                console.error("Scheduler error output:\n", stderr);
            }
        });
    }

    async runFitbitSync() {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const scriptPath = path.join(vaultPath, '99_System', 'Scripts', 'fitbit_pull.py');
        
        if (!fs.existsSync(scriptPath)) {
            new obsidian.Notice(`Fitbit pull script not found at ${scriptPath}`);
            return;
        }
        
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) {
            new obsidian.Notice("Daily note for today not found!");
            return;
        }
        
        new obsidian.Notice("Starting Fitbit data pull (Check In)...");
        
        const dailyNoteFullPath = path.join(vaultPath, dailyFile.path);
        const geminiApiKey = await this.getSecret('timeblocker-gemini-api-key', 'geminiApiKey');
        
        const env = Object.assign({}, process.env, {
            GEMINI_API_KEY: geminiApiKey
        });
        
        const child = spawn('python', [scriptPath, dailyNoteFullPath], {
            cwd: path.dirname(scriptPath),
            env: env
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                new obsidian.Notice("Fitbit check-in completed successfully!");
                console.log("Fitbit pull output:\n", stdout);
            } else {
                new obsidian.Notice(`Fitbit pull failed (exit code ${code}). Check console.`);
                console.error("Fitbit pull error:\n", stderr);
            }
        });
    }

    parseAllTasks(content) {
        const lines = content.split(/\r?\n/);
        const tasks = [];
        const taskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
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
                    const status = (match[1] === 'x' || match[1] === 'X') ? 'completed' : 'pending';
                    let startH = parseInt(match[2]);
                    const startM = parseInt(match[3]);
                    const startAmpm = match[4];
                    let endH = parseInt(match[5]);
                    const endM = parseInt(match[6]);
                    const endAmpm = match[7];
                    const rawDesc = match[8];

                    if (startAmpm) {
                        const ampm = startAmpm.toLowerCase();
                        if (ampm === 'pm' && startH < 12) startH += 12;
                        if (ampm === 'am' && startH === 12) startH = 0;
                    }
                    if (endAmpm) {
                        const ampm = endAmpm.toLowerCase();
                        if (ampm === 'pm' && endH < 12) endH += 12;
                        if (ampm === 'am' && endH === 12) endH = 0;
                    }
                    
                    let description = rawDesc.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                    description = description.replace(/\[src\]\(.*?\)/g, '').trim();
                    description = description.replace(/\s+src$/i, '').trim();
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

    async postponeClickedTask() {
        const activeView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        const lineContent = this.getClickedLineContent(activeView);
        if (!lineContent) {
            new obsidian.Notice("Could not identify the clicked task line!");
            return;
        }

        // Try to match HH:MM - HH:MM format
        const clickedTaskRegex = /^(?:\s*-\s+\[[ xX]\])?\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
        const match = lineContent.match(clickedTaskRegex);
        
        let clickedStartMinutes = null;
        let clickedEndMinutes = null;
        let clickedDescription = "";

        if (match) {
            let startH = parseInt(match[1]);
            const startM = parseInt(match[2]);
            const startAmpm = match[3];
            let endH = parseInt(match[4]);
            const endM = parseInt(match[5]);
            const endAmpm = match[6];
            
            if (startAmpm) {
                const ampm = startAmpm.toLowerCase();
                if (ampm === 'pm' && startH < 12) startH += 12;
                if (ampm === 'am' && startH === 12) startH = 0;
            }
            if (endAmpm) {
                const ampm = endAmpm.toLowerCase();
                if (ampm === 'pm' && endH < 12) endH += 12;
                if (ampm === 'am' && endH === 12) endH = 0;
            }

            clickedStartMinutes = startH * 60 + startM;
            clickedEndMinutes = endH * 60 + endM;
            
            clickedDescription = match[7];
        } else {
            // No time prefix - treat the entire line content as description
            clickedDescription = lineContent;
        }

        // Clean description
        clickedDescription = clickedDescription.replace(/^\s*-\s+\[[ x]\]\s*/, '');
        clickedDescription = clickedDescription.replace(/^\s*-\s*/, '');
        clickedDescription = clickedDescription.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
        clickedDescription = clickedDescription.replace(/\[src\]\(.*?\)/g, '').trim();
        clickedDescription = clickedDescription.replace(/\s+src$/i, '').trim();
        clickedDescription = clickedDescription.replace(/#\w+/g, '').trim();
        clickedDescription = clickedDescription.replace(/\s+/g, ' ').trim().toLowerCase();

        const dailyFile = (activeView && activeView.file) || this.getDailyNoteFile();
        if (!dailyFile) {
            new obsidian.Notice("No daily note file found for today!");
            return;
        }

        let content = "";
        try {
            content = await this.app.vault.read(dailyFile);
        } catch (e) {
            new obsidian.Notice("Could not read daily note!");
            return;
        }

        const lines = content.split(/\r?\n/);
        const allTasks = this.parseAllTasks(content);

        // Find the task by comparing start/end times (if available) and normalized descriptions
        const task = allTasks.find(t => {
            if (clickedStartMinutes !== null && clickedEndMinutes !== null) {
                const timeMatches = (t.startMinutes === clickedStartMinutes && t.endMinutes === clickedEndMinutes);
                if (!timeMatches) return false;
            }
            
            const fileDesc = t.description.toLowerCase();
            return fileDesc === clickedDescription || fileDesc.includes(clickedDescription) || clickedDescription.includes(fileDesc);
        });

        if (!task) {
            new obsidian.Notice("Could not find the clicked task in the daily note file!");
            return;
        }

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const busyIntervals = allTasks
            .filter(t => t.status !== 'completed' && t.endMinutes > currentMinutes && t.lineIndex !== task.lineIndex)
            .map(t => ({
                start: t.startMinutes,
                end: t.endMinutes
            }));
            
        busyIntervals.sort((a, b) => a.start - b.start);

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

        const newStartH = String(Math.floor(newStart / 60)).padStart(2, '0');
        const newStartM = String(newStart % 60).padStart(2, '0');
        const newEndH = String(Math.floor(newEnd / 60)).padStart(2, '0');
        const newEndM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

        const originalLine = lines[task.lineIndex];
        const oldTimeRangeRegex = /\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[\-–—~]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[task.lineIndex] = newLine;

        let inSubheading = false;
        const subheadingIndices = [];
        const fileTaskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;

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
                if (fileTaskRegex.test(line)) {
                    subheadingIndices.push(i);
                }
            }
        }

        if (subheadingIndices.length > 1) {
            const subheadingTasks = subheadingIndices.map(idx => {
                const line = lines[idx];
                const m = line.match(fileTaskRegex);
                let sh = parseInt(m[2]);
                const sm = parseInt(m[3]);
                const startAmpm = m[4];
                if (startAmpm) {
                    const ampm = startAmpm.toLowerCase();
                    if (ampm === 'pm' && sh < 12) sh += 12;
                    if (ampm === 'am' && sh === 12) sh = 0;
                }
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
            new obsidian.Notice(`Postponed task to ${newTimeRange}`);
        } catch (e) {
            new obsidian.Notice("Failed to update daily note!");
        }
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
                
                // Generic fallback for Day Planner view or other custom renderings:
                // Find the nearest container element that contains substantial text (the task description)
                const clone = el.cloneNode(true);
                clone.querySelectorAll('.meta-bind-button-wrapper, .meta-bind-button, button, [class*="meta-bind"]').forEach(btn => btn.remove());
                const txt = (clone.textContent || "").trim();
                
                if (txt.length > 5 && !el.classList.contains('meta-bind-button') && el.tagName !== 'BUTTON') {
                    let cleaned = txt.replace(/\s+/g, ' ').trim();
                    if (!cleaned.startsWith('-')) {
                        cleaned = '- [ ] ' + cleaned;
                    }
                    return cleaned;
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
                
                // Strip links and trailing rendered link text "src"
                taskText = taskText.replace(/\[src\]\(.*?\)/g, '').trim();
                taskText = taskText.replace(/\s+src$/i, '').trim();
                
                // Strip tags from the task name
                taskText = taskText.replace(/#\w+/g, '').trim();
                
                // Clean up any double spaces left from tag removal
                taskText = taskText.replace(/\s+/g, ' ').trim();
                
                const timeRegex = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?)?\s*(.*)$/;
                const timeMatch = taskText.match(timeRegex);
                taskName = timeMatch ? timeMatch[7].trim() : taskText.trim();
            }
        }
        
        // Ensure default name is clean
        taskName = taskName || `Focus Block (${durationMinutes}m)`;
        
        // Look up the task object from the daily note to pass it to the timer
        let matchedTask = null;
        const dailyFile = this.getDailyNoteFile();
        if (dailyFile && lineContent) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const allTasks = this.parseAllTasks(content);
                
                // Parse time range from the clicked line content anywhere in the string
                const timeRangeRegex = /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/i;
                const match = lineContent.match(timeRangeRegex);
                if (match) {
                    let startH = parseInt(match[1]);
                    const startM = parseInt(match[2]);
                    const startAmpm = match[3];
                    let endH = parseInt(match[4]);
                    const endM = parseInt(match[5]);
                    const endAmpm = match[6];
                    
                    if (startAmpm) {
                        const ampm = startAmpm.toLowerCase();
                        if (ampm === 'pm' && startH < 12) startH += 12;
                        if (ampm === 'am' && startH === 12) startH = 0;
                    }
                    if (endAmpm) {
                        const ampm = endAmpm.toLowerCase();
                        if (ampm === 'pm' && endH < 12) endH += 12;
                        if (ampm === 'am' && endH === 12) endH = 0;
                    }

                    const clickedStartMinutes = startH * 60 + startM;
                    const clickedEndMinutes = endH * 60 + endM;
                    
                    let clickedDescription = lineContent.replace(match[0], '').trim();
                    clickedDescription = clickedDescription.replace(/^\s*-\s+\[[ x]\]\s*/, '');
                    clickedDescription = clickedDescription.replace(/^\s*-\s*/, '');
                    clickedDescription = clickedDescription.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                    clickedDescription = clickedDescription.replace(/\[src\]\(.*?\)/g, '').trim();
                    clickedDescription = clickedDescription.replace(/\s+src$/i, '').trim();
                    clickedDescription = clickedDescription.replace(/#\w+/g, '').trim();
                    clickedDescription = clickedDescription.replace(/\s+/g, ' ').trim().toLowerCase();
                    
                    matchedTask = allTasks.find(t => {
                        const timeMatches = (t.startMinutes === clickedStartMinutes && t.endMinutes === clickedEndMinutes);
                        if (!timeMatches) return false;
                        
                        const fileDesc = t.description.toLowerCase();
                        return fileDesc === clickedDescription || fileDesc.includes(clickedDescription) || clickedDescription.includes(fileDesc);
                    });
                } else {
                    // Try matching purely by description
                    let clickedDescription = taskName.toLowerCase();
                    matchedTask = allTasks.find(t => {
                        const fileDesc = t.description.toLowerCase();
                        return fileDesc === clickedDescription || fileDesc.includes(clickedDescription) || clickedDescription.includes(fileDesc);
                    });
                }
            } catch (e) {
                console.error("Failed to match clicked task against daily note schedule", e);
            }
        }
        
        await this.activateView();
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (leaves.length > 0) {
            const view = leaves[0].view;
            await view.startTimer(matchedTask || taskName, durationMinutes);
        }
    }

    getDailyNoteFile() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const path = `02_Journal/01_Daily/${year}-${month}-${day}.md`;
        return this.app.vault.getAbstractFileByPath(path);
    }

    async logStart(taskName, durationMinutes) {
        if (this.activeLog) {
            await this.logUpdate(false);
        }
        
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) {
            new obsidian.Notice("Daily note not found! Cannot log timer.");
            return;
        }
        
        const now = new Date();
        const sh = String(now.getHours()).padStart(2, '0');
        const sm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const startTimeStr = `${sh}:${sm}:${ss}`;
        
        const logLine = `- [focus:: ${taskName}] [start-time:: ${startTimeStr}] [pause-start:: ] [pause-end:: ] [completed-time:: ]`;
        
        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            
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
            
            await this.app.vault.modify(dailyFile, lines.join('\n'));
            
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
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const pauseTimeStr = `${h}:${m}:${s}`;

        this.activeLog.pauses.push(pauseTimeStr);
        const pauseStartVal = this.activeLog.pauses.join(', ');

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
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

            await this.app.vault.modify(dailyFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging pause:", e);
        }
    }

    async logResume() {
        if (!this.activeLog) return;
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const resumeTimeStr = `${h}:${m}:${s}`;

        this.activeLog.resumes.push(resumeTimeStr);
        const pauseEndVal = this.activeLog.resumes.join(', ');

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
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

            await this.app.vault.modify(dailyFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging resume:", e);
        }
    }

    async logUpdate(isCompleted) {
        if (!this.activeLog) return;
        
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;
        
        const logInfo = this.activeLog;
        this.activeLog = null;
        
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const actualEndTimeStr = `${h}:${m}:${s}`;
        
        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            
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
            
            await this.app.vault.modify(dailyFile, lines.join('\n'));
        } catch (e) {
            console.error("Error logging update:", e);
        }
    }

    async getGoogleAccessToken() {
        const fs = require('fs');
        const vaultPath = this.app.vault.adapter.getBasePath();
        const sep = vaultPath.includes('/') ? '/' : '\\';
        const tokenPath = `${vaultPath}${sep}.obsidian${sep}plugins${sep}schedule-assistant-focus-timer${sep}token.json`;
        
        if (!fs.existsSync(tokenPath)) {
            throw new Error("Google authentication token.json not found in schedule-assistant-focus-timer.");
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
        
        try {
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
                if (response.status === 404 || response.status === 410) {
                    new obsidian.Notice(`Task already completed or deleted on Google Tasks.`);
                    return;
                }
                throw new Error(`Google Tasks API returned status ${response.status}: ${response.text}`);
            }
        } catch (e) {
            if (e.status === 404 || e.status === 410 || (e.message && (e.message.includes("404") || e.message.includes("410")))) {
                new obsidian.Notice(`Task already completed or deleted on Google Tasks.`);
                return;
            }
            throw e;
        }
    }

    async toggleTodoistTaskStatus(taskId, complete, token) {
        const url = `https://api.todoist.com/rest/v2/tasks/${taskId}/${complete ? 'close' : 'reopen'}`;
        try {
            const response = await obsidian.requestUrl({
                url: url,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status !== 204 && response.status !== 200) {
                if (response.status === 404 || response.status === 410) {
                    new obsidian.Notice(`Task already completed or deleted on Todoist.`);
                    return;
                }
                throw new Error(`Todoist API returned status ${response.status}: ${response.text}`);
            }
        } catch (e) {
            if (e.status === 404 || e.status === 410 || (e.message && (e.message.includes("404") || e.message.includes("410")))) {
                new obsidian.Notice(`Task already completed or deleted on Todoist.`);
                return;
            }
            throw e;
        }
    }

    async toggleTaskStatusByLineText(lineText, complete) {
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
            return true;
        }
        
        const todoistMatch = lineText.match(/todoist\.com\/(?:showTask\?id=|app\/task\/|app\/project\/[^\/]+\/task\/)([A-Za-z0-9_-]+)/);
        if (todoistMatch) {
            const taskId = todoistMatch[1];
            let token = "";
            const secretId = this.settings.todoistTokenId || 'timeblocker-todoist-token';
            token = await this.getSecret(secretId, 'todoistToken');
            if (!token) {
                const todoistPlugin = this.app.plugins.plugins['todoist-text'];
                token = todoistPlugin ? todoistPlugin.settings.authToken : "";
            }
            
            new obsidian.Notice(`Updating task status on Todoist...`);
            await this.toggleTodoistTaskStatus(taskId, complete, token);
            return true;
        }
        return false;
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
        const success = await this.toggleTaskStatusByLineText(lineText, complete);
        if (success) {
            new obsidian.Notice(`Task successfully ${complete ? 'completed' : 'reopened'}!`);
            return true;
        }
        new obsidian.Notice("No active Todoist or Google Tasks link found on this line.");
        return false;
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

        const lines = content.split(/\r?\n/);
        const allTasks = this.parseAllTasks(content);

        // Find the task inside allTasks
        let currentTask = allTasks.find(t => t.lineIndex === task.lineIndex);
        if (!currentTask) {
            // Find by description and pending status
            currentTask = allTasks.find(t => t.description.toLowerCase() === task.description.toLowerCase() && t.status === 'pending');
        }

        if (!currentTask) {
            new obsidian.Notice("Could not find the task in daily note!");
            return;
        }

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Find all busy intervals after now (excluding the current task itself)
        const busyIntervals = allTasks
            .filter(t => t.status !== 'completed' && t.endMinutes > currentMinutes && t.lineIndex !== currentTask.lineIndex)
            .map(t => ({
                start: t.startMinutes,
                end: t.endMinutes
            }));
            
        busyIntervals.sort((a, b) => a.start - b.start);

        let newStart = currentMinutes;
        const duration = currentTask.duration || 20;

        for (const interval of busyIntervals) {
            if (interval.start - newStart >= duration) {
                break;
            }
            newStart = Math.max(newStart, interval.end);
        }

        const newEnd = newStart + duration;
        if (newEnd > 1440) {
            new obsidian.Notice("Cannot reschedule: task would go past midnight!");
            return;
        }

        const newStartH = String(Math.floor(newStart / 60)).padStart(2, '0');
        const newStartM = String(newStart % 60).padStart(2, '0');
        const newEndH = String(Math.floor(newEnd / 60)).padStart(2, '0');
        const newEndM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

        const originalLine = lines[currentTask.lineIndex];
        const oldTimeRangeRegex = /\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[\-–—~]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[currentTask.lineIndex] = newLine;

        // Re-sort within the subheading (e.g. Work, House, Admin)
        let inSubheading = false;
        const subheadingIndices = [];
        const fileTaskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## ') || (line.startsWith('### ') && line.trim() !== currentTask.subheading)) {
                if (inSubheading) break;
            }
            if (line.trim() === currentTask.subheading) {
                inSubheading = true;
                continue;
            }
            if (inSubheading) {
                if (fileTaskRegex.test(line)) {
                    subheadingIndices.push(i);
                }
            }
        }

        if (subheadingIndices.length > 1) {
            const subheadingTasks = subheadingIndices.map(idx => {
                const line = lines[idx];
                const m = line.match(fileTaskRegex);
                let sh = parseInt(m[2]);
                const sm = parseInt(m[3]);
                const startAmpm = m[4];
                if (startAmpm) {
                    const ampm = startAmpm.toLowerCase();
                    if (ampm === 'pm' && sh < 12) sh += 12;
                    if (ampm === 'am' && sh === 12) sh = 0;
                }
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
            new obsidian.Notice(`Rescheduled task to ${newTimeRange}`);
        } catch (e) {
            new obsidian.Notice("Failed to update daily note!");
        }
    }

    async removeTask(task) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);

            let lineIndex = task.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].includes(task.description)) {
                lineIndex = lines.findIndex(l => l.includes(task.description) && (l.includes('- [ ]') || l.includes('- [x]')));
            }

            if (lineIndex !== -1) {
                lines.splice(lineIndex, 1);
                await this.app.vault.modify(dailyFile, lines.join('\n'));
                new obsidian.Notice(`Task "${task.description}" removed from today's list.`);
            } else {
                new obsidian.Notice("Could not find task in daily note to remove.");
            }
        } catch (e) {
            console.error("Failed to remove task:", e);
            new obsidian.Notice("Error updating daily note.");
        }
    }
};
