/**
 * OmniLoggerModal.ts - Modal dialog for clipboard screenshot OCR and consolidated data ingestion.
 */

import { App, Modal, Notice } from 'obsidian';

export class OmniLoggerModal extends Modal {
    private selectedType = 'calls';
    private selectedMode = 'ocr';
    private pastedImageBase64: string | null = null;
    private pasteListener: ((evt: ClipboardEvent) => void) | null = null;

    constructor(app: App, private plugin: any) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Omni-Logger: Consolidated Data Sync', cls: 'omni-modal-title' });

        const mainContainer = contentEl.createDiv({ cls: 'omni-modal-container' });

        // 1. Selector row
        const selectorRow = mainContainer.createDiv({ cls: 'omni-selector-row' });

        selectorRow.createSpan({ text: 'Log Type: ' });
        const typeSelect = selectorRow.createEl('select');
        typeSelect.createEl('option', { value: 'calls', text: 'Work Calls' });
        typeSelect.createEl('option', { value: 'lumosity', text: 'Lumosity Daily Scores' });
        typeSelect.createEl('option', { value: 'health', text: 'Google Health/Vitals' });
        typeSelect.value = this.selectedType;

        selectorRow.createSpan({ text: '  Mode: ' });
        const modeSelect = selectorRow.createEl('select');
        modeSelect.createEl('option', { value: 'ocr', text: 'Clipboard / OCR' });
        modeSelect.createEl('option', { value: 'api', text: 'Direct API Payload' });
        modeSelect.value = this.selectedMode;

        // 2. Clipboard Drag & Drop Zone
        const dropZone = mainContainer.createDiv({ cls: 'omni-drop-zone' });
        dropZone.createEl('p', { text: 'Paste screenshot (Ctrl+V) or click to upload', cls: 'omni-drop-text' });

        const fileInput = dropZone.createEl('input', { type: 'file' });
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        dropZone.onclick = () => fileInput.click();

        // Image preview
        const previewContainer = mainContainer.createDiv({ cls: 'omni-preview-container', attr: { style: 'display:none;' } });
        const previewImg = previewContainer.createEl('img', { cls: 'omni-preview-image' });

        // Form trigger/API elements
        const formContainer = mainContainer.createDiv({ cls: 'omni-form-container', attr: { style: 'display:none;' } });

        const updateVisibility = () => {
            this.selectedType = typeSelect.value;
            this.selectedMode = modeSelect.value;

            if (this.selectedMode === 'ocr') {
                dropZone.style.display = 'flex';
                if (this.pastedImageBase64) {
                    previewContainer.style.display = 'block';
                    dropZone.style.display = 'none';
                } else {
                    previewContainer.style.display = 'none';
                }
                formContainer.style.display = 'none';
            } else {
                dropZone.style.display = 'none';
                previewContainer.style.display = 'none';
                formContainer.style.display = 'block';
                formContainer.empty();

                if (this.selectedType === 'health') {
                    formContainer.createEl('p', { text: 'Pulls Sleep hours and wake up time directly from Google Health APIs.' });
                } else {
                    formContainer.createEl('p', { text: 'Direct API payload is not supported for this category. Please use Clipboard / OCR mode.' });
                }
            }
        };

        typeSelect.onchange = updateVisibility;
        modeSelect.onchange = updateVisibility;

        const handleImageFile = (file: File) => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.pastedImageBase64 = reader.result as string;
                previewImg.src = reader.result as string;
                previewContainer.style.display = 'block';
                dropZone.style.display = 'none';
            };
            reader.readAsDataURL(file);
        };

        fileInput.onchange = (e: any) => {
            if (e.target.files && e.target.files.length > 0) {
                handleImageFile(e.target.files[0]);
            }
        };

        this.pasteListener = (evt: ClipboardEvent) => {
            if (this.selectedMode !== 'ocr') return;
            const items = evt.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) handleImageFile(file);
                    break;
                }
            }
        };

        contentEl.addEventListener('paste', this.pasteListener);

        const statusBar = mainContainer.createDiv({ cls: 'omni-status-bar', text: 'Status: Ready' });

        const actionRow = mainContainer.createDiv({ cls: 'omni-action-row' });
        const cancelBtn = actionRow.createEl('button', { text: 'Cancel', cls: 'omni-btn btn-cancel' });
        cancelBtn.onclick = () => this.close();

        const processBtn = actionRow.createEl('button', { text: 'Process & Log', cls: 'omni-btn btn-process' });
        processBtn.onclick = async () => {
            statusBar.setText('Processing... please wait.');
            processBtn.disabled = true;
            try {
                if (this.selectedMode === 'ocr') {
                    if (!this.pastedImageBase64) {
                        new Notice("Please paste or upload an image first!");
                        statusBar.setText('Error: No image provided.');
                        processBtn.disabled = false;
                        return;
                    }

                    const base64Data = this.pastedImageBase64.split(',')[1];
                    const mimeType = this.pastedImageBase64.split(',')[0].split(':')[1].split(';')[0];

                    if (this.plugin.processOCR) {
                        await this.plugin.processOCR(base64Data, mimeType, this.selectedType);
                    }
                    statusBar.setText('Successfully logged data from OCR!');
                    new Notice("Successfully logged scores/counts to Daily Note!");
                    setTimeout(() => this.close(), 1500);
                } else {
                    if (this.selectedType === 'health') {
                        statusBar.setText('Calling Google Health API...');
                        if (this.plugin.pullGoogleHealthData) {
                            await this.plugin.pullGoogleHealthData();
                        }
                        statusBar.setText('Successfully pulled Google Health data!');
                        new Notice("Successfully synced health stats from Google API!");
                        setTimeout(() => this.close(), 1500);
                    } else {
                        statusBar.setText('Unsupported configuration.');
                        processBtn.disabled = false;
                    }
                }
            } catch (err: any) {
                console.error("Omni-Logger failed:", err);
                statusBar.setText('Error: ' + err.message);
                processBtn.disabled = false;
            }
        };
    }

    onClose(): void {
        if (this.pasteListener) {
            this.contentEl.removeEventListener('paste', this.pasteListener);
        }
        this.contentEl.empty();
    }
}
