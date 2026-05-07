'use client';

import { motion } from 'framer-motion';
import { useState, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  CalendarDays, MapPin, Plus, Search, Filter, X, Edit2, Trash2,
  Ticket, Star, DollarSign, Users, Clock, CheckCircle2, AlertTriangle,
  Building2, Utensils, Speaker, Palette, Camera, Shield, Music,
  BarChart3, FileText, Play, MessageCircle,
  ListChecks, PieChart, ArrowUpRight,
  ArrowDownRight, Crown, Gift, ClipboardList, Sparkles,
  Phone, Mail, PartyPopper, Briefcase, Heart,
  Theater, School, UtensilsCrossed, Armchair,
  Layers, ChevronDown,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab =
  | 'dashboard'
  | 'events'
  | 'venues'
  | 'vendors'
  | 'guests'
  | 'runofshow'
  | 'budget'
  | 'tickets';
type ArtifactType = 'Event' | 'Venue' | 'Vendor' | 'Guest' | 'RunOfShow' | 'Budget' | 'TicketTier';

type EventType = 'conference' | 'wedding' | 'concert' | 'festival' | 'corporate' | 'social';
type EventStatus = 'planning' | 'confirmed' | 'live' | 'completed' | 'cancelled';
type VenueSetup = 'theater' | 'classroom' | 'banquet' | 'reception';
type VendorCategory = 'catering' | 'av' | 'decor' | 'entertainment' | 'photo' | 'security';
type _PaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

const EVENT_TYPES: { id: EventType; label: string; icon: typeof CalendarDays }[] = [
  { id: 'conference', label: 'Conference', icon: Briefcase },
  { id: 'wedding', label: 'Wedding', icon: Heart },
  { id: 'concert', label: 'Concert', icon: Ticket },
  { id: 'festival', label: 'Festival', icon: PartyPopper },
  { id: 'corporate', label: 'Corporate', icon: Building2 },
  { id: 'social', label: 'Social', icon: Users },
];

const EVENT_STATUSES: EventStatus[] = ['planning', 'confirmed', 'live', 'completed', 'cancelled'];

const STATUS_COLORS: Record<string, string> = {
  planning: 'amber-400',
  confirmed: 'neon-blue',
  live: 'green-400',
  completed: 'neon-purple',
  cancelled: 'red-400',
  pending: 'amber-400',
  partial: 'neon-cyan',
  paid: 'green-400',
  overdue: 'red-400',
  available: 'green-400',
  booked: 'red-400',
  maintenance: 'amber-400',
  draft: 'gray-400',
  finalized: 'neon-blue',
  active: 'green-400',
};

const VENUE_SETUPS: { id: VenueSetup; label: string; icon: typeof CalendarDays }[] = [
  { id: 'theater', label: 'Theater', icon: Theater },
  { id: 'classroom', label: 'Classroom', icon: School },
  { id: 'banquet', label: 'Banquet', icon: UtensilsCrossed },
  { id: 'reception', label: 'Reception', icon: Armchair },
];

const VENDOR_CATEGORIES: { id: VendorCategory; label: string; icon: typeof CalendarDays }[] = [
  { id: 'catering', label: 'Catering', icon: Utensils },
  { id: 'av', label: 'AV / Tech', icon: Speaker },
  { id: 'decor', label: 'Decor', icon: Palette },
  { id: 'entertainment', label: 'Entertainment', icon: PartyPopper },
  { id: 'photo', label: 'Photo / Video', icon: Camera },
  { id: 'security', label: 'Security', icon: Shield },
];

const MODE_TABS: { id: ModeTab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'vendors', label: 'Vendors', icon: Users },
  { id: 'guests', label: 'Guests', icon: ClipboardList },
  { id: 'runofshow', label: 'Run of Show', icon: ListChecks },
  { id: 'budget', label: 'Budget', icon: DollarSign },
  { id: 'tickets', label: 'Tickets', icon: Ticket },
];

const _BUDGET_CATEGORIES = [
  'venue',
  'catering',
  'entertainment',
  'decor',
  'marketing',
  'staffing',
  'misc',
] as const;

// ---------------------------------------------------------------------------
// Seed data — empty; all data comes from the backend API via useLensData
// ---------------------------------------------------------------------------
const EMPTY_EVENTS: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];
const EMPTY_VENUES: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];
const EMPTY_VENDORS: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];
const EMPTY_RUNOFSHOW: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];
const EMPTY_BUDGETS: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];
const EMPTY_TICKETS: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];

const EMPTY_GUESTS: Array<{
  title: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}> = [];

const EMPTY_DATA: Record<
  ArtifactType,
  Array<{ title: string; data: Record<string, unknown>; meta: Record<string, unknown> }>
> = {
  Event: EMPTY_EVENTS,
  Venue: EMPTY_VENUES,
  Vendor: EMPTY_VENDORS,
  Guest: EMPTY_GUESTS,
  RunOfShow: EMPTY_RUNOFSHOW,
  Budget: EMPTY_BUDGETS,
  TicketTier: EMPTY_TICKETS,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function parseJsonSafe<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch (e) {
      console.warn('JSON parse failed, using fallback:', e);
      return fallback;
    }
  }
  if (Array.isArray(val)) return val as T;
  return fallback;
}

