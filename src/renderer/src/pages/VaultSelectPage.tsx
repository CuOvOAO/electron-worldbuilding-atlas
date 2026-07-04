import { useEffect, useState } from 'react';
import { AtlasMark } from '../components/AtlasMark';
import { vaultClient } from '../services/vaultClient';
import type { Vault } from '../types/app';

interface VaultSelectPageProps {
  onOpenVault: (vault: Vault) => void;
}

export function VaultSelectPage({ onOpenVault }: VaultSelectPageProps): JSX.Element {
  const [recentVaults, setRecentVaults] = useState<Vault[]>([]);
  const [name, setName] = useState('新世界观');
  const [description, setDescription] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    vaultClient
      .listRecent()
      .then(setRecentVaults)
      .catch((cause) => {
        console.error(cause);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  async function chooseParentDir(): Promise<void> {
    const selected = await vaultClient.chooseDirectory();
    if (selected) {
      setParentDir(selected);
    }
  }

  async function createVault(): Promise<void> {
    setError('');
    if (!parentDir) {
      setError('请先选择存档存放位置。');
      return;
    }

    setLoading(true);
    try {
      const vault = await vaultClient.create({ parentDir, name, description });
      onOpenVault(vault);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function openVaultDialog(): Promise<void> {
    setError('');
    setLoading(true);
    try {
      const vault = await vaultClient.openDialog();
      if (vault) {
        onOpenVault(vault);
      }
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function openRecent(vaultPath: string): Promise<void> {
    setError('');
    setLoading(true);
    try {
      const vault = await vaultClient.openPath(vaultPath);
      onOpenVault(vault);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="ma-app-shell min-h-screen bg-parchment px-8 py-10 text-ink">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex items-start justify-between gap-6 border-b border-umber/20 pb-8">
          <div className="flex items-start gap-4">
            <AtlasMark />
            <div className="ma-title-block">
              <p className="ma-eyebrow">Local Worldbuilding Archive</p>
              <h1 className="ma-title-main">
                手稿星图
                <span className="ma-title-slash">/</span>
                <span className="ma-title-en">Manuscript Atlas</span>
              </h1>
              <p className="ma-readable text-[0.95rem] text-sepia">
                在手稿、星图与旅行笔记之间，安静地整理你的世界。
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={createVault} disabled={loading}>
              新建存档
            </button>
            <button className="btn-ghost" onClick={openVaultDialog} disabled={loading}>
              打开本地存档
            </button>
          </div>
        </header>

        {error ? <div className="status-danger mb-5">{error}</div> : null}

        <section className="paper-panel mb-5">
          <div className="mb-5 border-b border-sepia/20 pb-4">
            <p className="ma-eyebrow">Archive Setup</p>
            <h2 className="ma-section-title">
              新建存档
              <span className="ma-title-slash">/</span>
              <span className="ma-title-en">Vault</span>
            </h2>
            <p className="mt-2 text-sm text-sepia">
              一个存档会创建为一个世界观项目文件夹，内含 `world.db`、`assets`、`exports`、`backups` 和 `project.json`。
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_auto]">
            <label className="block">
              <span className="mb-2 block text-sm text-copper">存档名称</span>
              <input className="field w-full" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-copper">简介</span>
              <input className="field w-full" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可留空" />
            </label>
            <div className="flex items-end">
              <button className="btn-parchment w-full" onClick={chooseParentDir}>
                选择存放位置
              </button>
            </div>
          </div>
          <p className="mt-3 break-all text-sm text-sepia">存放位置：{parentDir || '尚未选择'}</p>
        </section>

        <section className="paper-panel">
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-sepia/20 pb-4">
            <div className="ma-title-block">
              <p className="ma-eyebrow">Recent Vaults</p>
              <h2 className="ma-section-title">
                最近存档
                <span className="ma-title-slash">/</span>
                <span className="ma-title-en">Cabinet</span>
              </h2>
            </div>
            <span className="pt-1 text-sm text-sepia">本地 `project.json`</span>
          </div>
          {recentVaults.length === 0 ? (
            <div className="rounded-md border border-dashed border-umber/35 bg-batter/40 p-6 text-sepia">
              还没有最近存档。新建一个，或打开已有项目文件夹。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {recentVaults.map((vault) => (
                <button key={vault.id} className="vault-card group text-left" onClick={() => openRecent(vault.path)} disabled={loading}>
                  <div className="relative mb-4 h-28 overflow-hidden rounded-md bg-gradient-to-br from-[rgba(241,228,200,0.95)] to-[rgba(154,116,74,0.9)]">
                    <div className="absolute inset-3 rounded border border-vellum/40" />
                    <div className="absolute bottom-3 right-3 h-9 w-9 rounded-full border border-vellum/55" />
                  </div>
                  <h3 className="ma-card-title text-ink group-hover:text-copper">{vault.name}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-sepia">{vault.description || '暂无简介'}</p>
                  <p className="mt-4 text-xs text-umber/70">最后编辑：{vault.updatedAt}</p>
                  <p className="mt-2 break-all text-xs text-sepia">{vault.path}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
