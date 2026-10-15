import * as THREE from 'three';
import { M, Part, slab, box, v, polyline, ink, fillMat, hullMat, hatchTexture } from '../core/ink';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch } from '../core/state';
import { SPEC } from '../core/specs';
import { thermal } from '../sim/thermal';
import { h, slider, segmented, section, facts } from '../core/ui';
import { N } from './ids';

type Hatch = 'si' | 'metal' | 'oxide' | 'organic' | 'solder' | 'poly';

interface Layer {
  part: Part;
  x0: number;
  x1: number;
  cap: THREE.Group;
}

interface BallField {
  xs: number[];
  zs: number[];
  y: number;
  r: number;
  fill: THREE.InstancedMesh;
  hull: THREE.InstancedMesh;
  discs: THREE.InstancedMesh;
  count: number;
  /** only instance columns near the cut (bumps hidden under a die elsewhere) */
  band: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

class Pkg {
  group = new THREE.Group();
  layers: Layer[] = [];
  fields: BallField[] = [];
  parts: Record<string, Part[]> = {};
  anchors: Record<string, THREE.Object3D> = {};
  w: number;
  d: number;
  balls = 0;
  bumps = 0;
  dieAnchor = new THREE.Object3D();

  constructor(public arch: Arch) {
    const arm = arch === 'arm';
    this.w = arm ? 25 : 37.5;
    this.d = arm ? 25 : 45;
    const W = this.w, D = this.d;

    // substrate: build-up / glass-fibre core / build-up
    this.layer('substrate', W, 0.2, D, 0, 0, 0, 'organic', M.substrate);
    this.layer('substrate', W, 0.45, D, 0, 0.2, 0, 'poly', M.substrate);
    this.layer('substrate', W, 0.2, D, 0, 0.65, 0, 'organic', M.substrate);
    this.anchor('substrate', -W / 2 + 2.5, 0.6, D / 2);

    // BGA balls: the x86 package is a BGA2114 (2,114 balls over 37.5 × 45 mm, about 0.87 mm apart);
    // the ARM package's count is not published, drawn here on a 0.4 mm grid
    const pitch = arm ? 0.4 : 0.87;
    this.balls = this.field(W - 1, D - 1, pitch, -0.12, arm ? 0.125 : 0.24, 0, 0, M.solder, true);
    this.anchor('balls', -W / 2 + 1, -0.15, D / 2 - 0.5);

    const top = 0.85;
    if (arm) {
      // flip-chip die on micro-bumps, with underfill; the memory sits beside the package, not on it
      const dx = 0, dW = 12.74, dD = 13.31;
      this.layer('underfill', dW + 0.8, 0.1, dD + 0.8, dx, top, 0, 'oxide', M.oxide);
      this.bumps = this.field(dW - 0.3, dD - 0.3, 0.13, top + 0.045, 0.04, dx, 0, M.copper, false, 1.2);
      this.layer('die', dW, 0.4, dD, dx, top + 0.09, 0, 'si', M.die);
      this.dieAnchor.position.set(dx, top + 0.49, 0);
      this.anchor('die', dx - 3, top + 0.49, dD / 2 - 1);
      // land-side capacitors
      for (let i = 0; i < 6; i++) this.layer('caps', 0.6, 0.3, 0.3, -2 + i * 0.9, -0.3, -D / 2 + 3, 'metal', M.ceramic, true);
    } else {
      // Foveros: a base die on C4 bumps, with four tiles on micro-bumps above it
      const K = 1.3; // scaled to a ~300 mm² base die
      const bW = 13 * K, bD = 13.3 * K;
      this.layer('underfill', bW + 0.8, 0.1, bD + 0.8, 0, top, 0, 'oxide', M.oxide);
      this.bumps = this.field(bW - 0.3, bD - 0.3, 0.15, top + 0.045, 0.045, 0, 0, M.copper, false, 1.2);
      this.layer('base', bW, 0.2, bD, 0, top + 0.09, 0, 'si', M.siLight);
      const tiles: [string, number, number, number, number][] = [
        ['compute', -3, -2.8, 6.6, 6.8],
        ['gpu', 3.5, -2.8, 5.4, 6.8],
        ['soc', -1.6, 3.9, 9.6, 4.4],
        ['io', 5.2, 3.9, 2.4, 4.4],
      ];
      for (const [k, x0, z0, w0, d0] of tiles) {
        const x = x0 * K, z = z0 * K, w = w0 * K, d = d0 * K;
        this.field(w - 0.3, d - 0.3, 0.09, top + 0.31, 0.02, x, z, M.copper, false, 0.8);
        this.layer(`tile-${k}`, w, 0.3, d, x, top + 0.33, z, 'si', M.die);
      }
      this.dieAnchor.position.set(-3 * K, top + 0.63, -2.8 * K);
      this.anchor('base', -bW / 2, top + 0.2, 4 * K);
      this.anchor('die', -3 * K, top + 0.63, -1);
      this.anchor('tiles', -1.6 * K, top + 0.63, 5.5 * K);
      for (let i = 0; i < 8; i++) this.layer('caps', 0.6, 0.3, 0.3, -3 + i * 0.9, -0.3, -D / 2 + 3, 'metal', M.ceramic, true);
    }
    this.anchor('caps', -2, -0.3, -D / 2 + 3);
  }

