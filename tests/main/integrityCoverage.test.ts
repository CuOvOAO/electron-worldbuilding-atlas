import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/main/db/migrations';
import { checkVaultIntegrity } from '../../src/main/integrity/integrityService';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('integrity coverage', () => {
  it('accepts an empty description and a complete current schema', async () => {
    const root = createVaultFixture();
    const report = await checkVaultIntegrity(root);
    expect(report.issues.filter((issue) => issue.severity === 'critical')).toEqual([]);
  });

  it('reports broken polymorphic entity links as critical', async () => {
    const root = createVaultFixture();
    const db = new DatabaseSync(join(root, 'world.db'));
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO entity_links
          (id, created_at, updated_at, source_entity_type, source_entity_id, target_entity_type, target_entity_id, link_type, note)
        VALUES (?, ?, ?, 'codex_item', 'missing-source', 'event', 'missing-target', 'related', '')
      `).run(randomUUID(), now, now);
    } finally {
      db.close();
    }
    const report = await checkVaultIntegrity(root);
    expect(report.issues.some((issue) => issue.severity === 'critical' && issue.message.includes('资料关联'))).toBe(true);
  });
});

function createVaultFixture(): string {
  const root = join(tmpdir(), `manuscript-atlas-integrity-${randomUUID()}`);
  roots.push(root);
  mkdirSync(join(root, 'assets'), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(root, 'project.json'), JSON.stringify({
    id: randomUUID(), name: '测试存档', description: '', createdAt: now, updatedAt: now, appVersion: '0.0.1'
  }), 'utf8');
  const db = new DatabaseSync(join(root, 'world.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
  } finally {
    db.close();
  }
  return root;
}
