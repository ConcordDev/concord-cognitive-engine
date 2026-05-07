'use client';

import { useState, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  FlaskConical,
  TestTubes,
  LineChart,
  Wrench,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  Download,
  BarChart3,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Archive,
  Users,
  ShieldCheck,
  Activity,
  PieChart,
  FileText,
  Target,
  Hash,
  Eye,
  GraduationCap,
  ClipboardList,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab =
  | 'Notebook'
  | 'Samples'
  | 'Equipment'
  | 'Analysis'
  | 'Protocols'
  | 'Publications'
  | 'Dashboard';

type ArtifactType = 'Experiment' | 'Sample' | 'Equipment' | 'Analysis' | 'Protocol' | 'Publication';

type ExperimentStatus =
  | 'planned'
  | 'active'
  | 'paused'
  | 'analyzing'
  | 'peer_review'
  | 'published'
  | 'archived';

type SampleCondition = 'excellent' | 'good' | 'degraded' | 'compromised' | 'disposed';
type HazardClass = 'none' | 'biohazard' | 'chemical' | 'radioactive' | 'flammable' | 'corrosive';
type EquipmentCondition =
  | 'operational'
  | 'needs_calibration'
  | 'maintenance'
  | 'out_of_service'
  | 'decommissioned';
type ProtocolApproval = 'draft' | 'under_review' | 'approved' | 'superseded' | 'retired';
type PubStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'revision'
  | 'accepted'
  | 'published'
  | 'rejected';
type VisualizationType = 'bar' | 'line' | 'scatter' | 'heatmap' | 'histogram' | 'box' | 'pie';

interface Experiment {
  hypothesis: string;
  protocol: string;
  observations: string;
  results: string;
  conclusions: string;
  reproducibility: 'confirmed' | 'partial' | 'not_tested' | 'failed';
  pi: string;
  startDate: string;
  endDate: string;
  fundingSource: string;
  tags: string[];
}

interface SampleData {
  sampleId: string;
  type: string;
  storageLocation: string;
  chainOfCustody: string[];
  condition: SampleCondition;
  hazardClass: HazardClass;
  collectionDate: string;
  collector: string;
  quantity: number;
  unit: string;
  expirationDate: string;
  notes: string;
}

interface EquipmentData {
  model: string;
  serialNumber: string;
  calibrationDate: string;
  nextCalibration: string;
  location: string;
  condition: EquipmentCondition;
  assignedTo: string;
  usageLog: { date: string; user: string; hours: number }[];
  maintenanceSchedule: string;
  bookings: { date: string; user: string; timeSlot: string }[];
  purchaseDate: string;
  warrantyExpiry: string;
}

interface AnalysisData {
  datasetName: string;
  datasetSize: string;
  mean: number;
  median: number;
  stdDev: number;
  sampleN: number;
  pipelineSteps: string[];
  vizType: VisualizationType;
  software: string;
  author: string;
  startDate: string;
  pValue: string;
  conclusion: string;
  confidenceInterval: string;
}

interface ProtocolData {
  version: string;
  approvalStatus: ProtocolApproval;
  approvedBy: string;
  reviewDate: string;
  nextReviewDate: string;
  safetyLevel: string;
  equipment: string[];
  duration: string;
  author: string;
  steps: string[];
  references: string[];
  changeLog: string[];
}

interface PublicationData {
  journal: string;
  status: PubStatus;
  coAuthors: string[];
  doi: string;
  submissionDate: string;
  acceptanceDate: string;
  impactFactor: number;
  abstract: string;
  keywords: string[];
  correspondingAuthor: string;
  fundingAck: string;
}

type ArtifactDataUnion =
  | Experiment
  | SampleData
  | EquipmentData
  | AnalysisData
  | ProtocolData
  | PublicationData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof FlaskConical; artifactType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Notebook', icon: BookOpen, artifactType: 'Experiment' },
  { id: 'Samples', icon: TestTubes, artifactType: 'Sample' },
  { id: 'Equipment', icon: Wrench, artifactType: 'Equipment' },
  { id: 'Analysis', icon: LineChart, artifactType: 'Analysis' },
  { id: 'Protocols', icon: ClipboardList, artifactType: 'Protocol' },
  { id: 'Publications', icon: GraduationCap, artifactType: 'Publication' },
];

const ALL_STATUSES: ExperimentStatus[] = [
  'planned',
  'active',
  'paused',
  'analyzing',
  'peer_review',
  'published',
  'archived',
];

