import * as archiver from 'archiver';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readProject, worldDbPath } from '../vault/vaultService';

const checkpointErrorMessage = '数据库当前无法完成安全备份，请关闭可能同时打开该存档的其他程序后重试。';
const backupExtension = '.manuscript-atlas-backup.zip';
const ignoredNames = new Set(['.DS_Store', 'Thumbs.db']);

export interface FullBackupResult {
  filePath: string;
  fileName: string;
  size: number;
  assetCount: number;
  fileCount: number;
  manifest: BackupManifest;
}

interface BackupManifest {
  format: 'manuscript-atlas-backup';
  formatVersion: 1;
  createdAt: string;
  appVersion: string;
  vault: {
    id: string;
    name: string;
  };
  database: {
    file: 'vault/world.db';
    schemaMigrationVersion: number;
    snapshotStrategy: 'wal-checkpoint-truncate';
  };
  contents: {
    projectFile: 'vault/project.json';
    assetCount: number;
    fileCount: number;
  };
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

interface ValidationResult {
  project: ReturnType<typeof readProject>;
  schemaMigrationVersion: number;
}

interface SnapshotResult {
  payloadDir: string;
  projectFile: string;
  dbFile: string;
  assetsDir: string;
}

export function defaultBackupFileName(vaultName: string, date = new Date()): string {
  return `${safeFileName(vaultName || '未命名存档')}_${timestampForFile(date)}${backupExtension}`;
}

export function normalizeBackupTargetPath(targetPath: string): string {
  const trimmed = String(targetPath || '').trim();
  if (!trimmed) {
    throw new Error('请选择备份保存位置。');
  }
  return trimmed.toLowerCase().endsWith(backupExtension) ? trimmed : `${trimmed}${backupExtension}`;
}

export async function createFullVaultBackup(vaultPath: string, targetPath: string, appVersion: string): Promise<FullBackupResult> {
  const finalPath = normalizeBackupTargetPath(targetPath);
  const partialPath = `${finalPath}.partial`;
  let tempRoot = '';

  try {
    const validation = validateVaultForBackup(vaultPath);
    runSafeCheckpoint(vaultPath);
    tempRoot = createTempRoot();
    const snapshot = createSnapshot(vaultPath, tempRoot);
    const files = collectPayloadFiles(snapshot.payloadDir);
    const assetCount = files.filter((file) => file.path.startsWith('vault/assets/')).length;
    const manifest: BackupManifest = {
      format: 'manuscript-atlas-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      appVersion,
      vault: {
        id: validation.project.id,
        name: validation.project.name
      },
      database: {
        file: 'vault/world.db',
        schemaMigrationVersion: validation.schemaMigrationVersion,
        snapshotStrategy: 'wal-checkpoint-truncate'
      },
      contents: {
        projectFile: 'vault/project.json',
        assetCount,
        fileCount: files.length
      },
      files
    };

    writeManifest(snapshot.payloadDir, manifest);
    await writeZip(snapshot.payloadDir, partialPath);
    const partialSize = statSync(partialPath).size;
    if (partialSize <= 0) {
      throw new Error('备份文件生成失败：临时 ZIP 文件为空。');
    }
    if (existsSync(finalPath)) {
      rmSync(finalPath, { force: true });
    }
    renameSync(partialPath, finalPath);
    const size = statSync(finalPath).size;
    return {
      filePath: finalPath,
      fileName: basename(finalPath),
      size,
      assetCount,
      fileCount: files.length,
      manifest
    };
  } catch (error) {
    if (existsSync(partialPath)) {
      rmSync(partialPath, { force: true });
    }
    throw error;
  } finally {
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

export function validateVaultForBackup(vaultPath: string): ValidationResult {
  const projectJsonPath = join(vaultPath, 'project.json');
  const dbPath = worldDbPath(vaultPath);
  const assetsRoot = join(vaultPath, 'assets');

  if (!existsSync(projectJsonPath)) {
    throw new Error('无法创建备份：project.json 不存在。');
  }

  let project: ReturnType<typeof readProject>;
  try {
    project = readProject(vaultPath);
  } catch (error) {
    throw new Error(`无法创建备份：project.json 无法解析：${readableError(error)}`);
  }

  if (!existsSync(dbPath)) {
    throw new Error('无法创建备份：world.db 不存在。');
  }
  if (!existsSync(assetsRoot)) {
    throw new Error('无法创建备份：assets 根目录不存在。');
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (error) {
    throw new Error(`无法创建备份：world.db 无法打开：${readableError(error)}`);
  }

  try {
    const schemaRow = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get() as { name: string } | undefined;
    if (!schemaRow) {
      throw new Error('schema_migrations 不存在。');
    }
    const migrationRow = db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations').get() as { version: number } | undefined;
    if (!migrationRow || !Number.isFinite(Number(migrationRow.version))) {
      throw new Error('schema_migrations 无法读取。');
    }

    validateReferencedAssets(db, vaultPath);
    return {
      project,
      schemaMigrationVersion: Number(migrationRow.version)
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('无法创建备份：')) {
      throw error;
    }
    throw new Error(`无法创建备份：${readableError(error)}`);
  } finally {
    db.close();
  }
}

function validateReferencedAssets(db: DatabaseSync, vaultPath: string): void {
  const characterRows = db.prepare(`
    SELECT id, name, avatar_asset_id as avatarAssetId, full_body_asset_id as fullBodyAssetId
    FROM characters
    WHERE deleted_at IS NULL
      AND (avatar_asset_id IS NOT NULL OR full_body_asset_id IS NOT NULL)
  `).all() as Array<{ id: string; name: string; avatarAssetId: string | null; fullBodyAssetId: string | null }>;

  characterRows.forEach((character) => {
    if (character.avatarAssetId) {
      validateAssetReference(db, vaultPath, {
        assetId: character.avatarAssetId,
        entityLabel: `角色「${character.name || character.id}」`,
        usageLabel: '头像素材'
      });
    }
    if (character.fullBodyAssetId) {
      validateAssetReference(db, vaultPath, {
        assetId: character.fullBodyAssetId,
        entityLabel: `角色「${character.name || character.id}」`,
        usageLabel: '立绘素材'
      });
    }
  });

  const mapRows = db.prepare(`
    SELECT id, COALESCE(NULLIF(title, ''), name) as title, background_asset_id as backgroundAssetId
    FROM maps
    WHERE deleted_at IS NULL AND background_asset_id IS NOT NULL
  `).all() as Array<{ id: string; title: string; backgroundAssetId: string | null }>;

  mapRows.forEach((map) => {
    if (map.backgroundAssetId) {
      validateAssetReference(db, vaultPath, {
        assetId: map.backgroundAssetId,
        entityLabel: `地图「${map.title || map.id}」`,
        usageLabel: '底图素材'
      });
    }
  });
}

function validateAssetReference(
  db: DatabaseSync,
  vaultPath: string,
  input: { assetId: string; entityLabel: string; usageLabel: string }
): void {
  const asset = db.prepare(`
    SELECT id, relative_path as relativePath, deleted_at as deletedAt
    FROM assets
    WHERE id = ?
  `).get(input.assetId) as { id: string; relativePath: string; deletedAt: string | null } | undefined;

  if (!asset) {
    throw new Error(`无法创建备份：${input.entityLabel}引用的${input.usageLabel}记录不存在。`);
  }
  if (asset.deletedAt) {
    throw new Error(`无法创建备份：${input.entityLabel}引用的${input.usageLabel}已被删除：${asset.relativePath || input.assetId}`);
  }
  const filePath = resolveAssetPathForBackup(vaultPath, asset.relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`无法创建备份：${input.entityLabel}的${input.usageLabel}不存在：${asset.relativePath}`);
  }
}

function resolveAssetPathForBackup(vaultPath: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error(`素材路径无效：${relativePath || '(空)'}`);
  }
  const normalized = normalize(relativePath);
  if (normalized.split(/[\\/]+/).includes('..')) {
    throw new Error(`素材路径越界：${relativePath}`);
  }
  const assetsRoot = resolve(vaultPath, 'assets');
  const filePath = resolve(vaultPath, normalized);
  const distance = relative(assetsRoot, filePath);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    throw new Error(`素材路径越界：${relativePath}`);
  }
  return filePath;
}

function runSafeCheckpoint(vaultPath: string): void {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(worldDbPath(vaultPath));
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as Record<string, unknown> | undefined;
    const busy = Number(row?.busy ?? row?.[0] ?? 0);
    if (busy !== 0) {
      throw new Error(checkpointErrorMessage);
    }
  } catch (error) {
    if (error instanceof Error && error.message === checkpointErrorMessage) {
      throw error;
    }
    throw new Error(`${checkpointErrorMessage} ${readableError(error)}`);
  } finally {
    if (db) {
      db.close();
    }
  }
}

