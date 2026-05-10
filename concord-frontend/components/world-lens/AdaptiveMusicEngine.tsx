'use client';

/**
 * AdaptiveMusicEngine — Sprint D / EE3
 *
 * Multi-stem score layered on top of SoundscapeEngine. Loads pre-recorded
 * stems (commissioned or licensed) from /music/stems/<track_id>/{layer}.ogg
 * and crossfades layers based on gameplay state.
 *
 * Layers:
 *   - rhythm    : always playing (base groove)
 *   - harmony   : ambient pads / strings
 *   - melody    : lead motifs (combat / discovery)
 *   - percussion: tension / threat
 *   - tension   : cinematic stinger swells
 *
 * Gameplay state mapping (read from window events):
 *   - 'concordia:combat-engaged' → percussion + melody at 1.0; harmony 0.6
 *   - 'concordia:stealth' → harmony at 0.4; rhythm at 0.6; everything else 0
 *   - 'concordia:discovery' → harmony + melody swell to 0.9
 *   - 'concordia:cinematic-shot' (with music_layer) → that layer to 1.0
 *
 * Falls back gracefully when stem files are missing — players without the
 * audio install get the procedural SoundscapeEngine layer (already
 * production-grade) and don't hear silence.
 *
 * Web Audio API for crossfade control. Each stem has its own GainNode.
 */

import React, { useEffect, useRef } from 'react';

type Layer = 'rhythm' | 'harmony' | 'melody' | 'percussion' | 'tension';

interface StemSet {
  trackId: string;
  buffers: Map<Layer, AudioBuffer | null>;
  sources: Map<Layer, AudioBufferSourceNode | null>;
  gains:   Map<Layer, GainNode>;
}

interface Props {
  worldId: string;
  /** Track ID for the active region/biome — caller picks based on context. */
  trackId?: string;
  /** Master volume 0..1 (defaults to 0.6 to leave headroom for SFX/dialogue). */
  masterVolume?: number;
}

const ALL_LAYERS: Layer[] = ['rhythm', 'harmony', 'melody', 'percussion', 'tension'];

export default function AdaptiveMusicEngine({ worldId, trackId = 'concordia_hub_default', masterVolume = 0.6 }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const stemSetRef = useRef<StemSet | null>(null);

  // Init AudioContext once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
    masterGainRef.current = master;
    return () => {
      try { ctx.close(); } catch { /* noop */ }
    };
  }, [masterVolume]);

  // Update master volume.
  useEffect(() => {
    const m = masterGainRef.current;
    if (m) m.gain.linearRampToValueAtTime(masterVolume, (ctxRef.current?.currentTime ?? 0) + 0.4);
  }, [masterVolume]);

  // Load stems for the active trackId.
  useEffect(() => {
    const ctx = ctxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master) return;
    let cancelled = false;

    const load = async () => {
      const buffers = new Map<Layer, AudioBuffer | null>();
      const gains = new Map<Layer, GainNode>();
      const sources = new Map<Layer, AudioBufferSourceNode | null>();

      for (const layer of ALL_LAYERS) {
        const url = `/music/stems/${trackId}/${layer}.ogg`;
        try {
          const r = await fetch(url);
          if (!r.ok) {
            buffers.set(layer, null);
            continue;
          }
          const arrayBuf = await r.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          buffers.set(layer, audioBuf);
        } catch {
          buffers.set(layer, null);
        }
      }

      if (cancelled) return;

      // Stop any previous stems.
      const prev = stemSetRef.current;
      if (prev) {
        for (const src of prev.sources.values()) {
          try { src?.stop(); } catch { /* noop */ }
        }
      }

      // Init gains + start sources for layers that loaded.
      const startTime = ctx.currentTime + 0.05;
      for (const layer of ALL_LAYERS) {
        const gain = ctx.createGain();
        // Default mix: rhythm always on, others off.
        gain.gain.value = layer === 'rhythm' ? 0.8 : 0;
        gain.connect(master);
        gains.set(layer, gain);

        const buf = buffers.get(layer);
        if (buf) {
          const source = ctx.createBufferSource();
          source.buffer = buf;
          source.loop = true;
          source.connect(gain);
          source.start(startTime);
          sources.set(layer, source);
        } else {
          sources.set(layer, null);
        }
      }
      stemSetRef.current = { trackId, buffers, sources, gains };
    };
    void load();
    return () => { cancelled = true; };
  }, [trackId]);

  // Wire gameplay-state events to layer mixes.
  useEffect(() => {
    const apply = (mix: Partial<Record<Layer, number>>) => {
      const ctx = ctxRef.current;
      const set = stemSetRef.current;
      if (!ctx || !set) return;
      const t = ctx.currentTime;
      for (const layer of ALL_LAYERS) {
        const g = set.gains.get(layer);
        if (!g) continue;
        const target = mix[layer];
        if (typeof target === 'number') {
          g.gain.cancelScheduledValues(t);
          g.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, target)), t + 0.6);
        }
      }
    };

    const onCombat = () => apply({ rhythm: 0.9, percussion: 1.0, melody: 1.0, harmony: 0.6, tension: 0.4 });
    const onStealth = () => apply({ rhythm: 0.6, percussion: 0, melody: 0, harmony: 0.4, tension: 0 });
    const onDiscovery = () => apply({ rhythm: 0.7, percussion: 0, melody: 0.9, harmony: 0.9, tension: 0.2 });
    const onCalm = () => apply({ rhythm: 0.8, percussion: 0, melody: 0.3, harmony: 0.7, tension: 0 });
    const onCinematicShot = (e: Event) => {
      const detail = (e as CustomEvent<{ music_layer?: string }>).detail;
      if (!detail?.music_layer) return;
      const layer = detail.music_layer as Layer;
      if (ALL_LAYERS.includes(layer)) apply({ [layer]: 1.0 });
    };
    const onCinematicEnd = () => onCalm();

    window.addEventListener('concordia:combat-engaged', onCombat);
    window.addEventListener('concordia:stealth', onStealth);
    window.addEventListener('concordia:discovery', onDiscovery);
    window.addEventListener('concordia:calm', onCalm);
    window.addEventListener('concordia:cinematic-shot', onCinematicShot);
    window.addEventListener('concordia:cinematic-end', onCinematicEnd);
    return () => {
      window.removeEventListener('concordia:combat-engaged', onCombat);
      window.removeEventListener('concordia:stealth', onStealth);
      window.removeEventListener('concordia:discovery', onDiscovery);
      window.removeEventListener('concordia:calm', onCalm);
      window.removeEventListener('concordia:cinematic-shot', onCinematicShot);
      window.removeEventListener('concordia:cinematic-end', onCinematicEnd);
    };
  }, []);

  void worldId;
  return null;
}
