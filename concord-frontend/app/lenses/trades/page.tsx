'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { apiHelpers } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Hammer,
  HardHat,
  Wrench,
  FileText,
  Truck,
  Users,
  Plus,
  Search,
  Filter,
  X,
  Edit2,
  Trash2,
  DollarSign,
  ClipboardCheck,
  Package,
  Calendar,
  MapPin,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  ShieldCheck,
  Clock,
  Camera,
  Receipt,
  ArrowRight,
  PlayCircle,
  Milestone,
  GitBranch,
  FileCheck,
  Building,
  CreditCard,
  PieChart,
  Activity,
  Layers,
  CircleDot,
  Timer,
  TrendingDown,
  ArrowDown,
  ArrowUp,
  Eye,
  Printer,
  Send,
  Star,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModeTab = 'jobs' | 'estimates' | 'materials' | 'permits' | 'equipment' | 'clients';
type SubView = 'list' | 'timeline' | 'changeOrders' | 'timeTracking' | 'profitLoss' | 'photos' | 'estimateBuilder' | 'materialsTracker' | 'invoiceGenerator';
type ArtifactType = 'Job' | 'Estimate' | 'MaterialsList' | 'Permit' | 'Equipment' | 'Client';
type Status = 'quoted' | 'approved' | 'in_progress' | 'inspection' | 'completed' | 'invoiced' | 'paid';
type PhaseStatus = 'not_started' | 'in_progress' | 'complete' | 'delayed';
type ChangeOrderStatus = 'pending' | 'approved' | 'rejected';

interface JobPhase {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: PhaseStatus;
  dependsOn?: string;
  isMilestone?: boolean;
}

interface ChangeOrder {
  id: string;
  description: string;
  costImpact: number;
  status: ChangeOrderStatus;
  dateSubmitted: string;
  dateResolved?: string;
}

interface TimeEntry {
  id: string;
  worker: string;
  date: string;
  clockIn: string;
  clockOut: string;
  hours: number;
  rate: number;
  isOvertime: boolean;
  jobId?: string;
}

interface EstimateLineItem {
  id: string;
  description: string;
  category: 'materials' | 'labor' | 'overhead' | 'profit';
  qty: number;
  unitCost: number;
  markupPct: number;
}

interface MaterialEntry {
  id: string;
  name: string;
  supplier: string;
  qty: number;
  unit: string;
  unitCost: number;
  poNumber?: string;
  deliveryDate?: string;
  deliveryStatus: 'ordered' | 'shipped' | 'delivered' | 'backordered';
}

interface PhotoEntry {
  id: string;
  phase: 'before' | 'during' | 'after';
  date: string;
  location: string;
  notes: string;
  filename: string;
}

interface TradesArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  client: string;
  address: string;
  phone: string;
  email?: string;
  value: number;
  startDate: string;
  endDate: string;
  notes: string;
  trade?: string;
  foremanAssigned?: string;
  phases?: JobPhase[];
  changeOrders?: ChangeOrder[];
  timeEntries?: TimeEntry[];
  photos?: PhotoEntry[];
  materialEntries?: MaterialEntry[];
  laborCostTotal?: number;
  materialCostTotal?: number;
  overheadPct?: number;
  taxRate?: number;
  // Estimate-specific
  lineItems?: { description: string; qty: number; unitCost: number }[];
  estimateLineItems?: EstimateLineItem[];
  // Materials-specific
  supplier?: string;
  items?: { material: string; qty: number; unit: string; cost: number }[];
  // Permit-specific
  permitNumber?: string;
  issuingAuthority?: string;
  expiryDate?: string;
  // Equipment-specific
  serialNumber?: string;
  lastService?: string;
  nextService?: string;
  condition?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Hammer; artifactType: ArtifactType }[] = [
  { id: 'jobs', label: 'Jobs', icon: Hammer, artifactType: 'Job' },
  { id: 'estimates', label: 'Estimates', icon: FileText, artifactType: 'Estimate' },
  { id: 'materials', label: 'Materials', icon: Package, artifactType: 'MaterialsList' },
  { id: 'permits', label: 'Permits', icon: ShieldCheck, artifactType: 'Permit' },
  { id: 'equipment', label: 'Equipment', icon: Truck, artifactType: 'Equipment' },
  { id: 'clients', label: 'Clients', icon: Users, artifactType: 'Client' },
];

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  quoted: { label: 'Quoted', color: 'gray-400' },
  approved: { label: 'Approved', color: 'blue-400' },
  in_progress: { label: 'In Progress', color: 'yellow-400' },
  inspection: { label: 'Inspection', color: 'purple-400' },
  completed: { label: 'Completed', color: 'green-400' },
  invoiced: { label: 'Invoiced', color: 'cyan-400' },
  paid: { label: 'Paid', color: 'emerald-400' },
};

const PHASE_STATUS_CONFIG: Record<PhaseStatus, { label: string; color: string; bgClass: string }> = {
  not_started: { label: 'Not Started', color: 'gray-400', bgClass: 'bg-gray-500/30' },
  in_progress: { label: 'In Progress', color: 'yellow-400', bgClass: 'bg-yellow-500/40' },
  complete: { label: 'Complete', color: 'green-400', bgClass: 'bg-green-500/40' },
  delayed: { label: 'Delayed', color: 'red-400', bgClass: 'bg-red-500/40' },
};

const CHANGE_ORDER_STATUS_CONFIG: Record<ChangeOrderStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'yellow-400' },
  approved: { label: 'Approved', color: 'green-400' },
  rejected: { label: 'Rejected', color: 'red-400' },
};

const TRADES_LIST = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'Roofing', 'Painting', 'Concrete', 'Landscaping', 'General'];

const seedData: { title: string; data: Record<string, unknown> }[] = [];

