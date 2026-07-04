import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { ensureVaultReady, worldDbPath } from '../vault/vaultService';

interface ExportOptions {
  selectedCharacterIds: string[];
  selectedCodexItemIds: string[];
  selectedEventIds: string[];
  selectedLocationIds: string[];
  selectedTimelineIds: string[];
  selectedManuscriptIds: string[];
}

type Db = ReturnType<typeof openDatabase>['db'];

function withDb<T>(vaultPath: string, callback: (db: Db) => T): T {
  ensureVaultReady(vaultPath);
  const { db } = openDatabase(worldDbPath(vaultPath));
  try {
    runMigrations(db);
    return callback(db);
  } finally {
    db.close();
  }
}

export function registerExportIpc(): void {
  ipcMain.handle('export:summary', (_event, vaultPath: string) => {
    try {
      return { ok: true, summary: withDb(vaultPath, (db) => buildExportSummary(db)) };
    } catch (error) {
      console.error('读取导出条目失败', error);
      return { ok: false, error: readableExportError(error) };
    }
  });

  ipcMain.handle('export:markdown', async (event, vaultPath: string, options: ExportOptions) => {
    try {
      if (!hasSelectedContent(options)) {
        return { ok: false, error: '请选择要导出的内容。' };
      }

      const project = ensureVaultReady(vaultPath);
      const defaultPath = join(
        vaultPath,
        'exports',
        `${safeFileName(project.name || '世界观资料')}_世界观资料_${timestampForFile(new Date())}.md`
      );

      const saveOptions = {
        title: '导出 Markdown',
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      };
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions);

      if (result.canceled || !result.filePath) {
        return { ok: true, cancelled: true, success: false };
      }

      const markdown = withDb(vaultPath, (db) => buildMarkdown(db, project.name, options));
      if (!markdown.trim()) {
        return { ok: false, error: '没有可导出的内容。所选条目可能已被删除。' };
      }

      writeFileSync(result.filePath, markdown, 'utf8');
      return { ok: true, cancelled: false, success: true, filePath: result.filePath, fileName: basename(result.filePath) };
    } catch (error) {
      console.error('Markdown 导出失败', error);
      return { ok: false, error: readableExportError(error) };
    }
  });

  ipcMain.handle('export:mapPng', async (event, vaultPath: string, input: { title?: string; dataUrl?: string }) => {
    try {
      ensureVaultReady(vaultPath);
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(input.dataUrl || ''));
      if (!match) {
        return { ok: false, error: 'PNG 导出数据无效。' };
      }

      const title = safeFileName(String(input.title || '').trim() || '未命名地图');
      const saveOptions = {
        title: '导出地图 PNG',
        defaultPath: join(vaultPath, 'exports', `${title}.png`),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      };
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions);

      if (result.canceled || !result.filePath) {
        return { ok: true, cancelled: true, success: false };
      }

      const filePath = extname(result.filePath).toLowerCase() === '.png' ? result.filePath : `${result.filePath}.png`;
      writeFileSync(filePath, Buffer.from(match[1], 'base64'));
      return { ok: true, cancelled: false, success: true, filePath, fileName: basename(filePath) };
    } catch (error) {
      console.error('地图 PNG 导出失败', error);
      return { ok: false, error: readableExportError(error) };
    }
  });

  ipcMain.handle('export:mapPngBatch', async (event, vaultPath: string, input: { items?: Array<{ title?: string; dataUrl?: string }> }) => {
    try {
      ensureVaultReady(vaultPath);
      const items = Array.isArray(input.items) ? input.items : [];
      if (items.length === 0) return { ok: false, error: '没有可导出的地图 PNG。' };
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showOpenDialog(window, { title: '选择地图 PNG 导出文件夹', properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ title: '选择地图 PNG 导出文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: true, cancelled: true, success: false, successCount: 0, failedCount: 0, errors: [] };
      }

      const directory = result.filePaths[0];
      const usedNames = new Set<string>();
      const errors: string[] = [];
      let successCount = 0;
      items.forEach((item, index) => {
        try {
          const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(item.dataUrl || ''));
          if (!match) throw new Error('PNG 数据无效');
          const baseName = safeFileName(String(item.title || '').trim() || '未命名地图');
          let fileName = `${baseName}.png`;
          let suffix = 2;
          while (usedNames.has(fileName.toLowerCase()) || existsSync(join(directory, fileName))) {
            fileName = `${baseName} (${suffix}).png`;
            suffix += 1;
          }
          usedNames.add(fileName.toLowerCase());
          writeFileSync(join(directory, fileName), Buffer.from(match[1], 'base64'));
          successCount += 1;
        } catch (error) {
          errors.push(`${String(item.title || `地图 ${index + 1}`)}：${error instanceof Error ? error.message : String(error)}`);
        }
      });
      return { ok: true, cancelled: false, success: successCount > 0, successCount, failedCount: errors.length, errors, directory };
    } catch (error) {
      console.error('批量地图 PNG 导出失败', error);
      return { ok: false, error: readableExportError(error) };
    }
  });
}

