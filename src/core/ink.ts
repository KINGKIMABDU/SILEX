// Drawing primitives. Everything on a sheet is paper-coloured fill plus ink lines:
// crease edges come from EdgesGeometry, silhouettes of curved parts from an inverted hull.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackColor, onTheme, tcs } from './theme';

export const C = {
  paper: 0xf3f4f1,
  ink: 0x1d1f22,
  ink2: 0x50545a,
  grey: 0x8b8e88,
  faint: 0xb9bbb5,
  red: 0xcf1f2e,
  tone1: 0xe8e9e5,
  tone2: 0xdcddd8,
  tone3: 0xcbcdc7,
  tone4: 0xa9aba5,
};

/**
 * Real material colours, muted and flat. The drawing stays line art; the fill says what a part is made of.
 * Red is never a material: it is reserved for energy.
 */
export const M = {
  alu: 0xd7dade, // bead-blasted anodised aluminium, light
  aluDark: 0x9aa0a8, // anodised aluminium, eclipse grey
  aluDeep: 0x6f757d, // dark anodised trim
  magnesium: 0xc9ccd0,
  glass: 0x2c3540, // cover glass over an unlit panel
  bezel: 0x34383e,
  keycap: 0xe9eaed,
  keycapDark: 0x3a3e44,
  plastic: 0x43474d,
  rubber: 0x3a3d42,
  pcb: 0x7e9a80, // solder mask
  pcbDark: 0x4f5a55,
  copper: 0xc8936f,
  gold: 0xd6b86f,
  solder: 0xbfc3c9,
  tin: 0xd0d3d7,
  die: 0x8f8aaa, // polished silicon, violet-grey
  siLight: 0xd3d0e3, // silicon in section
  siDoped: 0xbfcbe0, // heavily doped silicon (source, drain)
  oxide: 0xebe5cf, // silicon dioxide, hafnium oxide
  nitride: 0xdcd6e8,
  gateMetal: 0xa9afb8,
  mold: 0x575a60, // epoxy mould compound
  substrate: 0x9db39a, // organic package substrate
  foil: 0xcfd2d8, // battery pouch
  cellLabel: 0x6e8fb3,
  graphite: 0x55585d,
  fin: 0xd2d6db,
  ceramic: 0xc9b99a, // MLCC body
  ferrite: 0x5d6064,
  pad: 0x2f3236, // thermal pad
  white: 0xf5f5f2,
  rgb: 0xd8dbe0, // light bar diffuser
};

const lineMats = new Set<LineMaterial>();
const resolution = new THREE.Vector2(1, 1);

/** world units per CSS pixel at unit distance from the camera, shared by every hull shader */
export const pxUniform = { value: 0.01 };

export function setResolution(w: number, h: number) {
  resolution.set(w, h);
  lineMats.forEach((m) => m.resolution.set(w, h));
}

export interface LineOpts {
  width?: number;
  color?: number;
  dashed?: boolean;
  dash?: number;
  gap?: number;
  opacity?: number;
  depthTest?: boolean;
}

export function lineMat(o: LineOpts = {}): LineMaterial {
  const m = new LineMaterial({
    color: 0xffffff,
    linewidth: o.width ?? 1.3,
    dashed: !!o.dashed,
    dashSize: o.dash ?? 1,
    gapSize: o.gap ?? 1,
    worldUnits: false,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
  });
  if (o.depthTest === false) m.depthTest = false;
  trackColor(m.color, o.color ?? C.ink);
  m.resolution.copy(resolution);
  lineMats.add(m);
  return m;
}

const matCache = new Map<string, THREE.Material>();

export function ink(width = 1.3, color = C.ink): LineMaterial {
  const k = `l:${width}:${color}`;
  let m = matCache.get(k) as LineMaterial | undefined;
  if (!m) {
    m = lineMat({ width, color });
    matCache.set(k, m);
  }
  return m;
}

export function fillMat(color: number = C.paper, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  const k = `f:${color}:${side}`;
  let m = matCache.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      side,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    trackColor(m.color, color);
    matCache.set(k, m);
  }
  return m;
}

