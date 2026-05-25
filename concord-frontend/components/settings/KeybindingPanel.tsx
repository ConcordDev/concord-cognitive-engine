 
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, RotateCcw, Keyboard } from 'lucide-react';

interface Binding {
  id: string;
  label: string;
  category: string;
  default: string;
  current: string;
  customized: boolean;
}

// Translate a KeyboardEvent into the `mod+shift+key` chord notation the
// backend stores. Mirrors the useLensCommand binding format.
function chordFromEvent(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  const key = e.key.toLowerCase();
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return null;
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

/**
 * KeybindingPanel — surfaces every registered keybinding and lets the user
 * remap it. Capture-mode listens for the next key chord and writes it
 * through `settings.rebindKey`.
 */
export function KeybindingPanel() {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; with: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ bindings: Binding[] }>('settings', 'keybindings', {});
      if (r.data?.ok && r.data.result) setBindings(r.data.result.bindings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rebind = useCallback(async (id: string, keys: string) => {
    setBusy(id);
    setConflict(null);
    try {
      const r = await lensRun<{ id: string; keys: string; conflict: string | null }>(
        'settings', 'rebindKey', { id, keys },
      );
      if (r.data?.ok && r.data.result) {
        if (r.data.result.conflict) {
          setConflict({ id, with: r.data.result.conflict });
        }
        await load();
      }
    } finally {
      setBusy(null);
      setCapturing(null);
    }
  }, [load]);

  const resetBinding = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const r = await lensRun('settings', 'resetKeybinding', { id });
      if (r.data?.ok) await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  // While a row is in capture mode, the next chord is bound to it.
  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (chord) void rebind(capturing, chord);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, rebind]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading keybindings…
      </div>
    );
  }

  const categories = [...new Set(bindings.map((b) => b.category))];

  return (
    <div className="space-y-4">
      {conflict && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded px-3 py-1.5">
          Chord conflicts with &ldquo;{conflict.with}&rdquo; — both will trigger.
        </p>
      )}
      {categories.map((cat) => (
        <div key={cat}>
          <h4 className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{cat}</h4>
          <div className="space-y-1.5">
            {bindings.filter((b) => b.category === cat).map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-1.5"
              >
                <span className="flex-1 text-xs text-gray-200">{b.label}</span>
                {b.customized && <span className="text-[9px] text-amber-400/70">remapped</span>}
                <button
                  onClick={() => setCapturing(capturing === b.id ? null : b.id)}
                  disabled={busy === b.id}
                  className={`min-w-[110px] text-center px-2 py-1 text-[11px] font-mono rounded border focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                    capturing === b.id
                      ? 'bg-cyan-600 border-cyan-500 text-white animate-pulse'
                      : 'bg-zinc-800 border-zinc-700 text-cyan-200 hover:border-cyan-600'
                  }`}
                >
                  {busy === b.id ? (
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                  ) : capturing === b.id ? (
                    'Press keys…'
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Keyboard className="w-3 h-3" />
                      {b.current}
                    </span>
                  )}
                </button>
                {b.customized && (
                  <button
                    onClick={() => resetBinding(b.id)}
                    disabled={busy === b.id}
                    aria-label={`Reset ${b.label} keybinding`}
                    title="Reset to default"
                    className="text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 rounded"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
