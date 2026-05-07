'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  ChefHat, UtensilsCrossed, Warehouse, CalendarClock, FlaskConical, Clock,
  Plus, Search, Filter, X, Edit2, Trash2, Users, AlertTriangle, CheckCircle2,
  BarChart3, ArrowUpRight, Thermometer, Timer, ShoppingCart, Percent,
  TrendingUp, Flame, Leaf, Scale, DollarSign, ClipboardList, CalendarDays,
  Star, Puzzle, TrendingDown, Package, FileText, UserCheck, MapPin,
  ArrowDown, ArrowUp, Minus, Hash, CircleDot, Layers,
  RotateCcw, Zap, Target, PieChart, Armchair, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModeTab = 'recipes' | 'mealplan' | 'shopping' | 'nutrition' | 'pantry' | 'menu' | 'inventory' | 'bookings' | 'batches' | 'shifts';
type ArtifactType = 'Recipe' | 'MealPlan' | 'ShoppingItem' | 'PantryItem' | 'Menu' | 'InventoryItem' | 'Booking' | 'Batch' | 'Shift';
type Status = 'prep' | 'active' | '86d' | 'seasonal' | 'archived';
type MenuQuadrant = 'star' | 'puzzle' | 'plowhorse' | 'dog';
type WasteReason = 'expired' | 'spoiled' | 'overproduction' | 'dropped' | 'other';
type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

interface FoodArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  category: string;
  cost: number;
  price: number;
  notes: string;
  servings?: number;
  prepTime?: number;
  cookTime?: number;
  ingredients?: { item: string; qty: string; unit: string; cost: number }[];
  instructions?: string[];
  allergens?: string[];
  dietary?: string[];
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  section?: string;
  menuDate?: string;
  popularity?: number;
  salesVolume?: number;
  supplier?: string;
  currentStock?: number;
  parLevel?: number;
  unit?: string;
  expiryDate?: string;
  storageTemp?: string;
  fifoDate?: string;
  reorderQty?: number;
  guestName?: string;
  guestCount?: number;
  dateTime?: string;
  tableNumber?: string;
  specialRequests?: string;
  phone?: string;
  recipe?: string;
  batchSize?: number;
  startedAt?: string;
  completedAt?: string;
  yield?: number;
  employee?: string;
  role?: string;
  shiftStart?: string;
  shiftEnd?: string;
  station?: string;
  hourlyRate?: number;
  // Meal Plan fields
  day?: string;
  mealType?: string;
  recipeRef?: string;
  // Shopping List fields
  checked?: boolean;
  quantity?: number;
  shoppingUnit?: string;
  shoppingCategory?: string;
  // Pantry fields
  purchaseDate?: string;
  location?: string;
}

interface WasteEntry {
  id: string;
  item: string;
  qty: number;
  unit: string;
  reason: WasteReason;
  cost: number;
  date: string;
  notes: string;
}

interface TableInfo {
  id: number;
  seats: number;
  status: TableStatus;
  guestName: string;
  partySize: number;
  seatedAt: string;
  estimatedTurn: number;
}

interface WaitlistEntry {
  id: string;
  name: string;
  partySize: number;
  addedAt: string;
  estimatedWait: number;
  phone: string;
}

interface PrepItem {
  id: string;
  item: string;
  recipe: string;
  qty: number;
  unit: string;
  station: string;
  assignedTo: string;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_TABS: { id: ModeTab; label: string; icon: typeof ChefHat; artifactType: ArtifactType }[] = [
  { id: 'recipes', label: 'Recipes', icon: ChefHat, artifactType: 'Recipe' },
  { id: 'mealplan', label: 'Meal Plan', icon: CalendarDays, artifactType: 'MealPlan' },
  { id: 'shopping', label: 'Shopping', icon: ShoppingCart, artifactType: 'ShoppingItem' },
  { id: 'nutrition', label: 'Nutrition', icon: Flame, artifactType: 'Recipe' },
  { id: 'pantry', label: 'Pantry', icon: Package, artifactType: 'PantryItem' },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed, artifactType: 'Menu' },
  { id: 'inventory', label: 'Inventory', icon: Warehouse, artifactType: 'InventoryItem' },
  { id: 'bookings', label: 'Bookings', icon: CalendarClock, artifactType: 'Booking' },
  { id: 'batches', label: 'Batches', icon: FlaskConical, artifactType: 'Batch' },
  { id: 'shifts', label: 'Shifts', icon: Clock, artifactType: 'Shift' },
];

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  prep: { label: 'Prep', color: 'yellow-400' },
  active: { label: 'Active', color: 'green-400' },
  '86d': { label: '86\'d', color: 'red-400' },
  seasonal: { label: 'Seasonal', color: 'blue-400' },
  archived: { label: 'Archived', color: 'gray-400' },
};

const MENU_SECTIONS = ['Appetizers', 'Mains', 'Sides', 'Desserts', 'Beverages', 'Specials', 'Kids'];
const STATIONS = ['Grill', 'Saute', 'Cold/Garde Manger', 'Pastry', 'Prep', 'Expo', 'Dish', 'Bar', 'FOH'];
const ROLES = ['Head Chef', 'Sous Chef', 'Line Cook', 'Prep Cook', 'Pastry Chef', 'Bartender', 'Server', 'Host', 'Dishwasher', 'Manager'];
const SCALE_OPTIONS = [0.5, 1, 2, 3, 5, 10];
const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: 'expired', label: 'Expired' },
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'overproduction', label: 'Overproduction' },
  { value: 'dropped', label: 'Dropped/Damaged' },
  { value: 'other', label: 'Other' },
];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const SHOPPING_CATEGORIES = ['Produce', 'Dairy', 'Meat & Seafood', 'Bakery', 'Frozen', 'Canned', 'Dry Goods', 'Beverages', 'Condiments', 'Snacks', 'Other'];
const PANTRY_LOCATIONS = ['Refrigerator', 'Freezer', 'Pantry Shelf', 'Spice Rack', 'Counter', 'Root Cellar', 'Other'];

const seedData: { title: string; data: Record<string, unknown> }[] = [];

