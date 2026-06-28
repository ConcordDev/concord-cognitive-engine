'use client';

/**
 * CompileTool — multi-language transpile over tools.compile (esbuild:
 * ts/tsx/js/jsx, ES-target selection, sourcemaps, minify). Output is
 * shown with lightweight token highlighting, copy/download actions, and
 * a per-user compile history (tools.compile-history).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Play, Loader2, Copy, Download, History, Check, AlertTriangle } from 'lucide-react';

type Target = 'esnext' | 'es2022' | 'es2020' | 'es2017' | 'es2015';
type Loader = 'ts' | 'tsx' | 'js' | 'jsx';
type Format = 'esm' | 'cjs' | 'iife';

interface CompileWarning { text: string; line: number | null; column: number | null }
interface CompilePayload {
  code: string;
  map: string | null;
  warnings: CompileWarning[];
  engine: string;
  target: Target;
  loader: Loader;
  format: Format;
  minify: boolean;
  sourcemap: boolean;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  note?: string;
}
interface CompileHistoryItem {
  id: string; target: string; loader: string; format: string; minify: boolean;
  engine: string; inputBytes: number; outputBytes: number; warningCount: number;
  durationMs: number; at: string;
}

const TARGETS: Target[] = ['esnext', 'es2022', 'es2020', 'es2017', 'es2015'];
const LOADERS: Loader[] = ['ts', 'tsx', 'js', 'jsx'];
const FORMATS: Format[] = ['esm', 'cjs', 'iife'];

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|extends|import|export|default|new|async|await|typeof|interface|type|enum|public|private|readonly|=>)\b/g;

function highlight(code: string): { kind: 'kw' | 'str' | 'com' | 'txt'; text: string }[] {
  const tokens: { kind: 'kw' | 'str' | 'com' | 'txt'; text: string }[] = [];
  // Split on strings and comments first so keywords inside them aren't matched.
  const re = /(`[^`]*`|"[^"]*"|'[^']*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushPlain = (text: string) => {
    let idx = 0;
    let km: RegExpExecArray | null;
    KEYWORDS.lastIndex = 0;
    while ((km = KEYWORDS.exec(text)) !== null) {
      if (km.index > idx) tokens.push({ kind: 'txt', text: text.slice(idx, km.index) });
      tokens.push({ kind: 'kw', text: km[0] });
      idx = km.index + km[0].length;
    }
    if (idx < text.length) tokens.push({ kind: 'txt', text: text.slice(idx) });
  };
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) pushPlain(code.slice(last, m.index));
    const tok = m[0];
    tokens.push({ kind: tok.startsWith('/') ? 'com' : 'str', text: tok });
    last = m.index + tok.length;
  }
  if (last < code.length) pushPlain(code.slice(last));
  return tokens;
}

const COLOR: Record<string, string> = {
  kw: 'text-yellow-300', str: 'text-emerald-400', com: 'text-zinc-400', txt: 'text-yellow-100',
};

export function CompileTool() {
  const [src, setSrc] = useState(
    '// TypeScript → ES2022\ninterface Greeter { name: string }\nconst greet = (g: Greeter): string => `hello ${g.name}`;\nexport default greet;',
  );
  const [target, setTarget] = useState<Target>('es2022');
  const [loader, setLoader] = useState<Loader>('ts');
  const [format, setFormat] = useState<Format>('esm');
  const [minify, setMinify] = useState(false);
  const [sourcemap, setSourcemap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CompileHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await lensRun<{ history: CompileHistoryItem[]; total: number }>('tools', 'compile-history', { limit: 15 });
    if (r.data?.ok && r.data.result) setHistory(r.data.result.history);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistory(); }, []);

  const compile = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<CompilePayload>('tools', 'compile', {
      source: src, target, loader, format, minify, sourcemap,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
      loadHistory();
    } else {
      setResult(null);
      setError(r.data?.error || 'compile failed');
    }
  }, [src, target, loader, format, minify, sourcemap, loadHistory]);

  const copyOutput = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.code).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [result]);

  const downloadOutput = useCallback(() => {
    if (!result) return;
    const ext = result.format === 'cjs' ? 'cjs' : 'js';
    const blob = new Blob([result.code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compiled.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-yellow-700">Loader</span>
            <div className="flex gap-0.5 rounded border border-yellow-900/40 bg-yellow-950/30 p-0.5 text-xs">
              {LOADERS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLoader(l)}
                  aria-pressed={loader === l}
                  className={`rounded px-1.5 py-0.5 ${loader === l ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
                >{l}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-yellow-700">Target</span>
            <div className="flex gap-0.5 rounded border border-yellow-900/40 bg-yellow-950/30 p-0.5 text-xs">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  aria-pressed={target === t}
                  className={`rounded px-1.5 py-0.5 ${target === t ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
                >{t}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-yellow-700">Format</span>
            <div className="flex gap-0.5 rounded border border-yellow-900/40 bg-yellow-950/30 p-0.5 text-xs">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={`rounded px-1.5 py-0.5 ${format === f ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
                >{f}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-yellow-500">
            <input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} className="accent-yellow-500" />
            minify
          </label>
          <label className="flex items-center gap-1.5 text-xs text-yellow-500">
            <input type="checkbox" checked={sourcemap} onChange={(e) => setSourcemap(e.target.checked)} className="accent-yellow-500" />
            sourcemap
          </label>
        </div>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          className="h-40 w-full rounded border border-yellow-900/40 bg-black/40 p-2 font-mono text-xs text-yellow-100 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
          aria-label="Source code"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={compile}
            disabled={busy || !src.trim()}
            className="inline-flex items-center gap-2 rounded bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Compile
          </button>
        </div>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-yellow-900/40 bg-yellow-950/10 px-3 py-2 text-xs text-yellow-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Compiling…
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 font-mono text-xs text-red-300">
          <span className="min-w-0 break-words">{error}</span>
          <button
            onClick={compile}
            disabled={busy || !src.trim()}
            className="shrink-0 rounded border border-red-800/60 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-900/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {!busy && !error && !result && (
        <div className="rounded-lg border border-dashed border-yellow-900/40 bg-yellow-950/5 px-3 py-6 text-center text-xs text-yellow-700">
          Paste TypeScript/JSX above and press Compile — output appears here with copy, download, and per-build history.
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-yellow-900/40 bg-black/40">
          <div className="flex items-center justify-between border-b border-yellow-900/30 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-yellow-600">
              <span className="rounded bg-yellow-950/60 px-1.5 py-0.5">{result.engine}</span>
              <span>{result.target} · {result.format}</span>
              <span>{result.inputBytes}B → {result.outputBytes}B</span>
              <span>{result.durationMs}ms</span>
              {result.warnings.length > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {result.warnings.length} warning(s)
                </span>
              )}
            </div>
            <div className="flex gap-1">
              <button
                onClick={copyOutput}
                className="inline-flex items-center gap-1 rounded border border-yellow-800/60 px-2 py-1 text-[11px] text-yellow-400 hover:bg-yellow-900/30"
              >
                {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={downloadOutput}
                className="inline-flex items-center gap-1 rounded border border-yellow-800/60 px-2 py-1 text-[11px] text-yellow-400 hover:bg-yellow-900/30"
              >
                <Download className="h-3 w-3" aria-hidden /> Download
              </button>
            </div>
          </div>
          {result.note && (
            <p className="border-b border-yellow-900/30 px-3 py-1.5 text-[11px] text-amber-500">{result.note}</p>
          )}
          <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
            <code>
              {highlight(result.code).map((tok, i) => (
                <span key={i} className={COLOR[tok.kind]}>{tok.text}</span>
              ))}
            </code>
          </pre>
          {result.warnings.length > 0 && (
            <ul className="border-t border-yellow-900/30 px-3 py-2 text-[11px] text-amber-400">
              {result.warnings.map((w, i) => (
                <li key={i}>{w.line != null ? `L${w.line}: ` : ''}{w.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border border-yellow-900/30 bg-yellow-950/5 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
            <History className="h-3.5 w-3.5" aria-hidden /> Compile history
          </h4>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded px-2 py-1 text-[11px] text-yellow-600">
                <span>{h.loader} → {h.target} ({h.format}){h.minify ? ' · min' : ''}</span>
                <span className="text-yellow-700">{h.inputBytes}B→{h.outputBytes}B · {h.durationMs}ms · {h.engine}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
