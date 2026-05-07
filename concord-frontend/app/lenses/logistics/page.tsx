'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Truck,
  Users,
  Package,
  Warehouse,
  Route,
  ShieldCheck,
  Plus,
  Search,
  Filter,
  X,
  Edit2,
  Trash2,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Clock,
  Calendar,
  Fuel,
  DollarSign,
  Gauge,
  Activity,
  BarChart3,
  ClipboardList,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Star,
  Zap,
  FileText,
  Shield,
  Eye,
  Timer,
  TrendingUp,
  TrendingDown,
  CircleDot,
  Hash,
  Box,
  Layers,
  Target,
  Navigation,
  Milestone,
  CheckCircle2,
  XCircle,
  FileWarning,
  BadgeCheck,
  Siren,
  Wrench,
  ThermometerSun,
  Map,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'fleet' | 'drivers' | 'shipments' | 'warehouse' | 'routes' | 'compliance' | 'map';

type ArtifactType = 'Vehicle' | 'Driver' | 'Shipment' | 'WarehouseItem' | 'Route' | 'ComplianceLog';

type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

const SHIPMENT_STATUSES = [
  'booked',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
] as const;
const ROUTE_STATUSES = ['planned', 'dispatched', 'in_progress', 'completed'] as const;
const GENERAL_STATUSES = ['active', 'inactive', 'maintenance', 'pending', 'flagged'] as const;

const STATUS_COLORS: Record<string, string> = {
  booked: 'blue-500',
  picked_up: 'neon-cyan',
  in_transit: 'neon-purple',
  out_for_delivery: 'amber-400',
  delivered: 'green-400',
  exception: 'red-400',
  planned: 'gray-400',
  dispatched: 'blue-500',
  in_progress: 'neon-cyan',
  completed: 'green-400',
  active: 'green-400',
  inactive: 'gray-500',
  maintenance: 'amber-400',
  pending: 'blue-500',
  flagged: 'red-400',
  overdue: 'red-400',
  upcoming: 'amber-400',
  current: 'green-400',
  pass: 'green-400',
  fail: 'red-400',
  warning: 'amber-400',
  skipped: 'gray-500',
  arrived: 'neon-cyan',
};

const KANBAN_COLUMNS: { key: ShipmentStatus; label: string; color: string }[] = [
  { key: 'booked', label: 'Booked', color: 'blue-500' },
  { key: 'picked_up', label: 'Picked Up', color: 'neon-cyan' },
  { key: 'in_transit', label: 'In Transit', color: 'neon-purple' },
  { key: 'out_for_delivery', label: 'Out for Delivery', color: 'amber-400' },
  { key: 'delivered', label: 'Delivered', color: 'green-400' },
];

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Truck; type: ArtifactType }[] = [
  { id: 'fleet', label: 'Fleet', icon: Truck, type: 'Vehicle' },
  { id: 'drivers', label: 'Drivers', icon: Users, type: 'Driver' },
  { id: 'shipments', label: 'Shipments', icon: Package, type: 'Shipment' },
  { id: 'warehouse', label: 'Warehouse', icon: Warehouse, type: 'WarehouseItem' },
  { id: 'routes', label: 'Routes', icon: Route, type: 'Route' },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck, type: 'ComplianceLog' },
  { id: 'map', label: 'Map', icon: Map, type: 'Shipment' },
];

// ---------------------------------------------------------------------------
// Seed data — rich realistic entries for each artifact type
// ---------------------------------------------------------------------------
const SEED: Record<
  ArtifactType,
  Array<{ title: string; data: Record<string, unknown>; meta: Record<string, unknown> }>
