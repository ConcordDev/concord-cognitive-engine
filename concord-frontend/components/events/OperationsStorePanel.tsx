'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  guestRows,
  segmentRows,
  storeEmptyCopy,
  tierRows,
  type OpsEvent,
  type OpsGuest,
  type OpsSegment,
  type OpsTier,
} from './operations-store';

type Kind = 'tickets' | 'segments' | 'guests';

async function run(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun('events', action, input);
  if (!r.data?.ok) throw new Error(r.data?.error || `${action} failed`);
  return (r.data.result || {}) as Record<string, unknown>;
}

export function OperationsStorePanel({ kind }: { kind: Kind }) {
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [tiers, setTiers] = useState<Record<string, OpsTier[]>>({});
  const [segments, setSegments] = useState<Record<string, OpsSegment[]>>({});
  const [guests, setGuests] = useState<Record<string, OpsGuest[]>>({});
  const [eventId, setEventId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [durationMin, setDurationMin] = useState('30');
  const [email, setEmail] = useState('');
  const [tierId, setTierId] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const listed = await run('event-list');
      const evs = ((listed.events as OpsEvent[]) || []).map((e) => ({ id: e.id, name: e.name }));
      setEvents(evs);
      setEventId((prev) => (prev && evs.some((e) => e.id === prev) ? prev : (evs[0]?.id || '')));
      const nextTiers: Record<string, OpsTier[]> = {};
      const nextSegments: Record<string, OpsSegment[]> = {};
      const nextGuests: Record<string, OpsGuest[]> = {};
      await Promise.all(evs.map(async (event) => {
        if (kind === 'tickets' || kind === 'guests') {
          const r = await run('tier-list', { eventId: event.id });
          nextTiers[event.id] = (r.tiers as OpsTier[]) || [];
        }
        if (kind === 'segments') {
          const r = await run('agenda-timeline', { eventId: event.id });
          nextSegments[event.id] = (r.items as OpsSegment[]) || [];
        }
        if (kind === 'guests') {
          const r = await run('registration-list', { eventId: event.id });
          nextGuests[event.id] = ((r.registrations as Array<OpsGuest & { tierName?: string }>) || []).map((g) => ({
            id: g.id,
            name: g.name,
            email: g.email,
            tierName: g.tierName || '',
          }));
        }
      }));
      setTiers(nextTiers);
      setSegments(nextSegments);
      setGuests(nextGuests);
      const firstTiers = nextTiers[evs[0]?.id || ''] || [];
      setTierId((prev) => (prev && firstTiers.some((t) => t.id === prev) ? prev : (firstTiers[0]?.id || '')));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const selectedTiers = tiers[eventId] || [];
  const tierCount = Object.values(tiers).reduce((n, list) => n + list.length, 0);
  const segmentCount = Object.values(segments).reduce((n, list) => n + list.length, 0);
  const guestCount = Object.values(guests).reduce((n, list) => n + list.length, 0);
  const empty = storeEmptyCopy(
    kind === 'tickets' ? 'tiers' : kind,
    events.length,
    kind === 'tickets' ? tierCount : kind === 'segments' ? segmentCount : guestCount,
  );

  const add = async () => {
    if (!eventId || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'tickets') {
        const qty = Number(quantity);
        const cost = Number(price);
        await run('tier-create', {
          eventId,
          name: name.trim(),
          price: Number.isFinite(cost) && cost >= 0 ? cost : undefined,
          quantity: Number.isFinite(qty) && qty >= 0 ? qty : undefined,
        });
      } else if (kind === 'segments') {
        const mins = Number(durationMin);
        await run('agenda-item-add', {
          eventId,
          title: name.trim(),
          startTime,
          durationMin: Number.isFinite(mins) && mins >= 0 ? mins : undefined,
        });
      } else {
        if (!email.trim()) {
          setError('Email is required to register a guest.');
          setBusy(false);
          return;
        }
        if (!tierId) {
          setError('Add a ticket tier before registering a guest.');
          setBusy(false);
          return;
        }
        await run('register-attendee', { eventId, name: name.trim(), email: email.trim(), tierId });
      }
      setName('');
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className={ds.textMuted}>Same records as the Host console. This view does not keep a second list.</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {events.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-center gap-2">
          <select value={eventId} onChange={(e) => {
            setEventId(e.target.value);
            const next = (tiers[e.target.value] || [])[0]?.id || '';
            setTierId(next);
          }} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100">
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'segments' ? 'Segment title' : kind === 'guests' ? 'Guest name' : 'Tier name'} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
          {kind === 'tickets' && (
            <>
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" inputMode="decimal" className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" inputMode="numeric" className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
            </>
          )}
          {kind === 'segments' && (
            <>
              <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="09:00" className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
              <input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="Minutes" inputMode="numeric" className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
            </>
          )}
          {kind === 'guests' && (
            <>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (required)" aria-label="Email" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
              <select value={tierId} onChange={(e) => setTierId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100">
                {selectedTiers.length === 0 && <option value="">No tier yet</option>}
                {selectedTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
              </select>
            </>
          )}
          <button type="submit" disabled={busy || !name.trim()} className={cn(ds.btnPrimary, 'text-xs')}>
            {kind === 'tickets' ? 'Add tier' : kind === 'segments' ? 'Add segment' : 'Register guest'}
          </button>
        </form>
      )}
      {empty && <p className={cn(ds.textMuted, 'py-6 text-center')}>{empty}</p>}
      {kind === 'tickets' && tierRows(events, tiers).map((event) => event.tiers.length > 0 && (
        <section key={event.id} className={ds.panel}>
          <h3 className={ds.heading3}>{event.name}</h3>
          <ul className="mt-2 space-y-1">
            {event.tiers.map((tier) => (
              <li key={tier.id} className="flex items-center justify-between text-sm text-zinc-200">
                <span>{tier.name}</span>
                <span className="font-mono text-xs text-zinc-400">{tier.sold} / {tier.quantity} · {tier.price}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {kind === 'segments' && segmentRows(events, segments).map((event) => event.segments.length > 0 && (
        <section key={event.id} className={ds.panel}>
          <h3 className={ds.heading3}>{event.name}</h3>
          <ul className="mt-2 space-y-1">
            {event.segments.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm text-zinc-200">
                <span>{item.title}</span>
                <span className="font-mono text-xs text-zinc-400">{item.startTime} · {item.durationMin}m{item.owner ? ` · ${item.owner}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {kind === 'guests' && guestRows(events, guests).map((event) => event.guests.length > 0 && (
        <section key={event.id} className={ds.panel}>
          <h3 className={ds.heading3}>{event.name}</h3>
          <ul className="mt-2 space-y-1">
            {event.guests.map((guest) => (
              <li key={guest.id} className="flex items-center justify-between text-sm text-zinc-200">
                <span>{guest.name}</span>
                <span className="text-xs text-zinc-400">{guest.email}{guest.tierName ? ` · ${guest.tierName}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
