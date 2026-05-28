# BAGIAN 1: BACKEND & DATABASE INTEGRATION
## Stock Opname - Fondasi Data dan Endpoint Backend

**Status:** ✅ SELESAI

---

## 📋 RINGKASAN IMPLEMENTASI

Bagian 1 fokus pada membangun fondasi data dan backend logic untuk fitur Stock Opname yang komprehensif dengan tracking audit dan validasi data.

---

## 🗄️ DATABASE SCHEMA YANG DITAMBAHKAN

### 1. **StockOpnameHistory** - Menyimpan Riwayat Utama Stock Opname
```
Kolom:
- id                 : Unique identifier
- so_date           : Tanggal SO dilakukan
- user_id           : ID user yang melakukan SO
- user_name         : Nama user yang melakukan SO
- user_role         : Role user (admin/developer/owner)
- status            : Status SO (draft/finalized)
- total_items       : Jumlah item dengan selisih
- total_variance    : Total selisih unit (positif/negatif)
- surplus_value     : Nilai kelebihan stok (Rp)
- shortage_value    : Nilai kekurangan stok (Rp)
- method            : Metode input (manual/excel)
- created_at        : Waktu SO dimulai
- finalized_at      : Waktu SO di-finalize
- notes             : Catatan tambahan
```

### 2. **StockOpnameItems** - Menyimpan Detail Item Setiap SO
```
Kolom:
- id                : Unique identifier
- so_history_id     : Referensi ke StockOpnameHistory
- product_id        : ID barang
- sku               : SKU barang
- name              : Nama barang
- system_stock      : Stok sistem saat SO
- physical_stock    : Stok fisik yang dihitung
- variance          : Selisih (physical - system)
- variance_value    : Nilai selisih dalam Rp (variance × buy_price)
- buy_price         : Harga beli saat SO
```

### 3. **AuditLog** - Menyimpan Log Setiap Aksi
```
Kolom:
- id                : Unique identifier
- timestamp         : Waktu aksi dilakukan
- user_id           : ID user yang melakukan aksi
- user_name         : Nama user
- user_role         : Role user
- action            : Nama aksi (FINALIZE_STOCK_OPNAME, etc)
- entity_type       : Jenis entity yang diubah (StockOpnameHistory)
- entity_id         : ID entity yang diubah
- details           : Detail perubahan (max 500 char)
- ip_address        : IP address user (untuk keamanan)
```

---

## 🔧 HELPER FUNCTIONS YANG DITAMBAHKAN

### 1. `logAudit(data, user, action, entityType, entityId, details, ipAddress)`
Mencatat setiap aksi ke dalam AuditLog untuk transparansi dan audit trail.

**Parameter:**
- `data`: Object database
- `user`: Object user yang login
- `action`: String aksi (contoh: "FINALIZE_STOCK_OPNAME")
- `entityType`: Tipe entity yang dimodifikasi
- `entityId`: ID entity
- `details`: Deskripsi perubahan
- `ipAddress`: IP address user (opsional)

**Return:** Object audit entry yang dibuat

---

### 2. `calculateStockVariance(systemProducts, physicalInputs)`
Menghitung selisih antara stok sistem dan stok fisik dengan detail lengkap.

**Parameter:**
- `systemProducts`: Array produk dari database
- `physicalInputs`: Object {product_id: physical_stock_qty}

**Return:** Object dengan struktur:
```javascript
{
  variances: [
    {
      product_id, sku, name, category, unit,
      system_stock, physical_stock, variance,
      variance_value, buy_price
    },
    ...
  ],
  summary: {
    total_variance,
    surplus_value,
    shortage_value,
    total_items
  }
}
```

---

### 3. `soTemplateBuffer(data)`
Generate template Excel untuk Stock Opname dengan data barang terkini.

**Return:** Buffer Excel file dengan kolom: SKU, Nama, Stok Sistem, Stok Fisik

---

### 4. `importStockOpnameFromRows(data, rows)`
Import data SO dari rows Excel yang di-parse.

**Parameter:**
- `data`: Object database
- `rows`: Array rows dari file Excel

**Return:** Object dengan struktur:
```javascript
{
  physicalInputs: {product_id: qty, ...},
  processed: number,
  errors: [error_message, ...]
}
```

---

## 📡 ENDPOINT BACKEND YANG DITAMBAHKAN

### **POST /api/finalize-so** (UTAMA - NEW)
Endpoint untuk finalisasi Stock Opname dengan seluruh proses adjustment.

**Autentikasi:** Minimal role ADMIN

