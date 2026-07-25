import { ipcMain } from 'electron';
import { checkVaultIntegrity } from '../integrity/integrityService';
import { assertVaultPathAuthorized } from '../security/capabilities';

export function registerIntegrityIpc(): void {
  ipcMain.handle('integrity:checkCurrentVault', async (_event, vaultPath: string) => {
    try {
      assertVaultPathAuthorized(vaultPath);
      return {
        ok: true,
        report: await checkVaultIntegrity(vaultPath)
      };
    } catch (error) {
      console.error('存档完整性检查失败', error);
      return {
        ok: false,
        error: readableIntegrityError(error)
      };
    }
  });
}

function readableIntegrityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) return '完整性检查失败：文件或目录不存在。';
  if (message.includes('EACCES') || message.includes('EPERM')) return '完整性检查失败：没有权限读取存档文件。';
  return '完整性检查失败：无法完成只读扫描，请确认存档文件可访问。';
}