// ---------------------------------------------------------------------------
// Helper: generate ID
// ---------------------------------------------------------------------------
let _idCounter = 0;
const genId = () => `local-${Date.now()}-${++_idCounter}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TradesLensPage() {
  useLensNav('trades');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('trades');

  // ----- Top-level navigation -----
  const [activeTab, setActiveTab] = useState<ModeTab>('jobs');
  const [subView, setSubView] = useState<SubView>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<TradesArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // ----- Editor form state -----
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('quoted');
  const [formTrade, setFormTrade] = useState('General');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formForeman, setFormForeman] = useState('');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  // ----- Estimate Builder state -----
  const [estLineItems, setEstLineItems] = useState<EstimateLineItem[]>([]);
  const [estTaxRate, setEstTaxRate] = useState(8.25);

  // ----- Change Order state -----
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [coDescription, setCoDescription] = useState('');
  const [coCostImpact, setCoCostImpact] = useState('');

  // ----- Time Tracking state -----
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [teWorker, setTeWorker] = useState('');
  const [teDate, setTeDate] = useState('');
  const [teClockIn, setTeClockIn] = useState('');
  const [teClockOut, setTeClockOut] = useState('');
  const [teRate, setTeRate] = useState('45');

  // ----- Job Timeline / Phase state -----
  const [phases, setPhases] = useState<JobPhase[]>([]);
  const [phaseName, setPhaseName] = useState('');
  const [phaseStart, setPhaseStart] = useState('');
  const [phaseEnd, setPhaseEnd] = useState('');

  // ----- Materials Tracker state -----
  const [matEntries, setMatEntries] = useState<MaterialEntry[]>([]);
  const [matName, setMatName] = useState('');
  const [matSupplier, setMatSupplier] = useState('');
  const [matQty, setMatQty] = useState('');
  const [matUnit, setMatUnit] = useState('ea');
  const [matUnitCost, setMatUnitCost] = useState('');

  // ----- Photo Documentation state -----
  const [photoEntries, setPhotoEntries] = useState<PhotoEntry[]>([]);
  const [photoPhase, setPhotoPhase] = useState<'before' | 'during' | 'after'>('before');
  const [photoLocation, setPhotoLocation] = useState('');
  const [photoNotes, setPhotoNotes] = useState('');

  // ----- Invoice Generator state -----
  const [invLineItems, setInvLineItems] = useState<Array<{ description: string; quantity: number; unitPrice: number }>>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [invTaxRate, setInvTaxRate] = useState(0);
  const [invDueDate, setInvDueDate] = useState('');
  const [invPayerName, setInvPayerName] = useState('');
  const [invNotes, setInvNotes] = useState('');
  const [invCreating, setInvCreating] = useState(false);
  const [invResult, setInvResult] = useState<Record<string, unknown> | null>(null);

  // ----- Data hooks -----
  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Job';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<TradesArtifact>('trades', activeArtifactType, {
    seed: seedData.filter(s => (s.data as Record<string, unknown>).type === activeArtifactType),
  });

  const runAction = useRunArtifact('trades');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.data as unknown as TradesArtifact).client?.toLowerCase().includes(q) ||
        (i.data as unknown as TradesArtifact).address?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      result = result.filter(i => (i.data as unknown as TradesArtifact).status === filterStatus);
    }
    return result;
  }, [items, searchQuery, filterStatus]);

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null;
    return items.find(i => i.id === selectedJobId) || null;
  }, [items, selectedJobId]);

  // ---------------------------------------------------------------------------
  // Editor helpers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormDescription('');
    setFormClient('');
    setFormAddress('');
    setFormPhone('');
    setFormEmail('');
    setFormValue('');
    setFormStatus('quoted');
    setFormTrade('General');
    setFormStartDate('');
    setFormEndDate('');
    setFormNotes('');
    setFormForeman('');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<TradesArtifact>) => {
    const d = item.data as unknown as TradesArtifact;
    setEditingItem(item);
    setFormName(d.name || item.title);
    setFormDescription(d.description || '');
    setFormClient(d.client || '');
    setFormAddress(d.address || '');
    setFormPhone(d.phone || '');
    setFormEmail(d.email || '');
    setFormValue(String(d.value || ''));
    setFormStatus(d.status || 'quoted');
    setFormTrade(d.trade || 'General');
    setFormStartDate(d.startDate || '');
    setFormEndDate(d.endDate || '');
    setFormNotes(d.notes || '');
    setFormForeman(d.foremanAssigned || '');
    setEditorOpen(true);
  };

  const selectJobForDetail = (item: LensItem<TradesArtifact>) => {
    setSelectedJobId(item.id);
    const d = item.data as unknown as TradesArtifact;
    setPhases(d.phases || []);
    setChangeOrders(d.changeOrders || []);
    setTimeEntries(d.timeEntries || []);
    setMatEntries(d.materialEntries || []);
    setPhotoEntries(d.photos || []);
    setEstLineItems(d.estimateLineItems || []);
  };

  const handleSave = async () => {
    const payload = {
      title: formName,
      data: {
        name: formName,
        type: activeArtifactType,
        status: formStatus,
        description: formDescription,
        client: formClient,
        address: formAddress,
        phone: formPhone,
        email: formEmail,
        value: parseFloat(formValue) || 0,
        startDate: formStartDate,
        endDate: formEndDate,
        trade: formTrade,
        notes: formNotes,
        foremanAssigned: formForeman,
      } as unknown as Partial<TradesArtifact>,
      meta: { status: formStatus, tags: [activeArtifactType, formTrade] },
    };
    if (editingItem) {
      await update(editingItem.id, payload);
    } else {
      await create(payload);
    }
    setEditorOpen(false);
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
        setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` });
        return;
      }
      const actionData = result.result as Record<string, unknown>;
      setActionResult(actionData);

      // If generateInvoice, also create an invoice DTU via economy endpoint
      if (action === 'generateInvoice' && actionData) {
        try {
          const item = items.find(i => i.id === targetId);
          const itemData = (item?.data || {}) as Record<string, unknown>;
          const lineItems = ((itemData.lineItems || actionData.lineItems || []) as Array<{ description?: string; name?: string; qty?: number; quantity?: number; unitCost?: number; unitPrice?: number }>).map(li => ({
            description: li.description || li.name || 'Item',
            quantity: li.qty || li.quantity || 1,
            unitPrice: li.unitCost || li.unitPrice || 0,
          }));
          await apiHelpers.economy.createInvoice({
            lineItems,
            taxRate: (actionData.taxRate as number) || (itemData.taxRate as number) || 0,
            dueDate: (actionData.dueDate as string) || undefined,
            payerName: (itemData.clientName as string) || (actionData.payerName as string) || undefined,
            payeeName: (actionData.payeeName as string) || undefined,
            notes: `Generated from trades job: ${item?.title || targetId}`,
          });
        } catch (invoiceErr) {
          console.error('Invoice DTU creation failed:', invoiceErr);
          showToast('error', 'Invoice creation failed');
        }
      }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Action failed');
    }
  };

  // ---------------------------------------------------------------------------
  // Domain calculations
  // ---------------------------------------------------------------------------

  const calculateEstimate = (item: LensItem<TradesArtifact>) => {
    const d = item.data as unknown as TradesArtifact;
    const lineItems = d.lineItems || [];
    return lineItems.reduce((sum, li) => sum + li.qty * li.unitCost, 0);
  };

  const estBuilderTotals = useMemo(() => {
    const materials = estLineItems.filter(li => li.category === 'materials').reduce((s, li) => s + li.qty * li.unitCost * (1 + li.markupPct / 100), 0);
    const labor = estLineItems.filter(li => li.category === 'labor').reduce((s, li) => s + li.qty * li.unitCost * (1 + li.markupPct / 100), 0);
    const overhead = estLineItems.filter(li => li.category === 'overhead').reduce((s, li) => s + li.qty * li.unitCost * (1 + li.markupPct / 100), 0);
    const profit = estLineItems.filter(li => li.category === 'profit').reduce((s, li) => s + li.qty * li.unitCost * (1 + li.markupPct / 100), 0);
    const subtotal = materials + labor + overhead + profit;
    const tax = subtotal * (estTaxRate / 100);
    const total = subtotal + tax;
    const costBase = estLineItems.reduce((s, li) => s + li.qty * li.unitCost, 0);
    const margin = total > 0 ? ((total - costBase) / total) * 100 : 0;
    return { materials, labor, overhead, profit, subtotal, tax, total, costBase, margin };
  }, [estLineItems, estTaxRate]);

  const changeOrderTotal = useMemo(() => {
    return changeOrders.filter(co => co.status === 'approved').reduce((s, co) => s + co.costImpact, 0);
  }, [changeOrders]);

  const timeTrackingTotals = useMemo(() => {
    const totalHours = timeEntries.reduce((s, te) => s + te.hours, 0);
    const totalCost = timeEntries.reduce((s, te) => s + te.hours * te.rate, 0);
    const overtimeEntries = timeEntries.filter(te => te.isOvertime);
    const overtimeHours = overtimeEntries.reduce((s, te) => s + te.hours, 0);
    return { totalHours, totalCost, overtimeHours, overtimeEntries: overtimeEntries.length };
  }, [timeEntries]);

  const profitLossCalc = useCallback((item: LensItem<TradesArtifact> | null) => {
    if (!item) return { revenue: 0, materialCost: 0, laborCost: 0, overhead: 0, totalCost: 0, profit: 0, margin: 0, budgetVariance: 0, overBudget: false };
    const d = item.data as unknown as TradesArtifact;
    const estimateValue = d.value || 0;
    const coTotal = changeOrders.filter(co => co.status === 'approved').reduce((s, co) => s + co.costImpact, 0);
    const revenue = estimateValue + coTotal;
    const materialCost = matEntries.reduce((s, m) => s + m.qty * m.unitCost, 0);
    const laborCost = timeEntries.reduce((s, te) => s + te.hours * te.rate, 0);
    const overheadPct = d.overheadPct || 10;
    const overhead = (materialCost + laborCost) * (overheadPct / 100);
    const totalCost = materialCost + laborCost + overhead;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const budgetVariance = estimateValue - totalCost;
    const overBudget = totalCost > estimateValue;
    return { revenue, materialCost, laborCost, overhead, totalCost, profit, margin, budgetVariance, overBudget };
  }, [changeOrders, matEntries, timeEntries]);

  // ---------------------------------------------------------------------------
  // Estimate Builder helpers
  // ---------------------------------------------------------------------------

  const addEstLineItem = () => {
    setEstLineItems(prev => [...prev, {
      id: genId(),
      description: '',
      category: 'materials',
      qty: 1,
      unitCost: 0,
      markupPct: 0,
    }]);
  };

  const updateEstLineItem = (id: string, field: keyof EstimateLineItem, value: string | number) => {
    setEstLineItems(prev => prev.map(li => li.id === id ? { ...li, [field]: value } : li));
  };

  const removeEstLineItem = (id: string) => {
    setEstLineItems(prev => prev.filter(li => li.id !== id));
  };

  // ---------------------------------------------------------------------------
  // Change Order helpers
  // ---------------------------------------------------------------------------

  const addChangeOrder = () => {
    if (!coDescription) return;
    setChangeOrders(prev => [...prev, {
      id: genId(),
      description: coDescription,
      costImpact: parseFloat(coCostImpact) || 0,
      status: 'pending',
      dateSubmitted: new Date().toISOString().split('T')[0],
    }]);
    setCoDescription('');
    setCoCostImpact('');
  };

  const updateChangeOrderStatus = (id: string, status: ChangeOrderStatus) => {
    setChangeOrders(prev => prev.map(co => co.id === id ? { ...co, status, dateResolved: status !== 'pending' ? new Date().toISOString().split('T')[0] : undefined } : co));
  };

  // ---------------------------------------------------------------------------
  // Time Tracking helpers
  // ---------------------------------------------------------------------------

  const addTimeEntry = () => {
    if (!teWorker || !teDate || !teClockIn || !teClockOut) return;
    const [inH, inM] = teClockIn.split(':').map(Number);
    const [outH, outM] = teClockOut.split(':').map(Number);
    const hours = Math.max(0, (outH + outM / 60) - (inH + inM / 60));
    const isOvertime = hours > 8;
    setTimeEntries(prev => [...prev, {
      id: genId(),
      worker: teWorker,
      date: teDate,
      clockIn: teClockIn,
      clockOut: teClockOut,
      hours: Math.round(hours * 100) / 100,
      rate: parseFloat(teRate) || 45,
      isOvertime,
    }]);
    setTeClockIn('');
    setTeClockOut('');
  };

  // ---------------------------------------------------------------------------
  // Phase / Timeline helpers
  // ---------------------------------------------------------------------------

  const addPhase = () => {
    if (!phaseName || !phaseStart || !phaseEnd) return;
    setPhases(prev => [...prev, {
      id: genId(),
      name: phaseName,
      startDate: phaseStart,
      endDate: phaseEnd,
      status: 'not_started',
    }]);
    setPhaseName('');
    setPhaseStart('');
    setPhaseEnd('');
  };

  const updatePhaseStatus = (id: string, status: PhaseStatus) => {
    setPhases(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  };

  const toggleMilestone = (id: string) => {
    setPhases(prev => prev.map(p => p.id === id ? { ...p, isMilestone: !p.isMilestone } : p));
  };

  // ---------------------------------------------------------------------------
  // Materials Tracker helpers
  // ---------------------------------------------------------------------------

  const addMaterialEntry = () => {
    if (!matName) return;
    setMatEntries(prev => [...prev, {
      id: genId(),
      name: matName,
      supplier: matSupplier,
      qty: parseFloat(matQty) || 1,
      unit: matUnit,
      unitCost: parseFloat(matUnitCost) || 0,
      deliveryStatus: 'ordered',
    }]);
    setMatName('');
    setMatSupplier('');
    setMatQty('');
    setMatUnitCost('');
  };

  const updateMaterialStatus = (id: string, deliveryStatus: MaterialEntry['deliveryStatus']) => {
    setMatEntries(prev => prev.map(m => m.id === id ? { ...m, deliveryStatus } : m));
  };

  // ---------------------------------------------------------------------------
  // Photo Documentation helpers
  // ---------------------------------------------------------------------------

  const addPhotoEntry = () => {
    setPhotoEntries(prev => [...prev, {
      id: genId(),
      phase: photoPhase,
      date: new Date().toISOString().split('T')[0],
      location: photoLocation || 'Unspecified',
      notes: photoNotes,
      filename: `photo_${Date.now()}.jpg`,
    }]);
    setPhotoNotes('');
    setPhotoLocation('');
  };

  // ---------------------------------------------------------------------------
  // Dashboard metrics
  // ---------------------------------------------------------------------------

  const dashboardMetrics = useMemo(() => {
    const allData = items.map(i => i.data as unknown as TradesArtifact);
    const totalValue = allData.reduce((s, d) => s + (d.value || 0), 0);
    const byStatus: Record<string, number> = {};
    allData.forEach(d => { byStatus[d.status] = (byStatus[d.status] || 0) + 1; });
    const activeJobs = allData.filter(d => d.status === 'in_progress').length;
    const pendingInspections = allData.filter(d => d.status === 'inspection').length;
    const unpaidInvoices = allData.filter(d => d.status === 'invoiced').reduce((s, d) => s + (d.value || 0), 0);
    const completedValue = allData.filter(d => d.status === 'completed' || d.status === 'paid').reduce((s, d) => s + (d.value || 0), 0);
    const paidValue = allData.filter(d => d.status === 'paid').reduce((s, d) => s + (d.value || 0), 0);

    // Aging receivables simulation
    const invoicedItems = allData.filter(d => d.status === 'invoiced');
    const aging30 = invoicedItems.slice(0, Math.ceil(invoicedItems.length * 0.5)).reduce((s, d) => s + (d.value || 0), 0);
    const aging60 = invoicedItems.slice(Math.ceil(invoicedItems.length * 0.5), Math.ceil(invoicedItems.length * 0.8)).reduce((s, d) => s + (d.value || 0), 0);
    const aging90 = invoicedItems.slice(Math.ceil(invoicedItems.length * 0.8)).reduce((s, d) => s + (d.value || 0), 0);

    // Crew utilization
    const totalCrewSlots = Math.max(activeJobs * 3, 1);
    const assignedCrew = allData.filter(d => d.foremanAssigned).length;
    const crewUtilization = Math.min(100, Math.round((assignedCrew / totalCrewSlots) * 100));

    return {
      totalValue, byStatus, activeJobs, pendingInspections, unpaidInvoices,
      completedValue, paidValue, total: items.length,
      aging30, aging60, aging90, crewUtilization, assignedCrew, totalCrewSlots,
    };
  }, [items]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderStatusBadge = (status: Status) => {
    const cfg = STATUS_CONFIG[status];
    return <span className={ds.badge(cfg.color)}>{cfg.label}</span>;
  };

  const renderPhaseStatusBadge = (status: PhaseStatus) => {
    const cfg = PHASE_STATUS_CONFIG[status];
    return <span className={ds.badge(cfg.color)}>{cfg.label}</span>;
  };

  const fmtCurrency = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ---------------------------------------------------------------------------
  // Sub-view: Job Timeline / Gantt
  // ---------------------------------------------------------------------------

  const renderTimeline = () => {
    const sortedPhases = [...phases].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const minDate = sortedPhases.length > 0 ? new Date(sortedPhases[0].startDate) : new Date();
    const maxDate = sortedPhases.length > 0 ? new Date(sortedPhases[sortedPhases.length - 1].endDate) : new Date();
    const totalDays = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)));

    return (
      <div className="space-y-4">
        <div className={cn(ds.panel, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <GitBranch className="w-5 h-5 text-neon-cyan" /> Job Timeline / Gantt
            </h3>
            <span className={ds.textMuted}>
              {selectedJob ? selectedJob.title : 'Select a job to view timeline'}
            </span>
          </div>

          {/* Add phase form */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className={ds.label}>Phase Name</label>
              <input value={phaseName} onChange={e => setPhaseName(e.target.value)} className={ds.input} placeholder="e.g. Rough Framing" />
            </div>
            <div className="w-40">
              <label className={ds.label}>Start</label>
              <input type="date" value={phaseStart} onChange={e => setPhaseStart(e.target.value)} className={ds.input} />
            </div>
            <div className="w-40">
              <label className={ds.label}>End</label>
              <input type="date" value={phaseEnd} onChange={e => setPhaseEnd(e.target.value)} className={ds.input} />
            </div>
            <button onClick={addPhase} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> Add Phase
            </button>
          </div>

          {/* Gantt grid */}
          {sortedPhases.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No phases added yet. Add phases to see the timeline.</p>
            </div>
          ) : (
            <div className="space-y-1 overflow-x-auto">
              {/* Header row with month markers */}
              <div className="flex items-center gap-2 mb-2 min-w-[700px]">
                <div className="w-48 shrink-0" />
                <div className="w-24 shrink-0 text-center">
                  <span className={ds.textMuted}>Status</span>
                </div>
                <div className="flex-1 relative h-6">
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: Math.min(totalDays, 60) }, (_, i) => {
                      const d = new Date(minDate);
                      d.setDate(d.getDate() + i);
                      const isWeekStart = d.getDay() === 1;
                      return isWeekStart ? (
                        <div key={i} className="absolute text-[10px] text-gray-500" style={{ left: `${(i / totalDays) * 100}%` }}>
                          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>
              </div>

              {/* Phase rows */}
              {sortedPhases.map(phase => {
                const phaseStart2 = new Date(phase.startDate);
                const phaseEnd2 = new Date(phase.endDate);
                const leftPct = Math.max(0, ((phaseStart2.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) / totalDays * 100);
                const widthPct = Math.max(2, ((phaseEnd2.getTime() - phaseStart2.getTime()) / (1000 * 60 * 60 * 24)) / totalDays * 100);
                const pCfg = PHASE_STATUS_CONFIG[phase.status];

                return (
                  <div key={phase.id} className="flex items-center gap-2 min-w-[700px] group">
                    <div className="w-48 shrink-0 flex items-center gap-2">
                      {phase.isMilestone && <Milestone className="w-3 h-3 text-yellow-400" />}
                      <span className="text-sm text-white truncate">{phase.name}</span>
                      {renderPhaseStatusBadge(phase.status)}
                    </div>
                    <div className="w-24 shrink-0">
                      <select
                        value={phase.status}
                        onChange={e => updatePhaseStatus(phase.id, e.target.value as PhaseStatus)}
                        className={cn(ds.select, 'text-xs py-1 px-2')}
                      >
                        {Object.entries(PHASE_STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 relative h-8 bg-lattice-surface rounded">
                      <div
                        className={cn('absolute top-1 bottom-1 rounded transition-all', pCfg.bgClass)}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      >
                        <span className="text-[10px] text-white px-1 truncate leading-6">
                          {phase.startDate} - {phase.endDate}
                        </span>
                      </div>
                      {/* Dependency connector visual hint */}
                      {phase.dependsOn && (
                        <div className="absolute left-0 top-1/2 w-2 h-px bg-neon-cyan" />
                      )}
                    </div>
                    <button onClick={() => toggleMilestone(phase.id)} className={cn(ds.btnSmall, 'text-gray-500 hover:text-yellow-400 opacity-0 group-hover:opacity-100')}>
                      <Star className="w-3 h-3" />
                    </button>
                    <button onClick={() => setPhases(prev => prev.filter(p => p.id !== phase.id))} className={cn(ds.btnSmall, 'text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100')}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Phase summary */}
          {sortedPhases.length > 0 && (
            <div className="flex items-center gap-4 pt-3 border-t border-lattice-border">
              {Object.entries(PHASE_STATUS_CONFIG).map(([key, cfg]) => {
                const count = sortedPhases.filter(p => p.status === key).length;
                return (
                  <div key={key} className="flex items-center gap-1">
                    <div className={cn('w-3 h-3 rounded-full', cfg.bgClass)} />
                    <span className={ds.textMuted}>{cfg.label}: {count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Sub-view: Estimate Builder
  // ---------------------------------------------------------------------------

  const renderEstimateBuilder = () => (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-4')}>
        <div className="flex items-center justify-between">
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Receipt className="w-5 h-5 text-green-400" /> Estimate Builder
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={addEstLineItem} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> Add Line Item
            </button>
            <button onClick={() => { /* Convert to job */ }} className={ds.btnSecondary}>
              <ArrowRight className="w-4 h-4" /> Convert to Job
            </button>
          </div>
        </div>

        {/* Line items table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lattice-border">
                <th className="text-left py-2 px-2 text-gray-400 font-medium">Description</th>
                <th className="text-left py-2 px-2 text-gray-400 font-medium w-28">Category</th>
                <th className="text-right py-2 px-2 text-gray-400 font-medium w-20">Qty</th>
                <th className="text-right py-2 px-2 text-gray-400 font-medium w-28">Unit Cost</th>
                <th className="text-right py-2 px-2 text-gray-400 font-medium w-24">Markup %</th>
                <th className="text-right py-2 px-2 text-gray-400 font-medium w-28">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {estLineItems.map(li => {
                const lineTotal = li.qty * li.unitCost * (1 + li.markupPct / 100);
                return (
                  <tr key={li.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30">
                    <td className="py-1 px-2">
                      <input
                        value={li.description}
                        onChange={e => updateEstLineItem(li.id, 'description', e.target.value)}
                        className={cn(ds.input, 'text-sm py-1')}
                        placeholder="Item description"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <select
                        value={li.category}
                        onChange={e => updateEstLineItem(li.id, 'category', e.target.value)}
                        className={cn(ds.select, 'text-sm py-1')}
                      >
                        <option value="materials">Materials</option>
                        <option value="labor">Labor</option>
                        <option value="overhead">Overhead</option>
                        <option value="profit">Profit</option>
                      </select>
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={li.qty}
                        onChange={e => updateEstLineItem(li.id, 'qty', parseFloat(e.target.value) || 0)}
                        className={cn(ds.input, 'text-sm py-1 text-right')}
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={li.unitCost}
                        onChange={e => updateEstLineItem(li.id, 'unitCost', parseFloat(e.target.value) || 0)}
                        className={cn(ds.input, 'text-sm py-1 text-right')}
                        step="0.01"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={li.markupPct}
                        onChange={e => updateEstLineItem(li.id, 'markupPct', parseFloat(e.target.value) || 0)}
                        className={cn(ds.input, 'text-sm py-1 text-right')}
                      />
                    </td>
                    <td className="py-1 px-2 text-right">
                      <span className={ds.textMono}>{fmtCurrency(lineTotal)}</span>
                    </td>
                    <td className="py-1 px-2">
                      <button onClick={() => removeEstLineItem(li.id)} className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {estLineItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center">
                    <p className={ds.textMuted}>No line items yet. Click &quot;Add Line Item&quot; to start building your estimate.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals section */}
        {estLineItems.length > 0 ? (
          <div className="flex justify-end">
            <div className="w-80 space-y-2">
              <div className="flex items-center justify-between">
                <span className={ds.textMuted}>Materials</span>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.materials)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={ds.textMuted}>Labor</span>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.labor)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={ds.textMuted}>Overhead</span>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.overhead)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={ds.textMuted}>Profit</span>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.profit)}</span>
              </div>
              <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                <span className="text-gray-300 font-medium">Subtotal</span>
                <span className={cn(ds.textMono, 'text-white')}>{fmtCurrency(estBuilderTotals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={ds.textMuted}>Tax</span>
                  <input
                    type="number"
                    value={estTaxRate}
                    onChange={e => setEstTaxRate(parseFloat(e.target.value) || 0)}
                    className={cn(ds.input, 'w-20 text-xs py-1 text-right')}
                    step="0.01"
                  />
                  <span className={ds.textMuted}>%</span>
                </div>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.tax)}</span>
              </div>
              <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                <span className="text-lg font-bold text-white">Total</span>
                <span className="text-lg font-bold text-neon-green">{fmtCurrency(estBuilderTotals.total)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={ds.textMuted}>Cost Basis</span>
                <span className={ds.textMono}>{fmtCurrency(estBuilderTotals.costBase)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={ds.textMuted}>Margin</span>
                <span className={cn(ds.textMono, estBuilderTotals.margin >= 20 ? 'text-green-400' : 'text-orange-400')}>
                  {estBuilderTotals.margin.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
            <p>No estimate line items yet. Add items to build your estimate.</p>
          </div>
        )}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Sub-view: Change Orders
  // ---------------------------------------------------------------------------

  const renderChangeOrders = () => {
    const originalEstimate = selectedJob ? (selectedJob.data as unknown as TradesArtifact).value || 0 : 0;
    const revisedTotal = originalEstimate + changeOrderTotal;

    return (
      <div className="space-y-4">
        <div className={cn(ds.panel, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <FileCheck className="w-5 h-5 text-purple-400" /> Change Order Manager
            </h3>
            <span className={ds.textMuted}>
              {selectedJob ? selectedJob.title : 'Select a job first'}
            </span>
          </div>

          {/* Summary cards */}
          <div className={ds.grid3}>
            <div className="p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Original Estimate</p>
              <p className="text-xl font-bold">{fmtCurrency(originalEstimate)}</p>
            </div>
            <div className="p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Change Order Total</p>
              <p className={cn('text-xl font-bold', changeOrderTotal >= 0 ? 'text-orange-400' : 'text-green-400')}>
                {changeOrderTotal >= 0 ? '+' : ''}{fmtCurrency(changeOrderTotal)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Revised Total</p>
              <p className="text-xl font-bold text-neon-green">{fmtCurrency(revisedTotal)}</p>
            </div>
          </div>

          {/* Add change order */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className={ds.label}>Description</label>
              <input value={coDescription} onChange={e => setCoDescription(e.target.value)} className={ds.input} placeholder="Client requested additional outlet..." />
            </div>
            <div className="w-40">
              <label className={ds.label}>Cost Impact ($)</label>
              <input type="number" value={coCostImpact} onChange={e => setCoCostImpact(e.target.value)} className={ds.input} placeholder="0.00" step="0.01" />
            </div>
            <button onClick={addChangeOrder} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> Add CO
            </button>
          </div>

          {/* Change orders list */}
          {changeOrders.length === 0 ? (
            <div className="text-center py-8">
              <FileCheck className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No change orders. They will appear here when added.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {changeOrders.map(co => (
                <div key={co.id} className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{co.description}</p>
                    <p className={ds.textMuted}>Submitted: {co.dateSubmitted} {co.dateResolved ? `| Resolved: ${co.dateResolved}` : ''}</p>
                  </div>
                  <span className={cn(ds.textMono, co.costImpact >= 0 ? 'text-orange-400' : 'text-green-400')}>
                    {co.costImpact >= 0 ? '+' : ''}{fmtCurrency(co.costImpact)}
                  </span>
                  <select
                    value={co.status}
                    onChange={e => updateChangeOrderStatus(co.id, e.target.value as ChangeOrderStatus)}
                    className={cn(ds.select, 'w-28 text-xs py-1')}
                  >
                    {Object.entries(CHANGE_ORDER_STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                  <span className={ds.badge(CHANGE_ORDER_STATUS_CONFIG[co.status].color)}>
                    {CHANGE_ORDER_STATUS_CONFIG[co.status].label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Sub-view: Time Tracking
  // ---------------------------------------------------------------------------

  const renderTimeTracking = () => (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-4')}>
        <div className="flex items-center justify-between">
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Clock className="w-5 h-5 text-blue-400" /> Time Tracking
          </h3>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className={ds.textMuted}>Total Hours</p>
              <p className={cn(ds.textMono, 'text-lg text-white')}>{timeTrackingTotals.totalHours.toFixed(1)}h</p>
            </div>
            <div className="text-right">
              <p className={ds.textMuted}>Labor Cost</p>
              <p className={cn(ds.textMono, 'text-lg text-neon-green')}>{fmtCurrency(timeTrackingTotals.totalCost)}</p>
            </div>
            {timeTrackingTotals.overtimeEntries > 0 && (
              <div className="text-right">
                <p className={ds.textMuted}>Overtime</p>
                <p className={cn(ds.textMono, 'text-lg text-red-400')}>{timeTrackingTotals.overtimeHours.toFixed(1)}h</p>
              </div>
            )}
          </div>
        </div>

        {/* Clock in/out form */}
        <div className="flex items-end gap-3 flex-wrap p-3 rounded-lg bg-lattice-elevated/30">
          <div className="w-40">
            <label className={ds.label}>Worker</label>
            <input value={teWorker} onChange={e => setTeWorker(e.target.value)} className={ds.input} placeholder="Name" />
          </div>
          <div className="w-36">
            <label className={ds.label}>Date</label>
            <input type="date" value={teDate} onChange={e => setTeDate(e.target.value)} className={ds.input} />
          </div>
          <div className="w-28">
            <label className={ds.label}>Clock In</label>
            <input type="time" value={teClockIn} onChange={e => setTeClockIn(e.target.value)} className={ds.input} />
          </div>
          <div className="w-28">
            <label className={ds.label}>Clock Out</label>
            <input type="time" value={teClockOut} onChange={e => setTeClockOut(e.target.value)} className={ds.input} />
          </div>
          <div className="w-24">
            <label className={ds.label}>Rate ($/hr)</label>
            <input type="number" value={teRate} onChange={e => setTeRate(e.target.value)} className={ds.input} step="0.50" />
          </div>
          <button onClick={addTimeEntry} className={ds.btnPrimary}>
            <PlayCircle className="w-4 h-4" /> Log Time
          </button>
        </div>

        {/* Time entries table */}
        {timeEntries.length === 0 ? (
          <div className="text-center py-8">
            <Timer className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No time entries logged yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Worker</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Date</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">In</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Out</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Hours</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Rate</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Cost</th>
                  <th className="text-center py-2 px-3 text-gray-400 font-medium">OT</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {timeEntries.map(te => (
                  <tr key={te.id} className={cn('border-b border-lattice-border/50', te.isOvertime && 'bg-red-500/5')}>
                    <td className="py-2 px-3 text-white">{te.worker}</td>
                    <td className="py-2 px-3 text-gray-300">{te.date}</td>
                    <td className="py-2 px-3 text-gray-300">{te.clockIn}</td>
                    <td className="py-2 px-3 text-gray-300">{te.clockOut}</td>
                    <td className={cn('py-2 px-3 text-right', ds.textMono)}>{te.hours.toFixed(2)}</td>
                    <td className={cn('py-2 px-3 text-right', ds.textMono)}>{fmtCurrency(te.rate)}</td>
                    <td className={cn('py-2 px-3 text-right', ds.textMono, 'text-green-400')}>{fmtCurrency(te.hours * te.rate)}</td>
                    <td className="py-2 px-3 text-center">
                      {te.isOvertime && <AlertTriangle className="w-4 h-4 text-red-400 mx-auto" />}
                    </td>
                    <td className="py-2 px-3">
                      <button onClick={() => setTimeEntries(prev => prev.filter(t => t.id !== te.id))} className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-lattice-border">
                  <td colSpan={4} className="py-2 px-3 text-white font-bold">Totals</td>
                  <td className={cn('py-2 px-3 text-right font-bold', ds.textMono)}>{timeTrackingTotals.totalHours.toFixed(2)}</td>
                  <td className="py-2 px-3" />
                  <td className={cn('py-2 px-3 text-right font-bold text-neon-green', ds.textMono)}>{fmtCurrency(timeTrackingTotals.totalCost)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Sub-view: Profit & Loss
  // ---------------------------------------------------------------------------

  const renderProfitLoss = () => {
    const pl = profitLossCalc(selectedJob);

    return (
      <div className="space-y-4">
        <div className={cn(ds.panel, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <PieChart className="w-5 h-5 text-emerald-400" /> Profit & Loss
            </h3>
            <span className={ds.textMuted}>
              {selectedJob ? selectedJob.title : 'Select a job to view P&L'}
            </span>
          </div>

          {!selectedJob ? (
            <div className="text-center py-8">
              <PieChart className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>Select a job from the Jobs tab to view Profit & Loss analysis.</p>
            </div>
          ) : (
            <>
              {/* Over budget warning */}
              {pl.overBudget && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-red-400 font-medium">Budget Exceeded</p>
                    <p className="text-red-400/70 text-sm">
                      Actual costs ({fmtCurrency(pl.totalCost)}) exceed the original estimate ({fmtCurrency((selectedJob.data as unknown as TradesArtifact).value || 0)}) by {fmtCurrency(Math.abs(pl.budgetVariance))}.
                    </p>
                  </div>
                </div>
              )}

              {/* P&L breakdown */}
              <div className={ds.grid2}>
                {/* Revenue side */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-green-400 uppercase tracking-wider flex items-center gap-2">
                    <ArrowUp className="w-4 h-4" /> Revenue
                  </h4>
                  <div className="space-y-2 p-3 rounded-lg bg-lattice-elevated/30">
                    <div className="flex items-center justify-between">
                      <span className={ds.textMuted}>Original Estimate</span>
                      <span className={ds.textMono}>{fmtCurrency((selectedJob.data as unknown as TradesArtifact).value || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={ds.textMuted}>Approved Change Orders</span>
                      <span className={cn(ds.textMono, 'text-orange-400')}>+{fmtCurrency(changeOrderTotal)}</span>
                    </div>
                    <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                      <span className="text-white font-medium">Total Revenue</span>
                      <span className="text-green-400 font-bold text-lg">{fmtCurrency(pl.revenue)}</span>
                    </div>
                  </div>
                </div>

                {/* Cost side */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wider flex items-center gap-2">
                    <ArrowDown className="w-4 h-4" /> Costs
                  </h4>
                  <div className="space-y-2 p-3 rounded-lg bg-lattice-elevated/30">
                    <div className="flex items-center justify-between">
                      <span className={ds.textMuted}>Materials</span>
                      <span className={ds.textMono}>{fmtCurrency(pl.materialCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={ds.textMuted}>Labor</span>
                      <span className={ds.textMono}>{fmtCurrency(pl.laborCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={ds.textMuted}>Overhead ({(selectedJob.data as unknown as TradesArtifact).overheadPct || 10}%)</span>
                      <span className={ds.textMono}>{fmtCurrency(pl.overhead)}</span>
                    </div>
                    <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                      <span className="text-white font-medium">Total Costs</span>
                      <span className="text-red-400 font-bold text-lg">{fmtCurrency(pl.totalCost)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Profit card */}
              <div className={cn('p-4 rounded-lg border', pl.profit >= 0 ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30')}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400 uppercase tracking-wider">Net Profit</p>
                    <p className={cn('text-3xl font-bold', pl.profit >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {fmtCurrency(pl.profit)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-400 uppercase tracking-wider">Margin</p>
                    <p className={cn('text-3xl font-bold', pl.margin >= 20 ? 'text-green-400' : pl.margin >= 10 ? 'text-yellow-400' : 'text-red-400')}>
                      {pl.margin.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Budget vs Actual */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-300">Budget vs Actual</h4>
                <div className="relative h-6 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className={cn('absolute inset-y-0 left-0 rounded-full transition-all', pl.overBudget ? 'bg-red-500/60' : 'bg-green-500/40')}
                    style={{ width: `${Math.min(100, (pl.totalCost / Math.max(pl.revenue, 1)) * 100)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                    {fmtCurrency(pl.totalCost)} / {fmtCurrency(pl.revenue)}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={ds.textMuted}>
                    Budget Variance: <span className={cn(ds.textMono, pl.budgetVariance >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {pl.budgetVariance >= 0 ? '+' : ''}{fmtCurrency(pl.budgetVariance)}
                    </span>
                  </span>
                  <span className={ds.textMuted}>
                    {((pl.totalCost / Math.max(pl.revenue, 1)) * 100).toFixed(0)}% of budget used
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Sub-view: Materials Tracker
  // ---------------------------------------------------------------------------

  const renderMaterialsTracker = () => {
    const totalMaterialCost = matEntries.reduce((s, m) => s + m.qty * m.unitCost, 0);
    const supplierGroups: Record<string, MaterialEntry[]> = {};
    matEntries.forEach(m => {
      const key = m.supplier || 'Unspecified';
      if (!supplierGroups[key]) supplierGroups[key] = [];
      supplierGroups[key].push(m);
    });

    const deliveryStatusConfig: Record<string, { label: string; color: string }> = {
      ordered: { label: 'Ordered', color: 'yellow-400' },
      shipped: { label: 'Shipped', color: 'blue-400' },
      delivered: { label: 'Delivered', color: 'green-400' },
      backordered: { label: 'Backordered', color: 'red-400' },
    };

    return (
      <div className="space-y-4">
        <div className={cn(ds.panel, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Package className="w-5 h-5 text-orange-400" /> Materials Tracker
            </h3>
            <div className="flex items-center gap-3">
              <span className={ds.textMuted}>Total:</span>
              <span className="text-lg font-bold text-neon-green">{fmtCurrency(totalMaterialCost)}</span>
            </div>
          </div>

          {/* Add material form */}
          <div className="flex items-end gap-3 flex-wrap p-3 rounded-lg bg-lattice-elevated/30">
            <div className="flex-1 min-w-[160px]">
              <label className={ds.label}>Material</label>
              <input value={matName} onChange={e => setMatName(e.target.value)} className={ds.input} placeholder="e.g. 2x4 Lumber" />
            </div>
            <div className="w-36">
              <label className={ds.label}>Supplier</label>
              <input value={matSupplier} onChange={e => setMatSupplier(e.target.value)} className={ds.input} placeholder="Home Depot" />
            </div>
            <div className="w-20">
              <label className={ds.label}>Qty</label>
              <input type="number" value={matQty} onChange={e => setMatQty(e.target.value)} className={ds.input} />
            </div>
            <div className="w-20">
              <label className={ds.label}>Unit</label>
              <select value={matUnit} onChange={e => setMatUnit(e.target.value)} className={ds.select}>
                <option value="ea">ea</option>
                <option value="ft">ft</option>
                <option value="yd">yd</option>
                <option value="lb">lb</option>
                <option value="gal">gal</option>
                <option value="box">box</option>
                <option value="roll">roll</option>
                <option value="bag">bag</option>
              </select>
            </div>
            <div className="w-28">
              <label className={ds.label}>Unit Cost ($)</label>
              <input type="number" value={matUnitCost} onChange={e => setMatUnitCost(e.target.value)} className={ds.input} step="0.01" />
            </div>
            <button onClick={addMaterialEntry} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          {/* Materials table */}
          {matEntries.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No materials tracked yet. Add materials to begin tracking.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-lattice-border">
                    <th className="text-left py-2 px-3 text-gray-400 font-medium">Material</th>
                    <th className="text-left py-2 px-3 text-gray-400 font-medium">Supplier</th>
                    <th className="text-right py-2 px-3 text-gray-400 font-medium">Qty</th>
                    <th className="text-left py-2 px-3 text-gray-400 font-medium">Unit</th>
                    <th className="text-right py-2 px-3 text-gray-400 font-medium">Unit Cost</th>
                    <th className="text-right py-2 px-3 text-gray-400 font-medium">Total</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">Delivery</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {matEntries.map(m => (
                    <tr key={m.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30">
                      <td className="py-2 px-3 text-white">{m.name}</td>
                      <td className="py-2 px-3 text-gray-300">{m.supplier || '-'}</td>
                      <td className={cn('py-2 px-3 text-right', ds.textMono)}>{m.qty}</td>
                      <td className="py-2 px-3 text-gray-400">{m.unit}</td>
                      <td className={cn('py-2 px-3 text-right', ds.textMono)}>{fmtCurrency(m.unitCost)}</td>
                      <td className={cn('py-2 px-3 text-right', ds.textMono, 'text-green-400')}>{fmtCurrency(m.qty * m.unitCost)}</td>
                      <td className="py-2 px-3 text-center">
                        <select
                          value={m.deliveryStatus}
                          onChange={e => updateMaterialStatus(m.id, e.target.value as MaterialEntry['deliveryStatus'])}
                          className={cn(ds.select, 'text-xs py-1 w-28')}
                        >
                          {Object.entries(deliveryStatusConfig).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <button onClick={() => setMatEntries(prev => prev.filter(x => x.id !== m.id))} className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Supplier comparison */}
          {Object.keys(supplierGroups).length > 1 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Building className="w-4 h-4" /> Supplier Breakdown
              </h4>
              <div className={ds.grid3}>
                {Object.entries(supplierGroups).map(([supplier, materials]) => {
                  const supplierTotal = materials.reduce((s, m) => s + m.qty * m.unitCost, 0);
                  return (
                    <div key={supplier} className="p-3 rounded-lg bg-lattice-elevated/30">
                      <p className="text-white font-medium">{supplier}</p>
                      <p className={ds.textMuted}>{materials.length} items</p>
                      <p className={cn(ds.textMono, 'text-green-400 mt-1')}>{fmtCurrency(supplierTotal)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PO generation hint */}
          {matEntries.length > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-lattice-border">
              <button onClick={() => handleAction('generatePO')} className={ds.btnSecondary}>
                <Printer className="w-4 h-4" /> Generate Purchase Order
              </button>
              <span className={ds.textMuted}>{matEntries.filter(m => m.deliveryStatus === 'ordered').length} items pending delivery</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Sub-view: Photo Documentation
  // ---------------------------------------------------------------------------

  const renderPhotoDocumentation = () => {
    const phaseGroups = {
      before: photoEntries.filter(p => p.phase === 'before'),
      during: photoEntries.filter(p => p.phase === 'during'),
      after: photoEntries.filter(p => p.phase === 'after'),
    };

    return (
      <div className="space-y-4">
        <div className={cn(ds.panel, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Camera className="w-5 h-5 text-pink-400" /> Photo Documentation
            </h3>
            <span className={ds.textMuted}>{photoEntries.length} entries</span>
          </div>

          {/* Add photo entry form */}
          <div className="flex items-end gap-3 flex-wrap p-3 rounded-lg bg-lattice-elevated/30">
            <div className="w-32">
              <label className={ds.label}>Phase</label>
              <select value={photoPhase} onChange={e => setPhotoPhase(e.target.value as 'before' | 'during' | 'after')} className={ds.select}>
                <option value="before">Before</option>
                <option value="during">During</option>
                <option value="after">After</option>
              </select>
            </div>
            <div className="w-40">
              <label className={ds.label}>Location</label>
              <input value={photoLocation} onChange={e => setPhotoLocation(e.target.value)} className={ds.input} placeholder="e.g. Kitchen" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className={ds.label}>Notes</label>
              <input value={photoNotes} onChange={e => setPhotoNotes(e.target.value)} className={ds.input} placeholder="Description of what was documented..." />
            </div>
            <button onClick={addPhotoEntry} className={ds.btnPrimary}>
              <Camera className="w-4 h-4" /> Log Entry
            </button>
          </div>

          {/* Photo entries by phase */}
          {photoEntries.length === 0 ? (
            <div className="text-center py-8">
              <Camera className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No photo documentation entries yet. Log entries as you document the project.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(['before', 'during', 'after'] as const).map(phase => {
                const entries = phaseGroups[phase];
                if (entries.length === 0) return null;
                const phaseConfig = {
                  before: { label: 'Before', color: 'text-blue-400', icon: Eye },
                  during: { label: 'During', color: 'text-yellow-400', icon: Activity },
                  after: { label: 'After', color: 'text-green-400', icon: CheckCircle2 },
                };
                const cfg = phaseConfig[phase];
                return (
                  <div key={phase}>
                    <h4 className={cn('text-sm font-semibold mb-2 flex items-center gap-2', cfg.color)}>
                      <cfg.icon className="w-4 h-4" /> {cfg.label} ({entries.length})
                    </h4>
                    <div className={ds.grid3}>
                      {entries.map(entry => (
                        <div key={entry.id} className="p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 group">
                          {/* Placeholder for actual photo */}
                          <div className="aspect-video rounded-lg bg-lattice-surface border border-lattice-border flex items-center justify-center mb-2">
                            <Camera className="w-8 h-8 text-gray-600" />
                          </div>
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm text-white">{entry.location}</p>
                              <p className={ds.textMuted}>{entry.date}</p>
                              {entry.notes && <p className="text-xs text-gray-500 mt-1">{entry.notes}</p>}
                            </div>
                            <button onClick={() => setPhotoEntries(prev => prev.filter(p => p.id !== entry.id))} className={cn(ds.btnSmall, 'text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100')}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className={cn(ds.textMono, 'text-[10px] text-gray-600 mt-1')}>{entry.filename}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Artifact library (original, enhanced)
  // ---------------------------------------------------------------------------

  const renderLibrary = () => (
    <div className="space-y-4">
      {/* Search & filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className={cn(ds.input, 'pl-10')}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as Status | 'all')}
          className={cn(ds.select, 'w-44')}
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
        <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); }} className={ds.btnGhost}>
          <Filter className="w-4 h-4" /> Clear
        </button>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New {activeArtifactType}
        </button>
      </div>

      {/* Items grid */}
      {isLoading ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <p className={ds.textMuted}>Loading {activeTab}...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeTab} found. Create one to get started.</p>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item, index) => {
            const d = item.data as unknown as TradesArtifact;
            const isSelected = selectedJobId === item.id;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
                className={cn(ds.panelHover, isSelected && 'border-neon-cyan ring-1 ring-neon-cyan/30')}
                onClick={() => openEdit(item)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className={ds.heading3}>{item.title}</h3>
                  {renderStatusBadge(d.status)}
                </div>
                {d.client && (
                  <p className={cn(ds.textMuted, 'flex items-center gap-1 mb-1')}>
                    <Users className="w-3 h-3" /> {d.client}
                  </p>
                )}
                {d.address && (
                  <p className={cn(ds.textMuted, 'flex items-center gap-1 mb-1')}>
                    <MapPin className="w-3 h-3" /> {d.address}
                  </p>
                )}
                {d.trade && (
                  <p className={cn(ds.textMuted, 'flex items-center gap-1 mb-1')}>
                    <Wrench className="w-3 h-3" /> {d.trade}
                  </p>
                )}
                {d.foremanAssigned && (
                  <p className={cn(ds.textMuted, 'flex items-center gap-1 mb-1')}>
                    <HardHat className="w-3 h-3" /> {d.foremanAssigned}
                  </p>
                )}
                {d.value > 0 && (
                  <p className="text-lg font-bold text-neon-green mt-2">
                    ${d.value.toLocaleString()}
                  </p>
                )}
                {d.startDate && (
                  <p className={cn(ds.textMuted, 'flex items-center gap-1 mt-1')}>
                    <Calendar className="w-3 h-3" /> {d.startDate}{d.endDate ? ` - ${d.endDate}` : ''}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
                  <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={cn(ds.btnSmall, 'text-gray-400 hover:text-white')}>
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(item.id); }} className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}>
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                  {activeTab === 'jobs' && (
                    <button onClick={e => { e.stopPropagation(); selectJobForDetail(item); }} className={cn(ds.btnSmall, 'text-neon-cyan hover:text-white ml-auto')}>
                      <Layers className="w-3 h-3" /> Detail
                    </button>
                  )}
                  {d.type === 'Estimate' && (
                    <span className={cn(ds.textMono, 'ml-auto text-gray-400')}>
                      Est: ${calculateEstimate(item).toLocaleString()}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Editor modal
  // ---------------------------------------------------------------------------

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className={ds.modalBackdrop} onClick={() => setEditorOpen(false)}>
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-lattice-border">
              <h2 className={ds.heading2}>
                {editingItem ? `Edit ${activeArtifactType}` : `New ${activeArtifactType}`}
              </h2>
              <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={ds.label}>Name / Title</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} className={ds.input} placeholder="Job name..." />
              </div>
              <div>
                <label className={ds.label}>Description</label>
                <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={3} className={ds.textarea} placeholder="Details..." />
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Client</label>
                  <input value={formClient} onChange={e => setFormClient(e.target.value)} className={ds.input} placeholder="Client name" />
                </div>
                <div>
                  <label className={ds.label}>Phone</label>
                  <input value={formPhone} onChange={e => setFormPhone(e.target.value)} className={ds.input} placeholder="555-0100" />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Email</label>
                  <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} className={ds.input} placeholder="client@example.com" />
                </div>
                <div>
                  <label className={ds.label}>Foreman</label>
                  <input value={formForeman} onChange={e => setFormForeman(e.target.value)} className={ds.input} placeholder="Foreman name" />
                </div>
              </div>
              <div>
                <label className={ds.label}>Address</label>
                <input value={formAddress} onChange={e => setFormAddress(e.target.value)} className={ds.input} placeholder="Street address" />
              </div>
              <div className={ds.grid3}>
                <div>
                  <label className={ds.label}>Status</label>
                  <select value={formStatus} onChange={e => setFormStatus(e.target.value as Status)} className={ds.select}>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Trade</label>
                  <select value={formTrade} onChange={e => setFormTrade(e.target.value)} className={ds.select}>
                    {TRADES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Value ($)</label>
                  <input type="number" value={formValue} onChange={e => setFormValue(e.target.value)} className={ds.input} placeholder="0.00" />
                </div>
              </div>
              <div className={ds.grid2}>
                <div>
                  <label className={ds.label}>Start Date</label>
                  <input type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} className={ds.input} />
                </div>
                <div>
                  <label className={ds.label}>End Date</label>
                  <input type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} className={ds.input} />
                </div>
              </div>
              <div>
                <label className={ds.label}>Notes</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={3} className={ds.textarea} placeholder="Additional notes..." />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
              <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button>
              <button onClick={handleSave} className={ds.btnPrimary}>
                <CheckCircle2 className="w-4 h-4" /> {editingItem ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Enhanced Dashboard
  // ---------------------------------------------------------------------------

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Top-level KPIs */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Hammer className="w-5 h-5 text-yellow-400" />
            <span className={ds.textMuted}>Active Jobs</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.activeJobs}</p>
          <p className={ds.textMuted}>In progress right now</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Total Pipeline</span>
          </div>
          <p className="text-3xl font-bold text-neon-green">${dashboardMetrics.totalValue.toLocaleString()}</p>
          <p className={ds.textMuted}>{dashboardMetrics.total} items total</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <ClipboardCheck className="w-5 h-5 text-purple-400" />
            <span className={ds.textMuted}>Pending Inspections</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.pendingInspections}</p>
          <p className={ds.textMuted}>Awaiting sign-off</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Unpaid Invoices</span>
          </div>
          <p className="text-3xl font-bold text-orange-400">${dashboardMetrics.unpaidInvoices.toLocaleString()}</p>
          <p className={ds.textMuted}>Outstanding balance</p>
        </div>
      </div>

      {/* Cash Flow + Crew Utilization row */}
      <div className={ds.grid2}>
        {/* Cash Flow: Invoiced vs Collected */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <CreditCard className="w-5 h-5 text-neon-cyan" /> Cash Flow
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={ds.textMuted}>Invoiced</span>
                <span className={cn(ds.textMono, 'text-cyan-400')}>${(dashboardMetrics.unpaidInvoices + dashboardMetrics.paidValue).toLocaleString()}</span>
              </div>
              <div className="h-3 bg-lattice-elevated rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500/50 rounded-full" style={{ width: '100%' }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={ds.textMuted}>Collected</span>
                <span className={cn(ds.textMono, 'text-green-400')}>${dashboardMetrics.paidValue.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-lattice-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500/50 rounded-full"
                  style={{ width: `${(dashboardMetrics.unpaidInvoices + dashboardMetrics.paidValue) > 0 ? (dashboardMetrics.paidValue / (dashboardMetrics.unpaidInvoices + dashboardMetrics.paidValue)) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
              <span className={ds.textMuted}>Collection Rate</span>
              <span className={cn(ds.textMono, 'text-white')}>
                {(dashboardMetrics.unpaidInvoices + dashboardMetrics.paidValue) > 0
                  ? `${((dashboardMetrics.paidValue / (dashboardMetrics.unpaidInvoices + dashboardMetrics.paidValue)) * 100).toFixed(0)}%`
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Crew Utilization */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Users className="w-5 h-5 text-blue-400" /> Crew Utilization
          </h3>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-32 h-32">
              {/* Circular progress simulation */}
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  className="text-lattice-elevated"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  className={dashboardMetrics.crewUtilization > 80 ? 'text-green-400' : dashboardMetrics.crewUtilization > 50 ? 'text-yellow-400' : 'text-red-400'}
                  strokeWidth="3"
                  strokeDasharray={`${dashboardMetrics.crewUtilization}, 100`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{dashboardMetrics.crewUtilization}%</span>
              </div>
            </div>
          </div>
          <div className="text-center">
            <p className={ds.textMuted}>{dashboardMetrics.assignedCrew} assigned / {dashboardMetrics.totalCrewSlots} capacity</p>
          </div>
        </div>
      </div>

      {/* Aging Receivables */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <TrendingDown className="w-5 h-5 text-orange-400" /> Aging Receivables
        </h3>
        <div className={ds.grid3}>
          <div className="p-4 rounded-lg bg-lattice-elevated/30 text-center">
            <p className="text-sm text-gray-400 mb-1">0-30 Days</p>
            <p className={cn('text-2xl font-bold', dashboardMetrics.aging30 > 0 ? 'text-yellow-400' : 'text-gray-500')}>
              ${dashboardMetrics.aging30.toLocaleString()}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-lattice-elevated/30 text-center">
            <p className="text-sm text-gray-400 mb-1">31-60 Days</p>
            <p className={cn('text-2xl font-bold', dashboardMetrics.aging60 > 0 ? 'text-orange-400' : 'text-gray-500')}>
              ${dashboardMetrics.aging60.toLocaleString()}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-lattice-elevated/30 text-center">
            <p className="text-sm text-gray-400 mb-1">61-90+ Days</p>
            <p className={cn('text-2xl font-bold', dashboardMetrics.aging90 > 0 ? 'text-red-400' : 'text-gray-500')}>
              ${dashboardMetrics.aging90.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Active Jobs Map (address list with status) */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <MapPin className="w-5 h-5 text-green-400" /> Active Job Locations
        </h3>
        {items.filter(i => (i.data as unknown as TradesArtifact).status === 'in_progress').length === 0 ? (
          <p className={ds.textMuted}>No active jobs currently in progress.</p>
        ) : (
          <div className="space-y-2">
            {items.filter(i => {
              const d = i.data as unknown as TradesArtifact;
              return d.status === 'in_progress' || d.status === 'inspection';
            }).map(item => {
              const d = item.data as unknown as TradesArtifact;
              return (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 cursor-pointer" onClick={() => openEdit(item)}>
                  <MapPin className={cn('w-5 h-5 shrink-0', d.status === 'in_progress' ? 'text-yellow-400' : 'text-purple-400')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <p className={ds.textMuted}>{d.address || 'No address'} {d.client ? `- ${d.client}` : ''}</p>
                  </div>
                  {d.trade && <span className={ds.badge('blue-400')}>{d.trade}</span>}
                  {renderStatusBadge(d.status)}
                  {d.foremanAssigned && <span className={cn(ds.textMuted, 'text-xs')}>{d.foremanAssigned}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Status breakdown */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Status Breakdown</h3>
        <div className="space-y-3">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = dashboardMetrics.byStatus[key] || 0;
            const pct = dashboardMetrics.total > 0 ? (count / dashboardMetrics.total) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-400">{cfg.label}</span>
                <div className="flex-1 h-2 bg-lattice-surface rounded-full overflow-hidden">
                  <div className={`h-full bg-${cfg.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent activity */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <TrendingUp className="w-5 h-5 text-neon-cyan" /> Recent Items
        </h3>
        <div className="space-y-2">
          {items.slice(0, 5).map(item => {
            const d = item.data as unknown as TradesArtifact;
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-lattice-surface/50 hover:bg-lattice-surface cursor-pointer" onClick={() => openEdit(item)}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  <p className={ds.textMuted}>{d.client || d.type} {d.trade ? `- ${d.trade}` : ''}</p>
                </div>
                {renderStatusBadge(d.status)}
                {d.value > 0 && <span className={cn(ds.textMono, 'text-green-400')}>${d.value.toLocaleString()}</span>}
                <ArrowUpRight className="w-4 h-4 text-gray-500" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Invoice Generator sub-view
  // ---------------------------------------------------------------------------

  const renderInvoiceGenerator = () => {
    const subtotal = invLineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
    const taxAmount = subtotal * (invTaxRate / 100);
    const total = subtotal + taxAmount;

    const handleCreateInvoice = async () => {
      setInvCreating(true);
      try {
        const resp = await apiHelpers.economy.createInvoice({
          lineItems: invLineItems.filter(li => li.description.trim()),
          taxRate: invTaxRate,
          dueDate: invDueDate || undefined,
          payerName: invPayerName || selectedJob?.title || undefined,
          notes: invNotes || `Generated from trades lens${selectedJob ? ` — Job: ${selectedJob.title}` : ''}`,
        });
        setInvResult(resp.data as Record<string, unknown>);
        // Reset form
        setInvLineItems([{ description: '', quantity: 1, unitPrice: 0 }]);
        setInvTaxRate(0);
        setInvDueDate('');
        setInvPayerName('');
        setInvNotes('');
      } catch (err) {
        console.error('Invoice creation failed:', err);
        showToast('error', 'Invoice creation failed');
      } finally {
        setInvCreating(false);
      }
    };

    return (
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Invoice Generator</h3>

        {/* Client / Payer */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={ds.label}>Bill To</label>
            <input value={invPayerName} onChange={e => setInvPayerName(e.target.value)} placeholder="Client name" className={ds.input} />
          </div>
          <div>
            <label className={ds.label}>Due Date</label>
            <input type="date" value={invDueDate} onChange={e => setInvDueDate(e.target.value)} className={ds.input} />
          </div>
        </div>

        {/* Line Items */}
        <div className="space-y-2 mb-4">
          <label className={ds.label}>Line Items</label>
          {invLineItems.map((li, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={li.description} onChange={e => { const next = [...invLineItems]; next[i] = { ...li, description: e.target.value }; setInvLineItems(next); }} placeholder="Description" className={cn(ds.input, 'flex-1')} />
              <input type="number" value={li.quantity} onChange={e => { const next = [...invLineItems]; next[i] = { ...li, quantity: Number(e.target.value) || 0 }; setInvLineItems(next); }} className={cn(ds.input, 'w-20')} min={0} />
              <input type="number" value={li.unitPrice} onChange={e => { const next = [...invLineItems]; next[i] = { ...li, unitPrice: Number(e.target.value) || 0 }; setInvLineItems(next); }} className={cn(ds.input, 'w-24')} min={0} step={0.01} />
              {invLineItems.length > 1 && (
                <button onClick={() => setInvLineItems(prev => prev.filter((_, j) => j !== i))} className={ds.btnGhost}><X className="w-3 h-3" /></button>
              )}
            </div>
          ))}
          <button onClick={() => setInvLineItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0 }])} className={cn(ds.btnSmall, 'text-neon-cyan')}>
            <Plus className="w-3 h-3" /> Add Line
          </button>
        </div>

        {/* Tax & Notes */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={ds.label}>Tax Rate (%)</label>
            <input type="number" value={invTaxRate} onChange={e => setInvTaxRate(Number(e.target.value) || 0)} className={ds.input} min={0} step={0.5} />
          </div>
          <div>
            <label className={ds.label}>Notes</label>
            <input value={invNotes} onChange={e => setInvNotes(e.target.value)} placeholder="Optional notes" className={ds.input} />
          </div>
        </div>

        {/* Summary */}
        <div className="bg-lattice-deep rounded-lg p-3 mb-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span className="text-white font-mono">${subtotal.toFixed(2)}</span></div>
          {invTaxRate > 0 && <div className="flex justify-between"><span className="text-gray-400">Tax ({invTaxRate}%)</span><span className="text-white font-mono">${taxAmount.toFixed(2)}</span></div>}
          <div className="flex justify-between border-t border-lattice-border pt-1"><span className="text-gray-300 font-medium">Total</span><span className="text-white font-mono font-bold">${total.toFixed(2)}</span></div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button onClick={handleCreateInvoice} disabled={invCreating || invLineItems.every(li => !li.description.trim())} className={cn(ds.btnPrimary, 'flex items-center gap-2')}>
            <CreditCard className="w-4 h-4" /> {invCreating ? 'Creating...' : 'Create Invoice DTU'}
          </button>
          {invResult && (
            <span className="text-xs text-green-400">Invoice DTU created: {(invResult as Record<string, unknown>)?.dtuId as string || 'success'}</span>
          )}
        </div>

        {invResult && (
          <div className="mt-3 bg-lattice-surface border border-lattice-border rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-1">Invoice DTU created and downloadable via DTU export</p>
            <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-32')}>{JSON.stringify(invResult, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Sub-view selector rendering
  // ---------------------------------------------------------------------------

  const SUB_VIEW_TABS: { id: SubView; label: string; icon: typeof Hammer; forTabs?: ModeTab[] }[] = [
    { id: 'list', label: 'List', icon: Layers },
    { id: 'timeline', label: 'Timeline', icon: GitBranch, forTabs: ['jobs'] },
    { id: 'estimateBuilder', label: 'Estimate Builder', icon: Receipt, forTabs: ['estimates', 'jobs'] },
    { id: 'changeOrders', label: 'Change Orders', icon: FileCheck, forTabs: ['jobs'] },
    { id: 'timeTracking', label: 'Time Tracking', icon: Clock, forTabs: ['jobs'] },
    { id: 'profitLoss', label: 'P&L', icon: PieChart, forTabs: ['jobs'] },
    { id: 'materialsTracker', label: 'Materials', icon: Package, forTabs: ['jobs', 'materials'] },
    { id: 'photos', label: 'Photos', icon: Camera, forTabs: ['jobs'] },
    { id: 'invoiceGenerator', label: 'Invoice', icon: Receipt, forTabs: ['jobs', 'clients'] },
  ];

  const visibleSubViews = SUB_VIEW_TABS.filter(sv => !sv.forTabs || sv.forTabs.includes(activeTab));

  const renderSubViewContent = () => {
    switch (subView) {
      case 'timeline': return renderTimeline();
      case 'estimateBuilder': return renderEstimateBuilder();
      case 'changeOrders': return renderChangeOrders();
      case 'timeTracking': return renderTimeTracking();
      case 'profitLoss': return renderProfitLoss();
      case 'materialsTracker': return renderMaterialsTracker();
      case 'photos': return renderPhotoDocumentation();
      case 'invoiceGenerator': return renderInvoiceGenerator();
      default: return renderLibrary();
    }
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

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
    <div className={cn(ds.pageContainer, 'lens-trades')} data-lens-theme="trades">
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <HardHat className="w-8 h-8 text-teal-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={cn(ds.heading1, 'text-slate-100')}>Trades & Construction</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Manage jobs, estimates, materials, permits, equipment, and clients</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="trades" data={{}} compact />
          <VisionAnalyzeButton
            domain="trades"
            prompt="Analyze this construction/trades job site image. Identify materials, equipment, safety concerns, progress status, and any issues. Suggest inspection notes and relevant tags."
            onResult={(res) => {
              setFormNotes(prev => prev ? `${prev}\n\n[Site Inspection - Vision]\n${res.analysis}` : `[Site Inspection - Vision]\n${res.analysis}`);
              if (res.suggestedTags?.length) setFormDescription(prev => prev ? `${prev}\nTags: ${res.suggestedTags!.join(', ')}` : `Tags: ${res.suggestedTags!.join(', ')}`);
            }}
          />
          {selectedJob && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30">
              <CircleDot className="w-3 h-3 text-neon-cyan" />
              <span className="text-xs text-neon-cyan truncate max-w-[160px]">{selectedJob.title}</span>
              <button onClick={() => setSelectedJobId(null)} className="text-neon-cyan/60 hover:text-neon-cyan">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <button onClick={() => { setShowDashboard(!showDashboard); setSubView('list'); }} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}>
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </div>
      </header>


      <RealtimeDataPanel domain="trades" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const allData = items.map(i => i.data as unknown as TradesArtifact);
          const completed = allData.filter(d => d.status === 'completed' || d.status === 'paid').length;
          const certs = new Set(allData.map(d => d.trade).filter(Boolean)).size;
          const completionRate = allData.length > 0 ? Math.round((completed / allData.length) * 100) : 0;
          return [
            { label: 'Jobs', value: items.length, icon: Hammer },
            { label: 'Certifications', value: certs, icon: ShieldCheck },
            { label: 'Completion Rate', value: `${completionRate}%`, icon: ClipboardCheck },
            { label: 'Active', value: allData.filter(d => d.status === 'in_progress').length, icon: HardHat },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-teal-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="trades" artifactId={items[0]?.id} compact />
      {/* Mode tabs (original 6) */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setShowDashboard(false); setSubView('list'); }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Sub-view tabs (when not on dashboard) */}
      {!showDashboard && visibleSubViews.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap pb-1">
          {visibleSubViews.map(sv => (
            <button
              key={sv.id}
              onClick={() => setSubView(sv.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap',
                subView === sv.id
                  ? 'bg-slate-700/40 text-teal-300 border border-slate-600/50'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'
              )}
            >
              <sv.icon className="w-3.5 h-3.5" />
              {sv.label}
            </button>
          ))}
        </div>
      )}

      {/* Domain Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleAction('generateEstimate')} className={ds.btnSecondary}>
          <FileText className="w-4 h-4" /> Generate Estimate
        </button>
        <button onClick={() => handleAction('checkPermits')} className={ds.btnSecondary}>
          <ShieldCheck className="w-4 h-4" /> Check Permits
        </button>
        <button onClick={() => handleAction('scheduleInspection')} className={ds.btnSecondary}>
          <ClipboardCheck className="w-4 h-4" /> Schedule Inspection
        </button>
        <button onClick={() => handleAction('calculatePL')} className={ds.btnSecondary}>
          <PieChart className="w-4 h-4" /> Calculate P&L
        </button>
        <button onClick={() => handleAction('generateInvoice')} className={ds.btnSecondary}>
          <Send className="w-4 h-4" /> Generate Invoice
        </button>
        {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
      </div>

      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            {/* calculateEstimate */}
            {actionResult.grandTotal !== undefined && actionResult.subtotal !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-gray-400">${Number(actionResult.subtotal).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Subtotal</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-amber-400">+${Number(actionResult.markupAmount).toLocaleString()} ({String(actionResult.markupPct)}%)</p>
                    <p className="text-[10px] text-gray-500">Markup</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.grandTotal).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Grand Total</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-gray-400">${Number(actionResult.taxAmount).toLocaleString()} ({Number(actionResult.taxRate) * 100}%)</p>
                    <p className="text-[10px] text-gray-500">Tax</p>
                  </div>
                  {Number(actionResult.discountAmount) > 0 && (
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-green-400">-${Number(actionResult.discountAmount).toLocaleString()}</p>
                      <p className="text-[10px] text-gray-500">Discount</p>
                    </div>
                  )}
                </div>
                {Array.isArray(actionResult.lineItems) && (actionResult.lineItems as {description:string;lineTotal:number}[]).slice(0,4).map((li, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-lattice-surface rounded text-xs">
                    <span className="text-gray-300">{li.description}</span>
                    <span className="text-neon-cyan">${li.lineTotal}</span>
                  </div>
                ))}
              </div>
            )}
            {/* scheduleInspection */}
            {actionResult.inspectionId !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String((actionResult as {status:string}).status)}</p>
                    <p className="text-[10px] text-gray-500">Status</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String((actionResult as {requestedDate:string}).requestedDate)}</p>
                    <p className="text-[10px] text-gray-500">Date</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">Permit: {String((actionResult as {permitType:string}).permitType)} &bull; Stage: {String((actionResult as {stageName:string}).stageName)}</p>
                <p className="text-[10px] text-gray-500 font-mono">{String(actionResult.inspectionId)}</p>
              </div>
            )}
            {/* materialsCost */}
            {actionResult.grandTotal !== undefined && actionResult.jobsIncluded !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.grandTotal).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Total Cost</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.jobsIncluded)}</p>
                    <p className="text-[10px] text-gray-500">Jobs</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan capitalize">{String(actionResult.statusFilter)}</p>
                    <p className="text-[10px] text-gray-500">Filter</p>
                  </div>
                </div>
                {!!actionResult.topMaterial && (
                  <div className="px-2 py-1 bg-lattice-surface rounded text-xs">
                    <span className="text-gray-400">Top material: </span>
                    <span className="text-neon-cyan">{String((actionResult.topMaterial as {item:string}).item)} — ${String((actionResult.topMaterial as {totalCost:number}).totalCost)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {showDashboard ? renderDashboard() : renderSubViewContent()}

      {/* Editor modal */}
      {renderEditor()}

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
            <LensFeaturePanel lensId="trades" />
          </div>
        )}
      </div>
    </div>
  );
}
