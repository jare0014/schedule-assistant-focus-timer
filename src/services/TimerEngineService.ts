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

    public flashWindow(): void {
        try {
            const electron = (window as any).require ? (window as any).require('electron') : null;
            if (electron) {
                const win = electron.remote ? electron.remote.getCurrentWindow() : electron.BrowserWindow.getFocusedWindow();
                if (win) {
                    win.flashFrame(true);
                    setTimeout(() => {
                        try { win.flashFrame(false); } catch (e) {}
                    }, 30000);
                }
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
            const electron = (window as any).require ? (window as any).require('electron') : null;
            if (electron) {
                const win = electron.remote ? electron.remote.getCurrentWindow() : electron.BrowserWindow.getFocusedWindow();
                if (win) {
                    win.flashFrame(false);
                }
            }
        } catch (e) {}
    }

    public createTimer(
        task: TaskItem | string,
        durationMinutes: number,
        onTick: (timer: ActiveTimerState) => void,
        onComplete: (timer: ActiveTimerState) => void
    ): ActiveTimerState {
        const totalSecs = Math.max(1, Math.round(durationMinutes * 60));
        const taskObj: TaskItem | null = typeof task === 'object' ? task : null;

        const timer: ActiveTimerState = {
            task: taskObj,
            totalSeconds: totalSecs,
            remainingSeconds: totalSecs,
            isPaused: false,
            startTime: Date.now(),
            intervalId: null
        };

        timer.intervalId = setInterval(() => {
            if (timer.isPaused) return;

            timer.remainingSeconds--;
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
