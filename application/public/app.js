const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let sertifikat = [];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tanggal = (iso) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');

async function api(metode, url, body) {
    const res = await fetch(url, {
        method: metode,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.pesan);
    return json.data;
}

function catat(judul, ok, pesan) {
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'gagal';
    li.innerHTML = `<div class="judul">${ok ? '✓' : '✗'} ${esc(judul)}</div><div>${esc(pesan)}</div>
        <div class="waktu">${new Date().toLocaleTimeString('id-ID')}</div>`;
    $('#log').prepend(li);
}

// Kirim transaksi, catat hasilnya di log, lalu segarkan tabel.
async function transaksi(judul, metode, url, body) {
    try {
        const hasil = await api(metode, url, body);
        catat(judul, true, hasil?.aksiTerakhir || 'Berhasil');
        await muatSertifikat();
        return hasil;
    } catch (err) {
        catat(judul, false, err.message);
        return null;
    }
}

async function muatSertifikat() {
    try {
        sertifikat = await api('GET', '/api/sertifikat');
    } catch (err) {
        $('#tabel-sertifikat').className = 'kosong';
        $('#tabel-sertifikat').textContent = `Gagal memuat ledger: ${err.message}`;
        return;
    }
    renderTabel();
    renderPilihan();
    renderPengajuan();
}

function renderTabel() {
    const el = $('#tabel-sertifikat');
    if (!sertifikat.length) {
        el.className = 'kosong';
        el.textContent = 'Ledger masih kosong.';
        return;
    }
    el.className = 'tabel-scroll';
    el.innerHTML = `<table>
        <thead><tr><th>Nomor</th><th>NIB</th><th>Lokasi</th><th>Pemilik</th><th>Status</th><th></th></tr></thead>
        <tbody>${sertifikat.map((s) => `<tr>
            <td><b>${esc(s.nomor)}</b></td>
            <td>${esc(s.nib)}</td>
            <td>${esc(s.lokasi)}<br><small>${esc(s.luasM2)} m²</small></td>
            <td>${esc(s.pemilik.nama)}<br><small>${esc(s.pemilik.nik)}</small></td>
            <td><span class="status ${esc(s.status)}">${esc(s.status)}</span></td>
            <td><button class="sekunder kecil" data-lihat="${esc(s.nomor)}">Riwayat</button></td>
        </tr>`).join('')}</tbody></table>`;
}

function renderPilihan() {
    for (const sel of $$('.pilih-sertifikat')) {
        const sebelumnya = sel.value;
        sel.innerHTML = sertifikat.map((s) =>
            `<option value="${esc(s.nomor)}">${esc(s.nomor)} — ${esc(s.pemilik.nama)} (${esc(s.status)})</option>`).join('');
        if (sertifikat.some((s) => s.nomor === sebelumnya)) sel.value = sebelumnya;
    }
}

function renderPengajuan() {
    const daftar = sertifikat.filter((s) => s.status === 'PROSES_BALIK_NAMA' && s.pengajuan);
    const el = $('#daftar-pengajuan');
    if (!daftar.length) {
        el.className = 'kosong';
        el.textContent = 'Belum ada pengajuan.';
        return;
    }
    el.className = '';
    el.innerHTML = daftar.map((s) => `<div class="pengajuan">
        <div><b>${esc(s.nomor)}</b> · Akta ${esc(s.pengajuan.nomorAkta)}<br>
          ${esc(s.pemilik.nama)} → <b>${esc(s.pengajuan.pembeli.nama)}</b> (${esc(s.pengajuan.pembeli.nik)})</div>
        <div class="aksi">
          <button data-sahkan="${esc(s.nomor)}">Sahkan</button>
          <button class="sekunder" data-tolak="${esc(s.nomor)}">Tolak</button>
        </div></div>`).join('');
}

async function tampilkanSertifikat(s) {
    const riwayat = await api('GET', `/api/sertifikat/${encodeURIComponent(s.nomor)}/riwayat`);
    $('#hasil-cek').innerHTML = `<div class="kartu">
        <dl>
          <dt>Nomor</dt><dd><b>${esc(s.nomor)}</b></dd>
          <dt>Status</dt><dd><span class="status ${esc(s.status)}">${esc(s.status)}</span>
            ${s.alasanBlokir ? ` — ${esc(s.alasanBlokir)}` : ''}</dd>
          <dt>Pemilik sah</dt><dd>${esc(s.pemilik.nama)} (NIK ${esc(s.pemilik.nik)})</dd>
          <dt>NIB</dt><dd>${esc(s.nib)}</dd>
          <dt>Lokasi</dt><dd>${esc(s.lokasi)} · ${esc(s.luasM2)} m²</dd>
          <dt>Diterbitkan</dt><dd>${tanggal(s.diterbitkanPada)}</dd>
        </dl>
        <h3>Riwayat di ledger (tidak bisa diubah)</h3>
        <ol class="timeline">${riwayat.map((r) => `<li>
            <div><b>${esc(r.aksi)}</b></div>
            <div class="meta">${tanggal(r.waktu)} · oleh ${esc(r.oleh)}</div>
            <code>tx ${esc(r.txId)}</code></li>`).join('')}</ol></div>`;
}

const dataForm = (form) => Object.fromEntries(new FormData(form));

function bukaTab(nama) {
    $$('.tab').forEach((t) => t.classList.toggle('aktif', t.dataset.tab === nama));
    $$('[id^="tab-"]').forEach((p) => p.classList.toggle('tersembunyi', p.id !== `tab-${nama}`));
}

$$('.tab').forEach((t) => t.addEventListener('click', () => bukaTab(t.dataset.tab)));
$('#btn-muat').addEventListener('click', muatSertifikat);

$('#form-cek').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { jenis, kunci } = dataForm(e.target);
    const url = jenis === 'nib' ? `/api/bidang/${encodeURIComponent(kunci)}` : `/api/sertifikat/${encodeURIComponent(kunci)}`;
    try {
        await tampilkanSertifikat(await api('GET', url));
    } catch (err) {
        $('#hasil-cek').innerHTML = `<div class="kartu"><span class="status DIBLOKIR">TIDAK DITEMUKAN</span> ${esc(err.message)}</div>`;
    }
});

