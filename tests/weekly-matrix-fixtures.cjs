const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/services/WeeklyHabitService.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(extra = '', options = {}) {
    const day = options.day || 'Thursday';
    const week = options.week || '2026-W38';
    let text = options.text !== undefined
        ? `${options.text}${extra}`
        : `## Habits\n\n| Task | Wednesday | Thursday |\n| --- | --- | --- |\n| **Exercises:**<br>Phase 1 | [ ] | [ ] |\n| Exercises: Phase 2 | [ ] | N/A |\n| Meditation | [ ] | [x] |\n${extra}`;
    let writes = 0;
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        require: () => ({}),
        window: {
            moment: () => ({
                format: f => f === 'dddd' ? day : week
            })
        }
    });
    const app = options.app || {
        vault: {
            getAbstractFileByPath: () => ({}),
            read: async () => text,
            modify: async (_, value) => { text = value; writes++; }
        }
    };
    return { service: exports.WeeklyHabitService, app, text: () => text, writes: () => writes };
}

test('Scenario A: round-trip checkbox mutation updates [ ] to [x] in today column without touching other days or rows', async () => {
    const f = fixture();
    // Wednesday: [ ], Thursday: [ ] initially
    assert.match(f.text(), /Phase 1\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|/);

    const ok = await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' });
    assert.equal(ok, true);
    assert.equal(f.writes(), 1);

    // Thursday (today) should now be [x], but Wednesday must still be [ ]
    assert.match(f.text(), /Phase 1\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);

    // Other rows must remain untouched
    assert.match(f.text(), /Exercises: Phase 2\s*\|\s*\[ \]\s*\|\s*N\/A\s*\|/);
    assert.match(f.text(), /Meditation\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);
});

test('Scenario A (toggle round-trip): toggleWeeklyHabit can uncheck an already completed cell', async () => {
    const f = fixture();
    // Complete Phase 1 on Thursday
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), true);
    assert.equal(f.writes(), 1);
    assert.match(f.text(), /Phase 1\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);

    // Uncheck Phase 1 on Thursday using toggleWeeklyHabit
    const toggled = await f.service.toggleWeeklyHabit(f.app, 'morning', 0, false);
    assert.equal(toggled, true);
    assert.equal(f.writes(), 2);
    assert.match(f.text(), /Phase 1\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|/);
});

test('Scenario B: tasks with N/A in today column return false and do not write', async () => {
    const f = fixture();
    // Exercises: Phase 2 has N/A on Thursday (today)
    const result = await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 2' });
    assert.equal(result, false);
    assert.equal(f.writes(), 0);

    // Direct toggle on an N/A cell also returns false and does not write
    const toggleResult = await f.service.toggleWeeklyHabit(f.app, 'morning', 1, true);
    assert.equal(toggleResult, false);
    assert.equal(f.writes(), 0);

    // Verify markdown text was untouched
    assert.match(f.text(), /Exercises: Phase 2\s*\|\s*\[ \]\s*\|\s*N\/A\s*\|/);
});

test('Scenario C: already-completed [x] cells return true and do not trigger a write', async () => {
    const f = fixture();
    // Meditation is already [x] on Thursday in fixture
    assert.match(f.text(), /Meditation\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);

    const result = await f.service.completeTimerHabit(f.app, { description: 'Meditation' });
    assert.equal(result, true);
    assert.equal(f.writes(), 0);

    // Completing an uncompleted task writes once; subsequent completion is idempotent
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), true);
    assert.equal(f.writes(), 1);

    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), true);
    assert.equal(f.writes(), 1);
});

test('Scenario D: task names with bold and <br> markup are normalized and matched accurately', async () => {
    const f = fixture();
    // Table has: | **Exercises:**<br>Phase 1 | [ ] | [ ] |
    // Plain description without markdown tags matches correctly
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Exercises: Phase 1' }), true);
    assert.equal(f.writes(), 1);

    // Casing and multiple whitespace variations match
    const f2 = fixture();
    assert.equal(await f2.service.completeTimerHabit(f2.app, { description: '  exercises:   phase 1 ' }), true);
    assert.equal(f2.writes(), 1);

    const f3 = fixture();
    assert.equal(await f3.service.completeTimerHabit(f3.app, { description: 'EXERCISES: PHASE 1' }), true);
    assert.equal(f3.writes(), 1);
});

