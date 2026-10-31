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
 * Cinematic Timeline transport originally had no backing camera
 * implementation (ConcordiaScene.tsx excluded 'isometric' from its
 * per-frame update entirely, there was no NPC/event follow-target
 * plumbing, and nothing moved the camera for cinematic shots). Per the
 * honesty rubric ("an inert disabled control beats one that silently
 * no-ops"), they were rendered visibly disabled instead of fake-wired.
 *
 * World Lens Phase 4 landed a real isometric orbit (see
 * ISOMETRIC_ANGLES/isometricAngleRef in ConcordiaScene.tsx) and wired the
 * Rotation compass for real — it's only shown in isometric mode now (the
 * only mode that reads it), and its buttons call the real onRotate prop.
 * Follow Target (NPC/Event) remains disabled — no NPC/event
 * camera-target plumbing exists yet.
 *
 * The Cinematic Timeline moved past inert: Phase 4 wired the camera
 * itself (ConcordiaScene interpolates every director shot), and the
 * transport reflected a live sequence — the parent feeds real
 * cinematicPlaying/Time/Duration from the director's start/end events —
 * with a working Stop (the director's cancel). The skip buttons stayed
 * disabled then: the director exposed no per-shot seek, so there was
 * nothing honest for them to call.
 *
 * Q56 remainder: the director grew a real transport (pause/resume/seek/
 * per-shot skip, with concordia:cinematic-playback events carrying the
 * true position), so the transport now wires Pause/Resume and both skip
 * buttons for real. They render disabled only when no handler was
 * passed or no sequence is playing — the same honesty rule as before.
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

  it('only renders the Rotation compass in isometric mode (the only mode that reads it)', () => {
    render(
      <CameraControls
        cameraState={baseState({ mode: 'follow' })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
      />,
    );
    expect(screen.queryByText('Rotation')).not.toBeInTheDocument();
  });

  it('renders the Rotation compass live in isometric mode and calls the real onRotate prop', () => {
    const onRotate = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ mode: 'isometric', rotation: 'NE' })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={onRotate}
        onTransition={() => {}}
      />,
    );
    expect(screen.getByText('Rotation')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    for (const btn of screen.getAllByLabelText(/Rotate (clockwise|counter-clockwise)/)) {
      expect(btn).not.toBeDisabled();
    }
    const seBtn = screen.getByText('SE');
    expect(seBtn).not.toBeDisabled();
    fireEvent.click(seBtn);
    expect(onRotate).toHaveBeenCalledWith('SE');
  });

  it('the clockwise/counter-clockwise arrows step through the compass by 90°', () => {
    const onRotate = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ mode: 'isometric', rotation: 'NE' })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={onRotate}
        onTransition={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Rotate clockwise'));
    expect(onRotate).toHaveBeenCalledWith('SE');
    fireEvent.click(screen.getByLabelText('Rotate counter-clockwise'));
    expect(onRotate).toHaveBeenCalledWith('NW');
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
    expect(screen.getByLabelText('Previous shot')).toBeDisabled();
    expect(screen.getByLabelText('Next shot')).toBeDisabled();
    // Nothing is playing, and sequences start from world events — the
    // play button has nothing honest to start from this panel.
    expect(screen.getByLabelText('Play cinematic timeline')).toBeDisabled();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('shows live progress and a working Stop while a sequence plays', () => {
    const onCinematicStop = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ mode: 'cinematic', cinematicPlaying: true, cinematicTime: 5, cinematicDuration: 10 })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
        onCinematicStop={onCinematicStop}
      />,
    );
    expect(screen.getByText('0:05')).toBeInTheDocument();
    expect(screen.getByText('0:10')).toBeInTheDocument();
    const stop = screen.getByLabelText('Stop cinematic');
    expect(stop).not.toBeDisabled();
    fireEvent.click(stop);
    expect(onCinematicStop).toHaveBeenCalledTimes(1);
    // No transport handlers were passed at this mount — the skip and
    // pause buttons have nothing to call, so they stay disabled.
    expect(screen.getByLabelText('Previous shot')).toBeDisabled();
    expect(screen.getByLabelText('Next shot')).toBeDisabled();
    expect(screen.getByLabelText('Pause cinematic')).toBeDisabled();
  });

  it('wires Pause and both skips while playing when handlers are passed', () => {
    const onCinematicPause = vi.fn();
    const onCinematicSkipBack = vi.fn();
    const onCinematicSkipForward = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({ mode: 'cinematic', cinematicPlaying: true, cinematicTime: 5, cinematicDuration: 10 })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
        onCinematicStop={() => {}}
        onCinematicPause={onCinematicPause}
        onCinematicSkipBack={onCinematicSkipBack}
        onCinematicSkipForward={onCinematicSkipForward}
      />,
    );
    const pause = screen.getByLabelText('Pause cinematic');
    expect(pause).not.toBeDisabled();
    fireEvent.click(pause);
    expect(onCinematicPause).toHaveBeenCalledTimes(1);
    const back = screen.getByLabelText('Previous shot');
    const fwd = screen.getByLabelText('Next shot');
    expect(back).not.toBeDisabled();
    expect(fwd).not.toBeDisabled();
    fireEvent.click(back);
    expect(onCinematicSkipBack).toHaveBeenCalledTimes(1);
    fireEvent.click(fwd);
    expect(onCinematicSkipForward).toHaveBeenCalledTimes(1);
  });

  it('offers Resume (not Pause) while the sequence is paused', () => {
    const onCinematicResume = vi.fn();
    render(
      <CameraControls
        cameraState={baseState({
          mode: 'cinematic', cinematicPlaying: true, cinematicPaused: true,
          cinematicTime: 5, cinematicDuration: 10,
        })}
        onModeChange={() => {}}
        onZoom={() => {}}
        onRotate={() => {}}
        onTransition={() => {}}
        onCinematicStop={() => {}}
        onCinematicResume={onCinematicResume}
        onCinematicSkipBack={() => {}}
        onCinematicSkipForward={() => {}}
      />,
    );
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Pause cinematic')).not.toBeInTheDocument();
    const resume = screen.getByLabelText('Resume cinematic');
    expect(resume).not.toBeDisabled();
    fireEvent.click(resume);
    expect(onCinematicResume).toHaveBeenCalledTimes(1);
    // Stop and skips stay live while paused.
    expect(screen.getByLabelText('Stop cinematic')).not.toBeDisabled();
    expect(screen.getByLabelText('Next shot')).not.toBeDisabled();
  });
});
