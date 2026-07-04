import { useEffect, useMemo, useRef, useState } from 'react';
import { Section } from '../components/Section';
import { dataClient } from '../services/dataClient';
import { exportClient, type ExportOptions, type ExportSummary, type ExportSummaryItem } from '../services/exportClient';
import { renderSavedMapPng, type MapPngSource } from '../services/mapPngRenderer';
import type { Vault } from '../types/app';

interface ExportPageProps {
  vault: Vault;
}

type ModuleKey = 'characters' | 'codex' | 'events' | 'locations' | 'timelines' | 'manuscripts';

const emptySelection: ExportOptions = {
  selectedCharacterIds: [],
  selectedCodexItemIds: [],
  selectedEventIds: [],
  selectedLocationIds: [],
  selectedTimelineIds: [],
  selectedManuscriptIds: []
};

const moduleConfig: Array<{ key: ModuleKey; label: string; selectionKey: keyof ExportOptions }> = [
  { key: 'characters', label: '角色', selectionKey: 'selectedCharacterIds' },
  { key: 'codex', label: '词条', selectionKey: 'selectedCodexItemIds' },
  { key: 'events', label: '事件', selectionKey: 'selectedEventIds' },
  { key: 'locations', label: '地点', selectionKey: 'selectedLocationIds' },
  { key: 'timelines', label: '时间线', selectionKey: 'selectedTimelineIds' },
  { key: 'manuscripts', label: '手稿', selectionKey: 'selectedManuscriptIds' }
];

