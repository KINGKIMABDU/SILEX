import * as THREE from 'three';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { C, Part, v, polyline, ink, lineMat, phantomMat } from '../core/ink';

let idleMat: ReturnType<typeof lineMat> | null = null;
let gapMat: ReturnType<typeof lineMat> | null = null;
/** a wire at 0 is idle: dashed. A transistor that is off is gapped. */
const IDLE = () => (idleMat ??= lineMat({ width: 1, dashed: true, dash: 1.3, gap: 0.9 }));
const GAP = () => (gapMat ??= lineMat({ width: 2.2, dashed: true, dash: 2.2, gap: 3.2 }));
import { Sheet, type View, type Ref, type Tag } from '../core/sheet';
import { state } from '../core/state';
import { h, slider, readout, button, section, facts } from '../core/ui';
import { N } from './ids';

// A 4-bit ripple-carry adder built from 36 NAND gates (9 per full adder), simulated event by event.

const BLOCK = 34; // z spacing between bit slices
const VDD = 0.75;
const C_NODE = 0.5e-15; // farads per net, gate + wire
const E_TOGGLE = 0.5 * C_NODE * VDD * VDD; // joules per transition

type P2 = [number, number];

interface Gate {
  id: string;
  bit: number;
  x: number;
  z: number;
  ins: [string, string];
  out: string;
  part: Part;
  bubble: Part;
  flash: number;
  delay: number;
}

interface Net {
  id: string;
  value: 0 | 1;
  lines: LineSegments2[];
  readers: Gate[];
  driverDelay: number;
}

interface Ev {
  t: number;
  gate: Gate;
}

function nandShape(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-3.5, 3);
  s.lineTo(0, 3);
  s.absarc(0, 0, 3, Math.PI / 2, -Math.PI / 2, true);
  s.lineTo(-3.5, -3);
  s.lineTo(-3.5, 3);
  return new THREE.ShapeGeometry(s, 24).rotateX(-Math.PI / 2);
}

function circle(r: number): THREE.BufferGeometry {
  return new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
}

const GATES: [string, P2, string, string, string][] = [
  // id, centre, in0, in1, out   (nets: a b c n1..n7 s, c = carry in, co = carry out)
  ['n1', [14, 8], 'a', 'b', 'n1'],
  ['n2', [26, 3], 'a', 'n1', 'n2'],
  ['n3', [26, 13], 'b', 'n1', 'n3'],
  ['n4', [38, 8], 'n2', 'n3', 'n4'],
  ['n5', [50, 14], 'n4', 'c', 'n5'],
  ['n6', [62, 9], 'n4', 'n5', 'n6'],
  ['n7', [62, 19], 'c', 'n5', 'n7'],
  ['n8', [74, 14], 'n6', 'n7', 's'],
  ['n9', [62, 27], 'n5', 'n1', 'co'],
];

const WIRES: Record<string, P2[][]> = {
  a: [[[3, 5], [8, 5], [8, 6.5], [10.5, 6.5]], [[3, 5], [6, 5], [6, 1.5], [22.5, 1.5]]],
  b: [[[3, 11], [8, 11], [8, 9.5], [10.5, 9.5]], [[3, 11], [6, 11], [6, 14.5], [22.5, 14.5]]],
  n1: [[[18.5, 8], [20, 8], [20, 4.5], [22.5, 4.5]], [[20, 8], [20, 11.5], [22.5, 11.5]], [[20, 11.5], [20, 28.5], [58.5, 28.5]]],
  n2: [[[30.5, 3], [32, 3], [32, 6.5], [34.5, 6.5]]],
  n3: [[[30.5, 13], [32, 13], [32, 9.5], [34.5, 9.5]]],
  n4: [[[42.5, 8], [44, 8], [44, 12.5], [46.5, 12.5]], [[44, 8], [44, 7.5], [58.5, 7.5]]],
  c: [[[45, -2], [45, 15.5], [46.5, 15.5]], [[45, 15.5], [45, 20.5], [58.5, 20.5]]],
  n5: [[[54.5, 14], [56, 14], [56, 10.5], [58.5, 10.5]], [[56, 14], [56, 17.5], [58.5, 17.5]], [[56, 17.5], [56, 25.5], [58.5, 25.5]]],
  n6: [[[66.5, 9], [68, 9], [68, 12.5], [70.5, 12.5]]],
  n7: [[[66.5, 19], [68, 19], [68, 15.5], [70.5, 15.5]]],
  s: [[[78.5, 14], [84, 14]]],
};

