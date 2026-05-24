'use client';

/**
 * MeshChannels — broadcast / named group channel management with
 * per-channel pre-shared key (PSK) encryption. Create channels
 * (`mesh.createChannel`), list them (`mesh.listChannels`), rotate or
 * clear their key (`mesh.setChannelKey`), and delete them
 * (`mesh.deleteChannel`). PSKs are never returned in clear — the
 * backend masks them.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Loader2, Plus, Trash2, Lock, Unlock, KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  encrypted: boolean;
  keyStrength: 'aes-256' | 'aes-128' | 'weak' | 'none';
  transport: string;
  members: string[];
  psk: string | null;
}

const STRENGTH_TONE: Record<string, string> = {
  'aes-256': 'text-emerald-300',
  'aes-128': 'text-teal-300',
  weak: 'text-amber-300',
  none: 'text-zinc-400',
};

export function MeshChannels() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [psk, setPsk] = useState('');
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

  const channels = useQuery({
    queryKey: ['mesh-group-channels'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'listChannels', {});
      return (r.data?.result ?? r.data) as { channels: Channel[]; total: number; encrypted: number };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mesh-group-channels'] });
    qc.invalidateQueries({ queryKey: ['mesh-overview'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      (await apiHelpers.lens.runDomain('mesh', 'createChannel', { name: name.trim(), psk: psk.trim() || undefined })).data?.result,
    onSuccess: () => { setName(''); setPsk(''); invalidate(); },
  });
  const setKey = useMutation({
    mutationFn: async (v: { channelId: string; psk: string }) =>
      (await apiHelpers.lens.runDomain('mesh', 'setChannelKey', v)).data?.result,
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: async (channelId: string) => (await apiHelpers.lens.runDomain('mesh', 'deleteChannel', { channelId })).data?.result,
    onSuccess: invalidate,
  });

  const list = channels.data?.channels ?? [];

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-teal-900/40 bg-teal-950/10 p-3"
      >
        <label className="flex flex-col gap-1 text-[11px] text-teal-600">
          Channel name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. relay-ops"
            className="rounded border border-teal-900/50 bg-black px-2 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-teal-600">
          Pre-shared key (optional, 32+ chars → AES-256)
          <input
            value={psk}
            onChange={(e) => setPsk(e.target.value)}
            placeholder="leave blank for open channel"
            className="w-64 rounded border border-teal-900/50 bg-black px-2 py-1.5 font-mono text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="inline-flex items-center gap-1.5 rounded bg-teal-700/60 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-600/70 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create channel
        </button>
      </form>

      {channels.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
      ) : list.length === 0 ? (
        <p className="rounded border border-teal-900/30 bg-teal-950/10 px-4 py-6 text-center text-xs text-teal-600">
          No group channels yet. Create one above for multicast messaging.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-teal-700">
            {channels.data?.total} channel{channels.data?.total !== 1 ? 's' : ''} · {channels.data?.encrypted} encrypted
          </p>
          <ul className="space-y-2">
            {list.map((c) => (
              <li key={c.id} className="rounded-lg border border-teal-900/30 bg-teal-950/10 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {c.encrypted ? <Lock className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> : <Unlock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />}
                  <span className="font-mono text-sm text-teal-100"># {c.name}</span>
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    {c.encrypted
                      ? <ShieldCheck className="h-3 w-3 text-emerald-400" />
                      : <ShieldAlert className="h-3 w-3 text-amber-400" />}
                    <span className={STRENGTH_TONE[c.keyStrength]}>{c.keyStrength}</span>
                  </span>
                  <span className="rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] text-teal-400">{c.transport}</span>
                  <button
                    onClick={() => del.mutate(c.id)}
                    disabled={del.isPending}
                    className="ml-auto rounded p-1 text-rose-400 hover:bg-rose-950/40 disabled:opacity-40"
                    aria-label={`Delete channel ${c.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-teal-600" aria-hidden />
                  <input
                    value={keyDraft[c.id] ?? ''}
                    onChange={(e) => setKeyDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                    placeholder={c.encrypted ? 'new PSK (rotate)' : 'set PSK to encrypt'}
                    className="w-56 rounded border border-teal-900/50 bg-black px-2 py-1 font-mono text-[11px] text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <button
                    onClick={() => { setKey.mutate({ channelId: c.id, psk: keyDraft[c.id] ?? '' }); setKeyDraft((d) => ({ ...d, [c.id]: '' })); }}
                    disabled={setKey.isPending}
                    className="rounded bg-teal-800/50 px-2.5 py-1 text-[11px] text-teal-100 hover:bg-teal-700/60 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  >
                    {c.encrypted ? 'Rotate key' : 'Encrypt'}
                  </button>
                  {c.encrypted && (
                    <button
                      onClick={() => setKey.mutate({ channelId: c.id, psk: '' })}
                      disabled={setKey.isPending}
                      className="rounded border border-teal-900/50 px-2.5 py-1 text-[11px] text-teal-400 hover:bg-teal-900/30 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
                    >
                      Clear key
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
