'use client';

/**
 * RxRemindersPanel — Medisafe-shape dose reminders + caregiver alerts.
 * Reminders fire as real browser notifications when reminder-due
 * reports a due reminder; caregivers are notified (surfaced in-app)
 * on missed doses / low refills via caregiver-alerts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, BellRing, Bell, BellOff, Trash2, Users, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Medication { id: string; name: string }
interface Reminder { id: string; medId: string; medName: string; times: string[]; leadMinutes: number; sound: boolean; enabled: boolean; snoozeMinutes: number }
interface DueReminder { reminderId: string; medId: string; medName: string; time: string; minutesUntil: number; overdue: boolean; sound: boolean }
interface Caregiver { id: string; name: string; contact: string | null; relationship: string | null; notifyOnMissed: boolean; notifyOnRefillDue: boolean; missedThreshold: number }
interface AlertReason { kind: string; count: number }
interface CaregiverAlert { caregiverId: string; caregiverName: string; contact: string | null; relationship: string | null; reasons: AlertReason[] }

export function RxRemindersPanel({ onChange }: { onChange: () => void }) {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [due, setDue] = useState<DueReminder[]>([]);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [alerts, setAlerts] = useState<CaregiverAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remForm, setRemForm] = useState({ medId: '', times: '08:00, 20:00', leadMinutes: '0' });
  const [cgForm, setCgForm] = useState({ name: '', contact: '', relationship: '', missedThreshold: '1' });
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>('default');
  const firedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [m, r, d, c, a] = await Promise.all([
      lensRun('pharmacy', 'med-list', {}),
      lensRun('pharmacy', 'reminder-list', {}),
      lensRun('pharmacy', 'reminder-due', { windowMinutes: 30 }),
      lensRun('pharmacy', 'caregiver-list', {}),
      lensRun('pharmacy', 'caregiver-alerts', {}),
    ]);
    setMeds(m.data?.result?.medications || []);
    setReminders(r.data?.result?.reminders || []);
    setDue(d.data?.result?.due || []);
    setCaregivers(c.data?.result?.caregivers || []);
    setAlerts(a.data?.result?.alerts || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll reminder-due and raise a real browser notification for due items.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setNotifPerm(Notification.permission);
    const tick = async () => {
      const d = await lensRun('pharmacy', 'reminder-due', { windowMinutes: 30 });
      const dueList: DueReminder[] = d.data?.result?.due || [];
      setDue(dueList);
      if (Notification.permission !== 'granted') return;
      for (const r of dueList) {
        const key = `${r.reminderId}:${r.time}`;
        if (firedRef.current.has(key)) continue;
        if (r.minutesUntil > 5) continue;
        firedRef.current.add(key);
        try {
          new Notification(`Time for ${r.medName}`, {
            body: r.overdue ? `Dose at ${r.time} is overdue.` : `Dose due at ${r.time}.`,
            tag: key,
            silent: !r.sound,
          });
        } catch { /* notification rejected by browser */ }
      }
    };
    const id = window.setInterval(() => { void tick(); }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const requestNotif = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setError('This browser does not support notifications.');
      return;
    }
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  };

  const addReminder = async () => {
    if (!remForm.medId) { setError('Choose a medication.'); return; }
    const times = remForm.times.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('pharmacy', 'reminder-set', {
      medId: remForm.medId, times, leadMinutes: Number(remForm.leadMinutes) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRemForm({ medId: '', times: '08:00, 20:00', leadMinutes: '0' });
    setError(null);
    await refresh(); onChange();
  };
  const toggleReminder = async (id: string) => {
    await lensRun('pharmacy', 'reminder-toggle', { id });
    await refresh();
  };
  const deleteReminder = async (id: string) => {
    await lensRun('pharmacy', 'reminder-delete', { id });
    await refresh(); onChange();
  };
  const addCaregiver = async () => {
    if (!cgForm.name.trim()) { setError('Caregiver name is required.'); return; }
    const r = await lensRun('pharmacy', 'caregiver-add', {
      name: cgForm.name.trim(), contact: cgForm.contact.trim(),
      relationship: cgForm.relationship.trim(), missedThreshold: Number(cgForm.missedThreshold) || 1,
      notifyOnRefillDue: true,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCgForm({ name: '', contact: '', relationship: '', missedThreshold: '1' });
    setError(null);
    await refresh();
  };
  const removeCaregiver = async (id: string) => {
    await lensRun('pharmacy', 'caregiver-remove', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Due now */}
      {due.length > 0 && (
        <section className="bg-amber-950/40 border border-amber-900/50 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-amber-300 mb-2">
            <BellRing className="w-3.5 h-3.5" /> Doses due soon
          </h3>
          <ul className="space-y-1">
            {due.map((d) => (
              <li key={`${d.reminderId}-${d.time}`} className="flex items-center justify-between text-xs text-amber-100">
                <span>{d.medName} · {d.time}</span>
                <span className={cn('text-[10px]', d.overdue ? 'text-rose-400' : 'text-amber-400')}>
                  {d.overdue ? `${-d.minutesUntil} min overdue` : `in ${d.minutesUntil} min`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notification permission */}
      {notifPerm !== 'granted' && (
        <button type="button" onClick={requestNotif}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <Bell className="w-3.5 h-3.5 text-amber-400" />
          {notifPerm === 'denied' ? 'Notifications blocked — enable in browser settings' : 'Enable browser notifications'}
        </button>
      )}

      {/* Add reminder */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Bell className="w-3.5 h-3.5 text-amber-400" /> Dose reminders
        </h3>
        {meds.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Add a medication first to set reminders.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 mb-2">
            <select value={remForm.medId} onChange={(e) => setRemForm({ ...remForm, medId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Choose medication…</option>
              {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input placeholder="Times (08:00, 20:00)" value={remForm.times} onChange={(e) => setRemForm({ ...remForm, times: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Lead min" inputMode="numeric" value={remForm.leadMinutes} onChange={(e) => setRemForm({ ...remForm, leadMinutes: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addReminder}
              className="col-span-3 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Set reminder
            </button>
          </div>
        )}
        {reminders.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No reminders set.</p>
        ) : (
          <ul className="space-y-1">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{r.medName}</p>
                  <p className="text-[10px] text-zinc-400">
                    {r.times.join(', ')}{r.leadMinutes > 0 ? ` · ${r.leadMinutes} min early` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => toggleReminder(r.id)}
                    className={cn('p-1 rounded-lg', r.enabled ? 'text-amber-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-800')}
                    aria-label={r.enabled ? 'Disable reminder' : 'Enable reminder'}>
                    {r.enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => deleteReminder(r.id)}
                    className="p-1 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-zinc-800" aria-label="Delete reminder">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Caregiver alerts */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-amber-400" /> Medfriends &amp; caregiver alerts
        </h3>
        {alerts.length > 0 && (
          <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-3 mb-2">
            <p className="flex items-center gap-1 text-[11px] font-semibold text-rose-300 mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Caregivers to notify now
            </p>
            <ul className="space-y-1">
              {alerts.map((a) => (
                <li key={a.caregiverId} className="text-[11px] text-rose-100">
                  {a.caregiverName}{a.contact ? ` (${a.contact})` : ''}:{' '}
                  {a.reasons.map((r) => `${r.count} ${r.kind.replace(/_/g, ' ')}`).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={cgForm.name} onChange={(e) => setCgForm({ ...cgForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Contact (phone/email)" value={cgForm.contact} onChange={(e) => setCgForm({ ...cgForm, contact: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Relationship" value={cgForm.relationship} onChange={(e) => setCgForm({ ...cgForm, relationship: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Alert after N missed" inputMode="numeric" value={cgForm.missedThreshold} onChange={(e) => setCgForm({ ...cgForm, missedThreshold: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addCaregiver}
            className="col-span-4 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add caregiver
          </button>
        </div>
        {caregivers.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No caregivers added.</p>
        ) : (
          <ul className="space-y-1">
            {caregivers.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{c.name}{c.relationship ? ` · ${c.relationship}` : ''}</p>
                  <p className="text-[10px] text-zinc-400">
                    {c.contact || 'No contact'} · alerts after {c.missedThreshold} missed
                  </p>
                </div>
                <button type="button" onClick={() => removeCaregiver(c.id)}
                  className="p-1 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-zinc-800" aria-label="Remove caregiver">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
