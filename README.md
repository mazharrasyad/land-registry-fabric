# Land Registry Fabric — Sertifikat Tanah di Blockchain

Prototype pencatatan **sertifikat tanah dan balik nama** berbasis **Hyperledger Fabric**, dengan studi kasus Indonesia.
Tujuannya menunjukkan bagaimana ledger bersama yang tidak bisa diubah sepihak dapat mencegah praktik mafia tanah:
**sertifikat ganda**, **penjualan tanah oleh orang yang bukan pemilik**, dan **perpindahan hak tanpa pengesahan BPN**.

## Latar Belakang

Indonesia sudah mulai menerapkan sertifikat tanah elektronik (Permen ATR/BPN No. 1/2021 dan No. 3/2023),
tetapi datanya masih tersimpan di sistem terpusat. Beberapa negara sudah memakai blockchain untuk pendaftaran tanah:

| Negara | Implementasi |
|---|---|
| Georgia | National Agency of Public Registry + Bitfury mencatat hak atas tanah di blockchain sejak 2016 |
| Dubai (UAE) | Dubai Land Department mencatat transaksi properti di blockchain sejak 2017 |
| Swedia | Lantmäteriet + ChromaWay menguji coba proses jual beli tanah di blockchain |
| India | Uji coba di beberapa negara bagian (mis. Andhra Pradesh) |

Prototype ini memodelkan konsep yang sama di atas Hyperledger Fabric, yaitu blockchain *permissioned*
yang cocok untuk lembaga pemerintah dan profesi yang identitasnya jelas.

## Arsitektur

```mermaid
flowchart LR
    subgraph Web["Web demo (Express)"]
        UI[Halaman BPN / PPAT / Publik]
    end
    subgraph Fabric["Jaringan Hyperledger Fabric — channel: mychannel"]
        P1[peer0 Org1<br/>BPN]
        P2[peer0 Org2<br/>PPAT]
        O[Orderer]
        CC[[Chaincode landregistry]]
    end
    UI -- Fabric Gateway SDK<br/>identitas Org1 --> P1
    UI -- Fabric Gateway SDK<br/>identitas Org2 --> P2
    P1 --- CC
    P2 --- CC
    P1 --- O
    P2 --- O
```

| Organisasi Fabric | Peran | Hak di chaincode |
|---|---|---|
| `Org1MSP` | **BPN** (Badan Pertanahan Nasional) | Menerbitkan sertifikat, mengesahkan/menolak balik nama, memblokir |
| `Org2MSP` | **Notaris / PPAT** | Mengajukan balik nama berdasarkan Akta Jual Beli |
| — | **Publik** | Membaca status dan riwayat sertifikat |

Endorsement policy bawaan test-network membutuhkan **persetujuan peer kedua organisasi**,
sehingga tidak ada satu pihak pun yang bisa mengubah ledger sendirian.

## Aturan Bisnis di Chaincode

```
TerbitkanSertifikat (BPN) ──► AKTIF ──► AjukanBalikNama (PPAT) ──► PROSES_BALIK_NAMA
                                ▲                                       │
                                │        SahkanBalikNama (BPN) ◄────────┤ pemilik berganti
                                │        TolakBalikNama  (BPN) ◄────────┘
                                │
              BukaBlokir (BPN) ─┴─ DIBLOKIR ◄── BlokirSertifikat (BPN)
```

| Aturan | Mencegah |
|---|---|
| Satu NIB (Nomor Identifikasi Bidang) hanya boleh punya satu sertifikat | Sertifikat ganda |
| NIK penjual harus sama dengan pemilik tercatat saat ini | Menjual tanah milik orang lain / menjual dua kali |
| Hanya BPN yang boleh menerbitkan dan mengesahkan | PPAT atau pihak lain mengubah kepemilikan sendiri |
| Sertifikat `DIBLOKIR` atau sedang `PROSES_BALIK_NAMA` tidak bisa diajukan jual beli | Transaksi atas tanah sengketa / agunan |
| Semua perubahan tersimpan di riwayat ledger (`getHistoryForKey`) | Manipulasi jejak kepemilikan |

### Fungsi Chaincode

| Fungsi | Pemanggil | Keterangan |
|---|---|---|
| `InitLedger` | BPN | Mengisi 2 sertifikat contoh |
| `TerbitkanSertifikat(nomor, nib, lokasi, luasM2, nikPemilik, namaPemilik)` | BPN | Menerbitkan sertifikat baru |
| `AjukanBalikNama(nomor, nikPenjual, nikPembeli, namaPembeli, nomorAkta)` | PPAT | Mengajukan perpindahan hak |
| `SahkanBalikNama(nomor)` / `TolakBalikNama(nomor, alasan)` | BPN | Memutuskan pengajuan |
| `BlokirSertifikat(nomor, alasan)` / `BukaBlokir(nomor)` | BPN | Mengunci sertifikat sengketa |
| `BacaSertifikat(nomor)`, `CekBidangTanah(nib)`, `DaftarSertifikat()`, `RiwayatSertifikat(nomor)` | Semua | Query |

