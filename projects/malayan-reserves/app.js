/* Malayan Reserves web demo.
 * A browser port of the Android app: the same rules (data/Rules.kt), the same reservation lifecycle
 * and simulated drivers (data/LocalRepository.kt), and the same screens (ui/*.kt).
 * Everything is stored in localStorage. */
(() => {
'use strict';

// ---------- rules (Rules.kt) ----------
const EMAIL_DOMAIN = '@live.mcl.edu.ph';
const ARRIVAL_WINDOW_MIN = 20, MIN_HOURS = 1, MAX_HOURS = 4, EXTEND_MIN = 60, DAYS_AHEAD = 7, STEP_MIN = 30;
const OPEN_HOUR = 6, CLOSE_HOUR = 22;
const MIN = 60000, DAY = 24 * 60 * MIN;
const TYPES = ['Sedan', 'SUV', 'Hatchback', 'Coupe', 'Pickup', 'Van'];
const COLORS = ['White', 'Black', 'Silver', 'Gray', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Brown'];
const CAR_HEX = { White: '#F3F4F6', Black: '#1F2328', Silver: '#B8BEC8', Gray: '#7A808A', Red: '#C8352E', Blue: '#2D63D8',
  Green: '#2F8A55', Yellow: '#F2C230', Orange: '#E5772A', Brown: '#7B5236' };
const USER_TYPES = { STUDENT: 'Student', FACULTY: 'Faculty', EMPLOYEE: 'Employee' };
const NOTES = ['Faculty and staff priority, nearest the gate', 'Near the gate', 'Middle of the lot', 'Covered parking'];
const SLOTS = Array.from({ length: 12 }, (_, i) => {
  const row = Math.floor(i / 3);
  return { id: 'P' + String(i + 1).padStart(2, '0'), row, staffOnly: row === 0, note: NOTES[row] };
});
const TEAM = ['Johann Lijauco', 'Mikhail David', 'Zei Ramirez', 'Austine Ang', 'Angelo Ebrada'];
const LIVE = ['UPCOMING', 'HELD', 'ACTIVE'];

const isStaff = (type) => type !== 'STUDENT';
const slotById = (id) => SLOTS.find((s) => s.id === id);
const validEmail = (e) => { e = e.trim().toLowerCase(); return e.endsWith(EMAIL_DOMAIN) && /^[a-z0-9._%+-]+$/.test(e.slice(0, -EMAIL_DOMAIN.length)); };
const normPlate = (p) => p.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/^([A-Z]{2,3})(\d)/, '$1 $2').trim();
const validPlate = (p) => /^[A-Z]{2,3} \d{3,5}$/.test(normPlate(p));
const maskPlate = (p) => { const parts = normPlate(p).split(' '); if (parts.length !== 2) return '•••'; const d = parts[1]; return parts[0] + ' ' + '•'.repeat(Math.max(1, d.length - 2)) + d.slice(-2); };
const strength = (pw) => pw.length >= 10 && /\d/.test(pw) && /[A-Z]/.test(pw) ? 3 : pw.length >= 8 && /\d/.test(pw) ? 2 : pw.length >= 6 ? 1 : 0;
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const roundUp = (t, step = STEP_MIN) => Math.ceil(t / (step * MIN)) * step * MIN;
const withinHours = (s, e) => { const d = startOfDay(s); return s >= d + OPEN_HOUR * 60 * MIN && e <= d + CLOSE_HOUR * 60 * MIN; };
function availableStarts(dayStart, durMin, bookings, now) {
  const out = [];
  const last = dayStart + CLOSE_HOUR * 60 * MIN - durMin * MIN;
  for (let t = Math.max(dayStart + OPEN_HOUR * 60 * MIN, roundUp(now + 5 * MIN)); t <= last; t += STEP_MIN * MIN) {
    if (!bookings.some((b) => overlaps(t, t + durMin * MIN, b.start, b.end))) out.push(t);
  }
  return out;
}

// ---------- formatting ----------
const fmtTime = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
function fmtDay(t, now) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
const chipDay = (t, now) => { const d = fmtDay(t, now); return d === 'Today' || d === 'Tomorrow' ? d : `${new Date(t).toLocaleDateString('en-US', { weekday: 'short' })} ${new Date(t).getDate()}`; };
const whenLabel = (s, e, now) => `${fmtDay(s, now)}, ${fmtRange(s, e)}`;
function span(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m` : `${s}s`;
}
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
const hours = (min) => min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h ${min % 60}m`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---------- storage ----------
const KEY = 'malayan-reserves-demo-v1';
let db;
const now = () => Date.now() + (db ? db.offset : 0);
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && d.v === 1) return d; } } catch (e) {}
  return null;
}

