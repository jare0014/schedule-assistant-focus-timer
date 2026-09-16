/**
 * FocusAudioService.ts - Media playback coordinator for Focus Timer sessions.
 * Supports HTML5 Audio (vault/podcast MP3s), YouTube/YouTube Music (Tipper playlists),
 * Spotify embeds, and synchronizes playback directly with timer events (start/pause/resume/stop).
 */

import { App, Notice, TFile } from 'obsidian';
import { DailyNoteManager } from './DailyNoteManager';

export type AudioSourceType = 'youtube' | 'local' | 'spotify' | 'web' | 'external_web';

export interface FocusTrackItem {
    label: string;
    url: string;
    type: AudioSourceType;
    isInternal: boolean;
    videoId?: string;
    playlistId?: string;
    embedUrl?: string;
    localFile?: TFile;
}

export class FocusAudioService {
    private app: App;
    private getSettings: () => any;
    private saveSettings: () => Promise<void>;

    // Playback state
    public currentTrack: FocusTrackItem | null = null;
    public isPlaying: boolean = false;
    public wasPlayingBeforePause: boolean = false;
    public autoSyncWithTimer: boolean = true;
    public volume: number = 0.8; // 0.0 - 1.0
    public isMuted: boolean = false;

    // Player Elements
    private audioElement: HTMLAudioElement | null = null;
    private iframeElement: HTMLIFrameElement | null = null;
    private containerEl: HTMLElement | null = null;

    // Listeners
    private stateListeners: ((service: FocusAudioService) => void)[] = [];
    private onTimerToggle: ((targetState?: 'pause' | 'resume' | 'toggle') => Promise<boolean> | boolean) | null = null;
    private messageListener: ((evt: MessageEvent) => void) | null = null;
    private onEnsureVisible: (() => void) | null = null;

    constructor(app: App, getSettings: () => any, saveSettings: () => Promise<void>) {
        this.app = app;
        this.getSettings = getSettings;
        this.saveSettings = saveSettings;

        // Restore saved preference if available
        const s = this.getSettings();
        if (s && typeof s.focusAudioAutoSync === 'boolean') {
            this.autoSyncWithTimer = s.focusAudioAutoSync;
        }
        if (s && typeof s.focusAudioVolume === 'number') {
            this.volume = s.focusAudioVolume;
        }

        this.setupMediaSession();
        this.setupYouTubeMessageListener();
    }

    public setOnEnsureVisible(handler: (() => void) | null): void {
        this.onEnsureVisible = handler;
    }

    public setTimerToggleHandler(handler: ((targetState?: 'pause' | 'resume' | 'toggle') => Promise<boolean> | boolean) | null): void {
        this.onTimerToggle = handler;
    }

    public hasTimerToggleHandler(): boolean {
        return this.onTimerToggle !== null;
    }

    private setupMediaSession(): void {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

        try {
            navigator.mediaSession.setActionHandler('play', async () => {
                if (this.autoSyncWithTimer && this.onTimerToggle) {
                    const handled = await this.onTimerToggle('resume');
                    if (handled) return;
                }
                await this.resume();
            });
            navigator.mediaSession.setActionHandler('pause', async () => {
                if (this.autoSyncWithTimer && this.onTimerToggle) {
                    const handled = await this.onTimerToggle('pause');
                    if (handled) return;
                }
                this.pause();
            });
            navigator.mediaSession.setActionHandler('stop', () => {
                this.stop();
            });
        } catch (e) {
            console.warn("FocusAudioService: error setting up mediaSession:", e);
        }
    }

