const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { ORGS, submit, evaluate, pesanError } = require('./fabric');

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
        res.status(400).json({ ok: false, pesan: pesanError(err) });
    }
};

// Pembacaan publik memakai identitas BPN; siapa pun boleh membaca.
app.get('/api/sertifikat', jalankan(() => evaluate('bpn', 'DaftarSertifikat')));
app.get('/api/sertifikat/:nomor', jalankan((req) => evaluate('bpn', 'BacaSertifikat', req.params.nomor)));
app.get('/api/sertifikat/:nomor/riwayat', jalankan((req) => evaluate('bpn', 'RiwayatSertifikat', req.params.nomor)));
app.get('/api/bidang/:nib', jalankan((req) => evaluate('bpn', 'CekBidangTanah', req.params.nib)));

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
