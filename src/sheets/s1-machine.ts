import * as THREE from 'three';
import { C, M, v } from '../core/ink';
import { tc } from '../core/theme';
import { Sheet, type View, type Ref } from '../core/sheet';
import { state, type Arch, type Workload } from '../core/state';
import { SPEC, type Port } from '../core/specs';
import { thermal, THERMAL, LOADS, JOB_WORK } from '../sim/thermal';
import { h, segmented, slider, readout, facts, section, grind, onlyGrind, fmtDuration } from '../core/ui';
import { Machine } from './machine/model';
import { drawScreen } from './machine/screen';
import { N } from './ids';

interface Chain {
  label: string;
  stages: { name: string; ms: number }[];
  total: number;
  t0: number;
  char: string;
  shown: boolean;
}

const SLOWMO = 12;
const LEGEND = { arm: M.white, x86: 0xc9ccd2 };

export class MachineSheet extends Sheet {
  readonly no = N.machine;
  readonly title = 'The machine';
  readonly short = 'machine';
  readonly mmPerUnit = 1;
  readonly sub = 'The complete machine and its charger, viewed from the front left';
  view: View = { height: 470, az: -30, el: 21, target: new THREE.Vector3(-52, 80, 4), minZoom: 0.45, maxZoom: 12 };

  machines!: Record<Arch, Machine>;
  lidDeg = 112;
  typed = '';
  chain: Chain | null = null;
  socBoost = 0;
  sleeping = false;
  private t = 0;
  private plugAnim = 0;
  private ro!: { power: ReturnType<typeof readout>; battery: ReturnType<typeof readout>; flow: ReturnType<typeof readout> };
  private chainEl!: HTMLElement;
  private lidState!: HTMLElement;
  private factsBox!: HTMLElement;
  private budget!: HTMLElement;
  private keyMsg!: HTMLElement;
  private plugSeg!: ReturnType<typeof segmented<'bat' | 'ac'>>;
  private lastScreen = 0;
  private lastBudget = 0;
  private cursorOn = true;

  build() {
    this.machines = { arm: new Machine('arm'), x86: new Machine('x86') };
    for (const m of Object.values(this.machines)) {
      this.root.add(m.group);
      m.setPlug(state.plugged ? 1 : 0);
    }
    this.plugAnim = state.plugged ? 1 : 0;
    this.applyArch();
    state.on('arch', () => this.applyArch());
    state.on('plugged', () => this.plugSeg?.set(state.plugged ? 'ac' : 'bat'));
    window.addEventListener('blur', () => this.releaseAll());
  }

  private get m() {
    return this.machines[state.arch];
  }

  onRebuild: () => void = () => {};

