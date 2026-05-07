'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Scale,
  Briefcase,
  FileText,
  ShieldCheck,
  Plus,
  Search,
  X,
  Trash2,
  AlertTriangle,
  Clock,
  Gavel,
  BookOpen,
  Calendar,
  Users,
  DollarSign,
  Timer,
  Receipt,
  UserCheck,
  Eye,
  Edit3,
  Link2,
  MapPin,
  Phone,
  Mail,
  Building,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BarChart3,
  FileClock,
  Hash,
  RefreshCw,
  Landmark,
  Shield,
  GraduationCap,
  BadgeCheck,
  ClipboardCheck,
  Calculator,
  FileSearch,
  ScrollText,
  ArrowRight,
  Hourglass,
  CircleDot,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
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
  | 'Dashboard'
  | 'Cases'
  | 'Documents'
  | 'TimeBilling'
  | 'Calendar'
  | 'Contacts'
  | 'Contracts'
  | 'Compliance';
type ArtifactType =
  | 'Case'
  | 'Document'
  | 'TimeEntry'
  | 'CalendarEvent'
  | 'Contact'
  | 'Contract'
  | 'ComplianceItem';

type CaseStatus = 'intake' | 'active' | 'discovery' | 'trial' | 'closed';
type DocumentStatus = 'draft' | 'review' | 'filed' | 'served';
type TimeEntryStatus = 'logged' | 'billed' | 'paid';
type CalendarEventStatus = 'upcoming' | 'today' | 'overdue' | 'completed';
type ContactType =
  | 'client'
  | 'opposing_party'
  | 'witness'
  | 'expert'
  | 'judge'
  | 'opposing_counsel';
type ContractStatus =
  | 'draft'
  | 'review'
  | 'negotiation'
  | 'executed'
  | 'active'
  | 'expired'
  | 'terminated';
type ComplianceStatus = 'compliant' | 'due_soon' | 'overdue' | 'under_review';
type _AnyStatus =
  | CaseStatus
  | DocumentStatus
  | TimeEntryStatus
  | CalendarEventStatus
  | ContractStatus
  | ComplianceStatus
  | string;

type DocumentType =
  | 'motion'
  | 'brief'
  | 'contract'
  | 'evidence'
  | 'correspondence'
  | 'pleading'
  | 'discovery'
  | 'other';
type MatterType =
  | 'litigation'
  | 'corporate'
  | 'real_estate'
  | 'family'
  | 'criminal'
  | 'ip'
  | 'employment'
  | 'bankruptcy'
  | 'other';
type CalendarType =
  | 'court_date'
  | 'filing_deadline'
  | 'hearing'
  | 'deposition'
  | 'sol_deadline'
  | 'meeting'
  | 'other';
type RuleSet = 'federal' | 'state' | 'local';

interface CaseData {
  artifactType: 'Case';
  status: CaseStatus;
  description: string;
  matterType?: MatterType;
  caseNumber?: string;
  jurisdiction?: string;
  court?: string;
  judge?: string;
  opposingCounsel?: string;
  relatedParties?: string[];
  assignee?: string;
  dueDate?: string;
  value?: number;
  notes?: string;
  timeline?: { date: string; event: string }[];
  [key: string]: unknown;
}

interface DocumentData {
  artifactType: 'Document';
  status: DocumentStatus;
  description: string;
  documentType?: DocumentType;
  caseId?: string;
  caseName?: string;
  version?: number;
  filingDeadline?: string;
  assignee?: string;
  notes?: string;
  [key: string]: unknown;
}

interface TimeEntryData {
  artifactType: 'TimeEntry';
  status: TimeEntryStatus;
  description: string;
  caseId?: string;
  caseName?: string;
  hours?: number;
  rate?: number;
  billable?: boolean;
  assignee?: string;
  date?: string;
  invoiceId?: string;
  notes?: string;
  [key: string]: unknown;
}

interface CalendarEventData {
  artifactType: 'CalendarEvent';
  status: CalendarEventStatus;
  description: string;
  eventType?: CalendarType;
  caseId?: string;
  caseName?: string;
  eventDate?: string;
  eventTime?: string;
  location?: string;
  ruleSet?: RuleSet;
  daysUntil?: number;
  assignee?: string;
  notes?: string;
  [key: string]: unknown;
}

interface ContactData {
  artifactType: 'Contact';
  status: string;
  description: string;
  contactType?: ContactType;
  caseId?: string;
  caseName?: string;
  organization?: string;
  email?: string;
  phone?: string;
  address?: string;
  relationship?: string;
  conflictCleared?: boolean;
  notes?: string;
  [key: string]: unknown;
}

interface ContractData {
  artifactType: 'Contract';
  status: ContractStatus;
  description: string;
  parties?: string[];
  keyTerms?: string[];
  renewalDate?: string;
  obligations?: string[];
  value?: number;
  jurisdiction?: string;
  assignee?: string;
  dueDate?: string;
  notes?: string;
  [key: string]: unknown;
}

interface ComplianceData {
  artifactType: 'ComplianceItem';
  status: ComplianceStatus;
  description: string;
  complianceType?:
    | 'cle_credits'
    | 'bar_admission'
    | 'malpractice_insurance'
    | 'trust_account'
    | 'ethical_screening'
    | 'other';
  dueDate?: string;
  credits?: number;
  creditsRequired?: number;
  barState?: string;
  assignee?: string;
  notes?: string;
  [key: string]: unknown;
}

type LegalArtifact =
  | CaseData
  | DocumentData
  | TimeEntryData
  | CalendarEventData
  | ContactData
  | ContractData
  | ComplianceData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: {
  id: ModeTab;
  icon: React.ElementType;
  defaultType: ArtifactType;
  label: string;
}[] = [
  { id: 'Dashboard', icon: BarChart3, defaultType: 'Case', label: 'Dashboard' },
  { id: 'Cases', icon: Briefcase, defaultType: 'Case', label: 'Cases' },
  { id: 'Documents', icon: FileText, defaultType: 'Document', label: 'Documents' },
  { id: 'TimeBilling', icon: Timer, defaultType: 'TimeEntry', label: 'Time & Billing' },
  { id: 'Calendar', icon: Calendar, defaultType: 'CalendarEvent', label: 'Calendar' },
  { id: 'Contacts', icon: Users, defaultType: 'Contact', label: 'Contacts' },
  { id: 'Contracts', icon: ScrollText, defaultType: 'Contract', label: 'Contracts' },
  { id: 'Compliance', icon: ShieldCheck, defaultType: 'ComplianceItem', label: 'Compliance' },
];

const STATUSES_BY_TYPE: Record<ArtifactType, string[]> = {
  Case: ['intake', 'active', 'discovery', 'trial', 'closed'],
  Document: ['draft', 'review', 'filed', 'served'],
  TimeEntry: ['logged', 'billed', 'paid'],
  CalendarEvent: ['upcoming', 'today', 'overdue', 'completed'],
  Contact: ['active', 'inactive', 'conflict'],
  Contract: ['draft', 'review', 'negotiation', 'executed', 'active', 'expired', 'terminated'],
  ComplianceItem: ['compliant', 'due_soon', 'overdue', 'under_review'],
};

const STATUS_COLORS: Record<string, string> = {
  intake: 'neon-blue',
  active: 'neon-green',
  discovery: 'amber-400',
  negotiation: 'amber-400',
  trial: 'red-400',
  appeal: 'orange-400',
  closed: 'gray-400',
  draft: 'gray-400',
  review: 'neon-blue',
  filed: 'neon-cyan',
  served: 'neon-green',
  logged: 'neon-blue',
  billed: 'amber-400',
  paid: 'neon-green',
  upcoming: 'neon-blue',
  today: 'amber-400',
  overdue: 'red-400',
  completed: 'neon-green',
  inactive: 'gray-400',
  conflict: 'red-400',
  executed: 'neon-green',
  expired: 'red-400',
  terminated: 'red-400',
  compliant: 'neon-green',
  due_soon: 'amber-400',
  under_review: 'neon-blue',
  pending: 'amber-400',
  registered: 'neon-green',
  contested: 'red-400',
};

const MATTER_TYPES: MatterType[] = [
  'litigation',
  'corporate',
  'real_estate',
  'family',
  'criminal',
  'ip',
  'employment',
  'bankruptcy',
  'other',
];
const DOCUMENT_TYPES: DocumentType[] = [
  'motion',
  'brief',
  'contract',
  'evidence',
  'correspondence',
  'pleading',
  'discovery',
  'other',
];
const CALENDAR_TYPES: CalendarType[] = [
  'court_date',
  'filing_deadline',
  'hearing',
  'deposition',
  'sol_deadline',
  'meeting',
  'other',
];
const CONTACT_TYPES: ContactType[] = [
  'client',
  'opposing_party',
  'witness',
  'expert',
  'judge',
  'opposing_counsel',
];
const COMPLIANCE_TYPES = [
  'cle_credits',
  'bar_admission',
  'malpractice_insurance',
  'trust_account',
  'ethical_screening',
  'other',
];
const RULE_SETS: RuleSet[] = ['federal', 'state', 'local'];

const seedItems: { title: string; data: LegalArtifact }[] = [];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
}