/* Demo-only password hashing so passwords aren't stored as typed. (The Android app uses PBKDF2 and the server uses bcrypt.) */
function hashPw(pw, salt) {
  let h = 0x811c9dc5;
  const s = salt + ':' + pw;
  for (let r = 0; r < 500; r++) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
const randSalt = () => Math.random().toString(36).slice(2, 10);

function addUser(name, email, pw, type, vehicle, sim) {
  const salt = randSalt();
  const u = { id: db.nextId++, name, email, type, vehicle: { ...vehicle, plate: normPlate(vehicle.plate) }, salt, pw: sim ? '!' : hashPw(pw, salt), sim };
  db.users.push(u);
  return u;
}
function addRes(userId, slot, start, minutes, status, extra = {}) {
  const r = { id: db.nextId++, slot, user: userId, start, end: start + minutes * MIN, status, arrivedAt: null, endedAt: null, extended: false, ...extra };
  db.res.push(r);
  return r;
}

function seed() {
  const t = Date.now();
  db = { v: 1, offset: 0, nextId: 1, users: [], res: [], session: null, lastSim: 0 };
  const demo = addUser('Demo Driver', 'demo' + EMAIL_DOMAIN, 'demo1234', 'STUDENT', { type: 'Sedan', color: 'Blue', plate: 'NBC 1234' }, false);
  const drivers = [
    ['Carla M.', 'FACULTY', 'SUV', 'White', 'NDA 4821'], ['Paolo R.', 'STUDENT', 'Hatchback', 'Red', 'WQX 902'],
    ['Bea S.', 'STUDENT', 'Sedan', 'Silver', 'AAB 7315'], ['Engr. Tan', 'FACULTY', 'Pickup', 'Black', 'NFE 6640'],
    ['Miguel D.', 'STUDENT', 'Sedan', 'Gray', 'DCA 2297'], ['Rina L.', 'EMPLOYEE', 'Van', 'White', 'NHG 5108'],
    ['Jules A.', 'STUDENT', 'Hatchback', 'Yellow', 'ZTR 481'], ['Ms. Cruz', 'EMPLOYEE', 'Sedan', 'Black', 'NAQ 3390'],
    ['Kyle B.', 'STUDENT', 'SUV', 'Green', 'BKL 7724'], ['Andrea V.', 'STUDENT', 'Sedan', 'Orange', 'VRA 1185'],
    ['Sir Ramos', 'FACULTY', 'SUV', 'Brown', 'NJB 6052'],
  ].map(([n, ty, vt, vc, pl], i) => addUser(n, `driver${i + 1}${EMAIL_DOMAIN}`, '', ty, { type: vt, color: vc, plate: pl }, true));
  const base = roundUp(t);
  const act = (d, slot, ago, minutes) => addRes(drivers[d].id, slot, t - ago * MIN, minutes, 'ACTIVE', { arrivedAt: t - ago * MIN });
  act(0, 'P01', 70, 180); act(3, 'P02', 40, 150); act(1, 'P05', 25, 120); act(2, 'P07', 95, 150); act(4, 'P08', 10, 90); act(5, 'P11', 50, 240);
  const up = (d, slot, start, minutes) => { if (withinHours(start, start + minutes * MIN)) addRes(drivers[d].id, slot, start, minutes, 'UPCOMING'); };
  up(6, 'P04', base + 60 * MIN, 120); up(7, 'P09', base + 30 * MIN, 180); up(8, 'P06', base + 150 * MIN, 90);
  up(10, 'P03', startOfDay(addDays(t, 1)) + 9 * 60 * MIN, 120);
  [['P06', 1, 'COMPLETED'], ['P10', 2, 'COMPLETED'], ['P12', 3, 'CANCELLED']].forEach(([slot, daysAgo, status]) => {
    const s = startOfDay(addDays(t, -daysAgo)) + (8 * 60 + 30) * MIN;
    addRes(demo.id, slot, s, 120, status, status === 'COMPLETED' ? { arrivedAt: s + 5 * MIN, endedAt: s + 110 * MIN } : { endedAt: s - 60 * MIN });
  });
  save();
}

// ---------- repository (LocalRepository.kt) ----------
class AppError extends Error {}
const fail = (m) => { throw new AppError(m); };
const user = (id) => db.users.find((u) => u.id === id);
const me = () => (db.session ? user(db.session) : null);
const live = () => db.res.filter((r) => LIVE.includes(r.status)).sort((a, b) => a.start - b.start);
const mine = () => { const u = me(); return u ? live().find((r) => r.user === u.id) || null : null; };
const conflict = (slot, s, e, except) => live().some((r) => r.slot === slot && r.id !== except && overlaps(s, e, r.start, r.end));

/** Moves reservations along as time passes: start → held → no-show, parked → completed. */
function refresh(t) {
  for (const r of db.res) {
    let changed = true;
    while (changed) {
      changed = false;
      if (r.status === 'UPCOMING' && r.start <= t) { r.status = 'HELD'; changed = true; }
      else if (r.status === 'HELD' && user(r.user).sim && r.start + 3 * MIN <= t) { r.status = 'ACTIVE'; r.arrivedAt = r.start + 3 * MIN; changed = true; }
      else if (r.status === 'HELD' && r.start + ARRIVAL_WINDOW_MIN * MIN <= t) { r.status = 'NO_SHOW'; r.endedAt = r.start + ARRIVAL_WINDOW_MIN * MIN; changed = true; }
      else if (r.status === 'ACTIVE' && r.end <= t) { r.status = 'COMPLETED'; r.endedAt = r.end; changed = true; }
    }
  }
}

/** Keeps roughly half the lot busy and a few bookings ahead, with simulated drivers. */
function simulate(t, force) {
  if (!force && Date.now() - db.lastSim < 20000) return;
  db.lastSim = Date.now();
  for (let round = 0; round < (force ? 3 : 1); round++) {
    const L = live();
    const busy = new Set(L.map((r) => r.user));
    const idle = db.users.filter((u) => u.sim && !busy.has(u.id)).sort(() => Math.random() - 0.5);
    const parked = L.filter((r) => r.start <= t).length;
    const ahead = L.filter((r) => r.start > t).length;
    let i = 0;
    if (parked < 6 && idle[i] && (force || Math.random() < 0.34)) {
      const u = idle[i++], minutes = (2 + Math.floor(Math.random() * 5)) * 30;
      const slot = freeSlotFor(u, t, t + minutes * MIN);
      if (slot) addRes(u.id, slot, t - 4 * MIN, minutes, 'ACTIVE', { arrivedAt: t - 4 * MIN });
    }
    if (ahead < 4 && idle[i]) {
      const u = idle[i], start = roundUp(t) + (1 + Math.floor(Math.random() * 10)) * 30 * MIN, minutes = (2 + Math.floor(Math.random() * 5)) * 30;
      if (withinHours(start, start + minutes * MIN)) {
        const slot = freeSlotFor(u, start, start + minutes * MIN);
        if (slot) addRes(u.id, slot, start, minutes, 'UPCOMING');
      }
    }
  }
}
function freeSlotFor(u, s, e) {
  const options = SLOTS.filter((x) => isStaff(u.type) || !x.staffOnly).sort(() => Math.random() - 0.5);
  const hit = options.find((x) => !conflict(x.id, s, e));
  return hit ? hit.id : null;
}

function lot() {
  const t = now();
  refresh(t); simulate(t);
  const u = me(), L = live();
  const slots = SLOTS.map((slot) => {
    const rs = L.filter((r) => r.slot === slot.id);
    const cur = rs.find((r) => r.start <= t && (r.status === 'HELD' || r.status === 'ACTIVE'));
    let state = 'AVAILABLE';
    if (cur) state = cur.user === u.id ? 'MINE' : cur.status === 'ACTIVE' ? 'OCCUPIED' : 'HELD';
    let vehicle = null;
    if (cur && (cur.status === 'ACTIVE' || cur.user === u.id)) {
      const v = user(cur.user).vehicle;
      vehicle = cur.user === u.id ? v : { ...v, plate: maskPlate(v.plate) };
    }
    const next = rs.find((r) => r.start > t);
    return { slot, state, vehicle, until: cur ? cur.end : null, nextStart: next ? next.start : null,
      bookings: rs.map((r) => ({ start: r.start, end: r.end, mine: r.user === u.id })) };
  });
  save();
  return { slots, free: slots.filter((s) => s.state === 'AVAILABLE').length };
}

function register(reg) {
  const email = reg.email.trim().toLowerCase(), plate = normPlate(reg.vehicle.plate);
  if (reg.name.trim().length < 2) fail('Enter your full name.');
  if (!validEmail(email)) fail(`Use your school email ending in ${EMAIL_DOMAIN}.`);
  if (reg.password.length < 8) fail('Use a password with at least 8 characters.');
  if (!TYPES.includes(reg.vehicle.type)) fail('Choose your vehicle type.');
  if (!COLORS.includes(reg.vehicle.color)) fail('Choose your vehicle color.');
  if (!validPlate(plate)) fail('Enter a plate number like ABC 1234.');
  if (db.users.some((u) => u.email === email)) fail('An account with this email already exists.');
  if (db.users.some((u) => u.vehicle.plate === plate)) fail('This plate number is already registered.');
  const u = addUser(reg.name.trim(), email, reg.password, reg.type, { ...reg.vehicle, plate }, false);
  db.session = u.id; save();
  return u;
}
function login(email, pw) {
  const u = db.users.find((x) => !x.sim && x.email === email.trim().toLowerCase());
  if (!u || hashPw(pw, u.salt) !== u.pw) fail('Incorrect email or password.');
  db.session = u.id; save();
  return u;
}
function updateVehicle(v) {
  const u = me(), plate = normPlate(v.plate);
  if (!validPlate(plate)) fail('Enter a plate number like ABC 1234.');
  if (db.users.some((x) => x.id !== u.id && x.vehicle.plate === plate)) fail('This plate number is already registered.');
  u.vehicle = { type: v.type, color: v.color, plate }; save();
  return u;
}
function reserve(slotId, start, durMin) {
  const t = now();
  refresh(t);
  const u = me(), slot = slotById(slotId);
  if (!slot) fail("That parking slot doesn't exist.");
  if (slot.staffOnly && !isStaff(u.type)) fail(`${slot.id} is reserved for faculty and staff.`);
  if (durMin < MIN_HOURS * 60 || durMin > MAX_HOURS * 60 || durMin % STEP_MIN) fail(`Choose a duration between ${MIN_HOURS} and ${MAX_HOURS} hours.`);
  const parkNow = start <= t + MIN, begin = parkNow ? t : start, end = begin + durMin * MIN;
  if (!parkNow) {
    if (begin % (STEP_MIN * MIN)) fail('Start times are on the hour or half hour.');
    if (begin > t + DAYS_AHEAD * DAY) fail(`You can book up to ${DAYS_AHEAD} days ahead.`);
    if (!withinHours(begin, end)) fail('Advance bookings run from 6 AM to 10 PM.');
  }
  if (mine()) fail('You already have a reservation. Finish or cancel it first.');
  if (conflict(slot.id, begin, end)) fail(`${slot.id} is already booked for part of that time.`);
  const r = addRes(u.id, slot.id, begin, durMin, parkNow ? 'HELD' : 'UPCOMING');
  save();
  return r;
}
function arrive() {
  const t = now(); refresh(t);
  const r = mine() || fail("You don't have a reservation.");
  if (r.status === 'ACTIVE') fail("You're already checked in.");
  if (r.status === 'UPCOMING') {
    if (r.start - t > 15 * MIN) fail('You can check in up to 15 minutes before your start time.');
    if (conflict(r.slot, t, r.start, r.id)) fail(`${r.slot} is still in use. Please wait until your start time.`);
    r.start = t;
  }
  r.status = 'ACTIVE'; r.arrivedAt = t; save();
  return r;
}
function extend() {
  refresh(now());
  const r = mine() || fail("You don't have a reservation.");
  if (r.extended) fail('A reservation can only be extended once.');
  if (conflict(r.slot, r.end, r.end + EXTEND_MIN * MIN, r.id)) fail(`Someone has booked ${r.slot} right after you, so it can't be extended.`);
  r.end += EXTEND_MIN * MIN; r.extended = true; save();
  return r;
}
function end() {
  const t = now(); refresh(t);
  const r = mine() || fail("You don't have a reservation.");
  r.status = r.status === 'ACTIVE' ? 'COMPLETED' : 'CANCELLED'; r.endedAt = t; save();
  return r;
}
const history = () => { const u = me(); return db.res.filter((r) => r.user === u.id && !LIVE.includes(r.status)).sort((a, b) => b.start - a.start).slice(0, 20); };

// ---------- drawing ----------
function carSvg(color, down = false) {
  const c = CAR_HEX[color] || '#9AA1AD';
  return `<svg viewBox="0 0 40 74" aria-hidden="true"><g ${down ? 'transform="rotate(180 20 37)"' : ''}>
    <rect x="2.4" y="3" width="36.8" height="71" rx="12" fill="rgba(0,0,0,.25)"/>
    <rect x="-1" y="11.8" width="5.6" height="10.4" rx="2" fill="#1B1F27"/><rect x="35.4" y="11.8" width="5.6" height="10.4" rx="2" fill="#1B1F27"/>
    <rect x="-1" y="53" width="5.6" height="10.4" rx="2" fill="#1B1F27"/><rect x="35.4" y="53" width="5.6" height="10.4" rx="2" fill="#1B1F27"/>
    <rect x="0" y="0" width="40" height="73" rx="12" fill="${c}"/>
    <rect x="5.6" y="16" width="28.8" height="11.7" rx="5.6" fill="#233142"/>
    <rect x="6.4" y="29.2" width="27.2" height="20.4" rx="4.8" fill="${c}" style="filter:brightness(.85)"/>
    <rect x="7.2" y="51" width="25.6" height="8.8" rx="4.8" fill="#233142"/>
    <rect x="4.8" y="1.5" width="8" height="3.6" rx="1.8" fill="#FFF3B0"/><rect x="27.2" y="1.5" width="8" height="3.6" rx="1.8" fill="#FFF3B0"/>
    <rect x="4" y="68" width="8" height="3.3" rx="1.6" fill="#E0453A"/><rect x="28" y="68" width="8" height="3.3" rx="1.6" fill="#E0453A"/>
  </g></svg>`;
}
const ICON = {
  lot: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>',
  mine: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
};

// ---------- UI state ----------
const ui = {
  page: 'welcome', tab: 'lot',
  login: { email: '', pw: '' },
  reg: { name: '', email: '', pw: '', confirm: '', type: 'STUDENT', vType: null, vColor: null, plate: '', tried: false },
  sheet: null, dialog: null, busy: false,
};
const $ = (s, el = document) => el.querySelector(s);
const appEl = $('#app'), sheetEl = $('#sheet'), scrimEl = $('#scrim'), dialogEl = $('#dialog'), snackEl = $('#snack');

/** Replaces an element's HTML while keeping scroll positions ([data-keep]) and keyboard focus. */
const sig = (b) => [b.dataset.act, b.dataset.id, b.dataset.tab, b.dataset.v, b.dataset.page].join('|');
function paint(el, html) {
  const keep = { __self: el.scrollTop };
  el.querySelectorAll('[data-keep]').forEach((k) => { keep[k.dataset.keep] = [k.scrollTop, k.scrollLeft]; });
  const active = document.activeElement;
  const focusSig = active && el.contains(active) && active.dataset && active.dataset.act ? sig(active) : null;
  el.innerHTML = html;
  el.scrollTop = keep.__self;
  el.querySelectorAll('[data-keep]').forEach((k) => { const v = keep[k.dataset.keep]; if (v) { k.scrollTop = v[0]; k.scrollLeft = v[1]; } });
  if (focusSig) { const again = [...el.querySelectorAll('[data-act]')].find((b) => sig(b) === focusSig); if (again) again.focus({ preventScroll: true }); }
}

let snackTimer;
function snack(msg) {
  snackEl.textContent = msg;
  snackEl.classList.toggle('low', ui.page !== 'app');
  snackEl.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => snackEl.classList.remove('show'), 3200);
}

