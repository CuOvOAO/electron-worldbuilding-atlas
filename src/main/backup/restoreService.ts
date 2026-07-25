import { randomUUID, createHash } from 'node:crypto';
import {
  copyFileSync,
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import * as yauzl from 'yauzl';
import { assertDatabaseIntegrity } from '../db/integrityChecks';
import { getLatestMigrationVersion } from '../db/migrations';
import { addRecentVault, ensureVaultReady, readProject, readRecentVaults, safeFolderName, type VaultProject, worldDbPath } from '../vault/vaultService';
import { type BackupManifest, validateReferencedAssetsForVault } from './backupService';

const backupExtension = '.manuscript-atlas-backup.zip';
const maxEntries = 20_000;
const maxSingleUncompressedSize = 512 * 1024 * 1024;
const maxTotalUncompressedSize = 2 * 1024 * 1024 * 1024;
const zipOptions: yauzl.Options = {
  lazyEntries: true,
  validateEntrySizes: true,
  strictFileNames: true
};
const requiredVaultDirs = [
  join('assets'),
  join('assets', 'characters'),
  join('assets', 'maps'),
  join('assets', 'gallery'),
  join('assets', 'drafts'),
  join('assets', 'images'),
  'exports',
  'backups'
];

export interface RestoreArchivePreview {
  originalVaultId: string;
  originalVaultName: string;
  createdAt: string;
  appVersion: string;
  schemaMigrationVersion: number;
  assetCount: number;
  fileCount: number;
}

export interface RestoreInspectionResult {
  archivePath: string;
  preview: RestoreArchivePreview;
}

export interface RestoreAsNewVaultInput {
  archivePath: string;
  targetParentDir: string;
  newVaultName: string;
}

export interface RestoreAsNewVaultResult {
  vault: VaultProject;
  warning?: string;
}

interface ZipEntryInfo {
  path: string;
  isDirectory: boolean;
  uncompressedSize: number;
}

interface ValidatedArchive {
  tempRoot: string;
  vaultDir: string;
  manifest: BackupManifest;
  project: VaultProject;
  preview: RestoreArchivePreview;
}

interface ProjectJson {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
}

export async function inspectRestoreArchive(archivePath: string): Promise<RestoreInspectionResult> {
  const inspected = await extractAndValidateArchive(archivePath);
  try {
    return {
      archivePath,
      preview: inspected.preview
    };
  } finally {
    cleanupPath(inspected.tempRoot);
  }
}

export async function restoreAsNewVault(input: RestoreAsNewVaultInput, appVersion: string): Promise<RestoreAsNewVaultResult> {
  const inspected = await extractAndValidateArchive(input.archivePath);
  let stagingPath = '';
  let finalPath = '';

  try {
    assertFreeDiskSpace(
      input.targetParentDir,
      inspected.manifest.files.reduce((total, file) => total + file.size, 0),
      '无法恢复'
    );
    const target = prepareRestoreTarget(input, inspected.project);
    stagingPath = target.stagingPath;
    finalPath = target.finalPath;

    copyDirectory(inspected.vaultDir, stagingPath);
    ensureRequiredVaultDirs(stagingPath);
    rewriteProjectJson(stagingPath, {
      ...inspected.project,
      id: randomUUID(),
      name: input.newVaultName.trim(),
      updatedAt: new Date().toISOString(),
      appVersion
    });

    const vault = ensureVaultReady(stagingPath);
    renameSync(stagingPath, finalPath);

    const restoredVault = { ...vault, path: finalPath };
    try {
      addRecentVault(restoredVault);
      return { vault: restoredVault };
    } catch (error) {
      return {
        vault: restoredVault,
        warning: `存档已恢复，但写入最近存档列表失败：${readableError(error)}`
      };
    }
  } catch (error) {
    if (stagingPath && existsSync(stagingPath)) {
      cleanupPath(stagingPath);
    }
    throw error;
  } finally {
    cleanupPath(inspected.tempRoot);
    if (stagingPath && existsSync(stagingPath) && (!finalPath || resolve(stagingPath) !== resolve(finalPath))) {
      cleanupPath(stagingPath);
    }
  }
}

async function extractAndValidateArchive(archivePath: string): Promise<ValidatedArchive> {
  assertBackupArchivePath(archivePath);
  const entryInfos = await readAndValidateZipEntries(archivePath);
  const tempRoot = mkdtempSync(join(tmpdir(), 'manuscript-atlas-restore-'));
  try {
    await extractValidatedZip(archivePath, tempRoot, entryInfos);
    const manifest = readManifest(tempRoot);
    const project = readAndValidateProject(tempRoot, manifest);
    validateManifestFiles(tempRoot, manifest, entryInfos);
    validateDatabase(join(tempRoot, 'vault'), manifest);
    validateReferencedAssets(tempRoot);
    return {
      tempRoot,
      vaultDir: join(tempRoot, 'vault'),
      manifest,
      project,
      preview: {
        originalVaultId: manifest.vault.id,
        originalVaultName: manifest.vault.name,
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        schemaMigrationVersion: manifest.database.schemaMigrationVersion,
        assetCount: manifest.contents.assetCount,
        fileCount: manifest.contents.fileCount
      }
    };
  } catch (error) {
    cleanupPath(tempRoot);
    throw error;
  }
}

function assertBackupArchivePath(archivePath: string): void {
  const value = String(archivePath || '').trim();
  if (!value) {
    throw new Error('请选择完整备份 ZIP。');
  }
  if (!value.toLowerCase().endsWith(backupExtension)) {
    throw new Error(`请选择 ${backupExtension} 结尾的完整备份 ZIP。`);
  }
  if (!existsSync(value) || !statSync(value).isFile()) {
    throw new Error('完整备份 ZIP 不存在。');
  }
}

async function readAndValidateZipEntries(archivePath: string): Promise<ZipEntryInfo[]> {
  const zipFile = await yauzl.openPromise(archivePath, zipOptions);
  const entries: ZipEntryInfo[] = [];
  const seenFiles = new Set<string>();
  let totalUncompressedSize = 0;

  try {
    for await (const entry of zipFile.eachEntry()) {
      const info = validateZipEntry(entry, seenFiles);
      if (!info.isDirectory && info.uncompressedSize > maxSingleUncompressedSize) {
        throw new Error('无法恢复：ZIP 中存在超过 512 MB 的单个文件，已拒绝。');
      }
      entries.push(info);
      if (entries.length > maxEntries) {
        throw new Error(`无法恢复：ZIP 文件条目超过 ${maxEntries} 个，已拒绝。`);
      }
      totalUncompressedSize += info.uncompressedSize;
      if (totalUncompressedSize > maxTotalUncompressedSize) {
        throw new Error('无法恢复：ZIP 解压后体积超过 2 GB，已拒绝。');
      }
    }
  } catch (error) {
    throw normalizeZipReadError(error);
  } finally {
    zipFile.close();
  }

  const fileSet = new Set(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.path));
  if (!fileSet.has('manifest.json')) {
    throw new Error('无法恢复：备份包缺少 manifest.json。');
  }
  if (!fileSet.has('vault/project.json')) {
    throw new Error('无法恢复：备份包缺少 vault/project.json。');
  }
  if (!fileSet.has('vault/world.db')) {
    throw new Error('无法恢复：备份包缺少 vault/world.db。');
  }
  return entries;
}

