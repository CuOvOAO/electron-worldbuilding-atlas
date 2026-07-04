export type DatabaseStatus = 'reserved' | 'connected';

export const databasePlan = {
  status: 'reserved' as DatabaseStatus,
  note: 'SQLite access is intentionally deferred for the V0 clickable prototype.'
};
