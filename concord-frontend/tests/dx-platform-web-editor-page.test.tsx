/**
 * /lenses/dx-platform/web-editor — Monaco-hosted "Run detectors" demo.
 *
 * Regression pin: POST /api/lens/run always responds { ok: true, result:
 * PAYLOAD } where the outer `ok` is a transport flag only. Before the fix,
 * this page's local `runMacro()` helper returned that raw envelope and read
 * `reg.codebaseId` / `r.report` straight off it — always undefined — so the
 * Run button always failed with "register_codebase failed" even against a
 * healthy backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => children,
}));

import WebEditorPage from '@/app/lenses/dx-platform/web-editor/page';

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

function bodyOf(init?: RequestInit) {
  return init?.body ? JSON.parse(String(init.body)) : {};
}

// `loadMonaco()` short-circuits to `window.monaco` when already present,
// so stubbing it out entirely sidesteps the CDN <script> loader path (not
// under test here) and drives straight to the "ready" state.
function stubMonaco() {
  (window as unknown as { monaco: unknown }).monaco = {
    editor: {
      create: () => ({
        getValue: () => '',
        onDidChangeModelContent: () => ({ dispose: () => {} }),
        getModel: () => null,
        dispose: () => {},
      }),
      setModelMarkers: () => {},
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubMonaco();
});

afterEach(() => {
  delete (window as unknown as { monaco?: unknown }).monaco;
});

describe('/lenses/dx-platform/web-editor — nested envelope unwrap', () => {
  it('Run detectors: unwraps codebaseId then report.reports[].findings from nested envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'register_codebase') {
        return jsonOf({ ok: true, result: { ok: true, codebaseId: 'cb_web_1' } });
      }
      if (b.name === 'runAll') {
        return jsonOf({
          ok: true,
          result: {
            ok: true,
            report: { reports: [{ findings: [{ id: 'sql-star', message: 'SELECT * on creatures', severity: 'medium' }] }] },
          },
        });
      }
      return jsonOf({ ok: true, result: { ok: true } });
    }));

    const { getByText } = render(<WebEditorPage />);
    await waitFor(() => expect(getByText('Run detectors')).not.toBeDisabled());
    await act(async () => { fireEvent.click(getByText('Run detectors')); });

    await waitFor(() => expect(getByText('SELECT * on creatures')).toBeInTheDocument());
    expect(getByText('[MEDIUM]')).toBeInTheDocument();
  });

  it('a nested register_codebase failure surfaces the real error, not a silent no-op', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const b = bodyOf(init);
      if (b.name === 'register_codebase') return jsonOf({ ok: true, result: { ok: false, reason: 'no_actor' } });
      return jsonOf({ ok: true, result: { ok: true } });
    }));
    const { getByText } = render(<WebEditorPage />);
    await waitFor(() => expect(getByText('Run detectors')).not.toBeDisabled());
    await act(async () => { fireEvent.click(getByText('Run detectors')); });
    await waitFor(() => expect(getByText(/register_codebase failed/)).toBeInTheDocument());
  });
});
