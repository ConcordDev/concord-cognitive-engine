'use client';

/**
 * The Agent pane. Every AI edit arrives as a proposal: a diff you read and
 * accept or discard. Nothing the model writes lands in the project on its
 * own. Questions (ask, explain) answer in place, with the files they read.
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Wand2, FlaskConical, FilePlus2, Sparkles, Hammer, ChevronRight, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, code, languageOf, readFiles } from './proofApi';
import type { ProjectState } from './useProject';
import { validateGeneratedTests } from '../testGenContract';

export interface ProposalEdit { path: string; before: string | null; after: string }
export interface AiProposal {
  id: string;
  title: string;
  origin: 'change' | 'edit' | 'refactor' | 'tests' | 'draft' | 'generate';
  note?: string;
  evidence?: string;
  edits: ProposalEdit[];
  status: 'open' | 'accepted' | 'discarded' | 'conflict';
  taskId?: string;
  at: string;
}

type Mode = 'ask' | 'change' | 'edit' | 'refactor' | 'tests' | 'draft';
const MODES: { id: Mode; label: string; icon: typeof Wand2; hint: string }[] = [
  { id: 'ask', label: 'Ask', icon: MessageSquare, hint: 'Ask about this codebase. Answers cite the files they read.' },
  { id: 'change', label: 'Change', icon: Sparkles, hint: 'Describe a change across the project. It comes back as a checked proposal.' },
  { id: 'edit', label: 'Edit file', icon: Wand2, hint: 'Rewrite the open file to an instruction.' },
  { id: 'refactor', label: 'Refactor', icon: Hammer, hint: 'Suggest a cleaner version of the open file.' },
  { id: 'tests', label: 'Tests', icon: FlaskConical, hint: 'Write tests for the open file.' },
  { id: 'draft', label: 'New file', icon: FilePlus2, hint: 'Draft a new file from a description, built and checked first.' },
];

let seq = 0;
const pid = () => `ai_${Date.now().toString(36)}_${++seq}`;

export function testPathFor(path: string): string {
  if (/\.py$/i.test(path)) return path.replace(/([^/]+)\.py$/i, 'test_$1.py');
  return path.replace(/\.([cm]?[jt]sx?)$/i, '.test.$1');
}

export interface AgentApi {
  proposals: AiProposal[];
  add: (p: Omit<AiProposal, 'id' | 'status' | 'at'>) => AiProposal;
  accept: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  writeTests: (path: string) => Promise<AiProposal | null>;
}

/** Proposals for one project, kept for the session. Accepting writes through files-write after a conflict check. */
export function useProposals(ps: ProjectState, projectId: string): AgentApi {
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const add = useCallback((p: Omit<AiProposal, 'id' | 'status' | 'at'>) => {
    const full: AiProposal = { ...p, id: pid(), status: 'open', at: new Date().toISOString() };
    setProposals((ps2) => [full, ...ps2]);
    return full;
  }, []);
  const settle = useCallback((id: string, status: AiProposal['status'], note?: string) => {
    setProposals((list) => list.map((x) => (x.id === id ? { ...x, status, note: note ?? x.note } : x)));
  }, []);
  const accept = useCallback(async (id: string) => {
    const p = proposals.find((x) => x.id === id);
    if (!p || p.status !== 'open') return;
    await ps.saveAll();
    // Refuse to overwrite a file that changed since the proposal was made.
    const current = await readFiles(projectId, p.edits.map((e) => e.path));
    const conflict = p.edits.find((e) => (current.get(e.path) ?? null) !== e.before);
    if (conflict) { settle(id, 'conflict', `${conflict.path} changed after this was proposed. Ask again on the current code.`); return; }
    for (const e of p.edits) {
      const r = await code('files-write', { projectId, path: e.path, content: e.after });
      if (!r.ok) { settle(id, 'conflict', r.message); return; }
    }
    if (p.taskId) await code('agent-task-finish', { id: p.taskId, status: 'completed' });
    settle(id, 'accepted');
    await ps.reload(p.edits.map((e) => e.path));
    void ps.openFile(p.edits[0].path);
  }, [proposals, ps, projectId, settle]);
  const discard = useCallback(async (id: string) => {
    const p = proposals.find((x) => x.id === id);
    if (p?.taskId) await code('agent-task-finish', { id: p.taskId, status: 'cancelled' });
    settle(id, 'discarded');
  }, [proposals, settle]);

  const writeTests = useCallback(async (path: string) => {
    const content = (await readFiles(projectId, [path])).get(path);
    if (content == null) return null;
    const language = languageOf(path);
    const r = await code<{ tests: string; framework?: string }>('test-generate', { projectId, path, code: content, language, framework: language === 'python' ? 'unittest' : 'node:test' });
    if (!r.ok) { ps.setError(r.message); return null; }
    // The contract rejects anything that is not test code (JSON, run-shaped "results"), so a fake pass can never be proposed.
    const v = validateGeneratedTests(r.result, language === 'python' ? 'unittest' : 'node:test');
    if (!v.ok) { ps.setError(v.reason); return null; }
    const target = testPathFor(path);
    const existing = (await readFiles(projectId, [target])).get(target) ?? null;
    return add({
      title: `Tests for ${path}`, origin: 'tests',
      evidence: `Test code for ${v.framework}${v.strippedFences ? ' (code fences removed)' : ''}. Not run yet: accept it, then run the tests.`,
      edits: [{ path: target, before: existing, after: v.tests.endsWith('\n') ? v.tests : `${v.tests}\n` }],
    });
  }, [add, projectId, ps]);

  return { proposals, add, accept, discard, writeTests };
}

