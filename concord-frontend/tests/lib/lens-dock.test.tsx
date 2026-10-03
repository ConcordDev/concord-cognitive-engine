// lib/lens-dock — the lens header toolbar shows one button per MOUNTED tool,
// a click reaches exactly one handler, and unmounted tools vanish.
import React, { useCallback, useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { openLensTool, useLensTool, useAvailableLensTools } from '@/lib/lens-dock';

function Tool({ name, onOpen }: { name: 'agent' | 'capture'; onOpen: () => void }) {
  useLensTool(name, onOpen);
  return null;
}

function Counter({ name, label }: { name: 'agent' | 'capture'; label: string }) {
  const [n, setN] = useState(0);
  useLensTool(name, useCallback(() => setN((x) => x + 1), []));
  return <span data-testid={label}>{n}</span>;
}

function Available() {
  const tools = useAvailableLensTools();
  return <span data-testid="available">{[...tools].sort().join(',')}</span>;
}

describe('lens-dock', () => {
  afterEach(() => cleanup());

  it('reports only mounted tools, and drops them on unmount', () => {
    const { rerender } = render(
      <>
        <Available />
        <Tool name="capture" onOpen={() => {}} />
      </>,
    );
    expect(screen.getByTestId('available').textContent).toBe('capture');
    rerender(<Available />);
    expect(screen.getByTestId('available').textContent).toBe('');
  });

  it('returns false when nothing handles the tool', () => {
    render(<Available />);
    expect(openLensTool('agent')).toBe(false);
  });

  it('opens exactly one handler when a lens mounts a second copy of a tool', () => {
    render(
      <>
        <Counter name="agent" label="first" />
        <Counter name="agent" label="second" />
      </>,
    );
    let handled = false;
    act(() => { handled = openLensTool('agent'); });
    expect(handled).toBe(true);
    const total = Number(screen.getByTestId('first').textContent) + Number(screen.getByTestId('second').textContent);
    expect(total).toBe(1);
  });
});
