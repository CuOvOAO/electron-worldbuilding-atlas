import { BrowserWindow, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { assetFileExists, assetRelativePath, assetUrlForId, resolveAssetPath } from '../assets/assetProtocol';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { ensureVaultReady, worldDbPath } from '../vault/vaultService';

type Db = ReturnType<typeof openDatabase>['db'];

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

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

export function registerAssetIpc(): void {
  ipcMain.handle('asset:importImage', async (event, vaultPath: string) => {
    try {
      ensureVaultReady(vaultPath);
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showOpenDialog(window, imageDialogOptions())
        : await dialog.showOpenDialog(imageDialogOptions());

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, asset: null, cancelled: true };
      }

      const sourcePath = result.filePaths[0];
      const ext = extname(sourcePath).toLowerCase();
      if (!imageExtensions.has(ext)) {
        return { ok: false, error: '请选择 PNG、JPG、WEBP 或 GIF 图片。' };
      }

      const imagesDir = join(vaultPath, 'assets', 'images');
      mkdirSync(imagesDir, { recursive: true });
      const originalName = basename(sourcePath);
      const fileName = `${datePrefix(new Date())}_${randomUUID().slice(0, 8)}_${safeFileName(originalName)}`;
      const relativePath = assetRelativePath('assets', 'images', fileName);
      const targetPath = resolveAssetPath(vaultPath, relativePath);
      copyFileSync(sourcePath, targetPath);
      const copiedSize = statSync(targetPath).size;
      if (copiedSize <= 0) {
        throw new Error('图片文件复制失败：目标文件为空。');
      }

      const asset = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`
          INSERT INTO assets (id, created_at, updated_at, asset_type, relative_path, original_name, mime_type)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, now, now, 'image', relativePath, originalName, mimeTypes[ext] ?? 'image/*');
        return assetRecord(vaultPath, { id, created_at: now, updated_at: now, asset_type: 'image', relative_path: relativePath, original_name: originalName, mime_type: mimeTypes[ext] ?? 'image/*', used_count: 0 });
      });

      return { ok: true, asset, cancelled: false };
    } catch (error) {
      console.error('导入图片失败', error);
      return { ok: false, error: readableAssetError(error) };
    }
  });

  ipcMain.handle('asset:listImages', (_event, vaultPath: string) => {
    try {
      return {
        ok: true,
        assets: withDb(vaultPath, (db) => listImageAssets(db, vaultPath))
      };
    } catch (error) {
      console.error('读取图片素材失败', error);
      return { ok: false, error: readableAssetError(error) };
    }
  });

  ipcMain.handle('asset:deleteAsset', (_event, vaultPath: string, assetId: string) => {
    try {
      withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, assetId);
        db.prepare('UPDATE characters SET avatar_asset_id = NULL, updated_at = ? WHERE avatar_asset_id = ? AND deleted_at IS NULL').run(now, assetId);
        db.prepare('UPDATE characters SET full_body_asset_id = NULL, updated_at = ? WHERE full_body_asset_id = ? AND deleted_at IS NULL').run(now, assetId);
      });
      return { ok: true };
    } catch (error) {
      console.error('删除素材失败', error);
      return { ok: false, error: readableAssetError(error) };
    }
  });

  ipcMain.handle('asset:getUrl', (_event, vaultPath: string, relativePath: string) => {
    try {
      return { ok: true, url: assetUrl(vaultPath, relativePath, relativePath) };
    } catch (error) {
      console.error('生成素材路径失败', error);
      return { ok: false, error: readableAssetError(error) };
    }
  });

  ipcMain.handle('asset:saveCroppedImage', (_event, vaultPath: string, input: { dataUrl: string; slot: 'avatar' | 'fullBody'; originalName?: string }) => {
    try {
      ensureVaultReady(vaultPath);
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(input.dataUrl || ''));
      if (!match) {
        throw new Error('裁剪结果格式无效。');
      }
      const imagesDir = join(vaultPath, 'assets', 'images');
      mkdirSync(imagesDir, { recursive: true });
      const fileName = `${input.slot === 'avatar' ? 'crop_avatar' : 'crop_fullbody'}_${compactDate(new Date())}_${randomUUID().slice(0, 8)}.png`;
      const relativePath = assetRelativePath('assets', 'images', fileName);
      const targetPath = resolveAssetPath(vaultPath, relativePath);
      writeFileSync(targetPath, Buffer.from(match[1], 'base64'));
      const copiedSize = statSync(targetPath).size;
      if (copiedSize <= 0) {
        throw new Error('裁剪结果保存失败：目标文件为空。');
      }

      const asset = withDb(vaultPath, (db) => {
        const now = new Date().toISOString();
        const id = randomUUID();
        const originalName = safeFileName(input.originalName || fileName);
        db.prepare(`
          INSERT INTO assets (id, created_at, updated_at, asset_type, relative_path, original_name, mime_type)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, now, now, 'image', relativePath, originalName, 'image/png');
        return assetRecord(vaultPath, { id, created_at: now, updated_at: now, asset_type: 'image', relative_path: relativePath, original_name: originalName, mime_type: 'image/png', used_count: 0 });
      });

      return { ok: true, asset };
    } catch (error) {
      console.error('保存裁剪图片失败', error);
      return { ok: false, error: readableAssetError(error) };
    }
  });
}

function listImageAssets(db: Db, vaultPath: string): unknown[] {
  return (db.prepare(`
    SELECT a.id, a.created_at, a.updated_at, a.asset_type, a.relative_path, a.original_name, a.mime_type,
      (
        SELECT COUNT(*)
        FROM characters c
        WHERE c.deleted_at IS NULL AND (c.avatar_asset_id = a.id OR c.full_body_asset_id = a.id)
      ) as used_count
    FROM assets a
    WHERE a.deleted_at IS NULL AND a.asset_type = 'image'
    ORDER BY a.updated_at DESC
  `).all() as any[]).map((row) => assetRecord(vaultPath, row));
}

function assetRecord(vaultPath: string, row: any): unknown {
  return {
    id: row.id,
    assetType: row.asset_type,
    relativePath: row.relative_path,
    originalName: row.original_name,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usedCount: Number(row.used_count ?? 0),
    fileExists: assetFileExists(vaultPath, row.relative_path),
    url: assetUrl(vaultPath, row.id, row.relative_path, row.mime_type)
  };
}

function assetUrl(vaultPath: string, assetId: string, relativePath: string, mimeType = ''): string {
  if (!assetFileExists(vaultPath, relativePath)) {
    console.error('图片素材文件缺失', { assetId, relativePath, resolvedPath: resolveAssetPath(vaultPath, relativePath) });
    return '';
  }
  return assetUrlForId(vaultPath, assetId, relativePath, mimeType);
}
function imageDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: '导入图片素材',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  };
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'image';
}

function datePrefix(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function compactDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function readableAssetError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('world.db')) return '素材操作失败：当前存档数据库不存在。';
  if (message.includes('project.json')) return '素材操作失败：当前存档信息损坏。';
  if (message.includes('ENOENT')) return '素材操作失败：文件不存在或保存位置不可用。';
  if (message.includes('EACCES') || message.includes('EPERM')) return '素材操作失败：没有权限读取或写入文件。';
  return `素材操作失败：${message}`;
}

