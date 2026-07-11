'use client';

/**
 * RecipientSearchInput — username/display-name autocomplete for DM
 * compose. Closes a real GENUINELY-MISSING gap flagged in the message
 * lens's Wave-3 rebuild audit: compose previously took a raw userId
 * string with zero lookup against Concord's own user table, which no
 * real messaging product ships (Gmail/Slack/Discord all autocomplete
 * recipients). Backend already had the endpoint — `GET
 * /api/social/users/search?q=` (server/routes/social-groups.js,
 * mounted at /api/social) — it just had no frontend consumer. This is
 * the ENGINEERING-class fix per CLAUDE.md's "closing the hard 20%"
 * invariant: no new backend endpoint needed, just wiring one that
 * already existed.
 *
 * Manual entry is preserved (not removed) — typing an exact userId
 * still flows straight through onChange, so a raw ID a user already
 * knows (or copy-pasted from elsewhere) keeps working even if the
 * search API is down or the user isn't discoverable by username.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface UserResult {
  id: string;
  username: string;
  displayName: string;
}

interface Props {
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
  className?: string;
  inputId?: string;
}

export function RecipientSearchInput({ value, onChange, placeholder = 'Recipient — search by username or paste a userId', className, inputId }: Props) {
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myReqId = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.get('/api/social/users/search', { params: { q } });
        if (reqIdRef.current !== myReqId) return; // stale response — a newer keystroke superseded this request
        const users = (r.data?.users ?? []) as UserResult[];
        setResults(Array.isArray(users) ? users : []);
        setErrored(false);
      } catch {
        if (reqIdRef.current !== myReqId) return;
        setResults([]);
        setErrored(true);
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const select = (u: UserResult) => {
    onChange(u.id);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
        <input
          id={inputId}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(
            'w-full bg-white/5 border border-white/10 rounded pl-8 pr-8 py-2 text-sm font-mono',
            'focus:outline-none focus:border-violet-400/50',
            className,
          )}
        />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 animate-spin" aria-hidden="true" />}
      </div>

      {open && value.trim().length >= 2 && (results.length > 0 || (!loading && errored)) && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-56 overflow-auto rounded-md border border-white/10 bg-zinc-900 shadow-xl py-1">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => select(u)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between gap-2"
            >
              <span className="truncate">{u.displayName || u.username}</span>
              <span className="text-[10px] text-gray-500 font-mono truncate">{u.id}</span>
            </button>
          ))}
          {!loading && errored && (
            <p className="px-3 py-1.5 text-[11px] text-gray-500">Search unavailable — you can still paste an exact userId.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default RecipientSearchInput;