function createSnapshot(vaultPath: string, tempRoot: string): SnapshotResult {
  const payloadDir = join(tempRoot, 'payload');
  const vaultDir = join(payloadDir, 'vault');
  const assetsTarget = join(vaultDir, 'assets');
  mkdirSync(vaultDir, { recursive: true });

  const projectFile = join(vaultDir, 'project.json');
  const dbFile = join(vaultDir, 'world.db');
  copyFileSync(join(vaultPath, 'project.json'), projectFile);
  copyFileSync(worldDbPath(vaultPath), dbFile);
  copyDirectory(join(vaultPath, 'assets'), assetsTarget);

  return {
    payloadDir,
    projectFile,
    dbFile,
    assetsDir: assetsTarget
  };
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function collectPayloadFiles(payloadDir: string): BackupManifest['files'] {
  const files: BackupManifest['files'] = [];
  walkFiles(payloadDir, (filePath) => {
    const pathInZip = toZipPath(relative(payloadDir, filePath));
    if (pathInZip === 'manifest.json') {
      return;
    }
    if (!isPayloadFile(pathInZip)) {
      return;
    }
    const stat = statSync(filePath);
    files.push({
      path: pathInZip,
      size: stat.size,
      sha256: sha256File(filePath)
    });
  });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function isPayloadFile(pathInZip: string): boolean {
  return pathInZip === 'vault/project.json' || pathInZip === 'vault/world.db' || pathInZip.startsWith('vault/assets/');
}

function walkFiles(directory: string, onFile: (filePath: string) => void): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(filePath, onFile);
    } else if (entry.isFile()) {
      onFile(filePath);
    }
  }
}

function writeManifest(payloadDir: string, manifest: BackupManifest): void {
  const json = JSON.stringify(manifest, null, 2);
  if (/([A-Za-z]:\\|\\\\Users\\|\/Users\/)/.test(json)) {
    throw new Error('备份 manifest 生成失败：检测到绝对路径。');
  }
  mkdirSync(payloadDir, { recursive: true });
  copyTextFile(join(payloadDir, 'manifest.json'), `${json}\n`);
}

function copyTextFile(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function writeZip(payloadDir: string, partialPath: string): Promise<void> {
  mkdirSync(dirname(partialPath), { recursive: true });
  if (existsSync(partialPath)) {
    rmSync(partialPath, { force: true });
  }

  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(partialPath);
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolvePromise());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(payloadDir, false);
    archive.finalize().catch(reject);
  });
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const chunks = readFileSync(filePath);
  hash.update(chunks);
  return hash.digest('hex');
}

function createTempRoot(): string {
  const base = join(tmpdir(), 'manuscript-atlas-backup-');
  return mkdtempSync(base);
}

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ');
  return cleaned || '未命名存档';
}

function timestampForFile(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function toZipPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
