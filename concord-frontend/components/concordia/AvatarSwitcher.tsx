'use client';

// v2.0 Workstream 6a — avatar switcher widget. Lists this user's avatars,
// activates one, allows creating a new one. Drop into the profile menu or
// any header surface.
//
// Reads/writes via /api/avatars (GET/POST/PUT activate). The active
// avatar id is also persisted in localStorage so the hotbar and personal
// locker can scope by avatar without a round-trip.

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api/client';

interface Avatar {
  id: string;
  name: string;
  slug?: string;
  is_primary?: number;
}

const ACTIVE_AVATAR_KEY = 'concordia:activeAvatarId';

export function getActiveAvatarId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_AVATAR_KEY);
}

export default function AvatarSwitcher() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/avatars');
      const list = (res.data?.avatars ?? []) as Avatar[];
      setAvatars(list);
      const stored = window.localStorage.getItem(ACTIVE_AVATAR_KEY);
      const next = list.find((a) => a.id === stored)?.id ?? res.data?.activeId ?? list.find((a) => a.is_primary)?.id ?? list[0]?.id ?? null;
      setActiveId(next);
      if (next) window.localStorage.setItem(ACTIVE_AVATAR_KEY, next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function activate(id: string) {
    if (id === activeId) return;
    try {
      await api.put(`/api/avatars/${encodeURIComponent(id)}/activate`);
      setActiveId(id);
      window.localStorage.setItem(ACTIVE_AVATAR_KEY, id);
      // Notify the rest of the app — hotbar etc. listen for this so the
      // loadout switches without a page reload.
      window.dispatchEvent(new CustomEvent('concordia:avatar-changed', { detail: { avatarId: id } }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Activate failed');
    }
  }

  async function create() {
    if (!newName.trim()) return;
    try {
      const res = await api.post('/api/avatars', { name: newName.trim() });
      const created = res.data?.avatar as Avatar | undefined;
      setNewName('');
      setCreating(false);
      await load();
      if (created?.id) await activate(created.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  }

  return (
    <div className="bg-black/70 border border-white/10 rounded-lg p-3 text-white text-xs">
      <div className="flex items-center justify-between mb-2">
        <p className="font-semibold">Avatars</p>
        <button
          onClick={() => setCreating((v) => !v)}
          className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] hover:bg-white/10"
        >
          {creating ? 'cancel' : '+ new'}
        </button>
      </div>

      {loading ? (
        <p className="text-white/50">Loading…</p>
      ) : (
        <ul className="space-y-1">
          {avatars.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => activate(a.id)}
                className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                  a.id === activeId ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {a.name}{a.is_primary ? ' · primary' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <div className="mt-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Avatar name"
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 outline-none focus:border-amber-500/40"
          />
          <button onClick={create} className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded">save</button>
        </div>
      )}

      {error && <p className="text-red-400 mt-2">{error}</p>}
    </div>
  );
}
