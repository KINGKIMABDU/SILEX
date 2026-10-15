// Chargers, plugs and cables, at the sizes of the real parts.
// Every plug is built pointing +x (the way it goes in), with its mating face at the origin.
import * as THREE from 'three';
import { M, Part, slab, ink, segments } from '../../core/ink';
import { stadium, rect } from './ports';

/** a turned part (boot, bead, pin) from x0, running +x (dir 1) or -x (dir -1), radii given at stations along it */
function turned(stations: [number, number][], fill: number, x0 = 0, width = 0.7, dir: 1 | -1 = 1): Part {
  const pts = stations.map(([x, r]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, 28);
  // the lathe turns about y: lay it along the axis (a rotation either way, so the faces keep facing out)
  g.rotateZ(dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  g.translate(x0, 0, 0);
  return new Part(g, { hull: true, threshold: 40, fill, width });
}

/** a shape (in the y–z plane) pushed along +x from x0 by len */
function prism(shape: THREE.Shape, len: number, fill: number, x0 = 0, width = 0.6): Part {
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 10 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return new Part(g, { threshold: 30, fill, width });
}

/** a rounded block centred on the x axis, spanning x0 … x0 - len */
function body(len: number, hgt: number, wid: number, r: number, fill: number, x0 = 0): Part {
  const g = slab(len, hgt, wid, r, Math.min(1.2, hgt / 5)).translate(x0 - len / 2, -hgt / 2, 0);
  return new Part(g, { hull: true, threshold: 40, fill, width: 0.9 });
}

export interface Plug {
  group: THREE.Group;
  /** the moulded body, the part that lights up when power flows */
  body: Part;
  parts: Part[];
  /** where the cable leaves, in plug space, and the radius of that cable */
  tail: THREE.Vector3;
  cableR: number;
  /** half the plug's height: how high its axis sits when it lies on the desk */
  rest: number;
}

/** USB Type-C plug: 8.25 × 2.4 mm shell, 6.65 mm long, in a 12.4 × 6.5 mm overmould with a strain-relief boot. */
export function usbcPlug(fill: number): Plug {
  const group = new THREE.Group();
  const shell = prism(stadium(8.25, 2.4), 6.65, M.tin, 0);
  const mould = body(21, 6.5, 12.4, 3.0, fill);
  const boot = turned([[0, 2.9], [3, 2.7], [9, 2.0], [12, 1.75]], fill, -21, 0.7, -1);
  const parts = [shell, mould, boot];
  parts.forEach((p) => group.add(p));
  return { group, body: mould, parts, tail: new THREE.Vector3(-33, 0, 0), cableR: 1.75, rest: 3.25 };
}

/** Slim rectangular DC plug of a 380 W gaming adapter: a 9 × 3.4 mm metal tip on a ribbed body. */
export function dcPlug(fill: number): Plug {
  const group = new THREE.Group();
  const tip = prism(rect(9.0, 3.4, 0.9), 9.0, M.tin, 0);
  const slot = prism(rect(5.6, 0.9, 0.2), 0.2, 0x1c1e21, 9.0, 0.4);
  const mould = body(30, 9.4, 14.6, 3.2, fill);
  const boot = turned([[0, 4.4], [4, 4.1], [14, 3.2], [18, 3.0]], fill, -30, 0.7, -1);
  // grip ribs across the top and bottom of the body
  const ribs: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -8 - i * 2.6;
    for (const y of [4.72, -4.72]) ribs.push(new THREE.Vector3(x, y, -5.4), new THREE.Vector3(x, y, 5.4));
  }
  group.add(segments(ribs, ink(0.5)));
  const parts = [tip, slot, mould, boot];
  parts.forEach((p) => group.add(p));
  return { group, body: mould, parts, tail: new THREE.Vector3(-48, 0, 0), cableR: 3.0, rest: 4.7 };
}

/** IEC 60320 C13 connector on a mains cord, as plugged into the adapter's C14 inlet. */
export function c13Plug(fill: number): Plug {
  const group = new THREE.Group();
  const mould = body(34, 16.5, 23.5, 3.5, fill, 0);
  const boot = turned([[0, 5.6], [5, 5.0], [14, 3.8], [18, 3.6]], fill, -34, 0.7, -1);
  const parts = [mould, boot];
  parts.forEach((p) => group.add(p));
  return { group, body: mould, parts, tail: new THREE.Vector3(-52, 0, 0), cableR: 3.6, rest: 8.25 };
}

/** A ferrite bead moulded onto a cable: it chokes high-frequency noise riding on the DC lead. */
export function ferrite(fill: number): Part {
  return turned([[-15, 3.1], [-13.5, 6.8], [-12, 7.4], [12, 7.4], [13.5, 6.8], [15, 3.1]], fill, 0, 0.8);
}

/** Europlug (CEE 7/16) pin: 4.0 mm across, 19 mm long, insulated for the first 10 mm. */
export function europin(): Part[] {
  // built pointing -x, out of the face it stands on
  const sleeve = turned([[0, 2.0], [10, 2.0]], 0x8b8f96, 0, 0.6, -1);
  const tip = turned([[10, 2.0], [17.6, 2.0], [18.6, 1.6], [19, 0.8], [19, 0.01]], M.tin, 0, 0.6, -1);
  return [sleeve, tip];
}

/** A moulded strain relief where a cable leaves a housing, pointing +x. */
export function relief(r0: number, r1: number, len: number, fill: number): Part {
  return turned([[0, r0], [len * 0.3, r0 * 0.92], [len, r1]], fill, 0, 0.7);
}

/**
 * A cable lying on the desk between two connectors. Each end leaves straight out of its boot, sags to
 * the desk within a few centimetres, and the run between is a lazy S, the way a real lead settles.
 */
export function cablePath(a: THREE.Vector3, da: THREE.Vector3, b: THREE.Vector3, db: THREE.Vector3, r: number, sway = 1, floor = 0): THREE.CatmullRomCurve3 {
  const desk = (p: THREE.Vector3) => p.setY(floor + r);
  const a1 = a.clone().addScaledVector(da, 10);
  const a2 = desk(a.clone().addScaledVector(da, 34));
  const b1 = b.clone().addScaledVector(db, 10);
  const b2 = desk(b.clone().addScaledVector(db, 34));
  const span = b2.clone().sub(a2);
  const len = span.length();
  const side = new THREE.Vector3(-span.z, 0, span.x).normalize().multiplyScalar(Math.min(40, len * 0.18) * sway);
  const m1 = desk(a2.clone().lerp(b2, 0.33).add(side));
  const m2 = desk(a2.clone().lerp(b2, 0.67).sub(side));
  const pts = len > 30 ? [a, a1, a2, m1, m2, b2, b1, b] : [a, a1, a2.lerp(b2, 0.5), b1, b];
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

export function cablePart(curve: THREE.CatmullRomCurve3, r: number, fill: number): Part {
  const n = Math.max(48, Math.round(curve.getLength() / 4));
  return new Part(new THREE.TubeGeometry(curve, n, r, 12, false), { hull: true, threshold: 70, fill, width: 0.9 });
}

/** The draughtsman's break: a cord that runs on past the sheet edge ends in a short S-shaped break line. */
export function breakMark(at: THREE.Vector3, dir: THREE.Vector3, r: number): THREE.Object3D {
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12 - 0.5;
    const p = at.clone().addScaledVector(side, t * r * 2.6).addScaledVector(dir, Math.sin(t * Math.PI * 2) * r * 0.5);
    pts.push(p);
  }
  const pairs: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length - 1; i++) pairs.push(pts[i], pts[i + 1]);
  return segments(pairs, ink(0.9));
}
