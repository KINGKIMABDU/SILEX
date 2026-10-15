import * as THREE from 'three';
import { tcs, onTheme } from '../core/theme';
import { C, Part, slab, v } from '../core/ink';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch, type Workload } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal, LOADS } from '../sim/thermal';
import { N } from './ids';
import { h, segmented, slider, section, Plot, facts } from '../core/ui';

/** block kinds map onto the workload utilisation keys */
type Kind = 'pcore' | 'ecore' | 'l2' | 'gpu' | 'npu' | 'slc' | 'mem' | 'media' | 'display' | 'isp' | 'sec' | 'io' | 'base';

interface Block {
  kind: Kind;
  x: number;
  z: number;
  w: number;
  d: number;
  /** watts at full utilisation */
  maxW: number;
}

const REF: Record<Kind, { n: number; name: string; text: (a: Arch) => string }> = {
  pcore: { n: 900, name: 'Performance cores', text: (a) => (a === 'arm' ? 'Twelve identical wide cores in three clusters of four, each cluster sharing 12 MB of L2. There are no small cores: idle clusters are switched off instead. Up to 4.2 GHz, eight instructions decoded per cycle.' : 'Eight wide out-of-order cores that run one thread as fast as possible: up to 5.4 GHz, eight instructions decoded per cycle, several watts each at full clock.') },
  ecore: { n: 902, name: 'Efficiency cores', text: () => 'Sixteen smaller cores in four clusters of four, each cluster sharing 4 MB of L2. Slower per thread, but a fraction of the energy and area for the same work, so they carry most of a heavy multithreaded job.' },
  l2: { n: 903, name: 'L2 caches', text: () => 'Shared caches next to each core cluster, a few nanoseconds away. Most of what a core needs is found here or in its own L1.' },
  gpu: { n: 904, name: 'Graphics processor', text: (a) => (a === 'arm' ? 'Six shader processors with 1,536 arithmetic lanes in all, each running the same instruction on many pixels or numbers at once: about 4.6 trillion operations a second.' : 'Four Xe graphics cores on their own tile: enough for the desktop and video, while the discrete GPU does the heavy work.') },
  npu: { n: 906, name: 'Neural engine (NPU)', text: () => 'A grid of multiply-accumulate units for matrix maths at low precision. For the same model it uses a fraction of the GPU\'s energy.' },
  slc: { n: 908, name: 'Last-level cache', text: (a) => (a === 'arm' ? 'A 6 MB system level cache shared by every block on the die.' : '36 MB of L3 shared by all the cores on the compute tile.') + ' A hit here saves a trip to DRAM, which costs roughly ten times the energy.' },
  mem: { n: 910, name: 'Memory controllers and PHY', text: (a) => `The physical interface to the ${a === 'arm' ? 'LPDDR5X packages beside the SoC' : 'DDR5 SO-DIMM modules'}: analogue drivers along the die edge, their timing trained at every boot.` },
  media: { n: 912, name: 'Media engines', text: () => 'Fixed-function video engines that decode H.264, HEVC and AV1 and encode video in hardware. A 4K export runs here at a few watts instead of keeping every CPU core busy.' },
  display: { n: 914, name: 'Display engine', text: () => 'Composites the final frame and streams it to the panel, refresh after refresh.' },
  isp: { n: 916, name: 'Image signal processor', text: () => 'Turns the camera sensor\'s raw data into a clean image: demosaicing, noise reduction, exposure.' },
  sec: { n: 918, name: 'Security processor', text: () => 'An isolated core with its own memory that holds encryption keys and checks every piece of boot code before it runs.' },
  io: { n: 920, name: 'I/O controllers', text: () => 'USB4 and Thunderbolt, PCIe and the SSD controller: the die\'s doors to the rest of the board.' },
  base: { n: 922, name: 'Interconnect and filler', text: () => 'Fabric, clocking, power gating and the spaces between blocks.' },
};

