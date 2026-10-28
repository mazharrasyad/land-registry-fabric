#!/usr/bin/env bash
# Menyalakan jaringan Fabric (Org1 = BPN, Org2 = PPAT), membuat channel,
# lalu men-deploy chaincode landregistry beserta data awal (InitLedger).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_NETWORK="${TEST_NETWORK_PATH:-$HOME/fabric-samples/test-network}"
CHANNEL="${CHANNEL_NAME:-mychannel}"
CC_NAME="${CHAINCODE_NAME:-landregistry}"

if [ ! -d "$TEST_NETWORK" ]; then
  echo "test-network tidak ditemukan di $TEST_NETWORK. Jalankan scripts/setup-fabric.sh dulu." >&2
  exit 1
fi

export PATH="$TEST_NETWORK/../bin:$PATH"
cd "$TEST_NETWORK"

# Port Docker melewati firewall (UFW), jadi publikasikan port peer/orderer hanya di localhost.
sed -i -E 's/^(\s*- )"?([0-9]+:[0-9]+)"?\s*$/\1"127.0.0.1:\2"/' compose/compose-test-net.yaml

./network.sh down
./network.sh up createChannel -c "$CHANNEL"
./network.sh deployCC -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$ROOT/chaincode" -ccl typescript -cci InitLedger

echo
echo "Jaringan siap. Jalankan aplikasi web:"
echo "  cd \"$ROOT/application\" && npm install && npm start"
