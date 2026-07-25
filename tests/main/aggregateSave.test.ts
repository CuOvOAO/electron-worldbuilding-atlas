import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  runImmediateTransaction,
  saveCodexAggregate,
  saveMapAggregate,
  saveTimelineAggregate
} from '../../src/main/data/aggregateSaveService';
import { runMigrations, seedInitialData } from '../../src/main/db/migrations';

describe('aggregate saves', () => {
  it('rolls back the complete codex save when a related record is invalid', () => {
    withSeededDatabase((db) => {
      const item = db.prepare('SELECT id, title, summary, type, export_enabled AS exportEnabled FROM codex_items LIMIT 1').get() as Record<string, unknown>;
      expect(() => runImmediateTransaction(db, () => saveCodexAggregate(db, {
        item: { ...item, title: '不应保留的新标题' },
        aliases: [],
        blocks: [],
        links: [{ id: 'draft-link', sourceEntityType: 'codex_item', sourceEntityId: item.id, targetEntityType: 'event', targetEntityId: 'missing' }]
      }))).toThrow('关联目标不存在');
      expect((db.prepare('SELECT title FROM codex_items WHERE id = ?').get(item.id) as { title: string }).title).toBe(item.title);
    });
  });

  it('rolls back timeline metadata when the event order is stale', () => {
    withSeededDatabase((db) => {
      const timeline = db.prepare('SELECT id, name, description, sort_order AS sortOrder FROM timelines LIMIT 1').get() as Record<string, unknown>;
      expect(() => runImmediateTransaction(db, () => saveTimelineAggregate(db, {
        item: { ...timeline, name: '不应保留的新时间线名' },
        eventOrderIds: []
      }))).toThrow('事件排序与当前时间线内容不一致');
      expect((db.prepare('SELECT name FROM timelines WHERE id = ?').get(timeline.id) as { name: string }).name).toBe(timeline.name);
    });
  });

  it('rolls back map metadata and layers when an object link is invalid', () => {
    withSeededDatabase((db) => {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO maps (id, created_at, updated_at, name, title, description, canvas_width, canvas_height, version_group_id) VALUES ('map-1', ?, ?, '旧地图', '旧地图', '', 1600, 1000, 'group-1')").run(now, now);
      expect(() => runImmediateTransaction(db, () => saveMapAggregate(db, {
        map: { id: 'map-1', title: '不应保留的新地图名', description: '', canvasWidth: 1600, canvasHeight: 1000 },
        layers: [{ id: 'layer-1', name: '图层', visible: true, opacity: 1 }],
        objects: [{ id: 'draft-object', layerId: 'layer-1', type: 'marker', linkedEntities: [{ entityType: 'location', entityId: 'missing' }] }]
      }))).toThrow('关联的资料不存在');
      expect((db.prepare("SELECT title FROM maps WHERE id = 'map-1'").get() as { title: string }).title).toBe('旧地图');
      expect((db.prepare("SELECT COUNT(*) AS count FROM map_layers WHERE map_id = 'map-1'").get() as { count: number }).count).toBe(0);
    });
  });
});

function withSeededDatabase(callback: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    seedInitialData(db);
    callback(db);
  } finally {
    db.close();
  }
}
