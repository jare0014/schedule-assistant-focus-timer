// API Base URL (relative to server)
const API_BASE = '';

// State
let lastState = {
    hasDailyNote: false,
    dateStr: '',
    activeTimer: null,
    isAlarming: false,
    schedule: []
};
let isGenerating = false;
let generationStart = 0;

// Audio Alarm State
let audioCtx = null;
let alarmInterval = null;
let isPlayingAlarm = false;

// DOM Elements
const timerIdleCard = document.getElementById('timerIdleCard');
const timerActiveCard = document.getElementById('timerActiveCard');
const activeTaskTitle = document.getElementById('activeTaskTitle');
const countdownText = document.getElementById('countdownText');
const progressCircle = document.getElementById('progressCircle');
const pauseBtn = document.getElementById('pauseBtn');
const completeBtn = document.getElementById('completeBtn');
const cancelBtn = document.getElementById('cancelBtn');

const alarmOverlay = document.getElementById('alarmOverlay');
const alarmTaskName = document.getElementById('alarmTaskName');
const alarmCompleteBtn = document.getElementById('alarmCompleteBtn');
const alarmContinueBtn = document.getElementById('alarmContinueBtn');
const alarmRescheduleBtn = document.getElementById('alarmRescheduleBtn');
const alarmNotTodayBtn = document.getElementById('alarmNotTodayBtn');

const scheduleDate = document.getElementById('scheduleDate');
const syncStatus = document.getElementById('syncStatus');
const scheduleList = document.getElementById('scheduleList');
const generateScheduleBtn = document.getElementById('generateScheduleBtn');

// Setup AudioContext initializer on user interaction to satisfy browser security
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}
window.addEventListener('click', initAudio);
window.addEventListener('touchstart', initAudio);

// Draw circle progress ring
function setProgress(percent) {
    if (!progressCircle) return;
    
    // Read dynamic radius based on SVG layout (handles responsive watch vs phone size)
    let radius = 98;
    try {
        if (progressCircle.r && progressCircle.r.baseVal && typeof progressCircle.r.baseVal.value === 'number') {
            radius = progressCircle.r.baseVal.value || 98;
        }
    } catch(e) {
        radius = 98;
    }
    const circumference = radius * 2 * Math.PI;
    
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    // Bounds check
    const cleanPercent = Math.min(Math.max(isNaN(percent) ? 0 : percent, 0), 100);
    const offset = circumference - (cleanPercent / 100) * circumference;
    
    progressCircle.style.strokeDashoffset = offset;
}

// Format Seconds to MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Expose updateState globally immediately
window.updateState = function(newState) {
    if (!newState) return;
    try {
        let stateObj = newState;
        if (typeof stateObj === 'string') {
            try { stateObj = JSON.parse(stateObj); } catch(e) {}
        }
        if (typeof stateObj === 'string') {
            try { stateObj = JSON.parse(stateObj); } catch(e) {}
        }
        if (stateObj && typeof stateObj === 'object') {
            updateUI(stateObj);
        }
    } catch(e) {
        console.error("updateUI error:", e);
    }
};

// Check AndroidBridge synchronously on load
function checkAndroidBridge() {
    if (window.AndroidBridge && typeof window.AndroidBridge.getInitialState === 'function') {
        try {
            const raw = window.AndroidBridge.getInitialState();
            if (raw) {
                window.updateState(raw);
                return true;
            }
        } catch(e) {
            console.error("AndroidBridge fetch error:", e);
        }
    }
    return false;
}

// Fetch status from Obsidian Server
async function checkStatus() {
    if (checkAndroidBridge()) {
        return;
    }
    if (window.location.protocol === 'file:') return;
    try {
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) throw new Error('Network response not ok');
        const state = await response.json();
        
        syncStatus.textContent = '● Connected';
        syncStatus.style.background = 'rgba(48, 209, 88, 0.15)';
        syncStatus.style.color = '#30d158';
        
        updateUI(state);
    } catch (e) {
        console.error('Connection failed:', e);
        syncStatus.textContent = '○ Offline / Local';
        syncStatus.style.background = 'rgba(168, 130, 221, 0.15)';
        syncStatus.style.color = '#a882dd';
    }
}

