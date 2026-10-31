// Memeriksa kondisi nyata tiap node: server, peer, ledger, dan chaincode miliknya.
const net = require('node:net');
const { common } = require('@hyperledger/fabric-protos');
const { NODES, ORDERERS, KUORUM, MODE_CLUSTER, CHANNEL, CHAINCODE, jaringan, tidakTerjangkau, riwayatSuara } = require('./fabric');

const BATAS_MS = 3000;
const hex = (u8) => Buffer.from(u8).toString('hex');

function cekPort(host, port) {
    return new Promise((selesai) => {
        const soket = net.connect({ host, port, timeout: BATAS_MS });
        const akhiri = (hasil) => {
            soket.destroy();
            selesai(hasil);
        };
        soket.once('connect', () => akhiri(true));
        soket.once('timeout', () => akhiri(false));
        soket.once('error', () => akhiri(false));
    });
}

async function cekNode(node) {
    const mulai = Date.now();
    const hasil = { id: node.id, ip: node.ip, peran: node.peran, mspId: node.mspId, endpoint: node.endpoint };
    try {
        const network = await jaringan('bpn', node);
        const bytes = await network.getContract('qscc')
            .newProposal('GetChainInfo', { arguments: [CHANNEL], endorsingOrganizations: [node.mspId] })
            .evaluate({ deadline: Date.now() + BATAS_MS });
        const info = common.BlockchainInfo.deserializeBinary(bytes);
        hasil.status = 'AKTIF';
        hasil.tinggi = Number(info.getHeight());
        hasil.hash = hex(info.getCurrentblockhash_asU8());
        hasil.ms = Date.now() - mulai;
    } catch (err) {
        // Bedakan server yang mati dengan layanan Fabric yang mati di server yang hidup.
        const serverHidup = !MODE_CLUSTER || await cekPort(node.ip, 22);
        hasil.status = serverHidup ? 'LAYANAN_MATI' : 'SERVER_MATI';
        hasil.alasan = tidakTerjangkau(err) ? 'Peer tidak merespons' : err.message;
        return hasil;
    }
    try {
        await (await jaringan('bpn', node)).getContract(CHAINCODE)
            .newProposal('org.hyperledger.fabric:GetMetadata', { endorsingOrganizations: [node.mspId] })
            .evaluate({ deadline: Date.now() + BATAS_MS });
        hasil.chaincode = true;
    } catch (err) {
        hasil.chaincode = false;
    }
    return hasil;
}

async function statusJaringan() {
    const [nodes, orderers] = await Promise.all([
        Promise.all(NODES.map(cekNode)),
        Promise.all(ORDERERS.map(async (o) => ({ ...o, aktif: await cekPort(o.ip, Number(o.endpoint.split(':')[1])) }))),
    ]);

    // Node sinkron bila ledger-nya sama dengan node tertinggi. Hash hanya bisa dibandingkan pada tinggi yang sama.
    const aktif = nodes.filter((n) => n.status === 'AKTIF');
    const tertinggi = Math.max(0, ...aktif.map((n) => n.tinggi));
    const hashAcuan = aktif.find((n) => n.tinggi === tertinggi)?.hash;
    for (const n of aktif) {
        n.sinkron = n.tinggi === tertinggi && n.hash === hashAcuan;
        n.selisih = tertinggi - n.tinggi;
        // Peer yang chaincode-nya mati tidak bisa memberi suara walau ledger-nya tetap terbaca.
        n.bisaMemilih = n.chaincode;
    }
    const pemilih = aktif.filter((n) => n.bisaMemilih).length;

    return {
        kuorum: KUORUM,
        total: nodes.length,
        aktif: aktif.length,
        pemilih,
        kuorumTercapai: pemilih >= KUORUM,
        tinggi: tertinggi,
        nodes,
        orderers,
        pemungutanTerakhir: riwayatSuara.slice(0, 5),
    };
}

module.exports = { statusJaringan };
