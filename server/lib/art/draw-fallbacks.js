// server/lib/art/draw-fallbacks.js
//
// Hand-built drawings used only when the model's composition fails (no
// reply, unparseable, or too sparse to be a picture). Same SVG-like shape
// format the model emits, on the 1000 x 625 board. Each one reads as its
// subject at a glance; anything unmatched gets a simple landscape with the
// subject written on it, never a random shape passed off as the subject.

const sky = (top = "#bfe3ff") => ({ type: "rect", x: 0, y: 0, w: 1000, h: 625, fill: top });
const ground = (color = "#7fb069", y = 470) => ({ type: "rect", x: 0, y, w: 1000, h: 625 - y, fill: color });

const CAR = {
  background: "#eaf4fb",
  layers: [
    { name: "Background", shapes: [sky("#dff0fb"), ground("#9aa5ad", 470), { type: "rect", x: 0, y: 500, w: 1000, h: 8, fill: "#ffffff", opacity: 0.7 }] },
    { name: "Body", shapes: [
      { type: "ellipse", cx: 515, cy: 470, rx: 380, ry: 16, fill: "#000000", opacity: 0.18 },
      { type: "path", d: "M140 440 C138 405 160 388 205 380 L320 366 C365 318 420 290 500 287 L600 288 C665 291 712 322 752 362 L835 376 C875 384 895 405 895 437 L895 452 C895 461 888 466 878 466 L157 466 C146 466 140 459 140 450 Z", fill: "#d62828", stroke: "#2b2d42", strokeWidth: 4 },
      { type: "path", d: "M350 364 C385 322 430 304 490 302 L490 364 Z", fill: "#a8dadc", stroke: "#2b2d42", strokeWidth: 3 },
      { type: "path", d: "M510 302 L592 303 C640 306 678 330 712 364 L510 364 Z", fill: "#a8dadc", stroke: "#2b2d42", strokeWidth: 3 },
      { type: "line", x1: 500, y1: 366, x2: 500, y2: 455, stroke: "#2b2d42", strokeWidth: 3 },
      { type: "line", x1: 330, y1: 400, x2: 860, y2: 400, stroke: "#9d0208", strokeWidth: 3, opacity: 0.6 },
      { type: "rect", x: 425, y: 382, w: 34, h: 7, rx: 3, fill: "#2b2d42" },
      { type: "rect", x: 540, y: 382, w: 34, h: 7, rx: 3, fill: "#2b2d42" },
      { type: "ellipse", cx: 872, cy: 410, rx: 16, ry: 10, fill: "#ffd166", stroke: "#2b2d42", strokeWidth: 2 },
      { type: "rect", x: 140, y: 400, w: 16, h: 24, fill: "#9d0208" },
      { type: "rect", x: 132, y: 440, w: 60, h: 14, rx: 6, fill: "#495057" },
      { type: "rect", x: 840, y: 440, w: 62, h: 14, rx: 6, fill: "#495057" },
    ] },
    { name: "Wheels", shapes: [300, 735].flatMap((cx) => [
      { type: "circle", cx, cy: 462, r: 62, fill: "#2b2d42" },
      { type: "circle", cx, cy: 462, r: 54, fill: "#1b1b1e" },
      { type: "circle", cx, cy: 462, r: 30, fill: "#ced4da", stroke: "#6c757d", strokeWidth: 3 },
      { type: "circle", cx, cy: 462, r: 9, fill: "#6c757d" },
    ]) },
  ],
};

const HOUSE = {
  background: "#bfe3ff",
  layers: [
    { name: "Background", shapes: [sky(), { type: "circle", cx: 840, cy: 110, r: 55, fill: "#ffd60a" }, ground()] },
    { name: "House", shapes: [
      { type: "rect", x: 330, y: 300, w: 340, h: 200, fill: "#f4e1c1", stroke: "#5c4033", strokeWidth: 4 },
      { type: "polygon", points: [[300, 305], [500, 160], [700, 305]], fill: "#b23a48", stroke: "#5c4033", strokeWidth: 4 },
      { type: "rect", x: 470, y: 390, w: 70, h: 110, fill: "#7b4a2a", stroke: "#5c4033", strokeWidth: 3 },
      { type: "circle", cx: 527, cy: 448, r: 5, fill: "#ffd60a" },
      { type: "rect", x: 365, y: 335, w: 75, h: 65, fill: "#a8dadc", stroke: "#5c4033", strokeWidth: 3 },
      { type: "rect", x: 570, y: 335, w: 75, h: 65, fill: "#a8dadc", stroke: "#5c4033", strokeWidth: 3 },
      { type: "line", x1: 402, y1: 335, x2: 402, y2: 400, stroke: "#5c4033", strokeWidth: 2 },
      { type: "line", x1: 607, y1: 335, x2: 607, y2: 400, stroke: "#5c4033", strokeWidth: 2 },
      { type: "rect", x: 600, y: 190, w: 40, h: 75, fill: "#8d5524", stroke: "#5c4033", strokeWidth: 3 },
    ] },
  ],
};

