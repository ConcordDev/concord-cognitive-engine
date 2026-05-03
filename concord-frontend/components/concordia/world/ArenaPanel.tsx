'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Swords, Users, Trophy } from 'lucide-react';

interface ArenaMatch {
  id: string;
  proposer_id: string;
  opponent_id: string;
  proposer_name?: string;
  opponent_name?: string;
  status: string;
  winner_id?: string;
  amount: number;
  proposed_at: number;
}

interface ArenaState {
  inQueue: boolean;
  queueSize: number;
  position: number | null;
}

interface ArenaPanelProps {
  playerId?: string;
  onClose?: () => void;
}

export function ArenaPanel({ playerId, onClose }: ArenaPanelProps) {
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [queueState, setQueueState] = useState<ArenaState>({ inQueue: false, queueSize: 0, position: null });
  const [matches, setMatches] = useState<ArenaMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchAlert, setMatchAlert] = useState<{ matchId: string; opponentId: string } | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      const r = await fetch('/api/arena/queue');
      if (r.ok) {
        const d = await r.json();
        setQueueState({ inQueue: d.inQueue, queueSize: d.queueSize, position: d.position });
      }
    } catch { /* offline */ }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/arena/matches');
      if (r.ok) {
        const d = await r.json();
        setMatches(d.matches ?? []);
      }
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    refreshQueue();
    loadHistory();
    const interval = setInterval(refreshQueue, 5000);
    return () => clearInterval(interval);
  }, [refreshQueue, loadHistory]);

  const joinQueue = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/arena/queue', { method: 'POST' });
      const d = await r.json();
      if (d.status === 'matched' && d.matchId) {
        setMatchAlert({ matchId: d.matchId, opponentId: d.opponentId });
      }
      await refreshQueue();
    } catch { /* offline */ }
    setLoading(false);
  };

  const leaveQueue = async () => {
    setLoading(true);
    try { await fetch('/api/arena/queue/leave', { method: 'POST' }); } catch { /* offline */ }
    await refreshQueue();
    setLoading(false);
  };

  const isWin = (match: ArenaMatch) => match.winner_id === playerId;

  return (
    <div className="fixed right-4 top-20 w-72 bg-black/90 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] z-40">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Swords className="w-4 h-4 text-red-400" />
          <h2 className="text-white font-bold text-sm">Arena</h2>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      {/* Match alert */}
      {matchAlert && (
        <div className="mx-3 mt-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl p-3 text-center">
          <div className="text-yellow-400 font-bold text-sm">Match Found!</div>
          <div className="text-white/60 text-xs mt-1">vs {matchAlert.opponentId.slice(0, 8)}</div>
          <div className="text-white/40 text-xs mt-1">25 ⚡ Sparks at stake</div>
          <button onClick={() => setMatchAlert(null)} className="mt-2 text-xs text-yellow-400 underline">Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(['queue', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'text-white border-b-2 border-red-400' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto flex-1 p-3">
        {tab === 'queue' ? (
          <div className="space-y-4">
            {/* Queue status */}
            <div className="bg-white/5 rounded-xl p-4 text-center space-y-2">
              <Users className="w-8 h-8 text-red-400 mx-auto" />
              <div className="text-white font-bold text-2xl">{queueState.queueSize}</div>
              <div className="text-white/40 text-xs">players in queue</div>
              {queueState.inQueue && queueState.position != null && (
                <div className="text-white/60 text-xs">You are #{queueState.position}</div>
              )}
            </div>

            {/* Wager info */}
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400/80">
              Each match: 25 ⚡ auto-wager. Winner takes 49 ⚡ (2% platform fee).
            </div>

            {/* Join/leave */}
            {queueState.inQueue ? (
              <button
                onClick={leaveQueue}
                disabled={loading}
                className="w-full bg-red-600/40 hover:bg-red-600/60 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                Leave Queue
              </button>
            ) : (
              <button
                onClick={joinQueue}
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {loading ? 'Joining…' : 'Enter Arena Queue'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {matches.length === 0 ? (
              <div className="text-white/30 text-xs text-center py-8">No matches yet</div>
            ) : (
              matches.map(m => {
                const won = isWin(m);
                const opponent = m.proposer_id === playerId ? m.opponent_name : m.proposer_name;
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${won ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {won
                      ? <Trophy className="w-4 h-4 text-yellow-400 shrink-0" />
                      : <Swords className="w-4 h-4 text-red-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs truncate">vs {opponent?.slice(0, 10) ?? 'Unknown'}</div>
                      <div className={`text-[10px] ${won ? 'text-green-400' : 'text-red-400'}`}>
                        {m.status === 'resolved' ? (won ? '+49 ⚡' : '-25 ⚡') : m.status}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
