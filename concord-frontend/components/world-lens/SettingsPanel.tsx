'use client';

/**
 * World settings — quality, volumes, mouse, and live visibility.
 *
 * Values come from `settings.get` before Apply is enabled. The parent
 * `settings` prop is not the source of truth: an earlier page passed a
 * mismatched object and every slider rendered 0.00. Apply writes only the
 * keys that differ from the loaded baseline (`settings.setMany`), so a
 * click on an untouched form cannot replace saved volumes with defaults.
 * If the read fails, Apply stays disabled.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  preferenceUpdates,
  settingsFromPrefs,
  type GraphicsQuality,
  type WorldPreferenceSlice,
} from '@/lib/settings/world-settings-prefs';
import { applyLiveVisibility } from '@/components/settings/WorldVisibilityControl';

export type { GraphicsQuality };

export interface Settings extends WorldPreferenceSlice {
  renderScale: number;
  shadowQuality: 'off' | 'low' | 'high';
  antiAliasing: boolean;
  bloomEnabled: boolean;
  motionBlurEnabled: boolean;
  audioAmbientVolume: number;
  controlsInvertY: boolean;
  controlsKeybinds: Record<string, string>;
  language: 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh';
  chatFilterEnabled: boolean;
  showFps: boolean;
  showDamageNumbers: boolean;
  privacy: {
    worldVisibility: boolean;
  };
}

const DEFAULT_SETTINGS: Settings = {
  graphicsQuality: 'medium',
  renderScale: 1.0,
  shadowQuality: 'high',
  antiAliasing: true,
  bloomEnabled: true,
  motionBlurEnabled: false,
  audioMasterVolume: 0.7,
  audioMusicVolume: 0.6,
  audioSfxVolume: 0.8,
  audioAmbientVolume: 0.5,
  controlsInvertY: false,
  controlsMouseSensitivity: 1.0,
  controlsKeybinds: {
    move_forward: 'W',
    move_back: 'S',
    move_left: 'A',
    move_right: 'D',
    jump: 'Space',
    crouch: 'C',
    interact: 'E',
    inventory: 'I',
    vendor: 'V',
    map: 'M',
    quest_log: 'L',
    emote_wheel: 'B',
    chat: 'Enter',
  },
  language: 'en',
  chatFilterEnabled: true,
  showFps: false,
  showDamageNumbers: true,
  privacy: {
    worldVisibility: true,
  },
};

interface SettingsPanelProps {
  /** Ignored as a source of truth. Kept so existing callers still type-check. */
  settings?: Partial<Settings>;
  onChange?: (settings: Settings) => void;
  onClose?: () => void;
}

function withSlice(slice: WorldPreferenceSlice, visibility: boolean): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...slice,
    privacy: { worldVisibility: visibility },
  };
}