export function ExportPage({ vault }: ExportPageProps): JSX.Element {
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [maps, setMaps] = useState<Array<MapPngSource & { id: string; description?: string }>>([]);
  const [selectedMapIds, setSelectedMapIds] = useState<string[]>([]);
  const [mapExportScale, setMapExportScale] = useState<1 | 2>(1);
  const [mapExporting, setMapExporting] = useState(false);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapMessage, setMapMessage] = useState('');
  const [mapError, setMapError] = useState('');
  const [selection, setSelection] = useState<ExportOptions>(emptySelection);
  const [expanded, setExpanded] = useState<Record<ModuleKey, boolean>>({
    characters: false,
    codex: false,
    events: false,
    locations: false,
    timelines: false,
    manuscripts: false
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    exportClient.getSummary(vault.path)
      .then((nextSummary) => {
        if (mounted) {
          setSummary(nextSummary);
          setSelection(emptySelection);
          setExpanded({ characters: false, codex: false, events: false, locations: false, timelines: false, manuscripts: false });
        }
      })
      .catch((caught) => {
        console.error('读取导出条目失败', caught);
        if (mounted) setError(caught instanceof Error ? caught.message : '读取导出条目失败。');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    setMapsLoading(true);
    dataClient.listMaps(vault.path)
      .then((mapRows) => {
        if (mounted) {
          setMaps(mapRows as Array<MapPngSource & { id: string; description?: string }>);
          setSelectedMapIds([]);
        }
      })
      .catch((caught) => {
        console.error('读取地图导出列表失败', caught);
        if (mounted) setMapError(caught instanceof Error ? caught.message : '读取地图导出列表失败。');
      })
      .finally(() => {
        if (mounted) setMapsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [vault.path]);

  const itemMap = useMemo(() => ({
    characters: summary?.characters ?? [],
    codex: summary?.codexItems ?? [],
    events: summary?.events ?? [],
    locations: summary?.locations ?? [],
    timelines: summary?.timelines ?? [],
    manuscripts: summary?.manuscripts ?? []
  }), [summary]);

  const selectedCount = Object.values(selection).reduce((count, ids) => count + ids.length, 0);

  function setModuleExpanded(key: ModuleKey, value: boolean): void {
    setExpanded((current) => ({ ...current, [key]: value }));
  }

  function toggleModule(key: ModuleKey, selectionKey: keyof ExportOptions, checked: boolean): void {
    setModuleExpanded(key, checked);
    if (!checked) {
      setModuleSelection(selectionKey, []);
    }
  }

  function setModuleSelection(selectionKey: keyof ExportOptions, ids: string[]): void {
    setSelection((current) => ({ ...current, [selectionKey]: ids }));
  }

  function toggleItem(selectionKey: keyof ExportOptions, id: string): void {
    setSelection((current) => {
      const existing = current[selectionKey];
      return {
        ...current,
        [selectionKey]: existing.includes(id) ? existing.filter((itemId) => itemId !== id) : [...existing, id]
      };
    });
  }

  async function exportMarkdown(): Promise<void> {
    setMessage('');
    setError('');
    if (selectedCount === 0) {
      setError('请选择要导出的内容。');
      return;
    }

    setExporting(true);
    try {
      const result = await exportClient.exportMarkdown(vault.path, selection);
      if (result.cancelled) {
        setMessage('已取消导出。');
        return;
      }
      setMessage(`导出成功：${result.filePath ?? result.fileName ?? 'Markdown 文件'}`);
    } catch (caught) {
      console.error('Markdown 导出失败', caught);
      setError(caught instanceof Error ? caught.message : '导出失败，请稍后再试。');
    } finally {
      setExporting(false);
    }
  }

  function toggleMap(mapId: string): void {
    setSelectedMapIds((current) => current.includes(mapId) ? current.filter((id) => id !== mapId) : [...current, mapId]);
  }

  async function exportSelectedMaps(): Promise<void> {
    if (selectedMapIds.length === 0 || mapExporting) return;
    setMapMessage('');
    setMapError('');
    setMapExporting(true);
    try {
      const selectedMaps = selectedMapIds
        .map((id) => maps.find((map) => map.id === id))
        .filter((map): map is MapPngSource & { id: string; description?: string } => Boolean(map));
      const rendered: Array<{ title: string; dataUrl: string }> = [];
      const renderErrors: string[] = [];

      for (const map of selectedMaps) {
        try {
          const [layers, objects] = await Promise.all([
            dataClient.listMapLayers(vault.path, map.id),
            dataClient.getMapObjects(vault.path, map.id)
          ]);
          rendered.push({
            title: map.title.trim() || '未命名地图',
            dataUrl: await renderSavedMapPng(map, layers, objects, mapExportScale)
          });
        } catch (caught) {
          renderErrors.push(`${map.title || '未命名地图'}：${caught instanceof Error ? caught.message : String(caught)}`);
        }
      }

      if (rendered.length === 0) {
        throw new Error(renderErrors.join('；') || '没有可导出的地图。');
      }

      if (selectedMaps.length === 1) {
        const result = await exportClient.exportMapPng(vault.path, rendered[0]);
        if (result.cancelled) {
          setMapMessage('已取消地图 PNG 导出。');
        } else {
          setMapMessage(`地图 PNG 导出成功：${result.filePath ?? result.fileName ?? rendered[0].title}`);
        }
        if (renderErrors.length > 0) setMapError(renderErrors.join('；'));
        return;
      }

      const result = await exportClient.exportMapPngBatch(vault.path, rendered);
      if (result.cancelled) {
        setMapMessage('已取消地图 PNG 导出。');
        return;
      }
      const failedCount = result.failedCount + renderErrors.length;
      setMapMessage(`地图 PNG 导出完成：成功 ${result.successCount} 张，失败 ${failedCount} 张。${result.directory ? ` 保存至 ${result.directory}` : ''}`);
      const errors = [...renderErrors, ...result.errors];
      if (errors.length > 0) setMapError(errors.join('；'));
    } catch (caught) {
      console.error('地图 PNG 导出失败', caught);
      setMapError(caught instanceof Error ? caught.message : '地图 PNG 导出失败，请稍后再试。');
    } finally {
      setMapExporting(false);
    }
  }

  return (
    <Section title="导出资料">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="paper-panel space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-olive">导出格式</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="subtab subtab-active" type="button">Markdown</button>
              <button className="subtab cursor-not-allowed opacity-60" type="button" disabled>HTML 后续版本支持</button>
              <button className="subtab cursor-not-allowed opacity-60" type="button" disabled>PDF 后续版本支持</button>
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-olive">选择导出内容</p>
                <p className="mt-1 text-sm text-sepia">本次勾选什么，就导出什么。详情页里的导出偏好不会影响本次选择。</p>
              </div>
              <span className="text-sm text-copper">已选 {selectedCount} 项</span>
            </div>

            <div className="mt-4 space-y-3">
              {moduleConfig.map((module) => (
                <ExportModule
                  key={module.key}
                  label={module.label}
                  moduleKey={module.key}
                  items={itemMap[module.key]}
                  expanded={expanded[module.key]}
                  selectedIds={selection[module.selectionKey]}
                  onToggleModule={(checked) => toggleModule(module.key, module.selectionKey, checked)}
                  onToggleItem={(id) => toggleItem(module.selectionKey, id)}
                  onSelectAll={() => setModuleSelection(module.selectionKey, itemMap[module.key].map((item) => item.id))}
                  onSelectNone={() => setModuleSelection(module.selectionKey, [])}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-umber/20 pt-4">
            <button className="btn-primary" type="button" disabled={exporting || loading || selectedCount === 0} onClick={exportMarkdown}>
              {exporting ? '正在导出...' : '导出 Markdown'}
            </button>
            {loading ? <span className="text-sm text-sepia">正在读取可导出条目...</span> : null}
            {!loading && selectedCount === 0 ? <span className="text-sm text-spiced">请选择要导出的内容。</span> : null}
          </div>
        </div>

        <div className="paper-panel space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-olive">地图 PNG 导出</p>
              <h3 className="mt-1 font-serif text-xl font-semibold text-ink">将已保存的地图导出为 PNG 图片</h3>
              <p className="mt-1 text-sm text-sepia">导出完整地图画布、底图和可见图层，不包含地图工作台界面。</p>
            </div>
            <span className="text-sm text-copper">已选 {selectedMapIds.length}/{maps.length} 张</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1 text-xs" type="button" disabled={maps.length === 0 || mapExporting} onClick={() => setSelectedMapIds(maps.map((map) => map.id))}>全选</button>
            <button className="btn-ghost px-3 py-1 text-xs" type="button" disabled={selectedMapIds.length === 0 || mapExporting} onClick={() => setSelectedMapIds([])}>全不选</button>
          </div>

          {mapsLoading ? (
            <div className="rounded-md border border-umber/20 bg-batter/40 px-4 py-5 text-sm text-sepia">正在读取地图列表...</div>
          ) : maps.length === 0 ? (
            <div className="rounded-md border border-dashed border-umber/30 bg-batter/40 px-4 py-5 text-sm text-sepia">当前存档还没有可导出的地图。</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {maps.map((map) => (
                <label key={map.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-umber/20 bg-vellum/70 px-3 py-3 text-sm">
                  <input className="mt-1" type="checkbox" checked={selectedMapIds.includes(map.id)} disabled={mapExporting} onChange={() => toggleMap(map.id)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{map.title || '未命名地图'}</span>
                    <span className="mt-1 block text-xs text-sepia">{map.canvasWidth} × {map.canvasHeight}px{map.backgroundAssetUrl ? ' · 已绑定底图' : ' · 无底图'}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-umber/20 pt-4">
            <select
              className="field h-10 w-auto min-w-[10rem]"
              value={mapExportScale}
              disabled={mapExporting}
              onChange={(event) => setMapExportScale(Number(event.target.value) === 2 ? 2 : 1)}
            >
              <option value={1}>标准 PNG（1x）</option>
              <option value={2}>高清 PNG（2x）</option>
            </select>
            <button className="btn-primary" type="button" disabled={mapExporting || mapsLoading || selectedMapIds.length === 0} onClick={() => void exportSelectedMaps()}>
              {mapExporting ? '正在导出地图...' : '导出所选地图 PNG'}
            </button>
            {!mapsLoading && selectedMapIds.length === 0 ? <span className="text-sm text-spiced">请选择要导出的地图。</span> : null}
          </div>
        </div>

        {message ? (
          <div className="rounded-md border border-olive/35 bg-batter/60 px-4 py-3 text-sm text-ink">{message}</div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-spiced/35 bg-[#f0d2bd] px-4 py-3 text-sm text-spiced">{error}</div>
        ) : null}
        {mapMessage ? <div className="rounded-md border border-olive/35 bg-batter/60 px-4 py-3 text-sm text-ink">{mapMessage}</div> : null}
        {mapError ? <div className="rounded-md border border-spiced/35 bg-[#f0d2bd] px-4 py-3 text-sm text-spiced">{mapError}</div> : null}

        <div className="paper-panel">
          <h3 className="font-serif text-xl font-semibold">导出说明</h3>
          <p className="mt-2 text-sm leading-7 text-sepia">
            Markdown 仍只导出本次勾选的资料内容。地图 PNG 使用独立的地图选择和文件保存流程，不会写入 Markdown 文件。
          </p>
        </div>
      </div>
    </Section>
  );
}

function ExportModule({
  label,
  moduleKey,
  items,
  expanded,
  selectedIds,
  onToggleModule,
  onToggleItem,
  onSelectAll,
  onSelectNone
}: {
  label: string;
  moduleKey: ModuleKey;
  items: ExportSummaryItem[];
  expanded: boolean;
  selectedIds: string[];
  onToggleModule: (checked: boolean) => void;
  onToggleItem: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}): JSX.Element {
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const partialSelected = selectedIds.length > 0 && selectedIds.length < items.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partialSelected;
    }
  }, [partialSelected]);

  return (
    <div className="rounded-md border border-umber/25 bg-batter/45">
      <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-3">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={expanded && allSelected}
            onChange={(event) => onToggleModule(event.target.checked)}
          />
          <span className="font-serif text-lg font-semibold text-ink">{label}</span>
        </span>
        <span className="text-xs text-sepia">{selectedIds.length}/{items.length}</span>
      </label>

      {expanded ? (
        <div className="border-t border-umber/20 px-4 pb-4 pt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1 text-xs" type="button" onClick={onSelectAll}>全选</button>
            <button className="btn-ghost px-3 py-1 text-xs" type="button" onClick={onSelectNone}>全不选</button>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-sepia">暂无记录</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-umber/20 bg-vellum/70 px-3 py-2 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => onToggleItem(item.id)}
                  />
                  <span>
                    <span className="block font-medium text-ink">{itemLabel(moduleKey, item)}</span>
                    {moduleKey === 'characters' && 'versions' in item && Array.isArray((item as any).versions) ? (
                      <span className="mt-1 block text-xs text-sepia">
                        {(item as any).versions.map((version: { title: string }) => version.title).join(' / ') || '暂无版本'}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function itemLabel(moduleKey: ModuleKey, item: ExportSummaryItem): string {
  if (moduleKey === 'events') {
    return `${item.storyTime || '时间未注明'}｜${item.title}`;
  }
  if (moduleKey === 'locations' && item.type) {
    return `${item.title}｜${item.type}`;
  }
  if (moduleKey === 'manuscripts') {
    return `${item.title}｜${item.manuscriptTypeLabel || item.manuscriptType || '手稿'}`;
  }
  return item.title;
}
