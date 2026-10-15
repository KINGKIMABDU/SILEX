import * as THREE from 'three';
import { tcs, onTheme } from '../core/theme';
import { C, Part, slab, v, segments, ink } from '../core/ink';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch } from '../core/state';
import { buildProgram, Core, PORTS, FRONT_END_DEPTH, type Program, type Uop } from '../sim/pipeline';
import { h, segmented, slider, readout, button, section } from '../core/ui';
import { N } from './ids';

interface Unit {
  key: string;
  x: number;
  z: number;
  w: number;
  d: number;
  tone?: number;
}

function units(arch: Arch): Unit[] {
  const arm = arch === 'arm';
  const u: Unit[] = [
    { key: 'bp', x: -1.05, z: -0.75, w: 0.42, d: 0.5 },
    { key: 'l1i', x: -1.05, z: -0.2, w: 0.42, d: 0.55, tone: C.tone1 },
    { key: 'dec', x: -0.58, z: -0.75, w: 0.46, d: arm ? 1.05 : 0.6 },
    { key: 'ren', x: -0.07, z: -0.75, w: 0.42, d: 1.05, tone: C.tone1 },
    { key: 'sch', x: 0.4, z: -0.75, w: 0.26, d: 1.05 },
    { key: 'fp', x: -1.05, z: 0.4, w: 1.71, d: 0.34 },
    { key: 'l1d', x: 0.71, z: 0.4, w: 0.36, d: 0.34, tone: C.tone1 },
    { key: 'l2', x: -1.05, z: 0.78, w: 2.12, d: 0.08, tone: C.tone2 },
  ];
  if (!arm) u.push({ key: 'uopc', x: -0.58, z: -0.1, w: 0.46, d: 0.4, tone: C.tone1 });
  const P = PORTS[arch];
  const alus = P.alu, loads = P.load, muls = P.mul;
  const n = alus + muls;
  for (let i = 0; i < n; i++) u.push({ key: i < alus ? `alu${i}` : `mul${i - alus}`, x: 0.71, z: -0.75 + i * (0.7 / n), w: 0.36, d: 0.7 / n - 0.02 });
  for (let i = 0; i < loads; i++) u.push({ key: `ld${i}`, x: 0.71, z: -0.03 + i * (0.4 / loads), w: 0.36, d: 0.4 / loads - 0.02 });
  return u;
}


class CoreDrawing {
  group = new THREE.Group();
  unitParts = new Map<string, Part>();
  unitDims = new Map<string, Unit>();
  tokens: Part[] = [];
  tokenTarget = new Map<Part, THREE.Vector3>();

  constructor(public arch: Arch) {
    const base = new Part(slab(2.2, 0.01, 1.66, 0.02), { hull: true, threshold: 40, fill: C.tone2, width: 1.3 });
    base.position.set(0, -0.01, 0);
    this.group.add(base);
    this.unitParts.set('core', base);
    for (const u of units(arch)) {
      const p = new Part(slab(u.w, 0.03, u.d, 0.015), { width: 0.9, threshold: 40, fill: u.tone ?? C.paper });
      p.position.set(u.x + u.w / 2, 0, u.z + u.d / 2);
      this.group.add(p);
      this.unitParts.set(u.key, p);
      this.unitDims.set(u.key, u);
    }
    // what each block is made of, in fine line: SRAM banks, decoder lanes, buffer entries, vector pipes
    const fine: THREE.Vector3[] = [];
    const Y = 0.032;
    const box = (u: Unit) => [u.x + 0.02, u.z + 0.02, u.x + u.w - 0.02, u.z + u.d - 0.02] as const;
    const cols = (u: Unit, n: number) => {
      const [x0, z0, x1, z1] = box(u);
      for (let i = 1; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        fine.push(v(x, Y, z0), v(x, Y, z1));
      }
    };
    const rows = (u: Unit, n: number, from = 0) => {
      const [x0, z0, x1, z1] = box(u);
      for (let i = 1; i < n; i++) {
        const z = z0 + ((z1 - z0) * i) / n;
        fine.push(v(x0 + (x1 - x0) * from, Y, z), v(x1, Y, z));
      }
    };
    for (const u of units(arch)) {
      switch (u.key) {
        case 'l1i':
        case 'l1d':
          // SRAM: four banks, each with its tag array along one edge
          cols(u, 2);
          rows(u, 2);
          rows(u, 8, 0.82);
          break;
        case 'l2':
          cols(u, 16);
          break;
        case 'dec':
          cols(u, arch === 'arm' ? 8 : 6);
          break;
        case 'ren':
          // the reorder buffer: hundreds of entries, drawn as a dense ladder beside the register file
          cols(u, 3);
          rows(u, 40, 0.34);
          break;
        case 'sch':
          rows(u, 24);
          break;
        case 'fp':
          cols(u, 4);
          rows(u, 3);
          break;
        case 'bp':
          cols(u, 3);
          rows(u, 4);
          break;
        case 'uopc':
          cols(u, 4);
          rows(u, 6);
          break;
      }
    }
    this.group.add(segments(fine, ink(0.4, C.ink2)));

    const tokGeo = slab(0.07, 0.035, 0.05, 0.01);
    for (let i = 0; i < 64; i++) {
      const t = new Part(tokGeo, { width: 0.9, threshold: 40, fill: C.paper });
      t.visible = false;
      this.group.add(t);
      this.tokens.push(t);
    }
  }

