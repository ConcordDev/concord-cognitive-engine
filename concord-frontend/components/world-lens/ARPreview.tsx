'use client';

import React, { useState, useCallback } from 'react';

type ScalePreset = '1:1' | '1:50' | '1:200';
type TrackingState = 'none' | 'limited' | 'normal';

interface DTUData {
  name: string;
  dimensions?: { width: number; height: number; depth: number };
  validationColors?: boolean;
}

interface ARPreviewProps {
  dtuId: string;
  dtuData: DTUData;
  onCapture?: (imageData: string) => void;
  supported?: boolean;
}

const SCALE_LABELS: Record<ScalePreset, string> = {
  '1:1': 'Real World (1:1)',
  '1:50': 'Tabletop (1:50)',
  '1:200': 'Miniature (1:200)',
};

const SCALE_FACTORS: Record<ScalePreset, number> = {
  '1:1': 1,
  '1:50': 0.02,
  '1:200': 0.005,
};

const TRACKING_COLORS: Record<TrackingState, string> = {
  none: 'bg-red-500',
  limited: 'bg-yellow-500',
  normal: 'bg-green-500',
};

const TRACKING_LABELS: Record<TrackingState, string> = {
  none: 'No Tracking',
  limited: 'Limited Tracking',
  normal: 'Tracking Active',
};