function formatCurrencyDecimal(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(v);
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function deadlineUrgency(
  dateStr: string | undefined
): 'overdue' | 'urgent' | 'soon' | 'normal' | 'none' {
  if (!dateStr) return 'none';
  const days = daysUntil(dateStr);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'urgent';
  if (days <= 7) return 'soon';
  return 'normal';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LegalLensPage() {
  useLensNav('legal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('legal');

  const [activeTab, setActiveTab] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<ArtifactType>('Case');
  const [editingItem, setEditingItem] = useState<LensItem<LegalArtifact> | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailItem, setDetailItem] = useState<LensItem<LegalArtifact> | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Case form state ---
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('intake');
  const [formDescription, setFormDescription] = useState('');
  const [formMatterType, setFormMatterType] = useState<MatterType>('litigation');
  const [formCaseNumber, setFormCaseNumber] = useState('');
  const [formJurisdiction, setFormJurisdiction] = useState('');
  const [formCourt, setFormCourt] = useState('');
  const [formJudge, setFormJudge] = useState('');
  const [formOpposingCounsel, setFormOpposingCounsel] = useState('');
  const [formAssignee, setFormAssignee] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // --- Document form state ---
  const [formDocumentType, setFormDocumentType] = useState<DocumentType>('motion');
  const [formCaseName, setFormCaseName] = useState('');
  const [formVersion, setFormVersion] = useState('1');
  const [formFilingDeadline, setFormFilingDeadline] = useState('');

  // --- Time entry form state ---
  const [formHours, setFormHours] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formBillable, setFormBillable] = useState(true);
  const [formDate, setFormDate] = useState('');

  // --- Calendar form state ---
  const [formEventType, setFormEventType] = useState<CalendarType>('court_date');
  const [formEventDate, setFormEventDate] = useState('');
  const [formEventTime, setFormEventTime] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formRuleSet, setFormRuleSet] = useState<RuleSet>('federal');

  // --- Contact form state ---
  const [formContactType, setFormContactType] = useState<ContactType>('client');
  const [formOrganization, setFormOrganization] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formRelationship, setFormRelationship] = useState('');
  const [formConflictCleared, setFormConflictCleared] = useState(false);

  // --- Contract form state ---
  const [formParties, setFormParties] = useState('');
  const [formKeyTerms, setFormKeyTerms] = useState('');
  const [formRenewalDate, setFormRenewalDate] = useState('');
  const [formObligations, setFormObligations] = useState('');

  // --- Compliance form state ---
  const [formComplianceType, setFormComplianceType] = useState('cle_credits');
  const [formCredits, setFormCredits] = useState('');
  const [formCreditsRequired, setFormCreditsRequired] = useState('');
  const [formBarState, setFormBarState] = useState('');

  // --- Trust account tracking ---
  const [formTrustBalance, setFormTrustBalance] = useState('');

  // --- Billing sub-tab ---
  const [billingSubTab, setBillingSubTab] = useState<'entries' | 'invoices' | 'trust'>('entries');

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<LegalArtifact>('legal', 'artifact', {
      seed: seedItems.map((s) => ({
        title: s.title,
        data: s.data as unknown as Record<string, unknown>,
        meta: { status: s.data.status, tags: [s.data.artifactType] },
      })),
    });

  const runAction = useRunArtifact('legal');

  /* ---------- derived ---------- */

  const currentTabType = MODE_TABS.find((t) => t.id === activeTab)?.defaultType ?? 'Case';
  const currentStatuses = STATUSES_BY_TYPE[currentTabType] ?? [];

  const allByType = useCallback(
    (type: ArtifactType) => {
      return items.filter((i) => (i.data as unknown as LegalArtifact).artifactType === type);
    },
    [items]
  );

  const filtered = useMemo(() => {
    if (activeTab === 'Dashboard') return [];
    const type = currentTabType;
    let list = items.filter((i) => (i.data as unknown as LegalArtifact).artifactType === type);
    if (filterStatus !== 'all')
      list = list.filter((i) => (i.data as unknown as LegalArtifact).status === filterStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as LegalArtifact).description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeTab, currentTabType, filterStatus, searchQuery]);

  /* ---------- Dashboard stats ---------- */

  const stats = useMemo(() => {
    const cases = allByType('Case');
    const docs = allByType('Document');
    const timeEntries = allByType('TimeEntry');
    const events = allByType('CalendarEvent');
    const contacts = allByType('Contact');
    const contracts = allByType('Contract');
    const compliance = allByType('ComplianceItem');

    const activeCases = cases.filter((i) => {
      const d = i.data as unknown as CaseData;
      return d.status !== 'closed';
    });

    const billableEntries = timeEntries.filter((i) => {
      const d = i.data as unknown as TimeEntryData;
      return d.billable !== false;
    });

    const totalBillableHours = billableEntries.reduce((sum, i) => {
      const d = i.data as unknown as TimeEntryData;
      return sum + (d.hours || 0);
    }, 0);

    const unbilledEntries = timeEntries.filter((i) => {
      const d = i.data as unknown as TimeEntryData;
      return d.status === 'logged' && d.billable !== false;
    });

    const unbilledAmount = unbilledEntries.reduce((sum, i) => {
      const d = i.data as unknown as TimeEntryData;
      return sum + (d.hours || 0) * (d.rate || 0);
    }, 0);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const weeklyHours = billableEntries
      .filter((i) => {
        const d = i.data as unknown as TimeEntryData;
        return d.date && new Date(d.date) >= weekAgo;
      })
      .reduce((sum, i) => sum + ((i.data as unknown as TimeEntryData).hours || 0), 0);

    const monthlyHours = billableEntries
      .filter((i) => {
        const d = i.data as unknown as TimeEntryData;
        return d.date && new Date(d.date) >= monthAgo;
      })
      .reduce((sum, i) => sum + ((i.data as unknown as TimeEntryData).hours || 0), 0);

    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = events.filter((i) => {
      const d = i.data as unknown as CalendarEventData;
      if (!d.eventDate) return false;
      const eDate = new Date(d.eventDate);
      return eDate >= now && eDate <= next7Days && d.status !== 'completed';
    });

    const overdueEvents = events.filter((i) => {
      const d = i.data as unknown as CalendarEventData;
      if (!d.eventDate) return false;
      return new Date(d.eventDate) < now && d.status !== 'completed';
    });

    const trustBalance = compliance
      .filter((i) => (i.data as unknown as ComplianceData).complianceType === 'trust_account')
      .reduce(
        (sum, i) =>
          sum +
          ((i.data as unknown as ComplianceData & { trustBalance?: number }).trustBalance || 0),
        0
      );

    const activeContracts = contracts.filter((i) => {
      const d = i.data as unknown as ContractData;
      return ['active', 'executed'].includes(d.status);
    });

    const overdueCompliance = compliance.filter(
      (i) => (i.data as unknown as ComplianceData).status === 'overdue'
    );

    const totalValue = cases.reduce(
      (sum, i) => sum + ((i.data as unknown as CaseData).value || 0),
      0
    );

    return {
      activeCases: activeCases.length,
      totalCases: cases.length,
      totalDocuments: docs.length,
      totalBillableHours,
      weeklyHours,
      monthlyHours,
      unbilledAmount,
      upcomingDeadlines: upcomingDeadlines.length,
      overdueEvents: overdueEvents.length,
      totalContacts: contacts.length,
      activeContracts: activeContracts.length,
      totalContracts: contracts.length,
      overdueCompliance: overdueCompliance.length,
      trustBalance,
      totalValue,
      upcomingDeadlineItems: upcomingDeadlines,
      overdueEventItems: overdueEvents,
    };
  }, [allByType]);

  /* ---------- editor helpers ---------- */

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormStatus('intake');
    setFormDescription('');
    setFormMatterType('litigation');
    setFormCaseNumber('');
    setFormJurisdiction('');
    setFormCourt('');
    setFormJudge('');
    setFormOpposingCounsel('');
    setFormAssignee('');
    setFormDueDate('');
    setFormValue('');
    setFormNotes('');
    setFormDocumentType('motion');
    setFormCaseName('');
    setFormVersion('1');
    setFormFilingDeadline('');
    setFormHours('');
    setFormRate('');
    setFormBillable(true);
    setFormDate('');
    setFormEventType('court_date');
    setFormEventDate('');
    setFormEventTime('');
    setFormLocation('');
    setFormRuleSet('federal');
    setFormContactType('client');
    setFormOrganization('');
    setFormEmail('');
    setFormPhone('');
    setFormAddress('');
    setFormRelationship('');
    setFormConflictCleared(false);
    setFormParties('');
    setFormKeyTerms('');
    setFormRenewalDate('');
    setFormObligations('');
    setFormComplianceType('cle_credits');
    setFormCredits('');
    setFormCreditsRequired('');
    setFormBarState('');
    setFormTrustBalance('');
  }, []);

  const openNewEditor = (type?: ArtifactType) => {
    setEditingItem(null);
    resetForm();
    const t = type || currentTabType;
    setEditorMode(t);
    setFormStatus(STATUSES_BY_TYPE[t][0]);
    setShowEditor(true);
  };

  const openEditEditor = (item: LensItem<LegalArtifact>) => {
    const d = item.data as unknown as LegalArtifact;
    setEditingItem(item);
    setEditorMode(d.artifactType);
    setFormTitle(item.title);
    setFormStatus(d.status);
    setFormDescription(d.description || '');
    setFormNotes((d as CaseData).notes || '');
    setFormAssignee((d as CaseData).assignee || '');

    if (d.artifactType === 'Case') {
      const c = d as CaseData;
      setFormMatterType(c.matterType || 'litigation');
      setFormCaseNumber(c.caseNumber || '');
      setFormJurisdiction(c.jurisdiction || '');
      setFormCourt(c.court || '');
      setFormJudge(c.judge || '');
      setFormOpposingCounsel(c.opposingCounsel || '');
      setFormDueDate(c.dueDate || '');
      setFormValue(c.value ? String(c.value) : '');
    } else if (d.artifactType === 'Document') {
      const doc = d as DocumentData;
      setFormDocumentType(doc.documentType || 'motion');
      setFormCaseName(doc.caseName || '');
      setFormVersion(doc.version ? String(doc.version) : '1');
      setFormFilingDeadline(doc.filingDeadline || '');
    } else if (d.artifactType === 'TimeEntry') {
      const te = d as TimeEntryData;
      setFormCaseName(te.caseName || '');
      setFormHours(te.hours ? String(te.hours) : '');
      setFormRate(te.rate ? String(te.rate) : '');
      setFormBillable(te.billable !== false);
      setFormDate(te.date || '');
    } else if (d.artifactType === 'CalendarEvent') {
      const ev = d as CalendarEventData;
      setFormEventType(ev.eventType || 'court_date');
      setFormCaseName(ev.caseName || '');
      setFormEventDate(ev.eventDate || '');
      setFormEventTime(ev.eventTime || '');
      setFormLocation(ev.location || '');
      setFormRuleSet(ev.ruleSet || 'federal');
    } else if (d.artifactType === 'Contact') {
      const ct = d as ContactData;
      setFormContactType(ct.contactType || 'client');
      setFormCaseName(ct.caseName || '');
      setFormOrganization(ct.organization || '');
      setFormEmail(ct.email || '');
      setFormPhone(ct.phone || '');
      setFormAddress(ct.address || '');
      setFormRelationship(ct.relationship || '');
      setFormConflictCleared(ct.conflictCleared || false);
    } else if (d.artifactType === 'Contract') {
      const co = d as ContractData;
      setFormParties(co.parties?.join(', ') || '');
      setFormKeyTerms(co.keyTerms?.join(', ') || '');
      setFormRenewalDate(co.renewalDate || '');
      setFormObligations(co.obligations?.join('\n') || '');
      setFormValue(co.value ? String(co.value) : '');
      setFormJurisdiction(co.jurisdiction || '');
      setFormDueDate(co.dueDate || '');
    } else if (d.artifactType === 'ComplianceItem') {
      const ci = d as ComplianceData;
      setFormComplianceType(ci.complianceType || 'cle_credits');
      setFormDueDate(ci.dueDate || '');
      setFormCredits(ci.credits ? String(ci.credits) : '');
      setFormCreditsRequired(ci.creditsRequired ? String(ci.creditsRequired) : '');
      setFormBarState(ci.barState || '');
    }

    setShowEditor(true);
  };

  const openDetail = (item: LensItem<LegalArtifact>) => {
    setDetailItem(item);
    setShowDetailPanel(true);
  };

  const handleSave = async () => {
    let data: Record<string, unknown> = {
      artifactType: editorMode,
      status: formStatus,
      description: formDescription,
      assignee: formAssignee,
      notes: formNotes,
    };

    if (editorMode === 'Case') {
      data = {
        ...data,
        matterType: formMatterType,
        caseNumber: formCaseNumber,
        jurisdiction: formJurisdiction,
        court: formCourt,
        judge: formJudge,
        opposingCounsel: formOpposingCounsel,
        dueDate: formDueDate,
        value: formValue ? parseFloat(formValue) : undefined,
      };
    } else if (editorMode === 'Document') {
      data = {
        ...data,
        documentType: formDocumentType,
        caseName: formCaseName,
        version: formVersion ? parseInt(formVersion) : 1,
        filingDeadline: formFilingDeadline,
      };
    } else if (editorMode === 'TimeEntry') {
      data = {
        ...data,
        caseName: formCaseName,
        hours: formHours ? parseFloat(formHours) : 0,
        rate: formRate ? parseFloat(formRate) : 0,
        billable: formBillable,
        date: formDate,
      };
    } else if (editorMode === 'CalendarEvent') {
      data = {
        ...data,
        eventType: formEventType,
        caseName: formCaseName,
        eventDate: formEventDate,
        eventTime: formEventTime,
        location: formLocation,
        ruleSet: formRuleSet,
      };
    } else if (editorMode === 'Contact') {
      data = {
        ...data,
        contactType: formContactType,
        caseName: formCaseName,
        organization: formOrganization,
        email: formEmail,
        phone: formPhone,
        address: formAddress,
        relationship: formRelationship,
        conflictCleared: formConflictCleared,
      };
    } else if (editorMode === 'Contract') {
      data = {
        ...data,
        parties: formParties
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        keyTerms: formKeyTerms
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        renewalDate: formRenewalDate,
        obligations: formObligations.split('\n').filter(Boolean),
        value: formValue ? parseFloat(formValue) : undefined,
        jurisdiction: formJurisdiction,
        dueDate: formDueDate,
      };
    } else if (editorMode === 'ComplianceItem') {
      data = {
        ...data,
        complianceType: formComplianceType,
        dueDate: formDueDate,
        credits: formCredits ? parseFloat(formCredits) : undefined,
        creditsRequired: formCreditsRequired ? parseFloat(formCreditsRequired) : undefined,
        barState: formBarState,
        trustBalance: formTrustBalance ? parseFloat(formTrustBalance) : undefined,
      };
    }

    const payload = {
      title: formTitle,
      data: data as unknown as Partial<LegalArtifact>,
      meta: { status: formStatus, tags: [editorMode] },
    };

    if (editingItem) await update(editingItem.id, payload);
    else await create(payload);
    setShowEditor(false);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingItem?.id || filtered[0]?.id || items[0]?.id;
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

  /* ---------- render helpers ---------- */

  const StatusBadge = ({ status }: { status: string }) => {
    const color = STATUS_COLORS[status] || 'gray-400';
    return <span className={ds.badge(color)}>{formatLabel(status)}</span>;
  };

  const DeadlineTag = ({ date }: { date: string | undefined }) => {
    if (!date) return null;
    const urgency = deadlineUrgency(date);
    const days = daysUntil(date);
    const urgencyClasses: Record<string, string> = {
      overdue: 'text-red-400 bg-red-400/10',
      urgent: 'text-amber-400 bg-amber-400/10',
      soon: 'text-neon-blue bg-neon-blue/10',
      normal: 'text-gray-400 bg-gray-400/10',
      none: '',
    };
    if (urgency === 'none') return null;
    return (
      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', urgencyClasses[urgency])}>
        {urgency === 'overdue' ? `${Math.abs(days)}d overdue` : `${days}d left`}
      </span>
    );
  };

  const StatCard = ({
    icon: Icon,
    value,
    label,
    sub,
    color = 'text-neon-blue',
  }: {
    icon: React.ElementType;
    value: string | number;
    label: string;
    sub?: string;
    color?: string;
  }) => (
    <div data-lens-theme="legal" className={ds.panel}>
      <Icon className={cn('w-5 h-5 mb-2', color)} />
      <p className="text-2xl font-bold">{value}</p>
      <p className={ds.textMuted}>{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );

  /* ---------- render: loading ---------- */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading case files...</p>
        </div>
      </div>
    );
  }

  /* ---------- render: error ---------- */

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  /* ---------- render: dashboard tab ---------- */

  const renderDashboard = () => {
    const cases = allByType('Case');
    const recentCases = cases.slice(0, 5);
    const _timeEntries = allByType('TimeEntry');
    const events = allByType('CalendarEvent');
    const compliance = allByType('ComplianceItem');

    const overdueItems = events.filter((i) => {
      const d = i.data as unknown as CalendarEventData;
      return d.eventDate && new Date(d.eventDate) < new Date() && d.status !== 'completed';
    });

    const upcomingItems = events
      .filter((i) => {
        const d = i.data as unknown as CalendarEventData;
        if (!d.eventDate) return false;
        const eDate = new Date(d.eventDate);
        const now = new Date();
        const next7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return eDate >= now && eDate <= next7 && d.status !== 'completed';
      })
      .sort((a, b) => {
        const aDate = (a.data as unknown as CalendarEventData).eventDate || '';
        const bDate = (b.data as unknown as CalendarEventData).eventDate || '';
        return aDate.localeCompare(bDate);
      });

    const complianceAlerts = compliance.filter((i) => {
      const d = i.data as unknown as ComplianceData;
      return d.status === 'overdue' || d.status === 'due_soon';
    });

    return (
      <>
        {/* Top-level KPIs */}
        <div className={ds.grid4}>
          <StatCard
            icon={Briefcase}
            value={stats.activeCases}
            label="Active Matters"
            sub={`${stats.totalCases} total cases`}
            color="text-neon-blue"
          />
          <StatCard
            icon={Timer}
            value={`${stats.weeklyHours.toFixed(1)}h`}
            label="Billable This Week"
            sub={`${stats.monthlyHours.toFixed(1)}h this month`}
            color="text-neon-green"
          />
          <StatCard
            icon={AlertTriangle}
            value={stats.upcomingDeadlines}
            label="Deadlines (7 days)"
            sub={`${stats.overdueEvents} overdue`}
            color="text-amber-400"
          />
          <StatCard
            icon={DollarSign}
            value={formatCurrency(stats.unbilledAmount)}
            label="Unbilled Time"
            sub={`Trust: ${formatCurrency(stats.trustBalance)}`}
            color="text-amber-400"
          />
        </div>

        {/* Second row KPIs */}
        <div className={ds.grid4}>
          <StatCard
            icon={FileText}
            value={stats.totalDocuments}
            label="Documents"
            color="text-neon-cyan"
          />
          <StatCard
            icon={Users}
            value={stats.totalContacts}
            label="Contacts"
            color="text-neon-blue"
          />
          <StatCard
            icon={ScrollText}
            value={stats.activeContracts}
            label="Active Contracts"
            sub={`${stats.totalContracts} total`}
            color="text-neon-green"
          />
          <StatCard
            icon={ShieldCheck}
            value={stats.overdueCompliance}
            label="Compliance Alerts"
            sub={stats.overdueCompliance > 0 ? 'Action required' : 'All clear'}
            color={stats.overdueCompliance > 0 ? 'text-red-400' : 'text-neon-green'}
          />
        </div>

        <div className={ds.grid2}>
          {/* Upcoming Deadlines */}
          <section className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-3')}>
              <h3 className={ds.heading3}>Upcoming Deadlines</h3>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            {upcomingItems.length === 0 ? (
              <p className={cn(ds.textMuted, 'py-4 text-center')}>
                No deadlines in the next 7 days
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {upcomingItems.map((item) => {
                  const d = item.data as unknown as CalendarEventData;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated transition-colors cursor-pointer"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-gray-500">
                            {d.caseName && `${d.caseName} - `}
                            {formatLabel(d.eventType || 'event')}
                          </p>
                        </div>
                      </div>
                      <DeadlineTag date={d.eventDate} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Overdue Tasks */}
          <section className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-3')}>
              <h3 className={ds.heading3}>Overdue Items</h3>
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            {overdueItems.length === 0 ? (
              <div className="py-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-neon-green mx-auto mb-2" />
                <p className={ds.textMuted}>No overdue items</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {overdueItems.map((item) => {
                  const d = item.data as unknown as CalendarEventData;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-red-500/5 border border-red-500/20 cursor-pointer hover:bg-red-500/10 transition-colors"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-gray-500">{d.eventDate}</p>
                        </div>
                      </div>
                      <DeadlineTag date={d.eventDate} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className={ds.grid2}>
          {/* Recent Cases */}
          <section className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-3')}>
              <h3 className={ds.heading3}>Recent Cases</h3>
              <button onClick={() => setActiveTab('Cases')} className={cn(ds.btnGhost, 'text-xs')}>
                View All <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {recentCases.length === 0 ? (
              <p className={cn(ds.textMuted, 'py-4 text-center')}>
                No cases yet. Create one to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {recentCases.map((item) => {
                  const d = item.data as unknown as CaseData;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated transition-colors cursor-pointer"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Briefcase className="w-4 h-4 text-neon-blue shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-gray-500">
                            {d.caseNumber && `#${d.caseNumber} - `}
                            {formatLabel(d.matterType || 'case')}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Compliance Alerts */}
          <section className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-3')}>
              <h3 className={ds.heading3}>Compliance Alerts</h3>
              <Shield className="w-4 h-4 text-amber-400" />
            </div>
            {complianceAlerts.length === 0 ? (
              <div className="py-4 text-center">
                <BadgeCheck className="w-8 h-8 text-neon-green mx-auto mb-2" />
                <p className={ds.textMuted}>All compliance items up to date</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {complianceAlerts.map((item) => {
                  const d = item.data as unknown as ComplianceData;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated transition-colors cursor-pointer"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle
                          className={cn(
                            'w-4 h-4 shrink-0',
                            d.status === 'overdue' ? 'text-red-400' : 'text-amber-400'
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-gray-500">
                            {formatLabel(d.complianceType || 'compliance')}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </>
    );
  };

  /* ---------- render: case cards ---------- */

  const renderCaseCards = () => (
    <div className={ds.grid3}>
      {filtered.map((item, index) => {
        const d = item.data as unknown as CaseData;
        const color = STATUS_COLORS[d.status] || 'gray-400';
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={ds.panelHover}
            onClick={() => openDetail(item)}
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
              <StatusBadge status={d.status} />
            </div>
            {d.caseNumber && (
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                <Hash className="w-3 h-3" /> {d.caseNumber}
              </div>
            )}
            <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>

            {/* Case lifecycle */}
            <div className="flex items-center gap-1 mb-3">
              {['intake', 'active', 'discovery', 'trial', 'closed'].map((step, idx) => {
                const isActive = STATUSES_BY_TYPE.Case.indexOf(d.status) >= idx;
                return (
                  <div key={step} className="flex items-center gap-1">
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        isActive ? `bg-${color}` : 'bg-gray-700'
                      )}
                    />
                    {idx < 4 && (
                      <div className={cn('w-4 h-px', isActive ? `bg-${color}` : 'bg-gray-700')} />
                    )}
                  </div>
                );
              })}
              <span className="text-xs text-gray-500 ml-1">{formatLabel(d.status)}</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              {d.matterType && (
                <span className={ds.badge('gray-400')}>{formatLabel(d.matterType)}</span>
              )}
              {d.jurisdiction && (
                <span className="flex items-center gap-1">
                  <Gavel className="w-3 h-3" /> {d.jurisdiction}
                </span>
              )}
              {d.judge && (
                <span className="flex items-center gap-1">
                  <UserCheck className="w-3 h-3" /> {d.judge}
                </span>
              )}
              {d.assignee && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> {d.assignee}
                </span>
              )}
              {d.court && (
                <span className="flex items-center gap-1">
                  <Landmark className="w-3 h-3" /> {d.court}
                </span>
              )}
              {d.value != null && d.value > 0 && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> {formatCurrency(d.value)}
                </span>
              )}
            </div>
            {d.dueDate && (
              <div className="mt-2">
                <DeadlineTag date={d.dueDate} />
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );

  /* ---------- render: document cards ---------- */

  const renderDocumentCards = () => (
    <div className={ds.grid3}>
      {filtered.map((item) => {
        const d = item.data as unknown as DocumentData;
        return (
          <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-5 h-5 text-neon-cyan shrink-0" />
                <h3 className={cn(ds.heading3, 'text-base truncate')}>{item.title}</h3>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              {d.documentType && (
                <span className={ds.badge('neon-cyan')}>{formatLabel(d.documentType)}</span>
              )}
              {d.caseName && (
                <span className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> {d.caseName}
                </span>
              )}
              {d.version && (
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> v{d.version}
                </span>
              )}
              {d.assignee && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> {d.assignee}
                </span>
              )}
            </div>
            {d.filingDeadline && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Filing deadline:</span>
                <DeadlineTag date={d.filingDeadline} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* ---------- render: time & billing ---------- */

  const renderTimeBilling = () => {
    const entries = filtered;
    const billableTotal = entries
      .filter((i) => (i.data as unknown as TimeEntryData).billable !== false)
      .reduce((sum, i) => sum + ((i.data as unknown as TimeEntryData).hours || 0), 0);
    const billableAmount = entries
      .filter((i) => (i.data as unknown as TimeEntryData).billable !== false)
      .reduce((sum, i) => {
        const d = i.data as unknown as TimeEntryData;
        return sum + (d.hours || 0) * (d.rate || 0);
      }, 0);
    const unbilled = entries
      .filter((i) => {
        const d = i.data as unknown as TimeEntryData;
        return d.status === 'logged' && d.billable !== false;
      })
      .reduce((sum, i) => {
        const d = i.data as unknown as TimeEntryData;
        return sum + (d.hours || 0) * (d.rate || 0);
      }, 0);
    const paid = entries
      .filter((i) => (i.data as unknown as TimeEntryData).status === 'paid')
      .reduce((sum, i) => {
        const d = i.data as unknown as TimeEntryData;
        return sum + (d.hours || 0) * (d.rate || 0);
      }, 0);

    return (
      <>
        {/* Billing summary */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <Timer className="w-5 h-5 text-neon-blue mb-2" />
            <p className="text-2xl font-bold">{billableTotal.toFixed(1)}h</p>
            <p className={ds.textMuted}>Total Billable Hours</p>
          </div>
          <div className={ds.panel}>
            <DollarSign className="w-5 h-5 text-neon-green mb-2" />
            <p className="text-2xl font-bold">{formatCurrencyDecimal(billableAmount)}</p>
            <p className={ds.textMuted}>Total Billed</p>
          </div>
          <div className={ds.panel}>
            <Hourglass className="w-5 h-5 text-amber-400 mb-2" />
            <p className="text-2xl font-bold">{formatCurrencyDecimal(unbilled)}</p>
            <p className={ds.textMuted}>Unbilled Time</p>
          </div>
          <div className={ds.panel}>
            <CheckCircle2 className="w-5 h-5 text-neon-green mb-2" />
            <p className="text-2xl font-bold">{formatCurrencyDecimal(paid)}</p>
            <p className={ds.textMuted}>Payments Received</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-2">
          {(['entries', 'invoices', 'trust'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setBillingSubTab(tab)}
              className={cn(ds.btnGhost, billingSubTab === tab && 'bg-neon-blue/20 text-neon-blue')}
            >
              {tab === 'entries' && <Clock className="w-4 h-4" />}
              {tab === 'invoices' && <Receipt className="w-4 h-4" />}
              {tab === 'trust' && <Landmark className="w-4 h-4" />}
              {formatLabel(tab)}
            </button>
          ))}
        </div>

        {billingSubTab === 'entries' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border text-left">
                  <th className="py-2 px-3 text-gray-400 font-medium">Description</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Matter</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Date</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Hours</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Rate</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Amount</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Billable</th>
                  <th className="py-2 px-3 text-gray-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-500">
                      No time entries recorded. Click &quot;New Item&quot; to log time.
                    </td>
                  </tr>
                ) : (
                  entries.map((item) => {
                    const d = item.data as unknown as TimeEntryData;
                    const amount = (d.hours || 0) * (d.rate || 0);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30 cursor-pointer transition-colors"
                        onClick={() => openEditEditor(item)}
                      >
                        <td className="py-2 px-3 font-medium">{item.title}</td>
                        <td className="py-2 px-3 text-gray-400">{d.caseName || '-'}</td>
                        <td className="py-2 px-3 text-gray-400">{d.date || '-'}</td>
                        <td className="py-2 px-3">{d.hours?.toFixed(1) || '0.0'}</td>
                        <td className="py-2 px-3 text-gray-400">
                          {d.rate ? formatCurrencyDecimal(d.rate) : '-'}/hr
                        </td>
                        <td className="py-2 px-3 font-medium">{formatCurrencyDecimal(amount)}</td>
                        <td className="py-2 px-3">
                          {d.billable !== false ? (
                            <CheckCircle2 className="w-4 h-4 text-neon-green" />
                          ) : (
                            <XCircle className="w-4 h-4 text-gray-500" />
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <StatusBadge status={d.status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {billingSubTab === 'invoices' && (
          <div className={ds.panel}>
            <div className="text-center py-8">
              <Receipt className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>
                Invoice generation is available via the &quot;Generate Invoice&quot; domain action.
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Select a matter and run the action to create an invoice from unbilled time entries.
              </p>
              <button
                onClick={() => handleAction('generateInvoice')}
                className={cn(ds.btnPrimary, 'mt-4')}
              >
                <Receipt className="w-4 h-4" /> Generate Invoice
              </button>
            </div>
          </div>
        )}

        {billingSubTab === 'trust' && (
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <div>
                <h3 className={ds.heading3}>Trust Account (IOLTA)</h3>
                <p className={ds.textMuted}>Interest on Lawyers&apos; Trust Account tracking</p>
              </div>
              <Landmark className="w-5 h-5 text-amber-400" />
            </div>
            <div className={ds.grid3}>
              <div className="bg-lattice-elevated rounded-lg p-4">
                <p className="text-sm text-gray-400">Current Balance</p>
                <p className="text-2xl font-bold text-neon-green">
                  {formatCurrency(stats.trustBalance)}
                </p>
              </div>
              <div className="bg-lattice-elevated rounded-lg p-4">
                <p className="text-sm text-gray-400">Compliance Status</p>
                <p className="text-2xl font-bold">
                  {stats.trustBalance >= 0 ? (
                    <span className="text-neon-green">Compliant</span>
                  ) : (
                    <span className="text-red-400">Deficit</span>
                  )}
                </p>
              </div>
              <div className="bg-lattice-elevated rounded-lg p-4">
                <p className="text-sm text-gray-400">Last Audit</p>
                <p className="text-lg font-medium text-gray-300">Run audit via action</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Trust account balances are tracked via Compliance items with type
              &quot;trust_account&quot;. Use the Compliance Audit action for a full report.
            </p>
          </div>
        )}
      </>
    );
  };

  /* ---------- render: calendar ---------- */

  const renderCalendar = () => {
    const sortedEvents = [...filtered].sort((a, b) => {
      const aDate = (a.data as unknown as CalendarEventData).eventDate || '';
      const bDate = (b.data as unknown as CalendarEventData).eventDate || '';
      return aDate.localeCompare(bDate);
    });

    const groupedByDate: Record<string, typeof sortedEvents> = {};
    sortedEvents.forEach((item) => {
      const d = item.data as unknown as CalendarEventData;
      const key = d.eventDate || 'No Date';
      if (!groupedByDate[key]) groupedByDate[key] = [];
      groupedByDate[key].push(item);
    });

    const eventTypeIcons: Record<string, React.ElementType> = {
      court_date: Gavel,
      filing_deadline: FileClock,
      hearing: BookOpen,
      deposition: FileSearch,
      sol_deadline: Hourglass,
      meeting: Users,
      other: Calendar,
    };

    return (
      <div className="space-y-4">
        {/* SOL Calculator teaser */}
        <div className={cn(ds.panel, 'border-amber-400/30')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calculator className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold">Statute of Limitations Calculator</h3>
                <p className="text-xs text-gray-500">
                  Calculate SOL deadlines with rule-based adjustments (Federal, State, Local rules)
                </p>
              </div>
            </div>
            <button onClick={() => handleAction('deadlineCalculator')} className={ds.btnSecondary}>
              <Calculator className="w-4 h-4" /> Calculate
            </button>
          </div>
        </div>

        {Object.keys(groupedByDate).length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>
              No calendar events found. Schedule hearings, deadlines, and depositions.
            </p>
          </div>
        ) : (
          Object.entries(groupedByDate).map(([date, evts]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-sm font-semibold text-gray-300">{date}</div>
                <DeadlineTag date={date !== 'No Date' ? date : undefined} />
                <div className="flex-1 h-px bg-lattice-border" />
              </div>
              <div className="space-y-2 ml-4">
                {evts.map((item) => {
                  const d = item.data as unknown as CalendarEventData;
                  const EvtIcon = eventTypeIcons[d.eventType || 'other'] || Calendar;
                  return (
                    <div
                      key={item.id}
                      className={cn(ds.panelHover, 'flex items-center gap-3')}
                      onClick={() => openEditEditor(item)}
                    >
                      <EvtIcon className="w-5 h-5 text-neon-blue shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <StatusBadge status={d.status} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                          {d.eventTime && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {d.eventTime}
                            </span>
                          )}
                          {d.caseName && (
                            <span className="flex items-center gap-1">
                              <Briefcase className="w-3 h-3" /> {d.caseName}
                            </span>
                          )}
                          {d.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {d.location}
                            </span>
                          )}
                          {d.ruleSet && (
                            <span className={ds.badge('gray-400')}>
                              {formatLabel(d.ruleSet)} rules
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  /* ---------- render: contacts ---------- */

  const renderContacts = () => {
    const contactTypeIcons: Record<string, React.ElementType> = {
      client: UserCheck,
      opposing_party: Users,
      witness: Eye,
      expert: GraduationCap,
      judge: Gavel,
      opposing_counsel: Scale,
    };

    return (
      <div className={ds.grid3}>
        {filtered.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>
              No contacts found. Add clients, witnesses, experts, and opposing parties.
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const d = item.data as unknown as ContactData;
            const ContactIcon = contactTypeIcons[d.contactType || 'client'] || Users;
            return (
              <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-neon-blue/20 flex items-center justify-center shrink-0">
                    <ContactIcon className="w-5 h-5 text-neon-blue" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={cn(ds.heading3, 'text-base truncate')}>{item.title}</h3>
                    <span className={ds.badge(STATUS_COLORS[d.contactType || ''] || 'gray-400')}>
                      {formatLabel(d.contactType || 'contact')}
                    </span>
                  </div>
                  {d.conflictCleared && (
                    <CheckCircle2 className="w-4 h-4 text-neon-green shrink-0" />
                  )}
                </div>
                {d.organization && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Building className="w-3 h-3" /> {d.organization}
                  </div>
                )}
                {d.email && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Mail className="w-3 h-3" /> {d.email}
                  </div>
                )}
                {d.phone && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Phone className="w-3 h-3" /> {d.phone}
                  </div>
                )}
                {d.caseName && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                    <Briefcase className="w-3 h-3" /> {d.caseName}
                  </div>
                )}
                {d.relationship && (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Link2 className="w-3 h-3" /> {d.relationship}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  };

  /* ---------- render: contracts ---------- */

  const renderContracts = () => (
    <div className={ds.grid3}>
      {filtered.length === 0 ? (
        <div className="col-span-full text-center py-12">
          <ScrollText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>
            No contracts found. Track contract lifecycle from draft to renewal.
          </p>
        </div>
      ) : (
        filtered.map((item) => {
          const d = item.data as unknown as ContractData;
          return (
            <div key={item.id} className={ds.panelHover} onClick={() => openDetail(item)}>
              <div className="flex items-start justify-between mb-2">
                <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                <StatusBadge status={d.status} />
              </div>
              <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>

              {/* Lifecycle progress */}
              <div className="flex items-center gap-1 mb-3">
                {['draft', 'review', 'negotiation', 'executed', 'active'].map((step, idx) => {
                  const stepIdx = STATUSES_BY_TYPE.Contract.indexOf(step);
                  const currentIdx = STATUSES_BY_TYPE.Contract.indexOf(d.status);
                  const isActive = currentIdx >= stepIdx;
                  return (
                    <div key={step} className="flex items-center gap-1">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full',
                          isActive ? 'bg-neon-green' : 'bg-gray-700'
                        )}
                      />
                      {idx < 4 && (
                        <div
                          className={cn('w-4 h-px', isActive ? 'bg-neon-green' : 'bg-gray-700')}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                {d.parties && d.parties.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" /> {d.parties.length} parties
                  </span>
                )}
                {d.value != null && d.value > 0 && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> {formatCurrency(d.value)}
                  </span>
                )}
                {d.renewalDate && (
                  <span className="flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Renews: {d.renewalDate}
                  </span>
                )}
                {d.jurisdiction && (
                  <span className="flex items-center gap-1">
                    <Gavel className="w-3 h-3" /> {d.jurisdiction}
                  </span>
                )}
              </div>
              {d.keyTerms && d.keyTerms.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {d.keyTerms.slice(0, 3).map((term, i) => (
                    <span key={i} className={ds.badge('neon-cyan')}>
                      {term}
                    </span>
                  ))}
                  {d.keyTerms.length > 3 && (
                    <span className="text-xs text-gray-500">+{d.keyTerms.length - 3} more</span>
                  )}
                </div>
              )}
              {d.renewalDate && (
                <div className="mt-2">
                  <DeadlineTag date={d.renewalDate} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  /* ---------- render: compliance ---------- */

  const renderCompliance = () => {
    const complianceTypeIcons: Record<string, React.ElementType> = {
      cle_credits: GraduationCap,
      bar_admission: BadgeCheck,
      malpractice_insurance: Shield,
      trust_account: Landmark,
      ethical_screening: ClipboardCheck,
      other: ShieldCheck,
    };

    return (
      <div className={ds.grid3}>
        {filtered.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <ShieldCheck className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>
              No compliance items. Track CLE credits, bar admissions, and insurance renewals.
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const d = item.data as unknown as ComplianceData;
            const CIcon = complianceTypeIcons[d.complianceType || 'other'] || ShieldCheck;
            return (
              <div
                key={item.id}
                className={cn(
                  ds.panelHover,
                  d.status === 'overdue' && 'border-red-500/30',
                  d.status === 'due_soon' && 'border-amber-400/30'
                )}
                onClick={() => openEditEditor(item)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CIcon
                      className={cn(
                        'w-5 h-5',
                        d.status === 'overdue'
                          ? 'text-red-400'
                          : d.status === 'compliant'
                            ? 'text-neon-green'
                            : 'text-amber-400'
                      )}
                    />
                    <h3 className={cn(ds.heading3, 'text-base truncate')}>{item.title}</h3>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>

                {d.complianceType === 'cle_credits' &&
                  d.credits != null &&
                  d.creditsRequired != null && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-400">CLE Progress</span>
                        <span className="font-medium">
                          {d.credits}/{d.creditsRequired} credits
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className={cn(
                            'h-2 rounded-full',
                            d.credits >= d.creditsRequired ? 'bg-neon-green' : 'bg-neon-blue'
                          )}
                          style={{
                            width: `${Math.min(100, (d.credits / d.creditsRequired) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  <span className={ds.badge('gray-400')}>
                    {formatLabel(d.complianceType || 'other')}
                  </span>
                  {d.barState && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {d.barState}
                    </span>
                  )}
                  {d.dueDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Due: {d.dueDate}
                    </span>
                  )}
                  {d.assignee && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {d.assignee}
                    </span>
                  )}
                </div>
                {d.dueDate && (
                  <div className="mt-2">
                    <DeadlineTag date={d.dueDate} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  };

  /* ---------- render: detail panel ---------- */

  const renderDetailPanel = () => {
    if (!detailItem || !showDetailPanel) return null;
    const d = detailItem.data as unknown as LegalArtifact;

    return (
      <>
        <div className={ds.modalBackdrop} onClick={() => setShowDetailPanel(false)} />
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-3xl')}>
            <div className="flex items-center justify-between p-4 border-b border-lattice-border">
              <div className="flex items-center gap-3">
                <StatusBadge status={d.status} />
                <h2 className={ds.heading2}>{detailItem.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowDetailPanel(false);
                    openEditEditor(detailItem);
                  }}
                  className={ds.btnSecondary}
                >
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                <button onClick={() => setShowDetailPanel(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <p className={ds.textMuted}>{d.description}</p>
              </div>

              {d.artifactType === 'Case' &&
                (() => {
                  const c = d as CaseData;
                  return (
                    <>
                      <div className={ds.grid2}>
                        {c.caseNumber && (
                          <div>
                            <span className={ds.label}>Case Number</span>
                            <p className="font-medium">{c.caseNumber}</p>
                          </div>
                        )}
                        {c.matterType && (
                          <div>
                            <span className={ds.label}>Matter Type</span>
                            <p className="font-medium">{formatLabel(c.matterType)}</p>
                          </div>
                        )}
                        {c.jurisdiction && (
                          <div>
                            <span className={ds.label}>Jurisdiction</span>
                            <p className="font-medium">{c.jurisdiction}</p>
                          </div>
                        )}
                        {c.court && (
                          <div>
                            <span className={ds.label}>Court/Venue</span>
                            <p className="font-medium">{c.court}</p>
                          </div>
                        )}
                        {c.judge && (
                          <div>
                            <span className={ds.label}>Judge</span>
                            <p className="font-medium">{c.judge}</p>
                          </div>
                        )}
                        {c.opposingCounsel && (
                          <div>
                            <span className={ds.label}>Opposing Counsel</span>
                            <p className="font-medium">{c.opposingCounsel}</p>
                          </div>
                        )}
                        {c.assignee && (
                          <div>
                            <span className={ds.label}>Assigned Attorney</span>
                            <p className="font-medium">{c.assignee}</p>
                          </div>
                        )}
                        {c.value != null && (
                          <div>
                            <span className={ds.label}>Value at Stake</span>
                            <p className="font-medium">{formatCurrency(c.value)}</p>
                          </div>
                        )}
                      </div>
                      {c.relatedParties && c.relatedParties.length > 0 && (
                        <div>
                          <span className={ds.label}>Related Parties</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.relatedParties.map((p, i) => (
                              <span key={i} className={ds.badge('neon-blue')}>
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {c.timeline && c.timeline.length > 0 && (
                        <div>
                          <span className={ds.label}>Timeline</span>
                          <div className="mt-2 space-y-2 border-l-2 border-lattice-border ml-2 pl-4">
                            {c.timeline.map((ev, i) => (
                              <div key={i} className="relative">
                                <div className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-neon-blue" />
                                <p className="text-xs text-gray-500">{ev.date}</p>
                                <p className="text-sm">{ev.event}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

              {d.artifactType === 'CalendarEvent' &&
                (() => {
                  const ev = d as CalendarEventData;
                  return (
                    <div className={ds.grid2}>
                      {ev.eventType && (
                        <div>
                          <span className={ds.label}>Event Type</span>
                          <p className="font-medium">{formatLabel(ev.eventType)}</p>
                        </div>
                      )}
                      {ev.eventDate && (
                        <div>
                          <span className={ds.label}>Date</span>
                          <p className="font-medium">
                            {ev.eventDate} {ev.eventTime && `at ${ev.eventTime}`}
                          </p>
                        </div>
                      )}
                      {ev.caseName && (
                        <div>
                          <span className={ds.label}>Matter</span>
                          <p className="font-medium">{ev.caseName}</p>
                        </div>
                      )}
                      {ev.location && (
                        <div>
                          <span className={ds.label}>Location</span>
                          <p className="font-medium">{ev.location}</p>
                        </div>
                      )}
                      {ev.ruleSet && (
                        <div>
                          <span className={ds.label}>Rule Set</span>
                          <p className="font-medium">{formatLabel(ev.ruleSet)}</p>
                        </div>
                      )}
                      {ev.eventDate && (
                        <div>
                          <span className={ds.label}>Days Until</span>
                          <p className="font-medium">{daysUntil(ev.eventDate)} days</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {d.artifactType === 'Contract' &&
                (() => {
                  const co = d as ContractData;
                  return (
                    <>
                      <div className={ds.grid2}>
                        {co.jurisdiction && (
                          <div>
                            <span className={ds.label}>Jurisdiction</span>
                            <p className="font-medium">{co.jurisdiction}</p>
                          </div>
                        )}
                        {co.value != null && (
                          <div>
                            <span className={ds.label}>Contract Value</span>
                            <p className="font-medium">{formatCurrency(co.value)}</p>
                          </div>
                        )}
                        {co.renewalDate && (
                          <div>
                            <span className={ds.label}>Renewal Date</span>
                            <p className="font-medium">{co.renewalDate}</p>
                          </div>
                        )}
                        {co.assignee && (
                          <div>
                            <span className={ds.label}>Assigned To</span>
                            <p className="font-medium">{co.assignee}</p>
                          </div>
                        )}
                      </div>
                      {co.parties && co.parties.length > 0 && (
                        <div>
                          <span className={ds.label}>Parties</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {co.parties.map((p, i) => (
                              <span key={i} className={ds.badge('neon-blue')}>
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {co.keyTerms && co.keyTerms.length > 0 && (
                        <div>
                          <span className={ds.label}>Key Terms</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {co.keyTerms.map((t, i) => (
                              <span key={i} className={ds.badge('neon-cyan')}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {co.obligations && co.obligations.length > 0 && (
                        <div>
                          <span className={ds.label}>Obligations</span>
                          <ul className="mt-1 space-y-1">
                            {co.obligations.map((o, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <CircleDot className="w-3 h-3 text-amber-400 mt-1 shrink-0" />
                                {o}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}

              {(d as CaseData).notes && (
                <div>
                  <span className={ds.label}>Notes</span>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap mt-1">
                    {(d as CaseData).notes}
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between p-4 border-t border-lattice-border">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>Type: {d.artifactType}</span>
                <span>ID: {detailItem.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    remove(detailItem.id);
                    setShowDetailPanel(false);
                  }}
                  className={ds.btnDanger}
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  /* ---------- render: editor modal ---------- */

  const renderEditorModal = () => {
    if (!showEditor) return null;
    const statuses = STATUSES_BY_TYPE[editorMode] ?? [];

    return (
      <>
        <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)} />
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-2xl')}>
            <div className="flex items-center justify-between p-4 border-b border-lattice-border">
              <h2 className={ds.heading2}>
                {editingItem ? 'Edit' : 'New'} {formatLabel(editorMode)}
              </h2>
              <button onClick={() => setShowEditor(false)} className={ds.btnGhost}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Common fields */}
              <div>
                <label className={ds.label}>Title</label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className={ds.input}
                  placeholder="Title"
                />
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Type</label>
                  <select
                    value={editorMode}
                    onChange={(e) => {
                      const newType = e.target.value as ArtifactType;
                      setEditorMode(newType);
                      setFormStatus(STATUSES_BY_TYPE[newType][0]);
                    }}
                    className={ds.select}
                  >
                    {MODE_TABS.filter((t) => t.id !== 'Dashboard').map((t) => (
                      <option key={t.defaultType} value={t.defaultType}>
                        {formatLabel(t.defaultType)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className={ds.select}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {formatLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Case-specific fields */}
              {editorMode === 'Case' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Matter Type</label>
                      <select
                        value={formMatterType}
                        onChange={(e) => setFormMatterType(e.target.value as MatterType)}
                        className={ds.select}
                      >
                        {MATTER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {formatLabel(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Case Number</label>
                      <input
                        value={formCaseNumber}
                        onChange={(e) => setFormCaseNumber(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. 2024-CV-01234"
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Jurisdiction</label>
                      <input
                        value={formJurisdiction}
                        onChange={(e) => setFormJurisdiction(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. US Federal, Delaware, SDNY"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Court / Venue</label>
                      <input
                        value={formCourt}
                        onChange={(e) => setFormCourt(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. Southern District of New York"
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Judge</label>
                      <input
                        value={formJudge}
                        onChange={(e) => setFormJudge(e.target.value)}
                        className={ds.input}
                        placeholder="Presiding judge"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Opposing Counsel</label>
                      <input
                        value={formOpposingCounsel}
                        onChange={(e) => setFormOpposingCounsel(e.target.value)}
                        className={ds.input}
                        placeholder="Opposing counsel / firm"
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Assigned Attorney</label>
                      <input
                        value={formAssignee}
                        onChange={(e) => setFormAssignee(e.target.value)}
                        className={ds.input}
                        placeholder="Lead attorney"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Value at Stake ($)</label>
                      <input
                        type="number"
                        value={formValue}
                        onChange={(e) => setFormValue(e.target.value)}
                        className={ds.input}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Due Date / Next Milestone</label>
                    <input
                      type="date"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                </>
              )}

              {/* Document-specific fields */}
              {editorMode === 'Document' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Document Type</label>
                      <select
                        value={formDocumentType}
                        onChange={(e) => setFormDocumentType(e.target.value as DocumentType)}
                        className={ds.select}
                      >
                        {DOCUMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {formatLabel(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Related Matter</label>
                      <input
                        value={formCaseName}
                        onChange={(e) => setFormCaseName(e.target.value)}
                        className={ds.input}
                        placeholder="Case or matter name"
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Version</label>
                      <input
                        type="number"
                        value={formVersion}
                        onChange={(e) => setFormVersion(e.target.value)}
                        className={ds.input}
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Filing Deadline</label>
                      <input
                        type="date"
                        value={formFilingDeadline}
                        onChange={(e) => setFormFilingDeadline(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Assigned To</label>
                    <input
                      value={formAssignee}
                      onChange={(e) => setFormAssignee(e.target.value)}
                      className={ds.input}
                      placeholder="Attorney / paralegal"
                    />
                  </div>
                </>
              )}

              {/* Time entry fields */}
              {editorMode === 'TimeEntry' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Matter</label>
                      <input
                        value={formCaseName}
                        onChange={(e) => setFormCaseName(e.target.value)}
                        className={ds.input}
                        placeholder="Assigned case or matter"
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
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Hours</label>
                      <input
                        type="number"
                        step="0.1"
                        value={formHours}
                        onChange={(e) => setFormHours(e.target.value)}
                        className={ds.input}
                        placeholder="0.0"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Hourly Rate ($)</label>
                      <input
                        type="number"
                        value={formRate}
                        onChange={(e) => setFormRate(e.target.value)}
                        className={ds.input}
                        placeholder="350"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className={ds.label}>Billable</label>
                    <button
                      type="button"
                      onClick={() => setFormBillable(!formBillable)}
                      className={cn(
                        'relative w-10 h-6 rounded-full transition-colors',
                        formBillable ? 'bg-neon-green' : 'bg-gray-600'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                          formBillable ? 'left-5' : 'left-1'
                        )}
                      />
                    </button>
                    <span className="text-sm text-gray-400">
                      {formBillable ? 'Billable' : 'Non-billable'}
                    </span>
                  </div>
                  <div>
                    <label className={ds.label}>Timekeeper</label>
                    <input
                      value={formAssignee}
                      onChange={(e) => setFormAssignee(e.target.value)}
                      className={ds.input}
                      placeholder="Attorney / staff"
                    />
                  </div>
                </>
              )}

              {/* Calendar event fields */}
              {editorMode === 'CalendarEvent' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Event Type</label>
                      <select
                        value={formEventType}
                        onChange={(e) => setFormEventType(e.target.value as CalendarType)}
                        className={ds.select}
                      >
                        {CALENDAR_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {formatLabel(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Rule Set</label>
                      <select
                        value={formRuleSet}
                        onChange={(e) => setFormRuleSet(e.target.value as RuleSet)}
                        className={ds.select}
                      >
                        {RULE_SETS.map((r) => (
                          <option key={r} value={r}>
                            {formatLabel(r)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Event Date</label>
                      <input
                        type="date"
                        value={formEventDate}
                        onChange={(e) => setFormEventDate(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Event Time</label>
                      <input
                        type="time"
                        value={formEventTime}
                        onChange={(e) => setFormEventTime(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Related Matter</label>
                      <input
                        value={formCaseName}
                        onChange={(e) => setFormCaseName(e.target.value)}
                        className={ds.input}
                        placeholder="Case or matter name"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Location</label>
                      <input
                        value={formLocation}
                        onChange={(e) => setFormLocation(e.target.value)}
                        className={ds.input}
                        placeholder="Courtroom, office, etc."
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Assigned To</label>
                    <input
                      value={formAssignee}
                      onChange={(e) => setFormAssignee(e.target.value)}
                      className={ds.input}
                      placeholder="Attending attorney"
                    />
                  </div>
                </>
              )}

              {/* Contact fields */}
              {editorMode === 'Contact' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Contact Type</label>
                      <select
                        value={formContactType}
                        onChange={(e) => setFormContactType(e.target.value as ContactType)}
                        className={ds.select}
                      >
                        {CONTACT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {formatLabel(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Organization</label>
                      <input
                        value={formOrganization}
                        onChange={(e) => setFormOrganization(e.target.value)}
                        className={ds.input}
                        placeholder="Firm, company, etc."
                      />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Email</label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        className={ds.input}
                        placeholder="email@example.com"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Phone</label>
                      <input
                        type="tel"
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                        className={ds.input}
                        placeholder="(555) 555-5555"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Address</label>
                    <input
                      value={formAddress}
                      onChange={(e) => setFormAddress(e.target.value)}
                      className={ds.input}
                      placeholder="Street address, city, state, zip"
                    />
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Related Matter</label>
                      <input
                        value={formCaseName}
                        onChange={(e) => setFormCaseName(e.target.value)}
                        className={ds.input}
                        placeholder="Case or matter"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Relationship to Case</label>
                      <input
                        value={formRelationship}
                        onChange={(e) => setFormRelationship(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. Plaintiff, Defendant"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className={ds.label}>Conflict Check Cleared</label>
                    <button
                      type="button"
                      onClick={() => setFormConflictCleared(!formConflictCleared)}
                      className={cn(
                        'relative w-10 h-6 rounded-full transition-colors',
                        formConflictCleared ? 'bg-neon-green' : 'bg-gray-600'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                          formConflictCleared ? 'left-5' : 'left-1'
                        )}
                      />
                    </button>
                    <span className="text-sm text-gray-400">
                      {formConflictCleared ? 'Cleared' : 'Not cleared'}
                    </span>
                  </div>
                </>
              )}

              {/* Contract fields */}
              {editorMode === 'Contract' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Jurisdiction</label>
                      <input
                        value={formJurisdiction}
                        onChange={(e) => setFormJurisdiction(e.target.value)}
                        className={ds.input}
                        placeholder="Governing law / jurisdiction"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Contract Value ($)</label>
                      <input
                        type="number"
                        value={formValue}
                        onChange={(e) => setFormValue(e.target.value)}
                        className={ds.input}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Parties (comma-separated)</label>
                    <input
                      value={formParties}
                      onChange={(e) => setFormParties(e.target.value)}
                      className={ds.input}
                      placeholder="Party A, Party B"
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Key Terms (comma-separated)</label>
                    <input
                      value={formKeyTerms}
                      onChange={(e) => setFormKeyTerms(e.target.value)}
                      className={ds.input}
                      placeholder="Indemnification, Non-compete, IP rights"
                    />
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Renewal Date</label>
                      <input
                        type="date"
                        value={formRenewalDate}
                        onChange={(e) => setFormRenewalDate(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Execution / Due Date</label>
                      <input
                        type="date"
                        value={formDueDate}
                        onChange={(e) => setFormDueDate(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Obligations (one per line)</label>
                    <textarea
                      value={formObligations}
                      onChange={(e) => setFormObligations(e.target.value)}
                      className={ds.textarea}
                      rows={3}
                      placeholder="Monthly reporting&#10;Annual audit&#10;Insurance maintenance"
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Assigned To</label>
                    <input
                      value={formAssignee}
                      onChange={(e) => setFormAssignee(e.target.value)}
                      className={ds.input}
                      placeholder="Attorney / team"
                    />
                  </div>
                </>
              )}

              {/* Compliance fields */}
              {editorMode === 'ComplianceItem' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Compliance Type</label>
                      <select
                        value={formComplianceType}
                        onChange={(e) => setFormComplianceType(e.target.value)}
                        className={ds.select}
                      >
                        {COMPLIANCE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {formatLabel(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Due Date</label>
                      <input
                        type="date"
                        value={formDueDate}
                        onChange={(e) => setFormDueDate(e.target.value)}
                        className={ds.input}
                      />
                    </div>
                  </div>
                  {formComplianceType === 'cle_credits' && (
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Credits Earned</label>
                        <input
                          type="number"
                          step="0.5"
                          value={formCredits}
                          onChange={(e) => setFormCredits(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Credits Required</label>
                        <input
                          type="number"
                          step="0.5"
                          value={formCreditsRequired}
                          onChange={(e) => setFormCreditsRequired(e.target.value)}
                          className={ds.input}
                          placeholder="24"
                        />
                      </div>
                    </div>
                  )}
                  {(formComplianceType === 'bar_admission' ||
                    formComplianceType === 'cle_credits') && (
                    <div>
                      <label className={ds.label}>Bar State</label>
                      <input
                        value={formBarState}
                        onChange={(e) => setFormBarState(e.target.value)}
                        className={ds.input}
                        placeholder="e.g. New York, California"
                      />
                    </div>
                  )}
                  {formComplianceType === 'trust_account' && (
                    <div>
                      <label className={ds.label}>Trust Account Balance ($)</label>
                      <input
                        type="number"
                        value={formTrustBalance}
                        onChange={(e) => setFormTrustBalance(e.target.value)}
                        className={ds.input}
                        placeholder="0"
                      />
                    </div>
                  )}
                  <div>
                    <label className={ds.label}>Assigned To</label>
                    <input
                      value={formAssignee}
                      onChange={(e) => setFormAssignee(e.target.value)}
                      className={ds.input}
                      placeholder="Attorney / admin"
                    />
                  </div>
                </>
              )}

              {/* Common bottom fields */}
              <div>
                <label className={ds.label}>Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className={ds.textarea}
                  rows={3}
                  placeholder="Describe the item..."
                />
              </div>
              <div>
                <label className={ds.label}>Notes</label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className={ds.textarea}
                  rows={2}
                  placeholder="Internal notes..."
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border-t border-lattice-border">
              <div>
                {editingItem && (
                  <button
                    onClick={() => {
                      remove(editingItem.id);
                      setShowEditor(false);
                    }}
                    className={ds.btnDanger}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowEditor(false)} className={ds.btnSecondary}>
                  Cancel
                </button>
                <button onClick={handleSave} className={ds.btnPrimary}>
                  {editingItem ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  /* ---------- render: content for active tab ---------- */

  const renderTabContent = () => {
    if (activeTab === 'Dashboard') return renderDashboard();

    return (
      <section className={ds.panel}>
        <div className={cn(ds.sectionHeader, 'mb-4')}>
          <h2 className={ds.heading2}>
            {MODE_TABS.find((t) => t.id === activeTab)?.label || activeTab}
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className={cn(ds.input, 'pl-9 w-56')}
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={cn(ds.select, 'w-44')}
            >
              <option value="all">All statuses</option>
              {currentStatuses.map((s) => (
                <option key={s} value={s}>
                  {formatLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Scale className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>
              No {(MODE_TABS.find((t) => t.id === activeTab)?.label || activeTab).toLowerCase()}{' '}
              found. Create one to get started.
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'Cases' && renderCaseCards()}
            {activeTab === 'Documents' && renderDocumentCards()}
            {activeTab === 'TimeBilling' && renderTimeBilling()}
            {activeTab === 'Calendar' && renderCalendar()}
            {activeTab === 'Contacts' && renderContacts()}
            {activeTab === 'Contracts' && renderContracts()}
            {activeTab === 'Compliance' && renderCompliance()}
          </>
        )}
      </section>
    );
  };

  /* ---------- main render ---------- */

  return (
    <div data-lens-theme="legal" className={ds.pageContainer}>
      {/* Legal Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          This tool assists with legal organization and practice management. It does not constitute
          legal advice. Always consult with qualified legal counsel for legal decisions.
        </p>
      </div>

      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Scale className="w-7 h-7 text-amber-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Legal Practice Management</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>
              Cases, documents, billing, calendar, contacts, contracts, and compliance
            </p>
          </div>
        </div>
        <button onClick={() => openNewEditor()} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New Item
        </button>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const cases = items.filter((i) => (i.data as Record<string, unknown>).caseNumber);
          const timeEntries = items.filter((i) => (i.data as Record<string, unknown>).hours);
          const totalHours = timeEntries.reduce(
            (s, i) => s + Number((i.data as Record<string, unknown>).hours || 0),
            0
          );
          const clients = new Set(
            items.map((i) => (i.data as Record<string, unknown>).client).filter(Boolean)
          );
          return [
            { label: 'Cases', value: cases.length || items.length, icon: Briefcase },
            { label: 'Billable Hours', value: totalHours.toFixed(1), icon: Timer },
            { label: 'Client Count', value: clients.size, icon: Users },
            {
              label: 'Active',
              value: items.filter((i) => i.meta?.status === 'active').length,
              icon: Scale,
            },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="legal" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel
        domain="legal"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />
      <DTUExportButton domain="legal" data={{}} compact />
      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setFilterStatus('all');
              setSearchQuery('');
            }}
            className={cn(
              ds.btnGhost,
              'whitespace-nowrap',
              activeTab === tab.id && 'bg-amber-400/20 text-amber-400'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Domain Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleAction('conflictCheck')} className={ds.btnSecondary}>
          <ShieldCheck className="w-4 h-4" /> Conflict Check
        </button>
        <button onClick={() => handleAction('deadlineCalculator')} className={ds.btnSecondary}>
          <Calculator className="w-4 h-4" /> Deadline Calculator
        </button>
        <button onClick={() => handleAction('generateInvoice')} className={ds.btnSecondary}>
          <Receipt className="w-4 h-4" /> Generate Invoice
        </button>
        <button onClick={() => handleAction('caseSummary')} className={ds.btnSecondary}>
          <BookOpen className="w-4 h-4" /> Case Summary
        </button>
        <button onClick={() => handleAction('complianceAudit')} className={ds.btnSecondary}>
          <ClipboardCheck className="w-4 h-4" /> Compliance Audit
        </button>
        {runAction.isPending && (
          <span className="text-xs text-neon-blue animate-pulse">Running action...</span>
        )}
      </div>

      {/* Action Result */}
      {actionResult && (
        <div className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-2')}>
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {/* deadlineCheck */}
            {actionResult.count !== undefined && Array.isArray(actionResult.upcoming) && (
              <div className="space-y-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-sm font-bold ${Number(actionResult.count) > 0 ? 'text-amber-400' : 'text-green-400'}`}
                  >
                    {String(actionResult.count)}
                  </p>
                  <p className="text-[10px] text-gray-500">Upcoming Deadlines</p>
                </div>
                {(
                  actionResult.upcoming as {
                    title?: string;
                    name?: string;
                    daysUntil: number;
                    deadline: string;
                  }[]
                )
                  .slice(0, 5)
                  .map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 bg-lattice-surface rounded"
                    >
                      <span className="text-xs text-gray-300">{item.title || item.name}</span>
                      <span
                        className={`text-xs font-semibold ${item.daysUntil <= 7 ? 'text-red-400' : item.daysUntil <= 14 ? 'text-amber-400' : 'text-neon-cyan'}`}
                      >
                        {item.daysUntil}d
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {/* contractRenewal */}
            {actionResult.daysUntilExpiry !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.daysUntilExpiry) <= 14 ? 'text-red-400' : Number(actionResult.daysUntilExpiry) <= 30 ? 'text-amber-400' : 'text-neon-cyan'}`}
                    >
                      {String(actionResult.daysUntilExpiry)}d
                    </p>
                    <p className="text-[10px] text-gray-500">Until Expiry</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold capitalize ${actionResult.urgency === 'critical' ? 'text-red-400' : actionResult.urgency === 'high' ? 'text-orange-400' : actionResult.urgency === 'medium' ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.urgency)}
                    </p>
                    <p className="text-[10px] text-gray-500">Urgency</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${actionResult.autoRenewal ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}
                  >
                    {actionResult.autoRenewal ? 'Auto-Renews' : 'Manual Renewal'}
                  </span>
                  {!!actionResult.actionRequired && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-400">
                      Action Required
                    </span>
                  )}
                </div>
              </div>
            )}
            {/* conflictCheck */}
            {actionResult.hasConflict !== undefined && (
              <div className="space-y-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-sm font-bold ${actionResult.hasConflict ? 'text-red-400' : 'text-green-400'}`}
                  >
                    {actionResult.hasConflict ? 'Conflict Found' : 'No Conflicts'}
                  </p>
                  <p className="text-[10px] text-gray-500">Conflict Check</p>
                </div>
                {Array.isArray(actionResult.conflicts) &&
                  (actionResult.conflicts as { name: string; conflictType: string }[]).map(
                    (c, i) => (
                      <div key={i} className="p-2 bg-red-500/10 rounded">
                        <p className="text-xs text-white">{c.name}</p>
                        <p className="text-[10px] text-red-400">
                          {c.conflictType.replace(/_/g, ' ')}
                        </p>
                      </div>
                    )
                  )}
              </div>
            )}
            {/* complianceScore */}
            {actionResult.score !== undefined && actionResult.total !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.score) >= 90 ? 'text-green-400' : Number(actionResult.score) >= 70 ? 'text-amber-400' : 'text-red-400'}`}
                    >
                      {String(actionResult.score)}%
                    </p>
                    <p className="text-[10px] text-gray-500">Score</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-green-400">
                      {String(actionResult.compliant)}
                    </p>
                    <p className="text-[10px] text-gray-500">Compliant</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.overdue) > 0 ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.overdue)}
                    </p>
                    <p className="text-[10px] text-gray-500">Overdue</p>
                  </div>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${Number(actionResult.score) >= 90 ? 'bg-green-400' : Number(actionResult.score) >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(100, Number(actionResult.score))}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'TimeBilling' && !isLoading && filtered.length > 0
        ? renderTimeBilling()
        : renderTabContent()}

      {/* Editor Modal */}
      {renderEditorModal()}

      {/* Detail Panel */}
      {renderDetailPanel()}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="legal" />
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
            <LensFeaturePanel lensId="legal" />
          </div>
        )}
      </div>
    </div>
  );
}
