// === Mum Atölyesi - Site mantığı ===
// Veriler tarayıcının localStorage'ında saklanır.

const STORE = {
  products: 'ma_products',
  cart: 'ma_cart',
  pwd: 'ma_admin_pwd_hash',
  session: 'ma_admin_session',
  users: 'ma_users',
  userSession: 'ma_user_session',
  orders: 'ma_orders',
  ownerEmail: 'shawlysisters@gmail.com',
  ownerPhone: '+905364051682',
  ownerWhatsapp: '905364051682',
  resetCodes: 'ma_reset_codes',
  adminCode: 'ma_admin_code',
};

// --- Yardımcılar ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmtPrice = (n) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(n) || 0);

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// --- Durum ---
let products = load(STORE.products, []);
let cart = load(STORE.cart, []);
let users = load(STORE.users, []);
let editingId = null;
let pendingImages = []; // Ürün formundaki seçili görseller (data URL veya http URL)
let pendingBundles = []; // Form geçici bundle listesi: [{label, qty, price}]
let pendingVariations = []; // Form geçici varyasyon listesi: [{name, options}]
const MAX_IMAGES = 10;

function migrateProducts(list) {
  return list.map(p => {
    let q = { ...p };
    if (!(q.images && Array.isArray(q.images))) {
      q.images = q.image ? [q.image] : [];
    }
    if (!Array.isArray(q.bundles)) q.bundles = [];
    if (!Array.isArray(q.variations)) q.variations = [];
    if (!q.category) q.category = 'Diğer';
    return q;
  });
}

// Kategori meta — emoji eşlemesi
const CATEGORY_EMOJI = {
  'Düğün Hediyelikleri': '💍',
  'Nişan Hediyelikleri': '💎',
  'Bebek Şekeri': '🍼',
  'Doğum Günü': '🎂',
  'Kına Gecesi': '🌹',
  'Mezuniyet': '🎓',
  'Söz Hediyelikleri': '💝',
  'Özel Tasarım': '✨',
  'Diğer': '🎁',
};

let activeCategory = 'all';

function getCategoryCounts() {
  const map = new Map();
  for (const p of products) {
    const c = p.category || 'Diğer';
    map.set(c, (map.get(c) || 0) + 1);
  }
  return map;
}

function renderCategoryGrid() {
  const wrap = document.getElementById('categoryGrid');
  if (!wrap) return;
  const counts = getCategoryCounts();
  if (!counts.size) {
    wrap.innerHTML = `<p class="empty-state" style="grid-column:1/-1;">Henüz ürün eklenmedi.</p>`;
    return;
  }
  wrap.innerHTML = '';
  for (const [name, count] of counts) {
    const tile = document.createElement('a');
    tile.className = 'category-tile';
    tile.href = '#urunler';
    tile.dataset.cat = name;
    tile.innerHTML = `
      <div class="category-tile-emoji">${CATEGORY_EMOJI[name] || '🎁'}</div>
      <p class="category-tile-name"></p>
      <span class="category-tile-count">${count} ürün</span>
    `;
    tile.querySelector('.category-tile-name').textContent = name;
    tile.addEventListener('click', () => {
      activeCategory = name;
      renderCategoryFilter();
      renderProducts();
    });
    wrap.appendChild(tile);
  }
}

