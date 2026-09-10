'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Camera, Focus } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

/**
 * Camera capture — extracted from photography page.tsx.
 * Owns getUserMedia stream lifecycle; saves via SaveAsDtuButton.
 */
export function CapturePanel({ onSaved }: { onSaved?: () => void }) {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        cameraVideoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access denied:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  const snapPhoto = useCallback(() => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setCapturedImage(canvas.toDataURL('image/png'));
  }, []);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Aperture className="w-5 h-5 text-sky-400" /> Camera Capture
      </h2>
      {!cameraStream ? (
        <button
          onClick={startCamera}
          className="w-full py-3 bg-sky-500/20 border border-sky-500/30 rounded-lg text-sm hover:bg-sky-500/30 flex items-center justify-center gap-2"
        >
          <Camera className="w-4 h-4" /> Start Camera
        </button>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black">
            <video ref={cameraVideoRef} autoPlay playsInline muted className="w-full rounded-lg" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={snapPhoto}
              className="flex-1 py-2 bg-sky-500/20 border border-sky-500/30 rounded-lg text-sm hover:bg-sky-500/30 flex items-center justify-center gap-2"
            >
              <Focus className="w-4 h-4" /> Snap Photo
            </button>
            <button
              onClick={stopCamera}
              className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/30"
            >
              Stop
            </button>
          </div>
        </div>
      )}
      <canvas ref={captureCanvasRef} className="hidden" />
      {capturedImage && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Captured preview:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedImage} alt="Captured" className="w-full rounded-lg border border-white/10" />
          <div className="flex gap-2">
            <SaveAsDtuButton
              defaultContentClass="media"
              apiSource="photography-lens"
              title={`Capture ${new Date().toLocaleString()}`}
              content={`Camera capture saved from Photography lens.\nCaptured at: ${new Date().toISOString()}\nMedia type: image/png`}
              extraTags={['photography', 'capture', 'camera']}
              rawData={{
                type: 'camera-capture',
                mimeType: 'image/png',
                capturedAt: new Date().toISOString(),
                preview: capturedImage?.slice(0, 200),
              }}
              confirm
              onSaved={() => {
                setCapturedImage(null);
                onSaved?.();
              }}
              className="flex-1 !bg-green-500/20 !border !border-green-500/30 !text-sm hover:!bg-green-500/30 justify-center"
            />
            <button
              onClick={() => setCapturedImage(null)}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
