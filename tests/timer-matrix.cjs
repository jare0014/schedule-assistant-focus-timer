const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/services/WeeklyHabitService.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(extra = '') {
    let text = `## Habits\n\n| Task | Wednesday | Thursday |\n| --- | --- | --- |\n| **Exercises:**<br>Phase 1 | [ ] | [ ] |\n| Exercises: Phase 2 | [ ] | N/A |\n| Meditation | [ ] | [x] |\n${extra}`;
    let writes = 0;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: () => ({}), window: { moment: () => ({ format: f => f === 'dddd' ? 'Thursday' : '2026-W38' }) } });
    const app = { vault: { getAbstractFileByPath: () => ({}), read: async () => text, modify: async (_, value) => { text = value; writes++; } } };
    return { service: exports.WeeklyHabitService, app, text: () => text, writes: () => writes };
}
test('completion normalizes markup and changes only Thursday; repeat is a no-op', async () => {
    const f = fixture();
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises:  Phase 1' }), true);
    assert.match(f.text(), /Phase 1 \| \[ \] \| \[x\] \|/);
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), true);
    assert.equal(f.writes(), 1);
});
test('N/A, partial names, empty names and unknown tasks do not write', async () => {
    const f = fixture();
    for (const description of ['Exercises: Phase 2', 'Exercises', '', 'Work']) {
        assert.equal(await f.service.completeTimerHabit(f.app, { description }), false);
    }
    assert.equal(f.writes(), 0);
});
test('already completed cells do not write', async () => {
    const f = fixture();
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Meditation' }), true);
    assert.equal(f.writes(), 0);
});
test('ambiguous names across sections do not write without a section', async () => {
    const f = fixture('\n---\n## Work\n\n| Task | Wednesday | Thursday |\n| --- | --- | --- |\n| Exercises: Phase 1 | [ ] | [ ] |\n');
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), false);
    assert.equal(f.writes(), 0);
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1', sectionKey: 'work' }), true);
    assert.equal(f.writes(), 1);
});

test('shared completion handler updates a habit without requiring a daily note', async () => {
    const f = fixture();
    const viewSource = fs.readFileSync(path.join(__dirname, '../src/views/TaskTimerView.ts'), 'utf8');
    const exports = {};
    const code = ts.transpileModule(viewSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, require: name => name === 'obsidian' ? { ItemView: class {} } : name.includes('WeeklyHabitService') ? { WeeklyHabitService: f.service } : {}, console });
    const view = Object.create(exports.TaskTimerView.prototype);
    view.app = f.app;
    view.getDailyNoteFile = () => { throw new Error('Habit must not require daily note'); };
    await view.endActiveTask({ description: 'Exercises: Phase 1' });
    assert.equal(f.writes(), 1);
});

test('scheduled daily task with matching matrix name retains its daily-note target', async () => {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '../src/views/TaskTimerView.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports, console, require: name => name === 'obsidian' ? { ItemView: class {} } : name.includes('WeeklyHabitService') ? { WeeklyHabitService: { completeTimerHabit: () => { throw new Error('Must not redirect daily task'); } } } : {}
    });
    let text = '- [ ] Meditation';
    const view = Object.create(exports.TaskTimerView.prototype);
    view.app = { vault: { read: async () => text, modify: async (_, value) => { text = value; } } };
    view.plugin = {};
    view.getDailyNoteFile = () => ({});
    await view.endActiveTask({ description: 'Meditation', lineIndex: 0 });
    assert.equal(text, '- [x] Meditation');
});
