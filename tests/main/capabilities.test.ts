import { describe, expect, it } from 'vitest';
import {
  assertArchivePathAuthorized,
  assertDirectoryPathAuthorized,
  assertVaultPathAuthorized,
  authorizeArchivePath,
  authorizeDirectoryPath,
  authorizeVaultPath
} from '../../src/main/security/capabilities';

describe('main-process path capabilities', () => {
  it('rejects paths until their corresponding system flow authorizes them', () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const vault = `C:\\vault-${suffix}`;
    const directory = `C:\\directory-${suffix}`;
    const archive = `C:\\archive-${suffix}.zip`;
    expect(() => assertVaultPathAuthorized(vault)).toThrow('尚未由应用打开');
    expect(() => assertDirectoryPathAuthorized(directory)).toThrow('未经系统选择');
    expect(() => assertArchivePathAuthorized(archive)).toThrow('未经系统选择');
    authorizeVaultPath(vault);
    authorizeDirectoryPath(directory);
    authorizeArchivePath(archive);
    expect(() => assertVaultPathAuthorized(vault)).not.toThrow();
    expect(() => assertDirectoryPathAuthorized(directory)).not.toThrow();
    expect(() => assertArchivePathAuthorized(archive)).not.toThrow();
  });
});
