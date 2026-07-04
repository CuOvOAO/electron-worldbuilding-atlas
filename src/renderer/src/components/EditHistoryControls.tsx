interface EditHistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditHistoryControls({ canUndo, canRedo, onUndo, onRedo }: EditHistoryControlsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      <button className="btn-ghost" disabled={!canUndo} onClick={onUndo}>
        撤回
      </button>
      <button className="btn-ghost" disabled={!canRedo} onClick={onRedo}>
        重做
      </button>
    </div>
  );
}
