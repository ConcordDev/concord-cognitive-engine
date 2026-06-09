'use client';

/**
 * BookingSuite — the Square Appointments / Vagaro feature surface for the
 * services lens. Six purpose-built sub-tools, every value wired to a real
 * services-domain macro (no mock/seed data):
 *
 *   1. Booking grid       — services.bookingGridCreate / .Move / .List / .Cancel
 *   2. Online self-book   — services.selfBookSlots / .selfBookConfirm
 *   3. POS payments       — services.paymentCapture / .paymentRefund / .paymentList
 *   4. Reminder delivery  — services.reminderSchedule / .reminderDispatch / .reminderList
 *   5. Staff shifts       — services.shiftCreate / .shiftList / .shiftUpdate / .staffAvailability
 *   6. Client profiles    — services.clientProfileUpsert / .clientHistory / .clientProfileList
 *   7. Recurring + waitlist — services.recurringSeries / .waitlistAdd / .waitlistList
 *                             / .waitlistPromote / .waitlistRemove
 */

import { useState, useCallback, useEffect } from 'react';
import {
  CalendarDays, Globe, CreditCard, Bell, Clock, UserCircle, Repeat,
  Plus, RefreshCw, X, Check, AlertTriangle, Trash2, ArrowUpRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

interface Booking {
  id: string;
  client: string;
  service: string;
  staff: string;
  date: string;
  time: string;
  duration: number;
  price: number;
  status: string;
  source: string;
}
interface Slot { staff: string; date: string; time: string; duration: number }
interface Payment {
  id: string;
  receiptNumber: string;
  client: string;
  subtotal: number;
  tax: number;
  tip: number;
  discount: number;
  total: number;
  method: string;
  status: string;
  capturedAt: string;
}
interface Reminder {
  id: string;
  client: string;
  channel: string;
  target: string;
  sendAt: string;
  body: string;
  status: string;
}
interface Shift {
  id: string;
  staff: string;
  date: string;
  start: string;
  end: string;
  role: string;
  status: string;
  hours: number;
}
interface ClientProfile {
  clientKey: string;
  name: string;
  phone?: string;
  email?: string;
  preferences?: string;
  notes?: string;
  allergies?: string;
  preferredProvider?: string;
}
interface WaitEntry {
  id: string;
  client: string;
  service: string | null;
  staff: string | null;
  preferredDate: string | null;
  priority: string;
  status: string;
}

type SubTool = 'grid' | 'selfbook' | 'pos' | 'reminders' | 'shifts' | 'profiles' | 'recurring';

const SUB_TOOLS: { id: SubTool; label: string; icon: typeof CalendarDays }[] = [
  { id: 'grid', label: 'Booking Grid', icon: CalendarDays },
  { id: 'selfbook', label: 'Self-Booking', icon: Globe },
  { id: 'pos', label: 'POS Payments', icon: CreditCard },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'shifts', label: 'Staff Shifts', icon: Clock },
  { id: 'profiles', label: 'Client Profiles', icon: UserCircle },
  { id: 'recurring', label: 'Recurring + Waitlist', icon: Repeat },
];

const TODAY = new Date().toISOString().slice(0, 10);

/* run a services macro; returns result or null on error */
async function svc<T>(action: string, input: Record<string, unknown>): Promise<{ result: T | null; error: string | null }> {
  const r = await lensRun<T>('services', action, input);
  return { result: r.data.ok ? r.data.result : null, error: r.data.error };
}

/* ------------------------------------------------------------------ */
/*  Booking Grid                                                       */
/* ------------------------------------------------------------------ */

const GRID_OPEN = 9 * 60;
const GRID_CLOSE = 19 * 60;