const TREE = {
  background: "#bfe3ff",
  layers: [
    { name: "Background", shapes: [sky(), ground()] },
    { name: "Tree", shapes: [
      { type: "path", d: "M470 480 L478 330 L522 330 L530 480 Z", fill: "#7b4a2a", stroke: "#4a2c17", strokeWidth: 3 },
      { type: "circle", cx: 500, cy: 250, r: 120, fill: "#2a9d55" },
      { type: "circle", cx: 410, cy: 300, r: 80, fill: "#238b45" },
      { type: "circle", cx: 590, cy: 300, r: 80, fill: "#238b45" },
      { type: "circle", cx: 500, cy: 170, r: 80, fill: "#41ab5d" },
    ] },
  ],
};

const FLOWER = {
  background: "#e9f5db",
  layers: [
    { name: "Background", shapes: [sky("#e9f5db"), ground("#90be6d", 520)] },
    { name: "Flower", shapes: [
      { type: "path", d: "M500 520 C495 440 505 380 500 300", stroke: "#2d6a4f", strokeWidth: 10 },
      { type: "path", d: "M500 440 C450 420 430 380 440 360 C470 370 495 400 500 440 Z", fill: "#52b788" },
      ...[0, 60, 120, 180, 240, 300].map((a) => {
        const t = (a * Math.PI) / 180;
        return { type: "ellipse", cx: 500 + Math.cos(t) * 55, cy: 230 + Math.sin(t) * 55, rx: 45, ry: 45, fill: "#f72585" };
      }),
      { type: "circle", cx: 500, cy: 230, r: 40, fill: "#ffd60a", stroke: "#e09f3e", strokeWidth: 4 },
    ] },
  ],
};

const SUN_LANDSCAPE = {
  background: "#ffd6a5",
  layers: [
    { name: "Background", shapes: [sky("#ffd6a5"), { type: "circle", cx: 500, cy: 330, r: 120, fill: "#ff9f1c" }] },
    { name: "Hills", shapes: [
      { type: "path", d: "M0 420 C200 330 350 360 500 410 C650 460 800 350 1000 380 L1000 625 L0 625 Z", fill: "#6a994e" },
      { type: "path", d: "M0 500 C250 440 450 470 600 500 C750 530 900 470 1000 480 L1000 625 L0 625 Z", fill: "#386641" },
    ] },
  ],
};

const CAT = {
  background: "#fdf0d5",
  layers: [
    { name: "Background", shapes: [sky("#fdf0d5"), ground("#e9c46a", 500)] },
    { name: "Cat", shapes: [
      { type: "path", d: "M640 470 C760 460 780 380 720 360", stroke: "#e76f51", strokeWidth: 16 },
      { type: "ellipse", cx: 540, cy: 420, rx: 130, ry: 85, fill: "#f4a261", stroke: "#6d3a1e", strokeWidth: 4 },
      { type: "polygon", points: [[365, 255], [372, 165], [425, 220]], fill: "#f4a261", stroke: "#6d3a1e", strokeWidth: 4 },
      { type: "polygon", points: [[440, 218], [492, 165], [500, 255]], fill: "#f4a261", stroke: "#6d3a1e", strokeWidth: 4 },
      { type: "circle", cx: 430, cy: 300, r: 85, fill: "#f4a261", stroke: "#6d3a1e", strokeWidth: 4 },
      { type: "ellipse", cx: 400, cy: 295, rx: 12, ry: 16, fill: "#2b2d42" },
      { type: "ellipse", cx: 462, cy: 295, rx: 12, ry: 16, fill: "#2b2d42" },
      { type: "polygon", points: [[422, 322], [440, 322], [431, 334]], fill: "#e5989b" },
      ...[-1, 1].flatMap((s) => [
        { type: "line", x1: 431 + s * 20, y1: 335, x2: 431 + s * 90, y2: 322, stroke: "#6d3a1e", strokeWidth: 2 },
        { type: "line", x1: 431 + s * 20, y1: 342, x2: 431 + s * 90, y2: 348, stroke: "#6d3a1e", strokeWidth: 2 },
      ]),
    ] },
  ],
};

