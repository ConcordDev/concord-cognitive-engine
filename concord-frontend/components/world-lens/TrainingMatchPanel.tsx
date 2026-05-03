'use client';

/**
 * TrainingMatchPanel — UI surface for the PvP Training Match flow.
 *
 * Three modes stack into one panel pinned top-right when a match is in any
 * non-ended state:
 *
 *   1. Incoming challenge banner — the opponent invited the player. Accept
 *      / decline buttons. Auto-dismisses after 30s if ignored.
 *   2. Active match HUD — round counter, win tally per player, "Safe Reset"
 *      button (either side can press; both heal + brief safe zone), and
 *      "Forfeit" button.
 *   3. Round-end flash — when the realtime training:round-end event fires,
 *      a brief overlay shows "Round N to <winner>" and prompts safe-reset.
 *
 * Listens to realtime events:
 *   training:challenge   — incoming invite
 *   training:start       — both accepted, fight begins
 *   training:safe-reset  — pause + heal both fighters
 *   training:resume      — safe zone over, fight on
 *   training:round-end   — round logged
 *   training:end         — match concluded
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface MatchInfo {
  id: string;
  initiator_id: string;
  opponent_id: string;
  status: 'pending' | 'active' | 'reset' | 'ended';
  mode: string;
  hp_threshold: number;
  rounds_played: number;
  max_rounds: number;
  initiator_wins: number;
  opponent_wins: number;
}

interface IncomingChallenge {
  matchId: string;
  initiatorId: string;
  mode?: string;
  maxRounds?: number;
  receivedAt: number;
}

interface RoundFlash {
  winnerId: string;
  roundNumber: number;
  shownAt: number;
}

interface Props {
  myUserId: string;
}

const CHALLENGE_TTL_MS = 30_000;
const ROUND_FLASH_MS   = 2_400;

export default function TrainingMatchPanel({ myUserId }: Props) {
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
  const [roundFlash, setRoundFlash] = useState<RoundFlash | null>(null);
  const [safeUntil, setSafeUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const lastRefreshRef = useRef(0);

  const refreshMatch = useCallback(async () => {
    const now = performance.now();
    if (now - lastRefreshRef.current < 500) return;
    lastRefreshRef.current = now;
    try {
      const r = await fetch('/api/training-match/me', { credentials: 'same-origin' });
      const j = await r.json();
      setMatch(j?.match ?? null);
    } catch { /* silent */ }
  }, []);

  // Initial load
  useEffect(() => { refreshMatch(); }, [refreshMatch]);

  // ── Realtime subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    const offChallenge = subscribe<{ matchId: string; initiatorId: string; mode: string; maxRounds: number }>(
      'training:challenge',
      (msg) => {
        setIncoming({
          matchId: msg.matchId, initiatorId: msg.initiatorId,
          mode: msg.mode, maxRounds: msg.maxRounds,
          receivedAt: Date.now(),
        });
      },
    );
    const offStart = subscribe<{ matchId: string }>(
      'training:start',
      () => { setIncoming(null); refreshMatch(); },
    );
    const offReset = subscribe<{ matchId: string; safeUntil: number; requestedBy: string }>(
      'training:safe-reset',
      (msg) => {
        setSafeUntil(msg.safeUntil);
        setMatch((prev) => prev ? { ...prev, status: 'reset' } : prev);
      },
    );
    const offResume = subscribe<{ matchId: string }>(
      'training:resume',
      () => {
        setSafeUntil(null);
        setMatch((prev) => prev ? { ...prev, status: 'active' } : prev);
      },
    );
    const offRound = subscribe<{ matchId: string; winnerId: string; roundNumber: number }>(
      'training:round-end',
      (msg) => {
        setRoundFlash({ winnerId: msg.winnerId, roundNumber: msg.roundNumber, shownAt: Date.now() });
        refreshMatch();
        setTimeout(() => setRoundFlash(null), ROUND_FLASH_MS);
      },
    );
    const offEnd = subscribe<{ matchId: string; reason: string }>(
      'training:end',
      () => { refreshMatch(); },
    );
    return () => {
      offChallenge(); offStart(); offReset(); offResume(); offRound(); offEnd();
    };
  }, [refreshMatch]);

  // Auto-dismiss incoming after TTL
  useEffect(() => {
    if (!incoming) return;
    const remaining = CHALLENGE_TTL_MS - (Date.now() - incoming.receivedAt);
    if (remaining <= 0) { setIncoming(null); return; }
    const t = setTimeout(() => setIncoming(null), remaining);
    return () => clearTimeout(t);
  }, [incoming]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const acceptChallenge = useCallback(async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await fetch(`/api/training-match/${incoming.matchId}/accept`, {
        method: 'POST', credentials: 'same-origin',
      });
      setIncoming(null);
      refreshMatch();
    } finally {
      setBusy(false);
    }
  }, [incoming, refreshMatch]);

  const declineChallenge = useCallback(() => {
    setIncoming(null);
  }, []);

  const triggerSafeReset = useCallback(async () => {
    if (!match) return;
    setBusy(true);
    try {
      await fetch(`/api/training-match/${match.id}/safe-reset`, {
        method: 'POST', credentials: 'same-origin',
      });
    } finally {
      setBusy(false);
    }
  }, [match]);

  const forfeit = useCallback(async () => {
    if (!match) return;
    setBusy(true);
    try {
      await fetch(`/api/training-match/${match.id}/forfeit`, {
        method: 'POST', credentials: 'same-origin',
      });
      refreshMatch();
    } finally {
      setBusy(false);
    }
  }, [match, refreshMatch]);

  // Render nothing when there's no incoming + no active match + no flash
  if (!incoming && !match && !roundFlash) return null;

  // For active match: figure out my side
  const meIsInitiator = match?.initiator_id === myUserId;
  const myWins  = meIsInitiator ? match?.initiator_wins ?? 0 : match?.opponent_wins ?? 0;
  const oppWins = meIsInitiator ? match?.opponent_wins ?? 0 : match?.initiator_wins ?? 0;

  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-auto">
      {/* Incoming challenge */}
      {incoming && (
        <div className="bg-slate-950/90 border-2 border-amber-400/70 rounded-lg p-4 shadow-2xl backdrop-blur-md"
             style={{ boxShadow: '0 0 24px rgba(251,191,36,0.4)' }}>
          <div className="text-xs uppercase tracking-wider text-amber-300 mb-1 font-semibold">
            Training Challenge
          </div>
          <p className="text-sm text-white mb-3">
            <span className="font-mono">{incoming.initiatorId.slice(0, 12)}</span> wants to spar with you
            ({incoming.maxRounds ?? 20} rounds).
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={acceptChallenge}
              className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
            >
              Accept
            </button>
            <button
              disabled={busy}
              onClick={declineChallenge}
              className="flex-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded transition-colors disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Active match HUD */}
      {match && match.status !== 'ended' && (
        <div className="bg-slate-950/90 border border-cyan-500/50 rounded-lg p-3 shadow-2xl backdrop-blur-md"
             style={{ boxShadow: '0 0 16px rgba(34,211,238,0.25)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-cyan-300 font-semibold">
              Training Match
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${
              match.status === 'active' ? 'bg-emerald-500/20 text-emerald-300'
              : match.status === 'reset' ? 'bg-amber-500/20 text-amber-300'
              : 'bg-slate-500/20 text-slate-300'
            }`}>
              {match.status.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-emerald-300 font-mono font-semibold">{myWins}</span>
            <span className="text-slate-400 text-xs">
              Round {match.rounds_played + 1} / {match.max_rounds}
            </span>
            <span className="text-rose-300 font-mono font-semibold">{oppWins}</span>
          </div>

          {/* Progress bar showing round position */}
          <div className="h-1 bg-slate-800 rounded mb-3 overflow-hidden">
            <div
              className="h-full bg-cyan-400/70 rounded transition-all duration-300"
              style={{ width: `${(match.rounds_played / match.max_rounds) * 100}%` }}
            />
          </div>

          {match.status === 'reset' && safeUntil && (
            <div className="text-[10px] text-amber-300 mb-2 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Safe zone — both fighters healing
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={busy || match.status !== 'active'}
              onClick={triggerSafeReset}
              className="flex-1 px-3 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-40"
            >
              Safe Reset
            </button>
            <button
              disabled={busy}
              onClick={forfeit}
              className="px-3 py-1.5 bg-rose-700/70 hover:bg-rose-600 text-white text-xs rounded transition-colors disabled:opacity-50"
            >
              Forfeit
            </button>
          </div>
        </div>
      )}

      {/* Round-end flash */}
      {roundFlash && (
        <div
          className="bg-cyan-900/95 border-2 border-cyan-400 rounded-lg p-3 shadow-2xl backdrop-blur-md text-center"
          style={{
            boxShadow: '0 0 32px rgba(34,211,238,0.55)',
            animation: 'roundFlash 2.4s ease-out',
          }}
        >
          <div className="text-[10px] uppercase tracking-widest text-cyan-300 mb-1">
            Round {roundFlash.roundNumber}
          </div>
          <div className="text-sm font-bold text-white">
            {roundFlash.winnerId === myUserId ? 'You won the round' : 'Opponent won'}
          </div>
          <style jsx>{`
            @keyframes roundFlash {
              0%   { transform: scale(0.9); opacity: 0; }
              15%  { transform: scale(1.05); opacity: 1; }
              85%  { transform: scale(1); opacity: 1; }
              100% { transform: scale(1); opacity: 0; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