  private anchor(k: string, x: number, y: number, z: number) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.group.add(o);
    this.anchors[k] = o;
  }

  private layer(key: string, w: number, hgt: number, d: number, x: number, y: number, z: number, hatch: Hatch, tone: number, thin = false) {
    const p = new Part(thin ? box(w, hgt, d).translate(0, hgt / 2, 0) : slab(w, hgt, d, Math.min(0.4, w / 20)), { width: thin ? 0.7 : 1.1, threshold: 40, fill: tone, hull: false });
    p.position.set(x, y, z);
    this.group.add(p);
    (this.parts[key] ??= []).push(p);
    // section cap: a hatched face that appears where the cutting plane passes through
    const cap = new THREE.Group();
    const tex = hatchTexture(hatch);
    tex.repeat.set(d / 1.4, Math.max(0.05, (hgt * 3) / 1.4));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(d, hgt).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, hgt / 2, 0);
    cap.add(face);
    cap.add(polyline([v(0, 0, -d / 2), v(0, 0, d / 2), v(0, hgt, d / 2), v(0, hgt, -d / 2)], ink(1.1), true));
    cap.position.set(0, y, z);
    cap.visible = false;
    this.group.add(cap);
    this.layers.push({ part: p, x0: x - w / 2, x1: x + w / 2, cap });
  }

  /** Instanced solder spheres on a grid, plus discs for where the cut slices through them. */
  private field(w: number, d: number, pitch: number, y: number, r: number, cx: number, cz: number, tone: number, hullOn: boolean, band = 0) {
    const nx = Math.max(1, Math.floor(w / pitch) + 1), nz = Math.max(1, Math.floor(d / pitch) + 1);
    const xs = Array.from({ length: nx }, (_, i) => cx - ((nx - 1) * pitch) / 2 + i * pitch);
    const zs = Array.from({ length: nz }, (_, i) => cz - ((nz - 1) * pitch) / 2 + i * pitch);
    const count = nx * nz;
    const seg = r > 0.1 ? 10 : 6;
    const geo = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 3));
    const fill = new THREE.InstancedMesh(geo, fillMat(tone), count);
    const hull = new THREE.InstancedMesh(geo, hullMat(hullOn ? 0.9 : 0.6), count);
    let i = 0;
    for (const x of xs)
      for (const z of zs) {
        tmpM.makeTranslation(x, y, z);
        fill.setMatrixAt(i, tmpM);
        hull.setMatrixAt(i, tmpM);
        i++;
      }
    const discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: hatchTexture('solder', 0.5) }), nz * 2);
    discs.count = 0;
    this.group.add(fill, hull, discs);
    this.fields.push({ xs, zs, y, r, fill, hull, discs, count, band });
    if (band) fill.count = hull.count = 0;
    return count;
  }

  setCut(c: number) {
    for (const L of this.layers) {
      const on = c > L.x0 && c < L.x1;
      L.cap.visible = on;
      if (on) L.cap.position.x = c - 0.0006;
    }
    for (const f of this.fields) {
      if (f.band) {
        let k = 0;
        for (const x of f.xs) {
          if (x > c + 0.02 || x < c - f.band) continue;
          for (const z of f.zs) {
            tmpM.makeTranslation(x, f.y, z);
            f.fill.setMatrixAt(k, tmpM);
            f.hull.setMatrixAt(k, tmpM);
            k++;
          }
        }
        f.fill.count = f.hull.count = k;
        f.fill.instanceMatrix.needsUpdate = f.hull.instanceMatrix.needsUpdate = true;
      }
      let n = 0;
      for (const x of f.xs) {
        const dx = Math.abs(x - c);
        if (dx >= f.r) continue;
        const rr = Math.sqrt(f.r * f.r - dx * dx);
        for (const z of f.zs) {
          if (n >= f.discs.instanceMatrix.count) break;
          tmpM.compose(tmpP.set(c - 0.0004, f.y, z), tmpQ, tmpS.set(rr, rr, rr));
          f.discs.setMatrixAt(n++, tmpM);
        }
      }
      f.discs.count = n;
      f.discs.instanceMatrix.needsUpdate = true;
    }
  }
}

