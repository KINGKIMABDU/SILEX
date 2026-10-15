// Screen-space drafting layer: reference numerals with leader lines, and dimension lines,
// re-projected from 3D every frame so they stay attached while the drawing turns.
import * as THREE from 'three';
import type { Sheet, Ref, Dim, Tag } from './sheet';
import { state } from './state';

const NS = 'http://www.w3.org/2000/svg';
const tmp = new THREE.Vector3();

interface LabelNode {
  ref: Ref;
  bw: number;
  bh: number;
  /** settled screen position, eased towards the solved one so labels glide instead of jumping */
  px: number;
  py: number;
  /** the leader tip is behind another surface */
  hidden: boolean;
  el: HTMLButtonElement;
  path: SVGPathElement;
  dot: SVGCircleElement;
}

interface DimNode {
  dim: Dim;
  g: SVGGElement;
  ext: SVGPathElement;
  line: SVGPathElement;
  heads: SVGPathElement;
  text: SVGTextElement;
}

export class Overlay {
  private labels: LabelNode[] = [];
  private dimNodes: DimNode[] = [];
  private tagNodes: { tag: Tag; el: HTMLElement; last: string }[] = [];
  private sheet: Sheet | null = null;
  /** filled meshes that can hide a leader tip, collected lazily */
  private occluders: THREE.Object3D[] | null = null;
  private ray = new THREE.Raycaster();
  private probe = 0;
  private w = 1;
  private h = 1;

