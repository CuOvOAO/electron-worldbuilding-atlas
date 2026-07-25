import { resolve } from 'node:path';

const vaultPaths = new Set<string>();
const directoryPaths = new Set<string>();
const archivePaths = new Set<string>();

export function authorizeVaultPath(path: string): void {
  vaultPaths.add(normalize(path));
}

export function assertVaultPathAuthorized(path: string): void {
  if (!vaultPaths.has(normalize(path))) throw new Error('该存档尚未由应用打开，已拒绝访问。');
}

export function authorizeDirectoryPath(path: string): void {
  directoryPaths.add(normalize(path));
}

export function assertDirectoryPathAuthorized(path: string): void {
  if (!directoryPaths.has(normalize(path))) throw new Error('该目录未经系统选择，已拒绝访问。');
}

export function authorizeArchivePath(path: string): void {
  archivePaths.add(normalize(path));
}

export function assertArchivePathAuthorized(path: string): void {
  if (!archivePaths.has(normalize(path))) throw new Error('该备份包未经系统选择，已拒绝访问。');
}

function normalize(path: string): string {
  const normalized = resolve(String(path || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
