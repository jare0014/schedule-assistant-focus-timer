/**
 * main.ts - Main entry point and coordinator for Schedule Assistant with Focus Timer.
 */

import { Plugin, Notice, MarkdownView } from 'obsidian';
import { VIEW_TYPE_TASK_TIMER, TaskTimerPluginSettings, DEFAULT_SETTINGS } from './types';
import { TaskParserService } from './services/TaskParserService';
import { TimerEngineService } from './services/TimerEngineService';
import { DailyNoteManager } from './services/DailyNoteManager';
import { FocusLogService } from './services/FocusLogService';
import { ExternalTaskSyncService } from './services/ExternalTaskSyncService';
import { PythonSchedulerRunner } from './services/PythonSchedulerRunner';
import { RemoteServerService } from './services/RemoteServerService';
import { FocusAudioService } from './services/FocusAudioService';
import { TaskTimerView } from './views/TaskTimerView';
import { OmniLoggerModal } from './views/OmniLoggerModal';
import { TaskTimerSettingTab } from './settings/TaskTimerSettingTab';

export default class TaskTimerPlugin extends Plugin {
    public settings: TaskTimerPluginSettings = DEFAULT_SETTINGS;
    public activeTimer: any = null;
    public lastClickedEl: HTMLElement | null = null;
    public clickTracker: ((evt: MouseEvent) => void) | null = null;

    public timerEngineService!: TimerEngineService;
    public focusLogService!: FocusLogService;
    public externalTaskSyncService!: ExternalTaskSyncService;
    public pythonSchedulerRunner!: PythonSchedulerRunner;
    public remoteServerService!: RemoteServerService;
    public focusAudioService: FocusAudioService | null = null;
    public hostedMediaState: 'playing' | 'paused' | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Initialize Services
        this.timerEngineService = new TimerEngineService();
        this.focusLogService = new FocusLogService(this.app);
        this.externalTaskSyncService = new ExternalTaskSyncService(
            this.app,
            () => this.settings,
            (id, fallback) => this.getSecret(id, fallback)
        );
        this.pythonSchedulerRunner = new PythonSchedulerRunner(
            this.app,
            () => this.settings,
            () => this.saveSettings(),
            (id, fallback) => this.getSecret(id, fallback)
        );
        this.remoteServerService = new RemoteServerService(
            this.app,
            () => this,
            () => this.settings
        );
        // Playback belongs to the active system media app. The focus timer does not
        // publish a competing media session or launch a saved track.

        this.pythonSchedulerRunner.ensureVenv();

        // Register global click tracker
        this.clickTracker = (evt: MouseEvent) => {
            this.lastClickedEl = evt.target as HTMLElement;
        };
        window.addEventListener('click', this.clickTracker, true);

        // Register custom view
        this.registerView(
            VIEW_TYPE_TASK_TIMER,
            (leaf) => new TaskTimerView(leaf, this)
        );

        // Add ribbon icon
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

        // 5:00 AM auto-run schedule check
        this.app.workspace.onLayoutReady(() => {
            this.check5AMAutoRun();
        });
        this.registerInterval(window.setInterval(() => {
            this.check5AMAutoRun();
        }, 5 * 60 * 1000));

        // Add generate schedule command
        this.addCommand({
            id: 'load-tasks',
            name: 'Generate Daily Schedule (Schedule Assistant)',
            callback: () => this.runTaskLoader(this.settings.autoApply)
        });

        // Add postpone clicked task command
        this.addCommand({
            id: 'postpone-clicked-task',
            name: 'Postpone clicked task to next open slot',
            callback: () => this.postponeClickedTask()
        });

