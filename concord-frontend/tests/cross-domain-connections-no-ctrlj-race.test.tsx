// Verification-audit fix — duplicate-handler-race pinning test.
//
// CrossDomainConnections.tsx used to bind its own global Cmd/Ctrl+J
// keydown listener to toggle its panel. ConKayOverlay.tsx ALSO binds
// Cmd/Ctrl+J app-wide (both are mounted together on every lens page via
// app/lenses/layout.tsx), so every press toggled both the connections
// panel and ConKay simultaneously. The fix removes CrossDomainConnections'
// own listener — ConKay owns the shortcut; the panel keeps its visible FAB
// toggle button as the entry point.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) =>
    React.createElement('div', props, (props as { children?: React.ReactNode }).children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    semanticSearch: { search: vi.fn(async () => ({ data: { ok: false } })) },
    graph: { force: vi.fn(async () => ({ data: { ok: false } })) },
  },
}));

import { CrossDomainConnections } from '@/components/common/CrossDomainConnections';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(CrossDomainConnections, { domain: 'music', domainLabel: 'Music' }),
    ),
  );
}

describe('CrossDomainConnections — no more global Ctrl+J listener (ConKay owns the shortcut)', () => {
  afterEach(() => cleanup());

  it('does not bind its own keydown listener for Ctrl/Cmd+J', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderPanel();
    const keydownCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownCalls).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('pressing Ctrl+J does not open the panel (no combobox/dialog appears)', () => {
    renderPanel();
    // Panel starts closed — the FAB toggle button is visible.
    expect(screen.getByLabelText('Open cross-domain connections')).toBeInTheDocument();

    fireEvent(document.body, new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));

    // Still closed — the FAB is still there and no close button/panel content appeared.
    expect(screen.getByLabelText('Open cross-domain connections')).toBeInTheDocument();
  });

  it('the visible FAB button still opens the panel (the panel is still reachable)', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Open cross-domain connections'));
    expect(screen.queryByLabelText('Open cross-domain connections')).not.toBeInTheDocument();
  });
});
