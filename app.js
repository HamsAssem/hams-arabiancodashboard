'use strict';

/* ── SUPABASE ──────────────────────────────────────────────── */
const SUPABASE_URL    = 'https://jsjyuffnyuebeprsfdfb.supabase.co';
const SUPABASE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzanl1ZmZueXVlYmVwcnNmZGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzU5MTYsImV4cCI6MjA5MjYxMTkxNn0.-E6vFCrgpFZMfmFxBi0kUVwOSUh7ZAvzd6cpDOpszIQ';
const BUCKET          = 'product-images';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── STATE ─────────────────────────────────────────────────── */
let products     = [];
let collections  = [];
let bundles      = [];
let heroSlides   = [];   // [{ slot, image_path, ... }]
let homeSections = [];   // [{ section_key, eyebrow, title, subtitle, button_label, button_target, image_path }]
let promotions   = [];   // [{ id, name, type, collection_id, percent, buy_qty, get_qty, is_active }]
let orders       = [];
let customers    = [];
let selectedImg           = null;
let selectedBundleImg     = null;
let selectedCollectionImg = null;
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
  const { data: isAdmin, error } = await sb.rpc('is_admin');

  if (error || isAdmin !== true) {
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
  products = []; collections = []; bundles = []; orders = []; customers = [];
  appInitialized = false;
  showLoginScreen();
}

