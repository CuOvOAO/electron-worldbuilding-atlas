import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CollapsiblePanel } from '../../components/CollapsiblePanel';
import { EditableField } from '../../components/EditableField';
import { ReadEditToggle } from '../../components/ReadEditToggle';
import { Section } from '../../components/Section';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { assetClient, type AssetRecord } from '../../services/assetClient';
import { dataClient } from '../../services/dataClient';
import type { NavigationTarget, Vault } from '../../types/app';

type MapObjectType = 'marker' | 'label' | 'route' | 'region';
type MapTool = 'select' | 'marker' | 'label' | 'route' | 'regionRect' | 'regionEllipse' | 'regionPolygon' | 'regionTriangle' | 'regionHexagon' | 'regionDiamond' | 'regionPentagon';
type RegionDragMode = 'move' | 'routePoint' | 'regionPoint' | 'resizeRegion' | 'rotateRegion';
type DraftMutationMode = 'immediate' | 'debounced' | 'transient';

interface LocationMapViewProps {
  vault: Vault;
  targetMapId?: string;
  targetMapObjectId?: string;
  onNavigate: (target: NavigationTarget) => void;
}

interface MapRecord {
  id: string;
  title: string;
  description: string;
  backgroundAssetId: string | null;
  backgroundAssetUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  sourceMapId: string | null;
  sourceMapTitle: string;
  sourceMapDeleted: boolean;
  versionGroupId: string | null;
  updatedAt: string;
}

interface MapPoint {
  x: number;
  y: number;
}

interface MapLayer {
  id: string;
  mapId: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  sortOrder: number;
  objectCount: number;
  isDefault: boolean;
}

interface BaseMapObject {
  id: string;
  mapId: string;
  layerId: string | null;
  type: MapObjectType;
  name: string;
  description: string;
  x: number;
  y: number;
  linkedEntities: MapObjectLinkedEntity[];
}

interface MapObjectLinkedEntity {
  entityType: 'location' | 'event' | 'character_version' | 'codex_item';
  entityId: string;
  title: string;
  linkType: string;
  note: string;
  deleted?: boolean;
}

interface MarkerObject extends BaseMapObject {
  type: 'marker';
  locationId: string | null;
  locationName: string;
}

interface LabelStyle {
  fontSize: number;
  color: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  opacity: number;
}

interface LabelObject extends BaseMapObject {
  type: 'label';
  text: string;
  style: LabelStyle;
}

interface RouteStyle {
  stroke: string;
  strokeWidth: number;
  dashEnabled: boolean;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  opacity: number;
  arrowEnabled: boolean;
  arrowDirection: 'none' | 'forward' | 'backward' | 'both';
  arrowSize: number;
}

interface RouteObject extends BaseMapObject {
  type: 'route';
  points: MapPoint[];
  style: RouteStyle;
}

type RegionGeometry =
  | { shape: 'rect'; x: number; y: number; width: number; height: number; rotation: number }
  | { shape: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number; rotation: number }
  | { shape: 'triangle'; x: number; y: number; radius: number; rotation: number }
  | { shape: 'hexagon'; x: number; y: number; radius: number; rotation: number }
  | { shape: 'diamond'; x: number; y: number; width: number; height: number; rotation: number }
  | { shape: 'pentagon'; x: number; y: number; radius: number; rotation: number }
  | { shape: 'polygon'; points: MapPoint[] };

type RegionShapeKind = RegionGeometry['shape'];
type SnapPreview = { point: MapPoint; kind: 'vertex' | 'edge' };

interface RegionStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  dashEnabled: boolean;
  labelVisible: boolean;
}

interface RegionObject extends BaseMapObject {
  type: 'region';
  geometry: RegionGeometry;
  style: RegionStyle;
}

type MapObject = MarkerObject | LabelObject | RouteObject | RegionObject;

interface MapDraft {
  title: string;
  description: string;
  backgroundAssetId: string | null;
  backgroundAssetUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  layers: MapLayer[];
  objects: MapObject[];
}

interface LocationOption {
  id: string;
  name: string;
  type?: string;
}

interface CodexOption {
  id: string;
  title: string;
  type?: string;
}

interface LinkTargetOption {
  entityType: 'location' | 'event' | 'character_version' | 'codex_item' | 'manuscript' | 'timeline';
  id: string;
  characterId?: string | null;
  title: string;
}

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const minScale = 0.12;
const maxScale = 6;
const maxHistorySteps = 100;
const formHistoryDelay = 650;
const labelDefaults: LabelStyle = {
  fontSize: 18,
  color: '#442D1C',
  backgroundEnabled: true,
  backgroundColor: '#fff4d4',
  opacity: 1
};
const routeDefaults: RouteStyle = {
  stroke: '#6f3f24',
  strokeWidth: 3,
  dashEnabled: false,
  lineStyle: 'solid',
  opacity: 0.9,
  arrowEnabled: false,
  arrowDirection: 'none',
  arrowSize: 12
};
const regionDefaults: RegionStyle = {
  fill: '#8f6f3f',
  fillOpacity: 0.25,
  stroke: '#6f3f24',
  strokeWidth: 2,
  dashEnabled: false,
  labelVisible: true
};

