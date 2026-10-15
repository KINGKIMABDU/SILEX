import * as THREE from 'three';
import { tcs } from '../core/theme';
import { C, Part, box, v, polyline, ink, hatchTexture, basicMat } from '../core/ink';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state } from '../core/state';
import { h, slider, segmented, readout, section, Plot, facts, fmtSI } from '../core/ui';
import { SPEC } from '../core/specs';
import { N } from './ids';

type Dev = 'gaa' | 'fin';
type Hatch = 'si' | 'metal' | 'oxide' | 'poly';

const PHI_T = 0.02585; // thermal voltage at 300 K

interface Model {
  n: number; // subthreshold slope factor
  vt: number;
  dibl: number;
  wEff: number; // µm
  is: number; // A per µm
  theta: number;
}

const MODELS: Record<Dev, Model> = {
  gaa: { n: 1.07, vt: 0.25, dibl: 0.04, wEff: 0.21, is: 19.7e-6, theta: 1.2 },
  fin: { n: 1.16, vt: 0.25, dibl: 0.07, wEff: 0.212, is: 18.5e-6, theta: 1.2 },
};

/** EKV-style compact model: one smooth expression from deep subthreshold to strong inversion. */
export function drainCurrent(m: Model, vg: number, vd: number): number {
  const vt = m.vt - m.dibl * vd;
  const f = (x: number) => {
    const l = x > 30 ? x : Math.log1p(Math.exp(x));
    return l * l;
  };
  const iF = f((vg - vt) / (2 * m.n * PHI_T));
  const iR = f((vg - vt - m.n * vd) / (2 * m.n * PHI_T));
  const vgt = Math.max(0, vg - vt);
  return (m.is * m.wEff * (iF - iR)) / (1 + m.theta * vgt);
}

interface Lane {
  y: number;
  z0: number;
  z1: number;
}

class Device {
  group = new THREE.Group();
  parts: Record<string, Part[]> = {};
  caps: THREE.Object3D[] = [];
  lanes: Lane[] = [];
  anchors: Record<string, THREE.Object3D> = {};
  cutZ: number;
  chanX: [number, number];

