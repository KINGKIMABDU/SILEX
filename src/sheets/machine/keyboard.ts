// Keyboards drawn key by key, with legends printed from a shared texture atlas.
import * as THREE from 'three';
import { Part, slab, ink } from '../../core/ink';
import { trackColor } from '../../core/theme';

/** [code, legend, width in units, shifted legend] */
type K = [string, string, number?, string?];

export interface KeyDef {
  code: string;
  label: string;
  shift?: string;
  /** position of the key's top-left corner and size, in mm, relative to the keyboard's top-left */
  x: number;
  z: number;
  w: number;
  d: number;
  row: number;
  col: number;
  /** keycap outline: square (default), round, or a hexagon with flat top and bottom */
  shape?: 'round' | 'hex';
}

const MAIN: K[][] = [
  [['Backquote', '`', 1, '~'], ['Digit1', '1', 1, '!'], ['Digit2', '2', 1, '@'], ['Digit3', '3', 1, '#'], ['Digit4', '4', 1, '$'], ['Digit5', '5', 1, '%'], ['Digit6', '6', 1, '^'], ['Digit7', '7', 1, '&'], ['Digit8', '8', 1, '*'], ['Digit9', '9', 1, '('], ['Digit0', '0', 1, ')'], ['Minus', '-', 1, '_'], ['Equal', '=', 1, '+'], ['Backspace', 'backspace', 1.5]],
  [['Tab', 'tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '[', 1, '{'], ['BracketRight', ']', 1, '}'], ['Backslash', '\\', 1, '|']],
  [['CapsLock', 'caps lock', 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';', 1, ':'], ['Quote', "'", 1, '"'], ['Enter', 'enter', 1.75]],
  [['ShiftLeft', 'shift', 2.25], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ',', 1, '<'], ['Period', '.', 1, '>'], ['Slash', '/', 1, '?'], ['ShiftRight', 'shift', 2.25]],
];

const FROW: K[] = [['Escape', 'esc'], ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12'], ['Delete', 'del']];

/** The two keyboards, laid out key by key from top-down review photographs (US layouts). */
export function layout(kind: 'ultrabook' | 'gaming'): { keys: KeyDef[]; w: number; d: number } {
  return kind === 'gaming' ? gaming() : ultrabook();
}

type Push = (code: string, label: string, x: number, z: number, w: number, d: number, row: number, col: number, shift?: string, shape?: KeyDef['shape']) => void;

function pusher(keys: KeyDef[], gap: number): Push {
  return (code, label, x, z, w, d, row, col, shift, shape) => keys.push({ code, label, shift, x: x + gap / 2, z: z + gap / 2, w: w - gap, d: d - gap, row, col, shape });
}

/** The ultrabook: 18.0 mm pitch, half-height function row, a compressed numeric pad with the fingerprint power key. */
function ultrabook() {
  const keys: KeyDef[] = [];
  const P = 18.0, gap = 2.4, fH = P * 0.58, mainW = 14.5 * P;
  const push = pusher(keys, gap);
  let z = 0;
  FROW.forEach(([c, l], i) => push(c, l, i * (mainW / 14), z, mainW / 14, fH, 1, i));
  z += fH;
  MAIN.forEach((row, ri) => {
    let x = 0;
    row.forEach(([c, l, wu = 1, sh], ci) => {
      push(c, l, x, z, wu * P, P, ri + 2, ci, sh);
      x += wu * P;
    });
    z += P;
  });
  // bottom row: the AI assistant key takes the place of the right Ctrl
  const bottom: K[] = [['ControlLeft', 'ctrl', 1.25], ['Fn', 'fn'], ['MetaLeft', 'win'], ['AltLeft', 'alt'], ['Space', '', 5.25], ['AltRight', 'alt'], ['Copilot', 'ai']];
  let x = 0;
  bottom.forEach(([c, l, wu = 1], ci) => {
    push(c, l, x, z, wu * P, P, 6, ci);
    x += wu * P;
  });
  // arrows: left and right full height, up and down halved
  const ax = mainW - 3 * P;
  push('ArrowLeft', '←', ax, z + P / 2, P, P / 2, 6, 10);
  push('ArrowUp', '↑', ax + P, z, P, P / 2, 6, 11);
  push('ArrowDown', '↓', ax + P, z + P / 2, P, P / 2, 6, 12);
  push('ArrowRight', '→', ax + 2 * P, z + P / 2, P, P / 2, 6, 13);
  z += P;
  const pp = 14.8;
  const x0 = mainW + 5;
  const pad: [string, string, number, number, number, number][] = [
    ['Home', 'home', 0, 0, 1, 0], ['End', 'end', 1, 0, 1, 0], ['PageUp', 'pg up', 2, 0, 1, 0], ['Power', 'power', 3, 0, 1, 0],
    ['NumLock', 'num', 0, 1, 1, 1], ['NumpadDivide', '/', 1, 1, 1, 1], ['NumpadMultiply', '*', 2, 1, 1, 1], ['NumpadSubtract', '−', 3, 1, 1, 1],
    ['Numpad7', '7', 0, 2, 1, 1], ['Numpad8', '8', 1, 2, 1, 1], ['Numpad9', '9', 2, 2, 1, 1], ['NumpadAdd', '+', 3, 2, 1, 2],
    ['Numpad4', '4', 0, 3, 1, 1], ['Numpad5', '5', 1, 3, 1, 1], ['Numpad6', '6', 2, 3, 1, 1],
    ['Numpad1', '1', 0, 4, 1, 1], ['Numpad2', '2', 1, 4, 1, 1], ['Numpad3', '3', 2, 4, 1, 1], ['NumpadEnter', 'enter', 3, 4, 1, 2],
    ['Numpad0', '0', 0, 5, 2, 1], ['NumpadDecimal', '.', 2, 5, 1, 1],
  ];
  for (const [c, l, col, row, wu, hu] of pad) {
    const zz = row === 0 ? 0 : fH + (row - 1) * P;
    const d = row === 0 ? fH : hu * P;
    push(c, l, x0 + col * pp, zz, wu * pp, d, row + 1, 14 + col);
  }
  return { keys, w: x0 + 4 * pp, d: z };
}

/**
 * The gaming keyboard: 18.9 mm pitch, sixteen columns. A row of five hotkeys and a hexagonal power button
 * sit above function keys grouped in fours; a media column runs down the right edge, the arrows are full
 * size, and Print Screen and the AI assistant key follow the right Alt.
 */
function gaming() {
  const keys: KeyDef[] = [];
  const P = 18.9, gap = 2.6, fH = P * 0.6;
  const push = pusher(keys, gap);
  const W = 16 * P;
  // hotkeys, above the 2 to 6 keys
  const hk: [string, string][] = [['VolumeDown', 'vol-'], ['VolumeUp', 'vol+'], ['MicMute', 'mic'], ['FanMode', 'fan'], ['Armoury', 'app']];
  hk.forEach(([c, l], i) => push(c, l, P * 2.05 + i * P * 0.98, 0, P * 0.98, fH * 0.86, 0, i));
  push('Power', 'power', 15 * P + P * 0.04, -1.2, P * 0.92, P * 0.92, 0, 15, undefined, 'hex');
  let z = fH * 0.86 + 3.4;
  // function row: Esc, three groups of four, Delete over the media column
  push('Escape', 'esc', 0, z, P, fH, 1, 0);
  for (let i = 0; i < 12; i++) {
    const g = Math.floor(i / 4);
    push(`F${i + 1}`, `F${i + 1}`, P * 1.5 + (i % 4) * P + g * (4 * P + P * 0.25), z, P, fH, 1, i + 1);
  }
  push('Delete', 'del', 15 * P, z, P, fH, 1, 15);
  z += fH + 1.2;
  const rows: K[][] = [
    [['Backquote', '`', 1, '~'], ['Digit1', '1', 1, '!'], ['Digit2', '2', 1, '@'], ['Digit3', '3', 1, '#'], ['Digit4', '4', 1, '$'], ['Digit5', '5', 1, '%'], ['Digit6', '6', 1, '^'], ['Digit7', '7', 1, '&'], ['Digit8', '8', 1, '*'], ['Digit9', '9', 1, '('], ['Digit0', '0', 1, ')'], ['Minus', '-', 1, '_'], ['Equal', '=', 1, '+'], ['Backspace', '⟵', 2], ['MediaPlayPause', 'play']],
    [['Tab', '⇥', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '[', 1, '{'], ['BracketRight', ']', 1, '}'], ['Backslash', '\\', 1.5, '|'], ['MediaStop', 'stop']],
    [['CapsLock', '⇪', 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';', 1, ':'], ['Quote', "'", 1, '"'], ['Enter', '↵', 2.25], ['MediaTrackPrevious', 'prev']],
    [['ShiftLeft', '⇧', 2.25], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ',', 1, '<'], ['Period', '.', 1, '>'], ['Slash', '/', 1, '?'], ['ShiftRight', '⇧', 1.75], ['ArrowUp', '↑'], ['MediaTrackNext', 'next']],
  ];
  rows.forEach((row, ri) => {
    let x = 0;
    row.forEach(([c, l, wu = 1, sh], ci) => {
      // the media column is set slightly apart from the main block
      const xx = c.startsWith('Media') ? 15 * P : x;
      push(c, l, xx, z, wu * P, P, ri + 2, ci, sh);
      x += wu * P;
    });
    z += P;
  });
  const bottom: K[] = [['ControlLeft', 'ctrl', 1.25], ['Fn', 'fn'], ['MetaLeft', 'win'], ['AltLeft', 'alt'], ['Space', '', 5.75], ['AltRight', 'alt'], ['PrintScreen', 'prt sc'], ['Copilot', 'ai']];
  let x = 0;
  bottom.forEach(([c, l, wu = 1], ci) => {
    push(c, l, x, z, wu * P, P, 6, ci);
    x += wu * P;
  });
  push('ArrowLeft', '←', 13 * P, z, P, P, 6, 13);
  push('ArrowDown', '↓', 14 * P, z, P, P, 6, 14);
  push('ArrowRight', '→', 15 * P, z, P, P, 6, 15);
  z += P;
  return { keys, w: W, d: z };
}

// ---------- legends ----------

const CELL = 128;
const COLS = 16;


type Icon = (g: CanvasRenderingContext2D) => void;
const line = (g: CanvasRenderingContext2D, w: number, pts: [number, number][], close = false) => {
  g.lineWidth = w;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
  g.stroke();
};
const arrowHead = (g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, s = 12) => {
  const px = -dy, py = dx;
  line(g, 7, [[x - dx * s + px * s * 0.8, y - dy * s + py * s * 0.8], [x, y], [x - dx * s - px * s * 0.8, y - dy * s - py * s * 0.8]]);
};
const speaker = (g: CanvasRenderingContext2D) => {
  g.beginPath();
  g.moveTo(26, 54);
  g.lineTo(40, 54);
  g.lineTo(58, 38);
  g.lineTo(58, 90);
  g.lineTo(40, 74);
  g.lineTo(26, 74);
  g.closePath();
  g.fill();
};

/**
 * Keycap glyphs. The system key carries a neutral outline rather than any maker's logo, and the
 * AI assistant key is lettered "ai": SILEX reproduces no logos or marks.
 */
const ICONS: Record<string, Icon> = {
  MetaLeft: (g) => {
    // a plain rounded square with a dot: the system key, without a logo
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(42, 42, 44, 44, 9);
    g.stroke();
    g.beginPath();
    g.arc(64, 64, 6, 0, Math.PI * 2);
    g.fill();
  },
  PowerButton: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 68, 28, -Math.PI * 0.32, Math.PI * 1.32);
    g.stroke();
    line(g, 8, [[64, 28], [64, 64]]);
  },
  Power: (g) => {
    // the fingerprint reader under the ultrabook's power key
    g.lineWidth = 4;
    for (let r = 10; r <= 34; r += 8) {
      g.beginPath();
      g.ellipse(64, 66, r * 0.8, r, 0, Math.PI * 0.85, Math.PI * 2.15);
      g.stroke();
    }
  },
  Backspace: (g) => {
    line(g, 7, [[96, 64], [30, 64]]);
    arrowHead(g, 30, 64, -1, 0, 14);
  },
  Tab: (g) => {
    line(g, 7, [[28, 64], [92, 64]]);
    arrowHead(g, 92, 64, 1, 0, 14);
    line(g, 7, [[100, 44], [100, 84]]);
  },
  CapsLock: (g) => {
    line(g, 6, [[64, 30], [96, 62], [80, 62], [80, 84], [48, 84], [48, 62], [32, 62]], true);
    line(g, 6, [[48, 98], [80, 98]]);
  },
  ShiftLeft: (g) => line(g, 6, [[64, 30], [96, 64], [80, 64], [80, 96], [48, 96], [48, 64], [32, 64]], true),
  ShiftRight: (g) => line(g, 6, [[64, 30], [96, 64], [80, 64], [80, 96], [48, 96], [48, 64], [32, 64]], true),
  Enter: (g) => {
    line(g, 7, [[96, 36], [96, 76], [32, 76]]);
    arrowHead(g, 32, 76, -1, 0, 14);
  },
  MediaPlayPause: (g) => {
    g.beginPath();
    g.moveTo(30, 40);
    g.lineTo(62, 64);
    g.lineTo(30, 88);
    g.closePath();
    g.fill();
    g.fillRect(74, 40, 9, 48);
    g.fillRect(90, 40, 9, 48);
  },
  MediaStop: (g) => g.fillRect(42, 42, 44, 44),
  ArrowLeft: (g) => {
    line(g, 8, [[96, 64], [32, 64]]);
    arrowHead(g, 32, 64, -1, 0, 18);
  },
  ArrowRight: (g) => {
    line(g, 8, [[32, 64], [96, 64]]);
    arrowHead(g, 96, 64, 1, 0, 18);
  },
  ArrowUp: (g) => {
    line(g, 8, [[64, 96], [64, 32]]);
    arrowHead(g, 64, 32, 0, -1, 18);
  },
  ArrowDown: (g) => {
    line(g, 8, [[64, 32], [64, 96]]);
    arrowHead(g, 64, 96, 0, 1, 18);
  },
  MediaTrackPrevious: (g) => {
    g.fillRect(28, 42, 8, 44);
    for (const x0 of [64, 98]) {
      g.beginPath();
      g.moveTo(x0, 42);
      g.lineTo(x0 - 30, 64);
      g.lineTo(x0, 86);
      g.closePath();
      g.fill();
    }
  },
  MediaTrackNext: (g) => {
    g.fillRect(92, 42, 8, 44);
    for (const x0 of [30, 64]) {
      g.beginPath();
      g.moveTo(x0, 42);
      g.lineTo(x0 + 30, 64);
      g.lineTo(x0, 86);
      g.closePath();
      g.fill();
    }
  },
  VolumeDown: (g) => {
    speaker(g);
    line(g, 7, [[72, 64], [100, 64]]);
  },
  VolumeUp: (g) => {
    speaker(g);
    line(g, 7, [[72, 64], [100, 64]]);
    line(g, 7, [[86, 50], [86, 78]]);
  },
  MicMute: (g) => {
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(52, 28, 24, 46, 12);
    g.stroke();
    g.beginPath();
    g.arc(64, 62, 26, 0, Math.PI);
    g.stroke();
    line(g, 7, [[64, 88], [64, 100]]);
    line(g, 7, [[30, 30], [98, 100]]);
  },
  FanMode: (g) => {
    g.lineWidth = 6;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath();
      g.ellipse(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18, 16, 8, a + 0.6, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(64, 64, 6, 0, Math.PI * 2);
    g.fill();
  },
  Armoury: (g) => {
    // the control-centre key: a gear
    g.lineWidth = 7;
    g.beginPath();
    g.arc(64, 64, 16, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      line(g, 9, [[64 + Math.cos(a) * 24, 64 + Math.sin(a) * 24], [64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34]]);
    }
  },
};

