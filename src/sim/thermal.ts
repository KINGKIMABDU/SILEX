// Thermal, power and battery model for both machines.
//
//   cpu die ──Rcpu──┐
//                   ├── heatsink / vapor chamber ──Rair(fans)── room
//   gpu die ──Rgpu──┘
//
// Each processor asks for the power its workload needs at full clock. Power management grants
// what the limits allow: PL1/PL2 with a running average, GPU board power, junction temperature,
// and, on battery, the lower limits a gaming laptop uses to protect its cells. Clocks follow
// from P ∝ f³ because voltage rises roughly with frequency.
//
// The battery sits between the charger and the system: plugged in, the adapter feeds the system
// first and charges the pack with what is left (constant current to 80 %, then tapering);
// if the system needs more than the adapter can give, the pack makes up the difference.
import { state, type Arch, type Workload } from '../core/state';
import { SPEC } from '../core/specs';

interface ThermalParams {
  CcpuDie: number; // J/K
  Rcpu: number; // K/W, die to heatsink
  CgpuDie: number;
  Rgpu: number;
  Csink: number;
  RairPassive: number;
  RairFan: number; // all fans at full speed
  fanMax: number; // rpm
  tjMax: number;
  tgMax: number;
  fMax: number; // GHz, CPU
  fMin: number;
  gMax: number; // GHz, GPU
  pl1: number;
  pl2: number;
  tau: number;
  gpuTgp: number;
  gpuBoost: number;
  batteryCpu: number; // limits on battery
  batteryGpu: number;
  fanW: number; // all fans at full speed
  /** CPU + GPU share this much when both are busy (0: no shared limit) */
  combined: number;
}

export const THERMAL: Record<Arch, ThermalParams> = {
  arm: { CcpuDie: 10, Rcpu: 1.1, CgpuDie: 1, Rgpu: 1, Csink: 70, RairPassive: 4.5, RairFan: 1.1, fanMax: 4500, tjMax: 95, tgMax: 95, fMax: 3.8, fMin: 0.7, gMax: 1.5, pl1: 30, pl2: 50, tau: 30, gpuTgp: 0, gpuBoost: 0, batteryCpu: 50, batteryGpu: 0, fanW: 0.5, combined: 0 },
  // x86 calibrated to the reference machine's Turbo mode as measured by Notebookcheck: CPU 165 W short, 145 W sustained;
  // CPU and GPU together settle near 225 W (CPU about 50 W beside a 175 W GPU); on battery 50 W and 55 W.
  x86: { CcpuDie: 6, Rcpu: 0.3, CgpuDie: 10, Rgpu: 0.12, Csink: 140, RairPassive: 3, RairFan: 0.17, fanMax: 6200, tjMax: 100, tgMax: 87, fMax: 5.4, fMin: 0.8, gMax: 2.4, pl1: 145, pl2: 165, tau: 56, gpuTgp: 150, gpuBoost: 25, batteryCpu: 50, batteryGpu: 55, fanW: 2.4, combined: 225 },
};

export interface Load {
  label: string;
  /** W requested at full clock: CPU (the whole SoC on ARM) and discrete GPU */
  cpu: Record<Arch, number>;
  gpu: Record<Arch, number>;
  burst: number;
  /** relative throughput at full clock for the export job, ARM = 1 */
  speed: Record<Arch, number>;
  blocks: Record<string, number>;
}

