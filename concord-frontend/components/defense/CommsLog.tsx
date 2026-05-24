'use client';

/**
 * CommsLog — secure comms message board, channel-filtered.
 * Backed by defense.comms-post / comms-ack / comms-delete /
 * comms-log macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Trash2, Loader2, Radio, Check, Lock, Send } from 'lucide-react';

interface CommsMessage {
  id: string;
  channel: string;
  body: string;
  classification: 'unclassified' | 'confidential' | 'secret' | 'top_secret';
  precedence: 'routine' | 'priority' | 'immediate' | 'flash';
  sender: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  postedAt: string;
}

interface CommsLogResult {
  messages: CommsMessage[];
  channels: string[];
  total: number;
  unacknowledged: number;
}

const CLASSIFICATIONS = ['unclassified', 'confidential', 'secret', 'top_secret'] as const;
const PRECEDENCES = ['routine', 'priority', 'immediate', 'flash'] as const;

const CLASS_COLOR: Record<string, string> = {
  unclassified: 'text-green-400 border-green-500/30',
  confidential: 'text-blue-400 border-blue-500/30',
  secret: 'text-orange-400 border-orange-500/30',
  top_secret: 'text-red-400 border-red-500/40',
};

const PREC_COLOR: Record<string, string> = {
  routine: 'text-zinc-400',
  priority: 'text-yellow-400',
  immediate: 'text-orange-400',
  flash: 'text-red-400',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function CommsLog() {
  const [data, setData] = useState<CommsLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);

  const [channel, setChannel] = useState('');
  const [body, setBody] = useState('');
  const [classification, setClassification] = useState<typeof CLASSIFICATIONS[number]>('unclassified');
  const [precedence, setPrecedence] = useState<typeof PRECEDENCES[number]>('routine');
  const [sender, setSender] = useState('');

  const refresh = useCallback(async (filter: string | null) => {
    setLoading(true);
    setError(null);
    const params: Record<string, unknown> = {};
    if (filter) params.channel = filter;
    const r = await lensRun<CommsLogResult>('defense', 'comms-log', params);
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Failed to load comms log');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectChannel = useCallback((c: string | null) => {
    setChannelFilter(c);
    refresh(c);
  }, [refresh]);

  const post = useCallback(async () => {
    if (!channel.trim() || !body.trim()) {
      setError('Channel and message body are required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'comms-post', {
      channel: channel.trim(),
      body: body.trim(),
      classification,
      precedence,
      sender: sender.trim(),
    });
    if (r.data?.ok) {
      setBody('');
      await refresh(channelFilter);
    } else {
      setError(r.data?.error || 'Failed to post message');
    }
    setBusy(false);
  }, [channel, body, classification, precedence, sender, channelFilter, refresh]);

  const ack = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'comms-ack', { id });
    if (r.data?.ok) await refresh(channelFilter);
    else setError(r.data?.error || 'Failed to acknowledge message');
    setBusy(false);
  }, [channelFilter, refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'comms-delete', { id });
    if (r.data?.ok) await refresh(channelFilter);
    else setError(r.data?.error || 'Failed to delete message');
    setBusy(false);
  }, [channelFilter, refresh]);

  const messages = data?.messages || [];
  const channels = data?.channels || [];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-white">Secure Comms Log</h3>
        </div>
        {data && (
          <div className="flex gap-3 text-[11px]">
            {data.unacknowledged > 0 && (
              <span className="text-amber-400">{data.unacknowledged} unacked</span>
            )}
            <span className="text-zinc-400">{data.total} messages</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Channel filter */}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => selectChannel(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              channelFilter === null
                ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            all channels
          </button>
          {channels.map((c) => (
            <button
              key={c}
              onClick={() => selectChannel(c)}
              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                channelFilter === c
                  ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              #{c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded border px-2.5 py-2 ${CLASS_COLOR[m.classification].split(' ')[1]} bg-zinc-900/60`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-purple-400 shrink-0">#{m.channel}</span>
                  <span className={`text-[10px] font-bold uppercase shrink-0 flex items-center gap-0.5 ${CLASS_COLOR[m.classification].split(' ')[0]}`}>
                    <Lock className="w-2.5 h-2.5" />
                    {m.classification}
                  </span>
                  <span className={`text-[10px] uppercase shrink-0 ${PREC_COLOR[m.precedence]}`}>
                    {m.precedence}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0">{m.sender}</span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {!m.acknowledged && (
                    <button
                      onClick={() => ack(m.id)}
                      disabled={busy}
                      title="Acknowledge"
                      className="p-1 text-zinc-400 hover:text-green-400 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => remove(m.id)}
                    disabled={busy}
                    aria-label="Delete message"
                    className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-zinc-200 mt-1 whitespace-pre-wrap">{m.body}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-zinc-400">{fmtTime(m.postedAt)}</span>
                {m.acknowledged && (
                  <span className="text-[10px] text-green-500 flex items-center gap-0.5">
                    <Check className="w-2.5 h-2.5" />
                    acknowledged
                  </span>
                )}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-400">
              <Radio className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No messages{channelFilter ? ` on #${channelFilter}` : ''}. Post one below.
            </div>
          )}
        </div>
      )}

      {/* New message */}
      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="Channel"
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
          />
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="Sender (callsign)"
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
          />
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as typeof classification)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={precedence}
            onChange={(e) => setPrecedence(e.target.value as typeof precedence)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
          >
            {PRECEDENCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message body…"
            rows={2}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white resize-none"
          />
          <button
            onClick={post}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 self-stretch"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Post
          </button>
        </div>
      </div>
    </section>
  );
}
