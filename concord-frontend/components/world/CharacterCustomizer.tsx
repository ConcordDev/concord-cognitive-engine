'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  User, Scissors, Smile, Shirt, PanelBottom, Footprints,
  Crown, Glasses, Backpack, Hand, Sparkles, Save, Check, Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';

// ──────────────────────────── Types ──────────────────────────────

interface SlotDefinition {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
}

/**
 * A real renderable option from the `appearance.options` macro. `assetId` is
 * the exact enum value the avatar renderer + `appearance.save` expect; `name`
 * is the humanized label. `color` is present ONLY when the option genuinely is
 * a color swatch (skin tones / palette colors), never a placeholder thumbnail.
 * `owned` marks the player's saved cosmetics. There are NO fabricated prices.
 */
interface SlotOption {
  assetId: string;
  name: string;
  color?: string;
  owned?: boolean;
}

interface ColorOption {
  assetId: string;
  name: string;
  color: string;
}

interface AppearanceOptions {
  slots: Record<string, SlotOption[]>;
  skinTones: ColorOption[];
  colors: ColorOption[];
  savedOutfits: SlotOption[];
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

// ──────────────────────────── Component ─────────────────────────

export function CharacterCustomizer({
  currentProfile = {},
  onSave,
  className,
}: CharacterCustomizerProps) {
  const [activeSlot, setActiveSlot] = useState<string>('body');
  const [selections, setSelections] = useState<Record<string, string>>({ ...currentProfile });
  const [skinColor, setSkinColor] = useState<string>(currentProfile.skin ?? '');
  const [saving, setSaving] = useState(false);

  // Real options fetched from the backend. `null` = loading; an error sets
  // loadError and we render an honest empty state — NEVER fabricated options.
  const [options, setOptions] = useState<AppearanceOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await lensRun<AppearanceOptions>('appearance', 'options', {});
      if (cancelled) return;
      if (res.data.ok && res.data.result?.slots) {
        const result = res.data.result;
        setOptions(result);
        // Default the skin tone to the first real renderer-supported tone
        // (only if the player hasn't already picked one).
        setSkinColor((prev) => prev || result.skinTones?.[0]?.color || '');
      } else {
        setLoadError(res.data.error || 'Could not load appearance options.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
    const profile = { ...selections, ...(skinColor ? { skin: skinColor } : {}) };
    try {
      onSave?.(profile);
    } finally {
      setTimeout(() => setSaving(false), 600);
    }
  }, [selections, skinColor, onSave]);

  const activeSlotDef = SLOTS.find((s) => s.id === activeSlot)!;
  const slotOptions: SlotOption[] = options?.slots?.[activeSlot] ?? [];
  const skinTones: ColorOption[] = options?.skinTones ?? [];

  // ── Honest empty state: options failed to load. NO fabricated fallback. ──
  if (loadError) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center', className)}
        data-testid="customizer-load-error"
      >
        <Palette className="h-8 w-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-300">Couldn&apos;t load appearance options</p>
        <p className="text-xs text-zinc-500 max-w-xs">{loadError}</p>
      </div>
    );
  }

  // ── Loading state ──
  if (!options) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 p-8 min-h-[200px]', className)}
        data-testid="customizer-loading"
      >
        <p className="text-sm text-zinc-400 italic">Loading appearance options…</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-4', className)} data-testid="character-customizer">
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
          <div className="relative w-40 h-56 flex flex-col items-center justify-center">
            {/* Body silhouette — head tinted by chosen skin tone */}
            <div
              className="w-20 h-20 rounded-full border-2 border-zinc-700"
              style={skinColor ? { backgroundColor: skinColor } : undefined}
            />
            <div className="w-24 h-28 rounded-t-xl mt-1 border-2 border-zinc-700 bg-zinc-800" />

            {/* Equipped labels — show the real chosen enum value per slot */}
            <div className="mt-4 flex flex-wrap gap-1 justify-center max-w-[180px]">
              {Object.entries(selections).map(([slotId, assetId]) => {
                const slotDef = SLOTS.find((s) => s.id === slotId);
                if (!slotDef) return null;
                const SlotIcon = slotDef.icon;
                const opt = options.slots?.[slotId]?.find((o) => o.assetId === assetId);
                return (
                  <span
                    key={slotId}
                    className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                  >
                    <SlotIcon className="h-3 w-3" />
                    {opt?.name ?? assetId}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-400">3D Preview</p>
        </div>

        {/* ── Right Panel: Slot Options Grid ── */}
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            {(() => { const Icon = activeSlotDef.icon; return <Icon className="h-4 w-4" />; })()}
            {activeSlotDef.label}
          </h3>

          {slotOptions.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No options available for this slot.</p>
          ) : (
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
                    {/* Swatch only when the option genuinely is a color */}
                    {option.color ? (
                      <div
                        className="w-full aspect-square rounded-md border border-zinc-700"
                        style={{ backgroundColor: option.color }}
                      />
                    ) : (
                      <div className="w-full aspect-square rounded-md bg-zinc-900 border border-zinc-700/60 flex items-center justify-center">
                        {(() => { const Icon = activeSlotDef.icon; return <Icon className="h-5 w-5 text-zinc-600" />; })()}
                      </div>
                    )}
                    <span className="truncate w-full text-center">{option.name}</span>
                    {option.owned && (
                      <span className="text-[10px] text-emerald-400">Owned</span>
                    )}
                    {isEquipped && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] text-indigo-300">
                        <Check className="h-3 w-3" /> Equipped
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom: Skin Tone Color Picker (real renderer-supported tones) ── */}
      {skinTones.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3">
          <Palette className="h-4 w-4 text-zinc-400 shrink-0" />
          <span className="text-xs text-zinc-400 shrink-0">Skin Tone</span>

          <div className="flex gap-1.5 flex-wrap">
            {skinTones.map((tone) => (
              <button
                key={tone.assetId}
                onClick={() => setSkinColor(tone.color)}
                className={cn(
                  'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                  skinColor === tone.color ? 'border-indigo-400 scale-110' : 'border-zinc-700',
                )}
                style={{ backgroundColor: tone.color }}
                aria-label={`Skin tone ${tone.name}`}
                title={tone.name}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
