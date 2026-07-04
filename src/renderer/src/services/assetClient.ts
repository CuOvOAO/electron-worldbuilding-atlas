export interface AssetRecord {
  id: string;
  assetType: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  usedCount: number;
  url: string;
  fileExists?: boolean;
}

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '素材操作失败。');
  }
  return result;
}

export const assetClient = {
  async importImage(vaultPath: string): Promise<AssetRecord | null> {
    return unwrap(await window.manuscriptAtlas.assets.importImage(vaultPath)).asset as AssetRecord | null;
  },
  async listImages(vaultPath: string): Promise<AssetRecord[]> {
    return unwrap(await window.manuscriptAtlas.assets.listImages(vaultPath)).assets as AssetRecord[];
  },
  async deleteAsset(vaultPath: string, assetId: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.assets.deleteAsset(vaultPath, assetId));
  },
  async getUrl(vaultPath: string, relativePath: string): Promise<string> {
    return unwrap(await window.manuscriptAtlas.assets.getUrl(vaultPath, relativePath)).url;
  },
  async saveCroppedImage(vaultPath: string, input: { dataUrl: string; slot: 'avatar' | 'fullBody'; originalName?: string }): Promise<AssetRecord> {
    return unwrap(await window.manuscriptAtlas.assets.saveCroppedImage(vaultPath, input)).asset as AssetRecord;
  }
};
