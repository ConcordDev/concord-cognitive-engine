/**
 * Clickable divs used to treat Space/Enter as a click even when the
 * key bubbled out of a nested input (RCA-form-hotkey-steal RC2).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

function Clickable({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace}
    >
      <input aria-label="Title" />
      <span>Card</span>
    </div>
  );
}

describe('activateOnEnterOrSpace', () => {
  it('does not click the wrapper when Space or Enter is typed in a nested field', () => {
    const onClick = vi.fn();
    const { getByLabelText } = render(<Clickable onClick={onClick} />);
    const input = getByLabelText('Title');
    fireEvent.keyDown(input, { key: ' ' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still activates the wrapper when Space or Enter is pressed on the wrapper itself', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Clickable onClick={onClick} />);
    const card = getByRole('button');
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('leaves letter keys alone so they can reach lens shortcuts or the field', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Clickable onClick={onClick} />);
    fireEvent.keyDown(getByRole('button'), { key: 'd' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
