'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

// Theme deferred (game-feel pass): renders the active player_signs in
// the world as projected HTML overlays + handles the place-a-sign UI
// when the player presses B.
//
// World fan-out: subscribes to `world:sign-placed` socket events
// (bridged through window CustomEvent) so newly-placed signs appear
// without polling. On mount + every 60s pulls /api/lens/run for
// playerSigns.nearby to refresh stale entries (fallback for missed
// socket events).
//
// Place flow:
//   1. Press B → opens a 5-kind picker pinned at screen-bottom-center.
//   2. Click a kind → arms placement; cursor crosshair.
//   3. Click anywhere in the world (raycast hit) → POSTs runMacro
//      playerSigns.place with the world position + kind + message.
//
// We deliberately keep the place UX dead-simple here. A richer kind-
// wheel + message text input is a follow-up.

const SIGN_ICON: Record<string, { emoji: string; color: string; label: string }> = {
  arrow:   { emoji: '↑', color: 'text-amber-200',   label: 'go this way' },
  warning: { emoji: '!', color: 'text-rose-200',    label: 'danger' },
  praise:  { emoji: '★', color: 'text-yellow-200',  label: 'praise' },
  help:    { emoji: '✛', color: 'text-emerald-200', label: 'help' },
  poi:     { emoji: '◆', color: 'text-sky-200',     label: 'point of interest' },
};

interface SignRow {
  id: string;
  world_id?: string;
  worldId?: string;
  user_id?: string;
  userId?: string;
  x: number;
  y?: number;
  z: number;
  kind: keyof typeof SIGN_ICON | string;
  message?: string | null;
  created_at?: number;
  expires_at?: number;
  expiresAt?: number;
}

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface WorldSignsProps {
  worldId: string;
  enabled?: boolean;
  /** Optional override for placement origin. Falls back to localStorage
   *  `concordia:lastPlayerPos` then (0,0,0). */
  playerPosition?: { x: number; y?: number; z: number };
}

const REFRESH_MS = 60_000;
const PROJECTION_THROTTLE_MS = 100;

function macroPath() { return '/api/lens/run'; }

async function callMacro(domain: string, name: string, input: Record<string, unknown>) {
  const res = await fetch(macroPath(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`macro ${domain}.${name} ${res.status}`);
  return res.json();
}

export function WorldSigns({ worldId, enabled = true, playerPosition }: WorldSignsProps) {
  const [signs, setSigns] = useState<SignRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [armedKind, setArmedKind] = useState<keyof typeof SIGN_ICON | null>(null);
  const projectorRef = useRef<Projector | null>(null);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());

  // Initial load + refresh.
  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const data = await callMacro('playerSigns', 'nearby', { worldId, limit: 200 });
      if (Array.isArray(data?.signs)) setSigns(data.signs);
    } catch { /* fall through silently */ }
  }, [worldId]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  // Append on socket fan-out — bridged via window event from world page.
  useEffect(() => {
    function onSignPlaced(e: Event) {
      const sign = (e as CustomEvent).detail as SignRow;
      if (!sign || (sign.world_id ?? sign.worldId) !== worldId) return;
      setSigns((prev) => {
        if (prev.some((s) => s.id === sign.id)) return prev;
        return [sign, ...prev].slice(0, 200);
      });
    }
    window.addEventListener('concordia:sign-placed', onSignPlaced);
    return () => window.removeEventListener('concordia:sign-placed', onSignPlaced);
  }, [worldId]);

  // B key → toggle picker. Ignore when typing.
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      setPickerOpen((v) => !v);
      setArmedKind(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  // Cache projector.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // rAF re-project signs.
  useEffect(() => {
    if (!enabled || signs.length === 0) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < PROJECTION_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const s of signs) {
        const p = proj({ x: s.x, y: (s.y ?? 0) + 1.0, z: s.z });
        if (p) next.set(s.id, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, signs]);

  // Click handler when armed: place sign at the player's current
  // position. We use the player's pos rather than full raycast so the
  // place flow doesn't depend on TerrainRenderer raycast wiring being
  // in scope. Players who want a more precise location can walk there
  // first — keeps the substrate simple.
  const place = useCallback(async (kind: keyof typeof SIGN_ICON) => {
    try {
      let position: { x: number; y: number; z: number } | null = null;
      if (playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z)) {
        position = { x: Number(playerPosition.x), y: Number(playerPosition.y ?? 0), z: Number(playerPosition.z) };
      } else if (typeof window !== 'undefined') {
        const raw = window.localStorage?.getItem('concordia:lastPlayerPos');
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (Number.isFinite(p?.x) && Number.isFinite(p?.z)) {
              position = { x: Number(p.x), y: Number(p.y ?? 0), z: Number(p.z) };
            }
          } catch { /* malformed JSON; fall through */ }
        }
      }
      if (!position) {
        position = { x: 0, y: 0, z: 0 };
      }
      const r = await callMacro('playerSigns', 'place', { worldId, position, kind });
      if (r?.ok && r.sign) {
        setSigns((prev) => [r.sign, ...prev].slice(0, 200));
      }
    } catch { /* place failed; keep UI alive */ }
    setPickerOpen(false);
    setArmedKind(null);
  }, [worldId, playerPosition]);

  if (!enabled) return null;

  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none z-[36]"
        data-testid="world-signs-layer"
        aria-hidden="true"
      >
        {signs.map((s) => {
          const pos = screenPositions.get(s.id);
          if (!pos?.visible) return null;
          const def = SIGN_ICON[s.kind] ?? { emoji: '?', color: 'text-white/70', label: 'sign' };
          return (
            <div
              key={s.id}
              data-sign-id={s.id}
              data-sign-kind={s.kind}
              className="absolute -translate-x-1/2 -translate-y-full select-none"
              style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`px-1.5 py-0.5 bg-black/55 border border-white/15 rounded-md backdrop-blur-sm text-base leading-none ${def.color}`}
                  title={def.label}
                >
                  <span aria-hidden>{def.emoji}</span>
                </div>
                {s.message && (
                  <div className="mt-0.5 text-[9px] text-white/70 max-w-[140px] truncate">
                    {s.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pickerOpen && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-12 z-[60] flex gap-2 bg-black/80 border border-white/20 rounded-2xl px-3 py-2 backdrop-blur-md shadow-xl pointer-events-auto"
          data-testid="sign-placer-picker"
        >
          {(Object.keys(SIGN_ICON) as Array<keyof typeof SIGN_ICON>).map((k) => {
            const def = SIGN_ICON[k];
            const armed = armedKind === k;
            return (
              <button
                key={k}
                type="button"
                data-testid={`sign-pick-${k}`}
                onClick={() => { setArmedKind(k); place(k); }}
                className={`px-3 py-2 rounded-xl border transition-colors ${
                  armed
                    ? 'border-amber-400/60 bg-amber-500/15'
                    : 'border-white/15 hover:bg-white/10'
                }`}
              >
                <div className={`text-lg ${def.color}`} aria-hidden>{def.emoji}</div>
                <div className="text-[10px] text-white/60 mt-0.5">{def.label}</div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setPickerOpen(false); setArmedKind(null); }}
            className="self-stretch ml-2 px-2 text-xs text-white/50 hover:text-white/80"
          >
            esc
          </button>
        </div>
      )}
    </>
  );
}