function validateZipEntry(entry: yauzl.Entry, seenFiles: Set<string>): ZipEntryInfo {
  const entryPath = entry.fileName;
  if (!entryPath || entryPath.includes('\\')) {
    throw new Error(`无法恢复：ZIP 含有不安全路径：${entryPath || '(空)'}`);
  }
  if (entryPath.startsWith('/') || entryPath.startsWith('//') || /^[A-Za-z]:/.test(entryPath)) {
    throw new Error(`无法恢复：ZIP 含有绝对路径：${entryPath}`);
  }
  const isDirectory = entryPath.endsWith('/');
  const normalized = normalizeZipPath(entryPath, isDirectory);
  if (normalized !== entryPath || hasUnsafeZipSegments(entryPath, isDirectory)) {
    throw new Error(`无法恢复：ZIP 含有不安全路径：${entryPath}`);
  }
  if (isSymlinkEntry(entry)) {
    throw new Error(`无法恢复：ZIP 含有符号链接，已拒绝：${entryPath}`);
  }
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new Error(`无法恢复：ZIP 条目无法安全读取：${entryPath}`);
  }
  if (isDirectory) {
    if (!isAllowedDirectory(entryPath)) {
      throw new Error(`无法恢复：备份包包含不允许的目录：${entryPath}`);
    }
  } else {
    if (!isAllowedPayloadFile(entryPath)) {
      throw new Error(`无法恢复：备份包包含不允许的文件：${entryPath}`);
    }
    if (seenFiles.has(entryPath)) {
      throw new Error(`无法恢复：备份包包含重复文件：${entryPath}`);
    }
    seenFiles.add(entryPath);
  }
  return {
    path: entryPath,
    isDirectory,
    uncompressedSize: entry.uncompressedSize
  };
}

