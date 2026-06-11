'use client';

import { LensShell } from '@/components/lens/LensShell';

// Translation lens — machine translation through Concord's local LLM.
// Wires the `translation` backend domain (translate / detect / batch /
// languages). No external API: text never leaves your server.

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const DOMAIN = 'translation';

interface Language {
  code: string;
  name: string;
}

export default function TranslationLens() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [formalities, setFormalities] = useState<string[]>(['neutral', 'formal', 'informal']);
  const [text, setText] = useState('');
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('es');
  const [formality, setFormality] = useState('neutral');
  const [output, setOutput] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the supported-language catalog (public read — no auth needed).
  useEffect(() => {
    let alive = true;
    lensRun<{ languages: Language[]; formalities: string[] }>(DOMAIN, 'languages', {})
      .then((res) => {
        if (!alive) return;
        const r = res.data?.result;
        if (r?.languages) setLanguages(r.languages);
        if (r?.formalities) setFormalities(r.formalities);
      })
      .catch(() => {/* catalog is best-effort */});
    return () => {
      alive = false;
    };
  }, []);

  const handleTranslate = async () => {
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
      } else {
        setError(res.data?.error || 'translation_unavailable');
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleDetect = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setDetected(null);
    try {
      const res = await lensRun<{ language: string; confidence: number | null }>(DOMAIN, 'detect', { text });
      if (res.data?.ok && res.data.result?.language) {
        const c = res.data.result.confidence;
        setDetected(`${res.data.result.language}${typeof c === 'number' ? ` (${Math.round(c * 100)}%)` : ''}`);
      } else {
        setError(res.data?.error || 'detection_unavailable');
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LensShell lensId="translation">
    <div style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Translation</h1>
      <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
        Machine translation on your own hardware — powered by the local LLM. Text never leaves your server.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          From
          <select value={source} onChange={(e) => setSource(e.target.value)} style={selStyle}>
            <option value="auto">Auto-detect</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          To
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={selStyle}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          Register
          <select value={formality} onChange={(e) => setFormality(e.target.value)} style={selStyle}>
            {formalities.map((fm) => (
              <option key={fm} value={fm}>{fm}</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text to translate…"
        rows={6}
        style={{ width: '100%', padding: 12, fontSize: 14, borderRadius: 8, border: '1px solid #444', background: 'transparent', color: 'inherit', marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={handleTranslate} disabled={busy || !text.trim()} style={btnStyle(true)}>
          {busy ? 'Working…' : 'Translate'}
        </button>
        <button onClick={handleDetect} disabled={busy || !text.trim()} style={btnStyle(false)}>
          Detect language
        </button>
        {detected && <span style={{ fontSize: 13, opacity: 0.8 }}>Detected: {detected}</span>}
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, border: '1px solid #a33', color: '#f88', fontSize: 13, marginBottom: 12 }}>
          {error === 'translation_unavailable'
            ? 'Translation engine unavailable — the local LLM is not responding. (No fabricated output is shown.)'
            : error}
        </div>
      )}

      {output && (
        <div style={{ padding: 16, borderRadius: 8, border: '1px solid #444', whiteSpace: 'pre-wrap', fontSize: 15 }}>
          {output}
        </div>
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
