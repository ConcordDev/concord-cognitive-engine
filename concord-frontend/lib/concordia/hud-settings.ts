'use client';

// Concordia HUD settings — the single source of truth the HUDSettingsPanel
// writes and the HUD layers read. Before this module the settings panel
// persisted to localStorage and dispatched `concordia:hud-settings-changed`
// with NO consumer (toggles did nothing). This wires that event to a real,
// live-updating store the AmbientLayer / ContextPromptLayer gate their badges
// on, so flipping a toggle actually hides/shows the matching ambient signal.

import { useEffect, useState } from 'react';

export interface HUDSettings {
  ambient_calendar: boolean;
  ambient_refusal: boolean;
  ambient_pain: boolean;
  ambient_oxygen: boolean;
  ambient_health: boolean;
  ambient_schemes: boolean;
  ambient_crafts: boolean;
  context_prompts: boolean;
  wheel_animations: boolean;
}

export const DEFAULT_HUD_SETTINGS: HUDSettings = {
  ambient_calendar: true,
  ambient_refusal: true,
  ambient_pain: true,
  ambient_oxygen: true,
  ambient_health: true,
  ambient_schemes: true,
  ambient_crafts: true,
  context_prompts: true,
  wheel_animations: true,
};

export const HUD_SETTINGS_STORAGE_KEY = 'concordia:hud-settings';
export const HUD_SETTINGS_CHANGED_EVENT = 'concordia:hud-settings-changed';

/** Read the current settings from localStorage (SSR-safe; defaults on miss). */
export function readHudSettings(): HUDSettings {
  if (typeof window === 'undefined') return DEFAULT_HUD_SETTINGS;
  try {
    const raw = window.localStorage.getItem(HUD_SETTINGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_HUD_SETTINGS, ...JSON.parse(raw) };
  } catch { /* invalid json — keep defaults */ }
  return DEFAULT_HUD_SETTINGS;
}

/**
 * Live HUD settings — seeds from localStorage and re-reads whenever the
 * settings panel dispatches `concordia:hud-settings-changed` (with the new
 * settings in `detail`, so no extra storage round-trip needed).
 */
export function useHudSettings(): HUDSettings {
  const [settings, setSettings] = useState<HUDSettings>(DEFAULT_HUD_SETTINGS);

  useEffect(() => {
    // Initial read happens client-side to avoid SSR hydration mismatch.
    setSettings(readHudSettings());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as Partial<HUDSettings> | undefined;
      setSettings(detail ? { ...DEFAULT_HUD_SETTINGS, ...detail } : readHudSettings());
    };
    window.addEventListener(HUD_SETTINGS_CHANGED_EVENT, onChange as EventListener);
    return () => window.removeEventListener(HUD_SETTINGS_CHANGED_EVENT, onChange as EventListener);
  }, []);

  return settings;
}
