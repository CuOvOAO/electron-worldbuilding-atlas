import { useState } from 'react';

interface AddContentMenuProps {
  options: Array<{ key: string; label: string }>;
  onSelect: (key: string) => void;
  label?: string;
}

export function AddContentMenu({ options, onSelect, label = '+ 添加内容' }: AddContentMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button className="btn-parchment" onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+0.4rem)] z-30 min-w-48 rounded-md border border-umber/35 bg-vellum p-2 shadow-folio">
          {options.map((option) => (
            <button
              key={option.key}
              className="w-full rounded px-3 py-2 text-left text-sm text-ink transition hover:bg-batter/60"
              onClick={() => {
                onSelect(option.key);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
