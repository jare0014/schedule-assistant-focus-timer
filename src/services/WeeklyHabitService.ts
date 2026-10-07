/**
 * WeeklyHabitService.ts - Service for loading and toggling weekly habits and routines.
 */

import { App, TFile } from 'obsidian';

export interface HabitItemForDay {
    name: string;
    completed: boolean;
    cancelled?: boolean;
    rowIdx: number;
    colIdx: number;
    sectionKey: string;
}

export class WeeklyHabitService {
    public static async completeTimerHabit(app: App, task: { description?: string; sectionKey?: string }): Promise<boolean> {
        const normalize = (name: string) => name.replace(/\[\[[^\]|]+(?:\|[^\]]+)?\]\]/g, "").replace(/<br\s*\/?\s*>/gi, " ").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
        const name = normalize(task.description || "");
        if (!name) return false;
        const { habitsBySection } = await this.loadTodayWeeklyHabits(app);
        const candidateSections = ['morning', 'midday', 'evening', 'work', 'house'];
        const allHabits = candidateSections.flatMap(sec => habitsBySection[sec] || []);
        const matches = allHabits.filter(habit => {
            if (normalize(habit.name) !== name) return false;
            if (!task.sectionKey) return true;
            if (habit.sectionKey === task.sectionKey) return true;
            if (task.sectionKey === 'habits' && (habit.sectionKey === 'morning' || habit.sectionKey === 'midday' || habit.sectionKey === 'evening')) return true;
            return false;
        });
        if (matches.length !== 1) return false;
        const habit = matches[0];
        if (habit.completed) return true;
        return this.toggleWeeklyHabit(app, habit.sectionKey, habit.rowIdx, true);
    }

    public static getWeeklyNoteFile(app: App): TFile | null {
        const moment = (window as any).moment;
        if (!moment || !app?.vault) return null;

        const currentMoment = moment();
        const weekStr = currentMoment.format("YYYY-[W]WW");
        const filePath = `02_Journal/02_Weekly/${weekStr}.md`;

        return app.vault.getAbstractFileByPath(filePath) as TFile | null;
    }

    public static getHabitSectionKey(description: string): string | null {
        if (!description) return null;
        const d = description.toLowerCase();
        if (d.includes("house") || d.includes("chore")) return "house";
        if (d.includes("work")) return "work";
        if (d.includes("midday")) return "midday";
        if (d.includes("evening")) return "evening";
        if (d.includes("morning") || d.includes("wake") || d.includes("waffle") || d.includes("esther") || d.includes("habit")) return "morning";
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

        const habitsBySection: { [sectionKey: string]: HabitItemForDay[] } = {
            morning: [],
            midday: [],
            evening: [],
            habits: [],
            work: [],
            house: []
        };

        const parseTableBlock = (tableBlock: string, defaultSection: string): HabitItemForDay[] => {
            const tableLines = tableBlock.trim().split(/\r?\n/).filter((l: string) => l.trim().startsWith("|"));
            if (tableLines.length < 3) return [];

            const rawHeaders = tableLines[0].split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
            const dayColIdx = rawHeaders.findIndex(h => h.toLowerCase() === dayName.toLowerCase());
            if (dayColIdx === -1) return [];

            const dataRows = tableLines.slice(2).map((line: string) => {
                return line.split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
            });

            const list: HabitItemForDay[] = [];
            dataRows.forEach((row: string[], rowIdx: number) => {
                const taskName = row[0].replace(/\[\[[^\]|]+(?:\|[^\]]+)?\]\]/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\*/g, "").trim();
                const cellText = row[dayColIdx];
                if (!cellText || cellText.includes("N/A") || cellText === "—") return;

                const isChecked = cellText.includes("[x]") || cellText.includes("[X]");
                const isCancelled = cellText.includes("[-]") || /^\s*cancel(?:led)?\s*$/i.test(cellText.trim());
                list.push({
                    name: taskName,
                    completed: isChecked,
                    cancelled: isCancelled,
                    rowIdx: rowIdx,
                    colIdx: dayColIdx,
                    sectionKey: defaultSection
                });
            });
            return list;
        };

        // 1. Check for unified Habits / Mornings table
        const habitsMatch = text.match(/(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
        if (habitsMatch) {
            const tableLines = habitsMatch[2].trim().split(/\r?\n/).filter((l: string) => l.trim().startsWith("|"));
            if (tableLines.length >= 3) {
                const rawHeaders = tableLines[0].split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
                const dayColIdx = rawHeaders.findIndex(h => h.toLowerCase() === dayName.toLowerCase());
                if (dayColIdx !== -1) {
                    const dataRows = tableLines.slice(2).map((line: string) => {
                        return line.split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
                    });

                    let currentRoutine: 'morning' | 'midday' | 'evening' = 'morning';
                    const habitRowsMeta: { row: string[]; origIdx: number; routine: 'morning' | 'midday' | 'evening'; isDivider: boolean }[] = [];

                    dataRows.forEach((row: string[], origIdx: number) => {
                        const rawLabel = (row[0] || '').trim();
                        const isMorningDivider = (/morning.*routine/i.test(rawLabel) || /☀️.*routine/i.test(rawLabel)) && !/esther/i.test(rawLabel);
                        const isMiddayDivider = /midday.*routine/i.test(rawLabel) || /⚡.*routine/i.test(rawLabel);
                        const isEveningDivider = /evening.*routine/i.test(rawLabel) || /🌙.*routine/i.test(rawLabel);

                        if (isMorningDivider) {
                            currentRoutine = 'morning';
                            habitRowsMeta.push({ row, origIdx, routine: 'morning', isDivider: true });
                            return;
                        }
                        if (isMiddayDivider) {
                            currentRoutine = 'midday';
                            habitRowsMeta.push({ row, origIdx, routine: 'midday', isDivider: true });
                            return;
                        }
                        if (isEveningDivider) {
                            currentRoutine = 'evening';
                            habitRowsMeta.push({ row, origIdx, routine: 'evening', isDivider: true });
                            return;
                        }

                        habitRowsMeta.push({
                            row,
                            origIdx,
                            routine: currentRoutine,
                            isDivider: false
                        });
                    });

                    const hasDividers = habitRowsMeta.some(r => r.isDivider);
                    if (!hasDividers) {
                        habitRowsMeta.forEach(item => {
                            const t = (item.row[0] || '').toLowerCase();
                            if (/wake|waffle|phase 1|hygiene|teeth|shower|meditat|morning|esther/i.test(t)) {
                                item.routine = 'morning';
                            } else if (/phase 2|phase 3|lumosity|shake|protein|midday/i.test(t)) {
                                item.routine = 'midday';
                            } else if (/tidy|dishes|meds|coffee|clothes|lunch prep|evening/i.test(t)) {
                                item.routine = 'evening';
                            }
                        });
                    }

                    habitRowsMeta.forEach(item => {
                        if (item.isDivider) return;
                        const taskName = item.row[0].replace(/\[\[[^\]|]+(?:\|[^\]]+)?\]\]/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\*/g, "").trim();
                        const cellText = item.row[dayColIdx];
                        if (!cellText || cellText.includes("N/A") || cellText === "—") return;

                        const isChecked = cellText.includes("[x]") || cellText.includes("[X]");
                        const isCancelled = cellText.includes("[-]") || /^\s*cancel(?:led)?\s*$/i.test(cellText.trim());
                        const itemObj: HabitItemForDay = {
                            name: taskName,
                            completed: isChecked,
                            cancelled: isCancelled,
                            rowIdx: item.origIdx,
                            colIdx: dayColIdx,
                            sectionKey: item.routine
                        };
                        habitsBySection[item.routine].push(itemObj);
                        habitsBySection.habits.push({ ...itemObj, sectionKey: 'habits' });
                    });
                }
            }
        }

        // 2. Standalone Midday or Evening sections if not populated from unified table
        if (habitsBySection.midday.length === 0) {
            const middayMatch = text.match(/(##\s*Midday[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
            if (middayMatch) {
                habitsBySection.midday = parseTableBlock(middayMatch[2], 'midday');
            }
        }
        if (habitsBySection.evening.length === 0) {
            const eveningMatch = text.match(/(##\s*Evening[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
            if (eveningMatch) {
                habitsBySection.evening = parseTableBlock(eveningMatch[2], 'evening');
            }
        }

        // 3. Work and House sections
        const workMatch = text.match(/(##\s*Work[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
        if (workMatch) {
            habitsBySection.work = parseTableBlock(workMatch[2], 'work');
        }

        const houseMatch = text.match(/(##\s*🏡?\s*House[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
        if (houseMatch) {
            habitsBySection.house = parseTableBlock(houseMatch[2], 'house');
        }

        return { habitsBySection, tFile };
    }

    public static async toggleWeeklyHabit(
        app: App,
        sectionKey: string,
        habitIdentifier: string | number,
        completed: boolean | string
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

        let curMatch: RegExpMatchArray | null = null;
        let matchedSectionKey = sectionKey.toLowerCase();
        if (matchedSectionKey === 'midday') {
            curMatch = curText.match(/(##\s*Midday[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
            if (!curMatch) {
                curMatch = curText.match(/(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
                matchedSectionKey = 'habits';
            }
        } else if (matchedSectionKey === 'evening') {
            curMatch = curText.match(/(##\s*Evening[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
            if (!curMatch) {
                curMatch = curText.match(/(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
                matchedSectionKey = 'habits';
            }
        } else if (matchedSectionKey === 'morning' || matchedSectionKey === 'habits') {
            curMatch = curText.match(/(##\s*(?:Habits|Mornings)[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
            matchedSectionKey = 'habits';
        } else if (matchedSectionKey === 'work') {
            curMatch = curText.match(/(##\s*Work[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
        } else if (matchedSectionKey === 'house') {
            curMatch = curText.match(/(##\s*🏡?\s*House[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+\s*---|[\r\n]+##(?!#)|$)/i);
        }
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
            const cleanTarget = habitIdentifier.toLowerCase().replace(/<br\s*\/?>/gi, " ").replace(/\*/g, "").trim();
            for (let r = 0; r < tIndices.length - 2; r++) {
                const line = curLines[tIndices[2 + r]];
                const cells = line.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                const rowName = cells[0].toLowerCase().replace(/<br\s*\/?>/gi, " ").replace(/\*/g, "").trim();
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
            let markValue = " [ ] ";
            if (completed === true || completed === "[x]" || completed === "[X]") {
                markValue = " [x] ";
            } else if (completed === "[-]" || completed === "cancelled") {
                markValue = " [-] ";
            }
            rowCells[cellPos] = markValue;
            curLines[targetLineIdx] = rowCells.join("|");
            const newSecBlock = curLines.join("\n");
            const newText = curText.replace(curMatch[2].trim(), newSecBlock);
            await app.vault.modify(tFile, newText);

            if (typeof window !== "undefined") {
                if ((window as any).__weeklyMatrixCache && (window as any).__weeklyMatrixCache[tFile.path]) {
                    const cache = (window as any).__weeklyMatrixCache[tFile.path].parsedSections;
                    if (cache) {
                        delete cache[sectionKey.toLowerCase()];
                        delete cache["habits"];
                        delete cache["mornings"];
                        delete cache["morning"];
                        delete cache["midday"];
                        delete cache["evening"];
                    }
                }
                if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
                    window.dispatchEvent(new CustomEvent("weekly-matrix-cell-synced", {
                        detail: {
                            filePath: tFile.path,
                            section: (["morning", "midday", "evening"].includes(sectionKey.toLowerCase())) ? "habits" : sectionKey,
                            rowIdx: targetDataRowIdx,
                            colIdx: dayColIdx,
                            value: markValue.trim(),
                            checked: completed === true || completed === "[x]" || completed === "[X]"
                        }
                    }));
                }
            }
            return true;
        }

        return false;
    }
}
