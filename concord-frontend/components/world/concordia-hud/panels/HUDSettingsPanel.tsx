'use client';
import { useEffect, useState } from 'react';
import { useHUDContext, type ExpertiseLevel } from '../HUDContextProvider';
import { LanguageSelector } from '@/components/common/LanguageSelector';
import {
  type HUDSettings,
  DEFAULT_HUD_SETTINGS as DEFAULT_SETTINGS,
  HUD_SETTINGS_STORAGE_KEY as STORAGE_KEY,
  HUD_SETTINGS_CHANGED_EVENT,
} from '@/lib/concordia/hud-settings';

const LEVELS: ExpertiseLevel[] = ['newcomer', 'standard', 'detailed', 'engineering'];

export function HUDSettingsPanel() {
  const expertise = useHUDContext((s) => s.expertiseLevel);
  const setExpertise = useHUDContext((s) => s.setExpertise);
  const [settings, setSettings] = useState<HUDSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch { /* invalid json — keep defaults */ }
  }, []);

  function update(key: keyof HUDSettings, value: boolean) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota / disabled */ }
      // Consumed by useHudSettings() → AmbientLayer / ContextPromptLayer gate
      // their badges on these toggles live.
      window.dispatchEvent(new CustomEvent(HUD_SETTINGS_CHANGED_EVENT, { detail: next }));
    }
  }

  function resetDismissedNudges() {
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem('concordia:dismissed-nudges'); } catch { /* noop */ }
      window.dispatchEvent(new CustomEvent('concordia:nudges-reset'));
    }
  }

  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Expertise level</h3>
      <div className="flex gap-1 mb-4">
        {LEVELS.map((lvl) => (
          <button key={lvl} type="button" onClick={() => setExpertise(lvl)} aria-label={`Set expertise ${lvl}`} aria-pressed={expertise === lvl} className={`text-[10px] px-2 py-1 rounded ${expertise === lvl ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>{lvl}</button>
        ))}
      </div>

      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Ambient signals</h3>
      <ul className="space-y-1 mb-3">
        {(Object.keys(settings) as Array<keyof HUDSettings>).filter((k) => k.startsWith('ambient_')).map((key) => (
          <li key={key} className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800 rounded px-2 py-1">
            <span className="text-xs text-zinc-300">{key.replace('ambient_', '')}</span>
            <label className="inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={settings[key]} onChange={(e) => update(key, e.target.checked)} aria-label={`Toggle ${key}`} className="accent-amber-600" />
            </label>
          </li>
        ))}
      </ul>

      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Other</h3>
      <ul className="space-y-1 mb-3">
        <li className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800 rounded px-2 py-1">
          <span className="text-xs text-zinc-300">Context prompts</span>
          <input type="checkbox" checked={settings.context_prompts} onChange={(e) => update('context_prompts', e.target.checked)} aria-label="Toggle context prompts" className="accent-amber-600" />
        </li>
        <li className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800 rounded px-2 py-1">
          <span className="text-xs text-zinc-300">Wheel animations</span>
          <input type="checkbox" checked={settings.wheel_animations} onChange={(e) => update('wheel_animations', e.target.checked)} aria-label="Toggle wheel animations" className="accent-amber-600" />
        </li>
      </ul>

      <button type="button" onClick={resetDismissedNudges} aria-label="Reset all dismissed nudges" className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
        Reset dismissed nudges
      </button>

      {/* Phase P — language picker. 10 locales, dropdown variant. */}
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2 mt-4">Language</h3>
      <LanguageSelector variant="dropdown" />
    </div>
  );
}
