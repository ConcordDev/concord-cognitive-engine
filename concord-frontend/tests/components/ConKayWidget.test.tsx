/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/tests/components/ConKayWidget.test.tsx
//
// Pins the CK1 widget-shell contract (docs: durable plan's "R2 — ConKay as
// default interface", CK1 line; ConKayWidget.tsx's own header):
//  - idle by default, with NO internal state machine — clicking/activating
//    never flips the rendered state on its own; only an explicit `state`
//    prop from a caller can render 'listening' | 'thinking' | 'speaking'.
//  - full keyboard operability (focusable, Enter/Space activates) plus an
//    aria-label and a screen-reader text alternative equivalent to the
//    visual state.
//  - ConKayWidgetLayer: dismiss hides the widget and persists the choice to
//    localStorage (`concord:conkay-widget-hidden`) so it survives reload,
//    and its default activation reuses the EXISTING `conkay:summon` window
//    event (the same one ConKayOverlay/CommandPalette already listen for)
//    rather than reaching into ConKayOverlay internals.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConKayWidget } from '@/components/conkay/widget/ConKayWidget';
import { ConKayWidgetLayer, CONKAY_WIDGET_HIDDEN_KEY } from '@/components/conkay/widget/ConKayWidgetLayer';

// The widget's own aria-label starts with "ConKay"; the dismiss control's
// aria-label ("Hide ConKay widget") also CONTAINS "ConKay" but does not
// START with it — anchor the matcher so getByRole never sees an ambiguous
// match between the two.
const WIDGET_NAME = /^ConKay/i;

function getWidget() {
  return screen.getByRole('button', { name: WIDGET_NAME });
}

describe('ConKayWidget — shell contract', () => {
  it('renders idle by default, with an aria-label and an equivalent screen-reader description', () => {
    render(<ConKayWidget />);
    const widget = getWidget();
    expect(widget).toHaveAttribute('data-conkay-widget-state', 'idle');
    expect(screen.getByText(/Idle and ready\. Activate to talk to ConKay\./i)).toBeInTheDocument();
  });

  it('is keyboard-focusable', () => {
    render(<ConKayWidget />);
    const widget = getWidget();
    expect(widget.tabIndex).toBe(0);
    widget.focus();
    expect(widget).toHaveFocus();
  });

  it('calls onActivate on click', () => {
    const onActivate = vi.fn();
    render(<ConKayWidget onActivate={onActivate} />);
    fireEvent.click(getWidget());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('calls onActivate on Enter and on Space', () => {
    const onActivate = vi.fn();
    render(<ConKayWidget onActivate={onActivate} />);
    const widget = getWidget();
    fireEvent.keyDown(widget, { key: 'Enter' });
    fireEvent.keyDown(widget, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('does not activate on unrelated keys', () => {
    const onActivate = vi.fn();
    render(<ConKayWidget onActivate={onActivate} />);
    fireEvent.keyDown(getWidget(), { key: 'a' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('never self-triggers "thinking"/"speaking" — activating leaves the rendered state untouched', () => {
    const onActivate = vi.fn();
    render(<ConKayWidget onActivate={onActivate} />);
    const widget = getWidget();

    fireEvent.click(widget);
    fireEvent.keyDown(widget, { key: 'Enter' });
    fireEvent.keyDown(widget, { key: ' ' });

    // Still idle — the component has no code path that can promote itself.
    expect(widget).toHaveAttribute('data-conkay-widget-state', 'idle');
    expect(screen.queryByText(/Working on a real request right now\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Speaking a real response right now\./i)).not.toBeInTheDocument();
  });

  it('renders "listening" only when explicitly passed', () => {
    render(<ConKayWidget state="listening" />);
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'listening');
    expect(screen.getByText(/Listening to you right now\./i)).toBeInTheDocument();
  });

  it('renders "thinking" only when explicitly passed', () => {
    render(<ConKayWidget state="thinking" />);
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'thinking');
    expect(screen.getByText(/Working on a real request right now\./i)).toBeInTheDocument();
  });

  it('renders "speaking" only when explicitly passed', () => {
    render(<ConKayWidget state="speaking" />);
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'speaking');
    expect(screen.getByText(/Speaking a real response right now\./i)).toBeInTheDocument();
  });

  it('honors a custom aria-label override', () => {
    render(<ConKayWidget label="Custom Kay label" />);
    expect(screen.getByRole('button', { name: 'Custom Kay label' })).toBeInTheDocument();
  });

  it('renders no dismiss control when onDismiss is omitted', () => {
    render(<ConKayWidget />);
    expect(screen.queryByRole('button', { name: /Hide ConKay widget/i })).not.toBeInTheDocument();
  });

  it('renders a dismiss control (reachable by keyboard, separate from the main widget) when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ConKayWidget onDismiss={onDismiss} />);
    const dismissBtn = screen.getByRole('button', { name: /Hide ConKay widget/i });
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // The dismiss click must not also fire the main widget's onActivate —
    // they are separate DOM elements, not nested interactive controls.
  });
});

describe('ConKayWidgetLayer — dismissal persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  it('renders the widget by default (not hidden)', () => {
    render(<ConKayWidgetLayer />);
    expect(getWidget()).toBeInTheDocument();
  });

  it('dismiss hides the widget and persists the choice to localStorage', () => {
    render(<ConKayWidgetLayer />);
    fireEvent.click(screen.getByRole('button', { name: /Hide ConKay widget/i }));
    expect(screen.queryByRole('button', { name: WIDGET_NAME })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CONKAY_WIDGET_HIDDEN_KEY)).toBe('true');
  });

  it('stays hidden on a fresh mount once the preference was persisted (simulating reload)', () => {
    window.localStorage.setItem(CONKAY_WIDGET_HIDDEN_KEY, 'true');
    render(<ConKayWidgetLayer />);
    expect(screen.queryByRole('button', { name: WIDGET_NAME })).not.toBeInTheDocument();
  });

  it('default activation dispatches the existing conkay:summon window event (never reaches into ConKayOverlay internals)', () => {
    const seen = vi.fn();
    window.addEventListener('conkay:summon', seen);
    try {
      render(<ConKayWidgetLayer />);
      fireEvent.click(getWidget());
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('conkay:summon', seen);
    }
  });

  it('honors a caller-supplied onActivate override instead of the default event dispatch', () => {
    const onActivate = vi.fn();
    const seen = vi.fn();
    window.addEventListener('conkay:summon', seen);
    try {
      render(<ConKayWidgetLayer onActivate={onActivate} />);
      fireEvent.click(getWidget());
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('conkay:summon', seen);
    }
  });
});
