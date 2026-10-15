import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { C, M, Part, slab, cyl, v, polyline, segments, ink, lineMat, basicMat } from '../core/ink';
import { N } from './ids';

import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal, THERMAL, LOADS } from '../sim/thermal';
import { h, segmented, section, fmtDuration, fmtSI } from '../core/ui';

let idle: ReturnType<typeof lineMat> | null = null;
/** idle traces are dashed; a trace carrying data is drawn solid red */
const IDLE = () => (idle ??= lineMat({ width: 0.7, color: C.grey, dashed: true, dash: 1.2, gap: 0.9 }));

interface Comp {
  id: string;
  n: number;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  hgt: number;
  tone?: number;
  text: string;
  facts?: [string, string][];
  see?: number;
}

interface Link {
  id: string;
  a: string;
  b: string;
  name: string;
  /** bytes per second */
  bw: number;
  /** seconds */
  lat: number;
  lanes: number;
}

interface Hop {
  link: string;
  bytes: number;
  what: string;
}

interface Op {
  id: string;
  label: string;
  hops: Hop[];
  /** the same job where the machine has a discrete GPU */
  gpuHops?: Hop[];
  after?: (total: number, arch: Arch) => string;
}

const GB = 1e9;

function layout(arch: Arch): { bw: number; bd: number; comps: Comp[]; links: Link[] } {
  const s = SPEC[arch];
  if (arch === 'arm') {
    return {
      bw: 214,
      bd: 74,
      comps: [
        { id: 'soc', n: 500, name: 'SoC', x: -40, z: 2, w: 25, d: 25, hgt: 1.3, tone: M.substrate, text: `${s.soc}: twelve CPU cores, the GPU, a neural processor, media engines and the SSD and display controllers on one die. The memory is not inside: it sits in two packages right beside it.`, facts: [['Transistors', `≈ ${s.transistorsB} billion`], ['Die', `${s.dieMm2} mm²`]], see: N.package },
        { id: 'dram0', n: 501, name: 'LPDDR5X memory', x: -40, z: -26, w: 12.4, d: 15, hgt: 1.0, tone: M.mold, text: `${s.memory}. Two packages, each a stack of DRAM dies on a 64-bit channel pair, 8,448 million transfers a second on every pin.`, facts: [['Bandwidth', `${s.memBW} GB/s`], ['Latency', `≈ ${s.memLatencyNs} ns`]], see: N.memory },
        { id: 'dram1', n: 501, name: 'LPDDR5X memory', x: -40, z: 30, w: 12.4, d: 15, hgt: 1.0, tone: M.mold, text: '' },
        { id: 'ssd', n: 502, name: 'M.2 SSD', x: 48, z: 8, w: 80, d: 22, hgt: 2.2, tone: M.pcbDark, text: `${s.ssd}: a controller with its own DRAM cache and flash packages on a 22 × 80 mm card.`, facts: [['Sequential read', `≈ ${s.ssdGBs} GB/s`], ['Random read latency', `≈ ${s.ssdLatencyUs} µs`]], see: N.storage },
        { id: 'pmic', n: 504, name: 'Power management ICs', x: -78, z: 22, w: 9, d: 9, hgt: 1.0, tone: M.mold, text: 'Several PMICs and their power stages turn the 15.5 V battery into the SoC\'s rails, the cores down near 0.6 V at tens of amps.', facts: [['Input', `${s.packV} V or 20 V`], ['Core rail', '0.6 – 1.0 V']] },
        { id: 'ind', n: 505, name: 'Inductors', x: -78, z: -4, w: 16, d: 7, hgt: 1.6, tone: M.ferrite, text: 'Each buck phase stores energy in an inductor and releases it at a lower voltage.' },
        { id: 'wifi', n: 506, name: 'Wi-Fi 7 and Bluetooth', x: 6, z: -22, w: 12, d: 12, hgt: 1.3, tone: M.tin, text: 'The radio under its shield, with coaxial leads to antennas in the hinge.', facts: [['Wi-Fi 7, 2 × 2', 'up to 5.8 Gbit/s']] },
        { id: 'rt0', n: 508, name: 'USB4 retimers', x: -96, z: -26, w: 6, d: 6, hgt: 0.9, tone: M.mold, text: 'Re-drive the 40 Gbit/s signals to the two USB-C ports on the left.' },
        { id: 'rt1', n: 508, name: 'USB4 retimers', x: -96, z: -14, w: 6, d: 6, hgt: 0.9, tone: M.mold, text: '' },
        { id: 'ec', n: 510, name: 'Embedded controller', x: 6, z: 24, w: 7, d: 7, hgt: 0.9, tone: M.mold, text: 'Always on: scans the keyboard, reads the lid sensor and battery, runs the fan.' },
        { id: 'codec', n: 512, name: 'Audio codec and amplifiers', x: 92, z: -24, w: 6, d: 6, hgt: 0.8, tone: M.mold, text: 'Converts the audio stream for four speakers and the headphone jack.' },
        { id: 'xtal', n: 514, name: 'Crystal oscillator', x: -18, z: 26, w: 3.2, d: 2.5, hgt: 0.8, tone: M.tin, text: 'A quartz reference every clock on the board is multiplied up from.' },
      ],
      links: [
        { id: 'nand', a: 'ssd', b: 'soc', name: 'PCIe 4.0 ×4', bw: s.ssdGBs * GB, lat: s.ssdLatencyUs * 1e-6, lanes: 4 },
        { id: 'mem', a: 'dram0', b: 'soc', name: 'LPDDR5X, 128-bit', bw: s.memBW * GB, lat: s.memLatencyNs * 1e-9, lanes: 4 },
        { id: 'wifi', a: 'wifi', b: 'soc', name: 'PCIe ×1', bw: 0.6 * GB, lat: 2e-3, lanes: 2 },
        { id: 'ec', a: 'ec', b: 'soc', name: 'eSPI bus', bw: 8e6, lat: 1e-3, lanes: 1 },
        { id: 'pwr', a: 'pmic', b: 'soc', name: 'power rails', bw: 1, lat: 0, lanes: 3 },
        { id: 'usb', a: 'rt0', b: 'soc', name: 'USB4, 40 Gbit/s', bw: 4 * GB, lat: 1e-6, lanes: 2 },
        { id: 'aud', a: 'codec', b: 'soc', name: 'SoundWire', bw: 2e6, lat: 1e-4, lanes: 1 },
      ],
    };
  }
  return {
    bw: 300,
    bd: 112,
    comps: [
      { id: 'soc', n: 500, name: 'CPU package', x: -54, z: -12, w: 37.5, d: 45, hgt: 1.6, tone: M.substrate, text: `${s.soc}: ${s.cores}, an integrated GPU and NPU, and the memory and PCIe controllers.`, facts: [['Transistors', `≈ ${s.transistorsB} billion`], ['Power', 'up to 165 W']], see: N.package },
      { id: 'gpu', n: 503, name: 'Discrete GPU', x: 42, z: -14, w: 42, d: 42, hgt: 1.6, tone: M.substrate, text: `${s.gpu}. It talks to the CPU over 16 lanes of PCIe and keeps its working data in its own memory around it.`, facts: [['Board power', 'up to 175 W'], ['Link to CPU', 'PCIe 5.0 ×16, 64 GB/s']] },
      { id: 'gddr0', n: 507, name: 'GDDR7 memory', x: 10, z: -26, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: 'Eight GDDR7 chips, each on its own 32-bit channel at 28 Gbit/s per pin: 896 GB/s in all, nearly ten times the main memory.', facts: [['Bandwidth', '896 GB/s'], ['Capacity', '24 GB']] },
      { id: 'gddr1', n: 507, name: 'GDDR7', x: 10, z: -2, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr2', n: 507, name: 'GDDR7', x: 74, z: -26, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr3', n: 507, name: 'GDDR7', x: 74, z: -2, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr4', n: 507, name: 'GDDR7', x: 30, z: 18, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr5', n: 507, name: 'GDDR7', x: 54, z: 18, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr6', n: 507, name: 'GDDR7', x: 30, z: -46, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'gddr7', n: 507, name: 'GDDR7', x: 54, z: -46, w: 12, d: 14, hgt: 1.2, tone: M.mold, text: '' },
      { id: 'dram0', n: 501, name: 'SO-DIMM modules', x: -112, z: 34, w: 69.6, d: 30, hgt: 3.8, tone: M.pcb, text: `${s.memory}. Two removable modules on a 64-bit channel each; you can swap them for larger ones.`, facts: [['Bandwidth', `${s.memBW} GB/s`], ['Latency', `≈ ${s.memLatencyNs} ns`]], see: N.memory },
      { id: 'ssd', n: 502, name: 'M.2 SSD slots', x: -14, z: 40, w: 80, d: 22, hgt: 2.2, tone: M.pcbDark, text: `${s.ssd}. Each card is a controller with flash packages, on four PCIe lanes from the CPU.`, facts: [['Sequential read', `≈ ${s.ssdGBs} GB/s`], ['Random read latency', `≈ ${s.ssdLatencyUs} µs`]], see: N.storage },
      { id: 'ssd2', n: 502, name: 'M.2 SSD', x: 76, z: 40, w: 80, d: 22, hgt: 2.2, tone: M.pcbDark, text: '' },
      { id: 'vrm', n: 504, name: 'Voltage regulators', x: -54, z: 20, w: 40, d: 7, hgt: 2.2, tone: M.ferrite, text: 'Multiphase buck regulators for the CPU and the GPU: each phase is an inductor and a pair of power MOSFETs, and together they deliver over 300 A at about one volt.', facts: [['Input', '20 V from the charger'], ['Output', 'about 1 V, over 300 A']] },
      { id: 'wifi', n: 506, name: 'Wi-Fi 7 module', x: 130, z: 6, w: 22, d: 30, hgt: 1.6, tone: M.tin, text: 'A Wi-Fi 7 and Bluetooth 5.4 radio soldered to the board under a metal shield, 2 × 2 at up to 5.8 Gbit/s.' },
      { id: 'rt0', n: 508, name: 'Thunderbolt 5 controller', x: -126, z: -22, w: 10, d: 10, hgt: 1.0, tone: M.mold, text: 'A separate Thunderbolt 5 controller for the two USB-C ports on the left: 80 Gbit/s each way, or up to 120 Gbit/s in one direction for displays.' },
      { id: 'ec', n: 510, name: 'Embedded controller', x: 114, z: -34, w: 8, d: 8, hgt: 0.9, tone: M.mold, text: 'Runs the three-fan curve, the lighting and the power sequence at boot.' },
      { id: 'codec', n: 512, name: 'Audio codec', x: -130, z: -6, w: 6, d: 6, hgt: 0.8, tone: M.mold, text: 'Smart amplifiers for four speakers.' },
      { id: 'xtal', n: 514, name: 'Crystal oscillator', x: -24, z: -40, w: 3.2, d: 2.5, hgt: 0.8, tone: M.tin, text: 'The quartz reference for every clock.' },
    ],
    links: [
      { id: 'nand', a: 'ssd', b: 'soc', name: 'PCIe 4.0 ×4', bw: s.ssdGBs * GB, lat: s.ssdLatencyUs * 1e-6, lanes: 4 },
      { id: 'mem', a: 'dram0', b: 'soc', name: 'DDR5-5600, 2 × 64-bit', bw: s.memBW * GB, lat: s.memLatencyNs * 1e-9, lanes: 4 },
      { id: 'pcie', a: 'gpu', b: 'soc', name: 'PCIe 5.0 ×16', bw: 64 * GB, lat: 1e-6, lanes: 6 },
      { id: 'vram', a: 'gddr0', b: 'gpu', name: 'GDDR7, 256-bit', bw: 896 * GB, lat: 250e-9, lanes: 2 },
      { id: 'wifi', a: 'wifi', b: 'soc', name: 'PCIe ×1', bw: 0.6 * GB, lat: 2e-3, lanes: 2 },
      { id: 'ec', a: 'ec', b: 'soc', name: 'eSPI bus', bw: 8e6, lat: 1e-3, lanes: 1 },
      { id: 'pwr', a: 'vrm', b: 'soc', name: 'power rails', bw: 1, lat: 0, lanes: 3 },
      { id: 'usb', a: 'rt0', b: 'soc', name: 'Thunderbolt 5', bw: 15 * GB, lat: 1e-6, lanes: 2 },
      { id: 'aud', a: 'codec', b: 'soc', name: 'SoundWire', bw: 2e6, lat: 1e-4, lanes: 1 },
    ],
  };
}

const OPS: Op[] = [
  { id: 'key', label: 'Keypress', hops: [{ link: 'ec', bytes: 8, what: 'HID report from the controller' }, { link: 'mem', bytes: 64, what: 'event written to memory' }] },
  { id: 'open', label: 'Open a 2 GB video', hops: [{ link: 'nand', bytes: 2 * GB, what: 'file read from flash' }, { link: 'mem', bytes: 2 * GB, what: 'written into memory' }] },
  {
    id: 'ai',
    label: 'Run a 7B language model',
    hops: [{ link: 'nand', bytes: 4 * GB, what: '4 GB of weights loaded' }, { link: 'mem', bytes: 4 * GB, what: 'all weights read once per token' }],
    gpuHops: [{ link: 'nand', bytes: 4 * GB, what: '4 GB of weights loaded' }, { link: 'pcie', bytes: 4 * GB, what: 'copied to the GPU' }, { link: 'vram', bytes: 4 * GB, what: 'all weights read once per token, from GDDR7' }],
    after: (_t, a) => (a === 'arm' ? `Every word needs every weight once, so memory bandwidth sets the speed: ${SPEC.arm.memBW} GB/s ÷ 4 GB ≈ ${(SPEC.arm.memBW / 4).toFixed(0)} tokens per second at best.` : 'On the GPU the weights live in GDDR7: 896 GB/s ÷ 4 GB ≈ 220 tokens per second at best, about 120 in practice. On the CPU\'s DDR5 it would be about 22.'),
  },
  { id: 'tex', label: 'Load a game level', hops: [{ link: 'nand', bytes: 3 * GB, what: '3 GB of textures and meshes from flash' }, { link: 'mem', bytes: 3 * GB, what: 'unpacked into memory' }], gpuHops: [{ link: 'nand', bytes: 3 * GB, what: '3 GB of textures and meshes from flash' }, { link: 'mem', bytes: 3 * GB, what: 'staged in main memory' }, { link: 'pcie', bytes: 3 * GB, what: 'sent to the GPU' }, { link: 'vram', bytes: 3 * GB, what: 'written into GDDR7' }] },
  { id: 'call', label: 'One frame of a video call', hops: [{ link: 'wifi', bytes: 6000, what: 'compressed frame from the router' }, { link: 'mem', bytes: 3.1e6, what: 'decoded 1080p frame to memory' }] },
  { id: 'audio', label: 'Play a sound', hops: [{ link: 'mem', bytes: 1920, what: '10 ms of 48 kHz stereo audio' }, { link: 'aud', bytes: 1920, what: 'streamed to the codec' }] },
];

/** Screw bosses, board space (mm). */
const HOLES: Record<Arch, [number, number][]> = {
  arm: [[-103, -33], [103, -33], [-103, 33], [103, 33], [-14, 30], [8, -32]],
  x86: [[-146, 52], [146, 52], [-110, -52], [110, -52], [-8, -48], [-8, 24], [96, 24]],
};

interface Conn {
  x: number;
  z: number;
  w: number;
  d: number;
  hgt: number;
  tone: number;
  pins?: number;
}

/** Board-to-wire and board-to-board connectors: battery, display, keyboard and trackpad flex, fans. */
const CONNECTORS: Record<Arch, Conn[]> = {
  arm: [
    { x: -60, z: 33, w: 14, d: 4.6, hgt: 1.6, tone: M.white, pins: 10 }, // battery
    { x: 30, z: -33, w: 16, d: 3.2, hgt: 1.0, tone: 0x2f3236, pins: 30 }, // eDP display
    { x: 82, z: 30, w: 12, d: 3.0, hgt: 0.9, tone: M.white, pins: 24 }, // keyboard flex
    { x: 64, z: 30, w: 8, d: 3.0, hgt: 0.9, tone: M.white, pins: 12 }, // trackpad flex
    { x: -102, z: 0, w: 3, d: 6, hgt: 1.2, tone: M.white, pins: 4 }, // fan
  ],
  x86: [
    { x: -40, z: 52, w: 22, d: 5.4, hgt: 2.0, tone: M.white, pins: 12 }, // battery
    { x: 92, z: -48, w: 20, d: 3.4, hgt: 1.1, tone: 0x2f3236, pins: 40 }, // eDP display
    { x: 134, z: 40, w: 14, d: 3.2, hgt: 1.0, tone: M.white, pins: 30 }, // keyboard flex
    { x: 0, z: -50, w: 10, d: 3.2, hgt: 1.0, tone: M.white, pins: 16 }, // light bar and lid matrix
    { x: -144, z: 20, w: 3, d: 6, hgt: 1.3, tone: M.white, pins: 4 }, // fan, left
    { x: 144, z: -20, w: 3, d: 6, hgt: 1.3, tone: M.white, pins: 4 }, // fan, right
    { x: 0, z: 34, w: 3, d: 6, hgt: 1.3, tone: M.white, pins: 4 }, // fan, auxiliary
  ],
};

/** The board's outline: the gaming board is cut away at the rear corners for the two main fans. */
function outline(arch: Arch, bw: number, bd: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const r = 3;
  const x0 = -bw / 2, x1 = bw / 2, z0 = -bd / 2, z1 = bd / 2;
  if (arch === 'x86') {
    const R = FAN_R;
    s.moveTo(x0 + R, z0);
    s.lineTo(x1 - R, z0);
    s.absarc(x1, z0, R, Math.PI, Math.PI / 2, true);
    s.lineTo(x1, z1 - r);
    s.quadraticCurveTo(x1, z1, x1 - r, z1);
    s.lineTo(x0 + r, z1);
    s.quadraticCurveTo(x0, z1, x0, z1 - r);
    s.lineTo(x0, z0 + R);
    s.absarc(x0, z0, R, Math.PI / 2, 0, true);
  } else {
    s.moveTo(x0 + r, z0);
    s.lineTo(x1 - r, z0);
    s.quadraticCurveTo(x1, z0, x1, z0 + r);
    s.lineTo(x1, z1 - r);
    s.quadraticCurveTo(x1, z1, x1 - r, z1);
    s.lineTo(x0 + r, z1);
    s.quadraticCurveTo(x0, z1, x0, z1 - r);
    s.lineTo(x0, z0 + r);
    s.quadraticCurveTo(x0, z0, x0 + r, z0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: false, curveSegments: 16 });
  // shape y is board z: lay it flat with the top face up at y = 1
  g.rotateX(Math.PI / 2);
  g.translate(0, 1.0, 0);
  return g;
}

const FAN_R = 34;

/** is (x, z) on the board, at least `m` mm from its edge */
function inside(arch: Arch, bw: number, bd: number, x: number, z: number, m: number): boolean {
  if (Math.abs(x) > bw / 2 - m || Math.abs(z) > bd / 2 - m) return false;
  if (arch === 'x86' && Math.hypot(Math.abs(x) - bw / 2, z + bd / 2) < FAN_R + m) return false;
  return true;
}

class Board {
  group = new THREE.Group();
  comps = new Map<string, { c: Comp; part: Part; anchor: THREE.Object3D }>();
  links = new Map<string, { l: Link; base: THREE.Object3D[]; live: (THREE.Object3D & { material: LineMaterial })[] }>();
  bw: number;
  bd: number;
  socAnchor = new THREE.Object3D();
  capsAnchor = new THREE.Object3D();
  capParts: Part[] = [];
  boardPart: Part;
  extras?: Part[];
  /** how many small passives were placed, for the part card */
  passives = 0;

  constructor(public arch: Arch) {
    const L = layout(arch);
    this.bw = L.bw;
    this.bd = L.bd;
    this.boardPart = new Part(outline(arch, L.bw, L.bd), { hull: true, threshold: 40, fill: C.tone1 });
    this.boardPart.position.y = -1;
    this.group.add(this.boardPart);
    // screw bosses: the board is held at the corners and beside the heaviest parts, under the heatsink
    for (const [hx, hz] of HOLES[arch]) {
      const hole = new Part(cyl(1.6, 1.1, 20), { width: 0.8, threshold: 40, fill: C.paper });
      hole.position.set(hx, -0.5, hz);
      this.group.add(hole);
      const ring = new Part(new THREE.RingGeometry(1.6, 2.9, 24).rotateX(-Math.PI / 2), { width: 0.5, threshold: 1, fill: M.gold, edges: false });
      ring.position.set(hx, 0.01, hz);
      this.group.add(ring);
    }
    for (const c of L.comps) {
      const p = new Part(slab(c.w, c.hgt, c.d, Math.min(1, c.w / 8)), { width: c.id === 'soc' ? 1.3 : 1, threshold: 40, fill: c.tone ?? C.tone2, hull: c.hgt > 1.5 });
      p.position.set(c.x, 0, c.z);
      this.group.add(p);
      const a = new THREE.Object3D();
      a.position.set(c.x + c.w * 0.25, c.hgt, c.z - c.d * 0.25);
      this.group.add(a);
      this.comps.set(c.id, { c, part: p, anchor: a });
      if (c.id === 'soc' || c.id === 'gpu') {
        if (c.id === 'soc') {
          this.socAnchor.position.set(c.x, c.hgt, c.z);
          this.group.add(this.socAnchor);
        }
        const dw = c.id === 'gpu' ? 19 : arch === 'arm' ? 12.9 : 13, dd = c.id === 'gpu' ? 19 : arch === 'arm' ? 13.2 : 16;
        const die = new Part(slab(dw, 0.5, dd, 0.3), { width: 1, threshold: 40, fill: M.die });
        die.position.set(c.x, c.hgt, c.z);
        this.group.add(die);
      }
      if (c.id === 'ind' || c.id === 'vrm') {
        const n = c.id === 'vrm' ? 6 : 3;
        for (let i = 0; i < n; i++) {
          const ip = new Part(slab((c.w - 2) / n - 1, 1.2, c.d - 1.5, 0.6), { width: 0.8, threshold: 40, fill: M.ferrite });
          ip.position.set(c.x - c.w / 2 + 1 + (i + 0.5) * ((c.w - 2) / n), c.hgt, c.z);
          this.group.add(ip);
        }
      }
      if (c.id === 'ssd' || c.id === 'ssd2') {
        const ctl = new Part(slab(12, 0.9, 12, 0.5), { width: 0.9, threshold: 40, fill: M.mold });
        ctl.position.set(c.x - 26, c.hgt, c.z);
        this.group.add(ctl);
        for (let i = 0; i < 2; i++) {
          const n = new Part(slab(14, 0.9, 16, 0.5), { width: 0.9, threshold: 40, fill: M.mold });
          n.position.set(c.x - 4 + i * 18, c.hgt, c.z);
          this.group.add(n);
        }
        const gold = new Part(slab(2.5, 0.1, 18, 0.2), { width: 0.6, threshold: 40, fill: M.gold });
        gold.position.set(c.x - c.w / 2 + 1.5, c.hgt, c.z);
        this.group.add(gold);
      }
      if (c.id === 'dram0' && arch === 'x86') {
        for (let k = 0; k < 4; k++) {
          const chip = new Part(slab(11, 1.0, 13, 0.5), { width: 0.8, threshold: 40, fill: M.mold });
          chip.position.set(c.x - 24 + k * 16, c.hgt, c.z - 3);
          this.group.add(chip);
        }
        const gold = new Part(slab(62, 0.1, 2.5, 0.2), { width: 0.6, threshold: 40, fill: M.gold });
        gold.position.set(c.x, c.hgt, c.z + 13.5);
        this.group.add(gold);
      }
    }
    // decoupling capacitors in a ring around the processor
    const soc = L.comps.find((c) => c.id === 'soc')!;
    for (let i = 0; i < 28; i++) {
      const side = i % 4;
      const k = Math.floor(i / 4) / 6 - 0.5;
      const cx = side < 2 ? soc.x + k * soc.w : soc.x + (side === 2 ? -1 : 1) * (soc.w / 2 + 2);
      const cz = side < 2 ? soc.z + (side === 0 ? -1 : 1) * (soc.d / 2 + 2) : soc.z + k * soc.d;
      const cap = new Part(slab(side < 2 ? 1 : 0.5, 0.5, side < 2 ? 0.5 : 1, 0.1), { width: 0.6, threshold: 40, fill: C.tone3 });
      cap.position.set(cx, 0, cz);
      this.group.add(cap);
      this.capParts.push(cap);
    }
    this.capsAnchor.position.set(soc.x + soc.w / 2 + 2, 0.5, soc.z + soc.d * 0.3);
    this.group.add(this.capsAnchor);

    // connectors along the edges: what the board plugs into
    for (const k of CONNECTORS[arch]) {
      const body = new Part(slab(k.w, k.hgt, k.d, 0.4), { width: 0.8, threshold: 40, fill: k.tone });
      body.position.set(k.x, 0, k.z);
      this.group.add(body);
      if (k.pins) {
        const pins: THREE.Vector3[] = [];
        const along = k.w > k.d;
        for (let i = 0; i < k.pins; i++) {
          const t = (i + 0.5) / k.pins - 0.5;
          const px = along ? k.x + t * (k.w - 1) : k.x, pz = along ? k.z : k.z + t * (k.d - 1);
          pins.push(v(px - (along ? 0 : k.w * 0.3), k.hgt + 0.01, pz - (along ? k.d * 0.3 : 0)), v(px + (along ? 0 : k.w * 0.3), k.hgt + 0.01, pz + (along ? k.d * 0.3 : 0)));
        }
        this.group.add(segments(pins, ink(0.4, C.ink2)));
      }
      (this.extras ??= []).push(body);
    }

    // passives: 0402 capacitors and resistors packed wherever the power-hungry chips leave room
    const keepOut = [...L.comps.map((c) => ({ x: c.x, z: c.z, hw: c.w / 2 + 1.4, hd: c.d / 2 + 1.4 })), ...CONNECTORS[arch].map((k) => ({ x: k.x, z: k.z, hw: k.w / 2 + 1.2, hd: k.d / 2 + 1.2 })), ...HOLES[arch].map(([x, z]) => ({ x, z, hw: 4, hd: 4 }))];
    const hot = L.comps.filter((c) => ['soc', 'gpu', 'vrm', 'pmic', 'ind'].includes(c.id));
    const caps: THREE.Matrix4[] = [], res: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    let seed = arch === 'arm' ? 7 : 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -L.bw / 2 + 4; x < L.bw / 2 - 4; x += 1.6)
      for (let z = -L.bd / 2 + 4; z < L.bd / 2 - 4; z += 1.25) {
        if (!inside(arch, L.bw, L.bd, x, z, 3)) continue;
        if (keepOut.some((k) => Math.abs(x - k.x) < k.hw && Math.abs(z - k.z) < k.hd)) continue;
        // density falls off with distance from the nearest power-hungry part
        const d = Math.min(...hot.map((c) => Math.max(0, Math.abs(x - c.x) - c.w / 2) + Math.max(0, Math.abs(z - c.z) - c.d / 2)));
        const pr = d < 6 ? 0.85 : d < 14 ? 0.45 : 0.08;
        if (rnd() > pr) continue;
        m4.makeTranslation(x, 0.25, z);
        (rnd() < 0.72 ? caps : res).push(m4.clone());
      }
    const inst = (list: THREE.Matrix4[], fill: number) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.5, 0.5), basicMat(fill), list.length);
      list.forEach((q, i) => im.setMatrixAt(i, q));
      this.group.add(im);
    };
    inst(caps, M.ceramic);
    inst(res, 0x2f3236);
    this.passives = caps.length + res.length;

    // traces
    for (const l of L.links) {
      const A = this.comps.get(l.a)!.c, B = this.comps.get(l.b)!.c;
      const base: THREE.Object3D[] = [];
      const live: (THREE.Object3D & { material: LineMaterial })[] = [];
      for (let k = 0; k < l.lanes; k++) {
        const off = (k - (l.lanes - 1) / 2) * 0.9;
        let pts: THREE.Vector3[];
        if (l.a === l.b) {
          // on-package memory: die to the memory packages
          pts = [v(A.x - 3.5 + 5.3, A.hgt + 0.55, A.z), v(A.x + 3, A.hgt + 0.55, A.z)];
        } else {
          const ax = A.x + Math.sign(B.x - A.x) * (A.w / 2) * (Math.abs(B.x - A.x) > Math.abs(B.z - A.z) ? 1 : 0);
          const az = A.z + Math.sign(B.z - A.z) * (A.d / 2) * (Math.abs(B.x - A.x) > Math.abs(B.z - A.z) ? 0 : 1);
          const bx = B.x - Math.sign(B.x - A.x) * (B.w / 2) * 0.9;
          const bz = B.z + off;
          pts = [v(ax + (Math.abs(B.x - A.x) > Math.abs(B.z - A.z) ? 0 : off), 0.05, az + (Math.abs(B.x - A.x) > Math.abs(B.z - A.z) ? off : 0)), v((ax + bx) / 2 + off, 0.05, az + (Math.abs(B.x - A.x) > Math.abs(B.z - A.z) ? off : 0)), v((ax + bx) / 2 + off, 0.05, bz), v(bx, 0.05, bz)];
        }
        const thin = polyline(pts, l.id === 'pwr' ? ink(0.8) : IDLE());
        this.group.add(thin);
        base.push(thin);
        let len = 0;
        for (let q = 1; q < pts.length; q++) len += pts[q].distanceTo(pts[q - 1]);
        const lm = lineMat({ color: C.red, width: 2.2, dashed: true, dash: len, gap: len * 2 });
        const red = polyline(pts.map((p) => p.clone().setY(p.y + 0.02)), lm);
        red.userData.len = len;
        red.visible = false;
        this.group.add(red);
        live.push(red as unknown as THREE.Object3D & { material: LineMaterial });
      }
      this.links.set(l.id, { l, base, live });
    }
  }
}

