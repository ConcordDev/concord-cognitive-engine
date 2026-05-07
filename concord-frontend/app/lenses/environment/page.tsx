'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  TreePine,
  MapPin,
  Bug,
  Footprints,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  Download,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ListChecks,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Droplets,
  Leaf,
  Mountain,
  Globe,
  Shield,
  ShieldCheck,
  Calendar,
  Camera,
  Waves,
  Trees,
  Building2,
  Fish,
  Recycle,
  CheckCircle2,
  AlertOctagon,
  FlaskConical,
  Users,
  Clipboard,
  Minus,
  Zap,
  Map,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab =
  | 'Sites'
  | 'Species'
  | 'Sampling'
  | 'Trails'
  | 'Waste'
  | 'Compliance'
  | 'Carbon'
  | 'Resources'
  | 'Goals'
  | 'Map';

type ArtifactType =
  | 'Site'
  | 'Species'
  | 'EnvironmentalSample'
  | 'TrailAsset'
  | 'WasteStream'
  | 'ComplianceRecord'
  | 'CarbonEntry'
  | 'ResourceMetric'
  | 'SustainabilityGoal';
type Status = 'active' | 'monitoring' | 'critical' | 'remediation' | 'closed' | 'seasonal';

type SiteType = 'wetland' | 'forest' | 'urban' | 'marine' | 'river' | 'prairie' | 'brownfield';
type ConservationStatus = 'LC' | 'NT' | 'VU' | 'EN' | 'CR';
type PopulationTrend = 'increasing' | 'stable' | 'declining';
type TrailCondition = 'good' | 'fair' | 'poor' | 'closed';
type WasteType = 'municipal' | 'recycling' | 'hazardous' | 'organic';
type AssetType = 'sign' | 'bridge' | 'shelter' | 'restroom' | 'bench' | 'kiosk';

interface Site {
  name: string;
  siteType: SiteType;
  lat: number;
  lon: number;
  areaAcres: number;
  landUse: string;
  regulatoryStatus: string;
  samplingSchedule: string;
  manager: string;
  designation: string;
  elevationFt: number;
  watershed: string;
  ecoregion: string;
  notes: string;
}

interface SpeciesRecord {
  commonName: string;
  scientificName: string;
  category: string;
  conservationStatus: ConservationStatus;
  populationTrend: PopulationTrend;
  habitat: string;
  observationDate: string;
  observationLocation: string;
  count: number;
  behavior: string;
  photoLogRef: string;
  lat: number;
  lon: number;
  observer: string;
  notes: string;
}

interface EnvironmentalSample {
  sampleId: string;
  parameter: string;
  value: number;
  unit: string;
  referenceStandard: string;
  referenceLimit: number;
  exceedance: boolean;
  medium: string;
  collectionDate: string;
  collectionTime: string;
  location: string;
  lat: number;
  lon: number;
  collector: string;
  chainOfCustody: string;
  labId: string;
  analysisMethod: string;
  qualityFlag: string;
  notes: string;
}

interface TrailAsset {
  name: string;
  assetCategory: string;
  assetType: AssetType | string;
  length: number;
  condition: TrailCondition;
  surface: string;
  difficulty: string;
  lastInspected: string;
  nextMaintenance: string;
  workOrderId: string;
  workOrderStatus: string;
  visitorCountEstimate: number;
  features: string[];
  lat: number;
  lon: number;
  notes: string;
}

interface WasteStream {
  name: string;
  wasteType: WasteType;
  source: string;
  tonnageMonthly: number;
  diversionRate: number;
  contaminationRate: number;
  hauler: string;
  haulerContract: string;
  disposalMethod: string;
  facilityName: string;
  complianceFramework: string;
  lastPickup: string;
  nextPickup: string;
  notes: string;
}

interface ComplianceRecord {
  permitNumber: string;
  permitType: string;
  issuingAgency: string;
  issueDate: string;
  expirationDate: string;
  conditions: string;
  inspectionSchedule: string;
  lastInspection: string;
  nextInspection: string;
  violationHistory: string;
  correctiveAction: string;
  correspondenceLog: string;
  complianceScore: number;
  responsibleParty: string;
  notes: string;
}

interface CarbonEntry {
  category: string;
  source: string;
  emissionsTonsCO2e: number;
  scope: string;
  reportingPeriod: string;
  methodology: string;
  verificationStatus: string;
  reductionTarget: number;
  notes: string;
}

interface ResourceMetric {
  resourceType: string;
  metricName: string;
  value: number;
  unit: string;
  measurementDate: string;
  location: string;
  baseline: number;
  target: number;
  trend: string;
  notes: string;
}

interface SustainabilityGoal {
  goalName: string;
  category: string;
  description: string;
  targetDate: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  responsible: string;
  milestones: string;
  notes: string;
}

type ArtifactData =
  | Site
  | SpeciesRecord
  | EnvironmentalSample
  | TrailAsset
  | WasteStream
  | ComplianceRecord
  | CarbonEntry
  | ResourceMetric
  | SustainabilityGoal;

const MODE_TABS: {
  id: ModeTab;
  icon: typeof TreePine;
  artifactType: ArtifactType;
  label: string;
}[] = [
  { id: 'Sites', icon: MapPin, artifactType: 'Site', label: 'Site Manager' },
  { id: 'Species', icon: Bug, artifactType: 'Species', label: 'Species Survey' },
  { id: 'Sampling', icon: FlaskConical, artifactType: 'EnvironmentalSample', label: 'Sampling' },
  { id: 'Trails', icon: Footprints, artifactType: 'TrailAsset', label: 'Trails & Assets' },
  { id: 'Waste', icon: Recycle, artifactType: 'WasteStream', label: 'Waste Mgmt' },
  { id: 'Compliance', icon: ShieldCheck, artifactType: 'ComplianceRecord', label: 'Compliance' },
  { id: 'Carbon', icon: Globe, artifactType: 'CarbonEntry', label: 'Carbon Tracker' },
  { id: 'Resources', icon: Droplets, artifactType: 'ResourceMetric', label: 'Resources' },
  { id: 'Goals', icon: Leaf, artifactType: 'SustainabilityGoal', label: 'Goals' },
  { id: 'Map', icon: Map, artifactType: 'Site', label: 'Map' },
];

const ALL_STATUSES: Status[] = [
  'active',
  'monitoring',
  'critical',
  'remediation',
  'closed',
  'seasonal',
];

const STATUS_COLORS: Record<Status, string> = {
  active: 'green-400',
  monitoring: 'emerald-500',
  critical: 'red-400',
  remediation: 'orange-400',
  closed: 'gray-400',
  seasonal: 'neon-purple',
};

const SITE_TYPES: SiteType[] = [
  'wetland',
  'forest',
  'urban',
  'marine',
  'river',
  'prairie',
  'brownfield',
];

const SITE_TYPE_ICONS: Record<SiteType, typeof Waves> = {
  wetland: Waves,
  forest: Trees,
  urban: Building2,
  marine: Fish,
  river: Droplets,
  prairie: Leaf,
  brownfield: Mountain,
};

const CONSERVATION_LABELS: Record<ConservationStatus, { label: string; color: string }> = {
  LC: { label: 'Least Concern', color: 'green-400' },
  NT: { label: 'Near Threatened', color: 'neon-cyan' },
  VU: { label: 'Vulnerable', color: 'orange-400' },
  EN: { label: 'Endangered', color: 'red-400' },
  CR: { label: 'Critically Endangered', color: 'red-500' },
};

const TREND_ICONS: Record<PopulationTrend, { icon: typeof TrendingUp; color: string }> = {
  increasing: { icon: TrendingUp, color: 'text-green-400' },
  stable: { icon: Minus, color: 'text-emerald-500' },
  declining: { icon: TrendingDown, color: 'text-red-400' },
};

const CONDITION_COLORS: Record<TrailCondition, string> = {
  good: 'green-400',
  fair: 'orange-400',
  poor: 'red-400',
  closed: 'gray-400',
};

const SAMPLE_PARAMETERS = [
  'pH',
  'Dissolved Oxygen',
  'Turbidity',
  'Temperature',
  'Lead',
  'Mercury',
  'Arsenic',
  'Nitrate',
  'Phosphate',
  'BOD',
  'COD',
  'TSS',
  'Conductivity',
  'Coliform',
];

const DOMAIN_ACTIONS = [
  {
    id: 'population_trend',
    label: 'Population Trend Analysis',
    icon: TrendingUp,
    description: 'Analyze species population trends over time',
  },
  {
    id: 'compliance_check',
    label: 'Compliance Check',
    icon: ShieldCheck,
    description: 'Run regulatory compliance verification',
  },
  {
    id: 'diversion_calc',
    label: 'Diversion Rate Calc',
    icon: Recycle,
    description: 'Calculate waste diversion metrics',
  },
  {
    id: 'trail_report',
    label: 'Trail Condition Report',
    icon: Footprints,
    description: 'Generate trail condition summary',
  },
  {
    id: 'water_quality',
    label: 'Water Quality Summary',
    icon: Droplets,
    description: 'Summarize water quality parameters',
  },
];

