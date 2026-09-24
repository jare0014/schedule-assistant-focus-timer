const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/services/ReferenceNoteParser.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function getParser() {
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: () => ({}) });
    return exports.ReferenceNoteParser;
}

// Helper: JSON round-trip to normalize cross-realm arrays for deepStrictEqual
const j = (v) => JSON.parse(JSON.stringify(v));

// --- extractWikilinks ---

test('extractWikilinks finds single wikilink', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.extractWikilinks('**Auths** [[Auth Processing Protocol]]')), ['Auth Processing Protocol']);
});

test('extractWikilinks finds multiple wikilinks', () => {
    const parser = getParser();
    assert.deepStrictEqual(
        j(parser.extractWikilinks('**Sprint** [[Sprint Planning]] [[Standup Protocol]]')),
        ['Sprint Planning', 'Standup Protocol']
    );
});

test('extractWikilinks handles aliased wikilinks', () => {
    const parser = getParser();
    assert.deepStrictEqual(
        j(parser.extractWikilinks('Task [[Long Note Name|short]]')),
        ['Long Note Name']
    );
});

test('extractWikilinks returns empty for no wikilinks', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.extractWikilinks('Exercises: Phase 1')), []);
    assert.deepStrictEqual(j(parser.extractWikilinks('')), []);
});

// --- findReferenceForTask ---

const WEEKLY_NOTE = `## Habits

| Task | Monday | Tuesday | Wednesday |
| :--- | :---: | :---: | :---: |
| Wake up | [x] | [x] | [ ] |
| Meditation [[Meditation Protocol]] | [x] | [ ] | [ ] |
| Exercises: Phase 1 | [x] | [x] | [ ] |

---
## Work

| Work Task | Monday | Tuesday | Wednesday |
| :--- | :---: | :---: | :---: |
| **Auths** (prev day) [[Auth Processing Protocol]] | [x] | [x] | [ ] |
| **Intake** (2 days out) | [x] | [x] | [ ] |
| **Code Review** [[PR Review Checklist|Review]] | [ ] | [x] | [ ] |

---
## 🏡 House & Chores

| House Chore | Monday | Tuesday |
| :--- | :---: | :---: |
| **Cats** (Water & litter) [[Cat Care Protocol]] | [ ] | [ ] |
| **Dishes** | [ ] | [ ] |
`;

test('findReferenceForTask matches task name and returns wikilink', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Auths')), ['Auth Processing Protocol']);
});

test('findReferenceForTask matches with bold/parens in task name', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Auths (prev day)')), ['Auth Processing Protocol']);
});

test('findReferenceForTask returns empty when task has no wikilink', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Intake')), []);
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Wake up')), []);
});

test('findReferenceForTask respects section filter', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Meditation', 'habits')), ['Meditation Protocol']);
    // Work section doesn't have Meditation
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Meditation', 'work')), []);
});

test('findReferenceForTask handles aliased wikilinks in table cells', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Code Review')), ['PR Review Checklist']);
});

test('findReferenceForTask detects house section with emoji heading', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Cats', 'house')), ['Cat Care Protocol']);
});

test('findReferenceForTask returns empty for nonexistent task', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, 'Nonexistent Task')), []);
});

test('findReferenceForTask returns empty for empty inputs', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.findReferenceForTask('', 'Auths')), []);
    assert.deepStrictEqual(j(parser.findReferenceForTask(WEEKLY_NOTE, '')), []);
});

// --- parseChecklistFromNote ---

const REFERENCE_NOTE = `# Auth Processing Protocol

## Overview
This protocol covers the daily authorization processing workflow.

## Checklist
- [ ] Pull new auth requests from queue
- [ ] Verify insurance eligibility
  - [ ] Check primary coverage
  - [ ] Check secondary coverage
- [ ] Submit to payer portal
- [x] Document any denials
- [ ] Follow up on pending items

## Notes
Some additional notes here.
`;

test('parseChecklistFromNote extracts all checklist items', () => {
    const parser = getParser();
    const items = j(parser.parseChecklistFromNote(REFERENCE_NOTE));
    assert.equal(items.length, 7);
});

test('parseChecklistFromNote captures completion state', () => {
    const parser = getParser();
    const items = j(parser.parseChecklistFromNote(REFERENCE_NOTE));
    assert.equal(items[0].completed, false);
    assert.equal(items[0].text, 'Pull new auth requests from queue');
    assert.equal(items[5].completed, true);
    assert.equal(items[5].text, 'Document any denials');
});

test('parseChecklistFromNote captures indentation levels', () => {
    const parser = getParser();
    const items = j(parser.parseChecklistFromNote(REFERENCE_NOTE));
    assert.equal(items[0].indent, 0); // Pull new auth requests
    assert.equal(items[1].indent, 0); // Verify insurance
    assert.equal(items[2].indent, 1); // Check primary (indented)
    assert.equal(items[3].indent, 1); // Check secondary (indented)
    assert.equal(items[4].indent, 0); // Submit to payer
});

test('parseChecklistFromNote preserves line indices for write-back', () => {
    const parser = getParser();
    const items = j(parser.parseChecklistFromNote(REFERENCE_NOTE));
    const lines = REFERENCE_NOTE.split(/\r?\n/);
    for (const item of items) {
        assert.ok(lines[item.lineIndex].includes(item.text),
            `Line ${item.lineIndex} should contain "${item.text}"`);
    }
});

test('parseChecklistFromNote returns empty for note without checklists', () => {
    const parser = getParser();
    assert.deepStrictEqual(j(parser.parseChecklistFromNote('# Just a heading\n\nSome text.')), []);
    assert.deepStrictEqual(j(parser.parseChecklistFromNote('')), []);
});
