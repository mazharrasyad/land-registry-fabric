// Unit test aturan bisnis dengan ledger tiruan (tanpa jaringan Fabric).
// Jalankan: npm run build && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { LandRegistryContract, MSP_BPN, MSP_PPAT } = require('../dist/landRegistry');

function buatLedger() {
    const state = new Map();
    const history = new Map();
    let detik = 1_700_000_000;
    let tx = 0;

    const iterator = (items) => {
        let i = 0;
        return { next: async () => (i < items.length ? { done: false, value: items[i++] } : { done: true }), close: async () => {} };
    };

    const stub = {
        getState: async (k) => state.get(k) ?? Buffer.alloc(0),
        putState: async (k, v) => {
            state.set(k, Buffer.from(v));
            if (!history.has(k)) history.set(k, []);
            history.get(k).push({ txId: `tx${tx}`, isDelete: false, value: Buffer.from(v) });
        },
        createCompositeKey: (type, attrs) => `\u0000${type}\u0000${attrs.join('\u0000')}\u0000`,
        getStateByRange: async () => iterator([...state.entries()]
            .filter(([k]) => !k.startsWith('\u0000'))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => ({ key, value }))),
        getHistoryForKey: async (k) => iterator(history.get(k) ?? []),
        getDateTimestamp: () => new Date(detik * 1000),
    };

    const sebagai = (msp) => {
        tx++;
        detik++;
        return { stub, clientIdentity: { getMSPID: () => msp } };
    };
    return { sebagai };
}

const NIK_BUDI = '3271010101800001';
const NIK_SARI = '3271024404900002';

async function siapkan() {
    const cc = new LandRegistryContract();
    const l = buatLedger();
    await cc.InitLedger(l.sebagai(MSP_BPN));
    await cc.TerbitkanSertifikat(l.sebagai(MSP_BPN), 'SHM-3271-0003', '10.32.71.01.00003',
        'Kel. Tegal Gundil, Bogor Utara, Kota Bogor', '120', NIK_BUDI, 'Budi Santoso');
    return { cc, l };
}

test('alur normal: terbitkan, ajukan, sahkan balik nama', async () => {
    const { cc, l } = await siapkan();
    await cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, NIK_SARI, 'Sari Wulandari', 'AJB-001/2026');
    const hasil = JSON.parse(await cc.SahkanBalikNama(l.sebagai(MSP_BPN), 'SHM-3271-0003'));
    assert.equal(hasil.pemilik.nama, 'Sari Wulandari');
    assert.equal(hasil.status, 'AKTIF');

    const riwayat = JSON.parse(await cc.RiwayatSertifikat(l.sebagai(MSP_BPN), 'SHM-3271-0003'));
    assert.equal(riwayat.length, 3);
    assert.deepEqual(riwayat.map((r) => r.oleh), ['BPN', 'PPAT', 'BPN']);

    const semua = JSON.parse(await cc.DaftarSertifikat(l.sebagai(MSP_BPN)));
    assert.equal(semua.length, 3);
});

test('menolak sertifikat ganda untuk NIB yang sama', async () => {
    const { cc, l } = await siapkan();
    await assert.rejects(
        cc.TerbitkanSertifikat(l.sebagai(MSP_BPN), 'SHM-9999-0001', '10.32.71.01.00003', 'Bogor', '120', '1', 'Mafia'),
        /SERTIFIKAT GANDA DITOLAK/);
});

test('menolak penjualan oleh orang yang bukan pemilik', async () => {
    const { cc, l } = await siapkan();
    await cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, NIK_SARI, 'Sari Wulandari', 'AJB-001/2026');
    await cc.SahkanBalikNama(l.sebagai(MSP_BPN), 'SHM-3271-0003');
    await assert.rejects(
        cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, '999', 'Pembeli Lain', 'AJB-002/2026'),
        /bukan pemilik sah/);
});

test('PPAT tidak boleh mengesahkan atau menerbitkan sendiri', async () => {
    const { cc, l } = await siapkan();
    await cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, NIK_SARI, 'Sari Wulandari', 'AJB-001/2026');
    await assert.rejects(cc.SahkanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003'), /AKSES DITOLAK/);
    await assert.rejects(
        cc.TerbitkanSertifikat(l.sebagai(MSP_PPAT), 'SHM-1', '1.1', 'x', '1', '1', 'x'), /AKSES DITOLAK/);
});

test('sertifikat diblokir tidak bisa dijual', async () => {
    const { cc, l } = await siapkan();
    await cc.BlokirSertifikat(l.sebagai(MSP_BPN), 'SHM-3271-0003', 'Sengketa waris');
    await assert.rejects(
        cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, NIK_SARI, 'Sari', 'AJB-1'),
        /diblokir/);
    await cc.BukaBlokir(l.sebagai(MSP_BPN), 'SHM-3271-0003');
    await cc.AjukanBalikNama(l.sebagai(MSP_PPAT), 'SHM-3271-0003', NIK_BUDI, NIK_SARI, 'Sari', 'AJB-1');
});
