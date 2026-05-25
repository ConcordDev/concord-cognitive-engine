'use client';

/**
 * PetActionDrawer — PetDesk-style slide-in right drawer that turns a
 * pet profile from a static record into an action surface. Triggered
 * by a "Quick actions" button on each PetProfile card.
 *
 * Six paid-app-tier actions, all wired to real Concord backends:
 *
 *   1. Book vet visit    → DM vet (when vetUserId present) +
 *                          schedule a Vet Visit ActivityLog artifact
 *   2. DM vet a record   → pick a recent HealthRecord, DM vet with
 *                          DTU id embedded
 *   3. Request refill    → DM vet with the profile's medications list
 *   4. Emergency search  → chat_agent.do "find nearest 24h emergency
 *                          vet for {species} in {location}"
 *   5. Publish lost/found → mint public DTU with pet identity +
 *                          POST /api/dtus/:id/publish
 *   6. Quick log walk    → mint an ActivityLog artifact (30 min, today)
 *
 * Vet identity:
 *   - If `vetUserId` is set on the profile, DMs go straight to that
 *     Concord user.
 *   - Otherwise the drawer surfaces a recipient input so the owner can
 *     pick one. This avoids guessing.
 */

import { useState, useMemo } from 'react';
import {
  X, Stethoscope, FileText, Pill, Phone, Globe, Activity,
  Loader2, Check, AlertTriangle, Send, Wand2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, lensRun } from '@/lib/api/client';
import { useCreateArtifact, useArtifactsByType } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';

interface PetProfileLite {
  id: string;
  title: string;
  data: {
    name?: string;
    species?: string;
    breed?: string;
    age?: number;
    weight?: number;
    color?: string;
    microchip?: string;
    medications?: string;
    allergies?: string;
    conditions?: string;
    vetName?: string;
    vetPhone?: string;
    vetUserId?: string;
    nextVetVisit?: string;
    location?: string;
  };
}

interface HealthRecordLite {
  id: string;
  title: string;
  data: { petName?: string; description?: string; date?: string };
}

