// Shared state across sheets: which machine is on the bench, what it is doing,
// and the revision record of experiments the visitor has run.

export type Arch = 'arm' | 'x86';
export type Detail = 'rookie' | 'grind';
export type Workload = 'idle' | 'type' | 'web' | 'video' | 'call' | 'export' | 'game' | 'ai';

type Fn = () => void;

class Emitter {
  private fns = new Map<string, Set<Fn>>();
  on(ev: string, fn: Fn) {
    if (!this.fns.has(ev)) this.fns.set(ev, new Set());
    this.fns.get(ev)!.add(fn);
    return () => this.fns.get(ev)!.delete(fn);
  }
  emit(ev: string) {
    this.fns.get(ev)?.forEach((f) => f());
  }
}

export interface Revision {
  letter: string;
  sheet: number;
  note: string;
}

class State extends Emitter {
  arch: Arch = 'arm';
  workload: Workload = 'web';
  detail: Detail = 'rookie';
  /** charger connected */
  plugged = false;
  /** live package power (W) from the thermal model, read by other sheets */
  packageW = 4;
  dieTempC = 42;
  revisions: Revision[] = [];
  private revCount = 0;

  setArch(a: Arch) {
    if (a === this.arch) return;
    this.arch = a;
    this.emit('arch');
  }

  setDetail(d: Detail) {
    if (d === this.detail) return;
    this.detail = d;
    document.documentElement.dataset.detail = d;
    this.emit('detail');
  }

  setPlugged(p: boolean) {
    if (p === this.plugged) return;
    this.plugged = p;
    this.emit('plugged');
  }

  setWorkload(w: Workload) {
    if (w === this.workload) return;
    this.workload = w;
    this.emit('workload');
  }

  /** Append to the revision table. Repeats of the same note on the same sheet replace the last row. */
  revise(sheet: number, note: string) {
    const last = this.revisions[this.revisions.length - 1];
    if (last && last.sheet === sheet && last.note.split(':')[0] === note.split(':')[0]) {
      last.note = note;
    } else {
      // letters run A to Z, then AA, AB… and keep counting after the oldest rows drop off
      const i = this.revCount++;
      const letter = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
      this.revisions.push({ letter, sheet, note });
      if (this.revisions.length > 40) this.revisions.shift();
    }
    this.emit('revision');
  }
}

export const state = new State();
