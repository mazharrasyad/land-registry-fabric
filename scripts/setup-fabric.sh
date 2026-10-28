#!/usr/bin/env bash
# Unduh fabric-samples, binary Fabric, dan image Docker (sekali saja).
# Jalankan di dalam WSL2 (Ubuntu), bukan di Git Bash / PowerShell.
set -euo pipefail

FABRIC_HOME="${FABRIC_HOME:-$HOME}"
cd "$FABRIC_HOME"

if [ -d fabric-samples/test-network ]; then
  echo "fabric-samples sudah ada di $FABRIC_HOME/fabric-samples"
  exit 0
fi

curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary

echo
echo "Selesai. Tambahkan ke ~/.bashrc agar binary Fabric dikenali:"
echo "  export PATH=\"$FABRIC_HOME/fabric-samples/bin:\$PATH\""