const STATUS_COLORS: Record<string, string> = {
  planned: 'neon-blue',
  active: 'green-400',
  paused: 'orange-400',
  analyzing: 'yellow-400',
  peer_review: 'neon-purple',
  published: 'neon-cyan',
  archived: 'gray-400',
  excellent: 'green-400',
  good: 'blue-400',
  degraded: 'yellow-400',
  compromised: 'red-400',
  disposed: 'gray-400',
  operational: 'green-400',
  needs_calibration: 'yellow-400',
  maintenance: 'orange-400',
  out_of_service: 'red-400',
  decommissioned: 'gray-400',
  draft: 'gray-400',
  under_review: 'yellow-400',
  approved: 'green-400',
  superseded: 'blue-400',
  retired: 'gray-500',
  submitted: 'blue-400',
  in_review: 'yellow-400',
  revision: 'orange-400',
  accepted: 'green-400',
  rejected: 'red-400',
  confirmed: 'green-400',
  partial: 'yellow-400',
  not_tested: 'gray-400',
  failed: 'red-400',
  none: 'gray-400',
  biohazard: 'red-400',
  chemical: 'orange-400',
  radioactive: 'yellow-400',
  flammable: 'red-500',
  corrosive: 'purple-400',
};

const SAMPLE_TYPES = [
  'Biological',
  'Soil',
  'Water',
  'Rock',
  'Air',
  'Tissue',
  'Blood',
  'Chemical',
  'Metal',
  'Polymer',
];
const HAZARD_CLASSES: HazardClass[] = [
  'none',
  'biohazard',
  'chemical',
  'radioactive',
  'flammable',
  'corrosive',
];
const SAMPLE_CONDITIONS: SampleCondition[] = [
  'excellent',
  'good',
  'degraded',
  'compromised',
  'disposed',
];
const EQUIPMENT_CONDITIONS: EquipmentCondition[] = [
  'operational',
  'needs_calibration',
  'maintenance',
  'out_of_service',
  'decommissioned',
];
const PROTOCOL_APPROVALS: ProtocolApproval[] = [
  'draft',
  'under_review',
  'approved',
  'superseded',
  'retired',
];
const PUB_STATUSES: PubStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'revision',
  'accepted',
  'published',
  'rejected',
];
const VIZ_TYPES: VisualizationType[] = [
  'bar',
  'line',
  'scatter',
  'heatmap',
  'histogram',
  'box',
  'pie',
];
const SAFETY_LEVELS = ['BSL-1', 'BSL-2', 'BSL-3', 'BSL-4'];
const REPRODUCIBILITY = ['confirmed', 'partial', 'not_tested', 'failed'];

