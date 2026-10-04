/* Network Labs viewer.
 * Draws each Packet Tracer topology from labs.js, parses the IOS configs, and simulates pings:
 * frames move through switch ports and VLANs, routers forward using connected and RIP routes. */
(() => {
'use strict';

// ---------- per-lab notes that aren't in the files ----------
const META = {
  lab1: {
    tab: 'Lab 1',
    needs: { '172.10.0.0/21': 1750, '172.10.8.0/22': 750, '172.10.12.0/24': 250, '172.10.13.0/26': 60, '172.10.13.64/30': 2, '172.10.13.68/30': 2 },
    quick: [['PC7', 'PC10'], ['PC0', 'PC4'], ['Laptop0', 'PC9'], ['PC12', 'PC5']],
    did: [
      'Split 172.10.0.0/16 into four LANs and two serial links with VLSM, largest network first (/21, /22, /24, /26, /30, /30).',
      'Gave each router LAN interface the last usable address as its gateway, and the first usable address to the DCE end of each serial link.',
      'Set up a DHCP pool on the router for each LAN, so all 14 hosts get their addresses automatically.',
      'Converged the network with RIP version 2 and no auto-summary, so every LAN can reach every other one.',
      'Secured each router with an enable secret and console and VTY passwords.',
    ],
    skills: ['VLSM subnetting', 'Cisco IOS router configuration', 'DHCP server pools', 'RIPv2 dynamic routing', 'Serial WAN links (DCE/DTE)', 'Device hardening basics'],
  },
  lab2: {
    tab: 'Lab 2',
    needs: { '192.168.0.0/23': 500, '192.168.2.0/25': 100, '192.168.2.128/27': 15 },
    quick: [['PC1', 'PC4'], ['PC3', 'PC6'], ['PC2', 'PC5'], ['PC6', 'PC1']],
    did: [
      'Created VLAN 10 (Faculty), 30 (Student) and 90 (Admin) on the VTP server, and let the client switches learn them.',
      'Built a VTP domain (MCL, version 2) with a server, two clients and a transparent switch, and trunked the switch links.',
      'Assigned access ports per VLAN on every switch, following the lab’s port plan.',
      'Subnetted 192.168.0.0/20 for 500, 100 and 15 hosts (/23, /25, /27).',
      'Set up router-on-a-stick on MCL with 802.1Q subinterfaces G0/1.10, .30 and .90 for inter-VLAN routing.',
      'Made MCL the DHCP server with one pool per VLAN (VLAN10, VLAN30, VLAN90).',
    ],
    skills: ['VLANs and access ports', 'VTP server, client and transparent modes', '802.1Q trunking', 'Inter-VLAN routing (router-on-a-stick)', 'DHCP per VLAN', 'VLSM subnetting'],
  },
};

// ---------- IP helpers ----------
const ip2n = (ip) => ip.split('.').reduce((a, o) => (a * 256) + (+o), 0);
const n2ip = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
const prefixOf = (mask) => ip2n(mask).toString(2).replace(/0/g, '').length;
const netOf = (ip, mask) => n2ip(Number(BigInt(ip2n(ip)) & BigInt(ip2n(mask))));
const inSubnet = (ip, net, mask) => netOf(ip, mask) === netOf(net, mask);
const cidr = (ip, mask) => `${netOf(ip, mask)}/${prefixOf(mask)}`;
const classfulMask = (ip) => { const o = +ip.split('.')[0]; return o < 128 ? '255.0.0.0' : o < 192 ? '255.255.0.0' : '255.255.255.0'; };
const shortPort = (p) => p.replace('GigabitEthernet', 'G').replace('FastEthernet', 'F').replace('Serial', 'S').replace('RS 232', 'RS232').replace('Console', 'Con');
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const listJoin = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- IOS config parser ----------
function parseConfig(lines) {
  const cfg = { hostname: null, ifaces: {}, pools: [], rip: null, routes: [] };
  let cur = null, mode = null;
  for (const raw of lines || []) {
    const l = raw.trimEnd();
    if (!l.startsWith(' ')) { cur = null; mode = null; }
    let m;
    if ((m = l.match(/^hostname (\S+)/))) cfg.hostname = m[1];
    else if ((m = l.match(/^interface (\S+)/))) { cur = cfg.ifaces[m[1]] = { name: m[1], ip: null, mask: null, shutdown: false, mode: null, access: 1, dot1q: null, clock: null }; mode = 'if'; }
    else if ((m = l.match(/^ip dhcp pool (\S+)/))) { cur = { name: m[1], net: null, mask: null, gw: null }; cfg.pools.push(cur); mode = 'pool'; }
    else if (/^router rip/.test(l)) { cur = cfg.rip = { version: 1, networks: [], autoSummary: true }; mode = 'rip'; }
    else if ((m = l.match(/^ip route (\S+) (\S+) (\S+)/))) cfg.routes.push({ net: m[1], mask: m[2], nh: m[3] });
    else if (mode === 'if') {
      if ((m = l.match(/^ ip address (\S+) (\S+)/))) { cur.ip = m[1]; cur.mask = m[2]; }
      else if (/^ shutdown/.test(l)) cur.shutdown = true;
      else if ((m = l.match(/^ switchport mode (\S+)/))) cur.mode = m[1];
      else if ((m = l.match(/^ switchport access vlan (\d+)/))) cur.access = +m[1];
      else if ((m = l.match(/^ encapsulation dot1Q (\d+)/i))) cur.dot1q = +m[1];
      else if ((m = l.match(/^ clock rate (\d+)/))) cur.clock = +m[1];
    } else if (mode === 'pool') {
      if ((m = l.match(/^ network (\S+) (\S+)/))) { cur.net = m[1]; cur.mask = m[2]; }
      else if ((m = l.match(/^ default-router (\S+)/))) cur.gw = m[1];
    } else if (mode === 'rip') {
      if ((m = l.match(/^ version (\d)/))) cur.version = +m[1];
      else if ((m = l.match(/^ network (\S+)/))) cur.networks.push(m[1]);
      else if (/^ no auto-summary/.test(l)) cur.autoSummary = false;
    }
  }
  return cfg;
}

// ---------- network model ----------
function buildNet(lab) {
  const devs = {}, peers = {};
  lab.devices.forEach((d) => { devs[d.name] = { ...d, cfg: parseConfig(d.config), linkedPorts: [] }; });
  lab.links.forEach((l) => {
    peers[l.a + '|' + l.ap] = { dev: l.b, port: l.bp, link: l };
    peers[l.b + '|' + l.bp] = { dev: l.a, port: l.ap, link: l };
    devs[l.a].linkedPorts.push(l.ap); devs[l.b].linkedPorts.push(l.bp);
  });
  const N = { lab, devs, peers };

  N.iface = (dev, port) => devs[dev].cfg.ifaces[port] || { name: port, ip: null, mask: null, shutdown: false, mode: null, access: 1, dot1q: null };
  N.portDown = (dev, port) => { const d = devs[dev]; if (d.kind !== 'router' && d.kind !== 'switch') return false; return N.iface(dev, port).shutdown; };
  // 2960 ports default to "dynamic auto": they only become trunks when the far end is set to trunk.
  N.swMode = (dev, port) => {
    const i = N.iface(dev, port);
    if (i.mode === 'trunk') return 'trunk';
    if (i.mode === 'access') return 'access';
    const p = peers[dev + '|' + port];
    if (p && devs[p.dev].kind === 'switch' && N.iface(p.dev, p.port).mode === 'trunk') return 'trunk';
    return 'access';
  };
  N.deliver = (dev, port, tag) => {
    const p = peers[dev + '|' + port];
    if (!p || p.link.cable === 'console') return null;
    if (N.portDown(dev, port) || N.portDown(p.dev, p.port)) return null;
    return { dev: p.dev, port: p.port, tag };
  };
  /** Every interface a frame can reach when it leaves [dev] on [port], with the links it crossed. */
  N.l2 = (startDev, startPort, tag) => {
    const out = [], seen = new Set();
    const first = N.deliver(startDev, startPort, tag);
    if (!first) return out;
    const queue = [{ ...first, hops: [{ a: startDev, ap: startPort, b: first.dev, bp: first.port }], vlan: null }];
    while (queue.length) {
      const s = queue.shift(), d = devs[s.dev];
      if (d.kind === 'switch') {
        const mode = N.swMode(s.dev, s.port);
        let vlan;
        if (mode === 'access') { if (s.tag != null) continue; vlan = N.iface(s.dev, s.port).access; }
        else vlan = s.tag == null ? 1 : s.tag;
        if (!(d.vlans || []).some((v) => v.id === vlan)) continue;
        const key = s.dev + '|' + vlan;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const p of d.linkedPorts) {
          if (p === s.port) continue;
          const om = N.swMode(s.dev, p);
          let outTag;
          if (om === 'access') { if (N.iface(s.dev, p).access !== vlan) continue; outTag = null; }
          else outTag = vlan === 1 ? null : vlan;
          const nx = N.deliver(s.dev, p, outTag);
          if (nx) queue.push({ ...nx, vlan, hops: [...s.hops, { a: s.dev, ap: p, b: nx.dev, bp: nx.port, vlan, trunk: om === 'trunk' }] });
        }
      } else if (d.kind === 'router') {
        let name = s.port;
        if (s.tag != null) {
          const sub = Object.values(d.cfg.ifaces).find((i) => i.name.startsWith(s.port + '.') && i.dot1q === s.tag);
          if (!sub) continue;
          name = sub.name;
        }
        const ifc = d.cfg.ifaces[name];
        if (!ifc || !ifc.ip || ifc.shutdown) continue;
        out.push({ dev: s.dev, iface: name, ip: ifc.ip, mask: ifc.mask, hops: s.hops, vlan: s.vlan ?? s.tag });
      } else if (s.tag == null) {
        out.push({ dev: s.dev, iface: s.port, host: true, hops: s.hops, vlan: s.vlan });
      }
    }
    return out;
  };
  N.hostPort = (name) => devs[name].linkedPorts.find((p) => peers[name + '|' + p].link.cable !== 'console');
  N.ifaceOut = (dev, ifname) => { const i = devs[dev].cfg.ifaces[ifname]; return i && i.dot1q != null ? [ifname.split('.')[0], i.dot1q] : [ifname, null]; };

  // DHCP: each host gets the next free address from the pool on the router interface in its broadcast domain.
  const used = {};
  Object.values(devs).filter((d) => (d.kind === 'pc' || d.kind === 'laptop') && d.dhcp).sort((a, b) => natural(a.name, b.name)).forEach((h) => {
    const port = N.hostPort(h.name);
    if (!port) return;
    for (const r of N.l2(h.name, port, null).filter((e) => !e.host)) {
      const pool = devs[r.dev].cfg.pools.find((p) => p.net && inSubnet(r.ip, p.net, p.mask));
      if (!pool) continue;
      const key = r.dev + pool.name;
      used[key] = used[key] || new Set([pool.gw, r.ip]);
      let n = ip2n(netOf(pool.net, pool.mask)) + 1;
      while (used[key].has(n2ip(n))) n++;
      used[key].add(n2ip(n));
      h.addr = { ip: n2ip(n), mask: pool.mask, gw: pool.gw, server: r.dev, pool: pool.name, iface: r.iface };
      break;
    }
  });
  N.hostByIp = (ip) => Object.values(devs).find((d) => d.addr && d.addr.ip === ip);

  // Routing tables: connected networks plus RIP, computed like distance-vector updates.
  const routers = Object.values(devs).filter((d) => d.kind === 'router');
  const ripOn = (r, ifc) => r.cfg.rip && r.cfg.rip.networks.some((n) => inSubnet(ifc.ip, n, classfulMask(n)));
  const physUp = (r, ifc) => { const [port] = N.ifaceOut(r.name, ifc.name); return !N.portDown(r.name, port) && !ifc.shutdown && r.linkedPorts.includes(port); };
  routers.forEach((r) => {
    r.table = new Map();
    Object.values(r.cfg.ifaces).forEach((i) => { if (i.ip && physUp(r, i)) r.table.set(cidr(i.ip, i.mask), { code: 'C', net: netOf(i.ip, i.mask), mask: i.mask, iface: i.name, metric: 0, rip: ripOn(r, i), ip: i.ip }); });
    r.cfg.routes.forEach((s) => r.table.set(cidr(s.net, s.mask), { code: 'S', net: s.net, mask: s.mask, nh: s.nh, metric: 0 }));
    r.neighbors = [];
    Object.values(r.cfg.ifaces).forEach((i) => {
      if (!i.ip || !ripOn(r, i) || !physUp(r, i)) return;
      const [port, tag] = N.ifaceOut(r.name, i.name);
      N.l2(r.name, port, tag).filter((e) => !e.host && e.dev !== r.name && inSubnet(e.ip, i.ip, i.mask) && ripOn(devs[e.dev], devs[e.dev].cfg.ifaces[e.iface]))
        .forEach((e) => r.neighbors.push({ router: e.dev, nh: e.ip, iface: i.name }));
    });
  });
  for (let round = 0; round < 15; round++) {
    let changed = false;
    routers.forEach((r) => r.neighbors.forEach((nb) => {
      devs[nb.router].table.forEach((e, key) => {
        if (e.code === 'C' && !e.rip) return;
        if (e.code === 'S') return;
        const metric = e.metric + 1, have = r.table.get(key);
        if (!have || (have.code === 'R' && metric < have.metric)) {
          r.table.set(key, { code: 'R', net: e.net, mask: e.mask, nh: nb.nh, iface: nb.iface, metric });
          changed = true;
        }
      });
    }));
    if (!changed) break;
  }
  N.lookup = (r, ip) => [...devs[r].table.values()].filter((e) => inSubnet(ip, e.net, e.mask)).sort((a, b) => prefixOf(b.mask) - prefixOf(a.mask))[0];
  return N;
}

// ---------- ping ----------
function describeSegment(N, seg) {
  const chain = [seg.hops[0].a, ...seg.hops.map((h) => h.b)];
  const vlan = seg.hops.map((h) => h.vlan).find((v) => v != null);
  const trunk = seg.hops.some((h) => h.trunk);
  const sws = chain.filter((n) => N.devs[n].kind === 'switch');
  let how = '';
  if (sws.length) how = ` through ${sws.join(', ')}` + (vlan != null && vlan !== 1 ? ` on VLAN ${vlan}` : '') + (trunk ? ' (tagged on trunks)' : '');
  return { chain, how };
}

function forward(N, src, dstIp) {
  const steps = [], hops = [];
  const h = N.devs[src];
  if (!h.addr) return { ok: false, steps, hops, why: `${src} has no IP address.` };
  const port = N.hostPort(src);
  const dom = N.l2(src, port, null);
  let cur;
  if (inSubnet(dstIp, h.addr.ip, h.addr.mask)) {
    const t = dom.find((e) => e.host && N.devs[e.dev].addr && N.devs[e.dev].addr.ip === dstIp);
    if (!t) return { ok: false, steps, hops, why: `Nothing answers ${dstIp} on ${src}'s network.` };
    const s = describeSegment(N, t);
    steps.push(`<b>${src}</b> reaches ${dstIp} directly${s.how}.`);
    hops.push(...t.hops);
    return { ok: true, steps, hops, routers: 0 };
  }
  const gw = dom.find((e) => !e.host && e.ip === h.addr.gw);
  if (!gw) return { ok: false, steps, hops, why: `${src} can't reach its gateway ${h.addr.gw}.` };
  const s0 = describeSegment(N, gw);
  steps.push(`<b>${src}</b> sends to its gateway <code>${h.addr.gw}</code> on ${gw.dev} ${shortPort(gw.iface)}${s0.how}.`);
  hops.push(...gw.hops);
  cur = gw.dev;
  for (let ttl = 0; ttl < 16; ttl++) {
    const route = N.lookup(cur, dstIp);
    if (!route) return { ok: false, steps, hops, why: `${cur} has no route to ${dstIp}.` };
    const [port2, tag] = N.ifaceOut(cur, route.iface);
    const seg = N.l2(cur, port2, tag);
    if (route.code === 'C') {
      const t = seg.find((e) => e.host && N.devs[e.dev].addr && N.devs[e.dev].addr.ip === dstIp);
      if (!t) return { ok: false, steps, hops, why: `${dstIp} isn't on ${cur}'s ${route.iface}.` };
      const s = describeSegment(N, t);
      steps.push(`<b>${cur}</b> delivers it out ${shortPort(route.iface)}, a connected network <code>${cidr(route.net, route.mask)}</code>${s.how}.`);
      hops.push(...t.hops);
      return { ok: true, steps, hops, routers: ttl + 1 };
    }
    const nh = seg.find((e) => !e.host && e.ip === route.nh);
    if (!nh) return { ok: false, steps, hops, why: `${cur} can't reach next hop ${route.nh}.` };
    steps.push(`<b>${cur}</b> looks up <code>${cidr(route.net, route.mask)}</code>, learned by RIP, and forwards to ${nh.dev} via ${shortPort(route.iface)}.`);
    hops.push(...nh.hops);
    cur = nh.dev;
  }
  return { ok: false, steps, hops, why: 'TTL expired.' };
}

// ---------- state ----------
const LABS = window.LABS;
const state = { lab: null, N: null, sel: null, ptab: 'brief', anim: null, ping: { src: null, dst: null, result: null } };
const $ = (s) => document.querySelector(s);
const svg = $('#topo'), pbody = $('#pbody');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVGNS = 'http://www.w3.org/2000/svg';
const center = (d) => [d.x + 25, d.y + 22];

// ---------- drawing ----------
const ICON = {
  router: '<circle r="17" fill="var(--router)"/><path d="M-11 -4h15m-4-4 4 4-4 4M11 4H-4m4-4-4 4 4 4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  switch: '<rect x="-21" y="-13" width="42" height="26" rx="5" fill="var(--switch)"/><path d="M-12 -4h20m-4-4 4 4-4 4M12 4h-20m4-4-4 4 4 4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pc: '<rect x="-15" y="-15" width="30" height="21" rx="3" fill="var(--host)"/><rect x="-12" y="-12" width="24" height="15" rx="1" fill="var(--canvas)"/><rect x="-3" y="6" width="6" height="5" fill="var(--host)"/><rect x="-10" y="11" width="20" height="3" rx="1.5" fill="var(--host)"/>',
  laptop: '<rect x="-13" y="-13" width="26" height="18" rx="2" fill="var(--host)"/><rect x="-10.5" y="-10.5" width="21" height="13" rx="1" fill="var(--canvas)"/><path d="M-18 6h36l-3 5h-30z" fill="var(--host)"/>',
};

function el(tag, attrs, html) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (html != null) e.innerHTML = html;
  return e;
}

