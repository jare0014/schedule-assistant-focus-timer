const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

function createMockElement(tagName = 'div', cls = '') {
    const classes = new Set(cls ? cls.split(/\s+/).filter(Boolean) : []);
    const children = [];
    const dataset = {};
    const style = {};
    const el = {
        tagName,
        classes,
        children,
        dataset,
        style,
        textContent: '',
        addClass: (c) => classes.add(c),
        removeClass: (c) => classes.delete(c),
        hasClass: (c) => classes.has(c),
        createDiv: (opts = {}) => {
            const child = createMockElement('div', opts.cls || '');
            children.push(child);
            return child;
        },
        createEl: (tag, opts = {}) => {
            const child = createMockElement(tag, opts.cls || '');
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
            for (const c of children) collect(c);
            return results;
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 400 }),
        contains: () => false,
        isConnected: true
    };
    return el;
}

// Transpile ScheduleGridView.ts
const src = fs.readFileSync(path.join(__dirname, '../src/views/ScheduleGridView.ts'), 'utf8');
const compiled = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${compiled}\n})`;
const fn = vm.runInThisContext(wrapper);
const mod = { exports: {} };
const mockRequire = (id) => {
    if (id === 'obsidian') {
        return {
            Notice: class {},
            TFile: class {},
            Menu: class { addItem() { return this; } setTitle() { return this; } setIcon() { return this; } onClick() { return this; } showAtMouseEvent() {} }
        };
    }
    if (id === '../services/WeeklyHabitService') {
        return {
            WeeklyHabitService: {
                loadTodayWeeklyHabits: async () => null,
                getHabitSectionKey: () => null,
                toggleWeeklyHabit: async () => true
            }
        };
    }
    if (id === './HabitTimerButton') {
        return { addHabitTimerButton: () => {} };
    }
    return {};
};
fn(mod.exports, mockRequire, mod, path.join(__dirname, '../src/views/ScheduleGridView.ts'), path.join(__dirname, '../src/views'));
const { renderScheduleGridView } = mod.exports;

test('renderScheduleGridView renders active focus block progress bar and calculates percentage elapsed', async () => {
    const container = createMockElement('div');
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();

    // Create 3 tasks: past task, current active task, future task
    const pastTask = {
        lineIndex: 1,
        description: 'Past Morning Routine',
        startHour: Math.max(0, currentH - 2),
        startMin: 0,
        endHour: Math.max(0, currentH - 1),
        endMin: 0,
        status: 'completed'
    };

    // Current focus block spanning 1 hour around now (e.g. started 30 mins ago, ends 30 mins from now)
    const activeTask = {
        lineIndex: 2,
        description: 'Deep Focus Coding',
        startHour: currentH,
        startMin: Math.max(0, currentM - 15),
        endHour: Math.min(23, currentH + 1),
        endMin: currentM,
        status: 'open'
    };

    const futureTask = {
        lineIndex: 3,
        description: 'Evening Planning',
        startHour: Math.min(23, currentH + 2),
        startMin: 0,
        endHour: Math.min(23, currentH + 3),
        endMin: 0,
        status: 'open'
    };

    const viewInstance = {
        app: {},
        currentTimer: null,
        gridZoomLevel: 60,
        renderSchedule: () => {}
    };

    await renderScheduleGridView(viewInstance, container, [pastTask, activeTask, futureTask]);

    const cards = container.querySelectorAll('.timeblock-card');
    assert.equal(cards.length, 3);

    // Verify active card received is-time-current class
    const activeCard = cards.find(c => c.hasClass('is-time-current'));
    assert.ok(activeCard, 'Active card should have is-time-current class');

    // Verify progress bar rendered inside active card
    const track = activeCard.querySelector('.timeblock-progress-track');
    assert.ok(track, 'Active card must contain .timeblock-progress-track');

    const bar = track.querySelector('.timeblock-progress-bar');
    assert.ok(bar, 'Progress track must contain .timeblock-progress-bar');
    assert.ok(bar.style.width, 'Progress bar width should be set');
    assert.match(bar.style.width, /^\d+(\.\d+)?%$/, 'Width should be a valid percentage');

    const widthVal = parseFloat(bar.style.width);
    assert.ok(widthVal > 0 && widthVal <= 100, `Width ${widthVal}% should be > 0 and <= 100`);

    // Verify non-current cards do not have progress track
    const otherCards = cards.filter(c => c !== activeCard);
    for (const oc of otherCards) {
        assert.equal(oc.hasClass('is-time-current'), false);
        assert.equal(oc.querySelector('.timeblock-progress-track'), null);
    }

    // Clean up interval if registered on viewInstance
    if (viewInstance._scheduleProgressInterval) {
        clearInterval(viewInstance._scheduleProgressInterval);
    }
});
