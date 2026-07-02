/**
 * Socket connection status with a real terminal state.
 *
 * The socket (lib/realtime/socket.ts) is configured with
 * `reconnectionAttempts: 5`; once those are exhausted the socket.io manager
 * emits `reconnect_failed` and stops trying. The old binary
 * connected/not-connected presentation could therefore show "Connecting…"
 * forever after the manager had already given up — a dishonest state.
 *
 * This pure reducer tracks three honest states:
 *
 *   - 'connecting' → the manager is actively trying (initial connect or a
 *                    reconnection cycle in flight)
 *   - 'connected'  → live socket
 *   - 'offline'    → terminal: the manager exhausted its reconnection
 *                    attempts (`reconnect_failed`). Only a new attempt
 *                    (`reconnect_attempt`) or a successful `connect` leaves
 *                    this state — a stray disconnect/connect_error does not
 *                    flip it back to an eternal "Connecting…".
 *
 * Pure module (no React, no socket.io import) so it is unit-testable and
 * shared between hooks/useSocket.ts and the UI label helpers below.
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export type ConnectionEvent =
  | 'connect'
  | 'disconnect'
  | 'connect_error'
  | 'reconnect_attempt'
  | 'reconnect_failed';

export function nextConnectionStatus(
  prev: ConnectionStatus,
  event: ConnectionEvent
): ConnectionStatus {
  switch (event) {
    case 'connect':
      return 'connected';
    case 'reconnect_failed':
      // Terminal: the manager exhausted reconnectionAttempts and stopped.
      return 'offline';
    case 'reconnect_attempt':
      // A fresh reconnection cycle began — honestly "connecting" again.
      return 'connecting';
    case 'disconnect':
    case 'connect_error':
      // While offline (terminal) a trailing disconnect/connect_error from the
      // final failed attempt must NOT resurrect the eternal "Connecting…".
      return prev === 'offline' ? 'offline' : 'connecting';
    default:
      return prev;
  }
}

/** Human label for the connection pill. Never shows eternal "Connecting…" when terminal. */
export function connectionLabel(status: ConnectionStatus): string {
  if (status === 'connected') return 'Live connection';
  if (status === 'offline') return 'Offline';
  return 'Connecting...';
}

/** Dot class — keeps the existing green/red pattern; terminal offline is gray. */
export function connectionDotClass(status: ConnectionStatus): string {
  if (status === 'connected') return 'bg-green-400';
  if (status === 'offline') return 'bg-gray-500';
  return 'bg-red-400';
}
