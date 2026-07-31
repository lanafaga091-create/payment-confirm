/**
 * payment-confirm — server.js
 * Website TERPISAH dari panel BlockHost, tapi terhubung ke data yang sama
 * (folder blockhost/data/users.json) supaya begitu admin konfirmasi
 * pembayaran, paket user otomatis aktif di panel BlockHost.
 *
 * Cara kerja:
 *  - User isi form di /            -> permintaan konfirmasi tersimpan (status: pending)
 *  - Admin buka /admin.html        -> lihat daftar pending, tekan "Konfirmasi" atau "Tolak"
 *  - Saat dikonfirmasi             -> tier + tierExpiry user diupdate LANGSUNG di
 *                                     blockhost/data/users.json (file yang sama dipakai panel)
 *
 * Tidak butuh "npm install" — hanya modul bawaan Node.js.
 * Jalankan dengan: node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ====== KONFIGURASI ======
const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Folder blockhost ada di sebelah folder payment-confirm ini (../blockhost).
// Kalau lokasi folder blockhost-mu beda, ubah baris ini.
const BLOCKHOST_DIR = path.join(__dirname, '..', 'blockhost');
const BLOCKHOST_USERS_PATH = path.join(BLOCKHOST_DIR, 'data', 'users.json');

const DATA_DIR = path.join(__dirname, 'data');
const PAYMENTS_PATH = path.join(DATA_DIR, 'payments.json');

// GANTI password admin ini sebelum dipakai sungguhan!
const ADMIN_KEY = process.env.ADMIN_KEY || 'ganti-password-admin-ini';

// Info rekening/QRIS yang ditampilkan ke user (edit sesuai milikmu)
const PAYMENT_INFO = {
  bank: 'BCA',
  nomorRekening: '1234567890',
  atasNama: 'Nama Pemilik Rekening',
  catatan: 'Transfer sesuai nominal paket, lalu isi form di bawah dengan kode referensi/berita transfer supaya mudah dicek.',
};
// ==========================

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let payments = loadJSON(PAYMENTS_PATH, []); // [{id, email, name, tier, price, reference, note, status, createdAt, decidedAt}]
function savePayments() {
  saveJSON(PAYMENTS_PATH, payments);
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      cb(null, body ? JSON.parse(body) : {});
    } catch (e) {
      cb(e);
    }
  });
}

function sendJSON(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function isAdmin(req, body) {
  const headerKey = req.headers['x-admin-key'];
  const key = headerKey || (body && body.key);
  return key && key === ADMIN_KEY;
}

// ====== Update tier user di BlockHost (file data/users.json yang sama dipakai panel) ======
function activateTierForUser(email, tier, price) {
  const users = loadJSON(BLOCKHOST_USERS_PATH, null);
  if (!users) {
    return { ok: false, error: 'Tidak menemukan blockhost/data/users.json. Pastikan folder BlockHost ada di ../blockhost dan panel pernah dijalankan minimal sekali (supaya file itu terbuat).' };
  }
  const user = users[email];
  if (!user) {
    return { ok: false, error: `Akun dengan email ${email} tidak ditemukan di BlockHost. User harus daftar/login di panel dulu sebelum bisa dikonfirmasi.` };
  }
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 hari dari sekarang
  user.tier = tier;
  user.tierExpiry = expiry;
  user.transactions = user.transactions || [];
  user.transactions.unshift({
    invoiceId: 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    tier,
    price,
    date: Date.now(),
    confirmedVia: 'payment-confirm',
  });
  saveJSON(BLOCKHOST_USERS_PATH, users);
  return { ok: true, tierExpiry: expiry };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  // ---- Info pembayaran (ditampilkan di form user) ----
  if (p === '/api/payment/info' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, info: PAYMENT_INFO });
  }

  // ---- User: ajukan konfirmasi pembayaran ----
  if (p === '/api/payment/submit' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const tier = String(body.tier || '').trim();
      const price = String(body.price || '').trim();
      const reference = String(body.reference || '').trim();
      const note = String(body.note || '').trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJSON(res, 200, { ok: false, error: 'Email tidak valid. Gunakan email yang sama dengan akun BlockHost kamu.' });
      }
      if (!name) return sendJSON(res, 200, { ok: false, error: 'Nama wajib diisi.' });
      if (!tier) return sendJSON(res, 200, { ok: false, error: 'Pilih paket dulu.' });
      if (!reference) return sendJSON(res, 200, { ok: false, error: 'Isi kode referensi/berita transfer supaya mudah dicek admin.' });

      const entry = {
        id: 'pay_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        email, name, tier, price, reference, note,
        status: 'pending', // pending | confirmed | rejected
        createdAt: Date.now(),
        decidedAt: null,
      };
      payments.unshift(entry);
      savePayments();
      return sendJSON(res, 200, { ok: true, payment: entry });
    });
  }

  // ---- User: cek status pengajuan sendiri (by email) ----
  if (p === '/api/payment/status' && req.method === 'GET') {
    const email = String(u.searchParams.get('email') || '').trim().toLowerCase();
    if (!email) return sendJSON(res, 200, { ok: false, error: 'Email wajib diisi.' });
    const mine = payments.filter((x) => x.email === email).slice(0, 10);
    return sendJSON(res, 200, { ok: true, payments: mine });
  }

  // ---- Admin: login (cuma cek password, tidak ada sesi rumit) ----
  if (p === '/api/payment/admin/login' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      if (!body.key || body.key !== ADMIN_KEY) {
        return sendJSON(res, 200, { ok: false, error: 'Password admin salah.' });
      }
      return sendJSON(res, 200, { ok: true });
    });
  }

  // ---- Admin: lihat semua pengajuan ----
  if (p === '/api/payment/admin/list' && req.method === 'GET') {
    if (!isAdmin(req, {})) return sendJSON(res, 401, { ok: false, error: 'Tidak diizinkan.' });
    return sendJSON(res, 200, { ok: true, payments });
  }

  // ---- Admin: konfirmasi pembayaran ----
  if (p === '/api/payment/admin/confirm' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      if (!isAdmin(req, body)) return sendJSON(res, 401, { ok: false, error: 'Tidak diizinkan.' });
      const entry = payments.find((x) => x.id === body.id);
      if (!entry) return sendJSON(res, 200, { ok: false, error: 'Pengajuan tidak ditemukan.' });
      if (entry.status !== 'pending') {
        return sendJSON(res, 200, { ok: false, error: `Pengajuan ini sudah berstatus "${entry.status}".` });
      }
      const result = activateTierForUser(entry.email, entry.tier, entry.price);
      if (!result.ok) return sendJSON(res, 200, result);
      entry.status = 'confirmed';
      entry.decidedAt = Date.now();
      savePayments();
      return sendJSON(res, 200, { ok: true, payment: entry });
    });
  }

  // ---- Admin: tolak pembayaran ----
  if (p === '/api/payment/admin/reject' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { ok: false, error: 'Body tidak valid.' });
      if (!isAdmin(req, body)) return sendJSON(res, 401, { ok: false, error: 'Tidak diizinkan.' });
      const entry = payments.find((x) => x.id === body.id);
      if (!entry) return sendJSON(res, 200, { ok: false, error: 'Pengajuan tidak ditemukan.' });
      if (entry.status !== 'pending') {
        return sendJSON(res, 200, { ok: false, error: `Pengajuan ini sudah berstatus "${entry.status}".` });
      }
      entry.status = 'rejected';
      entry.decidedAt = Date.now();
      entry.rejectReason = String(body.reason || '').trim();
      savePayments();
      return sendJSON(res, 200, { ok: true, payment: entry });
    });
  }

  // ---- STATIC FILES ----
  let filePath = p === '/' ? '/index.html' : p;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`payment-confirm jalan di http://0.0.0.0:${PORT}`);
  console.log('Form user   : http://localhost:' + PORT);
  console.log('Panel admin : http://localhost:' + PORT + '/admin.html');
  if (ADMIN_KEY === 'ganti-password-admin-ini') {
    console.log('\n⚠️  PERINGATAN: kamu belum ganti ADMIN_KEY dari nilai default! Edit server.js atau set env ADMIN_KEY sebelum dipakai sungguhan.\n');
  }
});
