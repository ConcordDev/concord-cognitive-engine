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
  if (k === " ") return "Space";
  if (k === "Escape") return "Escape";
  if (k === "Shift") return "ShiftLeft";
  return e.key;
}

export function bindInput(input: InputState, el: HTMLElement) {
  const down = (e: KeyboardEvent) => {
    const code = codeOf(e);
    input.keys.add(code);
    if (e.repeat) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) e.preventDefault();
    if (code === "KeyE" || code === "Enter") input.interact = true;
    if (code === "Space") input.dodge = true;
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
    const t = e.target as HTMLElement | null;
    if (t?.closest("button, a, input, label")) return;
    if (e.button === 0) input.attack = true;
    if (e.button === 2) input.heavy = true;
  };
  const blur = () => {
    if (document.visibilityState === "hidden") input.keys.clear();
  };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  document.addEventListener("visibilitychange", blur);
  el.addEventListener("pointerdown", md);
  const ctx = (e: Event) => e.preventDefault();
  el.addEventListener("contextmenu", ctx);

  return () => {
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    document.removeEventListener("visibilitychange", blur);
    el.removeEventListener("pointerdown", md);
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
  input.lookX = 0;
  input.lookY = 0;
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
