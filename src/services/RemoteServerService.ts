/**
 * RemoteServerService.ts - HTTP REST server for Android mobile widget, Watch, and web client sync.
 */

import { App, Notice } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { VIEW_TYPE_TASK_TIMER, TaskTimerPluginSettings } from '../types';
import { DailyNoteManager } from './DailyNoteManager';
import { TaskParserService } from './TaskParserService';
import { WeeklyHabitService } from './WeeklyHabitService';

export class RemoteServerService {
    private server: (http.Server & { _sockets?: Set<any> }) | null = null;

    constructor(
        private app: App,
        private getPlugin: () => any,
        private getSettings: () => TaskTimerPluginSettings
    ) {}

    public async startServer(retryCount = 0): Promise<void> {
        await this.stopServer();

        const plugin = this.getPlugin();
        const settings = this.getSettings();
        const port = parseInt(settings.serverPort) || 8089;
        const vaultPath = (this.app.vault.adapter as any).getBasePath();
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

            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const pathname = url.pathname;

            try {
                // Static web client assets
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

                // Serve files from Obsidian vault (for Markdown mobile sync)
                const relativePath = decodeURIComponent(pathname);
                if (!relativePath.includes('..')) {
                    const fullVaultFilePath = path.join(vaultPath, relativePath);
                    if (req.method === 'GET' && fs.existsSync(fullVaultFilePath) && fs.statSync(fullVaultFilePath).isFile()) {
                        let contentType = 'text/plain; charset=utf-8';
                        if (relativePath.endsWith('.md')) {
                            contentType = 'text/markdown; charset=utf-8';
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': contentType });
                        res.end(fs.readFileSync(fullVaultFilePath));
                        return;
                    }
                }

                if (req.method === 'GET' && pathname === '/api/status') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeTimer = plugin.activeTimer || null;
                    let isAlarming = false;
                    if (leaves.length > 0) {
                        const view = leaves[0].view as any;
                        if (view.currentTimer) {
                            activeTimer = view.currentTimer;
                        }
                        isAlarming = view.isAlarming;
                    }

                    let dynamicRemaining = 0;
                    if (activeTimer) {
                        if (activeTimer.isPaused) {
                            dynamicRemaining = activeTimer.remainingSeconds || Math.ceil((activeTimer.pausedRemainingMs || 0) / 1000);
                        } else if (activeTimer.targetEndTime) {
                            const remainingMs = Math.max(0, activeTimer.targetEndTime - Date.now());
                            dynamicRemaining = Math.ceil(remainingMs / 1000);
                            activeTimer.remainingSeconds = dynamicRemaining;
                        } else {
                            dynamicRemaining = activeTimer.remainingSeconds || 0;
                        }
                    }

                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    let schedule: any[] = [];
                    let hasDailyNote = false;
                    let dateStr = "";
                    if (dailyFile) {
                        hasDailyNote = true;
                        try {
                            const content = await this.app.vault.read(dailyFile);
                            schedule = TaskParserService.parseAllTasks(content);
                            const now = new Date();
                            dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                        } catch (e) {
                            console.error("Failed to read daily note in API:", e);
                        }
                    }

                    let todayHabits: any = { morning: [], work: [], house: [] };
                    try {
                        const weeklyData = await WeeklyHabitService.loadTodayWeeklyHabits(this.app);
                        if (weeklyData && weeklyData.habitsBySection) {
                            todayHabits = {
                                morning: (weeklyData.habitsBySection.morning || []).map(h => ({ name: h.name, completed: h.completed, rowIdx: h.rowIdx, sectionKey: h.sectionKey })),
                                work: (weeklyData.habitsBySection.work || []).map(h => ({ name: h.name, completed: h.completed, rowIdx: h.rowIdx, sectionKey: h.sectionKey })),
                                house: (weeklyData.habitsBySection.house || []).map(h => ({ name: h.name, completed: h.completed, rowIdx: h.rowIdx, sectionKey: h.sectionKey }))
                            };
                        }
                    } catch (err) {
                        console.error("Failed to load today's weekly habits:", err);
                    }

                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        hasDailyNote,
                        dateStr,
                        serverNow: Date.now(),
                        activeTimer: activeTimer ? {
                            taskName: activeTimer.task?.description || activeTimer.taskName || "Focus Task",
                            remainingSeconds: dynamicRemaining,
                            totalSeconds: activeTimer.totalSeconds,
                            targetEndTime: activeTimer.targetEndTime || null,
                            isPaused: activeTimer.isPaused,
                            status: activeTimer.task ? activeTimer.task.status : 'pending',
                            lineIndex: activeTimer.task ? activeTimer.task.lineIndex : null
                        } : null,
                        isAlarming,
                        todayHabits,
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
                            project: t.project || null,
                            isUntimed: t.isUntimed || false,
                            parentLineIndex: t.parentLineIndex !== undefined ? t.parentLineIndex : undefined
                        }))
                    }));
                    return;
                }

                if (req.method === 'GET' && pathname === '/api/audio/tracks') {
                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    let tracks: any[] = [];
                    if (plugin.focusAudioService) {
                        const rawTracks = await plugin.focusAudioService.scanAvailableTracks(dailyFile);
                        const host = req.headers.host || `127.0.0.1:${settings.port || 8090}`;
                        const proto = 'http';
                        tracks = rawTracks.map(t => {
                            let streamUrl = t.url;
                            if (t.type === 'local' && t.localFile) {
                                streamUrl = `${proto}://${host}/${encodeURIComponent(t.localFile.path).replace(/%2F/g, '/')}`;
                            }
                            return {
                                label: t.label,
                                url: t.url,
                                streamUrl: streamUrl,
                                type: t.type,
                                isInternal: t.isInternal,
                                videoId: t.videoId,
                                playlistId: t.playlistId
                            };
                        });
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        tracks: tracks,
                        currentTrack: plugin.focusAudioService?.currentTrack ? {
                            label: plugin.focusAudioService.currentTrack.label,
                            url: plugin.focusAudioService.currentTrack.url,
                            type: plugin.focusAudioService.currentTrack.type
                        } : null,
                        isPlaying: Boolean(plugin.focusAudioService?.isPlaying)
                    }));
                    return;
                }

                const readBody = () => new Promise<any>((resolve) => {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        try {
                            resolve(JSON.parse(body || '{}'));
                        } catch (e) {
                            resolve({});
                        }
                    });
                });

                if (req.method === 'POST' && pathname === '/api/timer/start') {
                    const body = await readBody();
                    await plugin.activateView();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view as any;
                        let matchedTask: any = null;
                        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                        if (dailyFile) {
                            const content = await this.app.vault.read(dailyFile);
                            const tasks = TaskParserService.parseAllTasks(content);
                            if (typeof body.lineIndex === 'number') {
                                matchedTask = tasks.find(t => t.lineIndex === body.lineIndex);
                            }
                            if (!matchedTask && body.taskName) {
                                matchedTask = tasks.find(t => t.description.toLowerCase() === body.taskName.toLowerCase());
                            }
                        }

                        const taskInput = matchedTask || body.taskName || "Focus Block";
                        const duration = parseInt(body.durationMinutes) || (matchedTask ? matchedTask.duration : null) || parseInt(settings.defaultDuration) || 20;

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
                        const view = leaves[0].view as any;
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
                        const view = leaves[0].view as any;
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

                if ((req.method === 'POST' || req.method === 'GET') && (pathname === '/api/timer/toggle' || pathname === '/api/timer/play-pause')) {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let view: any = null;
                    if (leaves.length > 0) {
                        view = leaves[0].view as any;
                    }

                    if (view && view.currentTimer) {
                        await view.togglePause();
                        const audioSvc = plugin.focusAudioService;
                        const handledInternalAudio = Boolean(
                            audioSvc &&
                            audioSvc.autoSyncWithTimer &&
                            audioSvc.currentTrack &&
                            audioSvc.currentTrack.type !== 'external_web'
                        );
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            isPaused: view.currentTimer.isPaused,
                            taskName: view.currentTimer.taskName,
                            handledInternalAudio: handledInternalAudio
                        }));
                        return;
                    }

                    if (plugin.focusAudioService) {
                        await plugin.focusAudioService.togglePlay();
                        const audioSvc = plugin.focusAudioService;
                        const handledInternalAudio = Boolean(
                            audioSvc &&
                            audioSvc.currentTrack &&
                            audioSvc.currentTrack.type !== 'external_web'
                        );
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            isAudioPlaying: plugin.focusAudioService.isPlaying,
                            handledInternalAudio: handledInternalAudio
                        }));
                        return;
                    }

                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "No active timer or audio player" }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/complete') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view as any;
                        if (view.currentTimer || view.isAlarming) {
                            if (view.isAlarming) {
                                view.stopAlarm();
                            }
                            if (view.currentTimer) {
                                await view.completeTimer();
                            } else {
                                const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                                if (dailyFile) {
                                    const content = await this.app.vault.read(dailyFile);
                                    const tasks = TaskParserService.parseAllTasks(content);
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
                        const view = leaves[0].view as any;
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
                    plugin.runTaskLoader(true).catch((e: any) => console.error("API schedule generation background task failed:", e));
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: "Schedule generation triggered successfully" }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/adjust') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    if (leaves.length > 0) {
                        const view = leaves[0].view as any;
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
                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        let lines = content.split(/\r?\n/);
                        let targetIdx = body.lineIndex;
                        const desc = (body.description || body.text || '').toLowerCase().trim();

                        if (targetIdx === undefined || targetIdx >= lines.length || (desc && !lines[targetIdx].toLowerCase().includes(desc))) {
                            targetIdx = lines.findIndex(l => 
                                (desc ? l.toLowerCase().includes(desc) : false) && 
                                (l.includes("- [ ]") || l.includes("- [x]") || l.includes("- [/]"))
                            );
                        }

                        if (targetIdx !== -1) {
                            const origLine = lines[targetIdx];
                            const complete = Boolean(body.complete);
                            if (complete) {
                                lines[targetIdx] = origLine.replace("- [ ]", "- [x]").replace("- [/]", "- [x]");
                            } else {
                                lines[targetIdx] = origLine.replace("- [x]", "- [ ]");
                            }

                            // Also toggle child subtasks if indented
                            const parentIndent = origLine.match(/^(\s*)/)![1].length;
                            for (let i = targetIdx + 1; i < lines.length; i++) {
                                const childLine = lines[i];
                                if (!childLine.trim()) continue;
                                const childIndent = childLine.match(/^(\s*)/)![1].length;
                                if (childIndent <= parentIndent) break;

                                if (childLine.includes("- [ ]") || childLine.includes("- [x]") || childLine.includes("- [/]")) {
                                    if (complete) {
                                        lines[i] = childLine.replace("- [ ]", "- [x]").replace("- [/]", "- [x]");
                                    } else {
                                        lines[i] = childLine.replace("- [x]", "- [ ]");
                                    }
                                }
                            }

                            if (plugin.externalTaskSyncService) {
                                await plugin.externalTaskSyncService.toggleTaskStatusByLineText(origLine, complete);
                            }

                            await this.app.vault.modify(dailyFile, lines.join("\n"));

                            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                            if (leaves.length > 0 && typeof (leaves[0].view as any)?.renderSchedule === 'function') {
                                try { (leaves[0].view as any).renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
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

                if (req.method === 'POST' && pathname === '/api/habit/toggle') {
                    const body = await readBody();
                    const section = body.section;
                    const habitIdentifier = body.rowIdx !== undefined ? body.rowIdx : body.name;
                    const completed = Boolean(body.completed);

                    if (!section || habitIdentifier === undefined) {
                        setCorsHeaders();
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Missing section or habit identifier." }));
                        return;
                    }

                    const success = await WeeklyHabitService.toggleWeeklyHabit(this.app, section, habitIdentifier, completed);
                    if (success) {
                        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                        if (leaves.length > 0 && typeof (leaves[0].view as any)?.renderSchedule === 'function') {
                            try { (leaves[0].view as any).renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                        return;
                    } else {
                        setCorsHeaders();
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Failed to toggle weekly habit item." }));
                        return;
                    }
                }

                if (req.method === 'POST' && pathname === '/api/task/postpone') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    const view = leaves.length > 0 ? (leaves[0].view as any) : null;
                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        const tasks = TaskParserService.parseAllTasks(content);
                        const task = tasks.find(t => t.lineIndex === body.lineIndex);
                        if (task) {
                            if (view) {
                                if (view.currentTimer && view.currentTimer.task?.lineIndex === task.lineIndex) {
                                    view.clearTimer();
                                    view.currentTimer = null;
                                    await plugin.focusLogService?.logUpdate(false);
                                }
                                if (view.isAlarming) {
                                    view.stopAlarm();
                                }
                            }
                            await DailyNoteManager.postponeTask(this.app, task);
                            if (view && typeof view.renderSchedule === 'function') {
                                try { view.renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
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
                    const view = leaves.length > 0 ? (leaves[0].view as any) : null;
                    if (view) {
                        if (typeof view.handleTaskDrop === 'function') {
                            await view.handleTaskDrop(body.draggedTask, body.targetSubheading);
                        }
                        if (typeof view.renderSchedule === 'function') {
                            try { view.renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
                        }
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/task/nottoday') {
                    const body = await readBody();
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    const view = leaves.length > 0 ? (leaves[0].view as any) : null;
                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        const tasks = TaskParserService.parseAllTasks(content);
                        let task = tasks.find(t => t.lineIndex === body.lineIndex);
                        if (!task && body.description) {
                            const dClean = body.description.toLowerCase().trim();
                            task = tasks.find(t => t.description.toLowerCase().trim().includes(dClean) || dClean.includes(t.description.toLowerCase().trim()));
                        }
                        if (task) {
                            if (view) {
                                if (view.currentTimer && view.currentTimer.task?.lineIndex === task.lineIndex) {
                                    view.clearTimer();
                                    view.currentTimer = null;
                                    await plugin.focusLogService?.logUpdate(false);
                                }
                                if (view.isAlarming) {
                                    view.stopAlarm();
                                }
                            }
                            await DailyNoteManager.removeTask(this.app, task);
                            if (view && typeof view.renderSchedule === 'function') {
                                try { view.renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
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

                if (req.method === 'POST' && pathname === '/api/task/delete') {
                    const body = await readBody();
                    const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                    if (dailyFile) {
                        const content = await this.app.vault.read(dailyFile);
                        let lines = content.split(/\r?\n/);
                        let lineIndex = body.lineIndex;
                        const desc = (body.description || body.text || '').toLowerCase().trim();
                        if (lineIndex === undefined || lineIndex >= lines.length || (desc && !lines[lineIndex].toLowerCase().includes(desc))) {
                            lineIndex = lines.findIndex(l => (desc ? l.toLowerCase().includes(desc) : false) && (l.includes('- [ ]') || l.includes('- [x]') || l.includes('- [/]')));
                        }
                        if (lineIndex !== -1) {
                            const parentIndent = lines[lineIndex].match(/^(\s*)/)![1].length;
                            let endIndex = lineIndex + 1;
                            while (endIndex < lines.length) {
                                const child = lines[endIndex];
                                if (!child.trim()) { endIndex++; continue; }
                                if (child.match(/^(\s*)/)![1].length <= parentIndent) break;
                                endIndex++;
                            }
                            // Also check if immediately following lines are a weeklyTableTracker block for this task
                            if (endIndex < lines.length && lines[endIndex].trim().startsWith('```dataviewjs')) {
                                let dvEnd = endIndex + 1;
                                while (dvEnd < lines.length && !lines[dvEnd].trim().startsWith('```')) {
                                    dvEnd++;
                                }
                                if (dvEnd < lines.length) {
                                    const dvBlock = lines.slice(endIndex, dvEnd + 1).join('\n');
                                    if (desc && dvBlock.toLowerCase().includes(desc)) {
                                        endIndex = dvEnd + 1;
                                    }
                                }
                            }
                            lines.splice(lineIndex, endIndex - lineIndex);
                            await this.app.vault.modify(dailyFile, lines.join('\n'));
                            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                            if (leaves.length > 0 && typeof (leaves[0].view as any)?.renderSchedule === 'function') {
                                try { (leaves[0].view as any).renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                            return;
                        } else {
                            // If not found as a markdown task, check if it exists purely as a dataviewjs weeklyTableTracker block
                            if (desc) {
                                const dvIdx = lines.findIndex((l, idx) => {
                                    if (l.trim().startsWith('```dataviewjs')) {
                                        const snippet = lines.slice(idx, idx + 10).join('\n').toLowerCase();
                                        return snippet.includes('weeklytabletracker') && snippet.includes(desc);
                                    }
                                    return false;
                                });
                                if (dvIdx !== -1) {
                                    let dvEnd = dvIdx + 1;
                                    while (dvEnd < lines.length && !lines[dvEnd].trim().startsWith('```')) {
                                        dvEnd++;
                                    }
                                    const deleteCount = (dvEnd < lines.length ? dvEnd + 1 : dvIdx + 1) - dvIdx;
                                    lines.splice(dvIdx, deleteCount);
                                    await this.app.vault.modify(dailyFile, lines.join('\n'));
                                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                                    if (leaves.length > 0 && typeof (leaves[0].view as any)?.renderSchedule === 'function') {
                                        try { (leaves[0].view as any).renderSchedule(); } catch (e) { console.error("renderSchedule error:", e); }
                                    }
                                    setCorsHeaders();
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: true, removedTracker: true }));
                                    return;
                                }
                            }
                            // If neither task line nor tracker found, it was already deleted! Return 200 idempotent success
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, message: "Task was already deleted" }));
                            return;
                        }
                    }
                    setCorsHeaders();
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Daily note unavailable.' }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/quicklog') {
                    const body = await readBody();
                    const foodId = body.foodId;
                    const amount = body.amount || 1;
                    if (!foodId) {
                        setCorsHeaders();
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Missing foodId parameter." }));
                        return;
                    }
                    const scriptPath = path.join(vaultPath, '.obsidian', 'plugins', 'omni-logger', 'post_nutrition.py');
                    const registryPath = path.join(vaultPath, '99_System', 'Omni_Templates', 'health_go_to_items.json');
                    const proc = spawn('python', [scriptPath, '--id', foodId, '--amount', String(amount), '--registry', registryPath]);
                    let stdout = '', stderr = '';
                    proc.stdout.on('data', d => stdout += d);
                    proc.stderr.on('data', d => stderr += d);
                    proc.on('close', (code) => {
                        setCorsHeaders();
                        res.writeHead(code === 0 ? 200 : 500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
                    });
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/braindump') {
                    const body = await readBody();
                    const text = (body.text || '').trim();
                    if (!text) {
                        setCorsHeaders();
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Empty brain dump text." }));
                        return;
                    }
                    const now = new Date();
                    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const fileName = `00_Imports/BrainDump ${ts}.md`;
                    const noteContent = `---\nsource: brain-dump\ncreated: ${now.toISOString()}\nstatus: unprocessed\n---\n\n${text}\n`;
                    try {
                        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
                        if (!existingFile) {
                            await this.app.vault.create(fileName, noteContent);
                        }
                        new Notice(`Brain dump saved: ${fileName}`);
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, file: fileName }));
                    } catch (e: any) {
                        setCorsHeaders();
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                    // Static vault file streaming & APK download handler
                if (req.method === 'GET' && !pathname.startsWith('/api/')) {
                    const relativePath = decodeURIComponent(pathname.replace(/^\//, ''));
                    const file = this.app.vault.getAbstractFileByPath(relativePath);
                    if (file && 'extension' in file) {
                        const tFile = file as any;
                        const binaryData = await this.app.vault.readBinary(tFile);
                        const ext = (tFile.extension || '').toLowerCase();
                        const mimeTypes: { [k: string]: string } = {
                            'mp3': 'audio/mpeg',
                            'm4a': 'audio/mp4',
                            'wav': 'audio/wav',
                            'ogg': 'audio/ogg',
                            'apk': 'application/vnd.android.package-archive',
                            'png': 'image/png',
                            'jpg': 'image/jpeg'
                        };
                        const contentType = mimeTypes[ext] || 'application/octet-stream';
                        setCorsHeaders();
                        res.writeHead(200, {
                            'Content-Type': contentType,
                            'Content-Length': binaryData.byteLength
                        });
                        res.end(Buffer.from(binaryData));
                        return;
                    }
                }

                setCorsHeaders();
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end("Endpoint not found");

            } catch (err: any) {
                console.error("API error:", err);
                setCorsHeaders();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message || "Internal server error" }));
            }
        });

        this.server._sockets = new Set();
        this.server.on('connection', (socket) => {
            this.server?._sockets?.add(socket);
            socket.on('close', () => {
                this.server?._sockets?.delete(socket);
            });
        });

        const maxRetries = 5;
        this.server.on('error', (err: any) => {
            console.error("Remote server startup failed:", err);
            if (err.code === 'EADDRINUSE' && retryCount < maxRetries) {
                const nextRetry = retryCount + 1;
                new Notice(`Port ${port} in use, retrying in 1s (attempt ${nextRetry}/${maxRetries})...`);
                setTimeout(() => {
                    this.startServer(nextRetry);
                }, 1000);
            } else {
                new Notice(`Focus Timer Server failed to start on port ${port}: ${err.message}`);
            }
        });

        this.server.listen(port, '0.0.0.0', () => {
            console.log(`Focus Timer Server running on 0.0.0.0:${port}`);
            new Notice(`Focus Timer Server started on port ${port}`);
        });
    }

    public stopServer(): Promise<void> {
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
                        try { socket.destroy(); } catch (e) {}
                    }
                }
            } catch (e) {
                console.error("Socket destruction error", e);
            }

            try {
                if (typeof (this.server as any).closeAllConnections === 'function') {
                    (this.server as any).closeAllConnections();
                }
            } catch (e) {
                console.error("closeAllConnections error", e);
            }

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
            } catch (e) {
                console.error("Error stopping remote server:", e);
                clearTimeout(timeout);
                done();
            }
        });
    }
}