function floorplan(arch: Arch): { w: number; d: number; blocks: Block[]; tiles?: { name: string; x: number; z: number; w: number; d: number }[] } {
  const b: Block[] = [];
  const add = (kind: Kind, x: number, z: number, w: number, d: number, maxW: number) => b.push({ kind, x, z, w, d, maxW });
  if (arch === 'arm') {
    // 12.74 × 13.31 mm: three clusters of four cores, each with a 12 MB L2, then GPU, NPU and the rest
    const W = 12.74, D = 13.31;
    for (let c = 0; c < 3; c++) {
      const z0 = -D / 2 + 0.4 + c * 2.95;
      for (let i = 0; i < 4; i++) add('pcore', -W / 2 + 0.4 + i * 1.32, z0, 1.24, 1.55, 4.2);
      add('l2', -W / 2 + 0.4, z0 + 1.62, 5.2, 1.1, 0.7);
    }
    add('slc', -W / 2 + 0.4, -D / 2 + 9.3, 5.2, 1.0, 1.0);
    for (let i = 0; i < 6; i++) add('gpu', 0.2 + (i % 3) * 2.0, -D / 2 + 0.4 + Math.floor(i / 3) * 2.5, 1.9, 2.4, 2.4);
    add('npu', 0.2, -D / 2 + 5.5, 3.2, 2.4, 6);
    add('media', 3.6, -D / 2 + 5.5, 2.5, 1.6, 4);
    add('display', 3.6, -D / 2 + 7.2, 2.5, 1.0, 0.8);
    add('isp', 0.2, -D / 2 + 8.1, 1.6, 1.1, 1.2);
    add('sec', 1.9, -D / 2 + 8.1, 1.0, 1.1, 0.2);
    add('io', 3.0, -D / 2 + 8.4, 3.1, 1.6, 1.5);
    add('mem', -W / 2 + 0.4, D / 2 - 2.6, W - 0.8, 1.0, 2.4);
    add('mem', -W / 2 + 0.4, D / 2 - 1.45, W - 0.8, 1.0, 2.4);
    return { w: W, d: D, blocks: b };
  }
  // tiles on a ~300 mm² base die, as on the package (sheet 8)
  const K = 1.3;
  const tiles = [
    { name: 'Compute tile', x: -3 * K, z: -2.8 * K, w: 6.6 * K, d: 6.8 * K },
    { name: 'GPU tile', x: 3.5 * K, z: -2.8 * K, w: 5.4 * K, d: 6.8 * K },
    { name: 'SoC tile', x: -1.6 * K, z: 3.9 * K, w: 9.6 * K, d: 4.4 * K },
    { name: 'I/O tile', x: 5.2 * K, z: 3.9 * K, w: 2.4 * K, d: 4.4 * K },
  ];
  const [ct, gt, st, it] = tiles;
  const cx = ct.x - ct.w / 2 + 0.3, cz = ct.z - ct.d / 2 + 0.3;
  for (let i = 0; i < 8; i++) add('pcore', cx + (i % 4) * 2.03, cz + Math.floor(i / 4) * 1.6, 1.92, 1.48, 8);
  add('slc', cx, cz + 3.3, ct.w - 0.6, 0.8, 2.5);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 4; i++) add('ecore', cx + c * 2.03 + (i % 2) * 0.98, cz + 4.3 + Math.floor(i / 2) * 0.8, 0.92, 0.74, 1.1);
    add('l2', cx + c * 2.03, cz + 5.95, 1.9, 0.5, 0.3);
  }
  for (let i = 0; i < 4; i++) add('gpu', gt.x - gt.w / 2 + 0.3 + (i % 2) * 3.4, gt.z - gt.d / 2 + 0.3 + Math.floor(i / 2) * 3.4, 3.2, 3.2, 2.5);
  add('l2', gt.x - gt.w / 2 + 0.3, gt.z + gt.d / 2 - 1.5, gt.w - 0.6, 1.1, 0.5);
  add('npu', st.x - st.w / 2 + 0.3, st.z - st.d / 2 + 0.3, 3.4, 3.0, 5);
  add('media', st.x - st.w / 2 + 3.9, st.z - st.d / 2 + 0.3, 2.8, 1.9, 4);
  add('display', st.x - st.w / 2 + 7.0, st.z - st.d / 2 + 0.3, 2.0, 1.9, 1);
  add('isp', st.x - st.w / 2 + 3.9, st.z - st.d / 2 + 2.5, 1.8, 1.2, 1.2);
  add('sec', st.x - st.w / 2 + 6.0, st.z - st.d / 2 + 2.5, 1.0, 1.2, 0.2);
  add('mem', st.x - st.w / 2 + 0.3, st.z + st.d / 2 - 1.6, st.w - 0.6, 1.2, 3);
  add('io', it.x - it.w / 2 + 0.25, it.z - it.d / 2 + 0.3, it.w - 0.5, it.d - 0.6, 2.5);
  return { w: 13 * K, d: 13.3 * K, blocks: b, tiles };
}