export class BoardSheet extends Sheet {
  readonly no = N.board;
  readonly title = 'The logic board';
  readonly short = 'board';
  readonly mmPerUnit = 1;
  readonly sub = 'Logic board, component side';
  view: View = { height: 182, az: -14, el: 52, target: new THREE.Vector3(0, 0, 2), minZoom: 0.5, maxZoom: 14 };
  boards!: Record<Arch, Board>;
  op: Op = OPS[1];
  private runT = -1;
  private hopEls: HTMLElement[] = [];
  private opBox!: HTMLElement;
  private railsBox!: HTMLElement;
  private lastRails = 0;

  build() {
    this.boards = { arm: new Board('arm'), x86: new Board('x86') };
    for (const b of Object.values(this.boards)) this.root.add(b.group);
    this.applyArch();
    state.on('arch', () => this.applyArch());
  }

  private get b() {
    return this.boards[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    this.boards.arm.group.visible = a === 'arm';
    this.boards.x86.group.visible = a === 'x86';
    const b = this.b;
    this.view.height = a === 'arm' ? 182 : 262;
    b.socAnchor.getWorldPosition(this.zoomTarget);
    const seen = new Set<number>();
    const refs: Ref[] = [];
    const offs: Record<string, [number, number]> = { soc: [-20, -110], gpu: [40, -110], gddr0: [-30, -110], dram0: [-80, 60], ssd: [40, 80], pmic: [-60, 70], vrm: [-40, 80], ind: [-90, -30], wifi: [70, -60], rt0: [-60, -60], ec: [60, 70], codec: [70, -50], xtal: [-70, -60] };
    for (const { c, part, anchor } of b.comps.values()) {
      if (seen.has(c.n)) {
        refs.find((r) => r.n === c.n)?.parts?.push(part);
        continue;
      }
      seen.add(c.n);
      refs.push({ n: c.n, name: c.name, text: c.text, facts: c.facts, target: anchor, off: offs[c.id] ?? [60, -50], parts: [part], see: c.see });
    }
    refs.push({ n: 516, name: 'Decoupling capacitors', text: 'Tiny ceramic capacitors packed around the processor. When billions of transistors switch at once, the current changes in nanoseconds; these hold the voltage steady until the regulators catch up.', target: b.capsAnchor, off: [70, 40], parts: b.capParts });
    refs.push({ n: 518, name: 'Printed circuit board', text: 'Ten or more copper layers laminated with glass-fibre epoxy, with the signal traces between ground planes so every high-speed line behaves like a cable of known impedance.', facts: [['Layers', a === 'arm' ? '10, any-layer HDI' : '10, HDI'], ['Thickness', '≈ 0.8 mm']], target: b.boardPart, at: v(-b.bw / 2 + 8, 0, b.bd / 2 - 6), off: [-40, 50], parts: [b.boardPart] });
    refs.sort((x, y) => Number(x.n) - Number(y.n));
    this.refs = refs;
    this.dims = [
      { a: v(-b.bw / 2, -1, b.bd / 2), b: v(b.bw / 2, -1, b.bd / 2), space: b.group, off: 26, text: () => b.bw.toFixed(1) },
      { a: v(b.bw / 2, -1, b.bd / 2), b: v(b.bw / 2, -1, -b.bd / 2), space: b.group, off: -24, text: () => b.bd.toFixed(1) },
    ];
    this.runT = -1;
    this.paintOp();
    this.onRebuild();
  }

  panel() {
    const op = segmented({
      label: 'Follow the data',
      options: OPS.map((o) => ({ value: o.id, label: o.label })),
      value: this.op.id,
      wrap: true,
      onChange: (id) => {
        this.op = OPS.find((o) => o.id === id)!;
        this.run();
      },
    });
    this.opBox = h('div', { class: 'hops' });
    this.railsBox = h('div');
    this.paintOp();
    return h(
      'div',
      null,
      section(null, op.el, h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.run() }, 'Send it')), this.opBox),
      section('How far away is the data', ladder()),
      section('Power rails, live', h('p', { class: 'note' }, 'Currents follow the workload running on sheet 3. Lower voltage means more current for the same power.'), this.railsBox),
    );
  }

  private hops(): Hop[] {
    return state.arch === 'x86' && this.op.gpuHops ? this.op.gpuHops : this.op.hops;
  }

  private run() {
    this.runT = 0;
    const total = this.totalTime();
    state.revise(this.no, `${this.op.label} on ${SPEC[state.arch].short}: ${fmtDuration(total)}`);
    this.paintOp();
  }

  private totalTime() {
    const b = this.b;
    return this.hops().reduce((acc, hp) => {
      const l = b.links.get(hp.link)!.l;
      return acc + l.lat + hp.bytes / l.bw;
    }, 0);
  }

  private paintOp() {
    if (!this.opBox) return;
    const b = this.b;
    const total = this.totalTime();
    const rows = this.hops().map((hp) => {
      const l = b.links.get(hp.link)!.l;
      const t = l.lat + hp.bytes / l.bw;
      return h(
        'div',
        { class: 'hop' },
        h('div', { class: 'hop-what' }, hp.what),
        h('div', { class: 'hop-link' }, `${l.name} · ${fmtSI(l.bw, 'B/s', 3)} · ${fmtSI(hp.bytes, 'B', 3)}`),
        h('div', { class: 'hop-t tnum' }, fmtDuration(t)),
        h('div', { class: 'hop-bar' }, h('i', { style: { width: `${Math.max(1.5, (t / total) * 100)}%` } })),
      );
    });
    this.hopEls = rows;
    const after = this.op.after?.(total, state.arch);
    this.opBox.replaceChildren(
      ...rows,
      h('div', { class: 'chain-total' }, h('span', null, 'Total, on this machine'), h('strong', { class: 'tnum' }, fmtDuration(total))),
      ...(after ? [h('p', { class: 'note', style: { marginTop: '8px' } }, after)] : []),
    );
  }

  update(dt: number) {
    const b = this.b;
    // play the hops one after another, each over a fixed share of a 3.2 s animation
    if (this.runT >= 0) {
      this.runT += dt;
      const per = 3.2 / this.hops().length;
      const idx = Math.floor(this.runT / per);
      for (const [id, L] of b.links) {
        const active = idx < this.hops().length && this.hops()[idx].link === id;
        const prog = Math.min(1, (this.runT - idx * per) / (per * 0.8));
        L.live.forEach((x) => {
          x.visible = active;
          // reveal the solid path from source to destination over the hop
          if (active) x.material.dashOffset = x.userData.len * (1 - prog);
        });
      }
      this.hopEls.forEach((el, i) => el.classList.toggle('live', i === idx));
      if (idx >= this.hops().length) {
        this.runT = -1;
        for (const L of b.links.values()) L.live.forEach((x) => (x.visible = false));
        this.hopEls.forEach((el) => el.classList.remove('live'));
      }
    }
    // power rail always shows current flowing when the package draws power
    const pw = b.links.get('pwr');
    if (pw && this.runT < 0) {
      pw.live.forEach((x) => {
        x.visible = thermal.power > 0.5;
        x.material.dashOffset = 0;
      });
    }
    const now = performance.now();
    if (this.railsBox && now - this.lastRails > 300) {
      this.lastRails = now;
      this.paintRails();
    }
  }

  private paintRails() {
    const a = state.arch;
    const T = THERMAL[a];
    const load = LOADS[state.workload].blocks;
    const P = thermal.power;
    const cpuShare = ((load.pcore ?? 0) + (load.ecore ?? 0) * 0.4) || 0.1;
    const gpuShare = (load.gpu ?? 0) + (load.npu ?? 0) * 0.5 + (load.media ?? 0) * 0.4;
    const sum = cpuShare + gpuShare + 0.35;
    const vCore = 0.6 + 0.4 * ((thermal.freq - T.fMin) / (T.fMax - T.fMin));
    const rails: [string, number, number][] = [
      ['CPU cores', vCore, (P * cpuShare) / sum],
      ['GPU and accelerators', 0.72, (P * gpuShare) / sum],
      ['SoC fabric and caches', 0.75, (P * 0.35) / sum],
      ['Memory I/O (VDDQ)', a === 'arm' ? 0.5 : 1.1, 0.4 + (load.mem ?? 0) * 1.2],
      ['I/O 1.8 V', 1.8, 0.25],
    ];
    const s = SPEC[a];
    const batA = thermal.systemW() / s.packV;
    this.railsBox.replaceChildren(
      h(
        'table',
        { class: 'revs rails' },
        h('thead', null, h('tr', null, h('th', null, 'Rail'), h('th', null, 'Volts'), h('th', null, 'Watts'), h('th', null, 'Amps'))),
        h(
          'tbody',
          null,
          h('tr', null, h('td', null, 'Battery pack'), h('td', null, s.packV.toFixed(1)), h('td', null, thermal.systemW().toFixed(1)), h('td', null, batA.toFixed(2))),
          ...rails.map(([n, vv, w]) => h('tr', null, h('td', null, n), h('td', null, vv.toFixed(2)), h('td', null, w.toFixed(1)), h('td', { class: w / vv > 5 ? 'hot' : '' }, (w / vv).toFixed(1)))),
        ),
      ),
    );
  }
}

