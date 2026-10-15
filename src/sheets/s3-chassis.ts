import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { C, M, Part, slab, cyl, v, polyline, segments, ink, lineMat, smooth, phantomMat } from '../core/ink';
import { tcs } from '../core/theme';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch, type Workload } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal, THERMAL, LOADS, JOB_WORK, type Limit } from '../sim/thermal';
import { h, segmented, slider, readout, button, section, grind, Plot, fmtDuration } from '../core/ui';
import { N } from './ids';

/** Hollow wall ring of a tray: outer rounded rectangle minus inner. */
function ring(w: number, d: number, r: number, wall: number, hgt: number) {
  const rr = (s: THREE.Shape | THREE.Path, W: number, D: number, R: number) => {
    const x = -W / 2, y = -D / 2;
    s.moveTo(x + R, y);
    s.lineTo(x + W - R, y);
    s.quadraticCurveTo(x + W, y, x + W, y + R);
    s.lineTo(x + W, y + D - R);
    s.quadraticCurveTo(x + W, y + D, x + W - R, y + D);
    s.lineTo(x + R, y + D);
    s.quadraticCurveTo(x, y + D, x, y + D - R);
    s.lineTo(x, y + R);
    s.quadraticCurveTo(x, y, x + R, y);
  };
  const s = new THREE.Shape();
  rr(s, w, d, r);
  const hole = new THREE.Path();
  rr(hole, w - wall * 2, d - wall * 2, Math.max(0.5, r - wall));
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: hgt, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  return smooth(g);
}

interface Layer {
  group: THREE.Group;
  y0: number;
  dy: number;
}

type FlowKind = 'cpu' | 'gpu' | 'air' | 'battery' | 'charger';

interface Flow {
  line: THREE.Object3D & { material: LineMaterial };
  kind: FlowKind;
}

class Chassis {
  group = new THREE.Group();
  layers: Layer[] = [];
  parts: Record<string, Part[]> = {};
  anchors: Record<string, THREE.Object3D> = {};
  flows: Flow[] = [];
  fans: THREE.Group[] = [];
  socWorld = new THREE.Object3D();
  phantomLines: THREE.Object3D[] = [];

