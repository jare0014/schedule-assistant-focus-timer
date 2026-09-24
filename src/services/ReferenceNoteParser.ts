/**
 * ReferenceNoteParser.ts - Extracts vault wikilinks from weekly matrix table cells
 * and parses checklists from referenced notes for embedding in timer cards.
 *
 * Design: Users add [[Note Name]] wikilinks in the weekly matrix task-name column.
 * When a focus timer starts, the plugin reads the matching row, extracts the
 * wikilink, resolves it to a vault note, and renders its checklists in the
 * timer card sidebar.
 */

import { App, TFile } from 'obsidian';

export interface ReferenceChecklist {
    /** The resolved note title */
    noteTitle: string;
    /** The resolved TFile path */
    filePath: string;
    /** Extracted checklist items from the referenced note */
    items: ReferenceChecklistItem[];
}

export interface ReferenceChecklistItem {
    /** Line index in the source note (for write-back) */
    lineIndex: number;
    /** The raw markdown line */
    rawLine: string;
    /** Display text (cleaned of markdown checkbox prefix) */
    text: string;
    /** Current completion state */
    completed: boolean;
    /** Indentation level (0 = top-level, 1 = nested, etc.) */
    indent: number;
}

export class ReferenceNoteParser {

    /**
     * Parse a markdown table row into cells, ignoring `|` inside `[[wikilink|alias]]`.
     */
    public static parseTableCells(row: string): string[] {
        const cells: string[] = [];
        let current = '';
        let inWikilink = false;
        let i = 0;
        // Skip leading |
        if (row.startsWith('|')) i = 1;

        while (i < row.length) {
            if (row[i] === '[' && i + 1 < row.length && row[i + 1] === '[') {
                inWikilink = true;
                current += '[[';
                i += 2;
                continue;
            }
            if (inWikilink && row[i] === ']' && i + 1 < row.length && row[i + 1] === ']') {
                inWikilink = false;
                current += ']]';
                i += 2;
                continue;
            }
            if (row[i] === '|' && !inWikilink) {
                const trimmed = current.trim();
                if (trimmed) cells.push(current);
                current = '';
                i++;
                continue;
            }
            current += row[i];
            i++;
        }
        const trimmed = current.trim();
        if (trimmed) cells.push(current);
        return cells;
    }

    /**
     * Extract [[wikilinks]] from a markdown table cell string.
     * Handles both `[[Note Name]]` and `[[Note Name|Display Text]]` syntax.
     * Returns an array of note names (without display aliases).
     */
    public static extractWikilinks(cellText: string): string[] {
        if (!cellText) return [];
        const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        const results: string[] = [];
        let match;
        while ((match = wikiRe.exec(cellText)) !== null) {
            const noteName = match[1].trim();
            if (noteName) results.push(noteName);
        }
        return results;
    }

    /**
     * Find the reference note link for a given task description by searching
     * the weekly note's matrix table rows.
     *
     * @param weeklyContent - Full markdown content of the weekly note
     * @param taskDescription - The task/habit name to match (e.g., "Auths")
     * @param sectionKey - Optional section filter ("habits", "work", "house")
     * @returns Array of note names found in the matching row's task-name cell
     */
    public static findReferenceForTask(
        weeklyContent: string,
        taskDescription: string,
        sectionKey?: string
    ): string[] {
        if (!weeklyContent || !taskDescription) return [];

        const lines = weeklyContent.split(/\r?\n/);
        const normalizeForMatch = (s: string) =>
            s.replace(/<br\s*\/?>/gi, ' ')
             .replace(/\*\*/g, '')
             .replace(/\*/g, '')
             .replace(/\s+/g, ' ')
             .trim()
             .toLowerCase();

        const targetNorm = normalizeForMatch(taskDescription);
        let currentSection = '';

        for (const line of lines) {
            // Track section headings
            const headingMatch = line.match(/^##\s+(.+)/);
            if (headingMatch) {
                const heading = headingMatch[1].toLowerCase();
                if (heading.includes('habit')) currentSection = 'habits';
                else if (heading.includes('work')) currentSection = 'work';
                else if (heading.includes('house') || heading.includes('chore')) currentSection = 'house';
                else currentSection = heading;
                continue;
            }

            // Skip non-table rows
            if (!line.trim().startsWith('|')) continue;
            // Skip separator rows
            if (/^\|[\s\-:]+\|/.test(line) && !line.includes('[')) continue;
            // Skip header rows (first data row after heading)
            if (line.includes('| Task') || line.includes('| Work Task') || line.includes('| House Chore')) continue;

            // Apply section filter if specified
            if (sectionKey && currentSection !== sectionKey.toLowerCase()) continue;

            // Parse table cells, respecting [[wikilink|alias]] pipes
            const cells = this.parseTableCells(line);
            if (cells.length === 0) continue;

            const taskCell = cells[0];
            const taskCellNorm = normalizeForMatch(taskCell.replace(/\[\[[^\]]*(?:\|[^\]]*)\]\]/g, '').replace(/\[\[[^\]]+\]\]/g, ''));

