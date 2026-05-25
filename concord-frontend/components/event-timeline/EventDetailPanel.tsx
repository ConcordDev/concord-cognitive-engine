'use client';

/**
 * EventDetailPanel — slide-in drill-in for a single substrate event.
 * Backed by the `event_timeline.detail` macro: full payload, the linked
 * entity references extracted from the payload, and the ±30s nearby
 * events in the same world.
 */

import { useEffect, useState } from 'react';
import { Loader2, X, Link2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface LinkedEntity {
  field: string;
  value: string;
}

interface NearbyEvent {
  id: number;
  channel: string;
  actor_kind: string | null;
  actor_id: string | null;
  created_at: number;
}

interface DetailEvent {
  id: number;
  channel: string;
  world_id: string | null;
  actor_kind: string | null;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
}

interface DetailResult {
  ok: boolean;
  event?: DetailEvent;
  linkedEntities?: LinkedEntity[];
  nearby?: NearbyEvent[];
  reason?: string;
}

function fmt(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

export function EventDetailPanel({
  eventId,
  onClose,
  onJumpTo,
}: {
  eventId: number;
  onClose: () => void;
  onJumpTo?: (id: number) => void;
}) {
  const [data, setData] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    (async () => {
      const r = await lensRun<DetailResult>('event_timeline', 'detail', { id: eventId });
      if (!alive) return;
      setData(r.data?.result ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [eventId]);

  const ev = data?.event;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl">
      <div className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-100">Event #{eventId}</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label="Close detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 p-4">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading event detail…
          </div>
        )}

        {!loading && (!data || !data.ok) && (
          <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {data?.reason === 'not_found' ? 'Event not found.' : 'Could not load this event.'}
          </div>
        )}

        {!loading && ev && (
          <>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
              <dt className="text-zinc-400">Channel</dt>
              <dd className="col-span-2 font-mono text-zinc-200">{ev.channel}</dd>
              <dt className="text-zinc-400">World</dt>
              <dd className="col-span-2 text-zinc-300">{ev.world_id || '—'}</dd>
              <dt className="text-zinc-400">Actor</dt>
              <dd className="col-span-2 text-zinc-300">
                {ev.actor_id ? `${ev.actor_kind || '?'}:${ev.actor_id}` : '—'}
              </dd>
              <dt className="text-zinc-400">Time</dt>
              <dd className="col-span-2 text-zinc-300">{fmt(ev.created_at)}</dd>
            </dl>

            <section>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Full payload
              </h4>
              <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-black/50 px-3 py-2 text-[11px] text-zinc-300">
                {ev.payload ? JSON.stringify(ev.payload, null, 2) : '(empty payload)'}
              </pre>
            </section>

            <section>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Link2 className="h-3 w-3" /> Linked entities
              </h4>
              {data?.linkedEntities && data.linkedEntities.length > 0 ? (
                <ul className="space-y-1">
                  {data.linkedEntities.map((le, i) => (
                    <li
                      key={`${le.field}-${i}`}
                      className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1 text-[11px]"
                    >
                      <span className="text-zinc-400">{le.field}</span>
                      <span className="font-mono text-zinc-200">{le.value}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400">No entity references in this payload.</p>
              )}
            </section>

            <section>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Nearby (±30s, same world)
              </h4>
              {data?.nearby && data.nearby.length > 0 ? (
                <ul className="space-y-1">
                  {data.nearby.map((nb) => (
                    <li key={nb.id}>
                      <button
                        onClick={() => onJumpTo?.(nb.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-zinc-900"
                      >
                        <span className="font-mono text-zinc-400">{nb.channel}</span>
                        {nb.actor_id && (
                          <span className="text-zinc-600">{nb.actor_kind || '?'}:{nb.actor_id}</span>
                        )}
                        <span className="ml-auto text-zinc-600">
                          {new Date(nb.created_at * 1000).toLocaleTimeString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400">No surrounding events.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
