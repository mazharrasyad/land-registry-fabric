import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { Pemilik, Sertifikat } from './types';

// Pemetaan organisasi di test-network Fabric ke peran di dunia nyata.
export const MSP_BPN = 'Org1MSP';
export const MSP_PPAT = 'Org2MSP';

const NAMA_PERAN: Record<string, string> = {
    [MSP_BPN]: 'BPN',
    [MSP_PPAT]: 'PPAT',
};

const INDEKS_NIB = 'nib';

@Info({ title: 'LandRegistryContract', description: 'Pencatatan sertifikat tanah dan balik nama' })
export class LandRegistryContract extends Contract {

    @Transaction()
    // Tidak dibatasi peran: deployCC test-network memanggil init dengan identitas Org2.
    // Aman karena hanya menambah sertifikat contoh yang belum ada.
    public async InitLedger(ctx: Context): Promise<void> {
        const contoh = [
            { nomor: 'SHM-3273-0001', nib: '10.27.01.02.00001', lokasi: 'Kel. Dago, Kec. Coblong, Kota Bandung', luasM2: 200, nik: '3273015505850002', nama: 'Siti Rahma' },
            { nomor: 'SHM-3374-0002', nib: '11.33.74.05.00002', lokasi: 'Kel. Tembalang, Kec. Tembalang, Kota Semarang', luasM2: 150, nik: '3374012003780003', nama: 'Andi Wijaya' },
        ];
        for (const c of contoh) {
            if (!(await this.ada(ctx, c.nomor))) {
                await this.terbitkan(ctx, c.nomor, c.nib, c.lokasi, c.luasM2, { nik: c.nik, nama: c.nama });
            }
        }
    }

    @Transaction()
    @Returns('string')
    public async TerbitkanSertifikat(ctx: Context, nomor: string, nib: string, lokasi: string,
        luasM2: string, nikPemilik: string, namaPemilik: string): Promise<string> {
        this.wajibPeran(ctx, MSP_BPN, 'menerbitkan sertifikat');
        this.wajibIsi({ nomor, nib, lokasi, luasM2, nikPemilik, namaPemilik });
        const luas = Number(luasM2);
        if (!Number.isFinite(luas) || luas <= 0) {
            throw new Error('Luas tanah harus berupa angka lebih dari 0');
        }
        const sertifikat = await this.terbitkan(ctx, nomor.trim(), nib.trim(), lokasi.trim(), luas,
            { nik: nikPemilik.trim(), nama: namaPemilik.trim() });
        return keJson(sertifikat);
    }

    @Transaction()
    @Returns('string')
    public async AjukanBalikNama(ctx: Context, nomor: string, nikPenjual: string, nikPembeli: string,
        namaPembeli: string, nomorAkta: string): Promise<string> {
        this.wajibPeran(ctx, MSP_PPAT, 'mengajukan balik nama');
        this.wajibIsi({ nomor, nikPenjual, nikPembeli, namaPembeli, nomorAkta });
        const s = await this.ambil(ctx, nomor);

        if (s.status === 'DIBLOKIR') {
            throw new Error(`PENJUALAN DITOLAK: sertifikat ${nomor} sedang diblokir (${s.alasanBlokir})`);
        }
        if (s.status === 'PROSES_BALIK_NAMA') {
            throw new Error(`PENJUALAN DITOLAK: sertifikat ${nomor} sedang dalam proses balik nama lain (akta ${s.pengajuan?.nomorAkta})`);
        }
        if (s.pemilik.nik !== nikPenjual.trim()) {
            throw new Error(`PENJUALAN DITOLAK: NIK penjual bukan pemilik sah saat ini. Pemilik tercatat: ${s.pemilik.nama}`);
        }
        if (s.pemilik.nik === nikPembeli.trim()) {
            throw new Error('Pembeli tidak boleh sama dengan pemilik saat ini');
        }

        const waktu = this.waktu(ctx);
        s.status = 'PROSES_BALIK_NAMA';
        s.pengajuan = {
            nomorAkta: nomorAkta.trim(),
            pembeli: { nik: nikPembeli.trim(), nama: namaPembeli.trim() },
            diajukanPada: waktu,
        };
        await this.simpan(ctx, s, `Pengajuan balik nama ke ${namaPembeli.trim()} (akta ${nomorAkta.trim()})`);
        return keJson(s);
    }