    private updateMediaSession(): void {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
            if (this.currentTrack) {
                (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
                    title: this.currentTrack.label.replace(/^🎙️\s*/, ''),
                    artist: 'Obsidian Focus Session',
                    album: 'Schedule Assistant'
                });
            }
        } catch (e) {}
    }

    private setupYouTubeMessageListener(): void {
        this.messageListener = async (evt: MessageEvent) => {
            try {
                let data = evt.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { return; }
                }
                if (!data || typeof data !== 'object') return;

                const playerState = data.info?.playerState !== undefined ? data.info.playerState : (data.event === 'onStateChange' ? data.info : undefined);
                if (playerState === 2) {
                    // YouTube paused externally or via media key
                    if (this.isPlaying) {
                        this.isPlaying = false;
                        this.wasPlayingBeforePause = true;
                        this.notify();
                        if (this.autoSyncWithTimer && this.onTimerToggle) {
                            await this.onTimerToggle('pause');
                        }
                    }
                } else if (playerState === 1) {
                    // YouTube playing
                    if (!this.isPlaying) {
                        this.isPlaying = true;
                        this.wasPlayingBeforePause = true;
                        this.notify();
                        if (this.autoSyncWithTimer && this.onTimerToggle) {
                            await this.onTimerToggle('resume');
                        }
                    }
                }
            } catch (e) {}
        };
        window.addEventListener('message', this.messageListener);
    }

    public onStateChange(callback: (service: FocusAudioService) => void): () => void {
        this.stateListeners.push(callback);
        return () => {
            this.stateListeners = this.stateListeners.filter(cb => cb !== callback);
        };
    }

    private notify(): void {
        this.updateMediaSession();
        this.stateListeners.forEach(cb => {
            try { cb(this); } catch (e) { console.error("Audio state listener error:", e); }
        });
    }

    public setContainer(container: HTMLElement | null): void {
        this.containerEl = container;
        if (this.iframeElement && container && !container.contains(this.iframeElement)) {
            container.appendChild(this.iframeElement);
        }
    }

    /**
     * Parses available focus audio / media tracks from the daily note and vault attachments.
     */
    public async scanAvailableTracks(dailyFile?: TFile | null): Promise<FocusTrackItem[]> {
        const tracks: FocusTrackItem[] = [];

        // 1. Parse links from today's daily note
        if (dailyFile) {
            try {
                const content = await this.app.vault.read(dailyFile);

                // External markdown links [Label](URL)
                const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
                let match;
                while ((match = mdLinkRegex.exec(content)) !== null) {
                    const label = match[1].replace(/\\/g, '').trim();
                    const url = match[2].trim();

                    if (label.toLowerCase().includes("src") || label.toLowerCase().includes("button")) {
                        continue;
                    }
                    if (tracks.some(t => t.url === url)) continue;

                    const track = this.categorizeUrl(label, url, false);
                    tracks.push(track);
                }

                // Internal wiki links [[Note|Label]] or [[Note]]
                const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
                while ((match = wikiRegex.exec(content)) !== null) {
                    const notePath = match[1].trim();
                    const alias = match[2] ? match[2].trim() : notePath;
                    const lower = notePath.toLowerCase();

                    if (lower.includes("podcast") || lower.includes("music") || lower.includes("audio") || lower.includes("meditation")) {
                        if (!tracks.some(t => t.url === notePath)) {
                            const track = this.categorizeUrl(alias, notePath, true);
                            tracks.push(track);
                        }
                    }
                }
            } catch (e) {
                console.error("FocusAudioService: error scanning daily note media:", e);
            }
        }

        // 2. Scan vault attachments for recent audio podcasts / MP3s
        try {
            const files = this.app.vault.getFiles();
            const audioFiles = files.filter(f => {
                const ext = f.extension?.toLowerCase();
                return (ext === 'mp3' || ext === 'm4a' || ext === 'wav' || ext === 'ogg') && (f.stat?.size || 0) > 1000;
            });

            // Sort newest first
            audioFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

            // Add up to top 5 recent vault audio files
            audioFiles.slice(0, 5).forEach(f => {
                const cleanName = f.basename.replace(/_/g, ' ');
                if (!tracks.some(t => t.url === f.path)) {
                    tracks.push({
                        label: `🎙️ ${cleanName}`,
                        url: f.path,
                        type: 'local',
                        isInternal: true,
                        localFile: f
                    });
                }
            });
        } catch (e) {
            console.error("FocusAudioService: error scanning vault audio files:", e);
        }

        // 3. Add default standard focus presets if not already detected
        const presets: { label: string; url: string; type: AudioSourceType; isInternal: boolean }[] = [
            { label: 'Tipper - Saenger with Singer', url: 'https://www.youtube.com/watch?v=sU1474z71xI', type: 'youtube', isInternal: false },
            { label: 'EquiSync Element System', url: 'https://equisync.eocinstitute.org/element-system/', type: 'external_web', isInternal: false },
            { label: 'YouTube Music', url: 'https://music.youtube.com/', type: 'external_web', isInternal: false },
            { label: 'Spotify Deep Focus', url: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO', type: 'spotify', isInternal: false }
        ];

        for (const preset of presets) {
            if (!tracks.some(t => t.url === preset.url || t.label.toLowerCase() === preset.label.toLowerCase())) {
                const categorized = this.categorizeUrl(preset.label, preset.url, false);
                tracks.push(categorized);
            }
        }

        return tracks;
    }

    /**
     * Categorizes a media link into YouTube, Spotify, Local, or Generic Web.
     */
    public categorizeUrl(label: string, url: string, isInternal: boolean): FocusTrackItem {
        // 1. YouTube / YouTube Music playlist (e.g. music.youtube.com/playlist?list=... or youtube.com/playlist?list=...)
        const ytPlaylistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        if (ytPlaylistMatch && (url.includes('youtube.com') || url.includes('youtu.be'))) {
            const playlistId = ytPlaylistMatch[1];
            return {
                label,
                url,
                type: 'youtube',
                isInternal: false,
                playlistId,
                embedUrl: `https://www.youtube.com/embed/videoseries?list=${playlistId}&enablejsapi=1&autoplay=1&playsinline=1`
            };
        }

        // 2. YouTube / YouTube Music video (e.g. music.youtube.com/watch?v=... or youtube.com/watch?v=...)
        const ytVideoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        if (ytVideoMatch && (url.includes('youtube.com') || url.includes('youtu.be'))) {
            const videoId = ytVideoMatch[1];
            return {
                label,
                url,
                type: 'youtube',
                isInternal: false,
                videoId,
                embedUrl: `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&playsinline=1`
            };
        }

        // 3. Spotify
        const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
        if (spotifyMatch) {
            const spotType = spotifyMatch[1];
            const spotId = spotifyMatch[2];
            return {
                label,
                url,
                type: 'spotify',
                isInternal: false,
                embedUrl: `https://open.spotify.com/embed/${spotType}/${spotId}?utm_source=generator&theme=0`
            };
        }

        // 4. External authenticated / non-embeddable web audio (YouTube Music private library channels, EquiSync)
        if (url.includes('equisync.eocinstitute.org') || url.includes('music.youtube.com') || url.includes('privately_owned')) {
            return {
                label,
                url,
                type: 'external_web',
                isInternal: false
            };
        }

        // Local internal link
        if (isInternal) {
            const file = this.app.vault.getAbstractFileByPath(url) || this.app.metadataCache.getFirstLinkpathDest(url, '');
            if (file instanceof TFile && ['mp3', 'm4a', 'wav', 'ogg'].includes(file.extension?.toLowerCase())) {
                return {
                    label,
                    url,
                    type: 'local',
                    isInternal: true,
                    localFile: file
                };
            }
            // Podcast Hub link
            return {
                label,
                url,
                type: 'web',
                isInternal: true
            };
        }

        // External generic web audio (e.g. EquiSync)
        return {
            label,
            url,
            type: 'web',
            isInternal: false,
            embedUrl: url
        };
    }

    public selectTrack(track: FocusTrackItem | null): void {
        if (this.currentTrack?.url === track?.url) return;

        // Stop current before switching
        this.stop();
        this.currentTrack = track;
        this.notify();
    }

    /**
     * Plays the currently selected track.
     */
    public async play(): Promise<void> {
        if (!this.currentTrack) return;

        try {
            if (this.currentTrack.type === 'local') {
                await this.playLocalTrack(this.currentTrack);
            } else if (this.currentTrack.type === 'youtube') {
                this.playYouTubeTrack(this.currentTrack);
            } else if (this.currentTrack.type === 'spotify' || this.currentTrack.type === 'web') {
                this.playEmbedTrack(this.currentTrack);
            } else if (this.currentTrack.type === 'external_web') {
                this.playExternalWebTrack(this.currentTrack);
            }
            this.isPlaying = true;
            this.wasPlayingBeforePause = true;
            this.notify();
        } catch (e) {
            console.error("FocusAudioService: failed to play:", e);
            new Notice(`Audio error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * Pauses the currently playing track.
     */
    public pause(): void {
        if (!this.isPlaying) return;

        if (this.currentTrack?.type === 'local') {
            if (this.audioElement) {
                this.audioElement.pause();
            }
        } else if (this.currentTrack?.type === 'youtube') {
            this.sendYouTubeCommand('pauseVideo');
        } else if (this.currentTrack?.type === 'web' || this.currentTrack?.type === 'spotify') {
            // For general iframes, mute or postMessage
            if (this.iframeElement) {
                try {
                    this.iframeElement.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                } catch (e) {}
            }
        } else if (this.currentTrack?.type === 'external_web') {
            // Managed via system media key or browser session
        }

        this.isPlaying = false;
        this.notify();
    }

    /**
     * Resumes playback from paused state.
     */
    public async resume(): Promise<void> {
        if (!this.currentTrack) return;

        if (this.currentTrack.type === 'local') {
            if (this.audioElement) {
                await this.audioElement.play();
                this.isPlaying = true;
                this.notify();
                return;
            }
        } else if (this.currentTrack.type === 'youtube') {
            if (this.iframeElement) {
                if (this.onEnsureVisible) this.onEnsureVisible();
                this.sendYouTubeCommand('playVideo');
                this.isPlaying = true;
                this.notify();
                return;
            }
        } else if (this.currentTrack.type === 'external_web') {
            this.isPlaying = true;
            this.notify();
            return;
        }

        await this.play();
    }

    public async ensureTrackLoaded(): Promise<FocusTrackItem | null> {
        if (this.currentTrack) return this.currentTrack;
        const dailyFile = DailyNoteManager.getDailyNoteFile(this.app);
        const tracks = await this.scanAvailableTracks(dailyFile);
        if (tracks.length > 0) {
            const tipperTrack = tracks.find(t => t.label.toLowerCase().includes('tipper'));
            const defaultTrack = tipperTrack || tracks[0];
            this.selectTrack(defaultTrack);
            return defaultTrack;
        }
        return null;
    }

    /**
     * Toggles between Play and Pause.
     */
    public async togglePlay(bypassTimerSync: boolean = false): Promise<void> {
        if (!bypassTimerSync && this.autoSyncWithTimer && this.onTimerToggle) {
            const handled = await this.onTimerToggle('toggle');
            if (handled) return;
        }

        if (this.isPlaying) {
            this.pause();
        } else {
            if (!this.currentTrack) {
                await this.ensureTrackLoaded();
            }
            if (this.wasPlayingBeforePause) {
                await this.resume();
            } else {
                await this.play();
            }
        }
    }

    /**
     * Stops playback completely and resets position.
     */
    public stop(): void {
        if (this.audioElement) {
            try {
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
            } catch (e) {}
        }

        if (this.iframeElement) {
            this.sendYouTubeCommand('stopVideo');
            // Remove iframe from DOM to ensure silence
            if (this.iframeElement.parentElement) {
                this.iframeElement.parentElement.removeChild(this.iframeElement);
            }
            this.iframeElement = null;
        }

        this.isPlaying = false;
        this.wasPlayingBeforePause = false;
        this.notify();
    }

    public setVolume(val: number): void {
        this.volume = Math.max(0, Math.min(1, val));
        if (this.audioElement) {
            this.audioElement.volume = this.volume;
        }
        if (this.currentTrack?.type === 'youtube') {
            this.sendYouTubeCommand('setVolume', [Math.round(this.volume * 100)]);
        }
        this.notify();

        // Persist volume
        const s = this.getSettings();
        if (s) {
            s.focusAudioVolume = this.volume;
            this.saveSettings().catch(() => {});
        }
    }

    public toggleMute(): void {
        this.isMuted = !this.isMuted;
        if (this.audioElement) {
            this.audioElement.muted = this.isMuted;
        }
        if (this.currentTrack?.type === 'youtube') {
            this.sendYouTubeCommand(this.isMuted ? 'mute' : 'unMute');
        }
        this.notify();
    }

    public setAutoSync(enabled: boolean): void {
        this.autoSyncWithTimer = enabled;
        this.notify();

        // Persist preference
        const s = this.getSettings();
        if (s) {
            s.focusAudioAutoSync = enabled;
            this.saveSettings().catch(() => {});
        }
    }

    // ==========================================
    // Internal Playback Engines
    // ==========================================

    private async playLocalTrack(track: FocusTrackItem): Promise<void> {
        if (!this.audioElement) {
            this.audioElement = new Audio();
            this.audioElement.volume = this.volume;
            this.audioElement.onended = () => {
                this.isPlaying = false;
                this.wasPlayingBeforePause = false;
                this.notify();
            };
        }

        let audioSrc = track.url;
        if (track.localFile) {
            audioSrc = this.app.vault.getResourcePath(track.localFile);
        } else {
            const dest = this.app.metadataCache.getFirstLinkpathDest(track.url, '');
            if (dest instanceof TFile) {
                audioSrc = this.app.vault.getResourcePath(dest);
            }
        }

        this.audioElement.src = audioSrc;
        this.audioElement.volume = this.volume;
        await this.audioElement.play();
    }

    private playYouTubeTrack(track: FocusTrackItem): void {
        this.ensureIframe(track.embedUrl || track.url);
        if (this.onEnsureVisible) {
            this.onEnsureVisible();
        }
        // Delay slightly for iframe load then play
        setTimeout(() => {
            this.sendYouTubeCommand('addEventListener', ['onStateChange']);
            this.sendYouTubeCommand('playVideo');
            this.sendYouTubeCommand('setVolume', [Math.round(this.volume * 100)]);
        }, 1000);
    }

    private playEmbedTrack(track: FocusTrackItem): void {
        if (track.embedUrl) {
            this.ensureIframe(track.embedUrl);
        } else if (track.isInternal) {
            this.app.workspace.openLinkText(track.url, '', false);
        } else {
            window.open(track.url, '_blank');
        }
    }

    private playExternalWebTrack(track: FocusTrackItem): void {
        // Clear any previous iframe from container to avoid dead "refused to connect" boxes
        if (this.iframeElement && this.iframeElement.parentElement) {
            this.iframeElement.parentElement.removeChild(this.iframeElement);
            this.iframeElement = null;
        }

        // Open in user's default browser (where they are logged in to YouTube Music / Google)
        window.open(track.url, '_blank');
        if (this.onEnsureVisible) {
            this.onEnsureVisible();
        }
    }

    public ensureIframe(src?: string): HTMLIFrameElement {
        if (!this.iframeElement) {
            this.iframeElement = document.createElement('iframe');
            this.iframeElement.className = 'focus-audio-embed-frame';
            this.iframeElement.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
            this.iframeElement.setAttribute('allowfullscreen', 'true');
        }

        if (src && this.iframeElement.src !== src) {
            this.iframeElement.src = src;
        }

        if (this.containerEl && !this.containerEl.contains(this.iframeElement)) {
            this.containerEl.appendChild(this.iframeElement);
        }

        return this.iframeElement;
    }

    private sendYouTubeCommand(func: string, args: any[] = []): void {
        if (this.iframeElement && this.iframeElement.contentWindow) {
            try {
                this.iframeElement.contentWindow.postMessage(
                    JSON.stringify({
                        event: 'command',
                        func: func,
                        args: args
                    }),
                    '*'
                );
            } catch (e) {
                console.error("FocusAudioService: error posting command to iframe:", e);
            }
        }
    }

    // ==========================================
    // Timer Lifecycle Integration Hooks
    // ==========================================

    public async onTimerStart(taskName?: string): Promise<void> {
        if (this.autoSyncWithTimer) {
            if (!this.currentTrack) {
                await this.ensureTrackLoaded();
            }
            if (this.currentTrack) {
                await this.play();
            }
        }
    }

    public onTimerPause(): void {
        if (this.autoSyncWithTimer && this.isPlaying) {
            this.wasPlayingBeforePause = true;
            this.pause();
        }
    }

    public async onTimerResume(): Promise<void> {
        if (this.autoSyncWithTimer) {
            if (!this.currentTrack) {
                await this.ensureTrackLoaded();
            }
            if (this.currentTrack) {
                this.wasPlayingBeforePause = true;
                await this.resume();
            }
        }
    }

    public onTimerComplete(): void {
        if (this.autoSyncWithTimer) {
            this.stop();
        }
    }

    public onTimerCancel(): void {
        if (this.autoSyncWithTimer) {
            this.stop();
        }
    }

    public onTimerAlarm(): void {
        // Always stop or mute music when siren/alarm goes off
        this.stop();
    }
}
