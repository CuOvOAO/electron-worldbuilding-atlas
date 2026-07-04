import type { NavigationTarget } from '../types/app';

export interface SearchResult {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  title: string;
  subtitle: string;
  snippet: string;
  updatedAt: string;
  target: NavigationTarget;
}

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '搜索失败。');
  }
  return result;
}

export const searchClient = {
  async globalSearch(vaultPath: string, query: string): Promise<SearchResult[]> {
    return unwrap(await window.manuscriptAtlas.data.globalSearch(vaultPath, query)).results;
  }
};
