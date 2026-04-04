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
let extrasProjectId = null;
let openProjects = new Set();

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

/* ================================================================== */
/*  Formatting helpers                                                 */
/* ================================================================== */
function fmt(n, decimals = 2) {
  const sym = settings.currency_symbol || '\u20ac';
  return `${sym}${Number(n || 0).toFixed(decimals)}`;
}

function fmtPct(n) {
  return `${Number(n || 0).toFixed(2)}%`;
}

function fmtTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  }
});

/* ================================================================== */
/*  Data loading                                                       */
/* ================================================================== */
async function loadAll() {
  [projects, printers, materials, extraCostItems, settings] = await Promise.all([
    GET('/api/projects'),
    GET('/api/printers'),
    GET('/api/materials'),
    GET('/api/extra-costs'),
    GET('/api/settings'),
  ]);
  applyTheme(settings.theme || 'system');
  renderProjects();
}

async function reloadProjects() {
  projects = await GET('/api/projects');
  renderProjects();
}

/* ================================================================== */
/*  Render Projects                                                    */
/* ================================================================== */
function renderProjects() {
  const el = document.getElementById('projects-list');
  if (!projects || projects.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <h2>No projects yet</h2>
      <p>Create your first 3D printing project to start calculating costs and pricing.</p>
      <button class="btn btn-primary" onclick="openProjectModal()">+ New Project</button>
    </div>`;
    return;
  }

  el.innerHTML = projects.map(p => renderProjectCard(p)).join('');
}

function renderProjectCard(p) {
  const c = p.calculation;
  const pricing = c?.pricing || {};
  const indicator = p.actual_sales_price ? c?.actualIndicator : c?.suggestedIndicator;
  const displayPrice = p.actual_sales_price || pricing.suggestedPrice || 0;
  const isOpen = openProjects.has(p.id);
  const sym = settings.currency_symbol || '\u20ac';

  return `
  <div class="project-card ${isOpen ? 'open' : ''}" data-id="${p.id}">
    <div class="project-header" onclick="toggleProject(${p.id})">
      <div class="project-header-left">
        <svg class="project-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span class="project-name">${esc(p.name)}</span>
        ${p.customer_name ? `<span class="project-customer">- ${esc(p.customer_name)}</span>` : ''}
        ${p.items_per_set > 1 ? `<span class="project-customer">(set of ${p.items_per_set})</span>` : ''}
      </div>
      <div class="project-header-right">
        <span class="project-price-badge ${indicator || 'green'}">${fmt(displayPrice)}</span>
      </div>
    </div>
    <div class="project-body">
      ${renderPlatesSection(p)}
      ${renderCostSection(p)}
      ${renderExtrasSection(p)}
      ${renderPricingSection(p)}
      <div class="project-actions">
        <button class="btn btn-sm" onclick="openProjectModal(${p.id})">Edit Project</button>
        <button class="btn btn-sm" onclick="openPlateModal(${p.id})">+ Add Plate</button>
        <button class="btn btn-sm" onclick="openExtrasModal(${p.id})">Edit Extra Costs</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProject(${p.id})">Delete Project</button>
      </div>
    </div>
  </div>`;
}

function renderPlatesSection(p) {
  if (!p.plates || p.plates.length === 0) {
    return `<div class="plates-section"><p style="color:var(--text-muted)">No plates yet. Add a plate to start calculating.</p></div>`;
  }
  const sym = settings.currency_symbol || '\u20ac';
  const rows = p.plates.map((pl, i) => {
    const pb = p.calculation?.plateBreakdowns?.[i];
    const cls = pl.included ? '' : 'excluded';
    return `<tr class="${cls}">
      <td>${esc(pl.name || `Plate ${i + 1}`)}</td>
      <td class="num">${fmtTime(pl.print_time_minutes)}</td>
      <td class="num">${Number(pl.plastic_grams).toFixed(1)}g</td>
      <td class="num">${pl.items_per_plate}</td>
      <td class="num">${pl.risk_multiplier}</td>
      <td>${esc(pl.printer_name || '-')}</td>
      <td>${esc(pl.material_name || '-')}</td>
      <td class="num">${fmt(pb?.materialCost)}</td>
      <td class="num">${fmt(pb?.processingCost)}</td>
      <td class="num">${fmt(pb?.electricityCost)}</td>
      <td class="num">${fmt(pb?.printerUsageCost)}</td>
      <td class="num" style="font-weight:600">${fmt(pb?.totalPlateCost)}</td>
      <td>
        <div class="plate-actions">
          <button class="btn-icon" title="Edit" onclick="openPlateModal(${p.id}, ${pl.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon" title="Delete" onclick="deletePlate(${p.id}, ${pl.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  });

  return `<div class="plates-section">
    <div class="plates-section-header">
      <h3>Print Plates</h3>
    </div>
    <div class="plates-table-wrap">
      <table class="plates-table">
        <thead><tr>
          <th>Name</th><th>Time</th><th>Plastic</th><th>#/Plate</th><th>Risk</th>
          <th>Printer</th><th>Material</th>
          <th>Material</th><th>Process.</th><th>Electric.</th><th>Printer</th><th>Total</th>
          <th></th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function renderCostSection(p) {
  const c = p.calculation;
  if (!c || !p.plates?.length) return '';
  const pi = c.perItemCosts;
  const pr = c.profits;
  const itemLabel = p.items_per_set > 1 ? `/set of ${p.items_per_set}` : '/item';

  return `<div class="cost-section">
    <div class="cost-grid">
      <div class="cost-card">
        <h4>Material Cost</h4>
        <div class="value">${fmt(pi.materialCost * p.items_per_set)}</div>
        <div class="detail">+ ${fmtPct(settings.material_profit_pct)} profit: ${fmt(pr.materialProfit * p.items_per_set)}</div>
      </div>
      <div class="cost-card">
        <h4>Processing Cost</h4>
        <div class="value">${fmt(pi.processingCost * p.items_per_set)}</div>
        <div class="detail">+ ${fmtPct(settings.processing_profit_pct)} profit: ${fmt(pr.processingProfit * p.items_per_set)}</div>
      </div>
      <div class="cost-card">
        <h4>Electricity Cost</h4>
        <div class="value">${fmt(pi.electricityCost * p.items_per_set)}</div>
        <div class="detail">+ ${fmtPct(settings.electricity_profit_pct)} profit: ${fmt(pr.electricityProfit * p.items_per_set)}</div>
      </div>
      <div class="cost-card">
        <h4>Printer Usage Cost</h4>
        <div class="value">${fmt(pi.printerUsageCost * p.items_per_set)}</div>
        <div class="detail">+ ${fmtPct(settings.printer_cost_profit_pct)} profit: ${fmt(pr.printerCostProfit * p.items_per_set)}</div>
      </div>
    </div>
  </div>`;
}

function renderExtrasSection(p) {
  if (!p.extras || p.extras.length === 0) return '';
  return `<div class="extras-section">
    <div class="extras-section-header">
      <h3>Extra Costs</h3>
    </div>
    <div class="extras-list">
      ${p.extras.map(e => `
        <span class="extras-chip">
          <span class="qty">${e.quantity}x</span>
          ${esc(e.name)}
          <span style="color:var(--text-muted)">${fmt(e.price_excl_vat)}</span>
        </span>`).join('')}
    </div>
  </div>`;
}

function renderPricingSection(p) {
  const c = p.calculation;
  if (!c || !p.plates?.length) return '';
  const pr = c.pricing;
  const itemLabel = p.items_per_set > 1 ? `set of ${p.items_per_set}` : 'item';

  let actualHtml = '';
  if (c.actualMargin) {
    actualHtml = `
      <div class="sub">Profit: ${fmt(c.actualMargin.profitAmount)} <span class="margin-badge ${c.actualIndicator}">${fmtPct(c.actualMargin.marginPct)}</span></div>`;
  }

  return `<div class="pricing-section">
    <div class="pricing-grid">
      <div class="pricing-block">
        <h4>Production Cost (${itemLabel})</h4>
        <div class="big-price">${fmt(pr.productionCost)}</div>
        <div class="sub">excl. VAT, no margins</div>
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
      <div class="pricing-block">
        <h4>Actual Sales Price</h4>
        <div class="actual-price-wrap">
          <input type="number" class="actual-price-input" value="${p.actual_sales_price || ''}"
            placeholder="${fmt(pr.suggestedPrice)}"
            onchange="updateActualPrice(${p.id}, this.value)" step="0.01" min="0">
        </div>
        ${actualHtml}
      </div>
    </div>
  </div>`;
}

/* ================================================================== */
/*  Project actions                                                    */
/* ================================================================== */
function toggleProject(id) {
  if (openProjects.has(id)) openProjects.delete(id);
  else openProjects.add(id);
  renderProjects();
}

function openProjectModal(id = null) {
  editingProjectId = id;
  const p = id ? projects.find(x => x.id === id) : null;
  document.getElementById('project-modal-title').textContent = p ? 'Edit Project' : 'New Project';
  document.getElementById('proj-name').value = p?.name || '';
  document.getElementById('proj-customer').value = p?.customer_name || '';
  document.getElementById('proj-items-per-set').value = p?.items_per_set || 1;
  openModal('project-modal');
  document.getElementById('proj-name').focus();
}

document.getElementById('btn-save-project').addEventListener('click', async () => {
  const data = {
    name: document.getElementById('proj-name').value.trim(),
    customer_name: document.getElementById('proj-customer').value.trim() || null,
    items_per_set: parseInt(document.getElementById('proj-items-per-set').value) || 1,
  };
  if (!data.name) return;

  if (editingProjectId) {
    const existing = projects.find(x => x.id === editingProjectId);
    data.actual_sales_price = existing?.actual_sales_price || null;
    await PUT(`/api/projects/${editingProjectId}`, data);
  } else {
    const created = await POST('/api/projects', data);
    if (created) openProjects.add(created.id);
  }
  closeModal('project-modal');
  await reloadProjects();
});

async function deleteProject(id) {
  if (!confirm('Delete this project and all its plates?')) return;
  await DEL(`/api/projects/${id}`);
  openProjects.delete(id);
  await reloadProjects();
}

async function updateActualPrice(projectId, value) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const price = parseFloat(value) || null;
  await PUT(`/api/projects/${projectId}`, {
    name: p.name,
    customer_name: p.customer_name,
    items_per_set: p.items_per_set,
    actual_sales_price: price,
  });
  await reloadProjects();
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

  // Populate printer select
  const printerSel = document.getElementById('plate-printer');
  printerSel.innerHTML = '<option value="">-- Select --</option>' +
    printers.map(pr => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('');

  // Populate material select
  const matSel = document.getElementById('plate-material');
  matSel.innerHTML = '<option value="">-- Select --</option>' +
    materials.map(m => `<option value="${m.id}">${esc(m.name)}${m.color ? ` (${esc(m.color)})` : ''}</option>`).join('');

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
    printerSel.value = plate.printer_id || '';
    matSel.value = plate.material_id || '';
    document.getElementById('plate-included').checked = !!plate.included;
  } else {
    // Use defaults from last plate or sensible defaults
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
    printerSel.value = last?.printer_id || '';
    matSel.value = last?.material_id || '';
    document.getElementById('plate-included').checked = true;
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
    included: document.getElementById('plate-included').checked ? 1 : 0,
  };

  if (editingPlateId) {
    await PUT(`/api/projects/${editingPlateProjectId}/plates/${editingPlateId}`, data);
  } else {
    await POST(`/api/projects/${editingPlateProjectId}/plates`, data);
  }
  closeModal('plate-modal');
  await reloadProjects();
});

async function deletePlate(projectId, plateId) {
  if (!confirm('Delete this plate?')) return;
  await DEL(`/api/projects/${projectId}/plates/${plateId}`);
  await reloadProjects();
}

/* ================================================================== */
/*  Extra Costs per project                                            */
/* ================================================================== */
function openExtrasModal(projectId) {
  extrasProjectId = projectId;
  const p = projects.find(x => x.id === projectId);
  const body = document.getElementById('extras-modal-body');

  body.innerHTML = extraCostItems.map(eci => {
    const existing = p?.extras?.find(e => e.extra_cost_id === eci.id);
    const qty = existing ? existing.quantity : 0;
    return `<div class="extras-modal-item">
      <span class="name">${esc(eci.name)}</span>
      <span class="price">${fmt(eci.price_excl_vat)}</span>
      <input type="number" min="0" value="${qty}" data-ecid="${eci.id}">
    </div>`;
  }).join('');

  openModal('extras-modal');
}

document.getElementById('btn-save-extras').addEventListener('click', async () => {
  const items = [];
  document.querySelectorAll('#extras-modal-body input[data-ecid]').forEach(inp => {
    const qty = parseInt(inp.value) || 0;
    items.push({ extra_cost_id: parseInt(inp.dataset.ecid), quantity: qty });
  });
  await PUT(`/api/projects/${extrasProjectId}/extras`, items);
  closeModal('extras-modal');
  await reloadProjects();
});

/* ================================================================== */
/*  Settings                                                           */
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
      <input type="number" value="${settings.price_rounding || 0.99}" step="0.01" min="0" max="0.99"
        onchange="saveSetting('price_rounding', this.value)"></div>
    <div class="settings-row"><label>Currency Symbol</label>
      <input type="text" value="${settings.currency_symbol || '\u20ac'}" style="width:60px"
        onchange="saveSetting('currency_symbol', this.value)"></div>
  `;
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
      <input type="number" value="${settings.margin_orange_pct || 5}" step="1" onchange="saveSetting('margin_orange_pct', this.value)"></div>
  `;
}

function renderThemeSettings() {
  const current = settings.theme || 'system';
  return `
    <div class="settings-row"><label>Theme</label>
      <select onchange="saveTheme(this.value)">
        <option value="system" ${current === 'system' ? 'selected' : ''}>System</option>
        <option value="light" ${current === 'light' ? 'selected' : ''}>Light</option>
        <option value="dark" ${current === 'dark' ? 'selected' : ''}>Dark</option>
      </select>
    </div>
  `;
}

/* ---- Printers settings ---- */
function renderPrintersSettings() {
  let html = printers.map(p => `
    <div class="settings-list-item">
      <div>
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${fmt(p.purchase_price)} | ${p.expected_prints} prints | ${p.earn_back_months}mo payback
          ${p.electricity?.map(e => ` | ${e.material_type}: ${e.kwh_per_hour} kWh`).join('') || ''}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="editPrinter(${p.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deletePrinterItem(${p.id})">Del</button>
      </div>
    </div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editPrinter(null)">+ Add Printer</button></div>`;
  html += `<div id="printer-edit-area"></div>`;
  return html;
}

window.editPrinter = function(id) {
  const p = id ? printers.find(x => x.id === id) : null;
  const elecRows = (p?.electricity || [{ material_type: 'PLA', kwh_per_hour: 0.11 }])
    .map((e, i) => `<div class="elec-profile-row">
      <input type="text" value="${e.material_type}" placeholder="Material type" data-elec-type="${i}">
      <input type="number" value="${e.kwh_per_hour}" step="0.01" placeholder="kWh/h" data-elec-kwh="${i}">
      <button class="btn-icon" onclick="this.parentElement.remove()" title="Remove">&times;</button>
    </div>`).join('');

  document.getElementById('printer-edit-area').innerHTML = `
    <div class="settings-edit-form">
      <div class="form-row">
        <div><label>Name</label><input type="text" id="pe-name" value="${esc(p?.name || '')}"></div>
        <div><label>Purchase Price</label><input type="number" id="pe-price" step="0.01" value="${p?.purchase_price || 0}"></div>
      </div>
      <div class="form-row">
        <div><label>Expected Prints</label><input type="number" id="pe-prints" value="${p?.expected_prints || 5000}"></div>
        <div><label>Payback Months</label><input type="number" id="pe-months" value="${p?.earn_back_months || 24}"></div>
      </div>
      <label style="margin-top:8px">Electricity Profiles</label>
      <div id="pe-elec">${elecRows}</div>
      <button class="btn btn-sm" style="margin-top:4px" onclick="addElecRow()">+ Profile</button>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="savePrinter(${id || 'null'})">Save</button>
        <button class="btn btn-sm" onclick="document.getElementById('printer-edit-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

window.addElecRow = function() {
  const div = document.createElement('div');
  div.className = 'elec-profile-row';
  div.innerHTML = `<input type="text" value="PLA" placeholder="Material type">
    <input type="number" value="0.11" step="0.01" placeholder="kWh/h">
    <button class="btn-icon" onclick="this.parentElement.remove()" title="Remove">&times;</button>`;
  document.getElementById('pe-elec').appendChild(div);
};

window.savePrinter = async function(id) {
  const electricity = [];
  document.querySelectorAll('#pe-elec .elec-profile-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    electricity.push({ material_type: inputs[0].value, kwh_per_hour: parseFloat(inputs[1].value) || 0 });
  });
  const data = {
    name: document.getElementById('pe-name').value.trim(),
    purchase_price: parseFloat(document.getElementById('pe-price').value) || 0,
    expected_prints: parseInt(document.getElementById('pe-prints').value) || 5000,
    earn_back_months: parseInt(document.getElementById('pe-months').value) || 24,
    electricity,
  };
  if (!data.name) return;
  if (id) await PUT(`/api/printers/${id}`, data);
  else await POST('/api/printers', data);
  printers = await GET('/api/printers');
  renderSettingsTab('printers');
  await reloadProjects();
};

window.deletePrinterItem = async function(id) {
  if (!confirm('Delete this printer?')) return;
  await DEL(`/api/printers/${id}`);
  printers = await GET('/api/printers');
  renderSettingsTab('printers');
};

/* ---- Materials settings ---- */
function renderMaterialsSettings() {
  let html = materials.map(m => `
    <div class="settings-list-item">
      <div>
        <div class="name">${esc(m.name)}${m.color ? ` <span style="color:var(--text-muted)">(${esc(m.color)})</span>` : ''}</div>
        <div class="meta">${m.material_type} | ${fmt(m.price_per_kg)}/kg | ${m.roll_weight_g}g roll</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="editMaterial(${m.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteMaterialItem(${m.id})">Del</button>
      </div>
    </div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editMaterial(null)">+ Add Material</button></div>`;
  html += `<div id="material-edit-area"></div>`;
  return html;
}

window.editMaterial = function(id) {
  const m = id ? materials.find(x => x.id === id) : null;
  document.getElementById('material-edit-area').innerHTML = `
    <div class="settings-edit-form">
      <div class="form-row">
        <div><label>Name</label><input type="text" id="me-name" value="${esc(m?.name || '')}"></div>
        <div><label>Material Type</label><input type="text" id="me-type" value="${esc(m?.material_type || 'PLA')}"></div>
      </div>
      <div class="form-row">
        <div><label>Color (empty = generic)</label><input type="text" id="me-color" value="${esc(m?.color || '')}"></div>
        <div><label>Price/kg (excl. VAT)</label><input type="number" id="me-price" step="0.01" value="${m?.price_per_kg || 0}"></div>
      </div>
      <div class="form-row">
        <div><label>Roll Weight (g)</label><input type="number" id="me-weight" value="${m?.roll_weight_g || 1000}"></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="saveMaterial(${id || 'null'})">Save</button>
        <button class="btn btn-sm" onclick="document.getElementById('material-edit-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

window.saveMaterial = async function(id) {
  const data = {
    name: document.getElementById('me-name').value.trim(),
    material_type: document.getElementById('me-type').value.trim() || 'PLA',
    color: document.getElementById('me-color').value.trim() || null,
    price_per_kg: parseFloat(document.getElementById('me-price').value) || 0,
    roll_weight_g: parseInt(document.getElementById('me-weight').value) || 1000,
  };
  if (!data.name) return;
  if (id) await PUT(`/api/materials/${id}`, data);
  else await POST('/api/materials', data);
  materials = await GET('/api/materials');
  renderSettingsTab('materials');
  await reloadProjects();
};

window.deleteMaterialItem = async function(id) {
  if (!confirm('Delete this material?')) return;
  await DEL(`/api/materials/${id}`);
  materials = await GET('/api/materials');
  renderSettingsTab('materials');
};

/* ---- Extra Costs settings ---- */
function renderExtrasSettings() {
  let html = extraCostItems.map(e => `
    <div class="settings-list-item">
      <div>
        <div class="name">${esc(e.name)}</div>
        <div class="meta">${fmt(e.price_excl_vat)} excl. VAT | Default: ${e.default_included ? `Yes (qty ${e.default_quantity})` : 'No'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="editExtraCost(${e.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteExtraCostItem(${e.id})">Del</button>
      </div>
    </div>`).join('');
  html += `<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="editExtraCost(null)">+ Add Extra Cost</button></div>`;
  html += `<div id="extra-edit-area"></div>`;
  return html;
}

window.editExtraCost = function(id) {
  const e = id ? extraCostItems.find(x => x.id === id) : null;
  document.getElementById('extra-edit-area').innerHTML = `
    <div class="settings-edit-form">
      <div class="form-row">
        <div><label>Name</label><input type="text" id="ee-name" value="${esc(e?.name || '')}"></div>
        <div><label>Price excl. VAT</label><input type="number" id="ee-price" step="0.01" value="${e?.price_excl_vat || 0}"></div>
      </div>
      <div class="form-row">
        <div><label>Default Included</label>
          <label class="toggle"><input type="checkbox" id="ee-default" ${e?.default_included ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        <div><label>Default Quantity</label><input type="number" id="ee-qty" min="1" value="${e?.default_quantity || 1}"></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="saveExtraCost(${id || 'null'})">Save</button>
        <button class="btn btn-sm" onclick="document.getElementById('extra-edit-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

window.saveExtraCost = async function(id) {
  const data = {
    name: document.getElementById('ee-name').value.trim(),
    price_excl_vat: parseFloat(document.getElementById('ee-price').value) || 0,
    default_included: document.getElementById('ee-default').checked,
    default_quantity: parseInt(document.getElementById('ee-qty').value) || 1,
  };
  if (!data.name) return;
  if (id) await PUT(`/api/extra-costs/${id}`, data);
  else await POST('/api/extra-costs', data);
  extraCostItems = await GET('/api/extra-costs');
  renderSettingsTab('extras');
};

window.deleteExtraCostItem = async function(id) {
  if (!confirm('Delete this extra cost item?')) return;
  await DEL(`/api/extra-costs/${id}`);
  extraCostItems = await GET('/api/extra-costs');
  renderSettingsTab('extras');
};

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

async function saveTheme(value) {
  await PUT(`/api/settings/theme`, { value });
  settings.theme = value;
  applyTheme(value);
}

/* ================================================================== */
/*  Utility                                                            */
/* ================================================================== */
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ================================================================== */
/*  Topbar actions                                                     */
/* ================================================================== */
document.getElementById('btn-new-project').addEventListener('click', () => openProjectModal());
document.getElementById('btn-logout').addEventListener('click', async () => {
  await POST('/logout');
  window.location.replace('/login');
});

/* ================================================================== */
/*  Init                                                               */
/* ================================================================== */
loadAll();
