import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
        const { initial: _i, animate: _a, exit: _e, transition: _t2, ...rest } = props;
        void _i; void _a; void _e; void _t2;
        return React.createElement(tag, rest, props.children);
      },
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
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

import SettingsPanel, {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from '@/components/code/SettingsPanel';

describe('SettingsPanel helpers', () => {
  beforeEach(() => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReset();
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockReset();
  });

  it('loadSettings returns defaults when nothing stored', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('loadSettings merges stored partial over defaults', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ editor: { fontSize: 22 } })
    );
    const s = loadSettings();
    expect(s.editor.fontSize).toBe(22);
    expect(s.editor.tabSize).toBe(DEFAULT_SETTINGS.editor.tabSize);
    expect(s.ai.model).toBe(DEFAULT_SETTINGS.ai.model);
  });

  it('loadSettings falls back to defaults on parse error', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings writes JSON to localStorage', () => {
    saveSettings(DEFAULT_SETTINGS);
    expect(window.localStorage.setItem).toHaveBeenCalled();
  });

  it('saveSettings swallows localStorage errors', () => {
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('SettingsPanel component', () => {
  beforeEach(() => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockReset();
  });

  it('renders nothing when closed', () => {
    render(<SettingsPanel open={false} onClose={vi.fn()} onChange={vi.fn()} />);
    expect(screen.queryByText('Code Lens Settings')).not.toBeInTheDocument();
  });

  it('renders the editor tab by default', () => {
    render(<SettingsPanel open onClose={vi.fn()} onChange={vi.fn()} />);
    expect(screen.getByText('Code Lens Settings')).toBeInTheDocument();
    expect(screen.getByText('Font size')).toBeInTheDocument();
  });

  it('updates a numeric editor field and persists', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    const fontInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(fontInput, { target: { value: '18' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].editor.fontSize).toBe(18);
  });

  it('falls back to default when a numeric field is cleared', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    const fontInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(fontInput, { target: { value: '' } });
    expect(onChange.mock.calls.at(-1)![0].editor.fontSize).toBe(14);
  });

  it('toggles a boolean setting via the switch', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    const minimapSwitch = screen.getAllByRole('switch')[0];
    fireEvent.click(minimapSwitch);
    expect(onChange).toHaveBeenCalled();
  });

  it('changes a select value', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    const wordWrap = screen.getAllByRole('combobox')[0];
    fireEvent.change(wordWrap, { target: { value: 'off' } });
    expect(onChange.mock.calls.at(-1)![0].editor.wordWrap).toBe('off');
  });

  it('switches to the AI tab and the terminal tab', () => {
    render(<SettingsPanel open onClose={vi.fn()} onChange={vi.fn()} initial={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByText('AI Pair'));
    expect(screen.getByText('Brain slot')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    fireEvent.click(screen.getByText('terminal'));
    expect(screen.getByText('Cursor style')).toBeInTheDocument();
  });

  it('updates the AI temperature range', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByText('AI Pair'));
    const range = screen.getByRole('slider');
    fireEvent.change(range, { target: { value: '0.8' } });
    expect(onChange.mock.calls.at(-1)![0].ai.temperature).toBeCloseTo(0.8);
  });

  it('resets to defaults', () => {
    const onChange = vi.fn();
    render(<SettingsPanel open onClose={vi.fn()} onChange={onChange} initial={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByText('Reset'));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(<SettingsPanel open onClose={onClose} onChange={vi.fn()} initial={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByLabelText('Close settings'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<SettingsPanel open onClose={onClose} onChange={vi.fn()} initial={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByText('Code Lens Settings').closest('[role="dialog"]')!.parentElement!);
    expect(onClose).toHaveBeenCalled();
  });
});
