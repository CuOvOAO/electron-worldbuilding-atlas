import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../db/connection';
import { runMigrations, seedInitialData } from '../db/migrations';
import { APP_VERSION } from '../../shared/appVersion';
import { assertVaultPathAuthorized, authorizeVaultPath } from '../security/capabilities';

export interface VaultProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  path: string;
}

interface ProjectJson {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
}

function recentVaultsPath(): string {
  return join(app.getPath('userData'), 'recent-vaults.json');
}

export function safeFolderName(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ');
  return cleaned || `WorldProject-${Date.now()}`;
}

function projectJsonPath(vaultPath: string): string {
  return join(vaultPath, 'project.json');
}

export function worldDbPath(vaultPath: string): string {
  return join(vaultPath, 'world.db');
}

function assertProjectJson(value: unknown): asserts value is ProjectJson {
  if (!value || typeof value !== 'object') {
    throw new Error('project.json 内容不是有效对象。');
  }

  const project = value as Partial<ProjectJson>;
  for (const key of ['id', 'name', 'description', 'createdAt', 'updatedAt', 'appVersion'] as const) {
    if (typeof project[key] !== 'string') {
      throw new Error(`project.json 缺少字段：${key}`);
    }
  }
}

export function readProject(vaultPath: string): VaultProject {
  if (!existsSync(vaultPath)) {
    throw new Error('存档路径不存在。');
  }

  const jsonPath = projectJsonPath(vaultPath);
  if (!existsSync(jsonPath)) {
    throw new Error('找不到 project.json，这不是有效的手稿星图存档。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`project.json 损坏：${error instanceof Error ? error.message : String(error)}`);
  }

  assertProjectJson(parsed);
  return { ...parsed, path: vaultPath };
}

export function touchVaultUpdatedAt(vaultPath: string): void {
  const project = readProject(vaultPath);
  const updatedAt = new Date().toISOString();
  writeJsonAtomically(projectJsonPath(vaultPath), {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt,
    appVersion: project.appVersion
  });
}

export function ensureVaultReady(vaultPath: string): VaultProject {
  const project = readProject(vaultPath);
  const dbPath = worldDbPath(vaultPath);

  if (!existsSync(dbPath)) {
    throw new Error('找不到 world.db，存档数据库不存在。');
  }

  const { db } = openDatabase(dbPath);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }

  return project;
}

export function ensureAuthorizedVaultReady(vaultPath: string): VaultProject {
  assertVaultPathAuthorized(vaultPath);
  return ensureVaultReady(vaultPath);
}

export function createVault(parentDir: string, name: string, description: string): VaultProject {
  if (!existsSync(parentDir)) {
    throw new Error('选择的存放位置不存在。');
  }

  let vaultPath = join(parentDir, safeFolderName(name));
  if (existsSync(vaultPath)) {
    vaultPath = join(parentDir, `${safeFolderName(name)}-${Date.now()}`);
  }

  const now = new Date().toISOString();
  const project: ProjectJson = {
    id: randomUUID(),
    name: name.trim() || '未命名存档',
    description,
    createdAt: now,
    updatedAt: now,
    appVersion: APP_VERSION
  };

  mkdirSync(join(vaultPath, 'assets', 'characters'), { recursive: true });
  mkdirSync(join(vaultPath, 'assets', 'maps'), { recursive: true });
  mkdirSync(join(vaultPath, 'assets', 'gallery'), { recursive: true });
  mkdirSync(join(vaultPath, 'assets', 'drafts'), { recursive: true });
  mkdirSync(join(vaultPath, 'exports'), { recursive: true });
  mkdirSync(join(vaultPath, 'backups'), { recursive: true });
  writeJsonAtomically(projectJsonPath(vaultPath), project);

  const { db } = openDatabase(worldDbPath(vaultPath));
  try {
    runMigrations(db);
    seedInitialData(db);
  } finally {
    db.close();
  }

  const vault = { ...project, path: vaultPath };
  addRecentVault(vault);
  return vault;
}

export function readRecentVaults(): VaultProject[] {
  const filePath = recentVaultsPath();
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const rows = JSON.parse(readFileSync(filePath, 'utf8')) as Array<{ path: string }>;
    const vaults = rows
      .filter((row) => row && typeof row.path === 'string')
      .map((row) => {
        try {
          return readProject(row.path);
        } catch {
          return null;
        }
      })
      .filter((row): row is VaultProject => row !== null);
    vaults.forEach((vault) => authorizeVaultPath(vault.path));
    return vaults;
  } catch (error) {
    console.error('读取最近存档失败', error);
    return [];
  }
}

export function addRecentVault(vault: VaultProject): void {
  authorizeVaultPath(vault.path);
  const existing = readRecentVaults().filter((item) => item.path !== vault.path);
  const next = [vault, ...existing].slice(0, 12).map((item) => ({ path: item.path }));
  writeJsonAtomically(recentVaultsPath(), next);
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const rollbackPath = `${filePath}.${randomUUID()}.previous`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  if (!existsSync(filePath)) {
    renameSync(tempPath, filePath);
    return;
  }
  renameSync(filePath, rollbackPath);
  try {
    renameSync(tempPath, filePath);
    rmSync(rollbackPath, { force: true });
  } catch (error) {
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    renameSync(rollbackPath, filePath);
    throw error;
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}
