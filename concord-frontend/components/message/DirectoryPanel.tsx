'use client';

/**
 * DirectoryPanel — workspace member directory + editable profiles.
 * Wires message.profile-{set,get} and directory-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Search, Loader2, Save, UserPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Profile {
  memberId: string;
  displayName: string;
  title: string;
  timezone: string;
  pronouns: string;
  bio: string;
  email: string;
  avatarEmoji: string;
  updatedAt?: string;
}

const BLANK: Profile = {
  memberId: '', displayName: '', title: '', timezone: '', pronouns: '', bio: '', email: '', avatarEmoji: '👤',
};

export function DirectoryPanel() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('message', 'directory-list', { query: query.trim() || undefined });
      if (r.data?.ok) setMembers((r.data.result?.members as Profile[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile() {
    if (!editing) return;
    if (!editing.memberId.trim()) { setError('member id required'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await lensRun('message', 'profile-set', {
        memberId: editing.memberId.trim(),
        displayName: editing.displayName,
        title: editing.title,
        timezone: editing.timezone,
        pronouns: editing.pronouns,
        bio: editing.bio,
        email: editing.email,
        avatarEmoji: editing.avatarEmoji,
      });
      if (!r.data?.ok) { setError(r.data?.error ?? 'save failed'); return; }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof Profile, placeholder = '') {
    if (!editing) return null;
    return (
      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
        <input
          value={editing[key]}
          onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
          placeholder={placeholder}
          className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white mt-0.5"
        />
      </label>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-sky-400" />
        <h2 className="text-sm font-semibold text-gray-200">Member directory</h2>
        <button
          onClick={() => { setEditing({ ...BLANK }); setSelected(null); }}
          className="ml-auto px-2 py-1 text-[11px] rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1"
        >
          <UserPlus className="w-3 h-3" /> Profile
        </button>
      </div>

      {error && <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1">{error}</div>}

      <div className="flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 text-gray-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members…"
          className="flex-1 px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white"
        />
      </div>

      {editing && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3 space-y-2">
          <div className="text-xs font-semibold text-sky-200">Edit profile</div>
          {field('Member ID', 'memberId', 'handle or user id')}
          <div className="grid grid-cols-2 gap-2">
            {field('Display name', 'displayName')}
            {field('Avatar emoji', 'avatarEmoji')}
            {field('Title', 'title')}
            {field('Pronouns', 'pronouns')}
            {field('Timezone', 'timezone')}
            {field('Email', 'email')}
          </div>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Bio</span>
            <textarea
              value={editing.bio}
              onChange={(e) => setEditing({ ...editing, bio: e.target.value })}
              rows={2}
              className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white mt-0.5 resize-none"
            />
          </label>
          <div className="flex items-center gap-2">
            <button onClick={saveProfile} disabled={saving} className="px-2.5 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1 disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
            </button>
            <button onClick={() => setEditing(null)} className="px-2.5 py-1 text-xs rounded bg-white/5 text-gray-400">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-gray-600">No members yet. Add a profile to populate the directory.</p>
      ) : (
        <div className="space-y-1">
          {members.map((m) => (
            <button
              key={m.memberId}
              onClick={() => { setSelected(m); setEditing(null); }}
              className="w-full flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] px-2 py-1.5 text-left"
            >
              <span className="text-lg">{m.avatarEmoji || '👤'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-200 truncate">{m.displayName || m.memberId}</div>
                <div className="text-[10px] text-gray-500 truncate">{m.title || m.memberId}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{selected.avatarEmoji || '👤'}</span>
            <div>
              <div className="text-sm font-semibold text-gray-100">{selected.displayName || selected.memberId}</div>
              {selected.pronouns && <div className="text-[10px] text-gray-500">{selected.pronouns}</div>}
            </div>
            <button
              onClick={() => { setEditing({ ...selected }); setSelected(null); }}
              className="ml-auto text-[11px] text-sky-300"
            >
              Edit
            </button>
          </div>
          {selected.title && <div className="text-[11px] text-gray-300">{selected.title}</div>}
          {selected.timezone && <div className="text-[11px] text-gray-500">🕓 {selected.timezone}</div>}
          {selected.email && <div className="text-[11px] text-gray-500">✉ {selected.email}</div>}
          {selected.bio && <div className="text-[11px] text-gray-400 whitespace-pre-wrap pt-1">{selected.bio}</div>}
        </div>
      )}
    </div>
  );
}

export default DirectoryPanel;