const netName = (bit: number, local: string) => {
  if (local === 'a') return `a${bit}`;
  if (local === 'b') return `b${bit}`;
  if (local === 'c') return `c${bit}`;
  if (local === 'co') return `c${bit + 1}`;
  if (local === 's') return `s${bit}`;
  return `${bit}:${local}`;
};

export class LogicSheet extends Sheet {
  readonly no = N.logic;
  readonly title = 'The logic';
  readonly short = 'logic';
  readonly mmPerUnit = 8.9e-6;
  readonly sub = 'Four-bit adder of 36 NAND gates, drawn at the area it occupies on the die (about 1 µm²)';
  view: View = { height: 158, az: 0, el: 89, target: new THREE.Vector3(72, 0, 58), minZoom: 0.5, maxZoom: 12 };
  nets = new Map<string, Net>();
  gates: Gate[] = [];
  queue: Ev[] = [];
  simT = 0; // ps
  rate = 30; // ps per real second
  A = 11;
  B = 6;
  toggles = 0;
  lastChange = 0;
  startT = 0;
  sel!: Gate;
  private inset = new THREE.Group();
  private ch: Record<string, LineSegments2> = {};
  private outNode: LineSegments2[] = [];
  private pullDown: LineSegments2[] = [];
  private flashUp = 0;
  private flashDown = 0;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private sumEl!: HTMLElement;
  private insetBox!: HTMLElement;
  private aSlider!: ReturnType<typeof slider>;
  private bSlider!: ReturnType<typeof slider>;
  private lastPaint = 0;

  build() {
    const shape = nandShape();
    const bub = circle(0.75);
    const net = (id: string): Net => {
      let n = this.nets.get(id);
      if (!n) this.nets.set(id, (n = { id, value: 0, lines: [], readers: [], driverDelay: 4 }));
      return n;
    };
    for (let bit = 0; bit < 4; bit++) {
      const z0 = bit * BLOCK;
      for (const [id, [x, z], i0, i1, o] of GATES) {
        const part = new Part(shape, { width: 1.2, threshold: 1, fill: C.paper });
        part.position.set(x, 0, z + z0);
        const bubble = new Part(bub, { width: 1.1, threshold: 1, fill: C.paper });
        bubble.position.set(x + 3.75, 0.01, z + z0);
        this.root.add(part, bubble);
        const g: Gate = { id: `${bit}:${id}`, bit, x, z: z + z0, ins: [netName(bit, i0), netName(bit, i1)], out: netName(bit, o), part, bubble, flash: 0, delay: 5 };
        this.gates.push(g);
        net(g.ins[0]).readers.push(g);
        net(g.ins[1]).readers.push(g);
        net(g.out);
      }
      for (const [local, paths] of Object.entries(WIRES)) {
        const n = net(netName(bit, local));
        for (const p of paths) {
          const l = polyline(p.map(([x, z]) => v(x, 0, z + z0)), IDLE());
          this.root.add(l);
          n.lines.push(l);
        }
      }
      // carry out: to the next slice's carry in, or to the final output
      const co = net(`c${bit + 1}`);
      const path: P2[] = bit < 3 ? [[66.5, 27], [68, 27], [68, 30], [45, 30], [45, 32]] : [[66.5, 27], [84, 27]];
      const l = polyline(path.map(([x, z]) => v(x, 0, z + z0)), IDLE());
      this.root.add(l);
      co.lines.push(l);
    }
    // gate delay grows with the load it drives
    for (const g of this.gates) g.delay = 4 + 1.2 * net(g.out).readers.length;
    this.buildInset();
    this.buildTags();
    this.sel = this.gates.find((g) => g.id === '0:n9')!;
    this.sel.part.setEmphasis(2);
    // settle the circuit for the starting inputs without animation
    this.applyInputs(true);
    this.zoomTarget.set(124, 0, 63);
    this.refs = this.makeRefs();
  }

