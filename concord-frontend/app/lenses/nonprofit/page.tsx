'use client';

import { motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { SessionRail } from '@/components/lens/SessionRail';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PropublicaSearch } from '@/components/nonprofit/PropublicaSearch';
import { NonprofitActionPanel } from '@/components/nonprofit/NonprofitActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Heart, FileText, HeartHandshake, Megaphone, BarChart3,
  Plus, Search, Filter, X, Edit2, Trash2,
  DollarSign, Clock, TrendingUp, AlertTriangle, CheckCircle2,
  Calendar, Mail, Gift, Repeat,
  Briefcase, PieChart, ArrowUpRight, ArrowDownRight,
  ChevronRight, ChevronDown, Eye, Download, Send, Bell,
  Building2, User, HelpingHand, ClipboardList,
  Wallet, Sparkles, LayoutDashboard,
  UserCheck, CalendarClock, RefreshCw, Banknote,
  FileBarChart, CircleDollarSign, ShieldCheck, Milestone,
  Layers,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'dashboard' | 'donors' | 'gifts' | 'grants' | 'campaigns' | 'volunteers' | 'impact' | 'funds';
type ArtifactType = 'Donor' | 'Gift' | 'Grant' | 'Campaign' | 'Volunteer' | 'ImpactMetric' | 'Fund';

type DonorLevel = 'major' | 'mid' | 'annual' | 'sustaining' | 'prospect' | 'leadership' | 'partner';
type GrantStage = 'prospect' | 'loi' | 'application' | 'submitted' | 'awarded' | 'reporting' | 'closed' | 'declined';
type CampaignStatus = 'planning' | 'active' | 'completed' | 'paused';
type GeneralStatus = 'active' | 'inactive' | 'pending' | 'lapsed' | 'prospect';
type GiftPaymentMethod = 'check' | 'credit_card' | 'ach' | 'cash' | 'stock' | 'daf' | 'wire' | 'crypto';

const GRANT_STAGES: GrantStage[] = ['prospect', 'loi', 'application', 'submitted', 'awarded', 'reporting', 'closed', 'declined'];
const CAMPAIGN_STATUSES: CampaignStatus[] = ['planning', 'active', 'completed', 'paused'];
const GENERAL_STATUSES: GeneralStatus[] = ['active', 'inactive', 'pending', 'lapsed', 'prospect'];
const _DONOR_LEVELS: DonorLevel[] = ['major', 'mid', 'annual', 'sustaining', 'prospect', 'leadership', 'partner'];
const PAYMENT_METHODS: GiftPaymentMethod[] = ['check', 'credit_card', 'ach', 'cash', 'stock', 'daf', 'wire', 'crypto'];

