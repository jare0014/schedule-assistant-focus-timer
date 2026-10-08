/**
 * FocusLogService.ts - Logs focus sessions, pause timestamps, and completion times in Obsidian daily notes.
 */

import { App, Notice, TFile } from 'obsidian';
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
        const completedValue = isCompleted ? actualEndTimeStr : 'cancelled';

        try {
            const content = await this.app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);

            let replaced = false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === logInfo.logLine.trim()) {
                    lines[i] = lines[i].replace(/\[completed-time:: [^\]]*\]/, `[completed-time:: ${completedValue}]`);
                    replaced = true;
                    break;
                }
            }

            if (!replaced) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(`[start-time:: ${logInfo.startTimeStr}]`) && lines[i].includes(`[focus:: ${logInfo.taskName}]`)) {
                        lines[i] = lines[i].replace(/\[completed-time:: [^\]]*\]/, `[completed-time:: ${completedValue}]`);
                        break;
                    }
                }
            }

            await this.app.vault.modify(dailyFile, lines.join('\n'));

            if (isCompleted) {
                await this.updateFrontmatterForCompletedSession(dailyFile, logInfo, actualEndTimeStr);
            }
        } catch (e) {
            console.error("Error logging update:", e);
        }
    }

    public async updateFrontmatterForCompletedSession(
        file: TFile,
        logInfo: ActiveLogState,
        actualEndTimeStr: string
    ): Promise<void> {
        try {
            const parseSecs = (str: string): number => {
                const parts = str.split(':').map(Number);
                return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
            };

            let grossSecs = parseSecs(actualEndTimeStr) - parseSecs(logInfo.startTimeStr);
            if (grossSecs < 0) grossSecs += 86400;

            for (let i = 0; i < Math.min(logInfo.pauses.length, logInfo.resumes.length); i++) {
                const ps = parseSecs(logInfo.pauses[i]);
                const pe = parseSecs(logInfo.resumes[i]);
                let pSecs = pe - ps;
                if (pSecs < 0) pSecs += 86400;
                grossSecs -= pSecs;
            }

            const elapsedMins = Math.max(1, Math.round(grossSecs / 60));
            const cleanTaskName = logInfo.taskName.replace(/\[\[.*?\]\]/g, '').trim();

            const isExercise = /(?:Exercise|Workout|Gym|Weights|Walk|Run|Cardio|Training|Stretching|Yoga|Fitness)/i.test(cleanTaskName);
            const isMeditation = /(?:Meditation|Mindfulness)/i.test(cleanTaskName);

            if (!isExercise && !isMeditation) return;

            await this.app.fileManager.processFrontMatter(file, (fm) => {
                if (isExercise) {
                    const sessionEntry = `${cleanTaskName} (${elapsedMins}m)`;
                    const existingWorkout = String(fm.workout || "").trim();
                    if (!existingWorkout) {
                        fm.workout = sessionEntry;
                    } else {
                        const parts = existingWorkout.split(',').map((s: string) => s.trim()).filter(Boolean);
                        const matchIdx = parts.findIndex((p: string) => p.toLowerCase().startsWith(cleanTaskName.toLowerCase()));
                        if (matchIdx !== -1) {
                            parts[matchIdx] = sessionEntry;
                            fm.workout = parts.join(', ');
                        } else {
                            parts.push(sessionEntry);
                            fm.workout = parts.join(', ');
                        }
                    }
                }

                if (isMeditation) {
                    const currentMind = parseInt(String(fm.mindfulness_minutes || fm.meditation || 0), 10);
                    fm.mindfulness_minutes = String((isNaN(currentMind) ? 0 : currentMind) + elapsedMins);
                }
            });
        } catch (err) {
            console.warn("[FocusLogService] Could not update frontmatter for completed session:", err);
        }
    }
}
