'use client';

import { useEffect, useState } from 'react';
import { Calendar, Search, Loader2, Video, MapPin, CreditCard } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { StripePaymentForm } from '@/components/payment/StripePaymentForm';

export interface Provider {
  id: string;
  name: string;
  specialty: string;
  practice: string;
  inNetwork: boolean;
  nextSlot?: string;
  acceptsTelehealth: boolean;
  rating?: number;
  distanceMi?: number;
}

export interface AppointmentSlot {
  providerId: string;
  date: string;
  time: string;
  kind: 'in_person' | 'telehealth';
}

export function AppointmentScheduler() {
  const [specialty, setSpecialty] = useState('Primary care');
  const [insurance, setInsurance] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ providerId: string; slot: AppointmentSlot; appointmentId?: string; copayUsd?: number } | null>(null);
  const [copayUsd, setCopayUsd] = useState<string>('');
  const [copayIntent, setCopayIntent] = useState<{ clientSecret: string; copayUsd: number } | null>(null);
  const [copayMessage, setCopayMessage] = useState<string | null>(null);

  useEffect(() => { search(); }, []);

  async function search() {
    setLoading(true); setSelectedProvider(null); setSlots([]); setConfirmed(null);
    try {
      const res = await lensRun({
        domain: 'healthcare', action: 'providers-search',
        input: { specialty, insurance: insurance || undefined, zipCode: zipCode || undefined },
      });
      setProviders((res.data?.result?.providers || []) as Provider[]);
    } catch (e) { console.error('[Provider search] failed', e); }
    finally { setLoading(false); }
  }

  async function loadSlots(p: Provider) {
    setSelectedProvider(p); setSlots([]);
    try {
      const res = await lensRun({
        domain: 'healthcare', action: 'provider-slots', input: { providerId: p.id, days: 14 },
      });
      setSlots((res.data?.result?.slots || []) as AppointmentSlot[]);
    } catch (e) { console.error('[Slots] failed', e); }
  }

  async function book(slot: AppointmentSlot) {
    if (!selectedProvider) return;
    setBookingId(slot.date + slot.time);
    try {
      const copayNum = Number(copayUsd);
      const res = await lensRun({
        domain: 'healthcare', action: 'appointment-book',
        input: {
          providerId: selectedProvider.id, date: slot.date, time: slot.time, kind: slot.kind,
          copayUsd: Number.isFinite(copayNum) && copayNum > 0 ? copayNum : undefined,
        },
      });
      const appt = (res.data as { result?: { appointment?: { id: string; copayUsd?: number } } }).result?.appointment;
      setConfirmed({ providerId: selectedProvider.id, slot, appointmentId: appt?.id, copayUsd: appt?.copayUsd });
    } catch (e) { console.error('[Book] failed', e); }
    finally { setBookingId(null); }
  }

  async function chargeCopay() {
    if (!confirmed?.appointmentId) return;
    setCopayMessage(null);
    try {
      const res = await lensRun({
        domain: 'healthcare', action: 'appointment-charge-copay',
        input: { appointmentId: confirmed.appointmentId },
      });
      const data = res.data as { ok?: boolean; error?: string; result?: { clientSecret: string; copayUsd: number } };
      if (data.ok && data.result) {
        setCopayIntent({ clientSecret: data.result.clientSecret, copayUsd: data.result.copayUsd });
      } else {
        setCopayMessage(data.error || 'Co-pay charge unavailable');
      }
    } catch (e) { setCopayMessage((e as Error).message); }
  }

  function onCopaySuccess() {
    setCopayMessage('✓ Co-pay paid');
    setCopayIntent(null);
  }

  // Group slots by date
  const slotsByDate = slots.reduce((acc, s) => {
    if (!acc[s.date]) acc[s.date] = [];
    acc[s.date].push(s);
    return acc;
  }, {} as Record<string, AppointmentSlot[]>);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Appointments</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
          {['Primary care', 'Cardiology', 'Dermatology', 'Mental health', 'Pediatrics', 'OB/GYN', 'Orthopedics', 'Neurology'].map(s => <option key={s}>{s}</option>)}
        </select>
        <input value={insurance} onChange={e => setInsurance(e.target.value)} placeholder="Insurance" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="ZIP code" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={search} disabled={loading} className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 max-h-[600px]">
        <div className="overflow-y-auto border-r border-white/5">
          {providers.length === 0 && !loading ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500">No providers match.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {providers.map(p => (
                <li key={p.id}>
                  <button
                    onClick={() => loadSlots(p)}
                    className={cn('w-full text-left px-3 py-2 hover:bg-white/[0.04]', selectedProvider?.id === p.id && 'bg-cyan-500/10')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{p.name}</span>
                      {p.inNetwork && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-bold">In-net</span>}
                      {p.acceptsTelehealth && <Video className="w-3 h-3 text-cyan-400" />}
                      {p.rating && <span className="ml-auto text-[10px] text-yellow-400 tabular-nums">★ {p.rating.toFixed(1)}</span>}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {p.specialty} · {p.practice}
                      {p.distanceMi != null && ` · ${p.distanceMi.toFixed(1)} mi`}
                      {p.nextSlot && ` · next ${p.nextSlot}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="overflow-y-auto p-3">
          {!selectedProvider ? (
            <div className="text-xs text-gray-500 italic text-center py-10">Select a provider to see availability.</div>
          ) : confirmed ? (
            <div className="space-y-3">
              <div className="bg-green-500/10 border border-green-500/40 rounded p-4 text-center">
                <Calendar className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <h3 className="text-sm font-bold text-green-300 mb-1">Appointment booked!</h3>
                <p className="text-xs text-gray-300">{selectedProvider.name} · {confirmed.slot.date} at {confirmed.slot.time}</p>
                <p className="text-[10px] text-gray-500 mt-1">{confirmed.slot.kind === 'telehealth' ? 'Video call link will be sent before visit' : 'In-person'}</p>
              </div>
              {confirmed.copayUsd && confirmed.copayUsd > 0 && !copayIntent && (
                <button
                  type="button"
                  onClick={chargeCopay}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded border border-cyan-500/40 bg-cyan-500/15 text-sm text-cyan-100"
                >
                  <CreditCard className="w-4 h-4" /> Pay ${confirmed.copayUsd.toFixed(2)} co-pay
                </button>
              )}
              {copayIntent && (
                <StripePaymentForm
                  clientSecret={copayIntent.clientSecret}
                  amountUsd={copayIntent.copayUsd}
                  description="Visit co-pay"
                  onSuccess={onCopaySuccess}
                  onCancel={() => setCopayIntent(null)}
                />
              )}
              {copayMessage && <p className="text-[11px] text-emerald-300 text-center">{copayMessage}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium text-white">{selectedProvider.name}</div>
              <div className="text-xs text-gray-400">{selectedProvider.specialty} · {selectedProvider.practice}</div>
              <div className="rounded border border-zinc-700 bg-zinc-900/60 p-2">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Co-pay (USD, optional)</label>
                <input
                  type="number" min={0} step="0.01" placeholder="0.00"
                  value={copayUsd}
                  onChange={(e) => setCopayUsd(e.target.value)}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
                />
              </div>
              {Object.entries(slotsByDate).slice(0, 10).map(([date, daySlots]) => (
                <div key={date}>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                    {new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {daySlots.map(s => (
                      <button
                        key={`${date}-${s.time}`}
                        onClick={() => book(s)}
                        disabled={bookingId === date + s.time}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                      >
                        {s.kind === 'telehealth' ? <Video className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                        {s.time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AppointmentScheduler;
