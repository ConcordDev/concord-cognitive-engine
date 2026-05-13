'use client';

/**
 * FishingMinigameOverlay — KeyF near a water tile opens this.
 *
 * Three phases:
 *   1. Cast — show "casting…" briefly, then wait for bite
 *   2. Bite — flash + sound + tension bar appears
 *   3. Reel — keep tension in green zone for ~3s; on submit, post
 *      reactionMs + tensionAccuracy
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Fish, X } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface Props {
  open: boolean;
  worldId: string;
  position: { x: number; z: number };
  onClose: () => void;
}

type Phase = 'idle' | 'casting' | 'waiting' | 'biting' | 'reeling' | 'caught' | 'missed';

export function FishingMinigameOverlay({ open, worldId, position, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [biteAt, setBiteAt] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ fishName?: string; tier?: string; qualityScore?: number } | null>(null);
  const [tension, setTension] = useState(0.5);
  const reelStartRef = useRef<number>(0);
  const tensionSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open) { setPhase('idle'); setSessionId(null); setBiteAt(null); setOutcome(null); }
  }, [open]);

  // Cast on open
  useEffect(() => {
    if (!open || phase !== 'idle') return;
    setPhase('casting');
    fetch('/api/fishing/cast', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId, x: position.x, z: position.z, biome: 'water' }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setSessionId(j.sessionId);
          setBiteAt(j.biteAtEpochMs);
          setPhase('waiting');
        } else {
          setPhase('missed');
          setOutcome({ fishName: j?.error || 'cast_failed' });
        }
      })
      .catch(() => { setPhase('missed'); setOutcome({ fishName: 'network_error' }); });
  }, [open, phase, worldId, position.x, position.z]);

  // Bite arrives
  useEffect(() => {
    const off = subscribe<{ userId: string; sessionId: string }>(
      'fishing:bite',
      (msg) => {
        if (msg.sessionId === sessionId) {
          reelStartRef.current = Date.now();
          setPhase('biting');
          setTimeout(() => setPhase('reeling'), 600);
        }
      },
    );
    return off;
  }, [sessionId]);

  // Sample tension while reeling
  useEffect(() => {
    if (phase !== 'reeling') return;
    const id = setInterval(() => {
      // 1.0 = perfect (tension stayed close to 0.5)
      const dist = Math.abs(tension - 0.5);
      tensionSamplesRef.current.push(1 - dist * 2);
    }, 100);
    return () => clearInterval(id);
  }, [phase, tension]);

  // Define submitReel BEFORE the auto-submit useEffect so it can sit in
  // the dependency array without TDZ ("used before declaration"). Wrapped
  // in useCallback so the useEffect doesn't re-fire on every render.
  const submitReel = useCallback(async () => {
    if (!sessionId) return;
    const reactionMs = Date.now() - reelStartRef.current;
    const samples = tensionSamplesRef.current;
    const tensionAccuracy = samples.length === 0 ? 0.5 :
      samples.reduce((s, v) => s + v, 0) / samples.length;
    try {
      const r = await fetch(`/api/fishing/${sessionId}/reel`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactionMs, tensionAccuracy }),
      });
      const j = await r.json();
      if (j?.ok) {
        setOutcome({ fishName: j.fish?.name, tier: j.tier, qualityScore: j.qualityScore });
        setPhase('caught');
      } else {
        setOutcome({ fishName: j?.error || 'no_fish' });
        setPhase('missed');
      }
    } catch {
      setOutcome({ fishName: 'network_error' });
      setPhase('missed');
    }
  }, [sessionId]);

  // Auto-submit reel after 3s
  useEffect(() => {
    if (phase !== 'reeling' || !sessionId) return;
    const t = setTimeout(() => submitReel(), 3000);
    return () => clearTimeout(t);
  }, [phase, sessionId, submitReel]);

  // Keyboard: Up arrow / W = pull (more tension), Down / S = release
  useEffect(() => {
    if (phase !== 'reeling') return;
    const onKey = (e: KeyboardEvent) => {
      if (['w', 'W', 'ArrowUp'].includes(e.key)) setTension((t) => Math.min(1, t + 0.08));
      if (['s', 'S', 'ArrowDown'].includes(e.key)) setTension((t) => Math.max(0, t - 0.08));
    };
    window.addEventListener('keydown', onKey);
    // Tension naturally drifts down (line goes slack) — encourages active play
    const drift = setInterval(() => setTension((t) => Math.max(0, t - 0.02)), 100);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(drift);
    };
  }, [phase]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-96 rounded-lg border border-cyan-500/40 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-cyan-100">
            <Anchor className="h-5 w-5 text-cyan-300" />
            Fishing
          </h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-cyan-200" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === 'casting' && (
          <div className="py-8 text-center text-sm text-cyan-200">Casting line…</div>
        )}

        {phase === 'waiting' && biteAt && (
          <div className="py-8 text-center">
            <div className="mb-2 animate-pulse text-cyan-200">Waiting for a bite…</div>
            <div className="text-[10px] text-slate-500 tabular-nums">
              ~{Math.max(0, Math.ceil((biteAt - Date.now()) / 1000))}s
            </div>
          </div>
        )}

        {phase === 'biting' && (
          <div className="py-8 text-center text-lg font-bold text-amber-300 animate-pulse">
            ⚡ BITE! Get ready to reel
          </div>
        )}

        {phase === 'reeling' && (
          <div className="py-4">
            <div className="mb-2 text-xs text-slate-400">Hold tension in the green zone — W up, S down</div>
            <div className="relative h-32 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="absolute left-0 right-0 bg-emerald-500/30"
                style={{ top: '30%', height: '40%' }}
              />
              <div
                className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-amber-300 transition-all"
                style={{ top: `${(1 - tension) * 100}%` }}
              />
            </div>
            <div className="mt-2 text-center text-[10px] text-slate-400 tabular-nums">
              Tension: {Math.round(tension * 100)}%
            </div>
            <button
              onClick={submitReel}
              className="mt-3 w-full rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium hover:bg-emerald-600"
            >
              Reel in now
            </button>
          </div>
        )}

        {phase === 'caught' && outcome && (
          <div className="py-4 text-center">
            <Fish className="mx-auto mb-2 h-10 w-10 text-amber-300" />
            <div className="text-lg font-bold text-amber-100">Caught: {outcome.fishName}</div>
            {outcome.tier && <div className="mt-1 text-xs text-slate-300">Quality: {outcome.tier}</div>}
            {outcome.qualityScore !== undefined && (
              <div className="text-[10px] text-slate-500">Score: {Math.round(outcome.qualityScore * 100)}%</div>
            )}
            <button
              onClick={onClose}
              className="mt-3 rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
            >
              Done
            </button>
          </div>
        )}

        {phase === 'missed' && (
          <div className="py-4 text-center">
            <div className="text-rose-300">{outcome?.fishName || 'No catch this time.'}</div>
            <button
              onClick={onClose}
              className="mt-3 rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
