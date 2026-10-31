const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');

const CHANNEL = process.env.CHANNEL_NAME || 'mychannel';
const CHAINCODE = process.env.CHAINCODE_NAME || 'landregistry';
const TEST_NETWORK = process.env.TEST_NETWORK_PATH || path.join(os.homedir(), 'fabric-samples', 'test-network');
const CLUSTER_DIR = process.env.CLUSTER_PATH || path.join(os.homedir(), 'land-registry-net');
const TOPOLOGI = path.join(CLUSTER_DIR, 'topology.json');

// Jaringan multi-server (scripts/cluster.sh) dipakai bila topologinya ada,
// selain itu test-network lokal dengan dua peer dalam satu mesin.
const MODE_CLUSTER = fsSync.existsSync(TOPOLOGI);
const ORGANISASI = MODE_CLUSTER ? path.join(CLUSTER_DIR, 'organizations') : path.join(TEST_NETWORK, 'organizations');
const { nodes: NODES, orderers: ORDERERS } = MODE_CLUSTER ? JSON.parse(fsSync.readFileSync(TOPOLOGI, 'utf8')) : {
    nodes: [
        { id: 'peer0.org1', ip: 'localhost', mspId: 'Org1MSP', domain: 'org1.example.com', peran: 'BPN', endpoint: 'localhost:7051' },
        { id: 'peer0.org2', ip: 'localhost', mspId: 'Org2MSP', domain: 'org2.example.com', peran: 'PPAT', endpoint: 'localhost:9051' },
    ],
    orderers: [{ id: 'orderer', node: 'localhost', ip: 'localhost', endpoint: 'localhost:7050' }],
};

// Org1 = BPN, Org2 = PPAT (sesuai MSP_BPN / MSP_PPAT di chaincode).
const ORGS = {
    bpn: { mspId: 'Org1MSP', domain: 'org1.example.com' },
    ppat: { mspId: 'Org2MSP', domain: 'org2.example.com' },
};

// Sama dengan endorsement policy channel: MAJORITY Endorsement.
const KUORUM = Math.floor(NODES.length / 2) + 1;

const koneksi = {};
const decoder = new TextDecoder();
const GRPC_TIDAK_TERJANGKAU = [grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED];

async function fileTunggal(dir) {
    const files = await fs.readdir(dir);
    return path.join(dir, files[0]);
}

