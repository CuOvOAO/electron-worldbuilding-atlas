interface ReadEditToggleProps {
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ReadEditToggle({ editing, onEdit, onSave, onCancel }: ReadEditToggleProps): JSX.Element {
  if (!editing) {
    return (
      <button className="btn-ghost" onClick={onEdit}>
        编辑
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button className="btn-primary" onClick={onSave}>
        保存
      </button>
      <button className="btn-ghost" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}
