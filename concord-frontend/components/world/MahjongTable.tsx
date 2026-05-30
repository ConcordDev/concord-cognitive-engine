'use client';

// Phase E4 — Mahjong real tile-sim table.
//
// Player (seat 0, east, dealer) + 3 NPCs. Player draws 14 at start;
// click a tile to discard; NPCs auto-play; UI returns when it's the
// player's turn again. Tsumo button surfaces when the hand is a
// winning 14-tile shape.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { Sparkles, Hand, Loader2, Trophy, AlertTriangle } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, milestoneJuice, failureJuice } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';
import { Tile } from './mahjong/Tile';

interface Seat {
  seat_index: number;
  entity_kind: 'player' | 'npc';
  entity_id: string;
  seat_wind: 'east' | 'south' | 'west' | 'north';
  hand_json: string;
  discards_json: string;
  style?: string;
  tsumo_at: number | null;
}

interface SessionState {
  id: string;
  world_id: string;
  ended_at: number | null;
  end_reason: string | null;
  winner_seat: number | null;
  round_wind: string;
  dora_indicator: string;
  wall_remaining: number;
  turn_seat: number;
  seats: Seat[];
}

const STYLE_NAMES: Record<string, string> = {
  safe: 'Safe-First',
  tempai: 'Tempai-Rush',
  yakuhunt: 'Yaku-Hunter',
};