function renderCategoryFilter() {
  const wrap = document.getElementById('categoryFilter');
  if (!wrap) return;
  const counts = getCategoryCounts();
  if (!counts.size) { wrap.innerHTML = ''; return; }
  let html = `<button class="cat-chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">Tümü</button>`;
  for (const [name, count] of counts) {
    html += `<button class="cat-chip ${activeCategory === name ? 'active' : ''}" data-cat="${escapeAttr(name)}">${escapeAttr(name)} (${count})</button>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll('.cat-chip').forEach(b => {
    b.addEventListener('click', () => {
      activeCategory = b.dataset.cat;
      renderCategoryFilter();
      renderProducts();
    });
  });
}

function bundlePrice(p, bundleId) {
  if (!bundleId) return Number(p.price || 0);
  const b = (p.bundles || []).find(x => x.id === bundleId);
  return b ? Number(b.price || 0) : Number(p.price || 0);
}
function bundleLabel(p, bundleId) {
  if (!bundleId) return '1 Adet';
  const b = (p.bundles || []).find(x => x.id === bundleId);
  return b ? b.label : '1 Adet';
}
function variationsKey(choices) {
  if (!choices || !Object.keys(choices).length) return '';
  return Object.entries(choices).sort().map(([k, v]) => `${k}:${v}`).join('|');
}
function cartItemKey(productId, bundleId, choices) {
  return `${productId}::${bundleId || ''}::${variationsKey(choices)}`;
}

products = migrateProducts(products);
save(STORE.products, products);

// Paylaşılan ürün listesini repo'daki products.json'dan yükle.
// Eğer admin değilsen veya henüz yerel ürün eklemediysen, yayınlanan listeyi gösteririz.
// Admin'sen kendi yerel değişikliklerini görmeye devam edersin.
async function syncPublishedProducts() {
  try {
    const res = await fetch('./products.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const published = migrateProducts(await res.json());
    // SADECE yerel liste boşsa ve yayınlanmış liste doluysa onu kullan.
    // Yerel ürünler ASLA otomatik silinmez/üzerine yazılmaz.
    if (products.length === 0 && published.length > 0) {
      products = published;
      save(STORE.products, products);
      renderProducts();
      if (typeof renderAdminList === 'function') renderAdminList();
    }
  } catch (e) { /* products.json yoksa veya file:// üzerinde isek sessizce geç */ }
}

function firstImage(p) {
  if (p.images && p.images.length) return p.images[0];
  return p.image || '';
}
function imageList(p) {
  if (p.images && p.images.length) return p.images;
  return p.image ? [p.image] : [];
}

function currentUser() {
  const id = sessionStorage.getItem(STORE.userSession);
  if (!id) return null;
  return users.find(u => u.id === id) || null;
}

// --- Ürünler ---
function renderProducts() {
  const grid = $('#productGrid');
  const empty = $('#emptyState');
  grid.innerHTML = '';

  if (!products.length) { empty.hidden = false; renderCategoryGrid(); renderCategoryFilter(); return; }
  empty.hidden = true;

  const filtered = activeCategory === 'all'
    ? products
    : products.filter(p => (p.category || 'Diğer') === activeCategory);

  for (const p of filtered) {
    const card = document.createElement('article');
    card.className = 'product-card';
    const totalPrice = Number(p.price || 0);
    const imgs = imageList(p);
    const main = imgs[0] || '';
    const countBadge = imgs.length > 1
      ? `<span class="image-count-badge">📷 ${imgs.length}</span>` : '';

    card.innerHTML = `
      <div class="product-img" data-detail="${p.id}" style="cursor:pointer;">
        ${main
          ? `<img src="${escapeAttr(main)}" alt="${escapeAttr(p.name)}" />`
          : `<div class="placeholder">🕯️</div>`}
        ${countBadge}
      </div>
      <div class="product-body" data-detail="${p.id}" style="cursor:pointer;">
        <h4 class="product-name"></h4>
        <div class="product-foot">
          <div>
            <span class="product-price">${fmtPrice(totalPrice)}</span>
            <small class="muted" style="display:block;">Kargo Dahil Fiyat</small>
          </div>
          <button class="btn primary small" data-add="${p.id}">Sepete Ekle</button>
        </div>
      </div>
    `;
    card.querySelector('.product-name').textContent = p.name;
    grid.appendChild(card);
  }

  renderCategoryGrid();
  renderCategoryFilter();
}

// --- Sepet ---
function addToCart(id, bundleId = null, choices = {}) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  // Eğer bundle tanımlıysa ve seçilmemişse, ilkini varsayılan al
  if (!bundleId && (p.bundles || []).length) {
    bundleId = p.bundles[0].id;
  }
  // Varyasyon zorunluluğu - eksik seçim varsa uyar
  for (const v of (p.variations || [])) {
    if (!choices[v.name]) { toast(`Lütfen ${v.name} seçimi yap.`); return; }
  }
  const key = cartItemKey(id, bundleId, choices);
  const item = cart.find(x => x.key === key);
  if (item) item.qty += 1;
  else cart.push({ key, id, bundleId, choices, qty: 1 });
  save(STORE.cart, cart);
  renderCart();
  toast(`${p.name} sepete eklendi`);
}

function changeQty(key, delta) {
  const item = cart.find(x => x.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.key !== key);
  save(STORE.cart, cart);
  renderCart();
}

function removeFromCart(key) {
  cart = cart.filter(x => x.key !== key);
  save(STORE.cart, cart);
  renderCart();
}

function cartTotal() {
  return cart.reduce((s, it) => {
    const p = products.find(x => x.id === it.id);
    if (!p) return s;
    return s + bundlePrice(p, it.bundleId) * it.qty;
  }, 0);
}

// Eski sepet öğelerini yeni anahtar yapısına taşı
cart = cart.map(it => {
  if (it.key) return it;
  return { ...it, key: cartItemKey(it.id, it.bundleId || null, it.choices || {}), bundleId: it.bundleId || null, choices: it.choices || {} };
});
save(STORE.cart, cart);

function renderCart() {
  const list = $('#cartItems');
  const totalEl = $('#cartTotal');
  const countEl = $('#cartCount');

  list.innerHTML = '';
  let count = 0;

  if (!cart.length) {
    list.innerHTML = `<p class="muted" style="padding:20px 0;text-align:center;">Sepetin şu an boş.</p>`;
  }

  for (const item of cart) {
    const p = products.find(x => x.id === item.id);
    if (!p) continue;
    count += item.qty;
    const unit = bundlePrice(p, item.bundleId);
    const bundleLbl = (p.bundles || []).length ? bundleLabel(p, item.bundleId) : null;
    const choiceLbl = Object.entries(item.choices || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
    const metaParts = [bundleLbl, choiceLbl].filter(Boolean);

    const row = document.createElement('div');
    row.className = 'cart-item';
    const cartImg = firstImage(p);
    row.innerHTML = `
      ${cartImg ? `<img src="${escapeAttr(cartImg)}" alt="" />` : `<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;background:var(--bg-soft);border-radius:10px;">🕯️</div>`}
      <div>
        <div class="ci-name"></div>
        ${metaParts.length ? `<div class="cart-item-meta">${escapeAttr(metaParts.join(' · '))}</div>` : ''}
        <div class="ci-price">${fmtPrice(unit)} <small class="muted">(kargo dahil)</small></div>
        <div class="qty">
          <button data-dec="${escapeAttr(item.key)}">−</button>
          <span>${item.qty}</span>
          <button data-inc="${escapeAttr(item.key)}">+</button>
        </div>
      </div>
      <button class="ci-remove" data-rem="${escapeAttr(item.key)}">Sil</button>
    `;
    row.querySelector('.ci-name').textContent = p.name;
    list.appendChild(row);
  }

  totalEl.textContent = fmtPrice(cartTotal());
  countEl.textContent = count;
  const fc = document.getElementById('floatingCartCount');
  if (fc) fc.textContent = count;
}

// --- Kullanıcı Auth ---
function refreshUserUi() {
  const u = currentUser();
  const userBtn = $('#userBtn');
  const loginBtn = $('#loginBtn');
  const registerBtn = $('#registerBtn');
  const ordersBtn = $('#ordersBtn');
  const adminLink = $('#adminLink');
  if (u) {
    userBtn.textContent = `👤 ${u.username}`;
    userBtn.hidden = false;
    loginBtn.hidden = true;
    registerBtn.hidden = true;
    ordersBtn.hidden = false;
    document.body.classList.add('user-logged-in');
    if (adminLink) { adminLink.hidden = true; adminLink.style.display = 'none'; }
  } else {
    userBtn.hidden = true;
    loginBtn.hidden = false;
    registerBtn.hidden = false;
    ordersBtn.hidden = true;
    document.body.classList.remove('user-logged-in');
    if (adminLink) { adminLink.hidden = false; adminLink.style.display = ''; }
  }
}

// --- Siparişler ---
function getUserOrders(userId) {
  const orders = load(STORE.orders, []);
  return orders.filter(o => o.userId === userId)
               .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// 3 iş günü ekler (Cumartesi/Pazar atlanır)
function estimatedDelivery(createdAtIso) {
  const d = new Date(createdAtIso);
  let added = 0;
  while (added < 3) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function orderStatusInfo(order) {
  const now = new Date();
  const created = new Date(order.createdAt);
  const eta = estimatedDelivery(order.createdAt);
  const daysSince = (now - created) / (1000 * 60 * 60 * 24);

  if (now >= eta) return { key: 'delivered', label: 'Teslim Edildi' };
  if (daysSince >= 1) return { key: 'shipped', label: 'Kargoda' };
  return { key: 'paid', label: 'Hazırlanıyor' };
}

function renderOrders() {
  const u = currentUser();
  const wrap = $('#ordersList');
  wrap.innerHTML = '';
  if (!u) { wrap.innerHTML = `<p class="empty-orders">Giriş yapmalısın.</p>`; return; }

  const orders = getUserOrders(u.id);
  if (!orders.length) {
    wrap.innerHTML = `<p class="empty-orders">Henüz hiç siparişin yok.</p>`;
    return;
  }

  for (const o of orders) {
    const status = orderStatusInfo(o);
    const eta = estimatedDelivery(o.createdAt);
    const card = document.createElement('div');
    card.className = 'order-card';

    const itemsHtml = o.items.map(i => {
      const name = escapeAttr(i.name);
      const meta = [i.bundle, ...Object.entries(i.choices || {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ');
      return `<div>• ${name}${meta ? ' <span class="muted">(' + escapeAttr(meta) + ')</span>' : ''} × ${i.qty} — ${fmtPrice(i.price * i.qty)}</div>`;
    }).join('');

    card.innerHTML = `
      <div class="order-head">
        <div>
          <div class="order-id">Sipariş #${o.id.slice(-8).toUpperCase()}</div>
          <div class="order-date">Sipariş Tarihi: ${new Date(o.createdAt).toLocaleString('tr-TR')}</div>
        </div>
        <span class="status-pill status-${status.key}">${status.label}</span>
      </div>
      <div class="order-items">${itemsHtml}</div>
      <div class="delivery-info">
        <div>
          <div class="delivery-label">Tahmini Teslim (3 iş günü)</div>
          <div class="delivery-date">📦 ${eta.toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' })}</div>
        </div>
        <div style="text-align:right;">
          <div class="delivery-label">Sipariş Tutarı</div>
          <div class="delivery-date">${fmtPrice(o.total)}</div>
        </div>
      </div>

      <div class="order-detail">
        <div class="order-detail-row"><strong>Alıcı:</strong> ${escapeAttr(o.customer.fullName)}</div>
        <div class="order-detail-row"><strong>Telefon:</strong> ${escapeAttr(o.customer.phone)}</div>
        <div class="order-detail-row"><strong>E-posta:</strong> ${escapeAttr(o.customer.email)}</div>
        <div class="order-detail-row"><strong>Adres:</strong> ${escapeAttr(o.customer.address)}, ${escapeAttr(o.customer.city)} ${escapeAttr(o.customer.zip)}</div>
        <div class="order-detail-row"><strong>Ödeme:</strong> ${escapeAttr(o.payment.cardMasked)} (${escapeAttr(o.payment.cardName)})</div>
      </div>
    `;
    wrap.appendChild(card);
  }
}

function silentAdminLogout() {
  // Toast yok, modal kapatma yok — sessizce admin oturumunu sonlandır
  sessionStorage.removeItem(STORE.session);
}

async function registerUser({ username, email, phone, password }) {
  username = username.trim();
  email = email.trim().toLowerCase();
  phone = phone.trim();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase()))
    throw new Error('Bu kullanıcı adı zaten alınmış.');
  if (users.some(u => u.email === email))
    throw new Error('Bu e-posta ile zaten kayıt var.');
  const user = {
    id: 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    username, email, phone,
    pwdHash: await sha256(password),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  save(STORE.users, users);
  sessionStorage.setItem(STORE.userSession, user.id);
  silentAdminLogout();
  refreshUserUi();
  return user;
}

async function loginUser(idOrEmail, password) {
  const key = idOrEmail.trim().toLowerCase();
  const hash = await sha256(password);
  const u = users.find(x =>
    (x.username.toLowerCase() === key || x.email === key) && x.pwdHash === hash
  );
  if (!u) throw new Error('Kullanıcı adı / e-posta ya da şifre hatalı.');
  sessionStorage.setItem(STORE.userSession, u.id);
  silentAdminLogout();
  refreshUserUi();
  return u;
}

// --- Şifre Sıfırlama ---
function generateResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function startPasswordReset(email) {
  email = email.trim().toLowerCase();
  const user = users.find(u => u.email === email);
  if (!user) throw new Error('Bu e-posta ile kayıtlı kullanıcı bulunamadı.');

  const code = generateResetCode();
  const codes = load(STORE.resetCodes, {});
  codes[email] = {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
    userId: user.id,
  };
  save(STORE.resetCodes, codes);

  // Kullanıcıya e-posta açar (mailto)
  const subject = encodeURIComponent('Shawly Sisters - Şifre Sıfırlama Kodu');
  const body = encodeURIComponent(
`Merhaba ${user.username},

Şifre sıfırlama isteğin için doğrulama kodun:

KOD: ${code}

Bu kodu Shawly Sisters sitesinde "Şifremi Unuttum" ekranına gir ve yeni şifreni belirle.
Kodun geçerlilik süresi 15 dakikadır.

Sen istemediysen bu mesajı yok sayabilirsin.`
  );
  window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');

  return code;
}

async function completePasswordReset(email, code, newPwd) {
  email = email.trim().toLowerCase();
  const codes = load(STORE.resetCodes, {});
  const entry = codes[email];
  if (!entry) throw new Error('Önce kod talebinde bulun.');
  if (Date.now() > entry.expiresAt) {
    delete codes[email]; save(STORE.resetCodes, codes);
    throw new Error('Kodun süresi dolmuş, tekrar talep et.');
  }
  if (String(code).trim() !== entry.code) throw new Error('Doğrulama kodu hatalı.');

  const idx = users.findIndex(u => u.id === entry.userId);
  if (idx === -1) throw new Error('Kullanıcı bulunamadı.');
  users[idx].pwdHash = await sha256(newPwd);
  save(STORE.users, users);

  delete codes[email];
  save(STORE.resetCodes, codes);
}

function logoutUser() {
  sessionStorage.removeItem(STORE.userSession);
  refreshUserUi();
  closeModal('accountModal');
  toast('Çıkış yapıldı');
}

// --- Admin Auth (tek şifre) ---
function isAdmin() { return sessionStorage.getItem(STORE.session) === '1'; }

function adminLogout() {
  sessionStorage.removeItem(STORE.session);
  closeModal('adminModal');
  toast('Çıkış yapıldı');
}

async function adminLogin(pwd) {
  const stored = localStorage.getItem(STORE.pwd);
  const hash = await sha256(pwd);
  if (!stored) {
    // İlk girişte verilen şifreyi kalıcı kaydet
    localStorage.setItem(STORE.pwd, hash);
    sessionStorage.setItem(STORE.session, '1');
    return true;
  }
  if (stored === hash) {
    sessionStorage.setItem(STORE.session, '1');
    return true;
  }
  return false;
}

function notifyAdminLogin() {
  const when = new Date().toLocaleString('tr-TR');
  const ua = navigator.userAgent;
  const subject = encodeURIComponent('Shawly Sisters - Yönetici Girişi Yapıldı');
  const body = encodeURIComponent(
`Yönetici girişi başarıyla yapıldı.

Tarih: ${when}
Cihaz: ${ua}

Bu giriş sen değilsen, hemen yönetici şifresini değiştir.`
  );
  const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(STORE.ownerEmail)}&su=${subject}&body=${body}`;
  window.open(url, '_blank');
}

// --- Admin: Ürün CRUD ---
function uid() { return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function resetProductForm() {
  editingId = null;
  pendingImages = [];
  pendingBundles = [];
  pendingVariations = [];
  $('#productId').value = '';
  $('#productName').value = '';
  $('#productCategory').value = '';
  $('#productPrice').value = '';
  $('#productDesc').value = '';
  $('#productImage').value = '';
  $('#productImageUrl').value = '';
  $('#productAmazonUrl').value = '';
  $('#descCount').textContent = '0';
  renderImagePreviews();
  renderBundleRows();
  renderVariationRows();
  $('#saveProductBtn').textContent = 'Ürünü Kaydet';
  $('#cancelEditBtn').hidden = true;
}

function fillProductForm(p) {
  editingId = p.id;
  pendingImages = [...imageList(p)];
  pendingBundles = (p.bundles || []).map(b => ({ ...b }));
  pendingVariations = (p.variations || []).map(v => ({ name: v.name, options: [...(v.options || [])] }));
  $('#productId').value = p.id;
  $('#productName').value = p.name;
  $('#productCategory').value = p.category || '';
  $('#productPrice').value = p.price;
  $('#productDesc').value = p.description || '';
  $('#descCount').textContent = (p.description || '').length;
  $('#productAmazonUrl').value = p.amazonUrl || '';
  const urls = pendingImages.filter(s => !s.startsWith('data:'));
  $('#productImageUrl').value = urls.join('\n');
  $('#productImage').value = '';
  renderImagePreviews();
  renderBundleRows();
  renderVariationRows();
  $('#saveProductBtn').textContent = 'Değişiklikleri Kaydet';
  $('#cancelEditBtn').hidden = false;
  switchAdminTab('add');
}

function renderBundleRows() {
  const wrap = $('#bundleRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!pendingBundles.length) {
    wrap.innerHTML = `<div class="dyn-empty">Henüz bundle eklenmedi. Bundle eklemek istemiyorsan boş bırakabilirsin.</div>`;
    return;
  }
  pendingBundles.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'dyn-row bundle-row';
    row.innerHTML = `
      <input type="text" placeholder="Etiket (örn. 25 Adet)" value="${escapeAttr(b.label || '')}" data-bf="label" data-bi="${i}" />
      <input type="number" min="1" step="1" placeholder="Adet" value="${b.qty || ''}" data-bf="qty" data-bi="${i}" />
      <input type="number" min="0" step="0.01" placeholder="Toplam Fiyat ₺" value="${b.price || ''}" data-bf="price" data-bi="${i}" />
      <button type="button" class="dyn-remove" data-rmbundle="${i}" title="Kaldır">×</button>
    `;
    wrap.appendChild(row);
  });
}

function renderVariationRows() {
  const wrap = $('#variationRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!pendingVariations.length) {
    wrap.innerHTML = `<div class="dyn-empty">Henüz varyasyon eklenmedi. Aşağıdaki "➕ Varyasyon Ekle" butonuna tıkla.</div>`;
    return;
  }
  pendingVariations.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'dyn-row variation-row';
    row.innerHTML = `
      <input type="text" placeholder="Adı (örn. Renk)" value="${escapeAttr(v.name || '')}" data-vf="name" data-vi="${i}" />
      <input type="text" placeholder="Seçenekler (virgülle): Beyaz, Krem, Pembe" value="${escapeAttr((v.options || []).join(', '))}" data-vf="options" data-vi="${i}" />
      <button type="button" class="dyn-remove" data-rmvariation="${i}" title="Kaldır">×</button>
    `;
    wrap.appendChild(row);
  });
}

