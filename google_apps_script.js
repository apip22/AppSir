/**
 * APP SIR - GOOGLE APPS SCRIPT INTEGRATION
 * 
 * Petunjuk Instalasi:
 * 1. Buka Google Sheets (sheets.google.com).
 * 2. Buat spreadsheet kosong baru (atau biarkan AppSir membuatnya secara otomatis melalui API).
 * 3. Klik "Ekstensi" -> "Apps Script".
 * 4. Hapus semua kode bawaan di editor `Kode.gs` dan tempelkan seluruh kode ini.
 * 5. Klik ikon simpan (Save).
 * 6. Klik "Terapkan" (Deploy) -> "Terapkan baru" (New deployment).
 * 7. Pilih jenis: "Aplikasi web" (Web app).
 * 8. Konfigurasi:
 *    - Jalankan sebagai: "Saya" (Me / Akun Google Anda)
 *    - Yang memiliki akses: "Siapa saja" (Anyone) -> Ini penting agar server lokal Anda dapat mengakses API tanpa OAuth browser.
 * 9. Klik "Terapkan" (Deploy) dan berikan izin akses (Authorize access) jika diminta.
 * 10. Salin "URL Aplikasi Web" yang dihasilkan dan tempelkan ke Pengaturan AppSir di aplikasi web Anda.
 */

// Konfigurasi nama sheet dan header kolom
const SHEETS_CONFIG = {
  "Products": ["id", "sku", "name", "category", "unit", "stock", "min_stock", "buy_price", "sell_price", "supplier_id", "updated_at"],
  "Sales": ["id", "invoice_no", "date", "customer", "subtotal", "discount", "total", "paid", "change", "payment_method", "user_id", "notes", "status"],
  "SaleItems": ["id", "sale_id", "product_id", "sku", "name", "qty", "price", "subtotal"],
  "Suppliers": ["id", "name", "phone", "address", "notes", "created_at"]
};

/**
 * Endpoint POST (doPost)
 * Menangani permintaan dari server Node.js lokal untuk menulis data
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "Tidak ada data post" });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const spreadsheetId = payload.spreadsheetId;
    
    let ss;
    if (spreadsheetId) {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }

    if (!ss) {
      // Jika action adalah createSpreadsheet, buat baru
      if (action === "createSpreadsheet") {
        return jsonResponse({ success: true, data: initSpreadsheet(payload.title || "AppSir Database POS") });
      }
      return jsonResponse({ success: false, error: "Spreadsheet tidak ditemukan." });
    }

    let result;
    if (action === "createSpreadsheet") {
      result = initSpreadsheet(payload.title || "AppSir Database POS", ss);
    } else if (action === "syncSale") {
      result = appendSale(ss, payload.sale, payload.items);
    } else if (action === "syncProducts") {
      result = bulkUpdateProducts(ss, payload.products);
    } else if (action === "syncSuppliers") {
      result = bulkUpdateSuppliers(ss, payload.suppliers);
    } else {
      return jsonResponse({ success: false, error: "Aksi '" + action + "' tidak dikenali." });
    }

    return jsonResponse({ success: true, data: result });
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString(), stack: error.stack });
  }
}

/**
 * Endpoint GET (doGet)
 * Menangani permintaan dari server Node.js untuk menarik data
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const spreadsheetId = e.parameter.spreadsheetId;
    
    let ss;
    if (spreadsheetId) {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }

    if (!ss) {
      return jsonResponse({ success: false, error: "Spreadsheet tidak ditemukan." });
    }

    let result;
    if (action === "getProducts") {
      result = getProductsList(ss);
    } else if (action === "getSuppliers") {
      result = getSuppliersList(ss);
    } else if (action === "testConnection") {
      result = { connected: true, name: ss.getName(), url: ss.getUrl() };
    } else {
      return jsonResponse({ success: false, error: "Aksi '" + action + "' tidak dikenali." });
    }

    return jsonResponse({ success: true, data: result });
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * Format Response JSON Helper
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Inisialisasi Spreadsheet Baru / Buat Lembar Kerja Baru
 */
