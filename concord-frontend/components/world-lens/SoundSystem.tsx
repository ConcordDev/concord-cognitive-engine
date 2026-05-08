'use client';

import { useCallback, useRef, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

type SoundCategory = 'master' | 'music' | 'ambient' | 'sfx' | 'dialogue' | 'weather';

type SFXName =
  | 'place-dtu'
  | 'validation-pass'
  | 'validation-fail'
  | 'earn-royalty'
  | 'construction-start'
  | 'construction-loop'
  | 'construction-complete';

type MusicTrack = 'calm-exploration' | 'disaster-event' | 'competition' | 'building';

type WeatherAudio = 'rain' | 'thunder' | 'wind' | 'snow' | 'none';

type DistrictSoundscape =
  | 'forge'
  | 'academy'
  | 'docks'
  | 'commons'
  | 'exchange'
  | 'silent';

interface SoundscapeBed {
  label: string;
  layers: string[];
}

interface SoundState {
  initialized: boolean;
  currentSoundscape: DistrictSoundscape;
  currentMusic: MusicTrack | null;
  currentWeather: WeatherAudio;
  isInterior: boolean;
  activeSFX: string[];
  volumes: Record<SoundCategory, number>;
}

interface SoundSystemAPI {
  playSound: (sfx: SFXName) => void;
  setSoundscape: (districtId: string) => void;
  setMusic: (track: MusicTrack | null) => void;
  setWeather: (weather: WeatherAudio) => void;
  updateVolumes: (category: SoundCategory, value: number) => void;
  setInterior: (interior: boolean) => void;
  state: SoundState;
}

/* ── Soundscape definitions ────────────────────────────────────── */

const _SOUNDSCAPE_BEDS: Record<DistrictSoundscape, SoundscapeBed> = {
  forge: {
    label: 'The Forge',
    layers: ['hammering-rhythmic', 'furnace-roar', 'anvil-ring', 'bellows-hiss'],
  },
  academy: {
    label: 'The Academy',
    layers: ['pages-turning', 'murmuring-voices', 'quill-scratch', 'clock-tick'],
  },
  docks: {
    label: 'The Docks',
    layers: ['waves-lapping', 'seagulls-cry', 'rope-creak', 'ship-horn-distant'],
  },
  commons: {
    label: 'The Commons',
    layers: ['gentle-wind', 'fountain-splash', 'birdsong', 'footsteps-grass'],
  },
  exchange: {
    label: 'The Exchange',
    layers: ['crowd-chatter', 'coins-clinking', 'paper-shuffle', 'bell-ring'],
  },
  silent: {
    label: 'Silent',
    layers: [],
  },
};

const DISTRICT_TO_SOUNDSCAPE: Record<string, DistrictSoundscape> = {
  forge: 'forge',
  'the-forge': 'forge',
  academy: 'academy',
  'the-academy': 'academy',
  docks: 'docks',
  'the-docks': 'docks',
  commons: 'commons',
  'the-commons': 'commons',
  exchange: 'exchange',
  'the-exchange': 'exchange',
};

const CROSSFADE_MS = 200;

/* ── Hook ──────────────────────────────────────────────────────── */

let globalSoundState: SoundState = {
  initialized: false,
  currentSoundscape: 'silent',
  currentMusic: null,
  currentWeather: 'none',
  isInterior: false,
  activeSFX: [],
  volumes: {
    master: 0.8,
    music: 0.6,
    ambient: 0.7,
    sfx: 0.9,
    dialogue: 1.0,
    weather: 0.5,
  },
};

export function useSoundSystem(): SoundSystemAPI {
  const [state, setState] = useState<SoundState>(globalSoundState);
  const crossfadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureInit = useCallback(() => {
    if (!state.initialized) {
      // Lazy AudioContext initialization — in production this would call
      // new AudioContext() on first user gesture.
      setState((prev) => {
        const next = { ...prev, initialized: true };
        globalSoundState = next;
        return next;
      });
    }
  }, [state.initialized]);

  const playSound = useCallback(
    (sfx: SFXName) => {
      ensureInit();
      // Simulated: log and track active SFX
      setState((prev) => {
        const next = { ...prev, activeSFX: [...prev.activeSFX.slice(-9), sfx] };
        globalSoundState = next;
        return next;
      });
      // Auto-remove after ~500ms simulated duration
      setTimeout(() => {
        setState((prev) => {
          const next = {
            ...prev,
            activeSFX: prev.activeSFX.filter((s) => s !== sfx),
          };
          globalSoundState = next;
          return next;
        });
      }, 500);
    },
    [ensureInit],
  );

  const setSoundscape = useCallback(
    (districtId: string) => {
      ensureInit();
      const target =
        DISTRICT_TO_SOUNDSCAPE[districtId.toLowerCase()] ?? 'silent';

      if (target === state.currentSoundscape) return;

      // Crossfade: fade out current, then fade in new
      if (crossfadeTimer.current) clearTimeout(crossfadeTimer.current);

      crossfadeTimer.current = setTimeout(() => {
        setState((prev) => {
          const next = { ...prev, currentSoundscape: target };
          globalSoundState = next;
          return next;
        });
      }, CROSSFADE_MS);
    },
    [ensureInit, state.currentSoundscape],
  );

  const setMusic = useCallback(
    (track: MusicTrack | null) => {
      ensureInit();
      setState((prev) => {
        const next = { ...prev, currentMusic: track };
        globalSoundState = next;
        return next;
      });
    },
    [ensureInit],
  );

  const setWeather = useCallback(
    (weather: WeatherAudio) => {
      ensureInit();
      setState((prev) => {
        const next = { ...prev, currentWeather: weather };
        globalSoundState = next;
        return next;
      });
    },
    [ensureInit],
  );

  const updateVolumes = useCallback((category: SoundCategory, value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setState((prev) => {
      const next = {
        ...prev,
        volumes: { ...prev.volumes, [category]: clamped },
      };
      globalSoundState = next;
      return next;
    });
  }, []);

  const setInterior = useCallback(
    (interior: boolean) => {
      ensureInit();
      // Interior/exterior crossfade — in production applies low-pass filter
      // and reduces ambient volume for interior spaces.
      setState((prev) => {
        const next = { ...prev, isInterior: interior };
        globalSoundState = next;
        return next;
      });
    },
    [ensureInit],
  );

  return {
    playSound,
    setSoundscape,
    setMusic,
    setWeather,
    updateVolumes,
    setInterior,
    state,
  };
}

/* ── Component (renders nothing — manages audio state) ─────────── */

interface SoundSystemProps {
  districtId?: string;
  weather?: WeatherAudio;
  musicTrack?: MusicTrack | null;
  isInterior?: boolean;
}

export default function SoundSystem({
  districtId,
  weather,
  musicTrack,
  isInterior,
}: SoundSystemProps) {
  const { setSoundscape, setWeather, setMusic, setInterior } = useSoundSystem();

  // Sync props to sound state on each render
  const prevDistrictRef = useRef<string | undefined>();
  const prevWeatherRef = useRef<WeatherAudio | undefined>();
  const prevMusicRef = useRef<MusicTrack | null | undefined>();
  const prevInteriorRef = useRef<boolean | undefined>();

  if (districtId !== undefined && districtId !== prevDistrictRef.current) {
    prevDistrictRef.current = districtId;
    setSoundscape(districtId);
  }
  if (weather !== undefined && weather !== prevWeatherRef.current) {
    prevWeatherRef.current = weather;
    setWeather(weather);
  }
  if (musicTrack !== undefined && musicTrack !== prevMusicRef.current) {
    prevMusicRef.current = musicTrack;
    setMusic(musicTrack);
  }
  if (isInterior !== undefined && isInterior !== prevInteriorRef.current) {
    prevInteriorRef.current = isInterior;
    setInterior(isInterior);
  }

  // This component renders nothing — it only manages audio state.
  return null;
}
