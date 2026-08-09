/**
 * TaskParser.js - Utility for parsing Day Planner tasks and subtasks from Obsidian Markdown notes.
 */

function parseAllTasks(content) {
    if (!content) return [];
    const lines = content.split(/\r?\n/);
    const tasks = [];
    const taskRegex = /^\s*-\s+\[( |x|X)\]\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s+(.*)$/;
    let currentSubheading = "";
    let inPlanner = false;
    let currentProject = "";
    let lastParentTask = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isIndented = /^\s+/.test(line);

        if (line.includes("## 📅Day Planner")) {
            inPlanner = true;
            continue;
        }
        if (inPlanner && line.startsWith('## ') && !line.includes("## 📅Day Planner")) {
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
            if (summaryMatch) {
                currentProject = summaryMatch[1].trim();
            }
            if (line.includes("</details>")) {
                currentProject = "";
            }
            
            const match = line.match(taskRegex);
            if (match) {
                const status = (match[1] === 'x' || match[1] === 'X') ? 'completed' : 'pending';
                let startH = parseInt(match[2]);
                const startM = parseInt(match[3]);
                const startAmpm = match[4];
                let endH = parseInt(match[5]);
                const endM = parseInt(match[6]);
                const endAmpm = match[7];
                const rawDesc = match[8];

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
                
                let description = rawDesc.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                description = description.replace(/\[src\]\(.*?\)/g, '').trim();
                description = description.replace(/\s+src$/i, '').trim();
                description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                description = description.replace(/#\w+/g, '').trim();
                description = description.replace(/\s+/g, ' ').trim();
                
                const isCalendar = rawDesc.includes('[Calendar]');
                let startMinutes = startH * 60 + startM;
                let endMinutes = endH * 60 + endM;
                if (startH < 5) startMinutes += 1440;
                if (endH < 5) endMinutes += 1440;
                if (endMinutes < startMinutes) {
                    endMinutes += 1440;
                }
                const duration = endMinutes - startMinutes;
                
                const taskObj = {
                    lineIndex: i,
                    originalLine: line,
                    status: status,
                    startHour: startH,
                    startMin: startM,
                    endHour: endH,
                    endMin: endM,
                    startMinutes: startMinutes,
                    endMinutes: endMinutes,
                    duration: duration,
                    description: description,
                    isCalendar: isCalendar,
                    subheading: currentSubheading,
                    rawDesc: rawDesc,
                    isUntimed: false,
                    project: currentProject || (description ? description : null)
                };

                tasks.push(taskObj);
                if (!isIndented) {
                    lastParentTask = taskObj;
                }
            } else {
                const untimedRegex = /^\s*-\s+\[( |x|X)\]\s+(.*)$/;
                const untimedMatch = line.match(untimedRegex);
                if (untimedMatch && (!line.includes("BUTTON[") || line.includes("BUTTON[timer-"))) {
                    const status = (untimedMatch[1] === 'x' || untimedMatch[1] === 'X') ? 'completed' : 'pending';
                    const rawDesc = untimedMatch[2];
                    
                    let duration = null;
                    const durationMatch = rawDesc.match(/`?BUTTON\[timer-(\d+)\]`?/);
                    if (durationMatch) {
                        duration = parseInt(durationMatch[1]);
                    }
                    
                    let description = rawDesc.replace(/`?BUTTON\[[^\]]+\]`?/g, '').trim();
                    description = description.replace(/\[src\]\(.*?\)/g, '').trim();
                    description = description.replace(/\s+src$/i, '').trim();
                    description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
                    description = description.replace(/#\w+/g, '').trim();
                    description = description.replace(/\s+/g, ' ').trim();
                    
                    const taskObj = {
                        lineIndex: i,
                        originalLine: line,
                        status: status,
                        startHour: null,
                        startMin: null,
                        endHour: null,
                        endMin: null,
                        startMinutes: null,
                        endMinutes: null,
                        duration: duration,
                        description: description,
                        isCalendar: false,
                        subheading: currentSubheading,
                        rawDesc: rawDesc,
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

module.exports = { parseAllTasks };
