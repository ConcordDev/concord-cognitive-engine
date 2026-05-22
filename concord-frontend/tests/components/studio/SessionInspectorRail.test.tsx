import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import SessionInspectorRail from '@/components/studio/SessionInspectorRail';

const CLIP = { trackId: 't1', sceneId: 's1', assetId: 'a1', label: 'My Clip', durationBeats: 8, color: '#0ff' };
const TRACK = {
  id: 't1', name: 'Lead', type: 'midi', color: '#f0f', volume: 0.6, pan: -0.3,
  effectChain: [
    { id: 'fx1', type: 'Reverb', enabled: true },
    { id: 'fx2', type: 'Delay', enabled: false },
  ],
} as never;

describe('SessionInspectorRail', () => {
  it('shows the empty hint when nothing selected', () => {
    render(<SessionInspectorRail selectedClip={null} selectedTrack={null} />);
    expect(screen.getByText(/Click a clip or track to edit/)).toBeInTheDocument();
  });

  it('renders the clip pane with name + smart controls', () => {
    render(<SessionInspectorRail selectedClip={CLIP} selectedTrack={null} />);
    expect(screen.getByDisplayValue('My Clip')).toBeInTheDocument();
    expect(screen.getByText('Smart Controls')).toBeInTheDocument();
    expect(screen.getByText('a1')).toBeInTheDocument();
  });

  it('edits clip name and deletes clip', () => {
    const onUpdateClip = vi.fn(), onDeleteClip = vi.fn();
    render(
      <SessionInspectorRail
        selectedClip={CLIP} selectedTrack={null}
        onUpdateClip={onUpdateClip} onDeleteClip={onDeleteClip}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('My Clip'), { target: { value: 'Renamed' } });
    expect(onUpdateClip).toHaveBeenCalledWith({ label: 'Renamed' });
    fireEvent.click(screen.getByText('Delete clip'));
    expect(onDeleteClip).toHaveBeenCalled();
  });

  it('closes the inspector', () => {
    const onCloseInspector = vi.fn();
    render(<SessionInspectorRail selectedClip={CLIP} selectedTrack={null} onCloseInspector={onCloseInspector} />);
    fireEvent.click(screen.getByLabelText('Close inspector'));
    expect(onCloseInspector).toHaveBeenCalled();
  });

  it('renders the track pane with inserts and edits name + mix', () => {
    const onUpdateTrack = vi.fn();
    render(<SessionInspectorRail selectedClip={null} selectedTrack={TRACK} onUpdateTrack={onUpdateTrack} />);
    expect(screen.getByDisplayValue('Lead')).toBeInTheDocument();
    expect(screen.getByText('Reverb')).toBeInTheDocument();
    expect(screen.getByText('on')).toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Lead'), { target: { value: 'Lead 2' } });
    expect(onUpdateTrack).toHaveBeenCalledWith({ name: 'Lead 2' });

    const sliders = document.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: '0.9' } });
    expect(onUpdateTrack).toHaveBeenCalledWith({ volume: 0.9 });
  });

  it('shows the no-inserts placeholder when effectChain empty', () => {
    render(<SessionInspectorRail selectedClip={null} selectedTrack={{ ...TRACK, effectChain: [] }} />);
    expect(screen.getByText('No inserts')).toBeInTheDocument();
  });

  it('clip pane takes priority over a track when both selected', () => {
    render(<SessionInspectorRail selectedClip={CLIP} selectedTrack={TRACK} />);
    expect(screen.getByText('Clip')).toBeInTheDocument();
    expect(screen.queryByText('Inserts')).not.toBeInTheDocument();
  });

  it('handles a clip with missing optional fields', () => {
    render(<SessionInspectorRail selectedClip={{ trackId: 't1', sceneId: 's1' }} selectedTrack={null} />);
    expect(screen.getByText(/Length: \? beats/)).toBeInTheDocument();
  });
});
