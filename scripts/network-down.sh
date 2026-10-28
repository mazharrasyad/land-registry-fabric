#!/usr/bin/env bash
# Mematikan jaringan Fabric dan menghapus seluruh container serta data ledger.
set -euo pipefail

TEST_NETWORK="${TEST_NETWORK_PATH:-$HOME/fabric-samples/test-network}"
export PATH="$TEST_NETWORK/../bin:$PATH"
cd "$TEST_NETWORK"
./network.sh down
