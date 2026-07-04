export type ModuleKey =
  | 'home'
  | 'characters'
  | 'codex'
  | 'events'
  | 'locations'
  | 'timeline'
  | 'manuscripts'
  | 'export'
  | 'trash'
  | 'settings';

export interface Vault {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  path: string;
  coverTone?: string;
}

export interface RecentItem {
  kind: string;
  title: string;
  detail: string;
  id?: string;
  updatedAt?: string;
}

export type NavigationTarget =
  | { module: 'characters'; characterId: string; characterVersionId: string }
  | { module: 'codex'; codexItemId: string }
  | { module: 'events'; eventId?: string }
  | { module: 'locations'; locationId?: string; mapId?: string; mapObjectId?: string; view?: 'records' | 'map' }
  | { module: 'manuscripts'; manuscriptId?: string }
  | { module: 'timeline'; timelineId?: string; eventId?: string };
