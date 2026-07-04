import { useEffect, useState } from 'react';
import { dataClient } from '../services/dataClient';
import type { NavigationTarget, Vault } from '../types/app';
import type { RecentEditItem } from '../types/entities';

interface HomePageProps {
  vault: Vault;
  onChangeModule: (module: NavigationTarget['module']) => void;
  onNavigate: (target: NavigationTarget) => void;
}

const quickAddActions = [
  { key: 'character', label: '新建角色', english: 'Character' },
  { key: 'codex', label: '新建词条', english: 'Codex' },
  { key: 'event', label: '新建事件', english: 'Event' },
  { key: 'location', label: '新建地点', english: 'Location' },
  { key: 'map', label: '新建地图', english: 'Atlas' },
  { key: 'manuscript', label: '新建手稿', english: 'Manuscript' }
] as const;

export function HomePage({ vault, onChangeModule, onNavigate }: HomePageProps): JSX.Element {
  const [recentItems, setRecentItems] = useState<RecentEditItem[]>([]);
  const [error, setError] = useState('');
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  useEffect(() => {
    loadRecentItems();
  }, [vault.path]);

  function loadRecentItems(): void {
    dataClient
      .getRecentItems(vault.path)
      .then(setRecentItems)
      .catch((cause) => {
        console.error(cause);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }

  function openRecentItem(item: RecentEditItem): void {
    if (item.entityType === 'character_version' && item.characterId) {
      onNavigate({ module: 'characters', characterId: item.characterId, characterVersionId: item.id });
      return;
    }

    if (item.entityType === 'codex_item') {
      onNavigate({ module: 'codex', codexItemId: item.id });
      return;
    }

    if (item.entityType === 'event') {
      onNavigate({ module: 'events', eventId: item.id });
      return;
    }

    if (item.entityType === 'location') {
      onNavigate({ module: 'locations', locationId: item.id });
      return;
    }

    if (item.entityType === 'map') {
      onNavigate({ module: 'locations', view: 'map', mapId: item.id });
      return;
    }

    if (item.entityType === 'manuscript') {
      onNavigate({ module: 'manuscripts', manuscriptId: item.id });
      return;
    }

    if (item.entityType === 'timeline') {
      onNavigate({ module: 'timeline', timelineId: item.id });
    }
  }

  async function createQuickItem(action: (typeof quickAddActions)[number]['key']): Promise<void> {
    try {
      setError('');
      setCreatingKey(action);

      if (action === 'character') {
        const character = await dataClient.createCharacter(vault.path, { name: '新角色', summary: '一句话简介待填写。' });
        const version = await dataClient.createCharacterVersion(vault.path, { characterId: character.id, name: '默认版本', description: '' });
        onNavigate({ module: 'characters', characterId: character.id, characterVersionId: version.id });
        return;
      }

      if (action === 'codex') {
        const item = await dataClient.createCodexItem(vault.path, { title: '新词条', summary: '', type: '概念', exportEnabled: 1 });
        onNavigate({ module: 'codex', codexItemId: item.id });
        return;
      }

      if (action === 'event') {
        const item = await dataClient.createEvent(vault.path, {
          title: '新事件',
          timelineId: '',
          startDisplayTime: '',
          endDisplayTime: '',
          durationNote: '',
          startSortIndex: 0,
          endSortIndex: 0,
          body: '',
          exportEnabled: 1
        });
        onNavigate({ module: 'events', eventId: item.id });
        return;
      }

      if (action === 'location') {
        const item = await dataClient.createLocation(vault.path, { name: '新地点', type: '地点', summary: '', body: '', exportEnabled: 1 });
        onNavigate({ module: 'locations', view: 'records', locationId: item.id });
        return;
      }

      if (action === 'map') {
        const map = await dataClient.createMap(vault.path, { title: '新建地图', description: '' });
        onNavigate({ module: 'locations', view: 'map', mapId: map.id });
        return;
      }

      if (action === 'manuscript') {
        const item = await dataClient.createManuscript(vault.path, {
          title: '新建碎片',
          body: '',
          manuscriptType: 'fragment',
          exportEnabled: 1
        });
        onNavigate({ module: 'manuscripts', manuscriptId: item.id });
      }
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreatingKey(null);
    }
  }

  return (
    <div className="ma-home-grid grid gap-5">
      <section className="paper-panel ma-home-recent">
        <header className="ma-section-header">
          <div>
            <p className="ma-eyebrow">Recently Edited</p>
            <h2>最近编辑</h2>
          </div>
          <button className="btn-ghost" onClick={() => onChangeModule('manuscripts')}>
            查看全部
          </button>
        </header>

        {error ? <div className="ma-empty-state">{error}</div> : null}

        {recentItems.length === 0 ? (
          <div className="ma-empty-state">暂无最近编辑。创建角色或编辑档案后会出现在这里。</div>
        ) : (
          <div className="ma-recent-list">
            <div className="ma-recent-grid">
              {recentItems.map((item) => (
                <button
                  key={`${item.entityType}-${item.id}`}
                  className="ma-recent-item"
                  onClick={() => openRecentItem(item)}
                  title={item.title}
                >
                  <div className="ma-recent-body">
                    <span className="ma-recent-title line-clamp-2">{item.title}</span>
                    <span className="ma-recent-summary line-clamp-2">{item.detail || '暂无摘要'}</span>
                  </div>
                  <div className="ma-recent-footer">
                    <span className="ma-recent-date">{formatUpdatedAt(item.updatedAt)}</span>
                    <span className="ma-recent-kind">{item.kind}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="paper-panel ma-home-side">
        <header className="ma-section-header">
          <div>
            <p className="ma-eyebrow">Quick Add</p>
            <h2>快速添加</h2>
          </div>
        </header>

        <div className="ma-quick-list">
          {quickAddActions.map((action) => (
            <button key={action.key} className="ma-quick-entry" onClick={() => createQuickItem(action.key)} disabled={creatingKey !== null}>
              <span className="ma-quick-plus">+</span>
              <span className="ma-quick-copy">
                <span className="ma-quick-title">{creatingKey === action.key ? '创建中...' : action.label}</span>
                <span className="ma-quick-subtitle">{action.english}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
