// A small but honest out-of-order core model.
//
// 1. A functional executor runs the real program (AArch64 or x86-64) on real data and emits the
//    dynamic µop trace: what each µop reads, writes, and how long it takes.
// 2. A cycle-level timing model replays that trace through fetch, rename, a reorder buffer,
//    a scheduler with limited ports, execution and in-order retirement.
//
// Left out on purpose: wrong-path execution (modelled as a fetch stall), memory disambiguation,
// prefetchers, cache misses that vary per access, and register-file port limits.
import type { Arch } from '../core/state';

export type UopKind = 'alu' | 'mul' | 'load' | 'br';

export interface StaticInstr {
  asm: string;
  bytes: number[];
  /** how many µops this instruction becomes */
  uops: number;
  note?: string;
}

export interface Uop {
  id: number;
  instr: number; // static instruction index
  first: boolean; // first µop of its instruction (counts as an instruction at retire)
  text: string;
  kind: UopKind;
  srcs: number[]; // producer µop ids (−1 = ready from the start)
  /** producer of each source, with which output of the producer (0 = main, 1 = base writeback) */
  srcOut: number[];
  /** cycles after issue at which each source is actually needed (accumulator forwarding) */
  late: number[];
  /** architectural instructions completed when this µop retires */
  ninstr: number;
  lat: number;
  baseLat?: number; // post-index address writeback latency
  mispredict: boolean;
  iter: number;
  // timing (cycle numbers, −1 = not yet)
  fetch: number;
  ren: number;
  iss: number;
  done: number;
  doneBase: number;
  ret: number;
  port: number;
}

export interface Program {
  id: 'one' | 'two';
  label: string;
  arch: Arch;
  listing: StaticInstr[];
  uops: Uop[];
  result: { reg: string; value: number; expect: number };
  instrCount: number;
}

export interface CoreConfig {
  width: number;
  rob: number;
  ooo: boolean;
  memLat: number;
  predictor: boolean;
  ports: Record<UopKind, number>;
}

const N = 32; // array elements
const A = Array.from({ length: N }, (_, i) => i + 1);
const B = Array.from({ length: N }, (_, i) => ((i * 7) % 5) + 1);
const EXPECT = A.reduce((s, a, i) => s + a * B[i], 0);
const hex = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

export const LISTINGS: Record<Arch, Record<'one' | 'two', StaticInstr[]>> = {
  arm: {
    one: [
      { asm: 'ldr  x2, [x0], #8', bytes: hex(0xf8408402), uops: 1, note: 'load a[i], then x0 += 8' },
      { asm: 'ldr  x4, [x1], #8', bytes: hex(0xf8408424), uops: 1, note: 'load b[i], then x1 += 8' },
      { asm: 'madd x5, x2, x4, x5', bytes: hex(0x9b041445), uops: 1, note: 'x5 += x2 × x4' },
      { asm: 'subs x3, x3, #1', bytes: hex(0xf1000463), uops: 1, note: 'count down, set flags' },
      { asm: 'b.ne loop', bytes: hex(0x54ffff81), uops: 1, note: 'repeat while not zero' },
    ],
    two: [
      { asm: 'ldr  x2, [x0], #8', bytes: hex(0xf8408402), uops: 1 },
      { asm: 'ldr  x4, [x1], #8', bytes: hex(0xf8408424), uops: 1 },
      { asm: 'ldr  x6, [x0], #8', bytes: hex(0xf8408406), uops: 1 },
      { asm: 'ldr  x7, [x1], #8', bytes: hex(0xf8408427), uops: 1 },
      { asm: 'madd x5, x2, x4, x5', bytes: hex(0x9b041445), uops: 1, note: 'first accumulator' },
      { asm: 'madd x8, x6, x7, x8', bytes: hex(0x9b0720c8), uops: 1, note: 'second, independent' },
      { asm: 'subs x3, x3, #2', bytes: hex(0xf1000863), uops: 1 },
      { asm: 'b.ne loop', bytes: hex(0x54ffff21), uops: 1 },
    ],
  },
  x86: {
    one: [
      { asm: 'mov  rdx, [rdi]', bytes: [0x48, 0x8b, 0x17], uops: 1, note: 'load a[i]' },
      { asm: 'imul rdx, [rsi]', bytes: [0x48, 0x0f, 0xaf, 0x16], uops: 2, note: 'load b[i] + multiply: 2 µops' },
      { asm: 'add  rax, rdx', bytes: [0x48, 0x01, 0xd0], uops: 1, note: 'accumulate' },
      { asm: 'add  rdi, 8', bytes: [0x48, 0x83, 0xc7, 0x08], uops: 1 },
      { asm: 'add  rsi, 8', bytes: [0x48, 0x83, 0xc6, 0x08], uops: 1 },
      { asm: 'dec  rcx', bytes: [0x48, 0xff, 0xc9], uops: 1, note: 'fused with the jump: 1 µop' },
      { asm: 'jnz  loop', bytes: [0x75, 0xe9], uops: 0 },
    ],
    two: [
      { asm: 'mov  rdx, [rdi]', bytes: [0x48, 0x8b, 0x17], uops: 1 },
      { asm: 'imul rdx, [rsi]', bytes: [0x48, 0x0f, 0xaf, 0x16], uops: 2 },
      { asm: 'add  rax, rdx', bytes: [0x48, 0x01, 0xd0], uops: 1, note: 'first accumulator' },
      { asm: 'mov  r8, [rdi+8]', bytes: [0x4c, 0x8b, 0x47, 0x08], uops: 1 },
      { asm: 'imul r8, [rsi+8]', bytes: [0x4c, 0x0f, 0xaf, 0x46, 0x08], uops: 2 },
      { asm: 'add  r9, r8', bytes: [0x4d, 0x01, 0xc1], uops: 1, note: 'second, independent' },
      { asm: 'add  rdi, 16', bytes: [0x48, 0x83, 0xc7, 0x10], uops: 1 },
      { asm: 'add  rsi, 16', bytes: [0x48, 0x83, 0xc6, 0x10], uops: 1 },
      { asm: 'sub  rcx, 2', bytes: [0x48, 0x83, 0xe9, 0x02], uops: 1, note: 'fused with the jump' },
      { asm: 'jnz  loop', bytes: [0x75, 0xdc], uops: 0 },
    ],
  },
};

