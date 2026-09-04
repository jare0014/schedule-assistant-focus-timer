/**
 * DailyNoteManager.ts - Resolves, parses, and updates Obsidian daily notes and timeblocked tasks.
 */

import { App, TFile, Notice, MarkdownView } from 'obsidian';
import { TaskItem } from '../types';
import { TaskParserService } from './TaskParserService';

export class DailyNoteManager {
    public static normalizeTimeRangeSpaces(line: string): string {
        if (!line) return line;
        const regex = /^((\s*-\s+\[[ xX/]\]\s+)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[\-–—~]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*)(.*)$/i;
        const match = line.match(regex);
        if (match) {
            const timePrefix = match[1];
            const taskDesc = match[3];
            const trimmedPrefix = timePrefix.trim();
            const trimmedDesc = taskDesc.trim();
            return trimmedDesc ? `${trimmedPrefix} ${trimmedDesc}` : trimmedPrefix;
        }
        return line;
    }

    public static getDailyNoteFile(app: App): TFile | null {
        if (!app || !app.vault) return null;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayDateStr = `${year}-${month}-${day}`;

        const files = app.vault.getFiles();

        let noteFile = files.find(f => f.basename === todayDateStr || f.name === `${todayDateStr}.md`);
        if (noteFile) return noteFile;

        noteFile = files.find(f => f.path && f.path.includes(todayDateStr));
        if (noteFile) return noteFile;

        const activeFile = app.workspace ? app.workspace.getActiveFile() : null;
        if (activeFile && activeFile.basename === todayDateStr) {
            return activeFile;
        }

        return null;
    }

    public static getClickedLineContent(activeView: MarkdownView | null): string | null {
        if (!activeView) return null;
        try {
            const editor = activeView.editor;
            if (editor) {
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);
                if (line && line.trim()) return line;
            }
        } catch (e) {}

