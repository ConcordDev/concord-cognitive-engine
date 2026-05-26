'use client';

/**
 * FavoritesWheel — Skyrim-style radial quick-equip menu on Q.
 *
 * 8 slots arranged in a circle. Each slot is bound to an inventory
 * item via localStorage (`concordia:favorites`). Open the wheel with
 * Q, mouse-over a slot to highlight, click to equip via
 * /api/combat-flow/equip with the slot's preferred hand. Number keys
 * 1-8 work the same way without opening the wheel.
 *
 * "Edit" mode (E while wheel is open) swaps the right pane to an
 * inventory picker — click an inventory item to bind it to the
 * currently focused slot.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'concordia:favorites:v1';
const SLOT_COUNT = 8;

interface FavoriteSlot {
  itemId: string;
  itemName: string;
  weaponClass: string | null;
  handedness: 'right' | 'left' | 'two' | 'either' | null;
  category?: string | null;
  rarityColor?: string | null;
}

interface InventoryItem {
  id: string;
  item_name: string;
  item_type: string;
  weapon_class?: string | null;
  handedness?: 'right' | 'left' | 'two' | 'either' | null;
  quality?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  firearm: '#fb923c', energy: '#22d3ee', heavy_explosive: '#f87171',
  projectile: '#34d399', melee_blade_1h: '#cbd5e1', melee_blade_2h: '#e2e8f0',
  melee_polearm: '#d6d3d1', melee_blunt_1h: '#fbbf24', melee_blunt_2h: '#fcd34d',
  melee_exotic: '#e879f9', fist: '#fb7185', focus: '#a78bfa',
  shield: '#38bdf8', cyberware: '#2dd4bf', hybrid: '#818cf8', amorphous: '#f9a8d4',
};

function loadFavorites(): Array<FavoriteSlot | null> {
  if (typeof window === 'undefined') return Array(SLOT_COUNT).fill(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return Array(SLOT_COUNT).fill(null);
    const arr = JSON.parse(raw) as Array<FavoriteSlot | null>;
    // Pad / truncate to SLOT_COUNT.
    const out = Array(SLOT_COUNT).fill(null) as Array<FavoriteSlot | null>;
    for (let i = 0; i < SLOT_COUNT && i < arr.length; i++) out[i] = arr[i];
    return out;
  } catch {
    return Array(SLOT_COUNT).fill(null);
  }
}

function saveFavorites(favs: Array<FavoriteSlot | null>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favs)); }
  catch { /* localStorage full or denied — drop silently */ }
}

/** Quick-equip the favourite at slot `idx`. Safe to call while wheel is closed. */
export async function equipFavorite(idx: number): Promise<boolean> {
  if (idx < 0 || idx >= SLOT_COUNT) return false;
  const fav = loadFavorites()[idx];
  if (!fav) return false;
  const target =
    fav.handedness === 'left' ? 'left_hand'
    : 'right_hand';
  try {
    const r = await fetch('/api/combat-flow/equip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ slot: target, itemId: fav.itemId }),
    });
    if (r.ok) {
      window.dispatchEvent(new CustomEvent('concordia:loadout-changed'));
      return true;
    }
  } catch { /* network error */ }
  return false;
}

