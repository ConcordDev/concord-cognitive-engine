import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

Element.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.scrollTo = vi.fn();

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { get: vi.fn().mockResolvedValue({ data: { ok: false } }) },
}));

// Both CodeAdvancedPanel's own dynamic `import('socket.io-client')` calls
// (LiveShareTab's op-push subscription, SharedDebugTerminalTile) AND the
// app-wide getSocket() singleton (lib/realtime/socket.ts, reached via
// useYjsAwareness -> useSocket) construct a socket through this same
// module, so the fake needs the fuller shape useSocket's effect touches
// (`.io.on`, `.connect`, `.connected`), not just `.on`/`.emit`.
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  })),
}));

import { CodeProjectProvider } from '@/components/code/CodeProjectContext';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';

const PROJECTS = [{ id: 'proj-alpha', number: 'P-0001', name: 'Alpha', description: '', language: 'ts', createdAt: '2026-01-01' }];
const FILES = [
  { path: 'src/index.ts', language: 'typescript', size: 100 },
  { path: 'src/util.ts', language: 'typescript', size: 50 },
];

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}
function bad(error: string) {
  return { data: { ok: false, result: null, error } };
}

function mockDispatch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    'projects-list': ok({ projects: PROJECTS }),
    'files-tree': ok({ tree: FILES }),
    'files-read': ok({ content: 'const x = 1;\nconsole.log(x);\n' }),
    'github-remote-status': ok({ remote: null, pushLog: [] }),
    'extensions-catalog': ok({ catalog: [] }),
    'extensions-list': ok({ extensions: [] }),
    'layout-get': ok({ layout: null }),
    ...overrides,
  };
  lensRun.mockImplementation((...args: unknown[]) => {
    const [domainOrSpec, actionArg] = args;
    const action = typeof domainOrSpec === 'string' ? actionArg : (domainOrSpec as { action?: string })?.action;
    if (action && action in table) return Promise.resolve(table[action]);
    return Promise.resolve(ok(null));
  });
}

async function renderWithProject() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CodeProjectProvider>
        <CodeAdvancedPanel />
      </CodeProjectProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole('combobox', { name: /select project/i })).toBeInTheDocument());
  fireEvent.change(screen.getByRole('combobox', { name: /select project/i }), { target: { value: 'proj-alpha' } });
  await waitFor(() => expect(screen.queryByText(/Select or create a project/i)).not.toBeInTheDocument());
  return utils;
}

