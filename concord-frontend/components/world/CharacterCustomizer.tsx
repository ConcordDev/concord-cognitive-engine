'use client';

import { useState, useCallback } from 'react';
import {
  User, Scissors, Smile, Shirt, PanelBottom, Footprints,
  Crown, Glasses, Backpack, Hand, Sparkles, Save, Check, Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ──────────────────────────── Types ──────────────────────────────

interface SlotDefinition {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
}

interface SlotOption {
  assetId: string;
  name: string;
  price: number; // 0 = base/free, >0 = marketplace CC cost
  color: string; // placeholder thumbnail color
}

interface CharacterCustomizerProps {
  currentProfile?: Record<string, string>; // slot -> assetId
  onSave?: (profile: Record<string, string>) => void;
  className?: string;
}

// ──────────────────────────── Slot Metadata ──────────────────────

const SLOTS: SlotDefinition[] = [
  { id: 'body', label: 'Body', icon: User },
  { id: 'hair', label: 'Hair', icon: Scissors },
  { id: 'face', label: 'Face', icon: Smile },
  { id: 'top', label: 'Top', icon: Shirt },
  { id: 'bottom', label: 'Bottom', icon: PanelBottom },
  { id: 'shoes', label: 'Shoes', icon: Footprints },
  { id: 'hat', label: 'Hat', icon: Crown },
  { id: 'glasses', label: 'Glasses', icon: Glasses },
  { id: 'back', label: 'Back', icon: Backpack },
  { id: 'hand', label: 'Hand', icon: Hand },
  { id: 'particle', label: 'Particle', icon: Sparkles },
];

// ──────────────────────────── Placeholder Data ──────────────────

const PLACEHOLDER_COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
  '#ef4444', '#22c55e', '#3b82f6', '#f97316', '#06b6d4',
];

function generateSlotOptions(slotId: string): SlotOption[] {
  const count = slotId === 'body' ? 5 : slotId === 'particle' ? 3 : 8;
  return Array.from({ length: count }, (_, i) => ({
    assetId: `${slotId}-${i + 1}`,
    name: `${slotId.charAt(0).toUpperCase() + slotId.slice(1)} ${i + 1}`,
    price: i < 3 ? 0 : (i + 1) * 50,
    color: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length],
  }));
}

const SKIN_TONES = [
  '#f9dcc4', '#f5c7a1', '#e8a87c', '#d08b5b', '#c67b4e',
  '#a96642', '#8d5524', '#704214', '#4a2c0a', '#2c1810',
  '#ff9999', '#cc99ff', '#99ccff', '#99ffcc', '#ffff99',
];

// ──────────────────────────── Component ─────────────────────────

