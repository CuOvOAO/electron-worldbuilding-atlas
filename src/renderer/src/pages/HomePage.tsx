import { useEffect, useState } from 'react';
import { GlobalSearch } from '../components/GlobalSearch';
import deskFabricBg from '../assets/v10-home-a1/desk-fabric-bg.webp';
import folderBaseHomeCenter from '../assets/v10-home-a1/folder-base-home-center.png';
import navTabBase from '../assets/v10-home-a1/nav-tab-base.png';
import noteDecoration from '../assets/v10-home-a1/note-decoration.png';
import paperMainHome from '../assets/v10-home-a1/paper-main-home.png';
import paperclipLeft from '../assets/v10-home-a1/paperclip-left.png';
import quickaddReceiptBase from '../assets/v10-home-a1/quickadd-receipt-base.png';
import quickaddRowBase from '../assets/v10-home-a1/quickadd-row-base.png';
import searchFieldPaper from '../assets/v10-home-a1/search-field-paper.png';
import sidebarBaseHome from '../assets/v10-home-a1/sidebar-base-home.png';
import stampCircleNeutral from '../assets/v10-home-a1/stamp-circle-neutral.png';
import starChartFineOverlay from '../assets/v10-home-a1/star-chart-fine-overlay.png';
import utilityDividerStrip from '../assets/v10-home-a1/utility-divider-strip.png';
import worldIdentityCard from '../assets/v10-home-a1/world-identity-card.png';
import { dataClient } from '../services/dataClient';
import type { ModuleKey, NavigationTarget, Vault } from '../types/app';
import type { RecentEditItem } from '../types/entities';

interface HomePageProps {
  vault: Vault;
  activeModule: ModuleKey;
  onChangeModule: (module: ModuleKey) => void;
  onNavigate: (target: NavigationTarget) => void;
}

const creationModules: Array<{ key: ModuleKey; label: string; english: string; mark: string }> = [
  { key: 'home', label: '首页', english: 'Home', mark: '⌂' },
  { key: 'characters', label: '角色', english: 'Characters', mark: '♙' },
  { key: 'codex', label: '词条', english: 'Codex', mark: '▤' },
  { key: 'events', label: '事件', english: 'Events', mark: '✦' },
  { key: 'locations', label: '地点', english: 'Places', mark: '⌖' },
  { key: 'timeline', label: '时间线', english: 'Timelines', mark: '⌁' },
  { key: 'manuscripts', label: '手稿箱', english: 'Manuscripts', mark: '□' }
];

const utilityModules: Array<{ key: ModuleKey; label: string; english: string; mark: string }> = [
  { key: 'export', label: '导出', english: 'Export', mark: '⇧' },
  { key: 'trash', label: '回收站', english: 'Archive Bin', mark: '⌫' },
  { key: 'settings', label: '设置', english: 'Settings', mark: '⚙' }
];

const quickAddActions = [
  { key: 'character', label: '新建角色', english: 'Character', mark: '♙' },
  { key: 'codex', label: '新建词条', english: 'Codex', mark: '▤' },
  { key: 'event', label: '新建事件', english: 'Event', mark: '✦' },
  { key: 'location', label: '新建地点', english: 'Place', mark: '⌖' },
  { key: 'map', label: '新建地图', english: 'Atlas', mark: '◇' },
  { key: 'manuscript', label: '新建手稿', english: 'Manuscript', mark: '□' }
] as const;

