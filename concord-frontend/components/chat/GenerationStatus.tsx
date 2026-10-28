'use client';

/**
 * Truthful generation progress (Product review F8/S8).
 *
 * The chat send path really streams: while a reply is being produced
 * the panel holds `streamingContent`. So the stage can be stated
 * honestly from state, never faked:
 *   - generating, nothing streamed yet  -> "Thinking"
 *   - generating, content streaming in  -> "Writing"
 * …plus a real elapsed clock counted from when generation started.
 * If a future serving path stops streaming, this component must be
 * revisited rather than allowed to keep claiming "Writing".
 */

import { useEffect, useRef, useState } from 'react';

export type GenerationStage = 'idle' | 'thinking' | 'writing';

export function generationStage({
  generating,
  streamingContent,
}: {
  generating: boolean;
  streamingContent: string;
}): GenerationStage {
  if (!generating) return 'idle';
  return streamingContent && streamingContent.length > 0 ? 'writing' : 'thinking';
}

export function GenerationStatus({
  generating,
  streamingContent,
}: {
  generating: boolean;
  streamingContent: string;
}) {
  const stage = generationStage({ generating, streamingContent });
  const startedAtRef = useRef<number | null>(null);
  const [elapsedS, setElapsedS] = useState(0);

  useEffect(() => {
    if (!generating) {
      startedAtRef.current = null;
      setElapsedS(0);
      return undefined;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const tick = () => {
      if (startedAtRef.current !== null) {
        setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [generating]);

  if (stage === 'idle') return null;
  return (
    <div
      className="flex items-center gap-2 px-4 lg:px-6 pb-1 text-xs text-zinc-400"
      role="status"
      aria-live="polite"
      data-testid="generation-status"
      data-stage={stage}
    >
      <span>{stage === 'thinking' ? 'Thinking' : 'Writing'}</span>
      <span aria-hidden="true">·</span>
      <span>{elapsedS}s</span>
    </div>
  );
}