interface ChatTurn { role: 'user' | 'assistant'; text: string; files?: string[] }
interface Task { id: string; prompt: string; status: string; startedAt: string }

export function AgentPane({ ps, projectId, agent, onOpenProposal }: { ps: ProjectState; projectId: string; agent: AgentApi; onOpenProposal: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const active = ps.active;
  const needsFile = mode === 'edit' || mode === 'refactor' || mode === 'tests';

  const loadTasks = useCallback(async () => {
    const r = await code<{ tasks: Task[] }>('agent-tasks-list', {});
    if (r.ok) setTasks(r.result.tasks.slice(0, 8));
  }, []);
  useEffect(() => { void loadTasks(); }, [loadTasks, agent.proposals.length]);

  const run = async () => {
    setError(null);
    const prompt = text.trim();
    if (needsFile && !active) { setError('Open a file first.'); return; }
    if (!prompt && mode !== 'tests' && mode !== 'refactor') return;
    setBusy(true);
    await ps.saveAll();
    try {
      if (mode === 'ask') {
        setChat((c) => [...c, { role: 'user', text: prompt }]);
        setText('');
        const history = chat.slice(-6).map((t) => ({ role: t.role, content: t.text }));
        const r = await code<{ reply: string; contextFiles: string[] }>('codebase-chat', { projectId, message: prompt, history, mentionedFiles: active ? [active] : [] });
        const answered = r.ok && r.result.reply && r.result.reply.trim() !== '(no response)';
        setChat((c) => [...c, answered ? { role: 'assistant', text: r.result.reply, files: r.result.contextFiles } : { role: 'assistant', text: r.ok ? 'No model answered. The agent needs a running language model; nothing was made up in its place.' : `Could not answer: ${r.message}` }]);
        return;
      }
      if (mode === 'change') {
        const task = await code<{ task: { id: string } }>('agent-task-start', { projectId, prompt });
        const r = await code<{ edits: { filename: string; before: string; after: string; reason?: string }[]; verification: { ok: boolean; files: { filename: string; syntax: { checked: boolean; ok: boolean } }[] }; attemptsUsed: number }>('propose-verified-patch', { projectId, taskQuery: prompt });
        if (!r.ok) {
          if (task.ok) await code('agent-task-finish', { id: task.result.task.id, status: 'failed', reason: r.message });
          setError(`No checked change came back: ${r.message}`);
          return;
        }
        const current = await readFiles(projectId, r.result.edits.map((e) => e.filename));
        const checked = r.result.verification.files.filter((f) => f.syntax.checked).length;
        const p = agent.add({
          title: prompt, origin: 'change', taskId: task.ok ? task.result.task.id : undefined,
          evidence: `Parsed cleanly${checked ? ` (${checked} file${checked === 1 ? '' : 's'} syntax-checked)` : ''} after ${r.result.attemptsUsed} attempt${r.result.attemptsUsed === 1 ? '' : 's'}. Not run yet: accept it, then the proof runs it.`,
          edits: r.result.edits.map((e) => ({ path: e.filename, before: current.get(e.filename) ?? null, after: e.after })),
        });
        setText(''); onOpenProposal(p.id);
        return;
      }
      if (mode === 'tests' && active) {
        const p = await agent.writeTests(active);
        if (p) onOpenProposal(p.id);
        return;
      }
      if ((mode === 'edit' || mode === 'refactor') && active) {
        const content = (await readFiles(projectId, [active])).get(active) ?? '';
        const language = languageOf(active);
        const r = mode === 'edit'
          ? await code<{ edited: string }>('inline-edit', { code: content, instruction: prompt, language })
          : await code<{ refactored: string }>('refactor-suggest', { code: content, goal: prompt || 'Make it clearer without changing behaviour.', language, path: active, projectId });
        if (!r.ok) { setError(r.message); return; }
        const after = mode === 'edit' ? (r.result as { edited: string }).edited : (r.result as { refactored: string }).refactored;
        if (!after?.trim() || after === content) { setError('The model proposed no change.'); return; }
        const p = agent.add({ title: prompt || 'Refactor', origin: mode, edits: [{ path: active, before: content, after: after.endsWith('\n') || !content.endsWith('\n') ? after : `${after}\n` }] });
        setText(''); onOpenProposal(p.id);
        return;
      }
      if (mode === 'draft') {
        const path = (prompt.match(/\b[\w./-]+\.(?:ts|tsx|js|mjs|py|json|md)\b/) || [])[0] || 'src/draft.ts';
        const language = languageOf(path) === 'plaintext' ? 'typescript' : languageOf(path);
        // The build loop writes while it iterates, so it works in a private scratch area, never in this project.
        const r = await code<{ status: string; reason?: string; artifact?: { code: string }; evidence?: { ran: boolean; lintClean: boolean; verified: boolean }; iterations?: number }>('build', { prompt, language, path, projectId: `${projectId}::scratch` });
        const draft = r.ok ? r.result.artifact?.code : undefined;
        if (!draft) {
          const g = await code<{ content: string }>('forge-generate', { description: prompt, path });
          if (!g.ok || !g.result.content?.trim()) { setError(r.ok ? (r.result.reason || 'Nothing came back.') : r.message); return; }
          const existing = (await readFiles(projectId, [path])).get(path) ?? null;
          const p = agent.add({ title: prompt, origin: 'generate', evidence: 'Generated from a template; not built or run.', edits: [{ path, before: existing, after: g.result.content }] });
          setText(''); onOpenProposal(p.id);
          return;
        }
        const existing = (await readFiles(projectId, [path])).get(path) ?? null;
        const ev = r.ok && r.result.evidence;
        const p = agent.add({
          title: prompt, origin: 'draft',
          evidence: ev ? `Build loop: ${r.result.status} after ${r.result.iterations ?? 1} iteration${r.result.iterations === 1 ? '' : 's'} · ran ${ev.ran ? 'yes' : 'no'} · lint ${ev.lintClean ? 'clean' : 'not clean'}` : `Build loop: ${r.ok ? r.result.status : 'failed'}`,
          edits: [{ path, before: existing, after: draft }],
        });
        setText(''); onOpenProposal(p.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const open = agent.proposals.filter((p) => p.status === 'open');
  const settled = agent.proposals.filter((p) => p.status !== 'open').slice(0, 6);
  const hint = MODES.find((m) => m.id === mode)!.hint;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-pane-agent">
      <div className="flex h-9 flex-shrink-0 items-center border-b pf-rule px-3"><span className="pf-label">Agent</span></div>
      <div className="flex flex-wrap gap-0.5 border-b pf-rule p-1.5" role="tablist" aria-label="What the agent does">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)} className={cn('inline-flex h-6 items-center gap-1 rounded px-2 text-[11.5px]', mode === m.id ? 'bg-[var(--pf-ink-4)] text-[color:var(--pf-text)]' : 'pf-muted hover:text-[color:var(--pf-text)]')}>
            <m.icon className="h-3 w-3" />{m.label}
          </button>
        ))}
      </div>

      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto">
        {open.length > 0 && (
          <section className="border-b pf-rule p-2" aria-label="Open proposals">
            <p className="pf-label pb-1">Waiting for you</p>
            {open.map((p) => (
              <button key={p.id} type="button" className="pf-row rounded border pf-rule-2 px-2 py-1.5 text-[12px]" onClick={() => onOpenProposal(p.id)} data-testid="pf-open-proposal">
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="pf-num text-[10.5px] pf-faint">{p.edits.length} file{p.edits.length === 1 ? '' : 's'}</span>
                <ChevronRight className="h-3 w-3 pf-faint" aria-hidden />
              </button>
            ))}
          </section>
        )}

        {mode === 'ask' && (
          <ol className="space-y-3 p-3" aria-label="Conversation">
            {chat.length === 0 && <li className="text-[12px] pf-faint">{hint}</li>}
            {chat.map((t, i) => (
              <li key={i} className={cn('text-[12.5px]', t.role === 'user' ? 'pf-text-2' : '')}>
                {t.role === 'user' ? <p className="pf-mono text-[12px]">› {t.text}</p> : <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>}
                {t.files && t.files.length > 0 && <p className="mt-1 text-[10.5px] pf-faint">Read: <span className="pf-mono">{t.files.join(', ')}</span></p>}
              </li>
            ))}
            {busy && <li className="text-[12px] pf-faint" role="status">Reading the project…</li>}
          </ol>
        )}

        {mode !== 'ask' && (
          <p className="px-3 pt-3 text-[12px] pf-muted">{hint}{needsFile && <> <span className="pf-mono pf-text-2">{active || 'No file open'}</span></>}</p>
        )}

        {settled.length > 0 && (
          <section className="mt-2 border-t pf-rule p-2" aria-label="Recent proposals">
            <p className="pf-label pb-1">Recent</p>
            {settled.map((p) => (
              <button key={p.id} type="button" className="pf-row py-1 text-[12px]" onClick={() => onOpenProposal(p.id)}>
                {p.status === 'accepted' ? <Check className="h-3 w-3 pf-ok" aria-label="Accepted" /> : <X className="h-3 w-3 pf-faint" aria-label={p.status} />}
                <span className="min-w-0 flex-1 truncate pf-text-2">{p.title}</span>
                <span className="text-[10.5px] pf-faint">{p.status}</span>
              </button>
            ))}
          </section>
        )}
        {tasks.length > 0 && (
          <section className="border-t pf-rule p-2" aria-label="Agent tasks">
            <p className="pf-label pb-1">Agent tasks</p>
            {tasks.map((t) => (
              <p key={t.id} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span className={cn('pf-mono text-[10px]', t.status === 'completed' ? 'pf-ok' : t.status === 'failed' ? 'pf-fail' : 'pf-faint')}>{t.status}</span>
                <span className="min-w-0 flex-1 truncate pf-text-2">{t.prompt}</span>
                <span className="text-[10px] pf-faint">{ago(t.startedAt)}</span>
              </p>
            ))}
          </section>
        )}
      </div>

      <form className="border-t pf-rule p-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        {error && <p className="pb-1.5 text-[11.5px] pf-fail" role="alert">{error}</p>}
        <textarea
          className="pf-input"
          rows={3}
          placeholder={mode === 'ask' ? 'Where is the config loaded?' : mode === 'change' ? 'Add input validation to sum()' : mode === 'draft' ? 'A CLI in src/cli.ts that prints the date' : mode === 'tests' ? 'Optional: what to focus on' : 'What should change?'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }}
          aria-label="Instruction for the agent"
          data-testid="pf-agent-input"
        />
        <button type="submit" className="pf-btn mt-1.5 w-full justify-center" disabled={busy || (needsFile && !active)} data-testid="pf-agent-go">
          {busy ? 'Working…' : mode === 'ask' ? 'Ask' : 'Propose'}<span className="pf-kbd">⌘↵</span>
        </button>
      </form>
    </div>
  );
}
