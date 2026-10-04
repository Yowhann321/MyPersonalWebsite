/*
 * CLIR Book A Seat: a web-based seat booking system concept for the MMCL CLIR library.
 *
 * Runs entirely in the browser. State lives in localStorage, so the student view and the
 * librarian view stay in sync across tabs in real time. Each tab keeps its own sign-in
 * (sessionStorage), so you can be a student in one tab and a librarian in another.
 *
 * Policies follow the current CLIR rules: up to 2 hours per booking, a 10-minute check-in
 * window, and a visible 10-minute break hold.
 */
(function () {
  'use strict';

  // ─── Policy and constants ───────────────────────────────────────────────
  const STORE_KEY = 'clir-bas-v1';
  const SESSION_KEY = 'clir-bas-session';
  const LEADER_KEY = 'clir-bas-leader';
  const MIN = 60 * 1000;
  const CHECKIN_MIN = 10;
  const BREAK_MIN = 10;
  const EXTEND_MIN = 60;
  const EXTEND_WINDOW_MIN = 30;
  const DURATIONS = [30, 60, 90, 120];
  const DEPTS = ['CCIS', 'CHS', 'MITL', 'CAS', 'CMET', 'ETYCB', 'MIA'];
  const OUT_REASONS = ['Maintenance', 'Cleaning', 'Reserved for an event'];

  const FEATURES = {
    outlet: { label: 'Power outlet', icon: 'plug' },
    window: { label: 'By the window', icon: 'sun' },
    quiet: { label: 'Quiet area', icon: 'moon' },
    carrel: { label: 'Private carrel', icon: 'carrel' },
    desk: { label: 'Near control desk', icon: 'desk' }
  };

  // The Individual Study Zone, CLIR Einstein Building 2nd floor (seats C-01 to C-49).
  // Coordinates are on a 1000 × 620 floor plan.
  const SEATS = (() => {
    const list = [];
    let n = 1;
    const add = (row, area, x, y, f) => list.push({ id: 'C-' + String(n++).padStart(2, '0'), row, area, x, y, f });
    for (let p = 0; p < 6; p++) for (let k = 0; k < 2; k++) add('A', 'Study bench, window side', 160 + p * 130 + k * 48, 70, ['window', 'outlet']);
    for (let p = 0; p < 6; p++) for (let k = 0; k < 2; k++) add('B', 'Study bench', 160 + p * 130 + k * 48, 158, ['outlet']);
    for (let i = 0; i < 9; i++) add('C', 'Carrels, row C', 160 + i * 85, 300, ['carrel', 'outlet']);
    for (let i = 0; i < 9; i++) add('D', 'Carrels, row D', 160 + i * 85, 390, ['carrel'].concat(i < 5 ? ['quiet'] : [], i >= 7 ? ['desk'] : []));
    for (let i = 0; i < 7; i++) add('E', 'Carrels, row E', 160 + i * 85, 480, ['carrel'].concat(i < 3 ? ['quiet'] : [], i >= 4 ? ['desk'] : []));
    return list;
  })();
  const SEAT_BY_ID = Object.fromEntries(SEATS.map(s => [s.id, s]));
  const TOTAL = SEATS.length;

  const SAMPLE_NAMES = ['Andrea Santos', 'Miguel Reyes', 'Bea Cruz', 'Paolo Garcia', 'Kyla Mendoza', 'Joshua Torres', 'Nicole Ramos', 'Carlo Villanueva',
    'Trisha Aquino', 'Mark Bautista', 'Jasmine Flores', 'Ralph Castillo', 'Angela Navarro', 'Kevin Dela Cruz', 'Sofia Lim', 'Gabriel Tan',
    'Hannah Gonzales', 'Luis Fernandez', 'Patricia Ocampo', 'Enzo Rivera', 'Camille Domingo', 'Adrian Pascual', 'Ella Morales', 'Marco Salazar',
    'Isabel Soriano', 'Vince Manalo', 'Rica Valdez', 'Jerome Aguilar', 'Mae Santiago', 'Ian Robles', 'Lara Mercado', 'Diego Ramirez'];

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const tabId = Math.random().toString(36).slice(2);

  function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function fmtDate(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtDur(min) { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }
  function fmtClock(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; }
  function durLabel(min) { return min < 60 ? min + ' min' : (min / 60) + (min === 60 ? ' hr' : ' hrs'); }
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

  async function hash(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('clir:' + text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      let h = 2166136261; for (const ch of 'clir:' + text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16);
    }
  }

  // Icons (simple 24px line icons)
  const ICONS = {
    plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    carrel: 'M4 4h16v16H4zM4 10h16M9 10v10',
    desk: 'M3 10h18M5 10v10M19 10v10M8 6h8v4H8z',
    check: 'M5 12l5 5L20 7',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
    seat: 'M7 3h10v9H7zM5 12h14v3H5zM7 15v6M17 15v6',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    pointer: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4M12 16h.01'
  };
  const icon = (name, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

  // ─── Storage ──────────────────────────────────────────────────────────────
  let S = null;
  const now = () => Date.now() + (S ? S.offset : 0);

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }

  function session() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function setSession(uid) { try { if (uid) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid })); else sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function me() { const s = session(); return s && S.users.find(u => u.id === s.uid) || null; }

  /** Reload the latest shared state, apply a change, save, and redraw. */
  function mutate(fn) {
    S = load() || S;
    const result = fn(S);
    save();
    refresh();
    return result;
  }

  // ─── Sample data ──────────────────────────────────────────────────────────
  // Students favor seats with outlets and window views, so weight the sample data that way
  function pickSeat() {
    const w = SEATS.map(s => 1 + (s.f.includes('outlet') ? 1.2 : 0) + (s.f.includes('window') ? 1 : 0));
    let r = Math.random() * w.reduce((a, b) => a + b);
    for (let i = 0; i < SEATS.length; i++) { r -= w[i]; if (r <= 0) return SEATS[i]; }
    return SEATS[0];
  }

  function seed() {
    const s = { v: 1, offset: 0, paused: false, rushUntil: 0, users: [], seats: {}, logs: [], nextLog: 1 };
    s.users.push({ id: 'u-librarian', no: 'librarian', name: 'CLIR Librarian', role: 'librarian', pass: null });
    s.users.push({ id: 'u-demo', no: '2022-10001', name: 'Alex Rivera', dept: 'CCIS', program: 'BS Information Technology', year: '3', role: 'student', pass: null });
    SAMPLE_NAMES.forEach((name, i) => s.users.push({
      id: 'sim-' + i, sim: true, role: 'student', name,
      no: `20${pick(['21', '22', '23', '24'])}-${String(10100 + i * 37).padStart(5, '0')}`,
      dept: DEPTS[(i * 3 + 1) % DEPTS.length], year: String(1 + (i % 4))
    }));
    SEATS.forEach(seat => { s.seats[seat.id] = { status: 'free' }; });

    // Two weeks of history for the reports
    const sims = s.users.filter(u => u.sim);
    const today = startOfDay(Date.now());
    const hourWeight = [2, 5, 9, 10, 8, 6, 8, 10, 9, 7, 5, 3];   // 8 AM to 7 PM
    for (let d = 14; d >= 1; d--) {
      const day = today - d * 24 * 60 * MIN;
      const dow = new Date(day).getDay();
      if (dow === 0) continue;   // closed on Sundays
      const sessions = Math.round((dow === 6 ? 35 : rand(70, 105)));
      for (let k = 0; k < sessions; k++) {
        let r = Math.random() * hourWeight.reduce((a, b) => a + b), hour = 8;
        for (let h = 0; h < hourWeight.length; h++) { r -= hourWeight[h]; if (r <= 0) { hour = 8 + h; break; } }
        const start = day + hour * 60 * MIN + rand(0, 59) * MIN;
        const u = pick(sims), seat = pickSeat();
        const roll = Math.random();
        let outcome = 'Completed', minutes = pick([45, 60, 75, 90, 105, 120]) - rand(0, 15);
        if (roll < 0.08) { outcome = 'No-show'; minutes = 0; }
        else if (roll < 0.13) { outcome = 'Break exceeded'; minutes = rand(20, 70); }
        else if (roll < 0.25) { outcome = 'Time up'; minutes = pick([60, 90, 120]); }
        s.logs.push(logEntry(s, u, seat.id, start, start + minutes * MIN, outcome));
      }
    }
    s.logs.sort((a, b) => a.end - b.end);

    // Today's floor: fill about 55% of the seats
    const t = Date.now();
    const shuffled = SEATS.map(x => x.id).sort(() => Math.random() - 0.5);
    shuffled.slice(0, 27).forEach((id, i) => {
      const u = sims[i % sims.length];
      const dur = pick([60, 90, 120]);
      const start = t - rand(5, dur - 8) * MIN;
      s.seats[id] = { status: 'busy', uid: u.id, start, end: start + dur * MIN, ext: 0 };
    });
    shuffled.slice(27, 29).forEach((id, i) => { s.seats[id] = { status: 'break', uid: sims[27 + i].id, start: t - 40 * MIN, end: t + 50 * MIN, breakAt: t - rand(1, 6) * MIN, ext: 0, simBack: rand(3, 8) }; });
    shuffled.slice(29, 31).forEach((id, i) => { s.seats[id] = { status: 'held', uid: sims[29 + i].id, heldAt: t - rand(1, 5) * MIN, dur: 90, simCheckIn: rand(2, 7) }; });
    s.seats['C-17'] = { status: 'out', reason: 'Maintenance' };
    return s;
  }

  function logEntry(s, u, seatId, start, end, outcome) {
    return { id: s.nextLog++, uid: u.id, no: u.no, name: u.name, dept: u.dept || '', seat: seatId, start, end, min: Math.round((end - start) / MIN), outcome };
  }

  // ─── Booking rules ────────────────────────────────────────────────────────
  function seatOf(uid) { return Object.keys(S.seats).find(id => S.seats[id].uid === uid) || null; }
  function counts(s) {
    const c = { free: 0, held: 0, busy: 0, break: 0, out: 0 };
    Object.values((s || S).seats).forEach(x => { c[x.status]++; });
    return c;
  }

  /** End whatever is on a seat and write it to the logs. */
  function endSeat(s, id, outcome) {
    const st = s.seats[id];
    if (!st || !st.uid) return;
    const u = s.users.find(x => x.id === st.uid);
    const t = Date.now() + s.offset;
    if (u) {
      const start = st.start || st.heldAt || t;
      s.logs.push(logEntry(s, u, id, start, outcome === 'No-show' ? start : Math.min(t, st.end || t), outcome));
    }
    s.seats[id] = { status: 'free' };
  }

  function reserve(seatId, dur) {
    const u = me();
    if (!u) return toast('Sign in to reserve a seat.');
    return mutate(s => {
      if (seatOf(u.id)) { toast('You already have a seat. End it before booking another.'); return; }
      if (s.seats[seatId].status !== 'free') { toast('Someone just took that seat. Pick another one.'); return; }
      s.seats[seatId] = { status: 'held', uid: u.id, heldAt: now(), dur };
      toast(`Seat ${seatId} reserved. Check in within ${CHECKIN_MIN} minutes.`);
    });
  }

  function checkIn() {
    const u = me(); if (!u) return;
    mutate(s => {
      const id = seatOf(u.id); const st = id && s.seats[id];
      if (!st || st.status !== 'held') return;
      const t = now();
      s.seats[id] = { status: 'busy', uid: u.id, start: t, end: t + st.dur * MIN, ext: 0 };
      toast(`Checked in at ${id}. Enjoy your study session.`);
    });
  }

  function takeBreak() {
    const u = me(); if (!u) return;
    mutate(s => { const id = seatOf(u.id); const st = id && s.seats[id]; if (st && st.status === 'busy') { st.status = 'break'; st.breakAt = now(); toast(`Seat held for ${BREAK_MIN} minutes. See you soon.`); } });
  }

  function backFromBreak() {
    const u = me(); if (!u) return;
    mutate(s => { const id = seatOf(u.id); const st = id && s.seats[id]; if (st && st.status === 'break') { st.status = 'busy'; delete st.breakAt; toast('Welcome back.'); } });
  }

  function extend() {
    const u = me(); if (!u) return;
    mutate(s => {
      const id = seatOf(u.id); const st = id && s.seats[id];
      if (!st || st.status !== 'busy') return;
      if (st.ext >= 1) return toast('You can extend a booking once.');
      if (st.end - now() > EXTEND_WINDOW_MIN * MIN) return toast(`You can extend in the last ${EXTEND_WINDOW_MIN} minutes of your booking.`);
      st.end += EXTEND_MIN * MIN; st.ext = (st.ext || 0) + 1;
      toast(`Extended by ${EXTEND_MIN / 60} hour. New end time ${fmtTime(st.end)}.`);
    });
  }

  function endMine() {
    const u = me(); if (!u) return;
    const id = seatOf(u.id); if (!id) return;
    const held = S.seats[id].status === 'held';
    confirmDialog(held ? 'Cancel this reservation?' : 'End your session?', held ? `Seat ${id} will be released for others.` : `Seat ${id} will be released and your session saved to the logs.`, held ? 'Cancel reservation' : 'End session', () => {
      mutate(s => { endSeat(s, id, held ? 'Cancelled' : 'Completed'); });
      toast(held ? 'Reservation cancelled.' : 'Session ended. Thanks for studying at CLIR.');
    });
  }

  // ─── Live engine (one tab runs it; the others follow along) ───────────────
  function isLeader() {
    const t = Date.now();
    let l = null; try { l = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); } catch (e) {}
    if (!l || l.id === tabId || t - l.ts > 3500) { try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId, ts: t })); } catch (e) {} return true; }
    return false;
  }

  let simClock = 0;
  function engineTick() {
    if (!isLeader()) return;
    const latest = load(); if (latest) S = latest;
    const t = now();
    let changed = false;

    Object.keys(S.seats).forEach(id => {
      const st = S.seats[id];
      const u = st.uid && S.users.find(x => x.id === st.uid);
      if (st.status === 'held') {
        if (u && u.sim && st.simCheckIn && t - st.heldAt > st.simCheckIn * MIN) { S.seats[id] = { status: 'busy', uid: st.uid, start: t, end: t + st.dur * MIN, ext: 0 }; changed = true; }
        else if (t - st.heldAt > CHECKIN_MIN * MIN) { endSeat(S, id, 'No-show'); changed = true; }
      } else if (st.status === 'break') {
        if (u && u.sim && st.simBack && t - st.breakAt > st.simBack * MIN) { st.status = 'busy'; delete st.breakAt; delete st.simBack; changed = true; }
        else if (t - st.breakAt > BREAK_MIN * MIN) { endSeat(S, id, 'Break exceeded'); changed = true; }
        else if (t >= st.end) { endSeat(S, id, 'Time up'); changed = true; }
      } else if (st.status === 'busy' && t >= st.end) {
        endSeat(S, id, 'Time up'); changed = true;
      }
    });

    // Simulated students come and go so the floor feels alive
    simClock++;
    if (!S.paused && simClock % 6 === 0) {
      const c = counts();
      const target = S.rushUntil > t ? 0.9 : 0.6;
      const occupied = (c.busy + c.held + c.break) / TOTAL;
      const idleSims = S.users.filter(u => u.sim && !seatOf(u.id));
      const free = SEATS.filter(x => S.seats[x.id].status === 'free');
      if (occupied < target && free.length && idleSims.length && Math.random() < 0.8) {
        const id = pick(free).id, u = pick(idleSims);
        S.seats[id] = { status: 'held', uid: u.id, heldAt: t, dur: pick([60, 90, 120]), simCheckIn: Math.random() < 0.88 ? rand(0.3, 4) : 0 };
        changed = true;
      } else if (Math.random() < 0.35) {
        const busy = Object.keys(S.seats).filter(id => S.seats[id].status === 'busy' && S.users.find(u => u.id === S.seats[id].uid && u.sim));
        if (busy.length) {
          const id = pick(busy);
          if (Math.random() < 0.3) { const st = S.seats[id]; st.status = 'break'; st.breakAt = t; st.simBack = Math.random() < 0.85 ? rand(2, 8) : 0; }
          else if (occupied > target - 0.05) endSeat(S, id, 'Completed');
          changed = true;
        }
      }
    }
    if (changed) { save(); refresh(); }
  }

  // ─── UI state ─────────────────────────────────────────────────────────────
  let route = '';
  let selected = null;
  let duration = 120;
  let filters = new Set();
  let mapView = window.matchMedia && matchMedia('(max-width: 640px)').matches ? 'list' : 'map';
  let authTab = 'signin';
  let logQuery = { q: '', dept: '', outcome: '', range: '7' };
  let reportRange = 14;
  const app = $('#app');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('on'), 3200);
  }

  function confirmDialog(title, text, action, onYes) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdl-t"><h3 id="mdl-t">${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" data-no>Keep it</button><button class="btn primary" data-yes>${esc(action)}</button></div></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-no]')) close(); if (e.target.closest('[data-yes]')) { close(); onYes(); } });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    back.querySelector('[data-yes]').focus();
  }

  // ─── Shared pieces ────────────────────────────────────────────────────────
  function header() {
    const u = me();
    const lib = u && u.role === 'librarian';
    const link = (href, label) => `<a href="${href}" class="${route === href.slice(1) || (href === '#/admin' && route === '/admin') ? 'on' : ''}">${label}</a>`;
    return `<header class="topbar"><div class="inner">
      <a class="brand" href="#/map"><span class="brand-mark">${icon('seat')}</span><span>CLIR Book A Seat<small>Center for Learning and Information Resources</small></span></a>
      <nav class="nav" aria-label="Main">${link('#/map', 'Seat map')}${lib ? link('#/admin', 'Dashboard') + link('#/admin/logs', 'Logs') + link('#/admin/reports', 'Reports') : ''}</nav>
      <div class="user">${u ? `<span class="avatar">${esc(initials(u.name))}</span><span class="user-name">${esc(u.name)}<small>${lib ? 'Librarian' : esc(u.no)}</small></span><button class="link-btn" data-act="signout">Sign out</button>`
        : `<a class="link-btn" href="#/">Sign in</a>`}</div>
    </div></header>`;
  }

  function footer() {
    return `<footer class="foot">A capstone concept by Group 1: Johann Lijauco, Denzel Adrienne Arciaga, Kurt Tracy Amador, Rafael Mercado, and Daniela Madrasto. Not affiliated with or endorsed by Mapúa Malayan Colleges Laguna.</footer>`;
  }

  function statsHTML(admin) {
    const c = counts();
    const pct = n => Math.round(n / TOTAL * 100);
    const card = (label, val, color, extra) => `<div class="card stat"><small>${label}</small><b>${val}</b>${extra || ''}${color ? `<div class="bar"><i style="width:${pct(typeof val === 'number' ? val : 0)}%;background:${color}"></i></div>` : ''}</div>`;
    if (!admin) {
      return card('Available now', c.free, 'var(--free)') + card('In use', c.busy + c.held, 'var(--busy)') + card('On a break', c.break, 'var(--break)') + card('Out of service', c.out, 'var(--out)');
    }
    const today = startOfDay(now());
    const done = S.logs.filter(l => l.end >= today && l.outcome !== 'No-show' && l.outcome !== 'Cancelled').map(l => l.min);
    const live = Object.values(S.seats).filter(x => x.start && (x.status === 'busy' || x.status === 'break')).map(x => (now() - x.start) / MIN);
    const all = done.concat(live);
    const avg = all.length ? all.reduce((a, m) => a + m, 0) / all.length : 0;
    return card('Available now', c.free, 'var(--free)') + card('Occupied', c.busy, 'var(--busy)') + card('Awaiting check-in', c.held, 'var(--held)') + card('Sessions today', all.length, null, `<div class="muted" style="font-size:12px;margin-top:4px">Avg ${all.length ? fmtDur(avg) : '-'} so far · ${c.break} on break</div>`);
  }

  function seatClass(id, admin) {
    const st = S.seats[id];
    const u = me();
    let cls = st.status;
    if (u && st.uid === u.id) cls = 'mine';
    if (selected === id) cls += ' sel';
    if (!admin && filters.size && !(SEAT_BY_ID[id].f.some(f => filters.has(f)) && [...filters].every(f => SEAT_BY_ID[id].f.includes(f)))) cls += ' dim';
    return cls;
  }

  function seatLabel(id) {
    const st = S.seats[id], s = SEAT_BY_ID[id];
    const status = { free: 'available', held: 'reserved, waiting for check-in', busy: 'occupied', break: 'occupied, owner on a break', out: 'out of service' }[st.status];
    return `Seat ${id}, ${s.area}, ${status}`;
  }

  function roomSVG() {
    let carrels = '';
    SEATS.filter(s => s.f.includes('carrel')).forEach((s, i, arr) => {
      carrels += `<rect x="${s.x}" y="${s.y - 30}" width="41" height="24" rx="4" fill="#e8ebf2"/>`;
      const prev = arr[i - 1];
      if (prev && prev.row === s.row) carrels += `<line x1="${s.x - 22}" y1="${s.y - 34}" x2="${s.x - 22}" y2="${s.y + 8}" stroke="#d5d9e2" stroke-width="2"/>`;
    });
    let windows = '';
    for (let x = 150; x < 910; x += 95) windows += `<line x1="${x}" y1="30" x2="${x + 80}" y2="30" stroke="#93c5fd" stroke-width="7" stroke-linecap="round"/>`;
    const rowLabel = (r, y) => `<text x="128" y="${y}" font-size="13" font-weight="700" fill="#9aa2b4" text-anchor="middle">${r}</text>`;
    return `<svg class="room" viewBox="0 0 1000 620" aria-hidden="true">
      <rect x="40" y="30" width="920" height="570" rx="16" fill="#fff" stroke="#cfd4de" stroke-width="3"/>
      ${windows}
      <text x="500" y="58" font-size="10" font-weight="700" letter-spacing="2" fill="#93a8c9" text-anchor="middle">WINDOWS</text>
      <rect x="150" y="118" width="758" height="34" rx="6" fill="#e8ebf2"/>
      <text x="529" y="139" font-size="10.5" font-weight="700" letter-spacing="1.5" fill="#97a0b3" text-anchor="middle">STUDY BENCH · POWER STRIP</text>
      ${carrels}
      <text x="529" y="244" font-size="10" font-weight="700" letter-spacing="3" fill="#c3c9d6" text-anchor="middle">WALKWAY</text>
      <rect x="56" y="78" width="40" height="470" rx="6" fill="#f1f2f6" stroke="#e1e4ea"/>
      <text x="80" y="313" font-size="10" font-weight="700" letter-spacing="2" fill="#a3aabb" text-anchor="middle" transform="rotate(-90 80 313)">BOOKSHELVES</text>
      ${rowLabel('A', 95)}${rowLabel('B', 183)}${rowLabel('C', 325)}${rowLabel('D', 415)}${rowLabel('E', 505)}
      <rect x="796" y="462" width="146" height="64" rx="10" fill="#14214d"/>
      <text x="869" y="499" font-size="11" font-weight="700" letter-spacing="1.5" fill="#fff" text-anchor="middle">CONTROL DESK</text>
      <rect x="858" y="594" width="84" height="12" fill="#fbfbfd"/>
      <text x="900" y="586" font-size="10" font-weight="700" letter-spacing="2" fill="#a3aabb" text-anchor="middle">ENTRANCE</text>
    </svg>`;
  }

  function floorHTML(admin) {
    const seats = SEATS.map(s => {
      const st = S.seats[s.id];
      const tag = st.status === 'break' ? `<span class="tag">${Math.max(0, Math.ceil((st.breakAt + BREAK_MIN * MIN - now()) / MIN))}m</span>` : '';
      return `<button class="seat ${seatClass(s.id, admin)}" style="left:${s.x / 10}%;top:${s.y / 6.2}%" data-seat="${s.id}" aria-label="${esc(seatLabel(s.id))}" title="${esc(seatLabel(s.id))}">${s.id.slice(2)}${tag}</button>`;
    }).join('');
    return `<div class="floor-wrap"><div class="floor">${roomSVG()}${seats}</div></div>`;
  }

  function listHTML() {
    const rows = ['A', 'B', 'C', 'D', 'E'];
    return `<div class="seat-list">${rows.map(r => {
      const seats = SEATS.filter(s => s.row === r && S.seats[s.id].status === 'free' && (!filters.size || [...filters].every(f => s.f.includes(f))));
      return `<div><h3>${esc(SEATS.find(s => s.row === r).area)} · ${seats.length} free</h3><div class="grid">${seats.map(s => `<button class="seat-item${selected === s.id ? ' sel' : ''}" data-seat="${s.id}"><b>${s.id}</b><small>${s.f.map(f => FEATURES[f].label).join(' · ')}</small></button>`).join('') || '<span class="muted" style="font-size:13px">No matching seats free right now.</span>'}</div></div>`;
    }).join('')}</div>`;
  }

  function legendHTML() {
    const item = (label, bg, border) => `<span><i style="background:${bg};border-color:${border}"></i>${label}</span>`;
    return `<div class="legend">${item('Available', 'var(--free-bg)', '#86efac')}${item('Reserved', 'var(--held-bg)', '#fcd34d')}${item('Occupied', 'var(--busy-bg)', '#cbd5e1')}${item('On a break', 'var(--break-bg)', '#c4b5fd')}${item('Out of service', '#f3f4f6', '#d1d5db')}${item('Your seat', 'var(--red)', 'var(--red-dark)')}</div>`;
  }

  function featureTags(id) { return `<div class="feature-tags">${SEAT_BY_ID[id].f.map(f => `<span class="ftag">${icon(FEATURES[f].icon)}${FEATURES[f].label}</span>`).join('')}</div>`; }
  const statusBadge = st => `<span class="status-badge ${st}">${{ free: 'Available', held: 'Reserved', busy: 'Occupied', break: 'On a break', out: 'Out of service' }[st]}</span>`;

  function ring(start, end, label, sub) {
    const C = 2 * Math.PI * 56;
    return `<div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="56" fill="none" stroke="#eef0f4" stroke-width="10"/>
      <circle cx="66" cy="66" r="56" fill="none" stroke="var(--red)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" data-ring-start="${start}" data-ring-end="${end}" style="stroke-dashoffset:0"/></svg>
      <div class="label"><div><b data-until="${end}">--:--</b><small>${label}</small>${sub ? `<br><small>${sub}</small>` : ''}</div></div></div>`;
  }

  // ─── Student side panels ──────────────────────────────────────────────────
  function bookingHTML(u) {
    const id = seatOf(u.id); if (!id) return '';
    const st = S.seats[id];
    if (st.status === 'held') {
      return `<section class="card booking"><div class="booking-head"><h3>Seat ${id}</h3>${statusBadge('held')}</div>
        ${ring(st.heldAt, st.heldAt + CHECKIN_MIN * MIN, 'left to check in')}
        <p class="muted" style="text-align:center;margin:0;font-size:13px">${esc(SEAT_BY_ID[id].area)} · ${durLabel(st.dur)} booking</p>
        <div class="actions"><button class="btn primary full" data-act="checkin">${icon('check')} Check in at my seat</button><button class="btn danger full" data-act="end">Cancel reservation</button></div>
        <div class="note">In the library, this is the QR code at your seat or the control desk. If you don't check in within ${CHECKIN_MIN} minutes, the seat is released.</div></section>`;
    }
    if (st.status === 'break') {
      return `<section class="card booking"><div class="booking-head"><h3>Seat ${id}</h3>${statusBadge('break')}</div>
        ${ring(st.breakAt, st.breakAt + BREAK_MIN * MIN, 'break time left')}
        <div class="actions"><button class="btn primary full" data-act="back">I'm back</button></div>
        <div class="note">Your seat is <b>held</b>, and everyone can see you're on a break, so your things won't be moved. After ${BREAK_MIN} minutes the seat is released.</div></section>`;
    }
    const canExtend = st.ext < 1 && st.end - now() <= EXTEND_WINDOW_MIN * MIN;
    return `<section class="card booking"><div class="booking-head"><h3>Seat ${id}</h3>${statusBadge('busy')}</div>
      ${ring(st.start, st.end, 'remaining', 'ends ' + fmtTime(st.end))}
      <div class="actions">
        <button class="btn" data-act="break">${icon('coffee')} Take a break</button>
        <button class="btn" data-act="extend" ${canExtend ? '' : 'disabled'} title="${canExtend ? 'Add one hour' : st.ext ? 'Already extended once' : `Available in the last ${EXTEND_WINDOW_MIN} minutes`}">${icon('clock')} Extend 1h</button>
        <button class="btn danger full" data-act="end">End session</button>
      </div>
      <div class="note">${st.ext ? 'Extended once.' : `You can extend once, in the last ${EXTEND_WINDOW_MIN} minutes.`} Breaks hold your seat for ${BREAK_MIN} minutes.</div></section>`;
  }

  function seatPanelHTML(admin) {
    if (!selected) {
      return `<section class="card empty-panel">${icon('pointer')}<p style="margin:0">${admin ? 'Select a seat to see who is there and change its status.' : 'Tap a green seat on the map to reserve it.'}</p></section>`;
    }
    const id = selected, st = S.seats[id], u = me();
    const seat = SEAT_BY_ID[id];
    const occupant = st.uid && S.users.find(x => x.id === st.uid);
    let body = '';

    if (admin) {
      if (occupant) {
        body += `<dl class="kv"><dt>Student</dt><dd>${esc(occupant.name)}</dd><dt>Number</dt><dd>${esc(occupant.no)}</dd><dt>Department</dt><dd>${esc(occupant.dept || '-')}</dd>
          ${st.status === 'held' ? `<dt>Reserved</dt><dd>${fmtTime(st.heldAt)}</dd><dt>Check-in by</dt><dd>${fmtTime(st.heldAt + CHECKIN_MIN * MIN)}</dd>` : `<dt>Checked in</dt><dd>${fmtTime(st.start)}</dd><dt>Ends</dt><dd>${fmtTime(st.end)}</dd>`}
          ${st.status === 'break' ? `<dt>Break left</dt><dd data-until="${st.breakAt + BREAK_MIN * MIN}">--</dd>` : ''}</dl>
          <div style="display:grid;gap:8px">${st.status === 'busy' ? `<button class="btn" data-act="admin-extend">Extend 30 minutes</button>` : ''}<button class="btn danger" data-act="admin-release">Release seat</button></div>`;
      } else if (st.status === 'out') {
        body += `<p class="muted" style="margin:6px 0 14px">Reason: <b style="color:var(--ink)">${esc(st.reason)}</b></p><button class="btn navy block" data-act="admin-restore">Return to service</button>`;
      } else {
        body += `<label class="field"><span>Mark out of service</span><select class="input" id="out-reason">${OUT_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label><button class="btn block" data-act="admin-out">Mark out of service</button>`;
      }
      return `<section class="card panel"><div class="row"><h3>Seat ${id}</h3><span class="spacer"></span>${statusBadge(st.status)}</div><p class="muted" style="margin:4px 0 0;font-size:13px">${esc(seat.area)}</p>${featureTags(id)}${body}</section>`;
    }

    if (u && st.uid === u.id) {
      body = `<p class="muted" style="margin:0">This is your seat. Manage it in the card above.</p>`;
    } else if (st.status === 'free') {
      const mine = u && seatOf(u.id);
      body = `<div class="section-title" style="margin-bottom:0">How long?</div>
        <div class="dur" role="group" aria-label="Duration">${DURATIONS.map(d => `<button data-dur="${d}" class="${duration === d ? 'on' : ''}" aria-pressed="${duration === d}">${durLabel(d)}</button>`).join('')}</div>
        ${u ? (mine ? `<button class="btn primary block" disabled>Reserve seat</button><p class="muted" style="font-size:12.5px;margin:8px 0 0">You already have seat ${mine}.</p>`
          : `<button class="btn primary block" data-act="reserve">Reserve ${id} for ${durLabel(duration)}</button><p class="muted" style="font-size:12.5px;margin:8px 0 0">Your details are saved, so that's it. Check in within ${CHECKIN_MIN} minutes.</p>`)
          : `<a class="btn primary block" href="#/">Sign in to reserve</a>`}`;
    } else if (st.status === 'busy') {
      body = `<p style="margin:0">Occupied until about <b>${fmtTime(st.end)}</b>.</p>`;
    } else if (st.status === 'break') {
      body = `<p style="margin:0">The student is on a break and back within <b data-until="${st.breakAt + BREAK_MIN * MIN}">--</b>. Please leave their things where they are.</p>`;
    } else if (st.status === 'held') {
      body = `<p style="margin:0">Reserved. If the student doesn't check in by <b>${fmtTime(st.heldAt + CHECKIN_MIN * MIN)}</b>, it becomes available.</p>`;
    } else {
      body = `<p style="margin:0">Out of service: ${esc(st.reason)}.</p>`;
    }
    return `<section class="card panel"><div class="row"><h3>Seat ${id}</h3><span class="spacer"></span>${statusBadge(st.status)}</div><p class="muted" style="margin:4px 0 0;font-size:13px">${esc(seat.area)}</p>${featureTags(id)}${body}</section>`;
  }

  function policyHTML() {
    const p = (ic, t) => `<div>${icon(ic)}<span>${t}</span></div>`;
    return `<section class="card panel"><div class="section-title">CLIR seat policy</div><div class="policy">
      ${p('clock', 'Book up to 2 hours, and extend once by 1 hour near the end.')}
      ${p('check', `Check in within ${CHECKIN_MIN} minutes or the seat is released.`)}
      ${p('coffee', `Breaks hold your seat for ${BREAK_MIN} minutes, and the map shows you're coming back.`)}
      ${p('seat', 'Sit only at the seat you booked. One booking per student.')}
    </div></section>`;
  }

  function sideHTML(admin) {
    const u = me();
    if (admin) return seatPanelHTML(true) + activityHTML();
    return (u ? bookingHTML(u) : '') + seatPanelHTML(false) + policyHTML();
  }

  function activityHTML() {
    const recent = S.logs.slice(-6).reverse();
    return `<section class="card panel"><div class="section-title">Recent activity</div>${recent.map(l => `<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #eef0f4;font-size:13px">
      <span class="avatar" style="width:28px;height:28px;font-size:11px;background:var(--navy-2)">${esc(initials(l.name))}</span>
      <span style="flex:1;min-width:0"><b>${esc(l.name)}</b> · ${l.seat}<br><span class="muted">${fmtTime(l.end)} · ${fmtDur(l.min)}</span></span>${outcomePill(l.outcome)}</div>`).join('')}
      <a href="#/admin/logs" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600">View all logs</a></section>`;
  }

  // ─── Views ────────────────────────────────────────────────────────────────
  function authView() {
    const c = counts();
    const li = t => `<li>${icon('check')}<span>${t}</span></li>`;
    return `<main class="page"><div class="auth">
      <section class="hero">
        <span class="live-pill"><span class="live-dot"></span>Live · Individual Study Zone</span>
        <h1>Find a seat at CLIR <em>before</em> you get there.</h1>
        <p>See which seats are free right now, then book one in two taps. No more filling out a form every visit.</p>
        <div class="hero-stat"><b data-live="free">${c.free}</b><span>of ${TOTAL} seats free right now</span></div>
        <div class="mini-bar"><i data-live="bar" style="width:${Math.round(c.free / TOTAL * 100)}%"></i></div>
        <ul>${li('Live seat map with outlets, window seats, and quiet areas')}${li('Your details are saved, so booking takes seconds')}${li('Break and check-in timers everyone can see')}</ul>
        <a href="#/map" style="color:#fff;font-weight:600;position:relative;z-index:1">Browse the live map without an account →</a>
      </section>
      <section class="card auth-card">
        <div class="tabs" role="tablist"><button class="tab ${authTab === 'signin' ? 'on' : ''}" data-tab="signin" role="tab" aria-selected="${authTab === 'signin'}">Sign in</button><button class="tab ${authTab === 'signup' ? 'on' : ''}" data-tab="signup" role="tab" aria-selected="${authTab === 'signup'}">Create account</button></div>
        ${authTab === 'signin' ? `<form id="signin-form" novalidate>
            <label class="field"><span>Student number</span><input class="input" name="no" autocomplete="username" placeholder="2022-10001" required></label>
            <label class="field"><span>Password</span><input class="input" name="pass" type="password" autocomplete="current-password" required></label>
            <div class="form-error" id="auth-error"></div>
            <button class="btn primary block" type="submit">Sign in</button>
          </form>`
        : `<form id="signup-form" novalidate>
            <div class="grid2"><label class="field"><span>Student number</span><input class="input" name="no" placeholder="2024-12345" required></label>
            <label class="field"><span>Year level</span><select class="input" name="year">${[1, 2, 3, 4, 5].map(y => `<option>${y}</option>`).join('')}</select></label></div>
            <label class="field"><span>Full name</span><input class="input" name="name" autocomplete="name" placeholder="Juan dela Cruz" required></label>
            <div class="grid2"><label class="field"><span>Department</span><select class="input" name="dept">${DEPTS.map(d => `<option>${d}</option>`).join('')}</select></label>
            <label class="field"><span>Program</span><input class="input" name="program" placeholder="BS Information Technology"></label></div>
            <div class="grid2"><label class="field"><span>Password</span><input class="input" name="pass" type="password" autocomplete="new-password" required></label>
            <label class="field"><span>Confirm password</span><input class="input" name="confirm" type="password" autocomplete="new-password" required></label></div>
            <div class="form-error" id="auth-error"></div>
            <button class="btn primary block" type="submit">Create account</button>
          </form>`}
        <div class="divider">or try the demo</div>
        <div class="demo-btns"><button class="btn" data-act="demo-student">${icon('seat')} Student</button><button class="btn navy" data-act="demo-librarian">${icon('shield')} Librarian</button></div>
        <p class="muted" style="font-size:12.5px;margin:14px 0 0">Tip: open the librarian demo in a second tab. Bookings show up there instantly.</p>
      </section>
    </div></main>`;
  }

  function mapPage() {
    const chip = f => `<button class="chip ${filters.has(f) ? 'on' : ''}" data-filter="${f}" aria-pressed="${filters.has(f)}">${icon(FEATURES[f].icon)}${FEATURES[f].label}</button>`;
    return `<main class="page"><div id="stats" class="stats">${statsHTML(false)}</div>
      <div class="map-layout">
        <section class="card map-card">
          <div class="map-head"><div><h2>Individual Study Zone</h2><p class="muted" style="margin:2px 0 0;font-size:13px">Einstein Building, 2nd floor · updates live</p></div>
            <div class="view-toggle" role="group" aria-label="View"><button data-view="map" class="${mapView === 'map' ? 'on' : ''}">Map</button><button data-view="list" class="${mapView === 'list' ? 'on' : ''}">List</button></div></div>
          <div class="chips" style="margin-bottom:12px" aria-label="Filter seats by need">${Object.keys(FEATURES).map(chip).join('')}</div>
          <div id="floor">${mapView === 'map' ? floorHTML(false) + legendHTML() : listHTML()}</div>
        </section>
        <aside class="side" id="side">${sideHTML(false)}</aside>
      </div></main>`;
  }

  function adminPage() {
    return `<main class="page">${adminTabs()}
      <div id="stats" class="stats">${statsHTML(true)}</div>
      <div class="map-layout">
        <section class="card map-card">
          <div class="map-head"><div><h2>Live floor</h2><p class="muted" style="margin:2px 0 0;font-size:13px">Select a seat to release it, extend it, or take it out of service.</p></div>
            <button class="btn danger sm" data-act="clear-all">Clear all reservations</button></div>
          <div id="floor">${floorHTML(true)}${legendHTML()}</div>
          <div class="card tools-card"><div class="section-title" style="color:#92400e">Demo tools</div><div class="tools">
            <button class="btn sm" data-act="ff">Fast-forward 15 minutes</button>
            <button class="btn sm" data-act="rush">Simulate rush hour</button>
            <button class="btn sm" data-act="pause">${S.paused ? 'Resume' : 'Pause'} simulated students</button>
            <button class="btn sm danger" data-act="reset">Reset demo data</button></div></div>
        </section>
        <aside class="side" id="side">${sideHTML(true)}</aside>
      </div></main>`;
  }

  function adminTabs() {
    const t = (href, label) => `<a href="${href}" class="${route === href.slice(1) ? 'on' : ''}">${label}</a>`;
    return `<nav class="admin-tabs" aria-label="Librarian">${t('#/admin', 'Live floor')}${t('#/admin/logs', 'User logs')}${t('#/admin/reports', 'Reports')}</nav>`;
  }

  // Logs
  function outcomePill(o) {
    const cls = { Completed: 'ok', 'Time up': 'info', 'No-show': 'bad', 'Break exceeded': 'warn', 'Released by staff': 'warn', Cleared: 'info', Cancelled: 'info', 'In progress': 'live' }[o] || 'info';
    return `<span class="pill ${cls}">${esc(o)}</span>`;
  }

  function filteredLogs() {
    const live = Object.keys(S.seats).filter(id => S.seats[id].uid && S.seats[id].status !== 'held').map(id => {
      const st = S.seats[id], u = S.users.find(x => x.id === st.uid);
      return { id: 'live-' + id, no: u.no, name: u.name, dept: u.dept || '', seat: id, start: st.start, end: null, min: (now() - st.start) / MIN, outcome: 'In progress' };
    });
    const since = logQuery.range === 'all' ? 0 : startOfDay(now()) - (Number(logQuery.range) - 1) * 24 * 60 * MIN;
    const q = logQuery.q.trim().toLowerCase();
    return live.concat(S.logs.slice().reverse()).filter(l =>
      (l.end == null || l.end >= since) && (!logQuery.dept || l.dept === logQuery.dept) && (!logQuery.outcome || l.outcome === logQuery.outcome) &&
      (!q || l.name.toLowerCase().includes(q) || l.no.toLowerCase().includes(q) || l.seat.toLowerCase().includes(q)));
  }

  function logRowsHTML() {
    const rows = filteredLogs();
    const shown = rows.slice(0, 250);
    return `<div class="muted" style="font-size:13px;margin-bottom:8px">${rows.length} record${rows.length === 1 ? '' : 's'}${rows.length > shown.length ? ` · showing the latest ${shown.length}` : ''}</div>
      <div class="card table-wrap"><table><thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Duration</th><th>Student no.</th><th>Name</th><th>Dept</th><th>Seat</th><th>Outcome</th></tr></thead><tbody>
      ${shown.map(l => `<tr><td>${fmtDate(l.start)}</td><td>${fmtTime(l.start)}</td><td>${l.end ? fmtTime(l.end) : '-'}</td><td>${l.outcome === 'No-show' ? '-' : fmtDur(l.min)}</td><td>${esc(l.no)}</td><td>${esc(l.name)}</td><td>${esc(l.dept)}</td><td>${l.seat}</td><td>${outcomePill(l.outcome)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No records match these filters.</td></tr>'}
      </tbody></table></div>`;
  }

  function logsView() {
    const outcomes = ['Completed', 'Time up', 'No-show', 'Break exceeded', 'Released by staff', 'Cancelled', 'Cleared', 'In progress'];
    return `<main class="page">${adminTabs()}
      <div class="toolbar">
        <input class="input" id="log-q" type="search" placeholder="Search name, student number, or seat" value="${esc(logQuery.q)}" aria-label="Search logs">
        <select class="input" id="log-dept" aria-label="Department" style="flex:0 1 160px"><option value="">All departments</option>${DEPTS.map(d => `<option ${logQuery.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <select class="input" id="log-outcome" aria-label="Outcome" style="flex:0 1 170px"><option value="">All outcomes</option>${outcomes.map(o => `<option ${logQuery.outcome === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <select class="input" id="log-range" aria-label="Date range" style="flex:0 1 150px">${[['1', 'Today'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['all', 'All time']].map(([v, l]) => `<option value="${v}" ${logQuery.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn navy" data-act="export">Export CSV</button>
      </div>
      <div id="log-body">${logRowsHTML()}</div></main>`;
  }

  // Reports
  function columnChart(values, labels, color, unit) {
    const w = 600, h = 220, pad = 28, bw = (w - pad * 2) / values.length, max = Math.max(1, ...values);
    const bars = values.map((v, i) => {
      const bh = (v / max) * (h - 60), x = pad + i * bw + bw * 0.15, y = h - 30 - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${color}"><title>${labels[i]}: ${v}${unit || ''}</title></rect>
        <text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="11" text-anchor="middle" fill="#5f6675">${v}</text>
        <text x="${(x + bw * 0.35).toFixed(1)}" y="${h - 12}" font-size="11" text-anchor="middle" fill="#5f6675">${labels[i]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img"><line x1="${pad}" y1="${h - 30}" x2="${w - pad}" y2="${h - 30}" stroke="#e4e6ec"/>${bars}</svg>`;
  }
  function hbars(items, fmt) {
    const max = Math.max(1, ...items.map(i => i[1]));
    return items.map(([label, v]) => `<div class="hbar"><span>${esc(label)}</span><div class="track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div><b>${fmt ? fmt(v) : v}</b></div>`).join('');
  }

  function reportsView() {
    const since = startOfDay(now()) - reportRange * 24 * 60 * MIN;
    const logs = S.logs.filter(l => l.start >= since);
    const used = logs.filter(l => l.outcome !== 'No-show' && l.outcome !== 'Cancelled');
    const noShow = logs.filter(l => l.outcome === 'No-show').length;
    const avg = used.length ? used.reduce((a, l) => a + l.min, 0) / used.length : 0;
    const unique = new Set(logs.map(l => l.no)).size;

    const hours = Array.from({ length: 12 }, (_, i) => 8 + i);
    const byHour = hours.map(h => used.filter(l => new Date(l.start).getHours() === h).length);
    const hourLabels = hours.map(h => (h % 12 || 12) + (h < 12 ? 'a' : 'p'));

    const days = []; for (let d = reportRange; d >= 1; d--) days.push(startOfDay(now()) - d * 24 * 60 * MIN);
    const byDay = days.map(d => used.filter(l => l.start >= d && l.start < d + 24 * 60 * MIN).length);
    const dayLabels = days.map(d => new Date(d).toLocaleDateString('en-US', { weekday: 'narrow' }));

    const byDept = DEPTS.map(d => [d, used.filter(l => l.dept === d).length]).sort((a, b) => b[1] - a[1]);
    const seatCount = {}; used.forEach(l => { seatCount[l.seat] = (seatCount[l.seat] || 0) + 1; });
    const topSeats = Object.entries(seatCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const outcomes = ['Completed', 'Time up', 'Break exceeded', 'No-show'].map(o => [o, logs.filter(l => l.outcome === o).length]);
    const busiest = hourLabels[byHour.indexOf(Math.max(...byHour))];
    const card = (label, val, sub) => `<div class="card stat"><small>${label}</small><b>${val}</b><div class="muted" style="font-size:12px;margin-top:2px">${sub}</div></div>`;

    return `<main class="page">${adminTabs()}
      <div class="toolbar"><h2 style="font-size:20px;margin-right:auto">Seat utilization report</h2>
        <select class="input" id="report-range" style="flex:0 1 160px" aria-label="Report range">${[[7, 'Last 7 days'], [14, 'Last 14 days']].map(([v, l]) => `<option value="${v}" ${reportRange === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn navy" data-act="export-report">Export CSV</button></div>
      <div class="stats">${card('Sessions', used.length, `${unique} students`)}${card('Average stay', fmtDur(avg), 'per session')}${card('No-show rate', (logs.length ? Math.round(noShow / logs.length * 100) : 0) + '%', `${noShow} released after ${CHECKIN_MIN} min`)}${card('Busiest hour', busiest, 'most check-ins')}</div>
      <div class="charts">
        <section class="card card-pad chart"><h3>Check-ins by hour</h3><p>When students arrive. Plan staffing around the peaks.</p>${columnChart(byHour, hourLabels, '#1e2f6b')}</section>
        <section class="card card-pad chart"><h3>Sessions per day</h3><p>Daily use over the period. The library is closed on Sundays.</p>${columnChart(byDay, dayLabels, '#e4202b')}</section>
        <section class="card card-pad chart"><h3>Usage by department</h3><p>Which colleges rely on the study zone most.</p>${hbars(byDept)}</section>
        <section class="card card-pad chart"><h3>Most booked seats</h3><p>Popular seats tend to have outlets or window views.</p>${hbars(topSeats)}</section>
        <section class="card card-pad chart"><h3>How sessions ended</h3><p>No-shows free up seats automatically after ${CHECKIN_MIN} minutes.</p>${hbars(outcomes)}</section>
        <section class="card card-pad chart"><h3>About this data</h3><p style="margin:0">The reports are built from the session logs, which replace the manual Excel sheets. The history here is sample data generated for the demo, and today's numbers update as students book seats.</p></section>
      </div></main>`;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────
  function guard() {
    const u = me();
    if (route.startsWith('/admin') && (!u || u.role !== 'librarian')) { location.hash = u ? '#/map' : '#/'; return false; }
    if ((route === '/' || route === '') && u) { location.hash = u.role === 'librarian' ? '#/admin' : '#/map'; return false; }
    return true;
  }

  function render() {
    route = (location.hash || '#/').slice(1) || '/';
    if (!guard()) return;
    let view;
    if (route === '/map') view = mapPage();
    else if (route === '/admin') view = adminPage();
    else if (route === '/admin/logs') view = logsView();
    else if (route === '/admin/reports') view = reportsView();
    else view = authView();
    app.innerHTML = header() + view + footer();
    updateTimers();
  }

  /** Redraw only the live parts, so open forms and inputs keep their state. */
  function refresh() {
    const admin = route === '/admin';
    const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
    if (route === '/map' || admin) {
      set('#stats', statsHTML(admin));
      set('#floor', admin ? floorHTML(true) + legendHTML() : (mapView === 'map' ? floorHTML(false) + legendHTML() : listHTML()));
      if (!$('#side') || !$('#side').contains(document.activeElement) || document.activeElement.tagName !== 'SELECT') set('#side', sideHTML(admin));
    }
    if (route === '/admin/logs') set('#log-body', logRowsHTML());
    const c = counts();
    document.querySelectorAll('[data-live="free"]').forEach(el => { el.textContent = c.free; });
    document.querySelectorAll('[data-live="bar"]').forEach(el => { el.style.width = Math.round(c.free / TOTAL * 100) + '%'; });
    updateTimers();
  }

  function updateTimers() {
    const t = now();
    document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtClock(Number(el.dataset.until) - t); });
    document.querySelectorAll('[data-ring-start]').forEach(el => {
      const a = Number(el.dataset.ringStart), b = Number(el.dataset.ringEnd), C = 2 * Math.PI * 56;
      const frac = Math.min(1, Math.max(0, (t - a) / (b - a)));
      el.style.strokeDashoffset = (C * frac).toFixed(1);
    });
  }

  // ─── Events ───────────────────────────────────────────────────────────────
  app.addEventListener('click', e => {
    const seatBtn = e.target.closest('[data-seat]');
    if (seatBtn) { selected = seatBtn.dataset.seat === selected ? null : seatBtn.dataset.seat; refresh(); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { const k = f.dataset.filter; filters.has(k) ? filters.delete(k) : filters.add(k); render(); return; }
    const v = e.target.closest('[data-view]');
    if (v) { mapView = v.dataset.view; render(); return; }
    const d = e.target.closest('[data-dur]');
    if (d) { duration = Number(d.dataset.dur); refresh(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { authTab = tab.dataset.tab; render(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    switch (act) {
      case 'signout': setSession(null); selected = null; toast('Signed out.'); location.hash = '#/'; render(); break;
      case 'demo-student': setSession('u-demo'); toast('Signed in as Alex Rivera, a demo student.'); location.hash = '#/map'; break;
      case 'demo-librarian': setSession('u-librarian'); toast('Signed in as a librarian.'); location.hash = '#/admin'; break;
      case 'reserve': reserve(selected, duration); break;
      case 'checkin': checkIn(); break;
      case 'break': takeBreak(); break;
      case 'back': backFromBreak(); break;
      case 'extend': extend(); break;
      case 'end': endMine(); break;
      case 'admin-release':
        confirmDialog(`Release seat ${selected}?`, 'The student will be signed out and the seat opened for others.', 'Release seat', () => { mutate(s => endSeat(s, selected, 'Released by staff')); toast(`Seat ${selected} released.`); });
        break;
      case 'admin-extend': mutate(s => { s.seats[selected].end += 30 * MIN; }); toast(`Seat ${selected} extended by 30 minutes.`); break;
      case 'admin-out': { const reason = ($('#out-reason') || {}).value || OUT_REASONS[0]; mutate(s => { s.seats[selected] = { status: 'out', reason }; }); toast(`Seat ${selected} marked out of service.`); break; }
      case 'admin-restore': mutate(s => { s.seats[selected] = { status: 'free' }; }); toast(`Seat ${selected} is back in service.`); break;
      case 'clear-all':
        confirmDialog('Clear all reservations?', 'Every reserved and occupied seat will be released and logged. Use this at closing time.', 'Clear all', () => {
          const n = mutate(s => { let k = 0; Object.keys(s.seats).forEach(id => { if (s.seats[id].uid) { endSeat(s, id, 'Cleared'); k++; } }); return k; });
          toast(`Cleared ${n} seat${n === 1 ? '' : 's'}.`);
        });
        break;
      case 'ff': mutate(s => { s.offset += 15 * MIN; }); engineTick(); toast('Jumped ahead 15 minutes.'); break;
      case 'rush': mutate(s => { s.rushUntil = now() + 20 * MIN; s.paused = false; }); toast('Rush hour: students are arriving.'); break;
      case 'pause': mutate(s => { s.paused = !s.paused; }); render(); toast(S.paused ? 'Simulated students paused.' : 'Simulated students resumed.'); break;
      case 'reset':
        confirmDialog('Reset the demo?', 'This restores the sample data and removes accounts created in this browser.', 'Reset', () => { S = seed(); save(); selected = null; render(); toast('Demo data reset.'); });
        break;
      case 'export': downloadCSV(`clir-seat-logs-${new Date(now()).toISOString().slice(0, 10)}.csv`, [['Date', 'Time in', 'Time out', 'Minutes', 'Student no.', 'Name', 'Department', 'Seat', 'Outcome']].concat(filteredLogs().map(l => [fmtDate(l.start), fmtTime(l.start), l.end ? fmtTime(l.end) : '', Math.round(l.min), l.no, l.name, l.dept, l.seat, l.outcome]))); break;
      case 'export-report': {
        const since = startOfDay(now()) - reportRange * 24 * 60 * MIN;
        const rows = [['Seat', 'Area', 'Sessions', 'Total minutes', 'No-shows']].concat(SEATS.map(s => {
          const l = S.logs.filter(x => x.seat === s.id && x.start >= since);
          return [s.id, s.area, l.filter(x => x.outcome !== 'No-show').length, l.reduce((a, x) => a + x.min, 0), l.filter(x => x.outcome === 'No-show').length];
        }));
        downloadCSV(`clir-seat-utilization-${new Date(now()).toISOString().slice(0, 10)}.csv`, rows); break;
      }
    }
  });

  app.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target, data = Object.fromEntries(new FormData(form));
    const err = msg => { const el = $('#auth-error'); if (el) el.textContent = msg; };
    if (form.id === 'signin-form') {
      const no = (data.no || '').trim(), pass = data.pass || '';
      if (!no || !pass) return err('Enter your student number and password.');
      S = load() || S;
      const u = S.users.find(x => x.no.toLowerCase() === no.toLowerCase() && !x.sim);
      const demoPass = { 'u-demo': 'demo1234', 'u-librarian': 'clir2025' };
      const ok = u && (u.pass ? u.pass === await hash(pass) : demoPass[u.id] === pass);
      if (!ok) return err('That student number and password don’t match.');
      setSession(u.id);
      toast(`Welcome back, ${u.name.split(' ')[0]}.`);
      location.hash = u.role === 'librarian' ? '#/admin' : '#/map';
    }
    if (form.id === 'signup-form') {
      const no = (data.no || '').trim(), name = (data.name || '').trim();
      if (!/^\d{4}-\d{5}$/.test(no)) return err('Use the student number format 2024-12345.');
      if (name.length < 3) return err('Enter your full name.');
      if ((data.pass || '').length < 6) return err('Use a password with at least 6 characters.');
      if (data.pass !== data.confirm) return err('The passwords don’t match.');
      S = load() || S;
      if (S.users.some(u => u.no === no)) return err('That student number already has an account. Sign in instead.');
      const user = { id: 'u-' + Date.now().toString(36), no, name, dept: data.dept, program: (data.program || '').trim(), year: data.year, role: 'student', pass: await hash(data.pass) };
      mutate(s => { s.users.push(user); });
      setSession(user.id);
      toast('Account created. Your details are saved, so booking takes two taps.');
      location.hash = '#/map';
    }
  });

  app.addEventListener('input', e => {
    if (e.target.id === 'log-q') { logQuery.q = e.target.value; $('#log-body').innerHTML = logRowsHTML(); }
  });
  app.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'log-dept') logQuery.dept = e.target.value;
    else if (id === 'log-outcome') logQuery.outcome = e.target.value;
    else if (id === 'log-range') logQuery.range = e.target.value;
    else if (id === 'report-range') { reportRange = Number(e.target.value); render(); return; }
    else return;
    $('#log-body').innerHTML = logRowsHTML();
  });

  function downloadCSV(name, rows) {
    const csv = rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV downloaded.');
  }

  // Other tabs changed the shared state
  window.addEventListener('storage', e => {
    if (e.key !== STORE_KEY) return;
    const latest = load(); if (!latest) return;
    S = latest;
    if (!me() && session()) setSession(null);
    refresh();
  });
  window.addEventListener('hashchange', () => { selected = null; render(); });

  // ─── Start ────────────────────────────────────────────────────────────────
  S = load();
  if (!S) { S = seed(); save(); }
  // Portfolio links can open straight into a demo role: ?as=student or ?as=librarian
  const as = new URLSearchParams(location.search).get('as');
  if (as && !session()) {
    const keep = location.hash && location.hash !== '#/';
    if (as === 'student') { setSession('u-demo'); if (!keep) location.hash = '#/map'; }
    if (as === 'librarian') { setSession('u-librarian'); if (!keep) location.hash = '#/admin'; }
  }
  render();
  setInterval(() => { engineTick(); updateTimers(); }, 1000);

  // Test hooks for automated checks
  window.__clir = { state: () => S, seats: SEATS, tick: engineTick, now };
})();
