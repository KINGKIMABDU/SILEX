import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { C, Part, pxUniform, setResolution } from './ink';
import { tc, onTheme } from './theme';
import { Overlay } from './overlay';
import type { Sheet, View } from './sheet';
import { PARENT } from '../sheets/ids';

const DEG = Math.PI / 180;
/** CSS pixel in millimetres (CSS reference pixel, 96 per inch) */
const MM_PER_PX = 25.4 / 96;
/**
 * Vertical field of view. A long lens, like a product photograph or a patent figure drawn in
 * perspective: the far side of the machine recedes a little, so it no longer reads as larger
 * (the illusion a parallel projection gives), while lines stay close to parallel.
 */
const FOV = 12;
const TAN = Math.tan((FOV / 2) * DEG);
/** a view's width budget, as a multiple of its height */
const WIDTH = 1.35;

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t));

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  overlay: Overlay;
  sheet: Sheet | null = null;
  w = 1;
  h = 1;
  /** height of the view at the target, in world units, at rest */
  private frustumH = 100;
  /** camera distance at rest for the current view */
  private rest = 100;
  private ray = new THREE.Raycaster();
  private ptr = new THREE.Vector2();
  private hover: Part | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private last = performance.now();
  private elapsed = 0;
  private anim: ((now: number) => boolean) | null = null;
  busy = false;
  onFrame: (dt: number) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
    svg: SVGSVGElement,
    labels: HTMLElement,
    private veil: HTMLElement,
    private labelLayers: HTMLElement[],
    onSee: (n: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(tc(C.paper), 1);
    onTheme(() => this.renderer.setClearColor(tc(C.paper), 1));
    this.renderer.localClippingEnabled = true;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1e5);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.zoomSpeed = 1.1;
    this.controls.rotateSpeed = 0.75;
    this.controls.screenSpacePanning = true;
    this.overlay = new Overlay(svg, labels, { onSee });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindPointer();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    setResolution(this.w * dpr, this.h * dpr);
    this.overlay.resize(this.w, this.h);
    if (this.sheet) this.fit(this.sheet.view);
  }

  /** Fit the view so its height and width both land inside the stage. */
  private fit(v: View) {
    const aspect = this.w / this.h;
    this.frustumH = Math.max(v.height, (v.height * WIDTH) / aspect);
    this.rest = this.frustumH / 2 / TAN;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(v: View, target: THREE.Vector3, zoom: number) {
    this.fit(v);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, (90 - v.el) * DEG, v.az * DEG);
    this.camera.position.copy(target).addScaledVector(dir, this.rest);
    this.camera.up.set(0, 1, 0);
    this.camera.zoom = zoom;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.limits(v, zoom);
    this.controls.update();
  }

  /** scroll moves the camera in and out: the view's zoom range becomes a range of distances */
  private limits(v: View, zoom: number) {
    this.controls.minDistance = this.rest / ((v.maxZoom ?? 8) * Math.max(zoom, 1));
    this.controls.maxDistance = this.rest / ((v.minZoom ?? 0.4) * Math.min(zoom, 1));
  }

  /** world units per CSS pixel at the target */
  private wupp(): number {
    return (2 * TAN * this.camera.position.distanceTo(this.controls.target)) / this.camera.zoom / this.h;
  }

  /** real-world scale of the drawing on screen: screen mm per real mm */
  ratio(sheet: Sheet | null = this.sheet): number {
    if (!sheet) return 1;
    return MM_PER_PX / this.wupp() / sheet.mmPerUnit;
  }

  /** what a sheet's resting ratio would be at the current stage size */
  restRatio(sheet: Sheet): number {
    const aspect = this.w / this.h;
    const fh = Math.max(sheet.view.height, (sheet.view.height * WIDTH) / aspect);
    return MM_PER_PX / (fh / this.h) / sheet.mmPerUnit;
  }

  show(sheet: Sheet) {
    if (this.sheet) {
      this.scene.remove(this.sheet.root);
      this.sheet.exit();
    }
    this.sheet = sheet;
    if (!sheet.built) {
      sheet.build();
      sheet.built = true;
    }
    this.scene.add(sheet.root);
    this.overlay.attach(sheet);
    this.placeCamera(sheet.view, sheet.view.target, 1);
    sheet.enter();
  }

  /**
   * How to get from one sheet to another: dive into a part of `from`, climb out of `from` and land
   * on the part of `to` it came from, or (for sheets side by side) climb out and dive back in.
   */
  private route(from: Sheet, to: Sheet): { leave: 'in' | 'out'; arrive: 'in' | 'out'; anchor: THREE.Vector3 | null } {
    const a = new THREE.Vector3();
    // a numeral on one sheet that leads straight to the other
    if (from.anchorFor(to.no, a)) return { leave: 'in', arrive: 'in', anchor: a };
    if (to.anchorFor(from.no, a)) return { leave: 'out', arrive: 'out', anchor: a };
    const chain = (n: number) => {
      const c = [n];
      while (PARENT[c[c.length - 1]]) c.push(PARENT[c[c.length - 1]]);
      return c;
    };
    const down = chain(to.no), up = chain(from.no);
    const i = down.indexOf(from.no);
    if (i > 0) {
      // `from` contains `to`: dive into the part on the way down
      if (!from.anchorFor(down[i - 1], a)) a.copy(from.zoomTarget);
      return { leave: 'in', arrive: 'in', anchor: a };
    }
    const j = up.indexOf(to.no);
    if (j > 0) {
      // `to` contains `from`: land on the part we climbed out of
      if (!to.anchorFor(up[j - 1], a)) a.copy(to.zoomTarget);
      return { leave: 'out', arrive: 'out', anchor: a };
    }
    return { leave: 'out', arrive: 'in', anchor: null };
  }

  /** Zoom out of (or into) the current sheet, swap, and settle on the next one. */
  transition(to: Sheet, swap: () => void): Promise<void> {
    const from = this.sheet;
    if (!from || this.busy) return Promise.resolve();
    if (!to.built) {
      to.build();
      to.built = true;
    }
    this.busy = true;
    const { leave, arrive, anchor } = this.route(from, to);
    const R = this.restRatio(to) / this.restRatio(from);
    // half the change of scale on each side of the swap: never so little that it reads as a cut,
    // never so much that the whole move is spent in the first few frames
    const F = leave === arrive ? Math.min(8, Math.max(1.7, Math.sqrt(leave === 'in' ? R : 1 / R))) : 2.2;
    const fast = reducedMotion.matches;
    const t1 = fast ? 160 : 720, t2 = fast ? 200 : 900;
    const z0 = this.camera.zoom;
    const start = this.controls.target.clone();
    const dive = leave === 'in' && anchor ? anchor : start;
    this.controls.enabled = false;
    const moveTo = (p: THREE.Vector3) => {
      const d = p.clone().sub(this.controls.target);
      this.controls.target.add(d);
      this.camera.position.add(d);
      this.camera.updateProjectionMatrix();
    };
    return new Promise((resolve) => {
      let t0 = performance.now();
      let phase = 0;
      this.anim = (now) => {
        if (phase === 0) {
          const t = Math.min(1, (now - t0) / t1);
          const e = easeInOut(t);
          if (!fast) {
            const z = z0 * Math.pow(leave === 'in' ? F : 1 / F, e);
            this.camera.zoom = z;
            // the dive point keeps its place on screen while the scale grows, then settles at the centre
            moveTo(dive.clone().addScaledVector(start.clone().sub(dive), (z0 / z) * (1 - e)));
          }
          this.setVeil(Math.max(0, (t - 0.35) / 0.65));
          if (t >= 1) {
            this.scene.remove(from.root);
            from.exit();
            this.sheet = to;
            this.scene.add(to.root);
            this.overlay.attach(to);
            const land = arrive === 'out' && anchor ? anchor : to.view.target;
            this.placeCamera(to.view, land.clone(), fast ? 1 : arrive === 'in' ? 1 / F : F);
            to.enter();
            swap();
            phase = 1;
            t0 = now;
          }
          return false;
        }
        const t = Math.min(1, (now - t0) / t2);
        const e = easeOutExpo(t);
        if (!fast) {
          const zs = arrive === 'in' ? 1 / F : F;
          const z = zs * Math.pow(1 / zs, e);
          this.camera.zoom = z;
          if (arrive === 'out' && anchor) {
            // the part we climbed out of slides from the centre to where it sits in the resting view
            moveTo(anchor.clone().addScaledVector(to.view.target.clone().sub(anchor), e / z));
          } else this.camera.updateProjectionMatrix();
        }
        this.setVeil(1 - Math.min(1, t * 1.6));
        if (t >= 1) {
          this.placeCamera(to.view, to.view.target, 1);
          this.controls.enabled = true;
          this.busy = false;
          this.setVeil(0);
          resolve();
          return true;
        }
        return false;
      };
    });
  }

  private setVeil(a: number) {
    this.veil.style.opacity = String(a);
    for (const l of this.labelLayers) l.style.opacity = String(1 - a);
  }

  /** Return the camera to the sheet's resting view. */
  resetView() {
    if (this.sheet && !this.busy) this.placeCamera(this.sheet.view, this.sheet.view.target, 1);
  }

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (e.pointerType === 'mouse') this.pick(false);
    });
    c.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      const quick = performance.now() - this.down.t < 450;
      this.down = null;
      if (moved < 6 && quick) {
        const r = c.getBoundingClientRect();
        this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.pick(true);
      }
    });
    c.addEventListener('pointerleave', () => this.setHover(null));
    c.addEventListener('dblclick', () => this.resetView());
  }

  private pick(click: boolean) {
    const s = this.sheet;
    if (!s || this.busy) return;
    this.ray.setFromCamera(this.ptr, this.camera);
    if (click && s.pickRay(this.ray)) return;
    const hits = this.ray.intersectObject(s.root, true);
    let part: Part | null = null;
    for (const hh of hits) {
      if (!isShown(hh.object)) continue;
      if (s.clipPlanes.some((pl) => pl.distanceToPoint(hh.point) < 0)) continue;
      const p = hh.object.userData.part as Part | undefined;
      if (p && (s.canPick(p) || s.refForPart(p))) {
        part = p;
        break;
      }
      if (p) break;
    }
    if (click) {
      if (part && s.canPick(part)) {
        s.pickPart(part);
        return;
      }
      const ref = part ? s.refForPart(part) : null;
      s.select(ref ?? null);
    } else this.setHover(part);
  }

  private setHover(p: Part | null) {
    const s = this.sheet;
    if (this.hover === p) return;
    if (this.hover && s) {
      const r = s.refForPart(this.hover);
      if (s.selected !== r) r?.parts?.forEach((x) => x.setEmphasis(0));
    }
    this.hover = p;
    this.canvas.style.cursor = p ? 'pointer' : '';
    if (p && s && s.canPick(p)) return;
    if (p && s) {
      const r = s.refForPart(p);
      if (s.selected !== r) r?.parts?.forEach((x) => x.setEmphasis(1));
    }
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    if (this.anim && this.anim(now)) this.anim = null;
    if (this.controls.enabled) this.controls.update();
    // depth range follows the camera, so the narrow lens keeps its precision at every scale
    const d = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = d * 0.05;
    this.camera.far = d * 40;
    this.camera.updateProjectionMatrix();
    pxUniform.value = (2 * TAN) / this.camera.zoom / this.h;
    this.sheet?.update(dt, t);
    this.renderer.clippingPlanes = this.sheet?.clipPlanes ?? [];
    this.renderer.render(this.scene, this.camera);
    this.overlay.update(this.camera);
    this.onFrame(dt);
  }
}

function isShown(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

export function formatRatio(r: number): string {
  const fmt = (x: number) => {
    if (x < 10) return x.toFixed(x < 2 ? 2 : 1).replace(/\.?0+$/, '');
    if (x < 1000) return String(Math.round(x));
    const e = Math.floor(Math.log10(x));
    const m = x / Math.pow(10, e);
    return `${m.toFixed(1)}×10^${e}`;
  };
  return r >= 1 ? `${fmt(r)} : 1` : `1 : ${fmt(1 / r)}`;
}
