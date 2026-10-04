/*
 * Pong Reimagined: a retro pixel arcade game.
 * All art, music, and sound are generated in code. No image or audio files.
 *
 * You are the ball. Gravity pulls you down; Space, click, or tap makes you flap.
 * Hit the green goal on each wall to bounce back and score. Red walls and spike mines end the run.
 *
 * Usage: PongReimagined.mount(containerElement)
 */
(function () {
  'use strict';

  // ─── World (in pixels of the 320×180 arcade screen; speeds per second) ───
  const W = 320, H = 180;
  const WALL = 3, GOAL_W = 5;
  const BALL_R = 4, MINE_R = 3.5;
  const GRAVITY = 270, FLAP = -92, MAX_FALL = 150;
  const WARN = 0.7;                // a mine blinks this long before it becomes deadly
  const GOALS_PER_STAGE = 6;
  const FONT = "'Press Start 2P', monospace";

  // Difficulty for stage n (0-based). The game never ends; it keeps getting harder.
  const stageCfg = n => ({
    speed: Math.min(62 + n * 7, 116),
    goalH: Math.max(46 - n * 2.5, 26),
    mines: Math.min(2 + n, 8),
    rotate: Math.max(3.2 - n * 0.25, 1.4),   // seconds between relocating one mine
    moving: n >= 2 ? Math.min((n - 1) * 0.25, 0.75) : 0,
    slide: n >= 3 ? Math.min(6 + (n - 3) * 3, 20) : 0
  });

  // ─── Palette and pixel art ─────────────────────────────────────────────────
  const C = {
    k: '#000000', n: '#1d2b53', R: '#7e2553', d: '#008751', B: '#ab5236', s: '#5f574f', g: '#c2c3c7', w: '#fff1e8',
    r: '#ff004d', o: '#ffa300', y: '#ffec27', l: '#00e436', b: '#29adff', v: '#83769c', p: '#ff77a8', e: '#ffccaa'
  };

  const THEMES = [
    { name: 'NEON NIGHT',   bg: '#0b1026', grid: '#151f48', star: '#29adff', planet: '#7e2553', planetHi: '#ff77a8' },
    { name: 'SUNSET DRIVE', bg: '#1a0b24', grid: '#2c123c', star: '#ffa300', planet: '#ab5236', planetHi: '#ffccaa' },
    { name: 'TOXIC CAVE',   bg: '#06170e', grid: '#0e2a19', star: '#00e436', planet: '#008751', planetHi: '#a8e72e' },
    { name: 'RED ALERT',    bg: '#160812', grid: '#2c0f24', star: '#ff004d', planet: '#7e2553', planetHi: '#ff77a8' },
    { name: 'DEEP FREEZE',  bg: '#071822', grid: '#0f2d3d', star: '#c2f0ff', planet: '#1d2b53', planetHi: '#29adff' }
  ];

  const SKINS = [
    { id: 'classic', name: 'CLASSIC', cost: 0, trail: 'w', rows: ['..wwww..', '.wwwwww.', 'wwwwwwwg', 'wwwwwwwg', 'wwwwwwgg', 'wwwwwwgg', '.wwgggg.', '..gggg..'] },
    { id: 'cherry', name: 'CHERRY', cost: 15, trail: 'r', rows: ['.....d..', '..rrrd..', '.rwrrrr.', 'rwrrrrrR', 'rrrrrrrR', 'rrrrrrRR', '.rrRRRR.', '..RRRR..'] },
    { id: 'cyclops', name: 'CYCLOPS', cost: 40, trail: 'y', rows: ['..yyyy..', '.yyyyyy.', 'yywwwwyy', 'yywkkwyo', 'yywkkwyo', 'yywwwwoo', '.yyoooo.', '..oooo..'] },
    { id: 'smiley', name: 'SMILEY', cost: 80, trail: 'o', rows: ['..yyyy..', '.yyyyyy.', 'yykyykyy', 'yykyykyo', 'yyyyyyyo', 'ykyyyyko', '.ykkkko.', '..oooo..'] },
    { id: 'planet', name: 'PLANET', cost: 140, trail: 'b', rows: ['..bbbb..', '.bbbbbb.', 'bbbbbbbn', 'oooooooo', 'bbbbbbnn', 'bbbbbbnn', '.bbnnnn.', '..nnnn..'] },
    { id: 'skull', name: 'SKULL', cost: 220, trail: 'g', rows: ['..wwww..', '.wwwwww.', 'wkkwwkkw', 'wkkwwkkg', 'wwwwwwwg', '.wwkkwg.', '.wkwkwk.', '..wwww..'] },
    { id: 'gold', name: 'GOLDEN', cost: 320, trail: 'y', rows: ['..oooo..', '.oyyyyo.', 'oyywyyyo', 'oyyyyyyo', 'oyyyyyoo', 'oyyyyooo', '.oooooo.', '..oooo..'] }
  ];

  const MINE_ROWS = ['....p....', '.p..r..p.', '..rrrrr..', '..rRRRr..', 'prrRwRrrp', '..rRRRr..', '..rrrrr..', '.p..r..p.', '....p....'];
  const COIN_ROWS = [
    ['.oooo.', 'oyyyyo', 'oywyyo', 'oyyyyo', 'oyyyyo', '.oooo.'],
    ['.oo.', 'oyyo', 'oywo', 'oyyo', 'oyyo', '.oo.'],
    ['oo', 'oy', 'oy', 'oy', 'oy', 'oo']
  ];
  const POWERS = {
    shield: { label: 'SHIELD', letter: ['111', '100', '111', '001', '111'], color: 'b' },
    slow:   { label: 'SLOW-MO', letter: ['111', '010', '010', '010', '010'], color: 'w' },
    magnet: { label: 'MAGNET', letter: ['101', '111', '111', '101', '101'], color: 'p' },
    double: { label: 'DOUBLE', letter: ['111', '001', '111', '100', '111'], color: 'y' }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function sprite(rows) {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((row, j) => [...row].forEach((ch, i) => { if (C[ch]) { x.fillStyle = C[ch]; x.fillRect(i, j, 1, 1); } }));
    return c;
  }

  // ─── Sound: chiptune sound effects and music, synthesized live ─────────────
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const Sound = {
    ctx: null, master: null, noiseBuf: null,
    sfxOn: store.get('pr-sfx', '1') === '1',
    musicOn: store.get('pr-music', '1') === '1',
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    },
    note(freq, t, dur, type, vol, slide) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(t, dur, vol, highpass) {
      if (!this.ctx) return;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      f.type = highpass ? 'highpass' : 'lowpass';
      f.frequency.value = highpass ? 6000 : 1400;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.buffer = this.noiseBuf;
      src.connect(f).connect(g).connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    },
    sfx(name) {
      if (!this.sfxOn || !this.ctx) return;
      const t = this.ctx.currentTime, N = (f, d, ty, v, s, dl) => this.note(f, t + (dl || 0), d, ty, v, s);
      switch (name) {
        case 'flap': N(300, 0.07, 'square', 0.045, 520); break;
        case 'coin': N(988, 0.06, 'square', 0.045); N(1319, 0.12, 'square', 0.045, null, 0.06); break;
        case 'goal': N(523, 0.08, 'triangle', 0.12); N(784, 0.12, 'triangle', 0.12, null, 0.07); break;
        case 'perfect': [659, 880, 1175, 1568].forEach((f, i) => N(f, 0.1, 'square', 0.045, null, i * 0.045)); break;
        case 'near': N(1568, 0.05, 'square', 0.035); N(2093, 0.07, 'square', 0.035, null, 0.05); break;
        case 'power': N(392, 0.28, 'square', 0.05, 1568); break;
        case 'shield': this.noise(t, 0.2, 0.15); N(880, 0.22, 'triangle', 0.1, 220); break;
        case 'death': this.noise(t, 0.6, 0.25); N(220, 0.6, 'sawtooth', 0.07, 40); break;
        case 'stage': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => N(f, 0.12, 'square', 0.05, null, i * 0.08)); break;
        case 'tick': N(660, 0.08, 'square', 0.05); break;
        case 'go': N(1320, 0.22, 'square', 0.06); break;
        case 'select': N(880, 0.05, 'square', 0.04); break;
      }
    }
  };

  // A four-bar loop in A minor: bass, arpeggio, lead, kick, and hi-hat.
  const PROG = [
    { bass: 45, arp: [57, 60, 64, 69] },   // Am
    { bass: 41, arp: [53, 57, 60, 65] },   // F
    { bass: 48, arp: [55, 60, 64, 67] },   // C
    { bass: 43, arp: [55, 59, 62, 67] }    // G
  ];
  const LEAD = [69, 0, 72, 0, 76, 74, 72, 0, 69, 0, 67, 0, 69, 0, 0, 0, 65, 0, 69, 0, 72, 74, 72, 69, 67, 0, 64, 0, 67, 0, 0, 0];
  const Music = {
    playing: false, step: 0, next: 0, tempo: 132, timer: null,
    start() {
      if (!Sound.ctx || this.playing) return;
      this.playing = true; this.step = 0;
      this.next = Sound.ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.schedule(), 25);
    },
    stop() { this.playing = false; clearInterval(this.timer); },
    schedule() {
      const s16 = 60 / this.tempo / 4;
      while (this.next < Sound.ctx.currentTime + 0.12) {
        if (Sound.musicOn) this.play(this.step, this.next, s16);
        this.next += s16;
        this.step = (this.step + 1) % 64;
      }
    },
    play(step, t, s16) {
      const chord = PROG[Math.floor(step / 16)], i = step % 16;
      if (i % 2 === 0) Sound.note(midi(chord.bass + (i % 8 === 4 ? 12 : 0)), t, s16 * 1.7, 'square', 0.03);
      Sound.note(midi(chord.arp[i % 4] + 12), t, s16 * 0.8, 'triangle', 0.022);
      if (i % 8 === 0) Sound.note(120, t, 0.12, 'sine', 0.16, 40);
      if (i % 4 === 2) Sound.noise(t, 0.04, 0.03, true);
      if (i % 2 === 0) { const n = LEAD[Math.floor(step / 2) % 32]; if (n) Sound.note(midi(n), t, s16 * 1.8, 'square', 0.022); }
    }
  };

  // ─── Overlay styles (pixel-art UI) ─────────────────────────────────────────
  const CSS = `
.pr-root{container:pr / size;position:relative;width:100%;aspect-ratio:16/9;background:#0b1026;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:manipulation;outline:none;font-family:'Press Start 2P',monospace;color:#fff1e8}
.pr-root:focus-visible{box-shadow:0 0 0 3px #ffec27}
.pr-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pr-overlay{position:absolute;inset:0;display:flex;align-items:safe center;justify-content:center;padding:3cqh 3cqw;overflow:auto;background:rgba(4,6,20,.62)}
.pr-overlay[hidden]{display:none}
.pr-panel{text-align:center;width:100%;max-width:78cqw}
.pr-logo{margin:0 0 3cqh;font-weight:400;line-height:1}
.pr-logo .a{display:block;font-size:11cqw;color:#ffec27;text-shadow:.5cqw .5cqw 0 #ff004d,1cqw 1cqw 0 #7e2553}
.pr-logo .b{display:block;font-size:max(9px,3cqw);color:#29adff;text-shadow:.3cqw .3cqw 0 #1d2b53;margin-top:2.6cqh;letter-spacing:.3cqw}
.pr-h2{font-size:max(13px,4.6cqw);font-weight:400;margin:0 0 3cqh;color:#ffec27;text-shadow:.4cqw .4cqw 0 #ff004d}
.pr-btns{display:flex;flex-direction:column;align-items:center;gap:2cqh}
.pr-row{display:flex;gap:1.6cqw;justify-content:center;flex-wrap:wrap}
.pr-btn{font:inherit;font-size:max(9px,1.7cqw);line-height:1;min-width:30cqw;padding:max(7px,2.2cqh) max(8px,2cqw);background:#1d2b53;color:#fff1e8;border:.35cqw solid #fff1e8;box-shadow:.6cqw .6cqw 0 #000;cursor:pointer;text-transform:uppercase}
.pr-row .pr-btn{min-width:20cqw}
.pr-btn:hover,.pr-btn:focus-visible{background:#29adff;color:#000;outline:none}
.pr-btn:active{transform:translate(.3cqw,.3cqw);box-shadow:.3cqw .3cqw 0 #000}
.pr-btn.primary{background:#00e436;color:#000}
.pr-btn.primary:hover,.pr-btn.primary:focus-visible{background:#ffec27}
.pr-meta{margin-top:3cqh;font-size:max(7px,1.3cqw);color:#c2c3c7;line-height:2}
.pr-meta b{color:#ffec27;font-weight:400}
.pr-blink{animation:pr-blink 1s steps(1) infinite}
@keyframes pr-blink{50%{opacity:0}}
.pr-press{font-size:max(8px,1.6cqw);color:#fff1e8;margin:0 0 3cqh}
.pr-howto{list-style:none;padding:0;margin:0 auto 3cqh;text-align:left;display:grid;gap:2.2cqh;max-width:66cqw;font-size:max(7px,1.35cqw);line-height:1.7;color:#fff1e8}
.pr-howto li{display:flex;gap:1.6cqw;align-items:flex-start}
.pr-howto i{flex:none;font-style:normal;color:#000;padding:.4cqh .6cqw;font-size:max(6px,1.2cqw)}
.pr-stats{display:grid;grid-template-columns:repeat(2,auto);gap:1.6cqh 4cqw;justify-content:center;margin:0 0 2.6cqh;font-size:max(8px,1.5cqw);text-align:left}
.pr-stats span{color:#c2c3c7}
.pr-stats b{color:#fff1e8;font-weight:400}
.pr-badges{display:flex;gap:1.2cqw;justify-content:center;flex-wrap:wrap;margin:0 0 2.6cqh}
.pr-badge{font-size:max(7px,1.2cqw);padding:1cqh 1.2cqw;background:#ffec27;color:#000}
.pr-badge.skin{background:#ff77a8}
.pr-skins{display:grid;grid-template-columns:repeat(4,1fr);gap:1.6cqw;margin:0 auto 3cqh;max-width:64cqw}
.pr-skin{font:inherit;font-size:max(6px,1.05cqw);line-height:1.5;background:#1d2b53;border:.35cqw solid #5f574f;padding:1.6cqh .6cqw;color:#fff1e8;cursor:pointer}
.pr-skin canvas{position:static;width:7cqw;height:7cqw;image-rendering:pixelated;margin:0 auto 1cqh}
.pr-skin.on{border-color:#ffec27;background:#2c3a6b}
.pr-skin.locked{color:#83769c;cursor:not-allowed}
.pr-skin.locked canvas{filter:brightness(0) opacity(.45)}
.pr-skin:not(.locked):hover,.pr-skin:not(.locked):focus-visible{border-color:#29adff;outline:none}
.pr-hud{position:absolute;right:1.4cqw;bottom:2.4cqh;display:flex;gap:1cqw;z-index:2}
.pr-hud[hidden]{display:none}
.pr-hud button{font:inherit;font-size:1.4cqw;width:4.4cqw;height:4.4cqw;min-width:24px;min-height:24px;background:rgba(29,43,83,.85);color:#fff1e8;border:.25cqw solid #fff1e8;box-shadow:.4cqw .4cqw 0 #000;cursor:pointer;display:grid;place-items:center;padding:0}
.pr-hud button:hover{background:#29adff;color:#000}
.pr-hud button[hidden]{display:none}
@container pr (max-height: 320px){
  .pr-overlay{padding:6px 10px}
  .pr-logo{margin-bottom:6px}.pr-logo .b{margin-top:6px}
  .pr-press,.pr-meta{display:none}
  .pr-h2{margin-bottom:8px}
  .pr-btns{gap:6px}.pr-row{gap:6px}
  .pr-btn{min-width:0;padding:6px 10px;box-shadow:2px 2px 0 #000;border-width:2px}
  .pr-howto{gap:5px;margin-bottom:8px;max-width:none}
  .pr-howto i{display:none}
  .pr-stats{gap:4px 14px;margin-bottom:8px}
  .pr-badges{margin-bottom:8px}
  .pr-skins{gap:5px;margin-bottom:8px;max-width:none}
  .pr-skin{padding:4px 2px;border-width:2px}
  .pr-skin canvas{width:22px;height:22px;margin-bottom:3px}
}
@media (prefers-reduced-motion: reduce){.pr-blink{animation:none}}
`;

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function mount(container) {
    if (!document.getElementById('pr-styles')) {
      const s = el('style'); s.id = 'pr-styles'; s.textContent = CSS; document.head.appendChild(s);
    }

    // ─── Sprites ─────────────────────────────────────────────────────────────
    const skinSprites = Object.fromEntries(SKINS.map(s => [s.id, sprite(s.rows)]));
    const mineSprite = sprite(MINE_ROWS);
    const mineSpriteHot = sprite(MINE_ROWS.map(r => r.replace('w', 'y')));
    const coinSprites = [0, 1, 2, 1].map(i => sprite(COIN_ROWS[i]));

    // ─── DOM ─────────────────────────────────────────────────────────────────
    const root = el('div', 'pr-root');
    root.tabIndex = 0;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Pong Reimagined. Press Space, click, or tap to flap.');
    const canvas = el('canvas');
    const ctx = canvas.getContext('2d');
    const buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    const b = buf.getContext('2d');
    const overlay = el('div', 'pr-overlay');
    const hud = el('div', 'pr-hud');
    const pauseBtn = el('button', null, 'II'); pauseBtn.type = 'button'; pauseBtn.setAttribute('aria-label', 'Pause');
    const muteBtn = el('button'); muteBtn.type = 'button';
    hud.append(pauseBtn, muteBtn);
    root.append(canvas, overlay, hud);
    container.appendChild(root);

    // Render the 320×180 screen at a whole-number scale so every pixel stays square
    let k = 1, crt = null;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      k = Math.max(1, Math.ceil((root.clientWidth || W) * dpr / W));
      canvas.width = W * k; canvas.height = H * k;
      crt = document.createElement('canvas');
      crt.width = canvas.width; crt.height = canvas.height;
      const c = crt.getContext('2d');
      if (k >= 3) { c.fillStyle = 'rgba(0,0,0,0.2)'; for (let y = 0; y < H; y++) c.fillRect(0, y * k + k - 1, crt.width, Math.max(1, Math.floor(k / 3))); }
      const v = c.createRadialGradient(crt.width / 2, crt.height / 2, crt.height * 0.35, crt.width / 2, crt.height / 2, crt.width * 0.62);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = v; c.fillRect(0, 0, crt.width, crt.height);
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(root); else window.addEventListener('resize', resize);

    // ─── Saved progress ──────────────────────────────────────────────────────
    const save = {
      best: +store.get('pr-best', '0') || 0,
      bestCombo: +store.get('pr-best-combo', '0') || 0,
      bank: +store.get('pr-bank', '0') || 0,
      skin: store.get('pr-skin', 'classic')
    };
    const unlocked = s => save.bank >= s.cost;
    if (!SKINS.some(s => s.id === save.skin && unlocked(s))) save.skin = 'classic';
    const currentSkin = () => SKINS.find(s => s.id === save.skin) || SKINS[0];

    function syncMute() {
      const on = Sound.sfxOn || Sound.musicOn;
      muteBtn.textContent = on ? '♪' : '×';
      muteBtn.setAttribute('aria-label', on ? 'Mute' : 'Unmute');
    }
    syncMute();

    // ─── Stars (fixed positions; they drift and twinkle) ─────────────────────
    const stars = Array.from({ length: 46 }, () => ({ x: rand(0, W), y: rand(0, H), layer: Math.floor(rand(0, 3)), tw: rand(0, 6) }));

    // ─── World ───────────────────────────────────────────────────────────────
    let state = 'menu';     // menu | skins | howto | countdown | playing | paused | dying | over
    let G = null, countdown = 0, lastCount = 0, resumeTo = 'playing', lastResult = null;

    function makeGoal(w, side) {
      const h = stageCfg(w.stage).goalH;
      return { side, h, y: rand(WALL + 6, H - WALL - 6 - h), dir: Math.random() < 0.5 ? -1 : 1, pulse: 0 };
    }

    function newWorld(demo) {
      const w = {
        demo, t: 0, score: 0, goalsHit: 0, stage: 0, combo: 0, bestCombo: 0, mult: 1, coins: 0,
        ball: { x: 40, y: H / 2, vx: stageCfg(0).speed, vy: 0, sx: 1, sy: 1 },
        goals: [], mines: [], coinList: [], power: null,
        fx: { shield: false, slow: 0, magnet: 0, double: 0, invuln: 0 },
        particles: [], popups: [], trail: [],
        rotateT: stageCfg(0).rotate, coinT: 1.5, powerT: 10, freeze: 0, shake: 0, flash: 0,
        banner: null, theme: 0, prevTheme: 0, themeFade: 1, hint: 4
      };
      w.goals = [makeGoal(w, 'L'), makeGoal(w, 'R')];
      for (let i = 0; i < stageCfg(0).mines; i++) addMine(w, true);
      return w;
    }

    // Find a spot for a mine away from the ball, its path, and other mines
    function safeSpot(w, self, amp) {
      const ball = w.ball, look = WARN + 0.4;
      let px = ball.x + ball.vx * look, dir = Math.sign(ball.vx);
      if (px > W - WALL) { px = 2 * (W - WALL) - px; dir = -1; }
      if (px < WALL) { px = 2 * WALL - px; dir = 1; }
      const reach = Math.abs(ball.vx) * 1.2;
      let best = null, bestClear = -1;
      for (let i = 0; i < 80; i++) {
        const x = rand(36, W - 36), y = rand(18 + amp, H - 18 - amp);
        const segDist = (qx, qy) => Math.hypot(x - qx, clamp(qy, y - amp, y + amp) - qy);
        const clear = Math.min(segDist(ball.x, ball.y), segDist(px, ball.y));
        const ahead = dir > 0 ? x > px && x < px + reach : x < px && x > px - reach;
        const inLane = ahead && Math.abs(y - ball.y) < 28 + amp;
        const apart = w.mines.every(o => o === self || o.x === undefined || Math.hypot(x - o.x, y - o.baseY) > 30);
        if (!inLane && apart && clear > bestClear) { bestClear = clear; best = { x, y }; }
        if (bestClear > 62) break;
      }
      return best || { x: W / 2, y: H / 2 };
    }

    function placeMine(w, m, instant) {
      const cfg = stageCfg(w.stage);
      m.amp = Math.random() < cfg.moving ? rand(10, 22) : 0;
      m.spd = rand(1.2, 2.3); m.ph = rand(0, Math.PI * 2);
      const p = safeSpot(w, m, m.amp);
      m.x = p.x; m.baseY = p.y; m.y = p.y;
      m.born = instant ? -10 : w.t;
      m.close = false; m.awarded = false;
    }
    function addMine(w, instant) { const m = {}; w.mines.push(m); placeMine(w, m, instant); }

    function spawnCoin(w) {
      for (let i = 0; i < 40; i++) {
        const x = rand(24, W - 24), y = rand(22, H - 22);
        if (Math.hypot(x - w.ball.x, y - w.ball.y) > 36 && w.mines.every(m => Math.hypot(x - m.x, y - m.baseY) > 16 + (m.amp || 0))) {
          w.coinList.push({ x, y, born: w.t }); return;
        }
      }
    }

    function spawnPower(w) {
      const types = Object.keys(POWERS);
      for (let i = 0; i < 40; i++) {
        const x = rand(50, W - 50), y = rand(30, H - 30);
        if (w.mines.every(m => Math.hypot(x - m.x, y - m.baseY) > 22 + (m.amp || 0))) {
          w.power = { type: types[Math.floor(Math.random() * types.length)], x, y, born: w.t }; return;
        }
      }
    }

    // ─── Effects ─────────────────────────────────────────────────────────────
    function burst(w, x, y, n, colors, speed, life) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
        w.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color: C[colors[i % colors.length]], size: Math.random() < 0.3 ? 2 : 1 });
      }
    }
    function popup(w, text, x, y, color) { w.popups.push({ text, x: clamp(x, 40, W - 40), y: clamp(y, 16, H - 12), t: 0, color: C[color] || color }); }
    const sfx = (w, name) => { if (!w.demo) Sound.sfx(name); };

    // ─── Input ───────────────────────────────────────────────────────────────
    function flap(w) {
      w = w || G;
      if (!w || (!w.demo && state !== 'playing')) return;
      w.ball.vy = FLAP;
      w.ball.sx = 0.75; w.ball.sy = 1.3;
      sfx(w, 'flap');
      burst(w, w.ball.x - Math.sign(w.ball.vx) * 3, w.ball.y + 3, 3, ['g', 'w'], 30, 0.3);
    }

    // The same simple AI drives the attract-mode demo and the automated tests
    function bot(w) {
      const ball = w.ball, g = ball.vx > 0 ? w.goals[1] : w.goals[0];
      let ty = g.y + g.h / 2;
      for (const m of w.mines) {
        const dx = (m.x - ball.x) * Math.sign(ball.vx);
        if (dx > -8 && dx < 75 && Math.abs(m.y - ty) < 18) ty = m.y < ty ? m.y + 24 : m.y - 24;
      }
      ty = clamp(ty, 16, H - 16);
      if (ball.y > ty + 1.5 && ball.vy > -15) flap(w);
    }

    // ─── Game rules ──────────────────────────────────────────────────────────
    function scoreGoal(w, g, left) {
      const ball = w.ball, center = g.y + g.h / 2;
      const perfect = Math.abs(ball.y - center) <= g.h * 0.18;
      w.goalsHit++;
      const prevMult = w.mult;
      w.combo = perfect ? w.combo + 1 : 0;
      w.bestCombo = Math.max(w.bestCombo, w.combo);
      w.mult = 1 + Math.min(4, Math.floor(w.combo / 3));
      const pts = (perfect ? 2 : 1) * w.mult * (w.fx.double > 0 ? 2 : 1);
      w.score += pts;

      const wx = left ? WALL + 30 : W - WALL - 30;
      if (perfect) {
        popup(w, 'PERFECT +' + pts, wx, ball.y - 10, 'y');
        sfx(w, 'perfect'); w.freeze = 0.05;
        burst(w, left ? WALL : W - WALL, ball.y, 16, ['y', 'l', 'w'], 90, 0.6);
      } else {
        popup(w, '+' + pts, wx, ball.y - 10, 'l');
        sfx(w, 'goal');
        burst(w, left ? WALL : W - WALL, ball.y, 10, ['l', 'd'], 70, 0.5);
      }
      if (w.mult > prevMult) popup(w, 'x' + w.mult + ' COMBO!', W / 2, 40, 'p');

      ball.x = left ? WALL + BALL_R + 1 : W - WALL - BALL_R - 1;
      ball.sx = 0.55; ball.sy = 1.35;

      const stage = Math.floor(w.goalsHit / GOALS_PER_STAGE);
      if (stage > w.stage) stageUp(w, stage, left);
      ball.vx = (left ? 1 : -1) * stageCfg(w.stage).speed;

      Object.assign(g, makeGoal(w, g.side));
      g.pulse = 1;
    }

    function stageUp(w, stage, left) {
      w.prevTheme = w.theme;
      w.stage = stage;
      w.theme = stage % THEMES.length;
      w.themeFade = 0;
      w.ball.vx = (left ? 1 : -1) * stageCfg(stage).speed;   // set before new mines pick their spots
      w.banner = { text: 'STAGE ' + (stage + 1), sub: THEMES[w.theme].name, t: 2.4 };
      sfx(w, 'stage');
      while (w.mines.length < stageCfg(stage).mines) addMine(w, false);
      if (!w.demo) Music.tempo = Math.min(132 + stage * 6, 172);
    }

    // Shields and the brief invulnerability after a save keep the ball inside the arena
    function hazard(w, kind, m) {
      const ball = w.ball;
      if (!w.demo && w.fx.invuln <= 0 && !w.fx.shield) return die(w);
      if (!w.demo && w.fx.invuln <= 0) {
        w.fx.shield = false; w.fx.invuln = 1;
        popup(w, 'SAVED!', ball.x, ball.y - 12, 'b');
        sfx(w, 'shield');
        burst(w, ball.x, ball.y, 18, ['b', 'w'], 90, 0.6);
      }
      if (kind === 'top') { ball.y = WALL + BALL_R + 1; ball.vy = 40; }
      else if (kind === 'bottom') { ball.y = H - WALL - BALL_R - 1; ball.vy = FLAP; }
      else if (kind === 'side') { ball.vx = -ball.vx; ball.x = clamp(ball.x, WALL + BALL_R + 1, W - WALL - BALL_R - 1); }
      else if (kind === 'mine' && m) { burst(w, m.x, m.y, 12, ['r', 'R', 'y'], 70, 0.5); placeMine(w, m, false); }
    }

    function die(w) {
      state = 'dying';
      hud.hidden = true;
      w.freeze = 0.18;
      Sound.sfx('death');
      Music.stop();
      const skin = currentSkin();
      burst(w, w.ball.x, w.ball.y, 50, [skin.trail, 'w', 'r', 'o'], 140, 1);
      w.shake = reducedMotion() ? 0 : 0.5;
      w.flash = 0.5;
      const oldBank = save.bank;
      save.bank += w.coins;
      const newBest = w.score > save.best;
      if (newBest) save.best = w.score;
      save.bestCombo = Math.max(save.bestCombo, w.bestCombo);
      store.set('pr-best', String(save.best));
      store.set('pr-best-combo', String(save.bestCombo));
      store.set('pr-bank', String(save.bank));
      lastResult = {
        score: w.score, coins: w.coins, combo: w.bestCombo, stage: w.stage, newBest,
        skins: SKINS.filter(s => s.cost > oldBank && s.cost <= save.bank).map(s => s.name)
      };
      setTimeout(showOver, 1100);
    }

    // ─── Update ──────────────────────────────────────────────────────────────
    function update(dt) {
      const w = G;
      w.particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; });
      w.particles = w.particles.filter(p => p.life > 0);
      w.popups.forEach(p => { p.t += dt; });
      w.popups = w.popups.filter(p => p.t < 0.9);
      w.shake = Math.max(0, w.shake - dt);
      w.flash = Math.max(0, w.flash - dt * 1.8);
      if (w.themeFade < 1) { w.themeFade = Math.min(1, w.themeFade + dt * 1.4); if (w.themeFade >= 1) w.prevTheme = w.theme; }
      if (w.banner) { w.banner.t -= dt; if (w.banner.t <= 0) w.banner = null; }
      w.goals.forEach(g => { g.pulse = Math.max(0, g.pulse - dt * 2.5); });

      if (state === 'countdown') {
        countdown -= dt;
        const c = Math.ceil(countdown);
        if (c !== lastCount && c > 0) { Sound.sfx('tick'); lastCount = c; }
        if (countdown <= 0) { state = 'playing'; Sound.sfx('go'); w.ball.vy = FLAP * 0.6; }
        return;
      }
      const live = state === 'playing' || (w.demo && (state === 'menu' || state === 'skins' || state === 'howto'));
      if (!live) return;
      if (w.freeze > 0) { w.freeze -= dt; return; }
      step(w, dt * (w.fx.slow > 0 ? 0.6 : 1), dt);
    }

    function step(w, dt, realDt) {
      const ball = w.ball, cfg = stageCfg(w.stage), fx = w.fx;
      w.t += dt;
      fx.slow = Math.max(0, fx.slow - realDt);
      fx.magnet = Math.max(0, fx.magnet - realDt);
      fx.double = Math.max(0, fx.double - realDt);
      fx.invuln = Math.max(0, fx.invuln - realDt);
      w.hint = Math.max(0, w.hint - realDt);
      if (w.demo) bot(w);

      // Ball
      ball.vy = Math.min(ball.vy + GRAVITY * dt, MAX_FALL);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      const ease = Math.min(1, dt * 12);
      ball.sx += (1 - ball.sx) * ease; ball.sy += (1 - ball.sy) * ease;
      w.trail.push({ x: ball.x, y: ball.y });
      if (w.trail.length > 7) w.trail.shift();

      // Sliding goals (later stages) and drifting mines
      if (cfg.slide) w.goals.forEach(g => {
        g.y += g.dir * cfg.slide * dt;
        if (g.y < WALL + 6) { g.y = WALL + 6; g.dir = 1; }
        if (g.y > H - WALL - 6 - g.h) { g.y = H - WALL - 6 - g.h; g.dir = -1; }
      });
      w.mines.forEach(m => { m.y = m.baseY + (m.amp ? Math.sin(w.t * m.spd + m.ph) * m.amp : 0); });

      // Ceiling and floor
      if (ball.y - BALL_R <= WALL) return hazard(w, 'top');
      if (ball.y + BALL_R >= H - WALL) return hazard(w, 'bottom');

      // Side walls: the goal bounces you back, anywhere else is deadly
      const hitL = ball.vx < 0 && ball.x - BALL_R <= WALL;
      const hitR = ball.vx > 0 && ball.x + BALL_R >= W - WALL;
      if (hitL || hitR) {
        const g = w.goals[hitL ? 0 : 1];
        if (ball.y >= g.y - 2 && ball.y <= g.y + g.h + 2) scoreGoal(w, g, hitL);
        else return hazard(w, 'side');
      }

      // Mines, plus a bonus for close calls
      for (const m of w.mines) {
        if (w.t - m.born < WARN) continue;
        const d = Math.hypot(ball.x - m.x, ball.y - m.y);
        if (d < BALL_R + MINE_R - 1) return hazard(w, 'mine', m);
        const near = BALL_R + MINE_R + 6;
        if (!m.awarded) {
          if (d < near) m.close = true;
          else if (m.close && d > near + 2) {
            m.awarded = true; m.close = false;
            const pts = w.mult * (fx.double > 0 ? 2 : 1);
            w.score += pts;
            popup(w, 'CLOSE! +' + pts, ball.x, ball.y - 12, 'o');
            sfx(w, 'near');
          }
        }
      }

      // Coins
      w.coinList = w.coinList.filter(c => {
        if (fx.magnet > 0) {
          const dx = ball.x - c.x, dy = ball.y - c.y, d = Math.hypot(dx, dy);
          if (d < 90 && d > 0) { c.x += dx / d * 130 * dt; c.y += dy / d * 130 * dt; }
        }
        if (Math.hypot(ball.x - c.x, ball.y - c.y) < BALL_R + 4) {
          const pts = fx.double > 0 ? 2 : 1;
          w.coins++; w.score += pts;
          popup(w, '+' + pts, c.x, c.y - 8, 'y');
          sfx(w, 'coin');
          burst(w, c.x, c.y, 6, ['y', 'o'], 50, 0.4);
          return false;
        }
        return w.t - c.born < 10;
      });
      w.coinT -= dt;
      if (w.coinT <= 0) { w.coinT = rand(2.2, 4); if (w.coinList.length < 3) spawnCoin(w); }

      // Power-ups
      if (w.power) {
        const p = w.power;
        if (Math.hypot(ball.x - p.x, ball.y - p.y) < BALL_R + 5) {
          if (p.type === 'shield') fx.shield = true;
          if (p.type === 'slow') fx.slow = 6;
          if (p.type === 'magnet') fx.magnet = 8;
          if (p.type === 'double') fx.double = 8;
          popup(w, POWERS[p.type].label + '!', p.x, p.y - 10, POWERS[p.type].color);
          sfx(w, 'power');
          burst(w, p.x, p.y, 14, [POWERS[p.type].color, 'w'], 80, 0.6);
          w.power = null;
        } else if (w.t - p.born > 9) w.power = null;
      } else {
        w.powerT -= dt;
        if (w.powerT <= 0) { spawnPower(w); w.powerT = rand(14, 20); }
      }

      // Relocate the oldest mine every so often so the arena keeps changing
      w.rotateT -= dt;
      if (w.rotateT <= 0) {
        w.rotateT = cfg.rotate;
        const ready = w.mines.filter(m => w.t - m.born >= WARN);
        if (ready.length) placeMine(w, ready.reduce((a, m) => (m.born < a.born ? m : a)), false);
      }
    }

    // ─── Drawing (everything is drawn on the 320×180 buffer) ─────────────────
    function txt(s, x, y, color, size, align) {
      b.font = (size || 8) + 'px ' + FONT;
      b.textAlign = align || 'left'; b.textBaseline = 'top';
      x = Math.round(x); y = Math.round(y);
      b.fillStyle = '#000'; b.fillText(s, x + 1, y + 1);
      b.fillStyle = color; b.fillText(s, x, y);
    }

    function pixelCircle(cx, cy, r, color) {
      b.fillStyle = color;
      for (let dy = -r; dy <= r; dy++) {
        const dx = Math.floor(Math.sqrt(r * r - dy * dy));
        b.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
      }
    }

    function drawBackdrop(th, alpha, t) {
      b.globalAlpha = alpha;
      b.fillStyle = th.bg; b.fillRect(0, 0, W, H);
      b.fillStyle = th.grid;
      for (let x = 8; x < W; x += 16) b.fillRect(x, 0, 1, H);
      for (let y = 4; y < H; y += 16) b.fillRect(0, y, W, 1);
      // Pixel planet with a ring
      pixelCircle(262, 36, 15, th.planet);
      pixelCircle(257, 31, 6, th.planetHi);
      pixelCircle(262, 36, 11, th.planet);
      b.fillStyle = th.planetHi; b.fillRect(240, 37, 45, 1); b.fillRect(244, 38, 37, 1);
      // Stars drift by layer and twinkle
      stars.forEach(s => {
        const x = ((s.x - t * (4 + s.layer * 6)) % W + W) % W;
        if (Math.sin(t * 3 + s.tw) < -0.6) return;
        b.fillStyle = s.layer === 2 ? th.star : '#c2c3c7';
        b.fillRect(Math.round(x), Math.round(s.y), 1, 1);
      });
      b.globalAlpha = 1;
    }

    function drawWalls(t) {
      const off = Math.floor(t * 20) % 8;
      for (let x = -8; x < W + 8; x += 8) {
        b.fillStyle = C.r; b.fillRect(x + off, 0, 4, WALL); b.fillRect(x + off, H - WALL, 4, WALL);
        b.fillStyle = C.R; b.fillRect(x + off + 4, 0, 4, WALL); b.fillRect(x + off + 4, H - WALL, 4, WALL);
      }
      for (let y = -8; y < H + 8; y += 8) {
        b.fillStyle = C.r; b.fillRect(0, y + off, WALL, 4); b.fillRect(W - WALL, y + off, WALL, 4);
        b.fillStyle = C.R; b.fillRect(0, y + off + 4, WALL, 4); b.fillRect(W - WALL, y + off + 4, WALL, 4);
      }
    }

    function drawGoal(g, target, t) {
      const x = g.side === 'L' ? 0 : W - GOAL_W, y = Math.round(g.y), h = Math.round(g.h);
      if (g.pulse > 0) { b.fillStyle = C.w; b.fillRect(x - 1, y - 2, GOAL_W + 2, h + 4); }
      b.fillStyle = C.l; b.fillRect(x, y, GOAL_W, h);
      // Scrolling stripes
      b.fillStyle = C.d;
      const off = Math.floor(t * 18) % 6;
      for (let cy = y + off; cy < y + h - 2; cy += 6) b.fillRect(x + 1, cy, GOAL_W - 2, 2);
      // The perfect zone is the yellow middle
      const pz = Math.round(h * 0.36);
      b.fillStyle = C.y;
      b.fillRect(g.side === 'L' ? GOAL_W - 2 : W - GOAL_W, y + Math.round((h - pz) / 2), 2, pz);
      // Blinking arrow on the goal you are heading for
      if (target && Math.floor(t * 4) % 2 === 0) {
        const cy = y + Math.round(h / 2), ax = g.side === 'L' ? GOAL_W + 4 : W - GOAL_W - 5;
        b.fillStyle = C.w;
        for (let i = 0; i < 3; i++) b.fillRect(g.side === 'L' ? ax + i : ax - i, cy - i, 1, i * 2 + 1);
      }
    }

    function drawMine(m, t) {
      const age = t - m.born, x = Math.round(m.x), y = Math.round(m.y);
      if (age < WARN) {
        if (Math.floor(age * 12) % 2 === 0) {
          const r = Math.round(4 + 8 * (1 - age / WARN));
          b.fillStyle = C.r;
          b.fillRect(x - r, y - r, r * 2 + 1, 1); b.fillRect(x - r, y + r, r * 2 + 1, 1);
          b.fillRect(x - r, y - r, 1, r * 2 + 1); b.fillRect(x + r, y - r, 1, r * 2 + 1);
        }
        return;
      }
      b.drawImage(Math.floor(t * 4 + m.ph) % 2 ? mineSpriteHot : mineSprite, x - 4, y - 4);
    }

    function drawPower(p, t) {
      const age = t - p.born;
      if (age > 7 && Math.floor(age * 8) % 2 === 0) return;
      const info = POWERS[p.type], x = Math.round(p.x) - 4, y = Math.round(p.y + Math.sin(t * 4) * 2) - 4;
      b.fillStyle = C[info.color];
      b.fillRect(x + 1, y, 7, 9); b.fillRect(x, y + 1, 9, 7);
      b.fillStyle = C.n; b.fillRect(x + 1, y + 1, 7, 7);
      b.fillStyle = C[info.color];
      info.letter.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '1') b.fillRect(x + 3 + i, y + 2 + j, 1, 1); }));
    }

    function drawBall(w, t) {
      const ball = w.ball, skin = currentSkin();
      b.fillStyle = C[skin.trail];
      w.trail.forEach((p, i) => { if (i % 2 === 0) { b.globalAlpha = 0.15 + 0.35 * i / w.trail.length; b.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2); } });
      b.globalAlpha = 1;
      if (w.fx.invuln > 0 && Math.floor(t * 14) % 2 === 0) return;
      const sw = Math.max(4, Math.round(8 * ball.sx)), sh = Math.max(4, Math.round(8 * ball.sy));
      b.drawImage(skinSprites[skin.id], Math.round(ball.x - sw / 2), Math.round(ball.y - sh / 2), sw, sh);
      if (w.fx.shield) {
        b.fillStyle = C.b;
        for (let i = 0; i < 8; i++) {
          const a = t * 3 + i * Math.PI / 4;
          b.fillRect(Math.round(ball.x + Math.cos(a) * 8), Math.round(ball.y + Math.sin(a) * 8), 1, 1);
        }
      }
    }

    function drawHud(w, t) {
      txt(String(w.score), 9, 7, C.w, 16);
      if (w.mult > 1 || w.combo > 0) {
        const sx = 9 + String(w.score).length * 16 + 6;
        txt('x' + w.mult, sx, 7, w.mult > 1 ? C.p : C.g, 8);
        for (let i = 0; i < 3; i++) { b.fillStyle = i < w.combo % 3 ? C.y : C.s; b.fillRect(sx + i * 4, 18, 3, 3); }
      }
      const cs = coinSprites[Math.floor(t * 6) % 4];
      b.drawImage(cs, W - 34 + 3 - (cs.width >> 1), 8);
      txt(String(w.coins), W - 26, 8, C.y, 8);
      // Active power-up timers
      let px = 9;
      const bar = (label, color, frac) => {
        txt(label, px, H - 16, C[color], 8);
        b.fillStyle = C.s; b.fillRect(px + 10, H - 13, 16, 3);
        b.fillStyle = C[color]; b.fillRect(px + 10, H - 13, Math.round(16 * frac), 3);
        px += 32;
      };
      if (w.fx.shield) { txt('S', px, H - 16, C.b, 8); px += 14; }
      if (w.fx.slow > 0) bar('T', 'w', w.fx.slow / 6);
      if (w.fx.magnet > 0) bar('M', 'p', w.fx.magnet / 8);
      if (w.fx.double > 0) bar('2', 'y', w.fx.double / 8);
    }

    function draw() {
      const w = G, t = w.t;
      b.save();
      if (w.shake > 0) b.translate(Math.round(rand(-3, 3) * w.shake * 2), Math.round(rand(-3, 3) * w.shake * 2));
      drawBackdrop(THEMES[w.prevTheme], 1, t);
      if (w.themeFade < 1 || w.theme !== w.prevTheme) drawBackdrop(THEMES[w.theme], w.themeFade, t);
      drawWalls(t);
      const targetSide = w.ball.vx > 0 ? 'R' : 'L';
      w.goals.forEach(g => drawGoal(g, g.side === targetSide && (state === 'playing' || w.demo), t));
      w.coinList.forEach(c => {
        if (t - c.born > 8 && Math.floor(t * 8) % 2 === 0) return;
        const s = coinSprites[Math.floor(t * 8 + c.born * 3) % 4];
        b.drawImage(s, Math.round(c.x - s.width / 2), Math.round(c.y - 3));
      });
      if (w.power) drawPower(w.power, t);
      w.mines.forEach(m => drawMine(m, t));
      if (state !== 'dying' && state !== 'over') drawBall(w, t);
      w.particles.forEach(p => {
        b.globalAlpha = Math.max(0, p.life / p.max);
        b.fillStyle = p.color;
        b.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      });
      b.globalAlpha = 1;
      w.popups.forEach(p => { if (p.t < 0.6 || Math.floor(p.t * 12) % 2 === 0) txt(p.text, p.x, p.y - p.t * 22, p.color, 8, 'center'); });
      b.restore();

      const inGame = state === 'playing' || state === 'countdown' || state === 'paused' || state === 'dying';
      if (inGame) drawHud(w, t);

      if (state === 'countdown') {
        const c = Math.max(1, Math.ceil(countdown));
        txt(String(c), W / 2, H / 2 - 30, C.y, 32, 'center');
        txt('GET READY', W / 2, H / 2 + 12, C.w, 8, 'center');
        txt('SPACE / CLICK / TAP = FLAP', W / 2, H / 2 + 26, C.g, 8, 'center');
      }
      if (state === 'playing' && w.hint > 0 && Math.floor(w.hint * 3) % 2 === 0) {
        txt('HIT THE GREEN GOAL!', W / 2, H - 26, C.l, 8, 'center');
      }
      if (w.banner && inGame) {
        const a = w.banner;
        if (a.t > 2.0 || a.t < 1.6 || Math.floor(a.t * 6) % 2 === 0) {
          txt(a.text, W / 2, 44, C.y, 16, 'center');
          txt(a.sub, W / 2, 66, C.b, 8, 'center');
        }
      }
      if (w.flash > 0) { b.fillStyle = `rgba(255,241,232,${(w.flash * 0.7).toFixed(2)})`; b.fillRect(0, 0, W, H); }

      // Scale up crisply, then add scanlines and vignette
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
      if (crt) ctx.drawImage(crt, 0, 0);
    }

    // ─── Screens ─────────────────────────────────────────────────────────────
    const btn = (act, label, primary) => `<button type="button" class="pr-btn${primary ? ' primary' : ''}" data-act="${act}">${label}</button>`;
    function show(html) {
      overlay.innerHTML = `<div class="pr-panel">${html}</div>`;
      overlay.hidden = false;
      const first = overlay.querySelector('.pr-btn.primary') || overlay.querySelector('.pr-btn, .pr-skin');
      if (first && root.contains(document.activeElement)) first.focus({ preventScroll: true });
    }

    function showMenu() {
      if (!G || !G.demo) G = newWorld(true);
      state = 'menu';
      hud.hidden = false; pauseBtn.hidden = true;
      Music.stop();
      show(`
        <h2 class="pr-logo"><span class="a">PONG</span><span class="b">REIMAGINED</span></h2>
        <p class="pr-press pr-blink">PRESS SPACE</p>
        <div class="pr-btns">
          ${btn('play', 'Play', true)}
          <div class="pr-row">${btn('skins', 'Skins')}${btn('howto', 'How to play')}</div>
          <div class="pr-row">${btn('music', 'Music: ' + (Sound.musicOn ? 'On' : 'Off'))}${btn('sfx', 'SFX: ' + (Sound.sfxOn ? 'On' : 'Off'))}</div>
        </div>
        <p class="pr-meta">HI <b>${save.best}</b> &nbsp; BEST COMBO <b>${save.bestCombo}</b> &nbsp; COINS <b>${save.bank}</b></p>`);
    }

    function showHowto() {
      state = 'howto';
      show(`
        <h2 class="pr-h2">How to play</h2>
        <ul class="pr-howto">
          <li><i style="background:#fff1e8">FLAP</i><span>Space, click, or tap. Gravity does the rest.</span></li>
          <li><i style="background:#00e436">GOAL</i><span>Hit the green goal on each wall to bounce back. The <span style="color:#ffec27">yellow middle</span> is a PERFECT: double points.</span></li>
          <li><i style="background:#ff77a8">COMBO</i><span>Every 3 perfects in a row raises your multiplier, up to x5.</span></li>
          <li><i style="background:#ff004d;color:#fff1e8">AVOID</i><span>Red walls and spike mines. Mines blink before they arm. Close calls score a bonus.</span></li>
          <li><i style="background:#ffec27">LOOT</i><span>Coins unlock skins. Power-ups: <span style="color:#29adff">S</span> shield, <span style="color:#fff1e8">T</span> slow-mo, <span style="color:#ff77a8">M</span> magnet, <span style="color:#ffec27">2</span> double.</span></li>
        </ul>
        <div class="pr-btns"><div class="pr-row">${btn('play', 'Play', true)}${btn('menu', 'Back')}</div></div>`);
    }

    function showSkins() {
      state = 'skins';
      show(`
        <h2 class="pr-h2">Skins</h2>
        <div class="pr-skins">${SKINS.map(s => {
          const open = unlocked(s);
          return `<button type="button" class="pr-skin${s.id === save.skin ? ' on' : ''}${open ? '' : ' locked'}" data-skin="${s.id}" ${open ? '' : 'aria-disabled="true"'}>
            <canvas width="8" height="8" data-preview="${s.id}"></canvas>${s.name}<br>${open ? (s.id === save.skin ? 'EQUIPPED' : 'EQUIP') : s.cost + ' COINS'}</button>`;
        }).join('')}</div>
        <p class="pr-meta" style="margin:0 0 3cqh">You have <b>${save.bank}</b> coins. Collect more during runs to unlock skins.</p>
        <div class="pr-btns">${btn('menu', 'Back', true)}</div>`);
      overlay.querySelectorAll('canvas[data-preview]').forEach(c => c.getContext('2d').drawImage(skinSprites[c.dataset.preview], 0, 0));
    }

    function showOver() {
      state = 'over';
      hud.hidden = false; pauseBtn.hidden = true;
      const r = lastResult;
      show(`
        <h2 class="pr-h2">Game over</h2>
        <div class="pr-stats">
          <span>SCORE</span><b>${r.score}</b>
          <span>HI SCORE</span><b>${save.best}</b>
          <span>BEST COMBO</span><b>${r.combo}</b>
          <span>COINS</span><b>+${r.coins} (${save.bank})</b>
        </div>
        <div class="pr-badges">${r.newBest ? '<span class="pr-badge">NEW HI SCORE!</span>' : ''}${r.skins.map(n => `<span class="pr-badge skin">UNLOCKED: ${n}</span>`).join('')}</div>
        <div class="pr-btns"><div class="pr-row">${btn('play', 'Play again', true)}${btn('menu', 'Menu')}</div></div>
        <p class="pr-meta pr-blink">PRESS SPACE</p>`);
    }

    function showPaused() {
      show(`<h2 class="pr-h2">Paused</h2><div class="pr-btns"><div class="pr-row">${btn('resume', 'Resume', true)}${btn('menu', 'Quit')}</div></div><p class="pr-meta">P OR ESC TO RESUME</p>`);
    }

    function startGame() {
      Sound.unlock();
      G = newWorld(false);
      overlay.hidden = true;
      hud.hidden = false; pauseBtn.hidden = false;
      state = 'countdown'; countdown = 3; lastCount = 4;
      Music.tempo = 132; Music.start();
      root.focus({ preventScroll: true });
    }

    function pause() {
      if (state !== 'playing' && state !== 'countdown') return;
      resumeTo = state; state = 'paused';
      Music.stop();
      showPaused();
    }
    function resume() {
      if (state !== 'paused') return;
      overlay.hidden = true;
      state = resumeTo;
      Music.start();
      root.focus({ preventScroll: true });
    }

    overlay.addEventListener('click', e => {
      const skinBtn = e.target.closest('[data-skin]');
      if (skinBtn) {
        const s = SKINS.find(x => x.id === skinBtn.dataset.skin);
        if (s && unlocked(s)) { save.skin = s.id; store.set('pr-skin', s.id); Sound.unlock(); Sound.sfx('select'); showSkins(); }
        return;
      }
      const a = e.target.closest('[data-act]'); if (!a) return;
      Sound.unlock(); Sound.sfx('select');
      const act = a.dataset.act;
      if (act === 'play') startGame();
      else if (act === 'menu') { G = null; showMenu(); }
      else if (act === 'howto') showHowto();
      else if (act === 'skins') showSkins();
      else if (act === 'resume') resume();
      else if (act === 'music') { Sound.musicOn = !Sound.musicOn; store.set('pr-music', Sound.musicOn ? '1' : '0'); syncMute(); showMenu(); }
      else if (act === 'sfx') { Sound.sfxOn = !Sound.sfxOn; store.set('pr-sfx', Sound.sfxOn ? '1' : '0'); syncMute(); showMenu(); }
    });

    root.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      root.focus({ preventScroll: true });
      if (state === 'playing') { e.preventDefault(); Sound.unlock(); flap(); }
    });

    root.addEventListener('keydown', e => {
      const key = e.key;
      if (key === ' ' || key === 'ArrowUp' || key === 'w' || key === 'W') {
        e.preventDefault();
        if (e.repeat) return;
        if (state === 'playing') { Sound.unlock(); flap(); }
        else if (state === 'menu' || state === 'over' || state === 'howto') startGame();
        else if (state === 'paused') resume();
      } else if (key === 'p' || key === 'P' || key === 'Escape') {
        if (state === 'paused') resume(); else pause();
      } else if (key === 'm' || key === 'M') {
        toggleMute();
      }
    });

    function toggleMute() {
      const on = !(Sound.sfxOn || Sound.musicOn);
      Sound.sfxOn = Sound.musicOn = on;
      store.set('pr-sfx', on ? '1' : '0'); store.set('pr-music', on ? '1' : '0');
      syncMute();
      if (state === 'menu') showMenu();
    }
    muteBtn.addEventListener('click', e => { e.stopPropagation(); Sound.unlock(); toggleMute(); root.focus({ preventScroll: true }); });
    pauseBtn.addEventListener('click', e => { e.stopPropagation(); if (state === 'paused') resume(); else pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    root.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement)) pause(); }, 0));

    // ─── Loop ────────────────────────────────────────────────────────────────
    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      update(dt);
      draw();
      requestAnimationFrame(frame);
    }

    showMenu();
    if (document.fonts && document.fonts.load) document.fonts.load("8px 'Press Start 2P'").catch(() => {});
    requestAnimationFrame(frame);

    return {
      root,
      start: startGame,
      flap: () => flap(),
      /** Advance the simulation by dt seconds without drawing (for tests). */
      tick: dt => update(dt),
      /** Draw the current frame without advancing it (for screenshots). */
      render: () => draw(),
      /** Read-only view of the game state (for tests). */
      snapshot: () => ({
        state, score: G.score, stage: G.stage, combo: G.combo, mult: G.mult, coins: G.coins,
        ball: { ...G.ball }, goals: G.goals.map(g => ({ ...g })), power: G.power && { ...G.power }, fx: { ...G.fx },
        mines: G.mines.map(m => ({ x: m.x, y: m.y, deadly: G.t - m.born >= WARN })),
        coinList: G.coinList.map(c => ({ ...c }))
      })
    };
  }

  window.PongReimagined = { mount };
})();
