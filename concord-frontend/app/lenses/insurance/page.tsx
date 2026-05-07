'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Shield,
  ShieldCheck,
  FileText,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  CheckCircle2,
  BarChart3,
  AlertTriangle,
  Users,
  DollarSign,
  AlertCircle,
  Car,
  Home,
  Heart,
  Building2,
  Umbrella,
  Activity,
  Calculator,
  Percent,
  ClipboardList,
  RefreshCw,
  Scale,
  Receipt,
  Wallet,
  GraduationCap,
  ChevronRight,
  Columns,
  FolderOpen,
  Layers,
  ChevronDown,
  ArrowRight,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Policies' | 'Claims' | 'Calculator' | 'Clients' | 'Commissions' | 'Compliance' | 'Compare' | 'Documents';
type ArtifactType = 'Policy' | 'Claim' | 'Quote' | 'InsuredClient' | 'Commission' | 'ComplianceItem' | 'Document';

type PolicyType = 'auto' | 'home' | 'life' | 'commercial' | 'health' | 'umbrella';
type ClaimStatus = 'reported' | 'investigating' | 'estimate' | 'approved' | 'paid' | 'closed' | 'denied';
type QuoteStatus = 'draft' | 'quoted' | 'accepted' | 'declined' | 'expired';

interface PolicyData {
  policyType: PolicyType;
  carrier: string;
  premium: number;
  effectiveDate: string;
  expiryDate: string;
  coverageLimit: number;
  deductible: number;
  namedInsureds: string[];
  renewalTracking: boolean;
  policyNumber: string;
  agent: string;
  paymentFrequency: string;
  endorsements: string[];
  underwriter: string;
}

interface ClaimData {
  policyRef: string;
  dateOfLoss: string;
  description: string;
  adjuster: string;
  status: ClaimStatus;
  reserveAmount: number;
  paidAmount: number;
  subrogation: boolean;
  claimNumber: string;
  claimant: string;
  causeOfLoss: string;
  dateReported: string;
  dateClosed: string;
  notes: string;
}

interface QuoteData {
  policyType: PolicyType;
  riskFactors: string[];
  coverageSelections: string[];
  deductibleOptions: string;
  multiPolicyDiscount: boolean;
  quotedPremium: number;
  carrier: string;
  effectiveDate: string;
  comparisonNotes: string;
  applicant: string;
  vehicleOrProperty: string;
}

interface InsuredClientData {
  policies: string[];
  claimsHistory: number;
  riskProfile: string;
  nextRenewal: string;
  coverageGaps: string[];
  phone: string;
  email: string;
  address: string;
  dateOfBirth: string;
  totalPremium: number;
  referralSource: string;
}

interface CommissionData {
  carrier: string;
  product: string;
  commissionRate: number;
  policyRef: string;
  commissionEarned: number;
  overrideAmount: number;
  paymentDate: string;
  agent: string;
  period: string;
  status: string;
  notes: string;
}

interface ComplianceItemData {
  type: string;
  dueDate: string;
  completedDate: string;
  status: string;
  details: string;
  state: string;
  creditsRequired: number;
  creditsCompleted: number;
  licenseNumber: string;
  renewalFee: number;
}

interface DocumentData {
  documentType: string;
  policyRef: string;
  fileName: string;
  fileSize: string;
  uploadDate: string;
  expiryDate: string;
  notes: string;
  category: string;
}

type ArtifactDataUnion = PolicyData | ClaimData | QuoteData | InsuredClientData | CommissionData | ComplianceItemData | DocumentData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof Shield; artifactType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Policies', icon: FileText, artifactType: 'Policy' },
  { id: 'Claims', icon: ClipboardList, artifactType: 'Claim' },
  { id: 'Calculator', icon: Calculator, artifactType: 'Quote' },
  { id: 'Compare', icon: Columns },
  { id: 'Clients', icon: Users, artifactType: 'InsuredClient' },
  { id: 'Commissions', icon: DollarSign, artifactType: 'Commission' },
  { id: 'Compliance', icon: GraduationCap, artifactType: 'ComplianceItem' },
  { id: 'Documents', icon: FolderOpen, artifactType: 'Document' },
];

const POLICY_TYPES: PolicyType[] = ['auto', 'home', 'life', 'commercial', 'health', 'umbrella'];
const CLAIM_STATUSES: ClaimStatus[] = ['reported', 'investigating', 'estimate', 'approved', 'paid', 'closed', 'denied'];
const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'quoted', 'accepted', 'declined', 'expired'];
const RISK_PROFILES = ['preferred', 'standard', 'substandard', 'declined'];
const PAYMENT_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual'];
const COMPLIANCE_TYPES = ['CE Credits', 'License Renewal', 'E&O Insurance', 'Carrier Appointment'];

const POLICY_ICONS: Record<string, typeof Car> = {
  auto: Car,
  home: Home,
  life: Heart,
  commercial: Building2,
  health: Activity,
  umbrella: Umbrella,
};

const STATUS_COLORS: Record<string, string> = {
  active: 'green-400',
  inactive: 'gray-400',
  cancelled: 'red-400',
  expired: 'orange-400',
  lapsed: 'red-400',
  reported: 'red-400',
  investigating: 'orange-400',
  estimate: 'yellow-400',
  approved: 'blue-400',
  paid: 'green-400',
  closed: 'gray-400',
  denied: 'red-500',
  draft: 'gray-400',
  quoted: 'blue-400',
  accepted: 'green-400',
  declined: 'red-400',
  pending: 'yellow-400',
  hold: 'orange-400',
  current: 'green-400',
  expiring_soon: 'yellow-400',
  preferred: 'green-400',
  standard: 'blue-400',
  substandard: 'orange-400',
  auto: 'blue-400',
  home: 'green-400',
  life: 'purple-400',
  commercial: 'orange-400',
  health: 'red-400',
  umbrella: 'neon-cyan',
};