            // Check if this row matches the target task
            if (taskCellNorm.includes(targetNorm) || targetNorm.includes(taskCellNorm)) {
                const wikilinks = this.extractWikilinks(taskCell);
                if (wikilinks.length > 0) return wikilinks;
            }
        }

        return [];
    }

    /**
     * Parse checklist items from a vault note's content.
     * Extracts all `- [ ]` and `- [x]` lines with their indentation.
     */
    public static parseChecklistFromNote(noteContent: string): ReferenceChecklistItem[] {
        if (!noteContent) return [];

        const lines = noteContent.split(/\r?\n/);
        const items: ReferenceChecklistItem[] = [];
        const checklistRe = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(checklistRe);
            if (match) {
                const rawIndent = match[1].length;
                const indent = Math.floor(rawIndent / 2);
                const completed = match[2].toLowerCase() === 'x';
                const text = match[3].trim();
                items.push({
                    lineIndex: i,
                    rawLine: lines[i],
                    text,
                    completed,
                    indent
                });
            }
        }

        return items;
    }

    /**
     * Full pipeline: Given a task description and app context, find the reference
     * note from the weekly matrix and parse its checklists.
     */
    public static async resolveReferenceChecklists(
        app: App,
        weeklyContent: string,
        taskDescription: string,
        sectionKey?: string
    ): Promise<ReferenceChecklist[]> {
        const noteNames = this.findReferenceForTask(weeklyContent, taskDescription, sectionKey);
        const results: ReferenceChecklist[] = [];

        for (const noteName of noteNames) {
            // Try to resolve the note in the vault
            const file = app.metadataCache?.getFirstLinkpathDest(noteName, '') as TFile | null;
            if (!file) continue;

            try {
                const content = await app.vault.read(file);
                const items = this.parseChecklistFromNote(content);
                results.push({
                    noteTitle: noteName,
                    filePath: file.path,
                    items
                });
            } catch {
                // Note exists but can't be read — skip
            }
        }

        return results;
    }

    /**
     * Toggle a checklist item in the referenced note (write-back).
     */
    public static async toggleChecklistItem(
        app: App,
        filePath: string,
        lineIndex: number,
        completed: boolean
    ): Promise<boolean> {
        const file = app.vault.getAbstractFileByPath(filePath) as TFile | null;
        if (!file) return false;

        try {
            const content = await app.vault.read(file);
            const lines = content.split(/\r?\n/);
            if (lineIndex < 0 || lineIndex >= lines.length) return false;

            const line = lines[lineIndex];
            const checkboxRe = /^(\s*-\s+\[)([ xX])(\]\s+.*)$/;
            const match = line.match(checkboxRe);
            if (!match) return false;

            const newMark = completed ? 'x' : ' ';
            if (match[2].toLowerCase() === newMark) return true; // Already in desired state
            lines[lineIndex] = `${match[1]}${newMark}${match[3]}`;
            await app.vault.modify(file, lines.join('\n'));
            return true;
        } catch {
            return false;
        }
    }
}
