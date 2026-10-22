'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api/client';

interface Person {
  id: string;
  username: string;
  displayName: string;
}

/** People search. Results link to /lenses/social/u/:username. */
export function FindPeople() {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setPeople([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const res = await api.get('/api/social/users/search', { params: { q: value.trim() } });
      setPeople((res.data?.users || []) as Person[]);
      setStatus('idle');
    } catch {
      setPeople([]);
      setStatus('error');
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3">
      <label htmlFor="find-people" className="mb-1 block text-xs text-zinc-400">Find people</label>
      <input
        id="find-people"
        value={query}
        onChange={(e) => { void search(e.target.value); }}
        placeholder="Name or username"
        className="w-full rounded bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none"
      />
      {status === 'loading' && <p className="mt-2 text-[11px] text-zinc-500">Searching…</p>}
      {status === 'error' && <p className="mt-2 text-[11px] text-rose-400">People search failed.</p>}
      {query.trim().length >= 2 && status === 'idle' && people.length === 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">No matching people.</p>
      )}
      <ul className="mt-2 space-y-1">
        {people.map((person) => {
          const handle = person.username || person.displayName;
          if (!handle) return null;
          return (
            <li key={person.id}>
              <Link
                href={`/lenses/social/u/${encodeURIComponent(handle)}`}
                className="block rounded px-2 py-1 text-sm text-zinc-200 hover:bg-white/5"
              >
                {person.displayName || handle}
                <span className="ml-1 text-zinc-500">@{handle}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