// Update DOM elements based on state
function updateUI(state) {
    // 1. Date Header
    if (state.dateStr) {
        scheduleDate.textContent = state.dateStr;
    } else {
        const now = new Date();
        scheduleDate.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    // 2. Timer/Idle view toggle (Hide timer section completely if no active timer)
    const timerSection = document.getElementById('timerSection');
    if (state.activeTimer) {
        if (timerSection) timerSection.style.display = 'block';
        timerIdleCard.style.display = 'none';
        timerActiveCard.style.display = 'flex';
        
        activeTaskTitle.textContent = state.activeTimer.taskName;
        countdownText.textContent = formatTime(state.activeTimer.remainingSeconds);
        
        // Progress Ring Math
        const totalSecs = (state.activeTimer && state.activeTimer.totalSeconds > 0) ? state.activeTimer.totalSeconds : 1;
        const remainingSecs = Math.max(0, state.activeTimer.remainingSeconds || 0);
        const percent = (remainingSecs / totalSecs) * 100;
        setProgress(percent);
        
        // Pause state controls
        if (state.activeTimer.isPaused) {
            pauseBtn.textContent = 'Resume';
            pauseBtn.className = 'timer-btn btn-success'; // green
            document.querySelector('.progress-ring-container')?.classList.remove('pulsing');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.className = 'timer-btn btn-secondary'; // grey
            document.querySelector('.progress-ring-container')?.classList.add('pulsing');
        }
    } else {
        if (timerSection) timerSection.style.display = 'none';
        timerIdleCard.style.display = 'none';
        timerActiveCard.style.display = 'none';
        document.querySelector('.progress-ring-container')?.classList.remove('pulsing');
    }

    // 3. Alarm State Overlay
    if (state.isAlarming) {
        alarmOverlay.style.display = 'flex';
        alarmTaskName.textContent = state.activeTimer ? state.activeTimer.taskName : lastState.activeTimer ? lastState.activeTimer.taskName : 'Focus Block';
        startLocalAlarm();
    } else {
        alarmOverlay.style.display = 'none';
        stopLocalAlarm();
    }

    // 4. Render Schedule list if schedule exists
    if (state.schedule && Array.isArray(state.schedule)) {
        renderSchedule(state.schedule);
    }

    // 5. Handle Schedule Generation Button Re-enabling
    if (isGenerating) {
        const scheduleChanged = JSON.stringify(state.schedule) !== JSON.stringify(lastState.schedule);
        const timeoutReached = Date.now() - generationStart > 8000;
        if (scheduleChanged || timeoutReached) {
            isGenerating = false;
            if (generateScheduleBtn) {
                generateScheduleBtn.disabled = false;
                generateScheduleBtn.textContent = 'Generate';
            }
        }
    }
    
    lastState = state;
}

let currentViewMode = 'grid';

// Bind view mode toggle buttons
const viewGridBtn = document.getElementById('viewGridBtn');
const viewListBtn = document.getElementById('viewListBtn');

if (viewGridBtn && viewListBtn) {
    viewGridBtn.onclick = () => {
        currentViewMode = 'grid';
        viewGridBtn.classList.add('active');
        viewListBtn.classList.remove('active');
        if (lastState && lastState.schedule) renderSchedule(lastState.schedule);
    };
    viewListBtn.onclick = () => {
        currentViewMode = 'list';
        viewListBtn.classList.add('active');
        viewGridBtn.classList.remove('active');
        if (lastState && lastState.schedule) renderSchedule(lastState.schedule);
    };
}

let currentScheduleTasks = [];

// Bind zoom controls (static HTML buttons)
const webZoomOut = document.getElementById('webZoomOut');
const webZoomIn = document.getElementById('webZoomIn');
const webZoomFocus = document.getElementById('webZoomFocus');
if (webZoomOut) webZoomOut.onclick = () => { window.webZoomLevel = Math.max(40, (window.webZoomLevel || 60) - 20); renderSchedule(currentScheduleTasks); };
if (webZoomIn)  webZoomIn.onclick  = () => { window.webZoomLevel = Math.min(240, (window.webZoomLevel || 60) + 20); renderSchedule(currentScheduleTasks); };
if (webZoomFocus) webZoomFocus.onclick = () => { window.webZoomLevel = 130; window.webResetScrollToFocus = true; renderSchedule(currentScheduleTasks); };

// Lightweight: update only the current-time indicator position in-place (no full re-render)
function updateTimeIndicatorInPlace() {
    const indicator = document.querySelector('.current-time-indicator');
    const badge = document.querySelector('.current-time-badge');
    if (!indicator) return;
    const now = new Date();
    const hourHeight = window.webZoomLevel || 60;
    // Read minHour from a data attribute stored on the grid wrapper
    const gridWrapper = document.querySelector('.time-grid-wrapper');
    if (!gridWrapper) return;
    const minHour = parseInt(gridWrapper.dataset.minHour || '5', 10);
    const maxHour = parseInt(gridWrapper.dataset.maxHour || '22', 10);
    const h = now.getHours(), m = now.getMinutes();
    if (h < minHour || h > maxHour) { indicator.style.display = 'none'; return; }
    indicator.style.display = '';
    const top = ((h - minHour) * 60 + m) * (hourHeight / 60);
    indicator.style.top = `${top}px`;
    if (badge) badge.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
// Run time indicator update every 30 seconds without touching anything else
setInterval(updateTimeIndicatorInPlace, 30000);

// Render parsed timeline schedule
function renderSchedule(tasks) {
    scheduleList.innerHTML = '';
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    currentScheduleTasks = safeTasks;
    renderGridView(safeTasks);
}

function renderGridView(tasks) {
    const prevGrid = scheduleList.querySelector('.time-grid-wrapper');
    const prevScrollTop = prevGrid ? prevGrid.scrollTop : null;
    const prevUntimedDrawer = scheduleList.querySelector('.untimed-drawer');
    const wasUntimedOpen = prevUntimedDrawer ? prevUntimedDrawer.open : false;

    // Untimed = no valid startHour/endHour OR explicitly marked isUntimed, and no parent
    const topLevelUntimed = tasks.filter(t =>
        t.parentLineIndex === undefined &&
        (t.isUntimed ||
         t.startHour === null || t.startHour === undefined ||
         t.endHour === null || t.endHour === undefined ||
         (t.subheading && (t.subheading.includes("\u2601\ufe0f") || t.subheading.toLowerCase().includes("micro-task") || t.subheading.toLowerCase().includes("untimed"))))
    );
    const timedTasks = tasks.filter(t =>
        t.parentLineIndex === undefined &&
        !topLevelUntimed.includes(t) &&
        typeof t.startHour === 'number' &&
        typeof t.endHour === 'number'
    );

    // 1. Untimed Accordion Drawer at top (collapsed by default unless previously opened)
    if (topLevelUntimed.length > 0) {
        const drawer = document.createElement('details');
        drawer.className = 'untimed-drawer';
        drawer.open = true; // Open by default so untimed backlog items are immediately visible

        const summary = document.createElement('summary');
        summary.className = 'untimed-drawer-summary';
        summary.textContent = `📦 Untimed & Backlog Tasks (${topLevelUntimed.length})`;
        drawer.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'untimed-drawer-content';
        topLevelUntimed.forEach(task => {
            content.appendChild(createTaskCard(task));
        });
        drawer.appendChild(content);
        scheduleList.appendChild(drawer);
    }

    // 2. Day View Time Blocking Grid Container
    const dayViewContainer = document.createElement('div');
    dayViewContainer.className = 'timeblock-dayview-container';
    dayViewContainer.style.display = 'flex';
    dayViewContainer.style.flexDirection = 'column';
    dayViewContainer.style.flex = '1';
    dayViewContainer.style.height = '100%';
    dayViewContainer.style.minHeight = '350px';
    dayViewContainer.style.overflow = 'hidden';

    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'time-grid-wrapper';
    gridWrapper.style.display = 'flex';
    gridWrapper.style.flex = '1';
    gridWrapper.style.height = '100%';
    gridWrapper.style.minHeight = '350px';
    gridWrapper.style.overflowY = 'auto';

    scheduleList.style.display = 'flex';
    scheduleList.style.flexDirection = 'column';
    scheduleList.style.flex = '1';
    scheduleList.style.height = '100%';
    scheduleList.style.minHeight = '350px';
    scheduleList.style.overflow = 'hidden';

    // Calculate hour range (Default 5 AM to 10 PM)
    let minHour = 5;
    let maxHour = 22;

    timedTasks.forEach(t => {
        if (typeof t.startHour === 'number' && t.startHour < minHour) minHour = Math.max(0, t.startHour);
        if (typeof t.endHour === 'number' && t.endHour > maxHour) maxHour = Math.min(23, t.endHour);
    });

    // Store for in-place time indicator updates
    gridWrapper.dataset.minHour = minHour;
    gridWrapper.dataset.maxHour = maxHour;

    const totalHours = maxHour - minHour + 1;
    const hourHeight = window.webZoomLevel || 60;

    // Update zoom label
    const zoomLbl = document.getElementById('webZoomLabel');
    if (zoomLbl) zoomLbl.textContent = `${window.webZoomLevel || 60}px/h`;

    // Left Time Ruler
    const ruler = document.createElement('div');
    ruler.className = 'time-ruler';
    for (let h = minHour; h <= maxHour; h++) {
        const hourLabel = document.createElement('div');
        hourLabel.className = 'time-ruler-hour';
        hourLabel.style.height = `${hourHeight}px`;
        hourLabel.style.boxSizing = 'border-box';
        const displayH = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        const ampm = h >= 12 ? 'PM' : 'AM';
        hourLabel.textContent = `${displayH} ${ampm}`;
        ruler.appendChild(hourLabel);
    }
    gridWrapper.appendChild(ruler);

    // Right Canvas
    const canvas = document.createElement('div');
    canvas.className = 'time-grid-canvas';
    canvas.style.height = `${totalHours * hourHeight}px`;

    // Hour and Half-hour lines
    for (let i = 0; i < totalHours; i++) {
        const hourLine = document.createElement('div');
        hourLine.className = 'hour-grid-line';
        hourLine.style.top = `${i * hourHeight}px`;
        canvas.appendChild(hourLine);

        if (i < totalHours - 1) {
            const halfHourLine = document.createElement('div');
            halfHourLine.className = 'halfhour-grid-line';
            halfHourLine.style.top = `${(i + 0.5) * hourHeight}px`;
            canvas.appendChild(halfHourLine);
        }
    }

    // Current Time Red Laser Line
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    if (currentHour >= minHour && currentHour <= maxHour) {
        const currentMinsFromMinHour = ((currentHour - minHour) * 60) + currentMin;
        const currentTop = currentMinsFromMinHour * (hourHeight / 60);

        const timeIndicator = document.createElement('div');
        timeIndicator.className = 'current-time-indicator';
        timeIndicator.style.top = `${currentTop}px`;

        const dot = document.createElement('div');
        dot.className = 'current-time-dot';
        timeIndicator.appendChild(dot);

        const badge = document.createElement('div');
        badge.className = 'current-time-badge';
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        badge.textContent = timeStr;
        timeIndicator.appendChild(badge);

        canvas.appendChild(timeIndicator);
    }

    // Sort and layout timed task cards with overlapping column support
    const sortedTasks = [...timedTasks].sort((a, b) => {
        const aStart = (a.startHour ?? 0) * 60 + (a.startMin ?? 0);
        const bStart = (b.startHour ?? 0) * 60 + (b.startMin ?? 0);
        return aStart - bStart;
    });

    // Pre-compute calcStartMins / calcEndMins using REAL schedule times only
    // (subtask height expansion is handled in card rendering, not column layout)
    sortedTasks.forEach(task => {
        const taskStart = (task.startHour ?? 0) * 60 + (task.startMin ?? 0);
        const taskEnd = (task.endHour ?? (task.startHour + 1)) * 60 + (task.endMin ?? 0);
        task.calcStartMins = taskStart;
        task.calcEndMins = Math.max(taskStart + 15, taskEnd);
    });

    // Group truly overlapping tasks into columns (by real schedule time)
    const columns = [];
    sortedTasks.forEach(task => {
        let placed = false;
        for (let col of columns) {
            // Check ALL tasks in column for true overlap, not just the last one
            const overlaps = col.some(existing =>
                task.calcStartMins < existing.calcEndMins && task.calcEndMins > existing.calcStartMins
            );
            if (!overlaps) {
                col.push(task);
                placed = true;
                break;
            }
        }
        if (!placed) columns.push([task]);
    });

    const totalCols = columns.length || 1;

    columns.forEach((colTasks, colIndex) => {
        colTasks.forEach(task => {
            const startMinsFromMinHour = task.calcStartMins - (minHour * 60);
            const durationMins = task.calcEndMins - task.calcStartMins;

            const topPx = Math.max(0, startMinsFromMinHour * (hourHeight / 60));
            let heightPx = Math.max(28, durationMins * (hourHeight / 60));

            const card = document.createElement('div');
            card.className = `timeblock-card${task.status === 'completed' ? ' completed' : ''}`;
            card.style.top = `${topPx}px`;

            const widthPercent = 100 / totalCols;
            const leftPercent = colIndex * widthPercent;
            card.style.left = `calc(${leftPercent}% + 2px)`;
            card.style.width = `calc(${widthPercent}% - 4px)`;

            // Header section: Title and Controls
            const cardHeader = document.createElement('div');
            cardHeader.className = 'timeblock-card-header';

            const titleEl = document.createElement('div');
            titleEl.className = 'timeblock-card-title';
            titleEl.textContent = task.description;
            cardHeader.appendChild(titleEl);

            const controls = document.createElement('div');
            controls.className = 'timeblock-card-controls';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = task.status === 'completed';
            cb.onclick = (e) => {
                e.stopPropagation();
                toggleTaskStatus(task);
            };
            controls.appendChild(cb);

            const playBtn = document.createElement('button');
            playBtn.className = 'timeblock-play-btn';
            playBtn.innerHTML = '▶';
            playBtn.title = 'Start Focus Session';
            playBtn.onclick = (e) => {
                e.stopPropagation();
                startTaskTimer(task);
            };
            controls.appendChild(playBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'timeblock-delete-btn';
            delBtn.innerHTML = '✕';
            delBtn.title = 'Remove task block from daily note';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Remove "${task.description}" and its subtasks from today's note?`)) {
                    deleteTaskBlock(task);
                }
            };
            controls.appendChild(delBtn);

            cardHeader.appendChild(controls);
            card.appendChild(cardHeader);

            // Time range & duration row
            const cardTime = document.createElement('div');
            cardTime.className = 'timeblock-card-time';

            const formatHourMin = (h, m) => {
                const dh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
                const ampm = h >= 12 ? 'pm' : 'am';
                return `${dh}:${m < 10 ? '0' + m : m}${ampm}`;
            };
            const timeStr = `${formatHourMin(task.startHour, task.startMin)} – ${formatHourMin(task.endHour, task.endMin)}`;

            cardTime.appendChild(document.createTextNode(timeStr));

            const durBadge = document.createElement('span');
            durBadge.className = 'timeblock-duration-badge';
            durBadge.textContent = `${durationMins}m`;
            cardTime.appendChild(durBadge);

            card.appendChild(cardTime);

            // Render nested subtasks if any exist for this parent task
            const subtasks = tasks.filter(t => t.parentLineIndex === task.lineIndex);
            if (subtasks.length > 0) {
                const subtasksContainer = document.createElement('div');
                subtasksContainer.className = 'timeblock-subtasks-container';

                subtasks.forEach(subtask => {
                    const subtaskEl = document.createElement('div');
                    subtaskEl.className = `timeblock-subtask-item${subtask.status === 'completed' ? ' completed' : ''}`;

                    const subCb = document.createElement('input');
                    subCb.type = 'checkbox';
                    subCb.checked = subtask.status === 'completed';
                    subCb.onclick = (e) => {
                        e.stopPropagation();
                        toggleTaskStatus(subtask);
                    };
                    subtaskEl.appendChild(subCb);

                    const subTitle = document.createElement('div');
                    subTitle.className = 'timeblock-subtask-title';
                    subTitle.textContent = subtask.description;
                    subtaskEl.appendChild(subTitle);

                    if (subtask.status !== 'completed') {
                        const subPlayBtn = document.createElement('button');
                        subPlayBtn.className = 'timeblock-subtask-play-btn';
                        subPlayBtn.textContent = '▶';
                        subPlayBtn.title = 'Start Subtask Timer';
                        subPlayBtn.onclick = (e) => {
                            e.stopPropagation();
                            startTaskTimer(subtask);
                        };
                        subtaskEl.appendChild(subPlayBtn);
                    }

                    subtasksContainer.appendChild(subtaskEl);
                });

                card.appendChild(subtasksContainer);

                // Expand height to accommodate nested subtasks
                const minRequiredHeight = 48 + (subtasks.length * 28);
                if (heightPx < minRequiredHeight) {
                    heightPx = minRequiredHeight;
                }
            }

            card.style.height = `${heightPx}px`;

            // Card click handler
            card.onclick = () => {
                startTaskTimer(task);
            };

            canvas.appendChild(card);
        });
    });

    gridWrapper.appendChild(canvas);
    dayViewContainer.appendChild(gridWrapper);
    scheduleList.appendChild(dayViewContainer);

    let targetScroll = 0;
    if (window.webResetScrollToFocus) {
        window.webResetScrollToFocus = false;
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

function renderListView(tasks) {
    // Group tasks by subheading
    const grouped = {};
    tasks.forEach(t => {
        const cat = t.subheading || 'Agenda';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
    });

    for (const subheading in grouped) {
        const subEl = document.createElement('div');
        subEl.className = 'schedule-subheading';
        subEl.textContent = subheading.replace(/^###\s+/, '');
        scheduleList.appendChild(subEl);

        const groupSection = document.createElement('div');
        groupSection.className = 'schedule-group-section';
        groupSection.setAttribute('data-subheading', subheading);

        grouped[subheading].forEach(task => {
            const card = createTaskCard(task);
            groupSection.appendChild(card);
        });

        scheduleList.appendChild(groupSection);
    }
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = `task-card${task.status === 'completed' ? ' completed' : ''}`;
    card.setAttribute('draggable', 'true');
    card.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({
            lineIndex: task.lineIndex,
            description: task.description,
            isUntimed: task.isUntimed
        }));
    };

    const left = document.createElement('div');
    left.className = 'task-card-left';

    const timeEl = document.createElement('div');
    timeEl.className = 'task-card-time';
    if (task.isUntimed) {
        timeEl.textContent = 'Untimed';
    } else {
        const timeStr = `${String(task.startHour).padStart(2, '0')}:${String(task.startMin).padStart(2, '0')} - ${String(task.endHour).padStart(2, '0')}:${String(task.endMin).padStart(2, '0')}`;
        timeEl.textContent = timeStr;
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'task-card-name';
    nameEl.textContent = task.description;

    left.appendChild(timeEl);
    left.appendChild(nameEl);

    const right = document.createElement('div');
    right.className = 'task-card-controls';

    // Checkbox completion toggle
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.status === 'completed';
    cb.onclick = async (e) => {
        e.stopPropagation();
        try {
            await fetch(`${API_BASE}/api/task/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lineIndex: task.lineIndex, complete: cb.checked })
            });
            checkStatus();
        } catch(err) {
            cb.checked = !cb.checked; // revert UI
        }
    };
    right.appendChild(cb);

    if (task.status !== 'completed') {
        if (task.isUntimed) {
            // Render quick timer buttons: 5m, 10m, 15m, 20m
            [5, 10, 15, 20].forEach(m => {
                const btn = document.createElement('button');
                btn.className = 'task-card-btn task-card-quick-timer-btn';
                btn.textContent = `${m}m`;
                btn.title = `Start ${m}m timer`;
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    await fetch(`${API_BASE}/api/timer/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lineIndex: task.lineIndex, durationMinutes: m })
                    });
                    checkStatus();
                };
                right.appendChild(btn);
            });
        } else {
            // Play/Start Button
            const playBtn = document.createElement('button');
            playBtn.className = 'task-card-btn task-card-play-btn';
            playBtn.title = 'Start Focus Session';
            playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            playBtn.onclick = async (e) => {
                e.stopPropagation();
                await fetch(`${API_BASE}/api/timer/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lineIndex: task.lineIndex })
                });
                checkStatus();
            };

            // Postpone Button
            const postBtn = document.createElement('button');
            postBtn.className = 'task-card-btn task-card-postpone-btn';
            postBtn.title = 'Postpone task';
            postBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
            postBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Postpone "${task.description}" to the next open afternoon slot?`)) {
                    await fetch(`${API_BASE}/api/task/postpone`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lineIndex: task.lineIndex })
                    });
                    checkStatus();
                }
            };

            right.appendChild(playBtn);
            right.appendChild(postBtn);
        }
    }

    // Not Today / Skip Button
    const delBtn = document.createElement('button');
    delBtn.className = 'task-card-btn task-card-delete-btn';
    delBtn.title = 'Not today';
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Skip "${task.description}" for today?`)) {
            await fetch(`${API_BASE}/api/task/nottoday`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lineIndex: task.lineIndex })
            });
            checkStatus();
        }
    };

    right.appendChild(delBtn);

    card.appendChild(left);
    card.appendChild(right);
    return card;
}

async function handleTaskDrop(draggedTask, targetSubheading) {
    try {
        await fetch(`${API_BASE}/api/task/drop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draggedTask, targetSubheading })
        });
        checkStatus();
    } catch (err) {
        console.error("Failed to drop task:", err);
    }
}

