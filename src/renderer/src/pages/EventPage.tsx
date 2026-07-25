import { useEffect, useMemo, useState } from 'react';
import { AddContentMenu } from '../components/AddContentMenu';
import { EditableField } from '../components/EditableField';
import { EditHistoryControls } from '../components/EditHistoryControls';
import { EntityLinksPanel } from '../components/EntityLinksPanel';
import { ListRail } from '../components/ListRail';
import { MapAssociationsSection } from '../components/MapAssociationsSection';
import { ReadEditToggle } from '../components/ReadEditToggle';
import { Section } from '../components/Section';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { useEditDraft } from '../hooks/useEditDraft';
import { dataClient } from '../services/dataClient';
import type { NavigationTarget, Vault } from '../types/app';

interface EventPageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'events' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

export function EventPage({ vault, target, onNavigate }: EventPageProps): JSX.Element {
  const [events, setEvents] = useState<any[]>([]);
  const [timelines, setTimelines] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [eventModules, setEventModules] = useState({
    timeline: false,
    startTime: false,
    endTime: false,
    duration: false,
    sort: false,
    links: false
  });
  const [error, setError] = useState('');
  const [mapLinks, setMapLinks] = useState<any[]>([]);
  const emptyDraft = {
    id: '',
    title: '',
    timelineId: '',
    startDisplayTime: '',
    endDisplayTime: '',
    durationNote: '',
    startSortIndex: 0,
    endSortIndex: 0,
    body: '',
    exportEnabled: 1,
    links: [] as any[]
  };
  const [saved, setSaved] = useState(emptyDraft);
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();
  const active = useMemo(() => events.find((item) => item.id === activeId), [events, activeId]);

  async function load(preferredId?: string): Promise<void> {
    try {
      setError('');
      const [nextEvents, nextTimelines] = await Promise.all([dataClient.listEvents(vault.path), dataClient.listTimelines(vault.path)]);
      setEvents(nextEvents);
      setTimelines(nextTimelines);
      const preferredExists = preferredId && nextEvents.some((item) => item.id === preferredId);
      if (preferredId && !preferredExists) setError('该事件不存在或已移入回收站。');
      setActiveId((preferredExists ? preferredId : '') || (nextEvents.some((item) => item.id === activeId) ? activeId : '') || nextEvents[0]?.id || '');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    load(target?.eventId);
  }, [vault.path, target?.eventId]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  useEffect(() => {
    if (!active) return;
    Promise.all([
      dataClient.listEntityLinks(vault.path, 'event', active.id),
      dataClient.listEntityMapLinks(vault.path, 'event', active.id)
    ]).then(([links, nextMapLinks]) => {
      const next = {
        id: active.id,
        title: active.title,
        timelineId: active.timelineId ?? '',
        startDisplayTime: active.startDisplayTime,
        endDisplayTime: active.endDisplayTime,
        durationNote: active.durationNote,
        startSortIndex: active.startSortIndex ?? 0,
        endSortIndex: active.endSortIndex ?? 0,
        body: active.body,
        exportEnabled: active.exportEnabled ?? 1,
        links
      };
      setSaved(next);
      resetDraft(next);
      setMapLinks(nextMapLinks);
      setEventModules({
        timeline: Boolean(next.timelineId),
        startTime: Boolean(next.startDisplayTime),
        endTime: Boolean(next.endDisplayTime),
        duration: Boolean(next.durationNote),
        sort: Boolean(next.startSortIndex || next.endSortIndex),
        links: links.length > 0
      });
      setAdvancedOpen(false);
    }).catch((cause) => {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    setEditing(false);
  }, [activeId, active?.updatedAt]);

  async function createEvent(): Promise<void> {
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
    await load(item.id);
  }

  async function save(): Promise<void> {
    await dataClient.saveEventAggregate(vault.path, { item: draft, links: draft.links });
    setSaved(draft);
    setEditing(false);
    await load(draft.id);
  }

  async function deleteEvent(): Promise<void> {
    if (!await confirmDanger(`确定要将“${draft.title}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteEvent(vault.path, activeId);
    setActiveId('');
    await load();
  }

  function displayTime(): string {
    if (draft.startDisplayTime && draft.endDisplayTime && draft.startDisplayTime !== draft.endDisplayTime) {
      return `${draft.startDisplayTime} — ${draft.endDisplayTime}`;
    }
    return draft.startDisplayTime || draft.endDisplayTime || '时间未注明';
  }

  function hasTimeInfo(): boolean {
    return Boolean(draft.timelineId || draft.startDisplayTime || draft.endDisplayTime);
  }

  function addContent(key: string): void {
    if (key === 'timeline') {
      setEventModules((current) => ({ ...current, timeline: true }));
    }
    if (key === 'startTime') {
      setEventModules((current) => ({ ...current, startTime: true }));
    }
    if (key === 'endTime') {
      setEventModules((current) => ({ ...current, endTime: true }));
    }
    if (key === 'duration') {
      setEventModules((current) => ({ ...current, duration: true }));
      if (!draft.durationNote) {
        setDraft((current) => ({ ...current, durationNote: '持续说明' }));
      }
    }
    if (key === 'sort') {
      setEventModules((current) => ({ ...current, sort: true }));
      setAdvancedOpen(true);
    }
    if (key === 'links') {
      setEventModules((current) => ({ ...current, links: true }));
    }
  }

  const hasLinkModule = eventModules.links || draft.links.length > 0;
  const hasSortModule = Boolean(eventModules.sort || draft.startSortIndex || draft.endSortIndex);

  return (
    <div className="grid h-full gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3">
        <button className="btn-primary w-full" onClick={createEvent}>新建事件</button>
        <ListRail title="事件列表" items={events.map((item) => item.title)} activeItem={active?.title ?? ''} onSelect={(title) => confirmNavigation(() => setActiveId(events.find((item) => item.title === title)?.id ?? ''))} />
      </aside>
      <Section
        title="事件详情"
        aside={
          <div className="flex items-center gap-2">
            {editing && <EditHistoryControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
            <ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={() => { resetDraft(saved); setEditing(false); }} />
          </div>
        }
      >
        {error && <div className="mb-4 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
        {!activeId ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无事件。点击左侧新建事件开始。</div>
        ) : (
          editing ? (
            <>
              <div className="space-y-4">
                <EditableField label="标题" value={draft.title} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
                <EditableField label="事件描述" value={draft.body} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, body: value }))} multiline />
                <AddContentMenu
                  options={[
                    !eventModules.timeline && !draft.timelineId ? { key: 'timeline', label: '所属时间线' } : null,
                    !eventModules.startTime && !draft.startDisplayTime ? { key: 'startTime', label: '开始故事时间' } : null,
                    !eventModules.endTime && !draft.endDisplayTime ? { key: 'endTime', label: '结束故事时间' } : null,
                    !eventModules.duration && !draft.durationNote ? { key: 'duration', label: '持续说明' } : null,
                    !eventModules.sort && !draft.startSortIndex && !draft.endSortIndex ? { key: 'sort', label: '高级排序' } : null,
                    !hasLinkModule ? { key: 'links', label: '关联对象' } : null
                  ].filter(Boolean) as { key: string; label: string }[]}
                  onSelect={addContent}
                />
                {(eventModules.timeline || draft.timelineId) && (
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">所属时间线</span>
                    <select className="field w-full" value={draft.timelineId} onChange={(event) => setDraft((current) => ({ ...current, timelineId: event.target.value }))}>
                      <option value="">无时间线</option>
                      {timelines.map((timeline) => <option key={timeline.id} value={timeline.id}>{timeline.name}</option>)}
                    </select>
                  </label>
                )}
                {(eventModules.startTime || eventModules.endTime || draft.startDisplayTime || draft.endDisplayTime) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {(eventModules.startTime || draft.startDisplayTime) && <EditableField label="开始故事时间" value={draft.startDisplayTime} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, startDisplayTime: value }))} />}
                    {(eventModules.endTime || draft.endDisplayTime) && <EditableField label="结束故事时间" value={draft.endDisplayTime} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, endDisplayTime: value }))} />}
                  </div>
                )}
                {(eventModules.duration || draft.durationNote) && <EditableField label="持续说明" value={draft.durationNote} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, durationNote: value }))} multiline />}
              </div>
              {hasSortModule && <div className="mt-5 rounded-md border border-umber/25 bg-vellum/70">
                <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setAdvancedOpen(!advancedOpen)}>
                  <span className="font-serif text-lg font-semibold text-ink">高级排序</span>
                  <span className="text-copper">{advancedOpen ? '收起' : '展开'}</span>
                </button>
                {advancedOpen && (
                  <div className="border-t border-sepia/20 p-4">
                    <p className="mb-4 text-sm leading-6 text-sepia">排序值用于系统内部排序，通常可在时间线视图中通过拖拽排序自动调整。</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="mini-panel"><EditableField label="开始排序值" value={String(draft.startSortIndex)} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, startSortIndex: Number(value) || 0 }))} /></div>
                      <div className="mini-panel"><EditableField label="结束排序值" value={String(draft.endSortIndex)} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, endSortIndex: Number(value) || 0 }))} /></div>
                    </div>
                  </div>
                )}
              </div>}
              {hasLinkModule && <div className="mt-5">
                <EntityLinksPanel vaultPath={vault.path} ownerEntityType="event" ownerEntityId={activeId} allowedTargetTypes={['character_version', 'location', 'codex_item']} editing={editing} draftLinks={draft.links} onDraftLinksChange={(links) => setDraft((current) => ({ ...current, links }))} inlineEditing />
              </div>}
              <button className="btn-ghost mt-5" onClick={deleteEvent}>删除事件</button>
            </>
          ) : (
            <>
              <h2 className="font-serif text-3xl font-semibold text-ink">{draft.title}</h2>
              {(hasTimeInfo() || draft.durationNote) && <div className="mt-4 rounded-md border border-umber/25 bg-vellum/70 px-4 py-3 text-sm leading-6 text-sepia">
                {hasTimeInfo() && <p>
                  <span>{timelines.find((timeline) => timeline.id === draft.timelineId)?.name ?? '无时间线'}</span>
                  <span className="mx-2 text-copper">·</span>
                  <span>{displayTime()}</span>
                </p>}
                {draft.durationNote && <p className="mt-2 text-copper">持续说明：{draft.durationNote}</p>}
              </div>}
              {draft.body && <div className="mt-4 rounded-md border border-sepia/20 bg-vellum p-4">
                <h3 className="mb-2 font-serif text-lg font-semibold text-ink">事件描述</h3>
                <p className="whitespace-pre-line leading-7 text-sepia">{draft.body}</p>
              </div>}
              <div className="mt-5">
                <MapAssociationsSection items={mapLinks} onOpen={onNavigate} />
              </div>
              {draft.links.length > 0 && <div className="mt-5">
                <EntityLinksPanel vaultPath={vault.path} ownerEntityType="event" ownerEntityId={activeId} allowedTargetTypes={['character_version', 'location', 'codex_item']} editing={editing} draftLinks={undefined} />
              </div>}
            </>
          )
        )}
      </Section>
    </div>
  );
}
