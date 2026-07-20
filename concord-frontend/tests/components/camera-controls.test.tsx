/**
 * CameraControls — the World Lens "Camera Mode" panel.
 *
 * Regression coverage for a live honesty-rubric violation: the Zoom slider
 * rendered as fully interactive (drag it, watch the % label move) while
 * wired to a real no-op (`onZoom={() => {}}` at the page.tsx call site) —
 * dragging it changed nothing about the camera. Fixed by wiring Zoom to
 * real state (see tests/lib/camera-zoom.test.ts + the source-pin coverage
 * in tests/world-page-stable-callback-refs.test.ts).
 *
 * The Rotation compass, non-avatar Follow Target options, and the
 * Cinematic Timeline transport have no backing camera implementation yet
 * (ConcordiaScene.tsx excludes 'isometric' from its per-frame update
 * entirely, there's no NPC/event follow-target plumbing, and nothing moves
 * the camera for cinematic shots). Per the honesty rubric ("an inert
 * disabled control beats one that silently no-ops"), these are rendered
 * visibly disabled instead of fake-wired — this file pins that contract so
 * a future phase (plan doc Phase 4) has to deliberately re-enable them
 * alongside landing the real camera behavior, not by accident.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CameraControls, { type CameraState } from '@/components/world-lens/CameraControls';

function baseState(overrides: Partial<CameraState> = {}): CameraState {
  return {
    mode: 'follow',
    zoom: 15,
    rotation: 'NE',
    followTarget: 'avatar',
    cinematicPlaying: false,
    cinematicTime: 0,
    cinematicDuration: 0,
    transitioning: false,
    ...overrides,
  };
}

describe('CameraControls', () => {
  it('calls onZoom with the real slider value on drag (not a no-op)', () => {
    const onZoom = vi.fn();
    render(
      <CameraControls
        cameraState={baseState()}
        onModeChange={() => {}}
        onZoom={onZoom}
        onRotate={() => {}}
        onTransition={() => {}}
      />,
    );
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onZoom).toHaveBeenCalledWith(40);
  });

  it('zoom in/out buttons call onZoom with a real adjusted value', () => {
    const onZoom = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ zoom: 50 })}
        onModeChange={() => {}}
        onZoom={onZoom}
        onRotate={() => {}}
        onTransition={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(onZoom).toHaveBeenCalledWith(55);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(onZoom).toHaveBeenCalledWith(45);
  });

  it('renders the Rotation compass visibly disabled, not silently wired to a no-op', () => {
    render(
      <CameraControls
        cameraState={baseState()}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
      />,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    for (const btn of screen.getAllByLabelText('Rotate cw')) {
      expect(btn).toBeDisabled();
    }
    for (const angle of ['NE', 'SE', 'SW', 'NW']) {
      expect(screen.getByText(angle)).toBeDisabled();
    }
  });

  it('disables the NPC/Event follow targets but keeps Your Avatar live', () => {
    const onTransition = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ mode: 'follow' })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={onTransition}
      />,
    );
    expect(screen.getByText('NPC')).toBeDisabled();
    expect(screen.getByText('Event')).toBeDisabled();
    const avatarBtn = screen.getByText('Your Avatar');
    expect(avatarBtn).not.toBeDisabled();
    fireEvent.click(avatarBtn);
    expect(onTransition).toHaveBeenCalledWith({ followTarget: 'avatar' });
  });

  it('renders the Cinematic Timeline transport visibly disabled in cinematic mode', () => {
    render(
      <CameraControls
        cameraState={baseState({ mode: 'cinematic' })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
      />,
    );
    expect(screen.getByLabelText('Previous track')).toBeDisabled();
    expect(screen.getByLabelText('Next track')).toBeDisabled();
  });
});
