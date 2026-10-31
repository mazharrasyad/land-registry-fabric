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
    if (!json.ok) throw Object.assign(new Error(json.pesan), { pemungutan: json.pemungutan });
    return json.data;
}

const LABEL_SUARA = { SETUJU: 'Setuju', TOLAK: 'Tolak', TIDAK_HADIR: 'Tidak hadir' };
const IKON_SUARA = { SETUJU: '✓', TOLAK: '✗', TIDAK_HADIR: '–' };
const stripSuara = (suara) => `<div class="suara-strip">${suara.map((s) => `<span class="suara ${s.suara}"
    title="${esc(s.alasan || LABEL_SUARA[s.suara])}">${IKON_SUARA[s.suara]} ${esc(s.node)}</span>`).join('')}</div>`;
const jumlahSetuju = (suara) => suara.filter((s) => s.suara === 'SETUJU').length;

const chipBlok = (n) => `<button type="button" class="chip-blok" data-blok="${n}">Blok #${n}</button>`;

// ---------- Aktivitas ----------
// Diambil dari transaksi di ledger, jadi sama untuk semua pengunjung.
// Transaksi yang ditolak tidak pernah masuk blok, jadi hanya disimpan lokal di browser ini.
let aktivitas = [];
const galat = [];

function uraikan(tx) {
    const a = tx.args;
    switch (tx.fungsi) {
        case 'InitLedger': return ['Data awal dimuat', 'Sertifikat contoh dimasukkan ke ledger'];
        case 'TerbitkanSertifikat': return ['Sertifikat diterbitkan', `${a[0]} atas nama ${a[5]} · ${a[3]} m²`];
        case 'AjukanBalikNama': return ['Balik nama diajukan', `${a[0]} → ${a[3]} (akta ${a[4]})`];
        case 'SahkanBalikNama': return ['Balik nama disahkan', a[0]];
        case 'TolakBalikNama': return ['Balik nama ditolak', `${a[0]}: ${a[1]}`];
        case 'BlokirSertifikat': return ['Sertifikat diblokir', `${a[0]}: ${a[1]}`];
        case 'BukaBlokir': return ['Blokir dibuka', a[0]];
        default: return [tx.fungsi, a.join(', ')];
    }
}

function renderAktivitas() {
    const item = [
        ...galat.map((g) => ({ ...g, gagal: true })),
        ...aktivitas,
    ].sort((x, y) => (y.waktu || '').localeCompare(x.waktu || ''));
    if (!item.length) {
        $('#log').innerHTML = '<li class="kosong">Belum ada transaksi.</li>';
        return;
    }
    $('#log').innerHTML = item.map((t) => {
        if (t.gagal) {
            return `<li class="gagal"><div class="judul">✗ ${esc(t.judul)}</div><div>${esc(t.pesan)}</div>
                <div class="waktu">${tanggal(t.waktu)} · ditolak, tidak masuk blok</div></li>`;
        }
        const [judul, rincian] = uraikan(t);
        // Data awal dikirim script deploy test-network (identitas admin Org2), bukan oleh petugas PPAT.
        const oleh = t.fungsi === 'InitLedger' ? 'script deploy' : t.pengirim;
        return `<li class="ok"><div class="judul">✓ ${esc(judul)}</div><div>${esc(rincian)}</div>
            <div class="waktu">${tanggal(t.waktu)} · oleh <b>${esc(oleh)}</b> · ${chipBlok(t.blok)}</div></li>`;
    }).join('');
}

async function muatAktivitas() {
    try {
        aktivitas = await api('GET', '/api/aktivitas');
    } catch (err) {
        aktivitas = [];
    }
    renderAktivitas();
}

// ---------- Indikator proses & notifikasi ----------

