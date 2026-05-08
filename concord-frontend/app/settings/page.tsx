'use client';

/**
 * /settings — canonical settings surface. Mounts the absorbed
 * SettingsPanel (graphics / audio / controls / notifications / privacy /
 * language) with localStorage-backed persistence. Uses the AllSettings
 * shape from the absorbed component as the source of truth.
 *
 * Phase D follow-on: replaces the showcase mount in /lenses/ux-suite
 * with a real, persistent settings page. The ux-suite mount continues
 * to render with its mock so the gallery still demonstrates the shape.
 *
 * Persistence: localStorage key 'concord:settings' — JSON-serialised
 * AllSettings. Apply-on-save (no live mutation). The Cancel button
 * reverts in-memory state from localStorage. Navigation back is via
 * router.back() so the settings page slots naturally into any flow.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon } from 'lucide-react';
import SettingsPanel from '@/components/world-lens/SettingsPanel';

const STORAGE_KEY = 'concord:settings';

// AllSettings is not exported from the component, so we mirror the shape
// here as a structural type. The cast through `unknown` at the boundary
// keeps the type loose enough to round-trip through localStorage without
// dragging the full interface into this file.
type SettingsPanelSettings = Parameters<typeof SettingsPanel>[0]['settings'];

const DEFAULT_SETTINGS: SettingsPanelSettings = {
  graphics: {
    qualityPreset: 'high',
    shadows: true,
    particles: true,
    weatherEffects: true,
    buildingDetail: true,
    npcDensity: true,
  },
  audio: {
    master: 0.8,
    music: 0.6,
    ambient: 0.7,
    sfx: 0.7,
    dialogue: 0.9,
    spatialAudio: true,
  },
  controls: [
    { action: 'Move Up', key: 'W' },
    { action: 'Move Down', key: 'S' },
    { action: 'Move Left', key: 'A' },
    { action: 'Move Right', key: 'D' },
    { action: 'Interact', key: 'E' },
    { action: 'Attack', key: 'Space' },
  ],
  notifications: {
    citation: true,
    royalty: true,
    event: true,
    social: true,
    system: true,
    dailyDigest: false,
    dndStart: '22:00',
    dndEnd: '07:00',
  },
  privacy: {
    profileVisibility: 'public',
    worldVisibility: true,
    activityStatus: true,
    allowDMs: true,
  },
  language: {
    language: 'en',
    measurementUnit: 'metric',
    dateFormat: 'YYYY-MM-DD',
  },
} as unknown as SettingsPanelSettings;

function loadSettings(): SettingsPanelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return JSON.parse(raw) as SettingsPanelSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: SettingsPanelSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('concord:settings-saved', { detail: s }));
  } catch {
    // localStorage quota exceeded — toast handled via the global mutation
    // cache in Providers.tsx; here we silently fail since this isn't a
    // mutation, just a setter. Future commit can add a Sentry breadcrumb.
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsPanelSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  const handleSave = useCallback((next: SettingsPanelSettings) => {
    saveSettings(next);
    setSettings(next);
    router.back();
  }, [router]);

  const handleCancel = useCallback(() => {
    setSettings(loadSettings());
    router.back();
  }, [router]);

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <SettingsIcon className="h-6 w-6 animate-pulse text-cyan-400" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-md items-center gap-3">
          <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
            <SettingsIcon className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">Settings</h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Graphics · Audio · Controls · Notifications · Privacy · Language
            </p>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-md px-3 py-4 sm:px-6 sm:py-5">
        <SettingsPanel settings={settings} onSave={handleSave} onCancel={handleCancel} />
      </section>
    </main>
  );
}