function draw() {
  const { lab, N } = state;
  svg.innerHTML = '';
  const xs = [], ys = [];
  lab.devices.forEach((d) => { const [x, y] = center(d); xs.push(x - 46, x + 46); ys.push(y - 34, y + 60); });
  lab.zones.forEach((z) => { xs.push(z.x1, z.x2); ys.push(z.y1, z.y2); });
  const shortNotes = lab.notes.filter((n) => n.text.length <= 24);
  shortNotes.forEach((n) => { xs.push(n.x - 10, n.x + 90); ys.push(n.y - 10, n.y + 20); });
  const minX = Math.min(...xs) - 20, minY = Math.min(...ys) - 20, w = Math.max(...xs) - minX + 20, h = Math.max(...ys) - minY + 20;
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);

  const gz = el('g', { class: 'zones' });
  lab.zones.forEach((z) => {
    gz.appendChild(z.shape === 'ellipse'
      ? el('ellipse', { class: 'zone', cx: (z.x1 + z.x2) / 2, cy: (z.y1 + z.y2) / 2, rx: (z.x2 - z.x1) / 2, ry: (z.y2 - z.y1) / 2, fill: z.color })
      : el('rect', { class: 'zone', x: z.x1, y: z.y1, width: z.x2 - z.x1, height: z.y2 - z.y1, rx: 12, fill: z.color }));
  });
  // Name each zone color by what its hosts share: a VLAN, or else a subnet. Shown in the legend.
  state.zoneLabels = new Map();
  lab.zones.forEach((z) => {
    const cx = (z.x1 + z.x2) / 2, cy = (z.y1 + z.y2) / 2, rx = (z.x2 - z.x1) / 2, ry = (z.y2 - z.y1) / 2;
    const inside = Object.values(N.devs).filter((d) => {
      if (d.kind !== 'pc' && d.kind !== 'laptop') return false;
      const [x, y] = center(d);
      return z.shape === 'ellipse' ? ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 : x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2;
    });
    if (!inside.length) return;
    const vlanOf = (h) => { const port = N.hostPort(h.name), peer = port && N.peers[h.name + '|' + port]; return peer && N.devs[peer.dev].kind === 'switch' ? N.iface(peer.dev, peer.port).access : null; };
    const vlans = [...new Set(inside.map(vlanOf))], nets = [...new Set(inside.map((h) => h.addr && cidr(h.addr.ip, h.addr.mask)))];
    let text = '';
    if (vlans.length === 1 && vlans[0] != null && vlans[0] !== 1) {
      const v = Object.values(N.devs).flatMap((d) => d.vlans || []).find((x) => x.id === vlans[0]);
      text = `VLAN ${vlans[0]}${v ? ' · ' + v.name : ''}`;
    } else if (nets.length === 1 && nets[0]) text = nets[0];
    if (text) state.zoneLabels.set(z.color, text);
  });
  svg.appendChild(gz);
  shortNotes.forEach((n) => svg.appendChild(el('text', { class: 'note-label', x: n.x, y: n.y + 12 }, esc(n.text))));

  const gl = el('g', { class: 'links' }), gp = el('g', { class: 'ports' });
  lab.links.forEach((l, i) => {
    const [x1, y1] = center(N.devs[l.a]), [x2, y2] = center(N.devs[l.b]);
    let d = `M${x1} ${y1}L${x2} ${y2}`;
    if (l.cable === 'serial') {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, px = -uy * 7, py = ux * 7;
      d = `M${x1} ${y1}L${mx - ux * 8} ${my - uy * 8}L${mx + px} ${my + py}L${mx - px} ${my - py}L${mx + ux * 8} ${my + uy * 8}L${x2} ${y2}`;
    }
    gl.appendChild(el('path', { class: `link ${l.cable}`, d, 'data-link': i }));
    [[l.a, l.ap, x1, y1, x2, y2], [l.b, l.bp, x2, y2, x1, y1]].forEach(([dev, port, ax, ay, bx, by]) => {
      const len = Math.hypot(bx - ax, by - ay), t = Math.min(0.42, 52 / len);
      const lx = ax + (bx - ax) * t, ly = ay + (by - ay) * t, nx = -(by - ay) / len * 11, ny = (bx - ax) / len * 11;
      gp.appendChild(el('text', { class: 'plabel', x: lx + nx, y: ly + ny + 3, 'text-anchor': 'middle' }, esc(shortPort(port))));
      const ifc = N.devs[dev].cfg.ifaces[port];
      if (l.cable === 'serial' && ifc && ifc.clock) gp.appendChild(el('text', { class: 'dce', x: lx - nx, y: ly - ny + 3, 'text-anchor': 'middle' }, 'DCE'));
    });
  });
  svg.appendChild(gl); svg.appendChild(gp);

  const gd = el('g', { class: 'devices' });
  lab.devices.forEach((d) => {
    const [x, y] = center(d), dv = N.devs[d.name];
    const sub = d.kind === 'router' || d.kind === 'switch' ? d.model.replace('-24TT', '') : dv.addr ? dv.addr.ip : '';
    const g = el('g', { class: 'dev', transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'data-dev': d.name,
      'aria-label': `${d.name}, ${d.kind === 'pc' ? 'PC' : d.kind}${sub ? ', ' + sub : ''}` },
      `<circle class="halo" r="31"/><g transform="scale(1.2)">${ICON[d.kind]}</g><text class="dlabel" y="40" text-anchor="middle">${esc(d.name)}</text>${sub ? `<text class="dsub" y="54" text-anchor="middle">${esc(sub)}</text>` : ''}`);
    gd.appendChild(g);
  });
  svg.appendChild(gd);
  svg.appendChild(el('circle', { class: 'packet', r: 7, cx: -999, cy: -999, id: 'packet' }));
  fitText();
  applyHighlight();
}