export class PackageSheet extends Sheet {
  readonly no = N.package;
  readonly title = 'The package';
  readonly short = 'package';
  readonly mmPerUnit = 1;
  readonly sub = 'Section A–A through the package, heights exaggerated to show the layers';
  view: View = { height: 22, az: 62, el: 20, target: new THREE.Vector3(0, 1.2, 0), minZoom: 0.5, maxZoom: 40 };
  pkgs!: Record<Arch, Pkg>;
  cut = 2.0;
  vscale = 3;
  private plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private live!: HTMLElement;
  private cutSlider!: ReturnType<typeof slider>;
  private lastLive = 0;

  build() {
    this.pkgs = { arm: new Pkg('arm'), x86: new Pkg('x86') };
    for (const p of Object.values(this.pkgs)) this.root.add(p.group);
    this.root.scale.y = this.vscale;
    this.clipPlanes = [this.plane];
    this.applyArch();
    state.on('arch', () => this.applyArch());
  }

  private get p() {
    return this.pkgs[state.arch];
  }

  onRebuild: () => void = () => {};

  private setCut(c: number) {
    this.cut = c;
    this.plane.constant = c;
    this.p.setCut(c);
  }

  private applyArch() {
    const a = state.arch;
    this.pkgs.arm.group.visible = a === 'arm';
    this.pkgs.x86.group.visible = a === 'x86';
    const p = this.p;
    this.view.height = a === 'arm' ? 31 : 50;
    this.setCut(this.cut);
    this.root.updateMatrixWorld(true);
    p.dieAnchor.getWorldPosition(this.zoomTarget);
    const s = SPEC[a];
    const refs: Ref[] = [
      { n: 800, name: 'Package substrate', text: 'A miniature circuit board: a glass-fibre core with fine copper build-up layers on both sides. It fans the die\'s connections out from a ' + (a === 'arm' ? '0.13 mm grid to a 0.4 mm' : '0.15 mm grid to a 0.87 mm') + ' grid the logic board can reach.', facts: [['Layers', '4 + core + 4'], ['Footprint', `${p.w} × ${p.d} mm`]], target: p.anchors.substrate, off: [60, 50], parts: p.parts.substrate },
      { n: 802, name: 'Solder balls (BGA)', text: `${a === 'arm' ? `About ${p.balls.toLocaleString('en')}` : '2,114'} balls of tin-silver-copper solder, reflowed onto the board in an oven. Roughly half carry power and ground, not signals.`, facts: [['Count', a === 'arm' ? `≈ ${p.balls.toLocaleString('en')}, estimated` : '2,114 (BGA2114)'], ['Pitch', a === 'arm' ? '≈ 0.40 mm' : '≈ 0.87 mm']], target: p.anchors.balls, off: [-50, 50], parts: [] },
      { n: 804, name: a === 'arm' ? 'Die, flip-chip' : 'Compute tile', text: a === 'arm' ? `One piece of silicon, ${s.dieMm2} mm², mounted upside down so its wiring faces the substrate. Heat leaves through the bare silicon back.` : 'The CPU cores live on their own tile, made on the most advanced process; the other tiles can use cheaper ones.', facts: [['Die thickness', a === 'arm' ? '0.40 mm' : '0.30 mm'], ['Process', s.node]], target: p.anchors.die, off: [-40, -70], parts: a === 'arm' ? p.parts.die : p.parts['tile-compute'], see: N.die },
      { n: 806, name: 'Bumps and underfill', text: `${p.bumps.toLocaleString('en')} copper-pillar bumps join the die to the substrate. An epoxy underfill locks them so heating and cooling cannot crack them.`, facts: [['Bump pitch', a === 'arm' ? '130 µm' : '150 µm'], ['Count', p.bumps.toLocaleString('en')]], target: p.parts.underfill[0], at: v(4, 0.1, 6), off: [70, 40], parts: p.parts.underfill },
      { n: 808, name: 'Decoupling capacitors', text: 'Placed under the package on the land side, as close to the die as physics allows, to supply the current spikes of billions of switching transistors.', target: p.anchors.caps, off: [-50, 40], parts: p.parts.caps },
    ];
    if (a === 'arm') {
      refs.splice(3, 0, { n: 805, name: 'Memory beside the package', text: `${s.memory}. Unlike chips that stack memory on the package, this SoC reaches its LPDDR5X over short traces on the board (sheet 5).`, target: p.anchors.die, off: [80, 50], parts: [], grind: true });
    } else {
      refs.splice(3, 0, { n: 805, name: 'Foveros base die', text: 'A passive silicon tile that the four active tiles sit on. Micro-bumps at 36–50 µm pitch connect them through it, far denser than a substrate could.', target: p.anchors.base, off: [60, 40], parts: p.parts.base });
      refs.splice(4, 0, { n: 807, name: 'GPU, SoC and I/O tiles', text: 'Graphics, the media engines and NPU, and the I/O controllers each have their own tile. Splitting the chip raises yield: one defect scraps a small tile, not the whole thing.', target: p.anchors.tiles, off: [70, -60], parts: [...p.parts['tile-gpu'], ...p.parts['tile-soc'], ...p.parts['tile-io']] });
    }
    this.refs = refs;
    this.dims = [{ a: v(-p.w / 2, -0.25, p.d / 2), b: v(p.w / 2, -0.25, p.d / 2), space: p.group, off: 26, text: () => p.w.toFixed(1) }];
    if (this.cutSlider) {
      this.cutSlider.input.min = String(-p.w / 2);
      this.cutSlider.input.max = String(p.w / 2);
    }
    this.onRebuild();
  }

