import type { ReactNode } from 'react';

interface EditableSectionProps {
  title: string;
  editing: boolean;
  onEdit: () => void;
  children: ReactNode;
  action?: ReactNode;
}

export function EditableSection({ title, editing, onEdit, children, action }: EditableSectionProps): JSX.Element {
  return (
    <section className="mini-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3>{title}</h3>
        {action ?? (
          <button className="rounded border border-umber/30 px-2 py-1 text-xs text-copper transition hover:bg-batter/50" onClick={onEdit}>
            {editing ? '编辑中' : '编辑'}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