/** Keeps diagram text a readable size on screen however wide the topology is. */
function fitText() {
  const vb = svg.viewBox.baseVal;
  if (!vb || !svg.clientWidth) return;
  const k = Math.max(1, Math.min(1.7, vb.width / svg.clientWidth));
  svg.style.setProperty('--k', k.toFixed(3));
  svg.querySelectorAll('.dlabel').forEach((t) => t.setAttribute('y', (27 + 12 * k).toFixed(1)));
  svg.querySelectorAll('.dsub').forEach((t) => t.setAttribute('y', (27 + 24.5 * k).toFixed(1)));
}
new ResizeObserver(() => fitText()).observe(svg);

function applyHighlight(path) {
  const sel = state.sel;
  const onPath = new Set(), pathLinks = new Set();
  (path || []).forEach((h) => { onPath.add(h.a); onPath.add(h.b); pathLinks.add(linkIndex(h)); });
  svg.querySelectorAll('.dev').forEach((g) => {
    const n = g.dataset.dev;
    g.classList.toggle('sel', n === sel);
    g.classList.toggle('onpath', !!path && onPath.has(n) && n !== sel);
    g.classList.toggle('dim', !!path && !onPath.has(n));
  });
  svg.querySelectorAll('.link').forEach((p) => {
    const l = state.lab.links[+p.dataset.link];
    const touches = sel && (l.a === sel || l.b === sel);
    p.classList.toggle('hi', !path && !!touches);
    p.classList.toggle('path', !!path && pathLinks.has(+p.dataset.link));
    p.classList.toggle('dim', !!path ? !pathLinks.has(+p.dataset.link) : !!sel && !touches);
  });
}
const linkIndex = (h) => state.lab.links.findIndex((l) => (l.a === h.a && l.ap === h.ap && l.b === h.b) || (l.b === h.a && l.bp === h.ap && l.a === h.b));