  constructor(
    private svg: SVGSVGElement,
    private layer: HTMLElement,
    private cb: { onSee: (n: number) => void },
  ) {}

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
  }

  attach(sheet: Sheet) {
    this.detach();
    this.sheet = sheet;
    this.occluders = null;
    for (const ref of sheet.refs) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'leader');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '1.9');
      dot.setAttribute('class', 'leader-dot');
      this.svg.append(path, dot);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'numeral' + (ref.see ? ' has-see' : '');
      el.innerHTML = `<span class="n">${ref.n}</span>${ref.see ? `<span class="see">see FIG. ${ref.see}</span>` : ''}`;
      el.setAttribute('aria-label', `${ref.n}, ${ref.name}${ref.see ? `, continues on figure ${ref.see}` : ''}`);
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (ref.see && t.closest('.see')) {
          this.cb.onSee(ref.see);
          return;
        }
        sheet.select(ref);
      });
      el.addEventListener('pointerenter', () => ref.parts?.forEach((p) => sheet.selected !== ref && p.setEmphasis(1)));
      el.addEventListener('pointerleave', () => ref.parts?.forEach((p) => sheet.selected !== ref && p.setEmphasis(0)));
      this.layer.append(el);
      this.labels.push({ ref, el, path, dot, bw: 0, bh: 0, px: NaN, py: NaN, hidden: false });
    }
    for (const tag of sheet.tags) {
      const el = document.createElement(tag.onClick ? 'button' : 'span');
      el.className = 'tag-label' + (tag.cls ? ' ' + tag.cls : '');
      if (tag.onClick) {
        (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', tag.onClick);
        if (tag.label) el.setAttribute('aria-label', tag.label);
      } else el.setAttribute('aria-hidden', 'true');
      this.layer.append(el);
      this.tagNodes.push({ tag, el, last: '' });
    }
    for (const dim of sheet.dims) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'dim');
      const ext = document.createElementNS(NS, 'path');
      ext.setAttribute('class', 'dim-ext');
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('class', 'dim-line');
      const heads = document.createElementNS(NS, 'path');
      heads.setAttribute('class', 'dim-head');
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('class', 'dim-text');
      g.append(ext, line, heads, text);
      this.svg.append(g);
      this.dimNodes.push({ dim, g, ext, line, heads, text });
    }
  }

  detach() {
    this.labels.forEach((l) => {
      l.el.remove();
      l.path.remove();
      l.dot.remove();
    });
    this.dimNodes.forEach((d) => d.g.remove());
    this.tagNodes.forEach((t) => t.el.remove());
    this.labels = [];
    this.dimNodes = [];
    this.tagNodes = [];
    this.sheet = null;
  }

  private project(p: THREE.Vector3, cam: THREE.Camera): [number, number, boolean] {
    tmp.copy(p).project(cam);
    return [(tmp.x * 0.5 + 0.5) * this.w, (-tmp.y * 0.5 + 0.5) * this.h, tmp.z > -1 && tmp.z < 1];
  }

  /** Is the point behind a surface that is not part of the ref itself? Patent drawings dash hidden detail. */
  private occluded(ref: Ref, tip: THREE.Vector3, cam: THREE.Camera): boolean {
    if (!this.sheet) return false;
    if (!this.occluders) {
      this.occluders = [];
      this.sheet.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) && (m.material as THREE.Material).type === 'MeshBasicMaterial') this.occluders!.push(m);
      });
    }
    const ndc = tmp2.copy(tip).project(cam);
    this.ray.setFromCamera(ndcV.set(ndc.x, ndc.y), cam);
    const far = this.ray.ray.origin.distanceTo(tip);
    // a tip drawn on a surface sits a hair inside it; allow a few screen pixels of slack
    const pc = cam as THREE.PerspectiveCamera;
    const slack = ((2 * Math.tan((pc.fov * Math.PI) / 360) * far) / pc.zoom / this.h) * 3;
    const clip = this.sheet.clipPlanes;
    for (const hit of this.ray.intersectObjects(this.occluders, false)) {
      if (hit.distance >= far - slack) return false;
      if (!isShown(hit.object)) continue;
      // a section view has cut this surface away: it hides nothing
      if (clip.some((pl) => pl.distanceToPoint(hit.point) < 0)) continue;
      if (belongsTo(hit.object, ref)) continue;
      return true;
    }
    return false;
  }

  update(cam: THREE.Camera) {
    if (!this.sheet) return;
    const sel = this.sheet.selected;
    // dimension lines first: their figures are obstacles the numerals keep clear of
    const blocks: Box[] = [];
    this.updateDims(cam, blocks);

    const live: { l: LabelNode; x: number; y: number; bx: number; by: number; hw: number; hh: number }[] = [];
    for (const l of this.labels) {
      const r = l.ref;
      const visible = !r.hidden && !(r.grind && state.detail === 'rookie') && r.target.visible && isShown(r.target);
      l.el.hidden = !visible;
      l.path.style.display = l.dot.style.display = visible ? '' : 'none';
      if (!visible) {
        l.px = NaN;
        continue;
      }
      tip.copy(r.at ?? zero);
      r.target.localToWorld(tip);
      const [x, y] = this.project(tip, cam);
      // a part zoomed off the sheet takes its numeral with it, instead of piling it up at the edge
      if (x < -8 || x > this.w + 8 || y < -8 || y > this.h + 8) {
        l.el.hidden = true;
        l.path.style.display = l.dot.style.display = 'none';
        l.px = NaN;
        continue;
      }
      if (!l.bw) {
        l.bw = l.el.offsetWidth;
        l.bh = l.el.offsetHeight;
      }
      const hw = (l.bw || 30) / 2 + 4, hh = (l.bh || 20) / 2 + 3;
      live.push({ l, x, y, bx: x + r.off[0], by: y + r.off[1], hw, hh });
    }
    // occlusion is a raycast, so probe a few labels per frame in turn
    if (live.length) {
      for (let k = 0; k < Math.min(3, live.length); k++) {
        const it = live[(this.probe + k) % live.length];
        tip.copy(it.l.ref.at ?? zero);
        it.l.ref.target.localToWorld(tip);
        it.l.hidden = this.occluded(it.l.ref, tip, cam);
      }
      this.probe = (this.probe + 3) % live.length;
    }
    // push overlapping numerals apart, and off the dimension figures
    const minX = (b: { hw: number }) => b.hw, maxX = (b: { hw: number }) => this.w - b.hw;
    const minY = (b: { hh: number }) => b.hh + 64, maxY = (b: { hh: number }) => this.h - b.hh - 26;
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          const ox = a.hw + b.hw - Math.abs(a.bx - b.bx), oy = a.hh + b.hh - Math.abs(a.by - b.by);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy * 1.6) {
            const d = (ox / 2 + 0.5) * (a.bx <= b.bx ? -1 : 1);
            a.bx += d;
            b.bx -= d;
          } else {
            const d = (oy / 2 + 0.5) * (a.by <= b.by ? -1 : 1);
            a.by += d;
            b.by -= d;
          }
        }
        for (const k of blocks) {
          const ox = a.hw + k.hw - Math.abs(a.bx - k.x), oy = a.hh + k.hh - Math.abs(a.by - k.y);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy * 1.6) a.bx += (ox + 0.5) * (a.bx <= k.x ? -1 : 1);
          else a.by += (oy + 0.5) * (a.by <= k.y ? -1 : 1);
        }
        a.bx = Math.min(maxX(a), Math.max(minX(a), a.bx));
        a.by = Math.min(maxY(a), Math.max(minY(a), a.by));
      }
    }
    for (const { l, x, y, bx, by } of live) {
      const r = l.ref;
      // glide: a numeral that has to move gets there over a few frames
      if (Number.isNaN(l.px) || Math.hypot(bx - l.px, by - l.py) > 160) {
        l.px = bx;
        l.py = by;
      } else {
        l.px += (bx - l.px) * 0.35;
        l.py += (by - l.py) * 0.35;
      }
      const lx = l.px, ly = l.py;
      l.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)`;
      l.el.classList.toggle('on', sel === r);
      l.el.classList.toggle('hid', l.hidden && sel !== r);
      // leader ends short of the numeral, with a slight hand-drawn bow
      const dx = lx - x, dy = ly - y;
      const len = Math.hypot(dx, dy) || 1;
      const ex = lx - (dx / len) * 13, ey = ly - (dy / len) * 11;
      const bow = Math.min(18, len * 0.12);
      const cx = (x + ex) / 2 - (dy / len) * bow, cy = (y + ey) / 2 + (dx / len) * bow;
      l.path.setAttribute('d', `M${x.toFixed(1)},${y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`);
      l.path.classList.toggle('on', sel === r);
      l.path.classList.toggle('hid', l.hidden && sel !== r);
      l.dot.classList.toggle('hid', l.hidden && sel !== r);
      l.dot.setAttribute('cx', x.toFixed(1));
      l.dot.setAttribute('cy', y.toFixed(1));
    }
    for (const t of this.tagNodes) {
      const vis = isShown(t.tag.target);
      t.el.hidden = !vis;
      if (!vis) continue;
      tmp.copy(t.tag.at ?? zero);
      t.tag.target.localToWorld(tmp);
      const [x, y] = this.project(tmp, cam);
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      if (t.tag.active) t.el.classList.toggle('hi', t.tag.active());
      const txt = t.tag.text();
      if (txt !== t.last) {
        t.last = txt;
        t.el.textContent = txt;
      }
    }

  }

  private updateDims(cam: THREE.Camera, blocks: Box[]) {
    for (const d of this.dimNodes) {
      const dim = d.dim;
      const vis = !dim.hidden && isShown(dim.space);
      d.g.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const a = dim.space.localToWorld(tmp.copy(dim.a));
      const [ax, ay] = this.project(a, cam);
      const b = dim.space.localToWorld(tmp.copy(dim.b));
      const [bx, by] = this.project(b, cam);
      let dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 8) {
        d.g.style.display = 'none';
        continue;
      }
      dx /= len;
      dy /= len;
      const nx = -dy * Math.sign(dim.off || 1), ny = dx * Math.sign(dim.off || 1);
      const o = Math.abs(dim.off);
      const p1x = ax + nx * o, p1y = ay + ny * o, p2x = bx + nx * o, p2y = by + ny * o;
      d.ext.setAttribute(
        'd',
        `M${ax + nx * 4},${ay + ny * 4} L${ax + nx * (o + 6)},${ay + ny * (o + 6)} M${bx + nx * 4},${by + ny * 4} L${bx + nx * (o + 6)},${by + ny * (o + 6)}`,
      );
      d.line.setAttribute('d', `M${p1x},${p1y} L${p2x},${p2y}`);
      const hl = 8, hw = 2.6;
      const head = (px: number, py: number, sx: number, sy: number) =>
        `M${px},${py} L${px + sx * hl - sy * hw},${py + sy * hl + sx * hw} L${px + sx * hl + sy * hw},${py + sy * hl - sx * hw} Z`;
      d.heads.setAttribute('d', head(p1x, p1y, dx, dy) + head(p2x, p2y, -dx, -dy));
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const tx = (p1x + p2x) / 2 + nx * 9, ty = (p1y + p2y) / 2 + ny * 9;
      d.text.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${ang.toFixed(1)})`);
      d.text.textContent = dim.text();
      // the figure, as a box the numerals keep out of
      const tw = d.text.textContent.length * 3.6 + 4, th = 8;
      blocks.push({ x: tx, y: ty, hw: Math.abs(Math.cos((ang * Math.PI) / 180)) * tw + Math.abs(Math.sin((ang * Math.PI) / 180)) * th, hh: Math.abs(Math.sin((ang * Math.PI) / 180)) * tw + Math.abs(Math.cos((ang * Math.PI) / 180)) * th });
    }
  }
}

const zero = new THREE.Vector3();
const tip = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ndcV = new THREE.Vector2();

interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** the hit is the ref's own part (or inside its target), so it does not hide the tip */
function belongsTo(o: THREE.Object3D, ref: Ref): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p === ref.target) return true;
    if (ref.parts?.includes(p as never)) return true;
    p = p.parent;
  }
  return false;
}

function isShown(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}
