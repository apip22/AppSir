const fs = require('fs');
const path = require('path');

const DB_CSV_PATH = path.join(__dirname, 'data', 'kasir_database.csv');
const SHEETS = [
  'Users',
  'Settings',
  'Products',
  'Suppliers',
  'Sales',
  'SaleItems',
  'Purchases',
  'PurchaseItems',
  'Returns',
  'StockOpname',
  'StockOpnameHistory',
  'StockOpnameItems',
  'AuditLogs',
  'Report',
];

const NUMERIC_COLUMNS = new Set([
  'id',
  'product_id',
  'purchase_id',
  'supplier_id',
  'user_id',
  'qty',
  'stock',
  'min_stock',
  'buy_price',
  'sell_price',
  'cost',
  'subtotal',
  'total',
  'paid',
  'change',
  'discount',
  'batch_id',
]);

function parseCsv(content) {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0 || line === '');

  return lines.map((line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values;
  });
}

function csvEscape(value) {
  if (value == null) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function readDatabaseCsv(filePath) {
  const file = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(file);

  const data = {};
  let currentSheet = null;
  let headers = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row[0] && row[0].startsWith('__sheet')) {
      currentSheet = row[1];
      headers = [];
      data[currentSheet] = [];
      continue;
    }

    if (!currentSheet) continue;
    if (row[0] && row[0].startsWith('__headers')) {
      headers = row.slice(1);
      continue;
    }

    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      record[key] = row[i + 1] == null ? '' : row[i + 1];
      if (key && NUMERIC_COLUMNS.has(key) && record[key] !== '') {
        const numericValue = Number(record[key]);
        record[key] = Number.isNaN(numericValue) ? record[key] : numericValue;
      }
    }

    const hasNonEmptyField = Object.values(record).some(
      (value) => value !== '' && value !== undefined && value !== null
    );
    if (hasNonEmptyField) {
      data[currentSheet].push(record);
    }
  }

  for (const sheet of SHEETS) {
    if (!Object.prototype.hasOwnProperty.call(data, sheet)) {
      data[sheet] = [];
    }
  }

  return data;
}

function writeDatabaseCsv(filePath, data) {
  const sheetRows = [];

  for (const sheet of SHEETS) {
    let headers = ['__sheet', sheet];
    sheetRows.push(headers.join(','));

    const rows = data[sheet] || [];
    const allKeys = new Set();
    rows.forEach((row) => Object.keys(row).forEach((key) => allKeys.add(key)));

    const orderedKeys = Array.from(allKeys);
    headers = ['__headers', ...orderedKeys];
    sheetRows.push(headers.map(csvEscape).join(','));

    rows.forEach((row) => {
      const rowValues = [sheetRows.length, ...orderedKeys.map((key) => csvEscape(row[key]))];
      const rowIndex = ''; // preserve blank leading cell format
      const output = [rowIndex, ...orderedKeys.map((key) => csvEscape(row[key]))];
      sheetRows.push(output.join(','));
    });
    sheetRows.push('');
  }

  fs.writeFileSync(filePath, sheetRows.join('\r\n'), 'utf8');
}

function getNextId(records) {
  return records.reduce((max, record) => {
    const id = Number(record.id || 0);
    return Number.isNaN(id) ? max : Math.max(max, id);
  }, 0) + 1;
}

function nowISOString() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatChange(count, details) {
  return `${count} issue${count === 1 ? '' : 's'}: ${details}`;
}

function reconcileStocks(data) {
  const productStockById = new Map();
  const trackedQtyByProduct = new Map();
  const saleProductIds = new Set();

  for (const product of data.Products) {
    const normalizedId = Number(product.id);
    if (!Number.isNaN(normalizedId)) {
      productStockById.set(normalizedId, Number(product.stock || 0));
    }
  }

  for (const item of data.PurchaseItems) {
    const productId = Number(item.product_id);
    if (!Number.isNaN(productId)) {
      trackedQtyByProduct.set(productId, (trackedQtyByProduct.get(productId) || 0) + Number(item.qty || 0));
    }
  }

  for (const saleItem of data.SaleItems) {
    const productId = Number(saleItem.product_id);
    if (!Number.isNaN(productId)) {
      saleProductIds.add(productId);
    }
  }

  const problems = [];
  const repairItems = [];

  for (const [productId, stockQty] of productStockById.entries()) {
    const trackedQty = trackedQtyByProduct.get(productId) || 0;
    if (trackedQty !== stockQty) {
      const product = data.Products.find((p) => Number(p.id) === productId) || {};
      const sku = product.sku || '';
      if (trackedQty < stockQty) {
        problems.push(`Product ${productId} (${sku}) has product.stock=${stockQty} but tracked PurchaseItems qty=${trackedQty}. Missing ${stockQty - trackedQty}.`);
        repairItems.push({ product, missingQty: stockQty - trackedQty });
      } else {
        problems.push(`Product ${productId} (${sku}) has product.stock=${stockQty} but tracked PurchaseItems qty=${trackedQty}. Overtracked by ${trackedQty - stockQty}.`);
      }
    }
  }

  for (const saleProductId of saleProductIds) {
    if (!productStockById.has(saleProductId)) {
      problems.push(`SaleItem references unknown product_id=${saleProductId}.`);
    }
  }

  return { problems, repairItems };
}

function applyRepair(data, repairItems) {
  const now = nowISOString();
  let purchaseRecord = null;
  const purchaseId = getNextId(data.Purchases);

  if (repairItems.length > 0) {
    purchaseRecord = {
      id: purchaseId,
      purchase_no: `RECONCILE-${purchaseId}`,
      date: now,
      supplier_id: '',
      supplier_name: 'Rekonsiliasi Stok',
      total: 0,
      user_id: 0,
      notes: 'Purchase record created by reconcile_stock.js',
    };
    data.Purchases.push(purchaseRecord);
  }

  repairItems.forEach((repair) => {
    const { product, missingQty } = repair;
    const cost = Number(product.buy_price || 0);
    const subtotal = cost * missingQty;
    const purchaseItem = {
      id: getNextId(data.PurchaseItems),
      purchase_id: purchaseRecord.id,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty: missingQty,
      cost,
      subtotal,
      batch_id: `RECONCILE-${product.id}`,
      batch_date: now,
    };
    data.PurchaseItems.push(purchaseItem);
    purchaseRecord.total += subtotal;
  });
}

function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes('--fix');
  const dryRun = args.includes('--dry-run');

  console.log(`Reading database from ${DB_CSV_PATH}`);
  const data = readDatabaseCsv(DB_CSV_PATH);
  const { problems, repairItems } = reconcileStocks(data);

  if (problems.length === 0) {
    console.log('No stock reconciliation issues found.');
  } else {
    console.log('Stock reconciliation report:');
    problems.forEach((problem) => console.log(`- ${problem}`));
  }

  if (repairItems.length === 0) {
    console.log('No repair items needed.');
    return;
  }

  console.log(`Found ${repairItems.length} product(s) with missing tracked batch stock.`);
  repairItems.forEach((repair) => {
    console.log(`- Product ${repair.product.id} (${repair.product.sku}) missing ${repair.missingQty} units.`);
  });

  if (!fixMode) {
    console.log('\nRun `node reconcile_stock.js --fix` to apply repair items.');
    return;
  }

  if (dryRun) {
    console.log('\nDry run enabled. No changes were written.');
    return;
  }

  applyRepair(data, repairItems);
  writeDatabaseCsv(DB_CSV_PATH, data);
  console.log(`Applied repairs and wrote changes to ${DB_CSV_PATH}`);
}

main();
