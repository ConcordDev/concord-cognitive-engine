'use client';

/**
 * useConsolePing — fire-and-forget device-class ping for the public
 * console-demand counter.
 *
 * Mounted once near the lens shell (e.g. inside the world lens or
 * AppShell). Fires one POST per session on mount + a second-stage
 * follow-up if a gamepad connects within the first 30s, so the
 * server-side counter can confirm console class via the gamepad id
 * even when User-Agent is ambiguous.
 *
 * Privacy: no PII shipped. The endpoint records only the User-Agent
 * (already sent on every request) + the gamepad id string when a
 * controller is present. No user id, no IP, no timestamps beyond
 * hour-bucketed aggregates.
 */

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api/client';

let _pingedThisSession = false;

export function useConsolePing(opts: { gamepadId?: string | null } = {}) {
  const sentInitialRef = useRef(false);
  const sentGamepadRef = useRef(false);

  useEffect(() => {
    if (_pingedThisSession || sentInitialRef.current) return;
    sentInitialRef.current = true;
    _pingedThisSession = true;
    api.post('/api/telemetry/console-ping', {}).catch(() => {});
  }, []);

  useEffect(() => {
    if (!opts.gamepadId || sentGamepadRef.current) return;
    sentGamepadRef.current = true;
    api.post('/api/telemetry/console-ping', { gamepadId: opts.gamepadId }).catch(() => {});
  }, [opts.gamepadId]);
}
