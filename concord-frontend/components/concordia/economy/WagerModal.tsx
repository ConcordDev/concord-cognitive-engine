'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api/client';

type Currency = 'sparks' | 'cc';
type DuelType = 'combat' | 'racing' | 'puzzle' | 'custom';

interface WagerModalProps {
  opponentId: string;
  opponentName: string;
  worldId?: string;
  onClose: () => void;
  onProposed?: (wagerId: string) => void;
}

interface IncomingWagerPromptProps {
  wagerId: string;
  proposerName: string;
  amount: number;
  currency: Currency;
  duelType: string;
  expiresAt: number;
  onAccept: () => void;
  onDecline: () => void;
}

export function WagerModal({ opponentId, opponentName, worldId, onClose, onProposed }: WagerModalProps) {
  const [amount, setAmount] = useState(10);
  const [currency, setCurrency] = useState<Currency>('sparks');
  const [duelType, setDuelType] = useState<DuelType>('combat');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);

  const handlePropose = async () => {
    if (amount <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/api/wagers/propose', { opponentId, amount, currency, duelType, worldId });
      setProposed(true);
      onProposed?.(r.data?.wagerId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg === 'insufficient_balance' ? 'Not enough balance' :
               msg === 'too_many_active_proposals' ? 'Too many active proposals (max 3)' :
               msg ?? 'Proposal failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-black/90 border border-white/10 rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold">Challenge {opponentName}</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white">✕</button>
        </div>

        {proposed ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-2xl">⚔️</div>
            <div className="text-white font-semibold">Wager proposed!</div>
            <div className="text-white/50 text-sm">{opponentName} has 60 seconds to accept.</div>
            <button onClick={onClose} className="mt-2 px-4 py-2 rounded-xl bg-white/10 text-white text-sm">Close</button>
          </div>
        ) : (
          <>
            {/* Currency selector */}
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Currency</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrency('sparks')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${currency === 'sparks' ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400' : 'border-white/10 text-white/40 hover:border-white/20'}`}
                >
                  ⚡ Sparks
                </button>
                <button
                  onClick={() => setCurrency('cc')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${currency === 'cc' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-white/40 hover:border-white/20'}`}
                >
                  💎 CC
                </button>
              </div>
              {currency === 'cc' && (
                <p className="text-[10px] text-blue-300/60 mt-1">CC = real money. Both parties must accept before any funds move.</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Amount</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={e => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>

            {/* Duel type */}
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Duel Type</label>
              <select
                value={duelType}
                onChange={e => setDuelType(e.target.value as DuelType)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              >
                <option value="combat">Combat</option>
                <option value="racing">Racing</option>
                <option value="puzzle">Puzzle</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {error && <div className="text-xs text-red-400 font-mono">{error}</div>}

            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-white/50 text-sm hover:border-white/20">Cancel</button>
              <button
                onClick={handlePropose}
                disabled={loading || amount <= 0}
                className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-bold transition-all"
              >
                {loading ? 'Proposing…' : `Wager ${amount} ${currency === 'sparks' ? '⚡' : '💎'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function IncomingWagerPrompt({ wagerId, proposerName, amount, currency, duelType, expiresAt, onAccept, onDecline }: IncomingWagerPromptProps) {
  const [loading, setLoading] = useState(false);
  const secondsLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

  const handle = async (action: 'accept' | 'decline') => {
    setLoading(true);
    try {
      await api.post(`/api/wagers/${wagerId}/${action}`);
      if (action === 'accept') onAccept(); else onDecline();
    } catch { onDecline(); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed bottom-24 right-4 bg-black/90 border border-white/15 rounded-2xl p-4 w-72 z-50 shadow-2xl">
      <div className="text-white font-bold text-sm mb-1">⚔️ Challenge from {proposerName}</div>
      <div className="text-white/50 text-xs mb-3">
        {amount} {currency === 'sparks' ? '⚡ Sparks' : '💎 CC'} · {duelType} · {secondsLeft}s to decide
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handle('decline')}
          disabled={loading}
          className="flex-1 py-1.5 rounded-lg border border-white/10 text-white/50 text-xs hover:border-white/20"
        >Decline</button>
        <button
          onClick={() => handle('accept')}
          disabled={loading}
          className="flex-1 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-bold"
        >Accept</button>
      </div>
    </div>
  );
}
