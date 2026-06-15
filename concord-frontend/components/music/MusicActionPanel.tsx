'use client';

/**
 * MusicActionPanel — Spotify + Ableton-shape music workbench. Surfaces
 * bpmAnalyze / keyDetect / chordProgress / setlistPlan + mint/DM/
 * publish/agent. Tight compact-template variant.
 */

import { useState } from 'react';
import {
  Music, Activity, Key, ListMusic, Disc3,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('music', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'bpm' | 'key' | 'chords' | 'setlist' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface BpmResult { bpm?: number; confidence?: number; tempoBand?: string }
interface KeyResult { key?: string; scale?: string; relativeKey?: string }
interface ChordResult { progression?: string[]; analysis?: string; commonPattern?: string }
interface SetlistResult { tracks?: Array<{ title: string; bpm: number; key: string; position: number }>; totalMinutes?: number; energyArc?: string }

export function MusicActionPanel() {
  const [trackTitle, setTrackTitle] = useState('');
  const [audioMeta, setAudioMeta] = useState('');
  const [chordsInput, setChordsInput] = useState('');
  const [setlistInput, setSetlistInput] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [bpmResult, setBpmResult] = useState<BpmResult | null>(null);
  const [keyResult, setKeyResult] = useState<KeyResult | null>(null);
  const [chordResult, setChordResult] = useState<ChordResult | null>(null);
  const [setlistResult, setSetlistResult] = useState<SetlistResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actBpm() {
    if (!audioMeta.trim()) { err('Paste audio meta JSON.'); return; }
    setBusy('bpm'); setFeedback(null);
    try { const meta = JSON.parse(audioMeta); const r = await callMacro<BpmResult>('bpmAnalyze', meta); if (r.ok && r.result) { setBpmResult(r.result); pipe.publish('music.bpm', r.result, { label: `${r.result.bpm} BPM` }); ok(`BPM ${r.result.bpm}.`); } else err(r.error ?? 'bpm failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actKey() {
    if (!audioMeta.trim()) { err('Paste audio meta JSON.'); return; }
    setBusy('key'); setFeedback(null);
    try { const meta = JSON.parse(audioMeta); const r = await callMacro<KeyResult>('keyDetect', meta); if (r.ok && r.result) { setKeyResult(r.result); pipe.publish('music.key', r.result, { label: `${r.result.key} ${r.result.scale}` }); ok(`Key: ${r.result.key} ${r.result.scale}.`); } else err(r.error ?? 'key failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actChords() {
    const chords = chordsInput.split(/\s+/).filter(Boolean);
    if (!chords.length) { err('Add chords.'); return; }
    setBusy('chords'); setFeedback(null);
    try { const r = await callMacro<ChordResult>('chordProgress', { chords }); if (r.ok && r.result) { setChordResult(r.result); pipe.publish('music.chords', r.result, { label: r.result.commonPattern ?? 'progression' }); ok('Progression analyzed.'); } else err(r.error ?? 'chord failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSetlist() {
    const tracks = setlistInput.split('\n').map(l => { const m = l.trim().match(/^(.+?)\s+(\d+)\s+(\S+)$/); return m ? { title: m[1], bpm: parseInt(m[2], 10), key: m[3] } : null; }).filter(Boolean);
    if (!tracks.length) { err('Add setlist (title bpm key per line).'); return; }
    setBusy('setlist'); setFeedback(null);
    try { const r = await callMacro<SetlistResult>('setlistPlan', { tracks }); if (r.ok && r.result) { setSetlistResult(r.result); pipe.publish('music.setlist', r.result, { label: `${r.result.totalMinutes}min` }); ok(`Setlist: ${r.result.totalMinutes}min.`); } else err(r.error ?? 'setlist failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Music — ${trackTitle.trim() || 'session'}`, tags: ['music', bpmResult ? `bpm:${bpmResult.bpm}` : '', keyResult?.key ? `key:${keyResult.key}` : ''].filter(Boolean), source: 'music:session:mint', meta: { visibility: 'private', consent: { allowCitations: false }, music: { title: trackTitle, bpm: bpmResult, key: keyResult, chords: chordResult, setlist: setlistResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('music.mintedDtuId', id, { label: `session ${id.slice(0, 8)}` }); ok(`Music DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎵 Music brief: ${trackTitle || 'session'}`, '', bpmResult ? `BPM ${bpmResult.bpm} (${bpmResult.tempoBand})` : '', keyResult ? `Key ${keyResult.key} ${keyResult.scale}` : '', chordResult ? `Progression: ${chordResult.progression?.join(' → ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Public track — ${trackTitle.trim() || 'untitled'}`, tags: ['music', 'public', bpmResult ? `bpm:${bpmResult.bpm}` : ''].filter(Boolean), source: 'music:track:publish', meta: { visibility: 'public', consent: { allowCitations: true }, track: { title: trackTitle, bpm: bpmResult?.bpm, key: keyResult?.key, chords: chordResult?.progression, setlist: setlistResult } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('music.publishedDtuId', id, { label: `track ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Track: "${trackTitle || 'untitled'}". ${bpmResult ? `BPM ${bpmResult.bpm}.` : ''} ${keyResult ? `Key ${keyResult.key} ${keyResult.scale}.` : ''} ${chordResult ? `Chords: ${chordResult.progression?.join(' ')}.` : ''} Suggest 3 production moves (compression / EQ / arrangement) that elevate this track. Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Production moves ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'bpm' as ActionId, label: 'BPM', desc: 'Analyze tempo', icon: Activity, accent: '#22c55e', handler: actBpm },
    { id: 'key' as ActionId, label: 'Key', desc: 'Detect key + scale', icon: Key, accent: '#06b6d4', handler: actKey },
    { id: 'chords' as ActionId, label: 'Chords', desc: 'Progression analysis', icon: Disc3, accent: '#8b5cf6', handler: actChords },
    { id: 'setlist' as ActionId, label: 'Setlist', desc: 'Plan track order + energy arc', icon: ListMusic, accent: '#f97316', handler: actSetlist },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private music DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to collaborator', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public track DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Production', desc: 'Agent: 3 production moves', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Music className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Music workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={trackTitle} onChange={(e) => setTrackTitle(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Track title" />
        <input type="text" value={chordsInput} onChange={(e) => setChordsInput(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Chords (space-separated)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Audio meta JSON</label>
          <textarea value={audioMeta} onChange={(e) => setAudioMeta(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-purple-200 font-mono focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Setlist (title bpm key per line)</label>
          <textarea value={setlistInput} onChange={(e) => setSetlistInput(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-purple-200 font-mono focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        {bpmResult && <Tile label="BPM" big={String(bpmResult.bpm)} sub={bpmResult.tempoBand} accent="#22c55e" />}
        {keyResult && <Tile label="Key" big={keyResult.key ?? '—'} sub={keyResult.scale} accent="#06b6d4" />}
        {chordResult && <Tile label="Chords" big={chordResult.commonPattern ?? 'progression'} sub={chordResult.progression?.join(' → ')} accent="#8b5cf6" />}
        {setlistResult && <Tile label="Setlist" big={`${setlistResult.totalMinutes}m`} sub={setlistResult.energyArc} accent="#f97316" />}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Production</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, big, sub, accent }: { label: string; big: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div>
      <div className="text-xl font-bold truncate" style={{ color: accent }}>{big}</div>
      {sub && <div className="text-[10px] text-zinc-400 truncate">{sub}</div>}
    </div>
  );
}
