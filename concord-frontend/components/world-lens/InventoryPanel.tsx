'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  Package,
  Hammer,
  Gem,
  Cpu,
  ScrollText,
  FlaskConical,
  Trophy,
  ArrowUpDown,
  Search,
  ChevronDown,
  Info,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ItemCategory =
  | 'tools'
  | 'materials'
  | 'components'
  | 'blueprints'
  | 'consumables'
  | 'equipment'
  | 'trophies';

type EquipSlot = 'head' | 'body' | 'hands' | 'tool' | 'accessory';

type SortMode = 'name' | 'category' | 'quantity' | 'date';

interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  description: string;
  icon?: string;
  quantity: number;
  stats?: Record<string, number | string>;
  creator?: string;
  dtuRef?: string;
  dateAcquired: string;
  equipSlot?: EquipSlot;
  effectiveness?: number;
  effectivenessLabel?: string;
  hasKnowledge?: boolean;
}

interface EquippedItems {
  head: InventoryItem | null;
  body: InventoryItem | null;
  hands: InventoryItem | null;
  tool: InventoryItem | null;
  accessory: InventoryItem | null;
}

interface InventoryPanelProps {
  items?: InventoryItem[];
  equipped?: EquippedItems;
  onEquip?: (item: InventoryItem) => void;
  onUnequip?: (slot: EquipSlot) => void;
  onUse?: (item: InventoryItem) => void;
  onDrop?: (item: InventoryItem) => void;
  onClose?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const CATEGORY_META: Record<
  ItemCategory,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  tools: { label: 'Tools', icon: Hammer },
  materials: { label: 'Materials', icon: Gem },
  components: { label: 'Components', icon: Cpu },
  blueprints: { label: 'Blueprints', icon: ScrollText },
  consumables: { label: 'Consumables', icon: FlaskConical },
  equipment: { label: 'Equipment', icon: Package },
  trophies: { label: 'Trophies', icon: Trophy },
};

const EQUIP_SLOTS: { slot: EquipSlot; label: string }[] = [
  { slot: 'head', label: 'Head' },
  { slot: 'body', label: 'Body' },
  { slot: 'hands', label: 'Hands' },
  { slot: 'tool', label: 'Tool' },
  { slot: 'accessory', label: 'Accessory' },
];

const EMPTY_EQUIPPED: EquippedItems = {
  head: null,
  body: null,
  hands: null,
  tool: null,
  accessory: null,
};

const TOTAL_SLOTS = 24;

/* ── Component ─────────────────────────────────────────────────── */