function attempt(fn) {
  try { return fn(); } catch (e) { if (e instanceof AppError) { snack(e.message); return undefined; } throw e; }
}

// ---------- screens ----------
function render() {
  $('#statusbar').classList.toggle('dark', ui.page === 'welcome');
  if (ui.page === 'welcome') return paint(appEl, viewWelcome());
  if (ui.page === 'login') return paint(appEl, viewLogin());
  if (ui.page === 'reg1') { paint(appEl, viewReg1()); return updateReg1(); }
  if (ui.page === 'reg2') { paint(appEl, viewReg2()); return updateVehicleBits(appEl, ui.reg); }
  renderMain();
}

function viewWelcome() {
  return `<div class="welcome">
    <div class="grow"></div>
    <img class="logo" src="logo.jpg" alt="Malayan Reserves logo">
    <h2>Malayan Reserves</h2>
    <p>Reserve a campus parking slot before you arrive, and skip the circling.</p>
    <div class="tags"><span>12 slots</span><span>Live map</span><span>Book 7 days ahead</span></div>
    <div class="grow"></div>
    <button class="btn yellow" data-act="page" data-page="login">Sign in</button>
    <button class="btn ghost" data-act="page" data-page="reg1">Create an account</button>
    <button class="demo" data-act="demo">Explore with the demo account</button>
    <p class="fine">Demo mode: everything is stored in this browser, with simulated drivers.</p>
  </div>`;
}