let phantom: LineMaterial | null = null;
export function phantomMat(): LineMaterial {
  return (phantom ??= lineMat({ width: 0.9, color: C.grey, dashed: true, dash: 6, gap: 2.5 }));
}

const hullVert = /* glsl */ `
uniform float uWidth;
uniform float uPx;
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  mat4 mm = modelMatrix;
  #ifdef USE_INSTANCING
    mm = modelMatrix * instanceMatrix;
  #endif
  vec4 mvPosition = viewMatrix * mm * vec4(position, 1.0);
  vec3 nv = normalize((viewMatrix * mm * vec4(normal, 0.0)).xyz);
  // a constant width on screen: the offset grows with the distance from the camera
  mvPosition.xyz += nv * uWidth * uPx * -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const hullFrag = /* glsl */ `
uniform vec3 uColor;
#include <common>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`;

export function hullMat(width = 1.3, color = C.ink): THREE.ShaderMaterial {
  const k = `h:${width}:${color}`;
  let m = matCache.get(k) as THREE.ShaderMaterial | undefined;
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uWidth: { value: width }, uPx: pxUniform, uColor: { value: new THREE.Color() } },
      vertexShader: hullVert,
      fragmentShader: hullFrag,
      side: THREE.BackSide,
      clipping: true,
    });
    trackColor(m.uniforms.uColor.value, color);
    matCache.set(k, m);
  }
  return m;
}

/** A plain flat-colour material (markers, electrons) that follows the theme. */
export function basicMat(color: number, o: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial(o);
  trackColor(m.color, color);
  return m;
}

export function edgesGeometry(geom: THREE.BufferGeometry, threshold = 28): LineSegmentsGeometry {
  const e = new THREE.EdgesGeometry(geom, threshold);
  const g = new LineSegmentsGeometry();
  g.setPositions(e.attributes.position.array as Float32Array);
  e.dispose();
  return g;
}

/** Line segments from explicit point pairs [a,b,a,b...] */
export function segments(points: THREE.Vector3[], mat: LineMaterial): LineSegments2 {
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => p.toArray(arr, i * 3));
  const g = new LineSegmentsGeometry();
  g.setPositions(arr);
  const l = new LineSegments2(g, mat);
  l.computeLineDistances();
  return l;
}

/** A polyline turned into segment pairs */
export function polyline(points: THREE.Vector3[], mat: LineMaterial, closed = false): LineSegments2 {
  const pairs: THREE.Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) pairs.push(points[i], points[i + 1]);
  if (closed && points.length > 2) pairs.push(points[points.length - 1], points[0]);
  return segments(pairs, mat);
}

export interface PartOpts {
  fill?: number;
  width?: number;
  color?: number;
  threshold?: number;
  hull?: boolean;
  edges?: boolean;
  name?: string;
}

/**
 * A drawn part: fill + crease lines (+ hull silhouette for curved forms).
 * Parts know how to emphasise themselves when selected and when energised.
 */
export class Part extends THREE.Group {
  fill: THREE.Mesh;
  lines?: LineSegments2;
  hull?: THREE.Mesh;
  baseWidth: number;
  baseColor: number;
  baseFill: number;
  private emph = 0;
  private live = false;
  private phantom = false;

  constructor(geom: THREE.BufferGeometry, o: PartOpts = {}) {
    super();
    this.name = o.name ?? '';
    this.baseWidth = o.width ?? 1.3;
    this.baseColor = o.color ?? C.ink;
    this.baseFill = o.fill ?? C.paper;
    this.fill = new THREE.Mesh(geom, fillMat(this.baseFill));
    this.fill.userData.part = this;
    this.add(this.fill);
    if (o.edges !== false) {
      this.lines = new LineSegments2(edgesGeometry(geom, o.threshold ?? 28), ink(this.baseWidth, this.baseColor));
      this.lines.computeLineDistances();
      this.add(this.lines);
    }
    if (o.hull) {
      this.hull = new THREE.Mesh(geom, hullMat(this.baseWidth, this.baseColor));
      this.add(this.hull);
    }
  }

