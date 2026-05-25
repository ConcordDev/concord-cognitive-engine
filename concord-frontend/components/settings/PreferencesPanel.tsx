 
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Check, RotateCcw, Search } from 'lucide-react';

// A single settable preference, as advertised by `settings.list`.
interface PrefDef {
  key: string;
  section: string;
  label: string;
  type: 'boolean' | 'enum' | 'number';
  default: boolean | string | number;
  options: string[] | null;
  range: [number, number] | null;
}

interface ListResult {
  sections: string[];
  items: PrefDef[];
  localeLabels: Record<string, string>;
}

type PrefValue = boolean | string | number;

const SECTION_LABELS: Record<string, string> = {
  graphics: 'Graphics',
  audio: 'Audio & Subtitles',
  accessibility: 'Accessibility',
  language: 'Language & Region',
  notifications: 'Notifications',
};

/**
 * PreferencesPanel — the server-persisted settings surface. Every value
 * is fetched from `settings.get` and written through `settings.set`, so
 * preferences sync across devices instead of living only in localStorage.
 */
export function PreferencesPanel() {
  const [schema, setSchema] = useState<ListResult | null>(null);
  const [prefs, setPrefs] = useState<Record<string, PrefValue>>({});
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, getRes] = await Promise.all([
        lensRun<ListResult>('settings', 'list', {}),
        lensRun<{ prefs: Record<string, PrefValue>; overriddenKeys: string[]; syncedAt: string }>(
          'settings', 'get', {},
        ),
      ]);
      if (listRes.data?.ok && listRes.data.result) setSchema(listRes.data.result);
      else throw new Error(listRes.data?.error || 'failed to load settings schema');
      if (getRes.data?.ok && getRes.data.result) {
        setPrefs(getRes.data.result.prefs);
        setOverridden(new Set(getRes.data.result.overriddenKeys));
        setSyncedAt(getRes.data.result.syncedAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writePref = useCallback(async (key: string, value: PrefValue) => {
    setSavingKey(key);
    setSavedKey(null);
    try {
      const r = await lensRun<{ prefs: Record<string, PrefValue>; syncedAt: string }>(
        'settings', 'set', { key, value },
      );
      if (r.data?.ok && r.data.result) {
        setPrefs(r.data.result.prefs);
        setOverridden((prev) => new Set(prev).add(key));
        setSyncedAt(r.data.result.syncedAt);
        setSavedKey(key);
      } else {
        setError(r.data?.error || `failed to save ${key}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `failed to save ${key}`);
    } finally {
      setSavingKey(null);
    }
  }, []);

  const resetPref = useCallback(async (key: string) => {
    setSavingKey(key);
    try {
      const r = await lensRun<{ prefs: Record<string, PrefValue> }>('settings', 'reset', { key });
      if (r.data?.ok && r.data.result) {
        setPrefs(r.data.result.prefs);
        setOverridden((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } finally {
      setSavingKey(null);
    }
  }, []);

  // Search-within-settings: filter the schema by query string.
  const filteredSections = useMemo(() => {
    if (!schema) return [];
    const q = query.trim().toLowerCase();
    return schema.sections.map((section) => ({
      section,
      items: schema.items.filter(
        (it) =>
          it.section === section &&
          (!q ||
            it.label.toLowerCase().includes(q) ||
            it.key.toLowerCase().includes(q) ||
            section.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [schema, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading preferences…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        {syncedAt && (
          <span className="text-[10px] text-emerald-400/80 whitespace-nowrap">
            Synced to server
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
          {error}
        </p>
      )}

      {filteredSections.length === 0 && (
        <p className="text-xs text-gray-400 italic">No settings match &ldquo;{query}&rdquo;.</p>
      )}

      {filteredSections.map(({ section, items }) => (
        <section key={section}>
          <h3 className="text-sm font-semibold text-cyan-300 mb-3">
            {SECTION_LABELS[section] || section}
          </h3>
          <div className="space-y-2">
            {items.map((it) => (
              <PrefRow
                key={it.key}
                def={it}
                value={prefs[it.key]}
                localeLabels={schema?.localeLabels || {}}
                saving={savingKey === it.key}
                saved={savedKey === it.key}
                overridden={overridden.has(it.key)}
                onChange={(v) => writePref(it.key, v)}
                onReset={() => resetPref(it.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- one preference control ---------------------------------------------

function PrefRow({
  def, value, localeLabels, saving, saved, overridden, onChange, onReset,
}: {
  def: PrefDef;
  value: PrefValue;
  localeLabels: Record<string, string>;
  saving: boolean;
  saved: boolean;
  overridden: boolean;
  onChange: (v: PrefValue) => void;
  onReset: () => void;
}) {
  const labelFor = (opt: string) =>
    def.key === 'locale' && localeLabels[opt] ? localeLabels[opt] : opt;

  return (
    <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2">
      <div className="flex-1 min-w-0">
        <label htmlFor={`pref-${def.key}`} className="text-xs text-gray-200">
          {def.label}
        </label>
        {overridden && <span className="ml-2 text-[9px] text-amber-400/70">customized</span>}
      </div>

      {def.type === 'boolean' && (
        <button
          id={`pref-${def.key}`}
          role="switch"
          aria-checked={value === true}
          aria-label={def.label}
          onClick={() => onChange(value !== true)}
          disabled={saving}
          className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
            value === true ? 'bg-cyan-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              value === true ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      )}

      {def.type === 'enum' && def.options && (
        <select
          id={`pref-${def.key}`}
          value={String(value ?? def.default)}
          onChange={(e) => onChange(e.target.value)}
          disabled={saving}
          aria-label={def.label}
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          {def.options.map((o) => (
            <option key={o} value={o}>{labelFor(o)}</option>
          ))}
        </select>
      )}

      {def.type === 'number' && def.range && (
        <div className="flex items-center gap-2">
          <input
            id={`pref-${def.key}`}
            type="range"
            min={def.range[0]}
            max={def.range[1]}
            step={(def.range[1] - def.range[0]) / 100}
            value={Number(value ?? def.default)}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={saving}
            aria-label={def.label}
            className="w-32 accent-cyan-500"
          />
          <span className="text-[10px] text-gray-400 w-8 text-right tabular-nums">
            {Number(value ?? def.default).toFixed(2)}
          </span>
        </div>
      )}

      <div className="w-5 flex justify-center">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
        {!saving && saved && <Check className="w-3.5 h-3.5 text-emerald-400" />}
      </div>

      {overridden && (
        <button
          onClick={onReset}
          disabled={saving}
          aria-label={`Reset ${def.label} to default`}
          title="Reset to default"
          className="text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 rounded"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