function renderImagePreviews() {
  const wrap = $('#imagePreviewWrap');
  wrap.innerHTML = '';
  if (!pendingImages.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  pendingImages.forEach((src, idx) => {
    const item = document.createElement('div');
    item.className = 'image-preview-item';
    item.innerHTML = `
      <img src="${escapeAttr(src)}" alt="" />
      <button type="button" class="image-preview-remove" data-rmimg="${idx}" aria-label="Kaldır">×</button>
      ${idx === 0 ? `<span class="image-preview-badge">Kapak</span>` : ''}
    `;
    wrap.appendChild(item);
  });
}

function addPendingImages(items) {
  for (const src of items) {
    if (!src) continue;
    if (pendingImages.length >= MAX_IMAGES) {
      toast(`En fazla ${MAX_IMAGES} görsel ekleyebilirsin.`);
      break;
    }
    pendingImages.push(src);
  }
  renderImagePreviews();
}

function renderAdminList() {
  const wrap = $('#adminProductList');
  wrap.innerHTML = '';
  if (!products.length) { wrap.innerHTML = `<p class="muted">Henüz ürün eklemedin.</p>`; return; }
  for (const p of products) {
    const total = Number(p.price || 0);
    const row = document.createElement('div');
    row.className = 'admin-item';
    const adminImg = firstImage(p);
    const imgs = imageList(p);
    row.innerHTML = `
      ${adminImg ? `<img src="${escapeAttr(adminImg)}" alt="" />` : `<div style="width:56px;height:56px;background:var(--bg-soft);border-radius:8px;display:flex;align-items:center;justify-content:center;">🕯️</div>`}
      <div>
        <div class="ai-name"></div>
        <div class="muted">Kargo Dahil Fiyat${imgs.length > 1 ? ` · 📷 ${imgs.length}` : ''}</div>
      </div>
      <div class="ai-price">${fmtPrice(total)}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn ghost small" data-edit="${p.id}">Düzenle</button>
        <button class="btn ghost small" data-del="${p.id}" style="color:var(--danger);border-color:#e8c7c2;">Sil</button>
      </div>
    `;
    row.querySelector('.ai-name').textContent = p.name;
    wrap.appendChild(row);
  }
}

function renderAdminOrders() {
  const wrap = $('#adminOrdersList');
  wrap.innerHTML = '';
  const orders = load(STORE.orders, []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!orders.length) { wrap.innerHTML = `<p class="muted">Henüz sipariş yok.</p>`; return; }
  for (const o of orders) {
    const status = orderStatusInfo(o);
    const eta = estimatedDelivery(o.createdAt);
    const itemsHtml = o.items.map(i => {
      const meta = [i.bundle, ...Object.entries(i.choices || {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ');
      return `<div>• ${escapeAttr(i.name)}${meta ? ' <span class="muted">(' + escapeAttr(meta) + ')</span>' : ''} × ${i.qty} — ${fmtPrice(i.price * i.qty)}</div>`;
    }).join('');
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-head">
        <div>
          <div class="order-id">Sipariş #${o.id.slice(-8).toUpperCase()}</div>
          <div class="order-date">${new Date(o.createdAt).toLocaleString('tr-TR')}</div>
        </div>
        <span class="status-pill status-${status.key}">${status.label}</span>
      </div>
      <div class="order-items">
        <strong>${escapeAttr(o.customer.fullName)}</strong> · ${escapeAttr(o.customer.phone)} · ${escapeAttr(o.customer.email)}<br>
        <small>${escapeAttr(o.customer.address)}, ${escapeAttr(o.customer.city)} ${escapeAttr(o.customer.zip)}</small>
      </div>
      <div class="order-items">${itemsHtml}</div>
      <div class="delivery-info">
        <div>
          <div class="delivery-label">Tahmini Teslim</div>
          <div class="delivery-date">📦 ${eta.toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' })}</div>
        </div>
        <div style="text-align:right;">
          <div class="delivery-label">Ödeme</div>
          <div style="font-size:13px;">${escapeAttr(o.payment.cardMasked)}</div>
        </div>
      </div>
      <div class="order-total">Toplam: ${fmtPrice(o.total)}</div>
    `;
    wrap.appendChild(card);
  }
}

function switchAdminTab(name) {
  $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.atab === name));
  $$('.admin-pane').forEach(p => p.hidden = p.dataset.apane !== name);
  if (name === 'manage') renderAdminList();
  if (name === 'orders') renderAdminOrders();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleProductSubmit(e) {
  e.preventDefault();
  if (!isAdmin()) { alert('Sadece yönetici ürün ekleyip düzenleyebilir.'); return; }
  const name = $('#productName').value.trim();
  const category = ($('#productCategory').value.trim() || 'Diğer');
  const price = parseFloat($('#productPrice').value);
  const description = $('#productDesc').value.trim();
  const amazonUrl = $('#productAmazonUrl').value.trim();
  if (!name || isNaN(price) || price < 0) { alert('Lütfen ad ve geçerli bir fiyat gir.'); return; }
  if (name.length > 200) { alert('Ürün adı en fazla 200 karakter olabilir.'); return; }
  if (description.length > 5000) { alert('Açıklama en fazla 5000 karakter olabilir.'); return; }

  // URL textarea'sındaki URL'leri pendingImages'a ekle (henüz eklenmemiş olanları)
  const urlText = $('#productImageUrl').value.trim();
  const urls = urlText ? urlText.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  const merged = [];
  for (const src of [...pendingImages.filter(s => s.startsWith('data:')), ...urls]) {
    if (!merged.includes(src)) merged.push(src);
  }
  const images = merged.slice(0, MAX_IMAGES);

  // Geçerli bundle ve varyasyonları topla
  const bundles = pendingBundles
    .filter(b => b.label && Number(b.qty) > 0 && Number(b.price) > 0)
    .map(b => ({
      id: b.id || ('bndl_' + Math.random().toString(36).slice(2, 8)),
      label: b.label.trim(),
      qty: Number(b.qty),
      price: Number(b.price),
    }));
  const variations = pendingVariations
    .filter(v => v.name && (v.options || []).length)
    .map(v => ({ name: v.name.trim(), options: v.options.filter(Boolean) }));

  if (editingId) {
    const idx = products.findIndex(p => p.id === editingId);
    if (idx !== -1) {
      products[idx] = { ...products[idx], name, category, price, description, images, amazonUrl, bundles, variations };
      delete products[idx].image;
    }
    toast('Ürün güncellendi');
  } else {
    products.push({ id: uid(), name, category, price, description, images, amazonUrl, bundles, variations });
    toast('Ürün eklendi');
  }
  save(STORE.products, products);
  renderProducts();
  renderAdminList();
  resetProductForm();
  switchAdminTab('manage');
}

function deleteProduct(id) {
  if (!confirm('Bu ürünü silmek istediğine emin misin?')) return;
  products = products.filter(p => p.id !== id);
  cart = cart.filter(c => c.id !== id);
  save(STORE.products, products);
  save(STORE.cart, cart);
  renderProducts(); renderAdminList(); renderCart();
  toast('Ürün silindi');
}

// --- Modal & Panel ---
function openModal(id) { $('#' + id).classList.add('open'); $('#' + id).setAttribute('aria-hidden','false'); }
function closeModal(id) { $('#' + id).classList.remove('open'); $('#' + id).setAttribute('aria-hidden','true'); }
function openCart() {
  $('#cartPanel').classList.add('open');
  $('#cartPanel').setAttribute('aria-hidden','false');
  document.body.classList.add('cart-open');
}
function closeCart() {
  $('#cartPanel').classList.remove('open');
  $('#cartPanel').setAttribute('aria-hidden','true');
  document.body.classList.remove('cart-open');
}
function exitCartToHome() {
  closeCart();
  // Body class değişimi ve panel transition'ı için iki frame bekle, sonra scroll yap.
  // Sticky header'ın yüksekliği kadar offset bırakırız.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.getElementById('urunler');
    if (!target) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const headerEl = document.querySelector('.site-header');
    const headerH = headerEl ? headerEl.offsetHeight : 70;
    const rect = target.getBoundingClientRect();
    const top = rect.top + window.pageYOffset - headerH - 10;
    window.scrollTo({ top, behavior: 'smooth' });
  }));
}

// --- Checkout ---
function openCheckout() {
  if (!cart.length) { toast('Sepetin boş.'); return; }
  const u = currentUser();
  if (!u) {
    toast('Önce giriş yapmalısın.');
    openAuthModal('login');
    return;
  }
  closeCart();

  // Özet doldur
  const wrap = $('#checkoutItems');
  wrap.innerHTML = '';
  for (const it of cart) {
    const p = products.find(x => x.id === it.id);
    if (!p) continue;
    const unit = bundlePrice(p, it.bundleId);
    const meta = [
      (p.bundles || []).length ? bundleLabel(p, it.bundleId) : null,
      ...Object.entries(it.choices || {}).map(([k, v]) => `${k}: ${v}`)
    ].filter(Boolean).join(' · ');
    const line = document.createElement('div');
    line.className = 'checkout-line';
    const name = document.createElement('span');
    name.textContent = `${p.name}${meta ? ' (' + meta + ')' : ''} × ${it.qty}`;
    const price = document.createElement('span');
    price.textContent = fmtPrice(unit * it.qty);
    line.appendChild(name); line.appendChild(price);
    wrap.appendChild(line);
  }
  $('#checkoutTotal').textContent = fmtPrice(cartTotal());

  // Kullanıcı bilgilerini ön doldur
  $('#coFullName').value = u.username || '';
  $('#coPhone').value = u.phone || '';
  $('#coEmail').value = u.email || '';

  openModal('checkoutModal');
}

function maskCard(num) {
  const n = String(num).replace(/\s+/g, '');
  if (n.length < 4) return '****';
  return '**** **** **** ' + n.slice(-4);
}

function formatCardNumber(v) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}
function formatExp(v) {
  const d = v.replace(/\D/g, '').slice(0, 4);
  if (d.length < 3) return d;
  return d.slice(0, 2) + '/' + d.slice(2);
}

async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const u = currentUser();
  if (!u) { toast('Giriş gerekli.'); return; }

  const order = {
    id: 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
    userId: u.id,
    customer: {
      fullName: $('#coFullName').value.trim(),
      phone: $('#coPhone').value.trim(),
      email: $('#coEmail').value.trim(),
      address: $('#coAddress').value.trim(),
      city: $('#coCity').value.trim(),
      zip: $('#coZip').value.trim(),
    },
    payment: {
      cardName: $('#ccName').value.trim(),
      cardMasked: maskCard($('#ccNumber').value),
      exp: $('#ccExp').value.trim(),
    },
    items: cart.map(it => {
      const p = products.find(x => x.id === it.id);
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        price: bundlePrice(p, it.bundleId),
        qty: it.qty,
        bundle: (p.bundles || []).length ? bundleLabel(p, it.bundleId) : null,
        choices: it.choices || {},
      };
    }).filter(Boolean),
    total: cartTotal(),
    status: 'paid',
  };


  // Sahte ödeme süreci
  const btn = $('#finishOrderBtn');
  btn.disabled = true; btn.textContent = 'Ödeme alınıyor...';
  await new Promise(r => setTimeout(r, 900));

  // Siparişi sakla
  const orders = load(STORE.orders, []);
  orders.push(order);
  save(STORE.orders, orders);

  // Sepeti temizle
  cart = []; save(STORE.cart, cart); renderCart();

  // Satıcıya bildirim için mailto aç (siparişi ben de görebileyim)
  const lines = order.items.map(i => {
    const meta = [i.bundle, ...Object.entries(i.choices || {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ');
    return `• ${i.name}${meta ? ' (' + meta + ')' : ''} × ${i.qty} = ${fmtPrice(i.price * i.qty)}`;
  }).join('\n');
  const body =
`Yeni sipariş geldi!

— Müşteri Bilgileri —
Ad Soyad: ${order.customer.fullName}
Kullanıcı Adı: ${u.username}
Telefon: ${order.customer.phone}
E-posta: ${order.customer.email}

— Teslimat Adresi —
${order.customer.address}
${order.customer.city} / ${order.customer.zip}

— Ürünler —
${lines}

Toplam: ${fmtPrice(order.total)}
Ödeme: ${order.payment.cardMasked} (${order.payment.cardName})
Sipariş No: ${order.id}
Tarih: ${new Date(order.createdAt).toLocaleString('tr-TR')}`;

  const subject = encodeURIComponent(`Yeni Sipariş #${order.id} - ${order.customer.fullName}`);
  const mailto = `mailto:${STORE.ownerEmail}?subject=${subject}&body=${encodeURIComponent(body)}`;
  // Yeni sekmede aç (kullanıcının site akışı bozulmasın)
  window.open(mailto, '_blank');

  btn.disabled = false; btn.textContent = 'Alışverişi Bitir';
  closeModal('checkoutModal');
  e.target.reset();

  const eta = estimatedDelivery(order.createdAt);
  $('#successMsg').textContent =
    `Sipariş No: ${order.id.slice(-8).toUpperCase()} · Tutar: ${fmtPrice(order.total)} · Tahmini teslim: 3 iş günü içinde (${eta.toLocaleDateString('tr-TR')})`;
  openModal('successModal');
}

// --- Auth modal yardımcıları ---
function openAuthModal(tab = 'login') {
  setAuthTab(tab);
  $('#userLoginError').hidden = true;
  $('#userRegisterError').hidden = true;
  openModal('authModal');
}

function setAuthTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tab-pane').forEach(p => p.hidden = p.dataset.pane !== tab);
}

function openAccountModal() {
  const u = currentUser();
  if (!u) return;
  $('#accUsername').textContent = u.username;
  $('#accEmail').textContent = u.email;
  $('#accPhone').textContent = u.phone;
  openModal('accountModal');
}

// --- Olay bağlamaları ---
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches('[data-add]')) {
    const p = products.find(x => x.id === t.dataset.add);
    // Bundle veya varyasyon varsa kullanıcı seçim yapmalı → detayı aç
    if (p && ((p.bundles || []).length || (p.variations || []).length)) {
      openProductDetail(p.id);
    } else {
      addToCart(t.dataset.add);
    }
  }
  else if (t.matches('[data-inc]')) changeQty(t.dataset.inc, +1);
  else if (t.matches('[data-dec]')) changeQty(t.dataset.dec, -1);
  else if (t.matches('[data-rem]')) removeFromCart(t.dataset.rem);
  else if (t.matches('[data-edit]')) {
    const p = products.find(x => x.id === t.dataset.edit);
    if (p) { fillProductForm(p); window.scrollTo({ top: 0 }); $('#productName').focus(); }
  }
  else if (t.matches('[data-del]')) deleteProduct(t.dataset.del);
  else if (t.matches('[data-close]')) {
    const id = t.dataset.close;
    if (id === 'cartPanel') closeCart(); else closeModal(id);
  }
  else if (t.matches('.tab')) setAuthTab(t.dataset.tab);
  else if (t.matches('.admin-tab')) switchAdminTab(t.dataset.atab);
});


$('#cartBtn').addEventListener('click', openCart);
const fcBtn = document.getElementById('floatingCartBtn');
if (fcBtn) fcBtn.addEventListener('click', openCart);
const cartBackBtn = document.getElementById('cartBackBtn');
if (cartBackBtn) cartBackBtn.addEventListener('click', exitCartToHome);

$('#loginBtn').addEventListener('click', () => openAuthModal('login'));
$('#registerBtn').addEventListener('click', () => openAuthModal('register'));
$('#userBtn').addEventListener('click', () => {
  if (currentUser()) openAccountModal();
});

$('#ordersBtn').addEventListener('click', () => {
  if (!currentUser()) { openAuthModal('login'); return; }
  renderOrders();
  openModal('ordersModal');
});


$('#userLogoutBtn').addEventListener('click', logoutUser);

// Şifremi unuttum akışı
$('#forgotPwdLink').addEventListener('click', (e) => {
  e.preventDefault();
  closeModal('authModal');
  $('#forgotStep1').hidden = false;
  $('#forgotStep2').hidden = true;
  $('#forgotEmailError').hidden = true;
  $('#forgotResetError').hidden = true;
  $('#forgotEmail').value = '';
  $('#resetCode').value = '';
  $('#resetNewPwd').value = '';
  $('#resetNewPwd2').value = '';
  openModal('forgotModal');
});

$('#forgotEmailForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#forgotEmailError');
  err.hidden = true;
  try {
    startPasswordReset($('#forgotEmail').value);
    $('#forgotStep1').hidden = true;
    $('#forgotStep2').hidden = false;
    toast('Doğrulama kodu e-postana gönderildi.');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  }
});

