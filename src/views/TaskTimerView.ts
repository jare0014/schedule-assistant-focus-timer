/**
 * TaskTimerView.ts - Main ItemView for focus timer, schedule timeline, and alarms.
 */

import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { VIEW_TYPE_TASK_TIMER, TaskItem } from '../types';
import { DailyNoteManager } from '../services/DailyNoteManager';
import { WeeklyHabitService } from '../services/WeeklyHabitService';
import { TaskParserService } from '../services/TaskParserService';
import { FocusAudioService, FocusTrackItem } from '../services/FocusAudioService';
import { renderScheduleGridView } from './ScheduleGridView';

export class TaskTimerView extends ItemView {
    public plugin: any;
    public currentTimer: any = null;
    public timerInterval: any = null;
    public isAlarming = false;
    public scheduleViewMode: 'grid' | 'list' = 'grid';
    public gridZoomLevel = 60;
    public resetScrollToFocus = false;

    private timeTextEl: HTMLElement | null = null;
    private pauseBtn: HTMLButtonElement | null = null;
    private audioUnsubscribe: (() => void) | null = null;
    private hostedMediaInterval: any = null;

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_TASK_TIMER;
    }

    getDisplayText(): string {
        return 'Focus Timer & Schedule';
    }

    getIcon(): string {
        return 'clock';
    }

    async onOpen(): Promise<void> {
        this.renderSchedule();
    }

    async onClose(): Promise<void> {
        if (this.audioUnsubscribe) {
            this.audioUnsubscribe();
            this.audioUnsubscribe = null;
        }
        if (this.hostedMediaInterval !== null) {
            window.clearInterval(this.hostedMediaInterval);
            this.hostedMediaInterval = null;
        }
        this.clearTimer();
        this.stopAlarm();
    }

    public getDailyNoteFile(): TFile | null {
        return DailyNoteManager.getDailyNoteFile(this.app);
    }

    public renderSchedule(): void {
        const container = (this.containerEl ? (this.containerEl.children[1] || this.contentEl) : this.contentEl) as HTMLElement;
        if (!container) return;
        container.empty();
        container.addClass('task-timer-view-container');

        if (this.currentTimer || this.plugin.activeTimer) {
            this.renderTimer();
        } else {
            this.renderScheduleTimeline(container);
        }
    }

    public renderIdleView(viewContainer: HTMLElement): void {
        const idleContainer = viewContainer.createDiv({ cls: 'timer-idle-container' });
        const iconDiv = idleContainer.createDiv({ cls: 'timer-idle-icon' });
        iconDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        idleContainer.createDiv({ cls: 'timer-idle-title', text: "No Active Task" });
        idleContainer.createDiv({ cls: 'timer-idle-desc', text: "Select a task from your Day Planner inside today's daily note to start a focus timer." });
    }

    public async renderScheduleGridView(viewContainer: HTMLElement, tasks: TaskItem[]): Promise<void> {
        return renderScheduleGridView(this, viewContainer, tasks);
    }

    public async renderScheduleTimeline(viewContainer: HTMLElement): Promise<void> {
        const header = viewContainer.createDiv({ cls: 'task-timer-header' });
        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        header.createEl('h3', { text: dateStr });

        const controlsContainer = header.createDiv({ cls: 'task-timer-header-controls' });
        const viewToggle = controlsContainer.createDiv({ cls: 'view-mode-toggle' });
        const gridBtn = viewToggle.createEl('button', {
            cls: `view-mode-btn${this.scheduleViewMode === 'grid' ? ' active' : ''}`,
            text: '📅 Grid'
        });
        const listBtn = viewToggle.createEl('button', {
            cls: `view-mode-btn${this.scheduleViewMode === 'list' ? ' active' : ''}`,
            text: '📋 List'
        });

        gridBtn.onclick = () => {
            this.scheduleViewMode = 'grid';
            this.renderSchedule();
        };
        listBtn.onclick = () => {
            this.scheduleViewMode = 'list';
            this.renderSchedule();
        };

        if (this.scheduleViewMode === 'grid') {
            const zoomGroup = controlsContainer.createDiv({ cls: 'timescale-zoom-group' });
            const zoomOutBtn = zoomGroup.createEl('button', { cls: 'zoom-btn', text: '🔍−', title: 'Zoom Out (Compact)' });
            zoomGroup.createEl('span', { cls: 'zoom-label', text: `${this.gridZoomLevel}px/h` });
            const zoomInBtn = zoomGroup.createEl('button', { cls: 'zoom-btn', text: '🔍+', title: 'Zoom In (Expanded)' });
            const focusBtn = zoomGroup.createEl('button', { cls: 'zoom-btn', text: '🎯 Focus', title: 'Focus Next 3 Hours (Expanded)' });

            zoomOutBtn.onclick = () => {
                this.gridZoomLevel = Math.max(40, this.gridZoomLevel - 20);
                this.renderSchedule();
            };
            zoomInBtn.onclick = () => {
                this.gridZoomLevel = Math.min(240, this.gridZoomLevel + 20);
                this.renderSchedule();
            };
            focusBtn.onclick = () => {
                this.gridZoomLevel = 130;
                this.resetScrollToFocus = true;
                this.renderSchedule();
            };
        }

        const genBtn = controlsContainer.createEl('button', { cls: 'auto-block-btn', text: 'Generate Schedule' });
        genBtn.onclick = () => {
            this.plugin.runTaskLoader();
        };

        // Hosted Media Card at the top of schedule view outside active focus sessions
        this.renderHostedMediaCard(viewContainer);

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

        const tasks = TaskParserService.parseAllTasks(content);
        if (tasks.length === 0) {
            this.renderIdleView(viewContainer);
            return;
        }

        if (this.scheduleViewMode === 'grid') {
            await this.renderScheduleGridView(viewContainer, tasks);
            return;
        }

        // List Mode
        const groupedTasks: Record<string, TaskItem[]> = {};
        tasks.forEach(t => {
            const subheading = t.subheading || "Agenda";
            if (!groupedTasks[subheading]) groupedTasks[subheading] = [];
            groupedTasks[subheading].push(t);
        });

        const listContainer = viewContainer.createDiv({ cls: 'schedule-list' });

        for (const subheading in groupedTasks) {
            const cleanSubheading = subheading.replace(/^###\s+/, '');
            listContainer.createDiv({ cls: 'schedule-subheading', text: cleanSubheading });

            const groupSection = listContainer.createDiv({ cls: 'schedule-group-section' });
            groupSection.setAttribute('data-subheading', subheading);

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
                    const data = JSON.parse(e.dataTransfer?.getData("text/plain") || '{}');
                    await this.handleTaskDrop(data, subheading);
                } catch (err) {
                    console.error("Drop parsing failed:", err);
                }
            };

            const isUntimedSubheading = subheading.includes("☁️") || subheading.toLowerCase().includes("micro-task") || subheading.toLowerCase().includes("untimed");

            if (isUntimedSubheading) {
                const projectGroups: Record<string, TaskItem[]> = {};
                groupedTasks[subheading].forEach(task => {
                    const proj = task.project || "Other Tasks";
                    if (!projectGroups[proj]) projectGroups[proj] = [];
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
                            e.dataTransfer?.setData("text/plain", JSON.stringify({
                                lineIndex: task.lineIndex,
                                description: task.description,
                                isUntimed: task.isUntimed
                            }));
                        };

                        const left = card.createDiv({ cls: 'task-card-left' });
                        left.createDiv({ cls: 'task-card-time', text: 'Untimed' });
                        left.createDiv({ cls: 'task-card-name', text: task.description });

                        const right = card.createDiv({ cls: 'task-card-controls' });
                        const cb = right.createEl('input', { type: 'checkbox' });
                        cb.checked = task.status === 'completed';
                        cb.onclick = async (e) => {
                            e.stopPropagation();
                            await this.toggleTaskCompletion(task, cb.checked);
                        };

                        if (task.status !== 'completed') {
                            [5, 10, 15, 20].forEach(m => {
                                const btn = right.createEl('button', {
                                    cls: 'task-card-quick-timer-btn',
                                    text: `${m}m`,
                                    title: `Start ${m}m timer`
                                });
                                btn.onclick = () => this.startTimer(task, m);
                            });
                        }

                        const delBtn = right.createEl('button', { cls: 'task-card-delete-btn', title: 'Not Today' });
                        delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                        delBtn.onclick = async () => {
                            await DailyNoteManager.removeTask(this.app, task);
                            this.renderSchedule();
                        };
                    });
                }
            } else {
                groupedTasks[subheading].forEach(task => {
                    if (task.parentLineIndex !== undefined) return;

                    const card = groupSection.createDiv({
                        cls: `task-card${task.status === 'completed' ? ' completed' : ''}`
                    });

                    card.setAttribute('draggable', 'true');
                    card.ondragstart = (e) => {
                        e.dataTransfer?.setData("text/plain", JSON.stringify({
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
                    const cb = right.createEl('input', { type: 'checkbox' });
                    cb.checked = task.status === 'completed';
                    cb.onclick = async (e) => {
                        e.stopPropagation();
                        await this.toggleTaskCompletion(task, cb.checked);
                    };

                    if (task.status !== 'completed') {
                        if (task.isUntimed) {
                            [5, 10, 15, 20].forEach(m => {
                                const btn = right.createEl('button', {
                                    cls: 'task-card-quick-timer-btn',
                                    text: `${m}m`,
                                    title: `Start ${m}m timer`
                                });
                                btn.onclick = () => this.startTimer(task, m);
                            });
                        } else {
                            const isCurrentActive = Boolean(this.currentTimer && (
                                (this.currentTimer.task && this.currentTimer.task.lineIndex === task.lineIndex) ||
                                (this.currentTimer.taskName && this.currentTimer.taskName.toLowerCase().trim() === task.description.toLowerCase().trim())
                            ));
                            const isTimerPaused = Boolean(this.currentTimer?.isPaused);

                            const playBtn = right.createEl('button', {
                                cls: `task-card-play-btn${isCurrentActive ? (isTimerPaused ? ' is-paused' : ' is-active') : ''}`,
                                title: isCurrentActive ? (isTimerPaused ? 'Resume Timer' : 'Pause Timer') : 'Start Timer'
                            });
                            if (isCurrentActive && !isTimerPaused) {
                                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                            } else {
                                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                            }
                            playBtn.onclick = async () => {
                                if (isCurrentActive) {
                                    await this.togglePause();
                                    this.renderSchedule();
                                } else {
                                    this.startTimer(task, task.duration || parseInt(this.plugin.settings.defaultDuration));
                                }
                            };

                            const postBtn = right.createEl('button', { cls: 'task-card-postpone-btn', title: 'Postpone' });
                            postBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                            postBtn.onclick = async () => {
                                await DailyNoteManager.postponeTask(this.app, task);
                                this.renderSchedule();
                            };
                        }
                    }

                    const delBtn = right.createEl('button', { cls: 'task-card-delete-btn', title: 'Not Today' });
                    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                    delBtn.onclick = async () => {
                        await DailyNoteManager.removeTask(this.app, task);
                        this.renderSchedule();
                    };

                    const subtasks = groupedTasks[subheading].filter(t => t.parentLineIndex === task.lineIndex);
                    if (subtasks.length > 0) {
                        const subtasksContainer = card.createDiv({ cls: 'task-card-subtasks' });
                        subtasks.forEach(subtask => {
                            const subtaskEl = subtasksContainer.createDiv({
                                cls: `task-subtask-item${subtask.status === 'completed' ? ' completed' : ''}`
                            });
                            const subLeft = subtaskEl.createDiv({ cls: 'task-subtask-left' });
                            const subCb = subLeft.createEl('input', { type: 'checkbox' });
                            subCb.checked = subtask.status === 'completed';
                            subCb.onclick = async (e) => {
                                e.stopPropagation();
                                await this.toggleTaskCompletion(subtask, subCb.checked);
                            };
                            subLeft.createDiv({ cls: 'task-subtask-name', text: subtask.description });

                            const subRight = subtaskEl.createDiv({ cls: 'task-subtask-controls' });
                            if (subtask.status !== 'completed') {
                                const isSubActive = Boolean(this.currentTimer && (
                                    (this.currentTimer.task && this.currentTimer.task.lineIndex === subtask.lineIndex) ||
                                    (this.currentTimer.taskName && this.currentTimer.taskName.toLowerCase().trim() === subtask.description.toLowerCase().trim())
                                ));
                                const isSubPaused = Boolean(this.currentTimer?.isPaused);

                                const playBtn = subRight.createEl('button', {
                                    cls: `task-subtask-play-btn${isSubActive ? (isSubPaused ? ' is-paused' : ' is-active') : ''}`,
                                    title: isSubActive ? (isSubPaused ? 'Resume Timer' : 'Pause Timer') : 'Start Timer'
                                });
                                if (isSubActive && !isSubPaused) {
                                    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                                } else {
                                    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                                }
                                playBtn.onclick = async () => {
                                    if (isSubActive) {
                                        await this.togglePause();
                                        this.renderSchedule();
                                    } else {
                                        this.startTimer(subtask, subtask.duration || parseInt(this.plugin.settings.defaultDuration));
                                    }
                                };
                            }
                        });
                    }
                });
            }
        }
    }

    public async toggleTaskCompletion(task: TaskItem, complete: boolean): Promise<void> {
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
                new Notice("Could not find the task in daily note!");
                return;
            }
            const originalLine = lines[lineIndex];

            if (complete) {
                lines[lineIndex] = originalLine.replace('- [ ]', '- [x]').replace('- [/]', '- [x]');
            } else {
                lines[lineIndex] = originalLine.replace('- [x]', '- [ ]');
            }

            const parentIndent = originalLine.match(/^(\s*)/)![1].length;
            for (let i = lineIndex + 1; i < lines.length; i++) {
                const childLine = lines[i];
                if (!childLine.trim()) continue;
                const childIndent = childLine.match(/^(\s*)/)![1].length;
                if (childIndent <= parentIndent) break;
                if (childLine.includes('- [ ]') || childLine.includes('- [x]') || childLine.includes('- [/]')) {
                    if (complete) {
                        lines[i] = childLine.replace('- [ ]', '- [x]').replace('- [/]', '- [x]');
                    } else {
                        lines[i] = childLine.replace('- [x]', '- [ ]');
                    }
                }
            }

            if (this.plugin.externalTaskSyncService) {
                await this.plugin.externalTaskSyncService.toggleTaskStatusByLineText(originalLine, complete);
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));
            this.renderSchedule();
        } catch (e) {
            console.error("Failed to toggle task completion:", e);
        }
    }

    public async deleteTaskBlock(task: TaskItem): Promise<void> {
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
                new Notice("Could not find task in daily note!");
                return;
            }

            const parentIndent = lines[lineIndex].match(/^(\s*)/)![1].length;
            let endIndex = lineIndex + 1;
            while (endIndex < lines.length) {
                const childLine = lines[endIndex];
                if (!childLine.trim()) { endIndex++; continue; }
                const childIndent = childLine.match(/^(\s*)/)![1].length;
                if (childIndent <= parentIndent) break;
                endIndex++;
            }

            lines.splice(lineIndex, endIndex - lineIndex);
            await this.app.vault.modify(dailyFile, lines.join('\n'));
            new Notice(`Removed: ${task.description}`);
            this.renderSchedule();
        } catch (e) {
            console.error("Failed to delete task block:", e);
        }
    }

    public async handleTaskDrop(draggedTask: any, targetSubheading: string): Promise<void> {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);
            const allTasks = TaskParserService.parseAllTasks(content);

            let lineIndex = draggedTask.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].toLowerCase().includes(draggedTask.description.toLowerCase().trim())) {
                lineIndex = lines.findIndex(l => l.toLowerCase().includes(draggedTask.description.toLowerCase().trim()) && (l.includes('- [ ]') || l.includes('- [x]') || l.includes('- [/]')));
            }

            if (lineIndex === -1) {
                new Notice("Could not find the task in daily note!");
                return;
            }

            const targetIsUntimed = targetSubheading.includes("☁️") || targetSubheading.toLowerCase().includes("micro-task") || targetSubheading.toLowerCase().includes("untimed");
            const sourceIsUntimed = draggedTask.isUntimed;

            if (targetIsUntimed === sourceIsUntimed) return;

            let lineText = lines[lineIndex];
            lines.splice(lineIndex, 1);

            const oldTimeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;

            if (targetIsUntimed) {
                lineText = lineText.replace(oldTimeRangeRegex, "").trim();
                lineText = lineText.replace(/`?BUTTON\[timer-\d+\]`?/g, "").trim();
                lineText = lineText.replace(/-\s+\[( |x|X)\]\s+/, "- [$1] ");
            } else {
                const now = new Date();
                let currentMinutes = now.getHours() * 60 + now.getMinutes();
                if (now.getHours() < 5) currentMinutes += 1440;

                const busyIntervals = allTasks
                    .filter(t => t.status !== 'completed' && !t.isUntimed && (t.endMinutes || 0) > currentMinutes && t.lineIndex !== lineIndex)
                    .map(t => ({
                        start: t.startMinutes || 0,
                        end: t.endMinutes || 0
                    }));

                busyIntervals.sort((a, b) => a.start - b.start);

                let newStart = currentMinutes;
                const duration = 20;

                for (const interval of busyIntervals) {
                    if (interval.start - newStart >= duration) break;
                    newStart = Math.max(newStart, interval.end);
                }

                const newEnd = newStart + duration;
                if (newEnd > 1740) {
                    new Notice("Cannot reschedule: task would go past tomorrow morning!");
                    return;
                }

                const newStartH = String(Math.floor(newStart / 60) % 24).padStart(2, '0');
                const newStartM = String(newStart % 60).padStart(2, '0');
                const newEndH = String(Math.floor(newEnd / 60) % 24).padStart(2, '0');
                const newEndM = String(newEnd % 60).padStart(2, '0');
                const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

                lineText = lineText.replace(/(-\s+\[(?: |x|X)\]\s+)(.*)/, `$1${newTimeRange} $2 \`BUTTON[timer-20]\``);
            }

            lineText = DailyNoteManager.normalizeTimeRangeSpaces(lineText);

            let targetSubheadingIndex = lines.findIndex(l => l.trim().includes(targetSubheading));
            if (targetSubheadingIndex === -1) {
                targetSubheadingIndex = lines.findIndex(l => l.toLowerCase().includes(targetSubheading.toLowerCase().trim()));
            }

            if (targetSubheadingIndex === -1) {
                lines.push(lineText);
                new Notice(`Added task to end of note.`);
            } else {
                let insertIndex = targetSubheadingIndex + 1;
                while (insertIndex < lines.length) {
                    const l = lines[insertIndex];
                    if (l.startsWith('##') || l.startsWith('---')) break;
                    insertIndex++;
                }
                lines.splice(insertIndex, 0, lineText);
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));
            this.renderSchedule();
            new Notice(`Moved task to ${targetIsUntimed ? 'Micro-Tasks' : 'Focus Blocks'}`);
        } catch (e) {
            console.error("Failed to drag and drop task:", e);
        }
    }

    public async rescheduleTaskOnGrid(draggedTask: any, newStartMins: number, newEndMins: number): Promise<void> {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return;

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);

            let lineIndex = draggedTask.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].toLowerCase().includes(draggedTask.description.toLowerCase().trim())) {
                lineIndex = lines.findIndex(l => l.toLowerCase().includes(draggedTask.description.toLowerCase().trim()) && (l.includes('- [ ]') || l.includes('- [x]') || l.includes('- [/]')));
            }

            if (lineIndex === -1) {
                new Notice("Could not find task in daily note!");
                return;
            }

            const startH = String(Math.floor(newStartMins / 60) % 24).padStart(2, '0');
            const startM = String(newStartMins % 60).padStart(2, '0');
            const endH = String(Math.floor(newEndMins / 60) % 24).padStart(2, '0');
            const endM = String(newEndMins % 60).padStart(2, '0');
            const newTimeRange = `${startH}:${startM} - ${endH}:${endM}`;
            const timeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;

            // If task was already timed/scheduled in the note, update its time range IN-PLACE to preserve section/callout context
            if (!draggedTask.isUntimed) {
                let currentLine = lines[lineIndex];
                if (timeRangeRegex.test(currentLine)) {
                    currentLine = currentLine.replace(timeRangeRegex, newTimeRange);
                } else {
                    currentLine = currentLine.replace(/^(\s*(?:>\s*)?-\s+\[[ xX/]\]\s+)(.*)$/, `$1${newTimeRange} $2`);
                }
                lines[lineIndex] = DailyNoteManager.normalizeTimeRangeSpaces(currentLine);
            } else {
                // Untimed task dragged from drawer onto timed grid: extract atomic block safely
                const parentLine = lines[lineIndex];
                const rawIndentMatch = parentLine.match(/^(\s*(?:>\s*)?)/);
                const parentIndent = rawIndentMatch ? rawIndentMatch[1].length : 0;
                
                let endIndex = lineIndex + 1;
                let inCodeFence = false;
                while (endIndex < lines.length) {
                    const childLine = lines[endIndex];
                    const trimmed = childLine.trim();

                    // 1. Boundary stop: Heading or Horizontal Rule
                    if (!inCodeFence && (trimmed.startsWith('#') || trimmed === '---' || trimmed === '***')) {
                        break;
                    }

                    // 2. Code fence boundary tracking (dataviewjs, focus-matrix, etc.)
                    if (trimmed.startsWith('```')) {
                        inCodeFence = !inCodeFence;
                        endIndex++;
                        continue;
                    }
                    if (inCodeFence) {
                        endIndex++;
                        continue;
                    }

                    // 3. Blank lines
                    if (!trimmed) {
                        let nextNonBlank = endIndex + 1;
                        while (nextNonBlank < lines.length && !lines[nextNonBlank].trim()) nextNonBlank++;
                        if (nextNonBlank < lines.length) {
                            const nextTrimmed = lines[nextNonBlank].trim();
                            const nextRaw = lines[nextNonBlank].match(/^(\s*(?:>\s*)?)/);
                            const nextIndent = nextRaw ? nextRaw[1].length : 0;
                            if (nextIndent > parentIndent || nextTrimmed.startsWith('```') || nextTrimmed.startsWith('![[')) {
                                endIndex = nextNonBlank;
                                continue;
                            }
                        }
                        break;
                    }

                    // 4. Adjacent sibling tasks at equal or shallower indentation stop block
                    const childRaw = childLine.match(/^(\s*(?:>\s*)?)/);
                    const childIndent = childRaw ? childRaw[1].length : 0;
                    if (childIndent <= parentIndent && (childLine.includes('- [ ]') || childLine.includes('- [x]') || childLine.includes('- [-]'))) {
                        break;
                    }
                    endIndex++;
                }

                const blockLines = lines.slice(lineIndex, endIndex);
                lines.splice(lineIndex, endIndex - lineIndex);

                let updatedParentLine = blockLines[0];
                if (timeRangeRegex.test(updatedParentLine)) {
                    updatedParentLine = updatedParentLine.replace(timeRangeRegex, newTimeRange);
                } else {
                    updatedParentLine = updatedParentLine.replace(/^(\s*(?:>\s*)?-\s+\[[ xX/]\]\s+)(.*)$/, `$1${newTimeRange} $2`);
                }
                blockLines[0] = DailyNoteManager.normalizeTimeRangeSpaces(updatedParentLine);

                let focusHeadingIndex = lines.findIndex(l => l.toLowerCase().includes("focus blocks") || l.toLowerCase().includes("day planner"));
                if (focusHeadingIndex === -1) {
                    focusHeadingIndex = lines.findIndex(l => l.startsWith('## ') && (l.toLowerCase().includes("planner") || l.toLowerCase().includes("schedule")));
                }

                if (focusHeadingIndex === -1) {
                    lines.push(...blockLines);
                } else {
                    let insertIndex = focusHeadingIndex + 1;
                    let inserted = false;
                    while (insertIndex < lines.length) {
                        const curLine = lines[insertIndex];
                        if (curLine.startsWith('## ') || curLine.startsWith('---')) break;
                        if (curLine.startsWith('### ') && !curLine.toLowerCase().includes("focus block")) break;

                        const match = curLine.match(/^\s*(?:>\s*)?-\s+\[[ xX/]\]\s+(\d{1,2}):(\d{2})/);
                        if (match) {
                            const blockStart = parseInt(match[1]) * 60 + parseInt(match[2]);
                            if (newStartMins < blockStart) {
                                lines.splice(insertIndex, 0, ...blockLines);
                                inserted = true;
                                break;
                            }
                        }
                        insertIndex++;
                    }

                    if (!inserted) {
                        lines.splice(insertIndex, 0, ...blockLines);
                    }
                }
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));
            new Notice(`Rescheduled: ${draggedTask.description} (${newTimeRange})`);
            this.renderSchedule();
        } catch (e) {
            console.error("Failed to reschedule task on grid:", e);
            new Notice("Failed to reschedule task!");
        }
    }

    public async endActiveTask(task: any): Promise<void> {
        // Scheduled daily-note tasks retain their own identity, even if a matrix row shares the name.
        if (!Number.isInteger(task.lineIndex) && await WeeklyHabitService.completeTimerHabit(this.app, task)) return;
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
                if (this.plugin.externalTaskSyncService) {
                    await this.plugin.externalTaskSyncService.toggleTaskStatusByLineText(originalLine, true);
                }
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));
        } catch (e) {
            console.error("Failed to complete task:", e);
        }
    }

    public resolveExerciseProtocolItems(taskName: string): string[] {
        if (!taskName) return [];
        const clean = taskName.toLowerCase();
        const exMatch = clean.match(/exercises?:\s*phase\s*([123])/i) || clean.match(/phase\s*([123])\s*exercises?/i) || clean.match(/^phase\s*([123])/i);
        if (!exMatch) return [];

        const phaseNum = exMatch[1];
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const todayKey = days[new Date().getDay()];

        if (phaseNum === '1') {
            return [
                "Sun Salute: Reach overhead, lift sternum, 3–5 deep breaths",
                "Hamstring Scoops: 10 dynamic alternating sweeps",
                "Standing Quad Stretch: 30s/side (knees together, glute squeeze)",
                "Wall-Arm Chest Opener: 30s/side (at/below shoulder level)",
                "Forearm Plank: 1 set × 35–45s (glutes tight, neutral neck)",
                "Deep Neck Flexors: 1 set × 8–10 reps (5–10s chin-tuck holds)",
                "Banded Wall Slides: 1–2 sets × 10–12 reps (serratus upward rotation)",
                "Nerve Glides & Pelvic Floor: Median, ulnar, radial + Kegels"
            ];
        } else if (phaseNum === '2') {
            const p2Schedules: Record<string, string[]> = {
                "mon": ["Goblet Squats: 3 × 10-12 (10 lb DB, soft knees)", "Bowflex D-Ring Chest Press: 3 × 10 (elbows at 45°, converging)"],
                "wed": ["Goblet Squats: 3 × 10-12 (10 lb DB, soft knees)", "Bowflex D-Ring Chest Press: 3 × 10 (elbows at 45°, converging)"],
                "fri": ["Goblet Squats: 3 × 10-12 (10 lb DB, soft knees)", "Bowflex D-Ring Chest Press: 3 × 10 (elbows at 45°, converging)"],
                "tue": ["Banded Glute Bridges: 3 × 15 (2s peak squeeze)", "Standing Calf Raises: 3 × 15 (2s pause, 3s descent)", "Bowflex Lat Pulldowns: 3 × 10-12 (to upper collarbone)"],
                "thu": ["Banded Glute Bridges: 3 × 15 (2s peak squeeze)", "Standing Calf Raises: 3 × 15 (2s pause, 3s descent)", "Bowflex Lat Pulldowns: 3 × 10-12 (to upper collarbone)"],
                "sat": ["Banded Glute Bridges: 3 × 15 (2s peak squeeze)", "Standing Calf Raises: 3 × 15 (2s pause, 3s descent)", "Bowflex Lat Pulldowns: 3 × 10-12 (to upper collarbone)"],
                "sun": ["20-30 min gentle walk or outdoor stroll", "Light diaphragmatic breathing & nerve glides"]
            };
            return p2Schedules[todayKey] || p2Schedules["mon"];
        } else if (phaseNum === '3') {
            const p3Schedules: Record<string, string[]> = {
                "mon": ["Bowflex Lat Bar Triceps Pushdowns: 3 × 12-15 (center grip, 2s hold)", "Supine Dead Bugs: 3 × 10/side (lumbar flat)", "Dumbbell Bicep Curls: 3 × 10 (3s descent)", "(Optional) Side Planks: 2 × 30s/side"],
                "wed": ["Bowflex Lat Bar Triceps Pushdowns: 3 × 12-15 (center grip, 2s hold)", "Supine Dead Bugs: 3 × 10/side (lumbar flat)", "Dumbbell Bicep Curls: 3 × 10 (3s descent)", "(Optional) Side Planks: 2 × 30s/side"],
                "fri": ["Bowflex Lat Bar Triceps Pushdowns: 3 × 12-15 (center grip, 2s hold)", "Supine Dead Bugs: 3 × 10/side (lumbar flat)", "Dumbbell Bicep Curls: 3 × 10 (3s descent)", "(Optional) Side Planks: 2 × 30s/side"],
                "tue": [
                    "Bowflex D-Ring Rows: 2–3 × 10–12 (30 lbs, lead with elbows, pinch lats)",
                    "Scapular Y's: 8–10 reps (arms at 120°, lower traps)",
                    "Scapular T's: 8–10 reps (arms at 90°, mid-traps/rhomboids)",
                    "Scapular W's: 8–10 reps (elbows to ribs, rear cuff)",
                    "Scapular L's: 8–10 reps (90/90 external rotation)",
                    "Standing Dumbbell Shrugs: 2 × 12 (10 lb DB, 2s pause, slow 3s descent)"
                ],
                "thu": [
                    "Bowflex D-Ring Rows: 2–3 × 10–12 (30 lbs, lead with elbows, pinch lats)",
                    "Scapular Y's: 8–10 reps (arms at 120°, lower traps)",
                    "Scapular T's: 8–10 reps (arms at 90°, mid-traps/rhomboids)",
                    "Scapular W's: 8–10 reps (elbows to ribs, rear cuff)",
                    "Scapular L's: 8–10 reps (90/90 external rotation)",
                    "Standing Dumbbell Shrugs: 2 × 12 (10 lb DB, 2s pause, slow 3s descent)"
                ],
                "sat": [
                    "Bowflex D-Ring Rows: 2–3 × 10–12 (30 lbs, lead with elbows, pinch lats)",
                    "Scapular Y's: 8–10 reps (arms at 120°, lower traps)",
                    "Scapular T's: 8–10 reps (arms at 90°, mid-traps/rhomboids)",
                    "Scapular W's: 8–10 reps (elbows to ribs, rear cuff)",
                    "Scapular L's: 8–10 reps (90/90 external rotation)",
                    "Standing Dumbbell Shrugs: 2 × 12 (10 lb DB, 2s pause, slow 3s descent)"
                ],
                "sun": ["Full body foam rolling & mobility stretch", "10-15 min gentle breathwork"]
            };
            return p3Schedules[todayKey] || p3Schedules["mon"];
        }
        return [];
    }

    public getTimerChecklistItems(): string[] {
        if (!this.currentTimer) return [];
        if (Array.isArray(this.currentTimer.items) && this.currentTimer.items.length > 0) {
            return this.currentTimer.items;
        }
        if (this.currentTimer.task && Array.isArray((this.currentTimer.task as any).items) && (this.currentTimer.task as any).items.length > 0) {
            return (this.currentTimer.task as any).items;
        }
        const taskName = this.currentTimer.taskName || (this.currentTimer.task ? this.currentTimer.task.description : "");
        return this.resolveExerciseProtocolItems(taskName);
    }

    public async startTimer(task: any, durationMinutes: number): Promise<void> {
        this.clearTimer();

        const taskName = typeof task === 'object' ? task.description : task;

        if (this.plugin.focusLogService) {
            await this.plugin.focusLogService.logStart(taskName, durationMinutes);
        }

        const totalSeconds = durationMinutes * 60;
        const now = Date.now();
        const items = (typeof task === 'object' && Array.isArray(task.items) && task.items.length > 0)
            ? task.items
            : this.resolveExerciseProtocolItems(taskName);

        this.currentTimer = {
            task: typeof task === 'object' ? task : { description: taskName, duration: durationMinutes, items },
            taskName,
            remainingSeconds: totalSeconds,
            totalSeconds,
            targetEndTime: now + (totalSeconds * 1000),
            isPaused: false,
            pausedRemainingMs: null,
            items: items || [],
            completedItems: []
        };
        this.plugin.activeTimer = this.currentTimer;

        this.renderTimer();

        if (this.plugin.focusAudioService) {
            this.plugin.focusAudioService.onTimerStart(taskName);
        }

        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(async () => {
            if (this.currentTimer && !this.currentTimer.isPaused) {
                const curNow = Date.now();
                const remainingMs = Math.max(0, this.currentTimer.targetEndTime - curNow);
                this.currentTimer.remainingSeconds = Math.ceil(remainingMs / 1000);
                this.updateTimerDisplay();

                if (remainingMs <= 0) {
                    const expiredTask = this.currentTimer.task;
                    const expiredTaskName = this.currentTimer.taskName;
                    this.clearTimer();
                    this.currentTimer = null;
                    this.plugin.activeTimer = null;
                    if (this.plugin.focusLogService) {
                        await this.plugin.focusLogService.logUpdate(true);
                    }
                    this.triggerAlarm(expiredTask || expiredTaskName);
                }
            }
        }, 500);
    }

    public clearTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.plugin) {
            this.plugin.activeTimer = null;
        }
    }

    public async completeTimer(): Promise<void> {
        const taskObj = this.currentTimer ? this.currentTimer.task : null;
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";

        this.controlHostedMedia('pause').catch(() => {});
        if (this.plugin.focusAudioService) {
            this.plugin.focusAudioService.onTimerComplete();
        }
        this.clearTimer();
        this.currentTimer = null;
        if (this.plugin.focusLogService) {
            await this.plugin.focusLogService.logUpdate(true);
        }

        if (taskObj) {
            await this.endActiveTask(taskObj);
        }

        this.renderSchedule();
        new Notice(`Completed session for "${taskName}"!`, 3000);
    }

    public async cancelTimer(): Promise<void> {
        const taskName = this.currentTimer ? this.currentTimer.taskName : "Focus Block";
        this.controlHostedMedia('pause').catch(() => {});
        if (this.plugin.focusAudioService) {
            this.plugin.focusAudioService.onTimerCancel();
        }
        this.clearTimer();
        this.currentTimer = null;
        if (this.plugin.focusLogService) {
            await this.plugin.focusLogService.logUpdate(false);
        }

        this.renderSchedule();
        new Notice(`Cancelled session for "${taskName}".`, 3000);
    }

    public async getNextScheduledTask(): Promise<TaskItem | null> {
        if (!this.currentTimer) return null;
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return null;
        try {
            const content = await this.app.vault.read(dailyFile);
            const allTasks = TaskParserService.parseAllTasks(content).filter(t => t.status !== 'completed');
            const currentTask = this.currentTimer.task;
            if (!currentTask) return null;

            const now = new Date();
            let nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (now.getHours() < 5) nowMinutes += 1440;

            // 1. If currently inside an active timed focus block and the timer is running on a subtask or different item,
            // default "Next Task" to the current active focus block!
            const activeBlock = allTasks.find(t =>
                !t.isUntimed &&
                t.startMinutes !== null &&
                t.endMinutes !== null &&
                nowMinutes >= t.startMinutes &&
                nowMinutes < t.endMinutes &&
                t.lineIndex !== currentTask.lineIndex
            );
            if (activeBlock) {
                return activeBlock;
            }

            let referenceMinutes = currentTask.startMinutes;
            if (referenceMinutes === undefined || referenceMinutes === null) {
                referenceMinutes = nowMinutes;
            }

            allTasks.sort((a, b) => (a.startMinutes || 0) - (b.startMinutes || 0));

            for (const task of allTasks) {
                if (!task.isUntimed && (task.startMinutes || 0) > referenceMinutes && task.lineIndex !== currentTask.lineIndex) {
                    return task;
                }
            }
        } catch (e) {
            console.error("Failed to parse next scheduled task:", e);
        }
        return null;
    }

    public async getDailyMediaLinks(): Promise<{ label: string, url: string, isInternal: boolean }[]> {
        const dailyFile = this.getDailyNoteFile();
        if (!dailyFile) return [];
        const results: { label: string, url: string, isInternal: boolean }[] = [];
        try {
            const content = await this.app.vault.read(dailyFile);
            // Match markdown external links [Title](URL)
            const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
            let match;
            while ((match = mdLinkRegex.exec(content)) !== null) {
                const label = match[1].trim();
                const url = match[2].trim();
                if (!label.toLowerCase().includes("src") && !label.toLowerCase().includes("button") && !results.some(r => r.url === url)) {
                    results.push({ label, url, isInternal: false });
                }
            }
            // Match internal links [[Note|Title]] or [[Note]]
            const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
            while ((match = wikiRegex.exec(content)) !== null) {
                const noteName = match[1].trim();
                const alias = match[2] ? match[2].trim() : noteName;
                if (noteName.toLowerCase().includes("podcast") || noteName.toLowerCase().includes("music") || noteName.toLowerCase().includes("audio") || noteName.toLowerCase().includes("meditation")) {
                    results.push({ label: alias, url: noteName, isInternal: true });
                }
            }
        } catch (e) {
            console.error("Failed to parse daily media links:", e);
        }
        return results;
    }

    public renderTimer(): void {
        if (!this.currentTimer && this.plugin?.activeTimer) {
            this.currentTimer = this.plugin.activeTimer;
        }

        if (!this.currentTimer) {
            this.renderSchedule();
            return;
        }

        if (this.currentTimer.totalSeconds <= 0) {
            this.currentTimer.totalSeconds = this.currentTimer.remainingSeconds > 0 ? this.currentTimer.remainingSeconds : 25 * 60;
        }

        if (this.currentTimer.remainingSeconds === undefined || this.currentTimer.remainingSeconds === null) {
            this.currentTimer.remainingSeconds = this.currentTimer.totalSeconds;
        }

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (!this.currentTimer.isPaused) {
            this.timerInterval = setInterval(async () => {
                if (this.currentTimer && !this.currentTimer.isPaused) {
                    const curNow = Date.now();
                    const remainingMs = Math.max(0, this.currentTimer.targetEndTime - curNow);
                    this.currentTimer.remainingSeconds = Math.ceil(remainingMs / 1000);
                    this.updateTimerDisplay();

                    if (remainingMs <= 0) {
                        const expiredTask = this.currentTimer.task;
                        const expiredTaskName = this.currentTimer.taskName;
                        this.clearTimer();
                        this.currentTimer = null;
                        this.plugin.activeTimer = null;
                        if (this.plugin.focusLogService) {
                            await this.plugin.focusLogService.logUpdate(true);
                        }
                        this.triggerAlarm(expiredTask || expiredTaskName);
                    }
                }
            }, 500);
        }

        const container = this.contentEl;
        container.empty();

        const viewContainer = container.createDiv({ cls: 'task-timer-view-container' });
        const timerContainer = viewContainer.createDiv({ cls: 'timer-view-container' });

        timerContainer.createDiv({ cls: 'timer-task-title', text: this.currentTimer.taskName });

        const circle = timerContainer.createDiv({ cls: 'timer-circle-container pulsing' });
        this.timeTextEl = circle.createDiv({ cls: 'timer-countdown-text' });

        this.updateTimerDisplay();

        const adjustControls = timerContainer.createDiv({ cls: 'timer-adjust-controls' });
        const plus1Btn = adjustControls.createEl('button', { cls: 'timer-btn-adjust', text: '+1m' });
        plus1Btn.onclick = () => this.adjustActiveTimer(1);
        const plusBtn = adjustControls.createEl('button', { cls: 'timer-btn-adjust', text: '+5m' });
        plusBtn.onclick = () => this.adjustActiveTimer(5);

        const controls = timerContainer.createDiv({ cls: 'timer-controls' });

        this.pauseBtn = controls.createEl('button', { cls: 'timer-btn', text: this.currentTimer.isPaused ? 'Resume' : 'Pause' });
        this.pauseBtn.onclick = () => this.togglePause();

        const completeBtn = controls.createEl('button', { cls: 'timer-btn primary', text: 'Complete' });
        completeBtn.onclick = () => this.completeTimer();

        const cancelBtn = controls.createEl('button', { cls: 'timer-btn warning', text: 'Cancel' });
        cancelBtn.onclick = () => this.cancelTimer();

        // System Media Card (kilPC GSMTC & Spotify Connect controls)
        this.renderHostedMediaCard(timerContainer);

        // Active task checklist / movement protocol items
        this.renderTimerChecklist(timerContainer);

        const nextTaskEl = timerContainer.createDiv({
            cls: 'timer-next-task-container',
            attr: { style: 'margin-top: 20px; border-top: 1px solid var(--background-modifier-border); padding-top: 15px; font-size: 13px; color: var(--text-muted); text-align: center;' }
        });
        nextTaskEl.textContent = "Loading next task...";

        this.getNextScheduledTask().then(nextTask => {
            if (nextTask && nextTask.startHour !== null && nextTask.startMin !== null) {
                const startH12 = nextTask.startHour % 12 === 0 ? 12 : nextTask.startHour % 12;
                const startMStr = String(nextTask.startMin).padStart(2, '0');
                const startAmpm = nextTask.startHour >= 12 ? 'PM' : 'AM';
                const now = new Date();
                let nowMinutes = now.getHours() * 60 + now.getMinutes();
                if (now.getHours() < 5) nowMinutes += 1440;
                const isCurrent = nextTask.startMinutes !== null && nextTask.endMinutes !== null && nowMinutes >= nextTask.startMinutes && nowMinutes < nextTask.endMinutes;
                const prefix = isCurrent ? "▶️ <strong>Active Block:</strong>" : "⏭️ <strong>Next:</strong>";
                nextTaskEl.innerHTML = `${prefix} ${nextTask.description} <span style="color: var(--text-accent); font-family: monospace;">(${startH12}:${startMStr} ${startAmpm})</span>`;
            } else {
                nextTaskEl.innerHTML = `⏭️ <strong>Next:</strong> None scheduled`;
            }
        });
    }

    public async adjustActiveTimer(minutes: number): Promise<void> {
        if (!this.currentTimer) return;

        const timer = this.currentTimer;
        timer.remainingSeconds = Math.max(0, timer.remainingSeconds + minutes * 60);
        timer.totalSeconds = Math.max(0, timer.totalSeconds + minutes * 60);
        timer.targetEndTime = Date.now() + (timer.remainingSeconds * 1000);

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
                        newLine = DailyNoteManager.normalizeTimeRangeSpaces(newLine);
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

    public updateTimerDisplay(): void {
        if (!this.currentTimer || !this.timeTextEl) return;

        let remainingSeconds = this.currentTimer.remainingSeconds;
        if (!this.currentTimer.isPaused && this.currentTimer.targetEndTime) {
            remainingSeconds = Math.max(0, Math.ceil((this.currentTimer.targetEndTime - Date.now()) / 1000));
            this.currentTimer.remainingSeconds = remainingSeconds;
        }

        const mins = Math.floor(remainingSeconds / 60);
        const secs = remainingSeconds % 60;
        const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        this.timeTextEl.setText(timeStr);
        try {
            document.title = `(${timeStr}) ${this.currentTimer.taskName} - Obsidian`;
        } catch (e) {}
    }

    public async togglePause(options: { controlMedia?: boolean } = {}): Promise<void> {
        if (!this.currentTimer) return;
        this.currentTimer.isPaused = !this.currentTimer.isPaused;

        if (this.currentTimer.isPaused) {
            this.currentTimer.pausedRemainingMs = Math.max(0, this.currentTimer.targetEndTime - Date.now());
            this.currentTimer.remainingSeconds = Math.ceil(this.currentTimer.pausedRemainingMs / 1000);
            if (this.pauseBtn) this.pauseBtn.setText('Resume');
            const circle = this.contentEl.querySelector('.timer-circle-container');
            if (circle) circle.removeClass('pulsing');
            if (this.plugin.focusLogService) await this.plugin.focusLogService.logPause();
            if (options.controlMedia !== false) {
                if (this.plugin.focusAudioService) this.plugin.focusAudioService.onTimerPause();
                this.controlHostedMedia('pause').catch(() => {});
            }
        } else {
            const remainingMs = (this.currentTimer.pausedRemainingMs !== null && this.currentTimer.pausedRemainingMs !== undefined)
                ? this.currentTimer.pausedRemainingMs
                : (this.currentTimer.remainingSeconds * 1000);
            this.currentTimer.targetEndTime = Date.now() + remainingMs;
            this.currentTimer.pausedRemainingMs = null;
            if (this.pauseBtn) this.pauseBtn.setText('Pause');
            const circle = this.contentEl.querySelector('.timer-circle-container');
            if (circle) circle.addClass('pulsing');
            if (this.plugin.focusLogService) await this.plugin.focusLogService.logResume();
            if (options.controlMedia !== false) {
                if (this.plugin.focusAudioService) this.plugin.focusAudioService.onTimerResume();
                this.controlHostedMedia('play').catch(() => {});
            }
        }

        if (this.plugin) {
            this.plugin.activeTimer = this.currentTimer;
        }
        this.updateTimerDisplay();
    }

    public triggerAlarm(task: any): void {
        this.isAlarming = true;
        this.stopAlarm();
        if (this.plugin.focusAudioService) {
            this.plugin.focusAudioService.onTimerAlarm();
        }

        const taskName = typeof task === 'object' ? task.description : task;

        if (this.plugin.timerEngineService) {
            this.plugin.timerEngineService.playSiren(() => {
                this.stopAlarm();
                this.renderSchedule();
            });
            this.plugin.timerEngineService.flashWindow();
            this.plugin.timerEngineService.startTitleFlash(taskName);
        }

        const container = this.contentEl;
        container.empty();

        const overlay = container.createDiv({ cls: 'alarm-overlay' });
        overlay.createDiv({ cls: 'alarm-task-name', text: taskName });
        overlay.createDiv({ cls: 'alarm-alert-text', text: "Focus session finished!" });

        const controls = overlay.createDiv({ cls: 'alarm-controls' });

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

        const continueBtn = controls.createEl('button', { cls: 'alarm-btn success', text: 'Continue Focus' });
        continueBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object') {
                await this.startTimer(task, task.duration || parseInt(this.plugin.settings.defaultDuration));
            } else {
                await this.startTimer(taskName, parseInt(this.plugin.settings.defaultDuration));
            }
        };

        const takeBreakBtn = controls.createEl('button', { cls: 'alarm-btn info', text: '☕ Take 5m Break' });
        takeBreakBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await this.endActiveTask(task);
            } else if (typeof task === 'string') {
                await this.endActiveTask({ description: task });
            }
            await this.startTimer("☕ Focus Break & Recharge", 5);
        };

        const rescheduleBtn = controls.createEl('button', { cls: 'alarm-btn warning', text: 'Reschedule' });
        rescheduleBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await DailyNoteManager.postponeTask(this.app, task);
            } else if (typeof task === 'string') {
                await DailyNoteManager.postponeTask(this.app, { description: task });
            }
            this.renderSchedule();
        };

        const notTodayBtn = controls.createEl('button', { cls: 'alarm-btn danger', text: 'Not Today' });
        notTodayBtn.onclick = async () => {
            this.stopAlarm();
            if (typeof task === 'object' && task !== null) {
                await DailyNoteManager.removeTask(this.app, task);
            } else if (typeof task === 'string') {
                await DailyNoteManager.removeTask(this.app, { description: task });
            }
            this.renderSchedule();
        };
    }

    public stopAlarm(): void {
        this.isAlarming = false;
        if (this.plugin.timerEngineService) {
            this.plugin.timerEngineService.stopAlarm();
        }
    }

    private mediaBaseUrl(): string {
        return `http://127.0.0.1:${parseInt(this.plugin.settings?.serverPort) || 8089}`;
    }

    public async controlHostedMedia(action: 'play' | 'pause' | 'toggle' | 'next-source'): Promise<boolean> {
        try {
            const response = await fetch(`${this.mediaBaseUrl()}/api/media/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    public renderHostedMediaCard(parent: HTMLElement): void {
        const card = parent.createDiv({ cls: 'timer-focus-audio-card hosted-media-card' });
        const header = card.createDiv({ cls: 'hosted-media-header' });
        header.createSpan({ text: '🎵 kilPC Media' });
        const status = header.createSpan({ cls: 'hosted-media-status', text: 'Checking…' });
        const button = card.createEl('button', { cls: 'timer-audio-btn primary', text: '▶ Play' });
        const nextSource = card.createEl('button', { cls: 'timer-audio-btn', text: 'Next source →', attr: { 'aria-label': 'Switch media source without playing' } });
        let isPlaying = false;

        const refresh = async () => {
            try {
                const response = await fetch(`${this.mediaBaseUrl()}/api/media/status`);
                if (!response.ok) throw new Error(String(response.status));
                const state = await response.json();
                isPlaying = state.state === 'playing';
                const trackTitle = state.title ? ` (${state.title})` : '';
                const available = state.success !== false && state.state !== 'none' && state.state !== 'unavailable';
                status.setText(available ? `${state.source || 'Windows media'} · ${isPlaying ? 'Playing' : 'Paused'}${trackTitle}` : 'Selected source unavailable');
                button.disabled = !available;
                button.setText(isPlaying ? '⏸ Pause' : '▶ Play');
                if (isPlaying) card.addClass('is-playing');
                else card.removeClass('is-playing');
            } catch (e) {
                status.setText('kilPC unavailable');
                button.disabled = true;
            }
        };

        button.onclick = async () => {
            button.disabled = true;
            const success = await this.controlHostedMedia(isPlaying ? 'pause' : 'play');
            if (!success) new Notice('Could not control kilPC media. Check the focus timer server and AutoHotkey helper.');
            await refresh();
        };
        nextSource.onclick = async () => {
            nextSource.disabled = true;
            if (!await this.controlHostedMedia('next-source')) new Notice('No other available media source.');
            await refresh();
            nextSource.disabled = false;
        };
        refresh();
        if (this.hostedMediaInterval !== null) window.clearInterval(this.hostedMediaInterval);
        this.hostedMediaInterval = window.setInterval(refresh, 2000);
    }

    public renderTimerChecklist(container: HTMLElement): void {
        const checklistItems = this.getTimerChecklistItems();
        if (!checklistItems || checklistItems.length === 0) return;

        if (!this.currentTimer) return;
        if (!this.currentTimer.items || this.currentTimer.items.length === 0) {
            this.currentTimer.items = checklistItems;
        }
        if (!this.currentTimer.completedItems) {
            this.currentTimer.completedItems = [];
        }
        const completedSet = new Set<number>(this.currentTimer.completedItems);

        const checklistContainer = container.createDiv({ cls: 'timer-checklist-container' });

        const header = checklistContainer.createDiv({ cls: 'timer-checklist-header' });
        const headerLeft = header.createDiv({ cls: 'timer-checklist-header-left' });
        const toggleIcon = headerLeft.createSpan({ cls: 'timer-checklist-toggle-icon', text: '▼ ' });
        headerLeft.createSpan({ cls: 'timer-checklist-title', text: '📋 Routine Movements' });

        const badge = header.createSpan({
            cls: 'timer-checklist-badge',
            text: `${completedSet.size} / ${checklistItems.length}`
        });

        const listEl = checklistContainer.createDiv({ cls: 'timer-checklist-items' });

        let isExpanded = true;
        header.onclick = (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            listEl.style.display = isExpanded ? 'flex' : 'none';
            toggleIcon.setText(isExpanded ? '▼ ' : '▶ ');
        };

        checklistItems.forEach((itemText: string, idx: number) => {
            const isCompleted = completedSet.has(idx);
            const itemRow = listEl.createDiv({
                cls: `timer-checklist-item${isCompleted ? ' is-completed' : ''}`
            });

            const cb = itemRow.createEl('input', {
                type: 'checkbox',
                cls: 'timer-checklist-cb'
            });
            cb.checked = isCompleted;

            const textSpan = itemRow.createSpan({
                cls: 'timer-checklist-text',
                text: itemText
            });

            const toggleItem = (ev?: Event) => {
                if (ev) ev.stopPropagation();
                if (completedSet.has(idx)) {
                    completedSet.delete(idx);
                } else {
                    completedSet.add(idx);
                }
                if (this.currentTimer) {
                    this.currentTimer.completedItems = Array.from(completedSet);
                }
                const nowCompleted = completedSet.has(idx);
                cb.checked = nowCompleted;
                itemRow.toggleClass('is-completed', nowCompleted);
                badge.setText(`${completedSet.size} / ${checklistItems.length}`);
            };

            cb.onclick = (e) => {
                e.stopPropagation();
                toggleItem(e);
            };
            itemRow.onclick = (e) => {
                toggleItem(e);
            };
        });
    }
}