    @Transaction()
    @Returns('string')
    public async SahkanBalikNama(ctx: Context, nomor: string): Promise<string> {
        this.wajibPeran(ctx, MSP_BPN, 'mengesahkan balik nama');
        const s = await this.ambil(ctx, nomor);
        if (s.status !== 'PROSES_BALIK_NAMA' || !s.pengajuan) {
            throw new Error(`Sertifikat ${nomor} tidak memiliki pengajuan balik nama`);
        }
        const lama = s.pemilik.nama;
        s.pemilik = s.pengajuan.pembeli;
        s.pengajuan = null;
        s.status = 'AKTIF';
        await this.simpan(ctx, s, `Balik nama disahkan: ${lama} → ${s.pemilik.nama}`);
        return keJson(s);
    }

    @Transaction()
    @Returns('string')
    public async TolakBalikNama(ctx: Context, nomor: string, alasan: string): Promise<string> {
        this.wajibPeran(ctx, MSP_BPN, 'menolak balik nama');
        this.wajibIsi({ alasan });
        const s = await this.ambil(ctx, nomor);
        if (s.status !== 'PROSES_BALIK_NAMA') {
            throw new Error(`Sertifikat ${nomor} tidak memiliki pengajuan balik nama`);
        }
        s.pengajuan = null;
        s.status = 'AKTIF';
        await this.simpan(ctx, s, `Balik nama ditolak: ${alasan.trim()}`);
        return keJson(s);
    }

    @Transaction()
    @Returns('string')
    public async BlokirSertifikat(ctx: Context, nomor: string, alasan: string): Promise<string> {
        this.wajibPeran(ctx, MSP_BPN, 'memblokir sertifikat');
        this.wajibIsi({ alasan });
        const s = await this.ambil(ctx, nomor);
        if (s.status === 'DIBLOKIR') {
            throw new Error(`Sertifikat ${nomor} sudah diblokir`);
        }
        s.status = 'DIBLOKIR';
        s.pengajuan = null;
        s.alasanBlokir = alasan.trim();
        await this.simpan(ctx, s, `Sertifikat diblokir: ${s.alasanBlokir}`);
        return keJson(s);
    }

    @Transaction()
    @Returns('string')
    public async BukaBlokir(ctx: Context, nomor: string): Promise<string> {
        this.wajibPeran(ctx, MSP_BPN, 'membuka blokir');
        const s = await this.ambil(ctx, nomor);
        if (s.status !== 'DIBLOKIR') {
            throw new Error(`Sertifikat ${nomor} tidak sedang diblokir`);
        }
        s.status = 'AKTIF';
        s.alasanBlokir = '';
        await this.simpan(ctx, s, 'Blokir dibuka');
        return keJson(s);
    }

    @Transaction(false)
    @Returns('string')
    public async BacaSertifikat(ctx: Context, nomor: string): Promise<string> {
        return keJson(await this.ambil(ctx, nomor));
    }

    @Transaction(false)
    @Returns('string')
    public async CekBidangTanah(ctx: Context, nib: string): Promise<string> {
        const nomor = await this.nomorDariNib(ctx, nib.trim());
        if (!nomor) {
            throw new Error(`Bidang tanah dengan NIB ${nib} belum terdaftar`);
        }
        return keJson(await this.ambil(ctx, nomor));
    }

    @Transaction(false)
    @Returns('string')
    public async DaftarSertifikat(ctx: Context): Promise<string> {
        const hasil: Sertifikat[] = [];
        // Range query tidak menyertakan composite key (indeks NIB), jadi isinya hanya sertifikat.
        const iterator = await ctx.stub.getStateByRange('', '');
        try {
            let r = await iterator.next();
            while (!r.done) {
                hasil.push(JSON.parse(Buffer.from(r.value.value).toString('utf8')) as Sertifikat);
                r = await iterator.next();
            }
        } finally {
            await iterator.close();
        }
        return keJson(hasil);
    }

    @Transaction(false)
    @Returns('string')
    public async RiwayatSertifikat(ctx: Context, nomor: string): Promise<string> {
        await this.ambil(ctx, nomor);
        const riwayat: { txId: string; waktu: string; aksi: string; oleh: string; data: Sertifikat }[] = [];
        const iterator = await ctx.stub.getHistoryForKey(nomor);
        try {
            let r = await iterator.next();
            while (!r.done) {
                if (!r.value.isDelete) {
                    const data = JSON.parse(Buffer.from(r.value.value).toString('utf8')) as Sertifikat;
                    riwayat.push({ txId: r.value.txId, waktu: data.diperbaruiPada, aksi: data.aksiTerakhir, oleh: data.aksiOleh, data });
                }
                r = await iterator.next();
            }
        } finally {
            await iterator.close();
        }
        riwayat.sort((a, b) => a.waktu.localeCompare(b.waktu));
        return keJson(riwayat);
    }

