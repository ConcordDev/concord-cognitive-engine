'use client';

/**
 * ThemeClusters — Dovetail-style theming. Create themes, see member pain
 * counts and aggregate impact, and run keyword auto-clustering to surface
 * theme suggestions from unthemed pain points. Wires theme-list,
 * theme-create, theme-delete, theme-autocluster.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, Layers, Sparkles, Pencil } from 'lucide-react';
import type { Theme } from './PainBoard';

interface ClusterSuggestion {
  suggestedName: string;
  painIds: string[];
  painTitles: string[];
}

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444'];

export function ThemeClusters({
  themes, unthemedCount, loading, onChanged,
}: {
  themes: Theme[];
  unthemedCount: number;
  loading: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ClusterSuggestion[] | null>(null);
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [themeForm, setThemeForm] = useState({ name: '', description: '', color: COLORS[0] });

  const run = useCallback(async (action: string, input: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    const res = await lensRun('suffering', action, input);
    setBusy(false);
    if (!res.data.ok) { setErr(res.data.error || `${action} failed`); return null; }
    onChanged();
    return res.data.result;
  }, [onChanged]);

  const create = useCallback(async () => {
    if (!name.trim()) { setErr('Theme name required'); return; }
    const ok = await run('theme-create', { name, color });
    if (ok) { setName(''); }
  }, [name, color, run]);

  const autocluster = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const res = await lensRun<{ suggestions: ClusterSuggestion[] }>('suffering', 'theme-autocluster', {});
    setBusy(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Auto-cluster failed'); return; }
    setSuggestions(res.data.result.suggestions);
  }, []);

  const applySuggestion = useCallback(async (s: ClusterSuggestion) => {
    const theme = await run('theme-create', { name: s.suggestedName, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    if (!theme) return;
    const themeId = (theme as { theme: { id: string } }).theme.id;
    for (const pid of s.painIds) {
      await lensRun('suffering', 'pain-update', { id: pid, themeId });
    }
    onChanged();
    setSuggestions((prev) => (prev ? prev.filter((x) => x !== s) : prev));
  }, [run, onChanged]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Layers className="w-4 h-4 text-neon-green" /> Themes
          <span className="text-xs text-gray-400">({themes.length})</span>
          {(loading || busy) && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <button
          onClick={autocluster}
          disabled={busy || unthemedCount < 2}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-green/20 text-neon-green rounded-lg text-sm hover:bg-neon-green/30 disabled:opacity-40"
          title={unthemedCount < 2 ? 'Need 2+ unthemed pain points' : 'Suggest themes by keyword overlap'}
        >
          <Sparkles className="w-4 h-4" /> Auto-cluster ({unthemedCount} unthemed)
        </button>
      </div>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}

      <div className="flex items-center gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New theme name"
          className="flex-1 bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm"
        />
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full ${color === c ? 'ring-2 ring-white' : ''}`}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-neon-green/[0.06] border border-neon-green/20 space-y-2">
          <p className="text-xs text-neon-green flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> {suggestions.length} suggested cluster{suggestions.length !== 1 ? 's' : ''}
          </p>
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="flex-1">
                <span className="font-medium capitalize">{s.suggestedName}</span>
                <span className="text-gray-400 ml-1.5">— {s.painTitles.join(', ')}</span>
              </span>
              <button
                onClick={() => applySuggestion(s)}
                className="px-2 py-1 bg-neon-green/20 text-neon-green rounded hover:bg-neon-green/30"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
      {suggestions && suggestions.length === 0 && (
        <p className="text-xs text-gray-400 mb-3">No keyword clusters found among unthemed pain points.</p>
      )}

      {themes.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">No themes yet.</p>
      ) : (
        <div className="space-y-1.5">
          {themes.map((t) => (
            <div key={t.id}>
              <div
                className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border-l-2"
                style={{ borderColor: t.color }}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-sm flex-1 truncate">{t.name}</span>
                <span className="text-[11px] text-gray-400">{t.painCount} pains · {t.openCount} open</span>
                <span className="text-xs font-bold text-neon-purple" title="Aggregate impact">{t.totalImpact}</span>
                <button
                  onClick={() => { setEditingTheme(editingTheme === t.id ? null : t.id); setThemeForm({ name: t.name, description: t.description || '', color: t.color }); }}
                  className="text-gray-500 hover:text-gray-200"
                  aria-label={`Edit theme ${t.name}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => run('theme-delete', { id: t.id })}
                  className="text-gray-600 hover:text-red-400"
                  aria-label="Delete theme"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {editingTheme === t.id && (
                <div className="mt-1.5 ml-4 space-y-2 rounded-lg bg-white/[0.02] border border-white/10 p-2.5">
                  <input value={themeForm.name} onChange={(e) => setThemeForm({ ...themeForm, name: e.target.value })}
                    aria-label="Edit theme name" placeholder="Theme name"
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-100" />
                  <input value={themeForm.description} onChange={(e) => setThemeForm({ ...themeForm, description: e.target.value })}
                    aria-label="Edit theme description" placeholder="Description"
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setThemeForm({ ...themeForm, color: c })}
                          className={`w-5 h-5 rounded-full ${themeForm.color === c ? 'ring-2 ring-white' : ''}`}
                          style={{ backgroundColor: c }} aria-label={`Theme color ${c}`} />
                      ))}
                    </div>
                    <button type="button" disabled={!themeForm.name.trim()}
                      onClick={async () => { const ok = await run('theme-update', { id: t.id, ...themeForm }); if (ok) setEditingTheme(null); }}
                      className="ml-auto px-2.5 py-1 rounded bg-neon-cyan/20 text-neon-cyan text-xs hover:bg-neon-cyan/30 disabled:opacity-40">Save changes</button>
                    <button type="button" onClick={() => setEditingTheme(null)}
                      className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
