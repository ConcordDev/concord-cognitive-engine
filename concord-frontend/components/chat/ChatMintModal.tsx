'use client';

/**
 * ChatMintModal — concord moat surface. Mint the current chat
 * session as a citable chat_session DTU. Royalty rate slider
 * clamped 0-30% (constitutional invariant). Visibility ladder
 * private/workspace/public/published. After mint, surface the
 * resulting DTU id so the user can copy + share.
 */

import { useState, useEffect, useCallback } from 'react';
import { callChatMacro } from '@/lib/api/chat-extras';
import { X, Coins, Loader2, Check, Sparkles, Link2 } from 'lucide-react';

interface Mint {
  dtu_id: string; royalty_rate: number; visibility: string;
  citation_count: number; minted_at: number;
}

interface Props { open: boolean; onClose: () => void; sessionId: string | null; }

export function ChatMintModal({ open, onClose, sessionId }: Props) {
  const [mint, setMint] = useState<Mint | null>(null);
  const [royaltyRate, setRoyaltyRate] = useState(0.21);
  const [visibility, setVisibility] = useState<'workspace' | 'public' | 'published'>('workspace');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publicSlug, setPublicSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    (async () => {
      try {
        const r = await callChatMacro<{ minted?: boolean; mint?: Mint }>('session_mint_status', { sessionId });
        setMint(r?.minted ? r.mint || null : null);
      } finally { setLoading(false); }
    })();
  }, [open, sessionId]);

  const mintIt = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const r = await callChatMacro<{ dtuId?: string }>('session_mint', { sessionId, royaltyRate, visibility });
      if (r.ok) {
        const status = await callChatMacro<{ mint?: Mint }>('session_mint_status', { sessionId });
        setMint(status?.mint || null);
      }
    } finally { setBusy(false); }
  }, [sessionId, royaltyRate, visibility]);

  const sharePublic = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const r = await callChatMacro<{ slug?: string }>('public_link_create', { sessionId });
      if (r.ok && r.slug) setPublicSlug(r.slug);
    } finally { setBusy(false); }
  }, [sessionId]);

  if (!open || !sessionId) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-amber-400/30 rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-400" /> Mint chat session
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-white/40" /></div>
          ) : mint ? (
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
              <p className="text-xs text-white/40">Other docs / tasks / calendar events can cite this chat; cascade fires on cite.</p>
              {!publicSlug && (
                <button onClick={sharePublic} disabled={busy} className="w-full py-2 rounded bg-white/10 hover:bg-white/15 text-white text-sm flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  Generate public read-only link
                </button>
              )}
              {publicSlug && (
                <div className="bg-cyan-500/10 border border-cyan-400/30 rounded p-2 text-xs">
                  <div className="text-cyan-300 font-medium mb-1">Public link</div>
                  <code className="text-white/80 break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/share/chat/{publicSlug}</code>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-white/70">
                Mint this conversation as a citable <code className="text-cyan-300">chat_session</code> DTU. Other lenses can <code className="text-cyan-300">cite_dtu</code> it; royalty cascade fires through the existing engine.
              </p>
              <div>
                <label className="block text-xs uppercase tracking-wide text-white/40 mb-1">Royalty rate</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="0" max="0.3" step="0.005" value={royaltyRate} onChange={(e) => setRoyaltyRate(Number(e.target.value))} className="flex-1 accent-amber-400" />
                  <span className="text-amber-300 font-mono text-sm w-16 text-right">{(royaltyRate * 100).toFixed(1)}%</span>
                </div>
                <p className="text-xs text-white/40 mt-1">Capped at 30% (constitutional invariant).</p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-white/40 mb-1">Visibility</label>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                  <option value="workspace" className="bg-black">workspace</option>
                  <option value="public" className="bg-black">public</option>
                  <option value="published" className="bg-black">published (marketplace)</option>
                </select>
              </div>
              <button onClick={mintIt} disabled={busy} className="w-full py-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Mint
              </button>
              <p className="text-xs text-white/40">One-way mint per session.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
