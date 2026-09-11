/**
 * ConKayVerticalsBar — 5 industry-vertical PROXY buttons (molecular/hospital/
 * prosthetics/studio/aero). Each runs a real API call, optionally applies a
 * returned mesh, and mints a DTU summarizing the real result. Never
 * fabricates a mint id or a "success" on a json.ok:false / thrown response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const molecularBuild = vi.fn();
const hospitalRun = vi.fn();
const prostheticsRun = vi.fn();
const studioShot = vi.fn();
const aeroPanel = vi.fn();
vi.mock('@/lib/conkay/verticals/api', () => ({
  molecularBuild: (...a: unknown[]) => molecularBuild(...a),
  hospitalRun: (...a: unknown[]) => hospitalRun(...a),
  prostheticsRun: (...a: unknown[]) => prostheticsRun(...a),
  studioShot: (...a: unknown[]) => studioShot(...a),
  aeroPanel: (...a: unknown[]) => aeroPanel(...a),
}));
const applyMesh = vi.fn();
vi.mock('@/lib/conkay/unity-bridge', () => ({ applyMesh: (...a: unknown[]) => applyMesh(...a) }));
const mintConkayArtifactDtu = vi.fn();
vi.mock('@/lib/conkay/mint-artifact-dtu', () => ({ mintConkayArtifactDtu: (...a: unknown[]) => mintConkayArtifactDtu(...a) }));

import { ConKayVerticalsBar } from './ConKayVerticalsBar';

beforeEach(() => {
  molecularBuild.mockReset();
  hospitalRun.mockReset();
  prostheticsRun.mockReset();
  studioShot.mockReset();
  aeroPanel.mockReset();
  applyMesh.mockReset();
  mintConkayArtifactDtu.mockReset().mockResolvedValue({ ok: true, id: 'dtu_abc12345' });
});

describe('ConKayVerticalsBar', () => {
  it('Molecular: calls molecularBuild("H2O") and reports the coefficient-style status line', async () => {
    molecularBuild.mockResolvedValue({ status: 200, json: { ok: true, ms: 42, proxy: { ljEnergy: 3.14159 } } });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);

    fireEvent.click(screen.getByTestId('ck-molecular-build'));
    await waitFor(() => expect(molecularBuild).toHaveBeenCalledWith('H2O'));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('LJ=3.14')));
    await waitFor(() => expect(mintConkayArtifactDtu).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vertical · Molecular', tags: expect.arrayContaining(['conkay', 'vertical', 'molecular']) }),
    ));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('dtu=dtu_abc1')));
  });

  it('Hospital: calls hospitalRun(200) and applies a real returned mesh', async () => {
    hospitalRun.mockResolvedValue({
      status: 200,
      json: { ok: true, ms: 10, mesh: { id: 'm1', color: '#fff', positions: [1, 2, 3], indices: [0, 1, 2] } },
    });
    render(<ConKayVerticalsBar />);
    fireEvent.click(screen.getByTestId('ck-hospital-run'));
    await waitFor(() => expect(hospitalRun).toHaveBeenCalledWith(200));
    await waitFor(() => expect(applyMesh).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', color: '#fff', positions: [1, 2, 3], indices: [0, 1, 2] }),
    ));
  });

  it('Prosthetics: calls prostheticsRun() and reports metrology pass/fail', async () => {
    prostheticsRun.mockResolvedValue({ status: 200, json: { ok: true, ms: 5, metrologyPass: true } });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-prosthetics-run'));
    await waitFor(() => expect(prostheticsRun).toHaveBeenCalled());
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('metrology=PASS')));
  });

  it('Studio: calls studioShot with the fixed prompt and reports the archetype', async () => {
    studioShot.mockResolvedValue({ status: 200, json: { ok: true, ms: 8, shot: { archetype: 'hero-prop' } } });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-studio-shot'));
    await waitFor(() => expect(studioShot).toHaveBeenCalledWith('steel sword hero prop'));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('shot=hero-prop')));
  });

  it('Aero: calls aeroPanel(5) and reports Cl/Cd coefficients', async () => {
    aeroPanel.mockResolvedValue({ status: 200, json: { ok: true, ms: 12, coefficients: { Cl: 0.8, Cd: 0.02 } } });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-aero-panel'));
    await waitFor(() => expect(aeroPanel).toHaveBeenCalledWith(5));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('Cl=0.8 Cd=0.02')));
  });

  it('a json.ok:false response reports the real failure reason, never a fabricated success', async () => {
    molecularBuild.mockResolvedValue({ status: 422, json: { ok: false, error: 'invalid formula' } });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-molecular-build'));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('Molecular FAIL 422: invalid formula')));
    expect(mintConkayArtifactDtu).not.toHaveBeenCalled();
  });

  it('a thrown API call reports the real error message, not a silent failure', async () => {
    molecularBuild.mockRejectedValue(new Error('backend unreachable'));
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-molecular-build'));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('Molecular error: backend unreachable')));
  });

  it('a failed mint reports the real mint error alongside the successful run status', async () => {
    molecularBuild.mockResolvedValue({ status: 200, json: { ok: true, ms: 5 } });
    mintConkayArtifactDtu.mockResolvedValue({ ok: false, error: 'quota exceeded' });
    const setWorkStatus = vi.fn();
    render(<ConKayVerticalsBar setWorkStatus={setWorkStatus} />);
    fireEvent.click(screen.getByTestId('ck-molecular-build'));
    await waitFor(() => expect(setWorkStatus).toHaveBeenCalledWith(expect.stringContaining('mint failed: quota exceeded')));
  });

  it('buttons disable while a run is in flight and re-enable after', async () => {
    let resolveRun: (v: unknown) => void = () => {};
    molecularBuild.mockReturnValue(new Promise((resolve) => { resolveRun = resolve; }));
    render(<ConKayVerticalsBar />);
    const btn = screen.getByTestId('ck-molecular-build');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    resolveRun({ status: 200, json: { ok: true, ms: 1 } });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('does not start a second run while one is already busy', async () => {
    let resolveRun: (v: unknown) => void = () => {};
    molecularBuild.mockReturnValue(new Promise((resolve) => { resolveRun = resolve; }));
    render(<ConKayVerticalsBar />);
    const btn = screen.getByTestId('ck-molecular-build');
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while busy — button is disabled, but exercise the busy guard too
    await waitFor(() => expect(molecularBuild).toHaveBeenCalledTimes(1));
    resolveRun({ status: 200, json: { ok: true, ms: 1 } });
  });
});
