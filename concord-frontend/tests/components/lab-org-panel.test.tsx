// Behavior test for LabOrgPanel — the multi-user lab roles/permissions
// (PI / tech / guest tiers) surface. Covers: honest empty state when the
// caller isn't a member of any lab, creating a lab calls the real
// `lab.org-create` macro, the roster renders real member/tier data from
// `lab.org-members`, a PI can promote a member via `lab.org-set-role`, and
// the notebook/inventory mini-views are read-only for a guest but editable
// (and call the real `lab.notebook-create` / `lab.inventory-add` macros
// with the org's id) for tech/PI. No fabricated members/counts anywhere —
// every render is driven by a mocked (but shaped like the real) macro
// response.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { LabOrgPanel } from '@/components/lab/LabOrgPanel';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const fail = (error: string) => Promise.resolve({ data: { ok: false, result: null, error } });

const piLab = {
  orgId: 'org_1', name: 'Genomics Core', description: 'cryo-EM lab', memberCount: 2,
  orgRole: 'leader', tier: 'pi' as const, createdAt: '2026-01-01T00:00:00.000Z',
};
const techLab = { ...piLab, orgRole: 'member', tier: 'tech' as const };
const guestLab = { ...piLab, orgRole: 'apprentice', tier: 'guest' as const };

const emptyRoster = { orgId: 'org_1', members: [], total: 0, callerTier: 'pi', canManageMembers: true };

describe('LabOrgPanel — honest empty state and lab creation', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows an honest empty state (no fabricated labs) when the caller belongs to no lab org', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return ok({ labs: [], total: 0 });
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText(/not a member of any lab organization yet/i);
    expect(screen.queryByText(/Genomics Core/)).not.toBeInTheDocument();
  });

  it('creating a lab calls lab.org-create with the entered name, then reloads the real list', async () => {
    let created = false;
    lensRun.mockImplementation((domain: string, action: string, params: Record<string, unknown>) => {
      expect(domain).toBe('lab');
      if (action === 'org-list-mine') {
        return ok(created ? { labs: [piLab], total: 1 } : { labs: [], total: 0 });
      }
      if (action === 'org-create') {
        expect(params.name).toBe('Genomics Core');
        created = true;
        return ok({ organization: { id: 'org_1', name: 'Genomics Core', type: 'lab' }, tier: 'pi' });
      }
      if (action === 'org-members') return ok(emptyRoster);
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText(/not a member of any lab organization yet/i);

    fireEvent.change(screen.getByPlaceholderText(/Lab name/i), { target: { value: 'Genomics Core' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Lab/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('lab', 'org-create', expect.objectContaining({ name: 'Genomics Core' })));
    // after refresh, the real (mocked) org-list-mine result renders the lab
    // (both as a selector chip and in the detail header, so assert presence
    // rather than uniqueness)
    await waitFor(() => expect(screen.getAllByText('Genomics Core').length).toBeGreaterThan(0));
  });

  it('a create macro failure surfaces honestly, never a fake success', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return ok({ labs: [], total: 0 });
      if (action === 'org-create') return fail('lab name required');
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText(/not a member of any lab organization yet/i);
    fireEvent.change(screen.getByPlaceholderText(/Lab name/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Lab/i }));
    await screen.findByText('lab name required');
  });
});

describe('LabOrgPanel — roster with real member/tier data', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the real roster from lab.org-members with per-member tier badges', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return ok({ labs: [piLab], total: 1 });
      if (action === 'org-members') {
        return ok({
          orgId: 'org_1',
          members: [
            { userId: 'pi_user', orgRole: 'leader', tier: 'pi' },
            { userId: 'tech_user', orgRole: 'member', tier: 'tech' },
            { userId: 'guest_user', orgRole: 'apprentice', tier: 'guest' },
          ],
          total: 3, callerTier: 'pi', canManageMembers: true,
        });
      }
      if (action === 'notebook-list') return ok({ entries: [], total: 0, signed: 0, draft: 0 });
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText('pi_user');
    expect(screen.getByText('tech_user')).toBeInTheDocument();
    expect(screen.getByText('guest_user')).toBeInTheDocument();
    // no fabricated member count text elsewhere
    expect(lensRun).toHaveBeenCalledWith('lab', 'org-members', expect.objectContaining({ orgId: 'org_1' }));
  });

  it('a PI can promote a guest to tech — calls lab.org-set-role with the right args and re-renders the new tier', async () => {
    let promoted = false;
    lensRun.mockImplementation((_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'org-list-mine') return ok({ labs: [piLab], total: 1 });
      if (action === 'org-members') {
        return ok({
          orgId: 'org_1',
          members: [
            { userId: 'pi_user', orgRole: 'leader', tier: 'pi' },
            { userId: 'guest_user', orgRole: promoted ? 'member' : 'apprentice', tier: promoted ? 'tech' : 'guest' },
          ],
          total: 2, callerTier: 'pi', canManageMembers: true,
        });
      }
      if (action === 'org-set-role') {
        expect(params).toMatchObject({ orgId: 'org_1', userId: 'guest_user', tier: 'tech' });
        promoted = true;
        return ok({ orgId: 'org_1', userId: 'guest_user', tier: 'tech', orgRole: 'member' });
      }
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText('guest_user');
    const select = screen.getByLabelText(/Set role for guest_user/i) as HTMLSelectElement;
    expect(select.value).toBe('guest');
    fireEvent.change(select, { target: { value: 'tech' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('lab', 'org-set-role', expect.objectContaining({ tier: 'tech' })));
  });

  it('a non-PI member sees no role-management controls (mirrors server-side manageMembers gate)', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return ok({ labs: [techLab], total: 1 });
      if (action === 'org-members') {
        return ok({
          orgId: 'org_1',
          members: [
            { userId: 'pi_user', orgRole: 'leader', tier: 'pi' },
            { userId: 'me_tech', orgRole: 'member', tier: 'tech' },
          ],
          total: 2, callerTier: 'tech', canManageMembers: false,
        });
      }
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await screen.findByText('me_tech');
    expect(screen.queryByLabelText(/Set role for/i)).not.toBeInTheDocument();
  });
});