        const activeEl = document.activeElement;
        if (activeEl) {
            const listItem = activeEl.closest('li') || activeEl.closest('.task-list-item');
            if (listItem) {
                return listItem.textContent || null;
            }
        }
        return null;
    }

    public static async postponeTask(app: App, task: Partial<TaskItem>): Promise<boolean> {
        const dailyFile = this.getDailyNoteFile(app);
        if (!dailyFile) {
            new Notice("Daily note not found!");
            return false;
        }

        let content = "";
        try {
            content = await app.vault.read(dailyFile);
        } catch (e) {
            new Notice("Could not read daily note!");
            return false;
        }

        const lines = content.split(/\r?\n/);
        const allTasks = TaskParserService.parseAllTasks(content);

        let currentTask = allTasks.find(t => t.lineIndex === task.lineIndex);
        if (!currentTask || !lines[currentTask.lineIndex] || !lines[currentTask.lineIndex].toLowerCase().includes((task.description || '').toLowerCase().trim())) {
            currentTask = allTasks.find(t => t.description.toLowerCase().trim() === (task.description || '').toLowerCase().trim() && t.status === 'pending');
        }

        if (!currentTask) {
            new Notice("Could not find the task in daily note!");
            return false;
        }

        if (currentTask.isUntimed) {
            new Notice("Untimed tasks cannot be postponed!");
            return false;
        }

        const now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (now.getHours() < 5) currentMinutes += 1440;

        const busyIntervals = allTasks
            .filter(t => t.status !== 'completed' && !t.isUntimed && (t.endMinutes || 0) > currentMinutes && t.lineIndex !== currentTask!.lineIndex)
            .map(t => ({
                start: t.startMinutes || 0,
                end: t.endMinutes || 0
            }));

        busyIntervals.sort((a, b) => a.start - b.start);

        let newStart = currentMinutes;
        const duration = currentTask.duration || 20;

        for (const interval of busyIntervals) {
            if (interval.start - newStart >= duration) break;
            newStart = Math.max(newStart, interval.end);
        }

        const newEnd = newStart + duration;
        if (newEnd > 1740) {
            new Notice("Cannot reschedule: task would go past tomorrow morning!");
            return false;
        }

        const newStartH = String(Math.floor(newStart / 60) % 24).padStart(2, '0');
        const newStartM = String(newStart % 60).padStart(2, '0');
        const newEndH = String(Math.floor(newEnd / 60) % 24).padStart(2, '0');
        const newEndM = String(newEnd % 60).padStart(2, '0');
        const newTimeRange = `${newStartH}:${newStartM} - ${newEndH}:${newEndM}`;

        const originalLine = lines[currentTask.lineIndex];
        const oldTimeRangeRegex = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*[\-–—~]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\b/;
        const newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange);
        lines[currentTask.lineIndex] = this.normalizeTimeRangeSpaces(newLine);

        // Re-sort within subheading
        let inPlanner = false;
        let currentSubheading = "";
        const subheadingIndices: number[] = [];
        const fileTaskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes("## 📅Day Planner")) { inPlanner = true; continue; }
            if (inPlanner && line.startsWith('## ') && !line.includes("## 📅Day Planner")) break;
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
                const m = line.match(fileTaskRegex)!;
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
                return { line, startMinutes: startMins };
            });

            subheadingTasks.sort((a, b) => a.startMinutes - b.startMinutes);

            for (let i = 0; i < subheadingIndices.length; i++) {
                lines[subheadingIndices[i]] = subheadingTasks[i].line;
            }
        }

        try {
            await app.vault.modify(dailyFile, lines.join('\n'));
            new Notice(`Rescheduled task to ${newTimeRange}`);
            return true;
        } catch (e) {
            new Notice("Failed to update daily note!");
            return false;
        }
    }

    public static async removeTask(app: App, task: Partial<TaskItem>): Promise<boolean> {
        const dailyFile = this.getDailyNoteFile(app);
        if (!dailyFile) return false;

        try {
            const content = await app.vault.read(dailyFile);
            const lines = content.split(/\r?\n/);

            let lineIndex = task.lineIndex;
            if (lineIndex === undefined || lineIndex >= lines.length || !lines[lineIndex].includes(task.description || '')) {
                lineIndex = lines.findIndex(l => l.includes(task.description || '') && (l.includes('- [ ]') || l.includes('- [x]')));
            }

            if (lineIndex !== -1) {
                lines.splice(lineIndex, 1);
                await app.vault.modify(dailyFile, lines.join('\n'));
                new Notice(`Task "${task.description}" removed from today's list.`);
                return true;
            } else {
                new Notice("Could not find task in daily note to remove.");
                return false;
            }
        } catch (e) {
            console.error("Failed to remove task:", e);
            new Notice("Error updating daily note.");
            return false;
        }
    }

    public static async postponeClickedTask(app: App): Promise<void> {
        const activeView = app.workspace.getActiveViewOfType(MarkdownView);
        const lineContent = this.getClickedLineContent(activeView);
        if (!lineContent) {
            new Notice("Could not identify the clicked task line!");
            return;
        }

        const clickedTaskRegex = /^(?:\s*-\s+\[[ xX]\])?\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
        const match = lineContent.match(clickedTaskRegex);

        let clickedStartMinutes: number | null = null;
        let clickedEndMinutes: number | null = null;
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
            clickedDescription = lineContent;
        }

        clickedDescription = clickedDescription
            .replace(/^\s*-\s+\[[ x]\]\s*/, '')
            .replace(/^\s*-\s*/, '')
            .replace(/`?BUTTON\[[^\]]+\]`?/g, '')
            .replace(/\[src\]\(.*?\)/g, '')
            .replace(/\s+src$/i, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/#\w+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        const dailyFile = (activeView && activeView.file) || this.getDailyNoteFile(app);
        if (!dailyFile) {
            new Notice("No daily note file found for today!");
            return;
        }

        let content = "";
        try {
            content = await app.vault.read(dailyFile);
        } catch (e) {
            new Notice("Could not read daily note!");
            return;
        }

        const allTasks = TaskParserService.parseAllTasks(content);
        const task = allTasks.find(t => {
            if (clickedStartMinutes !== null && clickedEndMinutes !== null) {
                const timeMatches = (t.startMinutes === clickedStartMinutes && t.endMinutes === clickedEndMinutes);
                if (!timeMatches) return false;
            }
            const fileDesc = t.description.toLowerCase();
            return fileDesc.includes(clickedDescription) || clickedDescription.includes(fileDesc);
        });

        if (task) {
            await this.postponeTask(app, task);
        } else {
            new Notice("Could not match the clicked line to any scheduled task!");
        }
    }
}
