'use client';

/**
 * Documentation Hub — live /api/v1/docs, every figure derived from
 * the payload actually fetched (S2 / F4 — API Hub honesty).
 *
 * The /api/v1/docs payload (server/server.js) is:
 *   { version, authentication, rateLimit, domains, totalActions,
 *     endpoints: { <domain>: [{ endpoint: "POST /api/v1/lens/<domain>/<action>",
 *                               description, brain, producesFile, fileType }] } }
 *
 * The previous panel read `endpoints.length` and `domainCount` —
 * both undefined on this shape — so its cards always fell back to
 * hardcoded figures (47 endpoints / 12 domains) over a hardcoded
 * 8-row sample list, under hardcoded claims (98% schema coverage,
 * "Released 3 days ago", "2 deprecations pending", "Synced from
 * source") and a hardcoded version timeline whose "latest"
 * contradicted the payload's own version. F4's rule: every number
 * on this view derives from the listed source, or the claim comes
 * down.
 *
 * Here the endpoint count IS the number of endpoints listed below
 * (grouped by domain; the per-domain counts sum to the headline —
 * the payload's own totalActions field is not trusted over the
 * list). The version, authentication and rate limit are the
 * payload's own strings. Claims with no source in the payload
 * (schema coverage, release recency, deprecations, a version
 * history) are not rendered as fact. An endpoint-less payload
 * renders an honest empty state.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Code2, FileJson, GitBranch, Shield, RefreshCw, AlertCircle,
} from 'lucide-react';

export interface ApiDocsEndpoint {
  method: string;
  path: string;
  description: string;
  brain?: string;
}

export interface ApiDocsGroup {
  domain: string;
  endpoints: ApiDocsEndpoint[];
}

export interface ApiDocsSummary {
  version: string | null;
  authentication: string | null;
  rateLimit: string | null;
  groups: ApiDocsGroup[];
  totalEndpoints: number;
  domainCount: number;
}

interface RawEndpoint {
  endpoint?: string;
  method?: string;
  path?: string;
  description?: string;
  desc?: string;
  brain?: string;
}

function parseEndpoint(raw: RawEndpoint): ApiDocsEndpoint {
  if (typeof raw.endpoint === 'string' && raw.endpoint) {
    const sp = raw.endpoint.indexOf(' ');
    return {
      method: sp > 0 ? raw.endpoint.slice(0, sp) : 'POST',
      path: sp > 0 ? raw.endpoint.slice(sp + 1) : raw.endpoint,
      description: raw.description ?? '',
      brain: raw.brain,
    };
  }
  return {
    method: raw.method ?? 'GET',
    path: raw.path ?? '',
    description: raw.description ?? raw.desc ?? '',
    brain: raw.brain,
  };
}

function domainOf(path: string): string {
  const m = path.match(/\/lens\/([^/]+)\//);
  return m ? m[1] : 'api';
}

/**
 * Reduce a /api/v1/docs payload to what the view may claim. The
 * headline count is computed from the listed endpoints themselves,
 * never from a summary field, so the count and the list cannot
 * disagree.
 */
