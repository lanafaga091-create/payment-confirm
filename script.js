async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('id-ID');
}

// ---- Muat info pembayaran ----
(async () => {
  const box = document.getElementById('paymentInfo');
  try {
    const data = await api('/api/payment/info');
    if (data.ok) {
      const i = data.info;
      box.innerHTML = `
        <strong>Bank:</strong> ${i.bank}<br>
        <strong>No. Rekening:</strong> ${i.nomorRekening}<br>
        <strong>Atas Nama:</strong> ${i.atasNama}<br>
        <p style="margin:8px 0 0;color:#9aa0aa">${i.catatan}</p>
      `;
    }
  } catch (e) {
    box.textContent = 'Gagal memuat info pembayaran.';
  }
})();

// ---- Submit form konfirmasi ----
const form = document.getElementById('form');
const formMsg = document.getElementById('formMsg');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMsg.textContent = 'Mengirim...';
  formMsg.className = 'msg';
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  try {
    const data = await api('/api/payment/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (data.ok) {
      formMsg.textContent = 'Berhasil dikirim! Tunggu admin konfirmasi, lalu cek statusnya di bawah.';
      formMsg.className = 'msg ok';
      form.reset();
    } else {
      formMsg.textContent = data.error || 'Gagal mengirim.';
      formMsg.className = 'msg err';
    }
  } catch (e) {
    formMsg.textContent = 'Terjadi kesalahan jaringan.';
    formMsg.className = 'msg err';
  }
});

// ---- Cek status ----
const statusForm = document.getElementById('statusForm');
const statusList = document.getElementById('statusList');
statusForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = new FormData(statusForm).get('email');
  statusList.innerHTML = 'Memuat...';
  try {
    const data = await api('/api/payment/status?email=' + encodeURIComponent(email));
    if (!data.ok || data.payments.length === 0) {
      statusList.innerHTML = '<p class="msg">Belum ada pengajuan untuk email ini.</p>';
      return;
    }
    statusList.innerHTML = data.payments.map((p) => `
      <div class="pay-item">
        <div class="row"><span>Paket</span><span>${p.tier} (${p.price})</span></div>
        <div class="row"><span>Referensi</span><span>${p.reference}</span></div>
        <div class="row"><span>Diajukan</span><span>${fmtDate(p.createdAt)}</span></div>
        <div class="row"><span>Status</span><span class="status-${p.status}">${p.status}</span></div>
      </div>
    `).join('');
  } catch (e) {
    statusList.innerHTML = '<p class="msg err">Gagal memuat status.</p>';
  }
});
