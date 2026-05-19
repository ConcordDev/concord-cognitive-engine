'use client';

import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Ref { path: string; line: number; snippet: string }

export function SearchPanel({ projectId, onOpen }: { projectId: string | null; onOpen: (path: string) => void }) {
  const [q, setQ] = useState('');
  const [refs, setRefs] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!projectId || q.trim().length < 2) return;
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'code', action: 'find-references', input: { projectId, symbol: q.trim() } });
      setRefs((r.data?.result?.references || []) as Ref[]);
    } catch (e) { console.error('[Search] failed', e); }
    finally { setLoading(false); }
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-500 italic">Open a project to search.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Find references</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-2 border-b border-white/10">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Symbol (word-boundary aware)…"
          className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
        />
      </form>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Searching…</div>
        ) : refs.length === 0 ? (
          <div className="p-3 text-xs text-gray-500 italic">{q ? 'No references.' : 'Type a symbol and press Enter.'}</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {refs.map((r, i) => (
              <li key={i} onClick={() => onOpen(r.path)} className="px-3 py-1.5 cursor-pointer hover:bg-white/[0.04]">
                <div className="text-[10px] font-mono text-blue-300 truncate">{r.path}:{r.line}</div>
                <div className="text-[11px] text-white font-mono truncate">{r.snippet}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SearchPanel;
