'use client';

/**
 * PetActionDrawer — PetDesk-style slide-in right drawer that turns the
 * selected pet into a quick-action surface. Triggered by a "Quick
 * actions" button next to the pet picker in PetCareSection.
 *
 * Rebuilt (Frontend Rebuild Program, Wave 2) on the REAL `pets.js` Pet
 * shape and REAL macros. The previous version operated on a fabricated
 * `PetProfile` artifact (from the now-retired generic `useLensData`
 * CRUD system) with fields like `vetUserId`/`medications`-as-a-string
 * that never matched the real STATE-backed pet record — see
 * docs/lens-specs/pets-capability-map.md for the audit that found this.
 *
 * Six actions, all wired to real Concord backends:
 *
 *   1. Book vet visit    → pets.appointment-book (real scheduling +
 *                          auto-created reminder)
 *   2. DM a health record → pick a real vaccine/vet-visit record, DM it
 *   3. Request refill     → DM the vet with the pet's real active
 *                          medications (pets.medication-list)
 *   4. Emergency search    → chat_agent.do "find nearest 24h emergency
 *                          vet for {species} in {location}"
 *   5. Report lost/found  → pets.lost-card-create (real public ID card
 *                          with a shareable token)
 *   6. Quick log walk     → pets.activity-log (kind: 'walk')
 */

