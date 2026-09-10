'use client';

import { LensShell } from '@/components/lens/LensShell';

// Translation lens — machine translation through Concord's local LLM.
// Wires the REAL `translation` backend domain (languages / detect / translate
// / batch) via POST /api/lens/run. No external API: text never leaves your
// server.
//
// Four explicit UX states (pinned by tests/translation-lens-states.test.tsx):
//   LOADING — the language catalog is in flight (role=status, aria-busy)
//   ERROR   — a translate/detect call failed (role=alert) + Retry
//   EMPTY   — idle, no output yet (honest "nothing translated yet")
//   READY   — a real translation / detection result
// a11y: every select + textarea + button carries an accessible name.
//
// The Single / Batch translate surfaces and the Saved-translations list live
// in components/translation/TranslationPanels.tsx; this page owns the language
// catalog, the shared From/To/Register selectors, the mode toggle, and the
// server-local Saved store (useLensData → the real lens-artifact substrate).

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import {
  SingleTranslatePanel,
  BatchTranslatePanel,
  SavedTranslations,
  btnStyle,
  selStyle,
  type Language,
  type SavedTranslation,
} from '@/components/translation/TranslationPanels';

const DOMAIN = 'translation';

export default function TranslationLens() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [formalities, setFormalities] = useState<string[]>(['neutral', 'formal', 'informal']);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('es');
  const [formality, setFormality] = useState('neutral');
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // Saved translations — the generic per-user, server-LOCAL lens artifact store
  // (sovereignty intact: text still never leaves your server). Shared by both modes.
  const { items: saved, create: saveTranslation, remove: removeTranslation } =
    useLensData<SavedTranslation>(DOMAIN, 'translation', { noSeed: true });

  const onSave = useCallback((t: SavedTranslation) => {
    saveTranslation({ title: `${t.input.slice(0, 40) || 'Translation'} → ${t.target}`, data: t });
  }, [saveTranslation]);

  // Load the supported-language catalog (public read — no auth needed).
  const loadCatalog = useCallback(() => {
    let alive = true;
    setCatalogLoading(true);
    lensRun<{ languages: Language[]; formalities: string[] }>(DOMAIN, 'languages', {})
      .then((res) => {
        if (!alive) return;
        const r = res.data?.result;
        if (r?.languages) setLanguages(r.languages);
        if (r?.formalities) setFormalities(r.formalities);
      })
      .catch(() => {/* catalog is best-effort; the lens still works with codes */})
      .finally(() => { if (alive) setCatalogLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => loadCatalog(), [loadCatalog]);

  return (
    <LensShell lensId="translation">
      <div className="w-full max-w-[880px] mx-auto px-4 sm:px-6 py-6">
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Translation</h1>
        <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
          Machine translation on your own hardware — powered by the local LLM. Text never leaves your server.
        </p>

        {catalogLoading && (
          <div
            data-testid="translation-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="flex items-center gap-2 py-4 text-sm opacity-70"
          >
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading language catalog…
          </div>
        )}

        {!catalogLoading && (
          <>
            <div role="tablist" aria-label="Translation mode" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                role="tab"
                aria-selected={mode === 'single'}
                aria-label="Single translation mode"
                onClick={() => setMode('single')}
                style={btnStyle(mode === 'single')}
              >
                Single
              </button>
              <button
                role="tab"
                aria-selected={mode === 'batch'}
                aria-label="Batch translation mode"
                onClick={() => setMode('batch')}
                style={btnStyle(mode === 'batch')}
              >
                Batch translate
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-3">
              {mode === 'single' && (
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                  From
                  <select aria-label="Translate from" value={source} onChange={(e) => setSource(e.target.value)} style={selStyle}>
                    <option value="auto">Auto-detect</option>
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                To
                <select aria-label="Translate to" value={target} onChange={(e) => setTarget(e.target.value)} style={selStyle}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                Register
                <select aria-label="Formality register" value={formality} onChange={(e) => setFormality(e.target.value)} style={selStyle}>
                  {formalities.map((fm) => (
                    <option key={fm} value={fm}>{fm}</option>
                  ))}
                </select>
              </label>
            </div>

            {mode === 'single' ? (
              <SingleTranslatePanel source={source} target={target} formality={formality} onSave={onSave} />
            ) : (
              <BatchTranslatePanel target={target} formality={formality} onSave={onSave} />
            )}

            <SavedTranslations saved={saved} onRemove={removeTranslation} />
          </>
        )}
      </div>
    </LensShell>
  );
}