function buildExportSummary(db: Db): unknown {
  const characters = db.prepare(`
    SELECT id, name as title, summary
    FROM characters
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `).all() as Array<{ id: string; title: string; summary: string }>;

  const characterVersions = db.prepare(`
    SELECT character_id as characterId, id, name as title
    FROM character_versions
    WHERE deleted_at IS NULL
    ORDER BY is_default DESC, updated_at DESC
  `).all() as Array<{ characterId: string; id: string; title: string }>;
  const versionsByCharacter = new Map<string, Array<{ id: string; title: string }>>();
  characterVersions.forEach((version) => {
    const rows = versionsByCharacter.get(version.characterId) ?? [];
    rows.push({ id: version.id, title: version.title });
    versionsByCharacter.set(version.characterId, rows);
  });

  const codexItems = db.prepare(`
    SELECT id, title, type
    FROM codex_items
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `).all();

  const events = db.prepare(`
    SELECT id, title, start_display_time as startDisplayTime, end_display_time as endDisplayTime
    FROM events
    WHERE deleted_at IS NULL
    ORDER BY COALESCE(start_sort_index, 999999), updated_at DESC
  `).all() as Array<{ id: string; title: string; startDisplayTime: string; endDisplayTime: string }>;

  const locations = db.prepare(`
    SELECT id, name as title, type
    FROM locations
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `).all();

  const timelines = db.prepare(`
    SELECT id, name as title, parent_timeline_id as parentTimelineId, sort_order as sortOrder
    FROM timelines
    WHERE deleted_at IS NULL
    ORDER BY sort_order ASC, updated_at DESC
  `).all();

  const manuscripts = db.prepare(`
    SELECT id, title, manuscript_type as manuscriptType
    FROM manuscripts
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `).all() as Array<{ id: string; title: string; manuscriptType: string }>;

  return {
    characters: characters.map((character) => ({
      ...character,
      versions: versionsByCharacter.get(character.id) ?? []
    })),
    codexItems,
    events: events.map((item) => ({ ...item, storyTime: formatStoryTime(item.startDisplayTime, item.endDisplayTime) || '时间未注明' })),
    locations,
    timelines,
    manuscripts: manuscripts.map((item) => ({ ...item, manuscriptTypeLabel: manuscriptTypeLabel(item.manuscriptType) }))
  };
}

function buildMarkdown(db: Db, projectName: string, options: ExportOptions): string {
  const parts: string[] = [
    '# 世界观资料导出',
    '',
    `导出时间：${formatDateTime(new Date())}`,
    projectName ? `项目：${projectName}` : '',
    '',
    '---'
  ].filter(Boolean);
  let sectionCount = 0;

  sectionCount += appendSection(parts, '角色', buildCharactersSection(db, options.selectedCharacterIds));
  sectionCount += appendSection(parts, '词条', buildCodexSection(db, options.selectedCodexItemIds));
  sectionCount += appendSection(parts, '事件', buildEventsSection(db, options.selectedEventIds));
  sectionCount += appendSection(parts, '地点', buildLocationsSection(db, options.selectedLocationIds));
  sectionCount += appendSection(parts, '时间线', buildTimelinesSection(db, options.selectedTimelineIds));
  sectionCount += appendSection(parts, '手稿', buildManuscriptsSection(db, options.selectedManuscriptIds));

  if (sectionCount === 0) {
    return '';
  }

  return `${parts.join('\n')}\n`;
}

function buildCharactersSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const rows = db.prepare(`
    SELECT id, name, summary
    FROM characters
    WHERE deleted_at IS NULL AND id IN (${placeholders(ids)})
    ORDER BY updated_at DESC
  `).all(...ids) as Array<{ id: string; name: string; summary: string }>;

  return rows.flatMap((character) => {
    const lines = [`### ${escapeMdHeading(character.name)}`];
    pushParagraph(lines, character.summary);

    const versions = db.prepare(`
      SELECT name, description
      FROM character_versions
      WHERE deleted_at IS NULL AND character_id = ?
      ORDER BY is_default DESC, updated_at DESC
    `).all(character.id) as Array<{ name: string; description: string }>;

    versions.forEach((version) => {
      lines.push('', `#### 角色版本：${escapeMdHeading(version.name)}`);
      pushParagraph(lines, version.description);
    });

    return [...lines, ''];
  });
}

function buildCodexSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const items = db.prepare(`
    SELECT id, title, summary, type
    FROM codex_items
    WHERE deleted_at IS NULL AND id IN (${placeholders(ids)})
    ORDER BY updated_at DESC
  `).all(...ids) as Array<{ id: string; title: string; summary: string; type: string }>;

  return items.flatMap((item) => {
    const lines = [`### ${escapeMdHeading(item.title)}`];
    pushMeta(lines, '类型', item.type);
    pushMeta(lines, '摘要', item.summary);

    const aliases = db.prepare(`
      SELECT alias
      FROM codex_aliases
      WHERE deleted_at IS NULL AND codex_item_id = ?
      ORDER BY updated_at DESC
    `).all(item.id) as Array<{ alias: string }>;
    if (aliases.length > 0) {
      pushMeta(lines, '别名', aliases.map((alias) => alias.alias).filter(Boolean).join('、'));
    }

    appendContentBlocks(lines, db, 'codex_item', item.id);
    return [...lines, ''];
  });
}

function buildEventsSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const events = db.prepare(`
    SELECT e.title, e.start_display_time as startDisplayTime, e.end_display_time as endDisplayTime,
      e.duration_note as durationNote, e.body, t.name as timelineName
    FROM events e
    LEFT JOIN timelines t ON t.id = e.timeline_id AND t.deleted_at IS NULL
    WHERE e.deleted_at IS NULL AND e.id IN (${placeholders(ids)})
    ORDER BY COALESCE(e.start_sort_index, 999999), e.updated_at DESC
  `).all(...ids) as Array<{ title: string; startDisplayTime: string; endDisplayTime: string; durationNote: string; body: string; timelineName: string | null }>;

  return events.flatMap((event) => {
    const lines = [`### ${escapeMdHeading(event.title)}`];
    pushMeta(lines, '所属时间线', event.timelineName ?? '');
    pushMeta(lines, '故事时间', formatStoryTime(event.startDisplayTime, event.endDisplayTime));
    pushMeta(lines, '持续说明', event.durationNote);
    pushParagraph(lines, event.body);
    return [...lines, ''];
  });
}

function buildLocationsSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const locations = db.prepare(`
    SELECT name, type, summary, body
    FROM locations
    WHERE deleted_at IS NULL AND id IN (${placeholders(ids)})
    ORDER BY updated_at DESC
  `).all(...ids) as Array<{ name: string; type: string; summary: string; body: string }>;

  return locations.flatMap((location) => {
    const lines = [`### ${escapeMdHeading(location.name)}`];
    pushMeta(lines, '类型', location.type);
    pushMeta(lines, '摘要', location.summary);
    pushParagraph(lines, location.body);
    return [...lines, ''];
  });
}

function buildTimelinesSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const timelines = db.prepare(`
    SELECT t.id, t.name, t.description, t.branch_note as branchNote, p.name as parentName
    FROM timelines t
    LEFT JOIN timelines p ON p.id = t.parent_timeline_id AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND t.id IN (${placeholders(ids)})
    ORDER BY t.sort_order ASC, t.updated_at DESC
  `).all(...ids) as Array<{ id: string; name: string; description: string; branchNote: string; parentName: string | null }>;

  return timelines.flatMap((timeline) => {
    const lines = [`### ${escapeMdHeading(timeline.name)}`];
    pushMeta(lines, '父时间线', timeline.parentName ?? '');
    pushMeta(lines, '描述', timeline.description);
    pushMeta(lines, '分支说明', timeline.branchNote);

    const events = db.prepare(`
      SELECT title, start_display_time as startDisplayTime, end_display_time as endDisplayTime
      FROM events
      WHERE deleted_at IS NULL AND timeline_id = ?
      ORDER BY COALESCE(start_sort_index, 999999), updated_at DESC
    `).all(timeline.id) as Array<{ title: string; startDisplayTime: string; endDisplayTime: string }>;

    if (events.length > 0) {
      lines.push('', '事件列表：');
      events.forEach((event) => {
        const storyTime = formatStoryTime(event.startDisplayTime, event.endDisplayTime) || '时间未注明';
        lines.push(`- ${storyTime}｜${event.title}`);
      });
    }

    return [...lines, ''];
  });
}

