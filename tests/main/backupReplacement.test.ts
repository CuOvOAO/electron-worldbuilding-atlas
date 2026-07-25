import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createFullVaultBackup, replaceBackupWithRollback } from '../../src/main/backup/backupService';
import { inspectRestoreArchive } from '../../src/main/backup/restoreService';
import { runMigrations } from '../../src/main/db/migrations';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('backup replacement', () => {
  it('replaces an existing backup only after preserving a rollback copy', () => {
    const root = createTempRoot();
    const sourcePath = join(root, 'new.zip');
    const finalPath = join(root, 'backup.zip');
    writeFileSync(sourcePath, 'new backup');
    writeFileSync(finalPath, 'old backup');

    replaceBackupWithRollback(sourcePath, finalPath);

    expect(readFileSync(finalPath, 'utf8')).toBe('new backup');
    expect(existsSync(sourcePath)).toBe(false);
    expect(readdirSync(root).some((name) => name.includes('.previous-'))).toBe(false);
  });

  it('restores the old backup when the new file cannot be renamed', () => {
    const root = createTempRoot();
    const missingSourcePath = join(root, 'missing.zip');
    const finalPath = join(root, 'backup.zip');
    writeFileSync(finalPath, 'old backup');

    expect(() => replaceBackupWithRollback(missingSourcePath, finalPath)).toThrow('旧备份已恢复');
    expect(readFileSync(finalPath, 'utf8')).toBe('old backup');
    expect(readdirSync(root).some((name) => name.includes('.previous-'))).toBe(false);
  });

  it('reopens and validates a generated backup before reporting success', async () => {
    const root = createTempRoot();
    const vaultPath = join(root, 'vault');
    const assetsPath = join(vaultPath, 'assets');
    mkdirSync(assetsPath, { recursive: true });
    writeFileSync(join(vaultPath, 'project.json'), JSON.stringify({
      id: randomUUID(),
      name: '测试存档',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: '0.0.1'
    }));
    const db = new DatabaseSync(join(vaultPath, 'world.db'));
    try {
      runMigrations(db);
    } finally {
      db.close();
    }

    const targetPath = join(root, 'verified.manuscript-atlas-backup.zip');
    const result = await createFullVaultBackup(vaultPath, targetPath, '0.0.1');
    const inspection = await inspectRestoreArchive(result.filePath);

    expect(result.filePath).toBe(targetPath);
    expect(result.size).toBeGreaterThan(0);
    expect(inspection.preview.originalVaultName).toBe('测试存档');
  });

  it('refuses to checkpoint and back up a database from a newer application version', async () => {
    const root = createTempRoot();
    const vaultPath = join(root, 'future-vault');
    mkdirSync(join(vaultPath, 'assets'), { recursive: true });
    writeFileSync(join(vaultPath, 'project.json'), JSON.stringify({
      id: randomUUID(),
      name: '未来版本存档',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: '99.0.0'
    }));
    const dbPath = join(vaultPath, 'world.db');
    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(999, 'future', new Date().toISOString());
    } finally {
      db.close();
    }

    await expect(createFullVaultBackup(vaultPath, join(root, 'future.manuscript-atlas-backup.zip'), '0.0.1'))
      .rejects.toThrow('当前版本不会写入该存档');
    const readOnlyDb = new DatabaseSync(dbPath, { readOnly: true } as any);
    try {
      const row = readOnlyDb.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
      expect(String(Object.values(row)[0])).toBe('delete');
    } finally {
      readOnlyDb.close();
    }
  });
});

function createTempRoot(): string {
  const root = join(tmpdir(), `manuscript-atlas-test-${randomUUID()}`);
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}
