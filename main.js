const obsidian = require('obsidian');

const VIEW_TYPE_TASK_TIMER = 'task-timer-view';

function normalizeTimeRangeSpaces(line) {
    if (!line) return line;
    const regex = /^((\s*-\s+\[[ xX/]\]\s+)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[\-–—~]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*)(.*)$/i;
    const match = line.match(regex);
    if (match) {
        const timePrefix = match[1];
        const taskDesc = match[3];
        const trimmedPrefix = timePrefix.trim();
        const trimmedDesc = taskDesc.trim();
        if (trimmedDesc) {
            return `${trimmedPrefix} ${trimmedDesc}`;
        } else {
            return trimmedPrefix;
        }
    }
    return line;
}

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
            
            const groupSection = listContainer.createDiv({ cls: 'schedule-group-section' });
            groupSection.setAttribute('data-subheading', subheading);
            
            // Drag and drop event listeners on the groupSection
            groupSection.ondragover = (e) => {
                e.preventDefault();
                groupSection.addClass('dragover');
            };
            groupSection.ondragleave = () => {
                groupSection.removeClass('dragover');
            };
            groupSection.ondrop = async (e) => {
                e.preventDefault();
                groupSection.removeClass('dragover');
                try {
                    const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                    await this.handleTaskDrop(data, subheading);
                } catch (err) {
                    console.error("Drop parsing failed:", err);
                }
            };
            
            const isUntimedSubheading = subheading.includes("☁️") || subheading.toLowerCase().includes("micro-task") || subheading.toLowerCase().includes("untimed");
            
            if (isUntimedSubheading) {
                // Group by project
                const projectGroups = {};
                groupedTasks[subheading].forEach(task => {
                    const proj = task.project || "Other Tasks";
                    if (!projectGroups[proj]) {
                        projectGroups[proj] = [];
                    }
                    projectGroups[proj].push(task);
                });

                for (const proj in projectGroups) {
                    const projectDetails = groupSection.createEl('details', { cls: 'sidebar-project-details' });
                    projectDetails.setAttribute('open', '');
                    
                    const projectSummary = projectDetails.createEl('summary', { cls: 'sidebar-project-summary' });
                    projectSummary.createEl('span', { cls: 'sidebar-project-title', text: proj });
                    
                    const projectContainer = projectDetails.createDiv({ cls: 'sidebar-project-container' });
                    
                    projectGroups[proj].forEach(task => {
                        const card = projectContainer.createDiv({ 
                            cls: `task-card${task.status === 'completed' ? ' completed' : ''}` 
                        });
                        
                        card.setAttribute('draggable', 'true');
                        card.ondragstart = (e) => {
                            e.dataTransfer.setData("text/plain", JSON.stringify({
                                lineIndex: task.lineIndex,
                                description: task.description,
                                isUntimed: task.isUntimed
                            }));
                        };
                        
                        const left = card.createDiv({ cls: 'task-card-left' });
                        left.createDiv({ cls: 'task-card-time', text: 'Untimed' });
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
                            // Render quick timer buttons: 5m, 10m, 15m, 20m
                            [5, 10, 15, 20].forEach(m => {
                                const btn = right.createEl('button', { 
                                    cls: 'task-card-quick-timer-btn', 
                                    text: `${m}m`, 
                                    title: `Start ${m}m timer` 
                                });
                                btn.onclick = () => {
                                    this.startTimer(task, m);
                                };
                            });
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
            } else {
                groupedTasks[subheading].forEach(task => {
                    // Skip nested subtasks in the top-level rendering loop
                    if (task.parentLineIndex !== undefined) {
                        return;
                    }

                    const card = groupSection.createDiv({ 
                        cls: `task-card${task.status === 'completed' ? ' completed' : ''}` 
                    });
                    
                    card.setAttribute('draggable', 'true');
                    card.ondragstart = (e) => {
                        e.dataTransfer.setData("text/plain", JSON.stringify({
                            lineIndex: task.lineIndex,
                            description: task.description,
                            isUntimed: task.isUntimed
                        }));
                    };
                    
                    const mainRow = card.createDiv({ cls: 'task-card-main' });
                    const left = mainRow.createDiv({ cls: 'task-card-left' });
                    if (task.isUntimed) {
                        left.createDiv({ cls: 'task-card-time', text: 'Untimed' });
                    } else {
                        const timeRangeStr = `${String(task.startHour).padStart(2, '0')}:${String(task.startMin).padStart(2, '0')} - ${String(task.endHour).padStart(2, '0')}:${String(task.endMin).padStart(2, '0')}`;
                        left.createDiv({ cls: 'task-card-time', text: timeRangeStr });
                    }
                    left.createDiv({ cls: 'task-card-name', text: task.description });
                    
                    const right = mainRow.createDiv({ cls: 'task-card-controls' });

                    // Checkbox
                    const cb = right.createEl('input', { type: 'checkbox' });
                    cb.checked = task.status === 'completed';
                    cb.onclick = async (e) => {
                        e.stopPropagation();
                        const complete = cb.checked;
                        await this.toggleTaskCompletion(task, complete);
                    };

                    if (task.status !== 'completed') {
                        if (task.isUntimed) {
                            // Render quick timer buttons: 5m, 10m, 15m, 20m
                            [5, 10, 15, 20].forEach(m => {
                                const btn = right.createEl('button', { 
                                    cls: 'task-card-quick-timer-btn', 
                                    text: `${m}m`, 
                                    title: `Start ${m}m timer` 
                                });
                                btn.onclick = () => {
                                    this.startTimer(task, m);
                                };
                            });
                        } else {
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
                    }

                    // Delete Button (Not Today)
                    const delBtn = right.createEl('button', { cls: 'task-card-delete-btn', title: 'Not Today' });
                    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                    delBtn.onclick = async () => {
                        await this.plugin.removeTask(task);
                        this.renderSchedule();
                    };

                    // Render nested subtasks if any exist
                    const subtasks = groupedTasks[subheading].filter(t => t.parentLineIndex === task.lineIndex);
                    if (subtasks.length > 0) {
                        const subtasksContainer = card.createDiv({ cls: 'task-card-subtasks' });
                        subtasks.forEach(subtask => {
                            const subtaskEl = subtasksContainer.createDiv({ 
                                cls: `task-subtask-item${subtask.status === 'completed' ? ' completed' : ''}` 
                            });
                            
                            const subLeft = subtaskEl.createDiv({ cls: 'task-subtask-left' });
                            
                            // Checkbox
                            const subCb = subLeft.createEl('input', { type: 'checkbox' });
                            subCb.checked = subtask.status === 'completed';
                            subCb.onclick = async (e) => {
                                e.stopPropagation();
                                const complete = subCb.checked;
                                await this.toggleTaskCompletion(subtask, complete);
                            };
                            
                            subLeft.createDiv({ cls: 'task-subtask-name', text: subtask.description });
                            
                            const subRight = subtaskEl.createDiv({ cls: 'task-subtask-controls' });
                            
                            if (subtask.status !== 'completed') {
                                const playBtn = subRight.createEl('button', { 
                                    cls: 'task-subtask-play-btn', 
                                    title: 'Start Timer' 
                                });
                                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                                playBtn.onclick = () => {
                                    this.startTimer(subtask, subtask.duration || parseInt(this.plugin.settings.defaultDuration));
                                };
                            }
                        });
                    }
                });
            }
        }
    }

    async toggleTaskCompletion(task, complete) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            let lineIndex = task.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].toLowerCase().includes(task.description.toLowerCase().trim())) {
                lineIndex = lines.findIndex(l => l.toLowerCase().includes(task.description.toLowerCase().trim()) && (l.includes('- [ ]') || l.includes('- [x]') || l.includes('- [/]')));
            }
            if (lineIndex === -1) {
                new obsidian.Notice("Could not find the task in daily note!");
                return;
            }
            const originalLine = lines[lineIndex];
            
            if (complete) {
                lines[lineIndex] = originalLine.replace('- [ ]', '- [x]').replace('- [/]', '- [x]');
            } else {
                lines[lineIndex] = originalLine.replace('- [x]', '- [ ]');
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

    async handleTaskDrop(draggedTask, targetSubheading) {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            const allTasks = this.plugin.parseAllTasks(content);

            // Find the task line index
            let lineIndex = draggedTask.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].toLowerCase().includes(draggedTask.description.toLowerCase().trim())) {
                lineIndex = lines.findIndex(l => l.toLowerCase().includes(draggedTask.description.toLowerCase().trim()) && (l.includes('- [ ]') || l.includes('- [x]') || l.includes('- [/]')));
            }

            if (lineIndex === -1) {
                new obsidian.Notice("Could not find the task in daily note!");
                return;
            }

            const targetIsUntimed = targetSubheading.includes("☁️") || targetSubheading.toLowerCase().includes("micro-task") || targetSubheading.toLowerCase().includes("untimed");
            const sourceIsUntimed = draggedTask.isUntimed;

            if (targetIsUntimed === sourceIsUntimed) {
                // Dragged to the same type section, no-op
                return;
            }

            let lineText = lines[lineIndex];
            
            // Remove the line from its current position
            lines.splice(lineIndex, 1);

            // Determine if we need to add or remove time range
            const oldTimeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;

            if (targetIsUntimed) {
                // Moving from Timed -> Untimed: REMOVE time range and any `BUTTON[...]` timer buttons
                lineText = lineText.replace(oldTimeRangeRegex, "").trim();
                lineText = lineText.replace(/`?BUTTON\[timer-\d+\]`?/g, "").trim();
                // Clean up any extra spacing
                lineText = lineText.replace(/-\s+\[( |x|X)\]\s+/, "- [$1] ");
            } else {
                // Moving from Untimed -> Timed: ADD time range
                // Calculate next available slot
                const now = new Date();
                let currentMinutes = now.getHours() * 60 + now.getMinutes();
                if (now.getHours() < 5) {
                    currentMinutes += 1440;
                }

                // Find busy intervals from timed tasks
                const busyIntervals = allTasks
                    .filter(t => t.status !== 'completed' && !t.isUntimed && t.endMinutes > currentMinutes && t.lineIndex !== lineIndex)
                    .map(t => ({
                        start: t.startMinutes,
                        end: t.endMinutes
                    }));
                    
                busyIntervals.sort((a, b) => a.start - b.start);

                let newStart = currentMinutes;
                const duration = 20; // Default duration for microtasks graduated to focus blocks

                for (const interval of busyIntervals) {
                    if (interval.start - newStart >= duration) {
                        break;
                    }
                    newStart = Math.max(newStart, interval.end);
                }

                const newEnd = newStart + duration;
                if (newEnd > 1740) {
                    new obsidian.Notice("Cannot reschedule: task would go past tomorrow morning!");
                    return;
                }

                const newStartH = String(Math.floor(newStart / 60) % 24).padStart(2, '0');
                const newStartM = String(newStart % 60).padStart(2, '0');
                const newEndH = String(Math.floor(newEnd / 60) % 24).padStart(2, '0');
                const newEndM = String(newEnd % 60).padStart(2, '0');
                const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;
                
                // Add the time range and a default timer button `BUTTON[timer-20]`
                lineText = lineText.replace(/(-\s+\[(?: |x|X)\]\s+)(.*)/, `$1${newTimeRange} $2 \`BUTTON[timer-20]\``);
            }

            lineText = normalizeTimeRangeSpaces(lineText);

            // Find where the target subheading is located
            let targetSubheadingIndex = lines.findIndex(l => l.trim().includes(targetSubheading));
            if (targetSubheadingIndex === -1) {
                // Fallback: search case insensitively
                targetSubheadingIndex = lines.findIndex(l => l.toLowerCase().includes(targetSubheading.toLowerCase().trim()));
            }

            if (targetSubheadingIndex === -1) {
                // If not found at all, append to end of file
                lines.push(lineText);
                new obsidian.Notice(`Added task to end of note.`);
            } else {
                // Find insertion index: find next heading or rule or end of file
                let insertIndex = targetSubheadingIndex + 1;
                while (insertIndex < lines.length) {
                    const l = lines[insertIndex];
                    if (l.startsWith('##') || l.startsWith('---')) {
                        break;
                    }
                    insertIndex++;
                }
                
                // Insert the line
                lines.splice(insertIndex, 0, lineText);
            }

            // Save the file
            await this.app.vault.modify(dailyFile, lines.join('\n'));
            this.renderSchedule();
            new obsidian.Notice(`Moved task to ${targetIsUntimed ? 'Micro-Tasks' : 'Focus Blocks'}`);
        } catch (e) {
            console.error("Failed to drag and drop task:", e);
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

        // Time Adjustment Controls
        const adjustControls = timerContainer.createDiv({ cls: 'timer-adjust-controls' });
        const plus1Btn = adjustControls.createEl('button', { cls: 'timer-btn-adjust', text: '+1m' });
        plus1Btn.onclick = () => this.adjustActiveTimer(1);
        const plusBtn = adjustControls.createEl('button', { cls: 'timer-btn-adjust', text: '+5m' });
        plusBtn.onclick = () => this.adjustActiveTimer(5);

        const controls = timerContainer.createDiv({ cls: 'timer-controls' });

        this.pauseBtn = controls.createEl('button', { cls: 'timer-btn', text: 'Pause' });
        this.pauseBtn.onclick = () => this.togglePause();

        const completeBtn = controls.createEl('button', { cls: 'timer-btn primary', text: 'Complete' });
        completeBtn.onclick = () => this.completeTimer();

        const cancelBtn = controls.createEl('button', { cls: 'timer-btn warning', text: 'Cancel' });
        cancelBtn.onclick = () => this.cancelTimer();
    }

    async adjustActiveTimer(minutes) {
        if (!this.currentTimer) return;

        const timer = this.currentTimer;
        timer.remainingSeconds = Math.max(0, timer.remainingSeconds + minutes * 60);
        timer.totalSeconds = Math.max(0, timer.totalSeconds + minutes * 60);

        const dailyFile = this.getDailyNoteFile();
        if (dailyFile) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const lines = content.split(/\r?\n/);

                let lineIndex = timer.task.lineIndex;
                if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].includes(timer.taskName)) {
                    lineIndex = lines.findIndex(l => l.includes(timer.taskName) && l.includes('- [ ]'));
                }

                if (lineIndex !== -1) {
                    const originalLine = lines[lineIndex];
                    const timeRangeRegex = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/;
                    const match = originalLine.match(timeRangeRegex);
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

                        const startMinutes = startH * 60 + startM;
                        const originalEndMinutes = endH * 60 + endM;
                        const newEndMinutes = originalEndMinutes + minutes;

                        const newEndH24 = Math.floor(newEndMinutes / 60) % 24;
                        const newEndM24 = newEndMinutes % 60;

                        let newTimeRangeStr = "";
                        if (startAmpm || endAmpm) {
                            const startAmPmStr = startAmpm ? startAmpm.toUpperCase() : (startH >= 12 ? 'PM' : 'AM');
                            const endAmPmStr = endAmpm ? endAmpm.toUpperCase() : (newEndH24 >= 12 ? 'PM' : 'AM');
                            const startH12 = startH % 12 === 0 ? 12 : startH % 12;
                            const endH12 = newEndH24 % 12 === 0 ? 12 : newEndH24 % 12;
                            newTimeRangeStr = `${startH12}:${String(startM).padStart(2, '0')} ${startAmPmStr} - ${endH12}:${String(newEndM24).padStart(2, '0')} ${endAmPmStr}`;
                        } else {
                            newTimeRangeStr = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')} - ${String(newEndH24).padStart(2, '0')}:${String(newEndM24).padStart(2, '0')}`;
                        }

                        let newLine = originalLine.replace(timeRangeRegex, newTimeRangeStr);

                        const buttonRegex = /BUTTON\[timer-(\d+)\]/;
                        const buttonMatch = originalLine.match(buttonRegex);
                        if (buttonMatch) {
                            const currentDuration = parseInt(buttonMatch[1]);
                            const newDuration = Math.max(0, currentDuration + minutes);
                            newLine = newLine.replace(buttonRegex, `BUTTON[timer-${newDuration}]`);
                        }
                        newLine = normalizeTimeRangeSpaces(newLine);
                        lines[lineIndex] = newLine;
                        await this.app.vault.modify(dailyFile, lines.join('\n'));

                        timer.task.duration = Math.max(0, (timer.task.duration || 20) + minutes);
                        timer.task.originalLine = newLine;
                    }
                }
            } catch (e) {
                console.error("Failed to adjust active task in daily note:", e);
            }
        }

        this.updateTimerDisplay();
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

            const requestWithTimeout = async (params, timeoutMs = 2500) => {
                return Promise.race([
                    obsidian.requestUrl(params),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
                ]);
            };

            const createStatusBadge = (parentEl) => {
                const badge = parentEl.createEl('span');
                badge.style.display = 'inline-block';
                badge.style.width = '10px';
                badge.style.height = '10px';
                badge.style.borderRadius = '50%';
                badge.style.marginLeft = '8px';
                badge.style.verticalAlign = 'middle';
                badge.style.backgroundColor = '#8e8e93'; // default gray
                badge.setAttribute('title', 'Checking...');
                return badge;
            };

            const updateBadge = (badge, ok, tooltip) => {
                badge.style.backgroundColor = ok ? '#30d158' : '#ff453a';
                badge.setAttribute('title', tooltip);
            };

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

            containerEl.createEl('h3', { text: 'Remote Server Settings' });

            new obsidian.Setting(containerEl)
                .setName('Enable Remote Server')
                .setDesc('Start a local web server to control focus timer and schedule from Android phone, tablet, and watch.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableServer !== false)
                    .onChange(async (value) => {
                        this.plugin.settings.enableServer = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            await this.plugin.startServer();
                        } else {
                            this.plugin.stopServer();
                        }
                    }));

            new obsidian.Setting(containerEl)
                .setName('Remote Server Port')
                .setDesc('The port to run the web server on (e.g. 8089). Requires server restart or toggle.')
                .addText(text => text
                    .setPlaceholder('8089')
                    .setValue(this.plugin.settings.serverPort || '8089')
                    .onChange(async (value) => {
                        this.plugin.settings.serverPort = value.trim();
                        await this.plugin.saveSettings();
                        if (this.plugin.settings.enableServer) {
                            await this.plugin.startServer();
                        }
                    }));

            containerEl.createEl('h3', { text: 'API Credentials (Keychain)' });

            // Gemini API Key (TextComponent as password)
            let geminiSecretId = this.plugin.settings.geminiApiKeyId || 'schedule-assistant-gemini-api-key';
            if (!this.plugin.settings.geminiApiKeyId) {
                this.plugin.settings.geminiApiKeyId = geminiSecretId;
                this.plugin.saveSettings();
            }
            const geminiSetting = new obsidian.Setting(containerEl)
                .setName('Gemini API Key')
                .setDesc('Secure API key stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Gemini API Key');
                    this.plugin.getSecret(geminiSecretId, 'geminiApiKey').then(value => {
                        if (!value && geminiSecretId === 'schedule-assistant-gemini-api-key') {
                            this.plugin.getSecret('timeblocker-gemini-api-key', 'geminiApiKey').then(val => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(geminiSecretId, value.trim(), 'geminiApiKey');
                    });
                });
            const geminiBadge = createStatusBadge(geminiSetting.nameEl);
            (async () => {
                let geminiKey = await this.plugin.getSecret(geminiSecretId, 'geminiApiKey');
                if (!geminiKey && geminiSecretId === 'schedule-assistant-gemini-api-key') {
                    geminiKey = await this.plugin.getSecret('timeblocker-gemini-api-key', 'geminiApiKey');
                }
                if (!geminiKey) {
                    updateBadge(geminiBadge, false, 'Missing Gemini API Key');
                    return;
                }
                try {
                    const res = await requestWithTimeout({
                        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
                        method: 'GET'
                    });
                    if (res.status === 200) {
                        updateBadge(geminiBadge, true, 'Gemini API: Connected');
                    } else {
                        updateBadge(geminiBadge, false, 'Gemini API: Invalid Key');
                    }
                } catch(e) {
                    updateBadge(geminiBadge, false, 'Gemini API: Connection Error / Timeout');
                }
            })();

            // Todoist API Token (TextComponent as password)
            let todoistSecretId = this.plugin.settings.todoistTokenId || 'schedule-assistant-todoist-token';
            if (!this.plugin.settings.todoistTokenId) {
                this.plugin.settings.todoistTokenId = todoistSecretId;
                this.plugin.saveSettings();
            }
            const todoistSetting = new obsidian.Setting(containerEl)
                .setName('Todoist API Token')
                .setDesc('Secure Todoist API token stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Todoist API Token');
                    this.plugin.getSecret(todoistSecretId, 'todoistToken').then(value => {
                        if (!value && todoistSecretId === 'schedule-assistant-todoist-token') {
                            this.plugin.getSecret('timeblocker-todoist-token', 'todoistToken').then(val => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(todoistSecretId, value.trim(), 'todoistToken');
                    });
                });
            const todoistBadge = createStatusBadge(todoistSetting.nameEl);
            (async () => {
                let todoistToken = await this.plugin.getSecret(todoistSecretId, 'todoistToken');
                if (!todoistToken && todoistSecretId === 'schedule-assistant-todoist-token') {
                    todoistToken = await this.plugin.getSecret('timeblocker-todoist-token', 'todoistToken');
                }
                if (!todoistToken) {
                    updateBadge(todoistBadge, false, 'Missing Todoist API Token');
                    return;
                }
                try {
                    const res = await requestWithTimeout({
                        url: `https://api.todoist.com/api/v1/tasks?limit=1`,
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${todoistToken}` }
                    });
                    if (res.status === 200) {
                        updateBadge(todoistBadge, true, 'Todoist API: Connected');
                    } else {
                        updateBadge(todoistBadge, false, 'Todoist API: Invalid Token');
                    }
                } catch(e) {
                    updateBadge(todoistBadge, false, 'Todoist API: Connection Error / Timeout');
                }
            })();

            // Google Credentials JSON (TextComponent as password)
            let googleSecretId = this.plugin.settings.googleCredentialsId || 'schedule-assistant-google-credentials';
            if (!this.plugin.settings.googleCredentialsId) {
                this.plugin.settings.googleCredentialsId = googleSecretId;
                this.plugin.saveSettings();
            }
            const googleSetting = new obsidian.Setting(containerEl)
                .setName('Google Credentials JSON')
                .setDesc('Secure client credentials JSON string (from credentials.json) stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Google Credentials JSON');
                    this.plugin.getSecret(googleSecretId, 'googleCredentials').then(value => {
                        if (!value && googleSecretId === 'schedule-assistant-google-credentials') {
                            this.plugin.getSecret('timeblocker-google-credentials', 'googleCredentials').then(val => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(googleSecretId, value.trim(), 'googleCredentials');
                    });
                });
            const googleBadge = createStatusBadge(googleSetting.nameEl);
            (async () => {
                const fs = require('fs');
                const vaultPath = this.app.vault.adapter.getBasePath();
                const sep = vaultPath.includes('/') ? '/' : '\\';
                const tokenPath = `${vaultPath}${sep}.obsidian${sep}plugins${sep}schedule-assistant-focus-timer${sep}token.json`;
                if (!fs.existsSync(tokenPath)) {
                    updateBadge(googleBadge, false, 'Google Workspace: Disconnected (No token.json)');
                    return;
                }
                try {
                    const token = await this.plugin.getGoogleAccessToken();
                    const res = await requestWithTimeout({
                        url: `https://www.googleapis.com/tasks/v1/users/@me/lists`,
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.status === 200) {
                        updateBadge(googleBadge, true, 'Google Workspace: Connected');
                    } else {
                        updateBadge(googleBadge, false, 'Google Workspace: Auth Expired / Error');
                    }
                } catch(e) {
                    updateBadge(googleBadge, false, 'Google Workspace: Connection/Auth Error / Timeout');
                }
            })();

            // Google OAuth Connect Row & Collapsible guide
            const fs = require('fs');
            const vaultPath = this.app.vault.adapter.getBasePath();
            const sep = vaultPath.includes('/') ? '/' : '\\';
            const pluginDir = `${vaultPath}${sep}.obsidian${sep}plugins${sep}schedule-assistant-focus-timer`;
            const hasLocalCreds = fs.existsSync(`${pluginDir}${sep}credentials.json`);
            
            const authSetting = new obsidian.Setting(containerEl)
                .setName('Google Account Connection')
                .setDesc('Authorize Calendar, Tasks, and Health APIs directly via a frictionless browser flow.');

            authSetting.addButton(btn => {
                btn.setButtonText('Connect Google Account');
                btn.setCta();
                btn.setDisabled(true); // default to disabled while validating
                
                (async () => {
                    let hasKeyringCreds = await this.plugin.getSecret(googleSecretId, 'googleCredentials');
                    if (!hasKeyringCreds && googleSecretId === 'schedule-assistant-google-credentials') {
                        hasKeyringCreds = await this.plugin.getSecret('timeblocker-google-credentials', 'googleCredentials');
                    }
                    if (hasLocalCreds || hasKeyringCreds) {
                        btn.setDisabled(false);
                    }
                })();

                btn.onClick(async () => {
                    try {
                        await this.plugin.startGoogleOAuthFlow();
                    } catch(e) {
                        new obsidian.Notice("Failed to start Google OAuth flow: " + e.message);
                    }
                });
            });

            const details = containerEl.createEl('details');
            details.style.marginBottom = '20px';
            details.style.padding = '12px';
            details.style.border = '1px solid var(--background-modifier-border)';
            details.style.borderRadius = '6px';
            details.style.fontSize = '0.9em';
            details.style.backgroundColor = 'var(--background-secondary)';

            const summary = details.createEl('summary', { text: 'Google Cloud Console OAuth Setup Guide' });
            summary.style.fontWeight = 'bold';
            summary.style.cursor = 'pointer';
            summary.style.color = 'var(--text-accent)';

            const detailsBody = details.createDiv();
            detailsBody.style.marginTop = '10px';
            detailsBody.innerHTML = `
                <ol style="padding-left: 20px; color: var(--text-normal); margin-top: 6px; line-height: 1.4;">
                    <li>Go to the <a href="https://console.cloud.google.com/">Google Cloud Console</a> and create or select a project.</li>
                    <li>Enable the following APIs: <strong>Google Tasks API</strong>, <strong>Google Calendar API</strong>, <strong>Google Fitness API</strong>, and <strong>Google Health API</strong>.</li>
                    <li>Configure the <strong>OAuth consent screen</strong>:
                        <ul style="padding-left: 20px; list-style-type: circle; margin-top: 4px;">
                            <li>Set User Type to <strong>External</strong>.</li>
                            <li>Add scopes: <code>.../auth/calendar.readonly</code>, <code>.../auth/tasks</code>, <code>.../auth/fitness.sleep.read</code>, <code>.../auth/fitness.activity.read</code>, <code>.../auth/googlehealth.sleep.readonly</code>, and <code>.../auth/googlehealth.activity_and_fitness.readonly</code>.</li>
                            <li><strong>IMPORTANT:</strong> Set Publishing Status to <strong>"In Production"</strong>. If left in "Testing", Google will invalidate the token every 7 days!</li>
                        </ul>
                    </li>
                    <li>Go to <strong>Credentials</strong> > <strong>Create Credentials</strong> > <strong>OAuth client ID</strong>.
                        <ul style="padding-left: 20px; list-style-type: circle; margin-top: 4px;">
                            <li>Application type: <strong>Web application</strong></li>
                            <li>Authorized redirect URIs: <code>http://localhost:8092</code></li>
                        </ul>
                    </li>
                    <li>Download the credentials JSON, open it, copy its full content, and paste it into the <strong>Google Credentials JSON</strong> setting field above.</li>
                </ol>
            `;

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
                            this.plugin.settings.llmModel = 'gemini-2.5-flash';
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
                const ollamaSetting = new obsidian.Setting(containerEl)
                    .setName('Ollama Endpoint')
                    .setDesc('The base URL of your local Ollama server.')
                    .addText(text => text
                        .setPlaceholder('http://localhost:11434')
                        .setValue(this.plugin.settings.ollamaUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.ollamaUrl = value.trim();
                            await this.plugin.saveSettings();
                        }));
                
                const ollamaBadge = createStatusBadge(ollamaSetting.nameEl);
                (async () => {
                    const ollamaUrl = this.plugin.settings.ollamaUrl || 'http://localhost:11434';
                    try {
                        const res = await requestWithTimeout({
                            url: `${ollamaUrl}/api/tags`,
                            method: 'GET'
                        });
                        if (res.status === 200) {
                            updateBadge(ollamaBadge, true, 'Ollama Server: Online');
                        } else {
                            updateBadge(ollamaBadge, false, 'Ollama Server: Unavailable');
                        }
                    } catch(e) {
                        updateBadge(ollamaBadge, false, 'Ollama Server: Offline / Timeout');
                    }
                })();
            }

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
}const DEFAULT_SETTINGS = {
    defaultDuration: '20',
    autoApply: false,
    todoistToken: '',
    geminiApiKey: '',
    geminiApiKeyId: '',
    todoistTokenId: '',
    googleCredentialsId: '',
    googleCredentials: '',
    llmProvider: 'gemini',
    llmModel: 'gemini-2.5-flash',
    customModel: '',
    ollamaUrl: 'http://localhost:11434',
    enableServer: true,
    serverPort: '8089'
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
        await this.swallowGoogleCredentials();
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
        const durations = [5, 10, 15, 20, 25, 30, 45, 50, 60, 90, 120];
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

        // Add Add 1 Minute command
        this.addCommand({
            id: 'adjust-timer-plus-1m',
            name: 'Add 1 Minute to Active Focus Timer',
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                if (leaves.length > 0) {
                    const view = leaves[0].view;
                    if (view.currentTimer) {
                        view.adjustActiveTimer(1);
                    }
                }
            }
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

        // Commands for phone logger have been moved to omni-logger

        // Hook Settings Sidebar Organizer
        const setting = this.app.setting;
        if (setting && setting.open) {
            if (!setting.open.__antigravityHooked) {
                const originalOpen = setting.open;
                const plugin = this;
                setting.open = function() {
                    const result = originalOpen.apply(this, arguments);
                    setTimeout(() => {
                        // Dynamically call sidebar organizers for all loaded custom plugins
                        const activeOmni = plugin.app.plugins.getPlugin('omni-logger');
                        if (activeOmni && typeof activeOmni.organizeCustomPluginsSidebar === 'function') {
                            activeOmni.organizeCustomPluginsSidebar();
                        }
                        const activeTimer = plugin.app.plugins.getPlugin('schedule-assistant-focus-timer');
                        if (activeTimer && typeof activeTimer.organizeCustomPluginsSidebar === 'function') {
                            activeTimer.organizeCustomPluginsSidebar();
                        }
                    }, 50);
                    return result;
                };
                setting.open.__antigravityHooked = true;
                setting.open.__originalOpen = originalOpen;
            }
        }

        if (this.settings.enableServer !== false) {
            await this.startServer();
        }
    }

    async startGoogleOAuthFlow() {
        const fs = require('fs');
        const path = require('path');
        const http = require('http');
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const sep = vaultPath.includes('/') ? '/' : '\\';
        const pluginDir = `${vaultPath}${sep}.obsidian${sep}plugins${sep}schedule-assistant-focus-timer`;
        
        // 1. Get credentials from keychain/setting
        let googleSecretId = this.settings.googleCredentialsId || 'schedule-assistant-google-credentials';
        let credsStr = await this.getSecret(googleSecretId, 'googleCredentials');
        if (!credsStr) {
            credsStr = await this.getSecret('timeblocker-google-credentials', 'googleCredentials');
        }
        let credsData;
        if (credsStr) {
            try {
                credsData = JSON.parse(credsStr);
            } catch(e) {
                console.error("Failed to parse Google Credentials JSON from setting:", e);
            }
        }
        
        // 2. Fallback to physical credentials.json in plugin directory
        if (!credsData) {
            const credsPath = `${pluginDir}${sep}credentials.json`;
            if (fs.existsSync(credsPath)) {
                try {
                    credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                } catch(e) {
                    throw new Error(`Failed to parse credentials.json: ${e.message}`);
                }
            }
        }
        
        if (!credsData) {
            throw new Error("Google Credentials JSON not configured in settings, and credentials.json not found in plugin directory.");
        }
        
        const web = credsData.installed || credsData.web;
        if (!web) {
            throw new Error("Invalid Google Credentials format. Expected 'installed' or 'web' client configuration.");
        }
        
        const clientId = web.client_id;
        const clientSecret = web.client_secret;
        const redirectUri = "http://localhost:8092";
        
        const scopes = [
            "https://www.googleapis.com/auth/tasks",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/fitness.sleep.read",
            "https://www.googleapis.com/auth/fitness.activity.read",
            "https://www.googleapis.com/auth/fitness.sleep.read",
            "https://www.googleapis.com/auth/fitness.activity.read",
            "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
            "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"
        ].join(" ");
        
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `response_type=code` +
            `&client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(scopes)}` +
            `&access_type=offline` +
            `&prompt=consent`;
            
        if (this.tempOAuthServer) {
            try {
                this.tempOAuthServer.close();
            } catch(e) {}
        }
        
        this.tempOAuthServer = http.createServer(async (req, res) => {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const code = url.searchParams.get("code");
            
            if (code) {
                try {
                    const tokenUrl = "https://oauth2.googleapis.com/token";
                    const bodyDetails = {
                        code: code,
                        client_id: clientId,
                        client_secret: clientSecret,
                        redirect_uri: redirectUri,
                        grant_type: "authorization_code"
                    };
                    const body = Object.keys(bodyDetails)
                        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(bodyDetails[key]))
                        .join('&');
                        
                    const response = await obsidian.requestUrl({
                        url: tokenUrl,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: body
                    });
                    
                    if (response.status !== 200) {
                        throw new Error(`Token exchange failed: ${response.text}`);
                    }
                    
                    const tokenResponse = response.json;
                    const expiryDate = new Date();
                    expiryDate.setSeconds(expiryDate.getSeconds() + (tokenResponse.expires_in || 3600));
                    
                    const tokenData = {
                        token: tokenResponse.access_token,
                        expiry: expiryDate.toISOString(),
                        token_uri: tokenUrl,
                        client_id: clientId,
                        client_secret: clientSecret,
                        refresh_token: tokenResponse.refresh_token
                    };
                    
                    const tokenPath = `${pluginDir}${sep}token.json`;
                    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), 'utf8');
                    
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #1e1e1e; color: #fff;">
                            <h2 style="color: #00ffd0;">Authorization Successful!</h2>
                            <p>Google Tasks, Calendar, and Health are now connected to Schedule Assistant.</p>
                            <p>You can close this tab and return to Obsidian.</p>
                        </body>
                        </html>
                    `);
                    
                    new obsidian.Notice("Successfully authorized Google Workspace & Health API!");
                } catch (err) {
                    console.error("OAuth token exchange failed:", err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end("Authentication failed: " + err.message);
                    new obsidian.Notice("Google authorization failed: " + err.message);
                } finally {
                    setTimeout(() => {
                        if (this.tempOAuthServer) {
                            this.tempOAuthServer.close();
                            this.tempOAuthServer = null;
                        }
                    }, 1000);
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end("Authorization code missing.");
                setTimeout(() => {
                    if (this.tempOAuthServer) {
                        this.tempOAuthServer.close();
                        this.tempOAuthServer = null;
                    }
                }, 1000);
            }
        });
        
        this.tempOAuthServer.listen(8092, () => {
            console.log("Schedule Assistant OAuth temp server listening on port 8092");
            window.open(authUrl);
        });
        
        new obsidian.Notice("Opening browser to authorize Google Account...");
    }

    async runTaskLoader(autoApply = false) {
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
        
        // Retrieve secrets securely from Obsidian SecretStorage
        let geminiApiKey = await this.app.secretStorage.getSecret(this.settings.geminiApiKeyId || 'schedule-assistant-gemini-api-key') || '';
        if (!geminiApiKey) {
            geminiApiKey = await this.app.secretStorage.getSecret('timeblocker-gemini-api-key') || '';
        }
        let todoistToken = await this.app.secretStorage.getSecret(this.settings.todoistTokenId || 'schedule-assistant-todoist-token') || '';
        if (!todoistToken) {
            todoistToken = await this.app.secretStorage.getSecret('timeblocker-todoist-token') || '';
        }
        let googleCredentials = await this.app.secretStorage.getSecret(this.settings.googleCredentialsId || 'schedule-assistant-google-credentials') || '';
        if (!googleCredentials) {
            googleCredentials = await this.app.secretStorage.getSecret('timeblocker-google-credentials') || '';
        }
        
        const env = Object.assign({}, process.env, {
            GEMINI_API_KEY: geminiApiKey,
            TODOIST_API_TOKEN: todoistToken,
            GOOGLE_CREDENTIALS_JSON: googleCredentials
        });

        const dailyFile = this.getDailyNoteFile();
        if (dailyFile) {
            env.DAILY_NOTE_PATH = path.join(vaultPath, dailyFile.path);
        }
        
        const args = [scriptPath];
        if (autoApply) {
            args.push('--yes');
        }
        
        const child = spawn('python', args, { 
            cwd: pluginDir,
            env: env
        });
        
        const progressModal = new SchedulerProgressModal(this.app, child);
        progressModal.open();
        
        let stdout = '';
        let stderr = '';
        
        const runLogPath = path.join(pluginDir, 'scheduler_run.log');
        try {
            fs.writeFileSync(runLogPath, `=== Scheduler Execution Log - ${new Date().toISOString()} ===\n`, 'utf8');
        } catch (e) {
            console.error("Failed to init scheduler_run.log:", e);
        }

        child.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            console.log("[Scheduler stdout]:", text);
            try {
                fs.appendFileSync(runLogPath, `[STDOUT] ${text}`, 'utf8');
            } catch (e) {}
        });
        
        child.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            console.error("[Scheduler stderr]:", text);
            try {
                fs.appendFileSync(runLogPath, `[STDERR] ${text}`, 'utf8');
            } catch (e) {}
        });
        
        child.on('close', (code) => {
            progressModal.setCompleted();
            try {
                fs.appendFileSync(runLogPath, `=== Process Exited with Code ${code} ===\n`, 'utf8');
            } catch (e) {}
            if (code === 0) {
                new obsidian.Notice("Schedule generated and applied successfully!");
                console.log("Scheduler output:\n", stdout);
            } else {
                new obsidian.Notice(`Scheduler failed with exit code ${code}. Check console.`);
                console.error("Scheduler error output:\n", stderr);
            }
        });
    }

    async swallowGoogleCredentials() {
        const fs = require('fs');
        const path = require('path');
        const vaultPath = this.app.vault.adapter.getBasePath();
        const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
        const credsPath = path.join(pluginDir, 'credentials.json');
        
        if (fs.existsSync(credsPath)) {
            try {
                const credsJson = fs.readFileSync(credsPath, 'utf8');
                // Save JSON string to SecretStorage
                let googleSecretId = this.settings.googleCredentialsId || 'schedule-assistant-google-credentials';
                await this.setSecret(googleSecretId, credsJson.trim());
                
                // Backup and remove
                const bakPath = credsPath + '.bak';
                if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
                fs.renameSync(credsPath, bakPath);
                fs.unlinkSync(bakPath);
                
                new obsidian.Notice("Success: Swallowed Google OAuth Client Credentials into secure keychain!");
            } catch (e) {
                console.error("Failed to swallow Google credentials:", e);
            }
        }
    }

    parseAllTasks(content) {
        const lines = content.split(/\r?\n/);
        const tasks = [];
        const taskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
        let currentSubheading = "";
        let inPlanner = false;
        let currentProject = "";
        let lastParentTask = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isIndented = /^\s+/.test(line);

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
                    currentProject = "";
                    lastParentTask = null;
                    continue;
                }
                if (line.startsWith('##### ')) {
                    currentProject = line.replace(/^#####\s+/, '').trim();
                    lastParentTask = null;
                    continue;
                }
                
                const summaryMatch = line.match(/<summary>(?:<b>)?(.*?)(?:<\/b>)?<\/summary>/i);
                if (summaryMatch) {
                    currentProject = summaryMatch[1].trim();
                }
                if (line.includes("</details>")) {
                    currentProject = "";
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
                    description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                    description = description.replace(/#\w+/g, '').trim();
                    description = description.replace(/\s+/g, ' ').trim();
                    
                    const isCalendar = rawDesc.includes('[Calendar]');
                    let startMinutes = startH * 60 + startM;
                    let endMinutes = endH * 60 + endM;
                    if (startH < 5) startMinutes += 1440;
                    if (endH < 5) endMinutes += 1440;
                    if (endMinutes < startMinutes) {
                        endMinutes += 1440;
                    }
                    const duration = endMinutes - startMinutes;
                    
                    const taskObj = {
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
                        rawDesc: rawDesc,
                        isUntimed: false,
                        project: currentProject
                    };

                    tasks.push(taskObj);
                    if (!isIndented) {
                        lastParentTask = taskObj;
                    }
                } else {
                    const untimedRegex = /^\s*-\s+\[( |x|X)\]\s+(.*)$/;
                    const untimedMatch = line.match(untimedRegex);
                    if (untimedMatch && (!line.includes("BUTTON[") || line.includes("BUTTON[timer-"))) {
                        const status = (untimedMatch[1] === 'x' || untimedMatch[1] === 'X') ? 'completed' : 'pending';
                        const rawDesc = untimedMatch[2];
                        
                        let duration = null;
                        const durationMatch = rawDesc.match(/`?BUTTON\[timer-(\d+)\]`?/);
                        if (durationMatch) {
                            duration = parseInt(durationMatch[1]);
                        }
                        
                        let description = rawDesc.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                        description = description.replace(/\[src\]\(.*?\)/g, '').trim();
                        description = description.replace(/\s+src$/i, '').trim();
                        description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                        description = description.replace(/#\w+/g, '').trim();
                        description = description.replace(/\s+/g, ' ').trim();
                        
                        const taskObj = {
                            lineIndex: i,
                            originalLine: line,
                            status: status,
                            startHour: null,
                            startMin: null,
                            endHour: null,
                            endMin: null,
                            startMinutes: null,
                            endMinutes: null,
                            duration: duration,
                            description: description,
                            isCalendar: false,
                            subheading: currentSubheading,
                            rawDesc: rawDesc,
                            isUntimed: true,
                            project: currentProject
                        };

                        if (isIndented && lastParentTask) {
                            taskObj.parentLineIndex = lastParentTask.lineIndex;
                        }

                        tasks.push(taskObj);
                    }
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
        clickedDescription = clickedDescription.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
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

        if (task.isUntimed) {
            new obsidian.Notice("Untimed tasks cannot be postponed!");
            return;
        }

        const now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (now.getHours() < 5) {
            currentMinutes += 1440;
        }

        const busyIntervals = allTasks
            .filter(t => t.status !== 'completed' && !t.isUntimed && t.endMinutes > currentMinutes && t.lineIndex !== task.lineIndex)
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
        if (newEnd > 1740) {
            new obsidian.Notice("Cannot postpone: task would go past tomorrow morning!");
            return;
        }

        const newStartH = String(Math.floor(newStart / 60) % 24).padStart(2, '0');
        const newStartM = String(newStart % 60).padStart(2, '0');
        const newEndH = String(Math.floor(newEnd / 60) % 24).padStart(2, '0');
        const newEndM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

        const originalLine = lines[task.lineIndex];
        const oldTimeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[task.lineIndex] = normalizeTimeRangeSpaces(newLine);

        let inPlanner = false;
        let currentSubheading = "";
        const subheadingIndices = [];
        const fileTaskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;

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
                if (currentSubheading === task.subheading) {
                    if (fileTaskRegex.test(line)) {
                        subheadingIndices.push(i);
                    }
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
                let startMins = sh * 60 + sm;
                if (sh < 5) startMins += 1440;
                return {
                    line: line,
                    startMinutes: startMins
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
        this.stopServer();
        if (this.tempOAuthServer) {
            try {
                this.tempOAuthServer.close();
            } catch(e) {}
        }
    }

    async startServer(retryCount = 0) {
        await this.stopServer();
        
        let http;
        try {
            http = require('http');
        } catch (e) {
            console.log("Node http module is not available. Skipping remote server startup.");
            return;
        }

        const fs = require('fs');
        const path = require('path');
        const port = parseInt(this.settings.serverPort) || 8089;
        const vaultPath = this.app.vault.adapter.getBasePath();
        const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
        const webDir = path.join(pluginDir, 'web');

        this.server = http.createServer(async (req, res) => {

            const setCorsHeaders = () => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            };

            if (req.method === 'OPTIONS') {
                setCorsHeaders();
                res.writeHead(200);
                res.end();
                return;
            }

            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const pathname = url.pathname;

            try {
                if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/style.css' || pathname === '/app.js')) {
                    const file = pathname === '/' ? 'index.html' : pathname.substring(1);
                    const filePath = path.join(webDir, file);
                    if (fs.existsSync(filePath)) {
                        let contentType = 'text/plain';
                        if (file.endsWith('.html')) contentType = 'text/html';
                        else if (file.endsWith('.css')) contentType = 'text/css';
                        else if (file.endsWith('.js')) contentType = 'application/javascript';
                        
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': contentType });
                        res.end(fs.readFileSync(filePath));
                        return;
                    } else {
                        setCorsHeaders();
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end(`File ${file} not found in ${webDir}`);
                        return;
                    }
                }

                if (req.method === 'GET' && pathname === '/api/status') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeTimer = null;
                    let isAlarming = false;
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        activeTimer = view.currentTimer;
                        isAlarming = view.isAlarming;
                    }

                    const dailyFile = this.getDailyNoteFile();
                    let schedule = [];
                    let hasDailyNote = false;
                    let dateStr = "";
                    if (dailyFile) {
                        hasDailyNote = true;
                        try {
                            const content = await this.app.vault.read(dailyFile);
                            schedule = this.parseAllTasks(content);
                            const now = new Date();
                            dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                        } catch (e) {
                            console.error("Failed to read daily note in API:", e);
                        }
                    }

                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        hasDailyNote,
                        dateStr,
                        activeTimer: activeTimer ? {
                            taskName: activeTimer.taskName,
                            remainingSeconds: activeTimer.remainingSeconds,
                            totalSeconds: activeTimer.totalSeconds,
                            isPaused: activeTimer.isPaused,
                            status: activeTimer.task ? activeTimer.task.status : 'pending',
                            lineIndex: activeTimer.task ? activeTimer.task.lineIndex : null
                        } : null,
                        isAlarming,
                        schedule: schedule.map(t => ({
                            lineIndex: t.lineIndex,
                            status: t.status,
                            startHour: t.startHour,
                            startMin: t.startMin,
                            endHour: t.endHour,
                            endMin: t.endMin,
                            duration: t.duration,
                            description: t.description,
                            subheading: t.subheading ? t.subheading.replace(/^###\s+/, '') : "Agenda",
                            project: t.project || null
                        }))
                    }));
                    return;
                }

                const readBody = () => new Promise((resolve) => {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        try {
                            resolve(JSON.parse(body || '{}'));
                        } catch(e) {
                            resolve({});
                        }
                    });
                });

                if (req.method === 'POST' && pathname === '/api/timer/start') {
                    const body = await readBody();
                    await this.activateView();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        let matchedTask = null;
                        const dailyFile = this.getDailyNoteFile();
                        if (dailyFile) {
                            const content = await this.app.vault.read(dailyFile);
                            const tasks = this.parseAllTasks(content);
                            if (typeof body.lineIndex === 'number') {
                                matchedTask = tasks.find(t => t.lineIndex === body.lineIndex);
                            }
                            if (!matchedTask && body.taskName) {
                                matchedTask = tasks.find(t => t.description.toLowerCase() === body.taskName.toLowerCase());
                            }
                        }

                        const taskInput = matchedTask || body.taskName || "Focus Block";
                        const duration = parseInt(body.durationMinutes) || (matchedTask ? matchedTask.duration : null) || parseInt(this.settings.defaultDuration) || 20;
                        
                        await view.startTimer(taskInput, duration);
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/pause') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        if (view.currentTimer) {
                            if (!view.currentTimer.isPaused) {
                                await view.togglePause();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, isPaused: true }));
                        } else {
                            throw new Error("No timer currently active.");
                        }
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/resume') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        if (view.currentTimer) {
                            if (view.currentTimer.isPaused) {
                                await view.togglePause();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, isPaused: false }));
                        } else {
                            throw new Error("No timer currently active.");
                        }
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/complete') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        if (view.currentTimer || view.isAlarming) {
                            if (view.isAlarming) {
                                view.stopAlarm();
                            }
                            if (view.currentTimer) {
                                await view.completeTimer();
                            } else {
                                const dailyFile = this.getDailyNoteFile();
                                if (dailyFile) {
                                    const content = await this.app.vault.read(dailyFile);
                                    const tasks = this.parseAllTasks(content);
                                    const openTask = tasks.find(t => t.status !== 'completed');
                                    if (openTask) {
                                        await view.endActiveTask(openTask);
                                    }
                                }
                                view.renderSchedule();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else {
                            throw new Error("No active timer or alarm to complete.");
                        }
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/cancel') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        if (view.currentTimer) {
                            await view.cancelTimer();
                        }
                        if (view.isAlarming) {
                            view.stopAlarm();
                            view.renderSchedule();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/schedule/generate') {
                    this.runTaskLoader(true).catch(e => console.error("API schedule generation background task failed:", e));
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: "Schedule generation triggered successfully" }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/adjust') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        if (view.currentTimer) {
                            const mins = parseInt(body.minutes) || 5;
                            await view.adjustActiveTimer(mins);
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else {
                            throw new Error("No timer currently active to adjust.");
                        }
                    } else {
                        throw new Error("Focus timer view leaf not available.");
                    }
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/task/toggle') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        const dailyFile = this.getDailyNoteFile();
                        if (dailyFile) {
                            const content = await this.app.vault.read(dailyFile);
                            const tasks = this.parseAllTasks(content);
                            const task = tasks.find(t => t.lineIndex === body.lineIndex);
                            if (task) {
                                await view.toggleTaskCompletion(task, body.complete);
                                setCorsHeaders();
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: true }));
                                return;
                            }
                        }
                    }
                    throw new Error("Task not found or view not available.");
                }

                if (req.method === 'POST' && pathname === '/api/task/postpone') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    const view = leaves.length > 0 ? leaves[0].view : null;
                    const dailyFile = this.getDailyNoteFile();
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        const tasks = this.parseAllTasks(content);
                        const task = tasks.find(t => t.lineIndex === body.lineIndex);
                        if (task) {
                            if (view) {
                                if (view.currentTimer && view.currentTimer.task.lineIndex === task.lineIndex) {
                                    view.clearTimer();
                                    view.currentTimer = null;
                                    await this.logUpdate(false);
                                }
                                if (view.isAlarming) {
                                    view.stopAlarm();
                                }
                            }
                            await this.postponeTask(task);
                            if (view) {
                                view.renderSchedule();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                            return;
                        }
                    }
                    setCorsHeaders();
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: "Task not found or daily note not available." }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/task/drop') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    const view = leaves.length > 0 ? leaves[0].view : null;
                    if (view) {
                        await view.handleTaskDrop(body.draggedTask, body.targetSubheading);
                        view.renderSchedule();
                    } else {
                        const mockView = {
                            app: this.app,
                            plugin: this,
                            getDailyNoteFile: () => this.getDailyNoteFile(),
                            postponeTask: (t) => this.postponeTask(t),
                            removeTask: (t) => this.removeTask(t),
                            renderSchedule: () => {}
                        };
                        await TaskTimerView.prototype.handleTaskDrop.call(mockView, body.draggedTask, body.targetSubheading);
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/task/nottoday') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    const view = leaves.length > 0 ? leaves[0].view : null;
                    const dailyFile = this.getDailyNoteFile();
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        const tasks = this.parseAllTasks(content);
                        const task = tasks.find(t => t.lineIndex === body.lineIndex);
                        if (task) {
                            if (view) {
                                if (view.currentTimer && view.currentTimer.task.lineIndex === task.lineIndex) {
                                    view.clearTimer();
                                    view.currentTimer = null;
                                    await this.logUpdate(false);
                                }
                                if (view.isAlarming) {
                                    view.stopAlarm();
                                }
                            }
                            await this.removeTask(task);
                            if (view) {
                                view.renderSchedule();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                            return;
                        }
                    }
                    setCorsHeaders();
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: "Task not found or daily note not available." }));
                    return;
                }

                setCorsHeaders();
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end("Endpoint not found");

            } catch (err) {
                console.error("API error:", err);
                setCorsHeaders();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message || "Internal server error" }));
            }
        });

        this.server._sockets = new Set();
        this.server.on('connection', (socket) => {
            this.server._sockets.add(socket);
            socket.on('close', () => {
                this.server._sockets.delete(socket);
            });
        });
        
        let retries = retryCount;
        const maxRetries = 5;

        this.server.on('error', (err) => {
            console.error("Remote server startup failed:", err);
            if (err.code === 'EADDRINUSE' && retries < maxRetries) {
                const nextRetry = retries + 1;
                new obsidian.Notice(`Port ${port} in use, retrying in 1s (attempt ${nextRetry}/${maxRetries})...`);
                setTimeout(() => {
                    this.startServer(nextRetry);
                }, 1000);
            } else {
                new obsidian.Notice(`Focus Timer Server failed to start on port ${port}: ${err.message}`);
            }
        });

        this.server.listen(port, () => {
            console.log(`Focus Timer Server running on port ${port}`);
            new obsidian.Notice(`Focus Timer Server started on port ${port}`);
        });
    }

    stopServer() {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }
            let resolved = false;
            const done = () => {
                if (!resolved) {
                    resolved = true;
                    this.server = null;
                    resolve();
                }
            };
            const timeout = setTimeout(done, 1000);

            try {
                if (this.server._sockets) {
                    for (const socket of this.server._sockets) {
                        try { socket.destroy(); } catch(e) {}
                    }
                }
            } catch(e) { console.error("Socket destruction error", e); }
            
            try {
                if (typeof this.server.closeAllConnections === 'function') {
                    this.server.closeAllConnections();
                }
            } catch(e) { console.error("closeAllConnections error", e); }
            
            try {
                this.server.close((err) => {
                    clearTimeout(timeout);
                    if (err) {
                        console.error("Error callback stopping remote server:", err);
                    } else {
                        console.log("Focus Timer Server stopped successfully.");
                    }
                    done();
                });
            } catch(e) {
                console.error("Error stopping remote server:", e);
                clearTimeout(timeout);
                done();
            }
        });
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
                taskText = taskText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                
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
                    clickedDescription = clickedDescription.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
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
                if (lines[i].includes('### Focus Log')) {
                    logHeaderIndex = i;
                    break;
                }
            }
            if (logHeaderIndex === -1) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('## 🪵 Log')) {
                        logHeaderIndex = i;
                        break;
                    }
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
                lines.push('', '### Focus Log', logLine);
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
            
        const response = await Promise.race([
            obsidian.requestUrl({
                url: url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Google OAuth token refresh timed out")), 5000))
        ]);
        
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
        const url = `https://api.todoist.com/api/v1/tasks/${taskId}/${complete ? 'close' : 'reopen'}`;
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
        if (!currentTask || !lines[currentTask.lineIndex] || !lines[currentTask.lineIndex].toLowerCase().includes(task.description.toLowerCase().trim())) {
            // Find by description and pending status
            currentTask = allTasks.find(t => t.description.toLowerCase().trim() === task.description.toLowerCase().trim() && t.status === 'pending');
        }

        if (!currentTask) {
            new obsidian.Notice("Could not find the task in daily note!");
            return;
        }

        if (currentTask.isUntimed) {
            new obsidian.Notice("Untimed tasks cannot be postponed!");
            return;
        }

        const now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (now.getHours() < 5) {
            currentMinutes += 1440;
        }

        // Find all busy intervals after now (excluding the current task itself)
        const busyIntervals = allTasks
            .filter(t => t.status !== 'completed' && !t.isUntimed && t.endMinutes > currentMinutes && t.lineIndex !== currentTask.lineIndex)
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
        if (newEnd > 1740) {
            new obsidian.Notice("Cannot reschedule: task would go past tomorrow morning!");
            return;
        }

        const newStartH = String(Math.floor(newStart / 60) % 24).padStart(2, '0');
        const newStartM = String(newStart % 60).padStart(2, '0');
        const newEndH = String(Math.floor(newEnd / 60) % 24).padStart(2, '0');
        const newEndM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

        const originalLine = lines[currentTask.lineIndex];
        const oldTimeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[currentTask.lineIndex] = normalizeTimeRangeSpaces(newLine);

        // Re-sort within the subheading (e.g. Work, House, Admin)
        let inPlanner = false;
        let currentSubheading = "";
        const subheadingIndices = [];
        const fileTaskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;

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
                if (currentSubheading === currentTask.subheading) {
                    if (fileTaskRegex.test(line)) {
                        subheadingIndices.push(i);
                    }
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
                let startMins = sh * 60 + sm;
                if (sh < 5) startMins += 1440;
                return {
                    line: line,
                    startMinutes: startMins
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

    organizeCustomPluginsSidebar() {
        const settingModal = document.querySelector('.modal.mod-settings');
        if (!settingModal) return;
        
        const sidebar = settingModal.querySelector('.vertical-tab-header');
        if (!sidebar) return;
        
        const communitySection = sidebar.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');
        if (!communitySection) return;
        
        let folderContainer = communitySection.querySelector('.custom-plugins-folder-container');
        if (folderContainer) return; // Already organized
        
        const targetPluginIds = [
            'schedule-assistant-focus-timer',
            'omni-logger',
            'google-keep-sync',
            'grind-manager',
            'knowledge-pipeline',
            'git-logger'
        ];
        
        const targetElements = [];
        const navItems = communitySection.querySelectorAll('.vertical-tab-nav-item');
        navItems.forEach(item => {
            const id = item.getAttribute('data-setting-id');
            if (targetPluginIds.includes(id)) {
                targetElements.push(item);
            }
        });
        
        if (targetElements.length === 0) return;
        
        const folderHeader = document.createElement('div');
        folderHeader.className = 'vertical-tab-nav-item custom-plugins-folder-header';
        folderHeader.style.fontWeight = '600';
        folderHeader.style.cursor = 'pointer';
        folderHeader.style.display = 'flex';
        folderHeader.style.alignItems = 'center';
        folderHeader.style.justifyContent = 'space-between';
        folderHeader.style.padding = '8px 12px';
        folderHeader.style.marginTop = '8px';
        folderHeader.style.borderTop = '1px solid var(--background-modifier-border)';
        
        const headerTitle = document.createElement('span');
        headerTitle.textContent = '📦 Custom Plugins';
        folderHeader.appendChild(headerTitle);
        
        const chevron = document.createElement('span');
        chevron.textContent = '▼';
        chevron.style.fontSize = '0.75rem';
        chevron.style.transition = 'transform 0.2s ease';
        folderHeader.appendChild(chevron);
        
        folderContainer = document.createElement('div');
        folderContainer.className = 'custom-plugins-folder-container';
        folderContainer.style.transition = 'max-height 0.25s ease-out, opacity 0.2s ease';
        folderContainer.style.overflow = 'hidden';
        
        let isCollapsed = localStorage.getItem('custom-plugins-settings-collapsed') === 'true';
        if (isCollapsed) {
            folderContainer.style.maxHeight = '0px';
            folderContainer.style.opacity = '0';
            chevron.style.transform = 'rotate(-90deg)';
        } else {
            folderContainer.style.maxHeight = '500px';
            folderContainer.style.opacity = '1';
        }
        
        folderHeader.onclick = (e) => {
            e.stopPropagation();
            isCollapsed = !isCollapsed;
            localStorage.setItem('custom-plugins-settings-collapsed', isCollapsed);
            if (isCollapsed) {
                folderContainer.style.maxHeight = '0px';
                folderContainer.style.opacity = '0';
                chevron.style.transform = 'rotate(-90deg)';
            } else {
                folderContainer.style.maxHeight = '500px';
                folderContainer.style.opacity = '1';
                chevron.style.transform = 'rotate(0deg)';
            }
        };
        
        const firstTarget = targetElements[0];
        try {
            communitySection.insertBefore(folderHeader, firstTarget);
            communitySection.insertBefore(folderContainer, firstTarget);
        } catch(e) {
            console.warn("Failed to insert folder container: ", e);
        }
        
        targetElements.forEach(item => {
            item.style.paddingLeft = '24px';
            item.classList.add('custom-plugin-sub-item');
            try {
                folderContainer.appendChild(item);
            } catch(e) {
                console.warn("Failed to append item to folder container: ", e);
            }
        });
    }
};

class OmniLoggerModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.selectedType = 'calls';
        this.selectedMode = 'ocr';
        this.pastedImageBase64 = null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Omni-Logger: Consolidated Data Sync', cls: 'omni-modal-title' });
        
        const mainContainer = contentEl.createDiv({ cls: 'omni-modal-container' });
        
        // 1. Selector row
        const selectorRow = mainContainer.createDiv({ cls: 'omni-selector-row' });
        
        selectorRow.createSpan({ text: 'Log Type: ' });
        const typeSelect = selectorRow.createEl('select');
        typeSelect.createEl('option', { value: 'calls', text: 'Work Calls' });
        typeSelect.createEl('option', { value: 'lumosity', text: 'Lumosity Daily Scores' });
        typeSelect.createEl('option', { value: 'health', text: 'Google Health/Vitals' });
        typeSelect.value = this.selectedType;
        
        selectorRow.createSpan({ text: '  Mode: ' });
        const modeSelect = selectorRow.createEl('select');
        modeSelect.createEl('option', { value: 'ocr', text: 'Clipboard / OCR' });
        modeSelect.createEl('option', { value: 'api', text: 'Direct API Payload' });
        modeSelect.value = this.selectedMode;

        // 2. Clipboard Drag & Drop Zone
        const dropZone = mainContainer.createDiv({ cls: 'omni-drop-zone' });
        dropZone.createEl('p', { text: 'Paste screenshot (Ctrl+V) or click to upload', cls: 'omni-drop-text' });
        
        const fileInput = dropZone.createEl('input', { type: 'file', accept: 'image/*' });
        fileInput.style.display = 'none';
        
        dropZone.onclick = () => fileInput.click();
        
        // Image preview
        const previewContainer = mainContainer.createDiv({ cls: 'omni-preview-container', style: 'display:none;' });
        const previewImg = previewContainer.createEl('img', { cls: 'omni-preview-image' });
        
        // Form trigger/API elements
        const formContainer = mainContainer.createDiv({ cls: 'omni-form-container', style: 'display:none;' });
        
        // Mode toggle styling/visibility helper
        const updateVisibility = () => {
            this.selectedType = typeSelect.value;
            this.selectedMode = modeSelect.value;
            
            if (this.selectedMode === 'ocr') {
                dropZone.style.display = 'flex';
                if (this.pastedImageBase64) {
                    previewContainer.style.display = 'block';
                    dropZone.style.display = 'none';
                } else {
                    previewContainer.style.display = 'none';
                }
                formContainer.style.display = 'none';
            } else {
                dropZone.style.display = 'none';
                previewContainer.style.display = 'none';
                formContainer.style.display = 'block';
                formContainer.empty();
                
                if (this.selectedType === 'health') {
                    formContainer.createEl('p', { text: 'Pulls Sleep hours and wake up time directly from Google Health APIs.' });
                } else {
                    formContainer.createEl('p', { text: 'Direct API payload is not supported for this category. Please use Clipboard / OCR mode.' });
                }
            }
        };

        typeSelect.onchange = updateVisibility;
        modeSelect.onchange = updateVisibility;
        
        // File processing handler
        const handleImageFile = (file) => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.pastedImageBase64 = reader.result;
                previewImg.src = reader.result;
                previewContainer.style.display = 'block';
                dropZone.style.display = 'none';
            };
            reader.readAsDataURL(file);
        };
        
        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                handleImageFile(e.target.files[0]);
            }
        };
        
        // Listen to paste event globally inside modal
        this.pasteListener = (evt) => {
            if (this.selectedMode !== 'ocr') return;
            const items = (evt.clipboardData || evt.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    handleImageFile(file);
                    break;
                }
            }
        };
        
        contentEl.addEventListener('paste', this.pasteListener);
        
        // 3. Action and status bar
        const statusBar = mainContainer.createDiv({ cls: 'omni-status-bar', text: 'Status: Ready' });
        
        const actionRow = mainContainer.createDiv({ cls: 'omni-action-row' });
        const cancelBtn = actionRow.createEl('button', { text: 'Cancel', cls: 'omni-btn btn-cancel' });
        cancelBtn.onclick = () => this.close();
        
        const processBtn = actionRow.createEl('button', { text: 'Process & Log', cls: 'omni-btn btn-process' });
        processBtn.onclick = async () => {
            statusBar.setText('Processing... please wait.');
            processBtn.disabled = true;
            try {
                if (this.selectedMode === 'ocr') {
                    if (!this.pastedImageBase64) {
                        new obsidian.Notice("Please paste or upload an image first!");
                        statusBar.setText('Error: No image provided.');
                        processBtn.disabled = false;
                        return;
                    }
                    
                    // Extract base64 part
                    const base64Data = this.pastedImageBase64.split(',')[1];
                    const mimeType = this.pastedImageBase64.split(',')[0].split(':')[1].split(';')[0];
                    
                    // Call backend OCR processor
                    await this.plugin.processOCR(base64Data, mimeType, this.selectedType);
                    statusBar.setText('Successfully logged data from OCR!');
                    new obsidian.Notice("Successfully logged scores/counts to Daily Note!");
                    setTimeout(() => this.close(), 1500);
                } else {
                    // API Pull mode
                    if (this.selectedType === 'health') {
                        statusBar.setText('Calling Google Health API...');
                        await this.plugin.pullGoogleHealthData();
                        statusBar.setText('Successfully pulled Google Health data!');
                        new obsidian.Notice("Successfully synced health stats from Google API!");
                        setTimeout(() => this.close(), 1500);
                    } else {
                        statusBar.setText('Unsupported configuration.');
                        processBtn.disabled = false;
                    }
                }
            } catch (err) {
                console.error("Omni-Logger failed:", err);
                statusBar.setText('Error: ' + err.message);
                processBtn.disabled = false;
            }
        };
    }

    onClose() {
        if (this.pasteListener) {
            this.contentEl.removeEventListener('paste', this.pasteListener);
        }
        this.contentEl.empty();
    }
}

