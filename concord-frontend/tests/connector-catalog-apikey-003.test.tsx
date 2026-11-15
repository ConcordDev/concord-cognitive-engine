// FIX-integrations-003 — api_key connectors (Airtable among them)
// could never connect from the catalog: connectApp refuses by design
// because no durable key store exists, and the card still offered a
// live Connect button whose only outcome was a raw 422 'credential
// required' with no credential entry step anywhere. The card now
// states the position; oauth2 cards keep their Select affordance.
// The credential-store build itself is the named cure, not this fix.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {},
}));

// framer-motion's animated mount does not settle under this jsdom
// harness (the music-014 scaffold hit the same); passthrough is
// scaffolding only — the catalog logic under test is untouched.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: Record<string, unknown>) => {
      const { initial, animate, transition, ...rest } = props as Record<string, unknown>;
      return React.createElement('div', rest, children as React.ReactNode);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';

const CONNECTORS = [
  { id: 'airtable', name: 'Airtable', category: 'productivity', authType: 'api_key', scopes: [], triggers: [], actions: [] },
  { id: 'slack', name: 'Slack', category: 'comms', authType: 'oauth2', scopes: [], triggers: [], actions: [] },
];

describe('ConnectorCatalog api_key honesty (FIX-integrations-003)', () => {
  it('an api_key card states key entry is unavailable and offers no Connect button; oauth2 keeps Select', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'connectorCatalog') return { data: { ok: true, result: { connectors: CONNECTORS, categories: ['productivity', 'comms'] }, error: null } };
      if (action === 'connectionList') return { data: { ok: true, result: { connections: [] }, error: null } };
      return { data: { ok: true, result: {}, error: null } };
    });
    render(<ConnectorCatalog />);
    expect(await screen.findByText(/Needs API key — entry not yet available/)).toBeTruthy();
    expect(await screen.findByText('Slack')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Select/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Connect$/ })).toBeNull();
  });
});
