export type StatusSertifikat = 'AKTIF' | 'PROSES_BALIK_NAMA' | 'DIBLOKIR';

export interface Pemilik {
    nik: string;
    nama: string;
}

export interface PengajuanBalikNama {
    nomorAkta: string;
    pembeli: Pemilik;
    diajukanPada: string;
}

export interface Sertifikat {
    docType: 'sertifikat';
    nomor: string;
    nib: string;
    lokasi: string;
    luasM2: number;
    pemilik: Pemilik;
    status: StatusSertifikat;
    pengajuan: PengajuanBalikNama | null;
    alasanBlokir: string;
    aksiTerakhir: string;
    aksiOleh: string;
    diterbitkanPada: string;
    diperbaruiPada: string;
}
