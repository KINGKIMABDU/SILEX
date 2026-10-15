import * as THREE from 'three';
import type { Part } from './ink';

/** A reference numeral: the patent-drawing way of naming a part. */
export interface Ref {
  n: number | string;
  name: string;
  /** what it does, one or two sentences */
  text: string;
  facts?: [string, string][];
  /** object the leader points at */
  target: THREE.Object3D;
  /** local offset on the target for the leader tip */
  at?: THREE.Vector3;
  /** screen offset of the numeral from the tip, px */
  off: [number, number];
  /** parts that light up when this ref is selected */
  parts?: Part[];
  /** this part continues on another sheet */
  see?: number;
  hidden?: boolean;
  /** only shown in Grind mode */
  grind?: boolean;
}

export interface Dim {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** parent whose local space a/b live in */
  space: THREE.Object3D;
  /** perpendicular screen offset px */
  off: number;
  text: () => string;
  hidden?: boolean;
}

/** Plain lettering on the drawing (pin names, values), optionally clickable. */
export interface Tag {
  target: THREE.Object3D;
  at?: THREE.Vector3;
  text: () => string;
  onClick?: () => void;
  cls?: string;
  label?: string;
  /** adds the 'hi' class while true (a logic 1, an active input) */
  active?: () => boolean;
}

export interface View {
  height: number;
  az: number;
  el: number;
  target: THREE.Vector3;
  minZoom?: number;
  maxZoom?: number;
}

const box = new THREE.Box3();
const origin = new THREE.Vector3();
const centre = new THREE.Vector3();

export abstract class Sheet {
  abstract readonly no: number;
  abstract readonly title: string;
  abstract readonly short: string;
  /** real millimetres per world unit */
  abstract readonly mmPerUnit: number;
  /** plain-language subtitle under FIG. n */
  abstract readonly sub: string;
  abstract view: View;
  root = new THREE.Group();
  refs: Ref[] = [];
  dims: Dim[] = [];
  tags: Tag[] = [];
  /** where the next sheet lives, in world space */
  zoomTarget = new THREE.Vector3();
  built = false;
  /** global clipping planes while this sheet is shown (section views) */
  clipPlanes: THREE.Plane[] = [];
  selected: Ref | null = null;
  /** called when the selection changes so the panel can redraw its part card */
  onSelect: (r: Ref | null) => void = () => {};

  abstract build(): void;
  abstract panel(): HTMLElement;
  update(_dt: number, _t: number): void {}
  enter(): void {}
  exit(): void {}
  /** optional keyboard handling while the sheet is active; return true if consumed */
  key(_e: KeyboardEvent): boolean {
    return false;
  }
  keyUp(_e: KeyboardEvent): boolean {
    return false;
  }

  select(r: Ref | null) {
    if (this.selected === r) r = null;
    this.selected?.parts?.forEach((p) => p.setEmphasis(0));
    this.selected = r;
    r?.parts?.forEach((p) => p.setEmphasis(2));
    this.onSelect(r);
  }

  /** sheets with their own clickable parts (gates, atoms) claim them here */
  canPick(_p: Part): boolean {
    return false;
  }
  pickPart(_p: Part): void {}
  /** raw ray picking for instanced geometry; return true when the click was used */
  pickRay(_ray: THREE.Raycaster): boolean {
    return false;
  }

  /**
   * World position of the part that sheet `no` continues from: the centre of whatever its
   * "see FIG. no" numeral points at. False when this sheet has no such part.
   */
  anchorFor(no: number, out: THREE.Vector3): boolean {
    const r = this.refs.find((x) => x.see === no);
    if (!r) return false;
    this.root.updateMatrixWorld(true);
    out.copy(r.at ?? origin);
    r.target.localToWorld(out);
    // the centre of the highlighted part nearest the leader tip (a numeral can name several copies)
    let best = Infinity;
    for (const p of r.parts ?? []) {
      if (!p.visible) continue;
      box.setFromObject(p);
      if (box.isEmpty()) continue;
      const d = box.distanceToPoint(out);
      if (d < best) {
        best = d;
        box.getCenter(centre);
      }
    }
    if (best < Infinity) out.copy(centre);
    return true;
  }

  refForPart(p: Part): Ref | undefined {
    return this.refs.find((r) => r.parts?.includes(p));
  }
}
