// What the laptop's screen shows: a real desktop, with one app per workload, drawn live onto the panel.
// Everything is generic (no maker's logos); the text on screen is real and readable when you zoom in.
import type { Workload } from '../../core/state';

export interface ScreenCtx {
  t: number; // seconds
  typed: string;
  cursor: boolean;
  /** 0..1 panel brightness */
  bright: number;
  /** tokens per second for the AI chat, frames per second for the game */
  tps: number;
  fps: number;
  /** export job progress 0..1, or −1 when no job is running */
  job: number;
  machine: string;
  /** battery charge 0..100 and whether the charger is in */
  battery: number;
  plugged: boolean;
}

type G = CanvasRenderingContext2D;

const ARTICLE = [
  'Press a key and a small dome under the keycap collapses, closing one crossing in a grid of row and column wires. The embedded controller scans that grid about a thousand times a second, notices the closed crossing, and sends a few bytes to the processor over a slow, always-on bus.',
  'From there the event wakes a core that was asleep to save power. It runs a few thousand instructions: the operating system routes the key to this window, the browser updates the text, and a layout engine works out where every glyph now sits.',
  'Finally the graphics engine draws the changed pixels into a frame in memory, and the display controller streams that frame to the panel, row by row, 120 times a second. The whole trip, from your fingertip to new light, takes about 30 milliseconds.',
  'Every step in that chain is drawn on its own sheet, at true scale, from the keycap down to the silicon atoms of a single transistor.',
];

const CHAT_Q = 'Why does my laptop get slower when it gets hot?';
const CHAT_A =
  'Because the chip protects itself. A processor turns almost all of its power into heat, and its speed is set by how much power it may draw. ' +
  'When the cooling cannot carry the heat away fast enough, the temperature climbs towards the limit, around 100 °C for the hottest spot on the die. ' +
  'Before it gets there, the power controller lowers the clock frequency and the voltage together. Power falls roughly with the cube of that change, ' +
  'so a 10 % slower clock saves about a quarter of the heat. You notice it as a long export getting slower after the first minute: ' +
  'the fans have reached full speed, the heatsink has warmed up, and the chip settles at the speed its cooling can sustain.';