function ProgressBar({
  value,
  max,
  color = 'neon-blue',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const p = pct(value, max);
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
        <span>{p}%</span>
      </div>
      <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', `bg-${color}`)}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string | number;
  sub?: string;
  trend?: 'up' | 'down' | null;
}) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-neon-cyan" />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold">{value}</p>
        {trend === 'up' && <ArrowUpRight className="w-4 h-4 text-green-400" />}
        {trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-400" />}
      </div>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function EventsLensPage() {
  useLensNav('events');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('events');

  const [showFeatures, setShowFeatures] = useState(true);
  const [mode, setMode] = useState<ModeTab>('dashboard');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState('planning');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // Determine current artifact type
  const typeMap: Record<ModeTab, ArtifactType> = {
    dashboard: 'Event',
    events: 'Event',
    venues: 'Venue',
    vendors: 'Vendor',
    guests: 'Guest',
    runofshow: 'RunOfShow',
    budget: 'Budget',
    tickets: 'TicketTier',
  };
  const currentType = typeMap[mode] || 'Event';

  // Data hooks
  const {
    items: events,
    isLoading: eventsLoading,
    isError,
    error,
    refetch,
    create: createEvent,
    update: updateEvent,
    remove: removeEvent,
  } = useLensData('events', 'Event', { seed: EMPTY_DATA.Event });
  const {
    items: venues,
    isLoading: venuesLoading,
    create: createVenue,
    update: updateVenue,
    remove: removeVenue,
  } = useLensData('events', 'Venue', { seed: EMPTY_DATA.Venue });
  const {
    items: vendors,
    isLoading: vendorsLoading,
    create: createVendor,
    update: updateVendor,
    remove: removeVendor,
  } = useLensData('events', 'Vendor', { seed: EMPTY_DATA.Vendor });
  const {
    items: guests,
    isLoading: guestsLoading,
    create: createGuest,
    update: updateGuest,
    remove: removeGuest,
  } = useLensData('events', 'Guest', { seed: EMPTY_DATA.Guest });
  const {
    items: runofshows,
    isLoading: rosLoading,
    create: createROS,
    update: updateROS,
    remove: removeROS,
  } = useLensData('events', 'RunOfShow', { seed: EMPTY_DATA.RunOfShow });
  const {
    items: budgets,
    isLoading: budgetLoading,
    create: createBudget,
    update: updateBudget,
    remove: removeBudget,
  } = useLensData('events', 'Budget', { seed: EMPTY_DATA.Budget });
  const {
    items: tickets,
    isLoading: ticketsLoading,
    create: createTicket,
    update: updateTicket,
    remove: removeTicket,
  } = useLensData('events', 'TicketTier', { seed: EMPTY_DATA.TicketTier });

  const runAction = useRunArtifact('events');

  // RSVP / Ticket purchase state
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);
  const [rsvpSuccess, setRsvpSuccess] = useState<string | null>(null);

  const handleRSVP = async (eventItem: LensItem) => {
    const d = eventItem.data as Record<string, unknown>;
    const price = Number(d.ticketPrice || 0);
    const attendees = parseJsonSafe<string[]>(d.attendees, []);
    const cap = Number(d.capacity || 0);
    if (cap > 0 && attendees.length >= cap) {
      setRsvpSuccess(null);
      return;
    }
    setRsvpLoading(eventItem.id);
    try {
      const userId = 'current-user'; // from auth context
      if (price > 0) {
        // Paid ticket: call economy transfer endpoint
        const { api: apiClient } = await import('@/lib/api/client');
        await apiClient.post('/api/economy/transfer', {
          to: (d.creatorId as string) || 'platform',
          amount: price,
          type: 'EVENT_TICKET',
          metadata: { eventId: eventItem.id, eventTitle: eventItem.title },
        });
      }
      // Add user to attendees
      const updatedAttendees = [...attendees, userId];
      await updateEvent(eventItem.id, {
        title: eventItem.title,
        data: { ...d, attendees: updatedAttendees, registered: (Number(d.registered || 0)) + 1 },
        meta: eventItem.meta,
      });
      // Create calendar event via calendar lens
      try {
        const { api: apiClient } = await import('@/lib/api/client');
        await apiClient.post('/api/lens/calendar/event', {
          title: eventItem.title,
          data: {
            description: String(d.description || ''),
            startDate: d.date,
            endDate: d.endDate || d.date,
            location: String(d.location || d.venue || ''),
            allDay: false,
            color: '#ec4899',
            category: 'events',
            eventType: 'deadline',
          },
          meta: { status: 'confirmed' },
        });
      } catch { /* calendar sync optional */ }
      // Announce event RSVP via social post
      try {
        const { api: apiClient } = await import('@/lib/api/client');
        await apiClient.post('/api/social/post', {
          content: `I'm attending "${eventItem.title}"! ${d.date ? `Date: ${String(d.date)}` : ''} ${d.location || d.venue ? `Location: ${String(d.location || d.venue)}` : ''}`,
          mediaType: 'text',
          tags: ['event', 'rsvp'],
        });
      } catch { /* social post optional */ }
      setRsvpSuccess(eventItem.id);
    } catch (err) {
      console.error('RSVP failed:', err);
    } finally {
      setRsvpLoading(null);
    }
  };

  // Current items based on mode
  const currentItems = useMemo(() => {
    const map: Record<ModeTab, LensItem[]> = {
      dashboard: events,
      events,
      venues,
      vendors,
      guests,
      runofshow: runofshows,
      budget: budgets,
      tickets,
    };
    return map[mode] || [];
  }, [mode, events, venues, vendors, guests, runofshows, budgets, tickets]);

  const isLoading = eventsLoading || venuesLoading || vendorsLoading || guestsLoading || rosLoading || budgetLoading || ticketsLoading;

  // Filtering
  const filtered = useMemo(() => {
    let list = currentItems;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || JSON.stringify(i.data).toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.meta?.status === statusFilter);
    }
    if (typeFilter !== 'all' && mode === 'events') {
      list = list.filter((i) => (i.data as Record<string, unknown>).eventType === typeFilter);
    }
    return list;
  }, [currentItems, search, statusFilter, typeFilter, mode]);

  const detailItem = currentItems.find((i) => i.id === detailId) || null;

  // CRUD helpers
  const getCrud = () => {
    switch (mode) {
      case 'events': case 'dashboard': return { create: createEvent, update: updateEvent, remove: removeEvent };
      case 'venues': return { create: createVenue, update: updateVenue, remove: removeVenue };
      case 'vendors': return { create: createVendor, update: updateVendor, remove: removeVendor };
      case 'guests': return { create: createGuest, update: updateGuest, remove: removeGuest };
      case 'runofshow': return { create: createROS, update: updateROS, remove: removeROS };
      case 'budget': return { create: createBudget, update: updateBudget, remove: removeBudget };
      case 'tickets': return { create: createTicket, update: updateTicket, remove: removeTicket };
      default: return { create: createEvent, update: updateEvent, remove: removeEvent };
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormStatus('planning');
    setFormFields({});
    setEditing(null);
    setShowEditor(false);
  };

  const openCreate = () => {
    resetForm();
    setShowEditor(true);
  };

  const openEdit = (id: string) => {
    const item = currentItems.find((i) => i.id === id);
    if (!item) return;
    setEditing(id);
    setFormTitle(item.title);
    setFormStatus((item.meta?.status as string) || 'planning');
    const fields: Record<string, string> = {};
    Object.entries(item.data as Record<string, unknown>).forEach(([k, v]) => {
      fields[k] = String(v ?? '');
    });
    setFormFields(fields);
    setShowEditor(true);
  };

  const handleSave = async () => {
    const { create, update } = getCrud();
    const data: Record<string, unknown> = {};
    Object.entries(formFields).forEach(([k, v]) => {
      const num = Number(v);
      data[k] =
        !isNaN(num) &&
        v.trim() !== '' &&
        !k.includes('date') &&
        !k.includes('Date') &&
        !k.includes('phone') &&
        !k.includes('email') &&
        !k.includes('Name') &&
        !k.includes('address') &&
        !k.includes('description') &&
        !k.includes('notes') &&
        !k.includes('perks') &&
        !k.includes('restrictions') &&
        !k.includes('amenities') &&
        !k.includes('rooms') &&
        !k.includes('setupOptions') &&
        !k.includes('ticketTiers') &&
        !k.includes('segments') &&
        !k.includes('categories') &&
        !k.includes('sponsorships') &&
        !k.includes('saleStart') &&
        !k.includes('saleEnd')
          ? num
          : v;
    });
    if (editing) {
      await update(editing, { title: formTitle, data, meta: { status: formStatus } });
    } else {
      await create({ title: formTitle, data, meta: { status: formStatus } });
      // Announce new event via social post
      if (mode === 'events' || mode === 'dashboard') {
        try {
          const { api: apiClient } = await import('@/lib/api/client');
          const price = Number(data.ticketPrice || 0);
          await apiClient.post('/api/social/post', {
            content: `New event: "${formTitle}"${data.date ? ` on ${String(data.date)}` : ''}${data.location || data.venue ? ` at ${String(data.location || data.venue)}` : ''}. ${price > 0 ? `Tickets: ${price} CC` : 'Free admission!'}`,
            mediaType: 'text',
            tags: ['event', 'new-event', String(data.eventType || 'social')],
          });
        } catch { /* social announcement optional */ }
      }
    }
    resetForm();
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || detailId || filtered[0]?.id;
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

  // Computed dashboard metrics
  const dashMetrics = useMemo(() => {
    const upcoming = events.filter((e) =>
      ['planning', 'confirmed'].includes(e.meta?.status as string)
    ).length;
    const liveNow = events.filter((e) => e.meta?.status === 'live').length;
    const totalSold = tickets.reduce(
      (s, t) => s + Number((t.data as Record<string, unknown>).sold || 0),
      0
    );
    const totalAvail = tickets.reduce(
      (s, t) => s + Number((t.data as Record<string, unknown>).totalAvailable || 0),
      0
    );
    const revenueMonth = events.reduce(
      (s, e) => s + Number((e.data as Record<string, unknown>).revenue || 0),
      0
    );
    const vendorsPending = vendors.filter((v) => v.meta?.status === 'pending').length;
    const vendorsConfirmed = vendors.filter((v) => v.meta?.status === 'confirmed').length;
    const totalRegistered = events.reduce(
      (s, e) => s + Number((e.data as Record<string, unknown>).registered || 0),
      0
    );
    const totalCapacity = events.reduce(
      (s, e) => s + Number((e.data as Record<string, unknown>).capacity || 0),
      0
    );
    const avgAttendance = pct(totalRegistered, totalCapacity);
    const budgetTotal = budgets.reduce((s, b) => {
      const cats = parseJsonSafe<Array<{ budgeted: number; actual: number }>>(
        (b.data as Record<string, unknown>).categories,
        []
      );
      return s + cats.reduce((c, cat) => c + (cat.actual || 0), 0);
    }, 0);
    const sponsorTotal = budgets.reduce((s, b) => {
      const sps = parseJsonSafe<Array<{ amount: number }>>(
        (b.data as Record<string, unknown>).sponsorships,
        []
      );
      return s + sps.reduce((c, sp) => c + (sp.amount || 0), 0);
    }, 0);
    return {
      upcoming,
      liveNow,
      totalSold,
      totalAvail,
      revenueMonth,
      vendorsPending,
      vendorsConfirmed,
      avgAttendance,
      budgetTotal,
      sponsorTotal,
    };
  }, [events, vendors, tickets, budgets]);

  // Form field configs per mode
  const getFormConfig = (): Array<{
    key: string;
    label: string;
    type?: string;
    options?: string[];
  }> => {
    switch (mode) {
      case 'events': case 'dashboard': return [
        { key: 'eventType', label: 'Event Type', type: 'select', options: EVENT_TYPES.map(t => t.id) },
        { key: 'date', label: 'Start Date', type: 'date' },
        { key: 'endDate', label: 'End Date', type: 'date' },
        { key: 'time', label: 'Start Time' },
        { key: 'venue', label: 'Venue' },
        { key: 'location', label: 'Location / Address' },
        { key: 'capacity', label: 'Capacity' },
        { key: 'ticketPrice', label: 'Ticket Price in CC (0 = free)' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'ticketTiers', label: 'Ticket Tiers (comma-separated)' },
      ];
      case 'venues': return [
        { key: 'address', label: 'Address' },
        { key: 'capacity', label: 'Max Capacity' },
        { key: 'rooms', label: 'Rooms / Areas (comma-separated)' },
        { key: 'setupOptions', label: 'Setup Options', type: 'select', options: VENUE_SETUPS.map(s => s.id) },
        { key: 'rentalCost', label: 'Rental Cost ($)' },
        { key: 'amenities', label: 'Included Amenities' },
        { key: 'restrictions', label: 'Restrictions', type: 'textarea' },
        { key: 'contactPhone', label: 'Contact Phone' },
        { key: 'contactEmail', label: 'Contact Email' },
      ];
      case 'vendors': return [
        { key: 'category', label: 'Category', type: 'select', options: VENDOR_CATEGORIES.map(c => c.id) },
        { key: 'contactName', label: 'Contact Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'contractCost', label: 'Contract Cost ($)' },
        { key: 'paymentStatus', label: 'Payment Status', type: 'select', options: ['pending', 'partial', 'paid', 'overdue'] },
        { key: 'paidAmount', label: 'Amount Paid ($)' },
        { key: 'setupTime', label: 'Setup Time' },
        { key: 'teardownTime', label: 'Teardown Time' },
        { key: 'insuranceVerified', label: 'Insurance Verified', type: 'select', options: ['true', 'false'] },
        { key: 'assignedEvent', label: 'Assigned Event' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ];
      case 'guests': return [
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'eventName', label: 'Event' },
        { key: 'rsvpStatus', label: 'RSVP Status', type: 'select', options: ['confirmed', 'pending', 'declined'] },
        { key: 'tableAssignment', label: 'Table Assignment' },
        { key: 'dietaryRestrictions', label: 'Dietary Restrictions' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ];
      case 'runofshow': return [
        { key: 'eventName', label: 'Event Name' },
        { key: 'date', label: 'Date', type: 'date' },
      ];
      case 'budget': return [
        { key: 'eventName', label: 'Event Name' },
        { key: 'totalBudget', label: 'Total Budget ($)' },
        { key: 'attendeeCount', label: 'Expected Attendees' },
      ];
      case 'tickets': return [
        { key: 'eventName', label: 'Event Name' },
        { key: 'tierName', label: 'Tier Name' },
        { key: 'price', label: 'Price ($)' },
        { key: 'totalAvailable', label: 'Total Available' },
        { key: 'sold', label: 'Sold' },
        { key: 'waitlist', label: 'Waitlist Count' },
        { key: 'compTickets', label: 'Comp Tickets' },
        { key: 'saleStart', label: 'Sale Start', type: 'date' },
        { key: 'saleEnd', label: 'Sale End', type: 'date' },
        { key: 'description', label: 'Description' },
        { key: 'perks', label: 'Perks / Includes' },
      ];
      default: return [];
    }
  };

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

  // ---------------------------------------------------------------------------
  // Render: Dashboard
  // ---------------------------------------------------------------------------
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className={ds.grid4}>
        <MetricCard
          icon={CalendarDays}
          label="Upcoming Events"
          value={dashMetrics.upcoming}
          sub={`${dashMetrics.liveNow} live now`}
          trend="up"
        />
        <MetricCard
          icon={Ticket}
          label="Tickets Sold"
          value={dashMetrics.totalSold.toLocaleString()}
          sub={`of ${dashMetrics.totalAvail.toLocaleString()} available`}
          trend="up"
        />
        <MetricCard
          icon={DollarSign}
          label="Total Revenue"
          value={fmtCurrency(dashMetrics.revenueMonth)}
          sub={`Sponsorships: ${fmtCurrency(dashMetrics.sponsorTotal)}`}
          trend="up"
        />
        <MetricCard
          icon={Users}
          label="Avg Attendance"
          value={`${dashMetrics.avgAttendance}%`}
          sub="across all events"
          trend={dashMetrics.avgAttendance > 70 ? 'up' : 'down'}
        />
      </div>

      <div className={ds.grid2}>
        {/* Vendor status summary */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <Users className="w-5 h-5 text-neon-cyan" /> Vendor Overview
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Confirmed Vendors</span>
              <span className="text-green-400 font-semibold">{dashMetrics.vendorsConfirmed}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Pending Contracts</span>
              <span className="text-amber-400 font-semibold">{dashMetrics.vendorsPending}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Total Vendor Spend</span>
              <span className="text-white font-semibold">
                {fmtCurrency(
                  vendors.reduce(
                    (s, v) => s + Number((v.data as Record<string, unknown>).contractCost || 0),
                    0
                  )
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Unverified Insurance</span>
              <span
                className={cn(
                  'font-semibold',
                  vendors.filter((v) => !(v.data as Record<string, unknown>).insuranceVerified)
                    .length > 0
                    ? 'text-red-400'
                    : 'text-green-400'
                )}
              >
                {
                  vendors.filter((v) => !(v.data as Record<string, unknown>).insuranceVerified)
                    .length
                }
              </span>
            </div>
          </div>
        </div>

        {/* Budget snapshot */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <PieChart className="w-5 h-5 text-neon-pink" /> Budget Snapshot
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Total Budgeted</span>
              <span className="text-white font-semibold">
                {fmtCurrency(
                  budgets.reduce(
                    (s, b) => s + Number((b.data as Record<string, unknown>).totalBudget || 0),
                    0
                  )
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Total Spent</span>
              <span className="text-amber-400 font-semibold">
                {fmtCurrency(dashMetrics.budgetTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Sponsorship Revenue</span>
              <span className="text-green-400 font-semibold">
                {fmtCurrency(dashMetrics.sponsorTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Net Position</span>
              {(() => {
                const net =
                  dashMetrics.revenueMonth + dashMetrics.sponsorTotal - dashMetrics.budgetTotal;
                return (
                  <span
                    className={cn('font-semibold', net >= 0 ? 'text-green-400' : 'text-red-400')}
                  >
                    {fmtCurrency(net)}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming events timeline */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <Clock className="w-5 h-5 text-amber-400" /> Upcoming Events Timeline
        </h3>
        <div className="divide-y divide-lattice-border">
          {events
            .filter((e) => ['planning', 'confirmed', 'live'].includes(e.meta?.status as string))
            .sort((a, b) =>
              String((a.data as Record<string, unknown>).date || '').localeCompare(
                String((b.data as Record<string, unknown>).date || '')
              )
            )
            .map((evt) => {
              const d = evt.data as Record<string, unknown>;
              const st = evt.meta?.status as string;
              const evtType = EVENT_TYPES.find((t) => t.id === d.eventType);
              const EvtIcon = evtType?.icon || CalendarDays;
              return (
                <div
                  key={evt.id}
                  className="flex items-center gap-4 py-3 px-2 hover:bg-lattice-elevated/50 rounded-lg cursor-pointer transition-colors"
                  onClick={() => {
                    setMode('events');
                    setDetailId(evt.id);
                  }}
                >
                  <EvtIcon className="w-5 h-5 text-neon-pink shrink-0" />
                  <span className={cn(ds.textMono, 'w-24 text-neon-cyan shrink-0')}>
                    {String(d.date || '').slice(5)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{evt.title}</p>
                    <p className={cn(ds.textMuted, 'truncate')}>
                      {String(d.venue || '')} -- Cap: {Number(d.capacity || 0).toLocaleString()}
                    </p>
                  </div>
                  <ProgressBar
                    value={Number(d.registered || 0)}
                    max={Number(d.capacity || 1)}
                    color="neon-pink"
                  />
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                </div>
              );
            })}
          {events.filter((e) =>
            ['planning', 'confirmed', 'live'].includes(e.meta?.status as string)
          ).length === 0 && (
            <p className={cn(ds.textMuted, 'py-4 text-center')}>No upcoming events</p>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
          <Play className="w-5 h-5 text-green-400" /> Domain Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Budget Analysis', action: 'budget_analysis', icon: PieChart },
            { label: 'Vendor Check', action: 'vendor_check', icon: CheckCircle2 },
            { label: 'Run-of-Show Generate', action: 'ros_generate', icon: ListChecks },
            { label: 'Registration Report', action: 'registration_report', icon: FileText },
            { label: 'Event Summary', action: 'event_summary', icon: ClipboardList },
          ].map((a) => (
            <button
              key={a.action}
              onClick={() => handleAction(a.action)}
              className={cn(ds.btnSecondary, ds.btnSmall)}
              disabled={runAction.isPending}
            >
              <a.icon className="w-4 h-4" /> {a.label}
            </button>
          ))}
          {runAction.isPending && (
            <span className="text-xs text-neon-blue animate-pulse self-center ml-2">
              Running...
            </span>
          )}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Events list
  // ---------------------------------------------------------------------------
  const renderEventsList = () => (
    <div className="space-y-4">
      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter('all')}
          className={cn(
            ds.btnSmall,
            typeFilter === 'all'
              ? 'bg-neon-pink/20 text-neon-pink border border-neon-pink/50'
              : ds.btnGhost
          )}
        >
          All Types
        </button>
        {EVENT_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTypeFilter(t.id)}
              className={cn(
                ds.btnSmall,
                typeFilter === t.id
                  ? 'bg-neon-pink/20 text-neon-pink border border-neon-pink/50'
                  : ds.btnGhost
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <CalendarDays className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No events found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create one
          </button>
        </div>
      ) : detailId && detailItem ? (
        renderEventDetail(detailItem)
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item, index) => {
            const d = item.data as Record<string, unknown>;
            const st = item.meta?.status as string;
            const evtType = EVENT_TYPES.find((t) => t.id === d.eventType);
            const EvtIcon = evtType?.icon || CalendarDays;
            return (
              <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => setDetailId(item.id)}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <EvtIcon className="w-5 h-5 text-neon-pink shrink-0" />
                    <h3 className={cn(ds.heading3, 'truncate')}>{item.title}</h3>
                  </div>
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                </div>
                <div className="space-y-1 mb-3">
                  <p className={ds.textMuted}>
                    <MapPin className="w-3 h-3 inline mr-1" />
                    {String(d.venue || 'Venue not set')}
                  </p>
                  <p className={ds.textMuted}>
                    <CalendarDays className="w-3 h-3 inline mr-1" />
                    {String(d.date || 'Date not set')}
                    {Boolean(d.endDate) && d.endDate !== d.date ? ` to ${String(d.endDate)}` : ''}
                  </p>
                  {Boolean(d.description) && (
                    <p className="text-xs text-gray-500 line-clamp-2">{String(d.description)}</p>
                  )}
                </div>
                <ProgressBar
                  value={Number(d.registered || 0)}
                  max={Number(d.capacity || 1)}
                  color="neon-pink"
                />
                {/* Ticket price indicator */}
                <div className="flex items-center gap-2 mt-2">
                  <Ticket className="w-3.5 h-3.5 text-neon-green" />
                  <span className="text-xs text-neon-green font-medium">
                    {Number(d.ticketPrice || 0) === 0 ? 'Free' : `${Number(d.ticketPrice)} CC`}
                  </span>
                  {Boolean(d.location) && (
                    <>
                      <MapPin className="w-3 h-3 text-gray-500 ml-1" />
                      <span className="text-xs text-gray-500 truncate">{String(d.location)}</span>
                    </>
                  )}
                </div>
                <ProgressBar value={Number(d.registered || 0)} max={Number(d.capacity || 1)} color="neon-pink" />
                {/* Ticket price indicator */}
                <div className="flex items-center gap-2 mt-2">
                  <Ticket className="w-3.5 h-3.5 text-neon-green" />
                  <span className="text-xs text-neon-green font-medium">
                    {Number(d.ticketPrice || 0) === 0 ? 'Free' : `${Number(d.ticketPrice)} CC`}
                  </span>
                  {Boolean(d.location) && (
                    <><MapPin className="w-3 h-3 text-gray-500 ml-1" /><span className="text-xs text-gray-500 truncate">{String(d.location)}</span></>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 mt-2 border-t border-lattice-border">
                  <span className={ds.textMuted}>
                    {fmtCurrency(Number(d.revenue || 0))} revenue
                  </span>
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
                        removeEvent(item.id);
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
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Event detail view
  // ---------------------------------------------------------------------------
  const renderEventDetail = (item: LensItem): React.ReactNode => {
    const d = item.data as Record<string, string | number | boolean | null | undefined>;
    const st = item.meta?.status as string;
    const evtType = EVENT_TYPES.find((t) => t.id === d.eventType);
    const EvtIcon = evtType?.icon || CalendarDays;
    const relatedVendors = vendors.filter(
      (v) => (v.data as Record<string, unknown>).assignedEvent === item.title
    );
    const relatedTickets = tickets.filter(
      (t) => (t.data as Record<string, unknown>).eventName === item.title
    );
    const relatedROS = runofshows.filter(
      (r) => (r.data as Record<string, unknown>).eventName === item.title
    );

    return (
      <div className="space-y-4">
        <button onClick={() => setDetailId(null)} className={cn(ds.btnGhost, 'mb-2')}>
          <X className="w-4 h-4" /> Back to list
        </button>
        <div className={ds.panel}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <EvtIcon className="w-8 h-8 text-neon-pink" />
              <div>
                <h2 className={ds.heading2}>{item.title}</h2>
                <p className={ds.textMuted}>
                  {evtType?.label || 'Event'}
                  {d.venue ? ` — ${String(d.venue)}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
              <button onClick={() => openEdit(item.id)} className={ds.btnSecondary}>
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            </div>
          </div>

          <div className={ds.grid4}>
            <div>
              <p className={ds.textMuted}>Date</p>
              <p className="font-medium">
                {d.date ? (
                  String(d.date)
                ) : (
                  <span className="text-gray-500 text-sm">Not scheduled</span>
                )}
                {Boolean(d.endDate) && d.endDate !== d.date ? ` to ${String(d.endDate)}` : ''}
              </p>
            </div>
            <div>
              <p className={ds.textMuted}>Capacity</p>
              <p className="font-medium">{Number(d.capacity || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className={ds.textMuted}>Registered</p>
              <p className="font-medium">{Number(d.registered || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className={ds.textMuted}>Revenue</p>
              <p className="font-medium text-green-400">{fmtCurrency(Number(d.revenue || 0))}</p>
            </div>
          </div>

          {Boolean(d.description) && (
            <p className="text-sm text-gray-300 mt-3">{String(d.description)}</p>
          )}

          <div className="mt-4">
            <p className={cn(ds.textMuted, 'mb-2')}>Registration vs Capacity</p>
            <ProgressBar
              value={Number(d.registered || 0)}
              max={Number(d.capacity || 1)}
              color="neon-pink"
            />
          </div>

          {/* IRL Ticketing Section */}
          <div className="mt-4 pt-4 border-t border-lattice-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-neon-green" />
                <span className="font-semibold text-sm">
                  {Number(d.ticketPrice || 0) === 0 ? 'Free Event' : `${Number(d.ticketPrice)} CC per ticket`}
                </span>
              </div>
              {((): React.ReactNode => {
                const attendees = parseJsonSafe<string[]>(d.attendees, []);
                const cap = Number(d.capacity || 0);
                const isFull = cap > 0 && attendees.length >= cap;
                const alreadyRSVP = attendees.includes('current-user');
                return (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRSVP(item); }}
                    disabled={!!rsvpLoading || isFull || alreadyRSVP}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                      alreadyRSVP ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                      isFull ? 'bg-red-500/15 text-red-400 border border-red-500/30 cursor-not-allowed' :
                      'bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25'
                    )}
                  >
                    {rsvpLoading === item.id ? (
                      <><div className="w-4 h-4 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /> Processing...</>
                    ) : alreadyRSVP ? (
                      <><CheckCircle2 className="w-4 h-4" /> You&apos;re Going!</>
                    ) : isFull ? (
                      'Sold Out'
                    ) : Number(d.ticketPrice || 0) === 0 ? (
                      <><Users className="w-4 h-4" /> RSVP (Free)</>
                    ) : (
                      <><Ticket className="w-4 h-4" /> Get Ticket ({Number(d.ticketPrice)} CC)</>
                    )}
                  </button>
                );
              })()}
            </div>
            {rsvpSuccess === item.id && (
              <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4" /> Ticket confirmed! A calendar event has been created and your RSVP was posted.
              </div>
            )}
            {/* Attendee count & list */}
            {((): React.ReactNode => {
              const attendees = parseJsonSafe<string[]>(d.attendees, []);
              return attendees.length > 0 ? (
                <div>
                  <p className={cn(ds.textMuted, 'mb-2')}>{attendees.length} attendee{attendees.length !== 1 ? 's' : ''}</p>
                  <div className="flex flex-wrap gap-1">
                    {attendees.slice(0, 20).map((a, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-full bg-lattice-elevated text-gray-300">{a}</span>
                    ))}
                    {attendees.length > 20 && <span className="text-xs text-gray-500">+{attendees.length - 20} more</span>}
                  </div>
                </div>
              ) : (
                <p className={ds.textMuted}>No attendees yet. Be the first to RSVP!</p>
              );
            })()}
          </div>

          {/* Creator stats */}
          {((): React.ReactNode => {
            const attendees = parseJsonSafe<string[]>(d.attendees, []);
            const ticketPrice = Number(d.ticketPrice || 0);
            const ticketRevenue = attendees.length * ticketPrice;
            return ticketPrice > 0 && attendees.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-lattice-border">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">Creator Dashboard</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Tickets Sold</p>
                    <p className="text-lg font-bold text-neon-cyan">{attendees.length}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-lg font-bold text-neon-green">{ticketRevenue} CC</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Remaining</p>
                    <p className="text-lg font-bold">{Math.max(0, Number(d.capacity || 0) - attendees.length)}</p>
                  </div>
                </div>
              </div>
            ) : null;
          })()}

          {/* Discussion link */}
          {d.description && (
            <div className="mt-3 pt-3 border-t border-lattice-border">
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open(`/lenses/feed?search=${encodeURIComponent(item.title)}`, '_blank');
                  }
                }}
                className={cn(ds.btnGhost, 'text-neon-cyan text-sm')}
              >
                <MessageCircle className="w-4 h-4" /> View Discussion Thread
              </button>
            </div>
          )}
        </div>

        {/* Related tickets */}
        {relatedTickets.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <Ticket className="w-5 h-5 text-neon-cyan" /> Ticket Tiers
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-lattice-border">
                    <th className="pb-2 pr-4">Tier</th>
                    <th className="pb-2 pr-4">Price</th>
                    <th className="pb-2 pr-4">Sold</th>
                    <th className="pb-2 pr-4">Available</th>
                    <th className="pb-2 pr-4">Waitlist</th>
                    <th className="pb-2 pr-4">Comp</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lattice-border">
                  {relatedTickets.map((t) => {
                    const td = t.data as Record<string, unknown>;
                    return (
                      <tr key={t.id} className="text-gray-300">
                        <td className="py-2 pr-4 font-medium">{String(td.tierName)}</td>
                        <td className="py-2 pr-4">{fmtCurrency(Number(td.price || 0))}</td>
                        <td className="py-2 pr-4">{Number(td.sold || 0).toLocaleString()}</td>
                        <td className="py-2 pr-4">
                          {Number(td.totalAvailable || 0).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">{Number(td.waitlist || 0)}</td>
                        <td className="py-2 pr-4">{Number(td.compTickets || 0)}</td>
                        <td className="py-2">
                          <span
                            className={ds.badge(
                              STATUS_COLORS[t.meta?.status as string] || 'gray-400'
                            )}
                          >
                            {t.meta?.status as string}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Related vendors */}
        {relatedVendors.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <Users className="w-5 h-5 text-green-400" /> Assigned Vendors
            </h3>
            <div className={ds.grid2}>
              {relatedVendors.map((v) => {
                const vd = v.data as Record<string, unknown>;
                const catInfo = VENDOR_CATEGORIES.find((c) => c.id === vd.category);
                const CatIcon = catInfo?.icon || Users;
                return (
                  <div
                    key={v.id}
                    className="flex items-start gap-3 p-3 bg-lattice-elevated rounded-lg"
                  >
                    <CatIcon className="w-5 h-5 text-neon-cyan shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{v.title}</p>
                      <p className={ds.textMuted}>
                        {catInfo?.label || String(vd.category)} -- {String(vd.contactName)}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-400">
                          {fmtCurrency(Number(vd.contractCost || 0))}
                        </span>
                        <span
                          className={ds.badge(
                            STATUS_COLORS[String(vd.paymentStatus)] || 'gray-400'
                          )}
                        >
                          {String(vd.paymentStatus)}
                        </span>
                        {vd.insuranceVerified ? (
                          <Shield className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Related run-of-show */}
        {relatedROS.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <ListChecks className="w-5 h-5 text-amber-400" /> Run of Show
            </h3>
            {relatedROS.map((ros) => {
              const rd = ros.data as Record<string, unknown>;
              const segments = parseJsonSafe<
                Array<{
                  time: string;
                  duration: number;
                  activity: string;
                  responsible: string;
                  avCues: string;
                  transition: string;
                  contingency: string;
                }>
              >(rd.segments, []);
              return (
                <div key={ros.id} className="mb-4 last:mb-0">
                  <p className="text-sm text-gray-300 mb-2 font-medium">{ros.title}</p>
                  <div className="space-y-1">
                    {segments.slice(0, 6).map((seg, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 py-2 px-2 hover:bg-lattice-elevated/50 rounded text-sm"
                      >
                        <span className={cn(ds.textMono, 'text-neon-cyan w-14 shrink-0')}>
                          {seg.time}
                        </span>
                        <span className="text-gray-400 w-12 shrink-0">{seg.duration}min</span>
                        <span className="flex-1 text-gray-200">{seg.activity}</span>
                        <span className="text-gray-500 text-xs">{seg.responsible}</span>
                      </div>
                    ))}
                    {segments.length > 6 && (
                      <p className={cn(ds.textMuted, 'text-center py-1')}>
                        +{segments.length - 6} more segments
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Domain actions for this event */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Actions</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Budget Analysis', action: 'budget_analysis', icon: PieChart },
              { label: 'Vendor Check', action: 'vendor_check', icon: CheckCircle2 },
              { label: 'Generate Run-of-Show', action: 'ros_generate', icon: ListChecks },
              { label: 'Registration Report', action: 'registration_report', icon: FileText },
              { label: 'Event Summary', action: 'event_summary', icon: ClipboardList },
            ].map((a) => (
              <button
                key={a.action}
                onClick={() => handleAction(a.action, item.id)}
                className={cn(ds.btnSecondary, ds.btnSmall)}
                disabled={runAction.isPending}
              >
                <a.icon className="w-4 h-4" /> {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Venues
  // ---------------------------------------------------------------------------
  const renderVenues = () => (
    <div className="space-y-4">
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No venues found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
            <Plus className="w-4 h-4" /> Add venue
          </button>
        </div>
      ) : (
        <div className={ds.grid2}>
          {filtered.map((item) => {
            const d = item.data as Record<string, unknown>;
            const st = item.meta?.status as string;
            const rooms = String(d.rooms || '')
              .split(',')
              .filter(Boolean);
            const setups = String(d.setupOptions || '')
              .split(',')
              .filter(Boolean);
            return (
              <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item.id)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-neon-cyan" />
                    <h3 className={ds.heading3}>{item.title}</h3>
                  </div>
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                </div>
                <div className="space-y-2 mb-3">
                  <p className={ds.textMuted}>
                    <MapPin className="w-3 h-3 inline mr-1" />
                    {String(d.address || '')}
                  </p>
                  <div className="flex items-center gap-4">
                    <span className={ds.textMuted}>
                      <Users className="w-3 h-3 inline mr-1" />
                      Cap: {Number(d.capacity || 0).toLocaleString()}
                    </span>
                    <span className={ds.textMuted}>
                      <DollarSign className="w-3 h-3 inline mr-1" />
                      {fmtCurrency(Number(d.rentalCost || 0))}
                    </span>
                  </div>
                </div>
                {/* Rooms */}
                <div className="mb-2">
                  <p className="text-xs text-gray-500 mb-1">Rooms / Areas</p>
                  <div className="flex flex-wrap gap-1">
                    {rooms.slice(0, 4).map((r, i) => (
                      <span key={i} className={ds.badge('neon-cyan')}>
                        {r.trim()}
                      </span>
                    ))}
                    {rooms.length > 4 && (
                      <span className={ds.badge('gray-400')}>+{rooms.length - 4}</span>
                    )}
                  </div>
                </div>
                {/* Setups */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">Setup Options</p>
                  <div className="flex flex-wrap gap-1">
                    {setups.map((s, i) => {
                      const info = VENUE_SETUPS.find((vs) => vs.id === s.trim());
                      return (
                        <span key={i} className={ds.badge('neon-purple')}>
                          {info?.label || s.trim()}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {/* Contact */}
                {Boolean(d.contactPhone || d.contactEmail) && (
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                    {Boolean(d.contactPhone) && (
                      <span>
                        <Phone className="w-3 h-3 inline mr-1" />
                        {String(d.contactPhone)}
                      </span>
                    )}
                    {Boolean(d.contactEmail) && (
                      <span>
                        <Mail className="w-3 h-3 inline mr-1" />
                        {String(d.contactEmail)}
                      </span>
                    )}
                  </div>
                )}
                {/* Amenities */}
                {Boolean(d.amenities) && (
                  <div className="mb-2">
                    <p className="text-xs text-gray-500 mb-1">Amenities</p>
                    <p className="text-xs text-gray-400">{String(d.amenities)}</p>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
                  {Boolean(d.restrictions) && (
                    <p className="text-xs text-red-400/70 flex-1 truncate">
                      <AlertTriangle className="w-3 h-3 inline mr-1" />
                      {String(d.restrictions)}
                    </p>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
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
                        removeVenue(item.id);
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
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Vendors
  // ---------------------------------------------------------------------------
  const renderVendors = () => (
    <div className="space-y-4">
      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter('all')}
          className={cn(
            ds.btnSmall,
            typeFilter === 'all'
              ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50'
              : ds.btnGhost
          )}
        >
          All Categories
        </button>
        {VENDOR_CATEGORIES.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => setTypeFilter(c.id)}
              className={cn(
                ds.btnSmall,
                typeFilter === c.id
                  ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50'
                  : ds.btnGhost
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {c.label}
            </button>
          );
        })}
      </div>

      {(() => {
        const vendorFiltered =
          typeFilter !== 'all'
            ? filtered.filter((v) => (v.data as Record<string, unknown>).category === typeFilter)
            : filtered;
        if (vendorFiltered.length === 0) {
          return (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No vendors found</p>
              <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
                <Plus className="w-4 h-4" /> Add vendor
              </button>
            </div>
          );
        }
        return (
          <div className={ds.grid3}>
            {vendorFiltered.map((item) => {
              const d = item.data as Record<string, unknown>;
              const st = item.meta?.status as string;
              const catInfo = VENDOR_CATEGORIES.find((c) => c.id === d.category);
              const CatIcon = catInfo?.icon || Users;
              const payColor = STATUS_COLORS[String(d.paymentStatus)] || 'gray-400';
              const paidPct = pct(Number(d.paidAmount || 0), Number(d.contractCost || 1));
              return (
                <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item.id)}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CatIcon className="w-5 h-5 text-neon-cyan shrink-0" />
                      <h3 className={cn(ds.heading3, 'truncate')}>{item.title}</h3>
                    </div>
                    <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                  </div>
                  <div className="space-y-1 mb-3">
                    <p className={ds.textMuted}>{catInfo?.label || String(d.category)}</p>
                    <p className="text-sm text-gray-300">{String(d.contactName || '')}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {Boolean(d.phone) && (
                        <span>
                          <Phone className="w-3 h-3 inline mr-1" />
                          {String(d.phone)}
                        </span>
                      )}
                      {Boolean(d.email) && (
                        <span>
                          <Mail className="w-3 h-3 inline mr-1" />
                          {String(d.email)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Contract and payment */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-400">
                        Contract: {fmtCurrency(Number(d.contractCost || 0))}
                      </span>
                      <span className={ds.badge(payColor)}>{String(d.paymentStatus)}</span>
                    </div>
                    <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-400 rounded-full transition-all"
                        style={{ width: `${Math.min(100, paidPct)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {fmtCurrency(Number(d.paidAmount || 0))} of{' '}
                      {fmtCurrency(Number(d.contractCost || 0))} paid
                    </p>
                  </div>
                  {/* Times */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                    <span>
                      <Clock className="w-3 h-3 inline mr-1" />
                      Setup: {String(d.setupTime || 'N/A')}
                    </span>
                    <span>Teardown: {String(d.teardownTime || 'N/A')}</span>
                  </div>
                  {/* Insurance and rating */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      {d.insuranceVerified ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <Shield className="w-3.5 h-3.5" /> Insured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertTriangle className="w-3.5 h-3.5" /> Unverified
                        </span>
                      )}
                    </div>
                    {Boolean(d.rating) && (
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        <span className="text-sm text-amber-400">{String(d.rating)}</span>
                      </div>
                    )}
                  </div>
                  {Boolean(d.assignedEvent) && (
                    <p className="text-xs text-gray-500">
                      <CalendarDays className="w-3 h-3 inline mr-1" />
                      {String(d.assignedEvent)}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-1 pt-2 border-t border-lattice-border mt-2">
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
                        removeVendor(item.id);
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
        );
      })()}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Run-of-Show
  // ---------------------------------------------------------------------------
  const renderRunOfShow = () => (
    <div className="space-y-4">
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ListChecks className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No run-of-show timelines found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create one
          </button>
        </div>
      ) : (
        filtered.map((item) => {
          const d = item.data as Record<string, unknown>;
          const segments = parseJsonSafe<
            Array<{
              time: string;
              duration: number;
              activity: string;
              responsible: string;
              avCues: string;
              transition: string;
              contingency: string;
            }>
          >(d.segments, []);
          const st = item.meta?.status as string;
          return (
            <div key={item.id} className={ds.panel}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <ListChecks className="w-6 h-6 text-amber-400" />
                  <div>
                    <h3 className={ds.heading3}>{item.title}</h3>
                    <p className={ds.textMuted}>
                      {String(d.eventName || '')} -- {String(d.date || '')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                  <button onClick={() => openEdit(item.id)} className={ds.btnGhost}>
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeROS(item.id)}
                    className={cn(ds.btnGhost, 'hover:text-red-400')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {/* Segments table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-lattice-border">
                      <th className="pb-2 pr-3 w-16">Time</th>
                      <th className="pb-2 pr-3 w-14">Dur.</th>
                      <th className="pb-2 pr-3">Activity</th>
                      <th className="pb-2 pr-3">Responsible</th>
                      <th className="pb-2 pr-3">AV / Tech Cues</th>
                      <th className="pb-2 pr-3">Transition</th>
                      <th className="pb-2">Contingency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-lattice-border">
                    {segments.map((seg, i) => (
                      <tr key={i} className="text-gray-300 hover:bg-lattice-elevated/30">
                        <td className={cn('py-2 pr-3', ds.textMono, 'text-neon-cyan')}>
                          {seg.time}
                        </td>
                        <td className="py-2 pr-3 text-gray-400">{seg.duration}m</td>
                        <td className="py-2 pr-3 font-medium">{seg.activity}</td>
                        <td className="py-2 pr-3 text-gray-400">{seg.responsible}</td>
                        <td className="py-2 pr-3 text-xs text-gray-500">{seg.avCues}</td>
                        <td className="py-2 pr-3 text-xs text-gray-500">{seg.transition}</td>
                        <td className="py-2 text-xs text-amber-400/80">{seg.contingency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {segments.length === 0 && (
                <p className={cn(ds.textMuted, 'py-4 text-center')}>No segments added yet</p>
              )}
              {/* Quick action */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
                <button
                  onClick={() => handleAction('ros_generate', item.id)}
                  className={cn(ds.btnSecondary, ds.btnSmall)}
                  disabled={runAction.isPending}
                >
                  <Sparkles className="w-4 h-4" /> AI Generate Segments
                </button>
                <button
                  onClick={() => handleAction('event_summary', item.id)}
                  className={cn(ds.btnSecondary, ds.btnSmall)}
                  disabled={runAction.isPending}
                >
                  <FileText className="w-4 h-4" /> Export
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Budget
  // ---------------------------------------------------------------------------
  const renderBudget = () => (
    <div className="space-y-4">
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No budgets found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create budget
          </button>
        </div>
      ) : (
        filtered.map((item) => {
          const d = item.data as Record<string, unknown>;
          const categories = parseJsonSafe<
            Array<{ name: string; budgeted: number; actual: number; notes: string }>
          >(d.categories, []);
          const sponsorships = parseJsonSafe<
            Array<{ sponsor: string; amount: number; tier: string }>
          >(d.sponsorships, []);
          const totalBudgeted = categories.reduce((s, c) => s + c.budgeted, 0);
          const totalActual = categories.reduce((s, c) => s + c.actual, 0);
          const totalSponsors = sponsorships.reduce((s, sp) => s + sp.amount, 0);
          const attendees = Number(d.attendeeCount || 1);
          const perAttendee = attendees > 0 ? totalActual / attendees : 0;
          const overallBudget = Number(d.totalBudget || 0);
          const st = item.meta?.status as string;

          return (
            <div key={item.id} className={ds.panel}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-6 h-6 text-green-400" />
                  <div>
                    <h3 className={ds.heading3}>{item.title}</h3>
                    <p className={ds.textMuted}>
                      {String(d.eventName || '')} -- {attendees.toLocaleString()} attendees
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                  <button onClick={() => openEdit(item.id)} className={ds.btnGhost}>
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeBudget(item.id)}
                    className={cn(ds.btnGhost, 'hover:text-red-400')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Summary cards */}
              <div className={ds.grid4}>
                <div className="p-3 bg-lattice-elevated rounded-lg">
                  <p className={ds.textMuted}>Total Budget</p>
                  <p className="text-lg font-bold">{fmtCurrency(overallBudget)}</p>
                </div>
                <div className="p-3 bg-lattice-elevated rounded-lg">
                  <p className={ds.textMuted}>Total Spent</p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      totalActual > overallBudget ? 'text-red-400' : 'text-white'
                    )}
                  >
                    {fmtCurrency(totalActual)}
                  </p>
                </div>
                <div className="p-3 bg-lattice-elevated rounded-lg">
                  <p className={ds.textMuted}>Sponsorship Revenue</p>
                  <p className="text-lg font-bold text-green-400">{fmtCurrency(totalSponsors)}</p>
                </div>
                <div className="p-3 bg-lattice-elevated rounded-lg">
                  <p className={ds.textMuted}>Cost Per Attendee</p>
                  <p className="text-lg font-bold">{fmtCurrency(perAttendee)}</p>
                </div>
              </div>

              {/* Budget utilization bar */}
              <div className="mt-4 mb-4">
                <p className={cn(ds.textMuted, 'mb-1')}>Budget Utilization</p>
                <ProgressBar
                  value={totalActual}
                  max={overallBudget}
                  color={totalActual > overallBudget ? 'red-400' : 'green-400'}
                />
              </div>

              {/* Category breakdown */}
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-lattice-border">
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4 text-right">Budgeted</th>
                      <th className="pb-2 pr-4 text-right">Actual</th>
                      <th className="pb-2 pr-4 text-right">Variance</th>
                      <th className="pb-2 pr-4">Usage</th>
                      <th className="pb-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-lattice-border">
                    {categories.map((cat, i) => {
                      const variance = cat.budgeted - cat.actual;
                      const usage = pct(cat.actual, cat.budgeted);
                      return (
                        <tr key={i} className="text-gray-300">
                          <td className="py-2 pr-4 font-medium capitalize">{cat.name}</td>
                          <td className="py-2 pr-4 text-right">{fmtCurrency(cat.budgeted)}</td>
                          <td className="py-2 pr-4 text-right">{fmtCurrency(cat.actual)}</td>
                          <td
                            className={cn(
                              'py-2 pr-4 text-right font-medium',
                              variance >= 0 ? 'text-green-400' : 'text-red-400'
                            )}
                          >
                            {variance >= 0 ? '+' : ''}
                            {fmtCurrency(variance)}
                          </td>
                          <td className="py-2 pr-4 w-32">
                            <div className="w-full h-1.5 bg-lattice-elevated rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  usage > 100 ? 'bg-red-400' : 'bg-neon-cyan'
                                )}
                                style={{ width: `${Math.min(120, usage)}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-2 text-xs text-gray-500">{cat.notes}</td>
                        </tr>
                      );
                    })}
                    <tr className="text-white font-semibold border-t-2 border-lattice-border">
                      <td className="py-2 pr-4">Total</td>
                      <td className="py-2 pr-4 text-right">{fmtCurrency(totalBudgeted)}</td>
                      <td className="py-2 pr-4 text-right">{fmtCurrency(totalActual)}</td>
                      <td
                        className={cn(
                          'py-2 pr-4 text-right',
                          totalBudgeted - totalActual >= 0 ? 'text-green-400' : 'text-red-400'
                        )}
                      >
                        {totalBudgeted - totalActual >= 0 ? '+' : ''}
                        {fmtCurrency(totalBudgeted - totalActual)}
                      </td>
                      <td className="py-2 pr-4" />
                      <td className="py-2" />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Sponsorships */}
              {sponsorships.length > 0 && (
                <div>
                  <h4 className={cn(ds.heading3, 'text-base mb-2 flex items-center gap-2')}>
                    <Crown className="w-4 h-4 text-amber-400" /> Sponsorships
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {sponsorships.map((sp, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 bg-lattice-elevated rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium">{sp.sponsor}</p>
                          <p className="text-xs text-gray-500">{sp.tier}</p>
                        </div>
                        <span className="text-sm font-semibold text-green-400">
                          {fmtCurrency(sp.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* P&L summary */}
              <div className="mt-4 p-3 bg-lattice-elevated rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Profit / Loss</span>
                  {(() => {
                    const evtRevenue = events.find((e) => e.title === d.eventName);
                    const rev =
                      Number((evtRevenue?.data as Record<string, unknown>)?.revenue || 0) +
                      totalSponsors;
                    const pl = rev - totalActual;
                    return (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          Revenue: {fmtCurrency(rev)} - Costs: {fmtCurrency(totalActual)}
                        </p>
                        <p
                          className={cn(
                            'text-lg font-bold',
                            pl >= 0 ? 'text-green-400' : 'text-red-400'
                          )}
                        >
                          {pl >= 0 ? '+' : ''}
                          {fmtCurrency(pl)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Action */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
                <button
                  onClick={() => handleAction('budget_analysis', item.id)}
                  className={cn(ds.btnSecondary, ds.btnSmall)}
                  disabled={runAction.isPending}
                >
                  <PieChart className="w-4 h-4" /> AI Budget Analysis
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Tickets
  // ---------------------------------------------------------------------------
  const renderTickets = () => {
    // Group by event
    const byEvent = filtered.reduce<Record<string, LensItem[]>>((acc, t) => {
      const evtName = String((t.data as Record<string, unknown>).eventName || 'Unassigned');
      if (!acc[evtName]) acc[evtName] = [];
      acc[evtName].push(t);
      return acc;
    }, {});

    return (
      <div className="space-y-4">
        {Object.keys(byEvent).length === 0 ? (
          <div className="text-center py-12">
            <Ticket className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No ticket tiers found</p>
            <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}>
              <Plus className="w-4 h-4" /> Add ticket tier
            </button>
          </div>
        ) : (
          Object.entries(byEvent).map(([eventName, tiers]) => {
            const totalSold = tiers.reduce(
              (s, t) => s + Number((t.data as Record<string, unknown>).sold || 0),
              0
            );
            const totalAvail = tiers.reduce(
              (s, t) => s + Number((t.data as Record<string, unknown>).totalAvailable || 0),
              0
            );
            const totalRevenue = tiers.reduce(
              (s, t) =>
                s +
                Number((t.data as Record<string, unknown>).sold || 0) *
                  Number((t.data as Record<string, unknown>).price || 0),
              0
            );
            const totalWaitlist = tiers.reduce(
              (s, t) => s + Number((t.data as Record<string, unknown>).waitlist || 0),
              0
            );
            const totalComp = tiers.reduce(
              (s, t) => s + Number((t.data as Record<string, unknown>).compTickets || 0),
              0
            );
            const totalCheckedIn = tiers.reduce(
              (s, t) => s + Number((t.data as Record<string, unknown>).checkedIn || 0),
              0
            );

            return (
              <div key={eventName} className={ds.panel}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                    <Ticket className="w-5 h-5 text-neon-pink" /> {eventName}
                  </h3>
                  <span className={ds.textMuted}>
                    {totalSold.toLocaleString()} / {totalAvail.toLocaleString()} sold
                  </span>
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-sm font-bold text-green-400">{fmtCurrency(totalRevenue)}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Sold</p>
                    <p className="text-sm font-bold">{totalSold.toLocaleString()}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Remaining</p>
                    <p className="text-sm font-bold">{(totalAvail - totalSold).toLocaleString()}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Checked In</p>
                    <p className="text-sm font-bold">{totalCheckedIn.toLocaleString()}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Waitlist</p>
                    <p className="text-sm font-bold text-amber-400">{totalWaitlist}</p>
                  </div>
                  <div className="p-2 bg-lattice-elevated rounded-lg text-center">
                    <p className="text-xs text-gray-500">Comps</p>
                    <p className="text-sm font-bold">{totalComp}</p>
                  </div>
                </div>

                {/* Overall progress */}
                <div className="mb-4">
                  <ProgressBar value={totalSold} max={totalAvail} color="neon-pink" />
                </div>

                {/* Tier cards */}
                <div className={ds.grid3}>
                  {tiers.map((t) => {
                    const td = t.data as Record<string, unknown>;
                    const sold = Number(td.sold || 0);
                    const avail = Number(td.totalAvailable || 0);
                    const price = Number(td.price || 0);
                    const tierRev = sold * price;
                    const st = t.meta?.status as string;
                    const soldOut = sold >= avail;
                    return (
                      <div
                        key={t.id}
                        className={cn(ds.panelHover, 'relative')}
                        onClick={() => openEdit(t.id)}
                      >
                        {soldOut && (
                          <div className="absolute top-2 right-2">
                            <span className={ds.badge('red-400')}>SOLD OUT</span>
                          </div>
                        )}
                        <h4 className="font-semibold text-sm mb-1">{String(td.tierName)}</h4>
                        <p className="text-xl font-bold text-neon-cyan mb-2">
                          {fmtCurrency(price)}
                        </p>
                        <ProgressBar
                          value={sold}
                          max={avail}
                          color={soldOut ? 'red-400' : 'neon-cyan'}
                        />
                        <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                          <div>
                            <span className="text-gray-500">Revenue:</span>{' '}
                            <span className="text-green-400">{fmtCurrency(tierRev)}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Waitlist:</span>{' '}
                            <span className="text-amber-400">{Number(td.waitlist || 0)}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Comps:</span>{' '}
                            <span>{Number(td.compTickets || 0)}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Check-in:</span>{' '}
                            <span>{Number(td.checkedIn || 0)}</span>
                          </div>
                        </div>
                        {Boolean(td.perks) && (
                          <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                            <Gift className="w-3 h-3 inline mr-1" />
                            {String(td.perks)}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-lattice-border">
                          <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(t.id);
                              }}
                              className={ds.btnGhost}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTicket(t.id);
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
          })
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Guests
  // ---------------------------------------------------------------------------
  const renderGuests = () => (
    <div className="space-y-3">
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No guests found</p>
          <button onClick={openCreate} className={cn(ds.btnGhost, 'mt-3')}><Plus className="w-4 h-4" /> Add Guest</button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map(item => {
            const d = item.data as Record<string, unknown>;
            const st = item.meta?.status as string;
            return (
              <div key={item.id} className={ds.panelHover} onClick={() => openEdit(item.id)}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className="w-5 h-5 text-neon-cyan shrink-0" />
                    <h3 className={cn(ds.heading3, 'truncate')}>{item.title}</h3>
                  </div>
                  <span className={ds.badge(STATUS_COLORS[st] || 'gray-400')}>{st}</span>
                </div>
                <div className="space-y-1 mb-3">
                  {Boolean(d.email) && <p className={ds.textMuted}>{String(d.email)}</p>}
                  {Boolean(d.phone) && <p className="text-xs text-gray-500">{String(d.phone)}</p>}
                  {Boolean(d.dietaryRestrictions) && <p className="text-xs text-amber-400">{String(d.dietaryRestrictions)}</p>}
                  {Boolean(d.tableAssignment) && <p className="text-xs text-gray-400">Table: {String(d.tableAssignment)}</p>}
                  {Boolean(d.plusOne) && <p className="text-xs text-neon-purple">+1: {String(d.plusOneName || 'Yes')}</p>}
                </div>
                <div className="flex items-center justify-end gap-1 pt-2 border-t border-lattice-border mt-2">
                  <button onClick={e => { e.stopPropagation(); openEdit(item.id); }} className={ds.btnGhost}><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={e => { e.stopPropagation(); removeGuest(item.id); }} className={cn(ds.btnGhost, 'hover:text-red-400')}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Content by mode
  // ---------------------------------------------------------------------------
  const renderContent = () => {
    switch (mode) {
      case 'dashboard': return renderDashboard();
      case 'events': return renderEventsList();
      case 'venues': return renderVenues();
      case 'vendors': return renderVendors();
      case 'runofshow': return renderRunOfShow();
      case 'budget': return renderBudget();
      case 'tickets': return renderTickets();
      case 'guests': return renderGuests();
      default: return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Main return
  // ---------------------------------------------------------------------------
  return (
    <div data-lens-theme="events" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Sparkles className="w-7 h-7 text-neon-pink" />
          <div>
            <h1 className={ds.heading1}>Event Management</h1>
            <p className={ds.textMuted}>Plan, coordinate, and execute events end-to-end</p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="events" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {mode !== 'dashboard' && (
          <button onClick={openCreate} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> New{' '}
            {currentType === 'RunOfShow'
              ? 'Run of Show'
              : currentType === 'TicketTier'
                ? 'Ticket Tier'
                : currentType}
          </button>
        )}
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const allEvts = events;
          const upcoming = allEvts.filter(
            (e) => e.meta?.status === 'planning' || e.meta?.status === 'confirmed'
          ).length;
          const past = allEvts.filter((e) => e.meta?.status === 'completed').length;
          const totalCap = allEvts.reduce(
            (s, e) => s + Number((e.data as Record<string, unknown>).capacity || 0),
            0
          );
          const totalReg = allEvts.reduce(
            (s, e) => s + Number((e.data as Record<string, unknown>).registered || 0),
            0
          );
          const rsvpRate = totalCap > 0 ? Math.round((totalReg / totalCap) * 100) : 0;
          return [
            { label: 'Upcoming', value: upcoming, icon: CalendarDays },
            { label: 'Past Events', value: past, icon: CheckCircle2 },
            { label: 'RSVP Rate', value: `${rsvpRate}%`, icon: Users },
            { label: 'Total Events', value: allEvts.length, icon: Sparkles },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-neon-pink shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const allEvts = events;
          const upcoming = allEvts.filter(e => e.meta?.status === 'planning' || e.meta?.status === 'confirmed').length;
          const past = allEvts.filter(e => e.meta?.status === 'completed').length;
          const totalCap = allEvts.reduce((s, e) => s + Number((e.data as Record<string, unknown>).capacity || 0), 0);
          const totalReg = allEvts.reduce((s, e) => s + Number((e.data as Record<string, unknown>).registered || 0), 0);
          const rsvpRate = totalCap > 0 ? Math.round((totalReg / totalCap) * 100) : 0;
          return [
            { label: 'Upcoming', value: upcoming, icon: CalendarDays },
            { label: 'Past Events', value: past, icon: CheckCircle2 },
            { label: 'RSVP Rate', value: `${rsvpRate}%`, icon: Users },
            { label: 'Total Events', value: allEvts.length, icon: Sparkles },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-neon-pink shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="events" artifactId={events[0]?.id} compact />
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
                setTypeFilter('all');
                setDetailId(null);
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-neon-pink/20 text-neon-pink'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Filters (non-dashboard) */}
      {mode !== 'dashboard' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${mode}...`}
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
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {mode === 'vendors' &&
                ['pending', 'partial', 'paid', 'overdue'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              {mode === 'venues' &&
                ['available', 'booked', 'maintenance'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              {mode === 'runofshow' &&
                ['draft', 'finalized'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              {mode === 'budget' &&
                ['active', 'draft', 'finalized'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              {mode === 'tickets' &&
                ['active', 'completed', 'cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className={ds.textMuted}>Loading event data...</p>
        </div>
      ) : (
        renderContent()
      )}

      {/* Action result display */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-48')}>
            {JSON.stringify(actionResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={resetForm} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[90vh] flex flex-col')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border shrink-0">
                <h2 className={ds.heading2}>
                  {editing ? 'Edit' : 'New'}{' '}
                  {currentType === 'RunOfShow'
                    ? 'Run of Show'
                    : currentType === 'TicketTier'
                      ? 'Ticket Tier'
                      : currentType}
                </h2>
                <button onClick={resetForm} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className={ds.label}>Title / Name</label>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className={ds.input}
                    placeholder="Enter a name..."
                  />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select value={formStatus} onChange={e => setFormStatus(e.target.value)} className={ds.select}>
                    {EVENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    {mode === 'guests' && ['confirmed', 'pending', 'declined'].map(s => <option key={`g-${s}`} value={s}>{s}</option>)}
                    {mode === 'vendors' && ['pending', 'partial', 'paid', 'overdue'].map(s => <option key={`v-${s}`} value={s}>{s}</option>)}
                    {mode === 'venues' && ['available', 'booked', 'maintenance'].map(s => <option key={`ve-${s}`} value={s}>{s}</option>)}
                    {mode === 'runofshow' && ['draft', 'finalized'].map(s => <option key={`r-${s}`} value={s}>{s}</option>)}
                    {mode === 'budget' && ['active', 'draft', 'finalized'].map(s => <option key={`b-${s}`} value={s}>{s}</option>)}
                    {mode === 'tickets' && ['active', 'completed', 'cancelled'].map(s => <option key={`t-${s}`} value={s}>{s}</option>)}
                  </select>
                </div>
                {getFormConfig().map((field) => (
                  <div key={field.key}>
                    <label className={ds.label}>{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        value={formFields[field.key] || ''}
                        onChange={(e) =>
                          setFormFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        className={ds.select}
                      >
                        <option value="">Select...</option>
                        {field.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={formFields[field.key] || ''}
                        onChange={(e) =>
                          setFormFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        className={ds.textarea}
                        rows={3}
                      />
                    ) : (
                      <input
                        type={field.type === 'date' ? 'date' : 'text'}
                        value={formFields[field.key] || ''}
                        onChange={(e) =>
                          setFormFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        className={ds.input}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 p-4 border-t border-lattice-border shrink-0">
                <div>
                  {editing && (
                    <button
                      onClick={() => {
                        const { remove } = getCrud();
                        if (editing) {
                          remove(editing);
                          resetForm();
                        }
                      }}
                      className={ds.btnDanger}
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={resetForm} className={ds.btnSecondary}>
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className={ds.btnPrimary}
                    disabled={!formTitle.trim()}
                  >
                    {editing ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>

            {/* Real-time Data Panel */}
            {realtimeData && (
              <RealtimeDataPanel
                domain="events"
                data={realtimeData}
                isLive={isLive}
                lastUpdated={lastUpdated}
                insights={realtimeInsights}
                compact
              />
            )}
          </div>
        </>
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
            <LensFeaturePanel lensId="events" />
          </div>
        )}
      </div>
    </div>
  );
}
