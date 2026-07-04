import { useState, type ReactNode } from 'react';

interface SortableCardListProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, state: { dragging: boolean }) => ReactNode;
  disabled?: boolean;
  className?: string;
  itemClassName?: (item: T) => string;
}

function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function DragHandle(): JSX.Element {
  return (
    <span className="select-none rounded border border-umber/30 bg-batter/60 px-2 py-1 text-xs leading-none text-copper" title="拖拽排序">
      ::
    </span>
  );
}

export function SortableCardList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  disabled = false,
  className = 'space-y-4',
  itemClassName
}: SortableCardListProps<T>): JSX.Element {
  const [draggingId, setDraggingId] = useState('');
  const [overId, setOverId] = useState('');

  function finishDrag(targetId: string): void {
    const from = items.findIndex((item) => getId(item) === draggingId);
    const to = items.findIndex((item) => getId(item) === targetId);
    if (from >= 0 && to >= 0 && from !== to) {
      onReorder(reorder(items, from, to));
    }
    setDraggingId('');
    setOverId('');
  }

  return (
    <div className={className}>
      {items.map((item) => {
        const id = getId(item);
        const dragging = id === draggingId;
        const over = id === overId && draggingId !== id;
        return (
          <div
            key={id}
            draggable={!disabled}
            className={`${itemClassName?.(item) ?? ''} ${dragging ? 'opacity-60 shadow-folio' : ''} ${over ? 'ring-2 ring-olive/70' : ''}`}
            onDragStart={(event) => {
              if (disabled) return;
              setDraggingId(id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', id);
            }}
            onDragOver={(event) => {
              if (disabled || !draggingId) return;
              event.preventDefault();
              setOverId(id);
            }}
            onDrop={(event) => {
              if (disabled) return;
              event.preventDefault();
              finishDrag(id);
            }}
            onDragEnd={() => {
              setDraggingId('');
              setOverId('');
            }}
          >
            {renderItem(item, { dragging })}
          </div>
        );
      })}
    </div>
  );
}
