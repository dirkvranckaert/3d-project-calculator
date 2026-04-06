'use strict';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let projects = [];
let printers = [];
let materials = [];
let extraCostItems = [];
let settings = {};
let editingProjectId = null;
let editingPlateId = null;
let editingPlateProjectId = null;
let searchQuery = '';
let showArchived = false;
let archivedCountCache = 0;
let currentView = 'list'; // 'list' or 'detail'
let currentProjectId = null;

/* ================================================================== */
/*  API helpers                                                        */
/* ================================================================== */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location.replace('/login'); return null; }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}
const GET = (p) => api(p);
const POST = (p, body) => api(p, { method: 'POST', body });
const PUT = (p, body) => api(p, { method: 'PUT', body });
const DEL = (p) => api(p, { method: 'DELETE' });
const PATCH = (p, body) => api(p, { method: 'PATCH', body });

/* ================================================================== */
/*  Formatting helpers                                                 */
/* ================================================================== */
function fmt(n, decimals = 2) {
  const sym = settings.currency_symbol || '\u20ac';
  return `${sym}${Number(n || 0).toFixed(decimals)}`;
}
function fmtPct(n) { return `${Number(n || 0).toFixed(2)}%`; }
function fmtTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtGrams(g) { return `${Number(g || 0).toFixed(2)}g`; }
function fmtWeight(g) {
  if (g >= 1000) return `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)}kg`;
  return `${g}g`;
}
function fmtFileSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/* ================================================================== */
/*  Theme                                                              */
/* ================================================================== */
function applyTheme(mode) {
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

/* ================================================================== */
/*  Modal helpers                                                      */
/* ================================================================== */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) closeModal(closeBtn.dataset.close);
  const overlay = e.target.closest('.modal-overlay');
  if (overlay && e.target === overlay) closeModal(overlay.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});

/* ================================================================== */
/*  Routing (hash-based)                                               */
/* ================================================================== */
function navigate(hash) {
  window.location.hash = hash;
}

function parseRoute() {
  const hash = window.location.hash || '#/';
  const match = hash.match(/^#\/project\/(\d+)$/);
  if (match) return { view: 'detail', projectId: parseInt(match[1]) };
  return { view: 'list' };
}

window.addEventListener('hashchange', () => render());

/* ================================================================== */
/*  Data loading                                                       */
/* ================================================================== */
async function loadAll() {
  const projUrl = showArchived ? '/api/projects?archived=1' : '/api/projects';
  [projects, printers, materials, extraCostItems, settings] = await Promise.all([
    GET(projUrl), GET('/api/printers'), GET('/api/materials'),
    GET('/api/extra-costs'), GET('/api/settings'),
  ]);
  applyTheme(settings.theme || 'system');
  GET('/api/projects/archived-count').then(r => { archivedCountCache = r.count; });
  render();
}

async function reloadProjects() {
  projects = await GET(showArchived ? '/api/projects?archived=1' : '/api/projects');
  GET('/api/projects/archived-count').then(r => { archivedCountCache = r.count; });
  render();
}

async function reloadSingleProject(id) {
  const updated = await GET(`/api/projects/${id}`);
  const idx = projects.findIndex(p => p.id === id);
  if (idx >= 0) projects[idx] = updated;
  else projects.unshift(updated);
  render();
}

/* ================================================================== */
/*  Main render dispatcher                                             */
/* ================================================================== */
function render() {
  const route = parseRoute();
  const el = document.getElementById('main');
  const newBtn = document.getElementById('btn-new-project');

  if (route.view === 'detail') {
    currentView = 'detail';
    currentProjectId = route.projectId;
    newBtn.style.display = 'none';
    const p = projects.find(x => x.id === route.projectId);
    if (!p) { el.innerHTML = `<div class="empty-state"><p>Project not found.</p><button class="btn btn-primary" onclick="navigate('#/')">Back to list</button></div>`; return; }
    el.innerHTML = renderDetailView(p);
  } else {
    currentView = 'list';
    currentProjectId = null;
    newBtn.style.display = '';
    el.innerHTML = renderListView();
    setTimeout(attachLongPress, 0);
  }
}

/* ================================================================== */
/*  LIST VIEW — summary cards                                          */
/* ================================================================== */
function renderListView() {
  if (!projects || projects.length === 0) {
    return `<div class="empty-state">
      <h2>No projects yet</h2>
      <p>Create your first 3D printing project to start calculating costs and pricing.</p>
      <button class="btn btn-primary" onclick="openProjectModal()">+ New Project</button>
    </div>`;
  }

  let filtered = projects;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = projects.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.customer_name || '').toLowerCase().includes(q) ||
      (p.tags || '').toLowerCase().includes(q)
    );
  }

  const archiveToggle = `<label class="archive-toggle"><input type="checkbox" ${showArchived ? 'checked' : ''} onchange="toggleShowArchived(this.checked)"> Show archived${archivedCountCache > 0 ? ` (${archivedCountCache})` : ''}</label>`;
  const searchBar = `<div class="search-bar">
    <div class="search-bar-row">
      <input type="text" id="search-input" placeholder="Search projects..." value="${esc(searchQuery)}" oninput="onSearch(this.value)">
      ${archiveToggle}
    </div>
  </div>`;

  if (filtered.length === 0) {
    return searchBar + `<div class="empty-state"><p>No projects match "${esc(searchQuery)}"</p></div>`;
  }

  return searchBar + `<div class="project-grid">${filtered.map(p => renderSummaryCard(p)).join('')}</div>`;
}

function onSearch(q) {
  searchQuery = q;
  render();
  const inp = document.getElementById('search-input');
  if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = q.length; }
}

