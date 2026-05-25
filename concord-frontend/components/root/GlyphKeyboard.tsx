'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Keyboard, AlertCircle, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface GlyphToken { input: string; glyph: string; digit: number; name: string; }
interface GlyphName { glyph: string; name: string; digit: number; }
interface GlyphLookupResult {
  tokens: GlyphToken[];
  glyphString: string;
  decimal: number | null;
  names: GlyphName[];
}

/* Glyph keyboard input mode — type semantic names instead of pasting glyphs.
   Calls root.glyphLookup. The resolved glyph string is handed back to the
   caller so it can drop straight into the converter / playground. */
export function GlyphKeyboard({ onInsert }: { onInsert?: (glyphs: string) => void }) {
  const [terms, setTerms] = useState('');
  const [result, setResult] = useState<GlyphLookupResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async () => {
    if (!terms.trim()) { setError('Type one or more glyph names'); return; }
    setBusy(true); setError('');
    const r = await lensRun<GlyphLookupResult>('root', 'glyphLookup', { terms: terms.trim() });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data?.error || 'Could not resolve names'); }
  }, [terms]);

  const appendName = useCallback((name: string) => {
    setTerms((prev) => (prev.trim() ? `${prev.trim()} ${name}` : name));
  }, []);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Keyboard className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Glyph Keyboard</h2>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Type semantic names (Refusal, Pivot, Bridge, Refusal-Pivot…) or base-6 digits
        instead of pasting glyphs. Space- or comma-separated.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
          placeholder="Pivot Refusal Bridge"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }}
        />
        <button
          onClick={() => void lookup()}
          disabled={busy}
          className="px-4 py-2 bg-violet-700/50 hover:bg-violet-700/70 border border-violet-700 rounded-lg text-violet-100 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Keyboard className="w-4 h-4" />}
          Resolve
        </button>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />{error}
        </div>
      )}
      {result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl text-violet-300">{result.glyphString}</span>
            {result.decimal !== null && (
              <span className="text-sm text-emerald-300">= {result.decimal}</span>
            )}
            {onInsert && (
              <button
                onClick={() => onInsert(result.glyphString)}
                className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300">
                Insert into converter
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.tokens.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300">
                <span className="text-violet-300">{t.glyph}</span> {t.name} ({t.digit})
              </span>
            ))}
          </div>
          {/* Quick-pick name buttons sourced from the server's name table */}
          <div className="border-t border-gray-800 pt-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Quick add</div>
            <div className="flex flex-wrap gap-1.5">
              {result.names.map((n) => (
                <button key={n.glyph}
                  onClick={() => appendName(n.name)}
                  className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-violet-900/40 border border-gray-700 hover:border-violet-700 rounded text-gray-400 transition-colors">
                  <span className="text-violet-300">{n.glyph}</span> {n.name}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </section>
  );
}
