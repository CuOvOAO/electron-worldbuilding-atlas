import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const assetScheme = 'atlas-asset';
const assetEntries = new Map<string, { filePath: string; mimeType: string }>();

export function registerAssetProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: assetScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ]);
}

export function registerAssetProtocolHandler(): void {
  protocol.handle(assetScheme, async (request) => {
    const assetId = assetIdFromUrl(request.url);
    const entry = assetId ? assetEntries.get(assetId) : null;
    if (!entry || !existsSync(entry.filePath)) {
      console.error('Asset protocol missing file', { assetId, filePath: entry?.filePath });
      return new Response('Asset not found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(entry.filePath).href);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        'Content-Type': entry.mimeType,
        'Access-Control-Allow-Origin': '*'
      }
    });
  });
}

export function assetUrlForId(vaultPath: string, assetId: string, relativePath: string, mimeType = ''): string {
  const filePath = resolveAssetPath(vaultPath, relativePath);
  assetEntries.set(assetId, { filePath, mimeType: mimeType || mimeTypeFromPath(filePath) });
  return `${assetScheme}://${encodeURIComponent(assetId)}`;
}

export function assetFileExists(vaultPath: string, relativePath: string): boolean {
  try {
    return existsSync(resolveAssetPath(vaultPath, relativePath));
  } catch (error) {
    console.error('Asset path check failed', { relativePath, error });
    return false;
  }
}

export function resolveAssetPath(vaultPath: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error('素材路径无效。');
  }
  const normalized = normalize(relativePath);
  const assetsRoot = resolve(vaultPath, 'assets');
  const filePath = resolve(vaultPath, normalized);
  const distance = relative(assetsRoot, filePath);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    throw new Error('素材路径越界。');
  }
  return filePath;
}

export function assetRelativePath(...parts: string[]): string {
  return join(...parts).replace(/\\/g, '/');
}

function assetIdFromUrl(value: string): string {
  const parsed = new URL(value);
  return decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\/+/, ''));
}

function mimeTypeFromPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}
