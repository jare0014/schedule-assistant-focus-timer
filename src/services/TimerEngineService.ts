/**
 * TimerEngineService.ts - Ticker countdown, Web Audio alarm synthesizer, and window alert flasher.
 */

import { ActiveTimerState, TaskItem } from '../types';

export class TimerEngineService {
    private audioCtx: any = null;
    private alarmInterval: any = null;
    private titleInterval: any = null;
    private originalTitle: string = document.title || "Obsidian";
    public isAlarming: boolean = false;

    public playSiren(onFinished?: () => void): void {
        try {
            const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtxClass) return;
            this.audioCtx = new AudioCtxClass();
            let isHigh = false;
            let secondsElapsed = 0;

            this.alarmInterval = setInterval(() => {
                if (secondsElapsed >= 30) {
                    this.stopAlarm();
                    if (onFinished) onFinished();
                    return;
                }

                if (!this.audioCtx) return;

                const osc = this.audioCtx.createOscillator();
                const gainNode = this.audioCtx.createGain();

                osc.connect(gainNode);
                gainNode.connect(this.audioCtx.destination);

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(isHigh ? 980 : 660, this.audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.08, this.audioCtx.currentTime);

                osc.start();
                osc.stop(this.audioCtx.currentTime + 0.35);

                isHigh = !isHigh;
                secondsElapsed += 0.5;
            }, 500);
        } catch (e) {
            console.error("Failed to play synthesized audio alarm:", e);
        }
    }

    public getElectronWindow(): any {
        try {
            const electron = (window as any).require ? (window as any).require('electron') : null;
            if (!electron) return null;
            if (electron.remote && typeof electron.remote.getCurrentWindow === 'function') {
                return electron.remote.getCurrentWindow();
            }
            if (electron.BrowserWindow) {
                if (typeof electron.BrowserWindow.getFocusedWindow === 'function') {
                    const focused = electron.BrowserWindow.getFocusedWindow();
                    if (focused) return focused;
                }
                if (typeof electron.BrowserWindow.getAllWindows === 'function') {
                    const all = electron.BrowserWindow.getAllWindows();
                    if (all && all.length > 0) return all[0];
                }
            }
        } catch (e) {
            console.log("Electron window lookup failed:", e);
        }
        return null;
    }

    public setAlwaysOnTop(onTop: boolean): void {
        try {
            const win = this.getElectronWindow();
            if (win) {
                if (onTop) {
                    if (typeof win.isMinimized === 'function' && win.isMinimized()) {
                        win.restore();
                    }
                    if (typeof win.show === 'function') {
                        win.show();
                    }
                    if (typeof win.focus === 'function') {
                        win.focus();
                    }
                    try {
                        win.setAlwaysOnTop(true, 'floating');
                    } catch (e) {
                        win.setAlwaysOnTop(true);
                    }
                } else {
                    win.setAlwaysOnTop(false);
                }
            }
        } catch (e) {
            console.log("Could not set always on top:", e);
        }
        if (onTop) {
            try { window.focus(); } catch (e) {}
        }
    }

    public flashWindow(): void {
        try {
            const win = this.getElectronWindow();
            if (win && typeof win.flashFrame === 'function') {
                win.flashFrame(true);
                setTimeout(() => {
                    try { win.flashFrame(false); } catch (e) {}
                }, 30000);
            }
        } catch (e) {
            console.log("Electron flashFrame not available.");
        }
        window.focus();
    }

    public startTitleFlash(taskName: string): void {
        this.originalTitle = document.title || "Obsidian";
        let showingAlert = false;
        this.titleInterval = setInterval(() => {
            document.title = showingAlert ? `🔴 ALARM: ${taskName} 🔴` : `✨ TIME UP: ${taskName} ✨`;
            showingAlert = !showingAlert;
        }, 500);
    }

    public stopAlarm(): void {
        this.isAlarming = false;

        if (this.alarmInterval) {
            clearInterval(this.alarmInterval);
            this.alarmInterval = null;
        }
        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }

        if (this.titleInterval) {
            clearInterval(this.titleInterval);
            this.titleInterval = null;
        }
        document.title = this.originalTitle || "Obsidian";

        try {
            const win = this.getElectronWindow();
            if (win && typeof win.flashFrame === 'function') {
                win.flashFrame(false);
            }
        } catch (e) {}

        this.setAlwaysOnTop(false);
    }

    public createTimer(
        task: TaskItem | string,
        durationMinutes: number,
        onTick: (timer: ActiveTimerState) => void,
        onComplete: (timer: ActiveTimerState) => void
    ): ActiveTimerState {
        const totalSecs = Math.max(1, Math.round(durationMinutes * 60));
        const taskObj: TaskItem | null = typeof task === 'object' ? task : null;
        const now = Date.now();
        let targetEndTime = now + (totalSecs * 1000);

        const timer: ActiveTimerState = {
            task: taskObj,
            totalSeconds: totalSecs,
            remainingSeconds: totalSecs,
            isPaused: false,
            startTime: now,
            intervalId: null
        };

        timer.intervalId = setInterval(() => {
            if (timer.isPaused) {
                targetEndTime = Date.now() + (timer.remainingSeconds * 1000);
                return;
            }

            const remaining = Math.max(0, Math.ceil((targetEndTime - Date.now()) / 1000));
            timer.remainingSeconds = remaining;
            onTick(timer);

            if (timer.remainingSeconds <= 0) {
                clearInterval(timer.intervalId);
                timer.intervalId = null;
                onComplete(timer);
            }
        }, 1000);

        return timer;
    }

    public formatSeconds(seconds: number): string {
        const mins = Math.floor(Math.abs(seconds) / 60);
        const secs = Math.floor(Math.abs(seconds) % 60);
        const sign = seconds < 0 ? '-' : '';
        return `${sign}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}
