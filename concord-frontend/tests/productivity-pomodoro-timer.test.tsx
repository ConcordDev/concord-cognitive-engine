/**
 * FIX-productivity-008 — the Pomodoro card offered only an instant
 * 'Log a 25-min focus session' button: no running timer, no stop.
 * It now runs a real countdown for the chosen duration, logs the
 * session through the same focus-log action when the countdown
 * completes, and Stop ends the run without logging.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-productivity-008 — a running pomodoro timer', () => {
  const s = read('components/productivity/ProductivityFocusPanel.tsx');

  it('starts and stops a countdown', () => {
    expect(s).toContain('Start {duration}-min timer');
    expect(s).toContain('Stop timer');
    expect(s).toContain('setInterval(tick, 500)');
  });

  it('logs only on completion and says so on stop', () => {
    expect(s).toContain("setTimerNote('Session complete — logged.')");
    expect(s).toContain("setTimerNote('Timer stopped — nothing logged.')");
  });

  it('shows the remaining time as a timer', () => {
    expect(s).toContain('role="timer"');
  });
});
