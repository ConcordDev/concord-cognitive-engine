'use client';

/**
 * RxAppointmentsPanel — doctor / provider appointment tracker.
 *
 * Closes docs/WAVE4_INVENTORY.md's "No doctor-appointment manager/calendar"
 * gap (ENGINEERING triage — no external data dependency, a genuinely
 * missing feature vs Medisafe/GoodRx). Backed by real `pharmacy.appointment-*`
 * macros (see server/domains/pharmacy.js) — no fabricated schedule, no
 * client-side-only state. Same fetch/create/update shape as RxRefillsPanel.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, CalendarClock, CheckCircle2, XCircle, AlarmClockOff, Pencil, Stethoscope } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ApptStatus = 'scheduled' | 'completed' | 'cancelled' | 'missed';

interface Appointment {
  id: string;
  providerName: string;
  providerType: string | null;
  dateTime: string;
  reason: string | null;
  location: string | null;
  phone: string | null;
  relatedMedId: string | null;
  relatedMedName: string | null;
  notes: string | null;
  status: ApptStatus;
  when: 'upcoming' | 'past';
}
interface Medication { id: string; name: string }

const STATUS_COLOR: Record<ApptStatus, string> = {
  scheduled: 'text-amber-400', completed: 'text-emerald-400',
  cancelled: 'text-zinc-500', missed: 'text-rose-400',
};
const TERMINAL: ApptStatus[] = ['completed', 'cancelled', 'missed'];

const EMPTY_FORM = { providerName: '', providerType: '', dateTime: '', reason: '', location: '', phone: '', relatedMedId: '' };

export function RxAppointmentsPanel({ onChange }: { onChange: () => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, m] = await Promise.all([
      lensRun('pharmacy', 'appointment-list', {}),
      lensRun('pharmacy', 'med-list', {}),
    ]);
    if (a.data?.ok === false) {
      setError(a.data?.error || 'Failed to load appointments.');
      setAppointments([]);
    } else {
      setAppointments(a.data?.result?.appointments || []);
    }
    setMeds(m.data?.result?.medications || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const schedule = async () => {
    if (!form.providerName.trim()) { setError('Provider name is required.'); return; }
    if (!form.dateTime) { setError('Date & time is required.'); return; }
    const r = await lensRun('pharmacy', 'appointment-add', {
      providerName: form.providerName.trim(),
      providerType: form.providerType.trim() || undefined,
      dateTime: new Date(form.dateTime).toISOString(),
      reason: form.reason.trim() || undefined,
      location: form.location.trim() || undefined,
      phone: form.phone.trim() || undefined,
      relatedMedId: form.relatedMedId || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to schedule appointment.'); return; }
    setForm(EMPTY_FORM);
    setShowForm(false); setError(null);
    await refresh(); onChange();
  };

  const setStatus = async (id: string, status: ApptStatus) => {
    const r = await lensRun('pharmacy', 'appointment-update', { id, status });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to update appointment.'); return; }
    setError(null);
    await refresh(); onChange();
  };

  const startNotes = (appt: Appointment) => { setEditingId(appt.id); setNotesDraft(appt.notes || ''); };
  const saveNotes = async (id: string) => {
    const r = await lensRun('pharmacy', 'appointment-update', { id, notes: notesDraft });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to save notes.'); return; }
    setEditingId(null); setError(null);
    await refresh();
  };

  const remove = async (id: string) => {
    const r = await lensRun('pharmacy', 'appointment-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to delete appointment.'); return; }
    setError(null);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400" role="status" aria-label="Loading appointments"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const upcoming = appointments.filter((a) => a.when === 'upcoming');
  const past = appointments.filter((a) => a.when === 'past');

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Stethoscope className="w-3.5 h-3.5 text-amber-400" /> Upcoming appointments
          </h3>
          <button type="button" onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            <Plus className="w-3 h-3" /> Schedule
          </button>
        </div>

        {showForm && (
          <div className="grid grid-cols-2 gap-2 mb-3 bg-zinc-900/70 border border-zinc-800 rounded-lg p-3">
            <input placeholder="Provider name (e.g. Dr. Smith)" value={form.providerName}
              onChange={(e) => setForm({ ...form, providerName: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Provider type (primary_care, specialist…)" value={form.providerType}
              onChange={(e) => setForm({ ...form, providerType: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="datetime-local" aria-label="Date and time" value={form.dateTime}
              onChange={(e) => setForm({ ...form, dateTime: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select aria-label="Related medication" value={form.relatedMedId}
              onChange={(e) => setForm({ ...form, relatedMedId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Not medication-related</option>
              {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input placeholder="Reason (annual physical, med review…)" value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Location" value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Phone" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={schedule}
              className="col-span-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              Schedule appointment
            </button>
          </div>
        )}

        {upcoming.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No upcoming appointments.</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map((a) => (
              <AppointmentRow key={a.id} appt={a}
                editing={editingId === a.id} notesDraft={notesDraft}
                onNotesChange={setNotesDraft}
                onEditNotes={() => startNotes(a)}
                onSaveNotes={() => saveNotes(a.id)}
                onCancelNotes={() => setEditingId(null)}
                onComplete={() => setStatus(a.id, 'completed')}
                onCancel={() => setStatus(a.id, 'cancelled')}
                onMissed={() => setStatus(a.id, 'missed')}
                onDelete={() => remove(a.id)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarClock className="w-3.5 h-3.5 text-zinc-400" /> Past appointments
        </h3>
        {past.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No past appointments.</p>
        ) : (
          <ul className="space-y-1.5">
            {past.map((a) => (
              <AppointmentRow key={a.id} appt={a}
                editing={editingId === a.id} notesDraft={notesDraft}
                onNotesChange={setNotesDraft}
                onEditNotes={() => startNotes(a)}
                onSaveNotes={() => saveNotes(a.id)}
                onCancelNotes={() => setEditingId(null)}
                onComplete={() => setStatus(a.id, 'completed')}
                onCancel={() => setStatus(a.id, 'cancelled')}
                onMissed={() => setStatus(a.id, 'missed')}
                onDelete={() => remove(a.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AppointmentRow({
  appt, editing, notesDraft, onNotesChange, onEditNotes, onSaveNotes, onCancelNotes,
  onComplete, onCancel, onMissed, onDelete,
}: {
  appt: Appointment; editing: boolean; notesDraft: string;
  onNotesChange: (v: string) => void; onEditNotes: () => void; onSaveNotes: () => void; onCancelNotes: () => void;
  onComplete: () => void; onCancel: () => void; onMissed: () => void; onDelete: () => void;
}) {
  const isTerminal = TERMINAL.includes(appt.status);
  const when = new Date(appt.dateTime);
  const whenLabel = Number.isNaN(when.getTime()) ? appt.dateTime : when.toLocaleString();
  return (
    <li className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-200">{appt.providerName}{appt.providerType ? ` · ${appt.providerType.replace(/_/g, ' ')}` : ''}</p>
          <p className="text-[10px] text-zinc-400">{whenLabel}{appt.reason ? ` · ${appt.reason}` : ''}</p>
          {appt.relatedMedName && (
            <p className="text-[10px] text-cyan-400">Linked medication: {appt.relatedMedName}</p>
          )}
          {(appt.location || appt.phone) && (
            <p className="text-[10px] text-zinc-500">{[appt.location, appt.phone].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('text-[10px] capitalize', STATUS_COLOR[appt.status])}>{appt.status}</span>
          {!isTerminal && (
            <>
              <button type="button" onClick={onComplete} aria-label="Mark completed"
                className="p-1 rounded-lg text-emerald-400 hover:bg-zinc-800"><CheckCircle2 className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={onMissed} aria-label="Mark missed"
                className="p-1 rounded-lg text-rose-400 hover:bg-zinc-800"><AlarmClockOff className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={onCancel} aria-label="Cancel appointment"
                className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-800"><XCircle className="w-3.5 h-3.5" /></button>
            </>
          )}
          <button type="button" onClick={onEditNotes} aria-label="Add notes"
            className="p-1 rounded-lg text-zinc-400 hover:text-amber-300 hover:bg-zinc-800"><Pencil className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={onDelete} aria-label="Delete appointment"
            className="p-1 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-zinc-800"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {appt.notes && !editing && (
        <p className="text-[10px] text-zinc-500 mt-1 italic">Notes: {appt.notes}</p>
      )}
      {editing && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input value={notesDraft} onChange={(e) => onNotesChange(e.target.value)} placeholder="Notes…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
          <button type="button" onClick={onSaveNotes} className="text-[10px] px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg">Save</button>
          <button type="button" onClick={onCancelNotes} className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">Cancel</button>
        </div>
      )}
    </li>
  );
}