test('Scenario E: multi-section task name disambiguation requires sectionKey', async () => {
    // Both Habits and Work sections have a "Planning" task
    const extra = `\n---\n## Work\n\n| Task | Wednesday | Thursday |\n| --- | --- | --- |\n| Planning | [ ] | [ ] |\n`;
    const f = fixture(`| Planning | [ ] | [ ] |\n${extra}`);

    // Ambiguous call without sectionKey fails and does not write
    const ambiguousResult = await f.service.completeTimerHabit(f.app, { description: 'Planning' });
    assert.equal(ambiguousResult, false);
    assert.equal(f.writes(), 0);

    // Disambiguated with sectionKey: 'work' succeeds and writes only to Work table
    const workResult = await f.service.completeTimerHabit(f.app, { description: 'Planning', sectionKey: 'work' });
    assert.equal(workResult, true);
    assert.equal(f.writes(), 1);

    // Verify Work section was updated to [x]
    assert.match(f.text(), /## Work[\s\S]*?Planning\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);
    // Verify Habits section remained [ ]
    assert.match(f.text(), /## Habits[\s\S]*?Planning\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|/);

    // Disambiguated with sectionKey: 'morning' completes Habits section
    const morningResult = await f.service.completeTimerHabit(f.app, { description: 'Planning', sectionKey: 'morning' });
    assert.equal(morningResult, true);
    assert.equal(f.writes(), 2);
    assert.match(f.text(), /## Habits[\s\S]*?Planning\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);
});

test('Scenario F: em-dash "—" cells are treated as non-completable like N/A', async () => {
    // Deep Breathing has an em-dash on Thursday
    const f = fixture(`| Deep Breathing | [ ] | — |\n`);

    // loadTodayWeeklyHabits excludes tasks with em-dash for today
    const { habitsBySection } = await f.service.loadTodayWeeklyHabits(f.app);
    const morningTasks = habitsBySection.morning.map(h => h.name);
    assert.equal(morningTasks.includes('Deep Breathing'), false);

    // completeTimerHabit on an em-dash cell returns false and does not write
    const result = await f.service.completeTimerHabit(f.app, { description: 'Deep Breathing' });
    assert.equal(result, false);
    assert.equal(f.writes(), 0);

    // Cell content remains untouched
    assert.match(f.text(), /Deep Breathing\s*\|\s*\[ \]\s*\|\s*—\s*\|/);
});

test('Scenario G: house section with emoji heading "## 🏡 House & Chores" is recognized as section key "house"', async () => {
    const extra = `\n---\n## 🏡 House & Chores\n\n| Task | Wednesday | Thursday |\n| --- | --- | --- |\n| Vacuum Living Room | [ ] | [ ] |\n| Clean Dishes | [ ] | [x] |\n`;
    const f = fixture(extra);

    // loadTodayWeeklyHabits populates habitsBySection.house
    const { habitsBySection } = await f.service.loadTodayWeeklyHabits(f.app);
    assert.ok(habitsBySection.house);
    assert.equal(habitsBySection.house.length, 2);
    assert.equal(habitsBySection.house[0].name, 'Vacuum Living Room');
    assert.equal(habitsBySection.house[0].completed, false);
    assert.equal(habitsBySection.house[0].sectionKey, 'house');
    assert.equal(habitsBySection.house[1].name, 'Clean Dishes');
    assert.equal(habitsBySection.house[1].completed, true);

    // completeTimerHabit successfully targets the house section
    const ok = await f.service.completeTimerHabit(f.app, { description: 'Vacuum Living Room', sectionKey: 'house' });
    assert.equal(ok, true);
    assert.equal(f.writes(), 1);
    assert.match(f.text(), /Vacuum Living Room\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|/);

    // getHabitSectionKey helper maps emoji headings and chore keywords to "house"
    assert.equal(f.service.getHabitSectionKey('🏡 House & Chores'), 'house');
    assert.equal(f.service.getHabitSectionKey('housework chore'), 'house');
});

test('Full 7-day weekly matrix table mutates only today column across all days of week', async () => {
    const fullTable = `## Habits\n\n| Task | Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| **Exercises:**<br>Phase 1 | [x] | [x] | [ ] | [ ] | [ ] | [ ] | [ ] |\n| Exercises: Phase 2 | [x] | N/A | [ ] | [ ] | [ ] | [ ] | [ ] |\n| Exercises: Phase 3 | [x] | N/A | N/A | [ ] | [ ] | [ ] | [ ] |\n| Meditation | [x] | [x] | [x] | [ ] | [ ] | [ ] | [ ] |\n| Protein Shake | [x] | [x] | [ ] | [ ] | [ ] | [ ] | [ ] |\n`;
    const f = fixture('', { text: fullTable });

    // Protein Shake on Thursday (today) changes from [ ] to [x]
    const ok = await f.service.completeTimerHabit(f.app, { description: 'Protein Shake' });
    assert.equal(ok, true);
    assert.equal(f.writes(), 1);

    // Monday [x], Tuesday [x], Wednesday [ ], Thursday [x], Friday [ ], Saturday [ ], Sunday [ ]
    assert.match(f.text(), /Protein Shake\s*\|\s*\[x\]\s*\|\s*\[x\]\s*\|\s*\[ \]\s*\|\s*\[x\]\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|/);
});

test('Edge cases: missing note file, non-existent tasks, and blank descriptions fail safely without writes', async () => {
    const f = fixture();

    // Empty or blank description
    assert.equal(await f.service.completeTimerHabit(f.app, { description: '' }), false);
    assert.equal(await f.service.completeTimerHabit(f.app, { description: '   ' }), false);
    assert.equal(await f.service.completeTimerHabit(f.app, {}), false);

    // Non-existent task description
    assert.equal(await f.service.completeTimerHabit(f.app, { description: 'Nonexistent Habit 12345' }), false);
    assert.equal(f.writes(), 0);

    // Missing weekly note file in vault
    const missingApp = {
        vault: {
            getAbstractFileByPath: () => null,
            read: async () => '',
            modify: async () => {}
        }
    };
    const missingFileResult = await f.service.completeTimerHabit(missingApp, { description: 'Exercises: Phase 1' });
    assert.equal(missingFileResult, false);
    const { habitsBySection, tFile } = await f.service.loadTodayWeeklyHabits(missingApp);
    assert.equal(Object.keys(habitsBySection).length, 0);
    assert.equal(tFile, null);
});

test('Helper methods: getWeeklyNoteFile and getHabitSectionKey function accurately', () => {
    const f = fixture();
    let queriedPath = '';
    const customApp = {
        vault: {
            getAbstractFileByPath: (p) => { queriedPath = p; return { path: p }; }
        }
    };
    const tFile = f.service.getWeeklyNoteFile(customApp);
    assert.equal(queriedPath, '02_Journal/02_Weekly/2026-W38.md');
    assert.equal(tFile.path, '02_Journal/02_Weekly/2026-W38.md');

    assert.equal(f.service.getHabitSectionKey('Morning Routine'), 'morning');
    assert.equal(f.service.getHabitSectionKey('Habits: Morning Routine'), 'morning');
    assert.equal(f.service.getHabitSectionKey('Habits: Midday Routine'), 'midday');
    assert.equal(f.service.getHabitSectionKey('Habits: Evening Routine'), 'evening');
    assert.equal(f.service.getHabitSectionKey('Midday Routine'), 'midday');
    assert.equal(f.service.getHabitSectionKey('Evening Routine'), 'evening');
    assert.equal(f.service.getHabitSectionKey('Habits Matrix'), 'morning');
    assert.equal(f.service.getHabitSectionKey('Work Focus Sprint'), 'work');
    assert.equal(f.service.getHabitSectionKey('Housework chore'), 'house');
    assert.equal(f.service.getHabitSectionKey('Unrelated Task'), null);
});

test('Routine slot partitioning: Morning, Midday, and Evening dividers partition habits cleanly', async () => {
    const partitionedTable = `## Habits

| Task | Wednesday | Thursday |
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
    let text = partitionedTable;
    let writes = 0;
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        require: () => ({}),
        window: {
            moment: () => ({ format: f => f === 'dddd' ? 'Thursday' : '2026-W38' }),
            dispatchEvent: () => {}
        }
    });
    const app = {
        vault: {
            getAbstractFileByPath: () => ({ path: '02_Journal/02_Weekly/2026-W38.md' }),
            read: async () => text,
            modify: async (_, value) => { text = value; writes++; }
        }
    };

    const { habitsBySection } = await exports.WeeklyHabitService.loadTodayWeeklyHabits(app);

    // Verify morning contains only morning habits
    assert.equal(habitsBySection.morning.length, 2);
    assert.equal(habitsBySection.morning[0].name, 'Wake up');
    assert.equal(habitsBySection.morning[1].name, 'Waffles');

    // Verify midday contains only midday habits
    assert.equal(habitsBySection.midday.length, 2);
    assert.equal(habitsBySection.midday[0].name, 'Exercises: Phase 2');
    assert.equal(habitsBySection.midday[1].name, 'Lumosity');

    // Verify evening contains only evening habits
    assert.equal(habitsBySection.evening.length, 2);
    assert.equal(habitsBySection.evening[0].name, 'Tidy up');
    assert.equal(habitsBySection.evening[1].name, 'Run dishes');

    // Verify rowIdx reflects original table row index
    // row 0: Morning div, 1: Wake up, 2: Waffles, 3: Midday div, 4: Exercises: Phase 2, 5: Lumosity
    const lumosity = habitsBySection.midday.find(h => h.name === 'Lumosity');
    assert.ok(lumosity);
    assert.equal(lumosity.rowIdx, 5);

    // Toggle Lumosity in midday
    const toggleResult = await exports.WeeklyHabitService.toggleWeeklyHabit(app, 'midday', lumosity.rowIdx, true);
    assert.equal(toggleResult, true);
    assert.equal(writes, 1);
    assert.match(text, /Lumosity\s*\|\s*\[ \]\s*\|\s*\[x\]/);
});