function legend() {
  const line = (cls, extra = '') => `<svg viewBox="0 0 26 10"><path class="link ${cls}" d="M0 5H26" ${extra}/></svg>`;
  $('#legend').innerHTML = [
    `<span>${line('straight')}Copper straight-through</span>`,
    state.lab.links.some((l) => l.cable === 'crossover') ? `<span>${line('crossover')}Crossover</span>` : '',
    state.lab.links.some((l) => l.cable === 'serial') ? `<span>${line('serial')}Serial (DCE end marked)</span>` : '',
    state.lab.links.some((l) => l.cable === 'console') ? `<span>${line('console')}Console</span>` : '',
    ...[...state.zoneLabels].sort((a, b) => natural(a[1], b[1])).map(([color, text]) => `<span><i class="swatch" style="background:${color}"></i>${esc(text)}</span>`),
  ].join('');
}

// ---------- panel ----------
function renderPanel() {
  document.querySelectorAll('.ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.ptab === state.ptab));
  if (state.ptab === 'brief') pbody.innerHTML = briefHtml();
  else if (state.ptab === 'device') pbody.innerHTML = state.sel ? deviceHtml(state.sel) : '<p class="hint">Click a device on the map to see its configuration, interfaces and the commands I typed on it.</p>';
  else pbody.innerHTML = pingHtml();
  if (state.ptab === 'ping') bindPing();
}

function briefHtml() {
  const { lab } = state;
  const notes = lab.notes.filter((n) => n.text.length > 24);
  const counts = lab.devices.reduce((a, d) => { a[d.kind] = (a[d.kind] || 0) + 1; return a; }, {});
  return `<h3>${esc(lab.title)}</h3><p class="muted">${esc(lab.subtitle)}</p>
    <dl class="kv"><dt>Routers</dt><dd>${counts.router || 0} × Cisco 2911</dd><dt>Switches</dt><dd>${counts.switch || 0} × Catalyst 2960</dd><dt>Hosts</dt><dd>${(counts.pc || 0) + (counts.laptop || 0)}</dd><dt>Commands logged</dt><dd>${lab.log.length}</dd></dl>
    <h4>The brief, from the lab file</h4><ul class="brief">${notes.map((n) => `<li>${esc(n.text.trim())}</li>`).join('')}</ul>
    <p class="hint">Open <b>Ping</b> to trace traffic between any two hosts, or click a device.</p>`;
}

function highlightCfg(lines) {
  return lines.map((l) => {
    let s = esc(l);
    s = s.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, '<span class="i">$1</span>');
    s = s.replace(/^(interface|hostname|router|ip dhcp pool|ip route|vlan|line|vtp|enable secret|enable password)\b/, '<span class="k">$1</span>');
    s = s.replace(/^(\s+(?:switchport|encapsulation|network|default-router|version|no auto-summary|clock rate|ip address|password|login|shutdown|name))/, '<span class="n">$1</span>');
    if (l === 'end') s = '<span class="c">end</span>';
    return s;
  }).join('\n');
}

