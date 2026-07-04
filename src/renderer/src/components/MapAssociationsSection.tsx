import type { NavigationTarget } from '../types/app';

export interface MapAssociationItem {
  mapId: string;
  mapTitle: string;
  sourceMapId: string | null;
  sourceMapTitle: string;
  objectId: string;
  objectType: string;
  objectTypeLabel: string;
  objectName: string;
  objectDescription: string;
  layerId: string | null;
  layerName: string;
}

interface MapAssociationsSectionProps {
  items: MapAssociationItem[];
  onOpen: (target: NavigationTarget) => void;
}

export function MapAssociationsSection({ items, onOpen }: MapAssociationsSectionProps): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mini-panel">
      <h3>地图关联</h3>
      <div className="mt-4 space-y-2.5">
        {items.map((item) => (
          <button
            key={`${item.mapId}:${item.objectId}`}
            className="w-full rounded-md border border-umber/25 bg-vellum/70 p-3 text-left transition hover:border-copper/45 hover:bg-batter/45"
            onClick={() => onOpen({ module: 'locations', view: 'map', mapId: item.mapId, mapObjectId: item.objectId })}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{item.mapTitle}</span>
              <span className="rounded border border-umber/25 bg-batter/55 px-2 py-0.5 text-[11px] text-copper">{item.objectTypeLabel}</span>
            </div>
            <p className="mt-1 text-sm text-sepia">{item.objectName}</p>
            {item.objectDescription ? <p className="mt-1 line-clamp-2 text-xs text-sepia/85">{item.objectDescription}</p> : null}
            <p className="mt-2 text-xs text-sepia">
              图层：{item.layerName}
              {item.sourceMapTitle ? ` · 基于 ${item.sourceMapTitle}` : ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
