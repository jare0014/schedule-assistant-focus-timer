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
    const radius = progressCircle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    // Bounds check
    const cleanPercent = Math.min(Math.max(percent, 0), 100);
    const offset = circumference - (cleanPercent / 100) * circumference;
    
    progressCircle.style.strokeDashoffset = offset;
}

// Format Seconds to MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Fetch status from Obsidian Server
async function checkStatus() {
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
        syncStatus.textContent = '○ Reconnecting...';
        syncStatus.style.background = 'rgba(255, 69, 58, 0.15)';
        syncStatus.style.color = '#ff453a';
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

    // 2. Timer/Idle view toggle
    if (state.activeTimer) {
        timerIdleCard.style.display = 'none';
        timerActiveCard.style.display = 'flex';
        
        activeTaskTitle.textContent = state.activeTimer.taskName;
        countdownText.textContent = formatTime(state.activeTimer.remainingSeconds);
        
        // Progress Ring Math
        const percent = (state.activeTimer.remainingSeconds / state.activeTimer.totalSeconds) * 100;
        setProgress(percent);
        
        // Pause state controls
        if (state.activeTimer.isPaused) {
            pauseBtn.textContent = 'Resume';
            pauseBtn.className = 'timer-btn btn-success'; // green
            document.querySelector('.progress-ring-container').classList.remove('pulsing');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.className = 'timer-btn btn-secondary'; // grey
            document.querySelector('.progress-ring-container').classList.add('pulsing');
        }
    } else {
        timerIdleCard.style.display = 'block';
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

    // 4. Render Schedule list if it has changed
    if (JSON.stringify(state.schedule) !== JSON.stringify(lastState.schedule)) {
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

// Render parsed timeline schedule
function renderSchedule(tasks) {
    scheduleList.innerHTML = '';
    
    if (!tasks || tasks.length === 0) {
        scheduleList.innerHTML = '<div class="timer-idle-desc" style="text-align: center; padding: 20px;">No upcoming tasks. Check daily note.</div>';
        return;
    }

    // Group tasks by subheading
    const grouped = {};
    tasks.forEach(t => {
        const cat = t.subheading || 'Agenda';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
    });

    for (const subheading in grouped) {
        // Create subheading row
        const subEl = document.createElement('div');
        subEl.className = 'schedule-subheading';
        subEl.textContent = subheading;
        scheduleList.appendChild(subEl);

        // Create task item cards
        grouped[subheading].forEach(task => {
            const card = document.createElement('div');
            card.className = `task-card${task.status === 'completed' ? ' completed' : ''}`;
            
            const left = document.createElement('div');
            left.className = 'task-card-left';
            
            const timeStr = `${String(task.startHour).padStart(2, '0')}:${String(task.startMin).padStart(2, '0')} - ${String(task.endHour).padStart(2, '0')}:${String(task.endMin).padStart(2, '0')}`;
            const timeEl = document.createElement('div');
            timeEl.className = 'task-card-time';
            timeEl.textContent = timeStr;
            
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
                // Play/Start Button
                const playBtn = document.createElement('button');
                playBtn.className = 'task-card-btn task-card-play-btn';
                playBtn.title = 'Start Focus Session';
                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                playBtn.onclick = async () => {
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
                postBtn.onclick = async () => {
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

            // Not Today / Skip Button
            const delBtn = document.createElement('button');
            delBtn.className = 'task-card-btn task-card-delete-btn';
            delBtn.title = 'Not today';
            delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            delBtn.onclick = async () => {
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
            scheduleList.appendChild(card);
        });
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
setInterval(checkStatus, 1000);
