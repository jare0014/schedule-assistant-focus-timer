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
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            let minutes = 0;
            let count = 0;

            const notePath = `02_Journal/01_Daily/${dateStr}.md`;
            const file = this.app.vault.getAbstractFileByPath(notePath);
            if (file instanceof TFile) {
                try {
                    const content = await this.app.vault.read(file);
                    
                    // 1. Primary: Match Dataview inline focus log entries
                    // e.g. - [focus:: Intake (2 days out)] [start-time:: 05:53:07] ... [completed-time:: 06:08:08]
                    const focusLines = content.match(/^[ \t]*- \[focus::\s*[^\]]+\]\s*\[start-time::\s*\d{2}:\d{2}:\d{2}\].*?\[completed-time::\s*\d{2}:\d{2}:\d{2}\]/gm) || [];
                    for (const line of focusLines) {
                        const startM = line.match(/\[start-time::\s*(\d{2}):(\d{2}):(\d{2})\]/);
                        const endM = line.match(/\[completed-time::\s*(\d{2}):(\d{2}):(\d{2})\]/);
                        if (startM && endM) {
                            const startSec = parseInt(startM[1], 10) * 3600 + parseInt(startM[2], 10) * 60 + parseInt(startM[3], 10);
                            let endSec = parseInt(endM[1], 10) * 3600 + parseInt(endM[2], 10) * 60 + parseInt(endM[3], 10);
                            if (endSec < startSec) endSec += 24 * 3600; // handle midnight rollover
                            let diffSec = endSec - startSec;

                            // Subtract pause intervals if any
                            const pStartM = line.match(/\[pause-start::\s*([^\]]*)\]/);
                            const pEndM = line.match(/\[pause-end::\s*([^\]]*)\]/);
                            if (pStartM && pEndM && pStartM[1].trim() && pEndM[1].trim()) {
                                const pStarts = pStartM[1].split(',').map(s => s.trim()).filter(Boolean);
                                const pEnds = pEndM[1].split(',').map(s => s.trim()).filter(Boolean);
                                for (let p = 0; p < Math.min(pStarts.length, pEnds.length); p++) {
                                    const ps = pStarts[p].split(':').map(n => parseInt(n, 10));
                                    const pe = pEnds[p].split(':').map(n => parseInt(n, 10));
                                    if (ps.length === 3 && pe.length === 3) {
                                        const psSec = ps[0] * 3600 + ps[1] * 60 + ps[2];
                                        let peSec = pe[0] * 3600 + pe[1] * 60 + pe[2];
                                        if (peSec < psSec) peSec += 24 * 3600;
                                        diffSec -= (peSec - psSec);
                                    }
                                }
                            }

                            const diffMin = Math.round(diffSec / 60);
                            if (diffMin > 0 && diffMin <= 360) {
                                minutes += diffMin;
                                count++;
                            }
                        }
                    }

                    // 2. Secondary fallback: Match explicit timer markers like "⏱️ 25m"
                    if (count === 0) {
                        const timerMatches = content.match(/⏱️.*?(\d+)\s*(?:m|min)/gi) || [];
                        for (const m of timerMatches) {
                            const num = parseInt(m.replace(/\D/g, ''), 10);
                            if (!isNaN(num)) {
                                minutes += num;
                                count++;
                            }
                        }
                    }

                    // 3. Tertiary fallback: completed schedule checkboxes in Day Planner block
                    if (count === 0) {
                        const completedTasks = content.match(/^[ \t]*- \[x\] \d{2}:\d{2}\s*-\s*\d{2}:\d{2}/gm) || [];
                        if (completedTasks.length > 0) {
                            minutes = completedTasks.length * 30; // estimate 30 min per block
                            count = completedTasks.length;
                        }
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
        if (typeof (this.containerEl as any).empty === 'function') {
            (this.containerEl as any).empty();
        } else {
            this.containerEl.innerHTML = '';
        }

        const wrapper = (typeof (this.containerEl as any).createDiv === 'function')
            ? (this.containerEl as any).createDiv({ cls: 'focus-session-heatmap-wrapper' })
            : document.createElement('div');
        if (typeof (this.containerEl as any).createDiv !== 'function') {
            wrapper.className = 'focus-session-heatmap-wrapper';
            this.containerEl.appendChild(wrapper);
        }

        wrapper.style.padding = '12px';
        wrapper.style.backgroundColor = 'var(--background-secondary)';
        wrapper.style.borderRadius = '8px';
        wrapper.style.margin = '10px 0';

        const header = (typeof (wrapper as any).createDiv === 'function')
            ? (wrapper as any).createDiv({ cls: 'heatmap-header' })
            : document.createElement('div');
        if (typeof (wrapper as any).createDiv !== 'function') {
            header.className = 'heatmap-header';
            wrapper.appendChild(header);
        }

        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';

        const data = stats || await this.gatherFocusStats(30);
        const totalMinutes = data.reduce((sum, d) => sum + d.focusMinutes, 0);
        const totalHours = (totalMinutes / 60).toFixed(1);

        const titleText = `📊 Focus Session Heatmap (Last ${data.length} Days)`;
        const title = (typeof (header as any).createEl === 'function')
            ? (header as any).createEl('span', { text: titleText })
            : document.createElement('span');
        if (typeof (header as any).createEl !== 'function') {
            title.textContent = titleText;
            header.appendChild(title);
        }
        title.style.fontWeight = '600';
        title.style.fontSize = '0.9em';
        title.style.color = 'var(--text-normal)';

        const badgeText = `${totalHours} hrs logged`;
        const totalBadge = (typeof (header as any).createEl === 'function')
            ? (header as any).createEl('span', { text: badgeText })
            : document.createElement('span');
        if (typeof (header as any).createEl !== 'function') {
            totalBadge.textContent = badgeText;
            header.appendChild(totalBadge);
        }
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
