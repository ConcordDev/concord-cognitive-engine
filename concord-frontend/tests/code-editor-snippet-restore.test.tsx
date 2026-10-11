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

vi.mock('@/lib/api/client', () => ({ api: { post: postMock }, lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })) }));
vi.mock('next/dynamic', () => ({
  default: () => function Dyn(props: {
    onChange?: (v: string) => void;
    onEditorReady?: (ed: unknown) => void;
    onSelectionChange?: (s: { text: string; startLine: number; endLine: number }) => void;
    inlineCompletion?: (q: { textBeforeCursor: string; textAfterCursor: string; language: string }) => Promise<string>;
    value?: string;
  }) {
    if (props && typeof props.inlineCompletion === 'function') dyn.editor = props;
    return <div data-testid="dyn" />;
  },
}));
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

function cmd(id: string) {
  const found = commands.list.find((c) => c.id === id);
  if (!found) throw new Error(`missing command ${id}`);
  act(() => { found.action(); });
}

beforeEach(() => {
  calls.length = 0;
  postMock.mockClear();
  execPlan.length = 0;
  llmPlan.length = 0;
  forgePlan.length = 0;
  planCount.n = 0;
  lens.isLoading = false;
  lens.isError = false;
  lens.error = null;
  lens.items = [
    { id: 's1', title: 'saved.js', data: { content: 'const alpha = 9;\nexport function go() {}', language: 'javascript', scriptType: 'snippet' } },
    { id: 's2', title: 'bare' },
  ];
  lens.create.mockReset();
  lens.create.mockResolvedValue({});
  dtus.hyper = [
    { id: 'h-user', domain: 'code', userId: 'ada' },
    { id: 'seeded', domain: 'code', seedOrigin: true },
    { id: 'prov', domain: 'code', provenance: { source: 'bootstrap_ingestion' } },
    { id: 'srcb', source: 'bootstrap_ingestion', domain: 'code' },
    { id: 'brain', source: 'concord_brain_index', domain: 'code' },
    { id: 'seedsrc', source: 'seed', domain: 'code' },
    { id: 'created', domain: 'code', createdBy: 'bootstrap_ingestion' },
    { id: 'tagged', domain: 'code', tags: ['seed'] },
    { id: 'dtu_001_x', domain: 'code' },
    { id: 'dtu_root_x', domain: 'code' },
    { id: 'math', domain: 'math' },
    { id: 'bob', domain: 'code', userId: 'bob' },
    { id: 'glob', domain: 'code', scope: 'global' },
    { id: 'prot', domain: 'code', protected: true },
    { id: 'imm', domain: 'code', immutable: true },
    { id: 'meta', source: 'code', meta: { creatorId: 'ada' } },
    { id: 'noowner', domain: 'code' },
  ];
  dtus.mega = [{ id: 'm1', source: 'code', meta: { userId: 'ada' } }];
  dtus.regular = [{ id: 'r1', domain: 'code', creator_id: 'ada' }];
  dtus.alerts = [{ id: 'a1' }, { id: 'a2' }];
  dyn.editor = null;
  resetExecStatusForTests();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/chat/messages')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{ role: 'assistant', content: 'prior note', ts: new Date().toISOString(), meta: { dtuRefs: [{ id: 'd0', title: 'Old', tier: 'mega' }] } }],
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  }));
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
});

