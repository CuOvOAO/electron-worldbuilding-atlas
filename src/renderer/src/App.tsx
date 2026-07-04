import { useState } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import { VaultSelectPage } from './pages/VaultSelectPage';
import { UnsavedChangesProvider } from './components/UnsavedChangesGuard';
import type { Vault } from './types/app';

export function App(): JSX.Element {
  const [activeVault, setActiveVault] = useState<Vault | null>(null);

  if (!activeVault) {
    return <VaultSelectPage onOpenVault={setActiveVault} />;
  }

  return (
    <UnsavedChangesProvider>
      <WorkspacePage vault={activeVault} onBackToVaults={() => setActiveVault(null)} />
    </UnsavedChangesProvider>
  );
}
