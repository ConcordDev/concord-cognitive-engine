/// <reference types="@testing-library/jest-dom/vitest" />
// McpServersPanel — MCP server registry Settings surface. Pins:
//   1. Loads mcp.list_servers on mount and renders the empty state when
//      nothing is connected.
//   2. Renders connected servers with kind + tool count, and expands to
//      show individual tools.
//   3. Connect button calls mcp.connect with kind:'http' always (never lets
//      the form itself request stdio) and refreshes the list on success.
//   4. Connect surfaces a real server-side error (e.g. the SSRF guard or the
//      admin gate) without silently pretending success.
//   5. Disconnect calls mcp.disconnect and refreshes; a denial (non-admin)
//      surfaces the real error instead of removing the row.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { McpServersPanel } from './McpServersPanel';

describe('McpServersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads mcp.list_servers on mount and shows the empty state', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { servers: [] }, error: null } });
    render(<McpServersPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('mcp', 'list_servers', {}));
    expect(await screen.findByTestId('mcp-servers-empty')).toBeInTheDocument();
  });

  it('renders a connected server with its kind, tool count, and expandable tool list', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          servers: [{
            serverId: 'github', kind: 'http', toolCount: 2,
            tools: [
              { name: 'read_file', description: 'Read a file', hasInputSchema: true },
              { name: 'list_prs', description: 'List pull requests', hasInputSchema: true },
            ],
          }],
        },
        error: null,
      },
    });
    render(<McpServersPanel />);
    const row = await screen.findByTestId('mcp-server-row-github');
    expect(row).toHaveTextContent('github');
    expect(row).toHaveTextContent('http');
    expect(row).toHaveTextContent('2 tools');
    expect(screen.queryByText('read_file')).toBeNull();

    fireEvent.click(screen.getByText('github'));
    expect(await screen.findByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('list_prs')).toBeInTheDocument();
  });

  it('connect always sends kind:"http" and never anything user-typed as kind', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { servers: [] }, error: null } }); // initial load
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { serverId: 'ctx7', tools: [] }, error: null } }); // connect
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { servers: [{ serverId: 'ctx7', kind: 'http', toolCount: 0, tools: [] }] }, error: null } }); // refresh

    render(<McpServersPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('mcp-server-id-input'), { target: { value: 'ctx7' } });
    fireEvent.change(screen.getByTestId('mcp-server-url-input'), { target: { value: 'https://example.com/mcp' } });
    fireEvent.click(screen.getByTestId('mcp-server-connect'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('mcp', 'connect', { serverId: 'ctx7', kind: 'http', url: 'https://example.com/mcp' }));
    await waitFor(() => expect(screen.getByTestId('mcp-server-id-input')).toHaveValue(''));
  });

  it('surfaces a real connect failure (e.g. SSRF-blocked URL) instead of pretending success', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { servers: [] }, error: null } });
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'http_url_blocked' } });

    render(<McpServersPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('mcp-server-id-input'), { target: { value: 'evil' } });
    fireEvent.change(screen.getByTestId('mcp-server-url-input'), { target: { value: 'http://169.254.169.254/' } });
    fireEvent.click(screen.getByTestId('mcp-server-connect'));

    expect(await screen.findByTestId('mcp-servers-error')).toHaveTextContent('http_url_blocked');
    // Input is NOT cleared on failure (no fabricated success).
    expect(screen.getByTestId('mcp-server-id-input')).toHaveValue('evil');
  });

  it('disconnect calls mcp.disconnect and refreshes the list on success', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { servers: [{ serverId: 'github', kind: 'http', toolCount: 1, tools: [{ name: 'x', description: '', hasInputSchema: false }] }] }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { ok: true }, error: null } }); // disconnect
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { servers: [] }, error: null } }); // refresh

    render(<McpServersPanel />);
    await screen.findByTestId('mcp-server-row-github');

    fireEvent.click(screen.getByTestId('mcp-server-disconnect-github'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('mcp', 'disconnect', { serverId: 'github' }));
    await waitFor(() => expect(screen.getByTestId('mcp-servers-empty')).toBeInTheDocument());
  });

  it('a denied disconnect (non-admin) surfaces the real error and leaves the row in place', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { servers: [{ serverId: 'github', kind: 'http', toolCount: 0, tools: [] }] }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'Insufficient permissions: admin role required' } });

    render(<McpServersPanel />);
    await screen.findByTestId('mcp-server-row-github');

    fireEvent.click(screen.getByTestId('mcp-server-disconnect-github'));

    expect(await screen.findByTestId('mcp-servers-error')).toHaveTextContent('admin role required');
    expect(screen.getByTestId('mcp-server-row-github')).toBeInTheDocument();
  });
});
