import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { C, M, Part, slab, box, v, polyline, segments, ink, lineMat } from '../core/ink';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal } from '../sim/thermal';
import { h, segmented, slider, readout, section, grind, facts, Plot } from '../core/ui';
import { tcs } from '../core/theme';
import { N } from './ids';

// A 3 × 3 pixel patch of each panel, exploded layer by layer. Units: micrometres.
// Layer thicknesses are compressed so every layer is visible; the true values are in the legend.

const SUB: [number, number, number][] = [
  [0xd2513f, 0x000000, 0], // red
  [0x4fa35c, 0, 0], // green
  [0x3f63c9, 0, 0], // blue
];

interface LayerDef {
  key: string;
  n: number;
  name: string;
  real: string; // true thickness
  drawn: number; // drawn thickness, µm
  fill: number;
  text: string;
}

const OLED: LayerDef[] = [
  { key: 'tft', n: 200, name: 'TFT backplane', real: '≈ 30 µm on 0.3 mm glass', drawn: 26, fill: M.glass, text: 'A layer of thin-film transistors with a storage capacitor, at least two transistors per subpixel and usually seven. They set each subpixel\'s current and hold it steady for the whole frame. The panel varies its refresh rate up to 120 Hz, slowing down when nothing on screen moves to save power.' },
  { key: 'anode', n: 202, name: 'Anodes', real: '0.1 µm', drawn: 3, fill: M.tin, text: 'A reflective metal pad under every subpixel. It injects holes into the organic layers and mirrors light forwards.' },
  { key: 'emit', n: 204, name: 'Organic emitters', real: '0.2 µm', drawn: 6, fill: M.bezel, text: 'Stacks of organic molecules where electrons and holes meet and give off light. Red, green and blue materials are deposited through a fine metal mask, each in its own window.' },
  { key: 'cathode', n: 206, name: 'Cathode', real: '0.02 µm', drawn: 2, fill: M.gateMetal, text: 'A semi-transparent metal film shared by every pixel, thin enough for the light to pass.' },
  { key: 'tfe', n: 208, name: 'Thin-film encapsulation', real: '≈ 10 µm', drawn: 10, fill: M.oxide, text: 'Alternating inorganic and organic films that keep out oxygen and water. The organic emitters are ruined by traces of water, so the barrier must let through less than a millionth of a gram per square metre per day.' },
  { key: 'touch', n: 210, name: 'Touch sensor', real: '≈ 5 µm', drawn: 4, fill: M.oxide, text: 'A metal mesh built straight onto the encapsulation. A finger changes the capacitance between its rows and columns.' },
  { key: 'pol', n: 212, name: 'Circular polariser', real: '≈ 100 µm', drawn: 14, fill: 0x8d939b, text: 'Stops room light from bouncing off the metal anodes back to your eye, so black stays black. It also absorbs over half of the panel\'s own light.' },
  { key: 'glass', n: 214, name: 'Cover glass', real: '0.55 mm', drawn: 30, fill: 0xc6d2da, text: 'Chemically strengthened aluminosilicate glass with an anti-reflective coating.' },
];

const LCD: LayerDef[] = [
  { key: 'led', n: 200, name: 'Mini-LED backlight', real: '≈ 0.3 mm board, LEDs 0.2 mm', drawn: 24, fill: M.pcb, text: 'More than 2,000 zones, each a group of blue mini-LEDs the controller dims on its own. A zone is several millimetres across, so it sits under thousands of pixels; this patch shares one. That is why a bright cursor on black shows a faint halo.' },
  { key: 'films', n: 202, name: 'Diffuser and quantum-dot films', real: '≈ 0.4 mm', drawn: 16, fill: M.white, text: 'A quantum-dot film turns part of the blue light into pure red and green; diffusers and prism films spread it evenly and aim it forwards.' },
  { key: 'pol1', n: 204, name: 'Rear polariser', real: '≈ 0.1 mm', drawn: 8, fill: 0x8d939b, text: 'Lets through only light vibrating in one direction.' },
  { key: 'tft', n: 206, name: 'TFT glass', real: '0.3 mm', drawn: 20, fill: M.glass, text: 'One transistor and one transparent electrode per subpixel. The transistor charges the electrode to the subpixel\'s voltage and holds it until the next frame.' },
  { key: 'lc', n: 208, name: 'Liquid crystal', real: '≈ 3 µm', drawn: 14, fill: 0xe7e3d6, text: 'Rod-shaped molecules that twist the light\'s polarisation. The electric field from the electrode turns them, and that sets how much light the front polariser lets out.' },
  { key: 'cf', n: 210, name: 'Colour filter', real: '≈ 2 µm on 0.3 mm glass', drawn: 18, fill: M.glass, text: 'Red, green and blue dyes, one per subpixel, between a black matrix that hides the wiring.' },
  { key: 'pol2', n: 212, name: 'Front polariser', real: '≈ 0.15 mm', drawn: 10, fill: 0x8d939b, text: 'Crossed with the rear one. Light the crystal has not twisted is blocked here.' },
];

