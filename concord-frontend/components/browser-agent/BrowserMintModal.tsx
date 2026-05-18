'use client';

import { useEffect, useState, useCallback } from 'react';
import { callBrowserAgentMacro, type BrowserTask } from '@/lib/api/browser-agent';
import { X, Coins, Loader2, Check, Sparkles } from 'lucide-react';

interface Mint {
  dtu_id: string; royalty_rate: number; visibility: string;
  citation_count: number; minted_at: number;
}

interface Props { open: boolean; onClose: () => void; task: BrowserTask | null; }

export function BrowserMintModal({ open, onClose, task }: Props) {
  const [mint, setMint] = useState<Mint | null>(null);
  const [royaltyRate, setRoyaltyRate] = useState(0.21);
  const [visibility, setVisibility] = useState<'workspace'|'public'|'published'>('workspace');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    setLoading(true);
    (async () => {
      try {
        const r = await callBrowserAgentMacro<{ minted?: boolean; mint?: Mint }>('task_mint_status', { taskId: task.id });
        setMint(r?.minted ? r.mint || null : null);
      } finally { setLoading(false); }
    })();
  }, [open, task]);

  const mintIt = useCallback(async () => {
    if (!task) return;
    setBusy(true);
    try {
      const r = await callBrowserAgentMacro<{ dtuId?: string }>('task_mint', { taskId: task.id, royaltyRate, visibility });
      if (r.ok) {
        const status = await callBrowserAgentMacro<{ mint?: Mint }>('task_mint_status', { taskId: task.id });
        setMint(status?.mint || null);
      }
    } finally { setBusy(false); }
  }, [task, royaltyRate, visibility]);

  if (!open || !task) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-amber-400/30 rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Coins className="w-4 h-4 text-amber-400" /> Mint task as DTU</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {loading ? <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-white/40" /></div> :
           mint ? (
            <>
              <div className="bg-green-500/10 border border-green-400/30 rounded p-3 text-sm space-y-1">
                <div className="flex items-center gap-2 text-green-300 font-medium"><Check className="w-4 h-4" /> Minted</div>
                <div className="text-xs text-white/60 font-mono break-all">{mint.dtu_id}</div>
                <div className="grid grid-cols-2 gap-y-1 text-xs text-white/80 mt-2">
                  <div>Royalty: <span className="text-amber-300">{(mint.royalty_rate * 100).toFixed(1)}%</span></div>
                  <div>Visibility: <span className="text-cyan-300">{mint.visibility}</span></div>
                  <div>Citations: <span className="text-white">{mint.citation_count}</span></div>
                  <div>Minted: <span className="text-white/60">{new Date(mint.minted_at * 1000).toLocaleDateString()}</span></div>
                </div>
              </div>
              <p className="text-xs text-white/40">Other lenses can <code className="text-cyan-300">cite_dtu</code> this run; royalty cascade fires automatically.</p>
            </>
          ) : (
            <>
              {!["completed","failed","cancelled","budget_exceeded"].includes(task.status) ? (
                <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  Task isn't finished yet. Mint becomes available once the task reaches completed / failed / cancelled / budget_exceeded.
                </div>
              ) : (
                <>
                  <p className="text-sm text-white/70">
                    Mint this finished run as a citable <code className="text-cyan-300">browser_run</code> DTU. Downstream sales walk the ancestry chain.
                  </p>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1">Royalty rate</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min="0" max="0.3" step="0.005" value={royaltyRate} onChange={(e) => setRoyaltyRate(Number(e.target.value))} className="flex-1 accent-amber-400" />
                      <span className="text-amber-300 font-mono text-sm w-16 text-right">{(royaltyRate * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1">Visibility</label>
                    <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'workspace'|'public'|'published')} className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                      <option value="workspace" className="bg-black">workspace</option>
                      <option value="public" className="bg-black">public</option>
                      <option value="published" className="bg-black">published (marketplace)</option>
                    </select>
                  </div>
                  <button onClick={mintIt} disabled={busy} className="w-full py-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Mint
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
