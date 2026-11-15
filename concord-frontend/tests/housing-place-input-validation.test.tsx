// Audit fix sweep (PR #2356) — FIX-housing-005: the room place inputs
// were bound to Number state, so every keystroke was coerced — typing
// '-5' ate the minus and stored 5, and a fast Place could send the
// coerced 0,0 instead of the values on screen. The fields now hold what
// was typed and parse at submit: a negative is refused with a message,
// and a valid place sends the current values.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

import { RoomEditor } from '@/components/housing/RoomEditor';
import type { RoomDetail } from '@/components/housing/types';

const room = {
  id: 'room-1',
  room_type: 'living',
  name: 'Living room',
  width: 6,
  depth: 5,
  lock_tier: 0,
  furniture_layout: [],
} as unknown as RoomDetail;

describe('housing RoomEditor place inputs — typed values are what place', () => {
  it('keeps -5 as typed, refuses it with a message, then places the corrected current values', () => {
    const onPlace = vi.fn();
    const view = render(
      <RoomEditor room={room} onLockChange={() => {}} onPlace={onPlace} onRemove={() => {}} busyKey={null} />,
    );
    const itemInput = view.getByPlaceholderText('itemId');
    const xInput = view.getByPlaceholderText('x') as HTMLInputElement;
    const form = view.container.querySelector('form') as HTMLFormElement;

    fireEvent.change(itemInput, { target: { value: 'chair' } });
    fireEvent.change(xInput, { target: { value: '-5' } });
    // The minus survives as typed — no silent coercion to 5 or 0.
    expect(xInput.value).toBe('-5');

    fireEvent.submit(form);
    expect(view.getByRole('alert').textContent).toContain("can't be negative");
    expect(onPlace).not.toHaveBeenCalled();
    expect(xInput.value).toBe('-5');

    fireEvent.change(xInput, { target: { value: '2.5' } });
    fireEvent.submit(form);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0][0]).toMatchObject({ itemId: 'chair', x: 2.5, z: 0, rot: 0 });
  });
});
