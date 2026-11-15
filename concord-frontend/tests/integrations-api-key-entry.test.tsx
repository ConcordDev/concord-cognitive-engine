// FIX-integrations-003 (FE) — the catalog's api_key card carries the
// credential entry step the ticket found missing: a password input +
// Save key (setApiKey), a stored state showing only the last-4 hint,
// Connect once a key is stored, and Revoke. The typed key is passed to
// setApiKey and nowhere else; it is never rendered back.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
let keyStored = false;

vi.mock('@/lib/api/client', () => ({
  lensRun: async (_domain: string, action: string, params: Record<string, unknown> = {}) => {
    calls.push({ action, params });
    if (action === 'connectorCatalog') {
      return { data: { ok: true, result: { connectors: [
        { id: 'airtable', name: 'Airtable', category: 'productivity', authType: 'api_key', scopes: ['data.records:read'], triggers: [], actions: [] },
        { id: 'slack', name: 'Slack', category: 'communication', authType: 'oauth2', scopes: [], triggers: [], actions: [] },
      ], categories: ['productivity', 'communication'] } } };
    }
    if (action === 'connectionList') return { data: { ok: true, result: { connections: [], count: 0 } } };
    if (action === 'apiKeyStatus') return { data: { ok: true, result: { connectorId: 'airtable', stored: keyStored, hint: keyStored ? '1111' : null, updatedAt: null } } };
    if (action === 'setApiKey') { keyStored = true; return { data: { ok: true, result: { connectorId: 'airtable', stored: true, hint: '1111' } } }; }
    if (action === 'removeApiKey') { keyStored = false; return { data: { ok: true, result: { connectorId: 'airtable', removed: true } } }; }
    return { data: { ok: true, result: {} } };
  },
}));

import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';

beforeEach(() => { calls.length = 0; keyStored = false; });
afterEach(() => cleanup());

describe('ConnectorCatalog API-key entry step', () => {
  it('offers key entry, stores via setApiKey, then offers Connect + Revoke with only the hint shown', async () => {
    render(<ConnectorCatalog />);
    const input = await screen.findByLabelText('Airtable API key');
    expect(input.getAttribute('type')).toBe('password');

    fireEvent.change(input, { target: { value: 'pat_secret_1111' } });
    fireEvent.click(screen.getByText('Save key'));

    await waitFor(() => {
      const set = calls.find((c) => c.action === 'setApiKey');
      expect(set?.params.apiKey).toBe('pat_secret_1111');
    });
    // stored state: hint only, Connect + Revoke offered, key never rendered
    await screen.findByText(/Key stored/);
    expect(screen.getByText(/••••1111/)).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
    expect(screen.getByText('Revoke key')).toBeTruthy();
    expect(document.body.textContent).not.toContain('pat_secret_1111');

    fireEvent.click(screen.getByText('Revoke key'));
    await waitFor(() => expect(calls.some((c) => c.action === 'removeApiKey')).toBe(true));
  });

  it('oauth2 cards get no key entry', async () => {
    render(<ConnectorCatalog />);
    await screen.findByLabelText('Airtable API key');
    expect(screen.queryByLabelText('Slack API key')).toBeNull();
  });
});