## Struktur Folder

```
land-registry-fabric/
├── chaincode/            # Smart contract (TypeScript, fabric-contract-api)
│   ├── src/landRegistry.ts
│   └── test/             # Unit test aturan bisnis (tanpa Docker)
├── application/          # REST API + web demo (Node.js, Fabric Gateway SDK)
│   ├── src/server.js
│   ├── src/fabric.js
│   └── public/           # Halaman web
└── scripts/              # Setup & menyalakan/mematikan jaringan
```

## Prasyarat (Windows)

1. **WSL2 dengan Ubuntu**: `wsl --install -d Ubuntu` di PowerShell (Administrator), lalu restart.
2. **Docker Desktop** dengan *Settings → Resources → WSL Integration* diaktifkan untuk Ubuntu.
3. Di dalam Ubuntu (WSL): `git`, `curl`, `jq`, dan **Node.js 18+**:
   ```bash
   sudo apt update && sudo apt install -y git curl jq
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
   ```

> Semua perintah di bawah dijalankan **di terminal Ubuntu (WSL)**, bukan di PowerShell atau Git Bash.
> Folder Laragon bisa diakses dari WSL lewat `/mnt/c/laragon/www/land-registry-fabric`.

## Cara Menjalankan

```bash
cd /mnt/c/laragon/www/land-registry-fabric

# 1. Unduh fabric-samples + binary + image Docker (sekali saja, ±2 GB)
bash scripts/setup-fabric.sh

# 2. Nyalakan jaringan, buat channel, deploy chaincode
bash scripts/network-up.sh

# 3. Jalankan web demo
cd application
npm install
npm start
```

Buka **http://localhost:3000** di browser Windows.

Mengulang blockchain dari awal (hapus semua sertifikat dan blok, isi ulang 2 sertifikat contoh,
lalu restart web demo bila berjalan sebagai service systemd):

```bash
bash scripts/reset-ledger.sh      # tambahkan -y untuk melewati konfirmasi
```

Mematikan jaringan dan menghapus seluruh data ledger:

```bash
bash scripts/network-down.sh
```

Variabel lingkungan opsional: `TEST_NETWORK_PATH` (default `~/fabric-samples/test-network`),
`CHANNEL_NAME` (default `mychannel`), `CHAINCODE_NAME` (default `landregistry`), `PORT` (default `3000`),
`HOST` (default `0.0.0.0`), dan `BASE_PATH` (default `/`, mis. `/land-registry-fabric/` bila dipasang di subpath
di belakang reverse proxy).

### Deploy di VPS (subpath di belakang Nginx)

```bash
PORT=3100 HOST=127.0.0.1 BASE_PATH=/land-registry-fabric/ npm start
```

```nginx
location ^~ /land-registry-fabric {
    rewrite ^/land-registry-fabric/?(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
}
```

`scripts/network-up.sh` mempublikasikan port peer dan orderer hanya di `127.0.0.1`,
karena port Docker tidak tersaring oleh UFW.

### Deploy Multi-Server (setiap node memberi suara)

Dijalankan dari master, tanpa Docker dan tanpa sudo. Setiap server menjadi satu organisasi dengan satu suara:

| Node | Organisasi | Peran | Orderer Raft |
|---|---|---|---|
| node1 | `Org1MSP` | BPN (sekaligus web) | orderer1 |
| node2 | `Org2MSP` | PPAT | orderer2 |
| node3 | `Org3MSP` | Validator | — |
| node4 | `Org4MSP` | Validator | orderer3 |
| node5 | `Org5MSP` | Validator | — |

```bash
bash scripts/cluster.sh deploy       # Bangun dari nol; node yang mati dilewati (minimal 3 hidup)
bash scripts/cluster.sh join node3   # Pasang node yang tadinya mati
bash scripts/cluster.sh reset        # Hapus semua blok dan isi ulang data awal
bash scripts/cluster.sh status       # Status proses tiap node
bash scripts/cluster.sh start        # Nyalakan node lagi, mis. setelah server reboot
bash scripts/cluster.sh autostart    # Opsional: crontab @reboot agar node menyala sendiri
```

