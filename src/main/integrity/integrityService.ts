import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolveAssetPath } from '../assets/assetProtocol';
import { getLatestMigrationVersion } from '../db/migrations';
import { worldDbPath } from '../vault/vaultService';

type IssueSeverity = 'critical' | 'warning' | 'info';
type IssueCategory = 'project' | 'database' | 'schema' | 'asset' | 'reference';
type ReportStatus = 'healthy' | 'warning' | 'critical';

export interface IntegrityIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  entity?: {
    type: string;
    id: string;
    name: string;
  };
  relativePath?: string;
  suggestion: string;
}

export interface IntegrityReport {
  checkedAt: string;
  summary: {
    status: ReportStatus;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    checkedAssetCount: number;
  };
  issues: IntegrityIssue[];
}

interface SnapshotDatabase {
  db: DatabaseSync;
  cleanup: () => void;
}

interface ProjectJson {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface AssetRow {
  id: string;
  relativePath: string;
  deletedAt: string | null;
}

interface AssetCheckResult {
  safe: boolean;
  displayPath?: string;
  filePath?: string;
  reason?: string;
  exists?: boolean;
  isDirectory?: boolean;
}

interface ReferenceRow {
  entityType: 'character' | 'map';
  entityId: string;
  entityName: string;
  assetId: string;
  usageLabel: string;
}

const coreTables = [
  'characters',
  'character_versions',
  'codex_items',
  'events',
  'locations',
  'timelines',
  'maps',
  'manuscripts',
  'assets',
  'schema_migrations'
];

export async function checkVaultIntegrity(vaultPath: string): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const checkedAt = new Date().toISOString();
  let checkedAssetCount = 0;

  const project = checkProjectJson(vaultPath, issues);
  const dbPath = worldDbPath(vaultPath);
  if (!existsSync(dbPath)) {
    addIssue(issues, {
      severity: 'critical',
      category: 'database',
      message: '数据库文件 world.db 不存在，当前存档无法完整读取。',
      suggestion: '请从完整备份中恢复 world.db；修复前不建议继续编辑该存档。'
    });
    return finalizeReport(checkedAt, checkedAssetCount, issues);
  }

  let snapshot: SnapshotDatabase;
  try {
    snapshot = await openSnapshotDatabase(dbPath);
  } catch {
    addIssue(issues, {
      severity: 'critical',
      category: 'database',
      message: '数据库文件 world.db 无法只读打开，当前存档不建议继续编辑。',
      suggestion: '请先确认磁盘文件是否损坏，并优先从完整备份恢复可用数据库。'
    });
    return finalizeReport(checkedAt, checkedAssetCount, issues);
  }

  try {
    const databaseReady = checkDatabase(snapshot.db, issues);
    if (!databaseReady) {
      return finalizeReport(checkedAt, checkedAssetCount, issues);
    }
    checkedAssetCount = checkAssetsAndReferences(vaultPath, snapshot.db, issues);
    if (project) {
      addIssue(issues, {
        severity: 'info',
        category: 'project',
        message: `项目资料可读取：${project.name}`,
        suggestion: '无需处理。'
      });
    }
  } finally {
    snapshot.cleanup();
  }

  return finalizeReport(checkedAt, checkedAssetCount, issues);
}

