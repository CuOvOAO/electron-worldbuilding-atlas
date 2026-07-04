import type { ReactNode } from 'react';

interface MockPopoverProps {
  x: number;
  y: number;
  children: ReactNode;
}

export function MockPopover({ x, y, children }: MockPopoverProps): JSX.Element {
  return (
    <div
      className="mock-popover absolute z-20 w-64 rounded-md border border-umber/35 bg-vellum p-4 text-sm shadow-folio"
      style={{ left: `${x}%`, top: `${y}%` }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
