'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Building2,
  Home,
  Eye,
  ArrowLeftRight,
  KeyRound,
  TrendingUp,
  Plus,
  Search,
  X,
  Trash2,
  MapPin,
  DollarSign,
  Calendar,
  User,
  Bed,
  Bath,
  Ruler,
  ArrowUpRight,
  Calculator,
  BarChart3,
  Wrench,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Star,
  Phone,
  FileText,
  ChevronRight,
  ChevronDown,
  Percent,
  PiggyBank,
  Receipt,
  Hash,
  LandPlot,
  Hammer,
  CircleDot,
  Minus,
  Bell,
  Layers,
  Map,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab =
  | 'Dashboard'
  | 'Listings'
  | 'Transactions'
  | 'CMA'
  | 'Rentals'
  | 'Investing'
  | 'Showings'
  | 'Map';
type ArtifactType = 'Listing' | 'Transaction' | 'CMA' | 'RentalUnit' | 'Deal' | 'Showing';

type ListingStatus =
  | 'coming_soon'
  | 'active'
  | 'pending'
  | 'contingent'
  | 'sold'
  | 'withdrawn'
  | 'expired';
type TransactionStatus =
  | 'listing_prep'
  | 'offer'
  | 'under_contract'
  | 'inspection'
  | 'appraisal'
  | 'clear_to_close'
  | 'closed'
  | 'fell_through';
type ShowingStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
type RentalStatus =
  | 'vacant'
  | 'listed'
  | 'application'
  | 'leased'
  | 'month_to_month'
  | 'notice_given'
  | 'eviction';
type DealStatus =
  | 'prospecting'
  | 'analysis'
  | 'due_diligence'
  | 'under_contract'
  | 'closed'
  | 'passed';
type CMAStatus = 'draft' | 'in_progress' | 'completed' | 'presented';
type AnyStatus =
  | ListingStatus
  | TransactionStatus
  | ShowingStatus
  | RentalStatus
  | DealStatus
  | CMAStatus
  | string;

interface PriceHistory {
  date: string;
  price: number;
  reason: string;
}
interface OpenHouse {
  date: string;
  startTime: string;
  endTime: string;
  agent: string;
}
interface Contingency {
  name: string;
  deadline: string;
  status: 'pending' | 'met' | 'waived' | 'failed';
}
interface DocChecklist {
  name: string;
  completed: boolean;
  dueDate?: string;
}
interface Comparable {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  condition: string;
  adjustments: number;
  adjustedPrice: number;
}
interface MaintenanceRequest {
  id: string;
  unit: string;
  issue: string;
  priority: 'low' | 'medium' | 'high' | 'emergency';
  status: 'open' | 'in_progress' | 'completed';
  date: string;
}
interface ShowingFeedback {
  buyerName: string;
  interestLevel: number;
  feedback: string;
  followUpDate?: string;
}

interface RealEstateArtifact {
  artifactType: ArtifactType;
  status: AnyStatus;
  description: string;
  address?: string;
  price?: number;
  lat?: number;
  lng?: number;
  agent?: string;
  client?: string;
  clientPhone?: string;
  clientEmail?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: number;
  yearBuilt?: number;
  date?: string;
  roi?: number;
  notes?: string;
  mlsNumber?: string;
  listingAgent?: string;
  daysOnMarket?: number;
  priceHistory?: PriceHistory[];
  openHouses?: OpenHouse[];
  // Transaction fields
  pipelineStage?: string;
  closingDate?: string;
  escrowCompany?: string;
  lenderName?: string;
  contingencies?: Contingency[];
  docChecklist?: DocChecklist[];
  earnestMoney?: number;
  commission?: number;
  // CMA fields
  subjectProperty?: string;
  comparables?: Comparable[];
  suggestedPrice?: number;
  pricePerSqft?: number;
  // Rental fields
  tenantName?: string;
  tenantPhone?: string;
  leaseStart?: string;
  leaseEnd?: string;
  monthlyRent?: number;
  securityDeposit?: number;
  rentStatus?: 'current' | 'late' | 'delinquent' | 'paid';
  maintenanceRequests?: MaintenanceRequest[];
  // Investment fields
  purchasePrice?: number;
  grossRent?: number;
  operatingExpenses?: number;
  noi?: number;
  capRate?: number;
  cashOnCash?: number;
  grm?: number;
  mortgageRate?: number;
  mortgageTerm?: number;
  downPayment?: number;
  taxesAnnual?: number;
  insuranceAnnual?: number;
  // Showing fields
  showingDate?: string;
  showingTime?: string;
  buyerAgent?: string;
  feedbacks?: ShowingFeedback[];
  interestLevel?: number;
  followUpDate?: string;
  [key: string]: unknown;
}

const MODE_TABS: { id: ModeTab; icon: React.ElementType; defaultType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Listings', icon: Home, defaultType: 'Listing' },
  { id: 'Transactions', icon: ArrowLeftRight, defaultType: 'Transaction' },
  { id: 'CMA', icon: Calculator, defaultType: 'CMA' },
  { id: 'Rentals', icon: KeyRound, defaultType: 'RentalUnit' },
  { id: 'Investing', icon: TrendingUp, defaultType: 'Deal' },
  { id: 'Showings', icon: Eye, defaultType: 'Showing' },
  { id: 'Map', icon: Map },
];

const STATUSES_BY_TYPE: Record<ArtifactType, string[]> = {
  Listing: ['coming_soon', 'active', 'pending', 'contingent', 'sold', 'withdrawn', 'expired'],
  Transaction: [
    'listing_prep',
    'offer',
    'under_contract',
    'inspection',
    'appraisal',
    'clear_to_close',
    'closed',
    'fell_through',
  ],
  CMA: ['draft', 'in_progress', 'completed', 'presented'],
  RentalUnit: [
    'vacant',
    'listed',
    'application',
    'leased',
    'month_to_month',
    'notice_given',
    'eviction',
  ],
  Deal: ['prospecting', 'analysis', 'due_diligence', 'under_contract', 'closed', 'passed'],
  Showing: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'],
};

const STATUS_COLORS: Record<string, string> = {
  coming_soon: 'neon-blue',
  active: 'neon-green',
  pending: 'amber-400',
  contingent: 'neon-purple',
  sold: 'neon-cyan',
  withdrawn: 'gray-400',
  expired: 'red-400',
  listing_prep: 'gray-400',
  offer: 'neon-blue',
  under_contract: 'neon-purple',
  inspection: 'amber-400',
  appraisal: 'neon-cyan',
  clear_to_close: 'neon-green',
  closed: 'neon-green',
  fell_through: 'red-400',
  draft: 'gray-400',
  in_progress: 'neon-blue',
  completed: 'neon-green',
  presented: 'neon-cyan',
  scheduled: 'neon-blue',
  confirmed: 'neon-green',
  cancelled: 'red-400',
  no_show: 'gray-400',
  vacant: 'red-400',
  listed: 'neon-blue',
  application: 'amber-400',
  leased: 'neon-green',
  month_to_month: 'neon-cyan',
  notice_given: 'amber-400',
  eviction: 'red-400',
  prospecting: 'gray-400',
  analysis: 'neon-blue',
  due_diligence: 'amber-400',
  passed: 'gray-400',
};

const TRANSACTION_PIPELINE: string[] = [
  'listing_prep',
  'offer',
  'under_contract',
  'inspection',
  'appraisal',
  'clear_to_close',
  'closed',
];

const DOMAIN_ACTIONS = [
  {
    id: 'cap_rate_calc',
    label: 'Cap Rate Calc',
    icon: Percent,
    description: 'Calculate capitalization rate',
  },
  {
    id: 'cash_flow_analysis',
    label: 'Cash Flow Analysis',
    icon: PiggyBank,
    description: 'Analyze monthly/annual cash flow',
  },
  {
    id: 'cma_generate',
    label: 'CMA Generate',
    icon: Calculator,
    description: 'Generate comparative market analysis',
  },
  {
    id: 'closing_timeline',
    label: 'Closing Timeline',
    icon: Clock,
    description: 'Generate closing timeline',
  },
  {
    id: 'vacancy_report',
    label: 'Vacancy Report',
    icon: Building2,
    description: 'Generate vacancy & occupancy report',
  },
];

const seedItems: { title: string; data: RealEstateArtifact }[] = [];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmt = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
};

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

const pct = (v: number) => `${v.toFixed(2)}%`;

