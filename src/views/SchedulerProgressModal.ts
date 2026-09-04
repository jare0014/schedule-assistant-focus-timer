/**
 * SchedulerProgressModal.ts - Progress indicator and cancel dialog for background Python scheduler process.
 */

import { App, Modal, Notice } from 'obsidian';
import { ChildProcess } from 'child_process';

export class SchedulerProgressModal extends Modal {
    private isCompleted = false;

    constructor(app: App, private childProcess: ChildProcess) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: 'Generating Daily Schedule', style: 'text-align: center; margin-bottom: 20px;' });

        const loaderContainer = contentEl.createDiv({ style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;' });

        const spinner = loaderContainer.createDiv({ cls: 'scheduler-spinner' });
        spinner.style.width = '40px';
        spinner.style.height = '40px';
        spinner.style.border = '4px solid var(--background-modifier-border)';
        spinner.style.borderTop = '4px solid var(--text-accent)';
        spinner.style.borderRadius = '50%';
        spinner.style.animation = 'spin 1s linear infinite';

        if (!document.getElementById('scheduler-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'scheduler-spinner-style';
            style.innerHTML = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        loaderContainer.createDiv({
            text: 'Schedule Assistant is creating your day plan...',
            style: 'margin-top: 20px; font-weight: 500; color: var(--text-normal); font-size: 1.1em;'
        });

        loaderContainer.createDiv({
            text: 'This pulls tasks from Google Tasks, Google Calendar, and Todoist, then builds a smart timeline using Gemini.',
            style: 'margin-top: 10px; font-size: 0.9em; color: var(--text-muted); text-align: center; max-width: 300px;'
        });

        const cancelBtn = loaderContainer.createEl('button', { text: 'Cancel Process', style: 'margin-top: 25px;' });
        cancelBtn.onclick = () => {
            if (this.childProcess && !this.isCompleted) {
                this.childProcess.kill();
                new Notice("Schedule generation cancelled.");
            }
            this.close();
        };
    }

    public setCompleted(): void {
        this.isCompleted = true;
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
