'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import {
  SingleTranslatePanel,
  BatchTranslatePanel,
  DocumentTranslatePanel,
  GlossaryEditor,
  SavedTranslations,
  btnStyle,
  selStyle,
  type Language,
  type SavedTranslation,
  type GlossaryTerm,
} from '@/components/translation/TranslationPanels';

const DOMAIN = 'translation';

export default function TranslationLens() {
  useLensNav('translation');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [formalities, setFormalities] = useState<string[]>(['neutral', 'formal', 'informal']);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('es');
  const [formality, setFormality] = useState('neutral');
  const [mode, setMode] = useState<'single' | 'batch' | 'document'>('single');

  // Saved translations — the generic per-user, server-LOCAL lens artifact store
  // (sovereignty intact: text still never leaves your server). Shared by both modes.
  const { items: saved, create: saveTranslation, remove: removeTranslation } =
    useLensData<SavedTranslation>(DOMAIN, 'translation', { noSeed: true });

  const { items: glossaryItems, create: addGlossary, remove: removeGlossary } =
    useLensData<GlossaryTerm>(DOMAIN, 'glossary', { noSeed: true });
  const glossaryRows = useMemo(
    () => glossaryItems.filter((g) => g.data?.kind === 'glossary' && g.data.source && g.data.target),
    [glossaryItems],
  );
  const glossary = useMemo(() => glossaryRows.map((g) => g.data), [glossaryRows]);
  const onAddGlossary = useCallback((t: GlossaryTerm) => {
    addGlossary({ title: `${t.source} → ${t.target}`, data: t });
  }, [addGlossary]);

  const swap = useCallback(() => {
    if (source === 'auto') return;
    setSource(target);
    setTarget(source);
  }, [source, target]);

  const onSave = useCallback((t: SavedTranslation) => {
    saveTranslation({ title: `${t.input.slice(0, 40) || 'Translation'} → ${t.target}`, data: t });
  }, [saveTranslation]);

  // Load the supported-language catalog (public read — no auth needed).
  const loadCatalog = useCallback(() => {
    let alive = true;
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

  const focusInput = useCallback(() => {
    const el = mode === 'document'
      ? document.querySelector<HTMLElement>('input[aria-label="Document to translate"]')
      : document.querySelector<HTMLElement>(`textarea[aria-label="${mode === 'single' ? 'Text to translate' : 'Lines to batch translate'}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }, [mode]);

  useLensCommand(
    [
      { id: 'mode-single', keys: '1', description: 'Single translation', category: 'navigation' as const, action: () => setMode('single') },
      { id: 'mode-batch', keys: '2', description: 'Batch translate', category: 'navigation' as const, action: () => setMode('batch') },
      { id: 'mode-document', keys: '3', description: 'Translate a document', category: 'navigation' as const, action: () => setMode('document') },
      { id: 'translate-focus', keys: 'n', description: 'Write something to translate', category: 'actions' as const, action: focusInput },
    ],
    { lensId: 'translation' },
  );

  return (
    <LensShell lensId="translation" asMain={false}>
      <FirstRunTour lensId="translation" />
      <DepthBadge lensId="translation" size="sm" className="ml-2" />
      <div data-lens-theme="translation" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Translation</p>
        <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          Say it another way{who ? `, ${who}` : ''}
        </h1>
        <p className="mb-6 max-w-2xl text-[14px] text-zinc-500">
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
              <button
                role="tab"
                aria-selected={mode === 'document'}
                aria-label="Document translation mode"
                onClick={() => setMode('document')}
                style={btnStyle(mode === 'document')}
              >
                Document
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-3">
              {mode === 'single' && (
                <>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                  From
                  <select aria-label="Translate from" value={source} onChange={(e) => setSource(e.target.value)} style={selStyle}>
                    <option value="auto">Auto-detect</option>
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label="Swap languages"
                  title={source === 'auto' ? 'Pick a source language to swap' : 'Swap languages'}
                  onClick={swap}
                  disabled={source === 'auto'}
                  style={{ ...btnStyle(false), alignSelf: 'flex-end', opacity: source === 'auto' ? 0.4 : 1 }}
                >
                  ⇄
                </button>
                </>
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

            <GlossaryEditor terms={glossaryRows} onAdd={onAddGlossary} onRemove={removeGlossary} />

            {mode === 'single' ? (
              <SingleTranslatePanel source={source} target={target} formality={formality} onSave={onSave} glossary={glossary} />
            ) : mode === 'batch' ? (
              <BatchTranslatePanel target={target} formality={formality} onSave={onSave} glossary={glossary} />
            ) : (
              <DocumentTranslatePanel target={target} formality={formality} glossary={glossary} />
            )}

            <SavedTranslations saved={saved} onRemove={removeTranslation} />
          </>
        )}

        <CrossLensRecentsPanel lensId="translation" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={focusInput}
          title="Write something to translate (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Languages className="h-4 w-4" />
          Translate
        </button>
      </div>
    </LensShell>
  );
}