export function LocationMapView({ vault, targetMapId, targetMapObjectId, onNavigate }: LocationMapViewProps): JSX.Element {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [activeMapId, setActiveMapId] = useState('');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [codexItems, setCodexItems] = useState<CodexOption[]>([]);
  const [linkTargets, setLinkTargets] = useState<LinkTargetOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<MapDraft | null>(null);
  const [undoStack, setUndoStack] = useState<MapDraft[]>([]);
  const [redoStack, setRedoStack] = useState<MapDraft[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [activeLayerId, setActiveLayerId] = useState('');
  const [rightTab, setRightTab] = useState<'properties' | 'layers'>('properties');
  const [tool, setTool] = useState<MapTool>('select');
  const [routeDraft, setRouteDraft] = useState<MapPoint[]>([]);
  const [regionDraft, setRegionDraft] = useState<MapPoint[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [mapMenuId, setMapMenuId] = useState('');
  const [duplicateSource, setDuplicateSource] = useState<MapRecord | null>(null);
  const [duplicateTitle, setDuplicateTitle] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 });
  const [pendingFocus, setPendingFocus] = useState<{ mapId: string; objectId: string } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<MapDraft | null>(null);
  const undoStackRef = useRef<MapDraft[]>([]);
  const redoStackRef = useRef<MapDraft[]>([]);
  const pendingHistoryRef = useRef<{ baseline: MapDraft; key: string } | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const dragHistoryRef = useRef<MapDraft | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const objectDragRef = useRef<{
    id: string;
    pointerId: number;
    mode: RegionDragMode;
    pointIndex?: number;
    lastPoint?: MapPoint;
    center?: MapPoint;
    lastAngle?: number;
    rotation?: number;
  } | null>(null);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();

  const activeMap = maps.find((map) => map.id === activeMapId) ?? null;
  const selectedObject = draft?.objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedObjectLayer = selectedObject ? draft?.layers.find((layer) => layer.id === selectedObject.layerId) ?? null : null;
  const activeLayer = draft?.layers.find((layer) => layer.id === activeLayerId) ?? null;
  const effectiveTool: MapTool = editing ? tool : 'select';
  const zoomPercent = Math.round(view.scale * 100);
  const canUndo = editing && (routeDraft.length > 0 || regionDraft.length > 0 || undoStack.length > 0);
  const canRedo = editing && routeDraft.length === 0 && regionDraft.length === 0 && redoStack.length > 0;
  const hasDraftChanges = editing && (JSON.stringify(draft) !== JSON.stringify(savedDraft) || routeDraft.length > 0 || regionDraft.length > 0);

  useEffect(() => {
    return () => {
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!draft) return;
    if (selectedObjectId && !draft.objects.some((object) => object.id === selectedObjectId)) {
      setSelectedObjectId('');
    }
    const active = draft.layers.find((layer) => layer.id === activeLayerId);
    if (!active || !active.visible || active.locked) {
      setActiveLayerId(
        draft.layers.find((layer) => layer.visible && !layer.locked)?.id
        || draft.layers[0]?.id
        || ''
      );
    }
  }, [draft, selectedObjectId, activeLayerId]);

  useEffect(() => {
    loadAll(targetMapId);
  }, [vault.path, targetMapId]);

  useEffect(() => {
    if (targetMapId && targetMapObjectId) {
      setPendingFocus({ mapId: targetMapId, objectId: targetMapObjectId });
    } else {
      setPendingFocus(null);
    }
  }, [targetMapId, targetMapObjectId]);

  useEffect(() => {
    if (activeMapId) {
      loadMapDraft(activeMapId);
    } else {
      replaceDraft(null);
      setSavedDraft(null);
      resetHistory();
      setSelectedObjectId('');
      setActiveLayerId('');
      setRouteDraft([]);
      setRegionDraft([]);
      setSnapPreview(null);
    }
  }, [activeMapId, vault.path, maps]);

  useEffect(() => {
    if (!draft || !pendingFocus || pendingFocus.mapId !== activeMapId) {
      return;
    }
    const focusObject = draft.objects.find((object) => object.id === pendingFocus.objectId);
    if (!focusObject) {
      setError('目标地图对象不存在、已被删除，或暂时无法定位。');
      setPendingFocus(null);
      return;
    }
    setSelectedObjectId(focusObject.id);
    setRightTab('properties');
    focusMapObject(focusObject);
    setPendingFocus(null);
  }, [draft, pendingFocus, activeMapId]);

  useEffect(() => {
    const dirty = editing && (JSON.stringify(draft) !== JSON.stringify(savedDraft) || routeDraft.length > 0 || regionDraft.length > 0);
    setHasUnsavedChanges(Boolean(dirty));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, savedDraft, routeDraft, regionDraft, setHasUnsavedChanges]);

  useEffect(() => {
    if (!draft) return;
    if (pendingFocus?.mapId === activeMapId) return;
    window.requestAnimationFrame(() => fitViewport());
  }, [activeMapId, draft?.canvasWidth, draft?.canvasHeight, leftCollapsed, rightCollapsed, pendingFocus]);

  useEffect(() => {
    function handleResize(): void {
      fitViewport();
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draft]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && routeDraft.length > 0) {
        setRouteDraft([]);
        setSnapPreview(null);
        setTool('select');
      } else if (event.key === 'Escape' && regionDraft.length > 0) {
        setRegionDraft([]);
        setSnapPreview(null);
        setTool('select');
      } else if (editing && (event.ctrlKey || event.metaKey) && !isTextEditingTarget(event.target)) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          undoDraftChange();
        } else if ((key === 'z' && event.shiftKey) || key === 'y') {
          event.preventDefault();
          redoDraftChange();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, routeDraft, regionDraft, undoStack.length, redoStack.length]);

  function replaceDraft(next: MapDraft | null): void {
    draftRef.current = next;
    setDraft(next);
  }

  function replaceUndoStack(next: MapDraft[]): void {
    undoStackRef.current = next;
    setUndoStack(next);
  }

  function replaceRedoStack(next: MapDraft[]): void {
    redoStackRef.current = next;
    setRedoStack(next);
  }

  function pushUndoSnapshot(snapshot: MapDraft): void {
    const next = [...undoStackRef.current, cloneMapDraft(snapshot)].slice(-maxHistorySteps);
    replaceUndoStack(next);
  }

  function pushRedoSnapshot(snapshot: MapDraft): void {
    const next = [...redoStackRef.current, cloneMapDraft(snapshot)].slice(-maxHistorySteps);
    replaceRedoStack(next);
  }

  function clearHistoryTimer(): void {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
  }

  function commitPendingHistory(): void {
    clearHistoryTimer();
    const pending = pendingHistoryRef.current;
    pendingHistoryRef.current = null;
    const current = draftRef.current;
    if (pending && current && !draftsEqual(pending.baseline, current)) {
      pushUndoSnapshot(pending.baseline);
    }
  }

  function resetHistory(): void {
    clearHistoryTimer();
    pendingHistoryRef.current = null;
    dragHistoryRef.current = null;
    replaceUndoStack([]);
    replaceRedoStack([]);
  }

  function schedulePendingHistoryCommit(): void {
    clearHistoryTimer();
    historyTimerRef.current = window.setTimeout(() => {
      commitPendingHistory();
    }, formHistoryDelay);
  }

  function mutateDraft(
    updater: (current: MapDraft) => MapDraft,
    mode: DraftMutationMode = 'debounced',
    historyKey = 'draft'
  ): void {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(current);
    if (draftsEqual(current, next)) return;

    if (mode === 'immediate') {
      commitPendingHistory();
      pushUndoSnapshot(current);
      replaceRedoStack([]);
    } else if (mode === 'debounced') {
      if (pendingHistoryRef.current && pendingHistoryRef.current.key !== historyKey) {
        commitPendingHistory();
      }
      if (!pendingHistoryRef.current) {
        pendingHistoryRef.current = { baseline: cloneMapDraft(current), key: historyKey };
      }
      replaceRedoStack([]);
      schedulePendingHistoryCommit();
    }

    replaceDraft(next);
  }

  function undoDraftChange(): void {
    if (!editing) return;
    if (routeDraft.length > 0) {
      setRouteDraft((current) => current.slice(0, -1));
      setSnapPreview(null);
      return;
    }
    if (regionDraft.length > 0) {
      setRegionDraft((current) => current.slice(0, -1));
      setSnapPreview(null);
      return;
    }
    commitPendingHistory();
    const current = draftRef.current;
    const history = undoStackRef.current;
    const previous = history[history.length - 1];
    if (!current || !previous) return;
    replaceUndoStack(history.slice(0, -1));
    pushRedoSnapshot(current);
    replaceDraft(cloneMapDraft(previous));
  }

  function redoDraftChange(): void {
    if (!editing || routeDraft.length > 0 || regionDraft.length > 0) return;
    commitPendingHistory();
    const current = draftRef.current;
    const history = redoStackRef.current;
    const next = history[history.length - 1];
    if (!current || !next) return;
    replaceRedoStack(history.slice(0, -1));
    pushUndoSnapshot(current);
    replaceDraft(cloneMapDraft(next));
  }

  function beginEditing(): void {
    resetHistory();
    setEditing(true);
  }

  async function refreshMaps(preferredMapId?: string): Promise<MapRecord[]> {
    const mapRows = await dataClient.listMaps(vault.path);
    const nextMaps = mapRows as MapRecord[];
    setMaps(nextMaps);
    setActiveMapId((current) => {
      if (preferredMapId && nextMaps.some((map) => map.id === preferredMapId)) return preferredMapId;
      if (current && nextMaps.some((map) => map.id === current)) return current;
      return current || nextMaps[0]?.id || '';
    });
    return nextMaps;
  }

  async function loadAll(preferredMapId?: string): Promise<void> {
    try {
      setError('');
      const [mapRows, locationRows, codexRows, targetRows] = await Promise.all([
        dataClient.listMaps(vault.path),
        dataClient.listLocations(vault.path),
        dataClient.listCodexItems(vault.path),
        dataClient.listLinkTargets(vault.path)
      ]);
      const nextMaps = mapRows as MapRecord[];
      setMaps(nextMaps);
      setLocations(locationRows as LocationOption[]);
      setCodexItems(codexRows as CodexOption[]);
      setLinkTargets((targetRows as LinkTargetOption[]).filter((item) => item.entityType === 'location' || item.entityType === 'event' || item.entityType === 'character_version' || item.entityType === 'codex_item'));
      setActiveMapId((current) => {
        if (preferredMapId && nextMaps.some((map) => map.id === preferredMapId)) return preferredMapId;
        if (preferredMapId) {
          setError('目标地图不存在或已被删除。');
          if (current && nextMaps.some((map) => map.id === current)) {
            return current;
          }
          return '';
        }
        if (current && nextMaps.some((map) => map.id === current)) return current;
        return nextMaps[0]?.id || '';
      });
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function loadMapDraft(mapId: string): Promise<void> {
    try {
      setError('');
      if (!maps.some((item) => item.id === mapId)) {
        setError('目标地图不存在或已被删除。');
        return;
      }
      const map = maps.find((item) => item.id === mapId);
      const layers = await dataClient.listMapLayers(vault.path, mapId);
      const objects = await dataClient.getMapObjects(vault.path, mapId);
      const next = toDraft(map, objects as any[], layers as any[]);
      replaceDraft(next);
      setSavedDraft(next);
      resetHistory();
      setSelectedObjectId((current) => next?.objects.some((object) => object.id === current) ? current : '');
      setActiveLayerId((current) => next?.layers.some((layer) => layer.id === current && layer.visible && !layer.locked)
        ? current
        : next?.layers.find((layer) => layer.visible && !layer.locked)?.id || next?.layers[0]?.id || '');
      setRightTab('properties');
      setRouteDraft([]);
      setRegionDraft([]);
      setSnapPreview(null);
      setTool('select');
      setEditing(false);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function createMap(): Promise<void> {
    try {
      setCreating(true);
      setError('');
      const map = await dataClient.createMap(vault.path, { title: '新建地图', description: '' });
      await refreshMaps(map.id);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }

  async function save(): Promise<void> {
    if (!activeMap || !draft) return;
    if (routeDraft.length > 0 || regionDraft.length > 0) {
      setError('请先完成或取消正在绘制的对象。');
      return;
    }
    try {
      setError('');
      await dataClient.saveMapAggregate(vault.path, {
        map: {
        id: activeMap.id,
        title: draft.title,
        description: draft.description,
        backgroundAssetId: draft.backgroundAssetId,
        canvasWidth: draft.canvasWidth,
        canvasHeight: draft.canvasHeight
        },
        layers: draft.layers.map((layer, index) => ({ ...layer, sortOrder: index })),
        objects: draft.objects.map(serializeMapObject)
      });
      await refreshMaps(activeMap.id);
      await loadMapDraft(activeMap.id);
      resetHistory();
      setEditing(false);
      setTool('select');
      setSnapPreview(null);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function cancel(): void {
    replaceDraft(savedDraft ? cloneMapDraft(savedDraft) : null);
    resetHistory();
    setActiveLayerId((current) => savedDraft?.layers.some((layer) => layer.id === current && layer.visible && !layer.locked)
      ? current
      : savedDraft?.layers.find((layer) => layer.visible && !layer.locked)?.id || savedDraft?.layers[0]?.id || '');
    setRouteDraft([]);
    setRegionDraft([]);
    setSnapPreview(null);
    setTool('select');
    setEditing(false);
  }

  async function deleteMap(): Promise<void> {
    if (!activeMap) return;
    if (!await confirmDanger(`确定要将“${activeMap.title}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteMap(vault.path, activeMap.id);
    const nextMaps = maps.filter((map) => map.id !== activeMap.id);
    await refreshMaps(nextMaps[0]?.id);
  }

  function chooseMap(mapId: string): void {
    if (!maps.some((item) => item.id === mapId)) {
      setError('目标地图不存在或已被删除。');
      return;
    }
    confirmNavigation(() => setActiveMapId(mapId));
  }

  function setDraftField<K extends keyof MapDraft>(key: K, value: MapDraft[K]): void {
    mutateDraft((current) => ({ ...current, [key]: value }), 'debounced', `map:${String(key)}`);
  }

  function openDuplicateDialog(map: MapRecord): void {
    setMapMenuId('');
    setSuccessMessage('');
    if (hasDraftChanges) {
      setError('请先保存或取消当前地图的未保存修改，再复制地图版本。');
      return;
    }
    setError('');
    setDuplicateSource(map);
    setDuplicateTitle(suggestDuplicateTitle(map.title, maps));
  }

  async function duplicateMap(): Promise<void> {
    if (!duplicateSource || duplicating) return;
    const title = duplicateTitle.trim();
    if (!title) {
      setError('新地图名称不能为空。');
      return;
    }
    try {
      setDuplicating(true);
      setError('');
      setSuccessMessage('');
      const map = await dataClient.duplicateMapAsVersion(vault.path, {
        sourceMapId: duplicateSource.id,
        title
      }) as MapRecord;
      await refreshMaps(map.id);
      setDuplicateSource(null);
      setDuplicateTitle('');
      setSuccessMessage(`已创建地图版本“${map.title}”。`);
    } catch (cause) {
      console.error('复制地图版本失败', cause);
      setError(cause instanceof Error ? cause.message : '复制地图版本失败。');
    } finally {
      setDuplicating(false);
    }
  }

  function updateObject(
    objectId: string,
    patch: Partial<MapObject>,
    historyMode: DraftMutationMode = 'debounced',
    historyKey = `object:${objectId}:${Object.keys(patch).sort().join(',')}`
  ): void {
    const currentDraft = draftRef.current;
    const currentObject = currentDraft?.objects.find((object) => object.id === objectId);
    const layer = currentObject ? currentDraft?.layers.find((item) => item.id === currentObject.layerId) : null;
    if (layer?.locked) {
      setError(`图层“${layer.name}”已锁定，请先解锁后再编辑。`);
      return;
    }
    mutateDraft((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === objectId ? normalizeUpdatedObject({ ...object, ...patch } as MapObject) : object)
    }), historyMode, historyKey);
  }

  function deleteObject(objectId: string): void {
    const currentObject = draft?.objects.find((object) => object.id === objectId);
    const layer = currentObject ? draft?.layers.find((item) => item.id === currentObject.layerId) : null;
    if (layer?.locked) {
      setError(`图层“${layer.name}”已锁定，请先解锁后再删除对象。`);
      return;
    }
    mutateDraft((current) => ({ ...current, objects: current.objects.filter((object) => object.id !== objectId) }), 'immediate');
    setSelectedObjectId('');
  }

  async function confirmDeleteObject(object: MapObject): Promise<void> {
    const label = object.type === 'marker' ? 'marker' : object.type === 'label' ? '文字标签' : object.type === 'route' ? '路线' : '区域';
    if (!await confirmDanger(`确定要删除“${object.name || label}”吗？`)) return;
    deleteObject(object.id);
  }

  function screenToMap(clientX: number, clientY: number): MapPoint | null {
    if (!viewportRef.current || !draft) return null;
    const rect = viewportRef.current.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left - view.x) / view.scale, 0, draft.canvasWidth),
      y: clamp((clientY - rect.top - view.y) / view.scale, 0, draft.canvasHeight)
    };
  }

  function handleCanvasClick(clientX: number, clientY: number): void {
    if (!draft) return;
    const point = screenToMap(clientX, clientY);
    if (!point) return;
    if (!editing || effectiveTool === 'select') {
      setSelectedObjectId('');
      return;
    }
    if (!activeLayer || !activeLayer.visible || activeLayer.locked) {
      setError(activeLayer?.locked
        ? `图层“${activeLayer.name}”已锁定，请先解锁或切换图层。`
        : '没有可用的激活图层，请在右侧图层页选择一个可见且未锁定的图层。');
      return;
    }
    if (effectiveTool === 'marker') {
      const marker = createDefaultMapObject('marker', activeMapId, point, activeLayer.id);
      mutateDraft((current) => ({ ...current, objects: [...current.objects, marker] }), 'immediate');
      setSelectedObjectId(marker.id);
      return;
    }
    if (effectiveTool === 'label') {
      const label = createDefaultMapObject('label', activeMapId, point, activeLayer.id);
      mutateDraft((current) => ({ ...current, objects: [...current.objects, label] }), 'immediate');
      setSelectedObjectId(label.id);
      return;
    }
    if (effectiveTool === 'route') {
      setRouteDraft((current) => [...current, point]);
      setSelectedObjectId('');
      return;
    }
    const regionToolShape = toolToRegionShape(effectiveTool);
    if (regionToolShape && regionToolShape !== 'polygon') {
      const region = createRegionObject(activeMapId, point, regionToolShape, activeLayer.id);
      mutateDraft((current) => ({ ...current, objects: [...current.objects, region] }), 'immediate');
      setSelectedObjectId(region.id);
      return;
    }
    if (effectiveTool === 'regionPolygon') {
      const snapped = snapPoint(point);
      setRegionDraft((current) => [...current, snapped.point]);
      setSnapPreview(snapped.preview);
      setSelectedObjectId('');
    }
  }

  function snapPoint(point: MapPoint, excludeRegionId?: string): { point: MapPoint; preview: SnapPreview | null } {
    if (!snapEnabled || !draft) return { point, preview: null };
    const candidates = regionSnapCandidates(draft.objects, excludeRegionId);
    const threshold = 12 / view.scale;
    let bestVertex: { point: MapPoint; distance: number } | null = null;
    for (const vertex of candidates.vertices) {
      const distance = pointDistance(point, vertex);
      if (distance <= threshold && (!bestVertex || distance < bestVertex.distance)) {
        bestVertex = { point: vertex, distance };
      }
    }
    if (bestVertex) {
      const snapped = { ...bestVertex.point };
      return { point: snapped, preview: { point: snapped, kind: 'vertex' } };
    }
    let bestEdge: { point: MapPoint; distance: number } | null = null;
    for (const edge of candidates.edges) {
      const projected = closestPointOnSegment(point, edge.start, edge.end);
      const distance = pointDistance(point, projected);
      if (distance <= threshold && (!bestEdge || distance < bestEdge.distance)) {
        bestEdge = { point: projected, distance };
      }
    }
    if (bestEdge) {
      const snapped = { ...bestEdge.point };
      return { point: snapped, preview: { point: snapped, kind: 'edge' } };
    }
    return { point, preview: null };
  }

  function finishRoute(): void {
    if (!draft || routeDraft.length < 2 || !activeLayer || activeLayer.locked || !activeLayer.visible) return;
    const route = createRouteObject(activeMapId, routeDraft, activeLayer.id);
    mutateDraft((current) => ({ ...current, objects: [...current.objects, route] }), 'immediate');
    setSelectedObjectId(route.id);
    setRouteDraft([]);
    setSnapPreview(null);
    setTool('select');
  }

  function cancelRoute(): void {
    setRouteDraft([]);
    setSnapPreview(null);
    setTool('select');
  }

  function finishRegion(): void {
    if (!draft || regionDraft.length < 3 || !activeLayer || activeLayer.locked || !activeLayer.visible) return;
    const region = createRegionObject(activeMapId, regionDraft[0], 'polygon', activeLayer.id, regionDraft);
    mutateDraft((current) => ({ ...current, objects: [...current.objects, region] }), 'immediate');
    setSelectedObjectId(region.id);
    setRegionDraft([]);
    setSnapPreview(null);
    setTool('select');
  }

  function cancelRegion(): void {
    setRegionDraft([]);
    setSnapPreview(null);
    setTool('select');
  }

  function applyBackground(asset: AssetRecord): void {
    mutateDraft((current) => ({ ...current, backgroundAssetId: asset.id, backgroundAssetUrl: asset.url }), 'immediate');
    setAssetPickerOpen(false);
  }

  async function uploadBackground(): Promise<void> {
    try {
      setError('');
      const asset = await assetClient.importImage(vault.path);
      if (asset) applyBackground(asset);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function fitViewport(): void {
    if (!draft || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const nextScale = clamp(Math.min(rect.width / draft.canvasWidth, rect.height / draft.canvasHeight) * 0.94, minScale, maxScale);
    setView({
      scale: nextScale,
      x: (rect.width - draft.canvasWidth * nextScale) / 2,
      y: (rect.height - draft.canvasHeight * nextScale) / 2
    });
  }

  function resetView(): void {
    if (!draft || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    setView({
      scale: 1,
      x: draft.canvasWidth < rect.width ? (rect.width - draft.canvasWidth) / 2 : 24,
      y: draft.canvasHeight < rect.height ? (rect.height - draft.canvasHeight) / 2 : 24
    });
  }

  function focusMapObject(object: MapObject): void {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const bounds = mapObjectBounds(object);
    const width = Math.max(bounds.maxX - bounds.minX, 48);
    const height = Math.max(bounds.maxY - bounds.minY, 48);
    const nextScale = clamp(Math.min((rect.width * 0.72) / width, (rect.height * 0.72) / height), minScale, maxScale);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    setView({
      scale: nextScale,
      x: rect.width / 2 - centerX * nextScale,
      y: rect.height / 2 - centerY * nextScale
    });
  }

  function zoomBy(factor: number, anchor?: { clientX: number; clientY: number }): void {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const anchorX = anchor ? anchor.clientX - rect.left : rect.width / 2;
    const anchorY = anchor ? anchor.clientY - rect.top : rect.height / 2;
    setView((current) => {
      const nextScale = clamp(current.scale * factor, minScale, maxScale);
      const mapX = (anchorX - current.x) / current.scale;
      const mapY = (anchorY - current.y) / current.scale;
      return {
        scale: nextScale,
        x: anchorX - mapX * nextScale,
        y: anchorY - mapY * nextScale
      };
    });
  }

  function startViewportPan(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-map-object="true"]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false
    };
  }

  function moveViewportPan(event: PointerEvent<HTMLDivElement>): void {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.moved = true;
    setView((current) => ({ ...current, x: pan.originX + dx, y: pan.originY + dy }));
  }

  function stopViewportPan(event: PointerEvent<HTMLDivElement>): void {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (!pan.moved) handleCanvasClick(event.clientX, event.clientY);
  }

  function startObjectDrag(event: PointerEvent<HTMLElement | SVGElement>, objectId: string, mode: RegionDragMode = 'move', pointIndex?: number): void {
    event.stopPropagation();
    setSelectedObjectId(objectId);
    if (!editing) return;
    const currentDraft = draftRef.current;
    const object = currentDraft?.objects.find((item) => item.id === objectId);
    const objectLayer = object ? currentDraft?.layers.find((layer) => layer.id === object.layerId) : null;
    if (objectLayer?.locked) {
      setError(`图层“${objectLayer.name}”已锁定，请先解锁后再编辑。`);
      return;
    }
    commitPendingHistory();
    dragHistoryRef.current = currentDraft ? cloneMapDraft(currentDraft) : null;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const point = screenToMap(event.clientX, event.clientY) ?? undefined;
    const geometry = object?.type === 'region' && supportsRegionRotation(object.geometry) ? object.geometry : null;
    const center = geometry ? regionRotationCenter(geometry) : undefined;
    objectDragRef.current = {
      id: objectId,
      pointerId: event.pointerId,
      mode,
      pointIndex,
      lastPoint: point,
      center,
      lastAngle: mode === 'rotateRegion' && center && point ? pointAngle(center, point) : undefined,
      rotation: mode === 'rotateRegion' && geometry ? geometry.rotation : undefined
    };
    if (mode === 'resizeRegion' || mode === 'rotateRegion') setSnapPreview(null);
  }

  function moveObjectDrag(event: PointerEvent<HTMLElement | SVGElement>): void {
    const drag = objectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = screenToMap(event.clientX, event.clientY);
    const currentDraft = draftRef.current;
    if (!point || !currentDraft) return;
    const object = currentDraft.objects.find((item) => item.id === drag.id);
    if (!object) return;
    if (object.type === 'route' && drag.mode === 'routePoint' && drag.pointIndex !== undefined) {
      const points = object.points.map((routePoint, index) => index === drag.pointIndex ? point : routePoint);
      updateObject(object.id, { points, x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 } as Partial<MapObject>, 'transient');
      return;
    }
    if (object.type === 'region') {
      if (drag.mode === 'regionPoint' && drag.pointIndex !== undefined && object.geometry.shape === 'polygon') {
        const snapped = snapPoint(point, object.id);
        setSnapPreview(snapped.preview);
        const points = object.geometry.points.map((regionPoint, index) => index === drag.pointIndex ? snapped.point : regionPoint);
        updateObject(object.id, { geometry: { shape: 'polygon', points }, x: points[0]?.x ?? object.x, y: points[0]?.y ?? object.y } as Partial<MapObject>, 'transient');
        return;
      }
      if (drag.mode === 'resizeRegion' && supportsRegionRotation(object.geometry) && drag.center) {
        updateObject(object.id, { geometry: resizeRegionGeometry(object.geometry, point, drag.center) } as Partial<MapObject>, 'transient');
        return;
      }
      if (drag.mode === 'rotateRegion' && supportsRegionRotation(object.geometry) && drag.center && drag.lastAngle !== undefined) {
        const angle = pointAngle(drag.center, point);
        const rotation = normalizeRotation((drag.rotation ?? object.geometry.rotation) + normalizeAngleDelta(angle - drag.lastAngle));
        objectDragRef.current = { ...drag, lastAngle: angle, rotation, lastPoint: point };
        setSnapPreview(null);
        updateObject(object.id, { geometry: { ...object.geometry, rotation } } as Partial<MapObject>, 'transient');
        return;
      }
      if (drag.mode === 'move') {
        const last = drag.lastPoint ?? point;
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        objectDragRef.current = { ...drag, lastPoint: point };
        updateObject(object.id, moveRegionBy(object, dx, dy) as Partial<MapObject>, 'transient');
        return;
      }
    }
    if (object.type === 'marker' || object.type === 'label') {
      updateObject(object.id, point as Partial<MapObject>, 'transient');
    }
  }

  function stopObjectDrag(event: PointerEvent<HTMLElement | SVGElement>): void {
    if (objectDragRef.current?.pointerId === event.pointerId) {
      const baseline = dragHistoryRef.current;
      const current = draftRef.current;
      if (baseline && current && !draftsEqual(baseline, current)) {
        pushUndoSnapshot(baseline);
        replaceRedoStack([]);
      }
      dragHistoryRef.current = null;
      objectDragRef.current = null;
      setSnapPreview(null);
    }
  }

  function wheelZoom(event: React.WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 0.88, { clientX: event.clientX, clientY: event.clientY });
  }

  return (
    <div className="flex h-[calc(100vh-13.5rem)] gap-5 overflow-hidden">
      <CollapsiblePanel title="地图列表" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed(!leftCollapsed)} side="left">
        <div className="space-y-3">
          <button className="btn-primary w-full" onClick={createMap} disabled={creating}>{creating ? '创建中' : '+ 新建地图'}</button>
          {maps.length === 0 ? (
            <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-4 text-sm text-sepia">还没有地图。先创建一张地图。</div>
          ) : (
            maps.map((map) => (
              <div
                key={map.id}
                className={`relative rounded-md border transition hover:border-copper/55 ${map.id === activeMapId ? 'border-copper/70 bg-batter text-copper' : 'border-umber/25 bg-vellum'}`}
              >
                <button className="w-full px-3 py-2 pr-10 text-left text-sm" onClick={() => chooseMap(map.id)}>
                  <span className="block font-semibold">{map.title}</span>
                  {map.description ? <span className="mt-1 line-clamp-2 block text-xs text-sepia">{map.description}</span> : null}
                </button>
                <button
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded text-lg leading-none text-sepia hover:bg-umber/10 hover:text-copper"
                  title="地图操作"
                  aria-label={`${map.title}的地图操作`}
                  onClick={() => setMapMenuId((current) => current === map.id ? '' : map.id)}
                >
                  ···
                </button>
                {mapMenuId === map.id ? (
                  <div className="absolute right-2 top-10 z-20 min-w-[9.5rem] rounded-md border border-umber/30 bg-vellum p-1 shadow-folio">
                    <button className="w-full rounded px-3 py-2 text-left text-sm text-ink hover:bg-batter" onClick={() => openDuplicateDialog(map)}>复制为新版本</button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </CollapsiblePanel>

      <Section
        title={draft?.title || '地图工作台'}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        aside={draft ? <ReadEditToggle editing={editing} onEdit={beginEditing} onSave={save} onCancel={cancel} /> : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {error ? <div className="rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div> : null}
          {successMessage ? <div className="rounded-md border border-olive/35 bg-batter/55 p-3 text-sm text-ink">{successMessage}</div> : null}
          {!draft ? (
            <div className="grid min-h-0 flex-1 place-items-center rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">选择或创建一张地图后开始编辑。</div>
          ) : (
            <>
              <MapToolbar
                editing={editing}
                tool={effectiveTool}
                routePointCount={routeDraft.length}
                regionPointCount={regionDraft.length}
                snapEnabled={snapEnabled}
                zoomPercent={zoomPercent}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undoDraftChange}
                onRedo={redoDraftChange}
                onToolChange={(nextTool) => setTool(nextTool)}
                onSnapToggle={setSnapEnabled}
                onFinishRoute={finishRoute}
                onCancelRoute={cancelRoute}
                onFinishRegion={finishRegion}
                onCancelRegion={cancelRegion}
                onFit={fitViewport}
                onReset={resetView}
                onZoomIn={() => zoomBy(1.18)}
                onZoomOut={() => zoomBy(0.82)}
              />
              <MapViewport
                draft={draft}
                view={view}
                editing={editing}
                selectedObjectId={selectedObjectId}
                routeDraft={routeDraft}
                regionDraft={regionDraft}
                snapPreview={snapPreview}
                viewportRef={viewportRef}
                onWheel={wheelZoom}
                onPointerDown={startViewportPan}
                onPointerMove={moveViewportPan}
                onPointerUp={stopViewportPan}
                onPointerCancel={stopViewportPan}
                onSelectObject={setSelectedObjectId}
                onStartObjectDrag={startObjectDrag}
                onMoveObjectDrag={moveObjectDrag}
                onStopObjectDrag={stopObjectDrag}
                onDoubleClick={() => {
                  if (regionDraft.length > 0) finishRegion();
                  else finishRoute();
                }}
              />
            </>
          )}
        </div>
      </Section>

      <CollapsiblePanel title="地图面板" collapsed={rightCollapsed} onToggle={() => setRightCollapsed(!rightCollapsed)} side="right">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-umber/25 bg-batter/35 p-1">
          <button className={`rounded px-2 py-1.5 text-sm ${rightTab === 'properties' ? 'bg-vellum font-semibold text-copper shadow-sm' : 'text-sepia'}`} onClick={() => setRightTab('properties')}>属性</button>
          <button className={`rounded px-2 py-1.5 text-sm ${rightTab === 'layers' ? 'bg-vellum font-semibold text-copper shadow-sm' : 'text-sepia'}`} onClick={() => setRightTab('layers')}>图层</button>
        </div>
        {rightTab === 'properties' ? <RightProperties
          draft={draft}
          editing={editing}
          selectedObject={selectedObject}
          selectedObjectLayer={selectedObjectLayer}
          routePointCount={routeDraft.length}
          regionPointCount={regionDraft.length}
          locations={locations}
          codexItems={codexItems}
          linkTargets={linkTargets}
          onDraftField={setDraftField}
          onSelectAsset={() => setAssetPickerOpen(true)}
          onUploadAsset={uploadBackground}
          onClearBackground={() => mutateDraft((current) => ({ ...current, backgroundAssetId: null, backgroundAssetUrl: '' }), 'immediate')}
          onDeleteMap={deleteMap}
          onUpdateObject={updateObject}
          onDeleteObject={confirmDeleteObject}
          onFinishRoute={finishRoute}
          onCancelRoute={cancelRoute}
          onFinishRegion={finishRegion}
          onCancelRegion={cancelRegion}
          onOpenLocation={(locationId) => onNavigate({ module: 'locations', view: 'records', locationId })}
          onOpenEntity={onNavigate}
          activeMap={activeMap}
          onOpenSourceMap={(mapId) => chooseMap(mapId)}
        /> : <LayerPanel
          draft={draft}
          editing={editing}
          activeLayerId={activeLayerId}
          onSetActiveLayer={setActiveLayerId}
          onMutateDraft={mutateDraft}
          onClearSelection={() => setSelectedObjectId('')}
          onConfirmDanger={confirmDanger}
          onError={setError}
        />}
      </CollapsiblePanel>

      {assetPickerOpen ? (
        <MapAssetPicker vaultPath={vault.path} onClose={() => setAssetPickerOpen(false)} onSelect={applyBackground} />
      ) : null}
      {duplicateSource ? (
        <DuplicateMapDialog
          sourceMap={duplicateSource}
          title={duplicateTitle}
          creating={duplicating}
          onTitleChange={setDuplicateTitle}
          onCancel={() => {
            if (duplicating) return;
            setDuplicateSource(null);
            setDuplicateTitle('');
          }}
          onCreate={() => void duplicateMap()}
        />
      ) : null}
    </div>
  );
}

function MapToolbar({
  editing,
  tool,
  routePointCount,
  regionPointCount,
  snapEnabled,
  zoomPercent,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onToolChange,
  onSnapToggle,
  onFinishRoute,
  onCancelRoute,
  onFinishRegion,
  onCancelRegion,
  onFit,
  onReset,
  onZoomIn,
  onZoomOut
}: {
  editing: boolean;
  tool: MapTool;
  routePointCount: number;
  regionPointCount: number;
  snapEnabled: boolean;
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (tool: MapTool) => void;
  onSnapToggle: (enabled: boolean) => void;
  onFinishRoute: () => void;
  onCancelRoute: () => void;
  onFinishRegion: () => void;
  onCancelRegion: () => void;
  onFit: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}): JSX.Element {
  const toolButton = (value: MapTool, label: string): JSX.Element => (
    <button className={`btn-ghost min-h-0 px-3 py-1.5 text-sm ${tool === value ? 'border-copper bg-copper text-vellum' : ''}`} onClick={() => onToolChange(value)}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-umber/25 bg-batter/45 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onUndo} disabled={!canUndo} title="撤销 Ctrl+Z">撤销</button>
            <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onRedo} disabled={!canRedo} title="重做 Ctrl+Shift+Z / Ctrl+Y">重做</button>
            <span className="mx-1 h-5 w-px bg-umber/25" />
          </>
        ) : null}
        <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onFit}>适应窗口</button>
        <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onReset}>重置视图</button>
        <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onZoomOut}>缩小</button>
        <span className="min-w-[4.5rem] rounded border border-umber/25 bg-vellum px-2 py-1 text-center text-sm text-copper">{zoomPercent}%</span>
        <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onZoomIn}>放大</button>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {toolButton('select', '选择')}
          {toolButton('marker', '添加 marker')}
          {toolButton('label', '添加文字标签')}
          {toolButton('route', '绘制路线')}
          {toolButton('regionRect', '矩形区域')}
          {toolButton('regionEllipse', '椭圆区域')}
          {toolButton('regionTriangle', '三角形区域')}
          {toolButton('regionHexagon', '六边形区域')}
          {toolButton('regionDiamond', '菱形区域')}
          {toolButton('regionPentagon', '五边形区域')}
          {toolButton('regionPolygon', '多边形区域')}
          <label className="flex items-center gap-1 rounded border border-umber/25 bg-vellum px-2 py-1 text-xs text-copper">
            <input type="checkbox" checked={snapEnabled} onChange={(event) => onSnapToggle(event.target.checked)} />
            吸附
          </label>
          {routePointCount > 0 ? <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" onClick={onFinishRoute} disabled={routePointCount < 2}>完成路线</button> : null}
          {routePointCount > 0 ? <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onCancelRoute}>取消路线</button> : null}
          {regionPointCount > 0 ? <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" onClick={onFinishRegion} disabled={regionPointCount < 3}>完成区域</button> : null}
          {regionPointCount > 0 ? <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={onCancelRegion}>取消区域</button> : null}
        </div>
      ) : null}
      <span className="text-xs text-sepia">{editing ? toolHint(tool, routePointCount, regionPointCount) : '阅读模式：滚轮缩放，拖动画布平移'}</span>
    </div>
  );
}

function MapViewport({
  draft,
  view,
  editing,
  selectedObjectId,
  routeDraft,
  regionDraft,
  snapPreview,
  viewportRef,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onSelectObject,
  onStartObjectDrag,
  onMoveObjectDrag,
  onStopObjectDrag,
  onDoubleClick
}: {
  draft: MapDraft;
  view: ViewState;
  editing: boolean;
  selectedObjectId: string;
  routeDraft: MapPoint[];
  regionDraft: MapPoint[];
  snapPreview: SnapPreview | null;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectObject: (id: string) => void;
  onStartObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>, objectId: string, mode?: RegionDragMode, pointIndex?: number) => void;
  onMoveObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
  onStopObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
  onDoubleClick: () => void;
}): JSX.Element {
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const visibleLayers = [...draft.layers].filter((layer) => layer.visible).sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedRegion = draft.objects.find((object): object is RegionObject => object.id === selectedObjectId && object.type === 'region') ?? null;
  const selectedRegionLayer = selectedRegion ? draft.layers.find((layer) => layer.id === selectedRegion.layerId) : null;

  return (
    <div
      ref={viewportRef}
      className={`relative min-h-[460px] flex-1 overflow-hidden rounded-md border border-umber/35 bg-[#dfc58f] ${editing ? 'cursor-crosshair' : 'cursor-grab'}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(); }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,247,225,0.34),rgba(132,89,43,0.10))]" />
      {!draft.backgroundAssetUrl ? <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(68,45,28,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(68,45,28,0.055)_1px,transparent_1px)] bg-[size:40px_40px]" /> : null}
      <div className="absolute left-0 top-0 overflow-hidden bg-vellum shadow-folio" style={{ width: draft.canvasWidth, height: draft.canvasHeight, transform, transformOrigin: '0 0' }}>
        {draft.backgroundAssetUrl ? <img className="absolute inset-0 h-full w-full select-none object-contain" src={draft.backgroundAssetUrl} alt="" draggable={false} /> : <div className="absolute inset-0 grid place-items-center text-lg text-sepia">无底图。可在右侧属性栏选择素材或上传底图。</div>}
        {visibleLayers.map((layer, layerIndex) => {
          const objects = draft.objects.filter((object) => object.layerId === layer.id);
          const regions = objects.filter((object): object is RegionObject => object.type === 'region');
          const routes = objects.filter((object): object is RouteObject => object.type === 'route');
          const labels = objects.filter((object): object is LabelObject => object.type === 'label');
          const markers = objects.filter((object): object is MarkerObject => object.type === 'marker');
          return (
            <div key={layer.id} className="pointer-events-none absolute inset-0" style={{ zIndex: 10 + layerIndex }}>
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${draft.canvasWidth} ${draft.canvasHeight}`}>
                {regions.map((region) => (
                  <RegionShape
                    key={region.id}
                    region={region}
                    layerOpacity={layer.opacity}
                    onSelectObject={onSelectObject}
                    onStartObjectDrag={onStartObjectDrag}
                    onMoveObjectDrag={onMoveObjectDrag}
                    onStopObjectDrag={onStopObjectDrag}
                  />
                ))}
                {routes.map((route) => (
                  <RouteShape
                    key={route.id}
                    route={route}
                    layerOpacity={layer.opacity}
                    selected={route.id === selectedObjectId}
                    editing={editing && !layer.locked}
                    onSelectObject={onSelectObject}
                    onStartObjectDrag={onStartObjectDrag}
                    onMoveObjectDrag={onMoveObjectDrag}
                    onStopObjectDrag={onStopObjectDrag}
                  />
                ))}
              </svg>
              {labels.map((label) => (
                <button
                  key={label.id}
                  data-map-object="true"
                  className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded px-2 py-1 text-left shadow-sm ${label.id === selectedObjectId ? 'ring-2 ring-copper' : ''}`}
                  style={{
                    left: label.x,
                    top: label.y,
                    color: label.style.color,
                    fontSize: label.style.fontSize,
                    opacity: effectiveObjectOpacity(label.style.opacity, layer.opacity),
                    background: label.style.backgroundEnabled ? label.style.backgroundColor : 'transparent',
                    border: label.style.backgroundEnabled ? '1px solid rgba(68,45,28,0.22)' : '1px solid transparent'
                  }}
                  onPointerDown={(event) => onStartObjectDrag(event, label.id)}
                  onPointerMove={onMoveObjectDrag}
                  onPointerUp={onStopObjectDrag}
                  onPointerCancel={onStopObjectDrag}
                  onClick={(event) => { event.stopPropagation(); onSelectObject(label.id); }}
                >
                  {label.text || label.name || '文字标签'}
                </button>
              ))}
              {markers.map((marker) => (
                <button
                  key={marker.id}
                  data-map-object="true"
                  className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-full rounded-full border px-3 py-1 text-xs shadow-sm transition ${marker.id === selectedObjectId ? 'border-copper bg-copper text-vellum' : 'border-copper/70 bg-vellum text-ink hover:border-copper'}`}
                  style={{ left: marker.x, top: marker.y, opacity: effectiveObjectOpacity(1, layer.opacity) }}
                  onPointerDown={(event) => onStartObjectDrag(event, marker.id)}
                  onPointerMove={onMoveObjectDrag}
                  onPointerUp={onStopObjectDrag}
                  onPointerCancel={onStopObjectDrag}
                  onClick={(event) => { event.stopPropagation(); onSelectObject(marker.id); }}
                >
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current" />
                  {marker.name || marker.locationName || '点位'}
                </button>
              ))}
            </div>
          );
        })}
        <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" viewBox={`0 0 ${draft.canvasWidth} ${draft.canvasHeight}`}>
          {routeDraft.length > 0 ? <polyline points={pointsAttr(routeDraft)} fill="none" stroke="#743014" strokeDasharray="8 8" strokeWidth={3} opacity={0.75} pointerEvents="none" /> : null}
          {routeDraft.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={5} fill="#743014" opacity={0.85} pointerEvents="none" />)}
          {regionDraft.length > 0 ? <polygon points={pointsAttr(regionDraft)} fill="#8f6f3f" fillOpacity={0.18} stroke="#6f3f24" strokeDasharray="8 8" strokeWidth={2} pointerEvents="none" /> : null}
          {regionDraft.map((point, index) => <circle key={`region-draft-${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={5} fill="#6f3f24" opacity={0.85} pointerEvents="none" />)}
          {snapPreview ? (
            <g pointerEvents="none">
              <circle cx={snapPreview.point.x} cy={snapPreview.point.y} r={8} fill="none" stroke="#b45f2a" strokeWidth={2} strokeDasharray={snapPreview.kind === 'edge' ? '4 3' : undefined} />
              <circle cx={snapPreview.point.x} cy={snapPreview.point.y} r={3} fill="#b45f2a" />
              <text x={snapPreview.point.x + 12} y={snapPreview.point.y - 10} fill="#743014" fontSize={13} fontWeight={650}>{snapPreview.kind === 'vertex' ? '吸附到顶点' : '吸附到边界'}</text>
            </g>
          ) : null}
        </svg>
        {selectedRegion && editing && !selectedRegionLayer?.locked ? (
          <svg className="pointer-events-none absolute inset-0 z-40 h-full w-full overflow-visible" viewBox={`0 0 ${draft.canvasWidth} ${draft.canvasHeight}`}>
            <RegionControls
              region={selectedRegion}
              viewScale={view.scale}
              onStartObjectDrag={onStartObjectDrag}
              onMoveObjectDrag={onMoveObjectDrag}
              onStopObjectDrag={onStopObjectDrag}
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

function RouteShape({ route, layerOpacity, selected, editing, onSelectObject, onStartObjectDrag, onMoveObjectDrag, onStopObjectDrag }: {
  route: RouteObject;
  layerOpacity: number;
  selected: boolean;
  editing: boolean;
  onSelectObject: (id: string) => void;
  onStartObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>, objectId: string, mode?: RegionDragMode, pointIndex?: number) => void;
  onMoveObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
  onStopObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
}): JSX.Element {
  const strokeDasharray = routeDashArray(route.style);
  const points = pointsAttr(route.points);
  const arrows = routeArrows(route);
  const opacity = effectiveObjectOpacity(route.style.opacity, layerOpacity);
  return (
    <g data-map-object="true">
      <polyline points={points} fill="none" stroke="transparent" strokeWidth={Math.max(14, route.style.strokeWidth + 10)} pointerEvents="stroke" onClick={(event) => { event.stopPropagation(); onSelectObject(route.id); }} />
      <polyline points={points} fill="none" stroke={route.style.stroke} strokeWidth={route.style.strokeWidth} strokeDasharray={strokeDasharray} opacity={opacity} pointerEvents="none" />
      {selected ? <polyline points={points} fill="none" stroke="#743014" strokeWidth={route.style.strokeWidth + 4} opacity={0.18} pointerEvents="none" /> : null}
      {arrows.map((arrow, index) => (
        <polygon key={`${route.id}-arrow-${index}`} points={arrow} fill={route.style.stroke} opacity={opacity} pointerEvents="none" />
      ))}
      {selected && editing ? route.points.map((point, index) => (
        <circle
          key={`${route.id}-${index}`}
          data-map-object="true"
          cx={point.x}
          cy={point.y}
          r={7}
          fill="#fff4d4"
          stroke="#743014"
          strokeWidth={2}
          onPointerDown={(event) => onStartObjectDrag(event, route.id, 'routePoint', index)}
          onPointerMove={onMoveObjectDrag}
          onPointerUp={onStopObjectDrag}
          onPointerCancel={onStopObjectDrag}
          onClick={(event) => { event.stopPropagation(); onSelectObject(route.id); }}
        />
      )) : null}
    </g>
  );
}

function RegionShape({ region, layerOpacity, onSelectObject, onStartObjectDrag, onMoveObjectDrag, onStopObjectDrag }: {
  region: RegionObject;
  layerOpacity: number;
  onSelectObject: (id: string) => void;
  onStartObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>, objectId: string, mode?: RegionDragMode, pointIndex?: number) => void;
  onMoveObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
  onStopObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
}): JSX.Element {
  const common = {
    fill: region.style.fill,
    fillOpacity: effectiveObjectOpacity(region.style.fillOpacity, layerOpacity),
    stroke: region.style.stroke,
    strokeWidth: region.style.strokeWidth,
    opacity: effectiveObjectOpacity(1, layerOpacity),
    strokeDasharray: region.style.dashEnabled ? '8 6' : undefined
  };
  const select = (event: MouseEvent<SVGElement>): void => {
    event.stopPropagation();
    onSelectObject(region.id);
  };
  const dragProps = {
    'data-map-object': 'true',
    pointerEvents: 'all' as const,
    onPointerDown: (event: PointerEvent<SVGElement>) => onStartObjectDrag(event, region.id, 'move'),
    onPointerMove: onMoveObjectDrag,
    onPointerUp: onStopObjectDrag,
    onPointerCancel: onStopObjectDrag,
    onClick: select
  };

  return (
    <g data-map-object="true">
      {region.geometry.shape === 'rect' ? <rect x={region.geometry.x} y={region.geometry.y} width={region.geometry.width} height={region.geometry.height} transform={regionRotationTransform(region.geometry)} {...common} {...dragProps} /> : null}
      {region.geometry.shape === 'ellipse' ? <ellipse cx={region.geometry.x} cy={region.geometry.y} rx={region.geometry.radiusX} ry={region.geometry.radiusY} transform={regionRotationTransform(region.geometry)} {...common} {...dragProps} /> : null}
      {isStandardRegionGeometry(region.geometry) ? <polygon points={pointsAttr(regionBoundaryPoints(region.geometry))} {...common} {...dragProps} /> : null}
      {region.geometry.shape === 'polygon' ? <polygon points={pointsAttr(region.geometry.points)} {...common} {...dragProps} /> : null}
      {region.style.labelVisible ? <text x={regionLabelPoint(region).x} y={regionLabelPoint(region).y} textAnchor="middle" fill="#442D1C" fontSize={18} fontWeight={650} opacity={effectiveObjectOpacity(1, layerOpacity)} pointerEvents="none">{region.name || '区域'}</text> : null}
    </g>
  );
}

function RegionControls({ region, viewScale, onStartObjectDrag, onMoveObjectDrag, onStopObjectDrag }: {
  region: RegionObject;
  viewScale: number;
  onStartObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>, objectId: string, mode?: RegionDragMode, pointIndex?: number) => void;
  onMoveObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
  onStopObjectDrag: (event: PointerEvent<HTMLElement | SVGElement>) => void;
}): JSX.Element | null {
  const controlRadius = 7 / viewScale;
  const controlStroke = 2 / viewScale;
  if (supportsRegionRotation(region.geometry)) {
    const handles = regionControlHandles(region.geometry, 24 / viewScale);
    return (
      <g>
        <line x1={handles.resize.x} y1={handles.resize.y} x2={handles.rotate.x} y2={handles.rotate.y} stroke="#743014" strokeWidth={1.5 / viewScale} opacity={0.55} pointerEvents="none" />
        <circle
          data-map-object="true"
          pointerEvents="all"
          cx={handles.resize.x}
          cy={handles.resize.y}
          r={controlRadius}
          fill="#fff4d4"
          stroke="#743014"
          strokeWidth={controlStroke}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={(event) => onStartObjectDrag(event, region.id, 'resizeRegion')}
          onPointerMove={onMoveObjectDrag}
          onPointerUp={onStopObjectDrag}
          onPointerCancel={onStopObjectDrag}
        />
        <circle
          data-map-object="true"
          pointerEvents="all"
          cx={handles.rotate.x}
          cy={handles.rotate.y}
          r={controlRadius}
          fill="#743014"
          stroke="#fff4d4"
          strokeWidth={controlStroke}
          style={{ cursor: 'grab' }}
          onPointerDown={(event) => onStartObjectDrag(event, region.id, 'rotateRegion')}
          onPointerMove={onMoveObjectDrag}
          onPointerUp={onStopObjectDrag}
          onPointerCancel={onStopObjectDrag}
        />
      </g>
    );
  }
  if (region.geometry.shape !== 'polygon') return null;
  return (
    <>
      {region.geometry.points.map((point, index) => (
        <circle key={`${region.id}-${index}`} data-map-object="true" pointerEvents="all" cx={point.x} cy={point.y} r={controlRadius} fill="#fff4d4" stroke="#743014" strokeWidth={controlStroke} onPointerDown={(event) => onStartObjectDrag(event, region.id, 'regionPoint', index)} onPointerMove={onMoveObjectDrag} onPointerUp={onStopObjectDrag} onPointerCancel={onStopObjectDrag} />
      ))}
    </>
  );
}

function RightProperties({
  draft,
  editing,
  selectedObject,
  selectedObjectLayer,
  routePointCount,
  regionPointCount,
  locations,
  codexItems,
  linkTargets,
  onDraftField,
  onSelectAsset,
  onUploadAsset,
  onClearBackground,
  onDeleteMap,
  onUpdateObject,
  onDeleteObject,
  onFinishRoute,
  onCancelRoute,
  onFinishRegion,
  onCancelRegion,
  onOpenLocation,
  onOpenEntity,
  activeMap,
  onOpenSourceMap
}: {
  draft: MapDraft | null;
  editing: boolean;
  selectedObject: MapObject | null;
  selectedObjectLayer: MapLayer | null;
  routePointCount: number;
  regionPointCount: number;
  locations: LocationOption[];
  codexItems: CodexOption[];
  linkTargets: LinkTargetOption[];
  onDraftField: <K extends keyof MapDraft>(key: K, value: MapDraft[K]) => void;
  onSelectAsset: () => void;
  onUploadAsset: () => void;
  onClearBackground: () => void;
  onDeleteMap: () => void;
  onUpdateObject: (objectId: string, patch: Partial<MapObject>) => void;
  onDeleteObject: (object: MapObject) => void;
  onFinishRoute: () => void;
  onCancelRoute: () => void;
  onFinishRegion: () => void;
  onCancelRegion: () => void;
  onOpenLocation: (locationId: string) => void;
  onOpenEntity: (target: NavigationTarget) => void;
  activeMap: MapRecord | null;
  onOpenSourceMap: (mapId: string) => void;
}): JSX.Element {
  if (!draft) {
    return <div className="mini-panel"><h3>地图工作台</h3><p>请选择或创建一张地图。</p></div>;
  }
  if (routePointCount > 0) {
    return (
      <div className="space-y-5">
        <div className="mini-panel">
          <h3>正在绘制路线</h3>
          <p>点击添加路线节点，双击地图或点击“完成路线”结束。按 Esc 或点击取消可丢弃当前临时路线。</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={onFinishRoute} disabled={routePointCount < 2}>完成路线</button>
            <button className="btn-ghost" onClick={onCancelRoute}>取消</button>
          </div>
        </div>
      </div>
    );
  }
  if (regionPointCount > 0) {
    return (
      <div className="space-y-5">
        <div className="mini-panel">
          <h3>正在绘制多边形区域</h3>
          <p>点击添加顶点，至少 3 个点后双击地图或点击“完成区域”闭合。按 Esc 或点击取消可丢弃当前临时区域。</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={onFinishRegion} disabled={regionPointCount < 3}>完成区域</button>
            <button className="btn-ghost" onClick={onCancelRegion}>取消</button>
          </div>
        </div>
      </div>
    );
  }
  if (selectedObject) {
    return (
      <div className="space-y-5">
        {selectedObjectLayer?.locked ? <div className="rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">所属图层已锁定。对象可查看，但需先在“图层”页解锁后才能修改。</div> : null}
        <ObjectProperties
          object={selectedObject}
          editing={editing && !selectedObjectLayer?.locked}
          layers={draft.layers}
          locations={locations}
          codexItems={codexItems}
          linkTargets={linkTargets}
          onUpdateObject={onUpdateObject}
          onDeleteObject={onDeleteObject}
          onOpenLocation={onOpenLocation}
          onOpenEntity={onOpenEntity}
        />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="mini-panel">
        <h3>地图属性</h3>
        {activeMap?.sourceMapId ? (
          <div className="mt-3 rounded-md border border-umber/20 bg-batter/40 px-3 py-2 text-sm text-sepia">
            {activeMap.sourceMapDeleted ? (
              <p>基于地图：源地图已移入回收站</p>
            ) : activeMap.sourceMapTitle ? (
              <p>
                基于地图：
                <button className="ml-1 font-medium text-copper underline decoration-copper/35 underline-offset-2" onClick={() => onOpenSourceMap(activeMap.sourceMapId!)}>
                  {activeMap.sourceMapTitle}
                </button>
              </p>
            ) : <p>基于地图：源地图不可用</p>}
          </div>
        ) : null}
        {editing ? (
          <div className="mt-3 space-y-3">
            <EditableField label="地图标题" value={draft.title} editing onChange={(value) => onDraftField('title', value)} />
            <EditableField label="地图描述" value={draft.description} editing onChange={(value) => onDraftField('description', value)} multiline />
            <button className="btn-ghost w-full" onClick={onSelectAsset}>选择素材</button>
            <button className="btn-ghost w-full" onClick={onUploadAsset}>上传底图</button>
            {draft.backgroundAssetId ? <button className="btn-ghost w-full" onClick={onClearBackground}>移除底图</button> : null}
            <button className="btn-ghost w-full" onClick={onDeleteMap}>删除地图</button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-sepia">
            <p className="font-semibold text-ink">{draft.title || '未命名地图'}</p>
            {draft.description ? <p className="whitespace-pre-line">{draft.description}</p> : <p>暂无描述。</p>}
            <p>{draft.backgroundAssetId ? '已绑定底图' : '无底图'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectProperties({ object, editing, layers, locations, codexItems, linkTargets, onUpdateObject, onDeleteObject, onOpenLocation, onOpenEntity }: {
  object: MapObject;
  editing: boolean;
  layers: MapLayer[];
  locations: LocationOption[];
  codexItems: CodexOption[];
  linkTargets: LinkTargetOption[];
  onUpdateObject: (objectId: string, patch: Partial<MapObject>) => void;
  onDeleteObject: (object: MapObject) => void;
  onOpenLocation: (locationId: string) => void;
  onOpenEntity: (target: NavigationTarget) => void;
}): JSX.Element {
  const visibleLinkedEntities = object.linkedEntities.filter((link) => !link.deleted);
  const primaryLocation = visibleLinkedEntities.find((link) => link.entityType === 'location') ?? null;
  const layerField = editing ? (
    <label className="block">
      <span className="mb-2 block text-sm text-copper">所属图层</span>
      <select
        className="field w-full"
        value={object.layerId ?? ''}
        onChange={(event) => onUpdateObject(object.id, { layerId: event.target.value } as Partial<MapObject>)}
      >
        {layers.map((layer) => <option key={layer.id} value={layer.id} disabled={layer.locked || !layer.visible}>{layer.name}{layer.locked ? '（已锁定）' : !layer.visible ? '（已隐藏）' : ''}</option>)}
      </select>
    </label>
  ) : (
    <p>所属图层：{layers.find((layer) => layer.id === object.layerId)?.name || '默认图层'}</p>
  );
  if (object.type === 'marker') {
    return (
      <div className="mini-panel">
        <h3>{editing ? 'marker 属性' : 'marker 信息'}</h3>
        {editing ? (
          <div className="mt-3 space-y-3">
            {layerField}
            <EditableField label="点位名称" value={object.name} editing onChange={(value) => onUpdateObject(object.id, { name: value })} />
            <EditableField label="点位描述" value={object.description} editing onChange={(value) => onUpdateObject(object.id, { description: value })} multiline />
            <label className="block">
              <span className="mb-2 block text-sm text-copper">绑定地点</span>
              <select
                className="field w-full"
                value={object.locationId ?? ''}
                onChange={(event) => {
                  const locationId = event.target.value || null;
                  const location = locationId ? locations.find((item) => item.id === locationId) : null;
                  onUpdateObject(object.id, {
                    locationId,
                    locationName: location?.name ?? '',
                    linkedEntities: updatePrimaryLocationLink(object.linkedEntities, location ? {
                      entityType: 'location',
                      entityId: location.id,
                      title: location.name,
                      linkType: 'happens_at',
                      note: ''
                    } : null)
                  } as Partial<MapObject>);
                }}
              >
                <option value="">不绑定地点</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.type ? ` | ${location.type}` : ''}</option>)}
              </select>
            </label>
            {object.locationId ? <button className="btn-ghost w-full" onClick={() => onUpdateObject(object.id, { locationId: null, locationName: '', linkedEntities: updatePrimaryLocationLink(object.linkedEntities, null) } as Partial<MapObject>)}>解除绑定</button> : null}
            <ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} />
            <button className="btn-ghost w-full" onClick={() => onDeleteObject(object)}>删除 marker</button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-sepia"><p className="font-semibold text-ink">{object.name || '未命名点位'}</p>{layerField}{object.description ? <p className="whitespace-pre-line">{object.description}</p> : <p>暂无描述。</p>}{primaryLocation ? <p>绑定地点：{primaryLocation.title}</p> : <p>未绑定地点</p>}{primaryLocation ? <button className="btn-ghost mt-2 w-full" onClick={() => onOpenLocation(primaryLocation.entityId)}>打开地点资料</button> : null}<ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} /></div>
        )}
      </div>
    );
  }
  if (object.type === 'label') {
    return (
      <div className="mini-panel">
        <h3>{editing ? '文字标签属性' : '文字标签信息'}</h3>
        {editing ? (
          <div className="mt-3 space-y-3">
            {layerField}
            <EditableField label="标签文字" value={object.text} editing onChange={(value) => onUpdateObject(object.id, { text: value, name: value } as Partial<MapObject>)} />
            <EditableField label="描述" value={object.description} editing onChange={(value) => onUpdateObject(object.id, { description: value })} multiline />
            <NumberField label="字号" value={object.style.fontSize} min={10} max={72} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, fontSize: value } } as Partial<MapObject>)} />
            <ColorField label="文字颜色" value={object.style.color} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, color: value } } as Partial<MapObject>)} />
            <label className="flex items-center gap-2 text-sm text-copper"><input type="checkbox" checked={object.style.backgroundEnabled} onChange={(event) => onUpdateObject(object.id, { style: { ...object.style, backgroundEnabled: event.target.checked } } as Partial<MapObject>)} />显示背景</label>
            <ColorField label="背景颜色" value={object.style.backgroundColor} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, backgroundColor: value } } as Partial<MapObject>)} />
            <NumberField label="透明度" value={object.style.opacity} min={0.2} max={1} step={0.05} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, opacity: value } } as Partial<MapObject>)} />
            <ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} />
            <button className="btn-ghost w-full" onClick={() => onDeleteObject(object)}>删除标签</button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-sepia"><p className="font-semibold text-ink">{object.text || object.name || '文字标签'}</p>{layerField}{object.description ? <p className="whitespace-pre-line">{object.description}</p> : <p>暂无描述。</p>}<ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} /></div>
        )}
      </div>
    );
  }
  if (object.type === 'region') {
    return (
      <div className="mini-panel">
        <h3>{editing ? '区域属性' : '区域信息'}</h3>
        {editing ? (
          <div className="mt-3 space-y-3">
            {layerField}
            <EditableField label="区域名称" value={object.name} editing onChange={(value) => onUpdateObject(object.id, { name: value })} />
            <EditableField label="区域描述" value={object.description} editing onChange={(value) => onUpdateObject(object.id, { description: value })} multiline />
            <ColorField label="填充颜色" value={object.style.fill} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, fill: value } } as Partial<MapObject>)} />
            <NumberField label="填充透明度" value={object.style.fillOpacity} min={0} max={0.8} step={0.05} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, fillOpacity: value } } as Partial<MapObject>)} />
            <ColorField label="边框颜色" value={object.style.stroke} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, stroke: value } } as Partial<MapObject>)} />
            <NumberField label="边框宽度" value={object.style.strokeWidth} min={1} max={12} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, strokeWidth: value } } as Partial<MapObject>)} />
            <label className="flex items-center gap-2 text-sm text-copper"><input type="checkbox" checked={object.style.dashEnabled} onChange={(event) => onUpdateObject(object.id, { style: { ...object.style, dashEnabled: event.target.checked } } as Partial<MapObject>)} />虚线边框</label>
            <label className="flex items-center gap-2 text-sm text-copper"><input type="checkbox" checked={object.style.labelVisible} onChange={(event) => onUpdateObject(object.id, { style: { ...object.style, labelVisible: event.target.checked } } as Partial<MapObject>)} />显示区域名称</label>
            <RegionGeometryFields region={object} onUpdateObject={onUpdateObject} />
            <ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} />
            <button className="btn-ghost w-full" onClick={() => onDeleteObject(object)}>删除区域</button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-sepia">
            <p className="font-semibold text-ink">{object.name || '未命名区域'}</p>
            {layerField}
            {object.description ? <p className="whitespace-pre-line">{object.description}</p> : <p>暂无描述。</p>}
            <p>区域类型：{regionShapeLabel(object.geometry)}</p>
            <p>填充透明度 {object.style.fillOpacity}，边框宽度 {object.style.strokeWidth}{object.style.dashEnabled ? '，虚线边框' : ''}</p>
            <ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mini-panel">
      <h3>{editing ? '路线属性' : '路线信息'}</h3>
      {editing ? (
        <div className="mt-3 space-y-3">
          {layerField}
          <EditableField label="路线名称" value={object.name} editing onChange={(value) => onUpdateObject(object.id, { name: value })} />
          <EditableField label="路线描述" value={object.description} editing onChange={(value) => onUpdateObject(object.id, { description: value })} multiline />
          <ColorField label="路线颜色" value={object.style.stroke} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, stroke: value } } as Partial<MapObject>)} />
          <NumberField label="线宽" value={object.style.strokeWidth} min={1} max={16} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, strokeWidth: value } } as Partial<MapObject>)} />
          <NumberField label="透明度" value={object.style.opacity} min={0.2} max={1} step={0.05} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, opacity: value } } as Partial<MapObject>)} />
          <label className="block">
            <span className="mb-2 block text-sm text-copper">线条类型</span>
            <select className="field w-full" value={object.style.lineStyle} onChange={(event) => onUpdateObject(object.id, { style: { ...object.style, lineStyle: event.target.value as RouteStyle['lineStyle'], dashEnabled: event.target.value !== 'solid' } } as Partial<MapObject>)}>
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-copper">箭头方向</span>
            <select className="field w-full" value={object.style.arrowDirection} onChange={(event) => onUpdateObject(object.id, { style: { ...object.style, arrowDirection: event.target.value as RouteStyle['arrowDirection'], arrowEnabled: event.target.value !== 'none' } } as Partial<MapObject>)}>
              <option value="none">无箭头</option>
              <option value="forward">指向终点</option>
              <option value="backward">指向起点</option>
              <option value="both">双向箭头</option>
            </select>
          </label>
          <NumberField label="箭头大小" value={object.style.arrowSize} min={6} max={40} onChange={(value) => onUpdateObject(object.id, { style: { ...object.style, arrowSize: value } } as Partial<MapObject>)} />
          <ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} />
          <button className="btn-ghost w-full" onClick={() => onDeleteObject(object)}>删除路线</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-sm text-sepia"><p className="font-semibold text-ink">{object.name || '未命名路线'}</p>{layerField}{object.description ? <p className="whitespace-pre-line">{object.description}</p> : <p>暂无描述。</p>}<p>{object.points.length} 个节点，{lineStyleLabel(object.style.lineStyle)}，线宽 {object.style.strokeWidth}</p><p>{arrowDirectionLabel(object.style.arrowDirection)}</p><ObjectEntityLinksSection object={object} editing={editing} linkTargets={linkTargets} onUpdateObject={onUpdateObject} onOpenEntity={onOpenEntity} /></div>
      )}
    </div>
  );
}

