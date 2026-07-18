'use client';

/**
 * ProtocolsPanel — curated clinical protocol reference library + patient
 * condition matching.
 *
 * Backend: healthcare.protocols-list (browse the library) and
 * healthcare.protocolMatch (match a patient's active conditions against it).
 * The library itself is real, cited, published clinical guidance
 * (content/healthcare-protocols.json — ADA, AHA/ACC, IDSA/ATS, Surviving
 * Sepsis Campaign, GINA, GOLD, AAP, ACP, AHS, KDIGO, WAO) — every card shows
 * its source prominently, on purpose, per the honest-by-construction
 * invariant: this is reference material, not authoritative real-time
 * clinical decision support.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Loader2, CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp,
  ClipboardCheck, ListChecks,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

interface Protocol {
  id: string;
  name: string;
  specialty?: string;
  source: string;
  triggerConditions: string[];
  triggerConditionLabels?: Record<string, string>;
  steps: string[];
}

interface MatchResult {
  protocolId: string;
  name: string;
  source: string | null;
  specialty: string | null;
  matchRatio: number;
  steps?: string[];
  matchedConditions: string[];
  missingConditions?: string[];
}

interface Problem { id: string; name: string; icd10: string; status: 'active' | 'resolved' | 'inactive' }

export function ProtocolsPanel({ patientId }: { patientId?: string | null }) {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [conditions, setConditions] = useState<Problem[]>([]);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matched, setMatched] = useState<MatchResult[] | null>(null);
  const [partial, setPartial] = useState<MatchResult[] | null>(null);

  const loadLibrary = useCallback(async (specialty: string) => {
    setLoadingLibrary(true);
    try {
      const r = await lensRun('healthcare', 'protocols-list', specialty ? { specialty } : {});
      const result = r.data?.result as { protocols?: Protocol[]; specialties?: string[] } | null;
      if (r.data?.ok && result) {
        setProtocols(result.protocols || []);
        setSpecialties(result.specialties || []);
      }
    } catch {
      /* library stays empty; card area shows an honest empty state below */
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => { loadLibrary(specialtyFilter); }, [specialtyFilter, loadLibrary]);

  useEffect(() => {
    let cancelled = false;
    setMatched(null);
    setPartial(null);
    setMatchError(null);
    if (!patientId) { setConditions([]); return; }
    lensRun('healthcare', 'patients-detail', { id: patientId }).then((r) => {
      if (cancelled) return;
      const problems = (r.data?.result as { problems?: Problem[] } | null)?.problems || [];
      setConditions(problems.filter((p) => p.status === 'active' && p.icd10));
    }).catch(() => { if (!cancelled) setConditions([]); });
    return () => { cancelled = true; };
  }, [patientId]);

  async function runMatch() {
    if (!patientId || conditions.length === 0) return;
    setMatching(true);
    setMatchError(null);
    setMatched(null);
    setPartial(null);
    try {
      const r = await lensRun('healthcare', 'protocolMatch', { conditions: conditions.map((c) => c.icd10) });
      const result = r.data?.result as { matched?: MatchResult[]; partial?: MatchResult[] } | null;
      if (r.data?.ok && result) {
        setMatched(result.matched || []);
        setPartial(result.partial || []);
      } else {
        setMatchError((r.data as { error?: string } | null)?.error || 'Protocol match failed');
      }
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : 'Protocol match failed');
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Honest disclaimer — always visible near the library, never buried. */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg">
        <Info className="w-3.5 h-3.5 text-amber-300 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-200/90 leading-relaxed">
          Reference protocols summarized from published clinical guidelines; not a substitute for professional
          medical judgment. Every protocol below cites its real source organization and guideline — Concord is a
          knowledge platform, not authoritative real-time bedside clinical decision support.
        </p>
      </div>

      {/* Patient condition match */}
      <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Match against active conditions</span>
        </header>
        <div className="p-3">
          {!patientId && (
            <div className="text-xs text-gray-400 text-center py-4">
              Select a patient (Patients tab) to match their active problem list against the protocol library.
            </div>
          )}
          {patientId && conditions.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-4">
              This patient has no active problems with an ICD-10 code on record — add one on the Chart tab to enable matching.
            </div>
          )}
          {patientId && conditions.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">Active conditions:</span>
                {conditions.map((c) => (
                  <span key={c.id} className="px-2 py-0.5 text-[10px] font-mono rounded bg-cyan-500/10 text-cyan-200 border border-cyan-500/20">
                    {c.icd10} · {c.name}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={runMatch}
                  disabled={matching}
                  className="ml-auto px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"
                >
                  {matching ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}
                  Run protocol match
                </button>
              </div>

              {matchError && <div className="text-xs text-rose-300 px-2 py-1.5 bg-rose-500/10 rounded">{matchError}</div>}

              {matched && matched.length === 0 && partial && partial.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-4">
                  No library protocol triggers on this patient&rsquo;s current active condition set.
                </div>
              )}

              {matched && matched.length > 0 && (
                <div className="space-y-2 mb-3">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold">Full matches</div>
                  {matched.map((m) => <MatchCard key={m.protocolId} match={m} full />)}
                </div>
              )}
              {partial && partial.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Partial matches</div>
                  {partial.map((m) => <MatchCard key={m.protocolId} match={m} full={false} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Browse library */}
      <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2 flex-wrap">
          <BookOpen className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Protocol library</span>
          <span className="text-[10px] text-gray-500">({protocols.length})</span>
          <select
            value={specialtyFilter}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
            className="ml-auto px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="">All specialties</option>
            {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </header>
        <div className="p-3">
          {loadingLibrary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-white/10 rounded p-3 bg-black/30">
                  <Skeleton variant="line" width="70%" height="0.875rem" className="mb-2" />
                  <Skeleton variant="line" lines={2} />
                </div>
              ))}
            </div>
          )}
          {!loadingLibrary && protocols.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-8">No protocols in the library for this filter.</div>
          )}
          {!loadingLibrary && protocols.length > 0 && (
            <ul className="space-y-2">
              {protocols.map((p) => {
                const open = expandedId === p.id;
                return (
                  <li key={p.id} className="border border-white/10 rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]"
                    >
                      {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-100 truncate">{p.name}</div>
                        <div className="text-[10px] text-gray-500 truncate">{p.source}</div>
                      </div>
                      {p.specialty && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 shrink-0">{p.specialty}</span>
                      )}
                    </button>
                    {open && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/5">
                        <div className="text-[10px] text-cyan-300/90 mb-2">
                          Source: <span className="text-gray-300">{p.source}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {p.triggerConditions.map((code) => (
                            <span key={code} title={p.triggerConditionLabels?.[code]} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/5 text-gray-300 border border-white/10">
                              {code}{p.triggerConditionLabels?.[code] ? ` · ${p.triggerConditionLabels[code]}` : ''}
                            </span>
                          ))}
                        </div>
                        <ol className="list-decimal list-inside space-y-1">
                          {p.steps.map((s, i) => (
                            <li key={i} className="text-xs text-gray-300 leading-relaxed">{s}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchCard({ match, full }: { match: MatchResult; full: boolean }) {
  return (
    <div className={cn('px-3 py-2.5 rounded border', full ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-amber-500/10 border-amber-500/25')}>
      <div className="flex items-start gap-2">
        {full ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-100">{match.name}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-white/10 text-gray-300">
              {Math.round(match.matchRatio * 100)}% match
            </span>
          </div>
          {/* Source is always shown, never hidden — this is what makes the match honest. */}
          <div className="text-[10px] text-cyan-300/90 mt-0.5">Source: <span className="text-gray-300">{match.source || 'unattributed protocol'}</span></div>
          {!full && match.missingConditions && match.missingConditions.length > 0 && (
            <div className="text-[10px] text-amber-200/80 mt-1">
              Missing to fully trigger: {match.missingConditions.join(', ')}
            </div>
          )}
          {full && match.steps && match.steps.length > 0 && (
            <ol className="list-decimal list-inside space-y-1 mt-2">
              {match.steps.map((s, i) => <li key={i} className="text-xs text-gray-300 leading-relaxed">{s}</li>)}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProtocolsPanel;