    private async terbitkan(ctx: Context, nomor: string, nib: string, lokasi: string,
        luasM2: number, pemilik: Pemilik): Promise<Sertifikat> {
        if (await this.ada(ctx, nomor)) {
            throw new Error(`Sertifikat dengan nomor ${nomor} sudah ada`);
        }
        const nomorLain = await this.nomorDariNib(ctx, nib);
        if (nomorLain) {
            throw new Error(`SERTIFIKAT GANDA DITOLAK: bidang tanah NIB ${nib} sudah terdaftar pada sertifikat ${nomorLain}`);
        }
        const waktu = this.waktu(ctx);
        const s: Sertifikat = {
            docType: 'sertifikat',
            nomor,
            nib,
            lokasi,
            luasM2,
            pemilik,
            status: 'AKTIF',
            pengajuan: null,
            alasanBlokir: '',
            aksiTerakhir: '',
            aksiOleh: '',
            diterbitkanPada: waktu,
            diperbaruiPada: waktu,
        };
        await ctx.stub.putState(ctx.stub.createCompositeKey(INDEKS_NIB, [nib]), Buffer.from(nomor));
        await this.simpan(ctx, s, `Sertifikat diterbitkan atas nama ${pemilik.nama}`);
        return s;
    }

    private async simpan(ctx: Context, s: Sertifikat, aksi: string): Promise<void> {
        s.aksiTerakhir = aksi;
        s.aksiOleh = NAMA_PERAN[ctx.clientIdentity.getMSPID()] ?? ctx.clientIdentity.getMSPID();
        s.diperbaruiPada = this.waktu(ctx);
        await ctx.stub.putState(s.nomor, Buffer.from(keJson(s)));
    }

    private async ambil(ctx: Context, nomor: string): Promise<Sertifikat> {
        const data = await ctx.stub.getState(nomor.trim());
        if (!data || data.length === 0) {
            throw new Error(`Sertifikat ${nomor} tidak ditemukan`);
        }
        return JSON.parse(Buffer.from(data).toString('utf8')) as Sertifikat;
    }

    private async ada(ctx: Context, nomor: string): Promise<boolean> {
        const data = await ctx.stub.getState(nomor);
        return !!data && data.length > 0;
    }

    private async nomorDariNib(ctx: Context, nib: string): Promise<string | null> {
        const data = await ctx.stub.getState(ctx.stub.createCompositeKey(INDEKS_NIB, [nib]));
        return data && data.length > 0 ? Buffer.from(data).toString('utf8') : null;
    }

    private wajibPeran(ctx: Context, msp: string, kegiatan: string): void {
        const pemanggil = ctx.clientIdentity.getMSPID();
        if (pemanggil !== msp) {
            throw new Error(`AKSES DITOLAK: hanya ${NAMA_PERAN[msp]} yang boleh ${kegiatan} (pemanggil: ${NAMA_PERAN[pemanggil] ?? pemanggil})`);
        }
    }

    private wajibIsi(field: Record<string, string>): void {
        for (const [nama, nilai] of Object.entries(field)) {
            if (!nilai || !String(nilai).trim()) {
                throw new Error(`Field "${nama}" wajib diisi`);
            }
        }
    }

    // Waktu diambil dari timestamp transaksi supaya semua peer menghasilkan nilai yang sama.
    private waktu(ctx: Context): string {
        return ctx.stub.getDateTimestamp().toISOString();
    }
}

// JSON dengan urutan key tetap, agar hasil endorsement antar peer identik.
function keJson(nilai: unknown): string {
    return JSON.stringify(urutkan(nilai));
}

function urutkan(nilai: unknown): unknown {
    if (Array.isArray(nilai)) {
        return nilai.map(urutkan);
    }
    if (nilai && typeof nilai === 'object') {
        return Object.keys(nilai as object).sort().reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = urutkan((nilai as Record<string, unknown>)[k]);
            return acc;
        }, {});
    }
    return nilai;
}
