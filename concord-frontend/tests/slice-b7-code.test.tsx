import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishExecStatus, resetExecStatusForTests } from '@/components/code/codeExecGate';

const { calls, postMock, lens, dtus, commands, dyn, execPlan, llmPlan, forgePlan, planCount } = vi.hoisted(() => {
  const calls: Array<{ domain?: string; action?: string; input?: { content?: string; path?: string } }> = [];
  const execPlan: string[] = [];
  const llmPlan: Array<'fence' | 'plain' | 'empty' | 'throw' | 'cancel'> = [];
  const forgePlan: Array<'code' | 'string' | 'content' | 'throw'> = [];
  const planCount = { n: 0 };
  const lens = {
    isLoading: false,
    isError: false,
    error: null as { message: string } | null,
    items: [] as Array<{ id: string; title?: string; data?: { content?: string; language?: string; scriptType?: string } }>,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  };
  const dtus = {
    hyper: [] as Array<Record<string, unknown>>,
    mega: [] as Array<Record<string, unknown>>,
    regular: [] as Array<Record<string, unknown>>,
    alerts: [] as Array<unknown>,
    refetch: vi.fn(),
    publish: vi.fn(),
  };
  const commands = { list: [] as Array<{ id: string; action: () => void }> };
  const dyn = {
    editor: null as null | {
      onChange?: (v: string) => void;
      onEditorReady?: (ed: unknown) => void;
      onSelectionChange?: (s: { text: string; startLine: number; endLine: number }) => void;
      inlineCompletion?: (q: { textBeforeCursor: string; textAfterCursor: string; language: string }) => Promise<string>;
    },
  };
  const postMock = vi.fn(async (_url: string, body: { domain?: string; action?: string; input?: { content?: string; path?: string } }) => {
    calls.push(body);
    if (body.action === 'files-read') {
      return { data: { result: { path: 'untitled.js', content: 'const alpha = 1;\n' } } };
    }
    if (body.action === 'files-write') {
      return { data: { result: { path: body.input?.path, bytes: body.input?.content?.length || 0 } } };
    }
    if (body.action === 'exec') {
      const next = execPlan.shift() || 'ok';
      if (next === 'throw') throw new Error('sandbox down');
      if (next === 'unsupported') return { data: { result: { supported: false, stderr: 'no python', exitCode: 1 } } };
      return { data: { result: { stdout: 'ran-ok', stderr: 'warn', exitCode: 0, supported: true } } };
    }
    if (body.action === 'forge-generate') {
      const next = forgePlan.shift() || 'code';
      if (next === 'throw') throw { message: 'forge broke' };
      if (next === 'string') return { data: { result: 'console.log(1)' } };
      if (next === 'content') return { data: { result: { content: 'var a = 1;' } } };
      return { data: { result: { code: 'function app(){return 1}' } } };
    }
    if (body.action === 'tab-completion') {
      const prefix = (body.input as { prefix?: string } | undefined)?.prefix;
      if (prefix === 'THROW') throw new Error('no complete');
      return { data: { result: { completion: 'console' } } };
    }
    if (body.domain === 'llm') {
      const next = llmPlan.shift() || 'fence';
      if (next === 'throw') throw new Error('llm down');
      if (next === 'cancel') throw { name: 'CanceledError' };
      if (next === 'empty') return { data: { ok: true, result: { text: '   ' } } };
      if (next === 'plain') return { data: { ok: true, result: { text: 'just prose' } } };
      return {
        data: {
          ok: true,
          result: { text: '```javascript\nconst z = 1;\n```', dtuRefs: [{ id: 'd1', title: 'Note', tier: 'regular' }] },
        },
      };
    }
    if (body.action === 'multi-file-plan') {
      planCount.n += 1;
      if (planCount.n === 2) return { data: { ok: false, result: {} } };
      if (planCount.n >= 3) throw new Error('plan failed');
      return {
        data: {
          ok: true,
          result: {
            edits: [{ scriptId: 'main', filename: 'untitled.js', language: 'javascript', before: 'const alpha = 1;\n', after: 'const alpha = 2;\n', reason: 'tweak' }],
          },
        },
      };
    }
    if (body.action === 'multi-file-apply' || body.action === 'commit-snapshot') {
      return { data: { ok: true, result: {} } };
    }
    return { data: { ok: true, result: {} } };
  });
  return { calls, postMock, lens, dtus, commands, dyn, execPlan, llmPlan, forgePlan, planCount };
});

