export type Juice = {
  trauma: number;
  hitstop: number;
  flash: number;
  punch: number;
  timeScale: number;
};

export function createJuice(): Juice {
  return { trauma: 0, hitstop: 0, flash: 0, punch: 0, timeScale: 1 };
}

export function addTrauma(j: Juice, t: number) {
  j.trauma = Math.min(1, j.trauma + t);
}

export function addHitstop(j: Juice, ms: number) {
  j.hitstop = Math.max(j.hitstop, ms / 1000);
}

export function tickJuice(j: Juice, dt: number, reduced: boolean) {
  if (j.hitstop > 0) {
    j.hitstop = Math.max(0, j.hitstop - dt);
    j.timeScale = 0;
  } else {
    j.timeScale = 1;
  }
  j.trauma = Math.max(0, j.trauma - dt * 1.8);
  j.flash = Math.max(0, j.flash - dt * 4);
  j.punch = Math.max(0, j.punch - dt * 6);
  if (reduced) {
    j.trauma = 0;
    j.punch = 0;
  }
}

export function shakeOffset(j: Juice, t: number, enabled: boolean): { x: number; y: number } {
  if (!enabled) return { x: 0, y: 0 };
  const s = j.trauma * j.trauma;
  return {
    x: (Math.sin(t * 47.2) * 0.12 + Math.sin(t * 19.1) * 0.05) * s,
    y: (Math.cos(t * 41.7) * 0.08 + Math.sin(t * 13.3) * 0.04) * s,
  };
}
