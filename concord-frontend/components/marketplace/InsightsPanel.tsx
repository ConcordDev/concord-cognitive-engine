'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Search, Loader2, Bookmark, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SavedSearch { id: string; keyword: string; savedAt: string }
interface InsightResult {
  keyword: string;
  ownListingCount: number;
  impressions: number; clicks: number; ctrPct: number;
  ownTopMatches: Array<{ id: string; title: string }>;
}

export function InsightsPanel() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<InsightResult | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { refreshSaved(); }, []);

  async function refreshSaved() {
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'saved-searches-list', input: {} });
      setSaved((r.data?.result?.savedSearches || []) as SavedSearch[]);
    } catch (e) { console.error('[Insights] saved', e); }
  }

  async function search(keyword: string) {
    if (!keyword.trim()) return;
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'insights-keyword-search', input: { keyword: keyword.trim() } });
      setResult(r.data?.result || null);
    } catch (e) { console.error('[Insights] search', e); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!result) return;
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'saved-searches-save', input: { keyword: result.keyword } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      await refreshSaved();
    } catch (e) { console.error('[Insights] save', e); }
  }

  async function remove(id: string) {
    try { await lensRun({ domain: 'marketplace', action: 'saved-searches-delete', input: { id } }); await refreshSaved(); }
    catch (e) { console.error('[Insights] remove', e); }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Marketplace Insights</span>
        </header>
        <form onSubmit={(e) => { e.preventDefault(); search(q); }} className="p-3 border-b border-white/10 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search a keyword (e.g. boho ring, sticker pack, vinyl)…"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button type="submit" disabled={loading || !q.trim()} className="px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-1">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}Search
          </button>
        </form>

        {result && (
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm text-white font-semibold flex-1">"{result.keyword}"</h3>
              <button onClick={save} className="px-2 py-1 text-xs rounded border border-orange-500/30 text-orange-300 hover:bg-orange-500/10 inline-flex items-center gap-1">
                <Bookmark className="w-3 h-3" />Save
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Mini label="Own listings" value={String(result.ownListingCount)} />
              <Mini label="Impressions" value={result.impressions.toLocaleString()} />
              <Mini label="Clicks" value={result.clicks.toLocaleString()} />
              <Mini label="CTR" value={`${result.ctrPct}%`} />
            </div>
            {result.ownTopMatches.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-2 mb-1">Your top matches</div>
                <ul className="space-y-0.5">
                  {result.ownTopMatches.map(m => (
                    <li key={m.id} className="text-xs text-white">· {m.title}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Saved searches</span>
          <span className="text-[10px] text-gray-400">{saved.length}/50</span>
        </header>
        {saved.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-gray-400">No saved searches.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {saved.map(s => (
              <li key={s.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-2 group">
                <Search className="w-3 h-3 text-gray-400" />
                <button onClick={() => { setQ(s.keyword); search(s.keyword); }} className="text-xs text-white flex-1 text-left hover:text-orange-300">{s.keyword}</button>
                <span className="text-[10px] text-gray-400">{s.savedAt.slice(0, 10)}</span>
                <button aria-label="Delete" onClick={() => remove(s.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded border border-white/10 bg-black/30">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-base font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default InsightsPanel;