class Panel {
  group = new THREE.Group();
  layers: { def: LayerDef; group: THREE.Group; y0: number; part: Part }[] = [];
  emitters: Part[][] = []; // [subpixel kind][instance]
  rods: { line: THREE.Object3D; base: number; k: number }[] = [];
  rays: { line: THREE.Object3D & { material: LineMaterial }; k: number; px: number }[] = [];
  rowParts: Part[][] = [];
  led?: Part;
  pitch: number;
  W: number;
  anchors: Record<string, THREE.Object3D> = {};

  constructor(public arch: Arch) {
    const s = SPEC[arch];
    const oled = s.displayTech === 'oled';
    this.pitch = ((s.displayIn * 25.4 * (s.displayPx[0] / Math.hypot(s.displayPx[0], s.displayPx[1]))) / s.displayPx[0]) * 1000;
    const p = this.pitch;
    const W = (this.W = 3 * p);
    const defs = oled ? OLED : LCD;
    let y = 0;
    for (const def of defs) {
      const g = new THREE.Group();
      g.position.y = y;
      this.group.add(g);
      const part = new Part(box(W, def.drawn, W).translate(0, def.drawn / 2, 0), { width: 1, threshold: 30, fill: def.fill });
      g.add(part);
      this.layers.push({ def, group: g, y0: y, part });
      const a = new THREE.Object3D();
      a.position.set(W / 2, def.drawn, W / 2 - 8);
      g.add(a);
      this.anchors[def.key] = a;
      y += def.drawn;
    }
    const L = (k: string) => this.layers.find((l) => l.def.key === k)!;
    const sw = p / 3;
    for (let k = 0; k < 3; k++) this.emitters.push([]);
    for (let row = 0; row < 3; row++) {
      this.rowParts.push([]);
      for (let col = 0; col < 3; col++) {
        for (let k = 0; k < 3; k++) {
          let cx = -W / 2 + col * p + (k + 0.5) * sw;
          let cz = -W / 2 + (row + 0.5) * p;
          if (oled) {
            // the panel's real layout (macro photograph of this panel family): red and green are small
            // subpixels stacked in one column, blue is a tall one beside them, staggered column to column
            let ew: number, ed: number;
            if (k < 2) {
              cx = -W / 2 + col * p + p * 0.24;
              cz = -W / 2 + row * p + p * (k === 0 ? 0.27 : 0.73);
              ew = p * 0.26;
              ed = p * 0.3;
            } else {
              cx = -W / 2 + col * p + p * 0.69;
              cz = -W / 2 + (row + 0.5) * p + (col % 2 ? 0.1 : -0.1) * p;
              ew = p * 0.34;
              ed = p * 0.76;
            }
            const em = new Part(slab(ew, 6.5, ed, 3), { width: 0.7, threshold: 40, fill: M.bezel });
            em.position.set(cx, 0, cz);
            L('emit').group.add(em);
            this.emitters[k].push(em);
            this.rowParts[row].push(em);
            const an = new Part(slab(ew * 1.12, 3.2, ed * 1.08, 2), { width: 0.6, threshold: 40, fill: M.tin });
            an.position.set(cx, 0, cz);
            L('anode').group.add(an);
            const tft = new Part(slab(sw * 0.5, 4, p * 0.22, 1), { width: 0.6, threshold: 40, fill: M.gateMetal });
            tft.position.set(cx, L('tft').def.drawn, cz + p * 0.32);
            L('tft').group.add(tft);
            const ray = polyline([v(cx, 12, cz), v(cx, 150, cz)], lineMat({ color: C.red, width: 1.6 }));
            this.group.add(ray);
            this.rays.push({ line: ray as never, k, px: row * 3 + col });
          } else {
            const cf = new Part(slab(sw * 0.8, 2.5, p * 0.84, 1.5), { width: 0.6, threshold: 40, fill: SUB[k][0] });
            cf.position.set(cx, L('cf').def.drawn + 0.05, cz);
            L('cf').group.add(cf);
            this.emitters[k].push(cf);
            this.rowParts[row].push(cf);
            const el = new Part(slab(sw * 0.7, 1.5, p * 0.8, 1), { width: 0.5, threshold: 40, fill: M.tin });
            el.position.set(cx, L('tft').def.drawn, cz);
            L('tft').group.add(el);
            for (let rI = 0; rI < 3; rI++) {
              const rod = segments([v(-sw * 0.22, 0, 0), v(sw * 0.22, 0, 0)], ink(1.8));
              rod.position.set(cx, 3.5 + rI * 3.5, cz - p * 0.25 + rI * p * 0.25);
              L('lc').group.add(rod);
              this.rods.push({ line: rod, base: rI, k });
            }
            const ray = polyline([v(cx, 20, cz), v(cx, 200, cz)], lineMat({ color: C.red, width: 1.6 }));
            this.group.add(ray);
            this.rays.push({ line: ray as never, k, px: row * 3 + col });
          }
        }
      }
    }
    // data and scan lines on the backplane
    const grid: THREE.Vector3[] = [];
    const ty = L('tft').def.drawn + 0.2;
    for (let i = 0; i <= 9; i++) {
      const x = -W / 2 + i * sw;
      grid.push(v(x, ty, -W / 2), v(x, ty, W / 2));
    }
    for (let i = 0; i <= 3; i++) grid.push(v(-W / 2, ty, -W / 2 + i * p), v(W / 2, ty, -W / 2 + i * p));
    L('tft').group.add(segments(grid, ink(0.55, C.grey)));
    if (oled) {
      const mesh: THREE.Vector3[] = [];
      const ty2 = L('touch').def.drawn + 0.2;
      for (let i = -6; i <= 6; i++) mesh.push(v(-W / 2, ty2, i * p * 0.5), v(W / 2, ty2, i * p * 0.5 + W * 0.3));
      // keep whole segments only, clipped to the patch
      const kept: THREE.Vector3[] = [];
      for (let i = 0; i + 1 < mesh.length; i += 2) {
        const a = mesh[i], b = mesh[i + 1];
        if (Math.abs(a.z) <= W / 2 && Math.abs(b.z) <= W / 2) kept.push(a, b);
      }
      if (kept.length) L('touch').group.add(segments(kept, ink(0.5, C.grey)));
    } else {
      this.led = new Part(slab(120, 9, 120, 6), { width: 0.9, hull: true, threshold: 40, fill: M.white });
      this.led.position.set(0, L('led').def.drawn, 0);
      L('led').group.add(this.led);
      const bm: THREE.Vector3[] = [];
      const cy = L('cf').def.drawn + 0.2;
      for (let i = 0; i <= 3; i++) bm.push(v(-W / 2 + i * p, cy, -W / 2), v(-W / 2 + i * p, cy, W / 2), v(-W / 2, cy, -W / 2 + i * p), v(W / 2, cy, -W / 2 + i * p));
      L('cf').group.add(segments(bm, ink(1.6)));
    }
  }

