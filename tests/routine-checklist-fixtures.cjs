const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(filePath) {
    const source = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    const context = {
        exports,
        require: (mod) => {
            if (mod === 'obsidian') {
                return {
                    ItemView: function() {},
                    Notice: function() {},
                    TFile: function() {},
                    Menu: function() {}
                };
            }
            return {};
        },
        window: {
            moment: () => ({
                format: (f) => f === 'dddd' ? 'Thursday' : '2026-W41'
            })
        },
        console
    };
    vm.runInNewContext(compiled, context);
    return exports;
}

const habitServiceModule = loadModule('../src/services/WeeklyHabitService.ts');
const WeeklyHabitService = habitServiceModule.WeeklyHabitService;

const timerViewModule = loadModule('../src/views/TaskTimerView.ts');
const TaskTimerView = timerViewModule.TaskTimerView;

const remoteServerModule = loadModule('../src/services/RemoteServerService.ts');
const RemoteServerService = remoteServerModule.RemoteServerService;

test('Fixture 1: resolveRoutineChecklistItems resolves Wake Up & Waffles subtasks', () => {
    const dummyApp = { vault: {}, workspace: {} };
    const dummyPlugin = { settings: { defaultDuration: '20' } };
    const dummyLeaf = {};
    const view = new TaskTimerView(dummyLeaf, dummyPlugin);

    const wakeItems = view.resolveRoutineChecklistItems('Wake Up & Waffles');
    assert.equal(wakeItems.length, 6);
    assert.deepEqual(Array.from(wakeItems), [
        "Drink water",
        "Brew / pour coffee",
        "Take morning meds & vitamins",
        "Flonase",
        "Feed cats",
        "Make & eat waffles"
    ]);

    const wakeItemAlias = view.resolveRoutineChecklistItems('Wake up [[Wake Up & Waffles Routine]]');
    assert.equal(wakeItemAlias.length, 6);
});

test('Fixture 2: resolveRoutineChecklistItems resolves Esther morning routine subtasks', () => {
    const dummyApp = { vault: {}, workspace: {} };
    const dummyPlugin = { settings: { defaultDuration: '20' } };
    const dummyLeaf = {};
    const view = new TaskTimerView(dummyLeaf, dummyPlugin);

    const estherItems = view.resolveRoutineChecklistItems("Esther's morning routine");
    assert.equal(estherItems.length, 5);
    assert.deepEqual(Array.from(estherItems), [
        "Esther's bath",
        "Esther's lunch",
        "Esther's clothes",
        "Esther's teeth",
        "Esther's hair"
    ]);

    const estherAlias = view.resolveRoutineChecklistItems("Esther [[Esther Morning Routine]]");
    assert.equal(estherAlias.length, 5);
});

test('Fixture 3: resolveRoutineChecklistItems resolves Phase 1 exercises subtasks', () => {
    const dummyApp = { vault: {}, workspace: {} };
    const dummyPlugin = { settings: { defaultDuration: '20' } };
    const dummyLeaf = {};
    const view = new TaskTimerView(dummyLeaf, dummyPlugin);

    const exerciseItems = view.resolveRoutineChecklistItems('Exercises: Phase 1');
    assert.equal(exerciseItems.length, 8);
    assert.match(exerciseItems[0], /Sun Salute/i);
});

test('Fixture 4: getTaskDefaultDuration assigns 25m sprint for Wake Up and Esther', () => {
    const dummyApp = { vault: {}, workspace: {} };
    const dummyPlugin = { settings: { defaultDuration: '20' } };
    const dummyLeaf = {};
    const view = new TaskTimerView(dummyLeaf, dummyPlugin);

    assert.equal(view.getTaskDefaultDuration('Wake Up & Waffles'), 25);
    assert.equal(view.getTaskDefaultDuration("Esther's morning routine"), 25);
    assert.equal(view.getTaskDefaultDuration('Exercises: Phase 1'), 10);
    assert.equal(view.getTaskDefaultDuration('General Focus Sprint'), 20);
});

test('Fixture 5: RemoteServerService routine checklist and duration parity', () => {
    const dummyApp = { vault: {}, workspace: {} };
    const dummyPlugin = { settings: { defaultDuration: '20' } };
    const server = new RemoteServerService(dummyApp, dummyPlugin);

    const wakeItems = server.resolveRoutineChecklistItems('Wake Up & Waffles');
    assert.equal(wakeItems.length, 6);

    const estherItems = server.resolveRoutineChecklistItems("Esther's morning routine");
    assert.equal(estherItems.length, 5);

    assert.equal(server.getTaskDefaultDuration('Wake Up & Waffles', '20'), 25);
    assert.equal(server.getTaskDefaultDuration("Esther's morning routine", '20'), 25);
    assert.equal(server.getTaskDefaultDuration('Exercises: Phase 2', '20'), 10);
    assert.equal(server.getTaskDefaultDuration('Other block', '20'), 20);
});

test('Fixture 6: WeeklyHabitService section routing and wikilink normalization', () => {
    assert.equal(WeeklyHabitService.getHabitSectionKey('Wake Up & Waffles [[Wake Up & Waffles Routine]]'), 'morning');
    assert.equal(WeeklyHabitService.getHabitSectionKey("Esther's morning routine [[Esther Morning Routine]]"), 'morning');
    assert.equal(WeeklyHabitService.getHabitSectionKey('Habits: Midday Routine'), 'midday');
    assert.equal(WeeklyHabitService.getHabitSectionKey('Habits: Evening Routine'), 'evening');
    assert.equal(WeeklyHabitService.getHabitSectionKey('Chores: Vacuuming'), 'house');
    assert.equal(WeeklyHabitService.getHabitSectionKey('Work: Auths'), 'work');
});

test('Fixture 7: WeeklyHabitService round-trip check-off for wikilinked parent routine rows', async () => {
    let text = `## Habits\n\n| Task | Wednesday | Thursday |\n| :--- | :---: | :---: |\n| **☀️ Morning Routine** | — | — |\n| Wake Up & Waffles [[Wake Up & Waffles Routine]] | [x] | [ ] |\n| Esther's morning routine [[Esther Morning Routine]] | [x] | [ ] |\n`;
    let writes = 0;
    const app = {
        vault: {
            getAbstractFileByPath: () => ({}),
            read: async () => text,
            modify: async (_, value) => { text = value; writes++; }
        }
    };

    const okWake = await WeeklyHabitService.completeTimerHabit(app, { description: 'Wake Up & Waffles' });
    assert.equal(okWake, true);
    assert.equal(writes, 1);
    assert.match(text, /Wake Up & Waffles \[\[Wake Up & Waffles Routine\]\]\s*\|\s*\[x\]\s*\|\s*\[x\]\s*\|/);

    const okEsther = await WeeklyHabitService.completeTimerHabit(app, { description: "Esther's morning routine" });
    assert.equal(okEsther, true);
    assert.equal(writes, 2);
    assert.match(text, /Esther's morning routine \[\[Esther Morning Routine\]\]\s*\|\s*\[x\]\s*\|\s*\[x\]\s*\|/);
});