$('#forgotResetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#forgotResetError');
  err.hidden = true;
  const pwd = $('#resetNewPwd').value;
  const pwd2 = $('#resetNewPwd2').value;
  if (pwd !== pwd2) { err.textContent = 'Şifreler eşleşmiyor.'; err.hidden = false; return; }
  try {
    await completePasswordReset($('#forgotEmail').value, $('#resetCode').value, pwd);
    closeModal('forgotModal');
    toast('Şifren güncellendi, giriş yapabilirsin.');
    openAuthModal('login');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  }
});

$('#userRegisterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#userRegisterError');
  err.hidden = true;
  try {
    await registerUser({
      username: $('#regUsername').value,
      email: $('#regEmail').value,
      phone: $('#regPhone').value,
      password: $('#regPwd').value,
    });
    closeModal('authModal');
    e.target.reset();
    toast('Kayıt başarılı, hoş geldin!');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  }
});

$('#userLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#userLoginError');
  err.hidden = true;
  try {
    await loginUser($('#userLoginId').value, $('#userLoginPwd').value);
    closeModal('authModal');
    e.target.reset();
    toast('Giriş başarılı');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  }
});

$('#adminLink').addEventListener('click', (e) => {
  e.preventDefault();
  if (currentUser()) {
    toast('Bu alan yöneticiler içindir. Hesabından çıkış yap.');
    return;
  }
  if (isAdmin()) {
    resetProductForm(); switchAdminTab('add'); openModal('adminModal');
    return;
  }
  $('#loginError').hidden = true;
  $('#loginPassword').value = '';
  const stored = localStorage.getItem(STORE.pwd);
  $('#loginHint').textContent = stored
    ? 'Belirlediğin şifreyi gir.'
    : 'İlk girişte istediğin şifreyi belirleyebilirsin (en az 4 karakter).';
  openModal('loginModal');
  setTimeout(() => $('#loginPassword').focus(), 50);
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginError');
  err.hidden = true;
  const pwd = $('#loginPassword').value;
  const stored = localStorage.getItem(STORE.pwd);
  if (!stored && pwd.length < 4) {
    err.textContent = 'Şifre en az 4 karakter olmalı.';
    err.hidden = false; return;
  }
  const ok = await adminLogin(pwd);
  if (ok) {
    closeModal('loginModal');
    resetProductForm(); switchAdminTab('add'); openModal('adminModal');
    toast('Yönetici girişi başarılı');
    notifyAdminLogin();
  } else {
    err.textContent = 'Hatalı şifre.';
    err.hidden = false;
  }
});

