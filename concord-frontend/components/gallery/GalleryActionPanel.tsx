'use client';

/**
 * GalleryActionPanel — Cleveland Museum + Smithsonian + Art Institute
 * search workbench. Surfaces cma-search / cma-artwork / si-search /
 * cma-departments + mint/DM/publish/agent.
 */

import { useState, useEffect } from 'react';
import {
  Image as ImageIcon, Search, Building, Frame, Layers,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('gallery', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

interface Artwork { id?: string | number; title: string; artist?: string; date?: string; thumbnail?: string; medium?: string; url?: string }
interface Department { id: string | number; name: string; count?: number }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'cmaSearch' | 'cmaArt' | 'siSearch' | 'depts' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function GalleryActionPanel() {
  const [query, setQuery] = useState('impressionism');
  const [artworkId, setArtworkId] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cmaResults, setCmaResults] = useState<Artwork[]>([]);
  const [siResults, setSiResults] = useState<Artwork[]>([]);
  const [selectedArt, setSelectedArt] = useState<Artwork | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  useEffect(() => {
    (async () => {
      try { const r = await callMacro<{ departments: Department[] }>('cma-departments', {}); if (r.ok && r.result?.departments) setDepartments(r.result.departments); } catch {/* dormant */}
    })();
  }, []);

  async function actCmaSearch() {
    if (!query.trim()) { err('Query required.'); return; }
    setBusy('cmaSearch'); setFeedback(null);
    try { const r = await callMacro<{ artworks?: Artwork[] }>('cma-search', { query: query.trim(), limit: 12 }); if (r.ok && r.result?.artworks) { setCmaResults(r.result.artworks); ok(`${r.result.artworks.length} CMA results.`); } else err(r.error ?? 'CMA search failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCmaArt() {
    if (!artworkId.trim()) { err('Artwork id required.'); return; }
    setBusy('cmaArt'); setFeedback(null);
    try { const r = await callMacro<{ artwork?: Artwork }>('cma-artwork', { id: artworkId.trim() }); if (r.ok && r.result?.artwork) { setSelectedArt(r.result.artwork); ok(`${r.result.artwork.title}.`); } else err(r.error ?? 'CMA artwork failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSiSearch() {
    if (!query.trim()) { err('Query required.'); return; }
    setBusy('siSearch'); setFeedback(null);
    try { const r = await callMacro<{ artworks?: Artwork[] }>('si-search', { query: query.trim(), limit: 12 }); if (r.ok && r.result?.artworks) { setSiResults(r.result.artworks); ok(`${r.result.artworks.length} Smithsonian results.`); } else err(r.error ?? 'SI search failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDepts() {
    setBusy('depts'); setFeedback(null);
    try { const r = await callMacro<{ departments: Department[] }>('cma-departments', {}); if (r.ok && r.result?.departments) { setDepartments(r.result.departments); ok(`${r.result.departments.length} departments.`); } else err(r.error ?? 'depts failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    if (!selectedArt && !cmaResults.length) { err('Pick an artwork or run a search.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Gallery — ${selectedArt?.title ?? query}`, tags: ['gallery', 'artwork', selectedArt?.artist ?? 'collection'], source: 'gallery:artwork:mint', meta: { visibility: 'private', consent: { allowCitations: false }, gallery: { query, selected: selectedArt, cmaResults: cmaResults.slice(0, 12), siResults: siResults.slice(0, 12) } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Gallery DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🖼 Gallery: ${selectedArt?.title ?? query}`, '', selectedArt ? `Artist: ${selectedArt.artist}\nDate: ${selectedArt.date}\nMedium: ${selectedArt.medium ?? '—'}\n${selectedArt.url ?? ''}` : `${cmaResults.length} CMA + ${siResults.length} SI results for "${query}"`, mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!selectedArt && !cmaResults.length) { err('Search or select first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Curated gallery — ${query}`, tags: ['gallery', 'curated', 'public'], source: 'gallery:curated:publish', meta: { visibility: 'public', consent: { allowCitations: true }, curated: { query, featured: selectedArt, picks: cmaResults.slice(0, 6).concat(siResults.slice(0, 6)) } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Curation published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    if (!selectedArt && !query.trim()) { err('Pick a topic or artwork.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Gallery context: ${selectedArt ? `"${selectedArt.title}" by ${selectedArt.artist} (${selectedArt.date})` : `topic "${query}"`}. Write a 2-paragraph wall-text-style interpretation. First paragraph: technique + context. Second paragraph: what to look at and why it matters. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Wall text ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'cmaSearch' as ActionId, label: 'CMA', desc: 'cma-search Cleveland Museum', icon: Search, accent: '#06b6d4', handler: actCmaSearch },
    { id: 'cmaArt' as ActionId, label: 'Artwork', desc: 'cma-artwork detail by id', icon: Frame, accent: '#8b5cf6', handler: actCmaArt },
    { id: 'siSearch' as ActionId, label: 'Smithsonian', desc: 'si-search Smithsonian Open Access', icon: Building, accent: '#22c55e', handler: actSiSearch },
    { id: 'depts' as ActionId, label: 'Depts', desc: 'cma-departments browse', icon: Layers, accent: '#f97316', handler: actDepts },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private gallery DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send artwork to friend', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Curated gallery DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Wall text', desc: 'Agent: 2-paragraph interpretation', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const allResults = [...cmaResults.map(a => ({ ...a, source: 'CMA' })), ...siResults.map(a => ({ ...a, source: 'SI' }))];

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <ImageIcon className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Gallery workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">CMA · Smithsonian · AIC</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Search query (artist, movement, theme)" />
        <input type="text" value={artworkId} onChange={(e) => setArtworkId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="CMA artwork id" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {selectedArt && (
        <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {selectedArt.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedArt.thumbnail} alt={selectedArt.title} className="rounded border border-pink-500/30 w-full h-48 object-cover" />
          )}
          <div className="md:col-span-2">
            <div className="text-xs font-semibold text-pink-300 uppercase tracking-wider">Selected</div>
            <h4 className="text-lg font-bold text-white">{selectedArt.title}</h4>
            <div className="text-sm text-zinc-300">{selectedArt.artist} · {selectedArt.date}</div>
            {selectedArt.medium && <div className="text-[11px] text-zinc-500">{selectedArt.medium}</div>}
            {selectedArt.url && <a href={selectedArt.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-pink-300 underline">view source</a>}
          </div>
        </div>
      )}

      {allResults.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-80 overflow-y-auto">
          {allResults.slice(0, 24).map((a, i) => (
            <button key={i} type="button" onClick={() => { setSelectedArt(a); setArtworkId(String(a.id ?? '')); }} className={cn('rounded border p-1.5 text-left hover:border-pink-400/50', selectedArt?.id === a.id ? 'border-pink-400 bg-pink-500/10' : 'border-zinc-800 bg-zinc-900/40')}>
              {a.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumbnail} alt={a.title} className="w-full h-24 object-cover rounded" />
              ) : (
                <div className="w-full h-24 bg-zinc-900 rounded flex items-center justify-center"><Frame className="w-6 h-6 text-zinc-700" /></div>
              )}
              <div className="text-[10px] text-zinc-300 mt-1 line-clamp-2">{a.title}</div>
              <div className="text-[9px] text-zinc-500">{a.artist ?? a.source}</div>
            </button>
          ))}
        </div>
      )}

      {departments.length > 0 && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 max-h-32 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Departments ({departments.length})</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {departments.slice(0, 20).map((d, i) => <span key={i} className="rounded bg-orange-500/20 text-orange-200 px-1.5 py-0.5 text-[10px]">{d.name}{d.count ? ` (${d.count})` : ''}</span>)}
          </div>
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Wall text</div>
          <pre className="whitespace-pre-wrap font-sans text-[12px] text-zinc-200 leading-relaxed italic">{agentReply}</pre>
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
