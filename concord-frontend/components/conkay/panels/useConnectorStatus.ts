// concord-frontend/components/conkay/panels/useConnectorStatus.ts
//
// Unit A3 — one-shot fetch of the CURRENT user's honest per-connector state for
// the six marquee connectors (Gmail, Google Calendar, Slack, Sheets, GitHub,
// Notion), backed by the read-only `GET /api/oauth/connector-status` route
// (server/routes/connector-oauth.js). That route is strictly scoped to
// req.user.id, so this hook can only ever surface the caller's own state.
//
// Honest-by-construction:
//   - Every field rendered is a straight passthrough of the backend's derived
//     `status` — this hook invents no status and never upgrades a missing
//     answer to "connected".
//   - The backend distinguishes "needs-go-live" (operator OAuth client not
//     configured — a deployment-wide gate) from "not-connected" (configured,
//     but THIS user hasn't linked yet) from "connected" (a real stored grant on
//     file) from "unknown" (token store unreadable). See buildConnectorStatusList.
//   - A fetch failure yields status:'error' — the panel renders an honest
//     "unavailable" line, never a fabricated set of badges.
//   - One-shot on mount. No interval/timeout polling, no fake progress.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

export type ConnectorBadgeStatus = 'connected' | 'needs-go-live' | 'not-connected' | 'unknown';

export interface ConnectorStatusEntry {
  id: string;
  name: string;
  provider: string;
  tokenKey: string;
  operatorConfigured: boolean;
  status: ConnectorBadgeStatus;
}

interface ConnectorStatusResponse {
  ok?: boolean;
  connectors?: ConnectorStatusEntry[];
}

export interface UseConnectorStatusResult {
  status: 'loading' | 'ok' | 'error';
  entries: ConnectorStatusEntry[];
  error: string | null;
}

export function useConnectorStatus(): UseConnectorStatusResult {
  const [state, setState] = useState<UseConnectorStatusResult>({
    status: 'loading',
    entries: [],
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', entries: [], error: null });

    (async () => {
      try {
        const res = await api.get<ConnectorStatusResponse>('/api/oauth/connector-status');
        if (cancelled) return;
        const body = res.data;
        if (!body?.ok || !Array.isArray(body.connectors)) {
          throw new Error('response_not_ok');
        }
        setState({ status: 'ok', entries: body.connectors, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({
          status: 'error',
          entries: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
