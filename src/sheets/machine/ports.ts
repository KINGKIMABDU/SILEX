// Port receptacles at their real outline sizes, as layered flat shapes on a side wall.
import * as THREE from 'three';
import { M, Part, fillMat, ink, polyline } from '../../core/ink';
import type { Port } from '../../core/specs';

export function stadium(w: number, hgt: number): THREE.Shape {
  const s = new THREE.Shape();
  const r = hgt / 2;
  s.moveTo(-w / 2 + r, -r);
  s.lineTo(w / 2 - r, -r);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, r);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

export function rect(w: number, hgt: number, r = 0.25): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -hgt / 2);
  s.lineTo(w / 2 - r, -hgt / 2);
  s.quadraticCurveTo(w / 2, -hgt / 2, w / 2, -hgt / 2 + r);
  s.lineTo(w / 2, hgt / 2 - r);
  s.quadraticCurveTo(w / 2, hgt / 2, w / 2 - r, hgt / 2);
  s.lineTo(-w / 2 + r, hgt / 2);
  s.quadraticCurveTo(-w / 2, hgt / 2, -w / 2, hgt / 2 - r);
  s.lineTo(-w / 2, -hgt / 2 + r);
  s.quadraticCurveTo(-w / 2, -hgt / 2, -w / 2 + r, -hgt / 2);
  return s;
}

function hdmi(): THREE.Shape {
  // type A receptacle opening: 14.0 × 4.55 mm, lower corners chamfered
  const s = new THREE.Shape();
  s.moveTo(-7, 2.275);
  s.lineTo(7, 2.275);
  s.lineTo(7, -0.6);
  s.lineTo(5.6, -2.275);
  s.lineTo(-5.6, -2.275);
  s.lineTo(-7, -0.6);
  s.lineTo(-7, 2.275);
  return s;
}

function rj45(): THREE.Shape {
  // drop-jaw opening: the lower flap folds down when a cable goes in
  const s = new THREE.Shape();
  s.moveTo(-7.9, 3.4);
  s.lineTo(7.9, 3.4);
  s.lineTo(7.9, -1.2);
  s.lineTo(3.4, -1.2);
  s.lineTo(3.4, -3.6);
  s.lineTo(-3.4, -3.6);
  s.lineTo(-3.4, -1.2);
  s.lineTo(-7.9, -1.2);
  s.lineTo(-7.9, 3.4);
  return s;
}

export function circleShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

/** Height of the port's centre above the base bottom, as a share of the local wall height. */
export const PORT_Y: Record<Port['kind'], number> = { usbc: 0.5, usba: 0.5, hdmi: 0.5, rj45: 0.5, sd: 0.42, microsd: 0.45, audio: 0.5, dc: 0.5, led: 0.62 };

/**
 * A depth punch: drawn after the wall and before everything else, it resets the depth buffer inside the
 * opening, so the cavity behind the wall shows through a real hole instead of a sticker on the surface.
 */
const punch = new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main() { gl_FragDepth = 1.0; }',
  colorWrite: false,
  depthWrite: true,
  depthFunc: THREE.AlwaysDepth,
});
/** render order of walls that have holes punched in them, and of the punches */
export const WALL_ORDER = -2;
const PUNCH_ORDER = -1;

/** A receptacle built facing +z with its rim at z = 0, recessed into -z. */
export interface Receptacle {
  parts: Part[];
  /** depth punches, one per opening, and the inked cut edges */
  masks: THREE.Object3D[];
  led?: Part;
}

export function recess(shape: THREE.Shape, depth: number, wall: number, back: number): { parts: Part[]; rim: THREE.Object3D; mask: THREE.Mesh } {
  // the inside of the opening: its walls seen from within, and the back face
  const sides = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  sides.translate(0, 0, -depth);
  const inner = new Part(sides, { width: 0.45, threshold: 50, fill: wall });
  inner.fill.material = fillMat(wall, THREE.BackSide);
  const floor = new Part(new THREE.ShapeGeometry(shape, 12), { width: 0.4, threshold: 1, fill: back, edges: false });
  floor.position.z = -depth + 0.02;
  // the cut edge of the opening, in full ink
  const rim = polyline(shape.getPoints(16).map((q) => new THREE.Vector3(q.x, q.y, 0.03)), ink(0.9), true);
  const mask = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), punch);
  mask.position.z = 0.01;
  mask.renderOrder = PUNCH_ORDER;
  return { parts: [inner, floor], rim, mask };
}

