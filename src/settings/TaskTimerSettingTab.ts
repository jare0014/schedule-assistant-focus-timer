/**
 * TaskTimerSettingTab.ts - Plugin settings tab with API health badges, Keychain bindings, and model selections.
 */

import { App, PluginSettingTab, Setting, requestUrl, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

export class TaskTimerSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: any) {
        super(app, plugin);
    }

    display(): void {
        try {
            const { containerEl } = this;
            containerEl.empty();
            containerEl.createEl('h2', { text: 'Schedule Assistant with Focus Timer Settings' });

            const requestWithTimeout = async (params: any, timeoutMs = 2500) => {
                return Promise.race([
                    requestUrl(params),
                    new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
                ]);
            };

            const createStatusBadge = (parentEl: HTMLElement) => {
                const badge = parentEl.createEl('span');
                badge.style.display = 'inline-block';
                badge.style.width = '10px';
                badge.style.height = '10px';
                badge.style.borderRadius = '50%';
                badge.style.marginLeft = '8px';
                badge.style.verticalAlign = 'middle';
                badge.style.backgroundColor = '#8e8e93';
                badge.setAttribute('title', 'Checking...');
                return badge;
            };

            const updateBadge = (badge: HTMLElement, ok: boolean, tooltip: string) => {
                badge.style.backgroundColor = ok ? '#30d158' : '#ff453a';
                badge.setAttribute('title', tooltip);
            };

            new Setting(containerEl)
                .setName('Default Timer Duration')
                .setDesc('Duration (in minutes) assigned to timers if not specified.')
                .addText(text => text
                    .setPlaceholder('20')
                    .setValue(this.plugin.settings.defaultDuration)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultDuration = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Auto-Apply Schedule')
                .setDesc('Skip the review GUI popup and immediately apply the generated schedule to the daily note.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.autoApply || false)
                    .onChange(async (value) => {
                        this.plugin.settings.autoApply = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Auto-Run Schedule Assistant at 5:00 AM')
                .setDesc("Automatically fetch tasks from Todoist, Google Calendar, & Google Tasks at 5:00 AM upon waking and auto-apply the schedule directly to today's daily note.")
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.autoRun5AM !== false)
                    .onChange(async (value) => {
                        this.plugin.settings.autoRun5AM = value;
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('h3', { text: 'Remote Server Settings' });

            new Setting(containerEl)
                .setName('Enable Remote Server')
                .setDesc('Start a local web server to control focus timer and schedule from Android phone, tablet, and watch.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableServer !== false)
                    .onChange(async (value) => {
                        this.plugin.settings.enableServer = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            await this.plugin.startServer();
                        } else {
                            this.plugin.stopServer();
                        }
                    }));

            new Setting(containerEl)
                .setName('Remote Server Port')
                .setDesc('The port to run the web server on (e.g. 8089). Requires server restart or toggle.')
                .addText(text => text
                    .setPlaceholder('8089')
                    .setValue(this.plugin.settings.serverPort || '8089')
                    .onChange(async (value) => {
                        this.plugin.settings.serverPort = value.trim();
                        await this.plugin.saveSettings();
                        if (this.plugin.settings.enableServer) {
                            await this.plugin.startServer();
                        }
                    }));

            containerEl.createEl('h3', { text: 'API Credentials (Keychain)' });

            // Gemini API Key
            const geminiSecretId = this.plugin.settings.geminiApiKeyId || 'schedule-assistant-gemini-api-key';
            if (!this.plugin.settings.geminiApiKeyId) {
                this.plugin.settings.geminiApiKeyId = geminiSecretId;
                this.plugin.saveSettings();
            }
            const geminiSetting = new Setting(containerEl)
                .setName('Gemini API Key')
                .setDesc('Secure API key stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Gemini API Key');
                    this.plugin.getSecret(geminiSecretId, 'geminiApiKey').then((value: string) => {
                        if (!value && geminiSecretId === 'schedule-assistant-gemini-api-key') {
                            this.plugin.getSecret('timeblocker-gemini-api-key', 'geminiApiKey').then((val: string) => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(geminiSecretId, value.trim(), 'geminiApiKey');
                    });
                });
            const geminiBadge = createStatusBadge(geminiSetting.nameEl);
            (async () => {
                let geminiKey = await this.plugin.getSecret(geminiSecretId, 'geminiApiKey');
                if (!geminiKey && geminiSecretId === 'schedule-assistant-gemini-api-key') {
                    geminiKey = await this.plugin.getSecret('timeblocker-gemini-api-key', 'geminiApiKey');
                }
                if (!geminiKey) {
                    updateBadge(geminiBadge, false, 'Missing Gemini API Key');
                    return;
                }
                try {
                    const res = await requestWithTimeout({
                        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
                        method: 'GET'
                    });
                    if (res.status === 200) {
                        updateBadge(geminiBadge, true, 'Gemini API: Connected');
                    } else {
                        updateBadge(geminiBadge, false, 'Gemini API: Invalid Key');
                    }
                } catch (e) {
                    updateBadge(geminiBadge, false, 'Gemini API: Connection Error / Timeout');
                }
            })();

            // Todoist API Token
            const todoistSecretId = this.plugin.settings.todoistTokenId || 'schedule-assistant-todoist-token';
            if (!this.plugin.settings.todoistTokenId) {
                this.plugin.settings.todoistTokenId = todoistSecretId;
                this.plugin.saveSettings();
            }
            const todoistSetting = new Setting(containerEl)
                .setName('Todoist API Token')
                .setDesc('Secure Todoist API token stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Todoist API Token');
                    this.plugin.getSecret(todoistSecretId, 'todoistToken').then((value: string) => {
                        if (!value && todoistSecretId === 'schedule-assistant-todoist-token') {
                            this.plugin.getSecret('timeblocker-todoist-token', 'todoistToken').then((val: string) => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(todoistSecretId, value.trim(), 'todoistToken');
                    });
                });
            const todoistBadge = createStatusBadge(todoistSetting.nameEl);
            (async () => {
                let todoistToken = await this.plugin.getSecret(todoistSecretId, 'todoistToken');
                if (!todoistToken && todoistSecretId === 'schedule-assistant-todoist-token') {
                    todoistToken = await this.plugin.getSecret('timeblocker-todoist-token', 'todoistToken');
                }
                if (!todoistToken) {
                    updateBadge(todoistBadge, false, 'Missing Todoist API Token');
                    return;
                }
                try {
                    const res = await requestWithTimeout({
                        url: `https://api.todoist.com/api/v1/tasks?limit=1`,
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${todoistToken}` }
                    });
                    if (res.status === 200) {
                        updateBadge(todoistBadge, true, 'Todoist API: Connected');
                    } else {
                        updateBadge(todoistBadge, false, 'Todoist API: Invalid Token');
                    }
                } catch (e) {
                    updateBadge(todoistBadge, false, 'Todoist API: Connection Error / Timeout');
                }
            })();

            // Google Credentials JSON
            const googleSecretId = this.plugin.settings.googleCredentialsId || 'schedule-assistant-google-credentials';
            if (!this.plugin.settings.googleCredentialsId) {
                this.plugin.settings.googleCredentialsId = googleSecretId;
                this.plugin.saveSettings();
            }
            const googleSetting = new Setting(containerEl)
                .setName('Google Credentials JSON')
                .setDesc('Secure client credentials JSON string (from credentials.json) stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Google Credentials JSON');
                    this.plugin.getSecret(googleSecretId, 'googleCredentials').then((value: string) => {
                        if (!value && googleSecretId === 'schedule-assistant-google-credentials') {
                            this.plugin.getSecret('timeblocker-google-credentials', 'googleCredentials').then((val: string) => text.setValue(val || ''));
                        } else {
                            text.setValue(value || '');
                        }
                    });
                    text.onChange(async (value) => {
                        await this.plugin.setSecret(googleSecretId, value.trim(), 'googleCredentials');
                    });
                });
            const googleBadge = createStatusBadge(googleSetting.nameEl);
            (async () => {
                const vaultPath = (this.app.vault.adapter as any).getBasePath();
                const tokenPath = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer', 'token.json');
                if (!fs.existsSync(tokenPath)) {
                    updateBadge(googleBadge, false, 'Google Workspace: Disconnected (No token.json)');
                    return;
                }
                try {
                    const token = await this.plugin.externalTaskSyncService?.getGoogleAccessToken();
                    if (!token) {
                        updateBadge(googleBadge, false, 'Google Workspace: Disconnected');
                        return;
                    }
                    const res = await requestWithTimeout({
                        url: `https://www.googleapis.com/tasks/v1/users/@me/lists`,
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.status === 200) {
                        updateBadge(googleBadge, true, 'Google Workspace: Connected');
                    } else {
                        updateBadge(googleBadge, false, 'Google Workspace: Auth Expired / Error');
                    }
                } catch (e) {
                    updateBadge(googleBadge, false, 'Google Workspace: Connection/Auth Error / Timeout');
                }
            })();

            // Google OAuth Connect Row & Guide
            const vaultPath = (this.app.vault.adapter as any).getBasePath();
            const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
            const hasLocalCreds = fs.existsSync(path.join(pluginDir, 'credentials.json'));

            const authSetting = new Setting(containerEl)
                .setName('Google Account Connection')
                .setDesc('Authorize Calendar, Tasks, and Health APIs directly via a frictionless browser flow.');

            authSetting.addButton(btn => {
                btn.setButtonText('Connect Google Account');
                btn.setCta();
                btn.setDisabled(true);

                (async () => {
                    let hasKeyringCreds = await this.plugin.getSecret(googleSecretId, 'googleCredentials');
                    if (!hasKeyringCreds && googleSecretId === 'schedule-assistant-google-credentials') {
                        hasKeyringCreds = await this.plugin.getSecret('timeblocker-google-credentials', 'googleCredentials');
                    }
                    if (hasLocalCreds || hasKeyringCreds) {
                        btn.setDisabled(false);
                    }
                })();

                btn.onClick(async () => {
                    try {
                        if (this.plugin.externalTaskSyncService) {
                            await this.plugin.externalTaskSyncService.startGoogleOAuthFlow();
                        }
                    } catch (e: any) {
                        new Notice("Failed to start Google OAuth flow: " + e.message);
                    }
                });
            });

            const details = containerEl.createEl('details');
            details.style.marginBottom = '20px';
            details.style.padding = '12px';
            details.style.border = '1px solid var(--background-modifier-border)';
            details.style.borderRadius = '6px';
            details.style.fontSize = '0.9em';
            details.style.backgroundColor = 'var(--background-secondary)';

            const summary = details.createEl('summary', { text: 'Google Cloud Console OAuth Setup Guide' });
            summary.style.fontWeight = 'bold';
            summary.style.cursor = 'pointer';
            summary.style.color = 'var(--text-accent)';

            const detailsBody = details.createDiv();
            detailsBody.style.marginTop = '10px';
            detailsBody.innerHTML = `
                <ol style="padding-left: 20px; color: var(--text-normal); margin-top: 6px; line-height: 1.4;">
                    <li>Go to the <a href="https://console.cloud.google.com/">Google Cloud Console</a> and create or select a project.</li>
                    <li>Enable the following APIs: <strong>Google Tasks API</strong> and <strong>Google Calendar API</strong>.</li>
                    <li>Configure the <strong>OAuth consent screen</strong>:
                        <ul style="padding-left: 20px; list-style-type: circle; margin-top: 4px;">
                            <li>Set User Type to <strong>External</strong>.</li>
                            <li>Add scopes: <code>.../auth/calendar.readonly</code> and <code>.../auth/tasks</code>.</li>
                            <li><strong>IMPORTANT:</strong> Set Publishing Status to <strong>"In Production"</strong>. If left in "Testing", Google will invalidate the token every 7 days!</li>
                        </ul>
                    </li>
                    <li>Go to <strong>Credentials</strong> > <strong>Create Credentials</strong> > <strong>OAuth client ID</strong>.
                        <ul style="padding-left: 20px; list-style-type: circle; margin-top: 4px;">
                            <li>Application type: <strong>Web application</strong></li>
                            <li>Authorized redirect URIs: <code>http://localhost:8092</code></li>
                        </ul>
                    </li>
                    <li>Download the credentials JSON, open it, copy its full content, and paste it into the <strong>Google Credentials JSON</strong> setting field above.</li>
                </ol>
            `;

            containerEl.createEl('h3', { text: 'AI Model Settings' });

            new Setting(containerEl)
                .setName('LLM Provider')
                .setDesc('Select the AI backend to use for daily schedule generation.')
                .addDropdown(dropdown => dropdown
                    .addOption('gemini', 'Gemini (Google Cloud)')
                    .addOption('ollama', 'Ollama (Local)')
                    .setValue(this.plugin.settings.llmProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.llmProvider = value;
                        if (value === 'gemini') {
                            this.plugin.settings.llmModel = 'gemini-3.5-flash';
                        } else {
                            this.plugin.settings.llmModel = 'qwen2.5:7b';
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            const provider = this.plugin.settings.llmProvider;
            const geminiOptions = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-2.0-flash'];
            const ollamaOptions = ['qwen2.5-coder:7b', 'qwen2.5:7b', 'gemma3:4b', 'llama3', 'mistral'];

            let modelDropdownValue = this.plugin.settings.llmModel;
            const currentOptions = provider === 'gemini' ? geminiOptions : ollamaOptions;

            if (!currentOptions.includes(modelDropdownValue) && modelDropdownValue !== 'custom') {
                modelDropdownValue = 'custom';
            }

            new Setting(containerEl)
                .setName('LLM Model')
                .setDesc('Select the model to use for schedule generation.')
                .addDropdown(dropdown => {
                    if (provider === 'gemini') {
                        dropdown
                            .addOption('gemini-3.5-flash', 'Gemini 3.5 Flash')
                            .addOption('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite')
                            .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
                            .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
                            .addOption('gemini-1.5-pro', 'Gemini 1.5 Pro')
                            .addOption('gemini-2.0-flash', 'Gemini 2.0 Flash')
                            .addOption('custom', 'Custom...');
                    } else {
                        dropdown
                            .addOption('qwen2.5-coder:7b', 'Qwen 2.5 Coder 7B')
                            .addOption('qwen2.5:7b', 'Qwen 2.5 7B')
                            .addOption('gemma3:4b', 'Gemma 3 4B')
                            .addOption('llama3', 'Llama 3')
                            .addOption('mistral', 'Mistral')
                            .addOption('custom', 'Custom...');
                    }

                    dropdown.setValue(modelDropdownValue)
                        .onChange(async (value) => {
                            if (value === 'custom') {
                                this.plugin.settings.llmModel = this.plugin.settings.customModel || '';
                            } else {
                                this.plugin.settings.llmModel = value;
                            }
                            await this.plugin.saveSettings();
                            this.display();
                        });
                });

            if (modelDropdownValue === 'custom') {
                new Setting(containerEl)
                    .setName('Custom Model Name')
                    .setDesc('Type the exact identifier of the model (e.g. qwen2.5:14b).')
                    .addText(text => text
                        .setPlaceholder('Enter model name')
                        .setValue(this.plugin.settings.customModel || '')
                        .onChange(async (value) => {
                            this.plugin.settings.customModel = value.trim();
                            this.plugin.settings.llmModel = value.trim();
                            await this.plugin.saveSettings();
                        }));
            }

            if (provider === 'ollama') {
                const ollamaSetting = new Setting(containerEl)
                    .setName('Ollama Endpoint')
                    .setDesc('The base URL of your local Ollama server.')
                    .addText(text => text
                        .setPlaceholder('http://localhost:11434')
                        .setValue(this.plugin.settings.ollamaUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.ollamaUrl = value.trim();
                            await this.plugin.saveSettings();
                        }));

                const ollamaBadge = createStatusBadge(ollamaSetting.nameEl);
                (async () => {
                    const ollamaUrl = this.plugin.settings.ollamaUrl || 'http://localhost:11434';
                    try {
                        const res = await requestWithTimeout({
                            url: `${ollamaUrl}/api/tags`,
                            method: 'GET'
                        });
                        if (res.status === 200) {
                            updateBadge(ollamaBadge, true, 'Ollama Server: Online');
                        } else {
                            updateBadge(ollamaBadge, false, 'Ollama Server: Unavailable');
                        }
                    } catch (e) {
                        updateBadge(ollamaBadge, false, 'Ollama Server: Offline / Timeout');
                    }
                })();
            }

            const prefsPath = path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer', 'preferences.txt');
            let prefsContent = "";
            try {
                if (fs.existsSync(prefsPath)) {
                    prefsContent = fs.readFileSync(prefsPath, 'utf8');
                }
            } catch (e) {
                console.error("Failed to read preferences.txt:", e);
            }

            new Setting(containerEl)
                .setName('Persistent Instructions')
                .setDesc('Saved instructions and preferences used by Gemini when generating your schedule.')
                .addTextArea(text => {
                    text.setValue(prefsContent)
                        .setPlaceholder('Enter your persistent scheduling instructions here...')
                        .onChange(async (value) => {
                            try {
                                fs.writeFileSync(prefsPath, value, 'utf8');
                            } catch (e: any) {
                                new Notice("Failed to save instructions: " + e.message);
                            }
                        });
                    text.inputEl.rows = 8;
                    text.inputEl.style.width = '100%';
                });
        } catch (err: any) {
            console.error("Task Timer settings tab error:", err);
            this.containerEl.createEl('p', { text: 'Failed to display settings: ' + err.message, cls: 'theme-warning' });
        }
    }
}