export default function ARPreview({ dtuId, dtuData, onCapture, supported = true }: ARPreviewProps) {
  const [sessionActive, setSessionActive] = useState(false);
  const [scale, setScale] = useState<ScalePreset>('1:50');
  const [trackingState, setTrackingState] = useState<TrackingState>('none');
  const [placed, setPlaced] = useState(false);
  const [measurementMode, setMeasurementMode] = useState(false);
  const [validationOverlay, setValidationOverlay] = useState(false);
  const [showGestureHints, setShowGestureHints] = useState(true);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const panelStyle = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

  const dims = dtuData.dimensions ?? { width: 10, height: 15, depth: 8 };
  const factor = SCALE_FACTORS[scale];
  const scaledDims = {
    width: (dims.width * factor).toFixed(2),
    height: (dims.height * factor).toFixed(2),
    depth: (dims.depth * factor).toFixed(2),
  };

  const handleStartAR = useCallback(() => {
    setPermissionRequested(true);
    // Simulate permission grant + session start
    setTimeout(() => {
      setSessionActive(true);
      setTrackingState('limited');
      setTimeout(() => setTrackingState('normal'), 2000);
    }, 1000);
  }, []);

  const handleEndAR = useCallback(() => {
    setSessionActive(false);
    setTrackingState('none');
    setPlaced(false);
    setPermissionRequested(false);
    setShowGestureHints(true);
  }, []);

  const handlePlace = useCallback(() => {
    setPlaced(true);
    setShowGestureHints(true);
    setTimeout(() => setShowGestureHints(false), 5000);
  }, []);

  const handleCapture = useCallback(() => {
    setCapturing(true);
    setTimeout(() => {
      setCapturing(false);
      const mockImageData = `data:image/png;base64,AR_CAPTURE_${dtuId}_${Date.now()}`;
      onCapture?.(mockImageData);
    }, 500);
  }, [dtuId, onCapture]);

  // Not supported fallback
  if (!supported) {
    return (
      <div className={`${panelStyle} p-6 flex flex-col items-center gap-4 max-w-md mx-auto`}>
        <div className="text-4xl">📱</div>
        <h2 className="text-lg font-bold text-white">AR Not Supported</h2>
        <p className="text-sm text-white/50 text-center">
          WebXR is not available on this device. Scan the QR code below to open on a supported mobile device.
        </p>
        <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center p-2">
          <div className="w-full h-full border-2 border-black rounded grid grid-cols-5 grid-rows-5 gap-0.5 p-2">
            {Array.from({ length: 25 }).map((_, i) => (
              <div
                key={i}
                className={`rounded-sm ${
                  [0, 1, 2, 4, 5, 6, 10, 12, 14, 18, 20, 22, 23, 24].includes(i)
                    ? 'bg-black'
                    : 'bg-white'
                }`}
              />
            ))}
          </div>
        </div>
        <p className="text-xs text-white/30">concordia.world/ar/{dtuId}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      {/* Header */}
      <div className={`${panelStyle} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">AR Preview</h2>
            <p className="text-sm text-white/50">{dtuData.name}</p>
          </div>
          {/* Tracking Indicator */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${TRACKING_COLORS[trackingState]} ${
              trackingState === 'normal' ? 'animate-pulse' : ''
            }`} />
            <span className="text-xs text-white/50">{TRACKING_LABELS[trackingState]}</span>
          </div>
        </div>
      </div>

      {/* AR Viewport / Launch */}
      {!sessionActive ? (
        <div className={`${panelStyle} p-8 flex flex-col items-center gap-4`}>
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
            <span className="text-4xl">🥽</span>
          </div>
          <p className="text-sm text-white/60 text-center max-w-xs">
            Project this DTU into your physical space using augmented reality.
          </p>
          <button
            onClick={handleStartAR}
            disabled={permissionRequested && !sessionActive}
            className="px-6 py-3 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50"
          >
            {permissionRequested ? 'Requesting Permission...' : 'View in AR'}
          </button>
        </div>
      ) : (
        <div className={`${panelStyle} overflow-hidden relative`}>
          {/* Simulated AR View */}
          <div className="w-full h-80 bg-gradient-to-b from-gray-900 to-gray-800 relative flex items-center justify-center">
            {/* Grid floor */}
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: 'linear-gradient(rgba(0,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.3) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
              transform: 'perspective(500px) rotateX(60deg)',
              transformOrigin: 'bottom center',
            }} />

            {!placed ? (
              /* Tap to place overlay */
              <div className="z-10 text-center animate-pulse">
                <div className="w-16 h-16 border-2 border-cyan-400/60 rounded-full mx-auto flex items-center justify-center">
                  <div className="w-3 h-3 bg-cyan-400 rounded-full" />
                </div>
                <p className="text-sm text-cyan-300 mt-3 font-medium">Tap a surface to place</p>
                <p className="text-xs text-white/40 mt-1">Point your device at a flat surface</p>
              </div>
            ) : (
              /* Placed DTU representation */
              <div className="z-10 text-center">
                <div className={`w-32 h-40 border-2 rounded-lg mx-auto flex flex-col items-center justify-center transition-all ${
                  validationOverlay
                    ? 'border-green-400/60 bg-gradient-to-b from-green-500/20 to-yellow-500/20'
                    : 'border-cyan-400/40 bg-cyan-400/10'
                }`}>
                  <span className="text-3xl">🏗️</span>
                  <span className="text-xs text-white/60 mt-2">{dtuData.name}</span>
                  {measurementMode && (
                    <div className="mt-2 text-[10px] text-cyan-300 space-y-0.5">
                      <div>W: {scaledDims.width}m</div>
                      <div>H: {scaledDims.height}m</div>
                      <div>D: {scaledDims.depth}m</div>
                    </div>
                  )}
                </div>
                {validationOverlay && (
                  <div className="mt-2 flex gap-1 justify-center">
                    <span className="w-3 h-3 rounded-sm bg-green-500" title="Low stress" />
                    <span className="w-3 h-3 rounded-sm bg-yellow-500" title="Medium stress" />
                    <span className="w-3 h-3 rounded-sm bg-green-500" title="Low stress" />
                    <span className="w-3 h-3 rounded-sm bg-green-400" title="Low stress" />
                  </div>
                )}
              </div>
            )}

            {/* Gesture Hints */}
            {placed && showGestureHints && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-6 z-20">
                <div className="text-center">
                  <div className="text-2xl">🤏</div>
                  <p className="text-[10px] text-white/50 mt-1">Pinch to Scale</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl">👆</div>
                  <p className="text-[10px] text-white/50 mt-1">Drag to Rotate</p>
                </div>
              </div>
            )}

            {/* Capture flash */}
            {capturing && (
              <div className="absolute inset-0 bg-white/80 z-30 animate-pulse" />
            )}
          </div>

          {/* Click to place handler */}
          {!placed && (
            <button
              onClick={handlePlace}
              className="absolute inset-0 w-full h-80 cursor-crosshair z-10 bg-transparent"
              aria-label="Tap to place DTU"
            />
          )}
        </div>
      )}

      {/* Controls */}
      {sessionActive && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Scale Selector */}
          <div className={`${panelStyle} p-4`}>
            <h3 className="text-xs text-white/50 uppercase tracking-wider mb-2">Scale</h3>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(SCALE_LABELS) as ScalePreset[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={`px-3 py-2 rounded text-sm text-left transition-all ${
                    scale === s
                      ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
                      : 'bg-white/5 text-white/60 border border-white/10 hover:border-white/20'
                  }`}
                >
                  {SCALE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles & Actions */}
          <div className={`${panelStyle} p-4 flex flex-col gap-3`}>
            <h3 className="text-xs text-white/50 uppercase tracking-wider mb-1">Options</h3>

            <label className="flex items-center justify-between text-sm text-white/70 cursor-pointer">
              <span>Measurement Mode</span>
              <div
                onClick={() => setMeasurementMode(!measurementMode)}
                className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${
                  measurementMode ? 'bg-cyan-500' : 'bg-white/20'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${
                  measurementMode ? 'left-5' : 'left-0.5'
                }`} />
              </div>
            </label>

            <label className="flex items-center justify-between text-sm text-white/70 cursor-pointer">
              <span>Validation Overlay</span>
              <div
                onClick={() => setValidationOverlay(!validationOverlay)}
                className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${
                  validationOverlay ? 'bg-cyan-500' : 'bg-white/20'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${
                  validationOverlay ? 'left-5' : 'left-0.5'
                }`} />
              </div>
            </label>

            <div className="flex gap-2 mt-2">
              <button
                onClick={handleCapture}
                disabled={!placed || capturing}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-white/10 text-white/70 hover:bg-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {capturing ? 'Capturing...' : '📸 Screenshot'}
              </button>
              <button
                onClick={handleEndAR}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all"
              >
                End AR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AR Session Info */}
      {sessionActive && placed && (
        <div className={`${panelStyle} p-4`}>
          <h3 className="text-xs text-white/50 uppercase tracking-wider mb-2">Session Info</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-white/40 text-xs">DTU</p>
              <p className="text-white/80 truncate">{dtuData.name}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs">Scale</p>
              <p className="text-white/80">{scale}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs">Dimensions</p>
              <p className="text-white/80 text-xs mt-0.5">
                {scaledDims.width} x {scaledDims.height} x {scaledDims.depth}m
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