  unitCenter(key: string, out: THREE.Vector3) {
    const p = this.unitParts.get(key);
    if (!p) return out.set(0, 0, 0);
    return out.copy(p.position);
  }
}

export class CoreSheet extends Sheet {
  readonly no = N.core;
  readonly title = 'One core';
  readonly short = 'core';
  readonly mmPerUnit = 1;
  readonly sub = 'One performance core, plan view, running the loop on the right';
  view: View = { height: 2.4, az: -10, el: 58, target: new THREE.Vector3(0, 0, 0.02), minZoom: 0.5, maxZoom: 40 };
  drawings!: Record<Arch, CoreDrawing>;
  progId: 'one' | 'two' = 'one';
  width = 8;
  rob = 600;
  ooo = true;
  mem: 'l1' | 'l2' | 'dram' = 'l1';
  predictor = true;
  cps = 6; // cycles per second while running
  running = false;
  prog!: Program;
  core!: Core;
  private acc = 0;
  private diag!: HTMLCanvasElement;
  private listing!: HTMLElement;
  private regs!: HTMLElement;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private runBtn!: HTMLButtonElement;
  private widthSeg!: ReturnType<typeof segmented<string>>;

  build() {
    this.drawings = { arm: new CoreDrawing('arm'), x86: new CoreDrawing('x86') };
    for (const d of Object.values(this.drawings)) this.root.add(d.group);
    this.applyArch();
    state.on('arch', () => this.applyArch());
    onTheme(() => this.drawDiagram());
  }

  private get dr() {
    return this.drawings[state.arch];
  }

  onRebuild: () => void = () => {};

  private memLat() {
    return { l1: 4, l2: 14, dram: 380 }[this.mem];
  }

  private reset() {
    const a = state.arch;
    this.prog = buildProgram(a, this.progId, this.memLat());
    this.core = new Core(this.prog, { width: this.width, rob: this.rob, ooo: this.ooo, memLat: this.memLat(), predictor: this.predictor, ports: PORTS[a] });
    this.acc = 0;
    this.paintListing();
    this.paintAll();
  }

