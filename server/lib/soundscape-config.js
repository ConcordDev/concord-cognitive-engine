// server/lib/soundscape-config.js
//
// Per-world ambient soundscape configuration. Each world has its own
// ambient audio bed that loops while in that world.
//
// Soundscapes are CC0-sourced (freesound.org CC0, BBC Sound Effects,
// OpenGameArt.org). The system emits ambient sound events on
// player:world_enter + player:world_exit transitions.

export const WORLD_SOUNDSCAPES = {
  'concordia-hub': {
    ambient: 'moss-line-hum',
    layers: [
      { name: 'moss-line-hum',    volume: 0.20, loop: true,  src: '/audio/ambient/hub-moss-hum.mp3' },
      { name: 'distant-bell',     volume: 0.10, loop: false, intervalMs: 18000, src: '/audio/ambient/hub-distant-bell.mp3' },
      { name: 'morning-birds',    volume: 0.05, loop: false, intervalMs: 12000, src: '/audio/ambient/hub-birds.mp3' },
      { name: 'footstep-gravel',  volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-gravel.mp3' },
      { name: 'voice-babble',     volume: 0.15, loop: false, intervalMs: 25000, src: '/audio/ambient/hub-voice.mp3' },
    ],
    music: '/audio/music/hub-dawn-orchestral.mp3',
    musicVolume: 0.18,
    reverb: { kind: 'cathedral', decay: 4.0, wetness: 0.6 },
  },

  cyber: {
    ambient: 'datacenter-hum',
    layers: [
      { name: 'datacenter-hum',   volume: 0.25, loop: true,  src: '/audio/ambient/cyber-server-hum.mp3' },
      { name: 'data-stream',      volume: 0.10, loop: false, intervalMs: 8000,  src: '/audio/ambient/cyber-data-stream.mp3' },
      { name: 'glitch-burst',     volume: 0.15, loop: false, intervalMs: 30000, src: '/audio/ambient/cyber-glitch.mp3' },
      { name: 'footstep-metal',   volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-metal.mp3' },
      { name: 'emp-charge',       volume: 0.20, loop: false, intervalMs: 15000, src: '/audio/ambient/cyber-emp.mp3' },
    ],
    music: '/audio/music/cyber-synthwave.mp3',
    musicVolume: 0.22,
    reverb: { kind: 'industrial', decay: 2.0, wetness: 0.4 },
  },

  crime: {
    ambient: 'dock-wind',
    layers: [
      { name: 'dock-wind',        volume: 0.20, loop: true,  src: '/audio/ambient/crime-wind.mp3' },
      { name: 'distant-siren',    volume: 0.10, loop: false, intervalMs: 22000, src: '/audio/ambient/crime-siren.mp3' },
      { name: 'seagull-cry',      volume: 0.08, loop: false, intervalMs: 14000, src: '/audio/ambient/crime-seagull.mp3' },
      { name: 'footstep-wood',    volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-wood.mp3' },
      { name: 'smoke-cough',      volume: 0.05, loop: false, intervalMs: 45000, src: '/audio/ambient/crime-smoke.mp3' },
    ],
    music: '/audio/music/crime-noir-jazz.mp3',
    musicVolume: 0.20,
    reverb: { kind: 'warehouse', decay: 3.5, wetness: 0.5 },
  },

  fantasy: {
    ambient: 'enchanted-forest',
    layers: [
      { name: 'enchanted-forest', volume: 0.25, loop: true,  src: '/audio/ambient/fantasy-forest.mp3' },
      { name: 'birdsong',         volume: 0.10, loop: false, intervalMs: 10000, src: '/audio/ambient/fantasy-birds.mp3' },
      { name: 'distant-horn',     volume: 0.08, loop: false, intervalMs: 35000, src: '/audio/ambient/fantasy-horn.mp3' },
      { name: 'footstep-grass',   volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-grass.mp3' },
      { name: 'rune-hum',         volume: 0.12, loop: false, intervalMs: 18000, src: '/audio/ambient/fantasy-rune.mp3' },
    ],
    music: '/audio/music/fantasy-medieval-orchestral.mp3',
    musicVolume: 0.22,
    reverb: { kind: 'forest', decay: 3.0, wetness: 0.5 },
  },

  frontier: {
    ambient: 'open-prairie',
    layers: [
      { name: 'open-prairie',     volume: 0.25, loop: true,  src: '/audio/ambient/frontier-prairie.mp3' },
      { name: 'hawk-cry',         volume: 0.08, loop: false, intervalMs: 22000, src: '/audio/ambient/frontier-hawk.mp3' },
      { name: 'horse-snort',      volume: 0.05, loop: false, intervalMs: 40000, src: '/audio/ambient/frontier-horse.mp3' },
      { name: 'footstep-dirt',    volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-dirt.mp3' },
      { name: 'campfire-crackle', volume: 0.18, loop: false, intervalMs: 10000, src: '/audio/ambient/frontier-campfire.mp3' },
    ],
    music: '/audio/music/frontier-frontier-folk.mp3',
    musicVolume: 0.20,
    reverb: { kind: 'open-field', decay: 1.5, wetness: 0.2 },
  },

  superhero: {
    ambient: 'skyline-hum',
    layers: [
      { name: 'skyline-hum',      volume: 0.20, loop: true,  src: '/audio/ambient/superhero-city-hum.mp3' },
      { name: 'distant-siren',    volume: 0.10, loop: false, intervalMs: 18000, src: '/audio/ambient/superhero-siren.mp3' },
      { name: 'thunder-rumble',   volume: 0.15, loop: false, intervalMs: 25000, src: '/audio/ambient/superhero-thunder.mp3' },
      { name: 'footstep-concrete', volume: 0.30, loop: false, onStep: true,    src: '/audio/sfx/footstep-concrete.mp3' },
      { name: 'wind-gust',        volume: 0.12, loop: false, intervalMs: 15000, src: '/audio/ambient/superhero-wind.mp3' },
    ],
    music: '/audio/music/superhero-epic-orchestral.mp3',
    musicVolume: 0.22,
    reverb: { kind: 'urban', decay: 2.5, wetness: 0.4 },
  },

  'lattice-crucible': {
    ambient: 'crystal-resonance',
    layers: [
      { name: 'crystal-resonance', volume: 0.25, loop: true,  src: '/audio/ambient/lattice-crystal.mp3' },
      { name: 'void-hum',         volume: 0.15, loop: false, intervalMs: 20000, src: '/audio/ambient/lattice-void.mp3' },
      { name: 'shadow-whisper',   volume: 0.10, loop: false, intervalMs: 28000, src: '/audio/ambient/lattice-whisper.mp3' },
      { name: 'footstep-stone',   volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-stone.mp3' },
      { name: 'resonance-pulse',  volume: 0.18, loop: false, intervalMs: 12000, src: '/audio/ambient/lattice-pulse.mp3' },
    ],
    music: '/audio/music/lattice-ambient-electronic.mp3',
    musicVolume: 0.20,
    reverb: { kind: 'cavern', decay: 5.0, wetness: 0.7 },
  },

  'sovereign-ruins': {
    ambient: 'wind-over-stone',
    layers: [
      { name: 'wind-over-stone',  volume: 0.25, loop: true,  src: '/audio/ambient/sovereign-wind.mp3' },
      { name: 'refusal-pulse',    volume: 0.20, loop: false, intervalMs: 15000, src: '/audio/ambient/sovereign-pulse.mp3' },
      { name: 'distant-thunder',  volume: 0.10, loop: false, intervalMs: 35000, src: '/audio/ambient/sovereign-thunder.mp3' },
      { name: 'footstep-ruins',   volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-ruins.mp3' },
      { name: 'refusal-echo',     volume: 0.12, loop: false, intervalMs: 22000, src: '/audio/ambient/sovereign-echo.mp3' },
    ],
    music: '/audio/music/sovereign-stark-orchestral.mp3',
    musicVolume: 0.20,
    reverb: { kind: 'ruins', decay: 6.0, wetness: 0.8 },
  },

  tunya: {
    ambient: 'sun-on-grass',
    layers: [
      { name: 'sun-on-grass',     volume: 0.20, loop: true,  src: '/audio/ambient/tunya-grass.mp3' },
      { name: 'cicadas',          volume: 0.12, loop: false, intervalMs: 8000,  src: '/audio/ambient/tunya-cicadas.mp3' },
      { name: 'distant-drum',     volume: 0.08, loop: false, intervalMs: 40000, src: '/audio/ambient/tunya-drum.mp3' },
      { name: 'footstep-grass',   volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-grass.mp3' },
      { name: 'wind-mesa',        volume: 0.15, loop: false, intervalMs: 18000, src: '/audio/ambient/tunya-wind.mp3' },
    ],
    music: '/audio/music/tunya-ambient-folk.mp3',
    musicVolume: 0.18,
    reverb: { kind: 'open-field', decay: 1.5, wetness: 0.2 },
  },

  'concord-link-frontier': {
    ambient: 'link-shimmer',
    layers: [
      { name: 'link-shimmer',     volume: 0.20, loop: true,  src: '/audio/ambient/link-shimmer.mp3' },
      { name: 'keeper-footstep',  volume: 0.30, loop: false, onStep: true,     src: '/audio/sfx/footstep-stone.mp3' },
    ],
    music: '/audio/music/link-meditation.mp3',
    musicVolume: 0.15,
    reverb: { kind: 'shimmer', decay: 7.0, wetness: 0.8 },
  },
};

/**
 * Footstep variation per surface.
 */
export const FOOTSTEP_VARIATIONS = {
  gravel: ['footstep-gravel-1.mp3', 'footstep-gravel-2.mp3', 'footstep-gravel-3.mp3'],
  metal:  ['footstep-metal-1.mp3',  'footstep-metal-2.mp3',  'footstep-metal-3.mp3'],
  wood:   ['footstep-wood-1.mp3',   'footstep-wood-2.mp3',   'footstep-wood-3.mp3'],
  grass:  ['footstep-grass-1.mp3',  'footstep-grass-2.mp3',  'footstep-grass-3.mp3'],
  dirt:   ['footstep-dirt-1.mp3',   'footstep-dirt-2.mp3',   'footstep-dirt-3.mp3'],
  concrete: ['footstep-concrete-1.mp3', 'footstep-concrete-2.mp3'],
  stone:  ['footstep-stone-1.mp3',  'footstep-stone-2.mp3'],
  ruins:  ['footstep-ruins-1.mp3',  'footstep-ruins-2.mp3'],
};

export function getSoundscape(worldId) {
  return WORLD_SOUNDSCAPES[worldId] || null;
}

export default { WORLD_SOUNDSCAPES, FOOTSTEP_VARIATIONS, getSoundscape };
