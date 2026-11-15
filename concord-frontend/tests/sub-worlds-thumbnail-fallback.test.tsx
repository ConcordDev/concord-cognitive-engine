/**
 * FIX-sub-worlds-010 (thumbnail leg) — a stored thumbnail URL that 404s
 * left a broken-image card; the card now falls back to the designed
 * no-thumbnail state when the image fails to load.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorldCard, type SubWorld } from '@/components/sub-worlds/WorldCard';

const world: SubWorld = {
  world_id: 'w1', forge_app_dtu_id: null, name: 'Harness World', description: '',
  thumbnail: 'https://example.invalid/dead.png', kind: 'realm', privacy: 'public',
  status: 'active', capacity: 10, spawned_by_user_id: 'user123456', spawned_at: 0,
  updated_at: 0, visits: 0, unique_visitors: 0,
} as SubWorld;

describe('FIX-sub-worlds-010 thumbnail fallback', () => {
  it('a thumbnail that fails to load falls back instead of a broken image', () => {
    const { container } = render(<WorldCard world={world} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
  });
});
