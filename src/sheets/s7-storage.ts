import * as THREE from 'three';
import { C, M, Part, slab, box, cyl, v, segments, ink, hatchTexture, basicMat } from '../core/ink';
import { tcs } from '../core/theme';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state } from '../core/state';
import { h, segmented, slider, readout, section, grind, Plot, button } from '../core/ui';
import { N } from './ids';

// A piece of 3D NAND at true scale in nanometres: word-line layers stacked with oxide, channel holes
// drilled through them, and in each hole a charge-trap film where a cell keeps its electrons.
// The front row of holes is cut open along its axis to show the layers around the channel.

const LAYERS = 24; // drawn; real parts have over 200
const LAYER_T = 30; // word line
const OX_T = 22; // oxide between them
const HOLE_R = 60;
const HOLE_PITCH = 150;
const HOLES_X = 5;
const HOLES_Z = 3;
const LEVELS = 8; // TLC: three bits, eight threshold levels

interface Cell {
  layer: number;
  hole: number;
  electrons: number;
  dots: THREE.Mesh[];
}

export class StorageSheet extends Sheet {
  readonly no = N.storage;
  readonly title = 'The storage';
  readonly short = 'storage';
  readonly mmPerUnit = 1e-6;
  readonly sub = '3D NAND flash, 24 of over 200 layers, front row of channels cut open; nanometres';
  view: View = { height: 1700, az: -32, el: 20, target: new THREE.Vector3(0, 640, 0), minZoom: 0.5, maxZoom: 16 };
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private cells: Cell[] = [];
  private target = 5; // level 0..7 for the next program
  private sel = { layer: 12, hole: 2 };
  private pulses: number[] = [];
  private programming = -1;
  private wl: Part[] = [];
  private eMat!: THREE.MeshBasicMaterial;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private dist!: Plot;
  private lastPaint = 0;