const CARBON_CATEGORIES = [
  'Transport',
  'Energy',
  'Waste',
  'Industrial',
  'Agriculture',
  'Buildings',
  'Other',
];
const CARBON_SCOPES = [
  'Scope 1 - Direct',
  'Scope 2 - Indirect (Energy)',
  'Scope 3 - Other Indirect',
];
const RESOURCE_TYPES = ['Water', 'Energy', 'Waste', 'Materials', 'Land'];
const GOAL_CATEGORIES = [
  'Emissions Reduction',
  'Water Conservation',
  'Waste Diversion',
  'Renewable Energy',
  'Biodiversity',
  'Sustainability Certification',
  'Other',
];

const seedData: Record<
  ArtifactType,
  { title: string; data: Record<string, unknown>; meta: Record<string, unknown> }[]
> = {
  Site: [],
  Species: [],
  EnvironmentalSample: [],
  TrailAsset: [],
  WasteStream: [],
  ComplianceRecord: [],
  CarbonEntry: [],
  ResourceMetric: [],
  SustainabilityGoal: [],
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EnvironmentLensPage() {
  const [mode, setMode] = useState<ModeTab>('Sites');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'dashboard' | 'actions'>('library');
  const [detailItem, setDetailItem] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const currentType = MODE_TABS.find((t) => t.id === mode)!.artifactType;

  /* ---- data hooks for each artifact type ---- */
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactData>('environment', currentType, {
      seed: seedData[currentType] || [],
    });

  const { items: siteItems } = useLensData<Site>('environment', 'Site', { seed: [] });
  const { items: speciesItems } = useLensData<SpeciesRecord>('environment', 'Species', {
    seed: [],
  });
  const { items: sampleItems } = useLensData<EnvironmentalSample>(
    'environment',
    'EnvironmentalSample',
    { seed: [] }
  );
  const { items: trailItems } = useLensData<TrailAsset>('environment', 'TrailAsset', { seed: [] });
  const { items: wasteItems } = useLensData<WasteStream>('environment', 'WasteStream', {
    seed: [],
  });
  const { items: complianceItems } = useLensData<ComplianceRecord>(
    'environment',
    'ComplianceRecord',
    { seed: [] }
  );
  const { items: carbonItems } = useLensData<CarbonEntry>('environment', 'CarbonEntry', {
    seed: [],
  });
  const { items: resourceItems } = useLensData<ResourceMetric>('environment', 'ResourceMetric', {
    seed: [],
  });
  const { items: goalItems } = useLensData<SustainabilityGoal>(
    'environment',
    'SustainabilityGoal',
    { seed: [] }
  );

  const runAction = useRunArtifact('environment');
  const editingItem = items.find((i) => i.id === editingId) || null;

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => {
        const d = i.data as unknown as Record<string, unknown>;
        const titleMatch = i.title.toLowerCase().includes(q);
        const dataMatch = Object.values(d).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(q)
        );
        return titleMatch || dataMatch;
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
    setFormStatus('active');
    setFormData({});
    setShowEditor(true);
  }, []);

  const openEdit = useCallback((item: LensItem<ArtifactData>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus((item.meta.status as Status) || 'active');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  }, []);

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
    if (detailItem === id) setDetailItem(null);
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
    }
  };

  /* ---- computed stats ---- */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_STATUSES.forEach((s) => {
      counts[s] = 0;
    });
    items.forEach((i) => {
      const s = i.meta.status as string;
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [items]);

  const dashboardStats = useMemo(() => {
    const activeSites = siteItems.filter((i) => i.meta.status === 'active').length;
    const totalSpecies = speciesItems.length;
    const endangeredSpecies = speciesItems.filter((i) => {
      const d = i.data as unknown as SpeciesRecord;
      return d.conservationStatus === 'EN' || d.conservationStatus === 'CR';
    }).length;
    const pendingSamples = sampleItems.filter((i) => i.meta.status === 'monitoring').length;
    const exceedances = sampleItems.filter((i) => {
      const d = i.data as unknown as EnvironmentalSample;
      return d.exceedance;
    }).length;
    const trailMiles = trailItems.reduce((sum, i) => {
      const d = i.data as unknown as TrailAsset;
      return sum + (d.length || 0);
    }, 0);
    const trailsClosed = trailItems.filter((i) => {
      const d = i.data as unknown as TrailAsset;
      return d.condition === 'closed';
    }).length;
    const totalWasteTonnage = wasteItems.reduce((sum, i) => {
      const d = i.data as unknown as WasteStream;
      return sum + (d.tonnageMonthly || 0);
    }, 0);
    const avgDiversion =
      wasteItems.length > 0
        ? wasteItems.reduce((sum, i) => {
            const d = i.data as unknown as WasteStream;
            return sum + (d.diversionRate || 0);
          }, 0) / wasteItems.length
        : 0;
    const avgCompliance =
      complianceItems.length > 0
        ? complianceItems.reduce((sum, i) => {
            const d = i.data as unknown as ComplianceRecord;
            return sum + (d.complianceScore || 0);
          }, 0) / complianceItems.length
        : 0;
    const upcomingInspections = complianceItems.filter((i) => {
      const d = i.data as unknown as ComplianceRecord;
      if (!d.nextInspection) return false;
      const next = new Date(d.nextInspection);
      const now = new Date();
      const diffDays = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 30;
    }).length;
    const expiredPermits = complianceItems.filter((i) => {
      const d = i.data as unknown as ComplianceRecord;
      if (!d.expirationDate) return false;
      return new Date(d.expirationDate) < new Date();
    }).length;

    const totalCarbon = carbonItems.reduce((sum, i) => {
      const d = i.data as unknown as CarbonEntry;
      return sum + (d.emissionsTonsCO2e || 0);
    }, 0);
    const carbonByCategory: Record<string, number> = {};
    carbonItems.forEach((i) => {
      const d = i.data as unknown as CarbonEntry;
      const cat = d.category || 'Other';
      carbonByCategory[cat] = (carbonByCategory[cat] || 0) + (d.emissionsTonsCO2e || 0);
    });
    const totalGoals = goalItems.length;
    const completedGoals = goalItems.filter((i) => {
      const d = i.data as unknown as SustainabilityGoal;
      return (d.progress || 0) >= 100;
    }).length;
    const avgGoalProgress =
      goalItems.length > 0
        ? goalItems.reduce(
            (sum, i) => sum + ((i.data as unknown as SustainabilityGoal).progress || 0),
            0
          ) / goalItems.length
        : 0;

    const totalResources = resourceItems.length;
    const avgResourceValue =
      resourceItems.length > 0
        ? resourceItems.reduce(
            (sum, i) => sum + ((i.data as unknown as ResourceMetric).value || 0),
            0
          ) / resourceItems.length
        : 0;

    return {
      activeSites,
      totalSpecies,
      endangeredSpecies,
      pendingSamples,
      exceedances,
      trailMiles,
      trailsClosed,
      totalWasteTonnage,
      avgDiversion,
      avgCompliance,
      upcomingInspections,
      expiredPermits,
      totalCarbon,
      carbonByCategory,
      totalGoals,
      completedGoals,
      avgGoalProgress,
      totalResources,
      avgResourceValue,
    };
  }, [
    siteItems,
    speciesItems,
    sampleItems,
    trailItems,
    wasteItems,
    complianceItems,
    carbonItems,
    resourceItems,
    goalItems,
  ]);

  /* ---- export geojson ---- */
  const exportGeoJSON = () => {
    const features = items
      .filter((i) => {
        const d = i.data as unknown as Record<string, unknown>;
        return d.lat && d.lon;
      })
      .map((i) => {
        const d = i.data as unknown as Record<string, unknown>;
        return {
          type: 'Feature' as const,
          properties: { title: i.title, status: i.meta.status, type: currentType },
          geometry: { type: 'Point' as const, coordinates: [d.lon as number, d.lat as number] },
        };
      });
    const geojson = { type: 'FeatureCollection', features };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `environment-${currentType.toLowerCase()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---- export CSV ---- */
  const exportCSV = () => {
    if (items.length === 0) return;
    const allKeys = new Set<string>();
    items.forEach((i) => {
      const d = i.data as unknown as Record<string, unknown>;
      Object.keys(d).forEach((k) => allKeys.add(k));
    });
    const headers = ['title', 'status', ...Array.from(allKeys)];
    const rows = items.map((i) => {
      const d = i.data as unknown as Record<string, unknown>;
      return headers
        .map((h) => {
          if (h === 'title') return i.title;
          if (h === 'status') return i.meta.status;
          const val = d[h];
          if (Array.isArray(val)) return val.join('; ');
          return String(val ?? '');
        })
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `environment-${currentType.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---- status badge ---- */
  const renderStatusBadge = (status: string) => {
    const color = STATUS_COLORS[status as Status] || 'gray-400';
    return <span className={ds.badge(color)}>{status}</span>;
  };

  /* ---- conservation badge ---- */
  const renderConservationBadge = (cs: ConservationStatus) => {
    const info = CONSERVATION_LABELS[cs];
    if (!info) return null;
    return (
      <span className={ds.badge(info.color)}>
        {cs} - {info.label}
      </span>
    );
  };

  /* ---- trend indicator ---- */
  const renderTrendIndicator = (trend: PopulationTrend) => {
    const info = TREND_ICONS[trend];
    if (!info) return null;
    const Icon = info.icon;
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs', info.color)}>
        <Icon className="w-3.5 h-3.5" /> {trend}
      </span>
    );
  };

  /* ---- condition badge ---- */
  const renderConditionBadge = (condition: TrailCondition) => {
    const color = CONDITION_COLORS[condition] || 'gray-400';
    return <span className={ds.badge(color)}>{condition}</span>;
  };

  /* ---- exceedance indicator ---- */
  const renderExceedance = (sample: EnvironmentalSample) => {
    if (sample.exceedance) {
      return (
        <span className={cn(ds.badge('red-400'), 'animate-pulse')}>
          <AlertTriangle className="w-3 h-3" /> EXCEEDANCE
        </span>
      );
    }
    return (
      <span className={ds.badge('green-400')}>
        <CheckCircle2 className="w-3 h-3" /> Within Limits
      </span>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Form Fields per Artifact Type                                    */
  /* ---------------------------------------------------------------- */
  const renderFormFields = () => {
    switch (currentType) {
      case 'Site':
        return (
          <div data-lens-theme="environment" className="space-y-4">
            <div>
              <label className={ds.label}>Site Name</label>
              <input
                className={ds.input}
                value={(formData.name as string) || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Cedar Creek Wetland"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Site Type</label>
                <select
                  className={ds.select}
                  value={(formData.siteType as string) || ''}
                  onChange={(e) => setFormData({ ...formData, siteType: e.target.value })}
                >
                  <option value="">Select type...</option>
                  {SITE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Designation</label>
                <input
                  className={ds.input}
                  value={(formData.designation as string) || ''}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  placeholder="e.g. State Park, CERCLA Site"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lat as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lat: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lon as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lon: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Area (acres)</label>
                <input
                  type="number"
                  step="0.1"
                  className={ds.input}
                  value={(formData.areaAcres as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, areaAcres: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Elevation (ft)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.elevationFt as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, elevationFt: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Land Use</label>
                <select
                  className={ds.select}
                  value={(formData.landUse as string) || ''}
                  onChange={(e) => setFormData({ ...formData, landUse: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Conservation">Conservation</option>
                  <option value="Recreation">Recreation</option>
                  <option value="Research">Research</option>
                  <option value="Mixed Use">Mixed Use</option>
                  <option value="Restoration">Restoration</option>
                  <option value="Industrial Remediation">Industrial Remediation</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Regulatory Status</label>
                <select
                  className={ds.select}
                  value={(formData.regulatoryStatus as string) || ''}
                  onChange={(e) => setFormData({ ...formData, regulatoryStatus: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Permitted">Permitted</option>
                  <option value="Under Review">Under Review</option>
                  <option value="Compliant">Compliant</option>
                  <option value="Non-Compliant">Non-Compliant</option>
                  <option value="Exempt">Exempt</option>
                  <option value="Pending Permit">Pending Permit</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Sampling Schedule</label>
                <select
                  className={ds.select}
                  value={(formData.samplingSchedule as string) || ''}
                  onChange={(e) => setFormData({ ...formData, samplingSchedule: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Biweekly">Biweekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annually">Annually</option>
                  <option value="Event-based">Event-based</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Managing Entity</label>
                <input
                  className={ds.input}
                  value={(formData.manager as string) || ''}
                  onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Watershed</label>
                <input
                  className={ds.input}
                  value={(formData.watershed as string) || ''}
                  onChange={(e) => setFormData({ ...formData, watershed: e.target.value })}
                  placeholder="e.g. Upper Mississippi"
                />
              </div>
              <div>
                <label className={ds.label}>Ecoregion</label>
                <input
                  className={ds.input}
                  value={(formData.ecoregion as string) || ''}
                  onChange={(e) => setFormData({ ...formData, ecoregion: e.target.value })}
                  placeholder="e.g. Central Great Plains"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.notes as string) || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional site information..."
              />
            </div>
          </div>
        );

      case 'Species':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Common Name</label>
                <input
                  className={ds.input}
                  value={(formData.commonName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, commonName: e.target.value })}
                  placeholder="e.g. Red-tailed Hawk"
                />
              </div>
              <div>
                <label className={ds.label}>Scientific Name</label>
                <input
                  className={cn(ds.input, 'italic')}
                  value={(formData.scientificName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, scientificName: e.target.value })}
                  placeholder="e.g. Buteo jamaicensis"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Category</label>
                <select
                  className={ds.select}
                  value={(formData.category as string) || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Mammal">Mammal</option>
                  <option value="Bird">Bird</option>
                  <option value="Reptile">Reptile</option>
                  <option value="Amphibian">Amphibian</option>
                  <option value="Fish">Fish</option>
                  <option value="Insect">Insect</option>
                  <option value="Arachnid">Arachnid</option>
                  <option value="Mollusk">Mollusk</option>
                  <option value="Crustacean">Crustacean</option>
                  <option value="Plant - Tree">Plant - Tree</option>
                  <option value="Plant - Shrub">Plant - Shrub</option>
                  <option value="Plant - Herbaceous">Plant - Herbaceous</option>
                  <option value="Fungi">Fungi</option>
                  <option value="Lichen">Lichen</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Conservation Status (IUCN)</label>
                <select
                  className={ds.select}
                  value={(formData.conservationStatus as string) || ''}
                  onChange={(e) => setFormData({ ...formData, conservationStatus: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="LC">LC - Least Concern</option>
                  <option value="NT">NT - Near Threatened</option>
                  <option value="VU">VU - Vulnerable</option>
                  <option value="EN">EN - Endangered</option>
                  <option value="CR">CR - Critically Endangered</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Population Trend</label>
                <select
                  className={ds.select}
                  value={(formData.populationTrend as string) || ''}
                  onChange={(e) => setFormData({ ...formData, populationTrend: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="increasing">Increasing</option>
                  <option value="stable">Stable</option>
                  <option value="declining">Declining</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Count Observed</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.count as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, count: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Habitat</label>
              <input
                className={ds.input}
                value={(formData.habitat as string) || ''}
                onChange={(e) => setFormData({ ...formData, habitat: e.target.value })}
                placeholder="e.g. Riparian woodland, open grassland"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Observation Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.observationDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, observationDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Observation Location</label>
                <input
                  className={ds.input}
                  value={(formData.observationLocation as string) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, observationLocation: e.target.value })
                  }
                  placeholder="Site or GPS reference"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lat as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lat: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lon as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lon: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Behavior Observed</label>
              <input
                className={ds.input}
                value={(formData.behavior as string) || ''}
                onChange={(e) => setFormData({ ...formData, behavior: e.target.value })}
                placeholder="e.g. Foraging, nesting, migrating"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Observer</label>
                <input
                  className={ds.input}
                  value={(formData.observer as string) || ''}
                  onChange={(e) => setFormData({ ...formData, observer: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Photo Log Reference</label>
                <div className="flex gap-2">
                  <input
                    className={ds.input}
                    value={(formData.photoLogRef as string) || ''}
                    onChange={(e) => setFormData({ ...formData, photoLogRef: e.target.value })}
                    placeholder="Photo ID or file ref"
                  />
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.click();
                    }}
                    className={ds.btnGhost}
                    title="Attach photo"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.notes as string) || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional observation notes..."
              />
            </div>
          </div>
        );

      case 'EnvironmentalSample':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Sample ID</label>
                <input
                  className={cn(ds.input, 'font-mono')}
                  value={(formData.sampleId as string) || ''}
                  onChange={(e) => setFormData({ ...formData, sampleId: e.target.value })}
                  placeholder="e.g. WQ-2026-0045"
                />
              </div>
              <div>
                <label className={ds.label}>Medium</label>
                <select
                  className={ds.select}
                  value={(formData.medium as string) || ''}
                  onChange={(e) => setFormData({ ...formData, medium: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Surface Water">Surface Water</option>
                  <option value="Groundwater">Groundwater</option>
                  <option value="Soil">Soil</option>
                  <option value="Air">Air</option>
                  <option value="Sediment">Sediment</option>
                  <option value="Stormwater">Stormwater</option>
                  <option value="Effluent">Effluent</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Parameter</label>
                <select
                  className={ds.select}
                  value={(formData.parameter as string) || ''}
                  onChange={(e) => setFormData({ ...formData, parameter: e.target.value })}
                >
                  <option value="">Select parameter...</option>
                  {SAMPLE_PARAMETERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="Other">Other (specify in notes)</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Analysis Method</label>
                <input
                  className={ds.input}
                  value={(formData.analysisMethod as string) || ''}
                  onChange={(e) => setFormData({ ...formData, analysisMethod: e.target.value })}
                  placeholder="e.g. EPA 200.8, SM 2540D"
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Measurement Value</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.value as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Unit</label>
                <select
                  className={ds.select}
                  value={(formData.unit as string) || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="mg/L">mg/L</option>
                  <option value="ug/L">ug/L</option>
                  <option value="pH units">pH units</option>
                  <option value="NTU">NTU</option>
                  <option value="deg C">deg C</option>
                  <option value="deg F">deg F</option>
                  <option value="ppm">ppm</option>
                  <option value="ppb">ppb</option>
                  <option value="CFU/100mL">CFU/100mL</option>
                  <option value="uS/cm">uS/cm</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Quality Flag</label>
                <select
                  className={ds.select}
                  value={(formData.qualityFlag as string) || ''}
                  onChange={(e) => setFormData({ ...formData, qualityFlag: e.target.value })}
                >
                  <option value="">None</option>
                  <option value="J">J - Estimated</option>
                  <option value="U">U - Non-detect</option>
                  <option value="R">R - Rejected</option>
                  <option value="B">B - Blank contamination</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Reference Standard</label>
                <input
                  className={ds.input}
                  value={(formData.referenceStandard as string) || ''}
                  onChange={(e) => setFormData({ ...formData, referenceStandard: e.target.value })}
                  placeholder="e.g. EPA MCL, State WQS"
                />
              </div>
              <div>
                <label className={ds.label}>Reference Limit</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.referenceLimit as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, referenceLimit: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/30">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(formData.exceedance as boolean) || false}
                  onChange={(e) => setFormData({ ...formData, exceedance: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-600 bg-lattice-surface text-red-500 focus:ring-red-500"
                />
                <span className="text-sm text-red-400 font-medium">Exceedance Flagged</span>
              </label>
              {(formData.exceedance as boolean) && (
                <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
              )}
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
                <label className={ds.label}>Collection Time</label>
                <input
                  type="time"
                  className={ds.input}
                  value={(formData.collectionTime as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collectionTime: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Location</label>
              <input
                className={ds.input}
                value={(formData.location as string) || ''}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Sampling station or description"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lat as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lat: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lon as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lon: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Collector</label>
                <input
                  className={ds.input}
                  value={(formData.collector as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collector: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Lab ID</label>
                <input
                  className={ds.input}
                  value={(formData.labId as string) || ''}
                  onChange={(e) => setFormData({ ...formData, labId: e.target.value })}
                  placeholder="Laboratory reference"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Chain of Custody</label>
              <input
                className={ds.input}
                value={(formData.chainOfCustody as string) || ''}
                onChange={(e) => setFormData({ ...formData, chainOfCustody: e.target.value })}
                placeholder="COC tracking number"
              />
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.notes as string) || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Field observations, weather conditions..."
              />
            </div>
          </div>
        );

      case 'TrailAsset':
        return (
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Name</label>
              <input
                className={ds.input}
                value={(formData.name as string) || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Trail or asset name"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Asset Category</label>
                <select
                  className={ds.select}
                  value={(formData.assetCategory as string) || ''}
                  onChange={(e) => setFormData({ ...formData, assetCategory: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Trail">Trail</option>
                  <option value="Infrastructure">Infrastructure</option>
                  <option value="Amenity">Amenity</option>
                  <option value="Signage">Signage</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Asset Type</label>
                <select
                  className={ds.select}
                  value={(formData.assetType as string) || ''}
                  onChange={(e) => setFormData({ ...formData, assetType: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="trail">Trail Segment</option>
                  <option value="sign">Sign</option>
                  <option value="bridge">Bridge</option>
                  <option value="shelter">Shelter</option>
                  <option value="restroom">Restroom</option>
                  <option value="bench">Bench</option>
                  <option value="kiosk">Information Kiosk</option>
                </select>
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Length (miles)</label>
                <input
                  type="number"
                  step="0.1"
                  className={ds.input}
                  value={(formData.length as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, length: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Condition</label>
                <select
                  className={ds.select}
                  value={(formData.condition as string) || ''}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Difficulty</label>
                <select
                  className={ds.select}
                  value={(formData.difficulty as string) || ''}
                  onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Easy">Easy</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Strenuous">Strenuous</option>
                  <option value="Expert">Expert</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Surface</label>
                <select
                  className={ds.select}
                  value={(formData.surface as string) || ''}
                  onChange={(e) => setFormData({ ...formData, surface: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Gravel">Gravel</option>
                  <option value="Paved">Paved</option>
                  <option value="Dirt">Dirt</option>
                  <option value="Boardwalk">Boardwalk</option>
                  <option value="Rock">Rock</option>
                  <option value="Mixed">Mixed</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Visitor Count (est/month)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.visitorCountEstimate as number) ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      visitorCountEstimate: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Last Inspected</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.lastInspected as string) || ''}
                  onChange={(e) => setFormData({ ...formData, lastInspected: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Maintenance</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextMaintenance as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextMaintenance: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Work Order ID</label>
                <input
                  className={cn(ds.input, 'font-mono')}
                  value={(formData.workOrderId as string) || ''}
                  onChange={(e) => setFormData({ ...formData, workOrderId: e.target.value })}
                  placeholder="WO-XXXX"
                />
              </div>
              <div>
                <label className={ds.label}>Work Order Status</label>
                <select
                  className={ds.select}
                  value={(formData.workOrderStatus as string) || ''}
                  onChange={(e) => setFormData({ ...formData, workOrderStatus: e.target.value })}
                >
                  <option value="">None</option>
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lat as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lat: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  className={ds.input}
                  value={(formData.lon as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, lon: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Features (comma-separated)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={((formData.features as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    features: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="e.g. Scenic overlook, Waterfall, Wildlife viewing"
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
          </div>
        );

      case 'WasteStream':
        return (
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Stream Name</label>
              <input
                className={ds.input}
                value={(formData.name as string) || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Main Campus MSW"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Waste Type</label>
                <select
                  className={ds.select}
                  value={(formData.wasteType as string) || ''}
                  onChange={(e) => setFormData({ ...formData, wasteType: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="municipal">Municipal Solid Waste</option>
                  <option value="recycling">Recycling</option>
                  <option value="hazardous">Hazardous</option>
                  <option value="organic">Organic / Compost</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Source</label>
                <input
                  className={ds.input}
                  value={(formData.source as string) || ''}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  placeholder="e.g. Building A, Cafeteria"
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Monthly Tonnage</label>
                <input
                  type="number"
                  step="0.1"
                  className={ds.input}
                  value={(formData.tonnageMonthly as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, tonnageMonthly: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Diversion Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className={ds.input}
                  value={(formData.diversionRate as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, diversionRate: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Contamination Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className={ds.input}
                  value={(formData.contaminationRate as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, contaminationRate: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Hauler</label>
                <input
                  className={ds.input}
                  value={(formData.hauler as string) || ''}
                  onChange={(e) => setFormData({ ...formData, hauler: e.target.value })}
                  placeholder="Hauler company name"
                />
              </div>
              <div>
                <label className={ds.label}>Hauler Contract #</label>
                <input
                  className={cn(ds.input, 'font-mono')}
                  value={(formData.haulerContract as string) || ''}
                  onChange={(e) => setFormData({ ...formData, haulerContract: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Disposal Method</label>
                <select
                  className={ds.select}
                  value={(formData.disposalMethod as string) || ''}
                  onChange={(e) => setFormData({ ...formData, disposalMethod: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Landfill">Landfill</option>
                  <option value="MRF">Material Recovery Facility</option>
                  <option value="Composting">Composting</option>
                  <option value="Incineration">Incineration</option>
                  <option value="Recycling Center">Recycling Center</option>
                  <option value="Hazmat Treatment">Hazmat Treatment</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Facility Name</label>
                <input
                  className={ds.input}
                  value={(formData.facilityName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, facilityName: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Last Pickup</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.lastPickup as string) || ''}
                  onChange={(e) => setFormData({ ...formData, lastPickup: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Pickup</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextPickup as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextPickup: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Compliance Framework</label>
              <input
                className={ds.input}
                value={(formData.complianceFramework as string) || ''}
                onChange={(e) => setFormData({ ...formData, complianceFramework: e.target.value })}
                placeholder="e.g. RCRA, State Solid Waste Act"
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
          </div>
        );

      case 'ComplianceRecord':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Permit Number</label>
                <input
                  className={cn(ds.input, 'font-mono')}
                  value={(formData.permitNumber as string) || ''}
                  onChange={(e) => setFormData({ ...formData, permitNumber: e.target.value })}
                  placeholder="e.g. NPDES-OH-0012345"
                />
              </div>
              <div>
                <label className={ds.label}>Permit Type</label>
                <select
                  className={ds.select}
                  value={(formData.permitType as string) || ''}
                  onChange={(e) => setFormData({ ...formData, permitType: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="NPDES">NPDES (Water Discharge)</option>
                  <option value="Air Quality">Air Quality Permit</option>
                  <option value="Stormwater">Stormwater (MS4/CGP)</option>
                  <option value="Wetland 404">Wetland 404 Permit</option>
                  <option value="RCRA">RCRA (Hazardous Waste)</option>
                  <option value="UST">Underground Storage Tank</option>
                  <option value="Remediation">Remediation/Cleanup</option>
                  <option value="Land Use">Land Use / Zoning</option>
                  <option value="Endangered Species">Endangered Species (ESA)</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Issuing Agency</label>
                <input
                  className={ds.input}
                  value={(formData.issuingAgency as string) || ''}
                  onChange={(e) => setFormData({ ...formData, issuingAgency: e.target.value })}
                  placeholder="e.g. US EPA Region 5, State DEQ"
                />
              </div>
              <div>
                <label className={ds.label}>Responsible Party</label>
                <input
                  className={ds.input}
                  value={(formData.responsibleParty as string) || ''}
                  onChange={(e) => setFormData({ ...formData, responsibleParty: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Issue Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.issueDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
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
            <div>
              <label className={ds.label}>Permit Conditions</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.conditions as string) || ''}
                onChange={(e) => setFormData({ ...formData, conditions: e.target.value })}
                placeholder="Key conditions, limits, and requirements..."
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Inspection Schedule</label>
                <select
                  className={ds.select}
                  value={(formData.inspectionSchedule as string) || ''}
                  onChange={(e) => setFormData({ ...formData, inspectionSchedule: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Semi-Annual">Semi-Annual</option>
                  <option value="Annual">Annual</option>
                  <option value="Biennial">Biennial</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Last Inspection</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.lastInspection as string) || ''}
                  onChange={(e) => setFormData({ ...formData, lastInspection: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Inspection</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextInspection as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextInspection: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Compliance Score (0-100)</label>
              <input
                type="number"
                min="0"
                max="100"
                className={ds.input}
                value={(formData.complianceScore as number) ?? ''}
                onChange={(e) =>
                  setFormData({ ...formData, complianceScore: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Violation History</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.violationHistory as string) || ''}
                onChange={(e) => setFormData({ ...formData, violationHistory: e.target.value })}
                placeholder="Past violations and dates..."
              />
            </div>
            <div>
              <label className={ds.label}>Corrective Action Plan</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.correctiveAction as string) || ''}
                onChange={(e) => setFormData({ ...formData, correctiveAction: e.target.value })}
                placeholder="Required corrective actions..."
              />
            </div>
            <div>
              <label className={ds.label}>Correspondence Log</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.correspondenceLog as string) || ''}
                onChange={(e) => setFormData({ ...formData, correspondenceLog: e.target.value })}
                placeholder="Agency correspondence history..."
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
          </div>
        );

      case 'CarbonEntry':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Category</label>
                <select
                  className={ds.select}
                  value={(formData.category as string) || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Select category...</option>
                  {CARBON_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Scope</label>
                <select
                  className={ds.select}
                  value={(formData.scope as string) || ''}
                  onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                >
                  <option value="">Select scope...</option>
                  {CARBON_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={ds.label}>Emission Source</label>
              <input
                className={ds.input}
                value={(formData.source as string) || ''}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="e.g. Fleet vehicles, Office electricity"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Emissions (tons CO2e)</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.emissionsTonsCO2e as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, emissionsTonsCO2e: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Reduction Target (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className={ds.input}
                  value={(formData.reductionTarget as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, reductionTarget: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Reporting Period</label>
                <input
                  className={ds.input}
                  value={(formData.reportingPeriod as string) || ''}
                  onChange={(e) => setFormData({ ...formData, reportingPeriod: e.target.value })}
                  placeholder="e.g. Q1 2026, FY 2025"
                />
              </div>
              <div>
                <label className={ds.label}>Methodology</label>
                <input
                  className={ds.input}
                  value={(formData.methodology as string) || ''}
                  onChange={(e) => setFormData({ ...formData, methodology: e.target.value })}
                  placeholder="e.g. GHG Protocol, ISO 14064"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Verification Status</label>
              <select
                className={ds.select}
                value={(formData.verificationStatus as string) || ''}
                onChange={(e) => setFormData({ ...formData, verificationStatus: e.target.value })}
              >
                <option value="">Select...</option>
                <option value="Unverified">Unverified</option>
                <option value="Self-assessed">Self-assessed</option>
                <option value="Third-party Verified">Third-party Verified</option>
                <option value="Audited">Audited</option>
              </select>
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
          </div>
        );

      case 'ResourceMetric':
        return (
          <div className="space-y-4">
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Resource Type</label>
                <select
                  className={ds.select}
                  value={(formData.resourceType as string) || ''}
                  onChange={(e) => setFormData({ ...formData, resourceType: e.target.value })}
                >
                  <option value="">Select...</option>
                  {RESOURCE_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Metric Name</label>
                <input
                  className={ds.input}
                  value={(formData.metricName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, metricName: e.target.value })}
                  placeholder="e.g. Monthly Water Usage, kWh Consumed"
                />
              </div>
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Value</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.value as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Unit</label>
                <select
                  className={ds.select}
                  value={(formData.unit as string) || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="gallons">Gallons</option>
                  <option value="liters">Liters</option>
                  <option value="kWh">kWh</option>
                  <option value="MWh">MWh</option>
                  <option value="therms">Therms</option>
                  <option value="tons">Tons</option>
                  <option value="lbs">Pounds</option>
                  <option value="cu ft">Cubic Feet</option>
                  <option value="acres">Acres</option>
                </select>
              </div>
              <div>
                <label className={ds.label}>Measurement Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.measurementDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, measurementDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Location</label>
              <input
                className={ds.input}
                value={(formData.location as string) || ''}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Measurement location"
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Baseline</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.baseline as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, baseline: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Target</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.target as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, target: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Trend</label>
                <select
                  className={ds.select}
                  value={(formData.trend as string) || ''}
                  onChange={(e) => setFormData({ ...formData, trend: e.target.value })}
                >
                  <option value="">Select...</option>
                  <option value="increasing">Increasing</option>
                  <option value="stable">Stable</option>
                  <option value="declining">Declining</option>
                </select>
              </div>
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
          </div>
        );

      case 'SustainabilityGoal':
        return (
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Goal Name</label>
              <input
                className={ds.input}
                value={(formData.goalName as string) || ''}
                onChange={(e) => setFormData({ ...formData, goalName: e.target.value })}
                placeholder="e.g. Net Zero by 2030"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Category</label>
                <select
                  className={ds.select}
                  value={(formData.category as string) || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Select category...</option>
                  {GOAL_CATEGORIES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Target Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.targetDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.description as string) || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the sustainability goal..."
              />
            </div>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label}>Target Value</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.targetValue as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, targetValue: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Current Value</label>
                <input
                  type="number"
                  step="0.01"
                  className={ds.input}
                  value={(formData.currentValue as number) ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, currentValue: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Unit</label>
                <input
                  className={ds.input}
                  value={(formData.unit as string) || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="e.g. tons CO2e, %, kWh"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Progress (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className={ds.input}
                value={(formData.progress as number) ?? ''}
                onChange={(e) =>
                  setFormData({ ...formData, progress: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Responsible Party</label>
              <input
                className={ds.input}
                value={(formData.responsible as string) || ''}
                onChange={(e) => setFormData({ ...formData, responsible: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Milestones (comma-separated)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.milestones as string) || ''}
                onChange={(e) => setFormData({ ...formData, milestones: e.target.value })}
                placeholder="e.g. Phase 1: Audit complete, Phase 2: 25% reduction..."
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
          </div>
        );

      default:
        return null;
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Artifact Card Renderer                                           */
  /* ---------------------------------------------------------------- */
  const renderCard = (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div
        key={item.id}
        className={cn(ds.panelHover, 'group relative')}
        onClick={() => setDetailItem(detailItem === item.id ? null : item.id)}
      >
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'truncate pr-2')}>{item.title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            {renderStatusBadge(item.meta.status as string)}
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          {currentType === 'Site' &&
            (() => {
              const siteType = (d.siteType as SiteType) || 'forest';
              const SiteIcon = SITE_TYPE_ICONS[siteType] || Mountain;
              return (
                <>
                  <div className="flex items-center gap-2">
                    <SiteIcon className="w-4 h-4 text-green-400 shrink-0" />
                    <span className={ds.textMuted}>
                      {(d.siteType as string) || 'Unknown'} -{' '}
                      {(d.designation as string) || 'No designation'}
                    </span>
                  </div>
                  <p className={ds.textMuted}>
                    {(d.areaAcres as number) || 0} acres | {(d.landUse as string) || 'N/A'}
                  </p>
                  <p className={ds.textMuted}>
                    Regulatory: {(d.regulatoryStatus as string) || 'N/A'}
                  </p>
                  <p className={ds.textMuted}>
                    Schedule: {(d.samplingSchedule as string) || 'N/A'}
                  </p>
                  {Boolean(d.lat) && Boolean(d.lon) && (
                    <p className={cn(ds.textMono, 'text-gray-500 text-xs')}>
                      {(d.lat as number).toFixed(6)}, {(d.lon as number).toFixed(6)}
                    </p>
                  )}
                </>
              );
            })()}

          {currentType === 'Species' && (
            <>
              <p className={cn(ds.textMuted, 'italic')}>{d.scientificName as string}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={ds.badge('neon-cyan')}>{d.category as string}</span>
                {Boolean(d.conservationStatus) &&
                  renderConservationBadge(d.conservationStatus as ConservationStatus)}
              </div>
              <div className="flex items-center gap-3">
                {Boolean(d.populationTrend) &&
                  renderTrendIndicator(d.populationTrend as PopulationTrend)}
                {d.count !== undefined && d.count !== null && (
                  <span className={ds.textMuted}>Count: {d.count as number}</span>
                )}
              </div>
              <p className={ds.textMuted}>Habitat: {(d.habitat as string) || 'N/A'}</p>
              {Boolean(d.behavior) && (
                <p className={ds.textMuted}>Behavior: {d.behavior as string}</p>
              )}
              {Boolean(d.observationDate) && (
                <p className={cn(ds.textMono, 'text-gray-500 text-xs')}>
                  Observed: {d.observationDate as string}
                </p>
              )}
              {Boolean(d.photoLogRef) && (
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Camera className="w-3 h-3" />
                  <span>{d.photoLogRef as string}</span>
                </div>
              )}
            </>
          )}

          {currentType === 'EnvironmentalSample' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-500 text-xs')}>{d.sampleId as string}</p>
              <div className="flex items-center gap-2">
                <span className={ds.badge('emerald-500')}>{d.medium as string}</span>
                <span className={ds.textMuted}>{d.parameter as string}</span>
              </div>
              <p className={cn(ds.heading3, 'text-base')}>
                {d.value as number} <span className={ds.textMuted}>{d.unit as string}</span>
                {d.referenceLimit !== undefined && d.referenceLimit !== null && (
                  <span className={cn(ds.textMuted, 'text-xs ml-2')}>
                    (limit: {d.referenceLimit as number} {d.unit as string})
                  </span>
                )}
              </p>
              {renderExceedance(d as unknown as EnvironmentalSample)}
              {Boolean(d.chainOfCustody) && (
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Clipboard className="w-3 h-3" />
                  <span>COC: {d.chainOfCustody as string}</span>
                </div>
              )}
              <p className={ds.textMuted}>
                {d.location as string} | {d.collectionDate as string}
              </p>
            </>
          )}

          {currentType === 'TrailAsset' && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.assetCategory) && (
                  <span className={ds.badge('neon-cyan')}>{d.assetCategory as string}</span>
                )}
                {Boolean(d.condition) && renderConditionBadge(d.condition as TrailCondition)}
                {Boolean(d.difficulty) && (
                  <span className={ds.badge('neon-purple')}>{d.difficulty as string}</span>
                )}
              </div>
              {(d.length as number) > 0 && (
                <p className={ds.textMuted}>
                  {d.length as number} mi | Surface: {(d.surface as string) || 'N/A'}
                </p>
              )}
              {(d.visitorCountEstimate as number) > 0 && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Users className="w-3 h-3" />
                  <span>
                    {(d.visitorCountEstimate as number).toLocaleString()} visitors/mo est.
                  </span>
                </div>
              )}
              {Boolean(d.workOrderId) && (
                <div className="flex items-center gap-2">
                  <span className={cn(ds.textMono, 'text-xs text-gray-500')}>
                    {d.workOrderId as string}
                  </span>
                  {Boolean(d.workOrderStatus) && (
                    <span
                      className={ds.badge(
                        d.workOrderStatus === 'Completed' ? 'green-400' : 'orange-400'
                      )}
                    >
                      {d.workOrderStatus as string}
                    </span>
                  )}
                </div>
              )}
              {Boolean(d.nextMaintenance) && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  Next maintenance: {d.nextMaintenance as string}
                </p>
              )}
              <div className="flex flex-wrap gap-1 mt-1">
                {((d.features as string[]) || []).map((f) => (
                  <span key={f} className={ds.badge('neon-cyan')}>
                    {f}
                  </span>
                ))}
              </div>
            </>
          )}

          {currentType === 'WasteStream' && (
            <>
              <div className="flex items-center gap-2">
                {Boolean(d.wasteType) && (
                  <span
                    className={ds.badge(
                      d.wasteType === 'hazardous'
                        ? 'red-400'
                        : d.wasteType === 'recycling'
                          ? 'green-400'
                          : d.wasteType === 'organic'
                            ? 'neon-purple'
                            : 'emerald-500'
                    )}
                  >
                    {(d.wasteType as string).toUpperCase()}
                  </span>
                )}
                <span className={ds.textMuted}>Source: {(d.source as string) || 'N/A'}</span>
              </div>
              <div className={ds.grid2}>
                <div>
                  <p className={cn(ds.textMuted, 'text-xs')}>Monthly Tonnage</p>
                  <p className={ds.heading3}>
                    {(d.tonnageMonthly as number) || 0}{' '}
                    <span className="text-xs text-gray-500">tons</span>
                  </p>
                </div>
                <div>
                  <p className={cn(ds.textMuted, 'text-xs')}>Diversion Rate</p>
                  <p
                    className={cn(
                      ds.heading3,
                      (d.diversionRate as number) >= 50 ? 'text-green-400' : 'text-orange-400'
                    )}
                  >
                    {(d.diversionRate as number) || 0}%
                  </p>
                </div>
              </div>
              {(d.contaminationRate as number) > 0 && (
                <p className="text-xs text-red-400">
                  Contamination: {d.contaminationRate as number}%
                </p>
              )}
              <p className={ds.textMuted}>
                Hauler: {(d.hauler as string) || 'N/A'} | {(d.disposalMethod as string) || 'N/A'}
              </p>
              {Boolean(d.nextPickup) && (
                <p className={cn(ds.textMuted, 'text-xs')}>Next pickup: {d.nextPickup as string}</p>
              )}
            </>
          )}

          {currentType === 'ComplianceRecord' &&
            (() => {
              const score = (d.complianceScore as number) || 0;
              const isExpired = d.expirationDate
                ? new Date(d.expirationDate as string) < new Date()
                : false;
              return (
                <>
                  <div className="flex items-center gap-2">
                    <span className={cn(ds.textMono, 'text-xs text-gray-500')}>
                      {d.permitNumber as string}
                    </span>
                    {Boolean(d.permitType) && (
                      <span className={ds.badge('emerald-500')}>{d.permitType as string}</span>
                    )}
                  </div>
                  <p className={ds.textMuted}>Agency: {(d.issuingAgency as string) || 'N/A'}</p>
                  <div className="flex items-center gap-3">
                    <div>
                      <p className={cn(ds.textMuted, 'text-xs')}>Compliance Score</p>
                      <p
                        className={cn(
                          ds.heading3,
                          score >= 80
                            ? 'text-green-400'
                            : score >= 60
                              ? 'text-orange-400'
                              : 'text-red-400'
                        )}
                      >
                        {score}/100
                      </p>
                    </div>
                    {isExpired && (
                      <span className={cn(ds.badge('red-400'), 'animate-pulse')}>
                        <AlertOctagon className="w-3 h-3" /> EXPIRED
                      </span>
                    )}
                  </div>
                  {Boolean(d.expirationDate) && (
                    <p className={cn(ds.textMuted, 'text-xs')}>
                      Expires: {d.expirationDate as string}
                    </p>
                  )}
                  {Boolean(d.nextInspection) && (
                    <p className={cn(ds.textMuted, 'text-xs')}>
                      Next inspection: {d.nextInspection as string}
                    </p>
                  )}
                  {Boolean(d.violationHistory) && (
                    <div className="flex items-center gap-1 text-xs text-red-400">
                      <AlertTriangle className="w-3 h-3" />
                      <span className="truncate">{d.violationHistory as string}</span>
                    </div>
                  )}
                </>
              );
            })()}

          {currentType === 'CarbonEntry' && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.category) && (
                  <span className={ds.badge('neon-cyan')}>{d.category as string}</span>
                )}
                {Boolean(d.scope) && (
                  <span className={ds.badge('neon-purple')}>
                    {(d.scope as string).split(' - ')[0]}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>Source: {(d.source as string) || 'N/A'}</p>
              <div className="flex items-center gap-3">
                <div>
                  <p className={cn(ds.textMuted, 'text-xs')}>Emissions</p>
                  <p className={ds.heading3}>
                    {((d.emissionsTonsCO2e as number) || 0).toLocaleString()}{' '}
                    <span className="text-xs text-gray-500">tCO2e</span>
                  </p>
                </div>
                {(d.reductionTarget as number) > 0 && (
                  <div>
                    <p className={cn(ds.textMuted, 'text-xs')}>Target Reduction</p>
                    <p className={cn(ds.heading3, 'text-green-400')}>
                      {d.reductionTarget as number}%
                    </p>
                  </div>
                )}
              </div>
              {Boolean(d.reportingPeriod) && (
                <p className={cn(ds.textMuted, 'text-xs')}>Period: {d.reportingPeriod as string}</p>
              )}
              {Boolean(d.verificationStatus) && (
                <span
                  className={ds.badge(
                    d.verificationStatus === 'Third-party Verified' ||
                      d.verificationStatus === 'Audited'
                      ? 'green-400'
                      : 'orange-400'
                  )}
                >
                  {d.verificationStatus as string}
                </span>
              )}
            </>
          )}

          {currentType === 'ResourceMetric' && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.resourceType) && (
                  <span
                    className={ds.badge(
                      d.resourceType === 'Water'
                        ? 'emerald-500'
                        : d.resourceType === 'Energy'
                          ? 'orange-400'
                          : d.resourceType === 'Waste'
                            ? 'neon-purple'
                            : 'neon-cyan'
                    )}
                  >
                    {d.resourceType as string}
                  </span>
                )}
                {Boolean(d.trend) &&
                  (() => {
                    const trendInfo = TREND_ICONS[d.trend as PopulationTrend];
                    if (!trendInfo) return null;
                    const TrendIcon = trendInfo.icon;
                    return (
                      <span
                        className={cn('inline-flex items-center gap-1 text-xs', trendInfo.color)}
                      >
                        <TrendIcon className="w-3.5 h-3.5" /> {d.trend as string}
                      </span>
                    );
                  })()}
              </div>
              <p className={ds.textMuted}>{(d.metricName as string) || 'N/A'}</p>
              <div className={ds.grid2}>
                <div>
                  <p className={cn(ds.textMuted, 'text-xs')}>Current Value</p>
                  <p className={ds.heading3}>
                    {((d.value as number) || 0).toLocaleString()}{' '}
                    <span className="text-xs text-gray-500">{d.unit as string}</span>
                  </p>
                </div>
                {(d.target as number) > 0 && (
                  <div>
                    <p className={cn(ds.textMuted, 'text-xs')}>Target</p>
                    <p className={cn(ds.heading3, 'text-neon-cyan')}>
                      {(d.target as number).toLocaleString()}{' '}
                      <span className="text-xs text-gray-500">{d.unit as string}</span>
                    </p>
                  </div>
                )}
              </div>
              {Boolean(d.measurementDate) && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  Measured: {d.measurementDate as string}
                </p>
              )}
              {Boolean(d.location) && (
                <p className={cn(ds.textMuted, 'text-xs')}>{d.location as string}</p>
              )}
            </>
          )}

          {currentType === 'SustainabilityGoal' &&
            (() => {
              const progress = (d.progress as number) || 0;
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {Boolean(d.category) && (
                      <span className={ds.badge('green-400')}>{d.category as string}</span>
                    )}
                  </div>
                  <p className={ds.textMuted}>{(d.goalName as string) || 'N/A'}</p>
                  {Boolean(d.description) && (
                    <p className={cn(ds.textMuted, 'text-xs line-clamp-2')}>
                      {d.description as string}
                    </p>
                  )}
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn(ds.textMuted, 'text-xs')}>Progress</span>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          progress >= 75
                            ? 'text-green-400'
                            : progress >= 50
                              ? 'text-neon-cyan'
                              : progress >= 25
                                ? 'text-orange-400'
                                : 'text-red-400'
                        )}
                      >
                        {progress}%
                      </span>
                    </div>
                    <div className="h-2 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          progress >= 75
                            ? 'bg-green-400'
                            : progress >= 50
                              ? 'bg-neon-cyan'
                              : progress >= 25
                                ? 'bg-orange-400'
                                : 'bg-red-400'
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className={ds.textMuted}>
                      Current: {((d.currentValue as number) || 0).toLocaleString()}{' '}
                      {d.unit as string}
                    </span>
                    <span className={ds.textMuted}>
                      Target: {((d.targetValue as number) || 0).toLocaleString()} {d.unit as string}
                    </span>
                  </div>
                  {Boolean(d.targetDate) && (
                    <p className={cn(ds.textMuted, 'text-xs')}>Due: {d.targetDate as string}</p>
                  )}
                  {Boolean(d.responsible) && (
                    <p className={cn(ds.textMuted, 'text-xs')}>Owner: {d.responsible as string}</p>
                  )}
                </>
              );
            })()}
        </div>

        {/* Detail expansion */}
        {detailItem === item.id && (
          <div
            className="mt-3 pt-3 border-t border-lattice-border space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {Boolean(d.notes) && (
              <div>
                <p className={cn(ds.label, 'mb-0.5')}>Notes</p>
                <p className="text-xs text-gray-300">{d.notes as string}</p>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn(ds.textMuted, 'text-xs')}>
                Created: {new Date(item.createdAt).toLocaleDateString()}
              </p>
              <p className={cn(ds.textMuted, 'text-xs')}>
                Updated: {new Date(item.updatedAt).toLocaleDateString()}
              </p>
              <p className={cn(ds.textMuted, 'text-xs')}>v{item.version}</p>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}>
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button
            className={cn(ds.btnGhost, ds.btnSmall)}
            onClick={() => setDetailItem(detailItem === item.id ? null : item.id)}
          >
            {detailItem === item.id ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {detailItem === item.id ? 'Less' : 'More'}
          </button>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Enhanced Dashboard                                               */
  /* ---------------------------------------------------------------- */
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* KPI Summary Row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Active Sites</span>
          </div>
          <p className={ds.heading1}>{dashboardStats.activeSites}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>{siteItems.length} total sites managed</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Bug className="w-5 h-5 text-neon-purple" />
            <span className={ds.textMuted}>Species Observed</span>
          </div>
          <p className={ds.heading1}>{dashboardStats.totalSpecies}</p>
          {dashboardStats.endangeredSpecies > 0 && (
            <p className="text-xs text-red-400 mt-1">
              {dashboardStats.endangeredSpecies} endangered/critical
            </p>
          )}
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="w-5 h-5 text-emerald-500" />
            <span className={ds.textMuted}>Samples Pending</span>
          </div>
          <p className={ds.heading1}>{dashboardStats.pendingSamples}</p>
          {dashboardStats.exceedances > 0 && (
            <p className="text-xs text-red-400 mt-1 animate-pulse">
              {dashboardStats.exceedances} exceedance(s) flagged
            </p>
          )}
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Compliance Score</span>
          </div>
          <p
            className={cn(
              ds.heading1,
              dashboardStats.avgCompliance >= 80
                ? 'text-green-400'
                : dashboardStats.avgCompliance >= 60
                  ? 'text-orange-400'
                  : 'text-red-400'
            )}
          >
            {dashboardStats.avgCompliance > 0 ? dashboardStats.avgCompliance.toFixed(0) : '--'}
          </p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>
            avg across {complianceItems.length} permits
          </p>
        </div>
      </div>

      {/* Secondary KPI Row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Footprints className="w-5 h-5 text-neon-cyan" />
            <span className={ds.textMuted}>Trail Miles</span>
          </div>
          <p className={ds.heading2}>{dashboardStats.trailMiles.toFixed(1)}</p>
          {dashboardStats.trailsClosed > 0 && (
            <p className="text-xs text-orange-400 mt-1">
              {dashboardStats.trailsClosed} trail(s) closed
            </p>
          )}
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Recycle className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Diversion Rate</span>
          </div>
          <p
            className={cn(
              ds.heading2,
              dashboardStats.avgDiversion >= 50 ? 'text-green-400' : 'text-orange-400'
            )}
          >
            {dashboardStats.avgDiversion > 0 ? dashboardStats.avgDiversion.toFixed(1) + '%' : '--'}
          </p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>
            {dashboardStats.totalWasteTonnage.toFixed(1)} tons/mo total
          </p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Upcoming Inspections</span>
          </div>
          <p className={ds.heading2}>{dashboardStats.upcomingInspections}</p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>within next 30 days</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <AlertOctagon className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Expired Permits</span>
          </div>
          <p
            className={cn(
              ds.heading2,
              dashboardStats.expiredPermits > 0 ? 'text-red-400' : 'text-green-400'
            )}
          >
            {dashboardStats.expiredPermits}
          </p>
          <p className={cn(ds.textMuted, 'text-xs mt-1')}>require renewal</p>
        </div>
      </div>

      {/* Status Breakdown for Current Mode */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Status Breakdown - {mode}</h3>
          <div className="space-y-2">
            {ALL_STATUSES.map((s) => {
              const count = statusCounts[s] || 0;
              const total = items.length || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={s} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 capitalize">{s}</span>
                    <div className="flex items-center gap-2">
                      <span className={ds.badge(STATUS_COLORS[s])}>{count}</span>
                      <span className={cn(ds.textMuted, 'text-xs w-8 text-right')}>{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-lattice-elevated rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        `bg-${STATUS_COLORS[s]}`
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Environmental Summary</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Mountain className="w-5 h-5 text-green-400" />
                <span className="text-sm text-gray-300">Managed Sites</span>
              </div>
              <span className={ds.heading3}>{siteItems.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-neon-purple" />
                <span className="text-sm text-gray-300">Species Tracked</span>
              </div>
              <span className={ds.heading3}>{speciesItems.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-emerald-500" />
                <span className="text-sm text-gray-300">Active Samples</span>
              </div>
              <span className={ds.heading3}>{sampleItems.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Recycle className="w-5 h-5 text-green-400" />
                <span className="text-sm text-gray-300">Waste Streams</span>
              </div>
              <span className={ds.heading3}>{wasteItems.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-neon-cyan" />
                <span className="text-sm text-gray-300">Compliance Records</span>
              </div>
              <span className={ds.heading3}>{complianceItems.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30">
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-neon-orange" />
                <span className="text-sm text-gray-300">Resource Metrics</span>
              </div>
              <span className={ds.heading3}>{resourceItems.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Critical Alerts & Exceedances</h3>
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
        <div className="mt-4 space-y-2">
          {items.filter((i) => i.meta.status === 'critical').length === 0 &&
          sampleItems.filter((i) => (i.data as unknown as EnvironmentalSample).exceedance)
            .length === 0 &&
          complianceItems.filter((i) => {
            const d = i.data as unknown as ComplianceRecord;
            return d.expirationDate && new Date(d.expirationDate) < new Date();
          }).length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className={ds.textMuted}>No critical items at this time. All systems nominal.</p>
            </div>
          ) : (
            <>
              {items
                .filter((i) => i.meta.status === 'critical')
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{item.title}</p>
                      <p className={ds.textMuted}>{currentType} - Critical Status</p>
                    </div>
                    {renderStatusBadge('critical')}
                  </div>
                ))}
              {sampleItems
                .filter((i) => (i.data as unknown as EnvironmentalSample).exceedance)
                .map((item) => {
                  const sd = item.data as unknown as EnvironmentalSample;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <p className={ds.textMuted}>
                          {sd.parameter}: {sd.value} {sd.unit} (limit: {sd.referenceLimit})
                        </p>
                      </div>
                      <span className={cn(ds.badge('red-400'), 'animate-pulse')}>EXCEEDANCE</span>
                    </div>
                  );
                })}
              {complianceItems
                .filter((i) => {
                  const cd = i.data as unknown as ComplianceRecord;
                  return cd.expirationDate && new Date(cd.expirationDate) < new Date();
                })
                .map((item) => {
                  const cd = item.data as unknown as ComplianceRecord;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <p className={ds.textMuted}>
                          Permit {cd.permitNumber} expired {cd.expirationDate}
                        </p>
                      </div>
                      <span className={ds.badge('orange-400')}>EXPIRED</span>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {/* Upcoming Inspections */}
      {complianceItems.length > 0 ? (
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={ds.heading3}>Upcoming Inspections</h3>
            <Calendar className="w-5 h-5 text-gray-400" />
          </div>
          <div className="mt-4 space-y-2">
            {complianceItems
              .filter((i) => {
                const cd = i.data as unknown as ComplianceRecord;
                if (!cd.nextInspection) return false;
                return new Date(cd.nextInspection) >= new Date();
              })
              .sort((a, b) => {
                const ad = (a.data as unknown as ComplianceRecord).nextInspection;
                const bd = (b.data as unknown as ComplianceRecord).nextInspection;
                return new Date(ad).getTime() - new Date(bd).getTime();
              })
              .slice(0, 5)
              .map((item) => {
                const cd = item.data as unknown as ComplianceRecord;
                const daysUntil = Math.ceil(
                  (new Date(cd.nextInspection).getTime() - new Date().getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{item.title}</p>
                      <p className={ds.textMuted}>
                        {cd.permitType} - {cd.issuingAgency}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          daysUntil <= 7
                            ? 'text-red-400'
                            : daysUntil <= 30
                              ? 'text-orange-400'
                              : 'text-gray-300'
                        )}
                      >
                        {cd.nextInspection}
                      </p>
                      <p className={cn(ds.textMuted, 'text-xs')}>in {daysUntil} days</p>
                    </div>
                  </div>
                );
              })}
            {complianceItems.filter((i) => {
              const cd = i.data as unknown as ComplianceRecord;
              return cd.nextInspection && new Date(cd.nextInspection) >= new Date();
            }).length === 0 && <p className={ds.textMuted}>No upcoming inspections scheduled.</p>}
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>
            No compliance items tracked yet. Add compliance records to monitor environmental
            regulations.
          </p>
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  Domain Actions Panel                                             */
  /* ---------------------------------------------------------------- */
  const renderActionsPanel = () => (
    <div className="space-y-6">
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Domain Actions</h3>
        <p className={ds.textMuted}>
          Run specialized analyses and reports on your environmental data.
        </p>
      </div>

      <div className={ds.grid2}>
        {DOMAIN_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <div key={action.id} className={cn(ds.panelHover, 'space-y-3')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h4 className={ds.heading3}>{action.label}</h4>
                  <p className={cn(ds.textMuted, 'text-xs')}>{action.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className={cn(ds.select, 'text-sm flex-1')}
                  value={selectedAction === action.id ? detailItem || '' : ''}
                  onChange={(e) => {
                    setSelectedAction(action.id);
                    setDetailItem(e.target.value || null);
                  }}
                >
                  <option value="">Select target artifact...</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
                </select>
                <button
                  className={ds.btnPrimary}
                  onClick={() => {
                    const targetId = selectedAction === action.id ? detailItem : siteItems[0]?.id;
                    if (targetId) handleAction(action.id, targetId);
                  }}
                  disabled={runAction.isPending}
                >
                  <Zap className="w-4 h-4" />
                  Run
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Result */}
      {actionResult && (
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre
            className={cn(
              ds.textMono,
              'text-xs overflow-auto max-h-64 mt-3 p-3 rounded-lg bg-lattice-elevated/30'
            )}
          >
            {JSON.stringify(actionResult, null, 2)}
          </pre>
        </div>
      )}

      {runAction.isPending && (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-emerald-500" />
            <span className="text-emerald-500 text-sm">Running action...</span>
          </div>
        </div>
      )}
    </div>
  );

  /* ================================================================ */
  /*  Main Render                                                      */
  /* ================================================================ */

  return (
    <LensPageShell
      domain="environment"
      title="Environmental Monitoring"
      description="Sites, species tracking, sampling, trail assets, waste management & compliance"
      headerIcon={<TreePine className="w-6 h-6 text-green-400" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <div className="flex items-center gap-2">
          <button
            className={cn(view === 'library' ? ds.btnPrimary : ds.btnSecondary)}
            onClick={() => setView('library')}
          >
            <ListChecks className="w-4 h-4" /> Library
          </button>
          <button
            className={cn(view === 'dashboard' ? ds.btnPrimary : ds.btnSecondary)}
            onClick={() => setView('dashboard')}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
          <button
            className={cn(view === 'actions' ? ds.btnPrimary : ds.btnSecondary)}
            onClick={() => setView('actions')}
          >
            <Zap className="w-4 h-4" /> Actions
          </button>
          <div className="w-px h-6 bg-lattice-border" />
          <button className={ds.btnGhost} onClick={exportGeoJSON} title="Export GeoJSON">
            <Globe className="w-4 h-4" />
          </button>
          <button className={ds.btnGhost} onClick={exportCSV} title="Export CSV">
            <Download className="w-4 h-4" />
          </button>
        </div>
      }
    >
      {/* AI Actions */}
      <UniversalActions domain="environment" artifactId={siteItems[0]?.id} compact />
      {/* Navigation Tabs */}
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
                setDetailItem(null);
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: TreePine, label: 'Sites', value: siteItems.length, color: 'text-green-400' },
          { icon: Bug, label: 'Species', value: speciesItems.length, color: 'text-yellow-400' },
          { icon: Droplets, label: 'Samples', value: sampleItems.length, color: 'text-blue-400' },
          {
            icon: Leaf,
            label: 'Carbon Entries',
            value: carbonItems.length,
            color: 'text-emerald-400',
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={cn('w-5 h-5 mb-2', stat.color)} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Carbon Footprint Tracker */}
      {carbonItems.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Leaf className="w-4 h-4 text-green-400" /> Carbon Footprint Progress
          </h3>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="3"
                  strokeDasharray={`${Math.min(
                    100,
                    (goalItems.filter((g) => {
                      const d = g.data as unknown as Record<string, unknown>;
                      return ((d.progress as number) || 0) >= 100;
                    }).length /
                      Math.max(1, goalItems.length)) *
                      100
                  )}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-green-400">
                {goalItems.length > 0
                  ? Math.round(
                      (goalItems.filter((g) => {
                        const d = g.data as unknown as Record<string, unknown>;
                        return ((d.progress as number) || 0) >= 100;
                      }).length /
                        goalItems.length) *
                        100
                    )
                  : 0}
                %
              </span>
            </div>
            <div className="flex-1 space-y-1.5">
              <p className="text-sm text-white">{carbonItems.length} carbon entries tracked</p>
              <p className="text-xs text-gray-400">
                {goalItems.length} sustainability goals,{' '}
                {
                  goalItems.filter((g) => {
                    const d = g.data as unknown as Record<string, unknown>;
                    return ((d.progress as number) || 0) >= 100;
                  }).length
                }{' '}
                completed
              </p>
              <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${Math.min(100, carbonItems.length * 10)}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>
            No carbon tracking data yet. Add carbon footprint records to see emissions analysis.
          </p>
        </div>
      )}

      {/* View Content */}
      {view === 'dashboard' ? (
        renderDashboard()
      ) : view === 'actions' ? (
        renderActionsPanel()
      ) : (
        <>
          {/* Search/Filter Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className={cn(ds.input, 'pl-10')}
                placeholder={`Search ${mode.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                className={cn(ds.select, 'w-auto')}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <button className={ds.btnPrimary} onClick={openNew}>
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className={cn(ds.textMuted, 'text-xs')}>
                {filtered.length} of {items.length} items
              </span>
              {runAction.isPending && (
                <span className="text-xs text-emerald-500 animate-pulse">Running action...</span>
              )}
            </div>
          </div>

          {/* Content Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-green-400 mx-auto mb-3" />
                <p className={ds.textMuted}>Loading {mode.toLowerCase()}...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <TreePine className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className={ds.heading3}>No {currentType} records found</p>
              <p className={ds.textMuted}>
                {searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your filters or search query.'
                  : 'Create your first record to start monitoring.'}
              </p>
              <button className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
                <Plus className="w-4 h-4" /> Add {currentType}
              </button>
            </div>
          ) : (
            <div className={ds.grid3}>{filtered.map(renderCard)}</div>
          )}
        </>
      )}

      {/* Action Result Panel (library view) */}
      {actionResult && view === 'library' && (
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-48 mt-2')}>
            {JSON.stringify(actionResult, null, 2)}
          </pre>
        </div>
      )}

      {/* ---- Editor Modal ---- */}
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
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    className={ds.input}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Record title..."
                  />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select
                    className={ds.select}
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as Status)}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-between">
                <div>
                  {editingId && (
                    <button
                      className={ds.btnDanger}
                      onClick={() => {
                        handleDelete(editingId);
                        setShowEditor(false);
                      }}
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>
                    Cancel
                  </button>
                  <button
                    className={ds.btnPrimary}
                    onClick={handleSave}
                    disabled={!formTitle.trim()}
                  >
                    {editingId ? 'Update' : 'Create'} {currentType}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MAP TAB ==================== */}
      {mode === 'Map' && (
        <div className={cn(ds.panel, 'p-4')}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-green-400" /> Monitoring Site Locations
          </h3>
          <MapView
            markers={siteItems
              .filter((i) => {
                const d = i.data as unknown as Site;
                return d.lat && d.lon;
              })
              .map((i) => {
                const d = i.data as unknown as Site;
                return {
                  lat: d.lat,
                  lng: d.lon,
                  label: d.name || i.title,
                  popup: `${d.siteType || ''} - ${d.regulatoryStatus || ''} (${d.areaAcres || 0} acres)`,
                };
              })}
            className="h-[500px]"
          />
        </div>
      )}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="environment" />
      </div>
    </LensPageShell>
  );
}
