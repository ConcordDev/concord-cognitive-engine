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
  Plus,
  Search,
  Route,
  Target,
  MapPin,
  Users,
  X,
  Edit3,
  Trash2,
  Filter,
  BarChart3,
  Camera,
  BadgeCheck,
  KeyRound,
  Scan,
  AlertCircle,
  ShieldCheck,
  Siren,
  Timer,
  Server,
  Skull,
  CheckCircle2,
  ChevronRight,
  Layers,
  ChevronDown,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Incidents' | 'Assets' | 'Patrols' | 'Surveillance' | 'Access' | 'Threats';
type ArtifactType = 'Incident' | 'Asset' | 'Patrol' | 'Surveillance' | 'AccessControl' | 'ThreatIntel';

type Severity = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
type IncidentType = 'breach' | 'phishing' | 'malware' | 'ddos' | 'insider' | 'physical' | 'social_engineering' | 'ransomware';
type IncidentStatus = 'detected' | 'triaged' | 'contained' | 'eradicated' | 'recovered' | 'closed';
type AssetType = 'server' | 'endpoint' | 'network' | 'cloud' | 'iot' | 'mobile';
type AssetCriticality = 'critical' | 'high' | 'medium' | 'low';
type PatchStatus = 'current' | 'pending' | 'overdue' | 'exempt';
type _AlertLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';
type AccessLevel = 'public' | 'internal' | 'restricted' | 'confidential' | 'top_secret';

interface IncidentData {
  severity: Severity;
  type: IncidentType;
  status: IncidentStatus;
  mttd: number; // minutes to detect
  mttr: number; // minutes to respond
  timeline: { time: string; action: string; actor: string }[];
  affectedAssets: string[];
  description: string;
  assignee: string;
  reportedBy: string;
  reportedAt: string;
  containedAt: string;
  closedAt: string;
  rootCause: string;
  lessonsLearned: string;
}

interface AssetData {
  assetType: AssetType;
  ip: string;
  owner: string;
  criticality: AssetCriticality;
  vulnerabilityCount: number;
  patchStatus: PatchStatus;
  lastScanDate: string;
  os: string;
  location: string;
  department: string;
  complianceStatus: string;
}

interface PatrolData {
  route: string;
  checkpoints: string[];
  guard: string;
  shiftStart: string;
  shiftEnd: string;
  incidentsReported: number;
  responseTime: number; // avg minutes
  completionRate: number; // percentage
  notes: string;
  lastPatrolTime: string;
}

interface SurveillanceData {
  cameraId: string;
  zone: string;
  type: string; // indoor/outdoor/ptz
  coverage: string;
  alertCount: number;
  recordingRetention: string; // days
  lastMaintenanceDate: string;
  resolution: string;
  nightVision: boolean;
  motionDetection: boolean;
  status: string;
}

interface AccessControlData {
  accessLevel: AccessLevel;
  badgeId: string;
  holder: string;
  department: string;
  zones: string[];
  validFrom: string;
  validUntil: string;
  accessLog: { timestamp: string; zone: string; action: string }[];
  visitorName: string;
  visitorCompany: string;
  escortRequired: boolean;
  restrictions: string;
}

interface ThreatIntelData {
  iocType: string; // IP, hash, domain, email, url
  iocValue: string;
  threatActor: string;
  confidence: number; // 0-100
  riskScore: number; // 0-100
  source: string;
  firstSeen: string;
  lastSeen: string;
  affectedAssets: string[];
  mitigations: string[];
  tags: string[];
  description: string;
}

type ArtifactDataUnion = IncidentData | AssetData | PatrolData | SurveillanceData | AccessControlData | ThreatIntelData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof Shield; artifactType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Incidents', icon: Siren, artifactType: 'Incident' },
  { id: 'Assets', icon: Server, artifactType: 'Asset' },
  { id: 'Patrols', icon: Route, artifactType: 'Patrol' },
  { id: 'Surveillance', icon: Camera, artifactType: 'Surveillance' },
  { id: 'Access', icon: KeyRound, artifactType: 'AccessControl' },
  { id: 'Threats', icon: Skull, artifactType: 'ThreatIntel' },
];

const SEVERITY_LIST: Severity[] = ['P1', 'P2', 'P3', 'P4', 'P5'];
const INCIDENT_TYPES: IncidentType[] = ['breach', 'phishing', 'malware', 'ddos', 'insider', 'physical', 'social_engineering', 'ransomware'];
const INCIDENT_STATUSES: IncidentStatus[] = ['detected', 'triaged', 'contained', 'eradicated', 'recovered', 'closed'];
const ASSET_TYPES: AssetType[] = ['server', 'endpoint', 'network', 'cloud', 'iot', 'mobile'];
const ASSET_CRITICALITY: AssetCriticality[] = ['critical', 'high', 'medium', 'low'];
const PATCH_STATUSES: PatchStatus[] = ['current', 'pending', 'overdue', 'exempt'];
const ACCESS_LEVELS: AccessLevel[] = ['public', 'internal', 'restricted', 'confidential', 'top_secret'];