const BOAT = {
  background: "#caf0f8",
  layers: [
    { name: "Background", shapes: [sky("#caf0f8"), { type: "rect", x: 0, y: 420, w: 1000, h: 205, fill: "#0077b6" }] },
    { name: "Boat", shapes: [
      { type: "path", d: "M300 400 L700 400 L640 470 L360 470 Z", fill: "#7b4a2a", stroke: "#3d2314", strokeWidth: 4 },
      { type: "rect", x: 495, y: 150, w: 10, h: 252, fill: "#3d2314" },
      { type: "polygon", points: [[505, 160], [505, 385], [660, 385]], fill: "#ffffff", stroke: "#adb5bd", strokeWidth: 3 },
      { type: "polygon", points: [[495, 190], [495, 385], [380, 385]], fill: "#f1faee", stroke: "#adb5bd", strokeWidth: 3 },
      { type: "path", d: "M0 470 C80 455 160 485 240 470 C320 455 400 485 480 470 C560 455 640 485 720 470 C800 455 880 485 1000 470", stroke: "#90e0ef", strokeWidth: 5 },
    ] },
  ],
};

const ROCKET = {
  background: "#0b132b",
  layers: [
    { name: "Background", shapes: [sky("#0b132b"), ...[[120, 90], [260, 200], [820, 120], [900, 300], [700, 60], [180, 420], [880, 480], [60, 260]].map(([cx, cy]) => ({ type: "circle", cx, cy, r: 3, fill: "#ffffff" }))] },
    { name: "Rocket", shapes: [
      { type: "path", d: "M500 90 C560 150 580 250 570 420 L430 420 C420 250 440 150 500 90 Z", fill: "#e9ecef", stroke: "#495057", strokeWidth: 4 },
      { type: "polygon", points: [[430, 340], [370, 450], [435, 420]], fill: "#d62828", stroke: "#495057", strokeWidth: 3 },
      { type: "polygon", points: [[570, 340], [630, 450], [565, 420]], fill: "#d62828", stroke: "#495057", strokeWidth: 3 },
      { type: "circle", cx: 500, cy: 230, r: 34, fill: "#48cae4", stroke: "#495057", strokeWidth: 5 },
      { type: "path", d: "M450 420 C460 500 480 540 500 580 C520 540 540 500 550 420 Z", fill: "#f77f00" },
      { type: "path", d: "M472 420 C480 470 490 500 500 525 C510 500 520 470 528 420 Z", fill: "#ffd60a" },
    ] },
  ],
};

const DOG = {
  background: "#e8f4ea",
  layers: [
    { name: "Background", shapes: [sky("#dff3e4"), ground("#8cc084", 480)] },
    { name: "Dog", shapes: [
      { type: "ellipse", cx: 500, cy: 482, rx: 230, ry: 14, fill: "#000000", opacity: 0.18 },
      { type: "path", d: "M690 330 C740 300 770 260 760 230", stroke: "#b5651d", strokeWidth: 18 },
      { type: "rect", x: 330, y: 380, w: 34, h: 100, rx: 12, fill: "#b5651d", stroke: "#5a3210", strokeWidth: 3 },
      { type: "rect", x: 620, y: 380, w: 34, h: 100, rx: 12, fill: "#b5651d", stroke: "#5a3210", strokeWidth: 3 },
      { type: "path", d: "M320 330 C320 280 380 265 480 268 L620 268 C690 270 710 310 700 360 C692 400 640 410 560 410 L400 410 C340 410 320 380 320 330 Z", fill: "#d4883a", stroke: "#5a3210", strokeWidth: 4 },
      { type: "rect", x: 370, y: 385, w: 34, h: 95, rx: 12, fill: "#d4883a", stroke: "#5a3210", strokeWidth: 3 },
      { type: "rect", x: 580, y: 385, w: 34, h: 95, rx: 12, fill: "#d4883a", stroke: "#5a3210", strokeWidth: 3 },
      { type: "path", d: "M330 310 C320 260 300 220 290 190 L360 200 C380 240 380 280 370 310 Z", fill: "#d4883a", stroke: "#5a3210", strokeWidth: 4 },
      { type: "path", d: "M215 200 C215 150 260 125 310 128 C360 131 390 165 385 210 C380 250 340 262 300 262 C250 262 215 240 215 200 Z", fill: "#d4883a", stroke: "#5a3210", strokeWidth: 4 },
      { type: "path", d: "M215 205 C190 210 168 222 170 240 C172 258 200 262 230 255 Z", fill: "#e9b872", stroke: "#5a3210", strokeWidth: 3 },
      { type: "ellipse", cx: 172, cy: 232, rx: 12, ry: 10, fill: "#2b2d42" },
      { type: "path", d: "M300 140 C330 130 350 150 345 190 C340 230 320 250 305 240 C292 220 290 170 300 140 Z", fill: "#8b4513", stroke: "#5a3210", strokeWidth: 3 },
      { type: "circle", cx: 258, cy: 185, r: 10, fill: "#2b2d42" },
      { type: "circle", cx: 261, cy: 182, r: 3, fill: "#ffffff" },
      { type: "path", d: "M190 252 C200 262 215 262 225 255", stroke: "#5a3210", strokeWidth: 3 },
      { type: "rect", x: 300, y: 255, w: 70, h: 14, rx: 6, fill: "#d62828" },
    ] },
  ],
};

