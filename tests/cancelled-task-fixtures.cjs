const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task parsing and card rendering helper matching Focus Matrix & Schedule Assistant logic
 */
function parseTaskStatus(line) {
    if (line.includes('- [x]') || line.includes('- [X]')) return 'completed';
    if (line.includes('- [-]')) return 'cancelled';
    if (line.includes('- [/]')) return 'in_progress';
    if (line.includes('- [ ]')) return 'pending';
    return 'other';
}

function parseMatrixCell(val) {
    const v = (val || '').trim();
    if (v.includes('[x]') || v.includes('[X]')) return 'completed';
    if (v.includes('[-]') || v.toLowerCase().includes('cancel')) return 'cancelled';
    if (v.toLowerCase() === 'n/a' || v === '—') return 'na';
    if (v.includes('[ ]')) return 'pending';
    return 'empty';
}

function renderMatrixCellHtml(cellStatus) {
    if (cellStatus === 'completed') {
        return '<span class="matrix-cell check-completed" style="color: var(--text-success);">✔</span>';
    }
    if (cellStatus === 'cancelled') {
        return '<span class="matrix-cell check-cancelled" style="color: var(--text-error); font-weight: bold;">✕</span>';
    }
    if (cellStatus === 'na') {
        return '<span class="matrix-cell text-muted">N/A</span>';
    }
    return '<span class="matrix-cell check-pending">▢</span>';
}

function canLaunchTimer(taskStatus) {
    return taskStatus !== 'completed' && taskStatus !== 'cancelled' && taskStatus !== 'na';
}

function calculateCompletionStats(cells) {
    let completed = 0;
    let pending = 0;
    let cancelled = 0;
    let na = 0;

    for (const c of cells) {
        const s = parseMatrixCell(c);
        if (s === 'completed') completed++;
        else if (s === 'pending') pending++;
        else if (s === 'cancelled') cancelled++;
        else if (s === 'na') na++;
    }

    const totalActionable = completed + pending;
    const rate = totalActionable > 0 ? (completed / totalActionable) * 100 : 100;
    return { completed, pending, cancelled, na, rate };
}

test('Fixture A: Cancelled markdown task "- [-]" parsed with status cancelled', () => {
    const line = "- [-] Meeting cancelled with external vendor";
    assert.equal(parseTaskStatus(line), 'cancelled');
    assert.equal(canLaunchTimer(parseTaskStatus(line)), false);
});

test('Fixture B: Matrix cell "[-]" parses as cancelled and renders red X indicator', () => {
    const html = renderMatrixCellHtml(parseMatrixCell('[-]'));
    assert.match(html, /check-cancelled/);
    assert.match(html, /var\(--text-error\)/);
    assert.match(html, /✕/);
});

test('Fixture C: Cancelled cells do not drag down completion rate or count as pending', () => {
    // 3 completed, 1 pending, 1 cancelled, 2 N/A
    const cells = ['[x]', '[x]', '[x]', '[ ]', '[-]', 'N/A', 'N/A'];
    const stats = calculateCompletionStats(cells);
    assert.equal(stats.completed, 3);
    assert.equal(stats.pending, 1);
    assert.equal(stats.cancelled, 1);
    assert.equal(stats.na, 2);
    // Rate is 3 / (3 + 1) = 75%, cancelled is not counted as failing/pending
    assert.equal(stats.rate, 75);
});

test('Fixture D: Pending and in_progress tasks allow timer launch, cancelled and completed do not', () => {
    assert.equal(canLaunchTimer('pending'), true);
    assert.equal(canLaunchTimer('in_progress'), true);
    assert.equal(canLaunchTimer('cancelled'), false);
    assert.equal(canLaunchTimer('completed'), false);
});
