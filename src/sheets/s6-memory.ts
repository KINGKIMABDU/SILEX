import * as THREE from 'three';
import { C, M, Part, slab, cyl, v, segments, ink, basicMat } from '../core/ink';
import { trackColor, tcs } from '../core/theme';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state } from '../core/state';
import { SPEC } from '../core/specs';
import { h, segmented, slider, readout, section, grind, Plot, button } from '../core/ui';
import { N } from './ids';

// A patch of a DRAM array at true scale, in nanometres: storage capacitors 35 nm wide and 1.2 µm tall
// standing on access transistors, wordlines across, bitlines along, sense amplifiers at the end.

const COLS = 12;
const ROWS = 6;
const PITCH_X = 52;
const PITCH_Z = 60;
const CAP_R = 17.5;
const CAP_H = 1200;
const C_CELL = 9e-15; // farads
const C_BL = 45e-15; // bitline capacitance
const VDD = 1.05;
// DDR5 and LPDDR5 refresh every row within 32 ms (DDR4 allowed 64 ms)
const REFRESH_MS = 32;
const SLOW = 40; // the drawing runs 40 times slower than the chip

interface Cell {
  q: number; // 0..1 of full charge
  bit: 0 | 1;
  tau: number; // retention time constant at 45 °C, ms
  pillar: Part;
  charge: THREE.Mesh;
  flipped: boolean;
}

export class MemorySheet extends Sheet {
  readonly no = N.memory;
  readonly title = 'The memory';
  readonly short = 'memory';
  readonly mmPerUnit = 1e-6;
  readonly sub = 'A patch of the DRAM cell array, 12 × 6 cells, true scale in nanometres';
  view: View = { height: 1700, az: -38, el: 18, target: new THREE.Vector3(0, 650, 0), minZoom: 0.5, maxZoom: 16 };
  cells: Cell[] = [];
  refresh = true;
  tempC = 45;
  private simMs = 0;
  private refreshRow = 0;
  private sinceRefresh = 0;
  private flips = 0;
  private wordlines: THREE.Object3D[] = [];
  private senseAmps: Part[] = [];
  private readCell: Cell | null = null;
  private readT = -1;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private readTrace: [number, number][] = [];
  private lastPaint = 0;
  private chargeMat!: THREE.MeshBasicMaterial;

