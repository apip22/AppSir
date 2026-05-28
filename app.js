const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const emptyData = {
  Users: [],
  Settings: [],
  Products: [],
  Suppliers: [],
  Sales: [],
  SaleItems: [],
  Purchases: [],
  PurchaseItems: [],
  Returns: [],
  Report: [],
  StockOpname: [],
};

const persistedSettings = JSON.parse(localStorage.getItem("kasir_settings") || "null") || {};
const state = {
  token: "",
  user: null,
  data: structuredClone(emptyData),
  dashboard: {},
  settings: {
    store_name: "Toko Anda",
    store_subtitle: "Database spreadsheet",
    app_name: "App Sir",
    receipt_store_name: "TOKO ANDA",
    ...persistedSettings,
  },
  saleCart: [],
  purchaseCart: [],
  productSearch: "",
  saleProductSearch: "",
  purchaseProductSearch: "",
  returnProductSearch: "",
  developerSettings: {
    maintenanceMode: false,
    debugMode: false,
    sessionTimeout: 60,
    paginationLimit: 100,
    apiKey: "",
  },
};

const titles = {
  dashboard: "Dashboard",
  sales: "Penjualan",
  purchases: "Pembelian Barang",
  products: "Data Barang",
  suppliers: "Supplier",
  reports: "Laporan",
  returns: "Retur Barang",
  "stock-opname": "Stock Opname",
  users: "User dan Password",
  settings: "Pengaturan",
};

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 16).replace("T", " ");
}

function isActiveSale(sale) {
  return String(sale.status || "active") !== "canceled";
}

function isDeveloper() {
  return state.user && state.user.role === "developer";
}

function isOwner() {
  return state.user && state.user.role === "owner";
}

function isManager() {
  return state.user && (state.user.role === "admin" || state.user.role === "developer" || state.user.role === "owner");
}

function canView(view) {
  if (["dashboard", "sales", "products"].includes(view)) return true;
  if (["purchases", "returns", "suppliers", "reports", "stock-opname", "users", "settings"].includes(view)) return isManager();
  return false;
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.borderColor = isError ? "#ffd8d2" : "rgba(17, 97, 92, 0.18)";
  toast.style.color = isError ? "#b42318" : "#18212f";
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": state.token,
      ...(options.headers || {}),
    },
  };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  const response = await fetch(path, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Permintaan gagal.");
  }
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("File tidak bisa dibaca."));
    reader.readAsDataURL(file);
  });
}

function tokenParam() {
  return state.token ? `?token=${encodeURIComponent(state.token)}` : "";
}