function logHtml(name) {
  const entries = state.lab.log.filter((e) => e.d === name);
  if (!entries.length) return '';
  let lastDay = '', rows = '';
  entries.forEach((e) => {
    const parts = e.t.split(' '); // e.g. "Mon May 5 15:05:48 2025"
    const day = `${parts[0]} ${parts[1]} ${parts[2]}, ${parts[4]}`;
    if (day !== lastDay) { rows += `<span class="day">${esc(day)}</span>`; lastDay = day; }
    rows += `<div><time>${esc(parts[3])}</time><span><b>${esc(e.p)}</b> ${esc(e.c)}</span></div>`;
  });
  return `<details><summary>Commands I typed (${entries.length})</summary><div class="log">${rows}</div></details>`;
}

function deviceHtml(name) {
  const { N } = state, d = N.devs[name];
  let h = `<h3>${esc(name)}</h3><p class="muted">${d.kind === 'router' ? 'Router' : d.kind === 'switch' ? 'Switch' : d.kind === 'laptop' ? 'Laptop' : 'PC'} · ${esc(d.model)}</p>`;
  if (d.kind === 'router') {
    const ifs = Object.values(d.cfg.ifaces).filter((i) => i.ip || i.dot1q != null);
    h += '<h4>Interfaces</h4><table class="tbl"><tr><th>Interface</th><th>Address</th><th>Notes</th></tr>' + ifs.map((i) => {
      const [port] = N.ifaceOut(name, i.name);
      const peer = N.peers[name + '|' + port];
      const notes = [i.dot1q != null ? `802.1Q VLAN ${i.dot1q}` : '', i.clock && peer ? `DCE, clock ${i.clock / 1000} kbps` : '', peer ? `→ ${peer.dev} ${shortPort(peer.port)}` : 'not connected', i.shutdown ? 'shut down' : ''].filter(Boolean).join(' · ');
      return `<tr><td>${shortPort(i.name)}</td><td>${i.ip ? `${i.ip}/${prefixOf(i.mask)}` : '—'}</td><td class="txt">${esc(notes)}</td></tr>`;
    }).join('') + '</table>';
    if (d.cfg.pools.some((p) => p.net)) {
      h += '<h4>DHCP pools</h4><table class="tbl"><tr><th>Pool</th><th>Network</th><th>Gateway</th></tr>' + d.cfg.pools.filter((p) => p.net).map((p) =>
        `<tr><td>${esc(p.name)}</td><td>${cidr(p.net, p.mask)}</td><td>${p.gw || '—'}</td></tr>`).join('') + '</table>';
    }
    const rows = [...d.table.values()].sort((a, b) => ip2n(a.net) - ip2n(b.net) || prefixOf(a.mask) - prefixOf(b.mask));
    const rt = [];
    rows.forEach((e) => {
      if (e.code === 'C') { rt.push(`C    ${cidr(e.net, e.mask)} is directly connected, ${e.iface}`); rt.push(`L    ${e.ip}/32 is directly connected, ${e.iface}`); }
      else if (e.code === 'R') rt.push(`R    ${cidr(e.net, e.mask)} [120/${e.metric}] via ${e.nh}, ${e.iface}`);
      else rt.push(`S    ${cidr(e.net, e.mask)} [1/0] via ${e.nh}`);
    });
    h += `<h4>Routing</h4><p>${d.cfg.rip ? `RIP version ${d.cfg.rip.version}, networks ${d.cfg.rip.networks.join(', ')}${d.cfg.rip.autoSummary ? '' : ', no auto-summary'}.` : 'No routing protocol needed: every VLAN is directly connected to this router.'}</p>
      <div class="cli">${esc(name)}# show ip route\n${esc(rt.join('\n'))}</div><p class="hint" style="margin-top:6px">Worked out from the configs on this page.</p>`;
  } else if (d.kind === 'switch') {
    if (d.factoryDefault) h += '<p>This switch runs its factory defaults: every port is in VLAN 1, so it simply extends the router’s LAN. The lab only asked for router configuration.</p>';
    if (d.vtp) h += `<dl class="kv"><dt>VTP domain</dt><dd>${esc(d.vtp.domain)}</dd><dt>VTP mode</dt><dd><span class="badge s">${d.vtp.mode}</span></dd><dt>VTP version</dt><dd>${d.vtp.version}</dd><dt>Revision</dt><dd>${d.vtp.revision}</dd></dl>`;
    const ports = Array.from({ length: 24 }, (_, i) => `FastEthernet0/${i + 1}`).concat(['GigabitEthernet0/1', 'GigabitEthernet0/2']);
    const trunks = ports.filter((p) => d.linkedPorts.includes(p) ? N.swMode(name, p) === 'trunk' : N.iface(name, p).mode === 'trunk');
    h += '<h4>VLANs</h4><table class="tbl"><tr><th>VLAN</th><th>Name</th><th>Access ports</th></tr>' + (d.vlans || []).map((v) => {
      const acc = ports.filter((p) => !trunks.includes(p) && N.iface(name, p).access === v.id);
      return `<tr><td>${v.id}</td><td class="txt">${esc(v.name)}</td><td>${esc(compressPorts(acc))}</td></tr>`;
    }).join('') + '</table>';
    if (trunks.length) h += `<h4>Trunks</h4><p>${trunks.map((p) => { const peer = N.peers[name + '|' + p]; return `<span class="badge">${shortPort(p)}${peer ? ' → ' + esc(peer.dev) : ''}</span>`; }).join(' ')}</p>
      <p class="hint">${trunks.some((p) => !N.iface(name, p).mode) ? 'Unconfigured ports here became trunks automatically (DTP), because the switch on the other end is set to trunk.' : ''}</p>`;
  } else {
    const a = d.addr;
    h += '<h4>Addressing</h4>';
    h += a ? `<dl class="kv"><dt>Method</dt><dd>DHCP</dd><dt>Address</dt><dd>${a.ip}/${prefixOf(a.mask)} <span class="badge">example lease</span></dd><dt>Gateway</dt><dd>${a.gw}</dd><dt>DHCP server</dt><dd>${esc(a.server)} · pool ${esc(a.pool)}</dd></dl>`
      : '<p>No DHCP server is reachable from this host.</p>';
    if (d.savedGateway) {
      const match = a && a.gw === d.savedGateway;
      h += `<p style="margin-top:10px">Gateway saved in the lab file: <code>${esc(d.savedGateway)}</code> ${match ? '<span class="badge ok">matches</span>' : '<span class="badge bad">differs</span>'}</p>`;
    }
    const port = N.hostPort(name), peer = port && N.peers[name + '|' + port];
    if (peer) h += `<p class="hint">Plugged into ${esc(peer.dev)} ${shortPort(peer.port)}${N.devs[peer.dev].kind === 'switch' ? `, VLAN ${N.iface(peer.dev, peer.port).access}` : ''}.</p>`;
    h += `<p><button class="run" data-ping-from="${esc(name)}">Ping from ${esc(name)}</button></p>`;
  }
  if (d.config && d.config.length) h += `<details><summary>${state.lab.id === 'lab1' ? 'Saved' : 'Running'} configuration</summary><pre class="cfg">${highlightCfg(d.config)}</pre></details>`;
  h += logHtml(name);
  return h;
}

