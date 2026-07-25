import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getLatestMigrationVersion } from './migrations';

export function assertDatabaseVersionSupported(dbPath: string): void {
  if (!existsSync(dbPath)) {
    return;
  }

  const db = new DatabaseSync(dbPath, { readOnly: true } as any);
  try {
    const migrationTable = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get();
    if (!migrationTable) {
      return;
    }

    const row = db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations').get() as { version: number } | undefined;
    const currentVersion = Number(row?.version ?? Number.NaN);
    if (!Number.isFinite(currentVersion)) {
      throw new Error('无法读取存档数据库版本。');
    }

    const latestSupportedVersion = getLatestMigrationVersion();
    if (currentVersion > latestSupportedVersion) {
      throw new Error(
        `该存档数据库版本为 ${currentVersion}，高于当前应用支持的 ${latestSupportedVersion}。请使用更新版本的手稿星图打开，当前版本不会写入该存档。`
      );
    }
  } finally {
    db.close();
  }
}
