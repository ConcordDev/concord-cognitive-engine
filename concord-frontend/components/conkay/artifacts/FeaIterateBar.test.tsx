/// <reference types="@testing-library/jest-dom/vitest" />
// Phase S3-c — the FEA re-solve bar: say a change → review the INTENT → run the
// real solver (async) → honest states. The actual re-solve + 3D recolor live in
// FeaAdapter (jsdom can't run the solver or WebGL); this owns the
// utterance → confirm → solving/resolved/error flow that drives it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FeaIterateBar } from './FeaIterateBar';

const SRC = {
  model: {
    nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }, { id: 'n2', x: 0, y: 3, z: 0 }],
    members: [{ id: 'm1', nodeI: 'n1', nodeJ: 'n2', area: 0.01, momentI: 0.0002 }],
    loads: [{ nodeId: 'n2', Fy: -20000 }],
    supports: [{ nodeId: 'n1', fixed: true }],
  },
};

function setup(onResolve = vi.fn().mockResolvedValue({ ok: true }), dirty = false) {
  const onRevert = vi.fn();
  render(<FeaIterateBar sourceInput={SRC} dirty={dirty} onResolve={onResolve} onRevert={onRevert} />);
  return { onResolve, onRevert };
}

describe('FeaIterateBar — S3-c re-solve interaction', () => {
  it('renders nothing when the analysis has no editable model', () => {
    const { container } = render(
      <FeaIterateBar sourceInput={{ model: { nodes: [], members: [] } }} dirty={false} onResolve={vi.fn()} onRevert={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('valid utterance → intent confirm gate; Re-solve runs the real solver with the transformed model', async () => {
    const { onResolve } = setup();
    fireEvent.change(screen.getByTestId('ck-fea-iterate-input'), { target: { value: 'make the members thicker' } });
    fireEvent.click(screen.getByTestId('ck-fea-iterate-submit'));

    expect(screen.getByTestId('ck-fea-iterate-confirm')).toHaveTextContent('thicken all members 60%');
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('ck-fea-iterate-resolve'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    const newInput = onResolve.mock.calls[0][0] as { model: { members: { area: number }[] } };
    expect(newInput.model.members[0].area).toBeCloseTo(0.016, 9); // 0.01 × 1.6
    await waitFor(() => expect(screen.queryByTestId('ck-fea-iterate-confirm')).toBeNull()); // cleared on ok
  });

  it('shows an honest "Solving…" state while the solver runs, then settles', async () => {
    let finish!: (v: { ok: boolean }) => void;
    const onResolve = vi.fn(() => new Promise<{ ok: boolean }>((r) => { finish = r; }));
    setup(onResolve);
    fireEvent.change(screen.getByTestId('ck-fea-iterate-input'), { target: { value: 'reduce the load 30%' } });
    fireEvent.click(screen.getByTestId('ck-fea-iterate-submit'));
    fireEvent.click(screen.getByTestId('ck-fea-iterate-resolve'));

    expect(screen.getByTestId('ck-fea-iterate-resolve')).toHaveTextContent('Solving…');
    expect(screen.getByTestId('ck-fea-iterate-input')).toBeDisabled();

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByTestId('ck-fea-iterate-confirm')).toBeNull());
  });

  it('surfaces the solver error verbatim on failure', async () => {
    const onResolve = vi.fn().mockResolvedValue({ ok: false, error: 'singular stiffness matrix' });
    setup(onResolve);
    fireEvent.change(screen.getByTestId('ck-fea-iterate-input'), { target: { value: 'double the load' } });
    fireEvent.click(screen.getByTestId('ck-fea-iterate-submit'));
    fireEvent.click(screen.getByTestId('ck-fea-iterate-resolve'));
    await waitFor(() => expect(screen.getByTestId('ck-fea-iterate-error')).toHaveTextContent('singular stiffness matrix'));
  });

  it('unparseable utterance → honest rejection, solver never called', () => {
    const { onResolve } = setup();
    fireEvent.change(screen.getByTestId('ck-fea-iterate-input'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByTestId('ck-fea-iterate-submit'));
    expect(screen.getByTestId('ck-fea-iterate-reject')).toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('dirty → re-solved badge + Revert fires onRevert', () => {
    const { onRevert } = setup(vi.fn(), true);
    expect(screen.getByTestId('ck-fea-iterate-dirty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ck-fea-iterate-revert'));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });
});