  setExplode(e: number) {
    let y = 0;
    for (const l of this.layers) {
      l.group.position.y = y;
      y += l.def.drawn + e * (this.arch === 'arm' ? 46 : 52);
    }
    return y;
  }
}

type Preset = 'white' | 'grey' | 'red' | 'teal' | 'black';
const PRESETS: Record<Preset, [number, number, number]> = { white: [1, 1, 1], grey: [0.5, 0.5, 0.5], red: [1, 0.08, 0.05], teal: [0.05, 0.75, 0.7], black: [0, 0, 0] };

export class DisplaySheet extends Sheet {
  readonly no = N.display;
  readonly title = 'The display';
  readonly short = 'display';
  readonly mmPerUnit = 0.001;
  readonly sub = 'Three by three pixels, every layer pulled apart; layer thickness compressed';
  view: View = { height: 560, az: -34, el: 24, target: new THREE.Vector3(0, 230, 0), minZoom: 0.5, maxZoom: 12 };
  panels!: Record<Arch, Panel>;
  rgb: [number, number, number] = [1, 1, 1];
  explode = 1;
  private scanT = 0;
  private ro!: Record<string, ReturnType<typeof readout>>;
  private plot!: Plot;
  private infoBox!: HTMLElement;
  private lastPaint = 0;

