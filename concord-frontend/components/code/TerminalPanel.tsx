'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X, Play, RotateCcw, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { isLocallyRunnable, runLocalScript } from './localExec';

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
  activeCode: string;
  activeLanguage: string;
  activeName: string;
  fontSize?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
}

type Line = { kind: 'system' | 'stdout' | 'stderr' | 'cmd' | 'result'; text: string; ts: number };

interface ExecResponseData {
  ok?: boolean;
  result?: {
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    supported?: unknown;
  } | null;
  error?: string | null;
}

/**
 * Map an execution response that did NOT run anything to a user-worded
 * line. Raw server codes (code_exec_host_retired, code_exec_forbidden, …)
 * are internal vocabulary and never reach the terminal.
 */
export function execFailureMessage(data: ExecResponseData | null | undefined): string {
  const raw = String(data?.error ?? '');
  if (raw.includes('code_exec_host_retired')) {
    return 'That didn’t run — server-side execution was retired for this surface. Nothing was executed.';
  }
  if (raw.includes('code_exec_forbidden')) {
    return 'That didn’t run — server execution is limited to founder and sovereign accounts. Nothing was executed.';
  }
  if (/^[a-z0-9_]+$/.test(raw.trim())) {
    return 'That didn’t run — the execution service refused the request. Nothing was executed.';
  }
  return raw
    ? `That didn’t run — ${raw}`
    : 'That didn’t run — the execution service returned no result. Nothing was executed.';
}

/** True only when the response carries a real execution result. */
export function isRealExecResult(data: ExecResponseData | null | undefined): boolean {
  if (!data || data.ok === false) return false;
  const result = data.result;
  if (!result || typeof result !== 'object') return false;
  if (result.supported === false) return false;
  return true;
}

/**
 * Terminal panel — xterm.js-grade output surface for the code lens.
 *
 * Not a full PTY (the lens isn't a shell). Instead:
 *   1) Run open file — streams stdout/stderr into the buffer; the final
 *      result row carries timing + exit code, and is printed ONLY when
 *      the code actually ran (see isRealExecResult). A refused or
 *      retired execution says so in user words; it never prints an
 *      exit line for a run that did not happen.
 *   2) Type a quick command and Enter — supported "commands":
 *        run                — run open file
 *        clear              — clear buffer
 *        help               — show built-ins
 *      Anything else is treated as a one-shot code snippet and held to
 *      the same honesty rule.
 *
 * Renders xterm.js when available; degrades to a styled <pre> if the lib
 * fails to load (sandboxed environments without WASM, etc.).
 */
