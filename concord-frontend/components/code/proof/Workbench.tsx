'use client';

/**
 * The Proof workbench: one editor, the Proof Strip always beside it.
 *
 *   rail · pane (Files / Search / History / Agent / Library) · editor + dock · Proof Strip
 *
 * Keyboard-first: every action is in the command list (⌘⇧P) with its key.
 * On a phone the three columns become three tabs: Files, Code, Proof.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { editor } from 'monaco-editor';
import { ArrowLeft, Files, Search, History, Sparkles, Library, X, Command as CommandIcon, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { code, languageOf, type CheckKey, type CheckStatus, type DiffHunk, type Ledger } from './proofApi';
import { useProject } from './useProject';
import { ProofStrip, type Busy } from './ProofStrip';
import { FilesPane, SearchPane, ChangesPane } from './SidePanes';
import { AgentPane, useProposals } from './AgentPane';
import { LibraryPane } from './LibraryPane';
import { Dock, type Blame, type DockTab, type Refs, type RunOutput } from './Dock';
import { ReviewView } from './ReviewView';
import { ProposalView } from './ProposalView';
import { Palette, type Command } from './Palette';
import { proveRun, proveTests, type TestRunReport } from './proofRunner';
import { PROOF_CODE_FONT, PROOF_EDITOR_THEME } from './proofTheme';
import { ProofSeal } from './ProofSeal';
import { gutterMarks } from './proofGutter';
import { isLocallyRunnable } from '../localExec';

const MonacoWrapper = dynamic(() => import('../MonacoWrapper'), { ssr: false, loading: () => <div className="h-full animate-pulse bg-[var(--pf-ink)]" role="status" aria-label="Loading editor" /> });

type Pane = 'files' | 'search' | 'changes' | 'agent' | 'library';
const PANES: { id: Pane; label: string; icon: typeof Files; key: string }[] = [
  { id: 'files', label: 'Files', icon: Files, key: '⌥1' },
  { id: 'search', label: 'Search', icon: Search, key: '⌥2' },
  { id: 'changes', label: 'History', icon: History, key: '⌥3' },
  { id: 'agent', label: 'Agent', icon: Sparkles, key: '⌥4' },
  { id: 'library', label: 'Library', icon: Library, key: '⌥5' },
];

type Center = { kind: 'edit' } | { kind: 'review'; push?: boolean } | { kind: 'proposal'; id: string } | { kind: 'diff'; path: string; hunks: DiffHunk[] };

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Workbench({ projectId, onExit }: { projectId: string; onExit: () => void }) {
  const ps = useProject(projectId);
  const agent = useProposals(ps, projectId);
  const narrow = useNarrow();
  const [pane, setPane] = useState<Pane | null>('files');
  const [mobileTab, setMobileTab] = useState<'files' | 'code' | 'proof'>('code');
  const [center, setCenter] = useState<Center>({ kind: 'edit' });
  const [dock, setDock] = useState<DockTab | null>(null);
  const [busy, setBusy] = useState<Busy>({});
  const [output, setOutput] = useState<RunOutput | null>(null);
  const [tests, setTests] = useState<TestRunReport | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [blame, setBlame] = useState<Blame | null>(null);
  const [palette, setPalette] = useState<'files' | 'commands' | null>(null);
  const [selection, setSelection] = useState('');
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [execStatus, setExecStatus] = useState<{ enabled: boolean; languages: string[] } | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const pendingReveal = useRef<{ path: string; line: number } | null>(null);

  const active = ps.buffers.find((b) => b.path === ps.active) || null;
  const allPaths = useMemo(() => (ps.tree || []).map((t) => t.path), [ps.tree]);
  const changedMarks = useMemo(() => new Map((ps.ledger?.changes || []).filter((c) => c.status !== 'deleted').map((c) => [c.path, c.status === 'added' ? 'A' : 'M'])), [ps.ledger]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (ps.error) { setToast(ps.error); ps.setError(null); } }, [ps.error, ps]);
  useEffect(() => {
    void (async () => {
      const r = await code<{ wasm: { enabled: boolean; allowed: boolean; languages: string[] } }>('exec-status');
      if (r.ok) setExecStatus({ enabled: !!(r.result.wasm?.enabled && r.result.wasm?.allowed), languages: r.result.wasm?.languages || [] });
    })();
  }, []);

  // Restore and keep the open tabs per project (code.layout-*).
  const restored = useRef(false);
  useEffect(() => {
    void (async () => {
      const r = await code<{ layout: { panes?: { path?: string }[] } | null }>('layout-get', { projectId });
      const paths = (r.ok && r.result.layout?.panes ? r.result.layout.panes : []).map((p) => p.path).filter((p): p is string => !!p);
      for (const p of paths.slice(0, 8)) await ps.openFile(p);
      restored.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const tabsKey = ps.buffers.map((b) => b.path).join('|');
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => { void code('layout-save', { projectId, orientation: 'horizontal', panes: ps.buffers.map((b) => ({ path: b.path })) }); }, 800);
    return () => clearTimeout(t);
  }, [tabsKey, projectId, ps.buffers]);

  const reveal = useCallback((rawPath: string, line: number | null) => {
    const path = rawPath.replace(/^\/+/, '');
    setCenter({ kind: 'edit' });
    if (narrow) setMobileTab('code');
    void ps.openFile(path);
    if (line) {
      pendingReveal.current = { path, line };
      const ed = editorRef.current;
      if (ed && ps.active === path) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus(); pendingReveal.current = null; }
    }
  }, [narrow, ps]);
  useEffect(() => {
    const p = pendingReveal.current; const ed = editorRef.current;
    if (p && ed && active && active.path === p.path && !active.loading) {
      setTimeout(() => { ed.revealLineInCenter(p.line); ed.setPosition({ lineNumber: p.line, column: 1 }); ed.focus(); }, 30);
      pendingReveal.current = null;
    }
  }, [active]);

  /** Save everything, then read the ledger fresh, so a run is measured against stored code. */
  const freshLedger = useCallback(async (): Promise<Ledger | null> => { await ps.saveAll(); return ps.refreshLedger(); }, [ps]);

  const runFile = useCallback(async (path?: string) => {
    const target = path || runTarget || ps.active;
    if (!target) { setToast('Open a file to run it.'); return; }
    if (!isLocallyRunnable(languageOf(target))) { setToast(`${target} is not something the browser can run (JavaScript, TypeScript or Python).`); return; }
    setBusy((b) => ({ ...b, run: `Running ${target.split('/').pop()}…` }));
    const l = await freshLedger();
    if (!l) { setBusy((b) => ({ ...b, run: undefined })); return; }
    const { outcome, attest } = await proveRun(l, target);
    const r = outcome.result;
    setOutput({ path: target, stdout: r.stdout || '', stderr: r.stderr || '', exitCode: outcome.ranLocally && typeof r.exitCode === 'number' ? r.exitCode : null, timedOut: outcome.timedOut, elapsedMs: outcome.elapsedMs, where: 'browser', note: attest.ok ? undefined : outcome.ranLocally ? attest.message : undefined });
    if (attest.ok) ps.setLedger(attest.result.proof);
    setDock('output');
    setBusy((b) => ({ ...b, run: undefined }));
  }, [runTarget, ps, freshLedger]);

  const runSandbox = useCallback(async () => {
    if (!active) return;
    const started = performance.now();
    const r = await code<{ stdout?: string; stderr?: string; exitCode?: number }>('sandbox-exec', { code: active.content, language: languageOf(active.path) });
    setOutput({ path: active.path, stdout: r.ok ? r.result.stdout || '' : '', stderr: r.ok ? r.result.stderr || '' : r.message, exitCode: r.ok ? r.result.exitCode ?? null : null, timedOut: false, elapsedMs: Math.round(performance.now() - started), where: 'sandbox', note: 'not recorded in the proof' });
    setDock('output');
  }, [active]);

  const runTests = useCallback(async () => {
    const l = await freshLedger();
    if (!l) return;
    if (!l.checks.tests.testFiles?.length) { setToast('This project has no test files yet. Ask the agent to write some.'); return; }
    setBusy((b) => ({ ...b, tests: 'Running…' }));
    const { report, attest } = await proveTests(l, allPaths, (p) => setBusy((b) => ({ ...b, tests: p.split('/').pop() })));
    setTests(report);
    if (attest.ok) ps.setLedger(attest.result.proof); else setToast(attest.message);
    setDock('tests');
    setBusy((b) => ({ ...b, tests: undefined }));
  }, [freshLedger, allPaths, ps]);

  const writeTests = useCallback(async () => {
    const target = ps.ledger?.changes.find((c) => c.code && !c.test && c.status !== 'deleted')?.path || ps.active;
    if (!target) { setToast('Open the file you want tests for.'); return; }
    setBusy((b) => ({ ...b, tests: 'Writing tests…' }));
    await ps.saveAll();
    const p = await agent.writeTests(target);
    setBusy((b) => ({ ...b, tests: undefined }));
    if (p) setCenter({ kind: 'proposal', id: p.id });
  }, [ps, agent]);

  const review = useCallback(async (push = false) => {
    const l = await freshLedger();
    if (!l || l.changes.length === 0) { setToast('Nothing has changed yet.'); return; }
    setCenter({ kind: 'review', push });
    if (narrow) setMobileTab('code');
  }, [freshLedger, narrow]);

  const editorWord = () => {
    const ed = editorRef.current; const model = ed?.getModel(); const pos = ed?.getPosition();
    if (!ed || !model || !pos) return null;
    return { word: model.getWordAtPosition(pos)?.word || '', pos };
  };
  const format = useCallback(async () => {
    if (!active) return;
    const r = await code<{ formatted: string }>('format-code', { code: active.content, language: active.language });
    if (r.ok && r.result.formatted !== active.content) ps.replace(active.path, r.result.formatted);
    setToast(r.ok ? 'Formatted.' : r.message);
  }, [active, ps]);
  const findRefs = useCallback(async () => {
    if (!active) return;
    const w = editorWord();
    await ps.save(active.path);
    const r = await code<Refs & { count: number }>('find-references', { projectId, path: active.path, symbol: w?.word, position: w ? { line: w.pos.lineNumber, column: w.pos.column } : undefined });
    if (r.ok) { setRefs(r.result); setDock('refs'); } else setToast(r.message);
  }, [active, projectId, ps]);
  const renameSymbol = useCallback(async () => {
    if (!active) return;
    const w = editorWord();
    if (!w?.word) { setToast('Put the cursor on a name to rename it.'); return; }
    const to = window.prompt(`Rename ${w.word} across the project to:`, w.word)?.trim();
    if (!to || to === w.word) return;
    await ps.saveAll();
    const r = await code<{ filesChanged: number; totalOccurrences: number; changed: { path: string }[] }>('rename-symbol', { projectId, path: active.path, symbol: w.word, from: w.word, to });
    if (!r.ok) { setToast(r.message); return; }
    setToast(`Renamed ${r.result.totalOccurrences} in ${r.result.filesChanged} file${r.result.filesChanged === 1 ? '' : 's'}. The proof re-checks.`);
    await ps.reload();
  }, [active, projectId, ps]);
  const explain = useCallback(async () => {
    if (!active) return;
    const text = selection || active.content;
    const r = await code<{ explanation: string }>('explain', { code: text.slice(0, 20000), path: active.path });
    setOutput({ path: active.path, stdout: r.ok ? r.result.explanation : '', stderr: r.ok ? '' : r.message, exitCode: null, timedOut: false, elapsedMs: 0, where: 'browser', note: 'explanation' });
    setDock('output');
  }, [active, selection]);
  const addBookmark = useCallback(async () => {
    const pos = editorRef.current?.getPosition();
    if (!active || !pos) return;
    const label = active.content.split('\n')[pos.lineNumber - 1]?.trim().slice(0, 60) || '';
    const r = await code('bookmark-add', { projectId, path: active.path, line: pos.lineNumber, label });
    setToast(r.ok ? `Bookmarked line ${pos.lineNumber}.` : r.message);
  }, [active, projectId]);
  const showBlame = useCallback(async () => {
    if (!active) return;
    await ps.save(active.path);
    const r = await code<Blame>('git-blame', { projectId, path: active.path });
    if (r.ok) { setBlame(r.result); setDock('blame'); } else setToast(r.message);
  }, [active, projectId, ps]);

  const commands: Command[] = [
    { id: 'save', label: 'Save all', kbd: '⌘S', run: () => void ps.saveAll() },
    { id: 'run', label: `Run ${runTarget || active?.path || 'file'} in the browser`, kbd: '⌘↵', run: () => void runFile(), disabled: !(runTarget || active) },
    { id: 'tests', label: 'Run the tests', kbd: '⌘⇧↵', run: () => void runTests() },
    { id: 'write-tests', label: 'Write tests for the changed file', run: () => void writeTests() },
    { id: 'review', label: 'Review the change', kbd: '⌥R', run: () => void review() },
    { id: 'push', label: 'Push to GitHub', run: () => void review(true), disabled: !ps.ledger?.canPush },
    { id: 'format', label: 'Format this file', kbd: '⌥⇧F', run: () => void format(), disabled: !active },
    { id: 'refs', label: 'Find references', kbd: '⇧F12', run: () => void findRefs(), disabled: !active },
    { id: 'rename', label: 'Rename symbol across the project', kbd: 'F2', run: () => void renameSymbol(), disabled: !active },
    { id: 'explain', label: 'Explain this code', run: () => void explain(), disabled: !active },
    { id: 'bookmark', label: 'Bookmark this line', run: () => void addBookmark(), disabled: !active },
    { id: 'blame', label: 'Blame: who changed each line', run: () => void showBlame(), disabled: !active },
    { id: 'problems', label: 'Show problems', run: () => setDock('problems') },
    { id: 'dock', label: 'Toggle the dock', kbd: '⌃`', run: () => setDock((d) => (d ? null : 'problems')) },
    ...PANES.map((p) => ({ id: `pane-${p.id}`, label: `Show ${p.label}`, kbd: p.key, run: () => { setPane(p.id); if (narrow) setMobileTab('files'); } })),
    ...(execStatus?.enabled ? [{ id: 'sandbox', label: 'Run in the server sandbox (Python / WAT)', run: () => void runSandbox(), disabled: !active || !execStatus.languages.includes(active.language) }] : []),
    { id: 'projects', label: 'Back to projects', run: onExit },
  ];
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const fire = (id: string) => { e.preventDefault(); e.stopPropagation(); commandsRef.current.find((c) => c.id === id && !c.disabled)?.run(); };
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') return fire('save');
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPalette('commands'); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPalette('files'); return; }
      if (mod && e.shiftKey && e.key === 'Enter') return fire('tests');
      if (mod && !e.shiftKey && e.key === 'Enter') return fire('run');
      if (e.ctrlKey && e.code === 'Backquote') return fire('dock');
      if (e.altKey && !mod && e.shiftKey && e.code === 'KeyF') return fire('format');
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyR') return fire('review');
      if (e.altKey && !mod && /^Digit[1-5]$/.test(e.code)) return fire(`pane-${PANES[Number(e.code.slice(5)) - 1].id}`);
      if (e.key === 'F2' && !mod) return fire('rename');
      if (e.key === 'F12' && e.shiftKey) return fire('refs');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const semantic = useMemo(() => (active ? {
    projectId, path: active.path,
    run: async (action: string, input: Record<string, unknown>) => { const r = await code<Record<string, unknown>>(action, input); return r.ok ? r.result : null; },
  } : undefined), [projectId, active?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const inlineCompletion = useCallback(async (c: { textBeforeCursor: string; textAfterCursor: string; language: string }) => {
    const r = await code<{ completion: string }>('tab-completion', { prefix: c.textBeforeCursor.slice(-3000), suffix: c.textAfterCursor.slice(0, 1000), language: c.language, maxTokens: 64 });
    return r.ok ? r.result.completion || '' : '';
  }, []);
  const [editorReady, setEditorReady] = useState(0);
  const gutter = useRef<editor.IEditorDecorationsCollection | null>(null);
  // Review and proposals swap the editor out; a new editor gets a new gutter.
  const onEditorReady = useCallback((ed: editor.IStandaloneCodeEditor) => { editorRef.current = ed; gutter.current = null; setEditorReady((n) => n + 1); }, []);

  // The proof's own diff in the editor gutter: lime for lines this change adds,
  // a coral notch where it removed lines. Drawn from code.proof-diff on the
  // saved file, and only when the editor holds exactly that saved text.
  const activeChange = ps.ledger?.changes.find((c) => c.path === active?.path && c.status !== 'deleted') || null;
  const activeLoaded = !!active && !active.loading;
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!gutter.current) gutter.current = ed.createDecorationsCollection();
    const coll = gutter.current;
    if (!activeChange || !activeLoaded || !ps.ledger) { coll.clear(); return; }
    let live = true;
    void (async () => {
      const r = await code<{ after: string; hunks: DiffHunk[] }>('proof-diff', { projectId: ps.ledger!.projectId, path: activeChange.path });
      const model = ed.getModel();
      if (!live || !model) return;
      if (!r.ok || model.getValue() !== r.result.after) { coll.clear(); return; }
      const m = gutterMarks(r.result.hunks, model.getLineCount());
      coll.set([
        ...m.added.map((line) => ({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'pf-gutter-add', className: 'pf-line-add' } })),
        ...m.removedAbove.map((line) => ({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { linesDecorationsClassName: 'pf-gutter-del' } })),
      ]);
    })();
    return () => { live = false; };
  }, [activeChange?.path, activeChange?.hash, activeLoaded, ps.ledger?.codeFingerprint, editorReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSelection = useCallback((s: { text: string }) => setSelection(s.text), []);
  const editorOptions = useMemo(() => ({ fontFamily: PROOF_CODE_FONT, fontSize: 13, lineHeight: 20, fontLigatures: false, minimap: { enabled: false }, bracketPairColorization: { enabled: false }, automaticLayout: true, padding: { top: 10, bottom: 10 }, renderLineHighlight: 'line' as const, cursorBlinking: 'solid' as const, smoothScrolling: false, cursorSmoothCaretAnimation: 'off' as const, glyphMargin: false, lineDecorationsWidth: 12, folding: true, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }), []);

  const insertAtCursor = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) { setToast('Open a file first.'); return; }
    const sel = ed.getSelection();
    if (sel) ed.executeEdits('proof-snippet', [{ range: sel, text, forceMoveMarkers: true }]);
    ed.focus();
  }, []);

  const proposal = center.kind === 'proposal' ? agent.proposals.find((p) => p.id === center.id) : null;
  const openProposals = agent.proposals.filter((p) => p.status === 'open');

  const strip = (
    <ProofStrip
      ledger={ps.ledger}
      busy={busy}
      onOpenProblem={reveal}
      onRunTests={() => void runTests()}
      onWriteTests={() => void writeTests()}
      onRun={(p) => void runFile(p)}
      onReview={() => void review()}
      onPush={() => void review(true)}
      className={narrow ? 'h-full w-full border-l-0' : 'w-[300px] flex-shrink-0 xl:w-[320px]'}
    />
  );

  const paneEl = pane && (
    <div className={cn('pf-panel min-h-0 border-r pf-rule', narrow ? 'h-full w-full border-r-0' : 'w-64 flex-shrink-0 xl:w-72')}>
      {pane === 'files' && <FilesPane ps={ps} projectId={projectId} onReveal={reveal} changed={changedMarks} />}
      {pane === 'search' && <SearchPane ps={ps} projectId={projectId} onReveal={reveal} />}
      {pane === 'changes' && <ChangesPane ps={ps} projectId={projectId} onOpenDiff={(path, hunks) => setCenter({ kind: 'diff', path, hunks })} />}
      {pane === 'agent' && <AgentPane ps={ps} projectId={projectId} agent={agent} onOpenProposal={(id) => { setCenter({ kind: 'proposal', id }); if (narrow) setMobileTab('code'); }} />}
      {pane === 'library' && <LibraryPane ps={ps} projectId={projectId} agent={agent} selection={selection} onInsert={insertAtCursor} runTarget={runTarget} setRunTarget={setRunTarget} />}
    </div>
  );

  const centerEl = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {center.kind === 'review' && ps.ledger ? (
        <ReviewView ledger={ps.ledger} onLedger={ps.setLedger} onBack={() => setCenter({ kind: 'edit' })} startPush={!!center.push} narrow={narrow} />
      ) : proposal ? (
        <ProposalView proposal={proposal} agent={agent} onBack={() => setCenter({ kind: 'edit' })} narrow={narrow} />
      ) : center.kind === 'diff' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-2 border-b pf-rule px-3"><button type="button" className="pf-btn pf-btn-ghost h-7 px-2" onClick={() => setCenter({ kind: 'edit' })}><ArrowLeft className="h-3.5 w-3.5" />Editor</button><span className="pf-mono text-[12px]">{center.path}</span><span className="text-[11px] pf-faint">against the last commit</span></div>
          <pre className="pf-diff pf-scroll min-h-0 flex-1 overflow-auto py-2">{center.hunks.map((h, i) => <div key={i} data-t={h.type} className="px-3"><span className="pf-num inline-block w-8 pr-2 text-right pf-faint">{h.newLine ?? h.oldLine ?? ''}</span>{h.type === 'add' ? '+ ' : h.type === 'del' ? '− ' : '  '}{h.text}</div>)}</pre>
        </div>
      ) : (
        <>
          <div className="pf-panel pf-scroll flex h-8 flex-shrink-0 items-stretch overflow-x-auto border-b pf-rule" role="tablist" aria-label="Open files">
            {ps.buffers.map((b) => (
              <div key={b.path} className="pf-tab group pr-1" data-active={b.path === ps.active ? 'true' : 'false'}>
                <button type="button" role="tab" aria-selected={b.path === ps.active} className="pf-mono max-w-[180px] truncate text-[12px]" onClick={() => ps.setActive(b.path)} title={b.path}>{b.path.split('/').pop()}</button>
                {b.content !== b.saved ? <Circle className="h-2 w-2 fill-current pf-text-2" aria-label="Unsaved" /> : changedMarks.has(b.path) ? <span className="pf-mono text-[9.5px] pf-faint">{changedMarks.get(b.path)}</span> : null}
                <button type="button" className="rounded p-0.5 opacity-50 hover:bg-[var(--pf-ink-4)] hover:opacity-100" onClick={() => ps.close(b.path)} aria-label={`Close ${b.path}`}><X className="h-3 w-3" /></button>
              </div>
            ))}
            {openProposals.length > 0 && (
              <button type="button" className="ml-auto flex items-center gap-1.5 px-3 text-[11.5px] pf-text-2 hover:text-[color:var(--pf-text)]" onClick={() => setCenter({ kind: 'proposal', id: openProposals[0].id })} data-testid="pf-proposals-chip">
                <Sparkles className="h-3 w-3" />{openProposals.length} proposal{openProposals.length === 1 ? '' : 's'} to read
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1" data-testid="pf-editor">
            {active && !active.loading ? (
              <SeededEditor
                key={`${active.path}:${active.rev}`}
                content={active.content}
                onChange={(v) => ps.edit(active.path, v)}
                language={active.language}
                theme={PROOF_EDITOR_THEME}
                options={editorOptions}
                onEditorReady={onEditorReady}
                onSelectionChange={onSelection}
                semantic={semantic}
                inlineCompletion={inlineCompletion}
                className="h-full w-full"
              />
            ) : active ? (
              <div className="h-full animate-pulse bg-[var(--pf-ink)]" role="status" aria-label="Opening file" />
            ) : (
              <EmptyEditor onPalette={() => setPalette('files')} onNew={() => setPane('files')} />
            )}
          </div>
          {dock && (
            <div className={cn('flex-shrink-0', narrow ? 'h-48' : 'h-56')}>
              <Dock projectId={projectId} tab={dock} setTab={setDock} onClose={() => setDock(null)} onReveal={reveal} fingerprint={ps.ledger?.codeFingerprint} output={output} tests={tests} refs={refs} blame={blame} />
            </div>
          )}
        </>
      )}
    </div>
  );

  const l = ps.ledger;
  const done = l ? l.order.filter((k) => ['proved', 'not_applicable'].includes(l.checks[k].status)).length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-workbench">
      <header className="pf-panel flex h-10 flex-shrink-0 items-center gap-2 border-b pf-rule pl-1 pr-2">
        <button type="button" className="pf-btn pf-btn-ghost h-8 px-2" onClick={onExit} aria-label="Back to projects"><ArrowLeft className="h-3.5 w-3.5" /></button>
        <span className="min-w-0 truncate text-[13px] font-medium" data-testid="pf-project-name">{ps.project?.name || '…'}</span>
        {l && <span className="hidden truncate text-[11px] pf-faint sm:inline" title={l.base.label}>· {l.base.label}</span>}
        <span className={cn('ml-1 text-[11px]', ps.saveState === 'error' ? 'pf-fail' : 'pf-faint')} data-testid="pf-save-state" aria-live="polite">{ps.saveState === 'saving' ? 'saving…' : ps.saveState === 'unsaved' ? 'edited' : ps.saveState === 'error' ? 'not saved' : 'saved'}</span>
        <span className="flex-1" />
        <button type="button" className="pf-btn pf-btn-ghost hidden h-7 px-2 sm:inline-flex" onClick={() => setPalette('commands')} data-testid="pf-open-palette"><CommandIcon className="h-3 w-3" /><span className="text-[11.5px] pf-muted">Commands</span><span className="pf-kbd">⌘⇧P</span></button>
        {l && (
          <button type="button" className="pf-btn h-7 px-2" onClick={() => (narrow ? setMobileTab('proof') : void review())} data-testid="pf-proof-chip" aria-label={`Proof ${done} of ${l.order.length}`}>
            <ProofSeal order={l.order} states={Object.fromEntries(l.order.map((k) => [k, l.checks[k].status])) as Record<CheckKey, CheckStatus>} green={l.green} size={20} label={false} />
            <span className={cn('pf-num text-[11px]', l.green ? 'pf-ok' : 'pf-muted')}>{done}/{l.order.length}</span>
          </button>
        )}
      </header>

      {narrow ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            {mobileTab === 'files' && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="pf-panel flex flex-shrink-0 border-b pf-rule" role="tablist" aria-label="Panes">
                  {PANES.map((p) => <button key={p.id} type="button" role="tab" aria-selected={pane === p.id} onClick={() => setPane(p.id)} className={cn('flex h-9 flex-1 items-center justify-center', pane === p.id ? 'text-[color:var(--pf-text)] shadow-[inset_0_-1px_0_var(--pf-text)]' : 'pf-faint')} aria-label={p.label}><p.icon className="h-4 w-4" /></button>)}
                </div>
                <div className="min-h-0 flex-1">{paneEl || <p className="p-4 text-[12px] pf-faint">Pick a pane.</p>}</div>
              </div>
            )}
            {mobileTab === 'code' && centerEl}
            {mobileTab === 'proof' && strip}
          </div>
          {/* Inset so the platform's floating buttons at the screen corners never cover a tab. */}
          <nav className="pf-panel flex h-12 flex-shrink-0 border-t pf-rule px-16" aria-label="Workbench">
            {([['files', 'Files'], ['code', 'Code'], ['proof', 'Proof']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => { setMobileTab(id); if (id === 'files' && !pane) setPane('files'); }} aria-current={mobileTab === id} className={cn('flex flex-1 flex-col items-center justify-center text-[11px]', mobileTab === id ? 'text-[color:var(--pf-text)]' : 'pf-faint')} data-testid={`pf-mtab-${id}`}>
                {label}{id === 'proof' && l && <span className={cn('pf-num text-[10px]', l.green ? 'pf-ok' : '')}>{done}/{l.order.length}</span>}
              </button>
            ))}
          </nav>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="pf-panel flex w-11 flex-shrink-0 flex-col border-r pf-rule" aria-label="Panes">
            {PANES.map((p) => (
              <button key={p.id} type="button" className="pf-rail-btn" data-active={pane === p.id ? 'true' : 'false'} onClick={() => setPane((x) => (x === p.id ? null : p.id))} aria-label={`${p.label} (${p.key})`} aria-pressed={pane === p.id} title={`${p.label}  ${p.key}`} data-testid={`pf-rail-${p.id}`}>
                <p.icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
              </button>
            ))}
          </nav>
          {paneEl}
          {centerEl}
          {strip}
        </div>
      )}

      {palette && <Palette mode={palette} files={allPaths} commands={commands} onOpenFile={(p) => reveal(p, null)} onClose={() => setPalette(null)} />}
      {toast && <div className="pf-palette fixed bottom-16 left-1/2 z-50 -translate-x-1/2 px-3 py-2 text-[12px] shadow-none" role="status" data-testid="pf-toast">{toast}</div>}
    </div>
  );
}

