import { useEffect, useMemo, useState } from 'react';
import { dataClient } from '../services/dataClient';
import type { Vault } from '../types/app';

interface TrashPageProps {
  vault: Vault;
}

interface TrashItem {
  entityType: string;
  id: string;
  title: string;
  deletedAt: string;
  parentTitle?: string | null;
  parentDeleted?: number;
  sourceTitle?: string | null;
}

const filters = [
  { key: 'all', label: '全部' },
  { key: 'character', label: '角色' },
  { key: 'character_version', label: '角色版本' },
  { key: 'codex_item', label: '词条' },
  { key: 'event', label: '事件' },
  { key: 'location', label: '地点' },
  { key: 'timeline', label: '时间线' },
  { key: 'map', label: '地图' },
  { key: 'manuscript', label: '手稿' }
];

const typeLabels = Object.fromEntries(filters.filter((item) => item.key !== 'all').map((item) => [item.key, item.label]));

export function TrashPage({ vault }: TrashPageProps): JSX.Element {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TrashItem | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const visibleItems = useMemo(
    () => filter === 'all' ? items : items.filter((item) => item.entityType === filter),
    [filter, items]
  );

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError('');
      setItems(await dataClient.listTrashItems(vault.path));
    } catch (cause) {
      console.error('读取回收站失败', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [vault.path]);

  async function restore(item: TrashItem): Promise<void> {
    try {
      setRestoringId(item.id);
      setMessage('');
      setError('');
      await dataClient.restoreTrashItem(vault.path, { entityType: item.entityType, id: item.id });
      setItems((current) => current.filter((entry) => !(entry.entityType === item.entityType && entry.id === item.id)));
      setMessage('已恢复到资料库');
    } catch (cause) {
      console.error('恢复资料失败', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestoringId('');
    }
  }

  function openPermanentDelete(item: TrashItem): void {
    setDeleteTarget(item);
    setMessage('');
    setError('');
  }

  function closePermanentDelete(): void {
    if (deletingId) return;
    setDeleteTarget(null);
  }

  async function permanentlyDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      setDeletingId(deleteTarget.id);
      setMessage('');
      setError('');
      await dataClient.permanentlyDeleteTrashItem(vault.path, {
        entityType: deleteTarget.entityType,
        id: deleteTarget.id
      });
      setItems((current) => current.filter((entry) => !(entry.entityType === deleteTarget.entityType && entry.id === deleteTarget.id)));
      setDeleteTarget(null);
      setMessage('已永久删除，无法恢复');
    } catch (cause) {
      console.error('永久删除资料失败', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId('');
    }
  }

  function itemNote(item: TrashItem): string {
    if (item.entityType === 'character_version') {
      if (!item.parentTitle) return '所属角色不可用';
      return item.parentDeleted ? `所属角色：${item.parentTitle}（已移入回收站）` : `所属角色：${item.parentTitle}`;
    }
    if (item.entityType === 'map' && item.sourceTitle) return `地图版本，基于：${item.sourceTitle}`;
    return '';
  }

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-5xl flex-col">
      <header className="shrink-0 border-b border-umber/25 pb-4">
        <h2 className="font-serif text-3xl font-semibold text-ink">回收站</h2>
        <p className="mt-2 text-sm text-sepia">已删除的资料会保留在此处，恢复后将回到原有资料库。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map((item) => (
            <button key={item.key} className={`subtab ${filter === item.key ? 'subtab-active' : ''}`} onClick={() => setFilter(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-5 pb-8">
        {message ? <div className="mb-4 rounded-md border border-olive/35 bg-batter/55 px-4 py-3 text-sm text-olive">{message}</div> : null}
        {error ? <div className="mb-4 rounded-md border border-spiced/35 bg-[#f0d2bd] px-4 py-3 text-sm text-spiced">{error}</div> : null}
        {loading ? <p className="py-12 text-center text-sepia">正在整理回收站...</p> : null}
        {!loading && visibleItems.length === 0 ? (
          <div className="paper-panel py-14 text-center">
            <p className="font-serif text-xl font-semibold text-ink">回收站为空。</p>
            <p className="mt-2 text-sm text-sepia">已删除的角色、资料、地图和手稿会出现在这里。</p>
          </div>
        ) : null}
        {!loading && visibleItems.length > 0 ? (
          <div className="space-y-3">
            {visibleItems.map((item) => (
              <article key={`${item.entityType}:${item.id}`} className="paper-panel flex min-w-0 flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded border border-olive/35 bg-batter/65 px-2 py-0.5 text-xs text-olive">
                      {typeLabels[item.entityType] ?? '资料'}
                    </span>
                    <h3 className="min-w-0 truncate font-serif text-lg font-semibold text-ink" title={item.title}>{item.title || '未命名资料'}</h3>
                  </div>
                  {itemNote(item) ? <p className="mt-2 truncate text-sm text-sepia" title={itemNote(item)}>{itemNote(item)}</p> : null}
                  <p className="mt-1 text-xs text-sepia/80">删除时间：{formatDeletedAt(item.deletedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="btn-ghost border-spiced/45 px-3 text-sm text-spiced"
                    disabled={Boolean(restoringId || deletingId)}
                    onClick={() => openPermanentDelete(item)}
                  >
                    永久删除
                  </button>
                  <button className="btn-primary shrink-0" disabled={Boolean(restoringId || deletingId)} onClick={() => void restore(item)}>
                    {restoringId === item.id ? '正在恢复...' : '恢复'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/40 p-5" onMouseDown={closePermanentDelete}>
          <div
            className="w-full max-w-lg rounded-md border border-spiced/45 bg-vellum p-5 shadow-folio"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="permanent-delete-title" className="font-serif text-2xl font-semibold text-ink">永久删除资料</h2>
            <p className="mt-4 leading-7 text-sepia">
              “{deleteTarget.title || '未命名资料'}”将被永久删除，且无法恢复。
              与其直接相关的内容和关联记录也会被清理。
            </p>
            {deleteTarget.entityType === 'character' ? (
              <p className="mt-3 rounded-md border border-spiced/35 bg-[#f0d2bd]/65 px-3 py-2 text-sm text-spiced">
                该角色及其全部角色版本将被永久删除。
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button className="btn-ghost" disabled={Boolean(deletingId)} onClick={closePermanentDelete}>取消</button>
              <button
                className="btn-primary border-spiced bg-spiced"
                autoFocus
                disabled={Boolean(deletingId)}
                onClick={() => void permanentlyDelete()}
              >
                {deletingId ? '正在永久删除...' : '永久删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDeletedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}
