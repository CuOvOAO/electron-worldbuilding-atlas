export interface FullBackupResult {
  filePath: string;
  fileName: string;
  size: number;
  assetCount: number;
  fileCount: number;
  manifest: unknown;
}

export interface BackupExportResult {
  success: boolean;
  cancelled: boolean;
  result?: FullBackupResult;
}

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '备份失败。');
  }
  return result;
}

export const backupClient = {
  async createFullVaultBackup(vaultPath: string): Promise<BackupExportResult> {
    return unwrap(await window.manuscriptAtlas.backup.createFullVaultBackup(vaultPath)) as BackupExportResult;
  }
};
