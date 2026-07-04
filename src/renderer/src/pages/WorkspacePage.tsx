import { useState } from 'react';
import { WorkspaceLayout } from '../layouts/WorkspaceLayout';
import type { ModuleKey, NavigationTarget, Vault } from '../types/app';
import { CharacterPage } from './CharacterPage';
import { CodexPage } from './CodexPage';
import { EventPage } from './EventPage';
import { ExportPage } from './ExportPage';
import { HomePage } from './HomePage';
import { LocationPage } from './LocationPage';
import { ManuscriptPage } from './ManuscriptPage';
import { SettingsPage } from './SettingsPage';
import { TimelinePage } from './TimelinePage';
import { TrashPage } from './TrashPage';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';

interface WorkspacePageProps {
  vault: Vault;
  onBackToVaults: () => void;
}

export function WorkspacePage({ vault, onBackToVaults }: WorkspacePageProps): JSX.Element {
  const [activeModule, setActiveModule] = useState<ModuleKey>('home');
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const { confirmNavigation } = useUnsavedChangesGuard();

  function navigateToTarget(target: NavigationTarget): void {
    confirmNavigation(() => {
      setNavigationTarget(target);
      setActiveModule(target.module);
    });
  }

  function changeModule(module: ModuleKey): void {
    confirmNavigation(() => {
      setNavigationTarget(null);
      setActiveModule(module);
    });
  }

  const pageMap: Record<ModuleKey, JSX.Element> = {
    home: <HomePage vault={vault} onChangeModule={changeModule} onNavigate={navigateToTarget} />,
    characters: <CharacterPage vault={vault} target={navigationTarget?.module === 'characters' ? navigationTarget : null} onNavigate={navigateToTarget} />,
    codex: <CodexPage vault={vault} target={navigationTarget?.module === 'codex' ? navigationTarget : null} onNavigate={navigateToTarget} />,
    events: <EventPage vault={vault} target={navigationTarget?.module === 'events' ? navigationTarget : null} onNavigate={navigateToTarget} />,
    locations: <LocationPage vault={vault} target={navigationTarget?.module === 'locations' ? navigationTarget : null} onNavigate={navigateToTarget} />,
    timeline: <TimelinePage vault={vault} target={navigationTarget?.module === 'timeline' ? navigationTarget : null} onNavigate={navigateToTarget} />,
    manuscripts: <ManuscriptPage vault={vault} target={navigationTarget?.module === 'manuscripts' ? navigationTarget : null} />,
    export: <ExportPage vault={vault} />,
    settings: <SettingsPage vault={vault} />,
    trash: <TrashPage vault={vault} />
  };

  return (
    <WorkspaceLayout
      vault={vault}
      activeModule={activeModule}
      onChangeModule={changeModule}
      onBackToVaults={() => confirmNavigation(onBackToVaults)}
      onNavigate={navigateToTarget}
    >
      {pageMap[activeModule]}
    </WorkspaceLayout>
  );
}