  private makeRefs(): Ref[] {
    const anchor = (x: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, 0, z);
      this.root.add(o);
      return o;
    };
    const bit0 = this.gates.filter((g) => g.bit === 0).map((g) => g.part);
    return [
      { n: 1100, name: 'Full adder', text: 'One bit of the adder: nine NAND gates that add two bits and an incoming carry, and produce a sum bit and an outgoing carry. Four of them in a row add two 4-bit numbers.', facts: [['Gates', '9 NAND'], ['Transistors', '36']], target: anchor(36, 22), off: [-60, -40], parts: bit0 },
      { n: 1102, name: 'NAND gate', text: 'The output is 0 only when both inputs are 1. Every other logic function can be built from NAND alone, which is why it is the workhorse of digital design. Select any gate to see its transistors in Detail C.', target: this.sel.part, off: [40, -50], parts: [] },
      { n: 1104, name: 'Carry chain', text: 'Each bit must wait for the carry from the bit before it, so the delay grows with the width. A 64-bit core uses a parallel-prefix adder instead, which needs about log₂ 64 = 6 levels rather than 64.', target: anchor(56, 64), off: [80, 10], parts: [] },
      { n: 1106, name: 'Detail C: transistor-level NAND', text: 'Two p-type transistors in parallel pull the output up to the supply; two n-type in series pull it down to ground. Exactly one side conducts at a time, so a CMOS gate draws current only while it switches.', facts: [['Supply', `${VDD} V`], ['Energy per switch', `${(E_TOGGLE * 1e15).toFixed(2)} fJ`]], target: anchor(124, 63), off: [80, 20], parts: [], see: N.transistor },
    ];
  }

  private buildInset() {
    const g = this.inset;
    g.position.set(104, 0, 20);
    this.root.add(g);
    const L = (pts: P2[], w = 1.1) => {
      const l = polyline(pts.map(([x, z]) => v(x, 0, z)), ink(w));
      g.add(l);
      return l;
    };
    // frame of the detail view
    const frame = polyline([v(-8, 0, -10), v(52, 0, -10), v(52, 0, 86), v(-8, 0, 86)], phantomMat(), true);
    g.add(frame);
    L([[0, 0], [40, 0]], 1.6);
    L([[0, 76], [40, 76]], 1.6);
    // pull-up: P1 at x=8, P2 at x=32 between VDD and the output node at z=22
    const fet = (x: number, z0: number, p: boolean, key: string) => {
      L([[x, z0 - 6], [x, z0]]);
      L([[x, z0 + 10], [x, z0 + 16]]);
      L([[x - 3, z0], [x - 3, z0 + 10]], 1.4); // gate electrode
      L([[x - 3 - (p ? 2.2 : 0), z0 + 5], [x - 8, z0 + 5]]);
      if (p) {
        const b = new Part(circle(1.1), { width: 1, threshold: 1 });
        b.position.set(x - 4.1, 0.01, z0 + 5);
        g.add(b);
      }
      const chan = polyline([v(x, 0, z0), v(x, 0, z0 + 10)], ink(2));
      chan.computeLineDistances();
      g.add(chan);
      this.ch[key] = chan;
    };
    fet(8, 6, true, 'p1');
    fet(32, 6, true, 'p2');
    this.outNode = [L([[8, 22], [32, 22]]), L([[20, 22], [20, 32]]), L([[32, 22], [46, 22]])];
    fet(20, 38, false, 'n1');
    fet(20, 54, false, 'n2');
    L([[20, 70], [20, 76]]);
    this.pullDown = [L([[20, 48], [20, 54]])];
  }

  private buildTags() {
    const T: Tag[] = [];
    const at = (x: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, 0, z);
      this.root.add(o);
      return o;
    };
    for (let bit = 0; bit < 4; bit++) {
      const z0 = bit * BLOCK;
      T.push({ target: at(-1, z0 + 5), text: () => `A${bit} ${(this.A >> bit) & 1}`, onClick: () => this.setA(this.A ^ (1 << bit)), active: () => ((this.A >> bit) & 1) === 1, label: `Toggle bit ${bit} of A` });
      T.push({ target: at(-1, z0 + 11), text: () => `B${bit} ${(this.B >> bit) & 1}`, onClick: () => this.setB(this.B ^ (1 << bit)), active: () => ((this.B >> bit) & 1) === 1, label: `Toggle bit ${bit} of B` });
      T.push({ target: at(89, z0 + 14), text: () => `S${bit} ${this.nets.get(`s${bit}`)!.value}`, cls: 'val', active: () => this.nets.get(`s${bit}`)!.value === 1 });
    }
    T.push({ target: at(45, -5), text: () => 'carry in 0', cls: 'small' });
    T.push({ target: at(90, 3 * BLOCK + 27), text: () => `C4 ${this.nets.get('c4')!.value}`, cls: 'val', active: () => this.nets.get('c4')!.value === 1 });
    const ix = 104, iz = 20;
    T.push({ target: at(ix + 22, iz - 15), text: () => 'DETAIL C · not to scale', cls: 'title' });
    T.push({ target: at(ix + 30, iz - 4), text: () => `VDD ${VDD} V`, cls: 'small' });
    T.push({ target: at(ix + 30, iz + 80), text: () => 'GND', cls: 'small' });
    T.push({ target: at(ix - 2, iz + 11), text: () => `${this.inA()}`, cls: 'val', active: () => this.inA() === 1 });
    T.push({ target: at(ix + 22, iz + 11), text: () => `${this.inB()}`, cls: 'val', active: () => this.inB() === 1 });
    T.push({ target: at(ix + 10, iz + 43), text: () => `${this.inA()}`, cls: 'val', active: () => this.inA() === 1 });
    T.push({ target: at(ix + 10, iz + 59), text: () => `${this.inB()}`, cls: 'val', active: () => this.inB() === 1 });
    T.push({ target: at(ix + 50, iz + 22), text: () => `out ${this.outV()}`, cls: 'val', active: () => this.outV() === 1 });
    T.push({ target: at(ix + 22, iz + 92), text: () => `gate ${this.sel?.id.replace(':', ' · ')}`, cls: 'small' });
    this.tags = T;
  }

  private inA() {
    return this.nets.get(this.sel.ins[0])!.value;
  }
  private inB() {
    return this.nets.get(this.sel.ins[1])!.value;
  }
  private outV() {
    return this.nets.get(this.sel.out)!.value;
  }

  canPick(p: Part) {
    return this.gates.some((g) => g.part === p || g.bubble === p);
  }

  pickPart(p: Part) {
    const g = this.gates.find((x) => x.part === p || x.bubble === p);
    if (!g) return;
    this.sel.part.setEmphasis(0);
    this.sel = g;
    g.part.setEmphasis(2);
    this.paintInset(true);
  }

  private setA(a: number) {
    this.A = a & 15;
    this.aSlider?.set(this.A);
    this.applyInputs(false);
  }

  private setB(b: number) {
    this.B = b & 15;
    this.bSlider?.set(this.B);
    this.applyInputs(false);
  }

  /** drive the input nets; instant settles the whole circuit immediately */
  private applyInputs(instant: boolean) {
    this.startT = this.simT;
    this.toggles = 0;
    this.lastChange = this.simT;
    for (let bit = 0; bit < 4; bit++) {
      this.drive(`a${bit}`, ((this.A >> bit) & 1) as 0 | 1);
      this.drive(`b${bit}`, ((this.B >> bit) & 1) as 0 | 1);
    }
    if (instant) {
      // settle: evaluate every gate until nothing changes
      for (let k = 0; k < 40; k++) {
        let changed = false;
        for (const g of this.gates) {
          const o = (this.nets.get(g.ins[0])!.value && this.nets.get(g.ins[1])!.value ? 0 : 1) as 0 | 1;
          const n = this.nets.get(g.out)!;
          if (n.value !== o) {
            n.value = o;
            changed = true;
          }
        }
        if (!changed) break;
      }
      this.queue = [];
      this.toggles = 0;
      this.paintNets();
    } else {
      state.revise(this.no, `Adder: ${this.A} + ${this.B}`);
    }
  }

  private drive(id: string, val: 0 | 1) {
    const n = this.nets.get(id)!;
    if (n.value === val) return;
    n.value = val;
    this.toggles++;
    for (const g of n.readers) this.queue.push({ t: this.simT + g.delay, gate: g });
    this.paintNet(n);
  }

  private step(dt: number) {
    if (!this.queue.length) return;
    this.simT += dt * this.rate;
    this.queue.sort((p, q) => p.t - q.t);
    while (this.queue.length && this.queue[0].t <= this.simT) {
      const ev = this.queue.shift()!;
      const g = ev.gate;
      const o = (this.nets.get(g.ins[0])!.value && this.nets.get(g.ins[1])!.value ? 0 : 1) as 0 | 1;
      const n = this.nets.get(g.out)!;
      if (n.value === o) continue;
      n.value = o;
      this.toggles++;
      this.lastChange = ev.t;
      g.flash = 0.35;
      if (g === this.sel) {
        if (o === 1) this.flashUp = 0.4;
        else this.flashDown = 0.4;
      }
      for (const r of n.readers) this.queue.push({ t: ev.t + r.delay, gate: r });
      this.paintNet(n);
    }
    if (!this.queue.length) {
      const settle = this.lastChange - this.startT;
      state.revise(this.no, `Adder: ${this.A} + ${this.B} = ${this.sum()} settled in ${settle.toFixed(0)} ps, ${this.toggles} node toggles`);
    }
  }

  private sum() {
    let s = 0;
    for (let bit = 0; bit < 4; bit++) s |= this.nets.get(`s${bit}`)!.value << bit;
    return s | (this.nets.get('c4')!.value << 4);
  }

  private paintNet(n: Net) {
    const m = n.value ? ink(1.9, C.red) : IDLE();
    for (const l of n.lines) l.material = m;
  }

  private paintNets() {
    for (const n of this.nets.values()) this.paintNet(n);
  }

  private paintInset(force = false) {
    const a = this.inA(), b = this.inB(), o = this.outV();
    const on = (x: boolean) => (x ? ink(2.2) : GAP());
    this.ch.p1.material = on(a === 0);
    this.ch.p2.material = on(b === 0);
    this.ch.n1.material = on(a === 1);
    this.ch.n2.material = on(b === 1);
    const up = this.flashUp > 0, dn = this.flashDown > 0;
    for (const l of this.outNode) l.material = o ? ink(1.9, C.red) : IDLE();
    if (up) {
      if (a === 0) this.ch.p1.material = ink(2.4, C.red);
      if (b === 0) this.ch.p2.material = ink(2.4, C.red);
    }
    if (dn) {
      this.ch.n1.material = ink(2.4, C.red);
      this.ch.n2.material = ink(2.4, C.red);
      for (const l of this.pullDown) l.material = ink(1.9, C.red);
    } else for (const l of this.pullDown) l.material = ink(1.1);
    if (this.insetBox && force) this.paintInsetText();
  }

  private paintInsetText() {
    const a = this.inA(), b = this.inB(), o = this.outV();
    this.insetBox.replaceChildren(
      facts([
        ['Gate', this.sel.id.replace(':', ', ')],
        ['Inputs', `${a} and ${b}`],
        ['Output', `${o}, ${o ? 'pulled up through a p-type transistor' : 'pulled down through both n-type transistors'}`],
        ['Delay', `${this.sel.delay.toFixed(1)} ps (drives ${this.nets.get(this.sel.out)!.readers.length || 1} inputs)`],
      ]),
    );
  }

  panel() {
    this.aSlider = slider({ label: 'A', min: 0, max: 15, step: 1, value: this.A, format: (x) => `${x} · ${x.toString(2).padStart(4, '0')}`, onInput: (x) => this.setA(x), ticks: 15 });
    this.bSlider = slider({ label: 'B', min: 0, max: 15, step: 1, value: this.B, format: (x) => `${x} · ${x.toString(2).padStart(4, '0')}`, onInput: (x) => this.setB(x), ticks: 15 });
    const rate = slider({ label: 'Slow motion', min: 5, max: 200, step: 5, value: this.rate, format: (x) => `${x} ps per second`, onInput: (x) => (this.rate = x) });
    this.ro = {
      settle: readout({ label: 'Settled after', unit: 'ps', digits: 0, trend: false }),
      tog: readout({ label: 'Node toggles', digits: 0, trend: false }),
      e: readout({ label: 'Switching energy', unit: 'fJ', digits: 2, trend: false }),
      cyc: readout({ label: 'Share of a 4 GHz cycle', unit: '%', digits: 0, trend: false }),
    };
    this.sumEl = h('div', { class: 'sum' });
    this.insetBox = h('div');
    this.paintInsetText();
    return h(
      'div',
      null,
      section(null, h('p', { class: 'note' }, 'Toggle the bits on the drawing or set the numbers here. Wires carrying a 1 are drawn red: they are charged to 0.75 V.'), this.aSlider.el, this.bSlider.el, h('div', { class: 'btn-row' }, button('Longest ripple: 15 + 1', () => { this.setA(15); this.setB(0); this.setB(1); }), button('Random', () => { this.setA(Math.floor(Math.random() * 16)); this.setB(Math.floor(Math.random() * 16)); })), rate.el),
      section('Result', this.sumEl, h('div', { class: 'ro-grid' }, this.ro.settle.el, this.ro.tog.el, this.ro.e.el, this.ro.cyc.el), h('p', { class: 'note' }, 'Event-driven simulation: each gate switches about 5 ps after its inputs change, a little slower when it drives more inputs. Glitches you see on the way are real; the final value is always right.')),
      section('Detail C, selected gate', this.insetBox),
    );
  }

  update(dt: number) {
    if (!this.sel) return;
    this.step(dt);
    for (const g of this.gates) {
      if (g.flash > 0) {
        g.flash -= dt;
        g.part.setLive(g.flash > 0);
        g.bubble.setLive(g.flash > 0);
      }
    }
    this.flashUp = Math.max(0, this.flashUp - dt);
    this.flashDown = Math.max(0, this.flashDown - dt);
    this.paintInset();
    const now = performance.now();
    if (this.ro && now - this.lastPaint > 100) {
      this.lastPaint = now;
      const busy = this.queue.length > 0;
      const settle = (busy ? this.simT : this.lastChange) - this.startT;
      this.ro.settle.set(settle, busy ? `${settle.toFixed(0)}…` : undefined);
      this.ro.tog.set(this.toggles);
      this.ro.e.set(this.toggles * E_TOGGLE * 1e15);
      this.ro.cyc.set((settle / 250) * 100);
      const s = this.sum();
      this.sumEl.innerHTML = `<span>${this.A}</span><span>+</span><span>${this.B}</span><span>=</span><strong>${busy ? '…' : s}</strong><code>${busy ? '' : s.toString(2).padStart(5, '0')}</code>`;
      this.paintInsetText();
    }
  }
}
