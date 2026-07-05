import type { VaultProject } from '../types/entities';

export type IntegrityStatus = 'healthy' | 'warning' | 'critical';
export type IntegritySeverity = 'critical' | 'warning' | 'info';
export type IntegrityCategory = 'project' | 'database' | 'schema' | 'asset' | 'reference';

export interface IntegrityIssue {
  id: string;
  severity: IntegritySeverity;
  category: IntegrityCategory;
  message: string;
  entity?: {
    type: string;
    id: string;
    name: string;
  };
  relativePath?: string;
  suggestion: string;
}

export interface IntegrityReport {
  checkedAt: string;
  summary: {
    status: IntegrityStatus;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    checkedAssetCount: number;
  };
  issues: IntegrityIssue[];
}

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '完整性检查失败。');
  }
  return result;
}

export const integrityClient = {
  async checkCurrentVault(vault: Pick<VaultProject, 'path'>): Promise<IntegrityReport> {
    const result = unwrap(await window.manuscriptAtlas.integrity.checkCurrentVault(vault.path));
    return result.report;
  }
};