function BookingGrid() {
  const [date, setDate] = useState(TODAY);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [lanes, setLanes] = useState<string[]>([]);
  const [util, setUtil] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ client: '', service: '', staff: '', time: '10:00', duration: 60, price: 0 });

  const load = useCallback(async (d: string) => {
    setBusy(true);
    const { result } = await svc<{ bookings: Booking[]; staffLanes: string[]; utilization: Record<string, number> }>('bookingGridList', { date: d });
    if (result) { setBookings(result.bookings); setLanes(result.staffLanes); setUtil(result.utilization); }
    setBusy(false);
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const create = async () => {
    setErr(null);
    if (!form.client.trim() || !form.staff.trim()) { setErr('client and staff are required'); return; }
    const { result, error } = await svc<{ booking: Booking }>('bookingGridCreate', { ...form, date });
    if (!result) { setErr(error || 'create failed'); return; }
    setForm({ ...form, client: '', service: '' });
    load(date);
  };

  const move = async (id: string, time: string, staff: string) => {
    const { error } = await svc<{ booking: Booking }>('bookingGridMove', { id, time, staff, date });
    if (error) setErr(error); else load(date);
  };

  const cancel = async (id: string) => {
    const { error } = await svc<unknown>('bookingGridCancel', { id });
    if (error) setErr(error); else load(date);
  };

  const slots: number[] = [];
  for (let t = GRID_OPEN; t < GRID_CLOSE; t += 30) slots.push(t);
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const laneList = lanes.length ? lanes : (form.staff.trim() ? [form.staff.trim()] : []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="date" className={cn(ds.input, 'w-auto')} value={date} onChange={e => setDate(e.target.value)} />
        <button onClick={() => load(date)} className={cn(ds.btnGhost, ds.btnSmall)}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        {busy && <span className="text-xs text-neon-cyan animate-pulse">Loading…</span>}
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Add booking</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input className={ds.input} placeholder="Client" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <input className={ds.input} placeholder="Service" value={form.service} onChange={e => setForm({ ...form, service: e.target.value })} />
          <input className={ds.input} placeholder="Staff" value={form.staff} onChange={e => setForm({ ...form, staff: e.target.value })} />
          <input type="time" className={ds.input} value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
          <input type="number" className={ds.input} placeholder="Min" value={form.duration || ''} onChange={e => setForm({ ...form, duration: parseInt(e.target.value) || 0 })} />
          <input type="number" className={ds.input} placeholder="Price $" value={form.price || ''} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
        </div>
        <button onClick={create} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Book slot</button>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
      </div>

      {laneList.length === 0 ? (
        <p className={ds.textMuted}>No bookings or staff yet — add a booking to render the grid.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full min-w-[480px]">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-gray-400 sticky left-0 bg-lattice-surface">Time</th>
                {laneList.map(s => (
                  <th key={s} className="p-1.5 text-center text-gray-300">
                    {s}
                    <span className="block text-[10px] text-gray-400">{Math.round((util[s] || 0) / 6) / 10}h booked</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map(t => (
                <tr key={t} className="border-t border-lattice-border/40">
                  <td className="p-1.5 text-gray-400 sticky left-0 bg-lattice-surface">{fmt(t)}</td>
                  {laneList.map(s => {
                    const b = bookings.find(x => x.staff === s && x.status !== 'cancelled' &&
                      (() => { const [h, m] = x.time.split(':').map(Number); return h * 60 + m === t; })());
                    return (
                      <td key={s} className="p-1 align-top">
                        {b ? (
                          <div className={cn('rounded p-1.5 text-[11px]',
                            b.status === 'completed' ? 'bg-green-500/15 text-green-300' : 'bg-pink-500/15 text-pink-200')}>
                            <p className="font-semibold truncate">{b.client}</p>
                            <p className="text-gray-400 truncate">{b.service} · {b.duration}m</p>
                            <div className="flex gap-1 mt-1">
                              <button onClick={() => move(b.id, fmt(t + 30), s)} className="text-cyan-400 hover:underline" title="Move +30m"><ArrowUpRight className="w-3 h-3" /></button>
                              <button onClick={() => cancel(b.id)} className="text-red-400 hover:underline" title="Cancel"><X className="w-3 h-3" /></button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Online Self-Booking                                                */
/* ------------------------------------------------------------------ */

function SelfBooking() {
  const [date, setDate] = useState(TODAY);
  const [duration, setDuration] = useState(60);
  const [staff, setStaff] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [client, setClient] = useState({ name: '', service: '', email: '', phone: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    setErr(null); setMsg(null); setChosen(null);
    const input: Record<string, unknown> = { date, duration };
    if (staff.trim()) input.staff = staff.split(',').map(s => s.trim()).filter(Boolean);
    const { result } = await svc<{ slots: Slot[] }>('selfBookSlots', input);
    setSlots(result?.slots || []);
  };

  const confirm = async () => {
    if (!chosen) return;
    setErr(null);
    if (!client.name.trim()) { setErr('your name is required'); return; }
    const { result, error } = await svc<{ confirmation: string }>('selfBookConfirm', {
      date: chosen.date, time: chosen.time, duration: chosen.duration, staff: chosen.staff,
      client: client.name, service: client.service, email: client.email, phone: client.phone,
    });
    if (!result) { setErr(error || 'booking failed'); return; }
    setMsg(`Confirmed — ${result.confirmation}. A reminder was auto-scheduled.`);
    setChosen(null); search();
  };

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Find an open slot</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input type="date" className={ds.input} value={date} onChange={e => setDate(e.target.value)} />
          <input type="number" className={ds.input} placeholder="Duration min" value={duration || ''} onChange={e => setDuration(parseInt(e.target.value) || 0)} />
          <input className={ds.input} placeholder="Staff (optional, comma-sep)" value={staff} onChange={e => setStaff(e.target.value)} />
          <button onClick={search} className={ds.btnPrimary}>Search slots</button>
        </div>
      </div>

      {slots.length > 0 && (
        <div className={ds.panel}>
          <p className={cn(ds.heading3, 'mb-2')}>{slots.length} open slots</p>
          <div className="flex flex-wrap gap-2">
            {slots.slice(0, 60).map((sl, i) => (
              <button key={i} onClick={() => setChosen(sl)}
                className={cn('px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
                  chosen === sl ? 'bg-pink-500 text-white' : 'bg-lattice-elevated text-gray-300 hover:bg-pink-500/20')}>
                {sl.time} · {sl.staff}
              </button>
            ))}
          </div>
        </div>
      )}

      {chosen && (
        <div className={cn(ds.panel, 'space-y-2 border-pink-500/40')}>
          <p className={ds.heading3}>Book {chosen.time} with {chosen.staff}</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={ds.input} placeholder="Your name" value={client.name} onChange={e => setClient({ ...client, name: e.target.value })} />
            <input className={ds.input} placeholder="Service" value={client.service} onChange={e => setClient({ ...client, service: e.target.value })} />
            <input className={ds.input} placeholder="Email" value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} />
            <input className={ds.input} placeholder="Phone" value={client.phone} onChange={e => setClient({ ...client, phone: e.target.value })} />
          </div>
          <button onClick={confirm} className={ds.btnPrimary}><Check className="w-4 h-4" /> Confirm booking</button>
        </div>
      )}
      {msg && <p className="text-sm text-green-400"><Check className="w-4 h-4 inline mr-1" />{msg}</p>}
      {err && <p className="text-sm text-red-400"><AlertTriangle className="w-4 h-4 inline mr-1" />{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  POS Payments                                                       */
/* ------------------------------------------------------------------ */

function POSPayments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totals, setTotals] = useState({ gross: 0, tips: 0 });
  const [byMethod, setByMethod] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ client: '', subtotal: 0, taxRate: 8.25, tipPercent: 18, discount: 0, method: 'card', cardLast4: '' });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { result } = await svc<{ payments: Payment[]; gross: number; tips: number; byMethod: Record<string, number> }>('paymentList', {});
    if (result) { setPayments(result.payments); setTotals({ gross: result.gross, tips: result.tips }); setByMethod(result.byMethod); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const capture = async () => {
    setErr(null); setMsg(null);
    if (form.subtotal <= 0) { setErr('subtotal must be positive'); return; }
    const { result, error } = await svc<{ payment: Payment }>('paymentCapture', form);
    if (!result) { setErr(error || 'payment failed'); load(); return; }
    setMsg(`Captured ${result.payment.receiptNumber} — $${result.payment.total}`);
    setForm({ ...form, client: '', subtotal: 0, cardLast4: '' });
    load();
  };

  const refund = async (id: string) => {
    const { error } = await svc<unknown>('paymentRefund', { id });
    if (error) setErr(error); else { setMsg('Refund processed'); load(); }
  };

  return (
    <div className="space-y-4">
      <div className={ds.grid3}>
        <div className={ds.panel}><p className={ds.textMuted}>Gross captured</p><p className="text-2xl font-bold text-green-400">${totals.gross.toLocaleString()}</p></div>
        <div className={ds.panel}><p className={ds.textMuted}>Tips</p><p className="text-2xl font-bold text-yellow-400">${totals.tips.toLocaleString()}</p></div>
        <div className={ds.panel}><p className={ds.textMuted}>Transactions</p><p className="text-2xl font-bold text-white">{payments.length}</p></div>
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Take a payment</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={ds.input} placeholder="Client" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <input type="number" className={ds.input} placeholder="Subtotal $" value={form.subtotal || ''} onChange={e => setForm({ ...form, subtotal: parseFloat(e.target.value) || 0 })} />
          <input type="number" className={ds.input} placeholder="Tax %" value={form.taxRate || ''} onChange={e => setForm({ ...form, taxRate: parseFloat(e.target.value) || 0 })} />
          <input type="number" className={ds.input} placeholder="Tip %" value={form.tipPercent || ''} onChange={e => setForm({ ...form, tipPercent: parseFloat(e.target.value) || 0 })} />
          <input type="number" className={ds.input} placeholder="Discount $" value={form.discount || ''} onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} />
          <select className={ds.select} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
            {['card', 'cash', 'gift_card', 'other'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          {form.method === 'card' && (
            <input className={ds.input} placeholder="Card last4" maxLength={4} value={form.cardLast4} onChange={e => setForm({ ...form, cardLast4: e.target.value })} />
          )}
        </div>
        <p className="text-[11px] text-gray-400">Card auth is simulated — last4 of <code>0000</code> declines.</p>
        <button onClick={capture} className={ds.btnPrimary}><CreditCard className="w-4 h-4" /> Charge</button>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
        {msg && <p className="text-xs text-green-400"><Check className="w-3 h-3 inline mr-1" />{msg}</p>}
      </div>

      {Object.keys(byMethod).length > 0 && (
        <div className={ds.panel}>
          <p className={cn(ds.heading3, 'mb-2')}>Revenue by method</p>
          <ChartKit
            kind="bar"
            xKey="method"
            data={Object.entries(byMethod).map(([method, amount]) => ({ method, amount }))}
            series={[{ key: 'amount', label: 'Captured' }]}
            height={140}
          />
        </div>
      )}

      <div className="space-y-1.5">
        {payments.map(p => (
          <div key={p.id} className="flex items-center gap-3 p-2.5 rounded bg-lattice-elevated/40 text-sm">
            <span className={cn('font-mono text-xs', ds.textMuted)}>{p.receiptNumber}</span>
            <span className="flex-1 truncate">{p.client}</span>
            <span className={ds.badge(p.status === 'captured' ? 'green-400' : p.status === 'declined' ? 'red-400' : 'gray-400')}>{p.status}</span>
            <span className="text-green-400 font-bold">${p.total}</span>
            {p.status === 'captured' && (
              <button onClick={() => refund(p.id)} className="text-red-400 text-xs hover:underline">Refund</button>
            )}
          </div>
        ))}
        {payments.length === 0 && <p className={ds.textMuted}>No payments captured yet.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reminders                                                          */
/* ------------------------------------------------------------------ */

function Reminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ client: '', channel: 'sms', target: '', sendAt: `${TODAY}T09:00`, body: 'Appointment reminder' });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { result } = await svc<{ reminders: Reminder[]; counts: Record<string, number> }>('reminderList', {});
    if (result) { setReminders(result.reminders); setCounts(result.counts); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const schedule = async () => {
    setErr(null); setMsg(null);
    if (!form.client.trim()) { setErr('client required'); return; }
    const { result, error } = await svc<unknown>('reminderSchedule', form);
    if (!result) { setErr(error || 'schedule failed'); return; }
    setForm({ ...form, client: '', target: '' });
    load();
  };

  const dispatch = async () => {
    const { result } = await svc<{ dispatched: number; failed: number }>('reminderDispatch', { now: new Date().toISOString() });
    if (result) setMsg(`Delivered ${result.dispatched}, ${result.failed} failed`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className={ds.grid3}>
        <div className={ds.panel}><p className={ds.textMuted}>Scheduled</p><p className="text-2xl font-bold text-blue-400">{counts.scheduled || 0}</p></div>
        <div className={ds.panel}><p className={ds.textMuted}>Delivered</p><p className="text-2xl font-bold text-green-400">{counts.delivered || 0}</p></div>
        <div className={ds.panel}><p className={ds.textMuted}>Failed</p><p className="text-2xl font-bold text-red-400">{counts.failed || 0}</p></div>
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Schedule a reminder</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={ds.input} placeholder="Client" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <select className={ds.select} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
            <option value="sms">SMS</option><option value="email">Email</option>
          </select>
          <input className={ds.input} placeholder={form.channel === 'sms' ? 'Phone' : 'Email'} value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} />
          <input type="datetime-local" className={ds.input} value={form.sendAt} onChange={e => setForm({ ...form, sendAt: e.target.value })} />
        </div>
        <input className={ds.input} placeholder="Message" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
        <div className="flex gap-2">
          <button onClick={schedule} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Schedule</button>
          <button onClick={dispatch} className={ds.btnSecondary}><Bell className="w-4 h-4" /> Dispatch due now</button>
        </div>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
        {msg && <p className="text-xs text-green-400"><Check className="w-3 h-3 inline mr-1" />{msg}</p>}
      </div>

      <div className="space-y-1.5">
        {reminders.map(r => (
          <div key={r.id} className="flex items-center gap-3 p-2.5 rounded bg-lattice-elevated/40 text-sm">
            <span className={ds.badge(r.channel === 'sms' ? 'cyan-400' : 'purple-400')}>{r.channel}</span>
            <span className="flex-1 truncate">{r.client} — {r.body}</span>
            <span className={cn(ds.textMuted, 'text-xs')}>{r.sendAt.replace('T', ' ')}</span>
            <span className={ds.badge(r.status === 'delivered' ? 'green-400' : r.status === 'failed' ? 'red-400' : 'blue-400')}>{r.status}</span>
          </div>
        ))}
        {reminders.length === 0 && <p className={ds.textMuted}>No reminders scheduled.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Staff Shifts                                                       */
/* ------------------------------------------------------------------ */

function StaffShifts() {
  const [date, setDate] = useState(TODAY);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [hoursByStaff, setHoursByStaff] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ staff: '', start: '09:00', end: '17:00', role: '' });
  const [avail, setAvail] = useState<{ staff: string; freeSlots: string[]; available: boolean } | null>(null);
  const [availStaff, setAvailStaff] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    const { result } = await svc<{ shifts: Shift[]; hoursByStaff: Record<string, number> }>('shiftList', { date: d });
    if (result) { setShifts(result.shifts); setHoursByStaff(result.hoursByStaff); }
  }, []);
  useEffect(() => { load(date); }, [date, load]);

  const create = async () => {
    setErr(null);
    if (!form.staff.trim()) { setErr('staff name required'); return; }
    const { result, error } = await svc<unknown>('shiftCreate', { ...form, date });
    if (!result) { setErr(error || 'shift failed'); return; }
    setForm({ ...form, staff: '', role: '' });
    load(date);
  };

  const update = async (id: string, status: string) => {
    const { error } = await svc<unknown>('shiftUpdate', { id, status });
    if (error) setErr(error); else load(date);
  };

  const checkAvail = async () => {
    if (!availStaff.trim()) return;
    const { result } = await svc<{ staff: string; freeSlots: string[]; available: boolean }>('staffAvailability', { date, staff: availStaff, duration: 60 });
    setAvail(result);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" className={cn(ds.input, 'w-auto')} value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Add shift</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={ds.input} placeholder="Staff" value={form.staff} onChange={e => setForm({ ...form, staff: e.target.value })} />
          <input type="time" className={ds.input} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <input type="time" className={ds.input} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <input className={ds.input} placeholder="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} />
        </div>
        <button onClick={create} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Add shift</button>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Check availability</p>
        <div className="flex gap-2">
          <input className={ds.input} placeholder="Staff name" value={availStaff} onChange={e => setAvailStaff(e.target.value)} />
          <button onClick={checkAvail} className={ds.btnSecondary}>Check</button>
        </div>
        {avail && (
          <div className="text-sm">
            {avail.available ? (
              <div className="flex flex-wrap gap-1.5">
                {avail.freeSlots.map(s => <span key={s} className={ds.badge('green-400')}>{s}</span>)}
              </div>
            ) : <p className="text-red-400">{avail.staff} is unavailable that day.</p>}
          </div>
        )}
      </div>

      {Object.keys(hoursByStaff).length > 0 && (
        <div className={ds.panel}>
          <p className={cn(ds.heading3, 'mb-2')}>Scheduled hours</p>
          <ChartKit
            kind="bar"
            xKey="staff"
            data={Object.entries(hoursByStaff).map(([staff, hours]) => ({ staff, hours }))}
            series={[{ key: 'hours', label: 'Hours' }]}
            height={140}
          />
        </div>
      )}

      <div className="space-y-1.5">
        {shifts.map(sh => (
          <div key={sh.id} className="flex items-center gap-3 p-2.5 rounded bg-lattice-elevated/40 text-sm">
            <span className="font-semibold">{sh.staff}</span>
            <span className={ds.textMuted}>{sh.start}–{sh.end} · {sh.hours}h{sh.role ? ` · ${sh.role}` : ''}</span>
            <span className={cn('ml-auto', ds.badge(sh.status === 'scheduled' ? 'green-400' : sh.status === 'cancelled' ? 'red-400' : 'gray-400'))}>{sh.status}</span>
            {sh.status !== 'cancelled' && (
              <select className={cn(ds.select, 'w-auto text-xs')} value={sh.status} onChange={e => update(sh.id, e.target.value)}>
                {['scheduled', 'off', 'vacation', 'cancelled'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        ))}
        {shifts.length === 0 && <p className={ds.textMuted}>No shifts scheduled.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Client Profiles                                                    */
/* ------------------------------------------------------------------ */

interface HistoryResult {
  profile: ClientProfile;
  visits: number;
  totalSpend: number;
  lastVisit: string | null;
  favoriteService: string | null;
  noShows: number;
  bookings: Booking[];
  rebookSuggestion: string | null;
}

function ClientProfiles() {
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [form, setForm] = useState({ client: '', phone: '', email: '', preferences: '', allergies: '', preferredProvider: '', notes: '' });
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { result } = await svc<{ profiles: ClientProfile[] }>('clientProfileList', {});
    if (result) setProfiles(result.profiles);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setErr(null);
    if (!form.client.trim()) { setErr('client name required'); return; }
    const { result, error } = await svc<unknown>('clientProfileUpsert', form);
    if (!result) { setErr(error || 'save failed'); return; }
    load();
  };

  const view = async (key: string) => {
    const { result } = await svc<HistoryResult>('clientHistory', { client: key });
    setHistory(result);
  };

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Create / update client profile</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input className={ds.input} placeholder="Client name" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <input className={ds.input} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <input className={ds.input} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className={ds.input} placeholder="Preferred provider" value={form.preferredProvider} onChange={e => setForm({ ...form, preferredProvider: e.target.value })} />
          <input className={ds.input} placeholder="Allergies" value={form.allergies} onChange={e => setForm({ ...form, allergies: e.target.value })} />
          <input className={ds.input} placeholder="Preferences" value={form.preferences} onChange={e => setForm({ ...form, preferences: e.target.value })} />
        </div>
        <input className={ds.input} placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        <button onClick={save} className={ds.btnPrimary}><Check className="w-4 h-4" /> Save profile</button>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
      </div>

      <div className={ds.grid3}>
        {profiles.map(p => (
          <button key={p.clientKey} onClick={() => view(p.clientKey)} className={cn(ds.panelHover, 'text-left')}>
            <p className={ds.heading3}>{p.name}</p>
            {p.phone && <p className={cn(ds.textMuted, 'text-xs')}>{p.phone}</p>}
            {p.preferredProvider && <p className={cn(ds.textMuted, 'text-xs')}>Prefers: {p.preferredProvider}</p>}
            {p.allergies && <p className="text-orange-400 text-xs"><AlertTriangle className="w-3 h-3 inline mr-1" />{p.allergies}</p>}
          </button>
        ))}
        {profiles.length === 0 && <p className={ds.textMuted}>No client profiles yet.</p>}
      </div>

      {history && (
        <div className={cn(ds.panel, 'space-y-3 border-pink-500/40')}>
          <div className="flex items-center justify-between">
            <p className={ds.heading3}>{history.profile.name}</p>
            <button onClick={() => setHistory(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            <div className="p-2 bg-lattice-surface rounded"><p className="text-lg font-bold text-white">{history.visits}</p><p className="text-[10px] text-gray-400">Visits</p></div>
            <div className="p-2 bg-lattice-surface rounded"><p className="text-lg font-bold text-green-400">${history.totalSpend}</p><p className="text-[10px] text-gray-400">Total spend</p></div>
            <div className="p-2 bg-lattice-surface rounded"><p className="text-lg font-bold text-red-400">{history.noShows}</p><p className="text-[10px] text-gray-400">No-shows</p></div>
            <div className="p-2 bg-lattice-surface rounded"><p className="text-xs font-bold text-cyan-400 truncate">{history.favoriteService || '—'}</p><p className="text-[10px] text-gray-400">Favorite</p></div>
          </div>
          {history.rebookSuggestion && (
            <p className="text-sm text-pink-300"><Repeat className="w-4 h-4 inline mr-1" />{history.rebookSuggestion}</p>
          )}
          <div className="space-y-1">
            {history.bookings.map(b => (
              <div key={b.id} className="flex items-center gap-3 text-xs p-2 bg-lattice-surface rounded">
                <span className={ds.textMuted}>{b.date} {b.time}</span>
                <span className="flex-1">{b.service}</span>
                <span className={ds.badge(b.status === 'completed' ? 'green-400' : 'gray-400')}>{b.status}</span>
              </div>
            ))}
            {history.bookings.length === 0 && <p className={ds.textMuted}>No booking history.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Recurring + Waitlist                                               */
/* ------------------------------------------------------------------ */

function RecurringWaitlist() {
  const [recForm, setRecForm] = useState({ client: '', service: '', staff: '', date: TODAY, time: '10:00', duration: 60, frequency: 'weekly', occurrences: 4, price: 0 });
  const [recResult, setRecResult] = useState<{ createdCount: number; skipped: { date: string; reason: string }[] } | null>(null);
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [wlCounts, setWlCounts] = useState<Record<string, number>>({});
  const [wlForm, setWlForm] = useState({ client: '', service: '', staff: '', preferredDate: '', priority: 'normal' });
  const [err, setErr] = useState<string | null>(null);

  const loadWl = useCallback(async () => {
    const { result } = await svc<{ waitlist: WaitEntry[]; counts: Record<string, number> }>('waitlistList', {});
    if (result) { setWaitlist(result.waitlist); setWlCounts(result.counts); }
  }, []);
  useEffect(() => { loadWl(); }, [loadWl]);

  const createSeries = async () => {
    setErr(null); setRecResult(null);
    if (!recForm.client.trim()) { setErr('client required'); return; }
    const { result, error } = await svc<{ createdCount: number; skipped: { date: string; reason: string }[] }>('recurringSeries', recForm);
    if (!result) { setErr(error || 'series failed'); return; }
    setRecResult(result);
  };

  const addWait = async () => {
    setErr(null);
    if (!wlForm.client.trim()) { setErr('client required'); return; }
    const { result, error } = await svc<unknown>('waitlistAdd', wlForm);
    if (!result) { setErr(error || 'add failed'); return; }
    setWlForm({ client: '', service: '', staff: '', preferredDate: '', priority: 'normal' });
    loadWl();
  };

  const promote = async (id: string) => {
    const { error } = await svc<unknown>('waitlistPromote', { id, time: '11:00', duration: 60 });
    if (error) setErr(error); else loadWl();
  };
  const removeWait = async (id: string) => {
    const { error } = await svc<unknown>('waitlistRemove', { id });
    if (error) setErr(error); else loadWl();
  };

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Recurring appointment series</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={ds.input} placeholder="Client" value={recForm.client} onChange={e => setRecForm({ ...recForm, client: e.target.value })} />
          <input className={ds.input} placeholder="Service" value={recForm.service} onChange={e => setRecForm({ ...recForm, service: e.target.value })} />
          <input className={ds.input} placeholder="Staff" value={recForm.staff} onChange={e => setRecForm({ ...recForm, staff: e.target.value })} />
          <input type="date" className={ds.input} value={recForm.date} onChange={e => setRecForm({ ...recForm, date: e.target.value })} />
          <input type="time" className={ds.input} value={recForm.time} onChange={e => setRecForm({ ...recForm, time: e.target.value })} />
          <select className={ds.select} value={recForm.frequency} onChange={e => setRecForm({ ...recForm, frequency: e.target.value })}>
            {['weekly', 'biweekly', 'monthly'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <input type="number" className={ds.input} placeholder="Occurrences" value={recForm.occurrences || ''} onChange={e => setRecForm({ ...recForm, occurrences: parseInt(e.target.value) || 0 })} />
          <input type="number" className={ds.input} placeholder="Duration min" value={recForm.duration || ''} onChange={e => setRecForm({ ...recForm, duration: parseInt(e.target.value) || 0 })} />
        </div>
        <button onClick={createSeries} className={ds.btnPrimary}><Repeat className="w-4 h-4" /> Create series</button>
        {recResult && (
          <p className="text-sm text-green-400">
            <Check className="w-4 h-4 inline mr-1" />Created {recResult.createdCount} bookings
            {recResult.skipped.length > 0 && `, skipped ${recResult.skipped.length} (conflict)`}
          </p>
        )}
      </div>

      <div className={cn(ds.panel, 'space-y-2')}>
        <p className={ds.heading3}>Waitlist</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input className={ds.input} placeholder="Client" value={wlForm.client} onChange={e => setWlForm({ ...wlForm, client: e.target.value })} />
          <input className={ds.input} placeholder="Service" value={wlForm.service} onChange={e => setWlForm({ ...wlForm, service: e.target.value })} />
          <input className={ds.input} placeholder="Staff" value={wlForm.staff} onChange={e => setWlForm({ ...wlForm, staff: e.target.value })} />
          <input type="date" className={ds.input} value={wlForm.preferredDate} onChange={e => setWlForm({ ...wlForm, preferredDate: e.target.value })} />
          <select className={ds.select} value={wlForm.priority} onChange={e => setWlForm({ ...wlForm, priority: e.target.value })}>
            {['high', 'normal', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button onClick={addWait} className={ds.btnSecondary}><Plus className="w-4 h-4" /> Add to waitlist</button>
        {err && <p className="text-xs text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />{err}</p>}
      </div>

      <div className="flex gap-3 text-xs">
        <span className={ds.badge('blue-400')}>Waiting {wlCounts.waiting || 0}</span>
        <span className={ds.badge('yellow-400')}>Offered {wlCounts.offered || 0}</span>
        <span className={ds.badge('green-400')}>Booked {wlCounts.booked || 0}</span>
      </div>

      <div className="space-y-1.5">
        {waitlist.map(w => (
          <div key={w.id} className="flex items-center gap-3 p-2.5 rounded bg-lattice-elevated/40 text-sm">
            <span className={ds.badge(w.priority === 'high' ? 'red-400' : w.priority === 'low' ? 'gray-400' : 'blue-400')}>{w.priority}</span>
            <span className="flex-1 truncate">{w.client}{w.service ? ` — ${w.service}` : ''}</span>
            <span className={ds.badge(w.status === 'booked' ? 'green-400' : w.status === 'offered' ? 'yellow-400' : 'gray-400')}>{w.status}</span>
            {w.status === 'waiting' && (
              <>
                <button onClick={() => promote(w.id)} className="text-green-400 text-xs hover:underline">Promote</button>
                <button aria-label="Delete" onClick={() => removeWait(w.id)} className="text-red-400 text-xs hover:underline"><Trash2 className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        ))}
        {waitlist.length === 0 && <p className={ds.textMuted}>Waitlist is empty.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Suite shell                                                        */
/* ------------------------------------------------------------------ */

export function BookingSuite() {
  const [tool, setTool] = useState<SubTool>('grid');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-pink-400" />
        <h2 className={ds.heading3}>Booking &amp; POS Suite</h2>
      </div>
      <nav className="flex items-center gap-1.5 flex-wrap">
        {SUB_TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTool(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                tool === t.id ? 'bg-pink-400/20 text-pink-300' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tool === 'grid' && <BookingGrid />}
        {tool === 'selfbook' && <SelfBooking />}
        {tool === 'pos' && <POSPayments />}
        {tool === 'reminders' && <Reminders />}
        {tool === 'shifts' && <StaffShifts />}
        {tool === 'profiles' && <ClientProfiles />}
        {tool === 'recurring' && <RecurringWaitlist />}
      </div>
    </div>
  );
}
