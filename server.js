const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, "data");
const DB_CSV_PATH = path.join(DATA_DIR, "kasir_database.csv");
const DB_XLSX_PATH = path.join(DATA_DIR, "kasir_database.xlsx");
const REPORT_CSV_PATH = path.join(DATA_DIR, "laporan_kasir.csv");
const PRODUCT_TEMPLATE_NAME = "template_data_barang.xlsx";
const RETURN_TEMPLATE_NAME = "template_retur_barang.xlsx";
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 8765;

const SHEETS = {
  Users: ["id", "username", "password_hash", "role", "name", "active", "created_at"],
  Settings: ["key", "value", "updated_at"],
  Products: [
    "id",
    "sku",
    "name",
    "category",
    "unit",
    "stock",
    "min_stock",
    "buy_price",
    "sell_price",
    "supplier_id",
    "updated_at",
  ],
  Suppliers: ["id", "name", "phone", "address", "notes", "created_at"],
  Sales: [
    "id",
    "invoice_no",
    "date",
    "customer",
    "subtotal",
    "discount",
    "total",
    "paid",
    "change",
    "payment_method",
    "user_id",
    "notes",
    "status",
    "canceled_at",
    "canceled_by",
    "cancel_reason",
  ],
  SaleItems: ["id", "sale_id", "product_id", "sku", "name", "qty", "price", "subtotal", "batch_id", "batch_allocations"],
  Purchases: ["id", "purchase_no", "date", "supplier_id", "supplier_name", "total", "user_id", "notes"],
  PurchaseItems: ["id", "purchase_id", "product_id", "sku", "name", "qty", "cost", "subtotal", "batch_id", "batch_date"],
  Returns: ["id", "return_no", "date", "product_id", "sku", "name", "qty", "user_id", "notes", "supplier_id", "supplier_name"],
  StockOpname: ["id", "date", "user_id", "user_name", "total_variance", "surplus_value", "shortage_value", "notes"],
  StockOpnameHistory: ["id", "date", "user_id", "user_name", "user_role", "total_variance", "surplus_value", "shortage_value", "method", "notes", "finalized_at"],
  StockOpnameItems: ["id", "stock_opname_id", "product_id", "sku", "name", "system_stock", "physical_stock", "variance", "variance_value", "buy_price"],
  AuditLogs: ["id", "at", "action", "object_type", "object_id", "user_id", "user_name", "user_role", "details"],
  Report: ["section", "date", "ref", "name", "qty", "in", "out", "total", "notes"],
};

const ROLE_DEVELOPER = "developer";
const ROLE_ADMIN = "admin";
const ROLE_CASHIER = "kasir";
const ROLE_OWNER = "owner";

const NUMERIC_COLUMNS = new Set([
  "stock",
  "min_stock",
  "buy_price",
  "sell_price",
  "subtotal",
  "discount",
  "total",
  "paid",
  "change",
  "qty",
  "price",
  "cost",
  "in",
  "out",
]);

const sessions = new Map();

function nowIso() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

function todayStamp() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function todayDate() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number.isInteger(number) ? number : number;
}

function normalizeId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const number = Number(text);
  if (Number.isFinite(number) && String(number) === text.replace(/\.0+$/, "")) {
    return String(number);
  }
  return text;
}

function normalizeSku(value) {
  let val = String(value || "").trim().toLowerCase();
  if (val.endsWith(".0")) {
    val = val.slice(0, -2);
  }
  return val;
}

function passwordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function defaultSettingsRows() {
  const timestamp = nowIso();
  return [
    { key: "store_name", value: "Toko Anda", updated_at: timestamp },
    { key: "store_subtitle", value: "Database spreadsheet", updated_at: timestamp },
    { key: "app_name", value: "Aplikasi Kasir Lokal", updated_at: timestamp },
    { key: "receipt_store_name", value: "TOKO ANDA", updated_at: timestamp },
  ];
}

function settingsObject(data) {
  const defaults = Object.fromEntries(defaultSettingsRows().map((row) => [row.key, row.value]));
  (data.Settings || []).forEach((row) => {
    if (row.key) defaults[row.key] = row.value;
  });
  return defaults;
}

function getSetting(data, key, fallback = "") {
  return settingsObject(data)[key] || fallback;
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalize(data) {
  Object.entries(SHEETS).forEach(([sheet, headers]) => {
    if (!Array.isArray(data[sheet])) data[sheet] = [];
    data[sheet].forEach((row) => {
      headers.forEach((header) => {
        if (!(header in row)) row[header] = NUMERIC_COLUMNS.has(header) ? 0 : "";
        if (NUMERIC_COLUMNS.has(header)) row[header] = asNumber(row[header]);
      });
      if (sheet === "Sales" && !row.status) row.status = "active";
    });
  });
  if (Array.isArray(data.StockOpname) && !Array.isArray(data.StockOpnameHistory)) {
    data.StockOpnameHistory = data.StockOpname;
  }
  if (Array.isArray(data.StockOpnameHistory) && !Array.isArray(data.StockOpname)) {
    data.StockOpname = data.StockOpnameHistory;
  }
  ensureDataDefaults(data);
  return data;
}

function ensureDataDefaults(data) {
  const timestamp = nowIso();
  const settingKeys = new Set((data.Settings || []).map((row) => row.key));
  defaultSettingsRows().forEach((setting) => {
    if (!settingKeys.has(setting.key)) data.Settings.push({ ...setting, updated_at: timestamp });
  });
  const hasDefaultDeveloper = (data.Users || []).some((user) => String(user.username || "").toLowerCase() === "developer");
  if (!hasDefaultDeveloper) {
    data.Users.push({
      id: nextId(data.Users || []),
      username: "developer",
      password_hash: passwordHash("developer123"),
      role: ROLE_DEVELOPER,
      name: "Developer",
      active: "1",
      created_at: timestamp,
    });
  }
  return data;
}

function appendAuditLog(data, { action, objectType, objectId, user, details }) {
  if (!Array.isArray(data.AuditLogs)) data.AuditLogs = [];
  const audit = {
    id: nextId(data.AuditLogs),
    at: nowIso(),
    action: String(action || "").trim(),
    object_type: String(objectType || "").trim(),
    object_id: String(objectId || "").trim(),
    user_id: String(user.id || "").trim(),
    user_name: String(user.name || user.username || "").trim(),
    user_role: String(user.role || "").trim(),
    details: String(details || "").trim(),
  };
  data.AuditLogs.push(audit);
  return audit;
}

function writeDatabaseCsv(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = [];
  Object.entries(SHEETS).forEach(([sheet, headers]) => {
    lines.push(csvLine(["__sheet", sheet]));
    lines.push(csvLine(["__headers", ...headers]));
    (data[sheet] || []).forEach((row) => {
      lines.push(csvLine(["", ...headers.map((header) => row[header] ?? "")]));
    });
    lines.push("");
  });
  fs.writeFileSync(DB_CSV_PATH, `\ufeff${lines.join("\r\n")}`, "utf8");
}

function readDatabaseCsv() {
  const data = Object.fromEntries(Object.keys(SHEETS).map((sheet) => [sheet, []]));
  if (!fs.existsSync(DB_CSV_PATH)) return data;
  const rows = parseCsv(fs.readFileSync(DB_CSV_PATH, "utf8").replace(/^\ufeff/, ""));
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row[0] !== "__sheet" || !SHEETS[row[1]]) {
      index += 1;
      continue;
    }
    const sheet = row[1];
    const headersRow = rows[index + 1] || [];
    const headers = headersRow[0] === "__headers" ? headersRow.slice(1) : SHEETS[sheet];
    index += 2;
    while (index < rows.length && rows[index][0] !== "__sheet") {
      const dataRow = rows[index];
      if (dataRow.some((cell) => String(cell || "").trim())) {
        const record = {};
        headers.forEach((header, headerIndex) => {
          if (!SHEETS[sheet].includes(header)) return;
          const raw = dataRow[headerIndex + 1] ?? "";
          record[header] = NUMERIC_COLUMNS.has(header) ? asNumber(raw) : raw;
        });
        data[sheet].push(record);
      }
      index += 1;
    }
  }
  return normalize(data);
}

function nextId(rows) {
  const ids = rows.map((row) => Number(row.id || 0)).filter(Number.isFinite);
  return String(Math.max(0, ...ids) + 1);
}

