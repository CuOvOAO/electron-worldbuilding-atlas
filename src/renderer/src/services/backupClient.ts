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

export interface RestoreArchivePreview {
  originalVaultId: string;
  originalVaultName: string;
  createdAt: string;
  appVersion: string;
  schemaMigrationVersion: number;
  assetCount: number;
  fileCount: number;
}

export interface RestoreArchiveSelection {
  cancelled: boolean;
  archivePath?: string;
  preview?: RestoreArchivePreview;
}

export interface RestoreAsNewVaultInput {
  archivePath: string;
  targetParentDir: string;
  newVaultName: string;
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
  },

  async pickAndInspectRestoreArchive(): Promise<RestoreArchiveSelection> {
    return unwrap(await window.manuscriptAtlas.backup.pickAndInspectRestoreArchive()) as RestoreArchiveSelection;
  },

  async restoreAsNewVault(input: RestoreAsNewVaultInput): Promise<{ vault: import('../types/entities').VaultProject; warning?: string }> {
    return unwrap(await window.manuscriptAtlas.backup.restoreAsNewVault(input));
  }
};
