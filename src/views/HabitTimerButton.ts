/** Shared timer control for today's matrix items in the schedule sidepanel. */
export function addHabitTimerButton(container: HTMLElement, view: any, name: string, sectionKey: string): HTMLButtonElement {
    const defaultMinutes = () => {
        const configured = Number.parseInt(view.plugin.settings.defaultDuration, 10);
        return Number.isFinite(configured) && configured > 0 ? configured : 20;
    };
    const section = sectionKey === 'habits' ? 'morning' : sectionKey;
    const isActive = Boolean(view.currentTimer && (
        (view.currentTimer.taskName && view.currentTimer.taskName.toLowerCase().trim() === name.toLowerCase().trim()) ||
        (view.currentTimer.task && view.currentTimer.task.description && view.currentTimer.task.description.toLowerCase().trim() === name.toLowerCase().trim())
    ));
    const isPaused = Boolean(view.currentTimer?.isPaused);
    const button = container.createEl('button', {
        cls: `habit-timer-start${isActive ? (isPaused ? ' is-paused' : ' is-active') : ''}`,
        text: isActive ? (isPaused ? '▶' : '⏸') : `▶ ${defaultMinutes()}m`,
        attr: {
            title: isActive ? (isPaused ? `Resume timer for ${name}` : `Pause timer for ${name}`) : `Start a ${defaultMinutes()}-minute timer for ${name}`,
            'aria-label': `Start a ${defaultMinutes()}-minute timer for ${name}`
        }
    });
    button.style.flexShrink = '0';
    button.style.fontSize = '0.8em';
    button.onclick = async event => {
        event.stopPropagation();
        if (isActive) {
            if (typeof view.togglePause === 'function') await view.togglePause();
            if (typeof view.renderSchedule === 'function') view.renderSchedule();
            return;
        }
        button.disabled = true;
        try {
            const duration = defaultMinutes();
            await view.startTimer({ description: name, sectionKey: section, duration }, duration);
        } finally {
            button.disabled = false;
        }
    };
    return button;
}

