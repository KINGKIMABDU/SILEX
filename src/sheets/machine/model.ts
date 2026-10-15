// The two machines, modelled from measured dimensions and review photographs of their reference classes.
import * as THREE from 'three';
import { C, M, Part, slab, cyl, v, polyline, segments, ink, smooth, basicMat } from '../../core/ink';
import { tc, onTheme } from '../../core/theme';
import { SPEC, type Port } from '../../core/specs';
import type { Arch } from '../../core/state';
import { layout, buildKeys, type BuiltKey } from './keyboard';
import { portParts, stadium, rect, recess, PORT_Y, WALL_ORDER } from './ports';
import { usbcPlug, dcPlug, c13Plug, ferrite, europin, relief, cablePath, cablePart, breakMark, type Plug } from './power';

const LAV = 0xd3d4df; // lavender-silver anodised aluminium
const LAV_DEEP = 0xbfc1cd;
const OFF_BLACK = 0x4c5057; // off-black chassis, drawn as graphite so the ink still reads
const OFF_DEEP = 0x3b3f45;

export class Machine {
  group = new THREE.Group();
  lid = new THREE.Group();
  deck = new THREE.Group();
  keys = new Map<string, BuiltKey>();
  legendMat!: THREE.MeshBasicMaterial;
  screenTex: THREE.CanvasTexture;
  screenCanvas: HTMLCanvasElement;
  parts: Record<string, Part[]> = {};
  anchors: Record<string, THREE.Object3D> = {};
  portAt = new Map<Port, THREE.Vector3>();
  chargeLed?: Part;
  lightBar: Part[] = [];
  matrix?: THREE.InstancedMesh;
  matrixPts: THREE.Vector2[] = [];
  matrixHoles = 0;
  charger = new THREE.Group();
  chargerLed!: Part;
  cable?: Part;
  /** the plug's moulded body (it lights up when power flows) and the whole plug */
  plug!: Part;
  plugKit!: Plug;
  plugPort!: Port;
  ferrite?: Part;
  /** where the lead leaves the charger end, and which way, in machine space */
  farEnd!: THREE.Vector3;
  farDir!: THREE.Vector3;
  /** lid closed angle offset (the gaming deck slopes up towards the hinge) */
  lidRest = 0;
  deckY: (z: number) => number;
  centre = new THREE.Vector3();
  /** height of the desk under the feet */
  floor = 0;

  constructor(public arch: Arch) {
    const s = SPEC[arch];
    const arm = arch === 'arm';
    const W = s.w, D = s.d;
    const add = (key: string, p: Part, parent: THREE.Object3D = this.group) => {
      (this.parts[key] ??= []).push(p);
      parent.add(p);
      return p;
    };
    const anchor = (key: string, x: number, y: number, z: number, parent: THREE.Object3D = this.group) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.anchors[key] = o;
    };