function generateSKU(data, category = "") {
  const products = data.Products || [];
  const baseCategory = String(category || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "BRG";
  const existingSKUs = new Set(products.map(p => String(p.sku || "").toUpperCase()));
  
  let counter = 1;
  let sku;
  do {
    sku = `${baseCategory}-${todayStamp().slice(-4)}-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existingSKUs.has(sku.toUpperCase()) && counter < 1000);
  
  return sku;
}

function reduceStockFIFO(data, productId, qtyNeeded) {
  const purchaseItems = data.PurchaseItems.filter((item) => String(item.product_id) === String(productId))
    .sort((a, b) => new Date(a.batch_date) - new Date(b.batch_date)); // FIFO: oldest first
  
  let remainingQty = qtyNeeded;
  const usedBatches = [];
  const trackedQty = purchaseItems.reduce((sum, item) => sum + asNumber(item.qty), 0);
  
  for (const item of purchaseItems) {
    if (remainingQty <= 0) break;
    const availableQty = asNumber(item.qty);
    if (availableQty > 0) {
      const usedQty = Math.min(remainingQty, availableQty);
      usedBatches.push({
        batch_id: item.batch_id,
        qty: usedQty,
        cost: asNumber(item.cost),
      });
      item.qty = availableQty - usedQty; // Reduce available qty in batch
      remainingQty -= usedQty;
    }
  }
  
  if (remainingQty > 0) {
    const product = findById(data.Products, productId);
    const overallStock = asNumber(product?.stock);
    const untrackedStock = Math.max(overallStock - trackedQty, 0);

    if (untrackedStock > 0) {
      const syntheticBatchId = `BATCH-UNTRACKED-${productId}`;
      let syntheticItem = data.PurchaseItems.find(
        (pi) => String(pi.batch_id) === syntheticBatchId && String(pi.product_id) === String(productId),
      );
      if (!syntheticItem) {
        syntheticItem = {
          id: nextId(data.PurchaseItems),
          purchase_id: "0",
          product_id: productId,
          sku: product?.sku || "",
          name: product?.name || "",
          qty: 0,
          cost: asNumber(product?.buy_price),
          subtotal: 0,
          batch_id: syntheticBatchId,
          batch_date: nowIso(),
        };
        data.PurchaseItems.push(syntheticItem);
      }
      syntheticItem.qty = asNumber(syntheticItem.qty) + untrackedStock;
      syntheticItem.subtotal = asNumber(syntheticItem.cost) * syntheticItem.qty;

      const availableQty = asNumber(syntheticItem.qty);
      const usedQty = Math.min(remainingQty, availableQty);
      usedBatches.push({
        batch_id: syntheticBatchId,
        qty: usedQty,
        cost: asNumber(syntheticItem.cost),
      });
      syntheticItem.qty = availableQty - usedQty;
      remainingQty -= usedQty;
    }
  }
  
  if (remainingQty > 0) {
    throw new AppError(400, `Stok tidak cukup untuk produk ${productId}. FIFO calculation failed.`);
  }
  
  return usedBatches;
}

function findById(rows, id) {
  return rows.find((row) => String(row.id) === String(id));
}

function isActiveSale(sale) {
  return String(sale.status || "active") !== "canceled";
}

function reportRows(data) {
  const activeSales = data.Sales.filter(isActiveSale);
  const canceledSales = data.Sales.filter((sale) => !isActiveSale(sale));
  const totalSales = activeSales.reduce((sum, row) => sum + asNumber(row.total), 0);
  const totalPurchases = data.Purchases.reduce((sum, row) => sum + asNumber(row.total), 0);
  const stockValue = data.Products.reduce((sum, row) => sum + asNumber(row.stock) * asNumber(row.buy_price), 0);
  const rows = [
    {
      section: "Ringkasan",
      date: nowIso(),
      ref: "TOTAL",
      name: "Total Penjualan",
      qty: "",
      in: totalSales,
      out: "",
      total: totalSales,
      notes: "",
    },
    {
      section: "Ringkasan",
      date: nowIso(),
      ref: "TOTAL",
      name: "Total Pembelian",
      qty: "",
      in: "",
      out: totalPurchases,
      total: totalPurchases,
      notes: "",
    },
    {
      section: "Ringkasan",
      date: nowIso(),
      ref: "STOK",
      name: "Nilai Stok Modal",
      qty: "",
      in: "",
      out: "",
      total: stockValue,
      notes: "",
    },
  ];
  activeSales.forEach((sale) => {
    rows.push({
      section: "Penjualan",
      date: sale.date,
      ref: sale.invoice_no,
      name: sale.customer || "Umum",
      qty: "",
      in: sale.total,
      out: "",
      total: sale.total,
      notes: sale.payment_method || "",
    });
  });
  canceledSales.forEach((sale) => {
    rows.push({
      section: "Penjualan Batal",
      date: sale.canceled_at || sale.date,
      ref: sale.invoice_no,
      name: sale.customer || "Umum",
      qty: "",
      in: "",
      out: "",
      total: 0,
      notes: sale.cancel_reason || "Dibatalkan admin",
    });
  });
  data.Purchases.forEach((purchase) => {
    rows.push({
      section: "Pembelian",
      date: purchase.date,
      ref: purchase.purchase_no,
      name: purchase.supplier_name,
      qty: "",
      in: "",
      out: purchase.total,
      total: purchase.total,
      notes: purchase.notes || "",
    });
  });
  data.Products.forEach((product) => {
    rows.push({
      section: "Stok",
      date: nowIso(),
      ref: product.sku,
      name: product.name,
      qty: product.stock,
      in: "",
      out: "",
      total: asNumber(product.stock) * asNumber(product.buy_price),
      notes: `Minimal stok ${product.min_stock}`,
    });
  });
  return rows;
}

function writeReportCsv(data) {
  const headers = SHEETS.Report;
  const lines = [csvLine(headers)];
  data.Report.forEach((row) => lines.push(csvLine(headers.map((header) => row[header] ?? ""))));
  fs.writeFileSync(REPORT_CSV_PATH, `\ufeff${lines.join("\r\n")}`, "utf8");
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosTimeDate(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosTimeDate();
  files.forEach((file) => {
    const name = Buffer.from(file.name);
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function unzipEntries(buffer) {
  const entries = {};
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new AppError(400, "File Excel tidak valid.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) throw new AppError(400, "Struktur Excel tidak valid.");
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) {
      entries[name] = compressed;
    } else if (method === 8) {
      entries[name] = require("node:zlib").inflateRawSync(compressed);
    } else {
      throw new AppError(400, "Metode kompresi Excel tidak didukung.");
    }
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function xmlUnescape(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function xmlAttr(xml, name) {
  const match = xml.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return match ? xmlUnescape(match[1]) : "";
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const rem = (current - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function columnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index;
}

function sheetXml(rows) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsx(sheets) {
  const sheetNames = sheets.map((sheet) => sheet.name);
  const workbookSheets = sheetNames
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  const workbookRels = sheetNames
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const overrides = sheetNames
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
    },
  ];
  sheets.forEach((sheet, index) => {
    const rows = [sheet.headers, ...sheet.rows.map((row) => sheet.headers.map((header) => row[header] ?? ""))];
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(rows) });
  });
  return makeZip(files);
}

function writeXlsx(data) {
  const sheets = Object.keys(SHEETS).map((sheet) => ({
    name: sheet,
    headers: SHEETS[sheet],
    rows: data[sheet] || [],
  }));
  try {
    fs.writeFileSync(DB_XLSX_PATH, buildXlsx(sheets));
  } catch (err) {
    // If the XLSX file is locked by another program (e.g., Excel), don't crash the server.
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      console.warn('Warning: could not write XLSX database file (locked):', DB_XLSX_PATH);
    } else {
      throw err;
    }
  }
}

function writeXlsxFile(data, outputPath) {
  const sheets = Object.keys(SHEETS).map((sheet) => ({
    name: sheet,
    headers: SHEETS[sheet],
    rows: data[sheet] || [],
  }));
  fs.writeFileSync(outputPath, buildXlsx(sheets));
}

function sqlValue(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) {
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function databaseSql(data) {
  const lines = [];
  Object.entries(SHEETS).forEach(([sheet, headers]) => {
    const rows = data[sheet] || [];
    if (!rows.length) return;
    lines.push(`-- ${sheet}`);
    rows.forEach((row) => {
      const cols = headers.filter((header) => header in row);
      const values = cols.map((header) => sqlValue(row[header]));
      lines.push(`INSERT INTO ${sheet} (${cols.join(", ")}) VALUES (${values.join(", ")});`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

function productTemplateBuffer(data) {
  return buildXlsx([
    {
      name: "Products",
      headers: SHEETS.Products,
      rows: data.Products || [],
    },
  ]);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlUnescape(part[1])).join(""),
  );
}

function parseSheetRows(sheetXmlText, sharedStrings = []) {
  const rows = [];
  const rowMatches = [...sheetXmlText.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)];
  rowMatches.forEach((rowMatch) => {
    const row = [];
    let sequentialColumn = 1;
    const cellMatches = [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)];
    cellMatches.forEach((cellMatch) => {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = xmlAttr(attrs, "r");
      const col = columnIndex(ref) || sequentialColumn;
      sequentialColumn = col + 1;
      const type = xmlAttr(attrs, "t");
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlUnescape(part[1])).join("");
      } else {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
        value = type === "s" ? sharedStrings[Number(raw)] || "" : xmlUnescape(raw);
      }
      row[col - 1] = value;
    });
    rows.push(row.map((value) => value ?? ""));
  });
  return rows;
}

function parseXlsxRows(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: false, cellDates: true, raw: false });
  const defaultSheetName = String(options.defaultSheet || "products").toLowerCase();
  const sheetName = workbook.SheetNames.find((name) => String(name || "").toLowerCase() === defaultSheetName) || workbook.SheetNames[0];
  if (!sheetName) throw new AppError(400, `Sheet ${options.defaultSheet || "Products"} tidak ditemukan.`);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new AppError(400, "Sheet tidak bisa dibaca.");
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function parseProductUpload(filename, buffer) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".csv") return parseCsv(buffer.toString("utf8").replace(/^\ufeff/, ""));
  if (ext === ".xlsx" || ext === ".xls") return parseXlsxRows(buffer, { defaultSheet: "Products" });
  throw new AppError(400, "Gunakan file .xlsx, .xls, atau .csv.");
}

function parseWorkbookToData(buffer) {
  const entries = unzipEntries(buffer);
  const workbook = entries["xl/workbook.xml"]?.toString("utf8") || "";
  const rels = entries["xl/_rels/workbook.xml.rels"]?.toString("utf8") || "";
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"]?.toString("utf8") || "");
  const relTargets = {};
  [...rels.matchAll(/<Relationship\b([^>]*)\/?\>/gi)].forEach((match) => {
    const attrs = match[1];
    const id = xmlAttr(attrs, "Id");
    const target = xmlAttr(attrs, "Target");
    if (id && target) relTargets[id] = target;
  });
  const result = Object.fromEntries(Object.keys(SHEETS).map((sheet) => [sheet, []]));
  const sheetMatches = [...workbook.matchAll(/<sheet\b([^>]*)\/?\>/gi)];
  sheetMatches.forEach((match) => {
    const attrs = match[1];
    const sheetName = xmlAttr(attrs, "name") || "";
    const relId = xmlAttr(attrs, "r:id");
    if (!sheetName || !SHEETS[sheetName]) return;
    const target = relTargets[relId] || `xl/worksheets/${sheetName}.xml`;
    const normalizedTarget = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace("xl/xl/", "xl/");
    const sheetFile = entries[normalizedTarget];
    if (!sheetFile) return;
    const rows = parseSheetRows(sheetFile.toString("utf8"), sharedStrings);
    const headers = rows[0] ? rows[0].map((cell) => String(cell || "").trim()) : [];
    rows.slice(1).forEach((rowValues) => {
      if (!rowValues.some((cell) => String(cell || "").trim())) return;
      const record = {};
      headers.forEach((header, index) => {
        if (!SHEETS[sheetName].includes(header)) return;
        const raw = rowValues[index] ?? "";
        record[header] = NUMERIC_COLUMNS.has(header) ? asNumber(raw) : String(raw || "").trim();
      });
      result[sheetName].push(record);
    });
  });
  return normalize(result);
}

function parseExcelToData(filename, buffer) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext !== ".xlsx") throw new AppError(400, "Gunakan file .xlsx untuk restore database.");
  return parseWorkbookToData(buffer);
}

function parseReturnUpload(filename, buffer) {
  return parseProductUpload(filename, buffer);
}

function returnTemplateBuffer() {
  const headers = ["id", "product_id", "sku", "name", "qty", "notes"];
  return buildXlsx([
    {
      name: "Returns",
      headers,
      rows: [],
    },
  ]);
}

function importProductsFromRows(data, rows) {
  const firstRowIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
  if (firstRowIndex < 0) throw new AppError(400, "File barang kosong.");
  const headers = rows[firstRowIndex].map((cell) => String(cell || "").trim());
  const headerIndex = {};
  SHEETS.Products.forEach((header) => {
    const index = headers.findIndex((candidate) => candidate.toLowerCase() === header.toLowerCase());
    if (index >= 0) headerIndex[header] = index;
  });
  if (headerIndex.name === undefined) {
    throw new AppError(400, "Template tidak sesuai. Kolom name wajib ada.");
  }
  const errors = [];
  let created = 0;
  let updated = 0;
  rows.slice(firstRowIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => String(cell || "").trim())) return;
    const line = firstRowIndex + offset + 2;
    const record = {};
    SHEETS.Products.forEach((header) => {
      const index = headerIndex[header];
      const raw = index === undefined ? "" : row[index] ?? "";
      record[header] = NUMERIC_COLUMNS.has(header) ? asNumber(raw) : String(raw || "").trim();
    });
    let product = record.id ? findById(data.Products, record.id) : null;
    if (!product && record.sku) {
      const normalizedSku = normalizeSku(record.sku);
      product = data.Products.find((item) => normalizeSku(item.sku) === normalizedSku);
    }
    if (!record.name && !product) {
      errors.push(`Baris ${line}: name wajib diisi untuk barang baru`);
      return;
    }
    if (!record.name && product) {
      record.name = product.name;
    }
    if (product) {
      SHEETS.Products.forEach((header) => {
        if (header === "id") return;
        if (header === "stock") {
          product.stock = asNumber(product.stock) + asNumber(record.stock);
          return;
        }
        const rawValue = row[headerIndex[header]] ?? "";
        const rawText = String(rawValue || "").trim();
        if (rawText === "") return;
        product[header] = record[header];
      });
      product.unit = product.unit || "pcs";
      product.updated_at = nowIso();
      updated += 1;
    } else {
      record.id = record.id && !findById(data.Products, record.id) ? String(record.id) : nextId(data.Products);
      record.sku = record.sku || `BRG-${todayStamp()}-${String(data.Products.length + 1).padStart(3, "0")}`;
      record.unit = record.unit || "pcs";
      record.updated_at = nowIso();
      data.Products.push(record);
      created += 1;
    }
  });
  if (!created && !updated && errors.length) {
    throw new AppError(400, errors.slice(0, 5).join("; "));
  }
  return { created, updated, errors };
}

function importReturnsFromRows(data, rows, userId) {
  const firstRowIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
  if (firstRowIndex < 0) throw new AppError(400, "File retur kosong.");
  const headers = rows[firstRowIndex].map((cell) => String(cell || "").trim());
  const headerIndex = {};
  ["id", "product_id", "sku", "name", "qty", "notes"].forEach((name) => {
    const index = headers.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (index >= 0) headerIndex[name] = index;
  });
  if (headerIndex.qty === undefined) {
    throw new AppError(400, "Template retur tidak sesuai. Kolom qty wajib ada.");
  }
  const errors = [];
  let created = 0;
  rows.slice(firstRowIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => String(cell || "").trim())) return;
    const line = firstRowIndex + offset + 2;
    const rawId = headerIndex.id !== undefined ? String(row[headerIndex.id] || "").trim() : "";
    const rawSku = headerIndex.sku !== undefined ? String(row[headerIndex.sku] || "").trim() : "";
    const rawName = headerIndex.name !== undefined ? String(row[headerIndex.name] || "").trim() : "";
    const qty = asNumber(headerIndex.qty !== undefined ? row[headerIndex.qty] : 0);
    const notes = headerIndex.notes !== undefined ? String(row[headerIndex.notes] || "").trim() : "";
    if (qty <= 0) {
      errors.push(`Baris ${line}: qty harus lebih dari 0.`);
      return;
    }
    let product = rawId ? findById(data.Products, rawId) : null;
    if (!product && rawSku) {
      const normalizedSku = normalizeSku(rawSku);
      product = data.Products.find((item) => normalizeSku(item.sku) === normalizedSku);
    }
    if (!product) {
      errors.push(`Baris ${line}: barang tidak ditemukan dengan id atau sku yang diberikan.`);
      return;
    }
    if (asNumber(product.stock) < qty) {
      errors.push(`Baris ${line}: stok ${product.name} tidak cukup.`);
      return;
    }
    product.stock = asNumber(product.stock) - qty;
    product.updated_at = nowIso();
    const returnId = nextId(data.Returns);
    const record = {
      id: returnId,
      return_no: `RT-${todayStamp()}-${String(returnId).padStart(4, "0")}`,
      date: nowIso(),
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      user_id: String(userId),
      notes,
    };
    data.Returns.push(record);
    created += 1;
  });
  return { created, errors };
}

function saveData(data) {
  normalize(data);
  data.Report = reportRows(data);
  writeDatabaseCsv(data);
  writeReportCsv(data);
  writeXlsx(data);
}

function defaultData() {
  const timestamp = nowIso();
  return {
    Users: [
      {
        id: "1",
        username: "developer",
        password_hash: passwordHash("developer123"),
        role: ROLE_DEVELOPER,
        name: "Developer",
        active: "1",
        created_at: timestamp,
      },
      {
        id: "2",
        username: "admin",
        password_hash: passwordHash("admin123"),
        role: ROLE_ADMIN,
        name: "Admin Toko",
        active: "1",
        created_at: timestamp,
      },
      {
        id: "3",
        username: "kasir",
        password_hash: passwordHash("kasir123"),
        role: ROLE_CASHIER,
        name: "Kasir",
        active: "1",
        created_at: timestamp,
      },
    ],
    Settings: defaultSettingsRows(),
    Products: [
      {
        id: "1",
        sku: "BRG-001",
        name: "Contoh Kopi Sachet",
        category: "Minuman",
        unit: "pcs",
        stock: 25,
        min_stock: 5,
        buy_price: 1500,
        sell_price: 2500,
        supplier_id: "1",
        updated_at: timestamp,
      },
      {
        id: "2",
        sku: "BRG-002",
        name: "Contoh Gula 1kg",
        category: "Sembako",
        unit: "pcs",
        stock: 10,
        min_stock: 3,
        buy_price: 13000,
        sell_price: 15000,
        supplier_id: "1",
        updated_at: timestamp,
      },
    ],
    Suppliers: [
      {
        id: "1",
        name: "Supplier Utama",
        phone: "08xxxxxxxxxx",
        address: "Alamat supplier",
        notes: "Contoh data, silakan ubah.",
        created_at: timestamp,
      },
    ],
    Sales: [],
    SaleItems: [],
    Purchases: [],
    PurchaseItems: [],
    Returns: [],
    StockOpname: [],
    StockOpnameHistory: [],
    StockOpnameItems: [],
    AuditLogs: [],
    Report: [],
  };
}

function ensureDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_CSV_PATH)) saveData(defaultData());
  const data = readDatabaseCsv();
  saveData(data);
}

function isDeveloper(user) {
  return user && user.role === ROLE_DEVELOPER;
}

function isOwner(user) {
  return user && user.role === ROLE_OWNER;
}

function isManager(user) {
  return user && (user.role === ROLE_ADMIN || user.role === ROLE_DEVELOPER || user.role === ROLE_OWNER);
}

function isCashier(user) {
  return !isManager(user);
}

function publicData(data, user) {
  const clean = JSON.parse(JSON.stringify(data));
  clean.Users.forEach((user) => delete user.password_hash);
  if (isCashier(user)) {
    const visibleSales = clean.Sales.filter(
      (sale) => String(sale.user_id || "") === String(user.id || "") && String(sale.date || "").startsWith(todayDate()),
    );
    const saleIds = new Set(visibleSales.map((sale) => String(sale.id)));
    clean.Users = [];
    clean.Suppliers = [];
    clean.Purchases = [];
    clean.PurchaseItems = [];
    clean.Returns = [];
    clean.Report = [];
    clean.Sales = visibleSales;
    clean.SaleItems = clean.SaleItems.filter((item) => saleIds.has(String(item.sale_id)));
  }
  return clean;
}

function dashboard(data, user) {
  const today = todayDate();
  const activeSales = data.Sales.filter(isActiveSale);
  const visibleSales = isCashier(user)
    ? activeSales.filter((row) => String(row.user_id || "") === String(user.id || ""))
    : activeSales;
  const salesToday = visibleSales.filter((row) => String(row.date || "").startsWith(today)).reduce(
    (sum, row) => sum + asNumber(row.total),
    0,
  );
  const purchasesToday = isCashier(user)
    ? 0
    : data.Purchases.filter((row) => String(row.date || "").startsWith(today)).reduce(
    (sum, row) => sum + asNumber(row.total),
    0,
    );
  return {
    sales_today: salesToday,
    purchases_today: purchasesToday,
    total_products: data.Products.length,
    total_stock: data.Products.reduce((sum, row) => sum + asNumber(row.stock), 0),
    low_stock: data.Products.filter((row) => asNumber(row.stock) <= asNumber(row.min_stock)),
    total_sales: visibleSales.reduce((sum, row) => sum + asNumber(row.total), 0),
    total_purchases: isCashier(user) ? 0 : data.Purchases.reduce((sum, row) => sum + asNumber(row.total), 0),
    sensitive_locked: isCashier(user),
  };
}

function filteredReport(data, start, end) {
  return data.Report.filter((row) => {
    const rowDate = String(row.date || "").slice(0, 10);
    if (start && rowDate < start) return false;
    if (end && rowDate > end) return false;
    return true;
  });
}

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000_000) {
        reject(new AppError(413, "Data terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new AppError(400, "Format JSON tidak valid."));
      }
    });
    req.on("error", reject);
  });
}

function sendBuffer(res, buffer, contentType, downloadName = "") {
  const headers = {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
  };
  if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  res.writeHead(200, headers);
  res.end(buffer);
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function sendFile(res, filePath, downloadName = "") {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new AppError(404, "File tidak ditemukan.");
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".csv": "text/csv; charset=utf-8",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[ext] || "application/octet-stream";
  const headers = { "Content-Type": mime };
  if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function currentUser(req, url) {
  const token = req.headers["x-session-token"] || url.searchParams.get("token") || "";
  return sessions.get(token) || null;
}

function requireUser(req, url) {
  const user = currentUser(req, url);
  if (!user) throw new AppError(401, "Sesi login tidak ditemukan. Silakan login ulang.");
  return user;
}

function requireAdmin(req, url) {
  const user = requireUser(req, url);
  if (!isManager(user)) throw new AppError(403, "Hanya admin/developer yang bisa membuka fitur ini.");
  return user;
}

function requireDeveloper(req, url) {
  const user = requireUser(req, url);
  // Allow Developer and Owner to access developer-level APIs by default.
  if (!isDeveloper(user) && !isOwner(user)) {
    throw new AppError(403, "Hanya role developer atau owner yang memiliki akses penuh ke fitur ini.");
  }
  return user;
}

function receiptHtml(data, saleId) {
  const sale = findById(data.Sales, saleId);
  if (!sale) throw new AppError(404, "Nota tidak ditemukan.");
  const invoiceNo = String(sale.invoice_no || "").replace(/"/g, "");
  const receiptStoreName = getSetting(data, "receipt_store_name", getSetting(data, "store_name", "TOKO ANDA"));
  const items = data.SaleItems.filter((item) => String(item.sale_id) === String(saleId));
  const rows = items
    .map(
      (item) =>
        `<tr><td style="word-break: break-word; vertical-align: top;">${xmlEscape(item.name)}</td><td style="text-align: center; vertical-align: top;">${item.qty}</td><td style="text-align: right; vertical-align: top;">${rupiah(item.price)}</td><td style="text-align: right; vertical-align: top;">${rupiah(
          item.subtotal,
        )}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Nota ${xmlEscape(sale.invoice_no)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 320px; margin: 0 auto; color: #111827; padding: 10px; }
    h1 { font-size: 18px; margin: 18px 0 4px; text-align: center; }
    .meta { font-size: 12px; text-align: center; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; table-layout: fixed; }
    td, th { padding: 5px 0; border-bottom: 1px dashed #d1d5db; text-align: left; }
    th:nth-child(1), td:nth-child(1) { width: 46%; }
    th:nth-child(2), td:nth-child(2) { width: 10%; text-align: center; }
    th:nth-child(3), td:nth-child(3) { width: 22%; text-align: right; }
    th:nth-child(4), td:nth-child(4) { width: 22%; text-align: right; }
    .total { margin-top: 10px; font-size: 13px; }
    .total div { display: flex; justify-content: space-between; padding: 3px 0; }
    .grand { font-weight: 700; border-top: 1px solid #111827; margin-top: 6px; padding-top: 6px !important; }
    .thanks { text-align: center; margin-top: 18px; font-size: 12px; }
    .actions { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
    .button, button { display: inline-block; padding: 8px 12px; background: #111827; color: #fff; text-decoration: none; border: none; border-radius: 6px; cursor: pointer; }
    .button { line-height: 1.2; }
    .note { margin-top: 10px; font-size: 11px; color: #4b5563; text-align: center; }
    @media print { button, .button { display:none; } body { margin: 0 auto; } }
  </style>
</head>
<body>
  <h1>${xmlEscape(receiptStoreName)}</h1>
  <div class="meta">${xmlEscape(sale.invoice_no)}<br>${xmlEscape(sale.date)}</div>
  <table>
    <thead><tr><th>Barang</th><th>Qty</th><th>Harga</th><th>Jumlah</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">
    <div><span>Subtotal</span><strong>${rupiah(sale.subtotal)}</strong></div>
    <div><span>Diskon</span><strong>${rupiah(sale.discount)}</strong></div>
    <div class="grand"><span>Total</span><strong>${rupiah(sale.total)}</strong></div>
    <div><span>Bayar</span><strong>${rupiah(sale.paid)}</strong></div>
    <div><span>Kembali</span><strong>${rupiah(sale.change)}</strong></div>
  </div>
  <p class="thanks">Terima kasih sudah berbelanja.</p>
  <div class="actions">
    <button type="button" onclick="window.print()">Cetak / Simpan</button>
    <a id="download-receipt" class="button">Unduh</a>
  </div>
  <p class="note">Gunakan tombol Cetak / Simpan untuk mencetak atau menyimpan sebagai PDF, atau tutup halaman jika tidak ingin mencetak.</p>
  <script>
    const downloadAnchor = document.getElementById("download-receipt");
    if (downloadAnchor) {
      const params = new URLSearchParams(window.location.search);
      params.set("format", "pdf");
      downloadAnchor.href = window.location.pathname + "?" + params.toString();
      downloadAnchor.download = "nota-" + ${JSON.stringify(invoiceNo)} + ".pdf";
      downloadAnchor.target = "_blank";
    }
  </script>
</body>
</html>`;
}

async function receiptPdf(data, saleId) {
  const sale = findById(data.Sales, saleId);
  if (!sale) throw new AppError(404, "Nota tidak ditemukan.");
  const receiptStoreName = getSetting(data, "receipt_store_name", getSetting(data, "store_name", "TOKO ANDA"));
  const items = data.SaleItems.filter((item) => String(item.sale_id) === String(saleId));
  
  // PDFKit doesn't accept 'auto' height. Use a large fixed height so receipt
  // content fits; PDF will trim unused space when rendered/downloaded.
  const doc = new PDFDocument({ size: [226, 1000], margin: 10 }); // 80mm width
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  const finished = new Promise((resolve) => doc.on('end', resolve));
  
  // Header
  doc.fontSize(14).text(receiptStoreName, { align: 'center' });
  doc.fontSize(8).text(`${sale.invoice_no}`, { align: 'center' });
  doc.text(`${sale.date}`, { align: 'center' });
  doc.moveDown();
  
  // Items table
  doc.fontSize(7);
  const tableTop = doc.y;
  doc.text('Barang', 10, tableTop, { width: 95 });
  doc.text('Qty', 105, tableTop, { width: 20, align: 'center' });
  doc.text('Harga', 125, tableTop, { width: 42, align: 'right' });
  doc.text('Jumlah', 167, tableTop, { width: 49, align: 'right' });
  
  doc.moveDown(0.5);
  doc.strokeColor('#000').lineWidth(0.5).moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.5);
  
  items.forEach(item => {
    const y = doc.y;
    doc.text(item.name, 10, y, { width: 95 });
    const nameEndY = doc.y;
    
    doc.text(item.qty.toString(), 105, y, { width: 20, align: 'center' });
    doc.text(rupiah(item.price), 125, y, { width: 42, align: 'right' });
    doc.text(rupiah(item.subtotal), 167, y, { width: 49, align: 'right' });
    
    doc.y = Math.max(nameEndY, doc.y);
    doc.moveDown(0.4);
  });
  
  doc.moveDown();
  doc.strokeColor('#000').lineWidth(0.5).moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown();
  
  // Totals
  doc.text(`Subtotal: ${rupiah(sale.subtotal)}`, 10, doc.y);
  doc.moveDown(0.5);
  doc.text(`Diskon: ${rupiah(sale.discount)}`, 10, doc.y);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text(`Total: ${rupiah(sale.total)}`, 10, doc.y);
  doc.font('Helvetica').moveDown(0.5);
  doc.text(`Bayar: ${rupiah(sale.paid)}`, 10, doc.y);
  doc.moveDown(0.5);
  doc.text(`Kembali: ${rupiah(sale.change)}`, 10, doc.y);
  
  doc.moveDown();
  doc.fontSize(6).text('Terima kasih sudah berbelanja.', { align: 'center' });
  
  doc.end();
  await finished;
  return Buffer.concat(buffers);
}

async function stockOpnamePdf(data, soId) {
  const history = findById(data.StockOpnameHistory, soId);
  if (!history) throw new AppError(404, "Record SO tidak ditemukan.");
  const items = (data.StockOpnameItems || []).filter((item) => String(item.stock_opname_id) === String(soId));
  const storeName = getSetting(data, "store_name", "TOKO ANDA");
  const doc = new PDFDocument({ size: [595, 842], margin: 40 }); // A4 portrait
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  const finished = new Promise((resolve) => doc.on('end', resolve));
  
  doc.fontSize(18).text("LAPORAN STOCK OPNAME", { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#444').text(storeName, { align: 'center' });
  doc.moveDown(1);
  
  const userRoleLabel = String(history.user_role || "").toUpperCase();
  const methodLabel = String(history.method || "").toLowerCase() === 'excel' ? 'Excel Import' : 'Input Manual';
  
  doc.fontSize(10).fillColor('#111');
  doc.text(`Tanggal Finalisasi: ${history.finalized_at}`, { continued: true }).text(``, { align: 'right' });
  doc.moveDown(0.5);
  doc.text(`Pelaksana: ${history.user_name} (${userRoleLabel})`);
  doc.text(`Metode: ${methodLabel}`);
  doc.text(`Total Variance: ${history.total_variance}`);
  doc.text(`Kelebihan: ${rupiah(history.surplus_value)}`);
  doc.text(`Kekurangan: ${rupiah(history.shortage_value)}`);
  doc.moveDown(0.8);
  
  doc.fontSize(10).text('Detail Selisih:', { underline: true });
  doc.moveDown(0.4);
  
  const tableTop = doc.y;
  doc.font('Helvetica-Bold');
  doc.text('Barang', 40, tableTop, { width: 160 });
  doc.text('SKU', 200, tableTop, { width: 80 });
  doc.text('Sistem', 280, tableTop, { width: 50, align: 'right' });
  doc.text('Fisik', 330, tableTop, { width: 50, align: 'right' });
  doc.text('Selisih', 380, tableTop, { width: 50, align: 'right' });
  doc.text('Nilai', 430, tableTop, { width: 125, align: 'right' });
  doc.moveDown(0.3);
  doc.strokeColor('#ccc').lineWidth(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.2);
  doc.font('Helvetica');
  
  items.forEach((item) => {
    const y = doc.y;
    doc.text(item.name, 40, y, { width: 160 });
    const nameEndY = doc.y;
    
    doc.text(item.sku || '-', 200, y, { width: 80 });
    const skuEndY = doc.y;
    
    doc.text(String(item.system_stock), 280, y, { width: 50, align: 'right' });
    doc.text(String(item.physical_stock), 330, y, { width: 50, align: 'right' });
    doc.text(`${item.variance >= 0 ? '+' : ''}${item.variance}`, 380, y, { width: 50, align: 'right' });
    doc.text(rupiah(item.variance_value), 430, y, { width: 125, align: 'right' });
    
    doc.y = Math.max(nameEndY, skuEndY, doc.y);
    doc.moveDown(0.4);
  });
  
  if (String(history.notes || '').trim()) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Catatan:', { continued: false });
    doc.font('Helvetica').text(String(history.notes).trim());
  }
  
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#666').text('Laporan ini dibuat otomatis oleh sistem.', { align: 'center' });
  
  doc.end();
  await finished;
  return Buffer.concat(buffers);
}

async function handleGet(req, res, url) {
  if (url.pathname === "/") return sendFile(res, path.join(BASE_DIR, "index.html"));
  if (["/app.js", "/styles.css"].includes(url.pathname)) return sendFile(res, path.join(BASE_DIR, url.pathname));
  if (url.pathname === "/api/me") return sendJson(res, { user: currentUser(req, url) });
  if (url.pathname === "/api/data") {
    const user = requireUser(req, url);
    const data = readDatabaseCsv();
    data.Report = reportRows(data);
    return sendJson(res, { data: publicData(data, user), dashboard: dashboard(data, user), settings: settingsObject(data) });
  }
  if (url.pathname === "/api/report") {
    const user = requireAdmin(req, url);
    const data = readDatabaseCsv();
    data.Report = reportRows(data);
    return sendJson(res, {
      rows: filteredReport(data, url.searchParams.get("start") || "", url.searchParams.get("end") || ""),
      dashboard: dashboard(data, user),
    });
  }
  if (url.pathname === "/download/database") {
    requireAdmin(req, url);
    const data = readDatabaseCsv();
    saveData(data);
    const format = url.searchParams.get("format");
    if (format === "sql") {
      const sqlText = databaseSql(data);
      return sendBuffer(res, Buffer.from(sqlText, "utf8"), "application/sql", "kasir_database.sql");
    }
    return sendFile(res, DB_XLSX_PATH, "kasir_database.xlsx");
  }
  if (url.pathname === "/download/report") {
    requireAdmin(req, url);
    const data = readDatabaseCsv();
    saveData(data);
    return sendFile(res, REPORT_CSV_PATH, "laporan_kasir.csv");
  }
  if (url.pathname === "/download/products-template") {
    requireAdmin(req, url);
    const data = readDatabaseCsv();
    const buffer = productTemplateBuffer(data);
    return sendBuffer(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      PRODUCT_TEMPLATE_NAME,
    );
  }
  if (url.pathname === "/download/returns-template") {
    requireAdmin(req, url);
    const buffer = returnTemplateBuffer();
    return sendBuffer(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      RETURN_TEMPLATE_NAME,
    );
  }
  // Stock Opname - Download Template
  if (url.pathname === "/download/so-template") {
    requireAdmin(req, url);
    const data = readDatabaseCsv();
    
    const buffer = buildXlsx([
      {
        name: "Stock Opname",
        headers: ["Item Name", "Brand", "System Quantity", "Physical Quantity"],
        rows: (data.Products || []).map(p => ({
          "Item Name": p.name || "",
          "Brand": "",
          "System Quantity": asNumber(p.stock),
          "Physical Quantity": asNumber(p.stock)
        }))
      }
    ]);
    
    return sendBuffer(
      res,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `template_stock_opname_${todayStamp()}.xlsx`
    );
  }
  // Stock Opname - History
  if (url.pathname === "/api/stock-opname/history") {
    requireAdmin(req, url);
    const data = readDatabaseCsv();
    const history = (data.StockOpnameHistory || []).sort((a, b) => {
      const dateA = new Date(a.finalized_at || a.date || 0);
      const dateB = new Date(b.finalized_at || b.date || 0);
      return dateB - dateA;
    });
    return sendJson(res, { history });
  }
  // Stock Opname - Items Detail
  const soItemsMatch = url.pathname.match(/^\/api\/stock-opname\/items\/([^/]+)$/);
  if (soItemsMatch) {
    requireAdmin(req, url);
    const soId = decodeURIComponent(soItemsMatch[1]);
    const data = readDatabaseCsv();
    const soRecord = findById(data.StockOpnameHistory || [], soId);
    if (!soRecord) throw new AppError(404, "Record SO tidak ditemukan.");
    const items = (data.StockOpnameItems || []).filter((item) => String(item.stock_opname_id) === String(soId));
    return sendJson(res, { so: soRecord, items });
  }
  const soReportMatch = url.pathname.match(/^\/download\/so-report\/([^/]+)$/);
  if (soReportMatch) {
    const user = requireAdmin(req, url);
    const data = readDatabaseCsv();
    const soId = decodeURIComponent(soReportMatch[1]);
    const pdfBuffer = await stockOpnamePdf(data, soId);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="laporan-so-${soId}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.end(pdfBuffer);
    return;
  }
  const receiptMatch = url.pathname.match(/^\/receipt\/([^/]+)$/);
  if (receiptMatch) {
    const user = requireUser(req, url);
    const data = readDatabaseCsv();
    const saleId = decodeURIComponent(receiptMatch[1]);
    const sale = findById(data.Sales, saleId);
    if (!sale) throw new AppError(404, "Nota tidak ditemukan.");
    if (isCashier(user) && String(sale.user_id || "") !== String(user.id || "")) {
      throw new AppError(403, "Kasir hanya bisa mencetak nota transaksi miliknya.");
    }
    
    const format = url.searchParams.get("format");
    if (format === "pdf") {
      const pdfBuffer = await receiptPdf(data, saleId);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="nota-${sale.invoice_no}.pdf"`,
        "Content-Length": pdfBuffer.length,
      });
      res.end(pdfBuffer);
    } else {
      const html = Buffer.from(receiptHtml(data, saleId), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.length });
      res.end(html);
    }
    return;
  }
  throw new AppError(404, "Halaman tidak ditemukan.");
}

async function handlePost(req, res, url) {
  if (url.pathname === "/api/login") {
    const payload = await readBody(req);
    const username = String(payload.username || "").trim();
    const hash = passwordHash(payload.password || "");
    const data = readDatabaseCsv();
    const user = data.Users.find(
      (row) => row.username === username && row.password_hash === hash && String(row.active || "1") === "1",
    );
    if (!user) throw new AppError(401, "Username atau password salah.");
    const token = crypto.randomBytes(24).toString("hex");
    const sessionUser = { id: user.id, username: user.username, role: user.role, name: user.name };
    sessions.set(token, sessionUser);
    return sendJson(res, { token, user: sessionUser });
  }
  if (url.pathname === "/api/logout") {
    const token = req.headers["x-session-token"] || "";
    sessions.delete(token);
    return sendJson(res, { ok: true });
  }
  if (url.pathname === "/api/products") {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const product = {
      id: nextId(data.Products),
      sku: payload.sku || generateSKU(data, payload.category),
      name: String(payload.name || "").trim(),
      category: String(payload.category || "").trim(),
      unit: String(payload.unit || "pcs").trim() || "pcs",
      stock: asNumber(payload.stock),
      min_stock: asNumber(payload.min_stock),
      buy_price: asNumber(payload.buy_price),
      sell_price: asNumber(payload.sell_price),
      supplier_id: String(payload.supplier_id || ""),
      updated_at: nowIso(),
    };
    if (!product.name) throw new AppError(400, "Nama barang wajib diisi.");
    data.Products.push(product);
    saveData(data);
    return sendJson(res, { product });
  }
  if (url.pathname === "/api/products/import") {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const filename = String(payload.filename || "");
    const fileBase64 = String(payload.content_base64 || "");
    if (!fileBase64) throw new AppError(400, "File import belum dipilih.");
    const buffer = Buffer.from(fileBase64, "base64");
    const rows = parseProductUpload(filename, buffer);
    const data = readDatabaseCsv();
    const result = importProductsFromRows(data, rows);
    saveData(data);
    return sendJson(res, result);
  }
  if (url.pathname === "/api/returns/import") {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const filename = String(payload.filename || "");
    const fileBase64 = String(payload.content_base64 || "");
    if (!fileBase64) throw new AppError(400, "File import belum dipilih.");
    const buffer = Buffer.from(fileBase64, "base64");
    const rows = parseReturnUpload(filename, buffer);
    const data = readDatabaseCsv();
    const result = importReturnsFromRows(data, rows, requireUser(req, url).id);
    saveData(data);
    return sendJson(res, result);
  }
  if (url.pathname === "/api/returns") {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const product = findById(data.Products, String(payload.product_id || ""));
    if (!product) throw new AppError(400, "Barang tidak ditemukan.");
    const qty = asNumber(payload.qty);
    if (qty <= 0) throw new AppError(400, "Qty harus lebih dari 0.");
    if (asNumber(product.stock) < qty) throw new AppError(400, `Stok ${product.name} tidak cukup untuk retur.`);
    product.stock = asNumber(product.stock) - qty;
    product.updated_at = nowIso();
    const returnId = nextId(data.Returns);
    const user = requireUser(req, url);
    const supplier = supplierById(product.supplier_id);
    const record = {
      id: returnId,
      return_no: `RT-${todayStamp()}-${String(returnId).padStart(4, "0")}`,
      date: nowIso(),
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      user_id: user.id,
      notes: String(payload.notes || "").trim(),
      supplier_id: product.supplier_id || "",
      supplier_name: supplier ? supplier.name : "",
    };
    data.Returns.push(record);
    saveData(data);
    return sendJson(res, { return: record });
  }
  if (url.pathname === "/api/settings") {
    const user = requireDeveloper(req, url);
    if (!isDeveloper(user)) throw new AppError(403, "Hanya role developer yang diizinkan mengubah Pengaturan.");
    const payload = await readBody(req);
    const allowed = ["store_name", "store_subtitle", "app_name", "receipt_store_name", "qris_image"];
    const data = readDatabaseCsv();
    const timestamp = nowIso();
    allowed.forEach((key) => {
      if (!(key in payload)) return;
      let row = data.Settings.find((item) => item.key === key);
      if (!row) {
        row = { key, value: "", updated_at: timestamp };
        data.Settings.push(row);
      }
      row.value = String(payload[key] || "").trim();
      row.updated_at = timestamp;
    });
    saveData(data);
    return sendJson(res, { settings: settingsObject(data) });
  }
  if (url.pathname === "/api/suppliers") {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const supplier = {
      id: nextId(data.Suppliers),
      name: String(payload.name || "").trim(),
      phone: String(payload.phone || "").trim(),
      address: String(payload.address || "").trim(),
      notes: String(payload.notes || "").trim(),
      created_at: nowIso(),
    };
    if (!supplier.name) throw new AppError(400, "Nama supplier wajib diisi.");
    data.Suppliers.push(supplier);
    saveData(data);
    return sendJson(res, { supplier });
  }
  if (url.pathname === "/api/sales") {
    const user = requireUser(req, url);
    const payload = await readBody(req);
    const items = payload.items || [];
    if (!items.length) throw new AppError(400, "Keranjang penjualan masih kosong.");
    const data = readDatabaseCsv();
    const saleId = nextId(data.Sales);
    const saleItems = [];
    let subtotal = 0;
    items.forEach((item) => {
      const product = findById(data.Products, item.product_id);
      if (!product) throw new AppError(400, "Barang tidak ditemukan.");
      const qty = asNumber(item.qty);
      if (qty <= 0) throw new AppError(400, "Qty harus lebih dari 0.");
      if (asNumber(product.stock) < qty) throw new AppError(400, `Stok ${product.name} tidak cukup.`);
      
      // Use FIFO to reduce stock
      const usedBatches = reduceStockFIFO(data, item.product_id, qty);
      const batchId = usedBatches.length > 0 ? usedBatches[0].batch_id : "";
      
      const price = asNumber(item.price || product.sell_price);
      const lineTotal = qty * price;
      subtotal += lineTotal;
      product.stock = asNumber(product.stock) - qty;
      product.updated_at = nowIso();
      saleItems.push({
        id: nextId([...data.SaleItems, ...saleItems]),
        sale_id: saleId,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        price,
        subtotal: lineTotal,
        batch_id: batchId,
        batch_allocations: JSON.stringify(usedBatches),
      });
    });
    const discount = asNumber(payload.discount);
    const total = Math.max(subtotal - discount, 0);
    const paid = asNumber(payload.paid || total);
    const sale = {
      id: saleId,
      invoice_no: `INV-${todayStamp()}-${String(saleId).padStart(4, "0")}`,
      date: nowIso(),
      customer: String(payload.customer || "Umum").trim() || "Umum",
      subtotal,
      discount,
      total,
      paid,
      change: paid - total,
      payment_method: String(payload.payment_method || "Tunai"),
      user_id: user.id,
      notes: String(payload.notes || ""),
      status: "active",
      canceled_at: "",
      canceled_by: "",
      cancel_reason: "",
    };
    data.Sales.push(sale);
    data.SaleItems.push(...saleItems);
    saveData(data);
    return sendJson(res, { sale, items: saleItems });
  }
  const cancelSaleMatch = url.pathname.match(/^\/api\/sales\/([^/]+)\/cancel$/);
  if (cancelSaleMatch) {
    const user = requireAdmin(req, url);
    const payload = await readBody(req);
    const saleId = decodeURIComponent(cancelSaleMatch[1]);
    const data = readDatabaseCsv();
    const sale = findById(data.Sales, saleId);
    if (!sale) throw new AppError(404, "Transaksi penjualan tidak ditemukan.");
    if (!isActiveSale(sale)) throw new AppError(400, "Transaksi ini sudah dibatalkan.");
    const saleItems = data.SaleItems.filter((item) => String(item.sale_id) === String(saleId));
    const missingProducts = [];
    saleItems.forEach((item) => {
      const product = findById(data.Products, item.product_id);
      if (!product) {
        missingProducts.push(item.name || item.sku || item.product_id);
        return;
      }
      product.stock = asNumber(product.stock) + asNumber(item.qty);
      product.updated_at = nowIso();
      const allocations = [];
      if (item.batch_allocations) {
        try {
          const parsed = JSON.parse(item.batch_allocations);
          if (Array.isArray(parsed)) allocations.push(...parsed);
        } catch (_) {
          // ignore invalid allocation data
        }
      }
      if (!allocations.length && item.batch_id) {
        allocations.push({ batch_id: item.batch_id, qty: asNumber(item.qty) });
      }
      allocations.forEach((allocation) => {
        const purchaseItem = data.PurchaseItems.find((pi) => String(pi.batch_id) === String(allocation.batch_id));
        if (purchaseItem) {
          purchaseItem.qty = asNumber(purchaseItem.qty) + asNumber(allocation.qty);
        }
      });
    });
    sale.status = "canceled";
    sale.canceled_at = nowIso();
    sale.canceled_by = user.username || user.name || user.id;
    sale.cancel_reason = String(payload.reason || "Dibatalkan admin").trim() || "Dibatalkan admin";
    saveData(data);
    return sendJson(res, { sale, returned_items: saleItems.length - missingProducts.length, missing_products: missingProducts });
  }
  if (url.pathname === "/api/purchases") {
    const user = requireAdmin(req, url);
    const payload = await readBody(req);
    const items = payload.items || [];
    if (!items.length) throw new AppError(400, "Daftar pembelian masih kosong.");
    const data = readDatabaseCsv();
    const supplier = findById(data.Suppliers, payload.supplier_id);
    const purchaseId = nextId(data.Purchases);
    const purchaseItems = [];
    let total = 0;
    items.forEach((item) => {
      const product = findById(data.Products, item.product_id);
      if (!product) throw new AppError(400, "Barang tidak ditemukan.");
      const qty = asNumber(item.qty);
      const cost = asNumber(item.cost || product.buy_price);
      if (qty <= 0) throw new AppError(400, "Qty harus lebih dari 0.");
      const lineTotal = qty * cost;
      total += lineTotal;
      product.stock = asNumber(product.stock) + qty;
      product.buy_price = cost;
      product.updated_at = nowIso();
      purchaseItems.push({
        id: nextId([...data.PurchaseItems, ...purchaseItems]),
        purchase_id: purchaseId,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        qty,
        cost,
        subtotal: lineTotal,
        batch_id: `BATCH-${purchaseId}-${product.id}`,
        batch_date: nowIso(),
      });
    });
    const purchase = {
      id: purchaseId,
      purchase_no: `PO-${todayStamp()}-${String(purchaseId).padStart(4, "0")}`,
      date: nowIso(),
      supplier_id: String(payload.supplier_id || ""),
      supplier_name: supplier ? supplier.name : "Tanpa supplier",
      total,
      user_id: user.id,
      notes: String(payload.notes || ""),
    };
    data.Purchases.push(purchase);
    data.PurchaseItems.push(...purchaseItems);
    saveData(data);
    return sendJson(res, { purchase, items: purchaseItems });
  }
  if (url.pathname === "/api/users") {
    const currentUser = requireDeveloper(req, url);
    // Owner explicitly forbidden from accessing Users endpoint
    if (isOwner(currentUser)) throw new AppError(403, "Owner tidak diizinkan mengakses User.");
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const username = String(payload.username || "").trim();
    if (!username) throw new AppError(400, "Username wajib diisi.");
    if (data.Users.some((row) => row.username === username)) throw new AppError(400, "Username sudah digunakan.");
    const user = {
      id: nextId(data.Users),
      username,
      password_hash: passwordHash(payload.password || "123456"),
      role: String(payload.role || "kasir"),
      name: String(payload.name || username).trim() || username,
      active: "1",
      created_at: nowIso(),
    };
    data.Users.push(user);
    saveData(data);
    const clean = { ...user };
    delete clean.password_hash;
    return sendJson(res, { user: clean });
  }
  // BAGIAN 1: Stock Opname - Finalize Endpoint
  if (url.pathname === "/api/finalize-so") {
    const user = requireAdmin(req, url);
    const payload = await readBody(req);
    const physicalStocks = payload.physical_stocks || {};
    const data = readDatabaseCsv();
    
    const variances = [];
    let totalVariance = 0;
    let surplusValue = 0;
    let shortageValue = 0;
    
    Object.entries(physicalStocks).forEach(([productId, physicalStock]) => {
      const product = findById(data.Products, productId);
      if (!product) return;
      const systemStock = asNumber(product.stock);
      const physicalQty = asNumber(physicalStock);
      const variance = physicalQty - systemStock;
      const varianceValue = variance * asNumber(product.buy_price);
      
      variances.push({
        id: product.id,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        system_stock: systemStock,
        physical_stock: physicalQty,
        variance,
        variance_value: varianceValue,
        buy_price: asNumber(product.buy_price),
      });
      
      totalVariance += variance;
      if (variance > 0) {
        surplusValue += varianceValue;
      } else {
        shortageValue += Math.abs(varianceValue);
      }
      
      product.stock = physicalQty;
      product.updated_at = nowIso();
    });
    
    const soId = nextId(data.StockOpnameHistory || []);
    const soHistory = {
      id: soId,
      date: nowIso(),
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      total_variance: totalVariance,
      surplus_value: surplusValue,
      shortage_value: shortageValue,
      method: String(payload.method || "manual").trim(),
      notes: String(payload.notes || "").trim(),
      finalized_at: nowIso(),
    };
    
    if (!Array.isArray(data.StockOpnameHistory)) data.StockOpnameHistory = [];
    data.StockOpnameHistory.push(soHistory);
    if (!Array.isArray(data.StockOpnameItems)) data.StockOpnameItems = [];
    variances.forEach((item) => {
      data.StockOpnameItems.push({
        id: nextId(data.StockOpnameItems),
        stock_opname_id: soId,
        product_id: String(item.product_id),
        sku: item.sku,
        name: item.name,
        system_stock: item.system_stock,
        physical_stock: item.physical_stock,
        variance: item.variance,
        variance_value: item.variance_value,
        buy_price: item.buy_price,
      });
    });
    
    appendAuditLog(data, {
      action: "FINALIZE_STOCK_OPNAME",
      objectType: "StockOpnameHistory",
      objectId: soId,
      user,
      details: JSON.stringify({ method: soHistory.method, total_items: variances.length, notes: soHistory.notes }),
    });
    
    saveData(data);
    
    return sendJson(res, {
      ok: true,
      so_history: soHistory,
      summary: {
        total_items: variances.length,
        total_variance: totalVariance,
        surplus_value: surplusValue,
        shortage_value: shortageValue,
      },
      variances,
    });
  }
  
  // Stock Opname - Import Excel
  if (url.pathname === "/api/stock-opname/import") {
    const user = requireAdmin(req, url);
    const payload = await readBody(req);
    const filename = String(payload.filename || "");
    const fileBase64 = String(payload.content_base64 || "");
    if (!fileBase64) throw new AppError(400, "File SO belum dipilih.");
    
    try {
      const buffer = Buffer.from(fileBase64, "base64");
      const data = readDatabaseCsv();
      const ext = path.extname(filename || "").toLowerCase();
      let rows = [];

      if (ext === ".csv") {
        rows = parseCsv(buffer.toString("utf8").replace(/^\ufeff/, ""));
      } else if (ext === ".xlsx" || ext === ".xls") {
        rows = parseXlsxRows(buffer, { defaultSheet: "Stock Opname" });
      } else {
        throw new AppError(400, "Gunakan file .xlsx, .xls, atau .csv untuk import SO.");
      }

      const errors = [];
      const physical_inputs = {};
      let processed = 0;

      if (!rows || rows.length === 0) {
        throw new AppError(400, "File SO kosong atau tidak dapat diproses.");
      }

      const header = (rows[0] || []).map((cell) => String(cell || "").trim().toLowerCase());
      const skuIndex = header.findIndex((name) => ["sku", "kode", "kode barang", "kode produk", "product code", "barcode"].includes(name));
      const nameIndex = header.findIndex((name) => ["item name", "nama", "nama barang", "barang", "nama produk", "product name"].includes(name));
      const physicalIndex = header.findIndex((name) => [
        "stok fisik", "physical stock", "physical_stock", "stock fisik", "stock_physical", 
        "physical", "qty fisik", "jumlah fisik", "physical quantity"
      ].includes(name));

      if (skuIndex < 0 && nameIndex < 0) {
        throw new AppError(400, "Format file SO tidak sesuai. Kolom SKU atau Nama Barang dibutuhkan.");
      }
      if (physicalIndex < 0) {
        throw new AppError(400, "Format file SO tidak sesuai. Kolom Stok Fisik / Physical Quantity dibutuhkan.");
      }

      // Skip header row, process data rows
      rows.slice(1).forEach((row, idx) => {
        const rowIndex = idx + 2;
        
        // Skip completely empty rows
        if (!row || row.every(cell => cell === null || cell === undefined || String(cell).trim() === "")) {
          return;
        }

        let product;
        let identStr = "";

        if (skuIndex >= 0) {
          const rawSku = row[skuIndex];
          const normalizedFileSku = normalizeSku(rawSku);
          if (normalizedFileSku) {
            product = (data.Products || []).find((p) => normalizeSku(p.sku) === normalizedFileSku);
            identStr = `SKU "${rawSku}"`;
          }
        }

        if (!product && nameIndex >= 0) {
          const rawName = String(row[nameIndex] || "").trim().toLowerCase();
          if (rawName) {
            product = (data.Products || []).find((p) => String(p.name || "").trim().toLowerCase() === rawName);
            identStr = `Nama Barang "${row[nameIndex]}"`;
          }
        }

        if (!product) {
          errors.push(`Baris ${rowIndex}: Barang dengan ${identStr || "kombinasi identitas kosong"} tidak ditemukan`);
          return;
        }

        const rawPhysical = row[physicalIndex];
        if (rawPhysical === undefined || rawPhysical === null || String(rawPhysical).trim() === "") {
          errors.push(`Baris ${rowIndex}: Stok fisik untuk "${product.name}" tidak boleh kosong`);
          return;
        }

        const physicalStock = Number(rawPhysical);
        if (isNaN(physicalStock) || !Number.isFinite(physicalStock)) {
          errors.push(`Baris ${rowIndex}: Stok fisik untuk "${product.name}" harus berupa angka (ditemukan: "${rawPhysical}")`);
          return;
        }

        if (physicalStock < 0) {
          errors.push(`Baris ${rowIndex}: Stok fisik untuk "${product.name}" tidak boleh negatif (${physicalStock})`);
          return;
        }

        // Accumulate physical stock if product appears multiple times
        if (physical_inputs[product.id] !== undefined) {
          physical_inputs[product.id] += physicalStock;
        } else {
          physical_inputs[product.id] = physicalStock;
          processed++;
        }
      });

      return sendJson(res, {
        processed,
        physical_inputs,
        errors,
        message: `${processed} barang berhasil diproses dari file ${filename}`,
      });
    } catch (error) {
      throw new AppError(400, `Import gagal: ${error.message}`);
    }
  }
  
  throw new AppError(404, "Endpoint tidak ditemukan.");
}

async function handlePut(req, res, url) {
  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  const supplierMatch = url.pathname.match(/^\/api\/suppliers\/([^/]+)$/);
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (productMatch) {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const product = findById(data.Products, decodeURIComponent(productMatch[1]));
    if (!product) throw new AppError(404, "Barang tidak ditemukan.");
    ["sku", "name", "category", "unit", "supplier_id"].forEach((key) => {
      if (key in payload) product[key] = String(payload[key] || "").trim();
    });
    ["stock", "min_stock", "buy_price", "sell_price"].forEach((key) => {
      if (key in payload) product[key] = asNumber(payload[key]);
    });
    product.updated_at = nowIso();
    saveData(data);
    return sendJson(res, { product });
  }
  if (supplierMatch) {
    requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const supplier = findById(data.Suppliers, decodeURIComponent(supplierMatch[1]));
    if (!supplier) throw new AppError(404, "Supplier tidak ditemukan.");
    ["name", "phone", "address", "notes"].forEach((key) => {
      if (key in payload) supplier[key] = String(payload[key] || "").trim();
    });
    saveData(data);
    return sendJson(res, { supplier });
  }
  if (userMatch) {
    requireDeveloper(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    const user = findById(data.Users, decodeURIComponent(userMatch[1]));
    if (!user) throw new AppError(404, "User tidak ditemukan.");
    if ("username" in payload) {
      const username = String(payload.username || "").trim();
      if (!username) throw new AppError(400, "Username wajib diisi.");
      if (data.Users.some((row) => row.username === username && String(row.id) !== String(user.id))) {
        throw new AppError(400, "Username sudah digunakan.");
      }
      user.username = username;
    }
    if (
      user.role === ROLE_DEVELOPER &&
      payload.role &&
      payload.role !== ROLE_DEVELOPER &&
      data.Users.filter((row) => row.role === ROLE_DEVELOPER).length <= 1
    ) {
      throw new AppError(400, "Minimal harus ada satu user developer aktif.");
    }
    if (
      user.role === ROLE_DEVELOPER &&
      payload.active === "0" &&
      data.Users.filter((row) => row.role === ROLE_DEVELOPER && String(row.active || "1") === "1").length <= 1
    ) {
      throw new AppError(400, "Minimal harus ada satu user developer aktif.");
    }
    ["name", "role", "active"].forEach((key) => {
      if (key in payload) user[key] = String(payload[key] || "").trim();
    });
    if (payload.password) user.password_hash = passwordHash(payload.password);
    saveData(data);
    const clean = { ...user };
    delete clean.password_hash;
    return sendJson(res, { user: clean });
  }
  if (url.pathname === "/api/stock-opname/adjust") {
    const user = requireAdmin(req, url);
    const payload = await readBody(req);
    const data = readDatabaseCsv();
    
    const variances = payload.variances || [];
    let totalVariance = 0;
    let surplusValue = 0;
    let shortageValue = 0;
    
    // Update product stocks based on variances
    variances.forEach(v => {
      const product = findById(data.Products, v.id);
      if (product) {
        product.stock = v.physicalStock;
        product.updated_at = nowIso();
        totalVariance += v.variance;
        if (v.variance > 0) {
          surplusValue += v.variance * v.buy_price;
        } else {
          shortageValue += Math.abs(v.variance) * v.buy_price;
        }
      }
    });
    
    // Log the stock opname
    const soId = nextId(data.StockOpname);
    const stockOpnameRecord = {
      id: soId,
      date: nowIso(),
      user_id: user.id,
      user_name: user.name,
      total_variance: totalVariance,
      surplus_value: surplusValue,
      shortage_value: shortageValue,
      notes: `Stock Opname ${nowIso()}`,
    };
    data.StockOpname.push(stockOpnameRecord);
    
    saveData(data);
    return sendJson(res, { stockOpname: stockOpnameRecord });
  }
  if (url.pathname === "/api/developer-settings") {
    requireDeveloper(req, url);
    const payload = await readBody(req);
    // Save developer settings to settings table
    const data = readDatabaseCsv();
    const settings = data.Settings;
    
    const updateSetting = (key, value) => {
      let setting = settings.find(s => s.key === key);
      if (!setting) {
        setting = { key, value, updated_at: nowIso() };
        settings.push(setting);
      } else {
        setting.value = String(value);
        setting.updated_at = nowIso();
      }
    };
    
    updateSetting("dev_maintenance_mode", payload.maintenanceMode ? "1" : "0");
    updateSetting("dev_debug_mode", payload.debugMode ? "1" : "0");
    updateSetting("dev_session_timeout", String(payload.sessionTimeout || 60));
    updateSetting("dev_pagination_limit", String(payload.paginationLimit || 100));
    updateSetting("dev_api_key", String(payload.apiKey || ""));
    
    saveData(data);
    return sendJson(res, { ok: true });
  }
  if (url.pathname === "/api/developer/backup") {
    requireDeveloper(req, url);
    const data = readDatabaseCsv();
    saveData(data);
    const backupPath = path.join(DATA_DIR, `backup-${todayStamp()}-${Date.now()}.xlsx`);
    writeXlsxFile(data, backupPath);
    return sendJson(res, { backup_path: backupPath });
  }
  if (url.pathname === "/api/developer/restore") {
    requireDeveloper(req, url);
    const payload = await readBody(req);
    const filename = String(payload.filename || "");
    const fileBase64 = String(payload.content_base64 || "");
    if (!fileBase64) throw new AppError(400, "File restore belum dipilih.");
    
    const buffer = Buffer.from(fileBase64, "base64");
    const restoredData = parseExcelToData(filename, buffer);
    saveData(restoredData);
    return sendJson(res, { restored: true });
  }
  if (url.pathname === "/api/developer/force-kick-all") {
    requireDeveloper(req, url);
    sessions.clear();
    return sendJson(res, { kicked: true });
  }
  throw new AppError(404, "Endpoint tidak ditemukan.");
}

async function handleDelete(req, res, url) {
  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  const supplierMatch = url.pathname.match(/^\/api\/suppliers\/([^/]+)$/);
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (productMatch) {
    requireAdmin(req, url);
    const id = decodeURIComponent(productMatch[1]);
    const data = readDatabaseCsv();
    data.Products = data.Products.filter((row) => String(row.id) !== String(id));
    saveData(data);
    return sendJson(res, { ok: true });
  }
  if (supplierMatch) {
    requireAdmin(req, url);
    const id = decodeURIComponent(supplierMatch[1]);
    const data = readDatabaseCsv();
    data.Suppliers = data.Suppliers.filter((row) => String(row.id) !== String(id));
    saveData(data);
    return sendJson(res, { ok: true });
  }
  if (userMatch) {
    const current = requireDeveloper(req, url);
    const id = decodeURIComponent(userMatch[1]);
    if (String(current.id) === String(id)) throw new AppError(400, "User yang sedang login tidak bisa dihapus.");
    const data = readDatabaseCsv();
    const target = findById(data.Users, id);
    if (target?.role === ROLE_DEVELOPER && data.Users.filter((row) => row.role === ROLE_DEVELOPER).length <= 1) {
      throw new AppError(400, "Minimal harus ada satu user developer aktif.");
    }
    data.Users = data.Users.filter((row) => String(row.id) !== String(id));
    saveData(data);
    return sendJson(res, { ok: true });
  }
  throw new AppError(404, "Endpoint tidak ditemukan.");
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === "GET") return handleGet(req, res, url);
  if (req.method === "POST") return handlePost(req, res, url);
  if (req.method === "PUT") return handlePut(req, res, url);
  if (req.method === "DELETE") return handleDelete(req, res, url);
  throw new AppError(405, "Metode tidak didukung.");
}

ensureDatabase();

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, { error: error.message || "Terjadi kesalahan." }, status);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aplikasi kasir berjalan di http://${HOST}:${PORT}`);
  console.log(`Database spreadsheet CSV: ${DB_CSV_PATH}`);
  console.log(`Ekspor Excel: ${DB_XLSX_PATH}`);
});
