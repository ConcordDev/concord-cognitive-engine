'use client';

import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { useState, useMemo, useCallback } from 'react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Plane, Plus, Search, Clock, Users, Calendar, X, Navigation,
  Shield, Wrench, FileText, DollarSign, Weight, AlertTriangle, CheckCircle,
  XCircle, ChevronDown, ChevronRight, Fuel, MapPin,
  UserCheck, Clipboard, Calculator, BarChart3,
  Timer, Award, CloudRain, TrendingUp, Package,
  Wind, Thermometer, Eye, Droplets, Layers,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'dashboard' | 'flights' | 'pilots' | 'fleet' | 'maintenance' | 'charter' | 'wb' | 'weather';


interface PilotData {
  name: string;
  employeeId: string;
  certificate: string;
  certificateNumber: string;
  ratings: string[];
  typeRatings: string[];
  medicalClass: string;
  medicalExpiry: string;
  bfrDate: string;
  ipcDate: string;
  totalHours: number;
  picHours: number;
  sicHours: number;
  nightHours: number;
  instrumentHours: number;
  crossCountryHours: number;
  multiEngineHours: number;
  last30Days: number;
  last90Days: number;
  last12Months: number;
  dutyOnTime: string;
  dutyOffTime: string;
  restStart: string;
  flightRegulation: string;
  phone: string;
  email: string;
  baseAirport: string;
}

interface AircraftData {
  tailNumber: string;
  type: string;
  make: string;
  model: string;
  year: number;
  serialNumber: string;
  totalTime: number;
  tsmoh: number;
  tspoh: number;
  nextAnnual: string;
  next100hr: number;
  adCompliance: string[];
  squawks: string[];
  emptyWeight: number;
  emptyCG: number;
  maxGross: number;
  fuelCapacity: number;
  usefulLoad: number;
  stations: string;
  engType: string;
  engHP: number;
  avionics: string;
  insuranceExpiry: string;
  registrationExpiry: string;
}

interface MaintenanceData {
  aircraft: string;
  tailNumber: string;
  workOrderNumber: string;
  discrepancy: string;
  melReference: string;
  partsUsed: string;
  laborHours: number;
  mechanic: string;
  mechanicCert: string;
  inspector: string;
  inspectorCert: string;
  adReference: string;
  sbReference: string;
  componentName: string;
  componentTSN: number;
  componentLifeLimit: number;
  dateOpened: string;
  dateClosed: string;
  category: string;
  priority: string;
}

interface CharterData {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  departure: string;
  arrival: string;
  date: string;
  returnDate: string;
  aircraft: string;
  passengerCount: number;
  passengerNames: string;
  catering: string;
  groundTransport: string;
  distanceNM: number;
  ratePerNM: number;
  baseFee: number;
  fuelSurcharge: number;
  cateringCost: number;
  groundTransportCost: number;
  totalPrice: number;
  depositPaid: number;
  specialRequests: string;
  confirmationNumber: string;
}

interface WBData {
  aircraft: string;
  tailNumber: string;
  emptyWeight: number;
  emptyArm: number;
  emptyMoment: number;
  fuelWeight: number;
  fuelArm: number;
  pilotWeight: number;
  pilotArm: number;
  copilotWeight: number;
  copilotArm: number;
  paxRow1Weight: number;
  paxRow1Arm: number;
  paxRow2Weight: number;
  paxRow2Arm: number;
  cargoWeight: number;
  cargoArm: number;
  baggageWeight: number;
  baggageArm: number;
  totalWeight: number;
  totalMoment: number;
  cg: number;
  maxGross: number;
  fwdCGLimit: number;
  aftCGLimit: number;
  withinLimits: boolean;
  date: string;
}

interface WeatherData {
  stationId: string;
  observationTime: string;
  rawMetar: string;
  windDirection: number;
  windSpeed: number;
  windGust: number;
  visibility: number;
  ceiling: number;
  temperature: number;
  dewpoint: number;
  altimeter: number;
  flightCategory: string;
  wxConditions: string;
  cloudLayers: string;
  remarks: string;
  taf: string;
  notams: string;
  pirepSummary: string;
  airmets: string;
  sigmets: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODE_TABS: { key: ModeTab; label: string; icon: typeof Plane }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'flights', label: 'Flights', icon: Plane },
  { key: 'pilots', label: 'Pilots', icon: Users },
  { key: 'fleet', label: 'Fleet', icon: Navigation },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'charter', label: 'Charter', icon: DollarSign },
  { key: 'wb', label: 'W&B', icon: Weight },
  { key: 'weather', label: 'Weather', icon: CloudRain },
];

const FLIGHT_STATUSES = ['planned', 'dispatched', 'airborne', 'completed', 'cancelled', 'diverted'];
const PILOT_CERTS = ['PPL', 'CPL', 'ATP'];
const PILOT_RATINGS = ['IFR', 'Multi-Engine', 'SEL', 'SES', 'MEL', 'MES'];
const AIRCRAFT_STATUSES = ['airworthy', 'in-maintenance', 'grounded', 'stored'];
const MX_CATEGORIES = ['scheduled', 'unscheduled', 'ad-compliance', 'sb-compliance', 'inspection', 'overhaul'];
const MX_PRIORITIES = ['routine', 'priority', 'AOG', 'safety'];
const CHARTER_STATUSES = ['inquiry', 'quoted', 'confirmed', 'completed', 'cancelled'];
const FLIGHT_REGS = ['14 CFR 91', '14 CFR 91.1059', '14 CFR 135.267', '14 CFR 121'];
const FLIGHT_CATEGORIES = ['VFR', 'MVFR', 'IFR', 'LIFR'];

const STATUS_COLORS: Record<string, string> = {
  planned: 'blue-400', dispatched: 'yellow-400', airborne: 'green-400',
  completed: 'gray-400', cancelled: 'red-400', diverted: 'orange-400',
  airworthy: 'green-400', 'in-maintenance': 'orange-400', grounded: 'red-400',
  stored: 'purple-400', routine: 'blue-400', priority: 'yellow-400',
  AOG: 'red-400', safety: 'red-500', inquiry: 'blue-400', quoted: 'yellow-400',
  confirmed: 'green-400', current: 'green-400', expiring: 'yellow-400', expired: 'red-400',
  scheduled: 'blue-400', unscheduled: 'orange-400', 'ad-compliance': 'red-400',
  'sb-compliance': 'yellow-400', inspection: 'cyan-400', overhaul: 'purple-400',
  VFR: 'green-400', MVFR: 'blue-400', IFR: 'red-400', LIFR: 'purple-400',
};

function statusBadge(status: string) {
  const color = STATUS_COLORS[status] || 'gray-400';
  return `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${color.replace('-400', '-500').replace('-500', '-500')}/20 text-${color}`;
}

function getTypeForTab(tab: ModeTab): string {
  switch (tab) {
    case 'flights': return 'Flight';
    case 'pilots': return 'Pilot';
    case 'fleet': return 'Aircraft';
    case 'maintenance': return 'WorkOrder';
    case 'charter': return 'Charter';
    case 'wb': return 'WeightBalance';
    case 'weather': return 'Weather';
    default: return 'Flight';
  }
}

function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'flights': return FLIGHT_STATUSES;
    case 'fleet': return AIRCRAFT_STATUSES;
    case 'maintenance': return MX_CATEGORIES;
    case 'charter': return CHARTER_STATUSES;
    case 'weather': return FLIGHT_CATEGORIES;
    default: return [];
  }
}

