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
                if (!pathname.startsWith('/api/')) {
                    const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
                    if (!relativePath.includes('..') && relativePath.length > 0) {
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
                            lineIndex: activeTimer.task ? activeTimer.task.lineIndex : null,
                            items: activeTimer.items || (activeTimer.task && activeTimer.task.items ? activeTimer.task.items : []),
                            completedItems: activeTimer.completedItems || []
                        } : null,
                        isAlarming,
                        focusAudio: plugin.focusAudioService ? {
                            currentTrack: plugin.focusAudioService.currentTrack ? {
                                label: plugin.focusAudioService.currentTrack.label,
                                url: plugin.focusAudioService.currentTrack.url,
                                streamUrl: plugin.focusAudioService.currentTrack.type === 'local' && plugin.focusAudioService.currentTrack.localFile
                                    ? `http://${req.headers.host || `127.0.0.1:${settings.port || 8090}`}/api/audio/stream?file=${encodeURIComponent(plugin.focusAudioService.currentTrack.localFile.path)}`
                                    : plugin.focusAudioService.currentTrack.url,
                                type: plugin.focusAudioService.currentTrack.type,
                                isInternal: plugin.focusAudioService.currentTrack.isInternal
                            } : null,
                            isPlaying: Boolean(plugin.focusAudioService.isPlaying),
                            autoSyncWithTimer: Boolean(plugin.focusAudioService.autoSyncWithTimer),
                            volume: plugin.focusAudioService.volume
                        } : null,
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
                                streamUrl = `${proto}://${host}/api/audio/stream?file=${encodeURIComponent(t.localFile.path)}`;
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

                if (req.method === 'POST' && pathname === '/api/audio/select') {
                    const body = await readBody();
                    if (plugin.focusAudioService) {
                        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                        const tracks = await plugin.focusAudioService.scanAvailableTracks(dailyFile);
                        const matched = tracks.find(t => t.url === body.url || t.label.toLowerCase() === (body.label || '').toLowerCase());
                        if (matched) {
                            plugin.focusAudioService.selectTrack(matched);
                        }
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/audio/toggle') {
                    if (plugin.focusAudioService) {
                        await plugin.focusAudioService.togglePlay();
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        isPlaying: Boolean(plugin.focusAudioService?.isPlaying)
                    }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/audio/volume') {
                    const body = await readBody();
                    if (plugin.focusAudioService && typeof body.volume === 'number') {
                        plugin.focusAudioService.setVolume(body.volume);
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, volume: plugin.focusAudioService?.volume }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/audio/stop') {
                    if (plugin.focusAudioService) {
                        plugin.focusAudioService.stop();
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, isPlaying: false }));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/audio/autosync') {
                    const body = await readBody();
                    if (plugin.focusAudioService && typeof body.enabled === 'boolean') {
                        plugin.focusAudioService.setAutoSync(body.enabled);
                    }
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, autoSyncWithTimer: plugin.focusAudioService?.autoSyncWithTimer }));
                    return;
                }

                // Audio Streaming Endpoint with full HTTP 206 Partial Content (Byte-Range)
                if (req.method === 'GET' && pathname === '/api/audio/stream') {
                    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`);
                    const fileParam = parsedUrl.searchParams.get('file');
                    if (!fileParam) {
                        setCorsHeaders();
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Missing 'file' parameter." }));
                        return;
                    }

                    const safeRelative = path.normalize(decodeURIComponent(fileParam)).replace(/^(\.\.[\/\\])+/, '');
                    const fullPath = path.join(vaultPath, safeRelative);

                    if (!fs.existsSync(fullPath)) {
                        setCorsHeaders();
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "File not found." }));
                        return;
                    }

                    const stat = fs.statSync(fullPath);
                    const totalSize = stat.size;
                    const ext = path.extname(fullPath).toLowerCase().replace('.', '');
                    const mimeTypes: { [k: string]: string } = {
                        'mp3': 'audio/mpeg',
                        'm4a': 'audio/mp4',
                        'wav': 'audio/wav',
                        'ogg': 'audio/ogg',
                        'aac': 'audio/aac',
                        'flac': 'audio/flac'
                    };
                    const contentType = mimeTypes[ext] || 'audio/mpeg';

                    const range = req.headers.range;
                    setCorsHeaders();
                    res.setHeader('Accept-Ranges', 'bytes');

                    if (range) {
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

                        if (start >= totalSize || end >= totalSize) {
                            res.writeHead(416, {
                                'Content-Range': `bytes */${totalSize}`
                            });
                            res.end();
                            return;
                        }

                        const chunkSize = (end - start) + 1;
                        res.writeHead(206, {
                            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                            'Content-Length': chunkSize,
                            'Content-Type': contentType
                        });
                        const stream = fs.createReadStream(fullPath, { start, end });
                        stream.pipe(res);
                        return;
                    } else {
                        res.writeHead(200, {
                            'Content-Length': totalSize,
                            'Content-Type': contentType
                        });
                        const stream = fs.createReadStream(fullPath);
                        stream.pipe(res);
                        return;
                    }
                }

                // RSS 2.0 / iTunes Podcast Feed Endpoint
                if (req.method === 'GET' && (pathname === '/api/feed.xml' || pathname === '/api/podcast.xml' || pathname === '/api/feed')) {
                    const host = req.headers.host || `127.0.0.1:${settings.port || 8090}`;
                    const proto = 'http';
                    const baseUrl = `${proto}://${host}`;

                    const files = this.app.vault.getFiles();
                    const audioFiles = files.filter(f => {
                        const ext = f.extension?.toLowerCase();
                        return (ext === 'mp3' || ext === 'm4a' || ext === 'wav' || ext === 'ogg') && (f.stat?.size || 0) > 1000;
                    });
                    audioFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

                    const currentTrack = plugin.focusAudioService?.currentTrack;
                    let itemsXml = '';

                    if (currentTrack) {
                        const isLocal = currentTrack.type === 'local' && currentTrack.localFile;
                        const encUrl = isLocal 
                            ? `${baseUrl}/api/audio/stream?file=${encodeURIComponent(currentTrack.localFile!.path)}`
                            : currentTrack.url;
                        const encLength = isLocal ? currentTrack.localFile!.stat.size : 1048576;
                        const encType = isLocal ? (currentTrack.localFile!.extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg') : 'audio/mpeg';

                        itemsXml += `    <item>
      <title><![CDATA[⚡ Active Focus Track: ${currentTrack.label.replace(/^🎙️\s*/, '')}]]></title>
      <description><![CDATA[Currently active focus session track in Obsidian on kilPC.]]></description>
      <link>${encUrl}</link>
      <guid isPermaLink="false">focus-active-track-${Date.now()}</guid>
      <enclosure url="${encUrl}" length="${encLength}" type="${encType}"/>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>\n`;
                    }

                    for (const f of audioFiles) {
                        const title = f.basename.replace(/_/g, ' ');
                        const streamUrl = `${baseUrl}/api/audio/stream?file=${encodeURIComponent(f.path)}`;
                        const ext = (f.extension || '').toLowerCase();
                        const encType = ext === 'm4a' ? 'audio/mp4' : (ext === 'wav' ? 'audio/wav' : 'audio/mpeg');
                        const pubDate = new Date(f.stat.mtime).toUTCString();

                        itemsXml += `    <item>
      <title><![CDATA[${title}]]></title>
      <description><![CDATA[Obsidian vault audio: ${f.path}]]></description>
      <link>${streamUrl}</link>
      <guid isPermaLink="false">${f.path}</guid>
      <enclosure url="${streamUrl}" length="${f.stat.size}" type="${encType}"/>
      <pubDate>${pubDate}</pubDate>
    </item>\n`;
                    }

                    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Obsidian Focus &amp; Podcast Feed</title>
    <link>${baseUrl}/</link>
    <description>Private self-hosted focus audio, podcasts, and daily review streams from Obsidian on kilPC.</description>
    <language>en-us</language>
    <itunes:author>Obsidian kilPC</itunes:author>
    <itunes:summary>Private self-hosted focus audio and podcast episodes.</itunes:summary>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}  </channel>
</rss>`;

                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
                    res.end(rssXml);
                    return;
                }

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
                            if (!matchedTask && !body.taskName) {
                                const now = new Date();
                                let nowMinutes = now.getHours() * 60 + now.getMinutes();
                                if (now.getHours() < 5) nowMinutes += 1440;
                                matchedTask = tasks.find(t =>
                                    t.status !== 'completed' &&
                                    !t.isUntimed &&
                                    t.startMinutes !== null &&
                                    t.endMinutes !== null &&
                                    nowMinutes >= t.startMinutes &&
                                    nowMinutes < t.endMinutes
                                );
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
                    let activeView = leaves.map(l => l.view as any).find(v => v && v.currentTimer);
                    if (!activeView && leaves.length > 0) {
                        activeView = leaves[0].view as any;
                        if (!activeView.currentTimer && plugin.activeTimer) {
                            activeView.currentTimer = plugin.activeTimer;
                        }
                    }

                    if (activeView && activeView.currentTimer) {
                        if (!activeView.currentTimer.isPaused) {
                            await activeView.togglePause();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, isPaused: true }));
                        return;
                    }

                    if (plugin.activeTimer) {
                        if (!plugin.activeTimer.isPaused) {
                            plugin.activeTimer.isPaused = true;
                            plugin.activeTimer.pausedRemainingMs = Math.max(0, (plugin.activeTimer.targetEndTime || Date.now()) - Date.now());
                            plugin.activeTimer.remainingSeconds = Math.ceil(plugin.activeTimer.pausedRemainingMs / 1000);
                            if (plugin.focusLogService) plugin.focusLogService.logPause().catch((e: any) => console.error(e));
                            if (plugin.focusAudioService) plugin.focusAudioService.onTimerPause();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, isPaused: true }));
                        return;
                    }

                    throw new Error("No timer currently active.");
                }

                if (req.method === 'POST' && pathname === '/api/timer/resume') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeView = leaves.map(l => l.view as any).find(v => v && v.currentTimer);
                    if (!activeView && leaves.length > 0) {
                        activeView = leaves[0].view as any;
                        if (!activeView.currentTimer && plugin.activeTimer) {
                            activeView.currentTimer = plugin.activeTimer;
                        }
                    }

                    if (activeView && activeView.currentTimer) {
                        if (activeView.currentTimer.isPaused) {
                            await activeView.togglePause();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, isPaused: false }));
                        return;
                    }

                    if (plugin.activeTimer) {
                        if (plugin.activeTimer.isPaused) {
                            plugin.activeTimer.isPaused = false;
                            const remainingMs = (plugin.activeTimer.pausedRemainingMs !== null && plugin.activeTimer.pausedRemainingMs !== undefined)
                                ? plugin.activeTimer.pausedRemainingMs
                                : (plugin.activeTimer.remainingSeconds * 1000);
                            plugin.activeTimer.targetEndTime = Date.now() + remainingMs;
                            plugin.activeTimer.pausedRemainingMs = null;
                            if (plugin.focusLogService) plugin.focusLogService.logResume().catch((e: any) => console.error(e));
                            if (plugin.focusAudioService) plugin.focusAudioService.onTimerResume();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, isPaused: false }));
                        return;
                    }

                    throw new Error("No timer currently active.");
                }

                if (req.method === 'POST' && pathname === '/api/timer/media-sync') {
                    const body = await readBody();
                    const state = String(body.state || '').toLowerCase().trim();
                    const app = String(body.app || 'unknown').trim();

                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeView = leaves.map(l => l.view as any).find(v => v && v.currentTimer);
                    if (!activeView && leaves.length > 0) {
                        activeView = leaves[0].view as any;
                        if (!activeView.currentTimer && plugin.activeTimer) {
                            activeView.currentTimer = plugin.activeTimer;
                        }
                    }

                    const currentTimer = (activeView && activeView.currentTimer) ? activeView.currentTimer : plugin.activeTimer;

                    if (state === 'playing') {
                        if (currentTimer && currentTimer.isPaused) {
                            if (activeView && activeView.currentTimer) {
                                await activeView.togglePause();
                            } else if (plugin.activeTimer) {
                                plugin.activeTimer.isPaused = false;
                                const remainingMs = (plugin.activeTimer.pausedRemainingMs !== null && plugin.activeTimer.pausedRemainingMs !== undefined)
                                    ? plugin.activeTimer.pausedRemainingMs
                                    : (plugin.activeTimer.remainingSeconds * 1000);
                                plugin.activeTimer.targetEndTime = Date.now() + remainingMs;
                                plugin.activeTimer.pausedRemainingMs = null;
                                if (plugin.focusLogService) plugin.focusLogService.logResume().catch((e: any) => console.error(e));
                                if (plugin.focusAudioService) plugin.focusAudioService.onTimerResume();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, action: 'resumed', app }));
                            return;
                        }

                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, action: 'none', isRunning: !!(currentTimer && !currentTimer.isPaused) }));
                        return;
                    }

                    if (state === 'paused' || state === 'stopped') {
                        if (currentTimer && !currentTimer.isPaused) {
                            if (activeView && activeView.currentTimer) {
                                await activeView.togglePause();
                            } else if (plugin.activeTimer) {
                                plugin.activeTimer.isPaused = true;
                                plugin.activeTimer.pausedRemainingMs = Math.max(0, (plugin.activeTimer.targetEndTime || Date.now()) - Date.now());
                                plugin.activeTimer.remainingSeconds = Math.ceil(plugin.activeTimer.pausedRemainingMs / 1000);
                                if (plugin.focusLogService) plugin.focusLogService.logPause().catch((e: any) => console.error(e));
                                if (plugin.focusAudioService) plugin.focusAudioService.onTimerPause();
                            }
                            setCorsHeaders();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, action: 'paused', app }));
                            return;
                        }

                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, action: 'none', isRunning: false }));
                        return;
                    }

                    setCorsHeaders();
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: "Invalid state. Expected 'playing' or 'paused'." }));
                    return;
                }

                if ((req.method === 'POST' || req.method === 'GET') && (pathname === '/api/timer/toggle' || pathname === '/api/timer/play-pause')) {
                    const toggleResult = await plugin.toggleFocusSession();
                    setCorsHeaders();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(toggleResult));
                    return;
                }

                if (req.method === 'POST' && pathname === '/api/timer/complete') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeView = leaves.map(l => l.view as any).find(v => v && (v.currentTimer || v.isAlarming));
                    if (!activeView && leaves.length > 0) {
                        activeView = leaves[0].view as any;
                        if (!activeView.currentTimer && plugin.activeTimer) {
                            activeView.currentTimer = plugin.activeTimer;
                        }
                    }

                    if (activeView && (activeView.currentTimer || activeView.isAlarming)) {
                        if (activeView.isAlarming) {
                            activeView.stopAlarm();
                        }
                        if (activeView.currentTimer) {
                            await activeView.completeTimer();
                        } else {
                            const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
                            if (dailyFile) {
                                const content = await this.app.vault.read(dailyFile);
                                const tasks = TaskParserService.parseAllTasks(content);
                                const openTask = tasks.find(t => t.status !== 'completed');
                                if (openTask) {
                                    await activeView.endActiveTask(openTask);
                                }
                            }
                            activeView.renderSchedule();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                        return;
                    }

                    if (plugin.activeTimer) {
                        if (plugin.focusAudioService) plugin.focusAudioService.onTimerComplete();
                        if (plugin.focusLogService) await plugin.focusLogService.logUpdate(true);
                        plugin.activeTimer = null;
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                        return;
                    }

                    throw new Error("No active timer or alarm to complete.");
                }

                if (req.method === 'POST' && pathname === '/api/timer/cancel') {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_TIMER);
                    let activeView = leaves.map(l => l.view as any).find(v => v && (v.currentTimer || v.isAlarming));
                    if (!activeView && leaves.length > 0) {
                        activeView = leaves[0].view as any;
                        if (!activeView.currentTimer && plugin.activeTimer) {
                            activeView.currentTimer = plugin.activeTimer;
                        }
                    }

                    if (activeView && (activeView.currentTimer || activeView.isAlarming)) {
                        if (activeView.currentTimer) {
                            await activeView.cancelTimer();
                        }
                        if (activeView.isAlarming) {
                            activeView.stopAlarm();
                            activeView.renderSchedule();
                        }
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                        return;
                    }

                    if (plugin.activeTimer) {
                        if (plugin.focusAudioService) plugin.focusAudioService.onTimerCancel();
                        if (plugin.focusLogService) await plugin.focusLogService.logUpdate(false);
                        plugin.activeTimer = null;
                        setCorsHeaders();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                        return;
                    }

                    throw new Error("No active timer to cancel.");
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
                    return;
                }

                // Static vault file streaming & APK download handler
                if (req.method === 'GET' && !pathname.startsWith('/api/')) {
                    const relativePath = decodeURIComponent(pathname.replace(/^\//, ''));
                    let binaryData: Buffer | null = null;
                    let fileName = path.basename(relativePath);
                    let ext = path.extname(relativePath).replace(/^\./, '').toLowerCase();

                    const file = this.app.vault.getAbstractFileByPath(relativePath);
                    if (file && 'extension' in file) {
                        const tFile = file as any;
                        const arrayBuffer = await this.app.vault.readBinary(tFile);
                        binaryData = Buffer.from(arrayBuffer);
                        ext = (tFile.extension || ext).toLowerCase();
                        fileName = path.basename(tFile.name || relativePath);
                    } else {
                        const basePath = (this.app.vault.adapter as any).basePath || process.cwd();
                        const diskPath = path.resolve(basePath, relativePath);
                        if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
                            binaryData = fs.readFileSync(diskPath);
                        }
                    }

                    if (binaryData) {
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
                            'Content-Length': binaryData.length,
                            'Content-Disposition': `attachment; filename="${fileName}"`
                        });
                        res.end(binaryData);
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
