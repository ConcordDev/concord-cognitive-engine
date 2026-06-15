'use client';

/**
 * FoundryActionPanel — Unity / Roblox Studio-shape scene builder
 * workbench. Surfaces the foundry create/list/validate/publish/preview
 * macros plus mint/DM/publish/agent.
 */

import { useState, useEffect } from 'react';
import {
  Box, FolderOpen, ShieldCheck, Eye, Rocket,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Hammer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface FoundryItem { id: string; name?: string; kind?: string; status?: string; updatedAt?: string }
interface SystemSpec { id: string; name: string; description?: string }
interface ValidateResult { ok?: boolean; issues?: string[]; warnings?: string[] }
interface PreviewResult { url?: string; rendered?: boolean; thumbnailUrl?: string }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'list' | 'create' | 'validate' | 'preview' | 'fpublish' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

async function callFoundry<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: T; error?: string; reason?: string }> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'foundry', name, input });
    const d = r.data as { ok?: boolean; result?: T; error?: string; reason?: string };
    if (d && typeof d === 'object' && 'ok' in d) return d as { ok: boolean; result?: T };
    return { ok: false, error: 'unexpected response' };
  } catch (e) { return { ok: false, error: pickMessage(e) }; }
}

export function FoundryActionPanel() {
  const [items, setItems] = useState<FoundryItem[]>([]);
  const [systems, setSystems] = useState<SystemSpec[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('scene');
  const [systemId, setSystemId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [createdId, setCreatedId] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [foundryPublished, setFoundryPublished] = useState(false);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  useEffect(() => {
    (async () => {
      try {
        const list = await callFoundry<{ items: FoundryItem[] }>('list', {});
        if (list.ok && list.result?.items) setItems(list.result.items);
      } catch {/* dormant */}
      try {
        const sys = await callFoundry<{ systems: SystemSpec[] }>('systems', {});
        if (sys.ok && sys.result?.systems) setSystems(sys.result.systems);
      } catch {/* dormant */}
    })();
  }, []);

  async function actList() {
    setBusy('list'); setFeedback(null);
    const r = await callFoundry<{ items: FoundryItem[] }>('list', {});
    if (r.ok && r.result?.items) { setItems(r.result.items); ok(`${r.result.items.length} items in foundry.`); }
    else err(r.error ?? 'list failed');
    setBusy(null);
  }
  async function actCreate() {
    if (!name.trim()) { err('Name required.'); return; }
    setBusy('create'); setFeedback(null);
    const r = await callFoundry<{ id?: string; item?: FoundryItem }>('create', { name: name.trim(), kind, systemId: systemId || undefined });
    if (r.ok) {
      const newId = r.result?.id ?? r.result?.item?.id;
      if (newId) { setCreatedId(newId); setSelectedItemId(newId); ok(`Created ${newId.slice(0, 8)}…`); actList(); }
      else err('No id returned.');
    } else err(r.error ?? r.reason ?? 'create failed');
    setBusy(null);
  }
  async function actValidate() {
    const target = selectedItemId || createdId;
    if (!target) { err('Pick an item.'); return; }
    setBusy('validate'); setFeedback(null);
    const r = await callFoundry<ValidateResult>('validate', { id: target });
    if (r.ok && r.result) { setValidateResult(r.result); ok(r.result.ok ? 'Valid.' : `${r.result.issues?.length ?? 0} issues.`); }
    else err(r.error ?? 'validate failed');
    setBusy(null);
  }
  async function actPreview() {
    const target = selectedItemId || createdId;
    if (!target) { err('Pick an item.'); return; }
    setBusy('preview'); setFeedback(null);
    const r = await callFoundry<PreviewResult>('preview', { id: target });
    if (r.ok && r.result) { setPreviewResult(r.result); ok('Preview rendered.'); }
    else err(r.error ?? 'preview failed');
    setBusy(null);
  }
  async function actFoundryPublish() {
    const target = selectedItemId || createdId;
    if (!target) { err('Pick an item.'); return; }
    setBusy('fpublish'); setFeedback(null);
    const r = await callFoundry<{ ok?: boolean }>('publish', { id: target });
    if (r.ok) { setFoundryPublished(true); ok('Foundry-published.'); }
    else err(r.error ?? 'foundry publish failed');
    setBusy(null);
  }

  async function actMint() {
    const target = selectedItemId || createdId;
    if (!target) { err('Pick or create an item.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Foundry item — ${name || target.slice(0, 8)}`,
          tags: ['foundry', kind, target],
          source: 'foundry:item:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, foundry: { id: target, name, kind, validate: validateResult, preview: previewResult, foundryPublished } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('foundry.mintedDtuId', id, { label: `Item DTU ${id.slice(0, 8)}…` }); ok(`Item DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const target = selectedItemId || createdId;
    const body = [
      `🏗 Foundry: ${name || (target ? target.slice(0, 8) : 'item')}`, '',
      target ? `id: ${target}` : '',
      `kind: ${kind}`,
      validateResult ? `Validation: ${validateResult.ok ? 'PASS' : `${validateResult.issues?.length} issues`}` : '',
      previewResult?.url ? `Preview: ${previewResult.url}` : '',
      mintedDtuId ? `\n[Item DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok(`Sent to ${recipient.trim()}. 60s to recall.`); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    const target = selectedItemId || createdId;
    if (!target) { err('Pick an item.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Public foundry item — ${name || target}`,
            tags: ['foundry', kind, 'public'],
            source: 'foundry:item:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, foundry: { id: target, name, kind, preview: previewResult?.url } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('foundry.publishedDtuId', id, { label: `Public item ${id.slice(0, 8)}…` }); ok(`Item published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Foundry item: "${name || 'untitled'}" (${kind}).`,
        validateResult ? (validateResult.ok ? 'Validation passes.' : `Validation: ${validateResult.issues?.length} issues.`) : '',
        '',
        'Suggest the 3 highest-impact next edits to ship this item. Each: which subsystem, what to add/change, and why.',
        'Plain text. Concrete.',
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Next edits ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'list',      label: 'List',      desc: 'foundry.list all items',                       icon: FolderOpen,  accent: '#06b6d4', handler: actList },
    { id: 'create',    label: createdId ? 'Created' : 'Create',    desc: createdId ? `id ${createdId.slice(0, 8)}…` : 'foundry.create new', icon: Hammer,    accent: '#22c55e', handler: actCreate },
    { id: 'validate',  label: 'Validate',  desc: 'foundry.validate item',                        icon: ShieldCheck, accent: '#eab308', handler: actValidate, disabled: !selectedItemId && !createdId },
    { id: 'preview',   label: 'Preview',   desc: 'foundry.preview render',                       icon: Eye,         accent: '#8b5cf6', handler: actPreview,  disabled: !selectedItemId && !createdId },
    { id: 'fpublish',  label: foundryPublished ? 'In foundry ✓' : 'Foundry publish', desc: 'foundry.publish (in-system)', icon: Rocket, accent: '#f97316', handler: actFoundryPublish, disabled: !selectedItemId && !createdId },
    { id: 'mint',      label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private item DTU',                            icon: Sparkles,    accent: '#3b82f6', handler: actMint },
    { id: 'dm',        label: 'DM',        desc: 'Send item link + status',                      icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',   label: publishedDtuId ? 'Published' : 'Public DTU',     desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public item DTU + federation',               icon: Globe,       accent: '#15803d', handler: actPublish,  disabled: !selectedItemId && !createdId },
    { id: 'agent',     label: 'Next edits', desc: 'Agent: 3 highest-impact edits',                icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <Box className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Foundry workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Item name" />
        <input type="text" value={kind} onChange={(e) => setKind(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="kind (scene, prefab, system…)" />
        <select value={systemId} onChange={(e) => setSystemId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="">— pick a system ({systems.length}) —</option>
          {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        <div className="flex items-center gap-2 flex-wrap col-span-2">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
        <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)} className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="">— pick existing item ({items.length}) —</option>
          {items.map(i => <option key={i.id} value={i.id}>{i.name ?? i.id.slice(0, 12)} {i.kind ? `(${i.kind})` : ''} {i.status ? `· ${i.status}` : ''}</option>)}
        </select>
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
        {validateResult && (
          <div className={cn('rounded-md border p-2.5', validateResult.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5', validateResult.ok ? 'text-emerald-300' : 'text-rose-300')}>
              <ShieldCheck className="w-3 h-3" /> Validation {validateResult.ok ? 'PASS' : 'FAIL'}
            </div>
            {validateResult.issues?.length ? (
              <ul className="text-[11px] text-rose-200 list-disc list-inside mt-1">{validateResult.issues.slice(0, 5).map((i, idx) => <li key={idx}>{i}</li>)}</ul>
            ) : null}
            {validateResult.warnings?.length ? (
              <ul className="text-[11px] text-amber-200 list-disc list-inside mt-1">{validateResult.warnings.slice(0, 3).map((w, idx) => <li key={idx}>{w}</li>)}</ul>
            ) : null}
          </div>
        )}
        {previewResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><Eye className="w-3 h-3" /> Preview</div>
            {previewResult.url ? (
              <a href={previewResult.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-purple-200 underline break-all">{previewResult.url}</a>
            ) : <p className="text-[11px] text-zinc-400">{previewResult.rendered ? 'Rendered.' : 'No URL available.'}</p>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Next edits</div>
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
