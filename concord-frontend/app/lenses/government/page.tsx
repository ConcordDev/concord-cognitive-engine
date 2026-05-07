'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Landmark,
  FileCheck,
  HardHat,
  ShieldAlert,
  Siren,
  Archive,
  Gavel,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  Download,
  TrendingUp,
  BarChart3,
  ListChecks,
  Clock,
  AlertTriangle,
  ChevronDown,
  MapPin,
  FileText,
  DollarSign,
  Users,
  Calendar,
  CheckCircle2,
  Timer,
  Gauge,
  Play,
  Eye,
  Shield,
  Truck,
  Zap,
  Activity,
  ClipboardList,
  ArrowRight,
  ChevronRight,
  Percent,
  Lock,
  Unlock,
  RotateCcw,
  CalendarClock,
  CircleDot,
  Target,
  Layers,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Permits' | 'Public Works' | 'Code Enforcement' | 'Emergency' | 'Records' | 'Court';
type ViewMode = 'library' | 'dashboard' | 'detail';
type ArtifactType = 'Permit' | 'Project' | 'Violation' | 'EmergencyPlan' | 'Record' | 'CourtCase';

interface Permit {
  applicant: string;
  type: string;
  address: string;
  description: string;
  fee: number;
  submittedDate: string;
  inspector: string;
  propertyOwner: string;
  parcelNumber: string;
  estimatedDays: number;
  reviewNotes: string;
}
interface Project {
  name: string;
  department: string;
  budget: number;
  spent: number;
  startDate: string;
  endDate: string;
  contractor: string;
  location: string;
  progress: number;
  milestones: string[];
  citizenImpact: string;
  roadClosures: string;
  contactPhone: string;
}
interface Violation {
  address: string;
  code: string;
  description: string;
  inspector: string;
  observedDate: string;
  severity: string;
  violationType: string;
  fineAmount: number;
  complianceDeadline: string;
  ownerName: string;
  ownerContact: string;
  photos: number;
  hearingDate: string;
  escalationHistory: string;
}
interface EmergencyPlan {
  name: string;
  type: string;
  zone: string;
  coordinator: string;
  activationLevel: string;
  resources: string[];
  personnelCount: number;
  equipmentList: string;
  suppliesInventory: string;
  mutualAidPartners: string;
  exerciseDate: string;
  lastReviewDate: string;
  evacuationRoutes: string;
  shelterLocations: string;
}
interface RecordEntry {
  type: string;
  department: string;
  filedDate: string;
  retentionYears: number;
  description: string;
  classification: string;
  requestType: string;
  requestor: string;
  requestDate: string;
  responseDeadline: string;
  redactionRequired: boolean;
  redactionNotes: string;
  pageCount: number;
  dispositionDate: string;
}
interface CourtCase {
  caseNumber: string;
  plaintiff: string;
  defendant: string;
  judge: string;
  courtDate: string;
  type: string;
  disposition: string;
  fineAmount: number;
  feesCollected: number;
  feesOwed: number;
  attorney: string;
  nextHearingDate: string;
  filingDate: string;
  courtroom: string;
  continuanceCount: number;
}

type ArtifactData = Permit | Project | Violation | EmergencyPlan | RecordEntry | CourtCase;

const MODE_TABS: {
  id: ModeTab;
  icon: typeof Landmark;
  artifactType: ArtifactType;
  label: string;
}[] = [
  { id: 'Permits', icon: FileCheck, artifactType: 'Permit', label: 'Permits' },
  { id: 'Public Works', icon: HardHat, artifactType: 'Project', label: 'Public Works' },
  {
    id: 'Code Enforcement',
    icon: ShieldAlert,
    artifactType: 'Violation',
    label: 'Code Enforcement',
  },
  { id: 'Emergency', icon: Siren, artifactType: 'EmergencyPlan', label: 'Emergency Mgmt' },
  { id: 'Records', icon: Archive, artifactType: 'Record', label: 'Public Records' },
  { id: 'Court', icon: Gavel, artifactType: 'CourtCase', label: 'Court Admin' },
];

const STATUS_COLORS: Record<string, string> = {
  submitted: 'neon-blue',
  under_review: 'yellow-400',
  inspection: 'neon-purple',
  approved: 'green-400',
  denied: 'red-400',
  expired: 'gray-400',
  revoked: 'red-500',
  cited: 'yellow-400',
  notice_sent: 'orange-400',
  compliance_period: 'neon-cyan',
  resolved: 'green-400',
  escalated: 'red-400',
  hearing: 'neon-purple',
  fined: 'red-500',
  standby: 'gray-400',
  watch: 'yellow-400',
  warning: 'orange-400',
  activated: 'red-400',
  recovery: 'neon-cyan',
  deactivated: 'green-400',
  active: 'green-400',
  pending: 'yellow-400',
  fulfilled: 'green-400',
  overdue: 'red-400',
  closed: 'gray-400',
  archived: 'gray-500',
  scheduled: 'neon-blue',
  in_progress: 'neon-cyan',
  completed: 'green-400',
  on_hold: 'orange-400',
  cancelled: 'red-400',
  open: 'neon-blue',
  continued: 'yellow-400',
  disposed: 'green-400',
  appealed: 'orange-400',
  public: 'green-400',
  confidential: 'red-400',
  exempt: 'orange-400',
};

const STATUSES_BY_TYPE: Record<ArtifactType, string[]> = {
  Permit: ['submitted', 'under_review', 'inspection', 'approved', 'denied', 'expired', 'revoked'],
  Project: ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'],
  Violation: [
    'cited',
    'notice_sent',
    'compliance_period',
    'hearing',
    'resolved',
    'fined',
    'escalated',
  ],
  EmergencyPlan: ['standby', 'watch', 'warning', 'activated', 'recovery', 'deactivated'],
  Record: ['active', 'pending', 'fulfilled', 'overdue', 'closed', 'archived'],
  CourtCase: ['open', 'scheduled', 'continued', 'hearing', 'disposed', 'appealed', 'closed'],
};

const PERMIT_TYPES = [
  'Building',
  'Zoning',
  'Business',
  'Event',
  'Encroachment',
  'Electrical',
  'Plumbing',
  'Demolition',
  'Sign',
  'Grading',
];
const VIOLATION_TYPES = [
  'Zoning',
  'Building Code',
  'Health/Safety',
  'Nuisance',
  'Property Maintenance',
  'Environmental',
  'Noise',
  'Signage',
];
const EMERGENCY_TYPES = [
  'Natural Disaster',
  'Severe Weather',
  'Wildfire',
  'Flood',
  'Earthquake',
  'Hazmat',
  'Civil Unrest',
  'Pandemic',
  'Infrastructure Failure',
];
const RECORD_TYPES = [
  'Minutes',
  'Ordinance',
  'Resolution',
  'Contract',
  'Correspondence',
  'Budget',
  'Audit Report',
  'Policy',
  'License',
];
const RECORD_CLASSIFICATIONS = ['public', 'confidential', 'exempt'];
const RECORD_REQUEST_TYPES = [
  'FOIA',
  'Public Records Request',
  'Subpoena',
  'Internal',
  'Media Request',
];
const CASE_TYPES = [
  'Zoning Violation',
  'Code Enforcement',
  'Civil',
  'Tax Appeal',
  'Small Claims',
  'Traffic',
  'Landlord-Tenant',
  'Environmental',
];

const seedData: Record<
  ArtifactType,
  { title: string; data: Record<string, unknown>; meta: Record<string, unknown> }[]