function buildManuscriptsSection(db: Db, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const manuscripts = db.prepare(`
    SELECT title, body, manuscript_type as manuscriptType
    FROM manuscripts
    WHERE deleted_at IS NULL AND id IN (${placeholders(ids)})
    ORDER BY updated_at DESC
  `).all(...ids) as Array<{ title: string; body: string; manuscriptType: string }>;

  return manuscripts.flatMap((manuscript) => {
    const lines = [`### ${escapeMdHeading(manuscript.title)}`];
    pushMeta(lines, '类型', manuscriptTypeLabel(manuscript.manuscriptType));
    pushParagraph(lines, manuscript.body);
    return [...lines, ''];
  });
}

function appendContentBlocks(lines: string[], db: Db, ownerType: string, ownerId: string): void {
  const blocks = db.prepare(`
    SELECT title, content_json as contentJson
    FROM content_blocks
    WHERE deleted_at IS NULL AND owner_entity_type = ? AND owner_entity_id = ?
    ORDER BY sort_order ASC, updated_at ASC
  `).all(ownerType, ownerId) as Array<{ title: string; contentJson: string }>;

  blocks.forEach((block) => {
    const text = blockText(block.contentJson);
    if (!block.title.trim() && !text.trim()) {
      return;
    }
    if (block.title.trim()) {
      lines.push('', `#### ${escapeMdHeading(block.title)}`);
    }
    pushParagraph(lines, text);
  });
}

function appendSection(parts: string[], title: string, body: string[]): number {
  if (body.length === 0) {
    return 0;
  }
  parts.push('', `## ${title}`, '', ...body, '---');
  return 1;
}

function hasSelectedContent(options: ExportOptions): boolean {
  return [
    options.selectedCharacterIds,
    options.selectedCodexItemIds,
    options.selectedEventIds,
    options.selectedLocationIds,
    options.selectedTimelineIds,
    options.selectedManuscriptIds
  ].some((ids) => ids.length > 0);
}

function placeholders(ids: string[]): string {
  return ids.map(() => '?').join(', ');
}

function pushMeta(lines: string[], label: string, value: string): void {
  const text = String(value ?? '').trim();
  if (text) {
    lines.push(`${label}：${text}`);
  }
}

function pushParagraph(lines: string[], value: string): void {
  const text = String(value ?? '').trim();
  if (text) {
    lines.push('', text);
  }
}

function blockText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson || '{}') as Record<string, unknown>;
    for (const key of ['text', 'body', 'content', 'markdown']) {
      if (typeof parsed[key] === 'string') {
        return parsed[key] as string;
      }
    }
    return Object.values(parsed).filter((value) => typeof value === 'string').join('\n');
  } catch {
    return contentJson;
  }
}

function formatStoryTime(start: string, end: string): string {
  const startText = String(start ?? '').trim();
  const endText = String(end ?? '').trim();
  if (startText && endText && startText !== endText) {
    return `${startText} — ${endText}`;
  }
  return startText || endText;
}

function manuscriptTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    fragment: '灵感碎片',
    scene: '故事片段',
    longform: '长文手稿'
  };
  return labels[type] ?? type;
}

function escapeMdHeading(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || '未命名';
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || '世界观资料';
}

function timestampForFile(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function formatDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableExportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('world.db')) {
    return '导出失败：当前存档数据库不存在。';
  }
  if (message.includes('project.json')) {
    return '导出失败：当前存档信息损坏。';
  }
  if (message.includes('ENOENT')) {
    return '导出失败：保存位置不存在。';
  }
  if (message.includes('EACCES') || message.includes('EPERM')) {
    return '导出失败：没有权限写入所选位置。';
  }
  return `导出失败：${message}`;
}