function renderSummaryCard(p) {
  const c = p.calculation;
  const pr = c?.pricing || {};
  const hasPlates = p.plates?.length > 0;

  const primaryImage = (p.images || []).find(i => i.is_primary) || (p.images || [])[0] || null;

  // Determine which price/margin to highlight
  const hasActual = p.actual_sales_price > 0;
  const displayPrice = hasActual ? p.actual_sales_price : (pr.suggestedPrice || 0);
  const indicator = hasActual ? c?.actualIndicator : c?.suggestedIndicator;
  const marginPct = hasActual ? c?.actualMargin?.marginPct : pr.suggestedMarginPct;

  return `
  <div class="summary-card ${p.archived ? 'summary-card-archived' : ''}" data-project-id="${p.id}" onclick="navigate('#/project/${p.id}')" oncontextmenu="showProjectContextMenu(event, ${p.id})">
    <div class="summary-card-img">${primaryImage
      ? `<img src="/api/images/${primaryImage.id}" alt="">`
      : `<div class="summary-card-img-placeholder"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".25"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`}</div>
    <div class="summary-card-top">
      <div class="summary-card-title">
        <span class="project-name">${esc(p.name)}</span>${p.archived ? ' <span class="archived-badge">ARCHIVED</span>' : ''}
        ${p.customer_name ? `<span class="project-customer">${esc(p.customer_name)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${hasPlates ? `<span class="project-price-badge ${indicator || 'green'}">${fmt(displayPrice)}</span>` : `<span class="project-price-badge" style="opacity:.4">No plates</span>`}
        <button class="btn-icon mobile-only" title="More" onclick="event.stopPropagation();showProjectContextMenu(event,${p.id},true)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
    </div>
    ${hasPlates ? `
    <div class="summary-card-grid">
      <div class="summary-stat"><span class="summary-stat-label">Production</span><span class="summary-stat-value">${fmt(pr.productionCost)}</span></div>
      <div class="summary-stat"><span class="summary-stat-label">Suggested</span><span class="summary-stat-value">${fmt(pr.suggestedPrice)}</span></div>
      <div class="summary-stat"><span class="summary-stat-label">Actual</span><span class="summary-stat-value">${hasActual ? fmt(p.actual_sales_price) : '<span style="opacity:.4">-</span>'}</span></div>
      <div class="summary-stat"><span class="summary-stat-label">Margin</span><span class="summary-stat-value"><span class="margin-badge ${indicator || 'green'}">${marginPct != null ? fmtPct(marginPct) : '-'}</span></span></div>
    </div>
    <div class="summary-card-meta">${p.plates.length} plate${p.plates.length !== 1 ? 's' : ''}${p.items_per_set > 1 ? ` \u00b7 set of ${p.items_per_set}` : ''}</div>
    ${renderTagsPills(p.tags)}
    ` : ''}
  </div>`;
}

/* ================================================================== */
/*  DETAIL VIEW — full project                                         */
/* ================================================================== */
function renderDetailView(p) {
  const c = p.calculation;
  const pr = c?.pricing || {};

  return `
  <div class="detail-topbar">
    <button class="btn btn-icon" onclick="navigate('#/')" title="Back to list">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="detail-topbar-title">
      <h2>${esc(p.name)}</h2>
      <div>
        ${p.customer_name ? `<span class="project-customer">${esc(p.customer_name)}</span>` : ''}
        ${p.items_per_set > 1 ? `<span class="project-customer">(set of ${p.items_per_set})</span>` : ''}
        ${renderTagsPills(p.tags)}
      </div>
    </div>
    <div class="detail-topbar-actions">
      <button class="btn btn-sm" onclick="openProjectModal(${p.id})">Edit</button>
      <button class="btn btn-sm btn-danger" onclick="deleteProject(${p.id},event)">Delete</button>
    </div>
  </div>
  ${renderProjectNotes(p)}
  ${renderPlatesSection(p)}
  ${renderCostSection(p)}
  ${renderExtrasSection(p)}
  ${renderImagesSection(p)}
  ${renderFilesSection(p)}
  ${renderPricingSection(p)}`;
}

/* ================================================================== */
/*  Plates table                                                       */
/* ================================================================== */
function renderPlatesSection(p) {
  const importBtn = `<label class="btn btn-sm" style="cursor:pointer">Import 3MF<input type="file" accept=".3mf" style="display:none" onchange="import3mf(${p.id}, this)"></label>`;
  if (!p.plates || p.plates.length === 0) {
    return `<div class="plates-section">
      <div class="plates-section-header"><h3>Print Plates</h3>
        <div style="display:flex;gap:6px">${importBtn}<button class="btn btn-sm btn-primary" onclick="openPlateModal(${p.id})">+ Add Plate</button></div></div>
      <p style="color:var(--text-muted)">No plates yet. Add a plate or import from a sliced 3MF.</p>
    </div>`;
  }
  const rows = p.plates.map((pl, i) => {
    const pb = p.calculation?.plateBreakdowns?.[i];
    const disabled = !pl.enabled;
    const rowCls = disabled ? 'plate-disabled' : '';
    const disabledBadge = disabled ? '<span class="plate-disabled-badge">DISABLED</span>' : '';
    const toggleTitle = disabled ? 'Enable plate' : 'Disable plate';
    const toggleIcon = disabled
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    return `<tr class="${rowCls}">
      <td>${esc(pl.name || `Plate ${i + 1}`)} ${disabledBadge}${renderColorSwatches(pl.colors)}${pl.notes ? `<div style="font-size:11px;color:var(--text-muted);white-space:normal">${esc(pl.notes)}</div>` : ''}</td>
      <td class="num editable" data-label="Time" onclick="startInlineEdit(${p.id},${pl.id},'print_time_minutes',${pl.print_time_minutes},this,'time')">${fmtTime(pl.print_time_minutes)}</td>
      <td class="num editable" data-label="Plastic" onclick="startInlineEdit(${p.id},${pl.id},'plastic_grams',${pl.plastic_grams},this,'float')">${fmtGrams(pl.plastic_grams)}</td>
      <td class="num editable" data-label="#/Plate" onclick="startInlineEdit(${p.id},${pl.id},'items_per_plate',${pl.items_per_plate},this,'int')">${pl.items_per_plate}</td>
      <td class="num col-hide-mobile editable" data-label="Risk" onclick="startInlineEdit(${p.id},${pl.id},'risk_multiplier',${pl.risk_multiplier},this,'float')">${pl.risk_multiplier}</td>
      <td class="col-hide-mobile editable" data-label="Printer" onclick="startInlineEdit(${p.id},${pl.id},'printer_id',${pl.printer_id||'null'},this,'select-printer')">${esc(pl.printer_name || '-')}</td>
      <td class="col-hide-mobile editable" data-label="Material" onclick="startInlineEdit(${p.id},${pl.id},'material_id',${pl.material_id||'null'},this,'select-material')">${esc(pl.material_name || '-')}</td>
      <td class="num col-hide-mobile" data-label="Mat. cost">${fmt(pb?.materialCost)}</td>
      <td class="num col-hide-mobile" data-label="Proc. cost">${fmt(pb?.processingCost)}</td>
      <td class="num col-hide-mobile" data-label="Elec. cost">${fmt(pb?.electricityCost)}</td>
      <td class="num col-hide-mobile" data-label="Print. cost">${fmt(pb?.printerUsageCost)}</td>
      <td class="num" data-label="Total" style="font-weight:600">${fmt(pb?.totalPlateCost)}</td>
      <td><div class="plate-actions">
        <button class="btn-icon" title="${toggleTitle}" onclick="togglePlate(${p.id}, ${pl.id})">${toggleIcon}</button>
        <button class="btn-icon" title="Duplicate" onclick="duplicatePlate(${p.id}, ${pl.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="btn-icon" title="Edit" onclick="openPlateModal(${p.id}, ${pl.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon" title="Delete" onclick="deletePlate(${p.id},${pl.id},event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </div></td>
    </tr>`;
  });

  return `<div class="plates-section">
    <div class="plates-section-header"><h3>Print Plates</h3>
      <div style="display:flex;gap:6px">${importBtn}<button class="btn btn-sm btn-primary" onclick="openPlateModal(${p.id})">+ Add Plate</button></div></div>
    <div class="plates-table-wrap"><table class="plates-table">
      <thead><tr><th>Name</th><th>Time</th><th>Plastic</th><th>#/Plate</th><th class="col-hide-mobile">Risk</th><th class="col-hide-mobile">Printer</th><th class="col-hide-mobile">Material</th><th class="col-hide-mobile">Mat. Cost</th><th class="col-hide-mobile">Process.</th><th class="col-hide-mobile">Electric.</th><th class="col-hide-mobile">Printer</th><th>Total</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </div>`;
}

/* ================================================================== */
/*  Cost breakdown cards                                               */
/* ================================================================== */
function renderCostSection(p) {
  const c = p.calculation;
  if (!c || !p.plates?.length) return '';
  const pi = c.perItemCosts;
  const pr = c.profits;
  return `<div class="cost-section"><div class="cost-grid">
    <div class="cost-card"><h4>Material Cost</h4><div class="value">${fmt(pi.materialCost * p.items_per_set)}</div>
      <div class="detail">+ ${fmtPct(settings.material_profit_pct)} profit: ${fmt(pr.materialProfit * p.items_per_set)}</div></div>
    <div class="cost-card"><h4>Processing Cost</h4><div class="value">${fmt(pi.processingCost * p.items_per_set)}</div>
      <div class="detail">+ ${fmtPct(settings.processing_profit_pct)} profit: ${fmt(pr.processingProfit * p.items_per_set)}</div></div>
    <div class="cost-card"><h4>Electricity Cost</h4><div class="value">${fmt(pi.electricityCost * p.items_per_set)}</div>
      <div class="detail">+ ${fmtPct(settings.electricity_profit_pct)} profit: ${fmt(pr.electricityProfit * p.items_per_set)}</div></div>
    <div class="cost-card"><h4>Printer Usage Cost</h4><div class="value">${fmt(pi.printerUsageCost * p.items_per_set)}</div>
      <div class="detail">+ ${fmtPct(settings.printer_cost_profit_pct)} profit: ${fmt(pr.printerCostProfit * p.items_per_set)}</div></div>
  </div></div>`;
}

/* ================================================================== */
/*  Extra costs table                                                  */
/* ================================================================== */
function renderExtrasSection(p) {
  const allItems = extraCostItems || [];
  const pExtras = {};
  (p.extras || []).forEach(e => { pExtras[e.extra_cost_id] = e; });
  const activeItems = allItems.filter(eci => pExtras[eci.id]?.quantity > 0);
  const availableItems = allItems.filter(eci => !pExtras[eci.id] || pExtras[eci.id].quantity === 0);
  const total = activeItems.reduce((s, eci) => s + eci.price_excl_vat * (pExtras[eci.id]?.quantity || 0), 0);

  const rows = activeItems.map(eci => {
    const qty = pExtras[eci.id]?.quantity || 0;
    const lineTotal = eci.price_excl_vat * qty;
    return `<tr>
      <td class="ec-name">${esc(eci.name)}</td>
      <td class="ec-price num">${fmt(eci.price_excl_vat)}</td>
      <td class="ec-qty"><input type="number" min="1" value="${qty}" onchange="updateExtraQty(${p.id}, ${eci.id}, parseInt(this.value)||0)"></td>
      <td class="ec-total num">${fmt(lineTotal)}</td>
      <td class="ec-action"><button class="btn-icon" title="Remove" onclick="updateExtraQty(${p.id}, ${eci.id}, 0)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button></td></tr>`;
  });

  const addSelect = availableItems.length > 0 ? `
    <div class="ec-add-row">
      <select id="ec-add-select-${p.id}" class="ec-add-select">
        <option value="">Add supply...</option>
        ${availableItems.map(eci => `<option value="${eci.id}">${esc(eci.name)} (${fmt(eci.price_excl_vat)})</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-primary" onclick="addExtraFromSelect(${p.id})">Add</button>
    </div>` : '';

  return `<div class="extras-section">
    <div class="extras-section-header"><h3>Supplies &amp; Packaging</h3><span class="ec-total-badge">Total: ${fmt(total)}</span></div>
    ${activeItems.length > 0 ? `<div class="plates-table-wrap"><table class="ec-table">
      <thead><tr><th>Item</th><th>Unit Price</th><th>Qty</th><th>Total</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:600">Total excl. VAT</td><td class="num" style="font-weight:700">${fmt(total)}</td><td></td></tr></tfoot>
    </table></div>` : '<p style="color:var(--text-muted);font-size:13px;padding:4px 0">No supplies added yet.</p>'}
    ${addSelect}
  </div>`;
}

/* ================================================================== */
/*  Files section                                                      */
/* ================================================================== */
function renderImagesSection(p) {
  const images = p.images || [];
  return `<div class="extras-section">
    <div class="extras-section-header"><h3>Images</h3>
      <label class="btn btn-sm" style="cursor:pointer">Upload<input type="file" accept="image/*" style="display:none" onchange="uploadImage(${p.id}, this)"></label>
    </div>
    ${images.length === 0 ? '<p style="color:var(--text-muted);font-size:12px">No images yet. Upload a 3MF to auto-extract thumbnails.</p>' :
      `<div class="image-gallery">${images.map(img => `
        <div class="image-thumb ${img.is_primary ? 'image-thumb-primary' : ''}">
          <img src="/api/images/${img.id}" alt="${esc(img.filename)}" loading="lazy">
          <div class="image-thumb-actions">
            ${!img.is_primary ? `<button class="btn-icon" title="Set as primary" onclick="setPrimaryImage(${img.id},${p.id})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>` : ''}
            <button class="btn-icon" title="Delete" onclick="deleteImage(${img.id},${p.id},event)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>`).join('')}</div>`}
  </div>`;
}

async function uploadImage(projectId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const res = await fetch(`/api/projects/${projectId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
    body: await file.arrayBuffer(),
  });
  if (res.status === 401) { window.location.replace('/login'); return; }
  input.value = '';
  await reloadSingleProject(projectId);
}

async function setPrimaryImage(imageId, projectId) {
  await PATCH(`/api/images/${imageId}/primary`);
  await reloadSingleProject(projectId);
}

async function deleteImage(imageId, projectId, e) {
  const anchor = e?.currentTarget || e?.target || document.body;
  if (!await inlineConfirm('Delete this image?', anchor)) return;
  await DEL(`/api/images/${imageId}`);
  await reloadSingleProject(projectId);
}

function renderFilesSection(p) {
  const files = p.files || [];
  const fileRows = files.map(f => `
    <div class="file-row">
      <svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <a href="/api/files/${f.id}/download" class="file-name">${esc(f.filename)}</a>
      <span class="file-size">${fmtFileSize(f.size_bytes)}</span>
      <button class="btn-icon" title="Delete" onclick="deleteFile(${f.id}, ${p.id})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  return `<div class="extras-section">
    <div class="extras-section-header"><h3>Files</h3>
      <label class="btn btn-sm" style="cursor:pointer">Upload<input type="file" accept=".3mf,.stl,.gcode,.scad" style="display:none" onchange="uploadFile(${p.id}, this)" multiple></label>
    </div>
    <div class="file-list" id="file-list-${p.id}">
      ${fileRows || '<p style="color:var(--text-muted);font-size:12px">No files uploaded yet.</p>'}
    </div>
  </div>`;
}

/* ================================================================== */
/*  Pricing section                                                    */
/* ================================================================== */
function renderPricingSection(p) {
  const c = p.calculation;
  if (!c || !p.plates?.length) return '';
  const pr = c.pricing;
  const itemLabel = p.items_per_set > 1 ? `set of ${p.items_per_set}` : 'item';

  const greenPct = settings.margin_green_pct || 30;
  const vatMult = 1 + (settings.vat_rate || 21) / 100;
  const denominator = (1 / vatMult) - (greenPct / 100);
  const minPriceForGreen = denominator > 0 ? pr.productionCost / denominator : 0;

  // Actual price section
  let actualBlock = '';
  if (p.actual_sales_price > 0 && c.actualMargin) {
    const am = c.actualMargin;
    actualBlock = `<div class="pricing-block">
      <h4>Actual Sales Price</h4>
      <div class="big-price">${fmt(p.actual_sales_price)}</div>
      <div class="sub">${fmt(am.actualExclVat)} excl. VAT</div>
      <div class="sub">Profit: ${fmt(am.profitAmount)} <span class="margin-badge ${c.actualIndicator}">${fmtPct(am.marginPct)}</span></div>
    </div>`;
  } else {
    actualBlock = `<div class="pricing-block">
      <h4>Actual Sales Price</h4>
      <div class="actual-price-wrap">
        <input type="number" class="actual-price-input" value="${p.actual_sales_price || ''}"
          placeholder="Enter price..." onchange="updateActualPrice(${p.id}, this.value)" step="0.01" min="0">
      </div>
      <div class="sub" style="margin-top:4px;opacity:.5">Set your selling price to see actual margin</div>
    </div>`;
  }

  return `<div class="pricing-section"><div class="pricing-grid">
    <div class="pricing-block">
      <h4>Production Cost (${itemLabel})</h4>
      <div class="big-price">${fmt(pr.productionCost)}</div>
      <div class="sub">excl. VAT, no margins</div>
      ${minPriceForGreen > 0 ? `<div class="sub" style="margin-top:4px">Min. for ${greenPct}% margin: <strong>${fmt(minPriceForGreen)}</strong></div>` : ''}
    </div>
    <div class="pricing-block">
      <h4>Total excl. VAT</h4>
      <div class="big-price">${fmt(pr.totalExclVat)}</div>
      <div class="sub">+ VAT (${settings.vat_rate}%): ${fmt(pr.vatAmount)}</div>
      <div class="sub">Total incl. VAT: ${fmt(pr.totalInclVat)}</div>
    </div>
    <div class="pricing-block">
      <h4>Suggested Price</h4>
      <div class="big-price">${fmt(pr.suggestedPrice)}</div>
      <div class="sub">${fmt(pr.suggestedExclVat)} excl. VAT</div>
      <div class="sub">Profit: ${fmt(pr.suggestedProfitAmount)} <span class="margin-badge ${c.suggestedIndicator}">${fmtPct(pr.suggestedMarginPct)}</span></div>
    </div>
    ${actualBlock}
  </div>
  ${p.actual_sales_price > 0 ? `<div style="padding:8px 0 0;text-align:right">
    <button class="btn btn-sm" onclick="updateActualPrice(${p.id}, null)">Clear actual price</button>
    <button class="btn btn-sm" onclick="promptActualPrice(${p.id}, ${p.actual_sales_price})">Change price</button>
  </div>` : ''}
  </div>`;
}

/* ================================================================== */
/*  Project notes (inline editable)                                    */
/* ================================================================== */
function renderProjectNotes(p) {
  return `<div class="project-notes-section">
    <div class="project-notes-label">Notes</div>
    <textarea class="project-notes-input" placeholder="Add project notes..." rows="2"
      onblur="saveProjectNotes(${p.id}, this.value)">${esc(p.notes || '')}</textarea>
  </div>`;
}

async function saveProjectNotes(projectId, value) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if ((p.notes || '') === value) return; // no change
  await PUT(`/api/projects/${projectId}`, {
    name: p.name, customer_name: p.customer_name,
    items_per_set: p.items_per_set, tags: p.tags || '', notes: value || null,
    actual_sales_price: p.actual_sales_price,
  });
  p.notes = value || null; // update local state without full reload
}

/* ================================================================== */
/*  Context menu (project list)                                        */
/* ================================================================== */
function showProjectContextMenu(e, projectId, fromButton) {
  e.preventDefault();
  e.stopPropagation();
  if (isTouchDevice || window.innerWidth <= 480) {
    showProjectBottomSheet(projectId);
    return;
  }
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';
  const p = projects.find(x => x.id === projectId);
  const archiveLabel = p?.archived ? 'Unarchive' : 'Archive';
  menu.innerHTML = `
    <button onclick="navigateToProject(${projectId})">Open</button>
    <button onclick="duplicateProject(${projectId})">Duplicate</button>
    <button onclick="openProjectModal(${projectId})">Edit</button>
    <button onclick="toggleArchive(${projectId})">${archiveLabel}</button>
    <button class="danger" onclick="deleteProject(${projectId},event)">Delete</button>`;
  document.body.appendChild(menu);
  // Position
  const x = fromButton ? e.currentTarget.getBoundingClientRect().right : e.clientX;
  const y = fromButton ? e.currentTarget.getBoundingClientRect().bottom : e.clientY;
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  const m = document.getElementById('context-menu');
  if (m) m.remove();
}

function navigateToProject(id) { closeContextMenu(); navigate(`#/project/${id}`); }

async function toggleArchive(id) {
  closeContextMenu();
  await PATCH(`/api/projects/${id}/archive`);
  await reloadProjects();
}

async function toggleShowArchived(checked) {
  showArchived = checked;
  await reloadProjects();
}

async function duplicateProject(id) {
  closeContextMenu();
  const dup = await POST(`/api/projects/${id}/duplicate`);
  if (dup) {
    projects.unshift(dup);
    navigate(`#/project/${dup.id}`);
  }
}

/* ================================================================== */
/*  Inline plate editing                                               */
/* ================================================================== */
function startInlineEdit(projectId, plateId, field, currentValue, el, type) {
  if (el.querySelector('input, select')) return; // already editing
  const display = el.textContent;
  let input;
  if (type === 'time') {
    const mins = parseFloat(currentValue) || 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    input = document.createElement('div');
    input.className = 'inline-time-edit';
    input.innerHTML = `<input type="number" min="0" value="${h}" class="inline-input inline-input-sm">h
      <input type="number" min="0" max="59" value="${m}" class="inline-input inline-input-sm">m`;
    el.textContent = '';
    el.appendChild(input);
    const inputs = input.querySelectorAll('input');
    inputs[0].focus();
    inputs[0].select();
    const save = () => {
      const newH = parseInt(inputs[0].value) || 0;
      const newM = parseInt(inputs[1].value) || 0;
      const newMins = newH * 60 + newM;
      if (newMins !== mins) patchPlateField(projectId, plateId, field, newMins);
      else { el.textContent = display; }
    };
    inputs.forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { el.textContent = display; } });
    });
    inputs[1].addEventListener('blur', e => { if (!input.contains(e.relatedTarget)) save(); });
    inputs[0].addEventListener('blur', e => { if (!input.contains(e.relatedTarget)) save(); });
  } else if (type === 'select-printer') {
    input = document.createElement('select');
    input.className = 'inline-input';
    input.innerHTML = '<option value="">--</option>' + printers.map(pr => `<option value="${pr.id}" ${pr.id == currentValue ? 'selected' : ''}>${esc(pr.name)}</option>`).join('');
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.addEventListener('change', () => patchPlateField(projectId, plateId, field, parseInt(input.value) || null));
    input.addEventListener('blur', () => { el.textContent = display; });
  } else if (type === 'select-material') {
    input = document.createElement('select');
    input.className = 'inline-input';
    input.innerHTML = '<option value="">--</option>' + materials.map(m => `<option value="${m.id}" ${m.id == currentValue ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.addEventListener('change', () => patchPlateField(projectId, plateId, field, parseInt(input.value) || null));
    input.addEventListener('blur', () => { el.textContent = display; });
  } else {
    input = document.createElement('input');
    input.type = 'number';
    input.className = 'inline-input';
    input.value = currentValue;
    input.step = type === 'int' ? '1' : '0.01';
    if (type === 'int') input.min = '1';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    const save = () => {
      const v = type === 'int' ? parseInt(input.value) : parseFloat(input.value);
      if (v != currentValue && !isNaN(v)) patchPlateField(projectId, plateId, field, v);
      else el.textContent = display;
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') el.textContent = display; });
    input.addEventListener('blur', save);
  }
}

async function patchPlateField(projectId, plateId, field, value) {
  await PATCH(`/api/projects/${projectId}/plates/${plateId}`, { [field]: value });
  await reloadSingleProject(projectId);
}

/* ================================================================== */
/*  Project actions                                                    */
/* ================================================================== */
function openProjectModal(id = null) {
  editingProjectId = id;
  const p = id ? projects.find(x => x.id === id) : null;
  document.getElementById('project-modal-title').textContent = p ? 'Edit Project' : 'New Project';
  document.getElementById('proj-name').value = p?.name || '';
  document.getElementById('proj-customer').value = p?.customer_name || '';
  document.getElementById('proj-items-per-set').value = p?.items_per_set || 1;
  document.getElementById('proj-tags').value = p?.tags || '';
  openModal('project-modal');
  document.getElementById('proj-name').focus();
}

document.getElementById('btn-save-project').addEventListener('click', async () => {
  const data = {
    name: document.getElementById('proj-name').value.trim(),
    customer_name: document.getElementById('proj-customer').value.trim() || null,
    items_per_set: parseInt(document.getElementById('proj-items-per-set').value) || 1,
    tags: document.getElementById('proj-tags').value.trim(),
  };
  if (!data.name) return;
  if (editingProjectId) {
    const existing = projects.find(x => x.id === editingProjectId);
    data.actual_sales_price = existing?.actual_sales_price || null;
    data.notes = existing?.notes || null;
    await PUT(`/api/projects/${editingProjectId}`, data);
    closeModal('project-modal');
    await reloadSingleProject(editingProjectId);
  } else {
    const created = await POST('/api/projects', data);
    closeModal('project-modal');
    if (created) {
      projects.unshift(created);
      navigate(`#/project/${created.id}`);
    }
  }
});

async function deleteProject(id, e) {
  const anchor = e?.currentTarget || e?.target || document.body;
  if (!await inlineConfirm('Delete this project and all its plates?', anchor)) return;
  await DEL(`/api/projects/${id}`);
  projects = projects.filter(p => p.id !== id);
  navigate('#/');
}

async function updateActualPrice(projectId, value) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  await PUT(`/api/projects/${projectId}`, {
    name: p.name, customer_name: p.customer_name,
    items_per_set: p.items_per_set, tags: p.tags || '', notes: p.notes || null,
    actual_sales_price: value ? parseFloat(value) : null,
  });
  await reloadSingleProject(projectId);
}