    // ---------- body ----------
    let pivotY: number, pivotZ: number, lidLen: number, wallH: (z: number) => number;
    if (arm) {
      // the quoted 12.3 mm includes the 0.8 mm feet
      const baseH = s.h - s.lidT - 0.8;
      add('base', new Part(slab(W, baseH, D, 7, 1.6), { hull: true, threshold: 40, fill: LAV }));
      this.deckY = () => baseH;
      wallH = () => baseH;
      this.deck.position.set(0, baseH, 0);
      pivotY = baseH - 0.4;
      pivotZ = -D / 2 + 4.4;
      lidLen = D - 0.8;
    } else {
      // side profile: 14.6 mm deck at the front rising to 19 mm at the hinge, a rear bar 29.2 mm tall behind it;
      // with the 1.6 mm feet and the closed lid that is the quoted 22.8 mm front and 30.8 mm rear
      const fz = D / 2, hz = -D / 2 + 30;
      const prof: [number, number][] = [
        [fz, 0], [fz, 13.0], [fz - 1.6, 14.6], [hz, 19.0], [hz - 3, 19.0], [-D / 2 + 23, 28.4], [-D / 2 + 1.8, 29.2], [-D / 2, 27.4], [-D / 2, 0],
      ];
      const shape = new THREE.Shape();
      prof.forEach(([zz, yy], i) => (i ? shape.lineTo(zz, yy) : shape.moveTo(zz, yy)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: W - 4, bevelEnabled: true, bevelSize: 1.6, bevelOffset: -1.6, bevelThickness: 2, bevelSegments: 3, curveSegments: 4 });
      g.rotateY(-Math.PI / 2);
      g.translate((W - 4) / 2, 0, 0);
      add('base', new Part(smooth(g), { hull: true, threshold: 25, fill: OFF_BLACK }));
      const slope = Math.atan2(19.0 - 14.6, fz - 1.6 - hz);
      this.deckY = (z: number) => 14.6 + Math.max(0, Math.min(1, (fz - 1.6 - z) / (fz - 1.6 - hz))) * 4.4;
      wallH = (z: number) => (z < -D / 2 + 26 ? 27 : this.deckY(z));
      this.deck.position.set(0, 14.6, fz - 1.6);
      this.deck.rotation.x = slope;
      pivotY = 21.0;
      pivotZ = -D / 2 + 28;
      lidLen = D - 29;
      this.lidRest = slope;
    }
    // the base is drawn first so the port openings can be punched through it
    this.parts.base[0].traverse((o) => (o.renderOrder = WALL_ORDER));
    this.group.add(this.deck);
    // deck-local placement: z measured in world, converted to the deck's frame
    const dz = (zWorld: number) => (arm ? zWorld : zWorld - (D / 2 - 1.6) / Math.cos(this.deck.rotation.x));

    // ---------- keyboard ----------
    const kb = layout(arm ? 'ultrabook' : 'gaming');
    const kbZ0 = arm ? -D / 2 + 22 : -D / 2 + 38;
    const kbX0 = -kb.w / 2;
    const well = add('keys', new Part(slab(kb.w + 6, 0.25, kb.d + 6, 3), { width: 0.8, threshold: 40, fill: arm ? LAV_DEEP : OFF_DEEP }), this.deck);
    well.position.set(0, -0.2, dz(kbZ0 + kb.d / 2));
    const built = buildKeys(this.deck, kb.keys, kbX0, -0.1, dz(kbZ0), s.keyTravel + 0.3, arm ? 0x8b8f99 : 0x34373c, arm ? M.white : 0xc9ccd2);
    this.keys = built.keys;
    this.legendMat = built.legendMat;
    this.parts.keys = [...(this.parts.keys ?? []), ...built.parts];
    this.parts.power = [this.keys.get('Power')!.part];
    const pk = this.keys.get('Power')!.part.position;
    anchor('power', pk.x, 0.9, pk.z, this.deck);
    anchor('keys', kbX0 + kb.w * 0.36, 0.9, dz(kbZ0 + kb.d * 0.5), this.deck);

    // ---------- trackpad ----------
    const mainW = 14.5 * (arm ? 18 : 18.9);
    const tpW = arm ? 152 : 150, tpD = arm ? 100 : 92;
    const tpX = arm ? kbX0 + mainW / 2 : 0;
    const tp = add('trackpad', new Part(slab(tpW, 0.3, tpD, 4), { width: 0.9, threshold: 40, fill: arm ? 0xc8c9d5 : 0x3f434a }), this.deck);
    tp.position.set(tpX, -0.15, dz(D / 2 - 10 - tpD / 2));
    anchor('trackpad', tpX + tpW / 2 - 12, 0.2, dz(D / 2 - 22), this.deck);

