import { createContext, useContext, useState, type ReactNode } from 'react';

interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  confirmNavigation: (action: () => void) => void;
  confirmDanger: (message: string, confirmLabel?: string) => Promise<boolean>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [dangerPrompt, setDangerPrompt] = useState<{
    message: string;
    confirmLabel: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  function confirmNavigation(action: () => void): void {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    setPendingAction(() => action);
  }

  function continueNavigation(): void {
    const action = pendingAction;
    setPendingAction(null);
    setHasUnsavedChanges(false);
    action?.();
  }

  function confirmDanger(message: string, confirmLabel = '确认删除'): Promise<boolean> {
    return new Promise((resolve) => {
      setDangerPrompt({ message, confirmLabel, resolve });
    });
  }

  function closeDanger(value: boolean): void {
    dangerPrompt?.resolve(value);
    setDangerPrompt(null);
  }

  return (
    <UnsavedChangesContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges, confirmNavigation, confirmDanger }}>
      {children}
      {pendingAction && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/35">
          <div className="w-[420px] rounded-md border border-umber/40 bg-vellum p-5 shadow-folio">
            <h2 className="font-serif text-xl font-semibold text-ink">未保存的编辑内容</h2>
            <p className="mt-3 leading-7 text-sepia">你有尚未保存的编辑内容，离开后这些修改将丢失。是否继续离开？</p>
            <div className="mt-5 flex justify-end gap-3">
              <button className="btn-ghost" onClick={() => setPendingAction(null)}>留在当前页</button>
              <button className="btn-primary" onClick={continueNavigation}>继续离开</button>
            </div>
          </div>
        </div>
      )}
      {dangerPrompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-cowhide/35">
          <div className="w-[420px] rounded-md border border-umber/40 bg-vellum p-5 shadow-folio">
            <h2 className="font-serif text-xl font-semibold text-ink">确认操作</h2>
            <p className="mt-3 leading-7 text-sepia">{dangerPrompt.message}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button className="btn-ghost" onClick={() => closeDanger(false)}>取消</button>
              <button className="btn-primary" onClick={() => closeDanger(true)}>{dangerPrompt.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesGuard(): UnsavedChangesContextValue {
  const value = useContext(UnsavedChangesContext);
  if (!value) {
    throw new Error('useUnsavedChangesGuard must be used within UnsavedChangesProvider');
  }
  return value;
}
