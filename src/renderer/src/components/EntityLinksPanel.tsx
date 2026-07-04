import { useEffect, useMemo, useRef, useState } from 'react';
import { dataClient } from '../services/dataClient';
import { getCounterpartyEntityId, getCounterpartyEntityType, shouldHideGenericEntityLink } from './entityLinkUtils';

interface EntityLinksPanelProps {
  vaultPath: string;
  ownerEntityType: string;
  ownerEntityId: string;
  allowedTargetTypes: string[];
  editing?: boolean;
  draftLinks?: any[];
  onDraftLinksChange?: (links: any[]) => void;
  manageSignal?: number;
  inlineEditing?: boolean;
}

const linkTypes = ['related', 'mentions', 'happens_at', 'involves'];
const targetTypeLabels: Record<string, string> = {
  character_version: '角色版本',
  codex_item: '词条',
  event: '事件',
  location: '地点',
  manuscript: '手稿',
  timeline: '时间线'
};

export function EntityLinksPanel({
  vaultPath,
  ownerEntityType,
  ownerEntityId,
  allowedTargetTypes,
  editing = false,
  draftLinks,
  onDraftLinksChange,
  manageSignal,
  inlineEditing = false
}: EntityLinksPanelProps): JSX.Element {
  const [links, setLinks] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [targetType, setTargetType] = useState(allowedTargetTypes[0] ?? '');
  const [targetKey, setTargetKey] = useState('');
  const [linkType, setLinkType] = useState('related');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);
  const lastManageSignalRef = useRef(0);

  const visibleLinks = (draftLinks ?? links).filter((link) => !shouldHideGenericEntityLink(link, ownerEntityType, ownerEntityId));
  const linkedTargetKeys = useMemo(() => new Set(visibleLinks.map((link) => {
    return `${getCounterpartyEntityType(link, ownerEntityType, ownerEntityId)}:${getCounterpartyEntityId(link, ownerEntityType, ownerEntityId)}`;
  })), [visibleLinks, ownerEntityType, ownerEntityId]);
  const availableTargetTypes = allowedTargetTypes.filter((type) => targets.some((target) => target.entityType === type));
  const filteredTargets = useMemo(
    () =>
      targets.filter((target) => {
        const key = `${target.entityType}:${target.id}`;
        return target.entityType === targetType && key !== `${ownerEntityType}:${ownerEntityId}` && !linkedTargetKeys.has(key);
      }),
    [targets, targetType, ownerEntityType, ownerEntityId, linkedTargetKeys]
  );

  async function load(): Promise<void> {
    if (!ownerEntityId) return;
    try {
      setError('');
      const [nextLinks, nextTargets] = await Promise.all([
        dataClient.listEntityLinks(vaultPath, ownerEntityType, ownerEntityId),
        dataClient.listLinkTargets(vaultPath)
      ]);
      setLinks(nextLinks);
      setTargets(nextTargets);
      if (!targetType) {
        setTargetType(allowedTargetTypes[0] ?? '');
      }
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    load();
  }, [vaultPath, ownerEntityType, ownerEntityId]);

  useEffect(() => {
    if (!inlineEditing && manageSignal && manageSignal !== lastManageSignalRef.current) {
      setManaging(true);
    }
    lastManageSignalRef.current = manageSignal ?? 0;
  }, [inlineEditing, manageSignal]);

  async function addLink(): Promise<void> {
    const [targetEntityType, targetEntityId] = targetKey.split(':');
    if (!targetEntityType || !targetEntityId) {
      setError('请选择关联目标。');
      return;
    }
    try {
      setError('');
      if (draftLinks && onDraftLinksChange) {
        onDraftLinksChange([
          ...draftLinks,
          {
            id: `draft-${Date.now()}`,
            sourceEntityType: ownerEntityType,
            sourceEntityId: ownerEntityId,
            targetEntityType,
            targetEntityId,
            linkType,
            note
          }
        ]);
        setTargetKey('');
        setNote('');
        setManaging(false);
        return;
      }
      await dataClient.createEntityLink(vaultPath, {
        sourceEntityType: ownerEntityType,
        sourceEntityId: ownerEntityId,
        targetEntityType,
        targetEntityId,
        linkType,
        note
      });
      setTargetKey('');
      setNote('');
      await load();
      setManaging(false);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function deleteLink(id: string): Promise<void> {
    try {
      setError('');
      if (draftLinks && onDraftLinksChange) {
        onDraftLinksChange(draftLinks.filter((link) => link.id !== id));
        return;
      }
      await dataClient.deleteEntityLink(vaultPath, id);
      await load();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function targetTitle(link: any): string {
    const entityType = getCounterpartyEntityType(link, ownerEntityType, ownerEntityId);
    const entityId = getCounterpartyEntityId(link, ownerEntityType, ownerEntityId);
    const target = targets.find((item) => item.entityType === entityType && item.id === entityId);
    return target ? `${targetTypeLabels[entityType] ?? entityType} / ${target.title}` : `${entityType}:${entityId}`;
  }

  function controls(): JSX.Element {
    return (
      <div className="grid gap-3">
        <div className="rounded-md border border-umber/25 bg-vellum/70 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-copper">选择关联目标</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {availableTargetTypes.map((type) => (
              <button
                key={type}
                className={`rounded border px-2 py-1 text-xs transition ${targetType === type ? 'border-copper/60 bg-batter/70 text-copper' : 'border-umber/25 bg-vellum text-sepia'}`}
                onClick={() => {
                  setTargetType(type);
                  setTargetKey('');
                }}
              >
                {targetTypeLabels[type] ?? type}
              </button>
            ))}
          </div>
          <select className="field w-full" value={targetKey} onChange={(event) => setTargetKey(event.target.value)}>
            <option value="">选择关联目标</option>
            {filteredTargets.map((target) => (
              <option key={`${target.entityType}:${target.id}`} value={`${target.entityType}:${target.id}`}>
                {targetTypeLabels[target.entityType] ?? target.entityType} / {target.title}
              </option>
            ))}
          </select>
        </div>
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">关联类型</span>
          <select className="field w-full" value={linkType} onChange={(event) => setLinkType(event.target.value)}>
            {linkTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注，可留空" />
        <button className="btn-primary" onClick={addLink}>添加关联</button>
      </div>
    );
  }

  return (
    <div className="mini-panel">
      <h3>{editing ? '基础关联' : '相关内容'}</h3>
      {error && <p className="mb-3 text-copper">{error}</p>}
      {editing && inlineEditing && <div className="mt-4">{controls()}</div>}
      <div className="mt-4 space-y-2">
        {visibleLinks.length === 0 ? (
          <p>暂无关联。</p>
        ) : (
          visibleLinks.map((link) => (
            <div key={link.id} className="rounded border border-umber/25 bg-vellum/70 p-2">
              <p>{targetTitle(link)}</p>
              <p className="text-xs text-sepia">{link.linkType} {link.note}</p>
              {editing && inlineEditing && (
                <button className="mt-2 rounded border border-umber/30 px-2 py-1 text-xs text-copper" onClick={() => deleteLink(link.id)}>
                  删除关联
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {editing && !inlineEditing && (
        <button className="btn-parchment mt-4 w-full" onClick={() => setManaging(true)}>
          管理关联
        </button>
      )}
      {managing && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-cowhide/35">
          <div className="w-[560px] max-w-[calc(100vw-3rem)] rounded-md border border-umber/40 bg-vellum p-5 shadow-folio">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-sepia/20 pb-3">
              <h2 className="font-serif text-xl font-semibold text-ink">管理关联</h2>
              <button className="btn-ghost" onClick={() => setManaging(false)}>关闭</button>
            </div>
            {controls()}
            <div className="mt-5 space-y-2">
              {visibleLinks.length === 0 ? (
                <p className="text-sepia">暂无关联。</p>
              ) : (
                visibleLinks.map((link) => (
                  <div key={link.id} className="flex items-center justify-between gap-3 rounded border border-umber/25 bg-vellum/70 p-2">
                    <div>
                      <p>{targetTitle(link)}</p>
                      <p className="text-xs text-sepia">{link.linkType} {link.note}</p>
                    </div>
                    <button className="rounded border border-umber/30 px-2 py-1 text-xs text-copper" onClick={() => deleteLink(link.id)}>
                      删除关联
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