export function CharacterCustomizer({
  currentProfile = {},
  onSave,
  className,
}: CharacterCustomizerProps) {
  const [activeSlot, setActiveSlot] = useState<string>('body');
  const [selections, setSelections] = useState<Record<string, string>>({ ...currentProfile });
  const [skinColor, setSkinColor] = useState<string>(currentProfile.skin ?? '#e8a87c');
  const [saving, setSaving] = useState(false);

  const handleSelectOption = useCallback((slotId: string, assetId: string) => {
    setSelections((prev) => {
      // Toggle off if already selected
      if (prev[slotId] === assetId) {
        const next = { ...prev };
        delete next[slotId];
        return next;
      }
      return { ...prev, [slotId]: assetId };
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const profile = { ...selections, skin: skinColor };
    try {
      onSave?.(profile);
    } finally {
      setTimeout(() => setSaving(false), 600);
    }
  }, [selections, skinColor, onSave]);

  const slotOptions = generateSlotOptions(activeSlot);
  const activeSlotDef = SLOTS.find((s) => s.id === activeSlot)!;

  return (
    <div className={cn('flex flex-col gap-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Character Customizer</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            saving
              ? 'bg-emerald-700 text-emerald-200 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white',
          )}
        >
          {saving ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saved!' : 'Save'}
        </button>
      </div>

      <div className="flex gap-4 min-h-[480px]">
        {/* ── Left Panel: Slot Categories ── */}
        <div className="flex flex-col gap-1 w-20 shrink-0">
          {SLOTS.map((slot) => {
            const Icon = slot.icon;
            const isActive = activeSlot === slot.id;
            const hasSelection = !!selections[slot.id];
            return (
              <button
                key={slot.id}
                onClick={() => setActiveSlot(slot.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs transition-colors relative',
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate w-full text-center">{slot.label}</span>
                {hasSelection && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Center Panel: Character Preview ── */}
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-zinc-950 border border-zinc-800 min-w-[200px]">
          {/* Placeholder avatar */}
          <div className="relative w-40 h-56 flex flex-col items-center justify-center">
            {/* Body silhouette */}
            <div
              className="w-20 h-20 rounded-full border-2 border-zinc-700"
              style={{ backgroundColor: skinColor }}
            />
            <div
              className="w-24 h-28 rounded-t-xl mt-1 border-2 border-zinc-700"
              style={{
                backgroundColor: selections.top
                  ? slotOptions.find((o) => o.assetId === selections.top)?.color ?? '#374151'
                  : '#374151',
              }}
            />

            {/* Equipped badges */}
            <div className="mt-4 flex flex-wrap gap-1 justify-center max-w-[180px]">
              {Object.entries(selections).map(([slotId, assetId]) => {
                const slotDef = SLOTS.find((s) => s.id === slotId);
                if (!slotDef) return null;
                const SlotIcon = slotDef.icon;
                return (
                  <span
                    key={slotId}
                    className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                  >
                    <SlotIcon className="h-3 w-3" />
                    {assetId.split('-')[1]}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-600">3D Preview</p>
        </div>

        {/* ── Right Panel: Slot Options Grid ── */}
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            {(() => { const Icon = activeSlotDef.icon; return <Icon className="h-4 w-4" />; })()}
            {activeSlotDef.label}
          </h3>

          <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-[420px] pr-1">
            {slotOptions.map((option) => {
              const isEquipped = selections[activeSlot] === option.assetId;
              return (
                <button
                  key={option.assetId}
                  onClick={() => handleSelectOption(activeSlot, option.assetId)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs transition-colors border',
                    isEquipped
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                  )}
                >
                  {/* Placeholder thumbnail */}
                  <div
                    className="w-full aspect-square rounded-md"
                    style={{ backgroundColor: option.color }}
                  />
                  <span className="truncate w-full text-center">{option.name}</span>
                  <span className={cn(
                    'text-[10px]',
                    option.price === 0 ? 'text-emerald-400' : 'text-amber-400',
                  )}>
                    {option.price === 0 ? 'Free' : `${option.price} CC`}
                  </span>
                  {isEquipped && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] text-indigo-300">
                      <Check className="h-3 w-3" /> Equipped
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom: Skin Tone Color Picker ── */}
      <div className="flex items-center gap-3 rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3">
        <Palette className="h-4 w-4 text-zinc-400 shrink-0" />
        <span className="text-xs text-zinc-400 shrink-0">Skin Tone</span>

        <div className="flex gap-1.5 flex-wrap">
          {SKIN_TONES.map((tone) => (
            <button
              key={tone}
              onClick={() => setSkinColor(tone)}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                skinColor === tone ? 'border-indigo-400 scale-110' : 'border-zinc-700',
              )}
              style={{ backgroundColor: tone }}
              aria-label={`Skin tone ${tone}`}
            />
          ))}
        </div>

        {/* Custom color input */}
        <input
          type="color"
          value={skinColor}
          onChange={(e) => setSkinColor(e.target.value)}
          className="h-7 w-7 rounded cursor-pointer border border-zinc-700 bg-transparent shrink-0"
          title="Custom skin color"
        />
      </div>
    </div>
  );
}
