'use strict';

/* ── SUPABASE ──────────────────────────────────────────────── */
const SUPABASE_URL    = 'https://jsjyuffnyuebeprsfdfb.supabase.co';
const SUPABASE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzanl1ZmZueXVlYmVwcnNmZGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzU5MTYsImV4cCI6MjA5MjYxMTkxNn0.-E6vFCrgpFZMfmFxBi0kUVwOSUh7ZAvzd6cpDOpszIQ';
const BUCKET          = 'product-images';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── STATE ─────────────────────────────────────────────────── */
let products    = [];
let collections = [];
let orders      = [];
let customers   = [];
let selectedImg = null;
let currentPage = 'dashboard';
let pendingDeleteFn = null;
let appInitialized  = false;

/* ── BOOT ──────────────────────────────────────────────────── */
function showLoginScreen() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('sidebar').style.display      = 'none';
  document.getElementById('mainWrap').style.display     = 'none';
}

function showDashboardScreen() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('sidebar').style.display      = '';
  document.getElementById('mainWrap').style.display     = '';
}

async function verifyAdminAndBoot(session) {
  // Ask the database (via SECURITY DEFINER RPC) whether THIS user is
  // in the hardcoded admin UUID list. Never trust the client to
  // decide — if the RPC says false, RLS would block writes anyway,
  // but we don't even show the UI.
  const { data: isAdmin, error } = await sb.rpc('is_admin');

  if (error || isAdmin !== true) {
    // not an admin — sign them out and surface a friendly error
    await sb.auth.signOut();
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.textContent = 'This account is not authorized to access the admin dashboard.';
    showLoginScreen();
    return;
  }

  showDashboardScreen();
  document.getElementById('sidebarUser').textContent = session.user.email;
  if (!appInitialized) {
    appInitialized = true;
    initNav();
    loadAll();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Hide everything until auth resolves — prevents the dashboard
  // flashing on screen before the session check finishes.
  showLoginScreen();

  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      verifyAdminAndBoot(session);
    } else {
      showLoginScreen();
      appInitialized = false;
    }
  });
});

/* ── AUTH ──────────────────────────────────────────────────── */
async function signIn(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errorEl  = document.getElementById('loginError');

  btn.disabled    = true;
  btn.textContent = 'Signing in…';
  errorEl.textContent = '';

  const { error } = await sb.auth.signInWithPassword({ email, password });

  btn.disabled    = false;
  btn.textContent = 'Sign In';

  if (error) {
    errorEl.textContent = 'Invalid email or password.';
  }
}

async function signOut() {
  await sb.auth.signOut();
  products = []; collections = []; orders = []; customers = [];
  appInitialized = false;
  showLoginScreen();
}

async function loadAll() {
  await Promise.all([
    fetchCollections(),
    fetchProducts(),
    fetchOrders(),
    fetchCustomers(),
  ]);
  updateStats();
  renderDashboard();
}

async function refreshAll() {
  toast('Refreshing data…');
  await loadAll();
  toast('Data refreshed ✓');
}