  build() {
    const W = COLS * PITCH_X, D = ROWS * PITCH_Z;
    const sub = new Part(slab(W + 120, 60, D + 160, 4).translate(0, -60, 0), { hull: true, threshold: 40, fill: M.siLight });
    this.root.add(sub);
    const anchors: Record<string, THREE.Object3D> = {};
    const anchor = (k: string, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      this.root.add(o);
      anchors[k] = o;
    };
    this.chargeMat = basicMat(C.red, { transparent: true, opacity: 0.85 });
    const chargeGeo = new THREE.CylinderGeometry(CAP_R * 0.6, CAP_R * 0.6, 1, 16).translate(0, 0.5, 0);
    const pillarGeo = cyl(CAP_R, CAP_H, 18).translate(0, CAP_H / 2, 0);
    // the electrode is drawn translucent so the charge inside it can be seen
    const glass = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    trackColor(glass.color, M.gateMetal);
    const accessGeo = slab(30, 40, 22, 4);
    const seed = (i: number) => {
      const x = Math.sin(i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = -W / 2 + (c + 0.5) * PITCH_X + (r % 2) * PITCH_X * 0.5 - PITCH_X * 0.25;
        const z = -D / 2 + (r + 0.5) * PITCH_Z;
        const acc = new Part(accessGeo, { width: 0.7, threshold: 40, fill: M.siDoped });
        acc.position.set(x, 0, z);
        this.root.add(acc);
        const pillar = new Part(pillarGeo, { width: 0.7, threshold: 40, fill: M.gateMetal });
        pillar.fill.material = glass;
        pillar.fill.renderOrder = 6;
        pillar.position.set(x, 120, z);
        this.root.add(pillar);
        const charge = new THREE.Mesh(chargeGeo, this.chargeMat);
        charge.position.set(x, 122, z);
        charge.renderOrder = 5;
        this.root.add(charge);
        // retention spreads over decades: most cells hold for seconds, a weak tail for under 100 ms
        const i = r * COLS + c;
        const tau = Math.exp(Math.log(150) + seed(i + 1) * Math.log(40)) * (seed(i + 7) < 0.06 ? 0.4 : 1);
        const bit = (seed(i * 3 + 1) > 0.45 ? 1 : 0) as 0 | 1;
        this.cells.push({ q: bit, bit, tau, pillar, charge, flipped: false });
      }
      // a wordline runs along each row, under the capacitors
      const wl = segments([v(-W / 2 - 40, 46, -D / 2 + (r + 0.5) * PITCH_Z), v(W / 2 + 40, 46, -D / 2 + (r + 0.5) * PITCH_Z)], ink(2.2, C.ink));
      this.root.add(wl);
      this.wordlines.push(wl);
    }
    // bitlines run across the rows, with a sense amplifier at the end of each
    const bls: THREE.Vector3[] = [];
    for (let c = 0; c < COLS; c++) {
      const x = -W / 2 + (c + 0.5) * PITCH_X;
      bls.push(v(x, 80, -D / 2 - 30), v(x, 80, D / 2 + 30));
      const sa = new Part(slab(34, 30, 40, 4), { width: 0.8, threshold: 40, fill: M.mold });
      sa.position.set(x, 0, D / 2 + 60);
      this.root.add(sa);
      this.senseAmps.push(sa);
    }
    this.root.add(segments(bls, ink(1.2, C.grey)));
    const plate = new Part(slab(W + 40, 30, D + 40, 6), { width: 0.9, threshold: 40, fill: M.gateMetal });
    plate.position.y = 120 + CAP_H;
    this.root.add(plate);
    anchor('cap', W / 2 - PITCH_X * 0.5, 120 + CAP_H * 0.7, D / 2 - PITCH_Z * 0.5);
    anchor('acc', -W / 2 + PITCH_X * 0.5, 30, D / 2 - PITCH_Z * 0.5);
    anchor('wl', -W / 2 - 40, 46, -D / 2 + PITCH_Z * 0.5);
    anchor('sa', W / 2 - PITCH_X * 0.5, 30, D / 2 + 60);
    anchor('plate', -W / 2, 120 + CAP_H + 30, 0);
    this.zoomTarget.set(0, 600, 0);
    this.refs = [
      { n: 600, name: 'Storage capacitor', text: `A hollow pillar of titanium nitride lined with a high-k insulator, ${CAP_R * 2} nm across and ${(CAP_H / 1000).toFixed(1)} µm tall: as tall as 34 of its own widths. It holds about ${Math.round((C_CELL * VDD) / 1.6e-19 / 1000)} thousand electrons for a 1.`, facts: [['Capacitance', '≈ 9 fF'], ['Diameter', `${CAP_R * 2} nm`], ['Height', `${CAP_H} nm`]], target: anchors.cap, off: [90, -40], parts: this.cells.map((c) => c.pillar) },
      { n: 602, name: 'Access transistor', text: 'A buried-channel transistor under each capacitor. Its gate is the wordline; when the row is selected it connects the capacitor to the bitline.', target: anchors.acc, off: [-80, 40], parts: [] },
      { n: 604, name: 'Wordline', text: 'Opens every cell in a row at once. Reading even one bit means opening the whole row of 8,192 cells.', target: anchors.wl, off: [-90, -30], parts: [] },
      { n: 606, name: 'Sense amplifier', text: 'Compares its bitline against a reference held at half the supply and amplifies a difference of around 100 mV into a full 0 or 1, then writes it back.', target: anchors.sa, off: [80, 40], parts: this.senseAmps },
      { n: 608, name: 'Top plate', text: 'The shared outer electrode of every capacitor in the array.', target: anchors.plate, off: [-70, -40], parts: [plate], grind: true },
    ] as Ref[];
    this.dims = [{ a: v(-W / 2, 120, D / 2 + 20), b: v(-W / 2, 120 + CAP_H, D / 2 + 20), space: this.root, off: 30, text: () => '1,200 nm' }];
    this.paintCells();
  }

