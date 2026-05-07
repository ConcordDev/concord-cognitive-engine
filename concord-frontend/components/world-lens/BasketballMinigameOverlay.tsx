'use client';

/**
 * BasketballMinigameOverlay — quick 1v1 basketball UI.
 *
 * Activated by approaching a hoop in the world (district has
 * hoop_locations registry — v1 just opens via lens hub button).
 *
 * Hold mouse to charge shot power, release to shoot. Distance to hoop
 * determines 2 vs 3 points. Anti-cheat at server validates shooterPos.
 */

import { useEffect, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { subscribe, getSocket } from '@/lib/realtime/socket';

interface Props {
  open: boolean;
  matchId: string | null;
  worldId: string;
  hoopPosition: { x: number; z: number };
  shooterPosition: { x: number; z: number };
  onClose: () => void;
}

interface MatchState {
  scores: Record<string, number>;
  status: string;
  players: string[];
}

export function BasketballMinigameOverlay({
  open, matchId, worldId, hoopPosition, shooterPosition, onClose,
}: Props) {
  void worldId;
  const [match, setMatch] = useState<MatchState | null>(null);
  const [charging, setCharging] = useState(false);
  const [chargeStart, setChargeStart] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; eventKind?: string; points?: number } | null>(null);

  const distance = Math.hypot(shooterPosition.x - hoopPosition.x, shooterPosition.z - hoopPosition.z);

  useEffect(() => {
    if (!open || !matchId) return;
    fetch(`/api/minigames/basketball/${matchId}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setMatch(j.match); })
      .catch(() => {});
  }, [open, matchId]);

  useEffect(() => {
    if (!matchId) return;
    const off = subscribe<{ matchId: string; actor: string; eventKind: string; points: number }>(
      'minigame:scored',
      (msg) => {
        if (msg.matchId === matchId) {
          fetch(`/api/minigames/basketball/${matchId}`, { credentials: 'same-origin' })
            .then((r) => r.json())
            .then((j) => { if (j?.ok) setMatch(j.match); })
            .catch(() => {});
        }
      },
    );
    const off2 = subscribe<{ matchId: string; winner: string }>(
      'minigame:complete',
      (msg) => { if (msg.matchId === matchId) onClose(); },
    );
    return () => { off(); off2(); };
  }, [matchId, onClose]);

  const handleMouseDown = () => {
    setCharging(true);
    setChargeStart(Date.now());
  };

  const handleMouseUp = async () => {
    if (!charging || !matchId) return;
    setCharging(false);
    const charge = Math.min(1, (Date.now() - chargeStart) / 1500);
    // For v1: probability of made shot scales with charge (must release at peak)
    // and inversely with distance — closer shots are easier.
    const optimal = 0.7 + Math.min(0.3, distance / 30);
    const charge_quality = 1 - Math.abs(charge - optimal);
    const made = Math.random() < (0.4 + charge_quality * 0.5);

    try {
      const r = await fetch(`/api/minigames/basketball/${matchId}/shot`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shooterPos: { x: shooterPosition.x, y: 0, z: shooterPosition.z },
          made,
        }),
      });
      const j = await r.json();
      setOutcome(j);
      setTimeout(() => setOutcome(null), 1500);
    } catch { /* ok */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 backdrop-blur-sm">
      <div className="mb-8 w-96 rounded-lg border border-orange-500/40 bg-slate-900/95 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-orange-100">
            <Trophy className="h-5 w-5 text-orange-300" />
            Basketball
          </h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {match && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {match.players.map((p) => (
              <div key={p} className="rounded bg-slate-800 p-2 text-center">
                <div className="text-[10px] text-slate-400">{p.slice(0, 12)}</div>
                <div className="text-2xl font-bold text-orange-300 tabular-nums">{match.scores[p] || 0}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-2 text-center text-[10px] text-slate-400">
          Distance: {distance.toFixed(1)}m · {distance > 6.75 ? '3pt' : '2pt'} zone
        </div>

        <button
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setCharging(false)}
          className={`w-full rounded py-3 text-sm font-bold transition ${
            charging ? 'bg-orange-600 text-orange-50 animate-pulse' : 'bg-orange-700 text-orange-50 hover:bg-orange-600'
          }`}
        >
          {charging ? 'Hold… release to shoot' : 'Hold to charge shot'}
        </button>

        {outcome && (
          <div
            className={`mt-2 rounded p-2 text-center text-sm ${
              outcome.points && outcome.points > 0
                ? 'bg-emerald-950/40 text-emerald-100'
                : 'bg-rose-950/40 text-rose-100'
            }`}
          >
            {outcome.points && outcome.points > 0
              ? `+${outcome.points} points!`
              : 'Missed!'}
          </div>
        )}
      </div>
    </div>
  );
}

void getSocket;
