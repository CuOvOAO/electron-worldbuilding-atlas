import { useEffect, useMemo, useState } from 'react';
import { EditableField } from '../../components/EditableField';
import { EntityLinksPanel } from '../../components/EntityLinksPanel';
import { MapAssociationsSection } from '../../components/MapAssociationsSection';
import { ListRail } from '../../components/ListRail';
import { ReadEditToggle } from '../../components/ReadEditToggle';
import { Section } from '../../components/Section';
import { dataClient } from '../../services/dataClient';
import type { NavigationTarget, Vault } from '../../types/app';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { AddContentMenu } from '../../components/AddContentMenu';
import { EditHistoryControls } from '../../components/EditHistoryControls';
import { useEditDraft } from '../../hooks/useEditDraft';

interface LocationRecordsViewProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'locations' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

export function LocationRecordsView({ vault, target, onNavigate }: LocationRecordsViewProps): JSX.Element {
  const [locations, setLocations] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState(false);
  const emptyDraft = { id: '', name: '', type: '', summary: '', body: '', exportEnabled: 1, links: [] as any[] };
  const [saved, setSaved] = useState(emptyDraft);
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);
  const [error, setError] = useState('');
  const [mapLinks, setMapLinks] = useState<any[]>([]);
  const [linkManageSignal, setLinkManageSignal] = useState(0);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();
  const active = useMemo(() => locations.find((item) => item.id === activeId), [locations, activeId]);

  async function load(preferredId?: string): Promise<void> {
    try {
      const rows = await dataClient.listLocations(vault.path);
      setLocations(rows);
      const preferredExists = preferredId && rows.some((item) => item.id === preferredId);
      if (preferredId && !preferredExists) setError('该地点不存在或已移入回收站。');
      setActiveId((preferredExists ? preferredId : '') || (rows.some((item) => item.id === activeId) ? activeId : '') || rows[0]?.id || '');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    load(target?.locationId);
  }, [vault.path, target?.locationId]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  useEffect(() => {
    if (!active) return;
    Promise.all([
      dataClient.listEntityLinks(vault.path, 'location', active.id),
      dataClient.listEntityMapLinks(vault.path, 'location', active.id)
    ]).then(([links, nextMapLinks]) => {
      const next = { id: active.id, name: active.name, type: active.type, summary: active.summary, body: active.body, exportEnabled: active.exportEnabled ?? active.export_enabled ?? 1, links };
      setSaved(next);
      resetDraft(next);
      setMapLinks(nextMapLinks);
      setEditing(false);
    }).catch((cause) => {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [activeId, active?.updatedAt]);

  async function createLocation(): Promise<void> {
    const item = await dataClient.createLocation(vault.path, { name: '新地点', type: '地点', summary: '', body: '', exportEnabled: 1 });
    await load(item.id);
  }

  async function save(): Promise<void> {
    await dataClient.updateLocation(vault.path, draft);
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

  async function deleteLocation(): Promise<void> {
    if (!await confirmDanger(`确定要将“${draft.name}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteLocation(vault.path, activeId);
    setActiveId('');
    await load();
  }

  function addContent(key: string): void {
    if (key === 'body' && !draft.body) {
      setDraft((current) => ({ ...current, body: '正文说明' }));
    }
    if (key === 'links') {
      setLinkManageSignal((value) => value + 1);
    }
  }

  return (
    <div className="grid h-full gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3">
        <button className="btn-primary w-full" onClick={createLocation}>新建地点</button>
        <ListRail title="地点列表" items={locations.map((item) => item.name)} activeItem={active?.name ?? ''} onSelect={(name) => confirmNavigation(() => setActiveId(locations.find((item) => item.name === name)?.id ?? ''))} />
      </aside>
      <Section
        title="地点详情"
        aside={
          <div className="flex items-center gap-2">
            {editing && <EditHistoryControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
            <ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={() => { resetDraft(saved); setEditing(false); }} />
          </div>
        }
      >
        {error && <div className="mb-4 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
        {!activeId ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无地点。点击左侧新建地点开始。</div>
        ) : (
          <>
            <div className="space-y-4">
              <EditableField label="地点名称" value={draft.name} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
              {(editing || draft.type) && <EditableField label="地点类型" value={draft.type} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, type: value }))} />}
              <EditableField label="摘要" value={draft.summary} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, summary: value }))} multiline />
              {(editing || draft.body) && <EditableField label="正文说明" value={draft.body} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, body: value }))} multiline />}
              {editing && (
                <AddContentMenu
                  options={[
                    { key: 'body', label: '正文说明' },
                    { key: 'links', label: '关联对象' },
                    { key: 'note', label: '作者备注' }
                  ]}
                  onSelect={addContent}
                />
              )}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr]">
              {(editing || draft.links.length > 0) && <EntityLinksPanel vaultPath={vault.path} ownerEntityType="location" ownerEntityId={activeId} allowedTargetTypes={['character_version', 'event', 'codex_item']} editing={editing} draftLinks={editing ? draft.links : undefined} onDraftLinksChange={(links) => setDraft((current) => ({ ...current, links }))} manageSignal={linkManageSignal} />}
              {!editing && <MapAssociationsSection items={mapLinks} onOpen={onNavigate} />}
              <div className="mini-panel"><h3>空间资料说明</h3><p>地点资料与地图对象保持分离。地图中的点位、标签、路线与区域会通过关联资料回到这里展示。</p></div>
            </div>
            {editing && <button className="btn-ghost mt-5" onClick={deleteLocation}>删除地点</button>}
          </>
        )}
      </Section>
    </div>
  );
}
