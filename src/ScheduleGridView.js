/**
 * ScheduleGridView.js - Renders Google Calendar style Day View grid and subtasks.
 */

async function renderScheduleGridView(viewInstance, viewContainer, tasks) {
    // Filter top-level untimed tasks (must not have a parent task)
    const topLevelUntimed = tasks.filter(t => 
        t.parentLineIndex === undefined && 
        (t.isUntimed || (t.subheading && (t.subheading.includes("☁️") || t.subheading.toLowerCase().includes("micro-task") || t.subheading.toLowerCase().includes("untimed"))))
    );
    // Filter top-level timed tasks for grid placement
    const timedTasks = tasks.filter(t => 
        t.parentLineIndex === undefined && !topLevelUntimed.includes(t)
    );

    // 1. Untimed Accordion Drawer at top (collapsed by default)
    if (topLevelUntimed.length > 0) {
        const drawer = viewContainer.createEl('details', { cls: 'untimed-drawer' });
        // Collapsed by default - no open attribute

        const summary = drawer.createEl('summary', { cls: 'untimed-drawer-summary', text: `📦 Untimed & Backlog Tasks (${topLevelUntimed.length})` });
        const content = drawer.createDiv({ cls: 'untimed-drawer-content' });

        topLevelUntimed.forEach(task => {
            const card = content.createDiv({ cls: `task-card${task.status === 'completed' ? ' completed' : ''}` });
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
                    btn.onclick = () => viewInstance.startTimer(task, m);
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

    const sortedTasks = [...timedTasks].sort((a, b) => {
        const aStart = (a.startHour ?? 0) * 60 + (a.startMin ?? 0);
        const bStart = (b.startHour ?? 0) * 60 + (b.startMin ?? 0);
        return aStart - bStart;
    });

    // Compute needed minutes factoring subtasks to prevent card overlap
    sortedTasks.forEach(task => {
        const taskStart = (task.startHour ?? 0) * 60 + (task.startMin ?? 0);
        const taskEnd = (task.endHour ?? (task.startHour + 1)) * 60 + (task.endMin ?? 0);
        
        const subtasks = tasks.filter(t => t.parentLineIndex === task.lineIndex);
        let neededMins = Math.max(15, taskEnd - taskStart);
        if (subtasks.length > 0) {
            const minPxNeeded = 54 + (subtasks.length * 30);
            const minMinsNeeded = Math.ceil(minPxNeeded / (hourHeight / 60));
            neededMins = Math.max(neededMins, minMinsNeeded);
        }

        task.calcStartMins = taskStart;
        task.calcEndMins = taskStart + neededMins;
    });

    const columns = [];
    sortedTasks.forEach(task => {
        const taskStart = (task.startHour ?? 0) * 60 + (task.startMin ?? 0);
        const taskEnd = (task.endHour ?? (task.startHour + 1)) * 60 + (task.endMin ?? 0);
        task.calcStartMins = taskStart;
        task.calcEndMins = Math.max(taskStart + 15, taskEnd);

        let placed = false;
        for (let col of columns) {
            const lastInCol = col[col.length - 1];
            if (lastInCol.calcEndMins <= task.calcStartMins) {
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

    columns.forEach((colTasks, colIndex) => {
        colTasks.forEach(task => {
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

            const cardTime = card.createDiv({ cls: 'timeblock-card-time' });
            const formatHourMin = (h, m) => {
                const dh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
                const ampm = h >= 12 ? 'pm' : 'am';
                return `${dh}:${m < 10 ? '0' + m : m}${ampm}`;
            };
            const timeStr = `${formatHourMin(task.startHour, task.startMin)} – ${formatHourMin(task.endHour, task.endMin)}`;
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

                // Ensure card height expands to fit nested subtasks cleanly
                const minRequiredHeight = 48 + (subtasks.length * 28);
                if (heightPx < minRequiredHeight) {
                    heightPx = minRequiredHeight;
                }
            }

            card.style.height = `${heightPx}px`;

            card.onclick = () => {
                viewInstance.startTimer(task, task.duration || parseInt(viewInstance.plugin.settings.defaultDuration));
            };
        });
    });

    setTimeout(() => {
        const scrollToMins = (currentHour >= minHour && currentHour <= maxHour)
            ? ((currentHour - minHour) * 60 + currentMin)
            : 0;
        gridWrapper.scrollTop = Math.max(0, (scrollToMins - 60) * (hourHeight / 60));
    }, 100);
}

module.exports = { renderScheduleGridView };
