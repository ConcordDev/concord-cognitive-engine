'use client';

/**
 * Translation lens panels — the Single and Batch translate surfaces plus the
 * Saved-translations list. Extracted from translation/page.tsx; wires the same
 * real `translation` backend macros (translate / detect / batch) via lensRun.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

export interface Language {
  code: string;
  name: string;
}

export interface SavedTranslation {
  source: string;
  target: string;
  formality: string;
  input: string;
  output: string;
}

const DOMAIN = 'translation';

export const selStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #444',
  background: 'transparent',
  color: 'inherit',
  minWidth: 140,
};

export function btnStyle(primary: boolean): React.CSSProperties {
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

export function friendlyError(e: string): string {
  return e === 'translation_unavailable'
    ? 'Translation engine unavailable — the local LLM is not responding. (No fabricated output is shown.)'
    : e === 'detection_unavailable'
    ? 'Language detection unavailable.'
    : e === 'batch_translation_malformed'
    ? 'The engine returned a malformed batch — please retry.'
    : /^too many items/.test(e)
    ? e + ' — split into smaller batches (max 50 lines).'
    : e;
}

interface SaveFn {
  (t: SavedTranslation): void;
}

// ── Single ────────────────────────────────────────────────────────────────────

export function SingleTranslatePanel({
  source, target, formality, onSave,
}: {
  source: string;
  target: string;
  formality: string;
  onSave: SaveFn;
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [text, setText] = useState('');
  const [output, setOutput] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setOutput('');
    try {
      const res = await lensRun<{ translated: string }>(DOMAIN, 'translate', {
        text, sourceLanguage: source, targetLanguage: target, formality,
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

  return (
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

      {output && (
        <div data-testid="translation-output" className="mb-4 animate-in fade-in duration-200 motion-reduce:animate-none">
          <div style={{ padding: 16, borderRadius: 8, border: '1px solid #444', whiteSpace: 'pre-wrap', fontSize: 15 }}>
            {output}
          </div>
          <button
            aria-label="Save translation"
            onClick={() =>
              onSave({ source, target, formality, input: text, output })
            }
            style={{ ...btnStyle(false), marginTop: 8 }}
          >
            Save translation
          </button>
        </div>
      )}

      {!output && !error && !busy && (
        <div data-testid="translation-empty" style={{ padding: 16, opacity: 0.55, fontSize: 14, fontStyle: 'italic' }}>
          Nothing translated yet — enter text above and press Translate.
        </div>
      )}
    </>
  );
}

// ── Batch ─────────────────────────────────────────────────────────────────────

export function BatchTranslatePanel({
  target, formality, onSave,
}: {
  target: string;
  formality: string;
  onSave: SaveFn;
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [batchText, setBatchText] = useState('');
  const [batchResults, setBatchResults] = useState<{ input: string; output: string }[] | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const batchLines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);

  const handleBatchTranslate = useCallback(async () => {
    const items = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!items.length) return;
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    try {
      const res = await lensRun<{ translations: string[] }>(DOMAIN, 'batch', {
        items, targetLanguage: target, formality,
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

  return (
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
                    onSave({ source: 'auto', target, formality, input: r.input, output: r.output })
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

      {!batchResults && !batchError && !batchBusy && (
        <div data-testid="translation-batch-empty" style={{ padding: 16, opacity: 0.55, fontSize: 14, fontStyle: 'italic' }}>
          Nothing translated yet — enter one item per line above and press Translate all.
        </div>
      )}
    </>
  );
}

// ── Saved ─────────────────────────────────────────────────────────────────────

export function SavedTranslations({
  saved, onRemove,
}: {
  saved: { id: string; title: string; data: SavedTranslation }[];
  onRemove: (id: string) => void;
}) {
  if (saved.length === 0) return null;
  return (
    <section data-testid="translation-saved" aria-label="Saved translations" style={{ marginTop: 8 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, opacity: 0.8, marginBottom: 8 }}>Saved translations</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {saved.map((it) => (
          <li key={it.id} style={{ padding: 10, borderRadius: 8, border: '1px solid #333', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ opacity: 0.9 }}>
              <strong>{it.data.output}</strong>
              <span style={{ opacity: 0.6 }}> · {it.data.source} → {it.data.target}</span>
            </span>
            <button aria-label={`Delete saved translation ${it.title}`} onClick={() => onRemove(it.id)} style={btnStyle(false)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
