import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

interface Migration {
  version: number;
  name: string;
  up: string | ((db: DatabaseSync) => void);
}

const baseColumns = `
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
`;

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_world_schema',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        ${baseColumns},
        asset_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        ${baseColumns},
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        avatar_asset_id TEXT,
        full_body_asset_id TEXT,
        FOREIGN KEY (avatar_asset_id) REFERENCES assets(id),
        FOREIGN KEY (full_body_asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS timelines (
        ${baseColumns},
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        parent_timeline_id TEXT,
        branch_event_id TEXT,
        branch_note TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (parent_timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS character_versions (
        ${baseColumns},
        character_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        timeline_id TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (character_id) REFERENCES characters(id),
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS codex_items (
        ${baseColumns},
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT '',
        export_enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS codex_aliases (
        ${baseColumns},
        codex_item_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        FOREIGN KEY (codex_item_id) REFERENCES codex_items(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        ${baseColumns},
        title TEXT NOT NULL,
        timeline_id TEXT,
        start_display_time TEXT NOT NULL DEFAULT '',
        end_display_time TEXT NOT NULL DEFAULT '',
        duration_note TEXT NOT NULL DEFAULT '',
        start_sort_index REAL NOT NULL DEFAULT 0,
        end_sort_index REAL NOT NULL DEFAULT 0,
        body TEXT NOT NULL DEFAULT '',
        export_enabled INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS locations (
        ${baseColumns},
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        export_enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS manuscripts (
        ${baseColumns},
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        manuscript_type TEXT NOT NULL DEFAULT 'fragment',
        export_enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS relationships (
        ${baseColumns},
        source_character_version_id TEXT NOT NULL,
        target_character_version_id TEXT NOT NULL,
        timeline_id TEXT,
        FOREIGN KEY (source_character_version_id) REFERENCES character_versions(id),
        FOREIGN KEY (target_character_version_id) REFERENCES character_versions(id),
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS relationship_stages (
        ${baseColumns},
        relationship_id TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        start_sort_index REAL,
        end_sort_index REAL,
        related_event_id TEXT,
        FOREIGN KEY (relationship_id) REFERENCES relationships(id),
        FOREIGN KEY (related_event_id) REFERENCES events(id)
      );

      CREATE TABLE IF NOT EXISTS maps (
        ${baseColumns},
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS map_layers (
        ${baseColumns},
        map_id TEXT NOT NULL,
        name TEXT NOT NULL,
        visible INTEGER NOT NULL DEFAULT 1,
        locked INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (map_id) REFERENCES maps(id)
      );

      CREATE TABLE IF NOT EXISTS map_objects (
        ${baseColumns},
        map_id TEXT NOT NULL,
        layer_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        geometry_json TEXT NOT NULL DEFAULT '{}',
        style_json TEXT NOT NULL DEFAULT '{}',
        properties_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (map_id) REFERENCES maps(id),
        FOREIGN KEY (layer_id) REFERENCES map_layers(id)
      );

      CREATE TABLE IF NOT EXISTS content_blocks (
        ${baseColumns},
        owner_entity_type TEXT NOT NULL,
        owner_entity_id TEXT NOT NULL,
        block_type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0,
        export_enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS entity_links (
        ${baseColumns},
        source_entity_type TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS search_index (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_characters_updated_at ON characters(updated_at);
      CREATE INDEX IF NOT EXISTS idx_character_versions_character_id ON character_versions(character_id);
      CREATE INDEX IF NOT EXISTS idx_codex_items_updated_at ON codex_items(updated_at);
      CREATE INDEX IF NOT EXISTS idx_events_updated_at ON events(updated_at);
      CREATE INDEX IF NOT EXISTS idx_locations_updated_at ON locations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_manuscripts_updated_at ON manuscripts(updated_at);
    `
  },
  {
    version: 2,
    name: 'make_relationship_stage_sort_indexes_nullable',
    up: `
      DROP TABLE IF EXISTS relationship_stages_next;

      CREATE TABLE IF NOT EXISTS relationship_stages_next (
        ${baseColumns},
        relationship_id TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        start_sort_index REAL,
        end_sort_index REAL,
        related_event_id TEXT,
        FOREIGN KEY (relationship_id) REFERENCES relationships(id),
        FOREIGN KEY (related_event_id) REFERENCES events(id)
      );

      INSERT INTO relationship_stages_next
        (id, created_at, updated_at, deleted_at, relationship_id, relation_type, description, start_sort_index, end_sort_index, related_event_id)
      SELECT
        id, created_at, updated_at, deleted_at, relationship_id, relation_type, description,
        NULLIF(start_sort_index, 0),
        NULLIF(end_sort_index, 0),
        related_event_id
      FROM relationship_stages;

      DROP TABLE relationship_stages;
      ALTER TABLE relationship_stages_next RENAME TO relationship_stages;
    `
  },
  {
    version: 3,
    name: 'add_relationship_direction_mode',
    up: `
      ALTER TABLE relationships ADD COLUMN direction_mode TEXT NOT NULL DEFAULT 'directed';
    `
  },
  {
    version: 4,
    name: 'map_editor_marker_schema',
    up: `
      ALTER TABLE maps ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE maps ADD COLUMN background_asset_id TEXT;
      ALTER TABLE maps ADD COLUMN canvas_width REAL NOT NULL DEFAULT 1600;
      ALTER TABLE maps ADD COLUMN canvas_height REAL NOT NULL DEFAULT 1000;
      UPDATE maps SET title = name WHERE title = '';

      DROP TABLE IF EXISTS map_objects_next;
      CREATE TABLE map_objects_next (
        ${baseColumns},
        map_id TEXT NOT NULL,
        layer_id TEXT,
        type TEXT NOT NULL DEFAULT 'marker',
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        geometry_json TEXT,
        style_json TEXT,
        properties_json TEXT,
        FOREIGN KEY (map_id) REFERENCES maps(id),
        FOREIGN KEY (layer_id) REFERENCES map_layers(id)
      );

      INSERT INTO map_objects_next
        (id, created_at, updated_at, deleted_at, map_id, layer_id, type, name, description, x, y, geometry_json, style_json, properties_json)
      SELECT
        id, created_at, updated_at, deleted_at, map_id, layer_id, object_type, name, '', 0, 0, geometry_json, style_json, properties_json
      FROM map_objects;

      DROP TABLE map_objects;
      ALTER TABLE map_objects_next RENAME TO map_objects;

      CREATE INDEX IF NOT EXISTS idx_maps_updated_at ON maps(updated_at);
      CREATE INDEX IF NOT EXISTS idx_map_layers_map_id ON map_layers(map_id);
      CREATE INDEX IF NOT EXISTS idx_map_objects_map_id ON map_objects(map_id);
      CREATE INDEX IF NOT EXISTS idx_entity_links_map_object ON entity_links(source_entity_type, source_entity_id);
    `
  },
  {
    version: 5,
    name: 'map_layer_defaults',
    up: `
      INSERT INTO map_layers (id, created_at, updated_at, map_id, name, visible, locked, sort_order)
      SELECT
        'default-layer-' || m.id,
        m.created_at,
        m.updated_at,
        m.id,
        '默认图层',
        1,
        0,
        0
      FROM maps m
      WHERE m.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM map_layers ml
          WHERE ml.map_id = m.id AND ml.deleted_at IS NULL
        );

      UPDATE map_objects
      SET layer_id = (
        SELECT ml.id
        FROM map_layers ml
        WHERE ml.map_id = map_objects.map_id AND ml.deleted_at IS NULL
        ORDER BY ml.sort_order ASC, ml.created_at ASC
        LIMIT 1
      )
      WHERE deleted_at IS NULL
        AND (
          layer_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM map_layers ml
            WHERE ml.id = map_objects.layer_id
              AND ml.map_id = map_objects.map_id
              AND ml.deleted_at IS NULL
          )
        );
    `
  },
  {
    version: 6,
    name: 'map_layer_opacity',
    up: (db) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(map_layers)').all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has('opacity')) {
        db.exec('ALTER TABLE map_layers ADD COLUMN opacity REAL NOT NULL DEFAULT 1;');
      }
      db.exec('UPDATE map_layers SET opacity = 1 WHERE opacity IS NULL;');
    }
  },
  {
    version: 7,
    name: 'map_version_lineage',
    up: (db) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(maps)').all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has('source_map_id')) {
        db.exec('ALTER TABLE maps ADD COLUMN source_map_id TEXT;');
      }
      if (!columns.has('version_group_id')) {
        db.exec('ALTER TABLE maps ADD COLUMN version_group_id TEXT;');
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_maps_source_map_id ON maps(source_map_id);
        CREATE INDEX IF NOT EXISTS idx_maps_version_group_id ON maps(version_group_id);
      `);
    }
  }
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN;');
    try {
      if (typeof migration.up === 'function') {
        migration.up(db);
      } else {
        db.exec(migration.up);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, now);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function seedInitialData(db: DatabaseSync): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM characters').get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  const ids = {
    timeline: randomUUID(),
    character: randomUUID(),
    defaultVersion: randomUUID(),
    canonVersion: randomUUID(),
    codex: randomUUID(),
    event: randomUUID(),
    location: randomUUID(),
    manuscript: randomUUID()
  };

  db.exec('BEGIN;');
  try {
    db.prepare('INSERT INTO timelines (id, created_at, updated_at, name, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(
      ids.timeline,
      now,
      now,
      '主线',
      '默认主时间线',
      0
    );
    db.prepare('INSERT INTO characters (id, created_at, updated_at, name, summary) VALUES (?, ?, ?, ?, ?)').run(
      ids.character,
      now,
      now,
      '艾琳',
      '白塔城的年轻记录官，习惯把危险写进边注。'
    );
    db.prepare('INSERT INTO character_versions (id, created_at, updated_at, character_id, name, description, timeline_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      ids.defaultVersion,
      now,
      now,
      ids.character,
      '默认版本',
      '角色的基础设定版本。',
      null,
      1
    );
    db.prepare('INSERT INTO character_versions (id, created_at, updated_at, character_id, name, description, timeline_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      ids.canonVersion,
      now,
      now,
      ids.character,
      '正史线版本',
      '绑定主线的正史版本。',
      ids.timeline,
      0
    );
    db.prepare('INSERT INTO codex_items (id, created_at, updated_at, title, summary, type, export_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      ids.codex,
      now,
      now,
      '旧王族',
      '围绕旧王血脉、继承仪式与白塔誓约形成的设定。',
      '组织 / 历史概念',
      1
    );
    db.prepare('INSERT INTO events (id, created_at, updated_at, title, timeline_id, start_display_time, end_display_time, duration_note, start_sort_index, end_sort_index, body, export_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      ids.event,
      now,
      now,
      '北境战争',
      ids.timeline,
      '星轨历 314 年初雪后',
      '星轨历 316 年白塔重开',
      '横跨多个地点与角色版本的区间事件。',
      314,
      316,
      '战争事件正文占位。',
      1
    );
    db.prepare('INSERT INTO locations (id, created_at, updated_at, name, type, summary, body, export_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      ids.location,
      now,
      now,
      '白塔城',
      '城市',
      '承载关键事件、势力边界与角色动线的地点档案。',
      '历史沿革、地理特征、风俗与地图点位说明占位。',
      1
    );
    db.prepare('INSERT INTO manuscripts (id, created_at, updated_at, title, body, manuscript_type, export_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      ids.manuscript,
      now,
      now,
      '雪夜初遇',
      '她在雪夜里第一次看见白塔的灯。',
      'scene',
      1
    );
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