const HEIGHT_PER_W = 0.9; // mm of block height per watt, exaggerated for reading

class Die {
  group = new THREE.Group();
  blocks: { b: Block; part: Part; util: number; watts: number }[] = [];
  parts: Partial<Record<Kind, Part[]>> = {};
  anchors: Partial<Record<Kind, THREE.Object3D>> = {};
  w: number;
  d: number;
  coreAnchor = new THREE.Object3D();
  dieParts: Part[] = [];

  constructor(public arch: Arch) {
    const F = floorplan(arch);
    this.w = F.w;
    this.d = F.d;
    const base = new Part(slab(F.w, 0.08, F.d, 0.05), { hull: true, threshold: 40, fill: C.tone2, width: 1.3 });
    base.position.y = -0.08;
    this.group.add(base);
    this.dieParts.push(base);
    for (const t of F.tiles ?? []) {
      const tp = new Part(slab(t.w, 0.04, t.d, 0.05), { width: 1.2, threshold: 40, fill: C.tone1 });
      tp.position.set(t.x, 0, t.z);
      this.group.add(tp);
      this.dieParts.push(tp);
    }
    for (const b of F.blocks) {
      // unit-height slab, scaled in y by power
      const p = new Part(slab(b.w - 0.08, 1, b.d - 0.08, 0.06), { width: 0.9, threshold: 40, hull: true, fill: b.kind === 'slc' || b.kind === 'l2' ? C.tone1 : C.paper });
      p.position.set(b.x + b.w / 2, F.tiles ? 0.04 : 0, b.z + b.d / 2);
      p.scale.y = 0.02;
      this.group.add(p);
      (this.parts[b.kind] ??= []).push(p);
      this.blocks.push({ b, part: p, util: 0, watts: 0 });
    }
    for (const k of Object.keys(this.parts) as Kind[]) {
      const first = this.parts[k]![0];
      const a = new THREE.Object3D();
      first.add(a);
      this.anchors[k] = a;
    }
    const pc = this.parts.pcore![0];
    this.coreAnchor.position.copy(pc.position);
    this.group.add(this.coreAnchor);
  }
}

// DVFS model for one core of each kind
interface CoreModel {
  fMin: number;
  fMax: number;
  vMin: number;
  vMax: number;
  k: number; // W per (V² · GHz)
  leak: number; // W at vMax
  ipc: number;
}

const CORES: Record<Arch, { p: CoreModel; e: CoreModel }> = {
  arm: { p: { fMin: 0.6, fMax: 4.2, vMin: 0.6, vMax: 1.05, k: 0.95, leak: 0.22, ipc: 1 }, e: { fMin: 0.6, fMax: 2.8, vMin: 0.55, vMax: 0.85, k: 0.26, leak: 0.03, ipc: 0.48 } },
  x86: { p: { fMin: 0.8, fMax: 5.4, vMin: 0.65, vMax: 1.25, k: 1.3, leak: 0.45, ipc: 0.95 }, e: { fMin: 0.8, fMax: 4.6, vMin: 0.6, vMax: 1.05, k: 0.4, leak: 0.08, ipc: 0.62 } },
};

