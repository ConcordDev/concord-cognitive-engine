'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Palette, Camera, Image as ImageIcon, Tv, LayoutGrid, FileCheck,
  Plus, Search, Filter, X, Edit2, Trash2, Clock, Eye,
  TrendingUp, FileImage, Video, Aperture, ChevronRight,
  DollarSign, Users, MapPin, CalendarDays,
  CheckCircle2, MessageSquare, BarChart3,
  Clapperboard, Mic, FileText, Monitor, Printer, Globe,
  Share2, ArrowUpRight, ArrowDownRight, Minus,
  FolderOpen, Layers, Zap, Send,
  RotateCcw, Shield, Hash, Play, Gauge,
  CircleDot, ListChecks, ClipboardList, Receipt, PieChart, ChevronDown,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'dashboard' | 'projects' | 'assets' | 'revisions' | 'shotlist' | 'proofs' | 'budget' | 'distribution';
type ArtifactType = 'Project' | 'Asset' | 'Revision' | 'ShotItem' | 'ClientProof' | 'BudgetLine' | 'DistItem';
type ProjectPhase = 'concept' | 'pre_production' | 'production' | 'post_production' | 'review' | 'delivery';
type AssetCategory = 'photo' | 'video' | 'audio' | 'graphic' | 'document';
type ProofStatus = 'pending_review' | 'approved' | 'revision_requested';
type ShotStatus = 'planned' | 'scheduled' | 'in_progress' | 'captured' | 'review' | 'final';

const ALL_STATUSES = ['concept', 'pre_production', 'production', 'post_production', 'review', 'delivery', 'archived'] as const;

const STATUS_COLORS: Record<string, string> = {
  concept: 'gray-400', pre_production: 'neon-blue', production: 'neon-cyan',
  post_production: 'neon-purple', review: 'amber-400', delivery: 'green-400',
  archived: 'gray-500', planned: 'gray-400', scheduled: 'neon-blue',
  in_progress: 'neon-cyan', captured: 'neon-purple', final: 'green-400',
  pending_review: 'amber-400', approved: 'green-400', revision_requested: 'red-400',
};

const PHASE_ORDER: ProjectPhase[] = ['concept', 'pre_production', 'production', 'post_production', 'review', 'delivery'];
const PHASE_LABELS: Record<ProjectPhase, string> = {
  concept: 'Concept', pre_production: 'Pre-Production', production: 'Production',
  post_production: 'Post-Production', review: 'Review', delivery: 'Delivery',
};

const ASSET_CATEGORIES: { id: AssetCategory; label: string; icon: typeof Camera }[] = [
  { id: 'photo', label: 'Photo', icon: Aperture },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'graphic', label: 'Graphic', icon: FileImage },
  { id: 'document', label: 'Document', icon: FileText },
];

type ProjectType = 'video' | 'audio' | 'design' | 'writing' | 'branding' | 'campaign' | 'film' | 'social' | 'web' | 'print' | 'other';
type FeedbackStatus = 'pending' | 'addressed' | 'rejected';

