import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentLeagues } from '@/components/sports/use-recent-leagues';

describe('useRecentLeagues', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('remembers a real created league and persists it across remounts', () => {
    const { result, unmount } = renderHook(() => useRecentLeagues());
    expect(result.current.leagues).toEqual([]);

    act(() => { result.current.remember({ id: 'lg-1', name: 'Sunday League', sportKind: 'soccer' }); });
    expect(result.current.leagues).toEqual([{ id: 'lg-1', name: 'Sunday League', sportKind: 'soccer' }]);
    unmount();

    const { result: result2 } = renderHook(() => useRecentLeagues());
    expect(result2.current.leagues).toEqual([{ id: 'lg-1', name: 'Sunday League', sportKind: 'soccer' }]);
  });

  it('moves a re-selected league to the front instead of duplicating it', () => {
    const { result } = renderHook(() => useRecentLeagues());
    act(() => { result.current.remember({ id: 'lg-1', name: 'A', sportKind: 'soccer' }); });
    act(() => { result.current.remember({ id: 'lg-2', name: 'B', sportKind: 'tennis' }); });
    act(() => { result.current.remember({ id: 'lg-1', name: 'A', sportKind: 'soccer' }); });

    expect(result.current.leagues.map((l) => l.id)).toEqual(['lg-1', 'lg-2']);
  });

  it('caps the remembered list at 8 entries', () => {
    const { result } = renderHook(() => useRecentLeagues());
    for (let i = 0; i < 10; i++) {
      act(() => { result.current.remember({ id: `lg-${i}`, name: `League ${i}`, sportKind: 'soccer' }); });
    }
    expect(result.current.leagues.length).toBe(8);
    // most recent first
    expect(result.current.leagues[0].id).toBe('lg-9');
  });
});