  build() {
    const W = HOLES_X * HOLE_PITCH + 100, D = HOLES_Z * HOLE_PITCH + 100;
    const stackH = LAYERS * (LAYER_T + OX_T);
    const base = 140;
    this.root.add(new Part(slab(W + 60, base, D + 60, 6), { hull: true, threshold: 40, fill: M.siLight }));
    const z0 = -D / 2 + 50 + HOLE_PITCH / 2;
    // layer stack: tungsten word lines and oxide, cut at z = 0 through the front row of holes
    const front = z0;
    this.plane.constant = front;
    this.clipPlanes = [this.plane];
    let y = base;
    for (let i = 0; i < LAYERS; i++) {
      const ox = new Part(box(W, OX_T, D).translate(0, OX_T / 2, 0), { width: 0.6, threshold: 30, fill: M.oxide });
      ox.position.y = y;
      this.root.add(ox);
      this.cap(W, OX_T, y, front, 'oxide');
      y += OX_T;
      const wl = new Part(box(W, LAYER_T, D).translate(0, LAYER_T / 2, 0), { width: 0.7, threshold: 30, fill: M.gateMetal });
      wl.position.y = y;
      this.root.add(wl);
      this.cap(W, LAYER_T, y, front, 'metal');
      this.wl.push(wl);
      y += LAYER_T;
    }
    // channel holes: blocking oxide, nitride trap, tunnel oxide, polysilicon channel, oxide core
    const rings: [number, number][] = [[HOLE_R, M.oxide], [HOLE_R - 8, M.nitride], [HOLE_R - 15, M.oxide], [HOLE_R - 20, M.siDoped], [HOLE_R - 30, M.oxide]];
    this.eMat = basicMat(C.red, { depthTest: false });
    for (let k = 0; k < HOLES_Z; k++)
      for (let i = 0; i < HOLES_X; i++) {
        const x = -((HOLES_X - 1) / 2) * HOLE_PITCH + i * HOLE_PITCH + (k % 2) * HOLE_PITCH * 0.5;
        const z = z0 + k * HOLE_PITCH;
        const pillar = new Part(cyl(HOLE_R, stackH, 28).translate(0, stackH / 2, 0), { width: 0.7, threshold: 40, fill: M.oxide, hull: true });
        pillar.position.set(x, base, z);
        this.root.add(pillar);
        if (k === 0) {
          // section through the hole's axis: concentric films become stripes
          rings.forEach(([r, fill], ri) => {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, stackH), new THREE.MeshBasicMaterial({ map: hatchTexture(ri === 3 ? 'si' : 'oxide', 1, fill) }));
            (strip.material as THREE.MeshBasicMaterial).map!.repeat.set((r * 2) / 40, stackH / 40);
            strip.position.set(x, base + stackH / 2, front - 0.5 + ri * 0.08);
            this.root.add(strip);
          });
          for (let L = 0; L < LAYERS; L++) {
            const cell: Cell = { layer: L, hole: i, electrons: Math.random() < 0.5 ? 0 : 40 + Math.floor(Math.random() * 7) * 35, dots: [] };
            for (const side of [-1, 1]) {
              for (let e = 0; e < 4; e++) {
                const dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), this.eMat);
                dot.position.set(x + side * (HOLE_R - 11.5), base + L * (LAYER_T + OX_T) + OX_T + 4 + e * 7.5, front - 0.3);
                dot.renderOrder = 10;
                this.root.add(dot);
                cell.dots.push(dot);
              }
            }
            this.cells.push(cell);
          }
        }
      }
    // bit lines on top, source line underneath
    const bl: THREE.Vector3[] = [];
    for (let i = 0; i < HOLES_X; i++) {
      const x = -((HOLES_X - 1) / 2) * HOLE_PITCH + i * HOLE_PITCH;
      bl.push(v(x, base + stackH + 30, -D / 2), v(x, base + stackH + 30, D / 2));
    }
    this.root.add(segments(bl, ink(2.4, C.ink)));
    const src = new Part(slab(W, 30, D, 4), { width: 0.8, threshold: 40, fill: M.siDoped });
    src.position.y = base - 30;
    this.root.add(src);
    const anchor = (x: number, yy: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, yy, z);
      this.root.add(o);
      return o;
    };
    const hx = -((HOLES_X - 1) / 2) * HOLE_PITCH + 2 * HOLE_PITCH;
    this.zoomTarget.set(hx, base + stackH / 2, front);
    this.refs = [
      { n: 700, name: 'Word-line layers', text: 'Tungsten sheets about 30 nm thick, separated by oxide. Each layer is the gate of one cell in every channel hole that passes through it. Current parts stack over 200 of them.', facts: [['Drawn', `${LAYERS} layers`], ['Real', '200–330 layers']], target: anchor(-W / 2, base + stackH * 0.6, front - 40), off: [-90, -30], parts: this.wl },
      { n: 702, name: 'Channel hole', text: `A hole ${HOLE_R * 2} nm across etched through the whole stack in one go, an aspect ratio near 60:1, then lined with films from the outside in.`, target: anchor(hx + HOLE_R, base + stackH + 10, front), off: [80, -60], parts: [] },
      { n: 704, name: 'Charge-trap nitride', text: 'A silicon nitride film that holds electrons where they land. Each cell keeps its share of the film at the height of its word line, for years with the power off.', target: anchor(hx - HOLE_R + 11, base + stackH * 0.42, front), off: [-110, -20], parts: [] },
      { n: 706, name: 'Tunnel oxide and channel', text: 'About 5 nm of oxide over a thin polysilicon channel. Programming forces electrons through the oxide by quantum tunnelling at around 20 V.', target: anchor(hx + HOLE_R - 22, base + stackH * 0.3, front), off: [100, 40], parts: [], grind: true },
      { n: 708, name: 'Bit lines', text: 'Read the current through a whole vertical string of cells: every cell but the selected one is driven fully on.', target: anchor(-W / 2 + 50, base + stackH + 30, -D / 2 + 20), off: [-80, -40], parts: [], grind: true },
    ] as Ref[];
    this.dims = [{ a: v(-W / 2, base, front), b: v(-W / 2, base + stackH, front), space: this.root, off: 34, text: () => `${stackH} nm` }];
    this.paintCells();
  }

  private cap(w: number, hh: number, y: number, z: number, kind: 'oxide' | 'metal') {
    const tex = hatchTexture(kind);
    tex.repeat.set(w / 60, Math.max(0.1, hh / 60));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, y + hh / 2, z - 0.8);
    this.root.add(face);
  }

  onRebuild: () => void = () => {};

  private selCell() {
    return this.cells.find((c) => c.layer === this.sel.layer && c.hole === this.sel.hole)!;
  }

  private paintCells() {
    for (const c of this.cells) {
      const level = Math.round(c.electrons / 35);
      c.dots.forEach((d, i) => (d.visible = i % 4 < Math.min(4, Math.ceil(level / 2))));
    }
    this.wl.forEach((w, i) => w.setLive(this.programming >= 0 && i === this.sel.layer));
  }

  private program() {
    const c = this.selCell();
    c.electrons = 0;
    this.pulses = [];
    this.programming = 0;
  }

  panel() {
    const lvl = segmented({ label: 'Value to store, 3 bits per cell', options: Array.from({ length: LEVELS }, (_, i) => ({ value: String(i), label: i.toString(2).padStart(3, '0') })), value: String(this.target), wrap: true, onChange: (x) => (this.target = Number(x)) });
    const layer = slider({ label: 'Word-line layer', min: 0, max: LAYERS - 1, step: 1, value: this.sel.layer, format: (x) => `${x + 1} of ${LAYERS}`, onInput: (x) => (this.sel.layer = x) });
    const hole = slider({ label: 'Channel', min: 0, max: HOLES_X - 1, step: 1, value: this.sel.hole, format: (x) => `${x + 1}`, onInput: (x) => (this.sel.hole = x) });
    this.ro = {
      e: readout({ label: 'Electrons in the cell', digits: 0, trend: false }),
      vt: readout({ label: 'Threshold voltage', unit: 'V', digits: 2, trend: false }),
      p: readout({ label: 'Program pulses', digits: 0, trend: false }),
      read: readout({ label: 'Reads back as', trend: false }),
    };
    this.plot = new Plot({ x: [0, 12], y: [0, 22], xLabel: 'pulse', yLabel: 'word line, V', xTicks: [0, 3, 6, 9, 12], yTicks: [0, 5, 10, 15, 20], caption: 'Incremental step programming: each pulse is a little higher, and the cell is checked after each one until it reaches its level.' });
    this.dist = new Plot({ x: [-1, 7], y: [0, 1.1], xLabel: 'threshold voltage, V', yLabel: 'cells', xTicks: [-1, 1, 3, 5, 7], yTicks: [], caption: 'Eight levels of charge mean three bits per cell. Black: where the cells in this array sit. Grey: read references between the levels.' });
    return h(
      'div',
      null,
      section(null, h('p', { class: 'note' }, 'Red dots are trapped electrons in the cut-open cells, more for higher levels. Pick a cell and a value, then program it.'), lvl.el, layer.el, hole.el, h('div', { class: 'btn-row' }, button('Program the cell', () => this.program(), { primary: true }), button('Erase the block', () => this.erase())), h('div', { class: 'ro-grid' }, this.ro.e.el, this.ro.vt.el, this.ro.p.el, this.ro.read.el), this.plot.el),
      grind('Eight levels in one cell', this.dist.el, h('p', { class: 'note' }, 'Neighbouring levels are only a few dozen electrons apart. Each program and erase pushes charge through the tunnel oxide and slowly damages it: TLC flash is rated for roughly 1,000 to 3,000 cycles, which the controller spreads evenly across the drive.')),
    );
  }

  private erase() {
    for (const c of this.cells) c.electrons = 0;
    state.revise(this.no, 'Erased the block');
  }

  update(dt: number) {
    if (this.programming >= 0) {
      this.programming += dt * 2.5;
      const c = this.selCell();
      const want = this.target * 35;
      const n = Math.floor(this.programming);
      while (this.pulses.length < n && c.electrons < want) {
        const vpgm = 15 + this.pulses.length * 0.5;
        this.pulses.push(vpgm);
        c.electrons = Math.min(want, c.electrons + 8 + Math.random() * 10);
      }
      if (c.electrons >= want || this.pulses.length >= 12) {
        this.programming = -1;
        state.revise(this.no, `Programmed ${this.target.toString(2).padStart(3, '0')} in ${this.pulses.length} pulses`);
      }
      this.paintCells();
    }
    const now = performance.now();
    if (!this.ro || now - this.lastPaint < 150) return;
    this.lastPaint = now;
    const c = this.selCell();
    const vt = -0.5 + c.electrons * (7 / (35 * LEVELS));
    const level = Math.min(LEVELS - 1, Math.max(0, Math.round((vt + 0.5) / (7 / LEVELS))));
    this.ro.e.set(c.electrons);
    this.ro.vt.set(vt);
    this.ro.p.set(this.pulses.length);
    this.ro.read.set(0, `${level.toString(2).padStart(3, '0')} (level ${level})`);
    this.plot.series = [{ color: tcs('#1d1f22'), width: 1.75, points: this.pulses.flatMap((p, i) => [[i, 0], [i, p], [i + 0.6, p], [i + 0.6, 0]] as [number, number][]) }];
    this.plot.draw();
    const hist: [number, number][] = [];
    for (let x = -1; x <= 7; x += 0.04) {
      let y = 0;
      for (let L = 0; L < LEVELS; L++) {
        const mu = -0.5 + (L + 0.5) * (7 / LEVELS) - 0.4;
        const count = this.cells.filter((cc) => Math.round(cc.electrons / 35) === L).length / this.cells.length;
        y += (count + 0.02) * Math.exp(-((x - mu) ** 2) / (2 * 0.09)) * 3;
      }
      hist.push([x, Math.min(1.08, y)]);
    }
    const refsX: [number, number][] = [];
    for (let L = 1; L < LEVELS; L++) {
      const xr = -0.5 + L * (7 / LEVELS) - 0.4;
      refsX.push([xr, 0], [xr, 1.05], [xr + 0.0001, 0]);
    }
    this.dist.series = [
      { color: tcs('#8b8e88'), width: 1, dash: [3, 3], points: refsX },
      { color: tcs('#1d1f22'), width: 1.6, points: hist },
    ];
    this.dist.draw();
  }
}
