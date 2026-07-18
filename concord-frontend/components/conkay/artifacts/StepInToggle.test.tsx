/// <reference types="@testing-library/jest-dom/vitest" />
// Phase S2-b — the "step in" DOM overlay. The r3f free-cam (StepInControls)
// can't mount in jsdom (no WebGL), but the toggle + controls-hint overlay is
// pure DOM and IS the discoverability surface (docs/UI_QUALITY_RUBRIC.md §2),
// so it's covered directly here: label flips with mode, aria-pressed tracks
// walk, and the WASD hint appears only while walking.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepInToggle } from './StepInToggle';

describe('StepInToggle — S2-b step-in overlay', () => {
  it('orbit mode: shows "Step in", not pressed, no walk hint', () => {
    render(<StepInToggle mode="orbit" onToggle={() => {}} />);
    const btn = screen.getByTestId('ck-step-in-toggle');
    expect(btn).toHaveTextContent('Step in');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('ck-step-in-hint')).toBeNull();
  });

  it('walk mode: shows "Orbit", pressed, and the discoverable WASD hint', () => {
    render(<StepInToggle mode="walk" onToggle={() => {}} />);
    const btn = screen.getByTestId('ck-step-in-toggle');
    expect(btn).toHaveTextContent('Orbit');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    const hint = screen.getByTestId('ck-step-in-hint');
    expect(hint).toHaveTextContent('WASD');
    expect(hint).toHaveTextContent('drag to look');
  });

  it('clicking fires onToggle exactly once', () => {
    const onToggle = vi.fn();
    render(<StepInToggle mode="orbit" onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('ck-step-in-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