> = {
  Permit: [
    {
      title: 'Commercial Building Permit - 450 Main St',
      data: {
        applicant: 'Acme Builders LLC',
        type: 'Building',
        address: '450 Main Street',
        description: 'New 3-story commercial building construction',
        fee: 12500,
        submittedDate: '2026-01-15',
        inspector: 'R. Martinez',
        propertyOwner: 'Main Street Holdings',
        parcelNumber: 'APN-2024-0450',
        estimatedDays: 90,
        reviewNotes: 'Structural plans under review',
      },
      meta: { status: 'under_review' },
    },
    {
      title: 'Event Permit - Summer Music Festival',
      data: {
        applicant: 'City Arts Council',
        type: 'Event',
        address: 'Civic Center Park',
        description: 'Annual summer music festival, expected 5000 attendees',
        fee: 2500,
        submittedDate: '2026-01-20',
        inspector: 'S. Chen',
        propertyOwner: 'City of Springfield',
        parcelNumber: 'APN-PARK-001',
        estimatedDays: 30,
        reviewNotes: 'Awaiting fire marshal approval',
      },
      meta: { status: 'submitted' },
    },
    {
      title: 'Business License - New Restaurant',
      data: {
        applicant: 'Fresh Eats Inc',
        type: 'Business',
        address: '220 Oak Avenue',
        description: 'New restaurant establishment with outdoor dining',
        fee: 850,
        submittedDate: '2026-02-01',
        inspector: 'J. Thompson',
        propertyOwner: 'Oak Ave Properties',
        parcelNumber: 'APN-2024-0220',
        estimatedDays: 45,
        reviewNotes: 'Health inspection scheduled',
      },
      meta: { status: 'inspection' },
    },
  ],
  Project: [
    {
      title: 'Main Street Bridge Rehabilitation',
      data: {
        name: 'Main Street Bridge Rehab',
        department: 'Transportation',
        budget: 4500000,
        spent: 1800000,
        startDate: '2025-09-01',
        endDate: '2026-08-30',
        contractor: 'State Bridge Corp',
        location: 'Main St at River Crossing',
        progress: 40,
        milestones: [
          'Design Complete',
          'Foundation Work',
          'Steel Erection',
          'Deck Pour',
          'Final Inspection',
        ],
        citizenImpact: 'Detour via Oak Ave, 15-min added commute',
        roadClosures: 'Main St between 1st and 3rd Ave closed M-F 7AM-6PM',
        contactPhone: '555-0142',
      },
      meta: { status: 'in_progress' },
    },
    {
      title: 'Northside Water Main Replacement',
      data: {
        name: 'Northside Water Main',
        department: 'Utilities',
        budget: 2100000,
        spent: 350000,
        startDate: '2026-02-01',
        endDate: '2026-12-15',
        contractor: 'AquaPipe Solutions',
        location: 'Northside District - Elm to Pine',
        progress: 15,
        milestones: [
          'Survey Complete',
          'Excavation Phase 1',
          'Pipe Installation',
          'Testing',
          'Restoration',
        ],
        citizenImpact: 'Intermittent water shutoffs with 48hr notice',
        roadClosures: 'Rolling closures on Elm, Maple, and Pine streets',
        contactPhone: '555-0198',
      },
      meta: { status: 'in_progress' },
    },
  ],
  Violation: [
    {
      title: 'Unpermitted Construction - 789 Cedar Ln',
      data: {
        address: '789 Cedar Lane',
        code: 'MC-2024-4.12',
        description: 'Unpermitted addition to rear of property, approximately 400 sq ft',
        inspector: 'K. Williams',
        observedDate: '2026-01-28',
        severity: 'major',
        violationType: 'Building Code',
        fineAmount: 5000,
        complianceDeadline: '2026-03-15',
        ownerName: 'J. Henderson',
        ownerContact: '555-0177',
        photos: 4,
        hearingDate: '',
        escalationHistory: 'Initial citation issued 01/28',
      },
      meta: { status: 'notice_sent' },
    },
    {
      title: 'Property Maintenance - 156 Birch St',
      data: {
        address: '156 Birch Street',
        code: 'MC-2024-7.03',
        description: 'Overgrown vegetation, abandoned vehicle on property',
        inspector: 'M. Garcia',
        observedDate: '2026-02-05',
        severity: 'minor',
        violationType: 'Property Maintenance',
        fineAmount: 500,
        complianceDeadline: '2026-03-05',
        ownerName: 'T. Nakamura',
        ownerContact: '555-0233',
        photos: 2,
        hearingDate: '',
        escalationHistory: '',
      },
      meta: { status: 'cited' },
    },
  ],
  EmergencyPlan: [
    {
      title: 'Flood Response Plan - River District',
      data: {
        name: 'River District Flood Response',
        type: 'Flood',
        zone: 'Zone A - Floodplain',
        coordinator: 'Chief R. Johnson',
        activationLevel: 'Level 2',
        resources: [
          'Sandbag Team Alpha',
          'Pump Unit 3',
          'Evacuation Bus Fleet',
          'Emergency Shelters',
        ],
        personnelCount: 85,
        equipmentList: '12 pumps, 50k sandbags, 8 boats, 4 generators',
        suppliesInventory: 'Water: 5000 gal, MREs: 2000, blankets: 500, first aid: 50 kits',
        mutualAidPartners: 'County Fire, State EM, Red Cross, National Guard',
        exerciseDate: '2026-04-15',
        lastReviewDate: '2025-11-01',
        evacuationRoutes: 'Route A: River Rd to Hwy 9, Route B: Bridge St to I-40',
        shelterLocations: 'Springfield HS Gym, Community Center, First Baptist Church',
      },
      meta: { status: 'standby' },
    },
  ],
  Record: [
    {
      title: 'City Council Minutes - January 2026',
      data: {
        type: 'Minutes',
        department: 'City Clerk',
        filedDate: '2026-01-31',
        retentionYears: 99,
        description: 'Regular session minutes including budget amendment vote',
        classification: 'public',
        requestType: '',
        requestor: '',
        requestDate: '',
        responseDeadline: '',
        redactionRequired: false,
        redactionNotes: '',
        pageCount: 24,
        dispositionDate: '',
      },
      meta: { status: 'active' },
    },
    {
      title: 'FOIA Request - Police Records 2025',
      data: {
        type: 'Correspondence',
        department: 'Police',
        filedDate: '2026-02-03',
        retentionYears: 7,
        description: 'Request for use-of-force incident reports calendar year 2025',
        classification: 'confidential',
        requestType: 'FOIA',
        requestor: 'Springfield Tribune',
        requestDate: '2026-02-03',
        responseDeadline: '2026-02-18',
        redactionRequired: true,
        redactionNotes: 'Redact officer personal info, victim names, minor details',
        pageCount: 156,
        dispositionDate: '',
      },
      meta: { status: 'pending' },
    },
  ],
  CourtCase: [
    {
      title: 'City v. Henderson - Unpermitted Construction',
      data: {
        caseNumber: 'MC-2026-00142',
        plaintiff: 'City of Springfield',
        defendant: 'J. Henderson',
        judge: 'Hon. Patricia Wells',
        courtDate: '2026-03-20',
        type: 'Code Enforcement',
        disposition: '',
        fineAmount: 5000,
        feesCollected: 0,
        feesOwed: 5250,
        attorney: 'City Attorney L. Park',
        nextHearingDate: '2026-03-20',
        filingDate: '2026-02-10',
        courtroom: 'Room 204',
        continuanceCount: 0,
      },
      meta: { status: 'open' },
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function daysUntil(dateStr: string): number {
  if (!dateStr) return -1;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function progressColor(pct: number): string {
  if (pct >= 75) return 'bg-green-400';
  if (pct >= 50) return 'bg-neon-cyan';
  if (pct >= 25) return 'bg-yellow-400';
  return 'bg-orange-400';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GovernmentLensPage() {
  useLensNav('government');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('government');

  const [showFeatures, setShowFeatures] = useState(true);
  const [mode, setMode] = useState<ModeTab>('Permits');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('dashboard');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showActionPanel, setShowActionPanel] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('submitted');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const currentTab = MODE_TABS.find((t) => t.id === mode)!;
  const currentType = currentTab.artifactType;
  const availableStatuses = STATUSES_BY_TYPE[currentType];

  /* ---- data hooks ---- */
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactData>('government', currentType, {
      seed: seedData[currentType] || [],
    });

  const permitData = useLensData<ArtifactData>('government', 'Permit', {
    seed: seedData.Permit,
    noSeed: currentType === 'Permit' ? false : true,
  });
  const projectData = useLensData<ArtifactData>('government', 'Project', {
    seed: seedData.Project,
    noSeed: currentType === 'Project' ? false : true,
  });
  const violationData = useLensData<ArtifactData>('government', 'Violation', {
    seed: seedData.Violation,
    noSeed: currentType === 'Violation' ? false : true,
  });
  const emergencyData = useLensData<ArtifactData>('government', 'EmergencyPlan', {
    seed: seedData.EmergencyPlan,
    noSeed: currentType === 'EmergencyPlan' ? false : true,
  });
  const recordData = useLensData<ArtifactData>('government', 'Record', {
    seed: seedData.Record,
    noSeed: currentType === 'Record' ? false : true,
  });
  const courtData = useLensData<ArtifactData>('government', 'CourtCase', {
    seed: seedData.CourtCase,
    noSeed: currentType === 'CourtCase' ? false : true,
  });

  const runAction = useRunArtifact('government');
  const editingItem = items.find((i) => i.id === editingId) || null;
  const detailItem = items.find((i) => i.id === detailId) || null;

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => {
        const d = i.data as unknown as Record<string, unknown>;
        return (
          i.title.toLowerCase().includes(q) ||
          ((d.address as string) || '').toLowerCase().includes(q) ||
          ((d.applicant as string) || '').toLowerCase().includes(q) ||
          ((d.caseNumber as string) || '').toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  /* ---- editor helpers ---- */
  const openNew = useCallback(() => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(availableStatuses[0]);
    setFormData({});
    setShowEditor(true);
  }, [availableStatuses]);

  const openEdit = useCallback(
    (item: LensItem<ArtifactData>) => {
      setEditingId(item.id);
      setFormTitle(item.title);
      setFormStatus(item.meta.status || availableStatuses[0]);
      setFormData(item.data as unknown as Record<string, unknown>);
      setShowEditor(true);
    },
    [availableStatuses]
  );

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
    const targetId = artifactId || detailItem?.id || editingItem?.id || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) {
        setActionResult({
          message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(result.result as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  /* ---- stats ---- */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    availableStatuses.forEach((s) => {
      counts[s] = 0;
    });
    items.forEach((i) => {
      const s = i.meta.status;
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [items, availableStatuses]);

  /* ---- status badge ---- */
  const renderStatusBadge = (status: string) => {
    const color = STATUS_COLORS[status] || 'gray-400';
    return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
  };

  /* ---- progress bar ---- */
  const ProgressBar = ({
    value,
    max = 100,
    className,
  }: {
    value: number;
    max?: number;
    className?: string;
  }) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className={cn('w-full h-2 bg-lattice-elevated rounded-full overflow-hidden', className)}>
        <div
          className={cn('h-full rounded-full transition-all', progressColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  };

  /* ---- stat card helper ---- */
  const StatCard = ({
    icon: Icon,
    label,
    value,
    color,
    sub,
  }: {
    icon: typeof TrendingUp;
    label: string;
    value: string | number;
    color: string;
    sub?: string;
  }) => (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <p className={ds.heading2}>{value}</p>
      {sub && <p className={cn(ds.textMuted, 'mt-1 text-xs')}>{sub}</p>}
    </div>
  );

  /* ================================================================ */
  /*  Form Fields by Type                                              */
  /* ================================================================ */

  const renderFormFields = () => {
    const f = formData;
    const set = (key: string, val: unknown) => setFormData({ ...formData, [key]: val });

    switch (currentType) {
      case 'Permit':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Applicant</label>
                <input
                  className={ds.input}
                  value={(f.applicant as string) || ''}
                  onChange={(e) => set('applicant', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Permit Type</label>
                <select
                  className={ds.select}
                  value={(f.type as string) || ''}
                  onChange={(e) => set('type', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {PERMIT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Property Address</label>
                <input
                  className={ds.input}
                  value={(f.address as string) || ''}
                  onChange={(e) => set('address', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Property Owner</label>
                <input
                  className={ds.input}
                  value={(f.propertyOwner as string) || ''}
                  onChange={(e) => set('propertyOwner', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(f.description as string) || ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Fee ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.fee as number) || ''}
                  onChange={(e) => set('fee', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Submitted Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.submittedDate as string) || ''}
                  onChange={(e) => set('submittedDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Parcel Number</label>
                <input
                  className={ds.input}
                  value={(f.parcelNumber as string) || ''}
                  onChange={(e) => set('parcelNumber', e.target.value)}
                  placeholder="APN-xxxx-xxxx"
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Assigned Inspector</label>
                <input
                  className={ds.input}
                  value={(f.inspector as string) || ''}
                  onChange={(e) => set('inspector', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Est. Processing Days</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.estimatedDays as number) || ''}
                  onChange={(e) => set('estimatedDays', parseInt(e.target.value) || 0)}
                />
              </div>
              <div />
            </div>
            <div>
              <label className={ds.label}>Review Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.reviewNotes as string) || ''}
                onChange={(e) => set('reviewNotes', e.target.value)}
              />
            </div>
          </div>
        );

      case 'Project':
        return (
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Project Name</label>
              <input
                className={ds.input}
                value={(f.name as string) || ''}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Department</label>
                <input
                  className={ds.input}
                  value={(f.department as string) || ''}
                  onChange={(e) => set('department', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Contractor</label>
                <input
                  className={ds.input}
                  value={(f.contractor as string) || ''}
                  onChange={(e) => set('contractor', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Location</label>
              <input
                className={ds.input}
                value={(f.location as string) || ''}
                onChange={(e) => set('location', e.target.value)}
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Start Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.startDate as string) || ''}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>End Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.endDate as string) || ''}
                  onChange={(e) => set('endDate', e.target.value)}
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Budget ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.budget as number) || ''}
                  onChange={(e) => set('budget', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Spent ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.spent as number) || ''}
                  onChange={(e) => set('spent', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Progress %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={ds.input}
                  value={(f.progress as number) || ''}
                  onChange={(e) => set('progress', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Milestones (comma-separated)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={((f.milestones as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'milestones',
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
            </div>
            <div>
              <label className={ds.label}>Citizen Impact Assessment</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.citizenImpact as string) || ''}
                onChange={(e) => set('citizenImpact', e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Road Closures</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.roadClosures as string) || ''}
                onChange={(e) => set('roadClosures', e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Contact Phone</label>
              <input
                className={ds.input}
                value={(f.contactPhone as string) || ''}
                onChange={(e) => set('contactPhone', e.target.value)}
              />
            </div>
          </div>
        );

      case 'Violation':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Property Address</label>
                <input
                  className={ds.input}
                  value={(f.address as string) || ''}
                  onChange={(e) => set('address', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Violation Type</label>
                <select
                  className={ds.select}
                  value={(f.violationType as string) || ''}
                  onChange={(e) => set('violationType', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {VIOLATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Code Section</label>
                <input
                  className={ds.input}
                  value={(f.code as string) || ''}
                  onChange={(e) => set('code', e.target.value)}
                  placeholder="MC-xxxx-x.xx"
                />
              </div>
              <div>
                <label className={ds.label}>Severity</label>
                <select
                  className={ds.select}
                  value={(f.severity as string) || 'minor'}
                  onChange={(e) => set('severity', e.target.value)}
                >
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Fine Amount ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.fineAmount as number) || ''}
                  onChange={(e) => set('fineAmount', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(f.description as string) || ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Owner Name</label>
                <input
                  className={ds.input}
                  value={(f.ownerName as string) || ''}
                  onChange={(e) => set('ownerName', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Owner Contact</label>
                <input
                  className={ds.input}
                  value={(f.ownerContact as string) || ''}
                  onChange={(e) => set('ownerContact', e.target.value)}
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Inspector</label>
                <input
                  className={ds.input}
                  value={(f.inspector as string) || ''}
                  onChange={(e) => set('inspector', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Observed Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.observedDate as string) || ''}
                  onChange={(e) => set('observedDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Compliance Deadline</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.complianceDeadline as string) || ''}
                  onChange={(e) => set('complianceDeadline', e.target.value)}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Hearing Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.hearingDate as string) || ''}
                  onChange={(e) => set('hearingDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Photo Count</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.photos as number) || ''}
                  onChange={(e) => set('photos', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Escalation History</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.escalationHistory as string) || ''}
                onChange={(e) => set('escalationHistory', e.target.value)}
              />
            </div>
          </div>
        );

      case 'EmergencyPlan':
        return (
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Plan Name</label>
              <input
                className={ds.input}
                value={(f.name as string) || ''}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Hazard Type</label>
                <select
                  className={ds.select}
                  value={(f.type as string) || ''}
                  onChange={(e) => set('type', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {EMERGENCY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Zone</label>
                <input
                  className={ds.input}
                  value={(f.zone as string) || ''}
                  onChange={(e) => set('zone', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Activation Level</label>
                <select
                  className={ds.select}
                  value={(f.activationLevel as string) || 'Level 1'}
                  onChange={(e) => set('activationLevel', e.target.value)}
                >
                  <option value="Level 1">Level 1 - Monitor</option>
                  <option value="Level 2">Level 2 - Partial</option>
                  <option value="Level 3">Level 3 - Full</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Coordinator</label>
                <input
                  className={ds.input}
                  value={(f.coordinator as string) || ''}
                  onChange={(e) => set('coordinator', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Personnel Count</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.personnelCount as number) || ''}
                  onChange={(e) => set('personnelCount', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Resources (comma-separated)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={((f.resources as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'resources',
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
            </div>
            <div>
              <label className={ds.label}>Equipment List</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.equipmentList as string) || ''}
                onChange={(e) => set('equipmentList', e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Supplies Inventory</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.suppliesInventory as string) || ''}
                onChange={(e) => set('suppliesInventory', e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Mutual Aid Partners</label>
              <input
                className={ds.input}
                value={(f.mutualAidPartners as string) || ''}
                onChange={(e) => set('mutualAidPartners', e.target.value)}
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Next Exercise Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.exerciseDate as string) || ''}
                  onChange={(e) => set('exerciseDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Last Review Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.lastReviewDate as string) || ''}
                  onChange={(e) => set('lastReviewDate', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Evacuation Routes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.evacuationRoutes as string) || ''}
                onChange={(e) => set('evacuationRoutes', e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Shelter Locations</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(f.shelterLocations as string) || ''}
                onChange={(e) => set('shelterLocations', e.target.value)}
              />
            </div>
          </div>
        );

      case 'Record':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Record Type</label>
                <select
                  className={ds.select}
                  value={(f.type as string) || ''}
                  onChange={(e) => set('type', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {RECORD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Classification</label>
                <select
                  className={ds.select}
                  value={(f.classification as string) || 'public'}
                  onChange={(e) => set('classification', e.target.value)}
                >
                  {RECORD_CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Department</label>
                <input
                  className={ds.input}
                  value={(f.department as string) || ''}
                  onChange={(e) => set('department', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Filed Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.filedDate as string) || ''}
                  onChange={(e) => set('filedDate', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(f.description as string) || ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Retention (years)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.retentionYears as number) || ''}
                  onChange={(e) => set('retentionYears', parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Page Count</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.pageCount as number) || ''}
                  onChange={(e) => set('pageCount', parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Disposition Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.dispositionDate as string) || ''}
                  onChange={(e) => set('dispositionDate', e.target.value)}
                />
              </div>
            </div>
            <div className="border-t border-lattice-border pt-4 mt-4">
              <h4 className={cn(ds.heading3, 'text-base mb-3')}>Request Tracking</h4>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Request Type</label>
                  <select
                    className={ds.select}
                    value={(f.requestType as string) || ''}
                    onChange={(e) => set('requestType', e.target.value)}
                  >
                    <option value="">None</option>
                    {RECORD_REQUEST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Requestor</label>
                  <input
                    className={ds.input}
                    value={(f.requestor as string) || ''}
                    onChange={(e) => set('requestor', e.target.value)}
                  />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Request Date</label>
                  <input
                    type="date"
                    className={ds.input}
                    value={(f.requestDate as string) || ''}
                    onChange={(e) => set('requestDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Response Deadline</label>
                  <input
                    type="date"
                    className={ds.input}
                    value={(f.responseDeadline as string) || ''}
                    onChange={(e) => set('responseDeadline', e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <input
                  type="checkbox"
                  id="redactionReq"
                  checked={(f.redactionRequired as boolean) || false}
                  onChange={(e) => set('redactionRequired', e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="redactionReq" className={ds.label + ' mb-0'}>
                  Redaction Required
                </label>
              </div>
              {!!f.redactionRequired && (
                <div className="mt-2">
                  <label className={ds.label}>Redaction Notes</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={(f.redactionNotes as string) || ''}
                    onChange={(e) => set('redactionNotes', e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        );

      case 'CourtCase':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Case Number</label>
                <input
                  className={ds.input}
                  value={(f.caseNumber as string) || ''}
                  onChange={(e) => set('caseNumber', e.target.value)}
                  placeholder="MC-YYYY-NNNNN"
                />
              </div>
              <div>
                <label className={ds.label}>Case Type</label>
                <select
                  className={ds.select}
                  value={(f.type as string) || ''}
                  onChange={(e) => set('type', e.target.value)}
                >
                  <option value="">Select type...</option>
                  {CASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Plaintiff</label>
                <input
                  className={ds.input}
                  value={(f.plaintiff as string) || ''}
                  onChange={(e) => set('plaintiff', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Defendant</label>
                <input
                  className={ds.input}
                  value={(f.defendant as string) || ''}
                  onChange={(e) => set('defendant', e.target.value)}
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Assigned Judge</label>
                <input
                  className={ds.input}
                  value={(f.judge as string) || ''}
                  onChange={(e) => set('judge', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Courtroom</label>
                <input
                  className={ds.input}
                  value={(f.courtroom as string) || ''}
                  onChange={(e) => set('courtroom', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Attorney</label>
                <input
                  className={ds.input}
                  value={(f.attorney as string) || ''}
                  onChange={(e) => set('attorney', e.target.value)}
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Filing Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.filingDate as string) || ''}
                  onChange={(e) => set('filingDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Court Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.courtDate as string) || ''}
                  onChange={(e) => set('courtDate', e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Next Hearing</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(f.nextHearingDate as string) || ''}
                  onChange={(e) => set('nextHearingDate', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Disposition</label>
              <input
                className={ds.input}
                value={(f.disposition as string) || ''}
                onChange={(e) => set('disposition', e.target.value)}
                placeholder="e.g., Guilty, Not Guilty, Dismissed..."
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Fine Amount ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.fineAmount as number) || ''}
                  onChange={(e) => set('fineAmount', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Fees Collected ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.feesCollected as number) || ''}
                  onChange={(e) => set('feesCollected', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className={ds.label}>Fees Owed ($)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(f.feesOwed as number) || ''}
                  onChange={(e) => set('feesOwed', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Continuance Count</label>
              <input
                type="number"
                className={ds.input}
                value={(f.continuanceCount as number) || 0}
                onChange={(e) => set('continuanceCount', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Detail View                                                      */
  /* ================================================================ */

  const renderDetailView = () => {
    if (!detailItem) return null;
    const d = detailItem.data as unknown as Record<string, unknown>;

    const renderPermitDetail = () => (
      <div className="space-y-6">
        <div className={ds.grid3}>
          <StatCard
            icon={DollarSign}
            label="Fee"
            value={formatCurrency((d.fee as number) || 0)}
            color="text-green-400"
          />
          <StatCard
            icon={Timer}
            label="Est. Processing"
            value={`${d.estimatedDays || 0} days`}
            color="text-yellow-400"
            sub={d.submittedDate ? `Submitted: ${d.submittedDate}` : undefined}
          />
          <StatCard
            icon={Users}
            label="Inspector"
            value={(d.inspector as string) || 'Unassigned'}
            color="text-neon-cyan"
          />
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Permit Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className={ds.textMuted}>Type</span>
              <p className="text-white">{d.type as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Applicant</span>
              <p className="text-white">{d.applicant as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Address</span>
              <p className="text-white flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {d.address as string}
              </p>
            </div>
            <div>
              <span className={ds.textMuted}>Parcel</span>
              <p className={ds.textMono}>{d.parcelNumber as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Property Owner</span>
              <p className="text-white">{d.propertyOwner as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Status</span>
              <div className="mt-1">{renderStatusBadge(detailItem.meta.status)}</div>
            </div>
          </div>
        </div>
        {!!d.description && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-2')}>Description</h3>
            <p className="text-gray-300 text-sm">{d.description as string}</p>
          </div>
        )}
        {!!d.reviewNotes && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-2')}>Review Notes</h3>
            <p className="text-gray-300 text-sm">{d.reviewNotes as string}</p>
          </div>
        )}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Processing Timeline</h3>
          <div className="space-y-3">
            {['submitted', 'under_review', 'inspection', 'approved'].map((step, idx) => {
              const currentIdx = STATUSES_BY_TYPE.Permit.indexOf(detailItem.meta.status);
              const stepIdx = STATUSES_BY_TYPE.Permit.indexOf(step);
              const done = stepIdx <= currentIdx;
              return (
                <div key={step} className="flex items-center gap-3">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                      done ? 'bg-green-400/20 text-green-400' : 'bg-lattice-elevated text-gray-500'
                    )}
                  >
                    {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className={cn('text-sm', done ? 'text-white' : 'text-gray-500')}>
                    {step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );

    const renderProjectDetail = () => {
      const budget = (d.budget as number) || 0;
      const spent = (d.spent as number) || 0;
      const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
      const progress = (d.progress as number) || 0;
      const milestones = (d.milestones as string[]) || [];
      return (
        <div className="space-y-6">
          <div className={ds.grid4}>
            <StatCard
              icon={DollarSign}
              label="Budget"
              value={formatCurrency(budget)}
              color="text-green-400"
            />
            <StatCard
              icon={TrendingUp}
              label="Spent"
              value={formatCurrency(spent)}
              color="text-yellow-400"
              sub={`${pct}% utilized`}
            />
            <StatCard
              icon={Percent}
              label="Progress"
              value={`${progress}%`}
              color="text-neon-cyan"
            />
            <StatCard
              icon={Calendar}
              label="End Date"
              value={(d.endDate as string) || '—'}
              color="text-neon-purple"
              sub={d.endDate ? `${daysUntil(d.endDate as string)} days remaining` : undefined}
            />
          </div>
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Budget Utilization</h3>
            <ProgressBar value={pct} />
            <div className="flex justify-between mt-2">
              <span className={ds.textMuted}>{formatCurrency(spent)} spent</span>
              <span className={ds.textMuted}>{formatCurrency(budget - spent)} remaining</span>
            </div>
          </div>
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Project Progress</h3>
            <ProgressBar value={progress} />
            <p className={cn(ds.textMuted, 'mt-2')}>{progress}% complete</p>
          </div>
          {milestones.length > 0 && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3')}>Milestones</h3>
              <div className="space-y-2">
                {milestones.map((m, i) => {
                  const milestonePct = ((i + 1) / milestones.length) * 100;
                  const done = progress >= milestonePct;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2 rounded-lg bg-lattice-elevated/30"
                    >
                      <div
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-xs',
                          done
                            ? 'bg-green-400/20 text-green-400'
                            : 'bg-lattice-elevated text-gray-500'
                        )}
                      >
                        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                      </div>
                      <span className={cn('text-sm', done ? 'text-white' : 'text-gray-400')}>
                        {m}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Project Info</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={ds.textMuted}>Contractor</span>
                <p className="text-white">{d.contractor as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Department</span>
                <p className="text-white">{d.department as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Location</span>
                <p className="text-white flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {d.location as string}
                </p>
              </div>
              <div>
                <span className={ds.textMuted}>Contact</span>
                <p className="text-white">{d.contactPhone as string}</p>
              </div>
            </div>
          </div>
          {!!d.citizenImpact && (
            <div className={cn(ds.panel, 'border-yellow-400/30')}>
              <h3 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
                <AlertTriangle className="w-4 h-4 text-yellow-400" /> Citizen Impact
              </h3>
              <p className="text-gray-300 text-sm">{d.citizenImpact as string}</p>
            </div>
          )}
          {!!d.roadClosures && (
            <div className={cn(ds.panel, 'border-orange-400/30')}>
              <h3 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
                <Truck className="w-4 h-4 text-orange-400" /> Road Closures
              </h3>
              <p className="text-gray-300 text-sm">{d.roadClosures as string}</p>
            </div>
          )}
        </div>
      );
    };

    const renderViolationDetail = () => {
      const deadline = d.complianceDeadline as string;
      const daysLeft = deadline ? daysUntil(deadline) : -1;
      return (
        <div className="space-y-6">
          <div className={ds.grid4}>
            <StatCard
              icon={ShieldAlert}
              label="Severity"
              value={((d.severity as string) || 'N/A').toUpperCase()}
              color={
                d.severity === 'critical'
                  ? 'text-red-400'
                  : d.severity === 'major'
                    ? 'text-orange-400'
                    : 'text-yellow-400'
              }
            />
            <StatCard
              icon={DollarSign}
              label="Fine"
              value={formatCurrency((d.fineAmount as number) || 0)}
              color="text-red-400"
            />
            <StatCard
              icon={Timer}
              label="Days to Comply"
              value={daysLeft >= 0 ? daysLeft : 'N/A'}
              color={daysLeft <= 7 && daysLeft >= 0 ? 'text-red-400' : 'text-yellow-400'}
              sub={deadline || undefined}
            />
            <StatCard
              icon={Eye}
              label="Evidence"
              value={`${(d.photos as number) || 0} photos`}
              color="text-neon-cyan"
            />
          </div>
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-4')}>Violation Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={ds.textMuted}>Type</span>
                <p className="text-white">{d.violationType as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Code</span>
                <p className={ds.textMono}>{d.code as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Address</span>
                <p className="text-white flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {d.address as string}
                </p>
              </div>
              <div>
                <span className={ds.textMuted}>Inspector</span>
                <p className="text-white">{d.inspector as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Owner</span>
                <p className="text-white">{d.ownerName as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Contact</span>
                <p className="text-white">{d.ownerContact as string}</p>
              </div>
            </div>
          </div>
          {!!d.description && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Description</h3>
              <p className="text-gray-300 text-sm">{d.description as string}</p>
            </div>
          )}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Enforcement Timeline</h3>
            <div className="space-y-3">
              {STATUSES_BY_TYPE.Violation.map((step, idx) => {
                const currentIdx = STATUSES_BY_TYPE.Violation.indexOf(detailItem.meta.status);
                const done = idx <= currentIdx;
                return (
                  <div key={step} className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                        done
                          ? 'bg-green-400/20 text-green-400'
                          : 'bg-lattice-elevated text-gray-500'
                      )}
                    >
                      {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span className={cn('text-sm', done ? 'text-white' : 'text-gray-500')}>
                      {step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {!!d.escalationHistory && (
            <div className={cn(ds.panel, 'border-red-400/30')}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Escalation History</h3>
              <p className="text-gray-300 text-sm">{d.escalationHistory as string}</p>
            </div>
          )}
        </div>
      );
    };

    const renderEmergencyDetail = () => {
      const resources = (d.resources as string[]) || [];
      return (
        <div className="space-y-6">
          <div className={ds.grid4}>
            <StatCard
              icon={Siren}
              label="Hazard Type"
              value={(d.type as string) || 'N/A'}
              color="text-red-400"
            />
            <StatCard
              icon={Shield}
              label="Activation"
              value={(d.activationLevel as string) || 'N/A'}
              color="text-neon-cyan"
            />
            <StatCard
              icon={Users}
              label="Personnel"
              value={(d.personnelCount as number) || 0}
              color="text-neon-blue"
            />
            <StatCard
              icon={Target}
              label="Resources"
              value={resources.length}
              color="text-green-400"
            />
          </div>
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-4')}>Plan Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={ds.textMuted}>Zone</span>
                <p className="text-white">{d.zone as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Coordinator</span>
                <p className="text-white">{d.coordinator as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Last Review</span>
                <p className="text-white">{d.lastReviewDate as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Next Exercise</span>
                <p className="text-white">{d.exerciseDate as string}</p>
              </div>
            </div>
          </div>
          {resources.length > 0 && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3')}>Staged Resources</h3>
              <div className={ds.grid2}>
                {resources.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 rounded-lg bg-lattice-elevated/30"
                  >
                    <CircleDot className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-sm text-white">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!d.equipmentList && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Equipment</h3>
              <p className="text-gray-300 text-sm">{d.equipmentList as string}</p>
            </div>
          )}
          {!!d.suppliesInventory && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Supplies</h3>
              <p className="text-gray-300 text-sm">{d.suppliesInventory as string}</p>
            </div>
          )}
          {!!d.mutualAidPartners && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Mutual Aid Partners</h3>
              <p className="text-gray-300 text-sm">{d.mutualAidPartners as string}</p>
            </div>
          )}
          {!!d.evacuationRoutes && (
            <div className={cn(ds.panel, 'border-yellow-400/30')}>
              <h3 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
                <ArrowRight className="w-4 h-4 text-yellow-400" /> Evacuation Routes
              </h3>
              <p className="text-gray-300 text-sm">{d.evacuationRoutes as string}</p>
            </div>
          )}
          {!!d.shelterLocations && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Shelter Locations</h3>
              <p className="text-gray-300 text-sm">{d.shelterLocations as string}</p>
            </div>
          )}
        </div>
      );
    };

    const renderRecordDetail = () => {
      const deadline = d.responseDeadline as string;
      const daysLeft = deadline ? daysUntil(deadline) : -1;
      return (
        <div className="space-y-6">
          <div className={ds.grid4}>
            <StatCard
              icon={FileText}
              label="Pages"
              value={(d.pageCount as number) || 0}
              color="text-neon-blue"
            />
            <StatCard
              icon={Clock}
              label="Retention"
              value={`${(d.retentionYears as number) || 0} yr`}
              color="text-yellow-400"
            />
            <StatCard
              icon={d.classification === 'public' ? Unlock : Lock}
              label="Classification"
              value={((d.classification as string) || 'public').toUpperCase()}
              color={d.classification === 'public' ? 'text-green-400' : 'text-red-400'}
            />
            {deadline && (
              <StatCard
                icon={CalendarClock}
                label="Response Due"
                value={daysLeft >= 0 ? `${daysLeft} days` : 'Overdue'}
                color={daysLeft <= 3 ? 'text-red-400' : 'text-yellow-400'}
                sub={deadline}
              />
            )}
          </div>
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-4')}>Record Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={ds.textMuted}>Type</span>
                <p className="text-white">{d.type as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Department</span>
                <p className="text-white">{d.department as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Filed</span>
                <p className="text-white">{d.filedDate as string}</p>
              </div>
              <div>
                <span className={ds.textMuted}>Disposition</span>
                <p className="text-white">{(d.dispositionDate as string) || 'Active'}</p>
              </div>
            </div>
          </div>
          {!!d.description && (
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-2')}>Description</h3>
              <p className="text-gray-300 text-sm">{d.description as string}</p>
            </div>
          )}
          {!!d.requestType && (
            <div className={cn(ds.panel, 'border-neon-blue/30')}>
              <h3 className={cn(ds.heading3, 'mb-3')}>Request Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className={ds.textMuted}>Request Type</span>
                  <p className="text-white">{d.requestType as string}</p>
                </div>
                <div>
                  <span className={ds.textMuted}>Requestor</span>
                  <p className="text-white">{d.requestor as string}</p>
                </div>
                <div>
                  <span className={ds.textMuted}>Request Date</span>
                  <p className="text-white">{d.requestDate as string}</p>
                </div>
                <div>
                  <span className={ds.textMuted}>Deadline</span>
                  <p
                    className={cn(
                      'text-white',
                      daysLeft <= 3 && daysLeft >= 0 ? 'text-red-400 font-bold' : ''
                    )}
                  >
                    {deadline}
                  </p>
                </div>
              </div>
              {!!d.redactionRequired && (
                <div className="mt-4 p-3 rounded-lg bg-red-400/10 border border-red-400/20">
                  <p className="text-sm text-red-400 font-medium flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5" /> Redaction Required
                  </p>
                  {!!d.redactionNotes && (
                    <p className="text-xs text-gray-400 mt-1">{d.redactionNotes as string}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    const renderCourtDetail = () => (
      <div className="space-y-6">
        <div className={ds.grid4}>
          <StatCard
            icon={DollarSign}
            label="Fines"
            value={formatCurrency((d.fineAmount as number) || 0)}
            color="text-red-400"
          />
          <StatCard
            icon={CheckCircle2}
            label="Collected"
            value={formatCurrency((d.feesCollected as number) || 0)}
            color="text-green-400"
          />
          <StatCard
            icon={AlertTriangle}
            label="Owed"
            value={formatCurrency((d.feesOwed as number) || 0)}
            color="text-orange-400"
          />
          <StatCard
            icon={RotateCcw}
            label="Continuances"
            value={(d.continuanceCount as number) || 0}
            color="text-yellow-400"
          />
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Case Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className={ds.textMuted}>Case Number</span>
              <p className={ds.textMono}>{d.caseNumber as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Type</span>
              <p className="text-white">{d.type as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Plaintiff</span>
              <p className="text-white">{d.plaintiff as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Defendant</span>
              <p className="text-white">{d.defendant as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Judge</span>
              <p className="text-white">{d.judge as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Courtroom</span>
              <p className="text-white">{d.courtroom as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Attorney</span>
              <p className="text-white">{d.attorney as string}</p>
            </div>
            <div>
              <span className={ds.textMuted}>Filing Date</span>
              <p className="text-white">{d.filingDate as string}</p>
            </div>
          </div>
        </div>
        {!!d.disposition && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-2')}>Disposition</h3>
            <p className="text-white">{d.disposition as string}</p>
          </div>
        )}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Hearing Schedule</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-lattice-elevated/30">
              <span className={ds.textMuted}>Court Date</span>
              <p className="text-white font-medium mt-1">{d.courtDate as string}</p>
              {!!d.courtDate && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  {daysUntil(d.courtDate as string)} days away
                </p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-lattice-elevated/30">
              <span className={ds.textMuted}>Next Hearing</span>
              <p className="text-white font-medium mt-1">
                {(d.nextHearingDate as string) || 'Not scheduled'}
              </p>
              {!!d.nextHearingDate && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  {daysUntil(d.nextHearingDate as string)} days away
                </p>
              )}
            </div>
          </div>
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Fees &amp; Collections</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className={ds.textMuted}>Total Fines</span>
              <span className="text-white">{formatCurrency((d.fineAmount as number) || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className={ds.textMuted}>Fees Collected</span>
              <span className="text-green-400">
                {formatCurrency((d.feesCollected as number) || 0)}
              </span>
            </div>
            <div className="flex justify-between border-t border-lattice-border pt-2">
              <span className="text-white font-medium">Outstanding</span>
              <span className="text-red-400 font-medium">
                {formatCurrency((d.feesOwed as number) || 0)}
              </span>
            </div>
          </div>
          {((d.fineAmount as number) || 0) > 0 && (
            <ProgressBar
              value={(d.feesCollected as number) || 0}
              max={(d.fineAmount as number) || 1}
              className="mt-3"
            />
          )}
        </div>
      </div>
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className={ds.btnGhost}
              onClick={() => {
                setDetailId(null);
                setView('library');
              }}
            >
              <ChevronDown className="w-4 h-4 rotate-90" /> Back
            </button>
            <div>
              <h2 className={ds.heading2}>{detailItem.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                {renderStatusBadge(detailItem.meta.status)}
                <span className={ds.textMuted}>
                  Created {new Date(detailItem.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className={ds.btnSecondary} onClick={() => openEdit(detailItem)}>
              <Edit3 className="w-4 h-4" /> Edit
            </button>
            <button className={ds.btnPrimary} onClick={() => setShowActionPanel(!showActionPanel)}>
              <Play className="w-4 h-4" /> Actions
            </button>
          </div>
        </div>

        {showActionPanel && (
          <div className={cn(ds.panel, 'border-neon-cyan/30')}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Domain Actions</h3>
            <div className="flex flex-wrap gap-2">
              {currentType === 'Permit' && (
                <>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('permit_timeline_calc', detailItem.id)}
                  >
                    <Timer className="w-4 h-4" /> Timeline Calc
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('permit_fee_estimate', detailItem.id)}
                  >
                    <DollarSign className="w-4 h-4" /> Fee Estimate
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('permit_inspection_schedule', detailItem.id)}
                  >
                    <Calendar className="w-4 h-4" /> Schedule Inspection
                  </button>
                </>
              )}
              {currentType === 'Project' && (
                <>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('budget_report', detailItem.id)}
                  >
                    <BarChart3 className="w-4 h-4" /> Budget Report
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('milestone_update', detailItem.id)}
                  >
                    <Target className="w-4 h-4" /> Milestone Update
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('citizen_impact_report', detailItem.id)}
                  >
                    <Users className="w-4 h-4" /> Impact Report
                  </button>
                </>
              )}
              {currentType === 'Violation' && (
                <>
                  <button
                    className={cn(ds.btnDanger)}
                    onClick={() => handleAction('violation_escalate', detailItem.id)}
                  >
                    <Zap className="w-4 h-4" /> Escalate
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('fine_calculation', detailItem.id)}
                  >
                    <DollarSign className="w-4 h-4" /> Calc Fine
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('compliance_check', detailItem.id)}
                  >
                    <ClipboardList className="w-4 h-4" /> Compliance Check
                  </button>
                </>
              )}
              {currentType === 'EmergencyPlan' && (
                <>
                  <button
                    className={cn(ds.btnDanger)}
                    onClick={() => handleAction('resource_staging', detailItem.id)}
                  >
                    <Truck className="w-4 h-4" /> Stage Resources
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('readiness_assessment', detailItem.id)}
                  >
                    <Gauge className="w-4 h-4" /> Readiness Check
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('activate_plan', detailItem.id)}
                  >
                    <Siren className="w-4 h-4" /> Activate
                  </button>
                </>
              )}
              {currentType === 'Record' && (
                <>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('retention_check', detailItem.id)}
                  >
                    <Clock className="w-4 h-4" /> Retention Check
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('redaction_review', detailItem.id)}
                  >
                    <Lock className="w-4 h-4" /> Redaction Review
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('export_record', detailItem.id)}
                  >
                    <Download className="w-4 h-4" /> Export
                  </button>
                </>
              )}
              {currentType === 'CourtCase' && (
                <>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('docket_report', detailItem.id)}
                  >
                    <FileText className="w-4 h-4" /> Docket Report
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('fee_collection_status', detailItem.id)}
                  >
                    <DollarSign className="w-4 h-4" /> Collection Status
                  </button>
                  <button
                    className={ds.btnSecondary}
                    onClick={() => handleAction('schedule_hearing', detailItem.id)}
                  >
                    <Calendar className="w-4 h-4" /> Schedule Hearing
                  </button>
                </>
              )}
            </div>
            {runAction.isPending && (
              <p className="text-xs text-neon-blue animate-pulse mt-2">Running action...</p>
            )}
          </div>
        )}

        {currentType === 'Permit' && renderPermitDetail()}
        {currentType === 'Project' && renderProjectDetail()}
        {currentType === 'Violation' && renderViolationDetail()}
        {currentType === 'EmergencyPlan' && renderEmergencyDetail()}
        {currentType === 'Record' && renderRecordDetail()}
        {currentType === 'CourtCase' && renderCourtDetail()}
      </div>
    );
  };

  /* ================================================================ */
  /*  Card Renderers                                                   */
  /* ================================================================ */

  const renderCard = (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div
        key={item.id}
        className={ds.panelHover}
        onClick={() => {
          setDetailId(item.id);
          setView('detail');
        }}
      >
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'text-base truncate mr-2')}>{item.title}</h3>
          {renderStatusBadge(item.meta.status)}
        </div>
        <div className="mt-3 space-y-1.5">
          {currentType === 'Permit' && (
            <>
              <p className={ds.textMuted}>
                <MapPin className="w-3 h-3 inline mr-1" />
                {d.address as string}
              </p>
              <div className="flex items-center justify-between">
                <span className={ds.textMuted}>
                  {d.type as string} - {d.applicant as string}
                </span>
                <span className={cn(ds.textMono, 'text-green-400 text-xs')}>
                  {formatCurrency((d.fee as number) || 0)}
                </span>
              </div>
              {d.inspector && (
                <p className={cn(ds.textMuted, 'text-xs')}>Inspector: {d.inspector as string}</p>
              )}
              {d.estimatedDays && (
                <p className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                  <Timer className="w-3 h-3" /> Est. {d.estimatedDays as number} days
                </p>
              )}
            </>
          )}
          {currentType === 'Project' && (
            <>
              <p className={ds.textMuted}>
                <MapPin className="w-3 h-3 inline mr-1" />
                {d.location as string}
              </p>
              <p className={ds.textMuted}>
                {d.department as string} | {d.contractor as string}
              </p>
              <div className="mt-2">
                <div className="flex justify-between mb-1">
                  <span className={cn(ds.textMuted, 'text-xs')}>Progress</span>
                  <span className={cn(ds.textMuted, 'text-xs')}>
                    {(d.progress as number) || 0}%
                  </span>
                </div>
                <ProgressBar value={(d.progress as number) || 0} />
              </div>
              <div className="flex justify-between mt-1">
                <span className={cn(ds.textMono, 'text-xs text-green-400')}>
                  {formatCurrency((d.budget as number) || 0)}
                </span>
                <span className={cn(ds.textMuted, 'text-xs')}>
                  {formatCurrency((d.spent as number) || 0)} spent
                </span>
              </div>
            </>
          )}
          {currentType === 'Violation' && (
            <>
              <p className={ds.textMuted}>
                <MapPin className="w-3 h-3 inline mr-1" />
                {d.address as string}
              </p>
              <div className="flex items-center gap-2">
                <span
                  className={ds.badge(
                    d.severity === 'critical'
                      ? 'red-400'
                      : d.severity === 'major'
                        ? 'orange-400'
                        : 'yellow-400'
                  )}
                >
                  {d.severity as string}
                </span>
                <span className={cn(ds.textMono, 'text-xs')}>{d.code as string}</span>
              </div>
              <p className={ds.textMuted}>
                {d.violationType as string} | Inspector: {d.inspector as string}
              </p>
              {d.complianceDeadline && (
                <p
                  className={cn(
                    'text-xs',
                    daysUntil(d.complianceDeadline as string) <= 7
                      ? 'text-red-400'
                      : 'text-gray-400'
                  )}
                >
                  <Clock className="w-3 h-3 inline mr-1" />
                  Deadline: {d.complianceDeadline as string}
                </p>
              )}
              {(d.fineAmount as number) > 0 && (
                <p className={cn(ds.textMono, 'text-xs text-red-400')}>
                  Fine: {formatCurrency((d.fineAmount as number) || 0)}
                </p>
              )}
            </>
          )}
          {currentType === 'EmergencyPlan' && (
            <>
              <div className="flex items-center gap-2">
                <span className={ds.badge('red-400')}>{d.type as string}</span>
                <span className={ds.badge('neon-cyan')}>{d.activationLevel as string}</span>
              </div>
              <p className={ds.textMuted}>Zone: {d.zone as string}</p>
              <p className={ds.textMuted}>Coordinator: {d.coordinator as string}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className={cn(ds.textMuted, 'text-xs')}>
                  <Users className="w-3 h-3 inline mr-1" />
                  {(d.personnelCount as number) || 0} personnel
                </span>
                <span className={cn(ds.textMuted, 'text-xs')}>
                  <Target className="w-3 h-3 inline mr-1" />
                  {((d.resources as string[]) || []).length} resources
                </span>
              </div>
            </>
          )}
          {currentType === 'Record' && (
            <>
              <div className="flex items-center gap-2">
                <span className={ds.badge(STATUS_COLORS[d.classification as string] || 'gray-400')}>
                  {d.classification as string}
                </span>
                <span className={ds.textMuted}>{d.type as string}</span>
              </div>
              <p className={ds.textMuted}>
                {d.department as string} | Filed: {d.filedDate as string}
              </p>
              <p className={cn(ds.textMuted, 'text-xs')}>
                {d.pageCount as number} pages | Retention: {d.retentionYears as number} yr
              </p>
              {!!d.requestType && (
                <div className="mt-1 p-2 rounded bg-neon-blue/10 border border-neon-blue/20">
                  <p className="text-xs text-neon-blue">
                    {d.requestType as string} from {d.requestor as string}
                  </p>
                  {!!d.responseDeadline && (
                    <p
                      className={cn(
                        'text-xs',
                        daysUntil(d.responseDeadline as string) <= 3
                          ? 'text-red-400'
                          : 'text-gray-400'
                      )}
                    >
                      Due: {d.responseDeadline as string}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {currentType === 'CourtCase' && (
            <>
              <p className={cn(ds.textMono, 'text-xs')}>{d.caseNumber as string}</p>
              <p className={ds.textMuted}>
                {d.plaintiff as string} v. {d.defendant as string}
              </p>
              <p className={ds.textMuted}>
                Judge: {d.judge as string} | {d.type as string}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className={cn(ds.textMuted, 'text-xs')}>
                  <Calendar className="w-3 h-3 inline mr-1" />
                  {d.courtDate as string}
                </span>
                {(d.feesOwed as number) > 0 && (
                  <span className={cn(ds.textMono, 'text-xs text-red-400')}>
                    {formatCurrency((d.feesOwed as number) || 0)} owed
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-lattice-border pt-3">
          <button
            className={cn(ds.btnGhost, ds.btnSmall)}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(item);
            }}
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            className={cn(ds.btnDanger, ds.btnSmall)}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(item.id);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <div className="flex-1" />
          <span className={cn(ds.textMuted, 'text-xs')}>
            View <ChevronRight className="w-3 h-3 inline" />
          </span>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  Enhanced Dashboard                                               */
  /* ================================================================ */

  const renderDashboard = () => {
    const allPermits = permitData.items;
    const allProjects = projectData.items;
    const allViolations = violationData.items;
    const allEmergency = emergencyData.items;
    const allRecords = recordData.items;
    const allCourt = courtData.items;

    const openPermits = allPermits.filter((i) =>
      ['submitted', 'under_review', 'inspection'].includes(i.meta.status)
    ).length;
    const activeViolations = allViolations.filter(
      (i) => !['resolved', 'fined'].includes(i.meta.status)
    ).length;
    const totalProjectBudget = allProjects.reduce(
      (s, i) => s + (((i.data as unknown as Record<string, unknown>).budget as number) || 0),
      0
    );
    const totalProjectSpent = allProjects.reduce(
      (s, i) => s + (((i.data as unknown as Record<string, unknown>).spent as number) || 0),
      0
    );
    const budgetUtilization =
      totalProjectBudget > 0 ? Math.round((totalProjectSpent / totalProjectBudget) * 100) : 0;
    const pendingRecordRequests = allRecords.filter((i) => {
      const d = i.data as unknown as Record<string, unknown>;
      return d.requestType && ['pending', 'active'].includes(i.meta.status);
    }).length;
    const emergencyReadiness =
      allEmergency.length > 0
        ? Math.round(
            (allEmergency.filter((i) => ['standby', 'deactivated'].includes(i.meta.status)).length /
              allEmergency.length) *
              100
          )
        : 100;
    const upcomingHearings = allCourt.filter((i) => {
      const d = i.data as unknown as Record<string, unknown>;
      const courtDate = d.courtDate as string;
      return courtDate && daysUntil(courtDate) >= 0 && daysUntil(courtDate) <= 30;
    }).length;

    const totalFees = allPermits.reduce(
      (s, i) => s + (((i.data as unknown as Record<string, unknown>).fee as number) || 0),
      0
    );
    const totalFines = allViolations.reduce(
      (s, i) => s + (((i.data as unknown as Record<string, unknown>).fineAmount as number) || 0),
      0
    );
    const totalCourtFees = allCourt.reduce(
      (s, i) => s + (((i.data as unknown as Record<string, unknown>).feesOwed as number) || 0),
      0
    );

    return (
      <div className="space-y-6">
        {/* Top KPI row */}
        <div className={ds.grid4}>
          <div className={cn(ds.panel, 'border-neon-blue/30')}>
            <div className="flex items-center gap-2 mb-2">
              <FileCheck className="w-5 h-5 text-neon-blue" />
              <span className={ds.textMuted}>Open Permits</span>
            </div>
            <p className={ds.heading1}>{openPermits}</p>
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>{allPermits.length} total permits</p>
          </div>
          <div className={cn(ds.panel, 'border-red-400/30')}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span className={ds.textMuted}>Active Violations</span>
            </div>
            <p className={ds.heading1}>{activeViolations}</p>
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>
              {allViolations.length} total violations
            </p>
          </div>
          <div className={cn(ds.panel, 'border-yellow-400/30')}>
            <div className="flex items-center gap-2 mb-2">
              <HardHat className="w-5 h-5 text-yellow-400" />
              <span className={ds.textMuted}>Budget Utilization</span>
            </div>
            <p className={ds.heading1}>{budgetUtilization}%</p>
            <ProgressBar value={budgetUtilization} className="mt-2" />
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>
              {formatCurrency(totalProjectSpent)} of {formatCurrency(totalProjectBudget)}
            </p>
          </div>
          <div className={cn(ds.panel, 'border-neon-cyan/30')}>
            <div className="flex items-center gap-2 mb-2">
              <Archive className="w-5 h-5 text-neon-cyan" />
              <span className={ds.textMuted}>Pending Requests</span>
            </div>
            <p className={ds.heading1}>{pendingRecordRequests}</p>
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>{allRecords.length} total records</p>
          </div>
        </div>

        {/* Secondary KPI row */}
        <div className={ds.grid3}>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-5 h-5 text-green-400" />
              <span className={ds.textMuted}>Emergency Readiness</span>
            </div>
            <div className="flex items-center gap-3">
              <p className={ds.heading1}>{emergencyReadiness}%</p>
              <div
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium',
                  emergencyReadiness >= 80
                    ? 'bg-green-400/20 text-green-400'
                    : emergencyReadiness >= 50
                      ? 'bg-yellow-400/20 text-yellow-400'
                      : 'bg-red-400/20 text-red-400'
                )}
              >
                {emergencyReadiness >= 80 ? 'READY' : emergencyReadiness >= 50 ? 'PARTIAL' : 'LOW'}
              </div>
            </div>
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>
              {allEmergency.length} plans maintained
            </p>
          </div>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-2">
              <Gavel className="w-5 h-5 text-neon-purple" />
              <span className={ds.textMuted}>Upcoming Hearings</span>
            </div>
            <p className={ds.heading1}>{upcomingHearings}</p>
            <p className={cn(ds.textMuted, 'text-xs mt-1')}>
              Next 30 days | {allCourt.length} total cases
            </p>
          </div>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-green-400" />
              <span className={ds.textMuted}>Revenue Overview</span>
            </div>
            <p className={ds.heading2}>{formatCurrency(totalFees + totalFines + totalCourtFees)}</p>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between">
                <span className={cn(ds.textMuted, 'text-xs')}>Permit Fees</span>
                <span className="text-xs text-white">{formatCurrency(totalFees)}</span>
              </div>
              <div className="flex justify-between">
                <span className={cn(ds.textMuted, 'text-xs')}>Violation Fines</span>
                <span className="text-xs text-white">{formatCurrency(totalFines)}</span>
              </div>
              <div className="flex justify-between">
                <span className={cn(ds.textMuted, 'text-xs')}>Court Fees</span>
                <span className="text-xs text-white">{formatCurrency(totalCourtFees)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Department panels */}
        <div className={ds.grid2}>
          {/* Permit breakdown */}
          <div className={ds.panel}>
            <div className={ds.sectionHeader}>
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <FileCheck className="w-4 h-4 text-neon-blue" /> Permits by Status
              </h3>
            </div>
            <div className="mt-3 space-y-2">
              {STATUSES_BY_TYPE.Permit.map((s) => {
                const count = allPermits.filter((i) => i.meta.status === s).length;
                return (
                  <div
                    key={s}
                    className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/30"
                  >
                    <span className="text-sm text-gray-300">
                      {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className={ds.badge(STATUS_COLORS[s] || 'gray-400')}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active projects */}
          <div className={ds.panel}>
            <div className={ds.sectionHeader}>
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <HardHat className="w-4 h-4 text-yellow-400" /> Active Projects
              </h3>
            </div>
            <div className="mt-3 space-y-3">
              {allProjects
                .filter((p) => p.meta.status === 'in_progress')
                .slice(0, 4)
                .map((proj) => {
                  const pd = proj.data as unknown as Record<string, unknown>;
                  return (
                    <div key={proj.id} className="p-3 rounded-lg bg-lattice-elevated/30">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-white font-medium truncate mr-2">
                          {proj.title}
                        </span>
                        <span className={cn(ds.textMuted, 'text-xs whitespace-nowrap')}>
                          {(pd.progress as number) || 0}%
                        </span>
                      </div>
                      <ProgressBar value={(pd.progress as number) || 0} />
                      <div className="flex justify-between mt-1">
                        <span className={cn(ds.textMuted, 'text-xs')}>
                          {pd.contractor as string}
                        </span>
                        <span className={cn(ds.textMuted, 'text-xs')}>
                          {formatCurrency((pd.budget as number) || 0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {allProjects.filter((p) => p.meta.status === 'in_progress').length === 0 && (
                <p className={ds.textMuted}>No active projects.</p>
              )}
            </div>
          </div>

          {/* Violations needing attention */}
          <div className={ds.panel}>
            <div className={ds.sectionHeader}>
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <ShieldAlert className="w-4 h-4 text-red-400" /> Violations Needing Attention
              </h3>
            </div>
            <div className="mt-3 space-y-2">
              {allViolations
                .filter((v) => !['resolved', 'fined'].includes(v.meta.status))
                .slice(0, 4)
                .map((viol) => {
                  const vd = viol.data as unknown as Record<string, unknown>;
                  const deadline = vd.complianceDeadline as string;
                  const dLeft = deadline ? daysUntil(deadline) : -1;
                  return (
                    <div
                      key={viol.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/30"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-sm text-white truncate">{vd.address as string}</p>
                        <p className={cn(ds.textMuted, 'text-xs')}>
                          {vd.violationType as string} | {vd.severity as string}
                        </p>
                      </div>
                      <div className="text-right">
                        {renderStatusBadge(viol.meta.status)}
                        {dLeft >= 0 && (
                          <p
                            className={cn(
                              'text-xs mt-1',
                              dLeft <= 7 ? 'text-red-400' : 'text-gray-400'
                            )}
                          >
                            {dLeft}d left
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              {allViolations.filter((v) => !['resolved', 'fined'].includes(v.meta.status))
                .length === 0 && <p className={ds.textMuted}>No active violations.</p>}
            </div>
          </div>

          {/* Upcoming court dates */}
          <div className={ds.panel}>
            <div className={ds.sectionHeader}>
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <Gavel className="w-4 h-4 text-neon-purple" /> Upcoming Court Dates
              </h3>
            </div>
            <div className="mt-3 space-y-2">
              {allCourt
                .filter((c) => {
                  const cd = c.data as unknown as Record<string, unknown>;
                  return (cd.courtDate as string) && daysUntil(cd.courtDate as string) >= 0;
                })
                .sort((a, b) => {
                  const ad = (a.data as unknown as Record<string, unknown>).courtDate as string;
                  const bd = (b.data as unknown as Record<string, unknown>).courtDate as string;
                  return new Date(ad).getTime() - new Date(bd).getTime();
                })
                .slice(0, 4)
                .map((courtCase) => {
                  const cd = courtCase.data as unknown as Record<string, unknown>;
                  return (
                    <div
                      key={courtCase.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/30"
                    >
                      <div className="min-w-0 mr-2">
                        <p className="text-sm text-white truncate">{courtCase.title}</p>
                        <p className={cn(ds.textMuted, 'text-xs')}>
                          {cd.caseNumber as string} | {cd.judge as string}
                        </p>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm text-neon-purple">{cd.courtDate as string}</p>
                        <p className={cn(ds.textMuted, 'text-xs')}>
                          {daysUntil(cd.courtDate as string)}d away
                        </p>
                      </div>
                    </div>
                  );
                })}
              {allCourt.filter((c) => {
                const cd = c.data as unknown as Record<string, unknown>;
                return (cd.courtDate as string) && daysUntil(cd.courtDate as string) >= 0;
              }).length === 0 && <p className={ds.textMuted}>No upcoming court dates.</p>}
            </div>
          </div>
        </div>

        {/* Quick action panel at bottom of dashboard */}
        <div className={cn(ds.panel, 'border-neon-cyan/20')}>
          <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Zap className="w-5 h-5 text-neon-cyan" /> Quick Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              className={ds.btnPrimary}
              onClick={() => {
                setMode('Permits');
                setView('library');
                openNew();
              }}
            >
              <Plus className="w-4 h-4" /> New Permit
            </button>
            <button
              className={ds.btnSecondary}
              onClick={() => {
                setMode('Public Works');
                setView('library');
                openNew();
              }}
            >
              <Plus className="w-4 h-4" /> New Project
            </button>
            <button
              className={ds.btnSecondary}
              onClick={() => {
                setMode('Code Enforcement');
                setView('library');
                openNew();
              }}
            >
              <Plus className="w-4 h-4" /> Log Violation
            </button>
            <button
              className={ds.btnSecondary}
              onClick={() => {
                setMode('Records');
                setView('library');
                openNew();
              }}
            >
              <Plus className="w-4 h-4" /> File Record
            </button>
            <button
              className={ds.btnSecondary}
              onClick={() => {
                setMode('Court');
                setView('library');
                openNew();
              }}
            >
              <Plus className="w-4 h-4" /> New Case
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  Main Render                                                      */
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
    <div data-lens-theme="government" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center">
            <Landmark className="w-6 h-6 text-neon-cyan" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Government Operations</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>
              Permits, public works, code enforcement, emergency management, records &amp; court
              administration
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn(view === 'dashboard' ? ds.btnPrimary : ds.btnSecondary)}
            onClick={() => {
              setView('dashboard');
              setDetailId(null);
            }}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
          <button
            className={cn(view === 'library' ? ds.btnPrimary : ds.btnSecondary)}
            onClick={() => {
              setView('library');
              setDetailId(null);
            }}
          >
            <ListChecks className="w-4 h-4" /> Library
          </button>
          <button
            onClick={() => {
              const data = JSON.stringify(
                { export: 'government-lens', date: new Date().toISOString() },
                null,
                2
              );
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'government-export.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className={ds.btnGhost}
            title="Export"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Legislation', value: items.length, icon: Landmark },
          {
            label: 'Enacted Rate',
            value: `${items.length > 0 ? Math.round((items.filter((i) => i.meta?.status === 'approved' || i.meta?.status === 'completed').length / items.length) * 100) : 0}%`,
            icon: FileCheck,
          },
          {
            label: 'Pending Votes',
            value: items.filter(
              (i) => i.meta?.status === 'pending' || i.meta?.status === 'submitted'
            ).length,
            icon: Gavel,
          },
          {
            label: 'Open Permits',
            value: items.filter(
              (i) => i.meta?.status === 'open' || i.meta?.status === 'in_progress'
            ).length,
            icon: ClipboardList,
          },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-cyan shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="government" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel
        domain="government"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />
      <DTUExportButton domain="government" data={{}} compact />
      {/* Navigation tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = mode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setMode(tab.id);
                setStatusFilter('all');
                setSearchQuery('');
                if (view === 'detail') {
                  setView('library');
                  setDetailId(null);
                }
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all whitespace-nowrap text-sm font-medium',
                isActive
                  ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border border-transparent'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      {view === 'dashboard' && renderDashboard()}

      {view === 'detail' && renderDetailView()}

      {view === 'library' && (
        <>
          {/* Search, filter, actions bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className={cn(ds.input, 'pl-10')}
                placeholder={`Search ${mode.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                className={cn(ds.select, 'w-auto')}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                {availableStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
            <button className={ds.btnPrimary} onClick={openNew}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
            <span className={cn(ds.textMuted, 'text-xs')}>
              {filtered.length} of {items.length} items
            </span>
            {runAction.isPending && (
              <span className="text-xs text-neon-blue animate-pulse">Running...</span>
            )}
          </div>

          {/* Status quick-filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter('all')}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                statusFilter === 'all'
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'bg-lattice-elevated text-gray-400 hover:text-white'
              )}
            >
              All ({items.length})
            </button>
            {availableStatuses.map((s) => {
              const count = statusCounts[s] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s === statusFilter ? 'all' : s)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    statusFilter === s
                      ? `bg-${STATUS_COLORS[s]}/20 text-${STATUS_COLORS[s]}`
                      : 'bg-lattice-elevated text-gray-400 hover:text-white'
                  )}
                >
                  {s.replace(/_/g, ' ')} ({count})
                </button>
              );
            })}
          </div>

          {/* Items grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-neon-cyan" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <Landmark className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className={ds.heading3}>No {currentType}s found</p>
              <p className={ds.textMuted}>Create one to get started or adjust your filters.</p>
              <button className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
                <Plus className="w-4 h-4" /> Add {currentType}
              </button>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  {renderCard(item)}
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Action result panel */}
      {actionResult && (
        <div className={cn(ds.panel, 'border-neon-cyan/30')}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Activity className="w-4 h-4 text-neon-cyan" /> Action Result
            </h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre
            className={cn(
              ds.textMono,
              'text-xs overflow-auto max-h-48 p-3 rounded-lg bg-lattice-elevated/50'
            )}
          >
            {JSON.stringify(actionResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')} onClick={(e) => e.stopPropagation()}>
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>
                    {editingId ? 'Edit' : 'New'} {currentType}
                  </h2>
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Title</label>
                    <input
                      className={ds.input}
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="Artifact title..."
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Status</label>
                    <select
                      className={ds.select}
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value)}
                    >
                      {availableStatuses.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-end gap-3">
                <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>
                  Cancel
                </button>
                <button className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                  {editingId ? 'Update' : 'Create'} {currentType}
                </button>
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
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="government" />
          </div>
        )}
      </div>
    </div>
  );
}