  constructor(public arch: Arch) {
    const s = SPEC[arch];
    const arm = arch === 'arm';
    const baseH = arm ? s.h - s.lidT : 14.6;
    const W = s.w, D = s.d;
    const r = arm ? 8 : 6;
    const layer = (y0: number, dy: number) => {
      const g = new THREE.Group();
      this.group.add(g);
      this.layers.push({ group: g, y0, dy });
      return g;
    };
    const add = (key: string, p: Part, parent: THREE.Object3D) => {
      (this.parts[key] ??= []).push(p);
      parent.add(p);
      return p;
    };
    const box = (key: string, parent: THREE.Object3D, w: number, hh: number, d: number, x: number, y: number, z: number, fill: number, o: { r?: number; hull?: boolean; width?: number } = {}) => {
      const p = new Part(slab(w, hh, d, o.r ?? Math.min(1, w / 10, d / 10)), { width: o.width ?? 0.9, threshold: 40, fill, hull: o.hull });
      p.position.set(x, y, z);
      return add(key, p, parent);
    };
    const anchor = (key: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.anchors[key] = o;
    };
    const flow = (pts: THREE.Vector3[], parent: THREE.Object3D, kind: FlowKind) => {
      const l = polyline(pts, lineMat({ color: C.red, width: 2 }));
      parent.add(l);
      this.flows.push({ line: l as unknown as Flow['line'], kind });
    };
    const fan = (parent: THREE.Object3D, x: number, z: number, rad: number, thick: number, y: number) => {
      box('fans', parent, rad * 2 + 6, thick, rad * 2 + 6, x, y, z, M.plastic, { r: rad * 0.9, hull: true });
      const rotor = new THREE.Group();
      rotor.position.set(x, y + thick + 0.05, z);
      parent.add(rotor);
      const blades: THREE.Vector3[] = [];
      const n = Math.round(rad * 0.75);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        blades.push(v(Math.cos(a) * rad * 0.38, 0, Math.sin(a) * rad * 0.38), v(Math.cos(a + 0.35) * rad * 0.94, 0, Math.sin(a + 0.35) * rad * 0.94));
      }
      rotor.add(segments(blades, ink(0.75)));
      const hub = new Part(cyl(rad * 0.36, 0.5, 32), { width: 0.9, hull: true, threshold: 40, fill: M.plastic });
      hub.position.y = 0.2;
      rotor.add(hub);
      (this.parts.fans ??= []).push(hub);
      this.fans.push(rotor);
    };
    const pipe = (parent: THREE.Object3D, pts: THREE.Vector3[], rad: number) => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      add('pipes', new Part(new THREE.TubeGeometry(curve, 72, rad, 10, false), { hull: true, threshold: 60, fill: M.copper }), parent);
      return curve;
    };
    const finStack = (parent: THREE.Object3D, x0: number, x1: number, z: number, d: number, y: number, hh: number, alongZ = false) => {
      const w = Math.abs(x1 - x0);
      const p = alongZ ? box('fins', parent, d, hh, w, (x0 + x1) / 2, y, z, M.fin) : box('fins', parent, w, hh, d, (x0 + x1) / 2, y, z, M.fin);
      if (alongZ) p.position.set(z, y, (x0 + x1) / 2);
      const lines: THREE.Vector3[] = [];
      for (let t = 1.4; t < w; t += 1.4) {
        if (alongZ) lines.push(v(z - d / 2, y + hh + 0.02, Math.min(x0, x1) + t), v(z + d / 2, y + hh + 0.02, Math.min(x0, x1) + t));
        else lines.push(v(Math.min(x0, x1) + t, y + hh + 0.02, z - d / 2), v(Math.min(x0, x1) + t, y + hh + 0.02, z + d / 2));
      }
      parent.add(segments(lines, ink(0.5)));
    };

    // 300 bottom case
    const L0 = layer(0, 0);
    add('case', new Part(slab(W, 1.0, D, r, 0.3), { hull: true, threshold: 40, fill: arm ? M.alu : M.aluDark }), L0);
    const wall = add('case', new Part(ring(W, D, r, 1.6, baseH - 1), { threshold: 40, fill: arm ? M.alu : M.aluDark }), L0);
    wall.position.y = 1;
    anchor('case', L0, W / 2 - 40, 1, D / 2 - 1);

    // 302 battery cells across the front
    const L1 = layer(1.2, arm ? 22 : 26);
    const cellW = arm ? 78 : 80, cellD = arm ? 96 : 95, cellH = arm ? 4.2 : 6.6;
    const cz = D / 2 - cellD / 2 - 14;
    for (let i = 0; i < s.cells; i++) {
      const x = (i - (s.cells - 1) / 2) * (cellW + 4);
      box('battery', L1, cellW, cellH, cellD, x, 0, cz, M.foil, { r: 3, hull: true });
      box('battery', L1, cellW * 0.42, 0.1, cellD * 0.2, x, cellH, cz + cellD * 0.18, M.white, { r: 1 });
    }
    const bmsZ = D / 2 - cellD - 20;
    box('battery', L1, s.cells * (cellW + 4) - 40, 1.2, 8, 0, 0, bmsZ, M.pcb);
    anchor('battery', L1, cellW / 2 + 20, cellH, cz);

    // 304 logic board and its chips
    const L2 = layer(arm ? 1.5 : 2.0, arm ? 42 : 52);
    const parts: { x: number; z: number; w: number; d: number; hh: number; fill: number; key: string }[] = [];
    let socX: number, socZ: number;
    if (arm) {
      const bz = -D / 2 + 46;
      box('board', L2, 212, 1.0, 72, -10, 0, bz, M.pcb, { r: 3, hull: true });
      socX = -40;
      socZ = bz + 2;
      parts.push(
        { x: socX, z: socZ, w: 25, d: 25, hh: 1.4, fill: M.substrate, key: 'board' },
        { x: socX - 26, z: socZ - 9, w: 12.4, d: 15, hh: 1.0, fill: M.mold, key: 'board' },
        { x: socX - 26, z: socZ + 9, w: 12.4, d: 15, hh: 1.0, fill: M.mold, key: 'board' },
        { x: socX + 26, z: socZ - 9, w: 12.4, d: 15, hh: 1.0, fill: M.mold, key: 'board' },
        { x: socX + 26, z: socZ + 9, w: 12.4, d: 15, hh: 1.0, fill: M.mold, key: 'board' },
        { x: 30, z: bz + 6, w: 42, d: 22, hh: 1.6, fill: M.pcbDark, key: 'ssd' },
        { x: 64, z: bz - 22, w: 12, d: 12, hh: 1.4, fill: M.tin, key: 'board' },
        { x: -80, z: bz + 22, w: 7, d: 7, hh: 1.0, fill: M.mold, key: 'board' },
        { x: -80, z: bz + 8, w: 7, d: 7, hh: 1.0, fill: M.mold, key: 'board' },
        { x: -10, z: bz - 26, w: 12, d: 8, hh: 1.0, fill: M.mold, key: 'board' },
      );
      for (let i = 0; i < 4; i++) parts.push({ x: -8 + i * 6.5, z: bz + 26, w: 5.5, d: 5.5, hh: 1.8, fill: M.ferrite, key: 'board' });
    } else {
      // rear board between the fans, plus a front strip for memory, storage and Wi-Fi
      box('board', L2, 176, 1.0, 82, 0, 0, -D / 2 + 49, M.pcbDark, { r: 3, hull: true });
      box('board', L2, 300, 1.0, 30, 0, 0, -D / 2 + 104, M.pcbDark, { r: 3, hull: true });
      socX = -44;
      socZ = -D / 2 + 46;
      const gx = 40, gz = -D / 2 + 50;
      parts.push(
        { x: socX, z: socZ, w: 37.5, d: 45, hh: 1.6, fill: M.substrate, key: 'board' },
        { x: socX, z: socZ, w: 13, d: 16, hh: 2.1, fill: M.die, key: 'board' },
        { x: gx, z: gz, w: 40, d: 40, hh: 1.6, fill: M.substrate, key: 'gpu' },
        { x: gx, z: gz, w: 19, d: 19, hh: 2.1, fill: M.die, key: 'gpu' },
      );
      for (const [dx, dz] of [[-28, -12], [-28, 8], [28, -12], [28, 8], [-11, 27], [11, 27], [-11, -27], [11, -27]]) parts.push({ x: gx + dx, z: gz + dz, w: 12, d: 14, hh: 1.2, fill: M.mold, key: 'gddr' });
      for (let i = 0; i < 6; i++) parts.push({ x: socX - 16 + i * 6.5, z: socZ + 28, w: 5.5, d: 5.5, hh: 2.2, fill: M.ferrite, key: 'vrm' });
      for (let i = 0; i < 6; i++) parts.push({ x: gx + 31 + (i % 2) * 6.5, z: gz - 18 + Math.floor(i / 2) * 9, w: 5.5, d: 5.5, hh: 2.2, fill: M.ferrite, key: 'vrm' });
      // memory: a dual-stack SO-DIMM socket, two SSDs, Wi-Fi card
      const fz = -D / 2 + 104;
      for (let k = 0; k < 2; k++) {
        const dimmY = 1 + k * 4.2;
        box('dimm', L2, 69.6, 1.2, 30, -112, dimmY, fz, M.pcb);
        for (let c = 0; c < 4; c++) box('dimm', L2, 11, 0.9, 13, -136 + c * 15.5, dimmY + 1.2, fz - 3, M.mold);
        box('dimm', L2, 62, 0.1, 2.5, -112, dimmY + 1.2, fz + 13.5, M.gold);
      }
      for (const sx of [-32, 62]) {
        box('ssd', L2, 80, 1.0, 22, sx, 1, fz, M.pcbDark);
        box('ssd', L2, 12, 1.0, 12, sx - 26, 2, fz, M.mold);
        for (let c = 0; c < 2; c++) box('ssd', L2, 16, 1.0, 14, sx - 2 + c * 20, 2, fz, M.mold);
      }
      parts.push({ x: 128, z: fz, w: 22, d: 30, hh: 1.4, fill: M.tin, key: 'board' });
      anchor('gpu', L2, gx + 10, 3, gz + 10);
      anchor('dimm', L2, -112, 10, fz + 10);
      anchor('vrm', L2, socX - 6, 4, socZ + 28);
    }
    for (const p of parts) box(p.key, L2, p.w, p.hh, p.d, p.x, 1, p.z, p.fill);
    const socAnchor = new THREE.Object3D();
    socAnchor.position.set(socX, 2.5, socZ);
    L2.add(socAnchor);
    socAnchor.add(this.socWorld);
    anchor('board', L2, socX + 20, 2, socZ + 16);
    anchor('ssd', L2, arm ? 30 : -32, 3, arm ? -D / 2 + 52 : -D / 2 + 110);

    // 306 cooling
    const L3 = layer(arm ? 3.2 : 4.4, arm ? 62 : 82);
    if (arm) {
      box('thermal', L3, 40, 0.8, 36, socX, 0, socZ, M.copper, { r: 3, hull: true });
      const fx = 96, fz = -D / 2 + 42;
      fan(L3, fx, fz, 24, 4.8, 0);
      finStack(L3, fx - 26, fx + 26, -D / 2 + 9, 8, 0, 4.6);
      const c1 = pipe(L3, [v(socX, 1.4, socZ), v(socX + 40, 1.4, socZ - 8), v(fx - 30, 1.4, -D / 2 + 14), v(fx + 24, 1.4, -D / 2 + 10)], 2.2);
      flow(c1.getPoints(40).map((p) => p.clone().setY(3.8)), L3, 'cpu');
      for (let i = 0; i < 6; i++) flow([v(fx - 22 + i * 9, 3, -D / 2 + 4), v(fx - 22 + i * 9, 3, -D / 2 - 14)], L3, 'air');
      anchor('thermal', L3, socX + 18, 0.8, socZ + 14);
      anchor('fans', L3, fx + 18, 5, fz + 18);
    } else {
      // vapor chamber across CPU and GPU, six heat pipes to three fin stacks, three fans
      const vcX = (socX + 40) / 2, vcZ = -D / 2 + 48;
      box('thermal', L3, 132, 2.6, 56, vcX, 0, vcZ, M.copper, { r: 4, hull: true });
      fan(L3, -127, -D / 2 + 40, 34, 10, -2);
      fan(L3, 127, -D / 2 + 40, 34, 10, -2);
      fan(L3, 0, -D / 2 + 98, 22, 8, -2);
      finStack(L3, -170, -92, -D / 2 + 6, 9, -2, 10);
      finStack(L3, 92, 170, -D / 2 + 6, 9, -2, 10);
      finStack(L3, -D / 2 + 14, -D / 2 + 70, -W / 2 + 6, 8, -2, 10, true);
      finStack(L3, -D / 2 + 14, -D / 2 + 70, W / 2 - 6, 8, -2, 10, true);
      for (const [i, side] of [[0, -1], [1, -1], [2, -1], [0, 1], [1, 1], [2, 1]] as const) {
        const startX = side < 0 ? socX + 10 - i * 7 : 40 - 10 + i * 7;
        const pts = [v(startX, 2.8, vcZ - 10 + i * 6), v(side * 70, 2.8, vcZ - 18 + i * 3), v(side * 110, 2.8, -D / 2 + 10 + i * 3), v(side * 160, 2.8, -D / 2 + 8 + i * 2.2)];
        const c = pipe(L3, pts, 1.7);
        flow(c.getPoints(36).map((p) => p.clone().setY(4.8)), L3, side < 0 ? 'cpu' : 'gpu');
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) flow([v(side * (100 + i * 16), 2, -D / 2 + 2), v(side * (100 + i * 16), 2, -D / 2 - 22)], L3, 'air');
        for (let i = 0; i < 3; i++) flow([v(side * (W / 2 - 2), 2, -D / 2 + 22 + i * 18), v(side * (W / 2 + 22), 2, -D / 2 + 22 + i * 18)], L3, 'air');
      }
      anchor('thermal', L3, vcX + 40, 2.6, vcZ + 20);
      anchor('fans', L3, 127 - 20, 8, -D / 2 + 64);
    }
    // battery current to the board, and charger current from the power port
    const portX = -W / 2 + 2;
    const portZ = -D / 2 + s.left[0].z;
    flow([v(-cellW / 2, cellH + 1, bmsZ), v(-cellW / 2, cellH + 1, socZ + 30), v(socX, cellH + 1, socZ + 14)], L1, 'battery');
    flow([v(portX, 3, portZ), v(portX + 30, 3, portZ), v(socX - 10, 3, socZ)], L2, 'charger');

    // 308 speakers
    const L4 = layer(1.2, arm ? 62 : 82);
    for (const sx of [-1, 1]) {
      box('speakers', L4, arm ? 24 : 20, arm ? 6 : 8, arm ? 46 : 50, sx * (W / 2 - (arm ? 20 : 14)), 0, D / 2 - 40, M.plastic, { r: 3, hull: true });
      box('speakers', L4, 12, 5, 22, sx * (W / 2 - (arm ? 22 : 16)), 0, arm ? -D / 2 + 34 : -D / 2 + 130, M.plastic, { r: 2, hull: true });
    }
    anchor('speakers', L4, -(W / 2 - 20), 6, D / 2 - 40);

    // 310 trackpad module
    const L5 = layer(baseH - 4.3, arm ? 82 : 106);
    const tpW = arm ? 152 : 150, tpD = arm ? 100 : 92;
    const tpX = arm ? -(14.5 * 18 + 5 + 4 * 14.8) / 2 + (14.5 * 18) / 2 : 0;
    box('trackpad', L5, tpW, 3, tpD, tpX, 0, D / 2 - tpD / 2 - 10, arm ? M.magnesium : M.aluDeep, { r: 5, hull: true });
    box('trackpad', L5, 34, 2.2, 10, tpX, -2.2, D / 2 - tpD / 2 - 10, M.ferrite, { r: 1 });
    anchor('trackpad', L5, tpX + tpW / 2 - 10, 3, D / 2 - 20);

    // 312 top case with keyboard, drawn in phantom lines by default
    const L6 = layer(baseH - 1.2, arm ? 104 : 130);
    add('top', new Part(slab(W, 1.2, D, r, 0.3), { hull: true, threshold: 40, fill: arm ? M.alu : M.aluDark }), L6);
    const P = arm ? 18 : 18.9;
    const kbW = arm ? 14.5 * P + 5 + 4 * 14.8 : 14.5 * P;
    const kbD = P * (arm ? 5.58 : 6.4);
    const kz = -D / 2 + (arm ? 22 : 38) + kbD / 2;
    const ol = polyline([v(-kbW / 2, 1.25, kz - kbD / 2), v(kbW / 2, 1.25, kz - kbD / 2), v(kbW / 2, 1.25, kz + kbD / 2), v(-kbW / 2, 1.25, kz + kbD / 2)], ink(1), true);
    L6.add(ol);
    const grid: THREE.Vector3[] = [];
    for (let i = 1; i < 6; i++) {
      const zz = kz - kbD / 2 + P * 0.55 + (i - 1) * P;
      grid.push(v(-kbW / 2, 1.25, zz), v(kbW / 2, 1.25, zz));
    }
    const gl = segments(grid, ink(0.6, C.grey));
    L6.add(gl);
    const tpo = polyline([v(tpX - tpW / 2, 1.25, D / 2 - tpD - 10), v(tpX + tpW / 2, 1.25, D / 2 - tpD - 10), v(tpX + tpW / 2, 1.25, D / 2 - 10), v(tpX - tpW / 2, 1.25, D / 2 - 10)], ink(0.9), true);
    L6.add(tpo);
    this.phantomLines.push(ol, gl, tpo);
    anchor('top', L6, -W / 2 + 30, 1.2, -D / 2 + 20);
  }

  setPhantom(on: boolean) {
    for (const k of ['top', 'trackpad', 'speakers']) this.parts[k]?.forEach((p) => p.setPhantom(on));
    for (const l of this.phantomLines) (l as unknown as { material: LineMaterial }).material = on ? phantomMat() : ink(0.9);
  }

  setExplode(e: number) {
    for (const l of this.layers) l.group.position.y = l.y0 + l.dy * e;
  }
}

