let currentData = null;
let currentType = null;

async function fetchData() {
    const response = await fetch('./data.json');
    return await response.json();
}

async function loadCategoryList() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    currentType = type;
    const data = await fetchData();
    currentData = data;
    const items = data[type];

    if (items) {
        document.getElementById('category-title').innerText = type.charAt(0).toUpperCase() + type.slice(1);
        
        // Show filter buttons only for poetry
        const filterDiv = document.getElementById('filter-buttons');
        if (type === 'poetry' && filterDiv) {
            filterDiv.style.display = 'block';
            setupFilterButtons(items);
        }
        
        renderItemList(items);
    }
}

function renderItemList(items) {
    const listDiv = document.getElementById('item-list');
    listDiv.innerHTML = ''; // Clear existing
    
    items.forEach(item => {
        const a = document.createElement('a');
        a.href = `work-detail.html?type=${currentType}&project=${item.id}`;
        a.className = 'list-item-link serif';
        
        // Add haiku badge if applicable
        let badgeHtml = '';
        if (currentType === 'poetry' && item.type === 'haiku') {
            badgeHtml = '<span style="background: var(--accent); padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.7rem; margin-left: 0.8rem;">Haiku</span>';
        }
        
        a.innerHTML = `<span>${item.title}${badgeHtml}</span><span style="font-size:0.9rem">${item.date}</span>`;
        listDiv.appendChild(a);
    });
}

function setupFilterButtons(items) {
    const allItems = items;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Update active state
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const filter = this.dataset.filter;
            
            let filteredItems;
            if (filter === 'all') {
                filteredItems = allItems;
            } else {
                filteredItems = allItems.filter(item => item.type === filter);
            }
            
            renderItemList(filteredItems);
        });
    });
}

async function loadProjectDetail() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const id = params.get('project');
    const data = await fetchData();
    
    const project = data[type].find(p => p.id === id);
    if (project) {
        document.getElementById('project-title').innerText = project.title;
        document.getElementById('project-date').innerText = project.date;
        document.getElementById('project-content').innerHTML = project.content;
        document.title = project.title;
    }
}