/**
 * PythonSchedulerRunner.ts - Manages Python environment and runs timeblocker.py with SecretStorage credentials.
 */

import { App, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { TaskTimerPluginSettings } from '../types';
import { DailyNoteManager } from './DailyNoteManager';
import { SchedulerProgressModal } from '../views/SchedulerProgressModal';

export class PythonSchedulerRunner {
    constructor(
        private app: App,
        private getSettings: () => TaskTimerPluginSettings,
        private saveSettings: () => Promise<void>,
        private getSecret: (id: string, fallback: string) => Promise<string>
    ) {}

    private getPluginDir(): string {
        const vaultPath = (this.app.vault.adapter as any).getBasePath();
        return path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
    }

    public async ensureVenv(): Promise<void> {
        const pluginDir = this.getPluginDir();
        const venvDir = path.join(pluginDir, '.venv');

        if (fs.existsSync(venvDir)) {
            return;
        }

        new Notice("Schedule Assistant: Setting up Python virtual environment (this may take a minute)...");

        const checkPython = (cmd: string, cb: (ok: boolean) => void) => {
            exec(`${cmd} --version`, (err) => cb(!err));
        };

        checkPython('python', (hasPython) => {
            const pyCmd = hasPython ? 'python' : 'python3';
            exec(`${pyCmd} -m venv .venv`, { cwd: pluginDir }, (err) => {
                if (err) {
                    console.error("Failed to create venv:", err);
                    new Notice("Failed to create Python virtual environment. Please install python.");
                    return;
                }
                const isWin = os.platform() === 'win32';
                const pipCmd = isWin
                    ? `"${path.join(venvDir, 'Scripts', 'pip.exe')}" install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client google-genai requests`
                    : `"${path.join(venvDir, 'bin', 'pip')}" install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client google-genai requests`;

                exec(pipCmd, (pipErr) => {
                    if (pipErr) {
                        console.error("Failed to install dependencies:", pipErr);
                        new Notice("Failed to install python dependencies.");
                    } else {
                        new Notice("Schedule Assistant: Python environment ready!");
                    }
                });
            });
        });
    }

    public async runTaskLoader(autoApply = false, dateToMarkOnSuccess: string | null = null): Promise<void> {
        const vaultPath = (this.app.vault.adapter as any).getBasePath();
        const pluginDir = this.getPluginDir();
        const scriptPath = path.join(pluginDir, 'timeblocker.py');

        if (!fs.existsSync(scriptPath)) {
            new Notice(`Python scheduler not found at ${scriptPath}`);
            return;
        }

        const settings = this.getSettings();

        // Retrieve secrets securely from Obsidian SecretStorage
        let geminiApiKey = '';
        for (const k of [settings.geminiApiKeyId || 'schedule-assistant-gemini-api-key', 'timeblocker-gemini-api-key', 'omni-logger-gemini-api-key', 'gemini-api-key', 'geminiApiKey', 'gemini']) {
            try {
                const val = await (this.app as any).secretStorage?.getSecret(k);
                if (val && val.trim()) { geminiApiKey = val.trim(); break; }
            } catch (e) {}
        }
        if (!geminiApiKey && settings.geminiApiKey) geminiApiKey = settings.geminiApiKey;

        let todoistToken = '';
        for (const k of [settings.todoistTokenId || 'schedule-assistant-todoist-token', 'timeblocker-todoist-token', 'todoist-token', 'todoistToken', 'todoist', 'todoist_token']) {
            try {
                const val = await (this.app as any).secretStorage?.getSecret(k);
                if (val && val.trim()) { todoistToken = val.trim(); break; }
            } catch (e) {}
        }
        if (!todoistToken && settings.todoistToken) todoistToken = settings.todoistToken;

        let googleCredentials = '';
        for (const k of [settings.googleCredentialsId || 'schedule-assistant-google-credentials', 'timeblocker-google-credentials', 'google-credentials']) {
            try {
                const val = await (this.app as any).secretStorage?.getSecret(k);
                if (val && val.trim()) { googleCredentials = val.trim(); break; }
            } catch (e) {}
        }
        if (!googleCredentials && settings.googleCredentials) googleCredentials = settings.googleCredentials;

        const env: Record<string, string | undefined> = Object.assign({}, process.env, {
            GEMINI_API_KEY: geminiApiKey,
            TODOIST_API_TOKEN: todoistToken,
            GOOGLE_CREDENTIALS_JSON: googleCredentials
        });

        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
        if (dailyFile) {
            env.DAILY_NOTE_PATH = path.join(vaultPath, dailyFile.path);
        } else {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            env.DAILY_NOTE_PATH = path.join(vaultPath, '02_Journal', '01_Daily', `${year}-${month}-${day}.md`);
        }

        const args = [scriptPath];
        if (autoApply || settings.autoApply) {
            args.push('--yes');
        }

        const venvPython = os.platform() === 'win32'
            ? path.join(pluginDir, '.venv', 'Scripts', 'python.exe')
            : path.join(pluginDir, '.venv', 'bin', 'python');
        const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';

        const child = spawn(pythonCmd, args, {
            cwd: pluginDir,
            env: env as NodeJS.ProcessEnv
        });

        const progressModal = new SchedulerProgressModal(this.app, child);
        progressModal.open();

        let stdout = '';
        let stderr = '';

        const runLogPath = path.join(pluginDir, 'scheduler_run.log');
        try {
            fs.writeFileSync(runLogPath, `=== Scheduler Execution Log - ${new Date().toISOString()} ===\n`, 'utf8');
        } catch (e) {
            console.error("Failed to init scheduler_run.log:", e);
        }

        child.stdout?.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            console.log("[Scheduler stdout]:", text);
            try {
                fs.appendFileSync(runLogPath, `[STDOUT] ${text}`, 'utf8');
            } catch (e) {}
        });

        child.stderr?.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            console.error("[Scheduler stderr]:", text);
            try {
                fs.appendFileSync(runLogPath, `[STDERR] ${text}`, 'utf8');
            } catch (e) {}
        });

        child.on('close', async (code) => {
            progressModal.setCompleted();
            try {
                fs.appendFileSync(runLogPath, `=== Process Exited with Code ${code} ===\n`, 'utf8');
            } catch (e) {}
            if (code === 0) {
                if (dateToMarkOnSuccess) {
                    settings.lastAutoRun5AMDate = dateToMarkOnSuccess;
                    await this.saveSettings();
                }
                new Notice("Schedule generated and applied successfully!");
                console.log("Scheduler output:\n", stdout);
            } else {
                new Notice(`Scheduler failed with exit code ${code}. Check console.`);
                console.error("Scheduler error output:\n", stderr);
            }
        });
    }
}
