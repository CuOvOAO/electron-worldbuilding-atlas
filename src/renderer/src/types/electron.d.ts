import type { CharacterEntity, CharacterVersionEntity, CodexItemEntity, IpcResult, RecentEditItem, VaultProject } from './entities';
import type { NavigationTarget } from './app';

interface GlobalSearchResult {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  title: string;
  subtitle: string;
  snippet: string;
  updatedAt: string;
  target: NavigationTarget;
}

declare global {
  interface Window {
    manuscriptAtlas: {
      version: string;
      platform: string;
      vault: {
        listRecent: () => Promise<VaultProject[]>;
        chooseDirectory: () => Promise<string | null>;
        create: (input: { parentDir: string; name: string; description: string }) => Promise<IpcResult<{ vault: VaultProject }>>;
        openDialog: () => Promise<IpcResult<{ vault: VaultProject }>>;
        openPath: (vaultPath: string) => Promise<IpcResult<{ vault: VaultProject }>>;
      };
      export: {
        summary: (vaultPath: string) => Promise<IpcResult<{ summary: unknown }>>;
        markdown: (vaultPath: string, options: unknown) => Promise<IpcResult<{ success: boolean; cancelled: boolean; filePath?: string; fileName?: string }>>;
        mapPng: (vaultPath: string, input: unknown) => Promise<IpcResult<{ success: boolean; cancelled: boolean; filePath?: string; fileName?: string }>>;
        mapPngBatch: (vaultPath: string, input: unknown) => Promise<IpcResult<{ success: boolean; cancelled: boolean; successCount: number; failedCount: number; errors: string[]; directory?: string }>>;
      };
      backup: {
        createFullVaultBackup: (vaultPath: string) => Promise<IpcResult<{ success: boolean; cancelled: boolean; result?: unknown }>>;
        pickAndInspectRestoreArchive: () => Promise<
          IpcResult<{
            cancelled: boolean;
            archivePath?: string;
            preview?: {
              originalVaultId: string;
              originalVaultName: string;
              createdAt: string;
              appVersion: string;
              schemaMigrationVersion: number;
              assetCount: number;
              fileCount: number;
            };
          }>
        >;
        restoreAsNewVault: (input: { archivePath: string; targetParentDir: string; newVaultName: string }) => Promise<IpcResult<{ vault: VaultProject; warning?: string }>>;
      };
      assets: {
        importImage: (vaultPath: string) => Promise<IpcResult<{ asset: unknown | null; cancelled?: boolean }>>;
        listImages: (vaultPath: string) => Promise<IpcResult<{ assets: unknown[] }>>;
        deleteAsset: (vaultPath: string, assetId: string) => Promise<IpcResult<Record<string, never>>>;
        getUrl: (vaultPath: string, relativePath: string) => Promise<IpcResult<{ url: string }>>;
        saveCroppedImage: (vaultPath: string, input: unknown) => Promise<IpcResult<{ asset: unknown }>>;
      };
      data: {
        [key: string]: (...args: any[]) => Promise<any>;
        listTrashItems: (vaultPath: string) => Promise<IpcResult<{ items: unknown[] }>>;
        restoreTrashItem: (vaultPath: string, input: { entityType: string; id: string }) => Promise<IpcResult<{ item: unknown }>>;
        permanentlyDeleteTrashItem: (vaultPath: string, input: { entityType: string; id: string }) => Promise<IpcResult<{ item: unknown }>>;
        getRecentItems: (vaultPath: string) => Promise<IpcResult<{ items: RecentEditItem[] }>>;
        globalSearch: (vaultPath: string, query: string) => Promise<IpcResult<{ results: GlobalSearchResult[] }>>;
        getCodexItem: (vaultPath: string, codexItemId: string) => Promise<IpcResult<{ item: CodexItemEntity | null }>>;
        listCharacters: (vaultPath: string) => Promise<IpcResult<{ characters: CharacterEntity[] }>>;
        getCharacterVersions: (vaultPath: string, characterId: string) => Promise<IpcResult<{ versions: CharacterVersionEntity[] }>>;
        createCharacter: (vaultPath: string, input: { name: string; summary: string }) => Promise<IpcResult<{ character: CharacterEntity }>>;
        updateCharacter: (vaultPath: string, input: { id: string; name: string; summary: string; avatarAssetId?: string | null; fullBodyAssetId?: string | null }) => Promise<IpcResult<{ character: Partial<CharacterEntity> }>>;
        createCharacterVersion: (
          vaultPath: string,
          input: { characterId: string; name: string; description: string }
        ) => Promise<IpcResult<{ version: CharacterVersionEntity }>>;
        listMaps: (vaultPath: string) => Promise<IpcResult<{ maps: unknown[] }>>;
        createMap: (vaultPath: string, input: unknown) => Promise<IpcResult<{ map: unknown }>>;
        duplicateMapAsVersion: (vaultPath: string, input: unknown) => Promise<IpcResult<{ map: unknown }>>;
        updateMap: (vaultPath: string, input: unknown) => Promise<IpcResult<{ map: unknown }>>;
        deleteMap: (vaultPath: string, id: string) => Promise<IpcResult<Record<string, never>>>;
        listMapLayers: (vaultPath: string, mapId: string) => Promise<IpcResult<{ layers: unknown[] }>>;
        saveMapLayers: (vaultPath: string, input: unknown) => Promise<IpcResult<{ layers: unknown[] }>>;
        getMapObjects: (vaultPath: string, mapId: string) => Promise<IpcResult<{ objects: unknown[] }>>;
        saveMapObjects: (vaultPath: string, input: unknown) => Promise<IpcResult<{ objects: unknown[] }>>;
        listEntityMapLinks: (vaultPath: string, entityType: string, entityId: string) => Promise<IpcResult<{ links: unknown[] }>>;
      };
    };
  }
}

export {};
