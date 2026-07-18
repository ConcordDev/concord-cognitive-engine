/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/ConnectorStatusPanel.test.tsx
//
// Track A / A3 — pins the ConKay connector-status panel's honest guarantees:
//   (a) a connected connector (real `credentialStored: true` from the mocked
//       `integrations.connectionList`) renders the green "Connected" badge;
//   (b) a selected-but-unauthorized connector (`credentialStored: false`)
//       renders the amber "Needs auth" badge;
//   (c) a catalog connector with no connection record at all renders "Not
//       connected" — never fabricated as Connected;
//   (d) an empty catalog renders an honest empty state, never a placeholder
//       row;
//   (e) a belt-and-suspenders source scan: no setInterval/setTimeout;
//   (f) the panel calls `integrations.connectionList` with no user/connector
//       override params — it cannot request another user's connector state.
// Plus a focused unit pin of the pure `buildConnectorStatusRows` producer.
//
// `lensRun` is the one mock surface — no fabricated data. Every rendered
// badge is exactly what the mocked macro responses say, matching the real
// shapes in server/domains/integrations.js (`connectorCatalog`,
// `connectionList`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ConnectorStatusPanel, buildConnectorStatusRows } from './ConnectorStatusPanel';

const CATALOG = [
  { id: 'slack', name: 'Slack', category: 'communication', authType: 'oauth2' },
  { id: 'gmail', name: 'Gmail', category: 'email', authType: 'oauth2' },
  { id: 'stripe', name: 'Stripe', category: 'payments', authType: 'api_key' },
];

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };

function mockImpl(connections: unknown[]) {
  return (domain: string, action: string): Promise<MacroResponse> => {
    if (domain !== 'integrations') {
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    }
    if (action === 'connectorCatalog') {
      return Promise.resolve({ data: { ok: true, result: { connectors: CATALOG }, error: null } });
    }
    if (action === 'connectionList') {
      return Promise.resolve({ data: { ok: true, result: { connections }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ConnectorStatusPanel', () => {
  it('(a) renders the green Connected badge for a connector with a real stored credential', async () => {
    lensRunMock.mockImplementation(
      mockImpl([
        { id: 'conn_1', connectorId: 'slack', connectorName: 'Slack', credentialStored: true },
      ]),
    );

    render(<ConnectorStatusPanel />);

    const row = await screen.findByTestId('ck-connector-row-slack');
    expect(row.getAttribute('data-status')).toBe('connected');
    expect(row.querySelector('[data-testid="ck-connector-badge-connected"]')).not.toBeNull();
    expect(row).toHaveTextContent('Connected');
  });

  it('(b) renders the amber Needs-auth badge for a selected-but-unauthorized connector', async () => {
    lensRunMock.mockImplementation(
      mockImpl([
        { id: 'conn_1', connectorId: 'gmail', connectorName: 'Gmail', credentialStored: false, needsOauth: true },
      ]),
    );

    render(<ConnectorStatusPanel />);

    const row = await screen.findByTestId('ck-connector-row-gmail');
    expect(row.getAttribute('data-status')).toBe('needs-auth');
    expect(row.querySelector('[data-testid="ck-connector-badge-needs-auth"]')).not.toBeNull();
    expect(row).toHaveTextContent('Needs auth');
  });

  it('(c) renders "Not connected" for a catalog connector with no connection record — never fabricated as Connected', async () => {
    lensRunMock.mockImplementation(mockImpl([]));

    render(<ConnectorStatusPanel />);

    const row = await screen.findByTestId('ck-connector-row-stripe');
    expect(row.getAttribute('data-status')).toBe('not-connected');
    expect(row.querySelector('[data-testid="ck-connector-badge-not-connected"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="ck-connector-badge-connected"]')).toBeNull();
  });

  it('(d) renders an honest empty state when the catalog is empty — no placeholder row', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'integrations' && action === 'connectorCatalog') {
        return Promise.resolve({ data: { ok: true, result: { connectors: [] }, error: null } });
      }
      if (domain === 'integrations' && action === 'connectionList') {
        return Promise.resolve({ data: { ok: true, result: { connections: [] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });

    render(<ConnectorStatusPanel />);

    expect(await screen.findByTestId('ck-connector-status-empty')).toBeInTheDocument();
    expect(screen.queryByTestId(/ck-connector-row-/)).toBeNull();
  });

  it('(e) contains NO setInterval / setTimeout — status only changes from a real fetch', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'ConnectorStatusPanel.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/setTimeout/);
  });

  it('(f) calls integrations.connectionList with no user/connector override params — structurally cannot widen the query', async () => {
    lensRunMock.mockImplementation(mockImpl([]));

    render(<ConnectorStatusPanel />);

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('integrations', 'connectionList', {});
    });
    // No call anywhere passed a userId / actorId override — the backend
    // (`intActor`) is the sole source of whose connections come back, so this
    // component structurally cannot ask for another user's state.
    for (const call of lensRunMock.mock.calls) {
      const input = call[2] as Record<string, unknown> | undefined;
      expect(input).not.toHaveProperty('userId');
      expect(input).not.toHaveProperty('actorId');
    }
  });

  it('buildConnectorStatusRows: pure producer — merges real catalog + real connections, never invents a row', () => {
    const rows = buildConnectorStatusRows(CATALOG, [
      { id: 'c1', connectorId: 'slack', connectorName: 'Slack', credentialStored: true },
      { id: 'c2', connectorId: 'gmail', connectorName: 'Gmail', credentialStored: false },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.connectorId === 'slack')).toMatchObject({ status: 'connected' });
    expect(rows.find((r) => r.connectorId === 'gmail')).toMatchObject({ status: 'needs-auth' });
    expect(rows.find((r) => r.connectorId === 'stripe')).toMatchObject({ status: 'not-connected' });

    // Empty catalog -> no rows (honest empty state upstream).
    expect(buildConnectorStatusRows([], [])).toHaveLength(0);
  });
});
