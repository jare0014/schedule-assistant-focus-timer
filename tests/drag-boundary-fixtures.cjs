const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Boundary extractor matching rescheduleTaskOnGrid logic in TaskTimerView.ts
 */
function extractTaskBlock(lines, lineIndex) {
    const parentLine = lines[lineIndex];
    const rawIndentMatch = parentLine.match(/^(\s*(?:>\s*)?)/);
    const parentIndent = rawIndentMatch ? rawIndentMatch[1].length : 0;

    let endIndex = lineIndex + 1;
    let inCodeFence = false;

    while (endIndex < lines.length) {
        const childLine = lines[endIndex];
        const trimmed = childLine.trim();

        // 1. Boundary stop: Heading or Horizontal Rule
        if (!inCodeFence && (trimmed.startsWith('#') || trimmed === '---' || trimmed === '***')) {
            break;
        }

        // 2. Code fence boundary tracking (dataviewjs, focus-matrix, etc.)
        if (trimmed.startsWith('```')) {
            inCodeFence = !inCodeFence;
            endIndex++;
            continue;
        }
        if (inCodeFence) {
            endIndex++;
            continue;
        }

        // 3. Blank lines
        if (!trimmed) {
            let nextNonBlank = endIndex + 1;
            while (nextNonBlank < lines.length && !lines[nextNonBlank].trim()) nextNonBlank++;
            if (nextNonBlank < lines.length) {
                const nextTrimmed = lines[nextNonBlank].trim();
                const nextRaw = lines[nextNonBlank].match(/^(\s*(?:>\s*)?)/);
                const nextIndent = nextRaw ? nextRaw[1].length : 0;
                // If next non-blank is indented child OR unindented code fence, preserve across blank line
                if (nextIndent > parentIndent || nextTrimmed.startsWith('```') || nextTrimmed.startsWith('![[')) {
                    endIndex = nextNonBlank;
                    continue;
                }
            }
            break;
        }

        // 4. Adjacent sibling tasks at equal or shallower indentation stop block
        const childRaw = childLine.match(/^(\s*(?:>\s*)?)/);
        const childIndent = childRaw ? childRaw[1].length : 0;
        if (childIndent <= parentIndent && (childLine.includes('- [ ]') || childLine.includes('- [x]') || childLine.includes('- [-]'))) {
            break;
        }

        endIndex++;
    }

    return {
        blockLines: lines.slice(lineIndex, endIndex),
        endIndex: endIndex
    };
}

test('Fixture 1: Scheduled task with unindented dataviewjs codeblock is captured atomically', () => {
    const markdown = [
        "- [ ] 06:00 - 07:15 Habits: Morning Routine",
        "",
        "```dataviewjs",
        "await dv.view('99_System/Scripts/habitTracker');",
        "```",
        "",
        "- [ ] 09:00 - 12:00 Work"
    ];
    const res = extractTaskBlock(markdown, 0);
    assert.equal(res.blockLines.length, 5);
    assert.equal(res.blockLines[0], "- [ ] 06:00 - 07:15 Habits: Morning Routine");
    assert.equal(res.blockLines[2], "```dataviewjs");
    assert.equal(res.blockLines[4], "```");
    assert.equal(res.endIndex, 5);
    // Next task must not be swallowed
    assert.equal(markdown[res.endIndex + 1], "- [ ] 09:00 - 12:00 Work");
});

test('Fixture 2: Task with nested subtasks and sub-notes captured without swallowing adjacent sibling', () => {
    const markdown = [
        "- [ ] 16:00 - 17:00 House: Chores & Maintenance",
        "  - [ ] Mow the lawn",
        "  - [ ] Fix the cat fountain",
        "  Note: use 1/4 inch tubing",
        "",
        "```dataviewjs",
        "await dv.view('99_System/Scripts/houseTracker');",
        "```",
        "- [ ] 18:00 - 18:45 Habits: Evening Routine"
    ];
    const res = extractTaskBlock(markdown, 0);
    assert.equal(res.blockLines[1], "  - [ ] Mow the lawn");
    assert.equal(res.blockLines[2], "  - [ ] Fix the cat fountain");
    assert.equal(res.blockLines[3], "  Note: use 1/4 inch tubing");
    assert.equal(res.blockLines[5], "```dataviewjs");
    assert.equal(res.blockLines[7], "```");
    assert.equal(markdown[res.endIndex], "- [ ] 18:00 - 18:45 Habits: Evening Routine");
});

test('Fixture 3: Adjacent sibling task at same indentation stops block immediately', () => {
    const markdown = [
        "- [ ] Task A",
        "- [ ] Task B",
        "- [ ] Task C"
    ];
    const res = extractTaskBlock(markdown, 0);
    assert.equal(res.blockLines.length, 1);
    assert.equal(res.blockLines[0], "- [ ] Task A");
    assert.equal(res.endIndex, 1);
});

test('Fixture 4: Markdown section heading stops task block', () => {
    const markdown = [
        "- [ ] 18:00 - 18:45 Habits: Evening Routine",
        "```dataviewjs",
        "await dv.view('habitTracker');",
        "```",
        "### ☁️ Floating Micro-Tasks (Untimed)",
        "- [ ] Micro task 1"
    ];
    const res = extractTaskBlock(markdown, 0);
    assert.equal(res.blockLines.length, 4);
    assert.equal(markdown[res.endIndex], "### ☁️ Floating Micro-Tasks (Untimed)");
});

test('Fixture 5: Embedded wikilink transclusion under task captured before next task', () => {
    const markdown = [
        "- [ ] Work block",
        "![[2026-W39#Work]]",
        "- [ ] Next work block"
    ];
    const res = extractTaskBlock(markdown, 0);
    assert.equal(res.blockLines.length, 2);
    assert.equal(res.blockLines[1], "![[2026-W39#Work]]");
    assert.equal(markdown[res.endIndex], "- [ ] Next work block");
});