/** Build the dynamic µop trace by actually running the loop. */
export function buildProgram(arch: Arch, id: 'one' | 'two', memLat: number): Program {
  const uops: Uop[] = [];
  const lastWriter = new Map<string, [number, number]>(); // reg -> [uop id, output]
  const R: Record<string, number> = {};
  const emit = (instr: number, first: boolean, text: string, kind: UopKind, reads: string[], writes: string[], lat: number, iter: number, base?: string, mispredict = false, late: number[] = [], ninstr = first ? 1 : 0) => {
    const id_ = uops.length;
    const srcs: number[] = [];
    const srcOut: number[] = [];
    for (const r of reads) {
      const w = lastWriter.get(r);
      srcs.push(w ? w[0] : -1);
      srcOut.push(w ? w[1] : 0);
    }
    const u: Uop = { id: id_, instr, first, text, kind, srcs, srcOut, late: reads.map((_, i) => late[i] ?? 0), ninstr, lat, baseLat: base ? 1 : undefined, mispredict, iter, fetch: -1, ren: -1, iss: -1, done: -1, doneBase: -1, ret: -1, port: -1 };
    uops.push(u);
    for (const w of writes) lastWriter.set(w, [id_, 0]);
    if (base) lastWriter.set(base, [id_, 1]);
    return u;
  };
  const listing = LISTINGS[arch][id];
  let instrCount = 0;
  const MUL = 3;
  if (arch === 'arm') {
    R.x0 = 0; R.x1 = 0; R.x3 = N; R.x5 = 0; R.x8 = 0;
    let ia = 0, ib = 0, iter = 0;
    for (;;) {
      if (id === 'one') {
        R.x2 = A[ia++]; emit(0, true, 'ldr x2', 'load', ['x0'], ['x2'], memLat, iter, 'x0');
        R.x4 = B[ib++]; emit(1, true, 'ldr x4', 'load', ['x1'], ['x4'], memLat, iter, 'x1');
        R.x5 += R.x2 * R.x4; emit(2, true, 'madd x5', 'mul', ['x2', 'x4', 'x5'], ['x5'], MUL, iter, undefined, false, [0, 0, 2]);
        R.x3 -= 1; emit(3, true, 'subs x3', 'alu', ['x3'], ['x3', 'nzcv'], 1, iter);
        const taken = R.x3 !== 0;
        emit(4, true, 'b.ne', 'br', ['nzcv'], [], 1, iter, undefined, !taken);
        instrCount += 5;
        if (!taken) break;
      } else {
        R.x2 = A[ia++]; emit(0, true, 'ldr x2', 'load', ['x0'], ['x2'], memLat, iter, 'x0');
        R.x4 = B[ib++]; emit(1, true, 'ldr x4', 'load', ['x1'], ['x4'], memLat, iter, 'x1');
        R.x6 = A[ia++]; emit(2, true, 'ldr x6', 'load', ['x0'], ['x6'], memLat, iter, 'x0');
        R.x7 = B[ib++]; emit(3, true, 'ldr x7', 'load', ['x1'], ['x7'], memLat, iter, 'x1');
        R.x5 += R.x2 * R.x4; emit(4, true, 'madd x5', 'mul', ['x2', 'x4', 'x5'], ['x5'], MUL, iter, undefined, false, [0, 0, 2]);
        R.x8 += R.x6 * R.x7; emit(5, true, 'madd x8', 'mul', ['x6', 'x7', 'x8'], ['x8'], MUL, iter, undefined, false, [0, 0, 2]);
        R.x3 -= 2; emit(6, true, 'subs x3', 'alu', ['x3'], ['x3', 'nzcv'], 1, iter);
        const taken = R.x3 !== 0;
        emit(7, true, 'b.ne', 'br', ['nzcv'], [], 1, iter, undefined, !taken);
        instrCount += 8;
        if (!taken) break;
      }
      iter++;
    }
    const value = id === 'one' ? R.x5 : R.x5 + R.x8;
    return { id, label: id === 'one' ? 'One accumulator' : 'Two accumulators', arch, listing, uops, result: { reg: id === 'one' ? 'x5' : 'x5 + x8', value, expect: EXPECT }, instrCount };
  }
  R.rdi = 0; R.rsi = 0; R.rcx = N; R.rax = 0; R.r9 = 0;
  let ia = 0, ib = 0, iter = 0;
  for (;;) {
    if (id === 'one') {
      R.rdx = A[ia++]; emit(0, true, 'mov rdx', 'load', ['rdi'], ['rdx'], memLat, iter);
      const t = B[ib++]; emit(1, true, 'load (imul)', 'load', ['rsi'], ['t0'], memLat, iter);
      R.rdx *= t; emit(1, false, 'imul rdx', 'mul', ['rdx', 't0'], ['rdx'], MUL, iter);
      R.rax += R.rdx; emit(2, true, 'add rax', 'alu', ['rax', 'rdx'], ['rax'], 1, iter);
      R.rdi += 8; emit(3, true, 'add rdi', 'alu', ['rdi'], ['rdi'], 1, iter);
      R.rsi += 8; emit(4, true, 'add rsi', 'alu', ['rsi'], ['rsi'], 1, iter);
      R.rcx -= 1;
      const taken = R.rcx !== 0;
      emit(5, true, 'dec+jnz', 'br', ['rcx'], ['rcx'], 1, iter, undefined, !taken, [], 2);
      instrCount += 7;
      if (!taken) break;
    } else {
      R.rdx = A[ia++]; emit(0, true, 'mov rdx', 'load', ['rdi'], ['rdx'], memLat, iter);
      let t = B[ib++]; emit(1, true, 'load (imul)', 'load', ['rsi'], ['t0'], memLat, iter);
      R.rdx *= t; emit(1, false, 'imul rdx', 'mul', ['rdx', 't0'], ['rdx'], MUL, iter);
      R.rax += R.rdx; emit(2, true, 'add rax', 'alu', ['rax', 'rdx'], ['rax'], 1, iter);
      R.r8 = A[ia++]; emit(3, true, 'mov r8', 'load', ['rdi'], ['r8'], memLat, iter);
      t = B[ib++]; emit(4, true, 'load (imul)', 'load', ['rsi'], ['t1'], memLat, iter);
      R.r8 *= t; emit(4, false, 'imul r8', 'mul', ['r8', 't1'], ['r8'], MUL, iter);
      R.r9 += R.r8; emit(5, true, 'add r9', 'alu', ['r9', 'r8'], ['r9'], 1, iter);
      R.rdi += 16; emit(6, true, 'add rdi', 'alu', ['rdi'], ['rdi'], 1, iter);
      R.rsi += 16; emit(7, true, 'add rsi', 'alu', ['rsi'], ['rsi'], 1, iter);
      R.rcx -= 2;
      const taken = R.rcx !== 0;
      emit(8, true, 'sub+jnz', 'br', ['rcx'], ['rcx'], 1, iter, undefined, !taken, [], 2);
      instrCount += 10;
      if (!taken) break;
    }
    iter++;
  }
  const value = id === 'one' ? R.rax : R.rax + R.r9;
  return { id, label: id === 'one' ? 'One accumulator' : 'Two accumulators', arch, listing, uops, result: { reg: id === 'one' ? 'rax' : 'rax + r9', value, expect: EXPECT }, instrCount };
}

