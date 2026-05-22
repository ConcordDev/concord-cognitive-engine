import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitAutomationDrawn = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({ emitAutomationDrawn: (...a: unknown[]) => emitAutomationDrawn(...a) }));

import { AutomationView } from '@/components/studio/AutomationView';

const LANES = [
  {
    id: 'l1', parameterPath: 'volume', parameterName: 'Volume', visible: true, color: '#0ff',
    points: [
      { id: 'pt1', beat: 0, value: 0.3, curve: 'linear' },
      { id: 'pt2', beat: 4, value: 0.8, curve: 'linear' },
    ],
  },
  { id: 'l2', parameterPath: 'pan', parameterName: 'Pan', visible: false, points: [] },
];

function baseProps(over: Record<string, unknown> = {}) {
  return {
    track: { id: 't1', name: 'Synth' } as never,
    lanes: LANES, currentBeat: 2, lengthBeats: 16, zoomLevel: 1, projectId: 'p1',
    onAddLane: vi.fn(), onRemoveLane: vi.fn(), onToggleLane: vi.fn(),
    onAddPoint: vi.fn(), onUpdatePoint: vi.fn(), onDeletePoint: vi.fn(),
    ...over,
  };
}

describe('AutomationView', () => {
  it('renders the no-track empty state', () => {
    render(<AutomationView {...baseProps({ track: null })} />);
    expect(screen.getByText(/Select a track to edit automation/)).toBeInTheDocument();
  });

  it('renders the toolbar + lanes for a track', () => {
    render(<AutomationView {...baseProps()} />);
    expect(screen.getByText(/Automation — Synth/)).toBeInTheDocument();
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Pan')).toBeInTheDocument();
  });

  it('renders the no-lanes empty state', () => {
    render(<AutomationView {...baseProps({ lanes: [] })} />);
    expect(screen.getByText('No automation lanes')).toBeInTheDocument();
  });

  it('switches the active tool', () => {
    render(<AutomationView {...baseProps()} />);
    fireEvent.click(screen.getByTitle('Select'));
    fireEvent.click(screen.getByTitle('Erase'));
    fireEvent.click(screen.getByTitle('Draw'));
    expect(screen.getByTitle('Draw')).toBeInTheDocument();
  });

  it('opens the add-parameter panel and adds a lane', () => {
    const onAddLane = vi.fn();
    render(<AutomationView {...baseProps({ onAddLane })} />);
    fireEvent.click(screen.getByText('Add Parameter'));
    // 'Volume' and 'Pan' are already used; pick another
    fireEvent.click(screen.getByText('FX1 Wet'));
    expect(onAddLane).toHaveBeenCalledWith('t1', 'effectChain[0].wet', 'FX1 Wet');
  });

  it('toggles lane visibility and removes a lane', () => {
    const onToggleLane = vi.fn();
    const onRemoveLane = vi.fn();
    render(<AutomationView {...baseProps({ onToggleLane, onRemoveLane })} />);
    const eyeButtons = document.querySelectorAll('.h-6 button');
    fireEvent.click(eyeButtons[0]);
    expect(onToggleLane).toHaveBeenCalledWith('t1', 'l1');
    fireEvent.click(screen.getAllByLabelText('Delete')[0]);
    expect(onRemoveLane).toHaveBeenCalledWith('t1', 'l1');
  });

  it('adds a point by clicking the lane canvas in draw mode', () => {
    const onAddPoint = vi.fn();
    const { container } = render(<AutomationView {...baseProps({ onAddPoint })} />);
    const canvas = container.querySelector('.cursor-crosshair')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 480, height: 120, right: 480, bottom: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(canvas, { clientX: 30, clientY: 40 });
    expect(onAddPoint).toHaveBeenCalled();
    expect(emitAutomationDrawn).toHaveBeenCalled();
  });

  it('deletes a point with the erase tool', () => {
    const onDeletePoint = vi.fn();
    const { container } = render(<AutomationView {...baseProps({ onDeletePoint })} />);
    fireEvent.click(screen.getByTitle('Erase'));
    const point = container.querySelector('.rounded-full.cursor-pointer')!;
    fireEvent.mouseDown(point);
    expect(onDeletePoint).toHaveBeenCalled();
  });

  it('drags a point with the select tool', () => {
    const onUpdatePoint = vi.fn();
    const { container } = render(<AutomationView {...baseProps({ onUpdatePoint })} />);
    fireEvent.click(screen.getByTitle('Select'));
    const point = container.querySelector('.rounded-full.cursor-pointer')!;
    fireEvent.mouseDown(point);
    const canvas = container.querySelector('.cursor-crosshair')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 480, height: 120, right: 480, bottom: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 50 });
    expect(onUpdatePoint).toHaveBeenCalled();
    fireEvent.mouseUp(canvas);
  });
});