function initSpreadsheet(title, existingSs = null) {
  let ss = existingSs;
  if (!ss) {
    ss = SpreadsheetApp.create(title);
  }

  // Buat lembar kerja berdasarkan konfigurasi
  Object.keys(SHEETS_CONFIG).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else {
      sheet.clear();
    }
    
    const headers = SHEETS_CONFIG[sheetName];
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      
      // Formatting Header
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#11615c"); // Warna khas AppSir
      headerRange.setFontColor("#ffffff");
      headerRange.setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
      
      // Auto-fit columns
      for (let i = 1; i <= headers.length; i++) {
        sheet.autoResizeColumn(i);
      }
    }
  });

  // Setup Dashboard Indah
  setupDashboard(ss);

  // Hapus sheet bawaan (Sheet1) jika ada dan bukan bagian dari konfigurasi
  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  return {
    spreadsheetId: ss.getId(),
    url: ss.getUrl(),
    name: ss.getName()
  };
}

/**
 * Membuat Dashboard Visual pada Tab 'Dashboard'
 */
function setupDashboard(ss) {
  let dashboard = ss.getSheetByName("Dashboard");
  if (!dashboard) {
    dashboard = ss.insertSheet("Dashboard", 0); // Tempatkan di tab pertama
  } else {
    dashboard.clear();
  }

  // Matikan garis kisi (gridlines) agar terlihat bersih
  dashboard.setHiddenGridlines(false);

  // Judul Dashboard
  dashboard.getRange("A1:H1").merge().setValue("APP SIR - DASHBOARD ANALITIK").setFontSize(16).setFontWeight("bold").setFontColor("#11615c").setHorizontalAlignment("left");
  
  // Subtitle
  dashboard.getRange("A2:H2").merge().setValue("Sinkronisasi otomatis dari Aplikasi Kasir Lokal. Terakhir diperbarui: " + new Date().toLocaleString("id-ID")).setFontSize(9).setFontItalic(true).setFontColor("#555555");

  // Kartu Ringkasan Kinerja (Card Layout)
  const stats = [
    { title: "TOTAL TRANSAKSI", formula: '=IF(COUNTA(Sales!A:A)>1, COUNTA(Sales!A:A)-1, 0)', cell: "A4:B5", color: "#11615c" },
    { title: "TOTAL PENJUALAN", formula: '=IF(SUM(Sales!G:G)>0, SUM(Sales!G:G), 0)', cell: "D4:E5", color: "#2e7d32", format: "Rp#,##0" },
    { title: "TOTAL DISKON", formula: '=IF(SUM(Sales!F:F)>0, SUM(Sales!F:F), 0)', cell: "G4:H5", color: "#c62828", format: "Rp#,##0" }
  ];

  stats.forEach(stat => {
    const range = dashboard.getRange(stat.cell);
    range.merge();
    
    // Set formula dan styling
    range.setFormula(stat.formula);
    range.setFontSize(20).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontColor(stat.color);
    if (stat.format) {
      range.setNumberFormat(stat.format);
    }
    
    // Judul Kartu di baris atasnya
    const titleCell = dashboard.getRange(range.getRow() - 1, range.getColumn(), 1, 2);
    titleCell.merge().setValue(stat.title).setFontSize(9).setFontWeight("bold").setFontColor("#777777").setHorizontalAlignment("center").setBackground("#f5f5f5");
    
    // Border kartu
    const cardRange = dashboard.getRange(range.getRow() - 1, range.getColumn(), 3, 2);
    cardRange.setBorder(true, true, true, true, null, null, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
  });

  // Tampilkan Produk Stok Rendah secara Dinamis menggunakan QUERY Google Sheets
  dashboard.getRange("A8").setValue("PERINGATAN STOK RENDAH").setFontSize(12).setFontWeight("bold").setFontColor("#c62828");
  
  const queryCell = dashboard.getRange("A9");
  queryCell.setFormula('=QUERY(Products!A:K, "SELECT B, C, F, G WHERE F <= G AND A IS NOT NULL ORDER BY F ASC", 1)');
  
  // Styling untuk tabel stok rendah
  SpreadsheetApp.flush();
  
  // Format visual area query secara umum (A9:D20)
  dashboard.getRange("A9:D9").setFontWeight("bold").setBackground("#ffd8d2").setFontColor("#b42318");

  // Tambahkan Petunjuk Sinkronisasi di samping
  dashboard.getRange("F8").setValue("INFORMASI SISTEM SINKRONISASI").setFontSize(12).setFontWeight("bold").setFontColor("#11615c");
  const desc = [
    ["Sistem:", "POS Sinkronisasi Dua Arah"],
    ["Tipe:", "Apps Script Web App Service"],
    ["Aksi:", "POS Otomatis Push ke Sheets"],
    ["Stok:", "Sinkronisasi Manual/Auto dari Tab Settings"]
  ];
  
  for (let i = 0; i < desc.length; i++) {
    dashboard.getRange(9 + i, 6).setValue(desc[i][0]).setFontWeight("bold").setFontColor("#555555");
    dashboard.getRange(9 + i, 7, 1, 2).merge().setValue(desc[i][1]).setFontColor("#222222");
  }
  
  const infoBox = dashboard.getRange("F9:H12");
  infoBox.setBorder(true, true, true, true, null, null, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
  infoBox.setBackground("#fcfcfc");
}

/**
 * Menambahkan data transaksi Penjualan Baru (Sales & SaleItems)
 * Serta memperbarui stok barang secara real-time
 */
function appendSale(ss, sale, items) {
  const salesSheet = ss.getSheetByName("Sales");
  const itemsSheet = ss.getSheetByName("SaleItems");
  const productsSheet = ss.getSheetByName("Products");

  if (!salesSheet || !itemsSheet) {
    throw new Error("Sheet 'Sales' atau 'SaleItems' belum siap.");
  }

  // 1. Tambah baris ke sheet Sales
  const salesHeaders = SHEETS_CONFIG.Sales;
  const saleRow = salesHeaders.map(header => sale[header] ?? "");
  salesSheet.appendRow(saleRow);

  // 2. Tambah baris ke sheet SaleItems dan kurangi stok di sheet Products
  const itemsHeaders = SHEETS_CONFIG.SaleItems;
  
  // Ambil semua data produk saat ini untuk memetakan baris & update stok
  let productsData = [];
  let productsRange = null;
  let productsValues = [];
  
  if (productsSheet) {
    productsRange = productsSheet.getDataRange();
    productsValues = productsRange.getValues();
  }

  items.forEach(item => {
    const itemRow = itemsHeaders.map(header => item[header] ?? "");
    itemsSheet.appendRow(itemRow);

    // Update stok produk di Products sheet
    if (productsSheet && productsValues.length > 1) {
      const productId = String(item.product_id);
      const qtySold = Number(item.qty || 0);
      
      // Cari produk berdasarkan ID (kolom A - index 0)
      for (let i = 1; i < productsValues.length; i++) {
        if (String(productsValues[i][0]) === productId) {
          // Kolom F (index 5) adalah 'stock'
          const currentStock = Number(productsValues[i][5] || 0);
          const newStock = Math.max(0, currentStock - qtySold);
          
          // Tulis stok baru kembali ke sheet
          productsSheet.getRange(i + 1, 6).setValue(newStock);
          productsSheet.getRange(i + 1, 11).setValue(new Date().toISOString().replace("T", " ").slice(0, 19)); // updated_at
          break;
        }
      }
    }
  });

  // Perbarui visual Dashboard
  updateDashboardTime(ss);

  return { success: true, invoice_no: sale.invoice_no };
}

/**
 * Memperbarui info terakhir diperbarui di Dashboard
 */
function updateDashboardTime(ss) {
  const dashboard = ss.getSheetByName("Dashboard");
  if (dashboard) {
    dashboard.getRange("A2").setValue("Sinkronisasi otomatis dari Aplikasi Kasir Lokal. Terakhir diperbarui: " + new Date().toLocaleString("id-ID"));
  }
}

/**
 * Mengambil semua data produk dari Google Sheets
 * Digunakan untuk menyelaraskan (pull) data ke aplikasi lokal
 */
function getProductsList(ss) {
  const sheet = ss.getSheetByName("Products");
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const products = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const product = {};
    headers.forEach((header, index) => {
      product[header] = row[index];
    });
    // Normalisasi tipe data numerik
    const numericCols = ["stock", "min_stock", "buy_price", "sell_price"];
    numericCols.forEach(col => {
      if (product[col] !== undefined) {
        product[col] = Number(product[col] || 0);
      }
    });
    products.push(product);
  }

  return products;
}

/**
 * Mengambil semua data supplier dari Google Sheets
 */
function getSuppliersList(ss) {
  const sheet = ss.getSheetByName("Suppliers");
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const suppliers = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const supplier = {};
    headers.forEach((header, index) => {
      supplier[header] = row[index];
    });
    suppliers.push(supplier);
  }

  return suppliers;
}