function coreAt(m: CoreModel, f: number) {
  const t = Math.max(0, Math.min(1, (f - m.fMin) / (m.fMax - m.fMin)));
  const V = m.vMin + (m.vMax - m.vMin) * Math.pow(t, 1.5);
  const dyn = m.k * V * V * f;
  const leak = m.leak * Math.pow(V / m.vMax, 3);
  const P = dyn + leak;
  const perf = m.ipc * f; // billions of instructions per second, relative
  return { V, P, dyn, leak, perf };
}

export class DieSheet extends Sheet {
  readonly no = N.die;
  readonly title = 'The die';
  readonly short = 'die';
  readonly mmPerUnit = 1;
  readonly sub = 'Plan of the silicon; block height shows the power it draws';
  view: View = { height: 19, az: -20, el: 38, target: new THREE.Vector3(0, 0.6, 0.4), minZoom: 0.5, maxZoom: 30 };
  dies!: Record<Arch, Die>;
  coreKind: 'p' | 'e' = 'p';
  freq = 3.0;
  private dvfsBox!: HTMLElement;
  private plot!: Plot;
  private blockList!: HTMLElement;
  private lastList = 0;
  private fSlider!: ReturnType<typeof slider>;

  build() {
    this.dies = { arm: new Die('arm'), x86: new Die('x86') };
    for (const d of Object.values(this.dies)) this.root.add(d.group);
    this.applyArch();
    state.on('arch', () => this.applyArch());
    onTheme(() => this.paintDvfs());
  }

