import * as THREE from 'three';
import { C, M, Part, slab, cyl, box, v, polyline, segments, ink, basicMat } from '../core/ink';
import { tcs } from '../core/theme';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal, ThermalSim } from '../sim/thermal';
import { h, segmented, readout, section, grind, facts, Plot, fmtDuration } from '../core/ui';
import { N } from './ids';

// The battery pack and its protection board at true size, plus Detail D: the layers inside a cell,
// magnified 200 times, with lithium ions crossing the separator in the direction the current flows.

const DETAIL_SCALE = 0.2; // 1 µm of the cell stack drawn as 0.2 mm

interface Layer {
  name: string;
  um: number;
  fill: number;
}

const STACK: Layer[] = [
  { name: 'copper foil', um: 8, fill: M.copper },
  { name: 'graphite anode', um: 70, fill: 0x3d4045 },
  { name: 'separator', um: 12, fill: M.white },
  { name: 'cobalt-oxide cathode', um: 58, fill: 0x6b6f78 },
  { name: 'aluminium foil', um: 12, fill: M.tin },
  { name: 'cobalt-oxide cathode', um: 58, fill: 0x6b6f78 },
  { name: 'separator', um: 12, fill: M.white },
  { name: 'graphite anode', um: 70, fill: 0x3d4045 },
  { name: 'copper foil', um: 8, fill: M.copper },
];

class Pack {
  group = new THREE.Group();
  parts: Record<string, Part[]> = {};
  anchors: Record<string, THREE.Object3D> = {};
  detail = new THREE.Group();
  ions!: THREE.InstancedMesh;
  ionState: { x: number; z: number; t: number; lane: number }[] = [];
  lanes: { y0: number; y1: number }[] = [];
  cellW: number;
  cellD: number;
  cellH: number;

  constructor(public arch: Arch) {
    const s = SPEC[arch];
    const arm = arch === 'arm';
    const cellW = (this.cellW = arm ? 78 : 80), cellD = (this.cellD = arm ? 96 : 95), cellH = (this.cellH = arm ? 4.2 : 6.6);
    const add = (k: string, p: Part) => {
      (this.parts[k] ??= []).push(p);
      this.group.add(p);
      return p;
    };
    const anchor = (k: string, x: number, y: number, z: number, parent: THREE.Object3D = this.group) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.anchors[k] = o;
    };
    // four pouch cells in series, tabs towards the protection board
    for (let i = 0; i < s.cells; i++) {
      const x = (i - (s.cells - 1) / 2) * (cellW + 4);
      const cell = add('cells', new Part(slab(cellW, cellH, cellD, 3, 0.9), { hull: true, threshold: 40, fill: M.foil }));
      cell.position.set(x, 0, 0);
      const seal = add('cells', new Part(slab(cellW - 4, 0.4, 6, 1), { width: 0.7, threshold: 40, fill: M.foil }));
      seal.position.set(x, cellH / 2 - 0.2, -cellD / 2 - 3);
      for (const [tx, fill] of [[-cellW * 0.22, M.tin], [cellW * 0.22, 0xb9bdc4]] as const) {
        const tab = add('tabs', new Part(slab(12, 0.2, 14, 0.5), { width: 0.7, threshold: 40, fill }));
        tab.position.set(x + tx, cellH / 2, -cellD / 2 - 10);
      }
      const label = add('cells', new Part(slab(cellW * 0.42, 0.08, cellD * 0.2, 1), { width: 0.5, threshold: 40, fill: M.foil }));
      label.position.set(x, cellH, 6);
    }
    anchor('cells', cellW / 2 - 10, cellH, 10);
    anchor('tabs', -cellW * 0.22 - (cellW + 4) * 1.5, cellH / 2 + 0.2, -cellD / 2 - 10);
    // protection board: fuel gauge, protection IC, two pairs of MOSFETs, a fuse, thermistors
    const bw = s.cells * (cellW + 4) - 10;
    const bz = -cellD / 2 - 22;
    const board = add('bms', new Part(slab(bw, 1.0, 9, 1.5), { hull: true, threshold: 40, fill: M.pcb }));
    board.position.set(0, cellH / 2 - 0.5, bz);
    const chip = (k: string, x: number, w: number, d: number, hh: number, fill: number) => {
      const p = add(k, new Part(slab(w, hh, d, 0.4), { width: 0.7, threshold: 40, fill }));
      p.position.set(x, cellH / 2 + 0.5, bz);
      return p;
    };
    chip('gauge', -bw / 2 + 30, 5, 5, 0.9, M.mold);
    chip('bms', -bw / 2 + 44, 6, 4, 0.9, M.mold);
    for (let i = 0; i < 4; i++) chip('fets', -bw / 2 + 62 + i * 8, 5, 6, 1.1, M.mold);
    chip('fuse', bw / 2 - 40, 6, 2.5, 1.6, M.ceramic);
    for (let i = 0; i < s.cells; i++) {
      const th = add('therm', new Part(cyl(0.9, 6, 12).rotateX(Math.PI / 2), { width: 0.6, hull: true, threshold: 40, fill: M.mold }));
      th.position.set((i - (s.cells - 1) / 2) * (cellW + 4) + 10, cellH + 0.5, -cellD / 2 + 8);
    }
    anchor('gauge', -bw / 2 + 30, cellH / 2 + 1.4, bz);
    anchor('fets', -bw / 2 + 74, cellH / 2 + 1.6, bz);
    anchor('therm', (cellW + 4) * 0.5 + 10, cellH + 1, -cellD / 2 + 8);
    // flat cable to the logic board
    const cab = add('cable', new Part(slab(14, 0.3, 40, 1), { width: 0.7, threshold: 40, fill: M.copper }));
    cab.position.set(bw / 2 - 18, cellH / 2 + 0.6, bz - 22);
    anchor('cable', bw / 2 - 18, cellH / 2 + 0.9, bz - 36);
    // series links between cells along the board
    const links: THREE.Vector3[] = [];
    for (let i = 0; i < s.cells - 1; i++) {
      const x0 = (i - (s.cells - 1) / 2) * (cellW + 4) + cellW * 0.22;
      links.push(v(x0, cellH / 2 + 0.3, -cellD / 2 - 16), v(x0 + cellW + 4 - cellW * 0.44, cellH / 2 + 0.3, -cellD / 2 - 16));
    }
    this.group.add(segments(links, ink(1.6)));

