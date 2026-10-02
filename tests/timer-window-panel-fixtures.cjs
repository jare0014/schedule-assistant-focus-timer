const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal simulated TimerEngineService test harness
class SimulatedTimerEngineService {
    constructor(electronMock) {
        this.electronMock = electronMock;
        this.isAlarming = false;
        this.alwaysOnTopState = false;
    }

    getElectronWindow() {
        if (!this.electronMock) return null;
        if (this.electronMock.remote && typeof this.electronMock.remote.getCurrentWindow === 'function') {
            return this.electronMock.remote.getCurrentWindow();
        }
        if (this.electronMock.BrowserWindow) {
            if (typeof this.electronMock.BrowserWindow.getFocusedWindow === 'function') {
                const focused = this.electronMock.BrowserWindow.getFocusedWindow();
                if (focused) return focused;
            }
            if (typeof this.electronMock.BrowserWindow.getAllWindows === 'function') {
                const all = this.electronMock.BrowserWindow.getAllWindows();
                if (all && all.length > 0) return all[0];
            }
        }
        return null;
    }

    setAlwaysOnTop(onTop) {
        const win = this.getElectronWindow();
        if (win) {
            if (onTop) {
                if (win.isMinimized && win.isMinimized()) {
                    win.restore();
                }
                if (win.show) win.show();
                if (win.focus) win.focus();
                win.setAlwaysOnTop(true, 'floating');
            } else {
                win.setAlwaysOnTop(false);
            }
            this.alwaysOnTopState = onTop;
        }
    }

    stopAlarm() {
        this.isAlarming = false;
        this.setAlwaysOnTop(false);
    }
}

// Minimal simulated TaskTimerView panel sizing harness
class SimulatedTaskTimerView {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.leaf = {
            view: this,
            parent: app.workspace.rightSplit
        };
    }

    ensureTimerPanelVisible() {
        if (this.leaf && this.app?.workspace) {
            this.app.workspace.revealLeaf(this.leaf);
        }
        const workspace = this.app?.workspace;
        let sidedock = workspace?.rightSplit;
        if (sidedock) {
            if (sidedock.collapsed && typeof sidedock.expand === 'function') {
                sidedock.expand();
            }
            const minWidth = Math.max(350, parseInt(this.plugin?.settings?.timerPanelMinWidth) || 420);
            const currentWidth = sidedock.size || (sidedock.containerEl ? sidedock.containerEl.offsetWidth : 0);
            if (currentWidth < minWidth) {
                if (typeof sidedock.setSize === 'function') {
                    sidedock.setSize(minWidth);
                } else {
                    if (typeof sidedock.size === 'number') sidedock.size = minWidth;
                    if (typeof sidedock.width === 'number') sidedock.width = minWidth;
                    if (sidedock.containerEl) {
                        sidedock.containerEl.style.width = `${minWidth}px`;
                    }
                }
                if (typeof workspace.onLayoutChange === 'function') {
                    workspace.onLayoutChange();
                }
            }
        }
    }
}

test('TimerEngineService.setAlwaysOnTop activates and deactivates window topmost state', (t) => {
    let topmost = false;
    let restored = false;
    let shown = false;
    let focused = false;

    const mockWin = {
        isMinimized: () => true,
        restore: () => { restored = true; },
        show: () => { shown = true; },
        focus: () => { focused = true; },
        setAlwaysOnTop: (val, level) => { topmost = val; }
    };

    const mockElectron = {
        remote: {
            getCurrentWindow: () => mockWin
        }
    };

    const service = new SimulatedTimerEngineService(mockElectron);

    // Turn on
    service.setAlwaysOnTop(true);
    assert.equal(topmost, true, 'Window should be set to always on top');
    assert.equal(restored, true, 'Minimized window should be restored');
    assert.equal(shown, true, 'Window should be shown');
    assert.equal(focused, true, 'Window should be focused');

    // Turn off
    service.setAlwaysOnTop(false);
    assert.equal(topmost, false, 'Window should be restored to normal topmost state');

    // stopAlarm turns off
    service.setAlwaysOnTop(true);
    service.stopAlarm();
    assert.equal(topmost, false, 'stopAlarm should clear always on top');
});

test('ensureTimerPanelVisible expands collapsed right sidedock and enforces minimum display width', (t) => {
    let expanded = false;
    let revealed = false;
    let layoutChanged = false;

    const sidedock = {
        collapsed: true,
        size: 260,
        containerEl: { offsetWidth: 260, style: { width: '260px' } },
        expand: () => {
            expanded = true;
            sidedock.collapsed = false;
        },
        setSize: (w) => {
            sidedock.size = w;
            sidedock.containerEl.style.width = `${w}px`;
        }
    };

    const mockApp = {
        workspace: {
            rightSplit: sidedock,
            revealLeaf: (leaf) => { revealed = true; },
            onLayoutChange: () => { layoutChanged = true; }
        }
    };

    const mockPlugin = {
        settings: {
            keepOnTopDuringTimer: true,
            autoExpandTimerPanel: true,
            timerPanelMinWidth: 420
        }
    };

    const view = new SimulatedTaskTimerView(mockApp, mockPlugin);
    view.ensureTimerPanelVisible();

    assert.equal(expanded, true, 'Collapsed sidedock should be expanded');
    assert.equal(revealed, true, 'Timer leaf should be revealed');
    assert.equal(sidedock.size, 420, 'Sidedock width should be resized to at least 420px');
    assert.equal(sidedock.containerEl.style.width, '420px', 'Container element width style should be updated');
    assert.equal(layoutChanged, true, 'Workspace layout change should be triggered');
});

test('ensureTimerPanelVisible preserves existing width if already wider than minimum', (t) => {
    const sidedock = {
        collapsed: false,
        size: 520,
        containerEl: { offsetWidth: 520, style: { width: '520px' } },
        expand: () => {},
        setSize: (w) => { sidedock.size = w; }
    };

    const mockApp = {
        workspace: {
            rightSplit: sidedock,
            revealLeaf: () => {},
            onLayoutChange: () => {}
        }
    };

    const mockPlugin = {
        settings: {
            keepOnTopDuringTimer: true,
            autoExpandTimerPanel: true,
            timerPanelMinWidth: 420
        }
    };

    const view = new SimulatedTaskTimerView(mockApp, mockPlugin);
    view.ensureTimerPanelVisible();

    assert.equal(sidedock.size, 520, 'Existing wider width should be preserved');
});