export function SettingsPanel({ onChange, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<WorldPreferenceSlice | null>(null);
  const [baselineVisible, setBaselineVisible] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visibilityNote, setVisibilityNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<{ prefs?: Record<string, unknown> }>('settings', 'get', {});
        if (cancelled) return;
        const prefs = r.data?.ok ? r.data.result?.prefs : null;
        if (!prefs || typeof prefs !== 'object') {
          setLoadError('Saved settings did not load. Apply stays off so this screen cannot overwrite them.');
          return;
        }
        const slice = settingsFromPrefs(prefs);
        setBaseline(slice);
        setBaselineVisible(true);
        setDraft(withSlice(slice, true));
        setHydrated(true);
      } catch {
        if (!cancelled) {
          setLoadError('Saved settings did not load. Apply stays off so this screen cannot overwrite them.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!hydrated || !draft || !baseline || saving) return;
    setSaving(true);
    setSaveError(null);
    const updates = preferenceUpdates(draft, baseline);
    if (Object.keys(updates).length > 0) {
      const r = await lensRun('settings', 'setMany', { updates });
      if (!r.data?.ok) {
        setSaving(false);
        setSaveError(r.data?.error || 'Could not save settings. Your saved values were left as they were.');
        return;
      }
      setBaseline(settingsFromPrefs({
        ...baselineToPrefs(baseline),
        ...updates,
      }));
    }
    const hidden = draft.privacy.worldVisibility === false;
    const wasHidden = baselineVisible === false;
    if (hidden !== wasHidden) {
      setVisibilityNote('Applying visibility change…');
      const { note } = await applyLiveVisibility(hidden);
      setBaselineVisible(draft.privacy.worldVisibility);
      setVisibilityNote(note);
    }
    setSaving(false);
    onChange?.(draft);
    onClose?.();
  };

  const reset = () => {
    if (!hydrated || !draft || !baseline) return;
    if (typeof window !== 'undefined' && !window.confirm('Reset volumes and quality to the account defaults? This overwrites your saved values.')) {
      return;
    }
    const slice = settingsFromPrefs({});
    setDraft(withSlice(slice, draft.privacy.worldVisibility));
  };

  return (
    <section
      data-testid="settings-panel"
      aria-label="World settings"
      className="rounded-xl border border-white/10 bg-zinc-950 p-4 text-zinc-100"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-vault text-2xl text-zinc-100">World settings</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close settings" className="text-zinc-400 hover:text-zinc-100">
            ×
          </button>
        )}
      </div>

      {!hydrated && !loadError && (
        <p data-testid="settings-hydrating" className="text-sm text-zinc-400">Loading saved settings…</p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-red-300">{loadError}</p>
      )}
      {saveError && (
        <p role="alert" className="mb-3 text-sm text-red-300">{saveError}</p>
      )}

      {draft && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-xs uppercase tracking-wide text-zinc-500">Graphics</legend>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Quality</span>
              <select
                aria-label="Quality"
                value={draft.graphicsQuality}
                onChange={(e) => update('graphicsQuality', e.target.value as GraphicsQuality)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              >
                {(['low', 'medium', 'high', 'ultra'] as GraphicsQuality[]).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs uppercase tracking-wide text-zinc-500">Audio</legend>
            <SliderRow label="Master" value={draft.audioMasterVolume} onChange={(v) => update('audioMasterVolume', v)} />
            <SliderRow label="Music" value={draft.audioMusicVolume} onChange={(v) => update('audioMusicVolume', v)} />
            <SliderRow label="SFX" value={draft.audioSfxVolume} onChange={(v) => update('audioSfxVolume', v)} />
          </fieldset>

          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-zinc-500">Controls</legend>
            <SliderRow
              label="Mouse Sensitivity"
              value={draft.controlsMouseSensitivity}
              min={0.1}
              max={4}
              step={0.1}
              onChange={(v) => update('controlsMouseSensitivity', v)}
            />
          </fieldset>

          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-zinc-500">Privacy</legend>
            <div className="flex items-center justify-between py-1 text-sm">
              <span>World Visible to Others</span>
              <button
                type="button"
                aria-pressed={draft.privacy.worldVisibility}
                onClick={() => update('privacy', { worldVisibility: !draft.privacy.worldVisibility })}
                className={`rounded border px-3 py-1 text-xs ${draft.privacy.worldVisibility ? 'border-teal-500/50 text-teal-100' : 'border-zinc-600 text-zinc-400'}`}
              >
                {draft.privacy.worldVisibility ? 'On' : 'Off'}
              </button>
            </div>
          </fieldset>
        </div>
      )}

      {visibilityNote && (
        <div role="status" className="mt-3 rounded border border-teal-800/50 bg-teal-950/40 px-3 py-2 text-xs text-teal-100">
          {visibilityNote}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={reset}
          disabled={!hydrated || saving}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
        >
          Reset to Defaults
        </button>
        <button
          type="button"
          data-testid="settings-apply"
          onClick={() => { void save(); }}
          disabled={!hydrated || saving}
          className="rounded bg-teal-400 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </section>
  );
}

function baselineToPrefs(slice: WorldPreferenceSlice): Record<string, unknown> {
  return {
    quality_preset: slice.graphicsQuality === 'low'
      ? 'potato'
      : slice.graphicsQuality === 'medium'
        ? 'balanced'
        : slice.graphicsQuality,
    audio_master_volume: slice.audioMasterVolume,
    audio_music_volume: slice.audioMusicVolume,
    audio_sfx_volume: slice.audioSfxVolume,
    mouse_sensitivity: slice.controlsMouseSensitivity,
  };
}

function SliderRow({
  label, value, min = 0, max = 1, step = 0.05, onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const shown = Number.isFinite(value) ? value : 0;
  return (
    <label className="flex items-center gap-3 py-1 text-sm">
      <span className="w-36 shrink-0">{label}</span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-teal-400"
      />
      <span data-testid={`settings-value-${label}`} className="w-12 text-right tabular-nums text-zinc-400">
        {shown.toFixed(2)}
      </span>
    </label>
  );
}

export { DEFAULT_SETTINGS };
export default SettingsPanel;