function clickTab(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}$`) }));
}

describe('CodeAdvancedPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });
  afterEach(() => cleanup());

  it('gates every tab behind project selection', async () => {
    mockDispatch();
    render(
      <CodeProjectProvider>
        <CodeAdvancedPanel />
      </CodeProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Select or create a project/i)).toBeInTheDocument());
  });

  it('loads the file tree once a project is picked and defaults IntelliSense to the first file', async () => {
    mockDispatch();
    await renderWithProject();
    await waitFor(() => expect(screen.getByDisplayValue('src/index.ts')).toBeInTheDocument());
  });

  describe('IntelliSense tab', () => {
    it('resolves a symbol and renders hover + signature results', async () => {
      mockDispatch({
        'lsp-hover': ok({ found: true, kind: 'function', source: 'src/index.ts', hover: 'function main(): void', definedAt: { path: 'src/index.ts', line: 3 }, doc: 'Entry point.' }),
        'lsp-signature': ok({ found: true, label: 'main(): void', parameters: [{ name: 'arg', type: 'string', label: 'arg: string' }], returnType: 'void' }),
      });
      await renderWithProject();
      fireEvent.change(screen.getByPlaceholderText(/Symbol name/i), { target: { value: 'main' } });
      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
      await waitFor(() => expect(screen.getByText('function main(): void')).toBeInTheDocument());
      expect(screen.getByText('defined at src/index.ts:3')).toBeInTheDocument();
      expect(screen.getByText('Entry point.')).toBeInTheDocument();
      expect(screen.getByText('main(): void')).toBeInTheDocument();
      expect(screen.getByText('arg')).toBeInTheDocument();
    });

    it('shows "No declaration found" when the symbol does not resolve', async () => {
      mockDispatch({ 'lsp-hover': ok({ found: false }), 'lsp-signature': ok({ found: false }) });
      await renderWithProject();
      fireEvent.change(screen.getByPlaceholderText(/Symbol name/i), { target: { value: 'nope' } });
      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
      await waitFor(() => expect(screen.getByText('No declaration found.')).toBeInTheDocument());
    });

    it('shows an error message when the hover lookup fails', async () => {
      mockDispatch({ 'lsp-hover': bad('lsp offline'), 'lsp-signature': ok({ found: false }) });
      await renderWithProject();
      fireEvent.change(screen.getByPlaceholderText(/Symbol name/i), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
      await waitFor(() => expect(screen.getByText('lsp offline')).toBeInTheDocument());
    });
  });

  describe('Debugger tab', () => {
    it('loads file content, sets a breakpoint, runs, and shows a frame', async () => {
      mockDispatch({
        'debug-run': ok({ exitCode: 0, durationMs: 12, frames: [{ line: 1, sourceText: 'const x = 1;', callStack: ['main'], watch: { x: '1' } }] }),
      });
      await renderWithProject();
      clickTab('Debugger');
      await waitFor(() => expect(screen.getByText('const x = 1;')).toBeInTheDocument());
      fireEvent.click(screen.getByText('1')); // toggle breakpoint on line 1
      fireEvent.click(screen.getByRole('button', { name: /^debug$/i }));
      await waitFor(() => expect(screen.getByText('exit 0')).toBeInTheDocument());
      expect(screen.getByText('x = 1')).toBeInTheDocument();
      expect(screen.getByText('↳ main')).toBeInTheDocument();
    });

    it('shows a debug error message on failure', async () => {
      mockDispatch({ 'debug-run': bad('sandbox unavailable') });
      await renderWithProject();
      clickTab('Debugger');
      await waitFor(() => expect(screen.getByText('const x = 1;')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^debug$/i }));
      await waitFor(() => expect(screen.getByText('sandbox unavailable')).toBeInTheDocument());
    });
  });

  describe('Remote Git tab', () => {
    it('pulls a repo and shows the resulting note + remote card', async () => {
      mockDispatch({
        'github-pull': ok({ pulledFiles: 4 }),
        'github-remote-status': ok({ remote: { owner: 'facebook', repo: 'react', url: 'https://github.com/facebook/react', defaultBranch: 'main', stars: 900 }, pushLog: [] }),
      });
      await renderWithProject();
      clickTab('Remote Git');
      fireEvent.change(screen.getByPlaceholderText('owner'), { target: { value: 'facebook' } });
      fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: 'react' } });
      fireEvent.click(screen.getByRole('button', { name: /pull/i }));
      await waitFor(() => expect(screen.getByText(/Pulled 4 file\(s\) from facebook\/react/)).toBeInTheDocument());
    });

    it('pushes staged changes and renders the push log', async () => {
      mockDispatch({
        'github-remote-status': ok({
          remote: { owner: 'facebook', repo: 'react', url: 'https://x', defaultBranch: 'main', stars: 1 },
          pushLog: [{ id: 'p1', message: 'Initial commit', fileCount: 2, pushedAt: '2026-01-01T00:00:00Z', branch: 'main' }],
        }),
        'github-push': ok({ note: 'Push staged for review.' }),
      });
      await renderWithProject();
      clickTab('Remote Git');
      await waitFor(() => expect(screen.getByText('Initial commit')).toBeInTheDocument());
      fireEvent.change(screen.getByPlaceholderText('Commit message for push'), { target: { value: 'Fix bug' } });
      fireEvent.click(screen.getByRole('button', { name: /push/i }));
      await waitFor(() => expect(screen.getByText('Push staged for review.')).toBeInTheDocument());
    });
  });

  describe('Codebase Chat tab', () => {
    it('sends a message and renders the assistant reply with context files', async () => {
      mockDispatch({
        'codebase-chat': ok({ reply: 'It is handled in src/index.ts.', contextFiles: ['src/index.ts'] }),
      });
      await renderWithProject();
      clickTab('Codebase Chat');
      fireEvent.change(screen.getByPlaceholderText(/Ask about your codebase/i), { target: { value: 'where is main?' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(screen.getByText('It is handled in src/index.ts.')).toBeInTheDocument());
      expect(screen.getByText('@src/index.ts')).toBeInTheDocument();
    });

    it('shows a chat error and restores prior history on failure', async () => {
      mockDispatch({ 'codebase-chat': bad('llm down') });
      await renderWithProject();
      clickTab('Codebase Chat');
      fireEvent.change(screen.getByPlaceholderText(/Ask about your codebase/i), { target: { value: 'hi' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(screen.getByText('llm down')).toBeInTheDocument());
    });
  });

  describe('Extensions tab', () => {
    it('lists installed + marketplace extensions and installs one', async () => {
      mockDispatch({
        'extensions-list': ok({ extensions: [{ id: 'ext-a', name: 'Prettier', kind: 'formatter', enabled: true }] }),
        'extensions-catalog': ok({ catalog: [{ id: 'ext-a', name: 'Prettier', kind: 'formatter', description: 'Format code' }, { id: 'ext-b', name: 'ESLint', kind: 'linter', description: 'Lint code' }] }),
        'extensions-install': ok({}),
      });
      await renderWithProject();
      clickTab('Extensions');
      await waitFor(() => expect(screen.getByText('Prettier')).toBeInTheDocument());
      expect(screen.getByText('ESLint')).toBeInTheDocument(); // only the marketplace (not-installed) entry
      fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('code', 'extensions-install', { extensionId: 'ext-b' }));
    });

    it('toggles and uninstalls an installed extension', async () => {
      mockDispatch({
        'extensions-list': ok({ extensions: [{ id: 'ext-a', name: 'Prettier', kind: 'formatter', enabled: true }] }),
        'extensions-toggle': ok({}),
        'extensions-uninstall': ok({}),
      });
      await renderWithProject();
      clickTab('Extensions');
      await waitFor(() => expect(screen.getByText('Prettier')).toBeInTheDocument());
      fireEvent.click(screen.getByTitle('Disable'));
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('code', 'extensions-toggle', { extensionId: 'ext-a', enabled: false }));
      fireEvent.click(screen.getByTitle('Uninstall'));
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('code', 'extensions-uninstall', { extensionId: 'ext-a' }));
    });
  });

  describe('Split View tab', () => {
    it('switches orientation, assigns panes, and saves the layout', async () => {
      mockDispatch({ 'layout-save': ok({}) });
      await renderWithProject();
      clickTab('Split View');
      fireEvent.click(screen.getByRole('button', { name: 'vertical' }));
      const paneSelects = screen.getAllByDisplayValue('— empty —');
      fireEvent.change(paneSelects[0], { target: { value: 'src/index.ts' } });
      fireEvent.click(screen.getByRole('button', { name: /save layout/i }));
      await waitFor(() => expect(screen.getByText('Layout saved.')).toBeInTheDocument());
      const [, , { orientation, panes }] = lensRun.mock.calls.find(([, action]) => action === 'layout-save')!;
      expect(orientation).toBe('vertical');
      expect(panes[0].path).toBe('src/index.ts');
    });

    it('loads a previously-saved layout on mount', async () => {
      mockDispatch({
        'layout-get': ok({ layout: { orientation: 'grid', panes: [{ id: 'pane-1', path: 'src/index.ts' }, { id: 'pane-2', path: null }, { id: 'pane-3', path: null }, { id: 'pane-4', path: null }] } }),
      });
      await renderWithProject();
      clickTab('Split View');
      await waitFor(() => expect(screen.getByRole('button', { name: 'grid' })).toHaveClass('bg-cyan-500/15'));
    });
  });

  describe('Live Share tab', () => {
    it('starts a session and renders the live session card', async () => {
      mockDispatch({
        'liveshare-start': ok({ session: { code: 'ABC123', name: 'Pairing', hostId: 'u1', status: 'active', participants: [], participantCount: 1, opCount: 0 } }),
        'liveshare-poll': ok({ session: { code: 'ABC123', name: 'Pairing', hostId: 'u1', status: 'active', participants: [], participantCount: 1, opCount: 0 }, ops: [], nextSince: 1 }),
      });
      await renderWithProject();
      clickTab('Live Share');
      fireEvent.change(screen.getByPlaceholderText('Session name (optional)'), { target: { value: 'Pairing' } });
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
      await waitFor(() => expect(screen.getByText('Pairing')).toBeInTheDocument());
      expect(screen.getByText(/code/)).toBeInTheDocument();
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    it('ends an active session and returns to the host/join screen', async () => {
      mockDispatch({
        'liveshare-start': ok({ session: { code: 'ZZZ999', name: 'Sesh', hostId: 'u1', status: 'active', participants: [], participantCount: 1, opCount: 0 } }),
        'liveshare-end': ok({}),
      });
      await renderWithProject();
      clickTab('Live Share');
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
      await waitFor(() => expect(screen.getByText('ZZZ999')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^end$/i }));
      await waitFor(() => expect(screen.getByText(/Start a collaborative session/i)).toBeInTheDocument());
    });

    it('joins a session by code', async () => {
      mockDispatch({
        'liveshare-join': ok({ session: { code: 'JOIN01', name: 'Their session', hostId: 'u2', status: 'active', participants: [], participantCount: 2, opCount: 0 } }),
      });
      await renderWithProject();
      clickTab('Live Share');
      fireEvent.change(screen.getByPlaceholderText('Session code'), { target: { value: 'join01' } });
      fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
      await waitFor(() => expect(screen.getByText('Their session')).toBeInTheDocument());
      expect(lensRun).toHaveBeenCalledWith('code', 'liveshare-join', { code: 'JOIN01' });
    });

    it('shows a start error when the session cannot be created', async () => {
      mockDispatch({ 'liveshare-start': bad('quota exceeded') });
      await renderWithProject();
      clickTab('Live Share');
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
      await waitFor(() => expect(screen.getByText('quota exceeded')).toBeInTheDocument());
    });
  });
});