/**
 * The editor is uncontrolled while someone types: it is mounted with the
 * buffer's text as it is at mount time, frozen, so React never pushes stale
 * text back into it. Each mount (opening a tab, coming back from Review, a
 * re-seed after the server rewrote the file) takes the current text.
 */
function SeededEditor({ content, ...props }: Omit<React.ComponentProps<typeof MonacoWrapper>, 'value'> & { content: string }) {
  const [seed] = useState(content);
  return <MonacoWrapper value={seed} {...props} />;
}

function EmptyEditor({ onPalette, onNew }: { onPalette: () => void; onNew: () => void }) {
  const rows: [string, string][] = [['Go to file', '⌘P'], ['Commands', '⌘⇧P'], ['Run the file', '⌘↵'], ['Run the tests', '⌘⇧↵'], ['Review the change', '⌥R']];
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-64">
        <ul className="space-y-1.5">
          {rows.map(([label, k]) => <li key={label} className="flex items-center justify-between text-[12px] pf-muted">{label}<span className="pf-kbd">{k}</span></li>)}
        </ul>
        <div className="mt-4 flex gap-2"><button type="button" className="pf-btn" onClick={onPalette}>Open a file</button><button type="button" className="pf-btn pf-btn-ghost" onClick={onNew}>New file</button></div>
      </div>
    </div>
  );
}
