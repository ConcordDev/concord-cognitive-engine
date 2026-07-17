/**
 * ShadowsPanel — pins the frontend surface for the previously-unsurfaced
 * `dx.list_shadows` macro (server/domains/dx.js). Before this component
 * existed the macro computed real data (shadow DTUs the concord-vscode /
 * JetBrains plugin writes via `dx.upsert_shadow`) with no caller anywhere
 * in the frontend.
 *
 * lensRun is the one mock surface — no fabricated data. Every rendered row
 * is exactly what the mocked macro response says, matching the real shape
 * in server/domains/dx.js#list_shadows:
 *   dx.list_codebases -> { ok:true, codebases: [{ id, repo_root, ... }] }
 *   dx.list_shadows    -> { ok:true, shadows: [{ id, path, contentHash, upsertedAt, contentLength }], count }
 *
 * Central assertion: with zero registered codebases OR zero shadows for a
 * registered codebase, the panel renders an honest empty state — never a
 * placeholder/seeded row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ShadowsPanel } from '@/components/dx-platform/ShadowsPanel';

const CODEBASE = { id: 'cb_1', repo_root: '/repo/one' };
const CODEBASE_2 = { id: 'cb_2', repo_root: '/repo/two' };
const SHADOW_ROW = {
  id: 'shadow_dx_cb_1_abc123',
  path: 'src/auth.js',
  contentHash: 'deadbeef1234',
  upsertedAt: 1_700_000_000,
  contentLength: 842,
};

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };
type MacroOverride = (input: Record<string, unknown>) => MacroResponse;

function baseImpl(overrides: Record<string, MacroOverride> = {}) {
  return (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'dx') return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    if (overrides[action]) return Promise.resolve(overrides[action](input));
    if (action === 'list_codebases') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, codebases: [CODEBASE] }, error: null } });
    }
    if (action === 'list_shadows') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, shadows: [], count: 0 }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ShadowsPanel — honest empty states', () => {
  it('renders the "enable the concord-vscode plugin" empty state when zero codebases are registered', async () => {
    lensRunMock.mockImplementation(baseImpl({
      list_codebases: () => ({ data: { ok: true, result: { ok: true, codebases: [] }, error: null } }),
    }));

    await act(async () => { render(<ShadowsPanel />); });
    await waitFor(() => expect(screen.getByTestId('dx-shadows-empty-no-codebase')).toBeInTheDocument());
    expect(screen.getByTestId('dx-shadows-empty-no-codebase').textContent).toMatch(/No shadows yet — enable the concord-vscode plugin/);
    // No seeded/fake rows.
    expect(screen.queryByTestId('dx-shadows-list')).not.toBeInTheDocument();
  });

  it('renders the honest empty state when a codebase is registered but has zero shadow writes', async () => {
    lensRunMock.mockImplementation(baseImpl()); // default: 1 codebase, 0 shadows

    await act(async () => { render(<ShadowsPanel />); });
    await waitFor(() => expect(screen.getByTestId('dx-shadows-empty')).toBeInTheDocument());
    expect(screen.getByTestId('dx-shadows-empty').textContent).toMatch(/No shadows yet — enable the concord-vscode plugin/);
    expect(screen.queryByTestId('dx-shadows-list')).not.toBeInTheDocument();

    // The macro was called scoped to the real selected codebase id — no
    // fabricated/omitted param.
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'list_shadows');
    expect(call?.[2]).toMatchObject({ codebaseId: 'cb_1' });
  });
});

describe('ShadowsPanel — real shadow rows', () => {
  it('renders exactly what dx.list_shadows returns — path, hash, length, timestamp', async () => {
    lensRunMock.mockImplementation(baseImpl({
      list_shadows: () => ({ data: { ok: true, result: { ok: true, shadows: [SHADOW_ROW], count: 1 }, error: null } }),
    }));

    await act(async () => { render(<ShadowsPanel />); });
    await waitFor(() => expect(screen.getByTestId('dx-shadows-list')).toBeInTheDocument());

    const list = screen.getByTestId('dx-shadows-list');
    expect(list.textContent).toContain('src/auth.js');
    expect(list.textContent).toContain('deadbeef1234');
    expect(list.textContent).toContain('842');
    expect(screen.queryByTestId('dx-shadows-empty')).not.toBeInTheDocument();
  });

  it('switching the selected codebase re-queries list_shadows scoped to the new id', async () => {
    lensRunMock.mockImplementation(baseImpl({
      list_codebases: () => ({ data: { ok: true, result: { ok: true, codebases: [CODEBASE, CODEBASE_2] }, error: null } }),
      list_shadows: (input) => ({
        data: {
          ok: true,
          result: {
            ok: true,
            shadows: input.codebaseId === 'cb_2' ? [{ ...SHADOW_ROW, id: 'shadow_dx_cb_2_x', path: 'src/other.js' }] : [],
            count: input.codebaseId === 'cb_2' ? 1 : 0,
          },
          error: null,
        },
      }),
    }));

    await act(async () => { render(<ShadowsPanel />); });
    await waitFor(() => expect(screen.getByTestId('dx-shadows-empty')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Select registered codebase'), { target: { value: 'cb_2' } });

    await waitFor(() => expect(screen.getByTestId('dx-shadows-list')).toBeInTheDocument());
    expect(screen.getByTestId('dx-shadows-list').textContent).toContain('src/other.js');

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'list_shadows' && (c[2] as { codebaseId: string }).codebaseId === 'cb_2');
    expect(call).toBeTruthy();
  });
});
