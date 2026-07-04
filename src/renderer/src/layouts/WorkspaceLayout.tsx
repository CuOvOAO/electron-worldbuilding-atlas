import { useEffect, useState, type ReactNode } from 'react';
import { AtlasMark } from '../components/AtlasMark';
import { GlobalSearch } from '../components/GlobalSearch';
import { modules } from '../mock/data';
import type { ModuleKey, NavigationTarget, Vault } from '../types/app';

interface WorkspaceLayoutProps {
  vault: Vault;
  activeModule: ModuleKey;
  onChangeModule: (module: ModuleKey) => void;
  onBackToVaults: () => void;
  onNavigate: (target: NavigationTarget) => void;
  children: ReactNode;
}

export function WorkspaceLayout({
  vault,
  activeModule,
  onChangeModule,
  onBackToVaults,
  onNavigate,
  children
}: WorkspaceLayoutProps): JSX.Element {
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let timer = 0;
    function handleNotice(event: Event): void {
      const message = String((event as CustomEvent<string>).detail || '');
      if (!message) return;
      setNotice(message);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotice(''), 2400);
    }
    window.addEventListener('atlas:notice', handleNotice);
    return () => {
      window.removeEventListener('atlas:notice', handleNotice);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="ma-app-shell min-h-screen bg-parchment text-ink">
      <header className="relative z-30 flex h-[5.4rem] items-center justify-between border-b border-umber/30 bg-[rgba(241,225,189,0.88)] px-6 shadow-[0_1px_0_rgba(255,248,232,0.45)] backdrop-blur">
        <div className="flex items-center gap-4">
          <AtlasMark />
          <div className="ma-title-block">
            <p className="ma-eyebrow">Current Vault</p>
            <h1 className="ma-title-main">{vault.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <GlobalSearch vault={vault} onNavigate={onNavigate} />
          <button className="btn-ghost" onClick={onBackToVaults}>
            返回存档
          </button>
        </div>
      </header>

      <main className="h-[calc(100vh-8.4rem)] overflow-auto px-5 pb-5 pt-4">{children}</main>
      {notice ? (
        <div className="fixed bottom-16 left-1/2 z-40 -translate-x-1/2 rounded-md border border-olive/35 bg-vellum px-4 py-2 text-sm text-olive shadow-folio">
          {notice}
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 flex h-[3rem] items-end border-t border-umber/30 bg-[rgba(233,213,168,0.92)] px-4 backdrop-blur">
        {modules.map((module) => (
          <button
            key={module.key}
            className={`sheet-tab ${activeModule === module.key ? 'sheet-tab-active' : ''}`}
            onClick={() => onChangeModule(module.key)}
          >
            {module.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
