import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { searchClient, type SearchResult } from '../services/searchClient';
import type { NavigationTarget, Vault } from '../types/app';

interface GlobalSearchProps {
  vault: Vault;
  onNavigate: (target: NavigationTarget) => void;
  className?: string;
  labelClassName?: string;
  placeholder?: string;
}

function HighlightedText({ text, query }: { text: string; query: string }): JSX.Element {
  const keyword = query.trim();
  if (!keyword) return <>{text}</>;

  const lowerText = text.toLocaleLowerCase();
  const lowerKeyword = keyword.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerKeyword);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + keyword.length;
    parts.push(
      <span key={`${matchIndex}-${matchEnd}`} className="search-match-highlight">
        {text.slice(matchIndex, matchEnd)}
      </span>
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(lowerKeyword, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}

export function GlobalSearch({
  vault,
  onNavigate,
  className = '',
  labelClassName = '',
  placeholder = '搜索角色、词条、事件、地点...'
}: GlobalSearchProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [popoverRect, setPopoverRect] = useState({ top: 0, left: 0, width: 320 });
  const searchRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length === 0) {
      setResults([]);
      setIsOpen(false);
      setSearchError('');
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setIsSearching(true);
        const items = await searchClient.globalSearch(vault.path, keyword);
        setResults(items);
        setSearchError('');
        setIsOpen(true);
      } catch (error) {
        console.error('全局搜索失败', error);
        setResults([]);
        setSearchError('搜索暂时不可用，请稍后再试');
        setIsOpen(true);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [query, vault.path]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (searchRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      if (searchRef.current) setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    function updatePopoverPosition(): void {
      const rect = searchRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: Math.max(rect.width, 320)
      });
    }

    if (isOpen) updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [isOpen]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setIsOpen(false);
      event.currentTarget.blur();
    }
  }

  function selectResult(result: SearchResult): void {
    setIsOpen(false);
    setQuery('');
    onNavigate(result.target);
  }

  const groupedResults = results.reduce<Record<string, SearchResult[]>>((groups, result) => {
    const groupName = result.kind || result.entityType;
    groups[groupName] = groups[groupName] ?? [];
    groups[groupName].push(result);
    return groups;
  }, {});
  const groupNames = Object.keys(groupedResults);

  return (
    <>
      <div ref={searchRef} className={`relative ${className}`}>
        <label className={labelClassName || 'flex w-80 items-center gap-2 rounded-md border border-umber/40 bg-[rgba(247,238,220,0.96)] px-3 py-2.5 text-[0.9375rem] shadow-[inset_0_1px_0_rgba(255,248,232,0.45)] transition focus-within:border-copper/55 focus-within:shadow-[0_0_0_2px_rgba(154,116,74,0.14)]'}>
          <span className="text-copper" aria-hidden="true">⌕</span>
          <input
            className="w-full bg-transparent outline-none placeholder:text-sepia/75"
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (query.trim().length > 0) setIsOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
          />
        </label>
      </div>
      {isOpen && query.trim().length > 0
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[35] max-h-[420px] overflow-auto rounded-md border border-umber/35 bg-vellum p-3 text-sm shadow-folio"
              style={{ top: popoverRect.top, left: popoverRect.left, width: popoverRect.width }}
            >
              {isSearching ? <p className="px-2 py-3 text-sepia">正在翻阅档案...</p> : null}
              {!isSearching && searchError ? <p className="px-2 py-3 text-danger">{searchError}</p> : null}
              {!isSearching && !searchError && results.length === 0 ? <p className="px-2 py-3 text-sepia">没有找到相关记录</p> : null}
              {!isSearching && !searchError
                ? groupNames.map((groupName) => (
                    <section key={groupName} className="mb-3 last:mb-0">
                      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-olive">{groupName}</p>
                      <div className="space-y-1">
                        {groupedResults[groupName].slice(0, 5).map((result) => (
                          <button
                            key={result.id}
                            className="w-full rounded-md border border-transparent px-2 py-2 text-left transition hover:-translate-y-0.5 hover:border-umber/35 hover:bg-batter/70 hover:shadow-sm"
                            onClick={() => selectResult(result)}
                          >
                            <span className="block text-base font-semibold text-ink">
                              <HighlightedText text={result.title} query={query} />
                            </span>
                            {result.snippet ? (
                              <span className="block max-h-10 overflow-hidden text-xs leading-5 text-sepia">
                                <HighlightedText text={result.snippet} query={query} />
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