const STATUS_COLORS: Record<string, string> = {
  prospect: 'neon-blue', loi: 'neon-purple', application: 'amber-400',
  submitted: 'neon-cyan', awarded: 'green-400', reporting: 'neon-purple',
  closed: 'gray-500', declined: 'red-400',
  planning: 'gray-400', active: 'green-400', completed: 'neon-cyan', paused: 'amber-400',
  inactive: 'gray-500', lapsed: 'red-400', pending: 'amber-400',
  major: 'amber-400', mid: 'neon-cyan', annual: 'green-400',
  sustaining: 'neon-blue', leadership: 'neon-purple', partner: 'neon-pink',
  // Gift acknowledgment
  acknowledged: 'green-400', unacknowledged: 'red-400',
  // Fund types
  restricted: 'amber-400', unrestricted: 'green-400', temporarily_restricted: 'neon-cyan',
};

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Heart; type: ArtifactType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, type: 'Donor' },
  { id: 'donors', label: 'Donors', icon: Heart, type: 'Donor' },
  { id: 'gifts', label: 'Gifts', icon: Gift, type: 'Gift' },
  { id: 'grants', label: 'Grants', icon: FileText, type: 'Grant' },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone, type: 'Campaign' },
  { id: 'volunteers', label: 'Volunteers', icon: HeartHandshake, type: 'Volunteer' },
  { id: 'impact', label: 'Impact', icon: BarChart3, type: 'ImpactMetric' },
  { id: 'funds', label: 'Funds', icon: Wallet, type: 'Fund' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(d: string | undefined): string {
  if (!d) return 'N/A';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
}

function daysUntil(d: string | undefined): number {
  if (!d) return Infinity;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function progressPct(current: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((current / goal) * 100));
}

function progressBarColor(pct: number): string {
  if (pct >= 100) return 'bg-green-400';
  if (pct >= 75) return 'bg-neon-cyan';
  if (pct >= 50) return 'bg-amber-400';
  return 'bg-red-400';
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const SEED: Record<ArtifactType, Array<{ title: string; data: Record<string, unknown>; meta: Record<string, unknown> }>> = {
  Donor: [],
  Gift: [],
  Grant: [],
  Volunteer: [],
  Campaign: [],
  ImpactMetric: [],
  Fund: [],
};

// ---------------------------------------------------------------------------
// Domain Actions
// ---------------------------------------------------------------------------
const DOMAIN_ACTIONS = [
  { id: 'donor-retention-report', label: 'Donor Retention Report', icon: RefreshCw, description: 'Analyze donor retention and churn patterns' },
  { id: 'grant-deadline-check', label: 'Grant Deadline Check', icon: CalendarClock, description: 'Review upcoming grant deadlines and reporting dates' },
  { id: 'campaign-analysis', label: 'Campaign Analysis', icon: PieChart, description: 'Analyze campaign performance and ROI' },
  { id: 'volunteer-match', label: 'Volunteer Match', icon: UserCheck, description: 'Match volunteers to open opportunities' },
  { id: 'impact-report', label: 'Impact Report', icon: FileBarChart, description: 'Generate comprehensive impact report' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function NonprofitLensPage() {
  useLensNav('nonprofit');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('nonprofit');

  const [showFeatures, setShowFeatures] = useState(true);
  const [mode, setMode] = useState<ModeTab>('dashboard');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setMode('dashboard') },
      { id: 'tab-gifts', keys: 'g', description: 'Gifts', category: 'navigation', action: () => setMode('gifts') },
      { id: 'tab-grants', keys: 'r', description: 'Grants', category: 'navigation', action: () => setMode('grants') },
      { id: 'tab-donors', keys: 'o', description: 'Donors', category: 'navigation', action: () => setMode('donors') },
      { id: 'tab-campaigns', keys: 'c', description: 'Campaigns', category: 'navigation', action: () => setMode('campaigns') },
      { id: 'tab-volunteers', keys: 'v', description: 'Volunteers', category: 'navigation', action: () => setMode('volunteers') },
      { id: 'tab-impact', keys: 'i', description: 'Impact', category: 'navigation', action: () => setMode('impact') },
    ],
    { lensId: 'nonprofit' }
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [detailItem, setDetailItem] = useState<LensItem | null>(null);
  const [showGiftEntry, setShowGiftEntry] = useState(false);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [expandedGrant, setExpandedGrant] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // Gift entry form
  const [giftDonor, setGiftDonor] = useState('');
  const [giftAmount, setGiftAmount] = useState('');
  const [giftDate, setGiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [giftFund, setGiftFund] = useState('General Operating');
  const [giftCampaign, setGiftCampaign] = useState('');
  const [giftMethod, setGiftMethod] = useState<GiftPaymentMethod>('check');
  const [giftRecurring, setGiftRecurring] = useState(false);
  const [giftMatching, setGiftMatching] = useState(false);
  const [giftNotes, setGiftNotes] = useState('');

  const currentTab = MODE_TABS.find(t => t.id === mode)!;
  const currentType = mode === 'dashboard' ? 'Donor' : currentTab.type;

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData('nonprofit', currentType, {
    seed: SEED[currentType],
  });

  // Dashboard data — fetch each artifact type for metrics
  const { items: allDonors } = useLensData('nonprofit', 'Donor', { seed: SEED.Donor, noSeed: mode !== 'dashboard' });
  const { items: allGifts } = useLensData('nonprofit', 'Gift', { seed: SEED.Gift, noSeed: mode !== 'dashboard' });
  const { items: allGrants } = useLensData('nonprofit', 'Grant', { seed: SEED.Grant, noSeed: mode !== 'dashboard' });
  const { items: allCampaigns } = useLensData('nonprofit', 'Campaign', { seed: SEED.Campaign, noSeed: mode !== 'dashboard' });
  const { items: allVolunteers } = useLensData('nonprofit', 'Volunteer', { seed: SEED.Volunteer, noSeed: mode !== 'dashboard' });
  const { items: allFunds } = useLensData('nonprofit', 'Fund', { seed: SEED.Fund, noSeed: mode !== 'dashboard' });

  const runAction = useRunArtifact('nonprofit');

  // Filtered items
  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || JSON.stringify(i.data).toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => i.meta?.status === statusFilter);
    }
    return list;
  }, [items, search, statusFilter]);

  // Status options per mode
  const statusOptions = useMemo(() => {
    switch (mode) {
      case 'grants': return GRANT_STAGES;
      case 'campaigns': return CAMPAIGN_STATUSES;
      case 'donors': return GENERAL_STATUSES;
      default: return GENERAL_STATUSES;
    }
  }, [mode]);

  // Dashboard metrics (computed from fetched data)
  const metrics = useMemo(() => {
    const donors = allDonors as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;
    const gifts = allGifts as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;
    const grants = allGrants as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;
    const campaigns = allCampaigns as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;
    const volunteers = allVolunteers as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;
    const funds = allFunds as Array<{ data: Record<string, unknown>; meta: Record<string, unknown> }>;

    const totalRaisedYTD = campaigns.reduce((s, c) => s + ((c.data.raised as number) || 0), 0);
    const totalDonors = donors.length;
    const activeDonors = donors.filter(d => d.meta.status === 'active').length;
    const retentionRate = totalDonors > 0 ? Math.round((activeDonors / totalDonors) * 100) : 0;
    const totalVolunteerHours = volunteers.reduce((s, v) => s + ((v.data.hoursThisYear as number) || 0), 0);
    const pendingAcks = gifts.filter(g => !(g.data.acknowledged as boolean)).length;
    const upcomingDeadlines = grants.filter(g => {
      const d = daysUntil(g.data.deadline as string);
      return d > 0 && d <= 60;
    });
    const lybuntDonors = donors.filter(d => d.data.lybunt as boolean).length;
    const sybuntDonors = donors.filter(d => d.data.sybunt as boolean).length;
    const totalPledgeBalance = donors.reduce((s, d) => s + ((d.data.pledgeBalance as number) || 0), 0);
    const totalGrantPipeline = grants.reduce((s, g) => s + ((g.data.amount as number) || 0), 0);
    const totalFundBalance = funds.reduce((s, f) => s + ((f.data.balance as number) || 0), 0);
    const volunteerValue = totalVolunteerHours * 31.80;

    return {
      totalRaisedYTD, totalDonors, activeDonors, retentionRate,
      totalVolunteerHours, pendingAcks, upcomingDeadlines,
      lybuntDonors, sybuntDonors, totalPledgeBalance,
      totalGrantPipeline, totalFundBalance, volunteerValue,
    };
  }, [allDonors, allGifts, allGrants, allCampaigns, allVolunteers, allFunds]);

  // Form helpers
  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormStatus('active');
    setFormFields({});
    setEditing(null);
    setShowEditor(false);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setShowEditor(true);
  }, [resetForm]);

  const openEdit = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setEditing(id);
    setFormTitle(item.title);
    setFormStatus(item.meta?.status || 'active');
    const d = item.data as Record<string, unknown>;
    const fields: Record<string, string> = {};
    Object.entries(d).forEach(([k, v]) => { fields[k] = String(v ?? ''); });
    setFormFields(fields);
    setShowEditor(true);
  }, [items]);

  const openDetail = useCallback((item: LensItem) => {
    setDetailItem(item);
  }, []);

  const handleSave = async () => {
    const data: Record<string, unknown> = {};
    Object.entries(formFields).forEach(([k, v]) => {
      data[k] = v;
    });

    if (editing) {
      await update(editing, { title: formTitle, data, meta: { status: formStatus } });
    } else {
      await create({ title: formTitle, data, meta: { status: formStatus } });
    }
    resetForm();
  };

  const handleGiftSave = async () => {
    if (!giftDonor.trim() || !giftAmount.trim() || Number(giftAmount) <= 0) return;
    await create({
      title: `${giftDonor} - ${fmtCurrency(Number(giftAmount))}`,
      data: {
        donorName: giftDonor, amount: Number(giftAmount), date: giftDate,
        fund: giftFund, campaign: giftCampaign, paymentMethod: giftMethod,
        recurring: giftRecurring, matchingGift: giftMatching,
        acknowledged: false, notes: giftNotes,
      },
      meta: { status: 'active' },
    });
    setShowGiftEntry(false);
    setGiftDonor(''); setGiftAmount(''); setGiftNotes('');
    setGiftDate(new Date().toISOString().split('T')[0]);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  // Field config per mode
  const formFieldConfig: Record<ModeTab, Array<{ key: string; label: string; type?: string }>> = {
    dashboard: [],
    donors: [
      { key: 'type', label: 'Donor Type' }, { key: 'level', label: 'Donor Level' },
      { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' }, { key: 'communicationPref', label: 'Communication Preference' },
      { key: 'frequency', label: 'Gift Frequency' }, { key: 'assignedTo', label: 'Assigned To' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    gifts: [
      { key: 'donorName', label: 'Donor Name' }, { key: 'amount', label: 'Amount ($)' },
      { key: 'date', label: 'Date' }, { key: 'fund', label: 'Fund Designation' },
      { key: 'campaign', label: 'Campaign' }, { key: 'paymentMethod', label: 'Payment Method' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    grants: [
      { key: 'funder', label: 'Funder' }, { key: 'amount', label: 'Amount ($)' },
      { key: 'program', label: 'Program Area' }, { key: 'deadline', label: 'Deadline' },
      { key: 'contactName', label: 'Contact Name' }, { key: 'contactEmail', label: 'Contact Email' },
      { key: 'reportingFrequency', label: 'Reporting Frequency' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    campaigns: [
      { key: 'type', label: 'Campaign Type' }, { key: 'goal', label: 'Goal ($)' },
      { key: 'channel', label: 'Channel' }, { key: 'startDate', label: 'Start Date' },
      { key: 'endDate', label: 'End Date' }, { key: 'appealsSent', label: 'Appeals Sent' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    volunteers: [
      { key: 'role', label: 'Role' }, { key: 'skills', label: 'Skills' },
      { key: 'availability', label: 'Availability' }, { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' }, { key: 'currentAssignment', label: 'Current Assignment' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    impact: [
      { key: 'category', label: 'Category' }, { key: 'value', label: 'Current Value' },
      { key: 'target', label: 'Target' }, { key: 'unit', label: 'Unit' },
      { key: 'program', label: 'Program' }, { key: 'period', label: 'Period' },
      { key: 'successStory', label: 'Success Story', type: 'textarea' },
    ],
    funds: [
      { key: 'type', label: 'Fund Type' }, { key: 'balance', label: 'Balance ($)' },
      { key: 'budgeted', label: 'Budget ($)' }, { key: 'restrictions', label: 'Restrictions' },
      { key: 'allocations', label: 'Allocations' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  };

  // Loading state
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

  // Error state
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
      {/* KPI Cards Row 1 */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span className={ds.textMuted}>Total Raised YTD</span>
          </div>
          <p className="text-2xl font-bold text-green-400">{fmtCurrency(metrics.totalRaisedYTD)}</p>
          <div className="flex items-center gap-1 mt-1">
            <ArrowUpRight className="w-3 h-3 text-green-400" />
            <span className="text-xs text-green-400">+12% vs prior year</span>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="w-4 h-4 text-neon-cyan" />
            <span className={ds.textMuted}>Donor Retention Rate</span>
          </div>
          <p className="text-2xl font-bold text-neon-cyan">{metrics.retentionRate}%</p>
          <p className="text-xs text-gray-500 mt-1">{metrics.activeDonors} of {metrics.totalDonors} donors active</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-neon-purple" />
            <span className={ds.textMuted}>Volunteer Hours (Month)</span>
          </div>
          <p className="text-2xl font-bold">{metrics.totalVolunteerHours.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">Valued at {fmtCurrency(metrics.volunteerValue)}</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-4 h-4 text-amber-400" />
            <span className={ds.textMuted}>Pending Acknowledgments</span>
          </div>
          <p className={cn("text-2xl font-bold", metrics.pendingAcks > 0 ? "text-amber-400" : "text-green-400")}>
            {metrics.pendingAcks}
          </p>
          <p className="text-xs text-gray-500 mt-1">{metrics.pendingAcks > 0 ? 'Require attention' : 'All caught up'}</p>
        </div>
      </div>

      {/* KPI Cards Row 2 */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="w-4 h-4 text-neon-blue" />
            <span className={ds.textMuted}>Grant Pipeline</span>
          </div>
          <p className="text-2xl font-bold">{fmtCurrency(metrics.totalGrantPipeline)}</p>
          <p className="text-xs text-gray-500 mt-1">{SEED.Grant.length} grants tracked</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className={ds.textMuted}>LYBUNT / SYBUNT</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{metrics.lybuntDonors + metrics.sybuntDonors}</p>
          <p className="text-xs text-gray-500 mt-1">{metrics.lybuntDonors} LYBUNT, {metrics.sybuntDonors} SYBUNT</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <HelpingHand className="w-4 h-4 text-amber-400" />
            <span className={ds.textMuted}>Outstanding Pledges</span>
          </div>
          <p className="text-2xl font-bold">{fmtCurrency(metrics.totalPledgeBalance)}</p>
          <p className="text-xs text-gray-500 mt-1">Across all donors</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-green-400" />
            <span className={ds.textMuted}>Total Fund Balance</span>
          </div>
          <p className="text-2xl font-bold">{fmtCurrency(metrics.totalFundBalance)}</p>
          <p className="text-xs text-gray-500 mt-1">{SEED.Fund.length} funds</p>
        </div>
      </div>

      {/* Campaign Progress + Grant Deadlines */}
      <div className={ds.grid2}>
        <section>
          <h2 className={cn(ds.heading2, 'mb-3')}>Campaign Progress</h2>
          <div className={ds.panel}>
            <div className="divide-y divide-lattice-border">
              {SEED.Campaign.map((c, i) => {
                const pct = progressPct(c.data.raised as number, c.data.goal as number);
                return (
                  <div key={i} className="py-3 px-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-200 font-medium">{c.title}</span>
                      <span className={ds.badge(STATUS_COLORS[c.meta.status as string] || 'gray-400')}>
                        {String(c.meta.status)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>{fmtCurrency(c.data.raised as number)} raised</span>
                      <span>{fmtCurrency(c.data.goal as number)} goal ({pct}%)</span>
                    </div>
                    <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', progressBarColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span>{c.data.donors as number} donors</span>
                      {(c.data.avgGift as number) > 0 && <span>Avg: {fmtCurrency(c.data.avgGift as number)}</span>}
                      {(c.data.newDonors as number) > 0 && <span>{c.data.newDonors as number} new</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <h2 className={cn(ds.heading2, 'mb-3')}>Upcoming Grant Deadlines</h2>
          <div className={ds.panel}>
            <div className="divide-y divide-lattice-border">
              {SEED.Grant
                .filter(g => g.data.deadline || g.data.nextReportDue)
                .sort((a, b) => {
                  const da = (a.data.deadline || a.data.nextReportDue) as string;
                  const db = (b.data.deadline || b.data.nextReportDue) as string;
                  return new Date(da).getTime() - new Date(db).getTime();
                })
                .map((g, i) => {
                  const deadline = (g.data.deadline || g.data.nextReportDue) as string;
                  const days = daysUntil(deadline);
                  const isUrgent = days <= 14;
                  const isWarning = days <= 30;
                  return (
                    <div key={i} className="flex items-center gap-3 py-3 px-1">
                      <div className={cn(
                        'w-2 h-2 rounded-full',
                        isUrgent ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-green-400'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{g.title}</p>
                        <p className={ds.textMuted}>
                          {g.data.deadline ? 'Deadline' : 'Report due'}: {fmtDate(deadline)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={cn(
                          'text-sm font-medium',
                          isUrgent ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-gray-400'
                        )}>
                          {days <= 0 ? 'Overdue' : `${days}d`}
                        </span>
                        <p className={ds.textMuted}>{fmtCurrency(g.data.amount as number)}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </section>
      </div>

      {/* Impact Snapshot + Domain Actions */}
      <div className={ds.grid2}>
        <section>
          <h2 className={cn(ds.heading2, 'mb-3')}>Impact Snapshot</h2>
          <div className={ds.panel}>
            <div className="divide-y divide-lattice-border">
              {SEED.ImpactMetric.map((m, i) => {
                const pct = progressPct(m.data.value as number, m.data.target as number);
                const trend = m.data.trend as string;
                return (
                  <div key={i} className="py-3 px-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-200">{m.title}</span>
                      <div className="flex items-center gap-2">
                        {trend === 'up' && <ArrowUpRight className="w-3 h-3 text-green-400" />}
                        {trend === 'down' && <ArrowDownRight className="w-3 h-3 text-red-400" />}
                        <span className={ds.textMuted}>{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', progressBarColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={cn(ds.textMuted, 'mt-1')}>
                      {(m.data.value as number).toLocaleString()} / {(m.data.target as number).toLocaleString()} {m.data.unit as string}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <h2 className={cn(ds.heading2, 'mb-3')}>Domain Actions</h2>
          <div className="space-y-2">
            {DOMAIN_ACTIONS.map(action => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => handleAction(action.id)}
                  className={cn(ds.panelHover, 'w-full text-left flex items-center gap-3')}
                >
                  <div className="w-10 h-10 rounded-lg bg-neon-blue/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-neon-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">{action.label}</p>
                    <p className={ds.textMuted}>{action.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* Fund Overview */}
      <section>
        <h2 className={cn(ds.heading2, 'mb-3')}>Fund Overview</h2>
        <div className={ds.grid3}>
          {SEED.Fund.map((f, i) => {
            const fundType = f.data.type as string;
            const balance = f.data.balance as number;
            const budgeted = f.data.budgeted as number;
            const spent = f.data.spent as number;
            const pct = budgeted > 0 ? progressPct(spent, budgeted) : 0;
            return (
              <div key={i} className={ds.panel}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={cn(ds.heading3, 'text-sm truncate flex-1')}>{f.title}</h3>
                  <span className={ds.badge(STATUS_COLORS[fundType] || 'gray-400')}>
                    {fundType.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xl font-bold text-white mb-2">{fmtCurrency(balance)}</p>
                {budgeted > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Budget used</span>
                      <span>{fmtCurrency(spent)} / {fmtCurrency(budgeted)} ({pct}%)</span>
                    </div>
                    <div className="w-full h-1.5 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', progressBarColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </>
                )}
                {!!f.data.endowment && (
                  <div className="flex items-center gap-1 mt-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-neon-purple" />
                    <span className="text-xs text-neon-purple">Endowment - Principal restricted</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Donor Cards
  // ---------------------------------------------------------------------------
  const renderDonorCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const level = d.level as string;
    const isLybunt = d.lybunt as boolean;
    const isSybunt = d.sybunt as boolean;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
              d.type === 'Individual' ? 'bg-neon-pink/20' :
              d.type === 'Foundation' ? 'bg-neon-purple/20' :
              'bg-neon-blue/20'
            )}>
              {d.type === 'Individual' ? <User className="w-4 h-4 text-neon-pink" /> :
               d.type === 'Foundation' ? <Building2 className="w-4 h-4 text-neon-purple" /> :
               <Briefcase className="w-4 h-4 text-neon-blue" />}
            </div>
            <div className="min-w-0">
              <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
              <p className={ds.textMuted}>{d.type as string}</p>
            </div>
          </div>
          <span className={ds.badge(STATUS_COLORS[level] || 'gray-400')}>
            {level}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-xs">
          <div>
            <span className="text-gray-500">Lifetime:</span>
            <span className="text-green-400 ml-1 font-medium">{fmtCurrency(d.totalGiven as number)}</span>
          </div>
          <div>
            <span className="text-gray-500">Last Gift:</span>
            <span className="text-gray-300 ml-1">{fmtDate(d.lastGift as string)}</span>
          </div>
          <div>
            <span className="text-gray-500">Frequency:</span>
            <span className="text-gray-300 ml-1">{d.frequency as string}</span>
          </div>
          <div>
            <span className="text-gray-500">Gifts:</span>
            <span className="text-gray-300 ml-1">{d.giftCount as number}</span>
          </div>
        </div>

        {/* Pledge balance */}
        {(d.pledgeBalance as number) > 0 && (
          <div className="flex items-center gap-1 mb-2 text-xs">
            <HelpingHand className="w-3 h-3 text-amber-400" />
            <span className="text-amber-400">Pledge balance: {fmtCurrency(d.pledgeBalance as number)}</span>
          </div>
        )}

        {/* LYBUNT / SYBUNT alerts */}
        {(!!isLybunt || !!isSybunt) && (
          <div className="flex items-center gap-2 mb-2">
            {isLybunt && (
              <span className={ds.badge('red-400')}>
                <AlertTriangle className="w-3 h-3" /> LYBUNT
              </span>
            )}
            {isSybunt && (
              <span className={ds.badge('amber-400')}>
                <AlertTriangle className="w-3 h-3" /> SYBUNT
              </span>
            )}
          </div>
        )}

        {/* Matching gift indicator */}
        {!!d.matchingEmployer && (
          <div className="flex items-center gap-1 mb-2 text-xs">
            <CircleDollarSign className="w-3 h-3 text-neon-cyan" />
            <span className="text-neon-cyan">Match: {d.matchRatio as string} ({d.matchingEmployer as string})</span>
          </div>
        )}

        {/* Communication preference */}
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
          {!!d.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {d.communicationPref as string}</span>}
          {!!d.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.assignedTo as string}</span>}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <div className="flex items-center gap-1">
            {(item.meta?.tags as string[])?.slice(0, 3).map(tag => (
              <span key={tag} className="text-xs bg-lattice-elevated px-1.5 py-0.5 rounded text-gray-400">{tag}</span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Gift Cards
  // ---------------------------------------------------------------------------
  const renderGiftCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const acked = d.acknowledged as boolean;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className={cn(ds.heading3, 'text-sm truncate')}>{d.donorName as string}</h3>
            <p className={ds.textMuted}>{fmtDate(d.date as string)}</p>
          </div>
          <p className="text-lg font-bold text-green-400">{fmtCurrency(d.amount as number)}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-xs">
          <div>
            <span className="text-gray-500">Fund:</span>
            <span className="text-gray-300 ml-1">{d.fund as string}</span>
          </div>
          <div>
            <span className="text-gray-500">Method:</span>
            <span className="text-gray-300 ml-1">{(d.paymentMethod as string).replace(/_/g, ' ')}</span>
          </div>
          {!!d.campaign && (
            <div className="col-span-2">
              <span className="text-gray-500">Campaign:</span>
              <span className="text-gray-300 ml-1">{d.campaign as string}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mb-2">
          {!!d.recurring && (
            <span className={ds.badge('neon-blue')}>
              <Repeat className="w-3 h-3" /> Recurring
            </span>
          )}
          {!!d.pledgePayment && (
            <span className={ds.badge('neon-purple')}>
              <Milestone className="w-3 h-3" /> Pledge
            </span>
          )}
          {!!d.matchingGift && (
            <span className={ds.badge('neon-cyan')}>
              <CircleDollarSign className="w-3 h-3" /> Match: {fmtCurrency(d.matchedAmount as number)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <span className={cn(
            'flex items-center gap-1 text-xs',
            acked ? 'text-green-400' : 'text-amber-400'
          )}>
            {acked ? <CheckCircle2 className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
            {acked ? `Ack: ${fmtDate(d.ackDate as string)}` : 'Not acknowledged'}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Grant Cards
  // ---------------------------------------------------------------------------
  const renderGrantCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const stage = (d.stage || item.meta?.status) as string;
    const budgetPct = progressPct(d.budgetSpent as number, d.budgetTotal as number);
    const isExpanded = expandedGrant === item.id;
    const deadline = d.deadline as string;
    const nextReport = d.nextReportDue as string;
    const daysLeft = deadline ? daysUntil(deadline) : Infinity;

    return (
      <div key={item.id} className={ds.panel}>
        <div
          className="cursor-pointer"
          onClick={() => setExpandedGrant(isExpanded ? null : item.id)}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
              <p className={ds.textMuted}>{d.funder as string}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={ds.badge(STATUS_COLORS[stage] || 'gray-400')}>{stage}</span>
              {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className={cn(ds.textMono, 'text-green-400 text-base font-bold')}>
              {fmtCurrency(d.amount as number)}
            </span>
            <span className={ds.textMuted}>{d.period as string}</span>
          </div>

          {/* Grant pipeline visualization */}
          <div className="flex items-center gap-0.5 mb-2">
            {GRANT_STAGES.filter(s => s !== 'declined').map(s => {
              const stageIdx = GRANT_STAGES.indexOf(s);
              const currentIdx = GRANT_STAGES.indexOf(stage as GrantStage);
              const isPast = stageIdx < currentIdx;
              const isCurrent = stageIdx === currentIdx;
              return (
                <div
                  key={s}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    isPast ? 'bg-green-400' :
                    isCurrent ? 'bg-neon-cyan' :
                    'bg-lattice-elevated'
                  )}
                  title={s}
                />
              );
            })}
          </div>

          {/* Deadline warning */}
          {deadline && daysLeft > 0 && daysLeft <= 30 && (
            <div className={cn(
              'flex items-center gap-1 text-xs mb-2',
              daysLeft <= 14 ? 'text-red-400' : 'text-amber-400'
            )}>
              <AlertTriangle className="w-3 h-3" />
              Deadline in {daysLeft} days ({fmtDate(deadline)})
            </div>
          )}
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-lattice-border space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-gray-500">Program:</span>
                <span className="text-gray-300 ml-1">{d.program as string}</span>
              </div>
              <div>
                <span className="text-gray-500">Contact:</span>
                <span className="text-gray-300 ml-1">{d.contactName as string}</span>
              </div>
              <div>
                <span className="text-gray-500">Received:</span>
                <span className="text-green-400 ml-1">{fmtCurrency(d.amountReceived as number)}</span>
              </div>
              <div>
                <span className="text-gray-500">Reporting:</span>
                <span className="text-gray-300 ml-1">{d.reportingFrequency as string}</span>
              </div>
              {!!d.matchRequired && (
                <div className="col-span-2">
                  <span className="text-gray-500">Match Required:</span>
                  <span className="text-amber-400 ml-1">{fmtCurrency(d.matchAmount as number)}</span>
                </div>
              )}
              {nextReport && (
                <div className="col-span-2">
                  <span className="text-gray-500">Next Report Due:</span>
                  <span className={cn(
                    'ml-1',
                    daysUntil(nextReport) <= 30 ? 'text-amber-400' : 'text-gray-300'
                  )}>
                    {fmtDate(nextReport)}
                  </span>
                </div>
              )}
            </div>

            {/* Budget tracking */}
            {(d.budgetTotal as number) > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Budget spent</span>
                  <span>{fmtCurrency(d.budgetSpent as number)} / {fmtCurrency(d.budgetTotal as number)} ({budgetPct}%)</span>
                </div>
                <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', progressBarColor(budgetPct))}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Deliverables */}
            <div>
              <p className="text-xs text-gray-500 mb-1">Deliverables:</p>
              <p className="text-xs text-gray-300">{d.deliverables as string}</p>
            </div>

            {!!d.notes && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Notes:</p>
                <p className="text-xs text-gray-300">{d.notes as string}</p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button onClick={() => openEdit(item.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                <Edit2 className="w-3 h-3" /> Edit
              </button>
              <button onClick={() => remove(item.id)} className={cn(ds.btnSmall, ds.btnDanger)}>
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Campaign Cards
  // ---------------------------------------------------------------------------
  const renderCampaignCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const pct = progressPct(d.raised as number, d.goal as number);
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
            <p className={ds.textMuted}>{d.type as string} Campaign</p>
          </div>
          <span className={ds.badge(STATUS_COLORS[item.meta?.status] || 'gray-400')}>
            {item.meta?.status}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{fmtCurrency(d.raised as number)} raised</span>
            <span>{fmtCurrency(d.goal as number)} goal</span>
          </div>
          <div className="w-full h-3 bg-lattice-elevated rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', progressBarColor(pct))}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-center text-xs text-gray-400 mt-1">{pct}% complete</p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-xs">
          <div>
            <span className="text-gray-500">Donors:</span>
            <span className="text-gray-300 ml-1">{d.donors as number}</span>
          </div>
          <div>
            <span className="text-gray-500">Avg Gift:</span>
            <span className="text-gray-300 ml-1">{(d.avgGift as number) > 0 ? fmtCurrency(d.avgGift as number) : 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">New Donors:</span>
            <span className="text-gray-300 ml-1">{d.newDonors as number}</span>
          </div>
          <div>
            <span className="text-gray-500">Response Rate:</span>
            <span className="text-gray-300 ml-1">{(d.responseRate as number) > 0 ? `${d.responseRate}%` : 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Channel:</span>
            <span className="text-gray-300 ml-1">{d.channel as string}</span>
          </div>
          <div>
            <span className="text-gray-500">Net Revenue:</span>
            <span className="text-green-400 ml-1">{fmtCurrency(d.netRevenue as number)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
          <Calendar className="w-3 h-3" />
          {fmtDate(d.startDate as string)} - {fmtDate(d.endDate as string)}
        </div>

        {!!d.appealsSent && (d.appealsSent as number) > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
            <Send className="w-3 h-3" />
            {d.appealsSent as number} appeals sent
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <span className={ds.textMuted}>{d.timeline as string}</span>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Volunteer Cards
  // ---------------------------------------------------------------------------
  const renderVolunteerCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const checkedIn = d.checkedIn as boolean;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
              checkedIn ? 'bg-green-400/20' : 'bg-gray-600/20'
            )}>
              <UserCheck className={cn('w-4 h-4', checkedIn ? 'text-green-400' : 'text-gray-500')} />
            </div>
            <div className="min-w-0">
              <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
              <p className={ds.textMuted}>{d.role as string}</p>
            </div>
          </div>
          {checkedIn && (
            <span className={ds.badge('green-400')}>
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Checked In
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-xs">
          <div>
            <span className="text-gray-500">Hours (Year):</span>
            <span className="text-gray-300 ml-1">{d.hoursThisYear as number}</span>
          </div>
          <div>
            <span className="text-gray-500">Lifetime:</span>
            <span className="text-gray-300 ml-1">{d.hoursLifetime as number} hrs</span>
          </div>
          <div>
            <span className="text-gray-500">Availability:</span>
            <span className="text-gray-300 ml-1">{d.availability as string}</span>
          </div>
          <div>
            <span className="text-gray-500">Value:</span>
            <span className="text-green-400 ml-1">{fmtCurrency((d.hoursThisYear as number) * (d.hourValuation as number))}</span>
          </div>
        </div>

        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1">Skills:</p>
          <div className="flex flex-wrap gap-1">
            {(d.skills as string).split(',').map((s: string) => (
              <span key={s.trim()} className="text-xs bg-lattice-elevated px-1.5 py-0.5 rounded text-gray-400">
                {s.trim()}
              </span>
            ))}
          </div>
        </div>

        {!!d.currentAssignment && (
          <div className="flex items-center gap-1 mb-2 text-xs">
            <ClipboardList className="w-3 h-3 text-neon-cyan" />
            <span className="text-neon-cyan">{d.currentAssignment as string}</span>
          </div>
        )}

        {!!d.backgroundCheck && (
          <div className="flex items-center gap-1 mb-2 text-xs text-green-400">
            <ShieldCheck className="w-3 h-3" />
            Background checked ({fmtDate(d.backgroundCheckDate as string)})
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Mail className="w-3 h-3" />
            <span>{d.email as string}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Impact Cards
  // ---------------------------------------------------------------------------
  const renderImpactCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const pct = progressPct(d.value as number, d.target as number);
    const trend = d.trend as string;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
            <p className={ds.textMuted}>{d.program as string}</p>
          </div>
          <div className="flex items-center gap-1">
            {trend === 'up' && <ArrowUpRight className="w-4 h-4 text-green-400" />}
            {trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-400" />}
            {trend === 'steady' && <TrendingUp className="w-4 h-4 text-gray-400" />}
          </div>
        </div>

        {/* Big metric */}
        <div className="text-center mb-3">
          <p className="text-3xl font-bold text-white">{(d.value as number).toLocaleString()}</p>
          <p className={ds.textMuted}>{d.unit as string} ({d.period as string})</p>
        </div>

        {/* Progress */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Progress to target</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', progressBarColor(pct))} style={{ width: `${pct}%` }} />
          </div>
          <p className={cn(ds.textMuted, 'mt-1')}>
            Target: {(d.target as number).toLocaleString()} {d.unit as string}
          </p>
        </div>

        {/* Year over year */}
        {(d.previousYear as number) > 0 && (
          <div className="flex items-center gap-1 mb-2 text-xs">
            <span className="text-gray-500">Prior year:</span>
            <span className="text-gray-300">{(d.previousYear as number).toLocaleString()}</span>
          </div>
        )}

        {/* Outputs */}
        {!!d.outputs && (
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-1">Key outputs:</p>
            <p className="text-xs text-gray-400">{d.outputs as string}</p>
          </div>
        )}

        {/* Success story */}
        {!!d.successStory && (
          <div className="mb-2 p-2 bg-lattice-elevated rounded-lg">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" /> Success Story
            </p>
            <p className="text-xs text-gray-300 italic">&ldquo;{d.successStory as string}&rdquo;</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <span className={ds.badge(STATUS_COLORS[d.category as string] || 'gray-400')}>
            {d.category as string}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Fund Cards
  // ---------------------------------------------------------------------------
  const renderFundCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const fundType = d.type as string;
    const balance = d.balance as number;
    const budgeted = d.budgeted as number;
    const spent = d.spent as number;
    const pct = budgeted > 0 ? progressPct(spent, budgeted) : 0;

    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className={cn(ds.heading3, 'text-sm truncate')}>{item.title}</h3>
          </div>
          <span className={ds.badge(STATUS_COLORS[fundType] || 'gray-400')}>
            {fundType.replace(/_/g, ' ')}
          </span>
        </div>

        <p className="text-2xl font-bold text-white mb-1">{fmtCurrency(balance)}</p>
        <p className={ds.textMuted}>{d.description as string}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 my-3 text-xs">
          <div>
            <span className="text-gray-500">YTD Revenue:</span>
            <span className="text-green-400 ml-1">{fmtCurrency(d.ytdRevenue as number)}</span>
          </div>
          <div>
            <span className="text-gray-500">YTD Expenses:</span>
            <span className="text-red-400 ml-1">{fmtCurrency(d.ytdExpenses as number)}</span>
          </div>
        </div>

        {budgeted > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Budget utilization</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', progressBarColor(pct))}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={cn(ds.textMuted, 'mt-1')}>
              {fmtCurrency(spent)} of {fmtCurrency(budgeted)} spent
            </p>
          </div>
        )}

        {!!d.restrictions && fundType !== 'unrestricted' && (
          <div className="mb-2 p-2 bg-lattice-elevated rounded-lg">
            <p className="text-xs text-gray-500 mb-1">Restrictions:</p>
            <p className="text-xs text-gray-300">{d.restrictions as string}</p>
          </div>
        )}

        {!!d.allocations && (
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-1">Allocations:</p>
            <p className="text-xs text-gray-400">{d.allocations as string}</p>
          </div>
        )}

        {!!d.endowment && (
          <div className="flex items-center gap-1 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-neon-purple" />
            <span className="text-xs text-neon-purple">Endowment - Principal permanently restricted</span>
          </div>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-lattice-border">
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Generic card fallback
  // ---------------------------------------------------------------------------
  const renderGenericCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const status = item.meta?.status || 'active';
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item.id)}>
        <div className="flex items-start justify-between mb-2">
          <h3 className={cn(ds.heading3, 'truncate flex-1')}>{item.title}</h3>
          <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>{String(status)}</span>
        </div>
        <div className="space-y-1 mb-3">
          {Object.entries(d).slice(0, 4).map(([k, v]) => (
            <p key={k} className={ds.textMuted}><span className="text-gray-500">{k}:</span> {String(v)}</p>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
          <span className={ds.textMuted}>{new Date(item.updatedAt).toLocaleDateString()}</span>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost} aria-label="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Pick renderer per mode
  const renderCard = (item: LensItem) => {
    switch (mode) {
      case 'donors': return renderDonorCard(item);
      case 'gifts': return renderGiftCard(item);
      case 'grants': return renderGrantCard(item);
      case 'campaigns': return renderCampaignCard(item);
      case 'volunteers': return renderVolunteerCard(item);
      case 'impact': return renderImpactCard(item);
      case 'funds': return renderFundCard(item);
      default: return renderGenericCard(item);
    }
  };

  // ---------------------------------------------------------------------------
  // Main Return
  // ---------------------------------------------------------------------------
  return (
    <LensShell lensId="nonprofit" asMain={false}>
      <FirstRunTour lensId="nonprofit" />
      <DepthBadge lensId="nonprofit" size="sm" className="ml-2" />
    <div data-lens-theme="nonprofit" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Heart className="w-7 h-7 text-neon-pink" />
          <div>
            <h1 className={ds.heading1}>Nonprofit &amp; Community</h1>
            <p className={ds.textMuted}>Donors, gifts, grants, campaigns, volunteers, impact, and fund management</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="nonprofit" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'gifts' && (
            <button onClick={() => setShowGiftEntry(true)} className={cn(ds.btnPrimary, 'bg-green-600 hover:bg-green-700 focus:ring-green-600')}>
              <Banknote className="w-4 h-4" /> Process Gift
            </button>
          )}
          {mode !== 'dashboard' && (
            <button onClick={openCreate} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
          )}
          <button onClick={() => setShowActionPanel(!showActionPanel)} className={ds.btnSecondary}>
            <Sparkles className="w-4 h-4" /> Actions
          </button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
        </div>
      </header>


      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Donors', value: metrics.totalDonors, icon: Heart },
          { label: 'Fundraising', value: `$${(metrics.totalRaisedYTD / 1000).toFixed(0)}K`, icon: DollarSign },
          { label: 'Retention', value: `${metrics.retentionRate}%`, icon: Repeat },
          { label: 'Vol. Hours', value: metrics.totalVolunteerHours, icon: HelpingHand },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-pink shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="nonprofit" artifactId={allDonors[0]?.id} compact />
      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setSearch(''); setStatusFilter('all'); setDetailItem(null); setExpandedGrant(null); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-neon-pink/20 text-neon-pink'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Action Panel Dropdown */}
      {showActionPanel && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={ds.heading3}>Domain Actions</h3>
            <button onClick={() => setShowActionPanel(false)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {DOMAIN_ACTIONS.map(action => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => handleAction(action.id)}
                  className={cn(ds.panelHover, 'text-left p-3')}
                >
                  <Icon className="w-5 h-5 text-neon-blue mb-1" />
                  <p className="text-sm font-medium text-gray-200">{action.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{action.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Dashboard view */}
      {mode === 'dashboard' && renderDashboard()}

      {/* List views */}
      {mode !== 'dashboard' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${currentType.toLowerCase()}s...`}
                className={cn(ds.input, 'pl-10')}
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={cn(ds.select, 'pl-10 pr-8')}
              >
                <option value="all">All statuses</option>
                {statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <span className={ds.textMuted}>{filtered.length} {currentType.toLowerCase()}{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Items Grid */}
          {isLoading ? (
            <div className="text-center py-12"><p className={ds.textMuted}>Loading...</p></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Heart className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No {currentType.toLowerCase()}s found</p>
              <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
                <Plus className="w-4 h-4" /> Create one
              </button>
            </div>
          ) : (
            <div className={mode === 'grants' ? ds.grid2 : ds.grid3}>
              {filtered.map((item, index) => (
                <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  {renderCard(item)}
                </motion.div>
              ))}
            </div>
          )}

          {/* Grant Pipeline Summary (when on grants tab) */}
          {mode === 'grants' && (
            <section>
              <h2 className={cn(ds.heading2, 'mb-3')}>Grant Pipeline Summary</h2>
              <div className={ds.panel}>
                <div className="flex items-center gap-2 flex-wrap pb-2">
                  {GRANT_STAGES.map(stage => {
                    const count = filtered.filter(g => {
                      const d = g.data as Record<string, unknown>;
                      return (d.stage || g.meta?.status) === stage;
                    }).length;
                    const totalAmount = filtered
                      .filter(g => {
                        const d = g.data as Record<string, unknown>;
                        return (d.stage || g.meta?.status) === stage;
                      })
                      .reduce((s, g) => s + ((g.data as Record<string, unknown>).amount as number || 0), 0);
                    return (
                      <div
                        key={stage}
                        className={cn(
                          'flex-1 min-w-[100px] p-3 rounded-lg text-center',
                          count > 0 ? 'bg-lattice-elevated' : 'bg-lattice-surface border border-lattice-border'
                        )}
                      >
                        <span className={ds.badge(STATUS_COLORS[stage] || 'gray-400')}>{stage}</span>
                        <p className="text-xl font-bold text-white mt-2">{count}</p>
                        <p className={ds.textMuted}>{totalAmount > 0 ? fmtCurrency(totalAmount) : '-'}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Action Result */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            {/* donorRetention */}
            {actionResult.retentionRate !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.retentionRate) >= 70 ? 'text-green-400' : Number(actionResult.retentionRate) >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{String(actionResult.retentionRate)}%</p>
                    <p className="text-[10px] text-gray-500">Retention Rate</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.retained)}</p>
                    <p className="text-[10px] text-gray-500">Retained</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.priorTotal)}</p>
                    <p className="text-[10px] text-gray-500">Prior Year</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 text-center">{String(actionResult.period)}</p>
              </div>
            )}
            {/* grantReporting */}
            {actionResult.deliverableProgress !== undefined && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{String(actionResult.funder)} &bull; ${Number(actionResult.amount).toLocaleString()}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Deliverables</span>
                  <span className="text-sm font-bold text-neon-cyan">{String(actionResult.deliverableProgress)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, Number(actionResult.deliverableProgress))}%` }} />
                </div>
                <p className="text-[10px] text-gray-500">{String(actionResult.completedDeliverables)}/{String(actionResult.totalDeliverables)} completed</p>
              </div>
            )}
            {/* volunteerMatch */}
            {actionResult.matchScore !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center col-span-2">
                    <p className={`text-sm font-bold ${Number(actionResult.matchScore) >= 75 ? 'text-green-400' : Number(actionResult.matchScore) >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{String(actionResult.matchScore)}% Match</p>
                    <p className="text-[10px] text-gray-500">{String(actionResult.volunteer)}</p>
                  </div>
                </div>
                {Array.isArray(actionResult.matches) && (actionResult.matches as {program:string;matched:boolean;availabilityMatch:boolean}[]).map((m, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-lattice-surface rounded text-xs">
                    <span className="text-gray-300">{m.program}</span>
                    <span className={m.matched && m.availabilityMatch ? 'text-green-400' : m.matched ? 'text-amber-400' : 'text-red-400'}>{m.matched && m.availabilityMatch ? 'Full Match' : m.matched ? 'Skill Only' : 'No Match'}</span>
                  </div>
                ))}
              </div>
            )}
            {/* campaignProgress */}
            {actionResult.percentComplete !== undefined && actionResult.goal !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.raised).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Raised</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-gray-400">${Number(actionResult.goal).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Goal</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.donorCount)}</p>
                    <p className="text-[10px] text-gray-500">Donors</p>
                  </div>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, Number(actionResult.percentComplete))}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>{String(actionResult.percentComplete)}% complete</span>
                  <span className={actionResult.onTrack ? 'text-green-400' : 'text-red-400'}>{actionResult.onTrack ? 'On Track' : 'Behind'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailItem && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setDetailItem(null)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <div>
                  <h2 className={ds.heading2}>{detailItem.title}</h2>
                  <p className={ds.textMuted}>{currentType} Detail</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { openEdit(detailItem.id); setDetailItem(null); }} className={ds.btnSecondary}>
                    <Edit2 className="w-4 h-4" /> Edit
                  </button>
                  <button onClick={() => setDetailItem(null)} className={ds.btnGhost} aria-label="Close"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(detailItem.data as Record<string, unknown>).map(([key, val]) => {
                    if (val === '' || val === null || val === undefined) return null;
                    const displayVal = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val);
                    return (
                      <div key={key} className={cn(
                        (key === 'notes' || key === 'successStory' || key === 'deliverables' || key === 'outputs' || key === 'assignmentHistory' || key === 'allocations' || key === 'restrictions' || key === 'description') ? 'col-span-2' : ''
                      )}>
                        <label className={ds.label}>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label>
                        <p className="text-sm text-gray-200">{displayVal}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Tags */}
                {(detailItem.meta?.tags as string[])?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-lattice-border">
                    <label className={ds.label}>Tags</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(detailItem.meta?.tags as string[]).map(tag => (
                        <span key={tag} className={ds.badge('gray-400')}>{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick actions in detail */}
                <div className="mt-4 pt-4 border-t border-lattice-border">
                  <label className={ds.label}>Quick Actions</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {mode === 'donors' && (
                      <>
                        <button onClick={() => handleAction('donor-retention-report', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                          <RefreshCw className="w-3 h-3" /> Retention Report
                        </button>
                        <button onClick={() => handleAction('send-acknowledgment', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                          <Mail className="w-3 h-3" /> Send Acknowledgment
                        </button>
                        <button onClick={() => handleAction('view-giving-history', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                          <Eye className="w-3 h-3" /> View Giving History
                        </button>
                      </>
                    )}
                    {mode === 'grants' && (
                      <>
                        <button onClick={() => handleAction('grant-deadline-check', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                          <CalendarClock className="w-3 h-3" /> Check Deadlines
                        </button>
                        <button onClick={() => handleAction('export-grant-report', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                          <Download className="w-3 h-3" /> Export Report
                        </button>
                      </>
                    )}
                    {mode === 'campaigns' && (
                      <button onClick={() => handleAction('campaign-analysis', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                        <PieChart className="w-3 h-3" /> Analyze Campaign
                      </button>
                    )}
                    {mode === 'volunteers' && (
                      <button onClick={() => handleAction('volunteer-match', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                        <UserCheck className="w-3 h-3" /> Match Opportunity
                      </button>
                    )}
                    {mode === 'impact' && (
                      <button onClick={() => handleAction('impact-report', detailItem.id)} className={cn(ds.btnSmall, ds.btnSecondary)}>
                        <FileBarChart className="w-3 h-3" /> Generate Report
                      </button>
                    )}
                    <button onClick={() => { remove(detailItem.id); setDetailItem(null); }} className={cn(ds.btnSmall, ds.btnDanger)}>
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Gift Entry Modal */}
      {showGiftEntry && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowGiftEntry(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <div className="flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-green-400" />
                  <h2 className={ds.heading2}>Process Gift</h2>
                </div>
                <button onClick={() => setShowGiftEntry(false)} className={ds.btnGhost} aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Donor Name *</label>
                  <input value={giftDonor} onChange={e => setGiftDonor(e.target.value)} className={ds.input} placeholder="Search donor..." />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Amount ($) *</label>
                    <input value={giftAmount} onChange={e => setGiftAmount(e.target.value)} className={ds.input} placeholder="0.00" type="number" />
                  </div>
                  <div>
                    <label className={ds.label}>Date *</label>
                    <input value={giftDate} onChange={e => setGiftDate(e.target.value)} className={ds.input} type="date" />
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Fund Designation</label>
                    <select value={giftFund} onChange={e => setGiftFund(e.target.value)} className={ds.select}>
                      {SEED.Fund.map(f => <option key={f.title} value={f.title}>{f.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Campaign</label>
                    <select value={giftCampaign} onChange={e => setGiftCampaign(e.target.value)} className={ds.select}>
                      <option value="">None</option>
                      {SEED.Campaign.map(c => <option key={c.title} value={c.title}>{c.title}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Payment Method</label>
                  <select value={giftMethod} onChange={e => setGiftMethod(e.target.value as GiftPaymentMethod)} className={ds.select}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={giftRecurring} onChange={e => setGiftRecurring(e.target.checked)} className="rounded border-lattice-border bg-lattice-surface" />
                    <span className="text-sm text-gray-300">
                      <Repeat className="w-3 h-3 inline mr-1" />Recurring Gift
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={giftMatching} onChange={e => setGiftMatching(e.target.checked)} className="rounded border-lattice-border bg-lattice-surface" />
                    <span className="text-sm text-gray-300">
                      <CircleDollarSign className="w-3 h-3 inline mr-1" />Matching Gift
                    </span>
                  </label>
                </div>
                <div>
                  <label className={ds.label}>Notes</label>
                  <textarea value={giftNotes} onChange={e => setGiftNotes(e.target.value)} className={ds.textarea} rows={2} placeholder="Gift notes..." />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-lattice-border">
                <button onClick={() => setShowGiftEntry(false)} className={ds.btnSecondary}>Cancel</button>
                <button
                  onClick={handleGiftSave}
                  className={cn(ds.btnPrimary, 'bg-green-600 hover:bg-green-700 focus:ring-green-600')}
                  disabled={!giftDonor.trim() || !giftAmount}
                >
                  <CheckCircle2 className="w-4 h-4" /> Process Gift
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={resetForm} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>{editing ? 'Edit' : 'New'} {currentType}</h2>
                <button onClick={resetForm} className={ds.btnGhost} aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Name / Title</label>
                  <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className={ds.input} placeholder={`${currentType} name`} />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select value={formStatus} onChange={e => setFormStatus(e.target.value)} className={ds.select}>
                    {statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                {formFieldConfig[mode]?.map(field => (
                  <div key={field.key}>
                    <label className={ds.label}>{field.label}</label>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={formFields[field.key] || ''}
                        onChange={e => setFormFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className={ds.textarea}
                        rows={3}
                      />
                    ) : (
                      <input
                        value={formFields[field.key] || ''}
                        onChange={e => setFormFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className={ds.input}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-lattice-border">
                <button onClick={resetForm} className={ds.btnSecondary}>Cancel</button>
                <button onClick={handleSave} className={ds.btnPrimary} disabled={!formTitle.trim()}>
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="nonprofit"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
          </div>
        </>
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
            <LensFeaturePanel lensId="nonprofit" />
          </div>
        )}
      </div>

      {/* Bespoke ProPublica Nonprofit Explorer with Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PropublicaSearch />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <NonprofitActionPanel />
        </section>
      </PipingProvider>
    </div>
          <SessionRail lensId="nonprofit" hideWhenEmpty className="mt-4" />
          <RecentMineCard domain="nonprofit" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="nonprofit" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="nonprofit" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