const field = (id, label, value, type = 'text', extra = '') => `<div class="field" data-f="${id}">
  <input id="f-${id}" type="${type}" placeholder=" " value="${esc(value)}" autocomplete="off" spellcheck="false" ${extra}>
  <label for="f-${id}">${label}</label>${type === 'password' ? `<button class="eye" type="button" data-act="eye" data-for="f-${id}" aria-label="Show password">👁</button>` : ''}
  <div class="help"></div></div>`;

function viewLogin() {
  return `<div class="form">
    <button class="back-btn" data-act="page" data-page="welcome" aria-label="Back">←</button>
    <h2>Welcome back</h2><p class="sub">Sign in with your school email.</p>
    ${field('lemail', 'School email', ui.login.email, 'email')}
    ${field('lpw', 'Password', ui.login.pw, 'password')}
    <button class="btn" data-act="login" style="margin-top:12px">Sign in</button>
    <button class="link" data-act="page" data-page="reg1">New here? Create an account</button>
    <p class="muted small" style="text-align:center">Tip: the demo account is demo${EMAIL_DOMAIN} / demo1234</p>
  </div>`;
}

function viewReg1() {
  const r = ui.reg;
  return `<div class="form">
    <button class="back-btn" data-act="page" data-page="welcome" aria-label="Back">←</button>
    <h2>Create your account</h2><p class="sub">Step 1 of 2 · About you</p>
    <div class="progress"><i style="width:50%"></i></div>
    ${field('name', 'Full name', r.name, 'text', 'maxlength="60"')}
    ${field('email', 'School email', r.email, 'email')}
    ${field('pw', 'Password', r.pw, 'password')}
    <div class="meter" id="meter"></div>
    ${field('confirm', 'Confirm password', r.confirm, 'password')}
    <div class="label">I am a</div>
    <div class="chips">${Object.entries(USER_TYPES).map(([k, v]) => `<button class="chip ${r.type === k ? 'on' : ''}" data-act="utype" data-v="${k}">${v}</button>`).join('')}</div>
    <p class="muted small" style="margin:8px 0 0">${isStaff(r.type) ? 'Faculty and employees can also use the priority slots P01–P03.' : 'Students can use slots P04–P12.'}</p>
    <button class="btn" data-act="reg-next" style="margin-top:18px">Continue</button>
    <p class="err-text" id="reg1-err"></p>
    <button class="link" data-act="page" data-page="login">Already registered? Sign in</button>
  </div>`;
}

function updateReg1() {
  const r = ui.reg;
  const set = (id, err, help = '') => {
    const f = appEl.querySelector(`[data-f="${id}"]`); if (!f) return;
    f.classList.toggle('err', !!err); f.querySelector('.help').textContent = err || help;
  };
  set('name', r.tried && r.name.trim().length < 2 ? 'Enter your full name.' : '');
  set('email', r.email && !validEmail(r.email) ? `Use your school email ending in ${EMAIL_DOMAIN}.` : r.tried && !r.email ? 'Enter your school email.' : '');
  set('pw', r.pw && r.pw.length < 8 ? 'At least 8 characters.' : '');
  set('confirm', r.confirm && r.confirm !== r.pw ? "Passwords don't match." : '');
  const s = strength(r.pw), meter = $('#meter');
  if (meter) {
    const [label, col] = s <= 1 ? ['Weak', 'var(--red)'] : s === 2 ? ['Good', 'var(--amber)'] : ['Strong', 'var(--green)'];
    meter.innerHTML = r.pw ? [0, 1, 2].map((i) => `<i style="${i < Math.max(1, s) ? 'background:' + col : ''}"></i>`).join('') + `<span style="color:${col}">${label}</span>` : '';
  }
  const err = $('#reg1-err');
  if (err) err.textContent = r.tried && !reg1Ok() ? 'Fill in every field to continue.' : '';
}
const reg1Ok = () => { const r = ui.reg; return r.name.trim().length >= 2 && validEmail(r.email) && r.pw.length >= 8 && r.confirm === r.pw; };

function vehicleForm(d) {
  return `<div class="label" style="margin-top:4px">Vehicle type</div>
    <div class="chips">${TYPES.map((t) => `<button class="chip ${d.vType === t ? 'on' : ''}" data-act="vtype" data-v="${t}">${t}</button>`).join('')}</div>
    <div class="label">Color${d.vColor ? ' · ' + d.vColor : ''}</div>
    <div class="swatches">${COLORS.map((c) => `<button class="swatch ${d.vColor === c ? 'on' : ''}" data-act="vcolor" data-v="${c}" aria-label="${c}" style="background:${CAR_HEX[c]};${['White', 'Silver', 'Yellow'].includes(c) ? 'color:var(--navy)' : ''}">${d.vColor === c ? '✓' : ''}</button>`).join('')}</div>
    <div style="height:16px"></div>
    ${field('plate', 'Plate number', d.plate, 'text', 'maxlength="9" style="text-transform:uppercase"')}
    <div class="car-preview" id="car-preview"></div>`;
}
function updateVehicleBits(root, d) {
  const f = root.querySelector('[data-f="plate"]');
  if (f) {
    const bad = d.plate.trim() && !validPlate(d.plate);
    f.classList.toggle('err', !!bad);
    f.querySelector('.help').textContent = bad ? 'Use the format ABC 1234.' : 'Other drivers only see the last two digits.';
  }
  const p = root.querySelector('#car-preview');
  if (p) p.innerHTML = d.vType && d.vColor ? `${carSvg(d.vColor)}<div><b>${d.vColor} ${d.vType}</b><div class="muted small">${esc(normPlate(d.plate)) || 'No plate yet'}</div></div>` : '';
  const btn = root.querySelector('[data-vsubmit]');
  if (btn) btn.disabled = !(d.vType && d.vColor && validPlate(d.plate));
}

