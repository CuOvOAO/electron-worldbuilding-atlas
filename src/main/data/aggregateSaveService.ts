import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

type RecordInput = Record<string, unknown>;

export interface CodexAggregateInput {
  item: RecordInput;
  aliases: RecordInput[];
  blocks: RecordInput[];
  links: RecordInput[];
}

export interface EventAggregateInput {
  item: RecordInput;
  links: RecordInput[];
}

export interface TimelineAggregateInput {
  item: RecordInput;
  eventOrderIds: string[];
}

export interface MapAggregateInput {
  map: RecordInput;
  layers: RecordInput[];
  objects: RecordInput[];
}

export interface RelationshipAggregateInput {
  relationship: RecordInput;
  stages: RecordInput[];
}

export function runImmediateTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = callback();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function saveCodexAggregate(db: DatabaseSync, input: CodexAggregateInput): void {
  const itemId = requiredString(input.item.id, '词条 ID');
  const now = new Date().toISOString();
  assertChanged(db.prepare(`
    UPDATE codex_items
    SET title = ?, summary = ?, type = ?, export_enabled = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(
    optionalString(input.item.title).trim() || '未命名词条',
    optionalString(input.item.summary),
    optionalString(input.item.type),
    input.item.exportEnabled ? 1 : 0,
    now,
    itemId
  ), '词条不存在或已被删除。');

  replaceAliases(db, itemId, Array.isArray(input.aliases) ? input.aliases : [], now);
  replaceContentBlocks(db, itemId, Array.isArray(input.blocks) ? input.blocks : [], now);
  replaceEntityLinks(db, 'codex_item', itemId, Array.isArray(input.links) ? input.links : [], now);
}

export function saveEventAggregate(db: DatabaseSync, input: EventAggregateInput): void {
  const itemId = requiredString(input.item.id, '事件 ID');
  const timelineId = optionalNullableString(input.item.timelineId);
  if (timelineId && !entityExists(db, 'timeline', timelineId)) throw new Error('时间线不存在或已被删除。');
  const now = new Date().toISOString();
  assertChanged(db.prepare(`
    UPDATE events
    SET title = ?, timeline_id = ?, start_display_time = ?, end_display_time = ?, duration_note = ?,
      start_sort_index = ?, end_sort_index = ?, body = ?, export_enabled = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(
    optionalString(input.item.title).trim() || '未命名事件',
    timelineId,
    optionalString(input.item.startDisplayTime),
    optionalString(input.item.endDisplayTime),
    optionalString(input.item.durationNote),
    finiteNumber(input.item.startSortIndex),
    finiteNumber(input.item.endSortIndex),
    optionalString(input.item.body),
    input.item.exportEnabled ? 1 : 0,
    now,
    itemId
  ), '事件不存在或已被删除。');
  replaceEntityLinks(db, 'event', itemId, Array.isArray(input.links) ? input.links : [], now);
}

export function saveTimelineAggregate(db: DatabaseSync, input: TimelineAggregateInput): void {
  const itemId = requiredString(input.item.id, '时间线 ID');
  const parentTimelineId = optionalNullableString(input.item.parentTimelineId);
  const branchEventId = optionalNullableString(input.item.branchEventId);
  if (parentTimelineId === itemId) throw new Error('时间线不能以自身作为父时间线。');
  if (parentTimelineId && !entityExists(db, 'timeline', parentTimelineId)) throw new Error('父时间线不存在或已被删除。');
  if (branchEventId && !entityExists(db, 'event', branchEventId)) throw new Error('分支事件不存在或已被删除。');
  const now = new Date().toISOString();
  assertChanged(db.prepare(`
    UPDATE timelines
    SET name = ?, description = ?, parent_timeline_id = ?, branch_event_id = ?, branch_note = ?, sort_order = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(
    optionalString(input.item.name).trim() || '未命名时间线',
    optionalString(input.item.description),
    parentTimelineId,
    branchEventId,
    optionalString(input.item.branchNote),
    finiteNumber(input.item.sortOrder),
    now,
    itemId
  ), '时间线不存在或已被删除。');

  const eventOrderIds = Array.isArray(input.eventOrderIds) ? input.eventOrderIds.map(String) : [];
  if (new Set(eventOrderIds).size !== eventOrderIds.length) throw new Error('事件排序中存在重复项目。');
  const currentIds = (db.prepare('SELECT id FROM events WHERE timeline_id = ? AND deleted_at IS NULL').all(itemId) as Array<{ id: string }>).map((row) => row.id);
  if (currentIds.length !== eventOrderIds.length || currentIds.some((id) => !eventOrderIds.includes(id))) {
    throw new Error('事件排序与当前时间线内容不一致，请刷新后重试。');
  }
  eventOrderIds.forEach((eventId, index) => {
    assertChanged(db.prepare(`
      UPDATE events SET start_sort_index = ?, updated_at = ?
      WHERE id = ? AND timeline_id = ? AND deleted_at IS NULL
    `).run((index + 1) * 100, now, eventId, itemId), '事件排序保存失败，请刷新后重试。');
  });
}

export function saveMapAggregate(db: DatabaseSync, input: MapAggregateInput): void {
  const mapId = requiredString(input.map.id, '地图 ID');
  const layers = Array.isArray(input.layers) ? input.layers : [];
  const objects = Array.isArray(input.objects) ? input.objects : [];
  if (layers.length === 0) throw new Error('每张地图至少需要一个图层。');
  const layerIds = layers.map((layer) => requiredString(layer.id, '图层 ID'));
  if (new Set(layerIds).size !== layerIds.length) throw new Error('地图图层中存在重复 ID。');
  const backgroundAssetId = optionalNullableString(input.map.backgroundAssetId);
  if (backgroundAssetId && !entityExists(db, 'asset', backgroundAssetId)) throw new Error('地图底图素材不存在或已被删除。');
  const now = new Date().toISOString();
  assertChanged(db.prepare(`
    UPDATE maps SET name = ?, title = ?, description = ?, background_asset_id = ?, canvas_width = ?, canvas_height = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(
    optionalString(input.map.title).trim() || '未命名地图', optionalString(input.map.title).trim() || '未命名地图',
    optionalString(input.map.description), backgroundAssetId,
    positiveNumber(input.map.canvasWidth, 1600), positiveNumber(input.map.canvasHeight, 1000), now, mapId
  ), '地图不存在或已被删除。');

  layers.forEach((layer, index) => {
    const id = layerIds[index];
    const existing = db.prepare('SELECT id FROM map_layers WHERE id = ? AND map_id = ?').get(id, mapId);
    const values = [
      optionalString(layer.name).trim() || '未命名图层', layer.visible === false ? 0 : 1,
      layer.locked === true ? 1 : 0, clamp(finiteNumber(layer.opacity), 0, 1), index, now
    ] as const;
    if (existing) {
      db.prepare(`UPDATE map_layers SET name = ?, visible = ?, locked = ?, opacity = ?, sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ? AND map_id = ?`).run(...values, id, mapId);
    } else {
      db.prepare(`INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, opacity, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, now, now, mapId, ...values.slice(0, 5));
    }
  });

  const objectIds = new Set<string>();
  for (const object of objects) {
    const id = persistentId(object.id) ?? randomUUID();
    if (objectIds.has(id)) throw new Error('地图对象中存在重复 ID。');
    objectIds.add(id);
    const layerId = requiredString(object.layerId, '对象图层 ID');
    if (!layerIds.includes(layerId)) throw new Error('对象所属图层不存在或已被删除。');
    const existing = db.prepare('SELECT id FROM map_objects WHERE id = ? AND map_id = ?').get(id, mapId);
    const values = [
      layerId, optionalString(object.type) || 'marker', optionalString(object.name), optionalString(object.description),
      finiteNumber(object.x), finiteNumber(object.y), optionalNullableString(object.geometryJson),
      optionalNullableString(object.styleJson), optionalNullableString(object.propertiesJson), now
    ] as const;
    if (existing) {
      db.prepare(`
        UPDATE map_objects SET layer_id = ?, type = ?, name = ?, description = ?, x = ?, y = ?, geometry_json = ?, style_json = ?, properties_json = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND map_id = ?
      `).run(...values, id, mapId);
    } else {
      db.prepare(`
        INSERT INTO map_objects (id, created_at, updated_at, map_id, layer_id, type, name, description, x, y, geometry_json, style_json, properties_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, now, now, mapId, ...values.slice(0, 9));
    }
    replaceMapObjectLinks(db, id, object, now);
  }

  for (const row of db.prepare('SELECT id FROM map_objects WHERE map_id = ? AND deleted_at IS NULL').all(mapId) as Array<{ id: string }>) {
    if (!objectIds.has(row.id)) {
      db.prepare('UPDATE map_objects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
      db.prepare("UPDATE entity_links SET deleted_at = ?, updated_at = ? WHERE source_entity_type = 'map_object' AND source_entity_id = ? AND deleted_at IS NULL").run(now, now, row.id);
    }
  }
  for (const row of db.prepare('SELECT id FROM map_layers WHERE map_id = ? AND deleted_at IS NULL').all(mapId) as Array<{ id: string }>) {
    if (!layerIds.includes(row.id)) {
      const count = Number((db.prepare('SELECT COUNT(*) AS count FROM map_objects WHERE map_id = ? AND layer_id = ? AND deleted_at IS NULL').get(mapId, row.id) as { count: number }).count);
      if (count > 0) throw new Error('请先将图层中的对象移动到其他图层后再删除。');
      db.prepare('UPDATE map_layers SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
    }
  }
}

export function saveRelationshipAggregate(db: DatabaseSync, input: RelationshipAggregateInput): void {
  const sourceId = requiredString(input.relationship.sourceCharacterVersionId, '关系起点');
  const targetId = requiredString(input.relationship.targetCharacterVersionId, '关系终点');
  if (sourceId === targetId) throw new Error('关系起点和终点不能相同。');
  if (!entityExists(db, 'character_version', sourceId) || !entityExists(db, 'character_version', targetId)) throw new Error('角色版本不存在或已被删除。');
  const timelineId = optionalNullableString(input.relationship.timelineId);
  if (timelineId && !entityExists(db, 'timeline', timelineId)) throw new Error('时间线不存在或已被删除。');
  const existingId = persistentId(input.relationship.id);
  const duplicate = timelineId
    ? db.prepare('SELECT id FROM relationships WHERE deleted_at IS NULL AND id <> ? AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id = ?').get(existingId ?? '', sourceId, targetId, timelineId)
    : db.prepare('SELECT id FROM relationships WHERE deleted_at IS NULL AND id <> ? AND source_character_version_id = ? AND target_character_version_id = ? AND timeline_id IS NULL').get(existingId ?? '', sourceId, targetId);
  if (duplicate) throw new Error('同一时间线下已存在这条方向关系。');
  const now = new Date().toISOString();
  const relationshipId = existingId ?? randomUUID();
  const directionMode = input.relationship.directionMode === 'undirected' ? 'undirected' : 'directed';
  if (existingId) {
    assertChanged(db.prepare(`
      UPDATE relationships SET source_character_version_id = ?, target_character_version_id = ?, timeline_id = ?, direction_mode = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(sourceId, targetId, timelineId, directionMode, now, relationshipId), '关系不存在或已被删除。');
  } else {
    db.prepare(`
      INSERT INTO relationships (id, created_at, updated_at, source_character_version_id, target_character_version_id, timeline_id, direction_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(relationshipId, now, now, sourceId, targetId, timelineId, directionMode);
  }

  const stages = existingId
    ? (Array.isArray(input.stages) ? input.stages : [])
    : [{
        relationType: input.relationship.relationType,
        description: input.relationship.description,
        startSortIndex: input.relationship.startSortIndex,
        endSortIndex: input.relationship.endSortIndex,
        relatedEventId: input.relationship.relatedEventId
      }];
  if (stages.length === 0) throw new Error('每条关系至少需要一个关系阶段。');
  const keepIds = new Set<string>();
  for (const stage of stages) {
    const relatedEventId = optionalNullableString(stage.relatedEventId);
    if (relatedEventId && !entityExists(db, 'event', relatedEventId)) throw new Error('关系阶段引用的事件不存在或已被删除。');
    const values = [
      optionalString(stage.relationType).trim() || '相关', optionalString(stage.description), nullableNumber(stage.startSortIndex),
      nullableNumber(stage.endSortIndex), relatedEventId, now
    ] as const;
    const stageId = persistentId(stage.id);
    if (stageId) {
      assertChanged(db.prepare(`
        UPDATE relationship_stages SET relation_type = ?, description = ?, start_sort_index = ?, end_sort_index = ?, related_event_id = ?, updated_at = ?
        WHERE id = ? AND relationship_id = ? AND deleted_at IS NULL
      `).run(...values, stageId, relationshipId), '关系阶段不存在或已被删除。');
      keepIds.add(stageId);
    } else {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO relationship_stages (id, created_at, updated_at, relationship_id, relation_type, description, start_sort_index, end_sort_index, related_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, now, now, relationshipId, ...values.slice(0, 5));
      keepIds.add(id);
    }
  }
  for (const row of db.prepare('SELECT id FROM relationship_stages WHERE relationship_id = ? AND deleted_at IS NULL').all(relationshipId) as Array<{ id: string }>) {
    if (!keepIds.has(row.id)) db.prepare('UPDATE relationship_stages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  }
}

function replaceMapObjectLinks(db: DatabaseSync, objectId: string, object: RecordInput, now: string): void {
  const rawLinks = Array.isArray(object.linkedEntities) ? object.linkedEntities as RecordInput[] : [];
  const locationId = optionalNullableString(object.locationId);
  const targetType = optionalNullableString(object.targetEntityType);
  const targetId = optionalNullableString(object.targetEntityId);
  const links = [
    ...rawLinks.map((link) => ({
      entityType: optionalString(link.entityType), entityId: optionalString(link.entityId),
      linkType: optionalString(link.linkType), note: optionalString(link.note)
    })),
    ...(locationId ? [{ entityType: 'location', entityId: locationId, linkType: 'happens_at', note: '' }] : []),
    ...(targetType && targetId ? [{ entityType: targetType, entityId: targetId, linkType: 'covers', note: '' }] : [])
  ];
  const unique = new Map<string, (typeof links)[number]>();
  for (const link of links) {
    const key = `${link.entityType}:${link.entityId}`;
    if (!link.entityType || !link.entityId) continue;
    if (!['location', 'event', 'character_version', 'codex_item'].includes(link.entityType)) throw new Error('地图对象关联类型无效。');
    if (!entityExists(db, link.entityType, link.entityId)) throw new Error('关联的资料不存在或已被删除。');
    unique.set(key, link);
  }
  db.prepare("UPDATE entity_links SET deleted_at = ?, updated_at = ? WHERE source_entity_type = 'map_object' AND source_entity_id = ? AND deleted_at IS NULL").run(now, now, objectId);
  for (const link of unique.values()) {
    db.prepare(`
      INSERT INTO entity_links (id, created_at, updated_at, source_entity_type, source_entity_id, target_entity_type, target_entity_id, link_type, note)
      VALUES (?, ?, ?, 'map_object', ?, ?, ?, ?, ?)
    `).run(randomUUID(), now, now, objectId, link.entityType, link.entityId, link.linkType || defaultMapLinkType(link.entityType), link.note);
  }
}

function defaultMapLinkType(entityType: string): string {
  if (entityType === 'location') return 'happens_at';
  if (entityType === 'event') return 'depicts';
  return 'related';
}

function replaceAliases(db: DatabaseSync, itemId: string, aliases: RecordInput[], now: string): void {
  const keepIds = new Set<string>();
  for (const alias of aliases) {
    const existingId = persistentId(alias.id);
    const value = optionalString(alias.alias).trim();
    if (!value) throw new Error('词条别名不能为空。');
    if (existingId) {
      assertChanged(db.prepare(`
        UPDATE codex_aliases SET alias = ?, updated_at = ?
        WHERE id = ? AND codex_item_id = ? AND deleted_at IS NULL
      `).run(value, now, existingId, itemId), '词条别名不存在或已被删除。');
      keepIds.add(existingId);
    } else {
      const id = randomUUID();
      db.prepare('INSERT INTO codex_aliases (id, created_at, updated_at, codex_item_id, alias) VALUES (?, ?, ?, ?, ?)').run(id, now, now, itemId, value);
      keepIds.add(id);
    }
  }
  for (const row of db.prepare('SELECT id FROM codex_aliases WHERE codex_item_id = ? AND deleted_at IS NULL').all(itemId) as Array<{ id: string }>) {
    if (!keepIds.has(row.id)) db.prepare('UPDATE codex_aliases SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  }
}

function replaceContentBlocks(db: DatabaseSync, itemId: string, blocks: RecordInput[], now: string): void {
  const keepIds = new Set<string>();
  blocks.forEach((block, index) => {
    const existingId = persistentId(block.id);
    const values = [
      optionalString(block.title), optionalString(block.contentJson), index,
      block.collapsed ? 1 : 0, block.exportEnabled === 0 ? 0 : 1
    ] as const;
    if (existingId) {
      assertChanged(db.prepare(`
        UPDATE content_blocks SET title = ?, content_json = ?, sort_order = ?, collapsed = ?, export_enabled = ?, updated_at = ?
        WHERE id = ? AND owner_entity_type = 'codex_item' AND owner_entity_id = ? AND deleted_at IS NULL
      `).run(...values, now, existingId, itemId), '正文段落不存在或已被删除。');
      keepIds.add(existingId);
    } else {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO content_blocks
          (id, created_at, updated_at, owner_entity_type, owner_entity_id, block_type, title, content_json, sort_order, collapsed, export_enabled)
        VALUES (?, ?, ?, 'codex_item', ?, 'section', ?, ?, ?, ?, ?)
      `).run(id, now, now, itemId, ...values);
      keepIds.add(id);
    }
  });
  for (const row of db.prepare("SELECT id FROM content_blocks WHERE owner_entity_type = 'codex_item' AND owner_entity_id = ? AND deleted_at IS NULL").all(itemId) as Array<{ id: string }>) {
    if (!keepIds.has(row.id)) db.prepare('UPDATE content_blocks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  }
}

function replaceEntityLinks(db: DatabaseSync, ownerType: string, ownerId: string, links: RecordInput[], now: string): void {
  const keepIds = new Set<string>();
  for (const link of links) {
    const existingId = persistentId(link.id);
    if (existingId) {
      const existing = db.prepare(`
        SELECT id FROM entity_links WHERE id = ? AND deleted_at IS NULL
          AND ((source_entity_type = ? AND source_entity_id = ?) OR (target_entity_type = ? AND target_entity_id = ?))
      `).get(existingId, ownerType, ownerId, ownerType, ownerId);
      if (!existing) throw new Error('资料关联不存在或已被删除。');
      keepIds.add(existingId);
      continue;
    }
    const sourceEntityType = requiredString(link.sourceEntityType, '关联来源类型');
    const sourceEntityId = requiredString(link.sourceEntityId, '关联来源 ID');
    const targetEntityType = requiredString(link.targetEntityType, '关联目标类型');
    const targetEntityId = requiredString(link.targetEntityId, '关联目标 ID');
    if (!((sourceEntityType === ownerType && sourceEntityId === ownerId) || (targetEntityType === ownerType && targetEntityId === ownerId))) {
      throw new Error('资料关联不属于当前资料。');
    }
    if (!entityExists(db, sourceEntityType, sourceEntityId) || !entityExists(db, targetEntityType, targetEntityId)) {
      throw new Error('关联目标不存在或已被删除。');
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO entity_links
        (id, created_at, updated_at, source_entity_type, source_entity_id, target_entity_type, target_entity_id, link_type, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, now, sourceEntityType, sourceEntityId, targetEntityType, targetEntityId, optionalString(link.linkType), optionalString(link.note));
    keepIds.add(id);
  }
  const existingRows = db.prepare(`
    SELECT id FROM entity_links WHERE deleted_at IS NULL
      AND ((source_entity_type = ? AND source_entity_id = ?) OR (target_entity_type = ? AND target_entity_id = ?))
  `).all(ownerType, ownerId, ownerType, ownerId) as Array<{ id: string }>;
  for (const row of existingRows) {
    if (!keepIds.has(row.id)) db.prepare('UPDATE entity_links SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  }
}

function entityExists(db: DatabaseSync, entityType: string, id: string): boolean {
  const tables: Record<string, string> = {
    character: 'characters', character_version: 'character_versions', codex_item: 'codex_items',
    event: 'events', location: 'locations', manuscript: 'manuscripts', timeline: 'timelines',
    relationship: 'relationships', relationship_stage: 'relationship_stages', map: 'maps', map_object: 'map_objects', asset: 'assets'
  };
  const table = tables[entityType];
  return Boolean(table && db.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id));
}

function persistentId(value: unknown): string | null {
  const id = optionalString(value);
  return id && !id.startsWith('draft-') ? id : null;
}

function requiredString(value: unknown, label: string): string {
  const text = optionalString(value).trim();
  if (!text) throw new Error(`${label} 无效。`);
  return text;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalNullableString(value: unknown): string | null {
  const text = optionalString(value).trim();
  return text || null;
}

function finiteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = finiteNumber(value);
  return number > 0 ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertChanged(result: { changes: number | bigint }, message: string): void {
  if (Number(result.changes) < 1) throw new Error(message);
}