const LIMIT: Record<Limit, string> = { thermal: 'temperature', power: 'power limit', demand: 'nothing, it has headroom', battery: 'running on battery' };

export class ChassisSheet extends Sheet {
  readonly no = N.chassis;
  readonly title = 'The chassis';
  readonly short = 'chassis';
  readonly mmPerUnit = 1;
  readonly sub = 'Base assembly, exploded along its stacking axis';
  view: View = { height: 330, az: -28, el: 33, target: new THREE.Vector3(0, 54, 4), minZoom: 0.5, maxZoom: 12 };
  chassis!: Record<Arch, Chassis>;
  explode = 1;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private limiter!: HTMLElement;
  private job!: HTMLElement;
  private jobBtn!: HTMLButtonElement;
  private lastPlot = 0;

  build() {
    this.chassis = { arm: new Chassis('arm'), x86: new Chassis('x86') };
    for (const c of Object.values(this.chassis)) {
      this.root.add(c.group);
      c.setExplode(this.explode);
      c.setPhantom(true);
    }
    this.applyArch();
    state.on('arch', () => this.applyArch());
    thermal.onJobDone = (secs, wh) => {
      state.revise(this.no, `4K export on ${SPEC[state.arch].short}: done in ${fmtDuration(secs)} using ${wh.toFixed(1)} Wh`);
      this.paintJob(secs, wh);
    };
  }

