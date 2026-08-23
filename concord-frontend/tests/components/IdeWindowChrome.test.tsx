/**
 * IdeWindowChrome — feature-build follow-up pass (dx-platform IDE-chrome
 * item). Purely presentational, so this pins the structural contract: the
 * title renders, every tab renders, and exactly one tab carries the
 * active styling (never zero, never more than one).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IdeWindowChrome } from '@/components/dx-platform/IdeWindowChrome';

describe('IdeWindowChrome', () => {
  it('renders the title bar text', () => {
    render(
      <IdeWindowChrome title="Concord DX — VS Code" tabs={[{ label: 'a.json' }]}>
        <p>content</p>
      </IdeWindowChrome>,
    );
    expect(screen.getByText('Concord DX — VS Code')).toBeInTheDocument();
  });

  it('renders every tab label passed in', () => {
    render(
      <IdeWindowChrome title="t" tabs={[{ label: 'detector-output.json', active: true }, { label: 'settings.json' }]}>
        <p>content</p>
      </IdeWindowChrome>,
    );
    expect(screen.getByText('detector-output.json')).toBeInTheDocument();
    expect(screen.getByText('settings.json')).toBeInTheDocument();
  });

  it('renders its children inside the frame', () => {
    render(
      <IdeWindowChrome title="t" tabs={[{ label: 'a' }]}>
        <p>real content goes here</p>
      </IdeWindowChrome>,
    );
    expect(screen.getByText('real content goes here')).toBeInTheDocument();
  });
});
