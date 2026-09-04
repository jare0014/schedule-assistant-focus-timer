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

        taskName = taskName || `Focus Block (${durationMinutes}m)`;
        let matchedTask: any = null;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);

        if (dailyFile && lineContent) {
            try {
                const content = await this.app.vault.read(dailyFile);
                const allTasks = TaskParserService.parseAllTasks(content);
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
                    const clickedDescription = taskName.toLowerCase();
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
            const view = leaves[0].view as any;
            await view.startTimer(matchedTask || taskName, durationMinutes);
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
