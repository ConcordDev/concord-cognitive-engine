'use client';

/**
 * TideActionStack — Windy / NOAA-shape action surface for the ocean
 * lens. Pulls live NOAA tide predictions for a station, then exposes
 * 5 real-backend actions on top of them.
 *
 *   1. Mint window DTU      → dtu.create with full prediction set
 *                             (private; tags=[ocean,tides,station:N])
 *   2. DM boating brief     → /api/social/dm with the day's high/low
 *                             window + station name + safety note
 *   3. Publish mariner brief → dtu.create public + cite + flag published
 *                             (federation pickup for sailing communities)
 *   4. Agent — best window   → chat_agent.do "when's the best 2-3h
 *                             window for {activity} at {station}?"
 *   5. Copy CSV              → clipboard write of prediction rows
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Waves, Send, Globe, Wand2, FileDown, Sparkles,
  Loader2, Check, AlertTriangle, ArrowUp, ArrowDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Prediction { time: string; height: number; type: 'high' | 'low' }
interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('ocean', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const STATIONS = [
  { id: '9414290', name: 'San Francisco, CA' },
  { id: '8518750', name: 'The Battery, NY' },
  { id: '8443970', name: 'Boston, MA' },
  { id: '8723214', name: 'Virginia Key, FL' },
  { id: '9447130', name: 'Seattle, WA' },
];

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mint' | 'dm' | 'publish' | 'agent' | 'csv';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function TideActionStack() {
  const [stationId, setStationId] = useState('9414290');
  const [preds, setPreds] = useState<Prediction[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [windowDtuId, setWindowDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [activityQ, setActivityQ] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<{ predictions: Prediction[] }>('noaa-tide-prediction', { stationId }),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        setPreds(env.result.predictions);
        setLoadError(null);
        setWindowDtuId(null);
        setPublishedDtuId(null);
        setAgentReply(null);
      } else { setPreds([]); setLoadError(env.error || 'no predictions returned'); }
    },
    onError: (e) => { setPreds([]); setLoadError(pickMessage(e)); },
  });

  const stationName = STATIONS.find(s => s.id === stationId)?.name ?? stationId;
  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  function summary(): string {
    if (!preds.length) return '';
    const rows = preds.slice(0, 6).map(p =>
      `${p.type === 'high' ? '↑ HIGH' : '↓ LOW '} ${new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${p.height.toFixed(2)} m`,
    ).join('\n');
    return `🌊 ${stationName} tide predictions:\n${rows}`;
  }

  async function actMint() {
    if (!preds.length) { err('Load predictions first.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Tide window — ${stationName} — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['ocean', 'tides', 'noaa', `station:${stationId}`],
          source: 'ocean:tides:window',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            tide: { stationId, stationName, predictions: preds, fetchedAt: new Date().toISOString() },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setWindowDtuId(id); ok(`Window saved as DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!preds.length) { err('Load predictions first.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = `${summary()}\n\nUse official tide tables for navigation.`;
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Brief sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!preds.length) { err('Load predictions first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Mariner brief — ${stationName} — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['ocean', 'tides', 'noaa', 'mariner-brief', 'public', `station:${stationId}`],
          source: 'ocean:tides:public',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            tide: { stationId, stationName, predictions: preds },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Mariner brief published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!preds.length) { err('Load predictions first.'); return; }
    if (!activityQ.trim()) { err('Describe the activity.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Tide predictions for ${stationName} (NOAA station ${stationId}):`,
        preds.slice(0, 8).map(p => `${p.type} ${new Date(p.time).toLocaleString()} ${p.height}m`).join('; '),
        ``,
        `Activity: ${activityQ.trim()}.`,
        ``,
        'Return the best 2-3h window with reasoning (current direction, slack water, safety).',
      ].join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Window brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCsv() {
    if (!preds.length) { err('Load predictions first.'); return; }
    setBusy('csv'); setFeedback(null);
    try {
      const header = 'time,type,heightMeters';
      const rows = preds.map(p => `${p.time},${p.type},${p.height}`);
      await navigator.clipboard.writeText([header, ...rows].join('\n'));
      ok(`${preds.length} row${preds.length === 1 ? '' : 's'} copied as CSV.`);
    } catch { err('Clipboard write blocked.'); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'mint',    label: windowDtuId   ? 'Window saved'   : 'Mint window',     desc: windowDtuId   ? `DTU ${windowDtuId.slice(0, 8)}…`   : 'Private DTU with full predictions',         icon: Sparkles, accent: '#06b6d4', handler: actMint,    disabled: !preds.length || !!windowDtuId },
    { id: 'dm',      label: 'DM boating brief',                                    desc: preds.length ? 'DM the day\'s high/low window' : 'Load tides first',                              icon: Send,     accent: '#ec4899', handler: actDm,      disabled: !preds.length },
    { id: 'publish', label: publishedDtuId ? 'Brief published' : 'Publish mariner', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public DTU + federation flag',          icon: Globe,    accent: '#22c55e', handler: actPublish, disabled: !preds.length || !!publishedDtuId },
    { id: 'agent',   label: 'Best window (agent)',                                  desc: 'Agent picks the safest 2-3h window for your activity',                                          icon: Wand2,    accent: '#eab308', handler: actAgent,   disabled: !preds.length },
    { id: 'csv',     label: 'Copy CSV',                                             desc: preds.length ? `${preds.length} predictions → clipboard` : '—',                                  icon: FileDown, accent: '#3b82f6', handler: actCsv,     disabled: !preds.length },
  ];

  const next = preds[0];
  const after = preds[1];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Waves className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Tide actions</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          noaa · live
        </span>
      </header>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Station</label>
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
          {STATIONS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          type="button" onClick={() => load.mutate()}
          disabled={load.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {load.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load tides'}
        </button>
      </div>

      {loadError && (
        <div className="px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">{loadError}</div>
      )}

      {next && (
        <div className="rounded-lg border-2 border-cyan-500/40 bg-zinc-900/60 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              {next.type === 'high' ? <ArrowUp className="h-5 w-5 text-cyan-300" /> : <ArrowDown className="h-5 w-5 text-cyan-300" />}
              <span className="text-2xl font-bold text-cyan-300">{next.height.toFixed(2)}m</span>
              <span className="text-xs text-zinc-400 uppercase tracking-wider">{next.type} tide</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono">{stationName}</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">
            Next: {new Date(next.time).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            {after && ` · after that: ${after.type} ${after.height.toFixed(2)}m at ${new Date(after.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
      )}

      {preds.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for brief)</label>
            <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="username or user id" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Activity (for agent)</label>
            <input type="text" value={activityQ} onChange={(e) => setActivityQ(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40" placeholder="kite-surfing, kayak, surf, dive…" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800',
                'hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-cyan-400/40',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {agentReply && (
        <div className="px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-[11px] text-zinc-200 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="h-3 w-3" />
            Best window
          </div>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