export function HomePage({ vault, activeModule, onChangeModule, onNavigate }: HomePageProps): JSX.Element {
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
    <div className="ma-v10-home" style={{ backgroundImage: `url(${deskFabricBg})` }}>
      <aside className="ma-v10-sidebar" aria-label="首页档案索引栏">
        <img className="ma-v10-sidebar-bg" src={sidebarBaseHome} alt="" aria-hidden="true" />
        <img className="ma-v10-paperclip ma-v10-paperclip-sidebar" src={paperclipLeft} alt="" aria-hidden="true" />
        <div className="ma-v10-sidebar-content">
          <section className="ma-v10-world-card">
            <img className="ma-v10-world-card-bg" src={worldIdentityCard} alt="" aria-hidden="true" />
            <div className="ma-v10-world-copy">
              <p className="ma-v10-kicker">Current Vault</p>
              <h1>{vault.name}</h1>
              <p>{vault.description || '整理你的世界观资料。'}</p>
            </div>
          </section>

          <div className="ma-v10-search-wrap">
            <img className="ma-v10-search-bg" src={searchFieldPaper} alt="" aria-hidden="true" />
            <GlobalSearch
              vault={vault}
              onNavigate={onNavigate}
              labelClassName="ma-v10-search-label"
              placeholder="全局搜索..."
            />
          </div>

          <nav className="ma-v10-nav-stack" aria-label="创作模块导航">
            {creationModules.map((module) => (
              <button key={module.key} className={`ma-v10-nav-tab ${activeModule === module.key ? 'is-active' : ''}`} onClick={() => onChangeModule(module.key)}>
                <img src={navTabBase} alt="" aria-hidden="true" />
                <span className="ma-v10-nav-icon" aria-hidden="true">{module.mark}</span>
                <span>
                  <strong>{module.label}</strong>
                  <small>{module.english}</small>
                </span>
              </button>
            ))}
          </nav>

          <img className="ma-v10-divider-strip" src={utilityDividerStrip} alt="" aria-hidden="true" />

          <nav className="ma-v10-nav-stack ma-v10-utility-stack" aria-label="工具区导航">
            {utilityModules.map((module) => (
              <button key={module.key} className="ma-v10-nav-tab" onClick={() => onChangeModule(module.key)}>
                <img src={navTabBase} alt="" aria-hidden="true" />
                <span className="ma-v10-nav-icon" aria-hidden="true">{module.mark}</span>
                <span>
                  <strong>{module.label}</strong>
                  <small>{module.english}</small>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <section className="ma-v10-center" aria-label="最近编辑">
        <img className="ma-v10-folder-bg" src={folderBaseHomeCenter} alt="" aria-hidden="true" />
        <img className="ma-v10-main-paper" src={paperMainHome} alt="" aria-hidden="true" />
        <img className="ma-v10-star-overlay" src={starChartFineOverlay} alt="" aria-hidden="true" />
        <img className="ma-v10-stamp" src={stampCircleNeutral} alt="" aria-hidden="true" />
        <div className="ma-v10-recent-paper">
          <header className="ma-v10-section-head">
            <div>
              <p className="ma-v10-kicker">Recently Edited</p>
              <h2>最近编辑</h2>
            </div>
            <button className="ma-v10-link-button" onClick={() => onChangeModule('manuscripts')}>查看全部</button>
          </header>
          {error ? <div className="ma-v10-error">{error}</div> : null}
          {recentItems.length === 0 ? (
            <div className="ma-v10-empty">暂无最近编辑。创建角色或编辑档案后会出现在这里。</div>
          ) : (
            <div className="ma-v10-recent-scroll">
              <div className="ma-v10-recent-grid">
                {recentItems.map((item) => (
                  <button
                    key={`${item.entityType}-${item.id}`}
                    className="ma-v10-recent-item"
                    onClick={() => openRecentItem(item)}
                    title={item.title}
                  >
                    <span className="ma-v10-recent-icon" aria-hidden="true">{recentIcon(item.entityType)}</span>
                    <span className="ma-v10-recent-meta">
                      <span className="ma-v10-recent-kind">{item.kind}</span>
                      <span className="ma-v10-recent-date">{formatUpdatedAt(item.updatedAt)}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <span className="ma-v10-recent-detail">{item.detail || '暂无摘要'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="ma-v10-quick" aria-label="快速添加">
        <img className="ma-v10-quick-bg" src={quickaddReceiptBase} alt="" aria-hidden="true" />
        <div className="ma-v10-quick-content">
          <header className="ma-v10-quick-head">
            <p className="ma-v10-kicker">Quick Add</p>
            <h2>快速添加</h2>
          </header>
          <div className="ma-v10-quick-list">
            {quickAddActions.map((action) => (
              <button key={action.key} className="ma-v10-quick-row" onClick={() => createQuickItem(action.key)} disabled={creatingKey !== null}>
                <img src={quickaddRowBase} alt="" aria-hidden="true" />
                <span className="ma-v10-quick-mark" aria-hidden="true">{action.mark}</span>
                <span>
                  <strong>{creatingKey === action.key ? '创建中...' : action.label}</strong>
                  <small>{action.english}</small>
                </span>
                <span className="ma-v10-quick-plus" aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </div>
        <img className="ma-v10-note" src={noteDecoration} alt="" aria-hidden="true" />
      </aside>
    </div>
  );
}

function recentIcon(entityType: RecentEditItem['entityType']): string {
  if (entityType === 'character_version') return '♙';
  if (entityType === 'codex_item') return '▤';
  if (entityType === 'event') return '✦';
  if (entityType === 'location') return '⌖';
  if (entityType === 'map') return '◇';
  if (entityType === 'timeline') return '⌁';
  return '□';
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
