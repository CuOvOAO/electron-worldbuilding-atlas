import type { CharacterEntity, CharacterVersionEntity, CodexItemEntity, RecentEditItem } from '../types/entities';

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '数据读取失败。');
  }
  return result;
}

function notifyMovedToTrash(): void {
  window.dispatchEvent(new CustomEvent('atlas:notice', { detail: '已移入回收站' }));
}

export const dataClient = {
  async saveCodexAggregate(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.saveCodexAggregate(vaultPath, input));
  },
  async saveEventAggregate(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.saveEventAggregate(vaultPath, input));
  },
  async saveTimelineAggregate(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.saveTimelineAggregate(vaultPath, input));
  },
  async saveMapAggregate(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.saveMapAggregate(vaultPath, input));
  },
  async saveRelationshipAggregate(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.saveRelationshipAggregate(vaultPath, input));
  },
  async listTrashItems(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listTrashItems(vaultPath)).items;
  },

  async restoreTrashItem(vaultPath: string, input: { entityType: string; id: string }): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.restoreTrashItem(vaultPath, input));
  },

  async permanentlyDeleteTrashItem(vaultPath: string, input: { entityType: string; id: string }): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.permanentlyDeleteTrashItem(vaultPath, input));
  },

  async getRecentItems(vaultPath: string): Promise<RecentEditItem[]> {
    return unwrap(await window.manuscriptAtlas.data.getRecentItems(vaultPath)).items;
  },

  async getCodexItem(vaultPath: string, codexItemId: string): Promise<CodexItemEntity | null> {
    return unwrap(await window.manuscriptAtlas.data.getCodexItem(vaultPath, codexItemId)).item;
  },

  async listCharacters(vaultPath: string): Promise<CharacterEntity[]> {
    return unwrap(await window.manuscriptAtlas.data.listCharacters(vaultPath)).characters;
  },

  async getCharacterVersions(vaultPath: string, characterId: string): Promise<CharacterVersionEntity[]> {
    return unwrap(await window.manuscriptAtlas.data.getCharacterVersions(vaultPath, characterId)).versions;
  },

  async createCharacter(vaultPath: string, input: { name: string; summary: string }): Promise<CharacterEntity> {
    return unwrap(await window.manuscriptAtlas.data.createCharacter(vaultPath, input)).character;
  },

  async updateCharacter(vaultPath: string, input: { id: string; name: string; summary: string; avatarAssetId?: string | null; fullBodyAssetId?: string | null }): Promise<Partial<CharacterEntity>> {
    return unwrap(await window.manuscriptAtlas.data.updateCharacter(vaultPath, input)).character;
  },
  async deleteCharacter(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteCharacter(vaultPath, id));
    notifyMovedToTrash();
  },

  async createCharacterVersion(vaultPath: string, input: { characterId: string; name: string; description: string }): Promise<CharacterVersionEntity> {
    return unwrap(await window.manuscriptAtlas.data.createCharacterVersion(vaultPath, input)).version;
  },
  async updateCharacterVersion(vaultPath: string, input: { id: string; characterId: string; name: string; description: string }): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateCharacterVersion(vaultPath, input)).version;
  },
  async deleteCharacterVersion(vaultPath: string, input: { id: string; characterId: string }): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteCharacterVersion(vaultPath, input));
    notifyMovedToTrash();
  },

  async listCodexItems(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listCodexItems(vaultPath)).items;
  },
  async createCodexItem(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createCodexItem(vaultPath, input)).item;
  },
  async updateCodexItem(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateCodexItem(vaultPath, input)).item;
  },
  async deleteCodexItem(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteCodexItem(vaultPath, id));
    notifyMovedToTrash();
  },
  async listCodexAliases(vaultPath: string, codexItemId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listCodexAliases(vaultPath, codexItemId)).aliases;
  },
  async createCodexAlias(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createCodexAlias(vaultPath, input)).alias;
  },
  async updateCodexAlias(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateCodexAlias(vaultPath, input)).alias;
  },
  async deleteCodexAlias(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteCodexAlias(vaultPath, input));
  },
  async listContentBlocks(vaultPath: string, ownerEntityType: string, ownerEntityId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listContentBlocks(vaultPath, ownerEntityType, ownerEntityId)).blocks;
  },
  async createContentBlock(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createContentBlock(vaultPath, input)).block;
  },
  async updateContentBlock(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateContentBlock(vaultPath, input)).block;
  },
  async deleteContentBlock(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteContentBlock(vaultPath, input));
  },
  async listLocations(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listLocations(vaultPath)).items;
  },
  async createLocation(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createLocation(vaultPath, input)).item;
  },
  async updateLocation(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateLocation(vaultPath, input)).item;
  },
  async deleteLocation(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteLocation(vaultPath, id));
    notifyMovedToTrash();
  },
  async listEvents(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listEvents(vaultPath)).items;
  },
  async createEvent(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createEvent(vaultPath, input)).item;
  },
  async updateEvent(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateEvent(vaultPath, input)).item;
  },
  async deleteEvent(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteEvent(vaultPath, id));
    notifyMovedToTrash();
  },
  async listManuscripts(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listManuscripts(vaultPath)).items;
  },
  async createManuscript(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createManuscript(vaultPath, input)).item;
  },
  async updateManuscript(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateManuscript(vaultPath, input)).item;
  },
  async deleteManuscript(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteManuscript(vaultPath, id));
    notifyMovedToTrash();
  },
  async listTimelines(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listTimelines(vaultPath)).items;
  },
  async createTimeline(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createTimeline(vaultPath, input)).item;
  },
  async updateTimeline(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateTimeline(vaultPath, input)).item;
  },
  async deleteTimeline(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteTimeline(vaultPath, id));
    notifyMovedToTrash();
  },
  async listEntityLinks(vaultPath: string, ownerEntityType: string, ownerEntityId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listEntityLinks(vaultPath, ownerEntityType, ownerEntityId)).links;
  },
  async listLinkTargets(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listLinkTargets(vaultPath)).targets;
  },
  async listEntityMapLinks(vaultPath: string, entityType: string, entityId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listEntityMapLinks(vaultPath, entityType, entityId)).links;
  },
  async createEntityLink(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createEntityLink(vaultPath, input)).link;
  },
  async deleteEntityLink(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteEntityLink(vaultPath, id));
  },
  async listRelationGraph(vaultPath: string): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.listRelationGraph(vaultPath)).graph;
  },
  async createRelationship(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createRelationship(vaultPath, input)).relationship;
  },
  async updateRelationship(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateRelationship(vaultPath, input)).relationship;
  },
  async deleteRelationship(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteRelationship(vaultPath, id));
  },
  async createRelationshipStage(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createRelationshipStage(vaultPath, input)).stage;
  },
  async updateRelationshipStage(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateRelationshipStage(vaultPath, input)).stage;
  },
  async deleteRelationshipStage(vaultPath: string, input: any): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteRelationshipStage(vaultPath, input));
  },
  async listMaps(vaultPath: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listMaps(vaultPath)).maps;
  },
  async createMap(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.createMap(vaultPath, input)).map;
  },
  async duplicateMapAsVersion(vaultPath: string, input: { sourceMapId: string; title: string }): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.duplicateMapAsVersion(vaultPath, input)).map;
  },
  async updateMap(vaultPath: string, input: any): Promise<any> {
    return unwrap(await window.manuscriptAtlas.data.updateMap(vaultPath, input)).map;
  },
  async deleteMap(vaultPath: string, id: string): Promise<void> {
    unwrap(await window.manuscriptAtlas.data.deleteMap(vaultPath, id));
    notifyMovedToTrash();
  },
  async listMapLayers(vaultPath: string, mapId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.listMapLayers(vaultPath, mapId)).layers;
  },
  async saveMapLayers(vaultPath: string, input: any): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.saveMapLayers(vaultPath, input)).layers;
  },
  async getMapObjects(vaultPath: string, mapId: string): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.getMapObjects(vaultPath, mapId)).objects;
  },
  async saveMapObjects(vaultPath: string, input: any): Promise<any[]> {
    return unwrap(await window.manuscriptAtlas.data.saveMapObjects(vaultPath, input)).objects;
  }
};
