import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import MixerPeekStrip from '@/components/studio/MixerPeekStrip';

const TRACKS = [
  { id: 't1', name: 'Drums', volume: 0.8, pan: 0, mute: false, solo: false, armed: false },
  { id: 't2', name: 'Bass', volume: 0.5, pan: -0.4, mute: true, solo: false, armed: false },
  { id: 't3', name: 'Keys', volume: 0.6, pan: 0.6, mute: false, solo: true, armed: true },
] as never[];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('MixerPeekStrip', () => {
  it('renders collapsed by default with a meter per track', () => {
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId={null} />);
    expect(screen.getByText('Mixer')).toBeInTheDocument();
    expect(screen.getByText('· 3 tracks')).toBeInTheDocument();
    expect(screen.getByText('Drums')).toBeInTheDocument();
  });

  it('selects a track on click (collapsed)', () => {
    const onSelectTrack = vi.fn();
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId="t1" onSelectTrack={onSelectTrack} />);
    fireEvent.click(screen.getByTitle('Bass'));
    expect(onSelectTrack).toHaveBeenCalledWith('t2');
  });

  it('shows expand toggle and fires it', () => {
    const onToggleExpanded = vi.fn();
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId={null} onToggleExpanded={onToggleExpanded} />);
    fireEvent.click(screen.getByLabelText('Expand mixer'));
    expect(onToggleExpanded).toHaveBeenCalled();
  });

  it('renders expanded channel strips with mute/solo/arm + faders', () => {
    const onUpdateTrack = vi.fn();
    const onSelectTrack = vi.fn();
    render(
      <MixerPeekStrip
        tracks={TRACKS} selectedTrackId="t3" expanded
        onUpdateTrack={onUpdateTrack} onSelectTrack={onSelectTrack}
        onToggleExpanded={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Collapse mixer')).toBeInTheDocument();

    const muteButtons = screen.getAllByText('M');
    fireEvent.click(muteButtons[0]);
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { mute: true });

    fireEvent.click(screen.getAllByText('S')[0]);
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { solo: true });
    fireEvent.click(screen.getAllByText('R')[0]);
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { armed: true });
  });

  it('updates volume + pan from the expanded faders', () => {
    const onUpdateTrack = vi.fn();
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId={null} expanded onUpdateTrack={onUpdateTrack} />);
    const volFader = screen.getByLabelText('Drums fader');
    fireEvent.change(volFader, { target: { value: '0.3' } });
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { volume: 0.3 });

    const panFader = screen.getByLabelText('Drums pan');
    fireEvent.change(panFader, { target: { value: '0.5' } });
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { pan: 0.5 });
  });

  it('selecting a strip in expanded mode calls onSelectTrack', () => {
    const onSelectTrack = vi.fn();
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId={null} expanded onSelectTrack={onSelectTrack} />);
    fireEvent.click(screen.getByLabelText('Keys fader').closest('div.rounded')!);
    expect(onSelectTrack).toHaveBeenCalledWith('t3');
  });

  it('handles an empty track list', () => {
    render(<MixerPeekStrip tracks={[]} selectedTrackId={null} />);
    expect(screen.getByText('· 0 tracks')).toBeInTheDocument();
  });

  it('omits the toggle when onToggleExpanded absent', () => {
    render(<MixerPeekStrip tracks={TRACKS} selectedTrackId={null} />);
    expect(screen.queryByLabelText(/mixer/i)).not.toBeInTheDocument();
  });
});
