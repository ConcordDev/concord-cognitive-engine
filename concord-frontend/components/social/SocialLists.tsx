'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';

interface ListRow { id: string; name: string; memberIds: string[] }
interface SearchHit { id: string; content?: string; username?: string; displayName?: string; tag?: string; count?: number }

/** Lists, starter packs, and search. Empty until the server returns rows. */
export function SocialLists() {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [packPeople, setPackPeople] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ people: SearchHit[]; posts: SearchHit[]; hashtags: SearchHit[] }>({ people: [], posts: [], hashtags: [] });
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ ok?: boolean; lists?: ListRow[]; error?: string }>('/api/social/lists');
    if (res.data?.ok === false) { setNote(res.data.error || 'Could not load lists.'); return; }
    setLists(res.data?.lists || []);
  }

  async function createList() {
    const res = await api.post<{ ok?: boolean; list?: ListRow; error?: string }>('/api/social/lists', { name });
    if (res.data?.ok === false || !res.data?.list) { setNote(res.data?.error || 'List was not created.'); return; }
    setName('');
    setLists((current) => [...current, res.data!.list!]);
  }

  async function addMember(listId: string) {
    const res = await api.post(`/api/social/lists/${encodeURIComponent(listId)}/members`, { memberId });
    setNote(res.data?.ok === false ? (res.data.error || 'Could not add that person.') : 'Added.');
    if (res.data?.ok !== false) void load();
  }

  async function createPack() {
    const people = packPeople.split(',').map((part) => part.trim()).filter(Boolean);
    const res = await api.post('/api/social/packs', { name: name || 'Starter pack', people, feeds: [] });
    setNote(res.data?.ok === false ? (res.data.error || 'Pack was not created.') : 'Pack saved.');
  }

  async function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) { setHits({ people: [], posts: [], hashtags: [] }); return; }
    const res = await api.get('/api/social/search', { params: { q: value.trim() } });
    setHits({
      people: res.data?.people || [],
      posts: res.data?.posts || [],
      hashtags: res.data?.hashtags || [],
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Lists and search</h2>
      <form className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void createList(); }}>
        <input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs" />
        <button type="submit" className="rounded bg-white/10 px-2 text-xs">Create list</button>
      </form>
      <button type="button" onClick={() => void load()} className="mb-2 text-[11px] text-zinc-400 underline">Refresh lists</button>
      {lists.length === 0 && <p className="mb-2 text-[11px] text-zinc-500">No lists yet.</p>}
      {lists.map((list) => (
        <form key={list.id} className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void addMember(list.id); }}>
          <span className="text-xs text-zinc-300">{list.name}</span>
          <input aria-label={`Add to ${list.name}`} value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="User id" className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs" />
          <button type="submit" className="text-xs text-teal-300">Add</button>
        </form>
      ))}
      <form className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void createPack(); }}>
        <input aria-label="Pack people" value={packPeople} onChange={(e) => setPackPeople(e.target.value)} placeholder="Pack user ids, commas" className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs" />
        <button type="submit" className="rounded bg-white/10 px-2 text-xs">Save pack</button>
      </form>
      <input aria-label="Search social" value={query} onChange={(e) => { void search(e.target.value); }} placeholder="Search posts and people" className="w-full rounded bg-zinc-900 px-2 py-1 text-xs" />
      <ul className="mt-2 space-y-1">
        {hits.people.map((person) => <li key={person.id} className="text-xs text-zinc-300">{person.displayName || person.username}</li>)}
        {hits.posts.map((post) => <li key={post.id} className="text-xs text-zinc-400">{post.content}</li>)}
        {hits.hashtags.map((tag) => <li key={tag.tag} className="text-xs text-indigo-300">#{tag.tag}</li>)}
      </ul>
      {note && <p className="mt-2 text-[11px] text-zinc-400">{note}</p>}
    </section>
  );
}
