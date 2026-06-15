'use client';

/**
 * StudioActionPanel — Ableton Live-shape session workbench. Surfaces
 * project / track / effect / render macros plus mint/DM/publish/agent.
 */

import { useState, useEffect } from 'react';
import {
  Music, Disc, Plus, Sliders, Clock, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Headphones,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('studio', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

interface Project { id: string; name: string; bpm?: number; trackCount?: number }
interface RenderResult { estimatedMinutes?: number; sizeMb?: number; format?: string; rationale?: string }
interface TimelineResult { milestones?: Array<{ name: string; targetDate: string; status: string }>; criticalPath?: string[] }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'create' | 'addTrack' | 'addEffect' | 'render' | 'timeline' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function StudioActionPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState('');
  const [projectBpm, setProjectBpm] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [trackName, setTrackName] = useState('');
  const [trackType, setTrackType] = useState<'audio' | 'midi' | 'instrument' | 'return'>('audio');
  const [effectName, setEffectName] = useState('');
  const [renderFormat, setRenderFormat] = useState<'wav' | 'mp3' | 'flac' | 'stems'>('wav');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [timelineResult, setTimelineResult] = useState<TimelineResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

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

  useEffect(() => {
    (async () => {
      try {
        const r = await callMacro<{ projects: Project[] }>('project-list', {});
        if (r.ok && r.result?.projects) setProjects(r.result.projects);
      } catch {/* dormant */}
    })();
  }, []);

  async function actCreate() {
    if (!projectName.trim()) { err('Project name required.'); return; }
    setBusy('create'); setFeedback(null);
    try {
      const r = await callMacro<{ project: Project }>('project-create', { name: projectName.trim(), bpm: parseInt(projectBpm, 10) });
      if (r.ok && r.result?.project) {
        setCurrentProjectId(r.result.project.id);
        setProjects(prev => [...prev, r.result!.project]);
        pipe.publish('studio.project', r.result.project, { label: r.result.project.name });
        ok(`Project created: ${r.result.project.id.slice(0, 8)}…`);
      } else err(r.error ?? 'create failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAddTrack() {
    if (!currentProjectId || !trackName.trim()) { err('Project + track name required.'); return; }
    setBusy('addTrack'); setFeedback(null);
    try {
      const r = await callMacro<{ track?: { id: string } }>('track-add', { projectId: currentProjectId, name: trackName.trim(), type: trackType });
      if (r.ok && r.result?.track) { pipe.publish('studio.track', r.result.track, { label: `track ${r.result.track.id.slice(0, 6)}` }); ok(`Track added: ${r.result.track.id.slice(0, 8)}.`); setTrackName(''); }
      else err(r.error ?? 'track add failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAddEffect() {
    if (!currentProjectId || !effectName.trim()) { err('Project + effect name required.'); return; }
    setBusy('addEffect'); setFeedback(null);
    try {
      const r = await callMacro<{ effect?: { id: string } }>('effect-add', { projectId: currentProjectId, effectName: effectName.trim() });
      if (r.ok && r.result) { pipe.publish('studio.effect', { name: effectName.trim() }, { label: effectName.trim() }); ok(`Effect added: ${effectName.trim()}.`); }
      else err(r.error ?? 'effect add failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actRender() {
    if (!currentProjectId) { err('Select a project.'); return; }
    setBusy('render'); setFeedback(null);
    try {
      const r = await callMacro<RenderResult>('renderEstimate', { projectId: currentProjectId, format: renderFormat });
      if (r.ok && r.result) { setRenderResult(r.result); pipe.publish('studio.render', r.result, { label: `~${r.result.estimatedMinutes}min` }); ok(`Render estimate: ~${r.result.estimatedMinutes}min.`); }
      else err(r.error ?? 'render failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actTimeline() {
    if (!currentProjectId) { err('Select a project.'); return; }
    setBusy('timeline'); setFeedback(null);
    try {
      const r = await callMacro<TimelineResult>('projectTimeline', { projectId: currentProjectId });
      if (r.ok && r.result) { setTimelineResult(r.result); pipe.publish('studio.timeline', r.result, { label: `${r.result.milestones?.length ?? 0} milestones` }); ok(`${r.result.milestones?.length ?? 0} milestones.`); }
      else err(r.error ?? 'timeline failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!currentProjectId) { err('Create or select a project first.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Studio project — ${projectName.trim() || currentProjectId.slice(0, 8)}`,
          tags: ['studio', 'project', `bpm:${projectBpm}`],
          source: 'studio:project:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, project: { id: currentProjectId, name: projectName, bpm: parseInt(projectBpm, 10), render: renderResult, timeline: timelineResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('studio.mintedDtuId', id, { label: `project ${id.slice(0, 8)}` }); ok(`Project DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🎵 Studio: ${projectName || currentProjectId}`, '',
      `BPM ${projectBpm}`,
      renderResult ? `Render: ${renderResult.estimatedMinutes}min · ${renderResult.sizeMb}MB · ${renderResult.format}` : '',
      timelineResult ? `Milestones: ${timelineResult.milestones?.length}` : '',
      mintedDtuId ? `\n[Project DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!currentProjectId) { err('Select a project.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Public release — ${projectName.trim() || currentProjectId}`,
            tags: ['studio', 'release', 'public', `bpm:${projectBpm}`],
            source: 'studio:release:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, release: { name: projectName, bpm: parseInt(projectBpm, 10), format: renderFormat } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('studio.publishedDtuId', id, { label: `release ${id.slice(0, 8)}` }); ok(`Release published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Studio project: "${projectName || 'untitled'}" at ${projectBpm} BPM.`,
        renderResult ? `Render: ~${renderResult.estimatedMinutes}min in ${renderResult.format}.` : '',
        '',
        'Suggest 3 mix-finalization moves: name the technique, the bus/track it applies to, and what change a listener would hear. Plain text, one per line.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Mix moves ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'create',    label: currentProjectId ? 'Created' : 'Create',    desc: currentProjectId ? `id ${currentProjectId.slice(0, 8)}…` : 'project-create new session',                          icon: Disc,        accent: '#22c55e', handler: actCreate },
    { id: 'addTrack',  label: '+ Track',    desc: 'track-add to current project',                  icon: Plus,        accent: '#06b6d4', handler: actAddTrack,    disabled: !currentProjectId },
    { id: 'addEffect', label: '+ Effect',   desc: 'effect-add to current project',                 icon: Sliders,     accent: '#8b5cf6', handler: actAddEffect,   disabled: !currentProjectId },
    { id: 'render',    label: 'Render',     desc: 'renderEstimate size + minutes',                 icon: Headphones,  accent: '#eab308', handler: actRender,      disabled: !currentProjectId },
    { id: 'timeline',  label: 'Timeline',   desc: 'projectTimeline milestones',                    icon: Clock,       accent: '#f97316', handler: actTimeline,    disabled: !currentProjectId },
    { id: 'mint',      label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private project DTU',                                  icon: Sparkles,    accent: '#3b82f6', handler: actMint },
    { id: 'dm',        label: 'DM',         desc: 'Send project brief',                            icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',   label: publishedDtuId ? 'Published' : 'Publish',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public release DTU + federation',          icon: Globe,       accent: '#15803d', handler: actPublish,     disabled: !currentProjectId },
    { id: 'agent',     label: 'Mix moves',  desc: 'Agent: 3 mix-finalization moves',               icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Music className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Studio session</h3>
        {currentProjectId && <span className="ml-auto text-[10px] text-purple-300 font-mono">▶ {currentProjectId.slice(0, 8)}</span>}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Project name" />
        <input type="text" value={projectBpm} onChange={(e) => setProjectBpm(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="BPM" />
        <input type="text" value={trackName} onChange={(e) => setTrackName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Track name" />
        <select value={trackType} onChange={(e) => setTrackType(e.target.value as typeof trackType)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['audio', 'midi', 'instrument', 'return'] as const).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="text" value={effectName} onChange={(e) => setEffectName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Effect name" />
        <select value={renderFormat} onChange={(e) => setRenderFormat(e.target.value as typeof renderFormat)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['wav', 'mp3', 'flac', 'stems'] as const).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        <select value={currentProjectId} onChange={(e) => { setCurrentProjectId(e.target.value); const p = projects.find(x => x.id === e.target.value); if (p) { setProjectName(p.name); if (p.bpm) setProjectBpm(String(p.bpm)); } }} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="">— pick a project ({projects.length}) —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.bpm ?? '?'} BPM)</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || !!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {renderResult && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5"><Headphones className="w-3 h-3" /> Render estimate</div>
            <div className="text-[11px] text-zinc-300 mt-1">~{renderResult.estimatedMinutes}min · {renderResult.sizeMb}MB · {renderResult.format}</div>
            {renderResult.rationale && <p className="text-[10px] text-zinc-400 italic">{renderResult.rationale}</p>}
          </div>
        )}
        {timelineResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5"><Clock className="w-3 h-3" /> Milestones</div>
            {timelineResult.milestones?.map((m, i) => (
              <div key={i} className="text-[11px] text-zinc-300 flex items-center justify-between">
                <span>{m.name}</span>
                <span className="font-mono text-zinc-400">{m.targetDate} · {m.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Mix moves</div>
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