export const FRONT_END_DEPTH = 4; // cycles from fetch to rename
export const REDIRECT = 12; // extra cycles to refill the front end after a mispredict

export class Core {
  cycle = 0;
  fetchPtr = 0;
  robHead = 0;
  retired = 0;
  retiredInstr = 0;
  mispredicts = 0;
  private fetchResume = 0;
  private waitBranch = -1;
  done = false;
  occupancy: number[] = [];

  constructor(public prog: Program, public cfg: CoreConfig) {
    for (const u of prog.uops) {
      u.fetch = u.ren = u.iss = u.done = u.doneBase = u.ret = u.port = -1;
    }
  }

  /** when is output `out` of µop `id` usable */
  private avail(id: number, out: number): number {
    if (id < 0) return -Infinity;
    const p = this.prog.uops[id];
    if (p.iss < 0) return Infinity;
    return out === 1 ? p.doneBase : p.done;
  }

  step() {
    if (this.done) return;
    const c = this.cycle;
    const U = this.prog.uops;
    const W = this.cfg.width;
    // retire, in order
    let n = 0;
    while (this.robHead < U.length && n < W) {
      const u = U[this.robHead];
      if (u.done < 0 || u.done > c) break;
      u.ret = c;
      this.robHead++;
      this.retired++;
      this.retiredInstr += u.ninstr;
      n++;
    }
    // issue: oldest first, limited by ports; in-order mode stops at the first stall
    const used: Record<UopKind, number> = { alu: 0, mul: 0, load: 0, br: 0 };
    let issued = 0;
    for (let i = this.robHead; i < this.fetchPtr && issued < W; i++) {
      const u = U[i];
      if (u.ren < 0 || u.ren >= c) break;
      if (u.iss >= 0) continue;
      let ready = true;
      for (let k = 0; k < u.srcs.length; k++) if (this.avail(u.srcs[k], u.srcOut[k]) > c + u.late[k]) ready = false;
      const kind = u.kind === 'mul' ? 'mul' : u.kind;
      const portFree = used[kind] < this.cfg.ports[kind] && !(kind === 'br' && used.alu >= this.cfg.ports.alu);
      if (ready && portFree) {
        u.iss = c;
        u.done = c + u.lat;
        u.doneBase = c + (u.baseLat ?? u.lat);
        u.port = used[kind];
        used[kind]++;
        issued++;
        if (u.id === this.waitBranch) {
          this.fetchResume = u.done + REDIRECT;
          this.waitBranch = -1;
        }
      } else if (!this.cfg.ooo) break;
    }
    // rename into the ROB
    n = 0;
    for (let i = 0; i < this.fetchPtr && n < W; i++) {
      const u = U[i];
      if (u.ren >= 0) continue;
      if (u.fetch < 0 || c - u.fetch < FRONT_END_DEPTH) break;
      const inRob = i - this.robHead;
      if (inRob >= this.cfg.rob) break;
      u.ren = c;
      n++;
    }
    // fetch: stops behind a mispredicted branch until it resolves
    if (c >= this.fetchResume && this.waitBranch < 0) {
      const queued = U.slice(this.robHead, this.fetchPtr).filter((u) => u.ren < 0).length;
      n = 0;
      while (this.fetchPtr < U.length && n < W && queued + n < W * (FRONT_END_DEPTH + 2)) {
        const u = U[this.fetchPtr++];
        u.fetch = c;
        n++;
        if (u.kind === 'br' && (!this.cfg.predictor ? !u.mispredict : u.mispredict)) {
          // predictor off means "predict not taken": every taken loop branch is a miss
          this.mispredicts++;
          this.waitBranch = u.id;
          this.fetchResume = Infinity;
          break;
        }
      }
    }
    this.occupancy.push(this.fetchPtr - this.robHead);
    this.cycle++;
    if (this.robHead >= U.length) this.done = true;
  }

  runToEnd(limit = 200000) {
    while (!this.done && this.cycle < limit) this.step();
  }

  ipc() {
    return this.cycle ? this.retiredInstr / this.cycle : 0;
  }

  robNow() {
    return this.fetchPtr - this.robHead;
  }
}

export const PORTS: Record<Arch, Record<UopKind, number>> = {
  arm: { alu: 6, mul: 2, load: 4, br: 2 },
  x86: { alu: 6, mul: 1, load: 3, br: 2 },
};