  private applyArch() {
    const a = state.arch;
    this.drawings.arm.group.visible = a === 'arm';
    this.drawings.x86.group.visible = a === 'x86';
    const d = this.dr;
    d.unitCenter('alu0', this.zoomTarget);
    const U = (k: string) => d.unitParts.get(k)!;
    const P = PORTS[a];
    const alus = Array.from({ length: P.alu }, (_, i) => U(`alu${i}`));
    const muls = Array.from({ length: P.mul }, (_, i) => U(`mul${i}`));
    const lds = Array.from({ length: P.load }, (_, i) => U(`ld${i}`));
    const refs: Ref[] = [
      { n: 1000, name: 'Branch predictor', text: 'Guesses where the program goes next, many branches ahead, from the history of earlier branches. Modern predictors are right well over 95 % of the time; every miss throws away a dozen cycles of work.', target: U('bp'), off: [-50, -50], parts: [U('bp')] },
      { n: 1002, name: 'L1 instruction cache', text: `Holds the instructions about to run, ${a === 'arm' ? '192' : '64'} KB, one cycle from the fetch unit.`, facts: [['Size', a === 'arm' ? '192 KB' : '64 KB']], target: U('l1i'), off: [-60, 30], parts: [U('l1i')] },
      { n: 1004, name: 'Decoders', text: a === 'arm' ? 'AArch64 instructions are all exactly 4 bytes, so eight decoders can each take the next 4 bytes in parallel. Wide decoding is cheap.' : 'x86 instructions are 1 to 15 bytes long. The decoders must find where each one starts before decoding it, which is why x86 cores also cache already-decoded µops.', facts: [['Width', '8 per cycle']], target: U('dec'), off: [-30, -80], parts: [U('dec')] },
      { n: 1008, name: 'Rename and reorder buffer', text: `Gives every result a fresh physical register so false dependencies vanish, and tracks up to ${a === 'arm' ? 'about 650' : 'about 576'} µops in program order so they can finish out of order but retire in order.`, facts: [['ROB entries', a === 'arm' ? '≈ 650' : '≈ 576']], target: U('ren'), off: [10, -90], parts: [U('ren')] },
      { n: 1010, name: 'Schedulers', text: 'Hold µops until their inputs are ready, then send the oldest ready ones to free execution ports. This is where out-of-order execution happens.', target: U('sch'), off: [40, -80], parts: [U('sch')] },
      { n: 1012, name: 'Integer units', text: `${P.alu} ALUs and ${P.mul} multipliers. Adds take one cycle; a 64-bit multiply takes three.`, facts: [['ALUs', String(P.alu)], ['Multipliers', String(P.mul)]], target: U('alu0'), off: [80, -40], parts: [...alus, ...muls], see: N.logic },
      { n: 1014, name: 'Load and store units', text: `${P.load} load pipes compute addresses and read the L1 data cache. A hit returns in about 4 cycles.`, target: U('ld0'), off: [90, 10], parts: lds },
      { n: 1016, name: 'Vector and floating-point units', text: 'Wide SIMD units for floating point and vector maths. This integer loop never uses them, so they stay dark.', target: U('fp'), off: [-60, 60], parts: [U('fp')] },
      { n: 1018, name: 'L1 data cache', text: `${a === 'arm' ? '96' : '48'} KB, about 4 cycles away. Data that is not here comes from L2, the system cache, or DRAM, hundreds of cycles away.`, target: U('l1d'), off: [80, 50], parts: [U('l1d')] },
    ];
    if (a === 'x86') refs.splice(3, 0, { n: 1006, name: 'µop cache', text: 'Stores already-decoded µops for loops like this one, so the hard x86 decoders can be skipped and up to 12 µops per cycle flow straight in.', target: U('uopc'), off: [-70, 60], parts: [U('uopc')] });
    this.refs = refs;
    this.dims = [{ a: v(-1.1, -0.01, 0.83), b: v(1.1, -0.01, 0.83), space: d.group, off: 24, text: () => '2.2 mm' }];
    if (this.widthSeg) this.widthSeg.set(String(this.width));
    this.reset();
    this.onRebuild();
  }

