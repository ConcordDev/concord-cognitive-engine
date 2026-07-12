'use client';

/**
 * EmployerBrowser — the NPC employer directory for a career track (checklist
 * item 6, docs/lens-specs/careers-capability-map.md: "Originate a new
 * contract offer to an NPC/employer from the lens itself"). Lists real NPCs
 * (`careers.employers` → server/lib/career-employers.js, a READ-ONLY
 * archetype-derived directory over world_npcs — never fabricated data) who
 * plausibly hire for the given track, and lets the player originate a NEW
 * contract offer to one of them via the real `careers.offer` macro (a
 * designed propose-terms flow, never a raw JSON-paste form).
 *
 * The server computes the player's own reputation for the gate check itself
 * (domains/careers.js#offer overrides any client-supplied workerReputation
 * for the self-worker path), so a low-reputation offer surfaces an honest
 * 'reputation_too_low' rejection rather than silently succeeding.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';

// server/lib/career-employers.js#findEmployers — one NPC's real employer
// listing for a track (archetype-derived, never fabricated).
export interface EmployerListing {
  npcId: string;
  name: string;
  archetype: string;
  faction: string | null;
  trackId: string;
  category: string | null;
  tier: number;
  tierTitle: string | null;
  suggestedWage: number | null;
  level: number;
}

interface Props {
  trackId: string;
  /** Called after a contract offer is successfully sent, so the caller can refresh its contracts list. */
  onContractProposed?: () => void;
}

export function EmployerBrowser({ trackId, onContractProposed }: Props) {
  const { user } = useAuth();
  const addToast = useUIStore((s) => s.addToast);
  const [employers, setEmployers] = useState<EmployerListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [proposingFor, setProposingFor] = useState<string | null>(null);
  const [terms, setTerms] = useState<Record<string, { baseWage: string; signingBonus: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; employers?: EmployerListing[] }>('careers', 'employers', { trackId: tid })).data.result;
      setEmployers(r?.employers || []);
    } catch {
      setEmployers([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (trackId) void load(trackId); }, [trackId, load]);

  const propose = useCallback(async (npc: EmployerListing) => {
    if (!user?.id) {
      addToast({ type: 'error', message: 'Sign in to propose a contract.' });
      return;
    }
    const t = terms[npc.npcId] || { baseWage: '', signingBonus: '' };
    const baseWage = Number(t.baseWage);
    const signingBonus = Number(t.signingBonus);
    setBusy(npc.npcId);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string; contractId?: string }>('careers', 'offer', {
        employerKind: 'npc', employerId: npc.npcId,
        workerKind: 'player', workerId: user.id,
        trackId: npc.trackId, tier: npc.tier, role: npc.tierTitle || undefined,
        baseWage: Number.isFinite(baseWage) && baseWage >= 0 ? baseWage : (npc.suggestedWage ?? 0),
        signingBonus: Number.isFinite(signingBonus) && signingBonus >= 0 ? signingBonus : 0,
        durationDays: 30,
      })).data.result;
      if (r?.ok) {
        addToast({ type: 'success', message: `Contract offer sent to ${npc.name}.`, duration: 2500 });
        setProposingFor(null);
        onContractProposed?.();
      } else {
        addToast({ type: 'error', message: `Couldn't propose a contract: ${r?.reason || 'failed'}.` });
      }
    } catch {
      addToast({ type: 'error', message: 'Contract offer failed — please try again.' });
    } finally {
      setBusy(null);
    }
  }, [terms, user, addToast, onContractProposed]);

  return (
    <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4" aria-label="Employers hiring">
      <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1">
        <Users className="w-4 h-4" aria-hidden="true" /> Employers hiring — {trackId}
      </h2>
      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-xs flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Finding employers…
        </div>
      ) : employers.length === 0 ? (
        <p className="text-gray-500 text-xs">No NPCs are currently hiring for {trackId} in this world.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {employers.map((npc) => (
            <li key={npc.npcId} className="bg-black/30 border border-white/10 rounded px-2 py-1.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <span className="text-gray-100">
                  {npc.name} <span className="text-gray-500">· {npc.archetype}{npc.faction ? ` · ${npc.faction}` : ''}</span>
                </span>
                <span className="text-amber-200 tabular-nums">tier {npc.tier}{npc.tierTitle ? ` · ${npc.tierTitle}` : ''} · {npc.suggestedWage ?? 0} sparks/shift</span>
              </div>
              {proposingFor === npc.npcId ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-1.5">
                  <label className="sr-only" htmlFor={`propose-wage-${npc.npcId}`}>Base wage offered to {npc.name}</label>
                  <input
                    id={`propose-wage-${npc.npcId}`} type="number" min={0}
                    aria-label={`Base wage offered to ${npc.name}`}
                    placeholder={String(npc.suggestedWage ?? 0)}
                    value={terms[npc.npcId]?.baseWage ?? ''}
                    onChange={(e) => setTerms((m) => ({ ...m, [npc.npcId]: { baseWage: e.target.value, signingBonus: m[npc.npcId]?.signingBonus ?? '' } }))}
                    className="w-16 px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-gray-100"
                  />
                  <label className="sr-only" htmlFor={`propose-bonus-${npc.npcId}`}>Signing bonus offered to {npc.name}</label>
                  <input
                    id={`propose-bonus-${npc.npcId}`} type="number" min={0}
                    aria-label={`Signing bonus offered to ${npc.name}`}
                    placeholder="0"
                    value={terms[npc.npcId]?.signingBonus ?? ''}
                    onChange={(e) => setTerms((m) => ({ ...m, [npc.npcId]: { baseWage: m[npc.npcId]?.baseWage ?? '', signingBonus: e.target.value } }))}
                    className="w-14 px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-gray-100"
                  />
                  <button
                    onClick={() => void propose(npc)}
                    disabled={busy === npc.npcId}
                    aria-label={`Send contract offer to ${npc.name}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/70 hover:bg-emerald-600 text-emerald-50 disabled:opacity-50"
                  ><Send className="w-3 h-3" aria-hidden="true" /> {busy === npc.npcId ? 'Sending…' : 'Send offer'}</button>
                  <button onClick={() => setProposingFor(null)} aria-label="Cancel proposing a contract" className="text-gray-500 hover:text-gray-300">cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setProposingFor(npc.npcId)}
                  aria-label={`Propose a contract to ${npc.name}`}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/70 hover:bg-amber-600 text-amber-50"
                ><Send className="w-3 h-3" aria-hidden="true" /> Propose contract</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