/** One atlas per keyboard; every key's legend sits in its own square cell. */
export function legendAtlas(keys: KeyDef[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * COLS;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.textBaseline = 'alphabetic';
  keys.forEach((k, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = g.fillStyle = '#ffffff';
    g.lineCap = g.lineJoin = 'round';
    const icon = ICONS[k.code === 'Power' && k.shape ? 'PowerButton' : k.code];
    if (icon) icon(g);
    else {
      const wide = k.label.length > 3;
      if (k.shift) {
        g.font = '600 38px "Barlow Semi Condensed", sans-serif';
        g.fillText(k.shift, 22, 52);
        g.font = '600 46px "Barlow Semi Condensed", sans-serif';
        g.fillText(k.label, 22, 104);
      } else if (wide) {
        g.font = `600 ${k.label.length > 6 ? 26 : 32}px "Barlow Semi Condensed", sans-serif`;
        g.fillText(k.label, 18, 108);
      } else {
        g.font = `600 ${k.label.length > 2 ? 44 : 54}px "Barlow Semi Condensed", sans-serif`;
        const m = g.measureText(k.label);
        g.fillText(k.label, (CELL - m.width) / 2, 84);
      }
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A flat legend plane for key i, its UVs pointing at the key's atlas cell. */
export function legendPlane(k: KeyDef, i: number, mat: THREE.Material): THREE.Mesh {
  const s = Math.min(k.w, k.d) * 0.86;
  const g = new THREE.PlaneGeometry(s, s);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const col = i % COLS, row = Math.floor(i / COLS);
  for (let j = 0; j < uv.count; j++) {
    const u = uv.getX(j), vv = uv.getY(j);
    uv.setXY(j, (col + u) / COLS, 1 - (row + 1 - vv) / COLS);
  }
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  // wide keys print their legend at the left, like real keycaps
  const wide = k.w > k.d * 1.3;
  m.position.set(wide ? -k.w / 2 + s / 2 + 0.4 : 0, 0.02, 0);
  return m;
}

export function legendMaterial(tex: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  trackColor(m.color, color);
  return m;
}

export interface BuiltKey {
  def: KeyDef;
  part: Part;
  rest: number;
  /** seconds left of a minimum press, so a quick tap is still seen */
  down: number;
  /** the key is being held on the visitor's own keyboard */
  held: boolean;
}

/**
 * Build every key as its own drawn part with a legend, under `parent`, keyboard top-left at (x0, y, z0).
 * `capH` is the cap's height: a cap stands proud of the deck by about its travel, so a pressed key ends
 * nearly flush instead of sinking out of sight.
 */
export function buildKeys(parent: THREE.Object3D, keys: KeyDef[], x0: number, y: number, z0: number, capH: number, fill: number, legendColor: number) {
  const atlas = legendAtlas(keys);
  const mat = legendMaterial(atlas, legendColor);
  const keyMat = ink(0.75);
  const out = new Map<string, BuiltKey>();
  const parts: Part[] = [];
  keys.forEach((k, i) => {
    // a 6-sided cylinder turned 30° has flat edges top and bottom, as on the real button
    const geo = k.shape ? new THREE.CylinderGeometry(k.w / 2, k.w / 2, capH, k.shape === 'hex' ? 6 : 32).rotateY(k.shape === 'hex' ? Math.PI / 6 : 0).translate(0, capH / 2, 0) : slab(k.w, capH, k.d, Math.min(1.6, k.d / 4));
    const p = new Part(geo, { width: 0.75, threshold: 40, fill, hull: k.shape === 'round' });
    if (p.lines) p.lines.material = keyMat;
    p.position.set(x0 + k.x + k.w / 2, y, z0 + k.z + k.d / 2);
    const leg = legendPlane(k, i, mat);
    leg.position.y += capH + 0.01;
    p.add(leg);
    parent.add(p);
    parts.push(p);
    out.set(k.code, { def: k, part: p, rest: y, down: 0, held: false });
  });
  return { keys: out, parts, legendMat: mat };
}