Setiap perubahan data dikirim dulu ke semua node. Tiap node menjalankan chaincode terhadap ledger miliknya dan
menjawab **setuju**, **tolak**, atau **tidak hadir**. Transaksi hanya dikirim ke orderer bila minimal 3 dari 5 setuju
(`MAJORITY Endorsement`), dan peer memeriksa ulang tanda tangan para penyetuju saat menerima blok.
Suara setuju tersimpan permanen di blok; suara pada transaksi yang ditolak hanya tersimpan di memori web.

Karena semua node menjalankan chaincode yang sama, suara hanya berbeda bila ada node yang mati, tertinggal,
atau ledger/kodenya berubah. Untuk aturan bisnis biasa, semua node hadir akan memberi jawaban yang sama.

Tombol Reset di web disembunyikan pada mode ini karena web di node1 tidak punya akses ke node lain.
Identitas semua organisasi masih dibuat terpusat di master; implementasi nyata sebaiknya tiap organisasi punya CA sendiri.

### Menjalankan Unit Test Chaincode (tanpa Fabric)

```bash
cd chaincode
npm install
npm run build
npm test
```

## Skenario Demo Presentasi (±5 menit)

1. **Buat Sertifikat**: terbitkan `SHM-3271-0003` atas nama **Budi Santoso** (form sudah terisi).
   Gambar sertifikat muncul lengkap dengan sketsa bidang tanah, QR verifikasi, dan nomor blok tempat ia tercatat.
2. **Balik Nama**: PPAT mengajukan balik nama ke **Sari Wulandari** (akta `AJB-001/2026`),
   lalu BPN klik **Sahkan**. Pemilik berganti menjadi Sari.
3. **Cek & Riwayat**: cek `SHM-3271-0003` (atau pindai QR-nya). Riwayat tampil sebagai urutan transaksi,
   masing-masing dengan nomor bloknya: terbit → diajukan → disahkan.
4. **Blockchain**: klik salah satu nomor blok untuk membuka diagram rantai blok.
   - Setiap blok menampilkan `hash` miliknya dan `prev` (hash blok sebelumnya). Warnanya sama, jadi
     terlihat bahwa blok saling terkunci.
   - Klik sebuah blok untuk melihat isinya: fungsi chaincode, argumen, pengirim (BPN/PPAT), waktu, dan ID transaksi.
   - Blok #0–#5 adalah pembuatan channel dan pemasangan smart contract. Data sertifikat dimulai dari blok #6.

Hash blok dihitung ulang oleh aplikasi dari header blok (SHA-256 atas ASN.1 `number`, `previousHash`,
`dataHash`) dan cocok dengan hash yang dilaporkan Fabric (`GetChainInfo`).

## REST API

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/sertifikat` | Daftar semua sertifikat |
| GET | `/api/sertifikat/:nomor` | Detail sertifikat |
| GET | `/api/sertifikat/:nomor/riwayat` | Riwayat perubahan |
| GET | `/api/bidang/:nib` | Cari sertifikat berdasarkan NIB |
| GET | `/api/blockchain?sampai=N&jumlah=8` | Blok terbaru (hash, prev hash, isi transaksi) |
| GET | `/api/blok/:nomor` | Satu blok |
| GET | `/api/node` | Status tiap node, kuorum, dan pemungutan suara terakhir |
| POST | `/api/:peran/terbitkan` | Body: `nomor, nib, lokasi, luasM2, nikPemilik, namaPemilik` |
| POST | `/api/:peran/ajukan-balik-nama` | Body: `nomor, nikPenjual, nikPembeli, namaPembeli, nomorAkta` |
| POST | `/api/:peran/sahkan/:nomor` | Mengesahkan balik nama |
| POST | `/api/:peran/tolak/:nomor` | Body: `alasan` |
| POST | `/api/:peran/blokir/:nomor` | Body: `alasan` |
| POST | `/api/:peran/buka-blokir/:nomor` | Membuka blokir |

`:peran` adalah `bpn` (identitas Org1) atau `ppat` (identitas Org2). Transaksi dari peran yang salah
tetap dikirim ke jaringan dan akan **ditolak oleh chaincode**. Respons transaksi berisi `data`,
`blok` (nomor blok tempat transaksi tercatat), dan `txId`.

## Batasan Prototype

- Mode lokal memakai `test-network` dari fabric-samples (1 peer per organisasi, 1 orderer). Belum siap produksi.
- Pemilik tanah tidak punya identitas di jaringan. Keabsahan penjual diverifikasi PPAT lewat NIK.
- Data pribadi (NIK) disimpan apa adanya demi kemudahan demo. Implementasi nyata sebaiknya memakai
  *private data collection* atau hash agar sesuai UU Pelindungan Data Pribadi.
- Belum ada peta bidang tanah, dokumen akta, maupun integrasi dengan sistem BPN.

## Lisensi

Apache-2.0
