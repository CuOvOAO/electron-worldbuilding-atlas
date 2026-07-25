import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { on: vi.fn() }
}));

import { shouldPreventWindowClose } from '../../src/main/lifecycle/closeGuard';

describe('unsaved close guard', () => {
  it('blocks closing only while unsaved changes are present and not confirmed', () => {
    expect(shouldPreventWindowClose({ hasUnsavedChanges: false, allowClose: false })).toBe(false);
    expect(shouldPreventWindowClose({ hasUnsavedChanges: true, allowClose: false })).toBe(true);
    expect(shouldPreventWindowClose({ hasUnsavedChanges: true, allowClose: true })).toBe(false);
  });
});
