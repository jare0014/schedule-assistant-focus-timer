/**
 * ExternalTaskSyncService.ts - Synchronizes task completion states with Google Tasks and Todoist APIs.
 */

import { App, Notice, requestUrl } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { TaskTimerPluginSettings } from '../types';

export class ExternalTaskSyncService {
    private tempOAuthServer: http.Server | null = null;

    constructor(private app: App, private getSettings: () => TaskTimerPluginSettings, private getSecret: (id: string, fallback: string) => Promise<string>) {}

    private getPluginDir(): string {
        const vaultPath = (this.app.vault.adapter as any).getBasePath();
        return path.join(vaultPath, '.obsidian', 'plugins', 'schedule-assistant-focus-timer');
    }

    public async getGoogleAccessToken(): Promise<string> {
        const pluginDir = this.getPluginDir();
        const tokenPath = path.join(pluginDir, 'token.json');

        if (!fs.existsSync(tokenPath)) {
            throw new Error("Google authentication token.json not found in schedule-assistant-focus-timer.");
        }

        let tokenData: any;
        try {
            tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        } catch (e: any) {
            throw new Error(`Failed to parse token.json: ${e.message}`);
        }

        const expiry = new Date(tokenData.expiry);
        const now = new Date();

        if (expiry.getTime() - now.getTime() > 60000) {
            return tokenData.token;
        }

        console.log("Google access token expired. Refreshing...");
        const url = tokenData.token_uri || 'https://oauth2.googleapis.com/token';

        const bodyDetails: Record<string, string> = {
            grant_type: 'refresh_token',
            client_id: tokenData.client_id,
            client_secret: tokenData.client_secret,
            refresh_token: tokenData.refresh_token
        };
        const body = Object.keys(bodyDetails)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(bodyDetails[key]))
            .join('&');

        const response = await Promise.race([
            requestUrl({
                url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            }),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Google OAuth token refresh timed out")), 5000))
        ]);

        if (response.status !== 200) {
            throw new Error(`Failed to refresh Google API access token. HTTP Status ${response.status}`);
        }

        const data = response.json;
        tokenData.token = data.access_token;
        if (data.expires_in) {
            const newExpiry = new Date();
            newExpiry.setSeconds(newExpiry.getSeconds() + data.expires_in);
            tokenData.expiry = newExpiry.toISOString();
        }

