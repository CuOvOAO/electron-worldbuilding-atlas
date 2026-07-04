import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { assetFileExists, assetUrlForId, resolveAssetPath } from '../assets/assetProtocol';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { ensureVaultReady, worldDbPath } from '../vault/vaultService';

function withDb<T>(vaultPath: string, callback: (db: ReturnType<typeof openDatabase>['db']) => T): T {
  ensureVaultReady(vaultPath);
  const { db } = openDatabase(worldDbPath(vaultPath));
  try {
    runMigrations(db);
    return callback(db);
  } finally {
    db.close();
  }
}

export function registerDataIpc(): void {
  ipcMain.handle('data:listTrashItems', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        items: withDb(vaultPath, (db) => listTrashItems(db))
      };
    } catch (error) {
      console.error('读取回收站失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:restoreTrashItem', (_event, vaultPath: string, input: { entityType?: string; id?: string }) => {
    try {
      const entityType = String(input.entityType || '');
      const id = String(input.id || '');
      const table = trashEntityTable(entityType);
      if (!id) {
        throw new Error('请选择要恢复的资料。');
      }
      return {
        ok: true,
        item: withDb(vaultPath, (db) => {
          const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).get(id);
          if (!existing) {
            throw new Error('该资料不在回收站中，可能已经恢复。');
          }
          const now = new Date().toISOString();
          db.prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`).run(now, id);
          return { entityType, id, restoredAt: now };
        })
      };
    } catch (error) {
      console.error('恢复回收站资料失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:permanentlyDeleteTrashItem', (_event, vaultPath: string, input: { entityType?: string; id?: string }) => {
    try {
      const entityType = String(input.entityType || '');
      const id = String(input.id || '');
      if (!id) {
        throw new Error('请选择要永久删除的资料。');
      }
      return {
        ok: true,
        item: withDb(vaultPath, (db) => {
          assertTrashItemExists(db, entityType, id);
          db.exec('BEGIN IMMEDIATE;');
          try {
            permanentlyDeleteTrashItem(db, entityType, id);
            db.exec('COMMIT;');
            return { entityType, id };
          } catch (error) {
            db.exec('ROLLBACK;');
            throw error;
          }
        })
      };
    } catch (error) {
      console.error('永久删除回收站资料失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:getRecentItems', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        items: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT
              'character_version' as entityType,
              '角色版本' as kind,
              cv.id as id,
              cv.character_id as characterId,
              c.name || ' / ' || cv.name as title,
              COALESCE(NULLIF(cv.description, ''), c.summary) as detail,
              cv.updated_at as updatedAt
            FROM character_versions cv
            INNER JOIN characters c ON c.id = cv.character_id
            WHERE cv.deleted_at IS NULL AND c.deleted_at IS NULL
            UNION ALL
            SELECT 'codex_item' as entityType, '词条' as kind, id, NULL as characterId, title, summary as detail, updated_at as updatedAt FROM codex_items WHERE deleted_at IS NULL
            UNION ALL
            SELECT 'event' as entityType, '事件' as kind, id, NULL as characterId, title,
              CASE
                WHEN start_display_time <> '' AND end_display_time <> '' THEN start_display_time || ' - ' || end_display_time
                WHEN start_display_time <> '' THEN start_display_time
                WHEN end_display_time <> '' THEN end_display_time
                WHEN body <> '' THEN substr(body, 1, 40)
                ELSE duration_note
              END as detail,
              updated_at as updatedAt FROM events WHERE deleted_at IS NULL
            UNION ALL
            SELECT 'location' as entityType, '地点' as kind, id, NULL as characterId, name as title, summary as detail, updated_at as updatedAt FROM locations WHERE deleted_at IS NULL
            UNION ALL
            SELECT 'manuscript' as entityType, '手稿' as kind, id, NULL as characterId, title, body as detail, updated_at as updatedAt FROM manuscripts WHERE deleted_at IS NULL
            UNION ALL
            SELECT 'timeline' as entityType, '时间线' as kind, id, NULL as characterId, name as title,
              COALESCE(NULLIF(branch_note, ''), description) as detail,
              updated_at as updatedAt FROM timelines WHERE deleted_at IS NULL
            UNION ALL
            SELECT 'map' as entityType, '地图' as kind, id, NULL as characterId, COALESCE(NULLIF(title, ''), name) as title,
              COALESCE(NULLIF(description, ''), '地图资料') as detail,
              updated_at as updatedAt FROM maps WHERE deleted_at IS NULL
            ORDER BY updatedAt DESC
            LIMIT 10
          `).all()
        )
      };
    } catch (error) {
      console.error('è¯»å–é¦–é¡µæœ€è¿‘ç¼–è¾‘å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:globalSearch', (_event, vaultPath: string, query: string) => {
    try {
      const keyword = query.trim();
      if (keyword.length === 0) {
        return { ok: true, results: [] };
      }
      return {
        ok: true,
        results: withDb(vaultPath, (db) => globalSearch(db, keyword))
      };
    } catch (error) {
      console.error('å…¨å±€æœç´¢å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:listCharacters', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        characters: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT
              c.id as id,
              c.name as name,
              c.summary as summary,
              c.avatar_asset_id as avatarAssetId,
              c.full_body_asset_id as fullBodyAssetId,
              aa.relative_path as avatarAssetRelativePath,
              aa.original_name as avatarAssetOriginalName,
              aa.mime_type as avatarAssetMimeType,
              fa.relative_path as fullBodyAssetRelativePath,
              fa.original_name as fullBodyAssetOriginalName,
              fa.mime_type as fullBodyAssetMimeType,
              c.created_at as createdAt,
              c.updated_at as updatedAt
            FROM characters c
            LEFT JOIN assets aa ON aa.id = c.avatar_asset_id AND aa.deleted_at IS NULL
            LEFT JOIN assets fa ON fa.id = c.full_body_asset_id AND fa.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
            ORDER BY c.updated_at DESC
          `).all()
            .map((row: any) => ({
              ...row,
              avatarAssetUrl: row.avatarAssetId && row.avatarAssetRelativePath ? assetFileUrl(vaultPath, row.avatarAssetId, row.avatarAssetRelativePath, row.avatarAssetMimeType) : '',
              fullBodyAssetUrl: row.fullBodyAssetId && row.fullBodyAssetRelativePath ? assetFileUrl(vaultPath, row.fullBodyAssetId, row.fullBodyAssetRelativePath, row.fullBodyAssetMimeType) : ''
            }))
        )
      };
    } catch (error) {
      console.error('è¯»å–è§’è‰²åˆ—è¡¨å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:getCodexItem', (_event, vaultPath: string, codexItemId: string) => {
    try {
      return {
        ok: true,
        item: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT
              id,
              title,
              summary,
              type,
              export_enabled as exportEnabled,
              created_at as createdAt,
              updated_at as updatedAt
            FROM codex_items
            WHERE deleted_at IS NULL AND id = ?
          `).get(codexItemId)
        )
      };
    } catch (error) {
      console.error('è¯»å–è¯æ¡å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:getCharacterVersions', (_event, vaultPath: string, characterId: string) => {
    try {
      return {
        ok: true,
        versions: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT
              id,
              character_id as characterId,
              name,
              description,
              timeline_id as timelineId,
              is_default as isDefault,
              created_at as createdAt,
              updated_at as updatedAt
            FROM character_versions
            WHERE deleted_at IS NULL
              AND character_id = ?
              AND EXISTS (
                SELECT 1 FROM characters c
                WHERE c.id = character_versions.character_id AND c.deleted_at IS NULL
              )
            ORDER BY is_default DESC, created_at ASC
          `).all(characterId)
        )
      };
    } catch (error) {
      console.error('è¯»å–è§’è‰²ç‰ˆæœ¬å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createCharacter', (_event, vaultPath: string, input: { name: string; summary: string }) => {
    try {
      const character = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        const name = input.name.trim() || 'æœªå‘½åè§’è‰²';
        db.prepare('INSERT INTO characters (id, created_at, updated_at, name, summary) VALUES (?, ?, ?, ?, ?)').run(
          id,
          now,
          now,
          name,
          input.summary
        );
        const versionId = randomUUID();
        db.prepare('INSERT INTO character_versions (id, created_at, updated_at, character_id, name, description, timeline_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          versionId,
          now,
          now,
          id,
          'é»˜è®¤ç‰ˆæœ¬',
          'è§’è‰²çš„åŸºç¡€è®¾å®šç‰ˆæœ¬ã€‚',
          null,
          1
        );
        return { id, name, summary: input.summary, avatarAssetId: null, fullBodyAssetId: null, createdAt: now, updatedAt: now };
      });
      return { ok: true, character };
    } catch (error) {
      console.error('åˆ›å»ºè§’è‰²å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateCharacter', (_event, vaultPath: string, input: { id: string; name: string; summary: string; avatarAssetId?: string | null; fullBodyAssetId?: string | null }) => {
    try {
      const character = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const existing = db.prepare(`
          SELECT
            avatar_asset_id as avatarAssetId,
            full_body_asset_id as fullBodyAssetId
          FROM characters
          WHERE id = ? AND deleted_at IS NULL
        `).get(input.id) as { avatarAssetId: string | null; fullBodyAssetId: string | null } | undefined;
        if (!existing) {
          throw new Error('è§’è‰²ä¸å­˜åœ¨æˆ–å·²è¢«åˆ é™¤ã€‚');
        }
        const name = input.name.trim() || 'æœªå‘½åè§’è‰²';
        const hasAvatarAssetId = Object.prototype.hasOwnProperty.call(input, 'avatarAssetId');
        const hasFullBodyAssetId = Object.prototype.hasOwnProperty.call(input, 'fullBodyAssetId');
        const avatarAssetId = hasAvatarAssetId ? input.avatarAssetId || null : existing.avatarAssetId;
        const fullBodyAssetId = hasFullBodyAssetId ? input.fullBodyAssetId || null : existing.fullBodyAssetId;
        if (avatarAssetId && !assetExists(db, avatarAssetId)) {
          throw new Error('å¤´åƒç´ æä¸å­˜åœ¨æˆ–å·²è¢«åˆ é™¤ã€‚');
        }
        if (fullBodyAssetId && !assetExists(db, fullBodyAssetId)) {
          throw new Error('ç«‹ç»˜ç´ æä¸å­˜åœ¨æˆ–å·²è¢«åˆ é™¤ã€‚');
        }
        db.prepare('UPDATE characters SET name = ?, summary = ?, avatar_asset_id = ?, full_body_asset_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          name,
          input.summary,
          avatarAssetId,
          fullBodyAssetId,
          now,
          input.id
        );
        return { id: input.id, name, summary: input.summary, avatarAssetId, fullBodyAssetId, updatedAt: now };
      });
      return { ok: true, character };
    } catch (error) {
      console.error('æ›´æ–°è§’è‰²å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createCharacterVersion', (_event, vaultPath: string, input: { characterId: string; name: string; description: string }) => {
    try {
      const version = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        const name = input.name.trim() || 'æ–°å»ºç‰ˆæœ¬';
        db.prepare('INSERT INTO character_versions (id, created_at, updated_at, character_id, name, description, timeline_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          id,
          now,
          now,
          input.characterId,
          name,
          input.description,
          null,
          0
        );
        db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, input.characterId);
        return { id, characterId: input.characterId, name, description: input.description, timelineId: null, isDefault: 0, createdAt: now, updatedAt: now };
      });
      return { ok: true, version };
    } catch (error) {
      console.error('åˆ›å»ºè§’è‰²ç‰ˆæœ¬å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateCharacterVersion', (_event, vaultPath: string, input: { id: string; characterId: string; name: string; description: string }) => {
    try {
      return {
        ok: true,
        version: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          db.prepare('UPDATE character_versions SET name = ?, description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
            input.name.trim() || 'æœªå‘½åç‰ˆæœ¬',
            input.description,
            now,
            input.id
          );
          db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, input.characterId);
          return { ...input, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°è§’è‰²ç‰ˆæœ¬å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteCharacterVersion', (_event, vaultPath: string, input: { id: string; characterId: string }) => {
    const result = softDelete(vaultPath, 'character_versions', input.id, 'åˆ é™¤è§’è‰²ç‰ˆæœ¬å¤±è´¥');
    if (result.ok) {
      touchEntity(vaultPath, 'characters', input.characterId);
    }
    return result;
  });

  ipcMain.handle('data:deleteCharacter', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'characters', id, 'åˆ é™¤è§’è‰²å¤±è´¥'));

  ipcMain.handle('data:listCodexItems', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        items: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT id, title, summary, type, export_enabled as exportEnabled, created_at as createdAt, updated_at as updatedAt
            FROM codex_items
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC
          `).all()
        )
      };
    } catch (error) {
      console.error('è¯»å–è¯æ¡åˆ—è¡¨å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createCodexItem', (_event, vaultPath: string, input: { title: string; summary: string; type: string; exportEnabled: number }) => {
    try {
      const item = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        const title = input.title.trim() || 'æœªå‘½åè¯æ¡';
        db.prepare('INSERT INTO codex_items (id, created_at, updated_at, title, summary, type, export_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          id,
          now,
          now,
          title,
          input.summary,
          input.type,
          input.exportEnabled ? 1 : 0
        );
        return { id, title, summary: input.summary, type: input.type, exportEnabled: input.exportEnabled ? 1 : 0, createdAt: now, updatedAt: now };
      });
      return { ok: true, item };
    } catch (error) {
      console.error('åˆ›å»ºè¯æ¡å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateCodexItem', (_event, vaultPath: string, input: { id: string; title: string; summary: string; type: string; exportEnabled: number }) => {
    try {
      return {
        ok: true,
        item: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          const title = input.title.trim() || 'æœªå‘½åè¯æ¡';
          db.prepare('UPDATE codex_items SET title = ?, summary = ?, type = ?, export_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
            title,
            input.summary,
            input.type,
            input.exportEnabled ? 1 : 0,
            now,
            input.id
          );
          return { ...input, title, exportEnabled: input.exportEnabled ? 1 : 0, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°è¯æ¡å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteCodexItem', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'codex_items', id, 'åˆ é™¤è¯æ¡å¤±è´¥'));

  ipcMain.handle('data:listCodexAliases', (_event, vaultPath: string, codexItemId: string) => {
    try {
      return {
        ok: true,
        aliases: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT id, codex_item_id as codexItemId, alias, created_at as createdAt, updated_at as updatedAt
            FROM codex_aliases
            WHERE deleted_at IS NULL AND codex_item_id = ?
            ORDER BY created_at ASC
          `).all(codexItemId)
        )
      };
    } catch (error) {
      console.error('è¯»å–è¯æ¡åˆ«åå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createCodexAlias', (_event, vaultPath: string, input: { codexItemId: string; alias: string }) => {
    try {
      return {
        ok: true,
        alias: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          const id = randomUUID();
          db.prepare('INSERT INTO codex_aliases (id, created_at, updated_at, codex_item_id, alias) VALUES (?, ?, ?, ?, ?)').run(id, now, now, input.codexItemId, input.alias);
          db.prepare('UPDATE codex_items SET updated_at = ? WHERE id = ?').run(now, input.codexItemId);
          return { id, codexItemId: input.codexItemId, alias: input.alias, createdAt: now, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('åˆ›å»ºè¯æ¡åˆ«åå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateCodexAlias', (_event, vaultPath: string, input: { id: string; codexItemId: string; alias: string }) => {
    try {
      return {
        ok: true,
        alias: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          db.prepare('UPDATE codex_aliases SET alias = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(input.alias, now, input.id);
          db.prepare('UPDATE codex_items SET updated_at = ? WHERE id = ?').run(now, input.codexItemId);
          return { ...input, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°è¯æ¡åˆ«åå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteCodexAlias', (_event, vaultPath: string, input: { id: string; codexItemId: string }) => {
    const result = softDelete(vaultPath, 'codex_aliases', input.id, 'åˆ é™¤è¯æ¡åˆ«åå¤±è´¥');
    if (result.ok) {
      touchEntity(vaultPath, 'codex_items', input.codexItemId);
    }
    return result;
  });

  ipcMain.handle('data:listContentBlocks', (_event, vaultPath: string, ownerEntityType: string, ownerEntityId: string) => {
    try {
      return {
        ok: true,
        blocks: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT id, owner_entity_type as ownerEntityType, owner_entity_id as ownerEntityId, block_type as blockType, title, content_json as contentJson,
              sort_order as sortOrder, collapsed, export_enabled as exportEnabled, created_at as createdAt, updated_at as updatedAt
            FROM content_blocks
            WHERE deleted_at IS NULL AND owner_entity_type = ? AND owner_entity_id = ?
            ORDER BY sort_order ASC, created_at ASC
          `).all(ownerEntityType, ownerEntityId)
        )
      };
    } catch (error) {
      console.error('è¯»å–æ­£æ–‡æ®µè½å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createContentBlock', (_event, vaultPath: string, input: { ownerEntityType: string; ownerEntityId: string; blockType: string; title: string; contentJson: string; sortOrder: number; collapsed: number; exportEnabled: number }) => {
    try {
      return {
        ok: true,
        block: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          const id = randomUUID();
          db.prepare(`INSERT INTO content_blocks
            (id, created_at, updated_at, owner_entity_type, owner_entity_id, block_type, title, content_json, sort_order, collapsed, export_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id,
            now,
            now,
            input.ownerEntityType,
            input.ownerEntityId,
            input.blockType,
            input.title,
            input.contentJson,
            input.sortOrder,
            input.collapsed ? 1 : 0,
            input.exportEnabled ? 1 : 0
          );
          touchOwner(db, input.ownerEntityType, input.ownerEntityId, now);
          return { id, ...input, createdAt: now, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('åˆ›å»ºæ­£æ–‡æ®µè½å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateContentBlock', (_event, vaultPath: string, input: { id: string; ownerEntityType: string; ownerEntityId: string; title: string; contentJson: string; sortOrder: number; collapsed: number; exportEnabled: number }) => {
    try {
      return {
        ok: true,
        block: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          db.prepare('UPDATE content_blocks SET title = ?, content_json = ?, sort_order = ?, collapsed = ?, export_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
            input.title,
            input.contentJson,
            input.sortOrder,
            input.collapsed ? 1 : 0,
            input.exportEnabled ? 1 : 0,
            now,
            input.id
          );
          touchOwner(db, input.ownerEntityType, input.ownerEntityId, now);
          return { ...input, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°æ­£æ–‡æ®µè½å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteContentBlock', (_event, vaultPath: string, input: { id: string; ownerEntityType: string; ownerEntityId: string }) => {
    const result = softDelete(vaultPath, 'content_blocks', input.id, 'åˆ é™¤æ­£æ–‡æ®µè½å¤±è´¥');
    if (result.ok) {
      touchEntity(vaultPath, ownerTable(input.ownerEntityType), input.ownerEntityId);
    }
    return result;
  });

  ipcMain.handle('data:listLocations', (_event, vaultPath: string) => listRows(vaultPath, 'locations', 'name'));
  ipcMain.handle('data:createLocation', (_event, vaultPath: string, input: { name: string; type: string; summary: string; body: string; exportEnabled: number }) =>
    createLocationLike(vaultPath, 'locations', ['name', 'type', 'summary', 'body', 'export_enabled'], [input.name.trim() || 'æœªå‘½ååœ°ç‚¹', input.type, input.summary, input.body, input.exportEnabled ? 1 : 0], 'åˆ›å»ºåœ°ç‚¹å¤±è´¥')
  );
  ipcMain.handle('data:updateLocation', (_event, vaultPath: string, input: { id: string; name: string; type: string; summary: string; body: string; exportEnabled: number }) =>
    updateLocation(vaultPath, input)
  );
  ipcMain.handle('data:deleteLocation', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'locations', id, 'åˆ é™¤åœ°ç‚¹å¤±è´¥'));

  ipcMain.handle('data:listEvents', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        items: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT e.id, e.title, e.timeline_id as timelineId, t.name as timelineName, e.start_display_time as startDisplayTime,
              e.end_display_time as endDisplayTime, e.duration_note as durationNote, e.start_sort_index as startSortIndex,
              e.end_sort_index as endSortIndex, e.body, e.export_enabled as exportEnabled, e.created_at as createdAt, e.updated_at as updatedAt
            FROM events e
            LEFT JOIN timelines t ON t.id = e.timeline_id AND t.deleted_at IS NULL
            WHERE e.deleted_at IS NULL
            ORDER BY COALESCE(t.sort_order, 999999) ASC, e.start_sort_index ASC, e.updated_at DESC
          `).all()
        )
      };
    } catch (error) {
      console.error('è¯»å–äº‹ä»¶åˆ—è¡¨å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('data:createEvent', (_event, vaultPath: string, input: Record<string, unknown>) => createEvent(vaultPath, input));
  ipcMain.handle('data:updateEvent', (_event, vaultPath: string, input: Record<string, unknown>) => updateEvent(vaultPath, input));
  ipcMain.handle('data:deleteEvent', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'events', id, 'åˆ é™¤äº‹ä»¶å¤±è´¥'));

  ipcMain.handle('data:listManuscripts', (_event, vaultPath: string) => listRows(vaultPath, 'manuscripts', 'title'));
  ipcMain.handle('data:createManuscript', (_event, vaultPath: string, input: { title: string; body: string; manuscriptType: string; exportEnabled: number }) =>
    createLocationLike(vaultPath, 'manuscripts', ['title', 'body', 'manuscript_type', 'export_enabled'], [input.title.trim() || 'æœªå‘½åæ‰‹ç¨¿', input.body, input.manuscriptType, input.exportEnabled ? 1 : 0], 'åˆ›å»ºæ‰‹ç¨¿å¤±è´¥')
  );
  ipcMain.handle('data:updateManuscript', (_event, vaultPath: string, input: { id: string; title: string; body: string; manuscriptType: string; exportEnabled: number }) =>
    updateManuscript(vaultPath, input)
  );
  ipcMain.handle('data:deleteManuscript', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'manuscripts', id, 'åˆ é™¤æ‰‹ç¨¿å¤±è´¥'));

  ipcMain.handle('data:listTimelines', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        items: withDb(vaultPath, (db) =>
          db.prepare(`
            SELECT id, name, description, parent_timeline_id as parentTimelineId, branch_event_id as branchEventId,
              branch_note as branchNote, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
            FROM timelines
            WHERE deleted_at IS NULL
            ORDER BY sort_order ASC, updated_at DESC
          `).all()
        )
      };
    } catch (error) {
      console.error('è¯»å–æ—¶é—´çº¿å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('data:createTimeline', (_event, vaultPath: string, input: Record<string, unknown>) => createTimeline(vaultPath, input));
  ipcMain.handle('data:updateTimeline', (_event, vaultPath: string, input: Record<string, unknown>) => updateTimeline(vaultPath, input));
  ipcMain.handle('data:deleteTimeline', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'timelines', id, 'åˆ é™¤æ—¶é—´çº¿å¤±è´¥'));

  ipcMain.handle('data:listEntityLinks', (_event, vaultPath: string, ownerType: string, ownerId: string) => {
    try {
      return {
        ok: true,
        links: withDb(vaultPath, (db) => {
          if (!entityExists(db, ownerType, ownerId)) {
            return [];
          }
          const rows = db.prepare(`
            SELECT id, source_entity_type as sourceEntityType, source_entity_id as sourceEntityId, target_entity_type as targetEntityType,
              target_entity_id as targetEntityId, link_type as linkType, note, created_at as createdAt, updated_at as updatedAt
            FROM entity_links
            WHERE deleted_at IS NULL AND (
              (source_entity_type = ? AND source_entity_id = ?)
              OR (target_entity_type = ? AND target_entity_id = ?)
            )
            ORDER BY created_at DESC
          `).all(ownerType, ownerId, ownerType, ownerId) as any[];
          return rows.filter((row) =>
            entityExists(db, String(row.sourceEntityType), String(row.sourceEntityId))
            && entityExists(db, String(row.targetEntityType), String(row.targetEntityId))
          );
        })
      };
    } catch (error) {
      console.error('è¯»å–å…³è”å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:listLinkTargets', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        targets: withDb(vaultPath, (db) => [
          ...db.prepare("SELECT 'character_version' as entityType, cv.id, cv.character_id as characterId, c.name || ' / ' || cv.name as title FROM character_versions cv INNER JOIN characters c ON c.id = cv.character_id WHERE cv.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY cv.updated_at DESC").all(),
          ...db.prepare("SELECT 'codex_item' as entityType, id, NULL as characterId, title FROM codex_items WHERE deleted_at IS NULL ORDER BY updated_at DESC").all(),
          ...db.prepare("SELECT 'event' as entityType, id, NULL as characterId, title FROM events WHERE deleted_at IS NULL ORDER BY updated_at DESC").all(),
          ...db.prepare("SELECT 'location' as entityType, id, NULL as characterId, name as title FROM locations WHERE deleted_at IS NULL ORDER BY updated_at DESC").all(),
          ...db.prepare("SELECT 'manuscript' as entityType, id, NULL as characterId, title FROM manuscripts WHERE deleted_at IS NULL ORDER BY updated_at DESC").all(),
          ...db.prepare("SELECT 'timeline' as entityType, id, NULL as characterId, name as title FROM timelines WHERE deleted_at IS NULL ORDER BY updated_at DESC").all()
        ])
      };
    } catch (error) {
      console.error('è¯»å–å…³è”ç›®æ ‡å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createEntityLink', (_event, vaultPath: string, input: { sourceEntityType: string; sourceEntityId: string; targetEntityType: string; targetEntityId: string; linkType: string; note: string }) => {
    try {
      return {
        ok: true,
        link: withDb(vaultPath, (db) => {
          if (!entityExists(db, input.sourceEntityType, input.sourceEntityId) || !entityExists(db, input.targetEntityType, input.targetEntityId)) {
            throw new Error('å…³è”ç›®æ ‡ä¸å­˜åœ¨ã€‚');
          }
          const now = new Date().toISOString();
          const id = randomUUID();
          db.prepare(`INSERT INTO entity_links
            (id, created_at, updated_at, source_entity_type, source_entity_id, target_entity_type, target_entity_id, link_type, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id,
            now,
            now,
            input.sourceEntityType,
            input.sourceEntityId,
            input.targetEntityType,
            input.targetEntityId,
            input.linkType,
            input.note
          );
          touchOwner(db, input.sourceEntityType, input.sourceEntityId, now);
          return { id, ...input, createdAt: now, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('åˆ›å»ºå…³è”å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteEntityLink', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'entity_links', id, 'åˆ é™¤å…³è”å¤±è´¥'));

  ipcMain.handle('data:listRelationGraph', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        graph: withDb(vaultPath, (db) => {
          const nodes = db.prepare(`
            SELECT
              cv.id,
              cv.character_id as characterId,
              c.name as characterName,
              cv.name as versionName,
              cv.description,
              cv.timeline_id as timelineId,
              cv.created_at as createdAt,
              cv.updated_at as updatedAt
            FROM character_versions cv
            INNER JOIN characters c ON c.id = cv.character_id
            WHERE cv.deleted_at IS NULL AND c.deleted_at IS NULL
            ORDER BY c.updated_at DESC, cv.is_default DESC, cv.created_at ASC
          `).all();
          const relationships = db.prepare(`
            SELECT
              r.id,
              r.source_character_version_id as sourceCharacterVersionId,
              r.target_character_version_id as targetCharacterVersionId,
              r.timeline_id as timelineId,
              r.direction_mode as directionMode,
              r.created_at as createdAt,
              r.updated_at as updatedAt,
              sc.name as sourceCharacterName,
              sv.name as sourceVersionName,
              tc.name as targetCharacterName,
              tv.name as targetVersionName
            FROM relationships r
            LEFT JOIN character_versions sv ON sv.id = r.source_character_version_id AND sv.deleted_at IS NULL
            LEFT JOIN characters sc ON sc.id = sv.character_id AND sc.deleted_at IS NULL
            LEFT JOIN character_versions tv ON tv.id = r.target_character_version_id AND tv.deleted_at IS NULL
            LEFT JOIN characters tc ON tc.id = tv.character_id AND tc.deleted_at IS NULL
            LEFT JOIN timelines t ON t.id = r.timeline_id AND t.deleted_at IS NULL
            WHERE r.deleted_at IS NULL
              AND (r.timeline_id IS NULL OR t.id IS NOT NULL)
              AND sv.id IS NOT NULL
              AND sc.id IS NOT NULL
              AND tv.id IS NOT NULL
              AND tc.id IS NOT NULL
            ORDER BY r.updated_at DESC
          `).all();
          const stages = db.prepare(`
            SELECT
              id,
              relationship_id as relationshipId,
              relation_type as relationType,
              description,
              start_sort_index as startSortIndex,
              end_sort_index as endSortIndex,
              related_event_id as relatedEventId,
              created_at as createdAt,
              updated_at as updatedAt
            FROM relationship_stages
            WHERE deleted_at IS NULL
            ORDER BY COALESCE(start_sort_index, -999999) ASC, created_at ASC
          `).all();
          return { nodes, relationships, stages };
        })
      };
    } catch (error) {
      console.error('è¯»å–å…³ç³»ç½‘ç»œå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createRelationship', (_event, vaultPath: string, input: Record<string, unknown>) => {
    try {
      return {
        ok: true,
        relationship: withDb(vaultPath, (db) => {
          const sourceId = String(input.sourceCharacterVersionId || '');
          const targetId = String(input.targetCharacterVersionId || '');
          const timelineId = typeof input.timelineId === 'string' && input.timelineId ? input.timelineId : null;
          if (!sourceId || !targetId || sourceId === targetId) {
            throw new Error('èµ·ç‚¹å’Œç»ˆç‚¹è§’è‰²ç‰ˆæœ¬ä¸èƒ½ç›¸åŒã€‚');
          }
          if (!entityExists(db, 'character_version', sourceId) || !entityExists(db, 'character_version', targetId)) {
            throw new Error('è§’è‰²ç‰ˆæœ¬ä¸å­˜åœ¨ã€‚');
          }
          if (timelineId && !entityExists(db, 'timeline', timelineId)) {
            throw new Error('æ—¶é—´çº¿ä¸å­˜åœ¨ã€‚');
          }
          const duplicate = timelineId
            ? db.prepare(`SELECT id FROM relationships WHERE deleted_at IS NULL AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id = ?`).get(sourceId, targetId, timelineId)
            : db.prepare(`SELECT id FROM relationships WHERE deleted_at IS NULL AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id IS NULL`).get(sourceId, targetId);
          if (duplicate) {
            throw new Error('åŒä¸€æ—¶é—´çº¿ä¸‹å·²å­˜åœ¨è¿™æ¡æ–¹å‘å…³ç³»ã€‚');
          }
          const now = new Date().toISOString();
          const id = randomUUID();
          const stageId = randomUUID();
          const directionMode = input.directionMode === 'undirected' ? 'undirected' : 'directed';
          db.prepare(`INSERT INTO relationships
            (id, created_at, updated_at, source_character_version_id, target_character_version_id, timeline_id, direction_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, now, now, sourceId, targetId, timelineId, directionMode);
          db.prepare(`INSERT INTO relationship_stages
            (id, created_at, updated_at, relationship_id, relation_type, description, start_sort_index, end_sort_index, related_event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            stageId,
            now,
            now,
            id,
            String(input.relationType || 'ç›¸å…³'),
            String(input.description || ''),
            nullableNumber(input.startSortIndex),
            nullableNumber(input.endSortIndex),
            typeof input.relatedEventId === 'string' && input.relatedEventId ? input.relatedEventId : null
          );
          return { id, sourceCharacterVersionId: sourceId, targetCharacterVersionId: targetId, timelineId, directionMode, createdAt: now, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('åˆ›å»ºå…³ç³»å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateRelationship', (_event, vaultPath: string, input: Record<string, unknown>) => {
    try {
      return {
        ok: true,
        relationship: withDb(vaultPath, (db) => {
          const id = String(input.id || '');
          const sourceId = String(input.sourceCharacterVersionId || '');
          const targetId = String(input.targetCharacterVersionId || '');
          const timelineId = typeof input.timelineId === 'string' && input.timelineId ? input.timelineId : null;
          if (!sourceId || !targetId || sourceId === targetId) {
            throw new Error('èµ·ç‚¹å’Œç»ˆç‚¹è§’è‰²ç‰ˆæœ¬ä¸èƒ½ç›¸åŒã€‚');
          }
          if (!entityExists(db, 'character_version', sourceId) || !entityExists(db, 'character_version', targetId)) {
            throw new Error('è§’è‰²ç‰ˆæœ¬ä¸å­˜åœ¨ã€‚');
          }
          if (timelineId && !entityExists(db, 'timeline', timelineId)) {
            throw new Error('æ—¶é—´çº¿ä¸å­˜åœ¨ã€‚');
          }
          const duplicate = timelineId
            ? db.prepare(`SELECT id FROM relationships WHERE deleted_at IS NULL AND id <> ? AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id = ?`).get(id, sourceId, targetId, timelineId)
            : db.prepare(`SELECT id FROM relationships WHERE deleted_at IS NULL AND id <> ? AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id IS NULL`).get(id, sourceId, targetId);
          if (duplicate) {
            throw new Error('åŒä¸€æ—¶é—´çº¿ä¸‹å·²å­˜åœ¨è¿™æ¡æ–¹å‘å…³ç³»ã€‚');
          }
          const now = new Date().toISOString();
          const directionMode = input.directionMode === 'undirected' ? 'undirected' : 'directed';
          db.prepare(`UPDATE relationships
            SET source_character_version_id = ?, target_character_version_id = ?, timeline_id = ?, direction_mode = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`).run(sourceId, targetId, timelineId, directionMode, now, id);
          return { id, sourceCharacterVersionId: sourceId, targetCharacterVersionId: targetId, timelineId, directionMode, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°å…³ç³»å¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteRelationship', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'relationships', id, 'åˆ é™¤å…³ç³»å¤±è´¥'));

  ipcMain.handle('data:createRelationshipStage', (_event, vaultPath: string, input: Record<string, unknown>) => {
    try {
      return {
        ok: true,
        stage: withDb(vaultPath, (db) => {
          const relationshipId = String(input.relationshipId || '');
          const relationship = db.prepare('SELECT id FROM relationships WHERE id = ? AND deleted_at IS NULL').get(relationshipId);
          if (!relationship) {
            throw new Error('å…³ç³»ä¸å­˜åœ¨ã€‚');
          }
          const relatedEventId = typeof input.relatedEventId === 'string' && input.relatedEventId ? input.relatedEventId : null;
          if (relatedEventId && !entityExists(db, 'event', relatedEventId)) {
            throw new Error('ç›¸å…³äº‹ä»¶ä¸å­˜åœ¨ã€‚');
          }
          const now = new Date().toISOString();
          const id = randomUUID();
          db.prepare(`INSERT INTO relationship_stages
            (id, created_at, updated_at, relationship_id, relation_type, description, start_sort_index, end_sort_index, related_event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id,
            now,
            now,
            relationshipId,
            String(input.relationType || 'ç›¸å…³'),
            String(input.description || ''),
            nullableNumber(input.startSortIndex),
            nullableNumber(input.endSortIndex),
            relatedEventId
          );
          db.prepare('UPDATE relationships SET updated_at = ? WHERE id = ?').run(now, relationshipId);
          return { id, relationshipId, relationType: String(input.relationType || 'ç›¸å…³'), description: String(input.description || ''), startSortIndex: nullableNumber(input.startSortIndex), endSortIndex: nullableNumber(input.endSortIndex), relatedEventId, createdAt: now, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('åˆ›å»ºå…³ç³»é˜¶æ®µå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateRelationshipStage', (_event, vaultPath: string, input: Record<string, unknown>) => {
    try {
      return {
        ok: true,
        stage: withDb(vaultPath, (db) => {
          const id = String(input.id || '');
          const relationshipId = String(input.relationshipId || '');
          const relatedEventId = typeof input.relatedEventId === 'string' && input.relatedEventId ? input.relatedEventId : null;
          if (relatedEventId && !entityExists(db, 'event', relatedEventId)) {
            throw new Error('ç›¸å…³äº‹ä»¶ä¸å­˜åœ¨ã€‚');
          }
          const now = new Date().toISOString();
          db.prepare(`UPDATE relationship_stages
            SET relation_type = ?, description = ?, start_sort_index = ?, end_sort_index = ?, related_event_id = ?, updated_at = ?
            WHERE id = ? AND relationship_id = ? AND deleted_at IS NULL`).run(
            String(input.relationType || 'ç›¸å…³'),
            String(input.description || ''),
            nullableNumber(input.startSortIndex),
            nullableNumber(input.endSortIndex),
            relatedEventId,
            now,
            id,
            relationshipId
          );
          db.prepare('UPDATE relationships SET updated_at = ? WHERE id = ?').run(now, relationshipId);
          return { ...input, relatedEventId, updatedAt: now };
        })
      };
    } catch (error) {
      console.error('æ›´æ–°å…³ç³»é˜¶æ®µå¤±è´¥', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteRelationshipStage', (_event, vaultPath: string, input: { id: string; relationshipId: string }) => {
    const result = softDelete(vaultPath, 'relationship_stages', input.id, 'åˆ é™¤å…³ç³»é˜¶æ®µå¤±è´¥');
    if (result.ok) {
      touchEntity(vaultPath, 'relationships', input.relationshipId);
    }
    return result;
  });

  ipcMain.handle('data:listMaps', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        maps: withDb(vaultPath, (db) => (db.prepare(`
          SELECT
            m.id,
            COALESCE(NULLIF(m.title, ''), m.name) as title,
            m.description,
            m.background_asset_id as backgroundAssetId,
            a.relative_path as backgroundAssetRelativePath,
            a.mime_type as backgroundAssetMimeType,
            m.canvas_width as canvasWidth,
            m.canvas_height as canvasHeight,
            m.source_map_id as sourceMapId,
            m.version_group_id as versionGroupId,
            COALESCE(NULLIF(source.title, ''), source.name) as sourceMapTitle,
            source.deleted_at as sourceMapDeletedAt,
            m.created_at as createdAt,
            m.updated_at as updatedAt
          FROM maps m
          LEFT JOIN assets a ON a.id = m.background_asset_id AND a.deleted_at IS NULL
          LEFT JOIN maps source ON source.id = m.source_map_id
          WHERE m.deleted_at IS NULL
          ORDER BY m.updated_at DESC
        `).all() as any[]).map((row) => mapRecord(vaultPath, row)))
      };
    } catch (error) {
      console.error('读取地图列表失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:createMap', (_event, vaultPath: string, input: { title?: string; description?: string }) => {
    try {
      return {
        ok: true,
        map: withDb(vaultPath, (db) => {
          const now = new Date().toISOString();
          const id = randomUUID();
          const versionGroupId = randomUUID();
          const title = String(input.title || '').trim() || '新建地图';
          db.prepare(`
            INSERT INTO maps (id, created_at, updated_at, name, title, description, background_asset_id, canvas_width, canvas_height, source_map_id, version_group_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(id, now, now, title, title, String(input.description || ''), null, 1600, 1000, versionGroupId);
          db.prepare(`
            INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order)
            VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0)
          `).run(randomUUID(), now, now, id, '默认图层');
          return mapRecord(vaultPath, { id, title, description: String(input.description || ''), backgroundAssetId: null, canvasWidth: 1600, canvasHeight: 1000, sourceMapId: null, sourceMapTitle: '', versionGroupId, createdAt: now, updatedAt: now });
        })
      };
    } catch (error) {
      console.error('创建地图失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:updateMap', (_event, vaultPath: string, input: { id: string; title: string; description: string; backgroundAssetId?: string | null; canvasWidth?: number; canvasHeight?: number }) => {
    try {
      return {
        ok: true,
        map: withDb(vaultPath, (db) => {
          const existing = db.prepare('SELECT id, background_asset_id as backgroundAssetId FROM maps WHERE id = ? AND deleted_at IS NULL').get(input.id) as { id: string; backgroundAssetId: string | null } | undefined;
          if (!existing) throw new Error('地图不存在或已被删除。');
          const hasBackground = Object.prototype.hasOwnProperty.call(input, 'backgroundAssetId');
          const backgroundAssetId = hasBackground ? input.backgroundAssetId || null : existing.backgroundAssetId;
          if (backgroundAssetId && !assetExists(db, backgroundAssetId)) {
            throw new Error('底图素材不存在或已被删除。');
          }
          const now = new Date().toISOString();
          const title = input.title.trim() || '未命名地图';
          const canvasWidth = Number(input.canvasWidth || 1600);
          const canvasHeight = Number(input.canvasHeight || 1000);
          db.prepare(`
            UPDATE maps
            SET name = ?, title = ?, description = ?, background_asset_id = ?, canvas_width = ?, canvas_height = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
          `).run(title, title, input.description || '', backgroundAssetId, canvasWidth, canvasHeight, now, input.id);
          const row = db.prepare(`
            SELECT m.id, COALESCE(NULLIF(m.title, ''), m.name) as title, m.description, m.background_asset_id as backgroundAssetId,
              a.relative_path as backgroundAssetRelativePath, a.mime_type as backgroundAssetMimeType,
              m.canvas_width as canvasWidth, m.canvas_height as canvasHeight,
              m.source_map_id as sourceMapId, m.version_group_id as versionGroupId,
              COALESCE(NULLIF(source.title, ''), source.name) as sourceMapTitle,
              source.deleted_at as sourceMapDeletedAt,
              m.created_at as createdAt, m.updated_at as updatedAt
            FROM maps m
            LEFT JOIN assets a ON a.id = m.background_asset_id AND a.deleted_at IS NULL
            LEFT JOIN maps source ON source.id = m.source_map_id
            WHERE m.id = ? AND m.deleted_at IS NULL
          `).get(input.id);
          return mapRecord(vaultPath, row);
        })
      };
    } catch (error) {
      console.error('更新地图失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:deleteMap', (_event, vaultPath: string, id: string) => softDelete(vaultPath, 'maps', id, '删除地图失败'));

  ipcMain.handle('data:listMapLayers', (_event, vaultPath: string, mapId: string) => {
    try {
      return {
        ok: true,
        layers: withDb(vaultPath, (db) => {
          ensureDefaultMapLayer(db, mapId);
          return listMapLayers(db, mapId);
        })
      };
    } catch (error) {
      console.error('读取地图图层失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:listEntityMapLinks', (_event, vaultPath: string, entityType: string, entityId: string) => {
    try {
      return {
        ok: true,
        links: withDb(vaultPath, (db) => listEntityMapLinks(db, entityType, entityId))
      };
    } catch (error) {
      console.error('读取地图关联失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:duplicateMapAsVersion', (_event, vaultPath: string, input: { sourceMapId?: string; title?: string }) => {
    try {
      return {
        ok: true,
        map: withDb(vaultPath, (db) => {
          const sourceMapId = String(input.sourceMapId || '');
          const title = String(input.title || '').trim();
          if (!sourceMapId) throw new Error('请选择要复制的源地图。');
          if (!title) throw new Error('新地图名称不能为空。');

          db.exec('BEGIN IMMEDIATE;');
          try {
            const source = db.prepare(`
              SELECT id, description, background_asset_id as backgroundAssetId,
                canvas_width as canvasWidth, canvas_height as canvasHeight,
                version_group_id as versionGroupId
              FROM maps
              WHERE id = ? AND deleted_at IS NULL
            `).get(sourceMapId) as {
              id: string;
              description: string;
              backgroundAssetId: string | null;
              canvasWidth: number;
              canvasHeight: number;
              versionGroupId: string | null;
            } | undefined;
            if (!source) throw new Error('源地图不存在或已被删除。');

            const now = new Date().toISOString();
            const mapId = randomUUID();
            const versionGroupId = source.versionGroupId || randomUUID();
            if (!source.versionGroupId) {
              db.prepare('UPDATE maps SET version_group_id = ? WHERE id = ?').run(versionGroupId, sourceMapId);
            }
            db.prepare(`
              INSERT INTO maps (
                id, created_at, updated_at, name, title, description,
                background_asset_id, canvas_width, canvas_height, source_map_id, version_group_id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              mapId,
              now,
              now,
              title,
              title,
              source.description || '',
              source.backgroundAssetId,
              Number(source.canvasWidth || 1600),
              Number(source.canvasHeight || 1000),
              sourceMapId,
              versionGroupId
            );

            const sourceLayers = db.prepare(`
              SELECT id, name, visible, locked, opacity, sort_order as sortOrder
              FROM map_layers
              WHERE map_id = ? AND deleted_at IS NULL
              ORDER BY sort_order ASC, created_at ASC
            `).all(sourceMapId) as Array<{ id: string; name: string; visible: number; locked: number; opacity: number; sortOrder: number }>;
            const layerIdMap = new Map<string, string>();
            sourceLayers.forEach((layer, index) => {
              const layerId = randomUUID();
              layerIdMap.set(layer.id, layerId);
              db.prepare(`
                INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(layerId, now, now, mapId, layer.name, layer.visible, layer.locked, clampNumber(layer.opacity, 0, 1, 1), Number(layer.sortOrder ?? index));
            });
            if (sourceLayers.length === 0) {
              const layerId = randomUUID();
              db.prepare(`
                INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order)
                VALUES (?, ?, ?, ?, '默认图层', 1, 0, 1, 0)
              `).run(layerId, now, now, mapId);
            }

            const sourceObjects = db.prepare(`
              SELECT id, layer_id as layerId, type, name, description, x, y,
                geometry_json as geometryJson, style_json as styleJson, properties_json as propertiesJson
              FROM map_objects
              WHERE map_id = ? AND deleted_at IS NULL
              ORDER BY updated_at DESC, id ASC
            `).all(sourceMapId) as Array<{
              id: string;
              layerId: string | null;
              type: string;
              name: string;
              description: string;
              x: number;
              y: number;
              geometryJson: string | null;
              styleJson: string | null;
              propertiesJson: string | null;
            }>;
            const fallbackLayerId = [...layerIdMap.values()][0]
              || (db.prepare('SELECT id FROM map_layers WHERE map_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC LIMIT 1').get(mapId) as { id: string }).id;
            const objectIdMap = new Map<string, string>();
            sourceObjects.forEach((object, index) => {
              const objectId = randomUUID();
              objectIdMap.set(object.id, objectId);
              const objectTime = new Date(Date.parse(now) - index).toISOString();
              db.prepare(`
                INSERT INTO map_objects (
                  id, created_at, updated_at, map_id, layer_id, type, name, description,
                  x, y, geometry_json, style_json, properties_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                objectId,
                objectTime,
                objectTime,
                mapId,
                (object.layerId && layerIdMap.get(object.layerId)) || fallbackLayerId,
                object.type,
                object.name || '',
                object.description || '',
                Number(object.x || 0),
                Number(object.y || 0),
                cloneJsonText(object.geometryJson),
                cloneJsonText(object.styleJson),
                cloneJsonText(object.propertiesJson)
              );
            });

            const sourceLinks = db.prepare(`
              SELECT source_entity_id as sourceEntityId, target_entity_type as targetEntityType,
                target_entity_id as targetEntityId, link_type as linkType, note
              FROM entity_links
              WHERE source_entity_type = 'map_object'
                AND deleted_at IS NULL
                AND source_entity_id IN (
                  SELECT id FROM map_objects WHERE map_id = ? AND deleted_at IS NULL
                )
            `).all(sourceMapId) as Array<{ sourceEntityId: string; targetEntityType: string; targetEntityId: string; linkType: string; note: string }>;
            sourceLinks.forEach((link) => {
              const targetObjectId = objectIdMap.get(link.sourceEntityId);
              if (!targetObjectId) return;
              db.prepare(`
                INSERT INTO entity_links (
                  id, created_at, updated_at, source_entity_type, source_entity_id,
                  target_entity_type, target_entity_id, link_type, note
                )
                VALUES (?, ?, ?, 'map_object', ?, ?, ?, ?, ?)
              `).run(randomUUID(), now, now, targetObjectId, link.targetEntityType, link.targetEntityId, link.linkType || '', link.note || '');
            });

            const row = db.prepare(`
              SELECT m.id, COALESCE(NULLIF(m.title, ''), m.name) as title, m.description,
                m.background_asset_id as backgroundAssetId,
                a.relative_path as backgroundAssetRelativePath, a.mime_type as backgroundAssetMimeType,
                m.canvas_width as canvasWidth, m.canvas_height as canvasHeight,
                m.source_map_id as sourceMapId, m.version_group_id as versionGroupId,
                COALESCE(NULLIF(source.title, ''), source.name) as sourceMapTitle,
                source.deleted_at as sourceMapDeletedAt,
                m.created_at as createdAt, m.updated_at as updatedAt
              FROM maps m
              LEFT JOIN assets a ON a.id = m.background_asset_id AND a.deleted_at IS NULL
              LEFT JOIN maps source ON source.id = m.source_map_id
              WHERE m.id = ?
            `).get(mapId);
            db.exec('COMMIT;');
            return mapRecord(vaultPath, row);
          } catch (error) {
            db.exec('ROLLBACK;');
            throw error;
          }
        })
      };
    } catch (error) {
      console.error('复制地图版本失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:saveMapLayers', (_event, vaultPath: string, input: { mapId: string; layers: any[]; deferDeletes?: boolean }) => {
    try {
      return {
        ok: true,
        layers: withDb(vaultPath, (db) => {
          const map = db.prepare('SELECT id FROM maps WHERE id = ? AND deleted_at IS NULL').get(input.mapId);
          if (!map) throw new Error('地图不存在或已被删除。');
          const layers = Array.isArray(input.layers) ? input.layers : [];
          if (layers.length === 0) throw new Error('每张地图至少需要一个图层。');
          const now = new Date().toISOString();
          const incomingIds = new Set(layers.map((layer) => String(layer.id || '')).filter(Boolean));
          const existing = db.prepare('SELECT id FROM map_layers WHERE map_id = ? AND deleted_at IS NULL').all(input.mapId) as Array<{ id: string }>;
          for (const row of existing) {
            if (!input.deferDeletes && !incomingIds.has(row.id)) {
              const objectCount = Number((db.prepare('SELECT COUNT(*) as count FROM map_objects WHERE map_id = ? AND layer_id = ? AND deleted_at IS NULL').get(input.mapId, row.id) as { count: number }).count);
              if (objectCount > 0) throw new Error('请先将图层中的对象移动到其他图层后再删除。');
              db.prepare('UPDATE map_layers SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
            }
          }
          layers.forEach((layer, index) => {
            const id = String(layer.id || randomUUID());
            const name = String(layer.name || '').trim() || '未命名图层';
            const visible = layer.visible === false ? 0 : 1;
            const locked = layer.locked === true ? 1 : 0;
            const opacity = clampNumber(layer.opacity, 0, 1, 1);
            const current = db.prepare('SELECT id FROM map_layers WHERE id = ? AND map_id = ? AND deleted_at IS NULL').get(id, input.mapId);
            if (current) {
              db.prepare(`
                UPDATE map_layers
                SET name = ?, visible = ?, locked = ?, opacity = ?, sort_order = ?, updated_at = ?
                WHERE id = ? AND map_id = ? AND deleted_at IS NULL
              `).run(name, visible, locked, opacity, index, now, id, input.mapId);
            } else {
              db.prepare(`
                INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(id, now, now, input.mapId, name, visible, locked, opacity, index);
            }
          });
          db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(now, input.mapId);
          return listMapLayers(db, input.mapId);
        })
      };
    } catch (error) {
      console.error('保存地图图层失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:getMapObjects', (_event, vaultPath: string, mapId: string) => {
    try {
      return {
        ok: true,
        objects: withDb(vaultPath, (db) => {
          ensureDefaultMapLayer(db, mapId);
          return listMapObjects(db, mapId);
        })
      };
    } catch (error) {
      console.error('读取地图对象失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('data:saveMapObjects', (_event, vaultPath: string, input: { mapId: string; objects: any[] }) => {
    try {
      return {
        ok: true,
        objects: withDb(vaultPath, (db) => {
          const map = db.prepare('SELECT id FROM maps WHERE id = ? AND deleted_at IS NULL').get(input.mapId);
          if (!map) throw new Error('地图不存在或已被删除。');
          const defaultLayerId = ensureDefaultMapLayer(db, input.mapId);
          const now = new Date().toISOString();
          const incoming = Array.isArray(input.objects) ? input.objects : [];
          const incomingIds = new Set(incoming.filter((object) => object.id).map((object) => String(object.id)));
          const existingRows = db.prepare('SELECT id FROM map_objects WHERE map_id = ? AND deleted_at IS NULL').all(input.mapId) as Array<{ id: string }>;
          for (const row of existingRows) {
            if (!incomingIds.has(row.id)) {
              db.prepare('UPDATE map_objects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, row.id);
              db.prepare(`UPDATE entity_links SET deleted_at = ?, updated_at = ? WHERE source_entity_type = 'map_object' AND source_entity_id = ? AND deleted_at IS NULL`).run(now, now, row.id);
            }
          }
          for (const object of incoming) {
            const id = String(object.id || randomUUID());
            const type = String(object.type || 'marker');
            const requestedLayerId = object.layerId ? String(object.layerId) : defaultLayerId;
            const targetLayer = db.prepare('SELECT id FROM map_layers WHERE id = ? AND map_id = ? AND deleted_at IS NULL').get(requestedLayerId, input.mapId);
            if (!targetLayer) throw new Error('对象所属图层不存在或已被删除。');
            const locationId = object.locationId ? String(object.locationId) : null;
            const targetEntityType = mapLinkableEntityTypes.has(String(object.targetEntityType || '')) ? String(object.targetEntityType) : null;
            const targetEntityId = object.targetEntityId ? String(object.targetEntityId) : null;
            const rawLinkedEntities = Array.isArray(object.linkedEntities) ? object.linkedEntities : [];
            const linkedEntities = dedupeMapObjectLinks([
              ...rawLinkedEntities.map((link: any) => ({
                entityType: mapLinkableEntityTypes.has(String(link?.entityType || '')) ? String(link.entityType) : '',
                entityId: String(link?.entityId || ''),
                linkType: String(link?.linkType || ''),
                note: String(link?.note || '')
              })),
              ...(locationId ? [{ entityType: 'location', entityId: locationId, linkType: 'happens_at', note: '' }] : []),
              ...(targetEntityType && targetEntityId ? [{ entityType: targetEntityType, entityId: targetEntityId, linkType: 'covers', note: '' }] : [])
            ]);
            for (const link of linkedEntities) {
              if (!entityExists(db, link.entityType, link.entityId)) {
                throw new Error('关联的资料不存在或已被删除。');
              }
            }
            const existing = db.prepare('SELECT id FROM map_objects WHERE id = ? AND deleted_at IS NULL').get(id);
            if (existing) {
              db.prepare(`
                UPDATE map_objects
                SET map_id = ?, layer_id = ?, type = ?, name = ?, description = ?, x = ?, y = ?, geometry_json = ?, style_json = ?, properties_json = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
              `).run(input.mapId, requestedLayerId, type, String(object.name || ''), String(object.description || ''), Number(object.x || 0), Number(object.y || 0), object.geometryJson || null, object.styleJson || null, object.propertiesJson || null, now, id);
            } else {
              db.prepare(`
                INSERT INTO map_objects (id, created_at, updated_at, map_id, layer_id, type, name, description, x, y, geometry_json, style_json, properties_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(id, now, now, input.mapId, requestedLayerId, type, String(object.name || ''), String(object.description || ''), Number(object.x || 0), Number(object.y || 0), object.geometryJson || null, object.styleJson || null, object.propertiesJson || null);
            }
            db.prepare(`UPDATE entity_links SET deleted_at = ?, updated_at = ? WHERE source_entity_type = 'map_object' AND source_entity_id = ? AND deleted_at IS NULL`).run(now, now, id);
            linkedEntities.forEach((link) => {
              db.prepare(`
                INSERT INTO entity_links (id, created_at, updated_at, source_entity_type, source_entity_id, target_entity_type, target_entity_id, link_type, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(randomUUID(), now, now, 'map_object', id, link.entityType, link.entityId, link.linkType || defaultMapObjectLinkType(link.entityType), link.note || '');
            });
          }
          db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(now, input.mapId);
          return listMapObjects(db, input.mapId);
        })
      };
    } catch (error) {
      console.error('保存地图对象失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function ownerTable(entityType: string): string {
  const map: Record<string, string> = {
    character_version: 'character_versions',
    codex_item: 'codex_items',
    event: 'events',
    location: 'locations',
    manuscript: 'manuscripts',
    timeline: 'timelines',
    map_object: 'map_objects'
  };
  return map[entityType] ?? '';
}

const mapLinkableEntityTypes = new Set(['location', 'event', 'character_version', 'codex_item']);

function globalSearch(db: ReturnType<typeof openDatabase>['db'], keyword: string): unknown[] {
  const like = `%${keyword}%`;
  const results: unknown[] = [];
  const pushRows = (rows: any[], entityType: string, kind: string, targetFor: (row: any) => Record<string, unknown>): void => {
    rows.forEach((row) => {
      results.push({
        id: `${entityType}:${row.id}`,
        entityType,
        entityId: row.id,
        kind,
        title: row.title,
        subtitle: row.subtitle ?? '',
        snippet: compactSnippet(row.snippet ?? '', keyword),
        updatedAt: row.updatedAt,
        target: targetFor(row)
      });
    });
  };

  pushRows(
    db.prepare(`
      SELECT
        cv.id,
        cv.character_id as characterId,
        c.name || ' / ' || cv.name as title,
        '' as subtitle,
        CASE
          WHEN cv.description LIKE ? COLLATE NOCASE THEN cv.description
          WHEN c.summary LIKE ? COLLATE NOCASE THEN c.summary
          WHEN COALESCE(cb.blockText, '') LIKE ? COLLATE NOCASE THEN cb.blockText
          ELSE COALESCE(NULLIF(cv.description, ''), c.summary, cb.blockText, '')
        END as snippet,
        cv.updated_at as updatedAt
      FROM character_versions cv
      INNER JOIN characters c ON c.id = cv.character_id AND c.deleted_at IS NULL
      LEFT JOIN (
        SELECT owner_entity_id, group_concat(title || ' ' || content_json, ' ') as blockText
        FROM content_blocks
        WHERE deleted_at IS NULL AND owner_entity_type = 'character_version'
        GROUP BY owner_entity_id
      ) cb ON cb.owner_entity_id = cv.id
      WHERE cv.deleted_at IS NULL AND (
        c.name LIKE ? COLLATE NOCASE OR c.summary LIKE ? COLLATE NOCASE OR cv.name LIKE ? COLLATE NOCASE
        OR cv.description LIKE ? COLLATE NOCASE OR COALESCE(cb.blockText, '') LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN c.name = ? OR cv.name = ? THEN 0 WHEN c.name LIKE ? OR cv.name LIKE ? THEN 1 ELSE 2 END, cv.updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, like, like, like, keyword, keyword, like, like),
    'character_version',
    'è§’è‰²ç‰ˆæœ¬',
    (row) => ({ module: 'characters', characterId: row.characterId, characterVersionId: row.id })
  );

  pushRows(
    db.prepare(`
      SELECT
        ci.id,
        ci.title,
        '' as subtitle,
        CASE
          WHEN COALESCE(ca.alias, '') LIKE ? COLLATE NOCASE THEN 'åˆ«åï¼š' || ca.alias
          WHEN ci.summary LIKE ? COLLATE NOCASE THEN ci.summary
          WHEN COALESCE(cb.blockText, '') LIKE ? COLLATE NOCASE THEN cb.blockText
          ELSE COALESCE(NULLIF(ci.summary, ''), cb.blockText, ca.alias, '')
        END as snippet,
        ci.updated_at as updatedAt
      FROM codex_items ci
      LEFT JOIN (
        SELECT codex_item_id, group_concat(alias, ' ') as alias
        FROM codex_aliases
        WHERE deleted_at IS NULL
        GROUP BY codex_item_id
      ) ca ON ca.codex_item_id = ci.id
      LEFT JOIN (
        SELECT owner_entity_id, group_concat(title || ' ' || content_json, ' ') as blockText
        FROM content_blocks
        WHERE deleted_at IS NULL AND owner_entity_type = 'codex_item'
        GROUP BY owner_entity_id
      ) cb ON cb.owner_entity_id = ci.id
      WHERE ci.deleted_at IS NULL AND (
        ci.title LIKE ? COLLATE NOCASE OR ci.summary LIKE ? COLLATE NOCASE
        OR COALESCE(ca.alias, '') LIKE ? COLLATE NOCASE OR COALESCE(cb.blockText, '') LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN ci.title = ? THEN 0 WHEN ci.title LIKE ? THEN 1 WHEN COALESCE(ca.alias, '') LIKE ? THEN 2 ELSE 3 END, ci.updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, like, like, keyword, like, like),
    'codex_item',
    'è¯æ¡',
    (row) => ({ module: 'codex', codexItemId: row.id })
  );

  pushRows(
    db.prepare(`
      SELECT
        id,
        title,
        CASE
          WHEN start_display_time <> '' AND end_display_time <> '' AND start_display_time <> end_display_time THEN start_display_time || ' â€” ' || end_display_time
          WHEN start_display_time <> '' THEN start_display_time
          WHEN end_display_time <> '' THEN end_display_time
          ELSE 'äº‹ä»¶'
        END as subtitle,
        CASE
          WHEN body LIKE ? COLLATE NOCASE THEN body
          WHEN start_display_time LIKE ? COLLATE NOCASE OR end_display_time LIKE ? COLLATE NOCASE THEN
            CASE
              WHEN start_display_time <> '' AND end_display_time <> '' AND start_display_time <> end_display_time THEN start_display_time || ' â€” ' || end_display_time
              ELSE COALESCE(NULLIF(start_display_time, ''), end_display_time)
            END
          WHEN duration_note LIKE ? COLLATE NOCASE THEN duration_note
          WHEN start_display_time <> '' OR end_display_time <> '' THEN
            CASE
              WHEN start_display_time <> '' AND end_display_time <> '' AND start_display_time <> end_display_time THEN start_display_time || ' â€” ' || end_display_time
              ELSE COALESCE(NULLIF(start_display_time, ''), end_display_time)
            END
          WHEN body <> '' THEN body
          ELSE duration_note
        END as snippet,
        updated_at as updatedAt
      FROM events
      WHERE deleted_at IS NULL AND (
        title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE OR start_display_time LIKE ? COLLATE NOCASE
        OR end_display_time LIKE ? COLLATE NOCASE OR duration_note LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN title = ? THEN 0 WHEN title LIKE ? THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, like, like, like, like, keyword, like),
    'event',
    'äº‹ä»¶',
    (row) => ({ module: 'events', eventId: row.id })
  );

  pushRows(
    db.prepare(`
      SELECT
        id,
        name as title,
        type as subtitle,
        CASE
          WHEN summary LIKE ? COLLATE NOCASE THEN summary
          WHEN body LIKE ? COLLATE NOCASE THEN body
          WHEN type LIKE ? COLLATE NOCASE THEN 'ç±»åž‹ï¼š' || type
          ELSE COALESCE(NULLIF(summary, ''), body, '')
        END as snippet,
        updated_at as updatedAt
      FROM locations
      WHERE deleted_at IS NULL AND (
        name LIKE ? COLLATE NOCASE OR type LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, like, like, keyword, like),
    'location',
    'åœ°ç‚¹',
    (row) => ({ module: 'locations', locationId: row.id })
  );

  pushRows(
    db.prepare(`
      SELECT
        id,
        title,
        manuscript_type as subtitle,
        CASE
          WHEN body LIKE ? COLLATE NOCASE THEN body
          WHEN manuscript_type LIKE ? COLLATE NOCASE THEN 'ç±»åž‹ï¼š' || manuscript_type
          ELSE body
        END as snippet,
        updated_at as updatedAt
      FROM manuscripts
      WHERE deleted_at IS NULL AND (
        title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE OR manuscript_type LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN title = ? THEN 0 WHEN title LIKE ? THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, keyword, like),
    'manuscript',
    'æ‰‹ç¨¿',
    (row) => ({ module: 'manuscripts', manuscriptId: row.id })
  );

  pushRows(
    db.prepare(`
      SELECT
        id,
        name as title,
        '' as subtitle,
        CASE
          WHEN description LIKE ? COLLATE NOCASE THEN description
          WHEN branch_note LIKE ? COLLATE NOCASE THEN branch_note
          ELSE COALESCE(NULLIF(description, ''), branch_note, '')
        END as snippet,
        updated_at as updatedAt
      FROM timelines
      WHERE deleted_at IS NULL AND (
        name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR branch_note LIKE ? COLLATE NOCASE
      )
      ORDER BY CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 5
    `).all(like, like, like, like, like, keyword, like),
    'timeline',
    'æ—¶é—´çº¿',
    (row) => ({ module: 'timeline', timelineId: row.id })
  );

  return results;
}

function compactSnippet(value: string, keyword = ''): string {
  const text = String(value ?? '').replace(/[{}\[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
  const needle = keyword.trim().toLocaleLowerCase();
  const hitIndex = needle ? text.toLocaleLowerCase().indexOf(needle) : -1;
  if (hitIndex >= 0) {
    const contextSize = 28;
    const start = Math.max(0, hitIndex - contextSize);
    const end = Math.min(text.length, hitIndex + keyword.length + contextSize);
    const prefix = start > 0 ? 'â€¦â€¦' : '';
    const suffix = end < text.length ? 'â€¦â€¦' : '';
    return `${prefix}${text.slice(start, end)}${suffix}`;
  }
  if (text.length <= 60) {
    return text;
  }
  return `${text.slice(0, 60)}â€¦â€¦`;
}

function touchOwner(db: ReturnType<typeof openDatabase>['db'], entityType: string, entityId: string, now: string): void {
  const table = ownerTable(entityType);
  if (table) {
    db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(now, entityId);
  }
}

function touchEntity(vaultPath: string, table: string, id: string): void {
  if (!table) {
    return;
  }
  withDb(vaultPath, (db) => db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id));
}

function entityExists(db: ReturnType<typeof openDatabase>['db'], entityType: string, id: string): boolean {
  if (entityType === 'character_version') {
    return Boolean(db.prepare(`
      SELECT cv.id
      FROM character_versions cv
      INNER JOIN characters c ON c.id = cv.character_id AND c.deleted_at IS NULL
      WHERE cv.id = ? AND cv.deleted_at IS NULL
    `).get(id));
  }
  if (entityType === 'map_object') {
    return Boolean(db.prepare(`
      SELECT mo.id
      FROM map_objects mo
      INNER JOIN maps m ON m.id = mo.map_id AND m.deleted_at IS NULL
      INNER JOIN map_layers ml ON ml.id = mo.layer_id AND ml.deleted_at IS NULL
      WHERE mo.id = ? AND mo.deleted_at IS NULL
    `).get(id));
  }
  const table = ownerTable(entityType);
  if (!table) {
    return false;
  }
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
  return Boolean(row);
}

function assetExists(db: ReturnType<typeof openDatabase>['db'], id: string): boolean {
  const row = db.prepare("SELECT id FROM assets WHERE id = ? AND deleted_at IS NULL AND asset_type = 'image'").get(id);
  return Boolean(row);
}

function assetFileUrl(vaultPath: string, assetId: string, relativePath: string, mimeType = ''): string {
  if (!assetId || !relativePath) {
    return '';
  }
  if (!assetFileExists(vaultPath, relativePath)) {
    console.error('è§’è‰²å›¾ç‰‡ç´ ææ–‡ä»¶ç¼ºå¤±', { assetId, relativePath, resolvedPath: resolveAssetPath(vaultPath, relativePath) });
    return '';
  }
  return assetUrlForId(vaultPath, assetId, relativePath, mimeType);
}

function mapRecord(vaultPath: string, row: any): unknown {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    backgroundAssetId: row.backgroundAssetId ?? null,
    backgroundAssetUrl: row.backgroundAssetId && row.backgroundAssetRelativePath
      ? assetFileUrl(vaultPath, row.backgroundAssetId, row.backgroundAssetRelativePath, row.backgroundAssetMimeType)
      : '',
    canvasWidth: Number(row.canvasWidth ?? 1600),
    canvasHeight: Number(row.canvasHeight ?? 1000),
    sourceMapId: row.sourceMapId ?? null,
    sourceMapTitle: row.sourceMapDeletedAt ? '' : row.sourceMapTitle ?? '',
    sourceMapDeleted: Boolean(row.sourceMapId && row.sourceMapDeletedAt),
    versionGroupId: row.versionGroupId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function listMapObjects(db: ReturnType<typeof openDatabase>['db'], mapId: string): unknown[] {
  const rows = db.prepare(`
    SELECT
      mo.id,
      mo.map_id as mapId,
      mo.layer_id as layerId,
      mo.type,
      mo.name,
      mo.description,
      mo.x,
      mo.y,
      mo.geometry_json as geometryJson,
      mo.style_json as styleJson,
      mo.properties_json as propertiesJson,
      mo.created_at as createdAt,
      mo.updated_at as updatedAt
    FROM map_objects mo
    WHERE mo.deleted_at IS NULL AND mo.map_id = ?
    ORDER BY mo.updated_at DESC
  `).all(mapId) as any[];
  if (rows.length === 0) {
    return rows;
  }

  const links = db.prepare(`
    SELECT
      el.id,
      el.source_entity_id as sourceEntityId,
      el.target_entity_type as targetEntityType,
      el.target_entity_id as targetEntityId,
      el.link_type as linkType,
      el.note,
      l.name as locationTitle,
      ev.title as eventTitle,
      ci.title as codexItemTitle,
      c.name || ' / ' || cv.name as characterVersionTitle
    FROM entity_links el
    LEFT JOIN locations l
      ON l.id = el.target_entity_id
      AND el.target_entity_type = 'location'
      AND l.deleted_at IS NULL
    LEFT JOIN events ev
      ON ev.id = el.target_entity_id
      AND el.target_entity_type = 'event'
      AND ev.deleted_at IS NULL
    LEFT JOIN codex_items ci
      ON ci.id = el.target_entity_id
      AND el.target_entity_type = 'codex_item'
      AND ci.deleted_at IS NULL
    LEFT JOIN character_versions cv
      ON cv.id = el.target_entity_id
      AND el.target_entity_type = 'character_version'
      AND cv.deleted_at IS NULL
    LEFT JOIN characters c
      ON c.id = cv.character_id
      AND c.deleted_at IS NULL
    WHERE el.source_entity_type = 'map_object'
      AND el.deleted_at IS NULL
      AND el.source_entity_id IN (${rows.map(() => '?').join(', ')})
    ORDER BY el.created_at ASC
  `).all(...rows.map((row) => row.id)) as any[];

  const linksByObjectId = new Map<string, any[]>();
  links.forEach((link) => {
    const current = linksByObjectId.get(String(link.sourceEntityId)) ?? [];
    current.push({
      id: String(link.id),
      entityType: String(link.targetEntityType),
      entityId: String(link.targetEntityId),
      title: mapLinkedEntityTitle(link),
      linkType: String(link.linkType || ''),
      note: String(link.note || ''),
      deleted: !mapLinkedEntityTitle(link)
    });
    linksByObjectId.set(String(link.sourceEntityId), current);
  });

  return rows.map((row) => {
    const linkedEntities = dedupeMapObjectLinks(linksByObjectId.get(String(row.id)) ?? []).map((link) => ({
      ...link,
      title: link.deleted ? '资料已删除' : link.title
    }));
    const markerLocation = linkedEntities.find((link) => link.entityType === 'location');
    const nonMarkerBinding = linkedEntities.find((link) => link.entityType !== 'location') ?? markerLocation ?? null;
    return {
      ...row,
      linkedEntities,
      locationId: markerLocation?.entityId ?? null,
      locationName: markerLocation?.deleted ? '' : markerLocation?.title ?? '',
      boundEntityType: nonMarkerBinding?.entityType ?? null,
      boundEntityId: nonMarkerBinding?.entityId ?? null,
      boundEntityTitle: nonMarkerBinding?.deleted ? '资料已删除' : nonMarkerBinding?.title ?? ''
    };
  });
}

function ensureDefaultMapLayer(db: ReturnType<typeof openDatabase>['db'], mapId: string): string {
  const existing = db.prepare(`
    SELECT id
    FROM map_layers
    WHERE map_id = ? AND deleted_at IS NULL
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1
  `).get(mapId) as { id: string } | undefined;
  let layerId = existing?.id;
  if (!layerId) {
    const map = db.prepare('SELECT id FROM maps WHERE id = ? AND deleted_at IS NULL').get(mapId);
    if (!map) throw new Error('地图不存在或已被删除。');
    const now = new Date().toISOString();
    layerId = randomUUID();
    db.prepare(`
      INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order)
      VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0)
    `).run(layerId, now, now, mapId, '默认图层');
  }
  db.prepare(`
    UPDATE map_objects
    SET layer_id = ?, updated_at = updated_at
    WHERE map_id = ? AND deleted_at IS NULL
      AND (
        layer_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM map_layers ml
          WHERE ml.id = map_objects.layer_id
            AND ml.map_id = map_objects.map_id
            AND ml.deleted_at IS NULL
        )
      )
  `).run(layerId, mapId);
  return layerId;
}

function listMapLayers(db: ReturnType<typeof openDatabase>['db'], mapId: string): unknown[] {
  return db.prepare(`
    SELECT
      ml.id,
      ml.map_id as mapId,
      ml.name,
      ml.visible,
      ml.locked,
      ml.opacity,
      ml.sort_order as sortOrder,
      CASE WHEN ml.created_at = (
        SELECT MIN(first_layer.created_at)
        FROM map_layers first_layer
        WHERE first_layer.map_id = ml.map_id AND first_layer.deleted_at IS NULL
      ) THEN 1 ELSE 0 END as isDefault,
      COUNT(mo.id) as objectCount
    FROM map_layers ml
    LEFT JOIN map_objects mo
      ON mo.layer_id = ml.id
      AND mo.map_id = ml.map_id
      AND mo.deleted_at IS NULL
    WHERE ml.map_id = ? AND ml.deleted_at IS NULL
    GROUP BY ml.id
    ORDER BY ml.sort_order ASC, ml.created_at ASC
  `).all(mapId).map((row: any) => ({
    ...row,
    visible: Boolean(row.visible),
    locked: Boolean(row.locked),
    opacity: clampNumber(row.opacity, 0, 1, 1),
    isDefault: Boolean(row.isDefault),
    sortOrder: Number(row.sortOrder || 0),
    objectCount: Number(row.objectCount || 0)
  }));
}

function defaultMapObjectLinkType(entityType: string): string {
  return entityType === 'location' ? 'happens_at' : 'related';
}

function dedupeMapObjectLinks(links: Array<{ entityType: string; entityId: string; title?: string; linkType?: string; note?: string; deleted?: boolean }>): Array<{ entityType: string; entityId: string; title: string; linkType: string; note: string; deleted: boolean }> {
  const deduped = new Map<string, { entityType: string; entityId: string; title: string; linkType: string; note: string; deleted: boolean }>();
  links.forEach((link) => {
    const entityType = String(link.entityType || '');
    const entityId = String(link.entityId || '');
    if (!mapLinkableEntityTypes.has(entityType) || !entityId) {
      return;
    }
    const key = `${entityType}:${entityId}`;
    if (deduped.has(key)) {
      return;
    }
    deduped.set(key, {
      entityType,
      entityId,
      title: String(link.title || ''),
      linkType: String(link.linkType || defaultMapObjectLinkType(entityType)),
      note: String(link.note || ''),
      deleted: Boolean(link.deleted)
    });
  });
  return [...deduped.values()];
}

function mapLinkedEntityTitle(link: any): string {
  if (link.targetEntityType === 'location') return String(link.locationTitle || '');
  if (link.targetEntityType === 'event') return String(link.eventTitle || '');
  if (link.targetEntityType === 'codex_item') return String(link.codexItemTitle || '');
  if (link.targetEntityType === 'character_version') return String(link.characterVersionTitle || '');
  return '';
}

function objectTypeLabel(type: string): string {
  if (type === 'marker') return '地点标记';
  if (type === 'label') return '文字标签';
  if (type === 'route') return '路线';
  if (type === 'region') return '区域';
  return '地图对象';
}

function listEntityMapLinks(db: ReturnType<typeof openDatabase>['db'], entityType: string, entityId: string): unknown[] {
  if (!mapLinkableEntityTypes.has(entityType) || !entityExists(db, entityType, entityId)) {
    return [];
  }

  return (db.prepare(`
    SELECT
      m.id as mapId,
      COALESCE(NULLIF(m.title, ''), m.name) as mapTitle,
      m.source_map_id as sourceMapId,
      COALESCE(NULLIF(source.title, ''), source.name) as sourceMapTitle,
      mo.id as objectId,
      mo.type as objectType,
      mo.name as objectName,
      mo.description as objectDescription,
      mo.properties_json as propertiesJson,
      (
        SELECT l2.name
        FROM entity_links el2
        INNER JOIN locations l2
          ON l2.id = el2.target_entity_id
          AND l2.deleted_at IS NULL
        WHERE el2.source_entity_type = 'map_object'
          AND el2.source_entity_id = mo.id
          AND el2.target_entity_type = 'location'
          AND el2.deleted_at IS NULL
        ORDER BY el2.created_at ASC
        LIMIT 1
      ) as primaryLocationTitle,
      ml.id as layerId,
      ml.name as layerName,
      ml.sort_order as layerSortOrder,
      el.link_type as linkType,
      el.note,
      el.created_at as createdAt
    FROM entity_links el
    INNER JOIN map_objects mo
      ON mo.id = el.source_entity_id
      AND mo.deleted_at IS NULL
      AND el.source_entity_type = 'map_object'
    INNER JOIN maps m
      ON m.id = mo.map_id
      AND m.deleted_at IS NULL
    LEFT JOIN maps source
      ON source.id = m.source_map_id
      AND source.deleted_at IS NULL
    INNER JOIN map_layers ml
      ON ml.id = mo.layer_id
      AND ml.deleted_at IS NULL
    WHERE el.deleted_at IS NULL
      AND el.target_entity_type = ?
      AND el.target_entity_id = ?
    ORDER BY LOWER(COALESCE(NULLIF(m.title, ''), m.name)) ASC, COALESCE(ml.sort_order, 0) ASC, el.created_at ASC
  `).all(entityType, entityId) as any[]).map((row) => ({
    mapId: String(row.mapId),
    mapTitle: String(row.mapTitle || '未命名地图'),
    sourceMapId: row.sourceMapId ?? null,
    sourceMapTitle: String(row.sourceMapTitle || ''),
    objectId: String(row.objectId),
    objectType: String(row.objectType || 'marker'),
    objectTypeLabel: objectTypeLabel(String(row.objectType || 'marker')),
    objectName: mapAssociationObjectName(row),
    objectDescription: String(row.objectDescription || ''),
    layerId: row.layerId ?? null,
    layerName: String(row.layerName || '默认图层'),
    layerSortOrder: Number(row.layerSortOrder || 0),
    linkType: String(row.linkType || ''),
    note: String(row.note || ''),
    createdAt: String(row.createdAt || '')
  }));
}

function mapAssociationObjectName(row: any): string {
  const objectType = String(row.objectType || 'marker');
  const objectName = String(row.objectName || '').trim();
  const properties = parseJsonText(row.propertiesJson);
  if (objectType === 'label') {
    return String(properties?.text || objectName || '未命名标签');
  }
  if (objectType === 'route') {
    return objectName || '未命名路线';
  }
  if (objectType === 'region') {
    return objectName || '未命名区域';
  }
  return objectName || String(row.primaryLocationTitle || '') || '未命名点位';
}

function parseJsonText(value: unknown): any {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function cloneJsonText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return JSON.stringify(JSON.parse(String(value)));
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

const trashTables: Record<string, string> = {
  character: 'characters',
  character_version: 'character_versions',
  codex_item: 'codex_items',
  event: 'events',
  location: 'locations',
  timeline: 'timelines',
  map: 'maps',
  manuscript: 'manuscripts'
};

function trashEntityTable(entityType: string): string {
  const table = trashTables[entityType];
  if (!table) {
    throw new Error('不支持恢复该资料类型。');
  }
  return table;
}

function listTrashItems(db: ReturnType<typeof openDatabase>['db']): unknown[] {
  return db.prepare(`
    SELECT * FROM (
      SELECT 'character' as entityType, id, name as title, deleted_at as deletedAt,
        NULL as parentTitle, 0 as parentDeleted, NULL as sourceTitle
      FROM characters WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'character_version', cv.id, cv.name, cv.deleted_at,
        c.name, CASE WHEN c.deleted_at IS NOT NULL THEN 1 ELSE 0 END, NULL
      FROM character_versions cv
      LEFT JOIN characters c ON c.id = cv.character_id
      WHERE cv.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'codex_item', id, title, deleted_at, NULL, 0, NULL
      FROM codex_items WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'event', id, title, deleted_at, NULL, 0, NULL
      FROM events WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'location', id, name, deleted_at, NULL, 0, NULL
      FROM locations WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'timeline', id, name, deleted_at, NULL, 0, NULL
      FROM timelines WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'map', m.id, COALESCE(NULLIF(m.title, ''), m.name), m.deleted_at,
        NULL, 0, COALESCE(NULLIF(source.title, ''), source.name)
      FROM maps m
      LEFT JOIN maps source ON source.id = m.source_map_id
      WHERE m.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'manuscript', id, title, deleted_at, NULL, 0, NULL
      FROM manuscripts WHERE deleted_at IS NOT NULL
    )
    ORDER BY deletedAt DESC
  `).all();
}

function assertTrashItemExists(db: ReturnType<typeof openDatabase>['db'], entityType: string, id: string): void {
  let row: unknown;
  switch (entityType) {
    case 'character':
      row = db.prepare('SELECT id FROM characters WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'character_version':
      row = db.prepare('SELECT id FROM character_versions WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'codex_item':
      row = db.prepare('SELECT id FROM codex_items WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'event':
      row = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'location':
      row = db.prepare('SELECT id FROM locations WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'timeline':
      row = db.prepare('SELECT id FROM timelines WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'map':
      row = db.prepare('SELECT id FROM maps WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    case 'manuscript':
      row = db.prepare('SELECT id FROM manuscripts WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      break;
    default:
      throw new Error('不支持永久删除该资料类型。');
  }
  if (!row) {
    throw new Error('该资料不在回收站中，无法永久删除。');
  }
}

function permanentlyDeleteTrashItem(db: ReturnType<typeof openDatabase>['db'], entityType: string, id: string): void {
  switch (entityType) {
    case 'character':
      permanentlyDeleteCharacter(db, id);
      return;
    case 'character_version':
      permanentlyDeleteCharacterVersion(db, id);
      return;
    case 'codex_item':
      deleteOwnedData(db, 'codex_item', id);
      db.prepare('DELETE FROM codex_aliases WHERE codex_item_id = ?').run(id);
      db.prepare('DELETE FROM codex_items WHERE id = ?').run(id);
      return;
    case 'event':
      db.prepare('UPDATE timelines SET branch_event_id = NULL WHERE branch_event_id = ?').run(id);
      db.prepare('UPDATE relationship_stages SET related_event_id = NULL WHERE related_event_id = ?').run(id);
      deleteOwnedData(db, 'event', id);
      db.prepare('DELETE FROM events WHERE id = ?').run(id);
      return;
    case 'location':
      deleteOwnedData(db, 'location', id);
      db.prepare('DELETE FROM locations WHERE id = ?').run(id);
      return;
    case 'timeline':
      permanentlyDeleteTimeline(db, id);
      return;
    case 'map':
      permanentlyDeleteMap(db, id);
      return;
    case 'manuscript':
      deleteOwnedData(db, 'manuscript', id);
      db.prepare('DELETE FROM manuscripts WHERE id = ?').run(id);
      return;
    default:
      throw new Error('不支持永久删除该资料类型。');
  }
}

function permanentlyDeleteCharacter(db: ReturnType<typeof openDatabase>['db'], characterId: string): void {
  const versionIds = (db.prepare('SELECT id FROM character_versions WHERE character_id = ?').all(characterId) as Array<{ id: string }>).map((row) => row.id);
  deleteRelationshipsForVersions(db, versionIds);
  for (const versionId of versionIds) {
    deleteOwnedData(db, 'character_version', versionId);
  }
  deleteOwnedData(db, 'character', characterId);
  db.prepare('DELETE FROM character_versions WHERE character_id = ?').run(characterId);
  db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
}

function permanentlyDeleteCharacterVersion(db: ReturnType<typeof openDatabase>['db'], versionId: string): void {
  deleteRelationshipsForVersions(db, [versionId]);
  deleteOwnedData(db, 'character_version', versionId);
  db.prepare('DELETE FROM character_versions WHERE id = ?').run(versionId);
}

function deleteRelationshipsForVersions(db: ReturnType<typeof openDatabase>['db'], versionIds: string[]): void {
  const relationshipIds = new Set<string>();
  for (const versionId of versionIds) {
    const rows = db.prepare(`
      SELECT id FROM relationships
      WHERE source_character_version_id = ? OR target_character_version_id = ?
    `).all(versionId, versionId) as Array<{ id: string }>;
    rows.forEach((row) => relationshipIds.add(row.id));
  }
  for (const relationshipId of relationshipIds) {
    const stageIds = db.prepare('SELECT id FROM relationship_stages WHERE relationship_id = ?').all(relationshipId) as Array<{ id: string }>;
    for (const stage of stageIds) {
      deleteOwnedData(db, 'relationship_stage', stage.id);
    }
    deleteOwnedData(db, 'relationship', relationshipId);
    db.prepare('DELETE FROM relationship_stages WHERE relationship_id = ?').run(relationshipId);
    db.prepare('DELETE FROM relationships WHERE id = ?').run(relationshipId);
  }
}

function permanentlyDeleteTimeline(db: ReturnType<typeof openDatabase>['db'], timelineId: string): void {
  db.prepare('UPDATE character_versions SET timeline_id = NULL WHERE timeline_id = ?').run(timelineId);
  db.prepare('UPDATE events SET timeline_id = NULL WHERE timeline_id = ?').run(timelineId);
  db.prepare('UPDATE relationships SET timeline_id = NULL WHERE timeline_id = ?').run(timelineId);
  db.prepare(`
    UPDATE timelines
    SET parent_timeline_id = NULL, branch_event_id = NULL, branch_note = ''
    WHERE parent_timeline_id = ?
  `).run(timelineId);
  deleteOwnedData(db, 'timeline', timelineId);
  db.prepare('DELETE FROM timelines WHERE id = ?').run(timelineId);
}

function permanentlyDeleteMap(db: ReturnType<typeof openDatabase>['db'], mapId: string): void {
  const objectIds = db.prepare('SELECT id FROM map_objects WHERE map_id = ?').all(mapId) as Array<{ id: string }>;
  for (const object of objectIds) {
    deleteOwnedData(db, 'map_object', object.id);
  }
  deleteOwnedData(db, 'map', mapId);
  db.prepare('UPDATE maps SET source_map_id = NULL WHERE source_map_id = ?').run(mapId);
  db.prepare('DELETE FROM map_objects WHERE map_id = ?').run(mapId);
  db.prepare('DELETE FROM map_layers WHERE map_id = ?').run(mapId);
  db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
}

function deleteOwnedData(db: ReturnType<typeof openDatabase>['db'], entityType: string, entityId: string): void {
  db.prepare('DELETE FROM content_blocks WHERE owner_entity_type = ? AND owner_entity_id = ?').run(entityType, entityId);
  deleteEntityReferences(db, entityType, entityId);
  db.prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
}

function deleteEntityReferences(db: ReturnType<typeof openDatabase>['db'], entityType: string, entityId: string): void {
  db.prepare(`
    DELETE FROM entity_links
    WHERE (source_entity_type = ? AND source_entity_id = ?)
       OR (target_entity_type = ? AND target_entity_id = ?)
  `).run(entityType, entityId, entityType, entityId);
}

function softDelete(vaultPath: string, table: string, id: string, message: string): { ok: boolean; error?: string } {
  try {
    withDb(vaultPath, (db) => db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(new Date().toISOString(), new Date().toISOString(), id));
    return { ok: true };
  } catch (error) {
    console.error(message, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function listRows(vaultPath: string, table: string, titleColumn: string): { ok: boolean; items?: unknown[]; error?: string } {
  try {
    return {
      ok: true,
      items: withDb(vaultPath, (db) =>
        db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY updated_at DESC`).all()
      ).map((row: any) => ({
        ...row,
        title: row.title ?? row[titleColumn],
        name: row.name ?? row[titleColumn],
        exportEnabled: row.export_enabled,
        manuscriptType: row.manuscript_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  } catch (error) {
    console.error(`è¯»å– ${table} å¤±è´¥`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function createLocationLike(vaultPath: string, table: string, columns: string[], values: Array<string | number | null>, message: string): { ok: boolean; item?: unknown; error?: string } {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ${table} (id, created_at, updated_at, ${columns.join(', ')}) VALUES (?, ?, ?, ${placeholders})`).run(id, now, now, ...values);
        return { id, createdAt: now, updatedAt: now };
      })
    };
  } catch (error) {
    console.error(message, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function updateLocation(vaultPath: string, input: { id: string; name: string; type: string; summary: string; body: string; exportEnabled: number }) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        db.prepare('UPDATE locations SET name = ?, type = ?, summary = ?, body = ?, export_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          input.name.trim() || 'æœªå‘½ååœ°ç‚¹',
          input.type,
          input.summary,
          input.body,
          input.exportEnabled ? 1 : 0,
          now,
          input.id
        );
        return { ...input, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('æ›´æ–°åœ°ç‚¹å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function updateManuscript(vaultPath: string, input: { id: string; title: string; body: string; manuscriptType: string; exportEnabled: number }) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        db.prepare('UPDATE manuscripts SET title = ?, body = ?, manuscript_type = ?, export_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          input.title.trim() || 'æœªå‘½åæ‰‹ç¨¿',
          input.body,
          input.manuscriptType,
          input.exportEnabled ? 1 : 0,
          now,
          input.id
        );
        return { ...input, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('æ›´æ–°æ‰‹ç¨¿å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function createEvent(vaultPath: string, input: Record<string, unknown>) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const timelineId = typeof input.timelineId === 'string' && input.timelineId ? input.timelineId : null;
        if (timelineId && !entityExists(db, 'timeline', timelineId)) {
          throw new Error('æ—¶é—´çº¿ä¸å­˜åœ¨ã€‚');
        }
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO events
          (id, created_at, updated_at, title, timeline_id, start_display_time, end_display_time, duration_note, start_sort_index, end_sort_index, body, export_enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          now,
          now,
          String(input.title || 'æœªå‘½åäº‹ä»¶'),
          timelineId,
          String(input.startDisplayTime || ''),
          String(input.endDisplayTime || ''),
          String(input.durationNote || ''),
          Number(input.startSortIndex || 0),
          Number(input.endSortIndex || 0),
          String(input.body || ''),
          input.exportEnabled ? 1 : 0
        );
        return { id, createdAt: now, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('åˆ›å»ºäº‹ä»¶å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function updateEvent(vaultPath: string, input: Record<string, unknown>) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const timelineId = typeof input.timelineId === 'string' && input.timelineId ? input.timelineId : null;
        if (timelineId && !entityExists(db, 'timeline', timelineId)) {
          throw new Error('æ—¶é—´çº¿ä¸å­˜åœ¨ã€‚');
        }
        const now = new Date().toISOString();
        db.prepare(`UPDATE events
          SET title = ?, timeline_id = ?, start_display_time = ?, end_display_time = ?, duration_note = ?, start_sort_index = ?, end_sort_index = ?, body = ?, export_enabled = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`).run(
          String(input.title || 'æœªå‘½åäº‹ä»¶'),
          timelineId,
          String(input.startDisplayTime || ''),
          String(input.endDisplayTime || ''),
          String(input.durationNote || ''),
          Number(input.startSortIndex || 0),
          Number(input.endSortIndex || 0),
          String(input.body || ''),
          input.exportEnabled ? 1 : 0,
          now,
          String(input.id)
        );
        return { ...input, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('æ›´æ–°äº‹ä»¶å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function createTimeline(vaultPath: string, input: Record<string, unknown>) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO timelines
          (id, created_at, updated_at, name, description, parent_timeline_id, branch_event_id, branch_note, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          now,
          now,
          String(input.name || 'æœªå‘½åæ—¶é—´çº¿'),
          String(input.description || ''),
          typeof input.parentTimelineId === 'string' && input.parentTimelineId ? input.parentTimelineId : null,
          typeof input.branchEventId === 'string' && input.branchEventId ? input.branchEventId : null,
          String(input.branchNote || ''),
          Number(input.sortOrder || 0)
        );
        return { id, createdAt: now, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('åˆ›å»ºæ—¶é—´çº¿å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function updateTimeline(vaultPath: string, input: Record<string, unknown>) {
  try {
    return {
      ok: true,
      item: withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        db.prepare(`UPDATE timelines
          SET name = ?, description = ?, parent_timeline_id = ?, branch_event_id = ?, branch_note = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`).run(
          String(input.name || 'æœªå‘½åæ—¶é—´çº¿'),
          String(input.description || ''),
          typeof input.parentTimelineId === 'string' && input.parentTimelineId ? input.parentTimelineId : null,
          typeof input.branchEventId === 'string' && input.branchEventId ? input.branchEventId : null,
          String(input.branchNote || ''),
          Number(input.sortOrder || 0),
          now,
          String(input.id)
        );
        return { ...input, updatedAt: now };
      })
    };
  } catch (error) {
    console.error('æ›´æ–°æ—¶é—´çº¿å¤±è´¥', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
