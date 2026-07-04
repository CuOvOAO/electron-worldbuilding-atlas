import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export interface OpenedDatabase {
  db: DatabaseSync;
  dbPath: string;
}

export function openDatabase(dbPath: string): OpenedDatabase {
  const parentDir = dirname(dbPath);

  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  return { db, dbPath };
}
