'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Hit { id: string; channelName: string; channelId: string; senderName: string; body: string; ts: string }

const SAMPLES = ['deploy plan', 'launch date', 'design review', 'this week'];

export function MessageAskBar({ onOpenChannel }: { onOpenChannel: (channelId: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(query: string) {
    if (!query.trim()) return;
    setLoading(true); setHits(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'message', action: 'ai-search-messages', input: { query } });
      setHits((r.data?.result?.hits || []) as Hit[]);
    } catch (e) { console.error('[Ask] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); search(q); }} className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 focus-within:border-violet-500/40">
          <Sparkles className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across channels + DMs…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-500 outline-none"
          />
          {q && (
            <button type="submit" disabled={loading} className="text-violet-300 hover:text-violet-200 p-0.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SAMPLES.map(s => (
            <button key={s} type="button" onClick={() => { setQ(s); search(s); }} className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 whitespace-nowrap">
              {s}
            </button>
          ))}
        </div>
      </form>
      {hits && (
        <div className="bg-violet-500/[0.06] border border-violet-500/20 rounded-md p-2 max-h-40 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-1">{hits.length} hit(s)</div>
          {hits.length === 0 ? (
            <div className="text-xs text-violet-200/70 italic">No matches.</div>
          ) : (
            <ul className="space-y-0.5">
              {hits.slice(0, 10).map(h => (
                <li key={h.id} onClick={() => onOpenChannel(h.channelId)} className="cursor-pointer hover:bg-violet-500/10 rounded px-1.5 py-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-violet-300">#{h.channelName}</span>
                    <span className="text-white truncate">{h.senderName}: {h.body.slice(0, 80)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default MessageAskBar;
