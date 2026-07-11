// Wave 4 gap-closure: `label-update` (server/domains/projects.js
// registerLensAction "label-update" — rename/recolor an existing label) had
// no caller anywhere; label create/delete were wired but not edit. Pins that
// PjSettingsPanel's new inline label editor calls the real macro with the
// edited name + color.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { PjSettingsPanel } from '@/components/projects/PjSettingsPanel';

const label = { id: 'lbl_1', name: 'bug', color: 'red' };

function mockDefault() {
  lensRun.mockImplementation((domain: string, action: string) => {
    if (domain !== 'projects') return Promise.resolve({ data: { ok: true, result: null } });
    if (action === 'label-list') return Promise.resolve({ data: { ok: true, result: { labels: [label], count: 1 } } });
    if (action === 'custom-field-list') return Promise.resolve({ data: { ok: true, result: { fields: [], count: 0 } } });
    if (action === 'rule-list') return Promise.resolve({ data: { ok: true, result: { rules: [], count: 0 } } });
    if (action === 'template-list') return Promise.resolve({ data: { ok: true, result: { templates: [], count: 0 } } });
    if (action === 'label-update') return Promise.resolve({ data: { ok: true, result: { label: { ...label, name: 'critical-bug', color: 'violet' } } } });
    return Promise.resolve({ data: { ok: true, result: null } });
  });
}

describe('PjSettingsPanel — label-update', () => {
  beforeEach(() => lensRun.mockReset());

  it('edit → rename + recolor → save calls the real label-update macro with the edited fields', async () => {
    mockDefault();
    render(<PjSettingsPanel projectId="proj_1" onChange={() => {}} />);

    const editButton = await screen.findByRole('button', { name: /Edit label bug/i });
    fireEvent.click(editButton);

    const nameInput = screen.getByDisplayValue('bug');
    fireEvent.change(nameInput, { target: { value: 'critical-bug' } });
    fireEvent.click(screen.getByLabelText('Set label color violet'));

    fireEvent.click(screen.getByLabelText('Save label'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'projects', 'label-update', { id: 'lbl_1', name: 'critical-bug', color: 'violet' },
    ));
  });

  it('cancel edit does not call label-update', async () => {
    mockDefault();
    render(<PjSettingsPanel projectId="proj_1" onChange={() => {}} />);

    const editButton = await screen.findByRole('button', { name: /Edit label bug/i });
    fireEvent.click(editButton);
    fireEvent.click(screen.getByLabelText('Cancel edit'));

    expect(lensRun).not.toHaveBeenCalledWith('projects', 'label-update', expect.anything());
    expect(await screen.findByRole('button', { name: /Edit label bug/i })).toBeInTheDocument();
  });
});