const { dtuDelete } = vi.hoisted(() => ({ dtuDelete: vi.fn(async () => ({ data: { ok: true } })) }));
vi.mock('@/lib/api/client', () => ({ api: { post: postMock }, lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })), apiHelpers: { dtus: { delete: dtuDelete } } }));
vi.mock('next/dynamic', async () => {
  const { createElement, useEffect, useState } = await import('react');
  return {
    default: (loader: () => Promise<unknown>) => {
      const src = Function.prototype.toString.call(loader);
      const isPanel = /SnippetsLibrary|SourceControlPanel|GitHubConnectPanel|PushProposalsPanel|CodeWorkbenchSection/.test(src);
      if (!isPanel) {
        return function Dyn(props: { inlineCompletion?: unknown }) {
          if (props && typeof props.inlineCompletion === 'function') dyn.editor = props;
          return createElement('div', { 'data-testid': 'dyn' });
        };
      }
      return function PanelDyn(props: Record<string, unknown>) {
        const [Comp, setComp] = useState<((p: Record<string, unknown>) => unknown) | null>(null);
        useEffect(() => {
          let live = true;
          Promise.resolve(loader()).then((mod) => {
            if (!live || mod == null) return;
            const resolved = typeof mod === 'function'
              ? mod
              : (mod as { default?: (p: Record<string, unknown>) => unknown }).default;
            if (typeof resolved === 'function') setComp(() => resolved);
          });
          return () => { live = false; };
        }, []);
        return Comp ? createElement(Comp, props) : null;
      };
    },
  };
});
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (list: Array<{ id: string; action: () => void }>) => { commands.list = list; },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'ada', username: 'ada' }, isAuthenticated: true }) }));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    hyperDTUs: dtus.hyper,
    megaDTUs: dtus.mega,
    regularDTUs: dtus.regular,
    publishToMarketplace: dtus.publish,
    isLoading: false,
    refetch: dtus.refetch,
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ alerts: dtus.alerts, isLive: true, lastUpdated: 1 }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    isLoading: lens.isLoading,
    isError: lens.isError,
    error: lens.error,
    refetch: vi.fn(),
    create: lens.create,
    update: lens.update,
    remove: lens.remove,
    items: lens.items,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({
    mutate: vi.fn(),
    isPending: false,
    mutateAsync: async ({ action }: { action: string }) => {
      if (action === 'complexityAnalysis') {
        return { ok: true, result: { averageMaintainability: 82, overallRating: 'B', totalModules: 3, totalLines: 120, hotspots: [{}] } };
      }
      if (action === 'dependencyAudit') {
        return { ok: true, result: { totalDependencies: 4, directCount: 2, highRisk: [{}], circularDependencies: ['a'] } };
      }
      if (action === 'coverageAnalysis') {
        return { ok: true, result: { overall: { statementCoverage: 70, branchCoverage: 40 }, meetsThreshold80: false, gaps: ['a.ts'] } };
      }
      if (action === 'changeRiskAssessment') {
        return { ok: true, result: { overallRisk: 'high', totalChurn: 40, totalFiles: 2, recommendations: ['split it'] } };
      }
      if (action === 'fail') return { ok: false, error: 'nope' };
      throw new Error('action blew up');
    },
  }),
}));
// JS/TS runs in a browser Worker since #1707 (localExec.ts); jsdom has no Worker, so stand in for the worker
// runner and keep driving each outcome from the same execPlan the server-exec mock used to read.
vi.mock('@/components/code/localExec', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/code/localExec')>();
  return {
    ...real,
    runLocalScript: vi.fn(async () => {
      const next = execPlan.shift() || 'ok';
      if (next === 'throw') throw new Error('sandbox down');
      if (next === 'unsupported') return { result: { supported: false, stderr: 'no python', exitCode: 1 }, elapsedMs: 3, timedOut: false, ranLocally: false };
      return { result: { stdout: 'ran-ok', stderr: 'warn', exitCode: 0, supported: true }, elapsedMs: 3, timedOut: false, ranLocally: true };
    }),
  };
});
vi.mock('@/components/common/SafeCard', () => ({ SafeCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/code/CodeWorkbenchSection', () => ({ CodeWorkbenchSection: () => <div>workbench</div> }));
vi.mock('@/components/code/QuickScriptProjectBadge', () => ({ QuickScriptProjectBadge: () => null }));
vi.mock('@/components/chat/BYOKeyDrawer', () => ({ default: ({ open }: { open?: boolean }) => open ? <div>byo-open</div> : null }));
vi.mock('@/components/chat/CitationChips', () => ({ default: () => <span>cited</span> }));
vi.mock('@/components/code/SettingsPanel', async () => {
  const actual = await vi.importActual<typeof import('@/components/code/SettingsPanel')>('@/components/code/SettingsPanel');
  return { ...actual, default: () => null };
});
vi.mock('@/components/code/SnippetsLibrary', () => ({
  SnippetsLibrary: ({ onInsert }: { onInsert: (code: string) => void }) => (
    <button type="button" onClick={() => onInsert('inserted()')}>insert snippet</button>
  ),
}));
vi.mock('@/components/code/SourceControlPanel', () => ({
  SourceControlPanel: ({ onCommitAll, onJumpToTab }: { onCommitAll: (m: string) => void; onJumpToTab: (id: string) => void }) => (
    <div>
      <button type="button" onClick={() => onJumpToTab('main')}>jump tab</button>
      <button type="button" onClick={() => onCommitAll('save point')}>commit all</button>
    </div>
  ),
}));
vi.mock('@/components/code/GitHubConnectPanel', () => ({ GitHubConnectPanel: () => <div>github</div> }));
vi.mock('@/components/code/PushProposalsPanel', () => ({ PushProposalsPanel: () => null }));
vi.mock('@/components/code/BrainStatusBadge', () => ({ BrainStatusBadge: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({
  MobileTabBar: ({ tabs, onSelect }: { tabs: Array<{ id: string; label: string }>; onSelect: (id: string) => void }) => (
    <div>
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onSelect(t.id)}>{`mobile-${t.label}`}</button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/code/MultiFileAgentReview', () => ({
  default: ({ open, edits, onApply, onRegenerate }: { open: boolean; edits: unknown[]; onApply: (e: unknown[]) => void; onRegenerate?: () => void }) => open ? (
    <div>
      <button type="button" onClick={() => onApply(edits)}>apply edits</button>
      <button type="button" onClick={() => onApply([])}>apply none</button>
      <button type="button" onClick={() => onRegenerate?.()}>regen plan</button>
    </div>
  ) : null,
}));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: ({ error }: { error?: string }) => <div>error-state {error}</div> }));
vi.mock('@/components/ui', () => ({ Skeleton: () => <div>skeleton</div> }));
vi.mock('@/components/lens/LensContextPanel', () => ({
  LensContextPanel: ({ onPublish, hyperDTUs }: { onPublish: (d: { id: string }) => void; hyperDTUs: Array<{ id: string }> }) => (
    <button type="button" onClick={() => hyperDTUs[0] && onPublish(hyperDTUs[0])}>publish dtu</button>
  ),
}));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({
  VisionAnalyzeButton: ({ onResult }: { onResult: (r: { analysis: string }) => void }) => (
    <button type="button" onClick={() => onResult({ analysis: 'use const\ninstead' })}>vision</button>
  ),
}));
vi.mock('@/components/code/CodeRunMenu', () => ({ CodeRunMenu: () => null }));

import { CodeEditorWorkspacePanel } from '@/components/code/CodeEditorWorkspacePanel';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeEditorWorkspacePanel onOpenExtras={() => { /* extras shell */ }} />
    </QueryClientProvider>,
  );
}

