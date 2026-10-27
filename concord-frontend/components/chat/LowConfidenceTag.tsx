'use client';

// LowConfidenceTag — a quiet label on a chat reply that the small local backup
// model answered because the GPU brain was offline. The server decides when
// (server/lib/answer-confidence.js) and sends the reason; this only shows it.
//
// Renders nothing unless confidence === 'low', so older messages and every
// other answer stay unchanged.

interface LowConfidenceTagProps {
  confidence?: string | null;
  reason?: string | null;
}

const LABEL = 'Low confidence, backup model';

export default function LowConfidenceTag({ confidence, reason }: LowConfidenceTagProps) {
  if (confidence !== 'low') return null;
  const title = reason || LABEL;
  return (
    <span
      title={title}
      aria-label={title}
      className="mt-1.5 inline-flex max-w-fit items-center rounded-full border border-zinc-600/60 px-2 py-0.5 text-xs text-zinc-400"
    >
      {LABEL}
    </span>
  );
}
