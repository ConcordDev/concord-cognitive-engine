// B6 Slice-B5 tail — FE pins for FIX-photography-007, FIX-fitness-011,
// FIX-game-design-008, FIX-tick-003 (client leg).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));

import { lensRun } from '@/lib/api/client';
import { readPhotoExif } from '@/components/photography/exif';
import { StravaGoalsPanel } from '@/components/fitness/StravaGoalsPanel';

const lensRunMock = lensRun as unknown as ReturnType<typeof vi.fn>;
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

afterEach(() => cleanup());

// ── FIX-photography-007: the upload reads the file's own EXIF ────────
function buildExifJpeg(): Uint8Array {
  // TIFF (little-endian), offsets relative to TIFF start.
  const tiff = new Uint8Array(201);
  const dv = new DataView(tiff.buffer);
  const putAscii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) tiff[off + i] = s.charCodeAt(i); tiff[off + s.length] = 0; };
  const entry = (ifd: number, i: number, tag: number, type: number, count: number, value: number) => {
    const e = ifd + 2 + i * 12;
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true); dv.setUint32(e + 8, value, true);
  };
  tiff[0] = 0x49; tiff[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  // IFD0 @8: Make "Canon" @128, Model "Canon EOS R5" @134, ExifIFD → 50
  dv.setUint16(8, 3, true);
  entry(8, 0, 0x010f, 2, 6, 128);
  entry(8, 1, 0x0110, 2, 13, 134);
  entry(8, 2, 0x8769, 4, 1, 50);
  // EXIF IFD @50
  dv.setUint16(50, 6, true);
  entry(50, 0, 0x829a, 5, 1, 147);        // ExposureTime → @147: 1/250
  entry(50, 1, 0x829d, 5, 1, 155);        // FNumber → @155: 28/10
  entry(50, 2, 0x8827, 3, 1, 400);        // ISO, SHORT inline
  entry(50, 3, 0x9003, 2, 20, 163);       // DateTimeOriginal @163
  entry(50, 4, 0x920a, 5, 1, 183);        // FocalLength → @183: 50/1
  entry(50, 5, 0xa434, 2, 10, 191);       // LensModel @191
  putAscii(128, 'Canon');
  putAscii(134, 'Canon EOS R5');
  dv.setUint32(147, 1, true); dv.setUint32(151, 250, true);
  dv.setUint32(155, 28, true); dv.setUint32(159, 10, true);
  putAscii(163, '2026:10:31 12:30:45');
  dv.setUint32(183, 50, true); dv.setUint32(187, 1, true);
  putAscii(191, 'RF 24-105');

  const app1Len = 2 + 6 + tiff.length;
  const jpeg = new Uint8Array(4 + app1Len);
  jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xe1;
  new DataView(jpeg.buffer).setUint16(4, app1Len, true);
  jpeg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6); // "Exif\0\0"
  jpeg.set(tiff, 12);
  return jpeg;
}

describe('FIX-photography-007 — EXIF reader', () => {
  it('extracts camera, lens, ISO, aperture, shutter, focal length and capture time', async () => {
    const exif = await readPhotoExif(new File([buildExifJpeg()], 'shot.jpg', { type: 'image/jpeg' }));
    expect(exif.camera).toBe('Canon EOS R5');
    expect(exif.lens).toBe('RF 24-105');
    expect(exif.iso).toBe(400);
    expect(exif.aperture).toBe(2.8);
    expect(exif.shutter).toBe('1/250');
    expect(exif.focalLength).toBe(50);
    expect(exif.takenAt).toBe('2026-10-31T12:30:45');
  });
  it('a file without EXIF yields all-null fields — nothing fabricated', async () => {
    const exif = await readPhotoExif(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'plain.jpg', { type: 'image/jpeg' }));
    expect(exif).toEqual({ camera: null, lens: null, iso: null, aperture: null, shutter: null, focalLength: null, takenAt: null });
  });
  it('the upload panel wires the reader into the payload', () => {
    const panel = src('components/photography/UploadPanel.tsx');
    expect(panel).toContain('readPhotoExif');
    expect(panel).toContain('focalLength');
    expect(panel).toContain('From the file:');
  });
});

// ── FIX-fitness-011: a double fire cannot mint duplicate rows ───────
describe('FIX-fitness-011 — Strava goals/gear in-flight guards', () => {
  let resolveAdd: ((v: unknown) => void) | null = null;
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'gear-add' || action === 'goal-create') {
        return new Promise((res) => { resolveAdd = res; });
      }
      return Promise.resolve({ data: { ok: true, result: { goals: [], records: [], gear: [] } } });
    });
  });

  it('gear Add fires gear-add once under a double click and disables in flight', async () => {
    render(<StravaGoalsPanel />);
    const nameInput = await screen.findByPlaceholderText('Name');
    fireEvent.change(nameInput, { target: { value: 'Race shoes' } });
    const addButtons = screen.getAllByRole('button', { name: /^Add$/ });
    const gearAdd = addButtons[addButtons.length - 1];
    fireEvent.click(gearAdd);
    fireEvent.click(gearAdd);
    await waitFor(() => expect(lensRunMock.mock.calls.filter((c) => c[1] === 'gear-add')).toHaveLength(1));
    expect((gearAdd as HTMLButtonElement).disabled).toBe(true);
    resolveAdd?.({ data: { ok: true, result: {} } });
  });

  it('goal Add fires goal-create once under a double click', async () => {
    render(<StravaGoalsPanel />);
    const targetInput = await screen.findByPlaceholderText('Target');
    fireEvent.change(targetInput, { target: { value: '100' } });
    const addButtons = screen.getAllByRole('button', { name: /^Add$/ });
    const goalAdd = addButtons[0];
    fireEvent.click(goalAdd);
    fireEvent.click(goalAdd);
    await waitFor(() => expect(lensRunMock.mock.calls.filter((c) => c[1] === 'goal-create')).toHaveLength(1));
    resolveAdd?.({ data: { ok: true, result: {} } });
  });
});

// ── FIX-game-design-008 / FIX-tick-003 client legs (source pins) ────
describe('FIX-game-design-008 — no deprecated THREE.Clock remains', () => {
  it('both previews run on THREE.Timer', () => {
    for (const f of ['components/game-design/BuildingPreview.tsx', 'components/game-design/CreaturePreview.tsx']) {
      const s = src(f);
      expect(s).toContain('new THREE.Timer()');
      expect(s).not.toContain('THREE.Clock');
    }
  });
});

describe('FIX-tick-003 — the monitor no longer fabricates a duration', () => {
  it('MonitorPanel sends no derived duration (the server measures real timings)', () => {
    const s = src('components/tick/MonitorPanel.tsx');
    expect(s).toContain('const tickDurationMs = 0;');
    expect(s).not.toMatch(/tickDurationMs\s*=\s*Math\.max\(0/);
  });
});
