// Audit fix sweep (PR #2356) — FIX-sub-worlds-004: the Spawn form's name
// field carries the 200-char cap in the field itself with a live counter
// and the 3-char minimum stated up front, instead of a name being saved
// with no message and an over-limit name failing only after submit.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

import { SpawnPanel } from '@/components/sub-worlds/SpawnPanel';

describe('SpawnPanel name length', () => {
  it('caps the name at 200 chars with a live counter and the range stated', () => {
    render(<SpawnPanel />);
    const name = screen.getByPlaceholderText('World name') as HTMLInputElement;
    expect(name.maxLength).toBe(200);
    expect(screen.getByText('3–200 characters.')).toBeTruthy();
    expect(screen.getByText('0/200')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'abcd' } });
    expect(screen.getByText('4/200')).toBeTruthy();
  });

  it('states the 3-char minimum while the name is too short', () => {
    render(<SpawnPanel />);
    const name = screen.getByPlaceholderText('World name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'ab' } });
    expect(screen.getByText('At least 3 characters.')).toBeTruthy();
  });
});
