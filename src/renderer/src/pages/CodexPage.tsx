import { useEffect, useMemo, useState } from 'react';
import { EditableField } from '../components/EditableField';
import { EntityLinksPanel } from '../components/EntityLinksPanel';
import { AddContentMenu } from '../components/AddContentMenu';
import { EditHistoryControls } from '../components/EditHistoryControls';
import { ListRail } from '../components/ListRail';
import { MapAssociationsSection } from '../components/MapAssociationsSection';
import { ReadEditToggle } from '../components/ReadEditToggle';
import { Section } from '../components/Section';
import { dataClient } from '../services/dataClient';
import type { NavigationTarget, Vault } from '../types/app';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { useEditDraft } from '../hooks/useEditDraft';

interface CodexPageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'codex' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function CodexPage({ vault, target, onNavigate }: CodexPageProps): JSX.Element {
  const [items, setItems] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const emptyDraft = { item: { id: '', title: '', summary: '', type: '', exportEnabled: 1 }, aliases: [] as any[], blocks: [] as any[], links: [] as any[] };
  const [saved, setSaved] = useState(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [error, setError] = useState('');
  const [linkManageSignal, setLinkManageSignal] = useState(0);
  const [mapLinks, setMapLinks] = useState<any[]>([]);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);

  const activeItem = useMemo(() => items.find((item) => item.id === activeId) ?? null, [items, activeId]);

