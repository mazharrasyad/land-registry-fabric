const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let sertifikat = [];
let rantai = [];
let blokTerpilih = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tanggal = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }) : '-');
const pendek = (h, n = 10) => (h ? `${h.slice(0, n)}…` : '—');
// Warna dari hash, supaya hash suatu blok dan "prev" di blok berikutnya terlihat sama.
const warna = (h) => (h ? `hsl(${parseInt(h.slice(0, 4), 16) % 360} 65% 45%)` : 'var(--garis)');

const NAMA_FUNGSI = {
    InitLedger: 'Data awal',
    TerbitkanSertifikat: 'Terbitkan sertifikat',
    AjukanBalikNama: 'Ajukan balik nama',
    SahkanBalikNama: 'Sahkan balik nama',
    TolakBalikNama: 'Tolak balik nama',
    BlokirSertifikat: 'Blokir sertifikat',
    BukaBlokir: 'Buka blokir',
    ApproveChaincodeDefinitionForMyOrg: 'Setujui smart contract',
    CommitChaincodeDefinition: 'Pasang smart contract',
};

// URL relatif terhadap halaman, supaya web tetap jalan di subpath (mis. /land-registry-fabric/).
async function api(metode, url, body) {
    const res = await fetch(url.replace(/^\//, ''), {
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
    li.innerHTML = `<div class="judul">${ok ? '✓' : '✗'} ${esc(judul)}</div><div>${pesan}</div>
        <div class="waktu">${new Date().toLocaleTimeString('id-ID')}</div>`;
    $('#log').prepend(li);
}

const chipBlok = (n) => `<button type="button" class="chip-blok" data-blok="${n}">Blok #${n}</button>`;

// Kirim transaksi, catat nomor bloknya, lalu segarkan data.
async function transaksi(judul, metode, url, body) {
    try {
        const hasil = await api(metode, url, body);
        catat(judul, true, `${esc(hasil.data?.aksiTerakhir || 'Berhasil')}<br>Tercatat di ${chipBlok(hasil.blok)}`);
        await Promise.all([muatSertifikat(), muatRantai()]);
        return hasil;
    } catch (err) {
        catat(judul, false, esc(err.message));
        return null;
    }
}

// ---------- Gambar sertifikat ----------

function sketsaBidang(luas) {
    // Bidang dianggap persegi panjang 3:2 agar ukuran sisi terlihat wajar.
    const lebar = Math.sqrt(luas * 1.5);
    const tinggi = luas / lebar;
    return `<svg viewBox="0 0 160 120" class="sketsa" role="img" aria-label="Sketsa bidang tanah">
        <rect x="25" y="20" width="110" height="74" fill="var(--utama-muda)" stroke="var(--utama)" stroke-width="2" stroke-dasharray="5 3"/>
        <text x="80" y="62" text-anchor="middle" font-size="13" font-weight="600" fill="var(--utama)">${esc(luas)} m²</text>
        <text x="80" y="110" text-anchor="middle" font-size="10" fill="var(--redup)">± ${lebar.toFixed(1)} m</text>
        <text x="14" y="57" text-anchor="middle" font-size="10" fill="var(--redup)" transform="rotate(-90 14 57)">± ${tinggi.toFixed(1)} m</text>
        <text x="150" y="16" text-anchor="middle" font-size="11" fill="var(--redup)">U ↑</text>
    </svg>`;
}

function linkVerifikasi(nomor) {
    return `${location.origin}${location.pathname}?cek=${encodeURIComponent(nomor)}`;
}

function gambarSertifikat(s, blok) {
    const id = `qr-${Math.random().toString(36).slice(2)}`;
    const html = `<div class="sertifikat-dok">
        <div class="watermark">PROTOTYPE</div>
        <div class="dok-kepala">
          <div class="lambang">⛰</div>
          <div>
            <div class="dok-instansi">Badan Pertanahan (Simulasi)</div>
            <div class="dok-judul">SERTIFIKAT HAK MILIK</div>
            <div class="dok-nomor">No. ${esc(s.nomor)}</div>
          </div>
          <span class="status ${esc(s.status)}">${esc(s.status.replace(/_/g, ' '))}</span>
        </div>
        <div class="dok-isi">
          <dl>
            <dt>Nama pemegang hak</dt><dd><b>${esc(s.pemilik.nama)}</b></dd>
            <dt>NIK</dt><dd>${esc(s.pemilik.nik)}</dd>
            <dt>NIB</dt><dd>${esc(s.nib)}</dd>
            <dt>Letak tanah</dt><dd>${esc(s.lokasi)}</dd>
            <dt>Luas</dt><dd>${esc(s.luasM2)} m²</dd>
            <dt>Diterbitkan</dt><dd>${tanggal(s.diterbitkanPada)}</dd>
            ${s.pengajuan ? `<dt>Dalam proses</dt><dd>Balik nama ke ${esc(s.pengajuan.pembeli.nama)} (akta ${esc(s.pengajuan.nomorAkta)})</dd>` : ''}
          </dl>
          <div class="dok-gambar">${sketsaBidang(s.luasM2)}</div>
        </div>
        <div class="dok-kaki">
          <div id="${id}" class="qr"></div>
          <div>
            <div><b>Terverifikasi di blockchain Hyperledger Fabric</b></div>
            <div class="catatan">Pindai QR untuk mengecek keaslian dan riwayat sertifikat ini.
              ${blok !== undefined ? `<br>Transaksi terakhir tercatat di ${chipBlok(blok)}` : ''}</div>
            <div class="catatan kecil-teks">Bukan dokumen resmi — hanya untuk demonstrasi.</div>
          </div>
        </div>
      </div>`;
    // QR digambar setelah elemen masuk ke DOM.
    setTimeout(() => {
        const el = document.getElementById(id);
        if (el && window.QRCode) new QRCode(el, { text: linkVerifikasi(s.nomor), width: 84, height: 84 });
    });
    return html;
}

// ---------- Sertifikat ----------

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
        <thead><tr><th>Nomor</th><th>Lokasi</th><th>Pemilik</th><th>Status</th><th></th></tr></thead>
        <tbody>${sertifikat.map((s) => `<tr>
            <td><b>${esc(s.nomor)}</b><br><small>NIB ${esc(s.nib)}</small></td>
            <td>${esc(s.lokasi)}<br><small>${esc(s.luasM2)} m²</small></td>
            <td>${esc(s.pemilik.nama)}</td>
            <td><span class="status ${esc(s.status)}">${esc(s.status.replace(/_/g, ' '))}</span></td>
            <td><button class="sekunder kecil" data-lihat="${esc(s.nomor)}">Lihat</button></td>
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
    const terakhir = riwayat[riwayat.length - 1];
    $('#hasil-cek').innerHTML = `${gambarSertifikat(s, terakhir?.blok)}
        <h3 class="sub">Riwayat sertifikat di blockchain</h3>
        <p class="catatan">Setiap perubahan adalah transaksi baru di blok baru. Data lama tidak pernah ditimpa.</p>
        <ol class="timeline">${riwayat.map((r, i) => `<li>
            <div class="tl-blok">${chipBlok(r.blok)}</div>
            <div class="tl-isi">
              <div><b>${esc(r.aksi)}</b></div>
              <div class="meta">${tanggal(r.waktu)} · oleh <b>${esc(r.oleh)}</b> · pemilik: ${esc(r.data.pemilik.nama)}
                · status: ${esc(r.data.status)}</div>
              <code>tx ${esc(pendek(r.txId, 24))}</code>
            </div>
            ${i < riwayat.length - 1 ? '<div class="tl-panah">↓</div>' : ''}
          </li>`).join('')}</ol>`;
}

async function cekSertifikat(jenis, kunci) {
    const url = jenis === 'nib' ? `/api/bidang/${encodeURIComponent(kunci)}` : `/api/sertifikat/${encodeURIComponent(kunci)}`;
    try {
        await tampilkanSertifikat(await api('GET', url));
    } catch (err) {
        $('#hasil-cek').innerHTML = `<div class="kartu"><span class="status DIBLOKIR">TIDAK DITEMUKAN</span> ${esc(err.message)}</div>`;
    }
}

function lihatSertifikat(nomor) {
    bukaTab('cek');
    $('#form-cek [name=jenis]').value = 'nomor';
    $('#form-cek [name=kunci]').value = nomor;
    cekSertifikat('nomor', nomor);
}

// ---------- Blockchain ----------

function ringkasBlok(b) {
    if (b.transaksi.every((t) => t.tipe === 'KONFIGURASI')) {
        return b.nomor === 0 ? 'Blok genesis (pembuatan channel)' : 'Konfigurasi channel';
    }
    return b.transaksi.map((t) => NAMA_FUNGSI[t.fungsi] || t.fungsi || t.tipe).join(', ');
}

async function muatRantai(sampai) {
    try {
        const q = sampai !== undefined ? `?sampai=${sampai}&jumlah=8` : '?jumlah=8';
        const hasil = await api('GET', `/api/blockchain${q}`);
        $('#info-rantai').textContent = `Channel: mychannel · Tinggi rantai: ${hasil.tinggi} blok`;
        rantai = hasil.blok.slice().reverse();
        renderRantai();
        if (blokTerpilih === null || !rantai.some((b) => b.nomor === blokTerpilih)) {
            pilihBlok(rantai[rantai.length - 1]?.nomor);
        } else {
            pilihBlok(blokTerpilih);
        }
    } catch (err) {
        $('#rantai').innerHTML = `<div class="kosong">Gagal memuat blok: ${esc(err.message)}</div>`;
    }
}

function renderRantai() {
    $('#btn-blok-lama').disabled = !rantai.length || rantai[0].nomor === 0;
    $('#rantai').innerHTML = rantai.map((b, i) => {
        const sebelum = rantai[i - 1];
        const tersambung = sebelum ? sebelum.hash === b.previousHash : null;
        return `${i > 0 ? `<div class="sambungan ${tersambung ? '' : 'putus'}" title="${tersambung ? 'prev = hash blok sebelumnya' : 'tidak tersambung'}">→</div>` : ''}
        <button type="button" class="blok ${b.nomor === blokTerpilih ? 'terpilih' : ''}" data-pilih-blok="${b.nomor}">
          <div class="blok-nomor">Blok #${b.nomor}</div>
          <div class="blok-ringkas">${esc(ringkasBlok(b))}</div>
          <div class="blok-hash"><span class="titik" style="background:${warna(b.previousHash)}"></span>prev ${esc(pendek(b.previousHash, 8))}</div>
          <div class="blok-hash"><span class="titik" style="background:${warna(b.hash)}"></span>hash ${esc(pendek(b.hash, 8))}</div>
          <div class="blok-tx">${b.transaksi.length} transaksi</div>
        </button>`;
    }).join('');
    const el = $('#rantai');
    el.scrollLeft = el.scrollWidth;
}

function pilihBlok(nomor) {
    const b = rantai.find((x) => x.nomor === nomor);
    if (!b) return;
    blokTerpilih = nomor;
    $$('.blok').forEach((el) => el.classList.toggle('terpilih', Number(el.dataset.pilihBlok) === nomor));
    $('#detail-blok').innerHTML = `<div class="kartu">
        <h3>Isi Blok #${b.nomor}</h3>
        <dl class="hash-list">
          <dt>Hash blok ini</dt><dd><span class="titik" style="background:${warna(b.hash)}"></span><code>${esc(b.hash)}</code></dd>
          <dt>Hash blok sebelumnya</dt><dd><span class="titik" style="background:${warna(b.previousHash)}"></span><code>${esc(b.previousHash || '— (blok pertama)')}</code></dd>
          <dt>Hash data transaksi</dt><dd><code>${esc(b.dataHash)}</code></dd>
        </dl>
        ${b.transaksi.map((t) => `<div class="tx">
          <div class="tx-kepala">
            <b>${esc(NAMA_FUNGSI[t.fungsi] || t.fungsi || t.tipe)}</b>
            <span class="status ${t.valid ? 'AKTIF' : 'DIBLOKIR'}">${t.valid ? 'VALID' : 'TIDAK VALID'}</span>
          </div>
          <div class="meta">${tanggal(t.waktu)} · dikirim oleh <b>${esc(t.pengirim)}</b>
            ${t.chaincode ? ` · chaincode <code>${esc(t.chaincode)}</code>` : ''}</div>
          ${t.fungsi ? `<div class="meta">Fungsi <code>${esc(t.fungsi)}</code>${t.args.length ? `(${t.args.map((a) => `<code>${esc(a)}</code>`).join(', ')})` : '()'}</div>` : ''}
          <div class="meta">tx <code>${esc(t.txId)}</code></div>
        </div>`).join('')}
      </div>`;
}

async function bukaBlok(nomor) {
    bukaTab('blockchain');
    blokTerpilih = nomor;
    await muatRantai(nomor + 3);
}

// ---------- Navigasi & event ----------

const dataForm = (form) => Object.fromEntries(new FormData(form));

function bukaTab(nama) {
    $$('.tab').forEach((t) => t.classList.toggle('aktif', t.dataset.tab === nama));
    $$('[id^="tab-"]').forEach((p) => p.classList.toggle('tersembunyi', p.id !== `tab-${nama}`));
}

$$('.tab').forEach((t) => t.addEventListener('click', () => bukaTab(t.dataset.tab)));
$('#btn-muat').addEventListener('click', muatSertifikat);
$('#btn-muat-blok').addEventListener('click', () => muatRantai());
$('#btn-blok-lama').addEventListener('click', () => muatRantai(Math.max(rantai[0].nomor - 1, 0)));

$('#form-cek').addEventListener('submit', (e) => {
    e.preventDefault();
    const { jenis, kunci } = dataForm(e.target);
    cekSertifikat(jenis, kunci);
});

$('#form-terbitkan').addEventListener('submit', async (e) => {
    e.preventDefault();
    const hasil = await transaksi('BPN menerbitkan sertifikat', 'POST', '/api/bpn/terbitkan', dataForm(e.target));
    if (hasil) {
        $('#hasil-terbit').innerHTML = `<h3 class="sub">Sertifikat berhasil diterbitkan</h3>${gambarSertifikat(hasil.data, hasil.blok)}`;
    }
});

$('#form-ajukan').addEventListener('submit', (e) => {
    e.preventDefault();
    transaksi('PPAT mengajukan balik nama', 'POST', '/api/ppat/ajukan-balik-nama', dataForm(e.target));
});

document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.sahkan) {
        transaksi('BPN mengesahkan balik nama', 'POST', `/api/bpn/sahkan/${encodeURIComponent(t.dataset.sahkan)}`);
    } else if (t.dataset.tolak) {
        const alasan = prompt('Alasan penolakan:', 'Berkas akta tidak lengkap');
        if (alasan) transaksi('BPN menolak balik nama', 'POST', `/api/bpn/tolak/${encodeURIComponent(t.dataset.tolak)}`, { alasan });
    } else if (t.dataset.lihat) {
        lihatSertifikat(t.dataset.lihat);
    } else if (t.dataset.blok) {
        bukaBlok(Number(t.dataset.blok));
    } else if (t.dataset.pilihBlok) {
        pilihBlok(Number(t.dataset.pilihBlok));
    }
});

muatSertifikat();
muatRantai();

// Tautan dari QR: ?cek=NOMOR langsung membuka sertifikat tersebut.
const cekAwal = new URLSearchParams(location.search).get('cek');
if (cekAwal) lihatSertifikat(cekAwal);
