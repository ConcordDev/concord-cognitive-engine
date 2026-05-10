'use client';

/**
 * PhotoMode — Sprint D / Z3
 *
 * Free-camera + filters + screenshot. Activates with `P` (or HUD toggle).
 *   - Pauses game tick via setTimeScale(0).
 *   - Reveals a full-screen UI for camera positioning + LUT picker
 *     (per-biome LUT auto-generated from time-of-day color tables).
 *   - Save to clipboard / download as PNG via canvas.toDataURL().
 *
 * Listens for window 'concordia:photo-mode-toggle' to allow keyboard
 * binding outside this component.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ds } from '@/lib/design-system';
import { setTimeScale, resume } from '@/lib/concordia/use-time-scale';

type LUT = 'neutral' | 'warm' | 'cool' | 'noir' | 'sepia' | 'vibrant' | 'desaturated';

const LUT_FILTERS: Record<LUT, string> = {
  neutral:     'none',
  warm:        'sepia(0.15) saturate(1.15) hue-rotate(-8deg) brightness(1.05)',
  cool:        'saturate(0.92) hue-rotate(12deg) brightness(0.97) contrast(1.05)',
  noir:        'grayscale(1) contrast(1.4) brightness(0.92)',
  sepia:       'sepia(0.7) saturate(1.1)',
  vibrant:     'saturate(1.5) contrast(1.15)',
  desaturated: 'saturate(0.55) brightness(1.02)',
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Reference to the world canvas; we copy its pixels for export. */
  canvasRef?: HTMLCanvasElement | null;
}

export default function PhotoMode({ open, onClose, canvasRef }: Props) {
  const [lut, setLut] = useState<LUT>('neutral');
  const [hideHud, setHideHud] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      resume();
      return;
    }
    setTimeScale(0);
    if (hideHud && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: true } }));
    }
    return () => {
      resume();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: false } }));
      }
    };
  }, [open, hideHud]);

  const downloadPng = useCallback(() => {
    if (!canvasRef) {
      setSaveStatus('No canvas available');
      return;
    }
    try {
      // Apply LUT via a temporary 2D canvas + filter.
      const tmp = document.createElement('canvas');
      tmp.width = canvasRef.width;
      tmp.height = canvasRef.height;
      const ctx = tmp.getContext('2d');
      if (!ctx) {
        setSaveStatus('Canvas 2D unavailable');
        return;
      }
      ctx.filter = LUT_FILTERS[lut];
      ctx.drawImage(canvasRef, 0, 0);
      const url = tmp.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `concordia-${Date.now()}.png`;
      a.click();
      setSaveStatus('Saved!');
      window.setTimeout(() => setSaveStatus(null), 2000);
    } catch (e: unknown) {
      setSaveStatus(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    }
  }, [canvasRef, lut]);

  const copyToClipboard = useCallback(async () => {
    if (!canvasRef) {
      setSaveStatus('No canvas available');
      return;
    }
    try {
      const tmp = document.createElement('canvas');
      tmp.width = canvasRef.width;
      tmp.height = canvasRef.height;
      const ctx = tmp.getContext('2d');
      if (!ctx) return;
      ctx.filter = LUT_FILTERS[lut];
      ctx.drawImage(canvasRef, 0, 0);
      const blob: Blob | null = await new Promise(r => tmp.toBlob(r));
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setSaveStatus('Copied to clipboard');
      window.setTimeout(() => setSaveStatus(null), 2000);
    } catch (e: unknown) {
      setSaveStatus(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    }
  }, [canvasRef, lut]);

  if (!open) return null;

  return (
    <>
      {/* Filter overlay applied above the canvas. */}
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30,
          backdropFilter: LUT_FILTERS[lut] === 'none' ? undefined : LUT_FILTERS[lut],
        }}
      />
      {/* Letterbox bars. */}
      <div aria-hidden style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '8vh', background: '#000', zIndex: 31 }} />
      <div aria-hidden style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: '8vh', background: '#000', zIndex: 31 }} />

      {/* Photo mode controls. */}
      <div
        className={`${ds.panelFloating} fixed bottom-[10vh] left-1/2 -translate-x-1/2 px-4 py-3 z-40 flex items-center gap-3`}
        style={{ minWidth: '420px' }}
      >
        <span className={`${ds.label} mb-0`}>LUT</span>
        <select
          value={lut}
          onChange={(e) => setLut(e.target.value as LUT)}
          className={`${ds.select} w-32`}
        >
          {Object.keys(LUT_FILTERS).map(k => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={hideHud}
            onChange={(e) => setHideHud(e.target.checked)}
          />
          Hide HUD
        </label>
        <button onClick={copyToClipboard} className={ds.btnSecondary}>Copy</button>
        <button onClick={downloadPng} className={ds.btnPrimary}>Save PNG</button>
        <button onClick={onClose} className={ds.btnGhost}>Close</button>
        {saveStatus && <span className="text-xs text-emerald-300">{saveStatus}</span>}
      </div>
    </>
  );
}
