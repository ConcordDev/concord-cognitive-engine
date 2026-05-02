'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Building2,
  Users,
  Beaker,
  Calendar,
  BarChart3,
  Plus,
  ChevronRight,
  ArrowLeft,
  Lightbulb,
  TrendingUp,
  Clock,
  UserPlus,
  FileText,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CRIMember {
  entityId: string;
  role: string;
  joinedAt?: string;
}

interface ResearchProgram {
  id: string;
  title: string;
  status: 'active' | 'completed' | 'paused' | 'proposed';
  progress: number;
  createdAt?: string;
}

interface Summit {
  id: string;
  date: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  agenda?: string;
  outcomes?: string[];
}

interface Hypothesis {
  id: string;
  statement: string;
  status: 'proposed' | 'testing' | 'confirmed' | 'refuted';
  confidence?: number;
}

interface CRISummary {
  id: string;
  name: string;
  domain: string;
  status?: string;
  memberCount?: number;
  activeProgramCount?: number;
  createdAt?: string;
}

interface CRIDetail {
  id: string;
  name: string;
  domain: string;
  status?: string;
  members: CRIMember[];
  programs: ResearchProgram[];
  summits: Summit[];
  hypotheses: Hypothesis[];
  dtuProductionRate?: number;
  totalDtus?: number;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Sovereign decree helper
// ---------------------------------------------------------------------------

async function decree<T = unknown>(payload: {
  action: string;
  target?: string;
  data?: Record<string, unknown>;
}): Promise<T> {
  const res = await api.post('/api/run', payload);
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STAT_CARD_STYLES: Record<string, { bg: string; text: string }> = {
  'neon-blue': { bg: 'bg-neon-blue/20', text: 'text-neon-blue' },
  'neon-purple': { bg: 'bg-neon-purple/20', text: 'text-neon-purple' },
  'neon-cyan': { bg: 'bg-neon-cyan/20', text: 'text-neon-cyan' },
  'neon-green': { bg: 'bg-neon-green/20', text: 'text-neon-green' },
};

const PROGRESS_BAR_COLORS: Record<string, string> = {
  'neon-cyan': 'bg-neon-cyan',
  'neon-purple': 'bg-neon-purple',
  'neon-blue': 'bg-neon-blue',
  'neon-green': 'bg-neon-green',
};

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  const styles = STAT_CARD_STYLES[color] || { bg: 'bg-gray-400/20', text: 'text-gray-400' };
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', styles.bg)}>
          <Icon className={cn('w-5 h-5', styles.text)} />
        </div>
        <div>
          <p className={ds.textMuted}>{label}</p>
          <p className="text-xl font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ value, color = 'neon-cyan' }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-lattice-elevated overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          PROGRESS_BAR_COLORS[color] || 'bg-neon-cyan'
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function DTUBarChart({ cris }: { cris: CRISummary[] }) {
  // We'll display a simple horizontal bar chart using the summary data
  // (The detail view has precise numbers; here we show relative comparison.)
  const maxRate = Math.max(1, ...cris.map((c) => c.activeProgramCount ?? 0));

  if (cris.length === 0) {
    return <p className={ds.textMuted}>No CRIs to display.</p>;
  }

  return (
    <div className="space-y-3">
      {cris.map((cri) => {
        const rate = cri.activeProgramCount ?? 0;
        const pct = (rate / maxRate) * 100;
        return (
          <div key={cri.id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300 truncate max-w-[180px]">{cri.name}</span>
              <span className="text-neon-cyan font-mono">{rate}</span>
            </div>
            <ProgressBar value={pct} color="neon-cyan" />
          </div>
        );
      })}
    </div>
  );
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neon-green/20 text-neon-green',
  completed:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neon-blue/20 text-neon-blue',
  paused:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-400/20 text-yellow-400',
  proposed:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-400/20 text-gray-400',
  scheduled:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neon-purple/20 text-neon-purple',
  cancelled:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-400/20 text-red-400',
  testing:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neon-cyan/20 text-neon-cyan',
  confirmed:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neon-green/20 text-neon-green',
  refuted:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-400/20 text-red-400',
  forming:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-400/20 text-yellow-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        STATUS_BADGE_CLASSES[status] ??
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-400/20 text-gray-400'
      }
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create CRI Modal
// ---------------------------------------------------------------------------

function CreateCRIModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  const createMut = useMutation({
    mutationFn: () => decree({ action: 'cri-create', data: { name, domain } }),
    onSuccess: () => {
      setName('');
      setDomain('');
      onCreated();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className={ds.modalContainer} onClick={onClose}>
      <div className={ds.modalBackdrop} />
      <div
        className={cn(ds.modalPanel, 'max-w-md relative z-50')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h2 className={ds.heading2}>Create New CRI</h2>
          <button onClick={onClose} className={ds.btnGhost}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className={ds.label}>Name</label>
            <input
              className={ds.input}
              placeholder="e.g. Cognitive Architecture Lab"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={ds.label}>Research Domain</label>
            <input
              className={ds.input}
              placeholder="e.g. neuroscience, AI safety, physics"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-lattice-border">
          <button onClick={onClose} className={ds.btnSecondary}>
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || !domain.trim() || createMut.isPending}
            className={ds.btnPrimary}
          >
            {createMut.isPending ? 'Creating...' : 'Create CRI'}
          </button>
        </div>

        {createMut.isError && (
          <p className="px-4 pb-3 text-sm text-red-400">Failed to create CRI. Please try again.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Member Modal
// ---------------------------------------------------------------------------

function AddMemberModal({
  criId,
  open,
  onClose,
  onAdded,
}: {
  criId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [entityId, setEntityId] = useState('');
  const [role, setRole] = useState('researcher');

  const addMut = useMutation({
    mutationFn: () => decree({ action: 'cri-add-member', target: criId, data: { entityId, role } }),
    onSuccess: () => {
      setEntityId('');
      setRole('researcher');
      onAdded();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className={ds.modalContainer} onClick={onClose}>
      <div className={ds.modalBackdrop} />
      <div
        className={cn(ds.modalPanel, 'max-w-md relative z-50')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h2 className={ds.heading2}>Add Member</h2>
          <button onClick={onClose} className={ds.btnGhost}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className={ds.label}>Entity ID</label>
            <input
              className={ds.input}
              placeholder="Entity identifier"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </div>
          <div>
            <label className={ds.label}>Role</label>
            <select className={ds.select} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="researcher">Researcher</option>
              <option value="lead">Lead</option>
              <option value="advisor">Advisor</option>
              <option value="observer">Observer</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-lattice-border">
          <button onClick={onClose} className={ds.btnSecondary}>
            Cancel
          </button>
          <button
            onClick={() => addMut.mutate()}
            disabled={!entityId.trim() || addMut.isPending}
            className={ds.btnPrimary}
          >
            {addMut.isPending ? 'Adding...' : 'Add Member'}
          </button>
        </div>

        {addMut.isError && (
          <p className="px-4 pb-3 text-sm text-red-400">Failed to add member. Please try again.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Program Modal
// ---------------------------------------------------------------------------

function CreateProgramModal({
  criId,
  open,
  onClose,
  onCreated,
}: {
  criId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');

  const createMut = useMutation({
    mutationFn: () => decree({ action: 'cri-program', target: criId, data: { title } }),
    onSuccess: () => {
      setTitle('');
      onCreated();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className={ds.modalContainer} onClick={onClose}>
      <div className={ds.modalBackdrop} />
      <div
        className={cn(ds.modalPanel, 'max-w-md relative z-50')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h2 className={ds.heading2}>Create Research Program</h2>
          <button onClick={onClose} className={ds.btnGhost}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className={ds.label}>Program Title</label>
            <input
              className={ds.input}
              placeholder="e.g. Memory Consolidation Study"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-lattice-border">
          <button onClick={onClose} className={ds.btnSecondary}>
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!title.trim() || createMut.isPending}
            className={ds.btnPrimary}
          >
            {createMut.isPending ? 'Creating...' : 'Create Program'}
          </button>
        </div>

        {createMut.isError && (
          <p className="px-4 pb-3 text-sm text-red-400">
            Failed to create program. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CRI Detail View
// ---------------------------------------------------------------------------

function CRIDetailView({ criId, onBack }: { criId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateProgram, setShowCreateProgram] = useState(false);

  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery<CRIDetail>({
    queryKey: ['cri-status', criId],
    queryFn: () => decree<CRIDetail>({ action: 'cri-status', target: criId }),
    refetchInterval: 30_000,
  });

  const scheduleSummitMut = useMutation({
    mutationFn: () => decree({ action: 'cri-summit', target: criId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cri-status', criId] });
    },
  });

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ['cri-status', criId] });
    queryClient.invalidateQueries({ queryKey: ['cri-list'] });
  };

  if (isLoading) {
    return (
      <div className={ds.pageContainer}>
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse text-gray-400">Loading CRI details...</div>
        </div>
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className={ds.pageContainer}>
        <button onClick={onBack} className={cn(ds.btnGhost, 'mb-4')}>
          <ArrowLeft className="w-4 h-4" /> Back to CRIs
        </button>
        <div className={ds.panel}>
          <p className="text-red-400">Failed to load CRI details.</p>
        </div>
      </div>
    );
  }

  const members = detail.members ?? [];
  const programs = detail.programs ?? [];
  const summits = detail.summits ?? [];
  const hypotheses = detail.hypotheses ?? [];
  const activePrograms = programs.filter((p) => p.status === 'active');
  const upcomingSummits = summits.filter((s) => s.status === 'scheduled');

  return (
    <div className={ds.pageContainer}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={ds.btnGhost}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className={ds.heading1}>{detail.name}</h1>
          <p className={ds.textMuted}>
            Domain: {detail.domain} {detail.status && <StatusBadge status={detail.status} />}
          </p>
        </div>
        <button
          onClick={() => scheduleSummitMut.mutate()}
          disabled={scheduleSummitMut.isPending}
          className={ds.btnPrimary}
        >
          <Calendar className="w-4 h-4" />
          {scheduleSummitMut.isPending ? 'Scheduling...' : 'Schedule Summit'}
        </button>
      </div>

      {/* Stats row */}
      <div className={ds.grid4}>
        <StatCard icon={Users} label="Members" value={members.length} color="neon-blue" />
        <StatCard
          icon={Beaker}
          label="Active Programs"
          value={activePrograms.length}
          color="neon-purple"
        />
        <StatCard
          icon={Calendar}
          label="Upcoming Summits"
          value={upcomingSummits.length}
          color="neon-cyan"
        />
        <StatCard
          icon={BarChart3}
          label="DTU Production"
          value={detail.dtuProductionRate ?? detail.totalDtus ?? 0}
          color="neon-green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Members panel */}
        <div className={cn(ds.panel, 'space-y-3')}>
          <div className={ds.sectionHeader}>
            <h2 className={ds.heading3}>
              <Users className="w-4 h-4 inline mr-2 text-neon-blue" />
              Members
            </h2>
            <button onClick={() => setShowAddMember(true)} className={ds.btnGhost}>
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
          {members.length === 0 ? (
            <p className={ds.textMuted}>No members yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {members.map((m, i) => (
                <div
                  key={`${m.entityId}-${i}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-lattice-elevated/50"
                >
                  <div>
                    <p className="text-sm text-white font-medium truncate max-w-[160px]">
                      {m.entityId}
                    </p>
                    {m.joinedAt && (
                      <p className="text-xs text-gray-500">
                        Joined {new Date(m.joinedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={m.role} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Research Programs panel */}
        <div className={cn(ds.panel, 'space-y-3')}>
          <div className={ds.sectionHeader}>
            <h2 className={ds.heading3}>
              <Beaker className="w-4 h-4 inline mr-2 text-neon-purple" />
              Research Programs
            </h2>
            <button onClick={() => setShowCreateProgram(true)} className={ds.btnGhost}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {programs.length === 0 ? (
            <p className={ds.textMuted}>No programs yet.</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {programs.map((p) => (
                <div key={p.id} className="space-y-1.5 py-2 px-3 rounded-lg bg-lattice-elevated/50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-white font-medium truncate max-w-[160px]">
                      {p.title}
                    </p>
                    <StatusBadge status={p.status} />
                  </div>
                  <ProgressBar value={p.progress ?? 0} color="neon-purple" />
                  <p className="text-xs text-gray-500">{p.progress ?? 0}% complete</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hypothesis Pipeline */}
        <div className={cn(ds.panel, 'space-y-3')}>
          <h2 className={ds.heading3}>
            <Lightbulb className="w-4 h-4 inline mr-2 text-yellow-400" />
            Hypothesis Pipeline
          </h2>
          {hypotheses.length === 0 ? (
            <p className={ds.textMuted}>No hypotheses tracked.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {hypotheses.map((h) => (
                <div key={h.id} className="py-2 px-3 rounded-lg bg-lattice-elevated/50 space-y-1">
                  <p className="text-sm text-gray-200 line-clamp-2">{h.statement}</p>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={h.status} />
                    {h.confidence != null && (
                      <span className="text-xs text-gray-400 font-mono">
                        {(h.confidence * 100).toFixed(0)}% conf.
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summit History */}
      <div className={cn(ds.panel, 'space-y-3')}>
        <h2 className={ds.heading3}>
          <Calendar className="w-4 h-4 inline mr-2 text-neon-cyan" />
          Summit History
        </h2>
        {summits.length === 0 ? (
          <p className={ds.textMuted}>No summits recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-lattice-border">
                  <th className="text-left py-2 px-3 font-medium">Date</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-left py-2 px-3 font-medium">Agenda</th>
                  <th className="text-left py-2 px-3 font-medium">Outcomes</th>
                </tr>
              </thead>
              <tbody>
                {summits.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30"
                  >
                    <td className="py-2 px-3 text-white font-mono text-xs">
                      {new Date(s.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-2 px-3 text-gray-300 max-w-xs truncate">
                      {s.agenda || '--'}
                    </td>
                    <td className="py-2 px-3 text-gray-300 max-w-xs truncate">
                      {s.outcomes?.join(', ') || '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddMemberModal
        criId={criId}
        open={showAddMember}
        onClose={() => setShowAddMember(false)}
        onAdded={invalidateDetail}
      />
      <CreateProgramModal
        criId={criId}
        open={showCreateProgram}
        onClose={() => setShowCreateProgram(false)}
        onCreated={invalidateDetail}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CRI Dashboard Page
// ---------------------------------------------------------------------------

export default function CRIDashboardPage() {
  const queryClient = useQueryClient();
  const [selectedCRI, setSelectedCRI] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Fetch all CRIs
  const {
    data: criList,
    isLoading,
    isError,
  } = useQuery<CRISummary[]>({
    queryKey: ['cri-list'],
    queryFn: async () => {
      const res = await decree<{ cris?: CRISummary[]; items?: CRISummary[] }>({
        action: 'cri-list',
      });
      // Handle various response shapes
      return (res as unknown as CRISummary[]) ?? [];
    },
    select: (data) => {
      if (Array.isArray(data)) return data;
      const obj = data as unknown as { cris?: CRISummary[]; items?: CRISummary[] };
      return obj?.cris ?? obj?.items ?? [];
    },
    refetchInterval: 30_000,
  });

  const cris: CRISummary[] = Array.isArray(criList) ? criList : [];

  // If a CRI is selected, show the detail view
  if (selectedCRI) {
    return <CRIDetailView criId={selectedCRI} onBack={() => setSelectedCRI(null)} />;
  }

  // Aggregate stats
  const totalMembers = cris.reduce((sum, c) => sum + (c.memberCount ?? 0), 0);
  const totalPrograms = cris.reduce((sum, c) => sum + (c.activeProgramCount ?? 0), 0);

  return (
    <div className={ds.pageContainer}>
      {/* Page Header */}
      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-neon-purple/20">
            <Building2 className="w-6 h-6 text-neon-purple" />
          </div>
          <div>
            <h1 className={ds.heading1}>CRI Dashboard</h1>
            <p className={ds.textMuted}>Collaborative Research Institutes -- System 13e</p>
          </div>
        </div>
        <button onClick={() => setShowCreateModal(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" />
          New CRI
        </button>
      </div>

      {/* Overview Stats */}
      <div className={ds.grid4}>
        <StatCard icon={Building2} label="Total CRIs" value={cris.length} color="neon-purple" />
        <StatCard icon={Users} label="Total Members" value={totalMembers} color="neon-blue" />
        <StatCard icon={Beaker} label="Active Programs" value={totalPrograms} color="neon-cyan" />
        <StatCard
          icon={TrendingUp}
          label="Institutes Active"
          value={cris.filter((c) => c.status === 'active' || !c.status).length}
          color="neon-green"
        />
      </div>

      {/* Loading / Error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-pulse text-gray-400">Loading CRIs...</div>
        </div>
      )}

      {isError && (
        <div className={ds.panel}>
          <p className="text-red-400">
            Failed to load CRIs. The sovereign decree endpoint may not be available.
          </p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['cri-list'] })}
            className={cn(ds.btnSecondary, 'mt-3')}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main content grid */}
      {!isLoading && !isError && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* CRI Cards - takes 2 columns */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className={ds.heading2}>Research Institutes</h2>

            {cris.length === 0 ? (
              <div className={cn(ds.panel, 'flex flex-col items-center justify-center py-12')}>
                <Building2 className="w-12 h-12 text-gray-600 mb-3" />
                <p className="text-gray-400 mb-1">No CRIs found</p>
                <p className={ds.textMuted}>
                  Create a Collaborative Research Institute to get started.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className={cn(ds.btnPrimary, 'mt-4')}
                >
                  <Plus className="w-4 h-4" />
                  Create First CRI
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {cris.map((cri) => (
                  <div
                    key={cri.id}
                    onClick={() => setSelectedCRI(cri.id)}
                    className={cn(ds.panelHover, 'flex items-center gap-4')}
                  >
                    <div className="p-3 rounded-lg bg-neon-purple/10 shrink-0">
                      <Building2 className="w-5 h-5 text-neon-purple" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-semibold truncate">{cri.name}</h3>
                        {cri.status && <StatusBadge status={cri.status} />}
                      </div>
                      <p className={cn(ds.textMuted, 'truncate')}>{cri.domain}</p>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-center">
                        <p className="text-white font-bold">{cri.memberCount ?? 0}</p>
                        <p className="text-xs text-gray-500">Members</p>
                      </div>
                      <div className="text-center">
                        <p className="text-white font-bold">{cri.activeProgramCount ?? 0}</p>
                        <p className="text-xs text-gray-500">Programs</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* DTU Production Rates */}
            <div className={cn(ds.panel, 'space-y-3')}>
              <h3 className={ds.heading3}>
                <BarChart3 className="w-4 h-4 inline mr-2 text-neon-cyan" />
                Active Programs by CRI
              </h3>
              <DTUBarChart cris={cris} />
            </div>

            {/* Quick Actions */}
            <div className={cn(ds.panel, 'space-y-3')}>
              <h3 className={ds.heading3}>
                <FileText className="w-4 h-4 inline mr-2 text-neon-blue" />
                Quick Actions
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className={cn(ds.btnGhost, 'w-full justify-start')}
                >
                  <Plus className="w-4 h-4 text-neon-green" />
                  Create New CRI
                </button>
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['cri-list'] })}
                  className={cn(ds.btnGhost, 'w-full justify-start')}
                >
                  <Clock className="w-4 h-4 text-neon-cyan" />
                  Refresh Data
                </button>
              </div>
            </div>

            {/* Recent Activity */}
            <div className={cn(ds.panel, 'space-y-3')}>
              <h3 className={ds.heading3}>
                <Clock className="w-4 h-4 inline mr-2 text-gray-400" />
                Recent Activity
              </h3>
              {cris.length === 0 ? (
                <p className={ds.textMuted}>No activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {cris.slice(0, 5).map((cri) => (
                    <div
                      key={cri.id}
                      className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-lattice-elevated/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedCRI(cri.id)}
                    >
                      <Building2 className="w-3.5 h-3.5 text-neon-purple shrink-0" />
                      <span className="text-gray-300 truncate">{cri.name}</span>
                      <ChevronRight className="w-3 h-3 text-gray-600 ml-auto shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create CRI Modal */}
      <CreateCRIModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['cri-list'] })}
      />
    </div>
  );
}
