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
                    App: function() {},
                    Notice: function() {},
                    TFile: function() {}
                };
            }
            if (mod === './DailyNoteManager') {
                return {
                    DailyNoteManager: {
                        getDailyNoteFile: () => ({ basename: '2026-10-08' })
                    }
                };
            }
            return {};
        },
        console
    };
    vm.runInNewContext(compiled, context);
    return exports;
}

const { FocusLogService } = loadModule('../src/services/FocusLogService.ts');

test('FocusLogService: writes exercise session to workout and active_minutes frontmatter', async () => {
    let capturedFm = { workout: '', active_minutes: '10' };
    const mockApp = {
        vault: {
            read: async () => '',
            modify: async () => {}
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(capturedFm);
            }
        }
    };

    const service = new FocusLogService(mockApp);
    const mockLog = {
        startTimeStr: '10:00:00',
        taskName: 'Exercises: Phase 1',
        logLine: '',
        pauses: ['10:05:00'],
        resumes: ['10:07:00']
    };

    // End time is 10:17:00 -> 17 gross mins - 2 pause mins = 15 elapsed mins
    await service.updateFrontmatterForCompletedSession({ basename: '2026-10-08' }, mockLog, '10:17:00');

    assert.equal(capturedFm.workout, 'Exercises: Phase 1 (15m)');
    assert.equal(capturedFm.active_minutes, '10'); // Untouched; biometric active_minutes reserved for Health API
});

test('FocusLogService: appends subsequent exercise sessions without duplicate overwrite', async () => {
    let capturedFm = { workout: 'Exercises: Phase 1 (15m)', active_minutes: '25' };
    const mockApp = {
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(capturedFm);
            }
        }
    };

    const service = new FocusLogService(mockApp);
    const mockLog = {
        startTimeStr: '11:00:00',
        taskName: 'Walking',
        logLine: '',
        pauses: [],
        resumes: []
    };

    // End time 11:20:00 -> 20 mins
    await service.updateFrontmatterForCompletedSession({ basename: '2026-10-08' }, mockLog, '11:20:00');

    assert.equal(capturedFm.workout, 'Exercises: Phase 1 (15m), Walking (20m)');
    assert.equal(capturedFm.active_minutes, '25'); // Preserved
});

test('FocusLogService: writes meditation session to mindfulness_minutes frontmatter', async () => {
    let capturedFm = { mindfulness_minutes: '5' };
    const mockApp = {
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(capturedFm);
            }
        }
    };

    const service = new FocusLogService(mockApp);
    const mockLog = {
        startTimeStr: '06:00:00',
        taskName: 'Meditation',
        logLine: '',
        pauses: [],
        resumes: []
    };

    // End time 06:15:00 -> 15 mins
    await service.updateFrontmatterForCompletedSession({ basename: '2026-10-08' }, mockLog, '06:15:00');

    assert.equal(capturedFm.mindfulness_minutes, '20'); // 5 existing + 15
});

test('FocusLogService: ignores non-exercise/non-meditation tasks', async () => {
    let capturedFm = { workout: '', mindfulness_minutes: '0' };
    let called = false;
    const mockApp = {
        fileManager: {
            processFrontMatter: async (file, fn) => {
                called = true;
                fn(capturedFm);
            }
        }
    };

    const service = new FocusLogService(mockApp);
    const mockLog = {
        startTimeStr: '09:00:00',
        taskName: 'Intake (2 days out)',
        logLine: '',
        pauses: [],
        resumes: []
    };

    await service.updateFrontmatterForCompletedSession({ basename: '2026-10-08' }, mockLog, '09:45:00');

    assert.equal(called, false);
    assert.equal(capturedFm.workout, '');
    assert.equal(capturedFm.mindfulness_minutes, '0');
});