  panel() {
    const prog = segmented({
      label: 'Program: sum of a[i] × b[i] over 32 numbers',
      options: [
        { value: 'one', label: 'One accumulator' },
        { value: 'two', label: 'Two accumulators' },
      ],
      value: this.progId,
      onChange: (x) => {
        this.progId = x;
        this.reset();
      },
    });
    const sched = segmented({ label: 'Scheduling', options: [{ value: 'ooo', label: 'Out of order' }, { value: 'io', label: 'In order' }], value: 'ooo', onChange: (x) => { this.ooo = x === 'ooo'; this.reset(); } });
    this.widthSeg = segmented({ label: 'Width, µops per cycle', options: ['1', '2', '4', '6', '8'].map((w) => ({ value: w, label: w })), value: String(this.width), onChange: (x) => {
      this.width = Number(x);
      this.reset();
    } });
    const rob = segmented({ label: 'Reorder buffer', options: ['16', '64', '256', '600'].map((r) => ({ value: r, label: r })), value: String(this.rob), onChange: (x) => { this.rob = Number(x); this.reset(); } });
    const mem = segmented<'l1' | 'l2' | 'dram'>({ label: 'The arrays live in', options: [{ value: 'l1', label: 'L1 · 4 cyc' }, { value: 'l2', label: 'L2 · 14 cyc' }, { value: 'dram', label: 'DRAM · 380 cyc' }], value: this.mem, onChange: (x) => { this.mem = x; this.reset(); } });
    const bp = segmented({ label: 'Branch predictor', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off (always guess not taken)' }], value: 'on', onChange: (x) => { this.predictor = x === 'on'; this.reset(); } });
    const speed = slider({ label: 'Playback', min: 1, max: 60, step: 1, value: this.cps, format: (x) => `${x} cycles / s`, onInput: (x) => (this.cps = x) });
    this.runBtn = button('Run', () => this.toggleRun(), { primary: true }) as HTMLButtonElement;
    this.ro = {
      cyc: readout({ label: 'Cycle', digits: 0, trend: false }),
      ins: readout({ label: 'Instructions retired', digits: 0, trend: false }),
      ipc: readout({ label: 'Instructions per cycle', digits: 2, trend: false }),
      rob: readout({ label: 'µops in flight', digits: 0, min: 0 }),
    };
    this.diag = h('canvas', { class: 'pipe', 'aria-label': 'Pipeline diagram: one row per µop, one column per cycle' }) as HTMLCanvasElement;
    this.listing = h('div', { class: 'listing' });
    this.regs = h('div', { class: 'note' });
    this.paintListing();
    this.paintAll();
    return h(
      'div',
      null,
      section(null, prog.el, this.listing),
      section(
        'Run it',
        h('div', { class: 'btn-row' }, this.runBtn, button('Step one cycle', () => this.stepOnce()), button('Run to the end', () => this.finish()), button('Reset', () => this.reset())),
        speed.el,
        h('div', { class: 'ro-grid' }, this.ro.cyc.el, this.ro.ins.el, this.ro.ipc.el, this.ro.rob.el),
        h('figure', { class: 'plot-fig' }, this.diag, h('figcaption', null, 'F fetch, D decode, R rename, · waiting for its inputs, E executing (red), W finished and waiting to retire in order, C retired.')),
        this.regs,
      ),
      section('Build a different core', sched.el, this.widthSeg.el, rob.el, mem.el, bp.el, h('p', { class: 'note' }, 'Timing model of the real loop: each µop waits for its inputs, a free port, a reorder-buffer slot. Wrong-path work after a mispredict is shown as a fetch stall; prefetchers are off.')),
    );
  }

  private toggleRun() {
    this.running = !this.running;
    if (this.core.done) {
      this.reset();
      this.running = true;
    }
    this.runBtn.textContent = this.running ? 'Pause' : 'Run';
  }

  private stepOnce() {
    this.running = false;
    if (this.runBtn) this.runBtn.textContent = 'Run';
    this.core.step();
    this.after();
  }

  private finish() {
    this.core.runToEnd();
    this.after();
  }

  private after() {
    this.paintAll();
    if (this.core.done) {
      this.running = false;
      if (this.runBtn) this.runBtn.textContent = 'Run again';
      const a = state.arch;
      const cfg = `${this.ooo ? 'out of order' : 'in order'}, width ${this.width}, ROB ${this.rob}, ${this.mem.toUpperCase()}${this.predictor ? '' : ', no predictor'}`;
      state.revise(this.no, `${this.prog.label} on ${a.toUpperCase()}: IPC ${this.core.ipc().toFixed(2)} in ${this.core.cycle} cycles (${cfg})`);
    }
  }

  private paintListing() {
    if (!this.listing || !this.prog) return;
    const a = state.arch;
    const L = this.prog.listing;
    const totalBytes = L.reduce((s, i) => s + i.bytes.length, 0);
    const uops = L.reduce((s, i) => s + i.uops, 0);
    this.listing.replaceChildren(
      h('div', { class: 'lst-head' }, h('span', null, 'loop:'), h('span', null, `${L.length} instructions · ${totalBytes} bytes · ${uops} µops per pass`)),
      ...L.map((ins, i) =>
        h(
          'div',
          { class: 'lst-row', 'data-i': String(i) },
          h('code', { class: 'lst-bytes' }, ins.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')),
          h('code', { class: 'lst-asm' }, ins.asm),
          h('span', { class: 'lst-note' }, ins.note ?? (ins.uops === 0 ? 'fused' : '')),
        ),
      ),
      h('p', { class: 'note', style: { marginTop: '6px' } }, a === 'arm' ? 'Every AArch64 instruction is 4 bytes, so instruction boundaries are known before decoding.' : 'x86 instructions here are 2 to 5 bytes long. The decoder finds the boundaries first, splits imul with a memory operand into two µops, and fuses the counter with the jump into one.'),
    );
  }

  private paintAll() {
    if (!this.ro || !this.core) return;
    const c = this.core;
    this.ro.cyc.set(c.cycle);
    this.ro.ins.set(c.retiredInstr, `${c.retiredInstr} / ${this.prog.instrCount}`);
    this.ro.ipc.set(c.ipc());
    this.ro.rob.set(c.robNow());
    // highlight static instructions currently executing
    const exec = new Set<number>();
    for (let i = c.robHead; i < c.fetchPtr; i++) {
      const u = this.prog.uops[i];
      if (u.iss >= 0 && u.iss <= c.cycle - 1 && u.done > c.cycle - 1) exec.add(u.instr);
    }
    this.listing?.querySelectorAll('.lst-row').forEach((r) => r.classList.toggle('live', exec.has(Number((r as HTMLElement).dataset.i))));
    const res = this.prog.result;
    this.regs.textContent = c.done
      ? `Finished: ${res.reg} = ${res.value.toLocaleString('en')}, which matches the sum computed directly (${res.expect.toLocaleString('en')}). ${c.mispredicts} branch ${c.mispredicts === 1 ? 'miss' : 'misses'}. At ${state.arch === 'arm' ? '4.2' : '5.4'} GHz this took ${(c.cycle / (state.arch === 'arm' ? 4.2 : 5.4)).toFixed(1)} ns.`
      : `Result register ${res.reg} fills in as the madds retire. ${c.mispredicts} branch ${c.mispredicts === 1 ? 'miss' : 'misses'} so far.`;
    this.drawDiagram();
  }

  private stageAt(u: Uop, cyc: number): string {
    if (u.fetch < 0 || cyc < u.fetch) return '';
    if (u.ret >= 0 && cyc > u.ret) return '';
    if (u.ret === cyc) return 'C';
    if (u.ren < 0 || cyc < u.ren) return cyc - u.fetch < FRONT_END_DEPTH / 2 ? 'F' : 'D';
    if (cyc === u.ren) return 'R';
    if (u.iss < 0 || cyc < u.iss) return '·';
    if (cyc < u.done) return 'E';
    return 'W';
  }

  private drawDiagram() {
    const cv = this.diag;
    if (!cv) return;
    const cssW = cv.clientWidth || 330;
    const rows = 14, cols = 26;
    const cw = (cssW - 92) / cols, rh = 15;
    const cssH = rows * rh + 20;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      cv.style.height = `${cssH}px`;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const c = this.core;
    const now = Math.max(0, c.cycle - 1);
    const c0 = Math.max(0, now - cols + 2);
    // rows: the most recent µops that have been fetched
    const last = Math.max(0, c.fetchPtr - 1);
    const first = Math.max(0, Math.min(last - rows + 1, Math.max(c.robHead - 3, 0)));
    g.font = '500 10.5px "Barlow Semi Condensed", sans-serif';
    g.textBaseline = 'middle';
    for (let k = 0; k <= cols; k++) {
      const x = 92 + k * cw;
      g.strokeStyle = (c0 + k) % 5 === 0 ? tcs('#cbcdc7') : tcs('#dcddd8');
      g.beginPath();
      g.moveTo(x + 0.5, 14);
      g.lineTo(x + 0.5, cssH);
      g.stroke();
      if ((c0 + k) % 5 === 0 && k < cols) {
        g.fillStyle = tcs('#50545a');
        g.textAlign = 'left';
        g.fillText(String(c0 + k), x + 2, 6);
      }
    }
    for (let r = 0; r < rows; r++) {
      const i = first + r;
      if (i > last || i >= this.prog.uops.length) break;
      const u = this.prog.uops[i];
      const y = 20 + r * rh;
      g.fillStyle = tcs('#1d1f22');
      g.textAlign = 'left';
      g.font = '400 10.5px "JetBrains Mono", monospace';
      g.fillText(u.text.slice(0, 12), 0, y + rh / 2);
      g.font = '600 10.5px "Barlow Semi Condensed", sans-serif';
      g.textAlign = 'center';
      for (let k = 0; k < cols; k++) {
        const cyc = c0 + k;
        if (cyc > now) break;
        const st = this.stageAt(u, cyc);
        if (!st) continue;
        const x = 92 + k * cw;
        if (st === 'E') {
          g.fillStyle = tcs('#cf1f2e');
          g.fillRect(x + 1, y + 2, cw - 1, rh - 4);
          g.fillStyle = tcs('#f3f4f1');
        } else g.fillStyle = st === '·' ? tcs('#8b8e88') : tcs('#1d1f22');
        g.fillText(st, x + cw / 2, y + rh / 2 + 0.5);
      }
    }
    // current cycle cursor
    const cx = 92 + (now - c0 + 1) * cw;
    g.strokeStyle = tcs('#1d1f22');
    g.lineWidth = 1.25;
    g.beginPath();
    g.moveTo(cx + 0.5, 12);
    g.lineTo(cx + 0.5, cssH);
    g.stroke();
    g.lineWidth = 1;
  }

  update(dt: number) {
    if (!this.core) return;
    if (this.running && !this.core.done) {
      this.acc += dt * this.cps;
      let stepped = false;
      while (this.acc >= 1 && !this.core.done) {
        this.acc -= 1;
        this.core.step();
        stepped = true;
      }
      if (stepped) this.after();
    }
    this.placeTokens(dt);
  }

  private placeTokens(dt: number) {
    const d = this.dr;
    const c = this.core;
    const cyc = Math.max(0, c.cycle - 1);
    const slot = new Map<string, number>();
    const active = new Set<string>();
    let k = 0;
    for (let i = Math.max(0, c.robHead - 2); i < c.fetchPtr && k < d.tokens.length; i++) {
      const u = this.prog.uops[i];
      const st = this.stageAt(u, cyc);
      if (!st) continue;
      let key = 'dec';
      if (st === 'F') key = 'l1i';
      else if (st === 'D') key = state.arch === 'x86' ? 'uopc' : 'dec';
      else if (st === 'R' || st === 'W' || st === 'C') key = 'ren';
      else if (st === '·') key = 'sch';
      else key = u.kind === 'load' ? `ld${Math.max(0, u.port)}` : u.kind === 'mul' ? `mul${Math.max(0, u.port)}` : `alu${Math.max(0, u.port)}`;
      if (st === 'E') active.add(key);
      const dim = d.unitDims.get(key)!;
      const n = slot.get(key) ?? 0;
      slot.set(key, n + 1);
      const rows = Math.max(1, Math.floor((dim.d - 0.03) / 0.06));
      const cols = Math.max(1, Math.floor((dim.w - 0.02) / 0.085));
      const col = Math.floor(n / rows) % cols, row = n % rows;
      const tgt = new THREE.Vector3(dim.x + 0.05 + col * 0.085, 0.035, dim.z + 0.04 + row * 0.06);
      if (st === 'E') tgt.set(dim.x + dim.w / 2, 0.035, dim.z + dim.d / 2);
      const t = d.tokens[k++];
      if (!t.visible) t.position.copy(tgt);
      t.visible = true;
      t.position.lerp(tgt, Math.min(1, dt * 14));
      t.setLive(st === 'E');
      t.setTone(st === 'W' || st === 'C' ? C.tone3 : C.paper);
    }
    for (; k < d.tokens.length; k++) d.tokens[k].visible = false;
    for (const [key, p] of d.unitParts) if (/^(alu|mul|ld)/.test(key)) p.setLive(active.has(key));
  }
}
