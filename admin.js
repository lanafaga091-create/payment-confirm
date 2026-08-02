let adminKey = '';

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString('id-ID') : '-';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
const loginCard = document.getElementById('loginCard');
const listCard = document.getElementById('listCard');
const list = document.getElementById('list');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = new FormData(loginForm).get('key');
  loginMsg.textContent = 'Memeriksa...';
  loginMsg.className = 'msg';
  const data = await api('/api/payment/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (data.ok) {
    adminKey = key;
    loginCard.classList.add('hidden');
    listCard.classList.remove('hidden');
    loadList();
  } else {
    loginMsg.textContent = data.error || 'Password salah.';
    loginMsg.className = 'msg err';
  }
});

document.getElementById('refreshBtn').addEventListener('click', loadList);

async function loadList() {
  list.innerHTML = 'Memuat...';
  const data = await api('/api/payment/admin/list', {
    headers: { 'X-Admin-Key': adminKey },
  });
  if (!data.ok) {
    list.innerHTML = `<p class="msg err">${data.error || 'Gagal memuat.'}</p>`;
    return;
  }
  if (data.payments.length === 0) {
    list.innerHTML = '<p class="msg">Belum ada pengajuan.</p>';
    return;
  }
  list.innerHTML = data.payments.map((p) => `
    <div class="pay-item">
      <div class="row"><span>Jenis</span><span>${p.type === 'vip' ? 'VIP Server' : 'Paket Hosting'}</span></div>
      <div class="row"><span>Nama</span><span>${escapeHtml(p.name)}</span></div>
      <div class="row"><span>Email</span><span>${escapeHtml(p.email)}</span></div>
      ${p.type === 'vip' ? `<div class="row"><span>Akun Minecraft</span><span>${escapeHtml(p.player) || '-'}</span></div>` : ''}
      <div class="row"><span>${p.type === 'vip' ? 'Tier VIP' : 'Paket'}</span><span>${escapeHtml(p.tier)} (${escapeHtml(p.price)})</span></div>
      <div class="row"><span>Referensi</span><span>${escapeHtml(p.reference)}</span></div>
      <div class="row"><span>Catatan</span><span>${escapeHtml(p.note) || '-'}</span></div>
      <div class="row"><span>Diajukan</span><span>${fmtDate(p.createdAt)}</span></div>
      <div class="row"><span>Status</span><span class="status-${p.status}">${escapeHtml(p.status)}</span></div>
      ${p.status === 'pending' ? `
        <div class="pay-actions">
          <button class="secondary" data-action="confirm" data-id="${p.id}">Konfirmasi</button>
          <button class="danger" data-action="reject" data-id="${p.id}">Tolak</button>
        </div>
      ` : ''}
    </div>
  `).join('');

  list.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleDecision(btn.dataset.id, btn.dataset.action));
  });
}

async function handleDecision(id, action) {
  let reason = '';
  if (action === 'reject') {
    reason = prompt('Alasan penolakan (opsional):') || '';
  } else {
    if (!confirm('Aktifkan pembelian ini untuk user ini sekarang?')) return;
  }
  const data = await api(`/api/payment/admin/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, key: adminKey, reason }),
  });
  if (!data.ok) {
    alert(data.error || 'Gagal memproses.');
    return;
  }
  loadList();
}
