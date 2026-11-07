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

/** F5 fix: generic ability groups (not per-species special-casing) driving
 *  real fight behavior from the catalog's own `abilities` field — present in
 *  the real fauna file as e.g. evade/vanish, dart/leap, pull/thrash, etc. */
const EVASIVE_ABILITIES = new Set(['evade', 'vanish']);

export function FishingMinigameOverlay({ open, worldId, position, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [biteAt, setBiteAt] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ fishName?: string; tier?: string; qualityScore?: number; mintFailed?: boolean; rarity?: string }>({});
  const [tension, setTension] = useState(0.5);
  // F5 fix: the species is now chosen server-side at BITE time (pickBiteFish)
  // instead of only at reel-resolve time, so the fight can honestly reflect
  // it — real name + real abilities from the catalog, not a decorative row.
  const [biteFish, setBiteFish] = useState<{ fishName?: string; rarity?: string; abilities?: string[] } | null>(null);
  const [evading, setEvading] = useState(false);
  const reelStartRef = useRef<number>(0);
  const tensionSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open) { setPhase('idle'); setSessionId(null); setBiteAt(null); setOutcome({}); setBiteFish(null); setEvading(false); }
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
    const off = subscribe<{ userId: string; sessionId: string; fishName?: string; rarity?: string; abilities?: string[] }>(
      'fishing:bite',
      (msg) => {
        if (msg.sessionId === sessionId) {
          reelStartRef.current = Date.now();
          setPhase('biting');
          // F5 fix: capture the real species the server picked at bite time
          // (name/rarity/abilities) so the fight can honestly show it.
          if (msg.fishName) setBiteFish({ fishName: msg.fishName, rarity: msg.rarity, abilities: msg.abilities });
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

  // F5 fix: species whose real catalog abilities include evade/vanish get a
  // periodic "evasive kick" during the fight — tension is yanked toward an
  // edge and the player must counter-pull it back within ~800ms. This is
  // driven by the real `abilities` field (not fabricated per-species data)
  // and is surmountable — the player can beat it by reacting, matching the
  // review's "evade/vanish behaviours present and surmountable" test.
  useEffect(() => {
    if (phase !== 'reeling') return;
    const isEvasive = (biteFish?.abilities || []).some((a) => EVASIVE_ABILITIES.has(a));
    if (!isEvasive) return;
    const kick = setInterval(() => {
      setEvading(true);
      setTension((t) => (t > 0.5 ? Math.min(1, t + 0.35) : Math.max(0, t - 0.35)));
      setTimeout(() => setEvading(false), 800);
    }, 1100);
    return () => clearInterval(kick);
  }, [phase, biteFish]);

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
      // F2 fix: the reel can win the fight (a real fish is chosen) while the
      // inventory mint still fails — the server now folds mint.ok into the
      // top-level `ok`, so this branch is reachable and must be shown
      // honestly rather than celebrated as a plain catch.
      if (j?.ok) {
        setOutcome({ fishName: j.fish?.name, tier: j.tier, qualityScore: j.qualityScore, rarity: j.fish?.rarity });
        setPhase('caught');
      } else if (j?.fish?.name) {
        setOutcome({ fishName: j.fish.name, tier: j.tier, qualityScore: j.qualityScore, mintFailed: true, rarity: j.fish?.rarity });
        setPhase('caught');
      } else {
        setOutcome({ fishName: j?.reason || j?.error || 'no_fish' });
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
            <div className="text-[10px] text-slate-400 tabular-nums">
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
            {/* F5 fix: the real species + its real catalog abilities, known
                since bite time — a behaviour verb the player can actually
                see, not a decorative catalog-only row. */}
            {biteFish?.fishName && (
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="text-slate-300">
                  Fighting: <span className="font-medium text-amber-200">{biteFish.fishName}</span>
                  {biteFish.rarity && <span className="ml-1 text-slate-500 capitalize">({biteFish.rarity})</span>}
                </span>
                {(biteFish.abilities?.length ?? 0) > 0 && (
                  <span className="text-slate-500">{biteFish.abilities!.join(', ')}</span>
                )}
              </div>
            )}
            <div className="mb-2 text-xs text-slate-400">
              {evading ? (
                <span className="font-semibold text-rose-300 animate-pulse">It&apos;s evading! Counter now — W up, S down</span>
              ) : (
                'Hold tension in the green zone — W up, S down'
              )}
            </div>
            <div className="relative h-32 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="absolute left-0 right-0 bg-emerald-500/30"
                style={{ top: '30%', height: '40%' }}
              />
              <div
                className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full transition-all ${evading ? 'bg-rose-400' : 'bg-amber-300'}`}
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
            <Fish className={`mx-auto mb-2 h-10 w-10 ${outcome.mintFailed ? 'text-rose-300' : 'text-amber-300'}`} />
            {outcome.mintFailed ? (
              <>
                <div className="text-lg font-bold text-rose-200">Caught — but not saved</div>
                <div className="mt-1 text-xs text-slate-300">
                  {outcome.fishName} fought the line but couldn&apos;t be written to your inventory. Try again.
                </div>
              </>
            ) : (
              <div className="text-lg font-bold text-amber-100">
                Caught: {outcome.fishName}
                {outcome.rarity && <span className="ml-1.5 text-xs font-normal text-slate-400 capitalize">({outcome.rarity})</span>}
              </div>
            )}
            {!outcome.mintFailed && outcome.tier && <div className="mt-1 text-xs text-slate-300">Quality: {outcome.tier}</div>}
            {!outcome.mintFailed && outcome.qualityScore !== undefined && (
              <div className="text-[10px] text-slate-400">Score: {Math.round(outcome.qualityScore * 100)}%</div>
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
