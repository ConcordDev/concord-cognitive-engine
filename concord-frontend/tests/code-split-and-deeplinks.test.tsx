/**
 * S13 (PR #1707): saved split layouts render; Open Extras deep-links (F12).
 *
 * The Split View tab always saved its layout — nothing ever rendered
 * it, so "the layout survives reload; the split doesn't exist". And
 * every Open Extras button landed on IntelliSense regardless of its
 * name. These tests pin: a saved vertical layout renders BOTH files
 * as real panes in the workbench, and the Advanced panel opens on
 * the tab a deep-link names.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Stub Monaco via next/dynamic: renders the buffer text.
vi.mock('next/dynamic', () => ({
  default: () => function StubMonaco(props: { value: string }) {
    return <pre data-testid="pane-buffer">{props.value}</pre>;
  },
}));

import { CodeWorkbenchSection } from '@/components/code/CodeWorkbenchSection';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';
import { CodeProjectProvider, useCodeProject } from '@/components/code/CodeProjectContext';
import { useEffect } from 'react';

function SelectProject({ id }: { id: string }) {
  const { setProjectId } = useCodeProject();
  useEffect(() => { setProjectId(id); }, [id, setProjectId]);
  return null;
}

type Call = { domain: string; action: string; input: Record<string, unknown> };
function actionOf(args: unknown[]): string {
  const a = args[0] as Call | string;
  if (typeof a === 'string') return String(args[1]);
  return a?.action || '';
}
function inputOf(args: unknown[]): Record<string, unknown> {
  const a = args[0] as Call | string;
  if (typeof a === 'string') return (args[2] as Record<string, unknown>) || {};
  return a?.input || {};
}

const FILES: Record<string, string> = {
  'main.js': 'const main = 1;\n',
  'helper.py': '# helper\nx = 2\n',
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((...args: unknown[]) => {
    const action = actionOf(args);
    const input = inputOf(args);
    switch (action) {
      case 'layout-get':
        return Promise.resolve({ data: { ok: true, result: { layout: { orientation: 'vertical', panes: [{ id: 'pane-1', path: 'main.js' }, { id: 'pane-2', path: 'helper.py' }] } } } });
      case 'files-read':
        return Promise.resolve({ data: { ok: true, result: { content: FILES[String(input.path)] ?? '', language: 'javascript' } } });
      case 'files-tree':
        return Promise.resolve({ data: { ok: true, result: { tree: [{ path: 'main.js', language: 'javascript' }, { path: 'helper.py', language: 'python' }] } } });
      case 'projects-list':
        return Promise.resolve({ data: { ok: true, result: { projects: [{ id: 'p1', name: 'P', number: 'P-0001' }] } } });
      case 'git-status':
        return Promise.resolve({ data: { ok: true, result: { branch: 'main', modified: [], staged: [] } } });
      case 'diagnostics':
        return Promise.resolve({ data: { ok: true, result: { problems: [], bySeverity: { error: 0, warning: 0 }, engine: 'typescript' } } });
      case 'workspace-summary':
        return Promise.resolve({ data: { ok: true, result: { projectCount: 1, fileCount: 2, runningTasks: 0, dirtyProjects: 0 } } });
      case 'symbols-outline':
        return Promise.resolve({ data: { ok: true, result: { symbols: [], source: 'lexical' } } });
      default:
        return Promise.resolve({ data: { ok: true, result: {} } });
    }
  });
});

describe('split layout rendering (S13)', () => {
  it('a saved vertical layout renders both files side by side as editable panes', async () => {
    render(
      <CodeProjectProvider>
        <SelectProject id="p1" />
        <CodeWorkbenchSection />
      </CodeProjectProvider>,
    );
    const buffers = await screen.findAllByTestId('pane-buffer');
    const texts = buffers.map(b => b.textContent);
    expect(texts.some(t => t?.includes('const main = 1;'))).toBe(true);
    expect(texts.some(t => t?.includes('# helper'))).toBe(true);
    expect(buffers.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Advanced panel deep-links (S13)', () => {
  it('initialTab="debugger" opens on the Breakpoints tab, not IntelliSense', async () => {
    render(
      <CodeProjectProvider>
        <CodeAdvancedPanel initialTab="debugger" />
      </CodeProjectProvider>,
    );
    expect(await screen.findByText(/Step debugging is unavailable/)).toBeTruthy();
  });

  it('initialTab="layout" opens on Split View', async () => {
    render(
      <CodeProjectProvider>
        <CodeAdvancedPanel initialTab="layout" />
      </CodeProjectProvider>,
    );
    expect(await screen.findByText(/Arrange multiple files side by side/)).toBeTruthy();
  });
});
