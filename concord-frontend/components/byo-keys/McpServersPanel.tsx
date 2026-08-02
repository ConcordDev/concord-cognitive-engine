'use client';

/**
 * McpServersPanel — MCP (Model Context Protocol) server registry, Settings surface.
 *
 * Mounted on the byo-keys lens (the existing "AI configuration" hub —
 * BrainModePanel/OrgKeysPanel/etc already live here) since MCP server
 * access is the same category of decision: what can Concord's brains
 * reach beyond Concord's own native tools.
 *
 * The registry (server/lib/mcp-bridge.js) is process-global, not per-user
 * — a connected server's tools are usable by every user's chat_agent
 * loop (via the `mcp_call`/`mcp_list` tools), so this panel is visibility
 * + manual admin control, not a personal server list. In normal use,
 * ConKay/Concord chat can already connect to any remote (http) MCP
 * server autonomously mid-conversation via its own `mcp_connect` tool
 * (server/lib/chat-agent.js) — this panel exists for: (a) seeing what's
 * connected, (b) manually adding one without going through chat, (c) the
 * admin-only local-subprocess (stdio) path, which nothing in chat can
 * ever reach by design.
 *
 * Backed by mcp.list_servers / mcp.connect / mcp.disconnect.
 * kind='http' connect works for any authenticated user; kind='stdio'
 * connect and ALL disconnects are admin/owner/founder-gated server-side
 * (server/domains/mcp.js) — this panel doesn't try to predict that
 * client-side, it just surfaces whatever the server honestly returns.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plug, Loader2, Trash2, RefreshCw } from 'lucide-react';

interface McpTool {
  name: string;
  description: string;
  hasInputSchema: boolean;
}

interface McpServer {
  serverId: string;
  kind: string;
  toolCount: number;
  tools: McpTool[];
}

export function McpServersPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverId, setServerId] = useState('');
  const [url, setUrl] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ servers: McpServer[] }>('mcp', 'list_servers', {});
    if (r.data?.ok && r.data.result) setServers(r.data.result.servers || []);
    setLoaded(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = async () => {
    const id = serverId.trim();
    const u = url.trim();
    if (!id || !u) return;
    setBusy(true);
    setError(null);
    const r = await lensRun('mcp', 'connect', { serverId: id, kind: 'http', url: u });
    setBusy(false);
    if (r.data?.ok) {
      setServerId('');
      setUrl('');
      await refresh();
    } else {
      setError(String(r.data?.error || 'connect failed'));
    }
  };

  const disconnect = async (id: string) => {
    setBusy(true);
    setError(null);
    const r = await lensRun('mcp', 'disconnect', { serverId: id });
    setBusy(false);
    if (r.data?.ok) {
      await refresh();
    } else {
      setError(String(r.data?.error || 'disconnect failed'));
    }
  };

  return (
    <section
      data-testid="mcp-servers-panel"
      className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6 mb-6"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-zinc-100">MCP servers</h2>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="text-zinc-500 hover:text-zinc-300"
          aria-label="Refresh"
          data-testid="mcp-servers-refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-zinc-400 leading-snug mb-3">
        ConKay and Concord chat can reach tools beyond Concord&apos;s own — any remote
        MCP (Model Context Protocol) server, connected here or autonomously mid-conversation.
        Local-subprocess servers are admin-only and connected outside this panel.
      </p>

      {error && (
        <div className="mb-3 text-[11px] text-red-400" data-testid="mcp-servers-error">{error}</div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          placeholder="server id (e.g. github)"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          data-testid="mcp-server-id-input"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/mcp"
          className="flex-[2] rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          data-testid="mcp-server-url-input"
        />
        <button
          type="button"
          onClick={connect}
          disabled={busy || !serverId.trim() || !url.trim()}
          className="rounded bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
          data-testid="mcp-server-connect"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
        </button>
      </div>

      {!loaded && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      )}

      {loaded && servers.length === 0 && (
        <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500" data-testid="mcp-servers-empty">
          No MCP servers connected yet.
        </div>
      )}

      <div className="space-y-1.5">
        {servers.map((s) => (
          <div key={s.serverId} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5" data-testid={`mcp-server-row-${s.serverId}`}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExpanded(expanded === s.serverId ? null : s.serverId)}
                className="flex-1 text-left"
              >
                <span className="font-mono text-xs text-zinc-100">{s.serverId}</span>
                <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">{s.kind}</span>
                <span className="ml-2 text-[10px] text-zinc-500">{s.toolCount} tool{s.toolCount === 1 ? '' : 's'}</span>
              </button>
              <button
                type="button"
                onClick={() => disconnect(s.serverId)}
                disabled={busy}
                className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                aria-label={`Disconnect ${s.serverId}`}
                data-testid={`mcp-server-disconnect-${s.serverId}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {expanded === s.serverId && s.tools.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-zinc-900 pt-1.5">
                {s.tools.map((t) => (
                  <li key={t.name} className="text-[10px] text-zinc-400">
                    <span className="font-mono text-zinc-300">{t.name}</span>
                    {t.description && <span className="ml-1.5">— {t.description}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default McpServersPanel;