function viewReg2() {
  return `<div class="form">
    <button class="back-btn" data-act="page" data-page="reg1" aria-label="Back">←</button>
    <h2>Your vehicle</h2><p class="sub">Step 2 of 2 · So guards can match your car to your slot</p>
    <div class="progress"><i style="width:100%"></i></div>
    ${vehicleForm(ui.reg)}
    <button class="btn" data-act="register" data-vsubmit style="margin-top:16px">Create account</button>
  </div>`;
}

function renderMain() {
  const u = me();
  if (!u) { ui.page = 'welcome'; return render(); }
  const L = lot(), r = mine(), t = now();
  let body = '';
  if (ui.tab === 'lot') body = viewLot(u, L, r, t);
  else if (ui.tab === 'mine') body = viewMine(r, t);
  else body = viewProfile(u);
  const navItem = (k, label) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span class="ic">${ICON[k]}</span>${label}</button>`;
  paint(appEl, `<div class="view" data-keep="view-${ui.tab}">${body}</div>
    <nav class="nav">${navItem('lot', 'Lot')}${navItem('mine', r && r.status === 'ACTIVE' ? 'Parked' : 'My parking')}${navItem('profile', 'Profile')}</nav>`);
}

function viewLot(u, L, r, t) {
  const occ = L.slots.filter((s) => s.state === 'OCCUPIED' || s.state === 'MINE').length, held = L.slots.filter((s) => s.state === 'HELD').length;
  const byRow = (row) => L.slots.filter((s) => s.slot.row === row);
  const stall = (sv, down) => {
    const locked = sv.slot.staffOnly && !isStaff(u.type);
    const cls = ['stall', sv.slot.staffOnly ? 'staff' : '', locked && sv.state === 'AVAILABLE' ? 'locked' : '',
      sv.state === 'AVAILABLE' && !locked ? 'free' : '', sv.state === 'HELD' ? 'held' : '', sv.state === 'MINE' ? 'mine' : ''].join(' ');
    const label = sv.state === 'AVAILABLE' ? (locked ? 'staff only' : 'available') : sv.state === 'HELD' ? 'held' : sv.state === 'MINE' ? 'your slot' : 'occupied';
    const state = sv.vehicle ? '' : sv.state === 'AVAILABLE' ? (locked ? '🔒<br>STAFF' : 'FREE') : sv.state === 'HELD' ? 'HELD' : '';
    return `<button class="${cls}" data-act="slot" data-id="${sv.slot.id}" aria-label="Slot ${sv.slot.id}, ${label}">
      <span class="fill"></span>${sv.vehicle ? carSvg(sv.vehicle.color, down) : ''}
      ${state ? `<span class="state" style="text-align:center">${state}</span>` : ''}
      <span class="num">${sv.state === 'MINE' ? `<span>${sv.slot.id} · YOU</span>` : sv.slot.id}</span></button>`;
  };
  const row = (n, down) => `<div class="srow ${down ? 'down' : 'up'}">${byRow(n).map((s) => stall(s, down)).join('')}</div>`;
  let banner = '';
  if (r) {
    const sub = r.status === 'ACTIVE' ? `Parked until ${fmtTime(r.end)}` : r.status === 'HELD' ? `Held for you. Arrive by ${fmtTime(r.start + ARRIVAL_WINDOW_MIN * MIN)}` : whenLabel(r.start, r.end, t);
    banner = `<button class="banner" data-act="tab" data-tab="mine"><span class="p">P</span><span><b>Your slot ${r.slot}</b><small>${sub}</small></span><span class="arr">›</span></button>`;
  }
  return `<p class="hello">Hi, ${esc(u.name.split(' ')[0])}</p><h1 class="h-title">Campus parking</h1>
    <div class="stats">
      <div class="stat" style="background:var(--green-soft);color:var(--green)"><b>${L.free}</b><span>free</span></div>
      <div class="stat" style="background:var(--blue-soft);color:var(--navy)"><b>${occ}</b><span>parked</span></div>
      <div class="stat" style="background:var(--amber-soft);color:var(--amber)"><b>${held}</b><span>held</span></div>
    </div>
    ${banner}
    <div class="lot">
      <div class="gate">▼ ENTRANCE <span class="hz"></span><span class="guard">GUARD</span></div>
      ${row(0, true)}<div class="aisle"><i>›</i><i>›</i></div>${row(1, false)}
      <div class="island"><i></i></div>
      ${row(2, true)}<div class="aisle"><i>›</i><i>›</i></div>
      <div class="covered">COVERED PARKING</div>${row(3, false)}
    </div>
    <div class="legend"><span><i style="background:var(--green)"></i>Free</span><span><i style="background:var(--yellow)"></i>Held</span><span><i style="background:var(--muted)"></i>Parked</span><span><i style="background:var(--blue)"></i>Yours</span><span><i style="background:#E8C766"></i>Staff</span></div>
    <p class="muted small" style="margin:8px 0 0">Tap a slot to park now or book up to ${DAYS_AHEAD} days ahead. The map refreshes every 10 seconds.</p>`;
}

function viewMine(r, t) {
  let top;
  if (!r) {
    top = `<div class="card" style="margin-top:12px"><div class="empty-ic">🚗</div>
      <b style="display:block;color:var(--navy);font-size:16px;margin-top:4px">No reservation yet</b>
      <p class="muted" style="margin:2px 0 12px">Pick a free slot on the map to park now, or book one for later in the week.</p>
      <button class="btn small" data-act="tab" data-tab="lot">Find a slot</button></div>`;
  } else {
    const arriveBy = r.start + ARRIVAL_WINDOW_MIN * MIN;
    const [label, sub] = r.status === 'UPCOMING' ? ['Upcoming', `Starts in ${span(r.start - t)}`] : r.status === 'HELD' ? ['Held for you', `Arrive by ${fmtTime(arriveBy)}`] : ['Parked', `Until ${fmtTime(r.end)}`];
    let middle;
    if (r.status === 'HELD') {
      const left = arriveBy - t;
      middle = `<div class="cd"><span>Time to arrive</span><b style="color:var(--yellow)">${clock(left)}</b></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, left / (ARRIVAL_WINDOW_MIN * MIN) * 100))}%;background:var(--yellow)"></i></div>`;
    } else if (r.status === 'ACTIVE') {
      const left = r.end - t;
      middle = `<div class="cd"><span>Time left</span><b style="color:#7FE3A8">${clock(left)}</b></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, left / (r.end - r.start) * 100))}%;background:#7FE3A8"></i></div>
        ${left > 0 && left <= 15 * MIN ? '<p class="small" style="color:var(--yellow);margin:6px 0 0">Your time is almost up. Extend or move your car.</p>' : ''}`;
    } else {
      middle = '<p class="small" style="opacity:.75;margin:0">You can check in up to 15 minutes early.</p>';
    }
    let actions;
    if (r.status === 'ACTIVE') {
      actions = `<div class="actions two"><button class="btn yellow white-dis" data-act="extend" ${r.extended ? 'disabled' : ''}>${r.extended ? 'Extended' : 'Extend +1h'}</button><button class="btn ghost" data-act="ask-end">Leave slot</button></div>`;
    } else {
      const can = r.status === 'HELD' || r.start - t <= 15 * MIN;
      actions = `<div class="actions"><button class="btn yellow white-dis" data-act="arrive" ${can ? '' : 'disabled'}>${can ? "I've parked" : `Check-in opens at ${fmtTime(r.start - 15 * MIN)}`}</button><button class="btn ghost" data-act="ask-end">Cancel reservation</button></div>`;
    }
    top = `<div class="res"><div class="rtop"><span class="pill" style="background:var(--yellow);color:var(--navy)">${label}</span><span class="when">${sub}</span></div>
      <div class="big"><b>${r.slot}</b><div><span style="font-weight:600">${fmtDay(r.start, t)}</span><small>${fmtRange(r.start, r.end)}</small></div></div>
      ${middle}${actions}</div>`;
  }
  const hist = history();
  const histHtml = hist.length ? `<div class="card">${hist.map((h) => {
    const [lab, fg, bg] = h.status === 'COMPLETED' ? ['Completed', 'var(--green)', 'var(--green-soft)'] : h.status === 'NO_SHOW' ? ['No-show', 'var(--red)', 'var(--red-soft)'] : ['Cancelled', 'var(--muted)', '#EEF1F6'];
    return `<div class="hist"><span class="slot">${h.slot}</span><div class="grow"><b>${fmtDay(h.start, t)}</b><span class="muted small">${fmtRange(h.start, h.status === 'COMPLETED' && h.endedAt ? h.endedAt : h.end)}</span></div><span class="pill" style="color:${fg};background:${bg}">${lab}</span></div>`;
  }).join('')}</div>` : '<p class="muted">Your past reservations will show up here.</p>';
  return `<h1 class="h-title">My parking</h1>${top}
    <div class="card" style="margin-top:16px"><div class="label" style="margin-top:0">How it works</div>
      <div class="rule"><i>⏱</i>Arrive within ${ARRIVAL_WINDOW_MIN} minutes of your start time and tap “I've parked”, or the slot goes back to the pool.</div>
      <div class="rule"><i>◷</i>Stay ${MIN_HOURS}–${MAX_HOURS} hours. You can extend once by an hour if nobody has booked after you.</div>
      <div class="rule"><i>✓</i>One reservation at a time, up to ${DAYS_AHEAD} days ahead.</div></div>
    <div class="label">History</div>${histHtml}`;
}