  private restyle() {
    const w = this.baseWidth * (this.emph === 2 ? 2 : this.emph === 1 ? 1.5 : 1);
    const col = this.live ? C.red : this.baseColor;
    const ghost = this.phantom && this.emph === 0;
    this.fill.visible = !ghost;
    if (this.hull) this.hull.visible = !ghost;
    if (this.lines) this.lines.material = ghost ? phantomMat() : ink(w, col);
    if (this.hull) this.hull.material = hullMat(w, col);
  }

  /** Phantom lines: the ISO convention for a part drawn only to show what lies behind it. */
  setPhantom(on: boolean) {
    if (on === this.phantom) return;
    this.phantom = on;
    this.restyle();
  }

  /** 0 normal, 1 hovered, 2 selected */
  setEmphasis(level: number) {
    if (level === this.emph) return;
    this.emph = level;
    this.restyle();
  }

  setLive(on: boolean) {
    if (on === this.live) return;
    this.live = on;
    this.restyle();
  }

  setTone(color: number) {
    this.fill.material = fillMat(color);
  }
}

// ---------- geometry helpers ----------

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Rounded rectangle slab: XZ footprint w×d, thickness h, corner radius r, built as an extrusion. */
export function slab(w: number, h: number, d: number, r: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    // keep the footprint at w × d: the bevel eats into the outline instead of growing past it
    bevelOffset: -bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return smooth(g);
}

/** Welded copy with smooth normals, so a hull silhouette stays continuous. */
export function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

export function cyl(r: number, h: number, seg = 24): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, seg);
}

export function v(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

type HatchKind = 'si' | 'metal' | 'oxide' | 'organic' | 'solder' | 'poly';
const hatches: { g: CanvasRenderingContext2D; kind: HatchKind; bg: number; tex: THREE.CanvasTexture }[] = [];

function paintHatch(g: CanvasRenderingContext2D, kind: HatchKind, bg: number) {
  const n = 64;
  const hex = (x: number) => tcs('#' + x.toString(16).padStart(6, '0'));
  g.fillStyle = hex(bg);
  g.fillRect(0, 0, n, n);
  g.strokeStyle = hex(C.ink);
  g.fillStyle = hex(C.ink);
  g.lineWidth = 1.6;
  const diag = (step: number, dir = 1) => {
    for (let i = -n; i < n * 2; i += step) {
      g.beginPath();
      g.moveTo(i, dir > 0 ? 0 : n);
      g.lineTo(i + n, dir > 0 ? n : 0);
      g.stroke();
    }
  };
  if (kind === 'si') diag(16);
  if (kind === 'metal') { diag(16); diag(16, -1); }
  if (kind === 'oxide') for (let y = 4; y < n; y += 12) for (let x = (y / 12) % 2 ? 4 : 10; x < n; x += 12) g.fillRect(x, y, 2.2, 2.2);
  if (kind === 'organic') { g.lineWidth = 1.2; diag(10); }
  if (kind === 'solder') { g.lineWidth = 1.2; diag(8, -1); }
  if (kind === 'poly') for (let y = 8; y < n; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); }
}

const HATCH_BG: Record<HatchKind, number> = { si: M.siLight, metal: M.gateMetal, oxide: M.oxide, organic: M.substrate, solder: M.solder, poly: M.siDoped };

/** Hatch texture for section cuts (ISO-style material patterns over the material's own colour). */
export function hatchTexture(kind: HatchKind, scale = 1, bg = HATCH_BG[kind]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  paintHatch(g, kind, bg);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(scale, scale);
  t.colorSpace = THREE.SRGBColorSpace;
  hatches.push({ g, kind, bg, tex: t });
  return t;
}

onTheme(() => {
  for (const h of hatches) {
    paintHatch(h.g, h.kind, h.bg);
    h.tex.needsUpdate = true;
  }
});