function daysUntil(dateStr: string): number {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function currencyStatus(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return 'expired';
  if (days < 30) return 'expiring';
  return 'current';
}

function formatHobbs(start: number, end: number): string {
  if (!start && !end) return '--';
  if (end && start) return `${(end - start).toFixed(1)}h`;
  return `${(start || 0).toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AviationLensPage() {
  useLensNav('aviation');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('aviation');

  const [showFeatures, setShowFeatures] = useState(true);
  const [activeMode, setActiveMode] = useState<ModeTab>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Determine type for active tab
  const currentType = getTypeForTab(activeMode === 'dashboard' ? 'flights' : activeMode);

  // Data hooks for each entity type
  const flightQuery = useLensData('aviation', 'Flight', {
    search: activeMode === 'flights' ? searchQuery || undefined : undefined,
    status: activeMode === 'flights' ? statusFilter || undefined : undefined,
  });
  const pilotQuery = useLensData('aviation', 'Pilot', {
    search: activeMode === 'pilots' ? searchQuery || undefined : undefined,
  });
  const fleetQuery = useLensData('aviation', 'Aircraft', {
    search: activeMode === 'fleet' ? searchQuery || undefined : undefined,
    status: activeMode === 'fleet' ? statusFilter || undefined : undefined,
  });
  const mxQuery = useLensData('aviation', 'WorkOrder', {
    search: activeMode === 'maintenance' ? searchQuery || undefined : undefined,
    status: activeMode === 'maintenance' ? statusFilter || undefined : undefined,
  });
  const charterQuery = useLensData('aviation', 'Charter', {
    search: activeMode === 'charter' ? searchQuery || undefined : undefined,
    status: activeMode === 'charter' ? statusFilter || undefined : undefined,
  });
  const wbQuery = useLensData('aviation', 'WeightBalance', {
    search: activeMode === 'wb' ? searchQuery || undefined : undefined,
  });
  const weatherQuery = useLensData('aviation', 'Weather', {
    search: activeMode === 'weather' ? searchQuery || undefined : undefined,
    status: activeMode === 'weather' ? statusFilter || undefined : undefined,
  });

  const runAction = useRunArtifact('aviation');

  // Active query based on tab
  const activeQuery = useMemo(() => {
    switch (activeMode) {
      case 'flights': return flightQuery;
      case 'pilots': return pilotQuery;
      case 'fleet': return fleetQuery;
      case 'maintenance': return mxQuery;
      case 'charter': return charterQuery;
      case 'wb': return wbQuery;
      case 'weather': return weatherQuery;
      default: return flightQuery;
    }
  }, [activeMode, flightQuery, pilotQuery, fleetQuery, mxQuery, charterQuery, wbQuery, weatherQuery]);

  const items = activeQuery.items;
  const { create, update, remove, isLoading, isError, error, refetch } = activeQuery;

  // -----------------------------------------------------------------------
  // Form state (unified for all types)
  // -----------------------------------------------------------------------
  const [form, setForm] = useState<Record<string, unknown>>({});
  const setField = useCallback((key: string, value: unknown) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setForm({});
    setEditingId(null);
    setShowEditor(false);
  }, []);

  const openNew = useCallback(() => {
    setForm({});
    setEditingId(null);
    setShowEditor(true);
  }, []);

  const openEdit = useCallback((item: LensItem) => {
    setEditingId(item.id);
    const d = item.data as Record<string, unknown>;
    setForm({ ...d, _title: item.title, _status: item.meta?.status || '' });
    setShowEditor(true);
  }, []);

  const handleCreate = async () => {
    const { _title, _status, ...data } = form;
    await create({
      title: (_title as string) || `New ${currentType}`,
      data: data as Record<string, unknown>,
      meta: { status: (_status as string) || 'planned', tags: [] },
    });
    resetForm();
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const { _title, _status, ...data } = form;
    await update(editingId, {
      title: (_title as string) || undefined,
      data: data as Record<string, unknown>,
      meta: { status: (_status as string) || undefined },
    });
    resetForm();
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingId || items[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Action failed');
    }
  };

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // -----------------------------------------------------------------------
  // Dashboard computations
  // -----------------------------------------------------------------------
  const flights = flightQuery.items;
  const pilots = pilotQuery.items;
  const fleet = fleetQuery.items;
  const workOrders = mxQuery.items;
  const charters = charterQuery.items;

  const activeFlights = flights.filter(f => f.meta?.status === 'airborne' || f.meta?.status === 'dispatched').length;
  const completedFlights = flights.filter(f => f.meta?.status === 'completed').length;
  const totalFlightHours = flights.reduce((sum, f) => {
    const d = f.data as Record<string, unknown>;
    const hobbs = ((d.hobbsEnd as number) || 0) - ((d.hobbsStart as number) || 0);
    return sum + (hobbs > 0 ? hobbs : 0);
  }, 0);
  const totalFuelBurn = flights.reduce((sum, f) => sum + ((f.data as Record<string, unknown>).fuelBurn as number || 0), 0);

  const airworthyAircraft = fleet.filter(f => f.meta?.status === 'airworthy').length;
  const groundedAircraft = fleet.filter(f => f.meta?.status === 'grounded' || f.meta?.status === 'in-maintenance').length;

  const currentPilots = pilots.filter(p => {
    const d = p.data as Record<string, unknown>;
    return currencyStatus(d.medicalExpiry as string) !== 'expired' && currencyStatus(d.bfrDate as string) !== 'expired';
  }).length;

  const openWorkOrders = workOrders.filter(w => !w.meta?.status?.includes('closed')).length;
  const aogItems = workOrders.filter(w => (w.data as Record<string, unknown>).priority === 'AOG').length;

  const pendingCharters = charters.filter(c => c.meta?.status === 'confirmed' || c.meta?.status === 'quoted').length;
  const charterRevenue = charters.filter(c => c.meta?.status === 'completed').reduce(
    (sum, c) => sum + ((c.data as Record<string, unknown>).totalPrice as number || 0), 0
  );

  const weatherBriefings = weatherQuery.items;
  const ifrStations = weatherBriefings.filter(w => {
    const d = w.data as unknown as WeatherData;
    return d.flightCategory === 'IFR' || d.flightCategory === 'LIFR';
  }).length;

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------
  if (isLoading) {
    return (
      <div data-lens-theme="aviation" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Preparing flight data...</p>
        </div>
      </div>
    );
  }

  if (isError && activeMode !== 'dashboard') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Plane className="w-5 h-5 text-sky-400" />
            <span className={ds.textMuted}>Active Flights</span>
          </div>
          <div className="text-3xl font-bold text-white">{activeFlights}</div>
          <div className="text-xs text-gray-500 mt-1">{completedFlights} completed this period</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Navigation className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Fleet Available</span>
          </div>
          <div className="text-3xl font-bold text-green-400">{airworthyAircraft}</div>
          <div className="text-xs text-gray-500 mt-1">{groundedAircraft} grounded / in maintenance</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span className={ds.textMuted}>Pilots Current</span>
          </div>
          <div className="text-3xl font-bold text-blue-400">{currentPilots}</div>
          <div className="text-xs text-gray-500 mt-1">{pilots.length} total on roster</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            <span className={ds.textMuted}>Charter Revenue</span>
          </div>
          <div className="text-3xl font-bold text-emerald-400">${charterRevenue.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">{pendingCharters} pending bookings</div>
        </div>
      </div>

      {/* Second KPI Row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            <span className={ds.textMuted}>Hours Flown</span>
          </div>
          <div className="text-2xl font-bold text-cyan-400">{totalFlightHours.toFixed(1)}</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Fuel className="w-5 h-5 text-amber-400" />
            <span className={ds.textMuted}>Fuel Burned (gal)</span>
          </div>
          <div className="text-2xl font-bold text-amber-400">{totalFuelBurn.toFixed(0)}</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Open Work Orders</span>
          </div>
          <div className="text-2xl font-bold text-orange-400">{openWorkOrders}</div>
          {aogItems > 0 && <div className="text-xs text-red-400 mt-1">{aogItems} AOG items</div>}
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-purple-400" />
            <span className={ds.textMuted}>Total Flights</span>
          </div>
          <div className="text-2xl font-bold text-purple-400">{flights.length}</div>
        </div>
      </div>

      {/* Pilot Currency Alerts */}
      <div className={ds.panel}>
        <button onClick={() => toggleSection('pilotCurrency')} className="flex items-center gap-2 w-full text-left">
          {expandedSections.pilotCurrency ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Shield className="w-5 h-5 text-yellow-400" />
          <h3 className={ds.heading3}>Pilot Currency Status</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{pilots.length} pilots</span>
        </button>
        {expandedSections.pilotCurrency && (
          <div className="mt-4 space-y-2">
            {pilots.length === 0 ? (
              <p className={ds.textMuted}>No pilots on roster. Add pilots in the Pilots tab.</p>
            ) : pilots.map(p => {
              const d = p.data as unknown as PilotData;
              const medStatus = currencyStatus(d.medicalExpiry);
              const bfrStatus = currencyStatus(d.bfrDate);
              const ipcStatus = currencyStatus(d.ipcDate);
              return (
                <div key={p.id} className="flex items-center gap-4 py-2 border-b border-lattice-border last:border-0">
                  <UserCheck className="w-4 h-4 text-sky-400" />
                  <span className="text-white font-medium w-40 truncate">{d.name || p.title}</span>
                  <span className={cn('text-xs', ds.textMuted)}>{d.certificate || '--'}</span>
                  <div className="flex gap-2 ml-auto">
                    <span className={statusBadge(medStatus)}>Medical: {medStatus}</span>
                    <span className={statusBadge(bfrStatus)}>BFR: {bfrStatus}</span>
                    {d.ratings?.includes('IFR') && <span className={statusBadge(ipcStatus)}>IPC: {ipcStatus}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upcoming Maintenance */}
      <div className={ds.panel}>
        <button onClick={() => toggleSection('upcomingMx')} className="flex items-center gap-2 w-full text-left">
          {expandedSections.upcomingMx ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Wrench className="w-5 h-5 text-orange-400" />
          <h3 className={ds.heading3}>Upcoming Maintenance</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{openWorkOrders} open</span>
        </button>
        {expandedSections.upcomingMx && (
          <div className="mt-4 space-y-2">
            {workOrders.length === 0 ? (
              <p className={ds.textMuted}>No work orders. Add maintenance items in the Maintenance tab.</p>
            ) : workOrders.slice(0, 10).map(wo => {
              const d = wo.data as unknown as MaintenanceData;
              return (
                <div key={wo.id} className="flex items-center gap-4 py-2 border-b border-lattice-border last:border-0">
                  <FileText className="w-4 h-4 text-orange-400" />
                  <span className="text-white font-medium truncate flex-1">{wo.title}</span>
                  <span className={ds.textMuted}>{d.tailNumber || '--'}</span>
                  <span className={statusBadge(d.priority || 'routine')}>{d.priority || 'routine'}</span>
                  {d.melReference && <span className="text-xs text-yellow-400">MEL: {d.melReference}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fleet Status */}
      <div className={ds.panel}>
        <button onClick={() => toggleSection('fleetStatus')} className="flex items-center gap-2 w-full text-left">
          {expandedSections.fleetStatus ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Navigation className="w-5 h-5 text-cyan-400" />
          <h3 className={ds.heading3}>Fleet Status</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{fleet.length} aircraft</span>
        </button>
        {expandedSections.fleetStatus && (
          <div className="mt-4">
            {fleet.length === 0 ? (
              <p className={ds.textMuted}>No aircraft in fleet. Add aircraft in the Fleet tab.</p>
            ) : (
              <div className={ds.grid3}>
                {fleet.map(ac => {
                  const d = ac.data as unknown as AircraftData;
                  const annualDays = daysUntil(d.nextAnnual);
                  return (
                    <div key={ac.id} className={cn(ds.panel, 'border-l-4', ac.meta?.status === 'airworthy' ? 'border-l-green-500' : ac.meta?.status === 'grounded' ? 'border-l-red-500' : 'border-l-orange-500')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-bold text-sm">{d.tailNumber || ac.title}</span>
                        <span className={statusBadge(ac.meta?.status || 'airworthy')}>{ac.meta?.status}</span>
                      </div>
                      <div className={ds.textMuted}>{d.make} {d.model} ({d.year || '--'})</div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                        <span className="text-gray-500">Total Time:</span>
                        <span className="text-white">{d.totalTime?.toFixed(1) || '0'}h</span>
                        <span className="text-gray-500">TSMOH:</span>
                        <span className="text-white">{d.tsmoh?.toFixed(1) || '0'}h</span>
                        <span className="text-gray-500">Next Annual:</span>
                        <span className={cn(annualDays < 30 ? 'text-red-400' : annualDays < 60 ? 'text-yellow-400' : 'text-white')}>
                          {d.nextAnnual || 'N/A'} {annualDays < 60 && `(${annualDays}d)`}
                        </span>
                      </div>
                      {(d.squawks?.length || 0) > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-yellow-400">
                          <AlertTriangle className="w-3 h-3" /> {d.squawks.length} open squawk{d.squawks.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weather Summary */}
      <div className={ds.panel}>
        <button onClick={() => toggleSection('weatherSummary')} className="flex items-center gap-2 w-full text-left">
          {expandedSections.weatherSummary ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <CloudRain className="w-5 h-5 text-cyan-400" />
          <h3 className={ds.heading3}>Weather Briefings</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{weatherBriefings.length} stations{ifrStations > 0 ? ` (${ifrStations} IFR/LIFR)` : ''}</span>
        </button>
        {expandedSections.weatherSummary && (
          <div className="mt-4">
            {weatherBriefings.length === 0 ? (
              <p className={ds.textMuted}>No weather briefings. Add stations in the Weather tab.</p>
            ) : (
              <div className={ds.grid3}>
                {weatherBriefings.slice(0, 6).map(w => {
                  const d = w.data as unknown as WeatherData;
                  const cat = d.flightCategory || 'VFR';
                  const catColor = cat === 'VFR' ? 'text-green-400' : cat === 'MVFR' ? 'text-blue-400' : cat === 'IFR' ? 'text-red-400' : 'text-purple-400';
                  return (
                    <div key={w.id} className="flex items-center gap-3 p-2 bg-lattice-elevated rounded-lg">
                      <CloudRain className={cn('w-4 h-4', catColor)} />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-sm font-bold text-white">{d.stationId || w.title}</span>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{d.windDirection || '--'}°/{d.windSpeed || '--'}kt</span>
                          <span>{d.visibility || '--'}SM</span>
                          <span>{d.ceiling ? `${d.ceiling}ft` : 'CLR'}</span>
                        </div>
                      </div>
                      <span className={cn('text-xs font-bold', catColor)}>{cat}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Domain Actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleAction('wb_calculate')} className={ds.btnSecondary}>
            <Calculator className="w-4 h-4" /> W&B Calculate
          </button>
          <button onClick={() => handleAction('currency_check')} className={ds.btnSecondary}>
            <Shield className="w-4 h-4" /> Currency Check
          </button>
          <button onClick={() => handleAction('maintenance_alert')} className={ds.btnSecondary}>
            <AlertTriangle className="w-4 h-4" /> Maintenance Alert
          </button>
          <button onClick={() => handleAction('flight_summary')} className={ds.btnSecondary}>
            <Clipboard className="w-4 h-4" /> Flight Summary
          </button>
          <button onClick={() => handleAction('duty_time_check')} className={ds.btnSecondary}>
            <Timer className="w-4 h-4" /> Duty Time Check
          </button>
        </div>
      </div>
    </div>
  );

  // -----------------------------------------------------------------------
  // Flight list & cards
  // -----------------------------------------------------------------------
  const renderFlightCard = (item: LensItem) => {
    const d = item.data as Record<string, unknown>;
    const hobbs = formatHobbs(d.hobbsStart as number, d.hobbsEnd as number);
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <Plane className="w-5 h-5 text-sky-400" />
          <span className={statusBadge(item.meta?.status || 'planned')}>{item.meta?.status}</span>
        </div>
        <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
        {!!(d.departure || d.arrival) && (
          <div className="flex items-center gap-2 text-sm mb-2">
            <MapPin className="w-3 h-3 text-green-400" />
            <span className="text-white font-mono text-xs">{String(d.departure || '????')}</span>
            <Navigation className="w-3 h-3 text-gray-500" />
            <span className="text-white font-mono text-xs">{String(d.arrival || '????')}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-xs mt-2">
          {!!d.aircraft && <><span className="text-gray-500">Aircraft:</span><span className="text-white">{String(d.aircraft)}</span></>}
          {!!d.tailNumber && <><span className="text-gray-500">Tail #:</span><span className="text-white font-mono">{String(d.tailNumber)}</span></>}
          {!!d.pic && <><span className="text-gray-500">PIC:</span><span className="text-white">{String(d.pic)}</span></>}
          {!!d.passengers && <><span className="text-gray-500">PAX:</span><span className="text-white">{String(d.passengers)}</span></>}
          <span className="text-gray-500">Hobbs:</span><span className="text-white">{hobbs}</span>
          {!!d.fuelBurn && <><span className="text-gray-500">Fuel:</span><span className="text-white">{String(d.fuelBurn)} gal</span></>}
        </div>
        {!!d.weatherMins && (
          <div className="flex items-center gap-1 text-xs text-cyan-400 mt-2">
            <CloudRain className="w-3 h-3" /> WX Mins: {String(d.weatherMins)}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500 mt-3 pt-2 border-t border-lattice-border">
          {!!d.date && <span><Calendar className="w-3 h-3 inline mr-1" />{String(d.date)}</span>}
          <span><Clock className="w-3 h-3 inline mr-1" />{new Date(item.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Pilot cards
  // -----------------------------------------------------------------------
  const renderPilotCard = (item: LensItem) => {
    const d = item.data as unknown as PilotData;
    const medStatus = currencyStatus(d.medicalExpiry);
    const bfrStatus = currencyStatus(d.bfrDate);
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-blue-400" />
            <span className={statusBadge(medStatus)}>{d.medicalClass || 'No Medical'}</span>
          </div>
          <Award className="w-4 h-4 text-amber-400" />
        </div>
        <h3 className="font-semibold text-white mb-1 truncate">{d.name || item.title}</h3>
        <div className="text-xs text-gray-400 mb-2">{d.certificate || '--'} | #{d.certificateNumber || '--'}</div>
        {d.ratings && d.ratings.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {d.ratings.map(r => <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{r}</span>)}
          </div>
        )}
        {d.typeRatings && d.typeRatings.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {d.typeRatings.map(r => <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">{r}</span>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-xs mt-2">
          <span className="text-gray-500">Total:</span><span className="text-white">{d.totalHours || 0}h</span>
          <span className="text-gray-500">PIC:</span><span className="text-white">{d.picHours || 0}h</span>
          <span className="text-gray-500">Night:</span><span className="text-white">{d.nightHours || 0}h</span>
          <span className="text-gray-500">IFR:</span><span className="text-white">{d.instrumentHours || 0}h</span>
          <span className="text-gray-500">XC:</span><span className="text-white">{d.crossCountryHours || 0}h</span>
          <span className="text-gray-500">Multi:</span><span className="text-white">{d.multiEngineHours || 0}h</span>
        </div>
        <div className="flex gap-2 mt-3 pt-2 border-t border-lattice-border">
          <span className={statusBadge(medStatus)}>Med {d.medicalExpiry || 'N/A'}</span>
          <span className={statusBadge(bfrStatus)}>BFR {d.bfrDate || 'N/A'}</span>
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Aircraft cards
  // -----------------------------------------------------------------------
  const renderAircraftCard = (item: LensItem) => {
    const d = item.data as unknown as AircraftData;
    const annualDays = daysUntil(d.nextAnnual);
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <Navigation className="w-5 h-5 text-cyan-400" />
          <span className={statusBadge(item.meta?.status || 'airworthy')}>{item.meta?.status}</span>
        </div>
        <h3 className="font-bold text-white mb-0.5 font-mono">{d.tailNumber || item.title}</h3>
        <div className={ds.textMuted}>{d.make} {d.model} {d.year ? `(${d.year})` : ''}</div>
        <div className="grid grid-cols-2 gap-1 text-xs mt-3">
          <span className="text-gray-500">Total Time:</span><span className="text-white">{d.totalTime?.toFixed(1) || 0}h</span>
          <span className="text-gray-500">TSMOH:</span><span className="text-white">{d.tsmoh?.toFixed(1) || 0}h</span>
          <span className="text-gray-500">TSPOH:</span><span className="text-white">{d.tspoh?.toFixed(1) || 0}h</span>
          <span className="text-gray-500">Engine:</span><span className="text-white">{d.engType || '--'} {d.engHP ? `${d.engHP}hp` : ''}</span>
          <span className="text-gray-500">Fuel Cap:</span><span className="text-white">{d.fuelCapacity || '--'} gal</span>
          <span className="text-gray-500">Useful Load:</span><span className="text-white">{d.usefulLoad || '--'} lbs</span>
        </div>
        <div className="mt-3 pt-2 border-t border-lattice-border space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Next Annual:</span>
            <span className={cn(annualDays < 30 ? 'text-red-400 font-bold' : annualDays < 60 ? 'text-yellow-400' : 'text-white')}>
              {d.nextAnnual || 'N/A'} {annualDays < 90 && annualDays > -999 ? `(${annualDays}d)` : ''}
            </span>
          </div>
          {d.next100hr !== undefined && d.next100hr > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Next 100hr:</span>
              <span className={cn(d.next100hr < 10 ? 'text-red-400 font-bold' : d.next100hr < 25 ? 'text-yellow-400' : 'text-white')}>
                {d.next100hr.toFixed(1)}h remaining
              </span>
            </div>
          )}
        </div>
        {d.squawks && d.squawks.length > 0 && (
          <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {d.squawks.length} squawk{d.squawks.length > 1 ? 's' : ''}
          </div>
        )}
        {d.adCompliance && d.adCompliance.length > 0 && (
          <div className="mt-1 text-xs text-red-400 flex items-center gap-1">
            <FileText className="w-3 h-3" /> {d.adCompliance.length} AD{d.adCompliance.length > 1 ? 's' : ''} tracked
          </div>
        )}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Maintenance cards
  // -----------------------------------------------------------------------
  const renderMaintenanceCard = (item: LensItem) => {
    const d = item.data as unknown as MaintenanceData;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <Wrench className="w-5 h-5 text-orange-400" />
          <div className="flex gap-1">
            <span className={statusBadge(d.priority || 'routine')}>{d.priority || 'routine'}</span>
            <span className={statusBadge(d.category || 'unscheduled')}>{d.category || 'unscheduled'}</span>
          </div>
        </div>
        <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
        {d.workOrderNumber && <div className="text-xs font-mono text-gray-400 mb-1">WO# {d.workOrderNumber}</div>}
        <div className="text-sm text-gray-300 mb-2 line-clamp-2">{d.discrepancy}</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          {d.tailNumber && <><span className="text-gray-500">Aircraft:</span><span className="text-white font-mono">{d.tailNumber}</span></>}
          {d.melReference && <><span className="text-gray-500">MEL Ref:</span><span className="text-yellow-400">{d.melReference}</span></>}
          {d.laborHours && <><span className="text-gray-500">Labor:</span><span className="text-white">{d.laborHours}h</span></>}
          {d.mechanic && <><span className="text-gray-500">Mechanic:</span><span className="text-white">{d.mechanic}</span></>}
          {d.adReference && <><span className="text-gray-500">AD:</span><span className="text-red-400">{d.adReference}</span></>}
          {d.sbReference && <><span className="text-gray-500">SB:</span><span className="text-yellow-400">{d.sbReference}</span></>}
        </div>
        {d.componentName && (
          <div className="mt-2 pt-2 border-t border-lattice-border text-xs">
            <span className="text-gray-500">Component:</span> <span className="text-white">{d.componentName}</span>
            {d.componentLifeLimit > 0 && (
              <span className={cn('ml-2', d.componentTSN / d.componentLifeLimit > 0.9 ? 'text-red-400' : 'text-gray-400')}>
                ({d.componentTSN || 0}/{d.componentLifeLimit}h)
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500 mt-3 pt-2 border-t border-lattice-border">
          {d.dateOpened && <span>Opened: {d.dateOpened}</span>}
          {d.dateClosed ? <span className="text-green-400">Closed: {d.dateClosed}</span> : <span className="text-yellow-400">Open</span>}
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Charter cards
  // -----------------------------------------------------------------------
  const renderCharterCard = (item: LensItem) => {
    const d = item.data as unknown as CharterData;
    return (
      <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <span className={statusBadge(item.meta?.status || 'inquiry')}>{item.meta?.status}</span>
        </div>
        <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
        {d.confirmationNumber && <div className="text-xs font-mono text-emerald-400 mb-1">Conf# {d.confirmationNumber}</div>}
        {(d.departure || d.arrival) && (
          <div className="flex items-center gap-2 text-sm mb-2">
            <MapPin className="w-3 h-3 text-green-400" />
            <span className="text-white font-mono text-xs">{d.departure || '????'}</span>
            <Navigation className="w-3 h-3 text-gray-500" />
            <span className="text-white font-mono text-xs">{d.arrival || '????'}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-xs mt-2">
          {d.clientName && <><span className="text-gray-500">Client:</span><span className="text-white">{d.clientName}</span></>}
          {d.aircraft && <><span className="text-gray-500">Aircraft:</span><span className="text-white">{d.aircraft}</span></>}
          {d.passengerCount && <><span className="text-gray-500">PAX:</span><span className="text-white">{d.passengerCount}</span></>}
          {d.distanceNM && <><span className="text-gray-500">Distance:</span><span className="text-white">{d.distanceNM} NM</span></>}
        </div>
        {d.totalPrice && (
          <div className="mt-3 pt-2 border-t border-lattice-border">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">Total Price:</span>
              <span className="text-emerald-400 font-bold">${d.totalPrice.toLocaleString()}</span>
            </div>
            {d.depositPaid > 0 && (
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Deposit:</span>
                <span className="text-green-400">${d.depositPaid.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
        {d.catering && <div className="text-xs text-purple-400 mt-1"><Package className="w-3 h-3 inline mr-1" />{d.catering}</div>}
        {d.date && <div className="text-xs text-gray-500 mt-2"><Calendar className="w-3 h-3 inline mr-1" />{d.date}{d.returnDate ? ` - ${d.returnDate}` : ''}</div>}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Weight & Balance cards
  // -----------------------------------------------------------------------
  const renderWBCard = (item: LensItem) => {
    const d = item.data as unknown as WBData;
    const withinLimits = d.withinLimits !== false && d.totalWeight <= (d.maxGross || 99999) && d.cg >= (d.fwdCGLimit || 0) && d.cg <= (d.aftCGLimit || 999);
    return (
      <div key={item.id} className={cn(ds.panelHover, withinLimits ? '' : 'border-red-500/50')} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <Weight className="w-5 h-5 text-violet-400" />
          {withinLimits ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> Within Limits</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3 h-3" /> OUT OF LIMITS</span>
          )}
        </div>
        <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
        <div className="text-xs text-gray-400 mb-2 font-mono">{d.tailNumber || '--'}</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-gray-500">Empty Wt:</span><span className="text-white">{d.emptyWeight || 0} lbs</span>
          <span className="text-gray-500">Fuel:</span><span className="text-white">{d.fuelWeight || 0} lbs</span>
          <span className="text-gray-500">Payload:</span><span className="text-white">{((d.pilotWeight || 0) + (d.copilotWeight || 0) + (d.paxRow1Weight || 0) + (d.paxRow2Weight || 0) + (d.cargoWeight || 0) + (d.baggageWeight || 0))} lbs</span>
          <span className="text-gray-500">Total:</span><span className={cn('font-bold', d.totalWeight > (d.maxGross || 99999) ? 'text-red-400' : 'text-white')}>{d.totalWeight || 0} lbs</span>
          <span className="text-gray-500">Max Gross:</span><span className="text-white">{d.maxGross || '--'} lbs</span>
          <span className="text-gray-500">CG:</span><span className={cn('font-bold', (d.cg < (d.fwdCGLimit || 0) || d.cg > (d.aftCGLimit || 999)) ? 'text-red-400' : 'text-white')}>{d.cg?.toFixed(2) || '--'} in</span>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          CG Limits: {d.fwdCGLimit || '--'} - {d.aftCGLimit || '--'} in
        </div>
        {/* CG visual bar */}
        {d.fwdCGLimit && d.aftCGLimit && d.cg && (
          <div className="mt-2 h-3 bg-lattice-border rounded-full relative overflow-hidden">
            <div className="absolute inset-y-0 bg-green-500/30 rounded-full" style={{
              left: '10%', right: '10%'
            }} />
            <div className={cn('absolute top-0 w-1.5 h-3 rounded-full', withinLimits ? 'bg-green-400' : 'bg-red-400')} style={{
              left: `${Math.max(5, Math.min(95, ((d.cg - d.fwdCGLimit) / (d.aftCGLimit - d.fwdCGLimit)) * 80 + 10))}%`
            }} />
          </div>
        )}
        {d.date && <div className="text-xs text-gray-500 mt-2"><Calendar className="w-3 h-3 inline mr-1" />{d.date}</div>}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Weather cards
  // -----------------------------------------------------------------------
  const renderWeatherCard = (item: LensItem) => {
    const d = item.data as unknown as WeatherData;
    const cat = d.flightCategory || 'VFR';
    const catColor = cat === 'VFR' ? 'text-green-400' : cat === 'MVFR' ? 'text-blue-400' : cat === 'IFR' ? 'text-red-400' : 'text-purple-400';
    const catBg = cat === 'VFR' ? 'border-l-green-500' : cat === 'MVFR' ? 'border-l-blue-500' : cat === 'IFR' ? 'border-l-red-500' : 'border-l-purple-500';
    return (
      <div key={item.id} className={cn(ds.panelHover, 'border-l-4', catBg)} onClick={() => openEdit(item)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <CloudRain className="w-5 h-5 text-cyan-400" />
            <span className="font-mono text-white font-bold text-sm">{d.stationId || item.title}</span>
          </div>
          <span className={cn('text-sm font-bold', catColor)}>{cat}</span>
        </div>
        {d.rawMetar && (
          <div className="bg-lattice-elevated rounded p-2 mb-2">
            <p className="font-mono text-xs text-cyan-300 break-all">{d.rawMetar}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-gray-500 flex items-center gap-1"><Wind className="w-3 h-3" />Wind:</span>
          <span className="text-white">{d.windDirection || '--'}° @ {d.windSpeed || '--'}kt{d.windGust ? ` G${d.windGust}` : ''}</span>
          <span className="text-gray-500 flex items-center gap-1"><Eye className="w-3 h-3" />Vis:</span>
          <span className="text-white">{d.visibility || '--'} SM</span>
          <span className="text-gray-500 flex items-center gap-1"><CloudRain className="w-3 h-3" />Ceiling:</span>
          <span className={cn('text-white', (d.ceiling || 99999) < 1000 ? 'text-red-400 font-bold' : '')}>{d.ceiling ? `${d.ceiling} ft` : 'CLR'}</span>
          <span className="text-gray-500 flex items-center gap-1"><Thermometer className="w-3 h-3" />Temp:</span>
          <span className="text-white">{d.temperature !== undefined ? `${d.temperature}°C` : '--'} / {d.dewpoint !== undefined ? `${d.dewpoint}°C` : '--'}</span>
          <span className="text-gray-500">Altimeter:</span>
          <span className="text-white">{d.altimeter ? `${d.altimeter}" Hg` : '--'}</span>
        </div>
        {d.cloudLayers && (
          <div className="text-xs text-gray-400 mt-2">
            <span className="text-gray-500">Clouds:</span> {d.cloudLayers}
          </div>
        )}
        {d.wxConditions && (
          <div className="text-xs mt-1 flex items-center gap-1">
            <Droplets className="w-3 h-3 text-blue-400" />
            <span className="text-blue-400">{d.wxConditions}</span>
          </div>
        )}
        {d.sigmets && (
          <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> SIGMET: {d.sigmets}
          </div>
        )}
        {d.airmets && (
          <div className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> AIRMET: {d.airmets}
          </div>
        )}
        <div className="flex items-center text-xs text-gray-500 mt-2 pt-2 border-t border-lattice-border">
          <Clock className="w-3 h-3 mr-1" />{d.observationTime || new Date(item.updatedAt).toLocaleString()}
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Editor modals per type
  // -----------------------------------------------------------------------
  const renderFlightEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Flight Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Flight identifier..." /></div>
        <div><label className={ds.label}>Status</label>
          <select className={ds.select} value={(form._status as string) || 'planned'} onChange={e => setField('_status', e.target.value)}>
            {FLIGHT_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Aircraft Type</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172, PA28..." /></div>
        <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>PIC</label><input className={ds.input} value={(form.pic as string) || ''} onChange={e => setField('pic', e.target.value)} placeholder="Pilot in Command" /></div>
        <div><label className={ds.label}>SIC</label><input className={ds.input} value={(form.sic as string) || ''} onChange={e => setField('sic', e.target.value)} placeholder="Second in Command" /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Departure (ICAO)</label><input className={ds.input} value={(form.departure as string) || ''} onChange={e => setField('departure', e.target.value)} placeholder="KJFK" /></div>
        <div><label className={ds.label}>Arrival (ICAO)</label><input className={ds.input} value={(form.arrival as string) || ''} onChange={e => setField('arrival', e.target.value)} placeholder="KLAX" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
        <div><label className={ds.label}>ETD (Z)</label><input type="time" className={ds.input} value={(form.etd as string) || ''} onChange={e => setField('etd', e.target.value)} /></div>
        <div><label className={ds.label}>ETA (Z)</label><input type="time" className={ds.input} value={(form.eta as string) || ''} onChange={e => setField('eta', e.target.value)} /></div>
      </div>
      <div className={ds.grid4}>
        <div><label className={ds.label}>Hobbs Start</label><input type="number" step="0.1" className={ds.input} value={(form.hobbsStart as number) || ''} onChange={e => setField('hobbsStart', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Hobbs End</label><input type="number" step="0.1" className={ds.input} value={(form.hobbsEnd as number) || ''} onChange={e => setField('hobbsEnd', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Tach Start</label><input type="number" step="0.1" className={ds.input} value={(form.tachStart as number) || ''} onChange={e => setField('tachStart', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Tach End</label><input type="number" step="0.1" className={ds.input} value={(form.tachEnd as number) || ''} onChange={e => setField('tachEnd', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Fuel Burn (gal)</label><input type="number" step="0.1" className={ds.input} value={(form.fuelBurn as number) || ''} onChange={e => setField('fuelBurn', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Fuel Onboard (gal)</label><input type="number" step="0.1" className={ds.input} value={(form.fuelOnboard as number) || ''} onChange={e => setField('fuelOnboard', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Passengers</label><input type="number" className={ds.input} value={(form.passengers as number) || ''} onChange={e => setField('passengers', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div><label className={ds.label}>Passenger Names</label><input className={ds.input} value={(form.passengerNames as string) || ''} onChange={e => setField('passengerNames', e.target.value)} placeholder="Comma separated..." /></div>
      <div><label className={ds.label}>Route</label><input className={ds.input} value={(form.route as string) || ''} onChange={e => setField('route', e.target.value)} placeholder="V16 ALB V3 JFK..." /></div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Altitude</label><input className={ds.input} value={(form.altitude as string) || ''} onChange={e => setField('altitude', e.target.value)} placeholder="FL350, 8500..." /></div>
        <div><label className={ds.label}>Ceiling Min (ft)</label><input type="number" className={ds.input} value={(form.ceilingReq as number) || ''} onChange={e => setField('ceilingReq', parseInt(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Vis Min (SM)</label><input type="number" step="0.5" className={ds.input} value={(form.visibilityReq as number) || ''} onChange={e => setField('visibilityReq', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div><label className={ds.label}>Weather Minimums Notes</label><input className={ds.input} value={(form.weatherMins as string) || ''} onChange={e => setField('weatherMins', e.target.value)} placeholder="IFR alternate required, 1-2-3 rule..." /></div>
      <div><label className={ds.label}>Squawks</label><textarea className={cn(ds.textarea, 'h-16')} value={(form.squawks as string) || ''} onChange={e => setField('squawks', e.target.value)} placeholder="Post-flight squawks..." /></div>
      <div><label className={ds.label}>Remarks</label><textarea className={cn(ds.textarea, 'h-20')} value={(form.remarks as string) || ''} onChange={e => setField('remarks', e.target.value)} placeholder="Flight remarks..." /></div>
    </div>
  );

  const renderPilotEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Pilot Name</label><input className={ds.input} value={(form.name as string) || ''} onChange={e => { setField('name', e.target.value); setField('_title', e.target.value); }} placeholder="Full name" /></div>
        <div><label className={ds.label}>Employee ID</label><input className={ds.input} value={(form.employeeId as string) || ''} onChange={e => setField('employeeId', e.target.value)} placeholder="EMP-001" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Certificate</label>
          <select className={ds.select} value={(form.certificate as string) || ''} onChange={e => setField('certificate', e.target.value)}>
            <option value="">Select...</option>{PILOT_CERTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className={ds.label}>Certificate Number</label><input className={ds.input} value={(form.certificateNumber as string) || ''} onChange={e => setField('certificateNumber', e.target.value)} /></div>
        <div><label className={ds.label}>Base Airport</label><input className={ds.input} value={(form.baseAirport as string) || ''} onChange={e => setField('baseAirport', e.target.value)} placeholder="KJFK" /></div>
      </div>
      <div>
        <label className={ds.label}>Ratings</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {PILOT_RATINGS.map(r => {
            const ratings = (form.ratings as string[]) || [];
            const selected = ratings.includes(r);
            return (
              <button key={r} onClick={() => setField('ratings', selected ? ratings.filter(x => x !== r) : [...ratings, r])}
                className={cn('px-2 py-1 rounded text-xs border transition-colors', selected ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-lattice-border text-gray-500 hover:text-white')}>
                {r}
              </button>
            );
          })}
        </div>
      </div>
      <div><label className={ds.label}>Type Ratings (comma-separated)</label><input className={ds.input} value={((form.typeRatings as string[]) || []).join(', ')} onChange={e => setField('typeRatings', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="B737, CE-525..." /></div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Medical Class</label>
          <select className={ds.select} value={(form.medicalClass as string) || ''} onChange={e => setField('medicalClass', e.target.value)}>
            <option value="">Select...</option><option value="1st Class">1st Class</option><option value="2nd Class">2nd Class</option><option value="3rd Class">3rd Class</option><option value="BasicMed">BasicMed</option>
          </select>
        </div>
        <div><label className={ds.label}>Medical Expiry</label><input type="date" className={ds.input} value={(form.medicalExpiry as string) || ''} onChange={e => setField('medicalExpiry', e.target.value)} /></div>
        <div><label className={ds.label}>Flight Regulation</label>
          <select className={ds.select} value={(form.flightRegulation as string) || ''} onChange={e => setField('flightRegulation', e.target.value)}>
            <option value="">Select...</option>{FLIGHT_REGS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>BFR Date</label><input type="date" className={ds.input} value={(form.bfrDate as string) || ''} onChange={e => setField('bfrDate', e.target.value)} /></div>
        <div><label className={ds.label}>IPC Date</label><input type="date" className={ds.input} value={(form.ipcDate as string) || ''} onChange={e => setField('ipcDate', e.target.value)} /></div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Flight Hours</h4>
        <div className={ds.grid3}>
          <div><label className={ds.label}>Total</label><input type="number" className={ds.input} value={(form.totalHours as number) || ''} onChange={e => setField('totalHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>PIC</label><input type="number" className={ds.input} value={(form.picHours as number) || ''} onChange={e => setField('picHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>SIC</label><input type="number" className={ds.input} value={(form.sicHours as number) || ''} onChange={e => setField('sicHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Night</label><input type="number" className={ds.input} value={(form.nightHours as number) || ''} onChange={e => setField('nightHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Instrument</label><input type="number" className={ds.input} value={(form.instrumentHours as number) || ''} onChange={e => setField('instrumentHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Cross-Country</label><input type="number" className={ds.input} value={(form.crossCountryHours as number) || ''} onChange={e => setField('crossCountryHours', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Multi-Engine</label><input type="number" className={ds.input} value={(form.multiEngineHours as number) || ''} onChange={e => setField('multiEngineHours', parseFloat(e.target.value) || 0)} /></div>
        </div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Duty Time Tracking</h4>
        <div className={ds.grid4}>
          <div><label className={ds.label}>Last 30 Days</label><input type="number" className={ds.input} value={(form.last30Days as number) || ''} onChange={e => setField('last30Days', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Last 90 Days</label><input type="number" className={ds.input} value={(form.last90Days as number) || ''} onChange={e => setField('last90Days', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Last 12 Months</label><input type="number" className={ds.input} value={(form.last12Months as number) || ''} onChange={e => setField('last12Months', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Duty On</label><input type="time" className={ds.input} value={(form.dutyOnTime as string) || ''} onChange={e => setField('dutyOnTime', e.target.value)} /></div>
        </div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Phone</label><input className={ds.input} value={(form.phone as string) || ''} onChange={e => setField('phone', e.target.value)} /></div>
        <div><label className={ds.label}>Email</label><input className={ds.input} value={(form.email as string) || ''} onChange={e => setField('email', e.target.value)} /></div>
      </div>
    </div>
  );

  const renderAircraftEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => { setField('tailNumber', e.target.value); setField('_title', e.target.value); }} placeholder="N12345" /></div>
        <div><label className={ds.label}>Status</label>
          <select className={ds.select} value={(form._status as string) || 'airworthy'} onChange={e => setField('_status', e.target.value)}>
            {AIRCRAFT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Make</label><input className={ds.input} value={(form.make as string) || ''} onChange={e => setField('make', e.target.value)} placeholder="Cessna" /></div>
        <div><label className={ds.label}>Model</label><input className={ds.input} value={(form.model as string) || ''} onChange={e => setField('model', e.target.value)} placeholder="172S" /></div>
        <div><label className={ds.label}>Year</label><input type="number" className={ds.input} value={(form.year as number) || ''} onChange={e => setField('year', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Serial Number</label><input className={ds.input} value={(form.serialNumber as string) || ''} onChange={e => setField('serialNumber', e.target.value)} /></div>
        <div><label className={ds.label}>Type</label><input className={ds.input} value={(form.type as string) || ''} onChange={e => setField('type', e.target.value)} placeholder="Single-engine piston" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Total Time</label><input type="number" step="0.1" className={ds.input} value={(form.totalTime as number) || ''} onChange={e => setField('totalTime', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>TSMOH</label><input type="number" step="0.1" className={ds.input} value={(form.tsmoh as number) || ''} onChange={e => setField('tsmoh', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>TSPOH</label><input type="number" step="0.1" className={ds.input} value={(form.tspoh as number) || ''} onChange={e => setField('tspoh', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Engine Type</label><input className={ds.input} value={(form.engType as string) || ''} onChange={e => setField('engType', e.target.value)} placeholder="IO-360" /></div>
        <div><label className={ds.label}>Engine HP</label><input type="number" className={ds.input} value={(form.engHP as number) || ''} onChange={e => setField('engHP', parseInt(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Avionics</label><input className={ds.input} value={(form.avionics as string) || ''} onChange={e => setField('avionics', e.target.value)} placeholder="G1000, GNS530..." /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Next Annual</label><input type="date" className={ds.input} value={(form.nextAnnual as string) || ''} onChange={e => setField('nextAnnual', e.target.value)} /></div>
        <div><label className={ds.label}>Hrs Until 100hr</label><input type="number" step="0.1" className={ds.input} value={(form.next100hr as number) || ''} onChange={e => setField('next100hr', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Weight & Balance (Empty)</h4>
        <div className={ds.grid4}>
          <div><label className={ds.label}>Empty Weight (lbs)</label><input type="number" className={ds.input} value={(form.emptyWeight as number) || ''} onChange={e => setField('emptyWeight', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Empty CG (in)</label><input type="number" step="0.01" className={ds.input} value={(form.emptyCG as number) || ''} onChange={e => setField('emptyCG', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Max Gross (lbs)</label><input type="number" className={ds.input} value={(form.maxGross as number) || ''} onChange={e => setField('maxGross', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Useful Load (lbs)</label><input type="number" className={ds.input} value={(form.usefulLoad as number) || ''} onChange={e => setField('usefulLoad', parseFloat(e.target.value) || 0)} /></div>
        </div>
        <div className={ds.grid2}>
          <div><label className={ds.label}>Fuel Capacity (gal)</label><input type="number" className={ds.input} value={(form.fuelCapacity as number) || ''} onChange={e => setField('fuelCapacity', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Loading Stations</label><input className={ds.input} value={(form.stations as string) || ''} onChange={e => setField('stations', e.target.value)} placeholder="Pilot:37, Rear:73, Baggage:95" /></div>
        </div>
      </div>
      <div><label className={ds.label}>AD Compliance (comma-separated)</label><textarea className={cn(ds.textarea, 'h-16')} value={((form.adCompliance as string[]) || []).join(', ')} onChange={e => setField('adCompliance', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="AD 2020-10-15, AD 2019-25-51..." /></div>
      <div><label className={ds.label}>Open Squawks (comma-separated)</label><textarea className={cn(ds.textarea, 'h-16')} value={((form.squawks as string[]) || []).join(', ')} onChange={e => setField('squawks', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="Loose trim tab, Oil leak..." /></div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Insurance Expiry</label><input type="date" className={ds.input} value={(form.insuranceExpiry as string) || ''} onChange={e => setField('insuranceExpiry', e.target.value)} /></div>
        <div><label className={ds.label}>Registration Expiry</label><input type="date" className={ds.input} value={(form.registrationExpiry as string) || ''} onChange={e => setField('registrationExpiry', e.target.value)} /></div>
      </div>
    </div>
  );

  const renderMaintenanceEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Work Order Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Describe the work..." /></div>
        <div><label className={ds.label}>WO Number</label><input className={ds.input} value={(form.workOrderNumber as string) || ''} onChange={e => setField('workOrderNumber', e.target.value)} placeholder="WO-2026-001" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172S" /></div>
        <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
        <div><label className={ds.label}>Category</label>
          <select className={ds.select} value={(form._status as string) || 'unscheduled'} onChange={e => { setField('_status', e.target.value); setField('category', e.target.value); }}>
            {MX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div><label className={ds.label}>Discrepancy</label><textarea className={cn(ds.textarea, 'h-20')} value={(form.discrepancy as string) || ''} onChange={e => setField('discrepancy', e.target.value)} placeholder="Describe the discrepancy..." /></div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>MEL Reference</label><input className={ds.input} value={(form.melReference as string) || ''} onChange={e => setField('melReference', e.target.value)} placeholder="MEL 32-1" /></div>
        <div><label className={ds.label}>AD Reference</label><input className={ds.input} value={(form.adReference as string) || ''} onChange={e => setField('adReference', e.target.value)} placeholder="AD 2024-10-15" /></div>
        <div><label className={ds.label}>SB Reference</label><input className={ds.input} value={(form.sbReference as string) || ''} onChange={e => setField('sbReference', e.target.value)} placeholder="SB-172-88" /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Priority</label>
          <select className={ds.select} value={(form.priority as string) || 'routine'} onChange={e => setField('priority', e.target.value)}>
            {MX_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div><label className={ds.label}>Labor Hours</label><input type="number" step="0.1" className={ds.input} value={(form.laborHours as number) || ''} onChange={e => setField('laborHours', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div><label className={ds.label}>Parts Used</label><textarea className={cn(ds.textarea, 'h-16')} value={(form.partsUsed as string) || ''} onChange={e => setField('partsUsed', e.target.value)} placeholder="Part number, description, qty..." /></div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Sign-Off</h4>
        <div className={ds.grid2}>
          <div><label className={ds.label}>Mechanic (A&P)</label><input className={ds.input} value={(form.mechanic as string) || ''} onChange={e => setField('mechanic', e.target.value)} /></div>
          <div><label className={ds.label}>A&P Cert #</label><input className={ds.input} value={(form.mechanicCert as string) || ''} onChange={e => setField('mechanicCert', e.target.value)} /></div>
          <div><label className={ds.label}>Inspector (IA)</label><input className={ds.input} value={(form.inspector as string) || ''} onChange={e => setField('inspector', e.target.value)} /></div>
          <div><label className={ds.label}>IA Cert #</label><input className={ds.input} value={(form.inspectorCert as string) || ''} onChange={e => setField('inspectorCert', e.target.value)} /></div>
        </div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Component Tracking</h4>
        <div className={ds.grid3}>
          <div><label className={ds.label}>Component Name</label><input className={ds.input} value={(form.componentName as string) || ''} onChange={e => setField('componentName', e.target.value)} /></div>
          <div><label className={ds.label}>TSN (hours)</label><input type="number" step="0.1" className={ds.input} value={(form.componentTSN as number) || ''} onChange={e => setField('componentTSN', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Life Limit (hours)</label><input type="number" step="0.1" className={ds.input} value={(form.componentLifeLimit as number) || ''} onChange={e => setField('componentLifeLimit', parseFloat(e.target.value) || 0)} /></div>
        </div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Date Opened</label><input type="date" className={ds.input} value={(form.dateOpened as string) || ''} onChange={e => setField('dateOpened', e.target.value)} /></div>
        <div><label className={ds.label}>Date Closed</label><input type="date" className={ds.input} value={(form.dateClosed as string) || ''} onChange={e => setField('dateClosed', e.target.value)} /></div>
      </div>
    </div>
  );

  const renderCharterEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Charter Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Charter description..." /></div>
        <div><label className={ds.label}>Status</label>
          <select className={ds.select} value={(form._status as string) || 'inquiry'} onChange={e => setField('_status', e.target.value)}>
            {CHARTER_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Client Name</label><input className={ds.input} value={(form.clientName as string) || ''} onChange={e => setField('clientName', e.target.value)} /></div>
        <div><label className={ds.label}>Client Phone</label><input className={ds.input} value={(form.clientPhone as string) || ''} onChange={e => setField('clientPhone', e.target.value)} /></div>
        <div><label className={ds.label}>Client Email</label><input className={ds.input} value={(form.clientEmail as string) || ''} onChange={e => setField('clientEmail', e.target.value)} /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Departure (ICAO)</label><input className={ds.input} value={(form.departure as string) || ''} onChange={e => setField('departure', e.target.value)} placeholder="KJFK" /></div>
        <div><label className={ds.label}>Arrival (ICAO)</label><input className={ds.input} value={(form.arrival as string) || ''} onChange={e => setField('arrival', e.target.value)} placeholder="KMIA" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
        <div><label className={ds.label}>Return Date</label><input type="date" className={ds.input} value={(form.returnDate as string) || ''} onChange={e => setField('returnDate', e.target.value)} /></div>
        <div><label className={ds.label}>Confirmation #</label><input className={ds.input} value={(form.confirmationNumber as string) || ''} onChange={e => setField('confirmationNumber', e.target.value)} placeholder="CHR-2026-001" /></div>
      </div>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="Citation CJ3" /></div>
        <div><label className={ds.label}>Passenger Count</label><input type="number" className={ds.input} value={(form.passengerCount as number) || ''} onChange={e => setField('passengerCount', parseInt(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Distance (NM)</label><input type="number" className={ds.input} value={(form.distanceNM as number) || ''} onChange={e => setField('distanceNM', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div><label className={ds.label}>Passenger Names</label><input className={ds.input} value={(form.passengerNames as string) || ''} onChange={e => setField('passengerNames', e.target.value)} placeholder="Comma-separated names..." /></div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Pricing Calculator</h4>
        <div className={ds.grid4}>
          <div><label className={ds.label}>Rate/NM ($)</label><input type="number" step="0.01" className={ds.input} value={(form.ratePerNM as number) || ''} onChange={e => setField('ratePerNM', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Base Fee ($)</label><input type="number" step="0.01" className={ds.input} value={(form.baseFee as number) || ''} onChange={e => setField('baseFee', parseFloat(e.target.value) || 0)} /></div>
          <div><label className={ds.label}>Fuel Surcharge ($)</label><input type="number" step="0.01" className={ds.input} value={(form.fuelSurcharge as number) || ''} onChange={e => setField('fuelSurcharge', parseFloat(e.target.value) || 0)} /></div>
          <div>
            <label className={ds.label}>Calculated</label>
            <div className={cn(ds.input, 'bg-lattice-border text-emerald-400 font-bold')}>
              ${(((form.ratePerNM as number) || 0) * ((form.distanceNM as number) || 0) + ((form.baseFee as number) || 0) + ((form.fuelSurcharge as number) || 0)).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Catering</label><input className={ds.input} value={(form.catering as string) || ''} onChange={e => setField('catering', e.target.value)} placeholder="Light snacks, full meal..." /></div>
        <div><label className={ds.label}>Catering Cost ($)</label><input type="number" step="0.01" className={ds.input} value={(form.cateringCost as number) || ''} onChange={e => setField('cateringCost', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Ground Transport</label><input className={ds.input} value={(form.groundTransport as string) || ''} onChange={e => setField('groundTransport', e.target.value)} placeholder="Limo, SUV..." /></div>
        <div><label className={ds.label}>Transport Cost ($)</label><input type="number" step="0.01" className={ds.input} value={(form.groundTransportCost as number) || ''} onChange={e => setField('groundTransportCost', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid3}>
        <div>
          <label className={ds.label}>Total Price ($)</label>
          <input type="number" step="0.01" className={ds.input} value={(form.totalPrice as number) || ''} onChange={e => setField('totalPrice', parseFloat(e.target.value) || 0)} />
        </div>
        <div><label className={ds.label}>Deposit Paid ($)</label><input type="number" step="0.01" className={ds.input} value={(form.depositPaid as number) || ''} onChange={e => setField('depositPaid', parseFloat(e.target.value) || 0)} /></div>
        <div>
          <label className={ds.label}>Balance Due</label>
          <div className={cn(ds.input, 'bg-lattice-border text-yellow-400 font-bold')}>
            ${(((form.totalPrice as number) || 0) - ((form.depositPaid as number) || 0)).toLocaleString()}
          </div>
        </div>
      </div>
      <div><label className={ds.label}>Special Requests</label><textarea className={cn(ds.textarea, 'h-16')} value={(form.specialRequests as string) || ''} onChange={e => setField('specialRequests', e.target.value)} /></div>
    </div>
  );

  const renderWBEditor = () => {
    // Live CG calculation
    const ew = (form.emptyWeight as number) || 0;
    const ea = (form.emptyArm as number) || 0;
    const fw = (form.fuelWeight as number) || 0;
    const fa = (form.fuelArm as number) || 0;
    const pw = (form.pilotWeight as number) || 0;
    const pa = (form.pilotArm as number) || 0;
    const cpw = (form.copilotWeight as number) || 0;
    const cpa = (form.copilotArm as number) || 0;
    const r1w = (form.paxRow1Weight as number) || 0;
    const r1a = (form.paxRow1Arm as number) || 0;
    const r2w = (form.paxRow2Weight as number) || 0;
    const r2a = (form.paxRow2Arm as number) || 0;
    const cw = (form.cargoWeight as number) || 0;
    const ca = (form.cargoArm as number) || 0;
    const bw = (form.baggageWeight as number) || 0;
    const ba = (form.baggageArm as number) || 0;

    const totalW = ew + fw + pw + cpw + r1w + r2w + cw + bw;
    const totalM = ew * ea + fw * fa + pw * pa + cpw * cpa + r1w * r1a + r2w * r2a + cw * ca + bw * ba;
    const cgCalc = totalW > 0 ? totalM / totalW : 0;
    const mg = (form.maxGross as number) || 99999;
    const fwdL = (form.fwdCGLimit as number) || 0;
    const aftL = (form.aftCGLimit as number) || 999;
    const inLimits = totalW <= mg && cgCalc >= fwdL && cgCalc <= aftL;

    return (
      <div className="space-y-4">
        <div className={ds.grid2}>
          <div><label className={ds.label}>W&B Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="W&B calculation name..." /></div>
          <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
        </div>
        <div className={ds.grid2}>
          <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172S" /></div>
          <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
        </div>

        <div className="border-t border-lattice-border pt-4">
          <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Loading Stations</h4>
          <div className="space-y-2">
            {/* Table header */}
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 font-medium px-1">
              <span>Station</span><span>Weight (lbs)</span><span>Arm (in)</span>
            </div>
            {/* Empty weight */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Empty Weight</span>
              <input type="number" className={ds.input} value={ew || ''} onChange={e => setField('emptyWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={ea || ''} onChange={e => setField('emptyArm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Fuel */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Fuel</span>
              <input type="number" className={ds.input} value={fw || ''} onChange={e => setField('fuelWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={fa || ''} onChange={e => setField('fuelArm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Pilot */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Pilot</span>
              <input type="number" className={ds.input} value={pw || ''} onChange={e => setField('pilotWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={pa || ''} onChange={e => setField('pilotArm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Copilot */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Copilot / Front PAX</span>
              <input type="number" className={ds.input} value={cpw || ''} onChange={e => setField('copilotWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={cpa || ''} onChange={e => setField('copilotArm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Row 1 */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>PAX Row 1</span>
              <input type="number" className={ds.input} value={r1w || ''} onChange={e => setField('paxRow1Weight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={r1a || ''} onChange={e => setField('paxRow1Arm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Row 2 */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>PAX Row 2</span>
              <input type="number" className={ds.input} value={r2w || ''} onChange={e => setField('paxRow2Weight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={r2a || ''} onChange={e => setField('paxRow2Arm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Cargo */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Cargo</span>
              <input type="number" className={ds.input} value={cw || ''} onChange={e => setField('cargoWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={ca || ''} onChange={e => setField('cargoArm', parseFloat(e.target.value) || 0)} />
            </div>
            {/* Baggage */}
            <div className="grid grid-cols-3 gap-2 items-center">
              <span className={cn(ds.label, 'mb-0')}>Baggage</span>
              <input type="number" className={ds.input} value={bw || ''} onChange={e => setField('baggageWeight', parseFloat(e.target.value) || 0)} />
              <input type="number" step="0.01" className={ds.input} value={ba || ''} onChange={e => setField('baggageArm', parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        </div>

        <div className="border-t border-lattice-border pt-4">
          <h4 className={cn(ds.heading3, 'text-sm mb-3')}>CG Envelope Limits</h4>
          <div className={ds.grid3}>
            <div><label className={ds.label}>Max Gross (lbs)</label><input type="number" className={ds.input} value={mg < 99999 ? mg : ''} onChange={e => setField('maxGross', parseFloat(e.target.value) || 0)} /></div>
            <div><label className={ds.label}>Fwd CG Limit (in)</label><input type="number" step="0.01" className={ds.input} value={fwdL || ''} onChange={e => setField('fwdCGLimit', parseFloat(e.target.value) || 0)} /></div>
            <div><label className={ds.label}>Aft CG Limit (in)</label><input type="number" step="0.01" className={ds.input} value={aftL < 999 ? aftL : ''} onChange={e => setField('aftCGLimit', parseFloat(e.target.value) || 0)} /></div>
          </div>
        </div>

        {/* Live Results */}
        <div className={cn(ds.panel, 'border-2', inLimits ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-3">
            {inLimits ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
            <h4 className={cn(ds.heading3, 'text-sm')}>{inLimits ? 'WITHIN LIMITS' : 'OUT OF LIMITS - DO NOT FLY'}</h4>
          </div>
          <div className={ds.grid4}>
            <div>
              <div className="text-xs text-gray-500">Total Weight</div>
              <div className={cn('text-lg font-bold', totalW > mg ? 'text-red-400' : 'text-white')}>{totalW.toFixed(1)} lbs</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Total Moment</div>
              <div className="text-lg font-bold text-white">{totalM.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">CG Location</div>
              <div className={cn('text-lg font-bold', (cgCalc < fwdL || cgCalc > aftL) ? 'text-red-400' : 'text-white')}>{cgCalc.toFixed(2)} in</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Max Gross</div>
              <div className="text-lg font-bold text-white">{mg < 99999 ? `${mg} lbs` : 'N/A'}</div>
            </div>
          </div>
          {/* CG bar indicator */}
          {fwdL > 0 && aftL < 999 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Fwd: {fwdL}"</span><span>Aft: {aftL}"</span>
              </div>
              <div className="h-4 bg-lattice-border rounded-full relative overflow-hidden">
                <div className="absolute inset-y-0 bg-green-500/30 rounded-full" style={{ left: '5%', right: '5%' }} />
                <div className={cn('absolute top-0 w-2 h-4 rounded-full', inLimits ? 'bg-green-400' : 'bg-red-400')} style={{
                  left: `${Math.max(2, Math.min(98, ((cgCalc - fwdL) / (aftL - fwdL)) * 90 + 5))}%`
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Auto-populate form computed values on change */}
        <input type="hidden" value="" onChange={() => {
          setField('totalWeight', totalW);
          setField('totalMoment', totalM);
          setField('cg', cgCalc);
          setField('withinLimits', inLimits);
        }} />
      </div>
    );
  };

  const renderWeatherEditor = () => (
    <div className="space-y-4">
      <div className={ds.grid2}>
        <div><label className={ds.label}>Station / Airport (ICAO)</label><input className={ds.input} value={(form.stationId as string) || ''} onChange={e => { setField('stationId', e.target.value.toUpperCase()); setField('_title', e.target.value.toUpperCase()); }} placeholder="KJFK" /></div>
        <div><label className={ds.label}>Flight Category</label>
          <select className={ds.select} value={(form._status as string) || 'VFR'} onChange={e => { setField('_status', e.target.value); setField('flightCategory', e.target.value); }}>
            {FLIGHT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={ds.label}>Raw METAR</label>
        <textarea className={cn(ds.textarea, 'font-mono text-xs h-16')} value={(form.rawMetar as string) || ''} onChange={e => setField('rawMetar', e.target.value)} placeholder="KJFK 221456Z 27015G25KT 10SM FEW250 08/M04 A3012 RMK AO2..." />
      </div>
      <div><label className={ds.label}>Observation Time (UTC)</label><input type="datetime-local" className={ds.input} value={(form.observationTime as string) || ''} onChange={e => setField('observationTime', e.target.value)} /></div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Wind</h4>
        <div className={ds.grid3}>
          <div><label className={ds.label}>Direction (°)</label><input type="number" className={ds.input} value={(form.windDirection as number) || ''} onChange={e => setField('windDirection', parseInt(e.target.value) || 0)} placeholder="270" /></div>
          <div><label className={ds.label}>Speed (kt)</label><input type="number" className={ds.input} value={(form.windSpeed as number) || ''} onChange={e => setField('windSpeed', parseInt(e.target.value) || 0)} placeholder="15" /></div>
          <div><label className={ds.label}>Gust (kt)</label><input type="number" className={ds.input} value={(form.windGust as number) || ''} onChange={e => setField('windGust', parseInt(e.target.value) || 0)} placeholder="25" /></div>
        </div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Conditions</h4>
        <div className={ds.grid3}>
          <div><label className={ds.label}>Visibility (SM)</label><input type="number" step="0.25" className={ds.input} value={(form.visibility as number) || ''} onChange={e => setField('visibility', parseFloat(e.target.value) || 0)} placeholder="10" /></div>
          <div><label className={ds.label}>Ceiling (ft AGL)</label><input type="number" className={ds.input} value={(form.ceiling as number) || ''} onChange={e => setField('ceiling', parseInt(e.target.value) || 0)} placeholder="25000" /></div>
          <div><label className={ds.label}>Weather Conditions</label><input className={ds.input} value={(form.wxConditions as string) || ''} onChange={e => setField('wxConditions', e.target.value)} placeholder="RA, SN, BR, FG..." /></div>
        </div>
        <div className={ds.grid2}>
          <div><label className={ds.label}>Temperature (°C)</label><input type="number" className={ds.input} value={(form.temperature as number) ?? ''} onChange={e => setField('temperature', parseInt(e.target.value))} placeholder="8" /></div>
          <div><label className={ds.label}>Dewpoint (°C)</label><input type="number" className={ds.input} value={(form.dewpoint as number) ?? ''} onChange={e => setField('dewpoint', parseInt(e.target.value))} placeholder="-4" /></div>
        </div>
        <div className={ds.grid2}>
          <div><label className={ds.label}>Altimeter (" Hg)</label><input type="number" step="0.01" className={ds.input} value={(form.altimeter as number) || ''} onChange={e => setField('altimeter', parseFloat(e.target.value) || 0)} placeholder="30.12" /></div>
          <div><label className={ds.label}>Cloud Layers</label><input className={ds.input} value={(form.cloudLayers as string) || ''} onChange={e => setField('cloudLayers', e.target.value)} placeholder="FEW250, SCT120, BKN080..." /></div>
        </div>
      </div>
      <div className="border-t border-lattice-border pt-4">
        <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Forecast & Advisories</h4>
        <div><label className={ds.label}>TAF (Terminal Forecast)</label><textarea className={cn(ds.textarea, 'font-mono text-xs h-20')} value={(form.taf as string) || ''} onChange={e => setField('taf', e.target.value)} placeholder="TAF KJFK 221130Z..." /></div>
        <div><label className={ds.label}>NOTAMs</label><textarea className={cn(ds.textarea, 'h-16')} value={(form.notams as string) || ''} onChange={e => setField('notams', e.target.value)} placeholder="Active NOTAMs for this station..." /></div>
        <div><label className={ds.label}>PIREPs</label><textarea className={cn(ds.textarea, 'h-16')} value={(form.pirepSummary as string) || ''} onChange={e => setField('pirepSummary', e.target.value)} placeholder="Pilot reports of turbulence, icing..." /></div>
        <div className={ds.grid2}>
          <div><label className={ds.label}>AIRMETs</label><textarea className={cn(ds.textarea, 'h-12')} value={(form.airmets as string) || ''} onChange={e => setField('airmets', e.target.value)} placeholder="Active AIRMETs..." /></div>
          <div><label className={ds.label}>SIGMETs</label><textarea className={cn(ds.textarea, 'h-12')} value={(form.sigmets as string) || ''} onChange={e => setField('sigmets', e.target.value)} placeholder="Active SIGMETs..." /></div>
        </div>
      </div>
      <div><label className={ds.label}>Remarks</label><textarea className={cn(ds.textarea, 'h-12')} value={(form.remarks as string) || ''} onChange={e => setField('remarks', e.target.value)} placeholder="Additional remarks..." /></div>
    </div>
  );

  const getEditorForTab = () => {
    switch (activeMode) {
      case 'flights': return renderFlightEditor();
      case 'pilots': return renderPilotEditor();
      case 'fleet': return renderAircraftEditor();
      case 'maintenance': return renderMaintenanceEditor();
      case 'charter': return renderCharterEditor();
      case 'wb': return renderWBEditor();
      case 'weather': return renderWeatherEditor();
      default: return renderFlightEditor();
    }
  };

  const getCardRenderer = () => {
    switch (activeMode) {
      case 'flights': return renderFlightCard;
      case 'pilots': return renderPilotCard;
      case 'fleet': return renderAircraftCard;
      case 'maintenance': return renderMaintenanceCard;
      case 'charter': return renderCharterCard;
      case 'wb': return renderWBCard;
      case 'weather': return renderWeatherCard;
      default: return renderFlightCard;
    }
  };

  const handleSave = async () => {
    // For W&B, compute final values before saving
    if (activeMode === 'wb') {
      const ew = (form.emptyWeight as number) || 0;
      const ea = (form.emptyArm as number) || 0;
      const fw = (form.fuelWeight as number) || 0;
      const fa = (form.fuelArm as number) || 0;
      const pw = (form.pilotWeight as number) || 0;
      const pa = (form.pilotArm as number) || 0;
      const cpw = (form.copilotWeight as number) || 0;
      const cpa = (form.copilotArm as number) || 0;
      const r1w = (form.paxRow1Weight as number) || 0;
      const r1a = (form.paxRow1Arm as number) || 0;
      const r2w = (form.paxRow2Weight as number) || 0;
      const r2a = (form.paxRow2Arm as number) || 0;
      const cw = (form.cargoWeight as number) || 0;
      const ca = (form.cargoArm as number) || 0;
      const bw = (form.baggageWeight as number) || 0;
      const ba = (form.baggageArm as number) || 0;
      const totalW = ew + fw + pw + cpw + r1w + r2w + cw + bw;
      const totalM = ew * ea + fw * fa + pw * pa + cpw * cpa + r1w * r1a + r2w * r2a + cw * ca + bw * ba;
      const cgCalc = totalW > 0 ? totalM / totalW : 0;
      const mg = (form.maxGross as number) || 99999;
      const fwdL = (form.fwdCGLimit as number) || 0;
      const aftL = (form.aftCGLimit as number) || 999;
      setField('totalWeight', totalW);
      setField('totalMoment', totalM);
      setField('cg', cgCalc);
      setField('emptyMoment', ew * ea);
      setField('withinLimits', totalW <= mg && cgCalc >= fwdL && cgCalc <= aftL);
    }
    if (editingId) {
      await handleUpdate();
    } else {
      await handleCreate();
    }
  };

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------
  return (
    <div className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Plane className="w-8 h-8 text-sky-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Aviation Operations</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Flight ops, pilot management, fleet tracking, maintenance, charter, W&B</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-sky-400 animate-pulse">Processing...</span>}
          {activeMode !== 'dashboard' && (
            <button onClick={openNew} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" /> New {getTypeForTab(activeMode)}
            </button>
          )}
        </div>
      </header>


      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Flights', value: flights.length, icon: Plane },
          { label: 'On-Time Rate', value: `${flights.length > 0 ? Math.round((completedFlights / flights.length) * 100) : 0}%`, icon: CheckCircle },
          { label: 'Active Routes', value: activeFlights, icon: Navigation },
          { label: 'Fleet Ready', value: airworthyAircraft, icon: Shield },
        ].map((stat, _i) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="aviation" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel domain="aviation" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="aviation" data={{}} compact />
      {/* Mode Tabs */}
      <div className="flex gap-1 border-b border-lattice-border pb-0 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveMode(tab.key); setStatusFilter(''); setSearchQuery(''); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeMode === tab.key
                  ? 'border-sky-400 text-sky-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Dashboard view */}
      {activeMode === 'dashboard' && renderDashboard()}

      {/* List views */}
      {activeMode !== 'dashboard' && (
        <>
          {/* Search & Filter */}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={`Search ${MODE_TABS.find(t => t.key === activeMode)?.label.toLowerCase() || ''}...`}
                className={cn(ds.input, 'pl-10')}
              />
            </div>
            {getStatusesForTab(activeMode).length > 0 && (
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={cn(ds.select, 'w-52')}>
                <option value="">All Statuses</option>
                {getStatusesForTab(activeMode).map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            )}
          </div>

          {/* Domain Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {activeMode === 'flights' && (
              <>
                <button onClick={() => handleAction('flight_summary')} className={cn(ds.btnGhost, ds.btnSmall)}><Clipboard className="w-3 h-3" /> Flight Summary</button>
                <button onClick={() => handleAction('weather_check')} className={cn(ds.btnGhost, ds.btnSmall)}><CloudRain className="w-3 h-3" /> Weather Check</button>
              </>
            )}
            {activeMode === 'pilots' && (
              <>
                <button onClick={() => handleAction('currency_check')} className={cn(ds.btnGhost, ds.btnSmall)}><Shield className="w-3 h-3" /> Currency Check</button>
                <button onClick={() => handleAction('duty_time_check')} className={cn(ds.btnGhost, ds.btnSmall)}><Timer className="w-3 h-3" /> Duty Time Check</button>
              </>
            )}
            {activeMode === 'fleet' && (
              <>
                <button onClick={() => handleAction('maintenance_alert')} className={cn(ds.btnGhost, ds.btnSmall)}><AlertTriangle className="w-3 h-3" /> Maintenance Alert</button>
              </>
            )}
            {activeMode === 'maintenance' && (
              <>
                <button onClick={() => handleAction('maintenance_alert')} className={cn(ds.btnGhost, ds.btnSmall)}><AlertTriangle className="w-3 h-3" /> Check ADs</button>
              </>
            )}
            {activeMode === 'wb' && (
              <>
                <button onClick={() => handleAction('wb_calculate')} className={cn(ds.btnGhost, ds.btnSmall)}><Calculator className="w-3 h-3" /> W&B Calculate</button>
              </>
            )}
            {activeMode === 'weather' && (
              <>
                <button onClick={() => handleAction('weather_check')} className={cn(ds.btnGhost, ds.btnSmall)}><CloudRain className="w-3 h-3" /> Refresh Weather</button>
                <button onClick={() => handleAction('flight_summary')} className={cn(ds.btnGhost, ds.btnSmall)}><Clipboard className="w-3 h-3" /> Weather Summary</button>
              </>
            )}
          </div>

          {/* Cards Grid */}
          <div className={ds.grid3}>
            {items.length === 0 ? (
              <p className="col-span-full text-center py-12 text-gray-500">
                No {MODE_TABS.find(t => t.key === activeMode)?.label.toLowerCase() || 'items'} found. Create your first entry.
              </p>
            ) : (
              items.map((item, index) => (
                <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  {getCardRenderer()(item)}
                </motion.div>
              ))
            )}
          </div>
        </>
      )}

      {/* Action Result Panel */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          {/* currencyCheck */}
          {actionResult.checks !== undefined && actionResult.allCurrent !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${actionResult.allCurrent ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{actionResult.allCurrent ? 'All Current' : 'Attention Needed'}</span>
                <span className="text-xs text-gray-400">{String(actionResult.crewMember)}</span>
              </div>
              {(actionResult.checks as {type:string;current:boolean;daysRemaining?:number|null}[]).map((c, i) => (
                <div key={i} className="flex items-center justify-between p-1.5 bg-lattice-surface rounded">
                  <span className="text-xs text-gray-300">{c.type}</span>
                  <div className="flex items-center gap-2">
                    {c.daysRemaining != null && <span className="text-[10px] text-gray-400">{c.daysRemaining}d left</span>}
                    <span className={`text-[10px] font-semibold ${c.current ? 'text-green-400' : 'text-red-400'}`}>{c.current ? '✓' : '!'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* maintenanceDue */}
          {actionResult.items !== undefined && actionResult.overdueCount !== undefined && (
            <div className="space-y-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-gray-400">{String(actionResult.aircraft)}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${Number(actionResult.overdueCount) > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{String(actionResult.overdueCount)} Overdue</span>
              </div>
              {(actionResult.items as {type:string;overdue:boolean;hoursRemaining?:number;dueIn?:number}[]).map((item, i) => (
                <div key={i} className={`flex items-center justify-between p-1.5 rounded ${item.overdue ? 'bg-red-500/10' : 'bg-lattice-surface'}`}>
                  <span className="text-xs text-gray-300">{item.type}</span>
                  <span className={`text-[10px] font-semibold ${item.overdue ? 'text-red-400' : 'text-green-400'}`}>{item.overdue ? 'OVERDUE' : item.hoursRemaining != null ? `${item.hoursRemaining}h left` : item.dueIn != null ? `${item.dueIn}d left` : 'OK'}</span>
                </div>
              ))}
            </div>
          )}
          {/* hobbsLog */}
          {actionResult.totalTime !== undefined && actionResult.picTime !== undefined && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalTime)}h</p>
                <p className="text-[10px] text-gray-500">Total Time</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.picTime)}h</p>
                <p className="text-[10px] text-gray-500">PIC Time</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.nightTime)}h</p>
                <p className="text-[10px] text-gray-500">Night Time</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.instrumentTime)}h</p>
                <p className="text-[10px] text-gray-500">Instrument</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.crossCountry)}h</p>
                <p className="text-[10px] text-gray-500">Cross-Country</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalFlights)}</p>
                <p className="text-[10px] text-gray-500">Total Flights</p>
              </div>
            </div>
          )}
          {/* slipUtilization */}
          {actionResult.utilization !== undefined && actionResult.marina !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{String(actionResult.marina)}</span>
                <span className="text-sm font-bold text-neon-cyan">{String(actionResult.utilization)}% Utilized</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-neon-cyan rounded-full transition-all" style={{ width: `${actionResult.utilization}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-green-400">{String(actionResult.occupied)}</p>
                  <p className="text-[10px] text-gray-500">Occupied</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-amber-400">{String(actionResult.vacant)}</p>
                  <p className="text-[10px] text-gray-500">Vacant</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">${String(actionResult.monthlyRevenue)}</p>
                  <p className="text-[10px] text-gray-500">Monthly Rev</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <div className={ds.modalBackdrop} onClick={resetForm}>
          <div className={ds.modalContainer} onClick={e => e.stopPropagation()}>
            <div className={cn(ds.modalPanel, 'max-w-3xl max-h-[90vh] overflow-hidden flex flex-col')}>
              <div className="p-6 border-b border-lattice-border flex items-center justify-between shrink-0">
                <h2 className={ds.heading2}>{editingId ? 'Edit' : 'New'} {getTypeForTab(activeMode)}</h2>
                <button onClick={resetForm} className={ds.btnGhost}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                {getEditorForTab()}
              </div>
              <div className="p-4 border-t border-lattice-border flex justify-between shrink-0">
                <div className="flex gap-2">
                  {editingId && (
                    <button onClick={() => { remove(editingId); resetForm(); }} className={ds.btnDanger}>
                      <X className="w-4 h-4" /> Delete
                    </button>
                  )}
                  {editingId && activeMode === 'flights' && (
                    <button onClick={() => handleAction('flight_summary', editingId)} className={ds.btnSecondary}>
                      <Clipboard className="w-4 h-4" /> Summary
                    </button>
                  )}
                  {editingId && activeMode === 'pilots' && (
                    <button onClick={() => handleAction('currency_check', editingId)} className={ds.btnSecondary}>
                      <Shield className="w-4 h-4" /> Check Currency
                    </button>
                  )}
                  {editingId && activeMode === 'wb' && (
                    <button onClick={() => handleAction('wb_calculate', editingId)} className={ds.btnSecondary}>
                      <Calculator className="w-4 h-4" /> Calculate
                    </button>
                  )}
                  {editingId && activeMode === 'weather' && (
                    <button onClick={() => handleAction('weather_check', editingId)} className={ds.btnSecondary}>
                      <CloudRain className="w-4 h-4" /> Refresh
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={resetForm} className={ds.btnSecondary}>Cancel</button>
                  <button onClick={handleSave} className={ds.btnPrimary}>
                    {editingId ? 'Update' : 'Create'}
                  </button>
                </div>
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
            <LensFeaturePanel lensId="aviation" />
          </div>
        )}
      </div>
    </div>
  );
}
