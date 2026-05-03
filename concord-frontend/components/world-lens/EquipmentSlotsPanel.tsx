'use client';

/**
 * EquipmentSlotsPanel — visual loadout for the dual-hand combat system.
 * Two big slots (Right Hand / Left Hand), an Other slot row (head, body,
 * accessory), and a click-to-equip flow that pulls from /api/world/inventory.
 *
 * Two-handed weapons render across both hand slots with a banner ("TWO-HANDED")
 * so the player understands why both slots are taken.
 *
 * Equip flow:
 *   - Click an empty hand slot → opens an inline picker showing weapons of
 *     compatible handedness from inventory.
 *   - Click a filled slot → unequip prompt (single click clears).
 *   - POSTs /api/combat-flow/equip and dispatches concordia:loadout-changed
 *     so CombatInputController refreshes.
 */

import { useCallback, useEffect, useState } from 'react';

interface InventoryItem {
  id: string;
  item_name: string;
  item_type: string;
  weapon_class?: string | null;
  handedness?: 'right' | 'left' | 'two' | 'either' | null;
  quality?: string | null;
}

interface Loadout {
  rightHand: InventoryItem | null;
  leftHand:  InventoryItem | null;
  head?:     InventoryItem | null;
  body?:     InventoryItem | null;
  accessory?: InventoryItem | null;
}

interface Props {
  onClose?: () => void;
}

const SLOT_LABELS: Record<string, string> = {
  right_hand: 'Right Hand',
  left_hand:  'Left Hand',
  head:       'Head',
  body:       'Body',
  accessory:  'Accessory',
};

export default function EquipmentSlotsPanel({ onClose }: Props) {
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [pickerSlot, setPickerSlot] = useState<'right_hand' | 'left_hand' | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([
      fetch('/api/combat-flow/loadout', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
      fetch('/api/world/inventory',     { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
    ]).then(([loRes, invRes]) => {
      if (loRes?.ok) setLoadout(loRes.loadout);
      if (invRes?.items) setInventory(invRes.items);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const equip = useCallback(async (slot: 'right_hand' | 'left_hand', itemId: string | null) => {
    setBusy(true);
    try {
      await fetch('/api/combat-flow/equip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slot, itemId }),
      });
      window.dispatchEvent(new CustomEvent('concordia:loadout-changed'));
      refresh();
      setPickerSlot(null);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const isTwoHanded = !!(loadout?.rightHand && loadout?.leftHand && loadout.rightHand.id === loadout.leftHand.id);

  // Items eligible for the picker slot
  const eligibleForSlot = (slot: 'right_hand' | 'left_hand') => {
    return inventory.filter((it) => {
      // Anything weapon-y: explicit weapon_class OR item_type weapon/tool
      const looksWeaponish = it.weapon_class || ['weapon', 'tool'].includes((it.item_type || '').toLowerCase());
      if (!looksWeaponish) return false;
      const h = it.handedness || 'either';
      if (h === 'two') return true;
      if (h === 'either') return true;
      if (slot === 'right_hand') return (h as string) === 'right' || (h as string) === 'either';
      if (slot === 'left_hand')  return (h as string) === 'left'  || (h as string) === 'either';
      return false;
    });
  };

  return (
    <div className="bg-slate-950/95 border border-cyan-500/30 rounded-lg p-4 backdrop-blur-md max-w-md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-cyan-300 uppercase tracking-wider">Loadout</h3>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕</button>}
      </div>

      {/* Two-hand banner */}
      {isTwoHanded && (
        <div className="mb-3 px-2 py-1 bg-amber-500/20 border border-amber-400/40 rounded text-[10px] uppercase tracking-widest text-amber-200 text-center font-bold">
          Two-Handed
        </div>
      )}

      {/* Hand slots */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {(['right_hand', 'left_hand'] as const).map((slot) => {
          const item = slot === 'right_hand' ? loadout?.rightHand : loadout?.leftHand;
          const showAsTwo = isTwoHanded;
          return (
            <button
              key={slot}
              onClick={() => {
                if (item) equip(slot, null);
                else setPickerSlot(slot);
              }}
              disabled={busy}
              className={`relative h-24 rounded-md border-2 p-2 text-left transition-colors ${
                item ? 'border-cyan-400/60 bg-cyan-500/10 hover:bg-cyan-500/15'
                     : 'border-white/10 bg-slate-900/60 hover:bg-slate-900/80 border-dashed'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">
                {SLOT_LABELS[slot]}
              </div>
              {item ? (
                <>
                  <div className="text-sm text-white font-semibold truncate">{item.item_name}</div>
                  <div className="text-[10px] text-slate-400">
                    {item.weapon_class || item.item_type}
                    {item.handedness && item.handedness !== 'either' ? ` · ${item.handedness}` : ''}
                  </div>
                  {showAsTwo && (
                    <div className="absolute bottom-1 right-1 text-[9px] text-amber-300 font-mono">2H</div>
                  )}
                </>
              ) : (
                <div className="text-xs text-slate-500">empty — click to equip</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Picker */}
      {pickerSlot && (
        <div className="border border-cyan-500/30 rounded-md bg-slate-900/85 p-2 mb-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-cyan-300">
              Select for {SLOT_LABELS[pickerSlot]}
            </span>
            <button onClick={() => setPickerSlot(null)} className="text-slate-400 hover:text-white text-xs">cancel</button>
          </div>
          {eligibleForSlot(pickerSlot).length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-2">No compatible weapons. Craft or pick one up.</div>
          ) : (
            <div className="space-y-1">
              {eligibleForSlot(pickerSlot).map((it) => (
                <button
                  key={it.id}
                  onClick={() => equip(pickerSlot, it.id)}
                  disabled={busy}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-cyan-500/10 transition-colors flex items-center justify-between"
                >
                  <span className="text-xs text-white">{it.item_name}</span>
                  <span className="text-[10px] text-slate-500">
                    {it.weapon_class || it.item_type}
                    {it.handedness && it.handedness !== 'either' ? ` · ${it.handedness}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-[10px] text-slate-500 leading-relaxed">
        Tap E for right hand. Hold Shift + E for left hand. Two-handed weapons
        take both slots and route every E to a heavy two-hand swing. Combat
        Flow learns your loadout — sword + pistol builds different combos
        than dual daggers.
      </div>
    </div>
  );
}
