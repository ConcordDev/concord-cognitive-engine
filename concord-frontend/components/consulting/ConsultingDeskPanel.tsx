'use client';

/**
 * ConsultingDeskPanel — Engagements/Proposals/Deliverables/Clients/Timesheets/
 * Frameworks/Pipeline CRUD + dashboard + stats/pipeline strip.
 * Extracted from consulting/page.tsx consolidation.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Lightbulb, Briefcase, FileText, Users, Clock, DollarSign, Plus, Search, X,
  Trash2, Target, TrendingUp, ArrowRight, BookOpen, Star, Zap,
} from 'lucide-react';
import {
  type ModeTab, type Status, type ConsultingArtifact,
  STATUS_CONFIG, ENGAGEMENT_TYPES, ARTIFACT_TABS,
} from '@/components/consulting/consulting-shared';

interface PracticeTimeEntry { id: string; hours: number; note?: string; date: string; invoiceId?: string }
interface PracticeEngagement {
  id: string; name: string; client?: string; rate: number; status: string;
  timeEntries?: PracticeTimeEntry[]; loggedHours?: number;
}
interface PracticeProposal {
  id: string; title: string; client: string; value: number; status: string;
  completeness?: number; sectionCount?: number; filledCount?: number;
  signature?: { signerName: string; signedAt: string } | null;
}
interface PracticeData {
  engagements: PracticeEngagement[];
  proposals: PracticeProposal[];
  loggedHours: number;
  active: number;
  collected: number;
  outstanding: number;
}

const MODE_TABS = ARTIFACT_TABS.map((t) => ({
  ...t,
  icon:
    t.id === 'engagements' ? Briefcase
    : t.id === 'proposals' ? FileText
    : t.id === 'deliverables' ? Target
    : t.id === 'clients' ? Users
    : t.id === 'timesheets' ? Clock
    : t.id === 'frameworks' ? BookOpen
    : TrendingUp,
}));

export function ConsultingDeskPanel({ mode }: { mode: ModeTab | 'dashboard' }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ConsultingArtifact> | null>(null);
  
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('draft');
  const [formNotes, setFormNotes] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formEngType, setFormEngType] = useState('Strategy');
  const [formFee, setFormFee] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formScope, setFormScope] = useState('');

  const deskMode = mode === 'dashboard' ? 'engagements' : mode;
  const activeArtifactType =
    MODE_TABS.find((t) => t.id === deskMode)?.artifactType || 'Engagement';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ConsultingArtifact>('consulting', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('consulting');

  // F3/F4: the header, pipeline, Time records and Proposal archive read the
  // PRACTICE store (the same store the practice panels write to), not the
  // freeform artifact store. One store, read everywhere.
  const [practice, setPractice] = useState<PracticeData | null>(null);
  const [practiceError, setPracticeError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dashR, invR, engR, propR] = await Promise.all([
          lensRun('consulting', 'consulting-dashboard', {}),
          lensRun('consulting', 'invoice-list', {}),
          lensRun('consulting', 'engagement-list', {}),
          lensRun('consulting', 'proposal-list', {}),
        ]);
        const dash = dashR.data?.result as { active?: number; loggedHours?: number } | null;
        const inv = invR.data?.result as { collected?: number; outstanding?: number } | null;
        const eng = engR.data?.result as { engagements?: PracticeEngagement[] } | null;
        const prop = propR.data?.result as { proposals?: PracticeProposal[] } | null;
        if (cancelled) return;
        const engagements = eng?.engagements || [];
        setPractice({
          engagements,
          proposals: prop?.proposals || [],
          loggedHours: dash?.loggedHours ?? engagements.reduce((s, e) => s + (e.loggedHours || 0), 0),
          active: dash?.active ?? engagements.filter((e) => e.status === 'active').length,
          collected: inv?.collected || 0,
          outstanding: inv?.outstanding || 0,
        });
      } catch {
        if (!cancelled) setPracticeError('Practice records could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const practiceTimeEntries = useMemo(
    () =>
      (practice?.engagements || []).flatMap((e) =>
        (e.timeEntries || []).map((t) => ({ ...t, engagementName: e.name, engagementId: e.id }))
      ),
    [practice]
  );

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as ConsultingArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter(
        (i) => (i.data as unknown as ConsultingArtifact).status === filterStatus
      );
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || filtered[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [filtered, runAction]
  );

  const openCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormDescription('');
    setFormStatus('draft');
    setFormNotes('');
    setFormClient('');
    setFormEngType('Strategy');
    setFormFee('');
    setFormRate('');
    setFormStartDate('');
    setFormEndDate('');
    setFormScope('');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<ConsultingArtifact>) => {
    const d = item.data as unknown as ConsultingArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'draft');
    setFormNotes(d.notes || '');
    setFormClient(d.client || '');
    setFormEngType(d.engagementType || 'Strategy');
    setFormFee(d.totalFee?.toString() || '');
    setFormRate(d.hourlyRate?.toString() || '');
    setFormStartDate(d.startDate || '');
    setFormEndDate(d.endDate || '');
    setFormScope(d.scope || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      client: formClient,
      engagementType: formEngType,
      totalFee: formFee ? parseFloat(formFee) : undefined,
      hourlyRate: formRate ? parseFloat(formRate) : undefined,
      startDate: formStartDate,
      endDate: formEndDate,
      scope: formScope,
    };
    if (editingItem)
      await update(editingItem.id, {
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    else
      await create({
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    setEditorOpen(false);
  };

  const renderDashboard = () => {
    // Practice-store figures (F3): collected revenue, logged hours, active
    // engagements, outstanding invoices — the same numbers the header shows.
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Total Revenue</p>
          <p className="text-xl font-bold text-white">${(practice?.collected || 0).toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Clock className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Billed Hours</p>
          <p className="text-xl font-bold text-white">{(practice?.loggedHours || 0).toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Briefcase className="w-5 h-5 text-purple-400 mb-2" />
          <p className={ds.textMuted}>Active Engagements</p>
          <p className="text-xl font-bold text-white">{practice?.active || 0}</p>
        </div>
        <div className={ds.panel}>
          <TrendingUp className="w-5 h-5 text-cyan-400 mb-2" />
          <p className={ds.textMuted}>Outstanding</p>
          <p className="text-xl font-bold text-white">${(practice?.outstanding || 0).toLocaleString()}</p>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setEditorOpen(false)} role="button" tabIndex={0}>
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()} role="button" tabIndex={0}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType}
            </h2>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={ds.label}>Name</label>
              <input
                className={ds.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Status</label>
              <select aria-label="Status"
                className={cn(ds.select, 'min-h-11')}
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as Status)}
              >
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ds.label}>Client</label>
              <input
                className={ds.input}
                value={formClient}
                onChange={(e) => setFormClient(e.target.value)}
              />
            </div>
            {activeArtifactType === 'Engagement' && (
              <>
                <div>
                  <label className={ds.label}>Engagement Type</label>
                  <select aria-label="Engagement type"
                    className={cn(ds.select, 'min-h-11')}
                    value={formEngType}
                    onChange={(e) => setFormEngType(e.target.value)}
                  >
                    {ENGAGEMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Total Fee</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formFee}
                    onChange={(e) => setFormFee(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Hourly Rate</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Start</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>End</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Scope</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>
              Cancel
            </button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPracticeRecords = () => {
    if (practiceError) {
      return (
        <div className="flex items-center justify-center py-12" role="alert">
          <p className="text-sm text-rose-300">{practiceError}</p>
        </div>
      );
    }
    if (!practice) {
      return (
        <div className="flex items-center justify-center py-12" role="status" aria-busy="true">
          <p className="text-sm text-gray-400">Loading practice records…</p>
        </div>
      );
    }
    if (mode === 'timesheets') {
      const total = practiceTimeEntries.reduce((s, t) => s + (t.hours || 0), 0);
      return (
        <div className="space-y-3">
          <p className={cn(ds.textMuted, 'text-xs')}>
            Time logged in the practice panels appears here — one store, read everywhere.
            Log time from the Timer or Engagements. Total logged: {total.toLocaleString()}h.
          </p>
          {practiceTimeEntries.length === 0 ? (
            <div className={cn(ds.panel, 'text-center py-12')}>
              <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No time logged yet</p>
            </div>
          ) : (
            practiceTimeEntries.map((t) => (
              <div key={t.id} className={ds.panel}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-5 h-5 text-neon-cyan shrink-0" />
                    <div className="min-w-0">
                      <p className="text-white font-medium truncate">{t.engagementName}</p>
                      <p className={ds.textMuted}>
                        {t.date}
                        {t.note ? ` — ${t.note}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-white">{t.hours}h</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                      {t.invoiceId ? 'Billed' : 'Unbilled'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className={cn(ds.textMuted, 'text-xs')}>
          Proposals built in the practice rail are archived here — one store, read everywhere.
          Build and sign proposals from Proposals in the practice rail.
        </p>
        {practice.proposals.length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No proposals yet</p>
          </div>
        ) : (
          practice.proposals.map((p) => (
            <div key={p.id} className={ds.panel}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-neon-cyan shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{p.title}</p>
                    <p className={ds.textMuted}>
                      {p.client} · ${(p.value || 0).toLocaleString()} · {p.sectionCount ?? 0} sections ·{' '}
                      {p.completeness ?? 0}% complete · {p.status}
                    </p>
                    {p.signature && (
                      <p className="text-xs text-emerald-400">
                        Signed by {p.signature.signerName} on{' '}
                        {new Date(p.signature.signedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                {p.signature && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold shrink-0">
                    SIGNED
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      {mode === 'engagements' && (
        <p className={cn(ds.textMuted, 'text-xs')}>
          Freeform engagement briefs, scope notes, and fee terms — for engagement status
          and time tracking, open Engagements in the practice rail.
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            className={cn(ds.input, 'pl-10')}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select aria-label="Filter by status"
          className={cn(ds.select, 'w-auto min-h-11')}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Lightbulb className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, idx) => {
          const d = item.data as unknown as ConsultingArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.draft;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={ds.panelHover}
              onClick={() => openEdit(item)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Briefcase className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.client} {d.engagementType ? `- ${d.engagementType}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.totalFee && (
                    <span className="text-xs text-green-400">${d.totalFee.toLocaleString()}</span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}
                  >
                    {sc.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction('analyze', item.id);
                    }}
                    className={ds.btnGhost}
                  aria-label="Activate">
                    <Zap className="w-4 h-4 text-neon-cyan" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  aria-label="Delete">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  const isPracticeMode = mode === 'timesheets' || mode === 'proposals';

  if (isLoading && !isPracticeMode) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-busy="true">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading consulting data…</p>
        </div>
      </div>
    );
  }

  if (isError && !isPracticeMode) {
    return (
      <div className="flex items-center justify-center py-12" role="alert">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium text-white">Could not load consulting data</p>
          <p className="text-xs text-gray-400 max-w-sm">{error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => refetch()} className={ds.btnPrimary}>Try again</button>
        </div>
      </div>
    );
  }

  // Header figures come from the PRACTICE store (F3), never the artifact
  // editor's own fee fields: collected revenue, logged hours, active
  // engagements, average engagement rate, outstanding invoices.
  const practiceEngagements = practice?.engagements || [];
  const totalRevenue = practice?.collected || 0;
  const totalHours = practice?.loggedHours || 0;
  const activeCount = practice?.active || 0;
  const ratedEngagements = practiceEngagements.filter((e) => e.rate > 0);
  const avgRate =
    ratedEngagements.length > 0
      ? ratedEngagements.reduce((s, e) => s + e.rate, 0) / ratedEngagements.length
      : 0;
  const outstanding = practice?.outstanding || 0;

  return (
    <div className="space-y-4">
      {runAction.isPending && (
        <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, color: 'text-green-400' },
          { icon: Clock, label: 'Billed Hours', value: totalHours.toLocaleString(), color: 'text-blue-400' },
          { icon: Briefcase, label: 'Active Engagements', value: activeCount, color: 'text-purple-400' },
          { icon: Star, label: 'Outstanding', value: `$${outstanding.toLocaleString()}`, color: 'text-amber-400' },
          { icon: DollarSign, label: 'Avg Rate', value: `$${avgRate.toFixed(0)}/hr`, color: 'text-cyan-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className={ds.panel}
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className={ds.textMuted}>{stat.label}</p>
            <p className="text-xl font-bold text-white">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className={ds.panel}
      >
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-amber-400" /> Engagement Pipeline
        </h2>
        <div className="flex items-center gap-2">
          {[
            { stage: 'Proposal', count: (practice?.proposals || []).filter((p) => p.status === 'draft').length, color: 'bg-gray-500' },
            { stage: 'Active', count: practiceEngagements.filter((e) => e.status === 'active').length, color: 'bg-green-500' },
            { stage: 'Review', count: practiceEngagements.filter((e) => e.status === 'on_hold').length, color: 'bg-amber-500' },
            { stage: 'Closed', count: practiceEngagements.filter((e) => e.status === 'complete').length, color: 'bg-blue-500' },
          ].map((step, i, arr) => {
            const count = step.count;
            return (
              <div key={step.stage} className="flex items-center gap-2 flex-1">
                <div className="flex-1 text-center">
                  <div className={`${step.color} rounded-lg py-3 px-2`}>
                    <p className="text-lg font-bold text-white">{count}</p>
                    <p className="text-xs text-white/80">{step.stage}</p>
                  </div>
                </div>
                {i < arr.length - 1 && <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />}
              </div>
            );
          })}
        </div>
      </motion.div>

      {mode === 'dashboard' ? renderDashboard() : isPracticeMode ? renderPracticeRecords() : renderLibrary()}
      {renderEditor()}
    </div>
  );
}