> = {
  Vehicle: [],
  Driver: [],
  Shipment: [],
  WarehouseItem: [],
  Route: [],
  ComplianceLog: [],
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function progressColor(pct: number): string {
  if (pct >= 80) return 'bg-green-400';
  if (pct >= 50) return 'bg-amber-400';
  return 'bg-red-400';
}

function fuelColor(pct: number): string {
  if (pct >= 50) return 'text-green-400';
  if (pct >= 25) return 'text-amber-400';
  return 'text-red-400';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Micro progress bar */
function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      data-lens-theme="logistics"
      className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden"
    >
      <div
        className={cn('h-full rounded-full transition-all', color || progressColor(pct))}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Stat card for dashboard */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-neon-cyan',
  trend,
}: {
  icon: typeof Truck;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  trend?: 'up' | 'down' | null;
}) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className={ds.textMuted}>{label}</span>
        {trend === 'up' && <TrendingUp className="w-3 h-3 text-green-400 ml-auto" />}
        {trend === 'down' && <TrendingDown className="w-3 h-3 text-red-400 ml-auto" />}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={cn(ds.textMuted, 'text-xs mt-0.5')}>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function LogisticsLensPage() {
  const [mode, setMode] = useState<ModeTab>('fleet');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [kanbanView, setKanbanView] = useState(true);
  const [warehouseView, setWarehouseView] = useState<'grid' | 'list'>('grid');
  const [routeExpanded, setRouteExpanded] = useState<string | null>(null);
  // Editor form state
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [formField1, setFormField1] = useState('');
  const [formField2, setFormField2] = useState('');
  const [formField3, setFormField3] = useState('');
  const [formField4, setFormField4] = useState('');
  const [formField5, setFormField5] = useState('');
  const [formField6, setFormField6] = useState('');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const currentType = MODE_TABS.find((t) => t.id === mode)!.type;

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData(
    'logistics',
    currentType,
    {
      seed: SEED[currentType],
    }
  );

  const runAction = useRunArtifact('logistics');

  // Derived data
  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || JSON.stringify(i.data).toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.meta?.status === statusFilter);
    }
    return list;
  }, [items, search, statusFilter]);

  // Cross-tab aggregations for dashboard — use real items when current type matches, otherwise empty
  // This ensures dashboard metrics reflect actual backend data instead of empty seed arrays
  const allVehicles = useMemo(
    () =>
      currentType === 'Vehicle'
        ? items.map((i) => ({
            title: i.title,
            data: i.data as Record<string, unknown>,
            meta: (i.meta || {}) as Record<string, unknown>,
          }))
        : [],
    [items, currentType]
  );
  const allDrivers = useMemo(
    () =>
      currentType === 'Driver'
        ? items.map((i) => ({
            title: i.title,
            data: i.data as Record<string, unknown>,
            meta: (i.meta || {}) as Record<string, unknown>,
          }))
        : [],
    [items, currentType]
  );
  const allShipments = useMemo(
    () =>
      currentType === 'Shipment'
        ? items.map((i) => ({
            title: i.title,
            data: i.data as Record<string, unknown>,
            meta: (i.meta || {}) as Record<string, unknown>,
          }))
        : [],
    [items, currentType]
  );
  const allWarehouse = useMemo(
    () =>
      currentType === 'WarehouseItem'
        ? items.map((i) => ({
            title: i.title,
            data: i.data as Record<string, unknown>,
            meta: (i.meta || {}) as Record<string, unknown>,
          }))
        : [],
    [items, currentType]
  );
  const allCompliance = useMemo(
    () =>
      currentType === 'ComplianceLog'
        ? items.map((i) => ({
            title: i.title,
            data: i.data as Record<string, unknown>,
            meta: (i.meta || {}) as Record<string, unknown>,
          }))
        : [],
    [items, currentType]
  );

  const dashMetrics = useMemo(() => {
    const activeVehicles = allVehicles.filter((v) => v.meta.status === 'active').length;
    const totalVehicles = allVehicles.length;
    const utilizationAvg =
      allVehicles.reduce((s, v) => s + ((v.data.utilizationRate as number) || 0), 0) /
      (totalVehicles || 1);
    const inTransit = allShipments.filter((s) => s.meta.status === 'in_transit').length;
    const delivered = allShipments.filter((s) => s.meta.status === 'delivered').length;
    const totalShipments = allShipments.length;
    const onTimeRate =
      allDrivers.reduce((s, d) => s + ((d.data.onTimeDelivery as number) || 0), 0) /
      (allDrivers.length || 1);
    const whCapacity = allWarehouse.reduce((s, w) => s + ((w.data.capacity as number) || 0), 0);
    const whUsed = allWarehouse.reduce((s, w) => s + ((w.data.currentQty as number) || 0), 0);
    const whUtilPct = whCapacity > 0 ? Math.round((whUsed / whCapacity) * 100) : 0;
    const compAlerts = allCompliance.filter(
      (c) => c.meta.status === 'flagged' || c.meta.status === 'pending'
    ).length;
    const totalRevenue = allShipments.reduce((s, sh) => s + ((sh.data.rate as number) || 0), 0);
    const totalMiles = allVehicles.reduce((s, v) => s + ((v.data.mileage as number) || 0), 0);
    const revPerMile = totalMiles > 0 ? totalRevenue / totalMiles : 0;

    return {
      activeVehicles,
      totalVehicles,
      utilizationAvg: Math.round(utilizationAvg),
      inTransit,
      delivered,
      totalShipments,
      onTimeRate: onTimeRate.toFixed(1),
      whUtilPct,
      whUsed,
      whCapacity,
      compAlerts,
      revPerMile: revPerMile.toFixed(2),
      totalRevenue,
    };
  }, [allVehicles, allDrivers, allShipments, allWarehouse, allCompliance]);

  const statusOptions =
    mode === 'shipments'
      ? SHIPMENT_STATUSES
      : mode === 'routes'
        ? ROUTE_STATUSES
        : GENERAL_STATUSES;

  const groupedShipments = useMemo(() => {
    const map: Record<string, LensItem[]> = {};
    for (const col of KANBAN_COLUMNS) map[col.key] = [];
    map['exception'] = [];
    for (const item of filtered) {
      const st = item.meta?.status || 'booked';
      if (map[st]) map[st].push(item);
    }
    return map;
  }, [filtered]);

  // Editor helpers
  const resetForm = () => {
    setFormTitle('');
    setFormStatus('active');
    setFormField1('');
    setFormField2('');
    setFormField3('');
    setFormField4('');
    setFormField5('');
    setFormField6('');
    setEditing(null);
    setShowEditor(false);
  };

  const openCreate = () => {
    resetForm();
    setShowEditor(true);
  };

  const openEdit = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setEditing(id);
    setFormTitle(item.title);
    setFormStatus(item.meta?.status || 'active');
    const vals = Object.values(item.data as Record<string, unknown>);
    setFormField1(String(vals[0] ?? ''));
    setFormField2(String(vals[1] ?? ''));
    setFormField3(String(vals[2] ?? ''));
    setFormField4(String(vals[3] ?? ''));
    setFormField5(String(vals[4] ?? ''));
    setFormField6(String(vals[5] ?? ''));
    setShowEditor(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {};
    if (mode === 'fleet') {
      data.make = formField1;
      data.model = formField2;
      data.mileage = formField3;
      data.fuelLevel = formField4;
      data.nextMaintenance = formField5;
      data.costPerMile = formField6;
    }
    if (mode === 'drivers') {
      data.license = formField1;
      data.phone = formField2;
      data.hoursThisWeek = formField3;
      data.cdlExpiry = formField4;
      data.safetyScore = formField5;
      data.onTimeDelivery = formField6;
    }
    if (mode === 'shipments') {
      data.origin = formField1;
      data.destination = formField2;
      data.weight = formField3;
      data.pieces = formField4;
      data.carrier = formField5;
      data.eta = formField6;
    }
    if (mode === 'warehouse') {
      data.sku = formField1;
      data.zone = formField2;
      data.quantity = formField3;
      data.capacity = formField4;
      data.aisle = formField5;
      data.rack = formField6;
    }
    if (mode === 'routes') {
      data.origin = formField1;
      data.destination = formField2;
      data.distance = formField3;
      data.estimatedTime = formField4;
      data.fuelCost = formField5;
      data.tollCost = formField6;
    }
    if (mode === 'compliance') {
      data.type = formField1;
      data.inspector = formField2;
      data.findings = formField3;
      data.result = formField4;
      data.nextDue = formField5;
      data.category = formField6;
    }

    if (editing) {
      await update(editing, { title: formTitle, data, meta: { status: formStatus } });
    } else {
      await create({ title: formTitle, data, meta: { status: formStatus } });
    }
    resetForm();
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editing || filtered[0]?.id;
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

  const advanceShipmentStatus = useCallback(
    async (item: LensItem) => {
      const order: ShipmentStatus[] = [
        'booked',
        'picked_up',
        'in_transit',
        'out_for_delivery',
        'delivered',
      ];
      const currentIdx = order.indexOf(item.meta?.status as ShipmentStatus);
      if (currentIdx < 0 || currentIdx >= order.length - 1) return;
      const nextStatus = order[currentIdx + 1];
      await update(item.id, { meta: { status: nextStatus } });
    },
    [update]
  );

  const fieldLabels: Record<ModeTab, string[]> = {
    fleet: ['Make', 'Model', 'Mileage', 'Fuel Level %', 'Next Maintenance', 'Cost/Mile'],
    drivers: [
      'License Class',
      'Phone',
      'Hours This Week',
      'CDL Expiry',
      'Safety Score',
      'On-Time %',
    ],
    shipments: ['Origin', 'Destination', 'Weight (lbs)', 'Pieces', 'Carrier', 'ETA'],
    warehouse: ['SKU', 'Zone', 'Quantity', 'Capacity', 'Aisle', 'Rack'],
    routes: ['Origin', 'Destination', 'Distance (mi)', 'Est. Time', 'Fuel Cost', 'Toll Cost'],
    compliance: ['Type', 'Inspector', 'Findings', 'Result', 'Next Due', 'Category'],
    map: [],
  };

  // ---------------------------------------------------------------------------
  // Tab-specific renders
  // ---------------------------------------------------------------------------

  /** Fleet Dashboard */
  const renderFleetTab = () => (
    <div className="space-y-4">
      {/* Fleet KPIs */}
      <div className={ds.grid4}>
        <StatCard
          icon={Truck}
          label="Fleet Size"
          value={dashMetrics.totalVehicles}
          sub={`${dashMetrics.activeVehicles} active`}
        />
        <StatCard
          icon={Gauge}
          label="Avg Utilization"
          value={`${dashMetrics.utilizationAvg}%`}
          color="text-green-400"
        />
        <StatCard
          icon={Fuel}
          label="Avg MPG"
          value={(
            allVehicles.reduce((s, v) => s + ((v.data.avgMpg as number) || 0), 0) /
            (allVehicles.length || 1)
          ).toFixed(1)}
          color="text-amber-400"
        />
        <StatCard
          icon={DollarSign}
          label="Avg Cost/Mile"
          value={formatCurrency(
            allVehicles.reduce((s, v) => s + ((v.data.costPerMile as number) || 0), 0) /
              (allVehicles.length || 1)
          )}
          color="text-neon-purple"
        />
      </div>

      {/* Maintenance Alerts */}
      {(() => {
        const overdue = filtered.filter((v) => {
          const nm = (v.data as Record<string, unknown>).nextMaintenance;
          return nm && daysUntil(String(nm)) < 0;
        });
        const upcoming = filtered.filter((v) => {
          const nm = (v.data as Record<string, unknown>).nextMaintenance;
          return nm && daysUntil(String(nm)) >= 0 && daysUntil(String(nm)) <= 14;
        });
        return overdue.length > 0 || upcoming.length > 0 ? (
          <div className={cn(ds.panel, 'border-amber-400/30')}>
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="w-5 h-5 text-amber-400" />
              <h3 className={ds.heading3}>Maintenance Alerts</h3>
            </div>
            <div className="space-y-2">
              {overdue.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="text-sm flex-1">{v.title}</span>
                  <span className={ds.badge('red-400')}>
                    OVERDUE by{' '}
                    {Math.abs(
                      daysUntil(String((v.data as Record<string, unknown>).nextMaintenance))
                    )}
                    d
                  </span>
                </div>
              ))}
              {upcoming.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
                >
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm flex-1">{v.title}</span>
                  <span className={ds.badge('amber-400')}>
                    Due in {daysUntil(String((v.data as Record<string, unknown>).nextMaintenance))}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* Vehicle Cards */}
      <div className={ds.grid2}>
        {filtered.map((item, index) => {
          const d = item.data as Record<string, unknown>;
          const status = item.meta?.status || 'active';
          const fuelPct = Number(d.fuelLevel) || 0;
          const utilPct = Number(d.utilizationRate) || 0;
          const maintDays = d.nextMaintenance ? daysUntil(String(d.nextMaintenance)) : null;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(ds.panelHover, 'space-y-3')}
              onClick={() => setDetailId(item.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className={ds.heading3}>{item.title}</h3>
                  <p className={ds.textMuted}>
                    {String(d.make)} {String(d.model)} ({String(d.year)})
                  </p>
                </div>
                <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>
                  {String(status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Mileage</span>
                  <p className="font-medium">{formatNumber(Number(d.mileage))} mi</p>
                </div>
                <div>
                  <span className="text-gray-500">Cost/Mile</span>
                  <p className="font-medium">{formatCurrency(Number(d.costPerMile))}</p>
                </div>
                <div>
                  <span className="text-gray-500">Location</span>
                  <p className="font-medium flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {String(d.currentLocation)}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Avg MPG</span>
                  <p className="font-medium">{String(d.avgMpg)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={cn('flex items-center gap-1', fuelColor(fuelPct))}>
                      <Fuel className="w-3 h-3" /> Fuel
                    </span>
                    <span>{fuelPct}%</span>
                  </div>
                  <ProgressBar
                    value={fuelPct}
                    color={
                      fuelPct >= 50 ? 'bg-green-400' : fuelPct >= 25 ? 'bg-amber-400' : 'bg-red-400'
                    }
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-400 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Utilization
                    </span>
                    <span>{utilPct}%</span>
                  </div>
                  <ProgressBar value={utilPct} />
                </div>
              </div>

              {maintDays !== null && (
                <div
                  className={cn(
                    'flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg',
                    maintDays < 0
                      ? 'bg-red-500/10 text-red-400'
                      : maintDays <= 14
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-green-500/10 text-green-400'
                  )}
                >
                  <Calendar className="w-3 h-3" />
                  Next maintenance: {String(d.nextMaintenance)} (
                  {maintDays < 0 ? `${Math.abs(maintDays)}d overdue` : `${maintDays}d away`})
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
                <span className={cn(ds.textMuted, 'text-xs')}>VIN: {String(d.vin || 'N/A')}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={cn(ds.btnGhost, 'hover:text-red-400')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );

  /** Driver Management Tab */
  const renderDriversTab = () => (
    <div className="space-y-4">
      {/* Driver KPIs */}
      <div className={ds.grid4}>
        <StatCard
          icon={Users}
          label="Total Drivers"
          value={allDrivers.length}
          sub={`${allDrivers.filter((d) => d.meta.status === 'active').length} active`}
          color="text-green-400"
        />
        <StatCard
          icon={Star}
          label="Avg Safety Score"
          value={Math.round(
            allDrivers.reduce((s, d) => s + ((d.data.safetyScore as number) || 0), 0) /
              (allDrivers.length || 1)
          )}
          color="text-neon-cyan"
        />
        <StatCard
          icon={Target}
          label="Avg On-Time %"
          value={`${(allDrivers.reduce((s, d) => s + ((d.data.onTimeDelivery as number) || 0), 0) / (allDrivers.length || 1)).toFixed(1)}%`}
          color="text-neon-purple"
        />
        <StatCard
          icon={AlertTriangle}
          label="HOS Violations"
          value={allDrivers.filter((d) => d.data.eldCompliance === 'violation').length}
          color="text-red-400"
        />
      </div>

      {/* CDL Expiry Alerts */}
      {(() => {
        const expiringSoon = filtered.filter((d) => {
          const exp = (d.data as Record<string, unknown>).cdlExpiry;
          return exp && daysUntil(String(exp)) <= 90 && daysUntil(String(exp)) >= 0;
        });
        return expiringSoon.length > 0 ? (
          <div className={cn(ds.panel, 'border-amber-400/30')}>
            <div className="flex items-center gap-2 mb-2">
              <FileWarning className="w-4 h-4 text-amber-400" />
              <span className={ds.heading3}>CDL Expiration Alerts</span>
            </div>
            <div className="space-y-1">
              {expiringSoon.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-sm py-1">
                  <span className="flex-1">{d.title}</span>
                  <span className={ds.badge('amber-400')}>
                    CDL expires in{' '}
                    {daysUntil(String((d.data as Record<string, unknown>).cdlExpiry))}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* Driver Cards */}
      <div className={ds.grid2}>
        {filtered.map((item) => {
          const d = item.data as Record<string, unknown>;
          const status = item.meta?.status || 'active';
          const safetyScore = Number(d.safetyScore) || 0;
          const onTime = Number(d.onTimeDelivery) || 0;
          const driving = Number(d.drivingTime) || 0;
          const onDuty = Number(d.onDutyTime) || 0;
          const offDuty = Number(d.offDutyTime) || 0;
          const sleeper = Number(d.sleeperTime) || 0;
          const totalHours = Number(d.hoursThisWeek) || 0;
          const eldStatus = String(d.eldCompliance);

          return (
            <div
              key={item.id}
              className={cn(ds.panelHover, 'space-y-3')}
              onClick={() => setDetailId(item.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className={ds.heading3}>{item.title}</h3>
                  <p className={ds.textMuted}>
                    {String(d.license)} | {String(d.homeBase)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={ds.badge(eldStatus === 'compliant' ? 'green-400' : 'red-400')}>
                    {eldStatus === 'compliant' ? 'ELD OK' : 'ELD VIOLATION'}
                  </span>
                  <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>
                    {String(status)}
                  </span>
                </div>
              </div>

              {/* HOS Tracker */}
              <div className={cn(ds.panel, 'bg-lattice-elevated/50 p-3')}>
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="w-4 h-4 text-neon-cyan" />
                  <span className="text-sm font-medium">Hours of Service (Today)</span>
                  <span
                    className={cn(
                      'ml-auto text-xs',
                      totalHours > 60 ? 'text-red-400' : 'text-gray-400'
                    )}
                  >
                    {totalHours}h this week
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-blue-500/10 rounded-lg p-2">
                    <p className="text-xs text-gray-400">Driving</p>
                    <p className="text-sm font-bold text-blue-500">{driving}h</p>
                  </div>
                  <div className="bg-amber-400/10 rounded-lg p-2">
                    <p className="text-xs text-gray-400">On-Duty</p>
                    <p className="text-sm font-bold text-amber-400">{onDuty}h</p>
                  </div>
                  <div className="bg-green-400/10 rounded-lg p-2">
                    <p className="text-xs text-gray-400">Off-Duty</p>
                    <p className="text-sm font-bold text-green-400">{offDuty}h</p>
                  </div>
                  <div className="bg-neon-purple/10 rounded-lg p-2">
                    <p className="text-xs text-gray-400">Sleeper</p>
                    <p className="text-sm font-bold text-neon-purple">{sleeper}h</p>
                  </div>
                </div>
                {driving > 11 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="w-3 h-3" /> Approaching 11-hour driving limit
                  </div>
                )}
              </div>

              {/* Performance Metrics */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">On-Time</span>
                  <p
                    className={cn(
                      'font-medium',
                      onTime >= 95
                        ? 'text-green-400'
                        : onTime >= 85
                          ? 'text-amber-400'
                          : 'text-red-400'
                    )}
                  >
                    {onTime}%
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Fuel Eff.</span>
                  <p className="font-medium">{String(d.fuelEfficiency)} mpg</p>
                </div>
                <div>
                  <span className="text-gray-500">Safety</span>
                  <div className="flex items-center gap-1">
                    <p
                      className={cn(
                        'font-medium',
                        safetyScore >= 90
                          ? 'text-green-400'
                          : safetyScore >= 75
                            ? 'text-amber-400'
                            : 'text-red-400'
                      )}
                    >
                      {safetyScore}
                    </p>
                    <span className="text-gray-600">/100</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Safety Score</span>
                  <span>{safetyScore}/100</span>
                </div>
                <ProgressBar
                  value={safetyScore}
                  color={
                    safetyScore >= 90
                      ? 'bg-green-400'
                      : safetyScore >= 75
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                  }
                />
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-lattice-border">
                <span>{formatNumber(Number(d.totalMiles))} lifetime miles</span>
                <span>{Number(d.violations)} violations</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={cn(ds.btnGhost, 'hover:text-red-400')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /** Shipment Tracking Board - Kanban */
  const renderShipmentsTab = () => {
    const exceptionItems = groupedShipments['exception'] || [];

    return (
      <div className="space-y-4">
        {/* Shipment KPIs */}
        <div className={ds.grid4}>
          <StatCard icon={Package} label="Total Shipments" value={dashMetrics.totalShipments} />
          <StatCard
            icon={Truck}
            label="In Transit"
            value={dashMetrics.inTransit}
            color="text-neon-purple"
          />
          <StatCard
            icon={CheckCircle}
            label="Delivered"
            value={dashMetrics.delivered}
            color="text-green-400"
          />
          <StatCard
            icon={DollarSign}
            label="Total Revenue"
            value={formatCurrency(dashMetrics.totalRevenue)}
            color="text-amber-400"
          />
        </div>

        {/* Exception Alerts */}
        {exceptionItems.length > 0 && (
          <div className={cn(ds.panel, 'border-red-400/30')}>
            <div className="flex items-center gap-2 mb-2">
              <Siren className="w-4 h-4 text-red-400" />
              <span className={ds.heading3}>Exception Alerts</span>
              <span className={ds.badge('red-400')}>{exceptionItems.length}</span>
            </div>
            {exceptionItems.map((item) => {
              const d = item.data as Record<string, unknown>;
              const exceptions = (d.exceptions as string[]) || [];
              return (
                <div key={item.id} className="flex items-center gap-3 py-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="flex-1">
                    {item.title}: {String(d.origin)} → {String(d.destination)}
                  </span>
                  {exceptions.map((ex, i) => (
                    <span key={i} className={ds.badge('red-400')}>
                      {ex}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setKanbanView(true)}
            className={cn(kanbanView ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)}
          >
            <Layers className="w-4 h-4" /> Kanban
          </button>
          <button
            onClick={() => setKanbanView(false)}
            className={cn(!kanbanView ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)}
          >
            <ClipboardList className="w-4 h-4" /> List
          </button>
        </div>

        {kanbanView ? (
          /* Kanban Board */
          <div className="flex gap-3 flex-wrap pb-4">
            {KANBAN_COLUMNS.map((col) => {
              const columnItems = groupedShipments[col.key] || [];
              return (
                <div key={col.key} className="min-w-[260px] flex-shrink-0">
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-t-lg',
                      `bg-${col.color}/10 border border-${col.color}/30`
                    )}
                  >
                    <CircleDot className={cn('w-3.5 h-3.5', `text-${col.color}`)} />
                    <span className="text-sm font-medium">{col.label}</span>
                    <span className={cn(ds.badge(col.color), 'ml-auto')}>{columnItems.length}</span>
                  </div>
                  <div className="space-y-2 mt-2 min-h-[200px]">
                    {columnItems.map((item) => {
                      const d = item.data as Record<string, unknown>;
                      return (
                        <div
                          key={item.id}
                          className={cn(ds.panelHover, 'text-sm space-y-2')}
                          onClick={() => setDetailId(item.id)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{item.title}</span>
                            {col.key !== 'delivered' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  advanceShipmentStatus(item);
                                }}
                                className={cn(ds.btnGhost, 'text-xs p-1')}
                                title="Advance status"
                              >
                                <ArrowRight className="w-3.5 h-3.5 text-neon-cyan" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-gray-400">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{String(d.origin)}</span>
                            <ArrowRight className="w-3 h-3 shrink-0" />
                            <span className="truncate">{String(d.destination)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{formatNumber(Number(d.weight))} lbs</span>
                            <span>{String(d.pieces)} pcs</span>
                            <span>{String(d.carrier)}</span>
                          </div>
                          {Boolean(d.eta) && (
                            <div className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock className="w-3 h-3" /> ETA: {String(d.eta)}
                            </div>
                          )}
                          {Boolean(d.podSigned) && (
                            <div className="flex items-center gap-1 text-xs text-green-400">
                              <BadgeCheck className="w-3 h-3" /> POD Signed
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {columnItems.length === 0 && (
                      <div className="text-center py-6 text-gray-600 text-xs">No shipments</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="space-y-2">
            {filtered.map((item) => {
              const d = item.data as Record<string, unknown>;
              const status = item.meta?.status || 'booked';
              return (
                <div
                  key={item.id}
                  className={cn(ds.panelHover, 'flex items-center gap-4')}
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>
                        {String(status).replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className={cn(ds.textMuted, 'text-xs truncate')}>
                      {String(d.origin)} → {String(d.destination)} | {String(d.commodity)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-400 shrink-0">
                    <p>
                      {formatNumber(Number(d.weight))} lbs / {String(d.pieces)} pcs
                    </p>
                    <p>{String(d.carrier)}</p>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <p className="font-medium">{formatCurrency(Number(d.rate))}</p>
                    <p className="text-gray-500">ETA: {String(d.eta)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {status !== 'delivered' && status !== 'exception' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          advanceShipmentStatus(item);
                        }}
                        className={cn(ds.btnGhost, ds.btnSmall)}
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(item.id);
                      }}
                      className={ds.btnGhost}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(item.id);
                      }}
                      className={cn(ds.btnGhost, 'hover:text-red-400')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /** Warehouse Management Tab */
  const renderWarehouseTab = () => {
    const totalCap = filtered.reduce(
      (s, w) => s + (Number((w.data as Record<string, unknown>).capacity) || 0),
      0
    );
    const totalQty = filtered.reduce(
      (s, w) => s + (Number((w.data as Record<string, unknown>).currentQty) || 0),
      0
    );
    const totalPickRate = filtered.reduce(
      (s, w) => s + (Number((w.data as Record<string, unknown>).pickRate) || 0),
      0
    );

    return (
      <div className="space-y-4">
        {/* Warehouse KPIs */}
        <div className={ds.grid4}>
          <StatCard icon={Warehouse} label="Locations" value={filtered.length} />
          <StatCard
            icon={Box}
            label="Total Items"
            value={formatNumber(totalQty)}
            sub={`of ${formatNumber(totalCap)} capacity`}
            color="text-neon-purple"
          />
          <StatCard
            icon={Gauge}
            label="Utilization"
            value={`${totalCap > 0 ? Math.round((totalQty / totalCap) * 100) : 0}%`}
            color="text-amber-400"
          />
          <StatCard
            icon={Zap}
            label="Total Pick Rate"
            value={`${totalPickRate}/hr`}
            color="text-green-400"
          />
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWarehouseView('grid')}
            className={cn(warehouseView === 'grid' ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)}
          >
            <Layers className="w-4 h-4" /> Grid View
          </button>
          <button
            onClick={() => setWarehouseView('list')}
            className={cn(warehouseView === 'list' ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)}
          >
            <ClipboardList className="w-4 h-4" /> List View
          </button>
        </div>

        {/* Cycle Count Schedule */}
        {(() => {
          const upcoming = filtered.filter((w) => {
            const nc = (w.data as Record<string, unknown>).nextCycleCount;
            return nc && daysUntil(String(nc)) <= 7;
          });
          return upcoming.length > 0 ? (
            <div className={cn(ds.panel, 'border-blue-500/30')}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className={ds.heading3}>Upcoming Cycle Counts</span>
              </div>
              <div className="space-y-1">
                {upcoming.map((w) => {
                  const d = w.data as Record<string, unknown>;
                  const days = daysUntil(String(d.nextCycleCount));
                  return (
                    <div key={w.id} className="flex items-center gap-3 py-1 text-sm">
                      <span className="flex-1">{w.title}</span>
                      <span className={ds.badge(days <= 2 ? 'amber-400' : 'blue-500')}>
                        {days <= 0 ? 'Today' : `In ${days}d`} - {String(d.nextCycleCount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null;
        })()}

        {warehouseView === 'grid' ? (
          /* Location Grid */
          <div className={ds.grid3}>
            {filtered.map((item) => {
              const d = item.data as Record<string, unknown>;
              const cap = Number(d.capacity) || 1;
              const qty = Number(d.currentQty) || 0;
              const pct = Math.round((qty / cap) * 100);
              const status = item.meta?.status || 'active';

              return (
                <div
                  key={item.id}
                  className={cn(ds.panelHover, 'space-y-3')}
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className={ds.heading3}>{item.title}</h3>
                      <p className={ds.textMuted}>
                        Aisle {String(d.aisle)} | Rack {String(d.rack)} | Shelf {String(d.shelf)}
                      </p>
                    </div>
                    <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>
                      {String(status)}
                    </span>
                  </div>

                  {/* Location visual */}
                  <div className="bg-lattice-elevated rounded-lg p-3 text-center">
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {Array.from({ length: 9 }).map((_, i) => {
                        const filled = i < Math.ceil((pct / 100) * 9);
                        return (
                          <div
                            key={i}
                            className={cn(
                              'h-4 rounded-sm transition-colors',
                              filled
                                ? pct > 90
                                  ? 'bg-red-400/60'
                                  : pct > 70
                                    ? 'bg-amber-400/60'
                                    : 'bg-green-400/60'
                                : 'bg-lattice-border/30'
                            )}
                          />
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400">
                      {formatNumber(qty)} / {formatNumber(cap)} units
                    </p>
                  </div>

                  <ProgressBar value={pct} />

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Item Type</span>
                      <p>{String(d.itemType)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Temperature</span>
                      <p className="flex items-center gap-1">
                        <ThermometerSun className="w-3 h-3" />
                        {String(d.temperature)}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Pick Rate</span>
                      <p>{String(d.pickRate)}/hr</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Recv Dock</span>
                      <p>{String(d.receivingDock)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-lattice-border text-xs text-gray-500">
                    <span>Last count: {String(d.lastCount)}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(item.id);
                        }}
                        className={ds.btnGhost}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(item.id);
                        }}
                        className={cn(ds.btnGhost, 'hover:text-red-400')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className={ds.panel}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border text-gray-400 text-left">
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 font-medium">Zone</th>
                  <th className="pb-2 font-medium">Position</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Qty / Cap</th>
                  <th className="pb-2 font-medium">Utilization</th>
                  <th className="pb-2 font-medium">Pick Rate</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lattice-border">
                {filtered.map((item) => {
                  const d = item.data as Record<string, unknown>;
                  const cap = Number(d.capacity) || 1;
                  const qty = Number(d.currentQty) || 0;
                  const pct = Math.round((qty / cap) * 100);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-lattice-elevated/50 cursor-pointer"
                      onClick={() => setDetailId(item.id)}
                    >
                      <td className="py-2 font-medium">{item.title}</td>
                      <td className="py-2">{String(d.zone)}</td>
                      <td className="py-2 text-gray-400">
                        A{String(d.aisle)}-R{String(d.rack)}-S{String(d.shelf)}
                      </td>
                      <td className="py-2">{String(d.itemType)}</td>
                      <td className="py-2">
                        {formatNumber(qty)} / {formatNumber(cap)}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <ProgressBar value={pct} />
                          </div>
                          <span className="text-xs">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-2">{String(d.pickRate)}/hr</td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(item.id);
                            }}
                            className={ds.btnGhost}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(item.id);
                            }}
                            className={cn(ds.btnGhost, 'hover:text-red-400')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  /** Route Optimization Tab */
  const renderRoutesTab = () => (
    <div className="space-y-4">
      {/* Route KPIs */}
      <div className={ds.grid4}>
        <StatCard
          icon={Route}
          label="Active Routes"
          value={
            filtered.filter(
              (r) => r.meta?.status === 'in_progress' || r.meta?.status === 'dispatched'
            ).length
          }
        />
        <StatCard
          icon={Navigation}
          label="Total Distance"
          value={`${formatNumber(filtered.reduce((s, r) => s + (Number((r.data as Record<string, unknown>).distance) || 0), 0))} mi`}
          color="text-blue-500"
        />
        <StatCard
          icon={Fuel}
          label="Total Fuel Cost"
          value={formatCurrency(
            filtered.reduce(
              (s, r) => s + (Number((r.data as Record<string, unknown>).fuelCost) || 0),
              0
            )
          )}
          color="text-amber-400"
        />
        <StatCard
          icon={DollarSign}
          label="Total Tolls"
          value={formatCurrency(
            filtered.reduce(
              (s, r) => s + (Number((r.data as Record<string, unknown>).tollCost) || 0),
              0
            )
          )}
          color="text-neon-purple"
        />
      </div>

      {/* Route Cards */}
      {filtered.map((item) => {
        const d = item.data as Record<string, unknown>;
        const status = item.meta?.status || 'planned';
        const stops =
          (d.stops as Array<{ address: string; timeWindow: string; status: string }>) || [];
        const expanded = routeExpanded === item.id;
        const completedStops = stops.filter((s) => s.status === 'completed').length;

        return (
          <div key={item.id} className={cn(ds.panel, 'space-y-3')}>
            {/* Route Header */}
            <div
              className="flex items-start justify-between cursor-pointer"
              onClick={() => setRouteExpanded(expanded ? null : item.id)}
            >
              <div className="flex items-center gap-3">
                <button
                  className={ds.btnGhost}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRouteExpanded(expanded ? null : item.id);
                  }}
                >
                  {expanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                <div>
                  <h3 className={ds.heading3}>{item.title}</h3>
                  <p className={ds.textMuted}>
                    {String(d.origin)} → {String(d.destination)} | {String(d.distance)} mi |{' '}
                    {String(d.estimatedTime)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={ds.badge(STATUS_COLORS[status] || 'gray-400')}>
                  {String(status).replace(/_/g, ' ')}
                </span>
                {Boolean(d.optimized) && <span className={ds.badge('green-400')}>Optimized</span>}
              </div>
            </div>

            {/* Route Summary Bar */}
            <div className="grid grid-cols-5 gap-3 text-sm">
              <div>
                <span className="text-gray-500 text-xs">Stops</span>
                <p className="font-medium">
                  {completedStops}/{stops.length}
                </p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Distance</span>
                <p className="font-medium">{formatNumber(Number(d.distance))} mi</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Est. Time</span>
                <p className="font-medium">{String(d.estimatedTime)}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Fuel Cost</span>
                <p className="font-medium">{formatCurrency(Number(d.fuelCost))}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Tolls</span>
                <p className="font-medium">{formatCurrency(Number(d.tollCost))}</p>
              </div>
            </div>

            <ProgressBar value={completedStops} max={stops.length || 1} />

            {/* Expanded Stop Sequence */}
            {expanded && (
              <div className="space-y-1 pt-2 border-t border-lattice-border">
                <div className="flex items-center gap-2 mb-2">
                  <Milestone className="w-4 h-4 text-neon-cyan" />
                  <span className="text-sm font-medium">Stop Sequence</span>
                  <span className={ds.textMuted}>
                    Vehicle: {String(d.vehicleAssigned)} | Driver: {String(d.driverAssigned)}
                  </span>
                </div>
                {stops.map((stop, idx) => {
                  const stopColor =
                    stop.status === 'completed'
                      ? 'text-green-400'
                      : stop.status === 'arrived'
                        ? 'text-neon-cyan'
                        : stop.status === 'skipped'
                          ? 'text-gray-500'
                          : 'text-gray-400';
                  const StopIcon =
                    stop.status === 'completed'
                      ? CheckCircle2
                      : stop.status === 'arrived'
                        ? CircleDot
                        : stop.status === 'skipped'
                          ? XCircle
                          : Clock;
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-lattice-elevated/50"
                    >
                      <div className="flex flex-col items-center">
                        <StopIcon className={cn('w-4 h-4', stopColor)} />
                        {idx < stops.length - 1 && (
                          <div className="w-px h-6 bg-lattice-border mt-1" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            Stop {idx + 1}: {stop.address}
                          </span>
                          <span className={ds.badge(STATUS_COLORS[stop.status] || 'gray-400')}>
                            {stop.status}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          Time window: {stop.timeWindow}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Route Cost Summary */}
                <div className="flex items-center gap-4 pt-3 mt-2 border-t border-lattice-border text-sm">
                  <span className="text-gray-400">Total Cost:</span>
                  <span className="font-medium">
                    {formatCurrency(Number(d.fuelCost) + Number(d.tollCost))}
                  </span>
                  <span className="text-gray-400 ml-4">Avg Speed:</span>
                  <span className="font-medium">{String(d.avgSpeed)} mph</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => openEdit(item.id)} className={ds.btnGhost}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      className={cn(ds.btnGhost, 'hover:text-red-400')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleAction('optimizeRoute', item.id)}
                      className={cn(ds.btnSecondary, ds.btnSmall)}
                    >
                      <Zap className="w-3.5 h-3.5" /> Optimize
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /** Compliance Center Tab */
  const renderComplianceTab = () => {
    const inspections = filtered.filter((c) => {
      const dt = (c.data as Record<string, unknown>).documentType;
      return dt === 'inspection';
    });
    const dvirs = filtered.filter((c) => {
      const dt = (c.data as Record<string, unknown>).documentType;
      return dt === 'dvir';
    });
    const audits = filtered.filter((c) => {
      const dt = (c.data as Record<string, unknown>).documentType;
      return dt === 'audit';
    });
    const documents = filtered.filter((c) => {
      const dt = (c.data as Record<string, unknown>).documentType;
      return dt === 'insurance' || dt === 'registration' || dt === 'permit';
    });

    const totalViolations = filtered.reduce(
      (s, c) => s + (Number((c.data as Record<string, unknown>).violations) || 0),
      0
    );
    const totalFines = filtered.reduce(
      (s, c) => s + (Number((c.data as Record<string, unknown>).fineAmount) || 0),
      0
    );

    return (
      <div className="space-y-4">
        {/* Compliance KPIs */}
        <div className={ds.grid4}>
          <StatCard icon={ShieldCheck} label="Total Records" value={filtered.length} />
          <StatCard
            icon={AlertTriangle}
            label="Violations"
            value={totalViolations}
            color="text-red-400"
          />
          <StatCard
            icon={DollarSign}
            label="Total Fines"
            value={formatCurrency(totalFines)}
            color="text-amber-400"
          />
          <StatCard
            icon={FileText}
            label="Flagged Items"
            value={filtered.filter((c) => c.meta?.status === 'flagged').length}
            color="text-red-400"
          />
        </div>

        {/* Document Expiration Alerts */}
        {(() => {
          const expiring = documents.filter((d) => {
            const exp = (d.data as Record<string, unknown>).expiryDate;
            return exp && daysUntil(String(exp)) <= 90;
          });
          return expiring.length > 0 ? (
            <div className={cn(ds.panel, 'border-amber-400/30')}>
              <div className="flex items-center gap-2 mb-2">
                <FileWarning className="w-4 h-4 text-amber-400" />
                <span className={ds.heading3}>Document Expiration Alerts</span>
              </div>
              {expiring.map((item) => {
                const d = item.data as Record<string, unknown>;
                const days = daysUntil(String(d.expiryDate));
                return (
                  <div key={item.id} className="flex items-center gap-3 py-2 text-sm">
                    <Shield
                      className={cn('w-4 h-4', days <= 30 ? 'text-red-400' : 'text-amber-400')}
                    />
                    <span className="flex-1">
                      {item.title} - {String(d.category)}
                    </span>
                    <span className={ds.badge(days <= 30 ? 'red-400' : 'amber-400')}>
                      {days <= 0 ? 'EXPIRED' : `Expires in ${days}d`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null;
        })()}

        {/* DOT Inspections */}
        {inspections.length > 0 ? (
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-neon-cyan" />
              <h3 className={ds.heading3}>DOT Inspection Log</h3>
              <span className={ds.badge('neon-cyan')}>{inspections.length}</span>
            </div>
            <div className="space-y-2">
              {inspections.map((item) => {
                const d = item.data as Record<string, unknown>;
                const result = String(d.result);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg',
                      'bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer'
                    )}
                    onClick={() => setDetailId(item.id)}
                  >
                    {result === 'pass' ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : result === 'fail' ? (
                      <XCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <div className="flex-1">
                      <span className="text-sm font-medium">{item.title}</span>
                      <p className="text-xs text-gray-400">
                        {String(d.category)} | {String(d.inspector)} | {String(d.date)}
                      </p>
                    </div>
                    <span className={ds.badge(STATUS_COLORS[result] || 'gray-400')}>{result}</span>
                    {Number(d.violations) > 0 && (
                      <span className={ds.badge('red-400')}>
                        {String(d.violations)} violation(s)
                      </span>
                    )}
                    <span className="text-xs text-gray-500">Next: {String(d.nextDue)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
            <p>No inspections recorded yet. Add inspection records to track quality.</p>
          </div>
        )}

        {/* DVIRs */}
        {dvirs.length > 0 && (
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-green-400" />
              <h3 className={ds.heading3}>DVIR Entries</h3>
              <span className={ds.badge('green-400')}>{dvirs.length}</span>
            </div>
            <div className="space-y-2">
              {dvirs.map((item) => {
                const d = item.data as Record<string, unknown>;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer'
                    )}
                    onClick={() => setDetailId(item.id)}
                  >
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <div className="flex-1">
                      <span className="text-sm font-medium">{item.title}</span>
                      <p className="text-xs text-gray-400">
                        {String(d.category)} | Vehicle {String(d.vehicle)} | {String(d.date)}
                      </p>
                    </div>
                    <span className={ds.badge(STATUS_COLORS[String(d.result)] || 'gray-400')}>
                      {String(d.result)}
                    </span>
                    <p className="text-xs text-gray-400 max-w-[200px] truncate">
                      {String(d.findings)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ELD Audits */}
        {audits.length > 0 && (
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-red-400" />
              <h3 className={ds.heading3}>ELD Audit Log</h3>
              <span className={ds.badge('red-400')}>{audits.length}</span>
            </div>
            <div className="space-y-2">
              {audits.map((item) => {
                const d = item.data as Record<string, unknown>;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer'
                    )}
                    onClick={() => setDetailId(item.id)}
                  >
                    {String(d.result) === 'fail' ? (
                      <XCircle className="w-4 h-4 text-red-400" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    )}
                    <div className="flex-1">
                      <span className="text-sm font-medium">{item.title}</span>
                      <p className="text-xs text-gray-400">
                        {String(d.date)} | Vehicle {String(d.vehicle)}
                      </p>
                    </div>
                    <span className={ds.badge(STATUS_COLORS[String(d.result)] || 'gray-400')}>
                      {String(d.result)}
                    </span>
                    {Number(d.fineAmount) > 0 && (
                      <span className={ds.badge('red-400')}>
                        {formatCurrency(Number(d.fineAmount))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Violation Tracker */}
        {totalViolations > 0 && (
          <div className={cn(ds.panel, 'border-red-400/30')}>
            <div className="flex items-center gap-2 mb-3">
              <Siren className="w-4 h-4 text-red-400" />
              <h3 className={ds.heading3}>Violation Summary</h3>
            </div>
            <div className="space-y-2">
              {filtered
                .filter((c) => Number((c.data as Record<string, unknown>).violations) > 0)
                .map((item) => {
                  const d = item.data as Record<string, unknown>;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 py-2 border-b border-lattice-border last:border-0"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="flex-1 text-sm">{item.title}</span>
                      <span className="text-xs text-gray-400">
                        {String(d.type)} | {String(d.date)}
                      </span>
                      <span className={ds.badge('red-400')}>
                        {String(d.violations)} violation(s)
                      </span>
                      {Number(d.fineAmount) > 0 && (
                        <span className="text-sm text-red-400">
                          {formatCurrency(Number(d.fineAmount))}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Generic fallback for items not matching above */}
        {documents.length > 0 && (
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-neon-purple" />
              <h3 className={ds.heading3}>Documents & Permits</h3>
            </div>
            <div className="space-y-2">
              {documents.map((item) => {
                const d = item.data as Record<string, unknown>;
                const exp = d.expiryDate ? daysUntil(String(d.expiryDate)) : null;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer"
                    onClick={() => setDetailId(item.id)}
                  >
                    <FileText className="w-4 h-4 text-neon-purple" />
                    <div className="flex-1">
                      <span className="text-sm font-medium">{item.title}</span>
                      <p className="text-xs text-gray-400">
                        {String(d.category)} | {String(d.findings)}
                      </p>
                    </div>
                    {exp !== null && (
                      <span
                        className={ds.badge(
                          exp <= 30 ? 'red-400' : exp <= 90 ? 'amber-400' : 'green-400'
                        )}
                      >
                        {exp <= 0 ? 'EXPIRED' : `${exp}d remaining`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /** Default card grid (fallback) */
  const renderDefaultGrid = () => (
    <div className={ds.grid3}>
      {filtered.map((item) => {
        const status = item.meta?.status || 'active';
        const color = STATUS_COLORS[status] || 'gray-400';
        return (
          <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item.id)}>
            <div className="flex items-start justify-between mb-2">
              <h3 className={cn(ds.heading3, 'truncate flex-1')}>{item.title}</h3>
              <span className={ds.badge(color)}>{String(status).replace(/_/g, ' ')}</span>
            </div>
            <div className="space-y-1 mb-3">
              {Object.entries(item.data as Record<string, unknown>)
                .slice(0, 4)
                .map(([k, v]) => (
                  <p key={k} className={ds.textMuted}>
                    <span className="text-gray-500">{k}:</span> {String(v)}
                  </p>
                ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
              <span className={ds.textMuted}>{new Date(item.updatedAt).toLocaleDateString()}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(item.id);
                  }}
                  className={ds.btnGhost}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(item.id);
                  }}
                  className={cn(ds.btnGhost, 'hover:text-red-400')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  // Tab content router
  const renderTabContent = () => {
    if (isLoading) {
      return (
        <div className="text-center py-12">
          <p className={ds.textMuted}>Loading {currentType.toLowerCase()}s...</p>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="text-center py-12">
          <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {currentType.toLowerCase()}s found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create one
          </button>
        </div>
      );
    }
    switch (mode) {
      case 'fleet':
        return renderFleetTab();
      case 'drivers':
        return renderDriversTab();
      case 'shipments':
        return renderShipmentsTab();
      case 'warehouse':
        return renderWarehouseTab();
      case 'routes':
        return renderRoutesTab();
      case 'compliance':
        return renderComplianceTab();
      default:
        return renderDefaultGrid();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <LensPageShell
      domain="logistics"
      title="Transportation &amp; Logistics"
      description="Fleet, drivers, shipments, warehouse, routes, and compliance management"
      headerIcon={<Truck className="w-6 h-6 text-neon-cyan" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      }
    >
      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Shipments', value: String(allShipments.length), icon: Package },
          {
            label: 'On-Time Rate',
            value: `${Math.round(Number(dashMetrics.onTimeRate))}%`,
            icon: CheckCircle,
          },
          { label: 'Warehouses', value: String(allWarehouse.length), icon: Warehouse },
          { label: 'Active Fleet', value: String(dashMetrics.activeVehicles), icon: Truck },
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
      <UniversalActions domain="logistics" artifactId={items[0]?.id} compact />
      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setMode(tab.id);
                setSearch('');
                setStatusFilter('all');
                setDetailId(null);
                setRouteExpanded(null);
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Enhanced Dashboard Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={Truck}
          label="Active Fleet"
          value={`${dashMetrics.activeVehicles}/${dashMetrics.totalVehicles}`}
          color="text-neon-cyan"
        />
        <StatCard
          icon={Package}
          label="In Transit"
          value={dashMetrics.inTransit}
          color="text-neon-purple"
        />
        <StatCard
          icon={Target}
          label="On-Time Rate"
          value={`${dashMetrics.onTimeRate}%`}
          color="text-green-400"
          trend="up"
        />
        <StatCard
          icon={Gauge}
          label="Fleet Util."
          value={`${dashMetrics.utilizationAvg}%`}
          color="text-blue-500"
        />
        <StatCard
          icon={Warehouse}
          label="WH Capacity"
          value={`${dashMetrics.whUtilPct}%`}
          color="text-amber-400"
        />
        <StatCard
          icon={DollarSign}
          label="Rev/Mile"
          value={`$${dashMetrics.revPerMile}`}
          color="text-green-400"
          trend="up"
        />
      </div>

      {/* Compliance Alerts Banner */}
      {dashMetrics.compAlerts > 0 && (
        <div
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20'
          )}
        >
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <span className="text-sm">
            <span className="font-medium text-red-400">
              {dashMetrics.compAlerts} compliance alert(s)
            </span>{' '}
            require attention - flagged inspections, expiring documents, or HOS violations
          </span>
          <button
            onClick={() => {
              setMode('compliance');
              setStatusFilter('all');
            }}
            className={cn(ds.btnSmall, ds.btnDanger, 'ml-auto')}
          >
            View Compliance
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className={cn(ds.input, 'pl-10')}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={cn(ds.select, 'pl-10 pr-8')}
          >
            <option value="all">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <span className={cn(ds.textMuted, 'text-xs')}>
          {filtered.length} of {items.length} items
        </span>
      </div>

      {/* Domain Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleAction('optimizeRoute')} className={ds.btnSecondary}>
          <Zap className="w-4 h-4" /> Optimize Route
        </button>
        <button onClick={() => handleAction('hosCheck')} className={ds.btnSecondary}>
          <Timer className="w-4 h-4" /> HOS Check
        </button>
        <button onClick={() => handleAction('maintenanceAlert')} className={ds.btnSecondary}>
          <Wrench className="w-4 h-4" /> Maintenance Alert
        </button>
        <button onClick={() => handleAction('fleetReport')} className={ds.btnSecondary}>
          <BarChart3 className="w-4 h-4" /> Fleet Report
        </button>
        <button onClick={() => handleAction('complianceAudit')} className={ds.btnSecondary}>
          <ShieldCheck className="w-4 h-4" /> Compliance Audit
        </button>
        {runAction.isPending && (
          <span className="text-xs text-blue-500 animate-pulse">Running...</span>
        )}
      </div>

      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {/* optimizeRoute */}
            {actionResult.totalDistanceMiles !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.stopCount)}
                    </p>
                    <p className="text-[10px] text-gray-500">Stops</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.totalDistanceMiles)} mi
                    </p>
                    <p className="text-[10px] text-gray-500">Distance</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.estimatedTotalMinutes)} min
                    </p>
                    <p className="text-[10px] text-gray-500">Est. Time</p>
                  </div>
                </div>
                {Array.isArray(actionResult.optimizedRoute) &&
                  (
                    actionResult.optimizedRoute as {
                      sequence: number;
                      name: string;
                      distanceFromPrevious: number;
                    }[]
                  )
                    .slice(0, 5)
                    .map((stop, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs px-2 py-1 bg-lattice-surface rounded"
                      >
                        <span className="w-5 h-5 rounded-full bg-neon-cyan/20 text-neon-cyan text-center leading-5 flex-shrink-0">
                          {stop.sequence}
                        </span>
                        <span className="text-gray-300 flex-1">{stop.name}</span>
                        <span className="text-gray-500">{stop.distanceFromPrevious} mi</span>
                      </div>
                    ))}
              </div>
            )}
            {/* hosCheck */}
            {actionResult.driversChecked !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.driversChecked)}
                    </p>
                    <p className="text-[10px] text-gray-500">Drivers</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.violationCount) > 0 ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.violationCount)}
                    </p>
                    <p className="text-[10px] text-gray-500">Violations</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.warningCount) > 0 ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.warningCount)}
                    </p>
                    <p className="text-[10px] text-gray-500">Warnings</p>
                  </div>
                </div>
              </div>
            )}
            {/* maintenanceDue (vehicles) */}
            {actionResult.totalVehicles !== undefined && (
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-red-400">
                    {String(actionResult.overdueCount)}
                  </p>
                  <p className="text-[10px] text-gray-500">Overdue</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-amber-400">
                    {String(actionResult.upcomingCount)}
                  </p>
                  <p className="text-[10px] text-gray-500">Upcoming</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">
                    {String(actionResult.totalVehicles)}
                  </p>
                  <p className="text-[10px] text-gray-500">Total</p>
                </div>
              </div>
            )}
            {/* inventoryAudit */}
            {actionResult.accuracyRate !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">
                      {String(actionResult.accuracyRate)}%
                    </p>
                    <p className="text-[10px] text-gray-500">Accuracy</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.discrepancyCount) > 0 ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {String(actionResult.discrepancyCount)}
                    </p>
                    <p className="text-[10px] text-gray-500">Discrepancies</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p
                      className={`text-sm font-bold ${Number(actionResult.totalValueDiscrepancy) !== 0 ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      ${Number(actionResult.totalValueDiscrepancy).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-gray-500">Value Delta</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content */}
      {renderTabContent()}

      {/* Detail Modal */}
      {detailId &&
        (() => {
          const item = items.find((i) => i.id === detailId);
          if (!item) return null;
          const d = item.data as Record<string, unknown>;
          return (
            <>
              <div className={ds.modalBackdrop} onClick={() => setDetailId(null)} />
              <div className={ds.modalContainer}>
                <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[80vh] flex flex-col')}>
                  <div className="flex items-center justify-between p-4 border-b border-lattice-border shrink-0">
                    <div>
                      <h2 className={ds.heading2}>{item.title}</h2>
                      <span
                        className={ds.badge(
                          STATUS_COLORS[item.meta?.status || 'active'] || 'gray-400'
                        )}
                      >
                        {String(item.meta?.status || 'active').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setDetailId(null);
                          openEdit(item.id);
                        }}
                        className={ds.btnSecondary}
                      >
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>
                      <button onClick={() => setDetailId(null)} className={ds.btnGhost}>
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-4 space-y-3 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(d).map(([key, value]) => {
                        if (typeof value === 'object' && value !== null) return null;
                        return (
                          <div key={key} className="space-y-0.5">
                            <span className={cn(ds.textMuted, 'text-xs capitalize')}>
                              {key.replace(/([A-Z])/g, ' $1')}
                            </span>
                            <p className="text-sm font-medium">
                              {typeof value === 'number' && key.toLowerCase().includes('cost')
                                ? formatCurrency(value)
                                : typeof value === 'number' &&
                                    key.toLowerCase().includes('rate') &&
                                    value < 200
                                  ? `${value}%`
                                  : typeof value === 'number'
                                    ? formatNumber(value)
                                    : typeof value === 'boolean'
                                      ? value
                                        ? 'Yes'
                                        : 'No'
                                      : String(value ?? 'N/A')}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    {/* Show stops if it is a route */}
                    {Array.isArray(d.stops) && (
                      <div className="pt-3 border-t border-lattice-border">
                        <h3 className={cn(ds.heading3, 'mb-2')}>Stops</h3>
                        {(
                          d.stops as Array<{ address: string; timeWindow: string; status: string }>
                        ).map((stop, idx) => (
                          <div key={idx} className="flex items-center gap-2 py-1 text-sm">
                            <Hash className="w-3 h-3 text-gray-500" />
                            <span className="font-medium">{stop.address}</span>
                            <span className="text-gray-500">{stop.timeWindow}</span>
                            <span className={ds.badge(STATUS_COLORS[stop.status] || 'gray-400')}>
                              {stop.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Show exceptions if shipment */}
                    {Array.isArray(d.exceptions) && (d.exceptions as string[]).length > 0 && (
                      <div className="pt-3 border-t border-lattice-border">
                        <h3 className={cn(ds.heading3, 'mb-2')}>Exceptions</h3>
                        {(d.exceptions as string[]).map((ex, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-red-400">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{ex}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 pt-3 border-t border-lattice-border">
                      <span>Created: {new Date(item.createdAt).toLocaleString()}</span>
                      <span className="mx-2">|</span>
                      <span>Updated: {new Date(item.updatedAt).toLocaleString()}</span>
                      <span className="mx-2">|</span>
                      <span>Version: {item.version}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

      {/* Editor modal */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={resetForm} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>
                  {editing ? 'Edit' : 'New'} {currentType}
                </h2>
                <button onClick={resetForm} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className={ds.input}
                    placeholder={`${currentType} title`}
                  />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className={ds.select}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                {fieldLabels[mode].map((lbl, idx) => {
                  const val = [
                    formField1,
                    formField2,
                    formField3,
                    formField4,
                    formField5,
                    formField6,
                  ][idx];
                  const setter = [
                    setFormField1,
                    setFormField2,
                    setFormField3,
                    setFormField4,
                    setFormField5,
                    setFormField6,
                  ][idx];
                  return (
                    <div key={lbl}>
                      <label className={ds.label}>{lbl}</label>
                      <input
                        value={val}
                        onChange={(e) => setter(e.target.value)}
                        className={ds.input}
                        placeholder={lbl}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t border-lattice-border">
                <button onClick={resetForm} className={ds.btnSecondary}>
                  Cancel
                </button>
                <button onClick={handleSave} className={ds.btnPrimary} disabled={!formTitle.trim()}>
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Recent Activity Feed */}
      <section>
        <h2 className={cn(ds.heading2, 'mb-3')}>Recent Activity</h2>
        <div className={ds.panel}>
          <div className="divide-y divide-lattice-border">
            {[
              {
                icon: Truck,
                text: 'Cascadia #101 departed Chicago hub en route to New York',
                time: '2h ago',
                color: 'text-neon-cyan',
              },
              {
                icon: CheckCircle,
                text: 'Shipment SH-2026-0005 delivered to Chicago, POD signed',
                time: '5h ago',
                color: 'text-green-400',
              },
              {
                icon: AlertTriangle,
                text: 'Robert Chen: HOS violation flagged - exceeded 14-hour on-duty limit',
                time: '8h ago',
                color: 'text-red-400',
              },
              {
                icon: Wrench,
                text: 'Peterbilt 579 #103 entered maintenance bay - brake service',
                time: '12h ago',
                color: 'text-amber-400',
              },
              {
                icon: ShieldCheck,
                text: 'DOT Level 1 inspection passed for Kenworth T680 #102',
                time: '1d ago',
                color: 'text-green-400',
              },
              {
                icon: Fuel,
                text: 'Fleet fuel cost up 4.2% this week - $3.89/gal avg diesel',
                time: '1d ago',
                color: 'text-red-400',
              },
              {
                icon: Route,
                text: 'Route RT-ATL-PDX-01 optimized - saved 45 miles',
                time: '1d ago',
                color: 'text-blue-500',
              },
              {
                icon: FileWarning,
                text: 'International LT #105 insurance expiring in 26 days',
                time: '2d ago',
                color: 'text-amber-400',
              },
              {
                icon: Star,
                text: 'Diana Martinez achieved 99 safety score - top performer',
                time: '2d ago',
                color: 'text-neon-purple',
              },
              {
                icon: MapPin,
                text: 'Shipment SH-2026-0004 exception: delayed at Denver terminal',
                time: '2d ago',
                color: 'text-amber-400',
              },
            ].map((evt, i) => {
              const Icon = evt.icon;
              return (
                <div
                  key={i}
                  data-lens-theme="logistics"
                  className="flex items-center gap-3 py-3 px-2"
                >
                  <Icon className={cn('w-4 h-4 shrink-0', evt.color)} />
                  <span className="flex-1 text-sm text-gray-200">{evt.text}</span>
                  <span className={cn(ds.textMuted, 'shrink-0')}>{evt.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ==================== MAP TAB ==================== */}
      {mode === 'map' && (
        <div className={ds.panel}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-neon-cyan" /> Route Visualization
          </h3>
          <MapView
            markers={items
              .filter((i) => {
                const d = i.data as Record<string, unknown>;
                return d.lat && d.lng;
              })
              .map((i) => {
                const d = i.data as Record<string, unknown>;
                return {
                  lat: d.lat as number,
                  lng: d.lng as number,
                  label: i.title,
                  popup:
                    `${d.status || ''} ${d.origin ? '- ' + d.origin + ' to ' + (d.destination || '') : ''}`.trim(),
                };
              })}
            className="h-[500px]"
          />
        </div>
      )}
    </LensPageShell>
  );
}