  canPick() {
    return false;
  }

  pickRay(ray: THREE.Raycaster): boolean {
    const hits = ray.intersectObjects(this.cells.map((c) => c.pillar.fill), false);
    if (!hits.length) return false;
    const cell = this.cells.find((c) => c.pillar.fill === hits[0].object)!;
    cell.bit = cell.bit ? 0 : 1;
    cell.q = cell.bit;
    cell.flipped = false;
    this.paintCells();
    state.revise(this.no, `Wrote a ${cell.bit} into a DRAM cell`);
    return true;
  }

  onRebuild: () => void = () => {};

  panel() {
    const ref = segmented({ label: 'Refresh', options: [{ value: 'on', label: 'Every 32 ms' }, { value: 'off', label: 'Switched off' }], value: 'on', onChange: (x) => {
      this.refresh = x === 'on';
      state.revise(this.no, `DRAM refresh ${this.refresh ? 'on' : 'off'}`);
    } });
    const temp = slider({ label: 'Chip temperature', min: 25, max: 95, step: 1, value: this.tempC, format: (t) => `${t} °C`, onInput: (t) => (this.tempC = t) });
    this.ro = {
      e: readout({ label: 'Electrons in a full cell', trend: false }),
      flips: readout({ label: 'Bits lost', digits: 0, trend: false }),
      ret: readout({ label: 'Weakest cell holds', trend: false }),
      cells: readout({ label: 'Cells in this machine', trend: false }),
    };
    this.plot = new Plot({ x: [0, 40], y: [0, 1.15], xLabel: 'time, ns', yLabel: 'bitline, V', xTicks: [0, 10, 20, 30, 40], yTicks: [0, 0.525, 1.05], fmtY: (y) => y.toFixed(2), caption: 'One read: the bitline rests at half the supply, the cell nudges it by under a tenth of a volt, the sense amplifier drives it to the rail (1 or 0) and the cell is written back with whatever it read.' });
    return h(
      'div',
      null,
      section(null, h('p', { class: 'note' }, 'Each pillar is one bit. Red shows the charge it still holds. Select a pillar to write it; read one to see how faint the signal really is.'), ref.el, temp.el, h('div', { class: 'btn-row' }, button('Read a cell', () => this.startRead(), { primary: true }), button('Write a pattern', () => this.writePattern())), h('div', { class: 'ro-grid' }, this.ro.flips.el, this.ro.ret.el, this.ro.e.el, this.ro.cells.el)),
      section('One read, 40 ns', this.plot.el),
      grind('Why it forgets', h('p', { class: 'note' }, 'Every capacitor leaks through its transistor and insulator, faster when hot: roughly twice as fast for every 10 °C. DDR5 and LPDDR5 must refresh every row within 32 ms, and twice as often above 85 °C (older DDR4 allowed 64 ms). Refresh costs about a tenth of the memory\'s power and some of its bandwidth.')),
    );
  }

  private writePattern() {
    this.cells.forEach((c, i) => {
      c.bit = (((i % COLS) + Math.floor(i / COLS)) % 2) as 0 | 1;
      c.q = c.bit;
      c.flipped = false;
    });
    this.flips = 0;
    this.paintCells();
    state.revise(this.no, 'Wrote a checkerboard into the array');
  }

