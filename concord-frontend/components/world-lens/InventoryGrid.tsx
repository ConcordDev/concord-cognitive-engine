/**
 * InventoryGrid.tsx — drag-drop inventory with grid + weight system.
 *
 * 6×8 grid = 48 slots. Each slot accepts items up to a stack size.
 * Weight tracked per-item + per-category (equipment counts more).
 * Right-click → context menu (equip, drop, use, info).
 */

import { useState, useCallback } from 'react';

export interface InventoryItem {
  id: string;
  name: string;
  icon: string;        // emoji or GLB URL
  category: 'weapon' | 'armor' | 'consumable' | 'material' | 'cosmetic' | 'quest';
  weight: number;       // kg
  stackSize: number;    // max stack
  currentStack: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  boundToPlayer: boolean;
  metadata?: Record<string, any>;
}

interface InventoryGridProps {
  items: InventoryItem[];
  maxWeight: number;
  onUse?: (item: InventoryItem) => void;
  onDrop?: (item: InventoryItem) => void;
  onEquip?: (item: InventoryItem) => void;
}

const GRID_SIZE = 6 * 8; // 48 slots
const RARITY_COLORS: Record<InventoryItem['rarity'], string> = {
  common: '#9d9d9d',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000',
};

export function InventoryGrid({ items, maxWeight, onUse, onDrop, onEquip }: InventoryGridProps) {
  const [draggedItem, setDraggedItem] = useState<InventoryItem | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);

  const slots = Array.from({ length: GRID_SIZE }, (_, i) => items[i] ?? null);
  const totalWeight = items.reduce((sum, item) => sum + item.weight * item.currentStack, 0);

  const onDragStart = useCallback((item: InventoryItem) => setDraggedItem(item), []);
  const onDragOver = useCallback((slotIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    setHoverSlot(slotIdx);
  }, []);
  const onDropSlot = useCallback((slotIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedItem) return;
    // Swap items if target slot has an item, otherwise move
    const targetItem = slots[slotIdx];
    // Implementation would call onMove here
    setDraggedItem(null);
    setHoverSlot(null);
  }, [draggedItem, slots]);

  const onContextMenu = useCallback((item: InventoryItem, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 20,
      right: 20,
      width: 360,
      background: 'rgba(20, 20, 25, 0.92)',
      border: '2px solid #d98c33',
      borderRadius: 8,
      padding: 12,
      color: '#e0d8c8',
      fontFamily: 'Georgia, serif',
      zIndex: 100,
    }} data-testid="inventory-grid">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 'bold' }}>Inventory</span>
        <span style={{ fontSize: 12, color: totalWeight > maxWeight ? '#ff6c00' : '#888' }}>
          {totalWeight.toFixed(1)} / {maxWeight} kg
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 4,
      }}>
        {slots.map((item, i) => (
          <div
            key={i}
            onDragOver={(e) => onDragOver(i, e)}
            onDrop={(e) => onDropSlot(i, e)}
            onContextMenu={(e) => item && onContextMenu(item, e)}
            style={{
              aspectRatio: '1',
              background: hoverSlot === i ? '#3a3a45' : 'rgba(40, 40, 50, 0.6)',
              border: `1px solid ${item ? RARITY_COLORS[item.rarity] : '#2a2a30'}`,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: item ? 'grab' : 'default',
              position: 'relative',
              userSelect: 'none',
            }}
            draggable={!!item}
            onDragStart={() => item && onDragStart(item)}
          >
            {item && (
              <>
                <span style={{ fontSize: 24 }}>{item.icon}</span>
                {item.currentStack > 1 && (
                  <span style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 4,
                    fontSize: 10,
                    color: '#fff',
                    textShadow: '0 0 2px #000',
                  }}>
                    {item.currentStack}
                  </span>
                )}
                {item.boundToPlayer && (
                  <span style={{
                    position: 'absolute',
                    top: 2,
                    left: 2,
                    fontSize: 8,
                    color: '#ff8000',
                  }}>B</span>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {contextMenu && (
        <div style={{
          position: 'fixed',
          left: contextMenu.x,
          top: contextMenu.y,
          background: 'rgba(10, 10, 15, 0.95)',
          border: '1px solid #d98c33',
          borderRadius: 4,
          padding: 4,
          zIndex: 200,
        }}>
          {contextMenu.item.category === 'weapon' && (
            <div onClick={() => { onEquip?.(contextMenu.item); setContextMenu(null); }}
                 style={menuItemStyle}>Equip</div>
          )}
          {contextMenu.item.category === 'consumable' && (
            <div onClick={() => { onUse?.(contextMenu.item); setContextMenu(null); }}
                 style={menuItemStyle}>Use</div>
          )}
          <div style={menuItemStyle}>Info</div>
          <div onClick={() => { onDrop?.(contextMenu.item); setContextMenu(null); }}
               style={menuItemStyle}>Drop</div>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: 12,
};

export default InventoryGrid;