async function deleteTaskBlock(task) {
    try {
        const res = await fetch(`${API_BASE}/api/task/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineIndex: task.lineIndex, description: task.description })
        });
        if (res.ok) {
            checkStatus();
        }
    } catch (err) {
        console.error('Failed to delete task block:', err);
    }
}

// Play Synthesized Siren Loop (Matches Desktop saw-wave siren)
function startLocalAlarm() {
    if (isPlayingAlarm) return;
    isPlayingAlarm = true;
    
    // Trigger mobile browser haptic vibration alert (vibrate 1s, pause 0.5s, vibrate 1s)
    if (navigator.vibrate) {
        navigator.vibrate([1000, 500, 1000]);
    }
    
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        let isHigh = false;
        let counter = 0;
        
        alarmInterval = setInterval(() => {
            // Auto timeout after 30 seconds
            if (counter >= 60) {
                stopLocalAlarm();
                return;
            }
            
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.type = 'sawtooth';
            // Alternates pitch between 660Hz and 980Hz
            osc.frequency.setValueAtTime(isHigh ? 980 : 660, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            
            osc.start();
            osc.stop(audioCtx.currentTime + 0.35);
            
            isHigh = !isHigh;
            counter++;
        }, 500);
    } catch(e) {
        console.error('Audio synth failed:', e);
    }
}

function stopLocalAlarm() {
    if (!isPlayingAlarm) return;
    isPlayingAlarm = false;
    
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    
    if (navigator.vibrate) {
        navigator.vibrate(0); // stop any running vibration
    }
}

// Setup Event Listeners for Controls
pauseBtn.onclick = async () => {
    initAudio();
    const action = pauseBtn.textContent === 'Pause' ? 'pause' : 'resume';
    await fetch(`${API_BASE}/api/timer/${action}`, { method: 'POST' });
    checkStatus();
};

completeBtn.onclick = async () => {
    initAudio();
    await fetch(`${API_BASE}/api/timer/complete`, { method: 'POST' });
    checkStatus();
};

cancelBtn.onclick = async () => {
    initAudio();
    if (confirm('Cancel this active focus session?')) {
        await fetch(`${API_BASE}/api/timer/cancel`, { method: 'POST' });
        checkStatus();
    }
};

// Alarm overlay clicks
alarmCompleteBtn.onclick = async () => {
    initAudio();
    stopLocalAlarm();
    await fetch(`${API_BASE}/api/timer/complete`, { method: 'POST' });
    checkStatus();
};

alarmContinueBtn.onclick = async () => {
    initAudio();
    stopLocalAlarm();
    // Start standard task timer session (resumes task for default duration)
    const taskName = alarmTaskName.textContent;
    await fetch(`${API_BASE}/api/timer/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName: taskName })
    });
    checkStatus();
};

