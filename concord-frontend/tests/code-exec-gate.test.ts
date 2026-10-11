import { describe, expect, it, beforeEach } from 'vitest';
import {
  parseExecStatus,
  publishExecStatus,
  readExecStatus,
  resetExecStatusForTests,
  subscribeExecStatus,
} from '@/components/code/codeExecGate';

beforeEach(() => resetExecStatusForTests());

describe('code exec gate', () => {
  it('treats a disabled server flag as off, with the reason', () => {
    const status = parseExecStatus({
      ok: true,
      result: { enabled: false, reason: 'Live code execution is disabled in this environment.' },
    });
    expect(status.enabled).toBe(false);
    expect(status.reason).toMatch(/disabled/);
    publishExecStatus(status);
    expect(readExecStatus()?.enabled).toBe(false);
  });

  it('notifies subscribers and fails closed when the status call errors', () => {
    const seen: boolean[] = [];
    const stop = subscribeExecStatus((s) => seen.push(s?.enabled === false));
    publishExecStatus(parseExecStatus({ ok: false, error: 'down' }));
    expect(readExecStatus()?.enabled).toBe(false);
    expect(seen.at(-1)).toBe(true);
    stop();
  });
});
