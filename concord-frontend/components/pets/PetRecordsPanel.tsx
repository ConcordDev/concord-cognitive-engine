'use client';

/**
 * PetRecordsPanel — 2026 feature-parity surface (11pets / Pawprint).
 * One panel covering the seven backlog features for the selected pet:
 *   1. Vaccine due-date reminders + calendar (ICS) export
 *   2. Shareable / portable health-record export (JSON + text)
 *   3. Multi-caregiver shared household access (grant / revoke)
 *   4. Photo gallery / timeline per pet
 *   5. Vet appointment booking (schedule, not just log)
 *   6. Breed-specific care guidance (The Dog/Cat API)
 *   7. Lost-pet / microchip public ID card
 *
 * Every value is real user input or computed by the backend macros in
 * server/domains/pets.js. No seed/demo data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, CalendarClock, Download, Share2, Users, Image as ImageIcon,
  Stethoscope, ShieldAlert, BadgeAlert, Trash2, RefreshCw, Copy, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface VaccineEvent { petId: string; petName: string; vaccine: string; dueDate: string; status: string; vet: string | null }
interface AccessGrant { id: string; petId: string; petName: string; userId: string; displayName: string | null; role: string }
interface PetPhoto { id: string; url: string; caption: string | null; takenOn: string; milestone: string | null }
interface PhotoMonth { month: string; photos: PetPhoto[] }
interface Appointment { id: string; petName: string; clinic: string | null; vet: string | null; date: string; time: string | null; reason: string; notes: string | null; status: string; timing: string }
interface CareGuidance { breed: string; matched: boolean; lifeSpan: string | null; temperament: string | null; breedGroup: string | null; weightMetric: string | null; healthRisks: string[]; careTips: string[]; source: string }
interface LostCard {
  id: string; status: string; petName: string; species: string; breed: string | null;
  microchipId: string | null; color: string | null; distinguishingMarks: string | null;
  lastSeenLocation: string | null; lastSeenDate: string; contactName: string; contactPhone: string;
  contactEmail: string | null; reward: number; notes: string | null; publicToken: string;
}

const STATUS_COLOR: Record<string, string> = {
  overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400',
  completed: 'text-zinc-400', cancelled: 'text-zinc-400', no_show: 'text-rose-400',
  lost: 'text-rose-400', found: 'text-amber-400', safe: 'text-emerald-400', none: 'text-zinc-400',
};

const APPT_REASONS = ['checkup', 'vaccination', 'illness', 'surgery', 'dental', 'grooming', 'emergency', 'follow_up', 'other'];
const ACCESS_ROLES = ['co_owner', 'caregiver', 'viewer'];
const MILESTONES = ['adoption', 'birthday', 'first_walk', 'graduation', 'recovery', 'other'];

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function PetRecordsPanel({
  petId, petName, species, breed, onChange,
}: { petId: string; petName: string; species: string; breed: string | null; onChange: () => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [vaccineEvents, setVaccineEvents] = useState<VaccineEvent[]>([]);
  const [vaccineIcs, setVaccineIcs] = useState<{ ics: string; filename: string } | null>(null);
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [photoTimeline, setPhotoTimeline] = useState<PhotoMonth[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [guidance, setGuidance] = useState<CareGuidance | null>(null);
  const [lostCard, setLostCard] = useState<LostCard | null>(null);

  const [grantForm, setGrantForm] = useState({ userId: '', displayName: '', role: 'caregiver' });
  const [photoForm, setPhotoForm] = useState({ url: '', caption: '', takenOn: '', milestone: '' });
  const [apptForm, setApptForm] = useState({ date: '', time: '', reason: 'checkup', clinic: '', vet: '', notes: '' });
  const [lostForm, setLostForm] = useState({
    contactName: '', contactPhone: '', contactEmail: '', color: '',
    distinguishingMarks: '', lastSeenLocation: '', lastSeenDate: '', reward: '', notes: '',
  });

  const refresh = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    const [v, a, ph, ap, lc] = await Promise.all([
      lensRun('pets', 'vaccine-due-export', { petId }),
      lensRun('pets', 'access-list', { petId }),
      lensRun('pets', 'photo-timeline', { petId }),
      lensRun('pets', 'appointment-list', { petId }),
      lensRun('pets', 'lost-card-get', { petId }),
    ]);
    if (v.data?.ok) {
      setVaccineEvents(v.data.result?.events || []);
      setVaccineIcs({ ics: v.data.result?.ics || '', filename: v.data.result?.filename || 'vaccine-schedule.ics' });
    }
    setGrants(a.data?.ok ? (a.data.result?.grants || []) : []);
    if (ph.data?.ok) { setPhotoTimeline(ph.data.result?.timeline || []); setPhotoCount(ph.data.result?.count || 0); }
    setAppointments(ap.data?.ok ? (ap.data.result?.appointments || []) : []);
    setLostCard(lc.data?.ok ? (lc.data.result?.card || null) : null);
    setLoading(false);
  }, [petId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setGuidance(null); }, [petId]);

  const flash = (msg: string) => { setNotice(msg); setError(null); window.setTimeout(() => setNotice(null), 4000); };

  // 1 — Vaccine ICS export
  const exportIcs = () => {
    if (!vaccineIcs || vaccineEvents.length === 0) { setError('No due-dated vaccines to export.'); return; }
    downloadFile(vaccineIcs.filename, vaccineIcs.ics, 'text/calendar');
    flash('Vaccine calendar (.ics) downloaded.');
  };

  // 2 — Health-record export
  const exportRecord = async () => {
    setBusy('record');
    const r = await lensRun('pets', 'health-record-export', { petId });
    setBusy(null);
    if (r.data?.ok === false || !r.data?.result) { setError(r.data?.error || 'Export failed.'); return; }
    const res = r.data.result as { record: unknown; text: string; filename: string };
    downloadFile(res.filename, JSON.stringify(res.record, null, 2), 'application/json');
    downloadFile(res.filename.replace(/\.json$/, '.txt'), res.text, 'text/plain');
    flash('Portable health record exported (JSON + text).');
  };

  // 3 — Multi-caregiver access
  const grantAccess = async () => {
    if (!grantForm.userId.trim()) { setError('Caregiver user id is required.'); return; }
    setBusy('grant');
    const r = await lensRun('pets', 'access-grant', {
      petId, userId: grantForm.userId.trim(),
      displayName: grantForm.displayName.trim(), role: grantForm.role,
    });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not grant access.'); return; }
    setGrantForm({ userId: '', displayName: '', role: 'caregiver' });
    flash('Caregiver access granted.');
    await refresh(); onChange();
  };
  const revokeAccess = async (id: string) => {
    await lensRun('pets', 'access-revoke', { id });
    flash('Access revoked.');
    await refresh(); onChange();
  };

  // 4 — Photo gallery / timeline
  const addPhoto = async () => {
    if (!photoForm.url.trim()) { setError('Photo URL is required.'); return; }
    setBusy('photo');
    const r = await lensRun('pets', 'photo-add', {
      petId, url: photoForm.url.trim(), caption: photoForm.caption.trim(),
      takenOn: photoForm.takenOn, milestone: photoForm.milestone,
    });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not add photo.'); return; }
    setPhotoForm({ url: '', caption: '', takenOn: '', milestone: '' });
    flash('Photo added to timeline.');
    await refresh();
  };
  const delPhoto = async (id: string) => {
    await lensRun('pets', 'photo-delete', { petId, id });
    await refresh();
  };

  // 5 — Vet appointment booking
  const bookAppointment = async () => {
    if (!apptForm.date) { setError('Appointment date is required.'); return; }
    setBusy('appt');
    const r = await lensRun('pets', 'appointment-book', {
      petId, date: apptForm.date, time: apptForm.time, reason: apptForm.reason,
      clinic: apptForm.clinic.trim(), vet: apptForm.vet.trim(), notes: apptForm.notes.trim(),
    });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not book appointment.'); return; }
    setApptForm({ date: '', time: '', reason: 'checkup', clinic: '', vet: '', notes: '' });
    flash('Vet appointment booked — a reminder was created.');
    await refresh(); onChange();
  };
  const updateAppointment = async (id: string, status: string) => {
    await lensRun('pets', 'appointment-update', { petId, id, status });
    flash(`Appointment marked ${status}.`);
    await refresh(); onChange();
  };

  // 6 — Breed-specific care guidance
  const loadGuidance = async () => {
    setBusy('guidance'); setError(null);
    const r = await lensRun('pets', 'breed-care-guidance', { petId });
    setBusy(null);
    if (r.data?.ok === false || !r.data?.result) { setError(r.data?.error || 'No guidance available.'); return; }
    setGuidance(r.data.result as CareGuidance);
  };

  // 7 — Lost-pet ID card
  const publishLostCard = async () => {
    if (!lostForm.contactName.trim() || !lostForm.contactPhone.trim()) {
      setError('Contact name and phone are required for the ID card.'); return;
    }
    setBusy('lost');
    const r = await lensRun('pets', 'lost-card-create', {
      petId, contactName: lostForm.contactName.trim(), contactPhone: lostForm.contactPhone.trim(),
      contactEmail: lostForm.contactEmail.trim(), color: lostForm.color.trim(),
      distinguishingMarks: lostForm.distinguishingMarks.trim(),
      lastSeenLocation: lostForm.lastSeenLocation.trim(), lastSeenDate: lostForm.lastSeenDate,
      reward: Number(lostForm.reward) || 0, notes: lostForm.notes.trim(),
    });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not publish ID card.'); return; }
    flash('Lost-pet ID card published.');
    await refresh();
  };
  const resolveLostCard = async () => {
    setBusy('lost');
    await lensRun('pets', 'lost-card-resolve', { petId });
    setBusy(null);
    flash('Pet marked safe — ID card resolved.');
    await refresh();
  };
  const copyShareLink = (token: string) => {
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/lenses/pets?lostToken=${token}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(link);
      flash('Public ID-card link copied to clipboard.');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{notice}</div>}

      {/* 1 — Vaccine due reminders + ICS export */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <CalendarClock className="w-3.5 h-3.5 text-teal-400" /> Vaccine due dates
          </h3>
          <button type="button" onClick={exportIcs} disabled={vaccineEvents.length === 0}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-400 text-white font-medium">
            <Download className="w-3 h-3" /> Calendar (.ics)
          </button>
        </div>
        {vaccineEvents.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No due-dated vaccines yet. Add vaccine records with a next-due date.</p>
        ) : (
          <ul className="space-y-1">
            {vaccineEvents.map((e, i) => (
              <li key={`${e.vaccine}-${e.dueDate}-${i}`} className="flex items-center gap-2 text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="flex-1 text-zinc-200">{e.vaccine}</span>
                <span className={cn('text-[10px]', STATUS_COLOR[e.status] || 'text-zinc-400')}>{e.dueDate}</span>
                <span className={cn('text-[10px] uppercase tracking-wide', STATUS_COLOR[e.status] || 'text-zinc-400')}>{e.status.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 — Shareable health-record export */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-1">
          <Share2 className="w-3.5 h-3.5 text-teal-400" /> Shareable health record
        </h3>
        <p className="text-[11px] text-zinc-400 mb-2">
          Export a portable record (vaccines, medications, vet visits, weights, symptoms) for a vet or boarding facility.
        </p>
        <button type="button" onClick={exportRecord} disabled={busy === 'record'}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium">
          {busy === 'record' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Export record (JSON + text)
        </button>
      </section>

      {/* 3 — Multi-caregiver shared access */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-teal-400" /> Shared caregiver access
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Household member user id" value={grantForm.userId}
            onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={grantForm.role} onChange={(e) => setGrantForm({ ...grantForm, role: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {ACCESS_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="button" onClick={grantAccess} disabled={busy === 'grant'}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            {busy === 'grant' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Grant
          </button>
        </div>
        <input placeholder="Display name (optional)" value={grantForm.displayName}
          onChange={(e) => setGrantForm({ ...grantForm, displayName: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 mb-2" />
        {grants.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No one else can see this pet&apos;s record yet.</p>
        ) : (
          <ul className="space-y-1">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center gap-2 text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="flex-1 text-zinc-200">{g.displayName || g.userId}</span>
                <span className="text-[10px] uppercase tracking-wide text-teal-300">{g.role.replace(/_/g, ' ')}</span>
                <button type="button" onClick={() => revokeAccess(g.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Revoke access">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4 — Photo gallery / timeline */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <ImageIcon className="w-3.5 h-3.5 text-teal-400" /> Photo timeline
          <span className="text-[10px] text-zinc-400">· {photoCount} photo{photoCount === 1 ? '' : 's'}</span>
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Photo URL" value={photoForm.url} onChange={(e) => setPhotoForm({ ...photoForm, url: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={photoForm.takenOn} onChange={(e) => setPhotoForm({ ...photoForm, takenOn: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={photoForm.milestone} onChange={(e) => setPhotoForm({ ...photoForm, milestone: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">No milestone</option>
            {MILESTONES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Caption (optional)" value={photoForm.caption} onChange={(e) => setPhotoForm({ ...photoForm, caption: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPhoto} disabled={busy === 'photo'}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            {busy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
          </button>
        </div>
        {photoTimeline.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No photos yet. Add a photo URL to build a visual history.</p>
        ) : (
          <div className="space-y-3">
            {photoTimeline.map((m) => (
              <div key={m.month}>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">{m.month}</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {m.photos.map((p) => (
                    <figure key={p.id} className="relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || `${petName} photo`} className="w-full h-20 object-cover" />
                      <button type="button" onClick={() => delPhoto(p.id)}
                        className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-zinc-300 opacity-0 group-hover:opacity-100"
                        aria-label="Delete photo">
                        <X className="w-3 h-3" />
                      </button>
                      {(p.caption || p.milestone) && (
                        <figcaption className="px-1.5 py-1 text-[10px] text-zinc-400 truncate">
                          {p.milestone && <span className="text-teal-300">{p.milestone.replace(/_/g, ' ')} </span>}
                          {p.caption}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5 — Vet appointment booking */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Stethoscope className="w-3.5 h-3.5 text-teal-400" /> Vet appointments
        </h3>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input type="date" value={apptForm.date} onChange={(e) => setApptForm({ ...apptForm, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="time" value={apptForm.time} onChange={(e) => setApptForm({ ...apptForm, time: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={apptForm.reason} onChange={(e) => setApptForm({ ...apptForm, reason: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {APPT_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input placeholder="Clinic" value={apptForm.clinic} onChange={(e) => setApptForm({ ...apptForm, clinic: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Vet" value={apptForm.vet} onChange={(e) => setApptForm({ ...apptForm, vet: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={bookAppointment} disabled={busy === 'appt'}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            {busy === 'appt' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Book
          </button>
        </div>
        <input placeholder="Notes (optional)" value={apptForm.notes} onChange={(e) => setApptForm({ ...apptForm, notes: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 mb-2" />
        {appointments.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No appointments scheduled.</p>
        ) : (
          <ul className="space-y-1">
            {appointments.map((ap) => (
              <li key={ap.id} className="flex items-center gap-2 text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-200 capitalize">{ap.reason.replace(/_/g, ' ')}</span>
                <span className="text-[10px] text-zinc-400">{ap.date}{ap.time ? ` ${ap.time}` : ''}{ap.clinic ? ` · ${ap.clinic}` : ''}</span>
                <span className={cn('flex-1 text-right text-[10px] uppercase tracking-wide', STATUS_COLOR[ap.timing] || 'text-zinc-400')}>
                  {ap.timing.replace(/_/g, ' ')}
                </span>
                {ap.status === 'scheduled' && (
                  <>
                    <button type="button" onClick={() => updateAppointment(ap.id, 'completed')}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/50">Done</button>
                    <button type="button" onClick={() => updateAppointment(ap.id, 'cancelled')}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700">Cancel</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6 — Breed-specific care guidance */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <ShieldAlert className="w-3.5 h-3.5 text-teal-400" /> Breed-specific care guidance
          </h3>
          <button type="button" onClick={loadGuidance} disabled={busy === 'guidance' || !breed}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-400 text-white font-medium">
            {busy === 'guidance' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Analyse
          </button>
        </div>
        {!breed && <p className="text-[11px] text-zinc-400 italic">Set a breed on the pet profile to get tailored health-risk guidance.</p>}
        {breed && !guidance && <p className="text-[11px] text-zinc-400 italic">Analyse {species} breed &quot;{breed}&quot; for health risks and care tips.</p>}
        {guidance && (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-400">
              <span className="text-zinc-200 font-medium">{guidance.breed}</span>
              {guidance.lifeSpan && <span> · lifespan {guidance.lifeSpan}</span>}
              {guidance.breedGroup && <span> · {guidance.breedGroup}</span>}
              <span className="text-zinc-600"> · source: {guidance.source}</span>
            </p>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-rose-400 mb-1">Health risks</p>
              <ul className="space-y-1">
                {guidance.healthRisks.map((risk, i) => (
                  <li key={i} className="text-[11px] text-zinc-300 bg-rose-950/30 border border-rose-900/40 rounded-lg px-2 py-1">{risk}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-400 mb-1">Care tips</p>
              <ul className="space-y-1">
                {guidance.careTips.map((tip, i) => (
                  <li key={i} className="text-[11px] text-zinc-300 bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-2 py-1">{tip}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* 7 — Lost-pet / microchip ID card */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <BadgeAlert className="w-3.5 h-3.5 text-teal-400" /> Lost-pet / microchip ID card
        </h3>
        {lostCard ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-zinc-100">{lostCard.petName}</span>
                <span className={cn('text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded',
                  lostCard.status === 'safe' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-rose-900/50 text-rose-300')}>
                  {lostCard.status}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                {lostCard.species}{lostCard.breed ? ` · ${lostCard.breed}` : ''}
                {lostCard.color ? ` · ${lostCard.color}` : ''}
                {lostCard.microchipId ? ` · chip ${lostCard.microchipId}` : ''}
              </p>
              {lostCard.distinguishingMarks && <p className="text-[11px] text-zinc-400 mt-1">Marks: {lostCard.distinguishingMarks}</p>}
              {lostCard.lastSeenLocation && <p className="text-[11px] text-zinc-400">Last seen: {lostCard.lastSeenLocation} ({lostCard.lastSeenDate})</p>}
              <p className="text-[11px] text-zinc-400 mt-1">
                Contact: {lostCard.contactName} · {lostCard.contactPhone}
                {lostCard.contactEmail ? ` · ${lostCard.contactEmail}` : ''}
              </p>
              {lostCard.reward > 0 && <p className="text-[11px] text-amber-300">Reward: ${lostCard.reward}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => copyShareLink(lostCard.publicToken)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium">
                <Copy className="w-3 h-3" /> Copy public link
              </button>
              {lostCard.status !== 'safe' && (
                <button type="button" onClick={resolveLostCard} disabled={busy === 'lost'}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium">
                  {busy === 'lost' ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Mark safe
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-400">Publish a shareable ID card if {petName} goes missing.</p>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Contact name" value={lostForm.contactName}
                onChange={(e) => setLostForm({ ...lostForm, contactName: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Contact phone" value={lostForm.contactPhone}
                onChange={(e) => setLostForm({ ...lostForm, contactPhone: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Contact email (optional)" value={lostForm.contactEmail}
                onChange={(e) => setLostForm({ ...lostForm, contactEmail: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Color / markings" value={lostForm.color}
                onChange={(e) => setLostForm({ ...lostForm, color: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Last seen location" value={lostForm.lastSeenLocation}
                onChange={(e) => setLostForm({ ...lostForm, lastSeenLocation: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input type="date" value={lostForm.lastSeenDate}
                onChange={(e) => setLostForm({ ...lostForm, lastSeenDate: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Reward ($, optional)" inputMode="decimal" value={lostForm.reward}
                onChange={(e) => setLostForm({ ...lostForm, reward: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Distinguishing marks" value={lostForm.distinguishingMarks}
                onChange={(e) => setLostForm({ ...lostForm, distinguishingMarks: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            </div>
            <input placeholder="Notes (optional)" value={lostForm.notes}
              onChange={(e) => setLostForm({ ...lostForm, notes: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={publishLostCard} disabled={busy === 'lost'}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium">
              {busy === 'lost' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BadgeAlert className="w-3 h-3" />}
              Publish ID card
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
