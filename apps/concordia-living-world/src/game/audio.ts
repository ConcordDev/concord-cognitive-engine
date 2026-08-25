let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfx: GainNode | null = null;
let music: GainNode | null = null;
let muted = false;
let ambientTimer = 0;
let droneStarted = false;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    sfx = ctx.createGain();
    music = ctx.createGain();
    sfx.gain.value = 0.7;
    music.gain.value = 0.22;
    master.gain.value = 0.85;
    sfx.connect(master);
    music.connect(master);
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function setMuted(v: boolean) {
  muted = v;
  if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 0.85, ctx.currentTime, 0.03);
}

export function isMuted() {
  return muted;
}

function bus() {
  return sfx;
}

function now() {
  return ctx?.currentTime ?? 0;
}

function envGain(g: GainNode, a: number, s: number, rel: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(a, t + s);
  g.gain.exponentialRampToValueAtTime(0.0001, t + s + rel);
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, detune = 0) {
  if (!ctx || !bus()) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(g);
  g.connect(bus()!);
  envGain(g, vol, 0.01, dur);
  o.start();
  o.stop(now() + dur + 0.05);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

function noise(dur: number, vol: number, hp = 400, lp = 1800) {
  if (!ctx || !bus()) return;
  const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = n;
  const g = ctx.createGain();
  const hi = ctx.createBiquadFilter();
  const lo = ctx.createBiquadFilter();
  hi.type = "highpass";
  hi.frequency.value = hp;
  lo.type = "lowpass";
  lo.frequency.value = lp;
  src.connect(hi);
  hi.connect(lo);
  lo.connect(g);
  g.connect(bus()!);
  envGain(g, vol, 0.005, dur * 0.8);
  src.start();
  src.stop(now() + dur);
}

export function sfxFoot(rate = 1, kind: "stone" | "ash" | "dirt" | "grass" | "metal" | "mud" = "dirt") {
  if (kind === "ash") {
    noise(0.09, 0.1 * rate, 70, 420);
    return;
  }
  if (kind === "metal") {
    noise(0.05, 0.08 * rate, 600, 2800);
    tone(180 * rate, 0.04, "square", 0.03);
    return;
  }
  if (kind === "mud") {
    noise(0.11, 0.14 * rate, 60, 380);
    return;
  }
  if (kind === "stone") {
    noise(0.06, 0.13 * rate, 180, 900);
    return;
  }
  if (kind === "grass") {
    noise(0.05, 0.08 * rate, 250, 1100);
    return;
  }
  noise(0.07, 0.12 * rate, 120, 700);
}

export function sfxLand(heavy: boolean) {
  noise(heavy ? 0.16 : 0.09, heavy ? 0.22 : 0.12, 80, 500);
  tone(heavy ? 70 : 110, 0.08, "sine", heavy ? 0.06 : 0.035);
}

export function sfxSwing(heavy: boolean) {
  noise(heavy ? 0.16 : 0.08, heavy ? 0.22 : 0.14, 200, heavy ? 900 : 1600);
  tone(heavy ? 90 : 140, 0.12, "sawtooth", heavy ? 0.08 : 0.05);
}

export function sfxHit(momentum: number) {
  const m = Math.max(0.3, Math.min(1.6, momentum / 8));
  noise(0.12, 0.28 * m, 180, 2200);
  tone(110 * m, 0.1, "square", 0.07 * m, (Math.random() * 2 - 1) * 40);
}

export function sfxParry() {
  tone(880, 0.18, "triangle", 0.16);
  tone(1320, 0.12, "sine", 0.1);
  noise(0.06, 0.1, 2000, 6000);
}

export function sfxDodge() {
  noise(0.14, 0.16, 400, 2400);
  tone(220, 0.1, "sine", 0.05);
}

export function sfxIframe() {
  tone(1480, 0.08, "sine", 0.07);
}

export function sfxUi() {
  tone(520, 0.06, "sine", 0.05);
}

export function sfxScheme() {
  tone(392, 0.25, "sine", 0.08);
  tone(494, 0.28, "sine", 0.06);
}

export function sfxFlower() {
  tone(523, 0.4, "sine", 0.07);
  tone(659, 0.45, "triangle", 0.05);
}

export function sfxWin() {
  tone(392, 0.2, "triangle", 0.1);
  tone(523, 0.28, "triangle", 0.09);
  tone(659, 0.35, "sine", 0.08);
}

export function sfxHurt() {
  tone(80, 0.18, "sawtooth", 0.1);
  noise(0.12, 0.18, 100, 600);
}

export function sfxStagger(kind: "flinch" | "rocked" | "knockdown" | "graze") {
  if (kind === "knockdown") {
    noise(0.22, 0.32, 60, 500);
    tone(55, 0.2, "sine", 0.12);
    return;
  }
  if (kind === "rocked") {
    noise(0.14, 0.22, 90, 700);
    tone(70, 0.12, "sawtooth", 0.08);
    return;
  }
  noise(0.08, 0.14, 140, 900);
}

export function tickAmbient(dt: number) {
  if (!ctx || !music) return;
  ambientTimer += dt;
  if (ambientTimer > 4.8 + Math.random() * 3) {
    ambientTimer = 0;
    const notes = [196, 247, 294, 330, 392];
    const f = notes[Math.floor(Math.random() * notes.length)]!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g);
    g.connect(music);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.start();
    o.stop(t + 3.4);
  }
}

export function startDrone() {
  if (droneStarted || !ctx || !music) return;
  droneStarted = true;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = 55;
  o.connect(g);
  g.connect(music);
  g.gain.value = 0.04;
  o.start();
}
