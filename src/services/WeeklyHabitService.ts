/**
 * WeeklyHabitService.ts - Service for loading and toggling weekly habits and routines.
 */

import { App, TFile } from 'obsidian';

export interface HabitItemForDay {
    name: string;
    completed: boolean;
    rowIdx: number;
    colIdx: number;
    sectionKey: string;
}

export class WeeklyHabitService {
    public static getWeeklyNoteFile(app: App): TFile | null {
        const moment = (window as any).moment;
        if (!moment || !app?.vault) return null;

        const currentMoment = moment();
        const weekStr = currentMoment.format("YYYY-[W]WW");
        const filePath = `02_Journal/02_Weekly/${weekStr}.md`;

        return app.vault.getAbstractFileByPath(filePath) as TFile | null;
    }

    public static getHabitSectionKey(description: string): string | null {
        const d = description.toLowerCase();
        if (d.includes("morning") || d.includes("habit")) return "morning";
        if (d.includes("house") || d.includes("chore")) return "house";
        if (d.includes("work")) return "work";
        return null;
    }

    public static async loadTodayWeeklyHabits(app: App): Promise<{
        habitsBySection: { [sectionKey: string]: HabitItemForDay[] };
        tFile: TFile | null;
    }> {
        const moment = (window as any).moment;
        if (!moment || !app?.vault) return { habitsBySection: {}, tFile: null };

        const currentMoment = moment();
        const dayName = currentMoment.format("dddd");
        const tFile = this.getWeeklyNoteFile(app);
        if (!tFile) return { habitsBySection: {}, tFile: null };

        let text = "";
        try {
            text = await app.vault.read(tFile);
        } catch {
            return { habitsBySection: {}, tFile: null };
        }

        const sections = [
            { key: "morning", regex: /(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i },
            { key: "work", regex: /(##\s*Work[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i },
            { key: "house", regex: /(##\s*🏡?\s*House[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i }
        ];

        const habitsBySection: { [sectionKey: string]: HabitItemForDay[] } = {
            morning: [],
            work: [],
            house: []
        };

        for (const sec of sections) {
            const secMatch = text.match(sec.regex);
            if (!secMatch) continue;

            const tableLines = secMatch[2].trim().split(/\r?\n/).filter((l: string) => l.trim().startsWith("|"));
            if (tableLines.length < 3) continue;

            const rawHeaders = tableLines[0].split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
            const dayColIdx = rawHeaders.findIndex(h => h.toLowerCase() === dayName.toLowerCase());
            if (dayColIdx === -1) continue;

            const dataRows = tableLines.slice(2).map((line: string) => {
                return line.split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
            });

            const list: HabitItemForDay[] = [];
            dataRows.forEach((row: string[], rowIdx: number) => {
                const taskName = row[0].replace(/<br>/gi, " ").replace(/\*/g, "").trim();
                const cellText = row[dayColIdx];
                if (!cellText || cellText.includes("N/A") || cellText === "—") return;

                const isChecked = cellText.includes("[x]") || cellText.includes("[X]");
                list.push({
                    name: taskName,
                    completed: isChecked,
                    rowIdx: rowIdx,
                    colIdx: dayColIdx,
                    sectionKey: sec.key
                });
            });

            habitsBySection[sec.key] = list;
        }

        return { habitsBySection, tFile };
    }

    public static async toggleWeeklyHabit(
        app: App,
        sectionKey: string,
        habitIdentifier: string | number,
        completed: boolean
    ): Promise<boolean> {
        const moment = (window as any).moment;
        if (!moment || !app?.vault) return false;

        const currentMoment = moment();
        const dayName = currentMoment.format("dddd");
        const tFile = this.getWeeklyNoteFile(app);
        if (!tFile) return false;

        let curText = "";
        try {
            curText = await app.vault.read(tFile);
        } catch {
            return false;
        }

        const sectionRegexMap: { [key: string]: RegExp } = {
            morning: /(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i,
            habits: /(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i,
            work: /(##\s*Work[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i,
            house: /(##\s*🏡?\s*House[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i
        };

        const secRegex = sectionRegexMap[sectionKey.toLowerCase()];
        if (!secRegex) return false;

        const curMatch = curText.match(secRegex);
        if (!curMatch) return false;

        const curLines = curMatch[2].trim().split(/\r?\n/);
        const tIndices: number[] = [];
        curLines.forEach((l: string, idx: number) => {
            if (l.trim().startsWith("|")) tIndices.push(idx);
        });

        if (tIndices.length < 3) return false;

        const headerLine = curLines[tIndices[0]];
        const rawHeaders = headerLine.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        const dayColIdx = rawHeaders.findIndex(h => h.toLowerCase() === dayName.toLowerCase());
        if (dayColIdx === -1) return false;

        let targetDataRowIdx = -1;
        if (typeof habitIdentifier === 'number') {
            targetDataRowIdx = habitIdentifier;
        } else {
            const cleanTarget = habitIdentifier.toLowerCase().replace(/<br>/gi, " ").replace(/\*/g, "").trim();
            for (let r = 0; r < tIndices.length - 2; r++) {
                const line = curLines[tIndices[2 + r]];
                const cells = line.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                const rowName = cells[0].toLowerCase().replace(/<br>/gi, " ").replace(/\*/g, "").trim();
                if (rowName === cleanTarget || rowName.includes(cleanTarget) || cleanTarget.includes(rowName)) {
                    targetDataRowIdx = r;
                    break;
                }
            }
        }

        if (targetDataRowIdx < 0 || targetDataRowIdx >= tIndices.length - 2) return false;

        const targetLineIdx = tIndices[2 + targetDataRowIdx];
        const rowCells = curLines[targetLineIdx].split("|");
        const cellPos = dayColIdx + 1;

        if (rowCells[cellPos] && !rowCells[cellPos].includes("N/A")) {
            rowCells[cellPos] = completed ? " [x] " : " [ ] ";
            curLines[targetLineIdx] = rowCells.join("|");
            const newSecBlock = curLines.join("\n");
            const newText = curText.replace(curMatch[2].trim(), newSecBlock);
            await app.vault.modify(tFile, newText);
            return true;
        }

        return false;
    }
}
