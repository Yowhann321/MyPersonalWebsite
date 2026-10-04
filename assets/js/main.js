// Shared site script: theme toggle, data loading, and page renderers.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isExternal = href => /^https?:/.test(href);

let dataPromise = null;
function fetchData() {
    if (!dataPromise) dataPromise = fetch('./data.json').then(r => r.json());
    return dataPromise;
}

function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const root = document.documentElement;
    btn.addEventListener('click', () => {
        const dark = root.dataset.theme
            ? root.dataset.theme === 'dark'
            : matchMedia('(prefers-color-scheme: dark)').matches;
        root.dataset.theme = dark ? 'light' : 'dark';
        try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    });
}

/* ---------- Home: numbered work index ---------- */
async function loadHome() {
    const list = document.getElementById('work-list');
    if (!list) return;
    try {
        const data = await fetchData();
        list.innerHTML = data.projects.map((p, i) => `
            <li>
                <a class="work-row" href="work.html?type=projects&id=${encodeURIComponent(p.id)}">
                    <span class="n">${pad(i + 1)}</span>
                    <span>
                        <h3>${esc(p.title)}</h3>
                        <p>${esc(p.summary)}</p>
                        <span class="mobile-meta">${esc(p.category)} · ${esc(p.year)}</span>
                    </span>
                    <span class="cat">${esc(p.category)}</span>
                    <span class="yr">${esc(p.year)}</span>
                    <span class="arrow" aria-hidden="true">→</span>
                </a>
            </li>`).join('');
        const count = document.getElementById('project-count');
        if (count) count.textContent = `${pad(data.projects.length)} projects`;
        const wc = document.getElementById('writing-count');
        if (wc) wc.textContent = `${data.writing.length} pieces`;
        renderCertifications(data.certifications || []);
    } catch (e) {
        list.innerHTML = '<li class="not-found">Projects could not be loaded.</li>';
    }
}

/* ---------- Home: certifications grouped by issuer ---------- */
function renderCertifications(groups) {
    const el = document.getElementById('cert-groups');
    if (!el) return;
    const month = ym => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const count = document.getElementById('cert-count');
    if (count) count.textContent = `${pad(total)} credentials`;

    el.innerHTML = groups.map(g => `
        <div class="cert-group">
            <h3 class="label">${esc(g.issuer)} <span>· ${g.items.length}</span></h3>
            <ul class="cert-list">
                ${g.items.map(c => `
                <li>
                    <a class="cert" href="${esc(c.url)}" target="_blank" rel="noopener">
                        ${c.badge
                            ? `<img src="${esc(c.badge)}" alt="" loading="lazy" width="48" height="48">`
                            : `<span class="cert-mark" aria-hidden="true">✓</span>`}
                        <span class="cert-text">
                            <span class="cert-name">${esc(c.name)}</span>
                            <span class="cert-meta">${c.kind ? esc(c.kind) + ' · ' : ''}${month(c.date)}</span>
                        </span>
                        <span class="cert-verify">Verify ↗</span>
                    </a>
                </li>`).join('')}
            </ul>
        </div>`).join('');
}

/* ---------- Writing list ---------- */
async function loadWriting() {
    const list = document.getElementById('poem-list');
    if (!list) return;
    const { writing } = await fetchData();

    const render = filter => {
        const shown = filter === 'all' ? writing : writing.filter(w => w.type === filter);
        list.innerHTML = shown.map(w => `
            <li>
                <a class="poem-row" href="work.html?type=writing&id=${encodeURIComponent(w.id)}">
                    <span class="t">${esc(w.title)}</span>
                    <span class="m">${w.type === 'haiku' ? 'Haiku' : 'Narrative'} · ${esc(w.date)}</span>
                </a>
            </li>`).join('');
    };

    document.querySelectorAll('.filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            render(btn.dataset.filter);
        });
    });
    render('all');
}

/* ---------- Detail page (projects and writing) ---------- */
async function loadDetail() {
    const params = new URLSearchParams(location.search);
    const type = params.get('type') === 'writing' ? 'writing' : 'projects';
    const id = params.get('id');
    const data = await fetchData();
    const item = (data[type] || []).find(p => p.id === id);
    const el = document.getElementById('detail');

    if (!item) {
        el.innerHTML = '<p class="not-found">That page doesn’t exist. <a href="index.html">Go back home</a>.</p>';
        return;
    }
    document.title = `${item.title} · Johann Lijauco`;

    if (type === 'projects') {
        const links = item.links || [];
        el.innerHTML = `
            <header class="page-title rise">
                <a class="back" href="index.html#work">← All projects</a>
                <h1>${esc(item.title)}</h1>
                <p class="lede">${esc(item.summary)}</p>
                ${links.length ? `<div class="btn-row">${links.map(l =>
                    `<a class="btn ${l.primary ? 'solid' : ''}" href="${esc(l.href)}"${isExternal(l.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)} <span aria-hidden="true">${isExternal(l.href) ? '↗' : '→'}</span></a>`).join('')}</div>` : ''}
            </header>
            <dl class="meta-grid rise d1" style="--cols:${3 + (item.role ? 1 : 0) + (item.origin ? 1 : 0)}">
                <div><dt>Year</dt><dd>${esc(item.year)}</dd></div>
                <div><dt>Category</dt><dd>${esc(item.category)}</dd></div>
                ${item.role ? `<div><dt>My role</dt><dd>${esc(item.role)}</dd></div>` : ''}
                <div><dt>Team</dt><dd>${esc(item.team || 'Solo')}</dd></div>
                ${item.origin ? `<div><dt>Origin</dt><dd>${esc(item.origin)}</dd></div>` : ''}
                <div class="wide"><dt>Built with</dt><dd>${(item.tags || []).map(esc).join(', ')}</dd></div>
            </dl>
            <div class="prose rise d2">${item.content}</div>`;
    } else {
        el.innerHTML = `
            <header class="page-title rise">
                <a class="back" href="writing.html">← All writing</a>
                <h1>${esc(item.title)}</h1>
                <p class="label">${item.type === 'haiku' ? 'Haiku' : 'Narrative poem'} · ${esc(item.date)}</p>
            </header>
            <div class="prose poem rise d1">${item.content}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle();
    const yr = document.getElementById('year');
    if (yr) yr.textContent = new Date().getFullYear();
    const page = document.body.dataset.page;
    if (page === 'home') loadHome();
    if (page === 'writing') loadWriting();
    if (page === 'detail') loadDetail();
});