    // Detail D: the stack through one cell, drawn 200 times larger, floating above the pack
    const D = this.detail;
    D.position.set(-cellW * 2.35, 30, cellD * 0.85);
    this.group.add(D);
    const dw = 54, dd = 30;
    let y = 0;
    for (const L of STACK) {
      const hh = L.um * DETAIL_SCALE;
      const p = new Part(box(dw, hh, dd).translate(0, hh / 2, 0), { width: 0.8, threshold: 30, fill: L.fill });
      p.position.y = y;
      D.add(p);
      (this.parts.detail ??= []).push(p);
      if (L.name === 'separator') this.lanes.push({ y0: y - 8, y1: y + hh + 8 });
      y += hh;
    }
    D.add(polyline([v(-dw / 2 - 6, -6, dd / 2 + 6), v(dw / 2 + 6, -6, dd / 2 + 6), v(dw / 2 + 6, y + 6, dd / 2 + 6), v(-dw / 2 - 6, y + 6, dd / 2 + 6)], ink(0.8, C.grey), true));
    anchor('detail', dw / 2, y * 0.5, dd / 2, D);
    // leader from the detail to the cell it came from
    this.group.add(polyline([v(-cellW * 2.35 + dw / 2, 30, cellD * 0.85), v(-(cellW + 4) * 1.5, cellH + 0.5, cellD * 0.2)], ink(0.7, C.grey)));
    this.ions = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 10, 8), basicMat(C.red, { depthTest: false }), 90);
    this.ions.renderOrder = 10;
    this.ions.count = 0;
    D.add(this.ions);
    for (let i = 0; i < 90; i++) this.ionState.push({ x: -dw / 2 + Math.random() * dw, z: dd / 2 + 0.6, t: Math.random(), lane: i % 2 });
  }
}

