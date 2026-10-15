// Small DOM kit for the spec column: controls drawn in the sheet's own vocabulary.

import { tcs } from './theme';
type Kid = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, val] of Object.entries(attrs)) {
      if (val === undefined || val === null || val === false) continue;
      if (k === 'class') el.className = String(val);
      else if (k === 'style' && typeof val === 'object') Object.assign(el.style, val);
      else if (k.startsWith('on') && typeof val === 'function') el.addEventListener(k.slice(2), val as EventListener);
      else if (k === 'html') el.innerHTML = String(val);
      else el.setAttribute(k, val === true ? '' : String(val));
    }
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Escape text and turn 10^-5 style exponents into real superscripts. */
export function rich(s: string): string {
  return s
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    .replace(/\^(-?\d+)/g, (_m, e) => `<sup>${String(e).replace('-', '−')}</sup>`);
}

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

export interface Segmented<T extends string> {
  el: HTMLElement;
  set(v: T): void;
  get(): T;
}

export function segmented<T extends string>(o: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  wrap?: boolean;
}): Segmented<T> {
  let cur = o.value;
  const id = nextId('seg');
  const btns = o.options.map((opt) =>
    h('button', {
      type: 'button',
      class: 'seg-btn',
      role: 'radio',
      title: opt.title,
      'aria-checked': String(opt.value === cur),
      onclick: () => {
        if (cur === opt.value) return;
        set(opt.value);
        o.onChange(opt.value);
      },
    }, opt.label),
  );
  const group = h('div', { class: 'seg' + (o.wrap ? ' seg-wrap' : ''), role: 'radiogroup', 'aria-labelledby': id }, ...btns);
  group.addEventListener('keydown', (e) => {
    const i = o.options.findIndex((x) => x.value === cur);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % o.options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + o.options.length) % o.options.length;
    if (j >= 0) {
      e.preventDefault();
      set(o.options[j].value);
      o.onChange(o.options[j].value);
      btns[j].focus();
    }
  });
  function set(v: T) {
    cur = v;
    o.options.forEach((opt, i) => {
      btns[i].setAttribute('aria-checked', String(opt.value === v));
      btns[i].tabIndex = opt.value === v ? 0 : -1;
    });
  }
  set(cur);
  const el = h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', id }, o.label), group);
  return { el, set, get: () => cur };
}

export interface Slider {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: number): void;
  get(): number;
}

export function slider(o: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  ticks?: number;
}): Slider {
  const id = nextId('sl');
  const out = h('output', { class: 'ctl-value', for: id });
  const input = h('input', {
    type: 'range',
    id,
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
  }) as HTMLInputElement;
  const ticks = h('div', { class: 'ruler', 'aria-hidden': 'true' });
  const n = o.ticks ?? 10;
  for (let i = 0; i <= n * 2; i++) ticks.append(h('i', { class: i % 2 ? 'minor' : '' }));
  const paint = () => {
    const val = Number(input.value);
    out.innerHTML = rich(o.format(val));
    input.style.setProperty('--p', String((val - o.min) / (o.max - o.min)));
  };
  input.addEventListener('input', () => {
    paint();
    o.onInput(Number(input.value));
  });
  paint();
  const el = h(
    'div',
    { class: 'ctl' },
    h('div', { class: 'ctl-row' }, h('label', { class: 'ctl-label', for: id }, o.label), out),
    h('div', { class: 'range' }, ticks, input),
  );
  return {
    el,
    input,
    set(v: number) {
      input.value = String(v);
      paint();
    },
    get: () => Number(input.value),
  };
}

export interface Readout {
  el: HTMLElement;
  set(v: number, text?: string): void;
}

