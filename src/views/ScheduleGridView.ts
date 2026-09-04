/**
 * ScheduleGridView.ts - Renders Google Calendar style Day View grid, ruler, zoom, subtasks, and Drag-and-Drop.
 */

import { TaskItem } from '../types';

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

    const columns: any[][] = [];
    sortedTasks.forEach((task: any) => {
        let placed = false;
        for (const col of columns) {
            const overlaps = col.some(ex => task.calcStartMins < ex.calcEndMins && task.calcEndMins > ex.calcStartMins);
            if (!overlaps) {
                col.push(task);
                placed = true;
                break;
            }
        }
        if (!placed) {
            columns.push([task]);
        }
    });

    const totalCols = columns.length || 1;
    const fmtHM = (h: number | null, m: number | null) => {
        if (h === null || m === null) return "";
        const dh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        return `${dh}:${m < 10 ? '0' + m : m}${h >= 12 ? 'pm' : 'am'}`;
    };

    columns.forEach((colTasks, colIndex) => {
        colTasks.forEach((task: any) => {
            const startMinsFromMinHour = task.calcStartMins - (minHour * 60);
            const durationMins = task.calcEndMins - task.calcStartMins;

            const topPx = Math.max(0, startMinsFromMinHour * (hourHeight / 60));
            let heightPx = Math.max(28, durationMins * (hourHeight / 60));

            const card = canvas.createDiv({ cls: `timeblock-card${task.status === 'completed' ? ' completed' : ''}` });
            card.style.top = `${topPx}px`;

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

            // Render nested subtasks if any exist for this task
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
            }

            card.style.height = `${heightPx}px`;

            card.onclick = () => {
                if (card.hasClass('dragging')) return;
                viewInstance.startTimer(task, task.duration || parseInt(viewInstance.plugin.settings.defaultDuration));
            };
        });
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
