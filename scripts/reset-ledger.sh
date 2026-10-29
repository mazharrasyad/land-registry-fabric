#!/usr/bin/env bash
# Mengulang blockchain dari awal: hapus jaringan & seluruh blok, nyalakan ulang,
# deploy chaincode + 2 sertifikat contoh, lalu restart web demo (jika memakai systemd).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${SERVICE_NAME:-land-registry-fabric}"

if [ "${1:-}" != "-y" ]; then
  read -r -p "Semua sertifikat dan blok akan DIHAPUS permanen. Lanjutkan? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { echo "Dibatalkan."; exit 1; }
fi

LOG="${TMPDIR:-/tmp}/land-registry-network.log"
echo "Mengulang jaringan Fabric (±2-3 menit, log: $LOG)…"
bash "$ROOT/scripts/network-up.sh" > "$LOG" 2>&1 || { tail -20 "$LOG"; echo "Gagal. Lihat log di atas." >&2; exit 1; }

# Kredensial baru dibuat ulang, jadi web demo wajib di-restart agar terhubung lagi.
if command -v systemctl >/dev/null && systemctl cat "$SERVICE" >/dev/null 2>&1; then
  systemctl restart "$SERVICE"
  echo "Service $SERVICE di-restart."
else
  echo "Restart web demo secara manual (Ctrl+C lalu npm start di folder application)."
fi

echo "Selesai. Blockchain kembali ke awal: blok #0-#6 dengan 2 sertifikat contoh."
