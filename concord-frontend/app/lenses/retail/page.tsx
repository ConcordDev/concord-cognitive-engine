'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Store,
  Package,
  ShoppingBag,
  Users,
  Target,
  Ticket,
  Monitor,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  TrendingUp,
  DollarSign,
  Clock,
  BarChart3,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Truck,
  CheckCircle2,
  Phone,
  Mail,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  ListChecks,
  Layers,
  History,
  ShieldCheck,
  AlertTriangle,
  Timer,
  ThumbsUp,
  RotateCcw,
  FileText,
  Zap,
  Activity,
  PieChart,
  Award,
  Crown,
  Gem,
  Medal,
  ArrowRight,
  PackageCheck,
  PackageX,
  RefreshCw,
  Send,
  Calendar,
  MapPin,
  Copy,
  Printer,
  Gauge,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Products' | 'Orders' | 'Customers' | 'Pipeline' | 'Support' | 'Displays';

type ArtifactType = 'Product' | 'Order' | 'Customer' | 'Lead' | 'Ticket' | 'Display';

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'returned';
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
type CustomerTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface ProductVariant { size: string; color: string; style: string; sku: string; stock: number; price: number; }
interface PriceHistoryEntry { date: string; price: number; reason: string; }
interface Product {
  name: string; sku: string; category: string; collection: string; price: number; costPrice: number;
  stock: number; reorderPoint: number; supplier: string; supplierContact: string; supplierLeadDays: number;
  barcode: string; variants: ProductVariant[]; priceHistory: PriceHistoryEntry[];
  dailySalesRate: number; turnoverRate: number; abcClass: string;
}
interface OrderEvent { timestamp: string; status: string; note: string; }
interface OrderNote { author: string; text: string; timestamp: string; internal: boolean; }
interface Order {
  orderNumber: string; customer: string; customerEmail: string; items: number; total: number;
  shippingMethod: string; trackingNumber: string; shippingAddress: string;
  timeline: OrderEvent[]; notes: OrderNote[]; returnReason: string; refundAmount: number;
}
interface PurchaseRecord { date: string; orderId: string; amount: number; items: number; }
interface Customer {
  name: string; email: string; phone: string; totalOrders: number; totalSpent: number; tier: CustomerTier;
  firstPurchase: string; lastPurchase: string; avgOrderValue: number; lifetimeValue: number;
  recencyScore: number; frequencyScore: number; monetaryScore: number; engagementScore: number;
  purchaseHistory: PurchaseRecord[]; notes: string; segment: string;
}
interface Lead {
  name: string; company: string; email: string; value: number; source: string;
  assignee: string; probability: number; expectedClose: string; lastContact: string;
  notes: string; nextAction: string;
}
interface TicketReply { author: string; text: string; timestamp: string; isInternal: boolean; }
interface Ticket {
  subject: string; customer: string; customerEmail: string; priority: string; category: string;
  assignee: string; slaDeadline: string; slaBreached: boolean; responseTemplate: string;
  replies: TicketReply[]; satisfactionScore: number; escalationLevel: number;
  tags: string[]; resolution: string;
}
interface Display {
  name: string; location: string; type: string; startDate: string; endDate: string;
  products: string[]; budget: number; impressions: number; conversions: number;
}

type ArtifactData = Product | Order | Customer | Lead | Ticket | Display;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof Store; types: ArtifactType[] }[] = [
  { id: 'Products', icon: Package, types: ['Product'] },
  { id: 'Orders', icon: ShoppingBag, types: ['Order'] },
  { id: 'Customers', icon: Users, types: ['Customer'] },
  { id: 'Pipeline', icon: Target, types: ['Lead'] },
  { id: 'Support', icon: Ticket, types: ['Ticket'] },
  { id: 'Displays', icon: Monitor, types: ['Display'] },
];

const ORDER_STATUS_COLORS: Record<OrderStatus, string> = { pending: 'yellow-400', processing: 'neon-blue', shipped: 'neon-cyan', delivered: 'green-400', returned: 'red-400' };
const LEAD_STATUS_COLORS: Record<LeadStatus, string> = { new: 'neon-cyan', contacted: 'neon-blue', qualified: 'neon-purple', proposal: 'yellow-400', negotiation: 'orange-400', won: 'green-400', lost: 'red-400' };
const TICKET_STATUS_COLORS: Record<TicketStatus, string> = { open: 'red-400', in_progress: 'neon-blue', waiting: 'yellow-400', resolved: 'green-400', closed: 'gray-400' };

const TIER_COLORS: Record<CustomerTier, string> = { Bronze: 'orange-400', Silver: 'gray-300', Gold: 'yellow-400', Platinum: 'neon-purple' };
const TIER_ICONS: Record<CustomerTier, typeof Star> = { Bronze: Medal, Silver: Award, Gold: Crown, Platinum: Gem };

const FUNNEL_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won'];
const ORDER_LIFECYCLE: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered'];
const PRIORITY_COLORS: Record<string, string> = { low: 'gray-400', medium: 'neon-blue', high: 'orange-400', critical: 'red-400' };
const ABC_COLORS: Record<string, string> = { A: 'green-400', B: 'yellow-400', C: 'red-400' };

const PRODUCT_CATEGORIES = ['Electronics', 'Furniture', 'Food & Beverage', 'Apparel', 'Health & Beauty', 'Sports', 'Home & Garden', 'Other'];
const PRODUCT_COLLECTIONS = ['New Arrivals', 'Best Sellers', 'Clearance', 'Seasonal', 'Premium', 'Everyday Essentials'];
const TICKET_CATEGORIES = ['Returns', 'Billing', 'Shipping', 'Product', 'Technical', 'Account', 'General'];
const RESPONSE_TEMPLATES = [
  'Thank you for contacting us. We are looking into your issue and will get back to you within 24 hours.',
  'We apologize for the inconvenience. A refund has been initiated and should appear in 3-5 business days.',
  'Your return has been approved. Please use the prepaid shipping label attached to send the item back.',
  'We have escalated your case to our senior support team. They will reach out within 2 hours.',
  'Great news! The issue has been resolved. Please let us know if there is anything else we can help with.',
];

function statusColorFor(type: ArtifactType, status: string): string {
  if (type === 'Order') return ORDER_STATUS_COLORS[status as OrderStatus] || 'gray-400';
  if (type === 'Lead') return LEAD_STATUS_COLORS[status as LeadStatus] || 'gray-400';
  if (type === 'Ticket') return TICKET_STATUS_COLORS[status as TicketStatus] || 'gray-400';
  return 'neon-cyan';
}

function statusOptionsFor(type: ArtifactType): string[] {
  if (type === 'Order') return ['pending', 'processing', 'shipped', 'delivered', 'returned'];
  if (type === 'Lead') return ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  if (type === 'Ticket') return ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
  return ['active'];
}

function calculateDaysOfSupply(stock: number, dailySalesRate: number): number {
  if (dailySalesRate <= 0) return 999;
  return Math.round(stock / dailySalesRate);
}

function calculateStockoutRisk(stock: number, reorderPoint: number, dailySalesRate: number, supplierLeadDays: number): 'low' | 'medium' | 'high' | 'critical' {
  const daysOfSupply = calculateDaysOfSupply(stock, dailySalesRate);
  if (stock <= 0) return 'critical';
  if (daysOfSupply <= supplierLeadDays) return 'high';
  if (stock <= reorderPoint * 1.5) return 'medium';
  return 'low';
}

function assignTier(totalSpent: number, totalOrders: number): CustomerTier {
  if (totalSpent >= 10000 || totalOrders >= 50) return 'Platinum';
  if (totalSpent >= 5000 || totalOrders >= 25) return 'Gold';
  if (totalSpent >= 1000 || totalOrders >= 10) return 'Silver';
  return 'Bronze';
}

function formatCurrency(val: number): string {
  return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompactCurrency(val: number): string {
  if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
  return '$' + val.toFixed(0);
}

function getSLATimeRemaining(deadline: string): { text: string; urgent: boolean; breached: boolean } {
  const now = new Date().getTime();
  const dl = new Date(deadline).getTime();
  const diff = dl - now;
  if (diff < 0) return { text: 'BREACHED', urgent: true, breached: true };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours < 2) return { text: `${hours}h ${mins}m`, urgent: true, breached: false };
  return { text: `${hours}h ${mins}m`, urgent: false, breached: false };
}

const seedData: Record<ArtifactType, { title: string; data: Record<string, unknown>; meta: Record<string, unknown> }[]> = {
  Product: [],
  Order: [],
  Customer: [],
  Lead: [],
  Ticket: [],
  Display: [],
};

/* ------------------------------------------------------------------ */
/*  Sub-tab types for deep features                                    */
/* ------------------------------------------------------------------ */

