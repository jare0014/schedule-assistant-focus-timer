const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createMockElement(tag = 'div', className = '') {
    const classes = new Set(className.split(' ').filter(Boolean));
    const children = [];
    const dataset = {};
    const style = {};
    const el = {
        tagName: tag,
        classes,
        children,
        dataset,
        style,
        textContent: '',
        setText: (t) => { el.textContent = t; },
        empty: () => { children.length = 0; },
        addClass: (c) => classes.add(c),
        removeClass: (c) => classes.delete(c),
        hasClass: (c) => classes.has(c),
        createDiv: (opts = {}) => {
            const child = createMockElement('div', opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        createEl: (t, opts = {}) => {
            const child = createMockElement(t, opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        createSpan: (opts = {}) => {
            const child = createMockElement('span', opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        setAttribute: () => {},
        querySelector: (selector) => {
            const find = (node) => {
                if (selector.startsWith('.') && node.classes.has(selector.slice(1))) return node;
                for (const c of node.children) {
                    const res = find(c);
                    if (res) return res;
                }
                return null;
            };
            return find(el);
        },
        querySelectorAll: (selector) => {
            const results = [];
            const collect = (node) => {
                if (selector.startsWith('.') && node.classes.has(selector.slice(1))) results.push(node);
                for (const c of node.children) collect(c);
            };
            collect(el);
            return results;
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 400 }),
        contains: () => false,
        isConnected: true
    };
    return el;
}

// Transpile WeeklyHabitService
const habitSrc = fs.readFileSync(path.join(__dirname, '../src/services/WeeklyHabitService.ts'), 'utf8');
const habitCompiled = ts.transpileModule(habitSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const habitMod = { exports: {} };
const habitFn = vm.runInThisContext(`(function(exports, require, module) {\n${habitCompiled}\n})`);
habitFn(habitMod.exports, () => ({}), habitMod);
const { WeeklyHabitService } = habitMod.exports;

// Transpile ScheduleGridView
const gridSrc = fs.readFileSync(path.join(__dirname, '../src/views/ScheduleGridView.ts'), 'utf8');
const gridCompiled = ts.transpileModule(gridSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const gridMod = { exports: {} };
const gridFn = vm.runInThisContext(`(function(exports, require, module) {\n${gridCompiled}\n})`);
const mockRequire = (id) => {
    if (id === 'obsidian') {
        return {
            Notice: class {},
            TFile: class {},
            Menu: class { addItem() { return this; } setTitle() { return this; } setIcon() { return this; } onClick() { return this; } showAtMouseEvent() {} }
        };
    }
    if (id === '../services/WeeklyHabitService') {
        return { WeeklyHabitService };
    }
    if (id === './HabitTimerButton') {
        return { addHabitTimerButton: () => {} };
    }
    return {};
};
gridFn(gridMod.exports, mockRequire, gridMod);
const { renderScheduleGridView } = gridMod.exports;

test('Schedule Grid View focus cards isolate habits by routine slot (morning, midday, evening)', async () => {
    const weeklyMarkdown = `## Habits

| Task | Monday | Tuesday |
| :--- | :---: | :---: |
| **☀️ Morning Routine** | — | — |
| Wake up | [x] | [ ] |
| Waffles | [ ] | [ ] |
| **⚡ Midday Routine** | — | — |
| Exercises: Phase 2 | [ ] | [ ] |
| Lumosity | [ ] | [ ] |
| **🌙 Evening Routine** | — | — |
| Tidy up | [ ] | [ ] |
| Run dishes | [ ] | [ ] |
`;

    const mockApp = {
        vault: {
            getAbstractFileByPath: () => ({ path: '02_Journal/02_Weekly/2026-W41.md' }),
            read: async () => weeklyMarkdown,
            modify: async () => {}
        }
    };

    // Setup global window with moment mocking Monday
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {}
    };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    globalThis.window = {
        moment: () => ({
            format: (f) => f === 'dddd' ? 'Monday' : '2026-W41'
        }),
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        setInterval: () => 1,
        clearInterval: () => {}
    };

    const container = createMockElement('div');
    const viewInstance = {
        app: mockApp,
        currentTimer: null,
        gridZoomLevel: 60,
        plugin: { settings: { defaultDuration: '20' } },
        renderSchedule: () => {}
    };

    const morningTask = {
        lineIndex: 1,
        description: 'Habits: Morning Routine',
        startHour: 6,
        startMin: 0,
        endHour: 7,
        endMin: 15,
        status: 'open'
    };
    const middayTask = {
        lineIndex: 2,
        description: 'Habits: Midday Routine',
        startHour: 12,
        startMin: 30,
        endHour: 13,
        endMin: 0,
        status: 'open'
    };
    const eveningTask = {
        lineIndex: 3,
        description: 'Habits: Evening Routine',
        startHour: 18,
        startMin: 0,
        endHour: 18,
        endMin: 45,
        status: 'open'
    };

    await renderScheduleGridView(viewInstance, container, [morningTask, middayTask, eveningTask]);

    const cards = container.querySelectorAll('.timeblock-card');
    assert.equal(cards.length, 3);

    // Morning card should contain only morning habits
    const morningItems = cards[0].querySelectorAll('.timeblock-subtask-title').map(el => el.textContent);
    assert.deepEqual(morningItems, ['Wake up', 'Waffles']);

    // Midday card should contain only midday habits
    const middayItems = cards[1].querySelectorAll('.timeblock-subtask-title').map(el => el.textContent);
    assert.deepEqual(middayItems, ['Exercises: Phase 2', 'Lumosity']);

    // Evening card should contain only evening habits
    const eveningItems = cards[2].querySelectorAll('.timeblock-subtask-title').map(el => el.textContent);
    assert.deepEqual(eveningItems, ['Tidy up', 'Run dishes']);
});
