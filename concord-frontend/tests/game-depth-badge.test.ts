// Profile XP, quests, and achievements are the user's own activity. The
// game chip must name the lab and arcade simulations instead of calling
// the whole lens "Not real data".
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

describe('Game depth badge', () => {
  it('names the Design Lab and mini-game as the simulated parts', () => {
    const info = renderHook(() => useDepthBadge('game')).result.current;
    expect(info?.label).toBe('Lab & arcade sim');
    expect(info?.caption).toMatch(/Design Lab forecasts/);
    expect(info?.caption).toMatch(/mini-game practice XP/);
    expect(info?.caption).toMatch(/Profile XP, quests, and achievements are your real activity/);
    expect(info?.caption).not.toMatch(/Not real data/);
    expect(info?.label).not.toBe('Simulated');
  });

  it('leaves a real simulation lens on the generic Simulated chip', () => {
    const info = renderHook(() => useDepthBadge('sim')).result.current;
    expect(info?.label).toBe('Simulated');
  });
});
