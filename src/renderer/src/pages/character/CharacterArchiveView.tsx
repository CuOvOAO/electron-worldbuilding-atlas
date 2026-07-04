import { useEffect, useState } from 'react';
import { useUnsavedChangesGuard } from '../../components/UnsavedChangesGuard';
import { dataClient } from '../../services/dataClient';
import type { NavigationTarget, Vault } from '../../types/app';
import type { CharacterEntity } from '../../types/entities';
import { CharacterDetailView } from './CharacterDetailView';

interface CharacterArchiveViewProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'characters' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

export function CharacterArchiveView({ vault, target, onNavigate }: CharacterArchiveViewProps): JSX.Element {
  const [characters, setCharacters] = useState<CharacterEntity[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<CharacterEntity | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCharacterName, setNewCharacterName] = useState('新角色');
  const { confirmNavigation } = useUnsavedChangesGuard();

  async function loadCharacters(): Promise<void> {
    try {
      setError('');
      const rows = await dataClient.listCharacters(vault.path);
      setCharacters(rows);
      if (target) {
        const requested = rows.find((row) => row.id === target.characterId) ?? null;
        setActiveCharacter(requested);
        if (!requested) setError('该角色不存在或已移入回收站。');
      } else if (activeCharacter) {
        setActiveCharacter(rows.find((row) => row.id === activeCharacter.id) ?? null);
      }
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    loadCharacters();
  }, [vault.path, target?.characterId]);

  async function createCharacter(): Promise<void> {
    try {
      setError('');
      setCreating(true);
      const character = await dataClient.createCharacter(vault.path, { name: newCharacterName, summary: '一句话简介待填写。' });
      setCharacters([character, ...characters]);
      setActiveCharacter(character);
      setCreating(false);
      setNewCharacterName('新角色');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }

  if (activeCharacter) {
    return (
      <CharacterDetailView
        vault={vault}
        character={activeCharacter}
        initialVersionId={target?.characterId === activeCharacter.id ? target.characterVersionId : undefined}
        onBack={() => confirmNavigation(() => setActiveCharacter(null))}
        onChanged={loadCharacters}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-copper/35 bg-batter/50 p-3 text-sm text-copper">{error}</div>}
      <div className="paper-panel">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64">
            <span className="mb-2 block text-sm text-copper">创建角色</span>
            <input className="field w-full" value={newCharacterName} onChange={(event) => setNewCharacterName(event.target.value)} />
          </label>
          <button className="btn-primary" onClick={createCharacter} disabled={creating}>
            {creating ? '创建中' : '创建角色'}
          </button>
        </div>
      </div>
      {characters.length === 0 ? (
        <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">还没有角色。先创建一个角色档案。</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {characters.map((character) => (
            <button key={character.id} className="vault-card min-h-[320px] text-left" onClick={() => confirmNavigation(() => setActiveCharacter(character))}>
              <CharacterImage url={character.avatarAssetUrl} className="mb-4 h-44" />
              <h2 className="font-serif text-3xl font-semibold text-ink">{character.name}</h2>
              <p className="mt-3 leading-7 text-sepia">{character.summary || '一句话简介待填写。'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterImage({ url, className = '' }: { url?: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <div className={`overflow-hidden rounded-md border border-umber/35 bg-batter/50 ${className}`}>
        <img
          className="h-full w-full object-cover"
          src={url}
          alt=""
          onError={() => {
            console.error('角色列表头像加载失败', { url });
            setFailed(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`grid place-items-center rounded-md border border-dashed border-umber/45 bg-batter/50 ${className}`}>
      <svg width="74" height="104" viewBox="0 0 74 104" role="img" aria-label="角色占位剪影">
        <circle cx="37" cy="22" r="18" fill="#1f1712" />
        <path d="M12 100c3-29 15-44 25-44s22 15 25 44H12z" fill="#1f1712" />
      </svg>
    </div>
  );
}
