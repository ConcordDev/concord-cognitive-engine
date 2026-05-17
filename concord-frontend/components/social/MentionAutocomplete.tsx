'use client';

/**
 * MentionAutocomplete — drop-in @mention dropdown for any textarea/input.
 *
 * Phase 11 (Item 3): backend createPost already accepts a
 * `mentionedUsers` array but no UI was wiring it.  This component
 * wraps a text input, detects an `@` token at the caret, queries
 * /api/social/mention-search debounced, and inserts the chosen
 * username + records the userId in the parent's mention list.
 *
 *   const [text, setText] = useState('');
 *   const [mentions, setMentions] = useState<string[]>([]);
 *   <MentionAutocomplete
 *     value={text}
 *     onChange={setText}
 *     mentionedUsers={mentions}
 *     onMentionedUsersChange={setMentions}
 *     renderInput={(props) => <textarea {...props} />}
 *   />
 *
 * No fake suggestions — the dropdown only renders real users from
 * /api/social/mention-search.  Empty results show "No users match".
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface MentionResult {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string | null;
  isFollowing?: boolean;
  isFollower?: boolean;
}

interface MentionSearchResponse {
  ok: boolean;
  results?: MentionResult[];
}

export interface MentionAutocompleteRenderProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSelect: (e: { currentTarget: { selectionStart: number | null } }) => void;
  ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  'aria-haspopup': 'listbox';
  'aria-expanded': boolean;
}

export interface MentionAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  mentionedUsers: string[];
  onMentionedUsersChange: (next: string[]) => void;
  /** Render-prop so callers control the underlying <textarea> / <input>. */
  renderInput: (props: MentionAutocompleteRenderProps) => ReactNode;
  className?: string;
  /** Max items the dropdown shows. Default 8. */
  maxItems?: number;
}

interface ActiveQuery {
  prefix: string;
  start: number;
  end: number;
}

export function MentionAutocomplete({
  value,
  onChange,
  mentionedUsers,
  onMentionedUsersChange,
  renderInput,
  className,
  maxItems = 8,
}: MentionAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [caretPos, setCaretPos] = useState<number>(0);
  const [active, setActive] = useState<ActiveQuery | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [debounced, setDebounced] = useState<string>('');

  // Debounce the prefix → query input by 200ms.
  useEffect(() => {
    if (!active) { setDebounced(''); return; }
    const id = window.setTimeout(() => setDebounced(active.prefix), 200);
    return () => window.clearTimeout(id);
  }, [active]);

  const { data, isFetching } = useQuery<MentionSearchResponse | null>({
    queryKey: ['mention-search', debounced],
    enabled: !!debounced && debounced.length > 0,
    queryFn: async () => {
      try {
        const r = await api.get<MentionSearchResponse>(
          `/api/social/mention-search?q=${encodeURIComponent(debounced)}&limit=${maxItems}`,
        );
        return r?.data;
      } catch { return null; }
    },
    staleTime: 15_000,
  });

  const results = useMemo(() => (data?.results || []).slice(0, maxItems), [data, maxItems]);

  // Re-clamp highlight when results shrink/grow.
  useEffect(() => {
    setHighlightIdx((idx) => Math.max(0, Math.min(idx, Math.max(0, results.length - 1))));
  }, [results.length]);

  /** Find an `@token` at or just behind the caret position. */
  const detectActive = useCallback((text: string, caret: number): ActiveQuery | null => {
    // Walk back from caret until whitespace or '@'.
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === '@') {
        // Make sure this @ is at start or after whitespace (avoid emails).
        const prev = text[i - 1];
        if (i === 0 || /\s/.test(prev)) {
          const prefix = text.slice(i + 1, caret);
          if (/^[A-Za-z0-9_]*$/.test(prefix)) {
            return { prefix, start: i, end: caret };
          }
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    setCaretPos(caret);
    setActive(detectActive(next, caret));
  }, [onChange, detectActive]);

  const handleSelect = useCallback((e: { currentTarget: { selectionStart: number | null } }) => {
    const caret = e.currentTarget.selectionStart ?? value.length;
    setCaretPos(caret);
    setActive(detectActive(value, caret));
  }, [value, detectActive]);

  const insertChoice = useCallback((choice: MentionResult) => {
    if (!active) return;
    const before = value.slice(0, active.start);
    const after = value.slice(active.end);
    const next = `${before}@${choice.username} ${after}`;
    onChange(next);
    if (!mentionedUsers.includes(choice.userId)) {
      onMentionedUsersChange([...mentionedUsers, choice.userId]);
    }
    setActive(null);
    setDebounced('');
    // Move caret to just after the inserted "@username "
    queueMicrotask(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = (before + '@' + choice.username + ' ').length;
      try { el.focus(); el.setSelectionRange(pos, pos); setCaretPos(pos); } catch { /* ignore */ }
    });
  }, [active, value, onChange, mentionedUsers, onMentionedUsersChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!active || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((idx) => (idx + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((idx) => (idx - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertChoice(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setActive(null);
    }
  }, [active, results, highlightIdx, insertChoice]);

  const setRef = useCallback((el: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = el;
  }, []);

  const isOpen = !!active && (results.length > 0 || isFetching || (!!debounced && results.length === 0));

  return (
    <div className={cn('relative', className)}>
      {renderInput({
        value,
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        onSelect: handleSelect,
        ref: setRef,
        'aria-haspopup': 'listbox',
        'aria-expanded': isOpen,
      })}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1 z-50 max-h-72 overflow-auto rounded border border-zinc-700 bg-zinc-950 shadow-xl"
        >
          {isFetching && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching…
            </div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No users match "{debounced || active.prefix}"</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.userId}
              type="button"
              role="option"
              aria-selected={i === highlightIdx}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); insertChoice(r); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                i === highlightIdx ? 'bg-indigo-500/15 text-indigo-100' : 'hover:bg-zinc-900 text-zinc-200',
              )}
            >
              <div className="w-6 h-6 rounded-full bg-zinc-800 overflow-hidden flex-shrink-0">
                {r.avatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={r.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                    {(r.displayName || r.username || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium truncate">@{r.username}</span>
                  {r.displayName && r.displayName !== r.username && (
                    <span className="text-xs text-zinc-500 truncate">{r.displayName}</span>
                  )}
                </div>
              </div>
              {(r.isFollowing || r.isFollower) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {r.isFollowing ? 'Following' : 'Follows you'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MentionAutocomplete;
