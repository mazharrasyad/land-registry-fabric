const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { ORGS, CHAINCODE, MODE_CLUSTER, putuskanSemua, submit, evaluate, pesanError } = require('./fabric');
const { infoRantai, ambilBlok, nomorBlokTransaksi, kosongkanCache } = require('./blockchain');
const { mulaiReset, statusReset } = require('./reset');
const { statusJaringan } = require('./nodes');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// Path publik saat dipasang di belakang reverse proxy, mis. /land-registry-fabric/.
const BASE_PATH = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const PUBLIC = path.join(__dirname, '..', 'public');

const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace('<base href="/">', `<base href="${BASE_PATH}">`);

app.use(express.json());
app.get(['/', '/index.html'], (req, res) => res.type('html').send(indexHtml));
app.use(express.static(PUBLIC, { index: false }));

const jalankan = (fn) => async (req, res) => {
    try {
        res.json({ ok: true, data: await fn(req) });
    } catch (err) {
        res.status(400).json({ ok: false, pesan: pesanError(err), pemungutan: err.pemungutan });
    }
};

// Reset blockchain: jaringan dibuat ulang dari nol (±2-3 menit), progres dipantau lewat /status.
// Di jaringan multi-server, reset hanya bisa dari master (scripts/cluster.sh reset): web tidak punya akses ke node lain.
app.get('/api/reset/status', (req, res) => res.json({ ok: true, data: { ...statusReset(), tersedia: !MODE_CLUSTER } }));
app.post('/api/reset', jalankan(() => {
    if (MODE_CLUSTER) {
        throw new Error('Reset jaringan multi-server dijalankan dari master: bash scripts/cluster.sh reset');
    }
    return mulaiReset(async () => {
        putuskanSemua();
        kosongkanCache();
    });
}));

// Selama reset, ledger tidak bisa dibaca atau ditulis.
app.use('/api', (req, res, next) => (statusReset().berjalan
    ? res.status(503).json({ ok: false, pesan: 'Blockchain sedang direset, coba lagi setelah selesai.' })
    : next()));

// Kondisi nyata tiap node dan hasil pemungutan suara terakhir.
app.get('/api/node', jalankan(() => statusJaringan()));

// Pembacaan publik memakai identitas BPN; siapa pun boleh membaca.
app.get('/api/sertifikat', jalankan(() => evaluate('bpn', 'DaftarSertifikat')));
app.get('/api/sertifikat/:nomor', jalankan((req) => evaluate('bpn', 'BacaSertifikat', req.params.nomor)));
app.get('/api/sertifikat/:nomor/riwayat', jalankan(async (req) => {
    const riwayat = await evaluate('bpn', 'RiwayatSertifikat', req.params.nomor);
    for (const r of riwayat) {
        r.blok = await nomorBlokTransaksi(r.txId);
    }
    return riwayat;
}));
app.get('/api/bidang/:nib', jalankan((req) => evaluate('bpn', 'CekBidangTanah', req.params.nib)));

// Blok-blok terbaru, dari yang paling baru ke yang lama.
app.get('/api/blockchain', jalankan(async (req) => {
    const info = await infoRantai();
    const teratas = info.tinggi - 1;
    const terakhir = await ambilBlok(teratas);
    if (terakhir.hash !== info.hashTerkini) {
        kosongkanCache();
    }
    const sampai = Math.min(Number(req.query.sampai ?? teratas), teratas);
    const jumlah = Math.min(Math.max(Number(req.query.jumlah) || 8, 1), 20);
    const blok = [];
    for (let n = sampai; n >= 0 && blok.length < jumlah; n--) {
        blok.push(await ambilBlok(n));
    }
    return { ...info, blok };
}));
app.get('/api/blok/:nomor', jalankan((req) => ambilBlok(Number(req.params.nomor))));

// Aktivitas = transaksi sertifikat yang sah di ledger, terbaru dulu.
app.get('/api/aktivitas', jalankan(async () => {
    const { tinggi } = await infoRantai();
    const hasil = [];
    for (let n = tinggi - 1; n >= Math.max(0, tinggi - 100) && hasil.length < 15; n--) {
        const blok = await ambilBlok(n);
        for (const tx of blok.transaksi.slice().reverse()) {
            if (tx.valid && tx.chaincode === CHAINCODE && hasil.length < 15) {
                hasil.push({ ...tx, blok: n });
            }
        }
    }
    return hasil;
}));

// Transaksi ditandatangani dengan identitas :peran (bpn / ppat). Hak akses ditegakkan
// oleh chaincode, bukan oleh API, sehingga simulasi "peran yang salah" akan ditolak ledger.
const router = express.Router({ mergeParams: true });
router.use((req, res, next) => (ORGS[req.params.peran] ? next() : res.status(404).json({ ok: false, pesan: 'Peran tidak dikenal' })));

router.post('/terbitkan', jalankan((req) => {
    const b = req.body;
    return submit(req.params.peran, 'TerbitkanSertifikat', b.nomor, b.nib, b.lokasi, b.luasM2, b.nikPemilik, b.namaPemilik);
}));
router.post('/ajukan-balik-nama', jalankan((req) => {
    const b = req.body;
    return submit(req.params.peran, 'AjukanBalikNama', b.nomor, b.nikPenjual, b.nikPembeli, b.namaPembeli, b.nomorAkta);
}));
router.post('/sahkan/:nomor', jalankan((req) => submit(req.params.peran, 'SahkanBalikNama', req.params.nomor)));
router.post('/tolak/:nomor', jalankan((req) => submit(req.params.peran, 'TolakBalikNama', req.params.nomor, req.body.alasan)));
router.post('/blokir/:nomor', jalankan((req) => submit(req.params.peran, 'BlokirSertifikat', req.params.nomor, req.body.alasan)));
router.post('/buka-blokir/:nomor', jalankan((req) => submit(req.params.peran, 'BukaBlokir', req.params.nomor)));

app.use('/api/:peran', router);

app.listen(PORT, HOST, () => {
    console.log(`Web demo sertifikat tanah berjalan di http://${HOST}:${PORT}${BASE_PATH}`);
});
