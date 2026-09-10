'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';

interface ActivityEvent {
  id: string;
  kind: string;
  shipmentId: string;
  timestamp: string;
  location?: string;
}

export function ActivityFeedPanel() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [milestones, setMilestones] = useState<
    Array<{ id: string; kind: string; shipmentId: string; geofenceName: string; at: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { lensRun } = await import('@/lib/api/client');
      const [ev, ms] = await Promise.all([
        lensRun('logistics', 'shipment-events', {}),
        lensRun('logistics', 'milestones-list', {}),
      ]);
      if (ev.data?.ok) setEvents((ev.data.result?.events || []) as ActivityEvent[]);
      if (ms.data?.ok)
        setMilestones(
          (ms.data.result?.milestones || []) as Array<{
            id: string;
            kind: string;
            shipmentId: string;
            geofenceName: string;
            at: string;
          }>
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const merged = useMemo(() => {
    const rows = [
      ...events.map((e) => ({
        id: e.id,
        at: e.timestamp,
        text: `Shipment ${e.shipmentId} — ${e.kind.replace(/_/g, ' ')}${e.location ? ` at ${e.location}` : ''}`,
      })),
      ...milestones.map((m) => ({
        id: m.id,
        at: m.at,
        text: `Shipment ${m.shipmentId} ${m.kind} ${m.geofenceName}`,
      })),
    ];
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12);
  }, [events, milestones]);

  return (
    <section>
      <h2 className={cn(ds.heading2, 'mb-3')}>Recent Activity</h2>
      <div className={ds.panel}>
        {loading ? (
          <p className={cn(ds.textMuted, 'text-center py-6')}>Loading activity…</p>
        ) : merged.length === 0 ? (
          <p className={cn(ds.textMuted, 'text-center py-6')}>
            No activity yet — shipment status changes and geofence milestones appear here.
          </p>
        ) : (
          <div className="divide-y divide-lattice-border">
            {merged.map((row) => (
              <div key={row.id} data-lens-theme="logistics" className="flex items-center gap-3 py-3 px-2">
                <Activity className="w-4 h-4 shrink-0 text-neon-cyan" />
                <span className="flex-1 text-sm text-gray-200">{row.text}</span>
                <span className={cn(ds.textMuted, 'shrink-0')}>
                  {new Date(row.at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