export function drawScreen(g: G, W: number, H: number, w: Workload, c: ScreenCtx) {
  const b = 0.45 + c.bright * 0.55;
  const u = W / 1440;
  const sh = (hex: string, a = 1) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${Math.round(((n >> 16) & 255) * b)},${Math.round(((n >> 8) & 255) * b)},${Math.round((n & 255) * b)},${a})`;
  };
  const font = (px: number, wgt = 500, mono = false) => (g.font = `${wgt} ${px * u}px ${mono ? '"JetBrains Mono", monospace' : '"Barlow", sans-serif'}`);
  const text = (s: string, x: number, y: number, col: string, align: CanvasTextAlign = 'left') => {
    g.textAlign = align;
    g.fillStyle = sh(col);
    g.fillText(s, x * u, y * u);
    g.textAlign = 'left';
  };
  const box = (x: number, y: number, ww: number, hh: number, col: string, r = 0, a = 1) => {
    g.fillStyle = sh(col, a);
    if (r) {
      g.beginPath();
      g.roundRect(x * u, y * u, ww * u, hh * u, r * u);
      g.fill();
    } else g.fillRect(x * u, y * u, ww * u, hh * u);
  };
  const stroke = (col: string, lw: number) => {
    g.strokeStyle = sh(col);
    g.lineWidth = lw * u;
  };
  const poly = (pts: [number, number][], col: string) => {
    g.fillStyle = sh(col);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * u, y * u) : g.moveTo(x * u, y * u)));
    g.closePath();
    g.fill();
  };
  const circle = (x: number, y: number, r: number, col: string) => {
    g.fillStyle = sh(col);
    g.beginPath();
    g.arc(x * u, y * u, r * u, 0, Math.PI * 2);
    g.fill();
  };
  /** word-wrap a paragraph to a pixel width in the current font */
  const wrap = (s: string, maxW: number): string[] => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (g.measureText(next).width > maxW * u && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // ---------- shell ----------
  /** the shell's start button: the flint mark, a knapped flake with its spark */
  const glyph = (x: number, y: number, s: number, col: string) => {
    const k = s / 40;
    const flake: [number, number][] = [[1, 39], [3, 27], [9, 17], [19, 9], [31, 6], [30, 16], [26, 26], [17, 34]];
    poly(flake.map(([px, py]) => [x + px * k, y + py * k] as [number, number]), col);
    circle(x + 2 * k, y + 37 * k, 4.2 * k, '#cf1f2e');
  };
  const wifi = (x: number, y: number, col: string) => {
    stroke(col, 2.2);
    for (const r of [5, 10, 15]) {
      g.beginPath();
      g.arc(x * u, (y + 8) * u, r * u, -Math.PI * 0.78, -Math.PI * 0.22);
      g.stroke();
    }
    circle(x, y + 7, 2, col);
  };
  const speakerIcon = (x: number, y: number, col: string) => {
    poly([[x - 8, y - 3], [x - 3, y - 3], [x + 3, y - 8], [x + 3, y + 8], [x - 3, y + 3], [x - 8, y + 3]], col);
    stroke(col, 2);
    g.beginPath();
    g.arc((x + 4) * u, y * u, 7 * u, -0.8, 0.8);
    g.stroke();
  };
  const batteryIcon = (x: number, y: number, col: string) => {
    stroke(col, 1.8);
    g.strokeRect((x - 12) * u, (y - 6) * u, 22 * u, 12 * u);
    box(x + 10, y - 3, 2.5, 6, col);
    box(x - 10, y - 4, 18 * Math.max(0.05, c.battery / 100), 8, c.battery < 15 ? '#e0533d' : col);
    if (c.plugged) poly([[x + 1, y - 9], [x - 4, y + 1], [x, y + 1], [x - 2, y + 9], [x + 4, y - 1], [x, y - 1]], '#f2c94c');
  };
  const taskbar = (dark: boolean, active: number) => {
    const bg = dark ? '#1c1f24' : '#eef0f3', fg = dark ? '#e6e8eb' : '#1d1f22', dim = dark ? '#9aa0a8' : '#5d636b';
    box(0, 852, 1440, 48, bg, 0, 0.96);
    box(0, 852, 1440, 1, dark ? '#2c3036' : '#d5d8dd');
    const icons = ['start', 'search', 'files', 'browser', 'notes', 'media', 'chat', 'editor', 'settings'];
    const x0 = 10;
    icons.forEach((k, i) => {
      const x = x0 + i * 44 + 6, y = 860;
      if (i === active) box(x - 4, y - 2, 40, 36, dark ? '#2f343b' : '#dfe3e8', 6);
      if (k === 'start') glyph(x + 6, y + 6, 20, fg);
      else if (k === 'search') {
        stroke(dim, 2.4);
        g.beginPath();
        g.arc((x + 14) * u, (y + 14) * u, 7 * u, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo((x + 19) * u, (y + 19) * u);
        g.lineTo((x + 25) * u, (y + 25) * u);
        g.stroke();
      } else {
        const col = { files: '#e8b04a', browser: '#3d8fd9', notes: '#5ab37a', media: '#d9534f', chat: '#7b6fd9', editor: '#e07b39', settings: '#8a9099' }[k]!;
        box(x + 3, y + 3, 26, 26, col, 6);
        if (k === 'browser') {
          stroke('#ffffff', 2);
          g.beginPath();
          g.arc((x + 16) * u, (y + 16) * u, 8 * u, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.ellipse((x + 16) * u, (y + 16) * u, 3.5 * u, 8 * u, 0, 0, Math.PI * 2);
          g.stroke();
        } else if (k === 'media') poly([[x + 12, y + 9], [x + 23, y + 16], [x + 12, y + 23]], '#ffffff');
        else if (k === 'notes') for (let l = 0; l < 3; l++) box(x + 9, y + 10 + l * 5, 14 - (l === 2 ? 5 : 0), 2, '#ffffff');
        else if (k === 'files') box(x + 7, y + 11, 18, 12, '#fff3d6', 2);
        else if (k === 'chat') box(x + 8, y + 9, 16, 11, '#ffffff', 4);
        else if (k === 'editor') for (let l = 0; l < 3; l++) box(x + 8, y + 9 + l * 5, 6 + l * 4, 3, '#ffffff', 1);
        else if (k === 'settings') circle(x + 16, y + 16, 5, '#ffffff');
      }
      if (i === active) box(x + 10, y + 34, 12, 3, '#3d7bd9', 2);
    });
    wifi(1238, 868, fg);
    speakerIcon(1268, 876, fg);
    batteryIcon(1302, 876, fg);
    font(13, 600);
    text(hhmm, 1392, 871, fg, 'right');
    text(now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }), 1392, 889, dim, 'right');
  };
  /** an app window with its title bar; returns the client area top */
  const windowFrame = (title: string, dark: boolean, x = 0, y = 0, ww = 1440, hh = 852) => {
    box(x, y, ww, hh, dark ? '#202328' : '#f7f8fa');
    box(x, y, ww, 36, dark ? '#1a1d21' : '#e9ecf0');
    font(13, 600);
    text(title, x + 16, y + 23, dark ? '#d8dce2' : '#2b2f35');
    const fg = dark ? '#c6cad1' : '#3a3f46';
    stroke(fg, 1.4);
    const bx = x + ww - 138;
    g.beginPath();
    g.moveTo((bx + 16) * u, (y + 18) * u);
    g.lineTo((bx + 28) * u, (y + 18) * u);
    g.stroke();
    g.strokeRect((bx + 62) * u, (y + 12) * u, 11 * u, 11 * u);
    g.beginPath();
    g.moveTo((bx + 108) * u, (y + 12) * u);
    g.lineTo((bx + 119) * u, (y + 23) * u);
    g.moveTo((bx + 119) * u, (y + 12) * u);
    g.lineTo((bx + 108) * u, (y + 23) * u);
    g.stroke();
    return y + 36;
  };

  switch (w) {
    case 'idle': {
      // the lock screen
      landscape(0, 0, 1440, 900, c.t * 0.02);
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0.25)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      font(150, 300);
      text(hhmm, 720, 300, '#f4f5f2', 'center');
      font(30, 500);
      text(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), 720, 352, '#e9ebee', 'center');
      font(15, 500);
      text('Press any key to unlock', 720, 800, '#e9ebee', 'center');
      wifi(1336, 852, '#f4f5f2');
      batteryIcon(1384, 860, '#f4f5f2');
      break;
    }
    case 'type': {
      const top = windowFrame('Untitled — Notes', false);
      // toolbar
      box(0, top, 1440, 46, '#f1f3f6');
      font(14, 500);
      box(18, top + 10, 120, 26, '#ffffff', 4);
      text('Barlow', 28, top + 28, '#2b2f35');
      text('12', 152, top + 28, '#2b2f35');
      ['B', 'I', 'U'].forEach((s, i) => {
        font(16, s === 'B' ? 800 : 500);
        text(s, 210 + i * 34, top + 29, '#2b2f35');
      });
      for (let i = 0; i < 4; i++) for (let l = 0; l < 3; l++) box(330 + i * 34, top + 15 + l * 6, i === 1 ? 10 + l * 2 : 16 - (l % 2) * 4, 2, '#3a3f46');
      box(0, top + 46, 1440, 1, '#dde1e6');
      // the page
      box(0, top + 47, 1440, 852 - top - 47 - 28, '#e6e9ed');
      box(330, top + 70, 780, 900, '#ffffff');
      font(30, 700);
      text('Notes', 400, top + 140, '#1d1f22');
      // a draft already on the page, then whatever you type
      font(14, 600);
      text('Lab notes — 12 October', 400, top + 172, '#6b7078');
      font(17, 400);
      const draft = [
        '• Pouch cell, 4.2 V full, 3.0 V empty: the pack is four in series.',
        '• Fan curve starts at 60 °C; the chip throttles near 100 °C.',
        '• Ask: why does the SSD read faster than it writes?',
      ];
      draft.forEach((l, i) => text(l, 400, top + 208 + i * 30, '#24272c'));
      const body = c.typed || '';
      const lines = wrap(body, 640);
      const start = Math.max(0, lines.length - 16);
      let y = top + 320;
      for (let i = start; i < lines.length; i++, y += 28) text(lines[i], 400, y, '#1d1f22');
      if (!body) {
        font(17, 400);
        text('Type on your own keyboard: every key you press is followed down to the transistors.', 400, top + 320, '#8b8e88');
      } else if (c.cursor) {
        const last = lines[lines.length - 1] ?? '';
        box(401 + g.measureText(last).width / u, y - 28 - 17, 2, 22, '#1d1f22');
      }
      // status bar
      box(0, 824, 1440, 28, '#e9ecf0');
      font(12, 500);
      const words = body.trim() ? body.trim().split(/\s+/).length : 0;
      text(`Page 1 of 1   ·   ${words} words   ·   ${body.length} characters   ·   English (UK)`, 16, 842, '#4a4f57');
      text('100 %', 1424, 842, '#4a4f57', 'right');
      taskbar(false, 4);
      break;
    }
    case 'web': {
      // a browser with an article
      box(0, 0, 1440, 852, '#ffffff');
      box(0, 0, 1440, 84, '#e6e9ed');
      const tabs = ['How a laptop works — SILEX', 'Mini-LED backlight explained', 'Lithium-ion cell chemistry'];
      tabs.forEach((t, i) => {
        const x = 12 + i * 236;
        if (i === 0) box(x, 6, 230, 34, '#ffffff', 8);
        circle(x + 18, 23, 7, ['#1d1f22', '#3d8fd9', '#5ab37a'][i]);
        font(13, 500);
        text(t, x + 32, 28, i === 0 ? '#1d1f22' : '#4a4f57');
      });
      font(18, 400);
      text('+', 736, 30, '#4a4f57');
      box(0, 40, 1440, 44, '#ffffff');
      font(18, 500);
      text('←', 18, 69, '#3a3f46');
      text('→', 50, 69, '#a0a5ac');
      text('↻', 82, 69, '#3a3f46');
      box(116, 48, 1200, 30, '#eef0f3', 15);
      // padlock
      box(134, 61, 10, 8, '#3a3f46', 1);
      stroke('#3a3f46', 1.6);
      g.beginPath();
      g.arc(139 * u, 61 * u, 3.5 * u, Math.PI, 0);
      g.stroke();
      font(14, 500);
      text('silex.drawing/how-a-laptop-works', 156, 68, '#1d1f22');
      box(0, 84, 1440, 1, '#d5d8dd');
      // the page scrolls slowly as if being read
      g.save();
      g.beginPath();
      g.rect(0, 85 * u, W, (852 - 85) * u);
      g.clip();
      const sc = 85 - ((c.t * 14) % 520);
      // site header
      font(22, 800);
      text('SILEX', 220, sc + 50, '#1d1f22');
      font(14, 500);
      ['Sheets', 'Machines', 'Simulations', 'Notes'].forEach((s, i) => text(s, 880 + i * 96, sc + 48, '#4a4f57'));
      box(220, sc + 76, 1000, 1, '#e3e6ea');
      // article
      font(14, 600);
      text('HARDWARE · 8 MIN READ', 220, sc + 126, '#d9534f');
      font(44, 700);
      text('From fingertip to photon:', 220, sc + 182, '#1d1f22');
      text('what happens when you press a key', 220, sc + 234, '#1d1f22');
      font(15, 500);
      text('Drawn by KINGKIMABDU  ·  Sheet 1 of 13', 220, sc + 270, '#6b7078');
      // hero figure: a line drawing of a laptop
      box(220, sc + 296, 640, 300, '#f3f4f1', 6);
      stroke('#1d1f22', 2);
      g.beginPath();
      g.moveTo(330 * u, (sc + 540) * u);
      g.lineTo(750 * u, (sc + 540) * u);
      g.lineTo(800 * u, (sc + 572) * u);
      g.lineTo(280 * u, (sc + 572) * u);
      g.closePath();
      g.stroke();
      g.strokeRect(350 * u, (sc + 330) * u, 380 * u, 205 * u);
      box(362, sc + 342, 356, 182, '#3d5a73');
      stroke('#cf1f2e', 2);
      g.beginPath();
      g.moveTo(540 * u, (sc + 556) * u);
      g.lineTo(540 * u, (sc + 470) * u);
      g.lineTo(600 * u, (sc + 440) * u);
      g.stroke();
      font(13, 500);
      text('Fig. 1 — The keypress path, from the key matrix to the panel.', 220, sc + 620, '#6b7078');
      font(18, 400);
      let y = sc + 666;
      for (const p of ARTICLE) {
        for (const l of wrap(p, 640)) {
          text(l, 220, y, '#24272c');
          y += 30;
        }
        y += 18;
      }
      // sidebar
      font(13, 700);
      text('ON THIS PAGE', 920, sc + 312, '#6b7078');
      font(15, 500);
      ['The key matrix', 'Waking a core', 'Layout and paint', 'Scan-out to the panel', 'Further reading'].forEach((s, i) => {
        if (i === 0) box(912, sc + 330 + i * 34, 3, 22, '#d9534f');
        text(s, 924, sc + 347 + i * 34, i === 0 ? '#1d1f22' : '#4a4f57');
      });
      box(912, sc + 520, 300, 120, '#f3f4f6', 8);
      font(14, 700);
      text('Did you know?', 930, sc + 552, '#1d1f22');
      font(14, 400);
      wrap('A 2.5K panel at 240 Hz moves almost a billion pixels a second.', 260).forEach((l, i) => text(l, 930, sc + 580 + i * 22, '#4a4f57'));
      g.restore();
      // scrollbar
      box(1430, 90 + ((c.t * 14) % 520) * 0.6, 6, 120, '#b9bdc3', 3);
      taskbar(false, 3);
      break;
    }
    case 'video': {
      // a film playing full screen, HDR
      landscape(0, 0, 1440, 900, c.t * 0.05, true);
      const grad = g.createLinearGradient(0, H * 0.72, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      g.fillStyle = grad;
      g.fillRect(0, H * 0.72, W, H * 0.28);
      font(22, 700);
      text('Coastlines — Episode 3: The Long Light', 40, 790, '#ffffff');
      const dur = 58 * 60 + 3, pos = 12 * 60 + 41 + (c.t % 600);
      const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      box(40, 812, 1360, 5, '#ffffff', 2, 0.3);
      box(40, 812, 1360 * Math.min(1, (pos + 240) / dur), 5, '#ffffff', 2, 0.45);
      box(40, 812, 1360 * (pos / dur), 5, '#e0533d', 2);
      circle(40 + 1360 * (pos / dur), 814, 8, '#ffffff');
      // controls
      box(44, 838, 6, 22, '#ffffff');
      box(56, 838, 6, 22, '#ffffff');
      speakerIcon(104, 849, '#ffffff');
      box(122, 847, 90, 4, '#ffffff', 2, 0.4);
      box(122, 847, 64, 4, '#ffffff', 2);
      font(15, 600);
      text(`${fmt(pos)} / ${fmt(dur)}`, 232, 855, '#ffffff');
      ['HDR', '4K', 'CC'].forEach((s, i) => {
        stroke('#ffffff', 1.4);
        g.strokeRect((1250 + i * 52) * u, 836 * u, 44 * u, 24 * u);
        font(13, 700);
        text(s, 1272 + i * 52, 853, '#ffffff', 'center');
      });
      break;
    }
    case 'call': {
      const top = windowFrame('Physics study group — Call', true);
      box(0, top, 1440, 852 - top, '#15171b');
      font(14, 600);
      text('● REC', 24, top + 30, '#e0533d');
      const secs = 24 * 60 + 13 + Math.floor(c.t);
      text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 90, top + 30, '#c6cad1');
      const people = [
        { name: 'Lee K.', skin: '#e8c4a0', hair: '#1a1410', room: ['#3f4f63', '#26303c'], shirt: '#5a7aa0' },
        { name: 'Cheng W.', skin: '#e2b896', hair: '#15100c', room: ['#4b5a48', '#2b3529'], shirt: '#8a4f48' },
        { name: 'Elena R.', skin: '#f0caa8', hair: '#6b4226', room: ['#5c4a52', '#352a30'], shirt: '#e0c27a' },
        { name: 'Abdullah A.', skin: '#b98563', hair: '#120c09', room: ['#4a5262', '#2a2f38'], shirt: '#3d5a46' },
      ];
      const speaking = Math.floor(c.t / 4) % 4;
      people.forEach((p, n) => {
        const tw = 690, th = 338;
        const x = 24 + (n % 2) * (tw + 12), y = top + 50 + Math.floor(n / 2) * (th + 12);
        const rg = g.createLinearGradient(0, y * u, 0, (y + th) * u);
        rg.addColorStop(0, sh(p.room[0]));
        rg.addColorStop(1, sh(p.room[1]));
        g.fillStyle = rg;
        g.beginPath();
        g.roundRect(x * u, y * u, tw * u, th * u, 10 * u);
        g.fill();
        // a shelf or window behind each person
        box(x + 40 + n * 60, y + 40, 140, 90, '#ffffff', 4, 0.08);
        const cx = x + tw / 2 + Math.sin(c.t * 0.7 + n) * 6, cy = y + th * 0.5;
        // shoulders, neck, head, hair
        g.fillStyle = sh(p.shirt);
        g.beginPath();
        g.ellipse(cx * u, (y + th + 20) * u, 150 * u, 120 * u, 0, Math.PI, 0);
        g.fill();
        box(cx - 20, cy + 30, 40, 50, p.skin);
        g.fillStyle = sh(p.skin);
        g.beginPath();
        g.ellipse(cx * u, cy * u, 54 * u, 66 * u, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = sh(p.hair);
        g.beginPath();
        g.ellipse(cx * u, (cy - 30) * u, 58 * u, 44 * u, 0, Math.PI, 0);
        g.fill();
        if (n === 2) {
          g.beginPath();
          g.ellipse((cx - 48) * u, (cy + 20) * u, 16 * u, 70 * u, 0, 0, Math.PI * 2);
          g.ellipse((cx + 48) * u, (cy + 20) * u, 16 * u, 70 * u, 0, 0, Math.PI * 2);
          g.fill();
        }
        circle(cx - 20, cy - 4, 4, '#1d1f22');
        circle(cx + 20, cy - 4, 4, '#1d1f22');
        const talk = n === speaking ? Math.abs(Math.sin(c.t * 9)) * 6 : 0;
        box(cx - 14, cy + 28, 28, 3 + talk, '#6a3a32', 2);
        if (n === speaking) {
          stroke('#5ab37a', 3);
          g.beginPath();
          g.roundRect((x + 1.5) * u, (y + 1.5) * u, (tw - 3) * u, (th - 3) * u, 10 * u);
          g.stroke();
        }
        box(x + 12, y + th - 40, 150, 28, '#000000', 6, 0.45);
        font(15, 600);
        text(p.name, x + 44, y + th - 21, '#ffffff');
        // microphone level
        const lvl = n === speaking ? Math.abs(Math.sin(c.t * 7)) : 0.05;
        for (let k = 0; k < 3; k++) box(x + 22 + k * 5, y + th - 22 - (4 + k * 3) * lvl, 3, 4 + (4 + k * 3) * lvl, '#5ab37a');
      });
      // self view
      box(1240, 690, 176, 110, '#2d3240', 8);
      circle(1328, 742, 26, '#d8a888');
      font(12, 600);
      text('You', 1252, 790, '#ffffff');
      // controls
      const ctl = ['mic', 'cam', 'share', 'react', 'chat', 'leave'];
      ctl.forEach((k, i) => {
        const x = 540 + i * 64;
        box(x, 800, 52, 40, k === 'leave' ? '#d9534f' : '#2c3036', 20);
        font(12, 600);
        text(k === 'leave' ? 'Leave' : k[0].toUpperCase() + k.slice(1), x + 26, 825, '#ffffff', 'center');
      });
      taskbar(true, 6);
      break;
    }
    case 'game': {
      // a racing game: road, kerbs, trees, the car from behind, and the HUD
      const t = c.t;
      const sky = g.createLinearGradient(0, 0, 0, H * 0.48);
      sky.addColorStop(0, sh('#4f86c6'));
      sky.addColorStop(1, sh('#b9d4ea'));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H * 0.48);
      const ridge = (base: number, amp: number, f: number, col: string, ph: number) => {
        g.fillStyle = sh(col);
        g.beginPath();
        g.moveTo(0, base * u);
        for (let x = 0; x <= 1440; x += 20) g.lineTo(x * u, (base - Math.abs(Math.sin(x * f + ph)) * amp - Math.sin(x * f * 2.7 + ph) * amp * 0.3) * u);
        g.lineTo(W, base * u);
        g.closePath();
        g.fill();
      };
      ridge(430, 110, 0.004, '#7f94ad', 1 + t * 0.01);
      ridge(432, 60, 0.009, '#5f7a62', 2 + t * 0.03);
      box(0, 432, 1440, 468, '#4f7a44');
      const hz = 432, bend = Math.sin(t * 0.35) * 220;
      const roadAt = (z: number) => ({ y: hz + (900 - hz) * z * z, cx: 720 + bend * (1 - z) * (1 - z), half: 20 + 760 * z * z });
      for (let k = 0; k < 40; k++) {
        const z0 = k / 40, z1 = (k + 1) / 40;
        const a = roadAt(z0), bb = roadAt(z1);
        const stripe = Math.floor(k + t * 18) % 2 === 0;
        poly([[a.cx - a.half * 1.08, a.y], [a.cx + a.half * 1.08, a.y], [bb.cx + bb.half * 1.08, bb.y], [bb.cx - bb.half * 1.08, bb.y]], stripe ? '#d8463a' : '#f2f2ee');
        poly([[a.cx - a.half, a.y], [a.cx + a.half, a.y], [bb.cx + bb.half, bb.y], [bb.cx - bb.half, bb.y]], stripe ? '#4a4d52' : '#46494e');
        if (stripe) poly([[a.cx - a.half * 0.02, a.y], [a.cx + a.half * 0.02, a.y], [bb.cx + bb.half * 0.02, bb.y], [bb.cx - bb.half * 0.02, bb.y]], '#e9e9e4');
      }
      // trees along the verge
      for (let k = 0; k < 10; k++) {
        const z = ((k + (t * 0.9) % 1) / 10) ** 1.2;
        const r = roadAt(z);
        for (const side of [-1, 1]) {
          const x = r.cx + side * r.half * 1.6, s = 10 + 120 * z * z;
          poly([[x, r.y - s * 2.2], [x - s * 0.6, r.y - s * 0.3], [x + s * 0.6, r.y - s * 0.3]], '#2f5a35');
          box(x - s * 0.08, r.y - s * 0.32, s * 0.16, s * 0.32, '#5a4030');
        }
      }
      // the car from behind
      const cx = 720, cy = 770;
      box(cx - 150, cy - 10, 300, 70, '#c8463a', 14);
      box(cx - 110, cy - 64, 220, 60, '#a73a30', 18);
      box(cx - 92, cy - 54, 184, 40, '#1d2a36', 10);
      box(cx - 170, cy - 30, 340, 12, '#1d1f22', 3);
      box(cx - 140, cy + 10, 70, 14, '#ff5a3c', 4);
      box(cx + 70, cy + 10, 70, 14, '#ff5a3c', 4);
      box(cx - 175, cy + 30, 60, 50, '#1b1c1f', 10);
      box(cx + 115, cy + 30, 60, 50, '#1b1c1f', 10);
      box(cx - 40, cy + 40, 80, 18, '#2a2d32', 4);
      circle(cx - 20, cy + 62, 7, '#3a3d42');
      circle(cx + 20, cy + 62, 7, '#3a3d42');
      // HUD
      font(16, 700, true);
      box(20, 20, 230, 64, '#000000', 8, 0.45);
      text(`${Math.round(c.fps)} FPS`, 36, 46, '#ffffff');
      font(13, 500, true);
      text(`${(1000 / Math.max(1, c.fps)).toFixed(1)} ms  ·  GPU 99 %`, 36, 70, '#cfd3d8');
      font(22, 800);
      box(620, 20, 200, 56, '#000000', 8, 0.45);
      text(`LAP 2/3   P3`, 720, 56, '#ffffff', 'center');
      // minimap
      box(1220, 20, 200, 160, '#000000', 10, 0.45);
      stroke('#ffffff', 3);
      g.beginPath();
      g.ellipse(1320 * u, 100 * u, 70 * u, 50 * u, 0.3, 0, Math.PI * 2);
      g.stroke();
      const ma = t * 0.3;
      circle(1320 + Math.cos(ma) * 70 * Math.cos(0.3) - Math.sin(ma) * 50 * Math.sin(0.3), 100 + Math.cos(ma) * 70 * Math.sin(0.3) + Math.sin(ma) * 50 * Math.cos(0.3), 6, '#e0533d');
      // speedometer
      const spd = Math.round(184 + Math.sin(t * 0.8) * 26);
      g.lineCap = 'round';
      stroke('#ffffff', 10);
      g.globalAlpha = 0.3;
      g.beginPath();
      g.arc(1310 * u, 800 * u, 80 * u, Math.PI * 0.75, Math.PI * 2.25);
      g.stroke();
      g.globalAlpha = 1;
      stroke('#e0533d', 10);
      g.beginPath();
      g.arc(1310 * u, 800 * u, 80 * u, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * (spd / 320)));
      g.stroke();
      g.lineCap = 'butt';
      font(44, 800);
      text(String(spd), 1310, 806, '#ffffff', 'center');
      font(14, 700);
      text('KM/H   6TH', 1310, 832, '#ffffff', 'center');
      break;
    }
    case 'ai': {
      const top = windowFrame('Assistant — local model, offline', true);
      // sidebar
      box(0, top, 280, 852 - top, '#181a1e');
      box(16, top + 16, 248, 38, '#2c3036', 8);
      font(14, 600);
      text('+  New chat', 32, top + 41, '#e2e0db');
      font(12, 700);
      text('TODAY', 20, top + 86, '#7d8084');
      font(14, 500);
      ['Why laptops slow down when hot', 'Explain DRAM refresh', 'NAND vs DRAM, simply', 'Summarise the lattice sheet'].forEach((s, i) => {
        if (i === 0) box(12, top + 98 + i * 36, 256, 32, '#2c3036', 6);
        text(s, 24, top + 119 + i * 36, i === 0 ? '#e2e0db' : '#a9adb3');
      });
      // header: model and live speed
      font(13, 600);
      text(`7B parameters · 4-bit · ${c.machine}`, 320, top + 32, '#8b8e88');
      box(1180, top + 14, 236, 28, '#2c3036', 14);
      circle(1198, top + 28, 5, '#5ab37a');
      text(`${c.tps.toFixed(0)} tokens/s`, 1212, top + 33, '#e2e0db');
      // the conversation
      font(17, 400);
      const ql = wrap(CHAT_Q, 600);
      box(1416 - 640, top + 70, 640, 28 + ql.length * 28, '#2f5d9e', 14);
      ql.forEach((l, i) => text(l, 1416 - 620, top + 102 + i * 28, '#ffffff'));
      const n = Math.floor((c.t * c.tps * 4.5) % (CHAT_A.length + 260));
      const shown = CHAT_A.slice(0, Math.min(CHAT_A.length, n));
      circle(336, top + 160, 14, '#7b6fd9');
      font(17, 400);
      const al = wrap(shown, 900);
      al.forEach((l, i) => text(l, 366, top + 166 + i * 30, '#d8dcd6'));
      if (n < CHAT_A.length && c.cursor) box(366 + g.measureText(al[al.length - 1] ?? '').width / u + 2, top + 150 + (al.length - 1) * 30, 9, 20, '#d8dcd6');
      // input
      box(320, 760, 1080, 60, '#2c3036', 14);
      font(16, 500);
      text(c.typed.slice(-80) || 'Ask anything — it runs on this laptop, nothing leaves it', 344, 796, c.typed ? '#e2e0db' : '#7d8084');
      font(12, 500);
      text(`context ${Math.min(8192, 312 + Math.floor(n / 4))} / 8,192 tokens`, 1396, 840, '#7d8084', 'right');
      taskbar(true, 6);
      break;
    }
    case 'export': {
      const top = windowFrame('Coastlines_E03_final — Editor', true);
      box(0, top, 1440, 852 - top, '#1b1d21');
      // menu
      font(13, 500);
      ['File', 'Edit', 'Clip', 'Timeline', 'Colour', 'Audio', 'Deliver'].forEach((s, i) => text(s, 16 + i * 74, top + 22, i === 6 ? '#e07b39' : '#b9bdc3'));
      // media bin
      box(12, top + 36, 330, 360, '#23262b', 6);
      for (let i = 0; i < 9; i++) {
        const x = 24 + (i % 3) * 104, y = top + 50 + Math.floor(i / 3) * 112;
        g.save();
        g.beginPath();
        g.rect(x * u, y * u, 96 * u, 60 * u);
        g.clip();
        landscape(x, y, 96, 60, i * 0.7, i % 2 === 0);
        g.restore();
        font(11, 500);
        text(`A0${i + 1}_C00${(i * 7) % 9 + 1}.mov`, x, y + 78, '#a9adb3');
      }
      // program monitor
      box(354, top + 36, 720, 360, '#000000');
      g.save();
      g.beginPath();
      g.rect(374 * u, (top + 46) * u, 680 * u, 340 * u);
      g.clip();
      landscape(374, top + 46, 680, 340, c.t * 0.05, true);
      g.restore();
      font(13, 600, true);
      const tc = (s: number) => `01:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}:${String(Math.floor(s * 24) % 24).padStart(2, '0')}`;
      const p = c.job >= 0 ? c.job : (c.t / 40) % 1;
      box(654, top + 358, 120, 22, '#000000', 4, 0.6);
      text(tc(p * 600), 714, top + 374, '#e2e0db', 'center');
      // inspector
      box(1086, top + 36, 342, 360, '#23262b', 6);
      font(13, 700);
      text('Inspector', 1102, top + 62, '#e2e0db');
      font(13, 500);
      [['Zoom', '1.000'], ['Position', '0 · 0'], ['Rotation', '0.0°'], ['Opacity', '100 %'], ['Lift', '−0.02'], ['Gamma', '+0.04'], ['Gain', '1.06']].forEach(([k, v], i) => {
        text(k, 1102, top + 96 + i * 34, '#a9adb3');
        text(v, 1410, top + 96 + i * 34, '#e2e0db', 'right');
      });
      // timeline
      const tl = top + 410;
      box(12, tl, 1416, 396, '#202328', 6);
      font(11, 500, true);
      for (let k = 0; k <= 10; k++) {
        box(80 + k * 134, tl + 8, 1, 10, '#6b7078');
        text(`01:${String(k).padStart(2, '0')}:00`, 84 + k * 134, tl + 18, '#8b8e88');
      }
      const tracks = [['V2', '#7b5ea8'], ['V1', '#3d6fa8'], ['A1', '#3d8a5a'], ['A2', '#3d8a5a']];
      tracks.forEach(([name, col], ti) => {
        const y = tl + 34 + ti * 84;
        font(12, 700);
        text(name, 24, y + 44, '#b9bdc3');
        let x = 80;
        let k = 0;
        while (x < 1420) {
          const len = 120 + ((ti * 37 + k * 71) % 160);
          if (!(ti === 0 && k % 2 === 0)) {
            box(x, y + 6, len - 4, 70, col, 4);
            if (ti < 2) for (let f = 0; f < len - 8; f += 64) {
              g.save();
              g.beginPath();
              g.rect((x + f + 2) * u, (y + 22) * u, Math.min(60, len - 10 - f) * u, 50 * u);
              g.clip();
              landscape(x + f + 2, y + 22, 60, 50, k + f * 0.01, true);
              g.restore();
            }
            else {
              stroke('#bfe3c8', 1.2);
              g.beginPath();
              for (let xx = 0; xx < len - 8; xx += 3) {
                const a = Math.abs(Math.sin((x + xx) * 0.07 + ti) * Math.sin((x + xx) * 0.013)) * 26;
                g.moveTo((x + xx + 2) * u, (y + 41 - a) * u);
                g.lineTo((x + xx + 2) * u, (y + 41 + a) * u);
              }
              g.stroke();
            }
            font(11, 600);
            text(`${name}_${k + 1}`, x + 6, y + 19, '#ffffff');
          }
          x += len;
          k++;
        }
      });
      box(80 + 1340 * p, tl + 4, 2, 388, '#ff5a3c');
      poly([[74 + 1340 * p, tl + 2], [88 + 1340 * p, tl + 2], [81 + 1340 * p, tl + 12]], '#ff5a3c');
      // the render, when it runs
      if (c.job >= 0) {
        box(420, 300, 600, 170, '#2a2d33', 12, 0.97);
        font(18, 700);
        text('Rendering', 448, 340, '#ffffff');
        font(14, 500);
        text('H.265 Main 10 · 3840 × 2160 · 60 fps · 10 min', 448, 366, '#a9adb3');
        box(448, 392, 544, 10, '#3a3e44', 5);
        box(448, 392, 544 * p, 10, '#e07b39', 5);
        font(15, 700);
        text(`${(p * 100).toFixed(0)} %`, 448, 432, '#ffffff');
        font(14, 500);
        text(`frame ${Math.floor(p * 36000).toLocaleString('en')} of 36,000`, 992, 432, '#a9adb3', 'right');
      }
      taskbar(true, 7);
      break;
    }
  }

  /** A landscape photograph, painted: sky, sun, three ranges of hills, water with reflections. */
  function landscape(x: number, y: number, ww: number, hh: number, ph: number, golden = false) {
    const sk = g.createLinearGradient(0, y * u, 0, (y + hh * 0.62) * u);
    sk.addColorStop(0, sh(golden ? '#2f4f7f' : '#253a5c'));
    sk.addColorStop(0.65, sh(golden ? '#e89a5c' : '#7f9cc0'));
    sk.addColorStop(1, sh(golden ? '#f6d08a' : '#c9d6e2'));
    g.fillStyle = sk;
    g.fillRect(x * u, y * u, ww * u, hh * 0.62 * u);
    const sx = x + ww * (0.68 + Math.sin(ph) * 0.03), sy = y + hh * 0.5;
    const glow = g.createRadialGradient(sx * u, sy * u, 0, sx * u, sy * u, hh * 0.35 * u);
    glow.addColorStop(0, `rgba(255,236,190,${0.9 * b})`);
    glow.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = glow;
    g.fillRect(x * u, y * u, ww * u, hh * 0.62 * u);
    g.fillStyle = sh('#fff3d0');
    g.beginPath();
    g.arc(sx * u, sy * u, hh * 0.045 * u, 0, Math.PI * 2);
    g.fill();
    const hills: [number, number, number, string][] = [[0.5, 0.1, 0.006, golden ? '#6d5a72' : '#4c6280'], [0.56, 0.08, 0.011, golden ? '#4a3f55' : '#36506a'], [0.62, 0.06, 0.02, golden ? '#2c2738' : '#24394c']];
    for (const [base, amp, f, col] of hills) {
      g.fillStyle = sh(col);
      g.beginPath();
      g.moveTo(x * u, (y + hh * 0.62) * u);
      for (let xx = 0; xx <= ww; xx += Math.max(2, ww / 120)) {
        const yy = y + hh * base - (Math.abs(Math.sin((xx / ww) * 1440 * f + ph * 3 + base * 9)) * amp + Math.sin((xx / ww) * 1440 * f * 3.1 + base * 20) * amp * 0.25) * hh;
        g.lineTo((x + xx) * u, yy * u);
      }
      g.lineTo((x + ww) * u, (y + hh * 0.62) * u);
      g.closePath();
      g.fill();
    }
    const sea = g.createLinearGradient(0, (y + hh * 0.62) * u, 0, (y + hh) * u);
    sea.addColorStop(0, sh(golden ? '#c98a5a' : '#5d7b99'));
    sea.addColorStop(1, sh(golden ? '#1d2433' : '#18263a'));
    g.fillStyle = sea;
    g.fillRect(x * u, (y + hh * 0.62) * u, ww * u, hh * 0.38 * u);
    // the sun's path on the water, broken by the swell
    for (let k = 0; k < 18; k++) {
      const yy = y + hh * (0.63 + k * 0.02);
      const half = ww * (0.01 + k * 0.004) * (0.7 + 0.3 * Math.sin(ph * 40 + k * 1.7));
      g.fillStyle = `rgba(255,226,170,${(0.55 - k * 0.025) * b})`;
      g.fillRect((sx - half) * u, yy * u, half * 2 * u, Math.max(1, hh * 0.006) * u);
    }
  }
}
