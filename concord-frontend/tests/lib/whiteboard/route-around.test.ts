import { describe, it, expect } from 'vitest';
import { routeAround } from '@/lib/whiteboard/route-around';

describe('routeAround — A* orthogonal connector routing', () => {
  it('returns a straight 2-point line when no obstacles', () => {
    const r = routeAround({ x: 0, y: 0 }, { x: 200, y: 0 }, []);
    expect(r.routed).toBe(true);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
    expect(r.points[0]).toEqual({ x: 0, y: 0 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it('routes around a single obstacle', () => {
    const obstacles = [{ x: 80, y: -40, width: 40, height: 80 }];
    const r = routeAround({ x: 0, y: 0 }, { x: 200, y: 0 }, obstacles);
    expect(r.routed).toBe(true);
    // The path must NOT pass through the obstacle's vertical strip at y=0.
    for (const p of r.points) {
      const insideX = p.x >= 80 && p.x <= 120;
      const insideY = p.y >= -40 && p.y <= 40;
      if (insideX) expect(insideY).toBe(false);
    }
  });

  it('routes around two obstacles forcing a detour', () => {
    const obstacles = [
      { x: 80,  y: -50, width: 40, height: 60 },
      { x: 120, y: 0,   width: 40, height: 60 },
    ];
    const r = routeAround({ x: 0, y: 0 }, { x: 240, y: 0 }, obstacles);
    expect(r.routed).toBe(true);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  it('collapses collinear runs to corner points only', () => {
    const obstacles = [{ x: 100, y: -10, width: 20, height: 20 }];
    const r = routeAround({ x: 0, y: 50 }, { x: 200, y: 50 }, obstacles);
    expect(r.routed).toBe(true);
    // No three consecutive points should be collinear.
    for (let i = 1; i < r.points.length - 1; i++) {
      const a = r.points[i - 1], b = r.points[i], c = r.points[i + 1];
      const collH = a.y === b.y && b.y === c.y;
      const collV = a.x === b.x && b.x === c.x;
      expect(collH || collV).toBe(false);
    }
  });

  it('falls back to straight diagonal when blocked completely', () => {
    // Box the start cell completely.
    const obstacles = [
      { x: -200, y: -10, width: 100, height: 20 },
      { x: 100,  y: -10, width: 100, height: 20 },
      { x: -50,  y: -200, width: 100, height: 100 },
      { x: -50,  y: 100,  width: 100, height: 100 },
    ];
    const r = routeAround({ x: 0, y: 0 }, { x: 500, y: 500 }, obstacles, { maxIter: 200 });
    // Even the fallback returns 2 points.
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });
});