function compressPorts(list) {
  if (!list.length) return '—';
  const nums = list.filter((p) => p.startsWith('FastEthernet0/')).map((p) => +p.split('/')[1]);
  const other = list.filter((p) => !p.startsWith('FastEthernet0/')).map(shortPort);
  const ranges = [];
  nums.forEach((n) => { const r = ranges[ranges.length - 1]; if (r && r[1] === n - 1) r[1] = n; else ranges.push([n, n]); });
  return ranges.map(([a, b]) => a === b ? `F0/${a}` : `F0/${a}-${b}`).concat(other).join(', ');
}

// ---------- ping panel ----------
const hosts = () => Object.values(state.N.devs).filter((d) => d.kind === 'pc' || d.kind === 'laptop').sort((a, b) => natural(a.name, b.name));

function pingHtml() {
  const hs = hosts(), p = state.ping;
  if (!p.src) p.src = META[state.lab.id].quick[0][0];
  if (!p.dst) p.dst = META[state.lab.id].quick[0][1];
  const opt = (sel) => hs.map((h) => `<option value="${h.name}" ${h.name === sel ? 'selected' : ''}>${h.name}${h.addr ? ' · ' + h.addr.ip : ''}</option>`).join('');
  let res = '';
  if (p.result) {
    const r = p.result, dst = state.N.devs[p.dst];
    const ttl = r.ok ? 128 - r.fwd.routers : 0;
    const out = r.ok
      ? Array.from({ length: 4 }, () => `Reply from ${dst.addr.ip}: bytes=32 time<1ms TTL=${ttl}`).join('\n') + `\n\nPackets: Sent = 4, Received = 4, Lost = 0 (0% loss)`
      : `Request timed out.\nRequest timed out.\nRequest timed out.\nRequest timed out.\n\nPackets: Sent = 4, Received = 0, Lost = 4 (100% loss)`;
    res = `<ol class="trace">${r.fwd.steps.map((s) => `<li>${s}</li>`).join('')}${r.ok ? `<li>The reply returns the same way${r.fwd.routers ? ', routed back by ' + listJoin(r.revRouters) : ''}.</li>` : ''}</ol>
      <div class="result ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ Reply received' : '✕ ' + esc(r.why)}</div>
      <div class="cli">C:\\&gt; ping ${dst.addr ? dst.addr.ip : p.dst}\n\n${esc(out)}</div>`;
  }
  return `<h3>Trace a ping</h3><p class="muted">Pick two hosts. The route is worked out from the switch and router configs.</p>
    <div class="pingform"><label>From<select id="ping-src">${opt(p.src)}</select></label><button class="swap" id="ping-swap" type="button" aria-label="Swap source and destination">⇄</button><label>To<select id="ping-dst">${opt(p.dst)}</select></label></div>
    <button class="run" id="ping-run" type="button">Run ping</button>
    <div class="quick">${META[state.lab.id].quick.map(([a, b]) => `<button type="button" data-q="${a}|${b}">${a} → ${b}</button>`).join('')}</div>${res}`;
}