alarmRescheduleBtn.onclick = async () => {
    initAudio();
    stopLocalAlarm();
    // Postpone the task from the status log
    if (lastState.activeTimer && typeof lastState.activeTimer.lineIndex === 'number') {
        await fetch(`${API_BASE}/api/task/postpone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineIndex: lastState.activeTimer.lineIndex })
        });
    } else {
        // Fallback: search by name
        const match = lastState.schedule.find(t => t.description.toLowerCase() === alarmTaskName.textContent.toLowerCase());
        if (match) {
            await fetch(`${API_BASE}/api/task/postpone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lineIndex: match.lineIndex })
            });
        } else {
            await fetch(`${API_BASE}/api/timer/cancel`, { method: 'POST' });
        }
    }
    checkStatus();
};

alarmNotTodayBtn.onclick = async () => {
    initAudio();
    stopLocalAlarm();
    if (lastState.activeTimer && typeof lastState.activeTimer.lineIndex === 'number') {
        await fetch(`${API_BASE}/api/task/nottoday`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineIndex: lastState.activeTimer.lineIndex })
        });
    } else {
        const match = lastState.schedule.find(t => t.description.toLowerCase() === alarmTaskName.textContent.toLowerCase());
        if (match) {
            await fetch(`${API_BASE}/api/task/nottoday`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lineIndex: match.lineIndex })
            });
        } else {
            await fetch(`${API_BASE}/api/timer/cancel`, { method: 'POST' });
        }
    }
    checkStatus();
};