describe('CodeEditorWorkspacePanel snippet restore', () => {
  it('reads the saved snippet before any write, then persists that text', async () => {
    mount();
    await waitFor(() => {
      const write = calls.find((c) => c.action === 'files-write');
      expect(write?.input?.content).toBe('const alpha = 1;\n');
    }, { timeout: 2000 });
    const readAt = calls.findIndex((c) => c.action === 'files-read');
    const writeAt = calls.findIndex((c) => c.action === 'files-write');
    expect(readAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(readAt);
    expect(calls.filter((c) => c.action === 'files-write' && c.input?.content === '')).toHaveLength(0);
  });

  it('shows the loading shell and the error shell', () => {
    lens.isLoading = true;
    const loading = mount();
    expect(screen.getAllByText('skeleton').length).toBeGreaterThan(0);
    loading.unmount();
    lens.isLoading = false;
    lens.isError = true;
    lens.error = { message: 'db down' };
    mount();
    expect(screen.getByText(/error-state/)).toBeTruthy();
  });

  it('runs, keeps, and edits from the editor controls', async () => {
    publishExecStatus({ enabled: true, reason: '' });
    const fakeEditor = {
      valueInRange: 'const x = 1',
      getSelection: () => ({ startLineNumber: 1, endLineNumber: 2 }),
      getModel: () => ({ getValueInRange: () => fakeEditor.valueInRange, getLineMaxColumn: () => 12 }),
      revealLineInCenter: vi.fn(),
      setPosition: vi.fn(),
      focus: vi.fn(),
      executeEdits: vi.fn(),
    };
    (window as unknown as { monaco?: { Range: new (...args: number[]) => unknown } }).monaco = {
      Range: class Range { constructor(..._args: number[]) { /* editor range */ } },
    };
    vi.spyOn(window, 'prompt').mockReturnValue('add logs');
    mount();
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'files-write' && c.input?.content === 'const alpha = 1;\n')).toBe(true);
    });

    for (const title of [
      'Project: Multi-file project scaffolding',
      'Pipeline: Data processing and ETL pipelines',
      'Notebook: Interactive computation notebooks',
      'Algorithm: Algorithm implementations and DSA',
      'Library: Reusable modules and packages',
      'Snippet: Quick code snippets and utilities',
    ]) fireEvent.click(screen.getByTitle(title));

    fireEvent.click(screen.getByRole('button', { name: /Complexity analysis/ }));
    await waitFor(() => expect(screen.getByText('82')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss result' }));
    fireEvent.click(screen.getByRole('button', { name: /Dependency audit/ }));
    await waitFor(() => expect(screen.getByText(/circular dependenc/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Coverage analysis/ }));
    await waitFor(() => expect(screen.getByText(/Below 80% threshold/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Change risk/ }));
    await waitFor(() => expect(screen.getByText('HIGH RISK')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss result' }));

    fireEvent.click(screen.getByTitle('Generate Forge App'));
    fireEvent.change(screen.getByPlaceholderText(/Describe the app/), { target: { value: 'a task tracker' } });
    forgePlan.push('code');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByText(/forge_app_/)).toBeTruthy());
    fireEvent.click(screen.getByTitle('Generate Forge App'));
    forgePlan.push('string', 'content');
    fireEvent.change(screen.getByPlaceholderText(/Describe the app/), { target: { value: 'again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getAllByText(/forge_app_/).length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByTitle('Generate Forge App'));
    fireEvent.change(screen.getByPlaceholderText(/Describe the app/), { target: { value: 'third' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(calls.filter((c) => c.action === 'forge-generate').length).toBe(3));
    fireEvent.click(screen.getByTitle('Generate Forge App'));
    forgePlan.push('throw');
    fireEvent.change(screen.getByPlaceholderText(/Describe the app/), { target: { value: 'broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByText(/Forge generation error/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByTitle('API Reference'));
    expect(screen.getByText('console.log(...args)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close API reference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    fireEvent.click(screen.getByTitle('Refresh DTUs'));
    fireEvent.click(screen.getByRole('button', { name: 'vision' }));
    fireEvent.click(screen.getByTitle('New script'));
    fireEvent.click(screen.getByRole('button', { name: /Close script_/ }));
    fireEvent.click(screen.getByTitle('Save script (persists to backend)'));
    await waitFor(() => expect(lens.create).toHaveBeenCalled());
    lens.create.mockRejectedValueOnce(new Error('save no'));
    fireEvent.click(screen.getByTitle('Save script (persists to backend)'));
    fireEvent.click(screen.getByTitle('Copy to clipboard'));
    fireEvent.click(screen.getByTitle('Download file'));
    fireEvent.click(screen.getByRole('button', { name: 'publish dtu' }));
    expect(dtus.publish).toHaveBeenCalled();

    execPlan.push('ok', 'unsupported', 'throw');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/ran-ok/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(screen.getByText(/Script executed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Output' }));
    fireEvent.click(screen.getByRole('button', { name: /Download Output/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/no python/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/Run failed: sandbox down/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close output panel' }));

    publishExecStatus({ enabled: false, reason: 'Live code execution is disabled in this environment.' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true));
    const execs = calls.filter((c) => c.action === 'exec').length;
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => { window.dispatchEvent(new Event('concord:code-run')); });
    cmd('run');
    expect(calls.filter((c) => c.action === 'exec').length).toBe(execs);
    publishExecStatus({ enabled: true, reason: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Find in Files' }));
    fireEvent.change(screen.getByPlaceholderText(/Find in tabs/), { target: { value: 'alpha' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /line / }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /line / })[0]);
    cmd('find-in-files');
    fireEvent.change(screen.getByPlaceholderText(/Find in tabs/), { target: { value: 'alpha' } });
    const hits = screen.getAllByRole('button', { name: /line / });
    fireEvent.click(hits[hits.length - 1]);
    fireEvent.keyDown(screen.getByPlaceholderText(/Find in tabs/), { key: 'Escape' });

    cmd('palette');
    const palette = screen.getByPlaceholderText(/Type to search/);
    fireEvent.change(palette, { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('No matches.')).toBeTruthy();
    fireEvent.change(palette, { target: { value: 'API reference' } });
    fireEvent.keyDown(palette, { key: 'ArrowDown' });
    fireEvent.keyDown(palette, { key: 'ArrowUp' });
    fireEvent.keyDown(palette, { key: 'Enter' });
    cmd('palette');
    fireEvent.keyDown(screen.getByPlaceholderText(/Type to search/), { key: 'Escape' });
    cmd('toggle-tree');
    cmd('toggle-output');
    cmd('toggle-terminal');
    cmd('open-settings');
    cmd('fullscreen');
    cmd('snippets');
    fireEvent.click(screen.getByRole('button', { name: 'insert snippet' }));
    cmd('source-control');
    fireEvent.click(screen.getByRole('button', { name: 'jump tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'commit all' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'commit-snapshot')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    expect(screen.getByText('github')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'AI agent' }));
    const agentInput = document.getElementById('multi-file-agent-input') as HTMLTextAreaElement;
    fireEvent.change(agentInput, { target: { value: 'validate inputs' } });
    fireEvent.keyDown(agentInput, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply edits' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'apply none' }));
    fireEvent.click(screen.getByRole('button', { name: 'apply edits' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'multi-file-apply')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'regen plan' }));
    cmd('multi-file-agent');
    await waitFor(() => expect(planCount.n).toBeGreaterThanOrEqual(3));
    fireEvent.click(screen.getByRole('button', { name: 'Run & debug' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Extras/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Extensions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explorer' }));
    cmd('project-workspace');
    expect(screen.getByText('workbench')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('tab', { name: 'Scratch' })[0]);
    cmd('scratch-workspace');

    fireEvent.click(screen.getByRole('button', { name: 'mobile-Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile-Search' }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile-Git' }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile-Snip' }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile-Term' }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile-Agent' }));
    fireEvent.click(screen.getByTitle('Toggle terminal (⌃`)'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);

    act(() => {
      dyn.editor?.onChange?.('const alpha = 1;\nconst extra = 2;\n');
      dyn.editor?.onSelectionChange?.({ text: 'const extra = 2;', startLine: 2, endLine: 2 });
    });
    expect(screen.getByText(/selected/)).toBeTruthy();
    const completion = await dyn.editor?.inlineCompletion?.({ textBeforeCursor: 'con', textAfterCursor: '', language: 'javascript' });
    expect(completion).toBe('console');
    await expect(dyn.editor?.inlineCompletion?.({ textBeforeCursor: 'THROW', textAfterCursor: '', language: 'javascript' })).resolves.toBe('');

    llmPlan.push('fence');
    cmd('ai-chat');
    await waitFor(() => expect(screen.getByText('prior note')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    const chatBox = screen.getByPlaceholderText(/Message AI pair/);
    fireEvent.change(chatBox, { target: { value: 'explain this' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Insert/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: /Insert/ }));
    fireEvent.click(screen.getByRole('button', { name: 'BYO API keys' }));
    expect(screen.getByText('byo-open')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('include file'));
    llmPlan.push('throw');
    fireEvent.change(screen.getByPlaceholderText(/Message AI pair/), { target: { value: 'again' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Message AI pair/), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/llm down/)).toBeTruthy());
    fireEvent.click(screen.getByTitle('Close (⌘L)'));

    act(() => { dyn.editor?.onEditorReady?.(fakeEditor); });
    llmPlan.push('empty', 'fence', 'cancel');
    cmd('ai-edit');
    const editBox = screen.getByPlaceholderText(/Describe the change/);
    fireEvent.change(editBox, { target: { value: 'add a guard' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await waitFor(() => expect(screen.getByText(/no code/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Describe the change/), { target: { value: 'add a guard' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Describe the change/), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the change/), { target: { value: 'add a guard' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fakeEditor.valueInRange = '';
    llmPlan.push('plain');
    cmd('ai-edit');
    fireEvent.change(screen.getByPlaceholderText(/Describe the change/), { target: { value: 'rewrite' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));

    cmd('palette-shift');
    fireEvent.change(screen.getByPlaceholderText(/Type to search/), { target: { value: 'Run script' } });
    fireEvent.click(screen.getByText('Run script'));
  });
});
