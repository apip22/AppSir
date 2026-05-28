const fs = require('fs');
const content = fs.readFileSync('data/kasir_database.csv', 'utf8');
const lines = content.replace(/\r\n/g, '\n').split('\n');
const parse = (line) => {
  const values = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      values.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  values.push(cur);
  return values;
};
let currentSheet = null;
let headers = [];
const data = {};
for (const line of lines) {
  const row = parse(line);
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
    if (['id','product_id','purchase_id','supplier_id','user_id','qty','stock','min_stock','buy_price','sell_price','cost','subtotal','total','paid','change','discount','batch_id'].includes(key) && record[key] !== '') {
      const nv = Number(record[key]);
      record[key] = Number.isNaN(nv) ? record[key] : nv;
    }
  }
  if (Object.keys(record).length > 0) data[currentSheet].push(record);
}
console.log('PurchaseItems count', data.PurchaseItems.length);
console.log('PurchaseItems sample', data.PurchaseItems.slice(0,5));
console.log('SaleItems count', data.SaleItems.length);
console.log('SaleItems sample', data.SaleItems.slice(0,5));
