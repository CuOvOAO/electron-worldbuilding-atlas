import { useEffect, useMemo, useRef, useState } from 'react';
import { AddContentMenu } from '../../components/AddContentMenu';
import { EditableField } from '../../components/EditableField';
import { EditHistoryControls } from '../../components/EditHistoryControls';
import { ReadEditToggle } from '../../components/ReadEditToggle';
import { Section } from '../../components/Section';
import { DragHandle, SortableCardList } from '../../components/SortableCardList';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { useEditDraft } from '../../hooks/useEditDraft';

interface CharacterVersionViewProps {
  characterName: string;
  versionName: string;
  versionDescription: string;
}

interface ExtensionModule {
  id: string;
  key: string;
  label: string;
  value: string;
}

const defaultFields = [
  { key: 'appearance', label: '外貌描述', multiline: true },
  { key: 'personality', label: '性格', multiline: true },
  { key: 'gender', label: '性别' },
  { key: 'age', label: '年龄' },
  { key: 'height', label: '身高' },
  { key: 'race', label: '种族' },
  { key: 'hobby', label: '爱好', multiline: true }
];

const extensionOptions = [
  { key: 'alias', label: '别名 / 代号' },
  { key: 'camp', label: '阵营' },
  { key: 'ability', label: '特殊能力' },
  { key: 'experience', label: '角色经历' },
  { key: 'relationship', label: '关系摘要' },
  { key: 'profile', label: '心理侧写' },
  { key: 'photos', label: '照片墙' },
  { key: 'notes', label: '作者备注' }
];

export function CharacterVersionView({ characterName, versionName, versionDescription }: CharacterVersionViewProps): JSX.Element {
  const initial = {
    appearance: '',
    personality: '',
    gender: '',
    age: '',
    height: '',
    race: '',
    hobby: '',
    modules: [] as ExtensionModule[]
  };
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [recentModuleId, setRecentModuleId] = useState('');
  const recentModuleRef = useRef<HTMLDivElement | null>(null);
  const { setHasUnsavedChanges } = useUnsavedChangesGuard();
  const { draft, setDraft, resetDraft, canUndo, canRedo, undo, redo } = useEditDraft(saved, editing);

  const menuOptions = useMemo(() => {
    const added = new Set(draft.modules.map((module) => module.key));
    return extensionOptions.filter((option) => !added.has(option.key));
  }, [draft.modules]);

  useEffect(() => {
    setHasUnsavedChanges(editing && JSON.stringify(draft) !== JSON.stringify(saved));
    return () => setHasUnsavedChanges(false);
  }, [editing, draft, saved, setHasUnsavedChanges]);

  useEffect(() => {
    if (recentModuleId) {
      recentModuleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [recentModuleId]);

  function cancel(): void {
    resetDraft(saved);
    setRecentModuleId('');
    setEditing(false);
  }

  function save(): void {
    setSaved(draft);
    setRecentModuleId('');
    setEditing(false);
  }

  function addModule(key: string): void {
    const option = extensionOptions.find((item) => item.key === key);
    if (!option) return;
    const id = `${key}-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      modules: [...current.modules, { id, key, label: option.label, value: '' }]
    }), { checkpoint: true });
    setRecentModuleId(id);
  }

  function updateModule(id: string, value: string): void {
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module) => module.id === id ? { ...module, value } : module)
    }));
  }

  function removeModule(id: string): void {
    setDraft((current) => ({
      ...current,
      modules: current.modules.filter((module) => module.id !== id)
    }), { checkpoint: true });
    if (recentModuleId === id) {
      setRecentModuleId('');
    }
  }

  function ModuleTools({ module }: { module: ExtensionModule }): JSX.Element {
    return (
      <div className="flex flex-wrap gap-2">
        <DragHandle />
        <button className="rounded border border-umber/30 px-2 py-1 text-xs text-copper" onClick={() => removeModule(module.id)}>删除</button>
      </div>
    );
  }

  function renderPhotoWall(module: ExtensionModule): JSX.Element {
    return (
      <div className="rounded-md border border-umber/25 bg-vellum/80 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg font-semibold text-ink">{module.label}</h3>
          {editing && <ModuleTools module={module} />}
        </div>
        <div className="grid min-h-56 place-items-center rounded-md border border-dashed border-umber/40 bg-batter/40">
          <div className="text-center text-sm text-sepia">
            <svg className="mx-auto mb-3" width="80" height="92" viewBox="0 0 80 92" role="img" aria-label="图片占位">
              <rect x="8" y="12" width="64" height="52" rx="4" fill="none" stroke="#442D1C" strokeWidth="4" />
              <circle cx="28" cy="30" r="7" fill="#442D1C" />
              <path d="M14 58l18-18 12 12 9-10 13 16H14z" fill="#442D1C" />
            </svg>
            <p>{module.value || '还没有添加图片'}</p>
            <p className="mt-1 text-xs">图片上传功能预留</p>
          </div>
        </div>
        {editing && <button className="btn-parchment mt-3" onClick={() => updateModule(module.id, '图片上传功能预留')}>添加图片</button>}
      </div>
    );
  }

  function renderModule(module: ExtensionModule): JSX.Element | null {
    if (!editing && !module.value) return null;
    if (module.key === 'photos') {
      return renderPhotoWall(module);
    }
    return (
      <div className="rounded-md border border-umber/25 bg-vellum/80 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg font-semibold text-ink">{module.label}</h3>
          {editing && <ModuleTools module={module} />}
        </div>
        {editing ? (
          <EditableField value={module.value} editing={editing} onChange={(value) => updateModule(module.id, value)} multiline />
        ) : (
          <p className="whitespace-pre-line leading-7 text-sepia">{module.value}</p>
        )}
      </div>
    );
  }

  return (
    <Section
      title={`${characterName} / ${versionName} / 版本信息纸`}
      aside={
        <div className="flex items-center gap-2">
          {editing && <EditHistoryControls canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
          <ReadEditToggle editing={editing} onEdit={() => setEditing(true)} onSave={save} onCancel={cancel} />
        </div>
      }
    >
      <div className="mb-5 rounded-md border border-umber/25 bg-vellum/75 p-4">
        <h3 className="font-serif text-lg font-semibold text-ink">基础信息</h3>
        <p className="mt-2 text-sm leading-6 text-sepia">版本名称：{versionName}</p>
        {versionDescription && <p className="mt-1 text-sm leading-6 text-sepia">版本描述：{versionDescription}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {defaultFields.map((field) => {
          const value = draft[field.key as keyof typeof draft] as string;
          if (!editing && !value) return null;
          return (
            <div key={field.key} className="rounded-md border border-umber/25 bg-vellum/75 p-4">
              <EditableField
                label={field.label}
                value={value}
                editing={editing}
                onChange={(nextValue) => setDraft((current) => ({ ...current, [field.key]: nextValue }))}
                multiline={field.multiline}
              />
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="my-5">
          <AddContentMenu options={menuOptions} onSelect={addModule} />
        </div>
      )}

      <SortableCardList
        items={draft.modules}
        getId={(module) => module.id}
        disabled={!editing}
        onReorder={(modules) => setDraft((current) => ({ ...current, modules }), { checkpoint: true })}
        className="grid gap-4 md:grid-cols-2"
        itemClassName={(module) => module.key === 'photos' ? 'md:col-span-2' : ''}
        renderItem={(module) => (
          <div ref={module.id === recentModuleId ? recentModuleRef : undefined}>
            {renderModule(module)}
          </div>
        )}
      />
    </Section>
  );
}