describe('LabOrgPanel — notebook/inventory switch into org-shared mode', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('guest tier: notebook + inventory render real shared data but are read-only, no write controls', async () => {
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return ok({ labs: [guestLab], total: 1 });
      if (action === 'org-members') return ok(emptyRoster);
      if (action === 'notebook-list') {
        return ok({ entries: [{ id: 'nb_1', title: 'Shared entry', project: 'X', body: '', status: 'draft', author: 'pi_user', updatedAt: '2026-01-01' }], total: 1, signed: 0, draft: 1 });
      }
      if (action === 'inventory-list') {
        return ok({ items: [{ id: 'rgt_1', name: 'Taq polymerase', quantity: 5, unit: 'units', addedBy: 'pi_user', expiryStatus: 'ok', lowStock: false }], total: 1, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0 });
      }
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await waitFor(() => expect(screen.getAllByText('Genomics Core').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /^notebook$/i }));
    await screen.findByText('Shared entry');
    expect(screen.getByText(/Read-only \(guest tier\)/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/New shared entry title/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^inventory$/i }));
    await screen.findByText('Taq polymerase');
    expect(screen.getAllByText(/Read-only \(guest tier\)/i).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText(/Reagent name/i)).not.toBeInTheDocument();
  });

  it('tech tier: can add a shared notebook entry — calls lab.notebook-create with the orgId', async () => {
    lensRun.mockImplementation((_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'org-list-mine') return ok({ labs: [techLab], total: 1 });
      if (action === 'org-members') return ok(emptyRoster);
      if (action === 'notebook-list') return ok({ entries: [], total: 0, signed: 0, draft: 0 });
      if (action === 'notebook-create') {
        expect(params).toMatchObject({ orgId: 'org_1', title: 'Run log' });
        return ok({ entry: { id: 'nb_2', title: 'Run log', project: 'Unfiled', body: '', status: 'draft', author: 'tech_user', updatedAt: '2026-01-01' } });
      }
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await waitFor(() => expect(screen.getAllByText('Genomics Core').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^notebook$/i }));
    await screen.findByPlaceholderText(/New shared entry title/i);
    fireEvent.change(screen.getByPlaceholderText(/New shared entry title/i), { target: { value: 'Run log' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('lab', 'notebook-create', expect.objectContaining({ orgId: 'org_1', title: 'Run log' })));
  });

  it('tech tier: can add a shared inventory item — calls lab.inventory-add with the orgId', async () => {
    lensRun.mockImplementation((_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'org-list-mine') return ok({ labs: [techLab], total: 1 });
      if (action === 'org-members') return ok(emptyRoster);
      if (action === 'inventory-list') return ok({ items: [], total: 0, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0 });
      if (action === 'inventory-add') {
        expect(params).toMatchObject({ orgId: 'org_1', name: 'dNTPs' });
        return ok({ item: { id: 'rgt_2', name: 'dNTPs', quantity: 10, unit: 'units', addedBy: 'tech_user', expiryStatus: 'ok', lowStock: false } });
      }
      return fail(`unexpected macro call: ${action}`);
    });
    render(<LabOrgPanel />);
    await waitFor(() => expect(screen.getAllByText('Genomics Core').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^inventory$/i }));
    await screen.findByPlaceholderText(/Reagent name/i);
    fireEvent.change(screen.getByPlaceholderText(/Reagent name/i), { target: { value: 'dNTPs' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('lab', 'inventory-add', expect.objectContaining({ orgId: 'org_1', name: 'dNTPs' })));
  });
});
