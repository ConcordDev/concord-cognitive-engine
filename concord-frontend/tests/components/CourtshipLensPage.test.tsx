import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell pulls in next/dynamic + the UI store + a11y hooks; stub it to a
// passthrough so this test isolates the courtship page's own four states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

// The real hook calls useKeyboard(), which requires a KeyboardProvider
// parent. Production mounts that via the lens shell; this isolated page
// test doesn't, so stub the keyboard binding to a no-op.
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

// A controllable fetch mock. Each test installs its own router.
function installFetch(router: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const out = router(url, init);
    // Routers return either a Response-like object or a never-resolving promise.
    if (out instanceof Promise) return out;
    return Promise.resolve(out);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(ok: boolean, body: unknown) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

// constants call always resolves cheaply so the threshold settles.
const constantsBody = { ok: true, constants: { ENGAGE_THRESHOLD: 0.7, MARRY_THRESHOLD: 0.85 } };

async function renderPage() {
  const { default: CourtshipLensPage } = await import('@/app/lenses/courtship/page');
  render(React.createElement(CourtshipLensPage));
}

describe('CourtshipLensPage — four UX states', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('LOADING: shows a loading status while the fetch is in flight', async () => {
    installFetch((url) => {
      if (url.includes('/api/lens/run')) return jsonResponse(true, constantsBody);
      // never resolve the data fetches → stays in loading
      return new Promise(() => {});
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/loading your courtships/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ERROR: shows an honest error with a Retry button when the server 500s', async () => {
    installFetch((url) => {
      if (url.includes('/api/lens/run')) return jsonResponse(true, constantsBody);
      return jsonResponse(false, { ok: false });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load courtships/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('EMPTY: shows a genuine empty state when there are no courtships', async () => {
    installFetch((url) => {
      if (url.includes('/api/lens/run')) return jsonResponse(true, constantsBody);
      if (url.includes('/api/courtship/mine')) return jsonResponse(true, { ok: true, courtships: [] });
      if (url.includes('/api/courtship/marriages/mine')) return jsonResponse(true, { ok: true, marriages: [], children: [] });
      return jsonResponse(true, { ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no active courtships yet/i)).toBeInTheDocument();
    });
    // Marriages/family content lives under separate tabs (the page is a
    // single-view-union shell: courtships | marriages | family | past).
    fireEvent.click(screen.getByRole('button', { name: /marriages/i }));
    await waitFor(() => expect(screen.getByText(/no active marriages/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^family/i }));
    await waitFor(() => expect(screen.getByText(/no pregnancies or children yet/i)).toBeInTheDocument());
    // It is NOT in loading or error state.
    expect(screen.queryByText(/loading your courtships/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load courtships/i)).not.toBeInTheDocument();
  });

  it('POPULATED: renders real courtships with affinity, plus marriages + children', async () => {
    installFetch((url) => {
      if (url.includes('/api/lens/run')) return jsonResponse(true, constantsBody);
      if (url.includes('/api/courtship/mine')) {
        return jsonResponse(true, {
          ok: true,
          courtships: [
            { partner_kind: 'npc', partner_id: 'npc_lyra_abcdef', affinity: 0.42, status: 'courting' },
            { partner_kind: 'npc', partner_id: 'npc_orin_123456', affinity: 0.9, status: 'engaged' },
          ],
        });
      }
      if (url.includes('/api/courtship/marriages/mine')) {
        return jsonResponse(true, {
          ok: true,
          marriages: [{ id: 'm1', partner_kind: 'npc', partner_id: 'npc_kel_999', married_at: 1700000000 }],
          children: [{ id: 'child_aaa', parent_user_id: 'u1', name: 'Asbir', maturity: 'child', born_at: 1700001000 }],
        });
      }
      return jsonResponse(true, { ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/active courtships \(2\)/i)).toBeInTheDocument();
    });
    // Real affinity percentage rendered from the data.
    expect(screen.getByLabelText(/affinity 42 percent/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/affinity 90 percent/i)).toBeInTheDocument();
    // Engaged + above marry threshold → a Wed button is offered.
    expect(screen.getByRole('button', { name: /wed/i })).toBeInTheDocument();
    // Marriage surfaced under the "Marriages" tab (marriages/mine resolves
    // on its own async fetch inside useCourtshipDesk — wait for it).
    fireEvent.click(screen.getByRole('button', { name: /marriages/i }));
    await waitFor(() => expect(screen.getByText(/marriages \(1\)/i)).toBeInTheDocument());
    // Child surfaced under the "Family" tab.
    fireEvent.click(screen.getByRole('button', { name: /^family/i }));
    await waitFor(() => expect(screen.getByText('Asbir')).toBeInTheDocument());
  });
});