$('#productForm').addEventListener('submit', handleProductSubmit);
$('#cancelEditBtn').addEventListener('click', resetProductForm);
$('#logoutBtn').addEventListener('click', adminLogout);

// Görsel önizleme (çoklu)
$('#productImage').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const dataUrls = [];
  for (const file of files) {
    const d = await fileToDataUrl(file);
    dataUrls.push(d);
  }
  addPendingImages(dataUrls);
  e.target.value = '';
});

// Açıklama karakter sayacı
$('#productDesc').addEventListener('input', (e) => {
  $('#descCount').textContent = e.target.value.length;
});

// Önizleme grid'inde X butonu
$('#imagePreviewWrap').addEventListener('click', (e) => {
  if (e.target.matches('[data-rmimg]')) {
    const idx = parseInt(e.target.dataset.rmimg, 10);
    pendingImages.splice(idx, 1);
    renderImagePreviews();
  }
});

// Bundle ekle/kaldır/değiştir
const addBundleBtn = document.getElementById('addBundleBtn');
if (addBundleBtn) addBundleBtn.addEventListener('click', () => {
  pendingBundles.push({ label: '', qty: '', price: '' });
  renderBundleRows();
});
const bundleRowsEl = document.getElementById('bundleRows');
if (bundleRowsEl) {
  bundleRowsEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-rmbundle]')) {
      pendingBundles.splice(parseInt(e.target.dataset.rmbundle, 10), 1);
      renderBundleRows();
    }
  });
  bundleRowsEl.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.bf) return;
    const i = parseInt(t.dataset.bi, 10);
    if (!pendingBundles[i]) return;
    pendingBundles[i][t.dataset.bf] = t.value;
  });
}

