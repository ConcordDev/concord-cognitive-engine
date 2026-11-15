// FIX-billing-013 — the tab-chord pin. The walk found billing's 'g o'
// style chords inert: react-hotkeys-hook v5 splits sequences on '>'
// by default, so the platform's space-chord convention ('g o')
// parsed as one unmatchable key. useLensCommand now binds two-key
// space chords in the library's '>' sequence form. These pins hold
// the chord AND the regression guards: single keys and the spacebar
// binding must keep firing exactly as before.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { KeyboardProvider } from '@/lib/keyboard';

function Harness({ commands }: { commands: { id: string; keys: string; onFire: () => void }[] }) {
  useLensCommand(
    commands.map((c) => ({ id: c.id, keys: c.keys, description: c.id, category: 'navigation' as const, action: c.onFire })),
    { lensId: 'billing' },
  );
  return <div>harness</div>;
}
const kd = (key: string, code: string) => fireEvent.keyDown(document.body, { key, code, bubbles: true });

describe('lens command chords (FIX-billing-013)', () => {
  it("pressing g then o fires the 'g o' command", () => {
    const onFire = vi.fn();
    render(<KeyboardProvider><Harness commands={[{ id: 'goto-overview', keys: 'g o', onFire }]} /></KeyboardProvider>);
    kd('g', 'KeyG');
    kd('o', 'KeyO');
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('a lone g does not fire the chord', () => {
    const onFire = vi.fn();
    render(<KeyboardProvider><Harness commands={[{ id: 'goto-overview', keys: 'g o', onFire }]} /></KeyboardProvider>);
    kd('g', 'KeyG');
    expect(onFire).not.toHaveBeenCalled();
  });

  it('single-key commands still fire', () => {
    const onFire = vi.fn();
    render(<KeyboardProvider><Harness commands={[{ id: 'browse-plans', keys: 'n', onFire }]} /></KeyboardProvider>);
    kd('n', 'KeyN');
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("the ' ' spacebar binding still fires (meditation play/pause shape)", () => {
    const onFire = vi.fn();
    render(<KeyboardProvider><Harness commands={[{ id: 'play-pause', keys: ' ', onFire }]} /></KeyboardProvider>);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', bubbles: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
