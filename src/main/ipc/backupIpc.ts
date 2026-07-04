import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { createFullVaultBackup, defaultBackupFileName, normalizeBackupTargetPath } from '../backup/backupService';
import { readProject } from '../vault/vaultService';

export function registerBackupIpc(): void {
  ipcMain.handle('backup:createFullVaultBackup', async (event, vaultPath: string) => {
    try {
      const project = readProject(vaultPath);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = join(vaultPath, 'backups', defaultBackupFileName(project.name));
      const saveOptions = {
        title: '导出完整备份包',
        defaultPath,
        filters: [{ name: 'Manuscript Atlas Backup', extensions: ['zip'] }]
      };
      const result = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions);

      if (result.canceled || !result.filePath) {
        return { ok: true, cancelled: true, success: false };
      }

      const targetPath = normalizeBackupTargetPath(result.filePath);
      const backup = await createFullVaultBackup(vaultPath, targetPath, app.getVersion());
      return {
        ok: true,
        cancelled: false,
        success: true,
        result: backup
      };
    } catch (error) {
      console.error('完整备份导出失败', error);
      return { ok: false, error: readableBackupError(error) };
    }
  });
}

function readableBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) return '无法创建备份：文件或目录不存在。';
  if (message.includes('EACCES') || message.includes('EPERM')) return '无法创建备份：没有权限读取存档或写入备份文件。';
  return message;
}
