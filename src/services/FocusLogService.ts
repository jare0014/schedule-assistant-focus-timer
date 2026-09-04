/**
 * FocusLogService.ts - Logs focus sessions, pause timestamps, and completion times in Obsidian daily notes.
 */

import { App, Notice } from 'obsidian';
import { ActiveLogState } from '../types';
import { DailyNoteManager } from './DailyNoteManager';

export class FocusLogService {
    public activeLog: ActiveLogState | null = null;

    constructor(private app: App) {}

    public async logStart(taskName: string, durationMinutes: number): Promise<void> {
        if (this.activeLog) {
            await this.logUpdate(false);
        }

        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
        if (!dailyFile) {
            new Notice("Daily note not found! Cannot log timer.");
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

            let logHeaderIndex = lines.findIndex(l => l.includes('### Focus Log'));
            if (logHeaderIndex === -1) {
                logHeaderIndex = lines.findIndex(l => l.includes('## 🪵 Log'));
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
                startTimeStr,
                taskName,
                logLine,
                pauses: [],
                resumes: []
            };
        } catch (e) {
            console.error("Error logging start:", e);
        }
    }

    public async logPause(): Promise<void> {
        if (!this.activeLog) return;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
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

    public async logResume(): Promise<void> {
        if (!this.activeLog) return;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
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

    public async logUpdate(isCompleted: boolean): Promise<void> {
        if (!this.activeLog) return;

        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
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
}