function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'Notebook':
      return ALL_STATUSES;
    case 'Samples':
      return SAMPLE_CONDITIONS;
    case 'Equipment':
      return EQUIPMENT_CONDITIONS;
    case 'Analysis':
      return ['planned', 'active', 'analyzing', 'peer_review', 'published'];
    case 'Protocols':
      return PROTOCOL_APPROVALS;
    case 'Publications':
      return PUB_STATUSES;
    default:
      return ALL_STATUSES;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ScienceLensPage() {
  useLensNav('science');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('science');

  const [showFeatures, setShowFeatures] = useState(true);
  const [mode, setMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('planned');
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentType: ArtifactType =
    MODE_TABS.find((t) => t.id === mode)?.artifactType || 'Experiment';

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactDataUnion>('science', currentType, {
      seed: [],
    });

  /* secondary data fetches for dashboard */
  const { items: experiments } = useLensData<Experiment>('science', 'Experiment', { seed: [] });
  const { items: samples } = useLensData<SampleData>('science', 'Sample', { seed: [] });
  const { items: equipment } = useLensData<EquipmentData>('science', 'Equipment', { seed: [] });
  const { items: analyses } = useLensData<AnalysisData>('science', 'Analysis', { seed: [] });
  const { items: publications } = useLensData<PublicationData>('science', 'Publication', {
    seed: [],
  });

  const runAction = useRunArtifact('science');
  const editingItem = items.find((i) => i.id === editingId) || null;

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  /* ---- editor helpers ---- */
  const openNew = () => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(getStatusesForTab(mode)[0] || 'planned');
    setFormData({});
    setShowEditor(true);
  };

  const openEdit = (item: LensItem<ArtifactDataUnion>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus((item.meta.status as string) || 'planned');
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
      if (result.ok === false) {
        setActionResult({
          message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(result.result as unknown as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Action failed');
    }
  };

  /* ---- export geojson ---- */
  const exportCSV = () => {
    const headers = ['Title', 'Status', 'Created'];
    const rows = items.map((i) => [i.title, i.meta.status, i.createdAt]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `science-${currentType.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---- status badge ---- */
  const renderStatusBadge = (status: string) => {
    const color = STATUS_COLORS[status] || 'gray-400';
    return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
  };

  /* ---- dashboard stats ---- */
  const dashboardStats = useMemo(() => {
    const activeExperiments = experiments.filter((i) => i.meta.status === 'active').length;
    const samplesInInventory = samples.filter((i) => i.meta.status !== 'disposed').length;
    const eqDueCalibration = equipment.filter((i) => {
      const d = i.data as unknown as EquipmentData;
      if (!d.nextCalibration) return false;
      const next = new Date(d.nextCalibration);
      const now = new Date();
      const diff = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 30;
    }).length;
    const pendingAnalyses = analyses.filter(
      (i) => i.meta.status === 'analyzing' || i.meta.status === 'active'
    ).length;
    const pubsThisYear = publications.filter((i) => {
      const d = i.data as unknown as PublicationData;
      return d.status === 'published' || i.meta.status === 'published';
    }).length;
    const hazardousSamples = samples.filter((i) => {
      const d = i.data as unknown as SampleData;
      return d.hazardClass && d.hazardClass !== 'none';
    }).length;
    return {
      activeExperiments,
      samplesInInventory,
      eqDueCalibration,
      pendingAnalyses,
      pubsThisYear,
      hazardousSamples,
    };
  }, [experiments, samples, equipment, analyses, publications]);

  /* ================================================================ */
  /*  Form fields per artifact type                                    */
  /* ================================================================ */

  const renderFormFields = () => {
    switch (currentType) {
      case 'Experiment':
        return (
          <>
            <div>
              <label className={ds.label}>Hypothesis</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.hypothesis as string) || ''}
                onChange={(e) => setFormData({ ...formData, hypothesis: e.target.value })}
                placeholder="State your hypothesis..."
              />
            </div>
            <div>
              <label className={ds.label}>Protocol / Method</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.protocol as string) || ''}
                onChange={(e) => setFormData({ ...formData, protocol: e.target.value })}
                placeholder="Describe the experimental protocol..."
              />
            </div>
            <div>
              <label className={ds.label}>Observations</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.observations as string) || ''}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                placeholder="Record observations..."
              />
            </div>
            <div>
              <label className={ds.label}>Results</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.results as string) || ''}
                onChange={(e) => setFormData({ ...formData, results: e.target.value })}
                placeholder="Document results..."
              />
            </div>
            <div>
              <label className={ds.label}>Conclusions</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.conclusions as string) || ''}
                onChange={(e) => setFormData({ ...formData, conclusions: e.target.value })}
                placeholder="Conclusions drawn..."
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Reproducibility</label>
                <select
                  className={ds.select}
                  value={(formData.reproducibility as string) || 'not_tested'}
                  onChange={(e) => setFormData({ ...formData, reproducibility: e.target.value })}
                >
                  {REPRODUCIBILITY.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Principal Investigator</label>
                <input
                  className={ds.input}
                  value={(formData.pi as string) || ''}
                  onChange={(e) => setFormData({ ...formData, pi: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Start Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.startDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>End Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.endDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Funding Source</label>
              <input
                className={ds.input}
                value={(formData.fundingSource as string) || ''}
                onChange={(e) => setFormData({ ...formData, fundingSource: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Tags (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.tags as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    tags: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </>
        );
      case 'Sample':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Sample ID</label>
                <input
                  className={ds.input}
                  value={(formData.sampleId as string) || ''}
                  onChange={(e) => setFormData({ ...formData, sampleId: e.target.value })}
                  placeholder="SMP-0001"
                />
              </div>
              <div>
                <label className={ds.label}>Sample Type</label>
                <select
                  className={ds.select}
                  value={(formData.type as string) || ''}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="">Select type...</option>
                  {SAMPLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Storage Location</label>
                <input
                  className={ds.input}
                  value={(formData.storageLocation as string) || ''}
                  onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                  placeholder="Freezer B, Shelf 3"
                />
              </div>
              <div>
                <label className={ds.label}>Condition</label>
                <select
                  className={ds.select}
                  value={(formData.condition as string) || 'excellent'}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  {SAMPLE_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Hazard Classification</label>
                <select
                  className={ds.select}
                  value={(formData.hazardClass as string) || 'none'}
                  onChange={(e) => setFormData({ ...formData, hazardClass: e.target.value })}
                >
                  {HAZARD_CLASSES.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Collector</label>
                <input
                  className={ds.input}
                  value={(formData.collector as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collector: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Collection Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.collectionDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collectionDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Expiration Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.expirationDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Quantity</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.quantity as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Unit</label>
                <input
                  className={ds.input}
                  value={(formData.unit as string) || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="mL, g, etc."
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Chain of Custody (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.chainOfCustody as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    chainOfCustody: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Person 1, Person 2..."
              />
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.notes as string) || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </>
        );
      case 'Equipment':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Model</label>
                <input
                  className={ds.input}
                  value={(formData.model as string) || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Serial Number</label>
                <input
                  className={ds.input}
                  value={(formData.serialNumber as string) || ''}
                  onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Condition</label>
                <select
                  className={ds.select}
                  value={(formData.condition as string) || 'operational'}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  {EQUIPMENT_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Location</label>
                <input
                  className={ds.input}
                  value={(formData.location as string) || ''}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Last Calibration</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.calibrationDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, calibrationDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Calibration</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextCalibration as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextCalibration: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Purchase Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.purchaseDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Warranty Expiry</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.warrantyExpiry as string) || ''}
                  onChange={(e) => setFormData({ ...formData, warrantyExpiry: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Assigned To</label>
              <input
                className={ds.input}
                value={(formData.assignedTo as string) || ''}
                onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Maintenance Schedule</label>
              <input
                className={ds.input}
                value={(formData.maintenanceSchedule as string) || ''}
                onChange={(e) => setFormData({ ...formData, maintenanceSchedule: e.target.value })}
                placeholder="e.g. Monthly, Quarterly"
              />
            </div>
          </>
        );
      case 'Analysis':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Dataset Name</label>
                <input
                  className={ds.input}
                  value={(formData.datasetName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, datasetName: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Dataset Size</label>
                <input
                  className={ds.input}
                  value={(formData.datasetSize as string) || ''}
                  onChange={(e) => setFormData({ ...formData, datasetSize: e.target.value })}
                  placeholder="e.g. 10,000 rows"
                />
              </div>
            </div>
            <div className={ds.grid4}>
              <div>
                <label className={ds.label}>Mean</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.mean as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, mean: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Median</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.median as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, median: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Std Dev</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.stdDev as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, stdDev: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>N (sample size)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.sampleN as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, sampleN: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>p-Value</label>
                <input
                  className={ds.input}
                  value={(formData.pValue as string) || ''}
                  onChange={(e) => setFormData({ ...formData, pValue: e.target.value })}
                  placeholder="e.g. 0.003"
                />
              </div>
              <div>
                <label className={ds.label}>Confidence Interval</label>
                <input
                  className={ds.input}
                  value={(formData.confidenceInterval as string) || ''}
                  onChange={(e) => setFormData({ ...formData, confidenceInterval: e.target.value })}
                  placeholder="e.g. 95% CI [1.2, 3.4]"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Visualization Type</label>
                <select
                  className={ds.select}
                  value={(formData.vizType as string) || 'bar'}
                  onChange={(e) => setFormData({ ...formData, vizType: e.target.value })}
                >
                  {VIZ_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Software</label>
                <input
                  className={ds.input}
                  value={(formData.software as string) || ''}
                  onChange={(e) => setFormData({ ...formData, software: e.target.value })}
                  placeholder="R, Python, SPSS..."
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Pipeline Steps (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.pipelineSteps as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pipelineSteps: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Import, Clean, Transform, Model, Validate"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Author</label>
                <input
                  className={ds.input}
                  value={(formData.author as string) || ''}
                  onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Start Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.startDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Conclusion</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.conclusion as string) || ''}
                onChange={(e) => setFormData({ ...formData, conclusion: e.target.value })}
              />
            </div>
          </>
        );
      case 'Protocol':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Version</label>
                <input
                  className={ds.input}
                  value={(formData.version as string) || ''}
                  onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                  placeholder="v1.0"
                />
              </div>
              <div>
                <label className={ds.label}>Approval Status</label>
                <select
                  className={ds.select}
                  value={(formData.approvalStatus as string) || 'draft'}
                  onChange={(e) => setFormData({ ...formData, approvalStatus: e.target.value })}
                >
                  {PROTOCOL_APPROVALS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Approved By</label>
                <input
                  className={ds.input}
                  value={(formData.approvedBy as string) || ''}
                  onChange={(e) => setFormData({ ...formData, approvedBy: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Author</label>
                <input
                  className={ds.input}
                  value={(formData.author as string) || ''}
                  onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Review Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.reviewDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, reviewDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Review Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextReviewDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextReviewDate: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Safety Level</label>
                <select
                  className={ds.select}
                  value={(formData.safetyLevel as string) || 'BSL-1'}
                  onChange={(e) => setFormData({ ...formData, safetyLevel: e.target.value })}
                >
                  {SAFETY_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Duration</label>
                <input
                  className={ds.input}
                  value={(formData.duration as string) || ''}
                  onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                  placeholder="e.g. 4 hours"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Equipment (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.equipment as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    equipment: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Steps (one per line)</label>
              <textarea
                className={ds.textarea}
                rows={4}
                value={((formData.steps as string[]) || []).join('\n')}
                onChange={(e) =>
                  setFormData({ ...formData, steps: e.target.value.split('\n').filter(Boolean) })
                }
                placeholder="Step 1: ...\nStep 2: ..."
              />
            </div>
            <div>
              <label className={ds.label}>References (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.references as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    references: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Change Log (one per line)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={((formData.changeLog as string[]) || []).join('\n')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    changeLog: e.target.value.split('\n').filter(Boolean),
                  })
                }
                placeholder="v1.0: Initial release\nv1.1: Updated step 3"
              />
            </div>
          </>
        );
      case 'Publication':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Journal</label>
                <input
                  className={ds.input}
                  value={(formData.journal as string) || ''}
                  onChange={(e) => setFormData({ ...formData, journal: e.target.value })}
                  placeholder="Nature, Science, etc."
                />
              </div>
              <div>
                <label className={ds.label}>Publication Status</label>
                <select
                  className={ds.select}
                  value={(formData.status as string) || 'draft'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  {PUB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={ds.label}>Co-Authors (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.coAuthors as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    coAuthors: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Corresponding Author</label>
                <input
                  className={ds.input}
                  value={(formData.correspondingAuthor as string) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, correspondingAuthor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>DOI</label>
                <input
                  className={ds.input}
                  value={(formData.doi as string) || ''}
                  onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                  placeholder="10.xxxx/xxxxx"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Submission Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.submissionDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, submissionDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Acceptance Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.acceptanceDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, acceptanceDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Impact Factor</label>
              <input
                type="number"
                step="0.01"
                className={ds.input}
                value={(formData.impactFactor as number) || ''}
                onChange={(e) =>
                  setFormData({ ...formData, impactFactor: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Abstract</label>
              <textarea
                className={ds.textarea}
                rows={4}
                value={(formData.abstract as string) || ''}
                onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Keywords (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.keywords as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    keywords: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Funding Acknowledgement</label>
              <input
                className={ds.input}
                value={(formData.fundingAck as string) || ''}
                onChange={(e) => setFormData({ ...formData, fundingAck: e.target.value })}
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Artifact card renderer                                           */
  /* ================================================================ */

  const renderCard = (item: LensItem<ArtifactDataUnion>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div key={item.id} className={ds.panelHover}>
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'line-clamp-1')}>{item.title}</h3>
          {renderStatusBadge(item.meta.status)}
        </div>

        <div className="mt-2 space-y-1">
          {/* Experiment card */}
          {currentType === 'Experiment' && (
            <>
              {Boolean(d.hypothesis) && (
                <p className={cn(ds.textMuted, 'line-clamp-2')}>
                  <Eye className="w-3 h-3 inline mr-1" />
                  {d.hypothesis as string}
                </p>
              )}
              {Boolean(d.pi) && <p className={ds.textMuted}>PI: {d.pi as string}</p>}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {Boolean(d.reproducibility) && renderStatusBadge(d.reproducibility as string)}
                {Boolean(d.fundingSource) && (
                  <span className={ds.badge('blue-400')}>{d.fundingSource as string}</span>
                )}
              </div>
              {Boolean(d.startDate) && (
                <p className={cn(ds.textMono, 'text-gray-500 text-xs')}>
                  {d.startDate as string} to {(d.endDate as string) || 'ongoing'}
                </p>
              )}
              {Boolean(d.conclusions) && (
                <p className={cn(ds.textMuted, 'line-clamp-2 mt-1 italic')}>
                  {d.conclusions as string}
                </p>
              )}
              {(d.tags as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.tags as string[]).map((tag) => (
                    <span key={tag} className={ds.badge('gray-400')}>
                      <Hash className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Sample card */}
          {currentType === 'Sample' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-500')}>{d.sampleId as string}</p>
              <p className={ds.textMuted}>
                {d.type as string} | {d.storageLocation as string}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.condition) && renderStatusBadge(d.condition as string)}
                {Boolean(d.hazardClass) && (d.hazardClass as string) !== 'none' && (
                  <span className={cn(ds.badge('red-400'), 'flex items-center gap-1')}>
                    <AlertTriangle className="w-3 h-3" />
                    {d.hazardClass as string}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                {d.quantity as number} {d.unit as string} | Collected: {d.collectionDate as string}
              </p>
              {(d.chainOfCustody as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  Custody: {(d.chainOfCustody as string[]).join(' -> ')}
                </p>
              )}
            </>
          )}

          {/* Equipment card */}
          {currentType === 'Equipment' && (
            <>
              <p className={ds.textMuted}>
                {d.model as string} | SN: {d.serialNumber as string}
              </p>
              <div className="flex items-center gap-2">
                {Boolean(d.condition) && renderStatusBadge(d.condition as string)}
              </div>
              <p className={ds.textMuted}>Location: {d.location as string}</p>
              <p className={ds.textMuted}>Assigned: {d.assignedTo as string}</p>
              <p className={cn(ds.textMono, 'text-gray-500 text-xs')}>
                Cal: {d.calibrationDate as string} | Next: {d.nextCalibration as string}
              </p>
              {Boolean(d.maintenanceSchedule) && (
                <p className={ds.textMuted}>Maint: {d.maintenanceSchedule as string}</p>
              )}
            </>
          )}

          {/* Analysis card */}
          {currentType === 'Analysis' && (
            <>
              <p className={ds.textMuted}>
                Dataset: {d.datasetName as string} ({d.datasetSize as string})
              </p>
              <div className={cn(ds.panel, 'mt-2 p-2 space-y-1')}>
                <p className={cn(ds.textMono, 'text-xs text-gray-300')}>
                  Mean: {d.mean as number} | Median: {d.median as number}
                </p>
                <p className={cn(ds.textMono, 'text-xs text-gray-300')}>
                  SD: {d.stdDev as number} | N: {d.sampleN as number}
                </p>
                {Boolean(d.pValue) && (
                  <p className={cn(ds.textMono, 'text-xs text-green-400')}>
                    p = {d.pValue as string}
                  </p>
                )}
                {Boolean(d.confidenceInterval) && (
                  <p className={cn(ds.textMono, 'text-xs text-gray-400')}>
                    {d.confidenceInterval as string}
                  </p>
                )}
              </div>
              {Boolean(d.vizType) && (
                <span className={ds.badge('neon-cyan')}>
                  <PieChart className="w-3 h-3" />
                  {d.vizType as string}
                </span>
              )}
              <p className={ds.textMuted}>
                {d.software as string} | {d.author as string}
              </p>
              {(d.pipelineSteps as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.pipelineSteps as string[]).map((step, i) => (
                    <span key={i} className={ds.badge('blue-400')}>
                      {i + 1}. {step}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Protocol card */}
          {currentType === 'Protocol' && (
            <>
              <div className="flex items-center gap-2">
                <span className={ds.badge('neon-blue')}>v{d.version as string}</span>
                {Boolean(d.approvalStatus) && renderStatusBadge(d.approvalStatus as string)}
                {Boolean(d.safetyLevel) && (
                  <span className={ds.badge('orange-400')}>{d.safetyLevel as string}</span>
                )}
              </div>
              <p className={ds.textMuted}>
                Author: {d.author as string} | Duration: {d.duration as string}
              </p>
              {Boolean(d.approvedBy) && (
                <p className={ds.textMuted}>Approved by: {d.approvedBy as string}</p>
              )}
              <p className={cn(ds.textMono, 'text-xs text-gray-500')}>
                Review: {d.reviewDate as string} | Next: {d.nextReviewDate as string}
              </p>
              {(d.equipment as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.equipment as string[]).map((eq) => (
                    <span key={eq} className={ds.badge('neon-cyan')}>
                      {eq}
                    </span>
                  ))}
                </div>
              )}
              {(d.steps as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  {(d.steps as string[]).length} steps defined
                </p>
              )}
            </>
          )}

          {/* Publication card */}
          {currentType === 'Publication' && (
            <>
              <p className={cn(ds.textMuted, 'font-medium')}>{d.journal as string}</p>
              <div className="flex items-center gap-2">
                {Boolean(d.status) && renderStatusBadge(d.status as string)}
                {(d.impactFactor as number) > 0 && (
                  <span className={ds.badge('yellow-400')}>IF: {d.impactFactor as number}</span>
                )}
              </div>
              {(d.coAuthors as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  <Users className="w-3 h-3 inline mr-1" />
                  {(d.coAuthors as string[]).join(', ')}
                </p>
              )}
              {Boolean(d.doi) && (
                <p className={cn(ds.textMono, 'text-xs text-neon-cyan')}>DOI: {d.doi as string}</p>
              )}
              {Boolean(d.abstract) && (
                <p className={cn(ds.textMuted, 'line-clamp-2 text-xs italic mt-1')}>
                  {d.abstract as string}
                </p>
              )}
              {(d.keywords as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.keywords as string[]).map((kw) => (
                    <span key={kw} className={ds.badge('gray-400')}>
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-lattice-border">
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}>
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  Dashboard view                                                   */
  /* ================================================================ */

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Active Experiments</span>
          </div>
          <p className="text-3xl font-bold text-white">{dashboardStats.activeExperiments}</p>
          <p className={ds.textMuted}>Currently running</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <TestTubes className="w-5 h-5 text-blue-400" />
            <span className={ds.textMuted}>Samples in Inventory</span>
          </div>
          <p className="text-3xl font-bold text-white">{dashboardStats.samplesInInventory}</p>
          <p className={ds.textMuted}>{dashboardStats.hazardousSamples} hazardous</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-5 h-5 text-yellow-400" />
            <span className={ds.textMuted}>Equipment Due Calibration</span>
          </div>
          <p
            className={cn(
              'text-3xl font-bold',
              dashboardStats.eqDueCalibration > 0 ? 'text-yellow-400' : 'text-white'
            )}
          >
            {dashboardStats.eqDueCalibration}
          </p>
          <p className={ds.textMuted}>Within 30 days</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-5 h-5 text-neon-cyan" />
            <span className={ds.textMuted}>Publications This Year</span>
          </div>
          <p className="text-3xl font-bold text-neon-cyan">{dashboardStats.pubsThisYear}</p>
          <p className={ds.textMuted}>Published papers</p>
        </div>
      </div>

      {/* Pending Analyses */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <LineChart className="w-5 h-5 text-neon-purple" />
            <span className={ds.textMuted}>Pending Analyses</span>
          </div>
          <p className="text-3xl font-bold text-neon-purple">{dashboardStats.pendingAnalyses}</p>
          <p className={ds.textMuted}>Awaiting completion</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Hazardous Samples</span>
          </div>
          <p className="text-3xl font-bold text-red-400">{dashboardStats.hazardousSamples}</p>
          <p className={ds.textMuted}>Require special handling</p>
        </div>
      </div>

      {/* Experiment Pipeline */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Experiment Pipeline</h3>
        <div className={ds.grid3}>
          {ALL_STATUSES.map((s) => {
            const count = experiments.filter((i) => i.meta.status === s).length;
            return (
              <div
                key={s}
                className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30"
              >
                <span className="text-sm text-gray-300 capitalize">{s.replace(/_/g, ' ')}</span>
                <span className={ds.badge(STATUS_COLORS[s] || 'gray-400')}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent experiments */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Recent Experiments</h3>
        {experiments.length === 0 ? (
          <p className={ds.textMuted}>No experiments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {experiments.slice(0, 5).map((item) => {
              const d = item.data as unknown as Experiment;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.title}</p>
                    <p className={cn(ds.textMuted, 'text-xs truncate')}>{d.hypothesis}</p>
                  </div>
                  {renderStatusBadge(item.meta.status)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Publication tracker summary */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Publication Pipeline</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {PUB_STATUSES.map((s) => {
            const count = publications.filter((i) => {
              const d = i.data as unknown as PublicationData;
              return d.status === s || i.meta.status === s;
            }).length;
            return (
              <div key={s} className="text-center p-2 rounded-lg bg-lattice-elevated/30">
                <p className="text-lg font-bold text-white">{count}</p>
                <p className={cn(ds.textMuted, 'text-xs capitalize')}>{s.replace(/_/g, ' ')}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Equipment status overview */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Equipment Status</h3>
        <div className="space-y-2">
          {EQUIPMENT_CONDITIONS.map((c) => {
            const count = equipment.filter((i) => {
              const d = i.data as unknown as EquipmentData;
              return d.condition === c || i.meta.status === c;
            }).length;
            return (
              <div key={c} className="flex items-center gap-3">
                <span className="w-36 text-sm text-gray-400 capitalize">
                  {c.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-${STATUS_COLORS[c] || 'gray-400'} rounded-full transition-all`}
                    style={{
                      width: `${equipment.length > 0 ? (count / equipment.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
              </div>
            );
          })}
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
    <div data-lens-theme="science" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <FlaskConical className="w-7 h-7 text-neon-purple" />
          <div>
            <h1 className={ds.heading1}>Science Lab</h1>
            <p className={ds.textMuted}>
              Lab notebook, samples, equipment, data analysis, protocols &amp; publications
            </p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="science" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={ds.btnGhost} onClick={exportCSV} title="Export CSV">
            <Download className="w-4 h-4" />
          </button>
          {mode !== 'Dashboard' && (
            <button className={ds.btnPrimary} onClick={openNew}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
          )}
        </div>
      </header>

      {/* AI Actions */}
      <UniversalActions domain="science" artifactId={experiments[0]?.id} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <FlaskConical className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{experiments.length}</p>
            <p className="text-xs text-gray-500">Experiments</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <BookOpen className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{publications.length}</p>
            <p className="text-xs text-gray-500">Published</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <FileText className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">
              {publications.reduce(
                (s, p) =>
                  s + (((p.data as unknown as Record<string, unknown>)?.citations as number) || 0),
                0
              )}
            </p>
            <p className="text-xs text-gray-500">Citations</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <TestTubes className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{samples.length}</p>
            <p className="text-xs text-gray-500">Samples</p>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setMode(tab.id);
                setStatusFilter('all');
                setSearchQuery('');
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-neon-purple/20 text-neon-purple'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.id}
            </button>
          );
        })}
      </nav>

      {/* Actions bar */}
      {mode !== 'Dashboard' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
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
              {getStatusesForTab(mode).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Domain Actions */}
      {mode !== 'Dashboard' && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => handleAction('validateProtocol')} className={ds.btnSecondary}>
            <ShieldCheck className="w-4 h-4" /> Validate Protocol
          </button>
          <button onClick={() => handleAction('sampleAudit')} className={ds.btnSecondary}>
            <Archive className="w-4 h-4" /> Sample Audit
          </button>
          <button onClick={() => handleAction('calibrationCheck')} className={ds.btnSecondary}>
            <Wrench className="w-4 h-4" /> Equipment Calibration Check
          </button>
          <button onClick={() => handleAction('dataQualityReport')} className={ds.btnSecondary}>
            <Target className="w-4 h-4" /> Data Quality Report
          </button>
          {runAction.isPending && (
            <span className="text-xs text-neon-blue animate-pulse">Running...</span>
          )}
        </div>
      )}

      {/* Content */}
      {mode === 'Dashboard' ? (
        renderDashboard()
      ) : (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-neon-purple" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <FlaskConical className="w-12 h-12 text-gray-600 mx-auto mb-3" />
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
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {/* chainOfCustody */}
            {actionResult.intact !== undefined &&
              actionResult.transfers !== undefined &&
              !('equipment' in actionResult) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p
                        className={`text-sm font-bold ${actionResult.intact ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {actionResult.intact ? 'Intact' : 'Broken'}
                      </p>
                      <p className="text-[10px] text-gray-500">Chain Status</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {String(actionResult.transfers)}
                      </p>
                      <p className="text-[10px] text-gray-500">Transfers</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p
                        className={`text-sm font-bold ${Array.isArray(actionResult.gaps) && (actionResult.gaps as unknown[]).length > 0 ? 'text-red-400' : 'text-green-400'}`}
                      >
                        {Array.isArray(actionResult.gaps)
                          ? (actionResult.gaps as unknown[]).length
                          : 0}
                      </p>
                      <p className="text-[10px] text-gray-500">Gaps</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">Sample: {String(actionResult.sample)}</p>
                </div>
              )}
            {/* calibrationCheck */}
            {'equipment' in actionResult && actionResult.status !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold capitalize ${actionResult.status === 'overdue' ? 'text-red-400' : actionResult.status === 'due_soon' ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.status).replace(/_/g, ' ')}
                    </p>
                    <p className="text-[10px] text-gray-500">Calibration Status</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${actionResult.daysUntilDue !== null && Number(actionResult.daysUntilDue) < 0 ? 'text-red-400' : 'text-neon-cyan'}`}
                    >
                      {actionResult.daysUntilDue !== null
                        ? `${String(actionResult.daysUntilDue)}d`
                        : 'N/A'}
                    </p>
                    <p className="text-[10px] text-gray-500">Days Until Due</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  Next: {String(actionResult.nextCalibration || 'Not set')}
                </p>
              </div>
            )}
            {/* dataExport */}
            {actionResult.records !== undefined && actionResult.format !== undefined && (
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">{String(actionResult.records)}</p>
                  <p className="text-[10px] text-gray-500">Records Exported</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan uppercase">
                    {String(actionResult.format)}
                  </p>
                  <p className="text-[10px] text-gray-500">Format</p>
                </div>
              </div>
            )}
            {/* spatialCluster */}
            {actionResult.clusters !== undefined && Array.isArray(actionResult.clusters) && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {(actionResult.clusters as unknown[]).length}
                    </p>
                    <p className="text-[10px] text-gray-500">Clusters</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.totalObservations)}
                    </p>
                    <p className="text-[10px] text-gray-500">Observations</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.radiusKm)} km
                    </p>
                    <p className="text-[10px] text-gray-500">Radius</p>
                  </div>
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
            <div
              className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-hidden flex flex-col')}
              onClick={(e) => e.stopPropagation()}
            >
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
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
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
                    {getStatusesForTab(mode).map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-end gap-3">
                <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>
                  Cancel
                </button>
                <button className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                  <CheckCircle2 className="w-4 h-4" /> {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Data Panel */}
          {realtimeData && (
            <RealtimeDataPanel
              domain="science"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
        </div>
      )}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="science" />
      </div>

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
            <LensFeaturePanel lensId="science_fieldwork" />
          </div>
        )}
      </div>
    </div>
  );
}
