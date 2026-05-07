'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Heart,
  Users,
  Stethoscope,
  Pill,
  FlaskConical,
  Brain,
  Plus,
  Search,
  X,
  Trash2,
  AlertTriangle,
  Activity,
  ClipboardList,
  Calendar,
  ShieldCheck,
  FileText,
  Clock,
  CheckCircle,
  Zap,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Thermometer,
  Droplets,
  Wind,
  Weight,
  Minus,
  BarChart3,
  Target,
  RefreshCw,
  Download,
  Timer,
  AlertCircle,
  List,
  LayoutGrid,
  BadgeCheck,
  Syringe,
  Beaker,
  Clipboard,
  CalendarCheck,
  CalendarClock,
  ArrowUpRight,
  ArrowDownRight,
  ListChecks,
  CheckCircle2,
  PanelRightOpen,
  PanelRightClose,
  Layers,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab =
  | 'Patients'
  | 'Encounters'
  | 'Protocols'
  | 'Pharmacy'
  | 'Lab'
  | 'Therapy'
  | 'Symptoms';
type ArtifactType =
  | 'Patient'
  | 'Encounter'
  | 'CareProtocol'
  | 'Prescription'
  | 'LabResult'
  | 'Treatment'
  | 'Symptom';
type Status = 'scheduled' | 'active' | 'completed' | 'cancelled' | 'archived';
type DetailSubTab = 'Overview' | 'Vitals' | 'Medications' | 'Labs' | 'History' | 'Appointments';
type PatientViewMode = 'cards' | 'timeline';

interface HealthcareArtifact {
  artifactType: ArtifactType;
  status: Status;
  description: string;
  provider?: string;
  date?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  notes?: string;
  patientId?: string;
  /* Vital Signs */
  heartRate?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  temperature?: number;
  respiratoryRate?: number;
  o2Sat?: number;
  weight?: number;
  height?: number;
  /* SOAP Note */
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  visitStart?: string;
  visitEnd?: string;
  chiefComplaint?: string;
  /* Medication */
  dosage?: string;
  frequency?: string;
  route?: string;
  startDate?: string;
  endDate?: string;
  isPRN?: boolean;
  refillsRemaining?: number;
  daysSupply?: number;
  adherencePercent?: number;
  interactions?: string[];
  /* Lab */
  testPanel?: string;
  resultValue?: string;
  referenceRange?: string;
  unit?: string;
  isCritical?: boolean;
  previousValue?: string;
  /* Care Plan */
  goals?: { name: string; target: string; current: string; percent: number }[];
  milestones?: { name: string; dueDate: string; completed: boolean }[];
  interventions?: string[];
  outcomeMeasure?: string;
  /* Symptom Tracker */
  symptomName?: string;
  severity?: number;
  symptomDate?: string;
  symptomNotes?: string;
  symptomCategory?: string;
  /* Appointments */
  appointmentDate?: string;
  appointmentTime?: string;
  appointmentType?: string;
  appointmentLocation?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: React.ElementType; defaultType: ArtifactType }[] = [
  { id: 'Patients', icon: Users, defaultType: 'Patient' },
  { id: 'Encounters', icon: Stethoscope, defaultType: 'Encounter' },
  { id: 'Protocols', icon: ClipboardList, defaultType: 'CareProtocol' },
  { id: 'Pharmacy', icon: Pill, defaultType: 'Prescription' },
  { id: 'Lab', icon: FlaskConical, defaultType: 'LabResult' },
  { id: 'Therapy', icon: Brain, defaultType: 'Treatment' },
  { id: 'Symptoms', icon: Thermometer, defaultType: 'Symptom' },
];

const ALL_STATUSES: Status[] = ['scheduled', 'active', 'completed', 'cancelled', 'archived'];

const STATUS_COLORS: Record<Status, string> = {
  scheduled: 'neon-blue',
  active: 'neon-green',
  completed: 'neon-cyan',
  cancelled: 'red-400',
  archived: 'gray-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
};

const COMMON_COMPLAINTS = [
  'Chest pain',
  'Shortness of breath',
  'Headache',
  'Abdominal pain',
  'Fever',
  'Cough',
  'Back pain',
  'Dizziness',
  'Fatigue',
  'Nausea',
  'Joint pain',
  'Rash',
  'Sore throat',
  'Anxiety',
  'Insomnia',
];

const COMMON_FINDINGS = [
  'Lungs clear to auscultation',
  'Heart regular rate and rhythm',
  'Abdomen soft, non-tender',
  'No peripheral edema',
  'Alert and oriented x3',
  'Pupils equal, round, reactive',
  'Normal gait and station',
  'Mucous membranes moist',
  'No lymphadenopathy',
  'Skin warm and dry',
];

const COMMON_DIAGNOSES = [
  'Hypertension (I10)',
  'Type 2 Diabetes (E11.9)',
  'Hyperlipidemia (E78.5)',
  'Major Depressive Disorder (F33.0)',
  'GERD (K21.0)',
  'Asthma (J45.20)',
  'Osteoarthritis (M17.11)',
  'Hypothyroidism (E03.9)',
  'Anxiety Disorder (F41.1)',
  'COPD (J44.1)',
  'Atrial Fibrillation (I48.91)',
  'Heart Failure (I50.9)',
];

const LAB_PANELS: Record<string, { name: string; tests: string[] }> = {
  CBC: {
    name: 'Complete Blood Count',
    tests: ['WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'Platelets', 'MCV', 'MCH'],
  },
  CMP: {
    name: 'Comprehensive Metabolic Panel',
    tests: [
      'Glucose',
      'BUN',
      'Creatinine',
      'Sodium',
      'Potassium',
      'Chloride',
      'CO2',
      'Calcium',
      'Albumin',
      'Bilirubin',
      'ALP',
      'AST',
      'ALT',
    ],
  },
  Lipid: {
    name: 'Lipid Panel',
    tests: ['Total Cholesterol', 'LDL', 'HDL', 'Triglycerides', 'VLDL'],
  },
  Thyroid: { name: 'Thyroid Panel', tests: ['TSH', 'Free T4', 'Free T3', 'T3 Uptake'] },
  HbA1c: { name: 'Hemoglobin A1c', tests: ['HbA1c'] },
  Coag: { name: 'Coagulation', tests: ['PT', 'INR', 'aPTT'] },
};

const VITAL_RANGES: Record<
  string,
  { low: number; high: number; critLow: number; critHigh: number; unit: string }
> = {
  heartRate: { low: 60, high: 100, critLow: 40, critHigh: 150, unit: 'bpm' },
  bpSystolic: { low: 90, high: 120, critLow: 70, critHigh: 180, unit: 'mmHg' },
  bpDiastolic: { low: 60, high: 80, critLow: 40, critHigh: 120, unit: 'mmHg' },
  temperature: { low: 97.0, high: 99.0, critLow: 95.0, critHigh: 103.0, unit: 'F' },
  respiratoryRate: { low: 12, high: 20, critLow: 8, critHigh: 30, unit: '/min' },
  o2Sat: { low: 95, high: 100, critLow: 88, critHigh: 101, unit: '%' },
};

const SYMPTOM_CATEGORIES = [
  'Neurological',
  'Respiratory',
  'Cardiovascular',
  'Gastrointestinal',
  'Musculoskeletal',
  'Dermatological',
  'Psychological',
  'General',
  'Other',
];

const APPOINTMENT_TYPES = [
  'Follow-up',
  'Annual Physical',
  'Specialist Referral',
  'Lab Work',
  'Imaging',
  'Procedure',
  'Telehealth',
  'Urgent Care',
  'Pre-op',
  'Post-op',
];

const seedItems: { title: string; data: HealthcareArtifact }[] = [];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getVitalColor(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return 'text-gray-300';
  if (value < range.critLow || value > range.critHigh) return 'text-red-400';
  if (value < range.low || value > range.high) return 'text-yellow-400';
  return 'text-green-400';
}

function getVitalBg(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return 'bg-gray-500/10';
  if (value < range.critLow || value > range.critHigh) return 'bg-red-500/10 border-red-500/30';
  if (value < range.low || value > range.high) return 'bg-yellow-500/10 border-yellow-500/30';
  return 'bg-green-500/10 border-green-500/30';
}

function isVitalCritical(key: string, value: number): boolean {
  const range = VITAL_RANGES[key];
  if (!range) return false;
  return value < range.critLow || value > range.critHigh;
}

/** Hex color for gauge arcs: green=normal, yellow=warning, red=critical */
function getVitalArcColor(key: string, value: number): string {
  const range = VITAL_RANGES[key];
  if (!range) return '#9ca3af';
  if (value < range.critLow || value > range.critHigh) return '#ef4444';
  if (value < range.low || value > range.high) return '#eab308';
  return '#22c55e';
}

/** SVG mini-gauge for vital signs (~60px) */
function VitalGauge({
  value,
  vitalKey,
  label,
  unit,
}: {
  value: number;
  vitalKey: string;
  label: string;
  unit: string;
}) {
  const range = VITAL_RANGES[vitalKey];
  if (!range) return null;
  const fullMin = range.critLow - (range.high - range.low) * 0.2;
  const fullMax = range.critHigh + (range.high - range.low) * 0.2;
  const pct = Math.min(1, Math.max(0, (value - fullMin) / (fullMax - fullMin)));
  const color = getVitalArcColor(vitalKey, value);
  const critical = isVitalCritical(vitalKey, value);
  const r = 24;
  const cx = 30;
  const cy = 30;
  const startAngle = -225;
  const endAngle = 45;
  const totalArc = endAngle - startAngle; // 270 degrees
  const circumference = 2 * Math.PI * r;
  const arcLength = (totalArc / 360) * circumference;
  const filledLength = arcLength * pct;
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative"
        style={critical ? { animation: 'pulse-critical 2s ease-in-out infinite' } : undefined}
      >
        <svg width="60" height="60" viewBox="0 0 60 60">
          {/* Background arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#374151"
            strokeWidth="5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle + 90}, ${cx}, ${cy})`}
          />
          {/* Filled arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle + 90}, ${cx}, ${cy})`}
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
          {/* Center value */}
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontSize="13"
            fontWeight="bold"
          >
            {value}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#9ca3af"
            fontSize="7"
          >
            {unit}
          </text>
        </svg>
      </div>
      <span className="text-[10px] text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}

/** Enhanced status badge with distinct background tints */
function StatusBadge({ status }: { status: Status }) {
  const baseColor = STATUS_COLORS[status] || 'gray-400';
  const config: Record<Status, { bg: string; text: string; border: string; label: string }> = {
    active: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Active',
    },
    scheduled: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Scheduled',
    },
    completed: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Completed',
    },
    cancelled: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Cancelled',
    },
    archived: {
      bg: `bg-${baseColor}/15`,
      text: `text-${baseColor}`,
      border: `border-${baseColor}/30`,
      label: 'Archived',
    },
  };
  const c = config[status] || config.archived;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        c.bg,
        c.text,
        c.border
      )}
    >
      {status === 'active' && (
        <span className={`w-1.5 h-1.5 rounded-full bg-${baseColor} animate-pulse`} />
      )}
      {c.label}
    </span>
  );
}

function calculateBMI(
  weightLbs: number,
  heightIn: number
): { value: number; category: string; color: string } {
  if (!weightLbs || !heightIn) return { value: 0, category: 'N/A', color: 'text-gray-400' };
  const bmi = (weightLbs / (heightIn * heightIn)) * 703;
  if (bmi < 18.5)
    return { value: Math.round(bmi * 10) / 10, category: 'Underweight', color: 'text-yellow-400' };
  if (bmi < 25)
    return { value: Math.round(bmi * 10) / 10, category: 'Normal', color: 'text-green-400' };
  if (bmi < 30)
    return { value: Math.round(bmi * 10) / 10, category: 'Overweight', color: 'text-yellow-400' };
  return { value: Math.round(bmi * 10) / 10, category: 'Obese', color: 'text-red-400' };
}

