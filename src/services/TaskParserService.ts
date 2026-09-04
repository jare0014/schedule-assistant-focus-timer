/**
 * TaskParserService.ts - Parses Obsidian daily note markdown into structured TaskItem objects.
 */

import { TaskItem } from '../types';

export class TaskParserService {
    public static parseAllTasks(content: string): TaskItem[] {
        if (!content) return [];
        const lines = content.split(/\r?\n/);
        const tasks: TaskItem[] = [];
        const taskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
        let currentSubheading = "";
        let hasPlannerHeader = false;

        for (const l of lines) {
            const lower = l.toLowerCase();
            if (lower.includes("day planner") || lower.includes("schedule")) {
                hasPlannerHeader = true;
                break;
            }
        }
        let inPlanner = !hasPlannerHeader;
        let currentProject = "";
        let lastParentTask: TaskItem | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lowerLine = line.toLowerCase();
            const isIndented = /^\s+/.test(line);

            if (hasPlannerHeader && (lowerLine.includes("day planner") || lowerLine.includes("schedule")) && line.startsWith('## ')) {
                inPlanner = true;
                continue;
            }
            if (hasPlannerHeader && inPlanner && line.startsWith('## ') && !lowerLine.includes("day planner") && !lowerLine.includes("schedule")) {
                break;
            }
            if (inPlanner) {
                if (line.startsWith('### ')) {
                    currentSubheading = line.trim();
                    currentProject = "";
                    lastParentTask = null;
                    continue;
                }
                if (line.startsWith('##### ')) {
                    currentProject = line.replace(/^#####\s+/, '').trim();
                    lastParentTask = null;
                    continue;
                }
                const summaryMatch = line.match(/<summary>(?:<b>)?(.*?)(?:<\/b>)?<\/summary>/i);
                if (summaryMatch) currentProject = summaryMatch[1].trim();
                if (line.includes("</details>")) currentProject = "";

                const match = line.match(taskRegex);
                if (match) {
                    const status: 'completed' | 'pending' = (match[1] === 'x' || match[1] === 'X') ? 'completed' : 'pending';
                    let startH = parseInt(match[2]);
                    let startM = parseInt(match[3]);
                    const startAmpm = match[4];
                    let endH = parseInt(match[5]);
                    let endM = parseInt(match[6]);
                    const endAmpm = match[7];
                    const rawDesc = match[8];

                    if (startAmpm) {
                        const a = startAmpm.toLowerCase();
                        if (a === 'pm' && startH < 12) startH += 12;
                        if (a === 'am' && startH === 12) startH = 0;
                    }
                    if (endAmpm) {
                        const a = endAmpm.toLowerCase();
                        if (a === 'pm' && endH < 12) endH += 12;
                        if (a === 'am' && endH === 12) endH = 0;
                    }

                    const description = rawDesc
                        .replace(/`?BUTTON\[[^\]]+\]`?/g, '')
                        .replace(/\[src\]\(.*?\)/g, '')
                        .replace(/\s+src$/i, '')
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                        .replace(/#\w+/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const isCalendar = rawDesc.includes('[Calendar]');
                    let startMinutes = startH * 60 + startM;
                    let endMinutes = endH * 60 + endM;
                    if (startH < 5) startMinutes += 1440;
                    if (endH < 5) endMinutes += 1440;
                    if (endMinutes < startMinutes) endMinutes += 1440;
                    const duration = endMinutes - startMinutes;

                    const taskObj: TaskItem = {
                        lineIndex: i,
                        originalLine: line,
                        status,
                        startHour: startH,
                        startMin: startM,
                        endHour: endH,
                        endMin: endM,
                        startMinutes,
                        endMinutes,
                        duration,
                        description,
                        isCalendar,
                        subheading: currentSubheading,
                        rawDesc,
                        isUntimed: false,
                        project: currentProject || description
                    };
                    tasks.push(taskObj);
                    if (!isIndented) lastParentTask = taskObj;
                } else {
                    const untimedRegex = /^\s*-\s+\[( |x|X)\]\s+(.*)$/;
                    const untimedMatch = line.match(untimedRegex);
                    if (untimedMatch && (!line.includes("BUTTON[") || line.includes("BUTTON[timer-"))) {
                        const status: 'completed' | 'pending' = (untimedMatch[1] === 'x' || untimedMatch[1] === 'X') ? 'completed' : 'pending';
                        const rawDesc = untimedMatch[2];
                        let duration: number | null = null;
                        const dm = rawDesc.match(/`?BUTTON\[timer-(\d+)\]`?/);
                        if (dm) duration = parseInt(dm[1]);

                        const description = rawDesc
                            .replace(/`?BUTTON\[[^\]]+\]`?/g, '')
                            .replace(/\[src\]\(.*?\)/g, '')
                            .replace(/\s+src$/i, '')
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                            .replace(/#\w+/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        const taskObj: TaskItem = {
                            lineIndex: i,
                            originalLine: line,
                            status,
                            startHour: null,
                            startMin: null,
                            endHour: null,
                            endMin: null,
                            startMinutes: null,
                            endMinutes: null,
                            duration,
                            description,
                            isCalendar: false,
                            subheading: currentSubheading,
                            rawDesc,
                            isUntimed: true,
                            project: currentProject
                        };

                        if (isIndented && lastParentTask) {
                            taskObj.parentLineIndex = lastParentTask.lineIndex;
                            if (!taskObj.project) {
                                taskObj.project = lastParentTask.project || lastParentTask.description;
                            }
                        }
                        tasks.push(taskObj);
                    }
                }
            }
        }
        return tasks;
    }
}
