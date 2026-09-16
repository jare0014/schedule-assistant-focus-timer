/**
 * types.ts - Core interfaces, types, and constants for Schedule Assistant with Focus Timer.
 */

export const VIEW_TYPE_TASK_TIMER = 'task-timer-view';

export interface TaskTimerPluginSettings {
    defaultDuration: string;
    autoApply: boolean;
    autoRun5AM: boolean;
    lastAutoRun5AMDate: string;
    todoistToken: string;
    geminiApiKey: string;
    geminiApiKeyId: string;
    todoistTokenId: string;
    googleCredentialsId: string;
    googleCredentials: string;
    llmProvider: string;
    llmModel: string;
    customModel: string;
    ollamaUrl: string;
    enableServer: boolean;
    serverPort: string;
    focusAudioTrackUrl?: string;
    focusAudioTrackLabel?: string;
    focusAudioTrackType?: string;
    focusAudioTrackEmbedUrl?: string;
    focusAudioAutoSync?: boolean;
    focusAudioVolume?: number;
    focusAudioMiniPlayerExpanded?: boolean;
}

export const DEFAULT_SETTINGS: TaskTimerPluginSettings = {
    defaultDuration: '20',
    autoApply: false,
    autoRun5AM: true,
    lastAutoRun5AMDate: '',
    todoistToken: '',
    geminiApiKey: '',
    geminiApiKeyId: '',
    todoistTokenId: '',
    googleCredentialsId: '',
    googleCredentials: '',
    llmProvider: 'gemini',
    llmModel: 'gemini-3.5-flash',
    customModel: '',
    ollamaUrl: 'http://localhost:11434',
    enableServer: true,
    serverPort: '8089',
    focusAudioTrackUrl: '',
    focusAudioTrackLabel: '',
    focusAudioTrackType: '',
    focusAudioTrackEmbedUrl: '',
    focusAudioAutoSync: true,
    focusAudioVolume: 0.8,
    focusAudioMiniPlayerExpanded: false
};

export interface TaskItem {
    lineIndex: number;
    originalLine: string;
    status: 'completed' | 'pending';
    startHour: number | null;
    startMin: number | null;
    endHour: number | null;
    endMin: number | null;
    startMinutes: number | null;
    endMinutes: number | null;
    duration: number | null;
    description: string;
    isCalendar: boolean;
    subheading: string;
    rawDesc: string;
    isUntimed: boolean;
    project: string;
    parentLineIndex?: number;
    items?: string[];
}

export interface ActiveTimerState {
    task: TaskItem | null;
    taskName?: string;
    totalSeconds: number;
    remainingSeconds: number;
    targetEndTime?: number;
    isPaused: boolean;
    pausedRemainingMs?: number | null;
    intervalId?: any;
    startTime?: number;
    items?: string[];
    completedItems?: number[];
    alarmIntervalId?: any;
    flashIntervalId?: any;
    alarmAudioCtx?: any;
    alarmOsc?: any;
    alarmGain?: any;
    audioElement?: HTMLAudioElement | null;
}

export interface ActiveLogState {
    startTimeStr: string;
    taskName: string;
    logLine: string;
    pauses: string[];
    resumes: string[];
}
