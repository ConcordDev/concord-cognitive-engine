'use client';

// concord-frontend/components/social/UserPicker.tsx
//
// FIX-society-011 / FIX-fitness-017 (GB-1521 slice B6): DM and
// send-to-partner forms asked for a raw user id typed from memory —
// nobody knows another user's id. This picker searches the same
// /api/social/mention-search the mention autocomplete uses and hands
// back the chosen user's id + display name. Free text never reaches
// the send call: a recipient exists only once picked from results.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface PickedUser { userId: string; username: string; displayName?: string }

interface MentionResult { results?: PickedUser[]; users?: PickedUser[] }

export function UserPicker({
  value,
  onPick,
  placeholder,
  ariaLabel,
}: {
  value: PickedUser | null;
  onPick: (user: PickedUser | null) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedUser[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (value || q.length < 2) { setResults([]); setSearched(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get(`/api/social/mention-search?q=${encodeURIComponent(q)}&limit=8`);
        const users = (r.data as MentionResult)?.results || (r.data as MentionResult)?.users || (Array.isArray(r.data) ? (r.data as PickedUser[]) : []);
        setResults(users);
        setSearched(true);
        setOpen(true);
      } catch { setResults([]); setSearched(true); setOpen(true); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, value]);

  if (value) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-white">
        {value.displayName || value.username}
        <span className="text-zinc-500">@{value.username}</span>
        <button type="button" aria-label={`Clear ${ariaLabel}`} onClick={() => { onPick(null); setQuery(''); }} className="text-zinc-400 hover:text-white">
          <X className="h-3 w-3" aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {open && query.trim().length >= 2 && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-56 rounded border border-zinc-700 bg-zinc-950 shadow-lg">
          {results.map((u) => (
            <button
              key={u.userId}
              type="button"
              onClick={() => { onPick(u); setOpen(false); }}
              className="block w-full px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
            >
              {u.displayName || u.username} <span className="text-zinc-500">@{u.username}</span>
            </button>
          ))}
          {searched && results.length === 0 && (
            <span className="block px-2.5 py-1.5 text-[12px] text-zinc-500">No users match “{query.trim()}”.</span>
          )}
        </span>
      )}
    </span>
  );
}
