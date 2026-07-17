'use client';

// concord-frontend/components/conkay/panels/ConnectorStatusPanel.tsx
//
// Track A / A3 — ConKay cockpit panel showing per-connector "Connected" /
// "Needs auth" status for the CURRENT user only. Clones the honest badge
// pattern already shipped in components/integrations/ConnectorCatalog.tsx
// (green Connected / amber Needs-auth ShieldAlert, ~96 & 176-187) rather than
// inventing a new honesty convention.
//
// Data source — two real `integrations` macros via `lensRun` (POST
// /api/lens/run), the same calls ConnectorCatalog makes:
//   - `integrations.connectorCatalog` — the static list of available SaaS
//     connectors (id/name/category/authType). Public catalog data, not
//     scoped to any user.
//   - `integrations.connectionList` — the CALLER's own connection records
//     only. `server/domains/integrations.js#connectionList` (~502-508) reads
//     `s.connections.get(intActor(ctx))`, and `intActor` (~396) resolves the
//     userId from the authenticated request context
//     (`ctx.actor.userId || ctx.userId || "anon"`). There is no
//     connector/user override parameter this panel passes (or could pass) to
//     widen that query, so it is structurally impossible for this component
//     to request or render another user's connector state. Do not add a
//     userId/connectorId override param here — that would BE the honesty
//     violation this panel exists to avoid.
//
// Per-connector status is derived, not fabricated:
//   - `credentialStored` (from connectionList, `server/domains/integrations.js`
//     ~472-478) is true ONLY when a real row exists in
//     `connector_oauth_tokens` (migration 331) for THIS user + connector —
//     "Connected" (green) means a real OAuth token is on file, never a guess
//     or an assumption.
//   - A connection record exists but `credentialStored` is false -> "Needs
//     auth" (amber ShieldAlert), matching ConnectorCatalog's badge verbatim.
//     Per docs/CONNECTORS_GO_LIVE.md this is the per-user "complete the OAuth
//     flow" state, distinct from an operator-side "provider secrets not
//     configured" gap (that failure surfaces at connect-time as an honest
//     macro error, not as a per-connector badge here).
//   - No connection record for this connector at all -> "Not connected"
//     (neutral) — the user never selected it. Kept visually distinct from
//     "Needs auth": an explicit non-status, not an alarm.
//
// No interval/timeout-driven polling anywhere in this file — one-shot fetch
// on mount, matching MacroLibraryPanel/ForwardSimPanel's discipline. Status
// only changes when the panel is re-mounted and asks the backend again.

import { useEffect, useState, useCallback } from 'react';
import { Check, ShieldAlert, CircleDashed } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface CatalogConnector {
  id: string;
  name: string;
  category: string;
  authType: string;
}

interface Connection {
  id: string;
  connectorId: string;
  connectorName: string;
  credentialStored?: boolean;
  needsOauth?: boolean;
}

export type ConnectorStatus = 'connected' | 'needs-auth' | 'not-connected';

export interface ConnectorStatusRow {
  connectorId: string;
  name: string;
  authType: string;
  status: ConnectorStatus;
}

/** Pure merge: real catalog + real (already user-scoped) connections in,
 *  per-connector status rows out. Never invents a connector or a connection —
 *  a row's status is a straight derivation from the two real API payloads.
 *  Exported for direct unit pinning alongside the render test. */
export function buildConnectorStatusRows(
  catalog: CatalogConnector[],
  connections: Connection[],
): ConnectorStatusRow[] {
  return catalog.map((c) => {
    const conn = connections.find((x) => x.connectorId === c.id);
    let status: ConnectorStatus = 'not-connected';
    if (conn) status = conn.credentialStored ? 'connected' : 'needs-auth';
    return { connectorId: c.id, name: c.name, authType: c.authType, status };
  });
}

const STATUS_META: Record<ConnectorStatus, { label: string; className: string; title: string }> = {
  connected: {
    label: 'Connected',
    className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
    title: 'Real OAuth credential stored for this connector — egress is live',
  },
  'needs-auth': {
    label: 'Needs auth',
    className: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
    title:
      'Selected but not yet authorized — no OAuth token stored, so the real egress path refuses this connector until you complete the OAuth flow',
  },
  'not-connected': {
    label: 'Not connected',
    className: 'text-zinc-400 border-zinc-500/30 bg-zinc-700/10',
    title: "You haven't selected this connector yet",
  },
};

function StatusBadge({ status }: { status: ConnectorStatus }) {
  const meta = STATUS_META[status];
  const Icon = status === 'connected' ? Check : status === 'needs-auth' ? ShieldAlert : CircleDashed;
  return (
    <span
      data-testid={`ck-connector-badge-${status}`}
      title={meta.title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

export function ConnectorStatusPanel() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [rows, setRows] = useState<ConnectorStatusRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const [catalogRes, connRes] = await Promise.all([
        lensRun<{ connectors: CatalogConnector[] }>('integrations', 'connectorCatalog', {}),
        lensRun<{ connections: Connection[] }>('integrations', 'connectionList', {}),
      ]);
      if (!catalogRes.data.ok || !catalogRes.data.result) {
        throw new Error(catalogRes.data.error || 'connectorCatalog_failed');
      }
      // connectionList failing (e.g. STATE unavailable on a minimal build) is
      // not fatal to the whole panel — fall back to "no connections yet"
      // rather than hiding the (still real) catalog data.
      const connections =
        connRes.data.ok && connRes.data.result ? connRes.data.result.connections || [] : [];
      setRows(buildConnectorStatusRows(catalogRes.data.result.connectors || [], connections));
      setStatus('ok');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      data-testid="ck-connector-status-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">connector status</div>

      {status === 'loading' && (
        <div data-testid="ck-connector-status-loading" className="px-1 py-2 text-[11px] text-cyan-300/60">
          Loading your connector status…
        </div>
      )}

      {status === 'error' && (
        <div data-testid="ck-connector-status-error" className="px-1 py-2 text-[11px] text-rose-300/80">
          Couldn&apos;t load connector status{errorMessage ? ` (${errorMessage})` : ''}.
        </div>
      )}

      {status === 'ok' && rows.length === 0 && (
        <div data-testid="ck-connector-status-empty" className="px-1 py-2 text-[11px] text-white/40">
          No connectors available.
        </div>
      )}

      {status === 'ok' && rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.connectorId}
              data-testid={`ck-connector-row-${r.connectorId}`}
              data-status={r.status}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[12px]"
            >
              <span className="min-w-0 truncate text-cyan-100/80">{r.name}</span>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ConnectorStatusPanel;