function calculateDaysRemaining(endDate?: string): number {
  if (!endDate) return -1;
  const end = new Date(endDate);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateVisitDuration(start?: string, end?: string): string {
  if (!start || !end) return '--';
  const s = new Date(start);
  const e = new Date(end);
  const mins = Math.round((e.getTime() - s.getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function isOutOfRange(value: string, refRange: string): boolean {
  if (!value || !refRange) return false;
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  const match = refRange.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (!match) return false;
  const lo = parseFloat(match[1]);
  const hi = parseFloat(match[2]);
  return num < lo || num > hi;
}

function getTrend(current?: string, previous?: string): 'up' | 'down' | 'stable' | 'none' {
  if (!current || !previous) return 'none';
  const c = parseFloat(current);
  const p = parseFloat(previous);
  if (isNaN(c) || isNaN(p)) return 'none';
  const diff = ((c - p) / p) * 100;
  if (Math.abs(diff) < 2) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HealthcareLensPage() {
  useLensNav('healthcare');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('healthcare');

  /* ---------- core state ---------- */
  const [activeTab, setActiveTab] = useState<ModeTab>('Patients');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [filterType, setFilterType] = useState<ArtifactType | 'all'>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<HealthcareArtifact> | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  /* ---------- generate care plan state ---------- */
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ content: string; title: string } | null>(
    null
  );
  const [generateError, setGenerateError] = useState<string | null>(null);

  /* ---------- patient detail drawer ---------- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState<LensItem<HealthcareArtifact> | null>(null);
  const [detailSubTab, setDetailSubTab] = useState<DetailSubTab>('Overview');
  const [patientViewMode, setPatientViewMode] = useState<PatientViewMode>('cards');

  /* ---------- SOAP note state ---------- */
  const [soapSubjective, setSoapSubjective] = useState('');
  const [soapObjective, setSoapObjective] = useState('');
  const [soapAssessment, setSoapAssessment] = useState('');
  const [soapPlan, setSoapPlan] = useState('');
  const [soapComplaint, setSoapComplaint] = useState('');
  const [soapVisitStart, setSoapVisitStart] = useState('');
  const [soapVisitEnd, setSoapVisitEnd] = useState('');
  const [showComplaintPicker, setShowComplaintPicker] = useState(false);
  const [showFindingPicker, setShowFindingPicker] = useState(false);
  const [showDxPicker, setShowDxPicker] = useState(false);

  /* ---------- vitals entry ---------- */
  const [vitalsHR, setVitalsHR] = useState('');
  const [vitalsBPSys, setVitalsBPSys] = useState('');
  const [vitalsBPDia, setVitalsBPDia] = useState('');
  const [vitalsTemp, setVitalsTemp] = useState('');
  const [vitalsRR, setVitalsRR] = useState('');
  const [vitalsO2, setVitalsO2] = useState('');
  const [vitalsWeight, setVitalsWeight] = useState('');
  const [vitalsHeight, setVitalsHeight] = useState('');

  /* ---------- care plan builder ---------- */
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneDue, setNewMilestoneDue] = useState('');
  const [newIntervention, setNewIntervention] = useState('');

  /* ---------- lab panel filter ---------- */
  const [labPanelFilter, setLabPanelFilter] = useState<string>('all');

  /* ---------- medication form fields ---------- */
  const [formDosage, setFormDosage] = useState('');
  const [formFrequency, setFormFrequency] = useState('');
  const [formRoute, setFormRoute] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formIsPRN, setFormIsPRN] = useState(false);
  const [formRefills, setFormRefills] = useState('');
  const [formDaysSupply, setFormDaysSupply] = useState('');
  const [formInteractions, setFormInteractions] = useState('');

  /* ---------- symptom form fields ---------- */
  const [formSymptomName, setFormSymptomName] = useState('');
  const [formSeverity, setFormSeverity] = useState(5);
  const [formSymptomDate, setFormSymptomDate] = useState('');
  const [formSymptomNotes, setFormSymptomNotes] = useState('');
  const [formSymptomCategory, setFormSymptomCategory] = useState('General');

  /* ---------- lab form fields ---------- */
  const [formTestPanel, setFormTestPanel] = useState('');
  const [formResultValue, setFormResultValue] = useState('');
  const [formReferenceRange, setFormReferenceRange] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formIsCritical, setFormIsCritical] = useState(false);

  /* ---------- appointment form fields ---------- */
  const [formApptDate, setFormApptDate] = useState('');
  const [formApptTime, setFormApptTime] = useState('');
  const [formApptType, setFormApptType] = useState('Follow-up');
  const [formApptLocation, setFormApptLocation] = useState('');

  /* ---------- medication filter ---------- */
  const [medFilter, setMedFilter] = useState<'all' | 'scheduled' | 'prn'>('all');

  /* ---------- dashboard expanded ---------- */
  const [dashboardExpanded, setDashboardExpanded] = useState(false);

  // Editor form state
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<ArtifactType>('Patient');
  const [formStatus, setFormStatus] = useState<Status>('scheduled');
  const [formDescription, setFormDescription] = useState('');
  const [formProvider, setFormProvider] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formPriority, setFormPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [formNotes, setFormNotes] = useState('');

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<HealthcareArtifact>('healthcare', 'artifact', {
      seed: seedItems.map((s) => ({
        title: s.title,
        data: s.data as unknown as Record<string, unknown>,
        meta: { status: s.data.status, tags: [s.data.artifactType] },
      })),
    });

  const runAction = useRunArtifact('healthcare');

  /* ---------- derived data ---------- */

  const currentTabType = MODE_TABS.find((t) => t.id === activeTab)?.defaultType ?? 'Patient';

  const filtered = useMemo(() => {
    let list = items;
    list = list.filter(
      (i) => (i.data as unknown as HealthcareArtifact).artifactType === currentTabType
    );
    if (filterStatus !== 'all')
      list = list.filter((i) => (i.data as unknown as HealthcareArtifact).status === filterStatus);
    if (filterType !== 'all')
      list = list.filter(
        (i) => (i.data as unknown as HealthcareArtifact).artifactType === filterType
      );
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as HealthcareArtifact).description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, currentTabType, filterStatus, filterType, searchQuery]);

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((i) => (i.data as unknown as HealthcareArtifact).status === 'active')
        .length,
      scheduled: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).status === 'scheduled'
      ).length,
      completed: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).status === 'completed'
      ).length,
      urgent: items.filter(
        (i) =>
          (i.data as unknown as HealthcareArtifact).priority === 'urgent' ||
          (i.data as unknown as HealthcareArtifact).priority === 'high'
      ).length,
      patients: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'Patient'
      ).length,
      encounters: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'Encounter'
      ).length,
      prescriptions: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'Prescription'
      ).length,
      labs: items.filter(
        (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'LabResult'
      ).length,
      pendingLabs: items.filter(
        (i) =>
          (i.data as unknown as HealthcareArtifact).artifactType === 'LabResult' &&
          (i.data as unknown as HealthcareArtifact).status === 'scheduled'
      ).length,
      criticalLabs: items.filter(
        (i) =>
          (i.data as unknown as HealthcareArtifact).artifactType === 'LabResult' &&
          (i.data as unknown as HealthcareArtifact).isCritical
      ).length,
      todayEncounters: items.filter((i) => {
        const d = i.data as unknown as HealthcareArtifact;
        return d.artifactType === 'Encounter' && d.date === new Date().toISOString().split('T')[0];
      }).length,
      overdueFollowups: items.filter((i) => {
        const d = i.data as unknown as HealthcareArtifact;
        if (d.artifactType !== 'Encounter' || d.status !== 'scheduled') return false;
        return d.date ? new Date(d.date) < new Date() : false;
      }).length,
    }),
    [items]
  );

  /* ---------- linked records for a patient ---------- */
  const getPatientLinked = useCallback(
    (patientId: string) => {
      return items
        .filter((i) => {
          const d = i.data as unknown as HealthcareArtifact;
          return d.patientId === patientId && d.artifactType !== 'Patient';
        })
        .sort((a, b) => {
          const da = (a.data as unknown as HealthcareArtifact).date || '';
          const db = (b.data as unknown as HealthcareArtifact).date || '';
          return db.localeCompare(da);
        });
    },
    [items]
  );

  /* ---------- medication helpers ---------- */
  const filteredMeds = useMemo(() => {
    let meds = filtered;
    if (medFilter === 'prn')
      meds = meds.filter((i) => (i.data as unknown as HealthcareArtifact).isPRN);
    if (medFilter === 'scheduled')
      meds = meds.filter((i) => !(i.data as unknown as HealthcareArtifact).isPRN);
    return meds;
  }, [filtered, medFilter]);

  /* ---------- lab helpers ---------- */
  const filteredLabs = useMemo(() => {
    if (labPanelFilter === 'all') return filtered;
    return filtered.filter(
      (i) => (i.data as unknown as HealthcareArtifact).testPanel === labPanelFilter
    );
  }, [filtered, labPanelFilter]);

  /* ---------- editor helpers ---------- */

  const openNewEditor = () => {
    setEditingItem(null);
    setFormTitle('');
    setFormType(currentTabType);
    setFormStatus('scheduled');
    setFormDescription('');
    setFormProvider('');
    setFormDate('');
    setFormPriority('medium');
    setFormNotes('');
    setSoapSubjective('');
    setSoapObjective('');
    setSoapAssessment('');
    setSoapPlan('');
    setSoapComplaint('');
    setSoapVisitStart('');
    setSoapVisitEnd('');
    setVitalsHR('');
    setVitalsBPSys('');
    setVitalsBPDia('');
    setVitalsTemp('');
    setVitalsRR('');
    setVitalsO2('');
    setVitalsWeight('');
    setVitalsHeight('');
    setFormDosage('');
    setFormFrequency('');
    setFormRoute('');
    setFormStartDate('');
    setFormEndDate('');
    setFormIsPRN(false);
    setFormRefills('');
    setFormDaysSupply('');
    setFormInteractions('');
    setFormSymptomName('');
    setFormSeverity(5);
    setFormSymptomDate(new Date().toISOString().split('T')[0]);
    setFormSymptomNotes('');
    setFormSymptomCategory('General');
    setFormTestPanel('');
    setFormResultValue('');
    setFormReferenceRange('');
    setFormUnit('');
    setFormIsCritical(false);
    setFormApptDate('');
    setFormApptTime('');
    setFormApptType('Follow-up');
    setFormApptLocation('');
    setShowEditor(true);
  };

  const openEditEditor = (item: LensItem<HealthcareArtifact>) => {
    const d = item.data as unknown as HealthcareArtifact;
    setEditingItem(item);
    setFormTitle(item.title);
    setFormType(d.artifactType);
    setFormStatus(d.status);
    setFormDescription(d.description || '');
    setFormProvider(d.provider || '');
    setFormDate(d.date || '');
    setFormPriority(d.priority || 'medium');
    setFormNotes(d.notes || '');
    setSoapSubjective(d.soapSubjective || '');
    setSoapObjective(d.soapObjective || '');
    setSoapAssessment(d.soapAssessment || '');
    setSoapPlan(d.soapPlan || '');
    setSoapComplaint(d.chiefComplaint || '');
    setSoapVisitStart(d.visitStart || '');
    setSoapVisitEnd(d.visitEnd || '');
    setVitalsHR(d.heartRate?.toString() || '');
    setVitalsBPSys(d.bpSystolic?.toString() || '');
    setVitalsBPDia(d.bpDiastolic?.toString() || '');
    setVitalsTemp(d.temperature?.toString() || '');
    setVitalsRR(d.respiratoryRate?.toString() || '');
    setVitalsO2(d.o2Sat?.toString() || '');
    setVitalsWeight(d.weight?.toString() || '');
    setVitalsHeight(d.height?.toString() || '');
    setFormDosage(d.dosage || '');
    setFormFrequency(d.frequency || '');
    setFormRoute(d.route || '');
    setFormStartDate(d.startDate || '');
    setFormEndDate(d.endDate || '');
    setFormIsPRN(d.isPRN || false);
    setFormRefills(d.refillsRemaining?.toString() || '');
    setFormDaysSupply(d.daysSupply?.toString() || '');
    setFormInteractions((d.interactions || []).join(', '));
    setFormSymptomName(d.symptomName || '');
    setFormSeverity(d.severity ?? 5);
    setFormSymptomDate(d.symptomDate || '');
    setFormSymptomNotes(d.symptomNotes || '');
    setFormSymptomCategory(d.symptomCategory || 'General');
    setFormTestPanel(d.testPanel || '');
    setFormResultValue(d.resultValue || '');
    setFormReferenceRange(d.referenceRange || '');
    setFormUnit(d.unit || '');
    setFormIsCritical(d.isCritical || false);
    setFormApptDate(d.appointmentDate || '');
    setFormApptTime(d.appointmentTime || '');
    setFormApptType(d.appointmentType || 'Follow-up');
    setFormApptLocation(d.appointmentLocation || '');
    setShowEditor(true);
  };

  const openDetailDrawer = (item: LensItem<HealthcareArtifact>) => {
    setDrawerItem(item);
    setDetailSubTab('Overview');
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      title: formTitle,
      data: {
        artifactType: formType,
        status: formStatus,
        description: formDescription,
        provider: formProvider,
        date: formDate,
        priority: formPriority,
        notes: formNotes,
        ...(formType === 'Encounter' && {
          soapSubjective,
          soapObjective,
          soapAssessment,
          soapPlan,
          chiefComplaint: soapComplaint,
          visitStart: soapVisitStart,
          visitEnd: soapVisitEnd,
        }),
        ...(formType === 'Patient' && {
          heartRate: vitalsHR ? Number(vitalsHR) : undefined,
          bpSystolic: vitalsBPSys ? Number(vitalsBPSys) : undefined,
          bpDiastolic: vitalsBPDia ? Number(vitalsBPDia) : undefined,
          temperature: vitalsTemp ? Number(vitalsTemp) : undefined,
          respiratoryRate: vitalsRR ? Number(vitalsRR) : undefined,
          o2Sat: vitalsO2 ? Number(vitalsO2) : undefined,
          weight: vitalsWeight ? Number(vitalsWeight) : undefined,
          height: vitalsHeight ? Number(vitalsHeight) : undefined,
          appointmentDate: formApptDate || undefined,
          appointmentTime: formApptTime || undefined,
          appointmentType: formApptType || undefined,
          appointmentLocation: formApptLocation || undefined,
        }),
        ...(formType === 'Prescription' && {
          dosage: formDosage || undefined,
          frequency: formFrequency || undefined,
          route: formRoute || undefined,
          startDate: formStartDate || undefined,
          endDate: formEndDate || undefined,
          isPRN: formIsPRN,
          refillsRemaining: formRefills ? Number(formRefills) : undefined,
          daysSupply: formDaysSupply ? Number(formDaysSupply) : undefined,
          interactions: formInteractions
            ? formInteractions
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        }),
        ...(formType === 'LabResult' && {
          testPanel: formTestPanel || undefined,
          resultValue: formResultValue || undefined,
          referenceRange: formReferenceRange || undefined,
          unit: formUnit || undefined,
          isCritical: formIsCritical,
        }),
        ...(formType === 'Symptom' && {
          symptomName: formSymptomName || undefined,
          severity: formSeverity,
          symptomDate: formSymptomDate || undefined,
          symptomNotes: formSymptomNotes || undefined,
          symptomCategory: formSymptomCategory || undefined,
        }),
      } as unknown as Partial<HealthcareArtifact>,
      meta: { status: formStatus, tags: [formType] },
    };
    if (editingItem) {
      await update(editingItem.id, payload);
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
        setActionResult(result.result as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  const handleGenerateCarePlan = useCallback(async () => {
    const symptomItems = items.filter(
      (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'Symptom'
    );
    const symptoms = symptomItems
      .map((i) => {
        const d = i.data as unknown as HealthcareArtifact;
        return `${d.symptomName || i.title} (severity: ${d.severity ?? 'unknown'}, category: ${d.symptomCategory || 'General'})`;
      })
      .join('; ');
    if (!symptoms) return;
    setGenerateLoading(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'healthcare',
        action: 'generate',
        input: { symptoms, type: 'care-plan' },
      });
      const data = res.data;
      const content =
        typeof data?.result === 'string'
          ? data.result
          : typeof data?.result?.content === 'string'
            ? data.result.content
            : JSON.stringify(data?.result ?? data, null, 2);
      setGenerateResult({
        content,
        title: data?.result?.title || 'Generated Care Plan',
      });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate care plan');
    } finally {
      setGenerateLoading(false);
    }
  }, [items]);

  const handleDownloadResult = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ---------- render ---------- */

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

  /* ================================================================== */
  /*  VITAL SIGN CARD (reusable)                                        */
  /* ================================================================== */
  const VitalCard = ({
    label,
    value,
    vitalKey,
    icon: Icon,
    unit,
  }: {
    label: string;
    value?: number;
    vitalKey: string;
    icon: React.ElementType;
    unit?: string;
  }) => {
    const range = VITAL_RANGES[vitalKey];
    const displayUnit = unit || range?.unit || '';
    const critical = value !== undefined && isVitalCritical(vitalKey, value);
    return (
      <div
        className={cn(
          'rounded-lg border p-3 flex items-center gap-3',
          value ? getVitalBg(vitalKey, value) : 'bg-gray-500/10 border-lattice-border',
          critical && 'pulse-critical-glow'
        )}
      >
        {/* SVG Gauge */}
        {value !== undefined && range ? (
          <VitalGauge value={value} vitalKey={vitalKey} label="" unit={displayUnit} />
        ) : (
          <div className="w-[60px] h-[60px] flex items-center justify-center">
            <Icon className="w-6 h-6 text-gray-500" />
          </div>
        )}
        {/* Label + range */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Icon
              className={cn(
                'w-3.5 h-3.5',
                value ? getVitalColor(vitalKey, value) : 'text-gray-500'
              )}
            />
            <span className={cn(ds.textMuted, 'text-xs')}>{label}</span>
          </div>
          <p
            className={cn(
              'text-lg font-bold',
              value ? getVitalColor(vitalKey, value) : 'text-gray-500'
            )}
          >
            {value ?? '--'}
            <span className="text-xs font-normal ml-1">{displayUnit}</span>
          </p>
          {range && (
            <p className="text-[10px] text-gray-500">
              {range.low}-{range.high} {displayUnit}
            </p>
          )}
        </div>
      </div>
    );
  };

  /* ================================================================== */
  /*  TIMELINE ITEM (for patient timeline view)                         */
  /* ================================================================== */
  const TimelineItem = ({ item }: { item: LensItem<HealthcareArtifact> }) => {
    const d = item.data as unknown as HealthcareArtifact;
    const typeIcons: Record<string, React.ElementType> = {
      Encounter: Stethoscope,
      Prescription: Pill,
      LabResult: FlaskConical,
      Treatment: Brain,
      CareProtocol: ClipboardList,
      Patient: Users,
    };
    const TypeIcon = typeIcons[d.artifactType] || FileText;
    return (
      <div className="flex gap-4 relative pl-6 pb-6 group">
        <div className="absolute left-0 top-0 bottom-0 w-px bg-lattice-border group-last:hidden" />
        <div
          className={cn(
            'absolute left-[-5px] top-1 w-[11px] h-[11px] rounded-full border-2 border-lattice-border',
            d.status === 'active'
              ? 'bg-green-400'
              : d.status === 'completed'
                ? 'bg-neon-cyan'
                : 'bg-gray-600'
          )}
        />
        <div className={cn(ds.panelHover, 'flex-1')} onClick={() => openEditEditor(item)}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <TypeIcon className="w-4 h-4 text-gray-400" />
              <span className={ds.heading3}>{item.title}</span>
            </div>
            <StatusBadge status={d.status} />
          </div>
          <p className={cn(ds.textMuted, 'line-clamp-2 mb-2')}>{d.description}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {d.date && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {d.date}
              </span>
            )}
            {d.provider && <span>{d.provider}</span>}
            <span className={ds.badge('gray-400')}>{d.artifactType}</span>
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================== */
  /*  MEDICATION ROW (for pharmacy tab)                                 */
  /* ================================================================== */
  const MedicationRow = ({ item }: { item: LensItem<HealthcareArtifact> }) => {
    const d = item.data as unknown as HealthcareArtifact;
    const daysLeft = calculateDaysRemaining(d.endDate);
    const adherence = d.adherencePercent ?? 0;
    return (
      <div className={cn(ds.panelHover, 'space-y-2')} onClick={() => openEditEditor(item)}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
              {d.isPRN && <span className={ds.badge('neon-blue')}>PRN</span>}
              <StatusBadge status={d.status} />
            </div>
            <p className={ds.textMuted}>{d.description}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-gray-500 block">Dosage</span>
            <span className="text-gray-200 font-medium">{d.dosage || '--'}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Frequency</span>
            <span className="text-gray-200 font-medium">{d.frequency || '--'}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Route</span>
            <span className="text-gray-200 font-medium">{d.route || '--'}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Start Date</span>
            <span className="text-gray-200 font-medium">{d.startDate || d.date || '--'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          {/* Refill tracking */}
          <div className="flex items-center gap-2 text-xs">
            <RefreshCw className="w-3 h-3 text-gray-500" />
            <span className="text-gray-400">
              Refills:{' '}
              <span className="text-gray-200 font-medium">{d.refillsRemaining ?? '--'}</span>
            </span>
          </div>
          {/* Days remaining */}
          {daysLeft >= 0 && (
            <div
              className={cn(
                'flex items-center gap-1 text-xs',
                daysLeft <= 7
                  ? 'text-red-400'
                  : daysLeft <= 14
                    ? 'text-yellow-400'
                    : 'text-gray-400'
              )}
            >
              <Timer className="w-3 h-3" />
              {daysLeft} days remaining
            </div>
          )}
          {/* Adherence */}
          <div className="flex items-center gap-2 text-xs flex-1">
            <span className="text-gray-500">Adherence:</span>
            <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-[80px]">
              <div
                className={cn(
                  'h-full rounded-full',
                  adherence >= 80
                    ? 'bg-green-400'
                    : adherence >= 50
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                )}
                style={{ width: `${Math.min(adherence, 100)}%` }}
              />
            </div>
            <span
              className={cn(
                adherence >= 80
                  ? 'text-green-400'
                  : adherence >= 50
                    ? 'text-yellow-400'
                    : 'text-red-400'
              )}
            >
              {adherence}%
            </span>
          </div>
        </div>
        {/* Interaction alerts */}
        {d.interactions && d.interactions.length > 0 && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-1 text-xs text-red-400 mb-1">
              <AlertTriangle className="w-3 h-3" /> Drug Interactions Detected
            </div>
            {d.interactions.map((inter, idx) => (
              <p key={idx} className="text-xs text-red-300 ml-4">
                - {inter}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  /* ================================================================== */
  /*  LAB RESULT ROW (for lab tab)                                      */
  /* ================================================================== */
  const LabResultRow = ({ item }: { item: LensItem<HealthcareArtifact> }) => {
    const d = item.data as unknown as HealthcareArtifact;
    const outOfRange = isOutOfRange(d.resultValue || '', d.referenceRange || '');
    const trend = getTrend(d.resultValue, d.previousValue);
    return (
      <div
        className={cn(ds.panelHover, d.isCritical && 'border-red-500/50 pulse-critical-glow')}
        onClick={() => openEditEditor(item)}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
              {d.isCritical && (
                <span className={cn(ds.badge('red-400'), 'animate-pulse')}>
                  <AlertCircle className="w-3 h-3" /> CRITICAL
                </span>
              )}
              {d.testPanel && <span className={ds.badge('neon-cyan')}>{d.testPanel}</span>}
              <StatusBadge status={d.status} />
            </div>
            <p className={cn(ds.textMuted, 'mt-1')}>{d.description}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-gray-500 block">Result</span>
            <span
              className={cn(
                'font-bold text-sm',
                outOfRange ? 'text-red-400' : 'text-green-400',
                outOfRange && 'pulse-critical-glow rounded px-1'
              )}
            >
              {d.resultValue || '--'} {d.unit || ''}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Reference Range</span>
            <span className="text-gray-200">
              {d.referenceRange || '--'} {d.unit || ''}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Trend</span>
            <span className="flex items-center gap-1">
              {trend === 'up' && (
                <ArrowUpRight
                  className={cn('w-4 h-4', outOfRange ? 'text-red-400' : 'text-yellow-400')}
                />
              )}
              {trend === 'down' && (
                <ArrowDownRight
                  className={cn('w-4 h-4', outOfRange ? 'text-red-400' : 'text-yellow-400')}
                />
              )}
              {trend === 'stable' && <Minus className="w-4 h-4 text-green-400" />}
              {trend === 'none' && <span className="text-gray-500">--</span>}
              {d.previousValue && <span className="text-gray-400">(prev: {d.previousValue})</span>}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Date</span>
            <span className="text-gray-200">{d.date || '--'}</span>
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================== */
  /*  CARE PLAN CARD (for therapy tab)                                  */
  /* ================================================================== */
  const CarePlanCard = ({ item }: { item: LensItem<HealthcareArtifact> }) => {
    const d = item.data as unknown as HealthcareArtifact;
    const goals = d.goals || [];
    const milestones = d.milestones || [];
    const interventions = d.interventions || [];
    const overallProgress =
      goals.length > 0 ? Math.round(goals.reduce((s, g) => s + g.percent, 0) / goals.length) : 0;
    return (
      <div className={cn(ds.panelHover, 'space-y-3')} onClick={() => openEditEditor(item)}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
            <p className={cn(ds.textMuted, 'mt-1')}>{d.description}</p>
          </div>
          <StatusBadge status={d.status} />
        </div>
        {/* Overall progress bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-400">Overall Progress</span>
            <span
              className={cn(
                overallProgress >= 75
                  ? 'text-green-400'
                  : overallProgress >= 40
                    ? 'text-yellow-400'
                    : 'text-gray-400'
              )}
            >
              {overallProgress}%
            </span>
          </div>
          <div className="bg-gray-800 rounded-full h-2">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                overallProgress >= 75
                  ? 'bg-green-400'
                  : overallProgress >= 40
                    ? 'bg-yellow-400'
                    : 'bg-neon-blue'
              )}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
        {/* Goals summary */}
        {goals.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
              Goals ({goals.length})
            </span>
            {goals.slice(0, 3).map((g, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 flex-1">
                  <Target
                    className={cn('w-3 h-3', g.percent >= 100 ? 'text-green-400' : 'text-gray-500')}
                  />
                  <span className="text-gray-300 truncate">{g.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="bg-gray-800 rounded-full h-1 w-16">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        g.percent >= 100 ? 'bg-green-400' : 'bg-neon-blue'
                      )}
                      style={{ width: `${Math.min(g.percent, 100)}%` }}
                    />
                  </div>
                  <span className="text-gray-400 w-8 text-right">{g.percent}%</span>
                </div>
              </div>
            ))}
            {goals.length > 3 && (
              <p className="text-xs text-gray-500">+{goals.length - 3} more goals</p>
            )}
          </div>
        )}
        {/* Milestones summary */}
        {milestones.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <ListChecks className="w-3 h-3" />
            {milestones.filter((m) => m.completed).length}/{milestones.length} milestones complete
          </div>
        )}
        {/* Interventions */}
        {interventions.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Syringe className="w-3 h-3" />
            {interventions.length} interventions
          </div>
        )}
        {/* Outcome */}
        {d.outcomeMeasure && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <BarChart3 className="w-3 h-3" />
            Outcome: {d.outcomeMeasure}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-lens-theme="healthcare"
      className="p-6 space-y-6 bg-gradient-to-b from-blue-950/20 to-transparent"
    >
      {/* Critical pulse animation */}
      <style>{`
        @keyframes pulse-critical {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 8px 4px rgba(239,68,68,0.2); }
        }
        .pulse-critical-glow {
          animation: pulse-critical 2s ease-in-out infinite;
        }
      `}</style>
      {/* Sub-Lenses */}
      <SubLensQuickNav lensId="healthcare" />
      {/* ============================================================ */}
      {/* Compliance Banner                                            */}
      {/* ============================================================ */}
      <div className="bg-blue-500/10 border border-blue-400/20 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm">
        <AlertTriangle className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-blue-200">
            Not medical advice. This tool assists with record organization only. It is not a
            certified EHR and should not be used for clinical decision-making. Always consult a
            qualified healthcare provider. Consult applicable regulations (HIPAA, etc.) for your
            jurisdiction.
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-xs text-blue-400/70">
              <ShieldCheck className="w-3 h-3" />
              HIPAA Aware
            </span>
            <span className="flex items-center gap-1 text-xs text-blue-400/70">
              <BadgeCheck className="w-3 h-3" />
              Audit Trail
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Header                                                       */}
      {/* ============================================================ */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center">
            <Heart className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-blue-50">Healthcare</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Clinical record organization and care coordination</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setDrawerOpen(!drawerOpen);
            }}
            className={ds.btnGhost}
          >
            {drawerOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
          <button onClick={openNewEditor} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> New Record
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Patients',
            value:
              items.filter((i) => (i.data as unknown as HealthcareArtifact).type === 'patient')
                .length || items.length,
            icon: Users,
          },
          {
            label: 'Appointments',
            value: items.filter(
              (i) => (i.data as unknown as HealthcareArtifact).type === 'appointment'
            ).length,
            icon: Calendar,
          },
          {
            label: 'Vitals Tracked',
            value: items.filter((i) => (i.data as unknown as HealthcareArtifact).type === 'vitals')
              .length,
            icon: Activity,
          },
          {
            label: 'Active',
            value: items.filter((i) => i.meta?.status === 'active').length,
            icon: Heart,
          },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="healthcare" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel
        domain="healthcare"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />
      <DTUExportButton domain="healthcare" data={{}} compact />
      <VisionAnalyzeButton
        domain="healthcare"
        prompt="Analyze this medical image. Describe visible findings, suggest relevant clinical tags, and note anything that may warrant further review. IMPORTANT: This is AI-assisted and must be verified by a licensed healthcare professional."
        onResult={(res) => {
          setFormDescription((prev) =>
            prev
              ? `${prev}\n\n[Vision Analysis - NOT a clinical diagnosis]\n${res.analysis}`
              : `[Vision Analysis - NOT a clinical diagnosis]\n${res.analysis}`
          );
          if (res.suggestedTags?.length)
            setFormNotes((prev) =>
              prev
                ? `${prev}\nSuggested tags: ${res.suggestedTags!.join(', ')}`
                : `Suggested tags: ${res.suggestedTags!.join(', ')}`
            );
        }}
        className="inline-flex"
      />
      {/* ============================================================ */}
      {/* Mode Tabs                                                    */}
      {/* ============================================================ */}
      <nav className="flex items-center gap-1 border-b border-blue-900/20 pb-3 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setFilterStatus('all');
              setFilterType('all');
            }}
            className={cn(
              ds.btnGhost,
              'whitespace-nowrap rounded-lg',
              activeTab === tab.id && 'bg-blue-500/15 text-blue-400 border-blue-400/20'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.id}
          </button>
        ))}
      </nav>

      {/* ============================================================ */}
      {/* Enhanced Dashboard Overview                                   */}
      {/* ============================================================ */}
      <div className="space-y-4">
        <div className={ds.grid4}>
          <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-xl border border-blue-400/15 p-4 shadow-sm">
            <Activity className="w-5 h-5 text-blue-400 mb-2" />
            <p className="text-2xl font-bold text-white">{stats.active}</p>
            <p className="text-sm text-blue-300/60">Active</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-600/5 rounded-xl border border-blue-400/15 p-4 shadow-sm">
            <Calendar className="w-5 h-5 text-cyan-400 mb-2" />
            <p className="text-2xl font-bold text-white">{stats.scheduled}</p>
            <p className="text-sm text-blue-300/60">Scheduled</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-500/10 to-blue-600/5 rounded-xl border border-blue-400/15 p-4 shadow-sm">
            <CheckCircle className="w-5 h-5 text-emerald-400 mb-2" />
            <p className="text-2xl font-bold text-white">{stats.completed}</p>
            <p className="text-sm text-blue-300/60">Completed</p>
          </div>
          <div className="bg-gradient-to-br from-red-500/10 to-blue-600/5 rounded-xl border border-red-400/15 p-4 shadow-sm">
            <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
            <p className="text-2xl font-bold text-white">{stats.urgent}</p>
            <p className="text-sm text-blue-300/60">High Priority</p>
          </div>
        </div>

        {/* Expandable detailed dashboard */}
        <button
          onClick={() => setDashboardExpanded(!dashboardExpanded)}
          className={cn(ds.btnGhost, 'text-xs w-full justify-center')}
        >
          {dashboardExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          {dashboardExpanded ? 'Collapse Dashboard' : 'Expand Dashboard'}
        </button>

        {dashboardExpanded && (
          <div className={ds.grid4}>
            <div className={cn(ds.panel, 'space-y-2')}>
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-neon-blue" />
                <span className="text-sm font-medium text-white">Today&apos;s Schedule</span>
              </div>
              <p className="text-3xl font-bold text-neon-blue">{stats.todayEncounters}</p>
              <p className={ds.textMuted}>encounters today</p>
            </div>
            <div className={cn(ds.panel, 'space-y-2')}>
              <div className="flex items-center gap-2">
                <Beaker className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-white">Pending Labs</span>
              </div>
              <p className="text-3xl font-bold text-yellow-400">{stats.pendingLabs}</p>
              <p className={ds.textMuted}>awaiting review</p>
            </div>
            <div className={cn(ds.panel, 'space-y-2')}>
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-medium text-white">Overdue Follow-ups</span>
              </div>
              <p className="text-3xl font-bold text-orange-400">{stats.overdueFollowups}</p>
              <p className={ds.textMuted}>need rescheduling</p>
            </div>
            <div className={cn(ds.panel, 'space-y-2')}>
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-white">Critical Alerts</span>
              </div>
              <p className="text-3xl font-bold text-red-400">{stats.criticalLabs}</p>
              <p className={ds.textMuted}>critical lab values</p>
            </div>
            {/* Patient census */}
            <div className={cn(ds.panel, 'md:col-span-2 lg:col-span-4')}>
              <h3 className={cn(ds.heading3, 'text-sm mb-3')}>Patient Census</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{stats.patients}</p>
                  <p className="text-xs text-gray-500">Patients</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{stats.encounters}</p>
                  <p className="text-xs text-gray-500">Encounters</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{stats.prescriptions}</p>
                  <p className="text-xs text-gray-500">Prescriptions</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{stats.labs}</p>
                  <p className="text-xs text-gray-500">Lab Results</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{stats.total}</p>
                  <p className="text-xs text-gray-500">Total Records</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Enhanced Domain Actions                                      */}
      {/* ============================================================ */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleAction('checkInteractions')} className={ds.btnSecondary}>
          <ShieldCheck className="w-4 h-4" /> Check Drug Interactions
        </button>
        <button onClick={() => handleAction('protocolMatch')} className={ds.btnSecondary}>
          <ClipboardList className="w-4 h-4" /> Protocol Match
        </button>
        <button onClick={() => handleAction('generateSummary')} className={ds.btnSecondary}>
          <FileText className="w-4 h-4" /> Generate Summary
        </button>
        <button onClick={() => handleAction('exportEncounter')} className={ds.btnSecondary}>
          <Download className="w-4 h-4" /> Export Encounter
        </button>
        <button onClick={() => handleAction('soapAutoFill')} className={ds.btnSecondary}>
          <Clipboard className="w-4 h-4" /> SOAP Auto-Fill
        </button>
        {runAction.isPending && (
          <span className="text-xs text-neon-blue animate-pulse">Running...</span>
        )}
      </div>

      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleDownloadResult(
                    typeof actionResult === 'object'
                      ? JSON.stringify(actionResult, null, 2)
                      : String(actionResult),
                    'healthcare-result.txt'
                  )
                }
                className={cn(ds.btnGhost, 'text-xs')}
              >
                <Download className="w-3.5 h-3.5 mr-1" /> Download
              </button>
              <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {typeof actionResult === 'object' && 'content' in actionResult && actionResult.content ? (
            <div className="prose prose-invert prose-sm max-w-none">
              {actionResult.title ? (
                <h4 className="text-sm font-semibold text-neon-cyan mb-2">
                  {String(actionResult.title)}
                </h4>
              ) : null}
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                {String(actionResult.content)}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* checkInteractions */}
              {actionResult.interactionsFound !== undefined && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {String(actionResult.totalChecked)}
                      </p>
                      <p className="text-[10px] text-gray-500">Prescriptions</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p
                        className={`text-sm font-bold ${Number(actionResult.interactionsFound) > 0 ? 'text-red-400' : 'text-green-400'}`}
                      >
                        {String(actionResult.interactionsFound)}
                      </p>
                      <p className="text-[10px] text-gray-500">Interactions</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p
                        className={`text-sm font-bold ${actionResult.hasCritical ? 'text-red-400' : 'text-green-400'}`}
                      >
                        {actionResult.hasCritical ? 'Critical' : 'Safe'}
                      </p>
                      <p className="text-[10px] text-gray-500">Risk Level</p>
                    </div>
                  </div>
                  {Array.isArray(actionResult.interactions) &&
                    (
                      actionResult.interactions as {
                        drugs: string[];
                        severity: string;
                        description: string;
                      }[]
                    ).map((ix, i) => (
                      <div key={i} className="p-2 bg-lattice-surface rounded">
                        <p className="text-xs font-semibold text-white">{ix.drugs.join(' + ')}</p>
                        <p
                          className={`text-[10px] font-semibold ${ix.severity === 'critical' ? 'text-red-400' : ix.severity === 'major' ? 'text-orange-400' : 'text-amber-400'}`}
                        >
                          {ix.severity.toUpperCase()}
                        </p>
                        {ix.description && (
                          <p className="text-[10px] text-gray-400 mt-0.5">{ix.description}</p>
                        )}
                      </div>
                    ))}
                </div>
              )}
              {/* protocolMatch */}
              {actionResult.conditionsEvaluated !== undefined && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {String(actionResult.conditionsEvaluated)}
                      </p>
                      <p className="text-[10px] text-gray-500">Conditions</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-green-400">
                        {Array.isArray(actionResult.matched)
                          ? (actionResult.matched as unknown[]).length
                          : 0}
                      </p>
                      <p className="text-[10px] text-gray-500">Full Matches</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-amber-400">
                        {Array.isArray(actionResult.partial)
                          ? (actionResult.partial as unknown[]).length
                          : 0}
                      </p>
                      <p className="text-[10px] text-gray-500">Partial</p>
                    </div>
                  </div>
                  {Array.isArray(actionResult.matched) &&
                    (actionResult.matched as { name: string }[]).map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 p-2 bg-lattice-surface rounded"
                      >
                        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                        <p className="text-xs text-white">{m.name}</p>
                      </div>
                    ))}
                </div>
              )}
              {/* generateSummary */}
              {actionResult.periodDays !== undefined &&
                actionResult.encounterSummary !== undefined && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">
                      {String(actionResult.patientName)} &bull; Last{' '}
                      {String(actionResult.periodDays)} days
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          {String((actionResult.encounterSummary as { total: number }).total)}
                        </p>
                        <p className="text-[10px] text-gray-500">Encounters</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          {String((actionResult.labSummary as { totalTests: number }).totalTests)}
                        </p>
                        <p className="text-[10px] text-gray-500">Lab Tests</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p
                          className={`text-sm font-bold ${Number((actionResult.labSummary as { abnormalCount: number }).abnormalCount) > 0 ? 'text-amber-400' : 'text-green-400'}`}
                        >
                          {String(
                            (actionResult.labSummary as { abnormalCount: number }).abnormalCount
                          )}
                        </p>
                        <p className="text-[10px] text-gray-500">Abnormal Labs</p>
                      </div>
                    </div>
                    {Array.isArray(actionResult.activeConditions) &&
                      (actionResult.activeConditions as string[]).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(actionResult.activeConditions as string[]).map((c, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-neon-blue/10 text-neon-blue text-[10px] rounded"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* Main Content Area (with optional drawer)                     */}
      {/* ============================================================ */}
      <div className="flex gap-4">
        {/* ========================================================== */}
        {/* Left: Artifact Library                                     */}
        {/* ========================================================== */}
        <section className={cn(ds.panel, 'flex-1 min-w-0')}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <div className="flex items-center gap-3">
              <h2 className={ds.heading2}>{activeTab}</h2>
              {/* View mode toggle for Patients tab */}
              {activeTab === 'Patients' && (
                <div className="flex items-center border border-lattice-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setPatientViewMode('cards')}
                    className={cn(
                      'px-2 py-1',
                      patientViewMode === 'cards'
                        ? 'bg-neon-blue/20 text-neon-blue'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPatientViewMode('timeline')}
                    className={cn(
                      'px-2 py-1',
                      patientViewMode === 'timeline'
                        ? 'bg-neon-blue/20 text-neon-blue'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search records..."
                  className={cn(ds.input, 'pl-9 w-56')}
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as Status | 'all')}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {/* Medication filter for Pharmacy tab */}
              {activeTab === 'Pharmacy' && (
                <select
                  value={medFilter}
                  onChange={(e) => setMedFilter(e.target.value as 'all' | 'scheduled' | 'prn')}
                  className={cn(ds.select, 'w-36')}
                >
                  <option value="all">All Meds</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="prn">PRN Only</option>
                </select>
              )}
              {/* Lab panel filter for Lab tab */}
              {activeTab === 'Lab' && (
                <select
                  value={labPanelFilter}
                  onChange={(e) => setLabPanelFilter(e.target.value)}
                  className={cn(ds.select, 'w-40')}
                >
                  <option value="all">All Panels</option>
                  {Object.keys(LAB_PANELS).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {isLoading ? (
            <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
          ) : (activeTab === 'Pharmacy'
              ? filteredMeds
              : activeTab === 'Lab'
                ? filteredLabs
                : filtered
            ).length === 0 ? (
            <div className="text-center py-12">
              <Stethoscope className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No records found. Create one to get started.</p>
            </div>
          ) : (
            <>
              {/* ---- Patients Tab ---- */}
              {activeTab === 'Patients' && patientViewMode === 'timeline' && (
                <div className="space-y-0">
                  {filtered.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="mb-4"
                    >
                      <div
                        className={cn(ds.panelHover, 'mb-2')}
                        onClick={() => openDetailDrawer(item)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Users className="w-5 h-5 text-neon-blue" />
                            <div>
                              <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
                              <p className={cn(ds.textMuted, 'line-clamp-1')}>
                                {(item.data as unknown as HealthcareArtifact).description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge
                              status={(item.data as unknown as HealthcareArtifact).status}
                            />
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          </div>
                        </div>
                      </div>
                      {/* Timeline of linked records */}
                      <div className="ml-8 border-l border-lattice-border pl-4">
                        {getPatientLinked(item.id)
                          .slice(0, 5)
                          .map((linked) => (
                            <TimelineItem key={linked.id} item={linked} />
                          ))}
                        {getPatientLinked(item.id).length === 0 && (
                          <p className={cn(ds.textMuted, 'text-xs py-2')}>No linked records</p>
                        )}
                        {getPatientLinked(item.id).length > 5 && (
                          <p
                            className="text-xs text-neon-blue cursor-pointer hover:underline"
                            onClick={() => openDetailDrawer(item)}
                          >
                            View all {getPatientLinked(item.id).length} records...
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {activeTab === 'Patients' && patientViewMode === 'cards' && (
                <div className={ds.grid3}>
                  {filtered.map((item) => {
                    const d = item.data as unknown as HealthcareArtifact;
                    const linkedCount = getPatientLinked(item.id).length;
                    return (
                      <div
                        key={item.id}
                        className={ds.panelHover}
                        onClick={() => openDetailDrawer(item)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>
                            {item.title}
                          </h3>
                          <StatusBadge status={d.status} />
                        </div>
                        <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                        {/* Quick vitals preview with mini gauges */}
                        {(d.heartRate || d.bpSystolic) && (
                          <div className="flex items-center gap-2 mb-2">
                            {d.heartRate && (
                              <VitalGauge
                                value={d.heartRate}
                                vitalKey="heartRate"
                                label="HR"
                                unit="bpm"
                              />
                            )}
                            {d.bpSystolic && (
                              <VitalGauge
                                value={d.bpSystolic}
                                vitalKey="bpSystolic"
                                label="SBP"
                                unit="mmHg"
                              />
                            )}
                            {d.o2Sat && (
                              <VitalGauge value={d.o2Sat} vitalKey="o2Sat" label="SpO2" unit="%" />
                            )}
                            {d.temperature && (
                              <VitalGauge
                                value={d.temperature}
                                vitalKey="temperature"
                                label="Temp"
                                unit="F"
                              />
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {d.provider && <span className={ds.textMuted}>{d.provider}</span>}
                            {linkedCount > 0 && (
                              <span className={ds.badge('neon-cyan')}>{linkedCount} records</span>
                            )}
                          </div>
                          {d.date && (
                            <span className="flex items-center gap-1 text-gray-500">
                              <Clock className="w-3 h-3" /> {d.date}
                            </span>
                          )}
                        </div>
                        {d.priority && (d.priority === 'high' || d.priority === 'urgent') && (
                          <div className="mt-2">
                            <span className={ds.badge('red-400')}>
                              <Zap className="w-3 h-3" /> {d.priority}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---- Encounters Tab (with SOAP hint) ---- */}
              {activeTab === 'Encounters' && (
                <div className={ds.grid3}>
                  {filtered.map((item) => {
                    const d = item.data as unknown as HealthcareArtifact;
                    const hasSoap =
                      d.soapSubjective || d.soapObjective || d.soapAssessment || d.soapPlan;
                    return (
                      <div
                        key={item.id}
                        className={ds.panelHover}
                        onClick={() => openEditEditor(item)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>
                            {item.title}
                          </h3>
                          <StatusBadge status={d.status} />
                        </div>
                        <p className={cn(ds.textMuted, 'line-clamp-2 mb-2')}>{d.description}</p>
                        {d.chiefComplaint && (
                          <p className="text-xs text-yellow-400 mb-2">CC: {d.chiefComplaint}</p>
                        )}
                        {hasSoap && (
                          <div className="flex items-center gap-1 mb-2">
                            <Clipboard className="w-3 h-3 text-neon-cyan" />
                            <span className="text-xs text-neon-cyan">SOAP Note</span>
                          </div>
                        )}
                        {d.visitStart && d.visitEnd && (
                          <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                            <Timer className="w-3 h-3" />
                            Duration: {calculateVisitDuration(d.visitStart, d.visitEnd)}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          {d.provider && <span className={ds.textMuted}>{d.provider}</span>}
                          {d.date && (
                            <span className="flex items-center gap-1 text-gray-500">
                              <Clock className="w-3 h-3" /> {d.date}
                            </span>
                          )}
                        </div>
                        {d.priority && (d.priority === 'high' || d.priority === 'urgent') && (
                          <div className="mt-2">
                            <span className={ds.badge('red-400')}>
                              <Zap className="w-3 h-3" /> {d.priority}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---- Protocols Tab ---- */}
              {activeTab === 'Protocols' && (
                <div className={ds.grid3}>
                  {filtered.map((item) => {
                    const d = item.data as unknown as HealthcareArtifact;
                    return (
                      <div
                        key={item.id}
                        className={ds.panelHover}
                        onClick={() => openEditEditor(item)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>
                            {item.title}
                          </h3>
                          <StatusBadge status={d.status} />
                        </div>
                        <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                        <div className="flex items-center justify-between text-xs">
                          {d.provider && <span className={ds.textMuted}>{d.provider}</span>}
                          {d.date && (
                            <span className="flex items-center gap-1 text-gray-500">
                              <Clock className="w-3 h-3" /> {d.date}
                            </span>
                          )}
                        </div>
                        {d.priority && (d.priority === 'high' || d.priority === 'urgent') && (
                          <div className="mt-2">
                            <span className={ds.badge('red-400')}>
                              <Zap className="w-3 h-3" /> {d.priority}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ---- Pharmacy Tab (Medication Schedule View) ---- */}
              {activeTab === 'Pharmacy' && (
                <div className="space-y-3">
                  {filteredMeds.map((item) => (
                    <MedicationRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {/* ---- Lab Tab (Lab Results Panel) ---- */}
              {activeTab === 'Lab' && (
                <div className="space-y-3">
                  {/* Lab panel quick stats */}
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {Object.entries(LAB_PANELS).map(([key, _panel]) => {
                      const count = filtered.filter(
                        (i) => (i.data as unknown as HealthcareArtifact).testPanel === key
                      ).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={key}
                          onClick={() => setLabPanelFilter(labPanelFilter === key ? 'all' : key)}
                          className={cn(
                            ds.btnSmall,
                            labPanelFilter === key
                              ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50'
                              : 'bg-lattice-elevated text-gray-400 border border-lattice-border'
                          )}
                        >
                          {key} ({count})
                        </button>
                      );
                    })}
                  </div>
                  {filteredLabs.map((item) => (
                    <LabResultRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {/* ---- Therapy Tab (Care Plan Builder) ---- */}
              {activeTab === 'Therapy' && (
                <div className="space-y-3">
                  {filtered.map((item) => (
                    <CarePlanCard key={item.id} item={item} />
                  ))}
                </div>
              )}

              {/* ---- Symptoms Tab (Symptom Tracker) ---- */}
              {activeTab === 'Symptoms' && (
                <div className="space-y-4">
                  {/* Severity trend chart */}
                  {filtered.length >= 2 &&
                    (() => {
                      const sorted = [...filtered].sort((a, b) => {
                        const da =
                          (a.data as unknown as HealthcareArtifact).symptomDate || a.createdAt;
                        const db =
                          (b.data as unknown as HealthcareArtifact).symptomDate || b.createdAt;
                        return da.localeCompare(db);
                      });
                      return (
                        <div className={cn(ds.panel, 'space-y-3')}>
                          <h3 className={ds.heading3}>Symptom Severity Trend</h3>
                          <div className="flex items-end gap-1 h-24">
                            {sorted.map((item, _i) => {
                              const d = item.data as unknown as HealthcareArtifact;
                              const sev = d.severity ?? 5;
                              const pct = (sev / 10) * 100;
                              const barColor =
                                sev >= 8
                                  ? 'bg-red-400'
                                  : sev >= 5
                                    ? 'bg-yellow-400'
                                    : 'bg-green-400';
                              return (
                                <div
                                  key={item.id}
                                  className="flex-1 flex flex-col items-center justify-end"
                                  title={`${item.title}: ${sev}/10 on ${d.symptomDate || 'N/A'}`}
                                >
                                  <span className="text-[9px] text-gray-400 mb-0.5">{sev}</span>
                                  <div
                                    className={cn('w-full rounded-t', barColor)}
                                    style={{ height: `${Math.max(8, pct)}%` }}
                                  />
                                  <span className="text-[8px] text-gray-500 mt-0.5 truncate w-full text-center">
                                    {(d.symptomDate || '').slice(5)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-green-400" /> Mild (1-4)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-yellow-400" /> Moderate (5-7)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-red-400" /> Severe (8-10)
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  {/* Category summary */}
                  {filtered.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {SYMPTOM_CATEGORIES.map((cat) => {
                        const count = filtered.filter(
                          (i) => (i.data as unknown as HealthcareArtifact).symptomCategory === cat
                        ).length;
                        if (count === 0) return null;
                        return (
                          <span key={cat} className={ds.badge('neon-cyan')}>
                            {cat} ({count})
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Symptom cards */}
                  <div className={ds.grid3}>
                    {filtered.map((item) => {
                      const d = item.data as unknown as HealthcareArtifact;
                      const sev = d.severity ?? 0;
                      const sevColor =
                        sev >= 8 ? 'text-red-400' : sev >= 5 ? 'text-yellow-400' : 'text-green-400';
                      const sevBg =
                        sev >= 8
                          ? 'bg-red-500/10 border-red-500/30'
                          : sev >= 5
                            ? 'bg-yellow-500/10 border-yellow-500/30'
                            : 'bg-green-500/10 border-green-500/30';
                      return (
                        <div
                          key={item.id}
                          className={cn(ds.panelHover, 'space-y-2')}
                          onClick={() => openEditEditor(item)}
                        >
                          <div className="flex items-start justify-between">
                            <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
                            <StatusBadge status={d.status} />
                          </div>
                          {d.symptomName && (
                            <p className="text-sm text-gray-300">{d.symptomName}</p>
                          )}
                          <p className={cn(ds.textMuted, 'line-clamp-2')}>{d.description}</p>
                          <div className="flex items-center gap-3">
                            <div className={cn('rounded-lg border px-3 py-1.5', sevBg)}>
                              <span className={cn('text-lg font-bold', sevColor)}>{sev}/10</span>
                              <span className="text-xs text-gray-400 ml-1">severity</span>
                            </div>
                            {d.symptomCategory && (
                              <span className={ds.badge('neon-blue')}>{d.symptomCategory}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {d.symptomDate && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {d.symptomDate}
                              </span>
                            )}
                            {d.provider && <span>{d.provider}</span>}
                          </div>
                          {d.symptomNotes && (
                            <p className="text-xs text-gray-500 italic line-clamp-2">
                              {d.symptomNotes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Generate Care Plan from Symptoms */}
                  <div className={cn(ds.panel, 'space-y-3')}>
                    <div className="flex items-center justify-between">
                      <h3 className={ds.heading3}>Generate Care Plan</h3>
                      <button
                        onClick={handleGenerateCarePlan}
                        disabled={generateLoading || filtered.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 disabled:opacity-50 transition-colors"
                      >
                        {generateLoading ? (
                          <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                        {generateLoading ? 'Generating...' : 'Generate from Symptoms'}
                      </button>
                    </div>
                    {filtered.length === 0 && (
                      <p className={ds.textMuted}>Add symptoms above to generate a care plan.</p>
                    )}
                    {generateError && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {generateError}
                      </div>
                    )}
                    {generateResult && (
                      <div className="space-y-3">
                        <div className="p-4 rounded-lg bg-lattice-deep border border-lattice-border">
                          <h4 className="text-sm font-semibold text-neon-cyan mb-2">
                            {generateResult.title}
                          </h4>
                          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
                            {generateResult.content}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              handleDownloadResult(
                                generateResult.content,
                                `${generateResult.title.replace(/\s+/g, '-').toLowerCase()}.txt`
                              )
                            }
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded-lg text-xs hover:bg-neon-cyan/20"
                          >
                            <Download className="w-3.5 h-3.5" /> Download
                          </button>
                          <button
                            onClick={() => setGenerateResult(null)}
                            className={cn(ds.btnGhost, 'text-xs')}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* ========================================================== */}
        {/* Right: Detail Drawer (sliding panel)                       */}
        {/* ========================================================== */}
        {drawerOpen && drawerItem && (
          <aside className="w-96 shrink-0 space-y-4 animate-in slide-in-from-right-4">
            <div className={ds.panel}>
              <div className="flex items-center justify-between mb-3">
                <h2 className={ds.heading2}>Patient Detail</h2>
                <button onClick={() => setDrawerOpen(false)} className={ds.btnGhost}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-4">
                <h3 className={cn(ds.heading3, 'text-lg')}>{drawerItem.title}</h3>
                <p className={ds.textMuted}>
                  {(drawerItem.data as unknown as HealthcareArtifact).description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <StatusBadge status={(drawerItem.data as unknown as HealthcareArtifact).status} />
                  {(drawerItem.data as unknown as HealthcareArtifact).provider && (
                    <span className={cn(ds.textMuted, 'text-xs')}>
                      {(drawerItem.data as unknown as HealthcareArtifact).provider}
                    </span>
                  )}
                </div>
              </div>
              {/* Sub-tabs */}
              <div className="flex items-center gap-1 border-b border-lattice-border pb-2 mb-3 flex-wrap">
                {(
                  [
                    'Overview',
                    'Vitals',
                    'Medications',
                    'Labs',
                    'History',
                    'Appointments',
                  ] as DetailSubTab[]
                ).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailSubTab(tab)}
                    className={cn(
                      ds.btnGhost,
                      'text-xs whitespace-nowrap',
                      detailSubTab === tab && 'bg-neon-blue/20 text-neon-blue'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* ---------- Overview Sub-tab ---------- */}
              {detailSubTab === 'Overview' &&
                (() => {
                  const dd = drawerItem.data as unknown as HealthcareArtifact;
                  const linked = getPatientLinked(drawerItem.id);
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className={cn(ds.panel, 'p-2')}>
                          <span className="text-gray-500 block">Records</span>
                          <span className="text-lg font-bold text-white">{linked.length}</span>
                        </div>
                        <div className={cn(ds.panel, 'p-2')}>
                          <span className="text-gray-500 block">Priority</span>
                          <span
                            className={cn(
                              'text-lg font-bold',
                              PRIORITY_COLORS[dd.priority || 'medium']
                            )}
                          >
                            {dd.priority || 'medium'}
                          </span>
                        </div>
                      </div>
                      {dd.notes && (
                        <div>
                          <span className="text-xs text-gray-500 font-medium">Notes</span>
                          <p className="text-sm text-gray-300 mt-1">{dd.notes}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-xs text-gray-500 font-medium">Recent Activity</span>
                        <div className="mt-1 space-y-1">
                          {linked.slice(0, 5).map((l) => {
                            const ld = l.data as unknown as HealthcareArtifact;
                            return (
                              <div
                                key={l.id}
                                className="flex items-center justify-between text-xs p-2 rounded bg-lattice-surface hover:bg-lattice-elevated cursor-pointer"
                                onClick={() => openEditEditor(l)}
                              >
                                <span className="text-gray-300 truncate flex-1">{l.title}</span>
                                <StatusBadge status={ld.status} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => openEditEditor(drawerItem)}
                        className={cn(ds.btnSecondary, 'w-full text-sm')}
                      >
                        <FileText className="w-4 h-4" /> Edit Patient Record
                      </button>
                    </div>
                  );
                })()}

              {/* ---------- Vitals Sub-tab ---------- */}
              {detailSubTab === 'Vitals' &&
                (() => {
                  const dd = drawerItem.data as unknown as HealthcareArtifact;
                  const bmi = calculateBMI(dd.weight || 0, dd.height || 0);
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <VitalCard
                          label="Heart Rate"
                          value={dd.heartRate}
                          vitalKey="heartRate"
                          icon={Activity}
                        />
                        <VitalCard label="O2 Sat" value={dd.o2Sat} vitalKey="o2Sat" icon={Wind} />
                        <VitalCard
                          label="BP (Sys)"
                          value={dd.bpSystolic}
                          vitalKey="bpSystolic"
                          icon={Droplets}
                        />
                        <VitalCard
                          label="BP (Dia)"
                          value={dd.bpDiastolic}
                          vitalKey="bpDiastolic"
                          icon={Droplets}
                        />
                        <VitalCard
                          label="Temp"
                          value={dd.temperature}
                          vitalKey="temperature"
                          icon={Thermometer}
                        />
                        <VitalCard
                          label="Resp Rate"
                          value={dd.respiratoryRate}
                          vitalKey="respiratoryRate"
                          icon={Wind}
                        />
                      </div>
                      {/* Weight and BMI */}
                      <div className={cn(ds.panel, 'p-3')}>
                        <div className="flex items-center gap-2 mb-2">
                          <Weight className="w-4 h-4 text-gray-400" />
                          <span className={ds.textMuted}>Weight & BMI</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div>
                            <span className="text-gray-500 block">Weight</span>
                            <span className="text-sm font-bold text-white">
                              {dd.weight ?? '--'} lbs
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Height</span>
                            <span className="text-sm font-bold text-white">
                              {dd.height ?? '--'} in
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">BMI</span>
                            <span className={cn('text-sm font-bold', bmi.color)}>
                              {bmi.value || '--'}
                            </span>
                            {bmi.category !== 'N/A' && (
                              <span className={cn('block text-xs', bmi.color)}>{bmi.category}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Vital ranges legend */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-400" /> Normal
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-yellow-400" /> Borderline
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-red-400" /> Critical
                        </span>
                      </div>
                    </div>
                  );
                })()}

              {/* ---------- Medications Sub-tab ---------- */}
              {detailSubTab === 'Medications' &&
                (() => {
                  const linkedMeds = getPatientLinked(drawerItem.id).filter(
                    (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'Prescription'
                  );
                  return (
                    <div className="space-y-2">
                      {linkedMeds.length === 0 ? (
                        <p className={cn(ds.textMuted, 'text-center py-4')}>
                          No medications linked
                        </p>
                      ) : (
                        linkedMeds.map((med) => {
                          const md = med.data as unknown as HealthcareArtifact;
                          const daysLeft = calculateDaysRemaining(md.endDate);
                          return (
                            <div
                              key={med.id}
                              className="p-2 rounded bg-lattice-surface hover:bg-lattice-elevated cursor-pointer text-xs"
                              onClick={() => openEditEditor(med)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-gray-200 font-medium">{med.title}</span>
                                {md.isPRN && <span className={ds.badge('neon-blue')}>PRN</span>}
                              </div>
                              <div className="flex items-center gap-2 text-gray-500">
                                {md.dosage && <span>{md.dosage}</span>}
                                {md.frequency && <span>- {md.frequency}</span>}
                              </div>
                              {daysLeft >= 0 && daysLeft <= 7 && (
                                <p className="text-red-400 mt-1">Refill in {daysLeft} days</p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()}

              {/* ---------- Labs Sub-tab ---------- */}
              {detailSubTab === 'Labs' &&
                (() => {
                  const linkedLabs = getPatientLinked(drawerItem.id).filter(
                    (i) => (i.data as unknown as HealthcareArtifact).artifactType === 'LabResult'
                  );
                  return (
                    <div className="space-y-2">
                      {linkedLabs.length === 0 ? (
                        <p className={cn(ds.textMuted, 'text-center py-4')}>
                          No lab results linked
                        </p>
                      ) : (
                        linkedLabs.map((lab) => {
                          const ld = lab.data as unknown as HealthcareArtifact;
                          const outOfRange = isOutOfRange(
                            ld.resultValue || '',
                            ld.referenceRange || ''
                          );
                          return (
                            <div
                              key={lab.id}
                              className={cn(
                                'p-2 rounded cursor-pointer text-xs',
                                ld.isCritical
                                  ? 'bg-red-500/10 border border-red-500/30 pulse-critical-glow'
                                  : 'bg-lattice-surface hover:bg-lattice-elevated'
                              )}
                              onClick={() => openEditEditor(lab)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-gray-200 font-medium">{lab.title}</span>
                                {ld.isCritical && (
                                  <span
                                    className={cn(ds.badge('red-400'), 'text-[10px] animate-pulse')}
                                  >
                                    CRITICAL
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <span
                                  className={cn(
                                    outOfRange ? 'text-red-400 font-bold' : 'text-green-400',
                                    outOfRange && 'pulse-critical-glow rounded px-1'
                                  )}
                                >
                                  {ld.resultValue || '--'} {ld.unit || ''}
                                </span>
                                <span className="text-gray-500">
                                  Ref: {ld.referenceRange || '--'}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()}

              {/* ---------- History Sub-tab ---------- */}
              {detailSubTab === 'History' &&
                (() => {
                  const linked = getPatientLinked(drawerItem.id);
                  return (
                    <div className="space-y-0">
                      {linked.length === 0 ? (
                        <p className={cn(ds.textMuted, 'text-center py-4')}>No history records</p>
                      ) : (
                        linked.map((item) => <TimelineItem key={item.id} item={item} />)
                      )}
                    </div>
                  );
                })()}

              {/* ---------- Appointments Sub-tab ---------- */}
              {detailSubTab === 'Appointments' &&
                (() => {
                  const dd = drawerItem.data as unknown as HealthcareArtifact;
                  const linkedEncounters = getPatientLinked(drawerItem.id)
                    .filter((i) => {
                      const d = i.data as unknown as HealthcareArtifact;
                      return d.artifactType === 'Encounter' && d.status === 'scheduled';
                    })
                    .sort((a, b) => {
                      const da = (a.data as unknown as HealthcareArtifact).date || '';
                      const db = (b.data as unknown as HealthcareArtifact).date || '';
                      return da.localeCompare(db);
                    });
                  return (
                    <div className="space-y-3">
                      {/* Patient's own appointment info */}
                      {(dd.appointmentDate || dd.appointmentType) && (
                        <div className={cn(ds.panel, 'p-3 space-y-2')}>
                          <div className="flex items-center gap-2">
                            <CalendarCheck className="w-4 h-4 text-neon-blue" />
                            <span className="text-sm font-medium text-white">Next Appointment</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500 block">Date</span>
                              <span className="text-gray-200 font-medium">
                                {dd.appointmentDate || '--'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500 block">Time</span>
                              <span className="text-gray-200 font-medium">
                                {dd.appointmentTime || '--'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500 block">Type</span>
                              <span className="text-gray-200 font-medium">
                                {dd.appointmentType || '--'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500 block">Location</span>
                              <span className="text-gray-200 font-medium">
                                {dd.appointmentLocation || '--'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Scheduled encounters */}
                      <div>
                        <span className="text-xs text-gray-500 font-medium">Scheduled Visits</span>
                        <div className="mt-1 space-y-1">
                          {linkedEncounters.length === 0 ? (
                            <p className={cn(ds.textMuted, 'text-center py-4')}>
                              No upcoming appointments
                            </p>
                          ) : (
                            linkedEncounters.map((enc) => {
                              const ed = enc.data as unknown as HealthcareArtifact;
                              return (
                                <div
                                  key={enc.id}
                                  className="flex items-center justify-between p-2 rounded bg-lattice-surface hover:bg-lattice-elevated cursor-pointer text-xs"
                                  onClick={() => openEditEditor(enc)}
                                >
                                  <div className="flex items-center gap-2">
                                    <Calendar className="w-3 h-3 text-neon-blue" />
                                    <span className="text-gray-200 font-medium">{enc.title}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-gray-500">
                                    {ed.date && <span>{ed.date}</span>}
                                    {ed.provider && <span>{ed.provider}</span>}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => openEditEditor(drawerItem)}
                        className={cn(ds.btnSecondary, 'w-full text-sm')}
                      >
                        <Calendar className="w-4 h-4" /> Edit Appointment Info
                      </button>
                    </div>
                  );
                })()}
            </div>
          </aside>
        )}
      </div>

      {/* ============================================================ */}
      {/* Editor Modal                                                 */}
      {/* ============================================================ */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-3xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>{editingItem ? 'Edit Record' : 'New Record'}</h2>
                <button onClick={() => setShowEditor(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* ---------- Base fields ---------- */}
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className={ds.input}
                    placeholder="Record title"
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as ArtifactType)}
                      className={ds.select}
                    >
                      <option value="Patient">Patient</option>
                      <option value="Encounter">Encounter</option>
                      <option value="CareProtocol">Care Protocol</option>
                      <option value="Prescription">Prescription</option>
                      <option value="LabResult">Lab Result</option>
                      <option value="Treatment">Treatment</option>
                      <option value="Symptom">Symptom</option>
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Status</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as Status)}
                      className={ds.select}
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Provider</label>
                    <input
                      value={formProvider}
                      onChange={(e) => setFormProvider(e.target.value)}
                      className={ds.input}
                      placeholder="Attending provider"
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Date</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Priority</label>
                  <select
                    value={formPriority}
                    onChange={(e) =>
                      setFormPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')
                    }
                    className={ds.select}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className={ds.textarea}
                    rows={3}
                    placeholder="Clinical description..."
                  />
                </div>

                {/* ============================================= */}
                {/* SOAP Note Builder (Encounter type)            */}
                {/* ============================================= */}
                {formType === 'Encounter' && (
                  <div className="border border-neon-cyan/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Clipboard className="w-5 h-5 text-neon-cyan" />
                      <h3 className={cn(ds.heading3, 'text-neon-cyan')}>SOAP Note Builder</h3>
                    </div>
                    {/* Chief Complaint */}
                    <div className="relative">
                      <label className={ds.label}>Chief Complaint</label>
                      <div className="flex gap-2">
                        <input
                          value={soapComplaint}
                          onChange={(e) => setSoapComplaint(e.target.value)}
                          className={cn(ds.input, 'flex-1')}
                          placeholder="Patient presents with..."
                        />
                        <button
                          onClick={() => setShowComplaintPicker(!showComplaintPicker)}
                          className={cn(
                            ds.btnSmall,
                            'bg-lattice-elevated text-gray-400 border border-lattice-border'
                          )}
                        >
                          Quick
                        </button>
                      </div>
                      {showComplaintPicker && (
                        <div className="mt-1 p-2 bg-lattice-elevated border border-lattice-border rounded-lg max-h-32 overflow-y-auto">
                          <div className="flex flex-wrap gap-1">
                            {COMMON_COMPLAINTS.map((c) => (
                              <button
                                key={c}
                                onClick={() => {
                                  setSoapComplaint(c);
                                  setShowComplaintPicker(false);
                                }}
                                className="text-xs px-2 py-1 rounded bg-lattice-surface text-gray-300 hover:bg-neon-blue/20 hover:text-neon-blue"
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Visit timing */}
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Visit Start</label>
                        <input
                          type="datetime-local"
                          value={soapVisitStart}
                          onChange={(e) => setSoapVisitStart(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Visit End</label>
                        <input
                          type="datetime-local"
                          value={soapVisitEnd}
                          onChange={(e) => setSoapVisitEnd(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                    </div>
                    {soapVisitStart && soapVisitEnd && (
                      <div className="flex items-center gap-2 text-xs text-neon-cyan">
                        <Timer className="w-3 h-3" />
                        Visit Duration: {calculateVisitDuration(soapVisitStart, soapVisitEnd)}
                      </div>
                    )}
                    {/* S - Subjective */}
                    <div>
                      <label className={ds.label}>
                        <span className="inline-block w-5 h-5 bg-blue-500/20 text-blue-400 rounded text-center text-xs leading-5 mr-2 font-bold">
                          S
                        </span>
                        Subjective
                      </label>
                      <textarea
                        value={soapSubjective}
                        onChange={(e) => setSoapSubjective(e.target.value)}
                        className={ds.textarea}
                        rows={3}
                        placeholder="Patient's reported symptoms, history of present illness..."
                      />
                    </div>
                    {/* O - Objective */}
                    <div className="relative">
                      <label className={ds.label}>
                        <span className="inline-block w-5 h-5 bg-green-500/20 text-green-400 rounded text-center text-xs leading-5 mr-2 font-bold">
                          O
                        </span>
                        Objective
                      </label>
                      <textarea
                        value={soapObjective}
                        onChange={(e) => setSoapObjective(e.target.value)}
                        className={ds.textarea}
                        rows={3}
                        placeholder="Physical examination findings, vital signs, test results..."
                      />
                      <button
                        onClick={() => setShowFindingPicker(!showFindingPicker)}
                        className={cn(
                          ds.btnSmall,
                          'absolute top-0 right-0 bg-lattice-elevated text-gray-400 border border-lattice-border text-xs'
                        )}
                      >
                        Insert Finding
                      </button>
                      {showFindingPicker && (
                        <div className="mt-1 p-2 bg-lattice-elevated border border-lattice-border rounded-lg max-h-32 overflow-y-auto">
                          <div className="flex flex-wrap gap-1">
                            {COMMON_FINDINGS.map((f) => (
                              <button
                                key={f}
                                onClick={() => {
                                  setSoapObjective((prev) => (prev ? prev + '. ' + f : f));
                                  setShowFindingPicker(false);
                                }}
                                className="text-xs px-2 py-1 rounded bg-lattice-surface text-gray-300 hover:bg-green-500/20 hover:text-green-400"
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* A - Assessment */}
                    <div className="relative">
                      <label className={ds.label}>
                        <span className="inline-block w-5 h-5 bg-yellow-500/20 text-yellow-400 rounded text-center text-xs leading-5 mr-2 font-bold">
                          A
                        </span>
                        Assessment
                      </label>
                      <textarea
                        value={soapAssessment}
                        onChange={(e) => setSoapAssessment(e.target.value)}
                        className={ds.textarea}
                        rows={3}
                        placeholder="Diagnoses, clinical impression..."
                      />
                      <button
                        onClick={() => setShowDxPicker(!showDxPicker)}
                        className={cn(
                          ds.btnSmall,
                          'absolute top-0 right-0 bg-lattice-elevated text-gray-400 border border-lattice-border text-xs'
                        )}
                      >
                        Add Dx
                      </button>
                      {showDxPicker && (
                        <div className="mt-1 p-2 bg-lattice-elevated border border-lattice-border rounded-lg max-h-40 overflow-y-auto">
                          <div className="flex flex-wrap gap-1">
                            {COMMON_DIAGNOSES.map((dx) => (
                              <button
                                key={dx}
                                onClick={() => {
                                  setSoapAssessment((prev) => (prev ? prev + '\n' + dx : dx));
                                  setShowDxPicker(false);
                                }}
                                className="text-xs px-2 py-1 rounded bg-lattice-surface text-gray-300 hover:bg-yellow-500/20 hover:text-yellow-400"
                              >
                                {dx}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* P - Plan */}
                    <div>
                      <label className={ds.label}>
                        <span className="inline-block w-5 h-5 bg-purple-500/20 text-purple-400 rounded text-center text-xs leading-5 mr-2 font-bold">
                          P
                        </span>
                        Plan
                      </label>
                      <textarea
                        value={soapPlan}
                        onChange={(e) => setSoapPlan(e.target.value)}
                        className={ds.textarea}
                        rows={3}
                        placeholder="Treatment plan, medications, follow-up, referrals..."
                      />
                    </div>
                  </div>
                )}

                {/* ============================================= */}
                {/* Vital Signs Entry (Patient type)              */}
                {/* ============================================= */}
                {formType === 'Patient' && (
                  <div className="border border-green-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-5 h-5 text-green-400" />
                      <h3 className={cn(ds.heading3, 'text-green-400')}>Vital Signs</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className={ds.label}>Heart Rate (bpm)</label>
                        <input
                          type="number"
                          value={vitalsHR}
                          onChange={(e) => setVitalsHR(e.target.value)}
                          className={ds.input}
                          placeholder="72"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>BP Systolic</label>
                        <input
                          type="number"
                          value={vitalsBPSys}
                          onChange={(e) => setVitalsBPSys(e.target.value)}
                          className={ds.input}
                          placeholder="120"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>BP Diastolic</label>
                        <input
                          type="number"
                          value={vitalsBPDia}
                          onChange={(e) => setVitalsBPDia(e.target.value)}
                          className={ds.input}
                          placeholder="80"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Temperature (F)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={vitalsTemp}
                          onChange={(e) => setVitalsTemp(e.target.value)}
                          className={ds.input}
                          placeholder="98.6"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Resp Rate (/min)</label>
                        <input
                          type="number"
                          value={vitalsRR}
                          onChange={(e) => setVitalsRR(e.target.value)}
                          className={ds.input}
                          placeholder="16"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>O2 Sat (%)</label>
                        <input
                          type="number"
                          value={vitalsO2}
                          onChange={(e) => setVitalsO2(e.target.value)}
                          className={ds.input}
                          placeholder="98"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Weight (lbs)</label>
                        <input
                          type="number"
                          value={vitalsWeight}
                          onChange={(e) => setVitalsWeight(e.target.value)}
                          className={ds.input}
                          placeholder="170"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Height (in)</label>
                        <input
                          type="number"
                          value={vitalsHeight}
                          onChange={(e) => setVitalsHeight(e.target.value)}
                          className={ds.input}
                          placeholder="68"
                        />
                      </div>
                    </div>
                    {/* Live BMI calculation */}
                    {vitalsWeight && vitalsHeight && (
                      <div className="flex items-center gap-3 p-2 bg-lattice-elevated rounded-lg">
                        <BarChart3 className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-400">BMI:</span>
                        {(() => {
                          const bmi = calculateBMI(Number(vitalsWeight), Number(vitalsHeight));
                          return (
                            <span className={cn('text-sm font-bold', bmi.color)}>
                              {bmi.value} ({bmi.category})
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {/* Live vital range indicators */}
                    <div className="flex flex-wrap gap-2">
                      {vitalsHR && (
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            getVitalBg('heartRate', Number(vitalsHR)),
                            getVitalColor('heartRate', Number(vitalsHR))
                          )}
                        >
                          HR: {vitalsHR} bpm
                        </span>
                      )}
                      {vitalsBPSys && (
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            getVitalBg('bpSystolic', Number(vitalsBPSys)),
                            getVitalColor('bpSystolic', Number(vitalsBPSys))
                          )}
                        >
                          SBP: {vitalsBPSys} mmHg
                        </span>
                      )}
                      {vitalsBPDia && (
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            getVitalBg('bpDiastolic', Number(vitalsBPDia)),
                            getVitalColor('bpDiastolic', Number(vitalsBPDia))
                          )}
                        >
                          DBP: {vitalsBPDia} mmHg
                        </span>
                      )}
                      {vitalsTemp && (
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            getVitalBg('temperature', Number(vitalsTemp)),
                            getVitalColor('temperature', Number(vitalsTemp))
                          )}
                        >
                          Temp: {vitalsTemp} F
                        </span>
                      )}
                      {vitalsO2 && (
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            getVitalBg('o2Sat', Number(vitalsO2)),
                            getVitalColor('o2Sat', Number(vitalsO2))
                          )}
                        >
                          SpO2: {vitalsO2}%
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* ============================================= */}
                {/* Prescription Fields (Prescription type)       */}
                {/* ============================================= */}
                {formType === 'Prescription' && (
                  <div className="border border-blue-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Pill className="w-5 h-5 text-blue-400" />
                      <h3 className={cn(ds.heading3, 'text-blue-400')}>Medication Details</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className={ds.label}>Dosage</label>
                        <input
                          value={formDosage}
                          onChange={(e) => setFormDosage(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. 500mg"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Frequency</label>
                        <input
                          value={formFrequency}
                          onChange={(e) => setFormFrequency(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. BID, TID, QHS"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Route</label>
                        <select
                          value={formRoute}
                          onChange={(e) => setFormRoute(e.target.value)}
                          className={ds.select}
                        >
                          <option value="">Select route</option>
                          <option value="PO">PO (Oral)</option>
                          <option value="IV">IV (Intravenous)</option>
                          <option value="IM">IM (Intramuscular)</option>
                          <option value="SC">SC (Subcutaneous)</option>
                          <option value="SL">SL (Sublingual)</option>
                          <option value="Topical">Topical</option>
                          <option value="Inhaled">Inhaled</option>
                          <option value="Rectal">Rectal</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Start Date</label>
                        <input
                          type="date"
                          value={formStartDate}
                          onChange={(e) => setFormStartDate(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                      <div>
                        <label className={ds.label}>End Date</label>
                        <input
                          type="date"
                          value={formEndDate}
                          onChange={(e) => setFormEndDate(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className={ds.label}>Refills Remaining</label>
                        <input
                          type="number"
                          value={formRefills}
                          onChange={(e) => setFormRefills(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Days Supply</label>
                        <input
                          type="number"
                          value={formDaysSupply}
                          onChange={(e) => setFormDaysSupply(e.target.value)}
                          className={ds.input}
                          placeholder="30"
                          min="0"
                        />
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={formIsPRN}
                            onChange={(e) => setFormIsPRN(e.target.checked)}
                            className="accent-neon-blue"
                          />
                          PRN (As Needed)
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className={ds.label}>Drug Interactions (comma-separated)</label>
                      <input
                        value={formInteractions}
                        onChange={(e) => setFormInteractions(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. Warfarin, Aspirin..."
                      />
                    </div>
                  </div>
                )}

                {/* ============================================= */}
                {/* Lab Result Fields (LabResult type)            */}
                {/* ============================================= */}
                {formType === 'LabResult' && (
                  <div className="border border-cyan-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FlaskConical className="w-5 h-5 text-neon-cyan" />
                      <h3 className={cn(ds.heading3, 'text-neon-cyan')}>Lab Result Details</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Test Panel</label>
                        <select
                          value={formTestPanel}
                          onChange={(e) => setFormTestPanel(e.target.value)}
                          className={ds.select}
                        >
                          <option value="">Select panel</option>
                          {Object.entries(LAB_PANELS).map(([key, panel]) => (
                            <option key={key} value={key}>
                              {panel.name} ({key})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={ds.label}>Unit</label>
                        <input
                          value={formUnit}
                          onChange={(e) => setFormUnit(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. mg/dL, mmol/L"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Result Value</label>
                        <input
                          value={formResultValue}
                          onChange={(e) => setFormResultValue(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. 120"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Reference Range</label>
                        <input
                          value={formReferenceRange}
                          onChange={(e) => setFormReferenceRange(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. 70-100"
                        />
                      </div>
                    </div>
                    {formResultValue && formReferenceRange && (
                      <div
                        className={cn(
                          'px-3 py-2 rounded-lg text-xs font-medium',
                          isOutOfRange(formResultValue, formReferenceRange)
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-green-500/10 text-green-400'
                        )}
                      >
                        {isOutOfRange(formResultValue, formReferenceRange)
                          ? 'Result is OUT OF RANGE'
                          : 'Result is within normal range'}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={formIsCritical}
                        onChange={(e) => setFormIsCritical(e.target.checked)}
                        className="accent-red-400"
                      />
                      Mark as Critical Value
                    </label>
                  </div>
                )}

                {/* ============================================= */}
                {/* Symptom Fields (Symptom type)                 */}
                {/* ============================================= */}
                {formType === 'Symptom' && (
                  <div className="border border-orange-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Thermometer className="w-5 h-5 text-orange-400" />
                      <h3 className={cn(ds.heading3, 'text-orange-400')}>Symptom Details</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Symptom Name</label>
                        <input
                          value={formSymptomName}
                          onChange={(e) => setFormSymptomName(e.target.value)}
                          className={ds.input}
                          placeholder="e.g. Headache, Nausea"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Category</label>
                        <select
                          value={formSymptomCategory}
                          onChange={(e) => setFormSymptomCategory(e.target.value)}
                          className={ds.select}
                        >
                          {SYMPTOM_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={ds.label}>
                        Severity (1-10):{' '}
                        <span
                          className={cn(
                            'font-bold',
                            formSeverity >= 8
                              ? 'text-red-400'
                              : formSeverity >= 5
                                ? 'text-yellow-400'
                                : 'text-green-400'
                          )}
                        >
                          {formSeverity}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={formSeverity}
                        onChange={(e) => setFormSeverity(Number(e.target.value))}
                        className="w-full accent-neon-blue"
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Mild</span>
                        <span>Moderate</span>
                        <span>Severe</span>
                      </div>
                    </div>
                    <div>
                      <label className={ds.label}>Date of Onset</label>
                      <input
                        type="date"
                        value={formSymptomDate}
                        onChange={(e) => setFormSymptomDate(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Symptom Notes</label>
                      <textarea
                        value={formSymptomNotes}
                        onChange={(e) => setFormSymptomNotes(e.target.value)}
                        className={ds.textarea}
                        rows={3}
                        placeholder="Duration, triggers, alleviating factors, associated symptoms..."
                      />
                    </div>
                  </div>
                )}

                {/* ============================================= */}
                {/* Appointment Fields (Patient type)              */}
                {/* ============================================= */}
                {formType === 'Patient' && (
                  <div className="border border-neon-blue/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarCheck className="w-5 h-5 text-neon-blue" />
                      <h3 className={cn(ds.heading3, 'text-neon-blue')}>Appointment Calendar</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Next Appointment Date</label>
                        <input
                          type="date"
                          value={formApptDate}
                          onChange={(e) => setFormApptDate(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Time</label>
                        <input
                          type="time"
                          value={formApptTime}
                          onChange={(e) => setFormApptTime(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Appointment Type</label>
                        <select
                          value={formApptType}
                          onChange={(e) => setFormApptType(e.target.value)}
                          className={ds.select}
                        >
                          {APPOINTMENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={ds.label}>Location</label>
                        <input
                          value={formApptLocation}
                          onChange={(e) => setFormApptLocation(e.target.value)}
                          className={ds.input}
                          placeholder="Clinic, Hospital, Telehealth"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ============================================= */}
                {/* Care Plan Builder (Treatment type)            */}
                {/* ============================================= */}
                {formType === 'Treatment' && (
                  <div className="border border-purple-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-5 h-5 text-purple-400" />
                      <h3 className={cn(ds.heading3, 'text-purple-400')}>Care Plan Builder</h3>
                    </div>
                    {/* Add Goal */}
                    <div>
                      <label className={ds.label}>Add Goal</label>
                      <div className="flex gap-2">
                        <input
                          value={newGoalName}
                          onChange={(e) => setNewGoalName(e.target.value)}
                          className={cn(ds.input, 'flex-1')}
                          placeholder="Goal name"
                        />
                        <input
                          value={newGoalTarget}
                          onChange={(e) => setNewGoalTarget(e.target.value)}
                          className={cn(ds.input, 'w-32')}
                          placeholder="Target"
                        />
                        <button
                          onClick={() => {
                            if (newGoalName) {
                              setFormNotes(
                                (prev) => prev + `\n[GOAL] ${newGoalName} -> ${newGoalTarget}`
                              );
                              setNewGoalName('');
                              setNewGoalTarget('');
                            }
                          }}
                          className={cn(
                            ds.btnSmall,
                            'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          )}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {/* Add Milestone */}
                    <div>
                      <label className={ds.label}>Add Milestone</label>
                      <div className="flex gap-2">
                        <input
                          value={newMilestoneName}
                          onChange={(e) => setNewMilestoneName(e.target.value)}
                          className={cn(ds.input, 'flex-1')}
                          placeholder="Milestone"
                        />
                        <input
                          type="date"
                          value={newMilestoneDue}
                          onChange={(e) => setNewMilestoneDue(e.target.value)}
                          className={cn(ds.input, 'w-40')}
                        />
                        <button
                          onClick={() => {
                            if (newMilestoneName) {
                              setFormNotes(
                                (prev) =>
                                  prev + `\n[MILESTONE] ${newMilestoneName} by ${newMilestoneDue}`
                              );
                              setNewMilestoneName('');
                              setNewMilestoneDue('');
                            }
                          }}
                          className={cn(
                            ds.btnSmall,
                            'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          )}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {/* Add Intervention */}
                    <div>
                      <label className={ds.label}>Add Intervention</label>
                      <div className="flex gap-2">
                        <input
                          value={newIntervention}
                          onChange={(e) => setNewIntervention(e.target.value)}
                          className={cn(ds.input, 'flex-1')}
                          placeholder="Intervention description"
                        />
                        <button
                          onClick={() => {
                            if (newIntervention) {
                              setFormNotes((prev) => prev + `\n[INTERVENTION] ${newIntervention}`);
                              setNewIntervention('');
                            }
                          }}
                          className={cn(
                            ds.btnSmall,
                            'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          )}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {/* Outcome Measure */}
                    <div>
                      <label className={ds.label}>Outcome Measure</label>
                      <input
                        className={ds.input}
                        placeholder="e.g., Pain score 0-10, PHQ-9, FIM score"
                        onChange={(e) =>
                          setFormNotes(
                            (prev) =>
                              prev.replace(/\[OUTCOME\].*/, '') + `\n[OUTCOME] ${e.target.value}`
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {/* Notes (always shown) */}
                <div>
                  <label className={ds.label}>Notes</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className={ds.textarea}
                    rows={3}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-4 border-t border-lattice-border">
                <div className="flex items-center gap-2">
                  {editingItem && (
                    <button
                      onClick={() => {
                        handleDelete(editingItem.id);
                        setShowEditor(false);
                      }}
                      className={ds.btnDanger}
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                  {/* Quick domain actions in editor */}
                  {editingItem && (
                    <>
                      <button
                        onClick={() => handleAction('generateSummary', editingItem.id)}
                        className={cn(ds.btnGhost, 'text-xs')}
                      >
                        <FileText className="w-3 h-3" /> Summary
                      </button>
                      <button
                        onClick={() => handleAction('exportEncounter', editingItem.id)}
                        className={cn(ds.btnGhost, 'text-xs')}
                      >
                        <Download className="w-3 h-3" /> Export
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowEditor(false)} className={ds.btnSecondary}>
                    Cancel
                  </button>
                  <button onClick={handleSave} className={ds.btnPrimary}>
                    {editingItem ? 'Update' : 'Create'} Record
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="healthcare" />
      </div>

      {/* Lens Features */}
      <div className="border-t border-blue-900/15">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-blue-400/60 hover:text-blue-300 transition-colors"
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
            <LensFeaturePanel lensId="healthcare" />
          </div>
        )}
      </div>

      {/* Persistent bottom disclaimer */}
      <div className="sticky bottom-0 bg-blue-950/90 backdrop-blur-sm border-t border-blue-400/10 px-4 py-2 text-center">
        <p className="text-xs text-blue-400/50">
          <ShieldCheck className="w-3 h-3 inline mr-1" />
          This tool is for organizational purposes only. Not a substitute for professional medical
          advice, diagnosis, or treatment.
        </p>
      </div>
    </div>
  );
}
