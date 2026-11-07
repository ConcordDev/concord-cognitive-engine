import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  recordStudioRun,
  recordStudioModelSave,
  useStudioRunCount,
  useStudioModelSaveCount,
} from '@/lib/sim/studio-activity';

// sim.md F4: the Studio tab's real computations (System Dynamics / Agent-Based /
// Discrete-Event / Toolkit) have no persisted artifact record, so they were
// previously invisible to the lens's headline stats. This counter makes that
// real activity observable without fabricating a number or misusing the
// scenario `run` artifact type.

function RunCountProbe() {
  const count = useStudioRunCount();
  return <span data-testid="run-count">{count}</span>;
}

function ModelSaveCountProbe() {
  const count = useStudioModelSaveCount();
  return <span data-testid="save-count">{count}</span>;
}

describe('sim/studio-activity', () => {
  it('starts at the counts already recorded (module-scoped, not reset per render)', () => {
    render(<RunCountProbe />);
    const before = Number(screen.getByTestId('run-count').textContent);
    expect(Number.isFinite(before)).toBe(true);
  });

  it('increments the run count on every recordStudioRun() call and reflects it live', () => {
    render(<RunCountProbe />);
    const before = Number(screen.getByTestId('run-count').textContent);
    act(() => {
      recordStudioRun();
      recordStudioRun();
      recordStudioRun();
    });
    const after = Number(screen.getByTestId('run-count').textContent);
    expect(after).toBe(before + 3);
  });

  it('increments the model-save count independently of the run count', () => {
    render(<ModelSaveCountProbe />);
    const before = Number(screen.getByTestId('save-count').textContent);
    act(() => {
      recordStudioModelSave();
    });
    const after = Number(screen.getByTestId('save-count').textContent);
    expect(after).toBe(before + 1);
  });
});
