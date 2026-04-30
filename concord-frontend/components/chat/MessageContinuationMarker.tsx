'use client';

interface MessageContinuationMarkerProps {
  shadowsUsed?: number;
  wasSynthesized?: boolean;
}

export function MessageContinuationMarker({
  shadowsUsed,
  wasSynthesized,
}: MessageContinuationMarkerProps) {
  if (!wasSynthesized && (!shadowsUsed || shadowsUsed === 0)) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-gray-600 mt-1 mb-0.5">
      <span className="text-gray-700">↳</span>
      <span>
        {wasSynthesized && shadowsUsed && shadowsUsed > 0
          ? `synthesized from ${shadowsUsed} reasoning ${shadowsUsed === 1 ? 'shadow' : 'shadows'}`
          : 'extended reasoning'}
      </span>
    </div>
  );
}
