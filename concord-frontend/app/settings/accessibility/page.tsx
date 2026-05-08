'use client';

/**
 * /settings/accessibility — canonical accessibility settings.
 *
 * Mounts the absorbed AccessibilityPanel with localStorage-backed
 * persistence. Distinct from /settings (general) so each surface stays
 * focused and screen-reader users can deep-link the accessibility
 * controls without paging through graphics/audio first.
 *
 * The two settings pages share a top nav strip rendered via the parent
 * layout-equivalent SettingsNav component. Apply-on-change (no save
 * button) — accessibility prefs should take effect immediately so
 * users can test changes without a round-trip.
 */

import { useCallback, useEffect, useState } from 'react';
import { Accessibility as AccessibilityIcon } from 'lucide-react';
import AccessibilityPanel from '@/components/world-lens/AccessibilityPanel';
import { SettingsNav } from '../SettingsNav';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';

const STORAGE_KEY = 'concord:settings:accessibility';

type AccessibilitySettings = Parameters<typeof AccessibilityPanel>[0]['settings'];

const DEFAULT_A11Y: AccessibilitySettings = {
  colorblindMode: 'none',
  textScale: 1.0,
  screenReader: false,
  keyboardNavigation: true,
  reducedMotion: false,
  subtitles: true,
  subtitleFontSize: 16,
  oneHandedMode: 'off',
  gameSpeed: 1.0,
  highContrast: false,
} as unknown as AccessibilitySettings;

function loadA11y(): AccessibilitySettings {
  if (typeof window === 'undefined') return DEFAULT_A11Y;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AccessibilitySettings) : DEFAULT_A11Y;
  } catch {
    return DEFAULT_A11Y;
  }
}

function saveA11y(s: AccessibilitySettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    // Apply-on-change: dispatch a custom event so global listeners
    // (e.g. reduced-motion → framer-motion config, text-scale → root
    // font-size, high-contrast → CSS class on <html>) can react in
    // realtime without polling.
    window.dispatchEvent(new CustomEvent('concord:a11y-changed', { detail: s }));
  } catch {
    // localStorage quota exceeded — silently degrade.
  }
}

export default function AccessibilitySettingsPage() {
  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_A11Y);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadA11y());
    setHydrated(true);
  }, []);

  const handleChange = useCallback((next: AccessibilitySettings) => {
    setSettings(next);
    saveA11y(next);
  }, []);

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-lattice-void via-lattice-deep to-cyan-950/10 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <AccessibilityIcon className="h-6 w-6 animate-pulse text-neon-cyan" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <UtilityPageShell
      icon={AccessibilityIcon}
      title="Accessibility"
      subtitle="Vision · Motion · Input · Subtitles · Game speed"
      showBackButton
      belowHeader={<SettingsNav active="accessibility" />}
    >
      <AccessibilityPanel settings={settings} onChange={handleChange} />
    </UtilityPageShell>
  );
}

