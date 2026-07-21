// World Lens plan Phase 5 (Panels: Glance → Summon → Sanctum) —
// SummonDrawer, the generic "Summon" primitive. Extracted from
// components/world/concord-link/LinkShell.tsx (the one place this exact
// shell shape already existed and had already proven itself: a slide-in
// drawer, `fixed inset-y-0 right-0 z-40`, header + close button). LinkShell
// now consumes it instead of inlining its own copy — see
// tests/link-shell.test.tsx, which still passes unchanged, proving the
// refactor is behavior-preserving.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SummonDrawer } from '@/components/lens/SummonDrawer';

describe('SummonDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <SummonDrawer open={false} title="Test" onClose={() => {}}>
        <p>content</p>
      </SummonDrawer>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the title, children, and a testId when open', () => {
    render(
      <SummonDrawer open title="The Link" onClose={() => {}} testId="my-drawer">
        <p>drawer contents</p>
      </SummonDrawer>
    );
    expect(screen.getByText('The Link')).toBeInTheDocument();
    expect(screen.getByText('drawer contents')).toBeInTheDocument();
    expect(screen.getByTestId('my-drawer')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SummonDrawer open title="Test" onClose={onClose}>
        <p>content</p>
      </SummonDrawer>
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('defaults to the w-80 width LinkShell already proved, but accepts an override', () => {
    const { container, rerender } = render(
      <SummonDrawer open title="Test" onClose={() => {}}>
        <p>content</p>
      </SummonDrawer>
    );
    expect(container.querySelector('.w-80')).toBeTruthy();
    rerender(
      <SummonDrawer open title="Test" onClose={() => {}} widthClassName="w-96">
        <p>content</p>
      </SummonDrawer>
    );
    expect(container.querySelector('.w-96')).toBeTruthy();
    expect(container.querySelector('.w-80')).toBeNull();
  });
});
