export interface ExportOptions {
  selectedCharacterIds: string[];
  selectedCodexItemIds: string[];
  selectedEventIds: string[];
  selectedLocationIds: string[];
  selectedTimelineIds: string[];
  selectedManuscriptIds: string[];
}

export interface ExportSummaryItem {
  id: string;
  title: string;
  type?: string;
  storyTime?: string;
  manuscriptType?: string;
  manuscriptTypeLabel?: string;
  parentTimelineId?: string | null;
  sortOrder?: number;
}

export interface ExportCharacterItem extends ExportSummaryItem {
  summary: string;
  versions: Array<{ id: string; title: string }>;
}

export interface ExportSummary {
  characters: ExportCharacterItem[];
  codexItems: ExportSummaryItem[];
  events: ExportSummaryItem[];
  locations: ExportSummaryItem[];
  timelines: ExportSummaryItem[];
  manuscripts: ExportSummaryItem[];
}

export interface ExportResult {
  success: boolean;
  cancelled: boolean;
  filePath?: string;
  fileName?: string;
}

export interface MapPngBatchResult extends ExportResult {
  successCount: number;
  failedCount: number;
  errors: string[];
  directory?: string;
}

function unwrap<T>(result: ({ ok: true } & T) | { ok: false; error?: string }): T {
  if (!result.ok) {
    throw new Error(result.error ?? '导出失败。');
  }
  return result;
}

export const exportClient = {
  async getSummary(vaultPath: string): Promise<ExportSummary> {
    return unwrap(await window.manuscriptAtlas.export.summary(vaultPath)).summary as ExportSummary;
  },
  async exportMarkdown(vaultPath: string, options: ExportOptions): Promise<ExportResult> {
    return unwrap(await window.manuscriptAtlas.export.markdown(vaultPath, options));
  },
  async exportMapPng(vaultPath: string, input: { title: string; dataUrl: string }): Promise<ExportResult> {
    return unwrap(await window.manuscriptAtlas.export.mapPng(vaultPath, input));
  },
  async exportMapPngBatch(vaultPath: string, items: Array<{ title: string; dataUrl: string }>): Promise<MapPngBatchResult> {
    return unwrap(await window.manuscriptAtlas.export.mapPngBatch(vaultPath, { items }));
  }
};