  private applyArch() {
    const a = state.arch;
    const isArm = a === 'arm';
    this.machines.arm.group.visible = isArm;
    this.machines.x86.group.visible = !isArm;
    const m = this.m;
    const s = SPEC[a];
    m.setLid(this.lidDeg);
    this.zoomTarget.copy(m.centre);
    const A = m.anchors;
    const portList = (ps: Port[]) => ps.map((p) => p.label).join(' · ');
    const refs: Ref[] = [
      { n: 100, name: isArm ? 'OLED display' : 'Mini-LED display', text: isArm ? `A ${s.displayIn}-inch OLED panel, ${s.displayPx[0]} × ${s.displayPx[1]} at ${s.displayHz} Hz. Every pixel makes its own light, so black pixels are switched off and draw nothing.` : `A ${s.displayIn}-inch LCD, ${s.displayPx[0]} × ${s.displayPx[1]} at ${s.displayHz} Hz, lit from behind by about two thousand separately dimmed zones of mini-LEDs, up to ${s.displayNits} nits.`, facts: [['Panel', `${s.displayIn} in, ${s.displayPx[0]} × ${s.displayPx[1]}, ${s.displayHz} Hz`], ['Active area', '344.6 × 215.4 mm'], ['Peak brightness', `${s.displayNits} nits`]], target: A.display, off: [80, -40], parts: m.parts.lid, see: N.display },
      { n: 102, name: isArm ? 'Barrel hinge' : 'Hinge knuckles', text: isArm ? 'One barrel hinge across the back, between two inset ends, its top flush with the deck. The lid pivots a few millimetres in from its lower edge, so as it opens that edge swings down behind the base instead of lifting the screen up off the deck.' : 'Two gunmetal knuckles at the ends of the lid\'s chin, 28 mm in from the back. The chin drops into a channel in front of the raised rear bar, which carries the exhaust.', facts: [['Sleep below', '≈ 20°'], ['Lid sensor', 'Hall effect']], target: A.hinge, off: [60, 30], parts: m.parts.hinge },
      { n: 104, name: 'Keyboard', text: `${m.keys.size} keys with ${s.keyTravel} mm of travel${isArm ? ', a compressed numeric pad on the right' : ', per-key RGB and a row of hotkeys above the function keys'}. Each key closes one crossing of a row and a column in a matrix the controller scans about a thousand times a second.`, facts: [['Key travel', `${s.keyTravel} mm`], ['Keys', String(m.keys.size)], ['Backlight', isArm ? 'white, 3 levels' : 'per-key RGB']], target: A.keys, off: [-40, -80], parts: m.parts.keys },
      { n: 105, name: isArm ? 'Fingerprint power key' : 'Power button', text: isArm ? 'A capacitive fingerprint sensor under the power key. The match is done inside the SoC\'s secure processor, never by the operating system.' : 'A hexagonal power button on its own at the top right, level with the five hotkeys (volume, microphone, fan mode, control centre). The embedded controller reads it directly, so a long press still switches the machine off when the processor has hung.', target: A.power, off: [50, -70], parts: m.parts.power, grind: true },
      { n: 106, name: 'Trackpad', text: `A ${isArm ? '152 × 100' : '150 × 92'} mm glass pad over a capacitive grid that tracks ten fingers.`, facts: [['Size', isArm ? '152 × 100 mm' : '150 × 92 mm']], target: A.trackpad, off: [-20, 80], parts: m.parts.trackpad },
      { n: 108, name: isArm ? 'Aluminium base' : 'Base', text: isArm ? `Anodised aluminium, ${s.w} × ${s.d} mm and only ${s.h} mm thick closed.` : `${s.w} × ${s.d} mm, 22.8 mm thick at the front and ${s.h} mm at the rear bar, where the exhaust leaves.`, facts: [['Size', `${s.w} × ${s.d} × ${s.h} mm`], ['Mass', `${s.massKg} kg`]], target: m.parts.base[0], at: v(s.w / 2 - 30, m.deckY(s.d / 2) * 0.5, s.d / 2), off: [70, 40], parts: m.parts.base, see: N.chassis },
      { n: 110, name: 'Ports, left', text: portList(s.left), facts: s.left.map((p) => [kindName(p.kind), `${p.label}, ${p.z} mm from the rear`] as [string, string]), target: A.portsL, off: [-60, 70], parts: m.parts.ports },
      { n: 111, name: 'Ports, right', text: portList(s.right), facts: s.right.map((p) => [kindName(p.kind), `${p.label}, ${p.z} mm from the rear`] as [string, string]), target: A.portsR, off: [80, 40], parts: m.parts.ports, grind: true },
      { n: 112, name: 'Camera', text: `${s.camera}, in the top bezel.`, target: A.camera, off: [70, -24], parts: m.parts.camera, grind: true },
      { n: 113, name: 'Speaker grooves', text: `${s.speakers}. The woofers fire through long grooves along both flanks.`, target: A.vents, off: [-70, 50], parts: m.parts.vents ?? [], grind: true, hidden: !isArm },
      { n: 116, name: 'Charger', text: `${s.charger.kind}. It agrees on the voltage with the laptop before it delivers any power.`, facts: [['Rating', `${s.charger.watts} W`], ['Output', `${s.charger.volts} V × ${s.charger.amps} A`]], target: A.charger, off: [-30, -70], parts: m.parts.charger, see: N.power },
    ];
    if (!isArm) {
      refs.push({ n: 118, name: 'LED matrix', text: `${m.matrixHoles.toLocaleString('en')} holes milled through a diagonal band of the lid, with ${m.matrixPts.length} LEDs behind them. Each LED is switched on its own to draw patterns and text; the holes without an LED are there so the band reads as one even field when the lights are off.`, facts: [['Holes', m.matrixHoles.toLocaleString('en')], ['LEDs', String(m.matrixPts.length)]], target: A.matrix, off: [70, -60], parts: [], grind: true });
      refs.push({ n: 120, name: 'Light bar', text: 'A diffused LED strip that wraps the whole base just above the desk, front, sides and back.', target: A.lightbar, off: [60, 50], parts: m.lightBar, grind: true });
      refs.push({ n: 122, name: 'Rear exhaust', text: 'All of the exhaust leaves at the back, behind the hinge and away from your hands: three fans push it through the fin stacks you can see through twelve windows in the rear bar.', target: A.vent, off: [60, -60], parts: m.parts.exhaust ?? [], grind: true });
    }
    this.refs = refs;
    this.dims = [
      { a: v(-s.w / 2, 0, s.d / 2), b: v(s.w / 2, 0, s.d / 2), space: m.group, off: 30, text: () => `${s.w.toFixed(1)}` },
      { a: v(s.w / 2, 0, s.d / 2), b: v(s.w / 2, 0, -s.d / 2), space: m.group, off: -30, text: () => `${s.d.toFixed(1)}` },
    ];
    this.view.target.set(isArm ? -52 : -96, isArm ? 80 : 112, -10);
    this.view.height = isArm ? 470 : 540;
    this.renderFacts();
    this.onRebuild();
  }

