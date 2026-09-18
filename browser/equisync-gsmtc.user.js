// ==UserScript==
// @name         EquiSync Global Windows GSMTC Media Controls
// @namespace    https://equisync.eocinstitute.org/
// @version      3.0.0
// @description  Exposes EquiSync Element controls through a silent media anchor, with diagnostics.
// @match        https://equisync.eocinstitute.org/meditation/element/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';
    const ID = 'equisync-gsmtc-bridge';
    if (document.getElementById(ID)) return;

    // A real ten-second PCM WAV, not a one-sample loop. No network request.
    function silentWav() {
        const rate = 8000;
        const bytes = rate * 10 * 2;
        const buffer = new ArrayBuffer(44 + bytes);
        const view = new DataView(buffer);
        const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true);
        text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, bytes, true);
        return new Blob([buffer], { type: 'audio/wav' });
    }

    const panel = document.createElement('div');
    panel.id = ID;
    panel.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;padding:8px;background:#202124;color:white;font:12px sans-serif;border-radius:6px;max-width:300px;';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    const retry = document.createElement('button');
    retry.textContent = 'Enable media controls';
    retry.style.cssText = 'display:block;margin-top:6px;';
    panel.append(status, retry);
    document.body.append(panel);

    function report(message) {
        if (status.textContent === message) return;
        status.textContent = message;
        console.info('[EquiSync GSMTC]', message);
    }
    if (!('mediaSession' in navigator)) {
        report('Media Session API unavailable in this browser.');
        retry.disabled = true;
        return;
    }

    const anchor = document.createElement('audio');
    anchor.id = `${ID}-audio`;
    anchor.src = URL.createObjectURL(silentWav());
    anchor.loop = true;
    anchor.preload = 'auto';
    // PCM samples are zero; leave the element unmuted to request audio focus.
    anchor.volume = 1;
    anchor.hidden = true;
    document.body.append(anchor);
    let pending = false;
    let blocked = false;
    let lastState = null;

    function visible(element) {
        if (!element || !element.isConnected || element.getClientRects().length === 0) return false;
        for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        }
        return true;
    }

    function siteState() {
        const play = document.getElementById('audioplaybutton');
        const pause = document.getElementById('audiopausebutton');
        if (!play || !pause) return 'missing';
        const p = visible(play), q = visible(pause);
        if (p === q) return 'unknown';
        return q ? 'playing' : 'paused';
    }

    function metadata() {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'EquiSync Element', artist: 'EOC Institute', album: 'Brainwave Meditation'
        });
    }

    function startAnchor(userGesture = false) {
        if (userGesture) blocked = false;
        if (pending || blocked || !anchor.paused) return;
        pending = true;
        metadata();
        // Called synchronously from the site's Play click or the Enable button,
        // preserving the browser's user activation rather than waiting for a mutation.
        anchor.play().then(() => {
            blocked = false;
            if (siteState() !== 'playing') anchor.pause();
        }).catch(error => {
            blocked = true;
            report(`Anchor blocked: ${error.name}. Press Play on EquiSync, then Enable media controls.`);
            console.warn('[EquiSync GSMTC] Audio play rejected', error);
        }).finally(() => { pending = false; sync(); });
    }

    function sync() {
        const state = siteState();
        if (state !== lastState) {
            lastState = state;
            if (state === 'playing') metadata();
        }
        if (state === 'playing') {
            if (!blocked && !pending && anchor.paused) startAnchor();
            navigator.mediaSession.playbackState = anchor.paused ? 'none' : 'playing';
            if (!blocked) report(anchor.paused ? 'Starting media anchor…' : 'Media anchor playing — check Windows media card');
        } else {
            anchor.pause();
            navigator.mediaSession.playbackState = state === 'paused' ? 'paused' : 'none';
            report(state === 'paused' ? 'EquiSync paused' : state === 'missing' ? 'Waiting for EquiSync controls…' : 'Cannot determine playback: both controls visible or hidden');
        }
    }

    function command(action) {
        const before = siteState();
        if (before !== (action === 'play' ? 'paused' : 'playing')) {
            sync();
            return;
        }
        const button = document.getElementById(action === 'play' ? 'audioplaybutton' : 'audiopausebutton');
        if (button && visible(button)) button.click();
        // The site, not the requested command, determines the resulting state.
        sync();
    }

    for (const action of ['play', 'pause']) {
        try { navigator.mediaSession.setActionHandler(action, () => command(action)); }
        catch (error) { console.warn(`[EquiSync GSMTC] ${action} handler unavailable`, error); }
    }
    document.addEventListener('click', event => {
        if (event.isTrusted && event.target.closest?.('#audioplaybutton')) startAnchor(true);
    }, true);
    retry.addEventListener('click', () => {
        if (siteState() === 'playing') startAnchor(true);
        else report('Start playback using EquiSync Play first.');
    });
    // Re-query controls every time: the website may replace them. Include
    // ancestor-class changes, but ignore our own diagnostic UI mutations.
    const observer = new MutationObserver(records => {
        if (records.some(record => !panel.contains(record.target) && record.target !== anchor)) sync();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    const timer = setInterval(sync, 1000);
    sync();
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        observer.disconnect(); clearInterval(timer); anchor.pause(); URL.revokeObjectURL(anchor.src);
    });
})();