function normalizeZipPath(value: string, isDirectory: boolean): string {
  const normalized = value.split('/').filter(Boolean).join('/');
  const posixNormalized = value.replace(/\/+/g, '/').replace(/^\.\//, '');
  if (normalized !== posixNormalized.replace(/\/$/, '')) {
    return value;
  }
  return isDirectory ? `${normalized}/` : normalized;
}

function hasUnsafeZipSegments(value: string, isDirectory: boolean): boolean {
  if (!isDirectory && value.endsWith('/')) {
    return true;
  }
  const segments = value.split('/');
  if (isDirectory) {
    segments.pop();
  }
  return segments.some((segment) => !segment || segment === '.' || segment === '..');
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

function isAllowedDirectory(pathInZip: string): boolean {
  return pathInZip === 'vault/' || pathInZip === 'vault/assets/' || pathInZip.startsWith('vault/assets/');
}

function isAllowedPayloadFile(pathInZip: string): boolean {
  return pathInZip === 'manifest.json' || pathInZip === 'vault/project.json' || pathInZip === 'vault/world.db' || pathInZip.startsWith('vault/assets/');
}

async function extractValidatedZip(archivePath: string, tempRoot: string, entryInfos: ZipEntryInfo[]): Promise<void> {
  const allowedEntries = new Map(entryInfos.map((entry) => [entry.path, entry]));
  const zipFile = await yauzl.openPromise(archivePath, zipOptions);
  try {
    for await (const entry of zipFile.eachEntry()) {
      const info = allowedEntries.get(entry.fileName);
      if (!info) {
        throw new Error(`无法恢复：ZIP 条目校验状态丢失：${entry.fileName}`);
      }
      const targetPath = resolveZipTarget(tempRoot, info.path);
      if (info.isDirectory) {
        mkdirSync(targetPath, { recursive: true });
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      const stream = await zipFile.openReadStreamPromise(entry);
      await pipeline(stream, createWriteStream(targetPath));
    }
  } catch (error) {
    throw normalizeZipReadError(error);
  } finally {
    zipFile.close();
  }
}

function resolveZipTarget(tempRoot: string, pathInZip: string): string {
  const target = resolve(tempRoot, ...pathInZip.split('/'));
  const distance = relative(resolve(tempRoot), target);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    throw new Error(`无法恢复：ZIP 含有不安全路径：${pathInZip}`);
  }
  return target;
}

function readManifest(tempRoot: string): BackupManifest {
  const manifestPath = join(tempRoot, 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法恢复：manifest.json 无法解析：${readableError(error)}`);
  }
  assertManifest(parsed);
  return parsed;
}

function assertManifest(value: unknown): asserts value is BackupManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('无法恢复：manifest.json 内容不是有效对象。');
  }
  const manifest = value as Partial<BackupManifest>;
  if (manifest.format !== 'manuscript-atlas-backup') {
    throw new Error('无法恢复：manifest 格式不受支持。');
  }
  if (manifest.formatVersion !== 1) {
    throw new Error('无法恢复：manifest 版本不受支持。');
  }
  if (!isParseableDate(manifest.createdAt)) {
    throw new Error('无法恢复：manifest.createdAt 无效。');
  }
  if (!manifest.vault || typeof manifest.vault.id !== 'string' || !manifest.vault.id.trim() || typeof manifest.vault.name !== 'string' || !manifest.vault.name.trim()) {
    throw new Error('无法恢复：manifest.vault 信息不完整。');
  }
  if (typeof manifest.appVersion !== 'string') {
    throw new Error('无法恢复：manifest.appVersion 无效。');
  }
  if (
    !manifest.database ||
    manifest.database.file !== 'vault/world.db' ||
    manifest.database.snapshotStrategy !== 'wal-checkpoint-truncate' ||
    !Number.isInteger(manifest.database.schemaMigrationVersion)
  ) {
    throw new Error('无法恢复：manifest.database 信息不完整或不受支持。');
  }
  if (!manifest.contents || manifest.contents.projectFile !== 'vault/project.json' || !Number.isInteger(manifest.contents.assetCount) || !Number.isInteger(manifest.contents.fileCount)) {
    throw new Error('无法恢复：manifest.contents 信息不完整。');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('无法恢复：manifest.files 不是有效数组。');
  }
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') {
      throw new Error('无法恢复：manifest.files 包含无效条目。');
    }
    const item = file as BackupManifest['files'][number];
    if (
      typeof item.path !== 'string' ||
      !item.path ||
      item.path.includes('\\') ||
      item.path === 'manifest.json' ||
      normalizeZipPath(item.path, false) !== item.path ||
      hasUnsafeZipSegments(item.path, false) ||
      !isAllowedPayloadFile(item.path)
    ) {
      throw new Error(`无法恢复：manifest.files 包含不安全路径：${item.path || '(空)'}`);
    }
    if (!Number.isFinite(item.size) || item.size < 0 || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
      throw new Error(`无法恢复：manifest.files 校验信息无效：${item.path}`);
    }
    if (seen.has(item.path)) {
      throw new Error(`无法恢复：manifest.files 包含重复路径：${item.path}`);
    }
    seen.add(item.path);
  }
}

function readAndValidateProject(tempRoot: string, manifest: BackupManifest): VaultProject {
  let project: VaultProject;
  try {
    project = readProject(join(tempRoot, 'vault'));
  } catch (error) {
    throw new Error(`无法恢复：project.json 无法解析：${readableError(error)}`);
  }
  if (!project.id.trim() || !project.name.trim()) {
    throw new Error('无法恢复：project.json 缺少 id 或 name。');
  }
  if (!isParseableDate(project.createdAt) || !isParseableDate(project.updatedAt)) {
    throw new Error('无法恢复：project.json 时间字段无效。');
  }
  if (project.id !== manifest.vault.id) {
    throw new Error('无法恢复：project.json id 与 manifest 不一致。');
  }
  if (project.name !== manifest.vault.name) {
    throw new Error('无法恢复：project.json name 与 manifest 不一致。');
  }
  return project;
}

function validateManifestFiles(tempRoot: string, manifest: BackupManifest, entryInfos: ZipEntryInfo[]): void {
  const manifestFileSet = new Set(manifest.files.map((file) => file.path));
  const zipPayloadFiles = entryInfos.filter((entry) => !entry.isDirectory && entry.path !== 'manifest.json').map((entry) => entry.path).sort();
  const manifestPayloadFiles = [...manifestFileSet].sort();
  if (manifest.contents.fileCount !== manifest.files.length) {
    throw new Error('无法恢复：manifest.contents.fileCount 与 files 数量不一致。');
  }
  if (manifest.contents.assetCount !== manifest.files.filter((file) => file.path.startsWith('vault/assets/')).length) {
    throw new Error('无法恢复：manifest.contents.assetCount 与资产文件数量不一致。');
  }
  if (zipPayloadFiles.join('\n') !== manifestPayloadFiles.join('\n')) {
    throw new Error('无法恢复：ZIP 文件集合与 manifest.files 不一致。');
  }
  for (const file of manifest.files) {
    const filePath = join(tempRoot, ...file.path.split('/'));
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`无法恢复：manifest 声明的文件不存在：${file.path}`);
    }
    const stat = statSync(filePath);
    if (stat.size !== file.size) {
      throw new Error(`无法恢复：文件大小与 manifest 不一致：${file.path}`);
    }
    if (sha256File(filePath) !== file.sha256) {
      throw new Error(`无法恢复：文件校验和与 manifest 不一致：${file.path}`);
    }
  }
}

function validateDatabase(vaultDir: string, manifest: BackupManifest): void {
  const dbPath = worldDbPath(vaultDir);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true } as any);
  } catch (error) {
    throw new Error(`无法恢复：world.db 无法只读打开：${readableError(error)}`);
  }

  try {
    assertDatabaseIntegrity(db, '无法恢复');
    const latestSupportedVersion = getLatestMigrationVersion();
    const schemaRow = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get() as { name: string } | undefined;
    if (!schemaRow) {
      throw new Error('schema_migrations 不存在。');
    }
    const migrationRow = db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations').get() as { version: number } | undefined;
    const schemaMigrationVersion = Number(migrationRow?.version ?? Number.NaN);
    if (!Number.isFinite(schemaMigrationVersion)) {
      throw new Error('schema_migrations 无法读取。');
    }
    if (schemaMigrationVersion > latestSupportedVersion) {
      throw new Error(`备份 schema 版本 ${schemaMigrationVersion} 高于当前应用支持的 ${latestSupportedVersion}。`);
    }
    if (manifest.database.schemaMigrationVersion !== schemaMigrationVersion) {
      throw new Error('manifest.database.schemaMigrationVersion 与 world.db 不一致。');
    }
    for (const tableName of ['characters', 'character_versions', 'codex_items', 'events', 'locations', 'timelines', 'maps', 'manuscripts', 'assets', 'schema_migrations']) {
      const table = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', tableName) as { name: string } | undefined;
      if (!table) {
        throw new Error(`核心表缺失：${tableName}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('无法恢复：')) {
      throw error;
    }
    throw new Error(`无法恢复：world.db 校验失败：${readableError(error)}`);
  } finally {
    db.close();
  }
}

function validateReferencedAssets(tempRoot: string): void {
  const vaultDir = join(tempRoot, 'vault');
  const db = new DatabaseSync(worldDbPath(vaultDir), { readOnly: true } as any);
  try {
    validateReferencedAssetsForVault(db, vaultDir, '无法恢复');
  } finally {
    db.close();
  }
}

function prepareRestoreTarget(input: RestoreAsNewVaultInput, originalProject: VaultProject): { finalPath: string; stagingPath: string } {
  const newVaultName = String(input.newVaultName || '').trim();
  const targetParentDir = String(input.targetParentDir || '').trim();
  if (!newVaultName) {
    throw new Error('请输入新存档名称。');
  }
  if (!targetParentDir) {
    throw new Error('请选择恢复位置。');
  }
  if (!existsSync(targetParentDir) || !statSync(targetParentDir).isDirectory()) {
    throw new Error('恢复位置不存在或不是文件夹。');
  }
  const parentPath = resolve(targetParentDir);
  const safeName = safeFolderName(newVaultName);
  const finalPath = resolve(parentPath, safeName);
  const distance = relative(parentPath, finalPath);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    throw new Error('恢复目标路径不安全。');
  }
  if (existsSync(finalPath)) {
    throw new Error('目标存档目录已存在，请更换名称或位置。');
  }
  if (isInsideOrSame(parentPath, resolve(tmpdir()))) {
    throw new Error('不能恢复到系统临时目录。');
  }
  const archiveDir = resolve(dirname(input.archivePath));
  if (isInsideOrSame(parentPath, archiveDir) && basename(finalPath) === safeFolderName(originalProject.name)) {
    throw new Error('不能把备份恢复到疑似原存档目录。');
  }
  for (const vault of readRecentVaults()) {
    const recentPath = resolve(vault.path);
    if (isInsideOrSame(finalPath, recentPath)) {
      throw new Error(`不能恢复到已有存档内部：${vault.name}`);
    }
  }
  const stagingPath = resolve(parentPath, `.${safeName}.restore-${randomUUID()}.incomplete`);
  if (existsSync(stagingPath)) {
    throw new Error('恢复临时目录已存在，请稍后重试。');
  }
  return { finalPath, stagingPath };
}

