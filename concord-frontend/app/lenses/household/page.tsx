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
  Home, Users, UtensilsCrossed, CheckSquare, Wrench, PawPrint,
  Plus, Search, Filter, X, Edit3, Trash2,
  ShoppingCart, RotateCcw, AlertTriangle, Clock,
  Calendar, Heart,
  DollarSign, Shield, Phone,
  Star, Award, ChevronLeft, ChevronRight,
  CreditCard, PiggyBank, FileText, Stethoscope, Siren,
  Dog, Pill, MapPin, Zap,
  Sun, Snowflake, Leaf, CloudRain, ClipboardList,
  CheckCircle2, Coffee,
  Salad, Soup, Cake,
  Layers, ChevronDown,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Meals' | 'Chores' | 'Home' | 'Calendar' | 'Budget' | 'Emergency' | 'Family' | 'Pets';

type ArtifactType =
  | 'FamilyMember' | 'MealPlan' | 'Chore' | 'MaintenanceItem'
  | 'Pet' | 'CalendarEvent' | 'BudgetEntry' | 'EmergencyContact';

type Status = 'planned' | 'active' | 'overdue' | 'completed';

interface FamilyMember {
  name: string; role: string; birthday: string; allergies: string[];
  bloodType: string; medications: string[]; dietaryPrefs: string[];
  color: string; notes: string;
}
interface MealPlan {
  name: string; day: string; mealType: string; recipe: string;
  servings: number; ingredients: string[]; prepTime: number;
  dietaryTags: string[]; assignedCook: string; notes: string;
}
interface Chore {
  name: string; assignee: string; frequency: string; room: string;
  estimatedMinutes: number; points: number; lastCompleted: string;
  rotationOrder: string[]; isRecurring: boolean; notes: string;
}
interface MaintenanceItem {
  name: string; area: string; priority: string; dueDate: string;
  cost: number; vendor: string; vendorPhone: string; warrantyExpiry: string;
  season: string; serviceHistory: string[]; notes: string;
}
interface Pet {
  name: string; species: string; breed: string; vetDate: string;
  food: string; vetName: string; vetPhone: string;
  medications: string[]; weight: number; notes: string;
}
interface CalendarEvent {
  name: string; date: string; endDate: string; time: string;
  assignee: string; color: string; isRecurring: boolean;
  recurrenceRule: string; location: string; isShared: boolean; notes: string;
}
interface BudgetEntry {
  name: string; category: string; amount: number; dueDate: string;
  isRecurring: boolean; splitAmong: string[]; isPaid: boolean;
  entryType: string; notes: string;
}
interface EmergencyContact {
  name: string; relationship: string; phone: string; email: string;
  contactType: string; policyNumber: string; accountNumber: string;
  notes: string;
}

type ArtifactData =
  | FamilyMember | MealPlan | Chore | MaintenanceItem
  | Pet | CalendarEvent | BudgetEntry | EmergencyContact;

const MODE_TABS: { id: ModeTab; icon: typeof Home; types: ArtifactType[] }[] = [
  { id: 'Dashboard', icon: Home, types: ['FamilyMember'] },
  { id: 'Family', icon: Users, types: ['FamilyMember'] },
  { id: 'Meals', icon: UtensilsCrossed, types: ['MealPlan'] },
  { id: 'Chores', icon: CheckSquare, types: ['Chore'] },
  { id: 'Home', icon: Wrench, types: ['MaintenanceItem'] },
  { id: 'Calendar', icon: Calendar, types: ['CalendarEvent'] },
  { id: 'Budget', icon: DollarSign, types: ['BudgetEntry'] },
  { id: 'Emergency', icon: Shield, types: ['EmergencyContact'] },
  { id: 'Pets', icon: PawPrint, types: ['Pet'] },
];

const STATUS_COLORS: Record<Status, string> = {
  planned: 'neon-blue',
  active: 'green-400',
  overdue: 'red-400',
  completed: 'gray-400',
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner'];
const FAMILY_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
const BUDGET_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
  'Healthcare', 'Entertainment', 'Dining Out', 'Subscriptions',
  'Childcare', 'Education', 'Savings', 'Pets', 'Clothing', 'Other',
];
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter', 'Year-Round'];

