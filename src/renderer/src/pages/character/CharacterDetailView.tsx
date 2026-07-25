import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { EditableField } from '../../components/EditableField';
import { MapAssociationsSection } from '../../components/MapAssociationsSection';
import { ReadEditToggle } from '../../components/ReadEditToggle';
import { Section } from '../../components/Section';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { assetClient, type AssetRecord } from '../../services/assetClient';
import { dataClient } from '../../services/dataClient';
import type { NavigationTarget, Vault } from '../../types/app';
import type { CharacterEntity, CharacterVersionEntity } from '../../types/entities';
import { CharacterVersionView } from './CharacterVersionView';

interface CharacterDetailViewProps {
  vault: Vault;
  character: CharacterEntity;
  initialVersionId?: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onNavigate: (target: NavigationTarget) => void;
}

interface CharacterDraft {
  name: string;
  summary: string;
  avatarAssetId: string | null;
  avatarAssetUrl: string;
  fullBodyAssetId: string | null;
  fullBodyAssetUrl: string;
}

type AssetSlot = 'avatar' | 'fullBody';
type CropPreset = '1:1' | 'free' | '2:3' | '3:4' | '9:16' | 'original';

const cropPresetsBySlot: Record<AssetSlot, readonly CropPreset[]> = {
  avatar: ['1:1'],
  fullBody: ['free', '2:3', '3:4', '9:16', 'original']
};