async function openSnapshotDatabase(dbPath: string): Promise<SnapshotDatabase> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'manuscript-atlas-integrity-'));
  const snapshotPath = join(tempRoot, 'world-snapshot.db');
  let sourceDb: DatabaseSync | null = null;
  let snapshotDb: DatabaseSync | null = null;

  try {
    sourceDb = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=ro`, { readOnly: true } as any);
    await backup(sourceDb, snapshotPath);
    sourceDb.close();
    sourceDb = null;
    snapshotDb = new DatabaseSync(`${pathToFileURL(snapshotPath).href}?mode=ro&immutable=1`, { readOnly: true } as any);
    return {
      db: snapshotDb,
      cleanup: () => {
        snapshotDb?.close();
        snapshotDb = null;
        rmSync(tempRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (snapshotDb) {
      snapshotDb.close();
    }
    if (sourceDb) {
      sourceDb.close();
    }
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function checkProjectJson(vaultPath: string, issues: IntegrityIssue[]): ProjectJson | null {
  const projectPath = join(vaultPath, 'project.json');
  if (!existsSync(projectPath)) {
    addIssue(issues, {
      severity: 'critical',
      category: 'project',
      message: '项目资料文件 project.json 不存在，当前存档不建议继续编辑。',
      suggestion: '请先导出可用备份或从完整备份中恢复 project.json。'
    });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(projectPath, 'utf8'));
  } catch {
    addIssue(issues, {
      severity: 'critical',
      category: 'project',
      message: '项目资料文件 project.json 无法读取，当前存档不建议继续编辑。',
      suggestion: '请先导出可用备份或检查磁盘文件。'
    });
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    addIssue(issues, {
      severity: 'critical',
      category: 'project',
      message: 'project.json 内容不是有效对象。',
      suggestion: '请从完整备份中恢复有效的 project.json。'
    });
    return null;
  }

  const project = parsed as Partial<ProjectJson>;
  const checks: Array<[keyof ProjectJson, string]> = [
    ['id', 'project.json 缺少有效 id。'],
    ['name', 'project.json 缺少有效 name。']
  ];
  for (const [key, message] of checks) {
    if (typeof project[key] !== 'string' || !project[key]?.trim()) {
      addIssue(issues, {
        severity: 'critical',
        category: 'project',
        message,
        suggestion: '请从完整备份中恢复项目资料文件，或在确认风险后手动修复 project.json。'
      });
    }
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (typeof project[key] !== 'string' || !Number.isFinite(Date.parse(project[key] ?? ''))) {
      addIssue(issues, {
        severity: 'critical',
        category: 'project',
        message: `project.json 的 ${key} 不是有效时间。`,
        suggestion: '请从完整备份中恢复项目资料文件，或在确认风险后手动修复时间字段。'
      });
    }
  }

  if (issues.some((issue) => issue.category === 'project' && issue.severity === 'critical')) {
    return null;
  }
  return project as ProjectJson;
}

function checkDatabase(db: DatabaseSync, issues: IntegrityIssue[]): boolean {
  try {
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
    const values = integrityRows.flatMap((row) => Object.values(row).map(String));
    if (values.length === 0 || values.some((value) => value !== 'ok')) {
      addIssue(issues, {
        severity: 'critical',
        category: 'database',
        message: '数据库完整性检查未返回 ok，world.db 可能已经损坏。',
        suggestion: '请优先从完整备份恢复数据库；修复前不建议继续编辑该存档。'
      });
      return false;
    }
  } catch {
    addIssue(issues, {
      severity: 'critical',
      category: 'database',
      message: '数据库完整性检查无法执行，world.db 可能不是有效 SQLite 数据库。',
      suggestion: '请从完整备份恢复可用数据库，或检查磁盘文件是否损坏。'
    });
    return false;
  }

  try {
    const foreignKeyRows = db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
    if (foreignKeyRows.length > 0) {
      addIssue(issues, {
        severity: 'warning',
        category: 'database',
        message: `数据库外键检查发现 ${foreignKeyRows.length} 条异常关系。`,
        suggestion: '请先备份当前存档，再人工核对相关数据引用。'
      });
    }
  } catch {
    addIssue(issues, {
      severity: 'warning',
      category: 'database',
      message: '数据库外键检查无法执行。',
      suggestion: '请确认数据库结构是否完整；如近期恢复过备份，建议重新运行完整性检查。'
    });
  }

  const tableSet = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
  );
  if (!tableSet.has('schema_migrations')) {
    addIssue(issues, {
      severity: 'critical',
      category: 'schema',
      message: '数据库缺少 schema_migrations 表。',
      suggestion: '请从完整备份恢复数据库；不要在当前存档上继续写入新资料。'
    });
    return false;
  }

  for (const tableName of coreTables) {
    if (!tableSet.has(tableName)) {
      addIssue(issues, {
        severity: 'critical',
        category: 'schema',
        message: `数据库缺少核心表：${tableName}。`,
        suggestion: '请从完整备份恢复数据库，或联系维护者人工检查该存档。'
      });
    }
  }
  if (issues.some((issue) => issue.category === 'schema' && issue.severity === 'critical')) {
    return false;
  }

  try {
    const migrationRow = db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations').get() as { version: number } | undefined;
    const currentVersion = Number(migrationRow?.version ?? Number.NaN);
    const latestVersion = getLatestMigrationVersion();
    if (!Number.isFinite(currentVersion)) {
      addIssue(issues, {
        severity: 'critical',
        category: 'schema',
        message: '无法读取当前数据库 migration 版本。',
        suggestion: '请从完整备份恢复数据库，或人工检查 schema_migrations 表。'
      });
      return false;
    }
    if (currentVersion > latestVersion) {
      addIssue(issues, {
        severity: 'critical',
        category: 'schema',
        message: `数据库 migration 版本 ${currentVersion} 高于当前应用支持的 ${latestVersion}。`,
        suggestion: '请使用创建该存档的较新版本应用打开，避免旧版本继续写入。'
      });
    } else if (currentVersion < latestVersion) {
      addIssue(issues, {
        severity: 'warning',
        category: 'schema',
        message: `数据库 migration 版本 ${currentVersion} 低于当前应用支持的 ${latestVersion}，本次检查不会自动升级。`,
        suggestion: '请通过正常打开存档流程完成升级；完整性检查本身不会写入数据库。'
      });
    } else {
      addIssue(issues, {
        severity: 'info',
        category: 'schema',
        message: `数据库 schema 版本为 ${currentVersion}，与当前应用支持版本一致。`,
        suggestion: '无需处理。'
      });
    }
  } catch {
    addIssue(issues, {
      severity: 'critical',
      category: 'schema',
      message: '读取 schema_migrations 时发生错误。',
      suggestion: '请从完整备份恢复数据库，或人工检查 schema_migrations 表。'
    });
    return false;
  }

  addIssue(issues, {
    severity: 'info',
    category: 'database',
    message: '数据库文件可只读打开，完整性检查返回 ok。',
    suggestion: '无需处理。'
  });
  return !issues.some((issue) => issue.severity === 'critical' && (issue.category === 'database' || issue.category === 'schema'));
}

function checkAssetsAndReferences(vaultPath: string, db: DatabaseSync, issues: IntegrityIssue[]): number {
  const activeAssets = readAssetRows(db, 'WHERE deleted_at IS NULL');
  const allAssets = readAssetRows(db, '');
  const activeAssetMap = new Map(activeAssets.map((asset) => [asset.id, asset]));
  const allAssetMap = new Map(allAssets.map((asset) => [asset.id, asset]));
  const references = readKnownReferences(db);
  const referencedAssetIds = new Set(references.map((reference) => reference.assetId));

  for (const asset of activeAssets) {
    const pathCheck = checkAssetPath(vaultPath, asset.relativePath);
    const isReferenced = referencedAssetIds.has(asset.id);
    if (!pathCheck.safe) {
      addIssue(issues, {
        severity: isReferenced ? 'critical' : 'warning',
        category: 'asset',
        message: isReferenced ? '被当前实体引用的素材路径不安全。' : '素材库中存在未引用但路径不安全的素材记录。',
        relativePath: pathCheck.displayPath,
        suggestion: isReferenced ? '请先从完整备份核对该素材记录，修复前不要删除相关实体引用。' : '该素材当前未被已知实体引用；建议备份后人工核对素材记录。'
      });
      continue;
    }
    if (!pathCheck.exists) {
      addIssue(issues, {
        severity: isReferenced ? 'critical' : 'warning',
        category: 'asset',
        message: isReferenced ? '被当前实体引用的素材文件不存在。' : '素材库中存在未引用但文件缺失的素材记录。',
        relativePath: pathCheck.displayPath,
        suggestion: isReferenced ? '请从原始存档或完整备份中恢复该图片；修复前不要删除该素材记录。' : '该素材当前未被已知实体引用；如仍需保留，请从备份中找回文件。'
      });
      continue;
    }
    if (pathCheck.isDirectory) {
      addIssue(issues, {
        severity: 'warning',
        category: 'asset',
        message: '素材记录指向的是目录，而不是文件。',
        relativePath: pathCheck.displayPath,
        suggestion: '请备份后人工核对该素材记录对应的文件路径。'
      });
      continue;
    }
    if (!isReferenced) {
      addIssue(issues, {
        severity: 'info',
        category: 'asset',
        message: '素材库中存在当前未被已知实体引用的正常素材。',
        relativePath: pathCheck.displayPath,
        suggestion: '无需处理；未使用素材可以作为素材库内容保留。'
      });
    }
  }

  for (const reference of references) {
    checkReference(vaultPath, reference, allAssetMap, activeAssetMap, issues);
  }
  checkOrphanAssetFiles(vaultPath, allAssets, issues);
  return activeAssets.length;
}

function readAssetRows(db: DatabaseSync, whereClause: string): AssetRow[] {
  return db.prepare(`
    SELECT id, relative_path as relativePath, deleted_at as deletedAt
    FROM assets
    ${whereClause}
  `).all() as unknown as AssetRow[];
}

function readKnownReferences(db: DatabaseSync): ReferenceRow[] {
  const references: ReferenceRow[] = [];
  const characters = db.prepare(`
    SELECT id, name, avatar_asset_id as avatarAssetId, full_body_asset_id as fullBodyAssetId
    FROM characters
    WHERE deleted_at IS NULL
      AND (avatar_asset_id IS NOT NULL OR full_body_asset_id IS NOT NULL)
  `).all() as Array<{ id: string; name: string; avatarAssetId: string | null; fullBodyAssetId: string | null }>;

  for (const character of characters) {
    if (character.avatarAssetId) {
      references.push({
        entityType: 'character',
        entityId: character.id,
        entityName: character.name || character.id,
        assetId: character.avatarAssetId,
        usageLabel: '头像素材'
      });
    }
    if (character.fullBodyAssetId) {
      references.push({
        entityType: 'character',
        entityId: character.id,
        entityName: character.name || character.id,
        assetId: character.fullBodyAssetId,
        usageLabel: '立绘素材'
      });
    }
  }

  const maps = db.prepare(`
    SELECT id, COALESCE(NULLIF(title, ''), name) as title, background_asset_id as backgroundAssetId
    FROM maps
    WHERE deleted_at IS NULL AND background_asset_id IS NOT NULL
  `).all() as Array<{ id: string; title: string; backgroundAssetId: string | null }>;

  for (const map of maps) {
    if (map.backgroundAssetId) {
      references.push({
        entityType: 'map',
        entityId: map.id,
        entityName: map.title || map.id,
        assetId: map.backgroundAssetId,
        usageLabel: '底图素材'
      });
    }
  }
  return references;
}

function checkReference(
  vaultPath: string,
  reference: ReferenceRow,
  allAssetMap: Map<string, AssetRow>,
  activeAssetMap: Map<string, AssetRow>,
  issues: IntegrityIssue[]
): void {
  const anyAsset = allAssetMap.get(reference.assetId);
  const activeAsset = activeAssetMap.get(reference.assetId);
  if (!anyAsset) {
    addIssue(issues, {
      severity: 'critical',
      category: 'reference',
      message: `${entityPrefix(reference)}引用的${reference.usageLabel}记录不存在。`,
      entity: entityFor(reference),
      suggestion: '请从完整备份中恢复该素材记录，或在确认风险后重新绑定素材。'
    });
    return;
  }
  if (!activeAsset) {
    addIssue(issues, {
      severity: 'critical',
      category: 'reference',
      message: `${entityPrefix(reference)}引用的${reference.usageLabel}已经被标记删除。`,
      entity: entityFor(reference),
      relativePath: safeDisplayPath(anyAsset.relativePath),
      suggestion: '请先核对完整备份；修复前不要永久删除该素材记录。'
    });
    return;
  }

  const pathCheck = checkAssetPath(vaultPath, activeAsset.relativePath);
  if (!pathCheck.safe) {
    addIssue(issues, {
      severity: 'critical',
      category: 'reference',
      message: `${entityPrefix(reference)}引用的${reference.usageLabel}路径不安全。`,
      entity: entityFor(reference),
      relativePath: pathCheck.displayPath,
      suggestion: '请从原始存档或完整备份中核对该素材路径；修复前不要继续编辑相关实体。'
    });
    return;
  }
  if (!pathCheck.exists) {
    addIssue(issues, {
      severity: 'critical',
      category: 'reference',
      message: `${entityPrefix(reference)}的${reference.usageLabel}文件不存在。`,
      entity: entityFor(reference),
      relativePath: pathCheck.displayPath,
      suggestion: '请从原始存档或完整备份中恢复该图片；修复前不要删除该角色或地图的素材记录。'
    });
    return;
  }
  if (pathCheck.isDirectory) {
    addIssue(issues, {
      severity: 'critical',
      category: 'reference',
      message: `${entityPrefix(reference)}引用的${reference.usageLabel}指向目录而不是文件。`,
      entity: entityFor(reference),
      relativePath: pathCheck.displayPath,
      suggestion: '请从完整备份中恢复正确图片文件，或重新绑定有效素材。'
    });
  }
}

function checkAssetPath(vaultPath: string, relativePath: string): AssetCheckResult {
  const displayPath = safeDisplayPath(relativePath);
  if (!relativePath || isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return { safe: false, displayPath, reason: 'invalid' };
  }
  const normalized = normalize(relativePath);
  if (normalized.split(/[\\/]+/).includes('..')) {
    return { safe: false, displayPath, reason: 'traversal' };
  }
  let filePath = '';
  try {
    filePath = resolveAssetPath(vaultPath, relativePath);
  } catch {
    return { safe: false, displayPath, reason: 'outside-assets' };
  }
  const assetsRoot = resolve(vaultPath, 'assets');
  const distance = relative(assetsRoot, filePath);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    return { safe: false, displayPath, reason: 'outside-assets' };
  }
  if (!existsSync(filePath)) {
    return { safe: true, displayPath, filePath, exists: false };
  }
  const stat = statSync(filePath);
  return {
    safe: true,
    displayPath,
    filePath,
    exists: true,
    isDirectory: stat.isDirectory()
  };
}

function checkOrphanAssetFiles(vaultPath: string, allAssets: AssetRow[], issues: IntegrityIssue[]): void {
  const assetsRoot = join(vaultPath, 'assets');
  if (!existsSync(assetsRoot)) {
    addIssue(issues, {
      severity: 'critical',
      category: 'asset',
      message: 'assets 文件夹不存在，图片素材无法正常读取。',
      suggestion: '请从完整备份中恢复 assets 文件夹。'
    });
    return;
  }

  const knownPaths = new Set(allAssets.map((asset) => normalizeSlashes(asset.relativePath)));
  for (const filePath of walkAssetFiles(assetsRoot)) {
    const relativePath = normalizeSlashes(relative(vaultPath, filePath));
    if (!knownPaths.has(relativePath)) {
      addIssue(issues, {
        severity: 'info',
        category: 'asset',
        message: 'assets 文件夹中存在没有 assets 表记录的文件。',
        relativePath,
        suggestion: '无需自动处理；如确认不再需要，可在备份后人工整理素材文件。'
      });
    }
  }
}

function walkAssetFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkAssetFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function finalizeReport(checkedAt: string, checkedAssetCount: number, issues: IntegrityIssue[]): IntegrityReport {
  const sortedIssues = issues.sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const criticalCount = sortedIssues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = sortedIssues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = sortedIssues.filter((issue) => issue.severity === 'info').length;
  const status: ReportStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';
  return {
    checkedAt,
    summary: {
      status,
      criticalCount,
      warningCount,
      infoCount,
      checkedAssetCount
    },
    issues: sortedIssues
  };
}

function addIssue(issues: IntegrityIssue[], issue: Omit<IntegrityIssue, 'id'>): void {
  const signature = [
    issue.severity,
    issue.category,
    issue.message,
    issue.entity?.type ?? '',
    issue.entity?.id ?? '',
    issue.relativePath ?? ''
  ].join('|');
  if (issues.some((existing) => existing.id === issueId(signature))) {
    return;
  }
  issues.push({
    id: issueId(signature),
    ...issue
  });
}

function issueId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `integrity-${hash.toString(16).padStart(8, '0')}`;
}

function severityRank(severity: IssueSeverity): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function entityFor(reference: ReferenceRow): IntegrityIssue['entity'] {
  return {
    type: reference.entityType,
    id: reference.entityId,
    name: reference.entityName
  };
}

function entityPrefix(reference: ReferenceRow): string {
  return reference.entityType === 'character' ? `角色「${reference.entityName}」` : `地图「${reference.entityName}」`;
}

function safeDisplayPath(value: string): string {
  if (!value || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return '检测到不安全素材路径';
  }
  return normalizeSlashes(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}
