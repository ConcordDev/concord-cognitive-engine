'use client';

/**
 * Translation lens panels — the Single, Batch and Document translate surfaces,
 * the glossary editor, and the Saved-translations list. Extracted from translation/page.tsx; wires the same
 * real `translation` backend macros (translate / detect / batch) via lensRun.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

export interface Language {
  code: string;
  name: string;
}

export interface GlossaryTerm {
  kind: 'glossary';
  source: string;
  target: string;
}

type GlossaryMiss = { source: string; target: string; index?: number };

function glossaryInput(glossary: GlossaryTerm[]) {
  return glossary.length ? { glossary: glossary.map((g) => ({ source: g.source, target: g.target })) } : {};
}

function GlossaryWarning({ misses }: { misses: GlossaryMiss[] }) {
  if (!misses.length) return null;
  return (
    <p data-testid="translation-glossary-misses" style={{ fontSize: 12, color: '#fbbf24', margin: '6px 0' }}>
      Glossary not followed for: {misses.map((m) => `"${m.source}" → "${m.target}"${m.index != null ? ` (line ${m.index + 1})` : ''}`).join(', ')}. Review before using.
    </p>
  );
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
  source, target, formality, onSave, glossary = [],
}: {
  source: string;
  target: string;
  formality: string;
  onSave: SaveFn;
  glossary?: GlossaryTerm[];
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [text, setText] = useState('');
  const [output, setOutput] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [misses, setMisses] = useState<GlossaryMiss[]>([]);
  const [copied, setCopied] = useState(false);

  const handleTranslate = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setOutput('');
    setMisses([]);
    setCopied(false);
    try {
      const res = await lensRun<{ translated: string; glossaryMisses?: GlossaryMiss[] }>(DOMAIN, 'translate', {
        text, sourceLanguage: source, targetLanguage: target, formality, ...glossaryInput(glossary),
      });
      if (res.data?.ok && res.data.result?.translated) {
        setOutput(res.data.result.translated);
        setMisses(res.data.result.glossaryMisses || []);
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
  }, [text, source, target, formality, glossary, addToast]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
    } catch {
      addToast({ type: 'error', message: 'Clipboard unavailable — select the text to copy it' });
    }
  }, [output, addToast]);

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
          <GlossaryWarning misses={misses} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              aria-label="Save translation"
              onClick={() =>
                onSave({ source, target, formality, input: text, output })
              }
              style={btnStyle(false)}
            >
              Save translation
            </button>
            <button aria-label="Copy translation" onClick={handleCopy} style={btnStyle(false)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
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
  target, formality, onSave, glossary = [],
}: {
  target: string;
  formality: string;
  onSave: SaveFn;
  glossary?: GlossaryTerm[];
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [batchText, setBatchText] = useState('');
  const [batchResults, setBatchResults] = useState<{ input: string; output: string }[] | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchMisses, setBatchMisses] = useState<GlossaryMiss[]>([]);

  const batchLines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);

  const handleBatchTranslate = useCallback(async () => {
    const items = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!items.length) return;
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    setBatchMisses([]);
    try {
      const res = await lensRun<{ translations: string[]; glossaryMisses?: GlossaryMiss[] }>(DOMAIN, 'batch', {
        items, targetLanguage: target, formality, ...glossaryInput(glossary),
      });
      if (res.data?.ok && Array.isArray(res.data.result?.translations)) {
        setBatchMisses(res.data.result.glossaryMisses || []);
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
  }, [batchText, target, formality, glossary, addToast]);

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

      <GlossaryWarning misses={batchMisses} />
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

// ── Document ──────────────────────────────────────────────────────────────────

const DOC_CHUNK_CHARS = 7000; // under the server's 8000-char batch cap
const DOC_CHUNK_ITEMS = 50;
const DOC_MAX_BYTES = 400_000;

// Split into paragraphs (blank-line separated) and pack into batch-sized chunks.
export function chunkDocument(text: string): { paragraphs: string[]; chunks: number[][]; tooLong: number | null } {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const chunks: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p.trim()) continue;
    if (p.length > DOC_CHUNK_CHARS) return { paragraphs, chunks: [], tooLong: i };
    if (cur.length && (len + p.length > DOC_CHUNK_CHARS || cur.length >= DOC_CHUNK_ITEMS)) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += p.length;
  }
  if (cur.length) chunks.push(cur);
  return { paragraphs, chunks, tooLong: null };
}

export function DocumentTranslatePanel({
  target, formality, glossary = [],
}: {
  target: string;
  formality: string;
  glossary?: GlossaryTerm[];
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [misses, setMisses] = useState<GlossaryMiss[]>([]);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (f: File | undefined) => {
    setResult(null); setError(null); setMisses([]); setProgress(null);
    if (!f) { setFile(null); return; }
    if (f.size > DOC_MAX_BYTES) { setError(`File is ${Math.round(f.size / 1000)} KB; the limit is ${DOC_MAX_BYTES / 1000} KB.`); return; }
    const text = await f.text();
    if (!text.trim()) { setError('That file has no text to translate.'); return; }
    setFile({ name: f.name, text });
  }, []);

  const run = useCallback(async () => {
    if (!file) return;
    const { paragraphs, chunks, tooLong } = chunkDocument(file.text);
    if (tooLong !== null) { setError(`Paragraph ${tooLong + 1} is longer than ${DOC_CHUNK_CHARS} characters; add a blank line to split it.`); return; }
    setBusy(true); setError(null); setResult(null); setMisses([]);
    const out = [...paragraphs];
    const allMisses: GlossaryMiss[] = [];
    try {
      for (let c = 0; c < chunks.length; c++) {
        setProgress({ done: c, total: chunks.length });
        const idx = chunks[c];
        const res = await lensRun<{ translations: string[]; glossaryMisses?: GlossaryMiss[] }>(DOMAIN, 'batch', {
          items: idx.map((i) => paragraphs[i]), targetLanguage: target, formality, ...glossaryInput(glossary),
        });
        if (!res.data?.ok || !Array.isArray(res.data.result?.translations)) {
          setError(`Stopped at part ${c + 1} of ${chunks.length}: ${friendlyError(res.data?.error || 'translation_unavailable')}`);
          return;
        }
        res.data.result.translations.forEach((t, k) => { out[idx[k]] = t; });
        for (const m of res.data.result.glossaryMisses || []) allMisses.push({ ...m, index: m.index != null ? idx[m.index] : undefined });
      }
      setProgress({ done: chunks.length, total: chunks.length });
      setResult(out.join('\n\n'));
      setMisses(allMisses);
      addToast({ type: 'success', message: `Translated ${file.name}`, duration: 2500 });
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }, [file, target, formality, glossary, addToast]);

  const download = useCallback(() => {
    if (!result || !file) return;
    const dot = file.name.lastIndexOf('.');
    const name = dot > 0 ? `${file.name.slice(0, dot)}.${target}${file.name.slice(dot)}` : `${file.name}.${target}.txt`;
    const url = URL.createObjectURL(new Blob([result], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, file, target]);

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="file"
          accept=".txt,.md,.markdown,.srt,.vtt,.csv,text/plain,text/markdown"
          aria-label="Document to translate"
          onChange={(e) => void onFile(e.target.files?.[0])}
          style={{ fontSize: 13 }}
        />
        <button aria-label="Translate document" onClick={run} disabled={busy || !file} style={btnStyle(true)}>
          {busy ? 'Working…' : 'Translate document'}
        </button>
        {progress && busy && (
          <span role="status" style={{ fontSize: 12, opacity: 0.7 }}>Part {progress.done + 1} of {progress.total}</span>
        )}
      </div>
      <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>
        Plain-text formats (.txt, .md, .srt, .vtt, .csv) up to {DOC_MAX_BYTES / 1000} KB. Paragraphs are translated in order and line structure is kept.
      </p>
      {error && (
        <div data-testid="translation-doc-error" role="alert" style={{ padding: 12, borderRadius: 8, border: '1px solid #a33', color: '#f88', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <GlossaryWarning misses={misses} />
      {result !== null ? (
        <div data-testid="translation-doc-result">
          <pre style={{ padding: 16, borderRadius: 8, border: '1px solid #444', whiteSpace: 'pre-wrap', fontSize: 14, maxHeight: 360, overflow: 'auto', fontFamily: 'inherit' }}>{result}</pre>
          <button aria-label="Download translated document" onClick={download} style={{ ...btnStyle(false), marginTop: 8 }}>Download</button>
        </div>
      ) : !error && !busy && (
        <div data-testid="translation-doc-empty" style={{ padding: 16, opacity: 0.55, fontSize: 14, fontStyle: 'italic' }}>
          {file ? `${file.name} is ready — press Translate document.` : 'No document yet — choose a text file above.'}
        </div>
      )}
    </>
  );
}

// ── Glossary ──────────────────────────────────────────────────────────────────

export function GlossaryEditor({
  terms, onAdd, onRemove,
}: {
  terms: { id: string; data: GlossaryTerm }[];
  onAdd: (t: GlossaryTerm) => void;
  onRemove: (id: string) => void;
}) {
  const [src, setSrc] = useState('');
  const [tgt, setTgt] = useState('');
  return (
    <details data-testid="translation-glossary" style={{ marginBottom: 16, fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', opacity: 0.8 }}>Glossary ({terms.length})</summary>
      <p style={{ opacity: 0.6, margin: '6px 0' }}>Terms are sent with every translation and checked in the result.</p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (src.trim() && tgt.trim()) { onAdd({ kind: 'glossary', source: src.trim(), target: tgt.trim() }); setSrc(''); setTgt(''); } }}
        style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}
      >
        <input aria-label="Glossary source term" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source term" maxLength={120} style={selStyle} />
        <input aria-label="Glossary target term" value={tgt} onChange={(e) => setTgt(e.target.value)} placeholder="Always translate as" maxLength={120} style={selStyle} />
        <button type="submit" aria-label="Add glossary term" disabled={!src.trim() || !tgt.trim()} style={btnStyle(false)}>Add</button>
      </form>
      {terms.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {terms.map((t) => (
            <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <span>{t.data.source} → {t.data.target}</span>
              <button aria-label={`Remove glossary term ${t.data.source}`} onClick={() => onRemove(t.id)} style={{ ...btnStyle(false), padding: '2px 8px', fontSize: 12 }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </details>
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