  private get d() {
    return this.dies[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    this.dies.arm.group.visible = a === 'arm';
    this.dies.x86.group.visible = a === 'x86';
    const d = this.d;
    d.coreAnchor.getWorldPosition(this.zoomTarget);
    this.view.height = a === 'arm' ? 19 : 24;
    const s = SPEC[a];
    const density = (s.transistorsB * 1e9) / s.dieMm2;
    const offs: Partial<Record<Kind, [number, number]>> = { pcore: [-60, -60], ecore: [10, -90], l2: [-90, 10], gpu: [-80, 60], npu: [80, -50], slc: [-90, 40], mem: [-110, 70], media: [120, -40], display: [130, -8], isp: [140, 14], sec: [150, 48], io: [110, 96] };
    const refs: Ref[] = [];
    for (const k of Object.keys(d.parts) as Kind[]) {
      if (k === 'base') continue;
      const parts = d.parts[k]!;
      const area = d.blocks.filter((x) => x.b.kind === k).reduce((acc, x) => acc + x.b.w * x.b.d, 0);
      const r = REF[k];
      refs.push({
        n: r.n,
        name: r.name,
        text: r.text(a),
        facts: [['Area', `${area.toFixed(1)} mm²`], ['Transistors, approx.', `${((area * density) / 1e9).toFixed(1)} billion`]],
        target: d.anchors[k]!,
        off: offs[k] ?? [60, -40],
        parts,
        see: k === 'pcore' ? N.core : undefined,
      });
    }
    refs.push({ n: 924, name: a === 'arm' ? 'Die' : 'Tiles on the base die', text: a === 'arm' ? `One monolithic piece of ${s.node} silicon, ${s.dieMm2} mm², an estimated ${s.transistorsB} billion transistors (the maker does not publish a count): about ${(density / 1e6).toFixed(0)} million per square millimetre.` : `Four tiles on a passive base die. Each tile is made on the process that suits it, and an estimated ${s.transistorsB} billion transistors are split between them.`, facts: [['Area', `${s.dieMm2} mm²`], ['Density', `${(density / 1e6).toFixed(0)} M / mm²`]], target: d.dieParts[0], at: v(-d.w / 2, 0, d.d / 2), off: [-40, 50], parts: d.dieParts });
    refs.sort((x, y) => Number(x.n) - Number(y.n));
    this.refs = refs;
    this.dims = [
      { a: v(-d.w / 2, -0.08, d.d / 2), b: v(d.w / 2, -0.08, d.d / 2), space: d.group, off: 26, text: () => `${d.w.toFixed(1)} mm` },
    ];
    const m = CORES[a][this.coreKind];
    this.freq = Math.min(this.freq, m.fMax);
    if (this.fSlider) {
      this.fSlider.input.min = String(m.fMin);
      this.fSlider.input.max = String(m.fMax);
      this.fSlider.set(this.freq);
    }
    this.paintDvfs();
    this.onRebuild();
  }

  panel() {
    const wl = segmented<Workload>({
      label: 'Workload, shared with sheet 3',
      options: (Object.keys(LOADS) as Workload[]).map((k) => ({ value: k, label: LOADS[k].label })),
      value: state.workload,
      wrap: true,
      onChange: (w) => {
        state.setWorkload(w);
        state.revise(this.no, `Workload on the die: ${LOADS[w].label}`);
      },
    });
    state.on('workload', () => wl.set(state.workload));
    this.blockList = h('div', { class: 'blocks' });
    const kind = segmented({
      label: 'Core',
      options: [
        { value: 'p', label: 'Performance core' },
        { value: 'e', label: 'Efficiency core' },
      ],
      value: this.coreKind,
      onChange: (k) => {
        this.coreKind = k;
        const m = CORES[state.arch][k];
        this.freq = Math.min(Math.max(this.freq, m.fMin), m.fMax);
        this.fSlider.input.min = String(m.fMin);
        this.fSlider.input.max = String(m.fMax);
        this.fSlider.set(this.freq);
        this.paintDvfs();
      },
    });
    const m = CORES[state.arch][this.coreKind];
    this.fSlider = slider({ label: 'Clock', min: m.fMin, max: m.fMax, step: 0.05, value: this.freq, format: (f) => `${f.toFixed(2)} GHz`, onInput: (f) => {
      this.freq = f;
      this.paintDvfs();
    } });
    this.plot = new Plot({ x: [0, 1], y: [0, 5], xLabel: 'power per core, W (log)', yLabel: 'performance', xTicks: [], yTicks: [0, 1, 2, 3, 4, 5], caption: 'Black: performance core. Grey dashed: efficiency core. Same work, less energy wherever the grey line is higher at the same power.' });
    this.dvfsBox = h('div');
    this.paintDvfs();
    return h(
      'div',
      null,
      section(null, wl.el, this.blockList),
      section('Why chips mix kinds of core', h('p', { class: 'note' }, 'Power grows with voltage squared times clock, and higher clocks need higher voltage, so the last gigahertz costs far more than the first. The x86 chip adds small cores for background work; the ARM chip uses one kind of core and switches whole clusters off instead. Compare the two curves.'), kind.el, this.fSlider.el, this.plot.el, this.dvfsBox),
    );
  }

  private paintDvfs() {
    if (!this.dvfsBox) return;
    const a = state.arch;
    const M = CORES[a];
    const lx = (p: number) => (Math.log10(p) + 1.5) / (Math.log10(12) + 1.5); // 0.03 W .. 12 W
    const curve = (m: CoreModel) => {
      const pts: [number, number][] = [];
      for (let f = m.fMin; f <= m.fMax + 1e-6; f += (m.fMax - m.fMin) / 40) {
        const c = coreAt(m, f);
        pts.push([lx(c.P), c.perf]);
      }
      return pts;
    };
    const m = M[this.coreKind];
    const c = coreAt(m, this.freq);
    this.plot.o.xTicks = [0.05, 0.1, 0.5, 1, 5, 10].map(lx);
    this.plot.o.fmtX = (x) => {
      const p = Math.pow(10, x * (Math.log10(12) + 1.5) - 1.5);
      return p < 1 ? p.toFixed(p < 0.1 ? 2 : 1) : p.toFixed(0);
    };
    this.plot.series = [
      { color: tcs('#1d1f22'), width: 1.75, points: curve(M.p) },
      { color: tcs('#8b8e88'), width: 1.75, dash: [5, 3], points: curve(M.e) },
    ];
    this.plot.marker = [lx(c.P), c.perf];
    this.plot.markerLive = false;
    this.plot.draw();
    // the same performance on the other kind of core, if it can reach it
    const other = this.coreKind === 'p' ? M.e : M.p;
    let cmp = '';
    const fNeed = c.perf / other.ipc;
    if (fNeed >= other.fMin && fNeed <= other.fMax) {
      const o = coreAt(other, fNeed);
      const ratio = o.P / c.P;
      cmp = `The ${this.coreKind === 'p' ? 'efficiency' : 'performance'} core matches this speed at ${fNeed.toFixed(2)} GHz for ${o.P.toFixed(2)} W, ${ratio > 1 ? `${ratio.toFixed(1)} × more` : `${(1 / ratio).toFixed(1)} × less`} energy for the same work.`;
    } else if (fNeed > other.fMax) {
      cmp = `The efficiency core cannot reach this speed at all; its ceiling is ${(other.ipc * other.fMax).toFixed(2)} on this scale.`;
    } else cmp = `The ${this.coreKind === 'p' ? 'efficiency' : 'performance'} core would have to run below its lowest clock to match this, so it would finish early and idle.`;
    this.dvfsBox.replaceChildren(
      facts([
        ['Supply voltage', `${c.V.toFixed(3)} V`],
        ['Switching power, k·V²·f', `${c.dyn.toFixed(2)} W`],
        ['Leakage', `${c.leak.toFixed(3)} W`],
        ['Performance', `${c.perf.toFixed(2)} (relative)`],
        ['Work per joule', `${(c.perf / c.P).toFixed(2)}`],
      ]),
      h('p', { class: 'note' }, cmp),
    );
  }

  update(dt: number) {
    const d = this.d;
    const load = LOADS[state.workload].blocks;
    // scale every block's draw so the die total matches the package power from the thermal model
    let want = 0;
    for (const x of d.blocks) {
      const u = (load as Record<string, number | undefined>)[x.b.kind === 'l2' ? 'slc' : x.b.kind] ?? 0.02;
      x.util += (u - x.util) * Math.min(1, dt * 3);
      want += x.util * x.b.maxW;
    }
    const k = want > 0 ? thermal.power / want : 0;
    for (const x of d.blocks) {
      x.watts = x.util * x.b.maxW * k;
      const hgt = 0.02 + (x.watts / (x.b.w * x.b.d)) * HEIGHT_PER_W * 4;
      x.part.scale.y += (Math.min(3.2, hgt) - x.part.scale.y) * Math.min(1, dt * 5);
      x.part.setLive(x.watts / (x.b.w * x.b.d) > 0.3);
    }
    const now = performance.now();
    if (this.blockList && now - this.lastList > 400) {
      this.lastList = now;
      const agg = new Map<Kind, number>();
      for (const x of d.blocks) agg.set(x.b.kind, (agg.get(x.b.kind) ?? 0) + x.watts);
      const rows = [...agg.entries()].filter(([kk]) => kk !== 'base').sort((p, q) => q[1] - p[1]).slice(0, 6);
      const max = Math.max(0.01, ...rows.map((r) => r[1]));
      this.blockList.replaceChildren(
        h('div', { class: 'ro-label', style: { marginBottom: '4px' } }, `Where the ${thermal.power.toFixed(1)} W goes`),
        ...rows.map(([kk, w]) =>
          h('div', { class: 'blk' }, h('span', { class: 'blk-n' }, REF[kk].name), h('span', { class: 'blk-bar' }, h('i', { style: { width: `${(w / max) * 100}%` } })), h('span', { class: 'blk-w tnum' }, `${w.toFixed(2)} W`)),
        ),
      );
    }
  }
}