export const LOADS: Record<Workload, Load> = {
  idle: { label: 'Idle', cpu: { arm: 0.3, x86: 1.6 }, gpu: { arm: 0, x86: 0 }, burst: 0.1, speed: { arm: 1, x86: 1 }, blocks: { ecore: 0.04, slc: 0.05, display: 0.6, mem: 0.05 } },
  type: { label: 'Typing', cpu: { arm: 0.7, x86: 2.6 }, gpu: { arm: 0, x86: 0 }, burst: 0.5, speed: { arm: 1, x86: 1 }, blocks: { ecore: 0.18, slc: 0.1, display: 0.8, mem: 0.08 } },
  web: { label: 'Web page', cpu: { arm: 5, x86: 11 }, gpu: { arm: 0, x86: 0 }, burst: 0.8, speed: { arm: 1, x86: 1 }, blocks: { ecore: 0.45, pcore: 0.35, gpu: 0.15, slc: 0.35, display: 0.9, mem: 0.3, io: 0.3 } },
  video: { label: 'HDR video', cpu: { arm: 2.2, x86: 6 }, gpu: { arm: 0, x86: 0 }, burst: 0.1, speed: { arm: 1, x86: 1 }, blocks: { ecore: 0.25, media: 0.6, display: 1, slc: 0.2, mem: 0.15 } },
  call: { label: 'Video call', cpu: { arm: 7, x86: 15 }, gpu: { arm: 0, x86: 0 }, burst: 0.3, speed: { arm: 1, x86: 1 }, blocks: { ecore: 0.6, pcore: 0.2, media: 0.7, isp: 0.8, npu: 0.4, gpu: 0.2, slc: 0.4, display: 0.9, mem: 0.35, io: 0.5 } },
  export: { label: '4K export', cpu: { arm: 46, x86: 150 }, gpu: { arm: 0, x86: 70 }, burst: 0.05, speed: { arm: 1, x86: 2.3 }, blocks: { pcore: 1, ecore: 0.9, media: 1, gpu: 0.45, slc: 0.85, display: 0.4, mem: 0.8, io: 0.4 } },
  game: { label: 'Game', cpu: { arm: 38, x86: 75 }, gpu: { arm: 0, x86: 175 }, burst: 0.25, speed: { arm: 1, x86: 1 }, blocks: { pcore: 0.6, ecore: 0.3, gpu: 1, slc: 0.9, display: 1, mem: 0.9, io: 0.2 } },
  ai: { label: 'Local AI', cpu: { arm: 16, x86: 22 }, gpu: { arm: 0, x86: 150 }, burst: 0.15, speed: { arm: 1, x86: 1 }, blocks: { npu: 1, gpu: 0.55, pcore: 0.25, slc: 0.7, mem: 1, display: 0.4 } },
};

/** the reference job: exporting a 10 minute 4K clip takes 300 s on the ARM machine at full clock */
export const JOB_WORK = 300;

export type Limit = 'thermal' | 'power' | 'demand' | 'battery';

export class ThermalSim {
  tDie = 30;
  tGpu = 30;
  tBody = 28;
  ambient = 22;
  power = 1; // CPU / SoC package power granted
  gpuPower = 0;
  avgPower = 1;
  rpm = 0;
  freq = 1;
  gpuFreq = 0;
  speed = 1;
  simTime = 0;
  batteryWh: number;
  /** W into the pack (positive = charging) */
  batteryW = 0;
  /** W drawn from the adapter */
  adapterW = 0;
  jobWork = 0;
  jobRunning = false;
  jobStart = 0;
  jobEnergy = 0;
  limitedBy: Limit = 'demand';
  gpuLimitedBy: Limit = 'demand';
  hist: { t: number; tj: number; tg: number; p: number; pg: number; f: number; pct: number }[] = [];
  // set from the machine sheet
  brightness = 0.6;
  content: 'dark' | 'page' | 'hdr' = 'page';
  highRefresh = true;
  kbLight = true;
  lightBar = true;
  sleeping = false;
  /** battery care: stop charging at this share of capacity */
  chargeLimit = 1;
  private burstPhase = 0;
  private burstVal = 0;
  onJobDone: (secs: number, wh: number) => void = () => {};

  constructor() {
    this.batteryWh = SPEC[state.arch].batteryWh * 0.72;
    state.on('arch', () => this.reset());
  }

  reset() {
    this.tDie = this.ambient + 6;
    this.tGpu = this.ambient + 4;
    this.tBody = this.ambient + 4;
    this.avgPower = 1;
    this.rpm = 0;
    this.simTime = 0;
    this.hist = [];
    this.batteryWh = SPEC[state.arch].batteryWh * 0.72;
    this.jobRunning = false;
    this.jobWork = 0;
  }

  startJob() {
    state.setWorkload('export');
    this.jobRunning = true;
    this.jobWork = 0;
    this.jobStart = this.simTime;
    this.jobEnergy = 0;
  }

  batteryPct() {
    return (this.batteryWh / SPEC[state.arch].batteryWh) * 100;
  }

  /** what is on screen follows the workload: a dark chat, a white page, a bright game or film */
  contentFor(): 'dark' | 'page' | 'hdr' {
    const w = state.workload;
    return w === 'video' || w === 'game' ? 'hdr' : w === 'idle' || w === 'ai' ? 'dark' : 'page';
  }

  /**
   * Panel power. OLED pixels make their own light, so a dark screen costs almost nothing;
   * a mini-LED panel lights its backlight zones behind whatever is bright.
   */
  displayW() {
    if (this.sleeping) return 0;
    this.content = this.contentFor();
    const s = SPEC[state.arch];
    const apl = { dark: 0.12, page: 0.85, hdr: 0.4 }[this.content];
    const peak = this.content === 'hdr' ? 1.5 : 1;
    const panel = s.displayTech === 'oled' ? 0.45 + s.backlightW * this.brightness * apl * peak : 1.4 + s.backlightW * this.brightness * (0.18 + 0.82 * apl) * peak;
    const refresh = this.highRefresh ? (s.displayHz > 200 ? 0.7 : 0.35) : 0;
    return panel + refresh;
  }