function ladder() {
  const rows: [string, number][] = [
    ['CPU register', 0.25e-9],
    ['L1 cache', 1e-9],
    ['L2 cache', 4e-9],
    ['System cache on die', 15e-9],
    ['Main memory', 100e-9],
    ['SSD, random read', 65e-6],
    ['Wi-Fi to the router and back', 2e-3],
    ['A server 1,000 km away', 25e-3],
  ];
  const human = (s: number) => {
    const x = s * 1e9; // 1 ns becomes 1 s
    if (x < 60) return `${x.toPrecision(2)} s`;
    if (x < 3600) return `${(x / 60).toPrecision(2)} min`;
    if (x < 86400) return `${(x / 3600).toPrecision(2)} h`;
    if (x < 86400 * 365) return `${(x / 86400).toPrecision(2)} days`;
    return `${(x / 86400 / 365).toPrecision(2)} years`;
  };
  return h(
    'table',
    { class: 'revs ladder' },
    h('thead', null, h('tr', null, h('th', null, 'Where'), h('th', null, 'Wait'), h('th', null, 'If 1 ns were 1 s'))),
    h('tbody', null, ...rows.map(([n, s]) => h('tr', null, h('td', null, n), h('td', null, fmtDuration(s)), h('td', null, human(s))))),
  );
}