function promptActualPrice(projectId, current) {
  const val = prompt('Enter actual sales price (incl. VAT):', current || '');
  if (val !== null) updateActualPrice(projectId, val);
}

/* ================================================================== */
/*  Supplies & Packaging                                               */
/* ================================================================== */
async function addExtraFromSelect(projectId) {
  const sel = document.getElementById(`ec-add-select-${projectId}`);
  const ecId = parseInt(sel?.value);
  if (!ecId) return;
  await updateExtraQty(projectId, ecId, 1);
}

async function updateExtraQty(projectId, extraCostId, quantity) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const currentExtras = {};
  (p.extras || []).forEach(e => { currentExtras[e.extra_cost_id] = e.quantity; });
  currentExtras[extraCostId] = quantity;
  const items = Object.entries(currentExtras).map(([id, qty]) => ({ extra_cost_id: parseInt(id), quantity: qty }));
  await PUT(`/api/projects/${projectId}/extras`, items);
  await reloadSingleProject(projectId);
}

/* ================================================================== */
/*  File uploads                                                       */
/* ================================================================== */
function uploadFile(projectId, input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  input.value = '';

  for (const file of files) {
    // Insert uploading placeholder immediately
    const fileList = document.getElementById(`file-list-${projectId}`);
    if (!fileList) continue;
    // Remove "no files" message if present
    const noFiles = fileList.querySelector('p');
    if (noFiles) noFiles.remove();

    const uploadId = 'upload-' + Math.random().toString(36).slice(2, 8);
    const row = document.createElement('div');
    row.className = 'file-row file-row-uploading';
    row.id = uploadId;
    row.innerHTML = `
      <svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="file-name" style="color:var(--text-muted)">${esc(file.name)}</span>
      <span class="file-size">${fmtFileSize(file.size)}</span>
      <div class="file-progress"><div class="file-progress-bar" id="${uploadId}-bar"></div></div>
      <span class="file-progress-pct" id="${uploadId}-pct">0%</span>`;
    fileList.appendChild(row);

    // Upload via XHR for progress tracking
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${projectId}/files`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', file.name);

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      const bar = document.getElementById(`${uploadId}-bar`);
      const label = document.getElementById(`${uploadId}-pct`);
      if (bar) bar.style.width = pct + '%';
      if (label) label.textContent = pct + '%';
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 401) { window.location.replace('/login'); return; }
      reloadSingleProject(projectId);
    });

    xhr.addEventListener('error', () => {
      const el = document.getElementById(uploadId);
      if (el) el.innerHTML = `<span style="color:var(--danger);font-size:13px">Upload failed: ${esc(file.name)}</span>`;
    });

    xhr.send(file);
  }
}

async function deleteFile(fileId, projectId) {
  await DEL(`/api/files/${fileId}`);
  await reloadSingleProject(projectId);
}

/* ================================================================== */
/*  3MF Import                                                         */
/* ================================================================== */
let import3mfProjectId = null;
let import3mfData = null;
let import3mfFile = null; // { name, buffer }

let import3mfBusy = false;
function import3mf(projectId, input) {
  const file = input.files?.[0];
  if (!file || import3mfBusy) return;
  import3mfBusy = true;
  input.value = '';

  // Show progress in the edit dialog
  document.getElementById('edit-dialog-title').textContent = 'Importing 3MF...';
  document.getElementById('edit-dialog-body').innerHTML = `
    <div style="text-align:center;padding:24px 0">
      <p style="margin-bottom:12px">${esc(file.name)} (${fmtFileSize(file.size)})</p>
      <div class="file-progress" style="width:100%;height:8px;margin:0 auto 8px"><div class="file-progress-bar" id="import-progress-bar"></div></div>
      <span id="import-progress-pct" style="font-size:13px;color:var(--text-muted)">Uploading... 0%</span>
    </div>`;
  document.getElementById('btn-edit-dialog-save').style.display = 'none';
  openModal('edit-dialog');

  const fileBuffer = file;
  import3mfFile = { name: file.name };

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/parse-3mf');
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');

  xhr.upload.addEventListener('progress', e => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    const bar = document.getElementById('import-progress-bar');
    const label = document.getElementById('import-progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = pct < 100 ? `Uploading... ${pct}%` : 'Parsing...';
  });

  xhr.addEventListener('load', async () => {
    document.getElementById('btn-edit-dialog-save').style.display = '';
    if (xhr.status === 401) { import3mfBusy = false; window.location.replace('/login'); return; }
    let parsed;
    try { parsed = JSON.parse(xhr.responseText); } catch { import3mfBusy = false; alert('Failed to parse server response'); closeModal('edit-dialog'); return; }
    if (xhr.status >= 400) { import3mfBusy = false; alert('Failed to parse 3MF: ' + (parsed.error || '')); closeModal('edit-dialog'); return; }
    if (!parsed.plates?.length) { import3mfBusy = false; alert('No plates found in this 3MF file.'); closeModal('edit-dialog'); return; }
    if (!parsed.sliced) { import3mfBusy = false; alert('This 3MF is not sliced. Please slice it first.'); closeModal('edit-dialog'); return; }

    // Store raw buffer for later file upload
    import3mfFile.buffer = await file.arrayBuffer();
    import3mfBusy = false;
    import3mfProjectId = projectId;
    import3mfData = parsed;
    show3mfPreview(parsed);
  });

  xhr.addEventListener('error', () => {
    import3mfBusy = false;
    alert('Upload failed — network error');
    closeModal('edit-dialog');
  });

  xhr.send(file);
}

function show3mfPreview(parsed) {
  const body = document.getElementById('edit-dialog-body');
  const printerLabel = parsed.printerName ? ` (${parsed.printerName})` : '';
  document.getElementById('edit-dialog-title').textContent = `Import from 3MF — ${parsed.plates.length} plate${parsed.plates.length > 1 ? 's' : ''}${printerLabel}`;

  const rows = parsed.plates.map((pl, i) => {
    const typeInfo = pl.filamentType || 'Unknown';
    const vendorInfo = pl.filamentVendors?.length ? pl.filamentVendors.join(', ') : '';
    const nameDefault = pl.plateName || pl.objects.join(', ') || `Plate ${pl.index}`;

    const thumb = parsed.thumbnails?.[pl.index];
    return `<div class="import-plate-row" data-plate-idx="${i}">
      <div class="import-plate-header">
        <label class="toggle"><input type="checkbox" checked data-import-check="${i}"><span class="toggle-slider"></span></label>
        <strong>Plate ${pl.index}</strong>
        <span style="color:var(--text-muted);font-size:12px">${typeInfo}${vendorInfo ? ` / ${vendorInfo}` : ''}</span>
      </div>
      <div class="form-grid" style="margin-top:8px">
        <div class="form-group import-name-group">
          ${thumb ? `<img src="${thumb}" class="import-plate-thumb" alt="" onclick="this.classList.toggle('expanded')">` : ''}
          <div class="import-name-field"><label>Name</label><input type="text" data-import-name="${i}" value="${esc(nameDefault)}"></div>
        </div>
        <div class="form-group"><label>Print Time</label><span style="font-size:14px;font-weight:600;padding:8px 0;display:block">${fmtTime(pl.printTimeMinutes)}</span></div>
        <div class="form-group"><label>Plastic (g)</label><span style="font-size:14px;font-weight:600;padding:8px 0;display:block">${fmtGrams(pl.weightGrams)}</span></div>
        <div class="form-group"><label>Items per Plate</label><input type="number" min="1" value="${pl.objectCount || 1}" data-import-items="${i}"></div>
        <div class="form-group"></div>
        <div class="form-group"><label>Printer</label><select data-import-printer="${i}">
          <option value="">-- Select --</option>
          ${printers.map(pr => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Material</label><select data-import-material="${i}">
          <option value="">-- Select --</option>
          ${materials.map(m => `<option value="${m.id}">${esc(m.name)}${m.color ? ` (${esc(m.color)})` : ''}</option>`).join('')}
        </select></div>
      </div>
      ${pl.filaments.length > 1 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Filaments: ${pl.filaments.map(f => `${f.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${f.color};vertical-align:middle;margin-right:2px"></span>` : ''}${f.usedGrams}g`).join(', ')}</div>` : ''}
    </div>`;
  });

  body.innerHTML = `<div class="import-plates-list">${rows.join('')}</div>`;

  // Auto-select printer: fuzzy match by name (ignore spaces, case, "lab")
  if (parsed.printerName) {
    const norm = s => s.toLowerCase().replace(/[\s\-_]+/g, '').replace('lab', '');
    const pNorm = norm(parsed.printerName);
    const matchedPrinter = printers.find(pr => {
      const n = norm(pr.name);
      return pNorm.includes(n) || n.includes(pNorm);
    });
    if (matchedPrinter) {
      for (let i = 0; i < parsed.plates.length; i++) {
        body.querySelector(`[data-import-printer="${i}"]`).value = matchedPrinter.id;
      }
    }
  }

  // Auto-select material per plate: match by filament type
  for (let i = 0; i < parsed.plates.length; i++) {
    const pl = parsed.plates[i];
    if (pl.filamentType && pl.filamentType !== 'Mixed') {
      const matSel = body.querySelector(`[data-import-material="${i}"]`);
      const match = materials.find(m =>
        m.material_type.toLowerCase().includes(pl.filamentType.toLowerCase()) ||
        pl.filamentType.toLowerCase().includes(m.material_type.split(/\s/)[0].toLowerCase())
      );
      if (match) matSel.value = match.id;
    }
  }

  document.getElementById('btn-edit-dialog-save').onclick = () => confirm3mfImport();
  openModal('edit-dialog');
}

let importSaving = false;
async function confirm3mfImport() {
  if (importSaving) return;
  importSaving = true;

  // Disable button and show progress
  const saveBtn = document.getElementById('btn-edit-dialog-save');
  const origText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Importing...';

  const platesToImport = [];
  for (let i = 0; i < import3mfData.plates.length; i++) {
    const check = document.querySelector(`[data-import-check="${i}"]`);
    if (!check?.checked) continue;
    const pl = import3mfData.plates[i];
    // Build colors from filament data
    const colors = pl.filaments.map(f => {
      const profile = import3mfData.filamentProfiles?.[f.id - 1];
      return {
        color: f.color || '#888888',
        name: hexToName(f.color || '#888888'),
        brand: profile?.vendor && profile.vendor !== 'Generic' ? profile.vendor : '',
      };
    });
    platesToImport.push({
      name: document.querySelector(`[data-import-name="${i}"]`)?.value || `Plate ${pl.index}`,
      print_time_minutes: Math.round(pl.printTimeMinutes),
      plastic_grams: pl.weightGrams,
      items_per_plate: parseInt(document.querySelector(`[data-import-items="${i}"]`)?.value) || 1,
      printer_id: parseInt(document.querySelector(`[data-import-printer="${i}"]`)?.value) || null,
      material_id: parseInt(document.querySelector(`[data-import-material="${i}"]`)?.value) || null,
      colors,
    });
  }

  if (!platesToImport.length) { alert('No plates selected'); saveBtn.disabled = false; saveBtn.textContent = origText; importSaving = false; return; }

  try {
    saveBtn.textContent = 'Creating plates...';
    await POST(`/api/projects/${import3mfProjectId}/import-3mf`, { plates: platesToImport });

    // Also upload the 3MF as a project file (with images extraction)
    if (import3mfFile?.buffer) {
      saveBtn.textContent = 'Uploading 3MF file & extracting images...';
      await fetch(`/api/projects/${import3mfProjectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': import3mfFile.name },
        body: import3mfFile.buffer,
      });
      import3mfFile = null;
    }

    closeModal('edit-dialog');
    await reloadSingleProject(import3mfProjectId);
  } catch (err) {
    alert('Import failed: ' + err.message);
  } finally {
    importSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = origText;
  }
}

/* ================================================================== */
/*  Plate actions                                                      */
/* ================================================================== */
function openPlateModal(projectId, plateId = null) {
  editingPlateProjectId = projectId;
  editingPlateId = plateId;
  const p = projects.find(x => x.id === projectId);
  const plate = plateId ? p?.plates?.find(x => x.id === plateId) : null;

  document.getElementById('plate-modal-title').textContent = plate ? 'Edit Plate' : 'Add Plate';
  const printerSel = document.getElementById('plate-printer');
  printerSel.innerHTML = '<option value="">-- Select --</option>' +
    printers.map(pr => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('');
  const matSel = document.getElementById('plate-material');
  matSel.innerHTML = '<option value="">-- Select --</option>' +
    materials.map(m => `<option value="${m.id}">${esc(m.name)}${m.color ? ` (${esc(m.color)})` : ''} - ${fmtWeight(m.roll_weight_g)}</option>`).join('');

  if (plate) {
    document.getElementById('plate-name').value = plate.name || '';
    document.getElementById('plate-hours').value = Math.floor(plate.print_time_minutes / 60);
    document.getElementById('plate-minutes').value = Math.round(plate.print_time_minutes % 60);
    document.getElementById('plate-plastic').value = plate.plastic_grams;
    document.getElementById('plate-items').value = plate.items_per_plate;
    document.getElementById('plate-risk').value = plate.risk_multiplier;
    document.getElementById('plate-waste').value = plate.material_waste_grams;
    document.getElementById('plate-pre').value = plate.pre_processing_minutes;
    document.getElementById('plate-post').value = plate.post_processing_minutes;
    document.getElementById('plate-notes').value = plate.notes || '';
    printerSel.value = plate.printer_id || '';
    matSel.value = plate.material_id || '';
    document.getElementById('plate-colors-editor').innerHTML = renderColorEditor(plate.colors || [], 'plate-colors');
  } else {
    const last = p?.plates?.[p.plates.length - 1];
    document.getElementById('plate-name').value = '';
    document.getElementById('plate-hours').value = 0;
    document.getElementById('plate-minutes').value = 0;
    document.getElementById('plate-plastic').value = 0;
    document.getElementById('plate-items').value = 1;
    document.getElementById('plate-risk').value = last?.risk_multiplier || 1;
    document.getElementById('plate-waste').value = last?.material_waste_grams || 0;
    document.getElementById('plate-pre').value = last?.pre_processing_minutes || 0;
    document.getElementById('plate-post').value = last?.post_processing_minutes ?? 2;
    document.getElementById('plate-notes').value = '';
    printerSel.value = last?.printer_id || '';
    matSel.value = last?.material_id || '';
    document.getElementById('plate-colors-editor').innerHTML = renderColorEditor([], 'plate-colors');
  }
  openModal('plate-modal');
  document.getElementById('plate-name').focus();
}

document.getElementById('btn-save-plate').addEventListener('click', async () => {
  const hours = parseInt(document.getElementById('plate-hours').value) || 0;
  const mins = parseInt(document.getElementById('plate-minutes').value) || 0;
  const data = {
    name: document.getElementById('plate-name').value.trim() || null,
    print_time_minutes: hours * 60 + mins,
    plastic_grams: parseFloat(document.getElementById('plate-plastic').value) || 0,
    items_per_plate: parseInt(document.getElementById('plate-items').value) || 1,
    risk_multiplier: parseFloat(document.getElementById('plate-risk').value) || 1,
    material_waste_grams: parseFloat(document.getElementById('plate-waste').value) || 0,
    pre_processing_minutes: parseFloat(document.getElementById('plate-pre').value) || 0,
    post_processing_minutes: parseFloat(document.getElementById('plate-post').value) || 0,
    printer_id: parseInt(document.getElementById('plate-printer').value) || null,
    material_id: parseInt(document.getElementById('plate-material').value) || null,
    notes: document.getElementById('plate-notes').value.trim() || null,
    colors: collectColors('plate-colors'),
  };
  if (editingPlateId) {
    await PUT(`/api/projects/${editingPlateProjectId}/plates/${editingPlateId}`, data);
  } else {
    await POST(`/api/projects/${editingPlateProjectId}/plates`, data);
  }
  closeModal('plate-modal');
  await reloadSingleProject(editingPlateProjectId);
});

async function duplicatePlate(projectId, plateId) {
  const p = projects.find(x => x.id === projectId);
  const plate = p?.plates?.find(x => x.id === plateId);
  if (!plate) return;
  await POST(`/api/projects/${projectId}/plates`, {
    name: plate.name ? `${plate.name} (copy)` : null,
    print_time_minutes: plate.print_time_minutes,
    plastic_grams: plate.plastic_grams,
    items_per_plate: plate.items_per_plate,
    risk_multiplier: plate.risk_multiplier,
    pre_processing_minutes: plate.pre_processing_minutes,
    post_processing_minutes: plate.post_processing_minutes,
    printer_id: plate.printer_id,
    material_id: plate.material_id,
    material_waste_grams: plate.material_waste_grams,
    notes: plate.notes,
    colors: plate.colors || [],
    enabled: plate.enabled,
  });
  await reloadSingleProject(projectId);
}

async function togglePlate(projectId, plateId) {
  await PATCH(`/api/projects/${projectId}/plates/${plateId}/toggle`);
  await reloadSingleProject(projectId);
}

async function deletePlate(projectId, plateId, e) {
  const anchor = e?.currentTarget || e?.target || document.body;
  if (!await inlineConfirm('Delete this plate?', anchor)) return;
  await DEL(`/api/projects/${projectId}/plates/${plateId}`);
  await reloadSingleProject(projectId);
}

/* ================================================================== */
/*  Settings (unchanged)                                               */
/* ================================================================== */
let activeSettingsTab = 'general';

document.getElementById('btn-settings').addEventListener('click', () => {
  renderSettingsTab(activeSettingsTab);
  openModal('settings-modal');
});

document.querySelector('.settings-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  activeSettingsTab = tab.dataset.tab;
  document.querySelectorAll('.settings-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeSettingsTab));
  renderSettingsTab(activeSettingsTab);
});

function renderSettingsTab(tab) {
  const el = document.getElementById('settings-content');
  switch (tab) {
    case 'general': el.innerHTML = renderGeneralSettings(); break;
    case 'printers': el.innerHTML = renderPrintersSettings(); break;
    case 'materials': el.innerHTML = renderMaterialsSettings(); break;
    case 'extras': el.innerHTML = renderExtrasSettings(); break;
    case 'margins': el.innerHTML = renderMarginsSettings(); break;
    case 'theme': el.innerHTML = renderThemeSettings(); break;
  }
}

function renderGeneralSettings() {
  return `
    <div class="settings-row"><label>Hourly Rate (${settings.currency_symbol || '\u20ac'})</label>
      <input type="number" value="${settings.hourly_rate || 40}" step="0.01" onchange="saveSetting('hourly_rate', this.value)"></div>
    <div class="settings-row"><label>Electricity Price (${settings.currency_symbol || '\u20ac'}/kWh)</label>
      <input type="number" value="${settings.electricity_price_kwh || 0.40}" step="0.01" onchange="saveSetting('electricity_price_kwh', this.value)"></div>
    <div class="settings-row"><label>VAT Rate (%)</label>
      <input type="number" value="${settings.vat_rate || 21}" step="0.1" onchange="saveSetting('vat_rate', this.value)"></div>
    <div class="settings-row"><label>Price Rounding</label>
      <input type="number" value="${settings.price_rounding || 0.99}" step="0.01" min="0" max="0.99" onchange="saveSetting('price_rounding', this.value)"></div>
    <div class="settings-row"><label>Currency Symbol</label>
      <input type="text" value="${settings.currency_symbol || '\u20ac'}" style="width:60px" onchange="saveSetting('currency_symbol', this.value)"></div>`;
}
function renderMarginsSettings() {
  return `
    <div class="settings-row"><label>Material Profit (%)</label>
      <input type="number" value="${settings.material_profit_pct || 0}" step="1" onchange="saveSetting('material_profit_pct', this.value)"></div>
    <div class="settings-row"><label>Processing Profit (%)</label>
      <input type="number" value="${settings.processing_profit_pct || 0}" step="1" onchange="saveSetting('processing_profit_pct', this.value)"></div>
    <div class="settings-row"><label>Electricity Margin (%)</label>
      <input type="number" value="${settings.electricity_profit_pct || 0}" step="1" onchange="saveSetting('electricity_profit_pct', this.value)"></div>
    <div class="settings-row"><label>Printer Cost Margin (%)</label>
      <input type="number" value="${settings.printer_cost_profit_pct || 0}" step="1" onchange="saveSetting('printer_cost_profit_pct', this.value)"></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">
    <div class="settings-row"><label>Green Margin Threshold (%)</label>
      <input type="number" value="${settings.margin_green_pct || 30}" step="1" onchange="saveSetting('margin_green_pct', this.value)"></div>
    <div class="settings-row"><label>Orange Margin Threshold (%)</label>
      <input type="number" value="${settings.margin_orange_pct || 5}" step="1" onchange="saveSetting('margin_orange_pct', this.value)"></div>`;
}
function renderThemeSettings() {
  const current = settings.theme || 'system';
  return `<div class="settings-row"><label>Theme</label><select onchange="saveTheme(this.value)">
    <option value="system" ${current === 'system' ? 'selected' : ''}>System</option>
    <option value="light" ${current === 'light' ? 'selected' : ''}>Light</option>
    <option value="dark" ${current === 'dark' ? 'selected' : ''}>Dark</option></select></div>`;
}
function renderPrintersSettings() {
  let html = printers.map(p => `<div class="settings-list-item"><div>
    <div class="name">${esc(p.name)}</div>
    <div class="meta">${fmt(p.purchase_price)} | ${p.expected_prints} prints | ${p.earn_back_months}mo payback${p.electricity?.map(e => ` | ${e.material_type}: ${e.kwh_per_hour} kWh`).join('') || ''}</div>
  </div><div style="display:flex;gap:4px">
    <button class="btn btn-sm" onclick="editPrinter(${p.id})">Edit</button>
    <button class="btn btn-sm btn-danger" onclick="deletePrinterItem(${p.id},event)">Del</button>
  </div></div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editPrinter(null)">+ Add Printer</button></div>`;
  return html;
}
window.editPrinter = function(id) {
  const p = id ? printers.find(x => x.id === id) : null;
  const elecRows = (p?.electricity || [{ material_type: 'PLA', kwh_per_hour: 0.11 }])
    .map((e) => `<div class="elec-profile-row"><input type="text" value="${e.material_type}" placeholder="Material type"><input type="number" value="${e.kwh_per_hour}" step="0.01" placeholder="kWh/h"><button class="btn-icon" onclick="this.parentElement.remove()" title="Remove">&times;</button></div>`).join('');
  document.getElementById('edit-dialog-title').textContent = p ? 'Edit Printer' : 'Add Printer';
  document.getElementById('edit-dialog-body').innerHTML = `<div class="form-grid">
    <div class="form-group"><label>Name</label><input type="text" id="pe-name" value="${esc(p?.name || '')}"></div>
    <div class="form-group"><label>Purchase Price</label><input type="number" id="pe-price" step="0.01" value="${p?.purchase_price || 0}"></div>
    <div class="form-group"><label>Expected Prints</label><input type="number" id="pe-prints" value="${p?.expected_prints || 5000}"></div>
    <div class="form-group"><label>Payback Months</label><input type="number" id="pe-months" value="${p?.earn_back_months || 24}"></div>
  </div><label style="margin-top:12px">Electricity Profiles</label><div id="pe-elec">${elecRows}</div>
  <button class="btn btn-sm" style="margin-top:4px" onclick="addElecRow()">+ Profile</button>`;
  document.getElementById('btn-edit-dialog-save').onclick = () => savePrinter(id);
  openModal('edit-dialog');
};
window.addElecRow = function() { const d = document.createElement('div'); d.className='elec-profile-row'; d.innerHTML=`<input type="text" value="PLA" placeholder="Material type"><input type="number" value="0.11" step="0.01" placeholder="kWh/h"><button class="btn-icon" onclick="this.parentElement.remove()" title="Remove">&times;</button>`; document.getElementById('pe-elec').appendChild(d); };
window.savePrinter = async function(id) {
  const electricity = []; document.querySelectorAll('#pe-elec .elec-profile-row').forEach(row => { const inputs = row.querySelectorAll('input'); electricity.push({ material_type: inputs[0].value, kwh_per_hour: parseFloat(inputs[1].value) || 0 }); });
  const data = { name: document.getElementById('pe-name').value.trim(), purchase_price: parseFloat(document.getElementById('pe-price').value)||0, expected_prints: parseInt(document.getElementById('pe-prints').value)||5000, earn_back_months: parseInt(document.getElementById('pe-months').value)||24, electricity };
  if (!data.name) return;
  if (id) await PUT(`/api/printers/${id}`, data); else await POST('/api/printers', data);
  closeModal('edit-dialog'); printers = await GET('/api/printers'); renderSettingsTab('printers'); await reloadProjects();
};
window.deletePrinterItem = async function(id, e) { const a = e?.currentTarget||e?.target||document.body; if (!await inlineConfirm('Delete this printer?', a)) return; await DEL(`/api/printers/${id}`); printers = await GET('/api/printers'); renderSettingsTab('printers'); };

function renderMaterialsSettings() {
  let html = materials.map(m => `<div class="settings-list-item"><div>
    <div class="name">${esc(m.name)}${m.color ? ` <span style="color:var(--text-muted)">(${esc(m.color)})</span>`:''}</div>
    <div class="meta">${m.material_type} | ${fmt(m.price_per_kg)}/kg | ${fmtWeight(m.roll_weight_g)} roll</div>
  </div><div style="display:flex;gap:4px">
    <button class="btn btn-sm" onclick="showPriceImpact(${m.id})">What-if</button>
    <button class="btn btn-sm" onclick="editMaterial(${m.id})">Edit</button>
    <button class="btn btn-sm btn-danger" onclick="deleteMaterialItem(${m.id},event)">Del</button>
  </div></div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editMaterial(null)">+ Add Material</button></div>`;
  return html;
}
window.editMaterial = function(id) {
  const m = id ? materials.find(x => x.id === id) : null;
  document.getElementById('edit-dialog-title').textContent = m ? 'Edit Material' : 'Add Material';
  document.getElementById('edit-dialog-body').innerHTML = `<div class="form-grid">
    <div class="form-group"><label>Name</label><input type="text" id="me-name" value="${esc(m?.name || '')}"></div>
    <div class="form-group"><label>Material Type</label><input type="text" id="me-type" value="${esc(m?.material_type || 'PLA')}"></div>
    <div class="form-group"><label>Color (empty = generic)</label><input type="text" id="me-color" value="${esc(m?.color || '')}"></div>
    <div class="form-group"><label>Price/kg (excl. VAT)</label><input type="number" id="me-price" step="0.01" value="${m?.price_per_kg || 0}"></div>
    <div class="form-group"><label>Roll Weight (g)</label><input type="number" id="me-weight" value="${m?.roll_weight_g || 1000}"></div>
  </div>`;
  document.getElementById('btn-edit-dialog-save').onclick = () => saveMaterial(id);
  openModal('edit-dialog');
};
window.saveMaterial = async function(id) {
  const data = { name: document.getElementById('me-name').value.trim(), material_type: document.getElementById('me-type').value.trim()||'PLA', color: document.getElementById('me-color').value.trim()||null, price_per_kg: parseFloat(document.getElementById('me-price').value)||0, roll_weight_g: parseInt(document.getElementById('me-weight').value)||1000 };
  if (!data.name) return;
  if (id) await PUT(`/api/materials/${id}`, data); else await POST('/api/materials', data);
  closeModal('edit-dialog'); materials = await GET('/api/materials'); renderSettingsTab('materials'); await reloadProjects();
};
window.showPriceImpact = async function(materialId) {
  const m = materials.find(x => x.id === materialId);
  if (!m) return;
  document.getElementById('edit-dialog-title').textContent = `Price Impact: ${m.name}`;
  document.getElementById('edit-dialog-body').innerHTML = `
    <div class="price-impact-form">
      <p style="margin-bottom:12px">Simulate a price change for <strong>${esc(m.name)}</strong> and see how it affects all projects using this material.</p>
      <div class="settings-row"><label>Current price/kg</label><span style="font-weight:600">${fmt(m.price_per_kg)}</span></div>
      <div class="settings-row"><label>New price/kg</label><input type="number" id="pi-new-price" step="0.01" value="${m.price_per_kg}"></div>
      <div style="margin-top:12px"><button class="btn btn-primary" onclick="runPriceImpact(${materialId})">Simulate</button></div>
    </div>
    <div id="pi-results"></div>`;
  document.getElementById('btn-edit-dialog-save').onclick = () => closeModal('edit-dialog');
  document.getElementById('btn-edit-dialog-save').textContent = 'Close';
  openModal('edit-dialog');
};

let priceImpactData = null;
let priceImpactShowArchived = false;

window.runPriceImpact = async function(materialId) {
  const newPrice = parseFloat(document.getElementById('pi-new-price').value);
  if (isNaN(newPrice)) return;
  priceImpactData = await POST(`/api/materials/${materialId}/price-impact`, { new_price_per_kg: newPrice });
  priceImpactShowArchived = false;
  renderPriceImpactResults();
};

window.togglePiArchived = function(checked) {
  priceImpactShowArchived = checked;
  renderPriceImpactResults();
};

function renderPriceImpactResults() {
  const el = document.getElementById('pi-results');
  const result = priceImpactData;
  if (!result) return;
  const filtered = priceImpactShowArchived ? result.impacts : result.impacts.filter(i => !i.archived);
  const archivedHidden = result.impacts.length - filtered.length;
  if (!filtered.length && !archivedHidden) {
    el.innerHTML = '<p style="color:var(--text-muted);margin-top:12px">No projects use this material.</p>';
    return;
  }
  const diff = result.material.newPrice - result.material.oldPrice;
  const diffLabel = diff > 0 ? `+${fmt(diff)}` : fmt(diff);
  el.innerHTML = `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h4>${filtered.length} project${filtered.length !== 1 ? 's' : ''} affected (${diffLabel}/kg)</h4>
        ${archivedHidden || priceImpactShowArchived ? `<label class="archive-toggle"><input type="checkbox" ${priceImpactShowArchived ? 'checked' : ''} onchange="togglePiArchived(this.checked)"> Include archived (${archivedHidden})</label>` : ''}
      </div>
      ${filtered.length ? `<table class="ec-table">
        <thead><tr><th>Project</th><th>Production</th><th>Suggested</th><th>Margin</th><th>Change</th></tr></thead>
        <tbody>${filtered.map(i => {
          const marginDiff = (i.simulated.marginPct || 0) - (i.current.marginPct || 0);
          const indicator = marginDiff < -2 ? 'red' : marginDiff < 0 ? 'orange' : 'green';
          return `<tr${i.archived ? ' style="opacity:.5"' : ''}>
            <td>${esc(i.projectName)}${i.archived ? ' <span class="archived-badge">ARCHIVED</span>' : ''}</td>
            <td class="num">${fmt(i.current.productionCost)} → ${fmt(i.simulated.productionCost)}</td>
            <td class="num">${fmt(i.current.suggestedPrice)} → ${fmt(i.simulated.suggestedPrice)}</td>
            <td class="num"><span class="margin-badge ${indicator}">${fmtPct(i.simulated.marginPct)}</span></td>
            <td class="num" style="color:var(--${indicator})">${marginDiff > 0 ? '+' : ''}${marginDiff.toFixed(2)}%</td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<p style="color:var(--text-muted)">No active projects affected.</p>'}
    </div>`;
}

window.deleteMaterialItem = async function(id, e) { const a = e?.currentTarget||e?.target||document.body; if (!await inlineConfirm('Delete this material?', a)) return; await DEL(`/api/materials/${id}`); materials = await GET('/api/materials'); renderSettingsTab('materials'); };

function renderExtrasSettings() {
  let html = extraCostItems.map(e => `<div class="settings-list-item"><div>
    <div class="name">${esc(e.name)}</div>
    <div class="meta">${fmt(e.price_excl_vat)} excl. VAT | Default: ${e.default_included ? `Yes (qty ${e.default_quantity})` : 'No'}</div>
  </div><div style="display:flex;gap:4px">
    <button class="btn btn-sm" onclick="editExtraCost(${e.id})">Edit</button>
    <button class="btn btn-sm btn-danger" onclick="deleteExtraCostItem(${e.id},event)">Del</button>
  </div></div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editExtraCost(null)">+ Add Supply</button></div>`;
  return html;
}
window.editExtraCost = function(id) {
  const e = id ? extraCostItems.find(x => x.id === id) : null;
  document.getElementById('edit-dialog-title').textContent = e ? 'Edit Supply' : 'Add Supply';
  document.getElementById('edit-dialog-body').innerHTML = `<div class="form-grid">
    <div class="form-group"><label>Name</label><input type="text" id="ee-name" value="${esc(e?.name || '')}"></div>
    <div class="form-group"><label>Price excl. VAT</label><input type="number" id="ee-price" step="0.01" value="${e?.price_excl_vat || 0}"></div>
    <div class="form-group"><label>Default Included</label><label class="toggle"><input type="checkbox" id="ee-default" ${e?.default_included ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
    <div class="form-group"><label>Default Quantity</label><input type="number" id="ee-qty" min="1" value="${e?.default_quantity || 1}"></div>
  </div>`;
  document.getElementById('btn-edit-dialog-save').onclick = () => saveExtraCost(id);
  openModal('edit-dialog');
};
window.saveExtraCost = async function(id) {
  const data = { name: document.getElementById('ee-name').value.trim(), price_excl_vat: parseFloat(document.getElementById('ee-price').value)||0, default_included: document.getElementById('ee-default').checked, default_quantity: parseInt(document.getElementById('ee-qty').value)||1 };
  if (!data.name) return;
  if (id) await PUT(`/api/extra-costs/${id}`, data); else await POST('/api/extra-costs', data);
  closeModal('edit-dialog'); extraCostItems = await GET('/api/extra-costs'); renderSettingsTab('extras');
};
window.deleteExtraCostItem = async function(id, e) { const a = e?.currentTarget||e?.target||document.body; if (!await inlineConfirm('Delete this item?', a)) return; await DEL(`/api/extra-costs/${id}`); extraCostItems = await GET('/api/extra-costs'); renderSettingsTab('extras'); };

/* ================================================================== */
/*  Settings save helpers                                              */
/* ================================================================== */
async function saveSetting(key, value) {
  const numericKeys = ['hourly_rate', 'electricity_price_kwh', 'vat_rate', 'price_rounding',
    'material_profit_pct', 'processing_profit_pct', 'electricity_profit_pct', 'printer_cost_profit_pct',
    'margin_green_pct', 'margin_orange_pct'];
  const val = numericKeys.includes(key) ? parseFloat(value) : value;
  await PUT(`/api/settings/${key}`, { value: val });
  settings[key] = val;
  await reloadProjects();
}
async function saveTheme(value) { await PUT(`/api/settings/theme`, { value }); settings.theme = value; applyTheme(value); }

/* ================================================================== */
/*  Utility                                                            */
/* ================================================================== */
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function inlineConfirm(message, anchorEl) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-popover').forEach(e => e.remove());
    const pop = document.createElement('div');
    pop.className = 'confirm-popover';
    pop.innerHTML = `<div class="confirm-popover-msg">${esc(message)}</div>
      <div class="confirm-popover-actions">
        <button class="btn btn-sm btn-danger confirm-popover-yes">Delete</button>
        <button class="btn btn-sm confirm-popover-no">Cancel</button>
      </div>`;
    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - 110;
    let top = rect.bottom + 6;
    if (left + 220 > window.innerWidth - 8) left = window.innerWidth - 228;
    if (left < 8) left = 8;
    if (top + 80 > window.innerHeight) top = rect.top - 80;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    const cleanup = (result) => { pop.remove(); resolve(result); };
    pop.querySelector('.confirm-popover-yes').addEventListener('click', () => cleanup(true));
    pop.querySelector('.confirm-popover-no').addEventListener('click', () => cleanup(false));
    setTimeout(() => {
      const dismiss = (e) => { if (!pop.contains(e.target)) { cleanup(false); document.removeEventListener('click', dismiss); } };
      document.addEventListener('click', dismiss);
    }, 10);
  });
}

function renderColorSwatches(colors) {
  if (!colors || !colors.length) return '';
  return `<div class="color-swatches">${colors.map(c =>
    `<span class="color-swatch" style="background:${esc(c.color)}" title="${esc(c.name || c.color)}${c.brand ? ` (${esc(c.brand)})` : ''}"></span>`
  ).join('')}</div>`;
}

function renderColorEditor(colors, idPrefix) {
  const list = (colors || []).map((c, i) => renderColorRow(c, i, idPrefix)).join('');
  return `<div id="${idPrefix}-list">${list}</div>
    <button class="btn btn-sm" type="button" style="margin-top:4px" onclick="addColorRow('${idPrefix}')">+ Add Color</button>`;
}

function renderColorRow(c, i, idPrefix) {
  return `<div class="color-edit-row" data-color-idx="${i}">
    <input type="color" value="${c.color || '#888888'}" data-cfield="color" class="color-picker">
    <input type="text" value="${esc(c.name || '')}" placeholder="Name (auto)" data-cfield="name" class="color-name-input">
    <input type="text" value="${esc(c.brand || '')}" placeholder="Brand" data-cfield="brand" class="color-brand-input">
    <button class="btn-icon" type="button" onclick="this.closest('.color-edit-row').remove()" title="Remove">&times;</button>
  </div>`;
}

function addColorRow(idPrefix) {
  const list = document.getElementById(`${idPrefix}-list`);
  const i = list.children.length;
  const div = document.createElement('div');
  div.className = 'color-edit-row';
  div.dataset.colorIdx = i;
  div.innerHTML = `<input type="color" value="#888888" data-cfield="color" class="color-picker">
    <input type="text" value="" placeholder="Name (auto)" data-cfield="name" class="color-name-input">
    <input type="text" value="" placeholder="Brand" data-cfield="brand" class="color-brand-input">
    <button class="btn-icon" type="button" onclick="this.closest('.color-edit-row').remove()" title="Remove">&times;</button>`;
  list.appendChild(div);
}

function collectColors(idPrefix) {
  const rows = document.querySelectorAll(`#${idPrefix}-list .color-edit-row`);
  return Array.from(rows).map(row => {
    const color = row.querySelector('[data-cfield="color"]').value;
    const name = row.querySelector('[data-cfield="name"]').value.trim();
    const brand = row.querySelector('[data-cfield="brand"]').value.trim();
    return { color, name: name || hexToName(color), brand };
  });
}

// Color naming via ntc.js (Name that Color — 1566 colors, HSL-based matching)
function hexToName(hex) {
  if (!hex) return '';
  try {
    const result = ntc.name(hex);
    return result[1] || hex; // result[1] is the color name
  } catch { return hex; }
}

function renderTagsPills(tags) {
  if (!tags) return '';
  const list = tags.split(',').map(t => t.trim()).filter(Boolean);
  if (!list.length) return '';
  return `<div class="tags-list">${list.map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>`;
}

/* ================================================================== */
/*  Touch & bottom sheet                                               */
/* ================================================================== */
let isTouchDevice = false;
document.addEventListener('touchstart', () => { isTouchDevice = true; }, { once: true, passive: true });

function showBottomSheet(html) {
  const overlay = document.getElementById('bottom-sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  document.getElementById('bottom-sheet-content').innerHTML = html;
  overlay.classList.add('open');
  sheet.offsetHeight; // force reflow
  sheet.classList.add('open');
  overlay.addEventListener('click', hideBottomSheet, { once: true });
}

function hideBottomSheet() {
  document.getElementById('bottom-sheet').classList.remove('open');
  document.getElementById('bottom-sheet-overlay').classList.remove('open');
}

// Swipe down to dismiss
(function() {
  const sheet = document.getElementById('bottom-sheet');
  let startY = 0;
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (e.touches[0].clientY - startY > 60) hideBottomSheet();
  }, { passive: true });
})();

function addLongPress(el, callback, duration = 500) {
  let timer = null, triggered = false;
  el.addEventListener('touchstart', e => {
    triggered = false;
    timer = setTimeout(() => { triggered = true; if (navigator.vibrate) navigator.vibrate(30); callback(e); }, duration);
  }, { passive: true });
  el.addEventListener('touchmove', () => { if (timer) { clearTimeout(timer); timer = null; } }, { passive: true });
  el.addEventListener('touchend', e => { if (timer) { clearTimeout(timer); timer = null; } if (triggered) { e.preventDefault(); triggered = false; } });
  el.addEventListener('touchcancel', () => { if (timer) { clearTimeout(timer); timer = null; } triggered = false; }, { passive: true });
}

// After render, attach long-press to project cards
function attachLongPress() {
  document.querySelectorAll('.summary-card[data-project-id]').forEach(el => {
    addLongPress(el, () => {
      const id = parseInt(el.dataset.projectId);
      showProjectBottomSheet(id);
    });
  });
}

function showProjectBottomSheet(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const archiveLabel = p.archived ? 'Unarchive' : 'Archive';
  showBottomSheet(`
    <div class="bottom-sheet-header">${esc(p.name)}</div>
    <button class="bottom-sheet-item" onclick="hideBottomSheet();navigateToProject(${projectId})">Open</button>
    <button class="bottom-sheet-item" onclick="hideBottomSheet();duplicateProject(${projectId})">Duplicate</button>
    <button class="bottom-sheet-item" onclick="hideBottomSheet();openProjectModal(${projectId})">Edit</button>
    <button class="bottom-sheet-item" onclick="hideBottomSheet();toggleArchive(${projectId})">${archiveLabel}</button>
    <button class="bottom-sheet-item danger" onclick="hideBottomSheet();deleteProject(${projectId},event)">Delete</button>
  `);
}

/* ================================================================== */
/*  Topbar                                                             */
/* ================================================================== */
document.getElementById('btn-new-project').addEventListener('click', () => openProjectModal());
document.getElementById('btn-logout').addEventListener('click', async () => { await POST('/logout'); window.location.replace('/login'); });

/* ================================================================== */
/*  Init                                                               */
/* ================================================================== */
loadAll();