/* ── SUPABASE FETCHES ──────────────────────────────────────── */
async function fetchProducts() {
  const { data, error } = await sb
    .from('products')
    .select('*, collections!products_collection_id_fkey(name)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); setConnection(false); return; }
  setConnection(true);
  products = data.map(p => ({ ...p, collectionName: p.collections?.name || '' }));
  renderProductTable();
  populateCollectionDropdowns();
  document.getElementById('navProductCount').textContent = products.length;
}

async function fetchCollections() {
  const { data, error } = await sb.from('collections').select('*').order('name');
  if (error) { console.error(error); return; }
  collections = data;
  renderCollectionTable();
  populateCollectionDropdowns();
  document.getElementById('navCollectionCount').textContent = collections.length;
}

async function fetchOrders() {
  const { data, error } = await sb
    .from('orders')
    .select('*, customers(name, email, phone), order_items(quantity, unit_price, products(name))')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  orders = data;
  renderOrderTable();
  document.getElementById('navOrderCount').textContent = orders.length;
}

async function fetchCustomers() {
  const { data, error } = await sb
    .from('customers')
    .select('*, orders(id)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  customers = data;
  renderCustomerTable();
}

/* ── STATS ─────────────────────────────────────────────────── */
function updateStats() {
  setText('statProducts',    products.length);
  setText('statCollections', collections.length);
  setText('statOrders',      orders.length);
  setText('statCustomers',   customers.length);
}

/* ── DASHBOARD ─────────────────────────────────────────────── */
function renderDashboard() {
  /* Recent orders mini table */
  const recent = orders.slice(0, 6);
  const el = document.getElementById('recentOrdersTable');
  if (!recent.length) { el.innerHTML = '<p style="padding:20px;color:var(--text-muted);font-size:.86rem">No orders yet.</p>'; }
  else {
    el.innerHTML = `<div class="table-scroll"><table class="mini-table">${recent.map(o => `
      <tr>
        <td>
          <div class="mt-name">${esc(o.customers?.name || 'Guest')}</div>
          <div class="mt-sub">${esc(o.customers?.email || '')}</div>
        </td>
        <td class="mt-val">
          <span class="pill pill-${o.status}">${o.status}</span>
        </td>
        <td class="mt-val">KWD ${Number(o.total_amount).toFixed(3)}</td>
      </tr>`).join('')}</table></div>`;
  }

  /* Top products list */
  const top = products.slice(0, 5);
  const pl = document.getElementById('topProductsList');
  if (!top.length) { pl.innerHTML = '<p style="padding:20px;color:var(--text-muted);font-size:.86rem">No products yet.</p>'; }
  else {
    pl.innerHTML = top.map((p, i) => {
      const img = imgUrl(p.image_path);
      return `<div class="top-product-item">
        <span class="top-product-rank">${i + 1}</span>
        ${img ? `<img class="top-product-img" src="${img}" alt="" />` : `<div class="top-product-img" style="background:var(--bg)"></div>`}
        <span class="top-product-name">${esc(p.name)}</span>
        <span class="top-product-price">KWD ${Number(p.price).toFixed(3)}</span>
      </div>`;
    }).join('');
  }
}

/* ── PRODUCTS TABLE ────────────────────────────────────────── */
function renderProductTable(list = products) {
  const body  = document.getElementById('productsBody');
  const empty = document.getElementById('productsEmpty');

  if (!list.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('#productsTable').style.display = 'none';
    return;
  }
  document.querySelector('#productsTable').style.display = '';
  empty.style.display = 'none';

  body.innerHTML = list.map(p => {
    const url = imgUrl(p.image_path);
    return `<tr>
      <td>${url ? `<img class="table-thumb" src="${url}" alt="" />` : `<div class="table-thumb-placeholder">IMG</div>`}</td>
      <td><strong>${esc(p.name)}</strong>${p.description ? `<br><small style="color:var(--text-muted)">${esc(p.description.slice(0,50))}${p.description.length>50?'…':''}</small>` : ''}</td>
      <td>${p.collectionName ? `<span class="pill" style="background:#FEF3C7;color:#92400E">${esc(p.collectionName)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><strong>KWD ${Number(p.price).toFixed(3)}</strong></td>
      <td>${p.quantity}</td>
      <td>${p.badge ? `<span class="pill" style="background:#F3F4F6;color:var(--text)">${esc(p.badge)}</span>` : '—'}</td>
      <td><span class="pill ${p.is_active ? 'pill-active' : 'pill-inactive'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-btn" onclick="openEditProduct('${p.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="row-btn danger" onclick="confirmDelete('product','${p.id}','${esc(p.name)}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterProductTable() {
  const q    = document.getElementById('productSearch').value.toLowerCase();
  const col  = document.getElementById('productCollectionFilter').value;
  const list = products.filter(p =>
    (p.name.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q)) &&
    (!col || p.collection_id === col)
  );
  renderProductTable(list);
}

/* ── PRODUCT MODAL ─────────────────────────────────────────── */
function openProductModal(id = null) {
  resetProductForm();
  document.getElementById('productModalTitle').textContent = id ? 'Edit Product' : 'Add Product';
  document.getElementById('productSubmitText').textContent = id ? 'Save Changes' : 'Save Product';
  document.getElementById('pEditId').value = id || '';
  document.getElementById('productModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

async function openEditProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  openProductModal(id);
  document.getElementById('pName').value       = p.name || '';
  document.getElementById('pPrice').value      = p.price || '';
  document.getElementById('pDesc').value       = p.description || '';
  document.getElementById('pQty').value        = p.quantity ?? 0;
  document.getElementById('pBadge').value      = p.badge || '';
  document.getElementById('pActive').checked   = p.is_active !== false;
  document.getElementById('pCollection').value = p.collection_id || '';
  document.getElementById('pExistingImg').value = p.image_path || '';

  if (p.image_path) showImgPreview(imgUrl(p.image_path));

  const { data: variants } = await sb.from('product_variants').select('*').eq('product_id', id);
  (variants || []).forEach(v => addVariant(v));
}

function closeProductModal() {
  document.getElementById('productModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  resetProductForm();
}

function resetProductForm() {
  document.getElementById('productForm').reset();
  document.getElementById('pEditId').value = '';
  document.getElementById('pExistingImg').value = '';
  document.getElementById('variantsWrap').innerHTML = '';
  selectedImg = null;
  clearImgPreview();
}

async function submitProduct(e) {
  e.preventDefault();
  setLoading('product', true);

  let imagePath = document.getElementById('pExistingImg').value || null;

  if (selectedImg) {
    const { path, error } = await uploadImg(selectedImg);
    if (error) { toast('Upload failed: ' + error.message); setLoading('product', false); return; }
    imagePath = path;
  }

  const collId = document.getElementById('pCollection').value || null;
  const payload = {
    name:          document.getElementById('pName').value.trim(),
    description:   document.getElementById('pDesc').value.trim() || null,
    price:         parseFloat(document.getElementById('pPrice').value),
    quantity:      parseInt(document.getElementById('pQty').value) || 0,
    badge:         document.getElementById('pBadge').value || null,
    is_active:     document.getElementById('pActive').checked,
    collection_id: collId,
    image_path:    imagePath,
  };

  const editId   = document.getElementById('pEditId').value;
  const variants = collectVariants();

  let error;
  if (editId) {
    const res = await sb.from('products').update(payload).eq('id', editId);
    error = res.error;
    if (!error) {
      await sb.from('product_variants').delete().eq('product_id', editId);
      if (variants.length) await sb.from('product_variants').insert(variants.map(v => ({ ...v, product_id: editId })));
    }
  } else {
    const res = await sb.from('products').insert(payload).select().single();
    error = res.error;
    if (!error && variants.length) {
      await sb.from('product_variants').insert(variants.map(v => ({ ...v, product_id: res.data.id })));
    }
  }

  setLoading('product', false);
  if (error) { toast('Error: ' + error.message); return; }

  toast(editId ? 'Product updated ✓' : 'Product added ✓');
  closeProductModal();
  await fetchProducts();
  updateStats();
  renderDashboard();
}

/* ── COLLECTIONS TABLE ─────────────────────────────────────── */
function renderCollectionTable(list = collections) {
  const body  = document.getElementById('collectionsBody');
  const empty = document.getElementById('collectionsEmpty');

  if (!list.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('#collectionsTable').style.display = 'none';
    return;
  }
  document.querySelector('#collectionsTable').style.display = '';
  empty.style.display = 'none';

  body.innerHTML = list.map(c => {
    const count = products.filter(p => p.collection_id === c.id).length;
    const date  = new Date(c.created_at).toLocaleDateString();
    return `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td style="color:var(--text-muted)">${c.description ? esc(c.description.slice(0,60)) + (c.description.length > 60 ? '…' : '') : '—'}</td>
      <td><span class="pill" style="background:#EDE9FE;color:#5B21B6">${count} product${count !== 1 ? 's' : ''}</span></td>
      <td style="color:var(--text-muted)">${date}</td>
      <td>
        <div class="row-actions">
          <button class="row-btn" onclick="openEditCollection('${c.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="row-btn danger" onclick="confirmDelete('collection','${c.id}','${esc(c.name)}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterCollectionTable() {
  const q = document.getElementById('collectionSearch').value.toLowerCase();
  renderCollectionTable(collections.filter(c => c.name.toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q)));
}

/* ── COLLECTION MODAL ──────────────────────────────────────── */
function openCollectionModal() {
  document.getElementById('collectionForm').reset();
  document.getElementById('cEditId').value = '';
  document.getElementById('collectionModalTitle').textContent = 'Add Collection';
  document.getElementById('collectionSubmitText').textContent = 'Save Collection';
  document.getElementById('collectionModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function openEditCollection(id) {
  const c = collections.find(x => x.id === id);
  if (!c) return;
  openCollectionModal();
  document.getElementById('collectionModalTitle').textContent = 'Edit Collection';
  document.getElementById('collectionSubmitText').textContent = 'Save Changes';
  document.getElementById('cEditId').value = id;
  document.getElementById('cName').value   = c.name || '';
  document.getElementById('cDesc').value   = c.description || '';
}

function closeCollectionModal() {
  document.getElementById('collectionModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

async function submitCollection(e) {
  e.preventDefault();
  setLoading('collection', true);

  const editId  = document.getElementById('cEditId').value;
  const payload = {
    name:        document.getElementById('cName').value.trim(),
    description: document.getElementById('cDesc').value.trim() || null,
  };

  const { error } = editId
    ? await sb.from('collections').update(payload).eq('id', editId)
    : await sb.from('collections').insert(payload);

  setLoading('collection', false);
  if (error) { toast('Error: ' + error.message); return; }

  toast(editId ? 'Collection updated ✓' : 'Collection added ✓');
  closeCollectionModal();
  await fetchCollections();
  updateStats();
  renderDashboard();
}

/* ── ORDERS TABLE ──────────────────────────────────────────── */
function renderOrderTable(list = orders) {
  const body  = document.getElementById('ordersBody');
  const empty = document.getElementById('ordersEmpty');

  if (!list.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  body.innerHTML = list.map(o => {
    const shortId = o.id.slice(0, 8).toUpperCase();
    const date    = new Date(o.created_at).toLocaleDateString();
    return `<tr>
      <td><code style="font-size:.78rem;background:var(--bg);padding:2px 6px;border-radius:4px">#${shortId}</code></td>
      <td>
        <div>${esc(o.customers?.name || 'Guest')}</div>
        <small style="color:var(--text-muted)">${esc(o.customers?.email || '')}</small>
      </td>
      <td><strong>KWD ${Number(o.total_amount).toFixed(3)}</strong></td>
      <td><span class="pill pill-${o.status}">${o.status}</span></td>
      <td style="color:var(--text-muted)">${date}</td>
      <td>
        <button class="row-btn view" onclick="openOrderDetail('${o.id}')" title="View details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function filterOrderTable() {
  const q  = document.getElementById('orderSearch').value.toLowerCase();
  const st = document.getElementById('orderStatusFilter').value;
  renderOrderTable(orders.filter(o =>
    (o.customers?.name || '').toLowerCase().includes(q) ||
    (o.customers?.email || '').toLowerCase().includes(q)
  ).filter(o => !st || o.status === st));
}

/* ── ORDER DETAIL ──────────────────────────────────────────── */
function openOrderDetail(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  const addr = o.shipping_address || {};
  const items = o.order_items || [];

  document.getElementById('orderDetailBody').innerHTML = `
    <div class="order-detail">
      <div class="order-detail-section">
        <h4>Customer</h4>
        <div class="order-info-grid">
          <div class="order-info-item"><label>Name</label><span>${esc(o.customers?.name || '—')}</span></div>
          <div class="order-info-item"><label>Email</label><span>${esc(o.customers?.email || '—')}</span></div>
          <div class="order-info-item"><label>Phone</label><span>${esc(o.customers?.phone || '—')}</span></div>
          <div class="order-info-item"><label>Address</label><span>${esc(addr.address || '—')}</span></div>
          <div class="order-info-item"><label>City</label><span>${esc(addr.city || '—')}</span></div>
        </div>
      </div>
      <div class="order-detail-section">
        <h4>Items</h4>
        <div class="order-items-list">
          ${items.map(i => `
            <div class="order-item-row">
              <span class="order-item-name">${esc(i.products?.name || 'Product')}</span>
              <span class="order-item-qty">× ${i.quantity}</span>
              <span class="order-item-price">KWD ${(i.unit_price * i.quantity).toFixed(3)}</span>
            </div>`).join('')}
          <div class="order-total-row">
            <span>Total</span>
            <span>KWD ${Number(o.total_amount).toFixed(3)}</span>
          </div>
        </div>
      </div>
      ${o.notes ? `<div class="order-detail-section"><h4>Notes</h4><p style="font-size:.88rem">${esc(o.notes)}</p></div>` : ''}
    </div>
    <div class="status-update-bar">
      <label>Update Status:</label>
      <select id="orderStatusEdit">
        ${['pending','confirmed','shipped','delivered','cancelled'].map(s =>
          `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join('')}
      </select>
      <button class="btn-primary" onclick="updateOrderStatus('${o.id}')">Update</button>
    </div>`;

  document.getElementById('orderDetailOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeOrderDetail() {
  document.getElementById('orderDetailOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

async function updateOrderStatus(orderId) {
  const status = document.getElementById('orderStatusEdit').value;
  const { error } = await sb.from('orders').update({ status }).eq('id', orderId);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Status updated ✓');
  closeOrderDetail();
  await fetchOrders();
  renderDashboard();
}

/* ── CUSTOMERS TABLE ───────────────────────────────────────── */
function renderCustomerTable(list = customers) {
  const body  = document.getElementById('customersBody');
  const empty = document.getElementById('customersEmpty');

  if (!list.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  body.innerHTML = list.map(c => {
    const orderCount = (c.orders || []).length;
    const date = new Date(c.created_at).toLocaleDateString();
    return `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.email)}</td>
      <td>${c.phone ? esc(c.phone) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="pill" style="background:#EDE9FE;color:#5B21B6">${orderCount} order${orderCount !== 1 ? 's' : ''}</span></td>
      <td style="color:var(--text-muted)">${date}</td>
    </tr>`;
  }).join('');
}

function filterCustomerTable() {
  const q = document.getElementById('customerSearch').value.toLowerCase();
  renderCustomerTable(customers.filter(c =>
    c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.phone||'').includes(q)
  ));
}

/* ── DELETE ────────────────────────────────────────────────── */
function confirmDelete(type, id, name) {
  document.getElementById('deleteTitle').textContent = `Delete ${type === 'product' ? 'Product' : 'Collection'}?`;
  document.getElementById('deleteMsg').textContent   = `"${name}" will be permanently deleted. This cannot be undone.`;
  document.getElementById('deleteOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  pendingDeleteFn = async () => {
    const btn = document.getElementById('deleteConfirmBtn');
    btn.textContent = 'Deleting…'; btn.disabled = true;

    if (type === 'product') {
      const p = products.find(x => x.id === id);
      if (p?.image_path) await sb.storage.from(BUCKET).remove([p.image_path]);
      await sb.from('product_variants').delete().eq('product_id', id);
      await sb.from('products').delete().eq('id', id);
      toast('Product deleted.');
      await fetchProducts();
    } else {
      await sb.from('collections').delete().eq('id', id);
      toast('Collection deleted.');
      await fetchCollections();
    }

    btn.textContent = 'Delete'; btn.disabled = false;
    closeDelete();
    updateStats();
    renderDashboard();
  };

  document.getElementById('deleteConfirmBtn').onclick = pendingDeleteFn;
}

function closeDelete() {
  document.getElementById('deleteOverlay').style.display = 'none';
  document.body.style.overflow = '';
  pendingDeleteFn = null;
}

/* ── VARIANTS ──────────────────────────────────────────────── */
function addVariant(existing = null) {
  const wrap = document.getElementById('variantsWrap');
  const row  = document.createElement('div');
  row.className = 'variant-row';
  row.innerHTML = `
    <input type="text"   placeholder="Name (e.g. 50ml)"    value="${existing ? esc(existing.name) : ''}"           class="v-name" />
    <input type="number" placeholder="Price modifier"       value="${existing ? existing.price_modifier : 0}"       class="v-mod" step="0.001" style="width:130px" />
    <input type="number" placeholder="Qty"                  value="${existing ? existing.quantity : 0}"             class="v-qty" min="0"      style="width:80px" />
    <button type="button" class="variant-del" onclick="this.parentElement.remove()">✕</button>`;
  wrap.appendChild(row);
}

function collectVariants() {
  return Array.from(document.querySelectorAll('.variant-row')).map(r => ({
    name:           r.querySelector('.v-name').value.trim(),
    price_modifier: parseFloat(r.querySelector('.v-mod').value) || 0,
    quantity:       parseInt(r.querySelector('.v-qty').value) || 0,
  })).filter(v => v.name);
}

/* ── IMAGE UPLOAD ──────────────────────────────────────────── */
function handleImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
  selectedImg = file;
  showImgPreview(URL.createObjectURL(file));
}

function showImgPreview(url) {
  document.getElementById('imgPlaceholder').style.display = 'none';
  const img = document.getElementById('imgPreview');
  img.src = url; img.style.display = 'block';
  document.getElementById('imgRemoveBtn').style.display = 'inline-flex';
}

function clearImgPreview() {
  document.getElementById('imgPlaceholder').style.display = 'flex';
  const img = document.getElementById('imgPreview');
  img.src = ''; img.style.display = 'none';
  document.getElementById('imgRemoveBtn').style.display = 'none';
  document.getElementById('imgFileInput').value = '';
}

function removeImg(e) {
  e.stopPropagation();
  selectedImg = null;
  document.getElementById('pExistingImg').value = '';
  clearImgPreview();
}

async function uploadImg(file) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600' });
  if (error) return { path: null, error };
  return { path, error: null };
}

/* ── COLLECTION DROPDOWNS ──────────────────────────────────── */
function populateCollectionDropdowns() {
  const opts = '<option value="">— None —</option>' +
    collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const pCol = document.getElementById('pCollection');
  const prev = pCol?.value;
  if (pCol) { pCol.innerHTML = opts; pCol.value = prev; }

  const flt = document.getElementById('productCollectionFilter');
  if (flt) {
    flt.innerHTML = '<option value="">All Collections</option>' +
      collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }
}

/* ── NAVIGATION ────────────────────────────────────────────── */
function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      navigateTo(page);
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  function syncSidebarBackdrop() {
    const open = sidebar.classList.contains('open');
    if (window.innerWidth <= 768) {
      backdrop.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    } else {
      backdrop.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    syncSidebarBackdrop();
  });

  backdrop.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      backdrop.classList.remove('is-open');
      document.body.style.overflow = '';
    } else {
      syncSidebarBackdrop();
    }
  });

  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !document.getElementById('sidebarToggle').contains(e.target) &&
        !backdrop.contains(e.target)) {
      closeSidebar();
    }
  });
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

  const titles = { dashboard: 'Dashboard', products: 'Products', collections: 'Collections', orders: 'Orders', customers: 'Customers' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  const bd = document.getElementById('sidebarBackdrop');
  if (bd) bd.classList.remove('is-open');
  document.body.style.overflow = '';
}

/* ── MODAL BACKDROP CLOSE ──────────────────────────────────── */
function closeOnBackdrop(e, overlayId) {
  if (e.target.id === overlayId) {
    document.getElementById(overlayId).style.display = 'none';
    document.body.style.overflow = '';
  }
}

/* ── LOADING STATE ─────────────────────────────────────────── */
function setLoading(type, on) {
  const text    = document.getElementById(`${type}SubmitText`);
  const spinner = document.getElementById(`${type}Spinner`);
  const btn     = document.getElementById(`${type}SubmitBtn`);
  text.style.display    = on ? 'none'   : 'inline';
  spinner.style.display = on ? 'inline-block' : 'none';
  btn.disabled = on;
}

/* ── CONNECTION INDICATOR ──────────────────────────────────── */
function setConnection(ok) {
  const dot   = document.getElementById('connectionDot');
  const label = document.getElementById('connectionLabel');
  dot.className = 'connection-dot ' + (ok ? 'connected' : 'disconnected');
  label.textContent = ok ? 'Connected' : 'Connection error';
}

/* ── TOAST ─────────────────────────────────────────────────── */
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ── HELPERS ───────────────────────────────────────────────── */
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function imgUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