    // ---------- hinge ----------
    if (arm) {
      // one barrel across the back between two inset ends, its top flush with the deck
      const hr = 3.2;
      const hinge = add('hinge', new Part(cyl(hr, W - 76, 36).rotateZ(Math.PI / 2), { hull: true, threshold: 40, width: 1, fill: LAV_DEEP }));
      hinge.position.set(0, wallH(0) - hr + 0.05, -D / 2 + hr - 0.2);
      anchor('hinge', W / 2 - 60, wallH(0), -D / 2 + 2);
    } else {
      // two knuckles at the ends of the lid's chin, in gunmetal, and the channel the chin drops into
      for (const sx of [-1, 1]) {
        const kn = add('hinge', new Part(cyl(5.4, 22, 32).rotateZ(Math.PI / 2), { hull: true, threshold: 40, width: 1, fill: M.aluDeep }));
        kn.position.set(sx * (W / 2 - 25), pivotY, pivotZ);
      }
      const chan = add('hinge', new Part(slab(W - 72, 0.4, 10, 2), { width: 0.6, threshold: 40, fill: 0x1f2226 }));
      chan.position.set(0, 19.0, pivotZ + 5);
      anchor('hinge', W / 2 - 25, pivotY + 5, pivotZ);
    }

    // ---------- ports and side details ----------
    const placeSide = (ports: Port[], side: -1 | 1) => {
      for (const port of ports) {
        const { parts, led, masks } = portParts(port.kind);
        const g = new THREE.Group();
        parts.forEach((p) => {
          g.add(p);
          (this.parts.ports ??= []).push(p);
        });
        masks.forEach((m) => g.add(m));
        g.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        const z = -D / 2 + port.z;
        const y = arm ? wallH(z) * PORT_Y[port.kind] : 3.2 + (this.deckY(z) - 3.2) * 0.48;
        g.position.set(side * (W / 2 + 0.05), y, z);
        this.group.add(g);
        this.portAt.set(port, new THREE.Vector3(side * (W / 2), y, z));
        if (led) this.chargeLed = led;
      }
    };
    placeSide(s.left, -1);
    placeSide(s.right, 1);
    const firstL = s.left[0], lastR = s.right[s.right.length - 1];
    anchor('portsL', -W / 2, this.portAt.get(firstL)!.y, this.portAt.get(firstL)!.z);
    anchor('portsR', W / 2, this.portAt.get(lastR)!.y, this.portAt.get(lastR)!.z);
    const sideSlot = (side: -1 | 1, zc: number, len: number, y: number, hh: number) => {
      const p = new Part(new THREE.ShapeGeometry(stadium(len, hh), 12), { width: 0.6, threshold: 1, fill: arm ? 0x6f7380 : 0x22252a });
      p.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      p.position.set(side * (W / 2 + 0.05), y, zc);
      add('vents', p);
    };
    if (arm) {
      // speaker grooves along both flanks, 100–212 mm from the rear edge
      sideSlot(-1, -D / 2 + 156, 112, wallH(0) * 0.36, 1.2);
      sideSlot(1, -D / 2 + 150, 128, wallH(0) * 0.36, 1.2);
    } else {
      // the 2025 chassis has no side vents: all of the exhaust leaves through windows in the rear bar
      const winW = 21, winH = 8.5, gap = 3.6, per = 6;
      for (const sx of [-1, 1])
        for (let i = 0; i < per; i++) {
          const x = sx * (17 + winW / 2 + i * (winW + gap));
          const r = recess(rect(winW, winH, 1.6), 7, 0x2a2d32, 0x1c1e21);
          const g = new THREE.Group();
          r.parts.forEach((q) => {
            g.add(q);
            (this.parts.exhaust ??= []).push(q);
          });
          g.add(r.mask, r.rim);
          // the fin stack seen through the window, 1.1 mm pitch
          const fins: THREE.Vector3[] = [];
          for (let fx = -winW / 2 + 1; fx < winW / 2 - 0.5; fx += 1.1) fins.push(v(fx, -winH / 2 + 0.4, -6.9), v(fx, winH / 2 - 0.4, -6.9));
          g.add(segments(fins, ink(0.45, C.grey)));
          g.rotation.y = Math.PI;
          g.position.set(x, 16.5, -D / 2 - 0.05);
          this.group.add(g);
        }
      anchor('vent', 17 + winW * 2, 16.5, -D / 2);
      // a diffused LED strip that wraps the whole base, just above the desk
      const ring = new THREE.Shape();
      const ox = W / 2 + 0.4, oz = D / 2 + 0.4, ir = 2.2;
      ring.moveTo(-ox + 3, -oz);
      ring.lineTo(ox - 3, -oz);
      ring.quadraticCurveTo(ox, -oz, ox, -oz + 3);
      ring.lineTo(ox, oz - 3);
      ring.quadraticCurveTo(ox, oz, ox - 3, oz);
      ring.lineTo(-ox + 3, oz);
      ring.quadraticCurveTo(-ox, oz, -ox, oz - 3);
      ring.lineTo(-ox, -oz + 3);
      ring.quadraticCurveTo(-ox, -oz, -ox + 3, -oz);
      const hole = new THREE.Path();
      hole.moveTo(-ox + ir, -oz + ir);
      hole.lineTo(-ox + ir, oz - ir);
      hole.lineTo(ox - ir, oz - ir);
      hole.lineTo(ox - ir, -oz + ir);
      hole.lineTo(-ox + ir, -oz + ir);
      ring.holes.push(hole);
      const sg = new THREE.ExtrudeGeometry(ring, { depth: 1.4, bevelEnabled: false, curveSegments: 4 });
      sg.rotateX(Math.PI / 2);
      sg.translate(0, 1.9, 0);
      const strip = new Part(sg, { width: 0.6, threshold: 40, fill: M.rgb });
      this.group.add(strip);
      this.lightBar.push(strip);
      anchor('lightbar', W / 2 - 60, 1.3, D / 2 + 0.4);
    }
    anchor('vents', arm ? -W / 2 : W / 2, arm ? wallH(0) * 0.36 : 4.2, arm ? -D / 2 + 156 : -D / 2 + 100);