// Varyasyon ekle/kaldır/değiştir
const addVariationBtn = document.getElementById('addVariationBtn');
if (addVariationBtn) addVariationBtn.addEventListener('click', () => {
  pendingVariations.push({ name: '', options: [] });
  renderVariationRows();
});
const variationRowsEl = document.getElementById('variationRows');
if (variationRowsEl) {
  variationRowsEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-rmvariation]')) {
      pendingVariations.splice(parseInt(e.target.dataset.rmvariation, 10), 1);
      renderVariationRows();
    }
  });
  variationRowsEl.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.vf) return;
    const i = parseInt(t.dataset.vi, 10);
    if (!pendingVariations[i]) return;
    if (t.dataset.vf === 'options') {
      pendingVariations[i].options = t.value.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      pendingVariations[i][t.dataset.vf] = t.value;
    }
  });
}

// Sepetten ödemeye
$('#checkoutBtn').addEventListener('click', openCheckout);
$('#checkoutForm').addEventListener('submit', handleCheckoutSubmit);

// Kart input formatlama
$('#ccNumber').addEventListener('input', (e) => { e.target.value = formatCardNumber(e.target.value); });
$('#ccExp').addEventListener('input', (e) => { e.target.value = formatExp(e.target.value); });
$('#ccCvv').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

