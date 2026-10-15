import * as THREE from 'three';
import { C, fillMat, hullMat, segments, polyline, ink, phantomMat, basicMat, v } from '../core/ink';
import { Sheet, type View } from '../core/sheet';
import { state } from '../core/state';
import { h, slider, segmented, readout, section, facts, button } from '../core/ui';
import { sci } from './s12-transistor';
import { N as SHEET } from './ids';

// Silicon: diamond cubic, a = 5.431 Å, nearest neighbours a·√3/4 = 2.352 Å.
const A = 5.431;
const N = 3; // unit cells per edge
const SI_DENSITY = 8 / Math.pow(A * 1e-8, 3); // atoms per cm³ ≈ 5.0e22
const Q = 1.602e-19;
const K_EV = 8.617e-5;

type Dopant = 'P' | 'B';

interface Carrier {
  kind: 'e' | 'h';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number; // seconds; Infinity for dopant carriers
}

function intrinsic(T: number) {
  // n_i(T) for silicon with the band gap narrowing with temperature (Varshni)
  const eg = (t: number) => 1.17 - (4.73e-4 * t * t) / (t + 636);
  return 1.0e10 * Math.pow(T / 300, 1.5) * Math.exp(-(eg(T) / (2 * K_EV * T) - eg(300) / (2 * K_EV * 300)));
}

/** mobility vs doping, Caughey–Thomas fit for silicon at 300 K */
function mobility(kind: 'e' | 'h', Nd: number) {
  const [mn, mx, nref, a] = kind === 'e' ? [68.5, 1414, 9.2e16, 0.711] : [44.9, 470.5, 2.23e17, 0.719];
  return mn + (mx - mn) / (1 + Math.pow(Nd / nref, a));
}

export class LatticeSheet extends Sheet {
  readonly no = SHEET.lattice;
  readonly title = 'The lattice';
  readonly short = 'lattice';
  readonly mmPerUnit = 1e-7; // 1 Å
  readonly sub = `Silicon crystal, ${N} × ${N} × ${N} unit cells, ball-and-stick, dimensions in ångström`;
  view: View = { height: 30, az: -34, el: 22, target: new THREE.Vector3((N * A) / 2, (N * A) / 2 - 1, (N * A) / 2), minZoom: 0.5, maxZoom: 12 };
  atoms: THREE.Vector3[] = [];
  bonds: [number, number][] = [];
  dopants = new Map<number, Dopant>();
  dopant: Dopant = 'P';
  conc = 1e17; // cm⁻³
  temp = 300;
  field = false;
  carriers: Carrier[] = [];
  private fill!: THREE.InstancedMesh;
  private hull!: THREE.InstancedMesh;
  private dopFill!: THREE.InstancedMesh;
  private carrierMesh!: THREE.InstancedMesh;
  private holeMesh!: THREE.InstancedMesh;
  private bondLines!: THREE.Object3D;
  private brokenGroup = new THREE.Group();
  private genAcc = 0;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private dopBox!: HTMLElement;
  private lastPaint = 0;
  private m4 = new THREE.Matrix4();
  private bounds = N * A;

  build() {
    // atoms of the diamond lattice inside the box, including the far faces
    const basis = [
      [0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0],
      [0.25, 0.25, 0.25], [0.25, 0.75, 0.75], [0.75, 0.25, 0.75], [0.75, 0.75, 0.25],
    ];
    const key = (p: THREE.Vector3) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    const seen = new Set<string>();
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++)
        for (let k = 0; k <= N; k++)
          for (const b of basis) {
            const p = new THREE.Vector3((i + b[0]) * A, (j + b[1]) * A, (k + b[2]) * A);
            if (p.x > N * A + 0.01 || p.y > N * A + 0.01 || p.z > N * A + 0.01) continue;
            const kk = key(p);
            if (seen.has(kk)) continue;
            seen.add(kk);
            this.atoms.push(p);
          }
    const dNN = (A * Math.sqrt(3)) / 4;
    for (let i = 0; i < this.atoms.length; i++)
      for (let j = i + 1; j < this.atoms.length; j++) if (Math.abs(this.atoms[i].distanceTo(this.atoms[j]) - dNN) < 0.05) this.bonds.push([i, j]);