function viewProfile(u) {
  return `<h1 class="h-title">Profile</h1>
    <div class="card" style="margin-top:12px"><div class="prof"><span class="avatar">${esc(initials(u.name))}</span>
      <div class="grow"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div><span class="pill" style="background:var(--blue-soft);color:var(--blue)">${USER_TYPES[u.type]}</span></div>
      ${isStaff(u.type) ? '<p class="muted small" style="margin:10px 0 0">You can use the faculty and staff slots P01–P03.</p>' : ''}</div>
    <div class="label">Vehicle</div>
    <div class="card"><div class="veh">${carSvg(u.vehicle.color)}<div class="grow"><b>${u.vehicle.color} ${u.vehicle.type}</b><div class="muted">${esc(u.vehicle.plate)}</div></div>
      <button class="edit" data-act="edit-vehicle">✎ Edit</button></div></div>
    <div class="label">About</div>
    <div class="card"><b>Demo mode</b><p class="muted small" style="margin:2px 0 12px">Accounts and reservations are saved in this browser. Other drivers on the map are simulated.</p>
      <b>Made by</b><p class="muted small" style="margin:2px 0 10px">${TEAM.join(' · ')}</p>
      <p class="muted small" style="margin:0">A student project concept. Not an official Mapúa Malayan Colleges Laguna service.</p></div>
    <button class="signout" data-act="logout">⇥ Sign out</button>`;
}

// ---------- sheets ----------
function openSheet(s) { ui.sheet = s; scrimEl.hidden = false; sheetEl.hidden = false; renderSheet(); sheetEl.scrollTop = 0; }
function closeSheet() { ui.sheet = null; scrimEl.hidden = true; sheetEl.hidden = true; sheetEl.innerHTML = ''; }

