import { useCallback, useEffect, useRef, useState } from 'react';

interface UseEditDraftResult<T> {
  draft: T;
  setDraft: (next: T | ((current: T) => T), options?: { checkpoint?: boolean }) => void;
  resetDraft: (next: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useEditDraft<T>(initialValue: T, enabled: boolean): UseEditDraftResult<T> {
  const [draft, setDraftState] = useState(initialValue);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const draftRef = useRef(draft);
  const lastChangeAtRef = useRef(0);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const setDraft = useCallback((next: T | ((current: T) => T), options?: { checkpoint?: boolean }) => {
    setDraftState((current) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      const now = Date.now();
      const shouldCheckpoint = options?.checkpoint || now - lastChangeAtRef.current > 700;
      if (shouldCheckpoint) {
        setPast((items) => [...items, current].slice(-80));
      }
      lastChangeAtRef.current = now;
      setFuture([]);
      return resolved;
    });
  }, []);

  const resetDraft = useCallback((next: T) => {
    setDraftState(next);
    setPast([]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((items) => {
      if (items.length === 0) return items;
      const previous = items[items.length - 1];
      setFuture((futureItems) => [draftRef.current, ...futureItems].slice(0, 80));
      setDraftState(previous);
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      if (items.length === 0) return items;
      const next = items[0];
      setPast((pastItems) => [...pastItems, draftRef.current].slice(-80));
      setDraftState(next);
      return items.slice(1);
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPast([]);
      setFuture([]);
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, undo, redo]);

  return { draft, setDraft, resetDraft, canUndo: past.length > 0, canRedo: future.length > 0, undo, redo };
}