const STATUS_COLORS: Record<string, string> = {
  detected: 'red-400',
  triaged: 'orange-400',
  contained: 'yellow-400',
  eradicated: 'blue-400',
  recovered: 'green-400',
  closed: 'gray-400',
  P1: 'red-500',
  P2: 'red-400',
  P3: 'orange-400',
  P4: 'yellow-400',
  P5: 'green-400',
  critical: 'red-400',
  high: 'orange-400',
  medium: 'yellow-400',
  low: 'green-400',
  current: 'green-400',
  pending: 'yellow-400',
  overdue: 'red-400',
  exempt: 'gray-400',
  active: 'green-400',
  inactive: 'gray-400',
  maintenance: 'orange-400',
  online: 'green-400',
  offline: 'red-400',
  public: 'green-400',
  internal: 'blue-400',
  restricted: 'yellow-400',
  confidential: 'orange-400',
  top_secret: 'red-400',
  info: 'blue-400',
  breach: 'red-500',
  phishing: 'orange-400',
  malware: 'red-400',
  ddos: 'purple-400',
  insider: 'yellow-400',
  physical: 'blue-400',
  social_engineering: 'orange-300',
  ransomware: 'red-500',
};

function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'Incidents': return INCIDENT_STATUSES;
    case 'Assets': return ['active', 'inactive', 'maintenance'];
    case 'Patrols': return ['active', 'completed', 'scheduled', 'cancelled'];
    case 'Surveillance': return ['online', 'offline', 'maintenance'];
    case 'Access': return ['active', 'expired', 'suspended', 'revoked'];
    case 'Threats': return ['active', 'monitoring', 'mitigated', 'resolved'];
    default: return ['active', 'inactive'];
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SecurityLensPage() {
  useLensNav('security');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('security');

  const [mode, setMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('detected');
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentType: ArtifactType = MODE_TABS.find(t => t.id === mode)?.artifactType || 'Incident';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactDataUnion>('security', currentType, {
    seed: [],
  });

  /* secondary data fetches for dashboard */
  const { items: incidents } = useLensData<IncidentData>('security', 'Incident', { seed: [] });
  const { items: assets } = useLensData<AssetData>('security', 'Asset', { seed: [] });
  const { items: patrols } = useLensData<PatrolData>('security', 'Patrol', { seed: [] });
  const { items: surveillance } = useLensData<SurveillanceData>('security', 'Surveillance', { seed: [] });
  const { items: threats } = useLensData<ThreatIntelData>('security', 'ThreatIntel', { seed: [] });

  const runAction = useRunArtifact('security');
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
    const openBySeverity: Record<string, number> = {};
    SEVERITY_LIST.forEach(s => { openBySeverity[s] = 0; });
    incidents.filter(i => i.meta.status !== 'closed').forEach(i => {
      const d = i.data as unknown as IncidentData;
      if (d.severity && openBySeverity[d.severity] !== undefined) openBySeverity[d.severity]++;
    });

    const unpatchedAssets = assets.filter(i => {
      const d = i.data as unknown as AssetData;
      return d.patchStatus === 'overdue' || d.patchStatus === 'pending';
    }).length;

    const activePatrols = patrols.filter(i => i.meta.status === 'active').length;

    const alertsToday = surveillance.reduce((sum, i) => {
      const d = i.data as unknown as SurveillanceData;
      return sum + (d.alertCount || 0);
    }, 0);

    const avgMTTR = (() => {
      const closed = incidents.filter(i => {
        const d = i.data as unknown as IncidentData;
        return d.mttr && d.mttr > 0;
      });
      if (closed.length === 0) return 0;
      return Math.round(closed.reduce((sum, i) => sum + ((i.data as unknown as IncidentData).mttr || 0), 0) / closed.length);
    })();

    const complianceScore = (() => {
      if (assets.length === 0) return 100;
      const compliant = assets.filter(i => {
        const d = i.data as unknown as AssetData;
        return d.patchStatus === 'current' && d.complianceStatus === 'compliant';
      }).length;
      return Math.round((compliant / assets.length) * 100);
    })();

    const totalOpenIncidents = incidents.filter(i => i.meta.status !== 'closed').length;
    const activeThreats = threats.filter(i => i.meta.status === 'active' || i.meta.status === 'monitoring').length;

    return { openBySeverity, unpatchedAssets, activePatrols, alertsToday, avgMTTR, complianceScore, totalOpenIncidents, activeThreats };
  }, [incidents, assets, patrols, surveillance, threats]);

  /* ================================================================ */
  /*  Form fields per artifact type                                    */
  /* ================================================================ */

  const renderFormFields = () => {
    switch (currentType) {
      case 'Incident':
        return (
          <>
            <div data-lens-theme="security" className={ds.grid2}>
              <div>
                <label className={ds.label}>Severity</label>
                <select className={ds.select} value={(formData.severity as string) || 'P3'} onChange={e => setFormData({ ...formData, severity: e.target.value })}>
                  {SEVERITY_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={ds.label}>Incident Type</label>
                <select className={ds.select} value={(formData.type as string) || 'breach'} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                  {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea className={ds.textarea} rows={3} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Detailed incident description..." />
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Assignee</label><input className={ds.input} value={(formData.assignee as string) || ''} onChange={e => setFormData({ ...formData, assignee: e.target.value })} /></div>
              <div><label className={ds.label}>Reported By</label><input className={ds.input} value={(formData.reportedBy as string) || ''} onChange={e => setFormData({ ...formData, reportedBy: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>MTTD (minutes)</label><input type="number" className={ds.input} value={(formData.mttd as number) || ''} onChange={e => setFormData({ ...formData, mttd: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>MTTR (minutes)</label><input type="number" className={ds.input} value={(formData.mttr as number) || ''} onChange={e => setFormData({ ...formData, mttr: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Reported At</label><input type="datetime-local" className={ds.input} value={(formData.reportedAt as string) || ''} onChange={e => setFormData({ ...formData, reportedAt: e.target.value })} /></div>
              <div><label className={ds.label}>Contained At</label><input type="datetime-local" className={ds.input} value={(formData.containedAt as string) || ''} onChange={e => setFormData({ ...formData, containedAt: e.target.value })} /></div>
              <div><label className={ds.label}>Closed At</label><input type="datetime-local" className={ds.input} value={(formData.closedAt as string) || ''} onChange={e => setFormData({ ...formData, closedAt: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Affected Assets (comma-separated)</label><input className={ds.input} value={((formData.affectedAssets as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, affectedAssets: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Root Cause</label><textarea className={ds.textarea} rows={2} value={(formData.rootCause as string) || ''} onChange={e => setFormData({ ...formData, rootCause: e.target.value })} /></div>
            <div><label className={ds.label}>Lessons Learned</label><textarea className={ds.textarea} rows={2} value={(formData.lessonsLearned as string) || ''} onChange={e => setFormData({ ...formData, lessonsLearned: e.target.value })} /></div>
          </>
        );
      case 'Asset':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Asset Type</label>
                <select className={ds.select} value={(formData.assetType as string) || 'server'} onChange={e => setFormData({ ...formData, assetType: e.target.value })}>
                  {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={ds.label}>Criticality</label>
                <select className={ds.select} value={(formData.criticality as string) || 'medium'} onChange={e => setFormData({ ...formData, criticality: e.target.value })}>
                  {ASSET_CRITICALITY.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>IP Address</label><input className={ds.input} value={(formData.ip as string) || ''} onChange={e => setFormData({ ...formData, ip: e.target.value })} placeholder="192.168.1.1" /></div>
              <div><label className={ds.label}>Owner</label><input className={ds.input} value={(formData.owner as string) || ''} onChange={e => setFormData({ ...formData, owner: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Vulnerability Count</label><input type="number" className={ds.input} value={(formData.vulnerabilityCount as number) || ''} onChange={e => setFormData({ ...formData, vulnerabilityCount: parseInt(e.target.value) || 0 })} /></div>
              <div>
                <label className={ds.label}>Patch Status</label>
                <select className={ds.select} value={(formData.patchStatus as string) || 'current'} onChange={e => setFormData({ ...formData, patchStatus: e.target.value })}>
                  {PATCH_STATUSES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>OS</label><input className={ds.input} value={(formData.os as string) || ''} onChange={e => setFormData({ ...formData, os: e.target.value })} placeholder="Windows, Linux, etc." /></div>
              <div><label className={ds.label}>Last Scan Date</label><input type="date" className={ds.input} value={(formData.lastScanDate as string) || ''} onChange={e => setFormData({ ...formData, lastScanDate: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Location</label><input className={ds.input} value={(formData.location as string) || ''} onChange={e => setFormData({ ...formData, location: e.target.value })} /></div>
              <div><label className={ds.label}>Department</label><input className={ds.input} value={(formData.department as string) || ''} onChange={e => setFormData({ ...formData, department: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Compliance Status</label><input className={ds.input} value={(formData.complianceStatus as string) || ''} onChange={e => setFormData({ ...formData, complianceStatus: e.target.value })} placeholder="compliant, non-compliant, pending" /></div>
          </>
        );
      case 'Patrol':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Route Name</label><input className={ds.input} value={(formData.route as string) || ''} onChange={e => setFormData({ ...formData, route: e.target.value })} /></div>
              <div><label className={ds.label}>Guard</label><input className={ds.input} value={(formData.guard as string) || ''} onChange={e => setFormData({ ...formData, guard: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Checkpoints (comma-separated)</label><input className={ds.input} value={((formData.checkpoints as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, checkpoints: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Gate A, Building 1, Parking Lot..." /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Shift Start</label><input type="time" className={ds.input} value={(formData.shiftStart as string) || ''} onChange={e => setFormData({ ...formData, shiftStart: e.target.value })} /></div>
              <div><label className={ds.label}>Shift End</label><input type="time" className={ds.input} value={(formData.shiftEnd as string) || ''} onChange={e => setFormData({ ...formData, shiftEnd: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Incidents Reported</label><input type="number" className={ds.input} value={(formData.incidentsReported as number) || ''} onChange={e => setFormData({ ...formData, incidentsReported: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Avg Response Time (min)</label><input type="number" className={ds.input} value={(formData.responseTime as number) || ''} onChange={e => setFormData({ ...formData, responseTime: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Completion Rate (%)</label><input type="number" className={ds.input} value={(formData.completionRate as number) || ''} onChange={e => setFormData({ ...formData, completionRate: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Surveillance':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Camera ID</label><input className={ds.input} value={(formData.cameraId as string) || ''} onChange={e => setFormData({ ...formData, cameraId: e.target.value })} placeholder="CAM-001" /></div>
              <div><label className={ds.label}>Zone</label><input className={ds.input} value={(formData.zone as string) || ''} onChange={e => setFormData({ ...formData, zone: e.target.value })} placeholder="North Entrance, Parking, etc." /></div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Type</label>
                <select className={ds.select} value={(formData.type as string) || 'indoor'} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                  <option value="indoor">Indoor</option>
                  <option value="outdoor">Outdoor</option>
                  <option value="ptz">PTZ</option>
                  <option value="thermal">Thermal</option>
                </select>
              </div>
              <div><label className={ds.label}>Resolution</label><input className={ds.input} value={(formData.resolution as string) || ''} onChange={e => setFormData({ ...formData, resolution: e.target.value })} placeholder="1080p, 4K, etc." /></div>
            </div>
            <div><label className={ds.label}>Coverage Description</label><input className={ds.input} value={(formData.coverage as string) || ''} onChange={e => setFormData({ ...formData, coverage: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Alert Count</label><input type="number" className={ds.input} value={(formData.alertCount as number) || ''} onChange={e => setFormData({ ...formData, alertCount: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Recording Retention (days)</label><input className={ds.input} value={(formData.recordingRetention as string) || ''} onChange={e => setFormData({ ...formData, recordingRetention: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Last Maintenance</label><input type="date" className={ds.input} value={(formData.lastMaintenanceDate as string) || ''} onChange={e => setFormData({ ...formData, lastMaintenanceDate: e.target.value })} /></div>
              <div className="flex items-center gap-4 pt-6">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={(formData.nightVision as boolean) || false} onChange={e => setFormData({ ...formData, nightVision: e.target.checked })} />
                  Night Vision
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={(formData.motionDetection as boolean) || false} onChange={e => setFormData({ ...formData, motionDetection: e.target.checked })} />
                  Motion Detect
                </label>
              </div>
            </div>
          </>
        );
      case 'AccessControl':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Access Level</label>
                <select className={ds.select} value={(formData.accessLevel as string) || 'internal'} onChange={e => setFormData({ ...formData, accessLevel: e.target.value })}>
                  {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><label className={ds.label}>Badge ID</label><input className={ds.input} value={(formData.badgeId as string) || ''} onChange={e => setFormData({ ...formData, badgeId: e.target.value })} placeholder="BDG-0001" /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Badge Holder</label><input className={ds.input} value={(formData.holder as string) || ''} onChange={e => setFormData({ ...formData, holder: e.target.value })} /></div>
              <div><label className={ds.label}>Department</label><input className={ds.input} value={(formData.department as string) || ''} onChange={e => setFormData({ ...formData, department: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Authorized Zones (comma-separated)</label><input className={ds.input} value={((formData.zones as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, zones: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Lobby, Floor 2, Server Room..." /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Valid From</label><input type="date" className={ds.input} value={(formData.validFrom as string) || ''} onChange={e => setFormData({ ...formData, validFrom: e.target.value })} /></div>
              <div><label className={ds.label}>Valid Until</label><input type="date" className={ds.input} value={(formData.validUntil as string) || ''} onChange={e => setFormData({ ...formData, validUntil: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Visitor Name</label><input className={ds.input} value={(formData.visitorName as string) || ''} onChange={e => setFormData({ ...formData, visitorName: e.target.value })} /></div>
              <div><label className={ds.label}>Visitor Company</label><input className={ds.input} value={(formData.visitorCompany as string) || ''} onChange={e => setFormData({ ...formData, visitorCompany: e.target.value })} /></div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={(formData.escortRequired as boolean) || false} onChange={e => setFormData({ ...formData, escortRequired: e.target.checked })} />
                Escort Required
              </label>
            </div>
            <div><label className={ds.label}>Restrictions</label><textarea className={ds.textarea} rows={2} value={(formData.restrictions as string) || ''} onChange={e => setFormData({ ...formData, restrictions: e.target.value })} /></div>
          </>
        );
      case 'ThreatIntel':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>IOC Type</label>
                <select className={ds.select} value={(formData.iocType as string) || 'IP'} onChange={e => setFormData({ ...formData, iocType: e.target.value })}>
                  <option value="IP">IP Address</option>
                  <option value="hash">File Hash</option>
                  <option value="domain">Domain</option>
                  <option value="email">Email</option>
                  <option value="url">URL</option>
                </select>
              </div>
              <div><label className={ds.label}>IOC Value</label><input className={ds.input} value={(formData.iocValue as string) || ''} onChange={e => setFormData({ ...formData, iocValue: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Threat Actor</label><input className={ds.input} value={(formData.threatActor as string) || ''} onChange={e => setFormData({ ...formData, threatActor: e.target.value })} placeholder="APT group, actor name..." /></div>
              <div><label className={ds.label}>Source</label><input className={ds.input} value={(formData.source as string) || ''} onChange={e => setFormData({ ...formData, source: e.target.value })} placeholder="CISA, internal, vendor..." /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Confidence (0-100)</label><input type="number" min="0" max="100" className={ds.input} value={(formData.confidence as number) || ''} onChange={e => setFormData({ ...formData, confidence: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Risk Score (0-100)</label><input type="number" min="0" max="100" className={ds.input} value={(formData.riskScore as number) || ''} onChange={e => setFormData({ ...formData, riskScore: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>First Seen</label><input type="date" className={ds.input} value={(formData.firstSeen as string) || ''} onChange={e => setFormData({ ...formData, firstSeen: e.target.value })} /></div>
              <div><label className={ds.label}>Last Seen</label><input type="date" className={ds.input} value={(formData.lastSeen as string) || ''} onChange={e => setFormData({ ...formData, lastSeen: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={3} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
            <div><label className={ds.label}>Affected Assets (comma-separated)</label><input className={ds.input} value={((formData.affectedAssets as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, affectedAssets: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Mitigations (comma-separated)</label><input className={ds.input} value={((formData.mitigations as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, mitigations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Tags (comma-separated)</label><input className={ds.input} value={((formData.tags as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
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
          {/* Incident card */}
          {currentType === 'Incident' && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.severity) && renderStatusBadge(d.severity as string)}
                {Boolean(d.type) && renderStatusBadge(d.type as string)}
              </div>
              {Boolean(d.description) && <p className={cn(ds.textMuted, 'line-clamp-2')}>{d.description as string}</p>}
              <div className="flex items-center gap-3 text-xs">
                {Boolean(d.assignee) && <span className={ds.textMuted}><Users className="w-3 h-3 inline mr-1" />{d.assignee as string}</span>}
                {(d.mttd as number) > 0 && <span className={cn(ds.textMono, 'text-yellow-400')}>MTTD: {d.mttd as number}m</span>}
                {(d.mttr as number) > 0 && <span className={cn(ds.textMono, 'text-green-400')}>MTTR: {d.mttr as number}m</span>}
              </div>
              {(d.affectedAssets as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.affectedAssets as string[]).slice(0, 3).map(a => <span key={a} className={ds.badge('red-400')}>{a}</span>)}
                  {(d.affectedAssets as string[]).length > 3 && <span className={ds.badge('gray-400')}>+{(d.affectedAssets as string[]).length - 3}</span>}
                </div>
              )}
            </>
          )}

          {/* Asset card */}
          {currentType === 'Asset' && (
            <>
              <div className="flex items-center gap-2">
                {Boolean(d.assetType) && renderStatusBadge(d.assetType as string)}
                {Boolean(d.criticality) && renderStatusBadge(d.criticality as string)}
              </div>
              {Boolean(d.ip) && <p className={cn(ds.textMono, 'text-gray-400 text-xs')}>{d.ip as string}</p>}
              <p className={ds.textMuted}>Owner: {d.owner as string} | {d.department as string}</p>
              <div className="flex items-center gap-3 text-xs">
                {Boolean(d.patchStatus) && renderStatusBadge(d.patchStatus as string)}
                <span className={cn(ds.textMuted)}>Vulns: {d.vulnerabilityCount as number}</span>
              </div>
              {Boolean(d.os) && <p className={cn(ds.textMuted, 'text-xs')}>OS: {d.os as string}</p>}
              {Boolean(d.lastScanDate) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>Last scan: {d.lastScanDate as string}</p>}
            </>
          )}

          {/* Patrol card */}
          {currentType === 'Patrol' && (
            <>
              <p className={ds.textMuted}><Route className="w-3 h-3 inline mr-1" />{d.route as string}</p>
              <p className={ds.textMuted}><Users className="w-3 h-3 inline mr-1" />Guard: {d.guard as string}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>Shift: {d.shiftStart as string} - {d.shiftEnd as string}</p>
              {(d.checkpoints as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.checkpoints as string[]).map(cp => <span key={cp} className={ds.badge('blue-400')}>{cp}</span>)}
                </div>
              )}
              <div className="flex items-center gap-3 text-xs mt-1">
                <span className={ds.textMuted}>Incidents: {d.incidentsReported as number}</span>
                <span className={ds.textMuted}>Response: {d.responseTime as number}m</span>
                <span className={cn(ds.textMono, 'text-green-400')}>{d.completionRate as number}%</span>
              </div>
            </>
          )}

          {/* Surveillance card */}
          {currentType === 'Surveillance' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-400 text-xs')}>{d.cameraId as string}</p>
              <p className={ds.textMuted}>Zone: {d.zone as string} | {d.type as string}</p>
              <p className={ds.textMuted}>{d.coverage as string}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={ds.badge('blue-400')}>{d.resolution as string}</span>
                {Boolean(d.nightVision) && <span className={ds.badge('green-400')}>Night Vision</span>}
                {Boolean(d.motionDetection) && <span className={ds.badge('yellow-400')}>Motion</span>}
              </div>
              <div className="flex items-center gap-3 text-xs mt-1">
                <span className={cn(ds.textMuted)}>Alerts: {d.alertCount as number}</span>
                <span className={cn(ds.textMuted)}>Retention: {d.recordingRetention as string}d</span>
              </div>
            </>
          )}

          {/* Access Control card */}
          {currentType === 'AccessControl' && (
            <>
              <div className="flex items-center gap-2">
                {Boolean(d.accessLevel) && renderStatusBadge(d.accessLevel as string)}
                {Boolean(d.badgeId) && <span className={cn(ds.textMono, 'text-xs text-gray-400')}>{d.badgeId as string}</span>}
              </div>
              <p className={ds.textMuted}>{d.holder as string} | {d.department as string}</p>
              {(d.zones as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.zones as string[]).map(z => <span key={z} className={ds.badge('blue-400')}><MapPin className="w-2.5 h-2.5" />{z}</span>)}
                </div>
              )}
              <p className={cn(ds.textMono, 'text-xs text-gray-500')}>{d.validFrom as string} to {d.validUntil as string}</p>
              {Boolean(d.escortRequired) && <span className={ds.badge('orange-400')}>Escort Required</span>}
              {Boolean(d.visitorName) && <p className={cn(ds.textMuted, 'text-xs')}>Visitor: {d.visitorName as string} ({d.visitorCompany as string})</p>}
            </>
          )}

          {/* Threat Intel card */}
          {currentType === 'ThreatIntel' && (
            <>
              <div className="flex items-center gap-2">
                <span className={ds.badge('red-400')}>{d.iocType as string}</span>
                <span className={cn(ds.textMono, 'text-xs text-red-300')}>{d.iocValue as string}</span>
              </div>
              {Boolean(d.threatActor) && <p className={cn(ds.textMuted, 'font-medium')}><Skull className="w-3 h-3 inline mr-1" />{d.threatActor as string}</p>}
              <div className="flex items-center gap-3 text-xs">
                {(d.confidence as number) > 0 && <span className={cn(ds.textMono, 'text-blue-400')}>Confidence: {d.confidence as number}%</span>}
                {(d.riskScore as number) > 0 && (
                  <span className={cn(ds.textMono, (d.riskScore as number) > 70 ? 'text-red-400' : 'text-yellow-400')}>
                    Risk: {d.riskScore as number}/100
                  </span>
                )}
              </div>
              {Boolean(d.description) && <p className={cn(ds.textMuted, 'line-clamp-2 text-xs')}>{d.description as string}</p>}
              {(d.tags as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.tags as string[]).map(tag => <span key={tag} className={ds.badge('gray-400')}>{tag}</span>)}
                </div>
              )}
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
      {/* Key metrics */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Siren className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Open Incidents</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardStats.totalOpenIncidents > 0 ? 'text-red-400' : 'text-white')}>
            {dashboardStats.totalOpenIncidents}
          </p>
          <p className={ds.textMuted}>Across all severities</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Assets Unpatched</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardStats.unpatchedAssets > 0 ? 'text-orange-400' : 'text-white')}>
            {dashboardStats.unpatchedAssets}
          </p>
          <p className={ds.textMuted}>Pending or overdue</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Route className="w-5 h-5 text-blue-400" />
            <span className={ds.textMuted}>Active Patrols</span>
          </div>
          <p className="text-3xl font-bold text-blue-400">{dashboardStats.activePatrols}</p>
          <p className={ds.textMuted}>Currently in progress</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Camera className="w-5 h-5 text-yellow-400" />
            <span className={ds.textMuted}>Alerts Today</span>
          </div>
          <p className="text-3xl font-bold text-yellow-400">{dashboardStats.alertsToday}</p>
          <p className={ds.textMuted}>Surveillance alerts</p>
        </div>
      </div>

      {/* MTTR and Compliance */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Timer className="w-5 h-5 text-neon-cyan" />
            <span className={ds.textMuted}>Mean Time to Respond</span>
          </div>
          <p className="text-3xl font-bold text-neon-cyan">{dashboardStats.avgMTTR}m</p>
          <p className={ds.textMuted}>Average across resolved incidents</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Compliance Score</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardStats.complianceScore >= 80 ? 'text-green-400' : dashboardStats.complianceScore >= 60 ? 'text-yellow-400' : 'text-red-400')}>
            {dashboardStats.complianceScore}%
          </p>
          <p className={ds.textMuted}>Patched and compliant assets</p>
        </div>
      </div>

      {/* Open incidents by severity */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Open Incidents by Severity</h3>
        <div className="grid grid-cols-5 gap-3">
          {SEVERITY_LIST.map(s => (
            <div key={s} className="text-center p-3 rounded-lg bg-lattice-elevated/30">
              <p className={cn('text-2xl font-bold', dashboardStats.openBySeverity[s] > 0 ? `text-${STATUS_COLORS[s]}` : 'text-white')}>
                {dashboardStats.openBySeverity[s]}
              </p>
              <p className={cn(ds.textMuted, 'text-xs')}>{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Incident status pipeline */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Incident Pipeline</h3>
        <div className="flex items-center gap-2 flex-wrap pb-2">
          {INCIDENT_STATUSES.map((s, idx) => {
            const count = incidents.filter(i => i.meta.status === s).length;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className="text-center p-3 rounded-lg bg-lattice-elevated/30 min-w-[100px]">
                  <p className="text-lg font-bold text-white">{count}</p>
                  <p className={cn(ds.textMuted, 'text-xs capitalize')}>{s}</p>
                </div>
                {idx < INCIDENT_STATUSES.length - 1 && <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active threats */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Active Threats</h3>
          <span className={ds.badge('red-400')}>{dashboardStats.activeThreats} active</span>
        </div>
        <div className="space-y-2 mt-3">
          {threats.filter(i => i.meta.status === 'active' || i.meta.status === 'monitoring').slice(0, 5).map(item => {
            const d = item.data as unknown as ThreatIntelData;
            return (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{item.title}</p>
                  <p className={cn(ds.textMuted, 'text-xs')}>{d.threatActor} | {d.iocType}: {d.iocValue}</p>
                </div>
                <div className="flex items-center gap-2">
                  {d.riskScore > 0 && (
                    <span className={cn(ds.textMono, 'text-xs', d.riskScore > 70 ? 'text-red-400' : 'text-yellow-400')}>
                      Risk: {d.riskScore}
                    </span>
                  )}
                  {renderStatusBadge(item.meta.status)}
                </div>
              </div>
            );
          })}
          {dashboardStats.activeThreats === 0 && <p className={ds.textMuted}>No active threat indicators.</p>}
        </div>
      </div>

      {/* Asset status */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Asset Patch Status</h3>
        <div className="space-y-2">
          {PATCH_STATUSES.map(ps => {
            const count = assets.filter(i => {
              const d = i.data as unknown as AssetData;
              return d.patchStatus === ps;
            }).length;
            return (
              <div key={ps} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-400 capitalize">{ps}</span>
                <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-${STATUS_COLORS[ps] || 'gray-400'} rounded-full transition-all`}
                    style={{ width: `${assets.length > 0 ? (count / assets.length) * 100 : 0}%` }}
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
          <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Scanning systems...</p>
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
    <div className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-red-400" />
          <div>
            <h1 className={ds.heading1}>Security Operations</h1>
            <p className={ds.textMuted}>Incident response, asset inventory, patrols, surveillance, access control &amp; threat intel</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="security" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
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
      <UniversalActions domain="security" artifactId={incidents[0]?.id} compact />
      {/* Mode Tabs */}
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
                  ? 'bg-red-400/20 text-red-400'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.id}
            </button>
          );
        })}
      </nav>

      {/* Quick Stats & Threat Severity Badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Siren, label: 'Open Incidents', value: dashboardStats.totalOpenIncidents, color: 'text-red-400' },
          { icon: Server, label: 'Assets', value: assets.length, color: 'text-blue-400' },
          { icon: Skull, label: 'Active Threats', value: dashboardStats.activeThreats, color: 'text-orange-400' },
          { icon: ShieldCheck, label: 'Compliance', value: `${dashboardStats.complianceScore}%`, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 mb-2 ${stat.color}`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Threat Severity Badges & Security Score Gauge */}
      {(dashboardStats.totalOpenIncidents > 0 || incidents.length > 0) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="panel p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" /> Open by Severity
            </h3>
            <div className="flex gap-2 flex-wrap">
              {SEVERITY_LIST.map(sev => {
                const count = dashboardStats.openBySeverity[sev] || 0;
                const sevColor = sev === 'P1' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                  sev === 'P2' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                  sev === 'P3' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                  sev === 'P4' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                  'bg-green-500/20 text-green-400 border-green-500/30';
                return (
                  <span key={sev} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-mono ${sevColor}`}>
                    {sev} <span className="font-bold">{count}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="panel p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Lock className="w-4 h-4 text-green-400" /> Security Score
            </h3>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={dashboardStats.complianceScore >= 80 ? '#4ade80' : dashboardStats.complianceScore >= 50 ? '#facc15' : '#f87171'} strokeWidth="3" strokeDasharray={`${dashboardStats.complianceScore}, 100`} strokeLinecap="round" />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${dashboardStats.complianceScore >= 80 ? 'text-green-400' : dashboardStats.complianceScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {dashboardStats.complianceScore}%
                </span>
              </div>
              <div className="space-y-1 text-xs text-gray-400">
                <p>MTTR: <span className="text-white font-mono">{dashboardStats.avgMTTR}m</span></p>
                <p>Unpatched: <span className="text-yellow-400 font-mono">{dashboardStats.unpatchedAssets}</span></p>
                <p>Patrols Active: <span className="text-green-400 font-mono">{dashboardStats.activePatrols}</span></p>
                <p>Camera Alerts: <span className="text-orange-400 font-mono">{dashboardStats.alertsToday}</span></p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

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
          <button onClick={() => handleAction('vulnerabilityScan')} className={ds.btnSecondary}>
            <Scan className="w-4 h-4" /> Vulnerability Scan
          </button>
          <button onClick={() => handleAction('incidentEscalate')} className={ds.btnSecondary}>
            <AlertCircle className="w-4 h-4" /> Incident Escalate
          </button>
          <button onClick={() => handleAction('accessAudit')} className={ds.btnSecondary}>
            <BadgeCheck className="w-4 h-4" /> Access Audit
          </button>
          <button onClick={() => handleAction('threatAssessment')} className={ds.btnSecondary}>
            <Target className="w-4 h-4" /> Threat Assessment
          </button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
        </div>
      )}

      {/* Content */}
      {mode === 'Dashboard' ? renderDashboard() : (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-red-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <Shield className="w-12 h-12 text-gray-600 mx-auto mb-3" />
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
            {/* incidentTrend */}
            {actionResult.byType !== undefined && actionResult.totalIncidents !== undefined && !('matrix' in actionResult) && (
              <div className="space-y-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalIncidents)}</p>
                  <p className="text-[10px] text-gray-500">Total Incidents</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(actionResult.byType as Record<string, number>).map(([type, count]) => (
                    <span key={type} className="px-1.5 py-0.5 bg-lattice-surface text-xs rounded text-gray-300">{type}: {count}</span>
                  ))}
                </div>
              </div>
            )}
            {/* patrolCoverage */}
            {actionResult.coverage !== undefined && actionResult.completed !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{String(actionResult.patrol)}</span>
                  <span className="text-sm font-bold text-neon-cyan">{String(actionResult.coverage)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, Number(actionResult.coverage))}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-green-400">{String(actionResult.completed)}</p>
                    <p className="text-[10px] text-gray-500">Completed</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Array.isArray(actionResult.missed) && (actionResult.missed as unknown[]).length > 0 ? 'text-red-400' : 'text-green-400'}`}>{Array.isArray(actionResult.missed) ? (actionResult.missed as unknown[]).length : 0}</p>
                    <p className="text-[10px] text-gray-500">Missed</p>
                  </div>
                </div>
              </div>
            )}
            {/* threatMatrix */}
            {'matrix' in actionResult && Array.isArray(actionResult.matrix) && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalThreats)}</p>
                    <p className="text-[10px] text-gray-500">Total Threats</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.criticalCount) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.criticalCount)}</p>
                    <p className="text-[10px] text-gray-500">Critical</p>
                  </div>
                </div>
                {(actionResult.matrix as {name:string;riskLevel:string;riskScore:number}[]).slice(0,4).map((t, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-lattice-surface rounded text-xs">
                    <span className="text-gray-300">{t.name}</span>
                    <span className={`font-semibold ${t.riskLevel === 'critical' ? 'text-red-400' : t.riskLevel === 'high' ? 'text-orange-400' : t.riskLevel === 'medium' ? 'text-amber-400' : 'text-green-400'}`}>{t.riskLevel} ({t.riskScore})</span>
                  </div>
                ))}
              </div>
            )}
            {/* evidenceChain */}
            {actionResult.investigationId !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${actionResult.intact ? 'text-green-400' : 'text-red-400'}`}>{actionResult.intact ? 'Intact' : 'Issues'}</p>
                    <p className="text-[10px] text-gray-500">Chain Status</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.transfers)}</p>
                    <p className="text-[10px] text-gray-500">Entries</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Array.isArray(actionResult.issues) && (actionResult.issues as unknown[]).length > 0 ? 'text-red-400' : 'text-green-400'}`}>{Array.isArray(actionResult.issues) ? (actionResult.issues as unknown[]).length : 0}</p>
                    <p className="text-[10px] text-gray-500">Issues</p>
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
            <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-hidden flex flex-col')} onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>{editingId ? 'Edit' : 'New'} {currentType}</h2>
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)}><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className={ds.label}>Title</label>
                  <input className={ds.input} value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Title..." />
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

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="security"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
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
            <LensFeaturePanel lensId="security" />
          </div>
        )}
      </div>
    </div>
  );
}
