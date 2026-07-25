import type { DatabaseSync } from 'node:sqlite';

export interface DatabaseIntegrityResult {
  integrityMessages: string[];
  foreignKeyViolationCount: number;
}

export function checkDatabaseIntegrity(db: DatabaseSync): DatabaseIntegrityResult {
  const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
  const integrityMessages = integrityRows.flatMap((row) => Object.values(row).map(String));
  const foreignKeyRows = db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
  return {
    integrityMessages,
    foreignKeyViolationCount: foreignKeyRows.length
  };
}

export function assertDatabaseIntegrity(db: DatabaseSync, errorPrefix: string): void {
  const result = checkDatabaseIntegrity(db);
  if (result.integrityMessages.length === 0 || result.integrityMessages.some((message) => message !== 'ok')) {
    throw new Error(`${errorPrefix}：world.db 完整性检查未通过。`);
  }
  if (result.foreignKeyViolationCount > 0) {
    throw new Error(`${errorPrefix}：world.db 存在 ${result.foreignKeyViolationCount} 条外键异常。`);
  }
}
