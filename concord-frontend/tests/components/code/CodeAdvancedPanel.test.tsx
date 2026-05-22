import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// ProjectSwitcher stub — exposes a button to pick a project.
vi.mock('@/components/code/ProjectSwitcher', () => ({
  ProjectSwitcher: ({ onChange }: { onChange: (id: string) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'pick-project', onClick: () => onChange('p1') },
      'pick'
    ),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';

const FILES = [
  { path: 'src/a.ts', language: 'ts', size: 100 },
  { path: 'src/b.js', language: 'js', size: 50 },
];

/** Routes a (domain, action, input) call through a handler table. */
function route(table: Record<string, unknown>) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action in table) return Promise.resolve(table[action]);
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

const filesTreeOk = { data: { ok: true, result: { tree: FILES } } };

async function pickProject() {
  fireEvent.click(screen.getByTestId('pick-project'));
}

describe('CodeAdvancedPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders the project prompt before a project is picked', () => {
    route({});
    render(<CodeAdvancedPanel />);
    expect(
      screen.getByText('Select or create a project above to use the advanced IDE tools.')
    ).toBeInTheDocument();
  });

  it('switches between every tab once a project is selected', async () => {
    route({ 'files-tree': filesTreeOk });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() =>
      expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText('Debugger'));
    expect(screen.getByText(/Click a line number/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remote Git'));
    expect(screen.getByText(/Pull a public GitHub repo/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Codebase Chat'));
    expect(screen.getByText(/Ask anything about this codebase/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Extensions'));
    expect(screen.getByText(/Installed/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Split View'));
    expect(screen.getByText(/Arrange multiple files/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Live Share'));
    expect(screen.getByText(/Start a collaborative session/)).toBeInTheDocument();
  });

  it('IntelliSense resolves a symbol and shows hover + signature', async () => {
    route({
      'files-tree': filesTreeOk,
      'lsp-hover': {
        data: {
          ok: true,
          result: { found: true, kind: 'function', hover: 'fn foo(): void', doc: 'a fn' },
        },
      },
      'lsp-signature': {
        data: {
          ok: true,
          result: {
            found: true,
            label: 'foo(x: number)',
            parameters: [{ name: 'x', type: 'number', label: 'x' }],
            returnType: 'void',
          },
        },
      },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Symbol name/), {
      target: { value: 'foo' },
    });
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(screen.getByText('fn foo(): void')).toBeInTheDocument());
    expect(screen.getByText('foo(x: number)')).toBeInTheDocument();
    expect(screen.getByText('Signature help')).toBeInTheDocument();
  });

  it('IntelliSense shows the not-found hover branch', async () => {
    route({
      'files-tree': filesTreeOk,
      'lsp-hover': { data: { ok: true, result: { found: false, hover: 'nothing here' } } },
      'lsp-signature': { data: { ok: true, result: { found: false } } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Symbol name/), {
      target: { value: 'missing' },
    });
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(screen.getByText('nothing here')).toBeInTheDocument());
  });

  it('IntelliSense surfaces a hover error', async () => {
    route({
      'files-tree': filesTreeOk,
      'lsp-hover': { data: { ok: false, error: 'lsp down' } },
      'lsp-signature': { data: { ok: true, result: { found: false } } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Symbol name/), {
      target: { value: 'foo' },
    });
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(screen.getByText('lsp down')).toBeInTheDocument());
  });

  it('Debugger loads a file, sets a breakpoint, and runs', async () => {
    route({
      'files-tree': filesTreeOk,
      'files-read': { data: { ok: true, result: { content: 'line1\nline2\nline3' } } },
      'debug-run': {
        data: {
          ok: true,
          result: {
            exitCode: 0,
            durationMs: 12,
            stdout: 'done',
            frames: [
              { line: 2, sourceText: 'line2', callStack: ['main'], watch: { x: '5' } },
            ],
          },
        },
      },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Debugger'));
    await waitFor(() => expect(screen.getByText('line1')).toBeInTheDocument());
    // toggle a breakpoint on line 1
    fireEvent.click(screen.getByText('1'));
    fireEvent.change(screen.getByPlaceholderText(/Watch expressions/), {
      target: { value: 'x, y' },
    });
    fireEvent.click(screen.getByText('Debug'));
    await waitFor(() => expect(screen.getByText('exit 0')).toBeInTheDocument());
    expect(screen.getByText('x = 5')).toBeInTheDocument();
    expect(screen.getByText('↳ main')).toBeInTheDocument();
  });

  it('Debugger surfaces a debug-run error', async () => {
    route({
      'files-tree': filesTreeOk,
      'files-read': { data: { ok: true, result: { content: 'code here' } } },
      'debug-run': { data: { ok: false, error: 'debug exploded' } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Debugger'));
    await waitFor(() => expect(screen.getByText('code here')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Debug'));
    await waitFor(() => expect(screen.getByText('debug exploded')).toBeInTheDocument());
  });

  it('Remote Git pulls a repo and shows the remote card', async () => {
    route({
      'files-tree': filesTreeOk,
      'github-remote-status': {
        data: {
          ok: true,
          result: {
            remote: {
              owner: 'octo',
              repo: 'demo',
              url: 'https://github.com/octo/demo',
              defaultBranch: 'main',
              stars: 42,
            },
            pushLog: [
              {
                id: 'pl1',
                message: 'first push',
                fileCount: 3,
                pushedAt: '2026-01-01',
                branch: 'main',
              },
            ],
          },
        },
      },
      'github-pull': { data: { ok: true, result: { pulledFiles: 12 } } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Remote Git'));
    await waitFor(() => expect(screen.getByText('octo/demo')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('owner'), { target: { value: 'octo' } });
    fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByText('Pull'));
    await waitFor(() =>
      expect(screen.getByText(/Pulled 12 file\(s\)/)).toBeInTheDocument()
    );
    expect(screen.getByText('first push')).toBeInTheDocument();
  });

  it('Remote Git pushes a commit', async () => {
    route({
      'files-tree': filesTreeOk,
      'github-remote-status': {
        data: {
          ok: true,
          result: {
            remote: {
              owner: 'octo',
              repo: 'demo',
              url: 'https://github.com/octo/demo',
              defaultBranch: 'main',
              stars: 1,
            },
          },
        },
      },
      'github-push': { data: { ok: true, result: { note: 'pushed ok' } } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Remote Git'));
    await waitFor(() => expect(screen.getByText('octo/demo')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Commit message for push'), {
      target: { value: 'a push' },
    });
    fireEvent.click(screen.getByText('Push'));
    await waitFor(() => expect(screen.getByText('pushed ok')).toBeInTheDocument());
  });

  it('Codebase Chat sends a message and shows the reply', async () => {
    route({
      'files-tree': filesTreeOk,
      'codebase-chat': {
        data: { ok: true, result: { reply: 'auth lives in auth.ts', contextFiles: ['auth.ts'] } },
      },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Codebase Chat'));
    fireEvent.change(screen.getByPlaceholderText('Ask about your codebase…'), {
      target: { value: 'where is auth?' },
    });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() =>
      expect(screen.getByText('auth lives in auth.ts')).toBeInTheDocument()
    );
    expect(screen.getByText('@auth.ts')).toBeInTheDocument();
  });

  it('Codebase Chat surfaces an error and restores history', async () => {
    route({
      'files-tree': filesTreeOk,
      'codebase-chat': { data: { ok: false, error: 'chat blew up' } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Codebase Chat'));
    fireEvent.change(screen.getByPlaceholderText('Ask about your codebase…'), {
      target: { value: 'q' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Ask about your codebase…'), {
      key: 'Enter',
    });
    await waitFor(() => expect(screen.getByText('chat blew up')).toBeInTheDocument());
  });

  it('Extensions installs and uninstalls', async () => {
    let installed: unknown[] = [];
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'files-tree') return Promise.resolve(filesTreeOk);
      if (action === 'extensions-catalog')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              catalog: [
                { id: 'e1', name: 'Linter', kind: 'lint', description: 'lints code' },
              ],
            },
          },
        });
      if (action === 'extensions-list')
        return Promise.resolve({ data: { ok: true, result: { extensions: installed } } });
      if (action === 'extensions-install') {
        installed = [{ id: 'e1', name: 'Linter', kind: 'lint', enabled: true }];
        return Promise.resolve({ data: { ok: true, result: {} } });
      }
      if (action === 'extensions-uninstall') {
        installed = [];
        return Promise.resolve({ data: { ok: true, result: {} } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Extensions'));
    await waitFor(() => expect(screen.getByText('Install')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Install'));
    await waitFor(() => expect(screen.getByTitle('Uninstall')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Uninstall'));
    await waitFor(() =>
      expect(screen.getByText('No extensions installed yet.')).toBeInTheDocument()
    );
  });

  it('Extensions toggles an installed extension', async () => {
    route({
      'files-tree': filesTreeOk,
      'extensions-catalog': { data: { ok: true, result: { catalog: [] } } },
      'extensions-list': {
        data: {
          ok: true,
          result: {
            extensions: [{ id: 'e1', name: 'Theme', kind: 'theme', enabled: true }],
          },
        },
      },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Extensions'));
    await waitFor(() => expect(screen.getByText('Theme')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Disable'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([, a]) => a === 'extensions-toggle')).toBe(true)
    );
  });

  it('Split View changes orientation and saves the layout', async () => {
    route({
      'files-tree': filesTreeOk,
      'layout-get': { data: { ok: true, result: {} } },
      'layout-save': { data: { ok: true, result: {} } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Split View'));
    await waitFor(() => expect(screen.getByText('Pane 1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('grid'));
    await waitFor(() => expect(screen.getByText('Pane 4')).toBeInTheDocument());
    // assign a file to a pane
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'src/a.ts' },
    });
    fireEvent.click(screen.getByText('Save layout'));
    await waitFor(() => expect(screen.getByText('Layout saved.')).toBeInTheDocument());
  });

  it('Split View hydrates a persisted layout', async () => {
    route({
      'files-tree': filesTreeOk,
      'layout-get': {
        data: {
          ok: true,
          result: {
            layout: { orientation: 'vertical', panes: [{ id: 'p1', path: 'src/a.ts' }, { id: 'p2', path: null }] },
          },
        },
      },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Split View'));
    await waitFor(() => expect(screen.getByText('Pane 2')).toBeInTheDocument());
  });

  it('Live Share starts a session and broadcasts an edit', async () => {
    const SESSION = {
      code: 'ABCD',
      name: 'My session',
      hostId: 'u1',
      status: 'active',
      participants: [{ userId: 'u1', role: 'host' }],
      participantCount: 1,
      opCount: 0,
    };
    route({
      'files-tree': filesTreeOk,
      'liveshare-start': { data: { ok: true, result: { session: SESSION } } },
      'liveshare-poll': {
        data: {
          ok: true,
          result: {
            session: SESSION,
            ops: [{ seq: 1, kind: 'edit', actor: 'u1', path: 'src/a.ts', at: '2026-01-01' }],
            nextSince: 1,
          },
        },
      },
      'liveshare-edit': { data: { ok: true, result: {} } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Live Share'));
    fireEvent.change(screen.getByPlaceholderText('Session name (optional)'), {
      target: { value: 'My session' },
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText('My session')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox').slice(-1)[0], {
      target: { value: 'src/a.ts' },
    });
    fireEvent.click(screen.getByText('Broadcast'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([, a]) => a === 'liveshare-edit')).toBe(true)
    );
  });

  it('Live Share surfaces a start error', async () => {
    route({
      'files-tree': filesTreeOk,
      'liveshare-start': { data: { ok: false, error: 'session limit' } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Live Share'));
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText('session limit')).toBeInTheDocument());
  });

  it('Live Share joins an existing session and ends it', async () => {
    const SESSION = {
      code: 'WXYZ',
      name: 'Joined',
      hostId: 'h',
      status: 'active',
      participants: [],
      participantCount: 2,
      opCount: 0,
    };
    route({
      'files-tree': filesTreeOk,
      'liveshare-join': { data: { ok: true, result: { session: SESSION } } },
      'liveshare-poll': { data: { ok: true, result: { session: SESSION, ops: [], nextSince: 0 } } },
      'liveshare-end': { data: { ok: true, result: {} } },
    });
    render(<CodeAdvancedPanel />);
    await pickProject();
    await waitFor(() => expect(screen.getByText(/Resolve a symbol/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Live Share'));
    fireEvent.change(screen.getByPlaceholderText('Session code'), {
      target: { value: 'wxyz' },
    });
    fireEvent.click(screen.getByText('Join'));
    await waitFor(() => expect(screen.getByText('Joined')).toBeInTheDocument());
    fireEvent.click(screen.getByText('End'));
    await waitFor(() =>
      expect(screen.getByText('Start a collaborative session', { exact: false })).toBeInTheDocument()
    );
  });
});