type ProductSubTab = 'catalog' | 'variants' | 'inventory' | 'pricing';
type OrderSubTab = 'list' | 'timeline' | 'returns';
type CustomerSubTab = 'directory' | 'segments' | 'rfm';
type PipelineSubTab = 'deals' | 'funnel';
type SupportSubTab = 'tickets' | 'sla' | 'templates';

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export default function RetailLensPage() {
  useLensNav('retail');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('retail');

  const [mode, setMode] = useState<ModeTab>('Products');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'dashboard'>('library');
  const [showFeatures, setShowFeatures] = useState(true);

  /* Sub-tab state for deep features */
  const [productSubTab, setProductSubTab] = useState<ProductSubTab>('catalog');
  const [orderSubTab, setOrderSubTab] = useState<OrderSubTab>('list');
  const [customerSubTab, setCustomerSubTab] = useState<CustomerSubTab>('directory');
  const [pipelineSubTab, setPipelineSubTab] = useState<PipelineSubTab>('deals');
  const [supportSubTab, setSupportSubTab] = useState<SupportSubTab>('tickets');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('active');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const currentType = MODE_TABS.find(t => t.id === mode)!.types[0];

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactData>('retail', currentType, {
    seed: seedData[currentType] || [],
  });

  const runAction = useRunArtifact('retail');

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) ||
        JSON.stringify(i.data).toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  /* ---- editor ---- */
  const openNew = () => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(statusOptionsFor(currentType)[0]);
    setFormData({});
    setShowEditor(true);
  };

  const openEdit = (item: LensItem<ArtifactData>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus(item.meta.status || 'active');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = { title: formTitle, data: formData, meta: { status: formStatus } };
    if (editingId) await update(editingId, payload);
    else await create(payload);
    setShowEditor(false);
  };

  const handleDelete = async (id: string) => { await remove(id); };

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingId || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [editingId, filtered, runAction]);

  /* ---- computed metrics ---- */
  const pipelineByStage = useMemo(() => {
    if (currentType !== 'Lead' && mode !== 'Pipeline') return {};
    const stages: Record<string, { count: number; value: number; avgDeal: number }> = {};
    FUNNEL_STAGES.forEach(s => { stages[s] = { count: 0, value: 0, avgDeal: 0 }; });
    items.forEach(i => {
      const d = i.data as unknown as Lead;
      const st = i.meta.status as string;
      if (stages[st]) {
        stages[st].count += 1;
        stages[st].value += d.value || 0;
      }
    });
    Object.values(stages).forEach(s => {
      s.avgDeal = s.count > 0 ? Math.round(s.value / s.count) : 0;
    });
    return stages;
  }, [items, currentType, mode]);

  const totalPipelineValue = useMemo(() => {
    return items.reduce((sum, i) => {
      const d = i.data as unknown as Lead;
      if (i.meta.status !== 'won' && i.meta.status !== 'lost') return sum + (d.value || 0);
      return sum;
    }, 0);
  }, [items]);

  const wonDeals = useMemo(() => items.filter(i => i.meta.status === 'won'), [items]);
  const lostDeals = useMemo(() => items.filter(i => i.meta.status === 'lost'), [items]);
  const winRate = useMemo(() => {
    const closed = wonDeals.length + lostDeals.length;
    return closed > 0 ? Math.round((wonDeals.length / closed) * 100) : 0;
  }, [wonDeals, lostDeals]);

  const customerLTV = useMemo(() => {
    const customers = items.length || 1;
    return items.reduce((sum, i) => sum + ((i.data as unknown as Customer).totalSpent || 0), 0) / customers;
  }, [items]);

  const lowStockProducts = useMemo(() => {
    return items.filter(i => {
      const d = i.data as unknown as Product;
      return d.stock <= d.reorderPoint;
    });
  }, [items]);

  const openTicketCount = useMemo(() => {
    return items.filter(i => i.meta.status === 'open' || i.meta.status === 'in_progress').length;
  }, [items]);

  const totalRevenue = useMemo(() => {
    return items.reduce((sum, i) => sum + ((i.data as unknown as Order).total || 0), 0);
  }, [items]);

  const avgOrderValue = useMemo(() => {
    return items.length > 0 ? totalRevenue / items.length : 0;
  }, [items, totalRevenue]);

  const inventoryHealthScore = useMemo(() => {
    if (items.length === 0) return 100;
    const healthy = items.filter(i => {
      const d = i.data as unknown as Product;
      return d.stock > d.reorderPoint;
    }).length;
    return Math.round((healthy / items.length) * 100);
  }, [items]);

  const customersByTier = useMemo(() => {
    const tiers: Record<CustomerTier, number> = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 };
    items.forEach(i => {
      const d = i.data as unknown as Customer;
      const tier = d.tier || assignTier(d.totalSpent || 0, d.totalOrders || 0);
      if (tiers[tier as CustomerTier] !== undefined) tiers[tier as CustomerTier] += 1;
    });
    return tiers;
  }, [items]);

  const abcAnalysis = useMemo(() => {
    const products = items.map(i => {
      const d = i.data as unknown as Product;
      return { id: i.id, title: i.title, revenue: (d.price || 0) * (d.dailySalesRate || 0) * 30, data: d };
    }).sort((a, b) => b.revenue - a.revenue);
    const totalRev = products.reduce((s, p) => s + p.revenue, 0);
    let cumulative = 0;
    return products.map(p => {
      cumulative += p.revenue;
      const pct = totalRev > 0 ? (cumulative / totalRev) * 100 : 0;
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...p, cumulativePct: pct, abcClass: cls };
    });
  }, [items]);

  /* ---- badge ---- */
  const renderStatusBadge = (status: string, type?: ArtifactType) => {
    const color = statusColorFor(type || currentType, status);
    return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
  };

  const renderPriorityBadge = (priority: string) => {
    const color = PRIORITY_COLORS[priority] || 'gray-400';
    return <span className={ds.badge(color)}>{priority}</span>;
  };

  const renderTierBadge = (tier: CustomerTier) => {
    const color = TIER_COLORS[tier] || 'gray-400';
    const TierIcon = TIER_ICONS[tier] || Star;
    return <span className={ds.badge(color)}><TierIcon className="w-3 h-3" /> {tier}</span>;
  };

  /* ------------------------------------------------------------------ */
  /*  Metric Card Component                                              */
  /* ------------------------------------------------------------------ */
  const MetricCard = ({ icon: Icon, label, value, subtext, trend, trendUp, color = 'neon-cyan' }: {
    icon: typeof DollarSign; label: string; value: string; subtext?: string;
    trend?: string; trendUp?: boolean; color?: string;
  }) => (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', `text-${color}`)} />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <p className={ds.heading2}>{value}</p>
      {subtext && <p className={ds.textMuted}>{subtext}</p>}
      {trend && (
        <div className={cn('flex items-center gap-1 mt-1 text-sm', trendUp ? 'text-green-400' : 'text-red-400')}>
          {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {trend}
        </div>
      )}
    </div>
  );

  /* ------------------------------------------------------------------ */
  /*  Sales Funnel Visualization                                         */
  /* ------------------------------------------------------------------ */
  const renderFunnelVisualization = () => {
    const stages = FUNNEL_STAGES;
    const stageData = stages.map((stage, idx) => {
      const data = pipelineByStage[stage] || { count: 0, value: 0, avgDeal: 0 };
      const prevData = idx > 0 ? (pipelineByStage[stages[idx - 1]] || { count: 0 }) : null;
      const conversionRate = prevData && prevData.count > 0 ? Math.round((data.count / prevData.count) * 100) : null;
      return { stage, ...data, conversionRate };
    });
    const maxCount = Math.max(...stageData.map(s => s.count), 1);

    return (
      <div className={ds.panel}>
        <div className={cn(ds.sectionHeader, 'mb-6')}>
          <h3 className={ds.heading3}>Sales Funnel</h3>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className={ds.textMuted}>Total Pipeline</p>
              <p className="text-lg font-bold text-neon-purple">{formatCompactCurrency(totalPipelineValue)}</p>
            </div>
            <div className="text-right">
              <p className={ds.textMuted}>Win Rate</p>
              <p className="text-lg font-bold text-green-400">{winRate}%</p>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          {stageData.map((s, _idx) => {
            const widthPct = Math.max(20, (s.count / maxCount) * 100);
            const color = LEAD_STATUS_COLORS[s.stage as LeadStatus] || 'gray-400';
            return (
              <div key={s.stage}>
                {s.conversionRate !== null && (
                  <div className="flex items-center justify-center my-1">
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                    <span className="text-xs text-gray-500 mx-2">{s.conversionRate}% conversion</span>
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-right">
                    <span className="text-sm text-gray-300 capitalize">{s.stage}</span>
                  </div>
                  <div className="flex-1 relative">
                    <div
                      className={cn('h-10 rounded-lg flex items-center justify-between px-3 transition-all', `bg-${color}/20 border border-${color}/30`)}
                      style={{ width: `${widthPct}%`, margin: '0 auto', marginLeft: `${(100 - widthPct) / 2}%` }}
                    >
                      <span className="text-sm font-semibold text-white">{s.count} deals</span>
                      <span className="text-sm text-gray-300">{formatCompactCurrency(s.value)}</span>
                    </div>
                  </div>
                  <div className="w-24 text-left">
                    <span className={ds.textMuted}>avg {formatCompactCurrency(s.avgDeal)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Order Timeline Visualization                                       */
  /* ------------------------------------------------------------------ */
  const renderOrderTimeline = (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as Order;
    const currentStatus = item.meta.status as OrderStatus;
    const currentIdx = ORDER_LIFECYCLE.indexOf(currentStatus);

    return (
      <div className={ds.panel}>
        <div className={cn(ds.sectionHeader, 'mb-4')}>
          <h3 className={ds.heading3}>Order #{d.orderNumber || item.title}</h3>
          {renderStatusBadge(currentStatus)}
        </div>
        {/* Status timeline bar */}
        <div className="flex items-center gap-0 mb-6">
          {ORDER_LIFECYCLE.map((stage, idx) => {
            const isComplete = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            const color = ORDER_STATUS_COLORS[stage];
            return (
              <div key={stage} className="flex-1 flex items-center">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                  isComplete ? `bg-${color}/30 border-${color} text-${color}` : 'bg-lattice-elevated border-gray-600 text-gray-500',
                  isCurrent && 'ring-2 ring-offset-2 ring-offset-lattice-void ring-neon-blue'
                )}>
                  {isComplete ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                {idx < ORDER_LIFECYCLE.length - 1 && (
                  <div className={cn('flex-1 h-0.5 mx-1', isComplete ? `bg-${color}` : 'bg-gray-700')} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mb-6">
          {ORDER_LIFECYCLE.map((stage) => (
            <span key={stage} className="text-xs text-gray-400 capitalize flex-1 text-center">{stage}</span>
          ))}
        </div>
        {/* Order details */}
        <div className={ds.grid2}>
          <div>
            <p className={ds.label}>Customer</p>
            <p className="text-white text-sm">{d.customer || 'N/A'}</p>
          </div>
          <div>
            <p className={ds.label}>Total</p>
            <p className="text-white text-sm font-semibold">{formatCurrency(d.total || 0)}</p>
          </div>
          <div>
            <p className={ds.label}>Shipping</p>
            <p className="text-white text-sm">{d.shippingMethod || 'Standard'}</p>
          </div>
          <div>
            <p className={ds.label}>Tracking</p>
            <p className={cn(ds.textMono, 'text-neon-cyan')}>{d.trackingNumber || 'Awaiting'}</p>
          </div>
        </div>
        {/* Timeline events */}
        {Boolean(d.timeline) && d.timeline.length > 0 && (
          <div className="mt-4 border-t border-lattice-border pt-4">
            <h4 className="text-sm font-medium text-gray-300 mb-3">Event History</h4>
            <div className="space-y-3">
              {d.timeline.map((event, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-neon-cyan mt-1.5 shrink-0" />
                  <div>
                    <p className="text-sm text-white">{event.status}</p>
                    <p className={ds.textMuted}>{event.note}</p>
                    <p className="text-xs text-gray-500">{event.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-2 flex-wrap border-t border-lattice-border pt-4">
          <button className={cn(ds.btnSecondary, ds.btnSmall)} onClick={() => handleAction('generate_label', item.id)}>
            <Printer className="w-3.5 h-3.5" /> Generate Label
          </button>
          <button className={cn(ds.btnSecondary, ds.btnSmall)} onClick={() => handleAction('send_tracking', item.id)}>
            <Send className="w-3.5 h-3.5" /> Send Tracking
          </button>
          {currentStatus === 'delivered' && (
            <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleAction('initiate_return', item.id)}>
              <RotateCcw className="w-3.5 h-3.5" /> Initiate Return
            </button>
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Customer RFM Analysis Panel                                        */
  /* ------------------------------------------------------------------ */
  const renderRFMAnalysis = () => {
    const customers = items.map(i => {
      const d = i.data as unknown as Customer;
      return {
        id: i.id, title: i.title, data: d,
        recency: d.recencyScore || 1,
        frequency: d.frequencyScore || 1,
        monetary: d.monetaryScore || 1,
      };
    }).map(c => ({
      ...c,
      rfmScore: c.recency + c.frequency + c.monetary,
      segment: c.recency + c.frequency + c.monetary >= 12 ? 'Champions' :
        c.recency + c.frequency + c.monetary >= 9 ? 'Loyal' :
        c.recency + c.frequency + c.monetary >= 6 ? 'Potential' :
        c.recency + c.frequency + c.monetary >= 3 ? 'At Risk' : 'Lost',
    }));

    const segments = ['Champions', 'Loyal', 'Potential', 'At Risk', 'Lost'];
    const segmentColors: Record<string, string> = {
      Champions: 'green-400', Loyal: 'neon-blue', Potential: 'neon-cyan', 'At Risk': 'yellow-400', Lost: 'red-400',
    };
    const segmentCounts = segments.map(s => ({
      segment: s,
      count: customers.filter(c => c.segment === s).length,
      color: segmentColors[s],
    }));

    return (
      <div className="space-y-4">
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>RFM Segmentation Overview</h3>
          <div className={ds.grid3}>
            {segmentCounts.map(s => (
              <div key={s.segment} className={cn('p-3 rounded-lg', `bg-${s.color}/10 border border-${s.color}/20`)}>
                <div className="flex items-center justify-between">
                  <span className={cn('text-sm font-medium', `text-${s.color}`)}>{s.segment}</span>
                  <span className="text-xl font-bold text-white">{s.count}</span>
                </div>
                <div className="mt-2 w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className={cn('h-1.5 rounded-full', `bg-${s.color}`)}
                    style={{ width: `${customers.length > 0 ? (s.count / customers.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Customer RFM table */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Customer Scores</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="text-left py-2 text-gray-400 font-medium">Customer</th>
                  <th className="text-center py-2 text-gray-400 font-medium">R</th>
                  <th className="text-center py-2 text-gray-400 font-medium">F</th>
                  <th className="text-center py-2 text-gray-400 font-medium">M</th>
                  <th className="text-center py-2 text-gray-400 font-medium">Score</th>
                  <th className="text-left py-2 text-gray-400 font-medium">Segment</th>
                  <th className="text-right py-2 text-gray-400 font-medium">LTV</th>
                </tr>
              </thead>
              <tbody>
                {customers.slice(0, 20).map(c => (
                  <tr key={c.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50">
                    <td className="py-2 text-white">{c.title}</td>
                    <td className="py-2 text-center"><span className={ds.badge(c.recency >= 4 ? 'green-400' : c.recency >= 2 ? 'yellow-400' : 'red-400')}>{c.recency}</span></td>
                    <td className="py-2 text-center"><span className={ds.badge(c.frequency >= 4 ? 'green-400' : c.frequency >= 2 ? 'yellow-400' : 'red-400')}>{c.frequency}</span></td>
                    <td className="py-2 text-center"><span className={ds.badge(c.monetary >= 4 ? 'green-400' : c.monetary >= 2 ? 'yellow-400' : 'red-400')}>{c.monetary}</span></td>
                    <td className="py-2 text-center font-bold text-white">{c.rfmScore}</td>
                    <td className="py-2"><span className={ds.badge(segmentColors[c.segment])}>{c.segment}</span></td>
                    <td className="py-2 text-right text-gray-300">{formatCurrency(c.data.lifetimeValue || c.data.totalSpent || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Customer Tier Overview Panel                                       */
  /* ------------------------------------------------------------------ */
  const renderCustomerTiers = () => {
    const tiers: CustomerTier[] = ['Platinum', 'Gold', 'Silver', 'Bronze'];
    const tierRules: Record<CustomerTier, string> = {
      Platinum: '$10,000+ spent or 50+ orders',
      Gold: '$5,000+ spent or 25+ orders',
      Silver: '$1,000+ spent or 10+ orders',
      Bronze: 'All other customers',
    };

    return (
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Customer Tiers</h3>
        <div className="space-y-3">
          {tiers.map(tier => {
            const TierIcon = TIER_ICONS[tier];
            const color = TIER_COLORS[tier];
            const count = customersByTier[tier];
            const total = items.length || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={tier} className={cn('p-4 rounded-lg border', `bg-${color}/5 border-${color}/20`)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TierIcon className={cn('w-5 h-5', `text-${color}`)} />
                    <span className="font-semibold text-white">{tier}</span>
                  </div>
                  <span className="text-lg font-bold text-white">{count}</span>
                </div>
                <p className={ds.textMuted}>{tierRules[tier]}</p>
                <div className="mt-2 w-full bg-gray-800 rounded-full h-2">
                  <div className={cn('h-2 rounded-full transition-all', `bg-${color}`)} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{pct}% of customers</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  SLA Dashboard                                                      */
  /* ------------------------------------------------------------------ */
  const renderSLADashboard = () => {
    const tickets = items.map(i => {
      const d = i.data as unknown as Ticket;
      const sla = d.slaDeadline ? getSLATimeRemaining(d.slaDeadline) : { text: 'No SLA', urgent: false, breached: false };
      return { id: i.id, title: i.title, status: i.meta.status, data: d, sla };
    });

    const breachedCount = tickets.filter(t => t.sla.breached).length;
    const urgentCount = tickets.filter(t => t.sla.urgent && !t.sla.breached).length;
    const onTrackCount = tickets.filter(t => !t.sla.urgent && !t.sla.breached).length;
    const resolvedCount = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
    const slaCompliance = tickets.length > 0 ? Math.round(((tickets.length - breachedCount) / tickets.length) * 100) : 100;
    const avgSatisfaction = tickets.reduce((s, t) => s + (t.data.satisfactionScore || 0), 0) / (tickets.length || 1);

    return (
      <div className="space-y-4">
        <div className={ds.grid4}>
          <MetricCard icon={ShieldCheck} label="SLA Compliance" value={`${slaCompliance}%`} color="green-400" subtext={`${breachedCount} breached`} />
          <MetricCard icon={AlertTriangle} label="Urgent" value={String(urgentCount)} color="yellow-400" subtext="Approaching deadline" />
          <MetricCard icon={AlertCircle} label="On Track" value={String(onTrackCount)} color="green-400" subtext={`${resolvedCount} resolved`} />
          <MetricCard icon={ThumbsUp} label="Avg Satisfaction" value={avgSatisfaction.toFixed(1)} color="neon-cyan" subtext="out of 5.0" />
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Active SLA Tracking</h3>
          <div className="space-y-2">
            {tickets
              .filter(t => t.status !== 'resolved' && t.status !== 'closed')
              .sort((a, b) => {
                if (a.sla.breached && !b.sla.breached) return -1;
                if (b.sla.breached && !a.sla.breached) return 1;
                if (a.sla.urgent && !b.sla.urgent) return -1;
                return 0;
              })
              .map(t => (
                <div key={t.id} className={cn(
                  'flex items-center justify-between p-3 rounded-lg border',
                  t.sla.breached ? 'bg-red-500/10 border-red-500/30' :
                  t.sla.urgent ? 'bg-yellow-400/10 border-yellow-400/30' :
                  'bg-lattice-elevated border-lattice-border'
                )}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      t.sla.breached ? 'bg-red-400 animate-pulse' : t.sla.urgent ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'
                    )} />
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{t.data.subject || t.title}</p>
                      <p className={ds.textMuted}>{t.data.customer} | {t.data.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {renderPriorityBadge(t.data.priority || 'medium')}
                    {renderStatusBadge(t.status as string)}
                    <div className={cn(
                      'flex items-center gap-1 text-sm font-mono',
                      t.sla.breached ? 'text-red-400' : t.sla.urgent ? 'text-yellow-400' : 'text-green-400'
                    )}>
                      <Timer className="w-3.5 h-3.5" />
                      {t.sla.text}
                    </div>
                  </div>
                </div>
              ))}
            {tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length === 0 && (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className={ds.textMuted}>All tickets resolved or closed!</p>
              </div>
            )}
          </div>
        </div>

        {/* Escalation rules */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Escalation Rules</h3>
          <div className="space-y-3">
            {[
              { trigger: 'SLA < 2 hours remaining', action: 'Notify team lead', level: 'Level 1', color: 'yellow-400' },
              { trigger: 'SLA breached', action: 'Escalate to manager', level: 'Level 2', color: 'orange-400' },
              { trigger: 'Critical priority + SLA < 1 hour', action: 'Escalate to VP Support', level: 'Level 3', color: 'red-400' },
              { trigger: 'Customer satisfaction < 2.0', action: 'Flag for review', level: 'Review', color: 'neon-purple' },
            ].map((rule, idx) => (
              <div key={idx} className="flex items-center gap-4 p-3 rounded-lg bg-lattice-elevated border border-lattice-border">
                <span className={ds.badge(rule.color)}>{rule.level}</span>
                <div className="flex-1">
                  <p className="text-sm text-white">{rule.trigger}</p>
                  <p className={ds.textMuted}>{rule.action}</p>
                </div>
                <Zap className={cn('w-4 h-4', `text-${rule.color}`)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Response Templates Panel                                           */
  /* ------------------------------------------------------------------ */
  const renderResponseTemplates = () => (
    <div className={ds.panel}>
      <h3 className={cn(ds.heading3, 'mb-4')}>Response Templates</h3>
      <div className="space-y-3">
        {RESPONSE_TEMPLATES.map((template, idx) => (
          <div key={idx} className="p-3 rounded-lg bg-lattice-elevated border border-lattice-border hover:border-neon-cyan/30 transition-colors">
            <p className="text-sm text-gray-300 mb-2">{template}</p>
            <div className="flex items-center gap-2">
              <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => navigator.clipboard?.writeText(template)}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button onClick={() => { const el = document.querySelector<HTMLParagraphElement>(`[data-template="${idx}"]`); if (el) { el.contentEditable = 'true'; el.focus(); } }} className={cn(ds.btnGhost, ds.btnSmall)}>
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /*  Inventory Forecasting Panel                                        */
  /* ------------------------------------------------------------------ */
  const renderInventoryForecasting = () => {
    const products = items.map(i => {
      const d = i.data as unknown as Product;
      const daysOfSupply = calculateDaysOfSupply(d.stock || 0, d.dailySalesRate || 0);
      const stockoutRisk = calculateStockoutRisk(d.stock || 0, d.reorderPoint || 0, d.dailySalesRate || 0, d.supplierLeadDays || 7);
      return { id: i.id, title: i.title, data: d, daysOfSupply, stockoutRisk };
    });

    const criticalProducts = products.filter(p => p.stockoutRisk === 'critical');
    const highRiskProducts = products.filter(p => p.stockoutRisk === 'high');
    const mediumRiskProducts = products.filter(p => p.stockoutRisk === 'medium');

    return (
      <div className="space-y-4">
        <div className={ds.grid4}>
          <MetricCard icon={Gauge} label="Inventory Health" value={`${inventoryHealthScore}%`} color={inventoryHealthScore >= 80 ? 'green-400' : inventoryHealthScore >= 50 ? 'yellow-400' : 'red-400'} />
          <MetricCard icon={PackageX} label="Stockout Risk" value={String(criticalProducts.length + highRiskProducts.length)} color="red-400" subtext={`${mediumRiskProducts.length} medium risk`} />
          <MetricCard icon={RefreshCw} label="Avg Turnover" value={(products.reduce((s, p) => s + (p.data.turnoverRate || 0), 0) / (products.length || 1)).toFixed(1) + 'x'} color="neon-cyan" subtext="monthly" />
          <MetricCard icon={AlertTriangle} label="Below Reorder" value={String(lowStockProducts.length)} color="yellow-400" subtext="need reordering" />
        </div>

        {/* Reorder Alerts */}
        {(criticalProducts.length > 0 || highRiskProducts.length > 0) && (
          <div className={cn(ds.panel, 'border-red-500/30')}>
            <h3 className={cn(ds.heading3, 'mb-3 text-red-400')}>
              <AlertCircle className="w-5 h-5 inline mr-2" />
              Reorder Alerts
            </h3>
            <div className="space-y-2">
              {[...criticalProducts, ...highRiskProducts].map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-3 h-3 rounded-full',
                      p.stockoutRisk === 'critical' ? 'bg-red-400 animate-pulse' : 'bg-orange-400'
                    )} />
                    <div>
                      <p className="text-sm font-medium text-white">{p.title}</p>
                      <p className={ds.textMuted}>
                        Stock: {p.data.stock} | Reorder at: {p.data.reorderPoint} |
                        Days supply: {p.daysOfSupply === 999 ? 'N/A' : p.daysOfSupply + 'd'} |
                        Lead time: {p.data.supplierLeadDays || 7}d
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={ds.badge(p.stockoutRisk === 'critical' ? 'red-400' : 'orange-400')}>
                      {p.stockoutRisk}
                    </span>
                    <button className={cn(ds.btnSecondary, ds.btnSmall)} onClick={() => handleAction('reorder_check', p.id)}>
                      <Truck className="w-3.5 h-3.5" /> Reorder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ABC Analysis */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>ABC Analysis (Revenue Contribution)</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {(['A', 'B', 'C'] as const).map(cls => {
              const count = abcAnalysis.filter(p => p.abcClass === cls).length;
              const descriptions: Record<string, string> = { A: 'Top 80% revenue', B: '80-95% revenue', C: 'Bottom 5% revenue' };
              return (
                <div key={cls} className={cn('p-3 rounded-lg text-center', `bg-${ABC_COLORS[cls]}/10 border border-${ABC_COLORS[cls]}/20`)}>
                  <span className={cn('text-2xl font-bold', `text-${ABC_COLORS[cls]}`)}>{cls}</span>
                  <p className="text-lg font-semibold text-white mt-1">{count} products</p>
                  <p className={ds.textMuted}>{descriptions[cls]}</p>
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="text-left py-2 text-gray-400 font-medium">Product</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Est. Monthly Rev</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Cumulative %</th>
                  <th className="text-center py-2 text-gray-400 font-medium">Class</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Stock</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Days Supply</th>
                </tr>
              </thead>
              <tbody>
                {abcAnalysis.slice(0, 15).map(p => {
                  const dos = calculateDaysOfSupply(p.data.stock || 0, p.data.dailySalesRate || 0);
                  return (
                    <tr key={p.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50">
                      <td className="py-2 text-white">{p.title}</td>
                      <td className="py-2 text-right text-gray-300">{formatCurrency(p.revenue)}</td>
                      <td className="py-2 text-right text-gray-300">{p.cumulativePct.toFixed(1)}%</td>
                      <td className="py-2 text-center"><span className={ds.badge(ABC_COLORS[p.abcClass] || 'gray-400')}>{p.abcClass}</span></td>
                      <td className="py-2 text-right text-gray-300">{p.data.stock || 0}</td>
                      <td className={cn('py-2 text-right', dos <= 7 ? 'text-red-400' : dos <= 14 ? 'text-yellow-400' : 'text-gray-300')}>
                        {dos === 999 ? 'N/A' : dos + 'd'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Variant Management Panel                                           */
  /* ------------------------------------------------------------------ */
  const renderVariantManagement = () => {
    const productsWithVariants = items.filter(i => {
      const d = i.data as unknown as Product;
      return d.variants && d.variants.length > 0;
    });

    return (
      <div className="space-y-4">
        <div className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h3 className={ds.heading3}>Variant Management</h3>
            <span className={ds.textMuted}>{productsWithVariants.length} products with variants</span>
          </div>
          {items.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className={ds.textMuted}>No products yet. Add products to manage variants.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.slice(0, 10).map(item => {
                const d = item.data as unknown as Product;
                const variants = d.variants || [];
                return (
                  <div key={item.id} className="p-4 rounded-lg bg-lattice-elevated border border-lattice-border">
                    <div className={cn(ds.sectionHeader, 'mb-3')}>
                      <div>
                        <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                        <p className={cn(ds.textMono, 'text-gray-500')}>SKU: {d.sku || 'N/A'} | Barcode: {d.barcode || 'N/A'}</p>
                      </div>
                      <span className={ds.textMuted}>{variants.length} variant{variants.length !== 1 ? 's' : ''}</span>
                    </div>
                    {variants.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-lattice-border">
                              <th className="text-left py-1.5 text-gray-500 font-medium">Size</th>
                              <th className="text-left py-1.5 text-gray-500 font-medium">Color</th>
                              <th className="text-left py-1.5 text-gray-500 font-medium">Style</th>
                              <th className="text-left py-1.5 text-gray-500 font-medium">SKU</th>
                              <th className="text-right py-1.5 text-gray-500 font-medium">Stock</th>
                              <th className="text-right py-1.5 text-gray-500 font-medium">Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {variants.map((v, idx) => (
                              <tr key={idx} className="border-b border-lattice-border/30">
                                <td className="py-1.5 text-gray-300">{v.size || '-'}</td>
                                <td className="py-1.5 text-gray-300">{v.color || '-'}</td>
                                <td className="py-1.5 text-gray-300">{v.style || '-'}</td>
                                <td className={cn(ds.textMono, 'py-1.5 text-gray-400')}>{v.sku || '-'}</td>
                                <td className={cn('py-1.5 text-right', (v.stock || 0) <= 5 ? 'text-red-400' : 'text-gray-300')}>{v.stock || 0}</td>
                                <td className="py-1.5 text-right text-gray-300">{formatCurrency(v.price || d.price || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">No variants defined. Edit this product to add size/color/style combinations.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Price History Panel                                                 */
  /* ------------------------------------------------------------------ */
  const renderPricingHistory = () => (
    <div className="space-y-4">
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Price History Tracker</h3>
        {items.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className={ds.textMuted}>No products yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.slice(0, 10).map(item => {
              const d = item.data as unknown as Product;
              const history = d.priceHistory || [];
              const margin = d.costPrice ? Math.round(((d.price - d.costPrice) / d.price) * 100) : null;
              return (
                <div key={item.id} className="p-4 rounded-lg bg-lattice-elevated border border-lattice-border">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                      <p className={ds.textMuted}>Current: {formatCurrency(d.price || 0)} | Cost: {formatCurrency(d.costPrice || 0)}</p>
                    </div>
                    <div className="text-right">
                      {margin !== null && (
                        <span className={ds.badge(margin >= 40 ? 'green-400' : margin >= 20 ? 'yellow-400' : 'red-400')}>
                          {margin}% margin
                        </span>
                      )}
                    </div>
                  </div>
                  {history.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {history.slice(0, 5).map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <Calendar className="w-3 h-3 text-gray-500" />
                          <span className="text-gray-500 w-20">{entry.date}</span>
                          <span className="text-white font-mono">{formatCurrency(entry.price)}</span>
                          <span className="text-gray-500">- {entry.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic mt-1">No price changes recorded.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /*  Return/Refund Workflow Panel                                       */
  /* ------------------------------------------------------------------ */
  const renderReturnsPanel = () => {
    const returnedOrders = items.filter(i => i.meta.status === 'returned');
    const totalRefunds = returnedOrders.reduce((s, i) => s + ((i.data as unknown as Order).refundAmount || 0), 0);
    const returnRate = items.length > 0 ? Math.round((returnedOrders.length / items.length) * 100) : 0;

    return (
      <div className="space-y-4">
        <div className={ds.grid3}>
          <MetricCard icon={RotateCcw} label="Returns" value={String(returnedOrders.length)} color="red-400" subtext={`${returnRate}% return rate`} />
          <MetricCard icon={DollarSign} label="Total Refunds" value={formatCurrency(totalRefunds)} color="orange-400" />
          <MetricCard icon={Clock} label="Avg Resolution" value="2.4 days" color="neon-cyan" />
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Return Requests</h3>
          {returnedOrders.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className={ds.textMuted}>No returns pending.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {returnedOrders.map(item => {
                const d = item.data as unknown as Order;
                return (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div>
                      <p className="text-sm font-medium text-white">Order #{d.orderNumber || item.title}</p>
                      <p className={ds.textMuted}>{d.customer} | {d.returnReason || 'No reason specified'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-red-400">{formatCurrency(d.refundAmount || d.total || 0)}</span>
                      <button className={cn(ds.btnSecondary, ds.btnSmall)} onClick={() => handleAction('process_refund', item.id)}>
                        <DollarSign className="w-3.5 h-3.5" /> Refund
                      </button>
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

  /* ------------------------------------------------------------------ */
  /*  Sub-tab rendering                                                  */
  /* ------------------------------------------------------------------ */
  const renderSubTabs = (tabs: { id: string; label: string; icon: typeof Package }[], active: string, onChange: (id: string) => void) => (
    <div className="flex items-center gap-1 mb-4 flex-wrap">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap',
              active === tab.id
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  /* ---- form fields ---- */
  const renderFormFields = () => {
    switch (currentType) {
      case 'Product':
        return (
          <>
            <div><label className={ds.label}>Product Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>SKU</label><input className={ds.input} value={(formData.sku as string) || ''} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="e.g., PROD-001" /></div>
              <div><label className={ds.label}>Barcode</label><input className={ds.input} value={(formData.barcode as string) || ''} onChange={e => setFormData({ ...formData, barcode: e.target.value })} placeholder="e.g., 012345678901" /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })}><option value="">Select...</option>{PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className={ds.label}>Collection</label><select className={ds.select} value={(formData.collection as string) || ''} onChange={e => setFormData({ ...formData, collection: e.target.value })}><option value="">Select...</option>{PRODUCT_COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.price as number) || ''} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Cost Price ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.costPrice as number) || ''} onChange={e => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Stock</label><input type="number" className={ds.input} value={(formData.stock as number) || ''} onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Reorder Point</label><input type="number" className={ds.input} value={(formData.reorderPoint as number) || ''} onChange={e => setFormData({ ...formData, reorderPoint: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Daily Sales Rate</label><input type="number" step="0.1" className={ds.input} value={(formData.dailySalesRate as number) || ''} onChange={e => setFormData({ ...formData, dailySalesRate: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Turnover Rate</label><input type="number" step="0.1" className={ds.input} value={(formData.turnoverRate as number) || ''} onChange={e => setFormData({ ...formData, turnoverRate: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Supplier</label><input className={ds.input} value={(formData.supplier as string) || ''} onChange={e => setFormData({ ...formData, supplier: e.target.value })} /></div>
              <div><label className={ds.label}>Supplier Contact</label><input className={ds.input} value={(formData.supplierContact as string) || ''} onChange={e => setFormData({ ...formData, supplierContact: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Supplier Lead Days</label><input type="number" className={ds.input} value={(formData.supplierLeadDays as number) || ''} onChange={e => setFormData({ ...formData, supplierLeadDays: parseInt(e.target.value) || 0 })} /></div>
          </>
        );
      case 'Order':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Order Number</label><input className={ds.input} value={(formData.orderNumber as string) || ''} onChange={e => setFormData({ ...formData, orderNumber: e.target.value })} /></div>
              <div><label className={ds.label}>Customer</label><input className={ds.input} value={(formData.customer as string) || ''} onChange={e => setFormData({ ...formData, customer: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Customer Email</label><input type="email" className={ds.input} value={(formData.customerEmail as string) || ''} onChange={e => setFormData({ ...formData, customerEmail: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Items Count</label><input type="number" className={ds.input} value={(formData.items as number) || ''} onChange={e => setFormData({ ...formData, items: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Total ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.total as number) || ''} onChange={e => setFormData({ ...formData, total: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Shipping Method</label><select className={ds.select} value={(formData.shippingMethod as string) || 'Standard'} onChange={e => setFormData({ ...formData, shippingMethod: e.target.value })}><option value="Standard">Standard</option><option value="Express">Express</option><option value="Overnight">Overnight</option><option value="Pickup">In-store Pickup</option></select></div>
              <div><label className={ds.label}>Tracking Number</label><input className={ds.input} value={(formData.trackingNumber as string) || ''} onChange={e => setFormData({ ...formData, trackingNumber: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Shipping Address</label><textarea className={ds.textarea} rows={2} value={(formData.shippingAddress as string) || ''} onChange={e => setFormData({ ...formData, shippingAddress: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Return Reason</label><input className={ds.input} value={(formData.returnReason as string) || ''} onChange={e => setFormData({ ...formData, returnReason: e.target.value })} placeholder="If applicable" /></div>
              <div><label className={ds.label}>Refund Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.refundAmount as number) || ''} onChange={e => setFormData({ ...formData, refundAmount: parseFloat(e.target.value) || 0 })} /></div>
            </div>
          </>
        );
      case 'Customer':
        return (
          <>
            <div><label className={ds.label}>Customer Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
              <div><label className={ds.label}>Phone</label><input className={ds.input} value={(formData.phone as string) || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Total Orders</label><input type="number" className={ds.input} value={(formData.totalOrders as number) || ''} onChange={e => setFormData({ ...formData, totalOrders: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Total Spent ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.totalSpent as number) || ''} onChange={e => setFormData({ ...formData, totalSpent: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Avg Order Value ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.avgOrderValue as number) || ''} onChange={e => setFormData({ ...formData, avgOrderValue: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Lifetime Value ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.lifetimeValue as number) || ''} onChange={e => setFormData({ ...formData, lifetimeValue: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Tier</label><select className={ds.select} value={(formData.tier as string) || 'Bronze'} onChange={e => setFormData({ ...formData, tier: e.target.value })}><option value="Bronze">Bronze</option><option value="Silver">Silver</option><option value="Gold">Gold</option><option value="Platinum">Platinum</option></select></div>
              <div><label className={ds.label}>Segment</label><select className={ds.select} value={(formData.segment as string) || ''} onChange={e => setFormData({ ...formData, segment: e.target.value })}><option value="">Select...</option><option value="Champions">Champions</option><option value="Loyal">Loyal</option><option value="Potential">Potential</option><option value="At Risk">At Risk</option><option value="Lost">Lost</option></select></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Recency Score (1-5)</label><input type="number" min="1" max="5" className={ds.input} value={(formData.recencyScore as number) || ''} onChange={e => setFormData({ ...formData, recencyScore: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Frequency Score (1-5)</label><input type="number" min="1" max="5" className={ds.input} value={(formData.frequencyScore as number) || ''} onChange={e => setFormData({ ...formData, frequencyScore: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Monetary Score (1-5)</label><input type="number" min="1" max="5" className={ds.input} value={(formData.monetaryScore as number) || ''} onChange={e => setFormData({ ...formData, monetaryScore: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Engagement Score (0-100)</label><input type="number" min="0" max="100" className={ds.input} value={(formData.engagementScore as number) || ''} onChange={e => setFormData({ ...formData, engagementScore: parseInt(e.target.value) || 0 })} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Lead':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Contact Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
              <div><label className={ds.label}>Company</label><input className={ds.input} value={(formData.company as string) || ''} onChange={e => setFormData({ ...formData, company: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Email</label><input type="email" className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
              <div><label className={ds.label}>Source</label><select className={ds.select} value={(formData.source as string) || ''} onChange={e => setFormData({ ...formData, source: e.target.value })}><option value="">Select...</option><option value="Website">Website</option><option value="Trade Show">Trade Show</option><option value="Referral">Referral</option><option value="Cold Call">Cold Call</option><option value="Social Media">Social Media</option></select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Deal Value ($)</label><input type="number" className={ds.input} value={(formData.value as number) || ''} onChange={e => setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Probability (%)</label><input type="number" min="0" max="100" className={ds.input} value={(formData.probability as number) || ''} onChange={e => setFormData({ ...formData, probability: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Expected Close</label><input type="date" className={ds.input} value={(formData.expectedClose as string) || ''} onChange={e => setFormData({ ...formData, expectedClose: e.target.value })} /></div>
              <div><label className={ds.label}>Last Contact</label><input type="date" className={ds.input} value={(formData.lastContact as string) || ''} onChange={e => setFormData({ ...formData, lastContact: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Assignee</label><input className={ds.input} value={(formData.assignee as string) || ''} onChange={e => setFormData({ ...formData, assignee: e.target.value })} /></div>
            <div><label className={ds.label}>Next Action</label><input className={ds.input} value={(formData.nextAction as string) || ''} onChange={e => setFormData({ ...formData, nextAction: e.target.value })} placeholder="e.g., Follow-up call on Monday" /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Ticket':
        return (
          <>
            <div><label className={ds.label}>Subject</label><input className={ds.input} value={(formData.subject as string) || ''} onChange={e => setFormData({ ...formData, subject: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Customer</label><input className={ds.input} value={(formData.customer as string) || ''} onChange={e => setFormData({ ...formData, customer: e.target.value })} /></div>
              <div><label className={ds.label}>Customer Email</label><input type="email" className={ds.input} value={(formData.customerEmail as string) || ''} onChange={e => setFormData({ ...formData, customerEmail: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })}><option value="">Select...</option>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className={ds.label}>Priority</label><select className={ds.select} value={(formData.priority as string) || 'medium'} onChange={e => setFormData({ ...formData, priority: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Assignee</label><input className={ds.input} value={(formData.assignee as string) || ''} onChange={e => setFormData({ ...formData, assignee: e.target.value })} /></div>
              <div><label className={ds.label}>Escalation Level</label><select className={ds.select} value={(formData.escalationLevel as number) || 0} onChange={e => setFormData({ ...formData, escalationLevel: parseInt(e.target.value) || 0 })}><option value={0}>None</option><option value={1}>Level 1</option><option value={2}>Level 2</option><option value={3}>Level 3</option></select></div>
            </div>
            <div><label className={ds.label}>SLA Deadline</label><input type="datetime-local" className={ds.input} value={(formData.slaDeadline as string) || ''} onChange={e => setFormData({ ...formData, slaDeadline: e.target.value })} /></div>
            <div><label className={ds.label}>Satisfaction Score (0-5)</label><input type="number" min="0" max="5" step="0.1" className={ds.input} value={(formData.satisfactionScore as number) || ''} onChange={e => setFormData({ ...formData, satisfactionScore: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className={ds.label}>Tags (comma-separated)</label><input className={ds.input} value={((formData.tags as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Resolution Notes</label><textarea className={ds.textarea} rows={2} value={(formData.resolution as string) || ''} onChange={e => setFormData({ ...formData, resolution: e.target.value })} /></div>
          </>
        );
      case 'Display':
        return (
          <>
            <div><label className={ds.label}>Display Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Location</label><input className={ds.input} value={(formData.location as string) || ''} onChange={e => setFormData({ ...formData, location: e.target.value })} /></div>
              <div><label className={ds.label}>Type</label><select className={ds.select} value={(formData.type as string) || ''} onChange={e => setFormData({ ...formData, type: e.target.value })}><option value="">Select...</option><option value="Window">Window</option><option value="Endcap">Endcap</option><option value="Floor">Floor Stand</option><option value="Counter">Counter</option><option value="Digital">Digital Sign</option></select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Start Date</label><input type="date" className={ds.input} value={(formData.startDate as string) || ''} onChange={e => setFormData({ ...formData, startDate: e.target.value })} /></div>
              <div><label className={ds.label}>End Date</label><input type="date" className={ds.input} value={(formData.endDate as string) || ''} onChange={e => setFormData({ ...formData, endDate: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Budget ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.budget as number) || ''} onChange={e => setFormData({ ...formData, budget: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Impressions</label><input type="number" className={ds.input} value={(formData.impressions as number) || ''} onChange={e => setFormData({ ...formData, impressions: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Conversions</label><input type="number" className={ds.input} value={(formData.conversions as number) || ''} onChange={e => setFormData({ ...formData, conversions: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Product SKUs (comma-separated)</label><input className={ds.input} value={((formData.products as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, products: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
          </>
        );
      default: return null;
    }
  };

  /* ---- card ---- */
  const renderCard = (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>{item.title}</h3>
          {renderStatusBadge(item.meta.status)}
        </div>
        <div className="mt-2 space-y-1">
          {currentType === 'Product' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-500')}>SKU: {d.sku as string} {d.barcode ? `| BC: ${d.barcode}` : ''}</p>
              <p className={ds.textMuted}>{d.category as string}{d.collection ? ` | ${d.collection}` : ''} | {formatCurrency((d.price as number) || 0)}</p>
              <p className={ds.textMuted}>Stock: {d.stock as number} (reorder at {d.reorderPoint as number}){d.supplier ? ` | ${d.supplier}` : ''}</p>
              {(d.stock as number) <= (d.reorderPoint as number) && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Low stock - reorder needed</p>}
              {Boolean(d.costPrice) && (
                <p className={ds.textMuted}>Margin: {Math.round((((d.price as number) - (d.costPrice as number)) / (d.price as number)) * 100)}%</p>
              )}
            </>
          )}
          {currentType === 'Order' && (
            <>
              <p className={ds.textMuted}>Customer: {d.customer as string}</p>
              <p className={ds.textMuted}>{d.items as number} items | {formatCurrency((d.total as number) || 0)}</p>
              <p className={ds.textMuted}>{d.shippingMethod as string}{d.trackingNumber ? ` | ${d.trackingNumber}` : ''}</p>
              {Boolean(d.returnReason) && <p className="text-xs text-red-400 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Return: {d.returnReason as string}</p>}
            </>
          )}
          {currentType === 'Customer' && (
            <>
              <div className="flex items-center gap-2 text-sm text-gray-400"><Mail className="w-3 h-3" />{d.email as string}</div>
              <div className="flex items-center gap-2 text-sm text-gray-400"><Phone className="w-3 h-3" />{d.phone as string}</div>
              <p className={ds.textMuted}>{d.totalOrders as number} orders | {formatCurrency((d.totalSpent as number) || 0)} spent</p>
              <div className="flex items-center gap-2">
                {renderTierBadge((d.tier as CustomerTier) || 'Bronze')}
                {Boolean(d.engagementScore) && <span className={ds.badge((d.engagementScore as number) >= 70 ? 'green-400' : (d.engagementScore as number) >= 40 ? 'yellow-400' : 'red-400')}>Engagement: {d.engagementScore as number}</span>}
              </div>
              {Boolean(d.lifetimeValue) && <p className={ds.textMuted}>LTV: {formatCurrency(d.lifetimeValue as number)}</p>}
            </>
          )}
          {currentType === 'Lead' && (
            <>
              <p className={ds.textMuted}>{d.company as string}</p>
              <p className={ds.textMuted}>Value: {formatCurrency((d.value as number) || 0)} | {d.probability as number}% probability</p>
              <p className={ds.textMuted}>Source: {d.source as string} | Assigned: {d.assignee as string}</p>
              {Boolean(d.expectedClose) && <p className={ds.textMuted}>Expected close: {d.expectedClose as string}</p>}
              {Boolean(d.nextAction) && <p className="text-xs text-neon-cyan flex items-center gap-1"><ArrowRight className="w-3 h-3" /> {d.nextAction as string}</p>}
            </>
          )}
          {currentType === 'Ticket' && (
            <>
              <p className={ds.textMuted}>Customer: {d.customer as string}</p>
              <div className="flex items-center gap-2">
                <span className={ds.textMuted}>Category: {d.category as string}</span>
                {renderPriorityBadge((d.priority as string) || 'medium')}
              </div>
              <p className={ds.textMuted}>Assigned: {d.assignee as string}</p>
              {Boolean(d.slaDeadline) && (() => {
                const sla = getSLATimeRemaining(d.slaDeadline as string);
                return (
                  <div className={cn('flex items-center gap-1 text-xs', sla.breached ? 'text-red-400' : sla.urgent ? 'text-yellow-400' : 'text-green-400')}>
                    <Timer className="w-3 h-3" /> SLA: {sla.text}
                  </div>
                );
              })()}
              {(d.escalationLevel as number) > 0 && <span className={ds.badge('orange-400')}>Escalation L{d.escalationLevel as number}</span>}
            </>
          )}
          {currentType === 'Display' && (
            <>
              <p className={ds.textMuted}><MapPin className="w-3 h-3 inline" /> {d.location as string} | {d.type as string}</p>
              <p className={ds.textMuted}>{d.startDate as string} to {d.endDate as string}</p>
              <p className={ds.textMuted}>{((d.products as string[]) || []).length} products featured</p>
              {d.budget !== undefined && d.budget !== null && <p className={ds.textMuted}>Budget: {formatCurrency(d.budget as number)} | {Number(d.impressions || 0)} impressions | {Number(d.conversions || 0)} conversions</p>}
            </>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={(e) => { e.stopPropagation(); openEdit(item); }}><Edit3 className="w-3.5 h-3.5" /> Edit</button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          {currentType === 'Product' && (
            <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={(e) => { e.stopPropagation(); handleAction('reorder_check', item.id); }}>
              <RefreshCw className="w-3.5 h-3.5" /> Reorder Check
            </button>
          )}
          {currentType === 'Customer' && (
            <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={(e) => { e.stopPropagation(); handleAction('ltv_calculator', item.id); }}>
              <TrendingUp className="w-3.5 h-3.5" /> LTV
            </button>
          )}
        </div>
      </div>
    );
  };

  /* ---- Enhanced Dashboard ---- */
  const renderDashboard = () => {
    return (
      <div className="space-y-6">
        {/* Top KPIs */}
        <div className={ds.grid4}>
          <MetricCard icon={DollarSign} label="Revenue (Recent)" value={formatCurrency(totalRevenue)} trend="+12.4%" trendUp={true} color="green-400" />
          <MetricCard icon={ShoppingBag} label="Avg Order Value" value={formatCurrency(avgOrderValue)} trend="+3.2%" trendUp={true} color="neon-blue" />
          <MetricCard icon={Target} label="Pipeline Value" value={formatCompactCurrency(totalPipelineValue)} subtext={`${items.length} active deals`} color="neon-purple" />
          <MetricCard icon={Users} label="Avg Customer LTV" value={formatCurrency(customerLTV)} trend="+8.1%" trendUp={true} color="neon-cyan" />
        </div>

        {/* Secondary KPIs */}
        <div className={ds.grid4}>
          <MetricCard icon={PackageCheck} label="Inventory Health" value={`${inventoryHealthScore}%`} color={inventoryHealthScore >= 80 ? 'green-400' : 'yellow-400'} />
          <MetricCard icon={RotateCcw} label="Return Rate" value="4.2%" trend="-0.8%" trendUp={true} color="green-400" />
          <MetricCard icon={Ticket} label="Open Tickets" value={String(openTicketCount)} subtext="SLA compliance 94%" color="red-400" />
          <MetricCard icon={Activity} label="Customer Acq. Cost" value="$34.50" trend="-12%" trendUp={true} color="neon-cyan" />
        </div>

        {/* Reorder check */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Reorder Alerts</h3>
          {lowStockProducts.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400"><CheckCircle2 className="w-5 h-5" /> All products above reorder point.</div>
          ) : (
            <div className="space-y-2">
              {lowStockProducts.map((p) => {
                const d = p.data as unknown as Product;
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div>
                      <p className="text-sm font-medium text-white">{p.title}</p>
                      <p className={ds.textMuted}>Stock: {d.stock} / Reorder at: {d.reorderPoint}{d.supplier ? ` | Supplier: ${d.supplier}` : ''}</p>
                    </div>
                    <button className={ds.btnSecondary} onClick={() => handleAction('reorder_check', p.id)}>
                      <Truck className="w-4 h-4" /> Reorder
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pipeline stages chart */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Sales Pipeline Overview</h3>
          <div className="flex items-end gap-2">
            {FUNNEL_STAGES.map(stage => {
              const data = pipelineByStage[stage] || { count: 0, value: 0 };
              const maxCount = Math.max(...Object.values(pipelineByStage).map(s => s.count), 3);
              const height = Math.max(20, (data.count / maxCount) * 120);
              const color = LEAD_STATUS_COLORS[stage as LeadStatus];
              return (
                <div key={stage} className="flex-1 text-center">
                  <div className="flex justify-center mb-1">
                    <div className={cn('w-full rounded-t-lg', `bg-${color}/30 border border-${color}/50`)} style={{ height: `${height}px` }}>
                      <span className="text-xs font-bold text-white block pt-1">{data.count}</span>
                      <span className="text-xs text-gray-400 block">{formatCompactCurrency(data.value)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 capitalize">{stage}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick actions */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Domain Actions</h3>
          <div className={ds.grid4}>
            <button className={ds.btnSecondary} onClick={() => { setMode('Products'); setView('library'); setProductSubTab('inventory'); }}>
              <Package className="w-4 h-4" /> Reorder Check
            </button>
            <button className={ds.btnSecondary} onClick={() => { setMode('Pipeline'); setView('library'); setPipelineSubTab('funnel'); }}>
              <TrendingUp className="w-4 h-4" /> Pipeline Calculator
            </button>
            <button className={ds.btnSecondary} onClick={() => { setMode('Customers'); setView('library'); setCustomerSubTab('rfm'); }}>
              <Users className="w-4 h-4" /> LTV Calculator
            </button>
            <button className={ds.btnSecondary} onClick={() => { setMode('Support'); setView('library'); setSupportSubTab('sla'); }}>
              <Clock className="w-4 h-4" /> SLA Check
            </button>
          </div>
          <div className="mt-3">
            <button className={ds.btnSecondary} onClick={() => { setMode('Products'); setView('library'); setProductSubTab('inventory'); }}>
              <PieChart className="w-4 h-4" /> ABC Analysis
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ---- tab-specific content ---- */
  const renderTabContent = () => {
    if (mode === 'Products') {
      return (
        <>
          {renderSubTabs([
            { id: 'catalog', label: 'Catalog', icon: Package },
            { id: 'variants', label: 'Variants', icon: Layers },
            { id: 'inventory', label: 'Inventory & Forecast', icon: BarChart3 },
            { id: 'pricing', label: 'Pricing', icon: DollarSign },
          ], productSubTab, (id) => setProductSubTab(id as ProductSubTab))}
          {productSubTab === 'catalog' && renderLibrary()}
          {productSubTab === 'variants' && renderVariantManagement()}
          {productSubTab === 'inventory' && renderInventoryForecasting()}
          {productSubTab === 'pricing' && renderPricingHistory()}
        </>
      );
    }
    if (mode === 'Orders') {
      return (
        <>
          {renderSubTabs([
            { id: 'list', label: 'All Orders', icon: ShoppingBag },
            { id: 'timeline', label: 'Order Tracking', icon: Truck },
            { id: 'returns', label: 'Returns & Refunds', icon: RotateCcw },
          ], orderSubTab, (id) => setOrderSubTab(id as OrderSubTab))}
          {orderSubTab === 'list' && renderLibrary()}
          {orderSubTab === 'timeline' && (
            selectedItemId && filtered.find(f => f.id === selectedItemId)
              ? renderOrderTimeline(filtered.find(f => f.id === selectedItemId)!)
              : (
                <div className="space-y-4">
                  {filtered.length === 0 ? (
                    <div className="text-center py-12">
                      <Truck className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                      <p className={ds.textMuted}>No orders to track. Create an order first.</p>
                    </div>
                  ) : (
                    <>
                      <p className={ds.textMuted}>Select an order to view its lifecycle timeline:</p>
                      <div className="space-y-2">
                        {filtered.slice(0, 20).map(item => {
                          const d = item.data as unknown as Order;
                          return (
                            <div
                              key={item.id}
                              className={cn('flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
                                'bg-lattice-elevated border-lattice-border hover:border-neon-cyan/50'
                              )}
                              onClick={() => setSelectedItemId(item.id)}
                            >
                              <div>
                                <p className="text-sm font-medium text-white">Order #{d.orderNumber || item.title}</p>
                                <p className={ds.textMuted}>{d.customer} | {formatCurrency(d.total || 0)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                {renderStatusBadge(item.meta.status)}
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
          )}
          {orderSubTab === 'returns' && renderReturnsPanel()}
        </>
      );
    }
    if (mode === 'Customers') {
      return (
        <>
          {renderSubTabs([
            { id: 'directory', label: 'Directory', icon: Users },
            { id: 'segments', label: 'Tiers & Segments', icon: Crown },
            { id: 'rfm', label: 'RFM Analysis', icon: PieChart },
          ], customerSubTab, (id) => setCustomerSubTab(id as CustomerSubTab))}
          {customerSubTab === 'directory' && renderLibrary()}
          {customerSubTab === 'segments' && renderCustomerTiers()}
          {customerSubTab === 'rfm' && renderRFMAnalysis()}
        </>
      );
    }
    if (mode === 'Pipeline') {
      return (
        <>
          {renderSubTabs([
            { id: 'deals', label: 'All Deals', icon: Target },
            { id: 'funnel', label: 'Sales Funnel', icon: TrendingUp },
          ], pipelineSubTab, (id) => setPipelineSubTab(id as PipelineSubTab))}
          {pipelineSubTab === 'deals' && renderLibrary()}
          {pipelineSubTab === 'funnel' && renderFunnelVisualization()}
        </>
      );
    }
    if (mode === 'Support') {
      return (
        <>
          {renderSubTabs([
            { id: 'tickets', label: 'All Tickets', icon: Ticket },
            { id: 'sla', label: 'SLA Dashboard', icon: ShieldCheck },
            { id: 'templates', label: 'Templates', icon: FileText },
          ], supportSubTab, (id) => setSupportSubTab(id as SupportSubTab))}
          {supportSubTab === 'tickets' && renderLibrary()}
          {supportSubTab === 'sla' && renderSLADashboard()}
          {supportSubTab === 'templates' && renderResponseTemplates()}
        </>
      );
    }
    // Displays tab - no sub-tabs, just library
    return renderLibrary();
  };

  /* ---- standard library grid ---- */
  const renderLibrary = () => (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder={`Search ${mode.toLowerCase()}...`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-gray-400" />
          <select className={cn(ds.select, 'w-auto')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {statusOptionsFor(currentType).map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 -ml-8 pointer-events-none" />
        </div>
        <button className={ds.btnPrimary} onClick={openNew}>
          <Plus className="w-4 h-4" /> New {currentType}
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
            {/* reorderCheck */}
            {actionResult.criticalCount !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.criticalCount) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.criticalCount)}</p>
                    <p className="text-[10px] text-gray-500">Critical</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.reorderCount) > 0 ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.reorderCount)}</p>
                    <p className="text-[10px] text-gray-500">Needs Reorder</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-green-400">{String(actionResult.sufficientCount)}</p>
                    <p className="text-[10px] text-gray-500">Sufficient</p>
                  </div>
                </div>
                {Array.isArray(actionResult.critical) && (actionResult.critical as {name:string;onHand:number;status:string}[]).slice(0,3).map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-red-500/10 rounded text-xs">
                    <span className="text-gray-300">{item.name}</span>
                    <span className="text-red-400">{item.onHand} on hand</span>
                  </div>
                ))}
              </div>
            )}
            {/* pipelineValue */}
            {actionResult.totalWeightedValue !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.dealCount)}</p>
                    <p className="text-[10px] text-gray-500">Deals</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.totalWeightedValue).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Weighted Value</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.avgDealSize).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Avg Deal</p>
                  </div>
                </div>
              </div>
            )}
            {/* customerLTV */}
            {actionResult.avgProjectedLTV !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">${Number(actionResult.avgProjectedLTV).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Avg LTV</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.customersAnalyzed)}</p>
                    <p className="text-[10px] text-gray-500">Customers</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.atRiskCount) > 0 ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.atRiskCount)}</p>
                    <p className="text-[10px] text-gray-500">At Risk</p>
                  </div>
                </div>
              </div>
            )}
            {/* slaStatus */}
            {actionResult.slaComplianceRate !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.slaComplianceRate) >= 95 ? 'text-green-400' : Number(actionResult.slaComplianceRate) >= 80 ? 'text-amber-400' : 'text-red-400'}`}>{String(actionResult.slaComplianceRate)}%</p>
                    <p className="text-[10px] text-gray-500">SLA Rate</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.breachedCount) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.breachedCount)}</p>
                    <p className="text-[10px] text-gray-500">Breached</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.atRiskCount) > 0 ? 'text-amber-400' : 'text-green-400'}`}>{String(actionResult.atRiskCount)}</p>
                    <p className="text-[10px] text-gray-500">At Risk</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-green-400">{String(actionResult.metCount)}</p>
                    <p className="text-[10px] text-gray-500">Met</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Artifact library */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-neon-purple" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Store className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.heading3}>No {currentType}s found</p>
          <p className={ds.textMuted}>Create one to get started.</p>
          <button className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
            <Plus className="w-4 h-4" /> Add {currentType}
          </button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item, index) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              {renderCard(item)}
            </motion.div>
          ))}
        </div>
      )}
    </>
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
    <div data-lens-theme="retail" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Store className="w-7 h-7 text-neon-purple" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Retail &amp; Commerce</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Products, orders, customers, pipeline &amp; support management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={view === 'library' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setView('library')}>
            <ListChecks className="w-4 h-4" /> Library
          </button>
          <button className={view === 'dashboard' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setView('dashboard')}>
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </div>
      </header>


      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Products', value: items.length, icon: Package },
          { label: 'Daily Sales', value: `$${items.reduce((s, i) => s + Number((i.data as unknown as Record<string, unknown>).revenue || 0), 0).toLocaleString()}`, icon: DollarSign },
          { label: 'Inventory', value: items.reduce((s, i) => s + Number((i.data as unknown as Record<string, unknown>).stock || (i.data as unknown as Record<string, unknown>).qty || 0), 0), icon: ShoppingBag },
          { label: 'Active Orders', value: items.filter(i => i.meta?.status === 'active' || i.meta?.status === 'processing').length, icon: Store },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-purple shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="retail" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel domain="retail" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="retail" data={{}} compact />
      {/* Mode tabs */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setMode(tab.id);
                setStatusFilter('all');
                setSearchQuery('');
                setSelectedItemId(null);
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

      {/* Content */}
      {view === 'dashboard' ? renderDashboard() : renderTabContent()}

      {/* Editor modal */}
      {showEditor && (
        <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')} onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>{editingId ? 'Edit' : 'New'} {currentType}</h2>
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)}><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input className={ds.input} value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Artifact title..." />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value)}>
                    {statusOptionsFor(currentType).map(s => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-end gap-3">
                <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>Cancel</button>
                <button className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                  {editingId ? 'Update' : 'Create'}
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
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="retail" />
          </div>
        )}
      </div>
    </div>
  );
}
