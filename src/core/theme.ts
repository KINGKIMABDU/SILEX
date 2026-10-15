// Light and Graphite (dark) themes for everything the drawing renders.
// Materials register the colour they were drawn with; switching the theme re-tints them in place.
import * as THREE from 'three';

export type Theme = 'light' | 'dark';

/** Neutral drawing roles: these invert in the dark theme (paper becomes graphite, ink becomes chalk). */
const ROLE_DARK: Record<number, number> = {
  0xf3f4f1: 0x1e1f21, // paper
  0x1d1f22: 0xe2e0db, // ink
  0x50545a: 0xa9abae, // ink-2
  0x8b8e88: 0x7d8084, // grey
  0xb9bbb5: 0x4b4d51, // faint
  0xe8e9e5: 0x28292c, // tone1
  0xdcddd8: 0x303134, // tone2
  0xcbcdc7: 0x3b3d41, // tone3
  0xa9aba5: 0x56585c, // tone4
  0xcf1f2e: 0xff4d5a, // red
};

let mode: Theme = 'light';
const listeners = new Set<() => void>();

export function getTheme() {
  return mode;
}

export function onTheme(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Map a light-theme colour to the current theme. Materials are darkened, roles inverted. */
export function tc(hex: number): number {
  if (mode === 'light') return hex;
  const r = ROLE_DARK[hex];
  if (r !== undefined) return r;
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s * 0.82, 0.05 + hsl.l * 0.52, THREE.SRGBColorSpace);
  return c.getHex(THREE.SRGBColorSpace);
}

/** Same, for '#rrggbb' strings used on canvases. */
export function tcs(s: string): string {
  if (mode === 'light' || !s.startsWith('#') || s.length !== 7) return s;
  return '#' + tc(parseInt(s.slice(1), 16)).toString(16).padStart(6, '0');
}

interface Tracked {
  set: (hex: number) => void;
  src: number;
}

const tracked: Tracked[] = [];

/** Register a colour setter so the theme can re-tint it later. */
export function track(src: number, set: (hex: number) => void) {
  tracked.push({ src, set });
  set(tc(src));
}

export function trackColor(color: THREE.Color, src: number) {
  track(src, (hx) => color.setHex(hx));
}

export function setTheme(t: Theme) {
  if (t === mode) return;
  mode = t;
  document.documentElement.dataset.theme = t;
  for (const x of tracked) x.set(tc(x.src));
  listeners.forEach((f) => f());
}
