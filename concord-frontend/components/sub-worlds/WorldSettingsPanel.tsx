'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from 'react';
import { X, Trash2, Archive, UserPlus, Pause, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SubWorld } from './WorldCard';

const KINDS = ['physics_simulator', 'research_zone', 'concord_substrate'];
const PRIVACIES = ['public', 'unlisted', 'private'];

export function WorldSettingsPanel({
  world,
  onClose,
  onChanged,
}: {
  world: SubWorld;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(world.name);
  const [description, setDescription] = useState(world.description);
  const [thumbnail, setThumbnail] = useState(world.thumbnail);
  const [privacy, setPrivacy] = useState(world.privacy);
  const [kind, setKind] = useState(world.kind);
  const [capacity, setCapacity] = useState(world.capacity);
  const [editors, setEditors] = useState<string[]>(world.editors || []);
  const [inviteId, setInviteId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  };

  const saveSettings = async () => {
    setBusy(true);
    const r = await lensRun('sub_worlds', 'update_settings', {
      worldId: world.world_id,
      name,
      description,
      thumbnail,
      privacy,
      kind,
      capacity,
    });
    setBusy(false);
    if (r.data?.ok) {
      flash('Settings saved.');
      onChanged();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const toggleStatus = async () => {
    const next = world.status === 'paused' ? 'active' : 'paused';
    const r = await lensRun('sub_worlds', 'set_status', { worldId: world.world_id, status: next });
    if (r.data?.ok) {
      flash(`World ${next}.`);
      onChanged();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const archive = async (hard: boolean) => {
    const r = await lensRun('sub_worlds', 'archive', {
      worldId: world.world_id,
      hardDelete: hard,
    });
    if (r.data?.ok) {
      flash(hard ? 'World deleted.' : 'World archived.');
      onChanged();
      if (hard) onClose();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const invite = async () => {
    if (!inviteId.trim()) return;
    const r = await lensRun('sub_worlds', 'invite_editor', {
      worldId: world.world_id,
      editorUserId: inviteId.trim(),
    });
    if (r.data?.ok) {
      setEditors((r.data.result as any).editors || []);
      setInviteId('');
      flash('Editor invited.');
      onChanged();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const removeEditor = async (id: string) => {
    const r = await lensRun('sub_worlds', 'remove_editor', {
      worldId: world.world_id,
      editorUserId: id,
    });
    if (r.data?.ok) {
      setEditors((r.data.result as any).editors || []);
      flash('Editor removed.');
      onChanged();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan-800/60 bg-zinc-950 p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-bold text-cyan-300">World Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </header>

        {msg && (
          <div className="rounded-lg bg-cyan-950/60 border border-cyan-700/50 px-3 py-2 text-xs text-cyan-200">
            {msg}
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-[11px] uppercase tracking-wider text-zinc-500">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] uppercase tracking-wider text-zinc-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] uppercase tracking-wider text-zinc-500">Thumbnail URL</label>
          <input
            value={thumbnail}
            onChange={(e) => setThumbnail(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Privacy</label>
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
            >
              {PRIVACIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
            >
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Capacity</label>
            <input
              type="number"
              min={1}
              max={200}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={saveSettings}
          disabled={busy}
          className="w-full rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Save Settings
        </button>

        <div className="border-t border-zinc-800 pt-3 space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500">Co-Editors</h3>
          {editors.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">No co-editors yet.</p>
          ) : (
            <ul className="space-y-1">
              {editors.map((e) => (
                <li key={e} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                  <span className="font-mono">{e}</span>
                  <button
                    type="button"
                    onClick={() => removeEditor(e)}
                    className="text-rose-400 hover:text-rose-300"
                    aria-label="Remove editor"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={inviteId}
              onChange={(e) => setInviteId(e.target.value)}
              placeholder="User id to invite"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
            <button
              type="button"
              onClick={invite}
              className="flex items-center gap-1 rounded-lg bg-fuchsia-800 hover:bg-fuchsia-700 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite
            </button>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleStatus}
            className="flex items-center gap-1 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/40 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {world.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {world.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => archive(false)}
            className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Archive className="h-3.5 w-3.5" /> Archive
          </button>
          <button
            type="button"
            onClick={() => archive(true)}
            className="flex items-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-900/40 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
