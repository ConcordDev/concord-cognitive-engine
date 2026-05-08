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
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Accessibility as AccessibilityIcon } from 'lucide-react';
import AccessibilityPanel from '@/components/world-lens/AccessibilityPanel';
import { SettingsNav } from '../SettingsNav';

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
  const router = useRouter();
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
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <AccessibilityIcon className="h-6 w-6 animate-pulse text-cyan-400" aria-hidden="true" />
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
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2 transition hover:bg-cyan-500/20"
            aria-label="Go back"
          >
            <AccessibilityIcon className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">Accessibility</h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Vision · Motion · Input · Subtitles · Game speed
            </p>
          </div>
        </div>
        <div className="mx-auto mt-3 max-w-screen-md">
          <SettingsNav active="accessibility" />
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-md px-3 py-4 sm:px-6 sm:py-5">
        <AccessibilityPanel settings={settings} onChange={handleChange} />
      </section>
    </main>
  );
}