        try {
            fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), 'utf8');
        } catch (e) {
            console.error("Warning: could not write refreshed token back to token.json:", e);
        }

        return tokenData.token;
    }

    public async toggleGoogleTaskStatus(listId: string, taskId: string, complete: boolean): Promise<void> {
        const token = await this.getGoogleAccessToken();
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`;
        const body = {
            id: taskId,
            status: complete ? "completed" : "needsAction"
        };

        try {
            const response = await requestUrl({
                url,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.status !== 200) {
                if (response.status === 404 || response.status === 410) {
                    new Notice(`Task already completed or deleted on Google Tasks.`);
                    return;
                }
                throw new Error(`Google Tasks API returned status ${response.status}: ${response.text}`);
            }
        } catch (e: any) {
            if (e.status === 404 || e.status === 410 || (e.message && (e.message.includes("404") || e.message.includes("410")))) {
                new Notice(`Task already completed or deleted on Google Tasks.`);
                return;
            }
            throw e;
        }
    }

    public async toggleTodoistTaskStatus(taskId: string, complete: boolean, token?: string): Promise<void> {
        if (!token) {
            const settings = this.getSettings();
            const secretId = settings.todoistTokenId || 'timeblocker-todoist-token';
            token = await this.getSecret(secretId, 'todoistToken');
            if (!token) {
                const todoistPlugin = (this.app as any).plugins?.plugins?.['todoist-text'];
                token = todoistPlugin ? todoistPlugin.settings?.authToken : "";
            }
        }

        const url = `https://api.todoist.com/api/v1/tasks/${taskId}/${complete ? 'close' : 'reopen'}`;
        try {
            const response = await requestUrl({
                url,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.status !== 204 && response.status !== 200) {
                if (response.status === 404 || response.status === 410) {
                    new Notice(`Task already completed or deleted on Todoist.`);
                    return;
                }
                throw new Error(`Todoist API returned status ${response.status}: ${response.text}`);
            }
        } catch (e: any) {
            if (e.status === 404 || e.status === 410 || (e.message && (e.message.includes("404") || e.message.includes("410")))) {
                new Notice(`Task already completed or deleted on Todoist.`);
                return;
            }
            throw e;
        }
    }

    public async toggleTaskStatusByLineText(lineText: string, complete: boolean): Promise<boolean> {
        let listId = "";
        let taskId = "";

        const googleMatch = lineText.match(/tasks\.google\.com\/(?:#)?task\/([^\/]+)\/([^\s\)]+)/);
        const googleQueryMatch = lineText.match(/tasks\.google\.com\/[?#](?:listId|list)=([^&]+)&(?:taskId|task)=([^\s\)]+)/);

        if (googleMatch) {
            listId = googleMatch[1];
            taskId = googleMatch[2];
        } else if (googleQueryMatch) {
            listId = googleQueryMatch[1];
            taskId = googleQueryMatch[2];
        }

        if (listId && taskId) {
            new Notice(`Updating task status on Google Tasks...`);
            await this.toggleGoogleTaskStatus(listId, taskId, complete);
            return true;
        }

        const todoistMatch = lineText.match(/todoist\.com\/(?:showTask\?id=|app\/task\/|app\/project\/[^\/]+\/task\/)([A-Za-z0-9_-]+)/);
        if (todoistMatch) {
            const taskId = todoistMatch[1];
            new Notice(`Updating task status on Todoist...`);
            await this.toggleTodoistTaskStatus(taskId, complete);
            return true;
        }
        return false;
    }

    public async startGoogleOAuthFlow(): Promise<void> {
        const pluginDir = this.getPluginDir();
        const settings = this.getSettings();

        let googleSecretId = settings.googleCredentialsId || 'schedule-assistant-google-credentials';
        let credsStr = await this.getSecret(googleSecretId, 'googleCredentials');
        if (!credsStr) {
            credsStr = await this.getSecret('timeblocker-google-credentials', 'googleCredentials');
        }

        let credsData: any;
        if (credsStr) {
            try {
                credsData = JSON.parse(credsStr);
            } catch (e) {
                console.error("Failed to parse Google Credentials JSON from setting:", e);
            }
        }

        if (!credsData) {
            const credsPath = path.join(pluginDir, 'credentials.json');
            if (fs.existsSync(credsPath)) {
                try {
                    credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                } catch (e: any) {
                    throw new Error(`Failed to parse credentials.json: ${e.message}`);
                }
            }
        }

        if (!credsData) {
            throw new Error("Google Credentials JSON not configured in settings, and credentials.json not found in plugin directory.");
        }

        const web = credsData.installed || credsData.web;
        if (!web) {
            throw new Error("Invalid Google Credentials format. Expected 'installed' or 'web' client configuration.");
        }

        const clientId = web.client_id;
        const clientSecret = web.client_secret;
        const redirectUri = "http://localhost:8092";

        const scopes = [
            "https://www.googleapis.com/auth/tasks",
            "https://www.googleapis.com/auth/calendar.readonly"
        ].join(" ");

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `response_type=code` +
            `&client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(scopes)}` +
            `&access_type=offline` +
            `&prompt=consent`;

        if (this.tempOAuthServer) {
            try { this.tempOAuthServer.close(); } catch (e) {}
        }

        this.tempOAuthServer = http.createServer(async (req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const code = url.searchParams.get("code");

            if (code) {
                try {
                    const tokenUrl = "https://oauth2.googleapis.com/token";
                    const bodyDetails: Record<string, string> = {
                        code,
                        client_id: clientId,
                        client_secret: clientSecret,
                        redirect_uri: redirectUri,
                        grant_type: "authorization_code"
                    };
                    const body = Object.keys(bodyDetails)
                        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(bodyDetails[key]))
                        .join('&');

                    const response = await requestUrl({
                        url: tokenUrl,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body
                    });

                    if (response.status !== 200) {
                        throw new Error(`Token exchange failed: ${response.text}`);
                    }

                    const tokenResponse = response.json;
                    const expiryDate = new Date();
                    expiryDate.setSeconds(expiryDate.getSeconds() + (tokenResponse.expires_in || 3600));

                    const tokenData = {
                        token: tokenResponse.access_token,
                        expiry: expiryDate.toISOString(),
                        token_uri: tokenUrl,
                        client_id: clientId,
                        client_secret: clientSecret,
                        refresh_token: tokenResponse.refresh_token
                    };

                    const tokenPath = path.join(pluginDir, 'token.json');
                    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), 'utf8');

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #1e1e1e; color: #fff;">
                            <h2 style="color: #00ffd0;">Authorization Successful!</h2>
                            <p>Google Tasks and Calendar are now connected to Schedule Assistant.</p>
                            <p>You can close this tab and return to Obsidian.</p>
                        </body>
                        </html>
                    `);

                    new Notice("Successfully authorized Google Workspace!");
                } catch (err: any) {
                    console.error("OAuth token exchange failed:", err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end("Authentication failed: " + err.message);
                    new Notice("Google authorization failed: " + err.message);
                } finally {
                    setTimeout(() => {
                        if (this.tempOAuthServer) {
                            this.tempOAuthServer.close();
                            this.tempOAuthServer = null;
                        }
                    }, 1000);
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end("Authorization code missing.");
                setTimeout(() => {
                    if (this.tempOAuthServer) {
                        this.tempOAuthServer.close();
                        this.tempOAuthServer = null;
                    }
                }, 1000);
            }
        });

        this.tempOAuthServer.listen(8092, () => {
            console.log("Schedule Assistant OAuth temp server listening on port 8092");
            window.open(authUrl);
        });

        new Notice("Opening browser to authorize Google Account...");
    }
}
