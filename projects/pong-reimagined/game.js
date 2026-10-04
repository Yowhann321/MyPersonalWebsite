/*
 * Pong Reimagined (web remake)
 * Original Pygame version by Team Xyke for a game jam. Rebuilt for the browser in plain JavaScript.
 *
 * You are a ball that can flap. Gravity pulls you down; Space, click, or tap makes you jump.
 * Hit the green goal on each wall to bounce back and score. Red walls and voids destroy you.
 *
 * Usage: PongReimagined.mount(containerElement, { assetBase: 'assets/' })
 */
(function () {
  'use strict';

  // ─── Tuning (logical resolution is 1280×720; speeds are per second) ──────
  const W = 1280, H = 720;
  const WALL = 12;
  const BALL_R = 20, BALL_SIZE = 46;
  const VOID_R = 15, VOID_SIZE = 36;
  const GRAVITY = 1000;
  const FLAP = -340;
  const LEVELS = [
    { from: 0,  speed: 230, voids: 2, respawn: 5.0, goal: 170, name: 'Outer rim' },
    { from: 15, speed: 320, voids: 3, respawn: 4.0, goal: 150, name: 'Deep space' },
    { from: 40, speed: 400, voids: 4, respawn: 3.0, goal: 135, name: 'The Void' }
  ];
  const VOID_WARNING = 0.7;     // seconds a void flashes before it becomes deadly
  const BEST_KEY = 'pong-reimagined-best';
  const MUTE_KEY = 'pong-reimagined-muted';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Sound: synthesized with Web Audio (no audio files) ──────────────────
  const Sound = {
    ctx: null,
    muted: store.get(MUTE_KEY, '0') === '1',
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    },
    tone(freq, dur, type, vol, slideTo, delay) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1200;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.buffer = buf; src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
    },
    flap() { this.tone(420, 0.09, 'square', 0.05, 640); },
    score() { this.tone(660, 0.08, 'triangle', 0.12); this.tone(990, 0.14, 'triangle', 0.12, null, 0.07); },
    death() { this.noise(0.45, 0.25); this.tone(300, 0.5, 'sawtooth', 0.08, 60); },
    level() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, null, i * 0.09)); },
    tick() { this.tone(880, 0.06, 'sine', 0.08); },
    go() { this.tone(1320, 0.18, 'sine', 0.1); },
    toggle() { this.muted = !this.muted; store.set(MUTE_KEY, this.muted ? '1' : '0'); return this.muted; }
  };

  // ─── Scoped styles for the overlay UI ────────────────────────────────────
  const CSS = `
.pr-root{container:pr / size;position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:manipulation;outline:none;font-family:Inter,system-ui,sans-serif;color:#eef}
.pr-root:focus-visible{box-shadow:0 0 0 3px #39ff88}
.pr-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pr-overlay{position:absolute;inset:0;display:flex;align-items:safe center;justify-content:center;padding:4%;overflow:auto;background:radial-gradient(ellipse at center,rgba(5,5,20,.55),rgba(0,0,0,.82));opacity:1;transition:opacity .25s}
.pr-overlay[hidden]{display:none}
.pr-panel{text-align:center;max-width:560px;width:100%}
.pr-logo{font-family:'Rubik Glitch',Impact,sans-serif;line-height:.9;margin:0 0 .35em;letter-spacing:.02em}
.pr-logo span{display:block}
.pr-logo .a{font-size:clamp(34px,8.5vw,104px);color:#f4f4ff;text-shadow:-3px 0 #ff3b5c,3px 0 #39ff88}
.pr-logo .b{font-size:clamp(18px,4vw,46px);color:#39ff88;text-shadow:-2px 0 #ff3b5c}
.pr-sub{font-size:clamp(11px,1.6vw,15px);color:#b9bfd9;margin:0 0 1.4em}
.pr-btns{display:flex;flex-direction:column;gap:clamp(6px,1.2vw,12px);align-items:center}
.pr-btn{font:700 clamp(12px,1.7vw,17px) Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;min-width:min(260px,60%);padding:clamp(8px,1.3vw,14px) 22px;border-radius:999px;border:2px solid rgba(255,255,255,.25);background:rgba(10,10,30,.6);color:#eef;cursor:pointer}
.pr-btn:hover,.pr-btn:focus-visible{border-color:#39ff88;color:#39ff88;outline:none}
.pr-btn.primary{background:#39ff88;border-color:#39ff88;color:#04140a}
.pr-btn.primary:hover,.pr-btn.primary:focus-visible{background:#7dffb2;color:#04140a}
.pr-meta{margin-top:1.2em;font-size:clamp(10px,1.4vw,13px);color:#8b91ad}
.pr-meta b{color:#ffd166}
.pr-howto{list-style:none;padding:0;margin:0 auto 1.4em;text-align:left;display:grid;gap:clamp(8px,1.4vw,14px);max-width:480px}
.pr-howto li{display:flex;gap:14px;align-items:center;font-size:clamp(12px,1.6vw,16px);color:#dfe3f5;line-height:1.35}
.pr-howto i{flex:none;width:clamp(26px,3.4vw,38px);height:clamp(26px,3.4vw,38px);border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:800}
.pr-h2{font-family:'Rubik Glitch',Impact,sans-serif;font-size:clamp(26px,6vw,72px);margin:0 0 .2em;color:#fff;text-shadow:-3px 0 #ff3b5c,3px 0 #39ff88;font-weight:400}
.pr-score{font-size:clamp(14px,2.2vw,22px);margin:0 0 .3em;color:#dfe3f5}
.pr-score b{font-family:'Rubik Glitch',Impact,sans-serif;font-weight:400;font-size:1.6em;color:#39ff88;margin-left:.2em}
.pr-newbest{display:inline-block;margin-bottom:1em;padding:3px 12px;border-radius:999px;background:#ffd166;color:#2a1d00;font-weight:800;font-size:clamp(10px,1.4vw,13px);letter-spacing:.08em;text-transform:uppercase}
.pr-hud-btn{position:absolute;top:2%;right:1.4%;width:clamp(28px,3.4vw,40px);height:clamp(28px,3.4vw,40px);border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.45);color:#eef;cursor:pointer;font-size:clamp(12px,1.6vw,17px);display:grid;place-items:center;z-index:2}
.pr-hud-btn.pause{right:calc(1.4% + clamp(34px,4.2vw,48px))}
.pr-hud-btn:hover{border-color:#39ff88}
.pr-hud-btn[hidden]{display:none}
@container pr (max-height: 300px){
  .pr-overlay{padding:2%}
  .pr-sub,.pr-meta,.pr-howto + .pr-btns [data-act=menu]{display:none}
  .pr-panel > .pr-h2:first-child:has(+ .pr-howto){display:none}
  .pr-logo{margin-bottom:.25em}
  .pr-logo .a{font-size:30px}.pr-logo .b{font-size:16px}
  .pr-h2{font-size:24px;margin:0}
  .pr-btns{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:6px}
  .pr-btn{min-width:0;padding:6px 12px;font-size:10px;border-width:1px}
  .pr-howto{gap:4px;margin-bottom:8px}
  .pr-howto li{font-size:10.5px;gap:6px}
  .pr-howto i{width:18px;height:18px;font-size:10px}
  .pr-score{font-size:12px;margin:0}
  .pr-newbest{margin-bottom:6px;font-size:9px}
}
`;

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function mount(container, opts) {
    opts = opts || {};
    const base = opts.assetBase || 'assets/';
    if (!document.getElementById('pr-styles')) {
      const s = el('style'); s.id = 'pr-styles'; s.textContent = CSS; document.head.appendChild(s);
    }

    // ─── DOM ───────────────────────────────────────────────────────────────
    const root = el('div', 'pr-root');
    root.tabIndex = 0;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Pong Reimagined game. Press Space, click, or tap to flap.');
    const canvas = el('canvas');
    const ctx = canvas.getContext('2d');
    const overlay = el('div', 'pr-overlay');
    const muteBtn = el('button', 'pr-hud-btn', '');
    muteBtn.type = 'button';
    const pauseBtn = el('button', 'pr-hud-btn pause', 'II');
    pauseBtn.type = 'button'; pauseBtn.setAttribute('aria-label', 'Pause');
    root.append(canvas, overlay, pauseBtn, muteBtn);
    container.appendChild(root);

    function syncMute() {
      muteBtn.textContent = Sound.muted ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-label', Sound.muted ? 'Turn sound on' : 'Turn sound off');
    }
    syncMute();

    // Crisp rendering on high-DPI screens
    let scale = 1;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = root.clientWidth || W;
      scale = (cssW / W) * dpr;
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(root); else window.addEventListener('resize', resize);

    // ─── Assets ────────────────────────────────────────────────────────────
    const img = name => { const i = new Image(); i.src = base + name; return i; };
    const bgs = ['Bg1.png', 'Bg2.png', 'Bg3.png'].map(img);
    const ballFrames = ['BallDefault.png', 'Ball1.png', 'Ball2.png', 'Ball3.png', 'Ball4.png', 'Ball5.png', 'Ball6.png'].map(img);
    const voidImg = img('Void.png');
    const ready = i => i.complete && i.naturalWidth > 0;

    // ─── Game state ────────────────────────────────────────────────────────
    let state = 'menu';            // menu | howto | countdown | playing | paused | dying | over
    let best = parseInt(store.get(BEST_KEY, '0'), 10) || 0;
    let ball, goals, voids, particles, trail;
    let score = 0, level = 0, prevLevel = 0, bgFade = 1;
    let countdown = 0, lastCount = 0, respawnTimer = 0, time = 0;
    let shake = 0, flash = 0, banner = null, hint = 0, newBest = false;

    function levelFor(s) { let l = 0; LEVELS.forEach((L, i) => { if (s >= L.from) l = i; }); return l; }

    function placeGoal(side, g) {
      const gh = LEVELS[level].goal;
      g = g || { side };
      g.h = gh;
      g.y = rand(WALL + 20, H - WALL - 20 - gh);
      g.pulse = 0;
      return g;
    }

    function spawnVoid(v, others) {
      // Where the ball will be once the void stops flashing (bouncing off the side walls)
      let px = ball.x + ball.vx * (VOID_WARNING + 0.4);
      if (px > W - WALL) px = 2 * (W - WALL) - px;
      if (px < WALL) px = 2 * WALL - px;
      const dirAfter = ball.x + ball.vx * (VOID_WARNING + 0.4) > W - WALL ? -1
        : ball.x + ball.vx * (VOID_WARNING + 0.4) < WALL ? 1 : Math.sign(ball.vx);
      const reach = Math.abs(ball.vx) * 1.2;
      let bestSpot = null, bestClearance = -1;

      for (let tries = 0; tries < 80; tries++) {
        const x = rand(200, W - 200), y = rand(70, H - 70);
        const clearance = Math.min(Math.hypot(x - ball.x, y - ball.y), Math.hypot(x - px, y - ball.y));
        // Keep the lane in front of the ball's future position clear
        const ahead = dirAfter > 0 ? x > px && x < px + reach : x < px && x > px - reach;
        const inLane = ahead && Math.abs(y - ball.y) < 110;
        const apart = others.every(o => o === v || Math.hypot(x - o.x, y - o.y) > 130);
        if (!inLane && apart && clearance > bestClearance) { bestClearance = clearance; bestSpot = { x, y }; }
        if (bestClearance > 240) break;
      }
      if (bestSpot) { v.x = bestSpot.x; v.y = bestSpot.y; }
      v.born = time;
      v.rot = rand(0, Math.PI * 2);
      return v;
    }

    function respawnVoids() {
      const n = LEVELS[level].voids;
      while (voids.length < n) voids.push({ x: -100, y: -100 });
      voids.forEach(v => spawnVoid(v, voids));
    }

    function reset() {
      score = 0; level = 0; prevLevel = 0; bgFade = 1; time = 0;
      ball = { x: 150, y: H / 2, vx: LEVELS[0].speed, vy: 0, frame: 0 };
      goals = [placeGoal('left'), placeGoal('right')];
      voids = []; particles = []; trail = [];
      respawnVoids();
      voids.forEach(v => { v.born = -10; });    // already visible during the countdown
      respawnTimer = LEVELS[0].respawn;
      shake = flash = 0; banner = null; hint = 4; newBest = false;
    }

    // ─── Overlay screens ───────────────────────────────────────────────────
    function show(html, bind) {
      overlay.innerHTML = `<div class="pr-panel">${html}</div>`;
      overlay.hidden = false;
      if (bind) bind();
      const first = overlay.querySelector('.pr-btn.primary') || overlay.querySelector('.pr-btn');
      if (first && document.activeElement && root.contains(document.activeElement)) first.focus({ preventScroll: true });
    }
    const btn = (id, label, primary) => `<button type="button" class="pr-btn${primary ? ' primary' : ''}" data-act="${id}">${label}</button>`;
    overlay.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      e.stopPropagation(); Sound.unlock();
      ({ play: startCountdown, howto: showHowto, menu: showMenu, resume: resume, sound: () => { Sound.toggle(); syncMute(); showMenu(); } })[b.dataset.act]();
    });

    function showMenu() {
      state = 'menu';
      pauseBtn.hidden = true;
      show(`
        <h2 class="pr-logo"><span class="a">PONG</span><span class="b">REIMAGINED</span></h2>
        <p class="pr-sub">A one-button arcade game about a ball that learned to flap.</p>
        <div class="pr-btns">${btn('play', 'Play', true)}${btn('howto', 'How to play')}${btn('sound', 'Sound: ' + (Sound.muted ? 'Off' : 'On'))}</div>
        <div class="pr-meta">${best > 0 ? `Best score: <b>${best}</b> · ` : ''}Press Space to start</div>`);
    }

    function showHowto() {
      state = 'howto';
      show(`
        <h2 class="pr-h2">How to play</h2>
        <ul class="pr-howto">
          <li><i style="background:#eef;color:#111">↑</i><span><b>Flap</b> with Space, a click, or a tap. Gravity does the rest.</span></li>
          <li><i style="background:#39ff88;color:#04140a">✓</i><span>Hit the <b style="color:#39ff88">green goal</b> on each wall to bounce back and score.</span></li>
          <li><i style="background:#ff3b5c;color:#fff">!</i><span><b style="color:#ff6b81">Red walls</b> and <b style="color:#7dff6b">voids</b> destroy you. Voids flash before they appear.</span></li>
          <li><i style="background:#ffd166;color:#2a1d00">★</i><span>The ball speeds up at <b>15</b> and <b>40</b> points.</span></li>
        </ul>
        <div class="pr-btns">${btn('play', 'Play', true)}${btn('menu', 'Back')}</div>`);
    }

    function showOver() {
      state = 'over';
      pauseBtn.hidden = true;
      show(`
        <h2 class="pr-h2">Game over</h2>
        <p class="pr-score">Score <b>${score}</b></p>
        ${newBest ? '<span class="pr-newbest">New best!</span>' : `<p class="pr-meta" style="margin:0 0 1em">Best: <b>${best}</b> · Reached ${LEVELS[level].name}</p>`}
        <div class="pr-btns">${btn('play', 'Play again', true)}${btn('menu', 'Menu')}</div>
        <div class="pr-meta">Press Space to play again</div>`);
    }

    function showPaused() {
      show(`<h2 class="pr-h2">Paused</h2><div class="pr-btns">${btn('resume', 'Resume', true)}${btn('menu', 'Quit to menu')}</div><div class="pr-meta">Press P or Esc to resume</div>`);
    }

    function startCountdown() {
      reset();
      overlay.hidden = true;
      state = 'countdown';
      countdown = 3; lastCount = 4;
      pauseBtn.hidden = false;
      root.focus({ preventScroll: true });
    }

    function pause() {
      if (state !== 'playing' && state !== 'countdown') return;
      root.dataset.resumeTo = state;
      state = 'paused';
      showPaused();
    }

    function resume() {
      if (state !== 'paused') return;
      overlay.hidden = true;
      state = root.dataset.resumeTo || 'playing';
      root.focus({ preventScroll: true });
    }

    // ─── Input ─────────────────────────────────────────────────────────────
    function flap() {
      Sound.unlock();
      if (state === 'playing') {
        ball.vy = FLAP;
        Sound.flap();
        burst(ball.x - Math.sign(ball.vx) * BALL_R, ball.y + BALL_R * 0.6, 5, '#cfe8ff', 90, 0.35);
      }
    }

    root.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      root.focus({ preventScroll: true });
      if (state === 'playing') { e.preventDefault(); flap(); }
    });

    root.addEventListener('keydown', e => {
      const k = e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        if (e.repeat) return;
        if (state === 'playing') flap();
        else if (state === 'menu' || state === 'over' || state === 'howto') { Sound.unlock(); startCountdown(); }
        else if (state === 'paused') resume();
      } else if (k === 'p' || k === 'P' || k === 'Escape') {
        if (state === 'paused') resume(); else pause();
      } else if (k === 'm' || k === 'M') {
        Sound.toggle(); syncMute();
      }
    });

    muteBtn.addEventListener('click', e => { e.stopPropagation(); Sound.unlock(); Sound.toggle(); syncMute(); if (state === 'menu') showMenu(); root.focus({ preventScroll: true }); });
    pauseBtn.addEventListener('click', e => { e.stopPropagation(); if (state === 'paused') resume(); else pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    root.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement)) pause(); }, 0));

    // ─── Effects ───────────────────────────────────────────────────────────
    function burst(x, y, n, color, speed, life) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(2, 5) });
      }
    }

    function die() {
      state = 'dying';
      pauseBtn.hidden = true;
      Sound.death();
      burst(ball.x, ball.y, 46, '#9fd8ff', 420, 0.9);
      burst(ball.x, ball.y, 22, '#ff3b5c', 300, 0.7);
      shake = reducedMotion() ? 0 : 0.45;
      flash = 0.6;
      if (score > best) { best = score; newBest = true; store.set(BEST_KEY, String(best)); }
      setTimeout(showOver, 950);
    }

    // ─── Update ────────────────────────────────────────────────────────────
    function update(dt) {
      time += dt;
      particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; });
      particles = particles.filter(p => p.life > 0);
      shake = Math.max(0, shake - dt);
      flash = Math.max(0, flash - dt * 1.6);
      if (bgFade < 1) { bgFade = Math.min(1, bgFade + dt * 1.2); if (bgFade >= 1) prevLevel = level; }
      goals && goals.forEach(g => { g.pulse = Math.max(0, g.pulse - dt * 2); });
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      if (ball) ball.frame += dt * 12;

      if (state === 'countdown') {
        countdown -= dt;
        const c = Math.ceil(countdown);
        if (c !== lastCount && c > 0) { Sound.tick(); lastCount = c; }
        if (countdown <= 0) { state = 'playing'; Sound.go(); ball.vy = FLAP * 0.6; }
        return;
      }
      if (state !== 'playing') return;

      hint = Math.max(0, hint - dt);
      const L = LEVELS[level];

      // Physics
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 10) trail.shift();

      // Floor and ceiling are deadly
      if (ball.y - BALL_R <= WALL || ball.y + BALL_R >= H - WALL) return die();

      // Side walls: the goal bounces you back, anywhere else destroys you
      const hitLeft = ball.vx < 0 && ball.x - BALL_R <= WALL;
      const hitRight = ball.vx > 0 && ball.x + BALL_R >= W - WALL;
      if (hitLeft || hitRight) {
        const g = goals[hitLeft ? 0 : 1];
        if (ball.y >= g.y - 4 && ball.y <= g.y + g.h + 4) {
          score++;
          Sound.score();
          ball.x = hitLeft ? WALL + BALL_R + 1 : W - WALL - BALL_R - 1;
          burst(hitLeft ? WALL : W - WALL, ball.y, 18, '#39ff88', 260, 0.6);
          const nl = levelFor(score);
          const levelUp = nl !== level;
          if (levelUp) { prevLevel = level; level = nl; bgFade = 0; }
          ball.vx = (hitLeft ? 1 : -1) * LEVELS[level].speed;
          if (levelUp) {
            banner = { text: `LEVEL ${level + 1}`, sub: LEVELS[level].name, t: 2.2 };
            Sound.level();
            respawnVoids();
            respawnTimer = LEVELS[level].respawn;
          }
          placeGoal(g.side, g);
          g.pulse = 1;
        } else {
          return die();
        }
      }

      // Voids
      for (const v of voids) {
        if (time - v.born < VOID_WARNING) continue;
        if (Math.hypot(ball.x - v.x, ball.y - v.y) < BALL_R + VOID_R - 4) return die();
      }
      respawnTimer -= dt;
      if (respawnTimer <= 0) { respawnVoids(); respawnTimer = L.respawn; }
    }

    // ─── Draw ──────────────────────────────────────────────────────────────
    function drawBg(i, alpha) {
      const b = bgs[i];
      ctx.globalAlpha = alpha;
      if (ready(b)) ctx.drawImage(b, 0, 0, W, H);
      else { ctx.fillStyle = '#05050f'; ctx.fillRect(0, 0, W, H); }
      ctx.globalAlpha = 1;
    }

    function glowRect(x, y, w, h, color, blur) {
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = blur;
      ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    function draw() {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.save();
      if (shake > 0) ctx.translate(rand(-1, 1) * 14 * shake, rand(-1, 1) * 14 * shake);

      // Background (crossfades on level change)
      drawBg(prevLevel, 1);
      if (bgFade < 1 || level !== prevLevel) drawBg(level, bgFade);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);

      if (!ball) { ctx.restore(); return; }

      // Big faded score in the middle, like the original
      if (state !== 'menu' && state !== 'howto') {
        ctx.font = "160px 'Rubik Glitch', Impact, sans-serif";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(220,224,240,0.16)';
        ctx.fillText(String(score), W / 2, H / 2);
      }

      // Red walls
      const pulse = 0.6 + 0.4 * Math.sin(time * 3);
      glowRect(0, 0, W, WALL / 2, '#ff3b5c', 14 * pulse);
      glowRect(0, H - WALL / 2, W, WALL / 2, '#ff3b5c', 14 * pulse);
      glowRect(0, 0, WALL / 2, H, '#ff3b5c', 14 * pulse);
      glowRect(W - WALL / 2, 0, WALL / 2, H, '#ff3b5c', 14 * pulse);

      // Green goals
      goals.forEach(g => {
        const x = g.side === 'left' ? 0 : W - WALL - 4;
        glowRect(x, g.y, WALL + 4, g.h, '#39ff88', 22 + 30 * g.pulse);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(g.side === 'left' ? WALL : W - WALL - 2, g.y + 6, 2, g.h - 12);
      });

      // Voids (flash while warming up, then spin)
      voids.forEach(v => {
        const age = time - v.born;
        ctx.save();
        ctx.translate(v.x, v.y);
        if (age < VOID_WARNING) {
          const k = age / VOID_WARNING;
          ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(age * 18));
          ctx.strokeStyle = '#7dff6b'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, VOID_R + 22 * (1 - k), 0, Math.PI * 2); ctx.stroke();
        }
        ctx.rotate(v.rot + time * 2.2);
        if (ready(voidImg)) ctx.drawImage(voidImg, -VOID_SIZE / 2, -VOID_SIZE / 2, VOID_SIZE, VOID_SIZE);
        else { ctx.fillStyle = '#3cff5a'; ctx.beginPath(); ctx.arc(0, 0, VOID_R, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      });

      // Trail and ball
      if (state !== 'dying' && state !== 'over') {
        trail.forEach((t, i) => {
          ctx.globalAlpha = (i / trail.length) * 0.28;
          ctx.fillStyle = '#9fd8ff';
          ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (0.4 + 0.6 * i / trail.length), 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        const f = ballFrames[Math.floor(ball.frame) % ballFrames.length];
        ctx.save();
        ctx.shadowColor = '#9fd8ff'; ctx.shadowBlur = 16;
        if (ready(f)) ctx.drawImage(f, ball.x - BALL_SIZE / 2, ball.y - BALL_SIZE / 2, BALL_SIZE, BALL_SIZE);
        else { ctx.fillStyle = '#cfe8ff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }

      // Particles
      particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      // HUD
      if (state === 'playing' || state === 'countdown' || state === 'paused' || state === 'dying') {
        ctx.font = "600 18px Inter, system-ui, sans-serif";
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(`LEVEL ${level + 1} · ${LEVELS[level].name.toUpperCase()}`, 28, 26);
        ctx.fillStyle = 'rgba(255,209,102,0.9)';
        ctx.fillText(`BEST ${Math.max(best, score)}`, 28, 50);
      }

      // Countdown
      if (state === 'countdown') {
        const c = Math.max(1, Math.ceil(countdown));
        const k = countdown - Math.floor(countdown);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${120 + 60 * k}px 'Rubik Glitch', Impact, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(String(c), W / 2, H / 2 - 30);
        ctx.font = "600 24px Inter, system-ui, sans-serif";
        ctx.fillStyle = 'rgba(230,235,255,0.9)';
        ctx.fillText('Space, click, or tap to flap', W / 2, H / 2 + 80);
      }

      // First-seconds hint
      if (state === 'playing' && hint > 0) {
        ctx.globalAlpha = Math.min(1, hint);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = "600 22px Inter, system-ui, sans-serif";
        ctx.fillStyle = 'rgba(230,235,255,0.9)';
        ctx.fillText('Hit the green goal on the far wall', W / 2, H - 60);
        ctx.globalAlpha = 1;
      }

      // Level banner
      if (banner) {
        const a = Math.min(1, banner.t, (2.2 - banner.t) * 4);
        ctx.globalAlpha = a;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = "72px 'Rubik Glitch', Impact, sans-serif";
        ctx.fillStyle = '#ff3b5c'; ctx.fillText(banner.text, W / 2 - 3, 150);
        ctx.fillStyle = '#39ff88'; ctx.fillText(banner.text, W / 2 + 3, 150);
        ctx.fillStyle = '#fff'; ctx.fillText(banner.text, W / 2, 150);
        ctx.font = "600 24px Inter, system-ui, sans-serif";
        ctx.fillText(banner.sub, W / 2, 205);
        ctx.globalAlpha = 1;
      }

      // Death flash
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
    }

    // ─── Loop ──────────────────────────────────────────────────────────────
    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      update(dt);
      draw();
      requestAnimationFrame(frame);
    }

    reset();
    showMenu();
    if (document.fonts && document.fonts.load) document.fonts.load("40px 'Rubik Glitch'").catch(() => {});
    requestAnimationFrame(frame);

    return {
      root,
      get state() { return state; },
      get score() { return score; },
      start: startCountdown,
      flap,
      /** Advance the simulation by dt seconds without drawing (for tests). */
      tick: dt => update(dt),
      /** Draw the current frame without advancing it (for screenshots). */
      render: () => draw(),
      /** Read-only view of the game, handy for tests. */
      snapshot: () => ({ state, score, level, ball: ball && { ...ball }, goals: goals && goals.map(g => ({ ...g })), voids: voids && voids.map(v => ({ ...v, deadly: time - v.born >= VOID_WARNING })) })
    };
  }

  window.PongReimagined = { mount };
})();
