import { useEffect, useState } from 'react';
import type { NavigationTarget, Vault } from '../types/app';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { CharacterArchiveView } from './character/CharacterArchiveView';
import { CharacterRelationView } from './character/CharacterRelationView';

type CharacterView = 'archive' | 'relations';

interface CharacterPageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'characters' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

export function CharacterPage({ vault, target, onNavigate }: CharacterPageProps): JSX.Element {
  const [view, setView] = useState<CharacterView>('archive');
  const { confirmNavigation } = useUnsavedChangesGuard();

  useEffect(() => {
    if (target) {
      setView('archive');
    }
  }, [target]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button className={`subtab ${view === 'archive' ? 'subtab-active' : ''}`} onClick={() => confirmNavigation(() => setView('archive'))}>
          角色档案
        </button>
        <button className={`subtab ${view === 'relations' ? 'subtab-active' : ''}`} onClick={() => confirmNavigation(() => setView('relations'))}>
          关系网络
        </button>
      </div>
      {view === 'archive' ? <CharacterArchiveView vault={vault} target={target} onNavigate={onNavigate} /> : <CharacterRelationView vault={vault} onNavigate={onNavigate} />}
    </div>
  );
}