  panel() {
    const p = () => this.p;
    this.cutSlider = slider({ label: 'Cutting plane A–A', min: -p().w / 2, max: p().w / 2, step: 0.01, value: this.cut, format: (c) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(2)} mm`, onInput: (c) => this.setCut(c) });
    const vs = segmented({
      label: 'Vertical scale',
      options: [
        { value: '1', label: 'True ×1' },
        { value: '3', label: '×3' },
        { value: '6', label: '×6' },
      ],
      value: '3',
      onChange: (x) => {
        this.vscale = Number(x);
        this.root.scale.y = this.vscale;
      },
    });
    this.live = h('div');
    return h(
      'div',
      null,
      section(null, this.cutSlider.el, vs.el, h('p', { class: 'note' }, 'Hatching follows the drafting convention for each material: silicon in single hatch, copper cross-hatched, mould compound and underfill dotted, the glass-fibre core ruled.')),
      section('Power through the balls, live', this.live),
      section('Detail B · on-die wiring, 2,000 : 1', beol()),
    );
  }

  private tmpV = new THREE.Vector3();

  update() {
    // numerals for parts the cutting plane has removed would point at nothing
    for (const r of this.refs) {
      r.target.getWorldPosition(this.tmpV);
      if (r.at) this.tmpV.x += r.at.x;
      r.hidden = this.tmpV.x > this.cut + 0.05;
    }
    const now = performance.now();
    if (!this.live || now - this.lastLive < 300) return;
    this.lastLive = now;
    const p = this.p;
    const vCore = 0.6 + 0.4 * Math.min(1, thermal.freq / 4.5);
    const amps = thermal.power / vCore;
    const powerBalls = Math.round(p.balls * 0.48);
    this.live.replaceChildren(
      facts([
        ['Package power', `${thermal.power.toFixed(1)} W`],
        ['Core rail', `${vCore.toFixed(2)} V`],
        ['Current into the package', `${amps.toFixed(1)} A`],
        ['Power and ground balls', powerBalls.toLocaleString('en')],
        ['Current per power ball', `${((amps / (powerBalls / 2)) * 1000).toFixed(0)} mA`],
      ]),
    );
  }
}

/** Detail view of the back-end-of-line metal stack, drawn as SVG at its own scale. */
function beol() {
  const layers: [string, number, number][] = [
    ['M14–M15', 3.0, 3.6],
    ['M11–M13', 1.6, 0.72],
    ['M8–M10', 1.0, 0.16],
    ['M4–M7', 0.7, 0.076],
    ['M1–M3', 0.5, 0.028],
    ['M0', 0.4, 0.023],
  ];
  const W = 320, rowH = 30, top = 18;
  let y = top;
  let body = '';
  layers.forEach(([name, rel, pitch], i) => {
    const hh = rowH * (0.55 + rel * 0.25);
    const step = Math.max(6, 64 * Math.sqrt(pitch / 3.6) + 4);
    const wireW = step * 0.5;
    let wires = '';
    for (let x = 80; x < W - 8 - wireW; x += step) {
      wires += `<rect x="${x.toFixed(1)}" y="${(y + hh * 0.2).toFixed(1)}" width="${wireW.toFixed(1)}" height="${(hh * 0.6).toFixed(1)}" class="b-metal"/>`;
      if (i < layers.length - 1 && Math.round(x / step) % 3 === 0) wires += `<rect x="${(x + wireW * 0.3).toFixed(1)}" y="${(y + hh * 0.8).toFixed(1)}" width="${(wireW * 0.4).toFixed(1)}" height="${(hh * 0.25).toFixed(1)}" class="b-via"/>`;
    }
    body += `<rect x="78" y="${y.toFixed(1)}" width="${W - 84}" height="${hh.toFixed(1)}" class="b-ild"/>${wires}<text x="0" y="${(y + hh / 2 + 4).toFixed(1)}" class="b-t">${name}</text><text x="${W}" y="${(y + hh / 2 + 4).toFixed(1)}" class="b-t b-r">${pitch >= 1 ? pitch.toFixed(1) + ' µm' : Math.round(pitch * 1000) + ' nm'}</text>`;
    y += hh;
  });
  body += `<rect x="78" y="${y.toFixed(1)}" width="${W - 84}" height="16" class="b-feol"/><text x="0" y="${(y + 12).toFixed(1)}" class="b-t">transistors</text>`;
  y += 16;
  body += `<rect x="78" y="${y.toFixed(1)}" width="${W - 84}" height="26" class="b-si"/><text x="0" y="${(y + 16).toFixed(1)}" class="b-t">silicon</text>`;
  y += 34;
  const svg = `<svg viewBox="0 0 ${W + 44} ${y}" class="beol" role="img" aria-label="Metal stack of the die: sixteen copper layers from 23 nm pitch at the bottom to 3.6 micrometre pitch at the top, above the transistor layer and the silicon."><defs><pattern id="hs" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--ink)" stroke-width="1"/></pattern><pattern id="hm" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5M0 0H5" style="stroke:var(--ink)" stroke-width="0.8"/></pattern></defs><text x="0" y="10" class="b-t b-h">layer</text><text x="${W}" y="10" class="b-t b-h b-r">pitch</text>${body}</svg>`;
  return h('figure', { class: 'plot-fig', html: svg + '<figcaption>Flip-chip: in the package this stack faces down, toward the bumps. Sixteen copper layers, the finest 23 nm apart, carry signals and power across the die. Not to scale between layers.</figcaption>' });
}