export default function FavoritesWheel({ open, onClose }: Props) {
  const [favorites, setFavorites] = useState<Array<FavoriteSlot | null>>(() => loadFavorites());
  const [focused, setFocused]     = useState<number>(0);
  const [editMode, setEditMode]   = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  // Persist favorites whenever they change.
  useEffect(() => { saveFavorites(favorites); }, [favorites]);

  // Refresh inventory when opening edit mode.
  useEffect(() => {
    if (!open || !editMode) return;
    fetch('/api/world/inventory', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.items) setInventory(j.items);
      })
      .catch(() => {});
  }, [open, editMode]);

  // Number keys 1-8 (always-on, not just when wheel is open).
  useEffect(() => {
    const onNum = (e: KeyboardEvent) => {
      if (e.key < '1' || e.key > '8') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (open) setFocused(idx);
      else void equipFavorite(idx);
    };
    window.addEventListener('keydown', onNum);
    return () => window.removeEventListener('keydown', onNum);
  }, [open]);

  // Escape closes; Enter equips focused slot.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        setEditMode(false);
      } else if (e.key === 'Enter') {
        void equipFavorite(focused);
        onClose();
      } else if (e.key === 'e' || e.key === 'E') {
        setEditMode((v) => !v);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        setFavorites((prev) => {
          const next = [...prev];
          next[focused] = null;
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, focused, onClose]);

  const bindToFocused = useCallback((item: InventoryItem) => {
    setFavorites((prev) => {
      const next = [...prev];
      next[focused] = {
        itemId: item.id,
        itemName: item.item_name,
        weaponClass: item.weapon_class ?? null,
        handedness: (item.handedness as FavoriteSlot['handedness']) ?? 'either',
      };
      return next;
    });
    setEditMode(false);
  }, [focused]);

  const wedgeAngles = useMemo(() => {
    return Array.from({ length: SLOT_COUNT }, (_, i) => (i / SLOT_COUNT) * 2 * Math.PI - Math.PI / 2);
  }, []);

  if (!open) return null;

  const radius = 130;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative flex items-stretch gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Wheel */}
        <div className="relative w-[360px] h-[360px] flex items-center justify-center">
          {/* Outer ring */}
          <div className="absolute inset-2 rounded-full border-2 border-cyan-500/30" />
          <div className="absolute inset-8 rounded-full border border-white/10" />

          {/* Slots */}
          {favorites.map((fav, i) => {
            const a = wedgeAngles[i];
            const x = Math.cos(a) * radius;
            const y = Math.sin(a) * radius;
            const isFocused = i === focused;
            const isEmpty = !fav;
            const color = fav?.category ? (CATEGORY_COLOR[fav.category] || '#94a3b8') : '#475569';
            return (
              <button
                key={i}
                onClick={() => setFocused(i)}
                onDoubleClick={() => { void equipFavorite(i); onClose(); }}
                className={`absolute w-20 h-20 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
                  isFocused ? 'scale-110 z-10' : ''
                } ${isEmpty ? 'border-dashed' : ''}`}
                style={{
                  left: '50%',
                  top: '50%',
                  marginLeft: -40,
                  marginTop: -40,
                  transform: `translate(${x}px, ${y}px) ${isFocused ? 'scale(1.1)' : ''}`,
                  borderColor: isFocused ? '#22d3ee' : color,
                  backgroundColor: isFocused ? 'rgba(8,145,178,0.18)' : 'rgba(15,23,42,0.85)',
                  boxShadow: isFocused ? '0 0 20px rgba(34,211,238,0.5)' : 'none',
                }}
              >
                <div className="text-[9px] text-slate-400 font-mono">{i + 1}</div>
                {fav ? (
                  <>
                    <div
                      className="text-[10px] font-semibold text-center leading-tight px-1 line-clamp-2"
                      style={{ color: fav.rarityColor || color }}
                    >
                      {fav.itemName}
                    </div>
                    <div className="text-[8px] opacity-70" style={{ color }}>
                      {fav.weaponClass || ''}
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-slate-500">empty</div>
                )}
              </button>
            );
          })}

          {/* Center label */}
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-cyan-300 font-bold">Favorites</div>
            <div className="text-[10px] text-slate-400 mt-1">
              {favorites[focused]?.itemName || 'empty slot'}
            </div>
            <div className="text-[9px] text-slate-500 mt-3 font-mono leading-snug">
              1–8 select<br />
              Enter equip<br />
              E edit · Del clear<br />
              Esc close
            </div>
          </div>
        </div>

        {/* Edit panel */}
        {editMode && (
          <div className="bg-slate-950/95 border border-cyan-500/30 rounded-lg p-3 backdrop-blur w-72 max-h-[360px] flex flex-col">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mb-2">
              Bind to slot {focused + 1}
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {inventory.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-4">Inventory empty</div>
              ) : (
                inventory.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => bindToFocused(it)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-cyan-500/10 border border-white/5 transition-colors"
                  >
                    <div className="text-xs text-white truncate">{it.item_name}</div>
                    <div className="text-[10px] text-slate-400">
                      {it.weapon_class || it.item_type}
                      {it.handedness && it.handedness !== 'either' ? ` · ${it.handedness}` : ''}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