  async function loadItems(preferredId?: string): Promise<void> {
    try {
      setError('');
      const rows = await dataClient.listCodexItems(vault.path);
      setItems(rows);
      const preferredExists = preferredId && rows.some((item) => item.id === preferredId);
      if (preferredId && !preferredExists) setError('该词条不存在或已移入回收站。');
      const nextId = (preferredExists ? preferredId : '') || (rows.some((item) => item.id === activeId) ? activeId : '') || rows[0]?.id || '';
      setActiveId(nextId);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function loadDetail(itemId: string): Promise<void> {
    if (!itemId) {
      setSaved(emptyDraft);
      resetDraft(emptyDraft);
      return;
    }
    try {
      setError('');
      const item = await dataClient.getCodexItem(vault.path, itemId);
      if (!item) {
        setError('找不到该词条，可能已被删除。');
        return;
      }
      const nextItem = { id: item.id, title: item.title, summary: item.summary, type: item.type, exportEnabled: item.exportEnabled };
      const [nextAliases, nextBlocks, nextLinks, nextMapLinks] = await Promise.all([
        dataClient.listCodexAliases(vault.path, item.id),
        dataClient.listContentBlocks(vault.path, 'codex_item', item.id),
        dataClient.listEntityLinks(vault.path, 'codex_item', item.id),
        dataClient.listEntityMapLinks(vault.path, 'codex_item', item.id)
      ]);
      const next = { item: nextItem, aliases: nextAliases, blocks: nextBlocks, links: nextLinks };
      setSaved(next);
      resetDraft(next);
      setMapLinks(nextMapLinks);
      setEditing(false);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    loadItems(target?.codexItemId);
  }, [vault.path, target?.codexItemId]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  useEffect(() => {
    loadDetail(activeId);
  }, [activeId]);

  async function createItem(): Promise<void> {
    try {
      const item = await dataClient.createCodexItem(vault.path, { title: '新词条', summary: '', type: '概念', exportEnabled: 1 });
      await loadItems(item.id);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function save(): Promise<void> {
    try {
      await dataClient.saveCodexAggregate(vault.path, {
        item: draft.item,
        aliases: draft.aliases,
        blocks: draft.blocks,
        links: draft.links
      });
      setSaved(draft);
      setEditing(false);
      await loadItems(draft.item.id);
      await loadDetail(draft.item.id);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function deleteItem(): Promise<void> {
    if (!activeId) return;
    if (!await confirmDanger(`确定要将“${draft.item.title}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteCodexItem(vault.path, activeId);
    setActiveId('');
    await loadItems();
  }

  async function removeBlock(blockId: string): Promise<void> {
    if (!await confirmDanger('确定要删除这个正文段落吗？该操作会从当前编辑草稿中移除它。')) return;
    setDraft((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== blockId) }), { checkpoint: true });
  }

  async function addAlias(): Promise<void> {
    if (!newAlias.trim() || !activeId) return;
    setDraft((current) => ({ ...current, aliases: [...current.aliases, { id: `draft-${Date.now()}`, codexItemId: activeId, alias: newAlias.trim() }] }), { checkpoint: true });
    setNewAlias('');
  }

  function addBlock(): void {
    setDraft((current) => ({
      ...current,
      blocks: [
        ...current.blocks,
        {
          id: `draft-${Date.now()}`,
          title: '新段落',
          contentJson: JSON.stringify({ text: '正文内容待填写。' }),
          sortOrder: current.blocks.length,
          collapsed: 0,
          exportEnabled: 1
        }
      ]
    }), { checkpoint: true });
  }

  function addContent(key: string): void {
    if (key === 'alias') {
      setDraft((current) => ({ ...current, aliases: [...current.aliases, { id: `draft-${Date.now()}`, codexItemId: activeId, alias: '新别名' }] }), { checkpoint: true });
    }
    if (key === 'section') {
      addBlock();
    }
    if (key === 'note') {
      setDraft((current) => ({
        ...current,
        blocks: [
          ...current.blocks,
          {
            id: `draft-${Date.now()}`,
            title: '作者备注',
            contentJson: JSON.stringify({ text: '备注内容' }),
            sortOrder: current.blocks.length,
            collapsed: 0,
            exportEnabled: 0
          }
        ]
      }), { checkpoint: true });
    }
    if (key === 'links') {
      setLinkManageSignal((value) => value + 1);
    }
  }

  function blockText(block: any): string {
    try {
      return JSON.parse(block.contentJson || '{}').text ?? '';
    } catch {
      return block.contentJson;
    }
  }

  return (
    <div className="grid h-full gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3">
        <button className="btn-primary w-full" onClick={createItem}>新建词条</button>
        <ListRail title="词条索引" items={items.map((item) => item.title)} activeItem={activeItem?.title ?? ''} onSelect={(title) => confirmNavigation(() => setActiveId(items.find((item) => item.title === title)?.id ?? ''))} />
      </aside>
      <Section
        title="词条详情"
        aside={
          <div className="flex items-center gap-2">
            {editing && <EditHistoryControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
            <ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={() => { resetDraft(saved); setEditing(false); }} />
          </div>
        }
      >
        {error && <div className="mb-4 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
        {!activeId ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无词条。点击左侧新建词条开始。</div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_260px]">
            <article className="space-y-4">
              <EditableField label="标题" value={draft.item.title} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, item: { ...current.item, title: value } }))} />
              <EditableField label="一句话摘要" value={draft.item.summary} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, item: { ...current.item, summary: value } }))} multiline />
              <EditableField label="类型" value={draft.item.type} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, item: { ...current.item, type: value } }))} />
              {editing && (
                <AddContentMenu
                  options={[
                    { key: 'alias', label: '别名' },
                    { key: 'section', label: '正文段落' },
                    { key: 'links', label: '关联对象' },
                    { key: 'note', label: '作者备注' }
                  ]}
                  onSelect={addContent}
                />
              )}
              {(editing || draft.aliases.length > 0) && (
              <div className="mini-panel">
                <div className="mb-3 flex items-center justify-between">
                  <h3>别名</h3>
                  {editing && <button className="rounded border border-umber/30 px-2 py-1 text-xs text-copper" onClick={addAlias}>添加别名</button>}
                </div>
                {editing && <input className="field mb-3 w-full" value={newAlias} onChange={(event) => setNewAlias(event.target.value)} placeholder="新增别名" />}
                <div className="space-y-2">
                  {draft.aliases.length === 0 && editing ? <p>暂无记录。</p> : draft.aliases.map((alias) => (
                    <div key={alias.id} className="flex gap-2">
                      {editing ? (
                        <>
                          <input className="field min-w-0 flex-1" value={alias.alias} onChange={(event) => setDraft((current) => ({ ...current, aliases: current.aliases.map((item) => item.id === alias.id ? { ...item, alias: event.target.value } : item) }))} />
                          <button className="btn-ghost" onClick={() => setDraft((current) => ({ ...current, aliases: current.aliases.filter((item) => item.id !== alias.id) }), { checkpoint: true })}>删除</button>
                        </>
                      ) : <p>{alias.alias}</p>}
                    </div>
                  ))}
                </div>
              </div>
              )}
              {draft.blocks.length > 0 && (
              <div className="mini-panel">
                <div className="mb-3 flex items-center justify-between">
                  <h3>正文段落</h3>
                  {editing && <button className="btn-parchment" onClick={addBlock}>新增段落</button>}
                </div>
                <div className="space-y-3">
                  {draft.blocks.length === 0 && editing ? <p>暂无记录。</p> : draft.blocks.map((block, index) => (
                    <div key={block.id} className="rounded-md border border-umber/25 bg-vellum/75 p-3">
                      {editing ? (
                        <>
                          <input className="field mb-2 w-full" value={block.title} onChange={(event) => setDraft((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? { ...item, title: event.target.value } : item) }))} />
                          <textarea className="editable-textarea" value={blockText(block)} onChange={(event) => setDraft((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? { ...item, contentJson: JSON.stringify({ text: event.target.value }) } : item) }))} />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button className="btn-ghost" onClick={() => setDraft((current) => ({ ...current, blocks: moveItem(current.blocks, index, Math.max(0, index - 1)) }), { checkpoint: true })}>上移</button>
                            <button className="btn-ghost" onClick={() => setDraft((current) => ({ ...current, blocks: moveItem(current.blocks, index, Math.min(current.blocks.length - 1, index + 1)) }), { checkpoint: true })}>下移</button>
                            <button className="btn-ghost" onClick={() => removeBlock(block.id)}>删除段落</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h4 className="font-serif text-lg font-semibold text-ink">{block.title}</h4>
                          <p className="mt-2 whitespace-pre-line leading-7 text-sepia">{blockText(block)}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              )}
              {editing && <button className="btn-ghost" onClick={deleteItem}>删除词条</button>}
            </article>
            <aside className="space-y-4">
              {draft.blocks.length > 0 && (
                <div className="mini-panel">
                  <h3>正文目录</h3>
                  <p className="mb-2 text-xs text-sepia">由正文段落标题自动生成</p>
                  <p>{draft.blocks.map((block) => block.title).join(' / ')}</p>
                </div>
              )}
              <EntityLinksPanel
                vaultPath={vault.path}
                ownerEntityType="codex_item"
                ownerEntityId={activeId}
                allowedTargetTypes={['character_version', 'location', 'event', 'codex_item']}
                editing={editing}
                draftLinks={editing ? draft.links : undefined}
                onDraftLinksChange={(links) => setDraft((current) => ({ ...current, links }))}
                manageSignal={linkManageSignal}
              />
              {!editing && <MapAssociationsSection items={mapLinks} onOpen={onNavigate} />}
            </aside>
          </div>
        )}
      </Section>
    </div>
  );
}
