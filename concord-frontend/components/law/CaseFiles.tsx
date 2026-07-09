'use client';

/**
 * CaseFiles — per-user case-file tracker: title, jurisdiction, case type,
 * filing deadline, outcome, judge, and a lifecycle timeline. Real,
 * per-user persisted data via `useLensData('law', 'case', ...)` (the
 * generic lens-artifact repository — NOT the Ironclad-shape STATE-backed
 * contract substrate `LawContracts` wires). This is the substrate the
 * Analytics tab's `caseAnalysis` / `deadlineTracker` macros run against —
 * no separate JSON-artifact upload required.
 *
 * `filedDate` is the record's real `createdAt`. `closedDate` is stamped at
 * the real moment a case is marked closed (`data.closedAt`, set inline by
 * `setStatus` when transitioning to `closed`) — never backfilled or
 * guessed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ChevronRight, Globe, Calendar, CheckCircle, Briefcase, Gavel, Check,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import type { CaseFileSummary, CaseOutcome, CaseStatus, CaseType, Jurisdiction } from './case-types';
import { JURISDICTIONS, CASE_STATUSES, CASE_TYPES, CASE_OUTCOMES, STATUS_COLORS, JURISDICTION_COLORS, OUTCOME_COLORS } from './case-types';

interface TimelineStep { label: string; date: string; done: boolean }
interface CaseData {
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  deadline: string | null;
  outcome: CaseOutcome;
  judge: string | null;
  closedAt: string | null;
  timeline: TimelineStep[];
}

function deadlineDays(deadlineStr: string): number | null {
  if (!deadlineStr) return null;
  const diff = new Date(deadlineStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function CaseFiles({ onCasesChange }: { onCasesChange?: (cases: CaseFileSummary[]) => void }) {
  const [newTitle, setNewTitle] = useState('');
  const [newJurisdiction, setNewJurisdiction] = useState<Jurisdiction>('US');
  const [newCaseType, setNewCaseType] = useState<CaseType>('litigation');
  const [newDeadline, setNewDeadline] = useState('');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [jurisdictionFilter, setJurisdictionFilter] = useState<Jurisdiction | 'all'>('all');
  const [editJudge, setEditJudge] = useState('');
  const caseSearchInputRef = useRef<HTMLInputElement>(null);
  const newCaseInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch, items: caseItems, create: createCase, update: updateCase } =
    useLensData<CaseData>('law', 'case', { noSeed: true });

  const summaries: CaseFileSummary[] = useMemo(
    () =>
      caseItems.map((item) => ({
        id: item.id,
        title: item.title,
        jurisdiction: (item.data?.jurisdiction as Jurisdiction) || 'US',
        caseType: (item.data?.caseType as CaseType) || 'litigation',
        status: (item.meta?.status as CaseStatus) || 'open',
        outcome: (item.data?.outcome as CaseOutcome) || 'pending',
        judge: item.data?.judge || null,
        deadline: item.data?.deadline || null,
        filedDate: item.createdAt,
        closedDate: item.data?.closedAt || null,
      })),
    [caseItems]
  );

  useEffect(() => {
    onCasesChange?.(summaries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries]);

  const visibleCases = useMemo(() => {
    const q = caseSearch.trim().toLowerCase();
    return caseItems.filter((item) => {
      const status = (item.meta?.status as CaseStatus) || 'open';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      const jurisdiction = (item.data?.jurisdiction as Jurisdiction) || 'US';
      if (jurisdictionFilter !== 'all' && jurisdiction !== jurisdictionFilter) return false;
      if (q && !(item.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [caseItems, caseSearch, statusFilter, jurisdictionFilter]);

  function handleCreateCase() {
    if (!newTitle.trim()) return;
    createCase({
      title: newTitle,
      data: {
        jurisdiction: newJurisdiction,
        caseType: newCaseType,
        deadline: newDeadline || null,
        outcome: 'pending',
        judge: null,
        closedAt: null,
        timeline: [
          { label: 'Filed', date: new Date().toISOString(), done: true },
          { label: 'Review', date: '', done: false },
          { label: 'Hearing', date: '', done: false },
          { label: 'Ruling', date: '', done: false },
        ],
      },
      meta: { status: 'open' },
    });
    setNewTitle('');
    setNewDeadline('');
  }

  async function setStatus(item: (typeof caseItems)[number], status: CaseStatus) {
    const closedAt = status === 'closed' ? new Date().toISOString() : item.data?.closedAt || null;
    await updateCase(item.id, { meta: { status }, data: { ...item.data, closedAt } });
  }

  async function setOutcome(item: (typeof caseItems)[number], outcome: CaseOutcome) {
    await updateCase(item.id, { data: { ...item.data, outcome } });
  }

  async function saveJudge(item: (typeof caseItems)[number]) {
    await updateCase(item.id, { data: { ...item.data, judge: editJudge.trim() || null } });
    setEditJudge('');
  }

  if (isLoading) {
    return (
      <div className={ds.panel}>
        <Skeleton variant="line" lines={4} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState message={error?.message || 'Could not load case files.'} onRetry={refetch} />;
  }

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-neon-cyan" />
        <h2 className="font-semibold text-white">Case Files</h2>
        <span className="text-[10px] text-gray-400">your matters — feeds Analytics &amp; Tools</span>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={caseSearchInputRef}
            type="text"
            value={caseSearch}
            onChange={(e) => setCaseSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setCaseSearch(''); caseSearchInputRef.current?.blur(); }
            }}
            placeholder="Search cases by title…  / focuses"
            className={cn(ds.input, 'flex-1 min-w-[200px] text-sm py-1.5')}
          />
          <select
            value={jurisdictionFilter}
            onChange={(e) => setJurisdictionFilter(e.target.value as Jurisdiction | 'all')}
            className={cn(ds.select, 'w-auto text-sm py-1.5')}
            title="Filter by jurisdiction"
          >
            <option value="all">All jurisdictions</option>
            {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          {(caseSearch || statusFilter !== 'all' || jurisdictionFilter !== 'all') && (
            <span className="text-[10px] text-gray-400 whitespace-nowrap">
              {visibleCases.length} of {caseItems.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              'text-[10px] px-2 py-1 rounded border font-medium transition-colors',
              statusFilter === 'all' ? 'bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan' : 'bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-white/5'
            )}
          >
            all <kbd className="text-[8px] opacity-60 ml-0.5">0</kbd>
          </button>
          {CASE_STATUSES.map((s, i) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'text-[10px] px-2 py-1 rounded border font-medium transition-colors',
                statusFilter === s ? STATUS_COLORS[s] : 'bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-white/5'
              )}
            >
              {s}<kbd className="text-[8px] opacity-60 ml-0.5">{i + 1}</kbd>
            </button>
          ))}
        </div>
      </div>

      {/* New case form */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input
          ref={newCaseInputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Case title…  n focuses"
          className={cn(ds.input, 'md:col-span-2 text-sm py-1.5')}
        />
        <select value={newJurisdiction} onChange={(e) => setNewJurisdiction(e.target.value as Jurisdiction)} className={cn(ds.select, 'text-sm py-1.5')}>
          {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <select value={newCaseType} onChange={(e) => setNewCaseType(e.target.value as CaseType)} className={cn(ds.select, 'text-sm py-1.5 capitalize')}>
          {CASE_TYPES.map((t) => <option key={t} value={t}>{t.replace('-', ' ')}</option>)}
        </select>
        <div className="flex gap-2">
          <input
            type="date"
            value={newDeadline}
            onChange={(e) => setNewDeadline(e.target.value)}
            className={cn(ds.input, 'flex-1 text-xs py-1.5')}
            title="Filing deadline"
          />
          <button onClick={handleCreateCase} className="px-3 py-1.5 rounded bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 border border-neon-cyan/40" aria-label="Add case">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {caseItems.length === 0 ? (
          <EmptyState
            compact
            icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
            title="No case files yet."
            description="Add your first matter above — it becomes the real input for case analysis and deadline tracking in the Analytics tab."
            ariaLabel="Case files empty"
          />
        ) : visibleCases.length === 0 ? (
          <p className="text-center py-4 text-gray-400 text-sm">No cases match the current filters.</p>
        ) : (
          visibleCases.map((item) => {
            const jurisdiction = (item.data?.jurisdiction as Jurisdiction) || 'US';
            const caseType = (item.data?.caseType as CaseType) || 'litigation';
            const outcome = (item.data?.outcome as CaseOutcome) || 'pending';
            const judge = item.data?.judge || null;
            const deadline = item.data?.deadline || null;
            const timeline = item.data?.timeline || [];
            const status = (item.meta?.status as CaseStatus) || 'open';
            const daysLeft = deadline ? deadlineDays(deadline) : null;
            const isExpanded = expandedCase === item.id;

            return (
              <motion.div key={item.id} layout className="rounded-lg border border-lattice-border bg-lattice-surface overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => { setExpandedCase(isExpanded ? null : item.id); setEditJudge(judge || ''); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedCase(isExpanded ? null : item.id);
                      setEditJudge(judge || '');
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform', isExpanded && 'rotate-90')} />
                    <p className="font-medium text-sm text-white">{item.title}</p>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-1', JURISDICTION_COLORS[jurisdiction] || JURISDICTION_COLORS.US)}>
                      <Globe className="w-2.5 h-2.5" />{jurisdiction}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-300 capitalize">{caseType.replace('-', ' ')}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', STATUS_COLORS[status] || STATUS_COLORS.open)}>{status}</span>
                    {outcome !== 'pending' && (
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize', OUTCOME_COLORS[outcome])}>{outcome}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {daysLeft !== null && (
                      <span
                        className={cn(
                          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border',
                          daysLeft <= 3 ? 'bg-red-400/15 border-red-400/30 text-red-400' : daysLeft <= 14 ? 'bg-yellow-400/15 border-yellow-400/30 text-yellow-400' : 'bg-gray-600/20 border-gray-600/30 text-gray-400'
                        )}
                      >
                        <Calendar className="w-2.5 h-2.5" />
                        {daysLeft > 0 ? `${daysLeft}d` : daysLeft === 0 ? 'Today' : 'Overdue'}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-white/10 px-4 py-3 overflow-hidden space-y-3"
                    >
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">Case Timeline</p>
                      <div className="flex items-start gap-0">
                        {(timeline.length > 0 ? timeline : [
                          { label: 'Filed', date: '', done: true },
                          { label: 'Review', date: '', done: false },
                          { label: 'Hearing', date: '', done: false },
                          { label: 'Ruling', date: '', done: false },
                        ]).map((step, idx, arr) => (
                          <div key={step.label} className="flex-1 flex flex-col items-center">
                            <div className="flex items-center w-full">
                              {idx > 0 && <div className={cn('flex-1 h-0.5', step.done ? 'bg-neon-purple' : 'bg-white/10')} />}
                              <div
                                className={cn(
                                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2',
                                  step.done ? 'bg-neon-purple border-neon-purple' : idx === arr.findIndex((s) => !s.done) ? 'bg-yellow-400/20 border-yellow-400' : 'bg-black/40 border-white/20'
                                )}
                              >
                                {step.done ? <CheckCircle className="w-3 h-3 text-white" /> : <span className="w-2 h-2 rounded-full bg-white/20" />}
                              </div>
                              {idx < arr.length - 1 && <div className={cn('flex-1 h-0.5', arr[idx + 1]?.done ? 'bg-neon-purple' : 'bg-white/10')} />}
                            </div>
                            <p className={cn('text-[10px] mt-1.5 text-center', step.done ? 'text-neon-purple' : 'text-gray-400')}>{step.label}</p>
                          </div>
                        ))}
                      </div>

                      {deadline && (
                        <div
                          className={cn(
                            'p-2 rounded-lg flex items-center gap-2 text-xs',
                            (daysLeft ?? 99) <= 3 ? 'bg-red-400/10 border border-red-400/20 text-red-400' : 'bg-yellow-400/10 border border-yellow-400/20 text-yellow-400'
                          )}
                        >
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Filing deadline: {new Date(deadline).toLocaleDateString()}
                            {daysLeft !== null && (
                              <span className="font-semibold ml-1">
                                ({daysLeft > 0 ? `${daysLeft} days remaining` : daysLeft === 0 ? 'Due today' : 'OVERDUE'})
                              </span>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Outcome + judge + status editors — real fields that feed caseAnalysis */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 border-t border-white/10">
                        <label className="text-[10px] text-gray-400 flex flex-col gap-1">
                          Status
                          <select
                            value={status}
                            onChange={(e) => setStatus(item, e.target.value as CaseStatus)}
                            className={cn(ds.select, 'text-xs py-1')}
                          >
                            {CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-[10px] text-gray-400 flex flex-col gap-1">
                          Outcome
                          <select
                            value={outcome}
                            onChange={(e) => setOutcome(item, e.target.value as CaseOutcome)}
                            className={cn(ds.select, 'text-xs py-1 capitalize')}
                          >
                            {CASE_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </label>
                        <div className="text-[10px] text-gray-400 flex flex-col gap-1">
                          Judge
                          <div className="flex gap-1">
                            <input
                              value={editJudge}
                              onChange={(e) => setEditJudge(e.target.value)}
                              placeholder="Presiding judge"
                              className={cn(ds.input, 'text-xs py-1 flex-1')}
                            />
                            <button
                              onClick={() => saveJudge(item)}
                              aria-label="Save judge"
                              className="px-1.5 rounded bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {(judge || outcome !== 'pending') && (
                        <p className="text-[10px] text-gray-500 flex items-center gap-1">
                          <Gavel className="w-3 h-3" />
                          {judge ? `Presiding: ${judge}` : 'No judge recorded'}
                          {item.data?.closedAt && <span> · closed {new Date(item.data.closedAt).toLocaleDateString()}</span>}
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