// ESC ile kapat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCart();
    ['loginModal','adminModal','authModal','accountModal','checkoutModal','successModal','ordersModal','forgotModal','productDetailModal','publishSetupModal']
      .forEach(closeModal);
  }
});

// Modalı dışına tıklayınca kapat
$$('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); });
});

// --- Ürün Detayı ---
let pdImages = [];
let pdIndex = 0;
let pdProductId = null;

let pdSelectedBundleId = null;
let pdSelectedChoices = {};

function openProductDetail(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  pdProductId = p.id;
  pdImages = imageList(p);
  pdIndex = 0;

  $('#pdName').textContent = p.name;
  $('#pdDesc').textContent = p.description || 'Açıklama eklenmemiş.';

  // Bundle seçimi (varsa) ilk bundle'ı varsayılan al
  pdSelectedBundleId = (p.bundles || []).length ? p.bundles[0].id : null;
  // Varyasyonlar için her birinde ilk seçeneği seç
  pdSelectedChoices = {};
  for (const v of (p.variations || [])) {
    if (v.options && v.options.length) pdSelectedChoices[v.name] = v.options[0];
  }

  renderPdBundles(p);
  renderPdVariations(p);
  updatePdPrice(p);

  const amazonBtn = $('#pdAmazonBtn');
  if (p.amazonUrl) {
    amazonBtn.href = p.amazonUrl;
    amazonBtn.hidden = false;
  } else {
    amazonBtn.hidden = true;
  }

  renderProductDetailGallery();
  openModal('productDetailModal');
}

function updatePdPrice(p) {
  $('#pdPrice').textContent = fmtPrice(bundlePrice(p, pdSelectedBundleId));
}

function renderPdBundles(p) {
  const sec = $('#pdBundleSection');
  const wrap = $('#pdBundles');
  wrap.innerHTML = '';
  if (!(p.bundles || []).length) { sec.hidden = true; return; }
  sec.hidden = false;
  for (const b of p.bundles) {
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'pd-bundle' + (b.id === pdSelectedBundleId ? ' active' : '');
    const perUnit = b.qty > 0 ? (b.price / b.qty) : b.price;
    div.innerHTML = `
      <span class="bundle-label">${escapeAttr(b.label)}</span>
      <span class="bundle-price">${fmtPrice(b.price)}</span>
      <span class="bundle-unit">${b.qty} adet · ${fmtPrice(perUnit)}/adet</span>
    `;
    div.addEventListener('click', () => {
      pdSelectedBundleId = b.id;
      renderPdBundles(p);
      updatePdPrice(p);
    });
    wrap.appendChild(div);
  }
}

function renderPdVariations(p) {
  const sec = $('#pdVariationSection');
  const wrap = $('#pdVariations');
  wrap.innerHTML = '';
  if (!(p.variations || []).length) { sec.hidden = true; return; }
  sec.hidden = false;
  for (const v of p.variations) {
    const block = document.createElement('div');
    block.className = 'pd-variation';
    const optsHtml = (v.options || []).map(opt => {
      const active = pdSelectedChoices[v.name] === opt ? ' active' : '';
      return `<button type="button" class="pd-variation-opt${active}" data-vname="${escapeAttr(v.name)}" data-vopt="${escapeAttr(opt)}">${escapeAttr(opt)}</button>`;
    }).join('');
    block.innerHTML = `
      <div class="pd-variation-name">${escapeAttr(v.name)}</div>
      <div class="pd-variation-options">${optsHtml}</div>
    `;
    block.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.matches('.pd-variation-opt')) return;
      pdSelectedChoices[t.dataset.vname] = t.dataset.vopt;
      renderPdVariations(p);
    });
    wrap.appendChild(block);
  }
}