class SchedulerProgressModal extends obsidian.Modal {
    constructor(app, childProcess) {
        super(app);
        this.childProcess = childProcess;
        this.isCompleted = false;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h3', { text: 'Generating Daily Schedule', style: 'text-align: center; margin-bottom: 20px;' });
        
        const loaderContainer = contentEl.createDiv({ style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;' });
        
        const spinner = loaderContainer.createDiv({ cls: 'scheduler-spinner' });
        spinner.style.width = '40px';
        spinner.style.height = '40px';
        spinner.style.border = '4px solid var(--background-modifier-border)';
        spinner.style.borderTop = '4px solid var(--text-accent)';
        spinner.style.borderRadius = '50%';
        spinner.style.animation = 'spin 1s linear infinite';
        
        if (!document.getElementById('scheduler-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'scheduler-spinner-style';
            style.innerHTML = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        loaderContainer.createDiv({ 
            text: 'Schedule Assistant is creating your day plan...', 
            style: 'margin-top: 20px; font-weight: 500; color: var(--text-normal); font-size: 1.1em;' 
        });
        
        loaderContainer.createDiv({ 
            text: 'This pulls tasks from Google Tasks, Google Calendar, and Todoist, then builds a smart timeline using Gemini.', 
            style: 'margin-top: 10px; font-size: 0.9em; color: var(--text-muted); text-align: center; max-width: 300px;' 
        });
        
        const cancelBtn = loaderContainer.createEl('button', { text: 'Cancel Process', style: 'margin-top: 25px;' });
        cancelBtn.onclick = () => {
            if (this.childProcess && !this.isCompleted) {
                this.childProcess.kill();
                new obsidian.Notice("Schedule generation cancelled.");
            }
            this.close();
        };
    }
    
    setCompleted() {
        this.isCompleted = true;
        this.close();
    }
    
    onClose() {
        this.contentEl.empty();
    }
}
