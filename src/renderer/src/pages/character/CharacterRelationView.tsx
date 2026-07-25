import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { Section } from '../../components/Section';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { dataClient } from '../../services/dataClient';
import type { NavigationTarget, Vault } from '../../types/app';

interface RelationNode {
  id: string;
  characterId: string;
  characterName: string;
  versionName: string;
  description: string;
  timelineId: string | null;
}

interface RelationshipRow {
  id: string;
  sourceCharacterVersionId: string;
  targetCharacterVersionId: string;
  timelineId: string | null;
  directionMode: 'directed' | 'undirected';
  sourceCharacterName?: string | null;
  sourceVersionName?: string | null;
  targetCharacterName?: string | null;
  targetVersionName?: string | null;
}

interface RelationshipStage {
  id?: string;
  relationshipId?: string;
  relationType: string;
  description: string;
  startSortIndex: number | null | string;
  endSortIndex: number | null | string;
  relatedEventId: string | null;
}

interface TimelineRow {
  id: string;
  name: string;
}

interface EventRow {
  id: string;
  title: string;
  timelineId: string | null;
  timelineName?: string | null;
  startDisplayTime: string;
  endDisplayTime: string;
  startSortIndex: number | null;
  endSortIndex: number | null;
}

interface RelationForm {
  id: string;
  sourceCharacterVersionId: string;
  targetCharacterVersionId: string;
  timelineId: string;
  relationType: string;
  description: string;
  startSortIndex: string;
  endSortIndex: string;
  relatedEventId: string;
  endRelatedEventId: string;
  directionMode: 'directed' | 'undirected';
}

type PopoverState =
  | { type: 'node'; x: number; y: number; node: RelationNode }
  | { type: 'edge'; x: number; y: number; relationship: RelationshipRow; stage: RelationshipStage };

interface CharacterRelationViewProps {
  vault: Vault;
  onNavigate: (target: NavigationTarget) => void;
}

interface RelationFlowNodeData {
  [key: string]: unknown;
  node: RelationNode;
}

interface RelationFlowEdgeData {
  [key: string]: unknown;
  relationship: RelationshipRow;
  stage: RelationshipStage;
  offset: number;
}

interface GraphEdge {
  relationship: RelationshipRow;
  stage: RelationshipStage;
}

interface GraphLayoutResult {
  nodes: RelationFlowNode[];
  edges: RelationFlowEdge[];
}

type RelationFlowNode = Node<RelationFlowNodeData, 'relationVersion'>;
type RelationFlowEdge = Edge<RelationFlowEdgeData, 'relationEdge'>;

const emptyForm: RelationForm = {
  id: '',
  sourceCharacterVersionId: '',
  targetCharacterVersionId: '',
  timelineId: '',
  relationType: '相关',
  description: '',
  startSortIndex: '',
  endSortIndex: '',
  relatedEventId: '',
  endRelatedEventId: '',
  directionMode: 'directed'
};

const nodeTypes = { relationVersion: RelationVersionNode };
const edgeTypes = { relationEdge: RelationEdge };

