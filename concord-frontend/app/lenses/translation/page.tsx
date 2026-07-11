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
// Batch mode wires `translation.batch` (order-preserving array translation,
// one LLM pass, MAX_BATCH=50/MAX_TEXT_LEN=8000 per server/domains/
// translation.js) — a real, non-trivial macro that had no frontend caller
// before this pass. The natural surface for it is a multi-line "translate a
// list" workflow (the same shape DeepL/Google Translate's document mode
// offers): paste several lines, translate them together in one pass instead
// of N round-trips, then optionally save any result line to the same
// server-local Saved translations store the single-text flow uses.

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useUIStore } from '@/store/ui';

const DOMAIN = 'translation';

interface SavedTranslation {
  source: string;
  target: string;
  formality: string;
  input: string;
  output: string;
}

interface Language {
  code: string;
  name: string;
}

export default function TranslationLens() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [formalities, setFormalities] = useState<string[]>(['neutral', 'formal', 'informal']);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [text, setText] = useState('');
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('es');
  const [formality, setFormality] = useState('neutral');
  const [output, setOutput] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useUIStore((s) => s.addToast);

  // Batch mode — wires `translation.batch` (see header comment). Kept as
  // separate state from the single-text flow so switching modes never loses
  // in-progress single-text work.
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [batchText, setBatchText] = useState('');
  const [batchResults, setBatchResults] = useState<{ input: string; output: string }[] | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Saved translations — the generic per-user, server-LOCAL lens artifact store
  // (sovereignty intact: text still never leaves your server). Lets a user keep
  // and recall past translations. This is the lens's `persist` capability.
  const { items: saved, create: saveTranslation, remove: removeTranslation } =
    useLensData<SavedTranslation>(DOMAIN, 'translation', { noSeed: true });

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

  const handleTranslate = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setOutput('');
    try {
      const res = await lensRun<{ translated: string }>(DOMAIN, 'translate', {
        text,
        sourceLanguage: source,
        targetLanguage: target,
        formality,
      });
      if (res.data?.ok && res.data.result?.translated) {
        setOutput(res.data.result.translated);
        addToast({ type: 'success', message: 'Translation ready', duration: 2500 });
      } else {
        setError(res.data?.error || 'translation_unavailable');
        addToast({ type: 'error', message: 'Translation engine unavailable' });
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
      addToast({ type: 'error', message: 'Translation request failed' });
    } finally {
      setBusy(false);
    }
  }, [text, source, target, formality, addToast]);

  const handleDetect = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setDetected(null);
    try {
      const res = await lensRun<{ language: string; confidence: number | null }>(DOMAIN, 'detect', { text });
      if (res.data?.ok && res.data.result?.language) {
        const c = res.data.result.confidence;
        setDetected(`${res.data.result.language}${typeof c === 'number' && c > 0 ? ` (${Math.round(c * 100)}%)` : ''}`);
      } else {
        setError(res.data?.error || 'detection_unavailable');
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }, [text]);

  const batchLines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);

  const handleBatchTranslate = useCallback(async () => {
    const items = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!items.length) return;
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    try {
      const res = await lensRun<{ translations: string[] }>(DOMAIN, 'batch', {
        items,
        targetLanguage: target,
        formality,
      });
      if (res.data?.ok && Array.isArray(res.data.result?.translations)) {
        setBatchResults(items.map((input, i) => ({ input, output: res.data!.result!.translations[i] ?? '' })));
        addToast({ type: 'success', message: `Translated ${items.length} lines`, duration: 2500 });
      } else {
        setBatchError(res.data?.error || 'translation_unavailable');
        addToast({ type: 'error', message: 'Batch translation unavailable' });
      }
    } catch (e) {
      setBatchError(String((e as Error)?.message || e));
      addToast({ type: 'error', message: 'Batch translation request failed' });
    } finally {
      setBatchBusy(false);
    }
  }, [batchText, target, formality, addToast]);

  const friendlyError = (e: string) =>
    e === 'translation_unavailable'
      ? 'Translation engine unavailable — the local LLM is not responding. (No fabricated output is shown.)'
      : e === 'detection_unavailable'
      ? 'Language detection unavailable.'
      : e === 'batch_translation_malformed'
      ? 'The engine returned a malformed batch — please retry.'
      : /^too many items/.test(e)
      ? e + ' — split into smaller batches (max 50 lines).'
      : e;

  return (
    <LensShell lensId="translation">
      <div className="w-full max-w-[880px] mx-auto px-4 sm:px-6 py-6">
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Translation</h1>
        <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
          Machine translation on your own hardware — powered by the local LLM. Text never leaves your server.
        </p>

        {/* LOADING — catalog in flight */}
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
            {/* Mode toggle — Single reuses the existing translate/detect flow;
                Batch wires the real `translation.batch` macro (order-preserving
                array translation, one LLM pass) which previously had no UI. */}
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

            {mode === 'single' && (
              <>
                <textarea
                  aria-label="Text to translate"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter text to translate…"
                  rows={6}
                  style={{ width: '100%', padding: 12, fontSize: 14, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'inherit', marginBottom: 12 }}
                />

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                  <button aria-label="Translate text" onClick={handleTranslate} disabled={busy || !text.trim()} style={btnStyle(true)}>
                    {busy ? 'Working…' : 'Translate'}
                  </button>
                  <button aria-label="Detect language" onClick={handleDetect} disabled={busy || !text.trim()} style={btnStyle(false)}>
                    Detect language
                  </button>
                  {detected && (
                    <span data-testid="translation-detected" style={{ fontSize: 13, opacity: 0.8 }}>
                      Detected: {detected}
                    </span>
                  )}
                </div>

                {/* ERROR */}
                {error && (
                  <div
                    data-testid="translation-error"
                    role="alert"
                    style={{ padding: 12, borderRadius: 8, border: '1px solid #a33', color: '#f88', fontSize: 13, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <span>{friendlyError(error)}</span>
                    <button aria-label="Retry translation" onClick={handleTranslate} style={btnStyle(false)}>Retry</button>
                  </div>
                )}

                {/* READY */}
                {output && (
                  <div data-testid="translation-output" className="mb-4 animate-in fade-in duration-200 motion-reduce:animate-none">
                    <div style={{ padding: 16, borderRadius: 8, border: '1px solid #444', whiteSpace: 'pre-wrap', fontSize: 15 }}>
                      {output}
                    </div>
                    <button
                      aria-label="Save translation"
                      onClick={() =>
                        saveTranslation({
                          title: `${text.slice(0, 40) || 'Translation'} → ${target}`,
                          data: { source, target, formality, input: text, output },
                        })
                      }
                      style={{ ...btnStyle(false), marginTop: 8 }}
                    >
                      Save translation
                    </button>
                  </div>
                )}

                {/* EMPTY — idle, nothing translated yet */}
                {!output && !error && !busy && (
                  <div data-testid="translation-empty" style={{ padding: 16, opacity: 0.55, fontSize: 14, fontStyle: 'italic' }}>
                    Nothing translated yet — enter text above and press Translate.
                  </div>
                )}
              </>
            )}

            {mode === 'batch' && (
              <>
                <textarea
                  aria-label="Lines to batch translate"
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={'One line per item, up to 50 lines…\ne.g.\nGood morning\nHow are you?\nSee you tomorrow'}
                  rows={6}
                  style={{ width: '100%', padding: 12, fontSize: 14, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'inherit', marginBottom: 8, fontFamily: 'inherit' }}
                />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                  <button
                    aria-label="Translate all lines"
                    onClick={handleBatchTranslate}
                    disabled={batchBusy || !batchLines.length}
                    style={btnStyle(true)}
                  >
                    {batchBusy ? 'Working…' : `Translate all${batchLines.length ? ` (${batchLines.length})` : ''}`}
                  </button>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{batchLines.length}/50 lines</span>
                </div>

                {/* BATCH ERROR */}
                {batchError && (
                  <div
                    data-testid="translation-batch-error"
                    role="alert"
                    style={{ padding: 12, borderRadius: 8, border: '1px solid #a33', color: '#f88', fontSize: 13, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <span>{friendlyError(batchError)}</span>
                    <button aria-label="Retry batch translation" onClick={handleBatchTranslate} style={btnStyle(false)}>Retry</button>
                  </div>
                )}

                {/* BATCH READY */}
                {batchResults && batchResults.length > 0 && (
                  <ul
                    data-testid="translation-batch-results"
                    style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {batchResults.map((r, i) => (
                      <li key={i} style={{ padding: 12, borderRadius: 8, border: '1px solid #444', fontSize: 14 }}>
                        <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>{r.input}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                          <span>{r.output}</span>
                          <button
                            aria-label={`Save batch translation ${i + 1}`}
                            onClick={() =>
                              saveTranslation({
                                title: `${r.input.slice(0, 40) || 'Translation'} → ${target}`,
                                data: { source: 'auto', target, formality, input: r.input, output: r.output },
                              })
                            }
                            style={btnStyle(false)}
                          >
                            Save
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* BATCH EMPTY */}
                {!batchResults && !batchError && !batchBusy && (
                  <div data-testid="translation-batch-empty" style={{ padding: 16, opacity: 0.55, fontSize: 14, fontStyle: 'italic' }}>
                    Nothing translated yet — enter one item per line above and press Translate all.
                  </div>
                )}
              </>
            )}

            {/* Saved translations — recallable from the server-local artifact store; shared by both modes */}
            {saved.length > 0 && (
              <section data-testid="translation-saved" aria-label="Saved translations" style={{ marginTop: 8 }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, opacity: 0.8, marginBottom: 8 }}>Saved translations</h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {saved.map((it) => (
                    <li key={it.id} style={{ padding: 10, borderRadius: 8, border: '1px solid #333', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <span style={{ opacity: 0.9 }}>
                        <strong>{it.data.output}</strong>
                        <span style={{ opacity: 0.6 }}> · {it.data.source} → {it.data.target}</span>
                      </span>
                      <button aria-label={`Delete saved translation ${it.title}`} onClick={() => removeTranslation(it.id)} style={btnStyle(false)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </LensShell>
  );
}

const selStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #444',
  background: 'transparent',
  color: 'inherit',
  minWidth: 140,
};

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid #555',
    background: primary ? '#3b82f6' : 'transparent',
    color: primary ? '#fff' : 'inherit',
    fontSize: 14,
    cursor: 'pointer',
    opacity: 1,
  };
}