// ---------------------------------------------------------------------------
// Helper: generate initial tables
// ---------------------------------------------------------------------------
function generateTables(): TableInfo[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    seats: i < 4 ? 2 : i < 10 ? 4 : i < 16 ? 6 : 8,
    status: 'available' as TableStatus,
    guestName: '',
    partySize: 0,
    seatedAt: '',
    estimatedTurn: 0,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FoodLensPage() {
  useLensNav('food');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('food');

  const [activeTab, setActiveTab] = useState<ModeTab>('recipes');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<FoodArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Sub-views
  const [recipeScaleId, setRecipeScaleId] = useState<string | null>(null);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [showMenuMatrix, setShowMenuMatrix] = useState(false);
  const [showWasteLog, setShowWasteLog] = useState(false);
  const [showCountSheet, setShowCountSheet] = useState(false);
  const [showPrepList, setShowPrepList] = useState(false);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [showWeeklySchedule, setShowWeeklySchedule] = useState(false);
  const [showSupplierCompare, setShowSupplierCompare] = useState(false);

  // Waste log state
  const [wasteLog, setWasteLog] = useState<WasteEntry[]>([]);
  const [wasteItemName, setWasteItemName] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  const [wasteUnit, setWasteUnit] = useState('lb');
  const [wasteReason, setWasteReason] = useState<WasteReason>('expired');
  const [wasteCost, setWasteCost] = useState('');
  const [wasteNotes, setWasteNotes] = useState('');

  // Table management state
  const [tables, setTables] = useState<TableInfo[]>(generateTables);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistParty, setWaitlistParty] = useState('2');
  const [waitlistPhone, setWaitlistPhone] = useState('');

  // Prep list state
  const [prepItems, setPrepItems] = useState<PrepItem[]>([]);
  const [expectedCovers, setExpectedCovers] = useState('120');

  // Editor form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formCost, setFormCost] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('prep');
  const [formServings, setFormServings] = useState('1');
  const [formPrepTime, setFormPrepTime] = useState('');
  const [formCookTime, setFormCookTime] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formSection, setFormSection] = useState('Mains');
  const [formSupplier, setFormSupplier] = useState('');
  const [formCurrentStock, setFormCurrentStock] = useState('');
  const [formParLevel, setFormParLevel] = useState('');
  const [formUnit, setFormUnit] = useState('ea');
  const [formGuestName, setFormGuestName] = useState('');
  const [formGuestCount, setFormGuestCount] = useState('2');
  const [formDateTime, setFormDateTime] = useState('');
  const [formTableNumber, setFormTableNumber] = useState('');
  const [formEmployee, setFormEmployee] = useState('');
  const [formRole, setFormRole] = useState('Line Cook');
  const [formShiftStart, setFormShiftStart] = useState('');
  const [formShiftEnd, setFormShiftEnd] = useState('');
  const [formStation, setFormStation] = useState('Grill');
  const [formHourlyRate, setFormHourlyRate] = useState('15');
  const [formPopularity, setFormPopularity] = useState('50');
  const [formSalesVolume, setFormSalesVolume] = useState('0');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  // Labor tracking
  const [revenueTarget, setRevenueTarget] = useState('8000');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Recipe';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<FoodArtifact>('food', activeArtifactType, {
    seed: seedData.filter(s => (s.data as Record<string, unknown>).type === activeArtifactType),
  });

  // DTU context (v3.0 artifact support)
  const {
    contextDTUs: foodDTUs, hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'food' });

  const foodArtifacts = foodDTUs.filter((d: DTU) => d.artifact);

  // Additional hooks for cross-tab data
  const { items: allRecipes } = useLensData<FoodArtifact>('food', 'Recipe', { noSeed: true });
  const { items: mealPlanItems, create: createMealPlan, update: updateMealPlan, remove: removeMealPlan } = useLensData<FoodArtifact>('food', 'MealPlan', { noSeed: true });
  const { items: shoppingItems, create: createShoppingItem, update: updateShoppingItem, remove: removeShoppingItem } = useLensData<FoodArtifact>('food', 'ShoppingItem', { noSeed: true });
  const { items: pantryItems } = useLensData<FoodArtifact>('food', 'PantryItem', { noSeed: true });

  // Shopping list state
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const runAction = useRunArtifact('food');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.data as unknown as FoodArtifact).description?.toLowerCase().includes(q) ||
        (i.data as unknown as FoodArtifact).category?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      result = result.filter(i => (i.data as unknown as FoodArtifact).status === filterStatus);
    }
    return result;
  }, [items, searchQuery, filterStatus]);

  // ---------------------------------------------------------------------------
  // Editor helpers
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setEditingItem(null);
    setFormName(''); setFormDescription(''); setFormCategory(''); setFormCost(''); setFormPrice('');
    setFormStatus('prep'); setFormServings('1'); setFormPrepTime(''); setFormCookTime('');
    setFormNotes(''); setFormSection('Mains'); setFormSupplier(''); setFormCurrentStock('');
    setFormParLevel(''); setFormUnit('ea'); setFormGuestName(''); setFormGuestCount('2');
    setFormDateTime(''); setFormTableNumber(''); setFormEmployee(''); setFormRole('Line Cook');
    setFormShiftStart(''); setFormShiftEnd(''); setFormStation('Grill'); setFormHourlyRate('15');
    setFormPopularity('50'); setFormSalesVolume('0');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<FoodArtifact>) => {
    const d = item.data as unknown as FoodArtifact;
    setEditingItem(item);
    setFormName(d.name || item.title); setFormDescription(d.description || '');
    setFormCategory(d.category || ''); setFormCost(String(d.cost || ''));
    setFormPrice(String(d.price || '')); setFormStatus(d.status || 'prep');
    setFormServings(String(d.servings || '1')); setFormPrepTime(String(d.prepTime || ''));
    setFormCookTime(String(d.cookTime || '')); setFormNotes(d.notes || '');
    setFormSection(d.section || 'Mains'); setFormSupplier(d.supplier || '');
    setFormCurrentStock(String(d.currentStock || '')); setFormParLevel(String(d.parLevel || ''));
    setFormUnit(d.unit || 'ea'); setFormGuestName(d.guestName || '');
    setFormGuestCount(String(d.guestCount || '2')); setFormDateTime(d.dateTime || '');
    setFormTableNumber(d.tableNumber || ''); setFormEmployee(d.employee || '');
    setFormRole(d.role || 'Line Cook'); setFormShiftStart(d.shiftStart || '');
    setFormShiftEnd(d.shiftEnd || ''); setFormStation(d.station || 'Grill');
    setFormHourlyRate(String(d.hourlyRate || '15'));
    setFormPopularity(String(d.popularity || '50'));
    setFormSalesVolume(String(d.salesVolume || '0'));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const base: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, category: formCategory,
      cost: parseFloat(formCost) || 0, price: parseFloat(formPrice) || 0, notes: formNotes,
    };
    if (activeArtifactType === 'Recipe') {
      Object.assign(base, { servings: parseInt(formServings) || 1, prepTime: parseInt(formPrepTime) || 0, cookTime: parseInt(formCookTime) || 0, section: formSection, calories: parseFloat(formNotes.match(/cal:(\d+)/)?.[1] || '0') || 0 });
    } else if (activeArtifactType === 'MealPlan') {
      Object.assign(base, { day: formSection, mealType: formCategory, recipeRef: formNotes });
    } else if (activeArtifactType === 'ShoppingItem') {
      Object.assign(base, { shoppingCategory: formCategory, quantity: parseFloat(formCurrentStock) || 1, shoppingUnit: formUnit, checked: false });
    } else if (activeArtifactType === 'PantryItem') {
      Object.assign(base, { currentStock: parseFloat(formCurrentStock) || 0, unit: formUnit, expiryDate: formDateTime, location: formSupplier, purchaseDate: formShiftStart });
    } else if (activeArtifactType === 'Menu') {
      Object.assign(base, { section: formSection, popularity: parseInt(formPopularity) || 50, salesVolume: parseInt(formSalesVolume) || 0 });
    } else if (activeArtifactType === 'InventoryItem') {
      Object.assign(base, { supplier: formSupplier, currentStock: parseFloat(formCurrentStock) || 0, parLevel: parseFloat(formParLevel) || 0, unit: formUnit });
    } else if (activeArtifactType === 'Booking') {
      Object.assign(base, { guestName: formGuestName, guestCount: parseInt(formGuestCount) || 2, dateTime: formDateTime, tableNumber: formTableNumber });
    } else if (activeArtifactType === 'Shift') {
      Object.assign(base, { employee: formEmployee, role: formRole, shiftStart: formShiftStart, shiftEnd: formShiftEnd, station: formStation, hourlyRate: parseFloat(formHourlyRate) || 15 });
    }
    const payload = { title: formName, data: base as Partial<FoodArtifact>, meta: { status: formStatus, tags: [activeArtifactType, formCategory || formSection || ''] } };
    if (activeArtifactType === 'MealPlan') {
      if (editingItem) { await updateMealPlan(editingItem.id, payload); } else { await createMealPlan(payload); }
    } else {
      if (editingItem) { await update(editingItem.id, payload); } else { await create(payload); }
    }
    setEditorOpen(false);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingItem?.id || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Domain calculations
  // ---------------------------------------------------------------------------

  const costPlate = (item: LensItem<FoodArtifact>) => {
    const d = item.data as unknown as FoodArtifact;
    if (!d.ingredients) return { foodCost: d.cost, price: d.price, margin: 0 };
    const foodCost = d.ingredients.reduce((s, ing) => s + ing.cost, 0);
    const margin = d.price > 0 ? ((d.price - foodCost) / d.price) * 100 : 0;
    return { foodCost, price: d.price, margin };
  };

  const scaleIngredient = useCallback((qty: string, factor: number): string => {
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    const scaled = num * factor;
    return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(2);
  }, []);

  const getMenuQuadrant = (item: FoodArtifact): MenuQuadrant => {
    const foodCostPct = item.price > 0 ? (item.cost / item.price) * 100 : 100;
    const isHighProfit = foodCostPct < 30;
    const isHighPop = (item.popularity || 0) >= 50;
    if (isHighProfit && isHighPop) return 'star';
    if (isHighProfit && !isHighPop) return 'puzzle';
    if (!isHighProfit && isHighPop) return 'plowhorse';
    return 'dog';
  };

  const getQuadrantConfig = (q: MenuQuadrant) => {
    const configs: Record<MenuQuadrant, { label: string; color: string; icon: typeof Star; rec: string }> = {
      star: { label: 'Stars', color: 'yellow-400', icon: Star, rec: 'Promote heavily, maintain quality, premium placement' },
      puzzle: { label: 'Puzzles', color: 'purple-400', icon: Puzzle, rec: 'Increase visibility, reposition on menu, train upsell' },
      plowhorse: { label: 'Plowhorses', color: 'blue-400', icon: TrendingDown, rec: 'Re-engineer recipe to cut cost, reduce portion slightly' },
      dog: { label: 'Dogs', color: 'red-400', icon: Minus, rec: 'Consider removing, replace, or rebrand entirely' },
    };
    return configs[q];
  };

  const calcShiftHours = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    return Math.max(0, (e - s) / (1000 * 60 * 60));
  };

  const calcLaborCost = (hours: number, rate: number): number => hours * rate;

  const wasteTotal = useMemo(() => wasteLog.reduce((s, w) => s + w.cost, 0), [wasteLog]);

  // ---------------------------------------------------------------------------
  // Dashboard metrics
  // ---------------------------------------------------------------------------

  const dashboardMetrics = useMemo(() => {
    const allData = items.map(i => i.data as unknown as FoodArtifact);
    const totalRecipeCost = allData.filter(d => d.type === 'Recipe').reduce((s, d) => s + (d.cost || 0), 0);
    const totalRecipePrice = allData.filter(d => d.type === 'Recipe').reduce((s, d) => s + (d.price || 0), 0);
    const avgFoodCostPct = totalRecipePrice > 0 ? (totalRecipeCost / totalRecipePrice) * 100 : 0;
    const lowStockItems = allData.filter(d => d.type === 'InventoryItem' && d.currentStock !== undefined && d.parLevel !== undefined && d.currentStock < d.parLevel).length;
    const activeBookings = allData.filter(d => d.type === 'Booking' && d.status === 'active').length;
    const totalCovers = allData.filter(d => d.type === 'Booking' && d.status === 'active').reduce((s, d) => s + (d.guestCount || 0), 0);
    const eightyFixed = allData.filter(d => d.status === '86d').length;
    const byStatus: Record<string, number> = {};
    allData.forEach(d => { byStatus[d.status] = (byStatus[d.status] || 0) + 1; });

    // Revenue projection (covers * avg ticket)
    const avgTicket = 42;
    const revenueProjection = totalCovers * avgTicket;

    // Top/bottom sellers
    const menuItems = allData.filter(d => d.type === 'Menu' || d.type === 'Recipe');
    const sortedBySales = [...menuItems].sort((a, b) => (b.salesVolume || 0) - (a.salesVolume || 0));
    const topSellers = sortedBySales.slice(0, 3);
    const bottomSellers = sortedBySales.slice(-3).reverse();

    // Labor calculation
    const shifts = allData.filter(d => d.type === 'Shift');
    const totalLaborCost = shifts.reduce((s, d) => {
      const hours = calcShiftHours(d.shiftStart || '', d.shiftEnd || '');
      return s + calcLaborCost(hours, d.hourlyRate || 15);
    }, 0);
    const laborPct = revenueProjection > 0 ? (totalLaborCost / revenueProjection) * 100 : 0;

    return {
      avgFoodCostPct, lowStockItems, activeBookings, totalCovers, eightyFixed,
      byStatus, total: items.length, revenueProjection, topSellers, bottomSellers,
      totalLaborCost, laborPct, wasteTotal,
      wastePct: revenueProjection > 0 ? (wasteTotal / revenueProjection) * 100 : 0,
      forecastCovers: parseInt(expectedCovers) || 120,
    };
  }, [items, wasteTotal, expectedCovers]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderStatusBadge = (status: Status) => {
    const cfg = STATUS_CONFIG[status];
    return <span className={ds.badge(cfg.color)}>{cfg.label}</span>;
  };

  // ---------------------------------------------------------------------------
  // Recipe Scaler Modal
  // ---------------------------------------------------------------------------

  const renderRecipeScaler = () => {
    if (!recipeScaleId) return null;
    const item = items.find(i => i.id === recipeScaleId);
    if (!item) return null;
    const d = item.data as unknown as FoodArtifact;
    const baseServings = d.servings || 1;
    const scaledServings = Math.round(baseServings * scaleFactor);
    const ingredients = d.ingredients || [];
    const scaledCost = (d.cost || 0) * scaleFactor;

    return (
      <div className={ds.modalBackdrop} onClick={() => setRecipeScaleId(null)}>
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-lattice-border">
              <div>
                <h2 className={ds.heading2}>Recipe Scaler</h2>
                <p className={ds.textMuted}>{item.title}</p>
              </div>
              <button onClick={() => setRecipeScaleId(null)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              {/* Scale controls */}
              <div className={ds.panel}>
                <label className={cn(ds.label, 'mb-3')}>Scale Factor</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {SCALE_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => setScaleFactor(s)}
                      className={cn(
                        'px-4 py-2 rounded-lg font-medium transition-colors',
                        scaleFactor === s
                          ? 'bg-neon-blue text-white'
                          : 'bg-lattice-elevated text-gray-400 hover:text-white'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className={ds.panel}>
                    <p className={ds.textMuted}>Base Servings</p>
                    <p className="text-xl font-bold">{baseServings}</p>
                  </div>
                  <div className={ds.panel}>
                    <p className={ds.textMuted}>Scaled Servings</p>
                    <p className="text-xl font-bold text-neon-cyan">{scaledServings}</p>
                  </div>
                  <div className={ds.panel}>
                    <p className={ds.textMuted}>Yield Cost</p>
                    <p className="text-xl font-bold text-green-400">${scaledCost.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Scaled ingredients */}
              <div>
                <h3 className={cn(ds.heading3, 'mb-3')}>Scaled Ingredients</h3>
                {ingredients.length > 0 ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-3 text-xs text-gray-500 px-3">
                      <span>Ingredient</span><span>Original</span><span>Scaled</span><span>Cost</span>
                    </div>
                    {ingredients.map((ing, idx) => (
                      <div key={idx} className={cn(ds.panel, 'grid grid-cols-4 gap-3 items-center')}>
                        <span className="font-medium">{ing.item}</span>
                        <span className={ds.textMuted}>{ing.qty} {ing.unit}</span>
                        <span className="text-neon-cyan font-mono">{scaleIngredient(ing.qty, scaleFactor)} {ing.unit}</span>
                        <span className="text-green-400 font-mono">${(ing.cost * scaleFactor).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={ds.textMuted}>No ingredients listed. Add ingredients to the recipe to use the scaler.</p>
                )}
              </div>

              {/* Batch conversion reference */}
              <div className={ds.panel}>
                <h3 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
                  <RotateCcw className="w-4 h-4 text-purple-400" /> Batch Conversion
                </h3>
                <div className={ds.grid3}>
                  <div>
                    <p className={ds.textMuted}>Home (1x)</p>
                    <p className="font-mono">{baseServings} servings</p>
                  </div>
                  <div>
                    <p className={ds.textMuted}>Catering (5x)</p>
                    <p className="font-mono">{baseServings * 5} servings</p>
                  </div>
                  <div>
                    <p className={ds.textMuted}>Commercial (10x)</p>
                    <p className="font-mono">{baseServings * 10} servings</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
              <button onClick={() => handleAction('scale_recipe', recipeScaleId)} className={ds.btnPrimary}>
                <Zap className="w-4 h-4" /> Run AI Scale
              </button>
              <button onClick={() => setRecipeScaleId(null)} className={ds.btnSecondary}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Menu Engineering Matrix
  // ---------------------------------------------------------------------------

  const renderMenuMatrix = () => {
    if (!showMenuMatrix) return null;
    const menuItems = items.map(i => ({ item: i, data: i.data as unknown as FoodArtifact }));
    const quadrants: Record<MenuQuadrant, typeof menuItems> = { star: [], puzzle: [], plowhorse: [], dog: [] };
    menuItems.forEach(({ item, data }) => {
      quadrants[getMenuQuadrant(data)].push({ item, data });
    });

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <PieChart className="w-5 h-5 text-neon-cyan" /> Menu Engineering Matrix
          </h2>
          <button onClick={() => setShowMenuMatrix(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
        </div>

        <div className={ds.grid2}>
          {(['star', 'puzzle', 'plowhorse', 'dog'] as MenuQuadrant[]).map(q => {
            const cfg = getQuadrantConfig(q);
            const Icon = cfg.icon;
            return (
              <div key={q} className={ds.panel}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-5 h-5 text-${cfg.color}`} />
                  <h3 className={ds.heading3}>{cfg.label}</h3>
                  <span className={ds.badge(cfg.color)}>{quadrants[q].length}</span>
                </div>
                <p className={cn(ds.textMuted, 'mb-3 text-xs')}>{cfg.rec}</p>
                {quadrants[q].length === 0 ? (
                  <p className={ds.textMuted}>No items in this quadrant</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {quadrants[q].map(({ item, data }) => {
                      const foodCostPct = data.price > 0 ? (data.cost / data.price) * 100 : 0;
                      return (
                        <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer" onClick={() => openEdit(item)}>
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className={cn(ds.textMuted, 'text-xs')}>{data.section || data.category}</p>
                          </div>
                          <div className="text-right">
                            <p className={cn(ds.textMono, 'text-xs', foodCostPct < 30 ? 'text-green-400' : 'text-red-400')}>
                              {foodCostPct.toFixed(0)}% cost
                            </p>
                            <p className={cn(ds.textMuted, 'text-xs')}>Pop: {data.popularity || 0}%</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Waste Log
  // ---------------------------------------------------------------------------

  const addWasteEntry = () => {
    if (!wasteItemName) return;
    const entry: WasteEntry = {
      id: Date.now().toString(),
      item: wasteItemName,
      qty: parseFloat(wasteQty) || 0,
      unit: wasteUnit,
      reason: wasteReason,
      cost: parseFloat(wasteCost) || 0,
      date: new Date().toISOString().split('T')[0],
      notes: wasteNotes,
    };
    setWasteLog(prev => [entry, ...prev]);
    setWasteItemName(''); setWasteQty(''); setWasteCost(''); setWasteNotes('');
  };

  const renderWasteLog = () => {
    if (!showWasteLog) return null;
    const byReason: Record<string, number> = {};
    wasteLog.forEach(w => { byReason[w.reason] = (byReason[w.reason] || 0) + w.cost; });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <Trash2 className="w-5 h-5 text-red-400" /> Waste Log
          </h2>
          <button onClick={() => setShowWasteLog(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
        </div>

        {/* Waste summary */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Total Waste Cost</p>
            <p className="text-2xl font-bold text-red-400">${wasteTotal.toFixed(2)}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Entries This Week</p>
            <p className="text-2xl font-bold">{wasteLog.length}</p>
          </div>
          {WASTE_REASONS.slice(0, 2).map(wr => (
            <div key={wr.value} className={ds.panel}>
              <p className={ds.textMuted}>{wr.label}</p>
              <p className="text-2xl font-bold text-orange-400">${(byReason[wr.value] || 0).toFixed(2)}</p>
            </div>
          ))}
        </div>

        {/* Add waste entry */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Log Waste</h3>
          <div className={ds.grid4}>
            <div>
              <label className={ds.label}>Item</label>
              <input value={wasteItemName} onChange={e => setWasteItemName(e.target.value)} className={ds.input} placeholder="Item name" />
            </div>
            <div>
              <label className={ds.label}>Qty</label>
              <div className="flex gap-1">
                <input type="number" value={wasteQty} onChange={e => setWasteQty(e.target.value)} className={cn(ds.input, 'flex-1')} placeholder="0" />
                <select value={wasteUnit} onChange={e => setWasteUnit(e.target.value)} className={cn(ds.select, 'w-20')}>
                  {['lb', 'kg', 'oz', 'g', 'ea', 'gal', 'L', 'qt', 'pt'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={ds.label}>Reason</label>
              <select value={wasteReason} onChange={e => setWasteReason(e.target.value as WasteReason)} className={ds.select}>
                {WASTE_REASONS.map(wr => <option key={wr.value} value={wr.value}>{wr.label}</option>)}
              </select>
            </div>
            <div>
              <label className={ds.label}>Cost ($)</label>
              <input type="number" value={wasteCost} onChange={e => setWasteCost(e.target.value)} className={ds.input} placeholder="0.00" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <input value={wasteNotes} onChange={e => setWasteNotes(e.target.value)} className={cn(ds.input, 'flex-1')} placeholder="Notes..." />
            <button onClick={addWasteEntry} className={ds.btnDanger}><Plus className="w-4 h-4" /> Log</button>
          </div>
        </div>

        {/* Waste list */}
        <div className="space-y-2">
          {wasteLog.map(entry => (
            <div key={entry.id} className={cn(ds.panel, 'flex items-center justify-between')}>
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-medium">{entry.item}</p>
                  <p className={ds.textMuted}>{entry.qty} {entry.unit} - {entry.date}</p>
                </div>
                <span className={ds.badge(entry.reason === 'expired' ? 'red-400' : entry.reason === 'spoiled' ? 'orange-400' : 'yellow-400')}>
                  {entry.reason}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-red-400 font-mono font-bold">${entry.cost.toFixed(2)}</span>
                <button onClick={() => setWasteLog(prev => prev.filter(w => w.id !== entry.id))} className={cn(ds.btnSmall, 'text-red-400')}><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Count Sheet
  // ---------------------------------------------------------------------------

  const renderCountSheet = () => {
    if (!showCountSheet) return null;
    const invItems = items.map(i => ({ item: i, data: i.data as unknown as FoodArtifact }));

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <ClipboardList className="w-5 h-5 text-cyan-400" /> Inventory Count Sheet
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => handleAction('generate_po')} className={ds.btnPrimary}><FileText className="w-4 h-4" /> Generate PO</button>
            <button onClick={() => setShowCountSheet(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
          </div>
        </div>

        <div className={ds.panel}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border text-gray-400">
                  <th className="text-left py-2 px-3">Item</th>
                  <th className="text-left py-2 px-3">Supplier</th>
                  <th className="text-right py-2 px-3">Par Level</th>
                  <th className="text-right py-2 px-3">On Hand</th>
                  <th className="text-right py-2 px-3">Unit</th>
                  <th className="text-right py-2 px-3">Variance</th>
                  <th className="text-center py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invItems.map(({ item, data }) => {
                  const variance = (data.currentStock || 0) - (data.parLevel || 0);
                  const needsReorder = variance < 0;
                  return (
                    <tr key={item.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30">
                      <td className="py-2 px-3 font-medium">{item.title}</td>
                      <td className="py-2 px-3 text-gray-400">{data.supplier || '-'}</td>
                      <td className="py-2 px-3 text-right font-mono">{data.parLevel || 0}</td>
                      <td className="py-2 px-3 text-right font-mono">{data.currentStock || 0}</td>
                      <td className="py-2 px-3 text-right text-gray-400">{data.unit || 'ea'}</td>
                      <td className={cn('py-2 px-3 text-right font-mono font-bold', needsReorder ? 'text-red-400' : 'text-green-400')}>
                        {variance >= 0 ? '+' : ''}{variance}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {needsReorder ? (
                          <span className={ds.badge('red-400')}>Reorder</span>
                        ) : (
                          <span className={ds.badge('green-400')}>OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {invItems.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500">No inventory items. Add items to start counting.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Supplier Price Comparison
  // ---------------------------------------------------------------------------

  const renderSupplierCompare = () => {
    if (!showSupplierCompare) return null;
    const invItems = items.map(i => ({ item: i, data: i.data as unknown as FoodArtifact }));
    const suppliers = [...new Set(invItems.map(({ data }) => data.supplier).filter(Boolean))];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <DollarSign className="w-5 h-5 text-green-400" /> Supplier Price Comparison
          </h2>
          <button onClick={() => setShowSupplierCompare(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
        </div>
        {suppliers.length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-8')}>
            <p className={ds.textMuted}>No suppliers found. Add supplier info to inventory items.</p>
          </div>
        ) : (
          <div className={ds.grid2}>
            {suppliers.map(sup => {
              const supplierItems = invItems.filter(({ data }) => data.supplier === sup);
              const totalCost = supplierItems.reduce((s, { data }) => s + (data.cost || 0), 0);
              return (
                <div key={sup} className={ds.panel}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={ds.heading3}>{sup}</h3>
                    <span className={cn(ds.textMono, 'text-green-400')}>${totalCost.toFixed(2)} total</span>
                  </div>
                  <div className="space-y-1">
                    {supplierItems.map(({ item, data }) => (
                      <div key={item.id} className="flex items-center justify-between text-sm py-1">
                        <span className="text-gray-300">{item.title}</span>
                        <span className="font-mono text-gray-400">${(data.cost || 0).toFixed(2)}/{data.unit || 'ea'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Prep List Generator
  // ---------------------------------------------------------------------------

  const togglePrepComplete = (id: string) => {
    setPrepItems(prev => prev.map(p => p.id === id ? { ...p, completed: !p.completed } : p));
  };

  const renderPrepList = () => {
    if (!showPrepList) return null;
    const completedCount = prepItems.filter(p => p.completed).length;
    const stationGroups: Record<string, PrepItem[]> = {};
    prepItems.forEach(p => {
      if (!stationGroups[p.station]) stationGroups[p.station] = [];
      stationGroups[p.station].push(p);
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <ClipboardList className="w-5 h-5 text-green-400" /> Prep List
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <label className={ds.label}>Expected Covers:</label>
              <input type="number" value={expectedCovers} onChange={e => setExpectedCovers(e.target.value)} className={cn(ds.input, 'w-24')} />
            </div>
            <button onClick={() => handleAction('generate_prep_list')} className={ds.btnPrimary}><Zap className="w-4 h-4" /> Auto-Generate</button>
            <button onClick={() => setShowPrepList(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
          </div>
        </div>

        {/* Progress bar */}
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <span className={ds.textMuted}>Progress</span>
            <span className={ds.textMono}>{completedCount}/{prepItems.length} complete</span>
          </div>
          <div className="h-3 bg-lattice-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-green-400 rounded-full transition-all"
              style={{ width: `${prepItems.length > 0 ? (completedCount / prepItems.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* By station */}
        {Object.entries(stationGroups).map(([station, stationItems]) => (
          <div key={station} className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <MapPin className="w-4 h-4 text-cyan-400" /> {station}
              <span className={ds.badge('cyan-400')}>{stationItems.length}</span>
            </h3>
            <div className="space-y-2">
              {stationItems.map(p => (
                <div key={p.id} className={cn('flex items-center gap-3 p-3 rounded-lg', p.completed ? 'bg-green-400/10' : 'bg-lattice-elevated/50')}>
                  <button onClick={() => togglePrepComplete(p.id)} className={cn('w-5 h-5 rounded border flex items-center justify-center', p.completed ? 'bg-green-400 border-green-400' : 'border-gray-600')}>
                    {p.completed && <CheckCircle2 className="w-3 h-3 text-black" />}
                  </button>
                  <div className="flex-1">
                    <p className={cn('font-medium', p.completed && 'line-through text-gray-500')}>{p.item}</p>
                    <p className={ds.textMuted}>{p.recipe} - {p.qty} {p.unit}</p>
                  </div>
                  <span className={ds.textMuted}>{p.assignedTo || 'Unassigned'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Floor Plan / Table Management
  // ---------------------------------------------------------------------------

  const seatTable = (tableId: number) => {
    setTables(prev => prev.map(t => t.id === tableId ? {
      ...t, status: 'occupied' as TableStatus, seatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      estimatedTurn: 75,
    } : t));
  };

  const clearTable = (tableId: number) => {
    setTables(prev => prev.map(t => t.id === tableId ? {
      ...t, status: 'available' as TableStatus, guestName: '', partySize: 0, seatedAt: '', estimatedTurn: 0,
    } : t));
  };

  const addToWaitlist = () => {
    if (!waitlistName) return;
    setWaitlist(prev => [...prev, {
      id: Date.now().toString(), name: waitlistName, partySize: parseInt(waitlistParty) || 2,
      addedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      estimatedWait: (prev.length + 1) * 12, phone: waitlistPhone,
    }]);
    setWaitlistName(''); setWaitlistParty('2'); setWaitlistPhone('');
  };

  const renderFloorPlan = () => {
    if (!showFloorPlan) return null;
    const available = tables.filter(t => t.status === 'available').length;
    const occupied = tables.filter(t => t.status === 'occupied').length;
    const totalSeats = tables.reduce((s, t) => s + t.seats, 0);
    const occupiedSeats = tables.filter(t => t.status === 'occupied').reduce((s, t) => s + t.seats, 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <Armchair className="w-5 h-5 text-blue-400" /> Floor Plan & Tables
          </h2>
          <button onClick={() => setShowFloorPlan(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
        </div>

        {/* Summary */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Available</p>
            <p className="text-2xl font-bold text-green-400">{available}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Occupied</p>
            <p className="text-2xl font-bold text-orange-400">{occupied}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Seat Capacity</p>
            <p className="text-2xl font-bold">{occupiedSeats}/{totalSeats}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Waitlist</p>
            <p className="text-2xl font-bold text-purple-400">{waitlist.length}</p>
          </div>
        </div>

        {/* Table grid */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Tables</h3>
          <div className="grid grid-cols-5 md:grid-cols-10 gap-3">
            {tables.map(table => (
              <button
                key={table.id}
                onClick={() => table.status === 'available' ? seatTable(table.id) : clearTable(table.id)}
                className={cn(
                  'aspect-square rounded-lg flex flex-col items-center justify-center border transition-colors text-xs',
                  table.status === 'available' && 'bg-green-400/10 border-green-400/30 hover:bg-green-400/20 text-green-400',
                  table.status === 'occupied' && 'bg-red-400/10 border-red-400/30 hover:bg-red-400/20 text-red-400',
                  table.status === 'reserved' && 'bg-blue-400/10 border-blue-400/30 text-blue-400',
                  table.status === 'cleaning' && 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400',
                )}
              >
                <Hash className="w-3 h-3 mb-0.5" />
                <span className="font-bold">{table.id}</span>
                <span className="text-[10px]">{table.seats}s</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-green-400" /> Available</span>
            <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-red-400" /> Occupied</span>
            <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-blue-400" /> Reserved</span>
            <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-yellow-400" /> Cleaning</span>
          </div>
        </div>

        {/* Waitlist */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Waitlist</h3>
          <div className="flex items-center gap-3 mb-3">
            <input value={waitlistName} onChange={e => setWaitlistName(e.target.value)} className={cn(ds.input, 'flex-1')} placeholder="Guest name" />
            <input type="number" value={waitlistParty} onChange={e => setWaitlistParty(e.target.value)} className={cn(ds.input, 'w-20')} placeholder="Size" />
            <input value={waitlistPhone} onChange={e => setWaitlistPhone(e.target.value)} className={cn(ds.input, 'w-32')} placeholder="Phone" />
            <button onClick={addToWaitlist} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Add</button>
          </div>
          <div className="space-y-2">
            {waitlist.map((w, idx) => (
              <div key={w.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-gray-500">#{idx + 1}</span>
                  <div>
                    <p className="font-medium">{w.name}</p>
                    <p className={ds.textMuted}>Party of {w.partySize} - Added {w.addedAt}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={ds.badge('purple-400')}>~{w.estimatedWait}min</span>
                  <button onClick={() => setWaitlist(prev => prev.filter(x => x.id !== w.id))} className={cn(ds.btnSmall, 'text-red-400')}><X className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
            {waitlist.length === 0 && <p className={ds.textMuted}>No one on the waitlist.</p>}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Weekly Labor Schedule
  // ---------------------------------------------------------------------------

  const renderWeeklySchedule = () => {
    if (!showWeeklySchedule) return null;
    const shifts = items.map(i => ({ item: i, data: i.data as unknown as FoodArtifact }));
    const employees = [...new Set(shifts.map(({ data }) => data.employee).filter(Boolean))];
    const totalHours = shifts.reduce((s, { data }) => s + calcShiftHours(data.shiftStart || '', data.shiftEnd || ''), 0);
    const totalLabor = shifts.reduce((s, { data }) => {
      const hrs = calcShiftHours(data.shiftStart || '', data.shiftEnd || '');
      return s + calcLaborCost(hrs, data.hourlyRate || 15);
    }, 0);
    const rev = parseFloat(revenueTarget) || 8000;
    const laborPctCalc = rev > 0 ? (totalLabor / rev) * 100 : 0;
    const overtimeThreshold = 40;

    // Coverage by station
    const stationCoverage: Record<string, number> = {};
    shifts.forEach(({ data }) => {
      if (data.station) {
        stationCoverage[data.station] = (stationCoverage[data.station] || 0) + 1;
      }
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <CalendarDays className="w-5 h-5 text-purple-400" /> Labor Schedule
          </h2>
          <div className="flex items-center gap-2">
            <label className={ds.label}>Weekly Revenue Target: $</label>
            <input type="number" value={revenueTarget} onChange={e => setRevenueTarget(e.target.value)} className={cn(ds.input, 'w-28')} />
            <button onClick={() => setShowWeeklySchedule(false)} className={ds.btnGhost}><X className="w-4 h-4" /> Close</button>
          </div>
        </div>

        {/* Labor KPIs */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Total Hours</p>
            <p className="text-2xl font-bold">{totalHours.toFixed(1)}h</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Labor Cost</p>
            <p className="text-2xl font-bold text-green-400">${totalLabor.toFixed(2)}</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Labor % of Revenue</p>
            <p className={cn('text-2xl font-bold', laborPctCalc <= 30 ? 'text-green-400' : laborPctCalc <= 35 ? 'text-yellow-400' : 'text-red-400')}>
              {laborPctCalc.toFixed(1)}%
            </p>
            <p className={ds.textMuted}>Target: under 30%</p>
          </div>
          <div className={ds.panel}>
            <p className={ds.textMuted}>Employees Scheduled</p>
            <p className="text-2xl font-bold">{employees.length}</p>
          </div>
        </div>

        {/* Station coverage */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Station Coverage</h3>
          <div className={ds.grid4}>
            {STATIONS.map(st => (
              <div key={st} className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50">
                <span className="text-sm">{st}</span>
                <span className={cn(ds.badge((stationCoverage[st] || 0) >= 2 ? 'green-400' : (stationCoverage[st] || 0) === 1 ? 'yellow-400' : 'red-400'))}>
                  {stationCoverage[st] || 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Employee schedule rows */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Schedule by Employee</h3>
          {employees.length === 0 ? (
            <p className={ds.textMuted}>No shifts scheduled. Create shifts to see the schedule.</p>
          ) : (
            <div className="space-y-3">
              {employees.map(emp => {
                const empShifts = shifts.filter(({ data }) => data.employee === emp);
                const empHours = empShifts.reduce((s, { data }) => s + calcShiftHours(data.shiftStart || '', data.shiftEnd || ''), 0);
                const isOvertime = empHours > overtimeThreshold;
                return (
                  <div key={emp} className={cn('p-3 rounded-lg', isOvertime ? 'bg-red-400/10 border border-red-400/30' : 'bg-lattice-elevated/50')}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-cyan-400" />
                        <span className="font-medium">{emp}</span>
                        {isOvertime && <span className={ds.badge('red-400')}>OT</span>}
                      </div>
                      <span className={cn(ds.textMono, isOvertime ? 'text-red-400' : 'text-gray-400')}>{empHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {empShifts.map(({ item, data }) => {
                        const startTime = data.shiftStart ? data.shiftStart.slice(11, 16) : '??';
                        const endTime = data.shiftEnd ? data.shiftEnd.slice(11, 16) : '??';
                        return (
                          <span key={item.id} className={cn(ds.badge('blue-400'), 'cursor-pointer')} onClick={() => openEdit(item)}>
                            {startTime}-{endTime} @ {data.station}
                          </span>
                        );
                      })}
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
  // Library (item list)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Meal Planner (Mon-Sun, breakfast/lunch/dinner grid)
  // ---------------------------------------------------------------------------

  const getCurrentWeekDates = (): { day: string; date: string }[] => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return DAYS_OF_WEEK.map((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { day, date: d.toISOString().split('T')[0] };
    });
  };

  const renderMealPlanner = () => {
    const weekDates = getCurrentWeekDates();
    const mealsByDayType: Record<string, Record<string, LensItem<FoodArtifact>[]>> = {};
    DAYS_OF_WEEK.forEach(day => {
      mealsByDayType[day] = {};
      MEAL_TYPES.forEach(mt => { mealsByDayType[day][mt] = []; });
    });
    mealPlanItems.forEach(item => {
      const d = item.data as unknown as FoodArtifact;
      if (d.day && d.mealType && mealsByDayType[d.day]) {
        const mt = d.mealType.charAt(0).toUpperCase() + d.mealType.slice(1);
        if (mealsByDayType[d.day][mt]) mealsByDayType[d.day][mt].push(item);
      }
    });

    const addMealQuick = (day: string, mealType: string) => {
      setFormSection(day);
      setFormCategory(mealType.toLowerCase());
      openCreate();
    };

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <CalendarDays className="w-5 h-5 text-neon-cyan" /> Weekly Meal Plan
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => handleAction('suggest_meals')} className={ds.btnSecondary}>
              <Zap className="w-4 h-4" /> AI Suggest
            </button>
            <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Add Meal</button>
          </div>
        </div>

        {/* Weekly Grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-8 gap-1 mb-1">
              <div className="p-2" />
              {DAYS_OF_WEEK.map((day, i) => (
                <div key={day} className="p-2 text-center">
                  <p className="text-sm font-medium text-white">{day.slice(0, 3)}</p>
                  <p className={ds.textMuted}>{weekDates[i]?.date.slice(5) || ''}</p>
                </div>
              ))}
            </div>
            {MEAL_TYPES.slice(0, 3).map(mealType => (
              <div key={mealType} className="grid grid-cols-8 gap-1 mb-1">
                <div className="p-2 flex items-center">
                  <span className="text-sm text-gray-400">{mealType}</span>
                </div>
                {DAYS_OF_WEEK.map(day => {
                  const meals = mealsByDayType[day]?.[mealType] || [];
                  return (
                    <div key={`${day}-${mealType}`}
                      className={cn('p-2 rounded-lg border border-lattice-border bg-lattice-surface min-h-[70px]',
                        'hover:border-neon-cyan/30 transition-colors cursor-pointer')}
                      onClick={() => addMealQuick(day, mealType)}>
                      {meals.length > 0 ? meals.map(m => {
                        const md = m.data as unknown as FoodArtifact;
                        return (
                          <div key={m.id} className="group/meal flex items-center gap-1 text-xs p-1.5 rounded bg-neon-cyan/10 text-neon-cyan mb-1"
                            onClick={e => { e.stopPropagation(); openEdit(m); }}>
                            <span className="truncate flex-1">{m.title}</span>
                            {md.calories ? <span className="text-gray-500">{md.calories}cal</span> : null}
                            <button
                              className="opacity-0 group-hover/meal:opacity-100 text-red-400 hover:text-red-300 transition-opacity flex-shrink-0"
                              onClick={e => { e.stopPropagation(); removeMealPlan(m.id); }}
                              title="Remove meal"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      }) : (
                        <Plus className="w-3 h-3 text-gray-600 mx-auto mt-4" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Daily totals */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Daily Nutrition Totals</h3>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-8 gap-2 min-w-[700px]">
              <div className="text-sm text-gray-500" />
              {DAYS_OF_WEEK.map(day => {
                let totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
                MEAL_TYPES.forEach(mt => {
                  (mealsByDayType[day]?.[mt] || []).forEach(m => {
                    const md = m.data as unknown as FoodArtifact;
                    totalCal += md.calories || 0;
                    totalProtein += md.protein || 0;
                    totalCarbs += md.carbs || 0;
                    totalFat += md.fat || 0;
                  });
                });
                return (
                  <div key={day} className="text-center text-xs space-y-1">
                    <p className="font-medium text-white">{day.slice(0, 3)}</p>
                    <p className="text-orange-400">{totalCal} cal</p>
                    <p className="text-blue-400">{totalProtein}g P</p>
                    <p className="text-yellow-400">{totalCarbs}g C</p>
                    <p className="text-red-400">{totalFat}g F</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Generate shopping list from meal plan */}
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}><ShoppingCart className="w-5 h-5 text-green-400" /> Generate Shopping List</h3>
            <button onClick={async () => {
              const ingredients = new Map<string, { qty: number; unit: string }>();
              mealPlanItems.forEach(item => {
                const d = item.data as unknown as FoodArtifact;
                if (d.recipeRef) {
                  const recipe = allRecipes.find(r => r.title === d.recipeRef);
                  if (recipe) {
                    const rd = recipe.data as unknown as FoodArtifact;
                    (rd.ingredients || []).forEach(ing => {
                      const existing = ingredients.get(ing.item);
                      if (existing) {
                        existing.qty += parseFloat(ing.qty) || 1;
                      } else {
                        ingredients.set(ing.item, { qty: parseFloat(ing.qty) || 1, unit: ing.unit });
                      }
                    });
                  }
                }
              });
              for (const [name, info] of ingredients) {
                const existing = shoppingItems.find(s => s.title === name);
                if (!existing) {
                  await createShoppingItem({
                    title: name,
                    data: { name, type: 'ShoppingItem', status: 'active', quantity: info.qty, shoppingUnit: info.unit, checked: false } as unknown as Partial<FoodArtifact>,
                    meta: { status: 'active' },
                  });
                }
              }
            }} className={ds.btnPrimary}>
              <ShoppingCart className="w-4 h-4" /> Auto-Generate from Meals
            </button>
          </div>
          <p className={cn(ds.textMuted, 'mt-2')}>Generates a shopping list from all meal plan recipes and their ingredients.</p>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Shopping List
  // ---------------------------------------------------------------------------

  const renderShoppingList = () => {
    const toggleCheck = async (item: LensItem<FoodArtifact>) => {
      const d = item.data as unknown as FoodArtifact;
      const newChecked = !d.checked;
      setCheckedItems(prev => {
        const next = new Set(prev);
        if (newChecked) next.add(item.id); else next.delete(item.id);
        return next;
      });
      await updateShoppingItem(item.id, {
        data: { ...d as unknown as Record<string, unknown>, checked: newChecked } as unknown as Partial<FoodArtifact>,
        meta: { status: newChecked ? 'completed' : 'active' },
      });
    };

    const byCategory: Record<string, LensItem<FoodArtifact>[]> = {};
    shoppingItems.forEach(item => {
      const d = item.data as unknown as FoodArtifact;
      const cat = d.shoppingCategory || 'Other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });

    const totalItems = shoppingItems.length;
    const checkedCount = shoppingItems.filter(i => (i.data as unknown as FoodArtifact).checked || checkedItems.has(i.id)).length;

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <div>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <ShoppingCart className="w-5 h-5 text-green-400" /> Shopping List
            </h2>
            <p className={ds.textMuted}>{checkedCount}/{totalItems} items checked off</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={async () => {
              const checked = shoppingItems.filter(i => (i.data as unknown as FoodArtifact).checked || checkedItems.has(i.id));
              for (const item of checked) { await removeShoppingItem(item.id); }
              setCheckedItems(new Set());
            }} className={ds.btnSecondary}>
              <Trash2 className="w-4 h-4" /> Clear Checked
            </button>
            <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Add Item</button>
          </div>
        </div>

        {/* Progress */}
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <span className={ds.textMuted}>Progress</span>
            <span className={ds.textMono}>{checkedCount}/{totalItems}</span>
          </div>
          <div className="h-3 bg-lattice-elevated rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 0}%` }} />
          </div>
        </div>

        {/* By category */}
        {Object.keys(byCategory).length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <ShoppingCart className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No shopping items. Add items or generate from your meal plan.</p>
          </div>
        ) : (
          Object.entries(byCategory).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, catItems]) => (
            <div key={cat} className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3')}>{cat} <span className={ds.badge('gray-400')}>{catItems.length}</span></h3>
              <div className="space-y-2">
                {catItems.map(item => {
                  const d = item.data as unknown as FoodArtifact;
                  const isChecked = d.checked || checkedItems.has(item.id);
                  return (
                    <div key={item.id} className={cn('flex items-center gap-3 p-3 rounded-lg transition-colors', isChecked ? 'bg-green-400/10 opacity-60' : 'bg-lattice-elevated/50')}>
                      <button onClick={() => toggleCheck(item)} className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-colors', isChecked ? 'bg-green-400 border-green-400' : 'border-gray-500 hover:border-neon-cyan')}>
                        {isChecked && <CheckCircle2 className="w-3 h-3 text-black" />}
                      </button>
                      <div className="flex-1">
                        <p className={cn('font-medium', isChecked && 'line-through text-gray-500')}>{item.title}</p>
                        <p className={ds.textMuted}>{d.quantity || 1} {d.shoppingUnit || 'ea'}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></button>
                        <button className={cn(ds.btnSmall, 'text-red-400')} onClick={() => removeShoppingItem(item.id)}><Trash2 className="w-3 h-3" /></button>
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

  // ---------------------------------------------------------------------------
  // Nutrition Tracker
  // ---------------------------------------------------------------------------

  const renderNutritionTracker = () => {
    const recipesWithNutrition = allRecipes.filter(r => {
      const d = r.data as unknown as FoodArtifact;
      return d.calories || d.protein || d.carbs || d.fat;
    });

    // Daily totals from meal plan
    const dailyTotals: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {};
    DAYS_OF_WEEK.forEach(day => { dailyTotals[day] = { calories: 0, protein: 0, carbs: 0, fat: 0 }; });
    mealPlanItems.forEach(item => {
      const d = item.data as unknown as FoodArtifact;
      if (d.day && dailyTotals[d.day]) {
        dailyTotals[d.day].calories += d.calories || 0;
        dailyTotals[d.day].protein += d.protein || 0;
        dailyTotals[d.day].carbs += d.carbs || 0;
        dailyTotals[d.day].fat += d.fat || 0;
      }
    });

    const weekAvg = {
      calories: DAYS_OF_WEEK.reduce((s, d) => s + dailyTotals[d].calories, 0) / 7,
      protein: DAYS_OF_WEEK.reduce((s, d) => s + dailyTotals[d].protein, 0) / 7,
      carbs: DAYS_OF_WEEK.reduce((s, d) => s + dailyTotals[d].carbs, 0) / 7,
      fat: DAYS_OF_WEEK.reduce((s, d) => s + dailyTotals[d].fat, 0) / 7,
    };

    return (
      <div className="space-y-6">
        <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
          <Flame className="w-5 h-5 text-orange-400" /> Nutrition Tracker
        </h2>

        {/* Weekly averages */}
        <div className={ds.grid4}>
          <div className={cn(ds.panel, 'border-l-4 border-l-orange-400')}>
            <p className={ds.textMuted}>Avg Calories/Day</p>
            <p className="text-2xl font-bold text-orange-400">{Math.round(weekAvg.calories)}</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-blue-400')}>
            <p className={ds.textMuted}>Avg Protein/Day</p>
            <p className="text-2xl font-bold text-blue-400">{Math.round(weekAvg.protein)}g</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-yellow-400')}>
            <p className={ds.textMuted}>Avg Carbs/Day</p>
            <p className="text-2xl font-bold text-yellow-400">{Math.round(weekAvg.carbs)}g</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-red-400')}>
            <p className={ds.textMuted}>Avg Fat/Day</p>
            <p className="text-2xl font-bold text-red-400">{Math.round(weekAvg.fat)}g</p>
          </div>
        </div>

        {/* Daily breakdown */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Daily Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border text-gray-400">
                  <th className="text-left py-2 px-3">Day</th>
                  <th className="text-right py-2 px-3">Calories</th>
                  <th className="text-right py-2 px-3">Protein</th>
                  <th className="text-right py-2 px-3">Carbs</th>
                  <th className="text-right py-2 px-3">Fat</th>
                  <th className="text-right py-2 px-3">Meals</th>
                </tr>
              </thead>
              <tbody>
                {DAYS_OF_WEEK.map(day => {
                  const t = dailyTotals[day];
                  const mealCount = mealPlanItems.filter(m => (m.data as unknown as FoodArtifact).day === day).length;
                  return (
                    <tr key={day} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30">
                      <td className="py-2 px-3 font-medium text-white">{day}</td>
                      <td className="py-2 px-3 text-right font-mono text-orange-400">{t.calories}</td>
                      <td className="py-2 px-3 text-right font-mono text-blue-400">{t.protein}g</td>
                      <td className="py-2 px-3 text-right font-mono text-yellow-400">{t.carbs}g</td>
                      <td className="py-2 px-3 text-right font-mono text-red-400">{t.fat}g</td>
                      <td className="py-2 px-3 text-right text-gray-400">{mealCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recipes with nutrition info */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Recipe Nutrition Database</h3>
          {recipesWithNutrition.length === 0 ? (
            <p className={ds.textMuted}>Add nutrition info (calories, protein, carbs, fat) to your recipes to see them here.</p>
          ) : (
            <div className="space-y-2">
              {recipesWithNutrition.map(recipe => {
                const d = recipe.data as unknown as FoodArtifact;
                return (
                  <div key={recipe.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer" onClick={() => openEdit(recipe)}>
                    <div>
                      <p className="font-medium text-white">{recipe.title}</p>
                      <p className={ds.textMuted}>{d.servings || 1} servings - {d.category}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="text-orange-400">{d.calories || 0} cal</span>
                      <span className="text-blue-400">{d.protein || 0}g P</span>
                      <span className="text-yellow-400">{d.carbs || 0}g C</span>
                      <span className="text-red-400">{d.fat || 0}g F</span>
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
  // Pantry Inventory
  // ---------------------------------------------------------------------------

  const renderPantry = () => {
    const byLocation: Record<string, LensItem<FoodArtifact>[]> = {};
    pantryItems.forEach(item => {
      const d = item.data as unknown as FoodArtifact;
      const loc = d.location || 'Pantry Shelf';
      if (!byLocation[loc]) byLocation[loc] = [];
      byLocation[loc].push(item);
    });

    const expiringItems = pantryItems.filter(item => {
      const d = item.data as unknown as FoodArtifact;
      if (!d.expiryDate) return false;
      const daysLeft = Math.ceil((new Date(d.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft >= 0 && daysLeft <= 7;
    });

    const expiredItems = pantryItems.filter(item => {
      const d = item.data as unknown as FoodArtifact;
      if (!d.expiryDate) return false;
      return new Date(d.expiryDate) < new Date();
    });

    return (
      <div className="space-y-6">
        <div className={ds.sectionHeader}>
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <Package className="w-5 h-5 text-neon-cyan" /> Pantry Inventory
          </h2>
          <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> Add Item</button>
        </div>

        {/* Alerts */}
        <div className={ds.grid3}>
          <div className={cn(ds.panel, 'border-l-4 border-l-neon-cyan')}>
            <p className={ds.textMuted}>Total Items</p>
            <p className={ds.heading2}>{pantryItems.length}</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-yellow-400')}>
            <p className={ds.textMuted}>Expiring Soon</p>
            <p className="text-2xl font-bold text-yellow-400">{expiringItems.length}</p>
            <p className={ds.textMuted}>within 7 days</p>
          </div>
          <div className={cn(ds.panel, 'border-l-4 border-l-red-400')}>
            <p className={ds.textMuted}>Expired</p>
            <p className="text-2xl font-bold text-red-400">{expiredItems.length}</p>
          </div>
        </div>

        {/* Expiring alerts */}
        {(expiringItems.length > 0 || expiredItems.length > 0) && (
          <div className={cn(ds.panel, 'border-yellow-400/30')}>
            <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <AlertTriangle className="w-5 h-5 text-yellow-400" /> Expiration Alerts
            </h3>
            <div className="space-y-2">
              {[...expiredItems, ...expiringItems].map(item => {
                const d = item.data as unknown as FoodArtifact;
                const daysLeft = Math.ceil((new Date(d.expiryDate || '').getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={item.id} className={cn('flex items-center justify-between p-3 rounded-lg', daysLeft < 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-yellow-500/10 border border-yellow-500/20')}>
                    <div>
                      <p className="text-sm font-medium text-white">{item.title}</p>
                      <p className={ds.textMuted}>{d.currentStock} {d.unit} in {d.location}</p>
                    </div>
                    <span className={cn('text-xs font-medium', daysLeft < 0 ? 'text-red-400' : 'text-yellow-400')}>
                      {daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* By location */}
        {Object.keys(byLocation).length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No pantry items. Track what&apos;s in stock with expiration dates.</p>
          </div>
        ) : (
          Object.entries(byLocation).map(([loc, locItems]) => (
            <div key={loc} className={ds.panel}>
              <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
                <Warehouse className="w-4 h-4 text-neon-cyan" /> {loc}
                <span className={ds.badge('gray-400')}>{locItems.length}</span>
              </h3>
              <div className="space-y-2">
                {locItems.map(item => {
                  const d = item.data as unknown as FoodArtifact;
                  const daysLeft = d.expiryDate ? Math.ceil((new Date(d.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 999;
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/50 hover:bg-lattice-elevated cursor-pointer" onClick={() => openEdit(item)}>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{d.currentStock || 0} {d.unit || 'ea'}</span>
                          {d.expiryDate && <span className={cn(daysLeft <= 7 ? 'text-yellow-400' : daysLeft <= 0 ? 'text-red-400' : '')}>Exp: {d.expiryDate}</span>}
                          {d.purchaseDate && <span>Bought: {d.purchaseDate}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={e => { e.stopPropagation(); openEdit(item); }}><Edit2 className="w-3 h-3" /></button>
                        <button className={cn(ds.btnSmall, 'text-red-400')} onClick={e => { e.stopPropagation(); remove(item.id); }}><Trash2 className="w-3 h-3" /></button>
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

  // ---------------------------------------------------------------------------
  // Library (item list)
  // ---------------------------------------------------------------------------

  const renderLibrary = () => {
    // Sub-view routing for each tab
    if (activeTab === 'mealplan') return renderMealPlanner();
    if (activeTab === 'shopping') return renderShoppingList();
    if (activeTab === 'nutrition') return renderNutritionTracker();
    if (activeTab === 'pantry') return renderPantry();
    if (activeTab === 'menu' && showMenuMatrix) return renderMenuMatrix();
    if (activeTab === 'inventory' && showWasteLog) return renderWasteLog();
    if (activeTab === 'inventory' && showCountSheet) return renderCountSheet();
    if (activeTab === 'inventory' && showSupplierCompare) return renderSupplierCompare();
    if (activeTab === 'bookings' && showFloorPlan) return renderFloorPlan();
    if (activeTab === 'batches' && showPrepList) return renderPrepList();
    if (activeTab === 'shifts' && showWeeklySchedule) return renderWeeklySchedule();

    return (
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search ${activeTab}...`} className={cn(ds.input, 'pl-10')} />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); }} className={ds.btnGhost}><Filter className="w-4 h-4" /> Clear</button>
          <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New {activeArtifactType}</button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
        </div>

        {/* Sub-view buttons per tab */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'menu' && (
            <button onClick={() => setShowMenuMatrix(true)} className={ds.btnSecondary}><PieChart className="w-4 h-4" /> Menu Matrix</button>
          )}
          {activeTab === 'inventory' && (
            <>
              <button onClick={() => setShowWasteLog(true)} className={ds.btnSecondary}><Trash2 className="w-4 h-4" /> Waste Log</button>
              <button onClick={() => setShowCountSheet(true)} className={ds.btnSecondary}><ClipboardList className="w-4 h-4" /> Count Sheet</button>
              <button onClick={() => setShowSupplierCompare(true)} className={ds.btnSecondary}><DollarSign className="w-4 h-4" /> Suppliers</button>
            </>
          )}
          {activeTab === 'bookings' && (
            <button onClick={() => setShowFloorPlan(true)} className={ds.btnSecondary}><Armchair className="w-4 h-4" /> Floor Plan</button>
          )}
          {activeTab === 'batches' && (
            <button onClick={() => setShowPrepList(true)} className={ds.btnSecondary}><ClipboardList className="w-4 h-4" /> Prep List</button>
          )}
          {activeTab === 'shifts' && (
            <button onClick={() => setShowWeeklySchedule(true)} className={ds.btnSecondary}><CalendarDays className="w-4 h-4" /> Weekly Schedule</button>
          )}
          {/* Domain action buttons */}
          {activeTab === 'recipes' && filtered.length > 0 && (
            <>
              <button onClick={() => handleAction('cost_plate')} className={ds.btnSecondary}><DollarSign className="w-4 h-4" /> Cost Plate</button>
              <button onClick={() => handleAction('menu_analysis')} className={ds.btnSecondary}><BarChart3 className="w-4 h-4" /> Menu Analysis</button>
            </>
          )}
        </div>

        {actionResult && (
          <div className={ds.panel}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={ds.heading3}>Action Result</h3>
              <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              {/* scaleRecipe */}
              {actionResult.scaleFactor !== undefined && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">{String(actionResult.targetYield)}</p>
                      <p className="text-[10px] text-gray-500">Target Yield</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">{String(actionResult.scaleFactor)}x</p>
                      <p className="text-[10px] text-gray-500">Scale Factor</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">{String(actionResult.yieldUnit)}</p>
                      <p className="text-[10px] text-gray-500">Unit</p>
                    </div>
                  </div>
                  {Array.isArray(actionResult.ingredients) && (actionResult.ingredients as {name:string;scaledQuantity:number;unit:string}[]).slice(0,6).map((ing, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-2 py-1 bg-lattice-surface rounded">
                      <span className="text-gray-300">{ing.name}</span>
                      <span className="text-neon-cyan font-semibold">{ing.scaledQuantity} {ing.unit}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* costPlate */}
              {actionResult.avgFoodCostPct !== undefined && Array.isArray(actionResult.items) && (
                <div className="space-y-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.avgFoodCostPct)}%</p>
                    <p className="text-[10px] text-gray-500">Avg Food Cost %</p>
                  </div>
                  {(actionResult.items as {name:string;foodCostPct:number;menuPrice:number;status:string}[]).map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-lattice-surface rounded">
                      <div>
                        <p className="text-xs font-semibold text-white">{item.name}</p>
                        <p className="text-[10px] text-gray-500">${item.menuPrice} menu price</p>
                      </div>
                      <span className={`text-xs font-bold ${item.status === 'on-target' ? 'text-green-400' : 'text-red-400'}`}>{item.foodCostPct}%</span>
                    </div>
                  ))}
                </div>
              )}
              {/* spoilageCheck */}
              {actionResult.expiredCount !== undefined && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-red-400">{String(actionResult.expiredCount)}</p>
                    <p className="text-[10px] text-gray-500">Expired</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-amber-400">{String(actionResult.expiringSoonCount)}</p>
                    <p className="text-[10px] text-gray-500">Expiring Soon</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-green-400">{String(actionResult.okCount)}</p>
                    <p className="text-[10px] text-gray-500">OK</p>
                  </div>
                  {Number(actionResult.estimatedSpoilageLoss) > 0 && (
                    <div className="col-span-3 p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-red-400">${String(actionResult.estimatedSpoilageLoss)}</p>
                      <p className="text-[10px] text-gray-500">Estimated Loss</p>
                    </div>
                  )}
                </div>
              )}
              {/* pourCost */}
              {actionResult.avgPourCostPct !== undefined && Array.isArray(actionResult.items) && (
                <div className="space-y-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.avgPourCostPct)}%</p>
                    <p className="text-[10px] text-gray-500">Avg Pour Cost %</p>
                  </div>
                  {(actionResult.items as {name:string;pourCostPct:number;profit:number;status:string}[]).map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-lattice-surface rounded">
                      <div>
                        <p className="text-xs font-semibold text-white">{item.name}</p>
                        <p className="text-[10px] text-gray-500">${item.profit} profit</p>
                      </div>
                      <span className={`text-xs font-bold ${item.status === 'on-target' ? 'text-green-400' : 'text-red-400'}`}>{item.pourCostPct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className={cn(ds.panel, 'text-center py-12')}><p className={ds.textMuted}>Loading {activeTab}...</p></div>
        ) : filtered.length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <ChefHat className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No {activeTab} found. Create one to get started.</p>
          </div>
        ) : (
          <div className={ds.grid3}>
            {filtered.map((item, index) => {
              const d = item.data as unknown as FoodArtifact;
              const plate = d.type === 'Recipe' ? costPlate(item) : null;
              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className={ds.heading3}>{item.title}</h3>
                    {renderStatusBadge(d.status)}
                  </div>
                  {d.description && <p className={cn(ds.textMuted, 'line-clamp-2 mb-2')}>{d.description}</p>}
                  {d.category && <span className={ds.badge('cyan-400')}>{d.category}</span>}

                  {/* Recipe-specific details */}
                  {d.type === 'Recipe' && (
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center gap-4 text-sm">
                        {d.prepTime && <span className="flex items-center gap-1 text-gray-400"><Timer className="w-3 h-3" /> Prep {d.prepTime}m</span>}
                        {d.cookTime && <span className="flex items-center gap-1 text-gray-400"><Flame className="w-3 h-3" /> Cook {d.cookTime}m</span>}
                        {d.servings && <span className="flex items-center gap-1 text-gray-400"><Users className="w-3 h-3" /> {d.servings} srv</span>}
                      </div>
                      {plate && (
                        <div className="flex items-center gap-3 mt-2">
                          <span className={cn(ds.textMono, 'text-red-400')}>Cost ${plate.foodCost.toFixed(2)}</span>
                          <span className={cn(ds.textMono, 'text-green-400')}>Price ${plate.price.toFixed(2)}</span>
                          <span className={cn(ds.badge(plate.margin >= 65 ? 'green-400' : plate.margin >= 50 ? 'yellow-400' : 'red-400'))}>
                            {plate.margin.toFixed(0)}% margin
                          </span>
                        </div>
                      )}
                      {d.allergens && d.allergens.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          <AlertTriangle className="w-3 h-3 text-orange-400" />
                          {d.allergens.map(a => <span key={a} className={ds.badge('orange-400')}>{a}</span>)}
                        </div>
                      )}
                      {d.dietary && d.dietary.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          <Leaf className="w-3 h-3 text-green-400" />
                          {d.dietary.map(df => <span key={df} className={ds.badge('green-400')}>{df}</span>)}
                        </div>
                      )}
                      {(d.calories || d.protein || d.carbs || d.fat) && (
                        <div className="flex items-center gap-3 mt-2 text-xs font-mono">
                          {d.calories ? <span className="text-orange-400">{d.calories} cal</span> : null}
                          {d.protein ? <span className="text-blue-400">{d.protein}g P</span> : null}
                          {d.carbs ? <span className="text-yellow-400">{d.carbs}g C</span> : null}
                          {d.fat ? <span className="text-red-400">{d.fat}g F</span> : null}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={e => { e.stopPropagation(); setScaleFactor(1); setRecipeScaleId(item.id); }}
                          className={cn(ds.btnSmall, 'text-purple-400 hover:text-purple-300')}
                        >
                          <Scale className="w-3 h-3" /> Scale
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Menu-specific */}
                  {d.type === 'Menu' && (
                    <div className="mt-3 space-y-1">
                      {d.section && <span className={ds.badge('blue-400')}>{d.section}</span>}
                      <div className="flex items-center gap-3 mt-2 text-sm">
                        <span className="text-gray-400">Pop: {d.popularity || 0}%</span>
                        <span className="text-gray-400">Sales: {d.salesVolume || 0}</span>
                        <span className={ds.badge(getQuadrantConfig(getMenuQuadrant(d)).color)}>
                          {getQuadrantConfig(getMenuQuadrant(d)).label}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Inventory-specific */}
                  {d.type === 'InventoryItem' && (
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Stock: <span className={cn('font-bold', d.currentStock !== undefined && d.parLevel !== undefined && d.currentStock < d.parLevel ? 'text-red-400' : 'text-green-400')}>{d.currentStock} {d.unit}</span></span>
                        <span className="text-gray-400">Par: {d.parLevel} {d.unit}</span>
                      </div>
                      {d.currentStock !== undefined && d.parLevel !== undefined && d.currentStock < d.parLevel && (
                        <div className="flex items-center gap-1 text-red-400 text-xs"><AlertTriangle className="w-3 h-3" /> Below par level - reorder needed</div>
                      )}
                      {d.fifoDate && <span className="flex items-center gap-1 text-xs text-gray-400"><Package className="w-3 h-3" /> FIFO: {d.fifoDate}</span>}
                      {d.storageTemp && <span className="flex items-center gap-1 text-xs text-gray-400"><Thermometer className="w-3 h-3" /> {d.storageTemp}</span>}
                      {d.supplier && <span className="flex items-center gap-1 text-xs text-gray-400"><Layers className="w-3 h-3" /> {d.supplier}</span>}
                    </div>
                  )}

                  {/* Booking-specific */}
                  {d.type === 'Booking' && (
                    <div className="mt-3 space-y-1 text-sm">
                      <p className="flex items-center gap-1 text-gray-400"><Users className="w-3 h-3" /> {d.guestName} - Party of {d.guestCount}</p>
                      {d.dateTime && <p className="flex items-center gap-1 text-gray-400"><CalendarClock className="w-3 h-3" /> {new Date(d.dateTime).toLocaleString()}</p>}
                      {d.tableNumber && <p className="text-gray-400">Table {d.tableNumber}</p>}
                      {d.specialRequests && <p className="text-orange-400 text-xs">{d.specialRequests}</p>}
                    </div>
                  )}

                  {/* Shift-specific */}
                  {d.type === 'Shift' && (
                    <div className="mt-3 space-y-1 text-sm">
                      <p className="font-medium">{d.employee}</p>
                      <p className="text-gray-400">{d.role} - {d.station}</p>
                      {d.shiftStart && d.shiftEnd && (
                        <>
                          <p className="flex items-center gap-1 text-gray-400"><Clock className="w-3 h-3" /> {d.shiftStart.slice(11, 16)} - {d.shiftEnd.slice(11, 16)}</p>
                          <p className="text-gray-500 text-xs">{calcShiftHours(d.shiftStart, d.shiftEnd).toFixed(1)}h @ ${d.hourlyRate || 15}/hr = ${calcLaborCost(calcShiftHours(d.shiftStart, d.shiftEnd), d.hourlyRate || 15).toFixed(2)}</p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Batch-specific */}
                  {d.type === 'Batch' && (
                    <div className="mt-3 space-y-1 text-sm">
                      <p className="text-gray-400">Recipe: {d.recipe}</p>
                      <p className="text-gray-400">Batch size: {d.batchSize}</p>
                      {d.yield !== undefined && d.yield > 0 && <p className="text-green-400">Yield: {d.yield}</p>}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lattice-border">
                    <button onClick={e => { e.stopPropagation(); openEdit(item); }} className={cn(ds.btnSmall, 'text-gray-400 hover:text-white')}><Edit2 className="w-3 h-3" /> Edit</button>
                    <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnSmall, 'text-red-400 hover:text-red-300')}><Trash2 className="w-3 h-3" /> Delete</button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Editor Modal
  // ---------------------------------------------------------------------------

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className={ds.modalBackdrop} onClick={() => setEditorOpen(false)}>
        <div className={ds.modalContainer}>
          <div className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-lattice-border">
              <h2 className={ds.heading2}>{editingItem ? `Edit ${activeArtifactType}` : `New ${activeArtifactType}`}</h2>
              <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={ds.label}>Name</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} className={ds.input} placeholder="Name..." />
              </div>
              <div>
                <label className={ds.label}>Description</label>
                <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2} className={ds.textarea} placeholder="Description..." />
              </div>
              <div className={ds.grid3}>
                <div>
                  <label className={ds.label}>Status</label>
                  <select value={formStatus} onChange={e => setFormStatus(e.target.value as Status)} className={ds.select}>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Category</label>
                  <input value={formCategory} onChange={e => setFormCategory(e.target.value)} className={ds.input} placeholder="Category" />
                </div>
                <div>
                  <label className={ds.label}>Section</label>
                  <select value={formSection} onChange={e => setFormSection(e.target.value)} className={ds.select}>
                    {MENU_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {(activeTab === 'recipes' || activeTab === 'inventory' || activeTab === 'menu') && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Cost ($)</label>
                    <input type="number" value={formCost} onChange={e => setFormCost(e.target.value)} className={ds.input} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={ds.label}>Menu Price ($)</label>
                    <input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value)} className={ds.input} placeholder="0.00" />
                  </div>
                </div>
              )}

              {activeTab === 'recipes' && (
                <>
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Servings</label>
                      <input type="number" value={formServings} onChange={e => setFormServings(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Prep Time (min)</label>
                      <input type="number" value={formPrepTime} onChange={e => setFormPrepTime(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Cook Time (min)</label>
                      <input type="number" value={formCookTime} onChange={e => setFormCookTime(e.target.value)} className={ds.input} />
                    </div>
                  </div>
                  <div className={ds.panel}>
                    <label className={cn(ds.label, 'mb-2 text-orange-400')}>Nutrition per Serving</label>
                    <div className={ds.grid4}>
                      <div>
                        <label className={ds.label}>Calories</label>
                        <input type="number" className={ds.input} placeholder="0" />
                      </div>
                      <div>
                        <label className={ds.label}>Protein (g)</label>
                        <input type="number" className={ds.input} placeholder="0" />
                      </div>
                      <div>
                        <label className={ds.label}>Carbs (g)</label>
                        <input type="number" className={ds.input} placeholder="0" />
                      </div>
                      <div>
                        <label className={ds.label}>Fat (g)</label>
                        <input type="number" className={ds.input} placeholder="0" />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'mealplan' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Day</label>
                      <select value={formSection} onChange={e => setFormSection(e.target.value)} className={ds.select}>
                        {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Meal Type</label>
                      <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className={ds.select}>
                        {MEAL_TYPES.map(mt => <option key={mt} value={mt.toLowerCase()}>{mt}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Recipe Reference</label>
                    <select className={ds.select} value={formNotes} onChange={e => setFormNotes(e.target.value)}>
                      <option value="">Select a recipe...</option>
                      {allRecipes.map(r => <option key={r.id} value={r.title}>{r.title}</option>)}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'shopping' && (
                <>
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Quantity</label>
                      <input type="number" value={formCurrentStock} onChange={e => setFormCurrentStock(e.target.value)} className={ds.input} placeholder="1" />
                    </div>
                    <div>
                      <label className={ds.label}>Unit</label>
                      <select value={formUnit} onChange={e => setFormUnit(e.target.value)} className={ds.select}>
                        {['ea', 'lb', 'oz', 'kg', 'g', 'gal', 'qt', 'pt', 'bag', 'bunch', 'can'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Category</label>
                      <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className={ds.select}>
                        {SHOPPING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'pantry' && (
                <>
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Quantity</label>
                      <input type="number" value={formCurrentStock} onChange={e => setFormCurrentStock(e.target.value)} className={ds.input} placeholder="0" />
                    </div>
                    <div>
                      <label className={ds.label}>Unit</label>
                      <select value={formUnit} onChange={e => setFormUnit(e.target.value)} className={ds.select}>
                        {['ea', 'lb', 'oz', 'kg', 'g', 'gal', 'qt', 'pt', 'cs', 'bag', 'bottle', 'box', 'can'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Location</label>
                      <select value={formSupplier} onChange={e => setFormSupplier(e.target.value)} className={ds.select}>
                        {PANTRY_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Expiry Date</label>
                      <input type="date" value={formDateTime} onChange={e => setFormDateTime(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Purchase Date</label>
                      <input type="date" value={formShiftStart} onChange={e => setFormShiftStart(e.target.value)} className={ds.input} />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'menu' && (
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Popularity (0-100)</label>
                    <input type="number" value={formPopularity} onChange={e => setFormPopularity(e.target.value)} className={ds.input} min="0" max="100" />
                  </div>
                  <div>
                    <label className={ds.label}>Sales Volume</label>
                    <input type="number" value={formSalesVolume} onChange={e => setFormSalesVolume(e.target.value)} className={ds.input} />
                  </div>
                </div>
              )}

              {activeTab === 'inventory' && (
                <>
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Current Stock</label>
                      <input type="number" value={formCurrentStock} onChange={e => setFormCurrentStock(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Par Level</label>
                      <input type="number" value={formParLevel} onChange={e => setFormParLevel(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Unit</label>
                      <select value={formUnit} onChange={e => setFormUnit(e.target.value)} className={ds.select}>
                        {['ea', 'lb', 'oz', 'kg', 'g', 'gal', 'qt', 'pt', 'cs', 'bag'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Supplier</label>
                    <input value={formSupplier} onChange={e => setFormSupplier(e.target.value)} className={ds.input} placeholder="Supplier name" />
                  </div>
                </>
              )}

              {activeTab === 'bookings' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Guest Name</label>
                      <input value={formGuestName} onChange={e => setFormGuestName(e.target.value)} className={ds.input} placeholder="Guest name" />
                    </div>
                    <div>
                      <label className={ds.label}>Party Size</label>
                      <input type="number" value={formGuestCount} onChange={e => setFormGuestCount(e.target.value)} className={ds.input} />
                    </div>
                  </div>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Date & Time</label>
                      <input type="datetime-local" value={formDateTime} onChange={e => setFormDateTime(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Table Number</label>
                      <input value={formTableNumber} onChange={e => setFormTableNumber(e.target.value)} className={ds.input} placeholder="Table #" />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'shifts' && (
                <>
                  <div className={ds.grid2}>
                    <div>
                      <label className={ds.label}>Employee</label>
                      <input value={formEmployee} onChange={e => setFormEmployee(e.target.value)} className={ds.input} placeholder="Employee name" />
                    </div>
                    <div>
                      <label className={ds.label}>Role</label>
                      <select value={formRole} onChange={e => setFormRole(e.target.value)} className={ds.select}>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className={ds.grid3}>
                    <div>
                      <label className={ds.label}>Station</label>
                      <select value={formStation} onChange={e => setFormStation(e.target.value)} className={ds.select}>
                        {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Shift Start</label>
                      <input type="datetime-local" value={formShiftStart} onChange={e => setFormShiftStart(e.target.value)} className={ds.input} />
                    </div>
                    <div>
                      <label className={ds.label}>Shift End</label>
                      <input type="datetime-local" value={formShiftEnd} onChange={e => setFormShiftEnd(e.target.value)} className={ds.input} />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Hourly Rate ($)</label>
                    <input type="number" value={formHourlyRate} onChange={e => setFormHourlyRate(e.target.value)} className={ds.input} placeholder="15.00" />
                  </div>
                </>
              )}

              <div>
                <label className={ds.label}>Notes</label>
                <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} className={ds.textarea} placeholder="Notes..." />
              </div>
            </div>
            <div className="flex items-center justify-between p-6 border-t border-lattice-border">
              <div className="flex items-center gap-2">
                {activeTab === 'recipes' && editingItem && (
                  <>
                    <button onClick={() => { setEditorOpen(false); handleAction('cost_plate', editingItem.id); }} className={ds.btnSecondary}>
                      <DollarSign className="w-4 h-4" /> Cost Plate
                    </button>
                    <button onClick={() => { setEditorOpen(false); setScaleFactor(1); setRecipeScaleId(editingItem.id); }} className={ds.btnSecondary}>
                      <Scale className="w-4 h-4" /> Scale
                    </button>
                  </>
                )}
                {activeTab === 'inventory' && editingItem && (
                  <button onClick={() => { setEditorOpen(false); handleAction('waste_report', editingItem.id); }} className={ds.btnSecondary}>
                    <FileText className="w-4 h-4" /> Waste Report
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {editingItem && (
                  <button onClick={() => { remove(editingItem.id); setEditorOpen(false); }} className={cn(ds.btnSecondary, 'text-red-400 hover:text-red-300')}><Trash2 className="w-4 h-4" /> Delete</button>
                )}
                <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button>
                <button onClick={handleSave} className={ds.btnPrimary}><CheckCircle2 className="w-4 h-4" /> {editingItem ? 'Update' : 'Create'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Enhanced Dashboard
  // ---------------------------------------------------------------------------

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Revenue Projection</span>
          </div>
          <p className="text-3xl font-bold text-green-400">${dashboardMetrics.revenueProjection.toLocaleString()}</p>
          <p className={ds.textMuted}>{dashboardMetrics.totalCovers} covers x $42 avg</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Percent className="w-5 h-5 text-cyan-400" />
            <span className={ds.textMuted}>Avg Food Cost</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardMetrics.avgFoodCostPct <= 30 ? 'text-green-400' : dashboardMetrics.avgFoodCostPct <= 35 ? 'text-yellow-400' : 'text-red-400')}>
            {dashboardMetrics.avgFoodCostPct.toFixed(1)}%
          </p>
          <p className={ds.textMuted}>Target: under 30%</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span className={ds.textMuted}>Labor %</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardMetrics.laborPct <= 30 ? 'text-green-400' : dashboardMetrics.laborPct <= 35 ? 'text-yellow-400' : 'text-red-400')}>
            {dashboardMetrics.laborPct.toFixed(1)}%
          </p>
          <p className={ds.textMuted}>${dashboardMetrics.totalLaborCost.toFixed(0)} labor cost</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Trash2 className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Waste %</span>
          </div>
          <p className={cn('text-3xl font-bold', dashboardMetrics.wastePct <= 2 ? 'text-green-400' : dashboardMetrics.wastePct <= 5 ? 'text-yellow-400' : 'text-red-400')}>
            {dashboardMetrics.wastePct.toFixed(1)}%
          </p>
          <p className={ds.textMuted}>${wasteTotal.toFixed(2)} this week</p>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Low Stock Alerts</span>
          </div>
          <p className="text-3xl font-bold text-red-400">{dashboardMetrics.lowStockItems}</p>
          <p className={ds.textMuted}>Items below par level</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-5 h-5 text-blue-400" />
            <span className={ds.textMuted}>Active Bookings</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.activeBookings}</p>
          <p className={ds.textMuted}>{dashboardMetrics.totalCovers} total covers</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-5 h-5 text-cyan-400" />
            <span className={ds.textMuted}>Covers Forecast</span>
          </div>
          <p className="text-3xl font-bold">{dashboardMetrics.forecastCovers}</p>
          <p className={ds.textMuted}>vs {dashboardMetrics.totalCovers} actual</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>86'd Items</span>
          </div>
          <p className="text-3xl font-bold text-orange-400">{dashboardMetrics.eightyFixed}</p>
          <p className={ds.textMuted}>Currently out of stock</p>
        </div>
      </div>

      {/* Top/Bottom sellers + Status */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <ArrowUp className="w-5 h-5 text-green-400" /> Top Sellers
          </h3>
          <div className="space-y-2">
            {dashboardMetrics.topSellers.length > 0 ? dashboardMetrics.topSellers.map((d, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50">
                <div className="flex items-center gap-2">
                  <span className="text-green-400 font-bold">#{idx + 1}</span>
                  <span>{d.name}</span>
                </div>
                <span className={ds.textMono}>{d.salesVolume || 0} sold</span>
              </div>
            )) : <p className={ds.textMuted}>No sales data yet.</p>}
          </div>
        </div>
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <ArrowDown className="w-5 h-5 text-red-400" /> Bottom Sellers
          </h3>
          <div className="space-y-2">
            {dashboardMetrics.bottomSellers.length > 0 ? dashboardMetrics.bottomSellers.map((d, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-lattice-elevated/50">
                <div className="flex items-center gap-2">
                  <span className="text-red-400 font-bold">#{idx + 1}</span>
                  <span>{d.name}</span>
                </div>
                <span className={ds.textMono}>{d.salesVolume || 0} sold</span>
              </div>
            )) : <p className={ds.textMuted}>No sales data yet.</p>}
          </div>
        </div>
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
                <span className="w-20 text-sm text-gray-400">{cfg.label}</span>
                <div className="flex-1 h-2 bg-lattice-surface rounded-full overflow-hidden">
                  <div className={`h-full bg-${cfg.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent items */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <TrendingUp className="w-5 h-5 text-neon-cyan" /> Recent Items
        </h3>
        <div className="space-y-2">
          {items.slice(0, 5).map(item => {
            const d = item.data as unknown as FoodArtifact;
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-lattice-surface/50 hover:bg-lattice-surface cursor-pointer" onClick={() => openEdit(item)}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  <p className={ds.textMuted}>{d.type} {d.category ? `- ${d.category}` : ''}</p>
                </div>
                {renderStatusBadge(d.status)}
                <ArrowUpRight className="w-4 h-4 text-gray-500" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick domain actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
          <Zap className="w-5 h-5 text-yellow-400" /> Quick Actions
        </h3>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => handleAction('cost_plate')} className={ds.btnSecondary}><DollarSign className="w-4 h-4" /> Cost Plate</button>
          <button onClick={() => handleAction('menu_analysis')} className={ds.btnSecondary}><PieChart className="w-4 h-4" /> Menu Analysis</button>
          <button onClick={() => handleAction('generate_prep_list')} className={ds.btnSecondary}><ClipboardList className="w-4 h-4" /> Generate Prep List</button>
          <button onClick={() => handleAction('waste_report')} className={ds.btnSecondary}><Trash2 className="w-4 h-4" /> Waste Report</button>
          <button onClick={() => handleAction('scale_recipe')} className={ds.btnSecondary}><Scale className="w-4 h-4" /> Scale Recipe</button>
        </div>
      </div>
    </div>
  );

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
    <div data-lens-theme="food" className={ds.pageContainer}>
      {/* Nutrition Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          Not nutritional or dietary advice. Nutritional data shown is for informational purposes only. Consult a registered dietitian or healthcare provider for personalized guidance.
        </p>
      </div>
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <ChefHat className="w-8 h-8 text-orange-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Food & Hospitality</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Recipes, menus, inventory, bookings, and kitchen operations</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}>
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </div>
      </header>


      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const recipes = allRecipes;
          const totalCalories = recipes.reduce((s, r) => s + Number((r.data as unknown as FoodArtifact).calories || 0), 0);
          return [
            { label: 'Recipes', value: recipes.length, icon: ChefHat },
            { label: 'Meals Logged', value: mealPlanItems.length, icon: UtensilsCrossed },
            { label: 'Calories Today', value: totalCalories, icon: Flame },
            { label: 'Pantry Items', value: pantryItems.length, icon: Warehouse },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-orange-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="food" artifactId={allRecipes[0]?.id} compact />
      <RealtimeDataPanel domain="food" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="food" data={{}} compact />
      <VisionAnalyzeButton
        domain="food"
        prompt="Analyze this food image. Identify the dish or ingredients visible. List likely ingredients, suggest dietary tags (vegan, gluten-free, etc.), and estimate nutritional category."
        onResult={(res) => {
          setFormDescription(res.analysis);
          if (res.suggestedTags?.length) setFormNotes(res.suggestedTags.join(', '));
        }}
        className="inline-flex"
      />
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowDashboard(false);
              setShowMenuMatrix(false);
              setShowWasteLog(false);
              setShowCountSheet(false);
              setShowPrepList(false);
              setShowFloorPlan(false);
              setShowWeeklySchedule(false);
              setShowSupplierCompare(false);
            }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {showDashboard ? renderDashboard() : renderLibrary()}
        </div>
        {showDashboard && (
          <aside className="w-72 shrink-0 hidden xl:block space-y-4">
            <ArtifactUploader lens="food" acceptTypes="image/*" multi compact onUploadComplete={() => refetchDTUs()} />
            <LensContextPanel
              hyperDTUs={hyperDTUs}
              megaDTUs={megaDTUs}
              regularDTUs={regularDTUs}
              tierDistribution={tierDistribution}
              onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
              title="Food DTUs"
            />
            {foodArtifacts.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-400 uppercase">Food Artifacts</h4>
                {foodArtifacts.slice(0, 3).map((dtu: DTU) => (
                  <div key={dtu.id} className="p-2 rounded bg-lattice-elevated/50 border border-lattice-border">
                    <p className="text-xs font-medium truncate mb-1">{dtu.title || 'Untitled'}</p>
                    <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                  </div>
                ))}
              </div>
            )}
            <FeedbackWidget targetType="lens" targetId="food" />
          </aside>
        )}

      </div>
      {renderEditor()}
      {renderRecipeScaler()}

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
            <LensFeaturePanel lensId="food" />
          </div>
        )}
      </div>
    </div>
  );
}