  lightingW() {
    if (this.sleeping) return 0;
    const x86 = state.arch === 'x86';
    return (this.kbLight ? (x86 ? 1.6 : 0.5) : 0) + (x86 && this.lightBar ? 0.9 : 0);
  }

  /** display, fans, lighting and the rest of the platform */
  platformW() {
    if (this.sleeping) return state.arch === 'x86' ? 0.9 : 0.35;
    const s = SPEC[state.arch];
    const P = THERMAL[state.arch];
    const fan = P.fanMax ? P.fanW * Math.pow(this.rpm / P.fanMax, 3) : 0;
    return s.idleW + this.displayW() + fan + this.lightingW();
  }

  /** whole-system draw */
  systemW() {
    return this.power + this.gpuPower + this.platformW();
  }

  step(realDt: number) {
    let left = realDt * this.speed;
    while (left > 1e-6) {
      const dt = Math.min(0.05, left);
      left -= dt;
      this.tick(dt);
    }
    state.packageW = this.power;
    state.dieTempC = this.tDie;
  }

  private tick(dt: number) {
    const a = state.arch;
    const P = THERMAL[a];
    const load = LOADS[state.workload];
    const onBattery = !state.plugged;
    this.burstPhase -= dt;
    if (this.burstPhase <= 0) {
      this.burstPhase = 0.2 + Math.random() * 1.2;
      this.burstVal = Math.random() < load.burst ? 1 + Math.random() * 2.2 : Math.random() * 0.4;
    }
    const k = 1 - load.burst * 0.5 + load.burst * 0.5 * this.burstVal;
    const cpuDemand = this.sleeping ? 0.05 : load.cpu[a] * k;
    const gpuDemand = this.sleeping ? 0 : load.gpu[a];

    // CPU: PL1/PL2 by running average, battery limit, junction temperature
    let cap = cpuDemand;
    this.limitedBy = 'demand';
    const pl = this.avgPower < P.pl1 ? P.pl2 : P.pl1;
    if (pl < cap) {
      cap = pl;
      this.limitedBy = 'power';
    }
    if (onBattery && P.batteryCpu < cap) {
      cap = P.batteryCpu;
      this.limitedBy = 'battery';
    }
    // a busy GPU takes its share of the shared cooling and power budget first
    if (P.combined && gpuDemand > 0) {
      const share = Math.max(35, P.combined - this.gpuPower);
      if (share < cap) {
        cap = share;
        this.limitedBy = 'power';
      }
    }
    if (this.tDie > P.tjMax - 3) {
      const hold = (P.tjMax - this.tBody) / P.Rcpu + (P.tjMax - this.tDie) * 2;
      if (hold < cap) {
        cap = Math.max(0.3, hold);
        this.limitedBy = 'thermal';
      }
    }
    this.power += (cap - this.power) * Math.min(1, dt * 6);
    this.avgPower += ((this.power - this.avgPower) * dt) / P.tau;

    // discrete GPU: board power with dynamic boost when the CPU leaves headroom
    let gcap = 0;
    this.gpuLimitedBy = 'demand';
    if (P.gpuTgp > 0 && gpuDemand > 0) {
      gcap = gpuDemand;
      const tgp = P.gpuTgp + (this.power < 60 ? P.gpuBoost : 0);
      if (tgp < gcap) {
        gcap = tgp;
        this.gpuLimitedBy = 'power';
      }
      if (onBattery && P.batteryGpu < gcap) {
        gcap = P.batteryGpu;
        this.gpuLimitedBy = 'battery';
      }
      if (this.tGpu > P.tgMax - 3) {
        const hold = (P.tgMax - this.tBody) / P.Rgpu + (P.tgMax - this.tGpu) * 3;
        if (hold < gcap) {
          gcap = Math.max(0, hold);
          this.gpuLimitedBy = 'thermal';
        }
      }
    }
    this.gpuPower += (gcap - this.gpuPower) * Math.min(1, dt * 5);

    // clocks from P ∝ f³
    const ratio = Math.max(0, Math.min(1, this.power / Math.max(cpuDemand, 1e-3)));
    this.freq = load.cpu[a] < 3 ? P.fMin + (P.fMax - P.fMin) * 0.22 * ratio : Math.max(P.fMin, P.fMax * Math.cbrt(ratio));
    this.gpuFreq = gpuDemand > 0 ? P.gMax * Math.cbrt(Math.max(0, Math.min(1, this.gpuPower / gpuDemand))) : 0;

    // fans follow the heatsink temperature
    const want = this.tBody < 40 ? 0 : Math.min(1, Math.max(0.3, (this.tBody - 40) / 32)) * P.fanMax;
    this.rpm += (want - this.rpm) * Math.min(1, dt * 0.8);
    const fanF = this.rpm / P.fanMax;
    const Rair = 1 / (1 / P.RairPassive + fanF * (1 / P.RairFan - 1 / P.RairPassive));

    const qCpu = (this.tDie - this.tBody) / P.Rcpu;
    const qGpu = P.gpuTgp > 0 ? (this.tGpu - this.tBody) / P.Rgpu : 0;
    const qAir = (this.tBody - this.ambient) / Rair;
    this.tDie += ((this.power - qCpu) / P.CcpuDie) * dt;
    if (P.gpuTgp > 0) this.tGpu += ((this.gpuPower - qGpu) / P.CgpuDie) * dt;
    this.tBody += ((qCpu + qGpu - qAir) / P.Csink) * dt;
    this.simTime += dt;

    // battery and charger
    const s = SPEC[a];
    const sys = this.systemW();
    if (onBattery) {
      this.adapterW = 0;
      this.batteryW = -sys;
    } else {
      const pct = this.batteryPct();
      // constant current, then constant voltage: the current tapers as the cells approach full
      const top = this.chargeLimit * 100;
      const taper = this.chargeLimit < 1 ? 5 : 20;
      const want = pct < top - taper ? s.chargeMaxW : s.chargeMaxW * Math.max(0, (top - pct) / taper);
      const avail = s.charger.watts * 0.95;
      this.adapterW = Math.min(avail, sys + want);
      this.batteryW = this.adapterW - sys;
    }
    this.batteryWh = Math.max(0, Math.min(s.batteryWh, this.batteryWh + (this.batteryW * dt) / 3600));

    if (this.jobRunning) {
      const fr = (this.freq / P.fMax) * (P.gpuTgp ? 0.7 : 1) + (P.gpuTgp ? 0.3 * (this.gpuFreq / P.gMax) : 0);
      this.jobWork += fr * load.speed[a] * dt;
      this.jobEnergy += (sys * dt) / 3600;
      if (this.jobWork >= JOB_WORK) {
        this.jobRunning = false;
        this.onJobDone(this.simTime - this.jobStart, this.jobEnergy);
      }
    }
    const last = this.hist[this.hist.length - 1];
    if (!last || this.simTime - last.t >= 1) {
      this.hist.push({ t: this.simTime, tj: this.tDie, tg: this.tGpu, p: this.power, pg: this.gpuPower, f: this.freq, pct: this.batteryPct() });
      if (this.hist.length > 900) this.hist.shift();
    }
  }

