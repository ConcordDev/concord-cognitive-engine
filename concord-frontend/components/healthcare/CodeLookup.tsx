'use client';

import { useState } from 'react';
import { Database, Search, Loader2, Copy } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Match { code: string; description: string }

export function CodeLookup() {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>('');

  async function search() {
    if (q.length < 2) return;
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'healthcare', action: 'icd10-search', input: { q } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setMatches((r.data?.result?.matches || []) as Match[]);
      setSource(r.data?.result?.source || '');
    } catch (e) { console.error('[CodeLookup] failed', e); }
    finally { setLoading(false); }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); } catch {}
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">ICD-10-CM lookup</span>
        <span className="text-[10px] text-gray-500">live NLM Clinical Tables</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-gray-500" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by code or description (e.g. 'diabetes' or 'E11.9')"
          className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button type="submit" disabled={loading || q.length < 2} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}Search
        </button>
      </form>
      {source && <div className="px-4 py-1 text-[10px] text-gray-500 border-b border-white/10">Source: {source}</div>}
      <div className="max-h-[32rem] overflow-y-auto">
        {matches.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">Run a search to see ICD-10 matches.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {matches.map(m => (
              <li key={m.code} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3 group">
                <span className="font-mono text-cyan-300 w-24 text-sm">{m.code}</span>
                <span className="flex-1 text-sm text-white truncate">{m.description}</span>
                <button onClick={() => copy(m.code)} className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-cyan-300" title="Copy code">
                  <Copy className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CodeLookup;
