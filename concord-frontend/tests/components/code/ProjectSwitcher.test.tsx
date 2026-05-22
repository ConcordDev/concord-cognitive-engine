import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

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

import { ProjectSwitcher } from '@/components/code/ProjectSwitcher';

const PROJECTS = [
  { id: 'p1', number: '#1', name: 'Alpha', description: 'a', language: 'ts', createdAt: '2026-01-01' },
  { id: 'p2', number: '#2', name: 'Beta', description: 'b', language: 'js', createdAt: '2026-01-02' },
];

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows "No projects." when the list is empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { projects: [] } } });
    render(<ProjectSwitcher value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
  });

  it('renders a populated project select', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { projects: PROJECTS } } });
    render(<ProjectSwitcher value="p1" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('fires onChange when a project is picked from the select', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { projects: PROJECTS } } });
    const onChange = vi.fn();
    render(<ProjectSwitcher value="" onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } });
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('toggles the create form and creates a project', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { projects: [] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { project: PROJECTS[0] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { projects: PROJECTS } } });
    const onChange = vi.fn();
    const onCreated = vi.fn();
    render(<ProjectSwitcher value={null} onChange={onChange} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Project name *'), { target: { value: 'Gamma' } });
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'desc' } });
    fireEvent.change(screen.getByDisplayValue('Scaffold: Node + TypeScript'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('p1'));
    expect(onCreated).toHaveBeenCalled();
  });

  it('does nothing on create when the name is blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { projects: [] } } });
    render(<ProjectSwitcher value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Create'));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('alerts when create returns ok:false', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { projects: [] } } })
      .mockResolvedValueOnce({ data: { ok: false, error: 'name taken' } });
    render(<ProjectSwitcher value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Project name *'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('name taken'));
  });

  it('handles a list-load rejection gracefully', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('boom')));
    render(<ProjectSwitcher value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
  });
});