**Request Body:**
```javascript
{
  physical_stocks: {
    "product_id_1": 10,
    "product_id_2": 25,
    ...
  },
  method: "manual" | "excel",
  notes: "Keterangan tambahan (opsional)"
}
```

**Response:**
```javascript
{
  so_history_id: "1",
  so_history: {
    id, so_date, user_id, user_name, user_role,
    status, total_items, total_variance,
    surplus_value, shortage_value, method,
    created_at, finalized_at, notes
  },
  variances: [
    {
      id, so_history_id, product_id, sku, name,
      system_stock, physical_stock, variance,
      variance_value, buy_price
    },
    ...
  ],
  summary: {
    total_variance,
    surplus_value,
    shortage_value,
    total_items
  },
  audit: {audit_log_entry}
}
```

**Logika:**
1. ✅ Validasi input physical_stocks
2. ✅ Hitung variance setiap barang
3. ✅ Buat record di StockOpnameHistory
4. ✅ Buat detail di StockOpnameItems (hanya untuk item dengan variance ≠ 0)
5. ✅ Update stok di Products table (Adjustment)
6. ✅ Catat di AuditLog dengan detail lengkap
7. ✅ Save semua perubahan ke database

---

### **GET /api/stock-opname/history** (NEW)
Mengambil riwayat Stock Opname (sorted by date descending).

**Autentikasi:** Minimal role ADMIN

**Query Parameters:** None

**Response:**
```javascript
{
  history: [
    {id, so_date, user_id, user_name, user_role, status, ...},
    ...
  ]
}
```

---

### **GET /api/stock-opname/items/:so_history_id** (NEW)
Mengambil detail item dari SO tertentu.

**Autentikasi:** Minimal role ADMIN

**URL Parameter:**
- `so_history_id`: ID dari StockOpnameHistory

**Response:**
```javascript
{
  items: [
    {id, so_history_id, product_id, sku, name, ...},
    ...
  ],
  history: {so_history_object}
}
```

---

### **POST /api/stock-opname/import** (NEW)
Import data SO dari file Excel.

**Autentikasi:** Minimal role ADMIN

**Request Body:**
```javascript
{
  filename: "template_stock_opname.xlsx",
  content_base64: "base64_encoded_file_content"
}
```

**Response:**
```javascript
{
  processed: 25,
  errors: [
    "Baris 5: SKU tidak boleh kosong.",
    "Baris 10: barang dengan SKU 'XYZ' tidak ditemukan.",
    ...
  ],
  physical_inputs: {
    "product_id_1": 10,
    "product_id_2": 25,
    ...
  },
  message: "25 item berhasil diproses"
}
```

---

### **GET /download/so-template** (NEW)
Download template Excel untuk Stock Opname dengan data barang terkini.

**Autentikasi:** Minimal role ADMIN

**Response:** File Excel (template_stock_opname.xlsx)

---

### **POST /api/stock-opname/adjust** (EXISTING - DIPERBAHARUI)
Endpoint sebelumnya tetap ada untuk kompatibilitas. Endpoint baru `/api/finalize-so` adalah pengganti yang lebih robust.

---

## 📊 DATA FLOW UNTUK STOCK OPNAME

```
1. USER MEMULAI SO
   ↓
2. PILIH METODE: Manual (Scan) atau Excel (Upload)
   ↓
3. INPUT STOK FISIK
   ├─ Manual: Cari barang → Input stok → Melihat variance realtime
   └─ Excel: Upload file → Validasi & preview
   ↓
4. KONFIRMASI DAN FINALISASI
   ├─ Call POST /api/finalize-so
   ├─ Backend calculate variance
   ├─ Update Products table (stock = physical_stock)
   ├─ Save history & items
   └─ Log audit
   ↓
5. LAPORAN HASIL SO DIBUAT
   ├─ Ringkasan: Total variance, surplus, shortage
   ├─ Detail: Item-item dengan variance
   ├─ User info: Siapa yang melakukan & kapan
   └─ Bisa diunduh sebagai PDF (BAGIAN 3)
```

---

## 🔒 VALIDASI & KEAMANAN

✅ **Authentication:** Semua endpoint memerlukan login (ADMIN minimal)

✅ **Numeric Validation:** 
- Physical stock tidak boleh negatif
- Variance calculation dengan presisi tinggi

✅ **Data Integrity:**
- SKU matching case-insensitive (normalizeSku)
- Duplicate check pada product lookup

✅ **Audit Trail:**
- Setiap SO tercatat dengan detail user & role
- AuditLog menyimpan: who, what, when, dan details