function ObjectEntityLinksSection({
  object,
  editing,
  linkTargets,
  onUpdateObject,
  onOpenEntity
}: {
  object: MapObject;
  editing: boolean;
  linkTargets: LinkTargetOption[];
  onUpdateObject: (objectId: string, patch: Partial<MapObject>) => void;
  onOpenEntity: (target: NavigationTarget) => void;
}): JSX.Element {
  const [targetType, setTargetType] = useState<'location' | 'event' | 'character_version' | 'codex_item'>('location');
  const [search, setSearch] = useState('');
  const [targetKey, setTargetKey] = useState('');
  const [newLinkType, setNewLinkType] = useState('related');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const visibleLinks = object.linkedEntities.filter((link) => !link.deleted && !(object.type === 'marker' && link.entityType === 'location' && link.linkType === 'happens_at'));
  const availableTypes = ['location', 'event', 'character_version', 'codex_item'].filter((type) => linkTargets.some((target) => target.entityType === type)) as Array<'location' | 'event' | 'character_version' | 'codex_item'>;
  const filteredTargets = linkTargets.filter((target) => {
    if (target.entityType !== targetType) return false;
    if (visibleLinks.some((link) => link.entityType === target.entityType && link.entityId === target.id)) return false;
    if (!search.trim()) return true;
    return target.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });

  function updatePanelPosition(): void {
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 392;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const safeMargin = 16;
    const fallbackHeight = Math.min(viewportHeight - safeMargin * 2, Math.max(320, Math.round(viewportHeight * 0.68)));
    const measuredHeight = panelRef.current?.getBoundingClientRect().height ?? fallbackHeight;
    const panelHeight = Math.min(measuredHeight, viewportHeight - safeMargin * 2);
    const desiredTop = rect.top - 12;
    const top = Math.max(safeMargin, Math.min(desiredTop, viewportHeight - safeMargin - panelHeight));
    const left = Math.max(safeMargin, Math.min(rect.left - panelWidth - 12, viewportWidth - safeMargin - panelWidth));
    setPanelRect({
      top,
      left,
      maxHeight: viewportHeight - safeMargin * 2
    });
  }

  useEffect(() => {
    if (!panelOpen) return;
    updatePanelPosition();
    const handleResize = (): void => updatePanelPosition();
    const handlePointerDown = (event: globalThis.PointerEvent): void => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setPanelOpen(false);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [panelOpen]);

  useLayoutEffect(() => {
    if (!panelOpen) return;
    updatePanelPosition();
  }, [panelOpen, visibleLinks.length, filteredTargets.length, targetType, search, newLinkType]);

  useEffect(() => {
    if (!editing) {
      setPanelOpen(false);
    }
  }, [editing]);

  const addLink = (): void => {
    const target = linkTargets.find((item) => `${item.entityType}:${item.id}` === targetKey);
    if (!target) return;
    onUpdateObject(object.id, {
      linkedEntities: normalizeObjectLinks([
        ...object.linkedEntities,
        {
          entityType: target.entityType,
          entityId: target.id,
          title: target.title,
          linkType: newLinkType,
          note: ''
        }
      ])
    } as Partial<MapObject>);
    setTargetKey('');
    setSearch('');
  };

  const panel = panelOpen && panelRect
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[28] bg-transparent" />
          <div
            ref={panelRef}
            className="fixed z-[29] flex w-[392px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-md border border-umber/35 bg-vellum shadow-folio"
            style={{ top: panelRect.top, left: panelRect.left, maxHeight: panelRect.maxHeight }}
          >
            <div className="shrink-0 border-b border-sepia/20 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-serif text-lg font-semibold text-ink">管理关联资料</h4>
                <button className="btn-ghost min-h-0 px-2 py-1 text-xs" onClick={() => setPanelOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-6">
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">已关联资料</p>
                {visibleLinks.length === 0 ? <p className="text-sm text-sepia">暂无关联资料。</p> : visibleLinks.map((link) => (
                  <div key={`${link.entityType}:${link.entityId}`} className="flex items-center gap-2 rounded-md border border-umber/20 bg-batter/35 px-3 py-2">
                    <span className="shrink-0 rounded border border-umber/25 bg-vellum px-1.5 py-0.5 text-[11px] text-copper">{entityTypeLabel(link.entityType)}</span>
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:text-copper"
                      title={link.title || '资料已删除'}
                      onClick={() => {
                        const targetMeta = linkTargets.find((item) => item.entityType === link.entityType && item.id === link.entityId);
                        onOpenEntity(navigationTargetForEntity(link.entityType, link.entityId, targetMeta?.characterId ?? null));
                      }}
                    >
                      {link.title || '资料已删除'}
                    </button>
                    <button className="btn-ghost min-h-0 shrink-0 px-2 py-1 text-xs" onClick={() => onUpdateObject(object.id, { linkedEntities: object.linkedEntities.filter((item) => !(item.entityType === link.entityType && item.entityId === link.entityId)) } as Partial<MapObject>)}>移除</button>
                  </div>
                ))}
              </section>
              <section className="space-y-3 border-t border-sepia/20 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">添加关联</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableTypes.map((type) => (
                    <button key={type} className={`rounded border px-2 py-1 text-xs ${targetType === type ? 'border-copper/60 bg-batter/70 text-copper' : 'border-umber/25 bg-vellum text-sepia'}`} onClick={() => { setTargetType(type); setTargetKey(''); }}>
                      {entityTypeLabel(type)}
                    </button>
                  ))}
                </div>
                <input className="field w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资料名称" />
                <div className="space-y-2">
                  {filteredTargets.length === 0 ? <p className="text-sm text-sepia">没有可添加的资料。</p> : filteredTargets.slice(0, 16).map((target) => {
                    const selected = targetKey === `${target.entityType}:${target.id}`;
                    return (
                      <button
                        key={`${target.entityType}:${target.id}`}
                        className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left ${selected ? 'border-copper/60 bg-batter/60' : 'border-umber/20 bg-vellum/70 hover:border-copper/35'}`}
                        onClick={() => setTargetKey(`${target.entityType}:${target.id}`)}
                      >
                        <span className="shrink-0 rounded border border-umber/25 bg-batter/45 px-1.5 py-0.5 text-[11px] text-copper">{entityTypeLabel(target.entityType)}</span>
                        <span className="min-w-0 truncate text-sm text-ink" title={target.title}>{target.title}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm text-copper">关联类型</span>
                  <select className="field w-full" value={newLinkType} onChange={(event) => setNewLinkType(event.target.value)}>
                    <option value="related">related</option>
                    <option value="mentions">mentions</option>
                    <option value="happens_at">happens_at</option>
                    <option value="involves">involves</option>
                  </select>
                </label>
                <button className="btn-primary w-full" disabled={!targetKey} onClick={addLink}>添加关联</button>
              </section>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <div className="rounded-md border border-umber/25 bg-vellum/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">关联资料</p>
          <span className="text-xs text-sepia">{visibleLinks.length} 条</span>
        </div>
        <div className="mt-3 space-y-2">
          {visibleLinks.length === 0 ? (
            <p className="text-sm text-sepia">暂无关联资料。</p>
          ) : (
            visibleLinks.map((link) => (
              <div key={`${link.entityType}:${link.entityId}`} className="flex items-center gap-2 rounded-md border border-umber/20 bg-batter/35 px-3 py-2">
                <span className="shrink-0 rounded border border-umber/25 bg-vellum px-1.5 py-0.5 text-[11px] text-copper">{entityTypeLabel(link.entityType)}</span>
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:text-copper"
                  title={link.title || '资料已删除'}
                  onClick={() => {
                    const targetMeta = linkTargets.find((item) => item.entityType === link.entityType && item.id === link.entityId);
                    onOpenEntity(navigationTargetForEntity(link.entityType, link.entityId, targetMeta?.characterId ?? null));
                  }}
                >
                  {link.title || '资料已删除'}
                </button>
                {editing ? <button className="btn-ghost min-h-0 shrink-0 px-2 py-1 text-xs" onClick={() => onUpdateObject(object.id, { linkedEntities: object.linkedEntities.filter((item) => !(item.entityType === link.entityType && item.entityId === link.entityId)) } as Partial<MapObject>)}>移除</button> : null}
              </div>
            ))
          )}
        </div>
        {editing ? <button ref={triggerRef} className="btn-ghost mt-3 w-full" onClick={() => setPanelOpen((current) => !current)}>管理关联资料</button> : null}
      </div>
      {panel}
    </>
  );
}

function updatePrimaryLocationLink(links: MapObjectLinkedEntity[], nextLocation: MapObjectLinkedEntity | null): MapObjectLinkedEntity[] {
  const withoutPrimary = links.filter((link) => !(link.entityType === 'location' && link.linkType === 'happens_at'));
  return normalizeObjectLinks(nextLocation ? [nextLocation, ...withoutPrimary] : withoutPrimary);
}

function entityTypeLabel(entityType: string): string {
  if (entityType === 'location') return '地点';
  if (entityType === 'event') return '事件';
  if (entityType === 'character_version') return '角色版本';
  if (entityType === 'codex_item') return '词条';
  return '资料';
}

function navigationTargetForEntity(entityType: string, entityId: string, characterId: string | null = null): NavigationTarget {
  if (entityType === 'location') return { module: 'locations', view: 'records', locationId: entityId };
  if (entityType === 'event') return { module: 'events', eventId: entityId };
  if (entityType === 'character_version') return { module: 'characters', characterId: characterId || '', characterVersionId: entityId };
  return { module: 'codex', codexItemId: entityId };
}

function LayerPanel({
  draft,
  editing,
  activeLayerId,
  onSetActiveLayer,
  onMutateDraft,
  onClearSelection,
  onConfirmDanger,
  onError
}: {
  draft: MapDraft | null;
  editing: boolean;
  activeLayerId: string;
  onSetActiveLayer: (id: string) => void;
  onMutateDraft: (updater: (current: MapDraft) => MapDraft, mode?: DraftMutationMode, historyKey?: string) => void;
  onClearSelection: () => void;
  onConfirmDanger: (message: string) => Promise<boolean>;
  onError: (message: string) => void;
}): JSX.Element {
  if (!draft) return <div className="mini-panel"><h3>图层</h3><p>请选择或创建一张地图。</p></div>;
  const objectCount = (layerId: string): number => draft.objects.filter((object) => object.layerId === layerId).length;
  const updateLayer = (layerId: string, patch: Partial<MapLayer>, mode: DraftMutationMode = 'debounced'): void => {
    onMutateDraft((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer)
    }), mode, `layer:${layerId}:${Object.keys(patch).sort().join(',')}`);
  };
  const chooseFallbackLayer = (excludedId: string): string =>
    draft.layers.find((layer) => layer.id !== excludedId && layer.visible && !layer.locked)?.id
    || draft.layers.find((layer) => layer.id !== excludedId)?.id
    || '';
  const addLayer = (): void => {
    const id = `draft-layer-${Date.now()}`;
    const layer: MapLayer = {
      id,
      mapId: draft.objects[0]?.mapId || '',
      name: '新图层',
      visible: true,
      locked: false,
      opacity: 1,
      sortOrder: draft.layers.length,
      objectCount: 0,
      isDefault: false
    };
    onMutateDraft((current) => ({ ...current, layers: [...current.layers, layer] }), 'immediate');
    onSetActiveLayer(id);
  };
  const moveLayer = (layerId: string, direction: -1 | 1): void => {
    const index = draft.layers.findIndex((layer) => layer.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.layers.length) return;
    const layers = [...draft.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    onMutateDraft((current) => ({ ...current, layers: layers.map((layer, sortOrder) => ({ ...layer, sortOrder })) }), 'immediate');
  };
  const deleteLayer = async (layer: MapLayer): Promise<void> => {
    if (draft.layers.length <= 1) {
      onError('每张地图至少需要一个图层，最后一个图层不能删除。');
      return;
    }
    if (objectCount(layer.id) > 0) {
      onError('请先将该图层中的对象移动到其他图层后再删除。');
      return;
    }
    const label = layer.isDefault ? '默认图层' : '图层';
    if (!await onConfirmDanger(`确定要删除${label}“${layer.name}”吗？`)) return;
    onMutateDraft((current) => ({ ...current, layers: current.layers.filter((item) => item.id !== layer.id) }), 'immediate');
    if (activeLayerId === layer.id) onSetActiveLayer(chooseFallbackLayer(layer.id));
  };

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-serif font-semibold text-ink">图层</h3>
          <p className="text-xs text-sepia">列表从下到上对应画布层级。</p>
        </div>
        {editing ? <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" onClick={addLayer}>新建</button> : null}
      </div>
      {draft.layers.map((layer, index) => {
        const count = objectCount(layer.id);
        const active = layer.id === activeLayerId;
        return (
          <div key={layer.id} className={`rounded-md border p-3 ${active ? 'border-copper bg-batter/60' : 'border-umber/25 bg-vellum'}`}>
            <div className="flex items-start gap-2">
              {editing ? (
                <button
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${active ? 'border-copper bg-copper' : 'border-umber/40 bg-vellum'}`}
                  title="设为激活图层"
                  onClick={() => {
                    if (layer.locked || !layer.visible) {
                      onError('只能激活可见且未锁定的图层。');
                      return;
                    }
                    onSetActiveLayer(layer.id);
                  }}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                {editing ? (
                  <input className="field h-8 w-full truncate px-2 py-1 text-sm font-semibold" value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />
                ) : <p className="truncate text-sm font-semibold text-ink" title={layer.name}>{layer.name}</p>}
                <p className="mt-1 text-xs text-sepia">{count} 个对象{layer.isDefault ? ' · 默认图层' : ''}</p>
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-sepia">
                    <span>透明度</span>
                    <span>{Math.round(layer.opacity * 100)}%</span>
                  </div>
                  {editing ? (
                    <input
                      className="h-2 w-full accent-copper"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(layer.opacity * 100)}
                      onChange={(event) => updateLayer(layer.id, { opacity: clamp(Number(event.target.value) / 100, 0, 1) })}
                    />
                  ) : (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-umber/15">
                      <div className="h-full rounded-full bg-copper/65" style={{ width: `${Math.round(layer.opacity * 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {editing ? (
                <>
                  <button
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    onClick={() => {
                      const visible = !layer.visible;
                      updateLayer(layer.id, { visible }, 'immediate');
                      if (!visible) {
                        onClearSelection();
                        if (active) onSetActiveLayer(chooseFallbackLayer(layer.id));
                      }
                    }}
                  >{layer.visible ? '隐藏' : '显示'}</button>
                  <button
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    onClick={() => {
                      const locked = !layer.locked;
                      updateLayer(layer.id, { locked }, 'immediate');
                      if (locked) {
                        onClearSelection();
                        if (active) onSetActiveLayer(chooseFallbackLayer(layer.id));
                      }
                    }}
                  >{layer.locked ? '解锁' : '锁定'}</button>
                  <button className="btn-ghost min-h-0 px-2 py-1 text-xs" disabled={index === draft.layers.length - 1} onClick={() => moveLayer(layer.id, 1)}>上移</button>
                  <button className="btn-ghost min-h-0 px-2 py-1 text-xs" disabled={index === 0} onClick={() => moveLayer(layer.id, -1)}>下移</button>
                  <button className="btn-ghost min-h-0 px-2 py-1 text-xs" onClick={() => void deleteLayer(layer)}>删除</button>
                </>
              ) : (
                <span className="text-xs text-sepia">{layer.visible ? '显示' : '隐藏'} · {layer.locked ? '锁定' : '未锁定'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }): JSX.Element {
  return <label className="block"><span className="mb-2 block text-sm text-copper">{label}</span><input className="field w-full" type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(clamp(Number(event.target.value), min, max))} /></label>;
}

function RegionGeometryFields({ region, onUpdateObject }: { region: RegionObject; onUpdateObject: (objectId: string, patch: Partial<MapObject>) => void }): JSX.Element {
  const rotationField = supportsRegionRotation(region.geometry) ? (
    <div className="col-span-2">
      <NumberField label="旋转角度" value={region.geometry.rotation} min={0} max={360} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, rotation: value } } as Partial<MapObject>)} />
      <p className="mt-1 text-xs text-sepia">可拖动画布上的旋转把手调整，数值输入用于精调。</p>
    </div>
  ) : null;
  if (region.geometry.shape === 'rect') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="宽度" value={region.geometry.width} min={20} max={5000} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, width: value } } as Partial<MapObject>)} />
        <NumberField label="高度" value={region.geometry.height} min={20} max={5000} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, height: value } } as Partial<MapObject>)} />
        {rotationField}
      </div>
    );
  }
  if (region.geometry.shape === 'ellipse') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="横向半径" value={region.geometry.radiusX} min={10} max={2500} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, radiusX: value } } as Partial<MapObject>)} />
        <NumberField label="纵向半径" value={region.geometry.radiusY} min={10} max={2500} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, radiusY: value } } as Partial<MapObject>)} />
        {rotationField}
      </div>
    );
  }
  if (region.geometry.shape === 'triangle' || region.geometry.shape === 'hexagon' || region.geometry.shape === 'pentagon') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="半径" value={region.geometry.radius} min={20} max={2500} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, radius: value } } as Partial<MapObject>)} />
        {rotationField}
      </div>
    );
  }
  if (region.geometry.shape === 'diamond') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="宽度" value={region.geometry.width} min={20} max={5000} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, width: value } } as Partial<MapObject>)} />
        <NumberField label="高度" value={region.geometry.height} min={20} max={5000} onChange={(value) => onUpdateObject(region.id, { geometry: { ...region.geometry, height: value } } as Partial<MapObject>)} />
        {rotationField}
      </div>
    );
  }
  return <p className="text-sm text-sepia">多边形顶点：{region.geometry.points.length} 个。选中后可在画布中拖动顶点。</p>;
}

function RegionBindingFields(): JSX.Element | null {
  return null;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return <label className="block"><span className="mb-2 block text-sm text-copper">{label}</span><input className="field h-10 w-full p-1" type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function cloneMapDraft(draft: MapDraft): MapDraft {
  return JSON.parse(JSON.stringify(draft)) as MapDraft;
}

function draftsEqual(left: MapDraft, right: MapDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type);
}

function toDraft(map: MapRecord | null | undefined, objects: any[], layers: any[]): MapDraft | null {
  if (!map) return null;
  const normalizedLayers = layers.map(normalizeMapLayer);
  const fallbackLayerId = normalizedLayers[0]?.id ?? null;
  return {
    title: map.title,
    description: map.description ?? '',
    backgroundAssetId: map.backgroundAssetId ?? null,
    backgroundAssetUrl: map.backgroundAssetUrl ?? '',
    canvasWidth: Number(map.canvasWidth || 1600),
    canvasHeight: Number(map.canvasHeight || 1000),
    layers: normalizedLayers,
    objects: objects.map(normalizeMapObject).map((object) => object.layerId ? object : { ...object, layerId: fallbackLayerId })
  };
}

function normalizeMapLayer(layer: any, index: number): MapLayer {
  return {
    id: String(layer.id),
    mapId: String(layer.mapId || ''),
    name: String(layer.name || '未命名图层'),
    visible: Boolean(layer.visible),
    locked: Boolean(layer.locked),
    opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
    sortOrder: Number(layer.sortOrder ?? index),
    objectCount: Number(layer.objectCount || 0),
    isDefault: Boolean(layer.isDefault)
  };
}

function normalizeObjectLinks(links: any[]): MapObjectLinkedEntity[] {
  const deduped = new Map<string, MapObjectLinkedEntity>();
  (Array.isArray(links) ? links : []).forEach((link) => {
    const entityType = link?.entityType;
    const entityId = String(link?.entityId || '');
    if ((entityType !== 'location' && entityType !== 'event' && entityType !== 'character_version' && entityType !== 'codex_item') || !entityId || link?.deleted) {
      return;
    }
    const key = `${entityType}:${entityId}`;
    if (deduped.has(key)) {
      return;
    }
    deduped.set(key, {
      entityType,
      entityId,
      title: String(link?.title || ''),
      linkType: String(link?.linkType || (entityType === 'location' ? 'happens_at' : 'related')),
      note: String(link?.note || ''),
      deleted: Boolean(link?.deleted)
    });
  });
  return [...deduped.values()];
}

function normalizeMapObject(object: any): MapObject {
  const type = object.type === 'label' || object.type === 'route' || object.type === 'region' ? object.type : 'marker';
  const linkedEntities = normalizeObjectLinks(object.linkedEntities);
  const base = {
    id: String(object.id),
    mapId: String(object.mapId || ''),
    layerId: object.layerId ?? null,
    type,
    name: String(object.name || ''),
    description: String(object.description || ''),
    x: Number(object.x || 0),
    y: Number(object.y || 0),
    linkedEntities
  };
  if (type === 'label') {
    const properties = parseJson(object.propertiesJson);
    return { ...base, type: 'label', text: String(properties.text || object.name || '文字标签'), style: normalizeLabelStyle(parseJson(object.styleJson)) };
  }
  if (type === 'route') {
    const geometry = parseJson(object.geometryJson);
    const points = Array.isArray(geometry.points) ? geometry.points.map((point: any) => ({ x: Number(point.x || 0), y: Number(point.y || 0) })).filter((point: MapPoint) => Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
    return { ...base, type: 'route', points, style: normalizeRouteStyle(parseJson(object.styleJson)) };
  }
  if (type === 'region') {
    return {
      ...base,
      type: 'region',
      geometry: normalizeRegionGeometry(parseJson(object.geometryJson), base.x, base.y),
      style: normalizeRegionStyle(parseJson(object.styleJson))
    };
  }
  const primaryLocation = linkedEntities.find((link) => link.entityType === 'location' && !link.deleted) ?? null;
  return { ...base, type: 'marker', locationId: primaryLocation?.entityId ?? null, locationName: primaryLocation?.title ?? '' };
}

function normalizeUpdatedObject(object: MapObject): MapObject {
  const linkedEntities = normalizeObjectLinks(object.linkedEntities);
  if (object.type === 'label') return { ...object, linkedEntities, style: normalizeLabelStyle(object.style), name: object.name || object.text || '文字标签' };
  if (object.type === 'route') return { ...object, linkedEntities, style: normalizeRouteStyle(object.style), points: object.points.map((point) => ({ x: Number(point.x || 0), y: Number(point.y || 0) })), x: object.points[0]?.x ?? object.x, y: object.points[0]?.y ?? object.y };
  if (object.type === 'region') {
    const geometry = normalizeRegionGeometry(object.geometry, object.x, object.y);
    return { ...object, linkedEntities, geometry, style: normalizeRegionStyle(object.style), x: regionAnchor(geometry).x, y: regionAnchor(geometry).y };
  }
  const primaryLocation = linkedEntities.find((link) => link.entityType === 'location' && !link.deleted) ?? null;
  return { ...object, linkedEntities, locationId: primaryLocation?.entityId ?? null, locationName: primaryLocation?.title ?? '' };
}

function serializeMapObject(object: MapObject): Record<string, unknown> {
  if (object.type === 'label') {
    return { ...object, linkedEntities: normalizeObjectLinks(object.linkedEntities), propertiesJson: JSON.stringify({ text: object.text }), styleJson: JSON.stringify(object.style), geometryJson: null };
  }
  if (object.type === 'route') {
    return { ...object, linkedEntities: normalizeObjectLinks(object.linkedEntities), x: object.points[0]?.x ?? 0, y: object.points[0]?.y ?? 0, geometryJson: JSON.stringify({ points: object.points }), styleJson: JSON.stringify(object.style), propertiesJson: null };
  }
  if (object.type === 'region') {
    return { ...object, linkedEntities: normalizeObjectLinks(object.linkedEntities), x: regionAnchor(object.geometry).x, y: regionAnchor(object.geometry).y, geometryJson: JSON.stringify(object.geometry), styleJson: JSON.stringify(object.style), propertiesJson: null };
  }
  return { ...object, linkedEntities: normalizeObjectLinks(object.linkedEntities), geometryJson: null, styleJson: null, propertiesJson: null };
}

function createDefaultMapObject(type: 'marker' | 'label', mapId: string, point: MapPoint, layerId: string): MarkerObject | LabelObject {
  const id = `draft-${type}-${Date.now()}`;
  if (type === 'label') return { id, mapId, layerId, type: 'label', name: '文字标签', description: '', x: point.x, y: point.y, linkedEntities: [], text: '文字标签', style: { ...labelDefaults } };
  return { id, mapId, layerId, type: 'marker', name: '新地图点位', description: '', x: point.x, y: point.y, linkedEntities: [], locationId: null, locationName: '' };
}

function createRouteObject(mapId: string, points: MapPoint[], layerId: string): RouteObject {
  return { id: `draft-route-${Date.now()}`, mapId, layerId, type: 'route', name: '新路线', description: '', x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, linkedEntities: [], points: points.map((point) => ({ ...point })), style: { ...routeDefaults } };
}

function createRegionObject(mapId: string, point: MapPoint, shape: RegionShapeKind, layerId: string, points: MapPoint[] = []): RegionObject {
  const geometry: RegionGeometry =
    shape === 'rect'
      ? { shape: 'rect', x: point.x, y: point.y, width: 280, height: 160, rotation: 0 }
      : shape === 'ellipse'
        ? { shape: 'ellipse', x: point.x, y: point.y, radiusX: 140, radiusY: 85, rotation: 0 }
        : shape === 'triangle'
          ? { shape: 'triangle', x: point.x, y: point.y, radius: 110, rotation: 0 }
          : shape === 'hexagon'
            ? { shape: 'hexagon', x: point.x, y: point.y, radius: 120, rotation: 0 }
            : shape === 'diamond'
              ? { shape: 'diamond', x: point.x, y: point.y, width: 220, height: 160, rotation: 0 }
              : shape === 'pentagon'
                ? { shape: 'pentagon', x: point.x, y: point.y, radius: 115, rotation: 0 }
                : { shape: 'polygon', points: points.map((item) => ({ ...item })) };
  const anchor = regionAnchor(geometry);
  return { id: `draft-region-${Date.now()}`, mapId, layerId, type: 'region', name: '新区域', description: '', x: anchor.x, y: anchor.y, linkedEntities: [], geometry, style: { ...regionDefaults } };
}

function normalizeLabelStyle(value: any): LabelStyle {
  return { ...labelDefaults, ...value, fontSize: Number(value?.fontSize ?? labelDefaults.fontSize), opacity: clamp(Number(value?.opacity ?? labelDefaults.opacity), 0.2, 1), backgroundEnabled: Boolean(value?.backgroundEnabled ?? labelDefaults.backgroundEnabled) };
}

function normalizeRouteStyle(value: any): RouteStyle {
  const lineStyle = value?.lineStyle === 'dotted' || value?.lineStyle === 'dashed' || value?.lineStyle === 'solid'
    ? value.lineStyle
    : value?.dashEnabled
      ? 'dashed'
      : routeDefaults.lineStyle;
  const arrowDirection = value?.arrowDirection === 'forward' || value?.arrowDirection === 'backward' || value?.arrowDirection === 'both' || value?.arrowDirection === 'none'
    ? value.arrowDirection
    : value?.arrowEnabled
      ? 'forward'
      : routeDefaults.arrowDirection;
  return {
    ...routeDefaults,
    ...value,
    strokeWidth: clamp(Number(value?.strokeWidth ?? routeDefaults.strokeWidth), 1, 16),
    opacity: clamp(Number(value?.opacity ?? routeDefaults.opacity), 0.2, 1),
    lineStyle,
    dashEnabled: lineStyle !== 'solid',
    arrowDirection,
    arrowEnabled: arrowDirection !== 'none',
    arrowSize: clamp(Number(value?.arrowSize ?? routeDefaults.arrowSize), 6, 40)
  };
}

function normalizeRegionStyle(value: any): RegionStyle {
  return {
    ...regionDefaults,
    ...value,
    fillOpacity: clamp(Number(value?.fillOpacity ?? regionDefaults.fillOpacity), 0, 0.8),
    strokeWidth: clamp(Number(value?.strokeWidth ?? regionDefaults.strokeWidth), 1, 12),
    dashEnabled: Boolean(value?.dashEnabled ?? regionDefaults.dashEnabled),
    labelVisible: Boolean(value?.labelVisible ?? regionDefaults.labelVisible)
  };
}

function normalizeRegionGeometry(value: any, fallbackX: number, fallbackY: number): RegionGeometry {
  if (value?.shape === 'ellipse') {
    return {
      shape: 'ellipse',
      x: Number(value.x ?? fallbackX),
      y: Number(value.y ?? fallbackY),
      radiusX: Math.max(10, Number(value.radiusX ?? 140)),
      radiusY: Math.max(10, Number(value.radiusY ?? 85)),
      rotation: normalizeRotation(value.rotation)
    };
  }
  if (value?.shape === 'triangle' || value?.shape === 'hexagon' || value?.shape === 'pentagon') {
    return {
      shape: value.shape,
      x: Number(value.x ?? fallbackX),
      y: Number(value.y ?? fallbackY),
      radius: Math.max(20, Number(value.radius ?? 120)),
      rotation: normalizeRotation(value.rotation)
    };
  }
  if (value?.shape === 'diamond') {
    return {
      shape: 'diamond',
      x: Number(value.x ?? fallbackX),
      y: Number(value.y ?? fallbackY),
      width: Math.max(20, Number(value.width ?? 220)),
      height: Math.max(20, Number(value.height ?? 160)),
      rotation: normalizeRotation(value.rotation)
    };
  }
  if (value?.shape === 'polygon') {
    const points = Array.isArray(value.points)
      ? value.points.map((point: any) => ({ x: Number(point.x || 0), y: Number(point.y || 0) })).filter((point: MapPoint) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    return { shape: 'polygon', points: points.length >= 3 ? points : [{ x: fallbackX, y: fallbackY }, { x: fallbackX + 120, y: fallbackY }, { x: fallbackX + 60, y: fallbackY + 90 }] };
  }
  return {
    shape: 'rect',
    x: Number(value?.x ?? fallbackX),
    y: Number(value?.y ?? fallbackY),
    width: Math.max(20, Number(value?.width ?? 280)),
    height: Math.max(20, Number(value?.height ?? 160)),
    rotation: normalizeRotation(value?.rotation)
  };
}

function regionAnchor(geometry: RegionGeometry): MapPoint {
  if (geometry.shape === 'rect') return { x: geometry.x, y: geometry.y };
  if (geometry.shape === 'ellipse') return { x: geometry.x, y: geometry.y };
  if (isStandardRegionGeometry(geometry)) return { x: geometry.x, y: geometry.y };
  return geometry.points[0] ?? { x: 0, y: 0 };
}

function regionLabelPoint(region: RegionObject): MapPoint {
  const geometry = region.geometry;
  if (geometry.shape === 'rect') return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  if (geometry.shape === 'ellipse') return { x: geometry.x, y: geometry.y };
  if (isStandardRegionGeometry(geometry)) return { x: geometry.x, y: geometry.y };
  const totals = geometry.points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: totals.x / geometry.points.length, y: totals.y / geometry.points.length };
}

function moveRegionBy(region: RegionObject, dx: number, dy: number): Partial<RegionObject> {
  const geometry = region.geometry;
  if (geometry.shape === 'rect') {
    const next = { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
    return { geometry: next, x: next.x, y: next.y };
  }
  if (geometry.shape === 'ellipse') {
    const next = { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
    return { geometry: next, x: next.x, y: next.y };
  }
  if (isStandardRegionGeometry(geometry)) {
    const next = { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
    return { geometry: next, x: next.x, y: next.y };
  }
  const points = geometry.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  return { geometry: { shape: 'polygon', points }, x: points[0]?.x ?? region.x, y: points[0]?.y ?? region.y };
}

function regionShapeLabel(geometry: RegionGeometry): string {
  if (geometry.shape === 'rect') return '矩形区域';
  if (geometry.shape === 'ellipse') return '椭圆区域';
  if (geometry.shape === 'triangle') return '三角形区域';
  if (geometry.shape === 'hexagon') return '六边形区域';
  if (geometry.shape === 'diamond') return '菱形区域';
  if (geometry.shape === 'pentagon') return '五边形区域';
  return `多边形区域（${geometry.points.length} 个顶点）`;
}

function toolToRegionShape(tool: MapTool): RegionShapeKind | null {
  if (tool === 'regionRect') return 'rect';
  if (tool === 'regionEllipse') return 'ellipse';
  if (tool === 'regionPolygon') return 'polygon';
  if (tool === 'regionTriangle') return 'triangle';
  if (tool === 'regionHexagon') return 'hexagon';
  if (tool === 'regionDiamond') return 'diamond';
  if (tool === 'regionPentagon') return 'pentagon';
  return null;
}

function supportsRegionRotation(geometry: RegionGeometry): geometry is Exclude<RegionGeometry, { shape: 'polygon' }> {
  return geometry.shape !== 'polygon';
}

function isStandardRegionGeometry(geometry: RegionGeometry): geometry is Extract<RegionGeometry, { shape: 'triangle' | 'hexagon' | 'diamond' | 'pentagon' }> {
  return geometry.shape === 'triangle' || geometry.shape === 'hexagon' || geometry.shape === 'diamond' || geometry.shape === 'pentagon';
}

function normalizeRotation(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % 360) + 360) % 360;
}

function regionRotationTransform(geometry: Exclude<RegionGeometry, { shape: 'polygon' }>): string | undefined {
  const rotation = normalizeRotation(geometry.rotation);
  if (rotation === 0) return undefined;
  const center = regionRotationCenter(geometry);
  return `rotate(${rotation} ${center.x} ${center.y})`;
}

function regionRotationCenter(geometry: Exclude<RegionGeometry, { shape: 'polygon' }>): MapPoint {
  if (geometry.shape === 'rect') return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  return { x: geometry.x, y: geometry.y };
}

function regionControlHandles(geometry: Exclude<RegionGeometry, { shape: 'polygon' }>, rotationOffset: number): { resize: MapPoint; rotate: MapPoint } {
  const center = regionRotationCenter(geometry);
  let resize: MapPoint;
  if (geometry.shape === 'rect') {
    resize = rotatePoint({ x: geometry.x + geometry.width, y: geometry.y + geometry.height }, center, geometry.rotation);
  } else if (geometry.shape === 'ellipse') {
    resize = rotatePoint({ x: geometry.x + geometry.radiusX, y: geometry.y + geometry.radiusY }, center, geometry.rotation);
  } else if (geometry.shape === 'diamond') {
    resize = rotatePoint({ x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }, center, geometry.rotation);
  } else {
    resize = regionBoundaryPoints(geometry).reduce((best, point) => point.x + point.y > best.x + best.y ? point : best);
  }
  const distance = Math.max(1, pointDistance(center, resize));
  const direction = { x: (resize.x - center.x) / distance, y: (resize.y - center.y) / distance };
  return {
    resize,
    rotate: { x: resize.x + direction.x * rotationOffset, y: resize.y + direction.y * rotationOffset }
  };
}

function resizeRegionGeometry(
  geometry: Exclude<RegionGeometry, { shape: 'polygon' }>,
  pointer: MapPoint,
  center: MapPoint
): Exclude<RegionGeometry, { shape: 'polygon' }> {
  const local = rotatePoint(pointer, center, -geometry.rotation);
  if (geometry.shape === 'rect') {
    const width = Math.max(20, Math.abs(local.x - center.x) * 2);
    const height = Math.max(20, Math.abs(local.y - center.y) * 2);
    return { ...geometry, x: center.x - width / 2, y: center.y - height / 2, width, height };
  }
  if (geometry.shape === 'ellipse') {
    return {
      ...geometry,
      radiusX: Math.max(10, Math.abs(local.x - center.x)),
      radiusY: Math.max(10, Math.abs(local.y - center.y))
    };
  }
  if (geometry.shape === 'diamond') {
    return {
      ...geometry,
      width: Math.max(20, Math.abs(local.x - center.x) * 2),
      height: Math.max(20, Math.abs(local.y - center.y) * 2)
    };
  }
  return { ...geometry, radius: Math.max(20, pointDistance(center, pointer)) };
}

function pointAngle(center: MapPoint, point: MapPoint): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
}

function normalizeAngleDelta(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function regionBoundaryPoints(geometry: RegionGeometry): MapPoint[] {
  if (geometry.shape === 'polygon') return geometry.points.map((point) => ({ ...point }));
  if (geometry.shape === 'rect') {
    const center = regionRotationCenter(geometry);
    return [
      { x: geometry.x, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
      { x: geometry.x, y: geometry.y + geometry.height }
    ].map((point) => rotatePoint(point, center, geometry.rotation));
  }
  if (geometry.shape === 'ellipse') {
    const points: MapPoint[] = [];
    for (let index = 0; index < 16; index += 1) {
      const angle = (Math.PI * 2 * index) / 16;
      points.push(rotatePoint({ x: geometry.x + Math.cos(angle) * geometry.radiusX, y: geometry.y + Math.sin(angle) * geometry.radiusY }, { x: geometry.x, y: geometry.y }, geometry.rotation));
    }
    return points;
  }
  if (geometry.shape === 'diamond') {
    const points = [
      { x: geometry.x, y: geometry.y - geometry.height / 2 },
      { x: geometry.x + geometry.width / 2, y: geometry.y },
      { x: geometry.x, y: geometry.y + geometry.height / 2 },
      { x: geometry.x - geometry.width / 2, y: geometry.y }
    ];
    return points.map((point) => rotatePoint(point, { x: geometry.x, y: geometry.y }, geometry.rotation));
  }
  const sideCount = geometry.shape === 'triangle' ? 3 : geometry.shape === 'hexagon' ? 6 : 5;
  const startAngle = geometry.shape === 'hexagon' ? -30 : -90;
  return Array.from({ length: sideCount }, (_, index) => {
    const angle = ((startAngle + geometry.rotation) * Math.PI) / 180 + (Math.PI * 2 * index) / sideCount;
    return { x: geometry.x + Math.cos(angle) * geometry.radius, y: geometry.y + Math.sin(angle) * geometry.radius };
  });
}

function mapObjectBounds(object: MapObject): { minX: number; minY: number; maxX: number; maxY: number } {
  if (object.type === 'marker') {
    return { minX: object.x - 36, minY: object.y - 36, maxX: object.x + 36, maxY: object.y + 36 };
  }
  if (object.type === 'label') {
    const width = Math.max(80, (object.text || object.name || '文字标签').length * object.style.fontSize * 0.7);
    const height = Math.max(28, object.style.fontSize * 1.6);
    return { minX: object.x - width / 2, minY: object.y - height / 2, maxX: object.x + width / 2, maxY: object.y + height / 2 };
  }
  if (object.type === 'route') {
    const points = object.points.length > 0 ? object.points : [{ x: object.x, y: object.y }];
    return boundsFromPoints(points, 24);
  }
  return boundsFromPoints(regionBoundaryPoints(object.geometry), 24);
}

function boundsFromPoints(points: MapPoint[], padding = 0): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - padding,
    minY: Math.min(...ys) - padding,
    maxX: Math.max(...xs) + padding,
    maxY: Math.max(...ys) + padding
  };
}

function rotatePoint(point: MapPoint, center: MapPoint, degrees: number): MapPoint {
  const angle = (normalizeRotation(degrees) * Math.PI) / 180;
  if (angle === 0) return { ...point };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle)
  };
}

function regionSnapCandidates(objects: MapObject[], excludeRegionId?: string): { vertices: MapPoint[]; edges: { start: MapPoint; end: MapPoint }[] } {
  const vertices: MapPoint[] = [];
  const edges: { start: MapPoint; end: MapPoint }[] = [];
  for (const object of objects) {
    if (object.type !== 'region' || object.id === excludeRegionId) continue;
    const points = regionBoundaryPoints(object.geometry);
    vertices.push(...points);
    if (points.length < 2) continue;
    points.forEach((point, index) => {
      edges.push({ start: point, end: points[(index + 1) % points.length] });
    });
  }
  return { vertices, edges };
}

function closestPointOnSegment(point: MapPoint, start: MapPoint, end: MapPoint): MapPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...start };
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return { x: start.x + dx * t, y: start.y + dy * t };
}

function pointDistance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function parseJson(value: unknown): any {
  if (!value || typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function pointsAttr(points: MapPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function effectiveObjectOpacity(objectOpacity: number, layerOpacity: number): number {
  return clamp(objectOpacity * layerOpacity, 0, 1);
}

function routeDashArray(style: RouteStyle): string | undefined {
  if (style.lineStyle === 'dashed') return '12 8';
  if (style.lineStyle === 'dotted') return '2 8';
  return undefined;
}

function routeArrows(route: RouteObject): string[] {
  const arrows: string[] = [];
  if (route.points.length < 2 || route.style.arrowDirection === 'none') return arrows;
  if (route.style.arrowDirection === 'forward' || route.style.arrowDirection === 'both') {
    const end = route.points[route.points.length - 1];
    const previous = route.points[route.points.length - 2];
    arrows.push(arrowPolygon(previous, end, route.style.arrowSize));
  }
  if (route.style.arrowDirection === 'backward' || route.style.arrowDirection === 'both') {
    const start = route.points[0];
    const next = route.points[1];
    arrows.push(arrowPolygon(next, start, route.style.arrowSize));
  }
  return arrows;
}

function arrowPolygon(from: MapPoint, tip: MapPoint, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = Math.PI / 7;
  const left = {
    x: tip.x - Math.cos(angle - wing) * size,
    y: tip.y - Math.sin(angle - wing) * size
  };
  const right = {
    x: tip.x - Math.cos(angle + wing) * size,
    y: tip.y - Math.sin(angle + wing) * size
  };
  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

function lineStyleLabel(value: RouteStyle['lineStyle']): string {
  if (value === 'dashed') return '虚线';
  if (value === 'dotted') return '点线';
  return '实线';
}

function arrowDirectionLabel(value: RouteStyle['arrowDirection']): string {
  if (value === 'forward') return '箭头：指向终点';
  if (value === 'backward') return '箭头：指向起点';
  if (value === 'both') return '箭头：双向箭头';
  return '箭头：无箭头';
}

function toolHint(tool: MapTool, routePointCount: number, regionPointCount: number): string {
  if (tool === 'marker') return '点击地图添加 marker';
  if (tool === 'label') return '点击地图添加文字标签';
  if (tool === 'route') return routePointCount > 0 ? `绘制路线中：已添加 ${routePointCount} 个节点` : '点击地图开始绘制路线';
  if (tool === 'regionRect') return '点击地图创建矩形区域';
  if (tool === 'regionEllipse') return '点击地图创建椭圆区域';
  if (tool === 'regionTriangle') return '点击地图创建三角形区域';
  if (tool === 'regionHexagon') return '点击地图创建六边形区域';
  if (tool === 'regionDiamond') return '点击地图创建菱形区域';
  if (tool === 'regionPentagon') return '点击地图创建五边形区域';
  if (tool === 'regionPolygon') return regionPointCount > 0 ? `绘制区域中：已添加 ${regionPointCount} 个顶点` : '点击地图开始绘制多边形区域';
  return '选择模式：点击对象选中，拖动画布平移';
}

function DuplicateMapDialog({
  sourceMap,
  title,
  creating,
  onTitleChange,
  onCancel,
  onCreate
}: {
  sourceMap: MapRecord;
  title: string;
  creating: boolean;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/35 p-6">
      <div className="w-full max-w-lg rounded-md border border-umber/40 bg-vellum p-5 shadow-folio">
        <h2 className="font-serif text-2xl font-semibold text-ink">复制地图为新版本</h2>
        <p className="mt-2 text-sm text-sepia">源地图：<span className="font-medium text-ink">{sourceMap.title}</span></p>
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-medium text-copper">新地图名称</span>
          <input
            className="field w-full"
            value={title}
            autoFocus
            disabled={creating}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && !creating) onCreate();
              if (event.key === 'Escape' && !creating) onCancel();
            }}
          />
        </label>
        <p className="mt-4 text-sm leading-7 text-sepia">
          将复制底图、图层、地图对象及其关联。复制完成后，新旧地图可独立编辑，后续修改不会互相影响。
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button className="btn-ghost" onClick={onCancel} disabled={creating}>取消</button>
          <button className="btn-primary" onClick={onCreate} disabled={creating || !title.trim()}>
            {creating ? '正在创建...' : '创建副本'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MapAssetPicker({ vaultPath, onClose, onSelect }: { vaultPath: string; onClose: () => void; onSelect: (asset: AssetRecord) => void }): JSX.Element {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadAssets(); }, [vaultPath]);

  async function loadAssets(): Promise<void> {
    try {
      setError('');
      setAssets(await assetClient.listImages(vaultPath));
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function uploadBackground(): Promise<void> {
    try {
      setUploading(true);
      setError('');
      const asset = await assetClient.importImage(vaultPath);
      if (!asset) return;
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      onSelect(asset);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/35 p-6">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-auto rounded-md border border-umber/35 bg-vellum p-5 shadow-folio">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h3 className="font-serif text-2xl font-semibold">选择地图底图</h3><p className="text-sm text-sepia">从当前存档素材库选择图片，或上传本地图片作为底图。</p></div>
          <div className="flex gap-2"><button className="btn-ghost" onClick={uploadBackground} disabled={uploading}>{uploading ? '上传中' : '上传底图'}</button><button className="btn-ghost" onClick={onClose}>取消</button></div>
        </div>
        {error ? <div className="mb-3 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div> : null}
        {assets.length === 0 ? <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无图片素材。可以直接点击“上传底图”导入本地图片。</div> : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {assets.map((asset) => (
              <button key={asset.id} className="rounded-md border border-umber/25 bg-batter/45 p-2 text-left" onClick={() => onSelect(asset)}>
                {asset.url ? <img className="h-32 w-full rounded-md object-cover" src={asset.url} alt={asset.originalName} /> : <div className="grid h-32 place-items-center rounded-md bg-vellum text-sm text-sepia">图片文件缺失</div>}
                <span className="mt-2 block truncate text-sm text-ink">{asset.originalName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function suggestDuplicateTitle(sourceTitle: string, maps: MapRecord[]): string {
  const base = `${sourceTitle.trim() || '未命名地图'} - 副本`;
  const existing = new Set(maps.map((map) => map.title.trim().toLocaleLowerCase()));
  if (!existing.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (existing.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}
