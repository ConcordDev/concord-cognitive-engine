'use client';

/**
 * ArtPalettesPanel — saved color palettes, a color-theory harmony
 * generator and a two-color mixer.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Wand2, Droplet } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Palette { id: string; name: string; colors: string[] }

const SCHEMES = ['analogous', 'complementary', 'triadic', 'tetradic', 'split-complementary', 'monochromatic'];

/** `onPick` (in the Atelier) loads a clicked colour onto the brush. */
export function ArtPalettesPanel({ onPick }: { onPick?: (hex: string) => void } = {}) {
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseColor, setBaseColor] = useState('#3b82f6');
  const [scheme, setScheme] = useState('analogous');
  const [harmony, setHarmony] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [mixA, setMixA] = useState('#ff5500');
  const [mixB, setMixB] = useState('#0044ff');
  const [mixRatio, setMixRatio] = useState(0.5);
  const [mixed, setMixed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('art', 'palette-list', {});
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Could not load palettes.');
      setLoading(false);
      return;
    }
    setError(null);
    setPalettes(r.data?.result?.palettes || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const generate = async () => {
    const r = await lensRun('art', 'palette-harmony', { baseColor, scheme });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not generate harmony.'); return; }
    setError(null);
    setHarmony(r.data?.result?.colors || []);
  };

  const savePalette = async () => {
    if (!name.trim() || harmony.length === 0) { setError('Generate a harmony and name it first.'); return; }
    const r = await lensRun('art', 'palette-create', { name: name.trim(), colors: harmony });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setName('');
    setError(null);
    await refresh();
  };

  const delPalette = async (id: string) => {
    await lensRun('art', 'palette-delete', { id });
    await refresh();
  };

  const mix = async () => {
    const r = await lensRun('art', 'color-mix', { colorA: mixA, colorB: mixB, ratio: mixRatio });
    setMixed(r.data?.result?.mixed || null);
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-[color:var(--at-bad)] bg-[var(--at-bad-soft)] border border-[color:var(--at-bad)] rounded-lg px-3 py-2">{error}</div>}

      {/* Harmony generator */}
      <section className="bg-[var(--at-gesso)] border border-[color:var(--at-rule)] rounded-xl p-3 space-y-2.5">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[color:var(--at-ink-2)]">
          <Wand2 className="w-3.5 h-3.5 text-[color:var(--at-accent-text)]" /> Color harmony
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)}
            className="w-9 h-9 bg-transparent cursor-pointer" />
          <select value={scheme} onChange={(e) => setScheme(e.target.value)}
            className="bg-[var(--at-sunk)] border border-[color:var(--at-rule-2)] rounded-lg px-2 py-1.5 text-xs text-[color:var(--at-ink)] capitalize">
            {SCHEMES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
          </select>
          <button type="button" onClick={generate}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--at-accent)] hover:bg-[var(--at-accent)] text-[color:var(--at-accent-ink)] rounded-lg">Generate</button>
        </div>
        {harmony.length > 0 && (
          <>
            <div className="flex gap-1.5">
              {harmony.map((c) => (
                <button type="button" key={c} onClick={() => onPick?.(c)} aria-label={onPick ? `Load ${c} onto the brush` : c} className="flex-1 h-12 rounded-lg border border-[color:var(--at-rule-2)] flex items-end justify-center pb-1"
                  style={{ background: c }}>
                  <span className="text-[9px] font-mono bg-[var(--at-ink)] text-[color:var(--at-accent-ink)] px-1 rounded">{c}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input placeholder="Palette name" value={name} onChange={(e) => setName(e.target.value)}
                className="flex-1 bg-[var(--at-sunk)] border border-[color:var(--at-rule-2)] rounded-lg px-2 py-1.5 text-xs text-[color:var(--at-ink)]" />
              <button type="button" onClick={savePalette}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--at-raised)] hover:bg-[var(--at-press)] text-[color:var(--at-ink)] rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Save
              </button>
            </div>
          </>
        )}
      </section>

      {/* Color mixer */}
      <section className="bg-[var(--at-gesso)] border border-[color:var(--at-rule)] rounded-xl p-3 space-y-2.5">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[color:var(--at-ink-2)]">
          <Droplet className="w-3.5 h-3.5 text-[color:var(--at-accent-text)]" /> Color mixer
        </h3>
        <div className="flex items-center gap-2">
          <input type="color" value={mixA} onChange={(e) => setMixA(e.target.value)}
            className="w-9 h-9 bg-transparent cursor-pointer" />
          <input type="range" min={0} max={1} step={0.05} value={mixRatio}
            onChange={(e) => setMixRatio(Number(e.target.value))} className="flex-1 accent-[color:var(--at-accent)]" />
          <input type="color" value={mixB} onChange={(e) => setMixB(e.target.value)}
            className="w-9 h-9 bg-transparent cursor-pointer" />
          <button type="button" onClick={mix}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--at-accent)] hover:bg-[var(--at-accent)] text-[color:var(--at-accent-ink)] rounded-lg">Mix</button>
        </div>
        {mixed && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onPick?.(mixed)} aria-label={`Load ${mixed} onto the brush`} className="w-10 h-10 rounded-lg border border-[color:var(--at-rule-2)]" style={{ background: mixed }} />
            <span className="text-xs font-mono text-[color:var(--at-ink-2)]">{mixed}</span>
          </div>
        )}
      </section>

      {/* Saved palettes */}
      <section>
        <h3 className="text-xs font-semibold text-[color:var(--at-ink-2)] mb-2">Saved palettes</h3>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-[color:var(--at-muted)]"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : palettes.length === 0 ? (
          <p className="text-[11px] text-[color:var(--at-muted)] italic">No palettes saved yet.</p>
        ) : (
          <ul className="space-y-2">
            {palettes.map((p) => (
              <li key={p.id} className="bg-[var(--at-gesso)] border border-[color:var(--at-rule)] rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[color:var(--at-ink)]">{p.name}</span>
                  <button aria-label="Delete" type="button" onClick={() => delPalette(p.id)} className="text-[color:var(--at-faint)] hover:text-[color:var(--at-bad)]">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-1">
                  {p.colors.map((c, i) => (
                    <button type="button" key={i} onClick={() => onPick?.(c)} aria-label={`Load ${c} onto the brush`} className={cn('h-7 flex-1 rounded border border-[color:var(--at-rule-2)]')} style={{ background: c }} title={c} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