const daysBetween = (a: string, b: string) => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RealEstateLensPage() {
  useLensNav('realestate');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('realestate');

  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<RealEstateArtifact> | null>(null);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [selectedActionItem, setSelectedActionItem] = useState<string | null>(null);
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [showInvestCalc, setShowInvestCalc] = useState(false);

  // Investment calculator local state
  const [calcPurchase, setCalcPurchase] = useState('300000');
  const [calcDown, setCalcDown] = useState('60000');
  const [calcRate, setCalcRate] = useState('6.5');
  const [calcTerm, setCalcTerm] = useState('30');
  const [calcRent, setCalcRent] = useState('2500');
  const [calcExpenses, setCalcExpenses] = useState('800');
  const [calcTaxes, setCalcTaxes] = useState('3600');
  const [calcInsurance, setCalcInsurance] = useState('1200');

  // Editor form state
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<ArtifactType>('Listing');
  const [formStatus, setFormStatus] = useState<string>('active');
  const [formDesc, setFormDesc] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formAgent, setFormAgent] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formClientPhone, setFormClientPhone] = useState('');
  const [formClientEmail, setFormClientEmail] = useState('');
  const [formPropType, setFormPropType] = useState('');
  const [formBeds, setFormBeds] = useState('');
  const [formBaths, setFormBaths] = useState('');
  const [formSqft, setFormSqft] = useState('');
  const [formLotSize, setFormLotSize] = useState('');
  const [formYearBuilt, setFormYearBuilt] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formMls, setFormMls] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formRoi, setFormRoi] = useState('');
  // Transaction extras
  const [formClosingDate, setFormClosingDate] = useState('');
  const [formEscrow, setFormEscrow] = useState('');
  const [formLender, setFormLender] = useState('');
  const [formEarnest, setFormEarnest] = useState('');
  const [formCommission, setFormCommission] = useState('');
  // Rental extras
  const [formTenant, setFormTenant] = useState('');
  const [formTenantPhone, setFormTenantPhone] = useState('');
  const [formLeaseStart, setFormLeaseStart] = useState('');
  const [formLeaseEnd, setFormLeaseEnd] = useState('');
  const [formRent, setFormRent] = useState('');
  const [formDeposit, setFormDeposit] = useState('');
  const [formRentStatus, setFormRentStatus] = useState('current');
  // Showing extras
  const [formShowDate, setFormShowDate] = useState('');
  const [formShowTime, setFormShowTime] = useState('');
  const [formBuyerAgent, setFormBuyerAgent] = useState('');
  const [formInterest, setFormInterest] = useState('3');
  const [formFollowUp, setFormFollowUp] = useState('');
  // Investment extras
  const [formPurchasePrice, setFormPurchasePrice] = useState('');
  const [formGrossRent, setFormGrossRent] = useState('');
  const [formOpEx, setFormOpEx] = useState('');
  const [formMortRate, setFormMortRate] = useState('');
  const [formMortTerm, setFormMortTerm] = useState('');
  const [formDownPay, setFormDownPay] = useState('');
  const [formTaxes, setFormTaxes] = useState('');
  const [formInsurance, setFormInsurance] = useState('');

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<RealEstateArtifact>('realestate', 'artifact', {
      seed: seedItems.map((s) => ({
        title: s.title,
        data: s.data as unknown as Record<string, unknown>,
        meta: { status: s.data.status, tags: [s.data.artifactType] },
      })),
    });

  const runAction = useRunArtifact('realestate');

  /* ---------- derived ---------- */

  const currentTabType = MODE_TABS.find((t) => t.id === activeTab)?.defaultType;
  const currentStatuses = currentTabType ? (STATUSES_BY_TYPE[currentTabType] ?? []) : [];

  const filtered = useMemo(() => {
    if (!currentTabType) return items;
    let list = items.filter(
      (i) => (i.data as unknown as RealEstateArtifact).artifactType === currentTabType
    );
    if (filterStatus !== 'all')
      list = list.filter((i) => (i.data as unknown as RealEstateArtifact).status === filterStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as RealEstateArtifact).description?.toLowerCase().includes(q) ||
          (i.data as unknown as RealEstateArtifact).address?.toLowerCase().includes(q) ||
          (i.data as unknown as RealEstateArtifact).mlsNumber?.toLowerCase().includes(q) ||
          (i.data as unknown as RealEstateArtifact).tenantName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, currentTabType, filterStatus, searchQuery]);

  const stats = useMemo(() => {
    const d = (t: ArtifactType) =>
      items.filter((i) => (i.data as unknown as RealEstateArtifact).artifactType === t);
    const listings = d('Listing');
    const active = listings.filter(
      (i) => (i.data as unknown as RealEstateArtifact).status === 'active'
    );
    const pending = listings.filter(
      (i) => (i.data as unknown as RealEstateArtifact).status === 'pending'
    );
    const sold = listings.filter(
      (i) => (i.data as unknown as RealEstateArtifact).status === 'sold'
    );
    const txns = d('Transaction');
    const closedTxns = txns.filter(
      (i) => (i.data as unknown as RealEstateArtifact).status === 'closed'
    );
    const pendingTxns = txns.filter(
      (i) => !['closed', 'fell_through'].includes((i.data as unknown as RealEstateArtifact).status)
    );
    const rentals = d('RentalUnit');
    const occupied = rentals.filter((i) =>
      ['leased', 'month_to_month'].includes((i.data as unknown as RealEstateArtifact).status)
    );
    const vacant = rentals.filter(
      (i) => (i.data as unknown as RealEstateArtifact).status === 'vacant'
    );
    const totalListVal = active.reduce(
      (s, i) => s + ((i.data as unknown as RealEstateArtifact).price || 0),
      0
    );
    const closedVol = closedTxns.reduce(
      (s, i) => s + ((i.data as unknown as RealEstateArtifact).price || 0),
      0
    );
    const totalRent = occupied.reduce(
      (s, i) => s + ((i.data as unknown as RealEstateArtifact).monthlyRent || 0),
      0
    );
    const avgDom =
      active.length > 0
        ? Math.round(
            active.reduce(
              (s, i) => s + ((i.data as unknown as RealEstateArtifact).daysOnMarket || 0),
              0
            ) / active.length
          )
        : 0;
    const vacancyRate = rentals.length > 0 ? (vacant.length / rentals.length) * 100 : 0;
    const portfolioVal = rentals.reduce(
      (s, i) =>
        s +
        ((i.data as unknown as RealEstateArtifact).price ||
          (i.data as unknown as RealEstateArtifact).purchasePrice ||
          0),
      0
    );
    const deals = d('Deal');
    const showings = d('Showing');
    return {
      activeListings: active.length,
      pendingSales: pending.length,
      soldCount: sold.length,
      totalListVal,
      closedVol,
      closedCount: closedTxns.length,
      pendingTxns: pendingTxns.length,
      totalRent,
      occupiedCount: occupied.length,
      vacantCount: vacant.length,
      vacancyRate,
      avgDom,
      portfolioVal,
      totalRentals: rentals.length,
      dealCount: deals.length,
      showingCount: showings.length,
      closingsThisMonth: closedTxns.length,
    };
  }, [items]);

  /* ---------- investment calculator ---------- */

  const investCalc = useMemo(() => {
    const purchase = parseFloat(calcPurchase) || 0;
    const down = parseFloat(calcDown) || 0;
    const rate = (parseFloat(calcRate) || 0) / 100 / 12;
    const term = (parseFloat(calcTerm) || 30) * 12;
    const rent = parseFloat(calcRent) || 0;
    const expenses = parseFloat(calcExpenses) || 0;
    const taxes = (parseFloat(calcTaxes) || 0) / 12;
    const insurance = (parseFloat(calcInsurance) || 0) / 12;
    const loan = purchase - down;
    const monthlyPI =
      rate > 0
        ? (loan * (rate * Math.pow(1 + rate, term))) / (Math.pow(1 + rate, term) - 1)
        : loan / term;
    const totalMonthly = monthlyPI + taxes + insurance;
    const annualRent = rent * 12;
    const annualExpenses = expenses * 12;
    const annualDebtService = totalMonthly * 12;
    const noi = annualRent - annualExpenses;
    const cashFlow = noi - annualDebtService;
    const capRate = purchase > 0 ? (noi / purchase) * 100 : 0;
    const cashOnCash = down > 0 ? (cashFlow / down) * 100 : 0;
    const grm = rent > 0 ? purchase / annualRent : 0;
    return {
      loan,
      monthlyPI,
      totalMonthly,
      annualRent,
      annualExpenses,
      annualDebtService,
      noi,
      cashFlow,
      capRate,
      cashOnCash,
      grm,
    };
  }, [
    calcPurchase,
    calcDown,
    calcRate,
    calcTerm,
    calcRent,
    calcExpenses,
    calcTaxes,
    calcInsurance,
  ]);

  /* ---------- editor helpers ---------- */

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormDesc('');
    setFormAddress('');
    setFormPrice('');
    setFormAgent('');
    setFormClient('');
    setFormClientPhone('');
    setFormClientEmail('');
    setFormPropType('');
    setFormBeds('');
    setFormBaths('');
    setFormSqft('');
    setFormLotSize('');
    setFormYearBuilt('');
    setFormDate('');
    setFormMls('');
    setFormNotes('');
    setFormRoi('');
    setFormClosingDate('');
    setFormEscrow('');
    setFormLender('');
    setFormEarnest('');
    setFormCommission('');
    setFormTenant('');
    setFormTenantPhone('');
    setFormLeaseStart('');
    setFormLeaseEnd('');
    setFormRent('');
    setFormDeposit('');
    setFormRentStatus('current');
    setFormShowDate('');
    setFormShowTime('');
    setFormBuyerAgent('');
    setFormInterest('3');
    setFormFollowUp('');
    setFormPurchasePrice('');
    setFormGrossRent('');
    setFormOpEx('');
    setFormMortRate('');
    setFormMortTerm('');
    setFormDownPay('');
    setFormTaxes('');
    setFormInsurance('');
  }, []);

  const openNewEditor = () => {
    setEditingItem(null);
    resetForm();
    const t = currentTabType || 'Listing';
    setFormType(t);
    setFormStatus(STATUSES_BY_TYPE[t][0]);
    setShowEditor(true);
  };

  const openEditEditor = (item: LensItem<RealEstateArtifact>) => {
    const d = item.data as unknown as RealEstateArtifact;
    setEditingItem(item);
    setFormTitle(item.title);
    setFormType(d.artifactType);
    setFormStatus(d.status);
    setFormDesc(d.description || '');
    setFormAddress(d.address || '');
    setFormPrice(d.price != null ? String(d.price) : '');
    setFormAgent(d.agent || '');
    setFormClient(d.client || '');
    setFormClientPhone(d.clientPhone || '');
    setFormClientEmail(d.clientEmail || '');
    setFormPropType(d.propertyType || '');
    setFormBeds(d.bedrooms != null ? String(d.bedrooms) : '');
    setFormBaths(d.bathrooms != null ? String(d.bathrooms) : '');
    setFormSqft(d.sqft != null ? String(d.sqft) : '');
    setFormLotSize(d.lotSize != null ? String(d.lotSize) : '');
    setFormYearBuilt(d.yearBuilt != null ? String(d.yearBuilt) : '');
    setFormDate(d.date || '');
    setFormMls(d.mlsNumber || '');
    setFormNotes(d.notes || '');
    setFormRoi(d.roi != null ? String(d.roi) : '');
    setFormClosingDate(d.closingDate || '');
    setFormEscrow(d.escrowCompany || '');
    setFormLender(d.lenderName || '');
    setFormEarnest(d.earnestMoney != null ? String(d.earnestMoney) : '');
    setFormCommission(d.commission != null ? String(d.commission) : '');
    setFormTenant(d.tenantName || '');
    setFormTenantPhone(d.tenantPhone || '');
    setFormLeaseStart(d.leaseStart || '');
    setFormLeaseEnd(d.leaseEnd || '');
    setFormRent(d.monthlyRent != null ? String(d.monthlyRent) : '');
    setFormDeposit(d.securityDeposit != null ? String(d.securityDeposit) : '');
    setFormRentStatus(d.rentStatus || 'current');
    setFormShowDate(d.showingDate || '');
    setFormShowTime(d.showingTime || '');
    setFormBuyerAgent(d.buyerAgent || '');
    setFormInterest(d.interestLevel != null ? String(d.interestLevel) : '3');
    setFormFollowUp(d.followUpDate || '');
    setFormPurchasePrice(d.purchasePrice != null ? String(d.purchasePrice) : '');
    setFormGrossRent(d.grossRent != null ? String(d.grossRent) : '');
    setFormOpEx(d.operatingExpenses != null ? String(d.operatingExpenses) : '');
    setFormMortRate(d.mortgageRate != null ? String(d.mortgageRate) : '');
    setFormMortTerm(d.mortgageTerm != null ? String(d.mortgageTerm) : '');
    setFormDownPay(d.downPayment != null ? String(d.downPayment) : '');
    setFormTaxes(d.taxesAnnual != null ? String(d.taxesAnnual) : '');
    setFormInsurance(d.insuranceAnnual != null ? String(d.insuranceAnnual) : '');
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = {
      title: formTitle,
      data: {
        artifactType: formType,
        status: formStatus,
        description: formDesc,
        address: formAddress,
        price: formPrice ? parseFloat(formPrice) : undefined,
        agent: formAgent,
        client: formClient,
        clientPhone: formClientPhone,
        clientEmail: formClientEmail,
        propertyType: formPropType,
        bedrooms: formBeds ? parseInt(formBeds) : undefined,
        bathrooms: formBaths ? parseFloat(formBaths) : undefined,
        sqft: formSqft ? parseInt(formSqft) : undefined,
        lotSize: formLotSize ? parseFloat(formLotSize) : undefined,
        yearBuilt: formYearBuilt ? parseInt(formYearBuilt) : undefined,
        date: formDate,
        mlsNumber: formMls,
        notes: formNotes,
        roi: formRoi ? parseFloat(formRoi) : undefined,
        closingDate: formClosingDate,
        escrowCompany: formEscrow,
        lenderName: formLender,
        earnestMoney: formEarnest ? parseFloat(formEarnest) : undefined,
        commission: formCommission ? parseFloat(formCommission) : undefined,
        tenantName: formTenant,
        tenantPhone: formTenantPhone,
        leaseStart: formLeaseStart,
        leaseEnd: formLeaseEnd,
        monthlyRent: formRent ? parseFloat(formRent) : undefined,
        securityDeposit: formDeposit ? parseFloat(formDeposit) : undefined,
        rentStatus: formRentStatus,
        showingDate: formShowDate,
        showingTime: formShowTime,
        buyerAgent: formBuyerAgent,
        interestLevel: formInterest ? parseInt(formInterest) : undefined,
        followUpDate: formFollowUp,
        purchasePrice: formPurchasePrice ? parseFloat(formPurchasePrice) : undefined,
        grossRent: formGrossRent ? parseFloat(formGrossRent) : undefined,
        operatingExpenses: formOpEx ? parseFloat(formOpEx) : undefined,
        mortgageRate: formMortRate ? parseFloat(formMortRate) : undefined,
        mortgageTerm: formMortTerm ? parseInt(formMortTerm) : undefined,
        downPayment: formDownPay ? parseFloat(formDownPay) : undefined,
        taxesAnnual: formTaxes ? parseFloat(formTaxes) : undefined,
        insuranceAnnual: formInsurance ? parseFloat(formInsurance) : undefined,
      } as unknown as Partial<RealEstateArtifact>,
      meta: { status: formStatus, tags: [formType] },
    };
    if (editingItem) await update(editingItem.id, payload);
    else await create(payload);
    setShowEditor(false);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || selectedActionItem || editingItem?.id || filtered[0]?.id;
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
      showToast('error', 'Action failed');
    }
  };

  /* ---------- render helpers ---------- */

  const renderStarRating = (level: number) => {
    return (
      <div data-lens-theme="realestate" className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={cn(
              'w-3 h-3',
              s <= level ? 'text-amber-400 fill-amber-400' : 'text-gray-600'
            )}
          />
        ))}
      </div>
    );
  };

  const renderPipelineStage = (current: string) => {
    const idx = TRANSACTION_PIPELINE.indexOf(current);
    return (
      <div className="flex items-center gap-1 flex-wrap py-2">
        {TRANSACTION_PIPELINE.map((stage, i) => {
          const isActive = i === idx;
          const isDone = i < idx;
          const color = isDone
            ? 'bg-neon-green/20 text-neon-green border-neon-green/50'
            : isActive
              ? 'bg-neon-blue/20 text-neon-blue border-neon-blue/50'
              : 'bg-lattice-surface text-gray-500 border-lattice-border';
          return (
            <div key={stage} className="flex items-center gap-1">
              <div
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium border whitespace-nowrap',
                  color
                )}
              >
                {isDone && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                {isActive && <CircleDot className="w-3 h-3 inline mr-1" />}
                {stage.replace(/_/g, ' ')}
              </div>
              {i < TRANSACTION_PIPELINE.length - 1 && (
                <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /* ---------- render ---------- */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading property listings...</p>
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
          <Building2 className="w-7 h-7 text-neon-cyan" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Real Estate</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>
              Listings, transactions, CMA, rentals, showings & investments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowActionPanel(!showActionPanel)} className={ds.btnSecondary}>
            <Hammer className="w-4 h-4" /> Actions
          </button>
          <button onClick={() => setShowInvestCalc(!showInvestCalc)} className={ds.btnSecondary}>
            <Calculator className="w-4 h-4" /> Calculator
          </button>
          {activeTab !== 'Dashboard' && (
            <button onClick={openNewEditor} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> New Record
            </button>
          )}
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const listings = items.filter((i) => (i.data as Record<string, unknown>).price);
          const avgPrice =
            listings.length > 0
              ? Math.round(
                  listings.reduce(
                    (s, i) => s + Number((i.data as Record<string, unknown>).price || 0),
                    0
                  ) / listings.length
                )
              : 0;
          const pending = items.filter(
            (i) =>
              i.meta?.status === 'pending' ||
              (i.data as Record<string, unknown>).status === 'pending'
          ).length;
          return [
            { label: 'Listings', value: items.length, icon: Building2 },
            { label: 'Avg Price', value: `$${(avgPrice / 1000).toFixed(0)}K`, icon: DollarSign },
            { label: 'Pending Offers', value: pending, icon: KeyRound },
            {
              label: 'Active',
              value: items.filter((i) => (i.data as Record<string, unknown>).status === 'active')
                .length,
              icon: TrendingUp,
            },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-neon-cyan shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="realestate" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel
        domain="realestate"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />
      <DTUExportButton domain="realestate" data={{}} compact />
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
              activeTab === tab.id && 'bg-neon-cyan/20 text-neon-cyan'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.id}
          </button>
        ))}
      </nav>

      {/* Domain Actions Panel */}
      {showActionPanel && (
        <div className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-3')}>
            <h2 className={ds.heading3}>Domain Actions</h2>
            <button onClick={() => setShowActionPanel(false)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className={ds.grid3}>
            {DOMAIN_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                className={cn(ds.panelHover, 'text-left')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <action.icon className="w-4 h-4 text-neon-cyan" />
                  <span className="font-medium text-white text-sm">{action.label}</span>
                </div>
                <p className={cn(ds.textMuted, 'text-xs')}>{action.description}</p>
              </button>
            ))}
          </div>
          {runAction.isPending && (
            <p className="text-xs text-neon-blue animate-pulse mt-2">Running action...</p>
          )}
          {actionResult && (
            <div className={cn(ds.panel, 'mt-3')}>
              <div className={cn(ds.sectionHeader, 'mb-2')}>
                <h3 className={ds.heading3}>Action Result</h3>
                <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                {/* capRate */}
                {actionResult.capRate !== undefined && actionResult.noi !== undefined && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p
                          className={`text-sm font-bold ${Number(actionResult.capRate) >= 8 ? 'text-green-400' : Number(actionResult.capRate) >= 6 ? 'text-amber-400' : 'text-red-400'}`}
                        >
                          {String(actionResult.capRate)}%
                        </p>
                        <p className="text-[10px] text-gray-500">Cap Rate</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          ${Number(actionResult.noi).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500">NOI</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan capitalize">
                          {String(actionResult.rating)}
                        </p>
                        <p className="text-[10px] text-gray-500">Rating</p>
                      </div>
                    </div>
                  </div>
                )}
                {/* cashFlow */}
                {actionResult.monthly !== undefined && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p
                          className={`text-sm font-bold ${Number((actionResult.monthly as { cashFlow: number }).cashFlow) >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        >
                          $
                          {Number(
                            (actionResult.monthly as { cashFlow: number }).cashFlow
                          ).toLocaleString()}
                          /mo
                        </p>
                        <p className="text-[10px] text-gray-500">Monthly Cash Flow</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p
                          className={`text-sm font-bold ${Number((actionResult.annual as { cashFlow: number }).cashFlow) >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        >
                          $
                          {Number(
                            (actionResult.annual as { cashFlow: number }).cashFlow
                          ).toLocaleString()}
                          /yr
                        </p>
                        <p className="text-[10px] text-gray-500">Annual Cash Flow</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          $
                          {Number(
                            (actionResult.monthly as { grossRent: number }).grossRent
                          ).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500">Gross Rent</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-amber-400">
                          $
                          {Number(
                            (actionResult.monthly as { expenses: number }).expenses
                          ).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500">Expenses</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-amber-400">
                          $
                          {Number(
                            (actionResult.monthly as { mortgage: number }).mortgage
                          ).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500">Mortgage</p>
                      </div>
                    </div>
                  </div>
                )}
                {/* closingTimeline */}
                {actionResult.timeline !== undefined && Array.isArray(actionResult.timeline) && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-400">
                      {String(actionResult.totalDays)}-day closing timeline
                    </p>
                    {(
                      actionResult.timeline as { milestone: string; date: string; status: string }[]
                    ).map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs px-2 py-1 bg-lattice-surface rounded"
                      >
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${m.status === 'completed' ? 'bg-green-400' : 'bg-gray-500'}`}
                        />
                        <span className="text-gray-300 flex-1">{m.milestone}</span>
                        <span className="text-gray-500">{m.date}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* vacancyRate */}
                {actionResult.vacancyRate !== undefined && actionResult.total !== undefined && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p
                          className={`text-sm font-bold ${Number(actionResult.vacancyRate) > 10 ? 'text-red-400' : Number(actionResult.vacancyRate) > 5 ? 'text-amber-400' : 'text-green-400'}`}
                        >
                          {String(actionResult.vacancyRate)}%
                        </p>
                        <p className="text-[10px] text-gray-500">Vacancy</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-green-400">
                          {String(actionResult.occupied)}
                        </p>
                        <p className="text-[10px] text-gray-500">Occupied</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          ${Number(actionResult.monthlyRentCollected).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500">Monthly Rent</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Investment Calculator Panel */}
      {showInvestCalc && (
        <div className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h2 className={ds.heading2}>Investment Calculator</h2>
            <button onClick={() => setShowInvestCalc(false)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className={ds.grid2}>
            <div className="space-y-3">
              <h3 className={ds.heading3}>Inputs</h3>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Purchase Price ($)</label>
                  <input
                    type="number"
                    value={calcPurchase}
                    onChange={(e) => setCalcPurchase(e.target.value)}
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Down Payment ($)</label>
                  <input
                    type="number"
                    value={calcDown}
                    onChange={(e) => setCalcDown(e.target.value)}
                    className={ds.input}
                  />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Interest Rate (%)</label>
                  <input
                    type="number"
                    value={calcRate}
                    onChange={(e) => setCalcRate(e.target.value)}
                    className={ds.input}
                    step="0.1"
                  />
                </div>
                <div>
                  <label className={ds.label}>Term (years)</label>
                  <input
                    type="number"
                    value={calcTerm}
                    onChange={(e) => setCalcTerm(e.target.value)}
                    className={ds.input}
                  />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Monthly Rent ($)</label>
                  <input
                    type="number"
                    value={calcRent}
                    onChange={(e) => setCalcRent(e.target.value)}
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Monthly Expenses ($)</label>
                  <input
                    type="number"
                    value={calcExpenses}
                    onChange={(e) => setCalcExpenses(e.target.value)}
                    className={ds.input}
                  />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Annual Taxes ($)</label>
                  <input
                    type="number"
                    value={calcTaxes}
                    onChange={(e) => setCalcTaxes(e.target.value)}
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Annual Insurance ($)</label>
                  <input
                    type="number"
                    value={calcInsurance}
                    onChange={(e) => setCalcInsurance(e.target.value)}
                    className={ds.input}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className={ds.heading3}>Results</h3>
              <div className={ds.grid2}>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Monthly P&I</p>
                  <p className="text-xl font-bold text-white">{fmtFull(investCalc.monthlyPI)}</p>
                </div>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Total Monthly Payment</p>
                  <p className="text-xl font-bold text-white">{fmtFull(investCalc.totalMonthly)}</p>
                </div>
              </div>
              <div className={ds.grid3}>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Cap Rate</p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      investCalc.capRate >= 5 ? 'text-neon-green' : 'text-amber-400'
                    )}
                  >
                    {pct(investCalc.capRate)}
                  </p>
                </div>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Cash-on-Cash</p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      investCalc.cashOnCash >= 8
                        ? 'text-neon-green'
                        : investCalc.cashOnCash >= 0
                          ? 'text-amber-400'
                          : 'text-red-400'
                    )}
                  >
                    {pct(investCalc.cashOnCash)}
                  </p>
                </div>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>GRM</p>
                  <p className="text-lg font-bold text-white">{investCalc.grm.toFixed(1)}</p>
                </div>
              </div>
              <div className={ds.grid2}>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Annual NOI</p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      investCalc.noi >= 0 ? 'text-neon-green' : 'text-red-400'
                    )}
                  >
                    {fmtFull(investCalc.noi)}
                  </p>
                </div>
                <div className={ds.panel}>
                  <p className={ds.textMuted}>Annual Cash Flow</p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      investCalc.cashFlow >= 0 ? 'text-neon-green' : 'text-red-400'
                    )}
                  >
                    {fmtFull(investCalc.cashFlow)}
                  </p>
                </div>
              </div>
              <div className={ds.panel}>
                <p className={ds.textMuted}>Loan Amount</p>
                <p className="text-lg font-bold text-white">{fmtFull(investCalc.loan)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== DASHBOARD TAB ==================== */}
      {activeTab === 'Dashboard' && (
        <>
          {/* KPI Row */}
          <div className={ds.grid4}>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <Home className="w-5 h-5 text-neon-green" />
                <span className={ds.textMuted}>Active Listings</span>
              </div>
              <p className="text-3xl font-bold text-white">{stats.activeListings}</p>
              <p className="text-xs text-gray-500 mt-1">{stats.pendingSales} pending</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-neon-cyan" />
                <span className={ds.textMuted}>Listing Volume</span>
              </div>
              <p className="text-3xl font-bold text-white">{fmt(stats.totalListVal)}</p>
              <p className="text-xs text-gray-500 mt-1">{fmt(stats.closedVol)} closed</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <ArrowLeftRight className="w-5 h-5 text-amber-400" />
                <span className={ds.textMuted}>Pending Deals</span>
              </div>
              <p className="text-3xl font-bold text-white">{stats.pendingTxns}</p>
              <p className="text-xs text-gray-500 mt-1">{stats.closedCount} closed this period</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <KeyRound className="w-5 h-5 text-neon-purple" />
                <span className={ds.textMuted}>Vacancy Rate</span>
              </div>
              <p
                className={cn(
                  'text-3xl font-bold',
                  stats.vacancyRate <= 5
                    ? 'text-neon-green'
                    : stats.vacancyRate <= 10
                      ? 'text-amber-400'
                      : 'text-red-400'
                )}
              >
                {pct(stats.vacancyRate)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {stats.vacantCount} of {stats.totalRentals} units
              </p>
            </div>
          </div>

          {/* Secondary KPIs */}
          <div className={ds.grid4}>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className={ds.textMuted}>Avg Days on Market</span>
              </div>
              <p className="text-2xl font-bold text-white">{stats.avgDom}</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-1">
                <Receipt className="w-4 h-4 text-neon-green" />
                <span className={ds.textMuted}>Monthly Rent Roll</span>
              </div>
              <p className="text-2xl font-bold text-neon-green">{fmt(stats.totalRent)}</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-neon-cyan" />
                <span className={ds.textMuted}>Portfolio Value</span>
              </div>
              <p className="text-2xl font-bold text-white">{fmt(stats.portfolioVal)}</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-4 h-4 text-neon-blue" />
                <span className={ds.textMuted}>Total Showings</span>
              </div>
              <p className="text-2xl font-bold text-white">{stats.showingCount}</p>
            </div>
          </div>

          {/* Recent Activity */}
          <div className={ds.grid2}>
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3')}>Recent Listings</h3>
              {items
                .filter((i) => (i.data as unknown as RealEstateArtifact).artifactType === 'Listing')
                .slice(0, 5)
                .map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0 cursor-pointer hover:bg-lattice-elevated/50 px-2 rounded"
                      onClick={() => {
                        setSelectedActionItem(item.id);
                        setActiveTab('Listings');
                        openEditEditor(item);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title}</p>
                        <p className="text-xs text-gray-500 truncate">{d.address}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        {d.price != null && (
                          <span className="text-sm font-semibold text-white">{fmt(d.price)}</span>
                        )}
                        <span className={ds.badge(STATUS_COLORS[d.status] || 'gray-400')}>
                          {d.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {items.filter(
                (i) => (i.data as unknown as RealEstateArtifact).artifactType === 'Listing'
              ).length === 0 && (
                <p className={cn(ds.textMuted, 'text-center py-4')}>
                  No properties listed yet. Add your first real estate listing.
                </p>
              )}
            </div>
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3')}>Active Transactions</h3>
              {items
                .filter(
                  (i) =>
                    (i.data as unknown as RealEstateArtifact).artifactType === 'Transaction' &&
                    !['closed', 'fell_through'].includes(
                      (i.data as unknown as RealEstateArtifact).status
                    )
                )
                .slice(0, 5)
                .map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0 cursor-pointer hover:bg-lattice-elevated/50 px-2 rounded"
                      onClick={() => {
                        setSelectedActionItem(item.id);
                        setActiveTab('Transactions');
                        openEditEditor(item);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title}</p>
                        <p className="text-xs text-gray-500">
                          {d.closingDate ? `Closing: ${d.closingDate}` : 'No closing date'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        {d.price != null && (
                          <span className="text-sm font-semibold text-white">{fmt(d.price)}</span>
                        )}
                        <span className={ds.badge(STATUS_COLORS[d.status] || 'gray-400')}>
                          {d.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {items.filter(
                (i) =>
                  (i.data as unknown as RealEstateArtifact).artifactType === 'Transaction' &&
                  !['closed', 'fell_through'].includes(
                    (i.data as unknown as RealEstateArtifact).status
                  )
              ).length === 0 && (
                <p className={cn(ds.textMuted, 'text-center py-4')}>No active transactions</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== LISTINGS TAB ==================== */}
      {activeTab === 'Listings' && (
        <section className="space-y-4">
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>Listing Manager</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search listings, MLS#..."
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
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Home className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>No listings found. Add a property to get started.</p>
              </div>
            ) : (
              <div className={ds.grid3}>
                {filtered.map((item, index) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={ds.panelHover}
                      onClick={() => openEditEditor(item)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>
                          {item.title}
                        </h3>
                        <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                      </div>
                      {d.address && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                          <MapPin className="w-3 h-3" /> {d.address}
                        </p>
                      )}
                      {d.mlsNumber && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                          <Hash className="w-3 h-3" /> MLS: {d.mlsNumber}
                        </p>
                      )}
                      <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        {d.price != null && (
                          <span className="font-semibold text-white flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> {fmt(d.price)}
                          </span>
                        )}
                        {d.bedrooms != null && (
                          <span className="flex items-center gap-1">
                            <Bed className="w-3 h-3" /> {d.bedrooms} bd
                          </span>
                        )}
                        {d.bathrooms != null && (
                          <span className="flex items-center gap-1">
                            <Bath className="w-3 h-3" /> {d.bathrooms} ba
                          </span>
                        )}
                        {d.sqft != null && (
                          <span className="flex items-center gap-1">
                            <Ruler className="w-3 h-3" /> {d.sqft.toLocaleString()} sqft
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap mt-2">
                        {d.lotSize != null && (
                          <span className="flex items-center gap-1">
                            <LandPlot className="w-3 h-3" /> {d.lotSize} acres
                          </span>
                        )}
                        {d.yearBuilt != null && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Built {d.yearBuilt}
                          </span>
                        )}
                        {d.daysOnMarket != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {d.daysOnMarket} DOM
                          </span>
                        )}
                        {d.agent && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {d.agent}
                          </span>
                        )}
                      </div>
                      {d.priceHistory && d.priceHistory.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-lattice-border">
                          <p className="text-xs text-gray-500 mb-1">Price History:</p>
                          {d.priceHistory.slice(0, 2).map((ph, idx) => (
                            <p key={idx} className="text-xs text-gray-400">
                              {ph.date}: {fmt(ph.price)} - {ph.reason}
                            </p>
                          ))}
                        </div>
                      )}
                      {d.openHouses && d.openHouses.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-lattice-border">
                          <p className="text-xs text-neon-blue flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Open House: {d.openHouses[0].date}{' '}
                            {d.openHouses[0].startTime}-{d.openHouses[0].endTime}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== TRANSACTIONS TAB ==================== */}
      {activeTab === 'Transactions' && (
        <section className="space-y-4">
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>Transaction Coordinator</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search deals..."
                    className={cn(ds.input, 'pl-9 w-56')}
                  />
                </div>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className={cn(ds.select, 'w-44')}
                >
                  <option value="all">All stages</option>
                  {currentStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <ArrowLeftRight className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>No transactions found. Create one to track a deal.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  const isExpanded = expandedTxn === item.id;
                  return (
                    <div key={item.id} className={ds.panel}>
                      <div
                        className="flex items-start justify-between cursor-pointer"
                        onClick={() => setExpandedTxn(isExpanded ? null : item.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={cn(ds.heading3, 'text-base truncate')}>{item.title}</h3>
                            <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                          </div>
                          {d.address && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {d.address}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {d.price != null && (
                            <span className="text-lg font-bold text-white">{fmt(d.price)}</span>
                          )}
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </div>

                      {/* Pipeline visualization */}
                      {renderPipelineStage(d.status)}

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-lattice-border space-y-4">
                          {/* Key dates */}
                          <div className={ds.grid3}>
                            <div>
                              <p className={ds.label}>Closing Date</p>
                              <p className="text-sm text-white">
                                {d.closingDate || (
                                  <span className="text-gray-500 text-xs">Not scheduled</span>
                                )}
                              </p>
                            </div>
                            <div>
                              <p className={ds.label}>Escrow</p>
                              <p className="text-sm text-white">
                                {d.escrowCompany || 'Not assigned'}
                              </p>
                            </div>
                            <div>
                              <p className={ds.label}>Lender</p>
                              <p className="text-sm text-white">{d.lenderName || 'Not assigned'}</p>
                            </div>
                          </div>
                          <div className={ds.grid3}>
                            <div>
                              <p className={ds.label}>Earnest Money</p>
                              <p className="text-sm text-white">
                                {d.earnestMoney ? fmtFull(d.earnestMoney) : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className={ds.label}>Commission (%)</p>
                              <p className="text-sm text-white">
                                {d.commission ? `${d.commission}%` : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className={ds.label}>Client</p>
                              <p className="text-sm text-white">{d.client || 'N/A'}</p>
                            </div>
                          </div>

                          {/* Contingencies */}
                          {d.contingencies && d.contingencies.length > 0 && (
                            <div>
                              <h4
                                className={cn(ds.label, 'text-sm font-semibold text-gray-300 mb-2')}
                              >
                                Contingencies
                              </h4>
                              <div className="space-y-1">
                                {d.contingencies.map((c, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between py-1 px-2 bg-lattice-elevated rounded text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      {c.status === 'met' && (
                                        <CheckCircle2 className="w-4 h-4 text-neon-green" />
                                      )}
                                      {c.status === 'pending' && (
                                        <Clock className="w-4 h-4 text-amber-400" />
                                      )}
                                      {c.status === 'waived' && (
                                        <Minus className="w-4 h-4 text-gray-400" />
                                      )}
                                      {c.status === 'failed' && (
                                        <AlertTriangle className="w-4 h-4 text-red-400" />
                                      )}
                                      <span className="text-white">{c.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-400 text-xs">
                                        Due: {c.deadline}
                                      </span>
                                      <span
                                        className={ds.badge(
                                          c.status === 'met'
                                            ? 'neon-green'
                                            : c.status === 'pending'
                                              ? 'amber-400'
                                              : c.status === 'waived'
                                                ? 'gray-400'
                                                : 'red-400'
                                        )}
                                      >
                                        {c.status}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Document checklist */}
                          {d.docChecklist && d.docChecklist.length > 0 && (
                            <div>
                              <h4
                                className={cn(ds.label, 'text-sm font-semibold text-gray-300 mb-2')}
                              >
                                Document Checklist
                              </h4>
                              <div className="space-y-1">
                                {d.docChecklist.map((doc, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between py-1 px-2 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={cn(
                                          'w-4 h-4 rounded border flex items-center justify-center',
                                          doc.completed
                                            ? 'bg-neon-green/20 border-neon-green'
                                            : 'border-gray-600'
                                        )}
                                      >
                                        {doc.completed && (
                                          <CheckCircle2 className="w-3 h-3 text-neon-green" />
                                        )}
                                      </div>
                                      <span
                                        className={cn(
                                          'text-white',
                                          doc.completed && 'line-through text-gray-500'
                                        )}
                                      >
                                        {doc.name}
                                      </span>
                                    </div>
                                    {doc.dueDate && (
                                      <span className="text-xs text-gray-500">
                                        Due: {doc.dueDate}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditEditor(item)}
                              className={cn(ds.btnSmall, ds.btnSecondary)}
                            >
                              Edit Details
                            </button>
                            <button
                              onClick={() => handleAction('closing_timeline', item.id)}
                              className={cn(ds.btnSmall, ds.btnGhost)}
                            >
                              <Clock className="w-3 h-3" /> Generate Timeline
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== CMA TAB ==================== */}
      {activeTab === 'CMA' && (
        <section className="space-y-4">
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>CMA Builder</h2>
              <div className="flex items-center gap-2">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className={cn(ds.select, 'w-44')}
                >
                  <option value="all">All statuses</option>
                  {currentStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Calculator className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>No CMAs found. Create one to analyze comparables.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  const comps = d.comparables || [];
                  const avgAdjPrice =
                    comps.length > 0
                      ? comps.reduce((s, c) => s + c.adjustedPrice, 0) / comps.length
                      : 0;
                  return (
                    <div key={item.id} className={ds.panel}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
                            <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                          </div>
                          {d.subjectProperty && (
                            <p className="text-sm text-gray-400">Subject: {d.subjectProperty}</p>
                          )}
                        </div>
                        <div className="text-right">
                          {d.suggestedPrice != null && (
                            <div>
                              <p className={ds.textMuted}>Suggested List Price</p>
                              <p className="text-xl font-bold text-neon-green">
                                {fmtFull(d.suggestedPrice)}
                              </p>
                            </div>
                          )}
                          {d.pricePerSqft != null && (
                            <p className="text-xs text-gray-500">${d.pricePerSqft}/sqft</p>
                          )}
                        </div>
                      </div>

                      {comps.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-lattice-border text-gray-400 text-xs">
                                <th className="text-left py-2 px-2">Address</th>
                                <th className="text-right py-2 px-2">Sale Price</th>
                                <th className="text-right py-2 px-2">Sqft</th>
                                <th className="text-right py-2 px-2">Beds</th>
                                <th className="text-right py-2 px-2">Baths</th>
                                <th className="text-center py-2 px-2">Condition</th>
                                <th className="text-right py-2 px-2">Adjustments</th>
                                <th className="text-right py-2 px-2">Adj. Price</th>
                              </tr>
                            </thead>
                            <tbody>
                              {comps.map((comp, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50"
                                >
                                  <td className="py-2 px-2 text-white">{comp.address}</td>
                                  <td className="py-2 px-2 text-right text-white">
                                    {fmtFull(comp.price)}
                                  </td>
                                  <td className="py-2 px-2 text-right text-gray-400">
                                    {comp.sqft.toLocaleString()}
                                  </td>
                                  <td className="py-2 px-2 text-right text-gray-400">
                                    {comp.beds}
                                  </td>
                                  <td className="py-2 px-2 text-right text-gray-400">
                                    {comp.baths}
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <span
                                      className={ds.badge(
                                        comp.condition === 'excellent'
                                          ? 'neon-green'
                                          : comp.condition === 'good'
                                            ? 'neon-blue'
                                            : comp.condition === 'fair'
                                              ? 'amber-400'
                                              : 'red-400'
                                      )}
                                    >
                                      {comp.condition}
                                    </span>
                                  </td>
                                  <td
                                    className={cn(
                                      'py-2 px-2 text-right',
                                      comp.adjustments >= 0 ? 'text-neon-green' : 'text-red-400'
                                    )}
                                  >
                                    {comp.adjustments >= 0 ? '+' : ''}
                                    {fmtFull(comp.adjustments)}
                                  </td>
                                  <td className="py-2 px-2 text-right font-semibold text-white">
                                    {fmtFull(comp.adjustedPrice)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-lattice-border">
                                <td
                                  colSpan={7}
                                  className="py-2 px-2 text-right text-gray-400 font-medium"
                                >
                                  Average Adjusted Price:
                                </td>
                                <td className="py-2 px-2 text-right font-bold text-neon-cyan">
                                  {fmtFull(avgAdjPrice)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                          <p>No comparable properties yet. Add comps to see market analysis.</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => openEditEditor(item)}
                          className={cn(ds.btnSmall, ds.btnSecondary)}
                        >
                          Edit CMA
                        </button>
                        <button
                          onClick={() => handleAction('cma_generate', item.id)}
                          className={cn(ds.btnSmall, ds.btnGhost)}
                        >
                          <Calculator className="w-3 h-3" /> Regenerate
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== RENTALS TAB ==================== */}
      {activeTab === 'Rentals' && (
        <section className="space-y-4">
          {/* Rent Roll Summary */}
          <div className={ds.grid4}>
            <div className={ds.panel}>
              <p className={ds.textMuted}>Total Units</p>
              <p className="text-2xl font-bold text-white">{stats.totalRentals}</p>
            </div>
            <div className={ds.panel}>
              <p className={ds.textMuted}>Occupied</p>
              <p className="text-2xl font-bold text-neon-green">{stats.occupiedCount}</p>
            </div>
            <div className={ds.panel}>
              <p className={ds.textMuted}>Vacant</p>
              <p className="text-2xl font-bold text-red-400">{stats.vacantCount}</p>
            </div>
            <div className={ds.panel}>
              <p className={ds.textMuted}>Monthly Rent Roll</p>
              <p className="text-2xl font-bold text-neon-cyan">{fmt(stats.totalRent)}</p>
            </div>
          </div>

          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>Property Management</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search units, tenants..."
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
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleAction('vacancy_report')}
                  className={cn(ds.btnSmall, ds.btnGhost)}
                >
                  <FileText className="w-3 h-3" /> Vacancy Report
                </button>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <KeyRound className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>No rental units found. Add a property to manage.</p>
              </div>
            ) : (
              <div className={ds.grid2}>
                {filtered.map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  const leaseRemaining = d.leaseEnd
                    ? daysBetween(new Date().toISOString().split('T')[0], d.leaseEnd)
                    : null;
                  const rentColor =
                    d.rentStatus === 'current' || d.rentStatus === 'paid'
                      ? 'text-neon-green'
                      : d.rentStatus === 'late'
                        ? 'text-amber-400'
                        : 'text-red-400';
                  return (
                    <div
                      key={item.id}
                      className={ds.panelHover}
                      onClick={() => openEditEditor(item)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
                          {d.address && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {d.address}
                            </p>
                          )}
                        </div>
                        <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                      </div>

                      {d.tenantName && (
                        <div className="mb-2 p-2 bg-lattice-elevated rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <User className="w-3 h-3 text-gray-400" />
                            <span className="text-sm text-white font-medium">{d.tenantName}</span>
                          </div>
                          {d.tenantPhone && (
                            <p className="text-xs text-gray-500 flex items-center gap-1 ml-5">
                              <Phone className="w-3 h-3" /> {d.tenantPhone}
                            </p>
                          )}
                        </div>
                      )}

                      <div className={ds.grid2}>
                        <div>
                          <p className={ds.label}>Monthly Rent</p>
                          <p className="text-lg font-bold text-white">
                            {d.monthlyRent ? fmtFull(d.monthlyRent) : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <p className={ds.label}>Rent Status</p>
                          <p className={cn('text-sm font-medium', rentColor)}>
                            {d.rentStatus
                              ? d.rentStatus.charAt(0).toUpperCase() + d.rentStatus.slice(1)
                              : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {d.leaseStart && d.leaseEnd && (
                        <div className="mt-2">
                          <p className={ds.label}>Lease Term</p>
                          <p className="text-xs text-white">
                            {d.leaseStart} to {d.leaseEnd}
                          </p>
                          {leaseRemaining != null && (
                            <p
                              className={cn(
                                'text-xs mt-1',
                                leaseRemaining < 30
                                  ? 'text-red-400'
                                  : leaseRemaining < 90
                                    ? 'text-amber-400'
                                    : 'text-gray-400'
                              )}
                            >
                              {leaseRemaining > 0
                                ? `${leaseRemaining} days remaining`
                                : 'Lease expired'}
                            </p>
                          )}
                        </div>
                      )}

                      {d.securityDeposit != null && (
                        <div className="mt-2">
                          <p className={ds.label}>Security Deposit</p>
                          <p className="text-xs text-white">{fmtFull(d.securityDeposit)}</p>
                        </div>
                      )}

                      {d.maintenanceRequests && d.maintenanceRequests.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-lattice-border">
                          <p className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                            <Wrench className="w-3 h-3" /> Maintenance (
                            {d.maintenanceRequests.filter((m) => m.status !== 'completed').length}{' '}
                            open)
                          </p>
                          {d.maintenanceRequests
                            .filter((m) => m.status !== 'completed')
                            .slice(0, 2)
                            .map((mr, idx) => (
                              <div key={idx} className="text-xs flex items-center gap-2 py-0.5">
                                <span
                                  className={ds.badge(
                                    mr.priority === 'emergency'
                                      ? 'red-400'
                                      : mr.priority === 'high'
                                        ? 'amber-400'
                                        : 'gray-400'
                                  )}
                                >
                                  {mr.priority}
                                </span>
                                <span className="text-gray-300 truncate">{mr.issue}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== INVESTING TAB ==================== */}
      {activeTab === 'Investing' && (
        <section className="space-y-4">
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>Investment Deals</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search deals..."
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
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>
                  No investment deals found. Analyze a property to get started.
                </p>
              </div>
            ) : (
              <div className={ds.grid2}>
                {filtered.map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  return (
                    <div
                      key={item.id}
                      className={ds.panelHover}
                      onClick={() => openEditEditor(item)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className={cn(ds.heading3, 'text-base')}>{item.title}</h3>
                          {d.address && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {d.address}
                            </p>
                          )}
                        </div>
                        <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                      </div>
                      <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>

                      <div className={ds.grid3}>
                        <div>
                          <p className={ds.label}>Purchase Price</p>
                          <p className="text-sm font-bold text-white">
                            {d.purchasePrice
                              ? fmtFull(d.purchasePrice)
                              : d.price
                                ? fmtFull(d.price)
                                : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <p className={ds.label}>Gross Rent (mo)</p>
                          <p className="text-sm font-bold text-white">
                            {d.grossRent ? fmtFull(d.grossRent) : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <p className={ds.label}>Op Expenses (mo)</p>
                          <p className="text-sm font-bold text-white">
                            {d.operatingExpenses ? fmtFull(d.operatingExpenses) : 'N/A'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-lattice-border">
                        <div className={ds.grid4}>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Cap Rate</p>
                            <p
                              className={cn(
                                'text-sm font-bold',
                                (d.capRate || 0) >= 5 ? 'text-neon-green' : 'text-amber-400'
                              )}
                            >
                              {d.capRate ? pct(d.capRate) : 'N/A'}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">Cash/Cash</p>
                            <p
                              className={cn(
                                'text-sm font-bold',
                                (d.cashOnCash || 0) >= 8
                                  ? 'text-neon-green'
                                  : (d.cashOnCash || 0) >= 0
                                    ? 'text-amber-400'
                                    : 'text-red-400'
                              )}
                            >
                              {d.cashOnCash ? pct(d.cashOnCash) : 'N/A'}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">GRM</p>
                            <p className="text-sm font-bold text-white">
                              {d.grm ? d.grm.toFixed(1) : 'N/A'}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-500">NOI</p>
                            <p
                              className={cn(
                                'text-sm font-bold',
                                (d.noi || 0) >= 0 ? 'text-neon-green' : 'text-red-400'
                              )}
                            >
                              {d.noi ? fmtFull(d.noi) : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {d.roi != null && (
                        <div className="mt-2 flex items-center gap-1 text-sm">
                          <ArrowUpRight className="w-4 h-4 text-neon-green" />
                          <span className="text-neon-green font-medium">
                            {d.roi}% projected ROI
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction('cap_rate_calc', item.id);
                          }}
                          className={cn(ds.btnSmall, ds.btnGhost)}
                        >
                          <Percent className="w-3 h-3" /> Cap Rate
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction('cash_flow_analysis', item.id);
                          }}
                          className={cn(ds.btnSmall, ds.btnGhost)}
                        >
                          <PiggyBank className="w-3 h-3" /> Cash Flow
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== SHOWINGS TAB ==================== */}
      {activeTab === 'Showings' && (
        <section className="space-y-4">
          <div className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <h2 className={ds.heading2}>Showing Manager</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search showings..."
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
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoading ? (
              <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Eye className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>
                  No showings scheduled. Create one to track buyer activity.
                </p>
              </div>
            ) : (
              <div className={ds.grid3}>
                {filtered.map((item) => {
                  const d = item.data as unknown as RealEstateArtifact;
                  const color = STATUS_COLORS[d.status] || 'gray-400';
                  return (
                    <div
                      key={item.id}
                      data-lens-theme="realestate"
                      className={ds.panelHover}
                      onClick={() => openEditEditor(item)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>
                          {item.title}
                        </h3>
                        <span className={ds.badge(color)}>{d.status.replace(/_/g, ' ')}</span>
                      </div>
                      {d.address && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                          <MapPin className="w-3 h-3" /> {d.address}
                        </p>
                      )}

                      <div className={ds.grid2}>
                        <div>
                          <p className={ds.label}>Date & Time</p>
                          <p className="text-sm text-white">
                            {d.showingDate ? (
                              `${d.showingDate}${d.showingTime ? ` at ${d.showingTime}` : ''}`
                            ) : (
                              <span className="text-gray-500 text-xs">Not scheduled</span>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className={ds.label}>Buyer Agent</p>
                          <p className="text-sm text-white">{d.buyerAgent || 'N/A'}</p>
                        </div>
                      </div>

                      {d.client && (
                        <div className="mt-2">
                          <p className={ds.label}>Buyer</p>
                          <p className="text-sm text-white flex items-center gap-1">
                            <User className="w-3 h-3" /> {d.client}
                          </p>
                          {d.clientPhone && (
                            <p className="text-xs text-gray-500 flex items-center gap-1 ml-4">
                              <Phone className="w-3 h-3" /> {d.clientPhone}
                            </p>
                          )}
                        </div>
                      )}

                      {d.interestLevel != null && (
                        <div className="mt-2">
                          <p className={ds.label}>Interest Level</p>
                          {renderStarRating(d.interestLevel)}
                        </div>
                      )}

                      {d.feedbacks && d.feedbacks.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-lattice-border">
                          <p className="text-xs text-gray-400 mb-1">
                            Feedback ({d.feedbacks.length})
                          </p>
                          {d.feedbacks.slice(0, 2).map((fb, idx) => (
                            <div key={idx} className="text-xs py-1">
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{fb.buyerName}</span>
                                {renderStarRating(fb.interestLevel)}
                              </div>
                              <p className="text-gray-400 line-clamp-1">{fb.feedback}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {d.followUpDate && (
                        <div className="mt-2 flex items-center gap-1 text-xs">
                          <Bell className="w-3 h-3 text-amber-400" />
                          <span className="text-amber-400">Follow-up: {d.followUpDate}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== EDITOR MODAL ==================== */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-3xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>
                  {editingItem ? 'Edit' : 'New'} {formType}
                </h2>
                <button onClick={() => setShowEditor(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Common fields */}
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className={ds.input}
                    placeholder="Property or record title"
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={formType}
                      onChange={(e) => {
                        setFormType(e.target.value as ArtifactType);
                        setFormStatus(STATUSES_BY_TYPE[e.target.value as ArtifactType][0]);
                      }}
                      className={ds.select}
                    >
                      {MODE_TABS.filter((t) => t.defaultType).map((t) => (
                        <option key={t.defaultType} value={t.defaultType}>
                          {t.defaultType}
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
                      {(STATUSES_BY_TYPE[formType] ?? []).map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Address</label>
                  <input
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    className={ds.input}
                    placeholder="Full property address"
                  />
                </div>

                {/* Property details - Listings, CMA, Showings */}
                {(formType === 'Listing' || formType === 'CMA' || formType === 'Showing') && (
                  <>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Price ($)</label>
                        <input
                          type="number"
                          value={formPrice}
                          onChange={(e) => setFormPrice(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Property Type</label>
                        <select
                          value={formPropType}
                          onChange={(e) => setFormPropType(e.target.value)}
                          className={ds.select}
                        >
                          <option value="">Select type...</option>
                          <option value="Single Family">Single Family</option>
                          <option value="Condo">Condo</option>
                          <option value="Townhouse">Townhouse</option>
                          <option value="Multi-Family">Multi-Family</option>
                          <option value="Land">Land</option>
                          <option value="Commercial">Commercial</option>
                        </select>
                      </div>
                    </div>
                    <div className={ds.grid4}>
                      <div>
                        <label className={ds.label}>Beds</label>
                        <input
                          type="number"
                          value={formBeds}
                          onChange={(e) => setFormBeds(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Baths</label>
                        <input
                          type="number"
                          value={formBaths}
                          onChange={(e) => setFormBaths(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                          min="0"
                          step="0.5"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Sq Ft</label>
                        <input
                          type="number"
                          value={formSqft}
                          onChange={(e) => setFormSqft(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Year Built</label>
                        <input
                          type="number"
                          value={formYearBuilt}
                          onChange={(e) => setFormYearBuilt(e.target.value)}
                          className={ds.input}
                          placeholder="2000"
                        />
                      </div>
                    </div>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Lot Size (acres)</label>
                        <input
                          type="number"
                          value={formLotSize}
                          onChange={(e) => setFormLotSize(e.target.value)}
                          className={ds.input}
                          placeholder="0.0"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>MLS Number</label>
                        <input
                          value={formMls}
                          onChange={(e) => setFormMls(e.target.value)}
                          className={ds.input}
                          placeholder="MLS#"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Listing Agent</label>
                        <input
                          value={formAgent}
                          onChange={(e) => setFormAgent(e.target.value)}
                          className={ds.input}
                          placeholder="Agent name"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Transaction-specific fields */}
                {formType === 'Transaction' && (
                  <>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Deal Price ($)</label>
                        <input
                          type="number"
                          value={formPrice}
                          onChange={(e) => setFormPrice(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Closing Date</label>
                        <input
                          type="date"
                          value={formClosingDate}
                          onChange={(e) => setFormClosingDate(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                    </div>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Escrow Company</label>
                        <input
                          value={formEscrow}
                          onChange={(e) => setFormEscrow(e.target.value)}
                          className={ds.input}
                          placeholder="Title/escrow company"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Lender</label>
                        <input
                          value={formLender}
                          onChange={(e) => setFormLender(e.target.value)}
                          className={ds.input}
                          placeholder="Lender name"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Agent</label>
                        <input
                          value={formAgent}
                          onChange={(e) => setFormAgent(e.target.value)}
                          className={ds.input}
                          placeholder="Agent name"
                        />
                      </div>
                    </div>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Earnest Money ($)</label>
                        <input
                          type="number"
                          value={formEarnest}
                          onChange={(e) => setFormEarnest(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Commission (%)</label>
                        <input
                          type="number"
                          value={formCommission}
                          onChange={(e) => setFormCommission(e.target.value)}
                          className={ds.input}
                          placeholder="3.0"
                          step="0.1"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Client</label>
                        <input
                          value={formClient}
                          onChange={(e) => setFormClient(e.target.value)}
                          className={ds.input}
                          placeholder="Buyer/seller"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Rental-specific fields */}
                {formType === 'RentalUnit' && (
                  <>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Property Value ($)</label>
                        <input
                          type="number"
                          value={formPrice}
                          onChange={(e) => setFormPrice(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Property Type</label>
                        <select
                          value={formPropType}
                          onChange={(e) => setFormPropType(e.target.value)}
                          className={ds.select}
                        >
                          <option value="">Select type...</option>
                          <option value="Single Family">Single Family</option>
                          <option value="Condo">Condo</option>
                          <option value="Apartment">Apartment</option>
                          <option value="Townhouse">Townhouse</option>
                          <option value="Duplex">Duplex</option>
                          <option value="Commercial">Commercial</option>
                        </select>
                      </div>
                    </div>
                    <div className="p-3 bg-lattice-elevated rounded-lg space-y-3">
                      <h4 className={cn(ds.heading3, 'text-sm')}>Tenant Information</h4>
                      <div className={ds.grid3}>
                        <div>
                          <label className={ds.label}>Tenant Name</label>
                          <input
                            value={formTenant}
                            onChange={(e) => setFormTenant(e.target.value)}
                            className={ds.input}
                            placeholder="Full name"
                          />
                        </div>
                        <div>
                          <label className={ds.label}>Phone</label>
                          <input
                            value={formTenantPhone}
                            onChange={(e) => setFormTenantPhone(e.target.value)}
                            className={ds.input}
                            placeholder="(555) 000-0000"
                          />
                        </div>
                        <div>
                          <label className={ds.label}>Rent Status</label>
                          <select
                            value={formRentStatus}
                            onChange={(e) => setFormRentStatus(e.target.value)}
                            className={ds.select}
                          >
                            <option value="current">Current</option>
                            <option value="paid">Paid</option>
                            <option value="late">Late</option>
                            <option value="delinquent">Delinquent</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-lattice-elevated rounded-lg space-y-3">
                      <h4 className={cn(ds.heading3, 'text-sm')}>Lease Terms</h4>
                      <div className={ds.grid2}>
                        <div>
                          <label className={ds.label}>Lease Start</label>
                          <input
                            type="date"
                            value={formLeaseStart}
                            onChange={(e) => setFormLeaseStart(e.target.value)}
                            className={ds.input}
                          />
                        </div>
                        <div>
                          <label className={ds.label}>Lease End</label>
                          <input
                            type="date"
                            value={formLeaseEnd}
                            onChange={(e) => setFormLeaseEnd(e.target.value)}
                            className={ds.input}
                          />
                        </div>
                      </div>
                      <div className={ds.grid2}>
                        <div>
                          <label className={ds.label}>Monthly Rent ($)</label>
                          <input
                            type="number"
                            value={formRent}
                            onChange={(e) => setFormRent(e.target.value)}
                            className={ds.input}
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <label className={ds.label}>Security Deposit ($)</label>
                          <input
                            type="number"
                            value={formDeposit}
                            onChange={(e) => setFormDeposit(e.target.value)}
                            className={ds.input}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Deal/Investment-specific fields */}
                {formType === 'Deal' && (
                  <>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Purchase Price ($)</label>
                        <input
                          type="number"
                          value={formPurchasePrice}
                          onChange={(e) => setFormPurchasePrice(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Down Payment ($)</label>
                        <input
                          type="number"
                          value={formDownPay}
                          onChange={(e) => setFormDownPay(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Gross Monthly Rent ($)</label>
                        <input
                          type="number"
                          value={formGrossRent}
                          onChange={(e) => setFormGrossRent(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Monthly Op Expenses ($)</label>
                        <input
                          type="number"
                          value={formOpEx}
                          onChange={(e) => setFormOpEx(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Expected ROI (%)</label>
                        <input
                          type="number"
                          value={formRoi}
                          onChange={(e) => setFormRoi(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                          step="0.1"
                        />
                      </div>
                    </div>
                    <div className={ds.grid4}>
                      <div>
                        <label className={ds.label}>Mortgage Rate (%)</label>
                        <input
                          type="number"
                          value={formMortRate}
                          onChange={(e) => setFormMortRate(e.target.value)}
                          className={ds.input}
                          placeholder="6.5"
                          step="0.1"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Term (years)</label>
                        <input
                          type="number"
                          value={formMortTerm}
                          onChange={(e) => setFormMortTerm(e.target.value)}
                          className={ds.input}
                          placeholder="30"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Annual Taxes ($)</label>
                        <input
                          type="number"
                          value={formTaxes}
                          onChange={(e) => setFormTaxes(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Annual Insurance ($)</label>
                        <input
                          type="number"
                          value={formInsurance}
                          onChange={(e) => setFormInsurance(e.target.value)}
                          className={ds.input}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Showing-specific fields */}
                {formType === 'Showing' && (
                  <>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Showing Date</label>
                        <input
                          type="date"
                          value={formShowDate}
                          onChange={(e) => setFormShowDate(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Showing Time</label>
                        <input
                          type="time"
                          value={formShowTime}
                          onChange={(e) => setFormShowTime(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Buyer Agent</label>
                        <input
                          value={formBuyerAgent}
                          onChange={(e) => setFormBuyerAgent(e.target.value)}
                          className={ds.input}
                          placeholder="Agent name"
                        />
                      </div>
                    </div>
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Buyer Name</label>
                        <input
                          value={formClient}
                          onChange={(e) => setFormClient(e.target.value)}
                          className={ds.input}
                          placeholder="Buyer name"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Buyer Phone</label>
                        <input
                          value={formClientPhone}
                          onChange={(e) => setFormClientPhone(e.target.value)}
                          className={ds.input}
                          placeholder="(555) 000-0000"
                        />
                      </div>
                      <div>
                        <label className={ds.label}>Buyer Email</label>
                        <input
                          value={formClientEmail}
                          onChange={(e) => setFormClientEmail(e.target.value)}
                          className={ds.input}
                          placeholder="email@example.com"
                        />
                      </div>
                    </div>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Interest Level (1-5)</label>
                        <select
                          value={formInterest}
                          onChange={(e) => setFormInterest(e.target.value)}
                          className={ds.select}
                        >
                          <option value="1">1 - Not Interested</option>
                          <option value="2">2 - Somewhat Interested</option>
                          <option value="3">3 - Interested</option>
                          <option value="4">4 - Very Interested</option>
                          <option value="5">5 - Ready to Offer</option>
                        </select>
                      </div>
                      <div>
                        <label className={ds.label}>Follow-up Date</label>
                        <input
                          type="date"
                          value={formFollowUp}
                          onChange={(e) => setFormFollowUp(e.target.value)}
                          className={ds.input}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Client contact - for types that need it */}
                {(formType === 'Listing' || formType === 'CMA') && (
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Client</label>
                      <input
                        value={formClient}
                        onChange={(e) => setFormClient(e.target.value)}
                        className={ds.input}
                        placeholder="Client name"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Client Phone</label>
                      <input
                        value={formClientPhone}
                        onChange={(e) => setFormClientPhone(e.target.value)}
                        className={ds.input}
                        placeholder="(555) 000-0000"
                      />
                    </div>
                    <div>
                      <label className={ds.label}>Client Email</label>
                      <input
                        value={formClientEmail}
                        onChange={(e) => setFormClientEmail(e.target.value)}
                        className={ds.input}
                        placeholder="email@example.com"
                      />
                    </div>
                  </div>
                )}

                {/* Date field for applicable types */}
                {(formType === 'Listing' || formType === 'Deal') && (
                  <div>
                    <label className={ds.label}>Date</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className={ds.input}
                    />
                  </div>
                )}

                {/* Description & notes - always shown */}
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className={ds.textarea}
                    rows={3}
                    placeholder="Property or record description..."
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

              {/* Footer */}
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
      )}

      {/* ==================== MAP TAB ==================== */}
      {activeTab === 'Map' && (
        <div className={ds.panel}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-neon-cyan" /> Property Locations
          </h3>
          <MapView
            markers={items
              .filter((i) => {
                const d = i.data as RealEstateArtifact;
                return d.lat && d.lng;
              })
              .map((i) => {
                const d = i.data as RealEstateArtifact;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: i.title,
                  popup:
                    `${d.address || ''} ${d.price ? '- $' + d.price.toLocaleString() : ''}`.trim(),
                };
              })}
            className="h-[500px]"
          />
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
            <LensFeaturePanel lensId="real_estate" />
          </div>
        )}
      </div>
    </div>
  );
}