  constructor(public kind: Dev) {
    const gaa = kind === 'gaa';
    this.cutZ = gaa ? 0 : 13;
    this.chanX = gaa ? [-7, 7] : [-8, 8];
    const B = (key: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hatch: Hatch, tone: number, front = 0) => {
      const p = new Part(box(x1 - x0, y1 - y0, z1 - z0), { width: 1.1, threshold: 30, fill: tone });
      p.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.group.add(p);
      (this.parts[key] ??= []).push(p);
      if (this.cutZ > z0 && this.cutZ < z1) {
        const tex = hatchTexture(hatch);
        tex.repeat.set((x1 - x0) / 9, (y1 - y0) / 9);
        const cap = new THREE.Group();
        const face = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshBasicMaterial({ map: tex }));
        cap.add(face);
        cap.add(polyline([v(-(x1 - x0) / 2, -(y1 - y0) / 2, 0), v((x1 - x0) / 2, -(y1 - y0) / 2, 0), v((x1 - x0) / 2, (y1 - y0) / 2, 0), v(-(x1 - x0) / 2, (y1 - y0) / 2, 0)], ink(1.1), true));
        cap.position.set((x0 + x1) / 2, (y0 + y1) / 2, this.cutZ - 0.05 + front * 0.02);
        this.group.add(cap);
        this.caps.push(cap);
      }
      return p;
    };
    const A = (k: string, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      this.group.add(o);
      this.anchors[k] = o;
    };
    B('substrate', -64, 64, -24, 0, -36, 36, 'si', C.tone1);
    if (gaa) {
      B('spacer', -12, -7, 0, 46, -24, 24, 'oxide', C.paper);
      B('spacer', 7, 12, 0, 46, -24, 24, 'oxide', C.paper);
      B('gate', -7, 7, 0, 46, -26, 26, 'metal', C.tone3);
      B('source', -40, -12, 0, 40, -22, 22, 'poly', C.tone1);
      B('drain', 12, 40, 0, 40, -22, 22, 'poly', C.tone1);
      for (let i = 0; i < 3; i++) {
        const y = 8 + i * 10;
        B('channel', -26, 26, y, y + 5, -15, 15, 'si', C.tone2, 2);
        this.lanes.push({ y: y + 2.5, z0: -14, z1: this.cutZ - 0.5 });
      }
      B('contact', -36, -16, 40, 60, -14, 14, 'metal', C.tone2, 1);
      B('contact', 16, 36, 40, 60, -14, 14, 'metal', C.tone2, 1);
      B('contact', -5, 5, 46, 62, -10, 10, 'metal', C.tone2, 1);
      // leader tips sit on the section face, where the cut shows each part
      const f = this.cutZ - 0.3;
      A('channel', 0, 33, 6);
      A('gate', 0, 44, f);
      A('source', -30, 30, f);
      A('drain', 30, 30, f);
      A('spacer', 9.5, 30, f);
      A('contact', 26, 55, f);
      A('substrate', -50, -12, f);
    } else {
      B('spacer', -13, -8, 0, 58, -32, 32, 'oxide', C.paper);
      B('spacer', 8, 13, 0, 58, -32, 32, 'oxide', C.paper);
      B('gate', -8, 8, 0, 58, -32, 32, 'metal', C.tone3);
      B('source', -42, -13, 8, 56, -26, 26, 'poly', C.tone1);
      B('drain', 13, 42, 8, 56, -26, 26, 'poly', C.tone1);
      for (const zc of [-13, 13]) {
        // the fin is silicon only under the gate and spacers; at the ends it is recessed and regrown as the source and drain
        B('channel', -13, 13, 0, 50, zc - 3, zc + 3, 'si', C.tone2, 2);
        B('channel', -44, -13, 0, 8, zc - 3, zc + 3, 'si', C.tone2, 2);
        B('channel', 13, 44, 0, 8, zc - 3, zc + 3, 'si', C.tone2, 2);
        // carriers are drawn in the fin the section passes through; the other one is behind solid material
        if (zc === this.cutZ) for (const y of [10, 22, 34, 46]) this.lanes.push({ y, z0: zc - 2.8, z1: zc - 0.5 });
      }
      B('contact', -38, -17, 56, 74, -16, 16, 'metal', C.tone2, 1);
      B('contact', 17, 38, 56, 74, -16, 16, 'metal', C.tone2, 1);
      B('contact', -5, 5, 58, 74, -12, 12, 'metal', C.tone2, 1);
      const f = this.cutZ - 0.3;
      A('channel', 0, 48, 13);
      A('gate', 0, 54, f);
      A('source', -30, 40, f);
      A('drain', 30, 40, f);
      A('spacer', 10.5, 40, f);
      A('contact', 27, 68, f);
      A('substrate', -50, -12, f);
    }
  }

  setSection(on: boolean) {
    for (const c of this.caps) c.visible = on;
  }
}

const MAX_E = 180;

