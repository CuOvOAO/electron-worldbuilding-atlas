import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { addRecentVault, createVault, ensureVaultReady, readRecentVaults } from '../vault/vaultService';

export function registerVaultIpc(): void {
  ipcMain.handle('vault:listRecent', () => readRecentVaults());

  ipcMain.handle('vault:chooseDirectory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择存档存放位置',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('vault:create', (_event, input: { parentDir: string; name: string; description: string }) => {
    try {
      return { ok: true, vault: createVault(input.parentDir, input.name, input.description) };
    } catch (error) {
      console.error('创建存档失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('vault:openDialog', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '打开本地存档',
      properties: ['openDirectory']
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    try {
      const vault = ensureVaultReady(result.filePaths[0]);
      addRecentVault(vault);
      return { ok: true, vault };
    } catch (error) {
      console.error('打开存档失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('vault:openPath', (_event, vaultPath: string) => {
    try {
      const vault = ensureVaultReady(vaultPath);
      addRecentVault(vault);
      return { ok: true, vault };
    } catch (error) {
      console.error('打开最近存档失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
