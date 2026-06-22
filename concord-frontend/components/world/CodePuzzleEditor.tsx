'use client';

// Phase DB11 — Programming puzzle editor.
// Drag-and-drop instruction grid with 5 ops (MOV / ADD / JMP / JEZ / OUT).
// Tests via /api/code-puzzle/:id/run; submits only when ALL cases pass.

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Play, Send, Trash2, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, milestoneJuice, failureJuice } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';

interface PuzzleStub { id: string; name: string; description?: string; optimal_cycles?: number; optimal_size?: number; }
interface TestCase { input: number[]; expected: number[]; }
interface PuzzleFull extends PuzzleStub { test_cases: TestCase[]; }

interface Instr { op: string; a?: string; b?: string; }
const OPS = ['MOV', 'ADD', 'JMP', 'JEZ', 'OUT'] as const;
type Op = typeof OPS[number];

interface CaseResult { input: number[]; expected: number[]; actual: number[]; cycles: number; pass: boolean; }

export function CodePuzzleEditor({ building, onClose, worldId }: OverlayProps) {
  const [puzzles, setPuzzles] = useState<PuzzleStub[]>([]);
  const [puzzle, setPuzzle] = useState<PuzzleFull | null>(null);
  const [program, setProgram] = useState<Instr[]>([]);
  const [result, setResult] = useState<{ passed: boolean; cases: CaseResult[]; cycles: number; size: number } | null>(null);
  const [submitted, setSubmitted] = useState<{ cycles: number; size: number; cyclesPct?: number | null; sizePct?: number | null } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetch('/api/code-puzzle/puzzles', { credentials: 'include' }).then(r => r.json());
        if (j?.ok) setPuzzles(j.puzzles || []);
      } catch { /* swallow */ }
    })();
  }, []);

  const pickPuzzle = useCallback(async (id: string) => {
    try {
      const j = await fetch(`/api/code-puzzle/${id}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok && j.puzzle) { setPuzzle(j.puzzle); setProgram([]); setResult(null); setSubmitted(null); }
    } catch { /* swallow */ }
  }, []);

  const addInstr = (op: Op) => setProgram([...program, { op, a: 'R0', b: '0' }]);
  const removeInstr = (i: number) => setProgram(program.filter((_, idx) => idx !== i));
  const updateInstr = (i: number, k: 'a' | 'b', v: string) =>
    setProgram(program.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));

  const test = useCallback(async () => {
    if (!puzzle) return;
    setPending(true);
    try {
      const r = await fetch(`/api/code-puzzle/${puzzle.id}/run`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ program: program.map((p) => ({ op: p.op, a: p.a, b: p.b })) }),
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('hack'); // typing at the console
        setResult(j);
        if (j.passed) successJuice('ui_code_test_pass');
        else failureJuice('ui_code_test_fail');
      }
    } finally { setPending(false); }
  }, [puzzle, program]);

  const submit = useCallback(async () => {
    if (!puzzle) return;
    setPending(true);
    try {
      const r = await fetch(`/api/code-puzzle/${puzzle.id}/submit`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ program: program.map((p) => ({ op: p.op, a: p.a, b: p.b })) }),
      });
      const j = await r.json();
      if (j?.ok) {
        milestoneJuice('ui_code_submit_pass');
        // D7 — Zachtronics percentile feedback from the server's solution histogram.
        setSubmitted({
          cycles: j.cycles, size: j.size,
          cyclesPct: j.stats?.cycles?.percentile ?? null,
          sizePct: j.stats?.size?.percentile ?? null,
        });
      }
    } finally { setPending(false); }
  }, [puzzle, program]);

  return (
    <StationOverlayShell
      title={building.name || 'Code workstation'}
      subtitle={puzzle ? puzzle.name : `programming_console · ${worldId}`}
      onClose={onClose}
      accent="cyan"
      size="full"
    >
      {!puzzle ? (
        <div>
          <p className="mb-2 text-xs text-zinc-400">Pick a problem.</p>
          <div className="space-y-1">
            {puzzles.map((p) => (
              <button key={p.id} onClick={() => pickPuzzle(p.id)} className="block w-full rounded border border-cyan-500/30 bg-cyan-950/30 p-2 text-left hover:border-cyan-400/60 hover:bg-cyan-900/30">
                <div className="font-mono text-sm text-cyan-100">{p.name}</div>
                <div className="text-[10px] text-cyan-300/60">{p.description}</div>
                {p.optimal_cycles && <div className="text-[10px] text-amber-300/70">optimal: {p.optimal_cycles} cycles · {p.optimal_size} ops</div>}
              </button>
            ))}
            {puzzles.length === 0 && <p className="text-center text-xs text-zinc-500">No puzzles authored yet.</p>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-xs">
          {/* Problem + test cases */}
          <div className="col-span-1 space-y-2">
            <div className="rounded border border-cyan-500/30 bg-cyan-950/30 p-2">
              <div className="text-[10px] uppercase text-cyan-300/70">problem</div>
              <div className="text-cyan-100">{puzzle.description}</div>
            </div>
            <div className="rounded border border-cyan-500/30 bg-cyan-950/30 p-2">
              <div className="mb-1 text-[10px] uppercase text-cyan-300/70">test cases</div>
              {puzzle.test_cases.map((tc, i) => {
                const cr = result?.cases?.[i];
                return (
                  <div key={i} className={['mb-1 rounded p-1 font-mono text-[10px]', cr?.pass ? 'bg-emerald-900/30' : cr ? 'bg-red-900/30' : 'bg-zinc-900'].join(' ')}>
                    <div className="text-cyan-200">in: [{tc.input.join(',')}]</div>
                    <div className="text-cyan-200">exp: [{tc.expected.join(',')}]</div>
                    {cr && <div className={cr.pass ? 'text-emerald-300' : 'text-red-300'}>got: [{cr.actual.join(',')}]</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Program editor */}
          <div className="col-span-1 space-y-2">
            <div className="rounded border border-cyan-500/30 bg-black p-2 font-mono">
              {program.length === 0 && <div className="text-zinc-600">no instructions</div>}
              {program.map((p, i) => (
                <div key={i} className="flex items-center gap-1 py-0.5">
                  <span className="w-6 text-cyan-500">{i}:</span>
                  <span className="w-12 text-cyan-100">{p.op}</span>
                  <input value={p.a ?? ''} onChange={(e) => updateInstr(i, 'a', e.target.value)} className="w-10 rounded bg-zinc-900 px-1 text-cyan-200" />
                  <input value={p.b ?? ''} onChange={(e) => updateInstr(i, 'b', e.target.value)} className="w-10 rounded bg-zinc-900 px-1 text-cyan-200" />
                  <button aria-label="Delete" onClick={() => removeInstr(i)} className="ml-auto text-red-400 hover:text-red-300"><Trash2 size={10} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Op palette + controls */}
          <div className="col-span-1 space-y-2">
            <div className="rounded border border-cyan-500/30 bg-cyan-950/30 p-2">
              <div className="mb-1 text-[10px] uppercase text-cyan-300/70">add op</div>
              <div className="grid grid-cols-2 gap-1">
                {OPS.map((op) => (
                  <button key={op} onClick={() => addInstr(op)} className="rounded bg-cyan-500/30 px-2 py-1 font-mono text-cyan-100 hover:bg-cyan-500/50">
                    {op}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <button onClick={test} disabled={pending || program.length === 0} className="flex w-full items-center justify-center gap-1 rounded bg-cyan-500/30 px-2 py-1.5 text-cyan-100 hover:bg-cyan-500/50 disabled:opacity-50">
                {pending ? <Loader2 className="animate-spin" size={11} /> : <Play size={11} />} Test
              </button>
              <button onClick={submit} disabled={pending || !result?.passed} className="flex w-full items-center justify-center gap-1 rounded bg-emerald-500/30 px-2 py-1.5 text-emerald-100 hover:bg-emerald-500/50 disabled:opacity-50">
                <Send size={11} /> Submit (all-pass req'd)
              </button>
            </div>
            {result && (
              <div className={['rounded p-2 text-[11px]', result.passed ? 'bg-emerald-900/30 text-emerald-200' : 'bg-zinc-900 text-zinc-300'].join(' ')}>
                <Cpu className="inline" size={11} /> cycles: {result.cycles} · size: {result.size}
                {result.passed && <div>✓ all cases pass</div>}
              </div>
            )}
            {submitted && (
              <div className="rounded bg-amber-900/30 p-2 text-[11px] text-amber-100">
                ⭐ submitted · {submitted.cycles}c / {submitted.size}o
                {(submitted.cyclesPct != null || submitted.sizePct != null) && (
                  <div className="mt-0.5 text-[10px] text-amber-200/80">
                    {submitted.cyclesPct != null && <>faster than {submitted.cyclesPct}% of solvers</>}
                    {submitted.cyclesPct != null && submitted.sizePct != null && <> · </>}
                    {submitted.sizePct != null && <>smaller than {submitted.sizePct}%</>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </StationOverlayShell>
  );
}
