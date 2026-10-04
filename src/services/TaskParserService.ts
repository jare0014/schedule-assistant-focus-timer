/**
 * TaskParserService.ts - Parses Obsidian daily note markdown into structured TaskItem objects.
 */

import { TaskItem } from '../types';

export class TaskParserService {
    public static parseAllTasks(content: string): TaskItem[] {
        if (!content) return [];
        const lines = content.split(/\r?\n/);
        const tasks: TaskItem[] = [];
        const taskRegex = /^\s*(?:[*+]\s+)?-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
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

                if (line.trim().startsWith('```dataviewjs')) {
                    let dvEnd = i + 1;
                    let dvContent = '';
                    while (dvEnd < lines.length && !lines[dvEnd].trim().startsWith('```')) {
                        dvContent += lines[dvEnd] + '\n';
                        dvEnd++;
                    }

                    // Detect modular tracker scripts (habitTracker, workTracker, houseTracker)
                    // or legacy weeklyTableTracker blocks
                    let trackerSection: string | null = null;
                    let trackerStartTime: string | null = null;
                    let trackerEndTime: string | null = null;

                    if (dvContent.includes('weeklyTableTracker')) {
                        const secMatch = dvContent.match(/section:\s*["']([^"']+)["']/i);
                        const startMatch = dvContent.match(/startTime:\s*["'](\d{1,2}:\d{2})["']/i);
                        const endMatch = dvContent.match(/endTime:\s*["'](\d{1,2}:\d{2})["']/i);
                        if (secMatch) trackerSection = secMatch[1];
                        if (startMatch) trackerStartTime = startMatch[1];
                        if (endMatch) trackerEndTime = endMatch[1];
                    } else if (dvContent.includes('habitTracker')) {
                        trackerSection = 'Mornings';
                    } else if (dvContent.includes('workTracker')) {
                        trackerSection = 'Work';
                    } else if (dvContent.includes('houseTracker')) {
                        trackerSection = 'House';
                    }

                    // If this is a recognized tracker and the preceding task line
                    // already has timing, just skip the block (the task line was
                    // already parsed). Only create a phantom task when there is
                    // NO preceding timed task for this section.
                    if (trackerSection && trackerStartTime && trackerEndTime) {
                        const labelMatch = dvContent.match(/label:\s*["']([^"']+)["']/i);
                        const sec = trackerSection;
                        const desc = sec.toLowerCase().includes('morning') ? 'Habits: Morning Routine' :
                                     sec.toLowerCase().includes('house') ? 'House: Chores & Maintenance' :
                                     sec.toLowerCase().includes('work') ? 'Work' :
                                     (labelMatch ? labelMatch[1].replace(/^[^\w\s]+\s*/, '') : sec);
                        const startH = parseInt(trackerStartTime.split(':')[0]);
                        const startM = parseInt(trackerStartTime.split(':')[1]);
                        const endH = parseInt(trackerEndTime.split(':')[0]);
                        const endM = parseInt(trackerEndTime.split(':')[1]);
                        let startMinutes = startH * 60 + startM;
                        let endMinutes = endH * 60 + endM;
                        if (startH < 5) startMinutes += 1440;
                        if (endH < 5) endMinutes += 1440;
                        if (endMinutes < startMinutes) endMinutes += 1440;
                        const duration = endMinutes - startMinutes;

                        const alreadyAdded = tasks.some(t => !t.isUntimed && (
                            t.description.toLowerCase() === desc.toLowerCase() ||
                            (Math.abs((t.startMinutes || 0) - startMinutes) < 30)
                        ));
                        if (!alreadyAdded) {
                            const trackerTask: TaskItem = {
                                lineIndex: i,
                                originalLine: line,
                                status: 'pending',
                                startHour: startH,
                                startMin: startM,
                                endHour: endH,
                                endMin: endM,
                                startMinutes,
                                endMinutes,
                                duration,
                                description: desc,
                                isCalendar: false,
                                subheading: currentSubheading || '### ⏱️ Focus Blocks',
                                rawDesc: desc,
                                isUntimed: false,
                                project: currentProject || desc
                            };
                            tasks.push(trackerTask);
                            if (!isIndented) lastParentTask = trackerTask;
                        }
                    }
                    // For modular trackers without explicit timing (habitTracker,
                    // workTracker, houseTracker), the preceding task line already
                    // provides timing, so we just skip the dataviewjs block.
                    i = dvEnd;
                    continue;
                }

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
                    const untimedRegex = /^\s*(?:[*+]\s+)?-\s+\[( |x|X)\]\s+(.*)$/;
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
