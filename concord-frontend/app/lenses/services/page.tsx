'use client';

import { useState, useMemo, useRef} from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { ServicesFeed } from '@/components/services/ServicesFeed';
import { RevenueRetentionPanel } from '@/components/services/RevenueRetentionPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Scissors,
  Users,
  CalendarCheck,
  Sparkles,
  UserCheck,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  CheckCircle2,
  BarChart3,
  AlertTriangle,
  Calendar,
  Clock,
  Phone,
  Mail,
  DollarSign,
  Activity,
  TrendingUp,
  Star,
  Bell,
  Heart,
  ShoppingBag,
  CreditCard,
  Package,
  Repeat,
  Gift,
  Percent,
  Receipt,
  Tag,
  UserPlus,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Appointments' | 'Clients' | 'Services' | 'Staff' | 'POS' | 'Inventory';
type ArtifactType = 'Appointment' | 'Client' | 'ServiceItem' | 'StaffMember' | 'Transaction' | 'Product';

type AppointmentStatus = 'booked' | 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
type PaymentMethod = 'cash' | 'credit' | 'debit' | 'check' | 'gift_card' | 'other';

interface AppointmentData {
  clientName: string;
  serviceType: string;
  provider: string;
  date: string;
  time: string;
  duration: number; // minutes
  recurring: boolean;
  recurringFrequency: string; // weekly, biweekly, monthly
  noShowCount: number;
  notes: string;
  price: number;
  reminderSent: boolean;
}

interface ClientData {
  phone: string;
  email: string;
  visitHistory: number;
  preferences: string;
  notes: string;
  totalSpend: number;
  loyaltyPoints: number;
  birthday: string;
  lastVisit: string;
  preferredProvider: string;
  allergies: string;
  referralSource: string;
}

interface ServiceItemData {
  category: string;
  duration: number; // minutes
  price: number;
  requiredStaff: string;
  requiredEquipment: string;
  addOns: string[];
  packageDeals: string[];
  description: string;
  isActive: boolean;
}

interface StaffMemberData {
  skills: string[];
  schedule: string; // e.g. "Mon-Fri 9am-5pm"
  commissionRate: number; // percentage
  bookingsThisMonth: number;
  revenueThisMonth: number;
  retentionRate: number; // percentage
  phone: string;
  email: string;
  hireDate: string;
  role: string;
  bio: string;
}

interface TransactionData {
  clientName: string;
  services: string[];
  products: string[];
  subtotal: number;
  tax: number;
  tip: number;
  discount: number;
  discountCode: string;
  total: number;
  paymentMethod: PaymentMethod;
  staffMember: string;
  date: string;
  time: string;
  receiptNumber: string;
}

interface ProductData {
  sku: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  stockLevel: number;
  reorderLevel: number;
  salesVelocity: number; // units per month
  supplier: string;
  lastRestocked: string;
  description: string;
}

type ArtifactDataUnion = AppointmentData | ClientData | ServiceItemData | StaffMemberData | TransactionData | ProductData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof Scissors; artifactType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Appointments', icon: CalendarCheck, artifactType: 'Appointment' },
  { id: 'Clients', icon: Users, artifactType: 'Client' },
  { id: 'Services', icon: Sparkles, artifactType: 'ServiceItem' },
  { id: 'Staff', icon: UserCheck, artifactType: 'StaffMember' },
  { id: 'POS', icon: CreditCard, artifactType: 'Transaction' },
  { id: 'Inventory', icon: Package, artifactType: 'Product' },
];

const APPOINTMENT_STATUSES: AppointmentStatus[] = ['booked', 'confirmed', 'in_progress', 'completed', 'no_show', 'cancelled'];
const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'credit', 'debit', 'check', 'gift_card', 'other'];
const SERVICE_CATEGORIES = ['Hair', 'Nails', 'Skin/Facial', 'Massage', 'Waxing', 'Lashes/Brows', 'Makeup', 'Other'];
const STAFF_ROLES = ['Stylist', 'Barber', 'Nail Tech', 'Esthetician', 'Massage Therapist', 'Lash Tech', 'Makeup Artist', 'Manager', 'Front Desk'];
const PRODUCT_CATEGORIES = ['Hair Care', 'Skin Care', 'Nail Products', 'Styling Tools', 'Accessories', 'Gift Cards', 'Other'];

