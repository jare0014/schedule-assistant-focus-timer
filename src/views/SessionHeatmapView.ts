/**
 * SessionHeatmapView.ts - Focus session statistics heatmap component.
 * Renders an SVG/HTML activity heatmap displaying completed focus blocks and minutes
 * across the past 30 days / current month.
 */

import { App, TFile } from 'obsidian';

export interface DayFocusStat {
    date: string;
    focusMinutes: number;
    sessionCount: number;
}

export class SessionHeatmapView {
    private app: App;
    private containerEl: HTMLElement;

    constructor(app: App, containerEl: HTMLElement) {
        this.app = app;
        this.containerEl = containerEl;
    }

    /**
     * Parses daily note or focus logs for completed session history over the past N days.
     */
    public async gatherFocusStats(days: number = 30): Promise<DayFocusStat[]> {
        const stats: DayFocusStat[] = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];

            let minutes = 0;
            let count = 0;

            const notePath = `02_Journal/01_Daily/${dateStr}.md`;
            const file = this.app.vault.getAbstractFileByPath(notePath);
            if (file instanceof TFile) {
                try {
                    const content = await this.app.vault.read(file);
                    // Match focus log entries like "- 25m Focus: ..." or "[x] ... (25 min)"
                    const timerMatches = content.match(/⏱️.*?(\d+)\s*(?:m|min)/gi) || [];
                    for (const m of timerMatches) {
                        const num = parseInt(m.replace(/\D/g, ''), 10);
                        if (!isNaN(num)) {
                            minutes += num;
                            count++;
                        }
                    }

                    // Also check completed schedule checkboxes in Day Planner block
                    const completedTasks = content.match(/^[ \t]*- \[x\] \d{2}:\d{2}\s*-\s*\d{2}:\d{2}/gm) || [];
                    if (completedTasks.length > 0 && minutes === 0) {
                        minutes = completedTasks.length * 30; // estimate 30 min per block
                        count = completedTasks.length;
                    }
                } catch (e) {
                    // Ignore unreadable notes
                }
            }

            stats.push({
                date: dateStr,
                focusMinutes: minutes,
                sessionCount: count
            });
        }

        return stats;
    }

    /**
     * Renders the SVG activity heatmap into the container.
     */
    public async render(stats?: DayFocusStat[]): Promise<HTMLElement> {
        this.containerEl.empty();
        const wrapper = this.containerEl.createDiv({ cls: 'focus-session-heatmap-wrapper' });
        wrapper.style.padding = '12px';
        wrapper.style.backgroundColor = 'var(--background-secondary)';
        wrapper.style.borderRadius = '8px';
        wrapper.style.margin = '10px 0';

        const header = wrapper.createDiv({ cls: 'heatmap-header' });
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';

        const title = header.createEl('span', { text: '📊 Focus Session Heatmap (Last 30 Days)' });
        title.style.fontWeight = '600';
        title.style.fontSize = '0.9em';
        title.style.color = 'var(--text-normal)';

        const data = stats || await this.gatherFocusStats(30);
        const totalMinutes = data.reduce((sum, d) => sum + d.focusMinutes, 0);
        const totalHours = (totalMinutes / 60).toFixed(1);

        const totalBadge = header.createEl('span', { text: `${totalHours} hrs logged` });
        totalBadge.style.fontSize = '0.8em';
        totalBadge.style.color = 'var(--text-muted)';

        // SVG Heatmap Grid (7 rows for days of week, 5 columns for weeks)
        const cellSize = 14;
        const cellGap = 4;
        const cols = Math.ceil(data.length / 7);
        const svgWidth = cols * (cellSize + cellGap) + 10;
        const svgHeight = 7 * (cellSize + cellGap) + 10;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', `${svgWidth}`);
        svg.setAttribute('height', `${svgHeight}`);
        svg.style.display = 'block';

        data.forEach((day, idx) => {
            const col = Math.floor(idx / 7);
            const row = idx % 7;
            const x = col * (cellSize + cellGap) + 5;
            const y = row * (cellSize + cellGap) + 5;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', `${x}`);
            rect.setAttribute('y', `${y}`);
            rect.setAttribute('width', `${cellSize}`);
            rect.setAttribute('height', `${cellSize}`);
            rect.setAttribute('rx', '3');
            rect.setAttribute('ry', '3');

            // Color shading based on focus minutes
            let color = 'var(--background-modifier-border)';
            if (day.focusMinutes >= 90) {
                color = 'var(--interactive-accent)';
            } else if (day.focusMinutes >= 50) {
                color = 'rgba(112, 87, 255, 0.75)';
            } else if (day.focusMinutes >= 25) {
                color = 'rgba(112, 87, 255, 0.45)';
            } else if (day.focusMinutes > 0) {
                color = 'rgba(112, 87, 255, 0.25)';
            }

            rect.setAttribute('fill', color);
            rect.style.cursor = 'pointer';

            const titleElem = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleElem.textContent = `${day.date}: ${day.focusMinutes}m focus (${day.sessionCount} sessions)`;
            rect.appendChild(titleElem);

            svg.appendChild(rect);
        });

        wrapper.appendChild(svg);
        return wrapper;
    }
}