import { useEffect, useMemo, useState } from 'react';
import {
  X, Stethoscope, FileText, Pill, Phone, Globe, Activity,
  Loader2, Check, AlertTriangle, Send, Wand2, CalendarPlus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface DrawerPet {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  weightKg: number;
  microchipId: string | null;
  age?: { years: number; months: number } | null;
}

interface VaccineLite { id: string; name: string; date: string; nextDueDate: string | null }
interface MedicationLite { id: string; name: string; dosage: string | null; frequency: string | null; active: boolean }
interface VisitLite { id: string; date: string; reason: string; diagnosis: string | null }

interface PetActionDrawerProps {
  pet: DrawerPet;
  onClose: () => void;
  /** Called after any action mutates pet-scoped state, so the caller can refresh. */
  onChange?: () => void;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'book' | 'record' | 'refill' | 'emergency' | 'lost' | 'walk';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

const APPT_REASONS = ['checkup', 'vaccination', 'illness', 'follow_up', 'other'];

export function PetActionDrawer({ pet, onClose, onChange }: PetActionDrawerProps) {
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [recipient, setRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [publishedToken, setPublishedToken] = useState<string | null>(null);

  const [loadingRecords, setLoadingRecords] = useState(true);
  const [vaccines, setVaccines] = useState<VaccineLite[]>([]);
  const [medications, setMedications] = useState<MedicationLite[]>([]);
  const [visits, setVisits] = useState<VisitLite[]>([]);
  const [selectedRecordKey, setSelectedRecordKey] = useState('');

  const [bookForm, setBookForm] = useState({ date: '', reason: 'checkup' });
  const [lostForm, setLostForm] = useState({ contactName: '', contactPhone: '' });

  useEffect(() => {
    let cancelled = false;
    setLoadingRecords(true);
    (async () => {
      const [v, m, vis] = await Promise.all([
        lensRun('pets', 'vaccine-list', { petId: pet.id }),
        lensRun('pets', 'medication-list', { petId: pet.id }),
        lensRun('pets', 'vet-visit-list', { petId: pet.id }),
      ]);
      if (cancelled) return;
      setVaccines(v.data?.result?.vaccines || []);
      setMedications(m.data?.result?.medications || []);
      setVisits(vis.data?.result?.visits || []);
      setLoadingRecords(false);
    })();
    return () => { cancelled = true; };
  }, [pet.id]);

  const activeMeds = useMemo(() => medications.filter((m) => m.active), [medications]);
  const recordOptions = useMemo(() => [
    ...vaccines.map((v) => ({
      key: `vac:${v.id}`,
      label: `Vaccine — ${v.name} (${v.date})`,
      text: `Vaccine: ${v.name}, given ${v.date}${v.nextDueDate ? `, next due ${v.nextDueDate}` : ''}`,
    })),
    ...visits.map((vi) => ({
      key: `vis:${vi.id}`,
      label: `Vet visit — ${vi.reason} (${vi.date})`,
      text: `Vet visit: ${vi.reason} on ${vi.date}${vi.diagnosis ? ` — ${vi.diagnosis}` : ''}`,
    })),
  ], [vaccines, visits]);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  async function dm(content: string): Promise<{ sent: boolean; reason?: string }> {
    const to = recipient.trim();
    if (!to) return { sent: false, reason: 'Enter a vet recipient (Concord user id) above.' };
    try {
      const r = await api.post('/api/social/dm', { toUserId: to, content });
      return { sent: r.data?.ok !== false, reason: r.data?.error };
    } catch (e) { return { sent: false, reason: pickMessage(e) }; }
  }

  /* ---- handlers — every one calls a real pets.js macro ---- */

  async function actBookVet() {
    if (!bookForm.date) { err('Pick a date.'); return; }
    setBusy('book'); setFeedback(null);
    try {
      const r = await lensRun('pets', 'appointment-book', {
        petId: pet.id, date: bookForm.date, reason: bookForm.reason,
      });
      if (r.data?.ok === false) { err(r.data?.error || 'Could not book appointment.'); return; }
      ok(`Vet visit booked for ${bookForm.date} — a reminder was created.`);
      setBookForm({ date: '', reason: 'checkup' });
      onChange?.();
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDmRecord() {
    if (!selectedRecordKey) { err('Pick a record to send.'); return; }
    setBusy('record'); setFeedback(null);
    const rec = recordOptions.find((r) => r.key === selectedRecordKey);
    const { sent, reason } = await dm(`Health record for ${pet.name}:\n\n${rec?.text ?? '(record not found)'}`);
    if (sent) ok('Record DMed to vet.');
    else err(reason ?? 'DM failed.');
    setBusy(null);
  }

  async function actRefill() {
    if (activeMeds.length === 0) { err('No active medications on file.'); return; }
    setBusy('refill'); setFeedback(null);
    const list = activeMeds.map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` — ${m.frequency}` : ''}`).join('\n');
    const { sent, reason } = await dm(
      `Prescription refill request for ${pet.name} (${pet.species}${pet.breed ? `, ${pet.breed}` : ''}):\n\n${list}` +
      `${pet.weightKg ? `\n\nCurrent weight: ${pet.weightKg} kg.` : ''}`,
    );
    if (sent) ok('Refill request DMed to vet.');
    else err(reason ?? 'DM failed.');
    setBusy(null);
  }

  async function actEmergency() {
    setBusy('emergency'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        'Find the nearest 24-hour emergency veterinary clinic.',
        `Species: ${pet.species}.`,
        pet.breed ? `Breed: ${pet.breed}.` : '',
        'Return the clinic name, address, phone number, and a one-line note on why it fits.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 5 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent returned emergency-vet candidates.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actReportLost() {
    if (!lostForm.contactName.trim() || !lostForm.contactPhone.trim()) {
      err('Contact name and phone are required for the public ID card.'); return;
    }
    setBusy('lost'); setFeedback(null);
    try {
      const r = await lensRun('pets', 'lost-card-create', {
        petId: pet.id, contactName: lostForm.contactName.trim(), contactPhone: lostForm.contactPhone.trim(),
      });
      if (r.data?.ok === false) { err(r.data?.error || 'Could not publish ID card.'); return; }
      const card = r.data?.result?.card as { publicToken?: string } | undefined;
      if (card?.publicToken) setPublishedToken(card.publicToken);
      ok(`${pet.name} marked lost — public ID card published. Full details editable in Records.`);
      onChange?.();
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actLogWalk() {
    setBusy('walk'); setFeedback(null);
    try {
      const r = await lensRun('pets', 'activity-log', { petId: pet.id, kind: 'walk', durationMin: 30 });
      if (r.data?.ok === false) { err(r.data?.error || 'Could not log walk.'); return; }
      ok('30-min walk logged.');
      onChange?.();
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  /* ---- render ---- */

  const actions: Array<{
    id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string;
    onOpen: () => void; disabled?: boolean;
  }> = [
    { id: 'book', label: 'Book vet visit', icon: Stethoscope, accent: '#06b6d4', desc: 'Real appointment + auto reminder', onOpen: () => setActiveAction('book') },
    { id: 'record', label: 'DM health record', icon: FileText, accent: '#3b82f6', desc: 'Pick a real record + send to vet', onOpen: () => setActiveAction('record'), disabled: recordOptions.length === 0 },
    { id: 'refill', label: 'Request refill', icon: Pill, accent: '#8b5cf6', desc: activeMeds.length ? 'DM vet the active meds list' : 'No active medications', onOpen: actRefill, disabled: activeMeds.length === 0 },
    { id: 'emergency', label: 'Emergency 24h vet', icon: Phone, accent: '#ef4444', desc: 'Agent finds nearest 24h clinic', onOpen: actEmergency },
    { id: 'lost', label: 'Report lost/found', icon: Globe, accent: '#22c55e', desc: 'Publish a real public ID card', onOpen: () => setActiveAction('lost') },
    { id: 'walk', label: 'Quick log walk', icon: Activity, accent: '#f97316', desc: 'One-tap 30-min walk log', onOpen: actLogWalk },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 240 }}
        className="w-full max-w-md h-full bg-lattice-surface border-l border-lattice-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-lattice-border flex items-start gap-3 sticky top-0 bg-lattice-surface z-10">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">{(pet.name ?? '?')[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Quick actions</div>
            <h3 className="text-sm font-semibold text-white truncate">{pet.name}</h3>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {[pet.species, pet.breed, pet.age ? `${pet.age.years}y ${pet.age.months}m` : null, pet.weightKg ? `${pet.weightKg}kg` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <label htmlFor="pet-drawer-recipient" className="font-semibold mb-1.5 block">Vet recipient (Concord user id)</label>
            <input
              id="pet-drawer-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full bg-lattice-elevated border border-amber-500/30 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              placeholder="username or user id — needed for DM actions"
            />
          </div>

          {actions.map((a) => {
            const Icon = a.icon;
            const isBusy = busy === a.id;
            return (
              <button
                key={a.id}
                type="button"
                disabled={a.disabled || !!busy || loadingRecords}
                onClick={a.onOpen}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-all border',
                  'bg-lattice-elevated/40 border-lattice-border/40',
                  'hover:bg-lattice-elevated hover:border-lattice-border',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-lattice-border/40',
                  'focus:outline-none focus:ring-2 focus:ring-amber-400/40',
                )}
              >
                <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-100">{a.label}</div>
                  <div className="text-xs text-gray-400 leading-tight mt-0.5">{a.desc}</div>
                </div>
              </button>
            );
          })}

          {activeAction === 'book' && (
            <div className="px-3 py-3 rounded-lg bg-cyan-500/5 border border-cyan-500/30 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Book vet visit</div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={bookForm.date} onChange={(e) => setBookForm({ ...bookForm, date: e.target.value })}
                  className="bg-lattice-elevated border border-cyan-500/30 rounded px-2 py-1.5 text-xs text-white" />
                <select value={bookForm.reason} onChange={(e) => setBookForm({ ...bookForm, reason: e.target.value })}
                  className="bg-lattice-elevated border border-cyan-500/30 rounded px-2 py-1.5 text-xs text-white">
                  {APPT_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={actBookVet} disabled={!bookForm.date || busy === 'book'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'book' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarPlus className="w-3 h-3" />} Book
                </button>
                <button type="button" onClick={() => setActiveAction(null)} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
              </div>
            </div>
          )}

          {activeAction === 'record' && (
            <div className="px-3 py-3 rounded-lg bg-blue-500/5 border border-blue-500/30 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Pick a health record</div>
              {recordOptions.length === 0 ? (
                <p className="text-xs text-gray-400">No vaccine or vet-visit records on file for this pet.</p>
              ) : (
                <select value={selectedRecordKey} onChange={(e) => setSelectedRecordKey(e.target.value)}
                  className="w-full bg-lattice-elevated border border-blue-500/30 rounded px-2 py-1.5 text-xs text-white">
                  <option value="">— select a record —</option>
                  {recordOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={actDmRecord} disabled={!selectedRecordKey || !!busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'record' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} DM record to vet
                </button>
                <button type="button" onClick={() => { setActiveAction(null); setSelectedRecordKey(''); }} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
              </div>
            </div>
          )}

          {activeAction === 'lost' && (
            <div className="px-3 py-3 rounded-lg bg-emerald-500/5 border border-emerald-500/30 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Report lost — public ID card</div>
              <input placeholder="Contact name" value={lostForm.contactName} onChange={(e) => setLostForm({ ...lostForm, contactName: e.target.value })}
                className="w-full bg-lattice-elevated border border-emerald-500/30 rounded px-2 py-1.5 text-xs text-white" />
              <input placeholder="Contact phone" value={lostForm.contactPhone} onChange={(e) => setLostForm({ ...lostForm, contactPhone: e.target.value })}
                className="w-full bg-lattice-elevated border border-emerald-500/30 rounded px-2 py-1.5 text-xs text-white" />
              <p className="text-[10px] text-gray-400">Add color, last-seen location and a reward from the Records tab.</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={actReportLost} disabled={busy === 'lost'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy === 'lost' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />} Publish
                </button>
                <button type="button" onClick={() => setActiveAction(null)} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
              </div>
            </div>
          )}

          {agentReply && (
            <div className="px-3 py-3 rounded-lg bg-red-500/5 border border-red-500/30 max-h-64 overflow-y-auto">
              <div className="flex items-center gap-1.5 text-red-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
                <Wand2 className="w-3 h-3" /> Emergency-vet finder
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-200 leading-relaxed">{agentReply}</pre>
            </div>
          )}

          {publishedToken && (
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" />
              <span>Public ID card live — token <span className="font-mono">{publishedToken.slice(0, 12)}…</span></span>
            </div>
          )}

          <AnimatePresence>
            {feedback && (
              <motion.div
                key={feedback.text}
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs flex items-start gap-2 border',
                  feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30',
                )}
              >
                {feedback.kind === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
                <span>{feedback.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.aside>
    </motion.div>
  );
}