    // ---------- underside ----------
    if (arm) {
      // four round rubber feet near the corners
      for (const fx of [-1, 1])
        for (const fz of [-1, 1]) {
          const foot = add('feet', new Part(cyl(6.2, 0.8, 28), { width: 0.7, hull: true, threshold: 40, fill: M.rubber }));
          foot.position.set(fx * (W / 2 - 22), -0.4, fz * (D / 2 - 20));
        }
      // the intake: a field of 1 mm holes on a 2.2 mm grid across the rear third
      const holes: THREE.Vector3[] = [];
      for (let x = -132; x <= 132; x += 2.2) for (let z = -D / 2 + 26; z <= -D / 2 + 64; z += 2.2) holes.push(v(x, -0.03, z));
      const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 8).rotateX(Math.PI / 2), basicMat(0x6f7380), holes.length);
      const mm = new THREE.Matrix4();
      holes.forEach((q, k) => dots.setMatrixAt(k, mm.makeTranslation(q.x, q.y, q.z)));
      this.group.add(dots);
      this.group.add(polyline([v(-134, -0.03, -D / 2 + 24), v(134, -0.03, -D / 2 + 24), v(134, -0.03, -D / 2 + 66), v(-134, -0.03, -D / 2 + 66)], ink(0.5), true));
      // the hinge cover, seen across the back of the bottom between the rear feet
      const cover = add('hinge', new Part(slab(W - 76, 0.3, 6.5, 2), { width: 0.7, threshold: 40, fill: LAV_DEEP }));
      cover.position.set(0, -0.3, -D / 2 + 3.4);
    } else {
      for (const fz of [-1, 1]) {
        const foot = add('feet', new Part(slab(W - 56, 1.6, 7, 3.5), { width: 0.7, hull: true, threshold: 40, fill: M.rubber }));
        foot.position.set(0, -1.6, fz * (D / 2 - 14));
      }
      // the bottom flap: a broad field of straight intake slots over the fans, row on row
      const u: THREE.Vector3[] = [];
      for (let row = 0; row < 9; row++) {
        const z0 = -D / 2 + 28 + row * 14.5;
        const inset = row < 7 ? 22 : 40;
        for (let x = -W / 2 + inset; x <= W / 2 - inset; x += 3.4) u.push(v(x, -0.03, z0), v(x, -0.03, z0 + 11));
      }
      this.group.add(segments(u, ink(0.55)));
      // the slider that unlocks the bottom flap without tools
      const latch = add('feet', new Part(slab(34, 0.9, 8, 3), { width: 0.8, hull: true, threshold: 40, fill: OFF_DEEP }));
      latch.position.set(0, -0.9, D / 2 - 26);
      const knob = add('feet', new Part(slab(8, 1.6, 5, 1.5), { width: 0.7, hull: true, threshold: 40, fill: M.aluDeep }));
      knob.position.set(-8, -1.6, D / 2 - 26);
    }

    // ---------- lid ----------
    this.lid.position.set(0, pivotY, pivotZ);
    this.group.add(this.lid);
    const lr = arm ? 7 : 5;
    const lidBack = arm ? -4 : -1;
    add('lid', new Part(slab(W, s.lidT, lidLen, lr, arm ? 0.8 : 1).translate(0, 0, lidBack + lidLen / 2), { hull: true, threshold: 40, fill: arm ? LAV : OFF_BLACK }), this.lid);
    add('lid', new Part(slab(W - 2.4, 0.3, lidLen - 2.4, lr - 1).translate(0, -0.3, lidBack + lidLen / 2), { width: 0.7, threshold: 40, fill: M.bezel }), this.lid);
    // 16-inch 16:10 active area: 344.6 × 215.4 mm
    const aw = 344.6, ah = 215.4;
    const top = arm ? 6.2 : 7.0;
    const zTop = lidBack + lidLen - top;
    this.screenCanvas = document.createElement('canvas');
    // 16:10 like the panel; 1440 × 900 keeps the on-screen text readable when you zoom in
    this.screenCanvas.width = 1440;
    this.screenCanvas.height = 900;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 8;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.screenTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    screen.position.set(0, -0.35, zTop - ah / 2);
    this.lid.add(screen);
    this.lid.add(polyline([v(-aw / 2, -0.37, zTop - ah), v(aw / 2, -0.37, zTop - ah), v(aw / 2, -0.37, zTop), v(-aw / 2, -0.37, zTop)], ink(0.6), true));
    anchor('display', aw / 2 - 40, -0.35, zTop - ah * 0.3, this.lid);
    // camera module in the top bezel
    const camZ = lidBack + lidLen - top / 2;
    const lens = add('camera', new Part(cyl(1.3, 0.3, 24), { width: 0.7, hull: true, threshold: 40, fill: M.glass }), this.lid);
    lens.position.set(0, -0.45, camZ);
    const extras: [number, number][] = arm ? [[7, 0.5]] : [[-7, 0.75], [7, 0.75], [12, 0.45]];
    for (const [cx, rr] of extras) {
      const d = add('camera', new Part(cyl(rr, 0.3, 16), { width: 0.55, hull: true, threshold: 40, fill: M.plastic }), this.lid);
      d.position.set(cx, -0.45, camZ);
    }
    anchor('camera', 0, -0.45, camZ, this.lid);
    if (!arm) {
      // LED dot matrix: 8,353 milled holes on a 2 mm hexagonal pitch in a diagonal band, with an LED behind
      // 810 of them (the maker's figures). The band is widened until it holds exactly that many holes.
      const HOLES = 8353, LEDS = 810, P = 2.0;
      const inBand = (x: number, z: number, half: number) => {
        const band = x * 0.62 + (z - lidLen * 0.5) * 1.0 + 30;
        return Math.abs(band) < half && Math.abs(x) < W / 2 - 14 && z > lidBack + 14 && z < lidBack + lidLen - 14;
      };
      const grid: { x: number; z: number; i: number; j: number }[] = [];
      for (let j = 0; j * P * 0.866 < lidLen; j++)
        for (let i = 0; i * P < W; i++) grid.push({ x: -W / 2 + i * P + (j % 2) * P * 0.5, z: lidBack + j * P * 0.866, i, j });
      let lo = 5, hi = 200;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (grid.filter((q) => inBand(q.x, q.z, mid)).length < HOLES) lo = mid;
        else hi = mid;
      }
      const holes = grid.filter((q) => inBand(q.x, q.z, hi)).slice(0, HOLES);
      // every third hole in every third row has an LED; the ones nearest the band edge go first
      const centre = (q: { x: number; z: number }) => Math.abs(q.x * 0.62 + (q.z - lidLen * 0.5) + 30);
      const leds = holes.filter((q) => q.i % 3 === 0 && q.j % 3 === 0).sort((a, b) => centre(a) - centre(b)).slice(0, LEDS);
      const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.34, 8).rotateX(-Math.PI / 2), basicMat(0x26292d), holes.length);
      const mm = new THREE.Matrix4();
      holes.forEach((q, k) => dots.setMatrixAt(k, mm.makeTranslation(q.x, s.lidT + 0.02, q.z)));
      this.lid.add(dots);
      this.matrixHoles = holes.length;
      const pts = leds.map((q) => new THREE.Vector2(q.x, q.z));
      this.matrixPts = pts;
      const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), pts.length);
      pts.forEach((p, k) => {
        mm.makeTranslation(p.x, s.lidT + 0.03, p.y);
        im.setMatrixAt(k, mm);
        im.setColorAt(k, new THREE.Color(tc(OFF_DEEP)));
      });
      this.lid.add(im);
      this.matrix = im;
      // the lid is two-tone: a finely textured field on one side of a diagonal, plain on the other
      const split = (x: number) => lidLen * 0.5 - 30 - x * 0.62 + hi + 6;
      const field = new THREE.Shape();
      // drawn in (x, -z) so that turning it flat leaves it facing out of the lid
      field.moveTo(-W / 2 + 4, -(lidBack + 4));
      field.lineTo(-W / 2 + 4, -Math.min(lidBack + lidLen - 4, split(-W / 2 + 4)));
      field.lineTo(W / 2 - 4, -Math.max(lidBack + 4, split(W / 2 - 4)));
      field.lineTo(W / 2 - 4, -(lidBack + 4));
      const fg = new THREE.ShapeGeometry(field).rotateX(-Math.PI / 2);
      const skin = new Part(fg, { width: 0.6, threshold: 1, fill: 0x45494f });
      skin.position.y = s.lidT + 0.01;
      this.lid.add(skin);
      anchor('matrix', -W * 0.12, s.lidT, lidLen * 0.42, this.lid);
    }

    // ---------- charger, plugs and cables ----------
    const c = s.charger;
    const [cl, ch, cw] = c.size;
    // the desk: the plane the machine's feet stand on
    this.floor = arm ? -0.8 : -1.6;
    const cFill = arm ? M.white : 0x2e3136;
    const kit = <T extends Part>(p: T) => {
      (this.parts.charger ??= []).push(p);
      return p;
    };
    let farEnd: THREE.Vector3, farDir: THREE.Vector3;
    if (arm) {
      // a 65 W EU wall charger lying on the desk: Europlug pins from one face, a USB-C socket in the other
      const housing = kit(new Part(slab(cl, ch, cw, 6, 2.5), { hull: true, threshold: 40, fill: cFill }));
      housing.traverse((o) => (o.renderOrder = WALL_ORDER));
      this.charger.add(housing);
      for (const pz of [-9.5, 9.5])
        for (const pin of europin()) {
          pin.position.set(-cl / 2, ch / 2, pz);
          this.charger.add(kit(pin));
        }
      const sock = portParts('usbc');
      const sg = new THREE.Group();
      sock.parts.forEach((q) => sg.add(q));
      sock.masks.forEach((q) => sg.add(q));
      sg.rotation.y = Math.PI / 2;
      sg.position.set(cl / 2 + 0.05, ch / 2, 0);
      this.charger.add(sg);
      // the far end of the lead, plugged into the charger
      const far = usbcPlug(cFill);
      far.group.rotation.y = Math.PI;
      far.group.position.set(cl / 2, ch / 2, 0);
      far.parts.forEach(kit);
      this.charger.add(far.group);
      farEnd = new THREE.Vector3(cl / 2 - far.tail.x, ch / 2, 0);
      farDir = new THREE.Vector3(1, 0, 0);
      this.charger.position.set(-W / 2 - 150, this.floor, -D / 2 + 158);
      this.plugPort = s.left[1];
      this.plugKit = usbcPlug(cFill);
    } else {
      // the 380 W brick: C14 mains inlet at one end, the DC lead leaving the other through a moulded relief
      const brick = kit(new Part(slab(cl, ch, cw, 9, 3), { hull: true, threshold: 40, fill: cFill }));
      this.charger.add(brick);
      // parting line where the two shells of the case meet
      const seam: THREE.Vector3[] = [];
      const sh = new THREE.Shape();
      const rr = 9, hx = cl / 2, hz = cw / 2;
      sh.moveTo(-hx + rr, -hz);
      sh.lineTo(hx - rr, -hz);
      sh.quadraticCurveTo(hx, -hz, hx, -hz + rr);
      sh.lineTo(hx, hz - rr);
      sh.quadraticCurveTo(hx, hz, hx - rr, hz);
      sh.lineTo(-hx + rr, hz);
      sh.quadraticCurveTo(-hx, hz, -hx, hz - rr);
      sh.lineTo(-hx, -hz + rr);
      sh.quadraticCurveTo(-hx, -hz, -hx + rr, -hz);
      sh.getPoints(8).forEach((q) => seam.push(new THREE.Vector3(q.x * 1.0006, ch * 0.42, q.y * 1.0012)));
      this.charger.add(polyline(seam, ink(0.5), true));
      const rel = kit(relief(6.2, 3.0, 22, cFill));
      rel.position.set(cl / 2, ch / 2, 0);
      this.charger.add(rel);
      farEnd = new THREE.Vector3(cl / 2 + 22, ch / 2, 0);
      farDir = new THREE.Vector3(1, 0, 0);
      // mains: a C13 connector in the inlet, its cord running off the sheet
      const mains = c13Plug(0x26292d);
      mains.group.position.set(-cl / 2, ch / 2, 0);
      mains.parts.forEach(kit);
      this.charger.add(mains.group);
      const t0 = new THREE.Vector3(-cl / 2 + mains.tail.x, ch / 2, 0);
      const cord = new THREE.CatmullRomCurve3(
        [t0, t0.clone().add(v(-10, 0, 0)), v(t0.x - 40, mains.cableR, 4), v(t0.x - 85, mains.cableR, 22), v(t0.x - 125, mains.cableR, 12)],
        false,
        'centripetal',
      );
      this.charger.add(kit(cablePart(cord, mains.cableR, 0x26292d)));
      const endT = cord.getTangentAt(1);
      this.charger.add(breakMark(cord.getPointAt(1), endT, mains.cableR));
      // behind the machine's rear-left corner, DC end facing forward: the lead runs in an easy S to the port
      // and never doubles back over the brick, and the mains cord trails away behind
      this.charger.position.set(-W / 2 - 80, this.floor, -D / 2 - 150);
      this.charger.rotation.y = -Math.PI / 2;
      this.plugPort = s.left[0];
      this.plugKit = dcPlug(cFill);
      this.ferrite = kit(ferrite(cFill));
      this.group.add(this.ferrite);
    }
    this.charger.updateMatrix();
    this.farEnd = farEnd.applyMatrix4(this.charger.matrix);
    this.farDir = farDir.transformDirection(this.charger.matrix);
    this.chargerLed = new Part(cyl(1.0, 0.3, 16), { width: 0.6, hull: true, threshold: 40, fill: M.white });
    this.chargerLed.position.set(cl / 2 - 9, ch + 0.15, cw / 2 - 9);
    this.charger.add(this.chargerLed);
    this.group.add(this.charger);
    const ca = new THREE.Object3D();
    ca.position.set(0, ch, 0);
    this.charger.add(ca);
    this.anchors.charger = ca;
    this.plug = this.plugKit.body;
    this.plugKit.parts.forEach(kit);
    this.group.add(this.plugKit.group);

    this.centre.set(0, this.deckY(0) / 2, 0);
    onTheme(() => this.paintMatrix(0, false));
  }

  setLid(deg: number) {
    this.lid.rotation.x = this.lidRest - THREE.MathUtils.degToRad(deg);
  }

  /** Move the plug between the desk and its port, and lay the lead from it back to the charger. */
  setPlug(amount: number) {
    const k = this.plugKit;
    const port = this.portAt.get(this.plugPort)!;
    // on the desk: lying flat a hand's width from the port, turned a little towards you
    const out = new THREE.Vector3(port.x - 44, this.floor + k.rest, port.z + 52);
    const yaw0 = THREE.MathUtils.degToRad(24);
    // the last few millimetres go straight in along the port's axis
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    const glide = Math.min(1, a / 0.82), seat = Math.max(0, (a - 0.82) / 0.18);
    const near = new THREE.Vector3(port.x - 9, port.y, port.z);
    const pos = out.clone().lerp(near, glide);
    pos.y += Math.sin(glide * Math.PI) * 16;
    pos.x += seat * 9;
    const g = k.group;
    g.position.copy(pos);
    g.rotation.set(0, yaw0 * (1 - glide), 0);
    g.updateMatrix();
    const tail = k.tail.clone().applyMatrix4(g.matrix);
    const dir = new THREE.Vector3(-1, 0, 0).transformDirection(g.matrix);
    const curve = cablePath(tail, dir, this.farEnd, this.farDir, k.cableR, this.arch === 'arm' ? 1 : -0.8, this.floor);
    if (this.cable) {
      this.group.remove(this.cable);
      this.cable.fill.geometry.dispose();
      this.parts.charger = this.parts.charger.filter((p) => p !== this.cable);
    }
    this.cable = new Part(new THREE.TubeGeometry(curve, Math.max(48, Math.round(curve.getLength() / 4)), k.cableR, 12, false), { hull: true, threshold: 70, fill: this.arch === 'arm' ? M.white : 0x2e3136, width: 0.9 });
    this.group.add(this.cable);
    this.parts.charger.push(this.cable);
    if (this.ferrite) {
      // the bead sits about 9 cm along the lead from the plug
      const u = Math.min(0.5, 90 / curve.getLength());
      this.ferrite.position.copy(curve.getPointAt(u));
      this.ferrite.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), curve.getTangentAt(u));
    }
  }

  /** the lid's LED matrix: a slow diagonal wave when the lighting is on */
  paintMatrix(t: number, on: boolean) {
    const im = this.matrix;
    if (!im) return;
    const col = new THREE.Color();
    const off = tc(OFF_DEEP), lit = tc(C.red);
    this.matrixPts.forEach((p, k) => {
      const wave = Math.sin(p.x * 0.05 + p.y * 0.03 - t * 2.4);
      col.setHex(on && wave > 0.35 ? lit : off);
      im.setColorAt(k, col);
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