interface PetActionDrawerProps {
  profile: PetProfileLite;
  onClose: () => void;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'book' | 'record' | 'refill' | 'emergency' | 'publish' | 'walk';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function PetActionDrawer({ profile, onClose }: PetActionDrawerProps) {
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [recipientOverride, setRecipientOverride] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');

  const d = profile.data;
  const createActivity = useCreateArtifact('pets');

  // Pull real health records for the DM-record action (filter by petName when possible)
  const { data: recordsResp } = useArtifactsByType<HealthRecordLite['data']>('pets', 'HealthRecord', { limit: 25 });
  const recordsForThisPet = useMemo(() => {
    const all = (recordsResp?.artifacts ?? []) as unknown as HealthRecordLite[];
    const petName = d.name?.toLowerCase();
    if (!petName) return all;
    return all.filter(r => (r.data?.petName ?? '').toLowerCase() === petName || (r.data?.petName ?? '').toLowerCase() === '');
  }, [recordsResp, d.name]);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  function vetRecipient(): string | null {
    const v = (d.vetUserId ?? recipientOverride ?? '').trim();
    return v || null;
  }

  async function dm(content: string): Promise<{ sent: boolean; reason?: string }> {
    const recipient = vetRecipient();
    if (!recipient) return { sent: false, reason: 'No vet recipient (set vetUserId on profile or enter one).' };
    try {
      const r = await api.post('/api/social/dm', { toUserId: recipient, content });
      return { sent: r.data?.ok !== false, reason: r.data?.error };
    } catch (e) { return { sent: false, reason: pickMessage(e) }; }
  }

  /* ---- handlers ---- */

  async function actBookVet() {
    setBusy('book'); setFeedback(null);
    try {
      // Schedule as an ActivityLog 'Vet Visit' artifact for follow-through
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      await createActivity.mutateAsync({
        type: 'ActivityLog',
        title: `Vet visit — ${d.name ?? 'pet'}`,
        data: {
          name: `Vet visit — ${d.name ?? 'pet'}`,
          petName: d.name,
          activityType: 'Vet Visit',
          date: nextWeek,
          duration: 60,
          intensity: 'low',
          description: `Booked via PetActionDrawer; vet: ${d.vetName ?? 'TBD'}`,
        },
        meta: { tags: ['vet', 'appointment'], status: 'scheduled', visibility: 'private' },
      });
      const { sent, reason } = await dm(
        `Hi${d.vetName ? ` ${d.vetName}` : ''} — I'd like to book a vet visit for ${d.name ?? 'my pet'}` +
        `${d.species ? ` (${d.species}${d.breed ? `, ${d.breed}` : ''})` : ''}.` +
        ` Targeting ${nextWeek}. What slot works for you?`,
      );
      ok(`Vet visit scheduled for ${nextWeek}.${sent ? ' Vet DMed.' : reason ? ` (${reason})` : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDmRecord() {
    if (!selectedRecordId) { err('Pick a record to send.'); return; }
    setBusy('record'); setFeedback(null);
    const rec = recordsForThisPet.find(r => r.id === selectedRecordId);
    const summary = rec ? `${rec.title}${rec.data?.date ? ` (${rec.data.date})` : ''}${rec.data?.description ? ` — ${rec.data.description}` : ''}` : '(record not found)';
    const { sent, reason } = await dm(
      `Health record for ${d.name ?? 'my pet'}:\n\n${summary}\n\n[DTU ${selectedRecordId}]`,
    );
    if (sent) ok('Record DMed to vet.');
    else err(reason ?? 'DM failed.');
    setBusy(null);
  }

  async function actRefill() {
    if (!d.medications) { err('No medications on this profile.'); return; }
    setBusy('refill'); setFeedback(null);
    const { sent, reason } = await dm(
      `Prescription refill request for ${d.name ?? 'my pet'}` +
      `${d.species ? ` (${d.species})` : ''}:\n\n${d.medications}` +
      `${d.weight ? `\n\nCurrent weight: ${d.weight} lbs.` : ''}`,
    );
    if (sent) ok('Refill request DMed to vet.');
    else err(reason ?? 'DM failed.');
    setBusy(null);
  }

  async function actEmergency() {
    setBusy('emergency'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Find the nearest 24-hour emergency veterinary clinic.`,
        d.species ? `Species: ${d.species}.` : '',
        d.breed ? `Breed: ${d.breed}.` : '',
        d.conditions ? `Known conditions: ${d.conditions}.` : '',
        d.location ? `Location: ${d.location}.` : 'Location not set on profile.',
        'Return the clinic name, address, phone number, and a one-line note on why it fits.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({
        domain: 'chat_agent',
        name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply
        ?? r.data?.result?.summary
        ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent returned emergency-vet candidates.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublishLost() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Lost/found: ${d.name ?? 'pet'}${d.species ? ` (${d.species})` : ''}`,
          tags: ['pets', 'lost-found', d.species, d.breed].filter(Boolean) as string[],
          source: 'pets:lostFound',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            pet: {
              name: d.name, species: d.species, breed: d.breed,
              color: d.color, weight: d.weight, age: d.age,
              microchip: d.microchip,
              allergies: d.allergies,
              conditions: d.conditions,
              location: d.location,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Posted publicly as DTU ${id.slice(0, 8)}…`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actLogWalk() {
    setBusy('walk'); setFeedback(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await createActivity.mutateAsync({
        type: 'ActivityLog',
        title: `Walk — ${d.name ?? 'pet'} (${today})`,
        data: {
          name: `Walk — ${d.name ?? 'pet'}`,
          petName: d.name,
          activityType: 'Walk',
          date: today,
          duration: 30,
          intensity: 'moderate',
        },
        meta: { tags: ['walk'], status: 'completed', visibility: 'private' },
      });
      ok('30-min walk logged.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  /* ---- render ---- */

  const actions: Array<{
    id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean;
  }> = [
    { id: 'book',      label: 'Book vet visit',      icon: Stethoscope, accent: '#06b6d4', desc: 'Schedule + DM your vet',                  handler: actBookVet },
    { id: 'record',    label: 'DM health record',    icon: FileText,    accent: '#3b82f6', desc: 'Pick a record + send to vet',             handler: () => setActiveAction('record'),
                                                                                                                                          disabled: recordsForThisPet.length === 0 },
    { id: 'refill',    label: 'Request refill',      icon: Pill,        accent: '#8b5cf6', desc: d.medications ? 'DM vet the meds list' : 'Add medications first',
                                                                                                                                          handler: actRefill,    disabled: !d.medications },
    { id: 'emergency', label: 'Emergency 24h vet',   icon: Phone,       accent: '#ef4444', desc: 'Agent finds nearest 24h clinic',          handler: actEmergency },
    { id: 'publish',   label: 'Post lost / found',   icon: Globe,       accent: '#22c55e', desc: 'Mint + publish public pet DTU',           handler: actPublishLost },
    { id: 'walk',      label: 'Quick log walk',      icon: Activity,    accent: '#f97316', desc: 'One-tap 30-min walk log',                handler: actLogWalk },
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
        {/* Header */}
        <div className="p-5 border-b border-lattice-border flex items-start gap-3 sticky top-0 bg-lattice-surface z-10">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">{(d.name ?? '?')[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Pet actions</div>
            <h3 className="text-sm font-semibold text-white truncate">{d.name ?? profile.title}</h3>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {[d.species, d.breed, d.age ? `${d.age}y` : null, d.weight ? `${d.weight}lbs` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Vet recipient hint */}
          {!d.vetUserId && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <p className="font-semibold mb-1.5">Vet recipient (Concord user id)</p>
              <input
                type="text"
                value={recipientOverride}
                onChange={(e) => setRecipientOverride(e.target.value)}
                className="w-full bg-lattice-elevated border border-amber-500/30 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                placeholder={d.vetName ? `For ${d.vetName} (no user id on profile)` : 'username or user id'}
              />
            </div>
          )}

          {actions.map(a => {
            const Icon = a.icon;
            const isBusy = busy === a.id;
            return (
              <button
                key={a.id}
                type="button"
                disabled={a.disabled || !!busy}
                onClick={a.handler}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-all border',
                  'bg-lattice-elevated/40 border-lattice-border/40',
                  'hover:bg-lattice-elevated hover:border-lattice-border',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-lattice-border/40',
                  'focus:outline-none focus:ring-2 focus:ring-amber-400/40',
                )}
              >
                <div
                  className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: a.accent + '20', color: a.accent }}
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-100">{a.label}</div>
                  <div className="text-xs text-gray-400 leading-tight mt-0.5">{a.desc}</div>
                </div>
              </button>
            );
          })}

          {/* Record-picker inline sub-panel */}
          {activeAction === 'record' && (
            <div className="px-3 py-3 rounded-lg bg-blue-500/5 border border-blue-500/30 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Pick a health record</div>
              {recordsForThisPet.length === 0 ? (
                <p className="text-xs text-gray-400">No health records on file for this pet.</p>
              ) : (
                <select
                  value={selectedRecordId}
                  onChange={(e) => setSelectedRecordId(e.target.value)}
                  className="w-full bg-lattice-elevated border border-blue-500/30 rounded px-2 py-1.5 text-xs text-white"
                >
                  <option value="">— select a record —</option>
                  {recordsForThisPet.map(r => (
                    <option key={r.id} value={r.id}>{r.title}{r.data?.date ? ` (${r.data.date})` : ''}</option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={actDmRecord}
                  disabled={!selectedRecordId || !!busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy === 'record' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  DM record to vet
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveAction(null); setSelectedRecordId(''); }}
                  className="text-xs text-gray-400 hover:text-gray-200"
                >Cancel</button>
              </div>
            </div>
          )}

          {/* Emergency agent reply */}
          {agentReply && (
            <div className="px-3 py-3 rounded-lg bg-red-500/5 border border-red-500/30 max-h-64 overflow-y-auto">
              <div className="flex items-center gap-1.5 text-red-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
                <Wand2 className="w-3 h-3" />
                Emergency-vet finder
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-200 leading-relaxed">{agentReply}</pre>
            </div>
          )}

          {/* Published-DTU footer */}
          {publishedDtuId && (
            <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" />
              <span>Lost/found posted as DTU <span className="font-mono">{publishedDtuId.slice(0, 12)}…</span></span>
            </div>
          )}

          <AnimatePresence>
            {feedback && (
              <motion.div
                key={feedback.text}
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs flex items-start gap-2 border',
                  feedback.kind === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border-red-500/30',
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
