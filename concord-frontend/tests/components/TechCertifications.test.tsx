import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { TechCertifications } from '@/components/plumbing/TechCertifications';
import type { Certification } from '@/components/plumbing/TechCertifications';

const CERTS: Certification[] = [
  {
    id: 'cert_1', name: 'Master Plumber License', issuingBody: 'State Board of Plumbing Examiners',
    licenseNumber: 'MP-44201', issueDate: '2022-01-15', expiryDate: '2099-01-15', isExpired: false,
  },
  {
    id: 'cert_2', name: 'Backflow Prevention Certification', issuingBody: 'American Backflow Prevention Association',
    licenseNumber: '', issueDate: null, expiryDate: '2000-01-01', isExpired: true,
  },
];

describe('TechCertifications', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders a collapsed summary with count and expired count, and does not show cert details', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={CERTS} onChanged={() => {}} />);
    expect(screen.getByText(/Certifications \(2, 1 expired\)/)).toBeInTheDocument();
    expect(screen.queryByText('Master Plumber License')).not.toBeInTheDocument();
  });

  it('expanding shows each certification with issuing body, license number, and expiry', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={CERTS} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications/));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Master Plumber License')).toBeInTheDocument();
    expect(within(items[0]).getByText(/State Board of Plumbing Examiners.*MP-44201.*exp 2099-01-15/)).toBeInTheDocument();
    expect(within(items[1]).getByText('Backflow Prevention Certification')).toBeInTheDocument();
  });

  it('an expired certification carries a visible EXPIRED badge; a non-expired one does not', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={CERTS} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications/));
    const badges = screen.getAllByText('EXPIRED');
    expect(badges).toHaveLength(1);
  });

  it('empty state: renders a named "no certifications" message when the list is empty', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications \(0\)/));
    expect(screen.getByText(/No certifications on file for Riley/)).toBeInTheDocument();
  });

  it('offers a real certification-category picker, not a JSON textarea', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications \(0\)/));
    expect(screen.queryByRole('textbox', { name: /json/i })).not.toBeInTheDocument();
    const select = screen.getByLabelText('Certification type') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toContain('Gas Fitting License');
  });

  it('adding a certification calls techCertAdd with the picked category + issuing body, then notifies onChanged', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { certification: { id: 'cert_new' } }, error: null },
    });
    const onChanged = vi.fn();
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={[]} onChanged={onChanged} />);
    fireEvent.click(screen.getByText(/Certifications \(0\)/));

    fireEvent.change(screen.getByLabelText('Certification type'), { target: { value: 'Gas Fitting License' } });
    fireEvent.change(screen.getByPlaceholderText('Issuing body'), { target: { value: 'State Gas Board' } });
    fireEvent.change(screen.getByPlaceholderText('License #'), { target: { value: 'GF-99' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Add Certification'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('plumbing', 'techCertAdd', {
      techId: 'tech_1', name: 'Gas Fitting License', issuingBody: 'State Gas Board',
      licenseNumber: 'GF-99', issueDate: undefined, expiryDate: undefined,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('picking "Other" reveals a free-text certification-name field', () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications \(0\)/));
    expect(screen.queryByPlaceholderText('Certification name')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Certification type'), { target: { value: 'Other' } });
    expect(screen.getByPlaceholderText('Certification name')).toBeInTheDocument();
  });

  it('rejects adding without an issuing body (shows an inline error, does not call the API)', async () => {
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByText(/Certifications \(0\)/));
    await act(async () => {
      fireEvent.click(screen.getByText('Add Certification'));
    });
    expect(screen.getByText('Issuing body required')).toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('removing a certification calls techCertRemove with the techId/certId pair, then notifies onChanged', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { removed: 'cert_1' }, error: null } });
    const onChanged = vi.fn();
    render(<TechCertifications techId="tech_1" techName="Riley" certifications={CERTS} onChanged={onChanged} />);
    fireEvent.click(screen.getByText(/Certifications/));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Remove Master Plumber License certification'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('plumbing', 'techCertRemove', { techId: 'tech_1', certId: 'cert_1' });
    expect(onChanged).toHaveBeenCalled();
  });
});