function renderSheet() {
  const s = ui.sheet;
  if (!s) return;
  if (s.kind === 'vehicle') {
    paint(sheetEl, `<div class="grab"></div><b style="font-size:19px;color:var(--navy)">Edit vehicle</b><div style="height:12px"></div>
      ${vehicleForm(s)}<button class="btn" data-act="save-vehicle" data-vsubmit>Save vehicle</button>`);
    return updateVehicleBits(sheetEl, s);
  }
  const u = me(), t = now(), L = lot();
  const sv = L.slots.find((x) => x.slot.id === s.slot);
  const locked = sv.slot.staffOnly && !isStaff(u.type), r = mine(), freeNow = sv.state === 'AVAILABLE';
  const durations = [1, 2, 3, 4].map((h) => h * 60);
  const nowDur = durations.filter((d) => !sv.bookings.some((b) => overlaps(t, t + d * MIN, b.start, b.end)));
  const canNow = freeNow && nowDur.length > 0;
  if (s.mode == null) s.mode = canNow ? 'now' : 'later';
  if (s.mode === 'now' && !canNow) s.mode = 'later';
  if (s.mode === 'now' && !nowDur.includes(s.dur)) s.dur = [...nowDur].reverse().find((d) => d <= 120) || nowDur[0];
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(startOfDay(t), i));
  if (!days.includes(s.day)) s.day = days[0];
  const starts = availableStarts(s.day, s.dur, sv.bookings, t);
  if (!starts.includes(s.start)) s.start = starts.find((x) => x >= s.day + 8 * 60 * MIN) || starts[0] || 0;

  let pill;
  if (sv.state === 'AVAILABLE') pill = sv.nextStart && sv.nextStart - t < 3 * 60 * MIN ? `Free until ${fmtTime(sv.nextStart)}` : 'Free';
  const pillHtml = sv.state === 'AVAILABLE' ? `<span class="pill" style="background:var(--green-soft);color:var(--green)">${pill}</span>`
    : sv.state === 'HELD' ? '<span class="pill" style="background:var(--amber-soft);color:var(--amber)">Held</span>'
    : sv.state === 'MINE' ? '<span class="pill" style="background:var(--blue-soft);color:var(--blue)">Yours</span>'
    : '<span class="pill" style="background:#EEF1F6;color:var(--muted)">Occupied</span>';
  let html = `<div class="grab"></div><div class="head"><span class="badge">${sv.slot.id}</span><div class="grow"><b>Slot ${sv.slot.id}</b><small>${sv.slot.note}</small></div>${pillHtml}</div>`;
  if (sv.vehicle) html += `<div class="occupant">${carSvg(sv.vehicle.color)}<span><b style="font-weight:500">${sv.vehicle.color} ${sv.vehicle.type}</b> · ${esc(sv.vehicle.plate)}</span>${sv.until ? `<span class="until">until ${fmtTime(sv.until)}</span>` : ''}</div>`;

  if (locked) {
    html += `<div class="notice"><i>🔒</i><div><b>Faculty and staff only</b><small>Slots P01–P03 are kept for faculty and employees. Students can book any slot from P04 to P12.</small></div></div>`;
  } else if (r) {
    html += `<div class="notice"><i>P</i><div><b>You already have a reservation</b><small>One reservation at a time keeps the lot fair. Finish or cancel ${r.slot} first.</small></div></div>`;
  } else {
    const later = s.mode === 'later';
    html += `<div class="seg"><button data-act="mode" data-v="now" class="${!later ? 'on' : ''}" ${canNow ? '' : 'disabled'}>Park now</button><button data-act="mode" data-v="later" class="${later ? 'on' : ''}">Book later</button></div>`;
    if (!canNow) html += `<p class="muted small" style="margin:8px 0 0">${!freeNow ? 'This slot is in use right now. You can still book it for later.' : 'Someone has booked this slot within the hour. Book a later time instead.'}</p>`;
    if (later) html += `<div class="label">Day</div><div class="chips scroll" data-keep="days">${days.map((d) => `<button class="chip ${d === s.day ? 'on' : ''}" data-act="day" data-v="${d}">${chipDay(d, t)}</button>`).join('')}</div>`;
    html += `<div class="label">How long</div><div class="chips">${durations.map((d) => `<button class="chip ${d === s.dur ? 'on' : ''}" data-act="dur" data-v="${d}" ${later || nowDur.includes(d) ? '' : 'disabled'}>${hours(d)}</button>`).join('')}</div>`;
    if (later) {
      html += `<div class="label">Start time</div>` + (starts.length
        ? `<div class="chips scroll" data-keep="times">${starts.map((x) => `<button class="chip ${x === s.start ? 'on' : ''}" data-act="start" data-v="${x}">${fmtTime(x)}</button>`).join('')}</div>`
        : `<p class="muted small" style="margin:0">No ${hours(s.dur)} openings left on this day. Try a shorter time or another day.</p>`);
      html += '<p class="muted small" style="margin:6px 0 0">Advance bookings run from 6 AM to 10 PM.</p>';
    }
    const selStart = later ? s.start : t, selEnd = selStart + s.dur * MIN, dayStart = later ? s.day : startOfDay(t);
    html += `<div class="label">${fmtDay(dayStart, t)} on ${sv.slot.id}</div>` + timeline(dayStart, sv.bookings, t, later && !s.start ? null : [selStart, selEnd]);
    const ready = later ? !!s.start : canNow;
    html += `<button class="btn" data-act="reserve" ${ready ? '' : 'disabled'}>${!ready ? 'Choose a time' : later ? `Book ${sv.slot.id} · ${fmtRange(selStart, selEnd)}` : `Hold ${sv.slot.id} until ${fmtTime(selEnd)}`}</button>
      <p class="muted small" style="margin:8px 0 0">${later ? `Check in within ${ARRIVAL_WINDOW_MIN} minutes of your start time, or the slot is released.` : `The slot is held for ${ARRIVAL_WINDOW_MIN} minutes. Tap “I've parked” when you arrive.`}</p>`;
  }
  paint(sheetEl, html);
  if (s.scrollToStart) {
    s.scrollToStart = false;
    const on = sheetEl.querySelector('[data-keep="times"] .chip.on');
    if (on) on.parentElement.scrollLeft = on.offsetLeft - on.parentElement.offsetLeft - 60;
  }
}

function timeline(dayStart, bookings, t, sel) {
  const pct = (x) => Math.max(0, Math.min(100, (x - dayStart) / DAY * 100));
  let h = '<div class="timeline">';
  for (let i = 1; i < 24; i++) h += `<span class="hr" style="left:${i / 24 * 100}%;${i % 6 === 0 ? 'background:rgba(0,0,0,.15)' : ''}"></span>`;
  if (t > dayStart) h += `<span class="past" style="width:${pct(t)}%"></span>`;
  bookings.filter((b) => b.end > dayStart && b.start < dayStart + DAY).forEach((b) => { h += `<span class="bk ${b.mine ? 'mine' : ''}" style="left:${pct(b.start)}%;width:${pct(b.end) - pct(b.start)}%"></span>`; });
  if (sel) h += `<span class="sel" style="left:${pct(sel[0])}%;width:${pct(sel[1]) - pct(sel[0])}%"></span>`;
  if (t >= dayStart && t < dayStart + DAY) h += `<span class="now" style="left:${pct(t)}%"></span>`;
  return h + '</div><div class="ticks"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>'
    + '<div class="legend" style="margin-top:4px"><span><i style="background:#9AA1AD"></i>Booked</span><span><i style="background:var(--blue)"></i>Your pick</span><span><i style="background:var(--red)"></i>Now</span></div>';
}