function bindPing() {
  const p = state.ping;
  $('#ping-src').onchange = (e) => { p.src = e.target.value; };
  $('#ping-dst').onchange = (e) => { p.dst = e.target.value; };
  $('#ping-swap').onclick = () => { [p.src, p.dst] = [p.dst, p.src]; p.result = null; renderPanel(); };
  $('#ping-run').onclick = runPing;
  pbody.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { [p.src, p.dst] = b.dataset.q.split('|'); runPing(); }; });
}

function runPing() {
  const { N } = state, p = state.ping;
  if (p.src === p.dst) { p.result = { ok: false, fwd: { steps: [], hops: [] }, why: 'Pick two different hosts.' }; renderPanel(); return; }
  const dst = N.devs[p.dst];
  const fwd = dst.addr ? forward(N, p.src, dst.addr.ip) : { ok: false, steps: [], hops: [], why: `${p.dst} has no address.` };
  let ok = fwd.ok, why = fwd.why, revRouters = [];
  if (ok) {
    const rev = forward(N, p.dst, N.devs[p.src].addr.ip);
    ok = rev.ok; why = rev.ok ? '' : 'The reply is lost: ' + rev.why;
    revRouters = [...new Set(rev.hops.flatMap((h) => [h.a, h.b]).filter((n) => N.devs[n].kind === 'router'))];
  }
  p.result = { ok, why, fwd, revRouters };
  state.sel = null;
  renderPanel();
  animate(fwd.hops, ok);
}

function animate(hops, ok) {
  cancelAnimationFrame(state.anim);
  const pk = $('#packet');
  applyHighlight(hops);
  if (!hops.length) { pk.setAttribute('cx', -999); return; }
  const pts = [center(state.N.devs[hops[0].a]), ...hops.map((h) => center(state.N.devs[h.b]))];
  if (reduceMotion) { pk.setAttribute('cx', pts[pts.length - 1][0]); pk.setAttribute('cy', pts[pts.length - 1][1]); return; }
  const per = 420, t0 = performance.now();
  pk.style.fill = '';
  const step = (now) => {
    const t = (now - t0) / per, i = Math.min(Math.floor(t), pts.length - 2), f = Math.min(1, t - i);
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    pk.setAttribute('cx', x1 + (x2 - x1) * f); pk.setAttribute('cy', y1 + (y2 - y1) * f);
    if (t < pts.length - 1) state.anim = requestAnimationFrame(step);
    else if (!ok) pk.style.fill = 'var(--bad)';
  };
  state.anim = requestAnimationFrame(step);
}