async function buatKoneksi(peran, node) {
    const org = ORGS[peran];
    const user = `User1@${org.domain}`;
    const userMsp = MODE_CLUSTER
        ? path.join(ORGANISASI, 'web-users', user, 'msp')
        : path.join(ORGANISASI, 'peerOrganizations', org.domain, 'users', user, 'msp');
    const tlsCert = await fs.readFile(path.join(ORGANISASI, 'peerOrganizations', node.domain, 'tlsca', `tlsca.${node.domain}-cert.pem`));
    const cert = await fs.readFile(await fileTunggal(path.join(userMsp, 'signcerts')));
    const key = await fs.readFile(await fileTunggal(path.join(userMsp, 'keystore')));

    const client = new grpc.Client(node.endpoint, grpc.credentials.createSsl(tlsCert), {
        'grpc.ssl_target_name_override': MODE_CLUSTER ? node.ip : `peer0.${node.domain}`,
        // Node yang baru menyala lagi harus segera terdeteksi.
        'grpc.max_reconnect_backoff_ms': 5000,
    });
    const gateway = connect({
        client,
        identity: { mspId: org.mspId, credentials: cert },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(key)),
        hash: hash.sha256,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        endorseOptions: () => ({ deadline: Date.now() + 15000 }),
        submitOptions: () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    tertutup.push(() => {
        gateway.close();
        client.close();
    });
    return gateway.getNetwork(CHANNEL);
}

const tertutup = [];

// Tutup semua koneksi; koneksi baru dibuat lagi saat dibutuhkan (mis. setelah jaringan direset).
function putuskanSemua() {
    tertutup.splice(0).forEach((tutup) => tutup());
    for (const kunci of Object.keys(koneksi)) {
        delete koneksi[kunci];
    }
}

// Koneksi ke satu node, atas nama satu peran. Identitas penanda tangan tidak harus sesuai node tujuan.
function jaringan(peran, node = NODES[0]) {
    if (!ORGS[peran]) {
        throw new Error(`Peran tidak dikenal: ${peran}`);
    }
    const kunci = `${peran}@${node.id}`;
    koneksi[kunci] ??= buatKoneksi(peran, node).catch((err) => {
        delete koneksi[kunci];
        throw err;
    });
    return koneksi[kunci];
}

function tidakTerjangkau(err) {
    return GRPC_TIDAK_TERJANGKAU.includes(err.code);
}

// Pembacaan tetap jalan selama ada satu node yang hidup: coba node berikutnya bila tidak terjangkau.
async function bacaDariNodeAktif(peran, baca) {
    let galat;
    for (const node of NODES) {
        try {
            return await baca(await jaringan(peran, node));
        } catch (err) {
            if (!tidakTerjangkau(err)) throw err;
            galat = err;
        }
    }
    throw galat;
}

function parse(bytes) {
    const teks = decoder.decode(bytes);
    return teks ? JSON.parse(teks) : null;
}

// Satu node memberi suara: chaincode dijalankan di peer node itu terhadap ledger miliknya,
// tanpa ada yang ditulis. Lolos semua aturan = setuju, ditolak aturan = tolak.
async function mintaSuara(peran, node, fungsi, args) {
    const mulai = Date.now();
    const dasar = { node: node.id, peran: node.peran, mspId: node.mspId };
    try {
        const kontrak = (await jaringan(peran, node)).getContract(CHAINCODE);
        await kontrak.newProposal(fungsi, { arguments: args, endorsingOrganizations: [node.mspId] })
            .evaluate({ deadline: Date.now() + 8000 });
        return { ...dasar, suara: 'SETUJU', alasan: null, ms: Date.now() - mulai };
    } catch (err) {
        if (tidakTerjangkau(err)) {
            return { ...dasar, suara: 'TIDAK_HADIR', alasan: 'Node tidak terjangkau', ms: Date.now() - mulai };
        }
        return { ...dasar, suara: 'TOLAK', alasan: pesanError(err), ms: Date.now() - mulai };
    }
}

// Riwayat pemungutan suara. Suara setuju juga tersimpan permanen di blok sebagai endorsement;
// transaksi yang ditolak tidak masuk blok, jadi hanya tercatat di sini.
const riwayatSuara = [];

function catatSuara(fungsi, peran, suara, hasil, tambahan = {}) {
    const catatan = {
        fungsi,
        peran,
        suara,
        hasil,
        kuorum: KUORUM,
        waktu: new Date().toISOString(),
        ...tambahan,
    };
    riwayatSuara.unshift(catatan);
    riwayatSuara.length = Math.min(riwayatSuara.length, 20);
    return catatan;
}

// Setiap perubahan data melewati dua tahap: semua node memberi suara, lalu transaksi hanya
// dikirim ke orderer bila mayoritas setuju. Peer memvalidasi ulang tanda tangan para pemberi
// suara saat menerima blok, jadi aturan kuorum tetap ditegakkan jaringan, bukan hanya oleh web ini.
async function submit(peran, fungsi, ...args) {
    const argumen = args.map(String);
    const suara = await Promise.all(NODES.map((n) => mintaSuara(peran, n, fungsi, argumen)));
    const setuju = suara.filter((s) => s.suara === 'SETUJU');

    if (setuju.length < KUORUM) {
        const penolakan = suara.find((s) => s.suara === 'TOLAK');
        const alasan = penolakan?.alasan
            ?? `Kuorum tidak tercapai: hanya ${setuju.length} dari ${NODES.length} node yang hadir, butuh ${KUORUM}`;
        const err = new Error(alasan);
        err.pemungutan = catatSuara(fungsi, peran, suara, 'DITOLAK', { alasan });
        throw err;
    }

    const gerbang = NODES.find((n) => n.id === setuju[0].node);
    try {
        const kontrak = (await jaringan(peran, gerbang)).getContract(CHAINCODE);
        const commit = await kontrak.submitAsync(fungsi, {
            arguments: argumen,
            endorsingOrganizations: setuju.map((s) => s.mspId),
        });
        const status = await commit.getStatus();
        if (!status.successful) {
            throw new Error(`Transaksi ${status.transactionId} gagal divalidasi (kode ${status.code})`);
        }
        const blok = Number(status.blockNumber);
        const pemungutan = catatSuara(fungsi, peran, suara, 'DISETUJUI', { blok, txId: status.transactionId });
        return { data: parse(commit.getResult()), blok, txId: status.transactionId, pemungutan };
    } catch (err) {
        err.pemungutan = catatSuara(fungsi, peran, suara, 'GAGAL', { alasan: pesanError(err) });
        throw err;
    }
}

async function evaluate(peran, fungsi, ...args) {
    return parse(await bacaDariNodeAktif(peran,
        (network) => network.getContract(CHAINCODE).evaluateTransaction(fungsi, ...args.map(String))));
}

// Ambil pesan error dari chaincode, buang prefix teknis gRPC/Fabric.
function pesanError(err) {
    if (err.code === 'ENOENT') {
        return `Kredensial Fabric tidak ditemukan di ${ORGANISASI}. Sudahkah jaringan dijalankan?`;
    }
    const detail = err.details?.find((d) => d.message)?.message || err.cause?.details || err.message || String(err);
    return detail.replace(/^.*chaincode response \d+, /s, '').replace(/^.*?Error: /s, '');
}

module.exports = {
    ORGS, NODES, ORDERERS, KUORUM, MODE_CLUSTER, CHANNEL, CHAINCODE,
    jaringan, bacaDariNodeAktif, tidakTerjangkau, putuskanSemua, submit, evaluate, pesanError, riwayatSuara,
};
