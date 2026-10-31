// Membaca blok mentah dari ledger Fabric (system chaincode qscc) dan
// menerjemahkannya menjadi data yang bisa digambar di web.
const crypto = require('node:crypto');
const { common, msp, peer } = require('@hyperledger/fabric-protos');
const { CHANNEL, NODES, bacaDariNodeAktif } = require('./fabric');

const { HeaderType, BlockMetadataIndex } = common;
const NAMA_TIPE = { [HeaderType.CONFIG]: 'KONFIGURASI', [HeaderType.ENDORSER_TRANSACTION]: 'TRANSAKSI' };
const NAMA_ORG = { Org1MSP: 'BPN', Org2MSP: 'PPAT', OrdererMSP: 'Orderer' };
const nodeDariMsp = (mspId) => NODES.find((n) => n.mspId === mspId)?.id ?? mspId;

// Blok tidak pernah berubah setelah tercatat, jadi aman disimpan di memori.
const cacheBlok = new Map();
const cacheTx = new Map();

const hex = (u8) => Buffer.from(u8).toString('hex');

// Hash blok Fabric = SHA-256 dari header yang di-encode ASN.1 DER:
// SEQUENCE { number INTEGER, previousHash OCTET STRING, dataHash OCTET STRING }.
// previousHash setiap blok sama dengan hash blok sebelumnya; itulah "rantai"-nya.
function derTlv(tag, isi) {
    let panjang;
    if (isi.length < 128) {
        panjang = Buffer.from([isi.length]);
    } else {
        const b = [];
        for (let n = isi.length; n > 0; n >>= 8) b.unshift(n & 0xff);
        panjang = Buffer.from([0x80 | b.length, ...b]);
    }
    return Buffer.concat([Buffer.from([tag]), panjang, isi]);
}

function derInteger(nilai) {
    const b = [];
    let v = BigInt(nilai);
    do {
        b.unshift(Number(v & 0xffn));
        v >>= 8n;
    } while (v > 0n);
    if (b[0] & 0x80) b.unshift(0);
    return derTlv(0x02, Buffer.from(b));
}

function hashHeader(header) {
    const der = derTlv(0x30, Buffer.concat([
        derInteger(header.getNumber()),
        derTlv(0x04, Buffer.from(header.getPreviousHash_asU8())),
        derTlv(0x04, Buffer.from(header.getDataHash_asU8())),
    ]));
    return crypto.createHash('sha256').update(der).digest('hex');
}

function teks(u8) {
    const s = Buffer.from(u8).toString('utf8');
    return /^[^\u0000-\u0008\u000e-\u001f�]*$/.test(s) ? s : `(data biner ${u8.length} byte)`;
}

function bacaTransaksi(data, kodeValidasi) {
    const payload = common.Payload.deserializeBinary(common.Envelope.deserializeBinary(data).getPayload_asU8());
    const header = payload.getHeader();
    const ch = common.ChannelHeader.deserializeBinary(header.getChannelHeader_asU8());
    const sh = common.SignatureHeader.deserializeBinary(header.getSignatureHeader_asU8());
    const mspId = msp.SerializedIdentity.deserializeBinary(sh.getCreator_asU8()).getMspid();
    const ts = ch.getTimestamp();

    const tx = {
        txId: ch.getTxId(),
        tipe: NAMA_TIPE[ch.getType()] ?? `TIPE_${ch.getType()}`,
        waktu: ts ? new Date(ts.getSeconds() * 1000 + Math.floor(ts.getNanos() / 1e6)).toISOString() : null,
        pengirim: NAMA_ORG[mspId] ?? (mspId || '-'),
        valid: kodeValidasi === 0,
        chaincode: null,
        fungsi: null,
        args: [],
        penyetuju: [],
    };

    if (ch.getType() === HeaderType.ENDORSER_TRANSACTION) {
        const aksi = peer.Transaction.deserializeBinary(payload.getData_asU8()).getActionsList()[0];
        const cap = peer.ChaincodeActionPayload.deserializeBinary(aksi.getPayload_asU8());
        const cpp = peer.ChaincodeProposalPayload.deserializeBinary(cap.getChaincodeProposalPayload_asU8());
        const spec = peer.ChaincodeInvocationSpec.deserializeBinary(cpp.getInput_asU8()).getChaincodeSpec();
        const args = spec.getInput().getArgsList_asU8().map(teks);
        tx.chaincode = spec.getChaincodeId().getName();
        tx.fungsi = args[0] ?? null;
        tx.args = args.slice(1);
        // Tanda tangan endorsement di dalam blok adalah bukti suara setuju tiap node.
        tx.penyetuju = cap.getAction().getEndorsementsList().map((e) => nodeDariMsp(
            msp.SerializedIdentity.deserializeBinary(e.getEndorser_asU8()).getMspid()));
    }
    return tx;
}

function bacaBlok(bytes) {
    const blok = common.Block.deserializeBinary(bytes);
    const header = blok.getHeader();
    const filter = blok.getMetadata()?.getMetadataList_asU8()[BlockMetadataIndex.TRANSACTIONS_FILTER] ?? new Uint8Array();
    return {
        nomor: Number(header.getNumber()),
        hash: hashHeader(header),
        previousHash: hex(header.getPreviousHash_asU8()),
        dataHash: hex(header.getDataHash_asU8()),
        transaksi: blok.getData().getDataList_asU8().map((d, i) => bacaTransaksi(d, filter[i] ?? 0)),
    };
}

async function qscc(fungsi, ...args) {
    return bacaDariNodeAktif('bpn', (network) => network.getContract('qscc')
        .evaluateTransaction(fungsi, CHANNEL, ...args.map(String)));
}

async function infoRantai() {
    const info = common.BlockchainInfo.deserializeBinary(await qscc('GetChainInfo'));
    return { tinggi: Number(info.getHeight()), hashTerkini: hex(info.getCurrentblockhash_asU8()) };
}

async function ambilBlok(nomor) {
    if (!cacheBlok.has(nomor)) {
        cacheBlok.set(nomor, bacaBlok(await qscc('GetBlockByNumber', nomor)));
    }
    return cacheBlok.get(nomor);
}

async function nomorBlokTransaksi(txId) {
    if (!cacheTx.has(txId)) {
        const blok = common.Block.deserializeBinary(await qscc('GetBlockByTxID', txId));
        cacheTx.set(txId, Number(blok.getHeader().getNumber()));
    }
    return cacheTx.get(txId);
}

// Ledger direset (network-up.sh) → hash blok berubah, jadi cache harus dibuang.
function kosongkanCache() {
    cacheBlok.clear();
    cacheTx.clear();
}

module.exports = { infoRantai, ambilBlok, nomorBlokTransaksi, kosongkanCache };