export default function InventoryPanel({
  items: itemsProp,
  equipped = EMPTY_EQUIPPED,
  onEquip,
  onUnequip,
  onUse,
  onDrop: _onDrop,
  onClose,
}: InventoryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<ItemCategory | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [search, setSearch] = useState('');
  const [hoveredItem, setHoveredItem] = useState<InventoryItem | null>(null);
  const [showStorage, setShowStorage] = useState(false);
  const [fetchedItems, setFetchedItems] = useState<InventoryItem[] | null>(null);

  // Polish-pass SFX: rustle on open
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('concordia:inventory-opened'));
    }
  }, []);

  // Fetch real inventory on mount; fall back to prop/demo if unavailable
  useEffect(() => {
    fetch('/api/player-inventory')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.items) return;
        const mapped: InventoryItem[] = data.items.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          name: String(row.item_name ?? row.name ?? 'Unknown'),
          category: (row.item_type as ItemCategory) ?? 'materials',
          description: String(row.description ?? ''),
          quantity: Number(row.quantity ?? 1),
          stats: row.quality ? { quality: Number(row.quality) } : undefined,
          effectiveness: typeof row.effectiveness === 'number' ? row.effectiveness : undefined,
          effectivenessLabel:
            typeof row.effectivenessLabel === 'string' ? row.effectivenessLabel : undefined,
          hasKnowledge: !!row.hasKnowledge,
          dateAcquired: row.acquired_at
            ? new Date(Number(row.acquired_at) * 1000).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        }));
        setFetchedItems(mapped);
      })
      .catch(() => {});
  }, []);

  // Real inventory only — never render fabricated items. Empty until the
  // real /api/player-inventory fetch resolves; honest empty-state otherwise.
  const items = fetchedItems ?? itemsProp ?? [];

  /* Filtering & sorting */
  const filtered = items
    .filter((i) => activeCategory === 'all' || i.category === activeCategory)
    .filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'category') return a.category.localeCompare(b.category);
      if (sortMode === 'quantity') return b.quantity - a.quantity;
      return b.dateAcquired.localeCompare(a.dateAcquired);
    });

  const handleEquip = useCallback((item: InventoryItem) => onEquip?.(item), [onEquip]);

  const categoryIcon = (cat: ItemCategory) => {
    const Icon = CATEGORY_META[cat].icon;
    return <Icon className="w-3.5 h-3.5" />;
  };

  return (
    <div className={`w-80 flex flex-col max-h-[calc(100vh-4rem)] ${panel} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold">Inventory</h2>
          <span className="text-[10px] text-gray-400">
            {items.length}/{TOTAL_SLOTS}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-white/5 border border-white/10">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-xs text-white placeholder-gray-600 outline-none flex-1"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 overflow-x-auto">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-2 py-1 text-[10px] rounded whitespace-nowrap ${
            activeCategory === 'all'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          All
        </button>
        {(Object.keys(CATEGORY_META) as ItemCategory[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded whitespace-nowrap ${
                activeCategory === cat
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Sort control */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] text-gray-400">{filtered.length} items</span>
        <button
          onClick={() => {
            const modes: SortMode[] = ['name', 'category', 'quantity', 'date'];
            setSortMode(modes[(modes.indexOf(sortMode) + 1) % modes.length]);
          }}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-300"
        >
          <ArrowUpDown className="w-3 h-3" />
          Sort: {sortMode}
        </button>
      </div>

      {/* Equipment loadout */}
      <div className="px-3 py-2 border-b border-white/5">
        <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Equipment</p>
        <div className="grid grid-cols-5 gap-1">
          {EQUIP_SLOTS.map(({ slot, label }) => {
            const item = equipped[slot];
            return (
              <button
                key={slot}
                onClick={() => item && onUnequip?.(slot)}
                className={`flex flex-col items-center gap-0.5 p-1.5 rounded border text-[9px] transition-colors ${
                  item
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-white/10 bg-white/5 text-gray-600'
                }`}
                title={item ? `${item.name} — click to unequip` : `${label} — empty`}
              >
                {item ? categoryIcon(item.category) : <Package className="w-3 h-3" />}
                <span className="truncate w-full text-center">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inventory grid */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="w-8 h-8 text-gray-700 mb-2" />
            <p className="text-xs text-gray-400">Your inventory is empty.</p>
            <p className="text-[10px] text-gray-400 mt-1">Visit The Exchange to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="relative group"
                onMouseEnter={() => setHoveredItem(item)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <button
                  onClick={() => {
                    if (item.equipSlot) handleEquip(item);
                    else onUse?.(item);
                  }}
                  className="w-full aspect-square rounded border border-white/10 bg-white/5 hover:bg-white/10 hover:border-cyan-500/40 flex flex-col items-center justify-center transition-colors"
                >
                  {categoryIcon(item.category)}
                  {item.quantity > 1 && (
                    <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/80 text-cyan-300 px-1 rounded">
                      {item.quantity}
                    </span>
                  )}
                </button>

                {/* Tooltip */}
                {hoveredItem?.id === item.id && (
                  <div
                    className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 ${panel} p-2 pointer-events-none`}
                  >
                    <p className="text-xs font-semibold text-white">{item.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.description}</p>
                    {item.stats && (
                      <div className="mt-1 border-t border-white/5 pt-1">
                        {Object.entries(item.stats).map(([k, v]) => (
                          <p key={k} className="text-[9px] text-gray-400">
                            {k}: <span className="text-cyan-400">{v}</span>
                          </p>
                        ))}
                      </div>
                    )}
                    {item.creator && (
                      <p className="text-[9px] text-gray-400 mt-1">Creator: {item.creator}</p>
                    )}
                    {item.dtuRef && <p className="text-[9px] text-gray-400">DTU: {item.dtuRef}</p>}
                    {item.effectivenessLabel && (
                      <div className="mt-1.5 border-t border-white/5 pt-1">
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            item.hasKnowledge
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {item.effectivenessLabel}
                        </span>
                        {!item.hasKnowledge && (
                          <p className="text-[8px] text-gray-400 mt-0.5">
                            Find the schematic to unlock full potential
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex gap-1 mt-1.5">
                      {item.equipSlot && (
                        <span className="text-[8px] bg-cyan-500/20 text-cyan-400 px-1 rounded">
                          Equip
                        </span>
                      )}
                      <span className="text-[8px] bg-red-500/20 text-red-400 px-1 rounded">
                        Drop
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Empty slots */}
            {Array.from({ length: Math.max(0, TOTAL_SLOTS - filtered.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="aspect-square rounded border border-white/5 bg-white/[0.02]"
              />
            ))}
          </div>
        )}
      </div>

      {/* Storage link */}
      <div className="px-3 py-2 border-t border-white/5">
        <button
          onClick={() => setShowStorage(!showStorage)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${showStorage ? 'rotate-180' : ''}`}
          />
          Firm / Residence Storage
        </button>
        {showStorage && (
          <div className="mt-1.5 p-2 rounded bg-white/5 border border-white/5">
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <Info className="w-3 h-3" />
              Storage linked to your firm or residence. Transfer items from your inventory here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