export class PowerSheet extends Sheet {
  readonly no = N.power;
  readonly title = 'Battery and charger';
  readonly short = 'power';
  readonly mmPerUnit = 1;
  readonly sub = 'Battery pack and protection board; Detail D through one cell, 200 : 1';
  view: View = { height: 210, az: -24, el: 32, target: new THREE.Vector3(8, 12, -14), minZoom: 0.5, maxZoom: 14 };
  packs!: Record<Arch, Pack>;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private pdBox!: HTMLElement;
  private buckBox!: HTMLElement;
  private lastPaint = 0;
  private m4 = new THREE.Matrix4();

  build() {
    this.packs = { arm: new Pack('arm'), x86: new Pack('x86') };
    for (const p of Object.values(this.packs)) this.root.add(p.group);
    this.applyArch();
    state.on('arch', () => this.applyArch());
  }

  private get p() {
    return this.packs[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    this.packs.arm.group.visible = a === 'arm';
    this.packs.x86.group.visible = a === 'x86';
    const p = this.p;
    const s = SPEC[a];
    p.group.updateMatrixWorld(true);
    p.anchors.cells.getWorldPosition(this.zoomTarget);
    const refs: Ref[] = [
      { n: 400, name: 'Pouch cells', text: `${s.cellConfig}. Each cell is a flat stack of electrodes sealed in an aluminium-laminate pouch; four in series give ${s.packV} V nominal, ${s.batteryWh} Wh in all.`, facts: [['Energy', `${s.batteryWh} Wh`], ['Per cell', `${(s.batteryWh / s.cells).toFixed(1)} Wh, 3.0–4.4 V, ${(s.packV / s.cells).toFixed(2)} V nominal`]], target: p.anchors.cells, off: [90, -40], parts: p.parts.cells },
      { n: 402, name: 'Cell tabs', text: 'Aluminium tabs from the cathodes and nickel-plated copper tabs from the anodes, welded to the series links.', target: p.anchors.tabs, off: [-70, 40], parts: p.parts.tabs, grind: true },
      { n: 404, name: 'Fuel gauge', text: 'Counts every coulomb in and out and tracks each cell\'s voltage, temperature and ageing, so the percentage you see stays honest as the cells wear.', target: p.anchors.gauge, off: [-60, -60], parts: p.parts.gauge },
      { n: 406, name: 'Protection MOSFETs', text: 'Two pairs of switches that cut the pack off in microseconds if a cell goes over about 4.5 V, under 2.5 V, too hot, or the current spikes. A fuse backs them up.', target: p.anchors.fets, off: [40, -70], parts: [...(p.parts.fets ?? []), ...(p.parts.fuse ?? [])] },
      { n: 408, name: 'Thermistors', text: 'One temperature sensor on each cell. Charging slows down above 45 °C and stops below 0 °C, where lithium would plate onto the anode.', target: p.anchors.therm, off: [70, -50], parts: p.parts.therm, grind: true },
      { n: 410, name: 'Flat cable', text: 'Power and the gauge\'s data bus to the logic board.', target: p.anchors.cable, off: [70, 30], parts: p.parts.cable, see: N.board, grind: true },
      { n: 412, name: 'Detail D: inside a cell', text: 'Copper foil coated with graphite, a 12 µm plastic separator soaked in electrolyte, then a cathode of lithium cobalt oxide on aluminium foil, repeated about 30 times. Charging pushes lithium ions out of the cathode, through the separator, into the graphite.', facts: STACK.slice(0, 5).map((L) => [L.name, `${L.um} µm`] as [string, string]), target: p.anchors.detail, off: [80, -30], parts: p.parts.detail },
    ];
    this.refs = refs;
    this.dims = [{ a: v(-(s.cells / 2) * (p.cellW + 4) + 2, 0, p.cellD / 2), b: v((s.cells / 2) * (p.cellW + 4) - 2, 0, p.cellD / 2), space: p.group, off: 26, text: () => `${(s.cells * (p.cellW + 4) - 4).toFixed(0)} mm` }];
    this.view.height = a === 'arm' ? 290 : 300;
    this.paintPd();
    this.onRebuild();
  }

  panel() {
    const plug = segmented<'bat' | 'ac'>({ label: 'Power source', options: [{ value: 'bat', label: 'On battery' }, { value: 'ac', label: 'Charger plugged in' }], value: state.plugged ? 'ac' : 'bat', onChange: (x) => state.setPlugged(x === 'ac') });
    state.on('plugged', () => {
      plug.set(state.plugged ? 'ac' : 'bat');
      this.paintPd();
    });
    const limit = segmented({ label: 'Charge to', options: [{ value: '100', label: '100 %' }, { value: '80', label: '80 %, battery care' }], value: thermal.chargeLimit < 1 ? '80' : '100', onChange: (x) => {
      thermal.chargeLimit = Number(x) / 100;
      state.revise(this.no, `Charge limit set to ${x} %`);
    } });
    const speed = segmented({ label: 'Simulation speed', options: [{ value: '1', label: 'Real time' }, { value: '60', label: '60 ×' }, { value: '600', label: '600 ×' }], value: String(thermal.speed) as '1', onChange: (x) => (thermal.speed = Number(x)) });
    this.ro = {
      pct: readout({ label: 'Charge', unit: '%', digits: 1, min: 0, max: 100 }),
      flow: readout({ label: 'Into the battery', unit: 'W', digits: 1, live: (w) => Math.abs(w) > 0.3 }),
      cell: readout({ label: 'Cell voltage', unit: 'V', digits: 3 }),
      amps: readout({ label: 'Pack current', unit: 'A', digits: 2 }),
      time: readout({ label: 'Time', trend: false }),
      ad: readout({ label: 'From the charger', unit: 'W', digits: 1, min: 0 }),
    };
    this.plot = new Plot({ x: [0, 100], y: [3.0, 4.5], xLabel: 'state of charge, %', yLabel: 'cell volts', xTicks: [0, 20, 40, 60, 80, 100], yTicks: [3.0, 3.4, 3.8, 4.2], fmtY: (y) => y.toFixed(1), caption: 'Black: open-circuit voltage of one cell. Grey dashed: charging current, constant until the cells near full, then tapering.' });
    this.pdBox = h('div');
    this.buckBox = h('div');
    this.paintPd();
    return h(
      'div',
      null,
      section(null, plug.el, limit.el, h('div', { class: 'ro-grid' }, this.ro.pct.el, this.ro.flow.el, this.ro.time.el, this.ro.ad.el), this.plot.el),
      grind('Cells', speed.el, h('div', { class: 'ro-grid' }, this.ro.cell.el, this.ro.amps.el), h('p', { class: 'note' }, 'Charging above about 80 % holds the cells at high voltage, which ages them fastest. A typical pack keeps 80 % of its capacity after 800 to 1,000 full cycles; stopping at 80 % keeps the cells at a lower voltage and can stretch that by half or more.')),
      grind('How the charger talks', this.pdBox),
      grind('From 20 V to one volt', this.buckBox),
    );
  }

  private paintPd() {
    if (!this.pdBox) return;
    const s = SPEC[state.arch];
    if (state.arch === 'arm') {
      const rows: [string, string][] = [
        ['1 · Attach', 'the CC pins in the USB-C cable tell both ends which way round the plug is'],
        ['2 · Source capabilities', '5 V 3 A · 9 V 3 A · 15 V 3 A · 20 V 3.25 A'],
        ['3 · Request', 'the laptop asks for 20 V at 3.25 A'],
        ['4 · Accept, PS_RDY', 'the charger ramps its output from 5 V to 20 V'],
        ['Now', state.plugged ? `${s.charger.watts} W contract, ${thermal.adapterW.toFixed(0)} W in use` : 'unplugged: 0 V on the port until a sink asks'],
      ];
      this.pdBox.replaceChildren(h('p', { class: 'note' }, 'A USB-C port carries no voltage until the two ends agree on one. The negotiation runs on a 300 kbit/s line in the cable, before any power flows:'), facts(rows));
    } else {
      this.pdBox.replaceChildren(
        h('p', { class: 'note' }, 'The slim rectangular plug is a fixed 20 V supply with no negotiation. The laptop identifies the adapter\'s rating through the plug and sets its power limits to match: plug in a smaller adapter and it runs slower rather than overloading it.'),
        facts([
          ['Adapter', s.charger.kind],
          ['Detected', state.plugged ? `${s.charger.watts} W` : 'nothing connected'],
          ['On USB-C instead', 'up to 100 W: enough to charge and for light work, not for full-power gaming'],
        ]),
      );
    }
  }

  update(dt: number) {
    const p = this.p;
    const s = SPEC[state.arch];
    const bw = thermal.batteryW;
    const amps = bw / s.packV;
    // ions cross the separator: towards the anode when charging, back to the cathode when discharging
    const rate = Math.min(1, Math.abs(amps) / 4);
    const dir = amps >= 0 ? 1 : -1;
    const n = Math.round(10 + 80 * rate);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ion = p.ionState[i];
      ion.t += dt * (0.25 + rate * 1.4);
      if (ion.t > 1) {
        ion.t -= 1;
        ion.x = -35 + Math.random() * 70;
      }
      const lane = p.lanes[ion.lane];
      // each lane: cathode → separator → anode is downward for the lower separator, upward for the upper one
      const sign = ion.lane === 0 ? -dir : dir;
      const tt = sign > 0 ? ion.t : 1 - ion.t;
      const y = lane.y0 + (lane.y1 - lane.y0) * tt;
      this.m4.makeTranslation(ion.x, y, ion.z);
      p.ions.setMatrixAt(k++, this.m4);
    }
    p.ions.count = k;
    p.ions.instanceMatrix.needsUpdate = true;
    for (const c of p.parts.tabs ?? []) c.setLive(Math.abs(bw) > 0.3);
    for (const c of p.parts.cable ?? []) c.setLive(Math.abs(bw) > 0.3);
    const now = performance.now();
    if (!this.ro || now - this.lastPaint < 200) return;
    this.lastPaint = now;
    const pct = thermal.batteryPct();
    this.ro.pct.set(pct);
    this.ro.flow.set(bw);
    this.ro.cell.set(thermal.cellVolts());
    this.ro.amps.set(amps);
    this.ro.ad.set(thermal.adapterW);
    this.ro.time.set(0, bw > 0.3 ? `full in ${fmtDuration(((s.batteryWh * thermal.chargeLimit - thermal.batteryWh) / bw) * 3600)}` : bw < -0.3 ? `empty in ${fmtDuration((thermal.batteryWh / -bw) * 3600)}` : 'holding');
    const ocv: [number, number][] = [];
    const cur: [number, number][] = [];
    const top = thermal.chargeLimit * 100;
    for (let x = 0; x <= 100; x += 1) {
      ocv.push([x, ThermalSim.ocv(x)]);
      const taper = thermal.chargeLimit < 1 ? 5 : 20;
      const c = x < top - taper ? 1 : Math.max(0, (top - x) / taper);
      cur.push([x, 3.0 + c * 1.3]);
    }
    this.plot.series = [
      { color: tcs('#1d1f22'), width: 1.75, points: ocv },
      { color: tcs('#8b8e88'), width: 1.25, dash: [5, 3], points: cur },
    ];
    this.plot.marker = [pct, thermal.cellVolts()];
    this.plot.markerLive = Math.abs(bw) > 0.3;
    this.plot.draw();
    const vin = state.plugged ? 20 : s.cells * thermal.cellVolts();
    const vcore = 0.6 + 0.4 * Math.min(1, thermal.freq / 4.5);
    const icore = thermal.power / vcore;
    this.buckBox.replaceChildren(
      h('p', { class: 'note' }, 'Buck converters switch the input on and off hundreds of thousands of times a second; an inductor smooths the pulses into a low, steady voltage. The share of time the switch is on sets the output.'),
      facts([
        ['Input', `${vin.toFixed(1)} V, ${state.plugged ? 'from the charger' : 'from the battery'}`],
        ['Core rail', `${vcore.toFixed(2)} V at ${icore.toFixed(1)} A`],
        ['Switch on-time', `${((vcore / vin) * 100).toFixed(1)} % of each cycle`],
        ['Switching frequency', '≈ 800 kHz, in several phases'],
        ['Efficiency', '≈ 90 %, the rest is heat in the inductors'],
      ]),
    );
  }
}
