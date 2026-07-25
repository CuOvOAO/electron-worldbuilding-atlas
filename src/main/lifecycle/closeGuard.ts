import { BrowserWindow, ipcMain } from 'electron';

interface WindowCloseState {
  hasUnsavedChanges: boolean;
  allowClose: boolean;
}

const closeStates = new Map<number, WindowCloseState>();

export function registerLifecycleIpc(): void {
  ipcMain.on('lifecycle:setUnsavedChanges', (event, value: unknown) => {
    const state = stateFor(event.sender.id);
    state.hasUnsavedChanges = value === true;
  });

  ipcMain.on('lifecycle:confirmClose', (event) => {
    const state = stateFor(event.sender.id);
    state.allowClose = true;
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

export function protectWindowFromUnsavedClose(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  closeStates.set(webContentsId, { hasUnsavedChanges: false, allowClose: false });

  const requestCloseConfirmation = (event: Electron.Event): void => {
    const state = stateFor(webContentsId);
    if (!shouldPreventWindowClose(state)) {
      return;
    }
    event.preventDefault();
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('lifecycle:closeRequested');
    }
  };

  window.on('close', requestCloseConfirmation);
  window.on('query-session-end', requestCloseConfirmation);
  window.on('closed', () => closeStates.delete(webContentsId));
}

export function shouldPreventWindowClose(state: WindowCloseState): boolean {
  return state.hasUnsavedChanges && !state.allowClose;
}

function stateFor(webContentsId: number): WindowCloseState {
  const existing = closeStates.get(webContentsId);
  if (existing) {
    return existing;
  }
  const state = { hasUnsavedChanges: false, allowClose: false };
  closeStates.set(webContentsId, state);
  return state;
}
