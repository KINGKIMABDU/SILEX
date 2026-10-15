import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';

import { Stage, formatRatio } from './core/stage';
import { state } from './core/state';
import { SPEC } from './core/specs';
import { h, facts, rich } from './core/ui';
import type { Sheet, Ref } from './core/sheet';
import { SHEETS } from './sheets';
import { thermal } from './sim/thermal';
import { setTheme, getTheme, type Theme } from './core/theme';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}


function boot() {
  const sheets: Sheet[] = SHEETS.map((S) => new S());
  const rail = $('rail');
  const spec = $('spec');
  const tb = $('titleblock');
  const figNo = $('fig-no');
  const figSub = $('fig-sub');
  const hint = $('hint');

  let current = 0;
  let mode: 'sheet' | 'notes' | 'revisions' = 'sheet';

  const stage = new Stage(
    $('gl') as HTMLCanvasElement,
    $('stage'),
    document.getElementById('overlay') as unknown as SVGSVGElement,
    $('labels'),
    $('veil'),
    [$('labels'), document.getElementById('overlay') as unknown as HTMLElement, $('fig')],
    (n) => go(n - 1),
  );

  // ---------- rail ----------
  const railItems = sheets.map((s, i) =>
    h(
      'button',
      { type: 'button', class: 'rail-item', onclick: () => go(i), 'aria-label': `Sheet ${s.no}: ${s.title}` },
      h('span', { class: 'rail-no' }, String(s.no)),
      h('span', { class: 'rail-name' }, s.short),
      h('span', { class: 'rail-scale' }, ''),
    ),
  );
  rail.append(...railItems);

  const paintRailScales = () => {
    sheets.forEach((s, i) => {
      (railItems[i].querySelector('.rail-scale') as HTMLElement).innerHTML = rich(formatRatio(stage.restRatio(s)));
    });
  };

  // ---------- title block ----------
  const tbScale = h('strong', { class: 'tb-val tnum' }, '');
  const tbSheet = h('strong', { class: 'tb-val tnum' }, '');
  const tbMachine = h('strong', { class: 'tb-val' }, '');
  const tbRev = h('strong', { class: 'tb-val' }, '–');
  const cell = (label: string, val: HTMLElement | string, cls = '', onClick?: () => void, title?: string) => {
    const tag = onClick ? 'button' : 'div';
    const el = h(tag as 'div', { class: `tb-cell ${cls}`, type: onClick ? 'button' : undefined, onclick: onClick, title }, h('span', { class: 'tb-label' }, label), typeof val === 'string' ? h('strong', { class: 'tb-val' }, val) : val);
    return el;
  };
  const tbTheme = h('strong', { class: 'tb-val' }, '');
  const tbDetail = h('strong', { class: 'tb-val' }, '');
  const tbPower = h('strong', { class: 'tb-val' }, '');
  const store = (k: string, v?: string) => {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch {
      /* private mode: preferences just do not persist */
    }
    return null;
  };
  const paintToggles = () => {
    tbTheme.textContent = getTheme() === 'dark' ? 'Graphite' : 'Light';
    tbDetail.textContent = state.detail === 'grind' ? 'Grind' : 'Rookie';
    tbPower.innerHTML = state.plugged ? '<span class="tb-plug on">Plugged</span>' : '<span class="tb-plug">Battery</span>';
  };
  tb.append(
    h('button', { type: 'button', class: 'tb-cell tb-name', onclick: () => setMode(mode === 'notes' ? 'sheet' : 'notes'), title: 'About SILEX, notes and credits' }, h('span', { class: 'tb-word' }, 'SILEX'), h('span', { class: 'tb-tag' }, 'a laptop, drawn to the atom')),
    cell('Sheet', tbSheet),
    cell('Scale', tbScale, '', () => stage.resetView(), 'Reset to the sheet scale'),
    cell('Rev', tbRev, '', () => setMode(mode === 'revisions' ? 'sheet' : 'revisions'), 'Revision record of your experiments'),
    cell('Machine', tbMachine, 'tb-machine', () => state.setArch(state.arch === 'arm' ? 'x86' : 'arm'), 'Swap the machine on the bench'),
    cell('Notes', 'Read', 'tb-notes', () => setMode(mode === 'notes' ? 'sheet' : 'notes'), 'General notes, sources and credits'),
    h('a', { class: 'tb-cell tb-drawn', href: 'https://kingkimabdu.github.io/', target: '_blank', rel: 'noopener', title: 'Abdullah Alhariri, who drew this' }, h('span', { class: 'tb-label' }, 'Drawn by'), h('strong', { class: 'tb-val' }, 'KINGKIMABDU')),
    cell('Theme', tbTheme, '', () => {
      const t: Theme = getTheme() === 'dark' ? 'light' : 'dark';
      setTheme(t);
      store('silex-theme', t);
      paintToggles();
    }, 'Switch between light and graphite'),
    cell('Detail', tbDetail, '', () => {
      state.setDetail(state.detail === 'grind' ? 'rookie' : 'grind');
      store('silex-detail', state.detail);
      paintToggles();
    }, 'Rookie: the essentials. Grind: every number, every control'),
    cell('Power', tbPower, '', () => {
      state.setPlugged(!state.plugged);
      state.revise(sheets[current].no, state.plugged ? 'Charger plugged in' : 'Charger unplugged: running on battery');
      paintToggles();
    }, 'Plug the charger in or out'),
  );
  // restore preferences; first visit follows the system theme
  const savedTheme = store('silex-theme') as Theme | null;
  setTheme(savedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const savedDetail = store('silex-detail');
  state.setDetail(savedDetail === 'grind' ? 'grind' : 'rookie');
  document.documentElement.dataset.detail = state.detail;
  paintToggles();
  state.on('plugged', paintToggles);
  state.on('detail', () => {
    paintToggles();
    if (mode === 'sheet') {
      const s = sheets[current];
      renderLegend(s);
    }
  });

  const paintMachine = () => {
    tbMachine.innerHTML = `<span class="tb-long">${SPEC[state.arch].short}</span><span class="tb-short">${state.arch === 'arm' ? 'ARM' : 'x86'}</span>`;
  };
  state.on('arch', () => {
    paintMachine();
    requestAnimationFrame(paintRailScales);
    state.revise(sheets[current].no, `Machine swapped: ${SPEC[state.arch].short}`);
  });
  paintMachine();
  state.on('revision', () => {
    const r = state.revisions[state.revisions.length - 1];
    tbRev.textContent = r ? r.letter : '–';
    tbRev.title = r ? r.note : '';
    if (mode === 'revisions') renderSpec();
  });

  // ---------- spec column ----------
  const panels = new Map<Sheet, HTMLElement>();
  let legend: HTMLElement | null = null;
  let card: HTMLElement | null = null;

  const renderCard = (_s: Sheet, r: Ref | null) => {
    if (!card) return;
    legend?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.n === String(r?.n)));
    if (!r) {
      card.replaceChildren(h('p', { class: 'note' }, 'Select a numeral on the drawing, or a part itself, to read what it does.'));
      return;
    }
    card.replaceChildren(...([
      h('div', { class: 'card-head' }, h('span', { class: 'card-n' }, String(r.n)), h('h3', { class: 'card-name' }, r.name)),
      h('p', { html: rich(r.text) }),
      r.facts ? facts(r.facts) : null,
      r.see ? h('button', { type: 'button', class: 'btn btn-link', onclick: () => go(r.see! - 1) }, `Continue inside, FIG. ${r.see}`) : null,
    ].filter(Boolean) as Node[]));
  };

  const renderLegend = (s: Sheet) => {
    if (!legend) return;
    legend.replaceChildren(
      ...s.refs.filter((r) => !(r.grind && state.detail === 'rookie')).map((r) =>
        h('li', null, h('button', { type: 'button', 'data-n': String(r.n), onclick: () => s.select(r) }, h('span', { class: 'lg-n' }, String(r.n)), h('span', { class: 'lg-name' }, r.name))),
      ),
    );
  };

  const renderSpec = () => {
    const s = sheets[current];
    spec.scrollTop = 0;
    if (mode === 'notes') {
      spec.replaceChildren(notesView());
      return;
    }
    if (mode === 'revisions') {
      spec.replaceChildren(revisionsView());
      return;
    }
    let p = panels.get(s);
    if (!p) {
      p = s.panel();
      panels.set(s, p);
    }
    legend = h('ol', { class: 'legend' });
    card = h('div', { class: 'card' });
    renderLegend(s);
    renderCard(s, s.selected);
    const next = sheets[current + 1];
    const forward = next
      ? h('button', { type: 'button', class: 'btn btn-primary btn-go', onclick: () => go(current + 1) }, h('span', null, COPY[next.short]?.go ?? `Go to ${next.title.toLowerCase()}`), h('span', { class: 'btn-fig' }, `FIG. ${next.no}`))
      : h('button', { type: 'button', class: 'btn btn-primary btn-go', onclick: () => go(0) }, h('span', null, 'Back out to the machine'), h('span', { class: 'btn-fig' }, 'FIG. 1'));
    const more = h('div', { class: 'more', 'aria-hidden': 'true' }, 'More on this sheet below');
    spec.replaceChildren(
      h('header', { class: 'spec-head' }, h('h2', null, s.title), h('p', { class: 'lede' }, COPY[s.short]?.lede ?? ''), forward),
      p,
      h('section', { class: 'spec-sec' }, h('h3', { class: 'sec-title' }, 'Reference numerals'), legend, card),
      h(
        'nav',
        { class: 'spec-nav' },
        current > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => go(current - 1) }, `Back to FIG. ${current}`) : null,
        next ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(current + 1) }, `Go deeper: FIG. ${next.no}, ${next.title.toLowerCase()}`) : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(0) }, 'Back out to the machine'),
      ),
      more,
    );
    paintMore();
  };

  // a cue at the bottom edge of the spec column while there is more to read
  const paintMore = () => {
    const m = spec.querySelector('.more') as HTMLElement | null;
    if (m) m.classList.toggle('gone', spec.scrollTop + spec.clientHeight >= spec.scrollHeight - 24);
  };
  spec.addEventListener('scroll', paintMore, { passive: true });
  new ResizeObserver(paintMore).observe(spec);

  const setMode = (m: typeof mode) => {
    mode = m;
    renderSpec();
  };

  const notesView = () =>
    h(
      'div',
      { class: 'notes' },
      h('header', { class: 'spec-head' }, h('h2', null, 'General notes'), h('p', { class: 'lede' }, 'How to read this drawing, what it simplifies, and who drew it.')),
      h(
        'ol',
        { class: 'notes-list' },
        h('li', null, 'The two machines are drawn from published dimensions and review photographs of two real laptops. The ARM machine is modelled on the Samsung Galaxy Book4 Edge 16 (Snapdragon X Elite) and the x86 machine on the ASUS ROG Strix SCAR 16 (2025, Core Ultra 9 275HX with a GeForce RTX 5090 Laptop GPU). Outside dimensions, port positions, chargers and cooling layouts follow those machines; power, chip and memory figures are typical values for their class. Neither maker\'s logos or markings are reproduced.'),
        h('li', null, 'Every sheet is drawn at true scale. The SCALE field compares the size of the drawing on your screen with the real object, using the CSS reference pixel of 1/96 inch, so it is exact on a standard display and close on others.'),
        h('li', null, 'The simulations are simplified physical models, not vendor data: a two-node thermal network with power limits, a timing model of an out-of-order core running a real program, an event-driven logic simulator, a compact transistor model, and the measured crystal geometry of silicon. Each sheet says what its model leaves out.'),
        h('li', null, 'Line convention: a solid red line is carrying current or heat right now. Black is the drawing. Dashed lines are idle paths; gapped lines are switched off.'),
        h('li', null, 'Process names such as "3 nm" are marketing generations, not a measurement. Sheet 12 dimensions the real features.'),
        h('li', null, 'Keyboard: ↑ and ↓ move between sheets, digits 1 to 9 jump to a sheet (except on sheet 1, where the keyboard types). Drag to turn the drawing, scroll or pinch to zoom, double-click to reset.'),
      ),
      h('h3', { class: 'sec-title' }, 'Credits'),
      h('p', null, 'Concept, drawing, simulations and code by ', h('a', { href: 'https://kingkimabdu.github.io/', target: '_blank', rel: 'noopener' }, 'KINGKIMABDU (Abdullah Alhariri)'), '. Source on ', h('a', { href: 'https://github.com/KINGKIMABDU/SILEX', target: '_blank', rel: 'noopener' }, 'GitHub'), ', released under the MIT licence. Built with three.js; typeset in Barlow and JetBrains Mono. ', h('a', { href: `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`, target: '_blank', rel: 'noopener' }, 'Third-party notices'), '.'),
      h('p', { class: 'note' }, 'Not affiliated with or endorsed by Samsung, ASUS, Qualcomm, Intel, NVIDIA or Microsoft. Product and component names are trademarks of their owners and are used only to identify the hardware these drawings are based on. The desktop on the screens is an original, generic one.'),
      h('button', { type: 'button', class: 'btn', onclick: () => setMode('sheet') }, 'Back to the sheet'),
    );

  const revisionsView = () => {
    const rows = state.revisions.slice().reverse();
    return h(
      'div',
      null,
      h('header', { class: 'spec-head' }, h('h2', null, 'Revision record'), h('p', { class: 'lede' }, 'Every experiment you run is entered here, newest first. Select a row to return to its sheet.')),
      rows.length
        ? h(
            'table',
            { class: 'revs' },
            h('thead', null, h('tr', null, h('th', null, 'Rev'), h('th', null, 'Sheet'), h('th', null, 'Change'))),
            h(
              'tbody',
              null,
              ...rows.map((r) =>
                h(
                  'tr',
                  { tabindex: '0', onclick: () => go(r.sheet - 1, true), onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && go(r.sheet - 1, true) },
                  h('td', null, r.letter),
                  h('td', null, String(r.sheet)),
                  h('td', null, r.note),
                ),
              ),
            ),
          )
        : h('p', { class: 'note' }, 'Nothing recorded yet. Open the lid, press a key, run a workload.'),
      h('button', { type: 'button', class: 'btn', onclick: () => setMode('sheet') }, 'Back to the sheet'),
    );
  };

  // ---------- sheets ----------
  const wire = (s: Sheet) => {
    s.onSelect = (r) => renderCard(s, r);
    (s as Sheet & { onRebuild?: () => void }).onRebuild = () => {
      if (sheets[current] === s && stage.sheet === s) {
        stage.overlay.attach(s);
        stage.resetView();
        renderLegend(s);
        renderCard(s, null);
        s.selected = null;
      }
    };
  };
  sheets.forEach(wire);

  const paintChrome = () => {
    const s = sheets[current];
    railItems.forEach((b, i) => {
      b.classList.toggle('on', i === current);
      b.setAttribute('aria-current', i === current ? 'step' : 'false');
    });
    figNo.textContent = `FIG. ${s.no}`;
    figSub.textContent = s.sub;
    tbSheet.textContent = `${s.no} of ${sheets.length}`;
    document.title = `SILEX · FIG. ${s.no} ${s.title}`;
  };

  let pending: number | null = null;
  function go(i: number, fromRev = false) {
    if (i < 0 || i >= sheets.length) return;
    if (stage.busy) {
      pending = i;
      return;
    }
    if (i === current && stage.sheet) {
      if (fromRev) setMode('sheet');
      return;
    }
    const target = sheets[i];
    mode = 'sheet';
    current = i;
    history.replaceState(null, '', `#${target.no}`);
    stage
      .transition(target, () => {
        paintChrome();
        renderSpec();
        paintRailScales();
      })
      .then(() => {
        if (pending !== null) {
          const p = pending;
          pending = null;
          go(p);
        }
      });
  }

  // initial sheet from the hash
  const start = Math.min(sheets.length, Math.max(1, parseInt(location.hash.slice(1)) || 1)) - 1;
  current = start;
  stage.show(sheets[start]);
  paintChrome();
  renderSpec();
  paintRailScales();
  hint.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag to turn · pinch to zoom · tap a sheet number above to move' : 'Drag to turn · scroll to zoom · double-click to reset · ↑ ↓ change sheet';

  let lastScale = 0;
  stage.onFrame = (dt) => {
    thermal.step(dt);
    const now = performance.now();
    if (now - lastScale > 100) {
      lastScale = now;
      tbScale.innerHTML = rich(formatRatio(stage.ratio()));
    }
  };
  new ResizeObserver(() => paintRailScales()).observe($('stage'));

  // once the first sheet is up, build the rest and compile their shaders while the visitor reads,
  // so the first dive into a deep sheet does not stall on a slow GPU
  const warm = async () => {
    for (const s of sheets) {
      if (!s.built) {
        s.build();
        s.built = true;
      }
      try {
        await stage.renderer.compileAsync(s.root, stage.camera, stage.scene);
      } catch {
        /* compiling ahead is only an optimisation */
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(() => void warm(), { timeout: 2500 });
  else setTimeout(() => void warm(), 1500);
  if (import.meta.env.DEV) {
    // dev only: drive the camera and sheets from the console while checking drawings
    const cam = (az: number, el: number, zoom: number, t?: [number, number, number]) => {
      const s = stage.sheet!;
      const tgt = s.view.target.clone();
      if (t) tgt.set(...t);
      (stage as unknown as { placeCamera: (v: object, t: unknown, z: number) => void }).placeCamera({ ...s.view, az, el }, tgt, zoom);
    };
    Object.assign(window, { __silex: { stage, state, sheets, go, cam } });
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const inField = t.closest('input, select, textarea, [role="radiogroup"]');
    if (sheets[current].key(e)) return;
    if (inField && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) return;
    const base = pending ?? current;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      go(base + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      go(base - 1);
    } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      go(Number(e.key) - 1);
    } else if (e.key === 'Escape') {
      sheets[current].select(null);
      if (mode !== 'sheet') setMode('sheet');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (sheets[current].keyUp(e)) e.preventDefault();
  });

  window.addEventListener('hashchange', () => {
    const n = parseInt(location.hash.slice(1));
    if (n >= 1 && n <= sheets.length && n - 1 !== current) go(n - 1);
  });
}

/** Per-sheet copy: the lede under the title, and the label of the button that leads into the sheet. */
const COPY: Record<string, { lede: string; go: string }> = {
  machine: { lede: 'A complete computer, drawn to the millimetre. Lift the lid, plug it in, set it to work, and type: every key you press is followed all the way down, to the transistors on sheet 12.', go: 'Back out to the machine' },
  display: { lede: 'Every pixel on the screen, pulled apart layer by layer. Pick a colour and watch the subpixels, the crystal and the light respond.', go: 'Look into the screen' },
  chassis: { lede: 'The base comes off. Run a workload and watch where the heat goes, what the cooling can carry, and what the battery pays for it.', go: 'Open the chassis' },
  power: { lede: 'Where every watt comes from: the charger, the battery cells, and the converters that turn 20 volts into the one volt a processor runs on.', go: 'Follow the power' },
  board: { lede: 'One board carries every chip. Pick a job and follow the bytes from storage to the cores, at the speed each link really runs.', go: 'Lift out the logic board' },
  memory: { lede: 'A bit of memory is about sixty thousand electrons in a capacitor that leaks. Write one, read it back, and watch the refresh race the leak.', go: 'Read a bit from memory' },
  storage: { lede: 'Flash keeps data with the power off by trapping electrons in an insulator, in stacks of over two hundred layers. Program a cell and read it back.', go: 'Store a bit in flash' },
  package: { lede: 'The processor is a stack: solder balls, a wiring substrate, bumps, and a sliver of silicon. Cut through it to see each layer.', go: 'Cut into the package' },
  die: { lede: 'A floorplan of the silicon. Choose a task and see which blocks wake up, what they draw, and why chips mix kinds of core.', go: 'Look at the silicon' },
  core: { lede: 'One performance core, running a real loop instruction by instruction. Change its width, its memory, its predictor, and watch the throughput.', go: 'Go inside one core' },
  logic: { lede: 'Inside the adder: NAND gates switching in picoseconds. Set two numbers and watch the carry ripple through the transistors.', go: 'Open the adder' },
  transistor: { lede: 'A single transistor, dimensioned in nanometres. Raise the gate voltage and a channel of electrons forms under it.', go: 'Look at one transistor' },
  lattice: { lede: 'The crystal itself: silicon atoms 0.235 nm apart. Add a dopant and watch one atom change what the whole lattice can do.', go: 'Go into the crystal' },
};

if (!hasWebGL()) {
  $('nogl').hidden = false;
  $('sheet').hidden = true;
} else boot();