export function CharacterRelationView({ vault, onNavigate }: CharacterRelationViewProps): JSX.Element {
  const [nodes, setNodes] = useState<RelationNode[]>([]);
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [stages, setStages] = useState<RelationshipStage[]>([]);
  const [timelines, setTimelines] = useState<TimelineRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState('');
  const [showGeneral, setShowGeneral] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [form, setForm] = useState<RelationForm | null>(null);
  const [stageDrafts, setStageDrafts] = useState<RelationshipStage[]>([]);
  const [removedStageIds, setRemovedStageIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [onlyTimelineRelated, setOnlyTimelineRelated] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState('');
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [sourceSearch, setSourceSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [endEventSearch, setEndEventSearch] = useState('');
  const [showMoreSettings, setShowMoreSettings] = useState(false);
  const { confirmDanger } = useUnsavedChangesGuard();

  useEffect(() => {
    void load();
  }, [vault.path]);

  async function load(nextTimelineId?: string): Promise<void> {
    try {
      const [graph, timelineItems, eventItems] = await Promise.all([
        dataClient.listRelationGraph(vault.path),
        dataClient.listTimelines(vault.path),
        dataClient.listEvents(vault.path)
      ]);
      setNodes(graph.nodes);
      setRelationships(graph.relationships);
      setStages(graph.stages);
      setTimelines(timelineItems);
      setEvents(eventItems);
      setSelectedTimelineId((current) => nextTimelineId ?? (current || timelineItems[0]?.id || ''));
      setError('');
    } catch (loadError) {
      console.error(loadError);
      setError(readableError(loadError));
    }
  }

  const timelineEvents = useMemo(
    () =>
      events
        .filter((event) => event.timelineId === selectedTimelineId)
        .sort((a, b) => {
          const aSort = Number(a.startSortIndex) || 0;
          const bSort = Number(b.startSortIndex) || 0;
          if (aSort !== bSort) return aSort - bSort;
          return a.title.localeCompare(b.title);
        }),
    [events, selectedTimelineId]
  );
  const positionedEvents = timelineEvents.filter((event) => Number(event.startSortIndex) > 0);
  const unsortedEvents = timelineEvents.filter((event) => !event.startSortIndex);
  const selectedEvent = positionedEvents.find((event) => event.id === selectedEventId) ?? positionedEvents[0] ?? null;
  const currentPosition = selectedEvent ? Number(selectedEvent.startSortIndex) : null;

  const scopedRelationships = useMemo(
    () =>
      relationships.filter((relationship) => {
        if (!selectedTimelineId) return true;
        return relationship.timelineId === selectedTimelineId || (showGeneral && !relationship.timelineId);
      }),
    [relationships, selectedTimelineId, showGeneral]
  );

  const graphData = useMemo(() => {
    try {
      return buildRelationGraphLayout({
        nodes,
        relationships: scopedRelationships,
        stages,
        currentPosition,
        focusedNodeId,
        nodeSearch,
        showIsolated,
        onlyTimelineRelated,
        selectedTimelineId
      });
    } catch (layoutError) {
      console.error('关系网布局计算失败', layoutError);
      setError('关系网布局计算失败，请调整筛选条件后重试。');
      return { nodes: [], edges: [] } satisfies GraphLayoutResult;
    }
  }, [currentPosition, focusedNodeId, layoutVersion, nodeSearch, nodes, onlyTimelineRelated, scopedRelationships, selectedTimelineId, showIsolated, stages]);

  const focusedNode = nodes.find((node) => node.id === focusedNodeId) ?? null;
  const visibleRelationships = graphData.edges
    .filter((edge): edge is RelationFlowEdge & { data: RelationFlowEdgeData } => Boolean(edge.data))
    .map((edge) => ({ relationship: edge.data.relationship, stage: edge.data.stage }));
  const hasBrokenRelationships = relationships.some(
    (relationship) => !nodes.some((node) => node.id === relationship.sourceCharacterVersionId) || !nodes.some((node) => node.id === relationship.targetCharacterVersionId)
  );

  function nodeLabel(node: RelationNode): string {
    return `${node.characterName} / ${node.versionName || '默认版本'}`;
  }

  function relationshipTitle(relationship: RelationshipRow): string {
    const connector = relationship.directionMode === 'undirected' ? ' —— ' : ' → ';
    return `${relationship.sourceCharacterName ?? '已删除角色'} / ${relationship.sourceVersionName ?? '版本'}${connector}${relationship.targetCharacterName ?? '已删除角色'} / ${relationship.targetVersionName ?? '版本'}`;
  }

  function eventTime(event: EventRow): string {
    if (event.startDisplayTime && event.endDisplayTime && event.startDisplayTime !== event.endDisplayTime) {
      return `${event.startDisplayTime} — ${event.endDisplayTime}`;
    }
    return event.startDisplayTime || event.endDisplayTime || '时间未注明';
  }

  function openCreateForm(): void {
    setError('');
    setRemovedStageIds([]);
    setStageDrafts([]);
    setSourceSearch('');
    setTargetSearch('');
    setEventSearch('');
    setEndEventSearch('');
    setShowMoreSettings(false);
    setForm({ ...emptyForm, timelineId: selectedTimelineId });
  }

  function openCreateFromNode(node: RelationNode): void {
    setError('');
    setRemovedStageIds([]);
    setStageDrafts([]);
    setSourceSearch(node.characterName);
    setTargetSearch('');
    setEventSearch('');
    setEndEventSearch('');
    setShowMoreSettings(false);
    setForm({ ...emptyForm, sourceCharacterVersionId: node.id, timelineId: selectedTimelineId });
    setPopover(null);
  }

  function openEditForm(relationship: RelationshipRow): void {
    setError('');
    setRemovedStageIds([]);
    setForm({
      ...emptyForm,
      id: relationship.id,
      sourceCharacterVersionId: relationship.sourceCharacterVersionId,
      targetCharacterVersionId: relationship.targetCharacterVersionId,
      timelineId: relationship.timelineId ?? '',
      directionMode: relationship.directionMode ?? 'directed'
    });
    setStageDrafts(stages.filter((stage) => stage.relationshipId === relationship.id).map((stage) => ({ ...stage })));
    setSourceSearch('');
    setTargetSearch('');
    setEventSearch('');
    setEndEventSearch('');
    setShowMoreSettings(true);
  }

  function updateStage(index: number, patch: Partial<RelationshipStage>): void {
    setStageDrafts((current) => current.map((stage, stageIndex) => (stageIndex === index ? { ...stage, ...patch } : stage)));
  }

  function addStage(): void {
    setStageDrafts((current) => [
      ...current,
      { relationType: '相关', description: '', startSortIndex: '', endSortIndex: '', relatedEventId: null }
    ]);
  }

  async function removeStage(index: number): Promise<void> {
    const ok = await confirmDanger('确定要删除这个关系阶段吗？删除后该阶段会从关系时间线上移除。');
    if (!ok) return;
    const stage = stageDrafts[index];
    if (stage.id) {
      setRemovedStageIds((current) => [...current, stage.id as string]);
    }
    setStageDrafts((current) => current.filter((_, stageIndex) => stageIndex !== index));
  }

  async function saveRelationship(): Promise<void> {
    if (!form) return;
    try {
      if (!form.sourceCharacterVersionId || !form.targetCharacterVersionId || !form.relationType.trim()) {
        setError('关系创建失败，请检查起点、终点和关系类型是否已填写。');
        return;
      }
      if (form.sourceCharacterVersionId === form.targetCharacterVersionId) {
        setError('关系创建失败：起点和终点不能是同一个角色版本。');
        return;
      }
      await dataClient.saveRelationshipAggregate(vault.path, { relationship: form, stages: stageDrafts });
      setForm(null);
      setPopover(null);
      await load(selectedTimelineId);
    } catch (saveError) {
      console.error(saveError);
      setError(readableError(saveError));
    }
  }

  async function deleteRelationship(relationship: RelationshipRow): Promise<void> {
    const ok = await confirmDanger(`确定要删除关系“${relationshipTitle(relationship)}”吗？删除后该关系将从关系网中移除。`);
    if (!ok) return;
    await dataClient.deleteRelationship(vault.path, relationship.id);
    setPopover(null);
    await load(selectedTimelineId);
  }

  function chooseStageEvent(index: number, eventId: string): void {
    const event = events.find((item) => item.id === eventId);
    updateStage(index, {
      relatedEventId: eventId || null,
      startSortIndex: event?.startSortIndex ?? ''
    });
  }

  function chooseStageEndEvent(index: number, eventId: string): void {
    const event = events.find((item) => item.id === eventId);
    updateStage(index, {
      endSortIndex: event?.startSortIndex ?? ''
    });
  }

  return (
    <Section
      title="关系网络"
      aside={
        <div className="flex flex-wrap items-center gap-3">
          <select className="field" value={selectedTimelineId} onChange={(event) => { setSelectedTimelineId(event.target.value); setSelectedEventId(''); }}>
            <option value="">全部时间线</option>
            {timelines.map((timeline) => <option key={timeline.id} value={timeline.id}>{timeline.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-sepia">
            <input type="checkbox" checked={showGeneral} onChange={(event) => setShowGeneral(event.target.checked)} />
            显示通用关系
          </label>
          <button className="btn-primary" onClick={openCreateForm}>新建关系</button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-md border border-copper/35 bg-vellum p-3 text-copper">{error}</div>}
        <div className="rounded-md border border-umber/25 bg-vellum/80 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
            <input className="field" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="搜索角色名 / 版本名" />
            <label className="flex items-center gap-2 text-sm text-sepia">
              <input type="checkbox" checked={onlyTimelineRelated} onChange={(event) => setOnlyTimelineRelated(event.target.checked)} />
              只看当前时间线相关版本
            </label>
            <label className="flex items-center gap-2 text-sm text-sepia">
              <input type="checkbox" checked={showIsolated} onChange={(event) => setShowIsolated(event.target.checked)} />
              显示孤立角色
            </label>
            <button className="btn-ghost" onClick={() => setLayoutVersion((value) => value + 1)}>重置布局</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-umber/20 pt-3">
            <p className="text-sm text-sepia">
              {focusedNode ? <>当前聚焦：<span className="font-semibold text-ink">{nodeLabel(focusedNode)}</span></> : '总览模式：React Flow + d3-force 自动布局，孤立角色默认隐藏。'}
            </p>
            {focusedNode && (
              <div className="flex gap-2">
                <button className="btn-parchment" onClick={() => onNavigate({ module: 'characters', characterId: focusedNode.characterId, characterVersionId: focusedNode.id })}>查看角色详情</button>
                <button className="btn-ghost" onClick={() => setFocusedNodeId('')}>返回总览</button>
              </div>
            )}
          </div>
        </div>
        {nodes.length === 0 ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">还没有可用于关系网的角色版本。</div>
        ) : graphData.nodes.length === 0 ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">{focusedNode ? '这个角色暂时没有记录直接关系。' : '这条时间线还没有记录关系。'}</div>
        ) : (
          <div className="relative h-[640px] overflow-hidden rounded-md border border-umber/30 bg-batter/55">
            <div className="absolute left-5 top-5 z-10 rounded-md border border-umber/25 bg-vellum/90 px-4 py-3 text-sm text-sepia shadow-folio">
              <span className="font-semibold text-ink">当前时间点：</span>
              {selectedEvent ? `${eventTime(selectedEvent)}｜${selectedEvent.title}` : '未选择事件'}
            </div>
            {hasBrokenRelationships && (
              <div className="absolute right-5 top-5 z-10 rounded-md border border-copper/35 bg-vellum/90 px-4 py-3 text-sm text-copper shadow-folio">
                部分关系引用的角色版本已被删除，已在画布中自动跳过。
              </div>
            )}
            {visibleRelationships.length === 0 && (
              <div className="absolute inset-x-0 top-1/2 z-10 mx-auto w-fit -translate-y-1/2 rounded-md border border-dashed border-umber/35 bg-vellum/90 px-5 py-4 text-sepia">
                {focusedNode ? '这个角色暂时没有记录直接关系。' : '这条时间线还没有记录关系。'}
              </div>
            )}
            <ReactFlowProvider>
              <ReactFlow<RelationFlowNode, RelationFlowEdge>
                nodes={graphData.nodes}
                edges={graphData.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.32 }}
                minZoom={0.35}
                maxZoom={1.6}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                panOnDrag
                zoomOnScroll
                onPaneClick={() => setPopover(null)}
                onNodeClick={(event, node) => {
                  event.stopPropagation();
                  setPopover({ type: 'node', x: 65, y: 18, node: node.data.node });
                }}
                onEdgeClick={(event, edge) => {
                  event.stopPropagation();
                  if (!edge.data) return;
                  setPopover({ type: 'edge', x: 62, y: 20, relationship: edge.data.relationship, stage: edge.data.stage });
                }}
              >
                <Background color="#9D9167" gap={28} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
            {popover && (
              <div className="absolute inset-0 pointer-events-none z-20">
                <div className="pointer-events-auto absolute w-72 rounded-md border border-umber/35 bg-vellum p-4 text-sm shadow-folio" style={{ left: `${popover.x}%`, top: `${popover.y}%` }} onClick={(event) => event.stopPropagation()}>
                  {popover.type === 'node' ? (
                    <div className="space-y-3">
                      <h3 className="font-serif text-lg font-semibold text-ink">{popover.node.characterName}</h3>
                      <p className="text-xs text-copper">{popover.node.versionName || '默认版本'}</p>
                      {popover.node.description && <p className="leading-6 text-sepia">{popover.node.description}</p>}
                      <button className="btn-parchment w-full" onClick={() => { setFocusedNodeId(popover.node.id); setPopover(null); }}>聚焦此角色</button>
                      <button className="btn-parchment w-full" onClick={() => openCreateFromNode(popover.node)}>从此角色创建关系</button>
                      <button className="btn-parchment w-full" onClick={() => onNavigate({ module: 'characters', characterId: popover.node.characterId, characterVersionId: popover.node.id })}>查看角色版本</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="font-serif text-lg font-semibold text-ink">{relationshipTitle(popover.relationship)}</h3>
                      <p className="text-xs text-copper">关系类型：{popover.stage.relationType || '相关'}</p>
                      <p className="text-xs text-sepia">方向：{popover.relationship.directionMode === 'undirected' ? '无方向' : '有方向'}</p>
                      <p className="text-xs text-olive">时间范围：{stageEventRangeLabel(popover.stage, events)}</p>
                      <p className="leading-6 text-sepia">描述：{popover.stage.description || '该时间点暂无更详细的关系说明。'}</p>
                      <button className="btn-parchment w-full" onClick={() => openEditForm(popover.relationship)}>编辑关系</button>
                      {popover.stage.relatedEventId && <button className="btn-ghost w-full" onClick={() => onNavigate({ module: 'events', eventId: popover.stage.relatedEventId ?? undefined })}>查看起始事件</button>}
                      {endEventForStage(popover.stage, events) && <button className="btn-ghost w-full" onClick={() => onNavigate({ module: 'events', eventId: endEventForStage(popover.stage, events)?.id })}>查看结束事件</button>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded-md border border-umber/30 bg-vellum/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-serif text-xl font-semibold text-ink">当前时间线事件轴</h3>
            {selectedEvent && <span className="text-sm text-copper">关系阶段定位：{eventTime(selectedEvent)}</span>}
          </div>
          {selectedTimelineId && positionedEvents.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {positionedEvents.map((event) => (
                <button
                  key={event.id}
                  className={`min-w-56 rounded-md border px-4 py-3 text-left transition ${selectedEvent?.id === event.id ? 'border-copper bg-batter shadow-folio' : 'border-umber/25 bg-vellum hover:-translate-y-0.5 hover:shadow-folio'}`}
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <span className="block text-xs font-semibold text-copper">{eventTime(event)}</span>
                  <span className="mt-1 block font-serif text-lg text-ink">{event.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sepia">{selectedTimelineId ? '这条时间线还没有可定位关系阶段的事件。' : '选择一条时间线后，可以用事件轴定位关系阶段。'}</p>
          )}
          {unsortedEvents.length > 0 && (
            <div className="mt-4 border-t border-umber/20 pt-3">
              <p className="mb-2 text-sm font-semibold text-ink">未排序事件</p>
              <div className="flex flex-wrap gap-2">
                {unsortedEvents.map((event) => <span key={event.id} className="rounded border border-umber/25 bg-batter/45 px-3 py-1 text-sm text-sepia">{eventTime(event)}｜{event.title}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {form && (
        <RelationshipEditor
          form={form}
          setForm={setForm}
          nodes={nodes}
          timelines={timelines}
          events={events}
          sourceSearch={sourceSearch}
          setSourceSearch={setSourceSearch}
          targetSearch={targetSearch}
          setTargetSearch={setTargetSearch}
          eventSearch={eventSearch}
          setEventSearch={setEventSearch}
          endEventSearch={endEventSearch}
          setEndEventSearch={setEndEventSearch}
          showMoreSettings={showMoreSettings}
          setShowMoreSettings={setShowMoreSettings}
          stageDrafts={stageDrafts}
          updateStage={updateStage}
          addStage={addStage}
          removeStage={removeStage}
          onCancel={() => setForm(null)}
          onSave={() => void saveRelationship()}
          onDelete={form.id ? () => void deleteRelationship(relationships.find((relationship) => relationship.id === form.id) as RelationshipRow) : undefined}
          chooseStageEvent={chooseStageEvent}
          chooseStageEndEvent={chooseStageEndEvent}
        />
      )}
    </Section>
  );
}

function RelationVersionNode({ data }: NodeProps<RelationFlowNode>): JSX.Element {
  const node = data.node;
  return (
    <div className="relation-flow-node">
      <Handle id="top-source" type="source" position={Position.Top} className="opacity-0" />
      <Handle id="right-source" type="source" position={Position.Right} className="opacity-0" />
      <Handle id="bottom-source" type="source" position={Position.Bottom} className="opacity-0" />
      <Handle id="left-source" type="source" position={Position.Left} className="opacity-0" />
      <Handle id="top-target" type="target" position={Position.Top} className="opacity-0" />
      <Handle id="right-target" type="target" position={Position.Right} className="opacity-0" />
      <Handle id="bottom-target" type="target" position={Position.Bottom} className="opacity-0" />
      <Handle id="left-target" type="target" position={Position.Left} className="opacity-0" />
      <span className="relation-flow-avatar" />
      <p className="relation-flow-title" title={`${node.characterName} / ${node.versionName || '默认版本'}`}>{node.characterName} / {node.versionName || '默认版本'}</p>
    </div>
  );
}

function RelationEdge(props: EdgeProps<RelationFlowEdge>): JSX.Element {
  const offset = Number(props.data?.offset ?? 0);
  const edge = relationFlowEdgePath(props.sourceX, props.sourceY, props.targetX, props.targetY, offset);
  const relationship = props.data?.relationship;
  const stage = props.data?.stage;
  const stroke = relationship?.directionMode === 'undirected' ? '#84592B' : '#743014';

  return (
    <>
      <BaseEdge path={edge.path} markerEnd={props.markerEnd} style={{ stroke, strokeWidth: 1.55 }} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan relation-edge-label"
          style={{ transform: `translate(-50%, -50%) translate(${edge.labelX}px, ${edge.labelY}px)` }}
        >
          {stage?.relationType || '相关'}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

function relationFlowEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number, offset: number): { path: string; labelX: number; labelY: number } {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const normalX = -dy / length;
  const normalY = dx / length;
  const curve = Math.abs(offset) < 1 ? 0 : offset;
  const startGap = 4;
  const endGap = 14;
  const startX = sourceX + (dx / length) * startGap + normalX * curve;
  const startY = sourceY + (dy / length) * startGap + normalY * curve;
  const endX = targetX - (dx / length) * endGap + normalX * curve;
  const endY = targetY - (dy / length) * endGap + normalY * curve;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const controlX = midX + normalX * curve * 0.42;
  const controlY = midY + normalY * curve * 0.42;
  const curveMidX = curve === 0 ? midX : (startX * 0.25) + (controlX * 0.5) + (endX * 0.25);
  const curveMidY = curve === 0 ? midY : (startY * 0.25) + (controlY * 0.5) + (endY * 0.25);
  const labelShift = curve === 0 ? 18 : Math.sign(curve) * 20;
  const labelX = curveMidX + normalX * labelShift;
  const labelY = curveMidY + normalY * labelShift;

  if (curve === 0) {
    return {
      path: `M ${startX},${startY} L ${endX},${endY}`,
      labelX,
      labelY
    };
  }

  return {
    path: `M ${startX},${startY} Q ${controlX},${controlY} ${endX},${endY}`,
    labelX,
    labelY
  };
}

function RelationshipEditor({
  form,
  setForm,
  nodes,
  timelines,
  events,
  sourceSearch,
  setSourceSearch,
  targetSearch,
  setTargetSearch,
  eventSearch,
  setEventSearch,
  endEventSearch,
  setEndEventSearch,
  showMoreSettings,
  setShowMoreSettings,
  stageDrafts,
  updateStage,
  addStage,
  removeStage,
  onCancel,
  onSave,
  onDelete,
  chooseStageEvent,
  chooseStageEndEvent
}: {
  form: RelationForm;
  setForm: (form: RelationForm) => void;
  nodes: RelationNode[];
  timelines: TimelineRow[];
  events: EventRow[];
  sourceSearch: string;
  setSourceSearch: (value: string) => void;
  targetSearch: string;
  setTargetSearch: (value: string) => void;
  eventSearch: string;
  setEventSearch: (value: string) => void;
  endEventSearch: string;
  setEndEventSearch: (value: string) => void;
  showMoreSettings: boolean;
  setShowMoreSettings: (value: boolean | ((current: boolean) => boolean)) => void;
  stageDrafts: RelationshipStage[];
  updateStage: (index: number, patch: Partial<RelationshipStage>) => void;
  addStage: () => void;
  removeStage: (index: number) => Promise<void>;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  chooseStageEvent: (index: number, eventId: string) => void;
  chooseStageEndEvent: (index: number, eventId: string) => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-cowhide/35 p-6">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-md border border-umber/40 bg-vellum p-5 shadow-folio">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-2xl font-semibold text-ink">{form.id ? '编辑关系' : '新建关系'}</h2>
          <button className="btn-ghost" onClick={onCancel}>取消</button>
        </div>
        <div className="space-y-5">
          <div className="rounded-md border border-umber/25 bg-batter/30 p-4">
            <h3 className="mb-3 font-serif text-xl font-semibold text-ink">{form.id ? '关系本体' : '轻量关系卡'}</h3>
            <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
              <SearchableNodeSelect label="起点角色版本" value={form.sourceCharacterVersionId} onChange={(value) => setForm({ ...form, sourceCharacterVersionId: value })} nodes={nodes} search={sourceSearch} onSearchChange={setSourceSearch} />
              <div className="pb-4 text-center font-serif text-2xl text-copper">→</div>
              <SearchableNodeSelect label="终点角色版本" value={form.targetCharacterVersionId} onChange={(value) => setForm({ ...form, targetCharacterVersionId: value })} nodes={nodes} search={targetSearch} onSearchChange={setTargetSearch} excludeId={form.sourceCharacterVersionId} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {!form.id && (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">关系类型</span>
                  <input className="field w-full" value={form.relationType} onChange={(event) => setForm({ ...form, relationType: event.target.value })} placeholder="例如：盟友、师承、敌对" />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">方向性</span>
                <select className="field w-full" value={form.directionMode} onChange={(event) => setForm({ ...form, directionMode: event.target.value as 'directed' | 'undirected' })}>
                  <option value="directed">有方向</option>
                  <option value="undirected">无方向</option>
                </select>
              </label>
              <p className="text-xs leading-6 text-sepia md:col-span-2">有方向适合“喜欢、讨厌、保护、欺骗”等单向关系；无方向适合“同事、亲属、同盟”等身份关系。</p>
            </div>
          </div>

          <div className="rounded-md border border-umber/25 bg-vellum/75 p-4">
            <button className="btn-parchment" onClick={() => setShowMoreSettings((value) => !value)}>
              {showMoreSettings ? '收起更多设置' : '更多设置'}
            </button>
            {showMoreSettings && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">所属时间线</span>
                  <select className="field w-full" value={form.timelineId} onChange={(event) => setForm({ ...form, timelineId: event.target.value, relatedEventId: '', endRelatedEventId: '', startSortIndex: '', endSortIndex: '' })}>
                    <option value="">通用关系</option>
                    {timelines.map((timeline) => <option key={timeline.id} value={timeline.id}>{timeline.name}</option>)}
                  </select>
                </label>
                {!form.id && <InitialStageFields form={form} setForm={setForm} events={events} eventSearch={eventSearch} setEventSearch={setEventSearch} endEventSearch={endEventSearch} setEndEventSearch={setEndEventSearch} />}
              </div>
            )}
          </div>
        </div>

        {form.id && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-ink">关系阶段</h3>
              <button className="btn-parchment" onClick={addStage}>添加阶段</button>
            </div>
            {stageDrafts.length === 0 && <p className="rounded border border-dashed border-umber/30 p-4 text-sepia">还没有记录关系阶段。</p>}
            {stageDrafts.map((stage, index) => (
              <div key={stage.id ?? index} className="grid gap-3 rounded-md border border-umber/25 bg-batter/35 p-3 md:grid-cols-2">
                <input className="field" value={stage.relationType} onChange={(event) => updateStage(index, { relationType: event.target.value })} placeholder="关系类型" />
                <EventPicker label="起始事件，可选" value={stage.relatedEventId ?? ''} onChange={(value) => chooseStageEvent(index, value)} events={events} timelineId={form.timelineId} search={eventSearch} onSearchChange={setEventSearch} />
                <EventPicker label="结束事件，可选" value="" onChange={(value) => chooseStageEndEvent(index, value)} events={events} timelineId={form.timelineId} search={endEventSearch} onSearchChange={setEndEventSearch} />
                <input className="field" value={stage.startSortIndex ?? ''} onChange={(event) => updateStage(index, { startSortIndex: event.target.value })} placeholder="开始排序位置，可为空" />
                <input className="field" value={stage.endSortIndex ?? ''} onChange={(event) => updateStage(index, { endSortIndex: event.target.value })} placeholder="结束排序位置，可为空（不设结束）" />
                <p className="text-xs text-olive md:col-span-2">{stageRangeLabel(stage)}</p>
                <textarea className="field min-h-24 md:col-span-2" value={stage.description} onChange={(event) => updateStage(index, { description: event.target.value })} placeholder="阶段说明" />
                <div className="md:col-span-2 flex justify-end">
                  <button className="btn-ghost" onClick={() => void removeStage(index)}>删除阶段</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-between gap-3">
          {onDelete ? <button className="btn-ghost" onClick={onDelete}>删除关系</button> : <span />}
          <button className="btn-primary" onClick={onSave}>保存关系</button>
        </div>
      </div>
    </div>
  );
}

function currentStage(relationshipId: string, stages: RelationshipStage[], currentPosition: number | null): RelationshipStage | null {
  const candidates = stages.filter((stage) => stage.relationshipId === relationshipId);
  if (candidates.length === 0) return null;
  if (currentPosition === null) {
    return candidates.find((stage) => stage.startSortIndex === null || stage.startSortIndex === '') ?? candidates[0];
  }
  return candidates
    .filter((stage) => {
      const start = stage.startSortIndex === null || stage.startSortIndex === '' ? -Infinity : Number(stage.startSortIndex);
      const end = stage.endSortIndex === null || stage.endSortIndex === '' ? Infinity : Number(stage.endSortIndex);
      return start <= currentPosition && currentPosition <= end;
    })
    .sort((a, b) => Number(b.startSortIndex ?? -Infinity) - Number(a.startSortIndex ?? -Infinity))[0] ?? null;
}

function buildRelationGraphLayout(input: {
  nodes: RelationNode[];
  relationships: RelationshipRow[];
  stages: RelationshipStage[];
  currentPosition: number | null;
  focusedNodeId: string;
  nodeSearch: string;
  showIsolated: boolean;
  onlyTimelineRelated: boolean;
  selectedTimelineId: string;
}): GraphLayoutResult {
  const keyword = input.nodeSearch.trim().toLowerCase();
  const hasSearch = keyword.length > 0;
  const relatedNodeIds = new Set(input.relationships.flatMap((relationship) => [relationship.sourceCharacterVersionId, relationship.targetCharacterVersionId]));
  const directRelationships = input.focusedNodeId
    ? input.relationships.filter((relationship) => relationship.sourceCharacterVersionId === input.focusedNodeId || relationship.targetCharacterVersionId === input.focusedNodeId)
    : input.relationships;
  const directNodeIds = new Set(directRelationships.flatMap((relationship) => [relationship.sourceCharacterVersionId, relationship.targetCharacterVersionId]));
  if (input.focusedNodeId) {
    directNodeIds.add(input.focusedNodeId);
  }

  const visibleNodes = input.nodes.filter((node) => {
    const matchesSearch = !keyword || `${node.characterName} ${node.versionName}`.toLowerCase().includes(keyword);
    const matchesTimeline = !input.onlyTimelineRelated || relatedNodeIds.has(node.id) || node.timelineId === input.selectedTimelineId;
    const matchesIsolation = input.showIsolated || hasSearch || relatedNodeIds.has(node.id);
    const matchesFocus = !input.focusedNodeId || directNodeIds.has(node.id);
    return matchesSearch && matchesTimeline && matchesIsolation && matchesFocus;
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const graphEdges: GraphEdge[] = directRelationships
    .filter((relationship) => visibleNodeIds.has(relationship.sourceCharacterVersionId) && visibleNodeIds.has(relationship.targetCharacterVersionId))
    .map((relationship) => ({ relationship, stage: currentStage(relationship.id, input.stages, input.currentPosition) }))
    .filter((item): item is GraphEdge => Boolean(item.stage));

  if (input.focusedNodeId && graphEdges.length === 0) {
    const focused = visibleNodes.find((node) => node.id === input.focusedNodeId);
    return focused ? { nodes: [toFlowNode(focused, { x: 0, y: 0 })], edges: [] } : { nodes: [], edges: [] };
  }

  const graphNodeIds = new Set(graphEdges.flatMap((edge) => [edge.relationship.sourceCharacterVersionId, edge.relationship.targetCharacterVersionId]));
  const finalNodes = visibleNodes.filter((node) => graphNodeIds.has(node.id) || (input.showIsolated && !input.focusedNodeId) || hasSearch || node.id === input.focusedNodeId);
  if (finalNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const positions = input.focusedNodeId
    ? focusLayout(finalNodes, graphEdges, input.focusedNodeId)
    : forceLayout(finalNodes, graphEdges, input.showIsolated);
  const flowNodes = finalNodes.map((node) => toFlowNode(node, positions.get(node.id) ?? { x: 0, y: 0 }));
  const siblingOffsets = edgeOffsets(graphEdges.map((edge) => edge.relationship));
  const flowEdges: RelationFlowEdge[] = graphEdges.map(({ relationship, stage }) => ({
    ...toFlowEdge(relationship, stage, positions, siblingOffsets.get(relationship.id) ?? 0)
  }));
  return { nodes: flowNodes, edges: flowEdges };
}

function toFlowNode(node: RelationNode, position: { x: number; y: number }): RelationFlowNode {
  return {
    id: node.id,
    type: 'relationVersion',
    position,
    data: { node },
    draggable: true
  };
}

function toFlowEdge(relationship: RelationshipRow, stage: RelationshipStage, positions: Map<string, { x: number; y: number }>, offset: number): RelationFlowEdge {
  const source = positions.get(relationship.sourceCharacterVersionId) ?? { x: 0, y: 0 };
  const target = positions.get(relationship.targetCharacterVersionId) ?? { x: 0, y: 0 };
  const handles = nearestHandles(source, target);
  return {
    id: relationship.id,
    type: 'relationEdge',
    source: relationship.sourceCharacterVersionId,
    target: relationship.targetCharacterVersionId,
    sourceHandle: `${handles.source}-source`,
    targetHandle: `${handles.target}-target`,
    data: { relationship, stage, offset },
    markerEnd: relationship.directionMode === 'directed' ? { type: MarkerType.ArrowClosed, color: '#743014', width: 14, height: 14 } : undefined
  };
}

function nearestHandles(source: { x: number; y: number }, target: { x: number; y: number }): { source: 'top' | 'right' | 'bottom' | 'left'; target: 'top' | 'right' | 'bottom' | 'left' } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
  }
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
}

function forceLayout(nodes: RelationNode[], edges: GraphEdge[], showIsolated: boolean): Map<string, { x: number; y: number }> {
  const degree = new Map<string, number>();
  edges.forEach(({ relationship }) => {
    degree.set(relationship.sourceCharacterVersionId, (degree.get(relationship.sourceCharacterVersionId) ?? 0) + 1);
    degree.set(relationship.targetCharacterVersionId, (degree.get(relationship.targetCharacterVersionId) ?? 0) + 1);
  });
  const simulationNodes = nodes.map((node, index) => ({
    id: node.id,
    x: Math.cos(index * 1.7) * 310,
    y: Math.sin(index * 1.7) * 230,
    degree: degree.get(node.id) ?? 0
  }));
  const links = edges.map(({ relationship }) => ({ source: relationship.sourceCharacterVersionId, target: relationship.targetCharacterVersionId }));
  const simulation = forceSimulation(simulationNodes as any)
    .force('link', forceLink(links).id((item: any) => item.id).distance(292).strength(0.31))
    .force('charge', forceManyBody().strength(-920))
    .force('collide', forceCollide(124).strength(1))
    .force('center', forceCenter(0, 0))
    .force('x', forceX((item: any) => (item.degree > 2 ? 0 : item.degree === 0 && showIsolated ? 360 : 0)).strength((item: any) => (item.degree > 2 ? 0.08 : 0.025)))
    .force('y', forceY(0).strength(0.04))
    .stop();
  for (let index = 0; index < 180; index += 1) {
    simulation.tick();
  }
  const positions = new Map<string, { x: number; y: number }>();
  simulationNodes.forEach((node) => positions.set(node.id, { x: Number(node.x) || 0, y: Number(node.y) || 0 }));
  return positions;
}

function focusLayout(nodes: RelationNode[], edges: GraphEdge[], focusedNodeId: string): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focusedNodeId, { x: 0, y: 0 });
  const neighbors = nodes.filter((node) => node.id !== focusedNodeId);
  const radius = Math.max(340, 190 + neighbors.length * 28);
  neighbors.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(neighbors.length, 1);
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  if (neighbors.length > 8) {
    return forceLayout(nodes, edges, false);
  }
  return positions;
}

function edgeOffsets(relationships: RelationshipRow[]): Map<string, number> {
  const result = new Map<string, number>();
  const groups = new Map<string, RelationshipRow[]>();
  relationships.forEach((relationship) => {
    const key = unorderedPairKey(relationship.sourceCharacterVersionId, relationship.targetCharacterVersionId);
    groups.set(key, [...(groups.get(key) ?? []), relationship]);
  });
  groups.forEach((items) => {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const center = (sorted.length - 1) / 2;
    sorted.forEach((relationship, index) => result.set(relationship.id, (index - center) * 24));
  });
  return result;
}

function unorderedPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function SearchableNodeSelect({
  label,
  value,
  onChange,
  nodes,
  search,
  onSearchChange,
  excludeId
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  nodes: RelationNode[];
  search: string;
  onSearchChange: (value: string) => void;
  excludeId?: string;
}): JSX.Element {
  const keyword = search.trim().toLowerCase();
  const options = nodes.filter((node) => {
    if (excludeId && node.id === excludeId) return false;
    if (!keyword) return true;
    return `${node.characterName} ${node.versionName}`.toLowerCase().includes(keyword);
  });

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">{label}</span>
        <input className="field w-full" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="按角色名 / 版本名搜索" />
      </label>
      <select className="field w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择角色版本</option>
        {options.map((node) => <option key={node.id} value={node.id}>{node.characterName} / {node.versionName || '默认版本'}</option>)}
      </select>
      {options.length === 0 && <p className="text-xs text-sepia">没有匹配的角色版本。</p>}
    </div>
  );
}

function InitialStageFields({
  form,
  setForm,
  events,
  eventSearch,
  setEventSearch,
  endEventSearch,
  setEndEventSearch
}: {
  form: RelationForm;
  setForm: (form: RelationForm) => void;
  events: EventRow[];
  eventSearch: string;
  setEventSearch: (value: string) => void;
  endEventSearch: string;
  setEndEventSearch: (value: string) => void;
}): JSX.Element {
  function chooseEvent(eventId: string): void {
    const event = events.find((item) => item.id === eventId);
    setForm({ ...form, relatedEventId: eventId, startSortIndex: event?.startSortIndex ? String(event.startSortIndex) : form.startSortIndex });
  }

  function chooseEndEvent(eventId: string): void {
    const event = events.find((item) => item.id === eventId);
    setForm({ ...form, endRelatedEventId: eventId, endSortIndex: event?.startSortIndex ? String(event.startSortIndex) : form.endSortIndex });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EventPicker label="起始事件，可选" value={form.relatedEventId} onChange={chooseEvent} events={events} timelineId={form.timelineId} search={eventSearch} onSearchChange={setEventSearch} />
      <EventPicker label="结束事件，可选" value={form.endRelatedEventId} onChange={chooseEndEvent} events={events} timelineId={form.timelineId} search={endEventSearch} onSearchChange={setEndEventSearch} />
      <input className="field" value={form.startSortIndex} onChange={(event) => setForm({ ...form, startSortIndex: event.target.value })} placeholder="起始排序位置，可为空" />
      <input className="field" value={form.endSortIndex} onChange={(event) => setForm({ ...form, endSortIndex: event.target.value })} placeholder="结束排序位置，可为空（不设结束）" />
      <p className="text-xs text-olive md:col-span-2">{stageRangeLabel(form)}</p>
      <textarea className="field min-h-24 md:col-span-2" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="初始关系描述" />
    </div>
  );
}

function EventPicker({
  label,
  value,
  onChange,
  events,
  timelineId,
  search,
  onSearchChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  events: EventRow[];
  timelineId: string;
  search: string;
  onSearchChange: (value: string) => void;
}): JSX.Element {
  const keyword = search.trim().toLowerCase();
  const options = events.filter((event) => {
    const matchesTimeline = Boolean(timelineId) && event.timelineId === timelineId;
    const matchesSearch = !keyword || `${eventTimeLabel(event)} ${event.title}`.toLowerCase().includes(keyword);
    return matchesTimeline && matchesSearch;
  });

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">{label}</span>
        <input className="field w-full" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="按故事时间 / 事件名搜索" />
      </label>
      <select className="field w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{timelineId ? '不绑定事件' : '通用关系：先选择时间线再绑定事件'}</option>
        {options.map((event) => <option key={event.id} value={event.id}>{eventTimeLabel(event)} / {event.title}</option>)}
      </select>
      {!timelineId ? <p className="text-xs text-sepia">通用关系可以不绑定事件；如果要绑定起止事件，请先选择所属时间线。</p> : options.length === 0 && <p className="text-xs text-sepia">没有匹配的事件。</p>}
    </div>
  );
}

function eventTimeLabel(event: EventRow): string {
  if (event.startDisplayTime && event.endDisplayTime && event.startDisplayTime !== event.endDisplayTime) {
    return `${event.startDisplayTime} — ${event.endDisplayTime}`;
  }
  return event.startDisplayTime || event.endDisplayTime || '时间未注明';
}

function stageEventRangeLabel(stage: RelationshipStage, events: EventRow[]): string {
  const startEvent = stage.relatedEventId ? events.find((event) => event.id === stage.relatedEventId) : null;
  const endEvent = endEventForStage(stage, events);
  const start = startEvent ? `${eventTimeLabel(startEvent)} / ${startEvent.title}` : '从时间线开始';
  const end = endEvent ? `${eventTimeLabel(endEvent)} / ${endEvent.title}` : '持续中';
  return `${start} → ${end}`;
}

function endEventForStage(stage: RelationshipStage, events: EventRow[]): EventRow | null {
  if (stage.endSortIndex === null || stage.endSortIndex === '') {
    return null;
  }
  const endSortIndex = Number(stage.endSortIndex);
  return events.find((event) => Number(event.startSortIndex) === endSortIndex) ?? null;
}

function stageRangeLabel(stage: Pick<RelationshipStage, 'startSortIndex' | 'endSortIndex'>): string {
  const start = stage.startSortIndex === null || stage.startSortIndex === '' ? '从时间线开始' : `排序位置 ${stage.startSortIndex}`;
  const end = stage.endSortIndex === null || stage.endSortIndex === '' ? '持续中 / 不设结束' : `至 ${stage.endSortIndex}`;
  return `${start}，${end}`;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('relationship_stages.end_sort_index') || message.includes('NOT NULL constraint failed')) {
    return '关系阶段保存失败：结束时间可以为空，请确认数据库迁移已完成。';
  }
  if (message.includes('同一时间线下已存在')) {
    return '关系创建失败：同一时间线下已经存在这条方向关系。';
  }
  if (message.includes('起点和终点')) {
    return '关系创建失败：起点和终点不能是同一个角色版本。';
  }
  return message || '关系操作失败，请稍后再试。';
}