function renderProductDetailGallery() {
  const main = pdImages[pdIndex] || '';
  const mainImg = $('#pdMainImgEl');
  if (main) {
    mainImg.src = main;
    mainImg.alt = $('#pdName').textContent;
    $('#pdMainImg').style.display = 'flex';
  } else {
    mainImg.removeAttribute('src');
    $('#pdMainImg').style.display = 'none';
  }

  const thumbs = $('#pdThumbs');
  thumbs.innerHTML = '';
  if (pdImages.length > 1) {
    pdImages.forEach((src, i) => {
      const t = document.createElement('div');
      t.className = 'pd-thumb' + (i === pdIndex ? ' active' : '');
      t.innerHTML = `<img src="${escapeAttr(src)}" alt="" />`;
      t.addEventListener('click', () => { pdIndex = i; renderProductDetailGallery(); });
      thumbs.appendChild(t);
    });
  }
}

$('#pdMainImg').addEventListener('click', () => {
  if (pdProductId) openGallery(pdProductId);
});

$('#pdAddCartBtn').addEventListener('click', () => {
  if (pdProductId) addToCart(pdProductId, pdSelectedBundleId, { ...pdSelectedChoices });
});

// Ürün kartına tıklayınca detayı aç (sepete ekle butonuna tıklanmadıkça)
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-add]')) return;
  const det = e.target.closest('[data-detail]');
  if (det) openProductDetail(det.dataset.detail);
});

// --- Lightbox (Galeri) ---
let lbImages = [];
let lbIndex = 0;

function openGallery(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  lbImages = imageList(p);
  if (!lbImages.length) return;
  lbIndex = 0;
  renderLightbox();
  $('#lightbox').classList.add('open');
  $('#lightbox').setAttribute('aria-hidden', 'false');
}

function renderLightbox() {
  $('#lightboxImg').src = lbImages[lbIndex] || '';
  $('#lightboxCounter').textContent = `${lbIndex + 1} / ${lbImages.length}`;
  $('#lightboxPrev').style.visibility = lbImages.length > 1 ? 'visible' : 'hidden';
  $('#lightboxNext').style.visibility = lbImages.length > 1 ? 'visible' : 'hidden';

  const thumbs = $('#lightboxThumbs');
  thumbs.innerHTML = '';
  if (lbImages.length > 1) {
    lbImages.forEach((src, i) => {
      const t = document.createElement('div');
      t.className = 'lightbox-thumb' + (i === lbIndex ? ' active' : '');
      t.innerHTML = `<img src="${escapeAttr(src)}" alt="" />`;
      t.addEventListener('click', () => { lbIndex = i; renderLightbox(); });
      thumbs.appendChild(t);
    });
  }
}

function closeLightbox() {
  $('#lightbox').classList.remove('open');
  $('#lightbox').setAttribute('aria-hidden', 'true');
}

function lbNext() { if (lbImages.length > 1) { lbIndex = (lbIndex + 1) % lbImages.length; renderLightbox(); } }
function lbPrev() { if (lbImages.length > 1) { lbIndex = (lbIndex - 1 + lbImages.length) % lbImages.length; renderLightbox(); } }

document.addEventListener('click', (e) => {
  const gal = e.target.closest('[data-gallery]');
  if (gal) openGallery(gal.dataset.gallery);
});
$('#lightboxClose').addEventListener('click', closeLightbox);
$('#lightboxPrev').addEventListener('click', lbPrev);
$('#lightboxNext').addEventListener('click', lbNext);
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!$('#lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowRight') lbNext();
  else if (e.key === 'ArrowLeft') lbPrev();
  else if (e.key === 'Escape') closeLightbox();
});

// === Yayınla: GitHub API üzerinden products.json'ı doğrudan günceller ===
const GH_REPO = 'BaharDeveloper/shawly-sisters';
const GH_PATH = 'products.json';
const GH_TOKEN_KEY = 'ma_gh_token';

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function publishProducts() {
  const token = localStorage.getItem(GH_TOKEN_KEY);
  if (!token) {
    document.getElementById('ghTokenError').hidden = true;
    document.getElementById('ghTokenInput').value = '';
    openModal('publishSetupModal');
    return;
  }
  await pushProductsToGitHub(token);
}

async function pushProductsToGitHub(token) {
  const btn = document.getElementById('publishBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Yayınlanıyor...'; }
  try {
    const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Mevcut dosya SHA'sını al
    const getRes = await fetch(url, { headers });
    if (getRes.status === 401) throw new Error('AUTH');
    if (!getRes.ok && getRes.status !== 404) throw new Error('Bağlantı hatası: ' + getRes.status);

    let sha = null;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const json = JSON.stringify(products, null, 2);
    const body = {
      message: `Update products via admin panel (${products.length} ürün)`,
      content: utf8ToBase64(json),
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (putRes.status === 401) throw new Error('AUTH');
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || 'Yayınlama başarısız (' + putRes.status + ')');
    }

    toast('✓ Yayınlandı! 1-2 dakika içinde tüm cihazlarda görünür.');
  } catch (e) {
    if (e.message === 'AUTH') {
      localStorage.removeItem(GH_TOKEN_KEY);
      alert('GitHub token geçersiz veya süresi dolmuş. Lütfen yenisini oluştur.');
      document.getElementById('ghTokenError').hidden = true;
      document.getElementById('ghTokenInput').value = '';
      openModal('publishSetupModal');
    } else {
      alert('Yayınlama hatası: ' + e.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Yayınla'; }
  }
}

const publishBtn = document.getElementById('publishBtn');
if (publishBtn) publishBtn.addEventListener('click', publishProducts);

const saveGhTokenBtn = document.getElementById('saveGhTokenBtn');
if (saveGhTokenBtn) saveGhTokenBtn.addEventListener('click', async () => {
  const token = document.getElementById('ghTokenInput').value.trim();
  const err = document.getElementById('ghTokenError');
  err.hidden = true;
  if (!token || !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    err.textContent = 'Geçerli bir GitHub token gir (ghp_ veya github_pat_ ile başlamalı).';
    err.hidden = false;
    return;
  }
  localStorage.setItem(GH_TOKEN_KEY, token);
  closeModal('publishSetupModal');
  await pushProductsToGitHub(token);
});

// === Hero Slider ===
(function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  if (!slides.length) return;
  let idx = 0;
  let timer = null;

  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === idx));
    dots.forEach((d, k) => d.classList.toggle('active', k === idx));
  }
  function next() { show(idx + 1); }
  function prev() { show(idx - 1); }
  function start() { stop(); timer = setInterval(next, 6000); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  dots.forEach((d, k) => d.addEventListener('click', () => { show(k); start(); }));
  const nextBtn = document.getElementById('heroNext');
  const prevBtn = document.getElementById('heroPrev');
  if (nextBtn) nextBtn.addEventListener('click', () => { next(); start(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { prev(); start(); });

  start();
})();

// İlk yükleme
$('#year').textContent = new Date().getFullYear();
renderProducts();
renderCart();
refreshUserUi();
syncPublishedProducts();
