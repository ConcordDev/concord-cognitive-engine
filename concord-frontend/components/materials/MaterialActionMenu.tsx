'use client';

/**
 * MaterialActionMenu — Granta MI / Ansys-style action sheet for a
 * Materials Project entry. Opens as a modal triggered by an "Actions"
 * button on each result row in MpSearch. Five real-backend actions:
 *
 *   1. Save as spec       → dtu.create with full property snapshot
 *                           (private; tags=[materials,spec,formula])
 *   2. Request a quote    → /api/social/dm to a supplier user id with
 *                           the formula + quantity + delivery date
 *   3. Compare            → materials.compareProperties macro on the
 *                           candidate against a second material id
 *   4. Publish datasheet  → dtu.create public + cite + flag published
 *   5. Engineering agent  → chat_agent.do "is {formula} suitable for
 *                           {use case}? trade-offs vs alternatives?"
 */

import { useState } from 'react';
import {
  X, Sparkles, Send, GitCompare, Globe, Wand2,
  Loader2, Check, AlertTriangle, Atom,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface MaterialLike {
  materialId: string;
  formula: string;
  elementCount?: number;
  crystalSystem?: string;
  spaceGroup?: string;
  density?: number;
  bandGapEv?: number;
  formationEnergyPerAtomEv?: number;
  energyAboveHullEv?: number;
  isStable?: boolean;
  isMagnetic?: boolean;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type PaneId = 'spec' | 'quote' | 'compare' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function MaterialActionMenu({ material, onClose }: { material: MaterialLike; onClose: () => void }) {
  const [pane, setPane] = useState<PaneId>('spec');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [specDtuId, setSpecDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [quoteQty, setQuoteQty] = useState('100');
  const [quoteUnit, setQuoteUnit] = useState('kg');
  const [quoteDate, setQuoteDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [compareTarget, setCompareTarget] = useState('');
  const [compareResult, setCompareResult] = useState<string | null>(null);
  const [useCase, setUseCase] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  function propLines(): string[] {
    return [
      `Material ID: ${material.materialId}`,
      `Formula: ${material.formula}`,
      material.crystalSystem ? `Crystal system: ${material.crystalSystem}` : '',
      material.spaceGroup ? `Space group: ${material.spaceGroup}` : '',
      material.density != null ? `Density: ${material.density} g/cm³` : '',
      material.bandGapEv != null ? `Band gap: ${material.bandGapEv} eV` : '',
      material.formationEnergyPerAtomEv != null ? `Formation energy: ${material.formationEnergyPerAtomEv} eV/atom` : '',
      material.energyAboveHullEv != null ? `Energy above hull: ${material.energyAboveHullEv} eV` : '',
      material.isStable != null ? `Stable: ${material.isStable ? 'yes' : 'no'}` : '',
      material.isMagnetic != null ? `Magnetic: ${material.isMagnetic ? 'yes' : 'no'}` : '',
    ].filter(Boolean);
  }

  async function actSpec() {
    setBusy('spec'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Spec — ${material.formula} (${material.materialId})`,
          tags: ['materials', 'spec', `formula:${material.formula}`, material.crystalSystem ?? ''].filter(Boolean) as string[],
          source: 'materials:spec',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            material: { ...material, mpUrl: `https://materialsproject.org/materials/${material.materialId}` },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSpecDtuId(id); ok(`Spec saved as DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actQuote() {
    if (!supplierId.trim()) { err('Enter a supplier user id.'); return; }
    setBusy('quote'); setFeedback(null);
    const body = [
      `📐 Quote request`,
      ``,
      `Material: ${material.formula} (MP ${material.materialId})`,
      `Quantity: ${quoteQty} ${quoteUnit}`,
      `Needed by: ${quoteDate}`,
      ``,
      propLines().join('\n'),
      ``,
      specDtuId ? `[Spec DTU ${specDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: supplierId.trim(), content: body });
      if (r.data?.ok !== false) ok(`Quote DMed to ${supplierId.trim()}.`);
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCompare() {
    if (!compareTarget.trim()) { err('Enter another material id (e.g. mp-149).'); return; }
    setBusy('compare'); setFeedback(null); setCompareResult(null);
    try {
      // First fetch the other material's data via mp-material, then compose a deterministic compare.
      const otherEnv = await apiHelpers.lens.runDomain('materials', 'mp-material', { input: { materialId: compareTarget.trim() } });
      const otherData = (otherEnv as { data?: { result?: { material?: MaterialLike } } }).data?.result?.material;
      if (!otherData) { err('Could not fetch the comparison material.'); return; }
      const rows: string[] = [];
      const fields: Array<[keyof MaterialLike, string]> = [
        ['density', 'Density (g/cm³)'],
        ['bandGapEv', 'Band gap (eV)'],
        ['formationEnergyPerAtomEv', 'Formation energy (eV/atom)'],
        ['energyAboveHullEv', 'Energy above hull (eV)'],
        ['isStable', 'Stable'],
        ['isMagnetic', 'Magnetic'],
      ];
      rows.push(`${material.formula} (${material.materialId})  vs  ${otherData.formula} (${otherData.materialId})`);
      rows.push('');
      for (const [k, label] of fields) {
        const a = material[k];
        const b = otherData[k];
        if (a == null && b == null) continue;
        rows.push(`${label.padEnd(30)} ${String(a ?? '—').padEnd(12)} | ${String(b ?? '—')}`);
      }
      setCompareResult(rows.join('\n'));
      ok('Compare ready.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Datasheet — ${material.formula} (${material.materialId})`,
          tags: ['materials', 'datasheet', 'public', `formula:${material.formula}`],
          source: 'materials:datasheet:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            material,
            mpUrl: `https://materialsproject.org/materials/${material.materialId}`,
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Datasheet published ${id.slice(0, 8)}…`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!useCase.trim()) { err('Describe the use case.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Engineering question: is ${material.formula} (MP ${material.materialId}) a good fit for: "${useCase.trim()}"?`,
        `Material properties — ${propLines().slice(0, 6).join('; ')}.`,
        `Return a short plaintext brief: yes/no with reasoning, 1-2 trade-offs, and 1-2 alternative formulas if relevant.`,
      ].join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Engineering brief ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const panes: { id: PaneId; label: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
    { id: 'spec',    label: 'Spec',    icon: Sparkles,  accent: '#06b6d4' },
    { id: 'quote',   label: 'Quote',   icon: Send,      accent: '#ec4899' },
    { id: 'compare', label: 'Compare', icon: GitCompare, accent: '#8b5cf6' },
    { id: 'publish', label: 'Publish', icon: Globe,     accent: '#22c55e' },
    { id: 'agent',   label: 'Agent',   icon: Wand2,     accent: '#eab308' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        className="w-full max-w-2xl bg-zinc-950 border border-cyan-500/30 rounded-t-2xl md:rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-cyan-500/20 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0">
            <Atom className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Material actions</div>
            <h3 className="text-sm font-semibold text-white">{material.formula} <span className="text-zinc-500 font-mono ml-2">{material.materialId}</span></h3>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {[
                material.crystalSystem,
                material.density != null ? `${material.density} g/cm³` : null,
                material.bandGapEv != null ? `band gap ${material.bandGapEv} eV` : null,
                material.isStable ? 'stable' : material.isStable === false ? 'unstable' : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex items-center border-b border-zinc-800 overflow-x-auto">
          {panes.map(p => {
            const Icon = p.icon;
            const active = pane === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPane(p.id); setFeedback(null); }}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                  active ? '' : 'border-transparent text-zinc-500 hover:text-zinc-200',
                )}
                style={active ? { borderBottomColor: p.accent, color: p.accent } : {}}
              >
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 min-h-[200px] max-h-[60vh] overflow-y-auto">
          {pane === 'spec' && (
            <div className="space-y-3">
              <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-[11px] text-zinc-200 font-mono leading-relaxed">
                {propLines().join('\n')}
              </pre>
              {specDtuId ? (
                <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" /> Spec saved as DTU <span className="font-mono">{specDtuId.slice(0, 12)}…</span>
                </div>
              ) : (
                <button type="button" onClick={actSpec} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-black text-sm font-semibold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'spec' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Save spec as DTU
                </button>
              )}
            </div>
          )}

          {pane === 'quote' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Supplier user id</label>
                <input type="text" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="supplier username" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Quantity</label>
                  <input type="text" value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/40" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Unit</label>
                  <select value={quoteUnit} onChange={(e) => setQuoteUnit(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white">
                    <option value="kg">kg</option><option value="g">g</option><option value="t">t</option><option value="lb">lb</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Needed by</label>
                  <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <button type="button" onClick={actQuote} disabled={!!busy || !supplierId.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'quote' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send quote request
              </button>
            </div>
          )}

          {pane === 'compare' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Compare against (Materials Project id)</label>
                <input type="text" value={compareTarget} onChange={(e) => setCompareTarget(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-purple-400/40" placeholder="mp-149" />
              </div>
              <button type="button" onClick={actCompare} disabled={!!busy || !compareTarget.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'compare' ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                Compare side-by-side
              </button>
              {compareResult && (
                <pre className="bg-zinc-900 border border-purple-500/30 rounded p-3 text-[11px] text-zinc-200 font-mono leading-relaxed overflow-x-auto">
                  {compareResult}
                </pre>
              )}
            </div>
          )}

          {pane === 'publish' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Mints a <span className="text-emerald-300 font-semibold">public</span> datasheet DTU with the full
                property snapshot + MP link + citation enabled, then flags it published so federation peers can pick
                it up. Useful for collaborative engineering communities.
              </p>
              {publishedDtuId ? (
                <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" /> Published <span className="font-mono">{publishedDtuId.slice(0, 12)}…</span>
                </div>
              ) : (
                <button type="button" onClick={actPublish} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'publish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  Publish public datasheet
                </button>
              )}
            </div>
          )}

          {pane === 'agent' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Use case</label>
                <textarea value={useCase} onChange={(e) => setUseCase(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-none" placeholder="e.g. cathode material for room-temperature Li-ion battery, automotive grade…" />
              </div>
              <button type="button" onClick={actAgent} disabled={!!busy || !useCase.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'agent' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Ask engineering agent
              </button>
              {agentReply && (
                <div className="mt-2 px-3 py-3 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-xs text-zinc-200 max-h-72 overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {feedback && (
            <motion.div
              key={feedback.text}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className={cn(
                'px-4 py-2 text-xs flex items-start gap-2 border-t',
                feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30',
              )}
            >
              {feedback.kind === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
              <span>{feedback.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
