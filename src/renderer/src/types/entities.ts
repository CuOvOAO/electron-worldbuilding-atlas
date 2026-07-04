export interface VaultProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  path: string;
}

export interface RecentEditItem {
  entityType: 'character_version' | 'codex_item' | 'event' | 'location' | 'manuscript' | 'timeline' | 'map';
  kind: string;
  id: string;
  characterId: string | null;
  title: string;
  detail: string;
  updatedAt: string;
}

export interface CharacterEntity {
  id: string;
  name: string;
  summary: string;
  avatarAssetId: string | null;
  fullBodyAssetId: string | null;
  avatarAssetRelativePath?: string | null;
  avatarAssetOriginalName?: string | null;
  avatarAssetMimeType?: string | null;
  avatarAssetUrl?: string;
  fullBodyAssetRelativePath?: string | null;
  fullBodyAssetOriginalName?: string | null;
  fullBodyAssetMimeType?: string | null;
  fullBodyAssetUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterVersionEntity {
  id: string;
  characterId: string;
  name: string;
  description: string;
  timelineId: string | null;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodexItemEntity {
  id: string;
  title: string;
  summary: string;
  type: string;
  exportEnabled: number;
  createdAt: string;
  updatedAt: string;
}

export type IpcResult<T> = { ok: true } & T | { ok: false; error?: string; canceled?: boolean };
