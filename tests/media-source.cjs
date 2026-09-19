const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function fixture(sessions) {
    let handler;
    const calls = [];
    const server = new EventEmitter();
    server.listen = () => {};
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/RemoteServerService.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInNewContext(code, { exports, URL, console, setTimeout, clearTimeout, require(name) {
        if (name === 'obsidian') return { Notice: class {} };
        if (name === 'http') return { createServer(fn) { handler = fn; return server; } };
        if (name === 'path') return path;
        if (name === 'child_process') return { spawn(_, args) {
            const action = args[5], source = args[7];
            calls.push({ action, source });
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            queueMicrotask(() => {
                const match = source ? sessions.filter(s => s.source === source) : sessions.slice(0, 1);
                const result = action === 'sessions' ? { success: true, sessions } : match.length === 1
                    ? { ...match[0], success: true }
                    : { success: false, state: 'unavailable', source };
                child.stdout.emit('data', JSON.stringify(result));
                child.emit('exit', 0);
            });
            return child;
        } };
        return {};
    } });
    const plugin = { activeTimer: null };
    const service = new exports.RemoteServerService({ vault: { adapter: { getBasePath: () => 'vault' } } }, () => plugin, () => ({ serverPort: '8090' }));
    await service.startServer();
    return { calls, async request(url, body) {
        const req = new EventEmitter();
        Object.assign(req, { url, method: body ? 'POST' : 'GET', headers: { host: 'localhost' } });
        let code, result;
        const pending = handler(req, { setHeader() {}, writeHead(value) { code = value; }, end(value) { result = JSON.parse(value); } });
        if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
        await pending;
        return { code, ...result };
    } };
}
const session = source => ({ source, title: source, state: 'paused' });

test('cycling does not play media and later controls target selected source', async () => {
    const f = await fixture([session('Spotify.exe'), session('chrome.exe')]);
    assert.equal((await f.request('/api/media/control', { action: 'next-source' })).source, 'chrome.exe');
    assert.ok(f.calls.every(c => ['status', 'sessions'].includes(c.action)));
    await f.request('/api/media/control', { action: 'play' });
    assert.deepEqual(f.calls.at(-1), { action: 'play', source: 'chrome.exe' });
    assert.equal((await f.request('/api/media/control', { action: 'next-source' })).source, 'Spotify.exe');
});

test('disappeared selected source fails instead of falling back; unrelated sync is ignored', async () => {
    const sessions = [session('Spotify.exe'), session('chrome.exe')];
    const f = await fixture(sessions);
    await f.request('/api/media/control', { action: 'next-source' });
    sessions.pop();
    assert.equal((await f.request('/api/media/control', { action: 'play' })).code, 503);
    assert.equal(f.calls.at(-1).source, 'chrome.exe');
    assert.equal((await f.request('/api/timer/media-sync', { state: 'playing', app: 'Spotify.exe' })).action, 'ignored-unselected-source');
});

test('empty or ambiguous inventories never select or control an arbitrary session', async () => {
    for (const sessions of [[], [session('chrome.exe'), session('chrome.exe')]]) {
        const f = await fixture(sessions);
        assert.equal((await f.request('/api/media/control', { action: 'next-source' })).code, 503);
        assert.ok(f.calls.every(c => c.action === 'sessions'));
    }
});