export function TerminalPanel({ open, onClose, activeCode, activeLanguage, activeName, fontSize = 13, cursorStyle: _cursorStyle = 'block' }: TerminalPanelProps) {
  const xtermHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<{ write: (data: string) => void; clear: () => void; dispose: () => void } | null>(null);
  const [lines, setLines] = useState<Line[]>([
    { kind: 'system', text: 'Concord code terminal · type "help" for built-ins', ts: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [xtermReady, setXtermReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    (async () => {
      try {
        const xt = await import('@xterm/xterm');
        if (disposed || !xtermHostRef.current) return;
        const term = new xt.Terminal({
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          theme: {
            background: '#0a0e17',
            foreground: '#e2e8f0',
            cursor: '#00e5ff',
            black: '#1e293b',
            red: '#f87171',
            green: '#34d399',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#7dd3fc',
            white: '#e2e8f0',
          },
          convertEol: true,
          cursorBlink: true,
          allowProposedApi: true,
          scrollback: 5000,
        });
        term.open(xtermHostRef.current);
        xtermRef.current = {
          write: (d: string) => term.write(d),
          clear: () => term.clear(),
          dispose: () => term.dispose(),
        };
        setXtermReady(true);
        for (const ln of lines) {
          term.write(formatLineForXterm(ln) + '\r\n');
        }
      } catch (e) {
        console.warn('[Terminal] xterm.js failed to load, falling back', e);
        setXtermReady(false);
      }
    })();
    return () => {
      disposed = true;
      xtermRef.current?.dispose();
      xtermRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fontSize]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!xtermReady && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, xtermReady]);

  const appendLine = useCallback((line: Line) => {
    setLines(prev => [...prev.slice(-2000), line]);
    if (xtermRef.current) {
      xtermRef.current.write(formatLineForXterm(line) + '\r\n');
    }
  }, []);

  const clearBuffer = useCallback(() => {
    setLines([{ kind: 'system', text: 'Cleared.', ts: Date.now() }]);
    xtermRef.current?.clear();
  }, []);

  /**
   * Render one exec call's outcome. The exit line exists only on the
   * real-result path — a refused/retired execution gets the failure
   * line and nothing else.
   */
  const renderExecOutcome = useCallback((data: ExecResponseData | null | undefined, started: number) => {
    if (!isRealExecResult(data)) {
      appendLine({ kind: 'stderr', text: execFailureMessage(data), ts: Date.now() });
      return;
    }
    const result = data!.result!;
    if (result.stdout) appendLine({ kind: 'stdout', text: String(result.stdout), ts: Date.now() });
    if (result.stderr) appendLine({ kind: 'stderr', text: String(result.stderr), ts: Date.now() });
    if (!result.stdout && !result.stderr) appendLine({ kind: 'result', text: '(no output)', ts: Date.now() });
    const elapsed = Math.round(performance.now() - started);
    const exit = result.exitCode === undefined || result.exitCode === null ? '0' : String(result.exitCode);
    appendLine({ kind: 'result', text: `[exit ${exit} in ${elapsed}ms]`, ts: Date.now() });
  }, [appendLine]);

  /**
   * One run, from either engine. JavaScript/TypeScript run locally in
   * the browser (S1, PR #1707); everything else still goes to the
   * server macro, whose refusals render through the honesty guard.
   * A local timeout prints its partial output and a stopped line —
   * never an exit line, because the run produced no exit.
   */
  const runCode = useCallback(async (code: string, language: string, filename: string, started: number) => {
    if (isLocallyRunnable(language)) {
      const outcome = await runLocalScript({ code, language });
      const { result } = outcome;
      if (result.supported === false) {
        appendLine({ kind: 'stderr', text: `That didn’t run — ${result.stderr || 'this language is not runnable.'} Nothing was executed.`, ts: Date.now() });
        return;
      }
      if (result.stdout) appendLine({ kind: 'stdout', text: String(result.stdout), ts: Date.now() });
      if (result.stderr) appendLine({ kind: 'stderr', text: String(result.stderr), ts: Date.now() });
      if (!result.stdout && !result.stderr && !outcome.timedOut) appendLine({ kind: 'result', text: '(no output)', ts: Date.now() });
      if (outcome.timedOut) {
        appendLine({ kind: 'result', text: '[stopped — the code did not finish in time; output above is partial]', ts: Date.now() });
      } else {
        const elapsed = Math.round(performance.now() - started);
        appendLine({ kind: 'result', text: `[exit ${result.exitCode ?? 0} in ${elapsed}ms]`, ts: Date.now() });
      }
      return;
    }
    const res = await lensRun({
      domain: 'code',
      action: 'exec',
      input: { code, language, filename },
    });
    renderExecOutcome(res.data as ExecResponseData, started);
  }, [appendLine, renderExecOutcome]);

  const runActiveFile = useCallback(async () => {
    if (running) return;
    setRunning(true);
    const started = performance.now();
    appendLine({ kind: 'cmd', text: `▶ run ${activeName} (${activeLanguage})`, ts: Date.now() });
    try {
      await runCode(activeCode, activeLanguage, activeName, started);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'run failed';
      appendLine({ kind: 'stderr', text: `That didn’t run — ${msg}`, ts: Date.now() });
    } finally {
      setRunning(false);
    }
  }, [running, activeCode, activeLanguage, activeName, appendLine, runCode]);

  const handleSubmit = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    appendLine({ kind: 'cmd', text: `❯ ${cmd}`, ts: Date.now() });
    if (cmd === 'clear' || cmd === 'cls') { clearBuffer(); return; }
    if (cmd === 'help') {
      appendLine({ kind: 'system', text: 'Built-ins: run, clear, help. Anything else is run as a code snippet in the active file’s language.', ts: Date.now() });
      return;
    }
    if (cmd === 'run') { runActiveFile(); return; }
    setRunning(true);
    const started = performance.now();
    try {
      await runCode(cmd, activeLanguage, 'inline', started);
    } catch (e) {
      appendLine({ kind: 'stderr', text: `That didn’t run — ${e instanceof Error ? e.message : 'run failed'}`, ts: Date.now() });
    } finally {
      setRunning(false);
    }
  }, [input, activeLanguage, appendLine, clearBuffer, runActiveFile, runCode]);

  if (!open) return null;

  const height = maximised ? '70vh' : '32vh';

  return (
    <div
      className="border-t border-cyan-500/30 bg-[#0a0e17] flex flex-col"
      style={{ height }}
      data-terminal-panel
    >
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-[#0d1117]">
        <TerminalIcon className="w-4 h-4 text-cyan-400" />
        <span className="text-[11px] uppercase font-semibold tracking-wider text-gray-300">Terminal</span>
        <button
          onClick={runActiveFile}
          disabled={running}
          title="Run open file"
          className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Run
        </button>
        <button
          onClick={clearBuffer}
          title="Clear"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-white/10 text-gray-400 hover:text-white"
        >
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
        <span className="ml-auto text-[10px] text-gray-400">{xtermReady ? 'xterm.js' : 'fallback renderer'}</span>
        <button
          onClick={() => setMaximised(v => !v)}
          title={maximised ? 'Restore' : 'Maximise'}
          className="p-1 rounded text-gray-400 hover:text-white"
        >
          {maximised ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onClose}
          title="Close (⌃`)"
          className="p-1 rounded text-gray-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 min-h-0 relative">
        {xtermReady ? (
          <div ref={xtermHostRef} className="absolute inset-0" />
        ) : (
          <div
            ref={scrollRef}
            className="absolute inset-0 overflow-y-auto px-3 py-2 font-mono text-xs leading-5 text-gray-200"
            style={{ fontSize }}
          >
            {lines.map((ln, i) => (
              <div key={i} className={lineClass(ln.kind)}>
                {ln.kind === 'cmd' && <span className="text-cyan-400">{ln.text}</span>}
                {ln.kind === 'system' && <span className="text-gray-400 italic">{ln.text}</span>}
                {ln.kind === 'stdout' && <span className="whitespace-pre-wrap">{ln.text}</span>}
                {ln.kind === 'stderr' && <span className="text-red-400 whitespace-pre-wrap">{ln.text}</span>}
                {ln.kind === 'result' && <span className="text-green-400">{ln.text}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5 bg-[#0d1117]">
        <span className="text-cyan-400 text-xs font-mono">❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          disabled={running}
          placeholder='type "run", "clear", "help", or a code snippet…'
          className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30 font-mono"
        />
        {running && <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />}
      </footer>
    </div>
  );
}

function lineClass(kind: Line['kind']): string {
  switch (kind) {
    case 'cmd': return 'mt-1';
    case 'system': return 'opacity-70';
    case 'stderr': return 'mt-0.5';
    default: return '';
  }
}

function formatLineForXterm(ln: Line): string {
  const reset = '\x1b[0m';
  const color = ln.kind === 'cmd' ? '\x1b[36m' :
                ln.kind === 'system' ? '\x1b[90m' :
                ln.kind === 'stderr' ? '\x1b[31m' :
                ln.kind === 'result' ? '\x1b[32m' :
                '\x1b[37m';
  return `${color}${ln.text}${reset}`;
}

export default TerminalPanel;
