import type { ReactNode } from 'react';

interface CollapsiblePanelProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  side: 'left' | 'right';
  children: ReactNode;
}

export function CollapsiblePanel({ title, collapsed, onToggle, side, children }: CollapsiblePanelProps): JSX.Element {
  return (
    <aside className={`collapsible-panel paper-panel flex h-full min-h-0 flex-col overflow-hidden p-0 ${collapsed ? 'w-12' : side === 'left' ? 'w-56' : 'w-64'}`}>
      <div className="flex shrink-0 items-center justify-between border-b border-sepia/20 px-3 py-3">
        {!collapsed && <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>}
        <button className="rounded border border-umber/30 px-2 py-1 text-copper transition hover:bg-batter/50" onClick={onToggle}>
          {collapsed ? (side === 'left' ? '>' : '<') : side === 'left' ? '<' : '>'}
        </button>
      </div>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-8">{children}</div>}
    </aside>
  );
}
