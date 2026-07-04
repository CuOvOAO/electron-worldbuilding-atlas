interface ListRailProps {
  title: string;
  items: string[];
  activeItem: string;
  onSelect: (item: string) => void;
}

export function ListRail({ title, items, activeItem, onSelect }: ListRailProps): JSX.Element {
  return (
    <aside className="paper-panel h-full overflow-hidden p-0">
      <div className="border-b border-sepia/20 px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      </div>
      <div className="space-y-2 p-3">
        {items.map((item) => (
          <button
            key={item}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
              item === activeItem
                ? 'border-copper/60 bg-batter/80 text-ink shadow-sm'
                : 'border-transparent text-sepia hover:border-sepia/20 hover:bg-vellum'
            }`}
            onClick={() => onSelect(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}
