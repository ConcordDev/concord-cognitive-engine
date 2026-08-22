/**
 * RegionPolygonEditor — feature-build follow-up pass (#17 of the walk).
 * Pins the click-to-place-vertex polygon editor the kingdoms lens's own
 * "Found a Kingdom" form has disclosed as planned "v1.1" since it shipped
 * (`app/lenses/kingdoms/page.tsx`: "v1 — paste polygon coords directly.
 * Visual editor in v1.1."). Every click must map to the correct real
 * world-coordinate pair given the current range, and existing kingdoms'
 * real region_polygon data must render as reference context, not be
 * silently dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegionPolygonEditor } from '@/components/kingdoms/RegionPolygonEditor';

// jsdom's SVGElement has no real layout engine — getBoundingClientRect
// always returns zeros unless stubbed. Stub it to a fixed 420x420 box so
// clicks at known clientX/clientY map to predictable world coordinates.
function stubRect() {
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 420, height: 420, right: 420, bottom: 420, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
}

describe('RegionPolygonEditor', () => {
  it('maps a click at the center of the canvas to world origin (0,0) at the default range', () => {
    stubRect();
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[]} onChange={onChange} />);
    const svg = screen.getByRole('img', { name: /Region polygon drawing surface/i });
    fireEvent.click(svg, { clientX: 210, clientY: 210 });
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('maps a click at the top-left corner to (-range, -range)', () => {
    stubRect();
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[]} onChange={onChange} />);
    const svg = screen.getByRole('img', { name: /Region polygon drawing surface/i });
    fireEvent.click(svg, { clientX: 0, clientY: 0 });
    expect(onChange).toHaveBeenCalledWith([[-250, -250]]);
  });

  it('appends to existing points rather than replacing them', () => {
    stubRect();
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[[10, 10]]} onChange={onChange} />);
    const svg = screen.getByRole('img', { name: /Region polygon drawing surface/i });
    fireEvent.click(svg, { clientX: 210, clientY: 210 });
    expect(onChange).toHaveBeenCalledWith([[10, 10], [0, 0]]);
  });

  it('renders each vertex as a removable chip and calls onChange with it excluded', () => {
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[[1, 2], [3, 4]]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove vertex 1'));
    expect(onChange).toHaveBeenCalledWith([[3, 4]]);
  });

  it('undo removes only the last point', () => {
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[[1, 2], [3, 4], [5, 6]]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Undo last/i }));
    expect(onChange).toHaveBeenCalledWith([[1, 2], [3, 4]]);
  });

  it('clear empties all points', () => {
    const onChange = vi.fn();
    render(<RegionPolygonEditor value={[[1, 2], [3, 4]]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders existing kingdoms real region_polygon data as labeled reference shapes, not silently dropped', () => {
    render(
      <RegionPolygonEditor
        value={[]}
        onChange={vi.fn()}
        existingRegions={[{ id: 'k1', name: 'Frosthold', region_polygon: [[0, 0], [50, 0], [50, 50]] }]}
      />,
    );
    expect(screen.getByText('Frosthold')).toBeInTheDocument();
  });

  it('undo/clear are disabled with zero points (no confusing no-op controls)', () => {
    render(<RegionPolygonEditor value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Undo last/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeDisabled();
  });
});