async function loadAll() {
  await Promise.all([
    fetchCollections(),
    fetchProducts(),
    fetchOrders(),
    fetchCustomers(),
    fetchHeroSlides(),
    fetchHomeSections(),
    fetchPromotions(),
  ]);
  await fetchBundles();
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
  // Collections table shows a "X products" pill per row; it's computed
  // from `products`, so re-render it now that products are loaded
  // (otherwise it stays at 0 if collections finished loading first).
  renderCollectionTable();
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
    .select('*, customers(name, email, phone), order_items(quantity, unit_price, products(name), bundles(name))')
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

async function fetchBundles() {
  const { data, error } = await sb
    .from('bundles')
    .select('*, bundle_items(id, product_id, quantity)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  bundles = data || [];
  renderBundleTable();
  const badge = document.getElementById('navBundleCount');
  if (badge) badge.textContent = bundles.length;
}

/* ── HERO BANNER ───────────────────────────────────────────── */
let selectedHeroImg = null;

async function fetchHeroSlides() {
  const { data, error } = await sb
    .from('hero_slides')
    .select('*')
    .order('slot', { ascending: true });
  if (error) { console.error(error); heroSlides = []; renderHeroSlots(); return; }
  heroSlides = data || [];
  renderHeroSlots();
}

function renderHeroSlots() {
  const grid  = document.getElementById('heroSlotsGrid');
  const empty = document.getElementById('heroEmpty');
  if (!grid) return;

  if (!heroSlides.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = heroSlides.map(s => {
    const url = imgUrl(s.image_path) || '';
    const titlePreview = (s.title || '').replace(/<br\s*\/?>(?:\s)*/gi, ' / ').replace(/<\/?em>/gi, '');
    return `
      <div class="hero-slot-card">
        <div class="hero-slot-header">
          <span class="hero-slot-label">Slide #${s.slot}</span>
          <div class="row-actions">
            <button class="row-btn" onclick="openHeroModal('${s.id}')" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="row-btn danger" onclick="deleteHeroSlide('${s.id}')" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        </div>
        <div class="hero-slot-preview" style="background-image:url('${url}')">
          ${(s.eyebrow || s.title || s.subtitle) ? `
            <div class="hero-slot-overlay">
              ${s.eyebrow ? `<span class="hero-slot-eyebrow">${esc(s.eyebrow)}</span>` : ''}
              ${titlePreview ? `<div class="hero-slot-title">${esc(titlePreview)}</div>` : ''}
              ${s.subtitle ? `<div class="hero-slot-sub">${esc(s.subtitle.slice(0,80))}${s.subtitle.length>80?'…':''}</div>` : ''}
            </div>` : ''}
        </div>
        <div class="hero-slot-footer">
          ${s.button_label ? `<span class="pill pill-active">Button: ${esc(s.button_label)} → ${esc(s.button_target || 'shop')}</span>` : '<span class="pill pill-inactive">No button</span>'}
        </div>
      </div>`;
  }).join('');
}

function openHeroModal(id = null) {
  document.getElementById('heroForm').reset();
  document.getElementById('hEditId').value = id || '';
  document.getElementById('hExistingImg').value = '';
  selectedHeroImg = null;
  clearHeroImgPreview();

  if (id) {
    const s = heroSlides.find(x => x.id === id);
    if (s) {
      document.getElementById('heroModalTitle').textContent = 'Edit Slide';
      document.getElementById('heroSubmitText').textContent = 'Save Changes';
      document.getElementById('hSlot').value         = s.slot ?? 1;
      document.getElementById('hEyebrow').value      = s.eyebrow || '';
      document.getElementById('hTitle').value        = s.title || '';
      document.getElementById('hSubtitle').value     = s.subtitle || '';
      document.getElementById('hButtonLabel').value  = s.button_label || '';
      document.getElementById('hButtonTarget').value = s.button_target || 'shop';
      document.getElementById('hExistingImg').value  = s.image_path || '';
      if (s.image_path) showHeroImgPreview(imgUrl(s.image_path));
    }
  } else {
    document.getElementById('heroModalTitle').textContent = 'Add Slide';
    document.getElementById('heroSubmitText').textContent = 'Save Slide';
    // Default new slide position = max existing + 1
    const nextSlot = (heroSlides.reduce((m, s) => Math.max(m, s.slot || 0), 0)) + 1;
    document.getElementById('hSlot').value = nextSlot;
  }

  document.getElementById('heroModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeHeroModal() {
  document.getElementById('heroModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  selectedHeroImg = null;
  clearHeroImgPreview();
}

function handleHeroImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
  selectedHeroImg = file;
  showHeroImgPreview(URL.createObjectURL(file));
}

function showHeroImgPreview(url) {
  document.getElementById('hImgPlaceholder').style.display = 'none';
  const img = document.getElementById('hImgPreview');
  img.src = url; img.style.display = 'block';
  document.getElementById('hImgRemoveBtn').style.display = 'inline-flex';
}

function clearHeroImgPreview() {
  const ph = document.getElementById('hImgPlaceholder');
  if (ph) ph.style.display = 'flex';
  const img = document.getElementById('hImgPreview');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const rm = document.getElementById('hImgRemoveBtn');
  if (rm) rm.style.display = 'none';
  const fi = document.getElementById('hImgFileInput');
  if (fi) fi.value = '';
}

function removeHeroImg(e) {
  e.stopPropagation();
  selectedHeroImg = null;
  document.getElementById('hExistingImg').value = '';
  clearHeroImgPreview();
}

async function submitHeroSlide(e) {
  e.preventDefault();
  setLoading('hero', true);

  let imagePath = document.getElementById('hExistingImg').value || null;

  if (selectedHeroImg) {
    const ext  = selectedHeroImg.name.split('.').pop().toLowerCase();
    const path = `hero/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, selectedHeroImg, { cacheControl: '3600' });
    if (upErr) { setLoading('hero', false); toast('Upload failed: ' + upErr.message); return; }
    imagePath = path;
  }

  if (!imagePath) { setLoading('hero', false); toast('Please upload an image.'); return; }

  const payload = {
    slot:          parseInt(document.getElementById('hSlot').value) || 1,
    image_path:    imagePath,
    eyebrow:       document.getElementById('hEyebrow').value.trim() || null,
    title:         document.getElementById('hTitle').value.trim() || null,
    subtitle:      document.getElementById('hSubtitle').value.trim() || null,
    button_label:  document.getElementById('hButtonLabel').value.trim() || null,
    button_target: document.getElementById('hButtonTarget').value || null,
    updated_at:    new Date().toISOString(),
  };

  const editId = document.getElementById('hEditId').value;
  let error;
  if (editId) {
    const res = await sb.from('hero_slides').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await sb.from('hero_slides').insert(payload);
    error = res.error;
  }

  setLoading('hero', false);
  if (error) { toast('Error: ' + error.message); return; }

  toast(editId ? 'Slide updated ✓' : 'Slide added ✓');
  closeHeroModal();
  await fetchHeroSlides();
}

async function deleteHeroSlide(id) {
  if (!confirm('Delete this slide?')) return;
  const s = heroSlides.find(x => x.id === id);
  if (s && s.image_path && !s.image_path.startsWith('http')) {
    await sb.storage.from(BUCKET).remove([s.image_path]);
  }
  const { error } = await sb.from('hero_slides').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message); return; }
  toast('Slide deleted ✓');
  await fetchHeroSlides();
}

/* ── OFFERS (home_sections) ────────────────────────────────── */
// Which sections are editable + their friendly labels for the admin UI.
const OFFER_SECTIONS = [
  { key: 'announcement_bar', label: 'Announcement Bar', desc: 'Scrolling messages at the very top of every page. One message per line.', hasButton: false, hasImage: false, messagesField: true },
  { key: 'promo_banner',     label: 'Promo Banner',     desc: 'The big "Up to 70% Off" panel between Best Sellers and Top Rated.',     hasButton: true,  hasImage: true,  messagesField: false },
  { key: 'monthly_offers',   label: 'Monthly Offers',   desc: 'Section header above the monthly deals product grid.',                  hasButton: false, hasImage: false, messagesField: false },
];

let selectedOfferImg = null;

async function fetchHomeSections() {
  const { data, error } = await sb.from('home_sections').select('*');
  if (error) { console.error(error); homeSections = []; renderOffers(); return; }
  homeSections = data || [];
  renderOffers();
}

function offerCardHTML(meta, row) {
  const isPlaceholder = !row;
  const id      = row?.id || '';
  const url     = row?.image_path ? imgUrl(row.image_path) : '';
  const title   = (row?.title || '').replace(/<\/?(span|br\s*\/?)>/gi, '');
  const inactive = row && row.is_active === false;
  const subPrev = row?.subtitle ? row.subtitle.replace(/\n/g, ' · ').slice(0, 80) : '';

  return `
    <div class="hero-slot-card${inactive ? ' inactive' : ''}">
      <div class="hero-slot-header">
        <span class="hero-slot-label">
          ${esc(meta.label)}${row?.position && meta.key === 'promo_banner' ? ` <span style="color:var(--text-muted);font-weight:400;font-size:.75rem">· #${row.position}</span>` : ''}
        </span>
        <div class="row-actions">
          ${isPlaceholder
            ? `<button class="row-btn" onclick="openOfferModal('${meta.key}', '')" title="Create"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`
            : `
            <button class="row-btn" onclick="toggleOfferActive('${id}', ${!inactive})" title="${inactive ? 'Activate' : 'Deactivate'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M${inactive ? '12 2v20' : '12 12h.01'}"/><circle cx="12" cy="12" r="10"/></svg>
            </button>
            <button class="row-btn" onclick="openOfferModal('${meta.key}', '${id}')" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="row-btn danger" onclick="deleteOffer('${id}')" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>`
          }
        </div>
      </div>
      <div class="hero-slot-preview" style="${url ? `background-image:url('${url}')` : 'background:linear-gradient(135deg,#1A1D23,#3a3d44)'}">
        ${(row?.eyebrow || title || subPrev) ? `
        <div class="hero-slot-overlay">
          ${row?.eyebrow ? `<span class="hero-slot-eyebrow">${esc(row.eyebrow)}</span>` : ''}
          ${title ? `<div class="hero-slot-title">${esc(title)}</div>` : ''}
          ${subPrev ? `<div class="hero-slot-sub">${esc(subPrev)}${row.subtitle.length>80?'…':''}</div>` : ''}
        </div>` : ''}
      </div>
      <div class="hero-slot-footer" style="color:var(--text-muted)">
        ${isPlaceholder
          ? `<em>Not configured yet — using hardcoded default. Click + to customise.</em>`
          : inactive
            ? `<span class="pill pill-inactive">Hidden from storefront</span>`
            : esc(meta.desc)}
      </div>
    </div>`;
}

function renderOffers() {
  const grid = document.getElementById('offersGrid');
  if (!grid) return;

  const singletonMetas = OFFER_SECTIONS.filter(s => s.key !== 'promo_banner');
  const promoMeta      = OFFER_SECTIONS.find(s => s.key === 'promo_banner');
  const promoRows      = homeSections
    .filter(s => s.section_key === 'promo_banner')
    .sort((a, b) => (a.position || 1) - (b.position || 1));

  // Singletons: one card each (announcement_bar, monthly_offers)
  let html = singletonMetas.map(meta => {
    const row = homeSections.find(s => s.section_key === meta.key);
    return offerCardHTML(meta, row);
  }).join('');

  // Promo banners — section heading + "Add" button + N cards
  html += `
    <div class="offers-section-divider">
      <div>
        <h3>Promo Banners</h3>
        <p class="label-hint">Multiple banners stack on the home page in order of position</p>
      </div>
      <button class="btn-primary" onclick="openOfferModal('promo_banner', '')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Promo Banner
      </button>
    </div>`;

  if (promoRows.length) {
    html += promoRows.map(row => offerCardHTML(promoMeta, row)).join('');
  } else {
    html += `<div class="table-empty">No promo banners yet — the storefront shows the default "Up to 70% Off" panel until you add one.</div>`;
  }

  grid.innerHTML = html;
}

async function toggleOfferActive(id, makeActive) {
  const { error } = await sb
    .from('home_sections')
    .update({ is_active: makeActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast(makeActive ? 'Section activated ✓' : 'Section hidden ✓');
  await fetchHomeSections();
}

async function deleteOffer(id) {
  if (!confirm('Delete this section? The storefront will revert to its hardcoded default.')) return;
  const row = homeSections.find(s => s.id === id);
  // Clean up the storage file if this section had an admin-uploaded image
  if (row?.image_path && !row.image_path.startsWith('http')) {
    await sb.storage.from(BUCKET).remove([row.image_path]);
  }
  const { error } = await sb.from('home_sections').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message); return; }
  toast('Deleted ✓');
  await fetchHomeSections();
}

function openOfferModal(sectionKey, id = '') {
  const meta = OFFER_SECTIONS.find(s => s.key === sectionKey);
  if (!meta) return;
  // If editing, look up by id; otherwise start with empty defaults.
  const row = id ? (homeSections.find(s => s.id === id) || {}) : {};

  document.getElementById('offerForm').reset();
  document.getElementById('offerModalTitle').textContent = (id ? 'Edit ' : 'Add ') + meta.label;
  // Stash the editing id and section_key on the hidden inputs
  document.getElementById('oSectionKey').value   = sectionKey;
  const oEditId = document.getElementById('oEditId');
  if (oEditId) oEditId.value = id || '';
  document.getElementById('oExistingImg').value  = row.image_path || '';
  document.getElementById('oEyebrow').value      = row.eyebrow || '';
  document.getElementById('oTitle').value        = row.title || '';
  document.getElementById('oSubtitle').value     = row.subtitle || '';
  document.getElementById('oButtonLabel').value  = row.button_label || '';
  document.getElementById('oButtonTarget').value = row.button_target || 'shop';

  // Show/hide button + image fields based on whether this section supports them
  document.getElementById('oButtonFields').style.display = meta.hasButton ? '' : 'none';
  document.getElementById('oImgUploadZone').style.display = meta.hasImage ? '' : 'none';

  // The announcement bar is just a list of scrolling messages. Hide
  // eyebrow + title; relabel the subtitle textarea as "Messages".
  const eyebrowGroup = document.getElementById('oEyebrow').closest('.form-group');
  const titleGroup   = document.getElementById('oTitle').closest('.form-group');
  const subtitleLabel = document.getElementById('oSubtitle').closest('.form-group').querySelector('label');
  if (meta.messagesField) {
    if (eyebrowGroup) eyebrowGroup.style.display = 'none';
    if (titleGroup)   titleGroup.style.display   = 'none';
    if (subtitleLabel) subtitleLabel.innerHTML = 'Messages <span class="label-hint">(one per line — they scroll left across the top of every page)</span>';
    document.getElementById('oSubtitle').rows = 5;
  } else {
    if (eyebrowGroup) eyebrowGroup.style.display = '';
    if (titleGroup)   titleGroup.style.display   = '';
    if (subtitleLabel) subtitleLabel.textContent = 'Subtitle';
    document.getElementById('oSubtitle').rows = 2;
  }

  // Adjust the title hint based on which markup is allowed for this section
  const hintEl = document.getElementById('oTitleHint');
  if (hintEl) {
    hintEl.textContent = meta.key === 'promo_banner'
      ? '(supports <br> for line break and <span>…</span> for gold accent)'
      : '(plain text)';
  }

  selectedOfferImg = null;
  clearOfferImgPreview();
  if (meta.hasImage && row.image_path) showOfferImgPreview(imgUrl(row.image_path));

  document.getElementById('offerModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeOfferModal() {
  document.getElementById('offerModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  selectedOfferImg = null;
  clearOfferImgPreview();
}

function handleOfferImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
  selectedOfferImg = file;
  showOfferImgPreview(URL.createObjectURL(file));
}

function showOfferImgPreview(url) {
  document.getElementById('oImgPlaceholder').style.display = 'none';
  const img = document.getElementById('oImgPreview');
  img.src = url; img.style.display = 'block';
  document.getElementById('oImgRemoveBtn').style.display = 'inline-flex';
}

function clearOfferImgPreview() {
  const ph = document.getElementById('oImgPlaceholder');
  if (ph) ph.style.display = 'flex';
  const img = document.getElementById('oImgPreview');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const rm = document.getElementById('oImgRemoveBtn');
  if (rm) rm.style.display = 'none';
  const fi = document.getElementById('oImgFileInput');
  if (fi) fi.value = '';
}

function removeOfferImg(e) {
  e.stopPropagation();
  selectedOfferImg = null;
  document.getElementById('oExistingImg').value = '';
  clearOfferImgPreview();
}

async function submitOffer(e) {
  e.preventDefault();
  setLoading('offer', true);

  const sectionKey = document.getElementById('oSectionKey').value;
  const meta = OFFER_SECTIONS.find(s => s.key === sectionKey);

  let imagePath = document.getElementById('oExistingImg').value || null;
  if (meta?.hasImage && selectedOfferImg) {
    const ext  = selectedOfferImg.name.split('.').pop().toLowerCase();
    const path = `offers/${sectionKey}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, selectedOfferImg, { cacheControl: '3600' });
    if (upErr) { setLoading('offer', false); toast('Upload failed: ' + upErr.message); return; }
    imagePath = path;
  }

  const editId = document.getElementById('oEditId')?.value || '';

  const payload = {
    section_key:   sectionKey,
    eyebrow:       document.getElementById('oEyebrow').value.trim() || null,
    title:         document.getElementById('oTitle').value.trim() || null,
    subtitle:      document.getElementById('oSubtitle').value.trim() || null,
    button_label:  meta?.hasButton ? (document.getElementById('oButtonLabel').value.trim() || null) : null,
    button_target: meta?.hasButton ? (document.getElementById('oButtonTarget').value || null) : null,
    image_path:    meta?.hasImage ? imagePath : null,
    updated_at:    new Date().toISOString(),
  };

  let error;
  if (editId) {
    // Update existing row by id
    const res = await sb.from('home_sections').update(payload).eq('id', editId);
    error = res.error;
  } else if (sectionKey === 'promo_banner') {
    // New promo banner — assign next position
    const maxPos = homeSections
      .filter(s => s.section_key === 'promo_banner')
      .reduce((m, s) => Math.max(m, s.position || 0), 0);
    const res = await sb.from('home_sections').insert({ ...payload, position: maxPos + 1 });
    error = res.error;
  } else {
    // New singleton (announcement_bar / monthly_offers) — only one should exist
    const res = await sb.from('home_sections').insert(payload);
    error = res.error;
  }

  setLoading('offer', false);
  if (error) { toast('Error: ' + error.message); return; }

  toast('Section saved ✓');
  closeOfferModal();
  await fetchHomeSections();
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
    const url   = imgUrl(c.image_path);
    return `<tr>
      <td>${url ? `<img class="table-thumb" src="${url}" alt="" />` : `<div class="table-thumb-placeholder">IMG</div>`}</td>
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
  document.getElementById('cExistingImg').value = '';
  selectedCollectionImg = null;
  clearCollectionImgPreview();
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
  document.getElementById('cExistingImg').value = c.image_path || '';
  if (c.image_path) showCollectionImgPreview(imgUrl(c.image_path));
}

function closeCollectionModal() {
  document.getElementById('collectionModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  selectedCollectionImg = null;
  clearCollectionImgPreview();
}

async function submitCollection(e) {
  e.preventDefault();
  setLoading('collection', true);

  let imagePath = document.getElementById('cExistingImg').value || null;
  if (selectedCollectionImg) {
    const ext  = selectedCollectionImg.name.split('.').pop().toLowerCase();
    const path = `collections/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, selectedCollectionImg, { cacheControl: '3600' });
    if (upErr) { setLoading('collection', false); toast('Upload failed: ' + upErr.message); return; }
    imagePath = path;
  }

  const editId  = document.getElementById('cEditId').value;
  const payload = {
    name:        document.getElementById('cName').value.trim(),
    description: document.getElementById('cDesc').value.trim() || null,
    image_path:  imagePath,
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

/* Collection image upload helpers (mirror the product/bundle ones) */
function handleCollectionImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
  selectedCollectionImg = file;
  showCollectionImgPreview(URL.createObjectURL(file));
}

function showCollectionImgPreview(url) {
  document.getElementById('cImgPlaceholder').style.display = 'none';
  const img = document.getElementById('cImgPreview');
  img.src = url; img.style.display = 'block';
  document.getElementById('cImgRemoveBtn').style.display = 'inline-flex';
}

function clearCollectionImgPreview() {
  const ph = document.getElementById('cImgPlaceholder');
  if (ph) ph.style.display = 'flex';
  const img = document.getElementById('cImgPreview');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const rm = document.getElementById('cImgRemoveBtn');
  if (rm) rm.style.display = 'none';
  const fi = document.getElementById('cImgFileInput');
  if (fi) fi.value = '';
}

function removeCollectionImg(e) {
  e.stopPropagation();
  selectedCollectionImg = null;
  document.getElementById('cExistingImg').value = '';
  clearCollectionImgPreview();
}

/* ── BUNDLES TABLE ─────────────────────────────────────────── */
function bundleProductsSummary(b) {
  const items = b.bundle_items || [];
  if (!items.length) return '<span style="color:var(--text-muted)">No products</span>';
  return items.map(bi => {
    const p = products.find(x => x.id === bi.product_id);
    const name = p ? p.name : '(deleted product)';
    return `${esc(name)} × ${bi.quantity}`;
  }).join(', ');
}

function bundleOriginalTotal(b) {
  const items = b.bundle_items || [];
  return items.reduce((sum, bi) => {
    const p = products.find(x => x.id === bi.product_id);
    return sum + (p ? Number(p.price) * bi.quantity : 0);
  }, 0);
}

function renderBundleTable(list = bundles) {
  const body  = document.getElementById('bundlesBody');
  const empty = document.getElementById('bundlesEmpty');
  if (!body) return;

  if (!list.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('#bundlesTable').style.display = 'none';
    return;
  }
  document.querySelector('#bundlesTable').style.display = '';
  empty.style.display = 'none';

  body.innerHTML = list.map(b => {
    const url    = imgUrl(b.image_path);
    const orig   = bundleOriginalTotal(b);
    const price  = Number(b.bundle_price);
    const saving = orig > price ? (orig - price) : 0;
    return `<tr>
      <td>${url ? `<img class="table-thumb" src="${url}" alt="" />` : `<div class="table-thumb-placeholder">IMG</div>`}</td>
      <td><strong>${esc(b.name)}</strong>${b.description ? `<br><small style="color:var(--text-muted)">${esc(b.description.slice(0,60))}${b.description.length>60?'…':''}</small>` : ''}</td>
      <td style="font-size:.82rem;color:var(--text-muted)">${bundleProductsSummary(b)}</td>
      <td><strong>KWD ${price.toFixed(3)}</strong>${orig > price ? `<br><small style="color:var(--text-muted);text-decoration:line-through">KWD ${orig.toFixed(3)}</small>` : ''}</td>
      <td>${saving > 0 ? `<span class="pill" style="background:#DCFCE7;color:#15803D">−KWD ${saving.toFixed(3)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="pill ${b.is_active ? 'pill-active' : 'pill-inactive'}">${b.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-btn" onclick="openEditBundle('${b.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="row-btn danger" onclick="confirmDelete('bundle','${b.id}','${esc(b.name)}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterBundleTable() {
  const q = document.getElementById('bundleSearch').value.toLowerCase();
  renderBundleTable(bundles.filter(b =>
    b.name.toLowerCase().includes(q) || (b.description||'').toLowerCase().includes(q)
  ));
}

/* ── BUNDLE MODAL ──────────────────────────────────────────── */
function openBundleModal(id = null) {
  resetBundleForm();
  document.getElementById('bundleModalTitle').textContent = id ? 'Edit Bundle' : 'Add Bundle';
  document.getElementById('bundleSubmitText').textContent = id ? 'Save Changes' : 'Save Bundle';
  document.getElementById('bEditId').value = id || '';
  if (!id) addBundleItemRow();
  document.getElementById('bundleModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  updateBundleOriginalTotal();
}

function openEditBundle(id) {
  const b = bundles.find(x => x.id === id);
  if (!b) return;
  openBundleModal(id);
  document.getElementById('bName').value     = b.name || '';
  document.getElementById('bPrice').value    = b.bundle_price ?? '';
  document.getElementById('bDesc').value     = b.description || '';
  document.getElementById('bBadge').value    = b.badge || '';
  document.getElementById('bActive').checked = b.is_active !== false;
  document.getElementById('bExistingImg').value = b.image_path || '';
  if (b.image_path) showBundleImgPreview(imgUrl(b.image_path));

  document.getElementById('bundleItemsWrap').innerHTML = '';
  (b.bundle_items || []).forEach(bi => addBundleItemRow(bi));
  if (!(b.bundle_items || []).length) addBundleItemRow();
  updateBundleOriginalTotal();
}

function closeBundleModal() {
  document.getElementById('bundleModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  resetBundleForm();
}

function resetBundleForm() {
  document.getElementById('bundleForm').reset();
  document.getElementById('bEditId').value      = '';
  document.getElementById('bExistingImg').value = '';
  document.getElementById('bundleItemsWrap').innerHTML = '';
  selectedBundleImg = null;
  clearBundleImgPreview();
  const tot = document.getElementById('bundleOriginalTotal');
  if (tot) tot.textContent = '';
}

function addBundleItemRow(existing = null) {
  const wrap = document.getElementById('bundleItemsWrap');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'variant-row bundle-item-row';
  const opts = '<option value="">— Select product —</option>' +
    products.map(p => `<option value="${p.id}" ${existing && existing.product_id === p.id ? 'selected' : ''}>${esc(p.name)} (KWD ${Number(p.price).toFixed(3)})</option>`).join('');
  row.innerHTML = `
    <select class="bi-product" onchange="updateBundleOriginalTotal()" style="flex:1">${opts}</select>
    <input type="number" class="bi-qty" min="1" value="${existing ? existing.quantity : 1}" oninput="updateBundleOriginalTotal()" style="width:80px" />
    <button type="button" class="variant-del" onclick="this.parentElement.remove(); updateBundleOriginalTotal()">✕</button>`;
  wrap.appendChild(row);
}

function collectBundleItems() {
  return Array.from(document.querySelectorAll('.bundle-item-row')).map(r => ({
    product_id: r.querySelector('.bi-product').value,
    quantity:   parseInt(r.querySelector('.bi-qty').value) || 0,
  })).filter(bi => bi.product_id && bi.quantity > 0);
}

function updateBundleOriginalTotal() {
  const items = collectBundleItems();
  const total = items.reduce((sum, bi) => {
    const p = products.find(x => x.id === bi.product_id);
    return sum + (p ? Number(p.price) * bi.quantity : 0);
  }, 0);
  const price = parseFloat(document.getElementById('bPrice')?.value) || 0;
  const el    = document.getElementById('bundleOriginalTotal');
  if (!el) return;
  if (!items.length) { el.textContent = ''; return; }
  const savings = total - price;
  el.innerHTML = `Original total: <strong>KWD ${total.toFixed(3)}</strong>` +
    (price > 0 && savings > 0 ? `  ·  Customer saves <strong style="color:#15803D">KWD ${savings.toFixed(3)}</strong>` : '');
}

document.addEventListener('input', e => {
  if (e.target && e.target.id === 'bPrice') updateBundleOriginalTotal();
});

async function submitBundle(e) {
  e.preventDefault();

  const items = collectBundleItems();
  if (!items.length) {
    toast('Add at least one product to the bundle.');
    return;
  }
  const seen = new Set();
  for (const bi of items) {
    if (seen.has(bi.product_id)) { toast('Each product can only appear once in a bundle.'); return; }
    seen.add(bi.product_id);
  }

  setLoading('bundle', true);

  let imagePath = document.getElementById('bExistingImg').value || null;
  if (selectedBundleImg) {
    const { path, error } = await uploadBundleImg(selectedBundleImg);
    if (error) { toast('Upload failed: ' + error.message); setLoading('bundle', false); return; }
    imagePath = path;
  }

  const payload = {
    name:         document.getElementById('bName').value.trim(),
    description:  document.getElementById('bDesc').value.trim() || null,
    bundle_price: parseFloat(document.getElementById('bPrice').value),
    badge:        document.getElementById('bBadge').value || null,
    is_active:    document.getElementById('bActive').checked,
    image_path:   imagePath,
  };

  const editId = document.getElementById('bEditId').value;
  let bundleId = editId;
  let error;

  if (editId) {
    const res = await sb.from('bundles').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await sb.from('bundles').insert(payload).select().single();
    error = res.error;
    bundleId = res.data?.id;
  }

  if (error) { setLoading('bundle', false); toast('Error: ' + error.message); return; }

  await sb.from('bundle_items').delete().eq('bundle_id', bundleId);
  if (items.length) {
    const rows = items.map(bi => ({ bundle_id: bundleId, product_id: bi.product_id, quantity: bi.quantity }));
    const ins = await sb.from('bundle_items').insert(rows);
    if (ins.error) { setLoading('bundle', false); toast('Saved bundle, but items failed: ' + ins.error.message); return; }
  }

  setLoading('bundle', false);
  toast(editId ? 'Bundle updated ✓' : 'Bundle added ✓');
  closeBundleModal();
  await fetchBundles();
  updateStats();
  renderDashboard();
}

function handleBundleImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
  selectedBundleImg = file;
  showBundleImgPreview(URL.createObjectURL(file));
}

function showBundleImgPreview(url) {
  document.getElementById('bImgPlaceholder').style.display = 'none';
  const img = document.getElementById('bImgPreview');
  img.src = url; img.style.display = 'block';
  document.getElementById('bImgRemoveBtn').style.display = 'inline-flex';
}

function clearBundleImgPreview() {
  const ph = document.getElementById('bImgPlaceholder');
  if (ph) ph.style.display = 'flex';
  const img = document.getElementById('bImgPreview');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const rm = document.getElementById('bImgRemoveBtn');
  if (rm) rm.style.display = 'none';
  const fi = document.getElementById('bImgFileInput');
  if (fi) fi.value = '';
}

function removeBundleImg(e) {
  e.stopPropagation();
  selectedBundleImg = null;
  document.getElementById('bExistingImg').value = '';
  clearBundleImgPreview();
}

async function uploadBundleImg(file) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `bundles/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600' });
  if (error) return { path: null, error };
  return { path, error: null };
}

/* ── PROMOTIONS ─────────────────────────────────────────────
   Real discounts that change prices on the storefront and at
   checkout (server enforces via the place_order RPC).
   ────────────────────────────────────────────────────────── */
const PROMO_TYPE_LABELS = {
  percent_off:             'X% off',
  buy_x_get_y_free:        'Buy X, get Y free',
  buy_x_get_y_percent_off: 'Buy X, get Y at Z% off',
};

function promotionSummary(pr) {
  if (pr.type === 'percent_off')             return `${pr.percent || 0}% off`;
  if (pr.type === 'buy_x_get_y_free')        return `Buy ${pr.buy_qty || 0}, get ${pr.get_qty || 0} free`;
  if (pr.type === 'buy_x_get_y_percent_off') return `Buy ${pr.buy_qty || 0}, get ${pr.get_qty || 0} at ${pr.percent || 0}% off`;
  return pr.type;
}

async function fetchPromotions() {
  const { data, error } = await sb
    .from('promotions')
    .select('*, collections(name)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); promotions = []; renderPromotionTable(); return; }
  promotions = data || [];
  renderPromotionTable();
  const badge = document.getElementById('navPromotionCount');
  if (badge) badge.textContent = promotions.length;
}

function renderPromotionTable(list = promotions) {
  const body  = document.getElementById('promotionsBody');
  const empty = document.getElementById('promotionsEmpty');
  if (!body) return;

  if (!list.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('#promotionsTable').style.display = 'none';
    return;
  }
  document.querySelector('#promotionsTable').style.display = '';
  empty.style.display = 'none';

  body.innerHTML = list.map(pr => {
    const scope = pr.collections?.name
      ? `<span class="pill" style="background:#FEF3C7;color:#92400E">${esc(pr.collections.name)}</span>`
      : `<span class="pill" style="background:#E0F2FE;color:#0369A1">All products</span>`;
    return `<tr>
      <td><strong>${esc(pr.name)}</strong><br><small style="color:var(--text-muted)">${esc(promotionSummary(pr))}</small></td>
      <td>${esc(PROMO_TYPE_LABELS[pr.type] || pr.type)}</td>
      <td>${scope}</td>
      <td><span class="pill ${pr.is_active ? 'pill-active' : 'pill-inactive'}">${pr.is_active ? 'Active' : 'Paused'}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-btn" onclick="togglePromotionActive('${pr.id}', ${!pr.is_active})" title="${pr.is_active ? 'Pause' : 'Activate'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
          </button>
          <button class="row-btn" onclick="openPromotionModal('${pr.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="row-btn danger" onclick="deletePromotion('${pr.id}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openPromotionModal(id = '') {
  document.getElementById('promotionForm').reset();
  document.getElementById('prEditId').value = id || '';
  document.getElementById('promotionModalTitle').textContent = id ? 'Edit Promotion' : 'Add Promotion';
  document.getElementById('promotionSubmitText').textContent = id ? 'Save Changes' : 'Save Promotion';

  // Populate the collection dropdown each time the modal opens (collections may have changed)
  const sel = document.getElementById('prCollection');
  sel.innerHTML = '<option value="">— All products on the site —</option>' +
    collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  if (id) {
    const pr = promotions.find(x => x.id === id);
    if (pr) {
      document.getElementById('prName').value    = pr.name || '';
      document.getElementById('prType').value    = pr.type || 'percent_off';
      document.getElementById('prPercent').value = pr.percent || '';
      document.getElementById('prBuyQty').value  = pr.buy_qty || '';
      document.getElementById('prGetQty').value  = pr.get_qty || '';
      document.getElementById('prCollection').value = pr.collection_id || '';
      document.getElementById('prActive').checked   = pr.is_active !== false;
    }
  } else {
    document.getElementById('prType').value = 'percent_off';
    document.getElementById('prActive').checked = true;
  }

  onPromotionTypeChange();
  document.getElementById('promotionModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePromotionModal() {
  document.getElementById('promotionModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

// Show/hide the parameter fields based on the chosen type
function onPromotionTypeChange() {
  const type = document.getElementById('prType').value;
  const showPct  = (type === 'percent_off' || type === 'buy_x_get_y_percent_off');
  const showBxgy = (type === 'buy_x_get_y_free' || type === 'buy_x_get_y_percent_off');
  document.getElementById('prPercentGroup').style.display = showPct  ? '' : 'none';
  document.getElementById('prBxgyGroup').style.display    = showBxgy ? 'grid' : 'none';
}

async function submitPromotion(e) {
  e.preventDefault();
  setLoading('promotion', true);

  const type = document.getElementById('prType').value;
  const percent = parseFloat(document.getElementById('prPercent').value);
  const buyQty  = parseInt(document.getElementById('prBuyQty').value);
  const getQty  = parseInt(document.getElementById('prGetQty').value);

  // Validate per type
  if (type === 'percent_off' && !(percent > 0 && percent <= 100)) {
    setLoading('promotion', false); toast('Enter a percent between 1 and 100.'); return;
  }
  if (type === 'buy_x_get_y_free' && (!(buyQty >= 1) || !(getQty >= 1))) {
    setLoading('promotion', false); toast('Buy and get quantities must be at least 1.'); return;
  }
  if (type === 'buy_x_get_y_percent_off' && (!(buyQty >= 1) || !(getQty >= 1) || !(percent > 0 && percent <= 100))) {
    setLoading('promotion', false); toast('Fill X, Y, and the percent (1-100).'); return;
  }

  const payload = {
    name:          document.getElementById('prName').value.trim(),
    type,
    collection_id: document.getElementById('prCollection').value || null,
    percent:       (type === 'percent_off' || type === 'buy_x_get_y_percent_off') ? percent : null,
    buy_qty:       (type === 'buy_x_get_y_free' || type === 'buy_x_get_y_percent_off') ? buyQty : null,
    get_qty:       (type === 'buy_x_get_y_free' || type === 'buy_x_get_y_percent_off') ? getQty : null,
    is_active:     document.getElementById('prActive').checked,
  };

  const editId = document.getElementById('prEditId').value;
  const { error } = editId
    ? await sb.from('promotions').update(payload).eq('id', editId)
    : await sb.from('promotions').insert(payload);

  setLoading('promotion', false);
  if (error) { toast('Error: ' + error.message); return; }

  toast(editId ? 'Promotion updated ✓' : 'Promotion added ✓');
  closePromotionModal();
  await fetchPromotions();
}

async function togglePromotionActive(id, makeActive) {
  const { error } = await sb.from('promotions').update({ is_active: makeActive }).eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast(makeActive ? 'Promotion activated ✓' : 'Promotion paused ✓');
  await fetchPromotions();
}

async function deletePromotion(id) {
  if (!confirm('Delete this promotion?')) return;
  const { error } = await sb.from('promotions').delete().eq('id', id);
  if (error) { toast('Delete failed: ' + error.message); return; }
  toast('Promotion deleted ✓');
  await fetchPromotions();
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
          ${items.map(i => {
            const isBundle = !!i.bundles;
            const label    = isBundle
              ? `<span class="pill" style="background:#FEF3C7;color:#92400E;margin-right:6px">Bundle</span>${esc(i.bundles?.name || 'Bundle')}`
              : esc(i.products?.name || 'Product');
            return `
            <div class="order-item-row">
              <span class="order-item-name">${label}</span>
              <span class="order-item-qty">× ${i.quantity}</span>
              <span class="order-item-price">KWD ${(i.unit_price * i.quantity).toFixed(3)}</span>
            </div>`;
          }).join('')}
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
  const labels = { product: 'Product', collection: 'Collection', bundle: 'Bundle' };
  document.getElementById('deleteTitle').textContent = `Delete ${labels[type] || 'Item'}?`;
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
    } else if (type === 'bundle') {
      const b = bundles.find(x => x.id === id);
      if (b?.image_path) await sb.storage.from(BUCKET).remove([b.image_path]);
      await sb.from('bundles').delete().eq('id', id);
      toast('Bundle deleted.');
      await fetchBundles();
    } else {
      const c = collections.find(x => x.id === id);
      if (c?.image_path && !c.image_path.startsWith('http')) {
        await sb.storage.from(BUCKET).remove([c.image_path]);
      }
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
  return Array.from(document.querySelectorAll('.variant-row:not(.bundle-item-row)')).map(r => ({
    name:           r.querySelector('.v-name')?.value.trim(),
    price_modifier: parseFloat(r.querySelector('.v-mod')?.value) || 0,
    quantity:       parseInt(r.querySelector('.v-qty')?.value) || 0,
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

  const titles = { dashboard: 'Dashboard', hero: 'Hero Banner', offers: 'Offers', products: 'Products', collections: 'Collections', bundles: 'Bundles', promotions: 'Promotions', orders: 'Orders', customers: 'Customers' };
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
