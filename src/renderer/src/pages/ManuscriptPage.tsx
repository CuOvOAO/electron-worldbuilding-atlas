import { useEffect, useMemo, useState } from 'react';
import { EditableField } from '../components/EditableField';
import { EditableMarkdownBlock } from '../components/EditableMarkdownBlock';
import { EntityLinksPanel } from '../components/EntityLinksPanel';
import { AddContentMenu } from '../components/AddContentMenu';
import { EditHistoryControls } from '../components/EditHistoryControls';
import { ListRail } from '../components/ListRail';
import { ReadEditToggle } from '../components/ReadEditToggle';
import { Section } from '../components/Section';
import { dataClient } from '../services/dataClient';
import type { NavigationTarget, Vault } from '../types/app';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { useEditDraft } from '../hooks/useEditDraft';

const entryActions = ['新建碎片', '新建长文', '导入 TXT / Markdown', '关联角色', '关联词条', '关联事件', '关联地点'];

interface ManuscriptPageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'manuscripts' }> | null;
}

export function ManuscriptPage({ vault, target }: ManuscriptPageProps): JSX.Element {
  const [manuscripts, setManuscripts] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [linkManageSignal, setLinkManageSignal] = useState(0);
  const emptyDraft = { id: '', title: '', body: '', manuscriptType: 'fragment', exportEnabled: 1, links: [] as any[] };
  const [saved, setSaved] = useState(emptyDraft);
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();
  const active = useMemo(() => manuscripts.find((item) => item.id === activeId), [manuscripts, activeId]);

  async function load(preferredId?: string): Promise<void> {
    try {
      const rows = await dataClient.listManuscripts(vault.path);
      setManuscripts(rows);
      const preferredExists = preferredId && rows.some((item) => item.id === preferredId);
      if (preferredId && !preferredExists) setError('该手稿不存在或已移入回收站。');
      setActiveId((preferredExists ? preferredId : '') || (rows.some((item) => item.id === activeId) ? activeId : '') || rows[0]?.id || '');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    load(target?.manuscriptId);
  }, [vault.path, target?.manuscriptId]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  useEffect(() => {
    if (!active) return;
    dataClient.listEntityLinks(vault.path, 'manuscript', active.id).then((links) => {
      const next = { id: active.id, title: active.title, body: active.body, manuscriptType: active.manuscriptType ?? 'fragment', exportEnabled: active.exportEnabled ?? 1, links };
      setSaved(next);
      resetDraft(next);
      setEditing(false);
    }).catch((cause) => {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [activeId, active?.updatedAt]);

  async function createManuscript(type: string): Promise<void> {
    const item = await dataClient.createManuscript(vault.path, {
      title: type === 'longform' ? '新建长文' : '新建碎片',
      body: '',
      manuscriptType: type,
      exportEnabled: 1
    });
    await load(item.id);
  }

  async function save(): Promise<void> {
    await dataClient.updateManuscript(vault.path, draft);
    await syncLinks();
    setSaved(draft);
    setEditing(false);
    await load(draft.id);
  }

  async function syncLinks(): Promise<void> {
    const draftIds = new Set(draft.links.filter((link: any) => !String(link.id).startsWith('draft-')).map((link: any) => link.id));
    for (const link of draft.links) {
      if (String(link.id).startsWith('draft-')) {
        await dataClient.createEntityLink(vault.path, link);
      }
    }
    for (const link of saved.links) {
      if (!draftIds.has(link.id)) {
        await dataClient.deleteEntityLink(vault.path, link.id);
      }
    }
  }

  async function deleteManuscript(): Promise<void> {
    if (!await confirmDanger(`确定要将“${draft.title}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteManuscript(vault.path, activeId);
    setActiveId('');
    await load();
  }

  function addContent(key: string): void {
    if (key === 'note') {
      setDraft((current) => ({ ...current, body: `${current.body}${current.body ? '\n\n' : ''}作者备注：` }));
    }
    if (key === 'links') {
      setLinkManageSignal((value) => value + 1);
    }
  }

  return (
    <div className="grid h-full gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="paper-panel h-full overflow-auto">
        <h2 className="font-serif text-xl font-semibold text-ink">手稿箱 / Manuscripts</h2>
        <p className="mt-3 text-sm leading-6 text-sepia">把已有文字先放进来，再慢慢整理成角色、事件、地点与词条。</p>
        <div className="mt-5 grid gap-2">
          {entryActions.map((action) => (
            <button
              key={action}
              className="btn-parchment justify-start text-left"
              onClick={() => {
                if (action === '新建碎片') createManuscript('fragment');
                if (action === '新建长文') createManuscript('longform');
              }}
            >
              {action}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-sepia">导入 TXT / Markdown 入口已保留，V2 暂不读取真实文件。</p>
        <div className="mt-5">
          <ListRail title="手稿列表" items={manuscripts.map((item) => item.title)} activeItem={active?.title ?? ''} onSelect={(title) => confirmNavigation(() => setActiveId(manuscripts.find((item) => item.title === title)?.id ?? ''))} />
        </div>
      </aside>

      <Section
        title="手稿详情"
        aside={
          <div className="flex items-center gap-2">
            {editing && <EditHistoryControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
            <ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={() => { resetDraft(saved); setEditing(false); }} />
          </div>
        }
      >
        {error && <div className="mb-4 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
        {!activeId ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无手稿。点击左侧新建碎片或新建长文。</div>
        ) : (
          <div className="space-y-4">
            <EditableField label="标题" value={draft.title} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">类型</span>
              {editing ? (
                <select className="field" value={draft.manuscriptType} onChange={(event) => setDraft((current) => ({ ...current, manuscriptType: event.target.value }))}>
                  <option value="fragment">fragment</option>
                  <option value="scene">scene</option>
                  <option value="longform">longform</option>
                </select>
              ) : (
                <p className="text-sepia">{draft.manuscriptType}</p>
              )}
            </label>
            <EditableMarkdownBlock label="正文" value={draft.body} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, body: value }))} />
            {editing && (
              <AddContentMenu
                options={[
                  { key: 'links', label: '关联对象' },
                  { key: 'note', label: '作者备注' }
                ]}
                onSelect={addContent}
              />
            )}
            {(editing || draft.links.length > 0) && (
              <EntityLinksPanel vaultPath={vault.path} ownerEntityType="manuscript" ownerEntityId={activeId} allowedTargetTypes={['character_version', 'codex_item', 'event', 'location']} editing={editing} draftLinks={editing ? draft.links : undefined} onDraftLinksChange={(links) => setDraft((current) => ({ ...current, links }))} manageSignal={linkManageSignal} />
            )}
            {editing && <button className="btn-ghost" onClick={deleteManuscript}>删除手稿</button>}
          </div>
        )}
      </Section>
    </div>
  );
}