        // Add 1 Minute command
        this.addCommand({
            id: 'adjust-timer-plus-1m',
            name: 'Add 1 Minute to Active Focus Timer',
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                if (leaves.length > 0) {
                    const view = leaves[0].view as any;
                    if (view.currentTimer) {
                        view.adjustActiveTimer(1);
                    }
                }
            }
        });

        // Add Omni-Logger quick log modal command
        this.addCommand({
            id: 'quick-log-modal',
            name: 'Omni-Logger: Quick Log Modal',
            callback: () => {
                new OmniLoggerModal(this.app, this).open();
            }
        });

        // Add Toggle Focus Timer & Media command
        this.addCommand({
            id: 'toggle-timer-and-media',
            name: 'Toggle Focus Timer',
            callback: async () => {
                await this.toggleFocusSession();
            }
        });

        // Add unified task toggle command
        this.addCommand({
            id: 'toggle-task-server',
            name: 'Toggle task on server (Todoist / Google Tasks)',
            editorCallback: async (editor) => {
                const lineNo = editor.getCursor().line;
                const lineText = editor.getLine(lineNo);
                const hasLink = lineText.includes('todoist.com') || lineText.includes('tasks.google.com');

                if (hasLink) {
                    try {
                        const success = await this.externalTaskSyncService.toggleTaskStatusByLineText(lineText, true);
                        if (success) {
                            (this.app as any).commands.executeCommandById("editor:toggle-checklist-status");
                        }
                    } catch (e: any) {
                        console.error("Task server toggle failed:", e);
                        new Notice(`Failed to update task on server: ${e.message}`);
                    }
                } else {
                    (this.app as any).commands.executeCommandById("editor:toggle-checklist-status");
                }
            }
        });

        // Hook Settings Sidebar Organizer
        const setting = (this.app as any).setting;
        if (setting && setting.open && !setting.open.__antigravityHooked) {
            const originalOpen = setting.open;
            const self = this;
            setting.open = function() {
                const result = originalOpen.apply(this, arguments);
                setTimeout(() => {
                    const activeOmni = (self.app as any).plugins?.getPlugin('omni-logger');
                    if (activeOmni && typeof activeOmni.organizeCustomPluginsSidebar === 'function') {
                        activeOmni.organizeCustomPluginsSidebar();
                    }
                    self.organizeCustomPluginsSidebar();
                }, 50);
                return result;
            };
            setting.open.__antigravityHooked = true;
            setting.open.__originalOpen = originalOpen;
        }

        if (this.settings.enableServer !== false) {
            await this.startServer();
        }
    }

    async onunload(): Promise<void> {
        if (this.focusAudioService) {
            this.focusAudioService.stop();
        }
        if (this.clickTracker) {
            window.removeEventListener('click', this.clickTracker, true);
        }
        await this.stopServer();
        this.timerEngineService?.stopAlarm();
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async getSecret(secretId: string, fallbackSettingKey: keyof TaskTimerPluginSettings): Promise<string> {
        if ((this.app as any).secretStorage) {
            try {
                return await (this.app as any).secretStorage.getSecret(secretId) || "";
            } catch (e) {
                console.error(`Failed to get secret ${secretId} from secretStorage:`, e);
            }
        }
        return (this.settings[fallbackSettingKey] as string) || "";
    }

    async setSecret(secretId: string, value: string, fallbackSettingKey: keyof TaskTimerPluginSettings): Promise<void> {
        if ((this.app as any).secretStorage) {
            try {
                await (this.app as any).secretStorage.setSecret(secretId, value);
                return;
            } catch (e) {
                console.error(`Failed to set secret ${secretId} in secretStorage:`, e);
            }
        }
        (this.settings as any)[fallbackSettingKey] = value;
        await this.saveSettings();
    }

    async activateView(): Promise<void> {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_TIMER);
        let leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) {
            leaf = this.app.workspace.getLeaf(true);
        }
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_TASK_TIMER,
                active: true,
            });
        }
    }

    async toggleFocusSession(): Promise<{ success: boolean; isPaused?: boolean; taskName?: string; isAudioPlaying?: boolean; handledInternalAudio: boolean }> {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        let activeView = leaves.map(l => l.view as any).find(v => v && v.currentTimer);

        if (!activeView && leaves.length > 0) {
            activeView = leaves[0].view as any;
            if (!activeView.currentTimer && this.activeTimer) {
                activeView.currentTimer = this.activeTimer;
            }
        }

        const audioSvc = this.focusAudioService;
        const hasInternalTrack = Boolean(
            audioSvc &&
            audioSvc.currentTrack &&
            audioSvc.currentTrack.type !== 'external_web'
        );

        if (activeView && activeView.currentTimer) {
            await activeView.togglePause();
            const handledInternalAudio = Boolean(
                hasInternalTrack &&
                (audioSvc?.autoSyncWithTimer || !activeView.currentTimer.isPaused)
            );
            return {
                success: true,
                isPaused: activeView.currentTimer.isPaused,
                taskName: activeView.currentTimer.taskName,
                handledInternalAudio
            };
        }

        if (this.activeTimer) {
            this.activeTimer.isPaused = !this.activeTimer.isPaused;
            if (this.activeTimer.isPaused) {
                this.activeTimer.pausedRemainingMs = Math.max(0, (this.activeTimer.targetEndTime || Date.now()) - Date.now());
                this.activeTimer.remainingSeconds = Math.ceil(this.activeTimer.pausedRemainingMs / 1000);
                if (this.focusLogService) {
                    this.focusLogService.logPause().catch((e: any) => console.error("Error in logPause:", e));
                }
                if (this.focusAudioService) this.focusAudioService.onTimerPause();
            } else {
                const remainingMs = (this.activeTimer.pausedRemainingMs !== null && this.activeTimer.pausedRemainingMs !== undefined)
                    ? this.activeTimer.pausedRemainingMs
                    : (this.activeTimer.remainingSeconds * 1000);
                this.activeTimer.targetEndTime = Date.now() + remainingMs;
                this.activeTimer.pausedRemainingMs = null;
                if (this.focusLogService) {
                    this.focusLogService.logResume().catch((e: any) => console.error("Error in logResume:", e));
                }
                if (this.focusAudioService) this.focusAudioService.onTimerResume();
            }
            const handledInternalAudio = Boolean(
                hasInternalTrack &&
                (audioSvc?.autoSyncWithTimer || !this.activeTimer.isPaused)
            );
            return {
                success: true,
                isPaused: this.activeTimer.isPaused,
                taskName: this.activeTimer.taskName,
                handledInternalAudio
            };
        }

        // If no timer is currently active, start a focus timer session for current scheduled block or next pending task
        let matchedTask: any = null;
        let matchedDuration = parseInt(this.settings.defaultDuration) || 25;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);

        if (dailyFile) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const allTasks = TaskParserService.parseAllTasks(content);

                // 1. Check if user currently has a task clicked or cursor in active Markdown view
                const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
                const lineContent = DailyNoteManager.getClickedLineContent(activeMarkdown);
                if (lineContent) {
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
                        const clickedStart = startH * 60 + startM;
                        const clickedEnd = endH * 60 + endM;
                        matchedTask = allTasks.find(t => t.startMinutes === clickedStart && t.endMinutes === clickedEnd);
                    }
                }

                // 2. If no clicked line match, find the task active for the current time
                if (!matchedTask) {
                    const now = new Date();
                    const nowMinutes = now.getHours() * 60 + now.getMinutes();

                    matchedTask = allTasks.find(t =>
                        t.status !== 'completed' &&
                        t.startMinutes !== undefined &&
                        t.endMinutes !== undefined &&
                        nowMinutes >= t.startMinutes &&
                        nowMinutes < t.endMinutes
                    );

                    // 3. Fallback to next upcoming uncompleted timed task today
                    if (!matchedTask) {
                        matchedTask = allTasks.find(t =>
                            t.status !== 'completed' &&
                            t.startMinutes !== undefined &&
                            t.startMinutes >= nowMinutes
                        );
                    }

                    // 4. Fallback to any incomplete task
                    if (!matchedTask) {
                        matchedTask = allTasks.find(t => t.status !== 'completed');
                    }
                }

                if (matchedTask && matchedTask.duration && matchedTask.duration > 0) {
                    matchedDuration = matchedTask.duration;
                }
            } catch (e) {
                console.error("toggleFocusSession: error matching daily note task:", e);
            }
        }

        const taskInput = matchedTask || "Focus Session";
        const taskName = typeof taskInput === 'object' ? taskInput.description : taskInput;

        // Ensure TaskTimerView is open and start timer
        if (leaves.length === 0) {
            await this.activateView();
        }
        const updatedLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (updatedLeaves.length > 0) {
            const targetView = updatedLeaves[0].view as any;
            await targetView.startTimer(taskInput, matchedDuration);

            // Ensure audio starts if configured
            if (this.focusAudioService) {
                await this.focusAudioService.onTimerStart(taskName);
            }

            const isInternal = Boolean(
                audioSvc &&
                audioSvc.currentTrack &&
                audioSvc.currentTrack.type !== 'external_web'
            );

            return {
                success: true,
                isPaused: false,
                taskName,
                handledInternalAudio: isInternal
            };
        }

        if (this.focusAudioService) {
            await this.focusAudioService.togglePlay(true);
            return {
                success: true,
                isAudioPlaying: this.focusAudioService.isPlaying,
                handledInternalAudio: hasInternalTrack
            };
        }

        return { success: false, handledInternalAudio: false };
    }

    async check5AMAutoRun(): Promise<void> {
        if (!this.settings.autoRun5AM) return;
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 5) {
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            if (this.settings.lastAutoRun5AMDate !== dateStr) {
                console.log(`[Schedule Assistant] Auto-triggering 5:00 AM daily schedule for ${dateStr} in auto-apply mode...`);
                new Notice(`[Schedule Assistant] Auto-generating 5:00 AM daily schedule for ${dateStr}...`);
                this.pythonSchedulerRunner.runTaskLoader(true, dateStr).catch(e => {
                    console.error("[Schedule Assistant] 5:00 AM auto-run failed:", e);
                });
            }
        }
    }

    async runTaskLoader(autoApply = false, dateToMarkOnSuccess: string | null = null): Promise<void> {
        return this.pythonSchedulerRunner.runTaskLoader(autoApply, dateToMarkOnSuccess);
    }

    async startServer(retryCount = 0): Promise<void> {
        return this.remoteServerService.startServer(retryCount);
    }

    async stopServer(): Promise<void> {
        return this.remoteServerService.stopServer();
    }

    async postponeClickedTask(): Promise<void> {
        return DailyNoteManager.postponeClickedTask(this.app);
    }

    parseAllTasks(content: string) {
        return TaskParserService.parseAllTasks(content);
    }

    getDailyNoteFile() {
        return DailyNoteManager.getDailyNoteFile(this.app);
    }

    async startTaskTimer(taskOrName: any, durationMinutes: number): Promise<void> {
        let taskName = typeof taskOrName === 'object' ? (taskOrName.description || taskOrName.taskName || "") : String(taskOrName || "");
        let taskObj = typeof taskOrName === 'object' ? taskOrName : null;

        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
        if (dailyFile) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const allTasks = TaskParserService.parseAllTasks(content);
                const targetClean = taskName.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (targetClean) {
                    const matched = allTasks.find(t => {
                        const descClean = t.description.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return descClean === targetClean || descClean.includes(targetClean) || targetClean.includes(descClean);
                    });
                    if (matched) {
                        taskObj = { ...matched, ...(taskObj || {}) };
                        if (!taskName) taskName = matched.description;
                    }
                }
            } catch (e) {
                console.error("Failed to match task against daily note in startTaskTimer:", e);
            }
        }

        if (!taskObj) {
            taskObj = {
                description: taskName || `Focus Block (${durationMinutes}m)`,
                duration: durationMinutes,
                sourceFile: dailyFile ? dailyFile.path : undefined
            };
        } else if (!taskObj.sourceFile && dailyFile) {
            taskObj.sourceFile = dailyFile.path;
        }

        let leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (leaves.length === 0) {
            await this.activateView();
            leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        }

        if (leaves.length > 0) {
            const view = leaves[0].view as any;
            await view.startTimer(taskObj, durationMinutes);
        }
    }

    async startTimerForActiveOrCurrent(durationMinutes: number): Promise<void> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const lineContent = DailyNoteManager.getClickedLineContent(activeView);
        let taskName = "";

        if (lineContent) {
            const taskRegex = /^\s*[-*+]\s+\[.\]\s+(.*)$/;
            const taskMatch = lineContent.match(taskRegex);
            let taskText = taskMatch ? taskMatch[1].trim() : lineContent.replace(/^\s*[-*+]\s+/, '').trim();

            if (taskText) {
                taskText = taskText.replace(/\s*--\s*p\d+\s*--\s*\[src\].*$/, '');
                taskText = taskText.replace(/\s*--\s*p\d+$/, '');
                taskText = taskText.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                taskText = taskText.replace(/\[src\]\(.*?\)/g, '').trim();
                taskText = taskText.replace(/\s+src$/i, '').trim();
                taskText = taskText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                taskText = taskText.replace(/#\w+/g, '').trim();
                taskText = taskText.replace(/\s+/g, ' ').trim();

                const timeRegex = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?)?\s*(.*)$/;
                const timeMatch = taskText.match(timeRegex);
                taskName = timeMatch ? timeMatch[7].trim() : taskText.trim();
            }
        }

        let matchedTask: any = null;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);

        if (dailyFile) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const allTasks = TaskParserService.parseAllTasks(content);

                if (lineContent) {
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
                    } else if (taskName) {
                        const clickedDescription = taskName.toLowerCase();
                        matchedTask = allTasks.find(t => {
                            const fileDesc = t.description.toLowerCase();
                            return fileDesc === clickedDescription || fileDesc.includes(clickedDescription) || clickedDescription.includes(fileDesc);
                        });
                    }
                }

                // If no task was matched from clicked line, check the active scheduled block for right now!
                if (!matchedTask && !taskName) {
                    const now = new Date();
                    let nowMinutes = now.getHours() * 60 + now.getMinutes();
                    if (now.getHours() < 5) nowMinutes += 1440;

                    matchedTask = allTasks.find(t =>
                        t.status !== 'completed' &&
                        !t.isUntimed &&
                        t.startMinutes !== null &&
                        t.endMinutes !== null &&
                        nowMinutes >= t.startMinutes &&
                        nowMinutes < t.endMinutes
                    );

                    if (matchedTask) {
                        taskName = matchedTask.description;
                    } else {
                        // Check next upcoming scheduled task
                        const nextTask = allTasks.find(t =>
                            t.status !== 'completed' &&
                            !t.isUntimed &&
                            t.startMinutes !== null &&
                            t.startMinutes >= nowMinutes
                        );
                        if (nextTask) {
                            matchedTask = nextTask;
                            taskName = nextTask.description;
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to match clicked task against daily note schedule", e);
            }
        }

        taskName = taskName || `Focus Block (${durationMinutes}m)`;
        const finalTask = matchedTask || { description: taskName, duration: durationMinutes, sourceFile: dailyFile ? dailyFile.path : undefined };

        let leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        if (leaves.length === 0) {
            await this.activateView();
            leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
        }
        if (leaves.length > 0) {
            const view = leaves[0].view as any;
            await view.startTimer(finalTask, durationMinutes);
        }
    }

    organizeCustomPluginsSidebar(): void {
        const settingModal = document.querySelector('.modal.mod-settings');
        if (!settingModal) return;

        const sidebar = settingModal.querySelector('.vertical-tab-header');
        if (!sidebar) return;

        const communitySection = sidebar.querySelector('.vertical-tab-header-group-items[data-section="community-plugins"]');
        if (!communitySection) return;

        let folderContainer = communitySection.querySelector('.custom-plugins-folder-container');
        if (folderContainer) return;

        const targetPluginIds = [
            'always-on-memory-agent',
            'schedule-assistant-focus-timer',
            'omni-logger',
            'google-keep-sync',
            'grind-manager',
            'knowledge-pipeline',
            'git-logger'
        ];

        const targetElements: Element[] = [];
        const navItems = communitySection.querySelectorAll('.vertical-tab-nav-item');
        navItems.forEach(item => {
            const id = item.getAttribute('data-setting-id');
            if (id && targetPluginIds.includes(id)) {
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

        const container = document.createElement('div');
        container.className = 'custom-plugins-folder-container';
        container.style.transition = 'max-height 0.25s ease-out, opacity 0.2s ease';
        container.style.overflow = 'hidden';

        let isCollapsed = localStorage.getItem('custom-plugins-settings-collapsed') === 'true';
        if (isCollapsed) {
            container.style.maxHeight = '0px';
            container.style.opacity = '0';
            chevron.style.transform = 'rotate(-90deg)';
        } else {
            container.style.maxHeight = '500px';
            container.style.opacity = '1';
        }

        folderHeader.onclick = (e) => {
            e.stopPropagation();
            isCollapsed = !isCollapsed;
            localStorage.setItem('custom-plugins-settings-collapsed', String(isCollapsed));
            if (isCollapsed) {
                container.style.maxHeight = '0px';
                container.style.opacity = '0';
                chevron.style.transform = 'rotate(-90deg)';
            } else {
                container.style.maxHeight = '500px';
                container.style.opacity = '1';
                chevron.style.transform = 'rotate(0deg)';
            }
        };

        const firstTarget = targetElements[0];
        try {
            communitySection.insertBefore(folderHeader, firstTarget);
            communitySection.insertBefore(container, firstTarget);
        } catch (e) {
            console.warn("Failed to insert folder container: ", e);
        }

        targetElements.forEach(item => {
            (item as HTMLElement).style.paddingLeft = '24px';
            item.classList.add('custom-plugin-sub-item');
            try {
                container.appendChild(item);
            } catch (e) {
                console.warn("Failed to append item to folder container: ", e);
            }
        });
    }
}