---

## 💾 STRUKTUR DATA SIMPANAN

**File:** `data/kasir_database.csv`

Data disimpan dalam format CSV dengan section header untuk setiap tabel:
```
__sheet,StockOpnameHistory
__headers,id,so_date,user_id,user_name,user_role,status,...
,1,2026-05-12 10:30:45,1,Admin Toko,admin,finalized,...

__sheet,StockOpnameItems
__headers,id,so_history_id,product_id,sku,name,...
,1,1,1,BRG-001,Kopi Sachet,...
,2,1,2,BRG-002,Gula 1kg,...

__sheet,AuditLog
__headers,id,timestamp,user_id,user_name,user_role,action,...
,1,2026-05-12 10:30:45,1,Admin Toko,admin,FINALIZE_STOCK_OPNAME,...
```

---

## 📝 CONTOH PENGGUNAAN API

### Scenario: Admin melakukan SO dengan 25 barang

**Step 1: Download Template**
```
GET /download/so-template
→ Dapatkan file Excel dengan SKU, Nama, Stok Sistem
```

**Step 2: Upload Template (jika pakai Excel)**
```
POST /api/stock-opname/import
{
  "filename": "template_stock_opname.xlsx",
  "content_base64": "UEsDBAoA..."
}
→ Validasi & parsing file
→ Return physical_inputs: {product_id: qty}
```

**Step 3: Finalisasi SO**
```
POST /api/finalize-so
{
  "physical_stocks": {
    "1": 22,   // Kopi: sistem 25 → fisik 22 = -3 selisih
    "2": 12,   // Gula: sistem 10 → fisik 12 = +2 selisih
    ...
  },
  "method": "excel",
  "notes": "SO rutin bulanan"
}

Response:
{
  "so_history_id": "1",
  "so_history": {...},
  "variances": [
    {
      "product_id": "1",
      "sku": "BRG-001",
      "name": "Kopi Sachet",
      "system_stock": 25,
      "physical_stock": 22,
      "variance": -3,
      "variance_value": -4500,    // -3 × 1500 (buy_price)
      "buy_price": 1500
    },
    ...
  ],
  "summary": {
    "total_variance": -1,
    "surplus_value": 1000,
    "shortage_value": 4500,
    "total_items": 2
  }
}
```

**Step 4: Check History**
```
GET /api/stock-opname/history
→ Lihat riwayat semua SO sebelumnya
```

**Step 5: Get Details**
```
GET /api/stock-opname/items/1
→ Lihat detail lengkap SO dengan ID 1
```

---

## ✅ YANG SUDAH SELESAI PADA BAGIAN 1

- ✅ Tambah 3 schema database baru: StockOpnameHistory, StockOpnameItems, AuditLog
- ✅ Buat helper functions: logAudit, calculateStockVariance, soTemplateBuffer, importStockOpnameFromRows
- ✅ Endpoint POST /api/finalize-so (utama untuk finalisasi SO)
- ✅ Endpoint GET /api/stock-opname/history (lihat history)
- ✅ Endpoint GET /api/stock-opname/items/:id (detail SO)
- ✅ Endpoint POST /api/stock-opname/import (import dari Excel)
- ✅ Endpoint GET /download/so-template (download template)
- ✅ Audit logging untuk transparansi
- ✅ Validasi data dan error handling
- ✅ Numeric columns registration untuk normalisasi data

---

## 🚀 SIAP UNTUK BAGIAN 2

Fondasi backend sudah solid! Sekarang siap untuk:

**BAGIAN 2: UI REVISION - DUAL MODE**
- Implementasi Tab Interface (Manual & Excel)
- Form input dengan real-time variance calculation
- Excel upload handler
- UI component integration
- Frontend API calls ke endpoint yang sudah dibuat

---

## 📌 CATATAN PENTING

1. **AuditLog akan terus bertambah** - Pastikan cleanup rutin jika database tumbuh besar
2. **Physical Stock Validation** - Di step 3 (Finalisasi), physical_stock harus ≥ 0
3. **Variance Calculation** - Hanya item dengan variance ≠ 0 yang disimpan di StockOpnameItems (efisiensi)
4. **Role-based Access** - Hanya ADMIN/DEVELOPER/OWNER yang bisa akses SO endpoints
5. **Method Tracking** - "manual" atau "excel" dicatat untuk audit trail

---

**Status BAGIAN 1: ✅ COMPLETE & TESTED**

Lanjut ke BAGIAN 2 untuk implementasi UI!