const STATUS_COLORS: Record<string, string> = {
  booked: 'blue-400',
  confirmed: 'cyan-400',
  in_progress: 'yellow-400',
  completed: 'green-400',
  no_show: 'red-400',
  cancelled: 'gray-400',
  active: 'green-400',
  inactive: 'gray-400',
};

function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'Appointments': return APPOINTMENT_STATUSES;
    case 'Clients': return ['active', 'inactive'];
    case 'Services': return ['active', 'inactive'];
    case 'Staff': return ['active', 'inactive'];
    case 'POS': return ['completed', 'cancelled'];
    case 'Inventory': return ['active', 'inactive'];
    default: return ['active', 'inactive'];
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ServicesLensPage() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },
    ],
    { lensId: "services" }
  );

  useLensNav('services');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('services');

  const [mode, setMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('booked');
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentType: ArtifactType = MODE_TABS.find(t => t.id === mode)?.artifactType || 'Appointment';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactDataUnion>('services', currentType, {
    seed: [],
  });

  /* secondary data for dashboard */
  const { items: appointments } = useLensData<AppointmentData>('services', 'Appointment', { seed: [] });
  const { items: clients } = useLensData<ClientData>('services', 'Client', { seed: [] });
  const { items: serviceItems } = useLensData<ServiceItemData>('services', 'ServiceItem', { seed: [] });
  const { items: staff } = useLensData<StaffMemberData>('services', 'StaffMember', { seed: [] });
  const { items: transactions } = useLensData<TransactionData>('services', 'Transaction', { seed: [] });
  const { items: products } = useLensData<ProductData>('services', 'Product', { seed: [] });

  const runAction = useRunArtifact('services');
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
    setFormStatus(getStatusesForTab(mode)[0] || 'booked');
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
    const todaysAppts = appointments.filter(i => i.meta.status === 'booked' || i.meta.status === 'confirmed').length;

    const revenueToday = transactions.reduce((sum, i) => {
      const d = i.data as unknown as TransactionData;
      return sum + (d.total || 0);
    }, 0);

    const noShowRate = (() => {
      if (appointments.length === 0) return 0;
      const noShows = appointments.filter(i => i.meta.status === 'no_show').length;
      return Math.round((noShows / appointments.length) * 100);
    })();

    const topServices = (() => {
      const counts: Record<string, number> = {};
      appointments.forEach(i => {
        const d = i.data as unknown as AppointmentData;
        if (d.serviceType) counts[d.serviceType] = (counts[d.serviceType] || 0) + 1;
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    })();

    const staffUtilization = staff.map(s => {
      const d = s.data as unknown as StaffMemberData;
      return { name: s.title, bookings: d.bookingsThisMonth || 0, revenue: d.revenueThisMonth || 0, retention: d.retentionRate || 0 };
    }).sort((a, b) => b.revenue - a.revenue);

    const productSales = products.reduce((sum, i) => {
      const d = i.data as unknown as ProductData;
      return sum + (d.salesVelocity || 0) * (d.retailPrice || 0);
    }, 0);

    const lowStock = products.filter(i => {
      const d = i.data as unknown as ProductData;
      return d.stockLevel <= d.reorderLevel;
    }).length;

    const totalClients = clients.length;
    const totalServices = serviceItems.length;

    return { todaysAppts, revenueToday, noShowRate, topServices, staffUtilization, productSales, lowStock, totalClients, totalServices };
  }, [appointments, transactions, staff, products, clients, serviceItems]);

  /* ================================================================ */
  /*  Form fields                                                      */
  /* ================================================================ */

  const renderFormFields = () => {
    switch (currentType) {
      case 'Appointment':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Client Name</label><input className={ds.input} value={(formData.clientName as string) || ''} onChange={e => setFormData({ ...formData, clientName: e.target.value })} /></div>
              <div><label className={ds.label}>Service Type</label><input className={ds.input} value={(formData.serviceType as string) || ''} onChange={e => setFormData({ ...formData, serviceType: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Provider</label><input className={ds.input} value={(formData.provider as string) || ''} onChange={e => setFormData({ ...formData, provider: e.target.value })} /></div>
              <div><label className={ds.label}>Duration (min)</label><input type="number" className={ds.input} value={(formData.duration as number) || ''} onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(formData.date as string) || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
              <div><label className={ds.label}>Time</label><input type="time" className={ds.input} value={(formData.time as string) || ''} onChange={e => setFormData({ ...formData, time: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.price as number) || ''} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>No-Show Count</label><input type="number" className={ds.input} value={(formData.noShowCount as number) || ''} onChange={e => setFormData({ ...formData, noShowCount: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={(formData.recurring as boolean) || false} onChange={e => setFormData({ ...formData, recurring: e.target.checked })} />
                Recurring Appointment
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={(formData.reminderSent as boolean) || false} onChange={e => setFormData({ ...formData, reminderSent: e.target.checked })} />
                Reminder Sent
              </label>
            </div>
            {(formData.recurring as boolean) && (
              <div><label className={ds.label}>Frequency</label><select className={ds.select} value={(formData.recurringFrequency as string) || 'weekly'} onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></div>
            )}
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Client':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Phone</label><input className={ds.input} value={(formData.phone as string) || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="555-0100" /></div>
              <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Birthday</label><input type="date" className={ds.input} value={(formData.birthday as string) || ''} onChange={e => setFormData({ ...formData, birthday: e.target.value })} /></div>
              <div><label className={ds.label}>Last Visit</label><input type="date" className={ds.input} value={(formData.lastVisit as string) || ''} onChange={e => setFormData({ ...formData, lastVisit: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Total Visits</label><input type="number" className={ds.input} value={(formData.visitHistory as number) || ''} onChange={e => setFormData({ ...formData, visitHistory: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Total Spend ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.totalSpend as number) || ''} onChange={e => setFormData({ ...formData, totalSpend: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Loyalty Points</label><input type="number" className={ds.input} value={(formData.loyaltyPoints as number) || ''} onChange={e => setFormData({ ...formData, loyaltyPoints: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Preferred Provider</label><input className={ds.input} value={(formData.preferredProvider as string) || ''} onChange={e => setFormData({ ...formData, preferredProvider: e.target.value })} /></div>
              <div><label className={ds.label}>Referral Source</label><input className={ds.input} value={(formData.referralSource as string) || ''} onChange={e => setFormData({ ...formData, referralSource: e.target.value })} placeholder="Walk-in, Google, Referral..." /></div>
            </div>
            <div><label className={ds.label}>Preferences</label><textarea className={ds.textarea} rows={2} value={(formData.preferences as string) || ''} onChange={e => setFormData({ ...formData, preferences: e.target.value })} placeholder="Color preferences, style notes..." /></div>
            <div><label className={ds.label}>Allergies / Sensitivities</label><input className={ds.input} value={(formData.allergies as string) || ''} onChange={e => setFormData({ ...formData, allergies: e.target.value })} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'ServiceItem':
        return (
          <>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || 'Hair'} onChange={e => setFormData({ ...formData, category: e.target.value })}>{SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className={ds.label}>Duration (min)</label><input type="number" className={ds.input} value={(formData.duration as number) || ''} onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.price as number) || ''} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Required Staff</label><input className={ds.input} value={(formData.requiredStaff as string) || ''} onChange={e => setFormData({ ...formData, requiredStaff: e.target.value })} placeholder="Stylist, Colorist..." /></div>
              <div><label className={ds.label}>Required Equipment</label><input className={ds.input} value={(formData.requiredEquipment as string) || ''} onChange={e => setFormData({ ...formData, requiredEquipment: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Add-on Services (comma-separated)</label><input className={ds.input} value={((formData.addOns as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, addOns: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Deep Conditioning, Blow Dry..." /></div>
            <div><label className={ds.label}>Package Deals (comma-separated)</label><input className={ds.input} value={((formData.packageDeals as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, packageDeals: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Bridal Package, Color + Cut..." /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={(formData.isActive as boolean) !== false} onChange={e => setFormData({ ...formData, isActive: e.target.checked })} />
              Active Service
            </label>
          </>
        );
      case 'StaffMember':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Role</label><select className={ds.select} value={(formData.role as string) || 'Stylist'} onChange={e => setFormData({ ...formData, role: e.target.value })}>{STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><label className={ds.label}>Hire Date</label><input type="date" className={ds.input} value={(formData.hireDate as string) || ''} onChange={e => setFormData({ ...formData, hireDate: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Skills (comma-separated)</label><input className={ds.input} value={((formData.skills as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Color, Cut, Highlights..." /></div>
            <div><label className={ds.label}>Schedule / Availability</label><input className={ds.input} value={(formData.schedule as string) || ''} onChange={e => setFormData({ ...formData, schedule: e.target.value })} placeholder="Mon-Fri 9am-5pm" /></div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Commission (%)</label><input type="number" className={ds.input} value={(formData.commissionRate as number) || ''} onChange={e => setFormData({ ...formData, commissionRate: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Bookings This Month</label><input type="number" className={ds.input} value={(formData.bookingsThisMonth as number) || ''} onChange={e => setFormData({ ...formData, bookingsThisMonth: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Revenue This Month ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.revenueThisMonth as number) || ''} onChange={e => setFormData({ ...formData, revenueThisMonth: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Retention Rate (%)</label><input type="number" className={ds.input} value={(formData.retentionRate as number) || ''} onChange={e => setFormData({ ...formData, retentionRate: parseInt(e.target.value) || 0 })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Phone</label><input className={ds.input} value={(formData.phone as string) || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
              <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Bio</label><textarea className={ds.textarea} rows={2} value={(formData.bio as string) || ''} onChange={e => setFormData({ ...formData, bio: e.target.value })} /></div>
          </>
        );
      case 'Transaction':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Client Name</label><input className={ds.input} value={(formData.clientName as string) || ''} onChange={e => setFormData({ ...formData, clientName: e.target.value })} /></div>
              <div><label className={ds.label}>Staff Member</label><input className={ds.input} value={(formData.staffMember as string) || ''} onChange={e => setFormData({ ...formData, staffMember: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Services (comma-separated)</label><input className={ds.input} value={((formData.services as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, services: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Products (comma-separated)</label><input className={ds.input} value={((formData.products as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, products: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div className={ds.grid4}>
              <div><label className={ds.label}>Subtotal ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.subtotal as number) || ''} onChange={e => setFormData({ ...formData, subtotal: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Tax ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.tax as number) || ''} onChange={e => setFormData({ ...formData, tax: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Tip ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.tip as number) || ''} onChange={e => setFormData({ ...formData, tip: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Discount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.discount as number) || ''} onChange={e => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Total ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.total as number) || ''} onChange={e => setFormData({ ...formData, total: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Payment Method</label><select className={ds.select} value={(formData.paymentMethod as string) || 'credit'} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></div>
              <div><label className={ds.label}>Discount Code</label><input className={ds.input} value={(formData.discountCode as string) || ''} onChange={e => setFormData({ ...formData, discountCode: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(formData.date as string) || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
              <div><label className={ds.label}>Receipt #</label><input className={ds.input} value={(formData.receiptNumber as string) || ''} onChange={e => setFormData({ ...formData, receiptNumber: e.target.value })} placeholder="RCP-0001" /></div>
            </div>
          </>
        );
      case 'Product':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>SKU</label><input className={ds.input} value={(formData.sku as string) || ''} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="SKU-0001" /></div>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || 'Hair Care'} onChange={e => setFormData({ ...formData, category: e.target.value })}>{PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Cost Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.costPrice as number) || ''} onChange={e => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Retail Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.retailPrice as number) || ''} onChange={e => setFormData({ ...formData, retailPrice: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Stock Level</label><input type="number" className={ds.input} value={(formData.stockLevel as number) || ''} onChange={e => setFormData({ ...formData, stockLevel: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Reorder Level</label><input type="number" className={ds.input} value={(formData.reorderLevel as number) || ''} onChange={e => setFormData({ ...formData, reorderLevel: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Sales Velocity (units/mo)</label><input type="number" step="0.1" className={ds.input} value={(formData.salesVelocity as number) || ''} onChange={e => setFormData({ ...formData, salesVelocity: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Supplier</label><input className={ds.input} value={(formData.supplier as string) || ''} onChange={e => setFormData({ ...formData, supplier: e.target.value })} /></div>
              <div><label className={ds.label}>Last Restocked</label><input type="date" className={ds.input} value={(formData.lastRestocked as string) || ''} onChange={e => setFormData({ ...formData, lastRestocked: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
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
          {currentType === 'Appointment' && (
            <>
              <p className={ds.textMuted}><Users className="w-3 h-3 inline mr-1" />{d.clientName as string} with {d.provider as string}</p>
              <p className={ds.textMuted}><Sparkles className="w-3 h-3 inline mr-1" />{d.serviceType as string}</p>
              <p className={ds.textMuted}><Calendar className="w-3 h-3 inline mr-1" />{d.date as string} at {d.time as string}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className={ds.textMuted}><Clock className="w-3 h-3 inline mr-1" />{d.duration as number}min</span>
                {(d.price as number) > 0 && <span className="text-green-400 font-bold">${d.price as number}</span>}
              </div>
              {Boolean(d.recurring) && <span className={ds.badge('neon-cyan')}><Repeat className="w-3 h-3" /> {d.recurringFrequency as string}</span>}
              {Boolean(d.reminderSent) && <span className={ds.badge('blue-400')}><Bell className="w-3 h-3" /> Sent</span>}
              {(d.noShowCount as number) > 0 && <span className={ds.badge('red-400')}>No-shows: {d.noShowCount as number}</span>}
            </>
          )}

          {currentType === 'Client' && (
            <>
              {Boolean(d.phone) && <p className={ds.textMuted}><Phone className="w-3 h-3 inline mr-1" />{d.phone as string}</p>}
              {Boolean(d.email) && <p className={ds.textMuted}><Mail className="w-3 h-3 inline mr-1" />{d.email as string}</p>}
              <div className="flex items-center gap-3 text-xs">
                <span className={ds.badge('blue-400')}>{d.visitHistory as number} visits</span>
                <span className="text-green-400 font-bold">${(d.totalSpend as number)?.toLocaleString()}</span>
                {(d.loyaltyPoints as number) > 0 && <span className={ds.badge('yellow-400')}><Star className="w-3 h-3" /> {d.loyaltyPoints as number}pts</span>}
              </div>
              {Boolean(d.preferredProvider) && <p className={cn(ds.textMuted, 'text-xs')}><Heart className="w-3 h-3 inline mr-1" />Prefers: {d.preferredProvider as string}</p>}
              {Boolean(d.birthday) && <p className={cn(ds.textMuted, 'text-xs')}><Gift className="w-3 h-3 inline mr-1" />{d.birthday as string}</p>}
              {Boolean(d.allergies) && <p className="text-orange-400 text-xs"><AlertTriangle className="w-3 h-3 inline mr-1" />{d.allergies as string}</p>}
            </>
          )}

          {currentType === 'ServiceItem' && (
            <>
              {Boolean(d.category) && <span className={ds.badge('purple-400')}>{d.category as string}</span>}
              <div className="flex items-center gap-3 text-xs mt-1">
                {(d.price as number) > 0 && <span className="text-green-400 font-bold">${d.price as number}</span>}
                <span className={ds.textMuted}><Clock className="w-3 h-3 inline mr-1" />{d.duration as number}min</span>
              </div>
              {Boolean(d.requiredStaff) && <p className={cn(ds.textMuted, 'text-xs')}>Staff: {d.requiredStaff as string}</p>}
              {(d.addOns as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.addOns as string[]).map(a => <span key={a} className={ds.badge('cyan-400')}>{a}</span>)}</div>
              )}
              {(d.packageDeals as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">{(d.packageDeals as string[]).map(p => <span key={p} className={ds.badge('yellow-400')}><Tag className="w-2.5 h-2.5" />{p}</span>)}</div>
              )}
            </>
          )}

          {currentType === 'StaffMember' && (
            <>
              <p className="text-purple-400 font-medium">{d.role as string}</p>
              {(d.skills as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1">{(d.skills as string[]).map(s => <span key={s} className={ds.badge('cyan-400')}>{s}</span>)}</div>
              )}
              {Boolean(d.schedule) && <p className={cn(ds.textMuted, 'text-xs')}><Clock className="w-3 h-3 inline mr-1" />{d.schedule as string}</p>}
              <div className="flex items-center gap-3 text-xs mt-1">
                <span className={ds.textMuted}>{d.bookingsThisMonth as number} bookings</span>
                <span className="text-green-400 font-bold">${(d.revenueThisMonth as number)?.toLocaleString()}</span>
                <span className={cn(ds.textMono, 'text-xs')}>{d.commissionRate as number}% comm</span>
              </div>
              {(d.retentionRate as number) > 0 && <p className={cn(ds.textMuted, 'text-xs')}>Retention: {d.retentionRate as number}%</p>}
            </>
          )}

          {currentType === 'Transaction' && (
            <>
              <p className={ds.textMuted}>{d.clientName as string} | {d.staffMember as string}</p>
              {(d.services as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1">{(d.services as string[]).map(s => <span key={s} className={ds.badge('blue-400')}>{s}</span>)}</div>
              )}
              {(d.products as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1">{(d.products as string[]).map(p => <span key={p} className={ds.badge('green-400')}>{p}</span>)}</div>
              )}
              <div className="flex items-center gap-3 text-xs mt-1">
                <span className="text-green-400 font-bold text-sm">${d.total as number}</span>
                {Boolean(d.paymentMethod) && <span className={ds.badge('gray-400')}>{(d.paymentMethod as string).replace(/_/g, ' ')}</span>}
                {(d.tip as number) > 0 && <span className={ds.textMuted}>Tip: ${d.tip as number}</span>}
                {(d.discount as number) > 0 && <span className="text-red-400">-${d.discount as number}</span>}
              </div>
              {Boolean(d.receiptNumber) && <p className={cn(ds.textMono, 'text-xs text-gray-500')}>{d.receiptNumber as string}</p>}
            </>
          )}

          {currentType === 'Product' && (
            <>
              <p className={cn(ds.textMono, 'text-xs text-gray-400')}>{d.sku as string}</p>
              {Boolean(d.category) && <span className={ds.badge('purple-400')}>{d.category as string}</span>}
              <div className="flex items-center gap-3 text-xs mt-1">
                <span className={ds.textMuted}>Cost: ${d.costPrice as number}</span>
                <span className="text-green-400 font-bold">Retail: ${d.retailPrice as number}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={cn((d.stockLevel as number) <= (d.reorderLevel as number) ? 'text-red-400' : 'text-white')}>
                  Stock: {d.stockLevel as number}
                </span>
                <span className={ds.textMuted}>Reorder at: {d.reorderLevel as number}</span>
                <span className={ds.textMuted}>{d.salesVelocity as number}/mo</span>
              </div>
              {(d.stockLevel as number) <= (d.reorderLevel as number) && (
                <span className={ds.badge('red-400')}><AlertTriangle className="w-3 h-3" /> Low Stock</span>
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
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><CalendarCheck className="w-5 h-5 text-blue-400" /><span className={ds.textMuted}>Today&apos;s Appointments</span></div>
          <p className="text-3xl font-bold text-white">{dashboardStats.todaysAppts}</p>
          <p className={ds.textMuted}>Booked &amp; confirmed</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-5 h-5 text-green-400" /><span className={ds.textMuted}>Revenue Today</span></div>
          <p className="text-3xl font-bold text-green-400">${dashboardStats.revenueToday.toLocaleString()}</p>
          <p className={ds.textMuted}>From transactions</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5 text-red-400" /><span className={ds.textMuted}>No-Show Rate</span></div>
          <p className={cn('text-3xl font-bold', dashboardStats.noShowRate > 10 ? 'text-red-400' : 'text-white')}>{dashboardStats.noShowRate}%</p>
          <p className={ds.textMuted}>All-time average</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><ShoppingBag className="w-5 h-5 text-purple-400" /><span className={ds.textMuted}>Product Sales</span></div>
          <p className="text-3xl font-bold text-purple-400">${dashboardStats.productSales.toLocaleString()}</p>
          <p className={cn(ds.textMuted, dashboardStats.lowStock > 0 ? 'text-red-400' : '')}>{dashboardStats.lowStock} low stock alerts</p>
        </div>
      </div>

      {/* Client & Service counts */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Users className="w-5 h-5 text-neon-cyan" /><span className={ds.textMuted}>Total Clients</span></div>
          <p className="text-3xl font-bold text-neon-cyan">{dashboardStats.totalClients}</p>
          <p className={ds.textMuted}>Registered clients</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Sparkles className="w-5 h-5 text-pink-400" /><span className={ds.textMuted}>Service Menu</span></div>
          <p className="text-3xl font-bold text-pink-400">{dashboardStats.totalServices}</p>
          <p className={ds.textMuted}>Available services</p>
        </div>
      </div>

      {/* Top services */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Top Services</h3>
        {dashboardStats.topServices.length === 0 ? (
          <p className={ds.textMuted}>No service data yet.</p>
        ) : (
          <div className="space-y-2">
            {dashboardStats.topServices.map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-40 text-sm text-gray-300 truncate">{name}</span>
                <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-pink-400 rounded-full transition-all"
                    style={{ width: `${dashboardStats.topServices.length > 0 ? (count / dashboardStats.topServices[0][1]) * 100 : 0}%` }}
                  />
                </div>
                <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff utilization */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Staff Performance</h3>
        {dashboardStats.staffUtilization.length === 0 ? (
          <p className={ds.textMuted}>No staff data yet.</p>
        ) : (
          <div className="space-y-3">
            {dashboardStats.staffUtilization.slice(0, 5).map(s => (
              <div key={s.name} className="flex items-center gap-4 p-3 rounded-lg bg-lattice-elevated/30">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold">
                  {s.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{s.name}</p>
                  <p className={ds.textMuted}>{s.bookings} bookings | {s.retention}% retention</p>
                </div>
                <p className="text-green-400 font-bold">${s.revenue.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent appointments */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Recent Appointments</h3>
        <div className="space-y-2">
          {appointments.slice(0, 5).map(item => {
            const d = item.data as unknown as AppointmentData;
            return (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{item.title}</p>
                  <p className={cn(ds.textMuted, 'text-xs')}>{d.clientName} | {d.date} {d.time}</p>
                </div>
                {renderStatusBadge(item.meta.status)}
              </div>
            );
          })}
          {appointments.length === 0 && <p className={ds.textMuted}>No appointments yet.</p>}
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
    <LensShell lensId="services" asMain={false}>
      <ManifestActionBar />
    <div data-lens-theme="services" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Scissors className="w-8 h-8 text-pink-400" />
          <div>
            <h1 className={ds.heading1}>Service Business</h1>
            <p className={ds.textMuted}>Appointments, clients, service menu, staff, point-of-sale &amp; inventory</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="services" data={realtimeData || {}} compact />
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
      <UniversalActions domain="services" artifactId={appointments[0]?.id} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className={ds.panel + ' flex items-center gap-3'}>
          <Scissors className="w-5 h-5 text-pink-400" />
          <div>
            <p className="text-lg font-bold text-white">{items.length}</p>
            <p className="text-xs text-gray-500">Services</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className={ds.panel + ' flex items-center gap-3'}>
          <Activity className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold text-white">{appointments.filter(a => a.meta.status !== 'cancelled' && a.meta.status !== 'no_show').length}</p>
            <p className="text-xs text-gray-500">Healthy</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className={ds.panel + ' flex items-center gap-3'}>
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <div>
            <p className="text-lg font-bold text-white">{dashboardStats.noShowRate > 0 ? `${(100 - dashboardStats.noShowRate).toFixed(0)}%` : '100%'}</p>
            <p className="text-xs text-gray-500">Avg Uptime</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className={ds.panel + ' flex items-center gap-3'}>
          <BarChart3 className="w-5 h-5 text-purple-400" />
          <div>
            <p className="text-lg font-bold text-white">{appointments.length + staff.length}</p>
            <p className="text-xs text-gray-500">Endpoints</p>
          </div>
        </motion.div>
      </div>

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
                  ? 'bg-pink-400/20 text-pink-400'
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
          <button onClick={() => handleAction('dailyCloseReport')} className={ds.btnSecondary}>
            <Receipt className="w-4 h-4" /> Daily Close Report
          </button>
          <button onClick={() => handleAction('commissionCalc')} className={ds.btnSecondary}>
            <Percent className="w-4 h-4" /> Commission Calc
          </button>
          <button onClick={() => handleAction('clientRetentionReport')} className={ds.btnSecondary}>
            <UserPlus className="w-4 h-4" /> Client Retention Report
          </button>
          <button onClick={() => handleAction('inventoryCheck')} className={ds.btnSecondary}>
            <Package className="w-4 h-4" /> Inventory Check
          </button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
        </div>
      )}

      {/* Content */}
      {mode === 'Dashboard' ? renderDashboard() : (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-pink-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <Scissors className="w-12 h-12 text-gray-600 mx-auto mb-3" />
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
            <button onClick={() => setActionResult(null)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            {/* scheduleOptimize */}
            {actionResult.optimizedOrder !== undefined && Array.isArray(actionResult.optimizedOrder) && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{(actionResult.optimizedOrder as unknown[]).length}</p>
                    <p className="text-[10px] text-gray-500">Appointments</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.totalGapMinutes) > 60 ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.totalGapMinutes)} min</p>
                    <p className="text-[10px] text-gray-500">Total Gap</p>
                  </div>
                </div>
                {(actionResult.optimizedOrder as {client:string;time:string;service:string}[]).slice(0,5).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 bg-lattice-surface rounded">
                    <span className="w-5 h-5 rounded-full bg-neon-cyan/20 text-neon-cyan text-center leading-5 flex-shrink-0">{i+1}</span>
                    <span className="text-gray-300 flex-1">{a.client}</span>
                    <span className="text-gray-500">{a.service}</span>
                  </div>
                ))}
              </div>
            )}
            {/* reminderGenerate */}
            {actionResult.reminders !== undefined && Array.isArray(actionResult.reminders) && (
              <div className="space-y-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">{String(actionResult.count)}</p>
                  <p className="text-[10px] text-gray-500">Reminders Generated</p>
                </div>
                {(actionResult.reminders as {client:string;service:string;date:string}[]).slice(0,4).map((r, i) => (
                  <div key={i} className="px-2 py-1 bg-lattice-surface rounded text-xs">
                    <p className="text-white font-semibold">{r.client}</p>
                    <p className="text-gray-400">{r.service} &bull; {r.date}</p>
                  </div>
                ))}
              </div>
            )}
            {/* revenueByProvider */}
            {actionResult.summary !== undefined && Array.isArray(actionResult.summary) && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.totalRevenue).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Total Revenue</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.period)}d period</p>
                    <p className="text-[10px] text-gray-500">Period</p>
                  </div>
                </div>
                {(actionResult.summary as {provider:string;appointments:number;revenue:number}[]).slice(0,4).map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-lattice-surface rounded text-xs">
                    <span className="text-gray-300">{p.provider}</span>
                    <span className="text-neon-cyan">${p.revenue.toLocaleString()} ({p.appointments} appts)</span>
                  </div>
                ))}
              </div>
            )}
            {/* supplyCheck */}
            {actionResult.needsOrder !== undefined && Array.isArray(actionResult.lowStock) && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.count) > 0 ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.count)}</p>
                    <p className="text-[10px] text-gray-500">Low Stock Items</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalItems)}</p>
                    <p className="text-[10px] text-gray-500">Total Items</p>
                  </div>
                </div>
                {(actionResult.lowStock as {name:string;currentStock:number;reorderPoint:number}[]).slice(0,4).map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-amber-500/10 rounded text-xs">
                    <span className="text-gray-300">{s.name}</span>
                    <span className="text-amber-400">{s.currentStock} / {s.reorderPoint} min</span>
                  </div>
                ))}
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
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)} aria-label="Close"><X className="w-5 h-5" /></button>
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

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="services"
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
            <LensFeaturePanel lensId="services" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ServicesFeed />
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <RevenueRetentionPanel />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#services-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to services content</a>
    </LensShell>
  );
}
