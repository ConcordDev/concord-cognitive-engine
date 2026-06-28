'use client';

/**
 * ArtActionPanel — Met + Art Institute + Adobe Color-shape art
 * workbench. Surfaces colorHarmony / compositionScore / generatePalette /
 * styleClassify + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Palette, Image as ImageIcon, Grid3x3, Brush, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('art', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'harmony' | 'composition' | 'palette' | 'style' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

// ── Result shapes — these mirror the REAL server/domains/art.js handler
// returns (NOT invented names). colorHarmony → { harmonies[], temperature,
// harmonyScore, paletteSize, dominantHue }; compositionScore → { overall,
// rating, scores{} }; generatePalette → { palette[{hex,role}], harmony,
// baseColor, count }; styleClassify → { topMatch{style,similarity}, allMatches,
// confidence }. ────────────────────────────────────────────────────────────
interface HarmonyMatch { type: string; colors: string[]; hueDistance: number }
interface HarmonyResult { harmonies?: HarmonyMatch[]; temperature?: string; harmonyScore?: number; paletteSize?: number; dominantHue?: number }
interface CompositionResult { overall?: number; rating?: string; scores?: Record<string, number>; canvasCoverage?: number; elementCount?: number }
interface PaletteResult { palette?: Array<{ hex: string; role?: string }>; harmony?: string; baseColor?: string; count?: number }
interface StyleMatch { style: string; similarity: number }
interface StyleResult { topMatch?: StyleMatch; allMatches?: StyleMatch[]; confidence?: string }

// A composition element the workbench sends to compositionScore.
interface CompElement { x: number; y: number; width: number; height: number; weight?: number }

export function ArtActionPanel() {
  const [pieceTitle, setPieceTitle] = useState('');
  const [colors, setColors] = useState('');
  const [seedColor, setSeedColor] = useState('');
  const [paletteHarmony, setPaletteHarmony] = useState('analogous');
  const [paletteCount, setPaletteCount] = useState('');
  // Composition + style attributes are authored as a compact comma list the
  // panel parses into the handler's real input shapes.
  const [compElements, setCompElements] = useState('');
  const [styleAttrs, setStyleAttrs] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [harmonyResult, setHarmonyResult] = useState<HarmonyResult | null>(null);
  const [compositionResult, setCompositionResult] = useState<CompositionResult | null>(null);
  const [paletteResult, setPaletteResult] = useState<PaletteResult | null>(null);
  const [styleResult, setStyleResult] = useState<StyleResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  // colorHarmony reads artifact.data.palette = ["#hex", ...]. Send { palette }.
  async function actHarmony() {
    const colorList = colors.split('\n').map(c => c.trim()).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    if (colorList.length < 2) { err('Need at least 2 hex colors (one per line, #RRGGBB).'); return; }
    setBusy('harmony'); setFeedback(null);
    try {
      const r = await callMacro<HarmonyResult>('colorHarmony', { palette: colorList });
      if (r.ok && r.result) { setHarmonyResult(r.result); pipe.publish('art.harmony', r.result, { label: `Harmony ${r.result.harmonyScore ?? 0}` }); ok(`Harmony score ${r.result.harmonyScore ?? 0}, ${r.result.temperature ?? '—'}.`); } else err(r.error ?? 'harmony failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  // compositionScore reads artifact.data.elements = [{x,y,width,height,weight?}]
  // + artifact.data.canvas = {width,height}. Parse the compact "x,y,w,h[,wt]"
  // lines the panel authors into that exact shape.
  async function actComposition() {
    const elements: CompElement[] = compElements.split('\n').map(line => {
      const parts = line.split(',').map(p => Number(p.trim()));
      if (parts.length < 4 || parts.slice(0, 4).some(n => !Number.isFinite(n))) return null;
      const [x, y, width, height, weight] = parts;
      return { x, y, width, height, ...(Number.isFinite(weight) ? { weight } : {}) };
    }).filter((e): e is CompElement => e !== null);
    if (elements.length === 0) { err('Add ≥1 element line: x,y,width,height[,weight].'); return; }
    setBusy('composition'); setFeedback(null);
    try {
      const r = await callMacro<CompositionResult>('compositionScore', { elements, canvas: { width: 1920, height: 1080 } });
      if (r.ok && r.result) { setCompositionResult(r.result); pipe.publish('art.composition', r.result, { label: `Composition ${r.result.overall}` }); ok(`Composition: ${r.result.overall}/100 (${r.result.rating ?? '—'}).`); } else err(r.error ?? 'composition failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  // generatePalette reads params.baseColor / params.harmony / params.count.
  async function actPalette() {
    if (!/^#[0-9a-f]{6}$/i.test(seedColor)) { err('Valid seed hex required (#RRGGBB).'); return; }
    const n = parseInt(paletteCount, 10);
    if (!Number.isFinite(n) || n < 2) { err('Palette count must be ≥ 2.'); return; }
    setBusy('palette'); setFeedback(null);
    try {
      const r = await callMacro<PaletteResult>('generatePalette', { baseColor: seedColor, harmony: paletteHarmony, count: n });
      if (r.ok && r.result) { setPaletteResult(r.result); pipe.publish('art.palette', r.result, { label: `${r.result.palette?.length ?? 0} colors` }); ok(`${r.result.palette?.length ?? 0} colors.`); } else err(r.error ?? 'palette failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  // styleClassify reads artifact.data.attributes = { brushwork, colorSaturation,
  // contrast, perspective, detail, abstraction, lineWeight, texture } (0-100).
  async function actStyle() {
    const AXES = ['brushwork', 'colorSaturation', 'contrast', 'perspective', 'detail', 'abstraction', 'lineWeight', 'texture'] as const;
    const nums = styleAttrs.split(',').map(p => Number(p.trim()));
    const provided = nums.filter(n => Number.isFinite(n));
    if (provided.length === 0) { err('Enter 1-8 axis values 0-100 (brushwork,colorSaturation,contrast,perspective,detail,abstraction,lineWeight,texture).'); return; }
    const attributes: Record<string, number> = {};
    AXES.forEach((k, i) => { if (Number.isFinite(nums[i])) attributes[k] = nums[i]; });
    setBusy('style'); setFeedback(null);
    try {
      const r = await callMacro<StyleResult>('styleClassify', { attributes });
      if (r.ok && r.result?.topMatch) { setStyleResult(r.result); pipe.publish('art.style', r.result, { label: `${r.result.topMatch.style} (${r.result.confidence})` }); ok(`${r.result.topMatch.style} · ${r.result.confidence}.`); } else err(r.error ?? 'style failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Art — ${pieceTitle.trim() || 'piece'}`, tags: ['art', styleResult?.topMatch?.style ?? 'unknown', harmonyResult?.temperature ?? ''].filter(Boolean), source: 'art:piece:mint', meta: { visibility: 'private', consent: { allowCitations: false }, art: { title: pieceTitle, colors: colors.split('\n').filter(Boolean), harmony: harmonyResult, composition: compositionResult, palette: paletteResult, style: styleResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('art.mintedDtuId', id, { label: `Piece DTU ${id.slice(0, 8)}…` }); ok(`Piece DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎨 Art piece: ${pieceTitle || 'untitled'}`, '',
      harmonyResult ? `Harmony: score ${harmonyResult.harmonyScore ?? 0}, ${harmonyResult.temperature ?? '—'}` : '',
      compositionResult ? `Composition: ${compositionResult.overall}/100 (${compositionResult.rating ?? '—'})` : '',
      paletteResult?.palette ? `Palette: ${paletteResult.palette.map(p => p.hex).join(' ')}` : '',
      styleResult?.topMatch ? `Style: ${styleResult.topMatch.style} (${styleResult.confidence})` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
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
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Public piece — ${pieceTitle.trim() || 'untitled'}`, tags: ['art', 'public', styleResult?.topMatch?.style ?? 'unknown'], source: 'art:piece:publish', meta: { visibility: 'public', consent: { allowCitations: true }, piece: { title: pieceTitle, palette: paletteResult?.palette?.map(p => p.hex), style: styleResult?.topMatch?.style, harmony: harmonyResult?.harmonyScore } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('art.publishedDtuId', id, { label: `Public piece ${id.slice(0, 8)}…` }); ok(`Piece published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Art piece: "${pieceTitle || 'untitled'}". ${styleResult?.topMatch ? `Style: ${styleResult.topMatch.style} (${styleResult.confidence} confidence).` : ''} ${harmonyResult ? `Harmony score ${harmonyResult.harmonyScore}, ${harmonyResult.temperature} palette.` : ''} ${compositionResult ? `Composition score ${compositionResult.overall}/100.` : ''} Suggest 3 concrete moves to strengthen the next iteration (composition, palette, technique). Plain text, one per line.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Critique ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'harmony' as ActionId, label: 'Harmony', desc: 'colorHarmony score + temp', icon: Palette, accent: '#06b6d4', handler: actHarmony },
    { id: 'composition' as ActionId, label: 'Composition', desc: 'compositionScore + rating', icon: Grid3x3, accent: '#8b5cf6', handler: actComposition },
    { id: 'palette' as ActionId, label: 'Palette', desc: 'generatePalette from seed', icon: Brush, accent: '#22c55e', handler: actPalette },
    { id: 'style' as ActionId, label: 'Style', desc: 'styleClassify + confidence', icon: Eye, accent: '#f97316', handler: actStyle },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private piece DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send critique brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public piece DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Critique', desc: 'Agent: 3 next-iteration moves', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <ImageIcon className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Art workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">met · art institute · adobe color</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={pieceTitle} onChange={(e) => setPieceTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Piece title" />
        <input type="text" value={seedColor} onChange={(e) => setSeedColor(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="#seed hex" />
        <input type="text" value={paletteCount} onChange={(e) => setPaletteCount(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="palette N" />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Palette harmony</label>
        <select aria-label="Palette harmony" value={paletteHarmony} onChange={(e) => setPaletteHarmony(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white">
          {['analogous', 'complementary', 'triadic', 'split-complementary', 'monochromatic'].map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Color list (one hex per line)</label>
        <textarea value={colors} onChange={(e) => setColors(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-pink-200 font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/40 resize-none" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Composition elements — one per line: x,y,width,height[,weight]</label>
        <textarea value={compElements} onChange={(e) => setCompElements(e.target.value)} rows={3} placeholder={'640,360,200,200\n1280,720,150,150'} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-purple-200 font-mono focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Style axes 0-100 (brushwork,colorSaturation,contrast,perspective,detail,abstraction,lineWeight,texture)</label>
        <input type="text" value={styleAttrs} onChange={(e) => setStyleAttrs(e.target.value)} placeholder="80,70,40,40,30,40,20,70" className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-orange-200 font-mono focus:outline-none focus:ring-2 focus:ring-orange-400/40" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {harmonyResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Harmony</div>
            <div className="text-sm font-semibold text-zinc-100 capitalize">score {harmonyResult.harmonyScore ?? 0} · {harmonyResult.temperature ?? '—'}</div>
            {harmonyResult.paletteSize != null && <div className="text-[10px] text-zinc-400">{harmonyResult.paletteSize} colors · dominant hue {harmonyResult.dominantHue}°</div>}
            {harmonyResult.harmonies && harmonyResult.harmonies.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {harmonyResult.harmonies.slice(0, 4).map((h, i) => (
                  <span key={i} className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">{h.type}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {compositionResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Composition {compositionResult.rating && `· ${compositionResult.rating}`}</div>
            <div className="text-2xl font-bold text-zinc-100">{compositionResult.overall}<span className="text-xs text-zinc-400">/100</span></div>
            {compositionResult.scores && (
              <div className="grid grid-cols-2 gap-1 mt-1">
                {Object.entries(compositionResult.scores).map(([k, v]) => (
                  <div key={k} className="text-[10px] text-zinc-300"><span className="text-zinc-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span> {v}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {paletteResult?.palette && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Palette {paletteResult.harmony && `· ${paletteResult.harmony}`}</div>
            <div className="flex gap-1 mt-2">
              {paletteResult.palette.map((c, i) => (
                <div key={i} className="flex-1 h-12 rounded border border-zinc-700" style={{ backgroundColor: c.hex }} title={`${c.hex}${c.role ? ` (${c.role})` : ''}`}>
                  <div className="text-[9px] text-white/80 text-center pt-9 font-mono drop-shadow">{c.hex}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {styleResult?.topMatch && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Style</div>
            <div className="text-sm font-semibold text-zinc-100 capitalize">{styleResult.topMatch.style} · {styleResult.topMatch.similarity}%</div>
            {styleResult.confidence != null && <div className="text-[10px] text-zinc-400">confidence {styleResult.confidence}</div>}
            {styleResult.allMatches && styleResult.allMatches.length > 1 && (
              <div className="mt-1 space-y-0.5">
                {styleResult.allMatches.slice(1, 4).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px] text-zinc-400"><span className="capitalize">{m.style}</span><span>{m.similarity}%</span></div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Critique</div>
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