    const geo = new THREE.SphereGeometry(0.4, 16, 12);
    this.fill = new THREE.InstancedMesh(geo, fillMat(C.paper), this.atoms.length);
    this.hull = new THREE.InstancedMesh(geo, hullMat(1.1), this.atoms.length);
    this.dopFill = new THREE.InstancedMesh(new THREE.SphereGeometry(0.46, 16, 12), fillMat(C.tone3), 8);
    this.dopFill.count = 0;
    this.atoms.forEach((p, i) => {
      this.m4.makeTranslation(p.x, p.y, p.z);
      this.fill.setMatrixAt(i, this.m4);
      this.hull.setMatrixAt(i, this.m4);
    });
    this.root.add(this.fill, this.hull, this.dopFill);
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of this.bonds) pts.push(this.atoms[a], this.atoms[b]);
    this.bondLines = segments(pts, ink(1.1));
    this.root.add(this.bondLines, this.brokenGroup);
    // one unit cell outlined, with its dimension
    const c = (x: number, y: number, z: number) => v(x * A, y * A, z * A);
    const cube: THREE.Vector3[] = [];
    const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) cube.push(c(...(corners[p] as [number, number, number])), c(...(corners[q] as [number, number, number])));
    this.root.add(segments(cube.map((p) => p.clone().add(new THREE.Vector3(0, 0, (N - 1) * A))), phantomMat()));
    this.carrierMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), basicMat(C.red, { depthTest: false }), 64);
    this.carrierMesh.renderOrder = 10;
    this.carrierMesh.count = 0;
    this.holeMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.32, 0.09, 6, 16), basicMat(C.red, { depthTest: false }), 64);
    this.holeMesh.renderOrder = 10;
    this.holeMesh.count = 0;
    this.root.add(this.carrierMesh, this.holeMesh);

    const anchor = (p: THREE.Vector3) => {
      const o = new THREE.Object3D();
      o.position.copy(p);
      this.root.add(o);
      return o;
    };
    const center = this.atoms.reduce((best, p, i) => (p.distanceTo(new THREE.Vector3(N * A * 0.75, N * A, N * A * 0.75)) < this.atoms[best].distanceTo(new THREE.Vector3(N * A * 0.75, N * A, N * A * 0.75)) ? i : best), 0);
    const front = this.atoms.findIndex((p) => Math.abs(p.x - A * 0.75) < 0.01 && Math.abs(p.y - A * 0.25) < 0.01 && Math.abs(p.z - (N - 0.25) * A) < 0.01);
    const bondMid = this.atoms[this.bonds[0][0]].clone().lerp(this.atoms[this.bonds[0][1]], 0.5);
    this.refs = [
      { n: 1300, name: 'Silicon atom', text: 'Fourteen protons; four outer electrons that it shares, one with each neighbour. Select any atom on the drawing to replace it with the dopant chosen on the right.', facts: [['Atomic number', '14'], ['Valence electrons', '4']], target: anchor(this.atoms[center]), off: [70, -50], parts: [] },
      { n: 1302, name: 'Covalent bond', text: 'Two shared electrons hold each pair of neighbours together, 2.352 Å apart. Every atom has four, pointing to the corners of a tetrahedron at 109.47° to one another. With every bond full, no electron is free to move: pure silicon barely conducts.', facts: [['Bond length', '2.352 Å'], ['Bond angle', '109.47°'], ['Band gap', '1.12 eV']], target: anchor(bondMid), off: [-80, 40], parts: [] },
      { n: 1304, name: 'Unit cell', text: `The smallest block that repeats: a cube 5.431 Å on each edge holding 8 atoms, so silicon has ${sci(SI_DENSITY, 2)} atoms per cm³. A 5 nm nanosheet on sheet 12 is about nine of these thick.`, facts: [['Lattice constant', '5.431 Å'], ['Atoms per cell', '8']], target: anchor(c(1, 1, N)), off: [60, -60], parts: [] },
      { n: 1306, name: 'Dopant site', text: 'Phosphorus has five outer electrons: four fill the bonds and the fifth is free at room temperature. Boron has three, leaving a hole that moves like a positive charge. One dopant in a hundred thousand atoms gives silicon tens of millions of times more free carriers than it has on its own.', target: anchor(this.atoms[front >= 0 ? front : 0]), off: [-70, -40], parts: [] },
    ];
    this.dims = [{ a: c(0, 0, N), b: c(1, 0, N), space: this.root, off: 26, text: () => '5.431 Å' }];
    // start with one phosphorus atom so the idea is visible immediately
    this.setDopant(front >= 0 ? front : 0, 'P');
  }

  private setDopant(i: number, d: Dopant | null) {
    if (d) this.dopants.set(i, d);
    else this.dopants.delete(i);
    if (this.dopants.size > 8) this.dopants.delete(this.dopants.keys().next().value!);
    let k = 0;
    for (const [idx] of this.dopants) {
      const p = this.atoms[idx];
      this.m4.makeTranslation(p.x, p.y, p.z);
      this.dopFill.setMatrixAt(k++, this.m4);
    }
    this.dopFill.count = k;
    this.dopFill.instanceMatrix.needsUpdate = true;
    // each dopant contributes one carrier: an electron for P, a hole for B
    this.carriers = this.carriers.filter((c) => c.life !== Infinity);
    for (const [idx, kind] of this.dopants) {
      this.carriers.push({ kind: kind === 'P' ? 'e' : 'h', pos: this.atoms[idx].clone().add(new THREE.Vector3(0.8, 0.8, 0.8)), vel: new THREE.Vector3(), life: Infinity });
    }
    this.paintBroken();
  }

  /** boron leaves one bond with a missing electron: drawn as a phantom bond */
  private paintBroken() {
    this.brokenGroup.clear();
    for (const [idx, kind] of this.dopants) {
      if (kind !== 'B') continue;
      const b = this.bonds.find(([p, q]) => p === idx || q === idx);
      if (!b) continue;
      this.brokenGroup.add(polyline([this.atoms[b[0]], this.atoms[b[1]]], ink(2.4, C.red)));
    }
  }

  pickRay(ray: THREE.Raycaster): boolean {
    const hits = ray.intersectObject(this.fill, false);
    if (!hits.length || hits[0].instanceId === undefined) return false;
    const i = hits[0].instanceId;
    const was = this.dopants.get(i);
    this.setDopant(i, was === this.dopant ? null : this.dopant);
    state.revise(this.no, `${was === this.dopant ? 'Removed' : this.dopant === 'P' ? 'Placed phosphorus' : 'Placed boron'} in the lattice`);
    this.paint(true);
    return true;
  }

  panel() {
    const dop = segmented<Dopant>({ label: 'Dopant to place', options: [{ value: 'P', label: 'Phosphorus · n-type' }, { value: 'B', label: 'Boron · p-type' }], value: this.dopant, onChange: (x) => { this.dopant = x; this.paint(true); } });
    const conc = slider({ label: 'Doping concentration', min: 14, max: 21, step: 0.1, value: Math.log10(this.conc), format: (x) => `${sci(Math.pow(10, x))} cm⁻³`, onInput: (x) => { this.conc = Math.pow(10, x); this.paint(true); } });
    const temp = slider({ label: 'Temperature', min: 200, max: 700, step: 5, value: this.temp, format: (x) => `${x} K · ${(x - 273.15).toFixed(0)} °C`, onInput: (x) => { this.temp = x; this.paint(true); } });
    const fld = segmented({ label: 'Electric field', options: [{ value: 'off', label: 'None' }, { value: 'on', label: 'Apply, left to right' }], value: 'off', onChange: (x) => (this.field = x === 'on') });
    this.ro = {
      n: readout({ label: 'Free carriers', unit: 'per cm³', trend: false }),
      rho: readout({ label: 'Resistivity', unit: 'Ω·cm', trend: false }),
      ratio: readout({ label: 'Dopant atoms', trend: false }),
      gain: readout({ label: 'Conducts better than pure Si by', trend: false }),
    };
    this.dopBox = h('div');
    this.paint(true);
    return h(
      'div',
      null,
      section(null, h('p', { class: 'note' }, 'Select atoms on the drawing to swap them for the dopant below. Red dots are free electrons, red rings are holes.'), dop.el, h('div', { class: 'btn-row' }, button('Clear dopants', () => { [...this.dopants.keys()].forEach((i) => this.setDopant(i, null)); this.paint(true); })), conc.el, temp.el, fld.el),
      section('What the crystal can do', h('div', { class: 'ro-grid' }, this.ro.n.el, this.ro.rho.el, this.ro.ratio.el, this.ro.gain.el), this.dopBox),
      section('Back to the beginning', h('p', { class: 'note' }, 'Every sheet before this one is made of this: a crystal grown from sand, purified to nine nines, then doped atom by atom in the places the drawing on sheet 12 says. Tens of billions of transistors, and every key you pressed on sheet 1 moved electrons through them.')),
    );
  }

  private paint(force: boolean) {
    const now = performance.now();
    if (!this.ro || (!force && now - this.lastPaint < 200)) return;
    this.lastPaint = now;
    const T = this.temp;
    const ni = intrinsic(T);
    const Nd = this.conc;
    const kind = this.dopant === 'P' ? 'e' : 'h';
    // majority carriers: fully ionised dopants, or intrinsic when hotter than that
    const maj = Nd / 2 + Math.sqrt((Nd / 2) ** 2 + ni * ni);
    const mu = mobility(kind, Nd) * Math.pow(T / 300, -2.2);
    const rho = 1 / (Q * maj * mu);
    const ni300 = intrinsic(300);
    const rhoPure = 1 / (Q * ni * (mobility('e', 1) + mobility('h', 1)) * Math.pow(T / 300, -2.2));
    const rhoPure300 = 1 / (Q * ni300 * (1414 + 470.5));
    this.ro.n.set(0, sci(maj));
    this.ro.rho.set(0, rho < 1e-3 || rho > 1e4 ? sci(rho, 2) : rho.toPrecision(3));
    this.ro.ratio.set(0, `1 in ${Math.round(SI_DENSITY / Nd).toLocaleString('en')}`);
    this.ro.gain.set(0, `${sci(rhoPure / rho)} ×`);
    const vol = 30e-7 * 5e-7 * 14e-7; // one nanosheet under the gate, cm³
    this.dopBox.replaceChildren(
      facts([
        ['Silicon atoms per cm³', sci(SI_DENSITY, 2)],
        ['Intrinsic carriers at this temperature', `${sci(ni)} cm⁻³`],
        ['Pure silicon at 300 K', `${sci(rhoPure300, 1)} Ω·cm`],
        [`${kind === 'e' ? 'Electron' : 'Hole'} mobility`, `${mu.toFixed(0)} cm²/V·s`],
        ['Dopant atoms in one nanosheet at this level', (Nd * vol).toFixed(Nd * vol < 10 ? 2 : 0)],
      ]),
      h('p', { class: 'note' }, Nd * vol < 5 ? 'At this concentration one nanosheet holds only a handful of dopant atoms, and two transistors would differ by which atoms happened to land where. That is why modern channels are left undoped and set by the gate metal instead.' : 'Heavily doped regions like the source and drain hold thousands of dopant atoms each, so their behaviour averages out.'),
    );
  }

  update(dt: number) {
    if (!this.carrierMesh) return;
    const b = this.bounds;
    // thermal generation: electron–hole pairs appear in proportion to n_i, and recombine
    const ni = intrinsic(this.temp);
    const rate = Math.max(0, (Math.log10(ni) - 8) / 8) * 4; // pairs per second, drawn
    this.genAcc += dt * rate;
    while (this.genAcc > 1 && this.carriers.length < 60) {
      this.genAcc -= 1;
      const [a, c] = this.bonds[Math.floor(Math.random() * this.bonds.length)];
      const p = this.atoms[a].clone().lerp(this.atoms[c], 0.5);
      this.carriers.push({ kind: 'e', pos: p.clone(), vel: new THREE.Vector3(), life: 3 + Math.random() * 3 });
      this.carriers.push({ kind: 'h', pos: p.clone(), vel: new THREE.Vector3(), life: 3 + Math.random() * 3 });
    }
    let ke = 0, kh = 0;
    const keep: Carrier[] = [];
    for (const c of this.carriers) {
      c.life -= dt;
      if (c.life <= 0) continue;
      // random thermal walk, plus drift when a field is applied
      const jitter = 3.2 * Math.sqrt(this.temp / 300);
      c.vel.x += (Math.random() - 0.5) * jitter * dt * 12;
      c.vel.y += (Math.random() - 0.5) * jitter * dt * 12;
      c.vel.z += (Math.random() - 0.5) * jitter * dt * 12;
      c.vel.multiplyScalar(0.92);
      if (this.field) c.vel.x += (c.kind === 'e' ? -1 : 1) * dt * 6;
      c.pos.addScaledVector(c.vel, dt * 4);
      for (const ax of ['x', 'y', 'z'] as const) {
        if (c.pos[ax] < 0) c.pos[ax] += b;
        if (c.pos[ax] > b) c.pos[ax] -= b;
      }
      this.m4.makeTranslation(c.pos.x, c.pos.y, c.pos.z);
      if (c.kind === 'e') this.carrierMesh.setMatrixAt(ke++, this.m4);
      else this.holeMesh.setMatrixAt(kh++, this.m4);
      keep.push(c);
    }
    this.carriers = keep;
    this.carrierMesh.count = ke;
    this.holeMesh.count = kh;
    this.carrierMesh.instanceMatrix.needsUpdate = true;
    this.holeMesh.instanceMatrix.needsUpdate = true;
    this.paint(false);
  }

  enter() {
    this.zoomTarget.set((N * A) / 2, (N * A) / 2, (N * A) / 2);
  }
}

