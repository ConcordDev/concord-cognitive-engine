// FIX-integrations-003 — api_key connectors (Airtable among them)
// could never connect from the catalog: connectApp refuses by design
// because no durable key store exists, and the card still offered a
// live Connect button whose only outcome was a raw 422 'credential
// required' with no credential entry step anywhere. The card now
// states the position; oauth2 cards keep their Select affordance.
// The credential store is built now (integrations.setApiKey / apiKeyStatus /
// removeApiKey, encrypted at rest): an api_key card with no stored key says
// "Needs API key" and offers key entry — still no Connect until a key is
// stored — and a card with a stored key shows it (hint only) with Connect + Revoke.
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
  function wire(keyStatus: { stored: boolean; hint: string | null }) {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'connectorCatalog') return { data: { ok: true, result: { connectors: CONNECTORS, categories: ['productivity', 'comms'] }, error: null } };
      if (action === 'connectionList') return { data: { ok: true, result: { connections: [] }, error: null } };
      if (action === 'apiKeyStatus') return { data: { ok: true, result: keyStatus, error: null } };
      return { data: { ok: true, result: {}, error: null } };
    });
  }

  it('an api_key card with no stored key says it needs one, offers key entry and no Connect; oauth2 keeps Select', async () => {
    wire({ stored: false, hint: null });
    render(<ConnectorCatalog />);
    expect(await screen.findByText(/Needs API key/)).toBeTruthy();
    expect(await screen.findByText('Slack')).toBeTruthy();
    expect(screen.getByLabelText('Airtable API key')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Save key/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Select/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Connect$/ })).toBeNull();
  });

  it('an api_key card with a stored key shows only its hint, and offers Connect + Revoke instead of key entry', async () => {
    wire({ stored: true, hint: '4f2a' });
    render(<ConnectorCatalog />);
    expect(await screen.findByText(/Key stored/)).toBeTruthy();
    expect(screen.getByText(/••••4f2a/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Connect$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke the stored Airtable API key' })).toBeTruthy();
    expect(screen.queryByLabelText('Airtable API key')).toBeNull();
  });
});