function rewriteProjectJson(vaultPath: string, project: ProjectJson): void {
  writeFileSync(join(vaultPath, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
}

function ensureRequiredVaultDirs(vaultPath: string): void {
  for (const directory of requiredVaultDirs) {
    mkdirSync(join(vaultPath, directory), { recursive: true });
  }
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
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

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(filePath, 'r');
  try {
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function assertFreeDiskSpace(targetDirectory: string, payloadBytes: number, prefix: string): void {
  const stats = statfsSync(targetDirectory, { bigint: true });
  const availableBytes = stats.bavail * stats.bsize;
  const requiredBytes = BigInt(payloadBytes + 64 * 1024 * 1024);
  if (availableBytes < requiredBytes) {
    throw new Error(`${prefix}：目标磁盘可用空间不足，至少需要约 ${Math.ceil(Number(requiredBytes) / 1024 / 1024)} MB。`);
  }
}

function isInsideOrSame(candidatePath: string, parentPath: string): boolean {
  const candidate = ensureTrailingSeparator(resolve(candidatePath));
  const parent = ensureTrailingSeparator(resolve(parentPath));
  return candidate === parent || candidate.startsWith(parent);
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(sep) ? value : `${value}${sep}`;
}

function isParseableDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function cleanupPath(targetPath: string): void {
  if (targetPath && existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeZipReadError(error: unknown): Error {
  const message = readableError(error);
  if (/invalid relative path|absolute path|backslash/i.test(message)) {
    return new Error(`无法恢复：ZIP 含有不安全路径：${message}`);
  }
  return error instanceof Error ? error : new Error(message);
}
