/**
 * AudioContext unlock utility.
 *
 * Browsers require a user gesture before AudioContext can transition from
 * 'suspended' to 'running'. This module is the single source of truth for
 * how every audio subsystem (DAW engine, SoundscapeEngine, music player,
 * voice pipeline, etc.) handles the unlock — so they all behave the same
 * across the 175 lenses.
 */

import { useEffect, useState } from 'react';

export function isAudioUnlocked(ctx: AudioContext | null | undefined): boolean {
  return !!ctx && ctx.state === 'running';
}

export async function resumeAudioContext(
  ctx: AudioContext | null | undefined,
): Promise<boolean> {
  if (!ctx || ctx.state === 'closed') return false;
  if (ctx.state === 'running') return true;
  try {
    await ctx.resume();
    return (ctx.state as AudioContextState) === 'running';
  } catch {
    return false;
  }
}

export function useAudioUnlock(ctx: AudioContext | null | undefined): boolean {
  const [unlocked, setUnlocked] = useState<boolean>(isAudioUnlocked(ctx));

  useEffect(() => {
    if (!ctx) {
      setUnlocked(false);
      return;
    }
    const update = () => setUnlocked(isAudioUnlocked(ctx));
    update();
    ctx.addEventListener('statechange', update);
    return () => ctx.removeEventListener('statechange', update);
  }, [ctx]);

  return unlocked;
}