// Slice B7 — FIX-code-002: scratch scripts can be named, renamed, and
// removed. The saved set is listed in the Explorer; removal also
// deletes the library DTU the save minted (recorded dtuId link).
describe('FIX-code-002 saved scratch scripts', () => {
  beforeEach(() => {
    calls.length = 0;
    postMock.mockClear();
    lens.update.mockClear();
    lens.remove.mockClear();
    dtuDelete.mockClear();
    lens.isLoading = false;
    lens.isError = false;
    lens.error = null;
    lens.items = [
      { id: 'scr_1', title: 'alpha.js', data: { content: 'const a = 1;', language: 'javascript', scriptType: 'snippet', dtuId: 'dtu_1' } },
      { id: 'scr_2', title: 'beta.js', data: { content: 'const b = 2;', language: 'javascript', scriptType: 'snippet' } },
    ] as typeof lens.items;
  });

  it('lists the saved scripts and opens one as a tab', async () => {
    mount();
    expect(await screen.findByText('Saved scripts (2)')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Open alpha.js'));
    expect(await screen.findByRole('button', { name: 'Rename alpha.js' })).toBeTruthy();
  });

  it('renaming from the list persists the artifact title', async () => {
    mount();
    expect(await screen.findByText('Saved scripts (2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rename saved script beta.js' }));
    fireEvent.change(screen.getByLabelText('Saved script name'), { target: { value: 'gamma.js' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(lens.update).toHaveBeenCalledWith('scr_2', { title: 'gamma.js' }));
  });

  it('removing a saved script deletes the artifact AND its linked DTU, behind the confirm', async () => {
    mount();
    expect(await screen.findByText('Saved scripts (2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved script alpha.js' }));
    expect(lens.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(lens.remove).toHaveBeenCalledWith('scr_1'));
    await waitFor(() => expect(dtuDelete).toHaveBeenCalledWith('dtu_1'));
  });

  it('the active tab can be renamed — the name Save will persist', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename untitled.js' }));
    const input = screen.getByLabelText('Script name');
    fireEvent.change(input, { target: { value: 'named.js' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Rename named.js' })).toBeTruthy();
  });
});
