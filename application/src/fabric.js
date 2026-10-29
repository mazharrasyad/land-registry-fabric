const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');

const CHANNEL = process.env.CHANNEL_NAME || 'mychannel';
const CHAINCODE = process.env.CHAINCODE_NAME || 'landregistry';
const TEST_NETWORK = process.env.TEST_NETWORK_PATH || path.join(os.homedir(), 'fabric-samples', 'test-network');

// Org1 = BPN, Org2 = PPAT (sesuai MSP_BPN / MSP_PPAT di chaincode).
const ORGS = {
    bpn: { mspId: 'Org1MSP', domain: 'org1.example.com', endpoint: 'localhost:7051' },
    ppat: { mspId: 'Org2MSP', domain: 'org2.example.com', endpoint: 'localhost:9051' },
};

const koneksi = {};
const decoder = new TextDecoder();

async function fileTunggal(dir) {
    const files = await fs.readdir(dir);
    return path.join(dir, files[0]);
}

async function buatKoneksi(peran) {
    const org = ORGS[peran];
    const orgPath = path.join(TEST_NETWORK, 'organizations', 'peerOrganizations', org.domain);
    const peerHost = `peer0.${org.domain}`;
    const userMsp = path.join(orgPath, 'users', `User1@${org.domain}`, 'msp');

    const tlsCert = await fs.readFile(path.join(orgPath, 'peers', peerHost, 'tls', 'ca.crt'));
    const cert = await fs.readFile(await fileTunggal(path.join(userMsp, 'signcerts')));
    const key = await fs.readFile(await fileTunggal(path.join(userMsp, 'keystore')));

    const client = new grpc.Client(org.endpoint, grpc.credentials.createSsl(tlsCert), {
        'grpc.ssl_target_name_override': peerHost,
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
    return gateway.getNetwork(CHANNEL);
}

function jaringan(peran) {
    if (!ORGS[peran]) {
        throw new Error(`Peran tidak dikenal: ${peran}`);
    }
    koneksi[peran] ??= buatKoneksi(peran).catch((err) => {
        delete koneksi[peran];
        throw err;
    });
    return koneksi[peran];
}

async function kontrak(peran) {
    return (await jaringan(peran)).getContract(CHAINCODE);
}

function parse(bytes) {
    const teks = decoder.decode(bytes);
    return teks ? JSON.parse(teks) : null;
}

// Kirim transaksi dan tunggu sampai masuk blok, supaya nomor bloknya bisa ditampilkan.
async function submit(peran, fungsi, ...args) {
    const commit = await (await kontrak(peran)).submitAsync(fungsi, { arguments: args.map(String) });
    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaksi ${status.transactionId} gagal divalidasi (kode ${status.code})`);
    }
    return { data: parse(commit.getResult()), blok: Number(status.blockNumber), txId: status.transactionId };
}

async function evaluate(peran, fungsi, ...args) {
    return parse(await (await kontrak(peran)).evaluateTransaction(fungsi, ...args.map(String)));
}

// Ambil pesan error dari chaincode, buang prefix teknis gRPC/Fabric.
function pesanError(err) {
    if (err.code === 'ENOENT') {
        return `Kredensial Fabric tidak ditemukan di ${TEST_NETWORK}. Sudahkah jaringan dijalankan (scripts/network-up.sh)?`;
    }
    const detail = err.details?.find((d) => d.message)?.message || err.cause?.details || err.message || String(err);
    return detail.replace(/^.*chaincode response \d+, /s, '').replace(/^.*?Error: /s, '');
}

module.exports = { ORGS, CHANNEL, CHAINCODE, jaringan, submit, evaluate, pesanError };
