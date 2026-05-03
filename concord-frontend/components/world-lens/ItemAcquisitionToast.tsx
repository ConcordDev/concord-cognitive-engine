'use client';

import { useEffect, useState } from 'react';

/**
 * ItemAcquisitionToast — pop-up notification when the player acquires an
 * item (gather / craft / quest reward / drop). Stacks bottom-right.
 *
 * Listens for window event `concordia:item-acquired` with detail:
 *   { name: string, qty?: number, type?: string, rarity?: Rarity, iconHint?: string }
 *
 * Visual: rarity-coloured border, type-coloured glow, icon glyph (mapped
 * from type or iconHint), name + quantity, scale-in + slide-in animation,
 * 3.2s lifetime. Stack of up to 5 toasts; oldest culled when full.
 */

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface ItemEvent {
  id: number;
  name: string;
  qty: number;
  type: string;
  rarity: Rarity;
  iconHint?: string;
  createdAt: number;
}

const RARITY_BORDER: Record<Rarity, string> = {
  common:    'border-gray-400/60',
  uncommon:  'border-emerald-400/70',
  rare:      'border-sky-400/80',
  epic:      'border-fuchsia-400/85',
  legendary: 'border-yellow-300/95',
};

const RARITY_GLOW: Record<Rarity, string> = {
  common:    '0 0 12px rgba(156,163,175,0.4)',
  uncommon:  '0 0 14px rgba(52,211,153,0.55)',
  rare:      '0 0 16px rgba(56,189,248,0.6)',
  epic:      '0 0 18px rgba(232,121,249,0.7)',
  legendary: '0 0 22px rgba(253,224,71,0.85), 0 0 38px rgba(253,224,71,0.45)',
};

const RARITY_TEXT: Record<Rarity, string> = {
  common:    'text-gray-200',
  uncommon:  'text-emerald-200',
  rare:      'text-sky-200',
  epic:      'text-fuchsia-200',
  legendary: 'text-yellow-200',
};

const TYPE_ICON: Record<string, string> = {
  weapon:    '⚔',
  tool:      '⚒',
  armor:     '🛡',
  consumable:'⚱',
  potion:    '⚱',
  food:      '🍞',
  material:  '◆',
  resource:  '◆',
  trinket:   '✦',
  lamp:      '✦',
  book:      '✎',
  default:   '◇',
};

function pickIcon(type: string, iconHint?: string): string {
  if (iconHint) return iconHint;
  const t = (type || '').toLowerCase();
  for (const [k, v] of Object.entries(TYPE_ICON)) {
    if (t.includes(k)) return v;
  }
  return TYPE_ICON.default;
}

const TOAST_LIFE_MS = 3200;
const MAX_TOASTS = 5;

let _counter = 0;

export default function ItemAcquisitionToast() {
  const [items, setItems] = useState<ItemEvent[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { name?: string; qty?: number; type?: string; rarity?: Rarity; iconHint?: string }
        | undefined;
      if (!detail?.name) return;
      const item: ItemEvent = {
        id: ++_counter,
        name: detail.name,
        qty: Math.max(1, Math.floor(detail.qty ?? 1)),
        type: detail.type ?? 'material',
        rarity: detail.rarity ?? 'common',
        iconHint: detail.iconHint,
        createdAt: Date.now(),
      };
      setItems((prev) => {
        const next = [...prev, item];
        if (next.length > MAX_TOASTS) next.shift();
        return next;
      });
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, TOAST_LIFE_MS);
    };
    window.addEventListener('concordia:item-acquired', handler);
    return () => window.removeEventListener('concordia:item-acquired', handler);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((item) => {
        const age = (Date.now() - item.createdAt) / TOAST_LIFE_MS;
        const ageClamp = Math.max(0, Math.min(1, age));
        // Slide-in for first 18% of life; hold; fade-out for last 25%
        const slideIn = ageClamp < 0.18 ? 1 - ageClamp / 0.18 : 0;
        const opacity = ageClamp < 0.75 ? 1 : Math.max(0, 1 - (ageClamp - 0.75) / 0.25);
        const translateX = slideIn * 32;
        const scale = ageClamp < 0.10 ? 0.85 + (ageClamp / 0.10) * 0.15 : 1;
        return (
          <div
            key={item.id}
            className={`flex items-center gap-3 bg-slate-950/85 backdrop-blur-md px-4 py-2.5 rounded-md border-2 ${RARITY_BORDER[item.rarity]}`}
            style={{
              boxShadow: RARITY_GLOW[item.rarity],
              opacity,
              transform: `translateX(${translateX}px) scale(${scale})`,
              transition: 'transform 80ms ease-out, opacity 100ms',
              minWidth: '220px',
            }}
          >
            <div
              className={`flex items-center justify-center w-9 h-9 rounded ${RARITY_TEXT[item.rarity]} text-xl font-bold`}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                boxShadow: 'inset 0 0 10px rgba(253, 224, 71, 0.35), 0 0 8px rgba(253, 224, 71, 0.45)',
              }}
            >
              {pickIcon(item.type, item.iconHint)}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold truncate ${RARITY_TEXT[item.rarity]}`}>
                {item.name}
              </div>
              <div className="text-[11px] text-slate-400 uppercase tracking-wide">
                {item.rarity} · {item.type} · ×{item.qty}
              </div>
            </div>
            <div className="text-yellow-300 text-base font-black drop-shadow">
              +{item.qty}
            </div>
          </div>
        );
      })}
    </div>
  );
}
