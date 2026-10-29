// Reset blockchain dari web: menjalankan scripts/network-up.sh di latar belakang
// dan melacak tahapannya dari log, supaya web bisa menampilkan progres.
const { spawn } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'network-up.sh');

// Penanda di log network.sh (fabric-samples test-network) untuk setiap tahap.
const TAHAP = [
    { label: 'Menghapus jaringan dan blok lama', pola: /Stopping network/ },
    { label: 'Membuat identitas organisasi & menyalakan peer', pola: /Bringing up network|Generating certificates/ },
    { label: 'Membuat channel & blok genesis', pola: /Creating channel mychannel|Joining org1 peer/ },
    { label: 'Mengompilasi smart contract', pola: /Compiling TypeScript/ },
    { label: 'Memasang smart contract di peer BPN & PPAT', pola: /Installing chaincode/ },
    { label: 'Persetujuan & commit smart contract', pola: /Chaincode definition approved/ },
    { label: 'Mengisi sertifikat contoh', pola: /invoke fcn call/ },
];

let status = { berjalan: false, tahap: -1, berhasil: null, pesan: null, mulai: null, selesai: null };

function statusReset() {
    return { ...status, daftarTahap: TAHAP.map((t) => t.label) };
}

function mulaiReset(setelahSelesai) {
    if (status.berjalan) {
        throw new Error('Reset blockchain sedang berjalan');
    }
    status = { berjalan: true, tahap: -1, berhasil: null, pesan: null, mulai: new Date().toISOString(), selesai: null };

    const proses = spawn('bash', [SCRIPT], { env: process.env });
    let ekor = '';
    const baca = (buf) => {
        ekor = (ekor + buf.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-6000);
        for (let i = TAHAP.length - 1; i > status.tahap; i--) {
            if (TAHAP[i].pola.test(ekor)) {
                status.tahap = i;
                break;
            }
        }
    };
    proses.stdout.on('data', baca);
    proses.stderr.on('data', baca);

    const akhiri = async (berhasil, pesan) => {
        if (!status.berjalan) return;
        // Kredensial dan blok lama sudah tidak berlaku, jadi koneksi & cache harus dibuang.
        await setelahSelesai();
        Object.assign(status, {
            berjalan: false,
            berhasil,
            pesan,
            tahap: berhasil ? TAHAP.length : status.tahap,
            selesai: new Date().toISOString(),
        });
    };
    proses.on('error', (err) => akhiri(false, err.message));
    proses.on('close', (kode) => {
        const baris = ekor.trim().split('\n').filter((b) => b.trim() && !b.startsWith('+')).slice(-3).join(' ');
        akhiri(kode === 0, kode === 0 ? 'Blockchain berhasil direset' : `Reset gagal (kode ${kode}): ${baris}`);
    });
    return statusReset();
}

module.exports = { mulaiReset, statusReset };
