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
 *
 * Each expanded case also carries a "Drafts & Citations" sub-panel wired
 * id-scoped to `law.draft` / `law.cite` (`server.js:40502-40515`) via
 * `useRunArtifact('law').mutateAsync({ id: item.id, action, params })` —
 * these two macros mutate a real artifact's `data.drafts[]` /
 * `data.citations[]` IN PLACE, but only when called against a specific
 * artifact id; called generically they'd land on a throwaway artifact and
 * be discarded. `item.id` is the same real case-file artifact id this
 * component already reads/writes via `useLensData` above, so drafts and
 * citations attach to the actual matter the user is looking at. See
 * docs/lens-specs/law-capability-map.md's "Draft + citation logging per
 * contract/matter" disposition.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ChevronRight, Globe, Calendar, CheckCircle, Briefcase, Gavel, Check,
  FileText, Quote, Loader2,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import type { CaseFileSummary, CaseOutcome, CaseStatus, CaseType, Jurisdiction } from './case-types';
import { JURISDICTIONS, CASE_STATUSES, CASE_TYPES, CASE_OUTCOMES, STATUS_COLORS, JURISDICTION_COLORS, OUTCOME_COLORS } from './case-types';

interface TimelineStep { label: string; date: string; done: boolean }
/** Real shape returned by `law.draft` (server.js:40502) — appended to `artifact.data.drafts[]`. */
interface CaseDraft { id: string; caseId: string; title: string; body: string; version: number; status: string; createdAt: string }
/** Real shape returned by `law.cite` (server.js:40509) — appended to `artifact.data.citations[]`. */
interface CaseCitation { id: string; source: string; text: string; relevance: number; addedAt: string }
interface CaseData {
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  deadline: string | null;
  outcome: CaseOutcome;
  judge: string | null;
  closedAt: string | null;
  timeline: TimelineStep[];
  drafts?: CaseDraft[];
  citations?: CaseCitation[];
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
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [citeSource, setCiteSource] = useState('');
  const [citeText, setCiteText] = useState('');
  const [lawActionBusy, setLawActionBusy] = useState<'draft' | 'cite' | null>(null);
  const [lawActionError, setLawActionError] = useState<string | null>(null);
  const caseSearchInputRef = useRef<HTMLInputElement>(null);
  const newCaseInputRef = useRef<HTMLInputElement>(null);

  const { isLoading, isError, error, refetch, items: caseItems, create: createCase, update: updateCase } =
    useLensData<CaseData>('law', 'case', { noSeed: true });

  // `law.draft` / `law.cite` (server.js:40502-40515) mutate a real, live
  // artifact's `data.drafts[]` / `data.citations[]` in place — but ONLY
  // when called id-scoped against a specific case-file artifact (POST
  // /api/lens/law/:id/run). Called generically, the mutation would land on
  // a throwaway `{id:null}` virtual artifact and be silently discarded —
  // see docs/lens-specs/law-capability-map.md's "Draft + citation logging
  // per contract/matter" disposition. `item.id` below is that real case's
  // artifact id (the same id `useLensData` reads/writes above).
  const runLawAction = useRunArtifact('law');

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

  function resetLawActionForms() {
    setDraftTitle('');
    setDraftBody('');
    setCiteSource('');
    setCiteText('');
    setLawActionError(null);
  }

  async function addDraft(item: (typeof caseItems)[number]) {
    if (!draftTitle.trim()) return;
    setLawActionBusy('draft');
    setLawActionError(null);
    try {
      // law.draft params: { title, body } → { ok, draft:{id,caseId,title,body,version,status,createdAt} }
      await runLawAction.mutateAsync({
        id: item.id,
        action: 'draft',
        params: { title: draftTitle.trim(), body: draftBody.trim() },
      });
      setDraftTitle('');
      setDraftBody('');
    } catch (e) {
      setLawActionError(e instanceof Error ? e.message : 'Could not save draft.');
    } finally {
      setLawActionBusy(null);
    }
  }

