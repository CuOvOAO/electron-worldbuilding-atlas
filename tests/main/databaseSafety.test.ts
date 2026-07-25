import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDatabaseVersionSupported } from '../../src/main/db/compatibility';
import { openDatabase } from '../../src/main/db/connection';
import { assertDatabaseIntegrity, checkDatabaseIntegrity } from '../../src/main/db/integrityChecks';
import { getLatestMigrationVersion } from '../../src/main/db/migrations';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('database safety guards', () => {
  it('accepts the latest supported migration version', () => {
    const dbPath = createVersionedDatabase(getLatestMigrationVersion());
    expect(() => assertDatabaseVersionSupported(dbPath)).not.toThrow();
  });

  it('rejects a migration version newer than the application supports', () => {
    const latest = getLatestMigrationVersion();
    const dbPath = createVersionedDatabase(latest + 1);
    expect(() => assertDatabaseVersionSupported(dbPath)).toThrow(`高于当前应用支持的 ${latest}`);
  });

  it('rejects a newer database before opening a writable WAL connection', () => {
    const dbPath = createVersionedDatabase(getLatestMigrationVersion() + 1);
    expect(() => openDatabase(dbPath)).toThrow('当前版本不会写入该存档');
    const db = new DatabaseSync(dbPath, { readOnly: true } as any);
    try {
      const row = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
      expect(String(Object.values(row)[0])).toBe('delete');
    } finally {
      db.close();
    }
  });

  it('accepts a structurally valid database without foreign key violations', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON; CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (parent_id TEXT REFERENCES parent(id));');
      expect(checkDatabaseIntegrity(db)).toEqual({ integrityMessages: ['ok'], foreignKeyViolationCount: 0 });
      expect(() => assertDatabaseIntegrity(db, '测试')).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('rejects a database with broken foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = OFF; CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (parent_id TEXT REFERENCES parent(id)); INSERT INTO child VALUES (\'missing\');');
      expect(() => assertDatabaseIntegrity(db, '测试')).toThrow('1 条外键异常');
    } finally {
      db.close();
    }
  });
});

function createVersionedDatabase(version: number): string {
  const root = join(tmpdir(), `manuscript-atlas-test-${randomUUID()}`);
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  const dbPath = join(root, 'world.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, `migration-${version}`, new Date().toISOString());
  } finally {
    db.close();
  }
  return dbPath;
}