const FISH = {
  background: "#90e0ef",
  layers: [
    { name: "Background", shapes: [sky("#48cae4"), { type: "rect", x: 0, y: 540, w: 1000, h: 85, fill: "#e9c46a" },
      ...[[150, 540], [820, 545]].map(([x, y]) => ({ type: "path", d: `M${x} ${y} C${x - 20} ${y - 80} ${x + 20} ${y - 140} ${x} ${y - 200}`, stroke: "#2a9d55", strokeWidth: 10 })),
      ...[[700, 150, 10], [730, 110, 7], [690, 80, 5]].map(([cx, cy, r]) => ({ type: "circle", cx, cy, r, fill: "#ffffff", opacity: 0.6, stroke: "#ffffff", strokeWidth: 2 }))] },
    { name: "Fish", shapes: [
      { type: "path", d: "M690 310 L800 230 C790 280 790 340 800 390 Z", fill: "#e76f51", stroke: "#7f2a14", strokeWidth: 4 },
      { type: "path", d: "M460 220 C500 170 570 175 600 215 Z", fill: "#e76f51", stroke: "#7f2a14", strokeWidth: 3 },
      { type: "path", d: "M260 310 C320 210 560 190 700 310 C560 430 320 410 260 310 Z", fill: "#f4a261", stroke: "#7f2a14", strokeWidth: 4 },
      { type: "path", d: "M380 245 C350 290 350 330 380 375", stroke: "#e76f51", strokeWidth: 5 },
      { type: "path", d: "M460 335 C490 360 520 365 540 350 C520 330 490 325 460 335 Z", fill: "#e76f51", stroke: "#7f2a14", strokeWidth: 2 },
      { type: "circle", cx: 320, cy: 295, r: 16, fill: "#ffffff", stroke: "#2b2d42", strokeWidth: 2 },
      { type: "circle", cx: 316, cy: 295, r: 8, fill: "#2b2d42" },
      { type: "path", d: "M268 320 C278 328 288 328 296 322", stroke: "#7f2a14", strokeWidth: 3 },
    ] },
  ],
};

const BIRD = {
  background: "#d8f3dc",
  layers: [
    { name: "Background", shapes: [sky("#cdeefd"), { type: "path", d: "M0 470 C300 455 600 470 1000 455", stroke: "#6d4c41", strokeWidth: 16 }] },
    { name: "Bird", shapes: [
      { type: "path", d: "M600 380 L760 420 L740 450 L590 405 Z", fill: "#1d4ed8", stroke: "#1e2a5a", strokeWidth: 3 },
      { type: "path", d: "M330 330 C330 240 420 210 500 240 C590 270 630 340 600 400 C570 450 470 460 410 440 C360 420 330 380 330 330 Z", fill: "#3a86ff", stroke: "#1e2a5a", strokeWidth: 4 },
      { type: "path", d: "M380 380 C380 330 420 320 460 340 C430 380 420 420 400 430 Z", fill: "#f8f9fa", opacity: 0.85 },
      { type: "path", d: "M430 300 C500 280 580 310 610 370 C540 380 470 360 430 300 Z", fill: "#1d4ed8", stroke: "#1e2a5a", strokeWidth: 3 },
      { type: "circle", cx: 360, cy: 230, r: 62, fill: "#3a86ff", stroke: "#1e2a5a", strokeWidth: 4 },
      { type: "polygon", points: [[300, 220], [250, 238], [302, 250]], fill: "#ffb703", stroke: "#a0522d", strokeWidth: 2 },
      { type: "circle", cx: 345, cy: 215, r: 10, fill: "#2b2d42" },
      { type: "circle", cx: 348, cy: 212, r: 3, fill: "#ffffff" },
      { type: "line", x1: 440, y1: 445, x2: 430, y2: 470, stroke: "#a0522d", strokeWidth: 5 },
      { type: "line", x1: 490, y1: 448, x2: 485, y2: 470, stroke: "#a0522d", strokeWidth: 5 },
    ] },
  ],
};

