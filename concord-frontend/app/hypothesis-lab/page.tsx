'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { formatRelativeTime } from '@/lib/utils';
import {
  FlaskConical,
  Plus,
  CheckCircle2,
  XCircle,
  Beaker,
  Search,
  Filter,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Clock,
  AlertTriangle,
  Archive,
  Edit3,
  X,
  Loader2,
  Eye,
  Sparkles,
  GitBranch,
  Target,
  BarChart3,
  Activity,
  Lightbulb,
  FileText,
  Microscope,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type HypothesisStatus = 'proposed' | 'testing' | 'confirmed' | 'rejected' | 'refined' | 'archived';

interface Evidence {
  id: string;
  side: 'for' | 'against';
  dtuId?: string;
  weight: number;
  summary: string;
  addedAt?: string;
}

interface TestResult {
  id: string;
  description?: string;
  result?: 'pass' | 'fail' | 'inconclusive';
  completedAt?: string;
}

interface TimelineEvent {
  timestamp: string;
  event: string;
  detail?: string;
}

interface Hypothesis {
  id: string;
  statement: string;
  domain?: string;
  status: HypothesisStatus;
  confidence: number;
  evidenceFor?: Evidence[];
  evidenceAgainst?: Evidence[];
  tests?: TestResult[];
  timeline?: TimelineEvent[];
  createdAt?: string;
  updatedAt?: string;
  refinedFrom?: string;
  rejectionReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<
  HypothesisStatus,
  { label: string; color: string; bgColor: string; borderColor: string; icon: typeof FlaskConical }
> = {
  proposed: {
    label: 'Proposed',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/15',
    borderColor: 'border-yellow-400/30',
    icon: Lightbulb,
  },
  testing: {
    label: 'Testing',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/15',
    borderColor: 'border-blue-400/30',
    icon: Beaker,
  },
  confirmed: {
    label: 'Confirmed',
    color: 'text-green-400',
    bgColor: 'bg-green-400/15',
    borderColor: 'border-green-400/30',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejected',
    color: 'text-red-400',
    bgColor: 'bg-red-400/15',
    borderColor: 'border-red-400/30',
    icon: XCircle,
  },
  refined: {
    label: 'Refined',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/15',
    borderColor: 'border-purple-400/30',
    icon: Edit3,
  },
  archived: {
    label: 'Archived',
    color: 'text-gray-400',
    bgColor: 'bg-gray-400/15',
    borderColor: 'border-gray-400/30',
    icon: Archive,
  },
};

const ALL_STATUSES: HypothesisStatus[] = [
  'proposed',
  'testing',
  'confirmed',
  'rejected',
  'refined',
  'archived',
];

// ═══════════════════════════════════════════════════════════════
// Sovereign Decree Helpers
// ═══════════════════════════════════════════════════════════════

function decree(action: string, target?: string, data?: Record<string, unknown>) {
  return api.post('/api/run', { action, target, data }).then((r) => r.data);
}

// ═══════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: HypothesisStatus }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.proposed;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        cfg.bgColor,
        cfg.color,
        cfg.borderColor
      )}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function ConfidenceMeter({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const barHeight = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  const barColor =
    pct >= 80
      ? 'from-green-500 to-emerald-400'
      : pct >= 60
        ? 'from-blue-500 to-cyan-400'
        : pct >= 40
          ? 'from-yellow-500 to-amber-400'
          : pct >= 20
            ? 'from-orange-500 to-yellow-500'
            : 'from-red-500 to-orange-500';

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={cn('flex-1 rounded-full overflow-hidden bg-white/10', barHeight)}>
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out',
            barColor
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          'font-mono font-semibold tabular-nums',
          size === 'sm' ? 'text-[10px]' : 'text-xs',
          pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
        )}
      >
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function EvidenceItem({ evidence, side }: { evidence: Evidence; side: 'for' | 'against' }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 p-2.5 rounded-lg text-sm border-l-3',
        side === 'for' ? 'bg-green-500/5 border-l-green-500' : 'bg-red-500/5 border-l-red-500'
      )}
    >
      {side === 'for' ? (
        <ThumbsUp className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
      ) : (
        <ThumbsDown className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-gray-200 text-xs leading-relaxed">{evidence.summary}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-gray-500">
            Weight: {(evidence.weight * 100).toFixed(0)}%
          </span>
          {evidence.dtuId && (
            <span className="text-[10px] text-gray-500 font-mono">
              DTU: {evidence.dtuId.slice(0, 8)}
            </span>
          )}
          {evidence.addedAt && (
            <span className="text-[10px] text-gray-500">
              {formatRelativeTime(evidence.addedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TestResultCard({ test }: { test: TestResult }) {
  const resultConfig = {
    pass: { color: 'text-green-400', bg: 'bg-green-400/10', icon: CheckCircle2, label: 'Passed' },
    fail: { color: 'text-red-400', bg: 'bg-red-400/10', icon: XCircle, label: 'Failed' },
    inconclusive: {
      color: 'text-yellow-400',
      bg: 'bg-yellow-400/10',
      icon: AlertTriangle,
      label: 'Inconclusive',
    },
  };
  const cfg = test.result ? resultConfig[test.result] : null;
  const Icon = cfg?.icon || Clock;

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-lg border border-lattice-border/50',
        cfg?.bg || 'bg-white/5'
      )}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', cfg?.color || 'text-gray-400')} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-200 truncate">{test.description || test.id}</p>
        {test.completedAt && (
          <p className="text-[10px] text-gray-500 mt-0.5">{formatRelativeTime(test.completedAt)}</p>
        )}
      </div>
      <span
        className={cn(
          'text-[10px] font-medium px-2 py-0.5 rounded-full',
          cfg?.color || 'text-gray-400',
          cfg?.bg || 'bg-white/5'
        )}
      >
        {cfg?.label || 'Pending'}
      </span>
    </div>
  );
}

function TimelineView({ events }: { events: TimelineEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <p className="text-xs text-gray-500 text-center py-4">No lifecycle events recorded yet.</p>
    );
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-gradient-to-b from-neon-cyan/50 via-purple-500/30 to-transparent" />
      <div className="space-y-3">
        {events.map((evt, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full border-2 border-neon-cyan/50 bg-lattice-void" />
            <div className="pl-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-gray-200">{evt.event}</span>
                <span className="text-[10px] text-gray-500">
                  {formatRelativeTime(evt.timestamp)}
                </span>
              </div>
              {evt.detail && <p className="text-[11px] text-gray-400 mt-0.5">{evt.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Modal
// ═══════════════════════════════════════════════════════════════

function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className={ds.modalContainer} onClick={onClose}>
      <div className={ds.modalBackdrop} />
      <div
        className={cn(ds.modalPanel, maxWidth, 'relative z-10')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h3 className={ds.heading3}>{title}</h3>
          <button onClick={onClose} className={ds.btnGhost}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════

export default function HypothesisLabPage() {
  const queryClient = useQueryClient();

  // --------------- UI State ---------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HypothesisStatus | 'all'>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [confidenceRange, setConfidenceRange] = useState<[number, number]>([0, 1]);
  const [showFilters, setShowFilters] = useState(false);
  const [detailTab, setDetailTab] = useState<'evidence' | 'tests' | 'timeline'>('evidence');
  const [expandedEvidence, setExpandedEvidence] = useState<'for' | 'against' | 'both'>('both');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Form states
  const [newStatement, setNewStatement] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [evidenceSide, setEvidenceSide] = useState<'for' | 'against'>('for');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceWeight, setEvidenceWeight] = useState(0.5);
  const [evidenceDtuId, setEvidenceDtuId] = useState('');
  const [testId, setTestId] = useState('');
  const [testResult, setTestResult] = useState<'pass' | 'fail' | 'inconclusive'>('pass');
  const [refineStatement, setRefineStatement] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  // --------------- Queries ---------------

  const {
    data: listData,
    isLoading: isListLoading,
    isError: isListError,
    error: listError,
  } = useQuery({
    queryKey: ['hypothesis-lab', 'list'],
    queryFn: () => decree('hypothesis-list'),
    refetchInterval: 15000,
  });

  const { data: detailData, isLoading: isDetailLoading } = useQuery({
    queryKey: ['hypothesis-lab', 'detail', selectedId],
    queryFn: () => decree('hypothesis-status', selectedId!),
    enabled: !!selectedId,
    refetchInterval: 10000,
  });

  // --------------- Mutations ---------------

  const createMutation = useMutation({
    mutationFn: (data: { statement: string; domain: string }) =>
      decree('hypothesis-create', undefined, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] });
      setShowCreateModal(false);
      setNewStatement('');
      setNewDomain('');
    },
  });

  const addEvidenceMutation = useMutation({
    mutationFn: (data: { side: string; dtuId?: string; weight: number; summary: string }) =>
      decree('hypothesis-evidence', selectedId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] });
      setShowEvidenceModal(false);
      setEvidenceSummary('');
      setEvidenceDtuId('');
      setEvidenceWeight(0.5);
    },
  });

  const updateTestMutation = useMutation({
    mutationFn: (data: { testId: string; result: string }) =>
      decree('hypothesis-test', selectedId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] });
      setShowTestModal(false);
      setTestId('');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => decree('hypothesis-confirm', selectedId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => decree('hypothesis-reject', selectedId!, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] });
      setShowRejectModal(false);
      setRejectReason('');
    },
  });

  const refineMutation = useMutation({
    mutationFn: (statement: string) => decree('hypothesis-refine', selectedId!, { statement }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] });
      setShowRefineModal(false);
      setRefineStatement('');
    },
  });

  // --------------- Derived Data ---------------

  const hypotheses: Hypothesis[] = useMemo(() => {
    const raw = listData?.hypotheses || listData?.data || listData || [];
    return Array.isArray(raw) ? raw : [];
  }, [listData]);

  const selectedHypothesis: Hypothesis | null = useMemo(() => {
    if (!selectedId) return null;
    const fromDetail = detailData?.hypothesis || detailData?.data || detailData;
    if (fromDetail && typeof fromDetail === 'object' && 'id' in fromDetail)
      return fromDetail as Hypothesis;
    return hypotheses.find((h) => h.id === selectedId) || null;
  }, [selectedId, detailData, hypotheses]);

  const domains = useMemo(() => {
    const set = new Set<string>();
    hypotheses.forEach((h) => {
      if (h.domain) set.add(h.domain);
    });
    return Array.from(set).sort();
  }, [hypotheses]);

  const filteredHypotheses = useMemo(() => {
    return hypotheses.filter((h) => {
      if (statusFilter !== 'all' && h.status !== statusFilter) return false;
      if (domainFilter !== 'all' && h.domain !== domainFilter) return false;
      if (h.confidence < confidenceRange[0] || h.confidence > confidenceRange[1]) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          h.statement.toLowerCase().includes(q) ||
          (h.domain || '').toLowerCase().includes(q) ||
          h.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [hypotheses, statusFilter, domainFilter, confidenceRange, searchQuery]);

  // Stats
  const stats = useMemo(
    () => ({
      total: hypotheses.length,
      proposed: hypotheses.filter((h) => h.status === 'proposed').length,
      testing: hypotheses.filter((h) => h.status === 'testing').length,
      confirmed: hypotheses.filter((h) => h.status === 'confirmed').length,
      rejected: hypotheses.filter((h) => h.status === 'rejected').length,
      avgConfidence:
        hypotheses.length > 0
          ? hypotheses.reduce((s, h) => s + (h.confidence || 0), 0) / hypotheses.length
          : 0,
    }),
    [hypotheses]
  );

  const handleSelectHypothesis = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
    setDetailTab('evidence');
  }, []);

  // --------------- Render ---------------

  if (isListError) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center p-8">
        <div className={cn(ds.panel, 'max-w-md text-center space-y-4')}>
          <AlertTriangle className="w-12 h-12 mx-auto text-red-400" />
          <h2 className={ds.heading2}>Failed to Load Hypothesis Lab</h2>
          <p className={ds.textMuted}>
            {(listError as Error)?.message || 'Unable to connect to the sovereign decree endpoint.'}
          </p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] })}
            className={ds.btnPrimary}
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lattice-void">
      {/* ═══════════════ Header ═══════════════ */}
      <header className="border-b border-lattice-border bg-gradient-to-b from-lattice-surface/60 to-transparent">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <FlaskConical className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h1 className={ds.heading1}>Hypothesis Lab</h1>
                <p className={cn(ds.textMuted, 'mt-0.5')}>
                  System 13a -- Formulate, test, and validate hypotheses through evidence-driven
                  reasoning
                </p>
              </div>
            </div>
            <button onClick={() => setShowCreateModal(true)} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" />
              New Hypothesis
            </button>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
            {[
              { icon: FlaskConical, label: 'Total', value: stats.total, color: 'text-purple-400' },
              {
                icon: Lightbulb,
                label: 'Proposed',
                value: stats.proposed,
                color: 'text-yellow-400',
              },
              { icon: Beaker, label: 'Testing', value: stats.testing, color: 'text-blue-400' },
              {
                icon: CheckCircle2,
                label: 'Confirmed',
                value: stats.confirmed,
                color: 'text-green-400',
              },
              { icon: XCircle, label: 'Rejected', value: stats.rejected, color: 'text-red-400' },
              {
                icon: BarChart3,
                label: 'Avg Confidence',
                value: `${(stats.avgConfidence * 100).toFixed(0)}%`,
                color: 'text-cyan-400',
              },
            ].map((stat) => (
              <div key={stat.label} className={cn(ds.panel, 'flex items-center gap-3')}>
                <stat.icon className={cn('w-5 h-5 flex-shrink-0', stat.color)} />
                <div>
                  <p className="text-lg font-bold text-white">{stat.value}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ═══════════════ Search & Filters ═══════════════ */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hypotheses by statement, domain, or ID..."
              className={cn(ds.input, 'pl-10')}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(ds.btnSecondary, showFilters && 'border-neon-cyan/50 text-neon-cyan')}
          >
            <Filter className="w-4 h-4" />
            Filters
            {(statusFilter !== 'all' || domainFilter !== 'all') && (
              <span className="w-2 h-2 rounded-full bg-neon-cyan" />
            )}
          </button>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['hypothesis-lab'] })}
            className={ds.btnGhost}
            title="Refresh data"
          >
            <RefreshCw className={cn('w-4 h-4', isListLoading && 'animate-spin')} />
          </button>
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className={cn(ds.panel, 'flex flex-wrap items-end gap-4')}>
            <div className="space-y-1">
              <label className={ds.label}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as HypothesisStatus | 'all')}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All Statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={ds.label}>Domain</label>
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All Domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={ds.label}>
                Min Confidence: {(confidenceRange[0] * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={confidenceRange[0]}
                onChange={(e) =>
                  setConfidenceRange([parseFloat(e.target.value), confidenceRange[1]])
                }
                className="w-32 accent-neon-cyan"
              />
            </div>
            <div className="space-y-1">
              <label className={ds.label}>
                Max Confidence: {(confidenceRange[1] * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={confidenceRange[1]}
                onChange={(e) =>
                  setConfidenceRange([confidenceRange[0], parseFloat(e.target.value)])
                }
                className="w-32 accent-neon-cyan"
              />
            </div>
            <button
              onClick={() => {
                setStatusFilter('all');
                setDomainFilter('all');
                setConfidenceRange([0, 1]);
              }}
              className={ds.btnGhost}
            >
              Clear Filters
            </button>
          </div>
        )}

        {/* Status Quick Filters */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              statusFilter === 'all'
                ? 'bg-white/15 text-white border border-white/20'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            )}
          >
            All ({stats.total})
          </button>
          {ALL_STATUSES.map((s) => {
            const count = hypotheses.filter((h) => h.status === s).length;
            if (count === 0 && statusFilter !== s) return null;
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                  statusFilter === s
                    ? cn(cfg.bgColor, cfg.color, cfg.borderColor)
                    : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'
                )}
              >
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══════════════ Main Content ═══════════════ */}
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ─── Hypothesis List (Left) ─── */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className={ds.textMuted}>
                {filteredHypotheses.length} hypothesis{filteredHypotheses.length !== 1 ? 'es' : ''}
                {searchQuery && ` matching "${searchQuery}"`}
              </span>
            </div>

            {isListLoading && hypotheses.length === 0 && (
              <div className={cn(ds.panel, 'flex items-center justify-center py-16')}>
                <Loader2 className="w-6 h-6 animate-spin text-purple-400 mr-3" />
                <span className="text-gray-400">Loading hypotheses...</span>
              </div>
            )}

            {!isListLoading && filteredHypotheses.length === 0 && (
              <div className={cn(ds.panel, 'text-center py-16')}>
                <FlaskConical className="w-12 h-12 mx-auto mb-4 text-gray-700" />
                <p className="text-gray-400 mb-2">
                  {hypotheses.length === 0
                    ? 'No hypotheses yet'
                    : 'No hypotheses match your filters'}
                </p>
                <p className="text-xs text-gray-600 mb-4">
                  {hypotheses.length === 0
                    ? 'Create your first hypothesis to begin evidence-driven reasoning.'
                    : 'Try adjusting your filters or search query.'}
                </p>
                {hypotheses.length === 0 && (
                  <button onClick={() => setShowCreateModal(true)} className={ds.btnPrimary}>
                    <Plus className="w-4 h-4" /> Create Hypothesis
                  </button>
                )}
              </div>
            )}

            <div className="space-y-2 max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
              {filteredHypotheses.map((h) => (
                <button
                  key={h.id}
                  onClick={() => handleSelectHypothesis(h.id)}
                  className={cn(
                    ds.panel,
                    'w-full text-left transition-all hover:border-neon-cyan/30',
                    selectedId === h.id && 'border-neon-cyan/60 bg-neon-cyan/5'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white leading-snug line-clamp-2">
                        {h.statement}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <StatusBadge status={h.status} />
                        {h.domain && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                            {h.domain}
                          </span>
                        )}
                      </div>
                      <div className="mt-2">
                        <ConfidenceMeter value={h.confidence || 0} size="sm" />
                      </div>
                    </div>
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 text-gray-600 flex-shrink-0 mt-1 transition-transform',
                        selectedId === h.id && 'text-neon-cyan rotate-90'
                      )}
                    />
                  </div>
                  {h.createdAt && (
                    <p className="text-[10px] text-gray-600 mt-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(h.createdAt)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ─── Detail Panel (Right) ─── */}
          <div className="lg:col-span-3">
            {selectedHypothesis ? (
              <div className={cn(ds.panel, 'space-y-5')}>
                {/* Detail Header */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h2 className={cn(ds.heading2, 'leading-snug')}>
                        {selectedHypothesis.statement}
                      </h2>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <StatusBadge status={selectedHypothesis.status} />
                        {selectedHypothesis.domain && (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-gray-300">
                            {selectedHypothesis.domain}
                          </span>
                        )}
                        <span className="text-xs text-gray-500 font-mono">
                          ID: {selectedHypothesis.id.slice(0, 12)}
                        </span>
                      </div>
                    </div>
                    {isDetailLoading && (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" />
                    )}
                  </div>

                  {/* Confidence Bar (large) */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Target className="w-3.5 h-3.5" /> Confidence
                      </span>
                    </div>
                    <ConfidenceMeter value={selectedHypothesis.confidence || 0} size="lg" />
                  </div>

                  {/* Rejection Reason */}
                  {selectedHypothesis.status === 'rejected' &&
                    selectedHypothesis.rejectionReason && (
                      <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-xs text-red-400 font-medium">Rejection Reason</p>
                        <p className="text-sm text-gray-300 mt-1">
                          {selectedHypothesis.rejectionReason}
                        </p>
                      </div>
                    )}

                  {/* Refined From */}
                  {selectedHypothesis.refinedFrom && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-purple-400">
                      <GitBranch className="w-3.5 h-3.5" />
                      Refined from:{' '}
                      <span className="font-mono text-gray-400">
                        {selectedHypothesis.refinedFrom.slice(0, 12)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 border-t border-lattice-border pt-4">
                  <button onClick={() => setShowEvidenceModal(true)} className={ds.btnSecondary}>
                    <FileText className="w-4 h-4" />
                    Add Evidence
                  </button>
                  <button onClick={() => setShowTestModal(true)} className={ds.btnSecondary}>
                    <Microscope className="w-4 h-4" />
                    Record Test
                  </button>
                  {selectedHypothesis.status !== 'confirmed' &&
                    selectedHypothesis.status !== 'archived' && (
                      <button
                        onClick={() => confirmMutation.mutate()}
                        disabled={confirmMutation.isPending}
                        className={cn(
                          ds.btnBase,
                          'px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
                        )}
                      >
                        {confirmMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Confirm
                      </button>
                    )}
                  {selectedHypothesis.status !== 'rejected' &&
                    selectedHypothesis.status !== 'archived' && (
                      <button onClick={() => setShowRejectModal(true)} className={ds.btnDanger}>
                        <XCircle className="w-4 h-4" />
                        Reject
                      </button>
                    )}
                  {selectedHypothesis.status !== 'archived' && (
                    <button
                      onClick={() => {
                        setRefineStatement(selectedHypothesis.statement);
                        setShowRefineModal(true);
                      }}
                      className={cn(
                        ds.btnBase,
                        'px-4 py-2 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30'
                      )}
                    >
                      <Sparkles className="w-4 h-4" />
                      Refine
                    </button>
                  )}
                </div>

                {/* Detail Tabs */}
                <div className="flex gap-1 border-b border-lattice-border">
                  {[
                    {
                      key: 'evidence' as const,
                      label: 'Evidence',
                      icon: ThumbsUp,
                      count:
                        (selectedHypothesis.evidenceFor?.length || 0) +
                        (selectedHypothesis.evidenceAgainst?.length || 0),
                    },
                    {
                      key: 'tests' as const,
                      label: 'Tests',
                      icon: Beaker,
                      count: selectedHypothesis.tests?.length || 0,
                    },
                    {
                      key: 'timeline' as const,
                      label: 'Timeline',
                      icon: Activity,
                      count: selectedHypothesis.timeline?.length || 0,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                        detailTab === tab.key
                          ? 'text-neon-cyan border-neon-cyan'
                          : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600'
                      )}
                    >
                      <tab.icon className="w-3.5 h-3.5" />
                      {tab.label}
                      {tab.count > 0 && (
                        <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">
                          {tab.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div className="min-h-[200px]">
                  {/* Evidence Tab */}
                  {detailTab === 'evidence' && (
                    <div className="space-y-4">
                      {/* Evidence Summary Bar */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <ThumbsUp className="w-3.5 h-3.5 text-green-400" />
                          <span className="text-green-400 font-medium">
                            {selectedHypothesis.evidenceFor?.length || 0} For
                          </span>
                        </div>
                        <div className="flex-1 h-2 rounded-full overflow-hidden bg-red-500/20">
                          {(() => {
                            const forCount = selectedHypothesis.evidenceFor?.length || 0;
                            const againstCount = selectedHypothesis.evidenceAgainst?.length || 0;
                            const total = forCount + againstCount;
                            const forPct = total > 0 ? (forCount / total) * 100 : 50;
                            return (
                              <div
                                className="h-full bg-green-500/50 transition-all duration-500"
                                style={{ width: `${forPct}%` }}
                              />
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-red-400 font-medium">
                            {selectedHypothesis.evidenceAgainst?.length || 0} Against
                          </span>
                          <ThumbsDown className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      </div>

                      {/* Evidence Toggle */}
                      <div className="flex gap-1">
                        {(['both', 'for', 'against'] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setExpandedEvidence(v)}
                            className={cn(
                              'px-3 py-1 rounded-md text-xs font-medium transition-all',
                              expandedEvidence === v
                                ? 'bg-white/15 text-white'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                            )}
                          >
                            {v === 'both'
                              ? 'All Evidence'
                              : v === 'for'
                                ? 'Supporting'
                                : 'Contradicting'}
                          </button>
                        ))}
                      </div>

                      {/* Evidence For */}
                      {(expandedEvidence === 'both' || expandedEvidence === 'for') && (
                        <div className="space-y-2">
                          {expandedEvidence === 'both' && (
                            <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wide flex items-center gap-1.5">
                              <ThumbsUp className="w-3 h-3" /> Supporting Evidence
                            </h4>
                          )}
                          {(selectedHypothesis.evidenceFor || []).length === 0 ? (
                            <p className="text-xs text-gray-500 py-2">
                              No supporting evidence yet.
                            </p>
                          ) : (
                            (selectedHypothesis.evidenceFor || []).map((e, i) => (
                              <EvidenceItem key={e.id || i} evidence={e} side="for" />
                            ))
                          )}
                        </div>
                      )}

                      {/* Evidence Against */}
                      {(expandedEvidence === 'both' || expandedEvidence === 'against') && (
                        <div className="space-y-2">
                          {expandedEvidence === 'both' && (
                            <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wide flex items-center gap-1.5 mt-3">
                              <ThumbsDown className="w-3 h-3" /> Contradicting Evidence
                            </h4>
                          )}
                          {(selectedHypothesis.evidenceAgainst || []).length === 0 ? (
                            <p className="text-xs text-gray-500 py-2">
                              No contradicting evidence yet.
                            </p>
                          ) : (
                            (selectedHypothesis.evidenceAgainst || []).map((e, i) => (
                              <EvidenceItem key={e.id || i} evidence={e} side="against" />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tests Tab */}
                  {detailTab === 'tests' && (
                    <div className="space-y-2">
                      {(selectedHypothesis.tests || []).length === 0 ? (
                        <div className="text-center py-8">
                          <Beaker className="w-10 h-10 mx-auto mb-3 text-gray-700" />
                          <p className="text-sm text-gray-400">No test results recorded yet.</p>
                          <button
                            onClick={() => setShowTestModal(true)}
                            className={cn(ds.btnSecondary, 'mt-3')}
                          >
                            <Microscope className="w-4 h-4" />
                            Record First Test
                          </button>
                        </div>
                      ) : (
                        (selectedHypothesis.tests || []).map((t, i) => (
                          <TestResultCard key={t.id || i} test={t} />
                        ))
                      )}
                    </div>
                  )}

                  {/* Timeline Tab */}
                  {detailTab === 'timeline' && (
                    <TimelineView events={selectedHypothesis.timeline || []} />
                  )}
                </div>
              </div>
            ) : (
              <div className={cn(ds.panel, 'flex flex-col items-center justify-center py-20')}>
                <Eye className="w-14 h-14 text-gray-700 mb-4" />
                <p className="text-gray-400 text-lg font-medium">Select a hypothesis</p>
                <p className="text-sm text-gray-600 mt-1 max-w-sm text-center">
                  Choose a hypothesis from the list to view its evidence, test results, and
                  lifecycle timeline.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════ Modals ═══════════════ */}

      {/* Create Hypothesis Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New Hypothesis"
      >
        <div className="space-y-4">
          <div>
            <label className={ds.label}>Hypothesis Statement</label>
            <textarea
              value={newStatement}
              onChange={(e) => setNewStatement(e.target.value)}
              placeholder="Enter a clear, falsifiable hypothesis statement..."
              className={cn(ds.textarea, 'h-24')}
              autoFocus
            />
          </div>
          <div>
            <label className={ds.label}>Domain (optional)</label>
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="e.g., physics, biology, economics, cognition..."
              className={ds.input}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreateModal(false)} className={ds.btnGhost}>
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate({ statement: newStatement, domain: newDomain })}
              disabled={!newStatement.trim() || createMutation.isPending}
              className={ds.btnPrimary}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  <FlaskConical className="w-4 h-4" /> Create Hypothesis
                </>
              )}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-400 mt-2">
              {(createMutation.error as Error)?.message || 'Failed to create hypothesis'}
            </p>
          )}
        </div>
      </Modal>

      {/* Add Evidence Modal */}
      <Modal
        open={showEvidenceModal}
        onClose={() => setShowEvidenceModal(false)}
        title="Add Evidence"
      >
        <div className="space-y-4">
          <div>
            <label className={ds.label}>Side</label>
            <div className="flex gap-2">
              <button
                onClick={() => setEvidenceSide('for')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                  evidenceSide === 'for'
                    ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : 'bg-white/5 text-gray-400 border-lattice-border hover:bg-white/10'
                )}
              >
                <ThumbsUp className="w-4 h-4 mx-auto mb-1" />
                Supporting
              </button>
              <button
                onClick={() => setEvidenceSide('against')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                  evidenceSide === 'against'
                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : 'bg-white/5 text-gray-400 border-lattice-border hover:bg-white/10'
                )}
              >
                <ThumbsDown className="w-4 h-4 mx-auto mb-1" />
                Contradicting
              </button>
            </div>
          </div>
          <div>
            <label className={ds.label}>Evidence Summary</label>
            <textarea
              value={evidenceSummary}
              onChange={(e) => setEvidenceSummary(e.target.value)}
              placeholder="Describe the evidence and its relevance..."
              className={cn(ds.textarea, 'h-20')}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={ds.label}>Weight ({(evidenceWeight * 100).toFixed(0)}%)</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={evidenceWeight}
                onChange={(e) => setEvidenceWeight(parseFloat(e.target.value))}
                className="w-full accent-neon-cyan"
              />
            </div>
            <div>
              <label className={ds.label}>DTU ID (optional)</label>
              <input
                type="text"
                value={evidenceDtuId}
                onChange={(e) => setEvidenceDtuId(e.target.value)}
                placeholder="Link a DTU..."
                className={ds.input}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowEvidenceModal(false)} className={ds.btnGhost}>
              Cancel
            </button>
            <button
              onClick={() =>
                addEvidenceMutation.mutate({
                  side: evidenceSide,
                  summary: evidenceSummary,
                  weight: evidenceWeight,
                  dtuId: evidenceDtuId || undefined,
                })
              }
              disabled={!evidenceSummary.trim() || addEvidenceMutation.isPending}
              className={ds.btnPrimary}
            >
              {addEvidenceMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Adding...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" /> Add Evidence
                </>
              )}
            </button>
          </div>
          {addEvidenceMutation.isError && (
            <p className="text-xs text-red-400">
              {(addEvidenceMutation.error as Error)?.message || 'Failed to add evidence'}
            </p>
          )}
        </div>
      </Modal>

      {/* Record Test Modal */}
      <Modal
        open={showTestModal}
        onClose={() => setShowTestModal(false)}
        title="Record Test Result"
      >
        <div className="space-y-4">
          <div>
            <label className={ds.label}>Test ID / Description</label>
            <input
              type="text"
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              placeholder="Enter test identifier or description..."
              className={ds.input}
              autoFocus
            />
          </div>
          <div>
            <label className={ds.label}>Result</label>
            <div className="flex gap-2">
              {[
                {
                  value: 'pass' as const,
                  label: 'Pass',
                  activeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
                  icon: CheckCircle2,
                },
                {
                  value: 'fail' as const,
                  label: 'Fail',
                  activeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
                  icon: XCircle,
                },
                {
                  value: 'inconclusive' as const,
                  label: 'Inconclusive',
                  activeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                  icon: AlertTriangle,
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTestResult(opt.value)}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all flex flex-col items-center gap-1',
                    testResult === opt.value
                      ? opt.activeClass
                      : 'bg-white/5 text-gray-400 border-lattice-border hover:bg-white/10'
                  )}
                >
                  <opt.icon className="w-4 h-4" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowTestModal(false)} className={ds.btnGhost}>
              Cancel
            </button>
            <button
              onClick={() => updateTestMutation.mutate({ testId, result: testResult })}
              disabled={!testId.trim() || updateTestMutation.isPending}
              className={ds.btnPrimary}
            >
              {updateTestMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Recording...
                </>
              ) : (
                <>
                  <Microscope className="w-4 h-4" /> Record Result
                </>
              )}
            </button>
          </div>
          {updateTestMutation.isError && (
            <p className="text-xs text-red-400">
              {(updateTestMutation.error as Error)?.message || 'Failed to record test'}
            </p>
          )}
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Reject Hypothesis"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            Provide a reason for rejecting this hypothesis. This helps document the reasoning
            process.
          </p>
          <div>
            <label className={ds.label}>Rejection Reason</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this hypothesis is being rejected..."
              className={cn(ds.textarea, 'h-24')}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowRejectModal(false)} className={ds.btnGhost}>
              Cancel
            </button>
            <button
              onClick={() => rejectMutation.mutate(rejectReason)}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              className={ds.btnDanger}
            >
              {rejectMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Rejecting...
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" /> Reject Hypothesis
                </>
              )}
            </button>
          </div>
          {rejectMutation.isError && (
            <p className="text-xs text-red-400">
              {(rejectMutation.error as Error)?.message || 'Failed to reject hypothesis'}
            </p>
          )}
        </div>
      </Modal>

      {/* Refine Modal */}
      <Modal
        open={showRefineModal}
        onClose={() => setShowRefineModal(false)}
        title="Refine Hypothesis"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            Refine the hypothesis statement based on new evidence or insights. The original will be
            preserved as a parent reference.
          </p>
          <div>
            <label className={ds.label}>Refined Statement</label>
            <textarea
              value={refineStatement}
              onChange={(e) => setRefineStatement(e.target.value)}
              placeholder="Enter the refined hypothesis statement..."
              className={cn(ds.textarea, 'h-24')}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowRefineModal(false)} className={ds.btnGhost}>
              Cancel
            </button>
            <button
              onClick={() => refineMutation.mutate(refineStatement)}
              disabled={!refineStatement.trim() || refineMutation.isPending}
              className={cn(
                ds.btnBase,
                'px-4 py-2 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30'
              )}
            >
              {refineMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Refining...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Refine Hypothesis
                </>
              )}
            </button>
          </div>
          {refineMutation.isError && (
            <p className="text-xs text-red-400">
              {(refineMutation.error as Error)?.message || 'Failed to refine hypothesis'}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
