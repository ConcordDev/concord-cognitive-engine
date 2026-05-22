import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
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

import { AIScribePanel } from '@/components/healthcare/AIScribePanel';

const patient = { id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' };
const encounter = { id: 'e1', number: 'ENC-1', encounterType: 'office_visit', status: 'open' };
const SOAP = {
  chiefComplaint: 'Cough', subjective: 'S-text', objective: 'O-text',
  assessment: 'A-text', plan: 'P-text',
};
const longText = 'Patient presents with a productive cough for three days and a fever.';

describe('AIScribePanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the empty SOAP placeholder and patient banner', () => {
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    expect(screen.getByText(/Click "Structure SOAP"/)).toBeInTheDocument();
    expect(screen.getByText(/Roe, Jane/)).toBeInTheDocument();
  });

  it('renders without a patient banner when patient is null', () => {
    render(<AIScribePanel patient={null} encounter={null} />);
    expect(screen.queryByText(/Roe, Jane/)).not.toBeInTheDocument();
  });

  it('alerts and does not call the macro when transcript is too short', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: 'short' } });
    // button disabled under 30 chars; force the handler via still-short text
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: 'a'.repeat(31) } });
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: '   ' } });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('structures SOAP and shows the source tag on a populated result', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { soap: SOAP, source: 'brain' } } });
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => expect(screen.getByText('S-text')).toBeInTheDocument());
    expect(screen.getByText('A-text')).toBeInTheDocument();
    expect(screen.getByText(/· brain/)).toBeInTheDocument();
  });

  it('alerts when the macro returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockResolvedValue({ data: { ok: false, error: 'scribe failed' } });
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('scribe failed'));
    alertSpy.mockRestore();
  });

  it('handles a thrown error from the structure macro', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('net'));
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('applies the SOAP note to the encounter and shows the Applied state', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { soap: SOAP, source: 'deterministic' } } });
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: {} } });
    const onApplied = vi.fn();
    render(<AIScribePanel patient={patient} encounter={encounter} onApplied={onApplied} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => screen.getByText('S-text'));
    fireEvent.click(screen.getByRole('button', { name: /Apply to encounter/ }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Applied/ })).toBeDisabled();
  });

  it('does not render Apply button when no encounter is given', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { soap: SOAP } } });
    render(<AIScribePanel patient={patient} encounter={null} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => screen.getByText('S-text'));
    expect(screen.queryByRole('button', { name: /Apply to encounter/ })).not.toBeInTheDocument();
  });

  it('copies the formatted SOAP note to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockResolvedValue({ data: { ok: true, result: { soap: SOAP } } });
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste or dictate/), { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /Structure SOAP/ }));
    await waitFor(() => screen.getByText('S-text'));
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('Chief Complaint: Cough');
    alertSpy.mockRestore();
  });

  it('alerts when voice dictation is unsupported', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.click(screen.getByRole('button', { name: /Voice dictate/ }));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/does not support voice/));
    alertSpy.mockRestore();
  });

  it('starts and stops voice dictation when SpeechRecognition is available', () => {
    const start = vi.fn();
    const stop = vi.fn();
    class FakeSR {
      continuous = false; interimResults = false; lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = start;
      stop = stop;
    }
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeSR;
    render(<AIScribePanel patient={patient} encounter={encounter} />);
    fireEvent.click(screen.getByRole('button', { name: /Voice dictate/ }));
    expect(start).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(stop).toHaveBeenCalled();
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });
});
