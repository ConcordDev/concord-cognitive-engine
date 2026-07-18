/// <reference types="@testing-library/jest-dom/vitest" />
// Phase S3-b — the Iterate bar interaction: say a change → review the exact
// before→after → Apply (or get an honest rejection that changes nothing). The
// 3D re-render lives in BuildingAdapter (jsdom can't run it); this owns the
// utterance → confirm-gate → apply/reject flow that drives it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuildingIterateBar } from './BuildingIterateBar';

const SRC = {
  archetype: 'tower',
  feature: 'spire',
  name: 'Test Tower',
  position: { x: 0, y: 0, z: 0 },
  dimensions: { width: 6, height: 20, depth: 6 },
};

function setup(overrides: Partial<React.ComponentProps<typeof BuildingIterateBar>> = {}) {
  const onApply = vi.fn();
  const onRevert = vi.fn();
  render(<BuildingIterateBar sourceInput={SRC} dirty={false} onApply={onApply} onRevert={onRevert} {...overrides} />);
  return { onApply, onRevert };
}

describe('BuildingIterateBar — S3-b iterate interaction', () => {
  it('renders nothing when the artifact has no editable dimensions', () => {
    const { container } = render(
      <BuildingIterateBar sourceInput={{ archetype: 'tower' }} dirty={false} onApply={() => {}} onRevert={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('a valid utterance opens a confirm gate with the exact before→after; Apply commits it', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByTestId('ck-iterate-input'), { target: { value: 'make it taller by 5m' } });
    fireEvent.click(screen.getByTestId('ck-iterate-submit'));

    const confirm = screen.getByTestId('ck-iterate-confirm');
    expect(confirm).toHaveTextContent('height');
    expect(confirm).toHaveTextContent('20 m');
    expect(confirm).toHaveTextContent('25 m');
    expect(onApply).not.toHaveBeenCalled(); // nothing changes until Apply

    fireEvent.click(screen.getByTestId('ck-iterate-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const newInput = onApply.mock.calls[0][0] as { dimensions: { height: number } };
    expect(newInput.dimensions.height).toBe(25);
  });

  it('an unparseable utterance shows an honest rejection and never calls onApply', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByTestId('ck-iterate-input'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByTestId('ck-iterate-submit'));
    expect(screen.getByTestId('ck-iterate-reject')).toBeInTheDocument();
    expect(screen.queryByTestId('ck-iterate-confirm')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Cancel dismisses the gate without applying', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByTestId('ck-iterate-input'), { target: { value: 'wider by 2m' } });
    fireEvent.click(screen.getByTestId('ck-iterate-submit'));
    fireEvent.click(screen.getByTestId('ck-iterate-cancel'));
    expect(screen.queryByTestId('ck-iterate-confirm')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('when dirty, shows the unsaved badge + Revert (which fires onRevert)', () => {
    const { onRevert } = setup({ dirty: true });
    expect(screen.getByTestId('ck-iterate-dirty')).toHaveTextContent(/not published/i);
    fireEvent.click(screen.getByTestId('ck-iterate-revert'));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });
});
