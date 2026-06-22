'use client';

// Phase DB10 — Hacking terminal (fake shell).
// Picks a puzzle (or auto-selects easiest), renders the terminal_tree,
// runs `ls`/`cd`/`cat`/`connect`/`exec`/`decrypt`/`ssh` against an
// in-memory FS. Each command also POSTs to /api/hacking/:id/command;
// the server's solution-path tracker decides progress + reward.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, Trophy, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, failureJuice, milestoneJuice, sfx } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';

interface PuzzleStub {
  id: string; name: string; difficulty: number; reward_cc: number;
}
interface TerminalNode {
  type: 'dir' | 'file' | 'service';
  contents?: Record<string, TerminalNode>;
  text?: string;
}
interface PuzzleFull {
  id: string;
  name: string;
  difficulty: number;
  reward_cc: number;
  terminal_tree: TerminalNode;
}

const PROMPT = '$ ';

function resolvePath(tree: TerminalNode, cwd: string[]): TerminalNode | null {
  let cur: TerminalNode = tree;
  for (const seg of cwd) {
    if (cur.type !== 'dir' || !cur.contents?.[seg]) return null;
    cur = cur.contents[seg];
  }
  return cur;
}

export function HackingTerminal({ building, onClose, worldId }: OverlayProps) {
  const [puzzles, setPuzzles] = useState<PuzzleStub[]>([]);
  const [puzzle, setPuzzle] = useState<PuzzleFull | null>(null);
  const [cwd, setCwd] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([
    `concord-shell v2.0 — connect to a node to begin.`,
    `available: ls, cd, cat, connect, exec, decrypt, ssh`,
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState<{ rewardCc: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load puzzle list on mount.
  useEffect(() => {
    (async () => {
      try {
        const j = await fetch('/api/hacking/puzzles', { credentials: 'include' }).then(r => r.json());
        if (j?.ok) setPuzzles(j.puzzles || []);
      } catch { /* swallow */ }
    })();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  const pickPuzzle = useCallback(async (id: string) => {
    try {
      const j = await fetch(`/api/hacking/${id}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok && j.puzzle) {
        setPuzzle(j.puzzle);
        const lines = [
          `Connected to ${j.puzzle.name}`,
          `difficulty ${j.puzzle.difficulty}/5 · bounty ${j.puzzle.reward_cc} cc`,
          ``,
        ];
        // T1.5 — initial trail nudge so exploration is guided, not memorized.
        try {
          const h = await fetch(`/api/hacking/${id}/hint`, { credentials: 'include' }).then((r) => r.json());
          if (h?.ok && h.hint) lines.push(`» lead: ${h.hint}`, ``);
        } catch { /* hint optional */ }
        setHistory(lines);
        setCwd([]);
      }
    } catch { /* swallow */ }
  }, []);

  const exec = useCallback(async (line: string) => {
    if (!puzzle) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    const [head, ...rest] = trimmed.split(/\s+/);
    const newHistory = [...history, `${PROMPT}${trimmed}`];

    // Local FS resolution for `ls` + `cat` + `cd`.
    if (head === 'ls') {
      const node = resolvePath(puzzle.terminal_tree, cwd);
      if (node?.type === 'dir' && node.contents) {
        const names = Object.keys(node.contents);
        newHistory.push(names.length === 0 ? '(empty)' : names.join('  '));
      } else newHistory.push('not a directory');
    } else if (head === 'cd') {
      const target = rest[0] || '';
      if (target === '..') {
        if (cwd.length > 0) setCwd(cwd.slice(0, -1));
      } else if (target) {
        const node = resolvePath(puzzle.terminal_tree, cwd);
        if (node?.type === 'dir' && node.contents?.[target]?.type === 'dir') {
          setCwd([...cwd, target]);
        } else newHistory.push(`cd: no such directory: ${target}`);
      }
    } else if (head === 'cat') {
      const target = rest[0];
      if (!target) newHistory.push('cat: missing operand');
      else {
        const node = resolvePath(puzzle.terminal_tree, cwd);
        const f = node?.type === 'dir' ? node.contents?.[target] : null;
        if (f && f.type === 'file') newHistory.push(f.text || '');
        else newHistory.push(`cat: ${target}: no such file`);
      }
    }
    // `connect`/`exec`/`decrypt`/`ssh` are progress-only commands; the
    // server tracks them.
    setHistory(newHistory);

    setPending(true);
    try {
      const r = await fetch(`/api/hacking/${puzzle.id}/command`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('hack'); // lean-reach typing at the terminal
        if (j.completed) {
          milestoneJuice('ui_hack_complete');
          setCompleted({ rewardCc: j.rewardCc });
          setHistory((h) => [...h, ``, `✓ puzzle complete · +${j.rewardCc} cc`]);
        } else if (j.progressReset) {
          failureJuice('ui_hack_reset');
          setHistory((h) => [...h, `× wrong step — progress reset`, ...(j.nextHint ? [`» lead: ${j.nextHint}`] : [])]);
        } else if (j.matched) {
          successJuice('ui_hack_step');
          setHistory((h) => [...h, `✓ step ${j.step}/${j.totalSteps}`, ...(j.nextHint ? [`» lead: ${j.nextHint}`] : [])]);
        }
      } else if (j?.error) {
        sfx('ui_terminal_error');
        setHistory((h) => [...h, `error: ${j.error}`]);
      }
    } finally { setPending(false); }
  }, [puzzle, cwd, history]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !pending) {
      exec(input);
      setInput('');
    }
  };

  const cwdStr = cwd.length === 0 ? '/' : '/' + cwd.join('/');

  return (
    <StationOverlayShell
      title={building.name || 'Hacking terminal'}
      subtitle={puzzle ? `${puzzle.name} · ${cwdStr}` : `hacking_terminal · ${worldId}`}
      onClose={onClose}
      accent="cyan"
      size="full"
    >
      {!puzzle ? (
        <div>
          <p className="mb-3 text-xs text-zinc-400">Pick a target to penetrate.</p>
          <div className="space-y-1">
            {puzzles.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPuzzle(p.id)}
                className="block w-full rounded border border-cyan-500/30 bg-cyan-950/30 p-2 text-left hover:border-cyan-400/60 hover:bg-cyan-900/30"
              >
                <div className="flex justify-between text-sm">
                  <span className="font-mono text-cyan-100">{p.name}</span>
                  <span className="text-amber-300">{p.reward_cc} cc</span>
                </div>
                <div className="text-[10px] text-cyan-300/60">difficulty {p.difficulty}/5</div>
              </button>
            ))}
            {puzzles.length === 0 && <p className="text-center text-xs text-zinc-400">No puzzles authored yet.</p>}
          </div>
        </div>
      ) : (
        <div className="flex h-[60vh] flex-col font-mono text-xs">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto rounded border border-cyan-500/30 bg-black p-2 text-cyan-200"
          >
            {history.map((line, i) => (
              <div key={i} className={line.startsWith('✓') ? 'text-emerald-400' : line.startsWith('×') ? 'text-red-400' : line.startsWith('error') ? 'text-red-300' : ''}>
                {line || ' '}
              </div>
            ))}
            {completed && (
              <div className="mt-2 inline-flex items-center gap-1 rounded bg-amber-500/30 px-2 py-1 text-amber-100">
                <Trophy size={11} /> bounty +{completed.rewardCc} cc
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1 rounded border border-cyan-500/30 bg-black px-2 py-1.5">
            <Terminal size={12} className="text-cyan-400" />
            <span className="text-cyan-400">{cwdStr}{PROMPT}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={pending || !!completed}
              autoFocus
              className="flex-1 bg-transparent text-cyan-100 outline-none"
              placeholder="enter command"
            />
            {pending && <Loader2 className="animate-spin text-cyan-400" size={12} />}
          </div>
        </div>
      )}
    </StationOverlayShell>
  );
}
