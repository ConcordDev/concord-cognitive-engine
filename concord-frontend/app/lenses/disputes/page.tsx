'use client';

/**
 * Dispute Resolution Center — /lenses/disputes
 *
 * Full dispute lifecycle: buyers file, sellers respond, admins resolve.
 * Status flow visualization, auto-escalation awareness, refund controls.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  MessageSquare,
  Send,
  Plus,
  X,
  Gavel,
  FileText,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Scale,
  Eye,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DisputeStatus = 'open' | 'under_review' | 'mediation' | 'escalated' | 'resolved' | 'dismissed';
type DisputeType = 'not_as_described' | 'unauthorized_purchase' | 'non_delivery' | 'other';
type ResolutionType = 'refund' | 'no_refund' | 'partial_refund';
type UserRole = 'buyer' | 'seller' | 'admin';

interface Dispute {
  id: string;
  dispute_type: string;
  reporter_id: string;
  reported_user_id: string;
  reported_content_id: string;
  description: string;
  evidence: string[];
  status: DisputeStatus;
  resolution: string | null;
  opened_at: string;
  resolved_at: string | null;
  userRole: UserRole;
  canRespond: boolean;
  metadata?: {
    amount: number;
    transaction_id: string;
    original_type: DisputeType;
    seller_response_deadline: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Status configuration                                               */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<DisputeStatus, {
  label: string;
  icon: typeof Clock;
  bgClass: string;
  textClass: string;
}> = {
  open:         { label: 'Open',         icon: Clock,          bgClass: 'bg-yellow-500/20', textClass: 'text-yellow-400' },
  under_review: { label: 'Under Review', icon: Eye,            bgClass: 'bg-blue-500/20',   textClass: 'text-blue-400' },
  mediation:    { label: 'Mediation',    icon: Scale,          bgClass: 'bg-purple-500/20', textClass: 'text-purple-400' },
  escalated:    { label: 'Escalated',    icon: AlertTriangle,  bgClass: 'bg-orange-500/20', textClass: 'text-orange-400' },
  resolved:     { label: 'Resolved',     icon: CheckCircle2,   bgClass: 'bg-green-500/20',  textClass: 'text-green-400' },
  dismissed:    { label: 'Dismissed',    icon: XCircle,        bgClass: 'bg-gray-500/20',   textClass: 'text-gray-400' },
};

const TYPE_LABELS: Record<string, string> = {
  not_as_described: 'Not As Described',
  unauthorized_purchase: 'Unauthorized Purchase',
  non_delivery: 'Non-Delivery',
  other: 'Other',
  quality: 'Quality Issue',
  fraudulent_listing: 'Fraudulent Listing',
  copyright: 'Copyright',
  derivative_claim: 'Derivative Claim',
};

const DISPUTE_TYPES = [
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'unauthorized_purchase', label: 'Unauthorized purchase' },
  { value: 'non_delivery', label: 'Non-delivery' },
  { value: 'other', label: 'Other' },
];

const STATUS_FLOW: DisputeStatus[] = ['open', 'under_review', 'mediation', 'escalated', 'resolved'];

/* ------------------------------------------------------------------ */
/*  Data hooks                                                         */
/* ------------------------------------------------------------------ */

function useMyDisputes() {
  return useQuery({
    queryKey: ['disputes', 'my'],
    queryFn: () => api.get('/api/disputes/my').then(r => r.data),
    refetchInterval: 30000,
  });
}

function useDisputeQueue() {
  return useQuery({
    queryKey: ['disputes', 'queue'],
    queryFn: () => api.get('/api/disputes/queue').then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });
}

