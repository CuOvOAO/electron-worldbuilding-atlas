import type { VaultProject } from '../types/entities';

function messageFromResult(result: { ok: false; error?: string; canceled?: boolean }): string {
  return result.error ?? '操作失败。';
}

export const vaultClient = {
  listRecent(): Promise<VaultProject[]> {
    return window.manuscriptAtlas.vault.listRecent();
  },

  chooseDirectory(): Promise<string | null> {
    return window.manuscriptAtlas.vault.chooseDirectory();
  },

  async create(input: { parentDir: string; name: string; description: string }): Promise<VaultProject> {
    const result = await window.manuscriptAtlas.vault.create(input);
    if (!result.ok) {
      throw new Error(messageFromResult(result));
    }
    return result.vault;
  },

  async openDialog(): Promise<VaultProject | null> {
    const result = await window.manuscriptAtlas.vault.openDialog();
    if (!result.ok) {
      if (result.canceled) {
        return null;
      }
      throw new Error(messageFromResult(result));
    }
    return result.vault;
  },

  async openPath(vaultPath: string): Promise<VaultProject> {
    const result = await window.manuscriptAtlas.vault.openPath(vaultPath);
    if (!result.ok) {
      throw new Error(messageFromResult(result));
    }
    return result.vault;
  }
};
