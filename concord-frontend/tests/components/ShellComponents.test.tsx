import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { CodeEditorShell, type FileTreeNode, type OpenTab } from '@/components/code/CodeEditorShell';
import { WalletShell, type WalletAsset, type WalletTx } from '@/components/crypto/WalletShell';
import { DocsShell, type DocNode } from '@/components/legal/DocsShell';
import { WhiteboardCanvas } from '@/components/whiteboard/WhiteboardCanvas';
import { EHRShell, type EHRPatient, type VitalSet } from '@/components/healthcare/EHRShell';

describe('CodeEditorShell', () => {
  const files: FileTreeNode[] = [
    { id: 'a', name: 'app.tsx', kind: 'file' },
    { id: 'b', name: 'lib', kind: 'folder', children: [
      { id: 'b1', name: 'util.ts', kind: 'file' },
    ] },
  ];
  const openTabs: OpenTab[] = [
    { id: 'a', label: 'app.tsx' },
    { id: 'b1', label: 'util.ts', modified: true },
  ];

  it('renders open tabs and editor children', () => {
    render(
      <CodeEditorShell files={files} openTabs={openTabs} activeTabId="a">
        <div data-testid="editor">code goes here</div>
      </CodeEditorShell>
    );
    expect(screen.getAllByText('app.tsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('util.ts').length).toBeGreaterThan(0);
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('calls onSelectTab when a tab strip entry is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <CodeEditorShell files={files} openTabs={openTabs} activeTabId="a" onSelectTab={onSelectTab}>
        <div />
      </CodeEditorShell>
    );
    // Tab strip entry is a clickable div (not a button) — find it via the close-button aria.
    const closeBtn = screen.getByLabelText('Close util.ts');
    const tabRow = closeBtn.parentElement!;
    fireEvent.click(tabRow);
    expect(onSelectTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });
});

describe('WalletShell', () => {
  const assets: WalletAsset[] = [
    { id: 'cc', symbol: 'CC', name: 'Concord Coin', amount: 1240, fiatValue: 1240 },
    { id: 'btc', symbol: 'BTC', name: 'Bitcoin', amount: 0.012, fiatValue: 720, changePct: 2.4 },
  ];
  const txs: WalletTx[] = [
    { id: 't1', kind: 'receive', asset: 'CC', amount: 50, timestamp: new Date().toISOString() },
  ];

  it('renders all assets', () => {
    render(<WalletShell totalFiat={1960} assets={assets} txs={txs} />);
    expect(screen.getByText('Concord Coin')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
  });
});

describe('DocsShell', () => {
  const tree: DocNode[] = [
    { id: 'a', title: 'Privacy Policy', kind: 'doc' },
    { id: 'b', title: 'Terms', kind: 'folder', children: [
      { id: 'b1', title: 'NDA', kind: 'doc' },
    ] },
  ];

  it('renders the doc tree titles', () => {
    render(
      <DocsShell tree={tree} activeDocId="a" title="Privacy Policy">
        <div data-testid="editor">doc body</div>
      </DocsShell>
    );
    expect(screen.getAllByText('Privacy Policy').length).toBeGreaterThan(0);
    expect(screen.getByText('Terms')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });
});

describe('WhiteboardCanvas', () => {
  it('renders a canvas + tool buttons without crashing', () => {
    const { container } = render(<WhiteboardCanvas />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });
});

describe('EHRShell', () => {
  const patient: EHRPatient = {
    id: 'p1', name: 'Test Patient', age: 42, sex: 'F', mrn: 'MRN-001',
    allergies: ['penicillin'],
    alerts: ['Fall risk'],
  };
  const vitals: VitalSet = { bp: '120/80', hr: 72, tempF: 98.6, spo2: 98, resp: 14 };

  const encounters = [
    { id: 'e1', date: '2026-05-08', reason: 'Annual physical', provider: 'Dr. Vex' },
  ];

  it('renders patient name + mrn + alerts', () => {
    render(
      <EHRShell patient={patient} vitals={vitals} encounters={encounters} activeEncounterId="e1">
        <div data-testid="chart-body">notes</div>
      </EHRShell>
    );
    expect(screen.getByText('Test Patient')).toBeInTheDocument();
    expect(screen.getByText(/MRN-001/)).toBeInTheDocument();
    expect(screen.getByText(/Fall risk/)).toBeInTheDocument();
    expect(screen.getByTestId('chart-body')).toBeInTheDocument();
  });

  it('renders vitals values', () => {
    render(
      <EHRShell patient={patient} vitals={vitals} encounters={encounters} activeEncounterId="e1">
        <div />
      </EHRShell>
    );
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });
});