  async function addCitation(item: (typeof caseItems)[number]) {
    if (!citeSource.trim() || !citeText.trim()) return;
    setLawActionBusy('cite');
    setLawActionError(null);
    try {
      // law.cite params: { source, text, relevance } → { ok, citation:{id,source,text,relevance,addedAt} }
      await runLawAction.mutateAsync({
        id: item.id,
        action: 'cite',
        params: { source: citeSource.trim(), text: citeText.trim(), relevance: 0.8 },
      });
      setCiteSource('');
      setCiteText('');
    } catch (e) {
      setLawActionError(e instanceof Error ? e.message : 'Could not save citation.');
    } finally {
      setLawActionBusy(null);
    }
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
                  onClick={() => { setExpandedCase(isExpanded ? null : item.id); setEditJudge(judge || ''); resetLawActionForms(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedCase(isExpanded ? null : item.id);
                      setEditJudge(judge || '');
                      resetLawActionForms();
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

                      {/* Drafts & Citations — law.draft / law.cite, id-scoped to THIS case's real artifact */}
                      <div className="pt-2 border-t border-white/10 space-y-2">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Drafts &amp; Citations
                        </p>

                        {((item.data?.drafts?.length ?? 0) > 0 || (item.data?.citations?.length ?? 0) > 0) ? (
                          <div className="space-y-1">
                            {(item.data?.drafts || []).map((d) => (
                              <div key={d.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-white/5 border border-white/10">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <FileText className="w-3 h-3 text-neon-purple shrink-0" />
                                  <span className="truncate text-white">{d.title}</span>
                                  <span className="text-[9px] text-gray-500 shrink-0">v{d.version}</span>
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-400 shrink-0 capitalize">{d.status}</span>
                              </div>
                            ))}
                            {(item.data?.citations || []).map((c) => (
                              <div key={c.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-white/5 border border-white/10">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <Quote className="w-3 h-3 text-neon-cyan shrink-0" />
                                  <span className="truncate text-white">{c.source}</span>
                                  <span className="truncate text-gray-400">— {c.text}</span>
                                </span>
                                <span className="text-[9px] text-gray-500 shrink-0">{Math.round(c.relevance * 100)}%</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-500">No drafts or citations logged for this case yet.</p>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="text-[10px] text-gray-400 flex flex-col gap-1">
                            New draft
                            <div className="flex gap-1">
                              <input
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                placeholder="Draft title…"
                                className={cn(ds.input, 'text-xs py-1 flex-1 min-w-0')}
                              />
                              <input
                                value={draftBody}
                                onChange={(e) => setDraftBody(e.target.value)}
                                placeholder="Body (optional)…"
                                className={cn(ds.input, 'text-xs py-1 flex-1 min-w-0')}
                              />
                              <button
                                onClick={() => addDraft(item)}
                                disabled={!draftTitle.trim() || lawActionBusy === 'draft'}
                                aria-label="Add draft"
                                className="px-1.5 rounded bg-neon-purple/15 text-neon-purple hover:bg-neon-purple/25 disabled:opacity-40 shrink-0"
                              >
                                {lawActionBusy === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>
                          <div className="text-[10px] text-gray-400 flex flex-col gap-1">
                            New citation
                            <div className="flex gap-1">
                              <input
                                value={citeSource}
                                onChange={(e) => setCiteSource(e.target.value)}
                                placeholder="Source (e.g. 347 U.S. 483)…"
                                className={cn(ds.input, 'text-xs py-1 flex-1 min-w-0')}
                              />
                              <input
                                value={citeText}
                                onChange={(e) => setCiteText(e.target.value)}
                                placeholder="Citation text…"
                                className={cn(ds.input, 'text-xs py-1 flex-1 min-w-0')}
                              />
                              <button
                                onClick={() => addCitation(item)}
                                disabled={!citeSource.trim() || !citeText.trim() || lawActionBusy === 'cite'}
                                aria-label="Add citation"
                                className="px-1.5 rounded bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 disabled:opacity-40 shrink-0"
                              >
                                {lawActionBusy === 'cite' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {lawActionError && (
                          <p className="text-[10px] text-red-400">{lawActionError}</p>
                        )}
                      </div>
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
