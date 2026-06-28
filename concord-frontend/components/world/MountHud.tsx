'use client';

import { useCallback, useEffect, useState } from 'react';
import { Rabbit, Loader2, LogOut, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Backend shapes (verified against server/domains/mounts.js + mount-care.js) ──
//
// lensRun('mounts','get_active_mount',{ worldId })
//   → { ok, mounted:false }  OR  { ok, mounted:true, instance, companion:{id,name},
//       speciesId, species, gait, seatOffset }
//
// lensRun('mounts','care_state',{ mountId })   (mountId = companion.id)
//   → { ok, companionId, state:{ hunger, stamina, ... }, loyalty, rideable }
//
// lensRun('mounts','list_mountable',{ worldId })
//   → { ok, companions:[ { id, name, level, creature_id, world_id, ... } ] }
//
// lensRun('mounts','mount',{ companionId, worldId })   → opens an instance
// lensRun('mounts','dismount',{ worldId })             → idempotent close
//
// All reads are real DB pulls; loyalty/care decays lazily on read (no fake bar).

interface ActiveMount {
  mounted: boolean;
  companion?: { id: string; name?: string; creatureId?: string };
  speciesId?: string;
}

interface CareState {
  loyalty?: number;
  rideable?: boolean;
  state?: { hunger?: number; stamina?: number };
}

interface RosterMount {
  id: string;
  name?: string;
  level?: number;
}

interface Props {
  worldId: string;
  /** Poll cadence for active-mount + care state. Real state, not fake progress. */
  pollMs?: number;
}

/** 0..100 bar in a tinted track. */
function Bar({ label, value, tint }: { label: string; value: number; tint: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-slate-900">
        <div className={cn('h-full', tint)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MountHud({ worldId, pollMs = 20_000 }: Props) {
  const [active, setActive] = useState<ActiveMount | null>(null);
  const [care, setCare] = useState<CareState | null>(null);
  const [roster, setRoster] = useState<RosterMount[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const am = await lensRun<ActiveMount>('mounts', 'get_active_mount', { worldId });
      const amData = am.data?.ok ? am.data.result : null;
      if (amData?.mounted && amData.companion?.id) {
        setActive(amData);
        setRoster([]);
        // Pull live care state for the active mount.
        const cs = await lensRun<CareState>('mounts', 'care_state', { mountId: amData.companion.id });
        setCare(cs.data?.ok ? cs.data.result : null);
      } else {
        setActive({ mounted: false });
        setCare(null);
        // Not mounted → fetch the rideable roster so we can offer a Summon.
        const lm = await lensRun<{ companions?: RosterMount[] }>('mounts', 'list_mountable', { worldId });
        const rows = lm.data?.ok ? lm.data.result?.companions : null;
        setRoster(Array.isArray(rows) ? rows : []);
      }
      setError(null);
    } catch (e) {
      console.error('[MountHud] refresh failed', e);
      setError('Mount state unavailable');
    } finally {
      setLoaded(true);
    }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const summon = useCallback(async (companionId: string) => {
    setBusy(true);
    try {
      const r = await lensRun('mounts', 'mount', { companionId, worldId });
      if (!r.data?.ok) {
        const reason = (r.data?.result as { reason?: string } | null)?.reason || r.data?.error;
        setError(`Summon failed${reason ? `: ${reason}` : ''}`);
      } else {
        setError(null);
      }
      await refresh();
    } catch (e) {
      console.error('[MountHud] summon failed', e);
      setError('Summon failed');
    } finally {
      setBusy(false);
    }
  }, [worldId, refresh]);

  const dismiss = useCallback(async () => {
    setBusy(true);
    try {
      await lensRun('mounts', 'dismount', { worldId });
      await refresh();
    } catch (e) {
      console.error('[MountHud] dismount failed', e);
      setError('Dismount failed');
    } finally {
      setBusy(false);
    }
  }, [worldId, refresh]);

  // Renders nothing until we know the player has SOMETHING mount-related:
  // an active mount or at least one rideable companion. No mounts → no HUD.
  if (!loaded) return null;
  const hasActive = !!active?.mounted && !!active.companion?.id;
  if (!hasActive && roster.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-30 w-56 rounded-lg border border-white/10 bg-black/80 backdrop-blur-sm p-3 text-white shadow-2xl">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
        <Rabbit className="w-3.5 h-3.5 text-emerald-400" />
        Mount
      </div>

      {error && <p className="mb-2 text-[10px] text-rose-300">{error}</p>}

      {hasActive ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-100 truncate">
              {active!.companion!.name || 'Your mount'}
            </span>
          </div>
          {care ? (
            <div className="space-y-1.5">
              <Bar label="Stamina" value={care.state?.stamina ?? 0} tint="bg-sky-500" />
              <Bar label="Loyalty" value={care.loyalty ?? 0} tint="bg-emerald-500" />
              {care.state?.hunger != null && (
                <Bar label="Hunger" value={care.state.hunger} tint="bg-amber-500" />
              )}
              {care.rideable === false && (
                <p className="text-[10px] text-rose-300">Loyalty too low to ride — feed/groom it.</p>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Reading care state…
            </p>
          )}
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-1 rounded-md bg-rose-600/70 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Dismiss
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-500">Summon a mount:</p>
          {roster.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => summon(m.id)}
              disabled={busy}
              className="w-full inline-flex items-center justify-between gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-100 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1 truncate">
                <Plus className="w-3 h-3 text-emerald-400" />
                {m.name || 'Mount'}
              </span>
              {m.level != null && <span className="text-[10px] text-gray-400">Lv {m.level}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MountHud;
