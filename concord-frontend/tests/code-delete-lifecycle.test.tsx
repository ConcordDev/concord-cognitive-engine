/**
 * S3 (PR #1707): the delete lifecycle — file, project, snippet.
 *
 * F2's signature was identical on all three surfaces: click, no
 * confirmation, nothing happens, silently. The handlers were in fact
 * wired to real macros — but every one of them gated on the native
 * window.confirm() dialog (the fleet's native-dialog dead-control
 * class: in embedded surfaces the dialog never resolves for the user)
 * and two of the three swallowed server refusals without a word.
 *
 * These tests pin the rebuilt behaviour:
 *  - no native dialog is ever invoked (window.confirm spied);
 *  - first click arms an in-UI confirmation, second click calls the
 *    macro with the right input;
 *  - success re-reads the server's list (persistence is proven, not
 *    assumed from local state);
 *  - a server refusal renders its reason and the object stays.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { FileExplorer } from '@/components/code/FileExplorer';
import { ProjectSwitcher } from '@/components/code/ProjectSwitcher';
import { SnippetsLibrary } from '@/components/code/SnippetsLibrary';

type Call = { domain: string; action: string; input: Record<string, unknown> };
const calls = () => lensRunMock.mock.calls.map((c) => c[0] as Call);
const confirmSpy = vi.fn(() => true);

beforeEach(() => {
  lensRunMock.mockReset();
  confirmSpy.mockClear();
  vi.stubGlobal('confirm', confirmSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('FileExplorer delete (S3)', () => {
  function setup(deleteResult: unknown) {
    let treeCalls = 0;
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'files-tree') {
        treeCalls += 1;
        const tree = treeCalls === 1
          ? [{ path: 'a.ts', language: 'typescript', size: 3, modifiedAt: '' }, { path: 'b.ts', language: 'typescript', size: 3, modifiedAt: '' }]
          : [{ path: 'b.ts', language: 'typescript', size: 3, modifiedAt: '' }];
        return Promise.resolve({ data: { ok: true, result: { tree } } });
      }
      if (req.action === 'files-delete') return Promise.resolve({ data: deleteResult });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<FileExplorer projectId="p1" activePath={null} onOpen={() => undefined} />);
  }

  it('arms in-UI, then deletes via the macro and re-reads the tree — no native dialog', async () => {
    setup({ ok: true, result: { deleted: true } });
    await screen.findByText('a.ts');
    fireEvent.click(screen.getAllByLabelText('Delete')[0]);
    // Armed only: no macro call yet, and the confirm affordance is in the DOM.
    expect(calls().filter((c) => c.action === 'files-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByLabelText('Confirm delete a.ts'));
    await waitFor(() => expect(screen.queryByText('a.ts')).toBeNull());
    const del = calls().find((c) => c.action === 'files-delete');
    expect(del?.input).toEqual({ projectId: 'p1', path: 'a.ts' });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a server refusal speaks and the file stays', async () => {
    setup({ ok: false, error: 'file not found' });
    await screen.findByText('a.ts');
    fireEvent.click(screen.getAllByLabelText('Delete')[0]);
    fireEvent.click(await screen.findByLabelText('Confirm delete a.ts'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Could not delete a\.ts: file not found/);
    expect(screen.getByText('a.ts')).toBeTruthy();
  });
});

describe('ProjectSwitcher delete (S3)', () => {
  function setup(deleteResult: unknown, onDeleted = vi.fn()) {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'projects-list') {
        return Promise.resolve({ data: { ok: true, result: { projects: [{ id: 'p1', number: '1', name: 'Doomed', description: '', language: 'ts', createdAt: '' }] } } });
      }
      if (req.action === 'projects-delete') return Promise.resolve({ data: deleteResult });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<ProjectSwitcher value="p1" onChange={() => undefined} onDeleted={onDeleted} />);
    return onDeleted;
  }

  it('confirms in the panel, deletes, and notifies — no native dialog', async () => {
    const onDeleted = setup({ ok: true, result: { deleted: true } });
    fireEvent.click(await screen.findByLabelText('Delete this project'));
    expect(await screen.findByText(/Delete project “Doomed” permanently/)).toBeTruthy();
    expect(calls().filter((c) => c.action === 'projects-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls().find((c) => c.action === 'projects-delete')?.input).toEqual({ id: 'p1' });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('cancel backs out without calling the macro', async () => {
    setup({ ok: true, result: { deleted: true } });
    fireEvent.click(await screen.findByLabelText('Delete this project'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(calls().filter((c) => c.action === 'projects-delete')).toHaveLength(0);
  });

  it('a refusal renders and onDeleted does not fire', async () => {
    const onDeleted = setup({ ok: false, error: 'project not found' }, vi.fn());
    fireEvent.click(await screen.findByLabelText('Delete this project'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete project' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/project not found/);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('SnippetsLibrary delete (S3)', () => {
  function setup(deleteResult: unknown) {
    let listCalls = 0;
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'snippets-list') {
        listCalls += 1;
        const snippets = listCalls === 1 ? [{ id: 's1', title: 'Helper', language: 'js', code: 'x()', tags: [] }] : [];
        return Promise.resolve({ data: { ok: true, result: { snippets } } });
      }
      if (req.action === 'snippets-delete') return Promise.resolve({ data: deleteResult });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<SnippetsLibrary onInsert={() => undefined} />);
  }

  it('arms in-UI, deletes via the macro, and the refreshed list stays empty — no native dialog', async () => {
    setup({ ok: true, result: { id: 's1', deleted: true } });
    await screen.findByText('Helper');
    fireEvent.click(screen.getByLabelText('Delete Helper'));
    expect(calls().filter((c) => c.action === 'snippets-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByLabelText('Confirm delete Helper'));
    await waitFor(() => expect(screen.queryByText('Helper')).toBeNull());
    expect(calls().find((c) => c.action === 'snippets-delete')?.input).toEqual({ id: 's1' });
    expect(calls().filter((c) => c.action === 'snippets-list').length).toBeGreaterThanOrEqual(2);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a refusal (not owner) speaks and the snippet stays', async () => {
    setup({ ok: false, error: 'not owner' });
    await screen.findByText('Helper');
    fireEvent.click(screen.getByLabelText('Delete Helper'));
    fireEvent.click(await screen.findByLabelText('Confirm delete Helper'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not owner/);
    expect(screen.getByText('Helper')).toBeTruthy();
  });
});