const PROJECT_TYPES: { id: ProjectType; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'design', label: 'Design' },
  { id: 'writing', label: 'Writing' },
  { id: 'branding', label: 'Branding' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'film', label: 'Film' },
  { id: 'social', label: 'Social Media' },
  { id: 'web', label: 'Web' },
  { id: 'print', label: 'Print / Digital' },
  { id: 'other', label: 'Other' },
];

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Palette; type?: ArtifactType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'projects', label: 'Projects', icon: Palette, type: 'Project' },
  { id: 'assets', label: 'Asset Library', icon: FolderOpen, type: 'Asset' },
  { id: 'revisions', label: 'Revisions', icon: RotateCcw, type: 'Revision' },
  { id: 'shotlist', label: 'Shot List', icon: Clapperboard, type: 'ShotItem' },
  { id: 'proofs', label: 'Client Proofing', icon: FileCheck, type: 'ClientProof' },
  { id: 'budget', label: 'Budget', icon: DollarSign, type: 'BudgetLine' },
  { id: 'distribution', label: 'Distribution', icon: Send, type: 'DistItem' },
];

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const SEED: Record<ArtifactType, Array<{ title: string; data: Record<string, unknown>; meta: Record<string, unknown> }>> = {
  Project: [],
  Asset: [],
  ShotItem: [],
  ClientProof: [],
  BudgetLine: [],
  DistItem: [],
  Revision: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseSafe<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  if (Array.isArray(val)) return val as unknown as T;
  return fallback;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CreativeLensPage() {
  useLensNav('creative');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative');

  const [showFeatures, setShowFeatures] = useState(true);
  const [mode, setMode] = useState<ModeTab>('dashboard');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | 'all'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [detailItem, setDetailItem] = useState<LensItem | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState('concept');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // Determine which artifact type to load
  const currentTabDef = MODE_TABS.find(t => t.id === mode);
  const currentType: ArtifactType = currentTabDef?.type || 'Project';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData('creative', currentType, {
    seed: SEED[currentType],
  });

  // Also load projects for cross-referencing from dashboard
  const { items: allProjects } = useLensData('creative', 'Project', { seed: SEED.Project, noSeed: mode !== 'dashboard' && mode !== 'budget' });
  const { items: allProofs } = useLensData('creative', 'ClientProof', { seed: SEED.ClientProof, noSeed: mode !== 'dashboard' });
  const { items: allAssets } = useLensData('creative', 'Asset', { seed: SEED.Asset, noSeed: mode !== 'dashboard' });
  const { items: allBudget } = useLensData('creative', 'BudgetLine', { seed: SEED.BudgetLine, noSeed: mode !== 'dashboard' && mode !== 'budget' });
  const { items: allDist } = useLensData('creative', 'DistItem', { seed: SEED.DistItem, noSeed: mode !== 'dashboard' });
  const { items: allRevisions } = useLensData('creative', 'Revision', { seed: SEED.Revision, noSeed: mode !== 'dashboard' });

  const runAction = useRunArtifact('creative');

  // DTU context (v3.0 artifact support)
  const {
    contextDTUs: creativeDTUs, hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'creative' });

  const creativeArtifacts = creativeDTUs.filter((d: DTU) => d.artifact);

  // Filtering
  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || JSON.stringify(i.data).toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => (i.meta?.status === statusFilter) || ((i.data as Record<string, unknown>).proofStatus === statusFilter));
    }
    if (mode === 'assets' && categoryFilter !== 'all') {
      list = list.filter(i => (i.data as Record<string, unknown>).category === categoryFilter);
    }
    return list;
  }, [items, search, statusFilter, categoryFilter, mode]);

  // Form handling
  const resetForm = useCallback(() => {
    setFormTitle(''); setFormStatus('concept'); setFormFields({}); setEditing(null); setShowEditor(false);
  }, []);

  const openCreate = useCallback(() => { resetForm(); setShowEditor(true); }, [resetForm]);

  const openEdit = useCallback((item: LensItem) => {
    setEditing(item.id);
    setFormTitle(item.title);
    setFormStatus(item.meta?.status || 'concept');
    const d = item.data as Record<string, unknown>;
    const fields: Record<string, string> = {};
    Object.entries(d).forEach(([k, v]) => {
      fields[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    });
    setFormFields(fields);
    setShowEditor(true);
  }, []);

  const openDetail = useCallback((item: LensItem) => {
    setDetailItem(item);
    setShowDetail(true);
  }, []);

  const handleSave = async () => {
    const data: Record<string, unknown> = { ...formFields };
    if (editing) {
      await update(editing, { title: formTitle, data, meta: { status: formStatus } });
    } else {
      await create({ title: formTitle, data, meta: { status: formStatus } });
    }
    resetForm();
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editing || filtered[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActiveAction(null);
    }
  };

  // Form field configs per mode
  const formConfig: Record<string, { key: string; label: string; type: 'input' | 'textarea' | 'select'; options?: string[] }[]> = {
    projects: [
      { key: 'client', label: 'Client', type: 'input' },
      { key: 'projectType', label: 'Project Type', type: 'select', options: PROJECT_TYPES.map(pt => pt.label) },
      { key: 'budget', label: 'Budget ($)', type: 'input' },
      { key: 'deadline', label: 'Deadline', type: 'input' },
      { key: 'lead', label: 'Project Lead', type: 'input' },
      { key: 'phase', label: 'Phase', type: 'select', options: ['concept', 'pre_production', 'production', 'post_production', 'review', 'delivery'] },
    ],
    assets: [
      { key: 'category', label: 'Category', type: 'select', options: ['photo', 'video', 'audio', 'graphic', 'document'] },
      { key: 'format', label: 'Format', type: 'input' },
      { key: 'resolution', label: 'Resolution', type: 'input' },
      { key: 'fileSize', label: 'File Size', type: 'input' },
      { key: 'colorSpace', label: 'Color Space', type: 'input' },
      { key: 'project', label: 'Project', type: 'input' },
    ],
    revisions: [
      { key: 'project', label: 'Project', type: 'input' },
      { key: 'asset', label: 'Asset Name', type: 'input' },
      { key: 'version', label: 'Version Number', type: 'input' },
      { key: 'previousVersion', label: 'Previous Version', type: 'input' },
      { key: 'revisedBy', label: 'Revised By', type: 'input' },
      { key: 'revisionDate', label: 'Revision Date', type: 'input' },
      { key: 'changeDescription', label: 'Change Description', type: 'textarea' },
      { key: 'feedbackNotes', label: 'Feedback Notes', type: 'textarea' },
      { key: 'feedbackStatus', label: 'Feedback Status', type: 'select', options: ['pending', 'addressed', 'rejected'] },
    ],
    shotlist: [
      { key: 'project', label: 'Project', type: 'input' },
      { key: 'description', label: 'Shot Description', type: 'textarea' },
      { key: 'location', label: 'Location', type: 'input' },
      { key: 'talent', label: 'Talent', type: 'input' },
      { key: 'equipment', label: 'Equipment', type: 'input' },
      { key: 'scheduledDate', label: 'Date', type: 'input' },
      { key: 'scheduledTime', label: 'Time', type: 'input' },
    ],
    proofs: [
      { key: 'project', label: 'Project', type: 'input' },
      { key: 'client', label: 'Client', type: 'input' },
      { key: 'clientContact', label: 'Client Contact', type: 'input' },
      { key: 'proofRound', label: 'Proof Round', type: 'input' },
      { key: 'proofStatus', label: 'Proof Status', type: 'select', options: ['pending_review', 'approved', 'revision_requested'] },
    ],
    budget: [
      { key: 'project', label: 'Project', type: 'input' },
      { key: 'category', label: 'Category', type: 'select', options: ['talent', 'equipment', 'location', 'post_production', 'licensing'] },
      { key: 'estimated', label: 'Estimated ($)', type: 'input' },
      { key: 'actual', label: 'Actual ($)', type: 'input' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    distribution: [
      { key: 'project', label: 'Project', type: 'input' },
      { key: 'format', label: 'Format Spec', type: 'input' },
      { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'YouTube', 'LinkedIn', 'Web', 'Print', 'Podcast', 'TikTok', 'Other'] },
      { key: 'requirement', label: 'Requirements', type: 'textarea' },
      { key: 'completed', label: 'Completed', type: 'select', options: ['true', 'false'] },
    ],
  };

  // ---------------------------------------------------------------------------
  // Dashboard metrics
  // ---------------------------------------------------------------------------
  const projectData = (allProjects.length ? allProjects : items).map(p => p.data as Record<string, unknown>);
  const activeProjectCount = allProjects.filter(p => !['delivery', 'archived'].includes(p.meta?.status as string)).length;
  const totalRevenue = projectData.reduce((s, p) => s + Number(p.budget || 0), 0);
  const totalSpent = projectData.reduce((s, p) => s + Number(p.budgetSpent || 0), 0);
  const pendingProofs = allProofs.filter(p => (p.data as Record<string, unknown>).proofStatus === 'pending_review' || (p.data as Record<string, unknown>).proofStatus === 'revision_requested').length;
  const assetsThisMonth = allAssets.length;
  const deliveredDist = allDist.filter(d => (d.data as Record<string, unknown>).completed === true || (d.data as Record<string, unknown>).completed === 'true').length;
  const totalDist = allDist.length;
  const pendingRevisions = allRevisions.filter(r => (r.data as Record<string, unknown>).feedbackStatus === 'pending').length;

  const upcomingDeadlines = allProjects
    .filter(p => {
      const d = p.data as Record<string, unknown>;
      return d.deadline && daysUntil(d.deadline as string) > 0 && daysUntil(d.deadline as string) <= 60;
    })
    .sort((a, b) => daysUntil((a.data as Record<string, unknown>).deadline as string) - daysUntil((b.data as Record<string, unknown>).deadline as string));

  const budgetByCategory = useMemo(() => {
    const cats: Record<string, { estimated: number; actual: number }> = {};
    const bl = allBudget.length ? allBudget : items;
    bl.forEach(b => {
      const d = b.data as Record<string, unknown>;
      const cat = String(d.category || 'other');
      if (!cats[cat]) cats[cat] = { estimated: 0, actual: 0 };
      cats[cat].estimated += Number(d.estimated || 0);
      cats[cat].actual += Number(d.actual || 0);
    });
    return cats;
  }, [allBudget, items]);

  const utilizationRate = totalRevenue > 0 ? totalSpent / totalRevenue : 0;

  // Icon helper
  const categoryIcon = (cat: string) => {
    switch (cat) {
      case 'photo': return <Aperture className="w-4 h-4 text-neon-cyan" />;
      case 'video': return <Video className="w-4 h-4 text-neon-purple" />;
      case 'audio': return <Mic className="w-4 h-4 text-pink-400" />;
      case 'graphic': return <FileImage className="w-4 h-4 text-neon-blue" />;
      case 'document': return <FileText className="w-4 h-4 text-amber-400" />;
      default: return <FileImage className="w-4 h-4 text-gray-400" />;
    }
  };

  const proofStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'revision_requested': return <RotateCcw className="w-4 h-4 text-red-400" />;
      default: return <Clock className="w-4 h-4 text-amber-400" />;
    }
  };

  const budgetCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'talent': return <Users className="w-4 h-4 text-neon-cyan" />;
      case 'equipment': return <Camera className="w-4 h-4 text-neon-purple" />;
      case 'location': return <MapPin className="w-4 h-4 text-amber-400" />;
      case 'post_production': return <Tv className="w-4 h-4 text-pink-400" />;
      case 'licensing': return <Shield className="w-4 h-4 text-green-400" />;
      default: return <Receipt className="w-4 h-4 text-gray-400" />;
    }
  };

  // ---------------------------------------------------------------------------
  // Loading & Error state
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Dashboard
  // ---------------------------------------------------------------------------
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1"><Palette className="w-4 h-4 text-neon-purple" /><span className={ds.textMuted}>Active Projects</span></div>
          <p className="text-2xl font-bold">{activeProjectCount}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>{allProjects.length} total</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1"><FolderOpen className="w-4 h-4 text-neon-cyan" /><span className={ds.textMuted}>Assets This Month</span></div>
          <p className="text-2xl font-bold">{assetsThisMonth}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>{allAssets.filter(a => (a.data as Record<string, unknown>).category === 'video').length} videos, {allAssets.filter(a => (a.data as Record<string, unknown>).category === 'photo').length} photos</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1"><FileCheck className="w-4 h-4 text-amber-400" /><span className={ds.textMuted}>Pending Proofs</span></div>
          <p className="text-2xl font-bold">{pendingProofs}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>{allProofs.filter(p => (p.data as Record<string, unknown>).proofStatus === 'approved').length} approved</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-green-400" /><span className={ds.textMuted}>Revenue Pipeline</span></div>
          <p className="text-2xl font-bold">{fmtCurrency(totalRevenue)}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>{fmtCurrency(totalSpent)} spent ({fmtPct(utilizationRate)})</p>
        </div>
      </div>

      {/* Revision Alert Row */}
      {pendingRevisions > 0 && (
        <div className={cn(ds.panel, 'flex items-center gap-3 border-amber-400/20')}>
          <RotateCcw className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-400">{pendingRevisions} Pending Revision{pendingRevisions !== 1 ? 's' : ''}</p>
            <p className={cn(ds.textMuted, 'text-xs')}>Revisions awaiting feedback review</p>
          </div>
          <button onClick={() => setMode('revisions')} className={cn(ds.btnSecondary, ds.btnSmall)}>
            View Revisions
          </button>
        </div>
      )}

      {/* Second KPI Row */}
      <div className={ds.grid3}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-neon-blue" /><span className={ds.textMuted}>Budget Utilization</span></div>
          <div className="w-full bg-lattice-elevated rounded-full h-3 mb-2">
            <div className={cn('h-3 rounded-full transition-all', utilizationRate > 0.9 ? 'bg-red-400' : utilizationRate > 0.7 ? 'bg-amber-400' : 'bg-green-400')} style={{ width: `${Math.min(utilizationRate * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between">
            <span className={ds.textMuted}>{fmtCurrency(totalSpent)}</span>
            <span className={ds.textMuted}>{fmtCurrency(totalRevenue)}</span>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Send className="w-4 h-4 text-neon-purple" /><span className={ds.textMuted}>Distribution Progress</span></div>
          <div className="w-full bg-lattice-elevated rounded-full h-3 mb-2">
            <div className="h-3 rounded-full bg-neon-purple transition-all" style={{ width: totalDist > 0 ? `${(deliveredDist / totalDist) * 100}%` : '0%' }} />
          </div>
          <div className="flex justify-between">
            <span className={ds.textMuted}>{deliveredDist} delivered</span>
            <span className={ds.textMuted}>{totalDist} total</span>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-green-400" /><span className={ds.textMuted}>Profit Margin</span></div>
          <p className="text-2xl font-bold text-green-400">{fmtCurrency(totalRevenue - totalSpent)}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>
            {totalRevenue > 0 ? fmtPct((totalRevenue - totalSpent) / totalRevenue) : '0%'} margin across all projects
          </p>
        </div>
      </div>

      {/* Upcoming Deadlines + Phase Pipeline */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><CalendarDays className="w-5 h-5 text-amber-400" /> Upcoming Deadlines</h3>
          {upcomingDeadlines.length === 0 ? (
            <p className={ds.textMuted}>No upcoming deadlines in the next 60 days</p>
          ) : (
            <div className="space-y-2">
              {upcomingDeadlines.map(p => {
                const d = p.data as Record<string, unknown>;
                const days = daysUntil(d.deadline as string);
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.title}</p>
                      <p className={ds.textMuted}>{String(d.client)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', days <= 7 ? 'bg-red-500/20 text-red-400' : days <= 21 ? 'bg-amber-400/20 text-amber-400' : 'bg-green-400/20 text-green-400')}>
                        {days}d left
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Layers className="w-5 h-5 text-neon-cyan" /> Phase Pipeline</h3>
          <div className="space-y-2">
            {PHASE_ORDER.map(phase => {
              const count = allProjects.filter(p => (p.data as Record<string, unknown>).phase === phase).length;
              return (
                <div key={phase} className="flex items-center gap-3">
                  <span className={cn('w-28 text-xs', ds.textMuted)}>{PHASE_LABELS[phase]}</span>
                  <div className="flex-1 bg-lattice-elevated rounded-full h-2">
                    <div className={cn('h-2 rounded-full')} style={{ width: allProjects.length > 0 ? `${(count / allProjects.length) * 100}%` : '0%', backgroundColor: `var(--${STATUS_COLORS[phase]?.replace('-', '-')}, #666)` }} />
                  </div>
                  <span className="text-sm font-medium w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Budget Breakdown by Category */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><PieChart className="w-5 h-5 text-neon-purple" /> Budget by Category</h3>
        <div className={ds.grid3}>
          {Object.entries(budgetByCategory).map(([cat, vals]) => {
            const pct = vals.estimated > 0 ? vals.actual / vals.estimated : 0;
            return (
              <div key={cat} className="p-3 rounded-lg bg-lattice-elevated/50">
                <div className="flex items-center gap-2 mb-2">
                  {budgetCategoryIcon(cat)}
                  <span className="text-sm font-medium text-white capitalize">{cat.replace(/_/g, ' ')}</span>
                </div>
                <div className="w-full bg-lattice-surface rounded-full h-2 mb-1">
                  <div className={cn('h-2 rounded-full', pct > 1 ? 'bg-red-400' : pct > 0.8 ? 'bg-amber-400' : 'bg-neon-cyan')} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                </div>
                <div className="flex justify-between">
                  <span className={cn(ds.textMuted, 'text-xs')}>{fmtCurrency(vals.actual)} spent</span>
                  <span className={cn(ds.textMuted, 'text-xs')}>{fmtCurrency(vals.estimated)} est.</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Domain Actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Zap className="w-5 h-5 text-amber-400" /> Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'generate_shot_list', label: 'Generate Shot List', icon: Clapperboard },
            { action: 'asset_report', label: 'Asset Report', icon: BarChart3 },
            { action: 'budget_analysis', label: 'Budget Analysis', icon: DollarSign },
            { action: 'distribution_checklist', label: 'Distribution Checklist', icon: ListChecks },
            { action: 'project_summary', label: 'Project Summary', icon: ClipboardList },
          ].map(a => (
            <button
              key={a.action}
              onClick={() => {
                const target = allProjects[0]?.id || filtered[0]?.id;
                if (target) handleAction(a.action, target);
              }}
              disabled={runAction.isPending}
              className={cn(ds.btnSecondary, ds.btnSmall, 'text-sm')}
            >
              <a.icon className="w-4 h-4" />
              {activeAction === a.action ? 'Running...' : a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Projects
  // ---------------------------------------------------------------------------
  const renderProjects = () => (
    <div className={ds.grid2}>
      {filtered.map((item, index) => {
        const d = item.data as Record<string, unknown>;
        const milestones = parseSafe<{ name: string; date: string; done: boolean }[]>(d.milestones, []);
        const team = parseSafe<string[]>(d.teamMembers, []);
        const phase = String(d.phase || 'concept') as ProjectPhase;
        const phaseIdx = PHASE_ORDER.indexOf(phase);
        const budget = Number(d.budget || 0);
        const spent = Number(d.budgetSpent || 0);
        const delivTotal = Number(d.deliverables || 0);
        const delivDone = Number(d.deliverablesCompleted || 0);
        const dLeft = d.deadline ? daysUntil(d.deadline as string) : 0;
        const profitMargin = budget > 0 ? (budget - spent) / budget : 0;

        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openDetail(item)}>
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0">
                <h3 className={cn(ds.heading3, 'truncate')}>{item.title}</h3>
                <p className={ds.textMuted}>{String(d.client)} &middot; {String(d.projectType)}</p>
              </div>
              <span className={ds.badge(STATUS_COLORS[phase] || 'gray-400')}>{PHASE_LABELS[phase]}</span>
            </div>

            {/* Phase progress */}
            <div className="flex items-center gap-1 mb-3">
              {PHASE_ORDER.map((ph, idx) => (
                <div key={ph} className="flex items-center flex-1">
                  <div className={cn('h-1.5 flex-1 rounded-full', idx <= phaseIdx ? 'bg-neon-purple' : 'bg-lattice-elevated')} />
                  {idx < PHASE_ORDER.length - 1 && <ChevronRight className={cn('w-3 h-3 shrink-0', idx < phaseIdx ? 'text-neon-purple' : 'text-gray-600')} />}
                </div>
              ))}
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center p-2 rounded bg-lattice-elevated/50">
                <p className={cn(ds.textMuted, 'text-xs')}>Budget</p>
                <p className="text-sm font-semibold">{fmtCurrency(budget)}</p>
                <p className={cn('text-xs', spent / budget > 0.9 ? 'text-red-400' : 'text-green-400')}>{fmtPct(spent / (budget || 1))} used</p>
              </div>
              <div className="text-center p-2 rounded bg-lattice-elevated/50">
                <p className={cn(ds.textMuted, 'text-xs')}>Deliverables</p>
                <p className="text-sm font-semibold">{delivDone}/{delivTotal}</p>
                <div className="w-full bg-lattice-surface rounded-full h-1 mt-1">
                  <div className="h-1 rounded-full bg-neon-cyan" style={{ width: delivTotal > 0 ? `${(delivDone / delivTotal) * 100}%` : '0%' }} />
                </div>
              </div>
              <div className="text-center p-2 rounded bg-lattice-elevated/50">
                <p className={cn(ds.textMuted, 'text-xs')}>Deadline</p>
                <p className={cn('text-sm font-semibold', dLeft <= 7 ? 'text-red-400' : dLeft <= 21 ? 'text-amber-400' : 'text-white')}>
                  {dLeft > 0 ? `${dLeft}d` : dLeft === 0 ? 'Today' : 'Overdue'}
                </p>
              </div>
            </div>

            {/* Milestones */}
            {milestones.length > 0 && (
              <div className="mb-3">
                <p className={cn(ds.textMuted, 'text-xs mb-1')}>Milestones</p>
                <div className="space-y-1">
                  {milestones.slice(0, 3).map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {m.done ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> : <CircleDot className="w-3 h-3 text-gray-500 shrink-0" />}
                      <span className={cn(m.done ? 'text-gray-500 line-through' : 'text-gray-300')}>{m.name}</span>
                    </div>
                  ))}
                  {milestones.length > 3 && <p className={cn(ds.textMuted, 'text-xs')}>+{milestones.length - 3} more</p>}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
              <div className="flex items-center gap-1">
                {team.slice(0, 3).map((t, i) => (
                  <div key={i} className="w-6 h-6 rounded-full bg-lattice-elevated flex items-center justify-center text-[10px] font-medium text-gray-300 border border-lattice-border" title={t}>
                    {t.split(' ').map(w => w[0]).join('')}
                  </div>
                ))}
                {team.length > 3 && <span className={cn(ds.textMuted, 'text-xs')}>+{team.length - 3}</span>}
              </div>
              <div className="flex items-center gap-1">
                <span className={cn('text-xs font-medium', profitMargin > 0.3 ? 'text-green-400' : profitMargin > 0.1 ? 'text-amber-400' : 'text-red-400')}>
                  {fmtPct(profitMargin)} margin
                </span>
                <PullToSubstrate domain="creative" artifactId={item.id} compact />
                <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Asset Library
  // ---------------------------------------------------------------------------
  const renderAssets = () => (
    <div className="space-y-4">
      {/* Category filter bar */}
      <div className="flex items-center gap-2">
        <button onClick={() => setCategoryFilter('all')} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors', categoryFilter === 'all' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
          <LayoutGrid className="w-3.5 h-3.5" /> All
        </button>
        {ASSET_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const count = items.filter(i => (i.data as Record<string, unknown>).category === cat.id).length;
          return (
            <button key={cat.id} onClick={() => setCategoryFilter(cat.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors', categoryFilter === cat.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
              <Icon className="w-3.5 h-3.5" /> {cat.label} <span className="text-xs opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Asset grid */}
      <div className={ds.grid3}>
        {filtered.map(item => {
          const d = item.data as Record<string, unknown>;
          const versions = parseSafe<{ v: number; date: string; note: string }[]>(d.versionHistory, []);
          return (
            <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
              {/* Asset preview placeholder */}
              <div className="w-full h-28 rounded-lg bg-lattice-elevated/70 flex items-center justify-center mb-3 border border-lattice-border">
                {categoryIcon(String(d.category))}
                <span className={cn(ds.textMuted, 'ml-2 text-xs uppercase')}>{String(d.format)}</span>
              </div>

              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
                  <p className={cn(ds.textMuted, 'text-xs')}>{String(d.project)}</p>
                </div>
                <span className={ds.badge(STATUS_COLORS[item.meta?.status as string] || 'gray-400')}>
                  {String(item.meta?.status || '').replace(/_/g, ' ')}
                </span>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2 text-xs">
                <div><span className="text-gray-500">Resolution:</span> <span className="text-gray-300">{String(d.resolution)}</span></div>
                <div><span className="text-gray-500">Size:</span> <span className="text-gray-300">{String(d.fileSize)}</span></div>
                <div><span className="text-gray-500">Color:</span> <span className="text-gray-300">{String(d.colorSpace)}</span></div>
                <div><span className="text-gray-500">Version:</span> <span className="text-gray-300">v{String(d.version)}</span></div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mb-2">
                {(item.meta?.tags || []).slice(0, 4).map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-lattice-elevated text-gray-400">
                    <Hash className="w-2.5 h-2.5 inline mr-0.5" />{tag}
                  </span>
                ))}
              </div>

              {/* Usage + versions */}
              <div className="flex items-center justify-between pt-2 border-t border-lattice-border text-xs">
                <span className={ds.textMuted}><Eye className="w-3 h-3 inline mr-1" />{String(d.usageCount)} uses</span>
                <span className={ds.textMuted}>{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
                <div className="flex gap-1">
                  <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3 h-3" /></button>
                  <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Revision Tracker
  // ---------------------------------------------------------------------------
  const renderRevisions = () => {
    const feedbackStatuses: FeedbackStatus[] = ['pending', 'addressed', 'rejected'];
    const feedbackColors: Record<FeedbackStatus, string> = { pending: 'amber-400', addressed: 'green-400', rejected: 'red-400' };
    const feedbackIcons: Record<FeedbackStatus, typeof Clock> = { pending: Clock, addressed: CheckCircle2, rejected: X };
    const groupedByProject = filtered.reduce<Record<string, typeof filtered>>((acc, item) => {
      const proj = String((item.data as Record<string, unknown>).project || 'Unassigned');
      if (!acc[proj]) acc[proj] = [];
      acc[proj].push(item);
      return acc;
    }, {});

    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className={ds.grid3}>
          {feedbackStatuses.map(fs => {
            const count = filtered.filter(i => (i.data as Record<string, unknown>).feedbackStatus === fs).length;
            const FsIcon = feedbackIcons[fs];
            return (
              <div key={fs} className={cn(ds.panel, 'text-center')}>
                <FsIcon className={cn('w-5 h-5 mx-auto mb-1', `text-${feedbackColors[fs]}`)} />
                <p className="text-xl font-bold mt-1">{count}</p>
                <p className={cn(ds.textMuted, 'text-xs capitalize')}>{fs}</p>
              </div>
            );
          })}
        </div>

        {/* Grouped by project */}
        {Object.entries(groupedByProject).map(([project, revisions]) => (
          <div key={project} className={ds.panel}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <FolderOpen className="w-4 h-4 text-neon-purple" />
                {project}
              </h3>
              <span className={cn(ds.textMuted, 'text-xs')}>{revisions.length} revision{revisions.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {revisions.sort((a, b) => Number((b.data as Record<string, unknown>).version || 0) - Number((a.data as Record<string, unknown>).version || 0)).map(item => {
                const d = item.data as Record<string, unknown>;
                const fs = String(d.feedbackStatus || 'pending') as FeedbackStatus;
                const FsIcon = feedbackIcons[fs] || Clock;
                return (
                  <div key={item.id} className={cn('p-3 rounded-lg border transition-colors cursor-pointer', fs === 'addressed' ? 'bg-green-500/5 border-green-500/20' : fs === 'rejected' ? 'bg-red-500/5 border-red-500/20' : 'bg-lattice-elevated/30 border-lattice-border hover:border-neon-cyan/50')} onClick={() => openDetail(item)}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn(ds.textMono, 'text-xs text-neon-blue')}>v{String(d.version)}</span>
                        <h4 className="text-sm font-medium text-white truncate">{item.title}</h4>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={ds.badge(feedbackColors[fs])}>
                          <FsIcon className="w-3 h-3 inline mr-1" />{fs}
                        </span>
                      </div>
                    </div>
                    <p className={cn(ds.textMuted, 'text-xs mb-2 line-clamp-2')}>{String(d.changeDescription)}</p>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3 text-gray-400">
                        <span><Users className="w-3 h-3 inline mr-1" />{String(d.revisedBy)}</span>
                        <span><CalendarDays className="w-3 h-3 inline mr-1" />{String(d.revisionDate)}</span>
                        {!!d.asset && <span><FileImage className="w-3 h-3 inline mr-1" />{String(d.asset)}</span>}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3 h-3" /></button>
                        <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    {!!d.feedbackNotes && (
                      <div className="mt-2 pt-2 border-t border-lattice-border/50">
                        <p className={cn(ds.textMuted, 'text-xs')}><MessageSquare className="w-3 h-3 inline mr-1" />Feedback: {String(d.feedbackNotes)}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Shot List / Production Board
  // ---------------------------------------------------------------------------
  const renderShotList = () => {
    const shotStatuses: ShotStatus[] = ['planned', 'scheduled', 'in_progress', 'captured', 'review', 'final'];
    return (
      <div className="space-y-4">
        {/* Status board view */}
        <div className="flex gap-3 flex-wrap pb-2">
          {shotStatuses.map(status => {
            const shots = filtered.filter(i => i.meta?.status === status);
            return (
              <div key={status} className="min-w-[280px] flex-1">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>{status.replace(/_/g, ' ')}</span>
                  <span className={cn(ds.textMuted, 'text-xs')}>{shots.length}</span>
                </div>
                <div className="space-y-2">
                  {shots.map(item => {
                    const d = item.data as Record<string, unknown>;
                    return (
                      <div key={item.id} className={cn(ds.panel, 'cursor-pointer hover:border-neon-cyan/50 transition-colors')} onClick={() => openDetail(item)}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(ds.textMono, 'text-xs text-neon-blue')}>#{String(d.shotNumber || '-')}</span>
                          <h4 className="text-sm font-medium text-white truncate">{item.title}</h4>
                        </div>
                        <p className={cn(ds.textMuted, 'text-xs mb-2 line-clamp-2')}>{String(d.description)}</p>

                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{String(d.location)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <Users className="w-3 h-3 shrink-0" />
                            <span className="truncate">{String(d.talent)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <CalendarDays className="w-3 h-3 shrink-0" />
                            <span>{String(d.scheduledDate)} {String(d.scheduledTime || '')}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <Camera className="w-3 h-3 shrink-0" />
                            <span className="truncate">{String(d.equipment)}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-lattice-border">
                          <span className={cn(ds.textMuted, 'text-xs')}>{String(d.project)}</span>
                          <div className="flex gap-1">
                            <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3 h-3" /></button>
                            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Client Proofing
  // ---------------------------------------------------------------------------
  const renderProofs = () => (
    <div className="space-y-4">
      {/* Proof status summary */}
      <div className={ds.grid3}>
        {(['pending_review', 'revision_requested', 'approved'] as ProofStatus[]).map(ps => {
          const count = filtered.filter(i => (i.data as Record<string, unknown>).proofStatus === ps).length;
          return (
            <div key={ps} className={cn(ds.panel, 'text-center')}>
              {proofStatusIcon(ps)}
              <p className="text-xl font-bold mt-1">{count}</p>
              <p className={cn(ds.textMuted, 'text-xs capitalize')}>{ps.replace(/_/g, ' ')}</p>
            </div>
          );
        })}
      </div>

      {/* Proof cards */}
      <div className={ds.grid2}>
        {filtered.map(item => {
          const d = item.data as Record<string, unknown>;
          const comments = parseSafe<{ author: string; date: string; text: string }[]>(d.comments, []);
          const proofSt = String(d.proofStatus || 'pending_review') as ProofStatus;
          const isApproved = d.approvalGate === true;

          return (
            <div key={item.id} className={cn(ds.panelHover, isApproved && 'border-green-500/30')} onClick={() => openDetail(item)}>
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
                  <p className={ds.textMuted}>{String(d.project)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={ds.badge(STATUS_COLORS[proofSt] || 'gray-400')}>
                    {proofSt.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {/* Proof metadata */}
              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                <div><span className="text-gray-500">Client:</span> <span className="text-gray-300">{String(d.clientContact)}</span></div>
                <div><span className="text-gray-500">Round:</span> <span className="text-gray-300">{String(d.proofRound)}</span></div>
                <div><span className="text-gray-500">Sent:</span> <span className="text-gray-300">{String(d.sentDate)}</span></div>
                <div><span className="text-gray-500">Revisions:</span> <span className={cn('text-gray-300', Number(d.revisionCount) > 3 && 'text-amber-400')}>{String(d.revisionCount)}</span></div>
              </div>

              {/* Approval gate */}
              {isApproved && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Shield className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-green-400 font-medium">Final Approval Granted</span>
                </div>
              )}

              {/* Comments */}
              {comments.length > 0 && (
                <div className="mb-3">
                  <p className={cn(ds.textMuted, 'text-xs mb-1 flex items-center gap-1')}>
                    <MessageSquare className="w-3 h-3" /> {comments.length} comment{comments.length !== 1 ? 's' : ''}
                  </p>
                  {comments.slice(-2).map((c, i) => (
                    <div key={i} className="p-2 rounded bg-lattice-elevated/50 mb-1 last:mb-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-white">{c.author}</span>
                        <span className={cn(ds.textMuted, 'text-[10px]')}>{c.date}</span>
                      </div>
                      <p className="text-xs text-gray-300 line-clamp-2">{c.text}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
                <div className="flex items-center gap-2">
                  {proofStatusIcon(proofSt)}
                  <span className={cn(ds.textMuted, 'text-xs capitalize')}>{proofSt.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Budget Tracker
  // ---------------------------------------------------------------------------
  const renderBudget = () => {
    const categories = ['talent', 'equipment', 'location', 'post_production', 'licensing'];
    const projectBudgets = allProjects.map(p => {
      const d = p.data as Record<string, unknown>;
      const projectLines = filtered.filter(l => (l.data as Record<string, unknown>).project === String(d.client) + ' ' + p.title || String((l.data as Record<string, unknown>).project).includes(String(d.client)));
      const lineEstimated = projectLines.reduce((s, l) => s + Number((l.data as Record<string, unknown>).estimated || 0), 0);
      const lineActual = projectLines.reduce((s, l) => s + Number((l.data as Record<string, unknown>).actual || 0), 0);
      return { ...p, lineEstimated, lineActual };
    });

    const totalEstimated = filtered.reduce((s, i) => s + Number((i.data as Record<string, unknown>).estimated || 0), 0);
    const totalActual = filtered.reduce((s, i) => s + Number((i.data as Record<string, unknown>).actual || 0), 0);
    const overBudgetItems = filtered.filter(i => {
      const d = i.data as Record<string, unknown>;
      return Number(d.actual || 0) > Number(d.estimated || 0);
    });

    return (
      <div className="space-y-4">
        {/* Budget summary cards */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Total Estimated</p>
            <p className="text-2xl font-bold">{fmtCurrency(totalEstimated)}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Total Actual</p>
            <p className="text-2xl font-bold">{fmtCurrency(totalActual)}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Variance</p>
            <p className={cn('text-2xl font-bold flex items-center gap-1', totalEstimated - totalActual >= 0 ? 'text-green-400' : 'text-red-400')}>
              {totalEstimated - totalActual >= 0 ? <ArrowDownRight className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
              {fmtCurrency(Math.abs(totalEstimated - totalActual))}
            </p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Over Budget Items</p>
            <p className={cn('text-2xl font-bold', overBudgetItems.length > 0 ? 'text-red-400' : 'text-green-400')}>{overBudgetItems.length}</p>
          </div>
        </div>

        {/* Category breakdown */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>By Category</h3>
          <div className="space-y-3">
            {categories.map(cat => {
              const catItems = filtered.filter(i => (i.data as Record<string, unknown>).category === cat);
              const est = catItems.reduce((s, i) => s + Number((i.data as Record<string, unknown>).estimated || 0), 0);
              const act = catItems.reduce((s, i) => s + Number((i.data as Record<string, unknown>).actual || 0), 0);
              const pct = est > 0 ? act / est : 0;
              return (
                <div key={cat} className="flex items-center gap-3">
                  {budgetCategoryIcon(cat)}
                  <span className="w-28 text-sm capitalize text-gray-300">{cat.replace(/_/g, ' ')}</span>
                  <div className="flex-1 bg-lattice-elevated rounded-full h-3">
                    <div className={cn('h-3 rounded-full transition-all', pct > 1 ? 'bg-red-400' : pct > 0.8 ? 'bg-amber-400' : 'bg-neon-cyan')} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                  </div>
                  <span className="w-24 text-right text-sm text-gray-300">{fmtCurrency(act)}</span>
                  <span className={cn(ds.textMuted, 'w-24 text-right text-xs')}>/ {fmtCurrency(est)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-project budget breakdown */}
        {projectBudgets.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Per-Project Budgets</h3>
            <div className="space-y-3">
              {projectBudgets.map(pb => {
                const pct = pb.lineEstimated > 0 ? pb.lineActual / pb.lineEstimated : 0;
                return (
                  <div key={pb.id} className="flex items-center gap-3">
                    <span className="w-40 text-sm text-gray-300 truncate">{pb.title}</span>
                    <div className="flex-1 bg-lattice-elevated rounded-full h-3">
                      <div className={cn('h-3 rounded-full transition-all', pct > 1 ? 'bg-red-400' : pct > 0.8 ? 'bg-amber-400' : 'bg-neon-cyan')} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                    </div>
                    <span className="w-24 text-right text-sm text-gray-300">{fmtCurrency(pb.lineActual)}</span>
                    <span className={cn('w-24 text-right text-xs text-gray-500')}>/ {fmtCurrency(pb.lineEstimated)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Line items table */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Line Items</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border text-left">
                  <th className={cn(ds.textMuted, 'pb-2 font-medium')}>Item</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium')}>Project</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium')}>Category</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium text-right')}>Estimated</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium text-right')}>Actual</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium text-right')}>Variance</th>
                  <th className={cn(ds.textMuted, 'pb-2 font-medium text-center')}>Invoiced</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const d = item.data as Record<string, unknown>;
                  const est = Number(d.estimated || 0);
                  const act = Number(d.actual || 0);
                  const variance = est - act;
                  const invoiced = d.invoiced === true || d.invoiced === 'true';
                  return (
                    <tr key={item.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30 cursor-pointer" onClick={() => openDetail(item)}>
                      <td className="py-2.5 text-white font-medium">{item.title}</td>
                      <td className="py-2.5 text-gray-400">{String(d.project)}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          {budgetCategoryIcon(String(d.category))}
                          <span className="text-gray-300 capitalize">{String(d.category || '').replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-gray-300">{fmtCurrency(est)}</td>
                      <td className="py-2.5 text-right text-white font-medium">{fmtCurrency(act)}</td>
                      <td className={cn('py-2.5 text-right font-medium', variance >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {variance >= 0 ? '+' : ''}{fmtCurrency(variance)}
                      </td>
                      <td className="py-2.5 text-center">
                        {invoiced ? <CheckCircle2 className="w-4 h-4 text-green-400 mx-auto" /> : <Minus className="w-4 h-4 text-gray-600 mx-auto" />}
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1 justify-end">
                          <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={ds.btnGhost}><Edit2 className="w-3 h-3" /></button>
                          <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Distribution Checklist
  // ---------------------------------------------------------------------------
  const renderDistribution = () => {
    const platforms = [...new Set(filtered.map(i => String((i.data as Record<string, unknown>).platform)))];
    const completedCount = filtered.filter(i => (i.data as Record<string, unknown>).completed === true || (i.data as Record<string, unknown>).completed === 'true').length;

    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className={ds.grid3}>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Total Deliverables</p>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Completed</p>
            <p className="text-2xl font-bold text-green-400">{completedCount}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Remaining</p>
            <p className="text-2xl font-bold text-amber-400">{filtered.length - completedCount}</p>
          </div>
        </div>

        {/* Platform grouped view */}
        {platforms.map(platform => {
          const platItems = filtered.filter(i => String((i.data as Record<string, unknown>).platform) === platform);
          const platDone = platItems.filter(i => (i.data as Record<string, unknown>).completed === true || (i.data as Record<string, unknown>).completed === 'true').length;
          const platIcon = platform === 'Instagram' || platform === 'LinkedIn' || platform === 'TikTok'
            ? <Share2 className="w-4 h-4 text-neon-purple" />
            : platform === 'YouTube' ? <Play className="w-4 h-4 text-red-400" />
            : platform === 'Web' ? <Globe className="w-4 h-4 text-neon-cyan" />
            : platform === 'Print' ? <Printer className="w-4 h-4 text-amber-400" />
            : platform === 'Podcast' ? <Mic className="w-4 h-4 text-pink-400" />
            : <Monitor className="w-4 h-4 text-gray-400" />;

          return (
            <div key={platform} className={ds.panel}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {platIcon}
                  <h3 className={ds.heading3}>{platform}</h3>
                  <span className={cn(ds.textMuted, 'text-xs')}>{platDone}/{platItems.length} complete</span>
                </div>
                <div className="w-32 bg-lattice-elevated rounded-full h-2">
                  <div className="h-2 rounded-full bg-green-400" style={{ width: platItems.length > 0 ? `${(platDone / platItems.length) * 100}%` : '0%' }} />
                </div>
              </div>
              <div className="space-y-2">
                {platItems.map(item => {
                  const d = item.data as Record<string, unknown>;
                  const done = d.completed === true || d.completed === 'true';
                  return (
                    <div key={item.id} className={cn('flex items-center gap-3 p-3 rounded-lg', done ? 'bg-green-500/5 border border-green-500/20' : 'bg-lattice-elevated/30 border border-lattice-border')}>
                      <button
                        onClick={() => {
                          update(item.id, { data: { ...d, completed: !done } });
                        }}
                        className={cn('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors', done ? 'border-green-400 bg-green-400/20' : 'border-gray-500 hover:border-neon-cyan')}
                      >
                        {done && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium', done ? 'text-gray-500 line-through' : 'text-white')}>{item.title}</p>
                        <p className={cn(ds.textMuted, 'text-xs')}>{String(d.format)} &middot; {String(d.project)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn(ds.textMuted, 'text-xs')}>{String(d.requirement).substring(0, 40)}{String(d.requirement).length > 40 ? '...' : ''}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(item)} className={ds.btnGhost}><Edit2 className="w-3 h-3" /></button>
                        <button onClick={() => remove(item.id)} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Detail Modal
  // ---------------------------------------------------------------------------
  const renderDetailModal = () => {
    if (!showDetail || !detailItem) return null;
    const d = detailItem.data as Record<string, unknown>;
    const currentMode = mode;
    const tags = Array.isArray(detailItem.meta?.tags)
      ? detailItem.meta.tags.map((tag) => String(tag))
      : [];
    const renderFieldValue = (value: unknown): string => {
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      if (value == null) return '—';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };
    const dataFields = Object.entries(d)
      .filter(([k]) => !['milestones', 'teamMembers', 'versionHistory', 'comments'].includes(k))
      .map(([k, v]) => ({
        key: k,
        label: k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '),
        value: renderFieldValue(v),
      }));

    return (
      <>
        <div className={ds.modalBackdrop} onClick={() => setShowDetail(false)} />
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-2xl')}>
            <div className="flex items-center justify-between p-4 border-b border-lattice-border">
              <h2 className={ds.heading2}>{detailItem.title}</h2>
              <button onClick={() => setShowDetail(false)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className={ds.badge(STATUS_COLORS[detailItem.meta?.status as string] || 'gray-400')}>
                  {String(detailItem.meta?.status || '').replace(/_/g, ' ')}
                </span>
                {tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded text-xs bg-lattice-elevated text-gray-400">#{tag}</span>
                ))}
              </div>

              {/* All data fields */}
              <div className="grid grid-cols-2 gap-3">
                {dataFields.map((field) => (
                  <div key={field.key}>
                    <p className={cn(ds.label, 'text-xs capitalize')}>{field.label}</p>
                    <p className="text-sm text-white">{field.value}</p>
                  </div>
                ))}
              </div>

              {/* Milestones (projects) */}
              {Boolean(d.milestones) && (
                <div>
                  <h3 className={cn(ds.heading3, 'text-sm mb-2')}>Milestones</h3>
                  <div className="space-y-1.5">
                    {parseSafe<{ name: string; date: string; done: boolean }[]>(d.milestones, []).map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        {m.done ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" /> : <CircleDot className="w-4 h-4 text-gray-500 shrink-0" />}
                        <span className={cn(m.done ? 'text-gray-500' : 'text-white')}>{m.name}</span>
                        <span className={cn(ds.textMuted, 'ml-auto text-xs')}>{m.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team (projects) */}
              {Boolean(d.teamMembers) && (
                <div>
                  <h3 className={cn(ds.heading3, 'text-sm mb-2')}>Team</h3>
                  <div className="flex flex-wrap gap-2">
                    {parseSafe<string[]>(d.teamMembers, []).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-lattice-elevated border border-lattice-border">
                        <div className="w-6 h-6 rounded-full bg-neon-purple/20 flex items-center justify-center text-[10px] text-neon-purple font-medium">
                          {t.split(' ').map(w => w[0]).join('')}
                        </div>
                        <span className="text-sm text-gray-300">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Version history (assets) */}
              {Boolean(d.versionHistory) && (
                <div>
                  <h3 className={cn(ds.heading3, 'text-sm mb-2')}>Version History</h3>
                  <div className="space-y-2">
                    {parseSafe<{ v: number; date: string; note: string }[]>(d.versionHistory, []).map((vh, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded bg-lattice-elevated/50">
                        <span className={cn(ds.textMono, 'text-xs text-neon-blue')}>v{vh.v}</span>
                        <span className={cn(ds.textMuted, 'text-xs')}>{vh.date}</span>
                        <span className="text-sm text-gray-300">{vh.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments (proofs) */}
              {Boolean(d.comments) && (
                <div>
                  <h3 className={cn(ds.heading3, 'text-sm mb-2')}>Comment Thread</h3>
                  <div className="space-y-2">
                    {parseSafe<{ author: string; date: string; text: string }[]>(d.comments, []).map((c, i) => (
                      <div key={i} className="p-3 rounded-lg bg-lattice-elevated/50 border border-lattice-border">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">{c.author}</span>
                          <span className={cn(ds.textMuted, 'text-xs')}>{c.date}</span>
                        </div>
                        <p className="text-sm text-gray-300">{c.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Domain actions */}
              <div className="pt-3 border-t border-lattice-border">
                <p className={cn(ds.textMuted, 'text-xs mb-2')}>Actions</p>
                <div className="flex flex-wrap gap-2">
                  {currentMode === 'projects' && (
                    <>
                      <button onClick={() => handleAction('project_summary', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><ClipboardList className="w-3 h-3" /> Project Summary</button>
                      <button onClick={() => handleAction('generate_shot_list', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><Clapperboard className="w-3 h-3" /> Generate Shot List</button>
                      <button onClick={() => handleAction('budget_analysis', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><DollarSign className="w-3 h-3" /> Budget Analysis</button>
                    </>
                  )}
                  {currentMode === 'assets' && (
                    <button onClick={() => handleAction('asset_report', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><BarChart3 className="w-3 h-3" /> Asset Report</button>
                  )}
                  {currentMode === 'proofs' && (
                    <button onClick={() => handleAction('project_summary', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><ClipboardList className="w-3 h-3" /> Generate Summary</button>
                  )}
                  {currentMode === 'revisions' && (
                    <button onClick={() => handleAction('revision_summary', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><ClipboardList className="w-3 h-3" /> Revision Summary</button>
                  )}
                  {currentMode === 'distribution' && (
                    <button onClick={() => handleAction('distribution_checklist', detailItem.id)} className={cn(ds.btnSecondary, ds.btnSmall, 'text-xs')} disabled={runAction.isPending}><ListChecks className="w-3 h-3" /> Checklist Report</button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-lattice-border">
              <button onClick={() => { setShowDetail(false); openEdit(detailItem); }} className={ds.btnSecondary}><Edit2 className="w-4 h-4" /> Edit</button>
              <button onClick={() => setShowDetail(false)} className={ds.btnPrimary}>Close</button>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ---------------------------------------------------------------------------
  // Main Render
  // ---------------------------------------------------------------------------
  return (
    <div data-lens-theme="creative" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Palette className="w-7 h-7 text-neon-purple" />
          <div>
            <h1 className={ds.heading1}>Creative Production</h1>
            <p className={ds.textMuted}>Projects, assets, shot lists, client proofing, budgets and distribution</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="creative" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running action...</span>}
          {mode !== 'dashboard' && (
            <button onClick={openCreate} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
          )}
        </div>
      </header>


      <FeedBanner domain="creative" />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Projects', value: allProjects.length, icon: Palette },
          { label: 'Assets', value: allAssets.length, icon: Camera },
          { label: 'Collaborators', value: new Set(allProjects.flatMap(p => (Array.isArray((p.data as Record<string, unknown>).teamMembers) ? (p.data as Record<string, unknown>).teamMembers as string[] : []))).size, icon: Users },
          { label: 'In Review', value: allProofs.filter(p => p.meta?.status === 'pending_review').length, icon: Eye },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-purple shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="creative" artifactId={allProjects[0]?.id} compact />
      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setSearch(''); setStatusFilter('all'); setCategoryFilter('all'); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                mode === tab.id ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Filters (non-dashboard) */}
      {mode !== 'dashboard' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${currentType.toLowerCase()}s...`} className={cn(ds.input, 'pl-10')} />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={cn(ds.select, 'pl-10 pr-8')}>
              <option value="all">All statuses</option>
              {mode === 'proofs'
                ? ['pending_review', 'approved', 'revision_requested'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                : mode === 'shotlist'
                ? ['planned', 'scheduled', 'in_progress', 'captured', 'review', 'final'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                : ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
              }
            </select>
          </div>
        </div>
      )}

      {/* Content */}
      {mode === 'dashboard' ? renderDashboard() : isLoading ? (
        <div className="text-center py-12"><p className={ds.textMuted}>Loading...</p></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <ImageIcon className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {currentType.toLowerCase()}s found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}><Plus className="w-4 h-4" /> Create one</button>
        </div>
      ) : (
        <>
          {mode === 'projects' && renderProjects()}
          {mode === 'assets' && renderAssets()}
          {mode === 'revisions' && renderRevisions()}
          {mode === 'shotlist' && renderShotList()}
          {mode === 'proofs' && renderProofs()}
          {mode === 'budget' && renderBudget()}
          {mode === 'distribution' && renderDistribution()}
        </>
      )}

      {/* Action Result Panel */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-48')}>{JSON.stringify(actionResult, null, 2)}</pre>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={resetForm} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>{editing ? 'Edit' : 'New'} {currentType}</h2>
                <button onClick={resetForm} className={ds.btnGhost}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className={ds.input} placeholder={`${currentType} title`} />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select value={formStatus} onChange={e => setFormStatus(e.target.value)} className={ds.select}>
                    {mode === 'proofs'
                      ? ['pending_review', 'approved', 'revision_requested'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                      : mode === 'shotlist'
                      ? ['planned', 'scheduled', 'in_progress', 'captured', 'review', 'final'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                      : mode === 'revisions'
                      ? ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                      : ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)
                    }
                  </select>
                </div>
                {(formConfig[mode] || []).map(field => (
                  <div key={field.key}>
                    <label className={ds.label}>{field.label}</label>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={formFields[field.key] || ''}
                        onChange={e => setFormFields(f => ({ ...f, [field.key]: e.target.value }))}
                        className={ds.textarea}
                        rows={3}
                      />
                    ) : field.type === 'select' && field.options ? (
                      <select
                        value={formFields[field.key] || ''}
                        onChange={e => setFormFields(f => ({ ...f, [field.key]: e.target.value }))}
                        className={ds.select}
                      >
                        <option value="">Select...</option>
                        {field.options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                      </select>
                    ) : (
                      <input
                        value={formFields[field.key] || ''}
                        onChange={e => setFormFields(f => ({ ...f, [field.key]: e.target.value }))}
                        className={ds.input}
                        placeholder={field.label}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between p-4 border-t border-lattice-border">
                <div>
                  {editing && (
                    <button onClick={() => { remove(editing); resetForm(); }} className={ds.btnDanger}>
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={resetForm} className={ds.btnSecondary}>Cancel</button>
                  <button onClick={handleSave} className={ds.btnPrimary} disabled={!formTitle.trim()}>
                    {editing ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detail Modal */}
      {renderDetailModal()}

      {/* Pipeline overview */}
      {mode !== 'dashboard' && mode !== 'budget' && mode !== 'distribution' && (
        <section>
          <h2 className={cn(ds.heading2, 'mb-3')}>Pipeline</h2>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 flex-wrap pb-2">
              {(mode === 'shotlist'
                ? ['planned', 'scheduled', 'in_progress', 'captured', 'review', 'final']
                : mode === 'proofs'
                ? ['pending_review', 'revision_requested', 'approved']
                : mode === 'revisions'
                ? ALL_STATUSES as unknown as string[]
                : ALL_STATUSES as unknown as string[]
              ).map(status => {
                const count = items.filter(i => i.meta?.status === status || (mode === 'proofs' && (i.data as Record<string, unknown>).proofStatus === status)).length;
                return (
                  <div key={status} className="flex-1 min-w-[100px] text-center p-3 rounded-lg bg-lattice-elevated/50">
                    <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>{status.replace(/_/g, ' ')}</span>
                    <p className="text-2xl font-bold mt-2">{count}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* DTU Context & Artifacts Panel */}
      {mode === 'dashboard' && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {creativeArtifacts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase">Creative Artifacts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {creativeArtifacts.slice(0, 4).map((dtu: DTU) => (
                    <div key={dtu.id} className="p-3 rounded-lg bg-lattice-elevated/50 border border-lattice-border space-y-2">
                      <p className="text-sm font-medium truncate">{dtu.title || dtu.human?.summary || 'Untitled'}</p>
                      <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                      <FeedbackWidget targetType="dtu" targetId={dtu.id} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ArtifactUploader lens="creative" acceptTypes="image/*,video/*,audio/*" multi onUploadComplete={() => refetchDTUs()} />
          </div>
          <div>
            <LensContextPanel
              hyperDTUs={hyperDTUs}
              megaDTUs={megaDTUs}
              regularDTUs={regularDTUs}
              tierDistribution={tierDistribution}
              onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
              title="Creative DTUs"
            />
            <div className="mt-4">
              <FeedbackWidget targetType="lens" targetId="creative" />
            </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="creative"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
          </div>
        </section>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="creative_production" />
          </div>
        )}
      </div>
    </div>
  );
}