  private startRead() {
    const ones = this.cells.filter((c) => c.bit === 1);
    this.readCell = ones[Math.floor(Math.random() * ones.length)] ?? this.cells[0];
    this.readT = 0;
    this.readTrace = [];
  }

  private paintCells() {
    for (const c of this.cells) {
      c.charge.scale.y = Math.max(0.001, c.q * (CAP_H - 6));
      c.charge.visible = c.q > 0.01;
      c.pillar.setEmphasis(c.flipped ? 2 : 0);
    }
  }

  update(dt: number) {
    const msStep = (dt * 1000) / SLOW;
    this.simMs += msStep;
    const accel = Math.pow(2, (this.tempC - 45) / 10);
    for (const c of this.cells) {
      if (c.bit === 1) c.q *= Math.exp((-msStep * accel) / c.tau);
      if (c.bit === 1 && c.q < 0.5 && !c.flipped) {
        c.flipped = true;
        this.flips++;
      }
    }
    // the refresh controller walks the rows, reading and rewriting each within 32 ms
    if (this.refresh) {
      this.sinceRefresh += msStep;
      const per = REFRESH_MS / ROWS;
      while (this.sinceRefresh >= per) {
        this.sinceRefresh -= per;
        for (let c = 0; c < COLS; c++) {
          const cell = this.cells[this.refreshRow * COLS + c];
          if (!cell.flipped) cell.q = cell.bit;
        }
        this.refreshRow = (this.refreshRow + 1) % ROWS;
      }
      this.wordlines.forEach((w, i) => ((w as unknown as { material: unknown }).material = i === this.refreshRow ? ink(2.6, C.red) : ink(2.2, C.ink)));
    } else this.wordlines.forEach((w) => ((w as unknown as { material: unknown }).material = ink(2.2, C.ink)));
    this.paintCells();
    // a read: 40 ns of chip time stretched over 4 seconds
    if (this.readT >= 0 && this.readCell) {
      this.readT += dt * 10;
      const t = this.readT;
      const half = VDD / 2;
      const share = (half * C_CELL * (this.readCell.q * 2 - 1)) / (C_CELL + C_BL);
      const rail = share > 0 ? VDD : 0;
      const vbl = t < 5 ? half : t < 15 ? half + share * Math.min(1, (t - 5) / 4) : t < 25 ? half + share + (rail - half - share) * Math.min(1, (t - 15) / 5) : rail;
      this.readTrace.push([t, vbl]);
      const ri = Math.floor(this.cells.indexOf(this.readCell) / COLS);
      (this.wordlines[ri] as unknown as { material: unknown }).material = ink(2.8, C.red);
      if (t >= 40) {
        // the write-back restores whatever the sense amplifier decided: a cell that leaked below half is now a 0 for good
        const got = (share > 0 ? 1 : 0) as 0 | 1;
        this.readCell.bit = got;
        this.readCell.q = got;
        this.readCell.flipped = false;
        state.revise(this.no, `Read a cell: ${share >= 0 ? '+' : '−'}${Math.abs(share * 1000).toFixed(0)} mV signal amplified to a ${got}`);
        this.readT = -1;
      }
    }
    const now = performance.now();
    if (!this.ro || now - this.lastPaint < 200) return;
    this.lastPaint = now;
    const s = SPEC[state.arch];
    const gb = parseInt(s.memory) || 16;
    this.ro.e.set(0, `≈ ${Math.round((C_CELL * VDD) / 1.6e-19).toLocaleString('en')}`);
    this.ro.flips.set(this.flips);
    const weakest = Math.min(...this.cells.map((c) => c.tau)) / Math.pow(2, (this.tempC - 45) / 10);
    this.ro.ret.set(0, `${weakest.toFixed(0)} ms`);
    this.ro.cells.set(0, `${(gb * 8).toLocaleString('en')} billion`);
    this.plot.series = [{ color: tcs('#1d1f22'), width: 1.75, points: this.readTrace }];
    this.plot.draw();
  }
}