/** A value with its recent trend drawn beside it. */
export function readout(o: { label: string; unit?: string; digits?: number; trend?: boolean; min?: number; max?: number; live?: (v: number) => boolean }): Readout {
  const val = h('span', { class: 'ro-val' }, '–');
  const unit = h('span', { class: 'ro-unit' }, o.unit ?? '');
  const cv = h('canvas', { class: 'ro-trend', width: 96, height: 28, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const hist: number[] = [];
  let last = 0;
  const el = h(
    'div',
    { class: 'ro' + (o.trend === false ? ' ro-plain' : '') },
    h('div', { class: 'ro-label' }, o.label),
    h('div', { class: 'ro-line' }, val, unit, o.trend === false ? null : cv),
  );
  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== 96 * dpr) {
      cv.width = 96 * dpr;
      cv.height = 28 * dpr;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 96, 28);
    g.strokeStyle = tcs('#b9bbb5');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 27.5);
    g.lineTo(96, 27.5);
    g.stroke();
    if (hist.length < 2) return;
    let lo = o.min ?? Math.min(...hist);
    let hi = o.max ?? Math.max(...hist);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    g.strokeStyle = tcs('#1d1f22');
    g.lineWidth = 1.25;
    g.beginPath();
    hist.forEach((x, i) => {
      const px = (i / 59) * 94 + 1;
      const py = 25 - ((x - lo) / (hi - lo)) * 22;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    });
    g.stroke();
    const lx = ((hist.length - 1) / 59) * 94 + 1;
    const ly = 25 - ((hist[hist.length - 1] - lo) / (hi - lo)) * 22;
    g.fillStyle = o.live?.(hist[hist.length - 1]) ? tcs('#cf1f2e') : tcs('#1d1f22');
    g.fillRect(lx - 2, ly - 2, 4, 4);
  };
  let tick = 0;
  return {
    el,
    set(v: number, text?: string) {
      val.innerHTML = rich(text ?? (Number.isFinite(v) ? v.toFixed(o.digits ?? 1) : '–'));
      last = v;
      const now = performance.now();
      if (o.trend !== false && now - tick > 120) {
        tick = now;
        hist.push(last);
        if (hist.length > 60) hist.shift();
        draw();
      }
    },
  };
}

export function button(label: string, onClick: () => void, o: { primary?: boolean; title?: string } = {}) {
  return h('button', { type: 'button', class: 'btn' + (o.primary ? ' btn-primary' : ''), title: o.title, onclick: onClick }, label);
}

export function facts(rows: [string, string][]) {
  const dl = h('dl', { class: 'facts' });
  rows.forEach(([k, v]) => dl.append(h('dt', null, k), h('dd', { html: rich(v) })));
  return dl;
}

export function section(title: string | null, ...kids: Kid[]) {
  return h('section', { class: 'spec-sec' }, title ? h('h3', { class: 'sec-title' }, title) : null, ...kids);
}

/** A section only shown in Grind mode: the deeper numbers and controls. */
export function grind(title: string | null, ...kids: Kid[]) {
  const s = section(title, ...kids);
  s.classList.add('grind');
  return s;
}

/** Mark any element as Grind-only. */
export function onlyGrind<T extends HTMLElement>(el: T): T {
  el.classList.add('grind');
  return el;
}

// ---------- plot ----------

export interface Series {
  color: string;
  width?: number;
  dash?: number[];
  points: [number, number][];
  label?: string;
}

export class Plot {
  canvas: HTMLCanvasElement;
  el: HTMLElement;
  series: Series[] = [];
  marker: [number, number] | null = null;
  markerLive = false;
  constructor(
    public o: {
      w?: number;
      h?: number;
      x: [number, number];
      y: [number, number];
      logY?: boolean;
      xLabel: string;
      yLabel: string;
      xTicks?: number[];
      yTicks?: number[];
      fmtX?: (v: number) => string;
      fmtY?: (v: number) => string;
      caption?: string;
    },
  ) {
    const w = o.w ?? 320, hh = o.h ?? 170;
    this.canvas = h('canvas', { class: 'plot', style: { width: '100%', aspectRatio: `${w} / ${hh}` } }) as HTMLCanvasElement;
    this.el = h('figure', { class: 'plot-fig' }, this.canvas, o.caption ? h('figcaption', null, o.caption) : null);
  }

