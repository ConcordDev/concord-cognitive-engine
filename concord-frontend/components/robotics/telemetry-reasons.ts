/**
 * Shared formatter for robotics.telemetry fields the server returns as null.
 * The server sends a reason code (telemetryReason); the UI shows a plain
 * sentence instead. Unknown codes fall back to "not recorded" so a raw
 * snake_case code never reaches the screen.
 */
const REASON_SENTENCE: Record<string, string> = {
  no_sensor_log: 'no sensor samples logged yet (log some in the Sensors tab)',
  not_recorded: 'not recorded',
};

export function reasonSentence(code: string | null | undefined): string {
  if (!code) return REASON_SENTENCE.not_recorded;
  return REASON_SENTENCE[code] ?? REASON_SENTENCE.not_recorded;
}
