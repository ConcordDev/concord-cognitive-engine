'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensPageShell } from '@/components/lens/LensPageShell';
import {
  Lightbulb,
  Briefcase,
  FileText,
  Users,
  Clock,
  DollarSign,
  Plus,
  Search,
  X,
  Trash2,
  BarChart3,
  Target,
  TrendingUp,
  ArrowRight,
  BookOpen,
  Star,
  Zap,
} from 'lucide-react';

type ModeTab =
  | 'engagements'
  | 'proposals'
  | 'deliverables'
  | 'clients'
  | 'timesheets'
  | 'frameworks'
  | 'pipeline';
type ArtifactType =
  | 'Engagement'
  | 'Proposal'
  | 'Deliverable'
  | 'Client'
  | 'Timesheet'
  | 'Framework'
  | 'PipelineItem';
type Status = 'draft' | 'active' | 'pending' | 'completed' | 'on_hold' | 'cancelled';

interface ConsultingArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  client?: string;
  engagementType?: string;
  startDate?: string;
  endDate?: string;
  totalFee?: number;
  billedHours?: number;
  hourlyRate?: number;
  scope?: string;
  proposalValue?: number;
  winProbability?: number;
  contactName?: string;
  deliverableType?: string;
  dueDate?: string;
  methodology?: string;
}

const MODE_TABS: {
  id: ModeTab;
  label: string;
  icon: typeof Lightbulb;
  artifactType: ArtifactType;
}[] = [
  { id: 'engagements', label: 'Engagements', icon: Briefcase, artifactType: 'Engagement' },
  { id: 'proposals', label: 'Proposals', icon: FileText, artifactType: 'Proposal' },
  { id: 'deliverables', label: 'Deliverables', icon: Target, artifactType: 'Deliverable' },
  { id: 'clients', label: 'Clients', icon: Users, artifactType: 'Client' },
  { id: 'timesheets', label: 'Timesheets', icon: Clock, artifactType: 'Timesheet' },
  { id: 'frameworks', label: 'Frameworks', icon: BookOpen, artifactType: 'Framework' },
  { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, artifactType: 'PipelineItem' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray-400' },
  active: { label: 'Active', color: 'green-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  completed: { label: 'Completed', color: 'blue-400' },
  on_hold: { label: 'On Hold', color: 'orange-400' },
  cancelled: { label: 'Cancelled', color: 'red-400' },
};

const ENGAGEMENT_TYPES = [
  'Strategy',
  'Operations',
  'Technology',
  'Financial Advisory',
  'HR Consulting',
  'Risk Management',
  'Digital Transformation',
  'M&A',
];

export default function ConsultingLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('engagements');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ConsultingArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

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

  const activeArtifactType =
    MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Engagement';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ConsultingArtifact>('consulting', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('consulting');

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
    const all = items.map((i) => i.data as unknown as ConsultingArtifact);
    const totalRevenue = all.reduce((s, e) => s + (e.totalFee || 0), 0);
    const totalHours = all.reduce((s, e) => s + (e.billedHours || 0), 0);
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Total Revenue</p>
          <p className="text-xl font-bold text-white">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Clock className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Billed Hours</p>
          <p className="text-xl font-bold text-white">{totalHours.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Briefcase className="w-5 h-5 text-purple-400 mb-2" />
          <p className={ds.textMuted}>Active Engagements</p>
          <p className="text-xl font-bold text-white">
            {all.filter((e) => e.status === 'active').length}
          </p>
        </div>
        <div className={ds.panel}>
          <TrendingUp className="w-5 h-5 text-cyan-400 mb-2" />
          <p className={ds.textMuted}>Pipeline Items</p>
          <p className="text-xl font-bold text-white">{items.length}</p>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setEditorOpen(false)}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType}
            </h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}>
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
              <select
                className={ds.select}
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
                  <select
                    className={ds.select}
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

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={cn(ds.select, 'w-auto')}
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
                  >
                    <Zap className="w-4 h-4 text-neon-cyan" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  >
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

  return (
    <LensPageShell
      domain="consulting"
      title="Consulting"
      description="Engagements, proposals, deliverables, clients, and frameworks"
      headerIcon={<Lightbulb className="w-6 h-6" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <>
          {runAction.isPending && (
            <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
          )}
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </>
      }
    >
      <UniversalActions domain="consulting" artifactId={items[0]?.id} compact />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(() => {
          const all = items.map((i) => i.data as unknown as ConsultingArtifact);
          const totalRevenue = all.reduce((s, e) => s + (e.totalFee || 0), 0);
          const totalHours = all.reduce((s, e) => s + (e.billedHours || 0), 0);
          const activeCount = all.filter((e) => e.status === 'active').length;
          const avgRate =
            all.filter((e) => e.hourlyRate).length > 0
              ? all.reduce((s, e) => s + (e.hourlyRate || 0), 0) /
                all.filter((e) => e.hourlyRate).length
              : 0;
          const utilRate = all.length > 0 ? (activeCount / all.length) * 100 : 0;
          return [
            {
              icon: DollarSign,
              label: 'Total Revenue',
              value: `$${totalRevenue.toLocaleString()}`,
              color: 'text-green-400',
            },
            {
              icon: Clock,
              label: 'Billed Hours',
              value: totalHours.toLocaleString(),
              color: 'text-blue-400',
            },
            {
              icon: Briefcase,
              label: 'Active Engagements',
              value: activeCount,
              color: 'text-purple-400',
            },
            {
              icon: Star,
              label: 'Utilization Rate',
              value: `${utilRate.toFixed(0)}%`,
              color: 'text-amber-400',
            },
            {
              icon: DollarSign,
              label: 'Avg Rate',
              value: `$${avgRate.toFixed(0)}/hr`,
              color: 'text-cyan-400',
            },
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
          ));
        })()}
      </div>

      {/* Engagement Status Pipeline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className={ds.panel}
      >
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-amber-400" /> Engagement Pipeline
        </h3>
        <div className="flex items-center gap-2">
          {[
            { stage: 'Proposal', statuses: ['draft', 'pending'], color: 'bg-gray-500' },
            { stage: 'Active', statuses: ['active'], color: 'bg-green-500' },
            { stage: 'Review', statuses: ['on_hold'], color: 'bg-amber-500' },
            { stage: 'Closed', statuses: ['completed', 'cancelled'], color: 'bg-blue-500' },
          ].map((step, i, arr) => {
            const count = items.filter((it) =>
              step.statuses.includes((it.data as unknown as ConsultingArtifact).status)
            ).length;
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

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowDashboard(false);
            }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
    </LensPageShell>
  );
}
