/**
 * Live code execution is a server flag (code.exec-status). The Run button
 * reads this module so it can stay disabled, with the server's reason,
 * instead of looking like the primary action while execution is off.
 */

export interface CodeExecStatus {
  enabled: boolean;
  reason: string;
}

const DISABLED_REASON = 'Live code execution is disabled in this environment. Enable with CONCORD_CODE_EXEC_ENABLED=1.';

let current: CodeExecStatus | null = null;
const listeners = new Set<(status: CodeExecStatus | null) => void>();

export function parseExecStatus(data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined): CodeExecStatus {
  const result = data && data.ok !== false && data.result && typeof data.result === 'object'
    ? data.result as { enabled?: unknown; reason?: unknown }
    : null;
  if (result && typeof result.enabled === 'boolean') {
    return {
      enabled: result.enabled,
      reason: result.enabled ? '' : String(result.reason || DISABLED_REASON),
    };
  }
  return { enabled: false, reason: data?.error ? String(data.error) : 'Could not confirm that live execution is enabled.' };
}

export function publishExecStatus(status: CodeExecStatus | null): void {
  current = status;
  listeners.forEach((fn) => fn(status));
}

export function readExecStatus(): CodeExecStatus | null {
  return current;
}

export function subscribeExecStatus(fn: (status: CodeExecStatus | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

/** Test isolation. Production code does not reset between visits. */
export function resetExecStatusForTests(): void {
  current = null;
  listeners.clear();
}
