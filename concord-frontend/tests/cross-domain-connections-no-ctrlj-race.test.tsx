// Verification-audit fix — duplicate-handler-race pinning test.
//
// CrossDomainConnections.tsx used to bind its own global Cmd/Ctrl+J
// keydown listener to toggle its panel. ConKayOverlay.tsx ALSO binds
// Cmd/Ctrl+J app-wide (both are mounted together on every lens page via
// app/lenses/layout.tsx), so every press toggled both the connections
// panel and ConKay simultaneously. The fix removes CrossDomainConnections'
// own listener — ConKay owns the shortcut. The panel's entry point is now
// the lens header toolbar's Connections button (lib/lens-dock), not a FAB.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
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
import { openLensTool } from '@/lib/lens-dock';
import { act } from '@testing-library/react';

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

  it('pressing Ctrl+J does not open the panel', () => {
    renderPanel();
    expect(screen.queryByLabelText('Close panel')).not.toBeInTheDocument();
    fireEvent(document.body, new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
    expect(screen.queryByLabelText('Close panel')).not.toBeInTheDocument();
  });

  it('renders no floating trigger and opens from the lens toolbar dock', () => {
    renderPanel();
    expect(screen.queryByLabelText('Open cross-domain connections')).not.toBeInTheDocument();
    let handled = false;
    act(() => { handled = openLensTool('connections'); });
    expect(handled).toBe(true);
    expect(screen.getByLabelText('Close panel')).toBeInTheDocument();
  });
});