function openDialog(title, text, confirmLabel, onConfirm) {
  ui.dialog = onConfirm;
  scrimEl.hidden = false; dialogEl.hidden = false;
  dialogEl.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button data-act="dlg-no">Keep it</button><button class="danger" data-act="dlg-yes">${esc(confirmLabel)}</button></div>`;
}
function closeDialog() { ui.dialog = null; dialogEl.hidden = true; if (!ui.sheet) scrimEl.hidden = true; }

// ---------- events ----------
function signedIn() { ui.page = 'app'; ui.tab = 'lot'; render(); }

function onAction(btn) {
  const act = btn.dataset.act, v = btn.dataset.v;
  const s = ui.sheet;
  switch (act) {
    case 'page': ui.page = btn.dataset.page; if (ui.page === 'reg1') ui.reg.tried = false; render(); appEl.firstElementChild && (appEl.firstElementChild.scrollTop = 0); break;
    case 'demo': db.session = db.users.find((u) => u.email === 'demo' + EMAIL_DOMAIN).id; save(); signedIn(); break;
    case 'eye': { const inp = document.getElementById(btn.dataset.for); inp.type = inp.type === 'password' ? 'text' : 'password'; break; }
    case 'login': if (attempt(() => login(ui.login.email, ui.login.pw))) { ui.login = { email: '', pw: '' }; signedIn(); } break;
    case 'utype': ui.reg.type = v; render(); break;
    case 'reg-next': ui.reg.tried = true; if (reg1Ok()) { ui.page = 'reg2'; render(); } else updateReg1(); break;
    case 'vtype': (s && s.kind === 'vehicle' ? s : ui.reg).vType = v; s && s.kind === 'vehicle' ? renderSheet() : render(); break;
    case 'vcolor': (s && s.kind === 'vehicle' ? s : ui.reg).vColor = v; s && s.kind === 'vehicle' ? renderSheet() : render(); break;
    case 'register': {
      const r = ui.reg;
      const u = attempt(() => register({ name: r.name, email: r.email, password: r.pw, type: r.type, vehicle: { type: r.vType, color: r.vColor, plate: r.plate } }));
      if (u) { ui.reg = { name: '', email: '', pw: '', confirm: '', type: 'STUDENT', vType: null, vColor: null, plate: '', tried: false }; signedIn(); snack(`Welcome, ${u.name.split(' ')[0]}!`); }
      break;
    }
    case 'tab': ui.tab = btn.dataset.tab; renderMain(); appEl.querySelector('.view').scrollTop = 0; break;
    case 'slot': openSheet({ kind: 'slot', slot: btn.dataset.id, mode: null, dur: 120, day: null, start: 0, scrollToStart: true }); break;
    case 'mode': s.mode = v; s.scrollToStart = true; renderSheet(); break;
    case 'day': s.day = +v; s.start = 0; s.scrollToStart = true; renderSheet(); break;
    case 'dur': s.dur = +v; s.scrollToStart = true; renderSheet(); break;
    case 'start': s.start = +v; renderSheet(); break;
    case 'reserve': {
      const res = attempt(() => reserve(s.slot, s.mode === 'now' ? now() : s.start, s.dur));
      if (res) {
        closeSheet(); ui.tab = 'mine'; renderMain(); appEl.querySelector('.view').scrollTop = 0;
        snack(res.status === 'HELD' ? `${res.slot} is held for you. Check in when you arrive.` : `${res.slot} is booked for ${whenLabel(res.start, res.end, now())}.`);
      }
      break;
    }
    case 'arrive': if (attempt(arrive)) { renderMain(); snack('Checked in. Enjoy your day!'); } break;
    case 'extend': if (attempt(extend)) { renderMain(); snack('Extended by one hour.'); } break;
    case 'ask-end': {
      const r = mine(); if (!r) break;
      const parked = r.status === 'ACTIVE';
      openDialog(parked ? `Leave ${r.slot}?` : 'Cancel this reservation?',
        parked ? 'The slot will be marked free so the next driver can use it.' : `${r.slot} on ${whenLabel(r.start, r.end, now())} will be released.`,
        parked ? 'Leave slot' : 'Cancel reservation',
        () => { const done = attempt(end); if (done) { renderMain(); snack(done.status === 'COMPLETED' ? `Thanks! ${done.slot} is free again.` : 'Reservation cancelled.'); } });
      break;
    }
    case 'dlg-yes': { const fn = ui.dialog; closeDialog(); fn && fn(); break; }
    case 'dlg-no': closeDialog(); break;
    case 'edit-vehicle': { const u = me(); openSheet({ kind: 'vehicle', vType: u.vehicle.type, vColor: u.vehicle.color, plate: u.vehicle.plate }); break; }
    case 'save-vehicle': if (attempt(() => updateVehicle({ type: s.vType, color: s.vColor, plate: s.plate }))) { closeSheet(); renderMain(); snack('Vehicle updated.'); } break;
    case 'logout': db.session = null; save(); ui.page = 'welcome'; render(); break;
  }
}

document.querySelector('.screen').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn && !btn.disabled) { e.preventDefault(); onAction(btn); return; }
  if (e.target === scrimEl) { if (ui.dialog) closeDialog(); else closeSheet(); }
});

document.querySelector('.screen').addEventListener('input', (e) => {
  const f = e.target.closest('[data-f]'); if (!f) return;
  const k = f.dataset.f, val = e.target.value;
  if (k === 'lemail') ui.login.email = val;
  else if (k === 'lpw') ui.login.pw = val;
  else if (k === 'plate') { const d = ui.sheet && ui.sheet.kind === 'vehicle' ? ui.sheet : ui.reg; d.plate = val; updateVehicleBits(ui.sheet ? sheetEl : appEl, d); }
  else { ui.reg[k] = val; updateReg1(); }
});

document.querySelector('.screen').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    const act = ui.page === 'login' ? 'login' : ui.page === 'reg1' ? 'reg-next' : null;
    if (act) onAction({ dataset: { act } });
  }
  if (e.key === 'Escape') { if (ui.dialog) closeDialog(); else if (ui.sheet) closeSheet(); }
});

// ---------- clock, refresh and demo controls ----------
let ticks = 0;
function tick() {
  $('#clock').textContent = new Date(now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
  const note = $('#clock-note');
  note.innerHTML = db.offset ? `Demo clock: <b>+${Math.round(db.offset / MIN)} min</b>` : '';
  if (ui.page !== 'app') return;
  ticks++;
  const focusInSheet = ui.sheet && ui.sheet.kind === 'vehicle';
  renderMain();                          // countdowns update every second
  if (ui.sheet && !focusInSheet && ticks % 5 === 0) renderSheet();
}

$('#skip').addEventListener('click', () => {
  db.offset += 15 * MIN;
  refresh(now()); simulate(now(), true); save();
  tick(); if (ui.sheet && ui.sheet.kind === 'slot') renderSheet();
  snack('Skipped ahead 15 minutes.');
});
$('#reset').addEventListener('click', () => {
  closeDialog(); closeSheet(); seed();
  ui.page = 'welcome'; ui.tab = 'lot'; render(); tick();
  snack('Demo data reset.');
});

const root = document.documentElement;
$('#theme-toggle').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
});
$('#year').textContent = new Date().getFullYear();

db = load();
if (!db) seed();
ui.page = me() ? 'app' : 'welcome';
render(); tick();
setInterval(tick, 1000);

// Test hooks for automated checks.
window.__mr = { get db() { return db; }, ui, now, lot, reserve, arrive, extend, end, refresh, render, tick };
})();