  /** open-circuit voltage of one high-voltage cobalt-oxide cell (3.87 V nominal, 4.4 V full) at a state of charge */
  static ocv(pct: number) {
    const T: [number, number][] = [[0, 3.0], [5, 3.45], [10, 3.6], [20, 3.7], [40, 3.8], [60, 3.92], [80, 4.1], [90, 4.22], [100, 4.4]];
    for (let i = 1; i < T.length; i++) if (pct <= T[i][0]) return T[i - 1][1] + ((pct - T[i - 1][0]) / (T[i][0] - T[i - 1][0])) * (T[i][1] - T[i - 1][1]);
    return 4.4;
  }

  /** terminal voltage of one cell under the present current (positive = charging) */
  cellVolts() {
    const s = SPEC[state.arch];
    const amps = this.batteryW / s.packV;
    return ThermalSim.ocv(this.batteryPct()) + amps * 0.045;
  }

  heatOut() {
    const P = THERMAL[state.arch];
    const fanF = this.rpm / P.fanMax;
    const Rair = 1 / (1 / P.RairPassive + fanF * (1 / P.RairFan - 1 / P.RairPassive));
    return (this.tBody - this.ambient) / Rair;
  }

  heatDieToBody() {
    const P = THERMAL[state.arch];
    return (this.tDie - this.tBody) / P.Rcpu + (P.gpuTgp ? (this.tGpu - this.tBody) / P.Rgpu : 0);
  }

  noiseDb() {
    const P = THERMAL[state.arch];
    if (this.rpm < 100) return 0;
    const n = P.fanMax > 5000 ? 54 : 34;
    return 18 + (n - 18) * Math.pow(this.rpm / P.fanMax, 1.4);
  }
}

export const thermal = new ThermalSim();