export function MahjongTable({ building, onClose, worldId }: OverlayProps) {
  const POLL_MS = useClientConfig().poll.mahjongMs; // E0 — server-tunable
  const [session, setSession] = useState<SessionState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [endResult, setEndResult] = useState<{ winnerSeat: number; reason: string; scoring?: { score?: number; payload?: { grade?: string }; yaku?: string[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setPending(true);
    try {
      const r = await fetch('/api/mahjong/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      const j = await r.json();
      if (j?.ok) {
        const r2 = await fetch(`/api/mahjong/${j.sessionId}/state`, { credentials: 'include' });
        const s = await r2.json();
        if (s?.ok) setSession(s.session);
      } else {
        setError(j?.error || 'start_failed');
      }
    } finally { setPending(false); }
  }, [worldId]);

  const refresh = useCallback(async () => {
    if (!session?.id) return;
    try {
      const r = await fetch(`/api/mahjong/${session.id}/state`, { credentials: 'include' });
      const j = await r.json();
      if (j?.ok) setSession(j.session);
    } catch { /* swallow */ }
  }, [session?.id]);

  // Light polling for end-state detection (NPC tsumo wins).
  useRealtimeRefresh(['mahjong:state'], refresh, {
    backstopMs: POLL_MS * 6, immediate: false,
    enabled: !!session?.id && !session?.ended_at && session?.turn_seat !== 0,
  });

  // Catch end-of-session.
  useEffect(() => {
    if (!session?.ended_at || endResult) return;
    setEndResult({
      winnerSeat: session.winner_seat ?? -1,
      reason: session.end_reason || 'ended',
    });
    if (session.winner_seat === 0) milestoneJuice('ui_mahjong_tsumo');
    else if (session.winner_seat != null) failureJuice('ui_mahjong_lost');
  }, [session?.ended_at, session?.winner_seat, session?.end_reason, endResult]);

  const discard = useCallback(async (tile: string) => {
    if (!session?.id) return;
    setPending(true);
    try {
      const r = await fetch(`/api/mahjong/${session.id}/discard`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tile }),
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('craft'); // tile placement — hand manipulation in place
        successJuice('ui_mahjong_discard');
        setPicked(null);
        refresh();
      } else {
        setError(j?.error || 'discard_failed');
        failureJuice();
      }
    } finally { setPending(false); }
  }, [session?.id, refresh]);

  const callTsumo = useCallback(async () => {
    if (!session?.id) return;
    setPending(true);
    try {
      const r = await fetch(`/api/mahjong/${session.id}/tsumo`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('wave'); // victory flourish on the winning hand
        milestoneJuice('ui_mahjong_tsumo');
        setEndResult({ winnerSeat: 0, reason: 'tsumo', scoring: j.scoring });
        refresh();
      } else {
        setError(j?.error || 'tsumo_failed');
        failureJuice('ui_mahjong_no_win');
      }
    } finally { setPending(false); }
  }, [session?.id, refresh]);

  const playerSeat = session?.seats[0];
  const playerHand: string[] = playerSeat ? JSON.parse(playerSeat.hand_json) : [];
  const npcSeats = session?.seats.slice(1) || [];
  const isPlayerTurn = session?.turn_seat === 0 && !session?.ended_at;
  const canTsumo = isPlayerTurn && playerHand.length === 14;

  return (
    <StationOverlayShell
      title={building.name || 'Mahjong table'}
      subtitle={`mahjong · ${worldId}`}
      onClose={onClose}
      accent="emerald"
      size="xl"
    >
      {!session ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-emerald-200">Sit down. East is dealer. Three NPCs are waiting: Safe-First, Tempai-Rush, Yaku-Hunter.</p>
          <button onClick={start} disabled={pending} className="rounded bg-emerald-500/40 px-4 py-2 text-sm text-emerald-50 hover:bg-emerald-500/60 disabled:opacity-50">
            {pending ? <Loader2 className="inline animate-spin" size={14} /> : <Sparkles className="inline" size={14} />} Start a hand
          </button>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {/* NPC seats */}
          <div className="grid grid-cols-3 gap-2">
            {npcSeats.map((s) => {
              const discards = JSON.parse(s.discards_json);
              return (
                <div key={s.seat_index} className="rounded border border-emerald-500/30 bg-emerald-950/30 p-2">
                  <div className="flex items-center justify-between text-[10px] text-emerald-300/70">
                    <span>{s.seat_wind.toUpperCase()} · {STYLE_NAMES[s.style || ''] || s.style}</span>
                    {s.tsumo_at && <span className="text-amber-300">TSUMO!</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {/* Face-down hand */}
                    {Array.from({ length: 13 }).map((_, i) => <Tile key={`back-${i}`} tile="?" faceDown size="sm" />)}
                  </div>
                  <div className="mt-1 text-[9px] text-emerald-300/60">discards ({discards.length}):</div>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {discards.slice(-12).map((t: string, i: number) => <Tile key={`dis-${s.seat_index}-${i}`} tile={t} size="sm" />)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center info */}
          <div className="rounded border border-emerald-500/30 bg-emerald-950/40 p-2 text-center">
            <div className="text-[10px] uppercase text-emerald-300/70">round {session.round_wind} · wall {session.wall_remaining} · turn → seat {session.turn_seat}</div>
            <div className="mt-1 flex items-center justify-center gap-2 text-[10px] text-emerald-200">
              <span>Dora indicator:</span>
              <Tile tile={session.dora_indicator || 'm1'} size="sm" />
            </div>
          </div>

          {/* Player hand */}
          {playerSeat && (
            <div className="rounded border border-emerald-500/40 bg-emerald-950/30 p-3">
              <div className="flex items-center justify-between text-[10px] text-emerald-300/70">
                <span>Your hand ({playerSeat.seat_wind.toUpperCase()} · dealer)</span>
                <span>{playerHand.length} tiles</span>
              </div>
              <div className="mt-2 flex flex-wrap items-end justify-center gap-1">
                {playerHand.map((t, i) => (
                  <Tile
                    key={`hand-${i}`}
                    tile={t}
                    selected={picked === t}
                    onClick={isPlayerTurn ? () => setPicked(t) : undefined}
                    size="md"
                  />
                ))}
              </div>

              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  onClick={() => picked && discard(picked)}
                  disabled={pending || !isPlayerTurn || !picked}
                  className="rounded bg-emerald-500/40 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/60 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="inline animate-spin" size={12} /> : <Hand className="inline" size={12} />} Discard {picked || '…'}
                </button>
                <button
                  onClick={callTsumo}
                  disabled={pending || !canTsumo}
                  className="rounded bg-amber-500/50 px-3 py-1.5 text-xs font-bold text-amber-50 hover:bg-amber-500/70 disabled:opacity-50"
                  title="Tsumo — declare a winning self-drawn hand"
                >
                  TSUMO
                </button>
              </div>

              {error && (
                <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-red-300">
                  <AlertTriangle size={11} /> {error}
                </div>
              )}

              <div className="mt-2 text-[9px] text-emerald-300/60 text-center">
                Recent discards:
                <div className="mt-1 flex flex-wrap justify-center gap-0.5">
                  {JSON.parse(playerSeat.discards_json).slice(-12).map((t: string, i: number) => (
                    <Tile key={`mydis-${i}`} tile={t} size="sm" />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* End-of-hand modal-in-modal */}
          {endResult && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/40 p-4 text-center">
              <Trophy className="mx-auto text-amber-300" size={26} />
              <div className="mt-1 font-bold text-amber-100">
                {endResult.winnerSeat === 0 ? 'YOU WIN' : endResult.winnerSeat === -1 ? 'Wall exhausted (draw)' : `Seat ${endResult.winnerSeat} wins`}
              </div>
              <div className="text-[10px] text-amber-200/70">via {endResult.reason}</div>
              {endResult.scoring && (
                <div className="mt-2 text-xs text-amber-100">
                  Yaku: {endResult.scoring.yaku?.join(', ') || 'none'} · Score: {endResult.scoring.score}
                </div>
              )}
              <button onClick={() => { setSession(null); setEndResult(null); setError(null); setPicked(null); }} className="mt-3 rounded bg-emerald-500/40 px-3 py-1 text-xs text-emerald-50 hover:bg-emerald-500/60">
                New hand
              </button>
            </div>
          )}
        </div>
      )}
    </StationOverlayShell>
  );
}