/**
 * Bulk update data produk dari web app ke Google Sheets (push)
 */
function bulkUpdateProducts(ss, products) {
  let sheet = ss.getSheetByName("Products");
  if (!sheet) {
    sheet = ss.insertSheet("Products");
  }
  
  sheet.clear();
  const headers = SHEETS_CONFIG.Products;
  sheet.appendRow(headers);
  
  // Format Header
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#11615c");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  if (products && products.length > 0) {
    const rows = products.map(product => {
      return headers.map(header => product[header] ?? "");
    });
    
    // Batch write untuk kecepatan performa
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }

  updateDashboardTime(ss);
  return { updatedCount: products ? products.length : 0 };
}

/**
 * Bulk update data supplier dari web app ke Google Sheets (push)
 */
function bulkUpdateSuppliers(ss, suppliers) {
  let sheet = ss.getSheetByName("Suppliers");
  if (!sheet) {
    sheet = ss.insertSheet("Suppliers");
  }
  
  sheet.clear();
  const headers = SHEETS_CONFIG.Suppliers;
  sheet.appendRow(headers);
  
  // Format Header
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#11615c");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  if (suppliers && suppliers.length > 0) {
    const rows = suppliers.map(supplier => {
      return headers.map(header => supplier[header] ?? "");
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return { updatedCount: suppliers ? suppliers.length : 0 };
}

/**
 * Menu Kustom di Google Sheets
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("AppSir Sync")
    .addItem("Refresh Dashboard", "onMenuRefreshDashboard")
    .addSeparator()
    .addItem("Petunjuk Integrasi", "onMenuShowInstructions")
    .addToUi();
}

function onMenuRefreshDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupDashboard(ss);
  SpreadsheetApp.getUi().alert("Dashboard berhasil di-refresh!");
}

function onMenuShowInstructions() {
  const htmlOutput = HtmlService.createHtmlOutput(
    "<h3>Integrasi POS AppSir dengan Google Sheets</h3>" +
    "<p>Status integrasi Anda aktif. Setiap transaksi yang dibuat di aplikasi kasir lokal (AppSir) " +
    "akan secara otomatis dicatat ke tab <b>Sales</b> dan <b>SaleItems</b> secara real-time.</p>" +
    "<p><b>Tips:</b> Anda dapat mengedit harga barang di tab <b>Products</b>, lalu menyinkronkannya " +
    "kembali ke aplikasi kasir Anda melalui menu Pengaturan di aplikasi web AppSir.</p>"
  ).setTitle("Petunjuk AppSir Integration").setWidth(400).setHeight(250);
  
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Petunjuk Integrasi AppSir");
}
