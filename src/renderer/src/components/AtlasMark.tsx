export function AtlasMark(): JSX.Element {
  return (
    <div className="grid h-11 w-11 place-items-center rounded-full border border-copper/45 bg-vellum shadow-inner">
      <svg viewBox="0 0 42 42" className="h-8 w-8 text-copper" aria-hidden="true">
        <circle cx="21" cy="21" r="15" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 24c7-7 17-7 26 0M13 12c5 9 11 14 19 17M21 6v30" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="21" cy="21" r="2.5" fill="currentColor" />
      </svg>
    </div>
  );
}
