import { useEffect, useMemo, useState } from 'react';
import { AddContentMenu } from '../components/AddContentMenu';
import { EditableField } from '../components/EditableField';
import { EditHistoryControls } from '../components/EditHistoryControls';
import { ReadEditToggle } from '../components/ReadEditToggle';
import { Section } from '../components/Section';
import { DragHandle, SortableCardList } from '../components/SortableCardList';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { useEditDraft } from '../hooks/useEditDraft';
import { dataClient } from '../services/dataClient';
import type { NavigationTarget, Vault } from '../types/app';

interface TimelinePageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'timeline' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

function sortByOrder(items: any[]): any[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

function hasSortValue(value: unknown): boolean {
  return value !== null && value !== undefined && Number(value) !== 0;
}

function bodySummary(body: string): string {
  const text = (body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

export function TimelinePage({ vault, target, onNavigate }: TimelinePageProps): JSX.Element {
  const [timelines, setTimelines] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [sortMessage, setSortMessage] = useState('');
  const [timelineModules, setTimelineModules] = useState({ parent: false, branchEvent: false, branchNote: false });
  const emptyDraft = { id: '', name: '', description: '', parentTimelineId: '', branchEventId: '', branchNote: '', sortOrder: 0 };
  const [saved, setSaved] = useState(emptyDraft);
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);
  const { draft: eventOrderDraft, setDraft: setEventOrderDraft, resetDraft: resetEventOrderDraft, canUndo: canUndoOrder, canRedo: canRedoOrder, undo: undoOrder, redo: redoOrder } = useEditDraft([] as string[], editing);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();

  const active = useMemo(() => timelines.find((item) => item.id === activeId), [timelines, activeId]);
  const timelineEvents = useMemo(() => events.filter((event) => event.timelineId === activeId), [events, activeId]);
  const sortedTimelineEvents = useMemo(
    () =>
      [...timelineEvents].sort((a, b) => {
        const aHasSort = hasSortValue(a.startSortIndex);
        const bHasSort = hasSortValue(b.startSortIndex);
        if (aHasSort !== bHasSort) return aHasSort ? -1 : 1;
        if (aHasSort && bHasSort && Number(a.startSortIndex) !== Number(b.startSortIndex)) {
          return Number(a.startSortIndex) - Number(b.startSortIndex);
        }
        return String(a.updatedAt ?? a.createdAt ?? '').localeCompare(String(b.updatedAt ?? b.createdAt ?? ''));
      }),
    [timelineEvents]
  );
  const orderedEvents = sortedTimelineEvents.filter((event) => hasSortValue(event.startSortIndex));
  const unsortedEvents = sortedTimelineEvents.filter((event) => !hasSortValue(event.startSortIndex));
  const eventOrderItems = eventOrderDraft.map((id) => timelineEvents.find((event) => event.id === id)).filter(Boolean);
  const orderChanged = editing && JSON.stringify(eventOrderDraft) !== JSON.stringify(sortedTimelineEvents.map((event) => event.id));

  async function load(preferredId?: string): Promise<void> {
    try {
      setError('');
      const [nextTimelines, nextEvents] = await Promise.all([dataClient.listTimelines(vault.path), dataClient.listEvents(vault.path)]);
      setTimelines(nextTimelines);
      setEvents(nextEvents);
      const byEvent = target?.eventId ? nextEvents.find((event) => event.id === target.eventId)?.timelineId : '';
      const requestedId = preferredId || byEvent || '';
      const requestedExists = requestedId && nextTimelines.some((item) => item.id === requestedId);
      if ((preferredId || target?.eventId) && !requestedExists) setError('目标时间线不存在或已移入回收站。');
      setActiveId((requestedExists ? requestedId : '') || (nextTimelines.some((item) => item.id === activeId) ? activeId : '') || nextTimelines[0]?.id || '');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    load(target?.timelineId);
  }, [vault.path, target?.timelineId, target?.eventId]);

  useEffect(() => {
    setHasUnsavedChanges((editing && JSON.stringify(draft) !== JSON.stringify(saved)) || orderChanged);
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, orderChanged, setHasUnsavedChanges]);

  useEffect(() => {
    if (!active) return;
    const next = {
      id: active.id,
      name: active.name,
      description: active.description,
      parentTimelineId: active.parentTimelineId ?? '',
      branchEventId: active.branchEventId ?? '',
      branchNote: active.branchNote,
      sortOrder: active.sortOrder ?? 0
    };
    setSaved(next);
    resetDraft(next);
    resetEventOrderDraft([]);
    setTimelineModules({
      parent: Boolean(next.parentTimelineId),
      branchEvent: Boolean(next.branchEventId),
      branchNote: Boolean(next.branchNote)
    });
    setEditing(false);
  }, [activeId, active?.updatedAt]);

  function startEditing(): void {
    resetEventOrderDraft(sortedTimelineEvents.map((event) => event.id));
    setSortMessage('');
    setEditing(true);
  }

  async function createTimeline(): Promise<void> {
    const item = await dataClient.createTimeline(vault.path, {
      name: '新时间线',
      description: '',
      parentTimelineId: '',
      branchEventId: '',
      branchNote: '',
      sortOrder: timelines.length
    });
    await load(item.id);
  }

  async function createEventInTimeline(): Promise<void> {
    if (!activeId || !editing) return;
    const nextSortIndex = eventOrderDraft.length > 0 ? (eventOrderDraft.length + 1) * 100 : sortedTimelineEvents.reduce((max, event) => Math.max(max, Number(event.startSortIndex) || 0), 0) + 100;
    const item = await dataClient.createEvent(vault.path, {
      title: '新事件',
      timelineId: activeId,
      startDisplayTime: '',
      endDisplayTime: '',
      durationNote: '',
      startSortIndex: nextSortIndex,
      endSortIndex: nextSortIndex,
      body: '',
      exportEnabled: 1
    });
    await load(activeId);
    resetEventOrderDraft([...eventOrderDraft, item.id]);
    onNavigate({ module: 'events', eventId: item.id });
  }

  async function save(): Promise<void> {
    await dataClient.updateTimeline(vault.path, draft);
    if (orderChanged) {
      const ordered = eventOrderDraft.map((id) => timelineEvents.find((event) => event.id === id)).filter(Boolean);
      await Promise.all(ordered.map((event, index) => dataClient.updateEvent(vault.path, {
        ...event,
        startSortIndex: (index + 1) * 100,
        endSortIndex: event.endSortIndex
      })));
      setSortMessage('排序已更新');
    }
    setSaved(draft);
    setEditing(false);
    resetEventOrderDraft([]);
    await load(draft.id);
  }

  function cancel(): void {
    resetDraft(saved);
    resetEventOrderDraft([]);
    setSortMessage('');
    setEditing(false);
  }

  async function deleteTimeline(): Promise<void> {
    if (!await confirmDanger(`确定要将“${draft.name}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteTimeline(vault.path, activeId);
    setActiveId('');
    await load();
  }

  function eventDisplayTime(event: any): string {
    if (event.startDisplayTime && event.endDisplayTime && event.startDisplayTime !== event.endDisplayTime) {
      return `${event.startDisplayTime} — ${event.endDisplayTime}`;
    }
    return event.startDisplayTime || event.endDisplayTime || '时间未注明';
  }

  function isIntervalEvent(event: any): boolean {
    return Boolean(event.startDisplayTime && event.endDisplayTime && event.startSortIndex !== null && event.endSortIndex !== null && Number(event.endSortIndex) > Number(event.startSortIndex));
  }

  function parentName(id: string): string {
    return timelines.find((line) => line.id === id)?.name ?? '';
  }

  function branchEventTitle(id: string): string {
    return events.find((event) => event.id === id)?.title ?? '';
  }

  function renderTimelineNode(line: any, depth = 0, visited = new Set<string>()): JSX.Element {
    if (visited.has(line.id)) return <div key={line.id} />;
    const nextVisited = new Set(visited);
    nextVisited.add(line.id);
    const children = sortByOrder(timelines.filter((item) => item.parentTimelineId === line.id));
    const activeNode = line.id === activeId;
    return (
      <div key={line.id} className="relative">
        {depth > 0 && <span className="absolute -left-5 top-6 h-[2px] w-5 bg-olive" />}
        <button
          className={`w-full rounded-md border-l-4 px-3 py-3 text-left transition hover:border-olive/90 ${activeNode ? 'border-copper bg-batter/85 text-copper shadow-folio ring-1 ring-copper/25' : depth === 0 ? 'border-l-olive border-y-sepia/25 border-r-sepia/25 bg-vellum text-ink' : 'border-l-olive/80 border-y-sepia/20 border-r-sepia/20 bg-vellum/85 text-ink'}`}
          style={{ marginLeft: depth ? `${depth * 18}px` : 0, width: depth ? `calc(100% - ${depth * 18}px)` : '100%' }}
          onClick={() => confirmNavigation(() => setActiveId(line.id))}
        >
          <span className={`block ${depth === 0 ? 'font-serif text-lg font-semibold' : 'font-medium'}`}>{line.name}</span>
          {line.parentTimelineId && <span className="mt-1 block text-xs text-sepia">分支自：{parentName(line.parentTimelineId)}</span>}
        </button>
        {children.length > 0 && <div className="mt-2 space-y-2 border-l-2 border-olive pl-5">{children.map((child) => renderTimelineNode(child, depth + 1, nextVisited))}</div>}
      </div>
    );
  }

  function renderEventCard(event: any, sorting = false): JSX.Element {
    const interval = isIntervalEvent(event);
    return (
      <div key={event.id} className="grid gap-3 md:grid-cols-[12rem_1.25rem_1fr]">
        <div className="text-sm leading-6 text-copper">
          <p className="line-clamp-2 rounded border border-olive/30 bg-batter/35 px-2 py-1">{eventDisplayTime(event)}</p>
        </div>
        <div className="relative flex justify-center">
          <span className="absolute bottom-[-1.25rem] top-0 w-[3px] bg-olive/80" />
          <span className={`relative z-10 mt-2 h-4 w-4 rounded-full border-2 ${interval ? 'border-copper bg-copper' : 'border-olive bg-batter'}`} />
        </div>
        <div className={`rounded-md border bg-vellum/85 p-4 text-left transition hover:-translate-y-0.5 hover:border-copper/60 hover:shadow-folio ${interval ? 'border-copper/45 md:py-5' : 'border-umber/25'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {sorting && <DragHandle />}
              <h4 className="font-serif text-xl font-semibold text-ink">{event.title}</h4>
            </div>
            {interval && <span className="rounded border border-copper/35 bg-batter/60 px-2 py-1 text-xs text-copper">区间事件</span>}
          </div>
          {bodySummary(event.body) && <p className="mt-2 text-sm leading-6 text-sepia">{bodySummary(event.body)}</p>}
          {!sorting && <button className="mt-3 text-xs text-copper" onClick={() => confirmNavigation(() => onNavigate({ module: 'events', eventId: event.id }))}>查看事件</button>}
        </div>
      </div>
    );
  }

  const roots = sortByOrder(timelines.filter((line) => !line.parentTimelineId || !timelines.some((item) => item.id === line.parentTimelineId)));
  const visibleEventItems = editing ? eventOrderItems : orderedEvents;

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Section title="时间线列表">
        {editing && <button className="btn-primary mb-4 w-full" onClick={createTimeline}>新建时间线</button>}
        <div className="space-y-3 text-sm">
          {timelines.length === 0 ? (
            <div className="rounded-md border border-dashed border-copper/40 p-3 text-sepia">暂无时间线。</div>
          ) : (
            roots.map((line) => renderTimelineNode(line))
          )}
        </div>
      </Section>

      <Section
        title="时间线详情"
        aside={
          <div className="flex items-center gap-2">
            {editing && <EditHistoryControls canUndo={canUndo || canUndoOrder} canRedo={canRedo || canRedoOrder} onUndo={canUndoOrder ? undoOrder : undo} onRedo={canRedoOrder ? redoOrder : redo} />}
            <ReadEditToggle editing={editing} onEdit={startEditing} onSave={save} onCancel={cancel} />
          </div>
        }
      >
        {error && <div className="mb-4 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
        {!activeId ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">请选择或新建时间线。</div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-md border border-umber/25 bg-vellum/80 p-5">
              {editing ? (
                <div className="space-y-4">
                  <EditableField label="名称" value={draft.name} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
                  <EditableField label="描述" value={draft.description} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} multiline />
                  <AddContentMenu
                    options={[
                      !timelineModules.parent && !draft.parentTimelineId ? { key: 'parent', label: '父时间线' } : null,
                      !timelineModules.branchEvent && !draft.branchEventId ? { key: 'branchEvent', label: '分叉事件' } : null,
                      !timelineModules.branchNote && !draft.branchNote ? { key: 'branchNote', label: '分支说明' } : null
                    ].filter(Boolean) as { key: string; label: string }[]}
                    onSelect={(key) => setTimelineModules((current) => ({ ...current, [key]: true }))}
                  />
                  {(timelineModules.parent || draft.parentTimelineId) && (
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">父时间线</span>
                      <select className="field w-full" value={draft.parentTimelineId} onChange={(event) => setDraft((current) => ({ ...current, parentTimelineId: event.target.value }))}>
                        <option value="">无</option>
                        {timelines.filter((line) => line.id !== activeId).map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
                      </select>
                    </label>
                  )}
                  {(timelineModules.branchEvent || draft.branchEventId) && (
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">分叉事件</span>
                      <select className="field w-full" value={draft.branchEventId} onChange={(event) => setDraft((current) => ({ ...current, branchEventId: event.target.value }))}>
                        <option value="">无</option>
                        {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                      </select>
                    </label>
                  )}
                  {(timelineModules.branchNote || draft.branchNote) && <EditableField label="分支说明" value={draft.branchNote} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, branchNote: value }))} multiline />}
                  <EditableField label="排序" value={String(draft.sortOrder)} editing={editing} onChange={(value) => setDraft((current) => ({ ...current, sortOrder: Number(value) || 0 }))} />
                  <button className="btn-ghost" onClick={deleteTimeline}>删除时间线</button>
                </div>
              ) : (
                <>
                  <h2 className="font-serif text-3xl font-semibold text-ink">{draft.name}</h2>
                  {draft.description && <p className="mt-3 leading-7 text-sepia">{draft.description}</p>}
                  <div className="mt-4 grid gap-3 text-sm text-sepia md:grid-cols-2">
                    {draft.parentTimelineId && <p>父时间线：{parentName(draft.parentTimelineId)}</p>}
                    {draft.branchEventId && <p>分叉事件：{branchEventTitle(draft.branchEventId)}</p>}
                    {draft.branchNote && <p className="md:col-span-2">分支说明：{draft.branchNote}</p>}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-2xl font-semibold text-ink">事件时间轴</h3>
                {sortMessage && <p className="mt-1 text-sm text-copper">{sortMessage}</p>}
              </div>
              {editing && <button className="btn-parchment" onClick={createEventInTimeline}>+ 在此时间线中新建事件</button>}
            </div>

            <div className="space-y-5">
              {editing ? (
                <SortableCardList
                  items={visibleEventItems}
                  getId={(event) => event.id}
                  onReorder={(items) => setEventOrderDraft(items.map((event) => event.id), { checkpoint: true })}
                  className="space-y-5"
                  renderItem={(event) => renderEventCard(event, true)}
                />
              ) : orderedEvents.length === 0 && unsortedEvents.length === 0 ? (
                <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">这条时间线下暂无事件。</div>
              ) : (
                orderedEvents.map((event) => renderEventCard(event))
              )}
            </div>

            {!editing && unsortedEvents.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-serif text-xl font-semibold text-ink">未排序事件</h3>
                <div className="space-y-5">{unsortedEvents.map((event) => renderEventCard(event))}</div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
