'use client';

/**
 * PetServicesPanel — Rover-shape caregiver directory and bookings.
 * Register as a caregiver, browse caregivers and book care for the
 * selected pet.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Star, CalendarPlus, UserPlus, PawPrint } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Caregiver {
  id: string; name: string; bio: string | null; services: string[];
  rates: Record<string, number>; area: string | null;
  rating: number | null; reviewCount: number;
}
interface BookingUpdate { by: string; note: string; at: string }
interface Booking {
  id: string; caregiverName: string; petName: string; service: string;
  startDate: string; endDate: string; nights: number; estimatedCost: number;
  status: string; updates: BookingUpdate[]; rated?: boolean;
}

const SERVICES = ['boarding', 'walking', 'daycare', 'dropin', 'house_sitting', 'training'];
const STATUS_COLOR: Record<string, string> = {
  requested: 'text-amber-400', confirmed: 'text-sky-400', in_progress: 'text-teal-400',
  completed: 'text-emerald-400', cancelled: 'text-zinc-400',
};

export function PetServicesPanel({ petId, onChange }: { petId: string; onChange: () => void }) {
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [asCaregiver, setAsCaregiver] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [reg, setReg] = useState({ name: '', bio: '', services: ['walking'], walkRate: '', boardRate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, b] = await Promise.all([
      lensRun('pets', 'caregiver-list', {}),
      lensRun('pets', 'booking-list', {}),
    ]);
    setCaregivers(c.data?.result?.caregivers || []);
    setBookings(b.data?.result?.bookings || []);
    setAsCaregiver(b.data?.result?.asCaregiver || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const register = async () => {
    if (!reg.name.trim()) { setError('Your caregiver name is required.'); return; }
    const r = await lensRun('pets', 'caregiver-register', {
      name: reg.name.trim(), bio: reg.bio.trim(), services: reg.services,
      rates: { walking: Number(reg.walkRate) || 0, boarding: Number(reg.boardRate) || 0 },
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setShowRegister(false);
    setError(null);
    await refresh();
  };

  const book = async (cg: Caregiver, service: string) => {
    if (!petId) { setError('Select a pet first.'); return; }
    const startDate = window.prompt('Start date (YYYY-MM-DD)');
    if (!startDate) return;
    const endDate = window.prompt('End date (YYYY-MM-DD) — leave blank for same day', startDate) || startDate;
    const r = await lensRun('pets', 'booking-create', { caregiverId: cg.id, petId, service, startDate, endDate });
    if (r.data?.ok === false) { setError(r.data?.error || 'Booking failed'); return; }
    setError(null);
    await refresh(); onChange();
  };

  const advance = async (b: Booking, status: string) => {
    await lensRun('pets', 'booking-update', { id: b.id, status });
    await refresh(); onChange();
  };
  const rate = async (b: Booking, stars: number) => {
    await lensRun('pets', 'booking-update', { id: b.id, rating: stars });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Caregiver directory */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">Caregivers</h3>
          <button type="button" onClick={() => setShowRegister((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg">
            <UserPlus className="w-3.5 h-3.5" /> Offer care
          </button>
        </div>

        {showRegister && (
          <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-2">
            <input placeholder="Your name" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Bio" value={reg.bio} onChange={(e) => setReg({ ...reg, bio: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Walk rate ($)" inputMode="decimal" value={reg.walkRate} onChange={(e) => setReg({ ...reg, walkRate: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Boarding rate ($/night)" inputMode="decimal" value={reg.boardRate} onChange={(e) => setReg({ ...reg, boardRate: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <div className="col-span-2 flex flex-wrap gap-1">
              {SERVICES.map((sv) => (
                <button key={sv} type="button"
                  onClick={() => setReg({ ...reg, services: reg.services.includes(sv) ? reg.services.filter((x) => x !== sv) : [...reg.services, sv] })}
                  className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize',
                    reg.services.includes(sv) ? 'border-teal-600/60 bg-teal-950/40 text-teal-300' : 'border-zinc-700 text-zinc-400')}>
                  {sv.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <button type="button" onClick={register}
              className="col-span-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              Register as caregiver
            </button>
          </div>
        )}

        {caregivers.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No caregivers yet. Be the first to offer care.</p>
        ) : (
          <ul className="space-y-2">
            {caregivers.map((cg) => (
              <li key={cg.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{cg.name}</p>
                    {cg.bio && <p className="text-[11px] text-zinc-400">{cg.bio}</p>}
                  </div>
                  {cg.rating != null && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                      <Star className="w-3 h-3 fill-amber-400" />{cg.rating} ({cg.reviewCount})
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {cg.services.map((sv) => (
                    <button key={sv} type="button" onClick={() => book(cg, sv)}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-teal-600/60 hover:text-teal-300 capitalize">
                      <CalendarPlus className="w-3 h-3" />
                      {sv.replace(/_/g, ' ')}{cg.rates[sv] ? ` $${cg.rates[sv]}` : ''}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* My bookings */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">My bookings</h3>
        {bookings.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No bookings yet.</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100 capitalize">
                      {b.service.replace(/_/g, ' ')} · {b.caregiverName}
                    </p>
                    <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <PawPrint className="w-3 h-3" />{b.petName} · {b.startDate}
                      {b.endDate !== b.startDate ? `–${b.endDate}` : ''} · ${b.estimatedCost}
                    </p>
                  </div>
                  <span className={cn('text-[10px] capitalize', STATUS_COLOR[b.status] || 'text-zinc-400')}>
                    {b.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {b.status === 'requested' && (
                  <button type="button" onClick={() => advance(b, 'cancelled')}
                    className="mt-1.5 text-[10px] text-zinc-400 hover:text-rose-400">Cancel request</button>
                )}
                {b.status === 'completed' && !b.rated && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-zinc-400">Rate:</span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button aria-label="Favorite" key={n} type="button" onClick={() => rate(b, n)}>
                        <Star className="w-3.5 h-3.5 text-zinc-600 hover:text-amber-400" />
                      </button>
                    ))}
                  </div>
                )}
                {b.updates.length > 0 && (
                  <p className="text-[10px] text-zinc-400 mt-1 italic">“{b.updates[b.updates.length - 1].note}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bookings where I am the caregiver */}
      {asCaregiver.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Jobs I&apos;m caring for</h3>
          <ul className="space-y-2">
            {asCaregiver.map((b) => (
              <li key={b.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-zinc-100 capitalize">{b.service.replace(/_/g, ' ')} · {b.petName}</p>
                  <span className={cn('text-[10px] capitalize', STATUS_COLOR[b.status])}>{b.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex gap-1 mt-1.5">
                  {b.status === 'requested' && (
                    <button type="button" onClick={() => advance(b, 'confirmed')}
                      className="text-[11px] px-2 py-0.5 bg-sky-700/30 text-sky-300 rounded-lg">Confirm</button>
                  )}
                  {b.status === 'confirmed' && (
                    <button type="button" onClick={() => advance(b, 'in_progress')}
                      className="text-[11px] px-2 py-0.5 bg-teal-700/30 text-teal-300 rounded-lg">Start</button>
                  )}
                  {b.status === 'in_progress' && (
                    <button type="button" onClick={() => advance(b, 'completed')}
                      className="text-[11px] px-2 py-0.5 bg-emerald-700/30 text-emerald-300 rounded-lg">Complete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