export function sci(x: number, d = 1): string {
  const e = Math.floor(Math.log10(x));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(d)} × 10^${e}`;
}

export class TransistorSheet extends Sheet {
  readonly no = N.transistor;
  readonly title = 'The transistor';
  readonly short = 'transistor';
  readonly mmPerUnit = 1e-6;
  readonly sub = 'One n-type transistor, cut along its channel, dimensions in nanometres';
  view: View = { height: 128, az: 32, el: 16, target: new THREE.Vector3(2, 24, 0), minZoom: 0.5, maxZoom: 20 };
  devices!: Record<Dev, Device>;
  dev: Dev = 'fin';
  vg = 0.75;
  vd = 0.75;
  sectionOn = true;
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private electrons!: THREE.InstancedMesh;
  private ePos: { x: number; lane: number; z: number; jitter: number }[] = [];
  private spawnAcc = 0;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private regionEl!: HTMLElement;
  private lastPaint = 0;
  private m4 = new THREE.Matrix4();

  build() {
    this.devices = { gaa: new Device('gaa'), fin: new Device('fin') };
    for (const d of Object.values(this.devices)) this.root.add(d.group);
    this.electrons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 8, 6), basicMat(C.red, { depthTest: false }), MAX_E);
    this.electrons.renderOrder = 10;
    this.electrons.count = 0;
    this.electrons.frustumCulled = false;
    this.root.add(this.electrons);
    this.clipPlanes = [this.plane];
    this.applyDev();
  }

  private get d() {
    return this.devices[this.dev];
  }

  onRebuild: () => void = () => {};

  private applyDev() {
    const gaa = this.dev === 'gaa';
    this.devices.gaa.group.visible = gaa;
    this.devices.fin.group.visible = !gaa;
    const d = this.d;
    this.plane.constant = this.sectionOn ? d.cutZ : 1e4;
    d.setSection(this.sectionOn);
    this.ePos = [];
    d.anchors.channel.getWorldPosition(this.zoomTarget);
    const P = d.parts;
    const refs: Ref[] = [
      { n: 1200, name: gaa ? 'Nanosheet channels' : 'Fins', text: gaa ? 'Three ribbons of silicon, 5 nm thick and 30 nm wide, stacked 10 nm apart. The gate wraps all four sides of each one, so it controls the channel completely and leakage drops.' : 'Two vertical fins of silicon, 6 nm wide and 50 nm tall. The gate covers three sides of each fin. This was the standard from 22 nm until the 3 nm generation, and it is what both machines on sheet 1 use.', facts: gaa ? [['Sheet thickness', '5 nm, about 9 unit cells of the crystal'], ['Sheet width', '30 nm']] : [['Fin width', '6 nm'], ['Fin height', '50 nm'], ['Fin pitch', '26 nm']], target: d.anchors.channel, off: [70, -70], parts: P.channel, see: N.lattice },
      { n: 1202, name: 'Gate stack', text: 'A metal gate over about 1.5 nm of hafnium oxide. Its voltage pulls electrons into the channel by field effect; no current flows through the gate itself.', facts: [['Gate length', gaa ? '14 nm' : '16 nm'], ['Dielectric', 'HfO₂ on SiO₂, ≈ 0.9 nm equivalent']], target: d.anchors.gate, off: [-30, -70], parts: P.gate },
      { n: 1204, name: 'Source', text: 'Silicon grown on the ends of the channel and doped with phosphorus to about 10²¹ atoms per cm³: a reservoir full of free electrons.', target: d.anchors.source, off: [-70, -40], parts: P.source },
      { n: 1206, name: 'Drain', text: 'The same as the source. With a voltage on it, electrons that cross the channel are collected here.', target: d.anchors.drain, off: [70, -40], parts: P.drain },
      { n: 1208, name: 'Spacers', text: 'Thin insulating walls between the gate and the source and drain, so the gate does not short to them and the capacitance between them stays small.', target: d.anchors.spacer, off: [60, -80], parts: P.spacer },
      { n: 1210, name: 'Contacts', text: 'Tungsten or cobalt plugs connecting the device to the first metal layer, M0, 23 nm apart (see Detail B on sheet 8).', target: d.anchors.contact, off: [70, -30], parts: P.contact },
      { n: 1212, name: 'Substrate', text: 'The silicon wafer the device is built in, about 0.78 mm thick before it is thinned. Isolation oxide keeps neighbouring transistors apart.', target: d.anchors.substrate, off: [-60, 40], parts: P.substrate },
    ];
    this.refs = refs;
    const gx = d.chanX;
    const top = gaa ? 46 : 58;
    this.dims = [
      { a: v(gx[0], top, -26), b: v(gx[1], top, -26), space: d.group, off: -26, text: () => `${gx[1] - gx[0]} nm` },
      { a: v(-40, 0, 36), b: v(40, 0, 36), space: d.group, off: 22, text: () => '80 nm' },
    ];
    this.onRebuild();
  }

  panel() {
    const dev = segmented<Dev>({ label: 'Device', options: [{ value: 'fin', label: 'FinFET · in these machines' }, { value: 'gaa', label: 'Gate-all-around · next' }], value: this.dev, onChange: (x) => {
      this.dev = x;
      this.applyDev();
      this.paint(true);
      state.revise(this.no, `Transistor: ${x === 'gaa' ? 'gate-all-around nanosheets' : 'FinFET'}`);
    } });
    const vg = slider({ label: 'Gate voltage', min: 0, max: 0.85, step: 0.005, value: this.vg, format: (x) => `${x.toFixed(3)} V`, onInput: (x) => { this.vg = x; this.paint(true); } });
    const vd = slider({ label: 'Drain voltage', min: 0, max: 0.85, step: 0.005, value: this.vd, format: (x) => `${x.toFixed(3)} V`, onInput: (x) => { this.vd = x; this.paint(true); } });
    const sec = segmented({ label: 'View', options: [{ value: 'cut', label: 'Section along the channel' }, { value: 'whole', label: 'Whole device' }], value: 'cut', onChange: (x) => {
      this.sectionOn = x === 'cut';
      this.applyDev();
    } });
    this.ro = {
      id: readout({ label: 'Drain current', unit: '', digits: 2, min: 0 }),
      onoff: readout({ label: 'On / off ratio', trend: false }),
      ss: readout({ label: 'Subthreshold swing', unit: 'mV/dec', digits: 0, trend: false }),
      tau: readout({ label: 'Time to charge a gate', unit: 'ps', digits: 2, trend: false }),
    };
    this.regionEl = h('p', { class: 'note' });
    this.plot = new Plot({ x: [0, 0.85], y: [1e-10, 1e-3], logY: true, xLabel: 'gate voltage, V', yLabel: 'drain current, A', xTicks: [0, 0.2, 0.4, 0.6, 0.8], yTicks: [1e-10, 1e-8, 1e-6, 1e-4], fmtY: (y) => `10${'⁻' + String(-Math.round(Math.log10(y))).replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c])}`, caption: 'Log scale: below threshold the current falls ten times for every ~65 mV less on the gate. Grey dashed: the other device.' });
    this.paint(true);
    return h(
      'div',
      null,
      section(null, dev.el, vg.el, vd.el, sec.el),
      section('Current', h('div', { class: 'ro-grid' }, this.ro.id.el, this.ro.onoff.el, this.ro.ss.el, this.ro.tau.el), this.regionEl, this.plot.el),
      section('Scale', facts([['Contacted gate pitch', '48 nm'], ['Gate length', this.dev === 'gaa' ? '14 nm' : '16 nm'], ['Electrons in the channel when on', '≈ 1,000'], ['Transistors on this die', `≈ ${SPEC[state.arch].transistorsB} billion, estimated`]]), h('p', { class: 'note' }, '"3 nm" and "2 nm" are generation names, not a length anywhere on the device. The smallest real features are the sheets and the gate oxide.')),
    );
  }

  private paint(force: boolean) {
    const now = performance.now();
    if (!this.ro || (!force && now - this.lastPaint < 120)) return;
    this.lastPaint = now;
    const m = MODELS[this.dev];
    const id = drainCurrent(m, this.vg, this.vd);
    const ion = drainCurrent(m, 0.75, 0.75), ioff = drainCurrent(m, 0, 0.75);
    this.ro.id.set(id, fmtSI(id, 'A', 3));
    this.ro.onoff.set(0, sci(ion / ioff));
    this.ro.ss.set(m.n * PHI_T * Math.LN10 * 1000);
    const cg = 0.17e-15;
    this.ro.tau.set(((cg * 0.75) / ion) * 1e12);
    const vt = m.vt - m.dibl * this.vd;
    this.regionEl.textContent =
      this.vg < vt - 0.08
        ? `Off. ${this.vg.toFixed(2)} V is below the threshold of ${vt.toFixed(2)} V; only a trickle of electrons gets over the barrier, ${fmtSI(id, 'A', 2)} of leakage. Multiply by ${SPEC[state.arch].transistorsB} billion transistors and that is why an idle chip still draws power.`
        : this.vg < vt + 0.05
          ? `At the threshold, ${vt.toFixed(2)} V. The barrier under the gate is almost flat and the current grows exponentially with every millivolt.`
          : `On. The gate has drawn a layer of electrons into the channel; ${fmtSI(id, 'A', 3)} flows from source to drain.`;
    const curve = (mm: Model) => {
      const pts: [number, number][] = [];
      for (let g = 0; g <= 0.85 + 1e-9; g += 0.01) pts.push([g, drainCurrent(mm, g, this.vd)]);
      return pts;
    };
    const other = MODELS[this.dev === 'gaa' ? 'fin' : 'gaa'];
    this.plot.series = [
      { color: tcs('#8b8e88'), width: 1.25, dash: [4, 3], points: curve(other) },
      { color: tcs('#1d1f22'), width: 1.75, points: curve(m) },
    ];
    this.plot.marker = [this.vg, Math.max(1e-10, id)];
    this.plot.markerLive = this.vg > vt;
    this.plot.draw();
  }

  update(dt: number) {
    const d = this.d;
    const m = MODELS[this.dev];
    const id = drainCurrent(m, this.vg, this.vd);
    // electrons in the channel: inversion charge, smooth from exponential to linear
    const vt = m.vt - m.dibl * this.vd;
    const q = 2 * m.n * PHI_T * Math.log1p(Math.exp((this.vg - vt) / (2 * m.n * PHI_T)));
    const want = Math.round(Math.min(MAX_E, 2 + q * 300));
    // rate of crossings follows the current; drawn speed is slowed by many orders of magnitude
    const flux = Math.log10(Math.max(id, 1e-12) / 1e-12) / 9; // 0..1
    const speed = 6 + 70 * flux * (this.vd > 0.005 ? Math.min(1, this.vd / 0.2) : 0);
    this.spawnAcc += dt * want * (speed / 50);
    while (this.ePos.length < want && this.spawnAcc > 0) {
      this.spawnAcc -= 1;
      const lane = Math.floor(Math.random() * d.lanes.length);
      const L = d.lanes[lane];
      this.ePos.push({ x: d.chanX[0] - 6 + Math.random() * (d.chanX[1] - d.chanX[0] + 12), lane, z: L.z0 + Math.random() * (L.z1 - L.z0), jitter: Math.random() * 6.28 });
    }
    if (this.ePos.length > want) this.ePos.length = want;
    let k = 0;
    const x0 = d.chanX[0] - 8, x1 = d.chanX[1] + 8;
    for (const e of this.ePos) {
      e.x += speed * dt * (0.7 + 0.6 * Math.sin(e.jitter + e.x));
      if (e.x > x1) e.x = x0 + Math.random() * 2;
      const L = d.lanes[e.lane];
      if (!L) continue;
      this.m4.makeTranslation(e.x, L.y + Math.sin(e.jitter * 3 + e.x * 0.7) * 1.2, e.z);
      this.electrons.setMatrixAt(k++, this.m4);
    }
    this.electrons.count = k;
    this.electrons.instanceMatrix.needsUpdate = true;
    for (const p of d.parts.gate ?? []) p.setLive(this.vg > vt);
    this.paint(false);
  }
}