  panel() {
    const archSeg = segmented({ label: 'Machine on the bench', options: [{ value: 'arm', label: 'ARM · 16″ ultrabook' }, { value: 'x86', label: 'x86 · 16″ gaming' }], value: state.arch, onChange: (a) => state.setArch(a) });
    state.on('arch', () => archSeg.set(state.arch));
    const work = segmented<Workload>({ label: 'Doing', options: (['idle', 'type', 'web', 'video', 'call', 'game', 'ai', 'export'] as Workload[]).map((k) => ({ value: k, label: LOADS[k].label })), value: state.workload, wrap: true, onChange: (w) => {
      state.setWorkload(w);
      state.revise(this.no, `Machine set to: ${LOADS[w].label}`);
    } });
    state.on('workload', () => work.set(state.workload));
    const lid = slider({ label: 'Lid angle', min: 0, max: 135, step: 1, value: this.lidDeg, format: (d) => `${d}°`, ticks: 9, onInput: (d) => {
      this.lidDeg = d;
      this.m.setLid(d);
      if (d < 20 !== this.sleeping) state.revise(this.no, d < 20 ? 'Lid closed: system asleep' : 'Lid opened: system awake');
    } });
    this.plugSeg = segmented<'bat' | 'ac'>({ label: 'Power source', options: [{ value: 'bat', label: 'On battery' }, { value: 'ac', label: 'Charger plugged in' }], value: state.plugged ? 'ac' : 'bat', onChange: (x) => {
      state.setPlugged(x === 'ac');
      state.revise(this.no, x === 'ac' ? 'Charger plugged in' : 'Charger unplugged');
    } });
    const bright = slider({ label: 'Brightness', min: 0, max: 100, step: 1, value: thermal.brightness * 100, format: (b) => `${b} %`, onInput: (b) => (thermal.brightness = b / 100) });
    const hz = segmented({ label: 'Refresh rate', options: [{ value: 'lo', label: '60 Hz' }, { value: 'hi', label: 'Maximum' }], value: thermal.highRefresh ? 'hi' : 'lo', onChange: (x) => (thermal.highRefresh = x === 'hi') });
    const light = segmented({ label: 'Keyboard and lid lighting', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], value: thermal.kbLight ? 'on' : 'off', onChange: (x) => {
      thermal.kbLight = thermal.lightBar = x === 'on';
    } });
    this.ro = {
      power: readout({ label: 'System power', unit: 'W', digits: 1, min: 0, live: () => true }),
      battery: readout({ label: 'Battery', unit: '%', digits: 0, min: 0, max: 100 }),
      flow: readout({ label: 'Battery life', trend: false }),
    };
    this.lidState = h('span', { class: 'tag' }, 'awake');
    this.chainEl = h('div', { class: 'chain', 'aria-live': 'polite' });
    this.keyMsg = h('p', { class: 'note' }, 'Press any key on your own keyboard, or several at once. The same keys go down on the drawing and the letter reaches the drawn screen as fast as on a real one; the chain below replays its trip in slow motion.');
    this.factsBox = h('div');
    this.budget = h('div');
    this.renderChain();
    this.renderFacts();
    return h(
      'div',
      null,
      section(null, archSeg.el, work.el, lid.el, this.plugSeg.el, h('div', { class: 'ro-grid' }, this.ro.power.el, this.ro.battery.el, this.ro.flow.el, onlyGrind(h('div', { class: 'ro ro-plain' }, h('div', { class: 'ro-label' }, 'Lid'), this.lidState)))),
      section('Keypress to photon', this.keyMsg, this.chainEl),
      grind('Display and light', bright.el, hz.el, light.el, h('p', { class: 'note' }, 'An OLED panel spends power only on bright pixels; a mini-LED backlight lights a zone behind anything bright. Compare the AI chat (dark) with the web page (white) on both machines.')),
      grind('Where the power goes', this.budget),
      grind('This machine', this.factsBox),
    );
  }

  private renderFacts() {
    if (!this.factsBox) return;
    const s = SPEC[state.arch];
    this.factsBox.replaceChildren(
      facts([
        ['Modelled on', s.reference],
        ['Size', `${s.w} × ${s.d} × ${s.h} mm`],
        ['Mass', `${s.massKg} kg`],
        ['Display', `${s.displayIn}″ ${s.displayTech === 'oled' ? 'OLED' : 'mini-LED'}, ${s.displayPx[0]} × ${s.displayPx[1]}, ${s.displayHz} Hz`],
        ['Processor', s.cores],
        ['Graphics', s.gpu],
        ['Memory', s.memory],
        ['Storage', s.ssd],
        ['Battery', `${s.batteryWh} Wh, ${s.cellConfig}`],
        ['Charger', `${s.charger.watts} W`],
        ['Cooling', s.cooling],
        ['Audio', s.speakers],
      ]),
    );
  }

  key(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'PageUp') return false;
    const k = this.keyFor(e);
    if (!k) return false;
    e.preventDefault();
    // the key stays down for as long as it is held, and several can be held at once
    k.held = true;
    k.down = 0.09;
    const char = e.key.length === 1 ? e.key : e.key === 'Enter' ? '\n' : e.key === 'Backspace' ? '\b' : e.key === 'Tab' ? '  ' : '';
    if (e.repeat) {
      // auto-repeat types again, like any text field, without starting a new timing chain
      if (!this.sleeping && char) this.type(char);
      return true;
    }
    if (this.sleeping) {
      this.keyMsg.textContent = 'The lid is closed, so the machine is asleep. Open it past 20° and type again.';
      return true;
    }
    if (state.workload === 'idle') state.setWorkload('type');
    const s = SPEC[state.arch];
    const refresh = 1000 / (thermal.highRefresh ? s.displayHz : 60);
    const stages = [
      { name: 'Switch closes', ms: 2 },
      { name: 'Matrix scan', ms: 1 },
      { name: 'Debounce', ms: 5 },
      { name: 'Controller to SoC', ms: 1 },
      { name: 'OS input and app', ms: 6 + Math.random() * 4 },
      { name: 'Wait for next frame', ms: Math.random() * refresh },
      { name: 'Scan-out', ms: refresh },
      { name: 'Pixel response', ms: s.pixelMs },
    ];
    const total = stages.reduce((a, b) => a + b.ms, 0);
    if (this.chain && !this.chain.shown) this.land(this.chain);
    const label = k.def.label || 'space';
    this.chain = { label, stages, total, t0: performance.now(), char, shown: false };
    this.socBoost = 1;
    this.keyMsg.textContent = `${label} · matrix row ${k.def.row}, column ${k.def.col}. Replayed at 1/${SLOWMO} speed.`;
    state.revise(this.no, `Keypress: ${label} reached the screen in ${total.toFixed(1)} ms`);
    return true;
  }

  keyUp(e: KeyboardEvent): boolean {
    const k = this.keyFor(e);
    if (!k) return false;
    k.held = false;
    return true;
  }

  private keyFor(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
    const code = e.code || '';
    const keys = this.m.keys;
    return keys.get(code) ?? keys.get(code.replace('Numpad', 'Digit')) ?? keys.get(code.replace('Digit', 'Numpad'));
  }

  /** a key held while the window loses focus never sees its keyup */
  private releaseAll() {
    for (const mm of Object.values(this.machines)) for (const k of mm.keys.values()) k.held = false;
  }

  exit() {
    this.releaseAll();
  }

  private renderChain() {
    const c = this.chain;
    const el = this.chainEl;
    if (!el) return;
    if (!c) {
      el.innerHTML = '<div class="chain-empty">No key pressed yet</div>';
      return;
    }
    const elapsed = (performance.now() - c.t0) / SLOWMO;
    const rows = c.stages
      .map((st, i) => {
        const start = c.stages.slice(0, i).reduce((a, b) => a + b.ms, 0);
        const f = Math.max(0, Math.min(1, (elapsed - start) / Math.max(st.ms, 0.01)));
        const w = (st.ms / c.total) * 100, l = (start / c.total) * 100;
        return `<div class="chain-row${f > 0 && f < 1 ? ' live' : ''}"><span class="chain-name">${st.name}</span><span class="chain-ms">${st.ms.toFixed(1)}</span><span class="chain-bar"><i style="left:${l}%;width:${w}%"></i><b style="left:${l}%;width:${w * f}%"></b></span></div>`;
      })
      .join('');
    el.innerHTML = `${rows}<div class="chain-total"><span>Key ${escapeHtml(c.label)} to light</span><strong>${c.total.toFixed(1)} ms</strong></div>`;
  }

  private land(c: Chain) {
    c.shown = true;
    this.type(c.char);
  }

  private type(char: string) {
    if (char === '\b') this.typed = this.typed.slice(0, -1);
    else this.typed = (this.typed + char).slice(-400);
  }

  update(dt: number) {
    this.t += dt;
    const m = this.m;
    const s = SPEC[state.arch];
    for (const k of m.keys.values()) {
      if (k.down > 0) k.down -= dt;
      if (k.held || k.down > 0) {
        k.part.position.y = k.rest - s.keyTravel;
        k.part.setLive(true);
      } else if (k.part.position.y !== k.rest) {
        k.part.position.y = k.rest;
        k.part.setLive(false);
      }
    }
    if (this.chain) {
      const real = performance.now() - this.chain.t0;
      const elapsed = real / SLOWMO;
      const pre = this.chain.total - this.chain.stages[this.chain.stages.length - 1].ms;
      // the character lands on the drawn screen at the real latency; only the chain below is replayed slowly
      if (!this.chain.shown && real >= pre) this.land(this.chain);
      if (elapsed < this.chain.total + 40) this.renderChain();
    }
    const sleeping = this.lidDeg < 20;
    if (sleeping !== this.sleeping) {
      this.sleeping = sleeping;
      thermal.sleeping = sleeping;
      if (this.lidState) this.lidState.textContent = sleeping ? 'asleep' : 'awake';
    }
    const want = state.plugged ? 1 : 0;
    if (Math.abs(this.plugAnim - want) > 0.001) {
      this.plugAnim += Math.sign(want - this.plugAnim) * Math.min(Math.abs(want - this.plugAnim), dt * 1.6);
      const e = this.plugAnim < 0.5 ? 2 * this.plugAnim * this.plugAnim : 1 - Math.pow(-2 * this.plugAnim + 2, 2) / 2;
      for (const mm of Object.values(this.machines)) mm.setPlug(e);
    }
    const live = state.plugged && this.plugAnim > 0.98;
    m.chargerLed.setTone(live ? C.red : M.white);
    m.cable?.setLive(live);
    m.plug.setLive(live);
    m.chargeLed?.setTone(thermal.batteryW > 0.3 ? C.red : M.white);
    const lit = thermal.kbLight && !this.sleeping;
    for (const l of m.lightBar) l.setTone(lit ? C.red : M.rgb);
    m.legendMat.color.setHex(tc(state.arch === 'x86' && lit ? C.red : LEGEND[state.arch]));
    m.paintMatrix(this.t, lit);
    this.socBoost = Math.max(0, this.socBoost - dt * 1.5);
    const p = thermal.systemW() + this.socBoost * 1.5;
    if (this.ro) {
      this.ro.power.set(p);
      this.ro.battery.set(thermal.batteryPct());
      const bw = thermal.batteryW;
      this.ro.flow.set(0, bw > 0.3 ? `charging, full in ${fmtDuration(((s.batteryWh - thermal.batteryWh) / bw) * 3600)}` : state.plugged && bw > -0.3 ? 'full, running from the charger' : `${fmtDuration((thermal.batteryWh / Math.max(0.1, -bw || p)) * 3600)} left`);
      const now = performance.now();
      if (now - this.lastBudget > 400) {
        this.lastBudget = now;
        this.budget.replaceChildren(
          facts([
            ['Processor package', `${thermal.power.toFixed(1)} W`],
            ...(state.arch === 'x86' ? ([['Discrete GPU', `${thermal.gpuPower.toFixed(1)} W`]] as [string, string][]) : []),
            ['Display', `${thermal.displayW().toFixed(1)} W`],
            ['Lighting', `${thermal.lightingW().toFixed(1)} W`],
            ['Rest of the platform', `${(thermal.platformW() - thermal.displayW() - thermal.lightingW()).toFixed(1)} W`],
            ['From the charger', state.plugged ? `${thermal.adapterW.toFixed(1)} W of ${s.charger.watts} W` : 'unplugged'],
            ['Into the battery', `${thermal.batteryW >= 0 ? '+' : '−'}${Math.abs(thermal.batteryW).toFixed(1)} W`],
          ]),
        );
      }
    }
    // the panel: redrawn at about 30 frames a second
    const now = performance.now();
    if (now - this.lastScreen > 33) {
      this.lastScreen = now;
      this.cursorOn = Math.floor(this.t * 1.9) % 2 === 0;
      const g = m.screenCanvas.getContext('2d')!;
      if (this.sleeping) {
        g.fillStyle = '#0b0c0e';
        g.fillRect(0, 0, m.screenCanvas.width, m.screenCanvas.height);
      } else {
        const tps = state.arch === 'arm' ? s.memBW / 4.4 : 118 * Math.min(1, thermal.gpuPower / 140 + 0.15);
        const fps = state.arch === 'arm' ? 18 + 24 * (thermal.freq / THERMAL.arm.fMax) : 40 + 120 * (thermal.gpuFreq / THERMAL.x86.gMax);
        drawScreen(g, m.screenCanvas.width, m.screenCanvas.height, state.workload, {
          t: this.t,
          typed: this.typed,
          cursor: this.cursorOn,
          bright: thermal.brightness,
          tps,
          fps,
          job: thermal.jobRunning ? thermal.jobWork / JOB_WORK : -1,
          machine: state.arch === 'arm' ? 'on the CPU and NPU, from LPDDR5X' : 'on the GPU, from GDDR7',
          battery: thermal.batteryPct(),
          plugged: state.plugged,
        });
      }
      m.screenTex.needsUpdate = true;
    }
  }
}

function kindName(k: Port['kind']) {
  return { usbc: 'USB-C', usba: 'USB-A', hdmi: 'HDMI', rj45: 'Ethernet', sd: 'SD', microsd: 'microSD', audio: 'Audio', dc: 'Power in', led: 'Indicator' }[k];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