  build() {
    this.panels = { arm: new Panel('arm'), x86: new Panel('x86') };
    for (const p of Object.values(this.panels)) {
      this.root.add(p.group);
      p.setExplode(this.explode);
    }
    this.applyArch();
    state.on('arch', () => this.applyArch());
  }

  private get p() {
    return this.panels[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    this.panels.arm.group.visible = a === 'arm';
    this.panels.x86.group.visible = a === 'x86';
    const p = this.p;
    const top = p.setExplode(this.explode);
    this.view.target.set(0, top / 2, 0);
    this.view.height = top * 1.3;
    this.zoomTarget.set(0, top / 2, 0);
    this.refs = p.layers.map((l, i) => ({
      n: l.def.n,
      name: l.def.name,
      text: l.def.text,
      facts: [['True thickness', l.def.real]],
      target: p.anchors[l.def.key],
      off: [i % 2 ? 110 : -110, -10] as [number, number],
      parts: [l.part],
      grind: ['cathode', 'touch', 'tfe', 'pol1', 'films'].includes(l.def.key),
    })) as Ref[];
    this.dims = [{ a: v(-p.W / 2, 0, p.W / 2), b: v(-p.W / 2 + p.pitch, 0, p.W / 2), space: p.group, off: 26, text: () => `${p.pitch.toFixed(1)} µm` }];
    this.onRebuild();
  }

  panel() {
    const preset = segmented<Preset>({ label: 'Show this colour', options: [{ value: 'white', label: 'White' }, { value: 'grey', label: 'Grey' }, { value: 'red', label: 'Red' }, { value: 'teal', label: 'Teal' }, { value: 'black', label: 'Black' }], value: 'white', wrap: true, onChange: (x) => {
      this.rgb = [...PRESETS[x]];
      ch.forEach((c, i) => c.set(Math.round(this.rgb[i] * 255)));
      state.revise(this.no, `Display showing ${x}`);
    } });
    const ch = (['Red', 'Green', 'Blue'] as const).map((name, i) => slider({ label: `${name} subpixel`, min: 0, max: 255, step: 1, value: 255, format: (x) => `${x}`, onInput: (x) => (this.rgb[i] = x / 255) }));
    const bright = slider({ label: 'Brightness', min: 0, max: 100, step: 1, value: thermal.brightness * 100, format: (b) => `${b} %`, onInput: (b) => (thermal.brightness = b / 100) });
    const ex = slider({ label: 'Pull layers apart', min: 0, max: 1, step: 0.01, value: this.explode, format: (e) => `${Math.round(e * 100)} %`, onInput: (e) => {
      this.explode = e;
      this.p.setExplode(e);
    } });
    this.ro = {
      w: readout({ label: 'Panel power, whole screen this colour', unit: 'W', digits: 1, min: 0, live: () => true }),
      nits: readout({ label: 'Light out', unit: 'nits', digits: 0, trend: false }),
      contrast: readout({ label: 'Contrast', trend: false }),
      resp: readout({ label: 'Pixel response', trend: false }),
    };
    this.plot = new Plot({ x: [0, 16.7], y: [0, 1.1], xLabel: 'time, ms', yLabel: 'light', xTicks: [0, 4, 8, 12, 16], yTicks: [0, 0.5, 1], caption: 'Light from one subpixel over 16.7 ms, one frame at 60 Hz. The OLED dims by switching its pixels off for part of every 4.2 ms cycle (240 Hz PWM, at every brightness, as measured on this panel family); the mini-LED backlight does the same at about 20 kHz, far too fast to see.' });
    this.infoBox = h('div');
    return h(
      'div',
      null,
      section(null, preset.el, bright.el, h('div', { class: 'ro-grid' }, this.ro.w.el, this.ro.nits.el, this.ro.contrast.el, this.ro.resp.el)),
      grind('Mix it yourself', ...ch.map((c) => c.el), ex.el),
      grind('Inside one frame', this.plot.el),
      section('This panel', this.infoBox),
    );
  }

  update(dt: number) {
    const p = this.p;
    const s = SPEC[state.arch];
    const oled = s.displayTech === 'oled';
    const b = thermal.brightness;
    // scan-out: rows refresh top to bottom, slowed down to be visible
    this.scanT += dt * 0.6;
    const scanRow = Math.floor(this.scanT * 3) % 3;
    for (let k = 0; k < 3; k++) {
      const lvl = this.rgb[k] * b;
      const col = new THREE.Color(SUB[k][0]).multiplyScalar(0.25 + 0.75 * lvl);
      p.emitters[k].forEach((e) => {
        if (oled) e.setTone(lvl < 0.01 ? M.bezel : col.getHex());
      });
    }
    for (const r of p.rays) {
      const lvl = this.rgb[r.k] * b;
      r.line.visible = lvl > 0.02;
      r.line.material.linewidth = 0.8 + lvl * 2.6;
    }
    for (const rod of p.rods) {
      const t = this.rgb[rod.k];
      rod.line.rotation.y = (Math.PI / 2) * (1 - t) * (0.6 + rod.base * 0.2);
    }
    if (p.led) p.led.setTone(b > 0.01 && Math.max(...this.rgb) > 0.01 ? C.red : M.white);
    p.rowParts.forEach((row, i) => row.forEach((e) => e.setEmphasis(i === scanRow ? 1 : 0)));
    const now = performance.now();
    if (!this.ro || now - this.lastPaint < 150) return;
    this.lastPaint = now;
    const lum = 0.2126 * this.rgb[0] + 0.7152 * this.rgb[1] + 0.0722 * this.rgb[2];
    // blue emitters are the least efficient: weight power per channel
    const wOled = 0.45 + s.backlightW * b * (0.33 * this.rgb[0] + 0.27 * this.rgb[1] + 0.4 * this.rgb[2]);
    const wLcd = 1.4 + s.backlightW * b * (Math.max(...this.rgb) > 0.01 ? 0.25 + 0.75 * Math.max(...this.rgb) : 0.05);
    this.ro.w.set(oled ? wOled : wLcd);
    this.ro.nits.set(s.displayNits * b * lum);
    this.ro.contrast.set(0, oled ? 'infinite: black is off' : 'about 10,000 : 1 with local dimming, about 1,000 : 1 inside one zone');
    this.ro.resp.set(0, oled ? `about ${s.pixelMs} ms, black to white` : `about ${s.pixelMs} ms grey to grey: the crystal has to turn`);
    const pts: [number, number][] = [];
    // pulse-width modulation: full light for a share of each cycle, so the average is the brightness
    const period = oled ? 1000 / 240 : 1000 / 20000;
    const duty = Math.min(0.97, Math.max(0.04, b));
    for (let t = 0; t <= 16.7; t += oled ? 0.02 : 0.25) {
      const val = oled ? ((t % period) < period * duty ? 1 : 0) : b;
      pts.push([t, val * Math.max(0.0001, lum)]);
    }
    this.plot.series = [{ color: tcs('#1d1f22'), width: 1.5, points: pts }];
    this.plot.draw();
    this.infoBox.replaceChildren(
      facts([
        ['Technology', oled ? 'OLED, self-emissive' : 'LCD with mini-LED local dimming'],
        ['Pixel pitch', `${p.pitch.toFixed(1)} µm, ${Math.round(25400 / p.pitch)} pixels per inch`],
        ['Subpixels', `${(s.displayPx[0] * s.displayPx[1] * 3).toLocaleString('en')}`],
        ['Refresh', `up to ${s.displayHz} Hz: a new frame every ${(1000 / s.displayHz).toFixed(1)} ms`],
        ['Peak brightness', `${s.displayNits} nits`],
      ]),
    );
  }
}