// [match, drawing, the drawing's main colour and its darker accent — swapped
// for the colour the request names ("a blue car")].
const FALLBACKS = [
  [/\b(?:cars?|sedans?|coupes?|hatchbacks?|suvs?|roadsters?|supercars?|sports\s*cars?|automobiles?|vehicles?|trucks?|jeeps?|taxis?|racecars?)\b/i, CAR, ["#d62828", "#9d0208"]],
  [/\b(?:cats?|kitten|kitty)\b/i, CAT, ["#f4a261", "#e76f51"]],
  [/\b(?:dogs?|pupp(?:y|ies)|retrievers?|labradors?|terriers?|poodles?|beagles?|corgis?)\b/i, DOG, ["#d4883a", "#b5651d"]],
  [/\b(?:fish|goldfish|clownfish)\b/i, FISH, ["#f4a261", "#e76f51"]],
  [/\b(?:birds?|robin|sparrow|parrot|bluebird)\b/i, BIRD, ["#3a86ff", "#1d4ed8"]],
  [/\b(?:house|home|cottage|cabin|building)\b/i, HOUSE, ["#b23a48", null]],
  [/\b(?:trees?|forest|oak|pine)\b/i, TREE, null],
  [/\b(?:flowers?|rose|tulip|daisy|sunflower)\b/i, FLOWER, ["#f72585", null]],
  [/\b(?:boats?|ship|sailboat|yacht)\b/i, BOAT, ["#7b4a2a", null]],
  [/\b(?:rockets?|spaceship|space\s*ship|shuttle)\b/i, ROCKET, ["#d62828", null]],
  [/\b(?:sunset|sunrise|landscape|hills?|sun)\b/i, SUN_LANDSCAPE, null],
];

const COLOR_WORDS = {
  red: "#d62828", blue: "#1d4ed8", navy: "#1e3a8a", green: "#2a9d55", yellow: "#f2c200", orange: "#f77f00",
  purple: "#7b2cbf", violet: "#7b2cbf", pink: "#f472b6", black: "#22223b", white: "#f8f9fa", silver: "#adb5bd",
  grey: "#6c757d", gray: "#6c757d", gold: "#d4a017", golden: "#d4a017", brown: "#8d5524", teal: "#14919b",
};

function darken(hex, f = 0.7) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function recolor(drawing, from, to) {
  const swap = new Map([[from[0], to]]);
  if (from[1]) swap.set(from[1], darken(to));
  for (const l of drawing.layers) {for (const sh of l.shapes) {
    for (const k of ["fill", "stroke"]) if (swap.has(sh[k])) sh[k] = swap.get(sh[k]);
  }}
  return drawing;
}

/** Concord's built-in drawing for this subject (recoloured if a colour is named), or a labelled landscape. */
export function fallbackDrawing(subject) {
  const s = String(subject || "");
  for (const [re, d, primary] of FALLBACKS) {
    if (!re.test(s)) continue;
    const drawing = structuredClone(d);
    const word = s.toLowerCase().match(new RegExp(`\\b(${Object.keys(COLOR_WORDS).join("|")})\\b`));
    if (primary && word && COLOR_WORDS[word[1]] !== primary[0]) recolor(drawing, primary, COLOR_WORDS[word[1]]);
    return { drawing, matched: true };
  }
  const label = s.trim().slice(0, 40) || "Sketch";
  const d = structuredClone(SUN_LANDSCAPE);
  d.layers.push({ name: "Label", shapes: [{ type: "text", x: 60, y: 90, text: label, size: 44, fill: "#2b2d42" }] });
  return { drawing: d, matched: false };
}
