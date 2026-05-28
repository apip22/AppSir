# Aplikasi Kasir Spreadsheet

Aplikasi kasir lokal untuk penjualan, pembelian dari supplier, stok barang, laporan, user/password, dan cetak nota.

## Cara Menjalankan

1. Klik dua kali `JALANKAN_KASIR.bat`, atau jalankan:

   ```powershell
   node server.js
   ```

2. Buka `http://127.0.0.1:8765` jika menggunakan browser di komputer yang sama,
   atau `http://<IP_PC>:8765` dari HP/Android di jaringan Wi-Fi yang sama.

> Untuk menjalankan di Android secara lokal, gunakan Termux dengan perintah:
> ```sh
> pkg update
> pkg install nodejs
> cd /path/ke/folder/app\ sir
> node server.js
> ```
> Lalu buka `http://127.0.0.1:8765` di browser Android.

3. Login awal:

   - Developer: `developer` / `developer123`
   - Admin: `admin` / `admin123`
   - Kasir: `kasir` / `kasir123`

## Deploy ke Server Gratis

Proyek ini sudah siap untuk dideploy ke layanan Node.js gratis seperti Render atau Railway.

### Persiapan

1. Buat repository Git dari folder proyek:
   ```sh
   git init
   git add .
   git commit -m "Initial commit"
   ```
2. Push ke GitHub, GitLab, atau Bitbucket.

### Deploy di Render (contoh)

1. Daftar atau login ke https://render.com.
2. Buat "New Web Service".
3. Pilih repo Git yang sudah berisi proyek ini.
4. Gunakan build command: `npm install`.
5. Gunakan start command: `npm start`.
6. Render akan memberikan URL publik seperti `https://<nama-app>.onrender.com`.

### Deploy di Railway (alternatif)

1. Daftar atau login ke https://railway.app.
2. Buat proyek baru dan pilih "Deploy from GitHub".
3. Pilih repo yang berisi proyek ini.
4. Railway biasanya otomatis menjalankan `npm install` dan `npm start`.
5. Dapatkan URL publik setelah deploy selesai.

> Catatan: data disimpan di file lokal `data/kasir_database.csv`. Pada layanan gratis, data bisa hilang jika server restart atau aplikasi di-build ulang. Jika ingin data lebih permanen, gunakan layanan database luar atau backup file CSV secara manual.
>
> **Catatan lingkungan:** di sistem ini `git` dan `gh` tidak tersedia, jadi langkah pembuatan repository dan deploy harus dijalankan di komputer kamu sendiri.
> Lihat `DEPLOYMENT_STEPS.md` untuk panduan lengkap.

## File Data

- Database spreadsheet utama yang dibaca aplikasi: `data/kasir_database.csv`
- Ekspor Excel otomatis untuk dibuka di Excel: `data/kasir_database.xlsx`
- Laporan satu sheet: `data/laporan_kasir.csv`

File di folder `data` dibuat otomatis saat aplikasi pertama kali dijalankan.

Catatan penting: aplikasi ini belum tersambung ke Google Sheets atau file spreadsheet pribadi di luar folder aplikasi. Jika admin ingin memperbaiki data langsung lewat spreadsheet, edit `data/kasir_database.csv`, simpan, lalu klik `Refresh` di aplikasi. File `.xlsx` adalah hasil ekspor dari data aplikasi.

## Pembatalan Penjualan

Admin bisa membuka menu `Laporan`, lalu bagian `Riwayat Penjualan dan Pembatalan`. Tombol `Batalkan dan Kembalikan Stok` akan menandai transaksi sebagai batal dan otomatis mengembalikan qty barang ke stok utama.

## Import Data Barang dari Excel

Admin bisa membuka menu `Barang`, lalu klik `Template Excel`. File template berisi satu sheet `Products` dengan urutan kolom yang sama seperti database barang:

`id, sku, name, category, unit, stock, min_stock, buy_price, sell_price, supplier_id, updated_at`

Cara pakai:

1. Unduh template.
2. Edit atau tambah baris barang di Excel.
3. Simpan sebagai `.xlsx`.
4. Klik `Import Excel` di menu `Barang`.

Jika `id` atau `sku` sudah ada, data barang akan diperbarui. Jika belum ada, aplikasi akan menambahkan barang baru.

## Role dan Akses

- `developer`: akses penuh tanpa batas, termasuk pengaturan aplikasi, nama toko, user/password, laporan, import barang, dan pembatalan transaksi.
- `admin`: akses pengelolaan operasional seperti barang, supplier, pembelian, laporan, import barang, dan pembatalan transaksi.
- `kasir`: hanya akses transaksi penjualan, dashboard terbatas, dan daftar barang. Data user, laporan, pembelian, supplier, dan database sensitif tidak dikirim ke kasir.

Menu `Pengaturan` hanya muncul untuk role `developer`.
