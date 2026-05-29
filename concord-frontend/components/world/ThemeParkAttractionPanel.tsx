'use client';

// Phase DB15 — Theme park attraction panel.
// Opens from `attraction_booth` building. Shows current_visitors +
// revenue + appeal. Owner-only "Adjust ticket" + "Close" actions.

import { useCallback, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Ticket, Users, Sparkles, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

interface Attraction {
  id: string;
  owner_user_id: string;
  world_id: string;
  building_id: string;
  attraction_kind: string;
  name: string;
  ticket_cc: number;
  base_appeal: number;
  current_visitors: number;
  total_revenue: number;
  total_rides: number;
  closed_at: number | null;
}


export function ThemeParkAttractionPanel({ building, onClose, worldId }: OverlayProps) {
  const [list, setList] = useState<Attraction[]>([]);
  const [active, setActive] = useState<Attraction | null>(null);
  const [ticketEdit, setTicketEdit] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`/api/theme-park/world/${worldId}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) {
        const all: Attraction[] = j.attractions || [];
        const here = all.filter((a) => a.building_id === building.id || !a.building_id);
        setList(here);
        if (here.length > 0) {
          setActive((prev) => {
            if (!prev) return here[0];
            const updated = all.find((a) => a.id === prev.id);
            return updated || here[0];
          });
        }
      }
    } catch { /* swallow */ }
  }, [worldId, building.id]);

  useRealtimeRefresh(['theme-park:state'], refresh, { backstopMs: 4000 });

  const closeAttraction = useCallback(async () => {
    if (!active) return;
    setPending(true);
    try {
      await fetch(`/api/theme-park/attraction/${active.id}/close`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      setActive(null);
      refresh();
    } finally { setPending(false); }
  }, [active, refresh]);

  return (
    <StationOverlayShell
      title={building.name || 'Attraction'}
      subtitle={`attraction_booth · ${worldId}`}
      onClose={onClose}
      accent="pink"
      size="md"
    >
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No attractions open here. Open one via the theme park lens.</p>
      ) : !active ? (
        <p className="py-6 text-center text-sm text-zinc-500">Pick an attraction…</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-pink-500/30 bg-pink-950/30 p-3">
            <div className="text-sm font-semibold text-pink-100">{active.name}</div>
            <div className="text-[10px] text-pink-300/70">{active.attraction_kind}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded bg-pink-950/30 p-2 text-center">
              <Users className="mx-auto mb-1 text-pink-300/70" size={14} />
              <div className="text-[9px] uppercase text-pink-300/70">visitors</div>
              <div className="font-mono text-base text-pink-100">{active.current_visitors}</div>
            </div>
            <div className="rounded bg-pink-950/30 p-2 text-center">
              <Sparkles className="mx-auto mb-1 text-pink-300/70" size={14} />
              <div className="text-[9px] uppercase text-pink-300/70">appeal</div>
              <div className="font-mono text-base text-pink-100">{Math.round(active.base_appeal * 100) / 100}</div>
            </div>
            <div className="rounded bg-pink-950/30 p-2 text-center">
              <Ticket className="mx-auto mb-1 text-pink-300/70" size={14} />
              <div className="text-[9px] uppercase text-pink-300/70">revenue</div>
              <div className="font-mono text-base text-pink-100">{active.total_revenue}</div>
            </div>
          </div>

          <div className="rounded border border-pink-500/30 bg-pink-950/30 p-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-pink-300/70">
              <span>ticket price</span>
              <span className="font-mono text-pink-100">{active.ticket_cc} cc</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={ticketEdit ?? active.ticket_cc}
              onChange={(e) => setTicketEdit(Number(e.target.value))}
              className="w-full"
            />
            {ticketEdit != null && ticketEdit !== active.ticket_cc && (
              <div className="mt-1 text-[10px] text-amber-200">
                preview: {ticketEdit} cc (changes apply on next open)
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={closeAttraction}
              disabled={pending}
              className="flex-1 rounded bg-red-500/30 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/50 disabled:opacity-50"
            >
              {pending ? <Loader2 className="inline animate-spin" size={11} /> : 'Close attraction'}
            </button>
          </div>

          <div className="text-center text-[10px] text-pink-300/60">
            total rides: {active.total_rides}
          </div>
        </div>
      )}
    </StationOverlayShell>
  );
}
