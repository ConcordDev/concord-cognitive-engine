// FIX-materials-006 (FE half) — when the operator key is unset, the
// MP search panel renders the server's missing_api_key message as a
// calm configuration note, not a red failure, and never shows the raw
// reason string.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async () => ({
        data: {
          ok: false, reason: 'missing_api_key', error: 'missing_api_key',
          envVar: 'MATERIALS_PROJECT_API_KEY', signupUrl: 'https://materialsproject.org',
          message: 'Set MATERIALS_PROJECT_API_KEY in .env to enable this panel. Free signup: https://materialsproject.org',
        },
      })),
    },
  },
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(),
}));

// framer-motion passthrough (jsdom harness scaffolding only).
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: Record<string, unknown>) => {
      const { initial, animate, transition, layout, ...rest } = props as Record<string, unknown>;
      return React.createElement('div', rest, children as React.ReactNode);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { MpSearch } from '@/components/materials/MpSearch';

describe('MpSearch missing-key note (FIX-materials-006)', () => {
  it('renders the setup message as a note', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MpSearch />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Chemical formula/), { target: { value: 'Al2O3' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText(/Set MATERIALS_PROJECT_API_KEY in \.env to enable this panel/)).toBeTruthy();
  });
});