const seedData: Record<ArtifactType, { title: string; data: Record<string, unknown>; meta: Record<string, unknown> }[]> = {
  FamilyMember: [], MealPlan: [], Chore: [], MaintenanceItem: [],
  Pet: [], CalendarEvent: [], BudgetEntry: [], EmergencyContact: [],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getDaysUntil(dateStr: string): number {
  if (!dateStr) return 999;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function getSeasonIcon(season: string) {
  switch (season) {
    case 'Spring': return Leaf;
    case 'Summer': return Sun;
    case 'Fall': return CloudRain;
    case 'Winter': return Snowflake;
    default: return Calendar;
  }
}

function getCurrentWeekDates(): { day: string; date: string }[] {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return DAYS.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { day, date: d.toISOString().split('T')[0] };
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HouseholdLensPage() {
  useLensNav('household');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('household');

  const [mode, setMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [mealWeekOffset, setMealWeekOffset] = useState(0);
  const [selectedBudgetMonth, setSelectedBudgetMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [emergencySubTab, setEmergencySubTab] = useState<'contacts' | 'insurance' | 'utilities' | 'medical'>('contacts');
  const [maintenanceSeason, setMaintenanceSeason] = useState<string>('all');

  // Editor form state
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('planned');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const currentTab = MODE_TABS.find(t => t.id === mode) ?? MODE_TABS[0];
  const currentType = currentTab.types[0];

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactData>('household', currentType, {
    seed: seedData[currentType] || [],
  });

  // Load all types for dashboard
  const { items: familyItems } = useLensData<FamilyMember>('household', 'FamilyMember', { noSeed: true });
  const { items: mealItems } = useLensData<MealPlan>('household', 'MealPlan', { noSeed: true });
  const { items: choreItems } = useLensData<Chore>('household', 'Chore', { noSeed: true });
  const { items: maintenanceItems } = useLensData<MaintenanceItem>('household', 'MaintenanceItem', { noSeed: true });
  const { items: calendarItems } = useLensData<CalendarEvent>('household', 'CalendarEvent', { noSeed: true });
  const { items: budgetItems } = useLensData<BudgetEntry>('household', 'BudgetEntry', { noSeed: true });
  const { items: emergencyItems } = useLensData<EmergencyContact>('household', 'EmergencyContact', { noSeed: true });
  const { items: petItems } = useLensData<Pet>('household', 'Pet', { noSeed: true });

  const runAction = useRunArtifact('household');

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

  /* ---- derived data ---- */
  const groceryIngredients = useMemo(() => {
    const ingredients = new Map<string, number>();
    mealItems.forEach(i => {
      const d = i.data as unknown as MealPlan;
      d.ingredients?.forEach(ing => {
        ingredients.set(ing, (ingredients.get(ing) || 0) + 1);
      });
    });
    return Array.from(ingredients.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mealItems]);

  const overdueChores = useMemo(() =>
    choreItems.filter(i => i.meta.status === 'overdue'), [choreItems]);

  const upcomingMaintenance = useMemo(() =>
    maintenanceItems.filter(i => {
      const d = i.data as unknown as MaintenanceItem;
      return getDaysUntil(d.dueDate) <= 30 && getDaysUntil(d.dueDate) >= 0;
    }), [maintenanceItems]);

  const chorePointsByPerson = useMemo(() => {
    const points: Record<string, { points: number; hours: number; completed: number }> = {};
    choreItems.forEach(i => {
      const d = i.data as unknown as Chore;
      if (!d.assignee) return;
      if (!points[d.assignee]) points[d.assignee] = { points: 0, hours: 0, completed: 0 };
      points[d.assignee].points += d.points || 0;
      points[d.assignee].hours += (d.estimatedMinutes || 0) / 60;
      if (i.meta.status === 'completed') points[d.assignee].completed += 1;
    });
    return points;
  }, [choreItems]);

  const monthlyBudget = useMemo(() => {
    const byCategory: Record<string, { budgeted: number; spent: number }> = {};
    let totalBudgeted = 0;
    let totalSpent = 0;
    budgetItems.forEach(i => {
      const d = i.data as unknown as BudgetEntry;
      const cat = d.category || 'Other';
      if (!byCategory[cat]) byCategory[cat] = { budgeted: 0, spent: 0 };
      const amt = d.amount || 0;
      if (d.entryType === 'income') { return; }
      byCategory[cat].budgeted += amt;
      totalBudgeted += amt;
      if (d.isPaid) { byCategory[cat].spent += amt; totalSpent += amt; }
    });
    return { byCategory, totalBudgeted, totalSpent };
  }, [budgetItems]);

  const billsDueThisWeek = useMemo(() => {
    return budgetItems.filter(i => {
      const d = i.data as unknown as BudgetEntry;
      const days = getDaysUntil(d.dueDate);
      return days >= 0 && days <= 7 && !d.isPaid;
    });
  }, [budgetItems]);

  const birthdaysThisMonth = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    return familyItems.filter(i => {
      const d = i.data as unknown as FamilyMember;
      if (!d.birthday) return false;
      return new Date(d.birthday).getMonth() === month;
    });
  }, [familyItems]);

  /* ---- editor helpers ---- */
  const openNew = useCallback((overrideType?: ModeTab) => {
    if (overrideType && overrideType !== mode) setMode(overrideType);
    setEditingId(null);
    setFormTitle('');
    setFormStatus('planned');
    setFormData({});
    setShowEditor(true);
  }, [mode]);

  const openEdit = useCallback((item: LensItem<ArtifactData>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus((item.meta.status as Status) || 'planned');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  }, []);

  const handleSave = async () => {
    const payload = { title: formTitle, data: formData, meta: { status: formStatus } };
    if (editingId) { await update(editingId, payload); }
    else { await create(payload); }
    setShowEditor(false);
  };

  const handleDelete = async (id: string) => { await remove(id); };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingId || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) { console.error('Action failed:', err); }
  };

  const toggleChoreComplete = async (item: LensItem<ArtifactData>) => {
    const newStatus = item.meta.status === 'completed' ? 'active' : 'completed';
    await update(item.id, {
      data: { ...item.data as unknown as Record<string, unknown>, lastCompleted: new Date().toISOString().split('T')[0] },
      meta: { status: newStatus },
    });
  };

  const toggleBillPaid = async (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as BudgetEntry;
    await update(item.id, {
      data: { ...d as unknown as Record<string, unknown>, isPaid: !d.isPaid },
      meta: { status: d.isPaid ? 'active' : 'completed' },
    });
  };

  /* ---- render: status badge ---- */
  const renderStatusBadge = (status: string) => {
    const color = STATUS_COLORS[status as Status] || 'gray-400';
    return <span className={ds.badge(color)}>{status}</span>;
  };

  /* ---- render: progress bar ---- */
  const renderProgressBar = (value: number, max: number, color: string = 'neon-cyan') => {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', `bg-${color}`)} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  /* ================================================================ */
  /*  DASHBOARD TAB                                                    */
  /* ================================================================ */
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Top Metrics */}
      <div className={ds.grid4}>
        <div className={cn(ds.panel, 'border-l-4 border-l-neon-cyan')}>
          <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-neon-cyan" /><span className={ds.textMuted}>Family</span></div>
          <p className={ds.heading2}>{familyItems.length}</p>
          <p className={ds.textMuted}>{petItems.length} pet{petItems.length !== 1 ? 's' : ''}</p>
        </div>
        <div className={cn(ds.panel, 'border-l-4 border-l-red-400')}>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-red-400" /><span className={ds.textMuted}>Overdue Chores</span></div>
          <p className={ds.heading2}>{overdueChores.length}</p>
          <p className={ds.textMuted}>{choreItems.filter(i => i.meta.status === 'active').length} active</p>
        </div>
        <div className={cn(ds.panel, 'border-l-4 border-l-yellow-400')}>
          <div className="flex items-center gap-2 mb-1"><Wrench className="w-4 h-4 text-yellow-400" /><span className={ds.textMuted}>Maintenance Due</span></div>
          <p className={ds.heading2}>{upcomingMaintenance.length}</p>
          <p className={ds.textMuted}>next 30 days</p>
        </div>
        <div className={cn(ds.panel, 'border-l-4 border-l-green-400')}>
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-green-400" /><span className={ds.textMuted}>Bills Due</span></div>
          <p className={ds.heading2}>{billsDueThisWeek.length}</p>
          <p className={ds.textMuted}>this week</p>
        </div>
      </div>

      {/* Today's Schedule & Grocery List */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Calendar className="w-5 h-5 text-neon-blue" /> Today&apos;s Schedule</h3>
          {calendarItems.length === 0 ? (
            <p className={ds.textMuted}>No events scheduled for today.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {calendarItems.slice(0, 5).map(ev => {
                const d = ev.data as unknown as CalendarEvent;
                return (
                  <div key={ev.id} className="flex items-center gap-3 p-2 rounded-lg bg-lattice-elevated/50">
                    <div className="w-1 h-8 rounded-full" style={{ backgroundColor: d.color || '#3B82F6' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{ev.title}</p>
                      <p className={ds.textMuted}>{d.time || 'All day'}{d.assignee ? ` - ${d.assignee}` : ''}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><ShoppingCart className="w-5 h-5 text-green-400" /> Grocery List</h3>
          {groceryIngredients.length === 0 ? (
            <p className={ds.textMuted}>Add meal plans to auto-generate your grocery list.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {groceryIngredients.slice(0, 12).map(([ing, count]) => (
                <div key={ing} className="flex items-center justify-between p-1.5 rounded bg-lattice-elevated/30">
                  <span className="text-sm text-white">{ing}</span>
                  <span className={ds.badge('neon-cyan')}>x{count}</span>
                </div>
              ))}
              {groceryIngredients.length > 12 && (
                <p className={ds.textMuted}>+{groceryIngredients.length - 12} more items</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overdue Chores & Birthdays */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><CheckSquare className="w-5 h-5 text-red-400" /> Overdue Chores</h3>
          {overdueChores.length === 0 ? (
            <p className={cn(ds.textMuted, 'flex items-center gap-2')}><CheckCircle2 className="w-4 h-4 text-green-400" /> All caught up!</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {overdueChores.map(ch => {
                const d = ch.data as unknown as Chore;
                return (
                  <div key={ch.id} className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div><p className="text-sm text-white">{ch.title}</p><p className={ds.textMuted}>{d.assignee} - {d.room}</p></div>
                    {renderStatusBadge('overdue')}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Heart className="w-5 h-5 text-pink-400" /> Birthdays This Month</h3>
          {birthdaysThisMonth.length === 0 ? (
            <p className={ds.textMuted}>No birthdays this month.</p>
          ) : (
            <div className="space-y-2">
              {birthdaysThisMonth.map(m => {
                const d = m.data as unknown as FamilyMember;
                return (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-pink-500/10 border border-pink-500/20">
                    <Cake className="w-5 h-5 text-pink-400" />
                    <div><p className="text-sm text-white">{d.name}</p><p className={ds.textMuted}>{d.birthday}</p></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bills Due & Upcoming Maintenance */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><CreditCard className="w-5 h-5 text-yellow-400" /> Bills Due This Week</h3>
          {billsDueThisWeek.length === 0 ? (
            <p className={ds.textMuted}>No bills due this week.</p>
          ) : (
            <div className="space-y-2">
              {billsDueThisWeek.map(b => {
                const d = b.data as unknown as BudgetEntry;
                return (
                  <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <div><p className="text-sm text-white">{b.title}</p><p className={ds.textMuted}>Due: {d.dueDate}</p></div>
                    <span className="text-sm font-medium text-yellow-400">{formatCurrency(d.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Wrench className="w-5 h-5 text-orange-400" /> Upcoming Maintenance</h3>
          {upcomingMaintenance.length === 0 ? (
            <p className={ds.textMuted}>No maintenance due in the next 30 days.</p>
          ) : (
            <div className="space-y-2">
              {upcomingMaintenance.slice(0, 5).map(m => {
                const d = m.data as unknown as MaintenanceItem;
                const daysLeft = getDaysUntil(d.dueDate);
                return (
                  <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                    <div><p className="text-sm text-white">{m.title}</p><p className={ds.textMuted}>{d.area}</p></div>
                    <span className={cn('text-xs font-medium', daysLeft <= 7 ? 'text-red-400' : 'text-orange-400')}>
                      {daysLeft}d left
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Emergency Contacts */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><Shield className="w-5 h-5 text-red-400" /> Emergency Contacts</h3>
        {emergencyItems.length === 0 ? (
          <p className={ds.textMuted}>No emergency contacts on file. Add contacts in the Emergency tab.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {emergencyItems.slice(0, 6).map(ec => {
              const d = ec.data as unknown as EmergencyContact;
              return (
                <div key={ec.id} className="flex items-center gap-3 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                  <Shield className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{ec.title || d.name}</p>
                    <p className={ds.textMuted}>{d.relationship}{d.phone ? ` - ${d.phone}` : ''}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* ================================================================ */
  /*  MEAL PLANNER TAB                                                 */
  /* ================================================================ */
  const renderMealPlanner = () => {
    const weekDates = getCurrentWeekDates();
    const mealsByDayType: Record<string, Record<string, LensItem<ArtifactData>[]>> = {};
    DAYS.forEach(day => {
      mealsByDayType[day] = {};
      MEAL_TYPES.forEach(mt => { mealsByDayType[day][mt] = []; });
    });
    (items as LensItem<ArtifactData>[]).forEach(item => {
      const d = item.data as unknown as MealPlan;
      if (d.day && d.mealType && mealsByDayType[d.day]) {
        const mt = d.mealType.charAt(0).toUpperCase() + d.mealType.slice(1);
        if (mealsByDayType[d.day][mt]) mealsByDayType[d.day][mt].push(item);
      }
    });

    const mealTypeIcons: Record<string, typeof Coffee> = { Breakfast: Coffee, Lunch: Salad, Dinner: Soup };

    return (
      <div className="space-y-6">
        {/* Week navigation */}
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-2">
            <button className={ds.btnGhost} onClick={() => setMealWeekOffset(p => p - 1)}><ChevronLeft className="w-4 h-4" /></button>
            <h3 className={ds.heading3}>{mealWeekOffset === 0 ? 'This Week' : mealWeekOffset > 0 ? `+${mealWeekOffset} Week` : `${mealWeekOffset} Week`}</h3>
            <button className={ds.btnGhost} onClick={() => setMealWeekOffset(p => p + 1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
          <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add Meal</button>
        </div>

        {/* Weekly Grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Header row */}
            <div className="grid grid-cols-8 gap-1 mb-1">
              <div className="p-2" />
              {DAYS.map(day => (
                <div key={day} className="p-2 text-center">
                  <p className="text-sm font-medium text-white">{day.slice(0, 3)}</p>
                  <p className={ds.textMuted}>{weekDates.find(w => w.day === day)?.date.slice(5) || ''}</p>
                </div>
              ))}
            </div>
            {/* Meal type rows */}
            {MEAL_TYPES.map(mealType => {
              const Icon = mealTypeIcons[mealType] || UtensilsCrossed;
              return (
                <div key={mealType} className="grid grid-cols-8 gap-1 mb-1">
                  <div className="p-2 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-400">{mealType}</span>
                  </div>
                  {DAYS.map(day => {
                    const meals = mealsByDayType[day]?.[mealType] || [];
                    return (
                      <div key={`${day}-${mealType}`} className={cn(
                        'p-2 rounded-lg border border-lattice-border bg-lattice-surface min-h-[60px]',
                        'hover:border-neon-cyan/30 transition-colors cursor-pointer'
                      )} onClick={() => {
                        setFormData({ day, mealType: mealType.toLowerCase() });
                        openNew();
                      }}>
                        {meals.length > 0 ? meals.map(m => (
                          <div key={m.id} className="text-xs p-1 rounded bg-neon-cyan/10 text-neon-cyan mb-1 truncate" onClick={e => { e.stopPropagation(); openEdit(m); }}>
                            {m.title}
                          </div>
                        )) : (
                          <Plus className="w-3 h-3 text-gray-600 mx-auto mt-3" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dietary Preferences per member */}
        {familyItems.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Dietary Preferences</h3>
            <div className={ds.grid3}>
              {familyItems.map(m => {
                const d = m.data as unknown as FamilyMember;
                return (
                  <div key={m.id} className="p-3 rounded-lg bg-lattice-elevated/50">
                    <p className="text-sm font-medium text-white">{d.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(d.dietaryPrefs || []).length > 0 ? d.dietaryPrefs.map(p => (
                        <span key={p} className={ds.badge('green-400')}>{p}</span>
                      )) : <span className={ds.textMuted}>No preferences set</span>}
                      {(d.allergies || []).length > 0 && d.allergies.map(a => (
                        <span key={a} className={ds.badge('red-400')}>Allergy: {a}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auto-generated Grocery List */}
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}><ShoppingCart className="w-5 h-5 text-green-400" /> Grocery List ({groceryIngredients.length} items)</h3>
          </div>
          {groceryIngredients.length === 0 ? (
            <p className={cn(ds.textMuted, 'mt-3')}>Add meals to auto-generate your grocery list.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
              {groceryIngredients.map(([ing, count]) => (
                <div key={ing} className="flex items-center justify-between p-2 rounded bg-lattice-elevated/50">
                  <span className="text-sm text-white">{ing}</span>
                  {count > 1 && <span className={ds.badge('neon-cyan')}>x{count}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  CHORE ROTATION TAB                                               */
  /* ================================================================ */
  const renderChoreSystem = () => {
    const maxPoints = Math.max(...Object.values(chorePointsByPerson).map(p => p.points), 1);
    const maxHours = Math.max(...Object.values(chorePointsByPerson).map(p => p.hours), 1);

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Chore Management</h3>
          <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add Chore</button>
        </div>

        {/* Fairness Meter */}
        {Object.keys(chorePointsByPerson).length > 0 ? (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}><Award className="w-5 h-5 text-yellow-400" /> Fairness Meter</h3>
            <div className="space-y-4">
              {Object.entries(chorePointsByPerson).map(([person, stats]) => (
                <div key={person} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">{person}</span>
                    <div className="flex items-center gap-3">
                      <span className={ds.badge('yellow-400')}><Star className="w-3 h-3" /> {stats.points} pts</span>
                      <span className={ds.badge('neon-blue')}><Clock className="w-3 h-3" /> {stats.hours.toFixed(1)}h</span>
                      <span className={ds.badge('green-400')}><CheckCircle2 className="w-3 h-3" /> {stats.completed}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 mb-1">Points</p>
                      {renderProgressBar(stats.points, maxPoints, 'yellow-400')}
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 mb-1">Hours</p>
                      {renderProgressBar(stats.hours, maxHours, 'neon-blue')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
            <p>No chore assignments yet. Assign chores to see point distribution.</p>
          </div>
        )}

        {/* Chore Cards with completion toggle */}
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <CheckSquare className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className={ds.heading3}>No chores found</p>
            <p className={ds.textMuted}>Add chores and assign them to family members.</p>
          </div>
        ) : (
          <div className={ds.grid3}>
            {filtered.map((item, index) => {
              const d = item.data as unknown as Chore;
              const isComplete = item.meta.status === 'completed';
              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={cn(ds.panelHover, isComplete && 'opacity-60')}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleChoreComplete(item)} className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                        isComplete ? 'bg-green-400 border-green-400' : 'border-gray-500 hover:border-neon-cyan'
                      )}>
                        {isComplete && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </button>
                      <h4 className={cn('text-sm font-medium text-white', isComplete && 'line-through')}>{item.title}</h4>
                    </div>
                    {renderStatusBadge(item.meta.status as string)}
                  </div>
                  <div className="space-y-1 ml-7">
                    <p className={ds.textMuted}>Assigned: {d.assignee || 'Unassigned'}</p>
                    <p className={ds.textMuted}>{d.room} - {d.frequency}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={ds.badge('yellow-400')}><Star className="w-3 h-3" /> {d.points || 0} pts</span>
                      <span className={ds.badge('gray-400')}><Clock className="w-3 h-3" /> {d.estimatedMinutes || 0}m</span>
                      {Boolean(d.isRecurring) && <span className={ds.badge('neon-blue')}><RotateCcw className="w-3 h-3" /> Recurring</span>}
                    </div>
                    {Boolean(d.rotationOrder) && d.rotationOrder.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-500">Rotation: {d.rotationOrder.join(' -> ')}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 ml-7">
                    <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /></button>
                    <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  HOME MAINTENANCE TAB                                             */
  /* ================================================================ */
  const renderHomeMaintenance = () => {
    const seasonFiltered = maintenanceSeason === 'all'
      ? filtered
      : filtered.filter(i => (i.data as unknown as MaintenanceItem).season === maintenanceSeason);

    const roomGroups: Record<string, LensItem<ArtifactData>[]> = {};
    seasonFiltered.forEach(item => {
      const d = item.data as unknown as MaintenanceItem;
      const room = d.area || 'General';
      if (!roomGroups[room]) roomGroups[room] = [];
      roomGroups[room].push(item);
    });

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Home Maintenance</h3>
          <div className="flex items-center gap-2">
            <select className={cn(ds.select, 'w-auto')} value={maintenanceSeason} onChange={e => setMaintenanceSeason(e.target.value)}>
              <option value="all">All Seasons</option>
              {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add Item</button>
          </div>
        </div>

        {/* Seasonal Calendar */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Seasonal Calendar</h3>
          <div className={ds.grid4}>
            {SEASONS.filter(s => s !== 'Year-Round').map(season => {
              const SeasonIcon = getSeasonIcon(season);
              const count = (items as LensItem<ArtifactData>[]).filter(i =>
                (i.data as unknown as MaintenanceItem).season === season
              ).length;
              const overdueCount = (items as LensItem<ArtifactData>[]).filter(i => {
                const d = i.data as unknown as MaintenanceItem;
                return d.season === season && i.meta.status === 'overdue';
              }).length;
              return (
                <div key={season} className={cn(ds.panelHover, 'text-center')} onClick={() => setMaintenanceSeason(season)}>
                  <SeasonIcon className={cn('w-8 h-8 mx-auto mb-2', season === maintenanceSeason ? 'text-neon-cyan' : 'text-gray-400')} />
                  <p className="text-sm font-medium text-white">{season}</p>
                  <p className={ds.textMuted}>{count} task{count !== 1 ? 's' : ''}</p>
                  {overdueCount > 0 && <span className={ds.badge('red-400')}>{overdueCount} overdue</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Room-by-room checklist */}
        {Object.keys(roomGroups).length === 0 ? (
          <div className="text-center py-12">
            <Wrench className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className={ds.heading3}>No maintenance items</p>
            <p className={ds.textMuted}>Track HVAC filters, gutter cleaning, appliance warranties, and more.</p>
          </div>
        ) : (
          Object.entries(roomGroups).map(([room, roomItems]) => (
            <div key={room} className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
                <MapPin className="w-4 h-4 text-neon-cyan" /> {room}
                <span className={ds.badge('gray-400')}>{roomItems.length}</span>
              </h3>
              <div className="space-y-2">
                {roomItems.map(item => {
                  const d = item.data as unknown as MaintenanceItem;
                  const daysLeft = getDaysUntil(d.dueDate);
                  const warrantyDays = getDaysUntil(d.warrantyExpiry);
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">{item.title}</p>
                          {renderStatusBadge(item.meta.status as string)}
                          {d.priority === 'urgent' && <span className={ds.badge('red-400')}>Urgent</span>}
                          {d.priority === 'high' && <span className={ds.badge('yellow-400')}>High</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {Boolean(d.dueDate) && <span className={cn('text-xs', daysLeft <= 7 ? 'text-red-400' : 'text-gray-400')}>Due: {d.dueDate} ({daysLeft}d)</span>}
                          {Boolean(d.vendor) && <span className="text-xs text-gray-400">Vendor: {d.vendor}</span>}
                          {d.cost > 0 && <span className="text-xs text-gray-400">Est: {formatCurrency(d.cost)}</span>}
                        </div>
                        {Boolean(d.warrantyExpiry) && (
                          <div className="mt-1">
                            <span className={cn('text-xs', warrantyDays <= 30 ? 'text-yellow-400' : 'text-gray-500')}>
                              Warranty: {d.warrantyExpiry} {warrantyDays <= 30 && warrantyDays > 0 ? '(expiring soon!)' : warrantyDays <= 0 ? '(expired)' : ''}
                            </span>
                          </div>
                        )}
                        {Boolean(d.serviceHistory) && d.serviceHistory.length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Last service: {d.serviceHistory[d.serviceHistory.length - 1]}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /></button>
                        <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5" /></button>
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

  /* ================================================================ */
  /*  FAMILY CALENDAR TAB                                              */
  /* ================================================================ */
  const renderCalendar = () => {
    const weekDates = getCurrentWeekDates();

    const getMonthDays = () => {
      const now = new Date();
      now.setMonth(now.getMonth() + calendarOffset);
      const year = now.getFullYear();
      const month = now.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startPad = (firstDay.getDay() + 6) % 7;
      const days: { date: string; day: number; isCurrentMonth: boolean }[] = [];
      for (let i = startPad - 1; i >= 0; i--) {
        const d = new Date(year, month, -i);
        days.push({ date: d.toISOString().split('T')[0], day: d.getDate(), isCurrentMonth: false });
      }
      for (let d = 1; d <= lastDay.getDate(); d++) {
        const dt = new Date(year, month, d);
        days.push({ date: dt.toISOString().split('T')[0], day: d, isCurrentMonth: true });
      }
      const remaining = 42 - days.length;
      for (let d = 1; d <= remaining; d++) {
        const dt = new Date(year, month + 1, d);
        days.push({ date: dt.toISOString().split('T')[0], day: d, isCurrentMonth: false });
      }
      return { days, monthName: now.toLocaleString('default', { month: 'long', year: 'numeric' }) };
    };

    const eventsByDate: Record<string, LensItem<ArtifactData>[]> = {};
    (items as LensItem<ArtifactData>[]).forEach(ev => {
      const d = ev.data as unknown as CalendarEvent;
      if (d.date) {
        if (!eventsByDate[d.date]) eventsByDate[d.date] = [];
        eventsByDate[d.date].push(ev);
      }
    });

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-2">
            <button className={cn(calendarView === 'week' ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)} onClick={() => setCalendarView('week')}>Week</button>
            <button className={cn(calendarView === 'month' ? ds.btnPrimary : ds.btnSecondary, ds.btnSmall)} onClick={() => setCalendarView('month')}>Month</button>
          </div>
          <div className="flex items-center gap-2">
            <button className={ds.btnGhost} onClick={() => setCalendarOffset(p => p - 1)}><ChevronLeft className="w-4 h-4" /></button>
            <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => setCalendarOffset(0)}>Today</button>
            <button className={ds.btnGhost} onClick={() => setCalendarOffset(p => p + 1)}><ChevronRight className="w-4 h-4" /></button>
          </div>
          <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add Event</button>
        </div>

        {/* Color Legend for family members */}
        {familyItems.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {familyItems.map(m => {
              const d = m.data as unknown as FamilyMember;
              return (
                <div key={m.id} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color || '#3B82F6' }} />
                  <span className="text-xs text-gray-400">{d.name}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-400">Shared</span>
            </div>
          </div>
        )}

        {calendarView === 'month' ? (() => {
          const { days, monthName } = getMonthDays();
          return (
            <div>
              <h3 className={cn(ds.heading3, 'mb-3 text-center')}>{monthName}</h3>
              <div className="grid grid-cols-7 gap-1">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="p-2 text-center text-xs text-gray-500 font-medium">{d}</div>
                ))}
                {days.map((day, idx) => {
                  const dayEvents = eventsByDate[day.date] || [];
                  const isToday = day.date === new Date().toISOString().split('T')[0];
                  return (
                    <div key={idx} className={cn(
                      'p-1 min-h-[80px] rounded-lg border border-lattice-border bg-lattice-surface',
                      !day.isCurrentMonth && 'opacity-40',
                      isToday && 'border-neon-cyan/50 bg-neon-cyan/5',
                      'hover:border-neon-cyan/30 transition-colors cursor-pointer'
                    )} onClick={() => { setFormData({ date: day.date }); openNew(); }}>
                      <p className={cn('text-xs font-medium mb-1', isToday ? 'text-neon-cyan' : 'text-gray-400')}>{day.day}</p>
                      {dayEvents.slice(0, 3).map(ev => {
                        const evd = ev.data as unknown as CalendarEvent;
                        return (
                          <div key={ev.id} className="text-xs p-0.5 rounded mb-0.5 truncate cursor-pointer"
                            style={{ backgroundColor: `${evd.color || '#3B82F6'}20`, color: evd.color || '#3B82F6' }}
                            onClick={e => { e.stopPropagation(); openEdit(ev); }}>
                            {ev.title}
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && <p className="text-xs text-gray-500">+{dayEvents.length - 3}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : (
          <div>
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map(({ day, date }) => {
                const dayEvents = eventsByDate[date] || [];
                const isToday = date === new Date().toISOString().split('T')[0];
                return (
                  <div key={day} className={cn(
                    'rounded-lg border border-lattice-border bg-lattice-surface p-3 min-h-[200px]',
                    isToday && 'border-neon-cyan/50 bg-neon-cyan/5'
                  )}>
                    <p className={cn('text-sm font-medium mb-2', isToday ? 'text-neon-cyan' : 'text-white')}>{day.slice(0, 3)}</p>
                    <p className="text-xs text-gray-500 mb-3">{date.slice(5)}</p>
                    <div className="space-y-1.5">
                      {dayEvents.map(ev => {
                        const evd = ev.data as unknown as CalendarEvent;
                        return (
                          <div key={ev.id} className="p-1.5 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: `${evd.color || '#3B82F6'}20`, color: evd.color || '#3B82F6', borderLeft: `3px solid ${evd.color || '#3B82F6'}` }}
                            onClick={() => openEdit(ev)}>
                            <p className="font-medium truncate">{ev.title}</p>
                            {evd.time && <p className="opacity-70">{evd.time}</p>}
                            {evd.isShared && <span className="opacity-60">Shared</span>}
                          </div>
                        );
                      })}
                    </div>
                    <button className="mt-2 w-full p-1 rounded text-xs text-gray-500 hover:text-neon-cyan hover:bg-lattice-elevated transition-colors"
                      onClick={() => { setFormData({ date }); openNew(); }}>
                      <Plus className="w-3 h-3 mx-auto" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  BUDGET / EXPENSE TAB                                             */
  /* ================================================================ */
  const renderBudget = () => {
    const { byCategory, totalBudgeted, totalSpent } = monthlyBudget;
    const savingsItems = budgetItems.filter(i => (i.data as unknown as BudgetEntry).category === 'Savings');
    const incomeItems = budgetItems.filter(i => (i.data as unknown as BudgetEntry).entryType === 'income');
    const totalIncome = incomeItems.reduce((sum, i) => sum + ((i.data as unknown as BudgetEntry).amount || 0), 0);

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-2">
            <h3 className={ds.heading3}>Household Budget</h3>
            <input type="month" className={cn(ds.input, 'w-auto')} value={selectedBudgetMonth} onChange={e => setSelectedBudgetMonth(e.target.value)} />
          </div>
          <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add Entry</button>
        </div>

        {/* Budget Overview */}
        <div className={ds.grid3}>
          <div className={cn(ds.panel, 'border-l-4 border-l-green-400')}>
            <p className={ds.textMuted}>Total Income</p>
            <p className={cn(ds.heading2, 'text-green-400')}>{formatCurrency(totalIncome)}</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-red-400')}>
            <p className={ds.textMuted}>Total Spent</p>
            <p className={cn(ds.heading2, 'text-red-400')}>{formatCurrency(totalSpent)}</p>
            <p className="text-xs text-gray-500 mt-1">{formatCurrency(totalBudgeted)} budgeted</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-neon-cyan')}>
            <p className={ds.textMuted}>Remaining</p>
            <p className={cn(ds.heading2, totalIncome - totalBudgeted >= 0 ? 'text-neon-cyan' : 'text-red-400')}>
              {formatCurrency(totalIncome - totalBudgeted)}
            </p>
          </div>
        </div>

        {/* Spending by Category */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Spending by Category</h3>
          {Object.keys(byCategory).length === 0 ? (
            <p className={ds.textMuted}>No budget entries yet. Add expenses and income to track your budget.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCategory).sort((a, b) => b[1].budgeted - a[1].budgeted).map(([cat, data]) => (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-white">{cat}</span>
                    <span className="text-sm text-gray-400">{formatCurrency(data.spent)} / {formatCurrency(data.budgeted)}</span>
                  </div>
                  {renderProgressBar(data.spent, data.budgeted, data.spent > data.budgeted ? 'red-400' : 'green-400')}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bills Due */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><CreditCard className="w-5 h-5 text-yellow-400" /> Upcoming Bills</h3>
          <div className="space-y-2">
            {filtered.filter(i => {
              const d = i.data as unknown as BudgetEntry;
              return d.entryType !== 'income' && !d.isPaid;
            }).sort((a, b) => {
              const da = (a.data as unknown as BudgetEntry).dueDate || '';
              const db = (b.data as unknown as BudgetEntry).dueDate || '';
              return da.localeCompare(db);
            }).map(item => {
              const d = item.data as unknown as BudgetEntry;
              const daysLeft = getDaysUntil(d.dueDate);
              return (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{item.title}</p>
                      <span className={ds.badge('gray-400')}>{d.category}</span>
                      {Boolean(d.isRecurring) && <span className={ds.badge('neon-blue')}><RotateCcw className="w-3 h-3" /></span>}
                    </div>
                    <p className={ds.textMuted}>Due: {d.dueDate} {daysLeft >= 0 ? `(${daysLeft}d)` : '(overdue)'}</p>
                    {Boolean(d.splitAmong) && d.splitAmong.length > 1 && (
                      <p className="text-xs text-gray-500">Split: {d.splitAmong.join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{formatCurrency(d.amount)}</span>
                    <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => toggleBillPaid(item)}>
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    </button>
                    <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Savings Goals */}
        {savingsItems.length > 0 && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}><PiggyBank className="w-5 h-5 text-green-400" /> Savings Goals</h3>
            <div className={ds.grid2}>
              {savingsItems.map(item => {
                const d = item.data as unknown as BudgetEntry;
                return (
                  <div key={item.id} className="p-3 rounded-lg bg-lattice-elevated/50">
                    <p className="text-sm font-medium text-white mb-1">{item.title}</p>
                    <p className="text-lg font-bold text-green-400">{formatCurrency(d.amount)}</p>
                    {renderProgressBar(d.amount, d.amount * 1.5, 'green-400')}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  EMERGENCY INFO TAB                                               */
  /* ================================================================ */
  const renderEmergency = () => {
    const contacts = filtered.filter(i => (i.data as unknown as EmergencyContact).contactType === 'emergency' || !(i.data as unknown as EmergencyContact).contactType);
    const insurance = filtered.filter(i => (i.data as unknown as EmergencyContact).contactType === 'insurance');
    const utilities = filtered.filter(i => (i.data as unknown as EmergencyContact).contactType === 'utility');

    const subTabs = [
      { id: 'contacts' as const, label: 'Emergency Contacts', icon: Phone, count: contacts.length },
      { id: 'insurance' as const, label: 'Insurance', icon: Shield, count: insurance.length },
      { id: 'utilities' as const, label: 'Utilities', icon: Zap, count: utilities.length },
      { id: 'medical' as const, label: 'Medical Info', icon: Stethoscope, count: familyItems.length },
    ];

    const renderContactList = (contactList: LensItem<ArtifactData>[]) => (
      <div className="space-y-2">
        {contactList.length === 0 ? (
          <p className={ds.textMuted}>No entries yet. Add one to get started.</p>
        ) : contactList.map(item => {
          const d = item.data as unknown as EmergencyContact;
          return (
            <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50">
              <div>
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className={ds.textMuted}>{d.relationship}</p>
                {Boolean(d.phone) && <p className="text-sm text-neon-cyan">{d.phone}</p>}
                {Boolean(d.email) && <p className="text-xs text-gray-400">{d.email}</p>}
                {Boolean(d.policyNumber) && <p className={cn(ds.textMono, 'text-gray-400')}>Policy: {d.policyNumber}</p>}
                {Boolean(d.accountNumber) && <p className={cn(ds.textMono, 'text-gray-400')}>Account: {d.accountNumber}</p>}
                {Boolean(d.notes) && <p className="text-xs text-gray-500 mt-1">{d.notes}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /></button>
                <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>
    );

    return (
      <div className="space-y-6">
        {/* Emergency banner */}
        <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-3">
            <Siren className="w-8 h-8 text-red-400" />
            <div>
              <h3 className={ds.heading3}>Emergency Information</h3>
              <p className={ds.textMuted}>Critical contacts, medical info, and account numbers for your household.</p>
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-2 border-b border-lattice-border pb-3">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setEmergencySubTab(tab.id)}
                className={cn('flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm',
                  emergencySubTab === tab.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
                <Icon className="w-4 h-4" /> {tab.label}
                <span className={ds.badge('gray-400')}>{tab.count}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add</button>
        </div>

        {/* Content */}
        {emergencySubTab === 'contacts' && renderContactList(contacts)}
        {emergencySubTab === 'insurance' && renderContactList(insurance)}
        {emergencySubTab === 'utilities' && renderContactList(utilities)}
        {emergencySubTab === 'medical' && (
          <div className="space-y-4">
            {familyItems.length === 0 ? (
              <p className={ds.textMuted}>Add family members to track medical information.</p>
            ) : familyItems.map(m => {
              const d = m.data as unknown as FamilyMember;
              return (
                <div key={m.id} className={ds.panel}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${d.color || '#3B82F6'}30` }}>
                      <Users className="w-5 h-5" style={{ color: d.color || '#3B82F6' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{d.name}</p>
                      <p className={ds.textMuted}>{d.role}</p>
                    </div>
                  </div>
                  <div className={ds.grid3}>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Blood Type</p>
                      <p className="text-sm text-white">{d.bloodType || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Allergies</p>
                      <div className="flex flex-wrap gap-1">
                        {(d.allergies || []).length > 0 ? d.allergies.map(a => (
                          <span key={a} className={ds.badge('red-400')}>{a}</span>
                        )) : <span className="text-sm text-gray-500">None</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Medications</p>
                      <div className="flex flex-wrap gap-1">
                        {(d.medications || []).length > 0 ? d.medications.map(m => (
                          <span key={m} className={ds.badge('neon-blue')}><Pill className="w-3 h-3" /> {m}</span>
                        )) : <span className="text-sm text-gray-500">None</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pet medical info */}
            {petItems.length > 0 ? (
              <>
                <h3 className={cn(ds.heading3, 'flex items-center gap-2 mt-6')}><Dog className="w-5 h-5 text-orange-400" /> Pet Info</h3>
                {petItems.map(p => {
                  const d = p.data as unknown as Pet;
                  return (
                    <div key={p.id} className={ds.panel}>
                      <div className="flex items-center gap-3 mb-2">
                        <PawPrint className="w-5 h-5 text-orange-400" />
                        <div>
                          <p className="text-sm font-medium text-white">{d.name} ({d.species})</p>
                          <p className={ds.textMuted}>{d.breed} - {d.weight ? `${d.weight} lbs` : 'Weight not set'}</p>
                        </div>
                      </div>
                      <div className={ds.grid2}>
                        <div>
                          <p className="text-xs text-gray-500">Vet: {d.vetName || 'Not set'}</p>
                          {Boolean(d.vetPhone) && <p className="text-xs text-neon-cyan">{d.vetPhone}</p>}
                          <p className="text-xs text-gray-500">Next visit: {d.vetDate || 'Not scheduled'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Medications</p>
                          {(d.medications || []).length > 0 ? d.medications.map(m => (
                            <span key={m} className={cn(ds.badge('orange-400'), 'mr-1')}>{m}</span>
                          )) : <p className="text-xs text-gray-500">None</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                <p>No pets registered yet. Add your pets to track care schedules.</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  GENERIC LIBRARY VIEW (Family, Pets tabs)                         */
  /* ================================================================ */
  const renderLibrary = () => (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className={cn(ds.input, 'pl-10')} placeholder={`Search ${mode.toLowerCase()}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-gray-400" />
          <select className={cn(ds.select, 'w-auto')} value={statusFilter} onChange={e => setStatusFilter(e.target.value as Status | 'all')}>
            <option value="all">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <button className={ds.btnPrimary} onClick={() => openNew()}><Plus className="w-4 h-4" /> New {currentType}</button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-neon-cyan" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Heart className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.heading3}>No {currentType}s found</p>
          <p className={ds.textMuted}>Create one to get started.</p>
          <button className={cn(ds.btnPrimary, 'mt-4')} onClick={() => openNew()}><Plus className="w-4 h-4" /> Add {currentType}</button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map(item => {
            const d = item.data as unknown as Record<string, unknown>;
            return (
              <div key={item.id} className={ds.panelHover}>
                <div className={ds.sectionHeader}>
                  <h3 className={ds.heading3}>{item.title}</h3>
                  {renderStatusBadge(item.meta.status as string)}
                </div>
                <div className="mt-2 space-y-1">
                  {currentType === 'FamilyMember' && (
                    <>
                      <div className="flex items-center gap-2">
                        {Boolean(d.color) && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color as string }} />}
                        <p className={ds.textMuted}>Role: {d.role as string}</p>
                      </div>
                      <p className={ds.textMuted}>Birthday: {d.birthday as string}</p>
                      {Boolean(d.bloodType) && <p className={ds.textMuted}>Blood type: {d.bloodType as string}</p>}
                      {(d.allergies as string[])?.length > 0 && (
                        <div className="flex flex-wrap gap-1">{(d.allergies as string[]).map(a => <span key={a} className={ds.badge('red-400')}>{a}</span>)}</div>
                      )}
                      {(d.dietaryPrefs as string[])?.length > 0 && (
                        <div className="flex flex-wrap gap-1">{(d.dietaryPrefs as string[]).map(p => <span key={p} className={ds.badge('green-400')}>{p}</span>)}</div>
                      )}
                    </>
                  )}
                  {currentType === 'Pet' && (
                    <>
                      <p className={ds.textMuted}>{d.species as string} - {d.breed as string}</p>
                      <p className={ds.textMuted}>Next vet: {d.vetDate as string}</p>
                      <p className={ds.textMuted}>Food: {d.food as string}</p>
                      {Boolean(d.vetName) && <p className={ds.textMuted}>Vet: {d.vetName as string}</p>}
                      {Boolean(d.weight) && <p className={ds.textMuted}>Weight: {d.weight as number} lbs</p>}
                    </>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /> Edit</button>
                  <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  /* ================================================================ */
  /*  FORM FIELDS                                                      */
  /* ================================================================ */
  const renderFormFields = () => {
    switch (currentType) {
      case 'FamilyMember':
        return (
          <>
            <div><label className={ds.label}>Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Role</label><select className={ds.select} value={(formData.role as string) || ''} onChange={e => setFormData({ ...formData, role: e.target.value })}><option value="">Select...</option><option value="Parent">Parent</option><option value="Child">Child</option><option value="Grandparent">Grandparent</option><option value="Other">Other</option></select></div>
              <div><label className={ds.label}>Birthday</label><input type="date" className={ds.input} value={(formData.birthday as string) || ''} onChange={e => setFormData({ ...formData, birthday: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Blood Type</label><select className={ds.select} value={(formData.bloodType as string) || ''} onChange={e => setFormData({ ...formData, bloodType: e.target.value })}><option value="">Select...</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}</select></div>
              <div><label className={ds.label}>Color</label><div className="flex gap-2 mt-1">{FAMILY_COLORS.map(c => <button key={c} className={cn('w-6 h-6 rounded-full border-2 transition-all', formData.color === c ? 'border-white scale-110' : 'border-transparent')} style={{ backgroundColor: c }} onClick={() => setFormData({ ...formData, color: c })} />)}</div></div>
            </div>
            <div><label className={ds.label}>Allergies (comma-separated)</label><input className={ds.input} value={((formData.allergies as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, allergies: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Medications (comma-separated)</label><input className={ds.input} value={((formData.medications as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, medications: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Dietary Preferences (comma-separated)</label><input className={ds.input} value={((formData.dietaryPrefs as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, dietaryPrefs: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Vegetarian, Gluten-free, etc." /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={3} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'MealPlan':
        return (
          <>
            <div><label className={ds.label}>Meal Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Day</label><select className={ds.select} value={(formData.day as string) || ''} onChange={e => setFormData({ ...formData, day: e.target.value })}>{DAYS.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
              <div><label className={ds.label}>Meal Type</label><select className={ds.select} value={(formData.mealType as string) || ''} onChange={e => setFormData({ ...formData, mealType: e.target.value })}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Servings</label><input type="number" className={ds.input} value={(formData.servings as number) || ''} onChange={e => setFormData({ ...formData, servings: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Prep Time (min)</label><input type="number" className={ds.input} value={(formData.prepTime as number) || ''} onChange={e => setFormData({ ...formData, prepTime: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Recipe Link/Name</label><input className={ds.input} value={(formData.recipe as string) || ''} onChange={e => setFormData({ ...formData, recipe: e.target.value })} /></div>
            <div><label className={ds.label}>Assigned Cook</label><input className={ds.input} value={(formData.assignedCook as string) || ''} onChange={e => setFormData({ ...formData, assignedCook: e.target.value })} /></div>
            <div><label className={ds.label}>Dietary Tags (comma-separated)</label><input className={ds.input} value={((formData.dietaryTags as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, dietaryTags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Vegetarian, Gluten-free, etc." /></div>
            <div><label className={ds.label}>Ingredients (comma-separated)</label><textarea className={ds.textarea} rows={3} value={((formData.ingredients as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, ingredients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Chore':
        return (
          <>
            <div><label className={ds.label}>Chore Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Assignee</label><input className={ds.input} value={(formData.assignee as string) || ''} onChange={e => setFormData({ ...formData, assignee: e.target.value })} /></div>
              <div><label className={ds.label}>Room</label><input className={ds.input} value={(formData.room as string) || ''} onChange={e => setFormData({ ...formData, room: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Frequency</label><select className={ds.select} value={(formData.frequency as string) || 'weekly'} onChange={e => setFormData({ ...formData, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option></select></div>
              <div><label className={ds.label}>Est. Minutes</label><input type="number" className={ds.input} value={(formData.estimatedMinutes as number) || ''} onChange={e => setFormData({ ...formData, estimatedMinutes: parseInt(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Points</label><input type="number" className={ds.input} value={(formData.points as number) || ''} onChange={e => setFormData({ ...formData, points: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Rotation Order (comma-separated names)</label><input className={ds.input} value={((formData.rotationOrder as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, rotationOrder: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Alice, Bob, Charlie" /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isRecurring" checked={(formData.isRecurring as boolean) || false} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} />
              <label htmlFor="isRecurring" className={ds.label}>Recurring chore</label>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'MaintenanceItem':
        return (
          <>
            <div><label className={ds.label}>Item Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Area / Room</label><input className={ds.input} value={(formData.area as string) || ''} onChange={e => setFormData({ ...formData, area: e.target.value })} /></div>
              <div><label className={ds.label}>Priority</label><select className={ds.select} value={(formData.priority as string) || 'medium'} onChange={e => setFormData({ ...formData, priority: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Due Date</label><input type="date" className={ds.input} value={(formData.dueDate as string) || ''} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} /></div>
              <div><label className={ds.label}>Season</label><select className={ds.select} value={(formData.season as string) || ''} onChange={e => setFormData({ ...formData, season: e.target.value })}><option value="">Select...</option>{SEASONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Est. Cost ($)</label><input type="number" className={ds.input} value={(formData.cost as number) || ''} onChange={e => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Warranty Expiry</label><input type="date" className={ds.input} value={(formData.warrantyExpiry as string) || ''} onChange={e => setFormData({ ...formData, warrantyExpiry: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Vendor</label><input className={ds.input} value={(formData.vendor as string) || ''} onChange={e => setFormData({ ...formData, vendor: e.target.value })} /></div>
              <div><label className={ds.label}>Vendor Phone</label><input className={ds.input} value={(formData.vendorPhone as string) || ''} onChange={e => setFormData({ ...formData, vendorPhone: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Service History (comma-separated dates/notes)</label><input className={ds.input} value={((formData.serviceHistory as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, serviceHistory: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'CalendarEvent':
        return (
          <>
            <div><label className={ds.label}>Event Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(formData.date as string) || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
              <div><label className={ds.label}>End Date</label><input type="date" className={ds.input} value={(formData.endDate as string) || ''} onChange={e => setFormData({ ...formData, endDate: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Time</label><input type="time" className={ds.input} value={(formData.time as string) || ''} onChange={e => setFormData({ ...formData, time: e.target.value })} /></div>
              <div><label className={ds.label}>Assigned To</label><input className={ds.input} value={(formData.assignee as string) || ''} onChange={e => setFormData({ ...formData, assignee: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Location</label><input className={ds.input} value={(formData.location as string) || ''} onChange={e => setFormData({ ...formData, location: e.target.value })} /></div>
            <div><label className={ds.label}>Color</label><div className="flex gap-2 mt-1">{FAMILY_COLORS.map(c => <button key={c} className={cn('w-6 h-6 rounded-full border-2 transition-all', formData.color === c ? 'border-white scale-110' : 'border-transparent')} style={{ backgroundColor: c }} onClick={() => setFormData({ ...formData, color: c })} />)}</div></div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2"><input type="checkbox" id="isShared" checked={(formData.isShared as boolean) || false} onChange={e => setFormData({ ...formData, isShared: e.target.checked })} /><label htmlFor="isShared" className={ds.label}>Shared event</label></div>
              <div className="flex items-center gap-2"><input type="checkbox" id="isRecurringEv" checked={(formData.isRecurring as boolean) || false} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} /><label htmlFor="isRecurringEv" className={ds.label}>Recurring</label></div>
            </div>
            {formData.isRecurring && <div><label className={ds.label}>Recurrence Rule</label><select className={ds.select} value={(formData.recurrenceRule as string) || ''} onChange={e => setFormData({ ...formData, recurrenceRule: e.target.value })}><option value="">Select...</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>}
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'BudgetEntry':
        return (
          <>
            <div><label className={ds.label}>Entry Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Type</label><select className={ds.select} value={(formData.entryType as string) || 'expense'} onChange={e => setFormData({ ...formData, entryType: e.target.value })}><option value="expense">Expense</option><option value="income">Income</option></select></div>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })}><option value="">Select...</option>{BUDGET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Amount ($)</label><input type="number" className={ds.input} value={(formData.amount as number) || ''} onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Due Date</label><input type="date" className={ds.input} value={(formData.dueDate as string) || ''} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Split Among (comma-separated)</label><input className={ds.input} value={((formData.splitAmong as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, splitAmong: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Alice, Bob" /></div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2"><input type="checkbox" id="isRecurringBudget" checked={(formData.isRecurring as boolean) || false} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} /><label htmlFor="isRecurringBudget" className={ds.label}>Recurring</label></div>
              <div className="flex items-center gap-2"><input type="checkbox" id="isPaid" checked={(formData.isPaid as boolean) || false} onChange={e => setFormData({ ...formData, isPaid: e.target.checked })} /><label htmlFor="isPaid" className={ds.label}>Paid</label></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'EmergencyContact':
        return (
          <>
            <div><label className={ds.label}>Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Contact Type</label><select className={ds.select} value={(formData.contactType as string) || 'emergency'} onChange={e => setFormData({ ...formData, contactType: e.target.value })}><option value="emergency">Emergency Contact</option><option value="insurance">Insurance</option><option value="utility">Utility Account</option></select></div>
              <div><label className={ds.label}>Relationship</label><input className={ds.input} value={(formData.relationship as string) || ''} onChange={e => setFormData({ ...formData, relationship: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Phone</label><input className={ds.input} value={(formData.phone as string) || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
              <div><label className={ds.label}>Email</label><input className={ds.input} value={(formData.email as string) || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Policy / Account Number</label><input className={ds.input} value={(formData.policyNumber as string) || ''} onChange={e => setFormData({ ...formData, policyNumber: e.target.value })} /></div>
              <div><label className={ds.label}>Account Number</label><input className={ds.input} value={(formData.accountNumber as string) || ''} onChange={e => setFormData({ ...formData, accountNumber: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'Pet':
        return (
          <>
            <div><label className={ds.label}>Pet Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Species</label><select className={ds.select} value={(formData.species as string) || ''} onChange={e => setFormData({ ...formData, species: e.target.value })}><option value="">Select...</option><option value="Dog">Dog</option><option value="Cat">Cat</option><option value="Bird">Bird</option><option value="Fish">Fish</option><option value="Other">Other</option></select></div>
              <div><label className={ds.label}>Breed</label><input className={ds.input} value={(formData.breed as string) || ''} onChange={e => setFormData({ ...formData, breed: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Weight (lbs)</label><input type="number" className={ds.input} value={(formData.weight as number) || ''} onChange={e => setFormData({ ...formData, weight: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Food Brand</label><input className={ds.input} value={(formData.food as string) || ''} onChange={e => setFormData({ ...formData, food: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Vet Name</label><input className={ds.input} value={(formData.vetName as string) || ''} onChange={e => setFormData({ ...formData, vetName: e.target.value })} /></div>
              <div><label className={ds.label}>Vet Phone</label><input className={ds.input} value={(formData.vetPhone as string) || ''} onChange={e => setFormData({ ...formData, vetPhone: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Next Vet Date</label><input type="date" className={ds.input} value={(formData.vetDate as string) || ''} onChange={e => setFormData({ ...formData, vetDate: e.target.value })} /></div>
            <div><label className={ds.label}>Medications (comma-separated)</label><input className={ds.input} value={((formData.medications as string[]) || []).join(', ')} onChange={e => setFormData({ ...formData, medications: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={3} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  MAIN RENDER                                                      */
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
    <div data-lens-theme="household" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Home className="w-7 h-7 text-neon-cyan" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Home &amp; Family</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Complete household management &amp; family coordination</p>
          </div>
        </div>
      </header>


      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Rooms', value: maintenanceItems.length, icon: Home },
          { label: 'Chores Pending', value: choreItems.filter(c => c.meta?.status !== 'completed').length, icon: CheckSquare },
          { label: 'Bills Due', value: items.filter(i => (i.data as unknown as Record<string, unknown>).type === 'BudgetEntry' && i.meta?.status === 'planned').length, icon: CreditCard },
          { label: 'Family', value: familyItems.length, icon: Users },
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
      <UniversalActions domain="household" artifactId={familyItems[0]?.id} compact />
      <RealtimeDataPanel domain="household" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="household" data={{}} compact />
      {/* Mode tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setStatusFilter('all'); setSearchQuery(''); }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap text-sm',
                mode === tab.id
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.id}
            </button>
          );
        })}
      </nav>

      {/* Domain Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleAction('generateGroceryList')} className={cn(ds.btnSecondary, ds.btnSmall)}>
          <ShoppingCart className="w-4 h-4" /> Generate Grocery List
        </button>
        <button onClick={() => handleAction('rotateChores')} className={cn(ds.btnSecondary, ds.btnSmall)}>
          <RotateCcw className="w-4 h-4" /> Rotate Chores
        </button>
        <button onClick={() => handleAction('maintenanceCheck')} className={cn(ds.btnSecondary, ds.btnSmall)}>
          <ClipboardList className="w-4 h-4" /> Maintenance Check
        </button>
        <button onClick={() => handleAction('weeklySummary')} className={cn(ds.btnSecondary, ds.btnSmall)}>
          <FileText className="w-4 h-4" /> Weekly Summary
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
            {/* generateGroceryList */}
            {actionResult.uniqueItems !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.uniqueItems)}</p>
                    <p className="text-[10px] text-gray-500">Items Needed</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.mealsPlanned)}</p>
                    <p className="text-[10px] text-gray-500">Meals Planned</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.pantryItemsSubtracted)}</p>
                    <p className="text-[10px] text-gray-500">From Pantry</p>
                  </div>
                </div>
                {Array.isArray(actionResult.list) && (actionResult.list as {name:string;quantity:number;unit:string;category:string}[]).slice(0,6).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1 bg-lattice-surface rounded">
                    <span className="text-gray-300">{item.name}</span>
                    <span className="text-neon-cyan font-semibold">{item.quantity} {item.unit}</span>
                  </div>
                ))}
              </div>
            )}
            {/* maintenanceDue */}
            {actionResult.overdueCount !== undefined && actionResult.uniqueItems === undefined && (
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-red-400">{String(actionResult.overdueCount)}</p>
                  <p className="text-[10px] text-gray-500">Overdue</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-amber-400">{String(actionResult.upcomingCount)}</p>
                  <p className="text-[10px] text-gray-500">Upcoming</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-sm font-bold text-green-400">{String(actionResult.currentCount)}</p>
                  <p className="text-[10px] text-gray-500">Current</p>
                </div>
                {Array.isArray(actionResult.overdue) && (actionResult.overdue as {name:string;daysOverdue:number}[]).slice(0,3).map((item, i) => (
                  <div key={i} className="col-span-3 flex items-center justify-between p-2 bg-red-500/10 rounded">
                    <span className="text-xs text-white">{item.name}</span>
                    <span className="text-xs text-red-400">{item.daysOverdue}d overdue</span>
                  </div>
                ))}
              </div>
            )}
            {/* choreRotation */}
            {actionResult.assignments !== undefined && Array.isArray(actionResult.assignments) && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{String(actionResult.strategy)} &bull; {String(actionResult.totalChores)} chores &bull; {String(actionResult.members)} members</p>
                {(actionResult.assignments as {chore:string;assignee:string;frequency:string}[]).slice(0,6).map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1 bg-lattice-surface rounded">
                    <span className="text-gray-300">{a.chore}</span>
                    <span className="text-neon-cyan font-semibold">{a.assignee}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content */}
      {mode === 'Dashboard' && renderDashboard()}
      {mode === 'Meals' && renderMealPlanner()}
      {mode === 'Chores' && renderChoreSystem()}
      {mode === 'Home' && renderHomeMaintenance()}
      {mode === 'Calendar' && renderCalendar()}
      {mode === 'Budget' && renderBudget()}
      {mode === 'Emergency' && renderEmergency()}
      {(mode === 'Family' || mode === 'Pets') && renderLibrary()}

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
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input className={ds.input} value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Title..." />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>
                    <option value="planned">Planned</option>
                    <option value="active">Active</option>
                    <option value="overdue">Overdue</option>
                    <option value="completed">Completed</option>
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
            <LensFeaturePanel lensId="household" />
          </div>
        )}
      </div>
    </div>
  );
}