$('#form-terbitkan').addEventListener('submit', (e) => {
    e.preventDefault();
    transaksi('BPN menerbitkan sertifikat', 'POST', '/api/bpn/terbitkan', dataForm(e.target));
});

$('#form-ajukan').addEventListener('submit', (e) => {
    e.preventDefault();
    transaksi('PPAT mengajukan balik nama', 'POST', '/api/ppat/ajukan-balik-nama', dataForm(e.target));
});

$('#form-blokir').addEventListener('submit', (e) => {
    e.preventDefault();
    const { nomor, alasan } = dataForm(e.target);
    transaksi('BPN memblokir sertifikat', 'POST', `/api/bpn/blokir/${encodeURIComponent(nomor)}`, { alasan });
});

$('#btn-buka-blokir').addEventListener('click', () => {
    const nomor = $('#form-blokir [name=nomor]').value;
    transaksi('BPN membuka blokir', 'POST', `/api/bpn/buka-blokir/${encodeURIComponent(nomor)}`);
});

document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.sahkan) {
        transaksi('BPN mengesahkan balik nama', 'POST', `/api/bpn/sahkan/${encodeURIComponent(t.dataset.sahkan)}`);
    } else if (t.dataset.tolak) {
        const alasan = prompt('Alasan penolakan:', 'Berkas akta tidak lengkap');
        if (alasan) transaksi('BPN menolak balik nama', 'POST', `/api/bpn/tolak/${encodeURIComponent(t.dataset.tolak)}`, { alasan });
    } else if (t.dataset.lihat) {
        bukaTab('publik');
        $('#form-cek [name=jenis]').value = 'nomor';
        $('#form-cek [name=kunci]').value = t.dataset.lihat;
        $('#form-cek').requestSubmit();
    } else if (t.dataset.serangan) {
        jalankanSerangan(t.dataset.serangan);
    }
});

function jalankanSerangan(jenis) {
    const target = sertifikat.find((s) => s.nomor === $('#sim-nomor').value);
    if (!target) return catat('Simulasi', false, 'Pilih sertifikat target terlebih dahulu');
    const nomor = encodeURIComponent(target.nomor);
    const serangan = {
        ganda: () => transaksi('Serangan: sertifikat ganda', 'POST', '/api/bpn/terbitkan', {
            nomor: `SHM-PALSU-${Date.now() % 100000}`, nib: target.nib, lokasi: target.lokasi,
            luasM2: target.luasM2, nikPemilik: '3201999999990001', namaPemilik: 'Oknum Mafia Tanah',
        }),
        'bukan-pemilik': () => transaksi('Serangan: jual tanah bukan miliknya', 'POST', '/api/ppat/ajukan-balik-nama', {
            nomor: target.nomor, nikPenjual: $('#sim-nik').value, nikPembeli: '3201888888880002',
            namaPembeli: 'Pembeli Kedua', nomorAkta: 'AJB-PALSU/2026',
        }),
        'ppat-sahkan': () => transaksi('Serangan: PPAT mengesahkan sendiri', 'POST', `/api/ppat/sahkan/${nomor}`),
        diblokir: () => (target.status !== 'DIBLOKIR'
            ? catat('Simulasi', false, `Blokir dulu ${target.nomor} di tab BPN, lalu ulangi serangan ini`)
            : transaksi('Serangan: jual tanah diblokir', 'POST', '/api/ppat/ajukan-balik-nama', {
            nomor: target.nomor, nikPenjual: target.pemilik.nik, nikPembeli: '3201888888880002',
            namaPembeli: 'Pembeli Kedua', nomorAkta: 'AJB-SENGKETA/2026',
        })),
    };
    serangan[jenis]();
}

muatSertifikat();
