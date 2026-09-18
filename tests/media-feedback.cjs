const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

function load(file, dependencies = {}) {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports, URL, console, setTimeout, clearTimeout,
        require: name => dependencies[name] || (name === 'obsidian' ? { Plugin: class {}, ItemView: class {}, Notice: class {} } : {})
    });
    return exports;
}

async function fixture(withView = true) {
    const commands = [], audioCalls = [];
    const timer = { isPaused: false, targetEndTime: Date.now() + 60000, remainingSeconds: 60, taskName: 'Test' };
    const plugin = Object.create(load('src/main.ts').default.prototype);
    plugin.activeTimer = timer;
    plugin.focusAudioService = {
        currentTrack: { type: 'external_web' }, autoSyncWithTimer: true,
        onTimerPause: () => audioCalls.push('pause'), onTimerResume: () => audioCalls.push('play')
    };
    const view = Object.create(load('src/views/TaskTimerView.ts').TaskTimerView.prototype);
    Object.assign(view, { currentTimer: timer, plugin, contentEl: { querySelector: () => null },
        updateTimerDisplay() {}, controlHostedMedia: async action => { commands.push(action); return true; } });
    plugin.app = { vault: { adapter: { getBasePath: () => 'vault' } }, workspace: { getLeavesOfType: () => withView ? [{ view }] : [] } };
    let handler;
    const server = new EventEmitter(); server.listen = () => {};
    const Server = load('src/services/RemoteServerService.ts', {
        path, http: { createServer(fn) { handler = fn; return server; } },
        child_process: { spawn(_, args) {
            commands.push(args[5]);
            const child = new EventEmitter(); child.stdout = new EventEmitter();
            queueMicrotask(() => {
                child.stdout.emit('data', JSON.stringify({ success: true, state: args[5] === 'play' ? 'playing' : 'paused' }));
                child.emit('exit', 0);
            });
            return child;
        } }
    }).RemoteServerService;
    await new Server(plugin.app, () => plugin, () => ({ serverPort: '8090' })).startServer();
    return { plugin, view, timer, commands, audioCalls, async request(url, body) {
        const req = new EventEmitter(); Object.assign(req, { url, method: 'POST', headers: { host: 'localhost' } });
        let result;
        const done = handler(req, { setHeader() {}, writeHead() {}, end(value) { result = JSON.parse(value); } });
        req.emit('data', JSON.stringify(body)); req.emit('end'); await done; return result;
    } };
}

test('hotkey timer path owns the media command and tells AHK not to toggle again', async () => {
    const f = await fixture();
    const response = await f.plugin.toggleFocusSession();
    assert.equal(response.handledInternalAudio, true);
    assert.equal(response.isPaused, true);
    assert.deepEqual(f.commands, ['pause']);
});

for (const withView of [true, false]) {
    test(`idle hotkey never chooses a task or starts audio (${withView ? 'view' : 'no view'})`, async () => {
        const f = await fixture(withView);
        f.plugin.activeTimer = null;
        f.view.currentTimer = null;
        f.plugin.activateView = () => assert.fail('Must not open a timer view');
        f.view.startTimer = () => assert.fail('Must not start a scheduled timer');
        f.plugin.app.vault.read = () => assert.fail('Must not scan the schedule');
        f.plugin.focusAudioService.togglePlay = () => assert.fail('Must not load a saved track');
        const response = await f.request('/api/timer/toggle', {});
        assert.equal(response.success, true);
        assert.equal(response.handledInternalAudio, false);
        assert.equal(f.plugin.activeTimer, null);
        assert.deepEqual(f.commands, []);
        assert.deepEqual(f.audioCalls, []);
    });
    test(`media observations never echo commands (${withView ? 'view' : 'no view'})`, async () => {
        const f = await fixture(withView);
        for (const state of ['paused', 'paused', 'playing', 'playing', 'paused']) {
            await f.request('/api/timer/media-sync', { state, app: 'chrome.exe' });
            assert.equal(f.timer.isPaused, state === 'paused');
        }
        assert.deepEqual(f.commands, []);
        assert.deepEqual(f.audioCalls, []);
    });
    test(`explicit media control synchronizes timer without a second command (${withView ? 'view' : 'no view'})`, async () => {
        const f = await fixture(withView);
        await f.request('/api/media/control', { action: 'pause' });
        assert.equal(f.timer.isPaused, true);
        await f.request('/api/media/control', { action: 'play' });
        assert.equal(f.timer.isPaused, false);
        assert.deepEqual(f.commands, ['pause', 'play']);
        assert.deepEqual(f.audioCalls, []);
    });
}