// ---------- addressing plan ----------
function planTable() {
  const { N, lab } = state, needs = META[lab.id].needs, rows = new Map();
  Object.values(N.devs).filter((d) => d.kind === 'router').forEach((r) => Object.values(r.cfg.ifaces).forEach((i) => {
    if (!i.ip) return;
    const key = cidr(i.ip, i.mask);
    const [port] = N.ifaceOut(r.name, i.name), peer = N.peers[r.name + '|' + port];
    if (!peer) return;
    let label;
    if (i.dot1q != null) {
      const v = Object.values(N.devs).flatMap((d) => d.vlans || []).find((x) => x.id === i.dot1q);
      label = `VLAN ${i.dot1q}${v ? ' · ' + v.name : ''}`;
    } else if (peer.link.cable === 'serial') label = `${[r.name, peer.dev].sort(natural).join(' ↔ ')} serial link`;
    else label = `LAN on ${peer.dev}`;
    const row = rows.get(key) || { key, net: netOf(i.ip, i.mask), mask: i.mask, label, addrs: [] };
    row.addrs.push(`${r.name} ${shortPort(i.name)} ${i.ip}`);
    rows.set(key, row);
  }));
  const list = [...rows.values()].sort((a, b) => prefixOf(a.mask) - prefixOf(b.mask) || ip2n(a.net) - ip2n(b.net));
  $('#plan-table').innerHTML = '<tr><th>Segment</th><th>Network</th><th>Mask</th><th>Router address</th><th>Needed</th><th>Usable</th></tr>' + list.map((r) => {
    const p = prefixOf(r.mask), usable = 2 ** (32 - p) - 2, need = needs[r.key];
    return `<tr><td class="txt">${esc(r.label)}</td><td>${r.key}</td><td>${r.mask}</td><td>${r.addrs.map(esc).join('<br>')}</td><td>${need ?? '—'}</td>
      <td><span class="bar"><i style="width:${need ? Math.round(need / usable * 100) : 0}%"></i></span>${usable.toLocaleString()}</td></tr>`;
  }).join('');
  $('#did').innerHTML = META[lab.id].did.map((x) => `<li>${esc(x)}</li>`).join('');
  $('#skills').innerHTML = META[lab.id].skills.map((x) => `<li>${esc(x)}</li>`).join('');
}

// ---------- wiring ----------
function selectLab(id, push = true) {
  const lab = LABS.find((l) => l.id === id) || LABS[0];
  cancelAnimationFrame(state.anim);
  state.lab = lab; state.N = buildNet(lab); state.sel = null; state.ping = { src: null, dst: null, result: null };
  $('#lab-tabs').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.lab === lab.id); b.setAttribute('aria-selected', b.dataset.lab === lab.id); });
  $('#lab-title').textContent = lab.title;
  $('#lab-sub').textContent = lab.subtitle;
  draw(); legend(); planTable(); renderPanel();
  if (push) try { history.replaceState(null, '', '#' + lab.id); } catch (e) {}
}

function selectDevice(name) {
  cancelAnimationFrame(state.anim);
  $('#packet').setAttribute('cx', -999);
  state.sel = name; state.ptab = 'device';
  applyHighlight(); renderPanel();
  pbody.scrollTop = 0;
}

$('#lab-tabs').innerHTML = LABS.map((l) => `<button role="tab" data-lab="${l.id}"><span>${META[l.id].tab}</span>${esc(l.title)}</button>`).join('');
$('#lab-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-lab]'); if (b) selectLab(b.dataset.lab); });
document.querySelector('.ptabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ptab]'); if (!b) return;
  state.ptab = b.dataset.ptab;
  if (state.ptab !== 'ping') { cancelAnimationFrame(state.anim); $('#packet').setAttribute('cx', -999); applyHighlight(); }
  renderPanel();
});
svg.addEventListener('click', (e) => {
  const g = e.target.closest('.dev');
  if (g) selectDevice(g.dataset.dev);
  else if (state.sel) { state.sel = null; applyHighlight(); }
});
svg.addEventListener('keydown', (e) => {
  const g = e.target.closest('.dev');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectDevice(g.dataset.dev); }
});
pbody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ping-from]');
  if (!b) return;
  const from = b.dataset.pingFrom, others = hosts().filter((h) => h.name !== from);
  state.ping.src = from;
  state.ping.dst = (others.find((h) => !inSubnet(h.addr?.ip || '0.0.0.0', state.N.devs[from].addr?.ip || '0.0.0.0', state.N.devs[from].addr?.mask || '255.255.255.255')) || others[0]).name;
  state.ptab = 'ping';
  runPing();
});
$('#show-ports').addEventListener('change', (e) => svg.classList.toggle('ports-hidden', !e.target.checked));
$('#show-zones').addEventListener('change', (e) => svg.classList.toggle('zone-hidden', !e.target.checked));

const root = document.documentElement;
$('#theme-toggle').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
});
$('#year').textContent = new Date().getFullYear();

// Deep links: #lab1, #lab2:CL1 (open a device) or #lab1:PC7-PC10 (trace a ping).
function openFromHash() {
  const [labId, arg] = decodeURIComponent((location.hash || '').slice(1)).split(':');
  selectLab(labId || 'lab1', false);
  if (!arg) return;
  const [a, b] = arg.split('-');
  if (b && state.N.devs[a] && state.N.devs[b]) { state.ping.src = a; state.ping.dst = b; state.ptab = 'ping'; runPing(); }
  else if (state.N.devs[a]) selectDevice(a);
}
openFromHash();
window.addEventListener('hashchange', openFromHash);

// Test hooks for automated checks.
window.__labs = { state, forward, buildNet, selectLab, selectDevice, runPing };
})();
