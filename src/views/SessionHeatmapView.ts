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
    dayOfWeek: number; // 0=Mon, 1=Tue, ..., 6=Sun
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
            const dayOfWeek = (d.getDay() + 6) % 7; // 0=Mon, ..., 6=Sun

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
                sessionCount: count,
                dayOfWeek
            });
        }

        return stats;
    }

    /**
     * Renders the SVG activity heatmap with labels, legend, and details into the container.
     */
    public async render(stats?: DayFocusStat[]): Promise<HTMLElement> {
        if (typeof (this.containerEl as any).empty === 'function') {
            (this.containerEl as any).empty();
        } else {
            this.containerEl.innerHTML = '';
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'focus-session-heatmap-wrapper';
        wrapper.style.padding = '14px 16px';
        wrapper.style.backgroundColor = 'var(--background-secondary)';
        wrapper.style.border = '1px solid var(--background-modifier-border)';
        wrapper.style.borderRadius = '8px';
        wrapper.style.margin = '12px 0';
        wrapper.style.fontFamily = 'var(--font-interface)';

        const data = stats || await this.gatherFocusStats(30);
        const totalMinutes = data.reduce((sum, d) => sum + d.focusMinutes, 0);
        const totalHours = (totalMinutes / 60).toFixed(1);
        const totalSessions = data.reduce((sum, d) => sum + d.sessionCount, 0);
        const activeDays = data.filter(d => d.focusMinutes > 0).length;

        // Current streak
        let streak = 0;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].focusMinutes > 0) {
                streak++;
            } else if (i === data.length - 1) {
                // Today might not have sessions yet, give benefit of yesterday
                continue;
            } else {
                break;
            }
        }

        // Header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.flexWrap = 'wrap';
        header.style.gap = '8px';
        header.style.marginBottom = '12px';

        const titleBox = document.createElement('div');
        titleBox.style.display = 'flex';
        titleBox.style.alignItems = 'center';
        titleBox.style.gap = '8px';

        const title = document.createElement('span');
        title.textContent = `🎯 Focus Session Activity (${data.length} Days)`;
        title.style.fontWeight = '600';
        title.style.fontSize = '0.95em';
        title.style.color = 'var(--text-normal)';
        titleBox.appendChild(title);

        const badge = document.createElement('span');
        badge.textContent = `${activeDays}/${data.length} active days`;
        badge.style.fontSize = '0.75em';
        badge.style.padding = '2px 8px';
        badge.style.borderRadius = '12px';
        badge.style.backgroundColor = 'var(--background-modifier-hover)';
        badge.style.color = 'var(--text-muted)';
        titleBox.appendChild(badge);

        header.appendChild(titleBox);

        const summaryStats = document.createElement('div');
        summaryStats.style.display = 'flex';
        summaryStats.style.gap = '14px';
        summaryStats.style.fontSize = '0.82em';
        summaryStats.style.color = 'var(--text-muted)';

        summaryStats.innerHTML = `
            <span><strong>${totalHours}</strong> hrs</span>
            <span><strong>${totalSessions}</strong> sessions</span>
            ${streak > 1 ? `<span>🔥 <strong>${streak}d</strong> streak</span>` : ''}
        `;
        header.appendChild(summaryStats);
        wrapper.appendChild(header);

        // Build calendar-aligned columns (Monday to Sunday)
        // Group data into weeks aligned to Monday
        const startDate = new Date(data[0].date + 'T00:00:00');
        const startDayOfWeek = (startDate.getDay() + 6) % 7; // 0=Mon, ..., 6=Sun
        const alignedStart = new Date(startDate);
        alignedStart.setDate(alignedStart.getDate() - startDayOfWeek);

        const todayDate = new Date(data[data.length - 1].date + 'T00:00:00');
        const dataMap = new Map<string, DayFocusStat>();
        data.forEach(d => dataMap.set(d.date, d));

        interface CalendarCell {
            dateStr: string;
            displayDate: string;
            dayOfWeek: number;
            inRange: boolean;
            isToday: boolean;
            stat?: DayFocusStat;
        }

        const weeks: CalendarCell[][] = [];
        let curr = new Date(alignedStart);
        let currWeek: CalendarCell[] = [];

        while (curr <= todayDate || currWeek.length > 0) {
            const yr = curr.getFullYear();
            const mo = String(curr.getMonth() + 1).padStart(2, '0');
            const da = String(curr.getDate()).padStart(2, '0');
            const dStr = `${yr}-${mo}-${da}`;
            const dow = (curr.getDay() + 6) % 7;

            const isToday = dStr === data[data.length - 1].date;
            const inRange = dataMap.has(dStr);
            const stat = dataMap.get(dStr);

            currWeek.push({
                dateStr: dStr,
                displayDate: `${mo}/${da}`,
                dayOfWeek: dow,
                inRange,
                isToday,
                stat
            });

            if (dow === 6) {
                weeks.push(currWeek);
                currWeek = [];
                if (curr >= todayDate) break;
            }
            curr.setDate(curr.getDate() + 1);
        }

        // SVG Dimensions
        const cellSize = 15;
        const cellGap = 4;
        const labelWidth = 34; // Width reserved for Mon/Wed/Fri labels
        const monthHeaderHeight = 16;
        const numCols = weeks.length;
        const svgWidth = labelWidth + numCols * (cellSize + cellGap) + 10;
        const svgHeight = monthHeaderHeight + 7 * (cellSize + cellGap) + 10;

        const mainContainer = document.createElement('div');
        mainContainer.style.display = 'flex';
        mainContainer.style.alignItems = 'flex-start';
        mainContainer.style.gap = '16px';
        mainContainer.style.flexWrap = 'wrap';

        const svgWrapper = document.createElement('div');
        svgWrapper.style.overflowX = 'auto';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', `${svgWidth}`);
        svg.setAttribute('height', `${svgHeight}`);
        svg.style.display = 'block';

        // Day of week labels on the left (Mon, Wed, Fri)
        const dayLabels = [
            { text: 'Mon', row: 0 },
            { text: 'Wed', row: 2 },
            { text: 'Fri', row: 4 },
            { text: 'Sun', row: 6 }
        ];

        dayLabels.forEach(label => {
            const textElem = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textElem.setAttribute('x', '0');
            textElem.setAttribute('y', `${monthHeaderHeight + label.row * (cellSize + cellGap) + cellSize - 2}`);
            textElem.setAttribute('fill', 'var(--text-muted)');
            textElem.setAttribute('font-size', '9px');
            textElem.setAttribute('font-family', 'var(--font-interface)');
            textElem.textContent = label.text;
            svg.appendChild(textElem);
        });

        // Month labels along top
        let lastMonth = '';
        weeks.forEach((week, colIdx) => {
            const firstValid = week.find(c => c.inRange);
            if (firstValid) {
                const monthName = new Date(firstValid.dateStr + 'T00:00:00').toLocaleString('default', { month: 'short' });
                if (monthName !== lastMonth) {
                    lastMonth = monthName;
                    const mText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    const x = labelWidth + colIdx * (cellSize + cellGap);
                    mText.setAttribute('x', `${x}`);
                    mText.setAttribute('y', `${monthHeaderHeight - 4}`);
                    mText.setAttribute('fill', 'var(--text-muted)');
                    mText.setAttribute('font-size', '10px');
                    mText.setAttribute('font-weight', '500');
                    mText.setAttribute('font-family', 'var(--font-interface)');
                    mText.textContent = monthName;
                    svg.appendChild(mText);
                }
            }
        });

        // Inspector card (shows details on click/hover)
        const detailCard = document.createElement('div');
        detailCard.className = 'heatmap-detail-card';
        detailCard.style.minWidth = '180px';
        detailCard.style.flex = '1';
        detailCard.style.padding = '10px 14px';
        detailCard.style.borderRadius = '6px';
        detailCard.style.border = '1px solid var(--background-modifier-border)';
        detailCard.style.backgroundColor = 'var(--background-primary)';
        detailCard.style.fontSize = '0.82em';
        detailCard.style.color = 'var(--text-muted)';
        detailCard.style.alignSelf = 'center';

        const updateDetail = (cell: CalendarCell) => {
            const dateObj = new Date(cell.dateStr + 'T00:00:00');
            const dayName = dateObj.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });
            const mins = cell.stat ? cell.stat.focusMinutes : 0;
            const count = cell.stat ? cell.stat.sessionCount : 0;
            const hrs = (mins / 60).toFixed(1);

            detailCard.innerHTML = `
                <div style="font-weight: 600; color: var(--text-normal); margin-bottom: 4px;">
                    📅 ${dayName} ${cell.isToday ? '<span style="color: var(--interactive-accent); font-size: 0.85em;">(Today)</span>' : ''}
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>Focus Time:</span>
                    <strong style="color: ${mins > 0 ? 'var(--interactive-accent)' : 'var(--text-muted)'};">${mins} mins (${hrs} hrs)</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Completed Sessions:</span>
                    <strong style="color: var(--text-normal);">${count} ${count === 1 ? 'block' : 'blocks'}</strong>
                </div>
            `;
        };

        // Initialize detail card with today's data
        const todayCell = weeks.flat().find(c => c.isToday) || weeks.flat()[weeks.flat().length - 1];
        if (todayCell) updateDetail(todayCell);

        // Render Day Cells
        weeks.forEach((week, colIdx) => {
            week.forEach((cell) => {
                const x = labelWidth + colIdx * (cellSize + cellGap);
                const y = monthHeaderHeight + cell.dayOfWeek * (cellSize + cellGap);

                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', `${x}`);
                rect.setAttribute('y', `${y}`);
                rect.setAttribute('width', `${cellSize}`);
                rect.setAttribute('height', `${cellSize}`);
                rect.setAttribute('rx', '3');
                rect.setAttribute('ry', '3');

                if (!cell.inRange) {
                    rect.setAttribute('fill', 'transparent');
                    rect.setAttribute('opacity', '0');
                    svg.appendChild(rect);
                    return;
                }

                const mins = cell.stat ? cell.stat.focusMinutes : 0;
                const count = cell.stat ? cell.stat.sessionCount : 0;

                // Color scale
                let color = 'var(--background-modifier-border)';
                let opacity = '0.5';

                if (mins >= 120) {
                    color = 'var(--interactive-accent)';
                    opacity = '1.0';
                } else if (mins >= 60) {
                    color = 'var(--interactive-accent)';
                    opacity = '0.75';
                } else if (mins >= 25) {
                    color = 'var(--interactive-accent)';
                    opacity = '0.50';
                } else if (mins > 0) {
                    color = 'var(--interactive-accent)';
                    opacity = '0.28';
                }

                rect.setAttribute('fill', color);
                rect.setAttribute('fill-opacity', opacity);

                if (cell.isToday) {
                    rect.setAttribute('stroke', 'var(--text-accent, var(--interactive-accent))');
                    rect.setAttribute('stroke-width', '1.5');
                }

                rect.style.cursor = 'pointer';
                rect.style.transition = 'transform 0.1s ease, fill-opacity 0.1s ease';

                // Native SVG Tooltip
                const titleElem = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                const hrs = (mins / 60).toFixed(1);
                titleElem.textContent = `${cell.dateStr}: ${mins}m focus (${hrs} hrs, ${count} sessions)`;
                rect.appendChild(titleElem);

                // Interactive Events
                rect.addEventListener('mouseenter', () => {
                    rect.setAttribute('stroke', 'var(--text-normal)');
                    rect.setAttribute('stroke-width', '1.5');
                    updateDetail(cell);
                });

                rect.addEventListener('mouseleave', () => {
                    if (cell.isToday) {
                        rect.setAttribute('stroke', 'var(--text-accent, var(--interactive-accent))');
                        rect.setAttribute('stroke-width', '1.5');
                    } else {
                        rect.removeAttribute('stroke');
                        rect.removeAttribute('stroke-width');
                    }
                });

                rect.addEventListener('click', () => {
                    updateDetail(cell);
                    // Open daily note on click
                    const notePath = `02_Journal/01_Daily/${cell.dateStr}.md`;
                    const file = this.app.vault.getAbstractFileByPath(notePath);
                    if (file instanceof TFile) {
                        this.app.workspace.openLinkText(notePath, '', false);
                    }
                });

                svg.appendChild(rect);
            });
        });

        svgWrapper.appendChild(svg);
        mainContainer.appendChild(svgWrapper);
        mainContainer.appendChild(detailCard);
        wrapper.appendChild(mainContainer);

        // Legend at bottom
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.marginTop = '10px';
        footer.style.paddingTop = '8px';
        footer.style.borderTop = '1px solid var(--background-modifier-border)';
        footer.style.fontSize = '0.75em';
        footer.style.color = 'var(--text-muted)';

        const hint = document.createElement('span');
        hint.textContent = '💡 Click cell to open daily note';
        footer.appendChild(hint);

        const legend = document.createElement('div');
        legend.style.display = 'flex';
        legend.style.alignItems = 'center';
        legend.style.gap = '4px';

        legend.innerHTML = `
            <span>Less</span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:var(--background-modifier-border);opacity:0.5;"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:var(--interactive-accent);opacity:0.28;"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:var(--interactive-accent);opacity:0.50;"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:var(--interactive-accent);opacity:0.75;"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background-color:var(--interactive-accent);opacity:1.0;"></span>
            <span>More (2h+)</span>
        `;
        footer.appendChild(legend);
        wrapper.appendChild(footer);

        this.containerEl.appendChild(wrapper);
        return wrapper;
    }
}

