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
import { Settings as SettingsIcon, Download, Upload, RotateCcw } from 'lucide-react';
import SettingsPanel from '@/components/world-lens/SettingsPanel';
import { SettingsNav } from './SettingsNav';
import { LensActionBar, type LensAction } from '@/components/lens/LensActionBar';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';

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

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `concord-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const next = JSON.parse(String(reader.result)) as SettingsPanelSettings;
          handleSave(next);
        } catch {
          // Malformed JSON — surface a toast in a follow-on; silent for now.
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [handleSave]);

  const handleReset = useCallback(() => {
    handleSave(DEFAULT_SETTINGS);
  }, [handleSave]);

  const lensActions: LensAction[] = [
    { id: 'export', label: 'Export', icon: <Download className="h-3.5 w-3.5" />, onClick: handleExport },
    { id: 'import', label: 'Import', icon: <Upload className="h-3.5 w-3.5" />, onClick: handleImport },
    { id: 'reset', label: 'Reset to defaults', icon: <RotateCcw className="h-3.5 w-3.5" />, onClick: handleReset },
  ];

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-lattice-void via-lattice-deep to-cyan-950/10 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <SettingsIcon className="h-6 w-6 animate-pulse text-neon-cyan" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <UtilityPageShell
      icon={SettingsIcon}
      title="Settings"
      subtitle="Graphics · Audio · Controls · Notifications · Privacy · Language"
      belowHeader={
        <>
          <SettingsNav active="general" />
          <div className="mt-2">
            <LensActionBar actions={lensActions} />
          </div>
        </>
      }
    >
      <SettingsPanel settings={settings} onSave={handleSave} onCancel={handleCancel} />
    </UtilityPageShell>
  );
}
