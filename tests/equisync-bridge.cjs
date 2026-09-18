const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../browser/equisync-gsmtc.user.js'), 'utf8');

function fixture(initial = 'paused', reject = false) {
    const nodes = [];
    const handlers = {};
    let tick, click, wav, attempts = 0;
    function element() {
        const node = { nodeType: 1, isConnected: true, hidden: false, display: 'block', visibility: 'visible',
            style: {}, textContent: '', children: [], paused: true,
            getClientRects() { return this.display === 'none' ? [] : [{}]; },
            setAttribute() {}, append(...items) { this.children.push(...items); items.forEach(i => i.parentElement = this); },
            contains(target) { return this === target || this.children.some(c => c.contains(target)); },
            addEventListener(type, fn) { this[type] = fn; },
            play() { attempts++; if (reject) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; }
        };
        nodes.push(node); return node;
    }
    const body = element(), play = element(), pause = element();
    play.id = 'audioplaybutton'; pause.id = 'audiopausebutton';
    body.append(play, pause);
    function state(value) { play.display = value === 'playing' ? 'none' : 'block'; pause.display = value === 'paused' ? 'none' : 'block'; }
    state(initial);
    play.click = () => { play.clicks = (play.clicks || 0) + 1; state('playing'); };
    pause.click = () => { pause.clicks = (pause.clicks || 0) + 1; state('paused'); };
    const mediaSession = { setActionHandler(action, fn) { handlers[action] = fn; } };
    vm.runInNewContext(code, {
        document: { body, getElementById: id => nodes.find(n => n.id === id), createElement: element,
            addEventListener(type, fn) { if (type === 'click') click = fn; } },
        navigator: { mediaSession }, MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
        Blob, ArrayBuffer, DataView, URL: { createObjectURL(blob) { wav = blob; return 'blob:test'; }, revokeObjectURL() {} },
        getComputedStyle: node => node,
        MutationObserver: class { observe() {} disconnect() {} },
        setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, window: { addEventListener() {} },
        console: { info() {}, warn() {} }
    });
    const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
    return { nodes, handlers, mediaSession, state, tick: () => tick(), wav, play, pause, flush,
        attempts: () => attempts,
        status: () => nodes.find(n => n.id === 'equisync-gsmtc-bridge').children[0].textContent,
        gesture: () => click({ isTrusted: true, target: { closest: () => play } }) };
}

test('anchor is valid ten-second silent PCM and metadata has raw match URL', async () => {
    const f = fixture();
    const bytes = Buffer.from(await f.wav.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    assert.equal(bytes.readUInt32LE(40) / bytes.readUInt32LE(28), 10);
    assert.ok(bytes.subarray(44).every(b => b === 0));
    assert.match(code, /^\/\/ @match\s+https:\/\/equisync\.eocinstitute\.org\/meditation\/element\/\*$/m);
    assert.equal(code.includes('```'), false);
});

test('initial playing state activates anchor; OS controls click only the appropriate visible control', async () => {
    const f = fixture('playing');
    await f.flush();
    assert.equal(f.mediaSession.playbackState, 'playing');
    f.handlers.play();
    assert.equal(f.play.clicks, undefined);
    f.handlers.pause();
    assert.equal(f.pause.clicks, 1);
    assert.equal(f.mediaSession.playbackState, 'paused');
    f.handlers.pause();
    assert.equal(f.pause.clicks, 1);
    f.handlers.play();
    await f.flush();
    assert.equal(f.play.clicks, 1);
    assert.equal(f.mediaSession.playbackState, 'playing');
});

test('autoplay failure is visible and does not create a retry loop', async () => {
    const f = fixture('playing', true);
    await f.flush();
    assert.match(f.status(), /NotAllowedError/);
    f.tick(); f.tick();
    assert.equal(f.attempts(), 1);
    assert.equal(f.mediaSession.playbackState, 'none');
    f.gesture();
    await f.flush();
    assert.equal(f.attempts(), 2);
});

test('ambiguous or ancestor-hidden controls do not report playing or click a target', async () => {
    const f = fixture('playing');
    await f.flush();
    f.state('ambiguous'); f.tick();
    assert.equal(f.mediaSession.playbackState, 'none');
    f.handlers.play(); f.handlers.pause();
    assert.equal(f.play.clicks, undefined);
    assert.equal(f.pause.clicks, undefined);
    f.state('playing'); f.play.parentElement.visibility = 'hidden'; f.tick();
    assert.equal(f.mediaSession.playbackState, 'none');
});
