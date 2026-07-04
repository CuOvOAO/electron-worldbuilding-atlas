import { useEffect, useState } from 'react';
import type { NavigationTarget, Vault } from '../types/app';
import { useUnsavedChangesGuard } from '../components/UnsavedChangesGuard';
import { LocationMapView } from './location/LocationMapView';
import { LocationRecordsView } from './location/LocationRecordsView';

type LocationView = 'records' | 'map';

interface LocationPageProps {
  vault: Vault;
  target: Extract<NavigationTarget, { module: 'locations' }> | null;
  onNavigate: (target: NavigationTarget) => void;
}

export function LocationPage({ vault, target, onNavigate }: LocationPageProps): JSX.Element {
  const [view, setView] = useState<LocationView>('records');
  const { confirmNavigation } = useUnsavedChangesGuard();

  useEffect(() => {
    if (target?.view === 'map' || target?.mapId) {
      setView('map');
    }
  }, [target?.view, target?.mapId]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button className={`subtab ${view === 'records' ? 'subtab-active' : ''}`} onClick={() => confirmNavigation(() => setView('records'))}>
          地点资料
        </button>
        <button className={`subtab ${view === 'map' ? 'subtab-active' : ''}`} onClick={() => confirmNavigation(() => setView('map'))}>
          地图编辑
        </button>
      </div>
      {view === 'records' ? <LocationRecordsView vault={vault} target={target} onNavigate={onNavigate} /> : <LocationMapView vault={vault} targetMapId={target?.mapId} targetMapObjectId={target?.mapObjectId} onNavigate={onNavigate} />}
    </div>
  );
}