/** a block inside the opening: a tongue, a contact carrier, a blade */
function block(w: number, hgt: number, len: number, y: number, z: number, fill: number, width = 0.5): Part {
  const p = new Part(new THREE.BoxGeometry(w, hgt, len), { width, threshold: 30, fill });
  p.position.set(0, y, z - len / 2);
  return p;
}

/** a row of contact springs, drawn as short gold bars on a face */
function contacts(n: number, pitch: number, w: number, len: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const c = new Part(new THREE.BoxGeometry(w, 0.08, len), { width: 0.3, threshold: 30, fill: M.gold, edges: false });
    c.position.set((i - (n - 1) / 2) * pitch, y, z - len / 2);
    out.push(c);
  }
  return out;
}

/** Receptacles at their real opening sizes and depths, from the connector standards. */
export function portParts(kind: Port['kind']): Receptacle {
  const shell = M.tin, dark = 0x24272b;
  switch (kind) {
    case 'usbc': {
      // USB Type-C: 8.34 × 2.56 mm opening, 6.69 mm wide tongue 0.7 mm thick, 12 contacts a side at 0.5 mm
      const r = recess(stadium(8.34, 2.56), 6.2, shell, dark);
      const tongue = block(6.69, 0.7, 4.4, 0, -1.4, 0x2b2e33);
      return { parts: [...r.parts, tongue, ...contacts(12, 0.5, 0.25, 3.2, 0.36, -1.6), ...contacts(12, 0.5, 0.25, 3.2, -0.36, -1.6)], masks: [r.mask, r.rim] };
    }
    case 'usba': {
      // USB-A 3.x: 12.5 × 5.12 mm, the tongue fills the upper half and carries the contacts underneath
      const r = recess(rect(12.5, 5.12, 0.3), 11.5, shell, dark);
      const tongue = block(11.0, 1.84, 9.5, 0.9, -1.0, 0x2b2e33);
      return { parts: [...r.parts, tongue, ...contacts(5, 2.0, 0.9, 4, -0.05, -1.6)], masks: [r.mask, r.rim] };
    }
    case 'hdmi': {
      // HDMI type A: 14.0 × 4.55 mm with chamfered lower corners, 19 contacts on a 10.4 mm tongue
      const r = recess(hdmi(), 9.0, shell, dark);
      const tongue = block(10.4, 1.2, 7.0, 0.35, -1.4, 0x2b2e33);
      return { parts: [...r.parts, tongue, ...contacts(10, 1.0, 0.45, 4, 0.98, -2), ...contacts(9, 1.0, 0.45, 4, -0.28, -2)], masks: [r.mask, r.rim] };
    }
    case 'rj45': {
      // RJ45 with a drop jaw: eight spring contacts hang from the roof at 1.02 mm pitch
      const r = recess(rj45(), 14, dark, 0x1c1e21);
      return { parts: [...r.parts, ...contacts(8, 1.02, 0.45, 5, 3.3, -3)], masks: [r.mask, r.rim] };
    }
    case 'sd': {
      const r = recess(rect(24.4, 2.3, 0.4), 3, dark, 0x1c1e21);
      return { parts: r.parts, masks: [r.mask, r.rim] };
    }
    case 'microsd': {
      // a spring-loaded slot: shallow, dark, with the card guide inside
      const r = recess(rect(11.6, 1.3, 0.5), 2.5, dark, 0x1c1e21);
      return { parts: r.parts, masks: [r.mask, r.rim] };
    }
    case 'audio': {
      // 3.5 mm TRRS: a 3.6 mm bore inside a 5.8 mm bezel
      const bezel = new Part(new THREE.RingGeometry(1.8, 2.9, 32), { width: 0.6, threshold: 1, fill: M.aluDeep });
      bezel.position.z = 0.02;
      const r = recess(circleShape(1.8), 14, dark, 0x1c1e21);
      return { parts: [bezel, ...r.parts], masks: [r.mask, r.rim] };
    }
    case 'dc': {
      // slim rectangular DC jack: 9.2 × 3.6 mm, a centre blade carrying the pins on both faces
      const r = recess(rect(9.2, 3.6, 1.0), 9.0, dark, 0x1c1e21);
      const blade = block(5.4, 0.8, 6.0, 0, -1.6, M.plastic);
      return { parts: [...r.parts, blade, ...contacts(4, 1.2, 0.6, 4.5, 0.42, -2), ...contacts(4, 1.2, 0.6, 4.5, -0.42, -2)], masks: [r.mask, r.rim] };
    }
    case 'led': {
      const led = new Part(new THREE.CircleGeometry(0.7, 20), { width: 0.6, threshold: 1, fill: M.white });
      led.position.z = 0.02;
      return { parts: [led], masks: [], led };
    }
  }
}
