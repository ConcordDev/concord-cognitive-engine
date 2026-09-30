export type InputState = {
  keys: Set<string>;
  joyX: number;
  joyY: number;
  lookX: number;
  lookY: number;
  attack: boolean;
  heavy: boolean;
  dodge: boolean;
  parry: boolean;
  interact: boolean;
  lockon: boolean;
  pause: boolean;
  special: boolean;
  power: boolean;
  jump: boolean;
};

export function createInput(): InputState {
  return {
    keys: new Set(),
    joyX: 0,
    joyY: 0,
    lookX: 0,
    lookY: 0,
    attack: false,
    heavy: false,
    dodge: false,
    parry: false,
    interact: false,
    lockon: false,
    pause: false,
    special: false,
    power: false,
    jump: false,
  };
}

function codeOf(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "w") return "KeyW";
  if (k === "a") return "KeyA";
  if (k === "s") return "KeyS";
  if (k === "d") return "KeyD";
  if (k === "e") return "KeyE";
  if (k === "g") return "KeyG";
  if (k === "1") return "Digit1";
  if (k === "f") return "KeyF";
  if (k === "q") return "KeyQ";
  if (k === "r") return "KeyR";
  if (k === "c") return "KeyC";
  if (k === "v") return "KeyV";
  if (k === " ") return "Space";
  if (k === "Escape") return "Escape";
  if (k === "Shift") return "ShiftLeft";
  if (k === "Control") return "ControlLeft";
  return e.key;
}

function isHudTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest("button, a, input, label, select, textarea, [data-hud-ui]"));
}

export function bindInput(input: InputState, el: HTMLElement) {
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let downBtn = -1;
  const down = (e: KeyboardEvent) => {
    const code = codeOf(e);
    input.keys.add(code);
    if (e.repeat) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) e.preventDefault();
    if (code === "KeyE" || code === "Enter") input.interact = true;
    if (code === "Space" || code === "KeyV") input.jump = true;
    if (code === "KeyX" || code === "KeyZ") input.dodge = true;
    if (code === "KeyF") input.parry = true;
    if (code === "KeyG") input.special = true;
    if (code === "Digit1" || code === "Numpad1") input.power = true;
    if (code === "KeyC" || code === "Tab") {
      e.preventDefault();
      input.lockon = true;
    }
    if (code === "Escape") input.pause = true;
  };
  const up = (e: KeyboardEvent) => {
    input.keys.delete(codeOf(e));
  };
  const md = (e: PointerEvent) => {
    if (isHudTarget(e.target)) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    downAt = performance.now();
    downX = e.clientX;
    downY = e.clientY;
    downBtn = e.button;
    if (document.pointerLockElement) {
      if (e.button === 0) input.attack = true;
      if (e.button === 2) input.heavy = true;
    } else if (tag === "CANVAS") {
      /* click-drag look; short click becomes attack on pointerup */
    }
  };
  const mu = (e: PointerEvent) => {
    if (isHudTarget(e.target)) return;
    if (document.pointerLockElement) return;
    if (downBtn < 0) return;
    const dt = performance.now() - downAt;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dt < 220 && dist < 8) {
      if (downBtn === 0) input.attack = true;
      if (downBtn === 2) input.heavy = true;
    }
    downBtn = -1;
  };
  const blur = () => {
    if (document.visibilityState === "hidden") input.keys.clear();
  };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  document.addEventListener("visibilitychange", blur);
  el.addEventListener("pointerdown", md);
  el.addEventListener("pointerup", mu);
  const ctx = (e: Event) => e.preventDefault();
  el.addEventListener("contextmenu", ctx);

  return () => {
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    document.removeEventListener("visibilitychange", blur);
    el.removeEventListener("pointerdown", md);
    el.removeEventListener("pointerup", mu);
    el.removeEventListener("contextmenu", ctx);
  };
}

export function consume(input: InputState) {
  input.attack = false;
  input.heavy = false;
  input.dodge = false;
  input.parry = false;
  input.interact = false;
  input.lockon = false;
  input.pause = false;
  input.special = false;
  input.power = false;
  input.jump = false;
  input.lookX = 0;
  input.lookY = 0;
}

export type InputBuffer = {
  attack: number;
  heavy: number;
  dodge: number;
  parry: number;
  jump: number;
};

export function createBuffer(): InputBuffer {
  return { attack: -1e9, heavy: -1e9, dodge: -1e9, parry: -1e9, jump: -1e9 };
}

export function latchBuffer(input: InputState, buf: InputBuffer, now: number) {
  if (input.attack) buf.attack = now;
  if (input.heavy) buf.heavy = now;
  if (input.dodge) buf.dodge = now;
  if (input.parry) buf.parry = now;
  if (input.jump) buf.jump = now;
}

export function takeBuffered(buf: InputBuffer, key: keyof InputBuffer, now: number, win = 120) {
  if (now - buf[key] <= win) {
    buf[key] = -1e9;
    return true;
  }
  return false;
}

export function moveAxes(input: InputState): { x: number; y: number } {
  let x = input.joyX;
  let y = input.joyY;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) x -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) x += 1;
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) y += 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) y -= 1;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y };
}