async function downloadSaleReceiptPdf(saleId, invoiceNo) {
  const params = new URLSearchParams();
  if (state.token) params.set("token", state.token);
  params.set("format", "pdf");
  const url = `/receipt/${saleId}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Gagal mengunduh nota. Coba lagi.");
  }
  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `nota-${invoiceNo || saleId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function setDownloadLinks() {
  document.querySelectorAll('a[href^="/download/"]').forEach((link) => {
    const base = link.getAttribute("href").split("?")[0];
    link.setAttribute("href", base + tokenParam());
  });
}

function requireAdminUi() {
  const manager = isManager();
  const developer = isDeveloper();
  $$(".nav-tabs button").forEach((button) => {
    button.style.display = canView(button.dataset.view) ? "" : "none";
  });
  $$(".admin-only").forEach((item) => {
    item.style.display = manager ? "" : "none";
  });
  $$(".developer-only").forEach((item) => {
    item.style.display = developer ? "" : "none";
  });
  $$(".sensitive-only").forEach((item) => {
    item.style.display = manager ? "" : "none";
  });
  if ($(".view.active") && !canView($(".view.active").id.replace("view-", ""))) {
    activateView("dashboard");
  }
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#current-user").textContent = `${state.user?.name || state.user?.username || "-"} (${state.user?.role || "-"})`;
  if ($("#mobile-current-user")) $("#mobile-current-user").textContent = state.user?.name || state.user?.username || "-";
  if ($("#mobile-current-role")) $("#mobile-current-role").textContent = state.user?.role || "-";
  setDownloadLinks();
  applySettings();
  requireAdminUi();
}

function showLogin() {
  $("#app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
}

function applySettings() {
  const settings = state.settings || {};
  const storeName = settings.store_name || "Toko Anda";
  const storeSubtitle = settings.store_subtitle || "Database spreadsheet";
  const appName = settings.app_name || "Aplikasi Kasir Lokal";
  $("#sidebar-store-name").textContent = storeName;
  $("#sidebar-store-subtitle").textContent = storeSubtitle;
  $("#topbar-app-name").textContent = appName;
  if ($("#mobile-store-name")) $("#mobile-store-name").textContent = storeName;
  if ($("#mobile-store-subtitle")) $("#mobile-store-subtitle").textContent = storeSubtitle;
  if ($("#login-app-name")) $("#login-app-name").textContent = appName;
  if ($("#login-store-name")) $("#login-store-name").textContent = storeName;
  if ($("#login-subtitle")) $("#login-subtitle").textContent = `Masuk ke ${appName}`;
  document.title = `${appName} - ${storeName}`;
  if ($("#settings-store-name")) {
    $("#settings-store-name").value = storeName;
    $("#settings-store-subtitle").value = storeSubtitle;
    $("#settings-app-name").value = appName;
    $("#settings-receipt-store-name").value = settings.receipt_store_name || storeName.toUpperCase();
  }
  renderDeveloperSettings();
}

function activateView(view) {
  if (!canView(view)) view = "dashboard";
  $$(".nav-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  $("#view-title").textContent = titles[view] || "Dashboard";
}

async function loadData() {
  const payload = await api("/api/data");
  state.data = { ...structuredClone(emptyData), ...payload.data };
  state.dashboard = payload.dashboard || {};
  state.settings = { ...state.settings, ...(payload.settings || {}) };
  applySettings();
  renderAll();
}

function renderAll() {
  renderDashboard();
  renderProductSelects();
  renderProducts();
  renderSuppliers();
  renderUsers();
  renderSaleCart();
  renderPurchaseCart();
  renderReturnHistory();
  renderReports(state.data.Report || []);
  renderSalesHistory();
  renderDeveloperSettings();
  renderDeveloperSettings();
}

function renderDashboard() {
  $("#metric-sales-today").textContent = money(state.dashboard.sales_today);
  $("#metric-purchases-today").textContent = money(state.dashboard.purchases_today);
  $("#metric-products").textContent = state.dashboard.total_products || 0;
  $("#metric-stock").textContent = state.dashboard.total_stock || 0;

  const lowStock = state.dashboard.low_stock || [];
  $("#low-stock-list").innerHTML = lowStock.length
    ? lowStock
        .map(
          (item) => `
            <div class="stock-item">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <small>${escapeHtml(item.sku || "-")} - minimal ${item.min_stock}</small>
              </div>
              <span class="tag warn">${item.stock} ${escapeHtml(item.unit || "")}</span>
            </div>
          `,
        )
        .join("")
    : "Tidak ada stok rendah.";

  const sales = [...(state.data.Sales || [])].filter(isActiveSale).slice(-7).reverse();
  $("#recent-sales-table").innerHTML = sales.length
    ? sales
        .map(
          (sale) => `
            <tr>
              <td>${escapeHtml(sale.invoice_no)}</td>
              <td>${shortDate(sale.date)}</td>
              <td>${escapeHtml(sale.customer || "Umum")}</td>
              <td>${money(sale.total)}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4">Belum ada penjualan.</td></tr>`;
}

function renderProductSelects() {
  const saleQuery = state.saleProductSearch.trim().toLowerCase();
  const purchaseQuery = state.purchaseProductSearch.trim().toLowerCase();
  const returnQuery = state.returnProductSearch.trim().toLowerCase();
  const saleOptions = (state.data.Products || [])
    .filter((product) => {
      const text = `${product.sku} ${product.name} ${product.category}`.toLowerCase();
      return !saleQuery || text.includes(saleQuery);
    })
    .map((product) => {
      const label = `${product.sku || "-"} - ${product.name} (stok ${product.stock})`;
      return `<option value="${product.id}">${escapeHtml(label)}</option>`;
    })
    .join("");
  const purchaseOptions = (state.data.Products || [])
    .filter((product) => {
      const text = `${product.sku} ${product.name} ${product.category}`.toLowerCase();
      return !purchaseQuery || text.includes(purchaseQuery);
    })
    .map((product) => {
      const label = `${product.sku || "-"} - ${product.name} (stok ${product.stock})`;
      return `<option value="${product.id}">${escapeHtml(label)}</option>`;
    })
    .join("");
  const returnOptions = (state.data.Products || [])
    .filter((product) => {
      const text = `${product.sku} ${product.name} ${product.category}`.toLowerCase();
      return !returnQuery || text.includes(returnQuery);
    })
    .map((product) => {
      const label = `${product.sku || "-"} - ${product.name} (stok ${product.stock})`;
      return `<option value="${product.id}">${escapeHtml(label)}</option>`;
    })
    .join("");

  $("#sale-product").innerHTML = saleOptions || `<option value="">Tidak ada barang</option>`;
  $("#purchase-product").innerHTML = purchaseOptions || `<option value="">Tidak ada barang</option>`;
  $("#return-product").innerHTML = returnOptions || `<option value="">Tidak ada barang</option>`;

  const supplierOptions = [`<option value="">Tanpa supplier</option>`]
    .concat(
      (state.data.Suppliers || []).map(
        (supplier) => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`,
      ),
    )
    .join("");
  $("#purchase-supplier").innerHTML = supplierOptions;
  $("#product-supplier").innerHTML = supplierOptions;

  syncSalePrice();
  syncPurchaseCost();
}

function productById(id) {
  return (state.data.Products || []).find((item) => String(item.id) === String(id));
}

function supplierById(id) {
  return (state.data.Suppliers || []).find((item) => String(item.id) === String(id));
}

function syncSalePrice() {
  const product = productById($("#sale-product").value);
  $("#sale-price").value = product ? number(product.sell_price) : 0;
}

function syncPurchaseCost() {
  const product = productById($("#purchase-product").value);
  $("#purchase-cost").value = product ? number(product.buy_price) : 0;
}

function renderSaleCart() {
  const tbody = $("#sale-cart-table");
  tbody.innerHTML = state.saleCart.length
    ? state.saleCart
        .map(
          (item, index) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.qty}</td>
              <td>${money(item.price)}</td>
              <td>${money(item.qty * item.price)}</td>
              <td class="actions"><button class="danger-btn" type="button" data-remove-sale="${index}">Hapus</button></td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5">Keranjang masih kosong.</td></tr>`;

  const subtotal = state.saleCart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const discount = number($("#sale-discount").value);
  const total = Math.max(subtotal - discount, 0);
  const paid = number($("#sale-paid").value);
  $("#sale-subtotal").textContent = money(subtotal);
  $("#sale-total").textContent = money(total);
  $("#sale-change").textContent = money(paid - total);
}

function renderPurchaseCart() {
  const tbody = $("#purchase-cart-table");
  tbody.innerHTML = state.purchaseCart.length
    ? state.purchaseCart
        .map(
          (item, index) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.qty}</td>
              <td>${money(item.cost)}</td>
              <td>${money(item.qty * item.cost)}</td>
              <td class="actions"><button class="danger-btn" type="button" data-remove-purchase="${index}">Hapus</button></td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5">Daftar pembelian masih kosong.</td></tr>`;

  const total = state.purchaseCart.reduce((sum, item) => sum + item.qty * item.cost, 0);
  $("#purchase-total").textContent = money(total);
}

function renderProducts() {
  const term = state.productSearch.trim().toLowerCase();
  const developer = isDeveloper();
  const rows = (state.data.Products || []).filter((product) => {
    const text = `${product.sku} ${product.name} ${product.category}`.toLowerCase();
    return !term || text.includes(term);
  });
  const colCount = developer ? 7 : 6;
  $("#products-table").innerHTML = rows.length
    ? rows
        .map((product) => {
          const low = number(product.stock) <= number(product.min_stock);
          return `
            <tr>
              <td>${escapeHtml(product.sku || "-")}</td>
              <td><strong>${escapeHtml(product.name)}</strong></td>
              <td>${escapeHtml(product.category || "-")}</td>
              <td><span class="tag ${low ? "warn" : ""}">${product.stock} ${escapeHtml(product.unit || "")}</span></td>
              ${developer ? `<td>${money(product.buy_price)}</td>` : ""}
              <td>${money(product.sell_price)}</td>
              <td class="actions">
                ${
                  developer
                    ? `<button class="soft-btn" type="button" data-edit-product="${product.id}">Edit</button>
                       <button class="danger-btn" type="button" data-delete-product="${product.id}">Hapus</button>`
                    : `<span class="tag">Lihat</span>`
                }
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="${colCount}">Belum ada data barang.</td></tr>`;
}

function renderSuppliers() {
  const suppliers = state.data.Suppliers || [];
  $("#supplier-list").innerHTML = suppliers.length
    ? suppliers
        .map(
          (supplier) => `
            <div class="supplier-item">
              <div>
                <strong>${escapeHtml(supplier.name)}</strong>
                <small>${escapeHtml(supplier.phone || "-")} - ${escapeHtml(supplier.address || "-")}</small>
              </div>
              <div class="actions">
                <button class="soft-btn" type="button" data-edit-supplier="${supplier.id}">Edit</button>
                <button class="danger-btn" type="button" data-delete-supplier="${supplier.id}">Hapus</button>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="list-empty">Belum ada supplier.</div>`;
}

function renderUsers() {
  const users = state.data.Users || [];
  $("#users-table").innerHTML = users.length
    ? users
        .map(
          (user) => `
            <tr>
              <td>${escapeHtml(user.name || "-")}</td>
              <td>${escapeHtml(user.username || "-")}</td>
              <td><span class="tag">${escapeHtml(user.role || "kasir")}</span></td>
              <td>${String(user.active) === "1" ? "Aktif" : "Nonaktif"}</td>
              <td class="actions">
                <button class="soft-btn" type="button" data-edit-user="${user.id}">Edit</button>
                <button class="danger-btn" type="button" data-delete-user="${user.id}">Hapus</button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5">Belum ada user.</td></tr>`;
}

function renderReports(rows) {
  const reportRows = rows || [];
  const totalSales = (state.data.Sales || []).filter(isActiveSale).reduce((sum, sale) => sum + number(sale.total), 0);
  const totalPurchases = (state.data.Purchases || []).reduce((sum, purchase) => sum + number(purchase.total), 0);
  $("#report-total-sales").textContent = money(totalSales);
  $("#report-total-purchases").textContent = money(totalPurchases);
  $("#report-net").textContent = money(totalSales - totalPurchases);

  $("#report-table").innerHTML = reportRows.length
    ? reportRows
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.section || "")}</td>
              <td>${shortDate(row.date)}</td>
              <td>${escapeHtml(row.ref || "")}</td>
              <td>${escapeHtml(row.name || "")}</td>
              <td>${escapeHtml(row.qty || "")}</td>
              <td>${row.in ? money(row.in) : ""}</td>
              <td>${row.out ? money(row.out) : ""}</td>
              <td>${row.total ? money(row.total) : ""}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="8">Belum ada laporan.</td></tr>`;
}

function renderDeveloperSettings() {
  if (!isDeveloper()) {
    $$(".developer-settings").forEach(el => el.style.display = "none");
    return;
  }
  
  $$(".developer-settings").forEach(el => el.style.display = "");
  $("#dev-maintenance-mode").checked = state.developerSettings.maintenanceMode;
  $("#dev-debug-mode").checked = state.developerSettings.debugMode;
  $("#dev-session-timeout").value = state.developerSettings.sessionTimeout;
  $("#dev-pagination-limit").value = state.developerSettings.paginationLimit;
  $("#dev-api-key").value = state.developerSettings.apiKey;
}

function renderReturnHistory() {
  const rows = state.data.Returns || [];
  $("#return-history-table").innerHTML = rows.length
    ? rows
        .map(
          (row) => {
            const supplier = supplierById(row.supplier_id);
            const supplierName = supplier ? supplier.name : "-";
            return `
              <tr>
                <td>${shortDate(row.date)}</td>
                <td>${escapeHtml(row.name || "")}</td>
                <td>${supplierName}</td>
                <td>${row.qty || 0}</td>
                <td>${escapeHtml(row.notes || "")}</td>
              </tr>
            `;
          },
        )
        .join("")
    : `<tr><td colspan="5">Belum ada retur.</td></tr>`;
}

function renderSalesHistory() {
  const rows = [...(state.data.Sales || [])].reverse();
  const manager = isManager();
  $("#sales-history-table").innerHTML = rows.length
    ? rows
        .map((sale) => {
          const active = isActiveSale(sale);
          const status = active ? "Aktif" : "Batal";
          const cancelButton =
            manager && active
              ? `<button class="danger-btn" type="button" data-cancel-sale="${sale.id}">Batalkan dan Kembalikan Stok</button>`
              : "";
          return `
            <tr>
              <td>${escapeHtml(sale.invoice_no || sale.id)}</td>
              <td>${shortDate(sale.date)}</td>
              <td>${escapeHtml(sale.customer || "Umum")}</td>
              <td>${money(sale.total)}</td>
              <td><span class="tag ${active ? "" : "warn"}">${status}</span></td>
              <td class="actions">
                <button class="soft-btn" type="button" data-print-sale="${sale.id}">Buka Nota</button>
                <button class="soft-btn" type="button" data-download-sale="${sale.id}" data-invoice-no="${escapeHtml(sale.invoice_no || sale.id)}">Unduh PDF</button>
                ${cancelButton}
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">Belum ada riwayat penjualan.</td></tr>`;
}

function openProductDialog(product = null) {
  $("#product-dialog-title").textContent = product ? "Edit Barang" : "Tambah Barang";
  $("#product-id").value = product?.id || "";
  $("#product-sku").value = product?.sku || "";
  $("#product-name").value = product?.name || "";
  $("#product-category").value = product?.category || "";
  $("#product-unit").value = product?.unit || "pcs";
  $("#product-stock").value = product?.stock ?? 0;
  $("#product-min-stock").value = product?.min_stock ?? 0;
  $("#product-buy-price").value = product?.buy_price ?? 0;
  $("#product-sell-price").value = product?.sell_price ?? 0;
  $("#product-supplier").value = product?.supplier_id || "";
  $("#product-dialog").showModal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formNumber(id) {
  return number($(id).value);
}

function bindEvents() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/login", {
        method: "POST",
        body: {
          username: $("#login-username").value.trim(),
          password: $("#login-password").value,
        },
      });
      state.token = payload.token;
      state.user = payload.user;
      showApp();
      await loadData();
      showToast("Login berhasil.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (_) {
      // Logout lokal tetap dilakukan ketika sesi server sudah hilang.
    }
    localStorage.removeItem("kasir_token");
    localStorage.removeItem("kasir_user");
    state.token = "";
    state.user = null;
    showLogin();
  });

  $("#refresh-btn").addEventListener("click", async () => {
    await loadData();
    showToast("Data diperbarui.");
  });

  $$(".nav-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      activateView(view);
    });
  });

  $("#sale-product").addEventListener("change", syncSalePrice);
  $("#purchase-product").addEventListener("change", syncPurchaseCost);
  $("#return-product").addEventListener("change", () => {});
  $("#sale-product-search").addEventListener("input", (event) => {
    state.saleProductSearch = event.target.value;
    renderProductSelects();
  });
  $("#purchase-product-search").addEventListener("input", (event) => {
    state.purchaseProductSearch = event.target.value;
    renderProductSelects();
  });
  $("#return-product-search").addEventListener("input", (event) => {
    state.returnProductSearch = event.target.value;
    renderProductSelects();
  });
  $("#sale-discount").addEventListener("input", renderSaleCart);
  $("#sale-paid").addEventListener("input", renderSaleCart);

  $("#sale-item-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const product = productById($("#sale-product").value);
    if (!product) return showToast("Pilih barang lebih dulu.", true);
    const qty = formNumber("#sale-qty");
    if (qty <= 0) return showToast("Qty harus lebih dari 0.", true);
    state.saleCart.push({
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      price: formNumber("#sale-price"),
    });
    const subtotal = state.saleCart.reduce((sum, item) => sum + item.qty * item.price, 0);
    const total = Math.max(subtotal - formNumber("#sale-discount"), 0);
    $("#sale-paid").value = total;
    renderSaleCart();
  });

  $("#sale-cart-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-sale]");
    if (!button) return;
    state.saleCart.splice(Number(button.dataset.removeSale), 1);
    renderSaleCart();
  });

  $("#clear-sale-cart").addEventListener("click", () => {
    state.saleCart = [];
    renderSaleCart();
  });

  $("#sale-checkout-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/sales", {
        method: "POST",
        body: {
          customer: $("#sale-customer").value || "Umum",
          payment_method: $("#sale-method").value,
          discount: formNumber("#sale-discount"),
          paid: formNumber("#sale-paid"),
          items: state.saleCart.map((item) => ({
            product_id: item.product_id,
            qty: item.qty,
            price: item.price,
          })),
        },
      });
      state.saleCart = [];
      $("#sale-customer").value = "";
      $("#sale-discount").value = 0;
      $("#sale-paid").value = 0;
      await loadData();
      window.open(`/receipt/${payload.sale.id}${tokenParam()}`, "_blank", "width=420,height=680");
      showToast("Penjualan tersimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#purchase-item-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const product = productById($("#purchase-product").value);
    if (!product) return showToast("Pilih barang lebih dulu.", true);
    const qty = formNumber("#purchase-qty");
    if (qty <= 0) return showToast("Qty harus lebih dari 0.", true);
    state.purchaseCart.push({
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      cost: formNumber("#purchase-cost"),
    });
    renderPurchaseCart();
  });

  $("#purchase-cart-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-purchase]");
    if (!button) return;
    state.purchaseCart.splice(Number(button.dataset.removePurchase), 1);
    renderPurchaseCart();
  });

  $("#clear-purchase-cart").addEventListener("click", () => {
    state.purchaseCart = [];
    renderPurchaseCart();
  });

  $("#purchase-save-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/purchases", {
        method: "POST",
        body: {
          supplier_id: $("#purchase-supplier").value,
          notes: $("#purchase-notes").value,
          items: state.purchaseCart.map((item) => ({
            product_id: item.product_id,
            qty: item.qty,
            cost: item.cost,
          })),
        },
      });
      state.purchaseCart = [];
      $("#purchase-notes").value = "";
      await loadData();
      showToast("Pembelian tersimpan dan stok bertambah.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#import-return-btn").addEventListener("click", () => $("#return-import-file").click());
  $("#return-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const content = await fileToBase64(file);
      const result = await api("/api/returns/import", {
        method: "POST",
        body: {
          filename: file.name,
          content_base64: content,
        },
      });
      await loadData();
      const errors = result.errors || [];
      const detail = errors.length ? ` Ada ${errors.length} baris dilewati.` : "";
      showToast(`Import retur selesai: ${result.created || 0} retur.${detail}`);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#import-purchase-btn").addEventListener("click", () => $("#purchase-import-file").click());
  $("#purchase-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirm("Import Excel akan menambah barang baru dan mengubah barang lama berdasarkan id atau SKU. Lanjutkan?")) {
      return;
    }
    try {
      const content = await fileToBase64(file);
      const result = await api("/api/products/import", {
        method: "POST",
        body: {
          filename: file.name,
          content_base64: content,
        },
      });
      await loadData();
      const errors = result.errors || [];
      const detail = errors.length ? ` Ada ${errors.length} baris dilewati.` : "";
      showToast(`Import selesai: ${result.created || 0} barang baru, ${result.updated || 0} barang diperbarui.${detail}`);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#return-item-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/returns", {
        method: "POST",
        body: {
          product_id: $("#return-product").value,
          qty: Number($("#return-qty").value),
          notes: $("#return-notes").value,
        },
      });
      $("#return-qty").value = 1;
      $("#return-notes").value = "";
      await loadData();
      showToast("Retur barang berhasil.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#new-product-btn").addEventListener("click", () => openProductDialog());
  $("#import-product-btn").addEventListener("click", () => $("#product-import-file").click());
  $("#product-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirm("Import Excel akan menambah barang baru dan mengubah barang lama berdasarkan id atau SKU. Lanjutkan?")) {
      return;
    }
    try {
      const content = await fileToBase64(file);
      const result = await api("/api/products/import", {
        method: "POST",
        body: {
          filename: file.name,
          content_base64: content,
        },
      });
      await loadData();
      const errors = result.errors || [];
      const detail = errors.length ? ` Ada ${errors.length} baris dilewati.` : "";
      showToast(`Import selesai: ${result.created || 0} barang baru, ${result.updated || 0} barang diperbarui.${detail}`);
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#close-product-dialog").addEventListener("click", () => $("#product-dialog").close());
  $("#product-search").addEventListener("input", (event) => {
    state.productSearch = event.target.value;
    renderProducts();
  });

  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#product-id").value;
    const body = {
      sku: $("#product-sku").value,
      name: $("#product-name").value,
      category: $("#product-category").value,
      unit: $("#product-unit").value,
      stock: formNumber("#product-stock"),
      min_stock: formNumber("#product-min-stock"),
      buy_price: formNumber("#product-buy-price"),
      sell_price: formNumber("#product-sell-price"),
      supplier_id: $("#product-supplier").value,
    };
    try {
      await api(id ? `/api/products/${id}` : "/api/products", {
        method: id ? "PUT" : "POST",
        body,
      });
      $("#product-dialog").close();
      await loadData();
      showToast("Barang tersimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#products-table").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-product]");
    const remove = event.target.closest("[data-delete-product]");
    if (edit) {
      openProductDialog(productById(edit.dataset.editProduct));
      return;
    }
    if (remove && confirm("Hapus barang ini?")) {
      await api(`/api/products/${remove.dataset.deleteProduct}`, { method: "DELETE" });
      await loadData();
      showToast("Barang dihapus.");
    }
  });

  $("#supplier-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#supplier-id").value;
    const body = {
      name: $("#supplier-name").value,
      phone: $("#supplier-phone").value,
      address: $("#supplier-address").value,
      notes: $("#supplier-notes").value,
    };
    try {
      await api(id ? `/api/suppliers/${id}` : "/api/suppliers", {
        method: id ? "PUT" : "POST",
        body,
      });
      event.target.reset();
      $("#supplier-id").value = "";
      await loadData();
      showToast("Supplier tersimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#supplier-list").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-supplier]");
    const remove = event.target.closest("[data-delete-supplier]");
    if (edit) {
      const supplier = supplierById(edit.dataset.editSupplier);
      $("#supplier-id").value = supplier.id;
      $("#supplier-name").value = supplier.name;
      $("#supplier-phone").value = supplier.phone || "";
      $("#supplier-address").value = supplier.address || "";
      $("#supplier-notes").value = supplier.notes || "";
      return;
    }
    if (remove && confirm("Hapus supplier ini?")) {
      await api(`/api/suppliers/${remove.dataset.deleteSupplier}`, { method: "DELETE" });
      await loadData();
      showToast("Supplier dihapus.");
    }
  });

  $("#user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#user-id").value;
    const body = {
      name: $("#user-name").value,
      username: $("#user-username").value,
      password: $("#user-password").value,
      role: $("#user-role").value,
      active: $("#user-active").value,
    };
    try {
      await api(id ? `/api/users/${id}` : "/api/users", {
        method: id ? "PUT" : "POST",
        body,
      });
      event.target.reset();
      $("#user-id").value = "";
      $("#user-active").value = "1";
      await loadData();
      showToast("User tersimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#users-table").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-user]");
    const remove = event.target.closest("[data-delete-user]");
    if (edit) {
      const user = (state.data.Users || []).find((item) => String(item.id) === String(edit.dataset.editUser));
      $("#user-id").value = user.id;
      $("#user-name").value = user.name || "";
      $("#user-username").value = user.username || "";
      $("#user-password").value = "";
      $("#user-role").value = user.role || "kasir";
      $("#user-active").value = String(user.active ?? "1");
      return;
    }
    if (remove && confirm("Hapus user ini?")) {
      await api(`/api/users/${remove.dataset.deleteUser}`, { method: "DELETE" });
      await loadData();
      showToast("User dihapus.");
    }
  });

  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/settings", {
        method: "POST",
        body: {
          store_name: $("#settings-store-name").value,
          store_subtitle: $("#settings-store-subtitle").value,
          app_name: $("#settings-app-name").value,
          receipt_store_name: $("#settings-receipt-store-name").value,
        },
      });
      state.settings = { ...state.settings, ...(payload.settings || {}) };
      localStorage.setItem("kasir_settings", JSON.stringify(state.settings));
      applySettings();
      showToast("Pengaturan aplikasi tersimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#filter-report-btn").addEventListener("click", async () => {
    const params = new URLSearchParams();
    if ($("#report-start").value) params.set("start", $("#report-start").value);
    if ($("#report-end").value) params.set("end", $("#report-end").value);
    const payload = await api(`/api/report?${params.toString()}`);
    renderReports(payload.rows || []);
  });

  $("#sales-history-table").addEventListener("click", async (event) => {
    const printButton = event.target.closest("[data-print-sale]");
    const downloadButton = event.target.closest("[data-download-sale]");
    const cancelButton = event.target.closest("[data-cancel-sale]");
    if (printButton) {
      const params = new URLSearchParams();
      if (state.token) params.set("token", state.token);
      const href = `/receipt/${printButton.dataset.printSale}?${params.toString()}`;
      window.open(href, "_blank", "width=420,height=680");
      return;
    }
    if (downloadButton) {
      try {
        await downloadSaleReceiptPdf(downloadButton.dataset.downloadSale, downloadButton.dataset.invoiceNo);
        showToast("Nota PDF berhasil diunduh.");
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (!cancelButton) return;
    const saleId = cancelButton.dataset.cancelSale;
    const sale = (state.data.Sales || []).find((item) => String(item.id) === String(saleId));
    const reason = prompt(`Alasan pembatalan ${sale?.invoice_no || ""}:`, "Salah input atau order dibatalkan");
    if (reason === null) return;
    if (!confirm("Batalkan transaksi ini dan kembalikan semua item ke stok utama?")) return;
    try {
      const payload = await api(`/api/sales/${saleId}/cancel`, {
        method: "POST",
        body: { reason },
      });
      await loadData();
      const missing = payload.missing_products || [];
      showToast(
        missing.length
          ? `Transaksi dibatalkan, tetapi ada barang yang tidak ditemukan: ${missing.join(", ")}`
          : "Transaksi dibatalkan dan stok dikembalikan.",
        Boolean(missing.length),
      );
    } catch (error) {
      showToast(error.message, true);
    }
  });

  // BAGIAN 2: Stock Opname - New Event Handlers
  
  // Initialize SO state
  const soState = {
    active: false,
    method: null,  // "manual" or "excel"
    items: {},     // {product_id: {product_data, physical_stock}}
    currentTab: "manual",
    searchResults: [],
    selectedProduct: null,
    excelData: null,
  };
  
  // Helper: Calculate variance for items
  function calculateSOVariance() {
    const summary = {
      items: 0,
      totalVariance: 0,
      surplusValue: 0,
      shortageValue: 0,
      variances: []
    };
    
    Object.values(soState.items).forEach(item => {
      const variance = item.physical_stock - item.system_stock;
      if (variance !== 0) {
        summary.items += 1;
        summary.totalVariance += variance;
        const varianceValue = variance * number(item.buy_price);
        if (variance > 0) {
          summary.surplusValue += varianceValue;
        } else {
          summary.shortageValue += Math.abs(varianceValue);
        }
        summary.variances.push({
          product_id: item.id,
          sku: item.sku,
          name: item.name,
          system_stock: item.system_stock,
          physical_stock: item.physical_stock,
          variance,
          variance_value: varianceValue,
          buy_price: item.buy_price
        });
      }
    });
    
    return summary;
  }
  
  // Helper: Render SO Manual Table
  function renderSOManualTable() {
    const tbody = $("#so-manual-table");
    const items = Object.values(soState.items);
    
    if (items.length === 0) {
      $("#so-manual-empty").classList.remove("hidden");
      tbody.innerHTML = "";
      return;
    }
    
    $("#so-manual-empty").classList.add("hidden");
    tbody.innerHTML = items.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(item.sku || "-")}</td>
        <td>${number(item.system_stock)}</td>
        <td>
          <input type="number" class="so-physical-input" data-product-id="${item.id}" 
                 value="${number(item.physical_stock)}" min="0" style="width: 80px; padding: 4px;">
        </td>
        <td class="${item.physical_stock - item.system_stock >= 0 ? 'positive' : 'negative'}">
          ${item.physical_stock - item.system_stock >= 0 ? '+' : ''}${item.physical_stock - item.system_stock}
        </td>
        <td>
          <button class="danger-btn so-remove-item" data-product-id="${item.id}" type="button" style="padding: 4px 8px;">Hapus</button>
        </td>
      </tr>
    `).join("");
  }
  
  // Helper: Render SO Summary
  function renderSOSummary() {
    const summary = calculateSOVariance();
    $("#so-summary-items").textContent = summary.items;
    $("#so-summary-variance").textContent = summary.totalVariance;
    $("#so-summary-surplus").textContent = money(summary.surplusValue);
    $("#so-summary-shortage").textContent = money(summary.shortageValue);
    
    $("#so-summary-table").innerHTML = summary.variances.map(v => `
      <tr>
        <td><strong>${escapeHtml(v.name)}</strong></td>
        <td>${v.system_stock}</td>
        <td>${v.physical_stock}</td>
        <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${v.variance >= 0 ? '+' : ''}${v.variance}</td>
        <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${money(Math.abs(v.variance_value))}</td>
      </tr>
    `).join("");
  }
  
  // Start SO
  $("#start-stock-opname").addEventListener("click", () => {
    soState.active = true;
    soState.method = null;
    soState.items = {};
    soState.currentTab = "manual";
    soState.searchResults = [];
    soState.selectedProduct = null;
    
    $("#so-start-section").classList.add("hidden");
    $("#so-main-panel").classList.remove("hidden");
    $("#so-summary-section").classList.add("hidden");
    resetSOFinalizeButton();
    
    // Reset tab view
    $$(".so-tab-btn").forEach(btn => {
      btn.classList.remove("active");
      if (btn.dataset.tab === "manual") btn.classList.add("active");
    });
    
    $$(".so-tab-content").forEach(content => {
      content.classList.add("hidden");
      if (content.id === "so-tab-manual-content") content.classList.remove("hidden");
    });
  });
  
  // Tab Switching
  $$(".so-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      soState.currentTab = tab;
      
      // Update button states
      $$(".so-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      
      // Update content visibility
      $$(".so-tab-content").forEach(content => {
        content.classList.toggle("hidden", content.id !== `so-tab-${tab}-content`);
      });

      // If switched back to manual, re-render to display items imported from Excel
      if (tab === "manual") {
        renderSOManualTable();
      }
    });
  });
  
  // Manual Tab - Product Search
  $("#so-product-search").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    soState.selectedProduct = null;
    $("#so-add-product-btn").disabled = true;
    if (query.length < 1) {
      $("#so-search-results").classList.add("hidden");
      soState.searchResults = [];
      return;
    }
    
    soState.searchResults = (state.data.Products || []).filter(p => {
      const text = `${p.sku} ${p.name}`.toLowerCase();
      return text.includes(query) && !soState.items[p.id];
    });
    
    if (soState.searchResults.length === 0) {
      $("#so-search-results").classList.add("hidden");
      return;
    }
    
    $("#so-search-results-list").innerHTML = soState.searchResults.map(p => `
      <div style="padding: 10px; border-bottom: 1px solid #e5e7eb; cursor: pointer; background: #fff;"
           data-search-product-id="${p.id}">
        <strong>${escapeHtml(p.sku)}</strong> - ${escapeHtml(p.name)}
        <small style="display: block; color: #6b7280;">Stok: ${p.stock} ${p.unit}</small>
      </div>
    `).join("");
    
    $("#so-search-results").classList.remove("hidden");
  });
  
  // Manual Tab - Select Product from Search
  document.addEventListener("click", (e) => {
    const result = e.target.closest("[data-search-product-id]");
    if (result) {
      const productId = result.dataset.searchProductId;
      const product = productById(productId);
      if (product) {
        soState.selectedProduct = product;
        $("#so-product-search").value = `${product.sku || ""} - ${product.name}`;
        $("#so-add-product-btn").disabled = false;
        $("#so-search-results").classList.add("hidden");
      }
    }
  });
  
  $("#so-add-product-btn").addEventListener("click", () => {
    const product = soState.selectedProduct;
    if (!product) return;
    if (soState.items[product.id]) {
      showToast("Barang sudah ada dalam daftar SO.", true);
      return;
    }
    soState.items[product.id] = {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      system_stock: number(product.stock),
      physical_stock: number(product.stock),
      buy_price: number(product.buy_price),
    };
    soState.selectedProduct = null;
    $("#so-product-search").value = "";
    $("#so-add-product-btn").disabled = true;
    renderSOManualTable();
    renderSOSummary();
  });
  
  // Manual Tab - Remove Item
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("so-remove-item")) {
      const productId = e.target.dataset.productId;
      delete soState.items[productId];
      renderSOManualTable();
      renderSOSummary();
    }
  });
  
  // Manual Tab - Physical Stock Input (Real-time Variance)
  document.addEventListener("input", (e) => {
    if (e.target.classList.contains("so-physical-input")) {
      const productId = e.target.dataset.productId;
      if (soState.items[productId]) {
        soState.items[productId].physical_stock = number(e.target.value);
        renderSOManualTable();
        renderSOSummary();
      }
    }
  });
  
  // Excel Tab - Download Template
  $("#so-download-template-btn").addEventListener("click", async () => {
    window.open("/download/so-template" + tokenParam(), "_blank");
    showToast("Template SO berhasil diunduh.");
  });
  
  // Excel Tab - File Upload
  $("#so-file-upload-btn").addEventListener("click", () => {
    $("#so-file-upload").click();
  });
  
  $("#so-file-upload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    
    try {
      const content = await fileToBase64(file);
      
      showToast("Mengupload file...");
      const result = await api("/api/stock-opname/import", {
        method: "POST",
        body: {
          filename: file.name,
          content_base64: content
        }
      });
      
      // Process results
      soState.method = "excel";
      soState.excelData = result;
      
      if (result.processed > 0) {
        // Map physical_inputs to items
        Object.entries(result.physical_inputs).forEach(([productId, physicalStock]) => {
          const product = productById(productId);
          if (product) {
            soState.items[product.id] = {
              id: product.id,
              sku: product.sku,
              name: product.name,
              category: product.category,
              unit: product.unit,
              system_stock: number(product.stock),
              physical_stock: number(physicalStock),
              buy_price: number(product.buy_price)
            };
          }
        });
      }
      
      // Show results
      $("#so-file-name").textContent = file.name;
      $("#so-excel-status").textContent = result.message;
      
      if (result.errors.length > 0) {
        $("#so-excel-errors").textContent = result.errors.slice(0, 5).join("\n");
        if (result.errors.length > 5) {
          $("#so-excel-errors").textContent += `\n... dan ${result.errors.length - 5} error lainnya`;
        }
      } else {
        $("#so-excel-errors").textContent = "Tidak ada error.";
      }
      
      // Show preview
      $("#so-excel-preview-table").innerHTML = Object.values(soState.items).map(item => `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.sku || "-")}</td>
          <td>${item.system_stock}</td>
          <td>${item.physical_stock}</td>
          <td class="${item.physical_stock - item.system_stock >= 0 ? 'positive' : 'negative'}">
            ${item.physical_stock - item.system_stock >= 0 ? '+' : ''}${item.physical_stock - item.system_stock}
          </td>
        </tr>
      `).join("");
      
      $("#so-excel-results").classList.remove("hidden");
      renderSOSummary();
      
      showToast(result.message);
    } catch (error) {
      showToast(error.message, true);
      $("#so-excel-results").classList.add("hidden");
    }
  });
  
  // Determine method and show summary when ready
  function showSOSummary() {
    if (Object.keys(soState.items).length === 0) {
      showToast("Tidak ada data SO untuk difinalisasi.", true);
      return false;
    }
    
    if (!soState.method) {
      soState.method = Object.keys(soState.items).length > 5 ? "excel" : "manual";
    }
    
    $("#so-tab-manual-content").classList.add("hidden");
    $("#so-tab-excel-content").classList.add("hidden");
    $("#so-summary-section").classList.remove("hidden");
    $("#so-finalize-btn").textContent = "✓ Selesaikan SO";
    
    renderSOSummary();
    return true;
  }

  // Helper: Reset SO finalization controls
  function resetSOFinalizeButton() {
    $("#so-finalize-btn").textContent = "✓ Selesaikan SO";
  }

  function cancelStockOpname() {
    soState.active = false;
    soState.method = null;
    soState.items = {};
    soState.excelData = null;

    $("#so-start-section").classList.remove("hidden");
    $("#so-main-panel").classList.add("hidden");
    $("#so-summary-section").classList.add("hidden");
    $("#so-search-results").classList.add("hidden");
    $("#so-excel-results").classList.add("hidden");
    $("#so-file-name").textContent = "-";
    $("#so-excel-errors").textContent = "";
    $("#so-notes").value = "";
    $("#so-product-search").value = "";
    $("#so-file-upload").value = "";

    renderSOManualTable();
    renderSOSummary();
    resetSOFinalizeButton();
  }
  
  // Finalize SO
  $("#so-finalize-btn").addEventListener("click", async () => {
    if ($("#so-summary-section").classList.contains("hidden")) {
      const shown = showSOSummary();
      if (shown) return;
    }

    const summary = calculateSOVariance();
    const message = `Konfirmasi finalisasi Stock Opname?\nItem dengan variance: ${summary.items}\nTotal selisih: ${summary.totalVariance}\nKelebihan: ${money(summary.surplusValue)}\nKekurangan: ${money(summary.shortageValue)}`;
    if (!confirm(message)) return;
    
    try {
      const physical_stocks = {};
      Object.values(soState.items).forEach(item => {
        physical_stocks[item.id] = number(item.physical_stock);
      });
      
      showToast("Memproses finalisasi SO...");
      const result = await api("/api/finalize-so", {
        method: "POST",
        body: {
          physical_stocks,
          method: soState.method,
          notes: $("#so-notes").value,
        },
      });
      
      soState.active = false;
      soState.items = {};
      soState.method = null;
      
      await loadData();
      $("#so-start-section").classList.remove("hidden");
      $("#so-main-panel").classList.add("hidden");
      $("#so-summary-section").classList.add("hidden");
      $("#so-notes").value = "";
      resetSOFinalizeButton();
      
      showSOResultModal(result);
      showToast(`✓ SO finalisasi berhasil! ${result.summary.total_items} item terproses.`);
    } catch (error) {
      showToast(error.message, true);
    }
  });
  
  // Helper: Show SO Result Modal
  function showSOResultModal(soResult) {
    const history = soResult.so_history;
    const summary = soResult.summary;
    const variances = soResult.variances;
    
    // Populate header
    $("#so-result-user").textContent = String(history.user_name || "-");
    $("#so-result-role").textContent = String(history.user_role || "-").toUpperCase();
    $("#so-result-date").textContent = shortDate(history.finalized_at);
    $("#so-result-method").textContent = String(history.method || "-") === "excel" ? "📊 Excel Import" : "📝 Input Manual";
    $("#so-result-items").textContent = summary.total_items;
    
    // Populate metrics
    $("#so-result-variance").textContent = summary.total_variance;
    $("#so-result-surplus").textContent = money(summary.surplus_value);
    $("#so-result-shortage").textContent = money(summary.shortage_value);
    
    // Populate detail table
    $("#so-result-table").innerHTML = variances.map(v => `
      <tr>
        <td><strong>${escapeHtml(v.name)}</strong></td>
        <td>${escapeHtml(v.sku || "-")}</td>
        <td>${v.system_stock}</td>
        <td>${v.physical_stock}</td>
        <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${v.variance >= 0 ? '+' : ''}${v.variance}</td>
        <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${money(Math.abs(v.variance_value))}</td>
      </tr>
    `).join("");
    
    // Show/hide notes
    const notes = String(history.notes || "").trim();
    if (notes) {
      $("#so-result-notes").textContent = notes;
      $("#so-result-notes-section").style.display = "block";
    } else {
      $("#so-result-notes-section").style.display = "none";
    }
    
    // Store result for PDF generation
    window.soResultData = soResult;
    
    // Show modal
    $("#so-result-modal").showModal();
  }
  
  // Helper: Generate SO PDF
  function generateSOPdf(soResult) {
    const history = soResult.so_history;
    const summary = soResult.summary;
    const variances = soResult.variances;
    const storeName = state.settings?.store_name || "TOKO ANDA";
    const date = new Date();
    const timestamp = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    
    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Laporan Stock Opname</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #333; line-height: 1.6; }
          h1 { text-align: center; margin-bottom: 5px; font-size: 24px; }
          .store-info { text-align: center; color: #666; margin-bottom: 20px; font-size: 14px; }
          .header-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 20px; }
          .header-item { border: 1px solid #ddd; padding: 12px; }
          .header-label { color: #666; font-weight: bold; font-size: 12px; }
          .header-value { font-weight: bold; margin-top: 4px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
          .metric-box { border: 1px solid #ddd; padding: 12px; text-align: center; }
          .metric-label { color: #666; font-size: 12px; }
          .metric-value { font-weight: bold; font-size: 18px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
          th { background: #f5f5f5; font-weight: bold; }
          .positive { color: #059669; }
          .negative { color: #dc2626; }
          .notes { margin-top: 20px; padding: 12px; background: #f9fafb; border-left: 3px solid #11615c; }
          .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
      </head>
      <body>
        <h1>LAPORAN STOCK OPNAME</h1>
        <div class="store-info">${escapeHtml(storeName)}</div>
        
        <div class="header-grid">
          <div class="header-item">
            <div class="header-label">User Pelaksana</div>
            <div class="header-value">${escapeHtml(history.user_name || "-")}</div>
            <div style="color: #666; font-size: 12px; margin-top: 4px;">Role: ${escapeHtml(String(history.user_role || "-").toUpperCase())}</div>
          </div>
          <div class="header-item">
            <div class="header-label">Waktu Finalisasi</div>
            <div class="header-value">${escapeHtml(shortDate(history.finalized_at))}</div>
          </div>
          <div class="header-item">
            <div class="header-label">Metode</div>
            <div class="header-value">${String(history.method || "-") === "excel" ? "Excel Import" : "Input Manual"}</div>
          </div>
          <div class="header-item">
            <div class="header-label">Total Item</div>
            <div class="header-value">${summary.total_items}</div>
          </div>
        </div>
        
        <div class="metrics">
          <div class="metric-box">
            <div class="metric-label">Total Selisih (unit)</div>
            <div class="metric-value">${summary.total_variance}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Kelebihan (Rp)</div>
            <div class="metric-value">${money(summary.surplus_value)}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Kekurangan (Rp)</div>
            <div class="metric-value">${money(summary.shortage_value)}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Cetak</div>
            <div class="metric-value">${new Date().toLocaleDateString("id-ID")}</div>
          </div>
        </div>
        
        <h3>Detail Barang dengan Selisih</h3>
        <table>
          <thead>
            <tr>
              <th>Barang</th>
              <th>SKU</th>
              <th>Stok Sistem</th>
              <th>Stok Fisik</th>
              <th>Selisih</th>
              <th>Nilai (Rp)</th>
            </tr>
          </thead>
          <tbody>
            ${variances.map(v => `
              <tr>
                <td>${escapeHtml(v.name)}</td>
                <td>${escapeHtml(v.sku || "-")}</td>
                <td>${v.system_stock}</td>
                <td>${v.physical_stock}</td>
                <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${v.variance >= 0 ? '+' : ''}${v.variance}</td>
                <td class="${v.variance >= 0 ? 'positive' : 'negative'}">${money(Math.abs(v.variance_value))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        
        ${history.notes ? `
          <div class="notes">
            <strong>Keterangan:</strong><br>
            ${escapeHtml(history.notes)}
          </div>
        ` : ""}
        
        <div class="footer">
          <p>Dokumen ini dibuat secara otomatis oleh sistem. Laporan SO - ${timestamp}</p>
        </div>
      </body>
      </html>
    `;
    
    return htmlContent;
  }
  
  // SO Result - Download PDF
  document.addEventListener("click", (e) => {
    if (e.target.id === "so-result-download-pdf") {
      if (!window.soResultData || !window.soResultData.so_history?.id) {
        showToast("Data SO tidak tersedia.", true);
        return;
      }
      const reportUrl = `/download/so-report/${encodeURIComponent(window.soResultData.so_history.id)}${tokenParam()}`;
      window.open(reportUrl, "_blank");
    }
  });
  
  // Back/Reset buttons
  document.addEventListener("click", (e) => {
    if (e.target.id === "so-review-btn") {
      const shown = showSOSummary();
      if (!shown) {
        showToast("Tidak ada barang untuk direview.", true);
      }
    }

    if (e.target.id === "so-reset-btn") {
      // Go back to editing mode
      $("#so-summary-section").classList.add("hidden");
      $$(".so-tab-content").forEach(content => {
        if (content.id === "so-tab-manual-content") content.classList.remove("hidden");
      });
      resetSOFinalizeButton();
    }

    if (e.target.id === "so-cancel-btn") {
      if (!confirm("Batalkan Stock Opname saat ini? Semua input akan dihapus.")) return;
      cancelStockOpname();
      showToast("Stock Opname dibatalkan.");
    }
  });

  // Developer Settings events

  $("#dev-save-settings").addEventListener("click", async () => {
    state.developerSettings.maintenanceMode = $("#dev-maintenance-mode").checked;
    state.developerSettings.debugMode = $("#dev-debug-mode").checked;
    state.developerSettings.sessionTimeout = Number($("#dev-session-timeout").value);
    state.developerSettings.paginationLimit = Number($("#dev-pagination-limit").value);
    state.developerSettings.apiKey = $("#dev-api-key").value;
    
    try {
      await api("/api/developer-settings", {
        method: "POST",
        body: state.developerSettings,
      });
      showToast("Developer settings disimpan.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#dev-auto-backup").addEventListener("click", async () => {
    try {
      await api("/api/developer/backup", { method: "POST" });
      showToast("Auto-backup berhasil.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#dev-export-sql").addEventListener("click", async () => {
    window.open("/download/database?format=sql", "_blank");
  });

  $("#dev-export-excel").addEventListener("click", async () => {
    window.open("/download/database", "_blank");
  });

  $("#dev-restore-db").addEventListener("click", () => {
    $("#dev-restore-file").click();
  });

  $("#dev-restore-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirm("Restore database akan menimpa semua data saat ini. Lanjutkan?")) return;
    
    try {
      const content = await fileToBase64(file);
      await api("/api/developer/restore", {
        method: "POST",
        body: {
          filename: file.name,
          content_base64: content,
        },
      });
      await loadData();
      showToast("Database berhasil direstore.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#dev-force-kick-all").addEventListener("click", async () => {
    if (!confirm("Force kick semua user yang sedang login?")) return;
    try {
      await api("/api/developer/force-kick-all", { method: "POST" });
      showToast("Semua user berhasil dikick.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function bindMobileEvents() {
  const mobileRefreshBtn = $("#mobile-refresh-btn");
  if (mobileRefreshBtn) {
    mobileRefreshBtn.addEventListener("click", () => {
      const desktopRefresh = $("#refresh-btn");
      if (desktopRefresh) desktopRefresh.click();
    });
  }

  const mobileLogoutBtn = $("#mobile-logout-btn");
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener("click", () => {
      const desktopLogout = $("#logout-btn");
      if (desktopLogout) desktopLogout.click();
    });
  }

  const mobileMoreBtn = $("#mobile-more-btn");
  const mobileDrawer = $("#mobile-drawer");
  const closeDrawerBtn = $("#close-drawer-btn");

  if (mobileMoreBtn && mobileDrawer) {
    mobileMoreBtn.addEventListener("click", () => {
      mobileDrawer.classList.add("open");
    });
  }

  if (closeDrawerBtn && mobileDrawer) {
    closeDrawerBtn.addEventListener("click", () => {
      mobileDrawer.classList.remove("open");
    });
  }

  if (mobileDrawer) {
    mobileDrawer.addEventListener("click", (e) => {
      if (e.target === mobileDrawer) {
        mobileDrawer.classList.remove("open");
      }
    });
  }

  const drawerButtons = document.querySelectorAll("#mobile-drawer .nav-tabs button");
  drawerButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (mobileDrawer) mobileDrawer.classList.remove("open");
    });
  });
}

async function boot() {
  bindEvents();
  bindMobileEvents();
  applySettings();
  if (!state.token) {
    showLogin();
    return;
  }
  try {
    const payload = await api("/api/me");
    if (!payload.user) throw new Error("Sesi habis.");
    state.user = payload.user;
    showApp();
    await loadData();
  } catch (_) {
    localStorage.removeItem("kasir_token");
    localStorage.removeItem("kasir_user");
    state.token = "";
    state.user = null;
    showLogin();
  }
}

boot();
