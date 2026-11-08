import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DtuId } from '../DtuId';

describe('DtuId', () => {
  it('copies the full id and confirms, and survives a missing clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DtuId id="dtu-abc-123" className="x" />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(writeText).toHaveBeenCalledWith('dtu-abc-123');
    expect(document.body.textContent).toMatch(/copied/);
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(document.body.textContent).toMatch(/dtu-abc-123/);
  });
});