  private ty(y: number, top: number, bot: number) {
    const [a, b] = this.o.y;
    const t = this.o.logY ? (Math.log10(Math.max(y, a)) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) : (y - a) / (b - a);
    return bot - Math.max(-0.05, Math.min(1.05, t)) * (bot - top);
  }

  draw() {
    const cv = this.canvas;
    const cssW = cv.clientWidth || 320;
    const cssH = cssW * ((this.o.h ?? 170) / (this.o.w ?? 320));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(cssW * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const L = 40, R = cssW - 8, T = 8, B = cssH - 30;
    const [x0, x1] = this.o.x;
    const tx = (x: number) => L + ((x - x0) / (x1 - x0)) * (R - L);
    g.font = '500 10.5px "Barlow Semi Condensed", sans-serif';
    g.fillStyle = tcs('#50545a');
    g.strokeStyle = tcs('#cbcdc7');
    g.lineWidth = 1;
    const fx = this.o.fmtX ?? ((v: number) => String(v));
    const fy = this.o.fmtY ?? ((v: number) => String(v));
    g.textAlign = 'center';
    for (const xt of this.o.xTicks ?? []) {
      const px = Math.round(tx(xt)) + 0.5;
      g.beginPath(); g.moveTo(px, T); g.lineTo(px, B); g.stroke();
      g.fillText(fx(xt), px, B + 13);
    }
    g.textAlign = 'right';
    for (const yt of this.o.yTicks ?? []) {
      const py = Math.round(this.ty(yt, T, B)) + 0.5;
      g.beginPath(); g.moveTo(L, py); g.lineTo(R, py); g.stroke();
      g.fillText(fy(yt), L - 5, py + 3.5);
    }
    g.strokeStyle = tcs('#1d1f22');
    g.lineWidth = 1.25;
    g.beginPath(); g.moveTo(L + 0.5, T); g.lineTo(L + 0.5, B + 0.5); g.lineTo(R, B + 0.5); g.stroke();
    g.textAlign = 'center';
    g.fillStyle = tcs('#1d1f22');
    g.fillText(this.o.xLabel, (L + R) / 2, cssH - 3);
    g.save();
    g.translate(10, (T + B) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(this.o.yLabel, 0, 0);
    g.restore();
    g.save();
    g.beginPath(); g.rect(L, T - 2, R - L, B - T + 4); g.clip();
    for (const s of this.series) {
      if (s.points.length < 2) continue;
      g.strokeStyle = s.color;
      g.lineWidth = s.width ?? 1.5;
      g.setLineDash(s.dash ?? []);
      g.beginPath();
      s.points.forEach(([x, y], i) => (i ? g.lineTo(tx(x), this.ty(y, T, B)) : g.moveTo(tx(x), this.ty(y, T, B))));
      g.stroke();
    }
    g.setLineDash([]);
    if (this.marker) {
      const mx = tx(this.marker[0]), my = this.ty(this.marker[1], T, B);
      g.strokeStyle = tcs('#8b8e88');
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(mx, B); g.lineTo(mx, my); g.lineTo(L, my); g.stroke();
      g.setLineDash([]);
      g.fillStyle = this.markerLive ? tcs('#cf1f2e') : tcs('#1d1f22');
      g.fillRect(mx - 3, my - 3, 6, 6);
    }
    g.restore();
  }
}

export function fmtSI(v: number, unit: string, digits = 3): string {
  if (v === 0) return `0 ${unit}`;
  const pre: [number, string][] = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'], [1e-18, 'a']];
  const a = Math.abs(v);
  for (const [f, p] of pre) if (a >= f * 0.9995) return `${(v / f).toPrecision(digits)} ${p}${unit}`;
  return `${v.toExponential(2)} ${unit}`;
}

export function fmtDuration(s: number): string {
  if (s < 1e-6) return `${(s * 1e9).toPrecision(3)} ns`;
  if (s < 1e-3) return `${(s * 1e6).toPrecision(3)} µs`;
  if (s < 1) return `${(s * 1e3).toPrecision(3)} ms`;
  if (s < 120) return `${s.toPrecision(3)} s`;
  if (s < 600) return `${(s / 60).toFixed(1)} min`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