export function CharacterDetailView({ vault, character, initialVersionId, onBack, onChanged, onNavigate }: CharacterDetailViewProps): JSX.Element {
  const initialDraft = characterDraft(character);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CharacterDraft>(initialDraft);
  const [saved, setSaved] = useState<CharacterDraft>(initialDraft);
  const [versions, setVersions] = useState<CharacterVersionEntity[]>([]);
  const [activeVersionId, setActiveVersionId] = useState('');
  const [newVersionName, setNewVersionName] = useState('新建版本');
  const [versionDraft, setVersionDraft] = useState({ name: '', description: '' });
  const [assetPickerSlot, setAssetPickerSlot] = useState<AssetSlot | null>(null);
  const [cropRequest, setCropRequest] = useState<{ slot: AssetSlot; asset: AssetRecord } | null>(null);
  const [error, setError] = useState('');
  const [versionMapLinks, setVersionMapLinks] = useState<any[]>([]);
  const { setHasUnsavedChanges, confirmNavigation, confirmDanger } = useUnsavedChangesGuard();

  async function loadVersions(): Promise<void> {
    try {
      setError('');
      const rows = await dataClient.getCharacterVersions(vault.path, character.id);
      setVersions(rows);
      const requestedExists = initialVersionId && rows.some((version) => version.id === initialVersionId);
      if (initialVersionId && !requestedExists) setError('该角色版本不存在或已移入回收站。');
      setActiveVersionId((current) =>
        (requestedExists ? initialVersionId : '')
        || (rows.some((version) => version.id === current) ? current : '')
        || rows[0]?.id
        || ''
      );
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    const nextDraft = characterDraft(character);
    setDraft(nextDraft);
    setSaved(nextDraft);
    setActiveVersionId('');
    loadVersions();
  }, [character.id, vault.path, initialVersionId]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  function cancel(): void {
    setDraft(saved);
    setEditing(false);
  }

  async function save(): Promise<void> {
    try {
      setError('');
      await dataClient.updateCharacter(vault.path, {
        id: character.id,
        name: draft.name,
        summary: draft.summary,
        avatarAssetId: draft.avatarAssetId,
        fullBodyAssetId: draft.fullBodyAssetId
      });
      setSaved(draft);
      setEditing(false);
      await onChanged();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function importIntoSlot(slot: AssetSlot): Promise<void> {
    try {
      setError('');
      const asset = await assetClient.importImage(vault.path);
      if (asset) {
        setAssetPickerSlot(null);
        setCropRequest({ slot, asset });
      }
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function applyAsset(slot: AssetSlot, asset: AssetRecord): void {
    if (slot === 'avatar') {
      setDraft((current) => ({ ...current, avatarAssetId: asset.id, avatarAssetUrl: asset.url }));
    } else {
      setDraft((current) => ({ ...current, fullBodyAssetId: asset.id, fullBodyAssetUrl: asset.url }));
    }
    setAssetPickerSlot(null);
    setCropRequest(null);
  }

  async function saveCroppedAsset(slot: AssetSlot, sourceAsset: AssetRecord, dataUrl: string): Promise<void> {
    try {
      setError('');
      const cropped = await assetClient.saveCroppedImage(vault.path, {
        dataUrl,
        slot,
        originalName: `${slot === 'avatar' ? '头像裁剪' : '立绘裁剪'}_${sourceAsset.originalName}`
      });
      applyAsset(slot, cropped);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function removeAsset(slot: AssetSlot): void {
    if (slot === 'avatar') {
      setDraft((current) => ({ ...current, avatarAssetId: null, avatarAssetUrl: '' }));
    } else {
      setDraft((current) => ({ ...current, fullBodyAssetId: null, fullBodyAssetUrl: '' }));
    }
  }

  async function createVersion(): Promise<void> {
    try {
      setError('');
      const version = await dataClient.createCharacterVersion(vault.path, {
        characterId: character.id,
        name: newVersionName,
        description: '新版本描述待填写。'
      });
      setVersions([...versions, version]);
      setActiveVersionId(version.id);
      setNewVersionName('新建版本');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? versions[0];

  useEffect(() => {
    if (activeVersion) {
      setVersionDraft({ name: activeVersion.name, description: activeVersion.description ?? '' });
      dataClient.listEntityMapLinks(vault.path, 'character_version', activeVersion.id).then(setVersionMapLinks).catch((cause) => {
        console.error(cause);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    } else {
      setVersionMapLinks([]);
    }
  }, [activeVersion?.id, vault.path]);

  async function saveVersionMeta(): Promise<void> {
    if (!activeVersion) return;
    await dataClient.updateCharacterVersion(vault.path, {
      id: activeVersion.id,
      characterId: character.id,
      name: versionDraft.name,
      description: versionDraft.description
    });
    await loadVersions();
  }

  async function deleteVersion(): Promise<void> {
    if (!activeVersion) return;
    if (!await confirmDanger('确定要将这个角色版本移入回收站吗？该资料将移入回收站，可在回收站中恢复。', '移入回收站')) {
      return;
    }
    await dataClient.deleteCharacterVersion(vault.path, { id: activeVersion.id, characterId: character.id });
    const nextVersions = versions.filter((version) => version.id !== activeVersion.id);
    setVersions(nextVersions);
    setActiveVersionId(nextVersions[0]?.id ?? '');
  }

  async function deleteCharacter(): Promise<void> {
    if (!await confirmDanger(`确定要将“${draft.name}”移入回收站吗？该资料将移入回收站，可在回收站中恢复。`, '移入回收站')) return;
    await dataClient.deleteCharacter(vault.path, character.id);
    await onChanged();
    onBack();
  }

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
      <Section
        title="角色档案袋"
        aside={<ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={cancel} />}
      >
        <button className="btn-ghost mb-5" onClick={() => confirmNavigation(onBack)}>
          返回角色列表
        </button>
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="space-y-4">
            <CharacterAssetBox
              title="头像"
              url={draft.avatarAssetUrl}
              cropPresets={cropPresetsBySlot.avatar}
              editing={editing}
              onImport={() => importIntoSlot('avatar')}
              onChoose={() => setAssetPickerSlot('avatar')}
              onRemove={() => removeAsset('avatar')}
            />
            <CharacterAssetBox
              title="立绘"
              url={draft.fullBodyAssetUrl}
              cropPresets={cropPresetsBySlot.fullBody}
              tall
              editing={editing}
              onImport={() => importIntoSlot('fullBody')}
              onChoose={() => setAssetPickerSlot('fullBody')}
              onRemove={() => removeAsset('fullBody')}
            />
          </div>
          <div className="space-y-4">
            <EditableField label="角色基础信息 / 姓名" value={draft.name} editing={editing} onChange={(value) => setDraft({ ...draft, name: value })} />
            <EditableField label="一句话简介" value={draft.summary} editing={editing} onChange={(value) => setDraft({ ...draft, summary: value })} multiline />
            {editing && <button className="btn-ghost" onClick={deleteCharacter}>删除角色</button>}
          </div>
        </div>
      </Section>

      <Section title="角色版本文件夹">
        <div className="flex flex-wrap gap-3">
          {versions.map((version) => (
            <button
              key={version.id}
              className={`btn-parchment ${activeVersion?.id === version.id ? 'border-copper/70 bg-batter/70 text-copper' : ''}`}
              onClick={() => confirmNavigation(() => setActiveVersionId(version.id))}
            >
              {version.name}
            </button>
          ))}
          {editing && <input className="field" value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} />}
          {editing && (
            <button className="btn-parchment" onClick={createVersion}>
              + 新建版本
            </button>
          )}
        </div>
        {editing && activeVersion && (
          <div className="mt-4 grid gap-3 rounded-md border border-umber/25 bg-vellum/70 p-3 md:grid-cols-[1fr_1.4fr_auto_auto]">
            <input className="field" value={versionDraft.name} onChange={(event) => setVersionDraft({ ...versionDraft, name: event.target.value })} />
            <input className="field" value={versionDraft.description} onChange={(event) => setVersionDraft({ ...versionDraft, description: event.target.value })} placeholder="版本描述" />
            <button className="btn-parchment" onClick={saveVersionMeta}>保存版本信息</button>
            <button className="btn-ghost" onClick={deleteVersion}>删除版本</button>
          </div>
        )}
      </Section>

      {activeVersion ? (
        <>
          <CharacterVersionView key={`${saved.name}-${activeVersion.id}`} characterName={saved.name} versionName={activeVersion.name} versionDescription={activeVersion.description ?? ''} />
          {!editing && <MapAssociationsSection items={versionMapLinks} onOpen={onNavigate} />}
        </>
      ) : (
        <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无角色版本。</div>
      )}

      {assetPickerSlot ? (
        <AssetPicker
          vaultPath={vault.path}
          slotLabel={assetPickerSlot === 'avatar' ? '头像' : '立绘'}
          onClose={() => setAssetPickerSlot(null)}
          onSelect={(asset) => applyAsset(assetPickerSlot, asset)}
          onCrop={(asset) => {
            setCropRequest({ slot: assetPickerSlot, asset });
            setAssetPickerSlot(null);
          }}
          onImport={() => importIntoSlot(assetPickerSlot)}
          onDelete={async (asset) => {
            const message = asset.usedCount > 0
              ? '该图片正在被角色或地图使用，删除后相关位置会恢复占位。是否继续？'
              : `确定要删除“${asset.originalName}”吗？`;
            if (!await confirmDanger(message)) return;
            await assetClient.deleteAsset(vault.path, asset.id);
          }}
        />
      ) : null}

      {cropRequest ? (
        <ImageCropModal
          asset={cropRequest.asset}
          slot={cropRequest.slot}
          onClose={() => setCropRequest(null)}
          onConfirm={(dataUrl) => saveCroppedAsset(cropRequest.slot, cropRequest.asset, dataUrl)}
        />
      ) : null}
    </div>
  );
}

function characterDraft(character: CharacterEntity): CharacterDraft {
  return {
    name: character.name,
    summary: character.summary,
    avatarAssetId: character.avatarAssetId ?? null,
    avatarAssetUrl: character.avatarAssetUrl ?? '',
    fullBodyAssetId: character.fullBodyAssetId ?? null,
    fullBodyAssetUrl: character.fullBodyAssetUrl ?? ''
  };
}

function CharacterAssetBox({
  title,
  url,
  cropPresets,
  editing,
  tall = false,
  onImport,
  onChoose,
  onRemove
}: {
  title: string;
  url: string;
  cropPresets: readonly CropPreset[];
  editing: boolean;
  tall?: boolean;
  onImport: () => void;
  onChoose: () => void;
  onRemove: () => void;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const hasImage = url && !failed;

  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <div className="rounded-md border border-umber/30 bg-batter/45 p-3">
      <div
        className={`mb-3 overflow-hidden rounded-md border border-dashed border-umber/45 bg-vellum ${tall ? 'h-72' : 'h-44'}`}
        data-crop-presets={cropPresets.join(',')}
      >
        {hasImage ? (
          <img
            className={`h-full w-full ${tall ? 'object-contain' : 'object-cover'}`}
            src={url}
            alt={title}
            onError={() => {
              console.error('角色图片加载失败', { title, url });
              setFailed(true);
            }}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <svg width="78" height="108" viewBox="0 0 78 108" role="img" aria-label={`${title}占位剪影`}>
              <circle cx="39" cy="24" r="18" fill="#1f1712" />
              <path d="M13 104c4-31 16-48 26-48s23 17 26 48H13z" fill="#1f1712" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-serif text-lg font-semibold">{title}</span>
        {editing ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={onImport}>{url ? '更换' : '上传'}</button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={onChoose}>素材库</button>
            {url ? <button className="btn-ghost px-2 py-1 text-xs" onClick={onRemove}>移除</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssetPicker({
  vaultPath,
  slotLabel,
  onClose,
  onSelect,
  onCrop,
  onImport,
  onDelete
}: {
  vaultPath: string;
  slotLabel: string;
  onClose: () => void;
  onSelect: (asset: AssetRecord) => void;
  onCrop: (asset: AssetRecord) => void;
  onImport: () => void;
  onDelete: (asset: AssetRecord) => Promise<void>;
}): JSX.Element {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError('');
      setAssets(await assetClient.listImages(vaultPath));
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [vaultPath]);

  async function deleteAsset(asset: AssetRecord): Promise<void> {
    try {
      await onDelete(asset);
      await load();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-cowhide/35 p-6">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-auto rounded-md border border-umber/35 bg-vellum p-5 shadow-folio">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl font-semibold">选择{slotLabel}</h3>
            <p className="text-sm text-sepia">从当前存档已导入的图片素材中选择。</p>
          </div>
          <button className="btn-ghost" onClick={onClose}>取消</button>
        </div>

        {error ? <div className="mb-3 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div> : null}
        <div className="mb-4 flex gap-2">
          <button className="btn-primary" onClick={onImport}>导入新图片</button>
          <button className="btn-ghost" onClick={load} disabled={loading}>{loading ? '刷新中' : '刷新素材库'}</button>
        </div>

        {assets.length === 0 ? (
          <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">暂无图片素材</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {assets.map((asset) => (
              <div key={asset.id} className="rounded-md border border-umber/25 bg-batter/45 p-2">
                <button className="block w-full overflow-hidden rounded-md border border-umber/20 bg-vellum" onClick={() => onSelect(asset)}>
                  <AssetThumbnail asset={asset} />
                </button>
                <p className="mt-2 truncate text-sm text-ink">{asset.originalName}</p>
                <div className="mt-2 flex flex-wrap justify-between gap-2">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onSelect(asset)}>直接选择</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onCrop(asset)}>裁剪使用</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => deleteAsset(asset)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetThumbnail({ asset }: { asset: AssetRecord }): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [asset.url]);

  if (asset.fileExists === false || !asset.url) {
    return <div className="grid h-32 place-items-center text-sm text-sepia">图片文件缺失</div>;
  }

  if (failed) {
    return <div className="grid h-32 place-items-center text-sm text-sepia">图片无法加载</div>;
  }

  return (
    <img
      className="h-32 w-full object-cover"
      src={asset.url}
      alt={asset.originalName}
      onError={() => {
        console.error('素材缩略图加载失败', { assetId: asset.id, relativePath: asset.relativePath, url: asset.url });
        setFailed(true);
      }}
    />
  );
}

function ImageCropModal({
  asset,
  slot,
  onClose,
  onConfirm
}: {
  asset: AssetRecord;
  slot: AssetSlot;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void | Promise<void>;
}): JSX.Element {
  const [preset, setPreset] = useState<CropPreset>(slot === 'avatar' ? '1:1' : 'original');
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [freeSize, setFreeSize] = useState({ width: 360, height: 320 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const imageAspect = naturalSize.width && naturalSize.height ? naturalSize.width / naturalSize.height : 1;
  const frame = cropFrameSize(slot, preset, imageAspect, freeSize);
  const metrics = cropMetrics(naturalSize, frame, zoom, offset);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [preset, asset.id]);

  useEffect(() => {
    if (naturalSize.width && naturalSize.height) {
      setOffset((current) => clampOffset(current, naturalSize, frame, zoom));
    }
  }, [naturalSize.width, naturalSize.height, frame.width, frame.height, zoom]);

  function updateOffset(next: { x: number; y: number }): void {
    setOffset(clampOffset(next, naturalSize, frame, zoom));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    updateOffset({
      x: dragStart.offsetX + event.clientX - dragStart.x,
      y: dragStart.offsetY + event.clientY - dragStart.y
    });
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>): void {
    if (dragStart?.pointerId === event.pointerId) {
      setDragStart(null);
    }
  }

  async function confirmCrop(): Promise<void> {
    try {
      setSaving(true);
      setError('');
      const dataUrl = await createCroppedDataUrl(asset.url, naturalSize, frame, zoom, offset, slot);
      await onConfirm(dataUrl);
    } catch (cause) {
      console.error('裁剪失败', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/45 p-5">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-md border border-umber/35 bg-vellum p-5 shadow-folio">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl font-semibold">{slot === 'avatar' ? '裁剪头像' : '裁剪立绘'}</h3>
            <p className="text-sm text-sepia">拖动图片调整位置，使用缩放控制裁剪范围。</p>
          </div>
          <button className="btn-ghost" onClick={onClose} disabled={saving}>取消</button>
        </div>

        {error ? <div className="mb-3 rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div> : null}

        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="grid min-h-[430px] place-items-center rounded-md border border-umber/25 bg-batter/35 p-4">
            <div
              ref={frameRef}
              className="relative cursor-grab overflow-hidden rounded-md border-2 border-copper/80 bg-cowhide/10 active:cursor-grabbing"
              style={{ width: frame.width, height: frame.height }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
            >
              {asset.url ? (
                <img
                  crossOrigin="anonymous"
                  src={asset.url}
                  alt={asset.originalName}
                  className="absolute max-w-none select-none"
                  draggable={false}
                  style={{
                    left: `${frame.width / 2 + offset.x}px`,
                    top: `${frame.height / 2 + offset.y}px`,
                    width: `${metrics.displayedWidth}px`,
                    height: `${metrics.displayedHeight}px`,
                    transform: 'translate(-50%, -50%)'
                  }}
                  onLoad={(event) => {
                    setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                  }}
                  onError={() => setError('图片读取失败，无法裁剪。')}
                />
              ) : (
                <div className="grid h-full place-items-center text-sm text-sepia">图片文件缺失</div>
              )}
              <div className="pointer-events-none absolute inset-0 border border-vellum/70 shadow-[inset_0_0_0_9999px_rgba(68,45,28,0.08)]" />
            </div>
          </div>

          <div className="space-y-4 rounded-md border border-umber/25 bg-batter/40 p-4">
            <div>
              <p className="mb-2 text-sm font-semibold text-copper">比例</p>
              <div className="flex flex-wrap gap-2">
                {cropPresetsBySlot[slot].map((item) => (
                  <button
                    key={item}
                    className={`btn-ghost px-3 py-1 text-xs ${preset === item ? 'border-copper/70 bg-batter text-copper' : ''}`}
                    onClick={() => setPreset(item)}
                    disabled={slot === 'avatar' && item !== '1:1'}
                  >
                    {cropPresetLabel(item)}
                  </button>
                ))}
              </div>
            </div>

            {slot === 'fullBody' && preset === 'free' ? (
              <div className="space-y-3">
                <label className="block text-sm text-sepia">
                  裁剪宽度
                  <input className="mt-2 w-full" type="range" min="260" max="460" value={freeSize.width} onChange={(event) => setFreeSize({ ...freeSize, width: Number(event.target.value) })} />
                </label>
                <label className="block text-sm text-sepia">
                  裁剪高度
                  <input className="mt-2 w-full" type="range" min="240" max="420" value={freeSize.height} onChange={(event) => setFreeSize({ ...freeSize, height: Number(event.target.value) })} />
                </label>
              </div>
            ) : null}

            <label className="block text-sm text-sepia">
              缩放
              <input className="mt-2 w-full" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>

            <div className="rounded-md border border-dashed border-umber/30 bg-vellum/70 p-3 text-xs leading-6 text-sepia">
              原图会保留在素材库中。确认后会生成一张新的 PNG 裁剪素材，并暂时绑定到当前角色草稿。
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose} disabled={saving}>取消</button>
              <button className="btn-primary" onClick={confirmCrop} disabled={saving || !naturalSize.width}>{saving ? '保存中' : '确认使用'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function cropPresetLabel(preset: CropPreset): string {
  const labels: Record<CropPreset, string> = {
    '1:1': '1:1',
    free: '自由',
    '2:3': '2:3',
    '3:4': '3:4',
    '9:16': '9:16',
    original: '原图'
  };
  return labels[preset];
}

function cropFrameSize(slot: AssetSlot, preset: CropPreset, imageAspect: number, freeSize: { width: number; height: number }): { width: number; height: number } {
  if (slot === 'avatar') {
    return { width: 360, height: 360 };
  }
  if (preset === 'free') {
    return freeSize;
  }
  const aspect = preset === 'original' ? imageAspect : presetAspect(preset);
  const maxWidth = 460;
  const maxHeight = 420;
  if (maxWidth / maxHeight > aspect) {
    return { width: Math.round(maxHeight * aspect), height: maxHeight };
  }
  return { width: maxWidth, height: Math.round(maxWidth / aspect) };
}

function presetAspect(preset: CropPreset): number {
  if (preset === '2:3') return 2 / 3;
  if (preset === '3:4') return 3 / 4;
  if (preset === '9:16') return 9 / 16;
  return 1;
}

function cropMetrics(naturalSize: { width: number; height: number }, frame: { width: number; height: number }, zoom: number, offset: { x: number; y: number }): { displayedWidth: number; displayedHeight: number; left: number; top: number } {
  if (!naturalSize.width || !naturalSize.height) {
    return { displayedWidth: frame.width, displayedHeight: frame.height, left: 0, top: 0 };
  }
  const baseScale = Math.max(frame.width / naturalSize.width, frame.height / naturalSize.height);
  const displayedWidth = naturalSize.width * baseScale * zoom;
  const displayedHeight = naturalSize.height * baseScale * zoom;
  return {
    displayedWidth,
    displayedHeight,
    left: frame.width / 2 - displayedWidth / 2 + offset.x,
    top: frame.height / 2 - displayedHeight / 2 + offset.y
  };
}

function clampOffset(offset: { x: number; y: number }, naturalSize: { width: number; height: number }, frame: { width: number; height: number }, zoom: number): { x: number; y: number } {
  const metrics = cropMetrics(naturalSize, frame, zoom, { x: 0, y: 0 });
  const maxX = Math.max(0, (metrics.displayedWidth - frame.width) / 2);
  const maxY = Math.max(0, (metrics.displayedHeight - frame.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y))
  };
}

async function createCroppedDataUrl(
  url: string,
  naturalSize: { width: number; height: number },
  frame: { width: number; height: number },
  zoom: number,
  offset: { x: number; y: number },
  slot: AssetSlot
): Promise<string> {
  if (!url || !naturalSize.width || !naturalSize.height) {
    throw new Error('图片尚未加载完成。');
  }
  const image = await loadImage(url);
  const metrics = cropMetrics(naturalSize, frame, zoom, offset);
  const sourceX = Math.max(0, (-metrics.left / metrics.displayedWidth) * naturalSize.width);
  const sourceY = Math.max(0, (-metrics.top / metrics.displayedHeight) * naturalSize.height);
  const sourceWidth = Math.min(naturalSize.width - sourceX, (frame.width / metrics.displayedWidth) * naturalSize.width);
  const sourceHeight = Math.min(naturalSize.height - sourceY, (frame.height / metrics.displayedHeight) * naturalSize.height);
  const output = outputSize(slot, frame.width / frame.height);
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法创建裁剪画布。');
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  return canvas.toDataURL('image/png');
}

function outputSize(slot: AssetSlot, aspect: number): { width: number; height: number } {
  if (slot === 'avatar') {
    return { width: 512, height: 512 };
  }
  const max = 1200;
  if (aspect >= 1) {
    return { width: max, height: Math.max(1, Math.round(max / aspect)) };
  }
  return { width: Math.max(1, Math.round(max * aspect)), height: max };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败，无法导出裁剪结果。'));
    image.src = url;
  });
}

