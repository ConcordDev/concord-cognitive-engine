'use client';

/**
 * Wave 1 deferral 7 — drag source for the trade window.
 *
 * Fetches the player's inventory from /api/player-inventory and renders
 * draggable cards. Drop targets (TradeWindow's OfferPane) read the
 * payload from the dataTransfer when drop fires.
 *
 * Uses HTML5 native drag-and-drop (no external lib) per the user's
 * "focused page, not a refactor" guidance from Deferral 5.
 */

import { useEffect, useState } from 'react';

interface InventoryRow {
  id: string;
  item_id: string;
  item_name: string | null;
  quantity: number;
  quality: number;
  item_type: string;
  soulbound?: number;
}

const TRADE_DRAG_MIME = 'application/x-concord-trade-item';

export function readDraggedTradeItem(e: DragEvent | React.DragEvent): { inventoryId: string; itemName: string; maxQuantity: number } | null {
  try {
    const raw = e.dataTransfer?.getData(TRADE_DRAG_MIME);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function TradeInventorySidebar({ onItemDrag }: { onItemDrag?: (item: InventoryRow) => void }) {
  const [items, setItems] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/player-inventory', { credentials: 'same-origin' });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        const list: InventoryRow[] = Array.isArray(json) ? json
          : Array.isArray(json?.items) ? json.items
          : Array.isArray(json?.inventory) ? json.inventory
          : [];
        setItems(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDragStart = (item: InventoryRow) => (e: React.DragEvent<HTMLLIElement>) => {
    if (item.soulbound) {
      e.preventDefault();
      return;
    }
    const payload = {
      inventoryId: item.id,
      itemName:    item.item_name || item.item_id,
      maxQuantity: item.quantity,
    };
    e.dataTransfer.setData(TRADE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    onItemDrag?.(item);
  };

  return (
    <aside className="bg-gray-900/60 border border-gray-700 rounded p-3 w-56 max-h-[60vh] overflow-y-auto">
      <h3 className="text-sm font-semibold text-cyan-300 mb-2">Your inventory</h3>
      {loading && <div className="text-xs text-gray-400">Loading…</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-xs text-gray-400 italic">No items to trade</div>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            draggable={!item.soulbound}
            onDragStart={handleDragStart(item)}
            title={item.soulbound ? 'Soulbound — cannot trade' : 'Drag into your offer'}
            className={
              item.soulbound
                ? 'flex justify-between text-xs px-2 py-1.5 rounded bg-gray-800/40 text-gray-400 cursor-not-allowed'
                : 'flex justify-between text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-200 hover:bg-cyan-500/20 cursor-grab active:cursor-grabbing'
            }
          >
            <span className="truncate">{item.item_name || item.item_id}</span>
            <span className="text-gray-400 ml-2">×{item.quantity}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export const TRADE_ITEM_DRAG_MIME = TRADE_DRAG_MIME;
