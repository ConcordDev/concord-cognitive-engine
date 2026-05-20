'use client';

import { useEffect, useState } from 'react';
import { Tag, Loader2, Plus, Eye, EyeOff, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Listing {
  id: string; number: string; title: string; slug: string;
  kind: string; priceUsd: number; currency: string;
  description: string; tags: string[]; images: string[];
  stockQty: number | null; shippingCostUsd: number;
  status: 'draft' | 'published' | 'archived';
  createdAt: string; publishedAt: string | null;
}

const KINDS = [
  'digital_download', 'physical_good', 'service', 'subscription',
  'music_track', 'music_album', 'merch_apparel', 'merch_print', 'merch_vinyl', 'merch_other',
];

interface AIResult {
  source?: string;
  issues?: string[];
  recommendations?: string[];
  suggestedTitle?: string;
  suggestedTags?: string[];
  suggestedDescription?: string;
  keyImprovements?: string[];
}
interface PriceResult {
  message?: string;
  currentPriceUsd?: number;
  comparableCount?: number;
  peerStats?: { min: number; max: number; median: number; avg: number };
  suggestion?: { aggressive: number; competitive: number; premium: number };
  positioning?: string;
}

export function ListingsPanel() {
  const [list, setList] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'archived'>('all');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', kind: 'digital_download', priceUsd: '', description: '', tags: '', stockQty: '', images: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiResult, setAIResult] = useState<AIResult | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [aiLoading, setAILoading] = useState(false);

  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'listings-list', input: { status: filter } });
      setList((r.data?.result?.listings || []) as Listing[]);
    } catch (e) { console.error('[Listings] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.title.trim() || !draft.priceUsd) return;
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'listings-create', input: {
        title: draft.title.trim(),
        kind: draft.kind,
        priceUsd: Number(draft.priceUsd),
        description: draft.description,
        tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
        stockQty: draft.stockQty === '' ? null : Number(draft.stockQty),
        images: draft.images.split(/\s*,\s*/).filter(Boolean),
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ title: '', kind: 'digital_download', priceUsd: '', description: '', tags: '', stockQty: '', images: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Listings] create', e); }
  }

  async function publish(id: string) {
    try { await lensRun({ domain: 'marketplace', action: 'listings-publish', input: { id } }); await refresh(); }
    catch (e) { console.error('[Listings] publish', e); }
  }
  async function unpublish(id: string) {
    try { await lensRun({ domain: 'marketplace', action: 'listings-unpublish', input: { id } }); await refresh(); }
    catch (e) { console.error('[Listings] unpublish', e); }
  }
  async function remove(id: string) {
    if (!confirm('Delete this listing?')) return;
    try { await lensRun({ domain: 'marketplace', action: 'listings-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[Listings] delete', e); }
  }

  async function runAI(id: string) {
    setAILoading(true);
    setAIResult(null);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'ai-optimize-listing', input: { id } });
      setAIResult(r.data?.result || null);
    } catch (e) { console.error('[Listings] ai-optimize', e); }
    finally { setAILoading(false); }
  }
  async function runPrice(id: string) {
    setAILoading(true);
    setPriceResult(null);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'ai-price-suggest', input: { id } });
      setPriceResult(r.data?.result || null);
    } catch (e) { console.error('[Listings] ai-price', e); }
    finally { setAILoading(false); }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Tag className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Listings</span>
          <span className="text-[10px] text-gray-500">{list.length}</span>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New listing
          </button>
        </header>

        {creating && (
          <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Title *" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="number" step="0.01" value={draft.priceUsd} onChange={e => setDraft({ ...draft, priceUsd: e.target.value })} placeholder="Price USD *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="Tags (comma-separated, ≤13)" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={draft.stockQty} onChange={e => setDraft({ ...draft, stockQty: e.target.value })} placeholder="Stock qty (blank = unlimited)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={draft.images} onChange={e => setDraft({ ...draft, images: e.target.value })} placeholder="Image URLs (comma-separated)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" rows={3} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400">Save as draft</button>
          </div>
        )}

        <div className="max-h-[32rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500"><Tag className="w-6 h-6 mx-auto mb-2 opacity-30" />No listings yet.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {list.map(l => {
                const isExp = expanded === l.id;
                return (
                  <li key={l.id} className="hover:bg-white/[0.02]">
                    <div className="px-4 py-2.5 flex items-center gap-3">
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                        l.status === 'published' ? 'bg-emerald-500/20 text-emerald-300' :
                        l.status === 'draft' ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-500/20 text-gray-300',
                      )}>{l.status}</span>
                      <div className="w-12 h-12 rounded bg-black/40 border border-white/10 flex-shrink-0 overflow-hidden">
                        {l.images?.[0] ? <img src={l.images[0]} alt="" className="w-full h-full object-cover" /> : <Tag className="w-5 h-5 m-auto text-gray-500 mt-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate flex items-center gap-2">
                          <span className="font-mono text-[10px] text-gray-500">{l.number}</span>
                          {l.title}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {l.kind.replace(/_/g, ' ')} · {l.stockQty === null ? '∞ stock' : `${l.stockQty} in stock`} · {l.tags.length} tags
                        </div>
                      </div>
                      <div className="text-sm font-mono text-orange-300 w-20 text-right">${l.priceUsd.toFixed(2)}</div>
                      {l.status === 'published' ? (
                        <button onClick={() => unpublish(l.id)} className="p-1.5 rounded hover:bg-white/[0.05] text-gray-400" title="Unpublish"><EyeOff className="w-3.5 h-3.5" /></button>
                      ) : (
                        <button onClick={() => publish(l.id)} className="px-2 py-1 text-[10px] rounded bg-orange-500 text-black font-bold hover:bg-orange-400 inline-flex items-center gap-0.5"><Eye className="w-3 h-3" />Publish</button>
                      )}
                      <button onClick={() => { setExpanded(isExp ? null : l.id); setAIResult(null); setPriceResult(null); }} className="p-1.5 rounded hover:bg-white/[0.05] text-gray-400" title={isExp ? 'Hide AI tools' : 'AI tools'}>
                        {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => remove(l.id)} className="p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-3 bg-black/30 space-y-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => runAI(l.id)} disabled={aiLoading} className="px-2.5 py-1 text-xs rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 disabled:opacity-40 inline-flex items-center gap-1">
                            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}AI optimize listing
                          </button>
                          <button onClick={() => runPrice(l.id)} disabled={aiLoading} className="px-2.5 py-1 text-xs rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 inline-flex items-center gap-1">
                            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}AI price suggest
                          </button>
                        </div>
                        {aiResult && (
                          <div className="rounded border border-orange-500/30 bg-orange-500/[0.05] p-2.5 text-xs space-y-1.5">
                            {aiResult.suggestedTitle && <div><span className="text-[10px] uppercase text-orange-300">Title:</span> <span className="text-white">{aiResult.suggestedTitle}</span></div>}
                            {aiResult.suggestedTags && aiResult.suggestedTags.length > 0 && (
                              <div><span className="text-[10px] uppercase text-orange-300">Tags:</span> <span className="text-white">{aiResult.suggestedTags.join(', ')}</span></div>
                            )}
                            {aiResult.suggestedDescription && (
                              <div>
                                <div className="text-[10px] uppercase text-orange-300">Description:</div>
                                <div className="text-white whitespace-pre-wrap">{aiResult.suggestedDescription}</div>
                              </div>
                            )}
                            {aiResult.issues && aiResult.issues.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase text-amber-300">Issues</div>
                                <ul className="text-amber-100 space-y-0.5 list-disc list-inside">
                                  {aiResult.issues.map((iss, i) => <li key={i}>{iss}</li>)}
                                </ul>
                              </div>
                            )}
                            {(aiResult.recommendations || aiResult.keyImprovements) && (
                              <div>
                                <div className="text-[10px] uppercase text-emerald-300">Recommendations</div>
                                <ul className="text-emerald-100 space-y-0.5 list-disc list-inside">
                                  {[...(aiResult.recommendations || []), ...(aiResult.keyImprovements || [])].map((r, i) => <li key={i}>{r}</li>)}
                                </ul>
                              </div>
                            )}
                            <div className="text-[10px] text-gray-500 italic">source: {aiResult.source}</div>
                          </div>
                        )}
                        {priceResult && (
                          <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.05] p-2.5 text-xs">
                            {priceResult.message ? (
                              <div className="text-emerald-200">{priceResult.message}</div>
                            ) : priceResult.peerStats && priceResult.suggestion ? (
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <div className="text-[10px] uppercase text-emerald-300">Aggressive</div>
                                  <div className="text-base font-mono text-white">${priceResult.suggestion.aggressive}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase text-emerald-300">Competitive</div>
                                  <div className="text-lg font-mono text-emerald-200 font-bold">${priceResult.suggestion.competitive}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase text-emerald-300">Premium</div>
                                  <div className="text-base font-mono text-white">${priceResult.suggestion.premium}</div>
                                </div>
                                <div className="col-span-3 text-[10px] text-emerald-300/70 mt-1">
                                  Based on {priceResult.comparableCount} comparable listings · peers avg ${priceResult.peerStats.avg}, median ${priceResult.peerStats.median} · you're <span className="font-semibold">{priceResult.positioning}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                        {l.description && (
                          <details className="text-[11px] text-gray-400">
                            <summary className="cursor-pointer text-gray-500">Description preview</summary>
                            <div className="mt-1 whitespace-pre-wrap">{l.description}</div>
                          </details>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ListingsPanel;