function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'Policies': return ['active', 'inactive', 'cancelled', 'expired', 'lapsed'];
    case 'Claims': return CLAIM_STATUSES;
    case 'Calculator': return QUOTE_STATUSES;
    case 'Clients': return ['active', 'inactive'];
    case 'Commissions': return ['paid', 'pending', 'hold'];
    case 'Compliance': return ['current', 'expiring_soon', 'expired'];
    default: return ['active', 'inactive'];
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InsuranceLensPage() {
  useLensNav('insurance');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('insurance');

  const [mode, setMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('active');
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentType: ArtifactType = MODE_TABS.find(t => t.id === mode)?.artifactType || 'Policy';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactDataUnion>('insurance', currentType, {
    seed: [],
  });

  /* secondary data for dashboard */
  const { items: policies } = useLensData<PolicyData>('insurance', 'Policy', { seed: [] });
  const { items: claims } = useLensData<ClaimData>('insurance', 'Claim', { seed: [] });
  const { items: clients } = useLensData<InsuredClientData>('insurance', 'InsuredClient', { seed: [] });
  const { items: commissions } = useLensData<CommissionData>('insurance', 'Commission', { seed: [] });
  const { items: compliance } = useLensData<ComplianceItemData>('insurance', 'ComplianceItem', { seed: [] });

  const runAction = useRunArtifact('insurance');
  const editingItem = items.find(i => i.id === editingId) || null;

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  /* ---- editor helpers ---- */
  const openNew = () => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(getStatusesForTab(mode)[0] || 'active');
    setFormData({});
    setShowEditor(true);
  };

  const openEdit = (item: LensItem<ArtifactDataUnion>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus((item.meta.status as string) || 'active');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = { title: formTitle, data: formData, meta: { status: formStatus } };
    if (editingId) {
      await update(editingId, payload);
    } else {
      await create(payload);
    }
    setShowEditor(false);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingItem?.id || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as unknown as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  const renderStatusBadge = (status: string) => {
    const color = STATUS_COLORS[status] || 'gray-400';
    return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
  };

  /* ---- dashboard stats ---- */
  const dashboardStats = useMemo(() => {
    const policiesInForce = policies.filter(i => i.meta.status === 'active').length;

    const premiumsWritten = policies.reduce((sum, i) => {
      const d = i.data as unknown as PolicyData;
      return sum + (d.premium || 0);
    }, 0);

    const openClaims = claims.filter(i => i.meta.status !== 'closed' && i.meta.status !== 'denied').length;

    const upcomingRenewals = (() => {
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      const within30 = policies.filter(i => {
        const d = i.data as unknown as PolicyData;
        if (!d.expiryDate) return false;
        const exp = new Date(d.expiryDate);
        return exp >= now && exp <= in30;
      }).length;
      const within60 = policies.filter(i => {
        const d = i.data as unknown as PolicyData;
        if (!d.expiryDate) return false;
        const exp = new Date(d.expiryDate);
        return exp > in30 && exp <= in60;
      }).length;
      const within90 = policies.filter(i => {
        const d = i.data as unknown as PolicyData;
        if (!d.expiryDate) return false;
        const exp = new Date(d.expiryDate);
        return exp > in60 && exp <= in90;
      }).length;
      return { within30, within60, within90 };
    })();

    const lossRatio = (() => {
      if (premiumsWritten === 0) return 0;
      const totalPaid = claims.reduce((sum, i) => {
        const d = i.data as unknown as ClaimData;
        return sum + (d.paidAmount || 0);
      }, 0);
      return Math.round((totalPaid / premiumsWritten) * 100);
    })();

    const commissionEarned = commissions.reduce((sum, i) => {
      const d = i.data as unknown as CommissionData;
      return sum + (d.commissionEarned || 0);
    }, 0);

    const policyMix: Record<string, number> = {};
    POLICY_TYPES.forEach(t => { policyMix[t] = 0; });
    policies.filter(i => i.meta.status === 'active').forEach(i => {
      const d = i.data as unknown as PolicyData;
      if (d.policyType && policyMix[d.policyType] !== undefined) policyMix[d.policyType]++;
    });

    const expiringCompliance = compliance.filter(i => i.meta.status === 'expiring_soon' || i.meta.status === 'expired').length;

    const totalClients = clients.length;

    return { policiesInForce, premiumsWritten, openClaims, upcomingRenewals, lossRatio, commissionEarned, policyMix, expiringCompliance, totalClients };
  }, [policies, claims, commissions, compliance, clients]);

  /* ================================================================ */
  /*  Form fields                                                      */
  /* ================================================================ */

  const renderFormFields = () => {
    switch (currentType) {
      case 'Policy':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Policy Type</label>
                <select className={ds.select} value={(formData.policyType as string) || 'auto'} onChange={e => setFormData({ ...formData, policyType: e.target.value })}>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={ds.label}>Carrier</label><input className={ds.input} value={(formData.carrier as string) || ''} onChange={e => setFormData({ ...formData, carrier: e.target.value })} placeholder="State Farm, Progressive..." /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Policy Number</label><input className={ds.input} value={(formData.policyNumber as string) || ''} onChange={e => setFormData({ ...formData, policyNumber: e.target.value })} placeholder="POL-0001" /></div>
              <div><label className={ds.label}>Agent</label><input className={ds.input} value={(formData.agent as string) || ''} onChange={e => setFormData({ ...formData, agent: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Premium ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.premium as number) || ''} onChange={e => setFormData({ ...formData, premium: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Coverage Limit ($)</label><input type="number" className={ds.input} value={(formData.coverageLimit as number) || ''} onChange={e => setFormData({ ...formData, coverageLimit: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Deductible ($)</label><input type="number" className={ds.input} value={(formData.deductible as number) || ''} onChange={e => setFormData({ ...formData, deductible: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Effective Date</label><input type="date" className={ds.input} value={(formData.effectiveDate as string) || ''} onChange={e => setFormData({ ...formData, effectiveDate: e.target.value })} /></div>
              <div><label className={ds.label}>Expiry Date</label><input type="date" className={ds.input} value={(formData.expiryDate as string) || ''} onChange={e => setFormData({ ...formData, expiryDate: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Named Insureds (comma-separated)</label><input className={ds.input} value={((formData.namedInsureds as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, namedInsureds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Payment Frequency</label>
                <select className={ds.select} value={(formData.paymentFrequency as string) || 'monthly'} onChange={e => setFormData({ ...formData, paymentFrequency: e.target.value })}>
                  {PAYMENT_FREQUENCIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><label className={ds.label}>Underwriter</label><input className={ds.input} value={(formData.underwriter as string) || ''} onChange={e => setFormData({ ...formData, underwriter: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Endorsements (comma-separated)</label><input className={ds.input} value={((formData.endorsements as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, endorsements: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Roadside assistance, Replacement cost..." /></div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={(formData.renewalTracking as boolean) || false} onChange={e => setFormData({ ...formData, renewalTracking: e.target.checked })} />
              Enable Renewal Tracking
            </label>
          </>
        );
      case 'Claim':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Claim Number</label><input className={ds.input} value={(formData.claimNumber as string) || ''} onChange={e => setFormData({ ...formData, claimNumber: e.target.value })} placeholder="CLM-0001" /></div>
              <div><label className={ds.label}>Policy Reference</label><input className={ds.input} value={(formData.policyRef as string) || ''} onChange={e => setFormData({ ...formData, policyRef: e.target.value })} placeholder="POL-0001" /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date of Loss</label><input type="date" className={ds.input} value={(formData.dateOfLoss as string) || ''} onChange={e => setFormData({ ...formData, dateOfLoss: e.target.value })} /></div>
              <div><label className={ds.label}>Date Reported</label><input type="date" className={ds.input} value={(formData.dateReported as string) || ''} onChange={e => setFormData({ ...formData, dateReported: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={3} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Detailed claim description..." /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Claimant</label><input className={ds.input} value={(formData.claimant as string) || ''} onChange={e => setFormData({ ...formData, claimant: e.target.value })} /></div>
              <div><label className={ds.label}>Adjuster</label><input className={ds.input} value={(formData.adjuster as string) || ''} onChange={e => setFormData({ ...formData, adjuster: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Cause of Loss</label><input className={ds.input} value={(formData.causeOfLoss as string) || ''} onChange={e => setFormData({ ...formData, causeOfLoss: e.target.value })} placeholder="Collision, fire, theft, weather..." /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Reserve Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.reserveAmount as number) || ''} onChange={e => setFormData({ ...formData, reserveAmount: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Paid Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.paidAmount as number) || ''} onChange={e => setFormData({ ...formData, paidAmount: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date Closed</label><input type="date" className={ds.input} value={(formData.dateClosed as string) || ''} onChange={e => setFormData({ ...formData, dateClosed: e.target.value })} /></div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={(formData.subrogation as boolean) || false} onChange={e => setFormData({ ...formData, subrogation: e.target.checked })} />
                  Subrogation Applicable
                </label>
              </div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Quote':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Policy Type</label>
                <select className={ds.select} value={(formData.policyType as string) || 'auto'} onChange={e => setFormData({ ...formData, policyType: e.target.value })}>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={ds.label}>Carrier</label><input className={ds.input} value={(formData.carrier as string) || ''} onChange={e => setFormData({ ...formData, carrier: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Applicant</label><input className={ds.input} value={(formData.applicant as string) || ''} onChange={e => setFormData({ ...formData, applicant: e.target.value })} /></div>
              <div><label className={ds.label}>Quoted Premium ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.quotedPremium as number) || ''} onChange={e => setFormData({ ...formData, quotedPremium: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Risk Factors (comma-separated)</label><input className={ds.input} value={((formData.riskFactors as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, riskFactors: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Young driver, High value property..." /></div>
            <div><label className={ds.label}>Coverage Selections (comma-separated)</label><input className={ds.input} value={((formData.coverageSelections as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, coverageSelections: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Liability, Collision, Comprehensive..." /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Deductible Options</label><input className={ds.input} value={(formData.deductibleOptions as string) || ''} onChange={e => setFormData({ ...formData, deductibleOptions: e.target.value })} placeholder="$500 / $1000 / $2500" /></div>
              <div><label className={ds.label}>Effective Date</label><input type="date" className={ds.input} value={(formData.effectiveDate as string) || ''} onChange={e => setFormData({ ...formData, effectiveDate: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Vehicle / Property Description</label><input className={ds.input} value={(formData.vehicleOrProperty as string) || ''} onChange={e => setFormData({ ...formData, vehicleOrProperty: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={(formData.multiPolicyDiscount as boolean) || false} onChange={e => setFormData({ ...formData, multiPolicyDiscount: e.target.checked })} />
              Multi-Policy Discount Applied
            </label>
            <div><label className={ds.label}>Comparison Notes</label><textarea className={ds.textarea} rows={2} value={(formData.comparisonNotes as string) || ''} onChange={e => setFormData({ ...formData, comparisonNotes: e.target.value })} /></div>
          </>
        );
      case 'InsuredClient':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Phone</label><input className={ds.input} value={(formData.phone as string) || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
              <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Address</label><input className={ds.input} value={(formData.address as string) || ''} onChange={e => setFormData({ ...formData, address: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date of Birth</label><input type="date" className={ds.input} value={(formData.dateOfBirth as string) || ''} onChange={e => setFormData({ ...formData, dateOfBirth: e.target.value })} /></div>
              <div>
                <label className={ds.label}>Risk Profile</label>
                <select className={ds.select} value={(formData.riskProfile as string) || 'standard'} onChange={e => setFormData({ ...formData, riskProfile: e.target.value })}>
                  {RISK_PROFILES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div><label className={ds.label}>Policies (comma-separated)</label><input className={ds.input} value={((formData.policies as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, policies: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="POL-001, POL-002..." /></div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Claims History</label><input type="number" className={ds.input} value={(formData.claimsHistory as number) || ''} onChange={e => setFormData({ ...formData, claimsHistory: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Total Premium ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.totalPremium as number) || ''} onChange={e => setFormData({ ...formData, totalPremium: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Next Renewal</label><input type="date" className={ds.input} value={(formData.nextRenewal as string) || ''} onChange={e => setFormData({ ...formData, nextRenewal: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Coverage Gaps (comma-separated)</label><input className={ds.input} value={((formData.coverageGaps as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, coverageGaps: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Flood, Earthquake, Umbrella..." /></div>
            <div><label className={ds.label}>Referral Source</label><input className={ds.input} value={(formData.referralSource as string) || ''} onChange={e => setFormData({ ...formData, referralSource: e.target.value })} /></div>
          </>
        );
      case 'Commission':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Carrier</label><input className={ds.input} value={(formData.carrier as string) || ''} onChange={e => setFormData({ ...formData, carrier: e.target.value })} /></div>
              <div><label className={ds.label}>Product</label><input className={ds.input} value={(formData.product as string) || ''} onChange={e => setFormData({ ...formData, product: e.target.value })} placeholder="Auto, Home, etc." /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Commission Rate (%)</label><input type="number" step="0.1" className={ds.input} value={(formData.commissionRate as number) || ''} onChange={e => setFormData({ ...formData, commissionRate: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Commission Earned ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.commissionEarned as number) || ''} onChange={e => setFormData({ ...formData, commissionEarned: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Override ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.overrideAmount as number) || ''} onChange={e => setFormData({ ...formData, overrideAmount: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Policy Reference</label><input className={ds.input} value={(formData.policyRef as string) || ''} onChange={e => setFormData({ ...formData, policyRef: e.target.value })} /></div>
              <div><label className={ds.label}>Agent</label><input className={ds.input} value={(formData.agent as string) || ''} onChange={e => setFormData({ ...formData, agent: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Payment Date</label><input type="date" className={ds.input} value={(formData.paymentDate as string) || ''} onChange={e => setFormData({ ...formData, paymentDate: e.target.value })} /></div>
              <div><label className={ds.label}>Period</label><input className={ds.input} value={(formData.period as string) || ''} onChange={e => setFormData({ ...formData, period: e.target.value })} placeholder="January 2026" /></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'ComplianceItem':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Type</label>
                <select className={ds.select} value={(formData.type as string) || 'CE Credits'} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                  {COMPLIANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={ds.label}>State</label><input className={ds.input} value={(formData.state as string) || ''} onChange={e => setFormData({ ...formData, state: e.target.value })} placeholder="CA, NY, TX..." /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Due Date</label><input type="date" className={ds.input} value={(formData.dueDate as string) || ''} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} /></div>
              <div><label className={ds.label}>Completed Date</label><input type="date" className={ds.input} value={(formData.completedDate as string) || ''} onChange={e => setFormData({ ...formData, completedDate: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Credits Required</label><input type="number" className={ds.input} value={(formData.creditsRequired as number) || ''} onChange={e => setFormData({ ...formData, creditsRequired: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Credits Completed</label><input type="number" className={ds.input} value={(formData.creditsCompleted as number) || ''} onChange={e => setFormData({ ...formData, creditsCompleted: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Renewal Fee ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.renewalFee as number) || ''} onChange={e => setFormData({ ...formData, renewalFee: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>License Number</label><input className={ds.input} value={(formData.licenseNumber as string) || ''} onChange={e => setFormData({ ...formData, licenseNumber: e.target.value })} /></div>
            <div><label className={ds.label}>Details</label><textarea className={ds.textarea} rows={2} value={(formData.details as string) || ''} onChange={e => setFormData({ ...formData, details: e.target.value })} /></div>
          </>
        );
      case 'Document':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Document Type</label>
                <select className={ds.select} value={(formData.documentType as string) || 'policy_doc'} onChange={e => setFormData({ ...formData, documentType: e.target.value })}>
                  <option value="policy_doc">Policy Document</option>
                  <option value="endorsement">Endorsement</option>
                  <option value="declaration">Declaration Page</option>
                  <option value="certificate">Certificate of Insurance</option>
                  <option value="claim_form">Claim Form</option>
                  <option value="proof_of_loss">Proof of Loss</option>
                  <option value="correspondence">Correspondence</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div><label className={ds.label}>Policy Reference</label><input className={ds.input} value={(formData.policyRef as string) || ''} onChange={e => setFormData({ ...formData, policyRef: e.target.value })} placeholder="POL-0001" /></div>
            </div>
            <div>
              <label className={ds.label}>Category</label>
              <select className={ds.select} value={(formData.category as string) || 'general'} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                <option value="general">General</option>
                <option value="underwriting">Underwriting</option>
                <option value="claims">Claims</option>
                <option value="compliance">Compliance</option>
                <option value="billing">Billing</option>
              </select>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Upload Date</label><input type="date" className={ds.input} value={(formData.uploadDate as string) || new Date().toISOString().split('T')[0]} onChange={e => setFormData({ ...formData, uploadDate: e.target.value })} /></div>
              <div><label className={ds.label}>Expiry Date</label><input type="date" className={ds.input} value={(formData.expiryDate as string) || ''} onChange={e => setFormData({ ...formData, expiryDate: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>File Name</label><input className={ds.input} value={(formData.fileName as string) || ''} onChange={e => setFormData({ ...formData, fileName: e.target.value })} placeholder="document.pdf" /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={3} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes about this document..." /></div>
          </>
        );
      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Card renderer                                                    */
  /* ================================================================ */

  const renderCard = (item: LensItem<ArtifactDataUnion>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'line-clamp-1')}>{item.title}</h3>
          {renderStatusBadge(item.meta.status)}
        </div>

        <div className="mt-2 space-y-1">
          {currentType === 'Policy' && (() => {
            const PolicyIcon = POLICY_ICONS[(d.policyType as string)] || Shield;
            return (
              <>
                <div className="flex items-center gap-2">
                  <PolicyIcon className="w-4 h-4 text-blue-400" />
                  {Boolean(d.policyType) && renderStatusBadge(d.policyType as string)}
                  {Boolean(d.carrier) && <span className={ds.badge('gray-400')}>{d.carrier as string}</span>}
                </div>
                {Boolean(d.policyNumber) && <p className={cn(ds.textMono, 'text-xs text-gray-400')}>{d.policyNumber as string}</p>}
                <div className="flex items-center gap-3 text-xs mt-1">
                  <span className="text-green-400 font-bold">${(d.premium as number)?.toLocaleString()}</span>
                  {(d.coverageLimit as number) > 0 && <span className={ds.textMuted}>Limit: ${(d.coverageLimit as number)?.toLocaleString()}</span>}
                  {(d.deductible as number) > 0 && <span className={ds.textMuted}>Ded: ${d.deductible as number}</span>}
                </div>
                <p className={cn(ds.textMono, 'text-xs text-gray-500')}>{d.effectiveDate as string} to {d.expiryDate as string}</p>
                {(d.namedInsureds as string[])?.length > 0 && (
                  <p className={cn(ds.textMuted, 'text-xs')}><Users className="w-3 h-3 inline mr-1" />{(d.namedInsureds as string[]).join(', ')}</p>
                )}
                {(d.endorsements as string[])?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">{(d.endorsements as string[]).map(e => <span key={e} className={ds.badge('neon-cyan')}>{e}</span>)}</div>
                )}
              </>
            );
          })()}

          {currentType === 'Claim' && (
            <>
              <div className="flex items-center gap-2">
                {Boolean(d.status) && renderStatusBadge(d.status as string)}
                {Boolean(d.claimNumber) && <span className={cn(ds.textMono, 'text-xs text-gray-400')}>{d.claimNumber as string}</span>}
              </div>
              {Boolean(d.policyRef) && <p className={cn(ds.textMuted, 'text-xs')}>Policy: {d.policyRef as string}</p>}
              {Boolean(d.description) && <p className={cn(ds.textMuted, 'line-clamp-2')}>{d.description as string}</p>}
              <div className="flex items-center gap-3 text-xs mt-1">
                {Boolean(d.adjuster) && <span className={ds.textMuted}>Adjuster: {d.adjuster as string}</span>}
                {Boolean(d.causeOfLoss) && <span className={ds.badge('orange-400')}>{d.causeOfLoss as string}</span>}
              </div>
              <div className="flex items-center gap-3 text-xs">
                {(d.reserveAmount as number) > 0 && <span className={cn(ds.textMono, 'text-yellow-400')}>Reserve: ${(d.reserveAmount as number)?.toLocaleString()}</span>}
                {(d.paidAmount as number) > 0 && <span className={cn(ds.textMono, 'text-green-400')}>Paid: ${(d.paidAmount as number)?.toLocaleString()}</span>}
              </div>
              {Boolean(d.subrogation) && <span className={ds.badge('blue-400')}>Subrogation</span>}
              {Boolean(d.dateOfLoss) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>Loss: {d.dateOfLoss as string}</p>}
            </>
          )}

          {currentType === 'Quote' && (
            <>
              <div className="flex items-center gap-2">
                {Boolean(d.policyType) && renderStatusBadge(d.policyType as string)}
                {Boolean(d.carrier) && <span className={ds.badge('gray-400')}>{d.carrier as string}</span>}
              </div>
              {Boolean(d.applicant) && <p className={ds.textMuted}>{d.applicant as string}</p>}
              {(d.quotedPremium as number) > 0 && <p className="text-green-400 font-bold">${(d.quotedPremium as number)?.toLocaleString()}</p>}
              {(d.riskFactors as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.riskFactors as string[]).map(r => <span key={r} className={ds.badge('orange-400')}>{r}</span>)}</div>
              )}
              {(d.coverageSelections as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.coverageSelections as string[]).map(c => <span key={c} className={ds.badge('blue-400')}>{c}</span>)}</div>
              )}
              {Boolean(d.multiPolicyDiscount) && <span className={ds.badge('green-400')}><Percent className="w-3 h-3" /> Multi-Policy Discount</span>}
            </>
          )}

          {currentType === 'InsuredClient' && (
            <>
              {Boolean(d.riskProfile) && renderStatusBadge(d.riskProfile as string)}
              {Boolean(d.email) && <p className={cn(ds.textMuted, 'text-xs')}>{d.email as string}</p>}
              <div className="flex items-center gap-3 text-xs">
                <span className={ds.textMuted}>Claims: {d.claimsHistory as number}</span>
                {(d.totalPremium as number) > 0 && <span className="text-green-400 font-bold">${(d.totalPremium as number)?.toLocaleString()}</span>}
              </div>
              {(d.policies as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.policies as string[]).map(p => <span key={p} className={ds.badge('blue-400')}>{p}</span>)}</div>
              )}
              {(d.coverageGaps as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.coverageGaps as string[]).map(g => <span key={g} className={ds.badge('red-400')}><AlertTriangle className="w-2.5 h-2.5" />{g}</span>)}</div>
              )}
              {Boolean(d.nextRenewal) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>Next renewal: {d.nextRenewal as string}</p>}
            </>
          )}

          {currentType === 'Commission' && (
            <>
              <p className={ds.textMuted}>{d.carrier as string} | {d.product as string}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-green-400 font-bold">${(d.commissionEarned as number)?.toLocaleString()}</span>
                <span className={cn(ds.textMono, 'text-xs')}>{d.commissionRate as number}%</span>
                {(d.overrideAmount as number) > 0 && <span className={cn(ds.textMono, 'text-blue-400')}>Override: ${d.overrideAmount as number}</span>}
              </div>
              {Boolean(d.policyRef) && <p className={cn(ds.textMuted, 'text-xs')}>Policy: {d.policyRef as string}</p>}
              {Boolean(d.agent) && <p className={cn(ds.textMuted, 'text-xs')}>Agent: {d.agent as string}</p>}
              {Boolean(d.period) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>{d.period as string}</p>}
            </>
          )}

          {currentType === 'ComplianceItem' && (
            <>
              <span className={ds.badge('blue-400')}>{d.type as string}</span>
              {Boolean(d.state) && <span className={ds.badge('gray-400')}>{d.state as string}</span>}
              {Boolean(d.dueDate) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>Due: {d.dueDate as string}</p>}
              {(d.creditsRequired as number) > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-400 rounded-full"
                      style={{ width: `${(d.creditsRequired as number) > 0 ? ((d.creditsCompleted as number) / (d.creditsRequired as number)) * 100 : 0}%` }}
                    />
                  </div>
                  <span className={cn(ds.textMono, 'text-xs')}>{d.creditsCompleted as number}/{d.creditsRequired as number}</span>
                </div>
              )}
              {Boolean(d.licenseNumber) && <p className={cn(ds.textMono, 'text-xs text-gray-400')}>{d.licenseNumber as string}</p>}
              {(d.renewalFee as number) > 0 && <p className={cn(ds.textMuted, 'text-xs')}>Fee: ${d.renewalFee as number}</p>}
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-lattice-border">
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={e => { e.stopPropagation(); openEdit(item); }}><Edit3 className="w-3.5 h-3.5" /> Edit</button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={e => { e.stopPropagation(); handleDelete(item.id); }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  Dashboard                                                        */
  /* ================================================================ */

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><FileText className="w-5 h-5 text-blue-400" /><span className={ds.textMuted}>Policies In Force</span></div>
          <p className="text-3xl font-bold text-white">{dashboardStats.policiesInForce}</p>
          <p className={ds.textMuted}>Active policies</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-5 h-5 text-green-400" /><span className={ds.textMuted}>Premiums Written</span></div>
          <p className="text-3xl font-bold text-green-400">${dashboardStats.premiumsWritten.toLocaleString()}</p>
          <p className={ds.textMuted}>Total premium volume</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><ClipboardList className="w-5 h-5 text-orange-400" /><span className={ds.textMuted}>Open Claims</span></div>
          <p className={cn('text-3xl font-bold', dashboardStats.openClaims > 0 ? 'text-orange-400' : 'text-white')}>{dashboardStats.openClaims}</p>
          <p className={ds.textMuted}>Pending resolution</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Wallet className="w-5 h-5 text-neon-cyan" /><span className={ds.textMuted}>Commission Earned</span></div>
          <p className="text-3xl font-bold text-neon-cyan">${dashboardStats.commissionEarned.toLocaleString()}</p>
          <p className={ds.textMuted}>Total commission</p>
        </div>
      </div>

      {/* Client Count */}
      <div className={ds.panel}>
        <div className="flex items-center gap-2 mb-2"><Users className="w-5 h-5 text-purple-400" /><span className={ds.textMuted}>Total Clients</span></div>
        <p className="text-3xl font-bold text-purple-400">{dashboardStats.totalClients}</p>
        <p className={ds.textMuted}>Insured clients on file</p>
      </div>

      {/* Renewals and Loss Ratio */}
      <div className={ds.grid3}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Upcoming Renewals</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded bg-lattice-elevated/30">
              <span className={ds.textMuted}>30 Days</span>
              <span className={cn('font-bold', dashboardStats.upcomingRenewals.within30 > 0 ? 'text-red-400' : 'text-white')}>
                {dashboardStats.upcomingRenewals.within30}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-lattice-elevated/30">
              <span className={ds.textMuted}>60 Days</span>
              <span className={cn('font-bold', dashboardStats.upcomingRenewals.within60 > 0 ? 'text-yellow-400' : 'text-white')}>
                {dashboardStats.upcomingRenewals.within60}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-lattice-elevated/30">
              <span className={ds.textMuted}>90 Days</span>
              <span className="font-bold text-white">{dashboardStats.upcomingRenewals.within90}</span>
            </div>
          </div>
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Loss Ratio</h3>
          <p className={cn('text-4xl font-bold', dashboardStats.lossRatio > 80 ? 'text-red-400' : dashboardStats.lossRatio > 60 ? 'text-yellow-400' : 'text-green-400')}>
            {dashboardStats.lossRatio}%
          </p>
          <p className={cn(ds.textMuted, 'mt-2')}>Claims paid vs premiums written</p>
          <div className="mt-3 h-2 bg-lattice-elevated rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', dashboardStats.lossRatio > 80 ? 'bg-red-400' : dashboardStats.lossRatio > 60 ? 'bg-yellow-400' : 'bg-green-400')}
              style={{ width: `${Math.min(dashboardStats.lossRatio, 100)}%` }}
            />
          </div>
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Compliance Status</h3>
          <p className={cn('text-4xl font-bold', dashboardStats.expiringCompliance > 0 ? 'text-yellow-400' : 'text-green-400')}>
            {dashboardStats.expiringCompliance}
          </p>
          <p className={cn(ds.textMuted, 'mt-2')}>Items expiring or expired</p>
          {dashboardStats.expiringCompliance > 0 && (
            <p className="text-xs text-yellow-400 mt-1"><AlertTriangle className="w-3 h-3 inline mr-1" />Attention needed</p>
          )}
        </div>
      </div>

      {/* Policy Mix */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Policy Mix</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {POLICY_TYPES.map(t => {
            const Icon = POLICY_ICONS[t] || Shield;
            return (
              <div key={t} className="text-center p-3 rounded-lg bg-lattice-elevated/30">
                <Icon className={cn('w-6 h-6 mx-auto mb-2', `text-${STATUS_COLORS[t] || 'gray-400'}`)} />
                <p className="text-lg font-bold text-white">{dashboardStats.policyMix[t]}</p>
                <p className={cn(ds.textMuted, 'text-xs capitalize')}>{t}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Claim status pipeline */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Claims Pipeline</h3>
        <div className="flex items-center gap-2 flex-wrap pb-2">
          {CLAIM_STATUSES.map((s, idx) => {
            const count = claims.filter(i => i.meta.status === s || (i.data as unknown as ClaimData).status === s).length;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className="text-center p-3 rounded-lg bg-lattice-elevated/30 min-w-[90px]">
                  <p className="text-lg font-bold text-white">{count}</p>
                  <p className={cn(ds.textMuted, 'text-xs capitalize')}>{s}</p>
                </div>
                {idx < CLAIM_STATUSES.length - 1 && <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent policies */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Recent Policies</h3>
        <div className="space-y-2">
          {policies.slice(0, 5).map(item => {
            const d = item.data as unknown as PolicyData;
            const Icon = POLICY_ICONS[d.policyType] || Shield;
            return (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 transition-colors">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Icon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.title}</p>
                    <p className={cn(ds.textMuted, 'text-xs')}>{d.carrier} | ${d.premium?.toLocaleString()}</p>
                  </div>
                </div>
                {renderStatusBadge(item.meta.status)}
              </div>
            );
          })}
          {policies.length === 0 && <p className={ds.textMuted}>No policies yet.</p>}
        </div>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  Main render                                                      */
  /* ================================================================ */

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

  return (
    <div data-lens-theme="insurance" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-blue-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Insurance Agency</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Policies, claims, premium calculator, clients, commissions &amp; compliance</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mode !== 'Dashboard' && (
            <button onClick={openNew} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
          )}
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="insurance" artifactId={policies[0]?.id} compact />
      <RealtimeDataPanel domain="insurance" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="insurance" data={{}} compact />
      <VisionAnalyzeButton
        domain="insurance"
        prompt="Analyze this insurance-related image (damage photo, document, property, vehicle, etc.). Describe visible damage or details, estimate severity, and suggest claim description text and relevant tags."
        onResult={(res) => {
          setFormData(prev => ({ ...prev, description: res.analysis }));
          if (res.suggestedTags?.length) setFormData(prev => ({ ...prev, notes: `Vision tags: ${res.suggestedTags!.join(', ')}` }));
        }}
        className="inline-flex"
      />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Shield, label: 'Policies In-Force', value: dashboardStats.policiesInForce, color: 'text-blue-400' },
          { icon: DollarSign, label: 'Premiums Written', value: `$${dashboardStats.premiumsWritten.toLocaleString()}`, color: 'text-green-400' },
          { icon: FileText, label: 'Open Claims', value: dashboardStats.openClaims, color: 'text-amber-400' },
          { icon: CheckCircle2, label: 'Loss Ratio', value: `${dashboardStats.lossRatio}%`, color: dashboardStats.lossRatio > 70 ? 'text-red-400' : 'text-green-400' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={ds.panel}>
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className={ds.textMuted}>{stat.label}</p>
            <p className="text-xl font-bold text-white">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Policy Status Cards */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className={ds.panel}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" /> Policy Status Overview</h3>
        <div className="flex flex-wrap gap-3">
          {(() => {
            const active = policies.filter(p => p.meta.status === 'active').length;
            const expired = policies.filter(p => p.meta.status === 'expired' || p.meta.status === 'cancelled').length;
            const pending = policies.filter(p => p.meta.status === 'pending' || p.meta.status === 'draft').length;
            return (
              <>
                <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-500/20 text-green-400">Active: {active}</span>
                <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400">Expired: {expired}</span>
                <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400">Pending: {pending}</span>
              </>
            );
          })()}
        </div>
        {/* Coverage Amount Display */}
        {(() => {
          const totalCoverage = policies.reduce((s, p) => s + ((p.data as unknown as PolicyData).coverageLimit || 0), 0);
          return totalCoverage > 0 ? (
            <div className="mt-3 text-xs text-gray-400">
              Total Coverage: <span className="text-white font-bold text-sm">${totalCoverage.toLocaleString()}</span>
            </div>
          ) : null;
        })()}
      </motion.div>

      {/* Claim Status Pipeline */}
      {claims.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className={ds.panel}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-amber-400" /> Claim Pipeline</h3>
          <div className="flex items-center gap-2">
            {[
              { stage: 'Filed', statuses: ['reported'], color: 'bg-blue-500' },
              { stage: 'Reviewing', statuses: ['investigating', 'estimate'], color: 'bg-amber-500' },
              { stage: 'Approved', statuses: ['approved', 'paid'], color: 'bg-green-500' },
              { stage: 'Denied', statuses: ['denied', 'closed'], color: 'bg-red-500' },
            ].map((step, i, arr) => {
              const count = claims.filter(c => step.statuses.includes((c.data as unknown as ClaimData).status)).length;
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
      )}

      {/* Tabs */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setStatusFilter('all'); setSearchQuery(''); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-blue-400/20 text-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.id}
            </button>
          );
        })}
      </nav>

      {/* Search / Filter */}
      {mode !== 'Dashboard' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className={cn(ds.input, 'pl-10')} placeholder={`Search ${mode.toLowerCase()}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-gray-400" />
            <select className={cn(ds.select, 'w-auto')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {getStatusesForTab(mode).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Domain Actions */}
      {mode !== 'Dashboard' && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => handleAction('renewalAlert')} className={ds.btnSecondary}>
            <RefreshCw className="w-4 h-4" /> Renewal Alert
          </button>
          <button onClick={() => handleAction('coverageGapCheck')} className={ds.btnSecondary}>
            <AlertCircle className="w-4 h-4" /> Coverage Gap Check
          </button>
          <button onClick={() => handleAction('lossRatioReport')} className={ds.btnSecondary}>
            <Scale className="w-4 h-4" /> Loss Ratio Report
          </button>
          <button onClick={() => handleAction('commissionSummary')} className={ds.btnSecondary}>
            <Receipt className="w-4 h-4" /> Commission Summary
          </button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
        </div>
      )}

      {/* Content */}
      {mode === 'Dashboard' ? renderDashboard() : (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <ShieldCheck className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className={ds.heading3}>No {currentType}s found</p>
              <p className={ds.textMuted}>Create one to get started.</p>
              <button className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
                <Plus className="w-4 h-4" /> Add {currentType}
              </button>
            </div>
          ) : (
            <div className={ds.grid3}>{filtered.map(renderCard)}</div>
          )}
        </>
      )}

      {/* Action result */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            {/* coverageGap */}
            {actionResult.gapCount !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalPolicies)}</p>
                    <p className="text-[10px] text-gray-500">Policies</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.gapCount) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.gapCount)}</p>
                    <p className="text-[10px] text-gray-500">Gaps</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Array.isArray(actionResult.expiringSoon) && (actionResult.expiringSoon as unknown[]).length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{Array.isArray(actionResult.expiringSoon) ? (actionResult.expiringSoon as unknown[]).length : 0}</p>
                    <p className="text-[10px] text-gray-500">Expiring Soon</p>
                  </div>
                </div>
                {Array.isArray(actionResult.gaps) && (actionResult.gaps as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(actionResult.gaps as string[]).map((g, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded capitalize">{g}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* premiumHistory */}
            {actionResult.averageChangePercent !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.averageChangePercent) > 2 ? 'text-red-400' : Number(actionResult.averageChangePercent) < -2 ? 'text-green-400' : 'text-neon-cyan'}`}>{String(actionResult.averageChangePercent)}%</p>
                    <p className="text-[10px] text-gray-500">Avg Change</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan capitalize">{String(actionResult.trend)}</p>
                    <p className="text-[10px] text-gray-500">Trend</p>
                  </div>
                </div>
              </div>
            )}
            {/* claimStatus */}
            {actionResult.totalClaims !== undefined && actionResult.byStatus !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalClaims)}</p>
                    <p className="text-[10px] text-gray-500">Total Claims</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-amber-400">{String(actionResult.openClaims)}</p>
                    <p className="text-[10px] text-gray-500">Open</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.totalAmount).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Total Amount</p>
                  </div>
                </div>
              </div>
            )}
            {/* riskScore */}
            {actionResult.rawScore !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${actionResult.level === 'critical' ? 'text-red-400' : actionResult.level === 'high' ? 'text-orange-400' : actionResult.level === 'medium' ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.normalizedScore)}/100</p>
                    <p className="text-[10px] text-gray-500">Risk Score</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold capitalize ${actionResult.level === 'critical' ? 'text-red-400' : actionResult.level === 'high' ? 'text-orange-400' : actionResult.level === 'medium' ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.level)}</p>
                    <p className="text-[10px] text-gray-500">Level</p>
                  </div>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${actionResult.level === 'critical' ? 'bg-red-400' : actionResult.level === 'high' ? 'bg-orange-400' : actionResult.level === 'medium' ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${Math.min(100, Number(actionResult.normalizedScore))}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-hidden flex flex-col')} onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>{editingId ? 'Edit' : 'New'} {currentType}</h2>
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)}><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className={ds.label}>Title / Name</label>
                  <input className={ds.input} value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Name..." />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value)}>
                    {getStatusesForTab(mode).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-between">
                {editingId && (
                  <button className={ds.btnDanger} onClick={() => { handleDelete(editingId); setShowEditor(false); }}>
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
                <div className="flex items-center gap-3 ml-auto">
                  <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>Cancel</button>
                  <button className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                    <CheckCircle2 className="w-4 h-4" /> {editingId ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
            <LensFeaturePanel lensId="insurance" />
          </div>
        )}
      </div>
    </div>
  );
}