function useDisputeDetail(id: string | null) {
  return useQuery({
    queryKey: ['disputes', 'detail', id],
    queryFn: () => api.get(`/api/disputes/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: DisputeStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  const Icon = config.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      config.bgClass,
      config.textClass,
    )}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Flow Visualization                                          */
/* ------------------------------------------------------------------ */

function StatusFlow({ currentStatus }: { currentStatus: DisputeStatus }) {
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);
  return (
    <div className="flex items-center gap-1 py-3 flex-wrap">
      {STATUS_FLOW.map((step, i) => {
        const config = STATUS_CONFIG[step];
        const Icon = config.icon;
        const isActive = step === currentStatus;
        const isPast = i < currentIndex
          || currentStatus === 'resolved'
          || currentStatus === 'dismissed';

        return (
          <div key={step} className="flex items-center gap-1">
            <div className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all',
              isActive
                ? cn(config.bgClass, config.textClass, 'ring-1 ring-current')
                : isPast
                  ? 'bg-green-500/10 text-green-400/60'
                  : 'bg-lattice-elevated text-gray-600',
            )}>
              <Icon size={11} />
              <span className="hidden sm:inline">{config.label}</span>
            </div>
            {i < STATUS_FLOW.length - 1 && (
              <ArrowRight size={12} className={cn(isPast ? 'text-green-400/40' : 'text-gray-700')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Dispute Modal                                               */
/* ------------------------------------------------------------------ */

function CreateDisputeForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [type, setType] = useState('not_as_described');
  const [transactionId, setTransactionId] = useState('');
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState('');

  const mutation = useMutation({
    mutationFn: (data: { transactionId: string; type: string; statement: string; evidence?: string[] }) =>
      api.post('/api/disputes/create', data).then(r => r.data),
    onSuccess: () => onSuccess(),
  });

  const handleSubmit = () => {
    const evidenceList = evidence ? evidence.split('\n').filter(Boolean) : undefined;
    mutation.mutate({ transactionId, type, statement, evidence: evidenceList });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={ds.modalContainer}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className={cn(ds.modalPanel, 'max-w-lg')}
      >
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle size={18} className="text-orange-400" />
            Report a Problem
          </h2>
          <button onClick={onClose} className={ds.btnGhost}><X size={16} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className={ds.label}>Transaction ID</label>
            <input
              className={ds.input}
              value={transactionId}
              onChange={e => setTransactionId(e.target.value)}
              placeholder="tx_..."
            />
          </div>

          <div>
            <label className={ds.label}>Issue Type</label>
            <select className={ds.select} value={type} onChange={e => setType(e.target.value)}>
              {DISPUTE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={ds.label}>Describe the problem</label>
            <textarea
              className={cn(ds.textarea, 'h-28')}
              value={statement}
              onChange={e => setStatement(e.target.value)}
              placeholder="What went wrong? Be specific..."
            />
          </div>

          <div>
            <label className={ds.label}>Evidence URLs (one per line, optional)</label>
            <textarea
              className={cn(ds.textarea, 'h-20')}
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
              placeholder="https://example.com/screenshot.png"
            />
          </div>

          {mutation.isError && (
            <p className="text-red-400 text-sm flex items-center gap-1">
              <XCircle size={14} />
              {(mutation.error as Error)?.message || 'Failed to submit dispute'}
            </p>
          )}
        </div>

        <div className="flex gap-3 p-4 border-t border-lattice-border">
          <button onClick={onClose} className={cn(ds.btnSecondary, 'flex-1')}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!transactionId || !statement || mutation.isPending}
            className={cn(ds.btnPrimary, 'flex-1')}
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Submit Dispute
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Seller Response Panel                                              */
/* ------------------------------------------------------------------ */

function SellerResponsePanel({ dispute, onSuccess }: { dispute: Dispute; onSuccess: () => void }) {
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState('');
  const [offerRefund, setOfferRefund] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/api/disputes/${dispute.id}/seller-respond`, {
        statement,
        evidence: evidence ? evidence.split('\n').filter(Boolean) : undefined,
        offerRefund,
      }).then(r => r.data),
    onSuccess,
  });

  if (!dispute.canRespond) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'border-orange-500/30 space-y-3')}
    >
      <div className="flex items-center gap-2 text-orange-400">
        <MessageSquare size={16} />
        <span className="font-medium text-sm">Your Response Required</span>
      </div>

      <textarea
        className={cn(ds.textarea, 'h-24')}
        placeholder="Explain your side of the situation..."
        value={statement}
        onChange={e => setStatement(e.target.value)}
      />

      <textarea
        className={cn(ds.textarea, 'h-16')}
        placeholder="Evidence URLs (one per line, optional)"
        value={evidence}
        onChange={e => setEvidence(e.target.value)}
      />

      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={offerRefund}
          onChange={e => setOfferRefund(e.target.checked)}
          className="rounded border-gray-600 bg-lattice-surface text-neon-blue focus:ring-neon-blue"
        />
        Offer a full refund to resolve this dispute
      </label>

      {mutation.isError && (
        <p className="text-red-400 text-sm flex items-center gap-1">
          <AlertCircle size={12} />
          {(mutation.error as Error)?.message || 'Response failed'}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => mutation.mutate()}
          disabled={!statement || mutation.isPending}
          className={ds.btnPrimary}
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Submit Response
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Resolution Panel                                             */
/* ------------------------------------------------------------------ */

function AdminResolutionPanel({ dispute, onSuccess }: { dispute: Dispute; onSuccess: () => void }) {
  const [resolution, setResolution] = useState<ResolutionType>('refund');
  const [notes, setNotes] = useState('');
  const [partialPercent, setPartialPercent] = useState(50);

  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/api/disputes/${dispute.id}/resolve`, {
        resolution,
        notes: notes || undefined,
        partialPercent: resolution === 'partial_refund' ? partialPercent : undefined,
      }).then(r => r.data),
    onSuccess,
  });

  if (dispute.status === 'resolved' || dispute.status === 'dismissed') return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'border-neon-blue/30 space-y-3')}
    >
      <div className="flex items-center gap-2 text-neon-blue">
        <Gavel size={16} />
        <span className="font-medium text-sm">Admin Resolution</span>
      </div>

      <div>
        <label className={ds.label}>Decision</label>
        <select
          className={ds.select}
          value={resolution}
          onChange={e => setResolution(e.target.value as ResolutionType)}
        >
          <option value="refund">Full Refund to Buyer</option>
          <option value="partial_refund">Partial Refund</option>
          <option value="no_refund">No Refund (Dismiss)</option>
        </select>
      </div>

      {resolution === 'partial_refund' && (
        <div>
          <label className={ds.label}>Refund Percentage: {partialPercent}%</label>
          <input
            type="range"
            min={1}
            max={99}
            value={partialPercent}
            onChange={e => setPartialPercent(Number(e.target.value))}
            className="w-full accent-neon-blue"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1%</span><span>50%</span><span>99%</span>
          </div>
        </div>
      )}

      <div>
        <label className={ds.label}>Resolution Notes</label>
        <textarea
          className={cn(ds.textarea, 'h-20')}
          placeholder="Reason for this decision..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {mutation.isError && (
        <p className="text-red-400 text-sm flex items-center gap-1">
          <AlertCircle size={12} />
          {(mutation.error as Error)?.message || 'Resolution failed'}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={resolution === 'no_refund' ? ds.btnDanger : ds.btnPrimary}
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
          {resolution === 'no_refund' ? 'Dismiss Dispute' : 'Issue Resolution'}
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dispute Card                                                       */
/* ------------------------------------------------------------------ */

function DisputeCard({
  dispute,
  expanded,
  onToggle,
  onUpdate,
  isAdmin,
}: {
  dispute: Dispute;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: () => void;
  isAdmin: boolean;
}) {
  const { data: detail } = useDisputeDetail(expanded ? dispute.id : null);
  const fullDispute: Dispute = detail?.dispute || dispute;

  const parsedResolution = (() => {
    try { return fullDispute.resolution ? JSON.parse(fullDispute.resolution) : null; }
    catch { return null; }
  })();

  const statusConfig = STATUS_CONFIG[fullDispute.status as DisputeStatus] || STATUS_CONFIG.open;
  const StatusIcon = statusConfig.icon;

  return (
    <motion.div layout className={cn(ds.panel, 'overflow-hidden !p-0')}>
      {/* Collapsed header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-lattice-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={cn('p-2 rounded-lg', statusConfig.bgClass, statusConfig.textClass)}>
            <StatusIcon size={16} />
          </div>
          <div className="text-left">
            <p className="text-white font-medium text-sm">
              {TYPE_LABELS[fullDispute.dispute_type] || fullDispute.dispute_type}
            </p>
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
              <span className="font-mono">{fullDispute.id}</span>
              <span>{fullDispute.opened_at ? new Date(fullDispute.opened_at).toLocaleDateString() : ''}</span>
              {fullDispute.metadata?.amount != null && (
                <span className="flex items-center gap-0.5">
                  <DollarSign size={10} />{fullDispute.metadata.amount} CC
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'px-2 py-0.5 rounded text-xs font-medium',
            dispute.userRole === 'buyer'  ? 'bg-blue-500/20 text-blue-400' :
            dispute.userRole === 'seller' ? 'bg-orange-500/20 text-orange-400' :
            'bg-purple-500/20 text-purple-400',
          )}>
            {dispute.userRole}
          </span>
          <StatusBadge status={fullDispute.status as DisputeStatus} />
          {expanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-lattice-border overflow-hidden"
          >
            <div className="px-5 py-4 space-y-4">
              {/* Status flow */}
              <StatusFlow currentStatus={fullDispute.status as DisputeStatus} />

              {/* Buyer statement */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Buyer Statement</p>
                <p className="text-gray-300 text-sm">{fullDispute.description}</p>
              </div>

              {/* Evidence */}
              {fullDispute.evidence && fullDispute.evidence.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Evidence</p>
                  <div className="space-y-1">
                    {fullDispute.evidence.map((e, i) => (
                      <a
                        key={i}
                        href={e}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-neon-blue hover:underline"
                      >
                        <FileText size={12} />{e}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Resolution info */}
              {parsedResolution && (
                <div className="bg-lattice-elevated rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Resolution</p>
                  <p className="text-white font-medium text-sm">
                    {parsedResolution.type === 'seller_refund' && 'Seller issued a voluntary refund.'}
                    {parsedResolution.type === 'auto_refund' && 'Auto-refunded (seller did not respond within 48 hours).'}
                    {parsedResolution.type === 'refund' && 'Full refund issued by admin.'}
                    {parsedResolution.type === 'partial_refund' && `Admin issued a ${parsedResolution.partialPercent}% partial refund.`}
                    {parsedResolution.type === 'no_refund' && 'Dispute dismissed. No refund issued.'}
                  </p>
                  {parsedResolution.sellerStatement && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500">Seller Response</p>
                      <p className="text-gray-400 text-sm">{parsedResolution.sellerStatement}</p>
                    </div>
                  )}
                  {parsedResolution.notes && (
                    <p className="text-xs text-gray-500 mt-2">{parsedResolution.notes}</p>
                  )}
                  {parsedResolution.refundAmount > 0 && (
                    <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
                      <DollarSign size={10} />{parsedResolution.refundAmount} CC refunded
                    </p>
                  )}
                  {fullDispute.resolved_at && (
                    <p className="text-xs text-gray-600 mt-1">
                      Resolved {new Date(fullDispute.resolved_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {/* Seller response panel */}
              {dispute.userRole === 'seller' && dispute.canRespond && (
                <SellerResponsePanel dispute={fullDispute} onSuccess={onUpdate} />
              )}

              {/* Admin resolution panel */}
              {isAdmin && (
                <AdminResolutionPanel dispute={fullDispute} onSuccess={onUpdate} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

type ViewTab = 'my' | 'queue';

export default function DisputesPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('my');
  const [statusFilter, setStatusFilter] = useState<DisputeStatus | 'all'>('all');
  const queryClient = useQueryClient();

  const myDisputes = useMyDisputes();
  const adminQueue = useDisputeQueue();

  // Admin access determined by whether queue endpoint succeeds
  const isAdmin = adminQueue.isSuccess && !adminQueue.isError;

  const disputes: Dispute[] = activeTab === 'my'
    ? (myDisputes.data?.disputes || [])
    : (adminQueue.data?.queue || []);

  const filtered = statusFilter === 'all'
    ? disputes
    : disputes.filter(d => d.status === statusFilter);

  const isLoading = activeTab === 'my' ? myDisputes.isLoading : adminQueue.isLoading;

  const stats = {
    total: disputes.length,
    open: disputes.filter(d => d.status === 'open').length,
    escalated: disputes.filter(d => d.status === 'escalated').length,
    resolved: disputes.filter(d => d.status === 'resolved').length,
  };

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['disputes'] });
  }, [queryClient]);

  const handleRefresh = useCallback(() => {
    if (activeTab === 'my') myDisputes.refetch();
    else adminQueue.refetch();
  }, [activeTab, myDisputes, adminQueue]);

  return (
    <div className={ds.pageContainer}>
      {/* Header */}
      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-neon-blue" />
          <div>
            <h1 className={ds.heading1}>Dispute Resolution</h1>
            <p className={ds.textMuted}>Transaction disputes and resolution management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className={ds.btnGhost} title="Refresh">
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowCreateForm(true)} className={ds.btnPrimary}>
            <Plus size={16} />
            Report Problem
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className={ds.grid4}>
        {[
          { label: 'Total',     value: stats.total,     icon: FileText,      color: 'text-gray-400' },
          { label: 'Open',      value: stats.open,      icon: Clock,         color: 'text-yellow-400' },
          { label: 'Escalated', value: stats.escalated, icon: AlertTriangle, color: 'text-orange-400' },
          { label: 'Resolved',  value: stats.resolved,  icon: CheckCircle2,  color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className={ds.panel}>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>{s.label}</span>
              <s.icon size={16} className={s.color} />
            </div>
            <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className={ds.tabBar}>
        <button
          className={activeTab === 'my' ? ds.tabActive('neon-blue') : ds.tabInactive}
          onClick={() => { setActiveTab('my'); setStatusFilter('all'); }}
        >
          <MessageSquare size={14} />
          My Disputes
        </button>
        {isAdmin && (
          <button
            className={activeTab === 'queue' ? ds.tabActive('neon-purple') : ds.tabInactive}
            onClick={() => { setActiveTab('queue'); setStatusFilter('all'); }}
          >
            <Gavel size={14} />
            Admin Queue
            {stats.escalated > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400">
                {stats.escalated}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={ds.textMuted}>Filter:</span>
        {(['all', 'open', 'under_review', 'escalated', 'mediation', 'resolved', 'dismissed'] as const).map(s => {
          const config = s === 'all' ? null : STATUS_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                statusFilter === s
                  ? (config ? cn(config.bgClass, config.textClass) : 'bg-white/10 text-white')
                  : 'text-gray-500 hover:text-gray-300 hover:bg-lattice-elevated',
              )}
            >
              {s === 'all' ? 'All' : config?.label}
            </button>
          );
        })}
      </div>

      {/* Dispute list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className={cn(ds.panel, 'flex items-center justify-center py-16')}>
            <Loader2 size={20} className="animate-spin text-gray-500" />
            <span className="ml-2 text-gray-500">Loading disputes...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={cn(ds.panel, 'flex flex-col items-center justify-center py-16')}>
            <Shield size={32} className="text-gray-600 mb-3" />
            <p className="text-gray-400">
              {statusFilter !== 'all'
                ? `No ${STATUS_CONFIG[statusFilter as DisputeStatus]?.label?.toLowerCase()} disputes`
                : activeTab === 'my'
                  ? 'No disputes found. If you have a problem with a purchase, click "Report Problem" above.'
                  : 'No disputes in the admin queue.'}
            </p>
          </div>
        ) : (
          filtered.map(dispute => (
            <DisputeCard
              key={dispute.id}
              dispute={dispute}
              expanded={expandedId === dispute.id}
              onToggle={() => setExpandedId(expandedId === dispute.id ? null : dispute.id)}
              onUpdate={invalidateAll}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>

      {/* Create dispute modal */}
      <AnimatePresence>
        {showCreateForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowCreateForm(false)}
            />
            <CreateDisputeForm
              onClose={() => setShowCreateForm(false)}
              onSuccess={() => {
                setShowCreateForm(false);
                invalidateAll();
              }}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
