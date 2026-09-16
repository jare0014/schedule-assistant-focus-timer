/**
 * ScheduleGridView.ts - Renders Google Calendar style Day View grid, ruler, zoom, subtasks, and Drag-and-Drop.
 */

import { TaskItem } from '../types';
import { Notice, TFile } from 'obsidian';
import { WeeklyHabitService, HabitItemForDay } from '../services/WeeklyHabitService';

export async function renderScheduleGridView(viewInstance: any, viewContainer: HTMLElement, tasks: TaskItem[]): Promise<void> {
    const existingWrapper = viewContainer.querySelector('.time-grid-wrapper') as HTMLElement | null;
    const prevScrollTop = existingWrapper ? existingWrapper.scrollTop : null;
    const existingDrawer = viewContainer.querySelector('.untimed-drawer') as HTMLDetailsElement | null;
    const wasUntimedOpen = existingDrawer ? existingDrawer.open : false;

    // Filter top-level untimed tasks (must not have a parent task)
    const topLevelUntimed = tasks.filter(t =>
        t.parentLineIndex === undefined &&
        (t.isUntimed || (t.subheading && (t.subheading.includes("☁️") || t.subheading.toLowerCase().includes("micro-task") || t.subheading.toLowerCase().includes("untimed"))))
    );
    // Filter top-level timed tasks for grid placement
    const timedTasks = tasks.filter(t =>
        t.parentLineIndex === undefined && !topLevelUntimed.includes(t)
    );

    // 1. Untimed Accordion Drawer at top (collapsed by default unless previously opened)
    if (topLevelUntimed.length > 0) {
        const drawer = viewContainer.createEl('details', { cls: 'untimed-drawer' });
        if (wasUntimedOpen) drawer.open = true;

        drawer.createEl('summary', { cls: 'untimed-drawer-summary', text: `📦 Untimed & Backlog Tasks (${topLevelUntimed.length})` });
        const content = drawer.createDiv({ cls: 'untimed-drawer-content' });

        // Drawer Drop Target (dragging timed block here moves it to Untimed Micro-Tasks)
        drawer.ondragover = (e) => {
            e.preventDefault();
            drawer.addClass('dragover');
        };
        drawer.ondragleave = (e) => {
            if (!drawer.contains(e.relatedTarget as Node)) {
                drawer.removeClass('dragover');
            }
        };
        drawer.ondrop = async (e) => {
            e.preventDefault();
            drawer.removeClass('dragover');
            try {
                const raw = e.dataTransfer?.getData("text/plain");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (!data.isUntimed) {
                    await viewInstance.handleTaskDrop(data, "### ☁️ Floating Micro-Tasks");
                }
            } catch (err) {
                console.error("Untimed drawer drop error:", err);
            }
        };

        topLevelUntimed.forEach(task => {
            const card = content.createDiv({ cls: `task-card${task.status === 'completed' ? ' completed' : ''}` });

            // Draggable untimed card to drop onto grid
            card.setAttribute('draggable', 'true');
            card.ondragstart = (e) => {
                card.addClass('dragging');
                e.dataTransfer?.setData("text/plain", JSON.stringify({
                    lineIndex: task.lineIndex,
                    description: task.description,
                    isUntimed: true,
                    duration: task.duration || 30
                }));
            };
            card.ondragend = () => {
                card.removeClass('dragging');
            };

            const left = card.createDiv({ cls: 'task-card-left' });
            left.createDiv({ cls: 'task-card-time', text: 'Untimed' });
            left.createDiv({ cls: 'task-card-name', text: task.description });

            const right = card.createDiv({ cls: 'task-card-controls' });
            const cb = right.createEl('input', { type: 'checkbox' });
            cb.checked = task.status === 'completed';
            cb.onclick = async (e) => {
                e.stopPropagation();
                await viewInstance.toggleTaskCompletion(task, cb.checked);
            };

            if (task.status !== 'completed') {
                [5, 10, 15, 20].forEach(m => {
                    const btn = right.createEl('button', { cls: 'task-card-quick-timer-btn', text: `${m}m` });
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        viewInstance.startTimer(task, m);
                    };
                });
            }
        });
    }

    // 2. Weekly Routine & Habit Matrix Drawer
    const existingMatrixDrawer = viewContainer.querySelector('.habit-matrix-drawer') as HTMLDetailsElement | null;
    const wasMatrixOpen = existingMatrixDrawer ? existingMatrixDrawer.open : false;
    await renderHabitMatrixDrawer(viewInstance, viewContainer, wasMatrixOpen);

    // Day View Grid Container
    const dayViewContainer = viewContainer.createDiv({ cls: 'timeblock-dayview-container' });
    const gridWrapper = dayViewContainer.createDiv({ cls: 'time-grid-wrapper' });

    let minHour = 5;
    let maxHour = 22;

    timedTasks.forEach(t => {
        if (typeof t.startHour === 'number' && t.startHour < minHour) minHour = Math.max(0, t.startHour);
        if (typeof t.endHour === 'number' && t.endHour > maxHour) maxHour = Math.min(23, t.endHour);
    });

    const totalHours = maxHour - minHour + 1;
    const hourHeight = (viewInstance && viewInstance.gridZoomLevel) || 60;

    // Time ruler height matches zoomed hour scale
    const ruler = gridWrapper.createDiv({ cls: 'time-ruler' });
    for (let h = minHour; h <= maxHour; h++) {
        const hourLabel = ruler.createDiv({ cls: 'time-ruler-hour' });
        hourLabel.style.height = `${hourHeight}px`;
        hourLabel.style.boxSizing = 'border-box';
        const displayH = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        const ampm = h >= 12 ? 'PM' : 'AM';
        hourLabel.textContent = `${displayH} ${ampm}`;
    }

    const canvas = gridWrapper.createDiv({ cls: 'time-grid-canvas' });
    canvas.style.height = `${totalHours * hourHeight}px`;

    for (let i = 0; i < totalHours; i++) {
        const hourLine = canvas.createDiv({ cls: 'hour-grid-line' });
        hourLine.style.top = `${i * hourHeight}px`;
        if (i < totalHours - 1) {
            const halfHourLine = canvas.createDiv({ cls: 'halfhour-grid-line' });
            halfHourLine.style.top = `${(i + 0.5) * hourHeight}px`;
        }
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    if (currentHour >= minHour && currentHour <= maxHour) {
        const currentMinsFromMinHour = ((currentHour - minHour) * 60) + currentMin;
        const currentTop = currentMinsFromMinHour * (hourHeight / 60);

        const timeIndicator = canvas.createDiv({ cls: 'current-time-indicator' });
        timeIndicator.style.top = `${currentTop}px`;

        timeIndicator.createDiv({ cls: 'current-time-dot' });
        const badge = timeIndicator.createDiv({ cls: 'current-time-badge' });
        badge.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Grid Drop Target & Live Ghost Preview
    let dropPreview: HTMLElement | null = null;

    canvas.ondragover = (e) => {
        e.preventDefault();
        canvas.addClass('dragover');
        const rect = canvas.getBoundingClientRect();
        const yInCanvas = Math.max(0, e.clientY - rect.top);
        const minsFromMinHour = (yInCanvas / hourHeight) * 60;
        const snappedMinsFromMin = Math.max(0, Math.round(minsFromMinHour / 15) * 15);
        const targetStartMins = minHour * 60 + snappedMinsFromMin;

        if (!dropPreview) {
            dropPreview = canvas.createDiv({ cls: 'grid-drop-preview-indicator' });
        }
        const topPx = snappedMinsFromMin * (hourHeight / 60);
        dropPreview.style.top = `${topPx}px`;

        const startH = Math.floor(targetStartMins / 60);
        const startM = targetStartMins % 60;
        const fmtHM = (h: number, m: number) => {
            const dh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
            return `${dh}:${m < 10 ? '0' + m : m}${h >= 12 ? 'pm' : 'am'}`;
        };
        dropPreview.textContent = `📍 Move to ${fmtHM(startH, startM)}`;
    };

    canvas.ondragleave = (e) => {
        if (!canvas.contains(e.relatedTarget as Node)) {
            canvas.removeClass('dragover');
            if (dropPreview) {
                dropPreview.remove();
                dropPreview = null;
            }
        }
    };

    canvas.ondrop = async (e) => {
        e.preventDefault();
        canvas.removeClass('dragover');
        if (dropPreview) {
            dropPreview.remove();
            dropPreview = null;
        }
        try {
            const raw = e.dataTransfer?.getData("text/plain");
            if (!raw) return;
            const data = JSON.parse(raw);

            const rect = canvas.getBoundingClientRect();
            const yInCanvas = Math.max(0, e.clientY - rect.top);
            const minsFromMinHour = (yInCanvas / hourHeight) * 60;
            const snappedMinsFromMin = Math.max(0, Math.round(minsFromMinHour / 15) * 15);
            const newStartMins = minHour * 60 + snappedMinsFromMin;
            const duration = data.duration || 30;
            const newEndMins = newStartMins + duration;

            await viewInstance.rescheduleTaskOnGrid(data, newStartMins, newEndMins);
        } catch (err) {
            console.error("Grid ondrop failed:", err);
        }
    };

    const weeklyData = await WeeklyHabitService.loadTodayWeeklyHabits(viewInstance.app);

    const sortedTasks = [...timedTasks].sort((a, b) => {
        const aStart = (a.startHour ?? 0) * 60 + (a.startMin ?? 0);
        const bStart = (b.startHour ?? 0) * 60 + (b.startMin ?? 0);
        return aStart - bStart;
    });

    sortedTasks.forEach((task: any) => {
        const taskStart = (task.startHour ?? 0) * 60 + (task.startMin ?? 0);
        const taskEnd = (task.endHour ?? ((task.startHour ?? 0) + 1)) * 60 + (task.endMin ?? 0);

        task.calcStartMins = taskStart;
        task.calcEndMins = Math.max(taskStart + 15, taskEnd);
    });

    // Group overlapping tasks into connected clusters
    const clusters: any[][] = [];
    let currentCluster: any[] = [];
    let clusterEnd = -1;

    sortedTasks.forEach((task: any) => {
        if (currentCluster.length === 0) {
            currentCluster.push(task);
            clusterEnd = task.calcEndMins;
        } else if (task.calcStartMins < clusterEnd) {
            // Overlaps with current cluster
            currentCluster.push(task);
            clusterEnd = Math.max(clusterEnd, task.calcEndMins);
        } else {
            // New cluster
            clusters.push(currentCluster);
            currentCluster = [task];
            clusterEnd = task.calcEndMins;
        }
    });
    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    // Within each cluster, pack tasks into columns
    clusters.forEach(cluster => {
        const clusterCols: any[][] = [];
        cluster.forEach(task => {
            let placed = false;
            for (let i = 0; i < clusterCols.length; i++) {
                const col = clusterCols[i];
                const overlaps = col.some(ex => task.calcStartMins < ex.calcEndMins && task.calcEndMins > ex.calcStartMins);
                if (!overlaps) {
                    col.push(task);
                    task.colIndex = i;
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                task.colIndex = clusterCols.length;
                clusterCols.push([task]);
            }
        });
        const numCols = clusterCols.length;
        cluster.forEach(task => {
            task.totalCols = numCols;
        });
    });

    const fmtHM = (h: number | null, m: number | null) => {
        if (h === null || m === null) return "";
        const dh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        return `${dh}:${m < 10 ? '0' + m : m}${h >= 12 ? 'pm' : 'am'}`;
    };

    sortedTasks.forEach((task: any) => {
        const startMinsFromMinHour = task.calcStartMins - (minHour * 60);
        const durationMins = task.calcEndMins - task.calcStartMins;

        const topPx = Math.max(0, startMinsFromMinHour * (hourHeight / 60));
        let heightPx = Math.max(28, durationMins * (hourHeight / 60));

        const card = canvas.createDiv({ cls: `timeblock-card${task.status === 'completed' ? ' completed' : ''}` });
        card.style.top = `${topPx}px`;

        const totalCols = task.totalCols || 1;
        const colIndex = task.colIndex || 0;
        const widthPercent = 100 / totalCols;
        const leftPercent = colIndex * widthPercent;
        card.style.left = `calc(${leftPercent}% + 2px)`;
        card.style.width = `calc(${widthPercent}% - 4px)`;

        // Enable Dragging on Grid Cards
        card.setAttribute('draggable', 'true');
        card.ondragstart = (e) => {
            card.addClass('dragging');
            e.dataTransfer?.setData("text/plain", JSON.stringify({
                lineIndex: task.lineIndex,
                description: task.description,
                isUntimed: false,
                duration: durationMins,
                startHour: task.startHour,
                startMin: task.startMin,
                endHour: task.endHour,
                endMin: task.endMin
            }));
        };
        card.ondragend = () => {
            card.removeClass('dragging');
            if (dropPreview) {
                dropPreview.remove();
                dropPreview = null;
            }
        };

        const cardHeader = card.createDiv({ cls: 'timeblock-card-header' });
        cardHeader.createDiv({ cls: 'timeblock-card-title', text: task.description });

        const controls = cardHeader.createDiv({ cls: 'timeblock-card-controls' });
        const cb = controls.createEl('input', { type: 'checkbox' });
        cb.checked = task.status === 'completed';
        cb.onclick = async (e) => {
            e.stopPropagation();
            await viewInstance.toggleTaskCompletion(task, cb.checked);
        };

        const playBtn = controls.createEl('button', { cls: 'timeblock-play-btn', text: '▶', title: 'Start Focus Session' });
        playBtn.onclick = (e) => {
            e.stopPropagation();
            viewInstance.startTimer(task, task.duration || parseInt(viewInstance.plugin.settings.defaultDuration));
        };

        const delBtn = controls.createEl('button', { cls: 'timeblock-delete-btn', text: '✕', title: 'Remove task block from daily note' });
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            await viewInstance.deleteTaskBlock(task);
        };

        const cardTime = card.createDiv({ cls: 'timeblock-card-time' });
        const timeStr = `${fmtHM(task.startHour, task.startMin)} – ${fmtHM(task.endHour, task.endMin)}`;
        cardTime.createSpan({ text: timeStr });
        cardTime.createSpan({ cls: 'timeblock-duration-badge', text: `${durationMins}m` });

        // Render nested subtasks if any exist for this task in daily note
        const subtasks = tasks.filter(t => t.parentLineIndex === task.lineIndex);
        if (subtasks.length > 0) {
            const subtasksContainer = card.createDiv({ cls: 'timeblock-subtasks-container' });
            subtasks.forEach(subtask => {
                const subtaskEl = subtasksContainer.createDiv({
                    cls: `timeblock-subtask-item${subtask.status === 'completed' ? ' completed' : ''}`
                });

                const subCb = subtaskEl.createEl('input', { type: 'checkbox' });
                subCb.checked = subtask.status === 'completed';
                subCb.onclick = async (e) => {
                    e.stopPropagation();
                    await viewInstance.toggleTaskCompletion(subtask, subCb.checked);
                };

                subtaskEl.createDiv({ cls: 'timeblock-subtask-title', text: subtask.description });

                if (subtask.status !== 'completed') {
                    const subPlayBtn = subtaskEl.createEl('button', {
                        cls: 'timeblock-subtask-play-btn',
                        text: '▶',
                        title: 'Start Subtask Timer'
                    });
                    subPlayBtn.onclick = (e) => {
                        e.stopPropagation();
                        viewInstance.startTimer(subtask, subtask.duration || 15);
                    };
                }
            });

            const minRequiredHeight = 48 + (subtasks.length * 28);
            if (heightPx < minRequiredHeight) {
                heightPx = minRequiredHeight;
            }
        } else if (weeklyData && weeklyData.tFile) {
            // Check if this card matches a weekly routine/habit section
            const secKey = WeeklyHabitService.getHabitSectionKey(task.description);
            const habits = secKey ? weeklyData.habitsBySection[secKey] : null;

            if (habits && habits.length > 0 && secKey) {
                const habitsContainer = card.createDiv({ cls: 'timeblock-subtasks-container timeblock-habits-container' });
                habitsContainer.style.maxHeight = '240px';
                habitsContainer.style.overflowY = 'auto';

                habits.forEach(habit => {
                    const habitItemEl = habitsContainer.createDiv({
                        cls: `timeblock-subtask-item${habit.completed ? ' completed' : ''}`
                    });

                    const habitCb = habitItemEl.createEl('input', { type: 'checkbox' });
                    habitCb.checked = habit.completed;
                    habitCb.onclick = async (e) => {
                        e.stopPropagation();
                        const nowChecked = habitCb.checked;
                        try {
                            const success = await WeeklyHabitService.toggleWeeklyHabit(
                                viewInstance.app,
                                secKey,
                                habit.rowIdx,
                                nowChecked
                            );
                            if (success) {
                                habitItemEl.toggleClass('completed', nowChecked);
                                new Notice(`Updated ${habit.name}: ${nowChecked ? "Done" : "Pending"}`);
                            } else {
                                habitCb.checked = !nowChecked;
                            }
                        } catch (err: any) {
                            console.error("Failed to update weekly habit item:", err);
                            habitCb.checked = !nowChecked;
                        }
                    };

                    habitItemEl.createDiv({ cls: 'timeblock-subtask-title', text: habit.name });
                });

                const naturalHeight = Math.max(28, durationMins * (hourHeight / 60));
                const minRequiredHeight = 48 + (Math.min(habits.length, 6) * 26);
                if (naturalHeight < minRequiredHeight) {
                    heightPx = minRequiredHeight;
                }
            }
        }

        card.style.height = `${heightPx}px`;

        card.onclick = () => {
            if (card.hasClass('dragging')) return;
            viewInstance.startTimer(task, task.duration || parseInt(viewInstance.plugin.settings.defaultDuration));
        };
    });

    let targetScroll = 0;
    if (viewInstance && viewInstance.resetScrollToFocus) {
        viewInstance.resetScrollToFocus = false;
        if (currentHour >= minHour && currentHour <= maxHour) {
            targetScroll = Math.max(0, (((currentHour - minHour) * 60 + currentMin) * (hourHeight / 60)) - 10);
        }
    } else if (prevScrollTop !== null) {
        targetScroll = prevScrollTop;
    } else if (currentHour >= minHour && currentHour <= maxHour) {
        targetScroll = Math.max(0, (((currentHour - minHour) * 60 + currentMin) * (hourHeight / 60)) - 10);
    }

    gridWrapper.scrollTop = targetScroll;
    requestAnimationFrame(() => { gridWrapper.scrollTop = targetScroll; });
}

/**
 * Renders an interactive collapsible weekly routine and habit matrix directly in the Schedule Assistant Grid View.
 */
async function renderHabitMatrixDrawer(viewInstance: any, viewContainer: HTMLElement, wasOpen: boolean): Promise<void> {
    const app = viewInstance.app;
    if (!app || !app.vault) return;

    const moment = (window as any).moment;
    if (!moment) return;

    const currentMoment = moment();
    const weekStr = currentMoment.format("YYYY-[W]WW");
    const dayName = currentMoment.format("dddd");
    const filePath = `02_Journal/02_Weekly/${weekStr}.md`;

    const tFile = app.vault.getAbstractFileByPath(filePath) as TFile;
    if (!tFile) return;

    let text = "";
    try {
        text = await app.vault.read(tFile);
    } catch (e) {
        return;
    }

    const drawer = viewContainer.createEl('details', { cls: 'habit-matrix-drawer' });
    drawer.style.margin = "4px 0 10px 0";
    drawer.style.border = "1px solid var(--background-modifier-border)";
    drawer.style.borderRadius = "6px";
    drawer.style.padding = "6px 10px";
    drawer.style.backgroundColor = "var(--background-secondary)";

    const isMatrixStoredOpen = localStorage.getItem("schedule-assistant-matrix-drawer-open") === "true";
    if (wasOpen || isMatrixStoredOpen) drawer.open = true;

    drawer.ontoggle = () => {
        localStorage.setItem("schedule-assistant-matrix-drawer-open", String(drawer.open));
    };

    const summary = drawer.createEl('summary', { cls: 'habit-matrix-summary' });
    summary.style.cursor = "pointer";
    summary.style.fontWeight = "600";
    summary.style.color = "var(--text-accent)";
    summary.style.display = "flex";
    summary.style.alignItems = "center";
    summary.style.justifyContent = "space-between";

    const titleSpan = summary.createSpan();
    titleSpan.setText(`☀️ Routine & Habit Matrix (${weekStr})`);

    const dayBadge = summary.createSpan();
    dayBadge.setText(`Today: ${dayName}`);
    dayBadge.style.fontSize = "0.8em";
    dayBadge.style.color = "var(--text-muted)";

    const content = drawer.createDiv({ cls: 'habit-matrix-content' });
    content.style.marginTop = "8px";
    content.style.maxHeight = "340px";
    content.style.overflowY = "auto";

    const sectionsToRender = [
        { name: "Mornings", label: "☀️ Morning Routine & Exercises", regex: /(##\s*Mornings[\r\n]+)([\s\S]*?)(?=[\r\n]+---|\r?\n##(?!#)|$)/i },
        { name: "Work", label: "💼 Work Checklist", regex: /(##\s*Work[\r\n]+)([\s\S]*?)(?=[\r\n]+---|\r?\n##(?!#)|$)/i },
        { name: "House", label: "🏡 House & Chores", regex: /(##\s*🏡?\s*House[^\r\n]*[\r\n]+)([\s\S]*?)(?=[\r\n]+---|\r?\n##(?!#)|$)/i }
    ];

    for (const sec of sectionsToRender) {
        const secMatch = text.match(sec.regex);
        if (!secMatch) continue;

        const tableLines = secMatch[2].trim().split(/\r?\n/).filter((l: string) => l.trim().startsWith("|"));
        if (tableLines.length < 3) continue;

        const rawHeaders = tableLines[0].split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
        const dataRows = tableLines.slice(2).map((line: string) => {
            return line.split("|").map((s: string) => s.trim()).filter((_: string, idx: number, arr: string[]) => idx > 0 && idx < arr.length - 1);
        });

        const secHeading = content.createDiv({ style: "font-weight: 600; font-size: 0.9em; margin: 8px 0 4px 0; color: var(--text-normal);" });
        secHeading.setText(sec.label);

        const table = content.createEl("table", { style: "width: 100%; border-collapse: collapse; font-size: 0.85em; margin-bottom: 8px;" });
        const thead = table.createEl("thead");
        const hRow = thead.createEl("tr");
        rawHeaders.forEach((h: string, colIdx: number) => {
            const th = hRow.createEl("th", { style: `padding: 4px; border-bottom: 1px solid var(--background-modifier-border); text-align: ${colIdx === 0 ? "left" : "center"};` });
            const isToday = h.toLowerCase() === dayName.toLowerCase();
            if (isToday) {
                th.setText(`👉 ${h}`);
                th.style.color = "var(--text-accent)";
                th.style.fontWeight = "bold";
                th.style.backgroundColor = "var(--background-modifier-hover)";
            } else {
                th.setText(h);
            }
        });

        const tbody = table.createEl("tbody");
        dataRows.forEach((row: string[], rowIdx: number) => {
            const tr = tbody.createEl("tr", { style: "border-bottom: 1px solid var(--background-modifier-border-hover);" });
            row.forEach((cellText: string, colIdx: number) => {
                const td = tr.createEl("td", { style: `padding: 4px; text-align: ${colIdx === 0 ? "left" : "center"};` });
                const isToday = rawHeaders[colIdx] && rawHeaders[colIdx].toLowerCase() === dayName.toLowerCase();
                if (isToday) {
                    td.style.backgroundColor = "var(--background-modifier-hover)";
                }

                if (colIdx === 0) {
                    td.setText(cellText.replace(/<br>/gi, " ").replace(/\*/g, ""));
                } else if (cellText.includes("N/A") || cellText === "—") {
                    td.createSpan({ text: "—", style: "color: var(--text-faint);" });
                } else {
                    const isChecked = cellText.includes("[x]") || cellText.includes("[X]");
                    const cb = td.createEl("input", { type: "checkbox" });
                    cb.checked = isChecked;
                    cb.style.cursor = "pointer";
                    cb.style.verticalAlign = "middle";

                    cb.onchange = async () => {
                        const nowChecked = cb.checked;
                        try {
                            const curText = await app.vault.read(tFile);
                            const curMatch = curText.match(sec.regex);
                            if (!curMatch) return;

                            const curLines = curMatch[2].trim().split(/\r?\n/);
                            const tIndices: number[] = [];
                            curLines.forEach((l: string, idx: number) => {
                                if (l.trim().startsWith("|")) tIndices.push(idx);
                            });

                            const targetLineIdx = tIndices[2 + rowIdx];
                            if (targetLineIdx !== undefined) {
                                const rowCells = curLines[targetLineIdx].split("|");
                                if (rowCells[colIdx + 1] && !rowCells[colIdx + 1].includes("N/A")) {
                                    rowCells[colIdx + 1] = nowChecked ? " [x] " : " [ ] ";
                                    curLines[targetLineIdx] = rowCells.join("|");
                                    const newSecBlock = curLines.join("\n");
                                    const newText = curText.replace(curMatch[2].trim(), newSecBlock);
                                    await app.vault.modify(tFile, newText);
                                    new Notice(`Updated ${row[0]} (${rawHeaders[colIdx]}): ${nowChecked ? "Done" : "Pending"}`);
                                }
                            }
                        } catch (err: any) {
                            console.error("Failed to update weekly habit matrix:", err);
                        }
                    };
                }
            });
        });
    }
}


