'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Event { id: string; shipmentId: string; kind: string; timestamp: string; location: string }

const EVENT_COLOUR: Record<string, string> = {
  label_created: 'bg-gray-400',
  picked_up: 'bg-cyan-400',
  in_transit: 'bg-cyan-400',
  out_for_delivery: 'bg-violet-400',
  delivered: 'bg-emerald-400',
  exception: 'bg-rose-400',
  returned: 'bg-amber-400',
};

export function ShipmentEventsTimeline({ shipmentId }: { shipmentId?: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'shipment-events', input: shipmentId ? { shipmentId } : {} });
      setEvents((res.data?.result?.events || []) as Event[]);
    } catch (e) { console.error('[Events] failed', e); }
    finally { setLoading(false); }
  }, [shipmentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">EDI event timeline {shipmentId ? `· ${shipmentId.slice(0, 14)}` : '(all)'}</span>
        <span className="ml-auto text-[10px] text-gray-400">{events.length}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />No events yet. Status transitions log here.</div>
        ) : (
          <ol className="p-3 space-y-3 relative">
            <div className="absolute left-[26px] top-3 bottom-3 w-px bg-white/10" />
            {events.map(e => (
              <li key={e.id} className="flex items-start gap-3 relative">
                <span className={cn('w-3 h-3 rounded-full mt-1 flex-shrink-0 ring-2 ring-[#0d1117] z-10', EVENT_COLOUR[e.kind] || 'bg-gray-400')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white capitalize">{e.kind.replace(/_/g, ' ')}</div>
                  <div className="text-[10px] text-gray-400">
                    {new Date(e.timestamp).toLocaleString()}{e.location && ` · ${e.location}`}
                  </div>
                  {!shipmentId && <div className="text-[10px] text-gray-400 font-mono">{e.shipmentId.slice(0, 14)}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default ShipmentEventsTimeline;