export function summarizeApiDocs(payload: unknown): ApiDocsSummary {
  const p = (payload ?? {}) as Record<string, unknown>;
  const raw = p.endpoints;
  const byDomain = new Map<string, ApiDocsEndpoint[]>();
  const add = (domain: string, ep: ApiDocsEndpoint) => {
    const list = byDomain.get(domain) ?? [];
    list.push(ep);
    byDomain.set(domain, list);
  };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [domain, actions] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(actions)) continue;
      for (const a of actions) add(domain, parseEndpoint(a as RawEndpoint));
    }
  } else if (Array.isArray(raw)) {
    for (const a of raw) {
      const ep = parseEndpoint(a as RawEndpoint);
      add(domainOf(ep.path), ep);
    }
  }
  const groups = [...byDomain.entries()]
    .map(([domain, endpoints]) => ({ domain, endpoints }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return {
    version: typeof p.version === 'string' ? p.version : null,
    authentication: typeof p.authentication === 'string' ? p.authentication : null,
    rateLimit: typeof p.rateLimit === 'string' ? p.rateLimit : null,
    groups,
    totalEndpoints: groups.reduce((n, g) => n + g.endpoints.length, 0),
    domainCount: groups.length,
  };
}

export function ApiHubPanel() {
  const {
    data: liveApiDocs,
    isLoading: docsLoading,
    isError: docsError,
  } = useQuery({
    queryKey: ['api-docs'],
    queryFn: () => api.get('/api/v1/docs').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const [filter, setFilter] = useState('');

  const summary = useMemo(() => summarizeApiDocs(liveApiDocs), [liveApiDocs]);
  const visibleGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return summary.groups;
    return summary.groups
      .map((g) => ({
        domain: g.domain,
        endpoints: g.domain.toLowerCase().includes(q)
          ? g.endpoints
          : g.endpoints.filter(
              (e) =>
                e.path.toLowerCase().includes(q) ||
                e.description.toLowerCase().includes(q),
            ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [summary, filter]);

  if (docsLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-lattice-surface rounded-lg w-1/4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-lattice-surface rounded-xl" />
          ))}
        </div>
        <div className="h-48 bg-lattice-surface rounded-xl" />
      </div>
    );
  }

  if (docsError) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-semibold text-white">Failed to load documentation</h2>
          <p className="text-sm text-gray-400">
            Could not fetch API docs. Please refresh the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-neon-cyan hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel p-6 space-y-5">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Code2 className="w-5 h-5 text-neon-cyan" />
        Documentation Hub
      </h2>
      <p className="text-sm text-gray-400">
        API documentation generated from the live <span className="font-mono">/api/v1/docs</span>{' '}
        source. Every figure on this page is computed from the endpoints listed below.
      </p>

      {/* API Endpoint Summary Cards — all values from the payload */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-neon-cyan" />
            <span className="text-sm font-semibold text-white">REST Endpoints</span>
          </div>
          <p className="text-2xl font-bold text-neon-cyan">{summary.totalEndpoints}</p>
          <p className="text-xs text-gray-400">
            Across {summary.domainCount} domains — every one listed below
          </p>
        </div>
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-purple" />
            <span className="text-sm font-semibold text-white">API Version</span>
          </div>
          <p className="text-2xl font-bold text-neon-purple">
            {summary.version ?? 'Not published'}
          </p>
          <p className="text-xs text-gray-400">As reported by the docs source</p>
        </div>
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-green" />
            <span className="text-sm font-semibold text-white">Access</span>
          </div>
          <p className="text-xs text-gray-300">{summary.authentication ?? 'Not published'}</p>
          <p className="text-xs text-gray-400">{summary.rateLimit ?? ''}</p>
        </div>
      </div>

      {/* API Reference — the listed source the cards count */}
      <div className="bg-black/40 border border-white/10 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Code2 className="w-4 h-4 text-neon-cyan" />
            Auto-Generated API Reference
          </h3>
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-400">Live from /api/v1/docs</span>
          </div>
        </div>
        <div className="px-4 py-2 border-b border-white/10">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by domain, path, or description…"
            aria-label="Filter endpoints"
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
          />
        </div>
        {summary.totalEndpoints === 0 ? (
          <p className="px-4 py-6 text-xs text-gray-400 italic">
            The docs source returned no endpoints.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="px-4 py-6 text-xs text-gray-400 italic">
            No endpoints match &ldquo;{filter}&rdquo;.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {visibleGroups.map((g) => (
              <details key={g.domain} open={filter.trim() ? true : undefined}>
                <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-white/5">
                  <span className="text-sm font-semibold text-white">{g.domain}</span>
                  <span className="text-xs text-gray-400">
                    {g.endpoints.length} endpoint{g.endpoints.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div className="divide-y divide-white/5">
                  {g.endpoints.map((endpoint, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
                    >
                      <span
                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                          endpoint.method === 'GET'
                            ? 'bg-neon-green/20 text-neon-green'
                            : 'bg-neon-cyan/20 text-neon-cyan'
                        }`}
                      >
                        {endpoint.method}
                      </span>
                      <span className="text-sm font-mono text-gray-300 flex-1">{endpoint.path}</span>
                      <span className="text-xs text-gray-400 hidden md:block">
                        {endpoint.description}
                      </span>
                      {endpoint.brain && (
                        <span className="text-xs text-gray-400 hidden lg:block">
                          {endpoint.brain}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {/* Version History — the source publishes a current version only */}
      <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-purple" />
          Version History
        </h3>
        <p className="text-xs text-gray-400">
          The docs source publishes the current version only
          {summary.version ? ` (${summary.version})` : ''}; no release history is
          available from /api/v1/docs, so none is shown.
        </p>
      </div>
    </div>
  );
}
