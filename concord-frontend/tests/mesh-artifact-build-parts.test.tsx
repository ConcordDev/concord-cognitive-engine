// A ConKay build in the 3D viewer: each part is listed with its check colour
// and can be picked (the same pick the model's own click makes).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" />, useThree: () => ({}) }));
vi.mock('@react-three/drei', () => ({ Bounds: () => null, Edges: () => null, Grid: () => null, OrbitControls: () => null }));

import MeshArtifactView from '@/components/chat/MeshArtifactView';
import { PART_STATUS_COLOR } from '@/lib/mesh/engineering-view';

const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0];
const indices = [0, 1, 2, 3, 4, 5];
const partRanges = [{ id: 'BOARD', name: 'board', nodeName: 'board', i0: 0, i1: 3 }, { id: 'BRACKET', name: 'bracket', nodeName: 'bracket', i0: 3, i1: 6 }];

describe('MeshArtifactView — build parts', () => {
  it('lists parts with their check colour and picks one', () => {
    const onPick = vi.fn();
    render(<MeshArtifactView positions={positions} indices={indices} partRanges={partRanges} partStatus={{ BOARD: 'fail', BRACKET: 'pass' }} selectedPart={null} onPickPart={onPick} />);
    const board = screen.getByTestId('part-pick-BOARD');
    expect((board.querySelector('span') as HTMLElement).style.background).toBe(hexToRgb(PART_STATUS_COLOR.fail));
    expect((screen.getByTestId('part-pick-BRACKET').querySelector('span') as HTMLElement).style.background).toBe(hexToRgb(PART_STATUS_COLOR.pass));
    fireEvent.click(board);
    expect(onPick).toHaveBeenCalledWith('BOARD');
  });
  it('picking the selected part again clears the selection', () => {
    const onPick = vi.fn();
    render(<MeshArtifactView positions={positions} indices={indices} partRanges={partRanges} partStatus={{ BOARD: 'fail' }} selectedPart="BOARD" onPickPart={onPick} />);
    expect(screen.getByTestId('part-pick-BOARD').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('part-pick-BOARD'));
    expect(onPick).toHaveBeenCalledWith(null);
  });
  it('a model without build status keeps the plain part list', () => {
    render(<MeshArtifactView positions={positions} indices={indices} partRanges={partRanges} partList={[{ name: 'board' }, { name: 'bracket' }]} />);
    expect(screen.queryByTestId('part-pick-BOARD')).toBeNull();
    expect(screen.getByTestId('part-hide-board')).toBeTruthy();
  });
});

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