  private get c() {
    return this.chassis[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    const arm = a === 'arm';
    this.chassis.arm.group.visible = arm;
    this.chassis.x86.group.visible = !arm;
    const c = this.c;
    const s = SPEC[a];
    const T = THERMAL[a];
    c.group.updateMatrixWorld(true);
    c.socWorld.getWorldPosition(this.zoomTarget);
    this.view.height = arm ? 320 : 360;
    const refs: Ref[] = [
      { n: 300, name: 'Bottom case', text: arm ? 'Bead-blasted aluminium, 1 mm thick, with intake slots near the hinge and grilles for the two downward-firing woofers.' : 'A plastic bottom flap that unlocks with a slider, with a large intake grille: the three fans pull cool air in from underneath, so keep the vents clear of your lap.', facts: [['Material', arm ? 'aluminium alloy' : 'plastic, slider-latched flap']], target: c.anchors.case, off: [80, 40], parts: c.parts.case },
      { n: 302, name: 'Battery', text: `${s.cellConfig}, ${s.batteryWh} Wh at ${s.packV} V nominal. A protection board watches each cell's voltage and temperature and can disconnect the pack in microseconds.`, facts: [['Energy', `${s.batteryWh} Wh`], ['Pack voltage', `${s.packV} V`], ['Fastest charge', `${s.chargeMaxW} W`]], target: c.anchors.battery, off: [110, 30], parts: c.parts.battery, see: N.power },
      { n: 304, name: 'Logic board', text: arm ? 'One board under the hinge: the SoC with two LPDDR5X packages beside it, the power stages, Wi-Fi and the USB4 retimers. Everything heavy sits near the hinge so the palm rest stays cool.' : 'A ten-layer board between the two main fans, with a front strip for memory, storage and Wi-Fi. The processor and the GPU sit side by side under one vapor chamber.', facts: [['Layers', '10, HDI']], target: c.anchors.board, off: [90, -50], parts: c.parts.board, see: N.board },
      { n: 306, name: arm ? 'Heat spreader and pipe' : 'Vapor chamber and heat pipes', text: arm ? 'A copper spreader on the SoC feeds one flattened heat pipe to a fin stack in front of the fan. Water inside the sealed pipe boils at the hot end and condenses at the fins.' : 'A sealed copper vapor chamber over both processors spreads heat in every direction at once and carries it to fin stacks along the back, where all of the air leaves. Liquid metal sits between the CPU and the chamber.', facts: [['CPU to heatsink', `${T.Rcpu} K/W`], ['CPU limit', `${T.tjMax} °C`], ...(arm ? [] : ([['GPU limit', `${T.tgMax} °C`]] as [string, string][]))], target: c.anchors.thermal, off: [-120, -40], parts: [...(c.parts.thermal ?? []), ...(c.parts.pipes ?? []), ...(c.parts.fins ?? [])] },
      { n: 307, name: arm ? 'Fan' : 'Three fans', text: arm ? `A thin blower, 48 mm across, that stays off at idle and spins to ${T.fanMax} rpm under load.` : `Two 68 mm main fans with liquid-crystal-polymer blades and one auxiliary fan; together up to ${T.fanMax} rpm and about 54 dB(A).`, facts: [['Maximum', `${T.fanMax} rpm`], ['To air at full speed', `${T.RairFan} K/W`]], target: c.anchors.fans, off: [70, -40], parts: c.parts.fans },
      { n: 308, name: 'Speakers', text: `${s.speakers}. Each sealed box sets how deep its driver can go.`, target: c.anchors.speakers, off: [-70, -30], parts: c.parts.speakers, grind: true },
      { n: 310, name: 'Trackpad module', text: 'Glass, a capacitive sensor, four force sensors and a linear actuator.', target: c.anchors.trackpad, off: [90, 30], parts: c.parts.trackpad, grind: true },
      { n: 312, name: 'Top case and keyboard', text: 'The keyboard, its backlight and the key matrix are riveted to the top case: the part you touch, drawn here in phantom lines.', target: c.anchors.top, off: [-80, -40], parts: c.parts.top },
      { n: 314, name: 'SSD', text: s.ssd + '. Its controller and flash packages are on sheet 7.', target: c.anchors.ssd, off: [-60, 60], parts: c.parts.ssd, see: N.storage, grind: true },
    ];
    if (!arm) {
      refs.push({ n: 316, name: 'Discrete GPU', text: `${s.gpu}. Eight GDDR7 chips sit around it, each 3 GB on its own 32-bit channel.`, facts: [['Memory bandwidth', '896 GB/s'], ['Board power', '150 W + 25 W boost']], target: c.anchors.gpu, off: [80, -60], parts: [...(c.parts.gpu ?? []), ...(c.parts.gddr ?? [])] });
      refs.push({ n: 318, name: 'SO-DIMM memory', text: `${s.memory}: two modules stacked in one socket, so you can upgrade them.`, target: c.anchors.dimm, off: [-60, 60], parts: c.parts.dimm, see: N.memory, grind: true });
      refs.push({ n: 320, name: 'Voltage regulators', text: 'Rows of inductors and power stages beside each processor, turning 20 V into rails near 1 V at over 100 A combined.', target: c.anchors.vrm, off: [-50, 70], parts: c.parts.vrm, grind: true });
    }
    refs.sort((p, q) => Number(p.n) - Number(q.n));
    this.refs = refs;
    this.dims = [{ a: v(-s.w / 2, 0, s.d / 2), b: v(s.w / 2, 0, s.d / 2), space: c.group, off: 28, text: () => s.w.toFixed(1) }];
    this.paintJob();
    this.onRebuild();
  }

  panel() {
    const ex = slider({ label: 'Explode', min: 0, max: 1, step: 0.01, value: this.explode, format: (e) => `${Math.round(e * 100)} %`, onInput: (e) => {
      this.explode = e;
      for (const c of Object.values(this.chassis)) c.setExplode(e);
      this.c.socWorld.getWorldPosition(this.zoomTarget);
    } });
    const ph = segmented({ label: 'Top case, trackpad and speakers', options: [{ value: 'ph', label: 'Phantom lines' }, { value: 'solid', label: 'Solid' }], value: 'ph', onChange: (x) => Object.values(this.chassis).forEach((c) => c.setPhantom(x === 'ph')) });
    const wl = segmented<Workload>({
      label: 'Workload',
      options: (Object.keys(LOADS) as Workload[]).map((k) => ({ value: k, label: LOADS[k].label })),
      value: state.workload,
      wrap: true,
      onChange: (w) => {
        state.setWorkload(w);
        state.revise(this.no, `Workload: ${LOADS[w].label} on ${SPEC[state.arch].short}`);
      },
    });
    state.on('workload', () => wl.set(state.workload));
    const plug = segmented<'bat' | 'ac'>({ label: 'Power source', options: [{ value: 'bat', label: 'On battery' }, { value: 'ac', label: 'Charger plugged in' }], value: state.plugged ? 'ac' : 'bat', onChange: (x) => state.setPlugged(x === 'ac') });
    state.on('plugged', () => plug.set(state.plugged ? 'ac' : 'bat'));
    const amb = slider({ label: 'Room temperature', min: 10, max: 40, step: 1, value: thermal.ambient, format: (t) => `${t} °C`, onInput: (t) => (thermal.ambient = t) });
    const sp = segmented({ label: 'Simulation speed', options: [{ value: '1', label: 'Real time' }, { value: '10', label: '10 ×' }, { value: '60', label: '60 ×' }], value: String(thermal.speed) as '1' | '10' | '60', onChange: (x) => (thermal.speed = Number(x)) });
    this.ro = {
      p: readout({ label: 'Processor power', unit: 'W', digits: 1, min: 0, live: () => true }),
      tj: readout({ label: 'Processor temperature', unit: '°C', digits: 0, min: 20, max: 105, live: (t) => t > 60 }),
      gp: readout({ label: 'GPU power', unit: 'W', digits: 0, min: 0, live: () => true }),
      tg: readout({ label: 'GPU temperature', unit: '°C', digits: 0, min: 20, max: 100, live: (t) => t > 60 }),
      f: readout({ label: 'CPU clock', unit: 'GHz', digits: 2, min: 0 }),
      fan: readout({ label: 'Fans', digits: 0, min: 0 }),
      sys: readout({ label: 'Whole system', unit: 'W', digits: 0, min: 0 }),
      bat: readout({ label: 'Battery', trend: false }),
    };
    this.plot = new Plot({ x: [0, 600], y: [0, 180], xLabel: 'simulated time, s (last 10 min)', yLabel: '°C · W', xTicks: [0, 150, 300, 450, 600], yTicks: [0, 45, 90, 135, 180], caption: 'Red: temperatures (dashed: GPU). Black: power (dashed: GPU).' });
    this.limiter = h('span', { class: 'tag' }, '–');
    this.job = h('div', { class: 'job' });
    this.jobBtn = button('Run the 4K export job', () => {
      thermal.startJob();
      state.revise(this.no, `4K export started on ${SPEC[state.arch].short}`);
    }, { primary: true }) as HTMLButtonElement;
    this.paintJob();
    const gpuOnly = [this.ro.gp.el, this.ro.tg.el];
    const paintGpu = () => gpuOnly.forEach((e) => (e.style.display = state.arch === 'x86' ? '' : 'none'));
    state.on('arch', paintGpu);
    paintGpu();
    return h(
      'div',
      null,
      section(null, ex.el, wl.el, plug.el),
      section(
        'Heat and power',
        h('div', { class: 'btn-row' }, this.jobBtn, button('Cool down', () => thermal.reset())),
        this.job,
        h('div', { class: 'ro-grid' }, this.ro.p.el, this.ro.tj.el, ...gpuOnly, this.ro.sys.el, this.ro.bat.el),
        h('p', { class: 'note' }, 'Held back by ', this.limiter),
      ),
      grind('Detail', ph.el, amb.el, sp.el, h('div', { class: 'ro-grid' }, this.ro.f.el, this.ro.fan.el), this.plot.el, h('p', { class: 'note' }, 'Model: the processor and the GPU each have a thermal mass joined to a shared heatsink, cooled by fans that follow its temperature. x86 limits follow measurements of the reference machine in its fastest mode: CPU 165 W for 56 s, then 145 W; with the GPU busy the two share about 225 W, so the CPU drops to about 50 W beside a 175 W GPU (150 W plus 25 W boost); on battery 50 W and 55 W. ARM: 30 W sustained, 50 W bursts, the same on battery. A two-node network, not a fluid simulation.')),
    );
  }

  private paintJob(secs?: number, wh?: number) {
    if (!this.job) return;
    const pct = Math.min(100, (thermal.jobWork / JOB_WORK) * 100);
    if (thermal.jobRunning) {
      this.job.innerHTML = `<div class="job-row"><span>Exporting a 10 min 4K clip</span><strong class="tnum">${pct.toFixed(0)} %</strong></div><div class="job-bar"><i style="width:${pct}%"></i></div>`;
      this.jobBtn.disabled = true;
    } else if (secs !== undefined) {
      this.job.innerHTML = `<div class="job-row"><span>Export finished in</span><strong class="tnum">${fmtDuration(secs)}</strong></div><div class="job-row"><span>Energy used</span><strong class="tnum">${wh!.toFixed(1)} Wh</strong></div>`;
      this.jobBtn.disabled = false;
    } else {
      this.job.innerHTML = '<p class="note">The same job on both machines. Run it, swap the machine in the title block, run it again, and compare time and energy. Then try it unplugged.</p>';
      this.jobBtn.disabled = false;
    }
  }

  update(dt: number) {
    const c = this.c;
    const a = state.arch;
    const s = SPEC[a];
    const P = THERMAL[a];
    const qCpu = Math.max(0, (thermal.tDie - thermal.tBody) / P.Rcpu);
    const qGpu = P.gpuTgp ? Math.max(0, (thermal.tGpu - thermal.tBody) / P.Rgpu) : 0;
    const qAir = Math.max(0, thermal.heatOut());
    const batA = Math.max(0, -thermal.batteryW) / s.packV;
    const adA = thermal.adapterW / s.charger.volts;
    for (const f of c.flows) {
      const w = f.kind === 'cpu' ? qCpu / (a === 'x86' ? 3 : 1) : f.kind === 'gpu' ? qGpu / 3 : f.kind === 'air' ? qAir / (a === 'x86' ? 16 : 6) * 2 : f.kind === 'battery' ? batA * 4 : adA * 4;
      f.line.visible = w > 0.4;
      f.line.material.linewidth = 1 + Math.min(3.5, w / 5);
    }
    const spin = (thermal.rpm / 60) * 2 * Math.PI * (1 / 40);
    c.fans.forEach((f, i) => (f.rotation.y -= dt * spin * (i === 2 ? 1.3 : 1)));
    if (!this.ro) return;
    this.ro.p.set(thermal.power);
    this.ro.tj.set(thermal.tDie);
    this.ro.gp.set(thermal.gpuPower);
    this.ro.tg.set(thermal.tGpu);
    this.ro.f.set(thermal.freq);
    this.ro.fan.set(thermal.rpm, thermal.rpm < 50 ? 'stopped' : `${Math.round(thermal.rpm / 10) * 10} rpm · ${thermal.noiseDb().toFixed(0)} dB(A)`);
    this.ro.sys.set(thermal.systemW());
    const bw = thermal.batteryW;
    this.ro.bat.set(0, `${thermal.batteryPct().toFixed(0)} % · ${bw >= 0.3 ? `charging ${bw.toFixed(0)} W` : bw > -0.3 ? 'idle' : `${fmtDuration((thermal.batteryWh / -bw) * 3600)} left`}`);
    this.limiter.textContent = LIMIT[thermal.limitedBy] + (a === 'x86' && thermal.gpuPower > 1 ? ` · GPU: ${LIMIT[thermal.gpuLimitedBy]}` : '');
    const now = performance.now();
    if (now - this.lastPlot > 250) {
      this.lastPlot = now;
      const hs = thermal.hist;
      const t0 = hs.length ? Math.max(0, hs[hs.length - 1].t - 600) : 0;
      const series = [
        { color: tcs('#1d1f22'), width: 1.5, points: hs.map((x) => [x.t - t0, x.p] as [number, number]) },
        { color: tcs('#cf1f2e'), width: 1.75, points: hs.map((x) => [x.t - t0, x.tj] as [number, number]) },
      ];
      if (a === 'x86') {
        series.push({ color: tcs('#1d1f22'), width: 1.25, dash: [5, 3], points: hs.map((x) => [x.t - t0, x.pg] as [number, number]) } as never);
        series.push({ color: tcs('#cf1f2e'), width: 1.25, dash: [5, 3], points: hs.map((x) => [x.t - t0, x.tg] as [number, number]) } as never);
      }
      this.plot.series = series;
      this.plot.draw();
      if (thermal.jobRunning) this.paintJob();
    }
  }
}
