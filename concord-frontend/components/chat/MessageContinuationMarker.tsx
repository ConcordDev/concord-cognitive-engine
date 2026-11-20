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
    <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--nb-muted,#9ca3af)] mt-1 mb-0.5">
      <span className="text-[color:var(--nb-faint,#374151)]">↳</span>
      <span>
        {wasSynthesized && shadowsUsed && shadowsUsed > 0
          ? `synthesized from ${shadowsUsed} reasoning ${shadowsUsed === 1 ? 'shadow' : 'shadows'}`
          : 'extended reasoning'}
      </span>
    </div>
  );
}