// Kunci tombol selama proses dan tampilkan spinner, lalu kembalikan seperti semula.
async function denganLoading(tombol, teks, fn) {
    if (!tombol) return fn();
    const asli = tombol.innerHTML;
    tombol.disabled = true;
    tombol.classList.add('memuat');
    tombol.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(teks)}`;
    try {
        return await fn();
    } finally {
        if (tombol.isConnected) {
            tombol.disabled = false;
            tombol.classList.remove('memuat');
            tombol.innerHTML = asli;
        }
    }
}

const IKON = { proses: '<span class="spinner" aria-hidden="true"></span>', ok: '✓', gagal: '✗' };

function isiToast(el, jenis, judul, pesan) {
    el.className = `toast ${jenis}`;
    el.setAttribute('role', jenis === 'gagal' ? 'alert' : 'status');
    el.innerHTML = `<div class="toast-ikon">${IKON[jenis]}</div>
        <div class="toast-isi"><div class="toast-judul">${esc(judul)}</div><div>${pesan}</div></div>
        <button type="button" class="toast-tutup" aria-label="Tutup">×</button>`;
    clearTimeout(el._timer);
    if (jenis !== 'proses') {
        el._timer = setTimeout(() => el.remove(), jenis === 'ok' ? 7000 : 12000);
    }
}

function toast(jenis, judul, pesan) {
    const el = document.createElement('div');
    isiToast(el, jenis, judul, pesan);
    $('#toast').prepend(el);
    return el;
}

// Kirim transaksi dengan indikator proses, notifikasi hasil, lalu segarkan data.
async function transaksi(judul, metode, url, body, tombol) {
    const info = toast('proses', `${judul}…`,
        'Meminta suara semua node, lalu menunggu transaksi masuk ke blok baru.');
    return denganLoading(tombol, 'Memproses di blockchain…', async () => {
        try {
            const hasil = await api(metode, url, body);
            await Promise.all([muatSertifikat(), muatRantai(), muatAktivitas(), muatNode()]);
            const p = hasil.pemungutan;
            isiToast(info, 'ok', `${judul} berhasil`,
                `${esc(hasil.data?.aksiTerakhir || 'Transaksi tercatat')}<br>
                 Disetujui ${jumlahSetuju(p.suara)} dari ${p.suara.length} node (kuorum ${p.kuorum}) · ${chipBlok(hasil.blok)}
                 ${stripSuara(p.suara)}`);
            return hasil;
        } catch (err) {
            galat.push({ judul, pesan: err.message, waktu: new Date().toISOString() });
            renderAktivitas();
            muatNode();
            isiToast(info, 'gagal', `${judul} gagal`, `${esc(err.message)}<br>Transaksi tidak dicatat ke blockchain.
                ${err.pemungutan ? stripSuara(err.pemungutan.suara) : ''}`);
            return null;
        }
    });
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

// ---------- Status node ----------

const LABEL_NODE = { AKTIF: 'Aktif', LAYANAN_MATI: 'Layanan mati', SERVER_MATI: 'Server mati' };
const LABEL_HASIL = { DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak', GAGAL: 'Gagal' };

function kartuNode(n) {
    let rincian;
    if (n.status !== 'AKTIF') {
        rincian = `<div class="meta">${esc(n.status === 'SERVER_MATI' ? 'Server tidak terjangkau' : n.alasan)}</div>
            <div class="meta">Tidak bisa memberi suara</div>`;
    } else {
        rincian = `<div class="meta">Tinggi ledger: <b>${n.tinggi}</b> blok · ${n.ms} ms</div>
            <div class="meta ${n.sinkron ? '' : 'peringatan'}">${n.sinkron ? '✓ Sinkron' : n.selisih > 0 ? `⚠ Tertinggal ${n.selisih} blok` : '⚠ Hash ledger berbeda'}</div>
            <div class="meta ${n.chaincode ? '' : 'peringatan'}">${n.chaincode ? '✓ Bisa memberi suara' : '⚠ Chaincode mati, tidak bisa memberi suara'}</div>`;
    }
    return `<div class="node-kartu ${n.status}">
        <div class="tx-kepala"><b>${esc(n.id)}</b><span class="status ${n.status === 'AKTIF' ? 'AKTIF' : 'DIBLOKIR'}">${LABEL_NODE[n.status]}</span></div>
        <div class="meta">${esc(n.peran)} · ${esc(n.mspId)} · ${esc(n.ip)}</div>${rincian}</div>`;
}

function renderNode(st) {
    const ringkas = $('#ringkas-node');
    ringkas.className = `status ${st.kuorumTercapai ? 'AKTIF' : 'DIBLOKIR'} dorong-kanan`;
    ringkas.textContent = `${st.aktif}/${st.total} node aktif · ${st.kuorumTercapai ? 'kuorum tercapai' : 'kuorum tidak tercapai'} (butuh ${st.kuorum})`;
    $('#daftar-node').innerHTML = st.nodes.map(kartuNode).join('');
    $('#daftar-orderer').innerHTML = `<span class="catatan">Orderer (Raft):</span> ${st.orderers.map((o) =>
        `<span class="status ${o.aktif ? 'AKTIF' : 'DIBLOKIR'}">${esc(o.id)} · ${esc(o.node)} · ${o.aktif ? 'aktif' : 'mati'}</span>`).join(' ')}`;

    const el = $('#daftar-suara');
    if (!st.pemungutanTerakhir.length) {
        el.className = 'kosong';
        el.textContent = 'Belum ada perubahan data sejak web dinyalakan.';
        return;
    }
    el.className = '';
    el.innerHTML = st.pemungutanTerakhir.map((p) => `<div class="tx">
        <div class="tx-kepala">
          <b>${esc(NAMA_FUNGSI[p.fungsi] || p.fungsi)}</b>
          <span class="status ${p.hasil === 'DISETUJUI' ? 'AKTIF' : 'DIBLOKIR'}">${LABEL_HASIL[p.hasil]} · ${jumlahSetuju(p.suara)}/${p.suara.length} setuju</span>
        </div>
        <div class="meta">${tanggal(p.waktu)} · diajukan ${esc(p.peran.toUpperCase())}${p.blok !== undefined ? ` · ${chipBlok(p.blok)}` : ''}</div>
        ${p.alasan ? `<div class="meta">${esc(p.alasan)}</div>` : ''}
        ${stripSuara(p.suara)}</div>`).join('');
}

async function muatNode() {
    try {
        renderNode(await api('GET', '/api/node'));
    } catch (err) {
        $('#ringkas-node').className = 'status DIBLOKIR dorong-kanan';
        $('#ringkas-node').textContent = 'Status tidak tersedia';
        $('#daftar-node').innerHTML = `<div class="kosong">Gagal memeriksa node: ${esc(err.message)}</div>`;
    }
}

// Pantau selama tab Blockchain terbuka, supaya node yang mati/menyala langsung terlihat.
setInterval(() => {
    if (!document.hidden && !$('#tab-blockchain').classList.contains('tersembunyi')) muatNode();
}, 10000);

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
    geserKeBlokTerpilih();
}

// Geser strip rantai agar blok terpilih terlihat (hanya bisa saat tab sedang tampil).
function geserKeBlokTerpilih() {
    const el = $('#rantai');
    const target = el.querySelector('.blok.terpilih') || el.lastElementChild;
    if (target) el.scrollLeft = target.offsetLeft - el.offsetLeft - (el.clientWidth - target.offsetWidth) / 2;
}

function pilihBlok(nomor) {
    const b = rantai.find((x) => x.nomor === nomor);
    if (!b) return;
    blokTerpilih = nomor;
    $$('.blok').forEach((el) => el.classList.toggle('terpilih', Number(el.dataset.pilihBlok) === nomor));
    geserKeBlokTerpilih();
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
          ${t.penyetuju?.length ? `<div class="meta">Suara setuju di blok ini (${t.penyetuju.length}): ${t.penyetuju.map((n) => `<span class="suara SETUJU">✓ ${esc(n)}</span>`).join(' ')}</div>` : ''}
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
    if (nama === 'blockchain') {
        geserKeBlokTerpilih();
        muatNode();
    }
}

$$('.tab').forEach((t) => t.addEventListener('click', () => bukaTab(t.dataset.tab)));
$('#btn-reset').addEventListener('click', async (e) => {
    const yakin = confirm('Reset blockchain?\n\nSemua sertifikat dan blok akan DIHAPUS permanen, lalu diganti '
        + '2 sertifikat contoh. Proses ±2–3 menit dan web tidak bisa dipakai selama itu.');
    if (!yakin) return;
    try {
        await denganLoading(e.currentTarget, 'Memulai…', () => api('POST', '/api/reset'));
    } catch (err) {
        toast('gagal', 'Reset blockchain gagal dimulai', esc(err.message));
        return;
    }
    pantauReset();
});
$('#btn-blok-lama').addEventListener('click', () => muatRantai(Math.max(rantai[0].nomor - 1, 0)));

$('#form-cek').addEventListener('submit', (e) => {
    e.preventDefault();
    const { jenis, kunci } = dataForm(e.target);
    denganLoading(e.submitter, 'Mencari…', () => cekSertifikat(jenis, kunci));
});

$('#form-terbitkan').addEventListener('submit', async (e) => {
    e.preventDefault();
    const hasil = await transaksi('Penerbitan sertifikat', 'POST', '/api/bpn/terbitkan', dataForm(e.target), e.submitter);
    if (hasil) {
        $('#hasil-terbit').innerHTML = `<h3 class="sub">Sertifikat berhasil diterbitkan</h3>${gambarSertifikat(hasil.data, hasil.blok)}`;
    }
});

$('#form-ajukan').addEventListener('submit', (e) => {
    e.preventDefault();
    transaksi('Pengajuan balik nama', 'POST', '/api/ppat/ajukan-balik-nama', dataForm(e.target), e.submitter);
});

document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.sahkan) {
        transaksi('Pengesahan balik nama', 'POST', `/api/bpn/sahkan/${encodeURIComponent(t.dataset.sahkan)}`, undefined, t);
    } else if (t.dataset.tolak) {
        const alasan = prompt('Alasan penolakan:', 'Berkas akta tidak lengkap');
        if (alasan) transaksi('Penolakan balik nama', 'POST', `/api/bpn/tolak/${encodeURIComponent(t.dataset.tolak)}`, { alasan }, t);
    } else if (t.classList.contains('toast-tutup')) {
        t.closest('.toast').remove();
    } else if (t.dataset.lihat) {
        lihatSertifikat(t.dataset.lihat);
    } else if (t.dataset.blok) {
        bukaBlok(Number(t.dataset.blok));
    } else if (t.dataset.pilihBlok) {
        pilihBlok(Number(t.dataset.pilihBlok));
    }
});

// ---------- Reset blockchain ----------

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

function renderReset(st) {
    const total = st.daftarTahap.length;
    const aktif = st.berjalan ? Math.max(st.tahap, 0) : total;
    const persen = Math.max(3, Math.round((aktif / total) * 100));
    $('#progres-reset').style.width = `${persen}%`;
    $('#persen-reset').textContent = `${persen}%`;
    $('#waktu-reset').textContent = `${Math.max(0, Math.round((Date.now() - new Date(st.mulai)) / 1000))} detik`;
    $('#tahap-reset').innerHTML = st.daftarTahap.map((label, i) => {
        const keadaan = i < aktif ? 'selesai' : i === aktif ? 'aktif' : 'menunggu';
        const ikon = { selesai: '✓', aktif: '<span class="spinner" aria-hidden="true"></span>', menunggu: '' }[keadaan];
        return `<li class="${keadaan}"><span class="tahap-ikon">${ikon}</span>${esc(label)}</li>`;
    }).join('');
}

// Tampilkan progres reset sampai selesai. Dipakai juga oleh pengunjung lain yang membuka web saat reset berjalan.
async function pantauReset() {
    $('#modal-reset').classList.remove('tersembunyi');
    document.body.classList.add('terkunci');
    let st;
    for (;;) {
        try {
            st = await api('GET', '/api/reset/status');
            renderReset(st);
            if (!st.berjalan) break;
        } catch (err) {
            // Server sempat tidak terjangkau; coba lagi.
        }
        await tidur(1000);
    }
    $('#modal-reset').classList.add('tersembunyi');
    document.body.classList.remove('terkunci');

    if (st.berhasil) {
        blokTerpilih = null;
        galat.length = 0;
        $('#hasil-terbit').innerHTML = '';
        $('#hasil-cek').innerHTML = '';
        await Promise.all([muatSertifikat(), muatRantai(), muatAktivitas()]);
        const detik = Math.round((new Date(st.selesai) - new Date(st.mulai)) / 1000);
        toast('ok', 'Blockchain berhasil direset',
            `Ledger kembali ke awal dengan ${sertifikat.length} sertifikat contoh (selesai dalam ${detik} detik).`);
    } else {
        toast('gagal', 'Reset blockchain gagal', esc(st.pesan || 'Penyebab tidak diketahui'));
        await Promise.all([muatSertifikat(), muatRantai(), muatAktivitas()]);
    }
}

async function mulai() {
    try {
        const st = await api('GET', '/api/reset/status');
        $('#btn-reset').classList.toggle('tersembunyi', !st.tersedia);
        if (st.berjalan) {
            await pantauReset();
            return;
        }
    } catch (err) {
        // Status reset tidak tersedia; lanjut memuat data seperti biasa.
    }
    muatSertifikat();
    muatRantai();
    muatAktivitas();
    muatNode();

    // Tautan dari QR: ?cek=NOMOR langsung membuka sertifikat tersebut.
    const cekAwal = new URLSearchParams(location.search).get('cek');
    if (cekAwal) lihatSertifikat(cekAwal);
}

mulai();
