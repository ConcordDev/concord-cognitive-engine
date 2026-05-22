'use client';

/**
 * MeshMessaging — direct / group / broadcast chat over the mesh with
 * delivery + read state. Picks a node or channel, shows the thread from
 * `mesh.conversation`, sends via `mesh.sendMessage`, marks read via
 * `mesh.markRead`. Offline destinations show a "queued" badge — the
 * backend store-and-forwards them automatically.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Loader2, Send, Lock, CheckCheck, Check, Clock, AlertTriangle } from 'lucide-react';

interface MeshMessage {
  id: string;
  to: string;
  toName?: string;
  kind: 'direct' | 'group' | 'broadcast';
  body: string;
  encrypted: boolean;
  direction: 'in' | 'out';
  state: 'delivered' | 'queued' | 'failed';
  read: boolean;
  sentAt: string;
}
interface NodeRow { id: string; name: string; online: boolean; }
interface ChannelRow { id: string; name: string; encrypted: boolean; }

function StateIcon({ m }: { m: MeshMessage }) {
  if (m.state === 'failed') return <AlertTriangle className="h-3 w-3 text-rose-400" aria-label="failed" />;
  if (m.state === 'queued') return <Clock className="h-3 w-3 text-amber-400" aria-label="queued" />;
  if (m.read) return <CheckCheck className="h-3 w-3 text-teal-300" aria-label="read" />;
  return <Check className="h-3 w-3 text-teal-600" aria-label="delivered" />;
}

export function MeshMessaging() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<string>('broadcast');
  const [draft, setDraft] = useState('');

  const nodes = useQuery({
    queryKey: ['mesh-nodes'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'listNodes', {});
      return (r.data?.result ?? r.data) as { nodes: NodeRow[] };
    },
    refetchInterval: 30_000,
  });

  const channels = useQuery({
    queryKey: ['mesh-group-channels'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'listChannels', {});
      return (r.data?.result ?? r.data) as { channels: ChannelRow[] };
    },
  });

  const thread = useQuery({
    queryKey: ['mesh-conversation', target],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'conversation', { with: target });
      return (r.data?.result ?? r.data) as { messages: MeshMessage[]; total: number; unread: number };
    },
    refetchInterval: 10_000,
  });

  const markRead = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('mesh', 'markRead', { with: target })).data?.result,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mesh-conversation', target] }),
  });

  const send = useMutation({
    mutationFn: async () =>
      (await apiHelpers.lens.runDomain('mesh', 'sendMessage', { to: target, body: draft.trim() })).data?.result,
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['mesh-conversation', target] });
      qc.invalidateQueries({ queryKey: ['mesh-queue'] });
      qc.invalidateQueries({ queryKey: ['mesh-overview'] });
    },
  });

  // Mark the open thread read when it has unread inbound messages.
  useEffect(() => {
    if ((thread.data?.unread ?? 0) > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.data?.unread, target]);

  const messages = thread.data?.messages ?? [];
  const targets = useMemo(
    () => [
      { id: 'broadcast', label: 'Broadcast (all nodes)', kind: 'broadcast' as const },
      ...((channels.data?.channels ?? []).map((c) => ({ id: c.id, label: `# ${c.name}`, kind: 'group' as const }))),
      ...((nodes.data?.nodes ?? []).map((n) => ({ id: n.id, label: `${n.online ? '● ' : '○ '}${n.name}`, kind: 'direct' as const }))),
    ],
    [channels.data, nodes.data],
  );

  return (
    <div className="grid gap-4 md:grid-cols-[200px_1fr]">
      <aside className="space-y-1">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-teal-600">Conversations</h3>
        {targets.map((t) => (
          <button
            key={t.id}
            onClick={() => setTarget(t.id)}
            className={`block w-full truncate rounded px-2.5 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-teal-400 ${
              target === t.id ? 'bg-teal-800/50 text-teal-100' : 'text-teal-500 hover:bg-teal-950/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </aside>

      <div className="flex min-h-[320px] flex-col rounded-lg border border-teal-900/40 bg-black">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {thread.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-xs text-teal-700">No messages yet. Send the first frame.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${
                  m.direction === 'out' ? 'bg-teal-800/50 text-teal-50' : 'bg-zinc-800/60 text-zinc-100'
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-teal-500/80">
                    <span>{new Date(m.sentAt).toLocaleTimeString()}</span>
                    {m.encrypted && <Lock className="h-2.5 w-2.5" aria-label="encrypted" />}
                    <span className="rounded bg-black/40 px-1">{m.kind}</span>
                    {m.direction === 'out' && <StateIcon m={m} />}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}
          className="flex gap-2 border-t border-teal-900/40 p-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${target === 'broadcast' ? 'all nodes' : targets.find((t) => t.id === target)?.label ?? ''}…`}
            className="flex-1 rounded border border-teal-900/50 bg-black px-3 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            className="inline-flex items-center gap-1.5 rounded bg-teal-700/60 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-600/70 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            {send.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
          </button>
        </form>
      </div>
    </div>
  );
}