// Bind time adjustment buttons
const plusOneBtn = document.getElementById('plusOneBtn');
const plusFiveBtn = document.getElementById('plusFiveBtn');

if (plusOneBtn) {
    plusOneBtn.onclick = async () => {
        initAudio();
        await adjustTime(1);
    };
}

if (plusFiveBtn) {
    plusFiveBtn.onclick = async () => {
        initAudio();
        await adjustTime(5);
    };
}

// Bind schedule generation button
if (generateScheduleBtn) {
    generateScheduleBtn.onclick = async () => {
        initAudio();
        try {
            generateScheduleBtn.disabled = true;
            generateScheduleBtn.textContent = 'Generating...';
            const response = await fetch(`${API_BASE}/api/schedule/generate`, {
                method: 'POST'
            });
            if (!response.ok) {
                throw new Error('Failed to start schedule generation');
            }
            isGenerating = true;
            generationStart = Date.now();
        } catch (e) {
            console.error(e);
            alert('Failed to generate schedule: ' + e.message);
            generateScheduleBtn.disabled = false;
            generateScheduleBtn.textContent = 'Generate';
        }
    };
}

async function adjustTime(minutes) {
    try {
        await fetch(`${API_BASE}/api/timer/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes: minutes })
        });
        checkStatus();
    } catch (e) {
        console.error("Failed to adjust focus timer duration:", e);
    }
}

// Initial Poll & Setup Interval
checkStatus();
setInterval(checkStatus, 5000);

// Local smooth 1s timer countdown tick based on wall-clock targetEndTime
setInterval(() => {
    if (lastState && lastState.activeTimer && !lastState.activeTimer.isPaused) {
        let remaining = lastState.activeTimer.remainingSeconds;
        if (lastState.activeTimer.targetEndTime) {
            const remainingMs = Math.max(0, lastState.activeTimer.targetEndTime - Date.now());
            remaining = Math.ceil(remainingMs / 1000);
            lastState.activeTimer.remainingSeconds = remaining;
        } else if (remaining > 0) {
            remaining--;
            lastState.activeTimer.remainingSeconds = remaining;
        }
        if (countdownText) {
            countdownText.textContent = formatTime(remaining);
        }
        const totalSecs = (lastState.activeTimer.totalSeconds > 0) ? lastState.activeTimer.totalSeconds : 1;
        const percent = (remaining / totalSecs) * 100;
        setProgress(percent);
    }
}, 1000);

// Global state update entrypoint for embedded Android web view or native bridge
window.updateState = function(newState) {
    if (!newState) return;
    updateUI(newState);
};

